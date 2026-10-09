@echo off
rem Start the Day Range Predictor AI service (quick-trade TP/SL with local Llama news scoring).
cd /d "%~dp0"
where ollama >nul 2>nul
if errorlevel 1 (
  echo Ollama isn't installed. Get it from https://ollama.com/download then run this again.
  echo The service still runs without it, using price only.
) else (
  ollama pull llama3.1:8b
)
py -m pip install --quiet -r tools\requirements.txt
py ai\service.py
pause
