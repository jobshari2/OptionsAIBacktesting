"""
Trade simulator — handles order fills, slippage, and transaction costs.
"""
import numpy as np
from dataclasses import dataclass

from backend.config import config


@dataclass
class SlippageModel:
    """Slippage model combining fixed and percentage components."""
    fixed: float = 0.5           # Fixed slippage per unit (Rs)
    percentage: float = 0.05     # Percentage slippage
    use_volume_impact: bool = True

    def calculate_slippage(
        self,
        price: float,
        quantity: int,
        volume: float = 0,
        is_buy: bool = True,
    ) -> float:
        """
        Calculate slippage for an order.
        Returns the slippage-adjusted price.
        """
        base_slippage = self.fixed + (price * self.percentage / 100)

        # Volume impact — higher slippage for illiquid options
        volume_multiplier = 1.0
        if self.use_volume_impact and volume > 0:
            # If volume is low, slippage increases
            if volume < 100:
                volume_multiplier = 2.0
            elif volume < 500:
                volume_multiplier = 1.5
            elif volume < 1000:
                volume_multiplier = 1.2

        total_slippage = base_slippage * volume_multiplier

        # Buy orders pay more, sell orders receive less
        if is_buy:
            return price + total_slippage
        else:
            return price - total_slippage


@dataclass
class TransactionCostModel:
    """Transaction cost model."""
    cost_per_order: float = 20.0       # Brokerage per order
    stt_pct: float = 0.0125             # STT (sell side only for options)
    exchange_charges_pct: float = 0.053  # Exchange transaction charges %
    gst_pct: float = 18.0               # GST on brokerage
    sebi_charges_per_crore: float = 10.0  # SEBI charges

    def calculate_costs(
        self,
        price: float,
        quantity: int,
        lot_size: int,
        is_sell: bool = False,
        num_legs: int = 1,
    ) -> float:
        """
        Calculate total transaction costs.
        """
        turnover = price * quantity * lot_size

        # Brokerage (per order)
        brokerage = self.cost_per_order * num_legs

        # GST on brokerage
        gst = brokerage * self.gst_pct / 100

        # STT — only on sell side for options
        stt = 0.0
        if is_sell:
            stt = turnover * self.stt_pct / 100

        # Exchange charges
        exchange = turnover * self.exchange_charges_pct / 10000

        # SEBI charges
        sebi = turnover * self.sebi_charges_per_crore / 10000000

        return brokerage + gst + stt + exchange + sebi


class TradeSimulator:
    """
    Simulates trade execution with realistic slippage and costs.
    """

    def __init__(
        self,
        slippage: SlippageModel | None = None,
        costs: TransactionCostModel | None = None,
    ):
        self.slippage = slippage or SlippageModel(
            fixed=config.backtest.default_slippage_fixed,
            percentage=config.backtest.default_slippage_pct,
        )
        self.costs = costs or TransactionCostModel(
            cost_per_order=config.backtest.default_transaction_cost,
        )

    def simulate_entry(
        self,
        legs: list[dict],
        lot_size: int = 25,
    ) -> tuple[list[dict], float, float]:
        """
        Simulate order entry for all legs.

        Returns:
            (adjusted_legs, total_slippage_cost, total_transaction_cost)
        """
        adjusted_legs = []
        total_slippage = 0.0

        for leg_info in legs:
            is_buy = leg_info["direction"] == "buy"
            volume = leg_info.get("volume", 1000)
            original_price = leg_info["ltp"]

            adjusted_price = self.slippage.calculate_slippage(
                price=original_price,
                quantity=leg_info["quantity"],
                volume=volume,
                is_buy=is_buy,
            )

            slip = abs(adjusted_price - original_price) * leg_info["quantity"] * lot_size
            total_slippage += slip

            adjusted_leg = {**leg_info, "ltp": adjusted_price}
            adjusted_legs.append(adjusted_leg)

        # Transaction costs for entry
        avg_price = np.mean([l["ltp"] for l in adjusted_legs]) if adjusted_legs else 0
        total_qty = sum(l["quantity"] for l in adjusted_legs)
        entry_costs = self.costs.calculate_costs(
            price=avg_price,
            quantity=total_qty,
            lot_size=lot_size,
            is_sell=False,
            num_legs=len(adjusted_legs),
        )

        return adjusted_legs, total_slippage, entry_costs

    def simulate_exit(
        self,
        legs: list[dict],
        lot_size: int = 25,
    ) -> tuple[list[dict], float, float]:
        """
        Simulate order exit for all legs.

        Returns:
            (adjusted_legs, total_slippage_cost, total_transaction_cost)
        """
        adjusted_legs = []
        total_slippage = 0.0

        for leg_info in legs:
            # Exit is opposite of entry direction
            is_buy = leg_info["direction"] == "sell"  # Close short = buy
            volume = leg_info.get("volume", 1000)
            original_price = leg_info.get("current_price", leg_info.get("ltp", 0))

            adjusted_price = self.slippage.calculate_slippage(
                price=original_price,
                quantity=leg_info["quantity"],
                volume=volume,
                is_buy=is_buy,
            )

            slip = abs(adjusted_price - original_price) * leg_info["quantity"] * lot_size
            total_slippage += slip

            adjusted_leg = {**leg_info, "exit_price": adjusted_price}
            adjusted_legs.append(adjusted_leg)

        # Transaction costs for exit (sell side incurs STT)
        avg_price = np.mean([l.get("exit_price", 0) for l in adjusted_legs]) if adjusted_legs else 0
        total_qty = sum(l["quantity"] for l in adjusted_legs)
        exit_costs = self.costs.calculate_costs(
            price=avg_price,
            quantity=total_qty,
            lot_size=lot_size,
            is_sell=True,
            num_legs=len(adjusted_legs),
        )

        return adjusted_legs, total_slippage, exit_costs
