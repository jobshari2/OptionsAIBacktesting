"""
Data joiner — joins options, index, and futures data on timestamps.
Computes ATM strike, moneyness, and other derived columns.
"""
import polars as pl
import numpy as np


class DataJoiner:
    """Joins multiple data sources and computes derived columns."""

    @staticmethod
    def join_options_with_index(
        options_df: pl.DataFrame,
        index_df: pl.DataFrame,
    ) -> pl.DataFrame:
        """
        Join options data with index (spot) data on timestamp.
        Adds spot_price column to options data.
        """
        # Rename index columns to avoid conflicts
        index_renamed = index_df.select([
            pl.col("Date"),
            pl.col("Close").alias("spot_price"),
            pl.col("Open").alias("spot_open"),
            pl.col("High").alias("spot_high"),
            pl.col("Low").alias("spot_low"),
        ])

        joined = options_df.join(
            index_renamed,
            on="Date",
            how="left",
        )

        return joined

    @staticmethod
    def join_options_with_futures(
        options_df: pl.DataFrame,
        futures_df: pl.DataFrame,
    ) -> pl.DataFrame:
        """
        Join options data with futures data on timestamp.
        Adds futures_price column.
        """
        futures_renamed = futures_df.select([
            pl.col("Date"),
            pl.col("Close").alias("futures_price"),
            pl.col("Open").alias("futures_open"),
            pl.col("Volume").alias("futures_volume"),
        ])

        joined = options_df.join(
            futures_renamed,
            on="Date",
            how="left",
        )

        return joined

    @staticmethod
    def compute_atm_strike(
        df: pl.DataFrame,
        spot_col: str = "spot_price",
        strike_step: int = 50,
    ) -> pl.DataFrame:
        """
        Compute the ATM (At-The-Money) strike for each row.
        Rounds spot price to nearest strike step.
        """
        return df.with_columns(
            (pl.col(spot_col) / strike_step).round(0).cast(pl.Int64)
            .mul(strike_step)
            .alias("atm_strike")
        )

    @staticmethod
    def compute_moneyness(df: pl.DataFrame) -> pl.DataFrame:
        """
        Compute moneyness for each option row.
        Moneyness = (Strike - Spot) for CE, (Spot - Strike) for PE.
        Positive = OTM, Negative = ITM.
        """
        return df.with_columns(
            pl.when(pl.col("Right") == "CE")
            .then(pl.col("Strike") - pl.col("spot_price"))
            .otherwise(pl.col("spot_price") - pl.col("Strike"))
            .alias("moneyness"),

            pl.when(pl.col("Right") == "CE")
            .then(
                pl.when(pl.col("Strike") > pl.col("spot_price"))
                .then(pl.lit("OTM"))
                .when(pl.col("Strike") < pl.col("spot_price"))
                .then(pl.lit("ITM"))
                .otherwise(pl.lit("ATM"))
            )
            .otherwise(
                pl.when(pl.col("Strike") < pl.col("spot_price"))
                .then(pl.lit("OTM"))
                .when(pl.col("Strike") > pl.col("spot_price"))
                .then(pl.lit("ITM"))
                .otherwise(pl.lit("ATM"))
            )
            .alias("moneyness_type"),
        )

    @staticmethod
    def build_full_dataset(
        options_df: pl.DataFrame,
        index_df: pl.DataFrame,
        futures_df: pl.DataFrame | None = None,
    ) -> pl.DataFrame:
        """
        Build a comprehensive dataset by joining all sources
        and computing derived columns.
        """
        joiner = DataJoiner()

        # Join with index
        df = joiner.join_options_with_index(options_df, index_df)

        # Join with futures if available
        if futures_df is not None and len(futures_df) > 0:
            df = joiner.join_options_with_futures(df, futures_df)

        # Compute derived columns
        df = joiner.compute_atm_strike(df)
        df = joiner.compute_moneyness(df)

        return df
