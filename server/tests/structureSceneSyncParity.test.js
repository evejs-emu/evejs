const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));
const structureState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureState",
));
const {
  STRUCTURE_STATE,
  STRUCTURE_SERVICE_ID,
  STRUCTURE_SERVICE_STATE,
  STRUCTURE_UPKEEP_STATE,
} = require(path.join(
  repoRoot,
  "server/src/services/structure/structureConstants",
));
const {
  resetInventoryStoreForTests,
} = require(path.join(repoRoot, "server/src/services/inventory/itemStore"));

const TEST_SYSTEM_ID = 30000142;

function readTable(tableName) {
  const result = database.read(tableName, "/");
  assert.equal(result.success, true, `Failed to read ${tableName}`);
  return result.data;
}

function writeTable(tableName, payload) {
  const result = database.write(tableName, "/", payload);
  assert.equal(result.success, true, `Failed to write ${tableName}`);
}

function createFakeSession(clientID, characterID, position) {
  const notifications = [];
  const serviceNotifications = [];
  return {
    clientID,
    characterID,
    charID: characterID,
    corporationID: 1000009,
    corpid: 1000009,
    allianceID: 0,
    allianceid: 0,
    solarsystemid: TEST_SYSTEM_ID,
    solarsystemid2: TEST_SYSTEM_ID,
    socket: { destroyed: false },
    notifications,
    serviceNotifications,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendServiceNotification(serviceName, methodName, payload) {
      serviceNotifications.push({ serviceName, methodName, payload });
    },
    shipItem: {
      itemID: clientID + 100000,
      typeID: 606,
      ownerID: characterID,
      groupID: 25,
      categoryID: 6,
      radius: 50,
      spaceState: {
        position,
        velocity: { x: 0, y: 0, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
        mode: "STOP",
        speedFraction: 0,
      },
    },
  };
}

function attachAndBootstrap(session) {
  const entity = spaceRuntime.attachSession(session, session.shipItem, {
    systemID: TEST_SYSTEM_ID,
    broadcast: false,
    spawnStopped: true,
  });
  assert.ok(entity, "Expected the test ship to attach to space runtime");
  assert.equal(
    spaceRuntime.ensureInitialBallpark(session),
    true,
    "Expected test session to finish initial ballpark bootstrap",
  );
  session.notifications.length = 0;
  return entity;
}

function flattenDestinyUpdates(notifications = []) {
  const updates = [];
  for (const notification of notifications) {
    if (
      !notification ||
      notification.name !== "DoDestinyUpdate" ||
      !Array.isArray(notification.payload)
    ) {
      continue;
    }

    const payloadList = notification.payload[0];
    const entries = Array.isArray(payloadList && payloadList.items)
      ? payloadList.items
      : [];
    for (const entry of entries) {
      const payload = Array.isArray(entry) ? entry[1] : null;
      if (!Array.isArray(payload) || typeof payload[0] !== "string") {
        continue;
      }
      updates.push({
        stamp: Array.isArray(entry) ? entry[0] : null,
        name: payload[0],
        args: Array.isArray(payload[1]) ? payload[1] : [],
      });
    }
  }
  return updates;
}

function getMarshalDictEntry(value, key) {
  if (!value || value.type !== "dict" || !Array.isArray(value.entries)) {
    return undefined;
  }
  const entry = value.entries.find(
    (candidate) => Array.isArray(candidate) && candidate[0] === key,
  );
  return entry ? entry[1] : undefined;
}

function getAddBalls2EntityIDs(update) {
  if (!update || update.name !== "AddBalls2" || !Array.isArray(update.args)) {
    return [];
  }

  const entityIDs = [];
  for (const batchEntry of update.args) {
    const slimEntries = Array.isArray(batchEntry) ? batchEntry[1] : null;
    const normalizedSlimEntries = Array.isArray(slimEntries)
      ? slimEntries
      : slimEntries &&
          slimEntries.type === "list" &&
          Array.isArray(slimEntries.items)
        ? slimEntries.items
        : [];
    for (const slimEntry of normalizedSlimEntries) {
      const slimItem = Array.isArray(slimEntry) ? slimEntry[0] : slimEntry;
      const itemID = Number(
        slimItem && typeof slimItem === "object" && "itemID" in slimItem
          ? slimItem.itemID
          : getMarshalDictEntry(slimItem, "itemID"),
      );
      if (Number.isFinite(itemID) && itemID > 0) {
        entityIDs.push(itemID);
      }
    }
  }
  return entityIDs;
}

function getRemoveBallsEntityIDs(update) {
  if (!update || update.name !== "RemoveBalls" || !Array.isArray(update.args)) {
    return [];
  }

  const firstArg = update.args[0];
  if (Array.isArray(firstArg)) {
    return firstArg.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry));
  }
  if (firstArg && firstArg.type === "list" && Array.isArray(firstArg.items)) {
    return firstArg.items
      .map((entry) => Number(entry))
      .filter((entry) => Number.isFinite(entry));
  }
  return [];
}

