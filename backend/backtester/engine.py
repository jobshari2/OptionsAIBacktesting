"""
Backtesting engine — orchestrates strategy simulation across expiries.
Uses vectorized operations for high-performance backtesting.
"""
import polars as pl
import numpy as np
from datetime import datetime, time as dt_time
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Optional
import uuid
import json

from backend.config import config
from backend.data_engine import DataLoader, ExpiryDiscovery, DataJoiner
from backend.strategy_engine import Strategy, StrategyLoader
from backend.strategy_engine.leg_builder import LegBuilder
from .position_manager import PositionManager, Trade
from .simulator import TradeSimulator


@dataclass
class BacktestResult:
    """Stores the result of a single backtest run."""
    run_id: str
    strategy_name: str
    start_date: str
    end_date: str
    total_expiries: int
    trades: list[Trade]
    equity_curve: list[dict]
    daily_pnl: list[dict]
    expiry_results: list[dict]
    parameters: dict
    execution_time_ms: float = 0.0

    @property
    def total_pnl(self) -> float:
        return sum(t.pnl for t in self.trades)

    @property
    def total_trades(self) -> int:
        return len(self.trades)

    @property
    def winning_trades(self) -> int:
        return sum(1 for t in self.trades if t.pnl > 0)

    @property
    def losing_trades(self) -> int:
        return sum(1 for t in self.trades if t.pnl <= 0)

    @property
    def win_rate(self) -> float:
        if self.total_trades == 0:
            return 0.0
        return self.winning_trades / self.total_trades * 100

    def to_dict(self) -> dict:
        """Serialize result to dict."""
        return {
            "run_id": self.run_id,
            "strategy_name": self.strategy_name,
            "start_date": self.start_date,
            "end_date": self.end_date,
            "total_expiries": self.total_expiries,
            "total_trades": self.total_trades,
            "total_pnl": self.total_pnl,
            "win_rate": self.win_rate,
            "winning_trades": self.winning_trades,
            "losing_trades": self.losing_trades,
            "execution_time_ms": self.execution_time_ms,
            "parameters": self.parameters,
            "equity_curve": self.equity_curve,
            "daily_pnl": self.daily_pnl,
            "expiry_results": self.expiry_results,
            "trades": [
                {
                    "trade_id": t.trade_id,
                    "strategy_name": t.strategy_name,
                    "expiry": t.expiry,
                    "entry_time": t.entry_time,
                    "exit_time": t.exit_time,
                    "entry_premium": t.entry_premium,
                    "exit_premium": t.exit_premium,
                    "pnl": t.pnl,
                    "pnl_points": t.pnl_points,
                    "exit_reason": t.exit_reason,
                    "transaction_costs": t.transaction_costs,
                    "slippage_cost": t.slippage_cost,
                    "spot_at_entry": t.spot_at_entry,
                    "spot_at_exit": t.spot_at_exit,
                    "legs": t.legs,
                }
                for t in self.trades
            ],
        }


