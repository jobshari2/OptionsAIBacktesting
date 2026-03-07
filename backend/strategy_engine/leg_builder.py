"""
Leg builder — resolves strategy leg definitions to actual strikes
using current market data.
"""
import polars as pl
import numpy as np
from typing import Optional

from .base_strategy import StrategyLeg, OptionRight, Direction


class LegBuilder:
    """
    Builds concrete option legs by resolving abstract strike offsets
    to actual market strikes.
    """

    STRIKE_STEP = 50  # NIFTY strike step

    @classmethod
    def resolve_strikes(
        cls,
        legs: list[StrategyLeg],
        spot_price: float,
        available_strikes: list[int] | None = None,
    ) -> list[dict]:
        """
        Resolve strategy legs to concrete strike prices.

        Args:
            legs: List of StrategyLeg definitions
            spot_price: Current spot/underlying price
            available_strikes: Optional list of available strikes in data

        Returns:
            List of dicts with resolved strike info
        """
        atm_strike = cls._get_atm_strike(spot_price)
        resolved = []

        for leg in legs:
            strike = cls._resolve_single_strike(leg, atm_strike, available_strikes)
            resolved.append({
                "leg": leg,
                "strike": strike,
                "right": leg.right.value,
                "direction": leg.direction.value,
                "quantity": leg.quantity,
                "label": leg.label or f"{'Buy' if leg.is_long else 'Sell'} {strike} {leg.right.value}",
            })

        return resolved

    @classmethod
    def _get_atm_strike(cls, spot_price: float) -> int:
        """Get ATM strike price rounded to nearest strike step."""
        return int(round(spot_price / cls.STRIKE_STEP) * cls.STRIKE_STEP)

    @classmethod
    def _resolve_single_strike(
        cls,
        leg: StrategyLeg,
        atm_strike: int,
        available_strikes: list[int] | None = None,
    ) -> int:
        """Resolve a single leg's strike offset to actual strike price."""
        if leg.strike_offset == 0:
            strike = atm_strike
        else:
            # For CE: positive offset = OTM (higher strike)
            # For PE: positive offset = OTM (lower strike)
            if leg.right == OptionRight.CE:
                strike = atm_strike + leg.strike_offset
            else:
                strike = atm_strike - leg.strike_offset

        # Round to nearest available strike
        strike = int(round(strike / cls.STRIKE_STEP) * cls.STRIKE_STEP)

        # Snap to nearest available strike if list provided
        if available_strikes:
            strike = min(available_strikes, key=lambda s: abs(s - strike))

        return strike

    @classmethod
    def get_leg_prices(
        cls,
        resolved_legs: list[dict],
        options_snapshot: pl.DataFrame,
    ) -> list[dict]:
        """
        Get current prices for resolved legs from an options snapshot.

        Args:
            resolved_legs: Output from resolve_strikes()
            options_snapshot: Options data for a specific timestamp

        Returns:
            Resolved legs enriched with price data
        """
        for leg_info in resolved_legs:
            strike = leg_info["strike"]
            right = leg_info["right"]

            # Find matching option in snapshot
            match = options_snapshot.filter(
                (pl.col("Strike") == strike) & (pl.col("Right") == right)
            )

            if len(match) > 0:
                row = match.row(0, named=True)
                leg_info["ltp"] = row.get("Close", 0.0)
                leg_info["open"] = row.get("Open", 0.0)
                leg_info["high"] = row.get("High", 0.0)
                leg_info["low"] = row.get("Low", 0.0)
                leg_info["volume"] = row.get("Volume", 0)
                leg_info["oi"] = row.get("OI", 0)
            else:
                leg_info["ltp"] = 0.0
                leg_info["open"] = 0.0
                leg_info["high"] = 0.0
                leg_info["low"] = 0.0
                leg_info["volume"] = 0
                leg_info["oi"] = 0

        return resolved_legs

    @classmethod
    def calculate_net_premium(cls, resolved_legs: list[dict], lot_size: int = 25) -> float:
        """
        Calculate net premium for the position.
        Positive = net credit, Negative = net debit.
        """
        net = 0.0
        for leg_info in resolved_legs:
            price = leg_info.get("ltp", 0.0)
            qty = leg_info["quantity"]
            if leg_info["direction"] == "sell":
                net += price * qty * lot_size
            else:
                net -= price * qty * lot_size
        return net

    @classmethod
    def build_iron_condor_legs(
        cls,
        sell_offset: int = 200,
        buy_offset: int = 400,
    ) -> list[StrategyLeg]:
        """Helper to build standard Iron Condor legs."""
        return [
            StrategyLeg(Direction.SELL, OptionRight.CE, sell_offset, 1, "Sell CE"),
            StrategyLeg(Direction.SELL, OptionRight.PE, sell_offset, 1, "Sell PE"),
            StrategyLeg(Direction.BUY, OptionRight.CE, buy_offset, 1, "Buy CE"),
            StrategyLeg(Direction.BUY, OptionRight.PE, buy_offset, 1, "Buy PE"),
        ]

    @classmethod
    def build_straddle_legs(cls, direction: Direction = Direction.SELL) -> list[StrategyLeg]:
        """Helper to build straddle legs."""
        return [
            StrategyLeg(direction, OptionRight.CE, 0, 1, f"{'Sell' if direction == Direction.SELL else 'Buy'} CE ATM"),
            StrategyLeg(direction, OptionRight.PE, 0, 1, f"{'Sell' if direction == Direction.SELL else 'Buy'} PE ATM"),
        ]

    @classmethod
    def build_strangle_legs(
        cls,
        offset: int = 200,
        direction: Direction = Direction.SELL,
    ) -> list[StrategyLeg]:
        """Helper to build strangle legs."""
        label = "Sell" if direction == Direction.SELL else "Buy"
        return [
            StrategyLeg(direction, OptionRight.CE, offset, 1, f"{label} CE OTM"),
            StrategyLeg(direction, OptionRight.PE, offset, 1, f"{label} PE OTM"),
        ]
