"""
Market Feature Extraction Engine — computes market features from 1-minute
index, options, and futures data for regime detection and strategy selection.
"""
import polars as pl
import numpy as np
from typing import Optional
from backend.logger import logger


class FeatureEngine:
    """
    Computes market features from 1-minute OHLCV data.

    Features computed:
        - realized_volatility: Rolling std of log returns
        - atr: Average True Range
        - vwap_distance: Distance from VWAP as percentage
        - trend_strength: Slope of EMA scaled
        - iv_percentile: IV rank vs trailing range
        - iv_skew: OTM put IV minus OTM call IV
        - put_call_ratio: Volume-based PCR
        - oi_change: Net open interest change
        - volume_spike: Boolean if volume > 2x avg
        - momentum: Rate of change over N bars
    """

    def __init__(
        self,
        vol_window: int = 20,
        atr_window: int = 14,
        ema_window: int = 20,
        momentum_window: int = 10,
        volume_spike_mult: float = 2.0,
    ):
        self.vol_window = vol_window
        self.atr_window = atr_window
        self.ema_window = ema_window
        self.momentum_window = momentum_window
        self.volume_spike_mult = volume_spike_mult

    def compute_features(
        self,
        index_df: pl.DataFrame,
        options_df: Optional[pl.DataFrame] = None,
        futures_df: Optional[pl.DataFrame] = None,
    ) -> dict[str, float]:
        """
        Compute all market features from the provided data.

        Args:
            index_df: 1-minute index/spot data with Date, Open, High, Low, Close, Volume
            options_df: Optional options chain data with Strike, Right, Close, Volume, OI
            futures_df: Optional futures data with Date, Open, High, Low, Close, Volume

        Returns:
            Dictionary of feature name -> value
        """
        features: dict[str, float] = {}

        # --- Index-based features ---
        if len(index_df) < 2:
            logger.warning("FeatureEngine: index_df has less than 2 rows, returning empty features")
            return self._empty_features()

        features["realized_volatility"] = self._realized_volatility(index_df)
        features["atr"] = self._atr(index_df)
        features["vwap_distance"] = self._vwap_distance(index_df)
        features["trend_strength"] = self._trend_strength(index_df)
        features["momentum"] = self._momentum(index_df)
        features["volume_spike"] = self._volume_spike(index_df)

        # --- Options-based features ---
        if options_df is not None and len(options_df) > 0:
            features["iv_percentile"] = self._iv_percentile(options_df, index_df)
            features["iv_skew"] = self._iv_skew(options_df, index_df)
            features["put_call_ratio"] = self._put_call_ratio(options_df)
            features["oi_change"] = self._oi_change(options_df)
        else:
            features["iv_percentile"] = 50.0
            features["iv_skew"] = 0.0
            features["put_call_ratio"] = 1.0
            features["oi_change"] = 0.0

        return features

    def compute_features_at_time(
        self,
        index_df: pl.DataFrame,
        options_df: Optional[pl.DataFrame],
        futures_df: Optional[pl.DataFrame],
        up_to_time: str,
    ) -> dict[str, float]:
        """
        Compute features using data up to a specific timestamp.
        Used for mid-expiry regime re-evaluation.

        Args:
            up_to_time: ISO timestamp string or datetime to filter up to
        """
        # Filter index data up to the given time
        if "Date" in index_df.columns:
            filtered_index = index_df.filter(pl.col("Date") <= pl.lit(up_to_time).str.to_datetime())
        else:
            filtered_index = index_df

        filtered_options = None
        if options_df is not None and "Date" in options_df.columns:
            filtered_options = options_df.filter(pl.col("Date") <= pl.lit(up_to_time).str.to_datetime())

        filtered_futures = None
        if futures_df is not None and "Date" in futures_df.columns:
            filtered_futures = futures_df.filter(pl.col("Date") <= pl.lit(up_to_time).str.to_datetime())

        return self.compute_features(filtered_index, filtered_options, filtered_futures)

    # ----------------------------------------------------------------
    # Individual feature computations
    # ----------------------------------------------------------------

    def _realized_volatility(self, df: pl.DataFrame) -> float:
        """Rolling standard deviation of log returns."""
        close = df["Close"].to_numpy().astype(np.float64)
        if len(close) < self.vol_window:
            return 0.0

        log_returns = np.diff(np.log(close))
        if len(log_returns) < self.vol_window:
            return float(np.std(log_returns))

        # Use the last vol_window returns
        recent = log_returns[-self.vol_window:]
        # Annualize: multiply by sqrt(375 trading minutes * 252 days)
        rv = float(np.std(recent)) * np.sqrt(375 * 252)
        return rv

    def _atr(self, df: pl.DataFrame) -> float:
        """Average True Range over atr_window bars."""
        high = df["High"].to_numpy().astype(np.float64)
        low = df["Low"].to_numpy().astype(np.float64)
        close = df["Close"].to_numpy().astype(np.float64)

        if len(high) < 2:
            return 0.0

        # True Range = max(H-L, |H-Cprev|, |L-Cprev|)
        tr1 = high[1:] - low[1:]
        tr2 = np.abs(high[1:] - close[:-1])
        tr3 = np.abs(low[1:] - close[:-1])
        tr = np.maximum(tr1, np.maximum(tr2, tr3))

        window = min(self.atr_window, len(tr))
        atr = float(np.mean(tr[-window:]))
        return atr

    def _vwap_distance(self, df: pl.DataFrame) -> float:
        """Distance of current price from VWAP as percentage."""
        close = df["Close"].to_numpy().astype(np.float64)
        high = df["High"].to_numpy().astype(np.float64)
        low = df["Low"].to_numpy().astype(np.float64)

        if "Volume" in df.columns:
            volume = df["Volume"].to_numpy().astype(np.float64)
        else:
            return 0.0

        # Typical Price * Volume / Cumulative Volume
        typical_price = (high + low + close) / 3.0
        cum_vol = np.cumsum(volume)

        if cum_vol[-1] == 0:
            return 0.0

        vwap = np.cumsum(typical_price * volume) / cum_vol
        current_price = close[-1]
        current_vwap = vwap[-1]

        if current_vwap == 0:
            return 0.0

        return float((current_price - current_vwap) / current_vwap * 100)

    def _trend_strength(self, df: pl.DataFrame) -> float:
        """
        Trend strength based on EMA slope.
        Positive = uptrend, Negative = downtrend, Near 0 = ranging.
        Returns normalized value roughly in [-1, 1] range.
        """
        close = df["Close"].to_numpy().astype(np.float64)
        if len(close) < self.ema_window:
            return 0.0

        # Compute EMA
        alpha = 2.0 / (self.ema_window + 1)
        ema = np.zeros_like(close)
        ema[0] = close[0]
        for i in range(1, len(close)):
            ema[i] = alpha * close[i] + (1 - alpha) * ema[i - 1]

        # Slope of last ema_window points, normalized by price
        recent_ema = ema[-self.ema_window:]
        if len(recent_ema) < 2:
            return 0.0

        slope = (recent_ema[-1] - recent_ema[0]) / self.ema_window
        # Normalize by current price to get a relative measure
        normalized = slope / close[-1] * 1000  # Scale for readability
        return float(np.clip(normalized, -1.0, 1.0))

    def _momentum(self, df: pl.DataFrame) -> float:
        """Rate of change over momentum_window bars, as percentage."""
        close = df["Close"].to_numpy().astype(np.float64)
        if len(close) <= self.momentum_window:
            return 0.0

        prev = close[-self.momentum_window - 1]
        if prev == 0:
            return 0.0

        return float((close[-1] - prev) / prev * 100)

    def _volume_spike(self, df: pl.DataFrame) -> float:
        """1.0 if current volume > volume_spike_mult × 20-bar avg, else 0.0."""
        if "Volume" not in df.columns:
            return 0.0

        volume = df["Volume"].to_numpy().astype(np.float64)
        if len(volume) < self.vol_window:
            return 0.0

        avg_vol = np.mean(volume[-self.vol_window:])
        if avg_vol == 0:
            return 0.0

        current_vol = volume[-1]
        return 1.0 if current_vol > self.volume_spike_mult * avg_vol else 0.0

    def _iv_percentile(self, options_df: pl.DataFrame, index_df: pl.DataFrame) -> float:
        """
        IV percentile — approximated using the ATM option premium as % of spot.
        Ranks current IV vs the range of IVs in the dataset.
        """
        close_prices = index_df["Close"].to_numpy().astype(np.float64)
        if len(close_prices) == 0:
            return 50.0

        spot = close_prices[-1]
        atm_strike = int(round(spot / 50) * 50)

        # Get ATM CE premiums across time as proxy for IV
        atm_data = options_df.filter(
            (pl.col("Strike") == atm_strike) & (pl.col("Right") == "CE")
        )

        if len(atm_data) == 0:
            return 50.0

        premiums = atm_data["Close"].to_numpy().astype(np.float64)
        premiums = premiums[premiums > 0]

        if len(premiums) < 2:
            return 50.0

        current_iv_proxy = premiums[-1]
        iv_min = np.min(premiums)
        iv_max = np.max(premiums)

        if iv_max == iv_min:
            return 50.0

        percentile = (current_iv_proxy - iv_min) / (iv_max - iv_min) * 100
        return float(np.clip(percentile, 0, 100))

    def _iv_skew(self, options_df: pl.DataFrame, index_df: pl.DataFrame) -> float:
        """
        IV skew — difference between OTM put premium and OTM call premium
        as percentage of spot. Positive = puts more expensive (bearish skew).
        """
        close_prices = index_df["Close"].to_numpy().astype(np.float64)
        if len(close_prices) == 0:
            return 0.0

        spot = close_prices[-1]
        atm = int(round(spot / 50) * 50)
        otm_offset = 200  # 200 points OTM

        # Get latest timestamp's data
        if "Date" in options_df.columns:
            latest = options_df["Date"].max()
            snapshot = options_df.filter(pl.col("Date") == latest)
        else:
            snapshot = options_df.tail(100)

        # OTM Call at ATM + offset
        otm_ce = snapshot.filter(
            (pl.col("Strike") == atm + otm_offset) & (pl.col("Right") == "CE")
        )
        # OTM Put at ATM - offset
        otm_pe = snapshot.filter(
            (pl.col("Strike") == atm - otm_offset) & (pl.col("Right") == "PE")
        )

        ce_premium = otm_ce["Close"].to_numpy()[-1] if len(otm_ce) > 0 else 0.0
        pe_premium = otm_pe["Close"].to_numpy()[-1] if len(otm_pe) > 0 else 0.0

        if spot == 0:
            return 0.0

        skew = (pe_premium - ce_premium) / spot * 100
        return float(skew)

    def _put_call_ratio(self, options_df: pl.DataFrame) -> float:
        """Volume-based put-call ratio from the latest snapshot."""
        if "Volume" not in options_df.columns:
            return 1.0

        if "Date" in options_df.columns:
            latest = options_df["Date"].max()
            snapshot = options_df.filter(pl.col("Date") == latest)
        else:
            snapshot = options_df.tail(100)

        ce_vol = snapshot.filter(pl.col("Right") == "CE")["Volume"].sum()
        pe_vol = snapshot.filter(pl.col("Right") == "PE")["Volume"].sum()

        if ce_vol == 0:
            return 1.0

        return float(pe_vol / ce_vol)

    def _oi_change(self, options_df: pl.DataFrame) -> float:
        """
        Net OI change — difference between total OI at latest vs earliest timestamp.
        Positive = OI building up.
        """
        if "OI" not in options_df.columns or "Date" not in options_df.columns:
            return 0.0

        dates = options_df["Date"].unique().sort()
        if len(dates) < 2:
            return 0.0

        first_date = dates[0]
        last_date = dates[-1]

        oi_first = options_df.filter(pl.col("Date") == first_date)["OI"].sum()
        oi_last = options_df.filter(pl.col("Date") == last_date)["OI"].sum()

        return float(oi_last - oi_first)

    def _empty_features(self) -> dict[str, float]:
        """Return a features dict with all zeros."""
        return {
            "realized_volatility": 0.0,
            "atr": 0.0,
            "vwap_distance": 0.0,
            "trend_strength": 0.0,
            "momentum": 0.0,
            "volume_spike": 0.0,
            "iv_percentile": 50.0,
            "iv_skew": 0.0,
            "put_call_ratio": 1.0,
            "oi_change": 0.0,
        }

    @staticmethod
    def feature_names() -> list[str]:
        """Return ordered list of feature names for ML model input."""
        return [
            "realized_volatility",
            "atr",
            "vwap_distance",
            "trend_strength",
            "momentum",
            "volume_spike",
            "iv_percentile",
            "iv_skew",
            "put_call_ratio",
            "oi_change",
        ]
