const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const CharService = require(path.join(
  repoRoot,
  "server/src/services/character/charService",
));
const DogmaService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dogmaService",
));
const {
  syncShipFittingStateForSession,
  getActiveShipRecord,
  getCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  buildShipResourceState,
  getAttributeIDByNames,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));
const {
  getShipFittingSnapshot,
  resetFittingRuntimeForTests,
} = require(path.join(
  repoRoot,
  "server/src/_secondary/fitting/fittingRuntime",
));
const {
  findItemById,
  grantItemToCharacterStationHangar,
  moveItemToLocation,
  resetInventoryStoreForTests,
  setActiveShipForCharacter,
  spawnShipInStationHangar,
  updateInventoryItem,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  resolveItemByName,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemTypeRegistry",
));

const FLYCATCHER_TYPE_NAME = "Flycatcher";
const COPROCESSOR_TYPE_NAME = "Co-Processor I";
const MAPC_TYPE_NAME = "Micro Auxiliary Power Core I";
const LOW_SLOT_FLAG_0 = 11;
const LOW_SLOT_FLAG_1 = 12;
const ATTRIBUTE_CPU_OUTPUT = getAttributeIDByNames("cpuOutput") || 48;
const ATTRIBUTE_POWER_OUTPUT = getAttributeIDByNames("powerOutput") || 11;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function snapshotMutableTables() {
  return {
    characters: cloneValue(database.read("characters", "/").data || {}),
    identityState: cloneValue(database.read("identityState", "/").data || {}),
    items: cloneValue(database.read("items", "/").data || {}),
    skills: cloneValue(database.read("skills", "/").data || {}),
  };
}

function restoreMutableTables(snapshot) {
  database.write("characters", "/", cloneValue(snapshot.characters));
  database.write("identityState", "/", cloneValue(snapshot.identityState));
  database.write("items", "/", cloneValue(snapshot.items));
  database.write("skills", "/", cloneValue(snapshot.skills));
  database.flushAllSync();
  resetInventoryStoreForTests();
  resetFittingRuntimeForTests();
}

function resolveTypeIDByName(name) {
  const result = resolveItemByName(name);
  assert.equal(result.success, true, `Expected to resolve type ${name}`);
  return Number(result.match && result.match.typeID) || 0;
}

function createCharacter(userID, name) {
  const service = new CharService();
  const characterID = service.Handle_CreateCharacterWithDoll(
    [name, 5, 1, 1, null, null, 11],
    { userid: userID },
  );
  const characterRecord = getCharacterRecord(characterID);
  assert.ok(characterRecord, "Expected created character record");
  return {
    characterID,
    stationID: Number(characterRecord.stationID || characterRecord.stationid || 0),
  };
}

function fitModule(characterID, stationID, shipID, typeName, flagID) {
  const moduleTypeID = resolveTypeIDByName(typeName);
  const grantResult = grantItemToCharacterStationHangar(characterID, stationID, moduleTypeID, 1);
  assert.equal(grantResult.success, true, `Expected ${typeName} grant to succeed`);
  const grantedItem = grantResult.data.items[0];
  assert.ok(grantedItem, `Expected granted ${typeName} item`);

  const fitResult = moveItemToLocation(grantedItem.itemID, shipID, flagID);
  assert.equal(fitResult.success, true, `Expected ${typeName} fitting move to succeed`);

  return findItemById(grantedItem.itemID);
}

function setModuleOnlineState(itemID, online) {
  const updateResult = updateInventoryItem(itemID, (currentItem) => ({
    ...currentItem,
    moduleState: {
      ...(currentItem.moduleState || {}),
      online,
    },
  }));
  assert.equal(updateResult.success, true, "Expected module state update to succeed");
  return updateResult.data;
}

function createDockedSession(characterID, stationID, shipID) {
  return {
    userid: characterID + 900000,
    clientID: characterID + 910000,
    characterID,
    charid: characterID,
    stationid: stationID,
    stationID: stationID,
    shipID,
    shipid: shipID,
    activeShipID: shipID,
    socket: { destroyed: false },
    notifications: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
  };
}

function getModuleAttributeChangeItems(session) {
  const changes = [];
  for (const notification of session.notifications || []) {
    if (!notification || notification.name !== "OnModuleAttributeChanges") {
      continue;
    }
    for (const payloadEntry of notification.payload || []) {
      if (
        payloadEntry &&
        payloadEntry.type === "list" &&
        Array.isArray(payloadEntry.items)
      ) {
        changes.push(...payloadEntry.items);
      }
    }
  }
  return changes;
}

function findAttributeChange(session, itemID, attributeID, nextValue, previousValue) {
  return getModuleAttributeChangeItems(session).find((change) => (
    Array.isArray(change) &&
    Number(change[2]) === Number(itemID) &&
    Number(change[3]) === Number(attributeID) &&
    Math.abs((Number(change[5]) || 0) - Number(nextValue)) <= 1e-6 &&
    Math.abs((Number(change[6]) || 0) - Number(previousValue)) <= 1e-6
  ));
}

