"""
AI Optimizer API routes — run optimization, get learning history.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from backend.ai_optimizer import AIOptimizer, LearningMemory
from backend.ai_optimizer.optimizer import ParameterSpace
from backend.strategy_engine import Strategy, StrategyLoader

router = APIRouter(prefix="/api/ai", tags=["AI Optimizer"])

ai_optimizer = AIOptimizer()
learning_memory = LearningMemory()
strategy_loader = StrategyLoader()


class OptimizeRequest(BaseModel):
    """Request to run AI optimization."""
    strategy_name: Optional[str] = None
    strategy_config: Optional[dict] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    objective: str = "sharpe"
    max_iterations: int = 20
    initial_capital: float = 1000000.0
    parameters: list[dict] = []


@router.post("/optimize")
async def run_optimization(request: OptimizeRequest):
    """Run AI optimization on a strategy."""
    try:
        if request.strategy_config:
            strategy = Strategy.from_dict(request.strategy_config)
        elif request.strategy_name:
            strategy = strategy_loader.load_strategy(request.strategy_name)
        else:
            raise HTTPException(
                status_code=400,
                detail="Provide either strategy_name or strategy_config",
            )

        # Build parameter spaces
        param_spaces = []
        for p in request.parameters:
            param_spaces.append(ParameterSpace(
                name=p["name"],
                min_val=p["min"],
                max_val=p["max"],
                step=p.get("step", 1.0),
                current_val=p.get("current", p["min"]),
            ))

        # Use defaults if no parameters specified
        if not param_spaces:
            param_spaces = [
                ParameterSpace("stop_loss_pct", 50, 300, 25),
                ParameterSpace("target_profit_pct", 20, 80, 10),
            ]

        result = ai_optimizer.optimize_strategy(
            base_strategy=strategy,
            parameter_spaces=param_spaces,
            start_date=request.start_date,
            end_date=request.end_date,
            objective=request.objective,
            max_iterations=request.max_iterations,
            initial_capital=request.initial_capital,
        )

        return {
            "best_params": result.best_params,
            "best_fitness": result.best_fitness,
            "iterations": result.iterations,
            "convergence": result.convergence,
            "history": result.history[-10:],  # Last 10 iterations
        }

    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/learning-history")
async def get_learning_history(
    strategy_name: Optional[str] = None,
    limit: int = 100,
):
    """Get AI learning history."""
    return {
        "history": learning_memory.get_learning_history(strategy_name, limit),
    }


@router.get("/parameter-changes")
async def get_parameter_changes(strategy_name: Optional[str] = None):
    """Get parameter change history."""
    return {
        "changes": learning_memory.get_parameter_changes(strategy_name),
    }


@router.get("/strategy-evolution")
async def get_strategy_evolution(strategy_name: Optional[str] = None):
    """Get strategy evolution history."""
    return {
        "evolution": learning_memory.get_strategy_evolution(strategy_name),
    }


@router.get("/suggestions/{strategy_name}")
async def get_suggestions(strategy_name: str):
    """Get AI-suggested improvements for a strategy."""
    return learning_memory.get_suggestions(strategy_name)
