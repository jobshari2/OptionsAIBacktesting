# Implementation Steps for Option Price Predictor

This document outlines the systematic, step-by-step approach to building the ML-based short-term prediction engine.

## Phase 1: Data Preparation & Target Labelling
**Goal:** Prepare a clean, labeled dataset from the Unified Parquet files.

1.  **Create Target Variables:**
    *   Write a Polars script to calculate future returns: `(Close_t+5 - Close_t) / Close_t`.
    *   Discretize these returns into classes (0: Sideways, 1: Up, 2: Down) based on a volatility-adjusted threshold (e.g., using ATR).
2.  **Base Feature Engineering (Spot/Futures):**
    *   Implement rolling calculations for Returns, RSI, MACD.
    *   Calculate `VWAP` and `VWAP Distance`.
    *   Calculate Future Premium (Basis).
3.  **Options Feature Engineering (The Edge):**
    *   Extract ATM strikes dynamically at every timestamp.
    *   Calculate rolling 5M changes in ATM IV and ATM OI.
    *   Calculate Put/Call Ratio based on total volume of nearest 5 strikes.
4.  **Dataset Construction:**
    *   Filter out non-trading hours (e.g., first and last 15 mins might be too noisy/volatile).
    *   Drop NaNs resulting from rolling windows.
    *   Save train, validation, and test datasets as `.parquet` to disk to speed up model training iterations. Ensure strict chronological splitting (e.g., Train: 2020-2022, Val: 2023, Test: 2024).

## Phase 2: Baseline Model Training (XGBoost)
**Goal:** Establish a benchmark performance without complex deep learning.

1.  **Dependencies:** Add `xgboost`, `scikit-learn`, `joblib` to environment.
2.  **Training Script:**
    *   Load the prepared `.parquet` datasets.
    *   Define an XGBoostClassifier objective `multi:softprob`.
    *   Train the model using the training set and utilize early stopping on the validation set to prevent overfitting.
3.  **Evaluation:**
    *   Calculate Log Loss, Area Under ROC curve (AUC), and a custom financial metric (e.g., Expected Value per trade given a 65% threshold).
    *   Generate Feature Importance charts to understand what drives the market.
4.  **Threshold Tuning:**
    *   Determine the optimal probability threshold (e.g., is >60% enough, or do we need >75% to clear spread costs?).

## Phase 3: Advanced Modeling & Ensembling
**Goal:** Capture temporal patterns and synthesize predictions robustly.

1.  **Dependencies:** Add `torch`, `tensorflow` (optional for specific TFT implementations).
2.  **Sequence Models (LSTM / TFT):**
    *   Implement an LSTM taking 60-minute rolling windows.
    *   Implement a Temporal Fusion Transformer for multi-signal dependencies.
3.  **Ensembling Logic:**
    *   Create a meta-model or weighted average function combining outputs from XGBoost, LSTM, and TFT.
4.  **Evaluation Metrics Expansion:**
    *   Track Accuracy, F1 Score, Sharpe Ratio, and Profit Factor based on theoretical entry/exits.

## Phase 4: Backtester Integration & Risk Rules
**Goal:** Plug the ML predictions back into the main platform with strict risk controls.

1.  **Inference Wrapper:**
    *   Create a class `MLEnsemblePredictor` that returns the final blended probability.
2.  **Strategy Implementation:**
    *   Create `MLShortTermStrategy`. If `prob_up > 0.65`, Buy ATM Call.
3.  **Risk Management Implementation:**
    *   Add hard-coded Risk Rules: Stop loss = 10% premium, Target = 20% premium.
    *   Add daily filters: Max loss limit per day, max trades per day limit.
4.  **Execution:**
    *   Run through the `BacktestEngine` and analyze Total Return, Max Drawdown, and Win Rate.

## Phase 5: Productionization, Live Trading & UI
**Goal:** Deploy to live market conditions with continuous learning.

1.  **Live Infrastructure Setup:**
    *   Configure `Kafka` for real-time market data ingestion.
    *   Configure `Redis` for caching calculated features to hit `< 500ms` latency targets.
2.  **API Endpoints & UI:**
    *   Create `/api/ml/predict` for live inference testing.
    *   Integrate ML probability gauges in the UI Frontend.
3.  **Continuous Learning / MLOps:**
    *   Set up `MLflow` for model registry and tracking.
    *   Implement nightly/weekly cron jobs for Drift Detection and periodic retraining.
    *   Dockerize the application for Kubernetes deployment.

## Expected Timeline (~10 Weeks)
- **Phase 1 (Data/Features):** 4 weeks (2 data eng, 2 feature eng)
- **Phase 2 & 3 (Model Training/Ensemble):** 3 weeks
- **Phase 4 (Backtesting Integration):** 2 weeks
- **Phase 5 (Live Deployment & MLOps):** 2 weeks
