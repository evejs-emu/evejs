const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const CharService = require(path.join(
  repoRoot,
  "server/src/services/character/charService",
));
const InvBrokerService = require(path.join(
  repoRoot,
  "server/src/services/inventory/invBrokerService",
));
const {
  applyCharacterToSession,
  getActiveShipRecord,
  getCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  ITEM_FLAGS,
  findItemById,
  moveItemToLocation,
  resetInventoryStoreForTests,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  getFittedModuleItems,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));
const {
  unwrapMarshalValue,
} = require(path.join(
  repoRoot,
  "server/src/services/_shared/serviceHelpers",
));

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

function buildDockedSession(characterID, stationID, shipID) {
  return {
    userid: characterID + 610000,
    clientID: characterID + 620000,
    characterID,
    charid: characterID,
    stationid: stationID,
    stationID: stationID,
    shipID,
    shipid: shipID,
    activeShipID: shipID,
    currentBoundObjectID: null,
    socket: { destroyed: false },
    notifications: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
    sendSessionChange() {},
  };
}

function extractBoundID(value) {
  return (
    value &&
    value.type === "substruct" &&
    value.value &&
    value.value.type === "substream" &&
    Array.isArray(value.value.value)
      ? value.value.value[0]
      : null
  );
}

function bindShipInventory(service, session, shipID) {
  const bound = service.Handle_GetInventoryFromId([shipID], session);
  const boundID = extractBoundID(bound);
  assert.ok(boundID, "Expected ship inventory bind to succeed");
  session.currentBoundObjectID = boundID;
}

function getStarterModules(characterID, shipID) {
  const fittedModules = getFittedModuleItems(characterID, shipID)
    .filter((item) => item && Number(item.itemID) > 0)
    .sort((left, right) => (Number(left.flagID) || 0) - (Number(right.flagID) || 0));
  assert.ok(fittedModules.length >= 2, "Expected rookie ship to start with at least two fitted modules");
  return fittedModules.slice(0, 2).map((item) => ({
    itemID: Number(item.itemID) || 0,
    typeID: Number(item.typeID) || 0,
    flagID: Number(item.flagID) || 0,
  }));
}

function buildItemsToFit(modules) {
  const byType = {};
  for (const module of modules) {
    const typeKey = String(Number(module.typeID) || 0);
    if (!Array.isArray(byType[typeKey])) {
      byType[typeKey] = [];
    }
    byType[typeKey].push(Number(module.itemID) || 0);
  }
  return byType;
}

function buildFittingPayload(modules) {
  const modulesByFlag = {};
  for (const module of modules) {
    modulesByFlag[String(Number(module.flagID) || 0)] = Number(module.typeID) || 0;
  }
  return {
    modulesByFlag,
    chargesByType: {},
    dronesByType: {},
    fightersByTypeID: {},
    iceByType: {},
    implantsByTypeID: {},
  };
}

function buildMarshalSet(values) {
  return {
    type: "objectex1",
    header: [
      { type: "token", value: "__builtin__.set" },
      [{ type: "list", items: values }],
    ],
    list: [],
    dict: [],
  };
}

function buildDefaultDictSetItemsToFit(modules) {
  const byType = new Map();
  for (const module of modules) {
    const typeID = Number(module.typeID) || 0;
    if (!byType.has(typeID)) {
      byType.set(typeID, []);
    }
    byType.get(typeID).push(Number(module.itemID) || 0);
  }

  return {
    type: "objectex1",
    header: [
      { type: "token", value: "collections.defaultdict" },
      [buildMarshalSet([])],
    ],
    list: [],
    dict: [...byType.entries()].map(([typeID, itemIDs]) => [
      typeID,
      buildMarshalSet(itemIDs),
    ]),
  };
}

