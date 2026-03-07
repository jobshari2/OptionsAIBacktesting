"""
Intelligence API routes — endpoints for regime detection, features,
strategy selection, and intelligent backtesting.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from backend.intelligence import (
    FeatureEngine,
    RegimeDetector,
    StrategySelector,
    ExperienceMemory,
    MetaController,
)
from backend.logger import logger

router = APIRouter(prefix="/api/intelligence", tags=["Intelligence Engine"])

# Shared instances
meta_controller = MetaController()
experience_memory = ExperienceMemory()


# --- Request Models ---

class IntelligentBacktestRequest(BaseModel):
    """Request to run an intelligent meta-strategy backtest."""
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    initial_capital: float = 1000000.0
    regime_check_interval: int = 15
    min_confidence: float = 0.6
    switch_cooldown: int = 30


# --- Endpoints ---

@router.get("/features/{expiry}")
async def get_features(expiry: str):
    """
    Compute market features for a specific expiry.

    Returns 10 market features: realized_volatility, atr, vwap_distance,
    trend_strength, momentum, volume_spike, iv_percentile, iv_skew,
    put_call_ratio, oi_change.
    """
    logger.info(f"Computing features for expiry: {expiry}")
    try:
        result = meta_controller.get_regime_for_expiry(expiry)
        return {
            "expiry": expiry,
            "features": result.get("features", {}),
        }
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Expiry data not found: {expiry}")
    except Exception as e:
        logger.error(f"Error computing features: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/regime/{expiry}")
async def get_regime(expiry: str):
    """
    Detect market regime for a specific expiry.

    Returns regime classification, confidence score, recommended strategy,
    and all computed features.
    """
    logger.info(f"Detecting regime for expiry: {expiry}")
    try:
        result = meta_controller.get_regime_for_expiry(expiry)
        return result
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Expiry data not found: {expiry}")
    except Exception as e:
        logger.error(f"Error detecting regime: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/regime-mapping")
async def get_regime_mapping():
    """
    Get the current regime → strategy mapping.

    Shows which strategy will be selected for each detected market regime.
    """
    logger.info("Fetching regime-strategy mapping")
    return {
        "mapping": meta_controller.strategy_selector.get_mapping(),
        "regimes": [
            "RANGE_BOUND", "TREND_UP", "TREND_DOWN",
            "HIGH_VOLATILITY", "LOW_VOLATILITY",
        ],
        "model_trained": meta_controller.regime_detector.is_trained,
    }


@router.post("/run")
async def run_intelligent_backtest(request: IntelligentBacktestRequest):
    """
    Run a full intelligent meta-strategy backtest.

    The engine will:
    1. Detect market regime using ML model (or rules as fallback)
    2. Select the optimal strategy for the detected regime
    3. Re-evaluate regime every N minutes during each expiry
    4. Dynamically switch strategies mid-session when regime changes
    5. Record all results to experience memory for continuous learning

    Returns:
        Complete backtest results including trades, equity curve,
        regime timeline, strategy switches, and performance breakdowns.
    """
    logger.info(
        f"Starting intelligent backtest: {request.start_date} to {request.end_date}, "
        f"interval={request.regime_check_interval}min, confidence={request.min_confidence}"
    )
    try:
        # Update controller settings
        meta_controller.switch_cooldown_minutes = request.switch_cooldown

        result = meta_controller.run_intelligent_backtest(
            start_date=request.start_date,
            end_date=request.end_date,
            initial_capital=request.initial_capital,
            regime_check_interval=request.regime_check_interval,
            min_confidence=request.min_confidence,
        )

        return result.to_dict()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error in intelligent backtest: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/experience")
async def get_experience(
    strategy: Optional[str] = None,
    regime: Optional[str] = None,
    limit: int = 100,
):
    """
    Query experience memory — historical trade results with regime context.
    """
    logger.info(f"Querying experience memory: strategy={strategy}, regime={regime}")
    df = experience_memory.load(strategy=strategy, regime=regime, limit=limit)
    return {
        "total": len(df),
        "records": df.to_dicts() if len(df) > 0 else [],
    }


@router.get("/experience/performance")
async def get_experience_performance(regime: Optional[str] = None):
    """
    Get strategy performance summary from experience memory.

    Shows win rate, average PnL, total trades per strategy,
    optionally filtered by regime.
    """
    logger.info(f"Fetching experience performance: regime={regime}")
    return {
        "performance": experience_memory.get_strategy_performance(regime=regime),
        "summary": experience_memory.get_summary(),
    }


@router.get("/experience/summary")
async def get_experience_summary():
    """Get overall experience memory summary."""
    logger.info("Fetching experience memory summary")
    return experience_memory.get_summary()


@router.post("/train")
async def train_model():
    """
    Manually trigger ML model training from experience memory.

    The model learns which regimes lead to which strategy outcomes,
    improving future regime detection accuracy.
    """
    logger.info("Manual training request for regime detection model")
    try:
        summary = meta_controller.train_model()
        return summary
    except Exception as e:
        logger.error(f"Error training model: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/model-status")
async def get_model_status():
    """Check the status of the regime detection ML model."""
    logger.info("Checking model status")
    return {
        "is_trained": meta_controller.regime_detector.is_trained,
        "feature_importance": meta_controller.regime_detector.get_feature_importance(),
    }
