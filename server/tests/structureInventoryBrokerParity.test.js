const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const InvBrokerService = require(path.join(
  repoRoot,
  "server/src/services/inventory/invBrokerService",
));
const DogmaService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dogmaService",
));
const structureState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureState",
));
const {
  resolveItemByTypeID,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemTypeRegistry",
));
const {
  findItemById,
  grantItemToCharacterLocation,
  ITEM_FLAGS,
  listContainerItems,
  resetInventoryStoreForTests,
  updateInventoryItem,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
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
  SERVICE_FUEL_CYCLE_MS,
  STRUCTURE_FUEL_BAY_FLAG,
  getStructureServiceModuleCycleFuelNeed,
  getStructureServiceModuleOnlineFuelNeed,
} = require(path.join(
  repoRoot,
  "server/src/services/structure/structureServiceModules",
));
const {
  isFuelBayCompatibleItem,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/fuelBayInventory",
));
const {
  getRequiredSlotFamily,
  getShipBaseAttributeValue,
  getShipSlotCounts,
  getSlotFlagsForFamily,
  listFittedItems,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));
const {
  marshalEncode,
} = require(path.join(
  repoRoot,
  "server/src/network/tcp/utils/marshal",
));

const CONTAINER_HANGAR_ID = 10004;
const CONTAINER_STRUCTURE_ID = 10014;

const originalGetStructureByID = structureState.getStructureByID;
const originalSyncStructureSceneState = spaceRuntime.syncStructureSceneState;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function snapshotMutableTables() {
  return {
    identityState: cloneValue(database.read("identityState", "/").data || {}),
    items: cloneValue(database.read("items", "/").data || {}),
    structures: cloneValue(database.read("structures", "/").data || {}),
  };
}

function restoreMutableTables(snapshot) {
  database.write("identityState", "/", cloneValue(snapshot.identityState));
  database.write("items", "/", cloneValue(snapshot.items));
  database.write("structures", "/", cloneValue(snapshot.structures));
  database.flushAllSync();
  resetInventoryStoreForTests();
  structureState.clearStructureCaches();
}

function buildSession() {
  return {
    clientID: 65450,
    characterID: 140000002,
    charid: 140000002,
    userid: 1,
    structureID: 1030000000000,
    structureid: 1030000000000,
    locationid: 1030000000000,
    solarsystemid: 30002187,
    solarsystemid2: 30002187,
    currentBoundObjectID: null,
    socket: { destroyed: false },
    notifications: [],
    sendNotification(name, idType, args) {
      this.notifications.push({ name, idType, args });
    },
  };
}

function buildStructure() {
  return {
    structureID: 1030000000000,
    typeID: 35832,
    ownerCorpID: 1000044,
    ownerID: 1000044,
    itemName: "Test Astrahus",
    solarSystemID: 30002187,
  };
}

function extractBoundID(boundValue) {
  return (
    boundValue &&
    boundValue.type === "substruct" &&
    boundValue.value &&
    boundValue.value.type === "substream" &&
    Array.isArray(boundValue.value.value)
      ? boundValue.value.value[0]
      : null
  );
}

function toEntryMap(keyVal) {
  assert.equal(keyVal && keyVal.name, "util.KeyVal");
  return new Map((keyVal.args && keyVal.args.entries) || []);
}

function getRemoteListFields(remoteList) {
  assert.equal(remoteList && remoteList.type, "list");
  return (remoteList.items || []).map((row) => {
    assert.equal(row && row.type, "packedrow");
    return row.fields || {};
  });
}

function getChangeEntriesFromNotification(notification) {
  const change = notification && notification.args && notification.args[1];
  assert.equal(change && change.type, "dict");
  return new Map(change.entries || []);
}

function getUserErrorMessage(error) {
  const payload = error && error.machoErrorResponse && error.machoErrorResponse.payload;
  return (
    payload &&
    Array.isArray(payload.header) &&
    Array.isArray(payload.header[1]) &&
    payload.header[1][0]
  ) || null;
}

test.afterEach(() => {
  structureState.getStructureByID = originalGetStructureByID;
  spaceRuntime.syncStructureSceneState = originalSyncStructureSceneState;
});

test("structure-docked inventory bindings expose the real structure item for hangar and containerStructure lookups", () => {
  const session = buildSession();
  const structure = buildStructure();
  const structureType = resolveItemByTypeID(structure.typeID);
  const service = new InvBrokerService();

  structureState.getStructureByID = (structureID, options) => {
    assert.equal(Number(structureID), structure.structureID);
    assert.deepEqual(options, { refresh: false });
    return structure;
  };

  for (const containerID of [CONTAINER_HANGAR_ID, CONTAINER_STRUCTURE_ID]) {
    const bound = service.Handle_GetInventory([containerID], session);
    const boundID = extractBoundID(bound);
    assert.ok(boundID, `Expected bound inventory ID for container ${containerID}`);
    session.currentBoundObjectID = boundID;

    const selfItem = toEntryMap(service.Handle_GetSelfInvItem([], session));

    assert.equal(selfItem.get("itemID"), structure.structureID);
    assert.equal(selfItem.get("typeID"), structure.typeID);
    assert.equal(selfItem.get("ownerID"), structure.ownerCorpID);
    assert.equal(selfItem.get("locationID"), structure.structureID);
    assert.equal(selfItem.get("quantity"), -1);
    assert.equal(selfItem.get("groupID"), structureType.groupID);
    assert.equal(selfItem.get("categoryID"), structureType.categoryID);
    assert.equal(selfItem.get("singleton"), 1);
    assert.equal(selfItem.get("stacksize"), 1);
  }
});

