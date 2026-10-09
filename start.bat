@echo off
REM One-click launcher (Windows): starts the MT5 bridge and the chart app.
cd /d "%~dp0"
if not exist node_modules call npm install
pip show MetaTrader5 >nul 2>&1 || pip install -r bridge\requirements.txt
start "MT5 Bridge" cmd /k python bridge\mt5_bridge.py
start "" http://localhost:5173
npm run dev
