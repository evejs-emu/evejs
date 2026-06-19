@echo off
title EvEJS Client Setup Wizard
if not exist "%~dp0scripts\EvEJSConfig.bat" (
    if exist "%~dp0scripts\EvEJSConfig.example.bat" (
        copy /y "%~dp0scripts\EvEJSConfig.example.bat" "%~dp0scripts\EvEJSConfig.bat" >nul
    )
)
echo Starting EvEJS Client Setup Wizard...
powershell -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0ClientSetup.ps1"
if errorlevel 1 (
    echo.
    echo Something went wrong. If you see permission errors, try right-clicking
    echo Setup.bat and choosing "Run as Administrator".
    pause
)
