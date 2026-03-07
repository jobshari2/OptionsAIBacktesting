"""
Black-Scholes Greeks calculator for options analytics.
"""
import numpy as np
from scipy.stats import norm
from typing import Optional


class GreeksCalculator:
    """
    Calculates option Greeks using the Black-Scholes model.
    """

    @staticmethod
    def black_scholes_price(
        S: float,        # Spot price
        K: float,        # Strike price
        T: float,        # Time to expiry (years)
        r: float,        # Risk-free rate
        sigma: float,    # Volatility
        option_type: str = "CE",  # 'CE' for call, 'PE' for put
    ) -> float:
        """Calculate Black-Scholes option price."""
        if T <= 0 or sigma <= 0:
            # At expiry or zero vol
            if option_type == "CE":
                return max(S - K, 0)
            else:
                return max(K - S, 0)

        d1 = (np.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * np.sqrt(T))
        d2 = d1 - sigma * np.sqrt(T)

        if option_type == "CE":
            price = S * norm.cdf(d1) - K * np.exp(-r * T) * norm.cdf(d2)
        else:
            price = K * np.exp(-r * T) * norm.cdf(-d2) - S * norm.cdf(-d1)

        return float(price)

    @staticmethod
    def delta(
        S: float, K: float, T: float, r: float, sigma: float,
        option_type: str = "CE",
    ) -> float:
        """Calculate option delta."""
        if T <= 0 or sigma <= 0:
            if option_type == "CE":
                return 1.0 if S > K else 0.0
            else:
                return -1.0 if S < K else 0.0

        d1 = (np.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * np.sqrt(T))

        if option_type == "CE":
            return float(norm.cdf(d1))
        else:
            return float(norm.cdf(d1) - 1)

    @staticmethod
    def gamma(
        S: float, K: float, T: float, r: float, sigma: float,
    ) -> float:
        """Calculate option gamma (same for calls and puts)."""
        if T <= 0 or sigma <= 0:
            return 0.0

        d1 = (np.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * np.sqrt(T))
        return float(norm.pdf(d1) / (S * sigma * np.sqrt(T)))

    @staticmethod
    def theta(
        S: float, K: float, T: float, r: float, sigma: float,
        option_type: str = "CE",
    ) -> float:
        """Calculate option theta (per day)."""
        if T <= 0 or sigma <= 0:
            return 0.0

        d1 = (np.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * np.sqrt(T))
        d2 = d1 - sigma * np.sqrt(T)

        common = -(S * norm.pdf(d1) * sigma) / (2 * np.sqrt(T))

        if option_type == "CE":
            theta_val = common - r * K * np.exp(-r * T) * norm.cdf(d2)
        else:
            theta_val = common + r * K * np.exp(-r * T) * norm.cdf(-d2)

        # Convert to per-day
        return float(theta_val / 365)

    @staticmethod
    def vega(
        S: float, K: float, T: float, r: float, sigma: float,
    ) -> float:
        """Calculate option vega (for 1% change in volatility)."""
        if T <= 0 or sigma <= 0:
            return 0.0

        d1 = (np.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * np.sqrt(T))
        return float(S * norm.pdf(d1) * np.sqrt(T) / 100)

    @staticmethod
    def rho(
        S: float, K: float, T: float, r: float, sigma: float,
        option_type: str = "CE",
    ) -> float:
        """Calculate option rho."""
        if T <= 0 or sigma <= 0:
            return 0.0

        d2 = (np.log(S / K) + (r - 0.5 * sigma ** 2) * T) / (sigma * np.sqrt(T))

        if option_type == "CE":
            return float(K * T * np.exp(-r * T) * norm.cdf(d2) / 100)
        else:
            return float(-K * T * np.exp(-r * T) * norm.cdf(-d2) / 100)

    @classmethod
    def all_greeks(
        cls,
        S: float, K: float, T: float, r: float, sigma: float,
        option_type: str = "CE",
    ) -> dict:
        """Calculate all Greeks at once."""
        return {
            "price": cls.black_scholes_price(S, K, T, r, sigma, option_type),
            "delta": cls.delta(S, K, T, r, sigma, option_type),
            "gamma": cls.gamma(S, K, T, r, sigma),
            "theta": cls.theta(S, K, T, r, sigma, option_type),
            "vega": cls.vega(S, K, T, r, sigma),
            "rho": cls.rho(S, K, T, r, sigma, option_type),
        }

    @staticmethod
    def implied_volatility(
        market_price: float,
        S: float, K: float, T: float, r: float,
        option_type: str = "CE",
        max_iterations: int = 100,
        tolerance: float = 1e-6,
    ) -> float:
        """
        Calculate implied volatility using Newton-Raphson method.
        """
        if T <= 0 or market_price <= 0:
            return 0.0

        sigma = 0.3  # Initial guess

        for _ in range(max_iterations):
            price = GreeksCalculator.black_scholes_price(S, K, T, r, sigma, option_type)
            vega = GreeksCalculator.vega(S, K, T, r, sigma) * 100  # Un-normalize

            diff = price - market_price
            if abs(diff) < tolerance:
                return float(sigma)

            if vega == 0:
                break

            sigma -= diff / vega

            # Clamp sigma
            sigma = max(0.01, min(sigma, 5.0))

        return float(sigma)