class BacktestEngine:
    """
    Main backtesting engine — runs strategies across historical data.
    """

    def __init__(self):
        self.data_loader = DataLoader()
        self.expiry_discovery = ExpiryDiscovery()
        self.simulator = TradeSimulator()
        self.results: dict[str, BacktestResult] = {}
        self.progress: dict[str, dict] = {}

    def run_backtest(
        self,
        strategy: Strategy,
        start_date: str | None = None,
        end_date: str | None = None,
        initial_capital: float = 1000000.0,
        run_id: str | None = None,
    ) -> BacktestResult:
        """
        Run a backtest for a strategy across multiple expiries.

        Args:
            strategy: Strategy to backtest
            start_date: Start date (YYYY-MM-DD)
            end_date: End date (YYYY-MM-DD)
            initial_capital: Starting capital
        """
        start_time = datetime.now()
        if not run_id:
            run_id = str(uuid.uuid4())[:8]

        # Discover expiries in range
        expiries = self.expiry_discovery.filter_by_date_range(start_date, end_date)
        if not expiries:
            self.progress[run_id] = {"status": "error", "error": "No expiries found in date range", "completed": 0, "total": 0}
            raise ValueError("No expiries found in the specified date range")

        self.progress[run_id] = {
            "status": "running",
            "completed": 0,
            "total": len(expiries),
            "current_expiry": expiries[0]["date_str"] if expiries else None,
            "stop_requested": False,
        }

        all_trades: list[Trade] = []
        equity_curve = [{"timestamp": start_date or expiries[0]["date_str"], "equity": initial_capital}]
        expiry_results = []
        current_equity = initial_capital

        for i, expiry_info in enumerate(expiries):
            if self.progress[run_id].get("stop_requested"):
                self.progress[run_id]["status"] = "stopped"
                self.progress[run_id]["error"] = "Backtest stopped by user"
                break
                
            self.progress[run_id]["current_expiry"] = expiry_info["date_str"]
            try:
                result = self._run_single_expiry(
                    strategy=strategy,
                    expiry_folder=expiry_info["folder_name"],
                    expiry_date=expiry_info["date_str"],
                )

                if result["trades"]:
                    for trade in result["trades"]:
                        all_trades.append(trade)
                        current_equity += trade.pnl
                        equity_curve.append({
                            "timestamp": trade.exit_time,
                            "equity": current_equity,
                        })

                    expiry_results.append({
                        "expiry": expiry_info["date_str"],
                        "folder": expiry_info["folder_name"],
                        "trades": len(result["trades"]),
                        "pnl": sum(t.pnl for t in result["trades"]),
                        "status": "success",
                    })
                else:
                    expiry_results.append({
                        "expiry": expiry_info["date_str"],
                        "folder": expiry_info["folder_name"],
                        "trades": 0,
                        "pnl": 0.0,
                        "status": "no_trades",
                    })

            except Exception as e:
                expiry_results.append({
                    "expiry": expiry_info["date_str"],
                    "folder": expiry_info["folder_name"],
                    "trades": 0,
                    "pnl": 0.0,
                    "status": f"error: {str(e)[:100]}",
                })
                
            self.progress[run_id]["completed"] = i + 1

        execution_time = (datetime.now() - start_time).total_seconds() * 1000

        # Build daily PnL
        daily_pnl = []
        for trade in all_trades:
            daily_pnl.append({
                "date": trade.expiry,
                "pnl": trade.pnl,
                "cumulative_pnl": sum(t.pnl for t in all_trades[:all_trades.index(trade) + 1]),
            })

        result = BacktestResult(
            run_id=run_id,
            strategy_name=strategy.name,
            start_date=start_date or expiries[0]["date_str"],
            end_date=end_date or expiries[-1]["date_str"],
            total_expiries=len(expiries),
            trades=all_trades,
            equity_curve=equity_curve,
            daily_pnl=daily_pnl,
            expiry_results=expiry_results,
            parameters=strategy.to_dict(),
            execution_time_ms=execution_time,
        )

        self.results[run_id] = result
        if self.progress[run_id].get("status") != "stopped":
            self.progress[run_id]["status"] = "completed"
        return result

    def stop_backtest(self, run_id: str) -> bool:
        """Request a stop for a running backtest."""
        if run_id in self.progress and self.progress[run_id]["status"] == "running":
            self.progress[run_id]["stop_requested"] = True
            return True
        return False

    def _run_single_expiry(
        self,
        strategy: Strategy,
        expiry_folder: str,
        expiry_date: str,
    ) -> dict:
        """
        Run a strategy on a single expiry's data.

        This function iterates through minute-by-minute data,
        checking entry/exit conditions.
        """
        # Load data
        options_df = self.data_loader.load_options(expiry_folder)
        index_df = self.data_loader.load_index(expiry_folder)

        if len(options_df) == 0 or len(index_df) == 0:
            return {"trades": []}

        # Parse timestamps
        if options_df.schema.get("Date") == pl.Utf8:
            options_df = options_df.with_columns(
                pl.col("Date").str.to_datetime().alias("Date")
            )
        if index_df.schema.get("Date") == pl.Utf8:
            index_df = index_df.with_columns(
                pl.col("Date").str.to_datetime().alias("Date")
            )

        # Get unique timestamps from index data
        timestamps = index_df.select("Date").unique().sort("Date").to_series().to_list()

        if not timestamps:
            return {"trades": []}

        # Get trading time boundaries
        entry_h, entry_m = map(int, strategy.entry.entry_time.split(":"))
        exit_h, exit_m = map(int, strategy.exit.exit_time.split(":"))
        entry_time = dt_time(entry_h, entry_m)
        exit_time = dt_time(exit_h, exit_m)

        position_mgr = PositionManager(lot_size=strategy.lot_size)
        minute_data = []  # For animation data

        # Get available strikes
        available_strikes = options_df.select("Strike").unique().to_series().sort().to_list()

        initial_credit = None

        for ts in timestamps:
            ts_time = ts.time() if hasattr(ts, 'time') else None
            if ts_time is None:
                continue

            # Skip if outside trading hours
            if ts_time < dt_time(9, 15) or ts_time > dt_time(15, 30):
                continue

            ts_str = str(ts)

            # Get options snapshot at this timestamp
            options_at_ts = options_df.filter(pl.col("Date") == ts)
            index_at_ts = index_df.filter(pl.col("Date") == ts)

            if len(index_at_ts) == 0:
                continue

            spot_price = index_at_ts.select("Close").item()

            # --- Entry Logic ---
            if not position_mgr.is_open and ts_time >= entry_time and ts_time < exit_time:
                # Resolve legs to actual strikes
                resolved_legs = LegBuilder.resolve_strikes(
                    strategy.legs,
                    spot_price=spot_price,
                    available_strikes=available_strikes,
                )

                # Get current prices for legs
                resolved_legs = LegBuilder.get_leg_prices(resolved_legs, options_at_ts)

                # Check if we have valid prices
                if all(leg["ltp"] > 0 for leg in resolved_legs):
                    # Simulate entry with slippage and costs
                    adjusted_legs, entry_slippage, entry_costs = self.simulator.simulate_entry(
                        resolved_legs, strategy.lot_size
                    )

                    position_mgr.open_position(adjusted_legs, ts_str, strategy.lot_size)

                    # Calculate initial credit for stop-loss calculations
                    initial_credit = LegBuilder.calculate_net_premium(
                        adjusted_legs, strategy.lot_size
                    )

            # --- Position Update & Exit Logic ---
            elif position_mgr.is_open:
                # Update position prices
                price_map = {}
                for pos in position_mgr.positions:
                    match = options_at_ts.filter(
                        (pl.col("Strike") == pos.strike) & (pl.col("Right") == pos.right)
                    )
                    if len(match) > 0:
                        price_map[(pos.strike, pos.right)] = match.select("Close").item()

                position_mgr.update_prices(price_map)

                # Check exit conditions
                exit_reason = None

                # Time-based exit
                if position_mgr.check_time_exit(
                    f"{ts_time.hour}:{ts_time.minute:02d}",
                    strategy.exit.exit_time,
                ):
                    exit_reason = "time_exit"

                # Stop-loss check
                elif position_mgr.check_stop_loss(
                    stop_loss_pct=strategy.exit.stop_loss_pct,
                    stop_loss_points=strategy.exit.stop_loss_points,
                    stop_loss_multiplier=strategy.exit.stop_loss_multiplier,
                    initial_credit=initial_credit,
                    per_leg=strategy.exit.per_leg_sl,
                ):
                    exit_reason = "stop_loss"

                # Target profit check
                elif position_mgr.check_target_profit(
                    target_pct=strategy.exit.target_profit_pct,
                    target_points=strategy.exit.target_profit_points,
                    initial_credit=initial_credit,
                ):
                    exit_reason = "target_profit"

                if exit_reason:
                    # Calculate exit costs
                    exit_legs = [
                        {
                            "direction": pos.direction,
                            "quantity": pos.quantity,
                            "current_price": pos.current_price,
                            "volume": 1000,
                        }
                        for pos in position_mgr.positions
                    ]
                    _, exit_slippage, exit_costs = self.simulator.simulate_exit(
                        exit_legs, strategy.lot_size
                    )

                    total_costs = entry_costs + exit_costs
                    total_slippage = entry_slippage + exit_slippage

                    position_mgr.close_all(
                        timestamp=ts_str,
                        exit_reason=exit_reason,
                        strategy_name=strategy.name,
                        expiry=expiry_date,
                        transaction_costs=total_costs,
                        slippage_cost=total_slippage,
                        spot_price=spot_price,
                    )

                    initial_credit = None

        # Force close any remaining positions at end of data
        if position_mgr.is_open:
            position_mgr.close_all(
                timestamp=str(timestamps[-1]),
                exit_reason="data_end",
                strategy_name=strategy.name,
                expiry=expiry_date,
            )

        return {"trades": position_mgr.closed_trades}

    def get_result(self, run_id: str) -> BacktestResult | None:
        """Get a backtest result by run ID."""
        return self.results.get(run_id)

    def list_results(self) -> list[dict]:
        """List all backtest results."""
        return [
            {
                "run_id": r.run_id,
                "strategy": r.strategy_name,
                "total_pnl": r.total_pnl,
                "total_trades": r.total_trades,
                "win_rate": r.win_rate,
                "start_date": r.start_date,
                "end_date": r.end_date,
            }
            for r in self.results.values()
        ]

    def get_animation_data(
        self,
        strategy: Strategy,
        expiry_folder: str,
    ) -> list[dict]:
        """
        Get minute-by-minute animation data for a specific expiry.
        """
        options_df = self.data_loader.load_options(expiry_folder)
        index_df = self.data_loader.load_index(expiry_folder)

        if options_df.schema.get("Date") == pl.Utf8:
            options_df = options_df.with_columns(
                pl.col("Date").str.to_datetime().alias("Date")
            )
        if index_df.schema.get("Date") == pl.Utf8:
            index_df = index_df.with_columns(
                pl.col("Date").str.to_datetime().alias("Date")
            )

        timestamps = index_df.select("Date").unique().sort("Date").to_series().to_list()
        available_strikes = options_df.select("Strike").unique().to_series().sort().to_list()

        frames = []
        position_mgr = PositionManager(lot_size=strategy.lot_size)
        initial_credit = None

        entry_h, entry_m = map(int, strategy.entry.entry_time.split(":"))
        entry_time_val = dt_time(entry_h, entry_m)

        for ts in timestamps:
            ts_time = ts.time() if hasattr(ts, 'time') else None
            if ts_time is None or ts_time < dt_time(9, 15) or ts_time > dt_time(15, 30):
                continue

            options_at_ts = options_df.filter(pl.col("Date") == ts)
            index_at_ts = index_df.filter(pl.col("Date") == ts)
            if len(index_at_ts) == 0:
                continue

            spot_price = index_at_ts.select("Close").item()

            # Entry
            if not position_mgr.is_open and ts_time >= entry_time_val:
                resolved_legs = LegBuilder.resolve_strikes(
                    strategy.legs, spot_price, available_strikes
                )
                resolved_legs = LegBuilder.get_leg_prices(resolved_legs, options_at_ts)

                if all(leg["ltp"] > 0 for leg in resolved_legs):
                    position_mgr.open_position(resolved_legs, str(ts), strategy.lot_size)
                    initial_credit = LegBuilder.calculate_net_premium(
                        resolved_legs, strategy.lot_size
                    )
            elif position_mgr.is_open:
                price_map = {}
                for pos in position_mgr.positions:
                    match = options_at_ts.filter(
                        (pl.col("Strike") == pos.strike) & (pl.col("Right") == pos.right)
                    )
                    if len(match) > 0:
                        price_map[(pos.strike, pos.right)] = match.select("Close").item()
                position_mgr.update_prices(price_map)

            frame = {
                "timestamp": str(ts),
                "time": f"{ts_time.hour}:{ts_time.minute:02d}" if ts_time else "",
                "spot_price": spot_price,
                "position_pnl": position_mgr.total_pnl if position_mgr.is_open else 0,
                "position_pnl_points": position_mgr.total_pnl_points if position_mgr.is_open else 0,
                "is_open": position_mgr.is_open,
                "legs": [
                    {
                        "strike": pos.strike,
                        "right": pos.right,
                        "direction": pos.direction,
                        "entry_price": pos.entry_price,
                        "current_price": pos.current_price,
                        "pnl": pos.pnl,
                    }
                    for pos in position_mgr.positions
                ] if position_mgr.is_open else [],
            }
            frames.append(frame)

        return frames
