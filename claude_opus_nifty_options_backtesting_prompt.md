# Advanced Prompt for Claude Opus --- AI Powered Nifty Options Backtesting Platform

You are a **principal AI engineer, quantitative researcher, and
high-performance systems architect**.

Your task is to design and implement a **production-grade AI-driven
Nifty Options Backtesting and Strategy Research Platform**.

This platform must support:

-   High-performance historical data processing
-   Vectorized backtesting
-   AI-driven strategy optimization
-   Interactive strategy simulation
-   Options analytics
-   Large-scale research workflows

The system must be designed for **speed, scalability, and research
experimentation similar to professional quant trading systems**.

------------------------------------------------------------------------

# Core Goal

Build an **AI-assisted research platform** capable of:

1.  Running options strategies across historical data
2.  Learning from previous expiries
3.  Improving strategies automatically
4.  Visualizing trades and strategy behavior
5.  Allowing researchers to design and compare strategies

------------------------------------------------------------------------

# Historical Market Data

Historical data is stored locally in **Parquet format** using **1-minute
timeframe**.

Data types available:

-   Options
-   Futures
-   Index

Directory structure:

    D:\NSE Data\Options\
          NIFTY\
             parquet\
                <expiry folders>
                    NIFTY_Options_1minute.parquet
                    NIFTY_FUTURES_1minute.parquet
                    NIFTY_Index_1minute.parquet

Each expiry has its own folder.

The system must efficiently:

-   Load large parquet datasets
-   Query data by time range
-   Join options, futures, and index datasets
-   Run simulations across multiple expiries

Use **high-performance tools** such as:

-   Polars
-   PyArrow
-   DuckDB
-   NumPy vectorization

Avoid slow row-by-row loops.

------------------------------------------------------------------------

# System Architecture

Design a **modular architecture** consisting of:

## 1. Data Engine

Responsible for:

-   Fast parquet loading
-   Data caching
-   Time slicing
-   Expiry discovery
-   Index + options joins

Must support:

-   Lazy loading
-   Column pruning
-   Memory optimization

------------------------------------------------------------------------

## 2. Backtesting Engine

The engine must support **vectorized strategy simulation**.

Capabilities:

-   Multi-leg options strategies
-   Entry / exit rules
-   Stop loss
-   Profit targets
-   Time-based exits
-   Delta-based rules
-   Volatility filters

Simulation must include:

-   Slippage
-   Transaction costs
-   Liquidity constraints
-   Partial fills

------------------------------------------------------------------------

## 3. Strategy Library

Include implementations for common options strategies:

-   Long Straddle
-   Short Straddle
-   Strangle
-   Iron Condor
-   Iron Butterfly
-   Calendar spreads
-   Vertical spreads
-   Ratio spreads

Allow creation of **custom multi-leg strategies**.

------------------------------------------------------------------------

## 4. Strategy Execution Model

Strategies must be defined using a **config driven system**.

Example:

``` yaml
strategy:
  name: iron_condor

entry:
  time: 09:45
  conditions:
    - iv_percentile > 50
    - trend == neutral

legs:
  - sell_call_otm: 200
  - sell_put_otm: 200
  - buy_call_otm: 400
  - buy_put_otm: 400

exit:
  stop_loss: 2x_credit
  target_profit: 50%
  exit_time: 15:15
```

------------------------------------------------------------------------

# AI Strategy Learning System

Implement an **AI agent that learns across expiries**.

Workflow:

    Expiry 1
       ↓
    Run strategy
       ↓
    Analyze results
       ↓
    Update parameters
       ↓
    Apply to next expiry

The AI should improve strategies by:

-   Parameter optimization
-   Strike distance adjustments
-   Entry timing adjustments
-   Exit logic improvements

Possible approaches:

-   Bayesian optimization
-   Reinforcement learning
-   Genetic algorithms
-   Monte Carlo simulations

------------------------------------------------------------------------

# AI Learning Memory

All observations must be stored.

Create a **learning repository**.

Example structure:

    /ai_learning/
       learning_history.json
       strategy_evolution.json
       parameter_changes.json

Each run must record:

-   Strategy used
-   Parameters
-   Market conditions
-   Result
-   Improvements

Example:

    expiry: 2023-08-31

    changes:
      strike_distance:
          previous: 100
          new: 150

    reason:
      previous drawdown too high

    result:
      pnl_improvement: 18%
      drawdown_reduction: 22%

This learning history must guide **future strategy runs**.

------------------------------------------------------------------------

# Strategy Research Portal (Web UI)

Develop a **modern research interface**.

Recommended stack:

Frontend:

-   React
-   TypeScript
-   Tailwind
-   ShadCN UI
-   Zustand state management

Charts:

-   TradingView Lightweight Charts
-   Plotly
-   D3.js

------------------------------------------------------------------------

# Portal Features

## Strategy Builder

Users can:

-   Create strategies
-   Configure parameters
-   Save strategy templates

------------------------------------------------------------------------

## Backtesting Dashboard

Display:

-   Net PnL
-   Win rate
-   Drawdown
-   Sharpe ratio
-   Sortino ratio
-   Profit factor
-   Equity curve

------------------------------------------------------------------------

## Strategy Comparison

Compare multiple runs:

-   Equity curves
-   Drawdowns
-   Risk metrics
-   Trade distributions

------------------------------------------------------------------------

## Trade Log Viewer

Display every trade:

-   Entry
-   Exit
-   Leg prices
-   Greeks
-   PnL

------------------------------------------------------------------------

# Strategy Animation

Users must be able to:

Select an expiry and replay strategy minute by minute.

During playback show:

-   Underlying movement
-   Options price changes
-   Position PnL
-   Strategy payoff graph

------------------------------------------------------------------------

# Payoff Visualization

Display dynamic payoff graph that updates during simulation.

Include:

-   Break-even points
-   Max loss
-   Max profit
-   Current PnL

------------------------------------------------------------------------

# Option Chain Viewer

Provide historical option chain explorer.

Display:

-   Strike
-   LTP
-   IV
-   OI
-   Volume
-   Greeks

Allow filtering by:

-   Moneyness
-   Strike range
-   Expiry

------------------------------------------------------------------------

# Backend Architecture

Recommended backend stack:

Python + FastAPI

Key modules:

    backend/
       data_engine/
       strategy_engine/
       backtester/
       ai_optimizer/
       analytics/
       api/

------------------------------------------------------------------------

# Data Storage

Backtest results must be stored.

Use:

-   DuckDB or PostgreSQL

Tables:

    strategies
    backtest_runs
    trades
    parameters
    expiry_results
    ai_learning

------------------------------------------------------------------------

# Performance Requirements

The platform must:

-   Handle multi-year historical datasets
-   Run thousands of simulations
-   Use multi-core processing
-   Support parallel strategy testing

Optimization ideas:

-   Vectorized computation
-   Lazy data loading
-   Memory mapping
-   Caching
-   Parallel processing

------------------------------------------------------------------------

# Deliverables

Provide:

1.  Full architecture
2.  Project folder structure
3.  Backend modules
4.  Strategy execution engine
5.  AI learning agent design
6.  Frontend architecture
7.  Example strategy implementations
8.  Performance optimization techniques

Focus heavily on:

-   speed
-   scalability
-   AI learning
-   quant research usability