test("GetItem on the docked structure ID returns a structure-shaped inventory row instead of a station shim", () => {
  const session = buildSession();
  const structure = buildStructure();
  const structureType = resolveItemByTypeID(structure.typeID);
  const service = new InvBrokerService();

  structureState.getStructureByID = (structureID, options) => {
    assert.equal(Number(structureID), structure.structureID);
    assert.deepEqual(options, { refresh: false });
    return structure;
  };

  const result = service.Handle_GetItem([structure.structureID], session);
  const entries = new Map(result.args.entries);
  const row = entries.get("line");

  assert.equal(row[0], structure.structureID);
  assert.equal(row[1], structure.typeID);
  assert.equal(row[2], structure.ownerCorpID);
  assert.equal(row[3], structure.structureID);
  assert.equal(row[5], -1);
  assert.equal(row[6], structureType.groupID);
  assert.equal(row[7], structureType.categoryID);
});

test("structure inventory packed rows marshal when the docked locationID exceeds int32", () => {
  const session = buildSession();
  const structure = buildStructure();
  const service = new InvBrokerService();

  structureState.getStructureByID = (structureID, options) => {
    assert.equal(Number(structureID), structure.structureID);
    assert.deepEqual(options, { refresh: false });
    return structure;
  };

  const packedRows = service._buildInventoryRemoteList([
    service._buildStructureItemOverrides(session),
    service._buildInventoryItemOverrides(session, {
      itemID: 990112614,
      typeID: 621,
      ownerID: session.characterID,
      locationID: structure.structureID,
      flagID: 4,
      quantity: -1,
      groupID: 25,
      categoryID: 6,
      customInfo: "",
      singleton: 1,
      stacksize: 1,
    }),
  ]);

  assert.doesNotThrow(
    () => marshalEncode(packedRows),
    "Expected structure-docked inventory packed rows to marshal large locationIDs safely",
  );
});

test("structure deed bay consumes one required core from a stack and starts onlining repair", (t) => {
  const snapshot = snapshotMutableTables();
  const syncCalls = [];
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();
  structureState.clearStructureCaches();

  const session = buildSession();
  const sourceLocationID = 990880000001;
  const structureID = 1039888800001;
  const service = new InvBrokerService();

  spaceRuntime.syncStructureSceneState = (systemID, options = {}) => {
    syncCalls.push({ systemID, reason: options.reason || null });
    return { success: true, updated: 1 };
  };

  const structureResult = structureState.upsertStructureRecord({
    structureID,
    typeID: 35834,
    name: "Core Install Test Keepstar",
    itemName: "Core Install Test Keepstar",
    ownerCorpID: 98000000,
    solarSystemID: 30000142,
    state: STRUCTURE_STATE.ONLINING_VULNERABLE,
    stateStartedAt: null,
    stateEndsAt: null,
    hasQuantumCore: false,
    quantumCoreItemTypeID: 56207,
    position: { x: 0, y: 0, z: 0 },
  });
  assert.equal(structureResult.success, true);

  const grantResult = grantItemToCharacterLocation(
    session.characterID,
    sourceLocationID,
    ITEM_FLAGS.CARGO_HOLD,
    56207,
    123,
    { singleton: false },
  );
  assert.equal(grantResult.success, true);
  const sourceItem = grantResult.data.items[0];
  assert.equal(sourceItem.stacksize, 123);

  const bound = service.Handle_GetInventoryFromId([structureID], session);
  session.currentBoundObjectID = extractBoundID(bound);
  assert.ok(session.currentBoundObjectID, "Expected structure inventory bind to succeed");

  const movedItemID = service.Handle_Add(
    [sourceItem.itemID, sourceLocationID],
    session,
    {
      flag: ITEM_FLAGS.STRUCTURE_DEED,
      qty: 123,
    },
  );

  const sourceAfter = findItemById(sourceItem.itemID);
  const deedItems = listContainerItems(
    null,
    structureID,
    ITEM_FLAGS.STRUCTURE_DEED,
  );
  const structureAfter = structureState.getStructureByID(structureID, {
    refresh: false,
  });

  assert.equal(sourceAfter.stacksize, 122);
  assert.equal(deedItems.length, 1);
  assert.equal(deedItems[0].itemID, movedItemID);
  assert.equal(deedItems[0].typeID, 56207);
  assert.equal(deedItems[0].quantity, -1);
  assert.equal(deedItems[0].stacksize, 1);
  assert.equal(deedItems[0].singleton, 1);
  assert.equal(deedItems[0].flagID, ITEM_FLAGS.STRUCTURE_DEED);
  assert.equal(deedItems[0].ownerID, 98000000);

  const deedBayRows = getRemoteListFields(
    service.Handle_List([ITEM_FLAGS.STRUCTURE_DEED], session, {}),
  );
  assert.equal(deedBayRows.length, 1);
  assert.equal(deedBayRows[0].itemID, movedItemID);
  assert.equal(deedBayRows[0].ownerID, 98000000);
  assert.equal(deedBayRows[0].locationID, structureID);
  assert.equal(deedBayRows[0].flagID, ITEM_FLAGS.STRUCTURE_DEED);

  const deedChange = session.notifications.find(
    (notification) =>
      notification.name === "OnItemChange" &&
      notification.args &&
      notification.args[0] &&
      notification.args[0].fields &&
      notification.args[0].fields.itemID === movedItemID,
  );
  assert.ok(deedChange, "Expected the installed core to emit OnItemChange");
  assert.equal(deedChange.idType, "clientID");
  assert.equal(deedChange.args[0].fields.ownerID, 98000000);
  assert.equal(getChangeEntriesFromNotification(deedChange).get(2), 140000002);

  assert.equal(structureAfter.hasQuantumCore, true);
  assert.equal(structureAfter.state, STRUCTURE_STATE.ONLINING_VULNERABLE);
  assert.ok(
    Number(structureAfter.stateEndsAt) > Number(structureAfter.stateStartedAt),
    "Expected core install to start the onlining repair timer",
  );
  assert.deepEqual(syncCalls.filter((entry) => entry.reason !== "structureStateChange"), [
    { systemID: 30000142, reason: "structureCoreInstall" },
  ]);
});

