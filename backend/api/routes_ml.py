"""
Machine Learning API routes for Option Price Prediction.
"""
from fastapi import APIRouter, HTTPException, Query
from typing import Optional, Dict, Any

from backend.ml_engine.inference import MLEnsemblePredictor
from backend.logger import logger

router = APIRouter(prefix="/api/ml", tags=["ml"])

# Global predictor instance
predictor = MLEnsemblePredictor()

@router.get("/status")
async def get_ml_status():
    """Get the status of the ML subsystem."""
    return predictor.get_status()

@router.post("/predict")
async def predict_movement(
    expiry: str = Query(..., description="Expiry folder to predict on"),
    timestamp: str = Query(..., description="Target time (HH:MM or isoformat)"),
    use_unified: bool = Query(True, description="Whether to use unified data format")
):
    """
    Get probability prediction for the next 5-15 minute movement.
    """
    try:
        result = predictor.predict(expiry, timestamp, use_unified)
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return result
    except Exception as e:
        logger.error(f"Prediction failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/train")
async def trigger_training():
    """Trigger a new training run."""
    return {"status": "training_queued"}

@router.get("/historical/{expiry}")
async def get_historical_predictions(expiry: str):
    """
    Get historical prediction comparisons for the given expiry.
    """
    try:
        result = predictor.predict_historical(expiry)
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return result
    except Exception as e:
        logger.error(f"Historical prediction failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
