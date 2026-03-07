"""
Position manager — tracks open positions, calculates PnL, manages exits.
"""
from dataclasses import dataclass, field
from datetime import datetime, time as dt_time
from typing import Optional
import numpy as np


@dataclass
class LegPosition:
    """Tracks a single option leg position."""
    strike: int
    right: str                 # CE or PE
    direction: str             # buy or sell
    quantity: int              # lots
    lot_size: int
    entry_price: float
    entry_time: str
    current_price: float = 0.0
    high_price: float = 0.0
    low_price: float = 0.0
    label: str = ""

    @property
    def signed_quantity(self) -> int:
        """Positive for long, negative for short."""
        return self.quantity if self.direction == "buy" else -self.quantity

    @property
    def pnl(self) -> float:
        """Unrealized PnL for this leg."""
        price_diff = self.current_price - self.entry_price
        return price_diff * self.signed_quantity * self.lot_size

    @property
    def pnl_points(self) -> float:
        """PnL in points per lot."""
        price_diff = self.current_price - self.entry_price
        return price_diff * (1 if self.direction == "buy" else -1)

    def update_price(self, new_price: float):
        """Update current price and track high/low."""
        self.current_price = new_price
        self.high_price = max(self.high_price, new_price)
        self.low_price = min(self.low_price, new_price) if self.low_price > 0 else new_price


@dataclass
class Trade:
    """Completed trade record."""
    trade_id: str
    strategy_name: str
    expiry: str
    legs: list[dict]
    entry_time: str
    exit_time: str
    entry_premium: float       # Net premium at entry
    exit_premium: float        # Net premium at exit
    pnl: float                 # Net PnL (including costs)
    pnl_points: float          # PnL in points
    exit_reason: str           # stop_loss, target, time, etc.
    transaction_costs: float
    slippage_cost: float
    spot_at_entry: float = 0.0
    spot_at_exit: float = 0.0


