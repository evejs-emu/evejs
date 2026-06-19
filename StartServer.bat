@echo off
setlocal EnableDelayedExpansion
title EvEJS - Start Server

rem Resolve the launcher root from this script's location.
for %%I in ("%~dp0.") do set "EVEJS_REPO_ROOT=%%~fI"
set "EVEJS_NEWDB_DATA_DIR=%EVEJS_REPO_ROOT%\_local\newDatabase\data"

rem Load config from the new location first, then older layouts.
call :ResolveConfigDir
if errorlevel 1 exit /b 1
call "%EVEJS_CONFIG_DIR%\EvEJSConfig.bat"
if errorlevel 1 (
  echo.
  echo   [ERROR] Could not load launcher config:
  echo       %EVEJS_CONFIG_DIR%\EvEJSConfig.bat
  pause
  exit /b 1
)

echo.
echo   ============================================================
echo     EvEJS - Start Server
echo   ============================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo   [ERROR] Node.js is not installed or not on PATH.
  echo       The server requires Node.js to run.
  echo       Download it from https://nodejs.org
  pause
  exit /b 1
)

if not exist "%EVEJS_REPO_ROOT%\server\index.js" (
  echo   [ERROR] Server not found at %EVEJS_REPO_ROOT%\server
  pause
  exit /b 1
)

call :EnsureGeneratedDatabase
if errorlevel 1 exit /b 1

call :EnsureServerDependencies
if errorlevel 1 exit /b 1

echo   Are you also playing on this machine?
echo.
echo     [1] Server only  -  just run the server
echo     [2] Server + Play -  run the server AND launch the game
echo.
set "PLAY_CHOICE=0"
set /p "PLAY_CHOICE=  Choose [1/2]: "

echo.

set "EVEJS_PROXY_LOCAL_INTERCEPT=1"
if not exist "%EVEJS_REPO_ROOT%\server\logs\node-reports" mkdir "%EVEJS_REPO_ROOT%\server\logs\node-reports" >nul 2>&1

if "%PLAY_CHOICE%"=="2" (
  echo   Starting server in background...
  start "EvEJS Server" /D "%EVEJS_REPO_ROOT%\server" cmd /c "set EVEJS_PROXY_LOCAL_INTERCEPT=1 && npm start"
  echo   Server starting up...
  echo.

  rem Give the server a few seconds to initialize.
  ping -n 5 127.0.0.1 >nul 2>&1

  echo   Launching Play.bat...
  echo.
  call "%EVEJS_REPO_ROOT%\Play.bat"
) else (
  echo   Starting server...
  echo   Press Ctrl+C to stop.
  echo.
  echo   ============================================================
  echo     Server is running. Players can connect now.
  echo   ============================================================
  echo.

  pushd "%EVEJS_REPO_ROOT%\server"
  call npm start
  set "EVEJS_EXIT=!errorlevel!"
  popd

  if not "!EVEJS_EXIT!"=="0" (
    echo.
    echo   Server exited with code !EVEJS_EXIT!.
    pause
  )

  exit /b !EVEJS_EXIT!
)

exit /b 0

:EnsureServerDependencies
if exist "%EVEJS_REPO_ROOT%\server\node_modules\express\package.json" exit /b 0

echo   Server dependencies are not installed.
echo   Running npm ci in the server directory...
echo.

pushd "%EVEJS_REPO_ROOT%\server"
call npm ci
set "EVEJS_NPM_EXIT=!errorlevel!"
popd

if not "!EVEJS_NPM_EXIT!"=="0" (
  echo.
  echo   [ERROR] npm ci failed with code !EVEJS_NPM_EXIT!.
  echo       Check your internet connection and npm configuration.
  pause
  exit /b !EVEJS_NPM_EXIT!
)

echo.
echo   Dependencies installed successfully.
echo.
exit /b 0

:EnsureGeneratedDatabase
if exist "%EVEJS_NEWDB_DATA_DIR%\itemTypes\data.json" if exist "%EVEJS_NEWDB_DATA_DIR%\accounts\data.json" exit /b 0

echo.
echo   [ERROR] Generated EvEJS database is missing.
echo       Run SetupEveJS.bat first.
echo.
echo       Expected:
echo       %EVEJS_NEWDB_DATA_DIR%
pause
exit /b 1

:ResolveConfigDir
set "EVEJS_CONFIG_DIR="
if exist "%EVEJS_REPO_ROOT%\tools\ClientSETUP\scripts\EvEJSConfig.bat" (
  set "EVEJS_CONFIG_DIR=%EVEJS_REPO_ROOT%\tools\ClientSETUP\scripts"
  exit /b 0
)
if exist "%EVEJS_REPO_ROOT%\scripts\windows\EvEJSConfig.bat" (
  set "EVEJS_CONFIG_DIR=%EVEJS_REPO_ROOT%\scripts\windows"
  exit /b 0
)
if exist "%~dp0scripts\EvEJSConfig.bat" (
  set "EVEJS_CONFIG_DIR=%~dp0scripts"
  exit /b 0
)
if exist "%~dp0scripts\windows\EvEJSConfig.bat" (
  set "EVEJS_CONFIG_DIR=%~dp0scripts\windows"
  exit /b 0
)
if exist "%~dp0EvEJSConfig.bat" (
  set "EVEJS_CONFIG_DIR=%~dp0"
  exit /b 0
)
echo.
echo   [ERROR] Launcher config was not found.
echo       Looked for EvEJSConfig.bat under:
echo       %EVEJS_REPO_ROOT%\tools\ClientSETUP\scripts
echo       %EVEJS_REPO_ROOT%\scripts\windows
echo       %~dp0scripts
echo.
echo       Update your launcher files or run the Client Setup wizard again.
pause
exit /b 1
