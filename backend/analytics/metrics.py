"""
Performance metrics calculation — Sharpe, Sortino, drawdown, profit factor, etc.
"""
import numpy as np
from typing import Optional


class MetricsCalculator:
    """Calculates portfolio performance metrics."""

    @staticmethod
    def calculate_sharpe_ratio(
        returns: list[float],
        risk_free_rate: float = 0.065,
        periods_per_year: int = 52,
    ) -> float:
        """
        Calculate annualized Sharpe ratio.

        Args:
            returns: List of trade/period returns
            risk_free_rate: Annual risk-free rate (default 6.5% for India)
            periods_per_year: Number of trading periods per year
        """
        if len(returns) < 2:
            return 0.0

        arr = np.array(returns, dtype=np.float64)
        mean_return = np.mean(arr)
        std_return = np.std(arr, ddof=1)

        if std_return == 0:
            return 0.0

        rf_per_period = risk_free_rate / periods_per_year
        sharpe = (mean_return - rf_per_period) / std_return * np.sqrt(periods_per_year)
        return float(sharpe)

    @staticmethod
    def calculate_sortino_ratio(
        returns: list[float],
        risk_free_rate: float = 0.065,
        periods_per_year: int = 52,
    ) -> float:
        """
        Calculate annualized Sortino ratio (uses downside deviation only).
        """
        if len(returns) < 2:
            return 0.0

        arr = np.array(returns, dtype=np.float64)
        mean_return = np.mean(arr)
        rf_per_period = risk_free_rate / periods_per_year

        # Downside deviation
        downside = arr[arr < rf_per_period] - rf_per_period
        if len(downside) == 0:
            return float('inf') if mean_return > rf_per_period else 0.0

        downside_std = np.sqrt(np.mean(downside ** 2))
        if downside_std == 0:
            return 0.0

        sortino = (mean_return - rf_per_period) / downside_std * np.sqrt(periods_per_year)
        return float(sortino)

    @staticmethod
    def calculate_max_drawdown(equity_curve: list[float]) -> dict:
        """
        Calculate maximum drawdown and its duration.

        Returns dict with:
            max_drawdown_pct: Maximum drawdown as percentage
            max_drawdown_abs: Maximum drawdown in absolute terms
            peak_idx: Index of the peak before max drawdown
            trough_idx: Index of the trough during max drawdown
        """
        if len(equity_curve) < 2:
            return {"max_drawdown_pct": 0.0, "max_drawdown_abs": 0.0}

        arr = np.array(equity_curve, dtype=np.float64)
        peak = np.maximum.accumulate(arr)
        drawdown = (arr - peak) / peak
        drawdown_abs = arr - peak

        max_dd_idx = np.argmin(drawdown)
        max_dd_pct = float(drawdown[max_dd_idx]) * 100

        # Find the peak before this trough
        peak_idx = np.argmax(arr[:max_dd_idx + 1]) if max_dd_idx > 0 else 0

        return {
            "max_drawdown_pct": abs(max_dd_pct),
            "max_drawdown_abs": abs(float(drawdown_abs[max_dd_idx])),
            "peak_idx": int(peak_idx),
            "trough_idx": int(max_dd_idx),
        }

    @staticmethod
    def calculate_cagr(
        initial_value: float,
        final_value: float,
        years: float,
    ) -> float:
        """Calculate Compound Annual Growth Rate."""
        if initial_value <= 0 or years <= 0:
            return 0.0

        cagr = (final_value / initial_value) ** (1 / years) - 1
        return float(cagr * 100)

    @staticmethod
    def calculate_profit_factor(
        winning_pnl: float,
        losing_pnl: float,
    ) -> float:
        """
        Calculate profit factor.
        Profit Factor = Gross Profit / Gross Loss.
        """
        if losing_pnl == 0:
            return float('inf') if winning_pnl > 0 else 0.0
        return abs(winning_pnl / losing_pnl)

    @staticmethod
    def calculate_win_rate(
        winning_trades: int,
        total_trades: int,
    ) -> float:
        """Calculate win rate percentage."""
        if total_trades == 0:
            return 0.0
        return (winning_trades / total_trades) * 100

    @staticmethod
    def calculate_expectancy(
        avg_win: float,
        avg_loss: float,
        win_rate: float,
    ) -> float:
        """
        Calculate trading expectancy.
        Expectancy = (Win Rate * Avg Win) - (Loss Rate * Avg Loss)
        """
        loss_rate = 100 - win_rate
        return (win_rate / 100 * avg_win) - (loss_rate / 100 * abs(avg_loss))

    @classmethod
    def calculate_all_metrics(
        cls,
        trades: list[dict],
        initial_capital: float = 1000000.0,
    ) -> dict:
        """
        Calculate all performance metrics from a list of trade dicts.
        Each trade dict must have 'pnl' key.
        """
        if not trades:
            return {
                "total_pnl": 0, "total_trades": 0, "win_rate": 0,
                "sharpe_ratio": 0, "sortino_ratio": 0, "max_drawdown_pct": 0,
                "profit_factor": 0, "avg_win": 0, "avg_loss": 0,
                "expectancy": 0, "cagr": 0,
            }

        pnls = [t["pnl"] for t in trades]
        winning = [p for p in pnls if p > 0]
        losing = [p for p in pnls if p <= 0]

        total_pnl = sum(pnls)
        win_rate = cls.calculate_win_rate(len(winning), len(pnls))
        avg_win = np.mean(winning) if winning else 0
        avg_loss = np.mean(losing) if losing else 0

        # Build equity curve
        equity = [initial_capital]
        for p in pnls:
            equity.append(equity[-1] + p)

        # Estimate years from number of trades (weekly expiry assumption)
        years = max(len(pnls) / 52, 0.01)

        return {
            "total_pnl": float(total_pnl),
            "total_trades": len(pnls),
            "winning_trades": len(winning),
            "losing_trades": len(losing),
            "win_rate": float(win_rate),
            "avg_win": float(avg_win),
            "avg_loss": float(avg_loss),
            "max_win": float(max(winning)) if winning else 0,
            "max_loss": float(min(losing)) if losing else 0,
            "sharpe_ratio": cls.calculate_sharpe_ratio(pnls),
            "sortino_ratio": cls.calculate_sortino_ratio(pnls),
            "max_drawdown": cls.calculate_max_drawdown(equity),
            "profit_factor": cls.calculate_profit_factor(
                sum(winning), sum(losing)
            ),
            "expectancy": cls.calculate_expectancy(
                float(avg_win), float(avg_loss), win_rate
            ),
            "cagr": cls.calculate_cagr(
                initial_capital, equity[-1], years
            ),
            "return_pct": float((equity[-1] - initial_capital) / initial_capital * 100),
        }
