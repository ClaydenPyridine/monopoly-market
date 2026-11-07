@echo off
cd /d "%~dp0"
title DiChanGuShen - LAN Server

where node >nul 2>nul
if errorlevel 1 goto NONODE

echo.
echo   Starting server ... browser will open in 3 seconds.
echo   THIS BLACK WINDOW IS THE SERVER - DO NOT CLOSE IT WHILE PLAYING.
echo.

start "" cmd /c "timeout /t 3 /nobreak >nul & rundll32 url.dll,FileProtocolHandler http://127.0.0.1:8787/"

node server.mjs 8787

echo.
echo   ------------------------------------------------------------
echo   Server stopped. Run this file again to host another game.
echo   ------------------------------------------------------------
pause
exit /b 0

:NONODE
echo.
echo   ============================================================
echo    Node.js is NOT installed.
echo    Opening the download page for you ...
echo.
echo    Install the LTS version, then double-click this file again.
echo    (Only the HOST needs Node.js. Your friends do not.)
echo   ============================================================
echo.
start "" "https://nodejs.org/en/download"
pause
exit /b 1
