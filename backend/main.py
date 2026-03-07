"""
FastAPI application entry point — Nifty Options Backtesting Platform.
"""
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import time

from backend.logger import logger

from backend.api.routes_data import router as data_router
from backend.api.routes_strategy import router as strategy_router
from backend.api.routes_backtest import router as backtest_router
from backend.api.routes_analytics import router as analytics_router
from backend.api.routes_ai import router as ai_router
from backend.config import config

app = FastAPI(
    title="Nifty Options Backtesting Platform",
    description="AI-powered options strategy backtesting and research platform",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS — allow frontend dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(data_router)
app.include_router(strategy_router)
app.include_router(backtest_router)
app.include_router(analytics_router)
app.include_router(ai_router)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start_time = time.time()
    logger.info(f"Incoming request: {request.method} {request.url.path}")
    response = await call_next(request)
    process_time = time.time() - start_time
    logger.info(f"Completed request: {request.method} {request.url.path} with status {response.status_code} in {process_time:.4f}s")
    return response


@app.get("/")
async def root():
    """Health check and API info."""
    return {
        "name": "Nifty Options Backtesting Platform",
        "version": "1.0.0",
        "status": "running",
        "docs": "/docs",
        "endpoints": {
            "data": "/api/data",
            "strategies": "/api/strategies",
            "backtest": "/api/backtest",
            "analytics": "/api/analytics",
            "ai": "/api/ai",
        },
    }


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    logger.info("Health check endpoint called")
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "backend.main:app",
        host=config.host,
        port=config.port,
        reload=True,
    )
