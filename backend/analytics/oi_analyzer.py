"""
Analyzes Open Interest (OI) and Volume changes in option data to detect spikes.
"""
import polars as pl
import math
from typing import List, Dict, Any

class OIAnalyzer:
    @staticmethod
    def detect_spikes(
        df: pl.DataFrame, 
        oi_threshold: float = 0.5, 
        vol_threshold: float = 0.5,
        min_ltp: float = 0.0
    ) -> List[Dict[str, Any]]:
        """
        Detects sudden increases in BOTH OI and Volume for all strikes and rights.
        
        Args:
            df: Polars DataFrame with columns [Date, Strike, Right, OI, Volume, Close]
            oi_threshold: % increase for OI (default 0.5 = 50%)
            vol_threshold: % increase for Volume (default 0.5 = 50%)
            min_ltp: Minimum LTP (Close) to include in results
            
        Returns:
            List of spike events with metadata.
        """
        if df.is_empty():
            return []
            
        # Ensure data is sorted
        df = df.sort(["Strike", "Right", "Date"])
        
        # Calculate changes per group
        df_spikes = df.with_columns([
            pl.col("OI").shift(1).over(["Strike", "Right"]).alias("prev_oi"),
            pl.col("Volume").shift(1).over(["Strike", "Right"]).alias("prev_vol"),
            pl.col("Close").shift(1).over(["Strike", "Right"]).alias("prev_close")
        ])
        
        # Calculate percentage changes and price move
        df_spikes = df_spikes.with_columns([
            ((pl.col("OI") - pl.col("prev_oi")) / pl.col("prev_oi")).alias("oi_change_pct"),
            ((pl.col("Volume") - pl.col("prev_vol")) / pl.col("prev_vol")).alias("vol_change_pct"),
            (pl.col("Close") - pl.col("prev_close")).alias("price_move")
        ])
        
        # Filter for spikes > BOTH thresholds (AND condition) AND Close > min_ltp
        # We explicitly exclude cases where prev values were 0 to avoid Infinity
        df_spikes = df_spikes.filter(
            (pl.col("oi_change_pct") >= oi_threshold) & (pl.col("prev_oi") > 0) &
            (pl.col("vol_change_pct") >= vol_threshold) & (pl.col("prev_vol") > 0) &
            (pl.col("Close") >= min_ltp)
        )
        
        # Format for output
        spikes = df_spikes.select([
            "Date", "Strike", "Right", "OI", "prev_oi", "oi_change_pct", 
            "Volume", "prev_vol", "vol_change_pct", "Close", "price_move"
        ]).to_dicts()
        
        # Clean up output
        for s in spikes:
            # Timestamp formatting
            if hasattr(s["Date"], "strftime"):
                s["timestamp"] = s["Date"].strftime("%d/%m/%Y %H:%M:%S")
            else:
                s["timestamp"] = str(s["Date"])
                
            # Derived fields and rounding
            # Sanitize raw percentage changes to avoid inf in calculations
            for key in ["oi_change_pct", "vol_change_pct", "price_move"]:
                val = s.get(key)
                if val is None or (isinstance(val, float) and (math.isinf(val) or math.isnan(val))):
                    s[key] = 0.0
            
            s["oi_increase_pct"] = round(s["oi_change_pct"] * 100, 2)
            s["vol_increase_pct"] = round(s["vol_change_pct"] * 100, 2)
            s["price_change"] = round(s["price_move"], 2)
            
            # Final JSON compliance check for all float values
            for key, val in list(s.items()):
                if isinstance(val, float):
                    if math.isinf(val) or math.isnan(val):
                        s[key] = 0.0
        
        # Sort by date (descending) to show newest spikes first
        spikes.sort(key=lambda x: x["Date"], reverse=True)
        
        # Limit to reasonable amount for UI performance (e.g., 1000)
        MAX_SPIKES = 1000
        return spikes[:MAX_SPIKES]
