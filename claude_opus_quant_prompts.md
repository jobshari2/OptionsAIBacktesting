# Claude Opus Prompts for AI‑Powered Nifty Options Backtesting Platform

You are an **autonomous AI coding agent** responsible for building a
**full production system**.

Your task is to create a **complete GitHub repository** implementing an
**AI‑powered Nifty Options Backtesting and Strategy Research Platform**.

You must:

1.  Plan architecture
2.  Create project folders
3.  Generate source files
4.  Implement modules
5.  Write documentation
6.  Add example strategies
7.  Provide runnable instructions

------------------------------------------------------------------------

# Development Rules

Follow these rules strictly.

• Write modular code\
• Prefer Python for backend\
• Use FastAPI APIs\
• Use Polars or DuckDB for data engine\
• Use React + TypeScript frontend\
• Write clear comments\
• Follow production design patterns

------------------------------------------------------------------------

# Repository Structure

Create a repository similar to:

    nifty-options-research-platform/

    backend/
    data_engine/
    strategy_engine/
    backtester/
    ai_optimizer/
    analytics/
    api/

    frontend/
    components/
    pages/
    charts/

    ai_learning/

    configs/

    strategies/

    docs/

------------------------------------------------------------------------

# Core Modules to Implement

## Data Engine

Handles:

• loading parquet files\
• expiry discovery\
• timestamp filtering\
• joins between datasets

------------------------------------------------------------------------

## Backtesting Engine

Simulates strategies with:

• multi‑leg trades\
• order fills\
• slippage\
• fees

------------------------------------------------------------------------

## Strategy Engine

Defines strategies as configuration files.

------------------------------------------------------------------------

## AI Optimizer

Learns from historical trades and improves parameters.

------------------------------------------------------------------------

## Analytics Engine

Calculates:

• Sharpe ratio\
• drawdown\
• profit factor\
• win rate

------------------------------------------------------------------------

## Web Portal

Provides:

• strategy builder\
• backtest dashboard\
• trade logs\
• strategy comparison\
• option chain explorer

------------------------------------------------------------------------

# AI Learning Memory

Maintain a learning log:

    /ai_learning/learning_history.json

Each run must store:

• expiry\
• parameters\
• results\
• improvements

------------------------------------------------------------------------

# Strategy Animation

The frontend must support:

• replaying strategy minute‑by‑minute\
• displaying payoff graphs\
• showing option legs and PnL changes

------------------------------------------------------------------------

# Output Requirement

The AI coding agent must:

• generate all required files\
• create runnable backend\
• create working frontend\
• include sample strategies\
• include setup instructions

------------------------------------------------------------------------

# Final Deliverable

A **complete repository that can be cloned and executed locally**.