@dataclass
class PositionManager:
    """Manages open positions and tracks PnL."""

    lot_size: int = 25
    positions: list[LegPosition] = field(default_factory=list)
    closed_trades: list[Trade] = field(default_factory=list)
    _trade_counter: int = 0

    @property
    def is_open(self) -> bool:
        """Check if there are any open positions."""
        return len(self.positions) > 0

    @property
    def total_pnl(self) -> float:
        """Total unrealized PnL across all open legs."""
        return sum(pos.pnl for pos in self.positions)

    @property
    def total_pnl_points(self) -> float:
        """Total PnL in points."""
        return sum(pos.pnl_points for pos in self.positions)

    def open_position(
        self,
        legs: list[dict],
        timestamp: str,
        lot_size: int = 25,
    ) -> list[LegPosition]:
        """
        Open new positions for all legs.

        Args:
            legs: List of resolved leg dicts with strike, right, direction, ltp, quantity
            timestamp: Entry time
            lot_size: Lot size for the instrument
        """
        self.lot_size = lot_size
        new_positions = []

        for leg_info in legs:
            pos = LegPosition(
                strike=leg_info["strike"],
                right=leg_info["right"],
                direction=leg_info["direction"],
                quantity=leg_info["quantity"],
                lot_size=lot_size,
                entry_price=leg_info["ltp"],
                entry_time=timestamp,
                current_price=leg_info["ltp"],
                high_price=leg_info["ltp"],
                low_price=leg_info["ltp"],
                label=leg_info.get("label", ""),
            )
            new_positions.append(pos)
            self.positions.append(pos)

        return new_positions

    def update_prices(self, price_map: dict[tuple[int, str], float]):
        """
        Update all position prices.

        Args:
            price_map: Dict mapping (strike, right) -> current_price
        """
        for pos in self.positions:
            key = (pos.strike, pos.right)
            if key in price_map:
                pos.update_price(price_map[key])

    def close_all(
        self,
        timestamp: str,
        exit_reason: str,
        strategy_name: str = "",
        expiry: str = "",
        transaction_costs: float = 0.0,
        slippage_cost: float = 0.0,
        spot_price: float = 0.0,
    ) -> Trade:
        """Close all open positions and record the trade."""
        self._trade_counter += 1
        trade_id = f"T{self._trade_counter:06d}"

        # Calculate entry and exit premiums
        entry_premium = 0.0
        exit_premium = 0.0

        legs_data = []
        for pos in self.positions:
            sign = 1 if pos.direction == "sell" else -1
            entry_premium += pos.entry_price * sign * pos.quantity
            exit_premium += pos.current_price * sign * pos.quantity

            legs_data.append({
                "strike": pos.strike,
                "right": pos.right,
                "direction": pos.direction,
                "quantity": pos.quantity,
                "entry_price": pos.entry_price,
                "exit_price": pos.current_price,
                "pnl_points": pos.pnl_points,
                "label": pos.label,
            })

        # PnL = (entry_premium - exit_premium) * lot_size for credit strategies
        # Total PnL across all legs
        total_pnl = sum(pos.pnl for pos in self.positions)
        total_pnl_points = sum(pos.pnl_points for pos in self.positions)

        total_pnl -= (transaction_costs + slippage_cost)

        entry_time = self.positions[0].entry_time if self.positions else timestamp

        trade = Trade(
            trade_id=trade_id,
            strategy_name=strategy_name,
            expiry=expiry,
            legs=legs_data,
            entry_time=entry_time,
            exit_time=timestamp,
            entry_premium=entry_premium * self.lot_size,
            exit_premium=exit_premium * self.lot_size,
            pnl=total_pnl,
            pnl_points=total_pnl_points,
            exit_reason=exit_reason,
            transaction_costs=transaction_costs,
            slippage_cost=slippage_cost,
            spot_at_entry=spot_price,
            spot_at_exit=spot_price,
        )

        self.closed_trades.append(trade)
        self.positions.clear()
        return trade

    def check_stop_loss(
        self,
        stop_loss_pct: float | None = None,
        stop_loss_points: float | None = None,
        stop_loss_multiplier: float | None = None,
        initial_credit: float | None = None,
        per_leg: bool = False,
    ) -> bool:
        """Check if stop-loss is triggered."""
        if not self.positions:
            return False

        if per_leg:
            # Check per-leg stop loss
            for pos in self.positions:
                if pos.direction == "sell" and stop_loss_multiplier and initial_credit:
                    leg_credit = pos.entry_price
                    leg_loss = pos.current_price - pos.entry_price
                    if leg_loss > leg_credit * stop_loss_multiplier:
                        return True
            return False

        # Portfolio-level stop loss
        total_pnl = self.total_pnl

        if stop_loss_points is not None:
            if total_pnl <= -(abs(stop_loss_points) * self.lot_size):
                return True

        if stop_loss_pct is not None and initial_credit:
            if total_pnl <= -(abs(initial_credit) * stop_loss_pct / 100):
                return True

        if stop_loss_multiplier is not None and initial_credit:
            if total_pnl <= -(abs(initial_credit) * stop_loss_multiplier):
                return True

        return False

    def check_target_profit(
        self,
        target_pct: float | None = None,
        target_points: float | None = None,
        initial_credit: float | None = None,
    ) -> bool:
        """Check if target profit is reached."""
        if not self.positions:
            return False

        total_pnl = self.total_pnl

        if target_points is not None:
            if total_pnl >= abs(target_points) * self.lot_size:
                return True

        if target_pct is not None and initial_credit:
            if total_pnl >= abs(initial_credit) * target_pct / 100:
                return True

        return False

    def check_time_exit(self, current_time: str, exit_time: str) -> bool:
        """Check if current time has passed the exit time."""
        try:
            ch, cm = map(int, current_time.split(":"))
            eh, em = map(int, exit_time.split(":"))
            return (ch, cm) >= (eh, em)
        except (ValueError, AttributeError):
            return False

    def get_position_summary(self) -> dict:
        """Get a summary of current positions."""
        return {
            "is_open": self.is_open,
            "total_pnl": self.total_pnl,
            "total_pnl_points": self.total_pnl_points,
            "legs": [
                {
                    "strike": pos.strike,
                    "right": pos.right,
                    "direction": pos.direction,
                    "entry_price": pos.entry_price,
                    "current_price": pos.current_price,
                    "pnl": pos.pnl,
                    "pnl_points": pos.pnl_points,
                    "label": pos.label,
                }
                for pos in self.positions
            ],
            "total_trades": len(self.closed_trades),
        }
