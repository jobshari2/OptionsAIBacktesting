# AI Coding Agent Prompt

## Adaptive Options Trading System (Cottle-Inspired Dynamic Strategy Engine)

This document is a **system prompt for an AI coding agent** to implement
a production‑grade automated options trading system based on the
principles described in *Options: Perception and Deception* by Charles
M. Cottle.

The system must: - Detect market regime continuously - Select the best
options structure - Monitor market conditions in real time - Adjust or
convert strategies dynamically - Manage risk automatically - Support
backtesting and live trading

The target example market is **NIFTY options**, but the system must be
modular to support other indices.

------------------------------------------------------------------------

# 1. SYSTEM OBJECTIVE

Build a trading engine that behaves like a **professional options
desk**.

Instead of executing a single fixed strategy, the system should:

1.  Analyze market conditions continuously
2.  Determine the current market regime
3.  Select the best options structure
4.  Monitor risk exposure
5.  Adjust the position when conditions change

The system must operate as a **state machine**.

------------------------------------------------------------------------

# 2. HIGH LEVEL ARCHITECTURE

Modules required:

Market Data Engine\
Strategy Engine\
Options Pricing Engine\
Position Manager\
Risk Manager\
Adjustment Engine\
Execution Engine\
Backtesting Engine\
Logging + Analytics

Example architecture:

    Market Data
         ↓
    Market Regime Detector
         ↓
    Strategy Selector
         ↓
    Trade Entry Engine
         ↓
    Position Monitoring Loop
         ↓
    Adjustment Engine
         ↓
    Order Execution

------------------------------------------------------------------------

# 3. DATA REQUIRED

The system must ingest:

### Market Data

-   Spot price
-   Index futures price
-   Option chain data
-   Bid/Ask
-   Volume
-   Open Interest

### Volatility Data

-   Implied Volatility
-   IV percentile
-   Historical volatility

### Technical Indicators

-   EMA 20
-   EMA 50
-   ATR
-   VWAP

### Derived Metrics

-   Delta exposure
-   Gamma exposure
-   Theta exposure
-   Vega exposure

------------------------------------------------------------------------

# 4. MARKET REGIME DETECTION

The system must classify the market into regimes.

Regimes:

TREND_UP\
TREND_DOWN\
RANGE\
VOLATILITY_EXPANSION\
VOLATILITY_CONTRACTION

Example logic:

    if price > EMA20 and EMA20 > EMA50:
        regime = TREND_UP

    elif price < EMA20 and EMA20 < EMA50:
        regime = TREND_DOWN

    elif abs(price - EMA20) < ATR:
        regime = RANGE

Volatility conditions:

    if IV_percentile > 70:
        volatility = HIGH

    if IV_percentile < 30:
        volatility = LOW

Combine regime + volatility to select strategy.

------------------------------------------------------------------------

# 5. STRATEGY SELECTION

### RANGE + HIGH IV

Use Iron Condor

Structure:

Sell ATM Call\
Sell ATM Put\
Buy OTM Call\
Buy OTM Put

Example:

    Sell 22500 CE
    Sell 22500 PE
    Buy 22700 CE
    Buy 22300 PE

Goal: Capture theta decay.

------------------------------------------------------------------------

### TREND_UP

Use Bull Call Spread

Structure:

Buy ATM Call\
Sell OTM Call

Example:

    Buy 22500 CE
    Sell 22700 CE

------------------------------------------------------------------------

### TREND_DOWN

Use Bear Put Spread

Structure:

Buy ATM Put\
Sell OTM Put

Example:

    Buy 22500 PE
    Sell 22300 PE

------------------------------------------------------------------------

### VOLATILITY EXPANSION EXPECTED

Use Long Straddle

Structure:

Buy ATM Call\
Buy ATM Put

Used during:

Major events\
Breakout zones\
News catalysts

------------------------------------------------------------------------

### VOLATILITY COLLAPSE

Use Short Strangle

Structure:

Sell OTM Call\
Sell OTM Put

Example:

    Sell 22700 CE
    Sell 22300 PE

------------------------------------------------------------------------

