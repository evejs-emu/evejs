@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..\..") do set "REPO_ROOT=%%~fI"

set "PYTHON_CMD="
where py >nul 2>nul && set "PYTHON_CMD=py -3"
if not defined PYTHON_CMD (
  where python >nul 2>nul && set "PYTHON_CMD=python"
)
if not defined PYTHON_CMD (
  echo Python 3 is required to launch the desktop store editor.
  pause
  exit /b 1
)

start "New Eden Store Editor" /D "%REPO_ROOT%" cmd /k %PYTHON_CMD% ".\tools\NewEdenStoreEditor\editor.py"

endlocal
