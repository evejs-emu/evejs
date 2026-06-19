const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

process.env.EVEJS_ASTEROID_FIELDS = "true";

const repoRoot = path.join(__dirname, "..", "..");

const runtime = require(path.join(repoRoot, "server/src/space/runtime"));
const destiny = require(path.join(repoRoot, "server/src/space/destiny"));
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const {
  TABLE,
  readStaticRows,
} = require(path.join(
  repoRoot,
  "server/src/services/_shared/referenceData",
));
const {
  resolveItemByTypeID,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemTypeRegistry",
));
const {
  getMineableState,
  applyMiningDelta,
  shouldPersistMineableState,
  clearPersistedSystemState,
  resetSceneMiningState,
  summarizeSceneMiningState,
  _testing: miningRuntimeTesting,
} = require(path.join(
  repoRoot,
  "server/src/services/mining/miningRuntimeState",
));

function pickAsteroidBeltSystem() {
  const belts = readStaticRows(TABLE.ASTEROID_BELTS);
  assert.ok(belts.length > 0, "expected stored asteroid belt rows");

  const firstBelt = belts[0];
  const systemID = Number(firstBelt && firstBelt.solarSystemID) || 0;
  assert.ok(systemID > 0, "expected asteroid belt system ID");
  return systemID;
}

function resetMiningTestState(systemID) {
  clearPersistedSystemState(systemID);
  database.flushAllSync();
  runtime._testing.clearScenes();
}

function getSlimEntry(dict, key) {
  const entries = Array.isArray(dict && dict.entries) ? dict.entries : [];
  const match = entries.find((entry) => Array.isArray(entry) && entry[0] === key);
  return match ? match[1] : undefined;
}

function getNotificationDictEntry(notification, key) {
  const dict =
    notification &&
    Array.isArray(notification.payload) &&
    notification.payload[0];
  return getSlimEntry(dict, key);
}

test("generated asteroid mining state initializes with full quantities and preserved visuals", () => {
  const systemID = pickAsteroidBeltSystem();
  resetMiningTestState(systemID);

  const scene = runtime.ensureScene(systemID);
  const asteroid = scene.staticEntities.find((entity) => entity.kind === "asteroid");
  assert.ok(asteroid, "expected at least one generated asteroid");

  const state = getMineableState(scene, asteroid.itemID);
  assert.ok(state, "expected generated asteroid to have mining runtime state");
  assert.equal(
    state.remainingQuantity,
    state.originalQuantity,
    "fresh asteroids should start at full quantity",
  );
  assert.ok(state.originalQuantity > 1, "fresh asteroids should not collapse to quantity 1");
  assert.ok(state.visualTypeID > 0, "expected original asteroid visual type to be preserved");
  assert.ok(state.originalRadius >= asteroid.radius, "expected original radius to be retained");

  resetMiningTestState(systemID);
});

test("generated asteroid slim payload exposes ore identity while preserving visual asteroid state", () => {
  const systemID = pickAsteroidBeltSystem();
  resetMiningTestState(systemID);

  const scene = runtime.ensureScene(systemID);
  const asteroid = scene.staticEntities.find((entity) => entity.kind === "asteroid");
  assert.ok(asteroid, "expected at least one generated asteroid");

  const state = getMineableState(scene, asteroid.itemID);
  assert.ok(state, "expected generated asteroid to have mining runtime state");
  assert.ok(state.visualTypeID > 0, "expected generated asteroid to preserve a space-object type");
  assert.notEqual(
    state.visualTypeID,
    state.yieldTypeID,
    "generated asteroid visuals should not collapse to the ore inventory type",
  );
  assert.equal(
    asteroid.typeID,
    state.visualTypeID,
    "runtime entity should keep the asteroid space-object type",
  );

  const slim = destiny.buildSlimItemDict(asteroid);
  assert.equal(
    getSlimEntry(slim, "typeID"),
    state.yieldTypeID,
    "AddBalls2 slim payload should present the ore type to the client",
  );
  const yieldType = resolveItemByTypeID(state.yieldTypeID);
  assert.ok(yieldType, "expected yield type record");
  assert.equal(
    getSlimEntry(slim, "name"),
    yieldType.name,
    "slim payload should still present the ore name to the client",
  );
  assert.equal(
    getSlimEntry(slim, "groupID"),
    yieldType.groupID,
    "slim payload should present the ore group to the client",
  );
  assert.equal(
    getSlimEntry(slim, "categoryID"),
    yieldType.categoryID,
    "slim payload should present the ore category to the client",
  );

  resetMiningTestState(systemID);
});

