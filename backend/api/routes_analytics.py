"""
Analytics API routes — performance metrics, payoff diagrams, comparisons.
"""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from backend.analytics.metrics import MetricsCalculator
from backend.analytics.payoff import PayoffCalculator
from backend.analytics.greeks import GreeksCalculator
from backend.backtester.engine import BacktestEngine
from backend.storage.database import get_database
from backend.logger import logger

router = APIRouter(prefix="/api/analytics", tags=["Analytics"])

metrics_calc = MetricsCalculator()
payoff_calc = PayoffCalculator()
greeks_calc = GreeksCalculator()
backtest_engine = BacktestEngine()


@router.get("/metrics/{run_id}")
async def get_metrics(run_id: str):
    """Get performance metrics for a backtest run."""
    logger.info(f"Fetching metrics for run_id {run_id}")
    try:
        # Get trades from DB or in-memory
        db = get_database()
        trades = db.get_trades_for_run(run_id)

        if not trades:
            result = backtest_engine.get_result(run_id)
            if result:
                trades = [{"pnl": t.pnl} for t in result.trades]
            else:
                raise HTTPException(status_code=404, detail="Run not found")

        metrics = metrics_calc.calculate_all_metrics(trades)
        return {"run_id": run_id, "metrics": metrics}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error calculating metrics for {run_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class PayoffRequest(BaseModel):
    legs: list[dict]
    spot_price: float
    lot_size: int = 25
    range_pct: float = 10.0


@router.post("/payoff")
async def calculate_payoff(request: PayoffRequest):
    """Calculate payoff diagram for a strategy."""
    logger.info(f"Calculating payoff diagram for {len(request.legs)} legs")
    try:
        result = payoff_calc.calculate_strategy_payoff(
            legs=request.legs,
            spot_price=request.spot_price,
            lot_size=request.lot_size,
            range_pct=request.range_pct,
        )
        return result
    except Exception as e:
        logger.error(f"Error calculating payoff: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class GreeksRequest(BaseModel):
    spot_price: float
    strike: float
    time_to_expiry: float  # In years
    risk_free_rate: float = 0.065
    volatility: float = 0.2
    option_type: str = "CE"


@router.post("/greeks")
async def calculate_greeks(request: GreeksRequest):
    """Calculate option Greeks."""
    logger.info("Calculating option Greeks")
    try:
        greeks = greeks_calc.all_greeks(
            S=request.spot_price,
            K=request.strike,
            T=request.time_to_expiry,
            r=request.risk_free_rate,
            sigma=request.volatility,
            option_type=request.option_type,
        )
        return {"greeks": greeks}
    except Exception as e:
        logger.error(f"Error calculating Greeks: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class IVRequest(BaseModel):
    market_price: float
    spot_price: float
    strike: float
    time_to_expiry: float
    risk_free_rate: float = 0.065
    option_type: str = "CE"


@router.post("/implied-volatility")
async def calculate_iv(request: IVRequest):
    """Calculate implied volatility."""
    logger.info("Calculating implied volatility")
    try:
        iv = greeks_calc.implied_volatility(
            market_price=request.market_price,
            S=request.spot_price,
            K=request.strike,
            T=request.time_to_expiry,
            r=request.risk_free_rate,
            option_type=request.option_type,
        )
        return {"implied_volatility": iv, "iv_pct": iv * 100}
    except Exception as e:
        logger.error(f"Error calculating implied volatility: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/compare")
async def compare_runs(
    run_ids: str = Query(..., description="Comma-separated run IDs"),
):
    """Compare multiple backtest runs."""
    logger.info(f"Comparing backtest runs: {run_ids}")
    try:
        ids = [r.strip() for r in run_ids.split(",")]
        comparisons = []

        for run_id in ids:
            db = get_database()
            run = db.get_backtest_run(run_id)
            if run:
                trades = db.get_trades_for_run(run_id)
                metrics = metrics_calc.calculate_all_metrics(trades)
                comparisons.append({
                    "run_id": run_id,
                    "strategy_name": run.get("strategy_name"),
                    "metrics": metrics,
                })
            else:
                result = backtest_engine.get_result(run_id)
                if result:
                    trade_dicts = [{"pnl": t.pnl} for t in result.trades]
                    metrics = metrics_calc.calculate_all_metrics(trade_dicts)
                    comparisons.append({
                        "run_id": run_id,
                        "strategy_name": result.strategy_name,
                        "metrics": metrics,
                    })

        return {"comparisons": comparisons}
    except Exception as e:
        logger.error(f"Error comparing runs: {e}")
        raise HTTPException(status_code=500, detail=str(e))
