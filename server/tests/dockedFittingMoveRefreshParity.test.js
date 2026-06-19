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
  findItemById,
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
  getShipFittingSnapshot,
  resetFittingRuntimeForTests,
} = require(path.join(
  repoRoot,
  "server/src/_secondary/fitting/fittingRuntime",
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
  resetFittingRuntimeForTests();
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
    userid: characterID + 710000,
    clientID: characterID + 720000,
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

function bindStationHangar(service, session) {
  const bound = service.Handle_GetInventory([10004], session);
  const boundID = extractBoundID(bound);
  assert.ok(boundID, "Expected station hangar bind to succeed");
  session.currentBoundObjectID = boundID;
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
  assert.ok(
    fittedModules.length >= 2,
    "Expected rookie ship to start with at least two fitted modules",
  );
  return fittedModules.slice(0, 2).map((item) => ({
    itemID: Number(item.itemID) || 0,
    flagID: Number(item.flagID) || 0,
  }));
}

function extractOnItemChangeRawItemIDs(notifications) {
  return (Array.isArray(notifications) ? notifications : [])
    .filter((notification) => notification && notification.name === "OnItemChange")
    .map((notification) => {
      const payload = Array.isArray(notification.payload) ? notification.payload[0] : null;
      const itemRow =
        payload &&
        payload.type === "packedrow" &&
        payload.fields &&
        typeof payload.fields === "object"
          ? payload.fields
          : null;
      return itemRow ? itemRow.itemID : null;
    })
    .filter((itemID) => itemID !== null && itemID !== undefined);
}

function countRawOnItemChangesByItemID(notifications, expectedItemID) {
  const numericExpectedItemID = Number(expectedItemID) || 0;
  return extractOnItemChangeRawItemIDs(notifications).filter(
    (itemID) => Number(itemID) === numericExpectedItemID,
  ).length;
}

function hasModuleAttributeChanges(notifications) {
  return (Array.isArray(notifications) ? notifications : []).some(
    (notification) => notification && notification.name === "OnModuleAttributeChanges",
  );
}

test("docked unfit does not replay untouched fitted modules back into the client", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();
  resetFittingRuntimeForTests();

  const { characterID, stationID } = createCharacter(980201, "DockedFitMoveAlpha");
  const ship = getActiveShipRecord(characterID);
  assert.ok(ship, "Expected active rookie ship");
  const [movedModule, untouchedModule] = getStarterModules(characterID, ship.itemID);

  const service = new InvBrokerService();
  const session = buildDockedSession(characterID, stationID, ship.itemID);
  const applyResult = applyCharacterToSession(session, characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true, "Expected session application to succeed");

  bindStationHangar(service, session);
  getShipFittingSnapshot(characterID, ship.itemID, {
    shipItem: getActiveShipRecord(characterID),
    reason: "test.docked-unfit-warm",
  });

  session.notifications = [];
  service.Handle_Add([movedModule.itemID, ship.itemID], session, null);

  const movedItem = findItemById(movedModule.itemID);
  assert.equal(Number(movedItem && movedItem.locationID) || 0, stationID);
  assert.equal(
    countRawOnItemChangesByItemID(session.notifications, movedModule.itemID),
    1,
    "Expected only the moved module row to be sent for the unfit action",
  );
  assert.equal(
    countRawOnItemChangesByItemID(session.notifications, untouchedModule.itemID),
    0,
    "Expected docked unfit to avoid replaying untouched fitted modules",
  );
  assert.equal(
    hasModuleAttributeChanges(session.notifications),
    true,
    "Expected docked unfit to keep publishing fitting attribute diffs",
  );
});

test("docked refit does not replay untouched fitted modules back into the client", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();
  resetFittingRuntimeForTests();

  const { characterID, stationID } = createCharacter(980202, "DockedFitMoveBeta");
  const ship = getActiveShipRecord(characterID);
  assert.ok(ship, "Expected active rookie ship");
  const [movedModule, untouchedModule] = getStarterModules(characterID, ship.itemID);

  const service = new InvBrokerService();
  const session = buildDockedSession(characterID, stationID, ship.itemID);
  const applyResult = applyCharacterToSession(session, characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true, "Expected session application to succeed");

  bindStationHangar(service, session);
  service.Handle_Add([movedModule.itemID, ship.itemID], session, null);
  assert.equal(Number(findItemById(movedModule.itemID)?.locationID) || 0, stationID);

  bindShipInventory(service, session, ship.itemID);
  getShipFittingSnapshot(characterID, ship.itemID, {
    shipItem: getActiveShipRecord(characterID),
    reason: "test.docked-refit-warm",
  });

  session.notifications = [];
  service.Handle_Add(
    [movedModule.itemID, stationID],
    session,
    { flag: movedModule.flagID },
  );

  const refittedItem = findItemById(movedModule.itemID);
  assert.equal(Number(refittedItem && refittedItem.locationID) || 0, ship.itemID);
  assert.equal(Number(refittedItem && refittedItem.flagID) || 0, movedModule.flagID);
  assert.equal(
    countRawOnItemChangesByItemID(session.notifications, movedModule.itemID),
    1,
    "Expected only the moved module row to be sent for the refit action",
  );
  assert.equal(
    countRawOnItemChangesByItemID(session.notifications, untouchedModule.itemID),
    0,
    "Expected docked refit to avoid replaying untouched fitted modules",
  );
  assert.equal(
    hasModuleAttributeChanges(session.notifications),
    true,
    "Expected docked refit to keep publishing fitting attribute diffs",
  );
});
