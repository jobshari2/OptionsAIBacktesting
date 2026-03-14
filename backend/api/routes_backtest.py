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
from backend.logger import logger

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
    logger.info(f"Starting background backtest task for strategy '{strategy.name}' with run_id {run_id}")
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
        logger.info(f"Background backtest task {run_id} completed successfully")
    except Exception as e:
        logger.error(f"Error in backtest task {run_id}: {e}")
        if run_id in backtest_engine.progress:
            backtest_engine.progress[run_id]["status"] = "error"
            backtest_engine.progress[run_id]["error"] = str(e)


@router.post("/run")
async def run_backtest(request: BacktestRequest, background_tasks: BackgroundTasks):
    """Run a backtest with a strategy asynchronously."""
    logger.info("Received request to run backtest")
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
        logger.warning(f"File not found during backtest run request: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        logger.warning(f"Validation error during backtest run request: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error initiating backtest run: {e}")
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
    logger.info(f"Stopping backtest run {run_id}")
    success = backtest_engine.stop_backtest(run_id)
    if success:
        logger.info(f"Successfully stopped backtest run {run_id}")
        return {"status": "success", "message": f"Stop requested for run {run_id}"}
    logger.warning(f"Failed to stop backtest run {run_id}")
    raise HTTPException(status_code=400, detail=f"Could not stop run '{run_id}'. It may not exist or is not currently running.")


@router.get("/results")
async def list_results():
    """List all backtest results."""
    logger.info("Listing all backtest results")
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
    logger.info(f"Fetching result for backtest run {run_id}")
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
    logger.info(f"Fetching trades for backtest run {run_id}")
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
    logger.info(f"Fetching animation data for strategy {request.strategy_name or 'config'} on expiry {request.expiry_folder}")
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


# ── Mean Reversion Multi-Expiry Backtest ──────────────────────────────────────

class MRBacktestRequest(BaseModel):
    """Request to run Mean Reversion Z-Score strategy across multiple expiries."""
    window: int = 20
    entry_z: float = 2.0
    exit_z: float = 0.0
    stop_z: float = 4.0
    trading_hours_only: bool = True
    num_expiries: int = 10
    num_lots: int = 1
    lot_size: int = 25
    initial_budget: float = 100000.0
    use_unified: Optional[bool] = None


def _mr_compute_zscore_series(closes: list, dates: list, window: int) -> list:
    """Compute rolling Z-Score series from a list of close prices."""
    import math
    result = []
    for i in range(window, len(closes)):
        wnd = closes[i - window:i]
        ma = sum(wnd) / window
        variance = sum((x - ma) ** 2 for x in wnd) / window
        std = math.sqrt(variance)
        z = (closes[i] - ma) / std if std > 0 else 0.0
        result.append({
            "time": dates[i],
            "close": closes[i],
            "ma": ma,
            "std": std,
            "z": round(z, 3),
        })
    return result


def _mr_generate_raw_trades(
    zscore_series: list,
    entry_z: float,
    exit_z: float,
    stop_z: float,
    trading_hours_only: bool,
) -> list:
    """Simulate Mean Reversion Z-Score trades from a Z-Score series."""
    from datetime import datetime

    trades = []
    position = None        # 'LONG' | 'SHORT' | None
    entry_price = 0.0
    entry_z_val = 0.0
    entry_time = None
    entry_idx = 0
    option_type = "CE"
    strike = 0

    for i, bar in enumerate(zscore_series):
        z = bar["z"]
        dt = bar["time"]

        # Filter non-trading hours (09:20–15:15)
        if trading_hours_only and dt is not None:
            if isinstance(dt, datetime):
                hh, mm = dt.hour, dt.minute
            else:
                # polars datetime might be a python datetime-like, fallback
                try:
                    hh, mm = dt.hour, dt.minute
                except AttributeError:
                    hh, mm = 9, 20   # safe default: include bar
            mins = hh * 60 + mm
            if mins < 9 * 60 + 20 or mins > 15 * 60 + 15:
                continue

        if position is None:
            if z < -entry_z:
                position = "LONG"
                entry_price, entry_z_val, entry_time, entry_idx = bar["close"], z, dt, i
                option_type = "CE"
                strike = round(bar["close"] / 50) * 50
            elif z > entry_z:
                position = "SHORT"
                entry_price, entry_z_val, entry_time, entry_idx = bar["close"], z, dt, i
                option_type = "PE"
                strike = round(bar["close"] / 50) * 50

        elif position == "LONG":
            exit_reason = ""
            if z >= exit_z:
                exit_reason = "Mean Reversion"
            elif z < -stop_z:
                exit_reason = "Stop Loss"
            if exit_reason:
                trades.append({
                    "type": "LONG", "entry_time": entry_time, "entry_price": entry_price,
                    "entry_z": entry_z_val, "exit_time": dt, "exit_price": bar["close"],
                    "exit_z": z, "exit_reason": exit_reason,
                    "duration_bars": i - entry_idx, "strike": strike, "option_type": option_type,
                })
                position = None

        elif position == "SHORT":
            exit_reason = ""
            if z <= -exit_z:
                exit_reason = "Mean Reversion"
            elif z > stop_z:
                exit_reason = "Stop Loss"
            if exit_reason:
                trades.append({
                    "type": "SHORT", "entry_time": entry_time, "entry_price": entry_price,
                    "entry_z": entry_z_val, "exit_time": dt, "exit_price": bar["close"],
                    "exit_z": z, "exit_reason": exit_reason,
                    "duration_bars": i - entry_idx, "strike": strike, "option_type": option_type,
                })
                position = None

    return trades


@router.post("/mean-reversion")
async def run_mean_reversion_backtest(req: MRBacktestRequest):
    """
    Run the Mean Reversion Z-Score strategy across the last N expiries.

    Returns per-expiry trade lists with option P&L, a consolidated summary,
    and a full parameter sweep (Entry Z × Exit Z × Stop Z) sorted by total P&L.
    """
    import math
    import time
    import polars as pl
    from datetime import datetime
    from backend.data_engine import DataLoader, ExpiryDiscovery

    # ── Parameter sweep grid ──────────────────────────────────────────────────
    WINDOW_VALS  = [10, 15, 20, 30]
    ENTRY_Z_VALS = [1.0, 1.5, 2.0, 2.5, 3.0]
    EXIT_Z_VALS  = [0.0, 0.25, 0.5, 1.0]
    STOP_Z_VALS  = [3.0, 3.5, 4.0, 5.0]
    PARAM_COMBOS = [
        (wn, ez, xz, sz)
        for wn in WINDOW_VALS
        for ez in ENTRY_Z_VALS
        for xz in EXIT_Z_VALS
        for sz in STOP_Z_VALS
    ]

    # Trading mode: auto_lots (num_lots==0) uses initial_budget to pick affordable lots per trade.
    # At most 20% of current capital is risked per trade to prevent over-allocation.
    MAX_RISK_FRACTION = 0.20
    auto_lots_mode = (req.num_lots == 0)
    fixed_lots     = req.num_lots if req.num_lots > 0 else 1

    def _affordable_lots(capital: float, option_price: float, lot_sz: int) -> int:
        """Max lots buyable with at most MAX_RISK_FRACTION of capital."""
        if option_price <= 0 or lot_sz <= 0:
            return 1
        cost_per_lot = option_price * lot_sz
        max_alloc    = max(capital * MAX_RISK_FRACTION, cost_per_lot)  # always at least 1 lot
        return max(1, int(max_alloc / cost_per_lot))

    def _fmt_iso(dt_val: datetime) -> str:
        if isinstance(dt_val, datetime):
            return dt_val.strftime("%Y-%m-%d %H:%M:%S")
        return str(dt_val)

    def _fmt_display(dt_val: datetime) -> str:
        if isinstance(dt_val, datetime):
            return dt_val.strftime("%d/%m/%Y %H:%M:%S")
        return str(dt_val)

    def _agg_metrics(pnl_list: list) -> dict:
        """Compute aggregated metrics from a flat list of trade P&L values."""
        if not pnl_list:
            return {
                "total_trades": 0, "wins": 0, "losses": 0, "win_rate": 0.0,
                "total_pnl": 0.0, "gross_profit": 0.0, "gross_loss": 0.0,
                "profit_factor": None, "max_drawdown": 0.0, "avg_pnl": 0.0, "sharpe": 0.0,
            }
        wins_l   = [p for p in pnl_list if p > 0]
        losses_l = [p for p in pnl_list if p <= 0]
        gp = sum(wins_l)
        gl = abs(sum(losses_l))
        peak = cum = maxdd = 0.0
        for p in pnl_list:
            cum += p
            if cum > peak:
                peak = cum
            dd = peak - cum
            if dd > maxdd:
                maxdd = dd
        mean_p = sum(pnl_list) / len(pnl_list)
        std_p = (
            math.sqrt(sum((p - mean_p) ** 2 for p in pnl_list) / len(pnl_list))
            if len(pnl_list) > 1 else 0.0
        )
        sharpe = round((mean_p / std_p) * math.sqrt(252), 2) if std_p > 0 else 0.0
        return {
            "total_trades": len(pnl_list),
            "wins": len(wins_l),
            "losses": len(losses_l),
            "win_rate": round(len(wins_l) / len(pnl_list) * 100, 1),
            "total_pnl": round(sum(pnl_list), 2),
            "gross_profit": round(gp, 2),
            "gross_loss": round(gl, 2),
            "profit_factor": round(gp / gl, 2) if gl > 0 else None,
            "max_drawdown": round(maxdd, 2),
            "avg_pnl": round(mean_p, 2),
            "sharpe": sharpe,
        }

    start = time.time()
    logger.info(
        f"MR multi-expiry backtest: window={req.window}, entry_z={req.entry_z}, "
        f"exit_z={req.exit_z}, stop_z={req.stop_z}, num_expiries={req.num_expiries}, "
        f"sweep_combos={len(PARAM_COMBOS)}"
    )

    try:
        ed = ExpiryDiscovery()
        all_expiries = ed.discover_all()
        if not all_expiries:
            raise HTTPException(status_code=404, detail="No expiry data found")

        test_expiries = all_expiries[-req.num_expiries:]
        dl = DataLoader()

        # ── Phase 1: Pre-load all expiry data once ────────────────────────────
        # Keyed by folder name → {valid, date_str, zscore_series, opt_df, error?}
        expiry_cache: dict = {}

        for expiry_info in test_expiries:
            folder   = expiry_info["folder_name"]
            date_str = expiry_info["date_str"]
            try:
                idx_df = dl.load_index(folder, use_unified=req.use_unified)
                if idx_df.is_empty() or len(idx_df) < req.window + 1:
                    expiry_cache[folder] = {
                        "valid": False, "date_str": date_str,
                        "error": f"Insufficient index data ({len(idx_df)} bars, need >{req.window})",
                    }
                    continue

                idx_df = idx_df.sort("Date")
                zscore_series = _mr_compute_zscore_series(
                    idx_df["Close"].to_list(), idx_df["Date"].to_list(), req.window
                )
                if not zscore_series:
                    expiry_cache[folder] = {"valid": False, "date_str": date_str, "error": "Could not compute Z-Scores"}
                    continue

                opt_df = dl.load_options(folder, use_unified=req.use_unified)
                if opt_df.is_empty():
                    expiry_cache[folder] = {"valid": False, "date_str": date_str, "error": "No option data found"}
                    continue

                if opt_df.schema.get("Date") == pl.Utf8:
                    opt_df = opt_df.with_columns(pl.col("Date").str.to_datetime().alias("Date"))
                opt_df = opt_df.with_columns(
                    pl.col("Date").dt.strftime("%Y-%m-%d %H:%M:%S").alias("DateStr")
                )
                expiry_cache[folder] = {
                    "valid": True, "date_str": date_str,
                    "zscore_series": zscore_series, "opt_df": opt_df,
                }
            except Exception as e:
                logger.error(f"Pre-load error for {folder}: {e}", exc_info=True)
                expiry_cache[folder] = {"valid": False, "date_str": date_str, "error": str(e)}

        valid_folders = [f for f, c in expiry_cache.items() if c.get("valid")]

        # ── Phase 2: Main params — detailed per-expiry results ────────────────
        all_results = []
        running_capital = req.initial_budget   # compounds across all expiries

        for folder, cache in expiry_cache.items():
            date_str = cache["date_str"]
            if not cache.get("valid"):
                all_results.append({
                    "expiry": folder, "expiry_date": date_str,
                    "error": cache.get("error", "Unknown error"), "trades": [], "metrics": None,
                })
                continue

            raw_trades = _mr_generate_raw_trades(
                cache["zscore_series"], req.entry_z, req.exit_z, req.stop_z, req.trading_hours_only
            )
            if not raw_trades:
                all_results.append({
                    "expiry": folder, "expiry_date": date_str, "trades": [],
                    "metrics": {
                        "total_trades": 0, "wins": 0, "losses": 0, "win_rate": 0.0,
                        "total_pnl": 0.0, "gross_profit": 0.0, "gross_loss": 0.0,
                        "profit_factor": None, "max_drawdown": 0.0, "avg_pnl": 0.0, "sharpe": 0.0,
                    },
                })
                continue

            query_rows = (
                [{"qid": f"e{i}", "DateStr": _fmt_iso(t["entry_time"]), "Strike": t["strike"], "Right": t["option_type"]}
                 for i, t in enumerate(raw_trades)]
                + [{"qid": f"x{i}", "DateStr": _fmt_iso(t["exit_time"]),  "Strike": t["strike"], "Right": t["option_type"]}
                   for i, t in enumerate(raw_trades)]
            )
            qdf    = pl.DataFrame(query_rows)
            merged = qdf.join(cache["opt_df"], on=["DateStr", "Strike", "Right"], how="left")
            price_map = {
                r["qid"]: r["Close"]
                for r in merged.select(["qid", "Close"]).to_dicts()
                if r["Close"] is not None
            }

            enriched  = []
            pnl_list  = []
            for i, t in enumerate(raw_trades):
                opt_entry = price_map.get(f"e{i}")
                opt_exit  = price_map.get(f"x{i}")
                # Determine lots for this trade (auto mode: from current capital)
                if auto_lots_mode and opt_entry is not None and opt_entry > 0:
                    trade_lots = _affordable_lots(running_capital, opt_entry, req.lot_size)
                else:
                    trade_lots = fixed_lots
                capital_at_entry = round(running_capital, 2)
                opt_pnl = round((opt_exit - opt_entry) * trade_lots * req.lot_size, 2) if (opt_entry is not None and opt_exit is not None) else None
                if opt_pnl is not None:
                    pnl_list.append(opt_pnl)
                    running_capital = round(running_capital + opt_pnl, 2)
                enriched.append({
                    "num": i + 1, "type": t["type"], "strike": t["strike"],
                    "option_type": t["option_type"],
                    "entry_time": _fmt_display(t["entry_time"]),
                    "entry_price": round(t["entry_price"], 2), "entry_z": round(t["entry_z"], 3),
                    "exit_time": _fmt_display(t["exit_time"]),
                    "exit_price": round(t["exit_price"], 2), "exit_z": round(t["exit_z"], 3),
                    "exit_reason": t["exit_reason"], "duration_bars": t["duration_bars"],
                    "opt_entry": round(opt_entry, 2) if opt_entry is not None else None,
                    "opt_exit":  round(opt_exit,  2) if opt_exit  is not None else None,
                    "lots": trade_lots,
                    "capital_before": capital_at_entry,
                    "opt_pnl": opt_pnl,
                })

            metrics = _agg_metrics(pnl_list)
            all_results.append({"expiry": folder, "expiry_date": date_str, "trades": enriched, "metrics": metrics})

        # ── Phase 3: Parameter sweep — Window × Entry Z × Exit Z × Stop Z combos ──
        # Build per-(folder, window) zscore cache to avoid recomputing for same window
        window_zscore_cache: dict = {}   # (folder, window) → zscore_series | None

        def _get_zscores(folder: str, window: int):
            key = (folder, window)
            if key not in window_zscore_cache:
                cache = expiry_cache[folder]
                if not cache.get("valid"):
                    window_zscore_cache[key] = None
                else:
                    # reuse the already-loaded idx_df data by recomputing from opt_df dates
                    # We stored zscore_series for req.window; recompute for other windows from raw idx
                    try:
                        idx_df = dl.load_index(folder, use_unified=req.use_unified)
                        if idx_df.is_empty() or len(idx_df) < window + 1:
                            window_zscore_cache[key] = None
                        else:
                            idx_df = idx_df.sort("Date")
                            window_zscore_cache[key] = _mr_compute_zscore_series(
                                idx_df["Close"].to_list(), idx_df["Date"].to_list(), window
                            )
                    except Exception:
                        window_zscore_cache[key] = None
            return window_zscore_cache[key]

        # Pre-populate req.window entries from already-loaded cache
        for folder, cache in expiry_cache.items():
            if cache.get("valid"):
                window_zscore_cache[(folder, req.window)] = cache["zscore_series"]

        combo_pnls: dict = {f"{wn}_{ez}_{xz}_{sz}": [] for wn, ez, xz, sz in PARAM_COMBOS}
        combo_capitals: dict = {f"{wn}_{ez}_{xz}_{sz}": req.initial_budget for wn, ez, xz, sz in PARAM_COMBOS}

        for folder in valid_folders:
            cache = expiry_cache[folder]
            opt_df = cache["opt_df"]

            # Group combos by window so we only batch-join once per (folder, window)
            from itertools import groupby
            sorted_combos = sorted(PARAM_COMBOS, key=lambda x: x[0])
            for window_val, window_combos in groupby(sorted_combos, key=lambda x: x[0]):
                zs = _get_zscores(folder, window_val)
                if not zs:
                    continue

                window_combos = list(window_combos)
                all_qrows = []
                combo_trade_map: dict = {}

                for wn, ez, xz, sz in window_combos:
                    ckey = f"{wn}_{ez}_{xz}_{sz}"
                    rt = _mr_generate_raw_trades(zs, ez, xz, sz, req.trading_hours_only)
                    combo_trade_map[ckey] = rt
                    for i, t in enumerate(rt):
                        all_qrows.append({"qid": f"{ckey}_e{i}", "DateStr": _fmt_iso(t["entry_time"]),
                                          "Strike": t["strike"], "Right": t["option_type"]})
                        all_qrows.append({"qid": f"{ckey}_x{i}", "DateStr": _fmt_iso(t["exit_time"]),
                                          "Strike": t["strike"], "Right": t["option_type"]})

                if not all_qrows:
                    continue

                qdf    = pl.DataFrame(all_qrows)
                merged = qdf.join(opt_df, on=["DateStr", "Strike", "Right"], how="left")
                pm = {
                    r["qid"]: r["Close"]
                    for r in merged.select(["qid", "Close"]).to_dicts()
                    if r["Close"] is not None
                }

                for wn, ez, xz, sz in window_combos:
                    ckey = f"{wn}_{ez}_{xz}_{sz}"
                    cap  = combo_capitals[ckey]
                    for i in range(len(combo_trade_map[ckey])):
                        oe = pm.get(f"{ckey}_e{i}")
                        ox = pm.get(f"{ckey}_x{i}")
                        if oe is not None and ox is not None and oe > 0:
                            trade_lots = _affordable_lots(cap, oe, req.lot_size) if auto_lots_mode else fixed_lots
                            pnl = round((ox - oe) * trade_lots * req.lot_size, 2)
                            combo_pnls[ckey].append(pnl)
                            cap += pnl
                    combo_capitals[ckey] = cap

        param_sweep = []
        for wn, ez, xz, sz in PARAM_COMBOS:
            ckey = f"{wn}_{ez}_{xz}_{sz}"
            m = _agg_metrics(combo_pnls[ckey])
            param_sweep.append({"window": wn, "entry_z": ez, "exit_z": xz, "stop_z": sz, **m})

        param_sweep.sort(key=lambda x: x["total_pnl"], reverse=True)

        # ── Phase 4: Consolidated summary (for primary params) ───────────────
        valid_results = [r for r in all_results if r.get("metrics") and r["metrics"]["total_trades"] > 0]
        total_trades  = sum(r["metrics"]["total_trades"] for r in valid_results)
        total_pnl     = round(sum(r["metrics"]["total_pnl"] for r in valid_results), 2)
        total_wins    = sum(r["metrics"]["wins"]   for r in valid_results)
        total_losses  = sum(r["metrics"]["losses"] for r in valid_results)
        total_gp      = round(sum(r["metrics"]["gross_profit"] for r in valid_results), 2)
        total_gl      = round(sum(r["metrics"]["gross_loss"]   for r in valid_results), 2)
        overall_win_rate = (
            round((total_wins / (total_wins + total_losses)) * 100, 1)
            if (total_wins + total_losses) > 0 else 0.0
        )
        overall_pf = round(total_gp / total_gl, 2) if total_gl > 0 else None
        profitable = len([r for r in valid_results if r["metrics"]["total_pnl"] > 0])
        best  = max(valid_results, key=lambda r: r["metrics"]["total_pnl"]) if valid_results else None
        worst = min(valid_results, key=lambda r: r["metrics"]["total_pnl"]) if valid_results else None

        summary = {
            "total_expiries": len(all_results),
            "expiries_with_trades": len(valid_results),
            "profitable_expiries": profitable,
            "total_trades": total_trades,
            "total_wins": total_wins,
            "total_losses": total_losses,
            "win_rate": overall_win_rate,
            "total_pnl": total_pnl,
            "gross_profit": total_gp,
            "gross_loss": total_gl,
            "profit_factor": overall_pf,
            "avg_pnl_per_expiry": round(total_pnl / len(all_results), 2) if all_results else 0.0,
            "best_expiry":  {"folder": best["expiry"],  "date": best["expiry_date"],  "pnl": best["metrics"]["total_pnl"]}  if best  else None,
            "worst_expiry": {"folder": worst["expiry"], "date": worst["expiry_date"], "pnl": worst["metrics"]["total_pnl"]} if worst else None,
            "initial_budget": req.initial_budget,
            "final_capital": round(running_capital, 2),
        }

        return {
            "params": {
                "window": req.window, "entry_z": req.entry_z, "exit_z": req.exit_z,
                "stop_z": req.stop_z, "trading_hours_only": req.trading_hours_only,
                "num_expiries": req.num_expiries,
                "num_lots": req.num_lots, "lot_size": req.lot_size,
                "initial_budget": req.initial_budget, "auto_lots": auto_lots_mode,
            },
            "expiries_tested": len(all_results),
            "results": all_results,
            "summary": summary,
            "param_sweep": param_sweep,
            "time_ms": int((time.time() - start) * 1000),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unhandled error in MR multi-expiry backtest: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