function getTerminalDestructionEffectEntityIDs(update) {
  if (
    !update ||
    update.name !== "TerminalPlayDestructionEffect" ||
    !Array.isArray(update.args)
  ) {
    return [];
  }

  const entityID = Number(update.args[0]);
  return Number.isFinite(entityID) && entityID > 0 ? [entityID] : [];
}


function normalizeSlimValue(value) {
  if (value && typeof value === "object" && value.type === "object") {
    return value.args || null;
  }
  return value;
}

function getSlimItemForEntityFromUpdates(updates = [], entityID) {
  const numericEntityID = Number(entityID);
  for (const update of updates) {
    if (!update) {
      continue;
    }
    if (update.name === "OnSlimItemChange" && Number(update.args && update.args[0]) === numericEntityID) {
      return normalizeSlimValue(update.args && update.args[1]);
    }
    if (update.name !== "AddBalls2" || !Array.isArray(update.args)) {
      continue;
    }
    for (const batchEntry of update.args) {
      const slimEntries = Array.isArray(batchEntry) ? batchEntry[1] : null;
      const normalizedSlimEntries = Array.isArray(slimEntries)
        ? slimEntries
        : slimEntries &&
            slimEntries.type === "list" &&
            Array.isArray(slimEntries.items)
          ? slimEntries.items
          : [];
      for (const slimEntry of normalizedSlimEntries) {
        const slimItem = normalizeSlimValue(Array.isArray(slimEntry) ? slimEntry[0] : slimEntry);
        const itemID = Number(
          slimItem && typeof slimItem === "object" && "itemID" in slimItem
            ? slimItem.itemID
            : getMarshalDictEntry(slimItem, "itemID"),
        );
        if (itemID === numericEntityID) {
          return slimItem;
        }
      }
    }
  }
  return null;
}

function getDamageStateForEntityFromUpdates(updates = [], entityID) {
  const numericEntityID = Number(entityID);
  return (
    updates.find(
      (entry) =>
        entry &&
        entry.name === "OnDamageStateChange" &&
        Number(entry.args && entry.args[0]) === numericEntityID,
    ) || null
  );
}

test.afterEach(() => {
  spaceRuntime._testing.clearScenes();
  structureState.clearStructureCaches();
});

test("structure scene sync keeps static structures out of dynamic visibility removal tracking", (t) => {
  const structuresBackup = readTable("structures");
  t.after(() => {
    writeTable("structures", structuresBackup);
    structureState.clearStructureCaches();
  });

  const session = createFakeSession(
    984001,
    994001,
    { x: -107303362560, y: -18744975360, z: 436489052160 },
  );
  attachAndBootstrap(session);

  const createResult = structureState.createStructure({
    typeID: 35832,
    name: "Scene Sync Test Astrahus",
    itemName: "Scene Sync Test Astrahus",
    ownerCorpID: session.corporationID,
    solarSystemID: TEST_SYSTEM_ID,
    position: { x: -107303242560, y: -18744975360, z: 436489052160 },
    state: 1,
    upkeepState: 1,
    accessProfile: {
      docking: "public",
      tethering: "public",
    },
    serviceStates: {
      "1": 1,
    },
  });
  assert.equal(createResult.success, true, "Expected structure creation to succeed");
  const structureID = Number(createResult.data.structureID);

  const syncResult = spaceRuntime.syncStructureSceneState(TEST_SYSTEM_ID);
  assert.equal(syncResult.success, true, "Expected structure scene sync to succeed");

  const immediateUpdates = flattenDestinyUpdates(session.notifications);
  assert.equal(
    immediateUpdates.some(
      (entry) => entry.name === "AddBalls2" && getAddBalls2EntityIDs(entry).includes(structureID),
    ),
    true,
    "Expected structure scene sync to broadcast an AddBalls2 acquire for the new structure",
  );
  assert.equal(
    session._space.visibleDynamicEntityIDs.has(structureID),
    false,
    "Expected static structures not to be inserted into dynamic visibility tracking",
  );

  session.notifications.length = 0;
  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  scene.tick(
    scene.getCurrentWallclockMs() + spaceRuntime._testing.RUNTIME_TICK_INTERVAL_MS,
  );

  const followUpUpdates = flattenDestinyUpdates(session.notifications);
  assert.equal(
    followUpUpdates.some(
      (entry) => getRemoveBallsEntityIDs(entry).includes(structureID),
    ),
    false,
    "Expected the next visibility sync tick not to remove the freshly seeded static structure",
  );
});

