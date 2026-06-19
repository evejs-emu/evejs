const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readRepoFile(...segments) {
  return fs.readFileSync(path.join(__dirname, "..", "..", ...segments), "utf8");
}

test("Play launchers bind client stdio to stable non-device sinks", () => {
  const playBat = readRepoFile("Play.bat");
  const playDebugBat = readRepoFile("PlayDebug.bat");
  const runClientProxyBat = readRepoFile("scripts", "windows", "RunClientProxy.bat");

  assert.match(playBat, /EVEJS_CLIENT_STDIO_LOG=%TEMP%\\evejs-client-stdout-/i);
  assert.match(playBat, /"%CLIENT_EXE%"\s+1>>"%EVEJS_CLIENT_STDIO_LOG%"\s+2>&1/i);
  assert.match(playBat, /EVEJS_PROXY_BLOCKED_HOSTS=api\.ipify\.org,sentry\.io,\.sentry\.io,launchdarkly\.com,\.launchdarkly\.com/i);
  assert.match(playDebugBat, /"%CLIENT_EXE%"\s+\/console/i);
  assert.doesNotMatch(playDebugBat, /1>con|1>nul|2>&1/i);
  assert.match(playDebugBat, /EVEJS_PROXY_BLOCKED_HOSTS=api\.ipify\.org,sentry\.io,\.sentry\.io,launchdarkly\.com,\.launchdarkly\.com/i);
  assert.match(runClientProxyBat, /EVEJS_CLIENT_STDIO_LOG=%TEMP%\\evejs-client-stdout-/i);
  assert.match(runClientProxyBat, /"%CLIENT_EXE%"\s+1>>"%EVEJS_CLIENT_STDIO_LOG%"\s+2>&1/i);
  assert.match(runClientProxyBat, /EVEJS_PROXY_BLOCKED_HOSTS=api\.ipify\.org,sentry\.io,\.sentry\.io,launchdarkly\.com,\.launchdarkly\.com/i);
});

test("PlayerConnect launcher redirects and drains client stdio", () => {
  const playerConnectClient = readRepoFile(
    "tools",
    "PlayerConnect",
    "assets",
    "PlayerConnectClient.cs",
  );

  assert.match(playerConnectClient, /RedirectStandardOutput\s*=\s*true\s*;/);
  assert.match(playerConnectClient, /RedirectStandardError\s*=\s*true\s*;/);
  assert.match(playerConnectClient, /BeginOutputReadLine\s*\(\s*\)\s*;/);
  assert.match(playerConnectClient, /BeginErrorReadLine\s*\(\s*\)\s*;/);
});

test("PlayerConnect local proxy enforces telemetry blocked hosts", () => {
  const playerConnectClient = readRepoFile(
    "tools",
    "PlayerConnect",
    "assets",
    "PlayerConnectClient.cs",
  );
  const playerBundleBuilder = readRepoFile(
    "tools",
    "PlayerConnect",
    "scripts",
    "build-player-bundle.ps1",
  );
  const playerConnectGui = readRepoFile("tools", "PlayerConnect", "PlayerConnect.ps1");

  assert.match(playerConnectClient, /ProxyBlockedHosts\s*=\s*"api\.ipify\.org,sentry\.io,\.sentry\.io,launchdarkly\.com,\.launchdarkly\.com"/);
  assert.match(playerConnectClient, /this\.blockedHosts\s*=\s*ParseBlockedHosts\(proxyBlockedHostsValue\)\s*;/);
  assert.match(playerConnectClient, /if\s*\(\s*this\.IsBlockedHost\(host\)\s*\)/);
  assert.match(playerConnectClient, /if\s*\(\s*this\.IsBlockedHost\(targetUri\.Host\)\s*\)/);
  assert.match(playerConnectClient, /WritePlainResponse\(clientStream,\s*403,\s*"Forbidden",\s*"Blocked by EveJS Elysian Player Connect policy\."\)/);
  assert.match(playerBundleBuilder, /\[string\]\$ProxyBlockedHosts\s*=\s*"api\.ipify\.org,sentry\.io,\.sentry\.io,launchdarkly\.com,\.launchdarkly\.com"/);
  assert.match(playerBundleBuilder, /ProxyBlockedHosts\s*=\s*\$ProxyBlockedHosts/);
  assert.match(playerConnectGui, /"-ProxyBlockedHosts",\s*\$snapshot\.values\.proxyBlockedHosts/);
});
