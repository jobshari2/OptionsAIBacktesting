"""
Market Regime Detection — ML-based regime classifier using RandomForest
with rule-based fallback and auto-labelling for training.
"""
import numpy as np
import pickle
from pathlib import Path
from typing import Optional
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import LabelEncoder

from backend.logger import logger
from .feature_engine import FeatureEngine


class MarketRegime:
    """Enumeration of market regimes."""
    RANGE_BOUND = "RANGE_BOUND"
    TREND_UP = "TREND_UP"
    TREND_DOWN = "TREND_DOWN"
    HIGH_VOLATILITY = "HIGH_VOLATILITY"
    LOW_VOLATILITY = "LOW_VOLATILITY"

    ALL = [RANGE_BOUND, TREND_UP, TREND_DOWN, HIGH_VOLATILITY, LOW_VOLATILITY]


class RegimeDetector:
    """
    ML-based market regime detector with rule-based fallback.

    Dual-mode approach:
        1. Rule-based labelling: generates training labels from historical data
        2. ML prediction: trains RandomForest on labelled features, predicts
           regime with probability-based confidence scores

    Falls back to rule-based detection when ML model is not available.
    """

    def __init__(
        self,
        # Rule-based thresholds for labelling / fallback
        atr_low_threshold: float = 30.0,
        momentum_threshold: float = 0.15,
        vol_high_threshold: float = 0.25,
        vol_low_threshold: float = 0.12,
        trend_strength_threshold: float = 0.3,
        # ML model params
        n_estimators: int = 100,
        random_state: int = 42,
    ):
        # Rule thresholds
        self.atr_low_threshold = atr_low_threshold
        self.momentum_threshold = momentum_threshold
        self.vol_high_threshold = vol_high_threshold
        self.vol_low_threshold = vol_low_threshold
        self.trend_strength_threshold = trend_strength_threshold

        # ML model
        self.model: Optional[RandomForestClassifier] = None
        self.label_encoder = LabelEncoder()
        self.label_encoder.fit(MarketRegime.ALL)
        self.n_estimators = n_estimators
        self.random_state = random_state
        self._is_trained = False

    def detect(self, features: dict) -> tuple[str, float]:
        """
        Detect market regime from features.

        Returns:
            tuple of (regime_name, confidence) where confidence is 0.0–1.0
        """
        if self._is_trained and self.model is not None:
            return self._ml_detect(features)
        else:
            regime = self._rule_based_detect(features)
            confidence = self._rule_based_confidence(features, regime)
            return regime, confidence

    def train(self, feature_history: list[dict]) -> dict:
        """
        Train the ML model from historical feature data.

        Auto-labels each feature vector using rule-based detection,
        then trains a RandomForestClassifier.

        Args:
            feature_history: List of feature dicts (from FeatureEngine)

        Returns:
            Training summary with accuracy, class distribution, etc.
        """
        if len(feature_history) < 10:
            logger.warning(
                f"RegimeDetector.train: only {len(feature_history)} samples, "
                "need at least 10. Skipping training."
            )
            return {"status": "skipped", "reason": "insufficient_data", "samples": len(feature_history)}

        # Step 1: Auto-label using rules
        feature_names = FeatureEngine.feature_names()
        X = []
        y = []

        for feat in feature_history:
            row = [feat.get(name, 0.0) for name in feature_names]
            label = self._rule_based_detect(feat)
            X.append(row)
            y.append(label)

        X = np.array(X, dtype=np.float64)
        y_encoded = self.label_encoder.transform(y)

        # Replace NaN/Inf with 0
        X = np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)

        # Step 2: Train RandomForest
        self.model = RandomForestClassifier(
            n_estimators=self.n_estimators,
            random_state=self.random_state,
            max_depth=10,
            min_samples_split=5,
            min_samples_leaf=2,
            class_weight="balanced",  # Handle imbalanced regimes
        )
        self.model.fit(X, y_encoded)
        self._is_trained = True

        # Training summary
        train_accuracy = float(self.model.score(X, y_encoded))
        unique, counts = np.unique(y, return_counts=True)
        class_dist = dict(zip(unique.tolist(), counts.tolist()))

        # Feature importance
        importances = dict(zip(
            feature_names,
            [float(v) for v in self.model.feature_importances_],
        ))

        summary = {
            "status": "trained",
            "samples": len(X),
            "train_accuracy": train_accuracy,
            "class_distribution": class_dist,
            "feature_importance": importances,
            "n_estimators": self.n_estimators,
        }
        logger.info(f"RegimeDetector trained: accuracy={train_accuracy:.3f}, samples={len(X)}")
        return summary

    def _ml_detect(self, features: dict) -> tuple[str, float]:
        """Detect regime using trained ML model."""
        feature_names = FeatureEngine.feature_names()
        X = np.array([[features.get(name, 0.0) for name in feature_names]], dtype=np.float64)
        X = np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)

        prediction = self.model.predict(X)[0]
        probabilities = self.model.predict_proba(X)[0]

        regime = self.label_encoder.inverse_transform([prediction])[0]
        confidence = float(np.max(probabilities))

        return regime, confidence

    def _rule_based_detect(self, features: dict) -> str:
        """
        Fallback rule-based regime detection.
        Also used as the labelling function for ML training.
        """
        rv = features.get("realized_volatility", 0.0)
        atr = features.get("atr", 0.0)
        momentum = features.get("momentum", 0.0)
        trend = features.get("trend_strength", 0.0)

        # Priority 1: High volatility
        if rv > self.vol_high_threshold:
            return MarketRegime.HIGH_VOLATILITY

        # Priority 2: Strong uptrend
        if momentum > self.momentum_threshold and trend > self.trend_strength_threshold:
            return MarketRegime.TREND_UP

        # Priority 3: Strong downtrend
        if momentum < -self.momentum_threshold and trend < -self.trend_strength_threshold:
            return MarketRegime.TREND_DOWN

        # Priority 4: Range bound (low ATR + low momentum)
        if atr < self.atr_low_threshold and abs(momentum) < self.momentum_threshold:
            return MarketRegime.RANGE_BOUND

        # Priority 5: Low volatility
        if rv < self.vol_low_threshold:
            return MarketRegime.LOW_VOLATILITY

        # Default: range bound
        return MarketRegime.RANGE_BOUND

    def _rule_based_confidence(self, features: dict, regime: str) -> float:
        """
        Estimate confidence for rule-based detection.
        Measures how far features are from the thresholds.
        """
        rv = features.get("realized_volatility", 0.0)
        momentum = abs(features.get("momentum", 0.0))
        atr = features.get("atr", 0.0)
        trend = abs(features.get("trend_strength", 0.0))

        if regime == MarketRegime.HIGH_VOLATILITY:
            excess = (rv - self.vol_high_threshold) / max(self.vol_high_threshold, 0.01)
            return float(np.clip(0.6 + excess * 0.4, 0.5, 1.0))

        if regime in (MarketRegime.TREND_UP, MarketRegime.TREND_DOWN):
            mom_excess = (momentum - self.momentum_threshold) / max(self.momentum_threshold, 0.01)
            trend_excess = (trend - self.trend_strength_threshold) / max(self.trend_strength_threshold, 0.01)
            return float(np.clip(0.5 + (mom_excess + trend_excess) * 0.2, 0.4, 1.0))

        if regime == MarketRegime.RANGE_BOUND:
            flatness = 1.0 - (momentum / max(self.momentum_threshold, 0.01))
            return float(np.clip(0.5 + flatness * 0.3, 0.4, 1.0))

        # LOW_VOLATILITY
        return 0.5

    def save_model(self, path: str | Path) -> None:
        """Save trained model to disk."""
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)

        model_data = {
            "model": self.model,
            "label_encoder": self.label_encoder,
            "is_trained": self._is_trained,
            "thresholds": {
                "atr_low": self.atr_low_threshold,
                "momentum": self.momentum_threshold,
                "vol_high": self.vol_high_threshold,
                "vol_low": self.vol_low_threshold,
                "trend_strength": self.trend_strength_threshold,
            },
        }
        with open(path, "wb") as f:
            pickle.dump(model_data, f)
        logger.info(f"RegimeDetector model saved to {path}")

    def load_model(self, path: str | Path) -> bool:
        """
        Load trained model from disk.

        Returns:
            True if model was loaded successfully, False otherwise.
        """
        path = Path(path)
        if not path.exists():
            logger.warning(f"RegimeDetector model file not found: {path}")
            return False

        try:
            with open(path, "rb") as f:
                model_data = pickle.load(f)

            self.model = model_data["model"]
            self.label_encoder = model_data["label_encoder"]
            self._is_trained = model_data["is_trained"]

            thresholds = model_data.get("thresholds", {})
            self.atr_low_threshold = thresholds.get("atr_low", self.atr_low_threshold)
            self.momentum_threshold = thresholds.get("momentum", self.momentum_threshold)
            self.vol_high_threshold = thresholds.get("vol_high", self.vol_high_threshold)
            self.vol_low_threshold = thresholds.get("vol_low", self.vol_low_threshold)
            self.trend_strength_threshold = thresholds.get("trend_strength", self.trend_strength_threshold)

            logger.info(f"RegimeDetector model loaded from {path}")
            return True
        except Exception as e:
            logger.error(f"Failed to load RegimeDetector model: {e}")
            return False

    @property
    def is_trained(self) -> bool:
        """Check if ML model is trained and ready."""
        return self._is_trained

    def get_feature_importance(self) -> dict[str, float]:
        """Get feature importances from trained model."""
        if not self._is_trained or self.model is None:
            return {}

        return dict(zip(
            FeatureEngine.feature_names(),
            [float(v) for v in self.model.feature_importances_],
        ))
