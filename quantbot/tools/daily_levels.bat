@echo off
rem Today's model high / low -> Pine indicator on the clipboard (QuantBot must be open)
cd /d "%~dp0"
python daily_levels.py %*
pause
