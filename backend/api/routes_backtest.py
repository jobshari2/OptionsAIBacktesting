"""
Backtest API routes — run backtests, get results, animation data.
"""
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional

from backend.backtester.engine import BacktestEngine
from backend.strategy_engine import Strategy, StrategyLoader
from backend.analytics.metrics import MetricsCalculator
from backend.analytics.payoff import PayoffCalculator
from backend.storage.database import get_database

router = APIRouter(prefix="/api/backtest", tags=["Backtest"])

backtest_engine = BacktestEngine()
strategy_loader = StrategyLoader()
metrics_calc = MetricsCalculator()


class BacktestRequest(BaseModel):
    """Request to run a backtest."""
    strategy_name: Optional[str] = None
    strategy_config: Optional[dict] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    initial_capital: float = 1000000.0


class AnimationRequest(BaseModel):
    """Request for animation data."""
    strategy_name: Optional[str] = None
    strategy_config: Optional[dict] = None
    expiry_folder: str = ""


def _run_backtest_task(strategy: Strategy, request: BacktestRequest, run_id: str):
    """Background task to run backtest and save results."""
    try:
        # Run backtest
        result = backtest_engine.run_backtest(
            strategy=strategy,
            start_date=request.start_date,
            end_date=request.end_date,
            initial_capital=request.initial_capital,
            run_id=run_id
        )

        # Calculate metrics
        trade_dicts = [{"pnl": t.pnl} for t in result.trades]
        metrics = metrics_calc.calculate_all_metrics(
            trade_dicts, request.initial_capital
        )

        # Save to database
        db = get_database()
        result_data = result.to_dict()
        result_data["metrics"] = metrics
        result_data["initial_capital"] = request.initial_capital
        result_data["final_capital"] = request.initial_capital + result.total_pnl
        db.save_backtest_run(result_data)
        db.save_trades(result.run_id, result_data["trades"])
    except Exception as e:
        print(f"Error in backtest task {run_id}: {e}")
        if run_id in backtest_engine.progress:
            backtest_engine.progress[run_id]["status"] = "error"
            backtest_engine.progress[run_id]["error"] = str(e)


@router.post("/run")
async def run_backtest(request: BacktestRequest, background_tasks: BackgroundTasks):
    """Run a backtest with a strategy asynchronously."""
    try:
        # Load or create strategy
        if request.strategy_config:
            strategy = Strategy.from_dict(request.strategy_config)
        elif request.strategy_name:
            strategy = strategy_loader.load_strategy(request.strategy_name)
        else:
            raise HTTPException(
                status_code=400,
                detail="Provide either strategy_name or strategy_config",
            )
            
        import uuid
        run_id = str(uuid.uuid4())[:8]

        # Initialize progress tracking
        backtest_engine.progress[run_id] = {
            "status": "starting",
            "completed": 0,
            "total": 0,
            "current_expiry": None
        }

        # Run backtest in background
        background_tasks.add_task(_run_backtest_task, strategy, request, run_id)

        return {"run_id": run_id, "status": "running"}

    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status/{run_id}")
async def get_status(run_id: str):
    """Get the live status of a backtest run."""
    # First check if it's completed and available as a result
    try:
        # If we can get it from the fast in-memory results, it's done
        if run_id in backtest_engine.results:
            return {"run_id": run_id, "status": "completed"}
            
        db = get_database()
        if db.get_backtest_run(run_id):
             return {"run_id": run_id, "status": "completed"}
    except Exception:
        pass
        
    # Check progress tracker
    progress = backtest_engine.progress.get(run_id)
    if progress:
        return {"run_id": run_id, **progress}
        
    # If not found anywhere
    raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found or no progress available")


@router.post("/stop/{run_id}")
async def stop_backtest(run_id: str):
    """Stop a running backtest."""
    success = backtest_engine.stop_backtest(run_id)
    if success:
        return {"status": "success", "message": f"Stop requested for run {run_id}"}
    raise HTTPException(status_code=400, detail=f"Could not stop run '{run_id}'. It may not exist or is not currently running.")


@router.get("/results")
async def list_results():
    """List all backtest results."""
    try:
        db = get_database()
        runs = db.get_backtest_runs()
        return {"results": runs}
    except Exception as e:
        # Fall back to in-memory results
        return {"results": backtest_engine.list_results()}


@router.get("/results/{run_id}")
async def get_result(run_id: str):
    """Get a specific backtest result."""
    try:
        # Try database first
        db = get_database()
        run = db.get_backtest_run(run_id)
        if run:
            trades = db.get_trades_for_run(run_id)
            run["trades"] = trades
            return run

        # Fall back to in-memory
        result = backtest_engine.get_result(run_id)
        if result:
            return result.to_dict()

        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/trades/{run_id}")
async def get_trades(run_id: str):
    """Get trade log for a backtest run."""
    try:
        db = get_database()
        trades = db.get_trades_for_run(run_id)
        if trades:
            return {"run_id": run_id, "trades": trades}

        # Fall back to in-memory
        result = backtest_engine.get_result(run_id)
        if result:
            return {
                "run_id": run_id,
                "trades": [
                    {
                        "trade_id": t.trade_id,
                        "expiry": t.expiry,
                        "entry_time": t.entry_time,
                        "exit_time": t.exit_time,
                        "pnl": t.pnl,
                        "pnl_points": t.pnl_points,
                        "exit_reason": t.exit_reason,
                        "legs": t.legs,
                    }
                    for t in result.trades
                ],
            }

        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/animation")
async def get_animation_data(request: AnimationRequest):
    """Get minute-by-minute animation data for strategy replay."""
    try:
        if request.strategy_config:
            strategy = Strategy.from_dict(request.strategy_config)
        elif request.strategy_name:
            strategy = strategy_loader.load_strategy(request.strategy_name)
        else:
            raise HTTPException(
                status_code=400,
                detail="Provide either strategy_name or strategy_config",
            )

        if not request.expiry_folder:
            raise HTTPException(
                status_code=400,
                detail="expiry_folder is required",
            )

        frames = backtest_engine.get_animation_data(strategy, request.expiry_folder)
        return {
            "expiry": request.expiry_folder,
            "strategy": strategy.name,
            "total_frames": len(frames),
            "frames": frames,
        }
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
