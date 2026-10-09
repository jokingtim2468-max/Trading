@echo off
REM MT5 Charts launcher: auto-updates, then starts the MT5 bridge and the app.
cd /d "%~dp0"
echo Checking for updates...
git pull --ff-only || echo Update skipped (offline or local changes).
call npm install --no-audit --no-fund --silent
python -m pip install -q -r bridge\requirements.txt
start "MT5 Bridge" /min cmd /k python bridge\mt5_bridge.py
start "" http://localhost:5173
npm run dev