test("structure scene sync sends RemoveBalls immediately when a persisted structure is removed", (t) => {
  const structuresBackup = readTable("structures");
  t.after(() => {
    writeTable("structures", structuresBackup);
    structureState.clearStructureCaches();
  });

  const session = createFakeSession(
    984101,
    994101,
    { x: -107303362560, y: -18744975360, z: 436489052160 },
  );
  attachAndBootstrap(session);

  const createResult = structureState.createStructure({
    typeID: 35832,
    name: "Scene Remove Test Astrahus",
    itemName: "Scene Remove Test Astrahus",
    ownerCorpID: session.corporationID,
    solarSystemID: TEST_SYSTEM_ID,
    position: { x: -107303242560, y: -18744975360, z: 436489052160 },
    state: 1,
    upkeepState: 1,
    accessProfile: {
      docking: "public",
      tethering: "public",
    },
    serviceStates: {
      "1": 1,
    },
  });
  assert.equal(createResult.success, true, "Expected structure creation to succeed");
  const structureID = Number(createResult.data.structureID);

  const initialSyncResult = spaceRuntime.syncStructureSceneState(TEST_SYSTEM_ID);
  assert.equal(initialSyncResult.success, true, "Expected structure scene sync to succeed");
  session.notifications.length = 0;

  const removeResult = structureState.removeStructure(structureID);
  assert.equal(removeResult.success, true, "Expected persisted structure removal to succeed");

  const removalSyncResult = spaceRuntime.syncStructureSceneState(TEST_SYSTEM_ID);
  assert.equal(removalSyncResult.success, true, "Expected removal scene sync to succeed");

  const removalUpdates = flattenDestinyUpdates(session.notifications);
  assert.equal(
    removalUpdates.some(
      (entry) => getRemoveBallsEntityIDs(entry).includes(structureID),
    ),
    true,
    "Expected structure removal to broadcast RemoveBalls immediately to active sessions",
  );

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  assert.equal(
    scene.staticEntitiesByID.has(structureID),
    false,
    "Expected the removed structure to be gone from the active static scene state",
  );
});

test("structure scene sync sends terminal destruction FX before removing a destroyed structure", (t) => {
  const structuresBackup = readTable("structures");
  t.after(() => {
    writeTable("structures", structuresBackup);
    structureState.clearStructureCaches();
  });

  const session = createFakeSession(
    984151,
    994151,
    { x: -107303362560, y: -18744975360, z: 436489052160 },
  );
  attachAndBootstrap(session);

  const createResult = structureState.createStructure({
    typeID: 35832,
    name: "Scene Destroy FX Test Astrahus",
    itemName: "Scene Destroy FX Test Astrahus",
    ownerCorpID: session.corporationID,
    solarSystemID: TEST_SYSTEM_ID,
    position: { x: -107303242560, y: -18744975360, z: 436489052160 },
    state: STRUCTURE_STATE.SHIELD_VULNERABLE,
    upkeepState: STRUCTURE_UPKEEP_STATE.FULL_POWER,
    hasQuantumCore: false,
    accessProfile: {
      docking: "public",
      tethering: "public",
    },
    serviceStates: {
      "1": 1,
    },
  });
  assert.equal(createResult.success, true, "Expected structure creation to succeed");
  const structureID = Number(createResult.data.structureID);

  const initialSyncResult = spaceRuntime.syncStructureSceneState(TEST_SYSTEM_ID);
  assert.equal(initialSyncResult.success, true, "Expected structure scene sync to succeed");
  session.notifications.length = 0;

  const destroyResult = structureState.destroyStructure(structureID, {
    skipAssetSafety: true,
  });
  assert.equal(destroyResult.success, true, "Expected structure destruction to succeed");
  const wreckID =
    Number(
      destroyResult.data &&
      destroyResult.data.loot &&
      destroyResult.data.loot.wreck &&
      destroyResult.data.loot.wreck.itemID,
    ) || 0;
  assert.ok(wreckID > 0, "Expected structure destruction to create a persisted wreck item");

  const destructionSyncResult = spaceRuntime.syncStructureSceneState(TEST_SYSTEM_ID);
  assert.equal(
    destructionSyncResult.success,
    true,
    "Expected destruction scene sync to succeed",
  );

  const destructionUpdates = flattenDestinyUpdates(session.notifications);
  const terminalIndex = destructionUpdates.findIndex(
    (entry) => getTerminalDestructionEffectEntityIDs(entry).includes(structureID),
  );
  const removeIndex = destructionUpdates.findIndex(
    (entry) => getRemoveBallsEntityIDs(entry).includes(structureID),
  );
  const wreckAddIndex = destructionUpdates.findIndex(
    (entry) => entry.name === "AddBalls2" && getAddBalls2EntityIDs(entry).includes(wreckID),
  );

  assert.notEqual(
    terminalIndex,
    -1,
    "Expected destroyed structures to emit TerminalPlayDestructionEffect before removal",
  );
  assert.notEqual(
    removeIndex,
    -1,
    "Expected destroyed structures to emit RemoveBalls after the destruction effect",
  );
  assert.ok(
    terminalIndex <= removeIndex,
    "Expected destruction FX to be queued before or alongside RemoveBalls",
  );
  assert.notEqual(
    wreckAddIndex,
    -1,
    "Expected destroyed structures to spawn their wreck into the active scene",
  );
  assert.ok(
    removeIndex <= wreckAddIndex,
    "Expected the structure wreck to appear after the explosion/removal handshake",
  );

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  assert.equal(
    scene.staticEntitiesByID.has(structureID),
    false,
    "Expected the destroyed structure to be gone from the active static scene state",
  );
  assert.ok(
    scene.dynamicEntities.has(wreckID),
    "Expected the destroyed structure wreck to be present in the active dynamic scene state",
  );
});

