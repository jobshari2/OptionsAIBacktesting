"""
Adaptive Trading API routes — endpoints for the adaptive backtest engine
with adjustment monitoring, risk dashboard, and Greeks analytics.
"""
import time
import threading

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional

from backend.intelligence import MetaController
from backend.data_engine.expiry_discovery import ExpiryDiscovery
from backend.logger import logger

router = APIRouter(prefix="/api/adaptive", tags=["Adaptive Engine"])

# Shared controller instance
_controller = MetaController()
_expiry_discovery = ExpiryDiscovery()

# Stop flags for adaptive backtests
_stop_flags: dict[str, bool] = {}
# Store running run_ids for progress tracking
_adaptive_progress: dict[str, dict] = {}


# --- Request Models ---

class AdaptiveBacktestRequest(BaseModel):
    """Request to run an adaptive backtest with full risk management."""
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    initial_capital: float = 1000000.0
    regime_check_interval: int = 15
    min_confidence: float = 0.6
    switch_cooldown: int = 30
    max_delta: float = 500.0
    enable_adjustments: bool = True
    selected_expiries: Optional[list[str]] = None


# --- Endpoints ---

@router.get("/")
async def adaptive_info():
    """Adaptive engine health and info."""
    logger.info("GET /api/adaptive/ — Adaptive engine info requested")
    return {
        "name": "Adaptive Options Trading Engine",
        "version": "1.0.0",
        "modules": ["AdjustmentEngine", "RiskManager", "PositionMonitor"],
        "adjustment_types": [
            "condor_breakout", "risk_reduction", "trend_reversal", "time_decay"
        ],
    }


