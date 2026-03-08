"""
Training script for the Baseline XGBoost Model.
Predicts short-term option price movement.
"""
import polars as pl
import xgboost as xgb
from sklearn.metrics import classification_report, accuracy_score
import joblib
from pathlib import Path

from backend.logger import logger

class XGBoostTrainer:
    def __init__(self):
        self.data_dir = Path("data/ml_datasets")
        self.model_dir = Path("assets/models")
        self.model_dir.mkdir(parents=True, exist_ok=True)
        
        self.features = [
            'feat_ret_1m', 'feat_ret_5m', 'feat_ret_15m', 
            'feat_vol_15m', 'feat_rsi_14m', 'feat_basis_pct', 
            'feat_pcr_vol', 'feat_pcr_oi', 
            'feat_ce_oi_change_5m', 'feat_pe_oi_change_5m'
        ]
        self.target = 'target_class_5m'
        
    def load_data(self):
        logger.info("Loading datasets...")
        train_df = pl.read_parquet(self.data_dir / "train_dataset.parquet")
        test_df = pl.read_parquet(self.data_dir / "test_dataset.parquet")
        
        # Convert to pandas for sklearn/xgboost native compatibility
        X_train = train_df.select(self.features).to_pandas()
        y_train = train_df.select(self.target).to_pandas().values.ravel()
        
        X_test = test_df.select(self.features).to_pandas()
        y_test = test_df.select(self.target).to_pandas().values.ravel()
        
        return X_train, X_test, y_train, y_test
        
    def train(self):
        X_train, X_test, y_train, y_test = self.load_data()
        
        logger.info(f"Training XGBoost classifier on {len(X_train)} samples...")
        model = xgb.XGBClassifier(
            objective='multi:softprob',
            num_class=3,
            eval_metric='mlogloss',
            learning_rate=0.05,
            max_depth=6,
            n_estimators=100,
            subsample=0.8,
            colsample_bytree=0.8,
            random_state=42
        )
        
        model.fit(
            X_train, y_train,
            eval_set=[(X_train, y_train), (X_test, y_test)],
            verbose=10
        )
        
        logger.info("Evaluating model on test set...")
        y_pred = model.predict(X_test)
        
        acc = accuracy_score(y_test, y_pred)
        logger.info(f"Test Accuracy: {acc:.4f}")
        print("\nClassification Report:")
        print(classification_report(y_test, y_pred, target_names=["SIDEWAYS", "UP", "DOWN"]))
        
        # Save model
        model_path = self.model_dir / "xgb_baseline.joblib"
        joblib.dump(model, model_path)
        logger.info(f"Model saved to {model_path}")
        
        return model

if __name__ == "__main__":
    trainer = XGBoostTrainer()
    trainer.train()
