"""
Feature Engineering Pipeline for Option Price Predictor.
Uses Polars for fast rolling window calculations.
"""
import polars as pl
import numpy as np
from typing import Optional

from backend.data_engine.loader import DataLoader
from backend.logger import logger

class FeatureBuilder:
    def __init__(self, loader: Optional[DataLoader] = None):
        self.loader = loader or DataLoader()
        
    def build_features_for_expiry(self, expiry: str) -> Optional[pl.DataFrame]:
        """
        Builds a complete ML-ready dataset for a single expiry.
        """
        logger.info(f"Building features for expiry: {expiry}")
        try:
            data = self.loader.load_all_for_expiry(expiry, use_unified=True)
        except Exception as e:
            logger.error(f"Failed to load data for {expiry}: {e}")
            return None
            
        opt_df = data.get("options")
        idx_df = data.get("index")
        fut_df = data.get("futures")
        
        if opt_df is None or idx_df is None or idx_df.is_empty() or opt_df.is_empty():
            logger.warning(f"Missing essential data for {expiry}")
            return None
            
        # 1. Spot Features
        idx_feat = self._build_spot_features(idx_df)
        
        # 2. Futures Features (Basis)
        if fut_df is not None and not fut_df.is_empty():
            fut_feat = self._build_future_features(fut_df, idx_feat)
            df = idx_feat.join(fut_feat, on="Date", how="left")
        else:
            df = idx_feat.with_columns(pl.lit(0.0).alias("feat_basis_pct"))
            
        # 3. Options Features (PCR, OI Momentum)
        opt_feat = self._build_options_features(opt_df, df)
        df = df.join(opt_feat, on="Date", how="left")
        
        # 4. Generate Target (Future Returns)
        df = self._build_targets(df)
        
        # Drop rows with nulls resulting from rolling windows and shifts
        df = df.drop_nulls()
        
        return df

    def _build_spot_features(self, df: pl.DataFrame) -> pl.DataFrame:
        """
        Calculates moving averages, RSI, VWAP distance.
        """
        # Ensure sorted by date
        df = df.sort("Date")
        
        res = df.select([
            pl.col("Date"),
            pl.col("Close").alias("spot_close"),
            pl.col("Volume").alias("spot_volume") if "Volume" in df.columns else pl.lit(0).alias("spot_volume")
        ])
        
        # Returns
        res = res.with_columns([
            (pl.col("spot_close").pct_change(1)).alias("feat_ret_1m"),
            (pl.col("spot_close").pct_change(5)).alias("feat_ret_5m"),
            (pl.col("spot_close").pct_change(15)).alias("feat_ret_15m"),
        ])
        
        # Rolling Volatility (15m)
        res = res.with_columns([
            pl.col("feat_ret_1m").rolling_std(window_size=15).alias("feat_vol_15m")
        ])
        
        # Simple RSI approximation (14 period)
        gains = pl.when(pl.col("feat_ret_1m") > 0).then(pl.col("feat_ret_1m")).otherwise(0)
        losses = pl.when(pl.col("feat_ret_1m") < 0).then(pl.col("feat_ret_1m").abs()).otherwise(0)
        
        res = res.with_columns([
            gains.rolling_mean(window_size=14).alias("avg_gain"),
            losses.rolling_mean(window_size=14).alias("avg_loss"),
        ])
        
        rs = pl.col("avg_gain") / (pl.col("avg_loss") + 1e-9)
        rsi = 100.0 - (100.0 / (1.0 + rs))
        
        res = res.with_columns(rsi.alias("feat_rsi_14m"))
        res = res.drop(["avg_gain", "avg_loss"])
        
        return res

    def _build_future_features(self, fut_df: pl.DataFrame, idx_feat: pl.DataFrame) -> pl.DataFrame:
        """Calculate basis (Future - Spot)."""
        fut_df = fut_df.sort("Date").select([
            pl.col("Date"),
            pl.col("Close").alias("fut_close")
        ])
        
        merged = fut_df.join(idx_feat.select(["Date", "spot_close"]), on="Date")
        merged = merged.with_columns([
            ((pl.col("fut_close") - pl.col("spot_close")) / pl.col("spot_close") * 100).alias("feat_basis_pct")
        ])
        
        return merged.select(["Date", "feat_basis_pct"])

    def _build_options_features(self, opt_df: pl.DataFrame, idx_df: pl.DataFrame) -> pl.DataFrame:
        """Calculate PCR, OI Momentum."""
        # Find closest strike at each timestamp (ATM)
        # To keep it performant, we aggregate total CE Volume and Total PE Volume per minute
        
        opt_df = opt_df.sort("Date")
        
        aggs = opt_df.group_by(["Date", "Right"]).agg([
            pl.col("Volume").sum().alias("total_volume"),
            pl.col("OI").sum().alias("total_oi")
        ])
        
        ce_df = aggs.filter(pl.col("Right") == "CE").rename({"total_volume": "ce_vol", "total_oi": "ce_oi"}).drop("Right")
        pe_df = aggs.filter(pl.col("Right") == "PE").rename({"total_volume": "pe_vol", "total_oi": "pe_oi"}).drop("Right")
        
        res = ce_df.join(pe_df, on="Date", how="outer_coalesce")
        
        # Fill nulls with 0
        res = res.fill_null(0)
        
        # Put-Call Ratio
        res = res.with_columns([
            (pl.col("pe_vol") / (pl.col("ce_vol") + 1)).alias("feat_pcr_vol"),
            (pl.col("pe_oi") / (pl.col("ce_oi") + 1)).alias("feat_pcr_oi"),
        ])
        
        # OI Momentum (5m change)
        res = res.sort("Date").with_columns([
            (pl.col("ce_oi").diff(n=5)).alias("feat_ce_oi_change_5m"),
            (pl.col("pe_oi").diff(n=5)).alias("feat_pe_oi_change_5m"),
        ])
        
        return res.select(["Date", "feat_pcr_vol", "feat_pcr_oi", "feat_ce_oi_change_5m", "feat_pe_oi_change_5m"])

    def _build_targets(self, df: pl.DataFrame) -> pl.DataFrame:
        """
        Creates target variables for supervised learning.
        1: UP (> 0.05% move in 5 mins)
        2: DOWN (< -0.05% move in 5 mins)
        0: SIDEWAYS
        """
        df = df.sort("Date")
        
        # Lookahead 5 minutes for target calculation
        df = df.with_columns([
            (pl.col("spot_close").shift(-5)).alias("future_close_5m")
        ])
        
        df = df.with_columns([
            ((pl.col("future_close_5m") - pl.col("spot_close")) / pl.col("spot_close")).alias("target_return_5m")
        ])
        
        # Threshold: 0.05% move (approx 12 points on 24000 NIFTY)
        THRESHOLD = 0.0005 
        
        target_class = pl.when(pl.col("target_return_5m") > THRESHOLD).then(1) \
                         .when(pl.col("target_return_5m") < -THRESHOLD).then(2) \
                         .otherwise(0)
                         
        df = df.with_columns(target_class.alias("target_class_5m"))
        
        return df

if __name__ == "__main__":
    from backend.data_engine.expiry_discovery import ExpiryDiscovery
    disc = ExpiryDiscovery()
    expiries = disc.get_expiry_folders()
    if expiries:
        builder = FeatureBuilder()
        test_exp = expiries[-1]
        print(f"Testing feature generation on {test_exp}...")
        feat_df = builder.build_features_for_expiry(test_exp)
        if feat_df is not None:
            print(feat_df.tail(5))
            print(f"Columns: {feat_df.columns}")
            
            # Print class distribution
            dist = feat_df.group_by("target_class_5m").count()
            print("\nClass Distribution:")
            print(dist)
