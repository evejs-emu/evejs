const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const RepackagingService = require(path.join(
  repoRoot,
  "server/src/services/station/repackagingService",
));
const RepairService = require(path.join(
  repoRoot,
  "server/src/services/station/repairService",
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
  grantItemToCharacterLocation,
  listContainerItems,
  resetInventoryStoreForTests,
  spawnShipInStationHangar,
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

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function readItemsTable() {
  const result = database.read("items", "/");
  assert.equal(result.success, true, "Failed to read items");
  return result.data || {};
}

function writeItemsTable(items) {
  const result = database.write("items", "/", items);
  assert.equal(result.success, true, "Failed to write items");
}

function getDockedCandidate() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Failed to read characters");

  const candidates = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .map((characterID) => {
      const characterRecord = getCharacterRecord(characterID);
      const ship = getActiveShipRecord(characterID);
      const stationID = Number(
        characterRecord && (characterRecord.stationID || characterRecord.stationid || 0),
      ) || 0;
      if (!characterRecord || !ship || stationID <= 0) {
        return null;
      }

      return {
        characterID,
        stationID,
        shipID: Number(ship.shipID || ship.itemID) || 0,
        shipTypeID: Number(ship.shipTypeID || ship.typeID) || 0,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.characterID - right.characterID);

  assert.ok(candidates.length > 0, "Expected at least one docked character");
  return candidates[0];
}

function buildSession() {
  return {
    clientID: 992211,
    userid: 992211,
    currentBoundObjectID: null,
    notifications: [],
    socket: { destroyed: false },
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
    sendSessionChange() {},
  };
}

function buildRepackageArgs(stationID, itemIDs) {
  return [{
    type: "dict",
    entries: [[
      stationID,
      {
        type: "list",
        items: itemIDs.map((itemID) => ({
          type: "tuple",
          items: [itemID, stationID],
        })),
      },
    ]],
  }];
}

test("RepackageItems repackages a singleton non-ship item from the station hangar", (t) => {
  const originalItems = cloneValue(readItemsTable());
  t.after(() => {
    writeItemsTable(originalItems);
    resetInventoryStoreForTests();
  });

  const candidate = getDockedCandidate();
  const session = buildSession();
  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const moduleType = resolveItemByName("Civilian Gatling Autocannon");
  assert.equal(moduleType && moduleType.success, true, "Expected module metadata");

  const grantResult = grantItemToCharacterLocation(
    candidate.characterID,
    candidate.stationID,
    ITEM_FLAGS.HANGAR,
    moduleType.match,
    1,
    { transient: true, singleton: true },
  );
  assert.equal(grantResult.success, true, "Expected hangar item grant to succeed");
  const item = grantResult.data.items[0];
  assert.ok(item && item.itemID, "Expected a singleton hangar item");

  const service = new RepackagingService();
  const result = service.Handle_RepackageItems(
    buildRepackageArgs(candidate.stationID, [item.itemID]),
    session,
  );

  assert.equal(result, null);
  const updatedItem = findItemById(item.itemID);
  assert.ok(updatedItem, "Expected repackaged item to remain present");
  assert.equal(Number(updatedItem.singleton) || 0, 0);
  assert.equal(Number(updatedItem.quantity) || 0, 1);
  assert.equal(Number(updatedItem.stacksize) || 0, 1);
  assert.equal(Number(updatedItem.locationID) || 0, candidate.stationID);
  assert.equal(Number(updatedItem.flagID) || 0, ITEM_FLAGS.HANGAR);
});

test("RepairSvc UnasembleItems repackages a stored ship in the station hangar", (t) => {
  const originalItems = cloneValue(readItemsTable());
  t.after(() => {
    writeItemsTable(originalItems);
    resetInventoryStoreForTests();
  });

  const candidate = getDockedCandidate();
  const session = buildSession();
  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const shipResult = spawnShipInStationHangar(
    candidate.characterID,
    candidate.stationID,
    candidate.shipTypeID,
  );
  assert.equal(shipResult.success, true, "Expected temporary ship spawn to succeed");
  const ship = shipResult.data;
  assert.ok(ship && ship.itemID, "Expected a spawned stored ship");

  const service = new RepairService();
  const result = service.Handle_UnasembleItems(
    buildRepackageArgs(candidate.stationID, [ship.itemID]),
    session,
  );

  assert.equal(result, null);
  const updatedShip = findItemById(ship.itemID);
  assert.ok(updatedShip, "Expected repackaged ship to remain present");
  assert.equal(Number(updatedShip.singleton) || 0, 0);
  assert.equal(Number(updatedShip.quantity) || 0, 1);
  assert.equal(Number(updatedShip.stacksize) || 0, 1);
});

test("RepackageItems refuses to repackage the active ship", (t) => {
  const originalItems = cloneValue(readItemsTable());
  t.after(() => {
    writeItemsTable(originalItems);
    resetInventoryStoreForTests();
  });

  const candidate = getDockedCandidate();
  const session = buildSession();
  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const service = new RepackagingService();
  const result = service.Handle_RepackageItems(
    buildRepackageArgs(candidate.stationID, [candidate.shipID]),
    session,
  );

  assert.equal(result, null);
  const activeShip = findItemById(candidate.shipID);
  assert.ok(activeShip, "Expected the active ship to remain present");
  assert.equal(Number(activeShip.singleton) || 0, 1);
  assert.equal(Number(activeShip.quantity) || 0, -1);
});

test("RepackageItems refuses items outside the station hangar", (t) => {
  const originalItems = cloneValue(readItemsTable());
  t.after(() => {
    writeItemsTable(originalItems);
    resetInventoryStoreForTests();
  });

  const candidate = getDockedCandidate();
  const session = buildSession();
  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const moduleType = resolveItemByName("Civilian Gatling Autocannon");
  assert.equal(moduleType && moduleType.success, true, "Expected module metadata");

  const grantResult = grantItemToCharacterLocation(
    candidate.characterID,
    candidate.shipID,
    ITEM_FLAGS.CARGO_HOLD,
    moduleType.match,
    1,
    { transient: true, singleton: true },
  );
  assert.equal(grantResult.success, true, "Expected cargo item grant to succeed");
  const item = grantResult.data.items[0];

  const service = new RepackagingService();
  const result = service.Handle_RepackageItems(
    buildRepackageArgs(candidate.stationID, [item.itemID]),
    session,
  );

  assert.equal(result, null);
  const updatedItem = findItemById(item.itemID);
  assert.ok(updatedItem, "Expected outside-hangar item to remain present");
  assert.equal(Number(updatedItem.singleton) || 0, 1);
  assert.equal(Number(updatedItem.locationID) || 0, candidate.shipID);
  assert.equal(Number(updatedItem.flagID) || 0, ITEM_FLAGS.CARGO_HOLD);
});

test("RepackageItems refuses ships with nested contents", (t) => {
  const originalItems = cloneValue(readItemsTable());
  t.after(() => {
    writeItemsTable(originalItems);
    resetInventoryStoreForTests();
  });

  const candidate = getDockedCandidate();
  const session = buildSession();
  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const shipResult = spawnShipInStationHangar(
    candidate.characterID,
    candidate.stationID,
    candidate.shipTypeID,
  );
  assert.equal(shipResult.success, true, "Expected temporary ship spawn to succeed");
  const ship = shipResult.data;

  const cargoType = resolveItemByName("Tritanium");
  assert.equal(cargoType && cargoType.success, true, "Expected cargo metadata");

  const grantResult = grantItemToCharacterLocation(
    candidate.characterID,
    ship.itemID,
    ITEM_FLAGS.CARGO_HOLD,
    cargoType.match,
    25,
    { transient: true },
  );
  assert.equal(grantResult.success, true, "Expected nested cargo grant to succeed");
  assert.equal(
    listContainerItems(candidate.characterID, ship.itemID, ITEM_FLAGS.CARGO_HOLD).length > 0,
    true,
    "Expected the temporary ship to have nested cargo",
  );

  const service = new RepackagingService();
  const result = service.Handle_RepackageItems(
    buildRepackageArgs(candidate.stationID, [ship.itemID]),
    session,
  );

  assert.equal(result, null);
  const updatedShip = findItemById(ship.itemID);
  assert.ok(updatedShip, "Expected ship with nested contents to remain present");
  assert.equal(Number(updatedShip.singleton) || 0, 1);
  assert.equal(Number(updatedShip.quantity) || 0, -1);
});
