"""
Base strategy definitions — dataclasses for strategy configuration.
"""
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class Direction(str, Enum):
    BUY = "buy"
    SELL = "sell"


class OptionRight(str, Enum):
    CE = "CE"
    PE = "PE"


class StrikeType(str, Enum):
    ATM = "atm"
    OTM = "otm"
    ITM = "itm"
    EXACT = "exact"


class ExitType(str, Enum):
    STOP_LOSS = "stop_loss"
    TARGET_PROFIT = "target_profit"
    TIME_EXIT = "time_exit"
    TRAILING_SL = "trailing_sl"
    DELTA_EXIT = "delta_exit"


@dataclass
class StrategyLeg:
    """Defines a single leg of an options strategy."""
    direction: Direction        # buy or sell
    right: OptionRight          # CE or PE
    strike_offset: int = 0      # Offset from ATM (positive = OTM for CE, ITM for PE)
    quantity: int = 1           # Number of lots
    label: str = ""             # Human-readable label

    @property
    def is_long(self) -> bool:
        return self.direction == Direction.BUY

    @property
    def is_short(self) -> bool:
        return self.direction == Direction.SELL


@dataclass
class EntryCondition:
    """Conditions that must be met for strategy entry."""
    entry_time: str = "09:20"              # Time to enter
    iv_percentile_min: Optional[float] = None  # Min IV percentile
    iv_percentile_max: Optional[float] = None  # Max IV percentile
    trend_filter: Optional[str] = None         # 'bullish', 'bearish', 'neutral'
    spot_range_pct: Optional[float] = None     # % range from previous close
    ml_prediction_direction: Optional[str] = None # 'UP', 'DOWN'
    ml_prediction_threshold: Optional[float] = None # minimum probability e.g. 0.65
    custom_conditions: list[str] = field(default_factory=list)


@dataclass
class ExitCondition:
    """Exit rules for the strategy."""
    exit_time: str = "15:15"                   # Time-based exit
    stop_loss_pct: Optional[float] = None      # % of premium received
    stop_loss_points: Optional[float] = None   # Absolute points
    stop_loss_multiplier: Optional[float] = None  # Multiplier of credit (e.g., 2x)
    target_profit_pct: Optional[float] = None  # % of premium
    target_profit_points: Optional[float] = None
    trailing_sl_pct: Optional[float] = None    # Trailing stop-loss %
    delta_exit_threshold: Optional[float] = None  # Exit when delta crosses threshold
    per_leg_sl: bool = False                   # Apply SL per leg or on total


@dataclass
class Strategy:
    """Complete strategy definition."""
    name: str                                  # Strategy name
    description: str = ""                      # Description
    legs: list[StrategyLeg] = field(default_factory=list)
    entry: EntryCondition = field(default_factory=EntryCondition)
    exit: ExitCondition = field(default_factory=ExitCondition)
    lot_size: int = 25                         # NIFTY lot size
    max_positions: int = 1                     # Max concurrent positions
    tags: list[str] = field(default_factory=list)

    @property
    def total_lots(self) -> int:
        return sum(leg.quantity for leg in self.legs)

    @property
    def is_credit_strategy(self) -> bool:
        """Check if strategy collects net premium."""
        short_legs = sum(1 for leg in self.legs if leg.is_short)
        return short_legs > 0

    def to_dict(self) -> dict:
        """Convert strategy to dictionary for serialization."""
        return {
            "name": self.name,
            "description": self.description,
            "lot_size": self.lot_size,
            "max_positions": self.max_positions,
            "tags": self.tags,
            "legs": [
                {
                    "direction": leg.direction.value,
                    "right": leg.right.value,
                    "strike_offset": leg.strike_offset,
                    "quantity": leg.quantity,
                    "label": leg.label,
                }
                for leg in self.legs
            ],
            "entry": {
                "entry_time": self.entry.entry_time,
                "iv_percentile_min": self.entry.iv_percentile_min,
                "iv_percentile_max": self.entry.iv_percentile_max,
                "trend_filter": self.entry.trend_filter,
                "spot_range_pct": self.entry.spot_range_pct,
                "ml_prediction_direction": self.entry.ml_prediction_direction,
                "ml_prediction_threshold": self.entry.ml_prediction_threshold,
            },
            "exit": {
                "exit_time": self.exit.exit_time,
                "stop_loss_pct": self.exit.stop_loss_pct,
                "stop_loss_points": self.exit.stop_loss_points,
                "stop_loss_multiplier": self.exit.stop_loss_multiplier,
                "target_profit_pct": self.exit.target_profit_pct,
                "target_profit_points": self.exit.target_profit_points,
                "trailing_sl_pct": self.exit.trailing_sl_pct,
                "per_leg_sl": self.exit.per_leg_sl,
            },
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Strategy":
        """Create strategy from dictionary."""
        legs = [
            StrategyLeg(
                direction=Direction(leg["direction"]),
                right=OptionRight(leg["right"]),
                strike_offset=leg.get("strike_offset", 0),
                quantity=leg.get("quantity", 1),
                label=leg.get("label", ""),
            )
            for leg in data.get("legs", [])
        ]

        entry_data = data.get("entry", {})
        entry = EntryCondition(
            entry_time=entry_data.get("entry_time", "09:20"),
            iv_percentile_min=entry_data.get("iv_percentile_min"),
            iv_percentile_max=entry_data.get("iv_percentile_max"),
            trend_filter=entry_data.get("trend_filter"),
            spot_range_pct=entry_data.get("spot_range_pct"),
            ml_prediction_direction=entry_data.get("ml_prediction_direction"),
            ml_prediction_threshold=entry_data.get("ml_prediction_threshold"),
        )

        exit_data = data.get("exit", {})
        exit_cond = ExitCondition(
            exit_time=exit_data.get("exit_time", "15:15"),
            stop_loss_pct=exit_data.get("stop_loss_pct"),
            stop_loss_points=exit_data.get("stop_loss_points"),
            stop_loss_multiplier=exit_data.get("stop_loss_multiplier"),
            target_profit_pct=exit_data.get("target_profit_pct"),
            target_profit_points=exit_data.get("target_profit_points"),
            trailing_sl_pct=exit_data.get("trailing_sl_pct"),
            per_leg_sl=exit_data.get("per_leg_sl", False),
        )

        return cls(
            name=data["name"],
            description=data.get("description", ""),
            legs=legs,
            entry=entry,
            exit=exit_cond,
            lot_size=data.get("lot_size", 25),
            max_positions=data.get("max_positions", 1),
            tags=data.get("tags", []),
        )
