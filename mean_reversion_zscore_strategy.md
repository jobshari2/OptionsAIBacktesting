# Mean Reversion (Z‑Score) Quant Trading Strategy

Author: Quant Research Guide

------------------------------------------------------------------------

# 1. Strategy Overview

Mean reversion assumes that price deviations from a statistical average
are temporary and that prices tend to return to their equilibrium value.

The strategy identifies **extreme deviations** from a rolling mean using
a **Z‑Score** and trades when the deviation becomes statistically
significant.

This approach is widely used in:

-   Statistical arbitrage
-   High‑frequency trading
-   ETF trading
-   Index futures trading
-   Options volatility strategies

It works best in **range‑bound markets**.

------------------------------------------------------------------------

# 2. Mathematical Foundation

The core signal is the **Z‑Score**.

Formula:

Z = (P − MA) / σ

Where:

P = current price\
MA = rolling mean (moving average)\
σ = rolling standard deviation

Interpretation:

  Z Score   Meaning
  --------- --------------------
  0         price near average
  +1        mildly overbought
  +2        statistically high
  −1        mildly oversold
  −2        statistically low

Typical trading thresholds:

Buy signal:

Z \< −2

Sell signal:

Z \> +2

Exit condition:

Z → 0

------------------------------------------------------------------------

# 3. Why Mean Reversion Works

Markets exhibit short‑term inefficiencies caused by:

1.  Liquidity shocks
2.  Institutional order splitting
3.  Temporary news impact
4.  Market maker hedging
5.  Options gamma effects

These factors cause **temporary deviations from equilibrium price**.

Mean reversion strategies capture these deviations.

------------------------------------------------------------------------

# 4. Data Requirements

For implementation using **1‑minute data**:

Required fields:

Timestamp\
Open\
High\
Low\
Close\
Volume

For index trading:

Example instruments:

-   NIFTY
-   BANKNIFTY

For options:

Required additional data:

Strike Expiry Option type (CE/PE) Implied volatility (optional)

------------------------------------------------------------------------

# 5. Data Preprocessing

Steps:

1.  Load historical data
2.  Resample to 1‑minute bars if needed
3.  Remove missing values
4.  Ensure time alignment

Example dataset structure:

timestamp \| open \| high \| low \| close \| volume

------------------------------------------------------------------------

# 6. Feature Engineering

Calculate rolling statistics.

Example window sizes:

5 minutes\
20 minutes\
60 minutes

Recommended starting configuration:

MA window = 20 minutes

Standard deviation window = 20 minutes

Python example:

``` python
df['MA'] = df['close'].rolling(20).mean()
df['STD'] = df['close'].rolling(20).std()

df['Z'] = (df['close'] - df['MA']) / df['STD']
```

------------------------------------------------------------------------

# 7. Entry Conditions

Long Entry

Condition:

Z \< -2

Interpretation:

Price is statistically oversold.

Short Entry

Condition:

Z \> +2

Interpretation:

Price is statistically overbought.

------------------------------------------------------------------------

# 8. Exit Rules

Exit positions when:

Z returns to mean

Example:

Long exit:

Z \>= 0

Short exit:

Z \<= 0

Alternative exits:

Time stop\
Volatility spike\
Trend detection

------------------------------------------------------------------------

# 9. Stop Loss Rules

Mean reversion failures occur during strong trends.

Recommended stops:

Hard stop

Z \< -4

or

2 × ATR

Example:

``` python
stop_loss = entry_price - 2 * ATR
```

------------------------------------------------------------------------

# 10. Position Sizing

Recommended methods:

1.  Fixed risk per trade
2.  Volatility scaling
3.  Kelly fraction

Example:

Risk per trade:

1% of capital

Position size:

Position = Capital × Risk / StopDistance

------------------------------------------------------------------------

# 11. Implementation Using 1‑Minute Index Data

Example pipeline:

Step 1: Load data

``` python
import pandas as pd

df = pd.read_csv("nifty_1min.csv")
```

Step 2: Calculate indicators

``` python
window = 20

df["MA"] = df["close"].rolling(window).mean()
df["STD"] = df["close"].rolling(window).std()

df["Z"] = (df["close"] - df["MA"]) / df["STD"]
```

Step 3: Generate signals

``` python
df["long_signal"] = df["Z"] < -2
df["short_signal"] = df["Z"] > 2
```

Step 4: Exit conditions

``` python
df["exit_long"] = df["Z"] >= 0
df["exit_short"] = df["Z"] <= 0
```

------------------------------------------------------------------------

# 12. Applying Strategy to Options

For options trading we do not directly trade the option price.

Instead we derive signals from:

Underlying index.

Example:

Signal from NIFTY.

Trade:

ATM options.

Example:

If NIFTY Z‑score \< -2

Buy:

NIFTY ATM Call

If Z‑score \> +2

Buy:

ATM Put

Alternative:

Sell options using:

Iron condor\
Short straddle

when Z-score indicates range bound markets.

------------------------------------------------------------------------

# 13. Backtesting Framework

Key performance metrics:

Sharpe ratio

Win rate

Profit factor

Max drawdown

Example Python backtest loop:

``` python
position = 0
entry_price = 0

for i in range(len(df)):

    if df["long_signal"].iloc[i] and position == 0:
        position = 1
        entry_price = df["close"].iloc[i]

    elif df["short_signal"].iloc[i] and position == 0:
        position = -1
        entry_price = df["close"].iloc[i]

    elif df["exit_long"].iloc[i] and position == 1:
        position = 0

    elif df["exit_short"].iloc[i] and position == -1:
        position = 0
```

------------------------------------------------------------------------

# 14. Strategy Enhancements

Professional implementations add filters.

Trend filter

ADX \< 20

Volatility filter

ATR stable

Volume filter

High liquidity periods only

Example trading window:

9:30 -- 2:45

------------------------------------------------------------------------

# 15. Risk Management

Key rules:

Maximum daily loss

Example:

2% of capital

Maximum open positions

Example:

3 concurrent trades

Kill switch

Disable strategy during abnormal volatility.

------------------------------------------------------------------------

# 16. Common Mistakes

Using too small dataset

Ignoring transaction costs

No regime detection

No stop loss

Overfitting parameters

------------------------------------------------------------------------

# 17. Advanced Improvements

Machine learning enhancements:

Predict probability of mean reversion

Use features:

Order book imbalance

Volume spikes

VWAP deviation

Options gamma exposure

------------------------------------------------------------------------

# 18. Realistic Expectations

Typical mean reversion strategy metrics:

Win rate:

55--65%

Sharpe ratio:

1.5 -- 3

Average trade duration:

5 -- 30 minutes

------------------------------------------------------------------------

# 19. Strategy Architecture

Production system architecture:

Data ingestion

Feature computation

Signal generation

Risk manager

Execution engine

Monitoring system

------------------------------------------------------------------------

# 20. Conclusion

Mean reversion strategies remain one of the most robust quantitative
trading approaches when applied correctly.

They work best with:

High liquidity assets

Intraday data

Proper risk control

Regime detection

When combined with volatility filters and position sizing, the Z‑score
strategy becomes a powerful component of a systematic trading system.
