"""
DuckDB storage layer — schema and CRUD operations for backtest data.
"""
import duckdb
import json
from pathlib import Path
from datetime import datetime
from typing import Optional

from backend.config import get_db_path


class Database:
    """DuckDB database for storing backtest results and strategy data."""

    def __init__(self, db_path: str | Path | None = None):
        self.db_path = str(db_path or get_db_path())
        self._conn = None
        self._init_schema()

    @property
    def conn(self) -> duckdb.DuckDBPyConnection:
        if self._conn is None:
            self._conn = duckdb.connect(self.db_path)
        return self._conn

    def _init_schema(self):
        """Create database schema if it doesn't exist."""
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS strategies (
                id VARCHAR PRIMARY KEY,
                name VARCHAR NOT NULL,
                description VARCHAR,
                config JSON,
                tags JSON,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS backtest_runs (
                run_id VARCHAR PRIMARY KEY,
                strategy_name VARCHAR NOT NULL,
                start_date VARCHAR,
                end_date VARCHAR,
                total_expiries INTEGER,
                total_trades INTEGER,
                total_pnl DOUBLE,
                win_rate DOUBLE,
                sharpe_ratio DOUBLE,
                sortino_ratio DOUBLE,
                max_drawdown_pct DOUBLE,
                profit_factor DOUBLE,
                initial_capital DOUBLE,
                final_capital DOUBLE,
                parameters JSON,
                execution_time_ms DOUBLE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS trades (
                trade_id VARCHAR PRIMARY KEY,
                run_id VARCHAR,
                strategy_name VARCHAR,
                expiry VARCHAR,
                entry_time VARCHAR,
                exit_time VARCHAR,
                entry_premium DOUBLE,
                exit_premium DOUBLE,
                pnl DOUBLE,
                pnl_points DOUBLE,
                exit_reason VARCHAR,
                transaction_costs DOUBLE,
                slippage_cost DOUBLE,
                spot_at_entry DOUBLE,
                spot_at_exit DOUBLE,
                legs JSON,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS expiry_results (
                id INTEGER,
                run_id VARCHAR,
                expiry VARCHAR,
                folder VARCHAR,
                num_trades INTEGER,
                pnl DOUBLE,
                status VARCHAR,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS ai_learning (
                id INTEGER,
                strategy_name VARCHAR,
                expiry VARCHAR,
                parameters JSON,
                results JSON,
                improvements JSON,
                generation INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Create sequences for auto-increment
        try:
            self.conn.execute("CREATE SEQUENCE IF NOT EXISTS seq_expiry_results START 1")
            self.conn.execute("CREATE SEQUENCE IF NOT EXISTS seq_ai_learning START 1")
        except Exception:
            pass

    def save_backtest_run(self, result_data: dict):
        """Save a backtest run result."""
        metrics = result_data.get("metrics", {})
        self.conn.execute("""
            INSERT OR REPLACE INTO backtest_runs
            (run_id, strategy_name, start_date, end_date, total_expiries,
             total_trades, total_pnl, win_rate, sharpe_ratio, sortino_ratio,
             max_drawdown_pct, profit_factor, initial_capital, final_capital,
             parameters, execution_time_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [
            result_data["run_id"],
            result_data["strategy_name"],
            result_data.get("start_date"),
            result_data.get("end_date"),
            result_data.get("total_expiries", 0),
            result_data.get("total_trades", 0),
            result_data.get("total_pnl", 0),
            metrics.get("win_rate", 0),
            metrics.get("sharpe_ratio", 0),
            metrics.get("sortino_ratio", 0),
            metrics.get("max_drawdown", {}).get("max_drawdown_pct", 0),
            metrics.get("profit_factor", 0),
            result_data.get("initial_capital", 1000000),
            result_data.get("final_capital", 1000000),
            json.dumps(result_data.get("parameters", {})),
            result_data.get("execution_time_ms", 0),
        ])

    def save_trades(self, run_id: str, trades: list[dict]):
        """Save trades for a backtest run."""
        for trade in trades:
            self.conn.execute("""
                INSERT OR REPLACE INTO trades
                (trade_id, run_id, strategy_name, expiry, entry_time, exit_time,
                 entry_premium, exit_premium, pnl, pnl_points, exit_reason,
                 transaction_costs, slippage_cost, spot_at_entry, spot_at_exit, legs)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                trade["trade_id"],
                run_id,
                trade.get("strategy_name", ""),
                trade.get("expiry", ""),
                trade.get("entry_time", ""),
                trade.get("exit_time", ""),
                trade.get("entry_premium", 0),
                trade.get("exit_premium", 0),
                trade.get("pnl", 0),
                trade.get("pnl_points", 0),
                trade.get("exit_reason", ""),
                trade.get("transaction_costs", 0),
                trade.get("slippage_cost", 0),
                trade.get("spot_at_entry", 0),
                trade.get("spot_at_exit", 0),
                json.dumps(trade.get("legs", [])),
            ])

    def get_backtest_runs(self, limit: int = 50) -> list[dict]:
        """Get recent backtest runs."""
        result = self.conn.execute("""
            SELECT * FROM backtest_runs
            ORDER BY created_at DESC
            LIMIT ?
        """, [limit]).fetchall()

        columns = [desc[0] for desc in self.conn.description]
        return [dict(zip(columns, row)) for row in result]

    def get_backtest_run(self, run_id: str) -> dict | None:
        """Get a specific backtest run."""
        result = self.conn.execute(
            "SELECT * FROM backtest_runs WHERE run_id = ?",
            [run_id],
        ).fetchone()

        if result is None:
            return None

        columns = [desc[0] for desc in self.conn.description]
        return dict(zip(columns, result))

    def get_trades_for_run(self, run_id: str) -> list[dict]:
        """Get all trades for a specific run."""
        result = self.conn.execute(
            "SELECT * FROM trades WHERE run_id = ? ORDER BY entry_time",
            [run_id],
        ).fetchall()

        columns = [desc[0] for desc in self.conn.description]
        return [dict(zip(columns, row)) for row in result]

    def close(self):
        """Close database connection."""
        if self._conn:
            self._conn.close()
            self._conn = None


# Singleton database instance
_db_instance: Database | None = None


def get_database() -> Database:
    """Get or create the singleton database instance."""
    global _db_instance
    if _db_instance is None:
        _db_instance = Database()
    return _db_instance
