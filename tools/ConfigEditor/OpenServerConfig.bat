@echo off
setlocal

for %%I in ("%~dp0..\..") do set "EVEJS_REPO_ROOT=%%~fI"

call "%EVEJS_REPO_ROOT%\tools\ClientSETUP\scripts\EvEJSConfig.bat"

powershell.exe -Sta -NoProfile -ExecutionPolicy Bypass -File "%~dp0OpenServerConfigV2.ps1"
set "EVEJS_EXIT=%errorlevel%"

if not "%EVEJS_EXIT%"=="0" (
  echo [eve.js] Config manager exited with code %EVEJS_EXIT%.
  pause
)

exit /b %EVEJS_EXIT%
