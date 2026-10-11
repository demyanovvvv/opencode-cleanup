@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.16 or newer is required. Install Node.js and try again.
  pause
  exit /b 1
)
node "%~dp0scripts\setup.mjs" uninstall %*
set "result=%errorlevel%"
if /i not "%~1"=="--no-pause" pause
exit /b %result%
