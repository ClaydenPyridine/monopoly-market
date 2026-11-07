@echo off
cd /d "%~dp0"
title DiChanGuShen - Cloudflare Tunnel

where node >nul 2>nul
if errorlevel 1 goto NONODE
if not exist "cloudflared.exe" goto NOCF

echo.
echo   [1/3] Starting game server in a new window ...
start "DiChanGuShen Server" cmd /k "node server.mjs 8787"
timeout /t 3 /nobreak >nul

echo   [2/3] Opening the game in your browser ...
start "" cmd /c "timeout /t 2 /nobreak >nul & rundll32 url.dll,FileProtocolHandler http://127.0.0.1:8787/"
timeout /t 3 /nobreak >nul

echo   [3/3] Creating public tunnel, please wait 10-20 seconds ...
echo.

node tools\tunnel.mjs 8787

echo.
echo   Tunnel closed. Press any key to exit.
pause
exit /b 0

:NOCF
echo.
echo   ============================================================
echo    cloudflared.exe not found in this folder.
echo    Opening the download page ...
echo.
echo    Save it into THIS folder (keep the name cloudflared.exe),
echo    then double-click this file again.
echo   ============================================================
echo.
start "" "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
pause
exit /b 1

:NONODE
echo.
echo   ============================================================
echo    Node.js is NOT installed.
echo    Opening the download page for you ...
echo.
echo    Install the LTS version, then double-click this file again.
echo   ============================================================
echo.
start "" "https://nodejs.org/en/download"
pause
exit /b 1
