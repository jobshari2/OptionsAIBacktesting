"""
Strategy Selection Engine — maps market regimes to optimal option strategies
using the existing strategy library (YAML files) and strategy loader.
"""
from typing import Optional
from backend.strategy_engine import Strategy, StrategyLoader
from backend.logger import logger
from .regime_detector import MarketRegime


# Default regime → strategy mapping for Nifty Options
DEFAULT_REGIME_MAPPING: dict[str, str] = {
    MarketRegime.RANGE_BOUND: "iron_condor",
    MarketRegime.TREND_UP: "bull_call_spread",
    MarketRegime.TREND_DOWN: "bear_put_spread",
    MarketRegime.HIGH_VOLATILITY: "long_straddle",
    MarketRegime.LOW_VOLATILITY: "short_strangle",
}


class StrategySelector:
    """
    Selects the optimal options strategy based on detected market regime.

    Uses the existing StrategyLoader to load YAML-defined strategies.
    Supports custom regime → strategy mappings and experience-based overrides.
    """

    def __init__(
        self,
        custom_mapping: Optional[dict[str, str]] = None,
        strategy_loader: Optional[StrategyLoader] = None,
    ):
        self.mapping = custom_mapping or DEFAULT_REGIME_MAPPING.copy()
        self.loader = strategy_loader or StrategyLoader()
        self._strategy_cache: dict[str, Strategy] = {}

    def select(self, regime: str) -> Strategy:
        """
        Select strategy for the given regime.

        Args:
            regime: Market regime string (from MarketRegime)

        Returns:
            Loaded Strategy object

        Raises:
            ValueError: If no strategy mapped for the regime
        """
        strategy_name = self.mapping.get(regime)
        if not strategy_name:
            logger.warning(
                f"StrategySelector: no mapping for regime '{regime}', "
                "falling back to iron_condor"
            )
            strategy_name = "iron_condor"

        # Use cache to avoid repeated YAML loading
        if strategy_name not in self._strategy_cache:
            try:
                strategy = self.loader.load_strategy(strategy_name)
                self._strategy_cache[strategy_name] = strategy
                logger.info(f"StrategySelector: loaded strategy '{strategy_name}' for regime '{regime}'")
            except FileNotFoundError:
                logger.error(f"Strategy file not found: {strategy_name}")
                raise ValueError(f"Strategy '{strategy_name}' not found in strategies directory")

        return self._strategy_cache[strategy_name]

    def get_mapping(self) -> dict[str, str]:
        """Get the current regime → strategy mapping."""
        return self.mapping.copy()

    def update_mapping(self, regime: str, strategy_name: str) -> None:
        """
        Update the mapping for a specific regime.

        Args:
            regime: Market regime string
            strategy_name: Name of strategy YAML file (without .yaml extension)
        """
        self.mapping[regime] = strategy_name
        # Clear cache for this strategy if it was cached
        if strategy_name in self._strategy_cache:
            del self._strategy_cache[strategy_name]
        logger.info(f"StrategySelector: updated mapping {regime} → {strategy_name}")

    def get_all_strategies(self) -> dict[str, Strategy]:
        """Load and return all mapped strategies."""
        strategies = {}
        for regime, strategy_name in self.mapping.items():
            try:
                strategies[regime] = self.select(regime)
            except ValueError:
                logger.warning(f"Could not load strategy for regime {regime}")
        return strategies

    def clear_cache(self) -> None:
        """Clear the strategy cache."""
        self._strategy_cache.clear()
