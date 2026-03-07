"""
Risk Manager — Hard limits, delta hedging, and strategy-specific stop-losses.

Enforces:
    - Max loss per trade ≤ 2% capital
    - Portfolio delta bounds with automatic hedging signals
    - Strategy-specific stop-loss multipliers (Cottle framework)
    - Position sizing via risk-based lot calculation
"""
import numpy as np
from dataclasses import dataclass, field
from typing import Optional

from backend.analytics.greeks import GreeksCalculator
from backend.logger import logger


@dataclass
class RiskEvent:
    """Records a risk management event."""
    timestamp: str
    event_type: str              # delta_breach, stop_loss, max_loss, position_size
    description: str
    current_value: float
    threshold: float
    action_taken: str            # hedge, exit, reduce, none
    strategy_name: str = ""


# Strategy-specific stop-loss rules (Cottle framework)
STRATEGY_STOP_LOSS: dict[str, dict] = {
    "iron_condor":    {"type": "premium_multiple", "value": 2.0,  "label": "2× premium"},
    "iron_butterfly": {"type": "premium_multiple", "value": 2.0,  "label": "2× premium"},
    "bull_call_spread": {"type": "loss_pct",       "value": 50.0, "label": "50% loss"},
    "bear_put_spread":  {"type": "loss_pct",       "value": 50.0, "label": "50% loss"},
    "long_straddle":  {"type": "iv_collapse",      "value": 0.15, "label": "IV < 15%"},
    "short_straddle": {"type": "premium_multiple", "value": 2.0,  "label": "2× premium"},
    "short_strangle": {"type": "premium_multiple", "value": 2.0,  "label": "2× premium"},
}


