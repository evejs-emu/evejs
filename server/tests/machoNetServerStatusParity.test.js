const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const config = require(path.join(repoRoot, "server/src/config"));
const MachoNetService = require(path.join(
  repoRoot,
  "server/src/services/machoNet/machoNetService",
));
const {
  buildServerStatusResponse,
} = require(path.join(repoRoot, "server/src/services/machoNet/globalConfig"));

function readDictEntries(payload) {
  if (
    !payload ||
    payload.type !== "dict" ||
    !Array.isArray(payload.entries)
  ) {
    return new Map();
  }
  return new Map(payload.entries);
}

test("machoNet GetServerStatus returns status tuple plus boot metadata for the login client", () => {
  const service = new MachoNetService();
  const payload = service.Handle_GetServerStatus([], null);
  assert.ok(Array.isArray(payload));
  assert.equal(payload.length, 2);

  const [statusMessage, statusPayload] = payload;
  const entries = readDictEntries(statusPayload);

  assert.deepEqual(statusMessage, [config.serverStatusLabel, {}]);
  assert.equal(statusPayload && statusPayload.type, "dict");
  assert.equal(entries.get("boot_version"), config.clientVersion);
  assert.equal(entries.get("boot_build"), config.clientBuild);
  assert.equal(entries.get("boot_codename"), config.projectCodename);
  assert.equal(entries.get("boot_region"), config.projectRegion);
  assert.equal(entries.get("update_info"), config.projectVersion);
  assert.equal(
    entries.get("cluster_usercount"),
    config.serverStatusClusterUserCount,
  );
  assert.equal(
    entries.get("user_logonqueueposition"),
    config.serverStatusQueuePosition,
  );
  assert.equal(entries.get("macho_version"), config.machoVersion);
  assert.equal(entries.get("status"), "OK");
});

test("machoNet GetServerStatus builds parity parameters for special status labels", () => {
  const [startingUpMessage, startingUpPayload] = buildServerStatusResponse({
    ...config,
    serverStatusLabel: "/Carbon/MachoNet/ServerStatus/StartingUp",
    serverStatusProgressSeconds: 45,
  });
  const startingUpEntries = readDictEntries(startingUpPayload);

  assert.deepEqual(startingUpMessage, [
    "/Carbon/MachoNet/ServerStatus/StartingUp",
    { progress: 45 },
  ]);
  assert.equal(startingUpEntries.get("status"), "StartingUp");

  const [proxyFullMessage, proxyFullPayload] = buildServerStatusResponse({
    ...config,
    serverStatusLabel: "/Carbon/MachoNet/ServerStatus/ProxyFullWithLimit",
    serverStatusProxyLimit: 250,
  });
  const proxyFullEntries = readDictEntries(proxyFullPayload);

  assert.deepEqual(proxyFullMessage, [
    "/Carbon/MachoNet/ServerStatus/ProxyFullWithLimit",
    { limit: 250 },
  ]);
  assert.equal(proxyFullEntries.get("status"), "ProxyFullWithLimit");
});
