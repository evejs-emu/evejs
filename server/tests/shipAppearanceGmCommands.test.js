const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const {
  clearShipDirtTimestamp,
  getShipDirtTimestamp,
  resetShipDirtCacheForTests,
} = require(path.join(repoRoot, "server/src/services/ship/shipDirtState"));
const {
  getItemKillCountPlayer,
  resetShipKillCounterCacheForTests,
} = require(path.join(repoRoot, "server/src/services/ship/shipKillCounterState"));
const {
  handleShipDirtCommand,
  handleShipKillmarksCommand,
} = require(path.join(repoRoot, "server/src/services/ship/shipAppearanceGmCommands"));
const {
  buildSlimItemDict,
} = require(path.join(repoRoot, "server/src/space/destiny"));

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function snapshotTable(tableName) {
  return cloneValue(database.read(tableName, "/").data || {});
}

function restoreTable(tableName, snapshot) {
  database.write(tableName, "/", cloneValue(snapshot), { force: true });
}

test("GM appearance commands set and clear ship dirt and killmarks", (t) => {
  const originalDirt = snapshotTable("shipDirt");
  const originalKillCounters = snapshotTable("shipKillCounters");
  t.after(() => {
    restoreTable("shipDirt", originalDirt);
    restoreTable("shipKillCounters", originalKillCounters);
    resetShipDirtCacheForTests();
    resetShipKillCounterCacheForTests();
  });

  resetShipDirtCacheForTests();
  resetShipKillCounterCacheForTests();

  const shipID = 2999999001;
  clearShipDirtTimestamp(shipID, "test-start");

  const dirtResult = handleShipDirtCommand(null, `0.5 ${shipID}`);
  assert.equal(dirtResult.success, true);
  assert.match(dirtResult.message, /0\.50/);
  assert.ok(getShipDirtTimestamp(shipID, { createIfMissing: false }) > 0n);

  const cleanResult = handleShipDirtCommand(null, `0 ${shipID}`);
  assert.equal(cleanResult.success, true);
  assert.match(cleanResult.message, /clean/i);
  assert.equal(getShipDirtTimestamp(shipID, { createIfMissing: false }), 0n);

  const killmarkResult = handleShipKillmarksCommand(null, `12 ${shipID}`);
  assert.equal(killmarkResult.success, true);
  assert.match(killmarkResult.message, /12/);
  assert.equal(getItemKillCountPlayer(shipID), 12);

  const cappedResult = handleShipKillmarksCommand(null, `1200 ${shipID}`);
  assert.equal(cappedResult.success, true);
  assert.match(cappedResult.message, /999/);
  assert.equal(getItemKillCountPlayer(shipID), 999);

  const clearResult = handleShipKillmarksCommand(null, `0 ${shipID}`);
  assert.equal(clearResult.success, true);
  assert.equal(getItemKillCountPlayer(shipID), 0);
});

test("GM killmarks command broadcasts realtime slim changes for set and clear", { concurrency: false }, (t) => {
  const originalDirt = snapshotTable("shipDirt");
  const originalKillCounters = snapshotTable("shipKillCounters");
  const runtimePath = require.resolve(path.join(repoRoot, "server/src/space/runtime"));
  const originalRuntimeCacheEntry = require.cache[runtimePath];

  t.after(() => {
    restoreTable("shipDirt", originalDirt);
    restoreTable("shipKillCounters", originalKillCounters);
    resetShipDirtCacheForTests();
    resetShipKillCounterCacheForTests();
    if (originalRuntimeCacheEntry) {
      require.cache[runtimePath] = originalRuntimeCacheEntry;
    } else {
      delete require.cache[runtimePath];
    }
  });

  resetShipDirtCacheForTests();
  resetShipKillCounterCacheForTests();

  const shipID = 2999999002;
  clearShipDirtTimestamp(shipID, "test-start");
  const entity = {
    kind: "ship",
    itemID: shipID,
    typeID: 587,
    ownerID: 90000001,
    corporationID: 98000001,
    characterID: 90000001,
  };
  const broadcasts = [];
  const fakeScene = {
    getEntityByID(itemID) {
      return Number(itemID) === shipID ? entity : null;
    },
    broadcastSlimItemChanges(entities) {
      broadcasts.push(entities);
    },
  };

  const runtimeStub = new Module(runtimePath);
  runtimeStub.filename = runtimePath;
  runtimeStub.loaded = true;
  runtimeStub.exports = {
    getSceneForSession(session) {
      return session && session._space ? fakeScene : null;
    },
  };
  require.cache[runtimePath] = runtimeStub;

  const session = {
    characterID: 90000001,
    shipID,
    shipName: "Realtime Test Ship",
    _space: {
      shipID,
      systemID: 30000142,
    },
  };

  const setResult = handleShipKillmarksCommand(session, "12");
  assert.equal(setResult.success, true);
  assert.match(setResult.message, /Slim refresh broadcast/);
  assert.equal(getItemKillCountPlayer(shipID), 12);
  assert.equal(entity.kills, 12);
  assert.equal(
    Object.prototype.hasOwnProperty.call(entity, "dirtTime"),
    false,
    "setting killmarks must not manufacture a zero dirt timestamp",
  );
  assert.equal(broadcasts.length, 1);
  assert.strictEqual(broadcasts[0][0], entity);

  let slimEntries = new Map(buildSlimItemDict(entity).entries);
  assert.equal(slimEntries.get("kills"), 12);
  assert.equal(slimEntries.has("dirtTime"), false);

  const clearResult = handleShipKillmarksCommand(session, "0");
  assert.equal(clearResult.success, true);
  assert.match(clearResult.message, /Slim refresh broadcast/);
  assert.equal(getItemKillCountPlayer(shipID), 0);
  assert.equal(entity.kills, 0);
  assert.equal(
    Object.prototype.hasOwnProperty.call(entity, "dirtTime"),
    false,
    "clearing killmarks must not alter ship dirt",
  );
  assert.equal(broadcasts.length, 2);
  assert.strictEqual(broadcasts[1][0], entity);

  slimEntries = new Map(buildSlimItemDict(entity).entries);
  assert.equal(slimEntries.has("dirtTime"), false);
  assert.equal(
    slimEntries.get("kills"),
    0,
    "clearing killmarks must send kills=0 instead of omitting the field",
  );
});
