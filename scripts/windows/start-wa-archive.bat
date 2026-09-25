@echo off
REM ===============================================================
REM  WA Archive launcher (Windows)
REM  Starts the local archive server. Open http://localhost:8787
REM ===============================================================
setlocal
cd /d "%~dp0\..\.."

REM --- optional local secrets (gitignored). Copy wa-archive.env.example to
REM     scripts\windows\wa-archive.env and set WA_ADMIN_PASSWORD etc.
if exist "scripts\windows\wa-archive.env" (
  for /f "usebackq tokens=1* delims==" %%A in ("scripts\windows\wa-archive.env") do set "%%A=%%B"
)

where node >nul 2>nul
if errorlevel 1 (
  echo [WA Archive] Node.js is not installed. Get it from https://nodejs.org  ^(v20+^)
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [WA Archive] Installing dependencies ^(first run^)...
  call npm install
)
if not exist "apps\desktop\out\web\index.html" (
  echo [WA Archive] Building the web UI ^(first run^)...
  call npm run build:web
)

if "%HOST%"=="" set HOST=0.0.0.0
if "%PORT%"=="" set PORT=8787

echo [WA Archive] Starting on http://localhost:%PORT%  ^(LAN: http://^<your-ip^>:%PORT%^)
call npm run dev:server
