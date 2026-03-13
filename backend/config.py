"""
Central configuration for the Nifty Options Backtesting Platform.
"""
from pathlib import Path
import os
from pydantic import BaseModel
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()


class DataConfig(BaseModel):
    """Data source configuration."""
    base_path: str = r"D:\NSE Data\Options\NIFTY\parquet"
    unified_base_path: str = r"D:\NSE Data\Options\NIFTY\parquet_unified"
    use_unified: bool = True  # Toggle to prefer unified files if they exist
    options_filename: str = "NIFTY_Options_1minute.parquet"
    futures_filename: str = "NIFTY_FUTURES_1minute.parquet"
    index_filename: str = "NIFTY_Index_1minute.parquet"
    unified_filename: str = "NIFTY_Unified_1minute.parquet"
    cache_max_size: int = 50  # Max number of expiries to cache in memory


class BreezeConfig(BaseModel):
    """ICICI Breeze API configuration."""
    app_key: str = os.getenv("BREEZE_APP_KEY", "")
    secret_key: str = os.getenv("BREEZE_SECRET_KEY", "")
    token_path: str = "backend/api/breeze/breeze_token.json"


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
    api_key: str = os.getenv("GEMINI_API_KEY", "")
    max_iterations: int = 50
    initial_points: int = 10
    exploration_factor: float = 0.1
    learning_history_path: str = "ai_learning/learning_history.json"
    strategy_evolution_path: str = "ai_learning/strategy_evolution.json"
    parameter_changes_path: str = "ai_learning/parameter_changes.json"


class IntelligenceConfig(BaseModel):
    """Intelligent strategy engine configuration."""
    # Regime detection thresholds (rule-based labelling)
    atr_low_threshold: float = 30.0
    momentum_threshold: float = 0.15
    vol_high_threshold: float = 0.25
    vol_low_threshold: float = 0.12
    trend_strength_threshold: float = 0.3
    # Meta controller settings
    regime_check_interval: int = 15         # Minutes between regime checks
    min_switch_confidence: float = 0.6      # Min confidence for mid-expiry switch
    switch_cooldown_minutes: int = 30       # Cooldown after a switch
    auto_train: bool = True                 # Auto-train ML model from history
    # Feature engine settings
    vol_window: int = 20
    atr_window: int = 14
    ema_window: int = 20
    momentum_window: int = 10
    volume_spike_multiplier: float = 2.0
    # ML model settings
    n_estimators: int = 100
    regime_model_path: str = "ai_learning/regime_model.pkl"
    trade_memory_path: str = "ai_learning/trade_memory.parquet"


class AppConfig(BaseModel):
    """Top-level application configuration."""
    data: DataConfig = DataConfig()
    backtest: BacktestConfig = BacktestConfig()
    ai: AIConfig = AIConfig()
    intelligence: IntelligenceConfig = IntelligenceConfig()
    breeze: BreezeConfig = BreezeConfig()
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