test("generated belt templates expand ore families to include graded ore variants", () => {
  const highsecEntries = miningRuntimeTesting.getTemplateEntriesForFieldStyle(
    "empire_highsec_standard",
  );
  const highsecNames = new Set(highsecEntries.map((entry) => String(entry && entry.oreName || "")));
  assert.ok(highsecNames.has("Veldspar"), "expected highsec template to include base Veldspar");
  assert.ok(highsecNames.has("Veldspar II-Grade"), "expected highsec template to include Veldspar II-Grade");
  assert.ok(highsecNames.has("Veldspar III-Grade"), "expected highsec template to include Veldspar III-Grade");
  assert.ok(highsecNames.has("Veldspar IV-Grade"), "expected highsec template to include Veldspar IV-Grade");
  assert.ok(highsecNames.has("Scordite II-Grade"), "expected highsec template to include Scordite II-Grade");

  const nullsecEntries = miningRuntimeTesting.getTemplateEntriesForFieldStyle(
    "nullsec_standard",
  );
  const nullsecNames = new Set(nullsecEntries.map((entry) => String(entry && entry.oreName || "")));
  assert.ok(nullsecNames.has("Spodumain II-Grade"), "expected nullsec template to include Spodumain II-Grade");
  assert.ok(nullsecNames.has("Arkonor IV-Grade"), "expected nullsec template to include Arkonor IV-Grade");
});

test("mission and dungeon mineables stay out of global mining persistence", () => {
  assert.equal(
    shouldPersistMineableState({
      dungeonMaterializedSiteContent: true,
    }),
    false,
  );
  assert.equal(
    shouldPersistMineableState({
      dungeonSiteContentMissionObjectiveTarget: true,
    }),
    false,
  );
  assert.equal(
    shouldPersistMineableState({
      dungeonSiteInstanceID: 991001,
    }),
    false,
  );
  assert.equal(
    shouldPersistMineableState({
      kind: "asteroid",
      itemID: 550001,
    }),
    true,
  );
});

test("mining delta emits the TQ OnOreMined cycle notification", () => {
  const systemID = 30001363;
  resetMiningTestState(systemID);

  const scene = runtime.ensureScene(systemID);
  const asteroid = scene.staticEntities.find((entity) => entity.kind === "asteroid");
  assert.ok(asteroid, "expected at least one asteroid");

  const state = getMineableState(scene, asteroid.itemID);
  assert.ok(state, "expected asteroid mining state");
  const oreType = resolveItemByTypeID(state.yieldTypeID);
  const moduleType = resolveItemByTypeID(483);
  const shipType = resolveItemByTypeID(32880);
  assert.ok(oreType && moduleType && shipType, "expected mining payload type records");

  const notifications = [];
  const sourceEntity = {
    itemID: 1050492240084,
    typeID: shipType.typeID,
    groupID: shipType.groupID,
    characterID: 2123725293,
    systemID,
    session: {
      characterID: 2123725293,
      solarsystemid2: systemID,
      sendNotification(name, idType, payload) {
        notifications.push({ name, idType, payload });
      },
    },
  };
  const moduleItem = {
    itemID: 1050490400719,
    typeID: moduleType.typeID,
    groupID: moduleType.groupID,
  };

  const minedQuantity = Math.min(302, state.remainingQuantity);
  const result = applyMiningDelta(scene, asteroid, minedQuantity, 0, {
    broadcast: false,
    nowMs: scene.getCurrentSimTimeMs(),
    sourceEntity,
    moduleItem,
    quantityAdded: minedQuantity,
    amountWasted: 0,
    amountCritBonus: 0,
    hasRewards: false,
  });
  assert.equal(result.success, true, "expected mining delta to succeed");

  const notification = notifications.find((entry) => entry.name === "OnOreMined");
  assert.ok(notification, "expected TQ OnOreMined notification");
  assert.equal(notification.idType, "charid");
  assert.equal(getNotificationDictEntry(notification, "itemID"), asteroid.itemID);
  assert.equal(getNotificationDictEntry(notification, "quantity_added"), minedQuantity);
  assert.equal(getNotificationDictEntry(notification, "quantity_removed"), minedQuantity);
  assert.equal(getNotificationDictEntry(notification, "oreType"), state.yieldTypeID);
  assert.equal(getNotificationDictEntry(notification, "oreGroupID"), oreType.groupID);
  assert.equal(getNotificationDictEntry(notification, "moduleItemID"), moduleItem.itemID);
  assert.equal(getNotificationDictEntry(notification, "moduleTypeID"), moduleType.typeID);
  assert.equal(getNotificationDictEntry(notification, "moduleGroupID"), moduleType.groupID);
  assert.equal(getNotificationDictEntry(notification, "shipID"), sourceEntity.itemID);
  assert.equal(getNotificationDictEntry(notification, "shipTypeID"), shipType.typeID);
  assert.equal(getNotificationDictEntry(notification, "shipGroupID"), shipType.groupID);
  assert.equal(getNotificationDictEntry(notification, "charID"), sourceEntity.characterID);
  assert.equal(getNotificationDictEntry(notification, "solarsystemID"), systemID);
  assert.equal(getNotificationDictEntry(notification, "solarSystemFactionID"), 500001);
  assert.equal(getNotificationDictEntry(notification, "amountWasted"), 0);
  assert.equal(getNotificationDictEntry(notification, "amountCritBonus"), 0);
  assert.equal(getNotificationDictEntry(notification, "hasRewards"), false);

  resetMiningTestState(systemID);
});