# 6. TRADE ENTRY RULES

Trade only if:

-   Liquidity threshold satisfied
-   Bid/Ask spread acceptable
-   IV not extreme unless strategy requires it

Example entry rules:

    spread < 0.5% option_price
    volume > threshold
    open_interest increasing

Position size:

Risk per trade \<= 2% capital.

------------------------------------------------------------------------

# 7. POSITION MONITORING LOOP

The system must monitor the market every few seconds.

Pseudo loop:

    while market_open:

        update_market_data()

        compute_greeks()

        check_risk()

        detect_regime_change()

        if regime_changed:
            adjust_position()

        if stop_loss_hit:
            exit_trade()

        sleep(interval)

Monitoring frequency:

5--30 seconds depending on data source.

------------------------------------------------------------------------

# 8. ADJUSTMENT ENGINE

The adjustment engine is the **core intelligence**.

It must detect when the trade no longer matches the market regime.

Examples:

------------------------------------------------------------------------

### Adjustment 1 --- Condor Breakout

If price breaches short strike:

Convert to vertical spread.

Example:

    Iron Condor
    ↓
    Price breaks upside
    ↓
    Close put spread
    Keep call spread

------------------------------------------------------------------------

### Adjustment 2 --- Straddle Risk Reduction

Convert to Iron Butterfly.

Example:

    Short Straddle
    ↓
    Buy OTM wings
    ↓
    Iron Butterfly

------------------------------------------------------------------------

### Adjustment 3 --- Trend Reversal

Convert spreads.

Example:

    Bull Call Spread
    ↓
    Market reverses
    ↓
    Close position
    Open Bear Put Spread

------------------------------------------------------------------------

### Adjustment 4 --- Time Decay Optimization

Convert to Calendar Spread.

Example:

    Sell weekly option
    Buy monthly option

------------------------------------------------------------------------

# 9. RISK MANAGEMENT

Hard limits:

Max loss per trade = 2% capital

Portfolio delta must remain within bounds.

Example:

    if abs(delta_exposure) > threshold:
        hedge_position()

Stop losses:

Iron Condor → 2x premium\
Vertical Spread → 50% loss\
Straddle → IV collapse threshold

------------------------------------------------------------------------

# 10. EXECUTION ENGINE

Responsible for:

Order placement\
Order modification\
Order cancellation

Must support:

Market orders\
Limit orders\
Iceberg orders

Broker API examples:

Zerodha Kite Connect\
Interactive Brokers\
Tradier

------------------------------------------------------------------------

# 11. BACKTESTING ENGINE

Backtesting must simulate:

Historical option chains\
Bid/Ask spreads\
Slippage\
Transaction costs

Metrics:

Sharpe Ratio\
Max Drawdown\
Win Rate\
Profit Factor

------------------------------------------------------------------------

# 12. LOGGING AND ANALYTICS

The system must log:

Trade entries\
Adjustments\
Greeks exposure\
Market regime

Example log:

    timestamp
    strategy
    delta
    gamma
    vega
    pnl

------------------------------------------------------------------------

# 13. FUTURE AI EXTENSIONS

Machine learning models can improve:

Market regime classification\
Volatility forecasting\
Optimal strike selection

Possible models:

Random Forest\
LSTM\
Transformer time series models

------------------------------------------------------------------------

# 14. EXPECTED OUTPUT OF THE SYSTEM

The system must produce:

Live trade signals\
Automatic order execution\
Strategy adjustments\
Risk dashboard\
Performance analytics

------------------------------------------------------------------------

# 15. IMPLEMENTATION REQUIREMENTS

Preferred stack:

Backend

Python\
FastAPI\
Redis\
PostgreSQL

Trading libraries

NumPy\
Pandas\
PyTorch\
TA-Lib

Frontend

React\
TypeScript\
TradingView charts

------------------------------------------------------------------------

# 16. FINAL OBJECTIVE

The system must behave like a **professional options trading desk**:

Continuously analyze the market\
Select optimal strategy\
Adjust positions dynamically\
Control risk at all times

The result should be a **fully autonomous adaptive options trading
engine**.
