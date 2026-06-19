@echo off
setlocal EnableExtensions
title EvEJS - Install Rust For Market

set "POWERSHELL_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "CARGO_BIN=%USERPROFILE%\.cargo\bin"
set "RUSTUP_EXE=%CARGO_BIN%\rustup.exe"
set "RUSTUP_INIT_EXE=%CARGO_BIN%\rustup-init.exe"
set "CARGO_EXE=%CARGO_BIN%\cargo.exe"
set "RUSTC_EXE=%CARGO_BIN%\rustc.exe"
set "WINGET_EXE="
set "EVEJS_EXIT=0"

call :EnsureAdmin
if errorlevel 2 exit /b 0
if errorlevel 1 exit /b 1

echo.
echo   ============================================================
echo     EvEJS - Install Rust For Market
echo   ============================================================
echo.
echo   This installs the Rust tools used by the optional
echo   standalone market builder and standalone market server.
echo.

call :ResolveWinget
if errorlevel 1 goto WingetMissing

echo   Step 1/3 - Installing or refreshing rustup with winget...
"%WINGET_EXE%" install -e --id Rustlang.Rustup --accept-package-agreements --accept-source-agreements
set "EVEJS_EXIT=%errorlevel%"
if not "%EVEJS_EXIT%"=="0" (
  echo.
  echo   [!] winget could not finish the Rust install.
  echo       Exit code: %EVEJS_EXIT%
  goto Fail
)

set "PATH=%CARGO_BIN%;%PATH%"

echo.
echo   Step 2/3 - Installing the stable Rust toolchain...
call :InstallStableToolchain
if errorlevel 1 goto Fail

echo.
echo   Step 3/3 - Checking cargo and rustc...
call :VerifyCargo
if errorlevel 1 goto Fail
call :VerifyRustc
if errorlevel 1 goto Fail

echo.
echo   Rust is ready for the standalone market tools.
echo.
echo   Next steps:
echo     1. Double-click BuildMarketSeedGui.bat
echo     2. Build the market database
echo     3. Double-click StartMarketServer.bat
echo.
pause
exit /b 0

:EnsureAdmin
"%POWERSHELL_EXE%" -NoProfile -Command "if (([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 0 } else { exit 1 }"
if "%errorlevel%"=="0" exit /b 0

echo.
echo   Asking Windows for Administrator permission...
"%POWERSHELL_EXE%" -NoProfile -Command "Start-Process -FilePath $env:ComSpec -WorkingDirectory '%~dp0' -ArgumentList '/c """"%~f0""""' -Verb RunAs"
if not "%errorlevel%"=="0" (
  echo.
  echo   [!] Administrator approval was cancelled.
  pause
  exit /b 1
)
exit /b 2

:ResolveWinget
if exist "%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe" (
  set "WINGET_EXE=%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe"
  exit /b 0
)

for /f "delims=" %%I in ('where winget 2^>nul') do (
  set "WINGET_EXE=%%I"
  exit /b 0
)

exit /b 1

:InstallStableToolchain
if exist "%RUSTUP_EXE%" goto UseRustupExe

for /f "delims=" %%I in ('where rustup 2^>nul') do (
  set "RUSTUP_EXE=%%I"
  goto UseRustupExe
)

if exist "%RUSTUP_INIT_EXE%" goto UseRustupInitExe

for /f "delims=" %%I in ('where rustup-init 2^>nul') do (
  set "RUSTUP_INIT_EXE=%%I"
  goto UseRustupInitExe
)

echo   [!] rustup was not found after the winget install finished.
echo       Close this window, open a fresh terminal, and try again once.
exit /b 1

:UseRustupExe
"%RUSTUP_EXE%" set profile default
if errorlevel 1 exit /b 1
"%RUSTUP_EXE%" toolchain install stable
if errorlevel 1 exit /b 1
"%RUSTUP_EXE%" default stable
if errorlevel 1 exit /b 1
exit /b 0

:UseRustupInitExe
"%RUSTUP_INIT_EXE%" -y --default-toolchain stable --profile default
if errorlevel 1 exit /b 1
exit /b 0

:VerifyCargo
if exist "%CARGO_EXE%" (
  "%CARGO_EXE%" --version
  if errorlevel 1 exit /b 1
  exit /b 0
)

for /f "delims=" %%I in ('where cargo 2^>nul') do (
  "%%I" --version
  if errorlevel 1 exit /b 1
  exit /b 0
)

echo   [!] cargo.exe was not found after installation.
echo       Try closing this window, opening a new terminal, and running the script again.
exit /b 1

:VerifyRustc
if exist "%RUSTC_EXE%" (
  "%RUSTC_EXE%" --version
  if errorlevel 1 exit /b 1
  exit /b 0
)

for /f "delims=" %%I in ('where rustc 2^>nul') do (
  "%%I" --version
  if errorlevel 1 exit /b 1
  exit /b 0
)

echo   [!] rustc.exe was not found after installation.
echo       Try closing this window, opening a new terminal, and running the script again.
exit /b 1

:WingetMissing
echo.
echo   [!] winget was not found on this Windows install.
echo       Install or update "App Installer" from the Microsoft Store,
echo       then run this script again.
echo.
pause
exit /b 1

:Fail
echo.
echo   Rust setup did not finish cleanly.
echo   If needed, read docs\RUST_SETUP.md for the slower step-by-step version.
echo.
pause
exit /b 1
