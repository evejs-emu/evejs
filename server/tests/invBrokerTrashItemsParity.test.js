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
  getActiveShipRecord,
  getCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  ITEM_FLAGS,
  buildInventoryItem,
  findItemById,
  listContainerItems,
  resetInventoryStoreForTests,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
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

function nextSyntheticItemID(items) {
  let maxItemID = 1_990_000_000;
  for (const rawItem of Object.values(items || {})) {
    const itemID = Number(rawItem && rawItem.itemID) || 0;
    if (itemID > maxItemID) {
      maxItemID = itemID;
    }
  }
  return maxItemID + 1;
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
        shipID: Number(ship.shipID) || 0,
        characterRecord,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.characterID - right.characterID);

  assert.ok(candidates.length > 0, "Expected at least one docked character");
  return candidates[0];
}

function buildSession() {
  return {
    clientID: 998877,
    userid: 998877,
    currentBoundObjectID: null,
    notifications: [],
    socket: { destroyed: false },
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
    sendSessionChange() {},
  };
}

test("/invbroker TrashItems removes docked ship cargo items through junk-location item changes", async (t) => {
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

  const items = cloneValue(readItemsTable());
  const trashedItemID = nextSyntheticItemID(items);
  items[String(trashedItemID)] = buildInventoryItem({
    itemID: trashedItemID,
    typeID: 34,
    ownerID: candidate.characterID,
    locationID: candidate.shipID,
    flagID: ITEM_FLAGS.CARGO_HOLD,
    itemName: "Tritanium",
    quantity: 1234,
    stacksize: 1234,
    singleton: 0,
  });
  writeItemsTable(items);
  resetInventoryStoreForTests();

  const service = new InvBrokerService();
  const result = service.Handle_TrashItems(
    [{ type: "list", items: [trashedItemID] }, candidate.stationID],
    session,
  );

  assert.equal(result, null);
  assert.equal(findItemById(trashedItemID), null, "Expected trashed item to be removed from the DB");
  assert.equal(
    listContainerItems(candidate.characterID, candidate.shipID, ITEM_FLAGS.CARGO_HOLD)
      .some((item) => Number(item.itemID) === trashedItemID),
    false,
    "Expected trashed cargo item to disappear from ship cargo",
  );

  const itemChangeNotification = session.notifications.find(
    (notification) => notification.name === "OnItemChange",
  );
  assert.ok(itemChangeNotification, "Expected a client inventory item-change notification");
  const itemRow =
    itemChangeNotification.payload &&
    Array.isArray(itemChangeNotification.payload) &&
    itemChangeNotification.payload[0] &&
    itemChangeNotification.payload[0].type === "packedrow"
      ? itemChangeNotification.payload[0].fields
      : null;
  assert.ok(itemRow && typeof itemRow === "object", "Expected OnItemChange to carry a packedrow item payload");
  assert.equal(Number(itemRow.itemID) || 0, trashedItemID);
  assert.equal(Number(itemRow.ownerID) || 0, candidate.characterID);
  assert.equal(Number(itemRow.locationID) || 0, 6, "Expected trashed items to move into the client junk location");
});

test("/invbroker TrashItems refuses to trash the active ship", async (t) => {
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

  const service = new InvBrokerService();
  const result = service.Handle_TrashItems(
    [{ type: "list", items: [candidate.shipID] }, candidate.stationID],
    session,
  );

  assert.deepEqual(result, ["CannotTrashItem"]);
  assert.ok(findItemById(candidate.shipID), "Expected the active ship to remain present");
});
