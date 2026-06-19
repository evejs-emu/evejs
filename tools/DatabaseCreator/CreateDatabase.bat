@echo off
setlocal EnableExtensions EnableDelayedExpansion
title EvEJS Database Creator

for %%I in ("%~dp0..\..") do set "EVEJS_REPO_ROOT=%%~fI"
set "SDE_BUILD=3396210"
set "SDE_URL=https://developers.eveonline.com/static-data/tranquility/eve-online-static-data-%SDE_BUILD%-jsonl.zip"
set "LOCAL_ROOT=%EVEJS_REPO_ROOT%\_local"
set "DOWNLOAD_DIR=%LOCAL_ROOT%\downloads\sde"
set "SDE_ZIP=%DOWNLOAD_DIR%\eve-online-static-data-%SDE_BUILD%-jsonl.zip"
set "SDE_DIR=%LOCAL_ROOT%\sde\eve-online-static-data-%SDE_BUILD%-jsonl"
set "DATA_DIR=%LOCAL_ROOT%\newDatabase\data"
set "MANIFEST=%LOCAL_ROOT%\newDatabase\manifest.json"

if /I "%~1"=="/force" set "EVEJS_DATABASE_CREATOR_FORCE=1"
if /I "%~1"=="--force" set "EVEJS_DATABASE_CREATOR_FORCE=1"

echo.
echo   ============================================================
echo     EvEJS Local Database Creator
echo   ============================================================
echo.
echo   Build: %SDE_BUILD%
echo   Output: %DATA_DIR%
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo   [ERROR] Node.js is required before database generation.
  echo       Run SetupEveJS.bat, or install Node.js LTS from https://nodejs.org
  exit /b 1
)

if exist "%MANIFEST%" if not "%EVEJS_DATABASE_CREATOR_FORCE%"=="1" (
  echo   Existing generated database found.
  echo   Keeping it. Use CreateDatabase.bat /force to rebuild it.
  exit /b 0
)

if not exist "%DOWNLOAD_DIR%" mkdir "%DOWNLOAD_DIR%" >nul 2>&1
if not exist "%SDE_ZIP%" (
  echo   Downloading CCP public SDE JSONL...
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '%SDE_URL%' -OutFile '%SDE_ZIP%'"
  if errorlevel 1 (
    echo.
    echo   [ERROR] SDE download failed:
    echo       %SDE_URL%
    exit /b 1
  )
) else (
  echo   Using cached SDE zip.
)

if not exist "%SDE_DIR%\_sde.jsonl" (
  echo   Extracting SDE zip...
  if exist "%SDE_DIR%" rmdir /s /q "%SDE_DIR%" >nul 2>&1
  mkdir "%SDE_DIR%" >nul 2>&1
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "Expand-Archive -LiteralPath '%SDE_ZIP%' -DestinationPath '%SDE_DIR%' -Force"
  if errorlevel 1 (
    echo.
    echo   [ERROR] SDE extraction failed.
    exit /b 1
  )
) else (
  echo   Using extracted SDE directory.
)

echo   Generating EvEJS local database...
node --max-old-space-size=8192 "%~dp0database-creator.js" --sde-dir "%SDE_DIR%" --out "%DATA_DIR%" --build "%SDE_BUILD%" --sde-url "%SDE_URL%" --force
set "EVEJS_EXIT=%errorlevel%"

if not "%EVEJS_EXIT%"=="0" (
  echo.
  echo   [ERROR] Database generation failed with code %EVEJS_EXIT%.
  exit /b %EVEJS_EXIT%
)

echo.
echo   Database generation complete.
echo   Manifest: %MANIFEST%
exit /b 0