test("structure deed bay rejects a core that does not match the structure requirement", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();
  structureState.clearStructureCaches();

  const session = buildSession();
  const sourceLocationID = 990880000002;
  const structureID = 1039888800002;
  const service = new InvBrokerService();

  const structureResult = structureState.upsertStructureRecord({
    structureID,
    typeID: 35834,
    name: "Wrong Core Test Keepstar",
    itemName: "Wrong Core Test Keepstar",
    ownerCorpID: 98000000,
    solarSystemID: 30000142,
    state: STRUCTURE_STATE.ONLINING_VULNERABLE,
    hasQuantumCore: false,
    quantumCoreItemTypeID: 56207,
    position: { x: 0, y: 0, z: 0 },
  });
  assert.equal(structureResult.success, true);

  const grantResult = grantItemToCharacterLocation(
    session.characterID,
    sourceLocationID,
    ITEM_FLAGS.CARGO_HOLD,
    56201,
    3,
    { singleton: false },
  );
  assert.equal(grantResult.success, true);
  const sourceItem = grantResult.data.items[0];

  const bound = service.Handle_GetInventoryFromId([structureID], session);
  session.currentBoundObjectID = extractBoundID(bound);

  assert.throws(() => {
    service.Handle_Add([sourceItem.itemID, sourceLocationID], session, {
      flag: ITEM_FLAGS.STRUCTURE_DEED,
      qty: 3,
    });
  }, /Wrapped remote exception/);

  assert.equal(findItemById(sourceItem.itemID).stacksize, 3);
  assert.equal(
    listContainerItems(null, structureID, ITEM_FLAGS.STRUCTURE_DEED).length,
    0,
  );
  assert.equal(
    structureState.getStructureByID(structureID, { refresh: false }).hasQuantumCore,
    false,
  );
});

test("structure fitting treats the Upwell structure as the dogma fit host", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();
  structureState.clearStructureCaches();

  const session = buildSession();
  const sourceLocationID = 990880000003;
  const structureID = 1039888800003;
  const service = new InvBrokerService();

  const structureResult = structureState.upsertStructureRecord({
    structureID,
    typeID: 35834,
    name: "Structure Fit Test Keepstar",
    itemName: "Structure Fit Test Keepstar",
    ownerCorpID: 98000000,
    solarSystemID: 30000142,
    state: STRUCTURE_STATE.SHIELD_VULNERABLE,
    hasQuantumCore: true,
    quantumCoreItemTypeID: 56207,
    position: { x: 0, y: 0, z: 0 },
  });
  assert.equal(structureResult.success, true);

  const grantResult = grantItemToCharacterLocation(
    session.characterID,
    sourceLocationID,
    ITEM_FLAGS.CARGO_HOLD,
    35923,
    1,
    { singleton: true },
  );
  assert.equal(grantResult.success, true);
  const moduleItem = grantResult.data.items[0];

  const bound = service.Handle_GetInventoryFromId([structureID], session);
  session.currentBoundObjectID = extractBoundID(bound);

  service.Handle_Add([moduleItem.itemID, sourceLocationID], session, {
    flag: 27,
    qty: 1,
  });

  const movedModule = findItemById(moduleItem.itemID);
  assert.equal(movedModule.locationID, structureID);
  assert.equal(movedModule.flagID, 27);
  assert.deepEqual(
    listFittedItems(session.characterID, structureID).map((item) => [
      item.itemID,
      item.typeID,
      item.flagID,
    ]),
    [[moduleItem.itemID, 35923, 27]],
  );
});

test("structure fitting reads Upwell slots and launcher hardpoints from type dogma", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();
  structureState.clearStructureCaches();

  const session = buildSession();
  const sourceLocationID = 990880000008;
  const structureID = 1039888800008;
  const service = new InvBrokerService();

  assert.deepEqual(getShipSlotCounts(35834), {
    low: 5,
    med: 6,
    high: 8,
    rig: 3,
    subsystem: 0,
    service: 7,
  });
  assert.equal(getShipBaseAttributeValue(35834, "launcherSlotsLeft"), 4);

  const structureResult = structureState.upsertStructureRecord({
    structureID,
    typeID: 35834,
    name: "Structure Launcher Test Keepstar",
    itemName: "Structure Launcher Test Keepstar",
    ownerCorpID: 98000000,
    solarSystemID: 30000142,
    state: STRUCTURE_STATE.SHIELD_VULNERABLE,
    hasQuantumCore: true,
    quantumCoreItemTypeID: 56207,
    position: { x: 0, y: 0, z: 0 },
  });
  assert.equal(structureResult.success, true);

  const bound = service.Handle_GetInventoryFromId([structureID], session);
  session.currentBoundObjectID = extractBoundID(bound);

  const fittedLauncherIDs = [];
  for (const flagID of [27, 28, 29, 30]) {
    const grantResult = grantItemToCharacterLocation(
      session.characterID,
      sourceLocationID,
      ITEM_FLAGS.CARGO_HOLD,
      35921,
      1,
      { singleton: true },
    );
    assert.equal(grantResult.success, true);
    const moduleItem = grantResult.data.items[0];

    service.Handle_Add([moduleItem.itemID, sourceLocationID], session, {
      flag: flagID,
      qty: 1,
    });
    fittedLauncherIDs.push(moduleItem.itemID);
  }

  const fifthGrant = grantItemToCharacterLocation(
    session.characterID,
    sourceLocationID,
    ITEM_FLAGS.CARGO_HOLD,
    35921,
    1,
    { singleton: true },
  );
  assert.equal(fifthGrant.success, true);
  const rejectedLauncher = fifthGrant.data.items[0];
  const rejectResult = service.Handle_Add(
    [rejectedLauncher.itemID, sourceLocationID],
    session,
    { flag: 31, qty: 1 },
  );

  assert.equal(rejectResult, null);
  assert.equal(findItemById(rejectedLauncher.itemID).locationID, sourceLocationID);
  assert.deepEqual(
    listFittedItems(session.characterID, structureID)
      .filter((item) => item.typeID === 35921)
      .map((item) => [item.itemID, item.flagID]),
    fittedLauncherIDs.map((itemID, index) => [itemID, 27 + index]),
  );
});

