"""
Inference engine for Option Price Predictor.
Loads trained models and runs live prediction.
"""
import joblib
import polars as pl
from pathlib import Path
from typing import Dict, Any, Optional

from backend.ml_engine.features import FeatureBuilder
from backend.logger import logger

class MLEnsemblePredictor:
    def __init__(self):
        self.model_dir = Path("assets/models")
        self.xgb_model_path = self.model_dir / "xgb_baseline.joblib"
        self.xgb_model = None
        self.features = [
            'feat_ret_1m', 'feat_ret_5m', 'feat_ret_15m', 
            'feat_vol_15m', 'feat_rsi_14m', 'feat_basis_pct', 
            'feat_pcr_vol', 'feat_pcr_oi', 
            'feat_ce_oi_change_5m', 'feat_pe_oi_change_5m'
        ]
        self.builder = FeatureBuilder()
        self._load_models()
        
    def _load_models(self):
        """Loads all available models from disk."""
        if self.xgb_model_path.exists():
            try:
                self.xgb_model = joblib.load(self.xgb_model_path)
                logger.info("Loaded XGBoost Baseline model.")
            except Exception as e:
                logger.error(f"Failed to load XGBoost model: {e}")
        else:
            logger.warning(f"XGBoost model not found at {self.xgb_model_path}")

    def is_ready(self) -> bool:
        return self.xgb_model is not None

    def get_status(self) -> Dict[str, Any]:
        return {
            "status": "online" if self.is_ready() else "waiting_for_models",
            "models_loaded": ["xgb_baseline"] if self.xgb_model else [],
        }

    def predict(self, expiry: str, timestamp_str: str, use_unified: bool = True) -> Dict[str, Any]:
        """
        Runs full feature pipeline for the expiry up to the timestamp,
        then runs the ensemble prediction on the last feature row.
        """
        if not self.is_ready():
            return {
                "error": "Models not loaded. Train the models first."
            }
            
        logger.info(f"Running ML Prediction for {expiry} at {timestamp_str}...")
        
        # 1. Build features. In production, this would be highly optimized or streaming.
        # For now, we build features for the whole expiry and slice to the timestamp.
        df = self.builder.build_features_for_expiry(expiry)
        if df is None or df.is_empty():
            return {"error": "Failed to generate features for expiry"}
            
        # Parse timestamp string (HH:MM) to matching Date
        # Provide a format string so Polars knows how to parse it correctly
        target_time = pl.Series([timestamp_str]).str.to_time("%H:%M")[0]
        
        # Find the row corresponding to this time
        # The Date column is datetime, we need to extract time
        row_df = df.filter(pl.col("Date").dt.time() <= target_time).tail(1)
        
        if row_df.is_empty():
            return {"error": f"No data available at or before {timestamp_str}"}
            
        # 2. Extract features
        try:
            X = row_df.select(self.features).to_pandas()
        except pl.exceptions.ColumnNotFoundError as e:
            return {"error": f"Missing features: {e}"}
            
        # 3. Predict
        # XGBoost output is usually [P(0), P(1), P(2)] 
        # based on training classes: 0: SIDEWAYS, 1: UP, 2: DOWN
        probs = self.xgb_model.predict_proba(X)[0]
        
        p_sideways = float(probs[0])
        p_up = float(probs[1])
        p_down = float(probs[2])
        
        # Create recommendation
        rec = "HOLD"
        if p_up > 0.65:
            rec = "BUY_CALL"
        elif p_down > 0.65:
            rec = "BUY_PUT"
            
        return {
            "expiry": expiry,
            "timestamp": timestamp_str,
            "prediction_horizon": "5m",
            "probabilities": {
                "SIDEWAYS": round(p_sideways, 4),
                "UP": round(p_up, 4),
                "DOWN": round(p_down, 4),
            },
            "expected_magnitude_points": round((p_up - p_down) * 15.0, 1), # Naive estimation for MVP
            "confidence": round(max(p_up, p_down, p_sideways), 4),
            "recommended_action": rec
        }

    def predict_historical(self, expiry: str) -> Dict[str, Any]:
        """
        Runs the feature pipeline and generates predictions for every 15-minute interval
        over the days leading up to the expiry.
        """
        if not self.is_ready():
            return {"error": "Models not loaded. Train the models first."}
            
        logger.info(f"Running Historical ML Prediction for {expiry}...")
        
        df = self.builder.build_features_for_expiry(expiry)
        if df is None or df.is_empty():
            return {"error": "Failed to generate features for expiry"}
            
        # Sample every 15 minutes: 09:30, 09:45, ... 15:15
        sampled_df = df.filter(pl.col("Date").dt.minute() % 15 == 0)
        
        if sampled_df.is_empty():
            return {"error": "No data available after sampling"}
            
        # Extract features and predict
        try:
            X = sampled_df.select(self.features).to_pandas()
        except pl.exceptions.ColumnNotFoundError as e:
            return {"error": f"Missing features: {e}"}
            
        probs = self.xgb_model.predict_proba(X)
        
        # Convert to dictionary format
        results = []
        date_series = sampled_df["Date"].to_list()
        spot_series = sampled_df["spot_close"].to_list()
        target_series = sampled_df["target_class_5m"].to_list()
        
        class_map = {0: "SIDEWAYS", 1: "UP", 2: "DOWN"}
        
        for i in range(len(date_series)):
            dt = date_series[i]
            p_sideways = float(probs[i][0])
            p_up = float(probs[i][1])
            p_down = float(probs[i][2])
            
            target_class_idx = target_series[i]
            # Handle possible nulls or float targets safely
            if target_class_idx is not None and not pl.Series([target_class_idx]).is_null()[0]:
                actual_move = class_map.get(int(target_class_idx), "UNKNOWN")
            else:
                actual_move = "UNKNOWN"
            
            # Format datetime
            dt_str = dt.strftime("%d/%m/%Y %H:%M")
            day_str = dt.strftime("%d/%m/%Y")
            time_str = dt.strftime("%H:%M")
            
            # Predict move
            pred_move = "SIDEWAYS"
            max_prob = max(p_up, p_down, p_sideways)
            if p_up == max_prob: pred_move = "UP"
            elif p_down == max_prob: pred_move = "DOWN"

            results.append({
                "datetime": dt_str,
                "day": day_str,
                "time": time_str,
                "spot_price": float(spot_series[i]),
                "probabilities": {
                    "SIDEWAYS": round(p_sideways, 4),
                    "UP": round(p_up, 4),
                    "DOWN": round(p_down, 4),
                },
                "predicted_move": pred_move,
                "actual_move": actual_move,
                "correct": pred_move == actual_move if actual_move != "UNKNOWN" else None
            })
            
        # Group by day
        grouped = {}
        for r in results:
            day = r["day"]
            if day not in grouped:
                grouped[day] = []
            grouped[day].append(r)
            
        # Sort days chronologically. Assuming DD/MM/YYYY, we sort by parsing back slightly or sort by original order
        # Since date_series is already chronological from the dataframe, grouping ordered will retain day chronological order in python 3.7+
        # But to be safe, we just use the order of appearance:
        timeline = []
        seen = set()
        for r in results:
            if r["day"] not in seen:
                seen.add(r["day"])
                timeline.append({
                    "date": r["day"],
                    "predictions": grouped[r["day"]]
                })
            
        return {
            "expiry": expiry,
            "timeline": timeline
        }