test("removeStructure evacuates docked occupants instead of orphaning them under the removed structure ID", (t) => {
  const structuresBackup = readTable("structures");
  const charactersBackup = readTable("characters");
  const itemsBackup = readTable("items");
  t.after(() => {
    writeTable("structures", structuresBackup);
    writeTable("characters", charactersBackup);
    writeTable("items", itemsBackup);
    resetInventoryStoreForTests();
    structureState.clearStructureCaches();
  });

  const createResult = structureState.createStructure({
    typeID: 35832,
    name: "Removal Recovery Test Astrahus",
    itemName: "Removal Recovery Test Astrahus",
    ownerCorpID: 1000009,
    solarSystemID: TEST_SYSTEM_ID,
    position: { x: -107303242560, y: -18744975360, z: 436489052160 },
    state: STRUCTURE_STATE.SHIELD_VULNERABLE,
    upkeepState: STRUCTURE_UPKEEP_STATE.FULL_POWER,
    accessProfile: {
      docking: "public",
      tethering: "public",
    },
    serviceStates: {
      "1": 1,
    },
  });
  assert.equal(createResult.success, true, "Expected structure creation to succeed");
  const structureID = Number(createResult.data.structureID);

  const characterID = 899991001;
  const shipID = 899991101;
  writeTable("characters", {
    ...(charactersBackup || {}),
    [String(characterID)]: {
      characterName: "Removal Recovery Pilot",
      corporationID: 1000009,
      solarSystemID: TEST_SYSTEM_ID,
      constellationID: 20000020,
      regionID: 10000002,
      stationID: null,
      structureID,
      shipID,
      shipTypeID: 606,
      shipName: "Velator",
    },
  });
  writeTable("items", {
    ...(itemsBackup || {}),
    [String(shipID)]: {
      itemID: shipID,
      typeID: 606,
      ownerID: characterID,
      locationID: structureID,
      flagID: 4,
      quantity: -1,
      stacksize: 1,
      singleton: 1,
      groupID: 237,
      categoryID: 6,
      customInfo: "",
      itemName: "Velator",
      mass: 1148000,
      volume: 24500,
      capacity: 135,
      radius: 40,
      spaceState: null,
      conditionState: {
        damage: 0,
        charge: 1,
        armorDamage: 0,
        shieldCharge: 1,
        incapacitated: false,
      },
    },
  });
  resetInventoryStoreForTests();

  const removeResult = structureState.removeStructure(structureID, {
    nowMs: 1774377100000,
  });
  assert.equal(removeResult.success, true, "Expected structure removal to evacuate the docked pilot and then succeed");

  const characterResult = database.read("characters", `/${characterID}`);
  assert.equal(characterResult.success, true, "Expected evacuated character row to remain readable");
  assert.equal(characterResult.data.stationID, null, "Expected evacuated character not to be left at a station");
  assert.equal(characterResult.data.structureID, null, "Expected evacuated character not to remain docked in the removed structure");
  assert.equal(characterResult.data.solarSystemID, TEST_SYSTEM_ID, "Expected evacuated character to remain in the structure's system");

  const shipResult = database.read("items", `/${shipID}`);
  assert.equal(shipResult.success, true, "Expected evacuated ship row to remain readable");
  assert.equal(shipResult.data.locationID, TEST_SYSTEM_ID, "Expected evacuated ship to be moved back into system space");
  assert.equal(shipResult.data.flagID, 0, "Expected evacuated ship to be returned to a space flag");
  assert.ok(shipResult.data.spaceState, "Expected evacuated ship to receive a space state");

  assert.equal(
    structureState.getStructureByID(structureID, { refresh: true }),
    null,
    "Expected the removed structure row to be gone after the evacuation succeeds",
  );
});