test("structure fitting accepts service modules in service slots", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();
  structureState.clearStructureCaches();

  const session = buildSession();
  const sourceLocationID = 990880000009;
  const structureID = 1039888800009;
  const service = new InvBrokerService();

  assert.equal(getRequiredSlotFamily(35894), "service");
  assert.deepEqual(getSlotFlagsForFamily("service", 35834), [
    164,
    165,
    166,
    167,
    168,
    169,
    170,
  ]);

  const structureResult = structureState.upsertStructureRecord({
    structureID,
    typeID: 35834,
    name: "Structure Service Test Keepstar",
    itemName: "Structure Service Test Keepstar",
    ownerCorpID: 98000000,
    solarSystemID: 30000142,
    state: STRUCTURE_STATE.SHIELD_VULNERABLE,
    hasQuantumCore: true,
    quantumCoreItemTypeID: 56207,
    position: { x: 0, y: 0, z: 0 },
  });
  assert.equal(structureResult.success, true);

  const grantResult = grantItemToCharacterLocation(
    session.characterID,
    sourceLocationID,
    ITEM_FLAGS.CARGO_HOLD,
    35894,
    1,
    { singleton: true },
  );
  assert.equal(grantResult.success, true);
  const moduleItem = grantResult.data.items[0];

  const bound = service.Handle_GetInventoryFromId([structureID], session);
  session.currentBoundObjectID = extractBoundID(bound);

  service.Handle_Add([moduleItem.itemID, sourceLocationID], session, {
    flag: 164,
    qty: 1,
  });

  const movedModule = findItemById(moduleItem.itemID);
  assert.equal(movedModule.locationID, structureID);
  assert.equal(movedModule.flagID, 164);
  assert.equal(movedModule.singleton, 1);
  assert.deepEqual(
    listFittedItems(session.characterID, structureID).map((item) => [
      item.itemID,
      item.typeID,
      item.flagID,
    ]),
    [[moduleItem.itemID, 35894, 164]],
  );
});

test("controlled structure GetAllInfo hydrates fitted service modules after retaking control", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();
  structureState.clearStructureCaches();

  const session = buildSession();
  const sourceLocationID = 990880000010;
  const structureID = 1039888800010;
  const invBroker = new InvBrokerService();
  const dogma = new DogmaService();

  const structureResult = structureState.upsertStructureRecord({
    structureID,
    typeID: 35834,
    name: "Structure GetAllInfo Test Keepstar",
    itemName: "Structure GetAllInfo Test Keepstar",
    ownerCorpID: 98000000,
    solarSystemID: 30000142,
    state: STRUCTURE_STATE.SHIELD_VULNERABLE,
    hasQuantumCore: true,
    quantumCoreItemTypeID: 56207,
    position: { x: 0, y: 0, z: 0 },
  });
  assert.equal(structureResult.success, true);

  const grantResult = grantItemToCharacterLocation(
    session.characterID,
    sourceLocationID,
    ITEM_FLAGS.CARGO_HOLD,
    35894,
    1,
    { singleton: true },
  );
  assert.equal(grantResult.success, true);
  const moduleItem = grantResult.data.items[0];

  const bound = invBroker.Handle_GetInventoryFromId([structureID], session);
  session.currentBoundObjectID = extractBoundID(bound);
  invBroker.Handle_Add([moduleItem.itemID, sourceLocationID], session, {
    flag: 164,
    qty: 1,
  });

  session.shipID = structureID;
  session.shipid = structureID;
  session.structureID = structureID;
  session.structureid = structureID;

  const result = dogma.Handle_GetAllInfo([true, true, true], session);
  const allInfoEntries = new Map(result.args.entries);
  const shipInfo = allInfoEntries.get("shipInfo");
  const shipState = allInfoEntries.get("shipState");

  assert.equal(shipInfo && shipInfo.type, "dict");
  assert.ok(
    shipInfo.entries.some(([itemID]) => Number(itemID) === Number(moduleItem.itemID)),
    "Expected controlled structure shipInfo to include fitted service modules",
  );
  assert.ok(
    Array.isArray(shipState) &&
      shipState[0] &&
      shipState[0].entries.some(([itemID]) => Number(itemID) === Number(moduleItem.itemID)),
    "Expected controlled structure shipState to include fitted service module status",
  );
});

