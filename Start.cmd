@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel% equ 0 (
  py -3 serve.py --open-browser
) else (
  python serve.py --open-browser
)
if errorlevel 1 pause