@router.get("/expiries")
async def list_expiries(start_date: Optional[str] = None, end_date: Optional[str] = None):
    """
    List all available expiry dates for the adaptive backtest.
    Returns a list of expiry dates in DD/MM/YYYY format.
    """
    logger.info(f"GET /api/adaptive/expiries — start={start_date}, end={end_date}")
    try:
        if start_date or end_date:
            expiries = _expiry_discovery.filter_by_date_range(start_date, end_date)
        else:
            expiries = _expiry_discovery.discover_all()

        result = [
            {"folder_name": e["folder_name"], "date_str": e["date_str"]}
            for e in expiries
        ]
        logger.info(f"GET /api/adaptive/expiries — Found {len(result)} expiries")
        return {"expiries": result, "total": len(result)}
    except Exception as e:
        logger.error(f"GET /api/adaptive/expiries — Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def _run_adaptive_task(request: AdaptiveBacktestRequest, run_id: str):
    """Background task to run adaptive backtest."""
    logger.info(f"Background adaptive backtest task started: run_id={run_id}")
    start_time = time.time()
    try:
        _adaptive_progress[run_id] = {
            "status": "running",
            "message": "Starting adaptive backtest...",
        }

        _controller.switch_cooldown_minutes = request.switch_cooldown

        result = _controller.run_adaptive_backtest(
            start_date=request.start_date,
            end_date=request.end_date,
            initial_capital=request.initial_capital,
            regime_check_interval=request.regime_check_interval,
            min_confidence=request.min_confidence,
            max_delta=request.max_delta,
            enable_adjustments=request.enable_adjustments,
            run_id=run_id,
            selected_expiries=request.selected_expiries,
            stop_flag=_stop_flags,
        )

        elapsed = time.time() - start_time
        logger.info(
            f"Background adaptive backtest completed: run_id={run_id}, "
            f"elapsed={elapsed:.1f}s, trades={result.total_trades}, "
            f"pnl={result.total_pnl:.0f}, adjustments={result.total_adjustments}"
        )
        _adaptive_progress[run_id] = {
            "status": "completed",
            "message": "Adaptive backtest completed",
        }
    except Exception as e:
        elapsed = time.time() - start_time
        if _stop_flags.get(run_id):
            logger.info(f"Adaptive backtest stopped by user: run_id={run_id}, elapsed={elapsed:.1f}s")
            _adaptive_progress[run_id] = {
                "status": "stopped",
                "message": "Stopped by user",
            }
        else:
            logger.error(f"Error in adaptive backtest task: run_id={run_id}, elapsed={elapsed:.1f}s, error={e}")
            _adaptive_progress[run_id] = {
                "status": "error",
                "message": str(e),
            }
    finally:
        _stop_flags.pop(run_id, None)


@router.post("/run")
async def run_adaptive_backtest(request: AdaptiveBacktestRequest, background_tasks: BackgroundTasks):
    """
    Run a full adaptive backtest with adjustment engine, risk management,
    and position monitoring. Runs in background.

    Returns:
        run_id and status for tracking.
    """
    import uuid
    run_id = str(uuid.uuid4())[:8]

    logger.info(
        f"POST /api/adaptive/run — Starting adaptive backtest: run_id={run_id}, "
        f"dates={request.start_date} to {request.end_date}, "
        f"capital={request.initial_capital}, "
        f"delta_limit={request.max_delta}, adjustments={request.enable_adjustments}, "
        f"selected_expiries={len(request.selected_expiries or [])} expiries"
    )

    _stop_flags[run_id] = False
    _adaptive_progress[run_id] = {"status": "starting", "message": "Initializing..."}

    background_tasks.add_task(_run_adaptive_task, request, run_id)

    return {"run_id": run_id, "status": "running"}


@router.get("/status/{run_id}")
async def get_adaptive_status(run_id: str):
    """Get the live status of an adaptive backtest run."""
    logger.debug(f"GET /api/adaptive/status/{run_id}")

    # Check if result is ready
    result = _controller.get_adaptive_result(run_id)
    if result:
        return {"run_id": run_id, "status": "completed"}

    progress = _adaptive_progress.get(run_id)
    if progress:
        return {"run_id": run_id, **progress}

    raise HTTPException(status_code=404, detail=f"Run {run_id} not found")


@router.post("/stop/{run_id}")
async def stop_adaptive_backtest(run_id: str):
    """Stop a running adaptive backtest."""
    logger.info(f"POST /api/adaptive/stop/{run_id} — Stop requested")
    if run_id in _stop_flags:
        _stop_flags[run_id] = True
        _adaptive_progress[run_id] = {"status": "stopping", "message": "Stop requested..."}
        logger.info(f"POST /api/adaptive/stop/{run_id} — Stop flag set")
        return {"status": "success", "message": f"Stop requested for run {run_id}"}
    logger.warning(f"POST /api/adaptive/stop/{run_id} — Run not found or not running")
    raise HTTPException(status_code=400, detail=f"Run '{run_id}' not found or not running")


@router.get("/result/{run_id}")
async def get_adaptive_result(run_id: str):
    """Get the full result of a completed adaptive backtest."""
    logger.info(f"GET /api/adaptive/result/{run_id}")
    result = _controller.get_adaptive_result(run_id)
    if not result:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
    logger.info(f"GET /api/adaptive/result/{run_id} — Returning result with {result.total_trades} trades")
    return result.to_dict()


@router.get("/risk-dashboard/{run_id}")
async def get_risk_dashboard(run_id: str):
    """
    Get risk dashboard data for a completed adaptive backtest.

    Returns risk events, risk summary, and Greeks exposure summary.
    """
    logger.info(f"GET /api/adaptive/risk-dashboard/{run_id}")
    result = _controller.get_adaptive_result(run_id)
    if not result:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

    logger.info(
        f"GET /api/adaptive/risk-dashboard/{run_id} — "
        f"{len(result.risk_events)} risk events, "
        f"max_delta={result.greeks_summary.get('max_delta', 0):.0f}"
    )
    return {
        "run_id": run_id,
        "risk_events": result.risk_events,
        "risk_summary": result.risk_summary,
        "greeks_summary": result.greeks_summary,
    }


@router.get("/adjustments/{run_id}")
async def get_adjustments(run_id: str):
    """
    Get adjustment history for a completed adaptive backtest.

    Shows all strategy conversions that were detected during the run.
    """
    logger.info(f"GET /api/adaptive/adjustments/{run_id}")
    result = _controller.get_adaptive_result(run_id)
    if not result:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

    # Group adjustments by type
    by_type: dict[str, int] = {}
    for adj in result.adjustment_history:
        t = adj.get("adjustment_type", "unknown")
        by_type[t] = by_type.get(t, 0) + 1

    logger.info(
        f"GET /api/adaptive/adjustments/{run_id} — "
        f"{result.total_adjustments} total adjustments, types={by_type}"
    )
    return {
        "run_id": run_id,
        "total_adjustments": result.total_adjustments,
        "by_type": by_type,
        "adjustments": result.adjustment_history,
    }


@router.get("/greeks-timeline/{run_id}")
async def get_greeks_timeline(run_id: str):
    """
    Get minute-level Greeks exposure timeline for a completed adaptive backtest.

    Returns net delta, gamma, theta, and vega over time for visualization.
    """
    logger.info(f"GET /api/adaptive/greeks-timeline/{run_id}")
    result = _controller.get_adaptive_result(run_id)
    if not result:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

    logger.info(
        f"GET /api/adaptive/greeks-timeline/{run_id} — "
        f"{len(result.greeks_timeline)} timeline entries"
    )
    return {
        "run_id": run_id,
        "greeks_summary": result.greeks_summary,
        "timeline": result.greeks_timeline,
    }


@router.get("/position-snapshot/{run_id}/{expiry}")
async def get_position_snapshot(run_id: str, expiry: str):
    """
    Get detailed position snapshots for a specific expiry in an adaptive backtest.
    """
    logger.info(f"GET /api/adaptive/position-snapshot/{run_id}/{expiry}")
    result = _controller.get_adaptive_result(run_id)
    if not result:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

    # Filter greeks timeline by expiry
    expiry_snapshots = [
        g for g in result.greeks_timeline
        if g.get("expiry", "") == expiry
    ]

    # Find matching expiry result
    expiry_result = None
    for er in result.expiry_results:
        if er.get("expiry", "") == expiry:
            expiry_result = er
            break

    # Filter adjustments for this expiry
    expiry_adjustments = [
        a for a in result.adjustment_history
        if expiry in a.get("timestamp", "")
    ]

    logger.info(
        f"GET /api/adaptive/position-snapshot/{run_id}/{expiry} — "
        f"{len(expiry_snapshots)} snapshots, {len(expiry_adjustments)} adjustments"
    )
    return {
        "run_id": run_id,
        "expiry": expiry,
        "expiry_result": expiry_result,
        "greeks_timeline": expiry_snapshots,
        "adjustments": expiry_adjustments,
    }
