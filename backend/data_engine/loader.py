"""
High-performance parquet data loader with LRU caching and lazy loading.
"""
import polars as pl
from pathlib import Path
from functools import lru_cache
from typing import Optional

from backend.config import config


class DataLoader:
    """
    Loads and caches parquet data files efficiently using Polars.
    Supports lazy loading, column pruning, and time-range filtering.
    """

    def __init__(self, base_path: str | None = None):
        self.base_path = Path(base_path or config.data.base_path)
        self.unified_base_path = Path(config.data.unified_base_path)
        self._cache: dict[str, pl.DataFrame] = {}
        self._max_cache = config.data.cache_max_size

    def load_options(
        self,
        expiry_folder: str,
        columns: list[str] | None = None,
        start_time: str | None = None,
        end_time: str | None = None,
        strikes: list[int] | None = None,
        right: str | None = None,
        use_unified: bool | None = None,
    ) -> pl.DataFrame:
        """
        Load options data for a specific expiry.
        """
        cache_key = f"options_{expiry_folder}_{'uni' if use_unified else 'sep'}"
        
        # Determine path and type
        file_path, instrument_type = self._get_load_info(expiry_folder, "OPTION", use_unified)
        
        df = self._get_cached_or_load(cache_key, file_path, instrument_type)

        # Parse Date column to datetime if it's a string
        if df.schema.get("Date") == pl.Utf8:
            df = df.with_columns(
                pl.col("Date").str.to_datetime().alias("Date")
            )

        # Apply filters
        if right:
            df = df.filter(pl.col("Right") == right)

        if strikes:
            df = df.filter(pl.col("Strike").is_in(strikes))

        if start_time or end_time:
            df = self._filter_time_range(df, start_time, end_time)

        if columns:
            available = [c for c in columns if c in df.columns]
            df = df.select(available)

        return df

    def load_index(
        self,
        expiry_folder: str,
        columns: list[str] | None = None,
        start_time: str | None = None,
        end_time: str | None = None,
        use_unified: bool | None = None,
    ) -> pl.DataFrame:
        """Load index (spot) data for a specific expiry."""
        cache_key = f"index_{expiry_folder}_{'uni' if use_unified else 'sep'}"
        file_path, instrument_type = self._get_load_info(expiry_folder, "INDEX", use_unified)
        df = self._get_cached_or_load(cache_key, file_path, instrument_type)

        if df.schema.get("Date") == pl.Utf8:
            df = df.with_columns(
                pl.col("Date").str.to_datetime().alias("Date")
            )

        if start_time or end_time:
            df = self._filter_time_range(df, start_time, end_time)

        if columns:
            available = [c for c in columns if c in df.columns]
            df = df.select(available)

        return df

    def load_futures(
        self,
        expiry_folder: str,
        columns: list[str] | None = None,
        start_time: str | None = None,
        end_time: str | None = None,
        use_unified: bool | None = None,
    ) -> pl.DataFrame:
        """Load futures data for a specific expiry."""
        cache_key = f"futures_{expiry_folder}_{'uni' if use_unified else 'sep'}"
        file_path, instrument_type = self._get_load_info(expiry_folder, "FUTURES", use_unified)
        df = self._get_cached_or_load(cache_key, file_path, instrument_type)

        if df.schema.get("Date") == pl.Utf8:
            df = df.with_columns(
                pl.col("Date").str.to_datetime().alias("Date")
            )

        if start_time or end_time:
            df = self._filter_time_range(df, start_time, end_time)

        if columns:
            available = [c for c in columns if c in df.columns]
            df = df.select(available)

        return df

    def load_all_for_expiry(self, expiry_folder: str, use_unified: bool | None = None) -> dict[str, pl.DataFrame]:
        """Load all three datasets for an expiry."""
        # Optimization: If using unified, load file once
        effective_unified = use_unified if use_unified is not None else config.data.use_unified
        unified_path = self.unified_base_path / expiry_folder / config.data.unified_filename
        
        if effective_unified and unified_path.exists():
            df = pl.read_parquet(unified_path)
            # Ensure Date is datetime if needed
            if df.schema.get("Date") == pl.Utf8:
                df = df.with_columns(pl.col("Date").str.to_datetime().alias("Date"))
            
            return {
                "options": df.filter(pl.col("InstrumentType") == "OPTION"),
                "index": df.filter(pl.col("InstrumentType") == "INDEX"),
                "futures": df.filter(pl.col("InstrumentType") == "FUTURES"),
            }
        
        return {
            "options": self.load_options(expiry_folder, use_unified=use_unified),
            "index": self.load_index(expiry_folder, use_unified=use_unified),
            "futures": self.load_futures(expiry_folder, use_unified=use_unified),
        }

    def get_option_chain_at_time(
        self,
        expiry_folder: str,
        timestamp: str,
        use_unified: bool | None = None,
    ) -> pl.DataFrame:
        """
        Get the option chain snapshot at a specific timestamp.
        Returns all strikes with CE/PE data pivoted.
        """
        df = self.load_options(expiry_folder, use_unified=use_unified)

        # Filter to the specific timestamp
        target = pl.Series([timestamp]).str.to_datetime()[0]
        snapshot = df.filter(pl.col("Date") == target)

        return snapshot.sort(["Strike", "Right"])

    def _get_load_info(self, expiry_folder: str, instrument_type: str, use_unified: bool | None = None) -> tuple[Path, Optional[str]]:
        """Determine path and instrument type for loading."""
        effective_unified = use_unified if use_unified is not None else config.data.use_unified
        unified_path = self.unified_base_path / expiry_folder / config.data.unified_filename
        
        if effective_unified and unified_path.exists():
            return unified_path, instrument_type
            
        # Fallback to separate files
        filename_map = {
            "OPTION": config.data.options_filename,
            "INDEX": config.data.index_filename,
            "FUTURES": config.data.futures_filename
        }
        return self.base_path / expiry_folder / filename_map[instrument_type], None

    def _get_cached_or_load(self, cache_key: str, file_path: Path, instrument_type: str | None = None) -> pl.DataFrame:
        """Load from cache or read parquet file."""
        if cache_key in self._cache:
            return self._cache[cache_key]

        if not file_path.exists():
            raise FileNotFoundError(f"Parquet file not found: {file_path}")

        df = pl.read_parquet(file_path)
        
        # Filter if loading from unified
        if instrument_type:
            df = df.filter(pl.col("InstrumentType") == instrument_type)

        # Cache management: evict oldest if at capacity
        if len(self._cache) >= self._max_cache:
            oldest_key = next(iter(self._cache))
            del self._cache[oldest_key]

        self._cache[cache_key] = df
        return df

    def _filter_time_range(
        self,
        df: pl.DataFrame,
        start_time: str | None = None,
        end_time: str | None = None,
    ) -> pl.DataFrame:
        """Filter DataFrame by time range (HH:MM format)."""
        time_col = pl.col("Date").dt.time()

        if start_time:
            h, m = map(int, start_time.split(":"))
            from datetime import time as dt_time
            df = df.filter(time_col >= dt_time(h, m))

        if end_time:
            h, m = map(int, end_time.split(":"))
            from datetime import time as dt_time
            df = df.filter(time_col <= dt_time(h, m))

        return df

    def clear_cache(self):
        """Clear the entire data cache."""
        self._cache.clear()

    def evict_from_cache(self, expiry_folder: str):
        """Evict a specific expiry's data from cache."""
        keys_to_remove = [k for k in self._cache if expiry_folder in k]
        for key in keys_to_remove:
            del self._cache[key]

    @property
    def cache_info(self) -> dict:
        """Get cache status."""
        return {
            "cached_items": len(self._cache),
            "max_size": self._max_cache,
            "keys": list(self._cache.keys()),
        }
