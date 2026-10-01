@echo off
cd /d "%~dp0"

:: Check if Node.js is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org and try again.
    pause
    exit /b 1
)

:: Check if dependencies are installed
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo ERROR: Failed to install dependencies.
        pause
        exit /b 1
    )
)

echo Starting Billify Unified Server...
echo.

:: Start server in a new window
start "Billify Unified Server" cmd /k "node server.js"

:: Wait a moment for the server to start, then open browser
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8000"

echo Billify is running at http://127.0.0.1:8000
echo Close the "Billify Unified Server" window to stop the server.
