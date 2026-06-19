@echo off
title EVE Client Code Grabber
chcp 65001 >nul 2>&1

REM EVE Client Code Grabber
REM Extracts and decompiles Python code from the EVE client

REM Enable ANSI colour support
reg add HKCU\Console /v VirtualTerminalLevel /t REG_DWORD /d 1 /f >nul 2>&1

REM Use the Python on PATH (or override below)
set PYTHON=python

REM Check Python is available
%PYTHON% --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo   [ERROR] Python not found on PATH.
    echo   Install Python 3.x and ensure it is on your PATH.
    echo.
    pause
    exit /b 1
)

REM Check uncompyle6 is installed
%PYTHON% -c "import uncompyle6" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo   [WARN] uncompyle6 not found. Installing...
    pip install uncompyle6
    echo.
)

REM Launch GUI (pass --cli to use the terminal version instead)
if "%1"=="--cli" (
    %PYTHON% "%~dp0extract.py" %2 %3 %4 %5 %6
    echo.
    pause
) else (
    %PYTHON% "%~dp0gui.py"
)
