"""
Experience Memory — high-performance Parquet-based trade memory store
for the intelligent strategy engine. Stores every meta-strategy trade
result with regime, features, and performance data.
"""
import polars as pl
from pathlib import Path
from datetime import datetime
from typing import Optional

from backend.config import get_ai_learning_dir
from backend.logger import logger


class ExperienceMemory:
    """
    Parquet-based trade memory for the intelligent strategy engine.

    Stores trade results with associated regime, features, and parameters.
    Enables fast analytical queries for strategy ranking and learning.

    File: ai_learning/trade_memory.parquet

    Columns:
        timestamp, expiry, regime, regime_confidence, strategy_name,
        pnl, drawdown, entry_time, exit_time, exit_reason,
        realized_volatility, atr, momentum, trend_strength,
        iv_percentile, iv_skew, put_call_ratio, oi_change,
        volume_spike, vwap_distance, was_switch, switch_from
    """

    SCHEMA = {
        "timestamp": pl.Utf8,
        "expiry": pl.Utf8,
        "regime": pl.Utf8,
        "regime_confidence": pl.Float64,
        "strategy_name": pl.Utf8,
        "pnl": pl.Float64,
        "drawdown": pl.Float64,
        "entry_time": pl.Utf8,
        "exit_time": pl.Utf8,
        "exit_reason": pl.Utf8,
        "realized_volatility": pl.Float64,
        "atr": pl.Float64,
        "momentum": pl.Float64,
        "trend_strength": pl.Float64,
        "iv_percentile": pl.Float64,
        "iv_skew": pl.Float64,
        "put_call_ratio": pl.Float64,
        "oi_change": pl.Float64,
        "volume_spike": pl.Float64,
        "vwap_distance": pl.Float64,
        "was_switch": pl.Boolean,
        "switch_from": pl.Utf8,
    }

    def __init__(self, base_dir: Path | None = None):
        self.base_dir = base_dir or get_ai_learning_dir()
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.memory_file = self.base_dir / "trade_memory.parquet"

    def store(self, trade_result: dict) -> None:
        """
        Append a trade result to the experience memory.

        Args:
            trade_result: Dict with keys matching the SCHEMA columns.
                          Missing keys will be filled with defaults.
        """
        # Fill defaults
        record = {
            "timestamp": datetime.now().isoformat(),
            "expiry": "",
            "regime": "UNKNOWN",
            "regime_confidence": 0.0,
            "strategy_name": "",
            "pnl": 0.0,
            "drawdown": 0.0,
            "entry_time": "",
            "exit_time": "",
            "exit_reason": "",
            "realized_volatility": 0.0,
            "atr": 0.0,
            "momentum": 0.0,
            "trend_strength": 0.0,
            "iv_percentile": 50.0,
            "iv_skew": 0.0,
            "put_call_ratio": 1.0,
            "oi_change": 0.0,
            "volume_spike": 0.0,
            "vwap_distance": 0.0,
            "was_switch": False,
            "switch_from": "",
        }
        record.update(trade_result)

        new_row = pl.DataFrame([record], schema=self.SCHEMA)

        if self.memory_file.exists():
            try:
                existing = pl.read_parquet(self.memory_file)
                combined = pl.concat([existing, new_row], how="vertical_relaxed")
            except Exception as e:
                logger.warning(f"ExperienceMemory: error reading existing file, overwriting: {e}")
                combined = new_row
        else:
            combined = new_row

        combined.write_parquet(self.memory_file)
        logger.info(f"ExperienceMemory: stored trade — {record['strategy_name']} "
                     f"regime={record['regime']} pnl={record['pnl']:.2f}")

    def store_batch(self, trade_results: list[dict]) -> None:
        """Store multiple trade results at once (more efficient)."""
        if not trade_results:
            return

        records = []
        for tr in trade_results:
            record = {
                "timestamp": datetime.now().isoformat(),
                "expiry": "", "regime": "UNKNOWN", "regime_confidence": 0.0,
                "strategy_name": "", "pnl": 0.0, "drawdown": 0.0,
                "entry_time": "", "exit_time": "", "exit_reason": "",
                "realized_volatility": 0.0, "atr": 0.0, "momentum": 0.0,
                "trend_strength": 0.0, "iv_percentile": 50.0, "iv_skew": 0.0,
                "put_call_ratio": 1.0, "oi_change": 0.0, "volume_spike": 0.0,
                "vwap_distance": 0.0, "was_switch": False, "switch_from": "",
            }
            record.update(tr)
            records.append(record)

        new_rows = pl.DataFrame(records, schema=self.SCHEMA)

        if self.memory_file.exists():
            try:
                existing = pl.read_parquet(self.memory_file)
                combined = pl.concat([existing, new_rows], how="vertical_relaxed")
            except Exception:
                combined = new_rows
        else:
            combined = new_rows

        combined.write_parquet(self.memory_file)
        logger.info(f"ExperienceMemory: batch stored {len(records)} trades")

    def load(
        self,
        strategy: Optional[str] = None,
        regime: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> pl.DataFrame:
        """
        Query experience memory with optional filters.

        Args:
            strategy: Filter by strategy name
            regime: Filter by regime
            limit: Max number of records to return (most recent)
        """
        if not self.memory_file.exists():
            return pl.DataFrame(schema=self.SCHEMA)

        df = pl.read_parquet(self.memory_file)

        if strategy:
            df = df.filter(pl.col("strategy_name") == strategy)

        if regime:
            df = df.filter(pl.col("regime") == regime)

        if limit:
            df = df.tail(limit)

        return df

    def get_strategy_performance(self, regime: Optional[str] = None) -> dict:
        """
        Get performance summary per strategy, optionally filtered by regime.

        Returns:
            Dict with strategy names as keys, each containing:
                total_trades, total_pnl, avg_pnl, win_rate, avg_confidence
        """
        df = self.load(regime=regime)
        if len(df) == 0:
            return {}

        result = {}
        for strategy_name in df["strategy_name"].unique().to_list():
            strat_df = df.filter(pl.col("strategy_name") == strategy_name)
            pnls = strat_df["pnl"].to_list()
            wins = sum(1 for p in pnls if p > 0)

            result[strategy_name] = {
                "total_trades": len(pnls),
                "total_pnl": float(sum(pnls)),
                "avg_pnl": float(sum(pnls) / len(pnls)) if pnls else 0.0,
                "win_rate": float(wins / len(pnls) * 100) if pnls else 0.0,
                "avg_confidence": float(strat_df["regime_confidence"].mean()),
            }

        return result

    def get_best_strategy_for_regime(self, regime: str) -> Optional[str]:
        """
        Get the best historically performing strategy for a given regime.
        Based on average PnL.

        Returns:
            Strategy name string, or None if no data.
        """
        perf = self.get_strategy_performance(regime=regime)
        if not perf:
            return None

        best = max(perf.items(), key=lambda x: x[1]["avg_pnl"])
        return best[0]

    def get_feature_history(self) -> list[dict]:
        """
        Extract feature vectors from stored trades for ML model training.
        """
        df = self.load()
        if len(df) == 0:
            return []

        feature_cols = [
            "realized_volatility", "atr", "momentum", "trend_strength",
            "iv_percentile", "iv_skew", "put_call_ratio", "oi_change",
            "volume_spike", "vwap_distance",
        ]

        available = [c for c in feature_cols if c in df.columns]
        return df.select(available).to_dicts()

    def get_summary(self) -> dict:
        """Get overall experience memory summary."""
        df = self.load()
        if len(df) == 0:
            return {
                "total_trades": 0,
                "unique_strategies": 0,
                "unique_regimes": 0,
                "total_pnl": 0.0,
                "switches": 0,
            }

        return {
            "total_trades": len(df),
            "unique_strategies": df["strategy_name"].n_unique(),
            "unique_regimes": df["regime"].n_unique(),
            "total_pnl": float(df["pnl"].sum()),
            "switches": int(df.filter(pl.col("was_switch") == True)["was_switch"].sum()),
            "regime_distribution": df.group_by("regime").len().to_dicts(),
            "strategy_distribution": df.group_by("strategy_name").len().to_dicts(),
        }

    def clear(self) -> None:
        """Clear all experience memory."""
        if self.memory_file.exists():
            self.memory_file.unlink()
            logger.info("ExperienceMemory: cleared all data")
