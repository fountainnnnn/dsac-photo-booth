@echo off
setlocal

cd /d "%~dp0"

echo Checking for old DSAC Photo Booth processes...
for %%P in (3001 5173) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort %%P -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -ne 0 } | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 goto error
)

echo Starting DSAC Photo Booth frontend and backend...
echo.
echo Frontend: http://localhost:5173
echo Backend:  http://localhost:3001
echo.

call npm run dev

if errorlevel 1 goto error
goto end

:error
echo.
echo DSAC Photo Booth stopped because of an error.
echo Read the message above, then press any key to close this window.
pause >nul

:end