test("controlled structure inventory List hydrates fitted modules for client dogma HUD bootstrap", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();
  structureState.clearStructureCaches();

  const session = buildSession();
  const sourceLocationID = 990880000012;
  const structureID = 1039888800012;
  const invBroker = new InvBrokerService();

  const structureResult = structureState.upsertStructureRecord({
    structureID,
    typeID: 35834,
    name: "Structure HUD Inventory Test Keepstar",
    itemName: "Structure HUD Inventory Test Keepstar",
    ownerCorpID: 98000000,
    solarSystemID: 30000142,
    state: STRUCTURE_STATE.SHIELD_VULNERABLE,
    hasQuantumCore: true,
    quantumCoreItemTypeID: 56207,
    position: { x: 0, y: 0, z: 0 },
  });
  assert.equal(structureResult.success, true);

  const grantResult = grantItemToCharacterLocation(
    session.characterID,
    sourceLocationID,
    ITEM_FLAGS.CARGO_HOLD,
    47323,
    1,
    { singleton: true },
  );
  assert.equal(grantResult.success, true);
  const moduleItem = grantResult.data.items[0];

  let bound = invBroker.Handle_GetInventoryFromId([structureID], session);
  session.currentBoundObjectID = extractBoundID(bound);
  invBroker.Handle_Add([moduleItem.itemID, sourceLocationID], session, {
    flag: 31,
    qty: 1,
  });

  session.shipID = structureID;
  session.shipid = structureID;
  session.structureID = structureID;
  session.structureid = structureID;
  bound = invBroker.Handle_GetInventoryFromId([structureID], session);
  session.currentBoundObjectID = extractBoundID(bound);

  const rows = getRemoteListFields(invBroker.Handle_List([], session, {}));
  assert.ok(
    rows.some(
      (row) =>
        Number(row.itemID) === Number(moduleItem.itemID) &&
        Number(row.locationID) === structureID &&
        Number(row.flagID) === 31,
    ),
    "Expected controlled structure List() to expose fitted owner-corp modules so clientDogmaLocation can FitItemToLocation before HUD damage reads",
  );
});

test("online service modules consume Upwell fuel, expose services, and drive full power", (t) => {
  const snapshot = snapshotMutableTables();
  const syncCalls = [];
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();
  structureState.clearStructureCaches();

  const session = buildSession();
  const sourceLocationID = 990880000011;
  const structureID = 1039888800011;
  const invBroker = new InvBrokerService();
  const dogma = new DogmaService();

  spaceRuntime.syncStructureSceneState = (systemID, options = {}) => {
    syncCalls.push({ systemID, reason: options.reason || null });
    return { success: true, updated: 1 };
  };

  const structureResult = structureState.upsertStructureRecord({
    structureID,
    typeID: 35834,
    name: "Structure Service Fuel Test Keepstar",
    itemName: "Structure Service Fuel Test Keepstar",
    ownerCorpID: 98000000,
    solarSystemID: 30000142,
    state: STRUCTURE_STATE.SHIELD_VULNERABLE,
    hasQuantumCore: true,
    quantumCoreItemTypeID: 56207,
    position: { x: 0, y: 0, z: 0 },
  });
  assert.equal(structureResult.success, true);

  assert.equal(isFuelBayCompatibleItem(4051), true);
  assert.equal(getStructureServiceModuleOnlineFuelNeed(35894), 720);
  assert.equal(getStructureServiceModuleCycleFuelNeed(35894), 10);

  const moduleGrant = grantItemToCharacterLocation(
    session.characterID,
    sourceLocationID,
    ITEM_FLAGS.CARGO_HOLD,
    35894,
    1,
    { singleton: true },
  );
  assert.equal(moduleGrant.success, true);
  const moduleItem = moduleGrant.data.items[0];

  const fuelGrant = grantItemToCharacterLocation(
    session.characterID,
    structureID,
    STRUCTURE_FUEL_BAY_FLAG,
    4051,
    1000,
    { singleton: false },
  );
  assert.equal(fuelGrant.success, true);
  const fuelItem = fuelGrant.data.items[0];

  const bound = invBroker.Handle_GetInventoryFromId([structureID], session);
  session.currentBoundObjectID = extractBoundID(bound);
  invBroker.Handle_Add([moduleItem.itemID, sourceLocationID], session, {
    flag: 164,
    qty: 1,
  });

  const onlineResult = dogma._setModuleOnlineState(
    structureID,
    moduleItem.itemID,
    true,
    session,
  );
  assert.equal(onlineResult.success, true);

  const onlineStructure = structureState.getStructureByID(structureID, { refresh: false });
  const onlineModule = findItemById(moduleItem.itemID);
  assert.equal(onlineModule.moduleState.online, true);
  assert.ok(
    Number(onlineModule.moduleState.serviceFuelNextCycleAt) > Date.now(),
    "Expected service module to schedule its first hourly fuel cycle after onlining",
  );
  assert.equal(findItemById(fuelItem.itemID).stacksize, 280);
  assert.equal(
    onlineStructure.serviceStates[String(STRUCTURE_SERVICE_ID.MEDICAL)],
    STRUCTURE_SERVICE_STATE.ONLINE,
  );
  assert.equal(onlineStructure.upkeepState, STRUCTURE_UPKEEP_STATE.FULL_POWER);
  assert.ok(
    session.notifications.some(
      (notification) =>
        notification.name === "OnItemChange" &&
        notification.args &&
        notification.args[0] &&
        notification.args[0].fields &&
        notification.args[0].fields.itemID === fuelItem.itemID,
    ),
    "Expected fuel consumption to be synchronized to the client inventory",
  );
  assert.deepEqual(syncCalls.filter((entry) => entry.reason !== "structureStateChange"), [
    { systemID: 30000142, reason: "structureServiceModuleMove" },
    { systemID: 30000142, reason: "structureServiceModuleState" },
  ]);

  updateInventoryItem(moduleItem.itemID, (current) => ({
    ...current,
    moduleState: {
      ...(current.moduleState || {}),
      serviceFuelNextCycleAt: Date.now() - SERVICE_FUEL_CYCLE_MS,
    },
  }));
  session.shipID = structureID;
  session.shipid = structureID;
  session.structureID = structureID;
  session.structureid = structureID;
  const cycleInfo = dogma.Handle_GetAllInfo([true, true, true], session);
  assert.ok(cycleInfo && cycleInfo.args, "Expected controlled-structure GetAllInfo payload");
  assert.equal(findItemById(fuelItem.itemID).stacksize, 260);
  assert.equal(findItemById(moduleItem.itemID).moduleState.online, true);

  updateInventoryItem(fuelItem.itemID, (current) => ({
    ...current,
    quantity: 5,
    stacksize: 5,
  }));
  updateInventoryItem(moduleItem.itemID, (current) => ({
    ...current,
    moduleState: {
      ...(current.moduleState || {}),
      serviceFuelNextCycleAt: Date.now() - SERVICE_FUEL_CYCLE_MS,
    },
  }));
  dogma.Handle_GetAllInfo([true, true, true], session);
  const fuelStarvedStructure = structureState.getStructureByID(structureID, { refresh: false });
  assert.equal(findItemById(moduleItem.itemID).moduleState.online, false);
  assert.equal(
    fuelStarvedStructure.serviceStates[String(STRUCTURE_SERVICE_ID.MEDICAL)],
    STRUCTURE_SERVICE_STATE.OFFLINE,
  );
  assert.equal(fuelStarvedStructure.upkeepState, STRUCTURE_UPKEEP_STATE.LOW_POWER);

  const offlineResult = dogma._setModuleOnlineState(
    structureID,
    moduleItem.itemID,
    false,
    session,
  );
  assert.equal(offlineResult.success, true);
  const offlineStructure = structureState.getStructureByID(structureID, { refresh: false });
  assert.equal(
    offlineStructure.serviceStates[String(STRUCTURE_SERVICE_ID.MEDICAL)],
    STRUCTURE_SERVICE_STATE.OFFLINE,
  );
  assert.equal(offlineStructure.upkeepState, STRUCTURE_UPKEEP_STATE.LOW_POWER);
});

