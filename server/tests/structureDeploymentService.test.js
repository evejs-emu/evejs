const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const MachoNetService = require(path.join(
  repoRoot,
  "server/src/services/machoNet/machoNetService",
));
const StructureDeploymentService = require(path.join(
  repoRoot,
  "server/src/services/structure/structureDeploymentService",
));
const StructureDirectoryService = require(path.join(
  repoRoot,
  "server/src/services/structure/structureDirectoryService",
));
const CorpRegistryRuntimeService = require(path.join(
  repoRoot,
  "server/src/services/corporation/corpRegistryRuntime",
));
const structureState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureState",
));
const {
  NO_REINFORCEMENT_WEEKDAY,
  STRUCTURE_STATE,
} = require(path.join(repoRoot, "server/src/services/structure/structureConstants"));
const {
  ITEM_FLAGS,
  findItemById,
  grantItemToCharacterLocation,
  resetInventoryStoreForTests,
} = require(path.join(repoRoot, "server/src/services/inventory/itemStore"));
const {
  TYPE_INFRASTRUCTURE_HUB,
  TYPE_TERRITORIAL_CLAIM_UNIT,
} = require(path.join(repoRoot, "server/src/services/sovereignty/sovConstants"));
const {
  TYPE_ANSIBLEX_JUMP_BRIDGE,
} = require(path.join(repoRoot, "server/src/services/sovereignty/sovUpgradeSupport"));
const {
  getHubIDForSolarSystem,
  resetSovereigntyModernStateForTests,
} = require(path.join(repoRoot, "server/src/services/sovereignty/sovModernState"));
const {
  getSystemState,
  resetSovereigntyStateForTests,
  upsertSystemState,
} = require(path.join(repoRoot, "server/src/services/sovereignty/sovState"));
const {
  isSovereigntyClaimableSolarSystem,
} = require(path.join(repoRoot, "server/src/services/sovereignty/sovSystemRules"));
const worldData = require(path.join(repoRoot, "server/src/space/worldData"));

const TEST_CHARACTER_ID = 140000001;
const ASTRAHUS_TYPE_ID = 35832;
const KEEPSTAR_TYPE_ID = 35834;

function readTable(tableName) {
  const result = database.read(tableName, "/");
  assert.equal(result.success, true, `Failed to read ${tableName}`);
  return result.data;
}

function writeTable(tableName, payload) {
  const result = database.write(tableName, "/", payload);
  assert.equal(result.success, true, `Failed to write ${tableName}`);
}

function writeCleanSovereigntyTable(snapshot = {}) {
  writeTable("sovereignty", {
    ...(snapshot || {}),
    alliances: {},
    systems: {},
    hubs: {},
    skyhooks: {},
    mercenaryDens: {},
  });
}

function writeCleanStructuresTable(snapshot = {}) {
  writeTable("structures", {
    ...(snapshot || {}),
    _meta: {
      nextStructureID: 1030000000000,
      generatedAt: null,
      lastUpdatedAt: null,
      ...(snapshot && snapshot._meta ? snapshot._meta : {}),
    },
    structures: [],
  });
}

function buildSpaceSession(solarSystemID, shipID = 990000001) {
  const notifications = [];
  return {
    clientID: 880011,
    userid: TEST_CHARACTER_ID,
    characterID: TEST_CHARACTER_ID,
    charid: TEST_CHARACTER_ID,
    corporationID: 980090001,
    corpid: 980090001,
    allianceID: 990090001,
    allianceid: 990090001,
    corprole: 2048n,
    shipID,
    shipid: shipID,
    activeShipID: shipID,
    solarsystemid2: solarSystemID,
    solarsystemid: solarSystemID,
    _space: {
      shipID,
      systemID: solarSystemID,
    },
    _notifications: notifications,
    socket: { destroyed: false },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendServiceNotification() {},
  };
}

function buildLiveSpaceSession(
  solarSystemID,
  position,
  shipID = 990000001,
  shipTypeID = 606,
) {
  const session = buildSpaceSession(solarSystemID, shipID);
  session.shipItem = {
    itemID: shipID,
    typeID: shipTypeID,
    ownerID: session.characterID,
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
  };
  return session;
}

