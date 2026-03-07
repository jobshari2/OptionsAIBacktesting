@echo off
echo =======================================================
echo     Nifty Options AI Backtesting Platform Setup
echo =======================================================

echo.
echo [1/4] Installing Python Backend Dependencies...
pip install -r requirements.txt

echo.
echo [2/4] Installing Node.js Frontend Dependencies...
cd frontend
call npm install
cd ..

echo.
echo [3/4] Starting Backend Server (FastAPI)...
start cmd /k "title NiftyQuant Backend && python -m uvicorn backend.main:app --reload --port 8000"

echo.
echo [4/4] Starting Frontend Server (Vite React)...
start cmd /k "title NiftyQuant Frontend && cd frontend && npm run dev"

echo.
echo =======================================================
echo   Platform starting up! 
echo   - Backend will be at:  http://localhost:8000
echo   - Frontend will be at: http://localhost:5173
echo =======================================================
echo.
pause
