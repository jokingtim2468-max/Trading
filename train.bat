@echo off
rem Re-train the Day Range Predictor on the latest Yahoo Finance data.
cd /d "%~dp0"
py -m pip install --quiet -r tools\requirements.txt
py tools\train_drp.py
echo.
echo Done. Recompile experts\DayRangePredictor.mq5 in MetaEditor and re-paste pine\DayRangePredictor.pine into TradingView.
pause
