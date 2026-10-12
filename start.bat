@echo off
setlocal
title Billify - Fish Brokerage ERP
cd /d "%~dp0"

echo ===================================================
echo        Billify - Fish Commission Brokerage ERP     
echo ===================================================
echo.

:: 1. Find Node.js (Portable in bin\ or System PATH)
set "NODE_CMD="
if exist "%~dp0bin\node.exe" (
    set "NODE_CMD=%~dp0bin\node.exe"
    echo [INFO] Using portable Node.js runtime from bin\
) else (
    where node >nul 2>&1
    if %errorlevel% equ 0 (
        set "NODE_CMD=node"
    )
)

if "%NODE_CMD%"=="" (
    echo [ERROR] Node.js is not found on this computer.
    echo.
    echo To run without installing anything:
    echo Keep the 'bin\node.exe' file inside this project folder.
    echo.
    echo Or install Node.js from https://nodejs.org and try again.
    echo.
    pause
    exit /b 1
)

:: 2. Check if dependencies are installed
if not exist "node_modules\" (
    if not exist "backend\node_modules\" (
        echo [INFO] Dependencies not found. Installing packages...
        call npm install
        if %errorlevel% neq 0 (
            echo [ERROR] Failed to install dependencies.
            pause
            exit /b 1
        )
        echo.
    )
)

echo Starting Billify Unified Server...
echo App URL: http://127.0.0.1:8000
echo.

:: 3. Launch browser in background after 2 seconds
start "" cmd /c "ping 127.0.0.1 -n 3 >nul & start http://127.0.0.1:8000"

:: 4. Run server in this window
"%NODE_CMD%" backend/server.js

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Server stopped with exit code %errorlevel%.
    pause
)
