"""
Data Preparation pipeline for ML models.
Combines features from multiple expiries into train/val/test datasets.
"""
import polars as pl
from pathlib import Path
import os
import random

from backend.ml_engine.features import FeatureBuilder
from backend.data_engine.expiry_discovery import ExpiryDiscovery
from backend.logger import logger
from backend.config import config

class DatasetGenerator:
    def __init__(self):
        self.builder = FeatureBuilder()
        self.discovery = ExpiryDiscovery()
        self.output_dir = Path("data/ml_datasets")
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
    def generate_datasets(self, num_expiries: int = 50, test_split: float = 0.2):
        """
        Builds and saves train and test parquet files.
        """
        all_expiries = self.discovery.get_expiry_folders()
        if not all_expiries:
            logger.error("No expiries found.")
            return
            
        # For a robust backtest, we should split chronologically.
        # all_expiries is already sorted by date in ExpiryDiscovery.
        selected = all_expiries[-min(num_expiries, len(all_expiries)):]
        
        split_idx = int(len(selected) * (1 - test_split))
        train_expiries = selected[:split_idx]
        test_expiries = selected[split_idx:]
        
        logger.info(f"Generating training set from {len(train_expiries)} expiries...")
        train_df = self._process_batch(train_expiries)
        if train_df is not None:
            train_path = self.output_dir / "train_dataset.parquet"
            train_df.write_parquet(train_path)
            logger.info(f"Saved Train DB: {train_path} ({len(train_df)} rows)")
            
        logger.info(f"Generating test set from {len(test_expiries)} expiries...")
        test_df = self._process_batch(test_expiries)
        if test_df is not None:
            test_path = self.output_dir / "test_dataset.parquet"
            test_df.write_parquet(test_path)
            logger.info(f"Saved Test DB: {test_path} ({len(test_df)} rows)")

    def _process_batch(self, expiries: list[str]) -> pl.DataFrame | None:
        dfs = []
        for exp in expiries:
            df = self.builder.build_features_for_expiry(exp)
            if df is not None and not df.is_empty():
                # Add expiry identifier just in case
                df = df.with_columns(pl.lit(exp).alias("expiry"))
                dfs.append(df)
                
        if not dfs:
            return None
            
        return pl.concat(dfs)

if __name__ == "__main__":
    generator = DatasetGenerator()
    # For initial testing, just use 10 expiries
    generator.generate_datasets(num_expiries=10, test_split=0.2)
