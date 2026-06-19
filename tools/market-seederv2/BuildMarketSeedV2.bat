@echo off
setlocal EnableDelayedExpansion
title PublicEveJS - TQ Market Snapshot Seeder

for %%I in ("%~dp0..\..") do set "PUBLIC_EVEJS_REPO_ROOT=%%~fI"
set "MARKET_SEEDER_V2_DIR=%PUBLIC_EVEJS_REPO_ROOT%\tools\market-seederv2"
set "MARKET_SEEDER_V2_CONFIG=%MARKET_SEEDER_V2_DIR%\config\market-seederv2.local.toml"

call :ResolveCargo
if errorlevel 1 exit /b 1

if not exist "%MARKET_SEEDER_V2_DIR%\Cargo.toml" (
  echo.
  echo   [!] Market seeder v2 project not found at:
  echo       %MARKET_SEEDER_V2_DIR%
  pause
  exit /b 1
)

if /i "%~1"=="doctor" goto Doctor
if /i "%~1"=="info" goto SnapshotInfo
if /i "%~1"=="build-release" goto BuildRelease
if /i "%~1"=="edit-config" goto EditConfig
if /i "%~1"=="yes" goto BuildYes

echo.
echo   ============================================================
echo     PublicEveJS - TQ Market Snapshot Seeder v2
echo   ============================================================
echo.
echo     [1] Build latest TQ station-market snapshot
echo     [2] Snapshot info only
echo     [3] Doctor - inspect current output database
echo     [4] Build release binary only
echo     [5] Edit v2 config
echo.
choice /c 12345 /n /m "  Choose [1-5]: "
echo.

if errorlevel 5 goto EditConfig
if errorlevel 4 goto BuildRelease
if errorlevel 3 goto Doctor
if errorlevel 2 goto SnapshotInfo
if errorlevel 1 goto Build

:Build
pushd "%MARKET_SEEDER_V2_DIR%"
"%CARGO_EXE%" run --release -- --config config/market-seederv2.local.toml build
set "PUBLIC_EVEJS_EXIT=%errorlevel%"
popd
goto Finish

:BuildYes
pushd "%MARKET_SEEDER_V2_DIR%"
"%CARGO_EXE%" run --release -- --config config/market-seederv2.local.toml build --yes
set "PUBLIC_EVEJS_EXIT=%errorlevel%"
popd
goto Finish

:SnapshotInfo
pushd "%MARKET_SEEDER_V2_DIR%"
"%CARGO_EXE%" run --release -- --config config/market-seederv2.local.toml snapshot-info
set "PUBLIC_EVEJS_EXIT=%errorlevel%"
popd
goto Finish

:Doctor
pushd "%MARKET_SEEDER_V2_DIR%"
"%CARGO_EXE%" run --release -- --config config/market-seederv2.local.toml doctor
set "PUBLIC_EVEJS_EXIT=%errorlevel%"
popd
goto Finish

:BuildRelease
pushd "%MARKET_SEEDER_V2_DIR%"
"%CARGO_EXE%" build --release
set "PUBLIC_EVEJS_EXIT=%errorlevel%"
popd
goto Finish

:EditConfig
if not exist "%MARKET_SEEDER_V2_CONFIG%" (
  echo   [!] Config file not found:
  echo       %MARKET_SEEDER_V2_CONFIG%
  pause
  exit /b 1
)
start "" notepad "%MARKET_SEEDER_V2_CONFIG%"
exit /b 0

:Finish
if not "%PUBLIC_EVEJS_EXIT%"=="0" (
  echo.
  echo   Market seeder v2 command exited with code %PUBLIC_EVEJS_EXIT%.
  pause
)
exit /b %PUBLIC_EVEJS_EXIT%

:ResolveCargo
set "CARGO_EXE=%USERPROFILE%\.cargo\bin\cargo.exe"
if exist "%CARGO_EXE%" exit /b 0

for /f "delims=" %%I in ('where cargo 2^>nul') do (
  set "CARGO_EXE=%%I"
  exit /b 0
)

echo.
echo   [!] Rust cargo.exe was not found.
echo       Run tools\InstallRustForMarket.bat
echo       or install Rust manually with:
echo       winget install -e --id Rustlang.Rustup
echo.
pause
exit /b 1