test("structure slim payloads include CCP-style state, upkeep, and timer fields", (t) => {
  const structuresBackup = readTable("structures");
  t.after(() => {
    writeTable("structures", structuresBackup);
    structureState.clearStructureCaches();
  });

  const session = createFakeSession(
    984201,
    994201,
    { x: -107303362560, y: -18744975360, z: 436489052160 },
  );
  attachAndBootstrap(session);

  const createResult = structureState.createStructure({
    typeID: 35832,
    name: "Scene Slim Test Astrahus",
    itemName: "Scene Slim Test Astrahus",
    ownerCorpID: session.corporationID,
    solarSystemID: TEST_SYSTEM_ID,
    position: { x: -107303242560, y: -18744975360, z: 436489052160 },
    state: STRUCTURE_STATE.UNANCHORED,
    upkeepState: STRUCTURE_UPKEEP_STATE.FULL_POWER,
    accessProfile: {
      docking: "public",
      tethering: "public",
    },
    serviceStates: {
      "1": 1,
    },
  });
  assert.equal(createResult.success, true, "Expected structure creation to succeed");
  const structureID = Number(createResult.data.structureID);

  let syncResult = spaceRuntime.syncStructureSceneState(TEST_SYSTEM_ID);
  assert.equal(syncResult.success, true, "Expected initial structure scene sync to succeed");

  let updates = flattenDestinyUpdates(session.notifications);
  let slimItem = getSlimItemForEntityFromUpdates(updates, structureID);
  assert.ok(slimItem, "Expected AddBalls2 to include a slim item for the structure");
  assert.equal(
    getMarshalDictEntry(slimItem, "state"),
    STRUCTURE_STATE.UNANCHORED,
    "Expected newly seeded structures to expose their unanchored state in slim payloads",
  );
  assert.equal(
    getMarshalDictEntry(slimItem, "upkeepState"),
    STRUCTURE_UPKEEP_STATE.FULL_POWER,
    "Expected slim payloads to include the structure upkeep state",
  );
  assert.equal(
    getMarshalDictEntry(slimItem, "deedState"),
    0,
    "Expected no-core structures to advertise deed/core absence to the client",
  );
  assert.equal(
    getMarshalDictEntry(slimItem, "repairing"),
    null,
    "Expected seeded structures not to advertise repairing unless a repair cycle is actually active",
  );

  session.notifications.length = 0;
  const anchorResult = structureState.startAnchoring(structureID);
  assert.equal(anchorResult.success, true, "Expected anchoring to start");

  syncResult = spaceRuntime.syncStructureSceneState(TEST_SYSTEM_ID);
  assert.equal(syncResult.success, true, "Expected anchoring scene sync to succeed");

  updates = flattenDestinyUpdates(session.notifications);
  slimItem = getSlimItemForEntityFromUpdates(updates, structureID);
  assert.ok(slimItem, "Expected anchoring update to include a structure slim item");
  assert.equal(
    getMarshalDictEntry(slimItem, "state"),
    STRUCTURE_STATE.ANCHOR_VULNERABLE,
    "Expected anchoring updates to expose the current structure state",
  );
  const anchorTimer = getMarshalDictEntry(slimItem, "timer");
  assert.ok(anchorTimer && anchorTimer.type === "list", "Expected structure timer data in slim payloads");
  assert.equal(anchorTimer.items.length, 3, "Expected structure timer tuples to have start/end/pause slots");

  session.notifications.length = 0;
  const ffResult = structureState.fastForwardStructure(structureID, 1000);
  assert.equal(ffResult.success, true, "Expected anchoring fast-forward to succeed");

  syncResult = spaceRuntime.syncStructureSceneState(TEST_SYSTEM_ID);
  assert.equal(syncResult.success, true, "Expected post-fast-forward structure scene sync to succeed");

  updates = flattenDestinyUpdates(session.notifications);
  slimItem = getSlimItemForEntityFromUpdates(updates, structureID);
  assert.ok(slimItem, "Expected post-fast-forward update to include a structure slim item");
  assert.equal(
    getMarshalDictEntry(slimItem, "state"),
    STRUCTURE_STATE.ANCHORING,
    "Expected structure slim payloads to advance into anchoring once the vulnerable timer expires",
  );
  const anchoringTimer = getMarshalDictEntry(slimItem, "timer");
  assert.ok(
    anchoringTimer &&
      anchoringTimer.type === "list" &&
      anchoringTimer.items[0] &&
      anchoringTimer.items[0].type === "long" &&
      anchoringTimer.items[1] &&
      anchoringTimer.items[1].type === "long",
    "Expected anchoring slim payloads to carry filetime timer start/end values",
  );

  session.notifications.length = 0;
  const finishAnchoringResult = structureState.fastForwardStructure(structureID, 86400);
  assert.equal(finishAnchoringResult.success, true, "Expected anchoring completion fast-forward to succeed");

  syncResult = spaceRuntime.syncStructureSceneState(TEST_SYSTEM_ID);
  assert.equal(syncResult.success, true, "Expected missing-core onlining scene sync to succeed");

  updates = flattenDestinyUpdates(session.notifications);
  slimItem = getSlimItemForEntityFromUpdates(updates, structureID);
  assert.ok(slimItem, "Expected missing-core onlining update to include a structure slim item");
  assert.equal(
    getMarshalDictEntry(slimItem, "state"),
    STRUCTURE_STATE.ONLINING_VULNERABLE,
    "Expected completed anchoring to advance into onlining-vulnerable even when the core is missing",
  );
  assert.equal(
    getMarshalDictEntry(slimItem, "deedState"),
    0,
    "Expected missing-core onlining structures to keep deedState false",
  );
  assert.equal(
    getMarshalDictEntry(slimItem, "timer"),
    null,
    "Expected missing-core onlining structures not to advertise a repair timer",
  );

  session.notifications.length = 0;
  const coreResult = structureState.setStructureQuantumCoreInstalled(structureID, true);
  assert.equal(coreResult.success, true, "Expected installing the quantum core to succeed");

  syncResult = spaceRuntime.syncStructureSceneState(TEST_SYSTEM_ID);
  assert.equal(syncResult.success, true, "Expected core-installed onlining scene sync to succeed");

  updates = flattenDestinyUpdates(session.notifications);
  slimItem = getSlimItemForEntityFromUpdates(updates, structureID);
  assert.ok(slimItem, "Expected core-installed onlining update to include a structure slim item");
  assert.equal(
    getMarshalDictEntry(slimItem, "state"),
    STRUCTURE_STATE.ONLINING_VULNERABLE,
    "Expected installing a core to leave the structure in onlining-vulnerable while repairing",
  );
  assert.equal(
    getMarshalDictEntry(slimItem, "deedState"),
    1,
    "Expected core-installed structures to advertise deedState true",
  );
  const onliningTimer = getMarshalDictEntry(slimItem, "timer");
  assert.ok(
    onliningTimer &&
      onliningTimer.type === "list" &&
      onliningTimer.items[0] &&
      onliningTimer.items[1],
    "Expected core-installed onlining structures to advertise the final repair timer",
  );

  session.notifications.length = 0;
  const finishOnliningResult = structureState.fastForwardStructure(structureID, 901);
  assert.equal(finishOnliningResult.success, true, "Expected onlining completion fast-forward to succeed");

  syncResult = spaceRuntime.syncStructureSceneState(TEST_SYSTEM_ID);
  assert.equal(syncResult.success, true, "Expected online structure scene sync to succeed");

  updates = flattenDestinyUpdates(session.notifications);
  slimItem = getSlimItemForEntityFromUpdates(updates, structureID);
  assert.ok(slimItem, "Expected online update to include a structure slim item");
  assert.equal(
    getMarshalDictEntry(slimItem, "state"),
    STRUCTURE_STATE.SHIELD_VULNERABLE,
    "Expected final onlining timer completion to make the structure online/shield-vulnerable",
  );
  assert.equal(
    getMarshalDictEntry(slimItem, "timer"),
    null,
    "Expected online structures to clear the onlining timer",
  );
});

