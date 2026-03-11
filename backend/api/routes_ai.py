"""
AI Optimizer API routes — run optimization, get learning history.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import os
import google.generativeai as genai
from dotenv import load_dotenv

# Robust .env loading
# 1. Try backend/.env (relative to this file)
backend_env = os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env')
# 2. Try root/.env (relative to this file)
root_env = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), '.env')

if os.path.exists(backend_env):
    load_dotenv(dotenv_path=backend_env)
elif os.path.exists(root_env):
    load_dotenv(dotenv_path=root_env)
else:
    load_dotenv() # Fallback to default behavior

tmp_key = os.environ.get("GEMINI_API_KEY")
if tmp_key:
    print(f"DEBUG: Found GEMINI_API_KEY starting with {tmp_key[:4]}...")
else:
    print("DEBUG: GEMINI_API_KEY NOT FOUND in environment")

from backend.ai_optimizer import AIOptimizer, LearningMemory
from backend.ai_optimizer.optimizer import ParameterSpace
from backend.strategy_engine import Strategy, StrategyLoader
from backend.logger import logger

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

class AnalyzeChainRequest(BaseModel):
    """Request to analyze an option chain using Gemini."""
    expiry: str
    spot_price: float
    futures_price: float
    option_chain: List[Dict[str, Any]]
    spikes: List[Dict[str, Any]]
    timestamp: Optional[str] = None
    model_name: Optional[str] = "gemini-1.5-flash"




@router.post("/optimize")
async def run_optimization(request: OptimizeRequest):
    """Run AI optimization on a strategy."""
    logger.info(f"Received request to run AI optimization for strategy {request.strategy_name or 'custom backend'}")
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
        logger.warning(f"File not found during optimization request: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error running optimization: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/analyze-chain")
async def analyze_option_chain(request: AnalyzeChainRequest):
    """Analyze option chain using Gemini Flash."""
    logger.info(f"Received request to analyze option chain for expiry {request.expiry}")
    
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=400, 
            detail="GEMINI_API_KEY is not set in the environment or backend/.env file. Please add it to use the AI Bot."
        )

    try:
        genai.configure(api_key=api_key)
        # Using specified model or fallback to 1.5 flash
        selected_model = request.model_name or 'gemini-1.5-flash'
        model = genai.GenerativeModel(selected_model)
        
        prompt = f"""
You are an expert quantitative derivatives trader analyzing the Nifty option chain.
Provide a clear, formatted market structure assessment, predict the most probable next move, and output expert trading insights.

Market Data Snapshot:
- Expiry: {request.expiry}
- Spot Price: {request.spot_price}
- Futures Price: {request.futures_price}
- Data Timestamp: {request.timestamp or 'Latest Available'}

Recent Market Anomalies/Spikes (OI and Volume):
{str(request.spikes[:50])}  # Showing top recent anomalies

Option Chain Summary (Selected Strikes):
{str(request.option_chain)}

Please provide your analysis in Markdown format:
1. Market Stance (Bullish, Bearish, or Neutral) and rationale.
2. Key Levels (Support/Resistance based on OI, Max Pain indication).
3. Volume & OI Anomaly Analysis (What is smart money doing?).
4. Probability & Next Move Prediction (Clear percentage and target direction).
"""
        response = model.generate_content(prompt)
        return {"analysis": response.text}
        
    except Exception as e:
        logger.error(f"Error generating AI analysis: {e}")
        raise HTTPException(status_code=500, detail=f"AI generation failed: {str(e)}")


@router.get("/models")
async def list_gemini_models():
    """List available Gemini models that support content generation."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return {"models": []}
        
    try:
        genai.configure(api_key=api_key)
        models = []
        for m in genai.list_models():
            if 'generateContent' in m.supported_generation_methods:
                # Remove 'models/' prefix for cleaner names
                name = m.name.replace('models/', '')
                models.append({
                    "name": name,
                    "display_name": m.display_name,
                    "description": m.description
                })
        return {"models": models}
    except Exception as e:
        logger.error(f"Error listing Gemini models: {e}")
        return {"models": [], "error": str(e)}


@router.get("/learning-history")
async def get_learning_history(
    strategy_name: Optional[str] = None,
    limit: int = 100,
):
    """Get AI learning history."""
    logger.info(f"Fetching learning history for strategy: {strategy_name}")
    return {
        "history": learning_memory.get_learning_history(strategy_name, limit),
    }


@router.get("/parameter-changes")
async def get_parameter_changes(strategy_name: Optional[str] = None):
    """Get parameter change history."""
    logger.info(f"Fetching parameter change history for strategy: {strategy_name}")
    return {
        "changes": learning_memory.get_parameter_changes(strategy_name),
    }


@router.get("/strategy-evolution")
async def get_strategy_evolution(strategy_name: Optional[str] = None):
    """Get strategy evolution history."""
    logger.info(f"Fetching strategy evolution history for strategy: {strategy_name}")
    return {
        "evolution": learning_memory.get_strategy_evolution(strategy_name),
    }


@router.get("/suggestions/{strategy_name}")
async def get_suggestions(strategy_name: str):
    """Get AI-suggested improvements for a strategy."""
    logger.info(f"Fetching AI suggestions for strategy: {strategy_name}")
    return learning_memory.get_suggestions(strategy_name)
