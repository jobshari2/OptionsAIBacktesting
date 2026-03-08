import pytest
from unittest.mock import MagicMock, patch
import polars as pl
from datetime import datetime
from backend.backtester.engine import BacktestEngine
from backend.strategy_engine.base_strategy import Strategy, StrategyLeg, Direction, OptionRight

@pytest.fixture
def mock_ml_strategy():
    strategy = Strategy(name="ml_test_strategy")
    strategy.legs.append(StrategyLeg(direction=Direction.BUY, right=OptionRight.CE))
    strategy.entry.entry_time = "10:00"
    strategy.exit.exit_time = "10:30"
    strategy.entry.ml_prediction_direction = "UP"
    strategy.entry.ml_prediction_threshold = 0.60
    return strategy

@patch("backend.backtester.engine.TradeSimulator")
@patch("backend.backtester.engine.DataLoader")
@patch("backend.backtester.engine.ExpiryDiscovery")
@patch("backend.backtester.engine.MLEnsemblePredictor")
def test_backtest_with_ml_conditions(mock_predictor_class, mock_discovery, mock_loader, mock_sim, mock_ml_strategy):
    mock_predictor = MagicMock()
    mock_predictor.is_ready.return_value = True
    
    # Return mock features
    mock_features = pl.DataFrame({
        "Date": [datetime(2025, 1, 1, 10, 0, 0)],
        "feat_ret_1m": [0.0], "feat_ret_5m": [0.0], "feat_ret_15m": [0.0], 
        "feat_vol_15m": [0.0], "feat_rsi_14m": [50.0], "feat_basis_pct": [0.0], 
        "feat_pcr_vol": [1.0], "feat_pcr_oi": [1.0], 
        "feat_ce_oi_change_5m": [0.0], "feat_pe_oi_change_5m": [0.0]
    })
    mock_predictor.builder.build_features_for_expiry.return_value = mock_features
    mock_predictor.features = [col for col in mock_features.columns if col != "Date"]
    mock_predictor.xgb_model.predict_proba.return_value = [[0.1, 0.7, 0.2]]
    mock_predictor_class.return_value = mock_predictor
    
    engine = BacktestEngine()
    
    opt_df = pl.DataFrame({
        "Date": [datetime(2025, 1, 1, 10, 0, 0), datetime(2025, 1, 1, 10, 30, 0)],
        "Strike": [20000, 20000], "Right": ["CE", "CE"], "Close": [100.0, 150.0], "Volume": [100, 100]
    })
    idx_df = pl.DataFrame({
        "Date": [datetime(2025, 1, 1, 10, 0, 0), datetime(2025, 1, 1, 10, 30, 0)],
        "Close": [20000.0, 20050.0]
    })
    engine.data_loader.load_options.return_value = opt_df
    engine.data_loader.load_index.return_value = idx_df
    
    engine.simulator.simulate_entry.return_value = ([
        {"strike": 20000, "right": OptionRight.CE, "direction": Direction.BUY, "quantity": 1, "current_price": 100.0, "ltp": 100.0}
    ], 0.0, 0.0)
    engine.simulator.simulate_exit.return_value = ([], 0.0, 0.0)
    
    res = engine._run_single_expiry(mock_ml_strategy, "DUMMY_EXP", "2025-01-01")
    
    assert "trades" in res
    assert len(res["trades"]) > 0 

@patch("backend.backtester.engine.TradeSimulator")
@patch("backend.backtester.engine.DataLoader")
@patch("backend.backtester.engine.ExpiryDiscovery")
@patch("backend.backtester.engine.MLEnsemblePredictor")
def test_backtest_with_ml_conditions_failed_threshold(mock_predictor_class, mock_discovery, mock_loader, mock_sim, mock_ml_strategy):
    mock_predictor = MagicMock()
    mock_predictor.is_ready.return_value = True
    
    mock_features = pl.DataFrame({
        "Date": [datetime(2025, 1, 1, 10, 0, 0)],
        "feat_ret_1m": [0.0], "feat_ret_5m": [0.0], "feat_ret_15m": [0.0], 
        "feat_vol_15m": [0.0], "feat_rsi_14m": [50.0], "feat_basis_pct": [0.0], 
        "feat_pcr_vol": [1.0], "feat_pcr_oi": [1.0], 
        "feat_ce_oi_change_5m": [0.0], "feat_pe_oi_change_5m": [0.0]
    })
    mock_predictor.builder.build_features_for_expiry.return_value = mock_features
    mock_predictor.features = [col for col in mock_features.columns if col != "Date"]
    mock_predictor.xgb_model.predict_proba.return_value = [[0.1, 0.4, 0.5]]
    mock_predictor_class.return_value = mock_predictor
    
    engine = BacktestEngine()
    
    opt_df = pl.DataFrame({
        "Date": [datetime(2025, 1, 1, 10, 0, 0), datetime(2025, 1, 1, 10, 30, 0)],
        "Strike": [20000, 20000], "Right": ["CE", "CE"], "Close": [100.0, 150.0], "Volume": [100, 100]
    })
    idx_df = pl.DataFrame({
        "Date": [datetime(2025, 1, 1, 10, 0, 0), datetime(2025, 1, 1, 10, 30, 0)],
        "Close": [20000.0, 20050.0]
    })
    engine.data_loader.load_options.return_value = opt_df
    engine.data_loader.load_index.return_value = idx_df
    
    res = engine._run_single_expiry(mock_ml_strategy, "DUMMY_EXP", "2025-01-01")
    
    assert "trades" in res
    assert len(res["trades"]) == 0 