test("FitFitting returns an empty failed list and refits saved modules onto the active ship", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const { characterID, stationID } = createCharacter(970101, "Saved Fitbutton Test");
  const ship = getActiveShipRecord(characterID);
  assert.ok(ship, "Expected active rookie ship");

  const starterModules = getStarterModules(characterID, ship.itemID);
  for (const module of starterModules) {
    const moveResult = moveItemToLocation(module.itemID, stationID, ITEM_FLAGS.HANGAR);
    assert.equal(moveResult.success, true, "Expected starter module to move to hangar");
  }

  const service = new InvBrokerService();
  const session = buildDockedSession(characterID, stationID, ship.itemID);
  const applyResult = applyCharacterToSession(session, characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true, "Expected docked session apply");
  bindShipInventory(service, session, ship.itemID);

  const result = service.Handle_FitFitting(
    [
      ship.itemID,
      ship.typeID,
      buildItemsToFit(starterModules),
      stationID,
      buildFittingPayload(starterModules),
      {},
      false,
    ],
    session,
    null,
  );

  assert.deepEqual(
    unwrapMarshalValue(result),
    [],
    "Expected FitFitting success path to return an empty failed-items list",
  );

  for (const module of starterModules) {
    const currentItem = findItemById(module.itemID);
    assert.ok(currentItem, "Expected refitted module item");
    assert.equal(Number(currentItem.locationID), Number(ship.itemID));
    assert.equal(Number(currentItem.flagID), Number(module.flagID));
  }
});

test("FitFitting accepts the client defaultdict(set) item map used by saved fits", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const { characterID, stationID } = createCharacter(970103, "Saved Defaultdict Test");
  const ship = getActiveShipRecord(characterID);
  assert.ok(ship, "Expected active rookie ship");

  const starterModules = getStarterModules(characterID, ship.itemID);
  for (const module of starterModules) {
    const moveResult = moveItemToLocation(module.itemID, stationID, ITEM_FLAGS.HANGAR);
    assert.equal(moveResult.success, true, "Expected starter module to move to hangar");
  }

  const service = new InvBrokerService();
  const session = buildDockedSession(characterID, stationID, ship.itemID);
  const applyResult = applyCharacterToSession(session, characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true, "Expected docked session apply");
  bindShipInventory(service, session, ship.itemID);

  const result = service.Handle_FitFitting(
    [
      ship.itemID,
      ship.typeID,
      buildDefaultDictSetItemsToFit(starterModules),
      stationID,
      buildFittingPayload(starterModules),
      {},
      false,
    ],
    session,
    null,
  );

  assert.deepEqual(
    unwrapMarshalValue(result),
    [],
    "Expected FitFitting to consume the real client defaultdict(set) item map",
  );

  for (const module of starterModules) {
    const currentItem = findItemById(module.itemID);
    assert.ok(currentItem, "Expected refitted module item");
    assert.equal(Number(currentItem.locationID), Number(ship.itemID));
    assert.equal(Number(currentItem.flagID), Number(module.flagID));
  }
});

test("FitFitting returns missing type quantities instead of null when a saved fit cannot be completed", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const { characterID, stationID } = createCharacter(970102, "Saved Failure Test");
  const ship = getActiveShipRecord(characterID);
  assert.ok(ship, "Expected active rookie ship");

  const starterModules = getStarterModules(characterID, ship.itemID);
  for (const module of starterModules) {
    const moveResult = moveItemToLocation(module.itemID, stationID, ITEM_FLAGS.HANGAR);
    assert.equal(moveResult.success, true, "Expected starter module to move to hangar");
  }

  const onlyFirstModule = starterModules.slice(0, 1);
  const missingModule = starterModules[1];
  const service = new InvBrokerService();
  const session = buildDockedSession(characterID, stationID, ship.itemID);
  const applyResult = applyCharacterToSession(session, characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true, "Expected docked session apply");
  bindShipInventory(service, session, ship.itemID);

  const result = service.Handle_FitFitting(
    [
      ship.itemID,
      ship.typeID,
      buildItemsToFit(onlyFirstModule),
      stationID,
      buildFittingPayload(starterModules),
      {},
      false,
    ],
    session,
    null,
  );

  assert.deepEqual(
    unwrapMarshalValue(result),
    [[missingModule.typeID, 1]],
    "Expected FitFitting failure path to return a client-iterable missing-items list",
  );

  const fittedModule = findItemById(onlyFirstModule[0].itemID);
  assert.ok(fittedModule, "Expected available module to still fit successfully");
  assert.equal(Number(fittedModule.locationID), Number(ship.itemID));
  assert.equal(Number(fittedModule.flagID), Number(onlyFirstModule[0].flagID));
});