test("structure state changes live-push core timer and completed repair to exterior clients", (t) => {
  const structuresBackup = readTable("structures");
  t.after(() => {
    writeTable("structures", structuresBackup);
    structureState.clearStructureCaches();
  });

  const session = createFakeSession(
    984451,
    994451,
    { x: -107303250000, y: -18744975360, z: 436489052160 },
  );
  attachAndBootstrap(session);

  const createResult = structureState.createStructure({
    typeID: 35832,
    name: "Scene Core Live Push Astrahus",
    itemName: "Scene Core Live Push Astrahus",
    ownerCorpID: session.corporationID,
    solarSystemID: TEST_SYSTEM_ID,
    position: { x: -107303242560, y: -18744975360, z: 436489052160 },
    state: STRUCTURE_STATE.ONLINING_VULNERABLE,
    upkeepState: STRUCTURE_UPKEEP_STATE.FULL_POWER,
    hasQuantumCore: false,
    quantumCoreItemTypeID: 56203,
    conditionState: {
      damage: 0,
      charge: 1,
      armorDamage: 0,
      shieldCharge: 0,
      incapacitated: false,
    },
    accessProfile: {
      docking: "public",
      tethering: "public",
    },
    serviceStates: {
      "1": 1,
    },
  });
  assert.equal(createResult.success, true, "Expected structure creation to succeed");
  const structureID = Number(createResult.data.structureID);

  const syncResult = spaceRuntime.syncStructureSceneState(TEST_SYSTEM_ID);
  assert.equal(syncResult.success, true, "Expected initial structure scene sync to succeed");
  session.notifications.length = 0;

  const coreResult = structureState.setStructureQuantumCoreInstalled(structureID, true);
  assert.equal(coreResult.success, true, "Expected quantum core install to succeed");

  let updates = flattenDestinyUpdates(session.notifications);
  let slimItem = getSlimItemForEntityFromUpdates(updates, structureID);
  assert.ok(slimItem, "Expected core install to live-push a slim-item update");
  assert.equal(getMarshalDictEntry(slimItem, "state"), STRUCTURE_STATE.ONLINING_VULNERABLE);
  assert.equal(getMarshalDictEntry(slimItem, "deedState"), 1);
  assert.ok(
    getMarshalDictEntry(slimItem, "timer"),
    "Expected core install to live-push the 15-minute onlining repair timer",
  );

  session.notifications.length = 0;
  const fastForwardResult = structureState.fastForwardStructure(structureID, 901);
  assert.equal(fastForwardResult.success, true, "Expected timer fast-forward to succeed");

  updates = flattenDestinyUpdates(session.notifications);
  slimItem = getSlimItemForEntityFromUpdates(updates, structureID);
  assert.ok(slimItem, "Expected timer completion to live-push a slim-item update");
  assert.equal(getMarshalDictEntry(slimItem, "state"), STRUCTURE_STATE.SHIELD_VULNERABLE);
  assert.equal(getMarshalDictEntry(slimItem, "timer"), null);

  const damageStateUpdate = getDamageStateForEntityFromUpdates(updates, structureID);
  assert.ok(
    damageStateUpdate,
    "Expected final onlining repair to live-push full defensive layers",
  );
  assert.equal(Number(damageStateUpdate.args[1][0][0].value), 1);

  const finalStructure = structureState.getStructureByID(structureID, {
    refresh: false,
  });
  assert.equal(finalStructure.conditionState.shieldCharge, 1);
  assert.equal(finalStructure.conditionState.armorDamage, 0);
  assert.equal(finalStructure.conditionState.damage, 0);
});

