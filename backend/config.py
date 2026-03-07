"""
Central configuration for the Nifty Options Backtesting Platform.
"""
from pathlib import Path
from pydantic import BaseModel


class DataConfig(BaseModel):
    """Data source configuration."""
    base_path: str = r"D:\NSE Data\Options\NIFTY\parquet"
    options_filename: str = "NIFTY_Options_1minute.parquet"
    futures_filename: str = "NIFTY_FUTURES_1minute.parquet"
    index_filename: str = "NIFTY_Index_1minute.parquet"
    cache_max_size: int = 50  # Max number of expiries to cache in memory


class BacktestConfig(BaseModel):
    """Backtesting engine configuration."""
    default_slippage_pct: float = 0.05  # 0.05% slippage
    default_slippage_fixed: float = 0.5  # Rs 0.50 per unit
    default_transaction_cost: float = 20.0  # Rs 20 per order
    default_lot_size: int = 25  # NIFTY lot size (current)
    trading_start_time: str = "09:15"
    trading_end_time: str = "15:30"
    default_exit_time: str = "15:15"


class AIConfig(BaseModel):
    """AI optimizer configuration."""
    max_iterations: int = 50
    initial_points: int = 10
    exploration_factor: float = 0.1
    learning_history_path: str = "ai_learning/learning_history.json"
    strategy_evolution_path: str = "ai_learning/strategy_evolution.json"
    parameter_changes_path: str = "ai_learning/parameter_changes.json"


class AppConfig(BaseModel):
    """Top-level application configuration."""
    data: DataConfig = DataConfig()
    backtest: BacktestConfig = BacktestConfig()
    ai: AIConfig = AIConfig()
    db_path: str = "data/backtesting.duckdb"
    strategies_dir: str = "strategies"
    host: str = "0.0.0.0"
    port: int = 8000


# Global config instance
config = AppConfig()


def get_project_root() -> Path:
    """Get the project root directory."""
    return Path(__file__).parent.parent


def get_data_path() -> Path:
    """Get the data base path."""
    return Path(config.data.base_path)


def get_db_path() -> Path:
    """Get the DuckDB database path."""
    root = get_project_root()
    db_path = root / config.db_path
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return db_path


def get_strategies_dir() -> Path:
    """Get the strategies directory path."""
    return get_project_root() / config.strategies_dir


def get_ai_learning_dir() -> Path:
    """Get the AI learning directory path."""
    path = get_project_root() / "ai_learning"
    path.mkdir(parents=True, exist_ok=True)
    return path