function attachAndBootstrapLiveSession(session) {
  const entity = spaceRuntime.attachSession(session, session.shipItem, {
    systemID: session.solarsystemid2,
    broadcast: false,
    spawnStopped: true,
  });
  assert.ok(entity, "Expected the live test ship to attach to space runtime");
  assert.equal(
    spaceRuntime.ensureInitialBallpark(session),
    true,
    "Expected the live test session to finish initial ballpark bootstrap",
  );
  session._notifications.length = 0;
  return entity;
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

function findClaimableSolarSystems(count = 2, predicate = null) {
  return worldData.getSolarSystems()
    .filter((solarSystem) => isSovereigntyClaimableSolarSystem(solarSystem))
    .filter((solarSystem) => (
      typeof predicate === "function" ? predicate(solarSystem) : true
    ))
    .slice(0, count)
    .map((solarSystem) => Number(solarSystem.solarSystemID));
}

function keyValEntriesToMap(payload) {
  assert.equal(payload && payload.name, "util.KeyVal");
  assert.equal(payload.args && payload.args.type, "dict");
  return new Map(payload.args.entries);
}

test.afterEach(() => {
  spaceRuntime._testing.clearScenes();
});

test("machoNet advertises structureDeployment for client routing", () => {
  const machoNet = new MachoNetService();
  const serviceInfo = new Map(machoNet.getServiceInfoDict().entries);

  assert.equal(serviceInfo.has("structureDeployment"), true);
  assert.equal(serviceInfo.get("structureDeployment"), null);
});

test("corp reinforce default matches the deployment UI tuple contract", () => {
  const session = buildSpaceSession(30005261);
  const corpRegistry = new CorpRegistryRuntimeService();

  const reinforceDefault = corpRegistry.Handle_GetStructureReinforceDefault(
    [],
    session,
  );

  assert.deepEqual(
    reinforceDefault,
    [NO_REINFORCEMENT_WEEKDAY, 20],
  );
});

test("structureDeployment anchors and unanchors a cargo TCU through sovereignty state", (t) => {
  const sovereigntyBackup = readTable("sovereignty");
  const structuresBackup = readTable("structures");
  const itemsBackup = readTable("items");
  t.after(() => {
    writeTable("sovereignty", sovereigntyBackup);
    writeTable("structures", structuresBackup);
    writeTable("items", itemsBackup);
    resetSovereigntyStateForTests();
    resetSovereigntyModernStateForTests();
    resetInventoryStoreForTests();
    structureState.clearStructureCaches();
  });

  writeCleanSovereigntyTable(sovereigntyBackup);
  writeCleanStructuresTable(structuresBackup);
  writeTable("items", itemsBackup);
  resetSovereigntyStateForTests();
  resetSovereigntyModernStateForTests();
  resetInventoryStoreForTests();
  structureState.clearStructureCaches();

  const [solarSystemID] = findClaimableSolarSystems(1);
  const session = buildSpaceSession(solarSystemID);
  const grantResult = grantItemToCharacterLocation(
    session.characterID,
    session._space.shipID,
    ITEM_FLAGS.CARGO_HOLD,
    { typeID: TYPE_TERRITORIAL_CLAIM_UNIT, name: "TCU Crate" },
    1,
    { singleton: 1 },
  );
  assert.equal(grantResult.success, true);
  const itemID = grantResult.data.items[0].itemID;

  const service = new StructureDeploymentService();
  assert.equal(findItemById(itemID) !== null, true);

  service.Handle_Anchor(
    [itemID, 12345, 67890, 0.25, 1, { type: "wstring", value: "Alpha Claim" }, "", 5, 18, {}],
    session,
  );

  assert.equal(findItemById(itemID), null, "Expected the cargo item to be consumed");
  const system = getSystemState(solarSystemID);
  assert.ok(system, "Expected sovereignty state for the deployed system");
  assert.ok(system.claimStructureID, "Expected a live TCU claim structure");
  const tcu = (system.structures || []).find(
    (structure) => Number(structure.typeID) === TYPE_TERRITORIAL_CLAIM_UNIT,
  );
  assert.ok(tcu, "Expected a TCU structure entry");
  assert.equal(tcu.name, "Alpha Claim");
  assert.equal(Number(tcu.position.x), 12345);
  assert.equal(Number(tcu.position.z), 67890);
  assert.equal(
    session._notifications.some((entry) => entry.name === "OnItemChange"),
    true,
    "Expected the deploying client to receive inventory removal feedback",
  );

  service.Handle_Unanchor([system.claimStructureID], session);
  const clearedSystem = getSystemState(solarSystemID);
  assert.equal(Number(clearedSystem.claimStructureID || 0), 0);
});

test("structureDeployment invalidates the modern hub cache when a cargo iHub is anchored", (t) => {
  const sovereigntyBackup = readTable("sovereignty");
  const structuresBackup = readTable("structures");
  const itemsBackup = readTable("items");
  t.after(() => {
    writeTable("sovereignty", sovereigntyBackup);
    writeTable("structures", structuresBackup);
    writeTable("items", itemsBackup);
    resetSovereigntyStateForTests();
    resetSovereigntyModernStateForTests();
    resetInventoryStoreForTests();
    structureState.clearStructureCaches();
  });

  writeCleanSovereigntyTable(sovereigntyBackup);
  writeCleanStructuresTable(structuresBackup);
  writeTable("items", itemsBackup);
  resetSovereigntyStateForTests();
  resetSovereigntyModernStateForTests();
  resetInventoryStoreForTests();
  structureState.clearStructureCaches();

  const [solarSystemID] = findClaimableSolarSystems(1);
  const session = buildSpaceSession(solarSystemID, 990000002);
  const service = new StructureDeploymentService();

  assert.equal(getHubIDForSolarSystem(solarSystemID), null, "Expected the modern hub cache to start empty");

  const grantResult = grantItemToCharacterLocation(
    session.characterID,
    session._space.shipID,
    ITEM_FLAGS.CARGO_HOLD,
    { typeID: TYPE_INFRASTRUCTURE_HUB, name: "iHub Crate" },
    1,
    { singleton: 1 },
  );
  assert.equal(grantResult.success, true);
  const itemID = grantResult.data.items[0].itemID;

  service.Handle_Anchor(
    [itemID, 20000, 30000, 0, 1, "Modern Hub", "", 5, 18, {}],
    session,
  );

  const system = getSystemState(solarSystemID);
  assert.ok(system.infrastructureHubID, "Expected an anchored iHub");
  assert.equal(
    getHubIDForSolarSystem(solarSystemID),
    system.infrastructureHubID,
    "Expected the modern cache to re-bootstrap from the updated sovereignty system slice",
  );
});

test("structureDirectory GetNearbyJumpBridges exposes aligned Ansiblex destinations for deployment UI parity", (t) => {
  const sovereigntyBackup = readTable("sovereignty");
  const structuresBackup = readTable("structures");
  const itemsBackup = readTable("items");
  t.after(() => {
    writeTable("sovereignty", sovereigntyBackup);
    writeTable("structures", structuresBackup);
    writeTable("items", itemsBackup);
    resetSovereigntyStateForTests();
    resetSovereigntyModernStateForTests();
    resetInventoryStoreForTests();
    structureState.clearStructureCaches();
  });

  writeCleanSovereigntyTable(sovereigntyBackup);
  writeCleanStructuresTable(structuresBackup);
  writeTable("items", itemsBackup);
  resetSovereigntyStateForTests();
  resetSovereigntyModernStateForTests();
  resetInventoryStoreForTests();
  structureState.clearStructureCaches();

  const [sourceSolarSystemID] = findClaimableSolarSystems(1);
  const [destinationSolarSystemID] = findClaimableSolarSystems(
    1,
    (solarSystem) => Number(solarSystem.solarSystemID) !== Number(sourceSolarSystemID),
  );
  const session = buildSpaceSession(sourceSolarSystemID, 990000003);
  upsertSystemState(sourceSolarSystemID, {
    allianceID: session.allianceID,
    corporationID: session.corporationID,
    infrastructureHubID: 770000001,
    devIndices: {
      militaryPoints: 0,
      industrialPoints: 0,
      claimedForDays: 100,
    },
    structures: [{
      itemID: 770000001,
      typeID: TYPE_INFRASTRUCTURE_HUB,
      ownerID: session.corporationID,
      corporationID: session.corporationID,
      allianceID: session.allianceID,
      position: { x: 0, y: 0, z: 0 },
    }],
  });
  assert.equal(getHubIDForSolarSystem(sourceSolarSystemID), 770000001);

  const seedResult = structureState.seedStructureForSession(
    session,
    TYPE_ANSIBLEX_JUMP_BRIDGE,
    {
      solarSystemID: sourceSolarSystemID,
      ownerCorpID: session.corporationID,
      allianceID: session.allianceID,
      position: { x: 44444, y: 0, z: 55555 },
      name: "West Gate",
      itemName: "West Gate",
      profileID: 1,
      reinforceWeekday: 5,
      reinforceHour: 18,
      devFlags: {
        sovereigntyFlex: true,
        sovereigntyFlexKind: "jumpBridge",
        destinationSolarsystemID: destinationSolarSystemID,
        sovereigntyJumpBridgeDestinationSolarsystemID: destinationSolarSystemID,
      },
    },
  );
  assert.equal(seedResult.success, true, "Expected the Ansiblex fixture to seed");

  const directoryService = new StructureDirectoryService();
  const nearby = directoryService.Handle_GetNearbyJumpBridges([], {
    solarsystemid2: destinationSolarSystemID,
    solarsystemid: destinationSolarSystemID,
  });
  assert.equal(nearby && nearby.type, "list");
  assert.ok(nearby.items.length > 0, "Expected at least one nearby jump bridge entry");

  const matching = nearby.items
    .map((entry) => keyValEntriesToMap(entry))
    .find((entry) => Number(entry.get("solarSystemID")) === sourceSolarSystemID);
  assert.ok(matching, "Expected the source-system Ansiblex to appear in the nearby list");
  assert.equal(Number(matching.get("destinationSolarsystemID")), destinationSolarSystemID);
  assert.equal(matching.get("structureName"), "West Gate");
  assert.equal(matching.get("alignedToCurrentSystem"), true);
});

test("structureDeployment anchors and unanchors a cargo Astrahus through generic structure state", (t) => {
  const structuresBackup = readTable("structures");
  const itemsBackup = readTable("items");
  t.after(() => {
    writeTable("structures", structuresBackup);
    writeTable("items", itemsBackup);
    resetInventoryStoreForTests();
    structureState.clearStructureCaches();
  });

  writeCleanStructuresTable(structuresBackup);
  writeTable("items", itemsBackup);
  resetInventoryStoreForTests();
  structureState.clearStructureCaches();

  const [solarSystemID] = findClaimableSolarSystems(1);
  const session = buildSpaceSession(solarSystemID, 990000004);
  const grantResult = grantItemToCharacterLocation(
    session.characterID,
    session._space.shipID,
    ITEM_FLAGS.CARGO_HOLD,
    { typeID: ASTRAHUS_TYPE_ID, name: "Astrahus Deployment Crate" },
    1,
    { singleton: 1 },
  );
  assert.equal(grantResult.success, true);
  const itemID = grantResult.data.items[0].itemID;

  const service = new StructureDeploymentService();
  service.Handle_Anchor(
    [itemID, 33333, 77777, 0.5, 1, { type: "wstring", value: "Client Astrahus" }, "", 5, 18, {}],
    session,
  );

  assert.equal(findItemById(itemID), null, "Expected the cargo citadel item to be consumed");
  const structures = structureState.listStructuresForSystem(solarSystemID, {
    refresh: true,
    includeDestroyed: false,
  });
  const astrahus = structures.find(
    (structure) =>
      Number(structure.typeID) === ASTRAHUS_TYPE_ID &&
      String(structure.itemName || structure.name || "") === "Client Astrahus",
  );
  assert.ok(astrahus, "Expected the deployed Astrahus to be persisted");
  assert.equal(Number(astrahus.position.x), 33333);
  assert.equal(Number(astrahus.position.z), 77777);
  assert.equal(Number(astrahus.state), STRUCTURE_STATE.ANCHOR_VULNERABLE);
  assert.equal(
    session._notifications.some((entry) => entry.name === "OnItemChange"),
    true,
    "Expected citadel deployment to emit the consumed cargo notification",
  );

  const onlineResult = structureState.setStructureState(
    astrahus.structureID,
    STRUCTURE_STATE.SHIELD_VULNERABLE,
    { clearTimer: true },
  );
  assert.equal(onlineResult.success, true);

  service.Handle_Unanchor([astrahus.structureID], session);
  const decommissioning = structureState.getStructureByID(astrahus.structureID, { refresh: true });
  assert.ok(decommissioning, "Expected the decommissioning Astrahus to stay persisted during unanchor");
  assert.ok(
    Number(decommissioning.unanchoring || 0) > Date.now(),
    "Expected generic structure unanchor to start a future unanchoring timer",
  );

  service.Handle_CancelUnanchor([astrahus.structureID], session);
  const cancelled = structureState.getStructureByID(astrahus.structureID, { refresh: true });
  assert.equal(cancelled.unanchoring, null);

  service.Handle_Unanchor([astrahus.structureID], session);
  const restarted = structureState.getStructureByID(astrahus.structureID, { refresh: true });
  assert.ok(restarted && restarted.unanchoring, "Expected a restarted decommission timer");
  structureState.tickStructures(Number(restarted.unanchoring) + 1);
  assert.equal(
    structureState.getStructureByID(astrahus.structureID, { refresh: true }),
    null,
    "Expected generic structure to be removed after its unanchoring timer expires",
  );
});

test("structureDeployment consumes exactly one packaged Keepstar from a stacked cargo row", (t) => {
  const structuresBackup = readTable("structures");
  const itemsBackup = readTable("items");
  t.after(() => {
    writeTable("structures", structuresBackup);
    writeTable("items", itemsBackup);
    resetInventoryStoreForTests();
    structureState.clearStructureCaches();
  });

  writeCleanStructuresTable(structuresBackup);
  writeTable("items", itemsBackup);
  resetInventoryStoreForTests();
  structureState.clearStructureCaches();

  const [solarSystemID] = findClaimableSolarSystems(1);
  const session = buildSpaceSession(solarSystemID, 990000005);
  const grantResult = grantItemToCharacterLocation(
    session.characterID,
    session._space.shipID,
    ITEM_FLAGS.CARGO_HOLD,
    { typeID: KEEPSTAR_TYPE_ID, name: "Keepstar Deployment Stack" },
    5,
    { singleton: 0 },
  );
  assert.equal(grantResult.success, true);
  const stackItemID = grantResult.data.items[0].itemID;
  const initialStack = findItemById(stackItemID);
  assert.ok(initialStack, "Expected the source stacked Keepstar row to exist before deployment");
  const initialStackQuantity = Number(initialStack.stacksize || initialStack.quantity || 0);
  assert.ok(initialStackQuantity >= 1, "Expected the source Keepstar stack to have at least one unit");

  const service = new StructureDeploymentService();
  service.Handle_Anchor(
    [stackItemID, 11111, 22222, 0.5, 1, { type: "wstring", value: "Client Keepstar" }, "", 5, 18, {}],
    session,
  );

  const remainingStack = findItemById(stackItemID);
  assert.ok(remainingStack, "Expected the source stacked Keepstar row to remain after deploying one unit");
  assert.equal(Number(remainingStack.typeID), KEEPSTAR_TYPE_ID);
  assert.equal(Number(remainingStack.locationID), Number(session._space.shipID));
  assert.equal(Number(remainingStack.flagID), ITEM_FLAGS.CARGO_HOLD);
  assert.equal(Number(remainingStack.singleton), 0);
  assert.equal(
    Number(remainingStack.stacksize || remainingStack.quantity),
    initialStackQuantity - 1,
  );

  const structures = structureState.listStructuresForSystem(solarSystemID, {
    refresh: true,
    includeDestroyed: false,
  });
  const keepstar = structures.find(
    (structure) =>
      Number(structure.typeID) === KEEPSTAR_TYPE_ID &&
      String(structure.itemName || structure.name || "") === "Client Keepstar",
  );
  assert.ok(keepstar, "Expected the deployed Keepstar to be persisted");

  assert.equal(
    session._notifications.some((entry) => entry.name === "OnItemChange"),
    true,
    "Expected Keepstar stack consumption to emit inventory change feedback",
  );
});

test("structureDeployment anchors a live-space Astrahus at ship-relative coordinates and seeds AddBalls2", async (t) => {
  const structuresBackup = readTable("structures");
  const itemsBackup = readTable("items");
  t.after(() => {
    writeTable("structures", structuresBackup);
    writeTable("items", itemsBackup);
    resetInventoryStoreForTests();
    structureState.clearStructureCaches();
  });

  writeCleanStructuresTable(structuresBackup);
  writeTable("items", itemsBackup);
  resetInventoryStoreForTests();
  structureState.clearStructureCaches();

  const [solarSystemID] = findClaimableSolarSystems(1);
  const shipPosition = {
    x: -253013545507.42303,
    y: 40238006840.86734,
    z: -522407574245.7781,
  };
  const session = buildLiveSpaceSession(
    solarSystemID,
    shipPosition,
    990000099,
    28850,
  );
  const shipEntity = attachAndBootstrapLiveSession(session);

  const grantResult = grantItemToCharacterLocation(
    session.characterID,
    session._space.shipID,
    ITEM_FLAGS.CARGO_HOLD,
    { typeID: ASTRAHUS_TYPE_ID, name: "Astrahus Deployment Crate" },
    1,
    { singleton: 1 },
  );
  assert.equal(grantResult.success, true);
  const itemID = grantResult.data.items[0].itemID;

  const service = new StructureDeploymentService();
  service.Handle_Anchor(
    [itemID, 10003.7548828125, -80504.96875, 5.6531853675842285, 1, { type: "wstring", value: "Client Astrahus" }, "", 255, 20, {}],
    session,
  );
  await new Promise((resolve) => setImmediate(resolve));

  const structures = structureState.listStructuresForSystem(solarSystemID, {
    refresh: true,
    includeDestroyed: false,
  });
  const astrahus = structures.find(
    (structure) =>
      Number(structure.typeID) === ASTRAHUS_TYPE_ID &&
      String(structure.itemName || structure.name || "") === "Client Astrahus",
  );
  assert.ok(astrahus, "Expected the live-space Astrahus to be persisted");
  assert.equal(
    Number(astrahus.position.x),
    Number(shipEntity.position.x) + 10003.7548828125,
  );
  assert.equal(
    Number(astrahus.position.y),
    Number(shipEntity.position.y),
  );
  assert.equal(
    Number(astrahus.position.z),
    Number(shipEntity.position.z) - 80504.96875,
  );
  const expectedYawDegrees = ((5.6531853675842285 * 180 / Math.PI) % 360 + 360) % 360;
  assert.ok(
    Array.isArray(astrahus.rotation) &&
      Math.abs(Number(astrahus.rotation[0]) - expectedYawDegrees) < 1e-9,
    "Expected client placement yaw radians to be persisted as dunRotation degrees",
  );

  const updates = flattenDestinyUpdates(session._notifications);
  assert.equal(
    updates.some(
      (entry) => entry.name === "AddBalls2" && getAddBalls2EntityIDs(entry).includes(Number(astrahus.structureID)),
    ),
    true,
    "Expected live structure deployment to seed the newly anchored structure into ballpark visibility",
  );
});
