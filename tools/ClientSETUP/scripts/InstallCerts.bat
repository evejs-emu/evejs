@echo off
setlocal

call "%~dp0EvEJSConfig.bat"

if not exist "%EVEJS_CLIENT_PATH%" (
  echo [eve.js] Client path does not exist: "%EVEJS_CLIENT_PATH%"
  echo [eve.js] Edit tools\ClientSETUP\scripts\EvEJSConfig.bat and set EVEJS_CLIENT_PATH first.
  pause
  exit /b 1
)

echo [eve.js] Installing chat and public-gateway certificates for:
echo [eve.js]   %EVEJS_CLIENT_PATH%
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-EvEJSCerts.ps1" -ClientPath "%EVEJS_CLIENT_PATH%" %*
set "EVEJS_EXIT=%errorlevel%"

echo.
if not "%EVEJS_EXIT%"=="0" (
  echo [eve.js] Certificate install failed with code %EVEJS_EXIT%.
  pause
  exit /b %EVEJS_EXIT%
)

echo [eve.js] Certificate install finished successfully.
pause
exit /b 0