test("Sotiyo can online fitted Standup Cloning Center service", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();
  structureState.clearStructureCaches();

  const session = buildSession();
  const sourceLocationID = 990880000017;
  const structureID = 1039888800017;
  const invBroker = new InvBrokerService();
  const dogma = new DogmaService();

  const sotiyoType = structureState.getStructureTypeByID(35827);
  assert.ok(
    sotiyoType.allowedServices.includes(STRUCTURE_SERVICE_ID.MEDICAL),
    "Expected Sotiyo structure type authority to allow the Medical service",
  );

  const structureResult = structureState.upsertStructureRecord({
    structureID,
    typeID: 35827,
    name: "Structure Cloning Test Sotiyo",
    itemName: "Structure Cloning Test Sotiyo",
    ownerCorpID: 98000000,
    solarSystemID: 30000142,
    state: STRUCTURE_STATE.SHIELD_VULNERABLE,
    hasQuantumCore: true,
    quantumCoreItemTypeID: 56208,
    position: { x: 0, y: 0, z: 0 },
  });
  assert.equal(structureResult.success, true);

  const moduleGrant = grantItemToCharacterLocation(
    session.characterID,
    sourceLocationID,
    ITEM_FLAGS.CARGO_HOLD,
    35894,
    1,
    { singleton: true },
  );
  assert.equal(moduleGrant.success, true);
  const moduleItem = moduleGrant.data.items[0];

  const fuelGrant = grantItemToCharacterLocation(
    session.characterID,
    structureID,
    STRUCTURE_FUEL_BAY_FLAG,
    4051,
    1000,
    { singleton: false },
  );
  assert.equal(fuelGrant.success, true);

  const bound = invBroker.Handle_GetInventoryFromId([structureID], session);
  session.currentBoundObjectID = extractBoundID(bound);
  invBroker.Handle_Add([moduleItem.itemID, sourceLocationID], session, {
    flag: 164,
    qty: 1,
  });

  const fittedModule = findItemById(moduleItem.itemID);
  assert.equal(fittedModule.locationID, structureID);
  assert.equal(fittedModule.flagID, 164);

  const onlineResult = dogma._setModuleOnlineState(
    structureID,
    moduleItem.itemID,
    true,
    session,
  );
  assert.equal(onlineResult.success, true);

  const onlineStructure = structureState.getStructureByID(structureID, { refresh: false });
  assert.equal(findItemById(moduleItem.itemID).moduleState.online, true);
  assert.equal(
    onlineStructure.serviceStates[String(STRUCTURE_SERVICE_ID.MEDICAL)],
    STRUCTURE_SERVICE_STATE.ONLINE,
  );
  assert.equal(onlineStructure.upkeepState, STRUCTURE_UPKEEP_STATE.FULL_POWER);
});

