@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem Source-release cleaner for PublicEveJS.
rem Removes generated/local artifacts that must not be committed or zipped.
rem The copied EVE client is preserved unless /delete-client is passed.

pushd "%~dp0" >nul 2>nul || (
  echo [ERROR] Could not enter PublicEveJS root.
  exit /b 1
)

set "ROOT=%CD%"
set "SELF=%~f0"
set "DELETE_CLIENT=0"
set /a REMOVED_FILES=0
set /a REMOVED_DIRS=0

for %%A in (%*) do (
  if /I "%%~A"=="/delete-client" set "DELETE_CLIENT=1"
  if /I "%%~A"=="--delete-client" set "DELETE_CLIENT=1"
)

echo Cleaning PublicEveJS generated/source-release artifacts...
echo Root: %ROOT%
echo.

call :RemoveDir "_backup"
call :RemoveDir "_local"
call :RemoveDir "server\src\newDatabase\data"
call :RemoveDir "server\src\_secondary\image\generated"
call :RemoveDir "server\logs"
call :RemoveDir "server\src\logs"
call :RemoveDir "server\src\_secondary\data\chat"
call :RemoveDir "externalservices\market-server\data\generated"
call :RemoveDir "externalservices\market-server\data\cache"
call :RemoveDir "externalservices\market-server\target"
call :RemoveDir "tools\market-seed\cache"
call :RemoveDir "tools\market-seed\target"
call :RemoveDir "tools\market-seederv2\cache"
call :RemoveDir "tools\market-seederv2\target"
call :RemoveDir "node_modules"
call :RemoveDir "server\node_modules"

if "%DELETE_CLIENT%"=="1" (
  call :RemoveDir "client"
) else (
  if exist "client\" (
    echo [WARN] client\ exists and was preserved.
    echo        Do not include it in a public source zip or Git commit.
    echo        Run clean.bat /delete-client only if you want to remove it.
    echo.
  )
)

call :RemoveFile "evejs.config.local.json"
call :RemoveFile "tools\ClientSETUP\scripts\EvEJSConfig.bat"

for %%F in (
  "server\certs\*.pem"
  "server\src\_secondary\express\certs\*.pem"
  "externalservices\market-server\data\generated\*.sqlite"
  "externalservices\market-server\data\generated\*.sqlite-*"
  "externalservices\market-server\data\generated\*.db"
  "externalservices\market-server\data\generated\*.db-*"
  "tools\market-seed\*.sqlite"
  "tools\market-seed\*.sqlite-*"
  "tools\market-seed\*.db"
  "tools\market-seed\*.db-*"
  "tools\market-seed\*.csv"
  "tools\market-seed\*.csv.*"
  "tools\market-seed\*.bz2"
  "tools\market-seed\*.zst"
  "tools\market-seed\*.zip"
  "tools\market-seederv2\*.sqlite"
  "tools\market-seederv2\*.sqlite-*"
  "tools\market-seederv2\*.db"
  "tools\market-seederv2\*.db-*"
  "tools\market-seederv2\*.csv"
  "tools\market-seederv2\*.csv.*"
  "tools\market-seederv2\*.bz2"
  "tools\market-seederv2\*.zst"
  "tools\market-seederv2\*.zip"
  "*.zip"
  "*.7z"
  "*.rar"
  "*.tar"
  "*.tar.gz"
) do call :RemoveGlob %%~F

for /r %%F in (*.log *.tmp *.bak *.old *.orig *.original *.rej *.pid *.dmp) do (
  set "TARGET=%%~fF"
  if /I not "!TARGET!"=="!SELF!" (
    echo(!TARGET!| findstr /I /C:"\client\\" /C:"\node_modules\\" >nul
    if errorlevel 1 (
      del /f /q "!TARGET!" >nul 2>nul
      if not exist "!TARGET!" set /a REMOVED_FILES+=1
    )
  )
)

for /r %%F in (npm-debug*.log yarn-error*.log pnpm-debug*.log hs_err_pid*.log) do (
  set "TARGET=%%~fF"
  if /I not "!TARGET!"=="!SELF!" (
    echo(!TARGET!| findstr /I /C:"\client\\" /C:"\node_modules\\" >nul
    if errorlevel 1 (
      del /f /q "!TARGET!" >nul 2>nul
      if not exist "!TARGET!" set /a REMOVED_FILES+=1
    )
  )
)

for /d /r %%D in (.cache .pytest_cache .nyc_output coverage target cache node_modules) do (
  set "TARGET=%%~fD"
  if exist "!TARGET!\" (
    echo(!TARGET!| findstr /I /C:"\client\\" >nul
    if errorlevel 1 (
      rmdir /s /q "!TARGET!" >nul 2>nul
      if not exist "!TARGET!\" set /a REMOVED_DIRS+=1
    )
  )
)

echo Removed !REMOVED_FILES! file(s) and !REMOVED_DIRS! director(y/ies).
echo Clean complete. Run node tools\ReleaseGuard\verify-public-release.js next.
echo.

popd >nul 2>nul
exit /b 0

:RemoveDir
set "TARGET=%~1"
if not defined TARGET exit /b 0
if exist "%TARGET%\" (
  rmdir /s /q "%TARGET%" >nul 2>nul
  if not exist "%TARGET%\" set /a REMOVED_DIRS+=1
)
exit /b 0

:RemoveFile
set "TARGET=%~1"
if not defined TARGET exit /b 0
if exist "%TARGET%" (
  del /f /q "%TARGET%" >nul 2>nul
  if not exist "%TARGET%" set /a REMOVED_FILES+=1
)
exit /b 0

:RemoveGlob
for %%G in (%*) do (
  if exist "%%~G" (
    del /f /q "%%~G" >nul 2>nul
    if not exist "%%~G" set /a REMOVED_FILES+=1
  )
)
exit /b 0
