"""
Position Monitor — Real-time position monitoring with Greeks tracking.

Provides per-tick monitoring of:
    - Portfolio Greeks (delta, gamma, theta, vega)
    - PnL tracking with high-water mark
    - Risk threshold alerts
    - Greeks timeline for analytics

Optimized for backtesting speed with batched numpy calculations.
"""
import numpy as np
from dataclasses import dataclass, field
from typing import Optional

from backend.analytics.greeks import GreeksCalculator
from backend.logger import logger


@dataclass
class PositionSnapshot:
    """Captures the state of all positions at a point in time."""
    timestamp: str
    spot_price: float
    net_delta: float
    net_gamma: float
    net_theta: float
    net_vega: float
    total_pnl: float
    unrealized_pnl: float
    num_legs: int
    strategy_name: str
    regime: str = ""


class PositionMonitor:
    """
    Tracks position Greeks and PnL over time during backtesting.
    
    Produces a timeline of PositionSnapshots for visualization
    and risk analysis. Uses vectorized calculations for speed.
    """

    def __init__(
        self,
        snapshot_interval: int = 5,         # Take snapshot every N minutes
        risk_free_rate: float = 0.065,
        default_sigma: float = 0.20,
    ):
        self.snapshot_interval = snapshot_interval
        self.risk_free_rate = risk_free_rate
        self.default_sigma = default_sigma
        self._timeline: list[PositionSnapshot] = []
        self._bars_since_snapshot = 0
        self._high_water_mark = 0.0
        self._max_drawdown = 0.0

    def tick(
        self,
        positions: list,           # list of LegPosition
        spot_price: float,
        timestamp: str,
        strategy_name: str = "",
        regime: str = "",
        time_to_expiry_years: float = 0.01,
        sigma: Optional[float] = None,
        force_snapshot: bool = False,
    ) -> Optional[PositionSnapshot]:
        """
        Process a monitoring tick.
        
        Takes a snapshot at the configured interval or when forced.
        Returns the snapshot if one was taken, None otherwise.
        """
        self._bars_since_snapshot += 1

        if not force_snapshot and self._bars_since_snapshot < self.snapshot_interval:
            return None

        self._bars_since_snapshot = 0

        if not positions:
            return None

        vol = sigma or self.default_sigma
        T = max(time_to_expiry_years, 0.0001)

        # --- Vectorized Greeks computation ---
        greeks = self._compute_greeks_vectorized(positions, spot_price, T, vol)

        total_pnl = sum(pos.pnl for pos in positions)

        # Track drawdown
        self._high_water_mark = max(self._high_water_mark, total_pnl)
        current_dd = self._high_water_mark - total_pnl
        self._max_drawdown = max(self._max_drawdown, current_dd)

        snapshot = PositionSnapshot(
            timestamp=timestamp,
            spot_price=spot_price,
            net_delta=greeks["net_delta"],
            net_gamma=greeks["net_gamma"],
            net_theta=greeks["net_theta"],
            net_vega=greeks["net_vega"],
            total_pnl=total_pnl,
            unrealized_pnl=total_pnl,
            num_legs=len(positions),
            strategy_name=strategy_name,
            regime=regime,
        )

        self._timeline.append(snapshot)
        return snapshot

    def _compute_greeks_vectorized(
        self,
        positions: list,
        spot_price: float,
        T: float,
        sigma: float,
    ) -> dict:
        """
        Compute portfolio Greeks using numpy vectorization for speed.
        
        For N legs, computes all Greeks in parallel using array operations.
        """
        n = len(positions)
        if n == 0:
            return {"net_delta": 0, "net_gamma": 0, "net_theta": 0, "net_vega": 0}

        # Build arrays
        strikes = np.array([float(p.strike) for p in positions])
        multipliers = np.array([
            p.signed_quantity * p.lot_size for p in positions
        ], dtype=np.float64)
        is_call = np.array([1.0 if p.right == "CE" else 0.0 for p in positions])

        S = float(spot_price)
        r = self.risk_free_rate

        # Vectorized Black-Scholes intermediate values
        with np.errstate(divide='ignore', invalid='ignore'):
            log_SK = np.log(S / strikes)
            sqrt_T = np.sqrt(T)
            d1 = (log_SK + (r + 0.5 * sigma ** 2) * T) / (sigma * sqrt_T)
            d2 = d1 - sigma * sqrt_T

        # Standard normal PDF and CDF
        from scipy.stats import norm
        nd1 = norm.cdf(d1)
        nd2 = norm.cdf(d2)
        npd1 = norm.pdf(d1)

        # Delta: call = N(d1), put = N(d1) - 1
        call_delta = nd1
        put_delta = nd1 - 1.0
        raw_delta = np.where(is_call == 1.0, call_delta, put_delta)
        weighted_delta = raw_delta * multipliers

        # Gamma: same for calls and puts
        raw_gamma = npd1 / (S * sigma * sqrt_T)
        weighted_gamma = raw_gamma * multipliers

        # Theta: per day
        common_theta = -(S * npd1 * sigma) / (2 * sqrt_T)
        call_theta = common_theta - r * strikes * np.exp(-r * T) * nd2
        put_theta = common_theta + r * strikes * np.exp(-r * T) * norm.cdf(-d2)
        raw_theta = np.where(is_call == 1.0, call_theta, put_theta) / 365.0
        weighted_theta = raw_theta * multipliers

        # Vega: same for calls and puts (per 1% vol change)
        raw_vega = S * npd1 * sqrt_T / 100.0
        weighted_vega = raw_vega * multipliers

        return {
            "net_delta": round(float(np.nansum(weighted_delta)), 2),
            "net_gamma": round(float(np.nansum(weighted_gamma)), 4),
            "net_theta": round(float(np.nansum(weighted_theta)), 2),
            "net_vega": round(float(np.nansum(weighted_vega)), 2),
        }

    def get_timeline(self) -> list[dict]:
        """Get the full monitoring timeline as dicts."""
        return [
            {
                "timestamp": s.timestamp,
                "spot_price": s.spot_price,
                "net_delta": s.net_delta,
                "net_gamma": s.net_gamma,
                "net_theta": s.net_theta,
                "net_vega": s.net_vega,
                "total_pnl": s.total_pnl,
                "unrealized_pnl": s.unrealized_pnl,
                "num_legs": s.num_legs,
                "strategy_name": s.strategy_name,
                "regime": s.regime,
            }
            for s in self._timeline
        ]

    def get_greeks_summary(self) -> dict:
        """Get peak Greeks exposure and statistics."""
        if not self._timeline:
            return {
                "snapshots": 0,
                "max_delta": 0, "min_delta": 0,
                "max_gamma": 0, "max_theta": 0, "max_vega": 0,
                "max_drawdown": 0,
            }

        deltas = [s.net_delta for s in self._timeline]
        gammas = [s.net_gamma for s in self._timeline]
        thetas = [s.net_theta for s in self._timeline]
        vegas = [s.net_vega for s in self._timeline]

        return {
            "snapshots": len(self._timeline),
            "max_delta": round(max(deltas), 2),
            "min_delta": round(min(deltas), 2),
            "avg_delta": round(sum(deltas) / len(deltas), 2),
            "max_gamma": round(max(gammas, key=abs), 4),
            "max_theta": round(min(thetas), 2),  # Most negative = most decay
            "avg_theta": round(sum(thetas) / len(thetas), 2),
            "max_vega": round(max(vegas, key=abs), 2),
            "max_drawdown": round(self._max_drawdown, 2),
            "high_water_mark": round(self._high_water_mark, 2),
        }

    def clear(self) -> None:
        """Clear all monitoring data."""
        self._timeline.clear()
        self._bars_since_snapshot = 0
        self._high_water_mark = 0.0
        self._max_drawdown = 0.0
