"""
Payoff diagram calculator for multi-leg options strategies.
"""
import numpy as np
from typing import Optional


class PayoffCalculator:
    """Calculates payoff diagrams for multi-leg options strategies."""

    @staticmethod
    def calculate_leg_payoff(
        spot_range: np.ndarray,
        strike: float,
        premium: float,
        right: str,
        direction: str,
        quantity: int = 1,
        lot_size: int = 25,
    ) -> np.ndarray:
        """
        Calculate payoff for a single option leg.

        Args:
            spot_range: Array of spot prices to calculate payoff for
            strike: Strike price
            premium: Premium paid/received
            right: 'CE' or 'PE'
            direction: 'buy' or 'sell'
            quantity: Number of lots
            lot_size: Lot size
        """
        if right == "CE":
            intrinsic = np.maximum(spot_range - strike, 0)
        else:
            intrinsic = np.maximum(strike - spot_range, 0)

        if direction == "buy":
            payoff = (intrinsic - premium) * quantity * lot_size
        else:
            payoff = (premium - intrinsic) * quantity * lot_size

        return payoff

    @classmethod
    def calculate_strategy_payoff(
        cls,
        legs: list[dict],
        spot_price: float,
        lot_size: int = 25,
        range_pct: float = 10.0,
        num_points: int = 200,
    ) -> dict:
        """
        Calculate total strategy payoff across a range of spot prices.

        Args:
            legs: List of leg dicts with strike, premium (entry_price), right, direction, quantity
            spot_price: Current spot price
            lot_size: Lot size
            range_pct: Percentage range around spot to show
            num_points: Number of data points

        Returns:
            Dict with spot_range, total_payoff, leg_payoffs, breakevens, etc.
        """
        lower = spot_price * (1 - range_pct / 100)
        upper = spot_price * (1 + range_pct / 100)
        spot_range = np.linspace(lower, upper, num_points)

        total_payoff = np.zeros(num_points)
        leg_payoffs = []

        for leg in legs:
            premium = leg.get("entry_price", leg.get("premium", leg.get("ltp", 0)))
            leg_pf = cls.calculate_leg_payoff(
                spot_range=spot_range,
                strike=leg["strike"],
                premium=premium,
                right=leg["right"],
                direction=leg["direction"],
                quantity=leg.get("quantity", 1),
                lot_size=lot_size,
            )
            total_payoff += leg_pf
            leg_payoffs.append({
                "label": leg.get("label", f"{leg['direction']} {leg['strike']} {leg['right']}"),
                "payoff": leg_pf.tolist(),
            })

        # Find breakeven points
        breakevens = cls._find_breakevens(spot_range, total_payoff)

        return {
            "spot_range": spot_range.tolist(),
            "total_payoff": total_payoff.tolist(),
            "leg_payoffs": leg_payoffs,
            "max_profit": float(np.max(total_payoff)),
            "max_loss": float(np.min(total_payoff)),
            "breakeven_points": breakevens,
            "current_spot": spot_price,
            "current_payoff": float(np.interp(spot_price, spot_range, total_payoff)),
        }

    @staticmethod
    def _find_breakevens(
        spot_range: np.ndarray,
        payoff: np.ndarray,
    ) -> list[float]:
        """Find breakeven points where payoff crosses zero."""
        breakevens = []
        for i in range(len(payoff) - 1):
            if payoff[i] * payoff[i + 1] < 0:  # Sign change
                # Linear interpolation
                x = spot_range[i] - payoff[i] * (spot_range[i + 1] - spot_range[i]) / (payoff[i + 1] - payoff[i])
                breakevens.append(float(round(x, 2)))
        return breakevens

    @classmethod
    def calculate_dynamic_payoff(
        cls,
        legs: list[dict],
        spot_price: float,
        lot_size: int = 25,
        range_pct: float = 10.0,
        num_points: int = 200,
    ) -> dict:
        """
        Calculate dynamic payoff with current PnL overlay.
        Uses current_price for Mark-to-Market.
        """
        result = cls.calculate_strategy_payoff(
            legs=legs,
            spot_price=spot_price,
            lot_size=lot_size,
            range_pct=range_pct,
            num_points=num_points,
        )

        # Calculate current MTM PnL
        current_pnl = 0.0
        for leg in legs:
            entry_price = leg.get("entry_price", leg.get("premium", 0))
            current_price = leg.get("current_price", entry_price)
            qty = leg.get("quantity", 1)

            if leg["direction"] == "buy":
                current_pnl += (current_price - entry_price) * qty * lot_size
            else:
                current_pnl += (entry_price - current_price) * qty * lot_size

        result["current_mtm_pnl"] = float(current_pnl)
        return result
