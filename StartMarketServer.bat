@echo off
setlocal EnableDelayedExpansion
title EvEJS - Start Market Server

for %%I in ("%~dp0.") do set "EVEJS_REPO_ROOT=%%~fI"
set "MARKET_SERVER_DIR=%EVEJS_REPO_ROOT%\externalservices\market-server"
set "MARKET_SERVER_CONFIG=%MARKET_SERVER_DIR%\config\market-server.local.toml"
set "MARKET_SERVER_PS=%MARKET_SERVER_DIR%\StartMarketServer.ps1"
set "MARKET_SEED_LAUNCHER=%EVEJS_REPO_ROOT%\BuildMarketSeed.bat"
set "POWERSHELL_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"

call :ResolveCargo
if errorlevel 1 exit /b 1

if not exist "%MARKET_SERVER_DIR%\Cargo.toml" (
  echo.
  echo   [!] Market server project not found at:
  echo       %MARKET_SERVER_DIR%
  pause
  exit /b 1
)

echo.
echo   ============================================================
echo     EvEJS - Standalone Market Server
echo   ============================================================
echo.
echo     [1] Start market server - release build (recommended)
echo     [2] Start market server - debug build
echo     [3] Doctor - inspect manifest and cache state
  echo     [4] Build release binary only
  echo     [5] Edit market server config
  echo     [6] Build or refresh market seed
  echo     [7] Open market server README
  echo.
  echo     Ctrl+C in the live server console now performs a clean stop
  echo     and returns you to the menu without the noisy batch warning.
echo.
choice /c 1234567 /n /m "  Choose [1-7]: "
echo.

if errorlevel 7 goto OpenReadme
if errorlevel 6 goto OpenSeeder
if errorlevel 5 goto EditConfig
if errorlevel 4 goto BuildRelease
if errorlevel 3 goto Doctor
if errorlevel 2 goto StartDebug
if errorlevel 1 goto StartRelease

:StartRelease
call :RunPowerShellMode serve-release
goto Finish

:StartDebug
call :RunPowerShellMode serve-debug
goto Finish

:Doctor
call :RunPowerShellMode doctor
goto Finish

:BuildRelease
call :RunPowerShellMode build-release
goto Finish

:EditConfig
if not exist "%MARKET_SERVER_CONFIG%" (
  echo   [!] Config file not found:
  echo       %MARKET_SERVER_CONFIG%
  pause
  exit /b 1
)
start "" notepad "%MARKET_SERVER_CONFIG%"
exit /b 0

:OpenSeeder
if not exist "%MARKET_SEED_LAUNCHER%" (
  echo   [!] Seeder launcher not found:
  echo       %MARKET_SEED_LAUNCHER%
  pause
  exit /b 1
)
call "%MARKET_SEED_LAUNCHER%"
exit /b %errorlevel%

:OpenReadme
start "" notepad "%MARKET_SERVER_DIR%\README.md"
exit /b 0

:RunPowerShellMode
if not exist "%MARKET_SERVER_PS%" (
  echo   [!] PowerShell launcher not found:
  echo       %MARKET_SERVER_PS%
  exit /b 1
)
if not exist "%POWERSHELL_EXE%" (
  echo   [!] PowerShell executable not found:
  echo       %POWERSHELL_EXE%
  exit /b 1
)
"%POWERSHELL_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%MARKET_SERVER_PS%" -Mode %1
set "EVEJS_EXIT=%errorlevel%"
exit /b 0

:Finish
if not "%EVEJS_EXIT%"=="0" (
  echo.
  echo   Market server command exited with code %EVEJS_EXIT%.
  pause
)
exit /b %EVEJS_EXIT%

:ResolveCargo
set "CARGO_EXE=%USERPROFILE%\.cargo\bin\cargo.exe"
if exist "%CARGO_EXE%" exit /b 0

for /f "delims=" %%I in ('where cargo 2^>nul') do (
  set "CARGO_EXE=%%I"
  exit /b 0
)

echo.
echo   [!] Rust cargo.exe was not found.
echo       Run scripts\InstallRustForMarket.bat
echo       or install Rust manually with:
echo       winget install -e --id Rustlang.Rustup
echo.
pause
exit /b 1
