@echo off
cd /d "%~dp0"
title DiChanGuShen - Restore Saved Game

where node >nul 2>nul
if errorlevel 1 goto NONODE

if not exist "saves\EW85-ai-takeover.json" goto NOSAVE

echo.
echo   ============================================================
echo    Restoring the saved game (room EW85, seat "Pygg" to AI)
echo.
echo    BEFORE running this, CLOSE the old server window first.
echo    Otherwise you will get "port 8787 already in use".
echo.
echo    The cloudflared tunnel window can stay open - the link
echo    does not change, so your friends just refresh the page.
echo   ============================================================
echo.
echo   Press any key to start, or close this window to cancel.
pause >nul

node server.mjs 8787 --restore "saves\EW85-ai-takeover.json"

echo.
echo   ------------------------------------------------------------
echo   Server stopped.
echo   ------------------------------------------------------------
pause
exit /b 0

:NOSAVE
echo.
echo   ============================================================
echo    Save file not found:  saves\EW85-ai-takeover.json
echo.
echo    Available saves in the saves folder:
echo   ============================================================
dir /b "saves\*.json" 2>nul
echo.
pause
exit /b 1

:NONODE
echo.
echo   Node.js is NOT installed. Opening the download page ...
start "" "https://nodejs.org/en/download"
pause
exit /b 1