test("structure fuel bay uses the Upwell fuel flag and accepts only fuel blocks", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();
  structureState.clearStructureCaches();

  const session = buildSession();
  const sourceLocationID = 990880000013;
  const structureID = 1039888800013;
  const invBroker = new InvBrokerService();

  const structureResult = structureState.upsertStructureRecord({
    structureID,
    typeID: 35834,
    name: "Structure Fuel Bay Test Keepstar",
    itemName: "Structure Fuel Bay Test Keepstar",
    ownerCorpID: 98000000,
    solarSystemID: 30000142,
    state: STRUCTURE_STATE.SHIELD_VULNERABLE,
    hasQuantumCore: true,
    quantumCoreItemTypeID: 56207,
    position: { x: 0, y: 0, z: 0 },
  });
  assert.equal(structureResult.success, true);

  const fuelGrant = grantItemToCharacterLocation(
    session.characterID,
    sourceLocationID,
    ITEM_FLAGS.CARGO_HOLD,
    4247,
    3242,
    { singleton: false },
  );
  assert.equal(fuelGrant.success, true);
  const fuelItem = fuelGrant.data.items[0];

  const bound = invBroker.Handle_GetInventoryFromId([structureID], session);
  session.currentBoundObjectID = extractBoundID(bound);
  invBroker.Handle_Add([fuelItem.itemID, sourceLocationID], session, {
    flag: STRUCTURE_FUEL_BAY_FLAG,
    qty: 3242,
  });

  const fuelBayRows = listContainerItems(
    98000000,
    structureID,
    STRUCTURE_FUEL_BAY_FLAG,
  );
  assert.deepEqual(
    fuelBayRows.map((item) => [item.typeID, item.stacksize, item.ownerID]),
    [[4247, 3242, 98000000]],
  );
  assert.equal(
    getRemoteListFields(invBroker.Handle_List([STRUCTURE_FUEL_BAY_FLAG], session, {}))
      .some((row) => Number(row.itemID) === Number(fuelBayRows[0].itemID)),
    true,
    "Expected StructureFuelBay List(flagStructureFuel) to expose the owner-corp fuel stack",
  );

  const invalidGrant = grantItemToCharacterLocation(
    session.characterID,
    sourceLocationID,
    ITEM_FLAGS.CARGO_HOLD,
    34,
    1,
    { singleton: false },
  );
  assert.equal(invalidGrant.success, true);
  assert.throws(
    () =>
      invBroker.Handle_Add(
        [invalidGrant.data.items[0].itemID, sourceLocationID],
        session,
        { flag: STRUCTURE_FUEL_BAY_FLAG, qty: 1 },
      ),
    (error) => getUserErrorMessage(error) === "NotEnoughCargoSpace",
  );
});

test("structure fitting rejects standup modules that the structure type cannot fit", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();
  structureState.clearStructureCaches();

  const session = buildSession();
  const sourceLocationID = 990880000004;
  const structureID = 1039888800004;
  const service = new InvBrokerService();

  const structureResult = structureState.upsertStructureRecord({
    structureID,
    typeID: 35832,
    name: "Structure Fit Test Astrahus",
    itemName: "Structure Fit Test Astrahus",
    ownerCorpID: 98000000,
    solarSystemID: 30000142,
    state: STRUCTURE_STATE.SHIELD_VULNERABLE,
    hasQuantumCore: true,
    quantumCoreItemTypeID: 56201,
    position: { x: 0, y: 0, z: 0 },
  });
  assert.equal(structureResult.success, true);

  const grantResult = grantItemToCharacterLocation(
    session.characterID,
    sourceLocationID,
    ITEM_FLAGS.CARGO_HOLD,
    35923,
    1,
    { singleton: true },
  );
  assert.equal(grantResult.success, true);
  const moduleItem = grantResult.data.items[0];

  const bound = service.Handle_GetInventoryFromId([structureID], session);
  session.currentBoundObjectID = extractBoundID(bound);

  const result = service.Handle_Add([moduleItem.itemID, sourceLocationID], session, {
    flag: 27,
    qty: 1,
  });

  const unchangedModule = findItemById(moduleItem.itemID);
  assert.equal(result, null);
  assert.equal(unchangedModule.locationID, sourceLocationID);
  assert.equal(unchangedModule.flagID, ITEM_FLAGS.CARGO_HOLD);
  assert.equal(listFittedItems(session.characterID, structureID).length, 0);
});

test("FitFitting can fit standup modules against a structure host", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();
  structureState.clearStructureCaches();

  const session = buildSession();
  const sourceLocationID = 990880000005;
  const structureID = 1039888800005;
  const service = new InvBrokerService();

  const structureResult = structureState.upsertStructureRecord({
    structureID,
    typeID: 35834,
    name: "Structure FitFitting Test Keepstar",
    itemName: "Structure FitFitting Test Keepstar",
    ownerCorpID: 98000000,
    solarSystemID: 30000142,
    state: STRUCTURE_STATE.SHIELD_VULNERABLE,
    hasQuantumCore: true,
    quantumCoreItemTypeID: 56207,
    position: { x: 0, y: 0, z: 0 },
  });
  assert.equal(structureResult.success, true);

  const grantResult = grantItemToCharacterLocation(
    session.characterID,
    sourceLocationID,
    ITEM_FLAGS.CARGO_HOLD,
    35923,
    1,
    { singleton: true },
  );
  assert.equal(grantResult.success, true);
  const moduleItem = grantResult.data.items[0];

  const missing = service.Handle_FitFitting(
    [
      structureID,
      null,
      { 35923: [moduleItem.itemID] },
      sourceLocationID,
      { 27: 35923 },
    ],
    session,
    {},
  );

  assert.deepEqual(missing.items || missing, []);
  const movedModule = findItemById(moduleItem.itemID);
  assert.equal(movedModule.locationID, structureID);
  assert.equal(movedModule.flagID, 27);
});

