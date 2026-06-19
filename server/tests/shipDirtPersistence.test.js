const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "public-evejs-ship-dirt-"));
fs.mkdirSync(path.join(dataDir, "shipDirt"), { recursive: true });
fs.mkdirSync(path.join(dataDir, "shipKillCounters"), { recursive: true });
fs.mkdirSync(path.join(dataDir, "shipDogmaAttributes"), { recursive: true });
fs.mkdirSync(path.join(dataDir, "typeDogma"), { recursive: true });
fs.writeFileSync(
  path.join(dataDir, "shipDirt", "data.json"),
  JSON.stringify({ _meta: { schemaVersion: 1 }, ships: {} }, null, 2),
);
fs.writeFileSync(
  path.join(dataDir, "shipKillCounters", "data.json"),
  JSON.stringify({ _meta: { schemaVersion: 1 }, ships: {} }, null, 2),
);
fs.writeFileSync(
  path.join(dataDir, "shipDogmaAttributes", "data.json"),
  JSON.stringify({ _meta: { schemaVersion: 1 }, ships: {} }, null, 2),
);
fs.writeFileSync(
  path.join(dataDir, "typeDogma", "data.json"),
  JSON.stringify({ _meta: { schemaVersion: 1 }, types: {} }, null, 2),
);
process.env.EVEJS_NEWDB_DATA_DIR = dataDir;

const repoRoot = path.join(__dirname, "..", "..");
const {
  clearShipDirtTimestamp,
  getShipDirtTimestamp,
  resetShipDirtCacheForTests,
  resetShipDirtTimestamp,
} = require(path.join(repoRoot, "server/src/services/ship/shipDirtState"));
const {
  buildSlimItemDict,
} = require(path.join(repoRoot, "server/src/space/destiny"));

test("ship dirt timestamps persist until explicitly cleared", () => {
  resetShipDirtCacheForTests();
  const shipID = 2999999001;
  const timestamp = 134260000000000000n;

  const setResult = resetShipDirtTimestamp(shipID, timestamp, {
    reason: "test",
  });
  assert.equal(setResult.success, true);
  assert.equal(getShipDirtTimestamp(shipID, { createIfMissing: false }), timestamp);
  assert.equal(getShipDirtTimestamp(shipID, { createIfMissing: false }), timestamp);

  const clearResult = clearShipDirtTimestamp(shipID, "test-clear");
  assert.equal(clearResult.success, true);
  assert.equal(getShipDirtTimestamp(shipID, { createIfMissing: false }), 0n);

  buildSlimItemDict({
    kind: "ship",
    itemID: shipID,
    typeID: 587,
    ownerID: 1,
  });
  assert.equal(
    getShipDirtTimestamp(shipID, { createIfMissing: false }),
    0n,
    "building a slim must not recreate a cleared dirt timestamp",
  );

  const cleanSlim = buildSlimItemDict({
    kind: "ship",
    itemID: shipID,
    typeID: 587,
    ownerID: 1,
    dirtTime: 0n,
  });
  const cleanSlimEntries = new Map(cleanSlim.entries);
  assert.equal(
    cleanSlimEntries.get("dirtTime").value,
    0n,
    "an explicit clean slim must send dirtTime=0 so the client clears cached dirt",
  );
});
