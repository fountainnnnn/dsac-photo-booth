@echo off
setlocal
title DSAC Photo Booth

cd /d "%~dp0"

echo.
echo   ============================================
echo     DSAC Photo Booth
echo   ============================================
echo.

REM Node 20.19+ is required (Vite 8). Fail loudly rather than mid-build.
where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js is not installed.
  echo   Install the LTS build from https://nodejs.org and run this again.
  goto error
)

REM A leftover process from a previous run would hold the port and the camera.
echo   Clearing any previous session...
for %%P in (3001 5173) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort %%P -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"
)

if not exist node_modules (
  echo   Installing dependencies. This happens once and takes a few minutes...
  call npm install
  if errorlevel 1 goto error
)

REM The booth is served from the production build, so the kiosk, the phone
REM remote and the guests' download pages all share one origin and one tunnel.
echo   Building the booth...
call npm run build
if errorlevel 1 goto error

echo.
echo   Starting. A public link appears below once the tunnel is up.
echo   Leave this window open for as long as the booth is running.
echo.

call npm start
if errorlevel 1 goto error
goto end

:error
echo.
echo   The booth stopped because of an error.
echo   Read the message above, then press any key to close this window.
echo.
pause >nul

:end
endlocal
