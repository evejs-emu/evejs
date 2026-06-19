@echo off
setlocal
call "%~dp0tools\market-seed\BuildMarketSeedGui.bat" %*
exit /b %errorlevel%
