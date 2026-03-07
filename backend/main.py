"""
FastAPI application entry point — Nifty Options Backtesting Platform.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "backend.main:app",
        host=config.host,
        port=config.port,
        reload=True,
    )
