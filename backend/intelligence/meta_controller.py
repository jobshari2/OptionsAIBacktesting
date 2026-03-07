"""
Meta Strategy Controller — orchestrates the intelligent backtesting pipeline.
Performs mid-expiry regime detection and dynamic strategy switching.

Architecture:
    Market Data → Feature Engine → Regime Detection → Strategy Selection
               → Position Entry/Exit → Experience Memory → Learning
"""
import uuid
import polars as pl
import numpy as np
from datetime import datetime, time as dt_time
from typing import Optional
from dataclasses import dataclass, field

from backend.config import config, get_ai_learning_dir
from backend.data_engine import DataLoader, ExpiryDiscovery
from backend.strategy_engine import Strategy, StrategyLoader
from backend.strategy_engine.leg_builder import LegBuilder
from backend.backtester.position_manager import PositionManager, Trade
from backend.backtester.simulator import TradeSimulator
from backend.analytics.metrics import MetricsCalculator
from backend.logger import logger

from .feature_engine import FeatureEngine
from .regime_detector import RegimeDetector, MarketRegime
from .strategy_selector import StrategySelector
from .experience_memory import ExperienceMemory


@dataclass
class RegimeTransition:
    """Records a regime change within an expiry."""
    timestamp: str
    from_regime: str
    to_regime: str
    confidence: float
    from_strategy: str
    to_strategy: str
    pnl_at_switch: float  # PnL of closed position


@dataclass
class ExpiryIntelligenceResult:
    """Result of intelligent backtesting for a single expiry."""
    expiry: str
    folder: str
    trades: list[Trade]
    regime_transitions: list[RegimeTransition]
    initial_regime: str
    initial_strategy: str
    total_pnl: float = 0.0
    num_switches: int = 0


@dataclass
class IntelligentBacktestResult:
    """Full result of an intelligent meta-strategy backtest."""
    run_id: str
    start_date: str
    end_date: str
    total_expiries: int
    total_trades: int
    total_pnl: float
    total_switches: int
    trades: list[Trade]
    equity_curve: list[dict]
    expiry_results: list[dict]
    regime_timeline: list[dict]
    strategy_breakdown: dict
    regime_breakdown: dict
    execution_time_ms: float
    model_training_summary: Optional[dict] = None

    def to_dict(self) -> dict:
        """Serialize to dict."""
        return {
            "run_id": self.run_id,
            "start_date": self.start_date,
            "end_date": self.end_date,
            "total_expiries": self.total_expiries,
            "total_trades": self.total_trades,
            "total_pnl": self.total_pnl,
            "total_switches": self.total_switches,
            "execution_time_ms": self.execution_time_ms,
            "model_training_summary": self.model_training_summary,
            "equity_curve": self.equity_curve,
            "expiry_results": self.expiry_results,
            "regime_timeline": self.regime_timeline,
            "strategy_breakdown": self.strategy_breakdown,
            "regime_breakdown": self.regime_breakdown,
            "trades": [
                {
                    "trade_id": t.trade_id,
                    "strategy_name": t.strategy_name,
                    "expiry": t.expiry,
                    "entry_time": t.entry_time,
                    "exit_time": t.exit_time,
                    "pnl": t.pnl,
                    "exit_reason": t.exit_reason,
                    "spot_at_entry": t.spot_at_entry,
                    "spot_at_exit": t.spot_at_exit,
                }
                for t in self.trades
            ],
        }