test("structure service state changes refresh the docked client service cache", (t) => {
  const structuresBackup = readTable("structures");
  t.after(() => {
    sessionRegistry.unregister(session);
    writeTable("structures", structuresBackup);
    structureState.clearStructureCaches();
  });

  const session = createFakeSession(
    984452,
    994452,
    { x: -107303250000, y: -18744975360, z: 436489052160 },
  );
  const createResult = structureState.createStructure({
    typeID: 35832,
    name: "Scene Service Cache Astrahus",
    itemName: "Scene Service Cache Astrahus",
    ownerCorpID: session.corporationID,
    solarSystemID: TEST_SYSTEM_ID,
    position: { x: -107303242560, y: -18744975360, z: 436489052160 },
    state: STRUCTURE_STATE.SHIELD_VULNERABLE,
    upkeepState: STRUCTURE_UPKEEP_STATE.LOW_POWER,
    hasQuantumCore: true,
    quantumCoreItemTypeID: 56203,
    accessProfile: {
      docking: "public",
      tethering: "public",
    },
    serviceStates: {
      [String(STRUCTURE_SERVICE_ID.MARKET)]: STRUCTURE_SERVICE_STATE.OFFLINE,
    },
  });
  assert.equal(createResult.success, true, "Expected structure creation to succeed");
  const structureID = Number(createResult.data.structureID);

  session.structureID = structureID;
  session.structureid = structureID;
  session.locationID = structureID;
  session.locationid = structureID;
  sessionRegistry.register(session);

  session.notifications.length = 0;
  const updateResult = structureState.setStructureServiceState(
    structureID,
    STRUCTURE_SERVICE_ID.MARKET,
    STRUCTURE_SERVICE_STATE.ONLINE,
  );
  assert.equal(updateResult.success, true, "Expected service state update to succeed");

  assert.deepEqual(
    session.notifications.filter(
      (notification) =>
        notification.name === "OnStructureServiceChanged" &&
        notification.idType === "clientID",
    ),
    [
      {
        name: "OnStructureServiceChanged",
        idType: "clientID",
        payload: [structureID],
      },
    ],
    "Expected the docked client structureServices cache to be invalidated natively",
  );

  session.notifications.length = 0;
  const nonServiceUpdateResult = structureState.setStructureUpkeepState(
    structureID,
    STRUCTURE_UPKEEP_STATE.FULL_POWER,
  );
  assert.equal(nonServiceUpdateResult.success, true);
  assert.equal(
    session.notifications.filter(
      (notification) =>
        notification.name === "OnStructureServiceChanged" &&
        notification.idType === "clientID",
    ).length,
    0,
    "Expected non-service-only structure changes to skip the structureServices cache event",
  );
});

