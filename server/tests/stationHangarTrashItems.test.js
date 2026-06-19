const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const InvBrokerService = require(path.join(
  repoRoot,
  "server/src/services/inventory/invBrokerService",
));
const {
  applyCharacterToSession,
  getCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  ITEM_FLAGS,
  grantItemToCharacterLocation,
  findItemById,
  listContainerItems,
  resetInventoryStoreForTests,
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
      const stationID = Number(
        characterRecord && (characterRecord.stationID || characterRecord.stationid || 0),
      ) || 0;
      if (!characterRecord || stationID <= 0) {
        return null;
      }
      return { characterID, characterRecord, stationID };
    })
    .filter(Boolean)
    .sort((left, right) => left.characterID - right.characterID);

  assert.ok(candidates.length > 0, "Expected at least one docked character");
  return candidates[0];
}

function buildSession(candidate) {
  return {
    clientID: candidate.characterID + 83000,
    userid: candidate.characterID,
    socket: { destroyed: false },
    currentBoundObjectID: null,
    notifications: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
    sendSessionChange() {},
  };
}

function bindStationHangar(service, session) {
  const bound = service.Handle_GetInventory([10004], session);
  const boundID =
    bound &&
    bound.type === "substruct" &&
    bound.value &&
    bound.value.type === "substream" &&
    Array.isArray(bound.value.value)
      ? bound.value.value[0]
      : null;
  assert.ok(boundID, "Expected GetInventory to return a bound station hangar");
  session.currentBoundObjectID = boundID;
}

test("TrashItems removes a single item from the station hangar", (t) => {
  const originalItems = cloneValue(readItemsTable());
  t.after(() => {
    writeItemsTable(originalItems);
    resetInventoryStoreForTests();
  });

  const candidate = getDockedCandidate();
  const session = buildSession(candidate);
  const service = new InvBrokerService();
  const tritanium = resolveItemByName("Tritanium");
  assert.equal(tritanium && tritanium.success, true, "Expected Tritanium metadata");

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const grantResult = grantItemToCharacterLocation(
    candidate.characterID,
    candidate.stationID,
    ITEM_FLAGS.HANGAR,
    tritanium.match,
    10,
    { transient: true },
  );
  assert.equal(grantResult.success, true, "Expected temporary item grant to succeed");
  const sourceItem = grantResult.data.items[0];
  assert.ok(sourceItem && sourceItem.itemID, "Expected a granted item with an itemID");

  bindStationHangar(service, session);

  const result = service.Handle_TrashItems(
    [{ type: "list", items: [sourceItem.itemID] }, candidate.stationID],
    session,
  );

  assert.equal(result, null, "Expected TrashItems to return null");
  assert.equal(findItemById(sourceItem.itemID), null, "Expected trashed item to be removed");
  assert.equal(
    listContainerItems(
      candidate.characterID,
      candidate.stationID,
      ITEM_FLAGS.HANGAR,
    ).some((item) => Number(item.itemID) === Number(sourceItem.itemID)),
    false,
    "Expected the trashed item to be removed from the station hangar",
  );
});

test("TrashItems removes multiple items from the station hangar in a single call", (t) => {
  const originalItems = cloneValue(readItemsTable());
  t.after(() => {
    writeItemsTable(originalItems);
    resetInventoryStoreForTests();
  });

  const candidate = getDockedCandidate();
  const session = buildSession(candidate);
  const service = new InvBrokerService();
  const tritanium = resolveItemByName("Tritanium");
  const pyerite = resolveItemByName("Pyerite");
  assert.equal(tritanium && tritanium.success, true, "Expected Tritanium metadata");
  assert.equal(pyerite && pyerite.success, true, "Expected Pyerite metadata");

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const grantResult1 = grantItemToCharacterLocation(
    candidate.characterID,
    candidate.stationID,
    ITEM_FLAGS.HANGAR,
    tritanium.match,
    10,
    { transient: true },
  );
  const grantResult2 = grantItemToCharacterLocation(
    candidate.characterID,
    candidate.stationID,
    ITEM_FLAGS.HANGAR,
    pyerite.match,
    20,
    { transient: true },
  );
  assert.equal(grantResult1.success, true, "Expected first item grant to succeed");
  assert.equal(grantResult2.success, true, "Expected second item grant to succeed");
  const item1 = grantResult1.data.items[0];
  const item2 = grantResult2.data.items[0];
  assert.ok(item1 && item1.itemID, "Expected first granted item to have an itemID");
  assert.ok(item2 && item2.itemID, "Expected second granted item to have an itemID");

  bindStationHangar(service, session);

  const result = service.Handle_TrashItems(
    [
      { type: "list", items: [item1.itemID, item2.itemID] },
      candidate.stationID,
    ],
    session,
  );

  assert.equal(result, null, "Expected TrashItems to return null");
  const hangarItems = listContainerItems(
    candidate.characterID,
    candidate.stationID,
    ITEM_FLAGS.HANGAR,
  );
  assert.equal(
    hangarItems.some((item) => Number(item.itemID) === Number(item1.itemID)),
    false,
    "Expected first trashed item to be removed from the station hangar",
  );
  assert.equal(
    hangarItems.some((item) => Number(item.itemID) === Number(item2.itemID)),
    false,
    "Expected second trashed item to be removed from the station hangar",
  );
});

test("TrashItems emits inventory change notifications for removed items", (t) => {
  const originalItems = cloneValue(readItemsTable());
  t.after(() => {
    writeItemsTable(originalItems);
    resetInventoryStoreForTests();
  });

  const candidate = getDockedCandidate();
  const session = buildSession(candidate);
  const service = new InvBrokerService();
  const tritanium = resolveItemByName("Tritanium");
  assert.equal(tritanium && tritanium.success, true, "Expected Tritanium metadata");

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const grantResult = grantItemToCharacterLocation(
    candidate.characterID,
    candidate.stationID,
    ITEM_FLAGS.HANGAR,
    tritanium.match,
    5,
    { transient: true },
  );
  assert.equal(grantResult.success, true);
  const sourceItem = grantResult.data.items[0];

  bindStationHangar(service, session);

  const notificationsBefore = session.notifications.length;

  const result = service.Handle_TrashItems(
    [{ type: "list", items: [sourceItem.itemID] }, candidate.stationID],
    session,
  );

  assert.equal(result, null, "Expected TrashItems to return null");
  assert.ok(
    session.notifications.length > notificationsBefore,
    "Expected TrashItems to emit at least one inventory change notification",
  );
});