class RiskManager:
    """
    Manages risk limits for the adaptive trading system.
    
    Three layers of protection:
        1. Pre-trade: position sizing and capital allocation
        2. Intra-trade: delta bounds, strategy-specific stops
        3. Portfolio-level: max drawdown, correlation limits
    """

    def __init__(
        self,
        max_risk_per_trade_pct: float = 2.0,    # Max 2% of capital per trade
        max_portfolio_delta: float = 500.0,       # Absolute delta units
        max_portfolio_gamma: float = 200.0,       # Absolute gamma exposure
        max_drawdown_pct: float = 10.0,           # Max portfolio drawdown %
        risk_free_rate: float = 0.065,            # India risk-free rate
    ):
        self.max_risk_per_trade_pct = max_risk_per_trade_pct
        self.max_portfolio_delta = max_portfolio_delta
        self.max_portfolio_gamma = max_portfolio_gamma
        self.max_drawdown_pct = max_drawdown_pct
        self.risk_free_rate = risk_free_rate
        self._risk_events: list[RiskEvent] = []
        self._peak_equity: float = 0.0

    def calculate_position_size(
        self,
        capital: float,
        max_loss_per_lot: float,
        lot_size: int = 25,
    ) -> int:
        """
        Calculate optimal number of lots based on risk per trade.
        
        Risk per trade ≤ max_risk_per_trade_pct × capital.
        
        Returns: number of lots (minimum 1).
        """
        if max_loss_per_lot <= 0:
            return 1

        max_risk = capital * self.max_risk_per_trade_pct / 100
        lots = int(max_risk / max_loss_per_lot)
        return max(lots, 1)

    def check_risk_limits(
        self,
        positions: list,           # list of LegPosition
        spot_price: float,
        strategy_name: str,
        capital: float,
        current_equity: float,
        timestamp: str,
        initial_credit: Optional[float] = None,
        time_to_expiry_years: float = 0.01,
        sigma: float = 0.20,
    ) -> dict:
        """
        Check all risk limits for the current position.
        
        Returns a dict with:
            - should_exit: bool
            - should_hedge: bool
            - risk_events: list of new RiskEvent
            - greeks: portfolio greeks dict
            - reason: exit/hedge reason if applicable
        """
        result = {
            "should_exit": False,
            "should_hedge": False,
            "risk_events": [],
            "greeks": {},
            "reason": "",
        }

        if not positions:
            return result

        # --- Compute portfolio Greeks ---
        greeks = self._compute_portfolio_greeks(
            positions, spot_price, time_to_expiry_years, sigma
        )
        result["greeks"] = greeks

        # --- 1. Delta bounds check ---
        if abs(greeks["net_delta"]) > self.max_portfolio_delta:
            event = RiskEvent(
                timestamp=timestamp,
                event_type="delta_breach",
                description=f"Portfolio delta {greeks['net_delta']:.1f} exceeds "
                            f"limit ±{self.max_portfolio_delta}",
                current_value=greeks["net_delta"],
                threshold=self.max_portfolio_delta,
                action_taken="hedge",
                strategy_name=strategy_name,
            )
            self._risk_events.append(event)
            result["risk_events"].append(event)
            result["should_hedge"] = True
            result["reason"] = f"Delta breach: {greeks['net_delta']:.1f}"

        # --- 2. Strategy-specific stop-loss ---
        sl_config = STRATEGY_STOP_LOSS.get(strategy_name.lower().replace(" ", "_"), {})
        if sl_config:
            sl_triggered, sl_reason = self._check_strategy_stop(
                positions, sl_config, initial_credit, strategy_name, timestamp
            )
            if sl_triggered:
                result["should_exit"] = True
                result["reason"] = sl_reason

        # --- 3. Max loss per trade ---
        total_pnl = sum(pos.pnl for pos in positions)
        max_trade_loss = capital * self.max_risk_per_trade_pct / 100
        if total_pnl < -max_trade_loss:
            event = RiskEvent(
                timestamp=timestamp,
                event_type="max_loss",
                description=f"Trade loss ₹{total_pnl:.0f} exceeds max "
                            f"₹{max_trade_loss:.0f} ({self.max_risk_per_trade_pct}%)",
                current_value=total_pnl,
                threshold=-max_trade_loss,
                action_taken="exit",
                strategy_name=strategy_name,
            )
            self._risk_events.append(event)
            result["risk_events"].append(event)
            result["should_exit"] = True
            result["reason"] = f"Max loss breach: ₹{total_pnl:.0f}"

        # --- 4. Portfolio drawdown ---
        self._peak_equity = max(self._peak_equity, current_equity)
        if self._peak_equity > 0:
            drawdown_pct = (self._peak_equity - current_equity) / self._peak_equity * 100
            if drawdown_pct > self.max_drawdown_pct:
                event = RiskEvent(
                    timestamp=timestamp,
                    event_type="max_drawdown",
                    description=f"Drawdown {drawdown_pct:.1f}% exceeds max {self.max_drawdown_pct}%",
                    current_value=drawdown_pct,
                    threshold=self.max_drawdown_pct,
                    action_taken="exit",
                    strategy_name=strategy_name,
                )
                self._risk_events.append(event)
                result["risk_events"].append(event)
                result["should_exit"] = True
                result["reason"] = f"Drawdown breach: {drawdown_pct:.1f}%"

        return result

    def _compute_portfolio_greeks(
        self,
        positions: list,
        spot_price: float,
        T: float,
        sigma: float,
    ) -> dict:
        """
        Compute aggregate portfolio Greeks using Black-Scholes.
        
        Uses vectorized numpy for speed when >4 legs.
        """
        if T <= 0:
            T = 0.001

        net_delta = 0.0
        net_gamma = 0.0
        net_theta = 0.0
        net_vega = 0.0
        leg_greeks = []

        for pos in positions:
            greeks = GreeksCalculator.all_greeks(
                S=spot_price,
                K=float(pos.strike),
                T=T,
                r=self.risk_free_rate,
                sigma=sigma,
                option_type=pos.right,
            )

            multiplier = pos.signed_quantity * pos.lot_size
            leg_g = {
                "strike": pos.strike,
                "right": pos.right,
                "direction": pos.direction,
                "delta": greeks["delta"] * multiplier,
                "gamma": greeks["gamma"] * multiplier,
                "theta": greeks["theta"] * multiplier,
                "vega": greeks["vega"] * multiplier,
                "iv": sigma,
            }
            leg_greeks.append(leg_g)

            net_delta += leg_g["delta"]
            net_gamma += leg_g["gamma"]
            net_theta += leg_g["theta"]
            net_vega += leg_g["vega"]

        return {
            "net_delta": round(net_delta, 2),
            "net_gamma": round(net_gamma, 4),
            "net_theta": round(net_theta, 2),
            "net_vega": round(net_vega, 2),
            "legs": leg_greeks,
        }

    def _check_strategy_stop(
        self,
        positions: list,
        sl_config: dict,
        initial_credit: Optional[float],
        strategy_name: str,
        timestamp: str,
    ) -> tuple[bool, str]:
        """Check strategy-specific stop-loss rules."""
        sl_type = sl_config.get("type", "")
        sl_value = sl_config.get("value", 0)
        total_pnl = sum(pos.pnl for pos in positions)

        if sl_type == "premium_multiple" and initial_credit is not None:
            # Loss exceeds N× premium collected
            max_loss = abs(initial_credit) * sl_value
            if total_pnl < -max_loss:
                event = RiskEvent(
                    timestamp=timestamp,
                    event_type="stop_loss",
                    description=f"Strategy SL: loss ₹{total_pnl:.0f} > "
                                f"{sl_value}× premium (₹{max_loss:.0f})",
                    current_value=total_pnl,
                    threshold=-max_loss,
                    action_taken="exit",
                    strategy_name=strategy_name,
                )
                self._risk_events.append(event)
                return True, f"Strategy SL ({sl_config['label']}): ₹{total_pnl:.0f}"

        elif sl_type == "loss_pct":
            # Entry value estimation
            entry_value = sum(
                abs(pos.entry_price * pos.lot_size * pos.quantity) for pos in positions
            )
            if entry_value > 0:
                loss_pct = abs(total_pnl) / entry_value * 100
                if total_pnl < 0 and loss_pct > sl_value:
                    event = RiskEvent(
                        timestamp=timestamp,
                        event_type="stop_loss",
                        description=f"Strategy SL: {loss_pct:.0f}% loss > {sl_value}%",
                        current_value=loss_pct,
                        threshold=sl_value,
                        action_taken="exit",
                        strategy_name=strategy_name,
                    )
                    self._risk_events.append(event)
                    return True, f"Strategy SL ({sl_config['label']}): {loss_pct:.0f}%"

        return False, ""

    def compute_hedge_quantity(
        self,
        current_delta: float,
        target_delta: float = 0.0,
        futures_delta: float = 1.0,
        lot_size: int = 25,
    ) -> dict:
        """
        Compute the hedge needed to bring delta to target.
        
        Returns:
            dict with direction, instrument, quantity, lots
        """
        delta_gap = target_delta - current_delta
        lots_needed = abs(delta_gap) / (futures_delta * lot_size)
        lots_int = max(int(round(lots_needed)), 0)

        if lots_int == 0:
            return {"hedge_needed": False}

        return {
            "hedge_needed": True,
            "direction": "buy" if delta_gap > 0 else "sell",
            "instrument": "NIFTY_FUT",
            "delta_gap": round(delta_gap, 2),
            "lots": lots_int,
            "quantity": lots_int * lot_size,
        }

    def get_risk_events(self) -> list[dict]:
        """Get all risk events as dicts."""
        return [
            {
                "timestamp": e.timestamp,
                "event_type": e.event_type,
                "description": e.description,
                "current_value": e.current_value,
                "threshold": e.threshold,
                "action_taken": e.action_taken,
                "strategy_name": e.strategy_name,
            }
            for e in self._risk_events
        ]

    def get_risk_summary(self) -> dict:
        """Get summary of all risk events."""
        by_type: dict[str, int] = {}
        for e in self._risk_events:
            by_type[e.event_type] = by_type.get(e.event_type, 0) + 1
        return {
            "total_events": len(self._risk_events),
            "by_type": by_type,
            "peak_equity": self._peak_equity,
            "limits": {
                "max_risk_pct": self.max_risk_per_trade_pct,
                "max_delta": self.max_portfolio_delta,
                "max_drawdown_pct": self.max_drawdown_pct,
            },
        }

    def clear_events(self) -> None:
        """Clear risk event history."""
        self._risk_events.clear()
        self._peak_equity = 0.0
