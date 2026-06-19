@echo off
for %%I in ("%~dp0..\..\..") do set "EVEJS_REPO_ROOT=%%~fI"

rem Edit this path if your EVE client copy lives somewhere else.
set "EVEJS_CLIENT_PATH=%EVEJS_REPO_ROOT%\client\EVE\tq"

rem Leave this blank unless you want to point directly at exefile.exe.
set "EVEJS_CLIENT_EXE="

set "EVEJS_PROXY_URL=http://127.0.0.1:26002"
set "EVEJS_CA_PEM=%EVEJS_REPO_ROOT%\server\certs\xmpp-ca-cert.pem"
