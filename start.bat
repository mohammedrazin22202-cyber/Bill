@echo off
setlocal
title Billify - Fish Brokerage ERP
cd /d "%~dp0"

echo ===================================================
echo        Billify - Fish Commission Brokerage ERP     
echo ===================================================
echo.

:: 1. Check if Node.js is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed or not found in PATH.
    echo Please install Node.js from https://nodejs.org and try again.
    echo.
    pause
    exit /b 1
)

:: 2. Check if dependencies are installed in backend
if not exist "backend\node_modules\" (
    echo [INFO] Dependencies not found. Installing backend packages...
    cd /d "%~dp0backend"
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install dependencies.
        cd /d "%~dp0"
        pause
        exit /b 1
    )
    cd /d "%~dp0"
    echo.
)

echo Starting Billify Unified Server...
echo App URL: http://127.0.0.1:8000
echo.

:: 3. Launch browser in background after 2 seconds
start "" cmd /c "ping 127.0.0.1 -n 3 >nul & start http://127.0.0.1:8000"

:: 4. Run server in this window
cd /d "%~dp0backend"
node server.js

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Server stopped with exit code %errorlevel%.
    pause
)