test("online activation evaluates structure modules against the structure dogma host", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();
  structureState.clearStructureCaches();

  const session = buildSession();
  const sourceLocationID = 990880000006;
  const structureID = 1039888800006;
  const invBroker = new InvBrokerService();
  const dogma = new DogmaService();

  const structureResult = structureState.upsertStructureRecord({
    structureID,
    typeID: 35834,
    name: "Structure Online Test Keepstar",
    itemName: "Structure Online Test Keepstar",
    ownerCorpID: 98000000,
    solarSystemID: 30000142,
    state: STRUCTURE_STATE.SHIELD_VULNERABLE,
    hasQuantumCore: true,
    quantumCoreItemTypeID: 56207,
    position: { x: 0, y: 0, z: 0 },
  });
  assert.equal(structureResult.success, true);

  const grantResult = grantItemToCharacterLocation(
    session.characterID,
    sourceLocationID,
    ITEM_FLAGS.CARGO_HOLD,
    35923,
    1,
    { singleton: true },
  );
  assert.equal(grantResult.success, true);
  const moduleItem = grantResult.data.items[0];

  const bound = invBroker.Handle_GetInventoryFromId([structureID], session);
  session.currentBoundObjectID = extractBoundID(bound);
  invBroker.Handle_Add([moduleItem.itemID, sourceLocationID], session, {
    flag: 27,
    qty: 1,
  });

  const onlineResult = dogma._setModuleOnlineState(
    structureID,
    moduleItem.itemID,
    true,
    session,
  );

  assert.equal(onlineResult.success, true);
  assert.equal(findItemById(moduleItem.itemID).moduleState.online, true);
});

test("controlled structures can activate fitted standup modules through the space runtime", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => {
    spaceRuntime._testing.clearScenes();
    restoreMutableTables(snapshot);
  });
  resetInventoryStoreForTests();
  structureState.clearStructureCaches();
  spaceRuntime._testing.clearScenes();

  const session = buildSession();
  const sourceLocationID = 990880000007;
  const structureID = 1039888800007;
  const invBroker = new InvBrokerService();
  const dogma = new DogmaService();

  const structureResult = structureState.upsertStructureRecord({
    structureID,
    typeID: 35834,
    name: "Structure Activation Test Keepstar",
    itemName: "Structure Activation Test Keepstar",
    ownerCorpID: 98000000,
    solarSystemID: 30000142,
    state: STRUCTURE_STATE.SHIELD_VULNERABLE,
    hasQuantumCore: true,
    quantumCoreItemTypeID: 56207,
    position: { x: 945000000, y: 0, z: 180000 },
  });
  assert.equal(structureResult.success, true);

  const grantResult = grantItemToCharacterLocation(
    session.characterID,
    sourceLocationID,
    ITEM_FLAGS.CARGO_HOLD,
    35947,
    1,
    { singleton: true },
  );
  assert.equal(grantResult.success, true);
  const moduleItem = grantResult.data.items[0];

  const bound = invBroker.Handle_GetInventoryFromId([structureID], session);
  session.currentBoundObjectID = extractBoundID(bound);
  invBroker.Handle_Add([moduleItem.itemID, sourceLocationID], session, {
    flag: 19,
    qty: 1,
  });
  assert.equal(
    dogma._setModuleOnlineState(structureID, moduleItem.itemID, true, session).success,
    true,
  );

  const scene = spaceRuntime.ensureScene(30000142);
  scene.syncStructureEntitiesFromState({ broadcast: false });
  const structureEntity = scene.getEntityByID(structureID);
  assert.equal(structureEntity && structureEntity.kind, "structure");

  const targetEntity = spaceRuntime._testing.buildRuntimeShipEntityForTesting({
    itemID: 910880000007,
    typeID: 606,
    characterID: 140880007,
    pilotCharacterID: 140880007,
    position: { x: 945050000, y: 0, z: 180000 },
    passiveResourceState: {
      mass: 1_000_000,
      agility: 0.5,
      maxVelocity: 300,
      maxTargetRange: 250_000,
      maxLockedTargets: 7,
      signatureRadius: 50,
      scanResolution: 500,
      capacitorCapacity: 1000,
      capacitorRechargeRate: 1000,
      shieldCapacity: 1000,
      shieldRechargeRate: 1000,
      armorHP: 1000,
      structureHP: 1000,
    },
  }, scene.systemID);
  assert.equal(scene.spawnDynamicEntity(targetEntity, { broadcast: false }).success, true);

  session.shipID = structureID;
  session.shipid = structureID;
  session.structureID = structureID;
  session.structureid = structureID;
  session.corporationID = 98000000;
  session.corpid = 98000000;
  session._space = {
    systemID: scene.systemID,
    shipID: structureID,
    observerKind: "structure",
    initialStateSent: true,
    visibleDynamicEntityIDs: new Set(),
    freshlyVisibleDynamicEntityIDs: new Set(),
    visibleBubbleScopedStaticEntityIDs: new Set(),
    timeDilation: scene.getTimeDilation(),
    simTimeMs: scene.getCurrentSimTimeMs(),
    simFileTime: scene.getCurrentFileTime(),
  };
  scene.sessions.set(session.clientID, session);

  assert.equal(
    scene.finalizeTargetLock(structureEntity, targetEntity, {
      nowMs: scene.getCurrentSimTimeMs(),
    }).success,
    true,
  );

  const activationResult = scene.activateGenericModule(
    session,
    findItemById(moduleItem.itemID),
    "",
    { targetID: targetEntity.itemID },
  );

  assert.equal(
    activationResult.success,
    true,
    `Expected structure module activation to succeed: ${activationResult.errorMsg || "unknown"}`,
  );
  assert.ok(
    structureEntity.activeModuleEffects instanceof Map &&
      structureEntity.activeModuleEffects.has(moduleItem.itemID),
    "Expected the controlled structure to own the running module effect",
  );
});
