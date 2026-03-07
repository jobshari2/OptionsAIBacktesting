"""
Adjustment Engine — Strategy conversion & mid-trade adjustments.

Implements Cottle-inspired dynamic strategy conversions:
    1. Condor Breakout   → convert to vertical spread
    2. Straddle Risk Red → add wings → Iron Butterfly  
    3. Trend Reversal    → flip spread direction
    4. Time Decay Opt    → convert to calendar spread

Each adjustment produces a structured record for analytics.
"""
from dataclasses import dataclass, field
from typing import Optional

from backend.logger import logger


@dataclass
class Adjustment:
    """Record of a strategy adjustment/conversion."""
    timestamp: str
    from_strategy: str
    to_strategy: str
    adjustment_type: str        # condor_breakout, risk_reduction, trend_reversal, time_decay
    reason: str
    pnl_at_adjustment: float
    spot_price: float
    delta_before: float = 0.0
    delta_after: float = 0.0
    legs_closed: list = field(default_factory=list)
    legs_opened: list = field(default_factory=list)


# Adjustment type constants
CONDOR_BREAKOUT = "condor_breakout"
RISK_REDUCTION = "risk_reduction"
TREND_REVERSAL = "trend_reversal"
TIME_DECAY = "time_decay"


class AdjustmentEngine:
    """
    Core intelligence for strategy conversions based on market conditions.
    
    Detects when a position no longer matches market conditions and 
    recommends specific structural adjustments per Cottle's framework.
    """

    def __init__(
        self,
        breach_buffer_pct: float = 0.5,     # % beyond short strike = breach
        iv_collapse_threshold: float = 0.15, # IV drop threshold for straddle exit
        dte_calendar_threshold: int = 3,     # Days to expiry to consider calendar
    ):
        self.breach_buffer_pct = breach_buffer_pct
        self.iv_collapse_threshold = iv_collapse_threshold
        self.dte_calendar_threshold = dte_calendar_threshold
        self._adjustment_history: list[Adjustment] = []

    def evaluate(
        self,
        strategy_name: str,
        positions: list,       # list of LegPosition
        spot_price: float,
        features: dict,
        regime: str,
        timestamp: str,
        initial_credit: Optional[float] = None,
    ) -> Optional[Adjustment]:
        """
        Evaluate whether the current position needs adjustment.
        
        Returns an Adjustment if conversion is recommended, None otherwise.
        """
        strategy_lower = strategy_name.lower().replace(" ", "_")

        # 1. Condor Breakout
        if "iron_condor" in strategy_lower or "condor" in strategy_lower:
            adj = self._check_condor_breakout(
                positions, spot_price, strategy_name, timestamp, features
            )
            if adj:
                return adj

        # 2. Straddle/Strangle Risk Reduction
        if "straddle" in strategy_lower or "strangle" in strategy_lower:
            adj = self._check_straddle_risk(
                positions, spot_price, strategy_name, timestamp, features
            )
            if adj:
                return adj

        # 3. Trend Reversal — spread direction flip
        if "bull" in strategy_lower or "bear" in strategy_lower:
            adj = self._check_trend_reversal(
                positions, spot_price, strategy_name, timestamp, features, regime
            )
            if adj:
                return adj

        # 4. Time Decay optimization (generic)
        adj = self._check_time_decay(
            positions, spot_price, strategy_name, timestamp, features
        )
        if adj:
            return adj

        return None

    def _check_condor_breakout(
        self, positions, spot_price, strategy_name, timestamp, features
    ) -> Optional[Adjustment]:
        """
        Adjustment 1 — Condor Breakout.
        
        If spot price breaches a short strike:
          - Upside breach → close put spread leg, keep call spread
          - Downside breach → close call spread leg, keep put spread
        Result: Iron Condor → Vertical Spread
        """
        short_ce_strike = None
        short_pe_strike = None

        for pos in positions:
            if pos.direction == "sell" and pos.right == "CE":
                short_ce_strike = pos.strike
            elif pos.direction == "sell" and pos.right == "PE":
                short_pe_strike = pos.strike

        if short_ce_strike is None or short_pe_strike is None:
            return None

        buffer = spot_price * self.breach_buffer_pct / 100

        # Upside breach — price above short CE
        if spot_price > short_ce_strike + buffer:
            legs_to_close = [
                {"strike": pos.strike, "right": pos.right, "direction": pos.direction}
                for pos in positions if pos.right == "PE"
            ]
            return Adjustment(
                timestamp=timestamp,
                from_strategy=strategy_name,
                to_strategy="bear_call_spread",
                adjustment_type=CONDOR_BREAKOUT,
                reason=f"Upside breach: spot {spot_price:.0f} > short CE {short_ce_strike}",
                pnl_at_adjustment=sum(pos.pnl for pos in positions),
                spot_price=spot_price,
                legs_closed=legs_to_close,
            )

        # Downside breach — price below short PE
        if spot_price < short_pe_strike - buffer:
            legs_to_close = [
                {"strike": pos.strike, "right": pos.right, "direction": pos.direction}
                for pos in positions if pos.right == "CE"
            ]
            return Adjustment(
                timestamp=timestamp,
                from_strategy=strategy_name,
                to_strategy="bull_put_spread",
                adjustment_type=CONDOR_BREAKOUT,
                reason=f"Downside breach: spot {spot_price:.0f} < short PE {short_pe_strike}",
                pnl_at_adjustment=sum(pos.pnl for pos in positions),
                spot_price=spot_price,
                legs_closed=legs_to_close,
            )

        return None

    def _check_straddle_risk(
        self, positions, spot_price, strategy_name, timestamp, features
    ) -> Optional[Adjustment]:
        """
        Adjustment 2 — Straddle/Strangle Risk Reduction.
        
        If position has large unrealized loss, recommend adding wings
        to convert: Short Straddle → Iron Butterfly / Iron Condor.
        """
        total_pnl = sum(pos.pnl for pos in positions)
        # Only for short positions (negative PnL = loss on short premium)
        short_positions = [p for p in positions if p.direction == "sell"]
        if not short_positions:
            return None

        # Check if loss exceeds 1.5× initial credit estimation
        avg_entry = sum(p.entry_price for p in short_positions) / len(short_positions)
        loss_threshold = avg_entry * 1.5 * short_positions[0].lot_size * len(short_positions)

        if abs(total_pnl) > loss_threshold and total_pnl < 0:
            # Has wings already? (buy legs exist)
            has_wings = any(p.direction == "buy" for p in positions)
            if has_wings:
                return None  # Already has protection

            to_strategy = "iron_butterfly" if "straddle" in strategy_name.lower() else "iron_condor"
            return Adjustment(
                timestamp=timestamp,
                from_strategy=strategy_name,
                to_strategy=to_strategy,
                adjustment_type=RISK_REDUCTION,
                reason=f"Loss ({total_pnl:.0f}) exceeds threshold, adding protective wings",
                pnl_at_adjustment=total_pnl,
                spot_price=spot_price,
            )

        # Check IV collapse for long straddle
        if "long" in strategy_name.lower():
            rv = features.get("realized_volatility", 0)
            if rv < self.iv_collapse_threshold:
                return Adjustment(
                    timestamp=timestamp,
                    from_strategy=strategy_name,
                    to_strategy="iron_condor",
                    adjustment_type=RISK_REDUCTION,
                    reason=f"IV collapse (rv={rv:.3f} < {self.iv_collapse_threshold}), "
                           "converting to theta-positive",
                    pnl_at_adjustment=total_pnl,
                    spot_price=spot_price,
                )

        return None

    def _check_trend_reversal(
        self, positions, spot_price, strategy_name, timestamp, features, regime
    ) -> Optional[Adjustment]:
        """
        Adjustment 3 — Trend Reversal.
        
        If regime has reversed:
          - Bull Call Spread in TREND_DOWN regime → close, open Bear Put Spread
          - Bear Put Spread in TREND_UP regime → close, open Bull Call Spread
        """
        strategy_lower = strategy_name.lower()
        is_bull = "bull" in strategy_lower
        is_bear = "bear" in strategy_lower

        momentum = features.get("momentum", 0)
        trend = features.get("trend_strength", 0)

        if is_bull and (regime == "TREND_DOWN" or (momentum < -0.3 and trend < -0.3)):
            return Adjustment(
                timestamp=timestamp,
                from_strategy=strategy_name,
                to_strategy="bear_put_spread",
                adjustment_type=TREND_REVERSAL,
                reason=f"Trend reversal: regime={regime}, momentum={momentum:.3f}",
                pnl_at_adjustment=sum(pos.pnl for pos in positions),
                spot_price=spot_price,
                legs_closed=[
                    {"strike": p.strike, "right": p.right, "direction": p.direction}
                    for p in positions
                ],
            )

        if is_bear and (regime == "TREND_UP" or (momentum > 0.3 and trend > 0.3)):
            return Adjustment(
                timestamp=timestamp,
                from_strategy=strategy_name,
                to_strategy="bull_call_spread",
                adjustment_type=TREND_REVERSAL,
                reason=f"Trend reversal: regime={regime}, momentum={momentum:.3f}",
                pnl_at_adjustment=sum(pos.pnl for pos in positions),
                spot_price=spot_price,
                legs_closed=[
                    {"strike": p.strike, "right": p.right, "direction": p.direction}
                    for p in positions
                ],
            )

        return None

    def _check_time_decay(
        self, positions, spot_price, strategy_name, timestamp, features
    ) -> Optional[Adjustment]:
        """
        Adjustment 4 — Time Decay Optimization.
        
        When near expiry and theta is maximally decaying,
        suggest a calendar spread conversion.
        """
        # This is evaluated but only triggers on very specific conditions
        # (low momentum + near expiry approach)
        momentum = abs(features.get("momentum", 0))
        rv = features.get("realized_volatility", 0)

        # Conditions: low momentum (range-bound), moderate volatility
        if momentum < 0.05 and 0.10 < rv < 0.25:
            # Only for strategies that aren't already theta-positive
            if any(x in strategy_name.lower() for x in ["straddle", "long"]):
                return Adjustment(
                    timestamp=timestamp,
                    from_strategy=strategy_name,
                    to_strategy="short_strangle",
                    adjustment_type=TIME_DECAY,
                    reason="Low momentum + moderate vol — optimize for theta",
                    pnl_at_adjustment=sum(pos.pnl for pos in positions),
                    spot_price=spot_price,
                )

        return None

    def record_adjustment(self, adjustment: Adjustment) -> None:
        """Record an adjustment to history."""
        self._adjustment_history.append(adjustment)
        logger.info(
            f"AdjustmentEngine: {adjustment.adjustment_type} — "
            f"{adjustment.from_strategy} → {adjustment.to_strategy} | {adjustment.reason}"
        )

    def get_history(self) -> list[dict]:
        """Get all adjustment history as dicts."""
        return [
            {
                "timestamp": a.timestamp,
                "from_strategy": a.from_strategy,
                "to_strategy": a.to_strategy,
                "adjustment_type": a.adjustment_type,
                "reason": a.reason,
                "pnl_at_adjustment": a.pnl_at_adjustment,
                "spot_price": a.spot_price,
                "delta_before": a.delta_before,
                "delta_after": a.delta_after,
                "legs_closed": a.legs_closed,
                "legs_opened": a.legs_opened,
            }
            for a in self._adjustment_history
        ]

    def clear_history(self) -> None:
        """Clear the adjustment history."""
        self._adjustment_history.clear()

    @property
    def total_adjustments(self) -> int:
        return len(self._adjustment_history)

    def get_adjustment_summary(self) -> dict:
        """Summarize adjustments by type."""
        summary: dict[str, int] = {}
        for a in self._adjustment_history:
            summary[a.adjustment_type] = summary.get(a.adjustment_type, 0) + 1
        return {
            "total": self.total_adjustments,
            "by_type": summary,
        }
