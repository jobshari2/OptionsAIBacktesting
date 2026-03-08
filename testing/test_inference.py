import pytest
from unittest.mock import MagicMock, patch
import pandas as pd
import numpy as np

from backend.ml_engine.inference import MLEnsemblePredictor

def test_ml_predictor_status():
    predictor = MLEnsemblePredictor()
    # It won't have a model if not trained or using correct path, but normally it starts waiting
    status = predictor.get_status()
    assert status["status"] in ["online", "waiting_for_models"]
    assert "models_loaded" in status

@patch("backend.ml_engine.inference.FeatureBuilder")
@patch("joblib.load")
@patch("pathlib.Path.exists")
def test_predict_success(mock_exists, mock_load, mock_builder_class):
    # Setup mocks
    mock_exists.return_value = True
    
    mock_model = MagicMock()
    # XGBoost output typically a 2D array: [sample][classes]
    # SIDEWAYS=0, UP=1, DOWN=2. So 70% UP.
    mock_model.predict_proba.return_value = np.array([[0.20, 0.70, 0.10]])
    mock_load.return_value = mock_model
    
    mock_builder = MagicMock()
    mock_builder_class.return_value = mock_builder
    
    import polars as pl
    from datetime import datetime
    mock_builder.build_features_for_expiry.return_value = pl.DataFrame({
        "Date": [datetime(2025, 1, 1, 10, 0, 0)],
        "feat_ret_1m": [0.0], "feat_ret_5m": [0.0], "feat_ret_15m": [0.0], 
        "feat_vol_15m": [0.0], "feat_rsi_14m": [50.0], "feat_basis_pct": [0.0], 
        "feat_pcr_vol": [1.0], "feat_pcr_oi": [1.0], 
        "feat_ce_oi_change_5m": [0.0], "feat_pe_oi_change_5m": [0.0]
    })
    
    # Init predictor
    predictor = MLEnsemblePredictor()
    
    # Hack the builder mock to our instance mock
    predictor.builder = mock_builder 
    
    # Run prediction
    res = predictor.predict("DUMMY_EXPIRY", "10:00")
    
    assert "error" not in res
    assert res["prediction_horizon"] == "5m"
    assert res["probabilities"]["UP"] == 0.70
    assert res["probabilities"]["DOWN"] == 0.10
    assert res["probabilities"]["SIDEWAYS"] == 0.20
    assert res["recommended_action"] == "BUY_CALL"
    assert res["confidence"] == 0.70
    # Expected magnitude = (0.70 - 0.10) * 15 = 9.0
    assert res["expected_magnitude_points"] == 9.0

@patch("backend.ml_engine.inference.FeatureBuilder")
@patch("pathlib.Path.exists")
def test_predict_no_model(mock_exists, mock_builder_class):
    mock_exists.return_value = False # Force model skip
    predictor = MLEnsemblePredictor()
    
    res = predictor.predict("DUMMY_EXPIRY", "10:00")
    assert "error" in res
    assert "Models not loaded" in res["error"]
