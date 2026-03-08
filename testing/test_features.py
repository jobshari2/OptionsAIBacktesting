import pytest
import polars as pl
from unittest.mock import MagicMock, patch
import numpy as np

from backend.ml_engine.features import FeatureBuilder

@pytest.fixture
def mock_loader():
    loader = MagicMock()
    
    # Mock data
    def load_all_mock(expiry, use_unified=True):
        # Create dummy df
        dates = pl.datetime_range(
            start=pl.datetime(2025, 1, 1, 9, 15), 
            end=pl.datetime(2025, 1, 1, 15, 30), 
            interval="1m", 
            eager=True
        ).alias("Date")
        
        # Spot dummy
        idx_df = pl.DataFrame({
            "Date": dates,
            "Close": [20000.0 + i for i in range(len(dates))],
            "Volume": [100.0 for _ in range(len(dates))]
        })
        
        # Futures dummy
        fut_df = pl.DataFrame({
            "Date": dates,
            "Close": [20050.0 + i for i in range(len(dates))]
        })
        
        # Options dummy (need CE and PE rows)
        opt_dates = []
        rights = []
        volumes = []
        ois = []
        for d in dates:
            # CE row
            opt_dates.append(d)
            rights.append("CE")
            volumes.append(500)
            ois.append(1000)
            
            # PE row
            opt_dates.append(d)
            rights.append("PE")
            volumes.append(400)
            ois.append(1200)
            
        opt_df = pl.DataFrame({
            "Date": opt_dates,
            "Right": rights,
            "Volume": volumes,
            "OI": ois,
            "Strike": [20000 for _ in range(len(opt_dates))]
        })
        
        return {
            "index": idx_df,
            "futures": fut_df,
            "options": opt_df
        }
        
    loader.load_all_for_expiry = load_all_mock
    return loader

def test_feature_builder_pipeline(mock_loader):
    builder = FeatureBuilder(loader=mock_loader)
    
    # Run the feature pipeline
    df = builder.build_features_for_expiry("DUMMY_EXPIRY")
    
    # Check it generated a dataframe
    assert df is not None
    assert isinstance(df, pl.DataFrame)
    
    # It drops nulls initially, so there should be fewer rows than original dates (length was ~376 minutes)
    assert len(df) > 0
    assert len(df) < 376
    
    # Check important columns exist
    expected_cols = [
        "Date", "spot_close", "feat_ret_1m", "feat_vol_15m", "feat_rsi_14m", 
        "feat_basis_pct", "feat_pcr_vol", "feat_pcr_oi", "feat_ce_oi_change_5m",
        "target_return_5m", "target_class_5m"
    ]
    for col in expected_cols:
        assert col in df.columns
        
    # Check PCR logic (PE / CE)
    # in dummy data, CE Vol=500, PE Vol=400, so PCR Vol = 400/501 ~ 0.798
    pcr_vol = df["feat_pcr_vol"][0]
    assert 0.75 < pcr_vol < 0.85
    
    # Check basis logic: Future - Spot / Spot
    # spot=20000+i, fut=20050+i. Diff = 50. 50/20000 = 0.0025 -> 0.25%
    basis = df["feat_basis_pct"][0]
    assert 0.2 < basis < 0.3
