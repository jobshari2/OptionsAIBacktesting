# AI-Powered Nifty Options Backtesting Platform

A production-grade research platform for backtesting options strategies on NIFTY with AI-driven optimization.

## Quick Start

### Backend (Python + FastAPI)

```bash
# Install dependencies
pip install -r requirements.txt

# Start backend server
python -m uvicorn backend.main:app --reload --port 8000
```

Backend will be available at `http://localhost:8000` with docs at `/docs`.

### Frontend (React + TypeScript + Vite)

```bash
cd frontend
npm install
npm run dev
```

Frontend will be available at `http://localhost:5173`.

## Architecture

```
backend/
├── data_engine/       # Parquet loading, caching, expiry discovery
├── strategy_engine/   # Strategy definitions, YAML loading, leg building
├── backtester/        # Vectorized backtesting engine, simulation, position management
├── ai_optimizer/      # Bayesian optimization, learning memory
├── analytics/         # Metrics (Sharpe, Sortino), Greeks, payoff diagrams
├── storage/           # DuckDB persistence layer
└── api/               # FastAPI REST endpoints

frontend/src/
├── api/               # API client
├── stores/            # Zustand state management
└── pages/             # Dashboard, Strategy Builder, Backtest, Trade Log,
                       # Option Chain, Animation, Comparison, AI Optimizer

strategies/            # YAML strategy templates (8 built-in)
ai_learning/           # AI learning memory (auto-generated)
```

## Features

- **8 Built-in Strategies**: Iron Condor, Straddle, Strangle, Butterfly, Spreads, Ratio
- **363 Expiries**: Historical NIFTY options data (1-minute candles)
- **Realistic Simulation**: Slippage, STT, exchange charges, SEBI fees
- **AI Optimizer**: Bayesian parameter tuning with walk-forward methodology
- **Strategy Replay**: Minute-by-minute animation with live PnL tracking
- **Option Chain Explorer**: Historical option chain browser
- **Strategy Comparison**: Side-by-side performance comparison

## Data Location

Historical data in Parquet format at:
```
D:\NSE Data\Options\NIFTY\parquet\<expiry>\
├── NIFTY_Options_1minute.parquet   (OHLCV + OI + Strike + Right)
├── NIFTY_Index_1minute.parquet     (OHLCV spot)
└── NIFTY_FUTURES_1minute.parquet   (OHLCV futures)
```
