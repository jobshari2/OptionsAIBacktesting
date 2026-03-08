# Option Price Movement Prediction - Thought Process & Analysis

## 1. Problem Definition and Scope
The objective is to predict the short-term (1-min, 5-min, 15-min) directional movement (Up, Down, Sideways) of the underlying index (NIFTY) or the option itself. We aim to predict not only the **Direction** and **Probability**, but also the **Expected Magnitude** of the move.

**Example Output:**
*   Next 5 minutes probability: UP (64%), DOWN (22%), SIDEWAYS (14%)
*   Expected Magnitude: +12 points on Spot.

**Why 1-15 minutes?** This is a high-frequency/stat-arb timeframe. In this window, micro-structural factors (order imbalance, momentary IV spikes) have higher predictive power than macroeconomic factors. It requires highly reactive models but suffers from high noise-to-signal ratios.

## 2. Data Strategy: The Unified Advantage
The recent transition to a **Unified Parquet Format** (where Index, Futures, and Options data are merged per expiry) is a massive enabler for this ML task.

**Previous Challenge:** Aligning spot prices, future premiums, and option greeks at the exact 1-minute timestamp across separate files was computationally expensive and prone to lookahead or misalignment bugs.
**Unified Advantage:** The unified format inherently aligns all instruments by `Date` (timestamp).
- We can instantly join ATM strike data with Spot features.
- Cross-instrument features (e.g., Future-Spot spread, Option IV vs. Historical Volatility) can be vectorized efficiently using Polars.

## 3. Feature Engineering: The Secret Sauce
In quant finance, features matter more than the algorithm.

### Spot/Futures Features (Microstructure & Momentum)
*   **Returns & Log Returns:** Essential for stationarity. Multiple lags (1m, 3m, 5m, 15m).
*   **RSI & MACD:** Traditional momentum, but calculated on a rolling 1-min basis.
*   **VWAP Distance:** `(Close - VWAP) / VWAP`. Indicates mean-reversion pull.
*   **Order Imbalance proxy:** Using `Volume` and price change to estimate buying vs. selling pressure (e.g., standard tick rule or volume-weighted price changes).
*   **Basis:** `Future LTP - Index LTP`. A widening premium often indicates bullish sentiment.

### Options Features (Sentiment & Market Maker Positioning)
*   **Implied Volatility (IV) Dynamics:** 1m, 5m changes in ATM IV.
*   **Open Interest (OI) Momentum:** Rapid changes in OI on specific strikes. E.g., massive OI addition on ATM Call acts as resistance.
*   **Put/Call Ratio (PCR):** Volume PCR and OI PCR for the nearest 3 strikes above/below ATM.
*   **Market Microstructure:** Bid-ask spread approximations, Liquidity Pressure indicators.
*   **Greeks & Dealer Positioning:** Tracking the "Gamma Profile" of the market to predict dealer hedging flows (gamma squeezes) and estimating overall Dealer Positioning.

## 4. Model Selection & Architecture
The markdown suggests LSTM, TCN, Transformers, and XGBoost.

*   **XGBoost / LightGBM:** 
    *   *Pros:* Extremely fast to train, highly interpretable (feature importance), robust to outliers, handles tabular cross-sectional data beautifully.
    *   *Cons:* Does not natively understand sequence structure (requires explicit lagged features).
    *   *Verdict:* **Baseline Model.** Always start here. Often performs just as well as deep learning on 1-min tabular data if feature engineering is solid.
*   **LSTM (Long Short-Term Memory):** 
    *   *Pros:* Native sequence modeling.
    *   *Cons:* Can be slow to train, suffers from vanishing gradients on longer sequences, often overfits financial noise.
*   **TCN (Temporal Convolutional Networks):** 
    *   *Pros:* Faster than LSTMs, stable gradients, explicitly models local temporality.
*   **Transformers (Time-Series):** 
    *   *Pros:* State-of-the-art for sequence attention (e.g., Temporal Fusion Transformer). Captures long dependencies and multiple signals simultaneously.
    *   *Cons:* Data hungry, prone to massive overfitting in low-signal regimes like finance.

**Proposed Ensemble Architecture:**
Production systems perform best when combining these models. We propose a weighted ensemble:
1.  **XGBoost:** For fast, tabular cross-sectional feature processing.
2.  **LSTM:** For 60-minute sequential pattern recognition.
3.  **Temporal Fusion Transformer (TFT):** For advanced multi-signal temporal modeling.
*Final Output:* A weighted average of probabilities from all models.

## 5. Labelling and Target Definition
We need a multi-class target (Up, Down, Sideways).
*   **Target Window:** 5 minutes ahead (`t+5` close vs `t` close).
*   **Thresholds (`alpha`):** Define a minimum move required to be classified as Up/Down to overcome bid-ask spread and slippage.
    *   If `Return(t+5) > +0.05%` -> UP (Class 1)
    *   If `Return(t+5) < -0.05%` -> DOWN (Class 2)
    *   Else -> SIDEWAYS (Class 0)
    
## 6. Risk, Challenges, and Continuous Learning
*   **Lookahead Bias:** Computing a rolling metric using future data. Strict temporal splits (e.g., train on 2020-2023, validate on 2024) are mandatory. No random K-Fold CV.
*   **Slippage & Transaction Costs:** A 65% probability of a 5-point move is useless if slippage and brokerage cost 6 points. Models must clear expected execution costs.
*   **Concept Drift & Continuous Learning:** Options markets evolve constantly. The system requires:
    *   Drift Detection: Monitoring feature distributions for structural shifts.
    *   Periodic Retraining: Automated daily or weekly model retraining pipelines to adapt to new market regimes.