test("resetSceneMiningState clears depletion and deterministically rebuilds asteroid belts", () => {
  const systemID = pickAsteroidBeltSystem();
  resetMiningTestState(systemID);

  const scene = runtime.ensureScene(systemID);
  const asteroid = scene.staticEntities.find((entity) => entity.kind === "asteroid");
  assert.ok(asteroid, "expected at least one generated asteroid");

  const initialState = getMineableState(scene, asteroid.itemID);
  assert.ok(initialState, "expected initial mining state");
  const depletionResult = applyMiningDelta(
    scene,
    asteroid,
    initialState.remainingQuantity,
    0,
    {
      broadcast: false,
      nowMs: scene.getCurrentSimTimeMs(),
    },
  );
  assert.equal(depletionResult.success, true, "expected mining depletion to succeed");
  assert.equal(
    scene.getEntityByID(asteroid.itemID),
    null,
    "expected depleted asteroid to be removed from the scene",
  );

  const resetResult = resetSceneMiningState(scene, {
    rebuildAsteroids: true,
    broadcast: false,
    nowMs: scene.getCurrentSimTimeMs(),
  });
  assert.equal(resetResult.success, true, "expected mining state reset to succeed");
  assert.ok(
    resetResult.data &&
      resetResult.data.summary &&
      resetResult.data.summary.activeCount > 0,
    "expected reset to restore active mineables",
  );

  const respawnedAsteroid = scene.getEntityByID(asteroid.itemID);
  assert.ok(respawnedAsteroid, "expected deterministic asteroid entity IDs after reset");
  const respawnedState = getMineableState(scene, asteroid.itemID);
  assert.ok(respawnedState, "expected respawned asteroid to have mining state");
  assert.equal(
    respawnedState.remainingQuantity,
    respawnedState.originalQuantity,
    "expected reset asteroid to respawn at full quantity",
  );

  resetMiningTestState(systemID);
});

test("fresh belt-bearing scene bootstrap does not start fully depleted", () => {
  const systemID = 30000145;
  resetMiningTestState(systemID);

  const scene = runtime.ensureScene(systemID);
  const summary = summarizeSceneMiningState(scene);
  assert.ok(summary, "expected mining summary for belt-bearing system");
  assert.ok(summary.activeAsteroidEntityCount > 0, "expected live asteroid entities on fresh scene bootstrap");
  assert.ok(summary.activeCount > 0, "expected active mineables on fresh scene bootstrap");
  assert.equal(summary.depletedCount, 0, "fresh scene bootstrap should not start depleted");
  const asteroidYieldNames = scene.staticEntities
    .filter((entity) => String(entity && entity.kind || "").toLowerCase() === "asteroid")
    .map((entity) => getMineableState(scene, entity.itemID))
    .filter(Boolean)
    .map((state) => resolveItemByTypeID(state.yieldTypeID))
    .filter(Boolean)
    .map((typeRecord) => String(typeRecord.name || ""));
  assert.ok(
    asteroidYieldNames.some((name) => name.includes("II-Grade") || name.includes("III-Grade") || name.includes("IV-Grade")),
    "expected fresh generated belts to include at least one graded ore variant",
  );

  resetMiningTestState(systemID);
});
