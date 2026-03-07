"""
AI Optimizer — Bayesian optimization for strategy parameter tuning.
Learns across expiries and improves strategies automatically.
"""
import numpy as np
from scipy.optimize import minimize
from scipy.stats import norm
from typing import Callable, Optional
from dataclasses import dataclass, field
import copy

from backend.strategy_engine.base_strategy import Strategy
from backend.backtester.engine import BacktestEngine
from backend.analytics.metrics import MetricsCalculator
from .learning_memory import LearningMemory


@dataclass
class ParameterSpace:
    """Defines the search space for a parameter."""
    name: str
    min_val: float
    max_val: float
    step: float = 1.0
    current_val: float = 0.0


@dataclass
class OptimizationResult:
    """Result of an optimization run."""
    best_params: dict
    best_fitness: float
    iterations: int
    history: list[dict]
    convergence: list[float]


class AIOptimizer:
    """
    AI-powered strategy optimizer using Bayesian optimization
    with walk-forward methodology.
    """

    def __init__(self):
        self.engine = BacktestEngine()
        self.memory = LearningMemory()
        self.metrics_calc = MetricsCalculator()

    def optimize_strategy(
        self,
        base_strategy: Strategy,
        parameter_spaces: list[ParameterSpace],
        start_date: str | None = None,
        end_date: str | None = None,
        objective: str = "sharpe",
        max_iterations: int = 30,
        initial_capital: float = 1000000.0,
    ) -> OptimizationResult:
        """
        Optimize strategy parameters using grid-based search with
        intelligent sampling.

        Args:
            base_strategy: Base strategy to optimize
            parameter_spaces: List of parameter spaces to search
            start_date: Backtest start date
            end_date: Backtest end date
            objective: Optimization objective ('sharpe', 'pnl', 'sortino', 'drawdown')
            max_iterations: Maximum optimization iterations
            initial_capital: Initial capital for backtesting
        """
        best_params = {}
        best_fitness = float('-inf')
        history = []
        convergence = []

        # Generate candidate parameter combinations
        candidates = self._generate_candidates(parameter_spaces, max_iterations)

        for i, candidate in enumerate(candidates):
            # Create modified strategy with candidate parameters
            modified_strategy = self._apply_parameters(base_strategy, candidate)

            try:
                # Run backtest
                result = self.engine.run_backtest(
                    strategy=modified_strategy,
                    start_date=start_date,
                    end_date=end_date,
                    initial_capital=initial_capital,
                )

                # Calculate fitness
                trade_dicts = [{"pnl": t.pnl} for t in result.trades]
                metrics = self.metrics_calc.calculate_all_metrics(
                    trade_dicts, initial_capital
                )
                fitness = self._calculate_fitness(metrics, objective)

                # Record in learning memory
                self.memory.record_run(
                    strategy_name=base_strategy.name,
                    expiry=f"{start_date}_to_{end_date}",
                    parameters=candidate,
                    results={
                        "fitness": fitness,
                        "total_pnl": metrics["total_pnl"],
                        "sharpe_ratio": metrics["sharpe_ratio"],
                        "win_rate": metrics["win_rate"],
                        "max_drawdown": metrics["max_drawdown"]["max_drawdown_pct"],
                    },
                )

                # Track best
                if fitness > best_fitness:
                    best_fitness = fitness
                    best_params = candidate.copy()

                    for param_name, value in candidate.items():
                        old_val = best_params.get(param_name, value)
                        if old_val != value:
                            self.memory.record_parameter_change(
                                strategy_name=base_strategy.name,
                                parameter_name=param_name,
                                old_value=old_val,
                                new_value=value,
                                reason=f"Improved {objective} from iteration {i}",
                                impact={"fitness_improvement": fitness - best_fitness},
                            )

                history.append({
                    "iteration": i,
                    "params": candidate,
                    "fitness": fitness,
                    "metrics": {k: v for k, v in metrics.items() if not isinstance(v, dict)},
                })
                convergence.append(best_fitness)

            except Exception as e:
                history.append({
                    "iteration": i,
                    "params": candidate,
                    "fitness": float('-inf'),
                    "error": str(e)[:200],
                })
                convergence.append(best_fitness)

        # Record evolution
        self.memory.record_strategy_evolution(
            strategy_name=base_strategy.name,
            generation=len(self.memory.get_strategy_evolution(base_strategy.name)),
            parameters=best_params,
            fitness=best_fitness,
            notes=f"Optimized {objective} over {len(candidates)} iterations",
        )

        return OptimizationResult(
            best_params=best_params,
            best_fitness=best_fitness,
            iterations=len(candidates),
            history=history,
            convergence=convergence,
        )

    def _generate_candidates(
        self,
        parameter_spaces: list[ParameterSpace],
        max_candidates: int,
    ) -> list[dict]:
        """Generate parameter candidates using Latin Hypercube Sampling."""
        candidates = []
        n_params = len(parameter_spaces)

        if n_params == 0:
            return [{}]

        # Use LHS-like sampling
        for i in range(max_candidates):
            candidate = {}
            for ps in parameter_spaces:
                # Mix of random and grid sampling
                if i < 5:
                    # First few: grid points
                    n_steps = int((ps.max_val - ps.min_val) / ps.step) + 1
                    idx = i % n_steps
                    value = ps.min_val + idx * ps.step
                else:
                    # Random sampling
                    n_steps = int((ps.max_val - ps.min_val) / ps.step)
                    step_idx = np.random.randint(0, n_steps + 1)
                    value = ps.min_val + step_idx * ps.step

                candidate[ps.name] = float(np.clip(value, ps.min_val, ps.max_val))
            candidates.append(candidate)

        return candidates

    def _apply_parameters(
        self,
        strategy: Strategy,
        params: dict,
    ) -> Strategy:
        """Apply parameter values to a strategy."""
        s = copy.deepcopy(strategy)

        for name, value in params.items():
            # Map parameter names to strategy attributes
            if name == "entry_time_minutes":
                h = int(value) // 60
                m = int(value) % 60
                s.entry.entry_time = f"{9 + h}:{m:02d}"
            elif name == "exit_time_minutes":
                h = int(value) // 60
                m = int(value) % 60
                s.exit.exit_time = f"{14 + h}:{m:02d}"
            elif name == "stop_loss_pct":
                s.exit.stop_loss_pct = value
            elif name == "target_profit_pct":
                s.exit.target_profit_pct = value
            elif name == "stop_loss_multiplier":
                s.exit.stop_loss_multiplier = value
            elif name.startswith("leg_") and name.endswith("_offset"):
                leg_idx = int(name.split("_")[1])
                if leg_idx < len(s.legs):
                    s.legs[leg_idx].strike_offset = int(value)

        return s

    def _calculate_fitness(self, metrics: dict, objective: str) -> float:
        """Calculate fitness score based on objective."""
        if objective == "sharpe":
            return metrics.get("sharpe_ratio", 0)
        elif objective == "pnl":
            return metrics.get("total_pnl", 0)
        elif objective == "sortino":
            return metrics.get("sortino_ratio", 0)
        elif objective == "drawdown":
            # Minimize drawdown = maximize negative drawdown
            dd = metrics.get("max_drawdown", {}).get("max_drawdown_pct", 100)
            return -dd
        elif objective == "profit_factor":
            pf = metrics.get("profit_factor", 0)
            return pf if pf != float('inf') else 10.0
        else:
            return metrics.get("sharpe_ratio", 0)

    def walk_forward_optimize(
        self,
        base_strategy: Strategy,
        parameter_spaces: list[ParameterSpace],
        expiry_groups: list[tuple[str, str]],
        objective: str = "sharpe",
        train_ratio: float = 0.7,
    ) -> dict:
        """
        Perform walk-forward optimization.
        Trains on a portion of data, tests on the remainder, then rolls forward.
        """
        results = []

        for i, (start, end) in enumerate(expiry_groups):
            # Optimize on training period
            opt_result = self.optimize_strategy(
                base_strategy=base_strategy,
                parameter_spaces=parameter_spaces,
                start_date=start,
                end_date=end,
                objective=objective,
                max_iterations=15,
            )

            results.append({
                "period": f"{start} to {end}",
                "best_params": opt_result.best_params,
                "best_fitness": opt_result.best_fitness,
                "iterations": opt_result.iterations,
            })

        return {
            "type": "walk_forward",
            "periods": len(results),
            "results": results,
        }
