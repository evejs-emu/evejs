@echo off
setlocal EnableDelayedExpansion
title EvEJS - Build Market Seed

for %%I in ("%~dp0..\..") do set "EVEJS_REPO_ROOT=%%~fI"
set "MARKET_SEED_DIR=%EVEJS_REPO_ROOT%\tools\market-seed"
set "MARKET_SEED_CONFIG=%MARKET_SEED_DIR%\config\market-seed.local.toml"

call :ResolveCargo
if errorlevel 1 exit /b 1

if not exist "%MARKET_SEED_DIR%\Cargo.toml" (
  echo.
  echo   [!] Market seed project not found at:
  echo       %MARKET_SEED_DIR%
  pause
  exit /b 1
)

if /i "%~1"=="full" goto FullBuild
if /i "%~1"=="jita" goto JitaNewCaldari
if /i "%~1"=="smoke" goto QuickSmoke
if /i "%~1"=="gui" goto OpenGui
if /i "%~1"=="rebuild-summaries" goto RebuildSummaries
if /i "%~1"=="doctor" goto Doctor
if /i "%~1"=="build-release" goto BuildRelease
if /i "%~1"=="edit-config" goto EditConfig
if /i "%~1"=="readme" goto OpenReadme
if /i "%~1"=="presets" goto ListPresets

echo.
echo   ============================================================
echo     EvEJS - Build Market Seed
echo   ============================================================
echo.
echo     [1] Full universe rebuild - release build
echo     [2] Jita + New Caldari rebuild - release build
echo     [3] Quick smoke rebuild - 25 stations x 250 item types
echo     [4] Open seeder GUI
echo     [5] Rebuild summaries only
echo     [6] Doctor - inspect current seed database
echo     [7] Show supported presets
echo     [8] Build release binary only
echo     [9] Edit market seed config
echo     [A] Open seeder README
echo.
choice /c 123456789A /n /m "  Choose [1-9/A]: "
echo.

if errorlevel 10 goto OpenReadme
if errorlevel 9 goto EditConfig
if errorlevel 8 goto BuildRelease
if errorlevel 7 goto ListPresets
if errorlevel 6 goto Doctor
if errorlevel 5 goto RebuildSummaries
if errorlevel 4 goto OpenGui
if errorlevel 3 goto QuickSmoke
if errorlevel 2 goto JitaNewCaldari
if errorlevel 1 goto FullBuild

:FullBuild
echo   Building the full seeded market database...
echo.
pushd "%MARKET_SEED_DIR%"
"%CARGO_EXE%" run --release -- --config config/market-seed.local.toml build --force
set "EVEJS_EXIT=%errorlevel%"
popd
goto Finish

:JitaNewCaldari
echo   Building the Jita + New Caldari seeded market database...
echo   Preset: jita_new_caldari
echo.
pushd "%MARKET_SEED_DIR%"
"%CARGO_EXE%" run --release -- --config config/market-seed.local.toml build --force --preset jita_new_caldari
set "EVEJS_EXIT=%errorlevel%"
popd
goto Finish

:QuickSmoke
echo   Building a quick smoke-test market database...
echo.
pushd "%MARKET_SEED_DIR%"
"%CARGO_EXE%" run -- --config config/market-seed.local.toml build --force --station-limit 25 --type-limit 250
set "EVEJS_EXIT=%errorlevel%"
popd
goto Finish

:RebuildSummaries
echo   Rebuilding market region summaries...
echo.
pushd "%MARKET_SEED_DIR%"
"%CARGO_EXE%" run --release -- --config config/market-seed.local.toml rebuild-summaries
set "EVEJS_EXIT=%errorlevel%"
popd
goto Finish

:Doctor
echo   Running market seed doctor...
echo.
pushd "%MARKET_SEED_DIR%"
"%CARGO_EXE%" run --release -- --config config/market-seed.local.toml doctor
set "EVEJS_EXIT=%errorlevel%"
popd
goto Finish

:ListPresets
echo   Listing supported market seed presets...
echo.
pushd "%MARKET_SEED_DIR%"
"%CARGO_EXE%" run -- --config config/market-seed.local.toml presets
set "EVEJS_EXIT=%errorlevel%"
popd
goto Finish

:BuildRelease
echo   Building market seed release binary...
echo.
pushd "%MARKET_SEED_DIR%"
"%CARGO_EXE%" build --release
set "EVEJS_EXIT=%errorlevel%"
popd
goto Finish

:EditConfig
if not exist "%MARKET_SEED_CONFIG%" (
  echo   [!] Config file not found:
  echo       %MARKET_SEED_CONFIG%
  pause
  exit /b 1
)
start "" notepad "%MARKET_SEED_CONFIG%"
exit /b 0

:OpenGui
call "%MARKET_SEED_DIR%\BuildMarketSeedGui.bat"
exit /b %errorlevel%

:OpenReadme
start "" notepad "%MARKET_SEED_DIR%\README.md"
exit /b 0

:Finish
if not "%EVEJS_EXIT%"=="0" (
  echo.
  echo   Market seed command exited with code %EVEJS_EXIT%.
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
echo       Run tools\InstallRustForMarket.bat
echo       or install Rust manually with:
echo       winget install -e --id Rustlang.Rustup
echo.
pause
exit /b 1