class MetaController:
    """
    Central controller for the intelligent options strategy engine.

    Orchestrates:
        1. Feature extraction from market data
        2. ML-based regime detection (with rule-based fallback)
        3. Strategy selection based on detected regime
        4. Mid-expiry dynamic strategy switching
        5. Trade execution via existing PositionManager
        6. Experience memory recording for continuous learning

    Mid-expiry switching:
        - Re-evaluates regime every `regime_check_interval` minutes
        - If regime changes with confidence >= `min_switch_confidence`:
            → Closes current positions
            → Opens new strategy positions
        - Cooldown period prevents excessive switching
    """

    def __init__(
        self,
        regime_check_interval: int = 15,         # Minutes between regime checks
        min_switch_confidence: float = 0.6,        # Min confidence to trigger switch
        switch_cooldown_minutes: int = 30,         # Cooldown after a switch
        auto_train: bool = True,                   # Auto-train ML model from history
    ):
        self.regime_check_interval = regime_check_interval
        self.min_switch_confidence = min_switch_confidence
        self.switch_cooldown_minutes = switch_cooldown_minutes
        self.auto_train = auto_train

        # Components
        self.data_loader = DataLoader()
        self.expiry_discovery = ExpiryDiscovery()
        self.feature_engine = FeatureEngine()
        self.regime_detector = RegimeDetector()
        self.strategy_selector = StrategySelector()
        self.experience_memory = ExperienceMemory()
        self.simulator = TradeSimulator()

        # State
        self.progress: dict[str, dict] = {}

        # Try to load existing ML model
        model_path = get_ai_learning_dir() / "regime_model.pkl"
        if model_path.exists():
            self.regime_detector.load_model(model_path)
            logger.info("MetaController: loaded existing regime detection model")

    def run_intelligent_backtest(
        self,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        initial_capital: float = 1000000.0,
        regime_check_interval: Optional[int] = None,
        min_confidence: Optional[float] = None,
        run_id: Optional[str] = None,
    ) -> IntelligentBacktestResult:
        """
        Run the full intelligent meta-strategy backtest.

        For each expiry:
            1. Load market data
            2. Compute features and detect initial regime
            3. Select strategy based on regime
            4. Iterate minute-by-minute:
                - Every N minutes, re-check regime
                - If regime changed with high confidence → switch strategy
                - Manage entry/exit per strategy rules
            5. Record results to experience memory

        Args:
            start_date: Start date (YYYY-MM-DD)
            end_date: End date (YYYY-MM-DD)
            initial_capital: Starting capital
            regime_check_interval: Override minutes between regime checks
            min_confidence: Override minimum confidence for switching
            run_id: Optional custom run ID
        """
        start_time = datetime.now()
        if not run_id:
            run_id = f"intel_{str(uuid.uuid4())[:8]}"

        check_interval = regime_check_interval or self.regime_check_interval
        confidence_threshold = min_confidence or self.min_switch_confidence

        # Discover expiries
        expiries = self.expiry_discovery.filter_by_date_range(start_date, end_date)
        if not expiries:
            raise ValueError("No expiries found in the specified date range")

        logger.info(
            f"MetaController: starting intelligent backtest "
            f"({len(expiries)} expiries, check_interval={check_interval}min, "
            f"min_confidence={confidence_threshold})"
        )

        self.progress[run_id] = {
            "status": "running",
            "completed": 0,
            "total": len(expiries),
            "current_expiry": "",
            "current_regime": "",
            "current_strategy": "",
            "switches": 0,
        }

        # Auto-train ML model from experience memory
        training_summary = None
        if self.auto_train and not self.regime_detector.is_trained:
            feature_history = self.experience_memory.get_feature_history()
            if len(feature_history) >= 10:
                training_summary = self.regime_detector.train(feature_history)
                # Save trained model
                model_path = get_ai_learning_dir() / "regime_model.pkl"
                self.regime_detector.save_model(model_path)

        all_trades: list[Trade] = []
        equity_curve = [{"timestamp": start_date or expiries[0]["date_str"], "equity": initial_capital}]
        expiry_results = []
        regime_timeline = []
        current_equity = initial_capital

        for i, expiry_info in enumerate(expiries):
            self.progress[run_id]["current_expiry"] = expiry_info["date_str"]

            try:
                result = self._run_intelligent_expiry(
                    expiry_folder=expiry_info["folder_name"],
                    expiry_date=expiry_info["date_str"],
                    check_interval=check_interval,
                    confidence_threshold=confidence_threshold,
                )

                for trade in result.trades:
                    all_trades.append(trade)
                    current_equity += trade.pnl
                    equity_curve.append({
                        "timestamp": trade.exit_time,
                        "equity": current_equity,
                    })

                expiry_results.append({
                    "expiry": result.expiry,
                    "folder": result.folder,
                    "trades": len(result.trades),
                    "pnl": result.total_pnl,
                    "initial_regime": result.initial_regime,
                    "initial_strategy": result.initial_strategy,
                    "switches": result.num_switches,
                    "status": "success",
                })

                # Record regime transitions
                for transition in result.regime_transitions:
                    regime_timeline.append({
                        "expiry": result.expiry,
                        "timestamp": transition.timestamp,
                        "from_regime": transition.from_regime,
                        "to_regime": transition.to_regime,
                        "confidence": transition.confidence,
                        "from_strategy": transition.from_strategy,
                        "to_strategy": transition.to_strategy,
                        "pnl_at_switch": transition.pnl_at_switch,
                    })

                # Record to experience memory
                self._record_to_memory(result)

            except Exception as e:
                logger.error(f"MetaController: error on expiry {expiry_info['date_str']}: {e}")
                expiry_results.append({
                    "expiry": expiry_info["date_str"],
                    "folder": expiry_info["folder_name"],
                    "trades": 0,
                    "pnl": 0.0,
                    "initial_regime": "UNKNOWN",
                    "initial_strategy": "none",
                    "switches": 0,
                    "status": f"error: {str(e)[:100]}",
                })

            self.progress[run_id]["completed"] = i + 1

        execution_time = (datetime.now() - start_time).total_seconds() * 1000

        # Compute breakdowns
        strategy_breakdown = self._compute_strategy_breakdown(all_trades)
        regime_breakdown = self._compute_regime_breakdown(expiry_results)

        total_switches = sum(er.get("switches", 0) for er in expiry_results)

        result = IntelligentBacktestResult(
            run_id=run_id,
            start_date=start_date or expiries[0]["date_str"],
            end_date=end_date or expiries[-1]["date_str"],
            total_expiries=len(expiries),
            total_trades=len(all_trades),
            total_pnl=sum(t.pnl for t in all_trades),
            total_switches=total_switches,
            trades=all_trades,
            equity_curve=equity_curve,
            expiry_results=expiry_results,
            regime_timeline=regime_timeline,
            strategy_breakdown=strategy_breakdown,
            regime_breakdown=regime_breakdown,
            execution_time_ms=execution_time,
            model_training_summary=training_summary,
        )

        self.progress[run_id]["status"] = "completed"
        logger.info(
            f"MetaController: backtest complete — "
            f"{len(all_trades)} trades, PnL={result.total_pnl:.2f}, "
            f"{total_switches} switches, {execution_time:.0f}ms"
        )

        # Retrain model after backtest for continuous learning
        if self.auto_train and len(all_trades) >= 5:
            feature_history = self.experience_memory.get_feature_history()
            if len(feature_history) >= 10:
                retrain_summary = self.regime_detector.train(feature_history)
                model_path = get_ai_learning_dir() / "regime_model.pkl"
                self.regime_detector.save_model(model_path)
                result.model_training_summary = retrain_summary

        return result

    def _run_intelligent_expiry(
        self,
        expiry_folder: str,
        expiry_date: str,
        check_interval: int,
        confidence_threshold: float,
    ) -> ExpiryIntelligenceResult:
        """
        Run intelligent strategy on a single expiry with mid-expiry switching.

        Iterates minute-by-minute through the trading session:
        - Re-evaluates regime every `check_interval` minutes
        - Switches strategy when regime changes with sufficient confidence
        - Respects cooldown period to prevent excessive churning
        """
        # Load data
        options_df = self.data_loader.load_options(expiry_folder)
        index_df = self.data_loader.load_index(expiry_folder)

        if len(options_df) == 0 or len(index_df) == 0:
            return ExpiryIntelligenceResult(
                expiry=expiry_date, folder=expiry_folder,
                trades=[], regime_transitions=[],
                initial_regime="UNKNOWN", initial_strategy="none",
            )

        # Ensure datetime
        if options_df.schema.get("Date") == pl.Utf8:
            options_df = options_df.with_columns(pl.col("Date").str.to_datetime().alias("Date"))
        if index_df.schema.get("Date") == pl.Utf8:
            index_df = index_df.with_columns(pl.col("Date").str.to_datetime().alias("Date"))

        timestamps = index_df.select("Date").unique().sort("Date").to_series().to_list()
        if not timestamps:
            return ExpiryIntelligenceResult(
                expiry=expiry_date, folder=expiry_folder,
                trades=[], regime_transitions=[],
                initial_regime="UNKNOWN", initial_strategy="none",
            )

        available_strikes = options_df.select("Strike").unique().to_series().sort().to_list()

        # --- Initial regime detection ---
        # Use first 15 minutes of data to detect initial regime
        initial_data_end_idx = min(15, len(timestamps))
        initial_index = index_df.filter(pl.col("Date") <= timestamps[initial_data_end_idx - 1])
        initial_options = options_df.filter(pl.col("Date") <= timestamps[initial_data_end_idx - 1])

        features = self.feature_engine.compute_features(initial_index, initial_options)
        current_regime, regime_confidence = self.regime_detector.detect(features)
        current_strategy = self.strategy_selector.select(current_regime)

        logger.info(
            f"MetaController [{expiry_date}]: initial regime={current_regime} "
            f"(conf={regime_confidence:.2f}), strategy={current_strategy.name}"
        )

        # --- Minute-by-minute simulation with mid-expiry switching ---
        position_mgr = PositionManager(lot_size=current_strategy.lot_size)
        all_trades: list[Trade] = []
        regime_transitions: list[RegimeTransition] = []
        initial_credit = None
        entry_costs = 0.0
        entry_slippage = 0.0
        bars_since_last_check = 0
        bars_since_last_switch = self.switch_cooldown_minutes  # Allow immediate first entry

        for ts in timestamps:
            ts_time = ts.time() if hasattr(ts, "time") else None
            if ts_time is None:
                continue
            if ts_time < dt_time(9, 15) or ts_time > dt_time(15, 30):
                continue

            ts_str = str(ts)
            bars_since_last_check += 1
            bars_since_last_switch += 1

            options_at_ts = options_df.filter(pl.col("Date") == ts)
            index_at_ts = index_df.filter(pl.col("Date") == ts)
            if len(index_at_ts) == 0:
                continue

            spot_price = index_at_ts.select("Close").item()

            # --- REGIME RE-EVALUATION ---
            if bars_since_last_check >= check_interval:
                bars_since_last_check = 0

                # Compute features up to current time
                index_up_to = index_df.filter(pl.col("Date") <= ts)
                options_up_to = options_df.filter(pl.col("Date") <= ts)
                new_features = self.feature_engine.compute_features(index_up_to, options_up_to)
                new_regime, new_confidence = self.regime_detector.detect(new_features)

                # --- MID-EXPIRY SWITCH ---
                if (
                    new_regime != current_regime
                    and new_confidence >= confidence_threshold
                    and bars_since_last_switch >= self.switch_cooldown_minutes
                ):
                    switch_pnl = 0.0

                    # Close existing positions
                    if position_mgr.is_open:
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
                            exit_legs, current_strategy.lot_size
                        )
                        total_costs = entry_costs + exit_costs
                        total_slippage = entry_slippage + exit_slippage

                        switch_pnl = position_mgr.total_pnl

                        position_mgr.close_all(
                            timestamp=ts_str,
                            exit_reason="regime_switch",
                            strategy_name=current_strategy.name,
                            expiry=expiry_date,
                            transaction_costs=total_costs,
                            slippage_cost=total_slippage,
                            spot_price=spot_price,
                        )
                        # Collect closed trades
                        for trade in position_mgr.closed_trades:
                            if trade not in all_trades:
                                all_trades.append(trade)

                        initial_credit = None

                    old_strategy_name = current_strategy.name

                    # Switch regime and strategy
                    current_regime = new_regime
                    regime_confidence = new_confidence
                    current_strategy = self.strategy_selector.select(current_regime)
                    bars_since_last_switch = 0

                    transition = RegimeTransition(
                        timestamp=ts_str,
                        from_regime=current_regime,
                        to_regime=new_regime,
                        confidence=new_confidence,
                        from_strategy=old_strategy_name,
                        to_strategy=current_strategy.name,
                        pnl_at_switch=switch_pnl,
                    )
                    regime_transitions.append(transition)

                    logger.info(
                        f"MetaController [{expiry_date}] SWITCH at {ts_time}: "
                        f"{old_strategy_name} → {current_strategy.name} "
                        f"(regime: {transition.from_regime} → {transition.to_regime}, "
                        f"conf={new_confidence:.2f})"
                    )

            # --- ENTRY / EXIT LOGIC (same as BacktestEngine) ---
            entry_h, entry_m = map(int, current_strategy.entry.entry_time.split(":"))
            exit_h, exit_m = map(int, current_strategy.exit.exit_time.split(":"))
            entry_time = dt_time(entry_h, entry_m)
            exit_time = dt_time(exit_h, exit_m)

            # Entry
            if not position_mgr.is_open and ts_time >= entry_time and ts_time < exit_time:
                resolved_legs = LegBuilder.resolve_strikes(
                    current_strategy.legs,
                    spot_price=spot_price,
                    available_strikes=available_strikes,
                )
                resolved_legs = LegBuilder.get_leg_prices(resolved_legs, options_at_ts)

                if all(leg["ltp"] > 0 for leg in resolved_legs):
                    adjusted_legs, entry_slippage, entry_costs = self.simulator.simulate_entry(
                        resolved_legs, current_strategy.lot_size
                    )
                    position_mgr.open_position(adjusted_legs, ts_str, current_strategy.lot_size)
                    initial_credit = LegBuilder.calculate_net_premium(
                        adjusted_legs, current_strategy.lot_size
                    )

            # Exit logic for open positions
            elif position_mgr.is_open:
                # Update prices
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

                if position_mgr.check_time_exit(
                    f"{ts_time.hour}:{ts_time.minute:02d}",
                    current_strategy.exit.exit_time,
                ):
                    exit_reason = "time_exit"
                elif position_mgr.check_stop_loss(
                    stop_loss_pct=current_strategy.exit.stop_loss_pct,
                    stop_loss_points=current_strategy.exit.stop_loss_points,
                    stop_loss_multiplier=current_strategy.exit.stop_loss_multiplier,
                    initial_credit=initial_credit,
                    per_leg=current_strategy.exit.per_leg_sl,
                ):
                    exit_reason = "stop_loss"
                elif position_mgr.check_target_profit(
                    target_pct=current_strategy.exit.target_profit_pct,
                    target_points=current_strategy.exit.target_profit_points,
                    initial_credit=initial_credit,
                ):
                    exit_reason = "target_profit"

                if exit_reason:
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
                        exit_legs, current_strategy.lot_size
                    )

                    position_mgr.close_all(
                        timestamp=ts_str,
                        exit_reason=exit_reason,
                        strategy_name=current_strategy.name,
                        expiry=expiry_date,
                        transaction_costs=entry_costs + exit_costs,
                        slippage_cost=entry_slippage + exit_slippage,
                        spot_price=spot_price,
                    )
                    initial_credit = None

        # Force close remaining positions
        if position_mgr.is_open:
            position_mgr.close_all(
                timestamp=str(timestamps[-1]),
                exit_reason="data_end",
                strategy_name=current_strategy.name,
                expiry=expiry_date,
            )

        # Collect all closed trades
        for trade in position_mgr.closed_trades:
            if trade not in all_trades:
                all_trades.append(trade)

        total_pnl = sum(t.pnl for t in all_trades)

        return ExpiryIntelligenceResult(
            expiry=expiry_date,
            folder=expiry_folder,
            trades=all_trades,
            regime_transitions=regime_transitions,
            initial_regime=current_regime,
            initial_strategy=current_strategy.name,
            total_pnl=total_pnl,
            num_switches=len(regime_transitions),
        )

    def _record_to_memory(self, result: ExpiryIntelligenceResult) -> None:
        """Record expiry results to experience memory."""
        for trade in result.trades:
            # Determine if this trade was from a switch
            was_switch = False
            switch_from = ""
            for transition in result.regime_transitions:
                if transition.to_strategy == trade.strategy_name:
                    was_switch = True
                    switch_from = transition.from_strategy
                    break

            self.experience_memory.store({
                "expiry": result.expiry,
                "regime": result.initial_regime,
                "regime_confidence": 0.0,
                "strategy_name": trade.strategy_name,
                "pnl": trade.pnl,
                "drawdown": 0.0,
                "entry_time": trade.entry_time,
                "exit_time": trade.exit_time,
                "exit_reason": trade.exit_reason,
                "was_switch": was_switch,
                "switch_from": switch_from,
            })

    def _compute_strategy_breakdown(self, trades: list[Trade]) -> dict:
        """Compute PnL breakdown by strategy."""
        breakdown = {}
        for trade in trades:
            name = trade.strategy_name
            if name not in breakdown:
                breakdown[name] = {"trades": 0, "pnl": 0.0, "wins": 0}
            breakdown[name]["trades"] += 1
            breakdown[name]["pnl"] += trade.pnl
            if trade.pnl > 0:
                breakdown[name]["wins"] += 1

        for name, data in breakdown.items():
            data["win_rate"] = (data["wins"] / data["trades"] * 100) if data["trades"] > 0 else 0.0
            data["avg_pnl"] = data["pnl"] / data["trades"] if data["trades"] > 0 else 0.0

        return breakdown

    def _compute_regime_breakdown(self, expiry_results: list[dict]) -> dict:
        """Compute breakdown by regime."""
        breakdown = {}
        for er in expiry_results:
            regime = er.get("initial_regime", "UNKNOWN")
            if regime not in breakdown:
                breakdown[regime] = {"expiries": 0, "pnl": 0.0, "switches": 0}
            breakdown[regime]["expiries"] += 1
            breakdown[regime]["pnl"] += er.get("pnl", 0.0)
            breakdown[regime]["switches"] += er.get("switches", 0)

        return breakdown

    def get_regime_for_expiry(self, expiry_folder: str) -> dict:
        """
        Compute current regime for a given expiry.
        Returns features, regime, and confidence.
        """
        try:
            index_df = self.data_loader.load_index(expiry_folder)
            options_df = self.data_loader.load_options(expiry_folder)

            features = self.feature_engine.compute_features(index_df, options_df)
            regime, confidence = self.regime_detector.detect(features)

            strategy = self.strategy_selector.select(regime)

            return {
                "expiry": expiry_folder,
                "features": features,
                "regime": regime,
                "confidence": confidence,
                "recommended_strategy": strategy.name,
                "model_trained": self.regime_detector.is_trained,
            }
        except Exception as e:
            logger.error(f"MetaController.get_regime_for_expiry error: {e}")
            return {
                "expiry": expiry_folder,
                "error": str(e),
                "regime": "UNKNOWN",
                "confidence": 0.0,
            }

    def train_model(self) -> dict:
        """
        Manually trigger ML model training from experience memory.

        Returns training summary.
        """
        feature_history = self.experience_memory.get_feature_history()
        if len(feature_history) < 10:
            return {
                "status": "skipped",
                "reason": "insufficient_data",
                "samples": len(feature_history),
            }

        summary = self.regime_detector.train(feature_history)
        model_path = get_ai_learning_dir() / "regime_model.pkl"
        self.regime_detector.save_model(model_path)

        return summary
