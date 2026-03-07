"""
Strategy API routes — CRUD operations for strategies.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from backend.strategy_engine import Strategy, StrategyLoader
from backend.logger import logger

router = APIRouter(prefix="/api/strategies", tags=["Strategies"])

strategy_loader = StrategyLoader()


class StrategyCreate(BaseModel):
    """Request model for creating a strategy."""
    name: str
    description: str = ""
    lot_size: int = 25
    max_positions: int = 1
    tags: list[str] = []
    legs: list[dict] = []
    entry: dict = {}
    exit: dict = {}


@router.get("/")
async def list_strategies():
    """List all available strategies."""
    logger.info("Listing all strategies")
    return {"strategies": strategy_loader.list_strategies()}


@router.get("/templates")
async def get_templates():
    """Get built-in strategy templates."""
    templates = [
        {
            "name": "short_straddle",
            "description": "Sell ATM Call + ATM Put",
            "type": "neutral",
            "risk": "unlimited",
        },
        {
            "name": "long_straddle",
            "description": "Buy ATM Call + ATM Put",
            "type": "volatile",
            "risk": "limited",
        },
        {
            "name": "short_strangle",
            "description": "Sell OTM Call + OTM Put",
            "type": "neutral",
            "risk": "unlimited",
        },
        {
            "name": "iron_condor",
            "description": "Sell OTM Call/Put + Buy further OTM Call/Put",
            "type": "neutral",
            "risk": "limited",
        },
        {
            "name": "iron_butterfly",
            "description": "Sell ATM Straddle + Buy OTM Strangle",
            "type": "neutral",
            "risk": "limited",
        },
        {
            "name": "bull_call_spread",
            "description": "Buy lower strike CE + Sell higher strike CE",
            "type": "bullish",
            "risk": "limited",
        },
        {
            "name": "bear_put_spread",
            "description": "Buy higher strike PE + Sell lower strike PE",
            "type": "bearish",
            "risk": "limited",
        },
        {
            "name": "ratio_spread",
            "description": "Buy 1 ATM, Sell 2 OTM",
            "type": "neutral",
            "risk": "unlimited",
        },
    ]
    return {"templates": templates}


@router.get("/{name}")
async def get_strategy(name: str):
    """Get a specific strategy by name."""
    logger.info(f"Fetching strategy '{name}'")
    try:
        strategy = strategy_loader.load_strategy(name)
        return {"strategy": strategy.to_dict()}
    except FileNotFoundError:
        logger.warning(f"Strategy '{name}' not found")
        raise HTTPException(status_code=404, detail=f"Strategy '{name}' not found")
    except Exception as e:
        logger.error(f"Error fetching strategy '{name}': {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/")
async def create_strategy(data: StrategyCreate):
    """Create or update a strategy."""
    logger.info(f"Creating strategy '{data.name}'")
    try:
        strategy = Strategy.from_dict(data.model_dump())
        path = strategy_loader.save_strategy(strategy)
        logger.info(f"Strategy '{strategy.name}' saved to {path}")
        return {
            "message": f"Strategy '{strategy.name}' saved",
            "path": str(path),
            "strategy": strategy.to_dict(),
        }
    except Exception as e:
        logger.error(f"Error creating strategy: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{name}")
async def update_strategy(name: str, data: StrategyCreate):
    """Update an existing strategy."""
    logger.info(f"Updating strategy '{name}'")
    try:
        data_dict = data.model_dump()
        data_dict["name"] = name
        strategy = Strategy.from_dict(data_dict)
        path = strategy_loader.save_strategy(strategy)
        logger.info(f"Strategy '{name}' updated at {path}")
        return {
            "message": f"Strategy '{name}' updated",
            "strategy": strategy.to_dict(),
        }
    except Exception as e:
        logger.error(f"Error updating strategy '{name}': {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{name}")
async def delete_strategy(name: str):
    """Delete a strategy."""
    logger.info(f"Deleting strategy '{name}'")
    if strategy_loader.delete_strategy(name):
        logger.info(f"Strategy '{name}' deleted successfully")
        return {"message": f"Strategy '{name}' deleted"}
    logger.warning(f"Could not delete strategy '{name}' as it was not found")
    raise HTTPException(status_code=404, detail=f"Strategy '{name}' not found")