test("structure scene sync keeps damage-only health changes off the slim-item lane", (t) => {
  const structuresBackup = readTable("structures");
  t.after(() => {
    writeTable("structures", structuresBackup);
    structureState.clearStructureCaches();
  });

  const session = createFakeSession(
    984301,
    994301,
    { x: -107303362560, y: -18744975360, z: 436489052160 },
  );
  attachAndBootstrap(session);

  const createResult = structureState.createStructure({
    typeID: 35832,
    name: "Scene Damage Test Astrahus",
    itemName: "Scene Damage Test Astrahus",
    ownerCorpID: session.corporationID,
    solarSystemID: TEST_SYSTEM_ID,
    position: { x: -107303242560, y: -18744975360, z: 436489052160 },
    state: STRUCTURE_STATE.SHIELD_VULNERABLE,
    upkeepState: STRUCTURE_UPKEEP_STATE.FULL_POWER,
    accessProfile: {
      docking: "public",
      tethering: "public",
    },
    serviceStates: {
      "1": 1,
    },
  });
  assert.equal(createResult.success, true, "Expected structure creation to succeed");
  const structureID = Number(createResult.data.structureID);

  let syncResult = spaceRuntime.syncStructureSceneState(TEST_SYSTEM_ID);
  assert.equal(syncResult.success, true, "Expected initial structure scene sync to succeed");
  session.notifications.length = 0;

  const damageResult = structureState.applyAdminStructureDamage(structureID, "shield", 0.05);
  assert.equal(damageResult.success, true, "Expected GM structure damage to succeed");

  syncResult = spaceRuntime.syncStructureSceneState(TEST_SYSTEM_ID);
  assert.equal(syncResult.success, true, "Expected post-damage structure scene sync to succeed");

  const updates = flattenDestinyUpdates(session.notifications);
  assert.equal(
    updates.some(
      (entry) => entry.name === "OnSlimItemChange" && Number(entry.args && entry.args[0]) === structureID,
    ),
    false,
    "Expected damage-only structure health changes to stay off the OnSlimItemChange lane",
  );
  const damageStateUpdate = getDamageStateForEntityFromUpdates(updates, structureID);
  assert.ok(
    damageStateUpdate,
    "Expected damage-only structure health changes to broadcast OnDamageStateChange",
  );
  assert.equal(
    Number(damageStateUpdate.args[1][0][0].value),
    0.95,
    "Expected the broadcast damage state to carry the updated shield ratio",
  );
});

test("locking an already damaged structure replays current damage state to the target UI", (t) => {
  const structuresBackup = readTable("structures");
  t.after(() => {
    writeTable("structures", structuresBackup);
    structureState.clearStructureCaches();
  });

  const session = createFakeSession(
    984401,
    994401,
    { x: -107303250000, y: -18744975360, z: 436489052160 },
  );
  const sourceEntity = attachAndBootstrap(session);

  const createResult = structureState.createStructure({
    typeID: 35832,
    name: "Scene Target Replay Astrahus",
    itemName: "Scene Target Replay Astrahus",
    ownerCorpID: session.corporationID,
    solarSystemID: TEST_SYSTEM_ID,
    position: { x: -107303242560, y: -18744975360, z: 436489052160 },
    state: STRUCTURE_STATE.SHIELD_VULNERABLE,
    upkeepState: STRUCTURE_UPKEEP_STATE.FULL_POWER,
    conditionState: {
      damage: 0,
      charge: 1,
      armorDamage: 0,
      shieldCharge: 0.4,
      incapacitated: false,
    },
    accessProfile: {
      docking: "public",
      tethering: "public",
    },
    serviceStates: {
      "1": 1,
    },
  });
  assert.equal(createResult.success, true, "Expected structure creation to succeed");
  const structureID = Number(createResult.data.structureID);

  let syncResult = spaceRuntime.syncStructureSceneState(TEST_SYSTEM_ID);
  assert.equal(syncResult.success, true, "Expected initial structure scene sync to succeed");
  session.notifications.length = 0;

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const targetEntity = scene.staticEntitiesByID.get(structureID);
  assert.ok(targetEntity, "Expected the damaged structure to exist in the active scene");

  const lockResult = scene.finalizeTargetLock(sourceEntity, targetEntity, {
    nowMs: scene.getCurrentSimTimeMs(),
  });
  assert.equal(lockResult.success, true, "Expected target locking to succeed");

  const updates = flattenDestinyUpdates(session.notifications);
  const damageStateUpdate = getDamageStateForEntityFromUpdates(updates, structureID);
  assert.ok(
    damageStateUpdate,
    "Expected target locking to replay the structure's current damage state",
  );
  assert.equal(
    Number(damageStateUpdate.args[1][0][0].value),
    0.4,
    "Expected the target replay to carry the current shield ratio instead of full health",
  );
});
