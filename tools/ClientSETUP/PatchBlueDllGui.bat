@echo off
setlocal

call "%~dp0scripts\EvEJSConfig.bat"

set "EVEJS_PATCHER=%~dp0blue_dll_patch.ps1"
set "EVEJS_BLUE_DLL=%EVEJS_CLIENT_PATH%\bin64\blue.dll"

if not "%~1"=="" (
  set "EVEJS_BLUE_DLL=%~1"
)

if exist "%EVEJS_BLUE_DLL%" (
  start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -STA -File "%EVEJS_PATCHER%" --gui --input "%EVEJS_BLUE_DLL%"
) else (
  start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -STA -File "%EVEJS_PATCHER%" --gui
)
exit /b 0
