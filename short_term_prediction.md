Option Price Movement Prediction (Short-Term Forecasting)

You can predict next 5–15 minute movement probability.

Example output:

Next 5 minutes probability:
Up move: 63%
Down move: 27%
Sideways: 10%

Models that work well:

LSTM

Temporal Convolution Networks

Transformer time-series models

XGBoost

Input features:

From spot data

Returns

RSI

VWAP distance

Order imbalance

From options data

IV change

OI change

Put/Call ratio

Delta changes

Output:

Signal confidence score

Example trade trigger

If Up probability > 65%
Buy ATM Call