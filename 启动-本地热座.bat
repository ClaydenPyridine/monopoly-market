@echo off
cd /d "%~dp0"
title DiChanGuShen - Local Hotseat

for %%f in ("dist\*.html") do (
  start "" "%%~ff"
  exit /b 0
)
for %%f in ("index.html") do (
  start "" "%%~ff"
  exit /b 0
)

echo.
echo   Game file not found.
echo   Please keep this file inside the game folder.
echo.
pause
exit /b 1