function setupFlycatcherWithUtilityLows(characterID, stationID) {
  const shipTypeID = resolveTypeIDByName(FLYCATCHER_TYPE_NAME);
  const shipResult = spawnShipInStationHangar(characterID, stationID, shipTypeID);
  assert.equal(shipResult.success, true, "Expected test ship spawn to succeed");
  const ship = shipResult.data;

  const activateShipResult = setActiveShipForCharacter(characterID, ship.itemID);
  assert.equal(activateShipResult.success, true, "Expected active ship swap to succeed");

  const mapc = fitModule(
    characterID,
    stationID,
    ship.itemID,
    MAPC_TYPE_NAME,
    LOW_SLOT_FLAG_0,
  );
  const coprocessor = fitModule(
    characterID,
    stationID,
    ship.itemID,
    COPROCESSOR_TYPE_NAME,
    LOW_SLOT_FLAG_1,
  );

  setModuleOnlineState(mapc.itemID, false);
  setModuleOnlineState(coprocessor.itemID, false);

  return {
    ship: getActiveShipRecord(characterID),
    mapc: findItemById(mapc.itemID),
    coprocessor: findItemById(coprocessor.itemID),
  };
}

test("dogma online changes publish full ship fitting attribute diffs for cpu and power output", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();
  resetFittingRuntimeForTests();

  const { characterID, stationID } = createCharacter(980001, "Fitting Output Test");
  const { ship, mapc, coprocessor } = setupFlycatcherWithUtilityLows(
    characterID,
    stationID,
  );
  const session = createDockedSession(characterID, stationID, ship.itemID);
  const dogma = new DogmaService();

  getShipFittingSnapshot(characterID, ship.itemID, {
    shipItem: ship,
    reason: "test.warm",
  });

  const offlineState = buildShipResourceState(characterID, getActiveShipRecord(characterID));
  const onlineMapcResult = dogma._setModuleOnlineState(ship.itemID, mapc.itemID, true, session);
  assert.equal(onlineMapcResult.success, true, "Expected MAPC online to succeed");
  const mapcOnlineState = buildShipResourceState(characterID, getActiveShipRecord(characterID));
  assert.ok(
    findAttributeChange(
      session,
      ship.itemID,
      ATTRIBUTE_POWER_OUTPUT,
      mapcOnlineState.powerOutput,
      offlineState.powerOutput,
    ),
    "Expected MAPC onlining to notify ship powerOutput change",
  );

  session.notifications = [];
  const beforeCpuOutput = buildShipResourceState(characterID, getActiveShipRecord(characterID));
  const onlineCoProcessorResult = dogma._setModuleOnlineState(
    ship.itemID,
    coprocessor.itemID,
    true,
    session,
  );
  assert.equal(onlineCoProcessorResult.success, true, "Expected co-processor online to succeed");
  const afterCpuOutput = buildShipResourceState(characterID, getActiveShipRecord(characterID));
  assert.ok(
    findAttributeChange(
      session,
      ship.itemID,
      ATTRIBUTE_CPU_OUTPUT,
      afterCpuOutput.cpuOutput,
      beforeCpuOutput.cpuOutput,
    ),
    "Expected co-processor onlining to notify ship cpuOutput change",
  );
});

test("ship fitting sync reuses cached fitting truth to publish ship output changes after fit mutations", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();
  resetFittingRuntimeForTests();

  const { characterID, stationID } = createCharacter(980002, "Fitting Sync Test");
  const shipTypeID = resolveTypeIDByName(FLYCATCHER_TYPE_NAME);
  const shipResult = spawnShipInStationHangar(characterID, stationID, shipTypeID);
  assert.equal(shipResult.success, true, "Expected test ship spawn to succeed");
  const ship = shipResult.data;
  const activateShipResult = setActiveShipForCharacter(characterID, ship.itemID);
  assert.equal(activateShipResult.success, true, "Expected active ship swap to succeed");

  const session = createDockedSession(characterID, stationID, ship.itemID);
  const baselineState = buildShipResourceState(characterID, getActiveShipRecord(characterID));
  getShipFittingSnapshot(characterID, ship.itemID, {
    shipItem: ship,
    reason: "test.sync-baseline",
  });

  const coprocessor = fitModule(
    characterID,
    stationID,
    ship.itemID,
    COPROCESSOR_TYPE_NAME,
    LOW_SLOT_FLAG_0,
  );
  setModuleOnlineState(coprocessor.itemID, true);
  const fittedState = buildShipResourceState(characterID, getActiveShipRecord(characterID));

  const syncCount = syncShipFittingStateForSession(session, ship.itemID, {
    includeOfflineModules: true,
    includeCharges: true,
    emitChargeInventoryRows: true,
  });
  assert.ok(syncCount > 0, "Expected fitting sync to emit module rows");
  assert.ok(
    findAttributeChange(
      session,
      ship.itemID,
      ATTRIBUTE_CPU_OUTPUT,
      fittedState.cpuOutput,
      baselineState.cpuOutput,
    ),
    "Expected fitting sync to notify ship cpuOutput change from the cached baseline",
  );
});
