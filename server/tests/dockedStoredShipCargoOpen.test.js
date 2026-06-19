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
  getCharacterShips,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  ITEM_FLAGS,
  buildInventoryItem,
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

function getDockedCandidate() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Failed to read characters");

  const candidates = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .map((characterID) => {
      const characterRecord = getCharacterRecord(characterID);
      const activeShip = getActiveShipRecord(characterID);
      const stationID = Number(
        characterRecord && (characterRecord.stationID || characterRecord.stationid || 0),
      ) || 0;
      if (!characterRecord || !activeShip || stationID <= 0) {
        return null;
      }

      const storedShip = getCharacterShips(characterID)
        .filter((ship) => ship && Number(ship.itemID) > 0)
        .find((ship) => (
          Number(ship.itemID) !== Number(activeShip.itemID) &&
          Number(ship.locationID) === stationID &&
          Number(ship.flagID) === ITEM_FLAGS.HANGAR
        ));
      if (!storedShip) {
        return null;
      }

      return {
        characterID,
        characterRecord,
        stationID,
        activeShip,
        storedShip,
      };
    })
    .filter(Boolean);

  assert.ok(
    candidates.length > 0,
    "Expected at least one docked character with another stored ship in the station hangar",
  );
  return candidates[0];
}

function buildSession(candidate) {
  return {
    clientID: candidate.characterID + 82000,
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

function getNextTemporaryItemID() {
  const itemsResult = database.read("items", "/");
  assert.equal(itemsResult.success, true, "Failed to read items");
  return Object.keys(itemsResult.data || {}).reduce((maxItemID, itemID) => {
    const numericItemID = Number(itemID) || 0;
    return numericItemID > maxItemID ? numericItemID : maxItemID;
  }, 0) + 4000;
}

function writeTemporaryItem(itemID, item) {
  const writeResult = database.write("items", `/${itemID}`, item);
  assert.equal(writeResult.success, true, `Failed to write temporary item ${itemID}`);
}

function removeItemIfPresent(itemID) {
  const readResult = database.read("items", `/${itemID}`);
  if (readResult.success) {
    database.remove("items", `/${itemID}`);
  }
}

function bindShipInventory(service, session, shipID) {
  const bound = service.Handle_GetInventoryFromId([shipID], session);
  const boundID =
    bound &&
    bound.type === "substruct" &&
    bound.value &&
    bound.value.type === "substream" &&
    Array.isArray(bound.value.value)
      ? bound.value.value[0]
      : null;
  assert.ok(boundID, "Expected GetInventoryFromId to return a bound inventory substruct");
  session.currentBoundObjectID = boundID;
}

function getBoundID(value) {
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

function getInventoryEntries(value) {
  if (!(value && value.type === "list" && Array.isArray(value.items))) {
    return [];
  }

  return value.items
    .map((item) => (item && item.type === "packedrow" && item.fields ? item.fields : item))
    .filter(Boolean);
}

function buildExplicitNullKwargs() {
  return {
    type: "dict",
    entries: [
      ["flag", null],
      ["machoVersion", 1],
    ],
  };
}

test("docked plain List() on a stored ship inventory stays on the stock full-contents path", () => {
  const candidate = getDockedCandidate();
  const session = buildSession(candidate);
  const service = new InvBrokerService();
  const cargoType = resolveItemByName("Tritanium");
  const moduleType = resolveItemByName("Civilian Gatling Autocannon");
  assert.equal(cargoType && cargoType.success, true, "Expected Tritanium type metadata");
  assert.equal(
    moduleType && moduleType.success,
    true,
    "Expected Civilian Gatling Autocannon type metadata",
  );

  const cargoItemID = getNextTemporaryItemID();
  const moduleItemID = cargoItemID + 1;

  try {
    writeTemporaryItem(
      cargoItemID,
      buildInventoryItem({
        itemID: cargoItemID,
        typeID: cargoType.match.typeID,
        ownerID: candidate.characterID,
        locationID: candidate.storedShip.itemID,
        flagID: ITEM_FLAGS.CARGO_HOLD,
        itemName: cargoType.match.name,
        quantity: 250,
        stacksize: 250,
        singleton: 0,
      }),
    );
    writeTemporaryItem(
      moduleItemID,
      buildInventoryItem({
        itemID: moduleItemID,
        typeID: moduleType.match.typeID,
        ownerID: candidate.characterID,
        locationID: candidate.storedShip.itemID,
        flagID: 11,
        itemName: moduleType.match.name,
        singleton: 1,
      }),
    );

    const applyResult = applyCharacterToSession(session, candidate.characterID, {
      emitNotifications: false,
      logSelection: false,
    });
    assert.equal(applyResult.success, true);
    assert.equal(Number(session.stationid || 0), candidate.stationID);
    assert.equal(
      Number(session.activeShipID || 0),
      Number(candidate.activeShip.itemID),
      "Expected the selected session to keep the docked active ship separate from the stored ship",
    );

    bindShipInventory(service, session, candidate.storedShip.itemID);

    const defaultList = service.Handle_List([], session, {});
    const explicitNullList = service.Handle_List([], session, buildExplicitNullKwargs());

    const defaultItemIDs = new Set(
      getInventoryEntries(defaultList)
        .map((row) => Number(row.itemID) || 0)
        .filter((itemID) => itemID > 0),
    );
    const explicitNullItemIDs = new Set(
      getInventoryEntries(explicitNullList)
        .map((row) => Number(row.itemID) || 0)
        .filter((itemID) => itemID > 0),
    );

    assert.equal(
      defaultItemIDs.has(cargoItemID),
      true,
      "Expected plain List() on a stored ship to include cargo rows",
    );
    assert.equal(
      defaultItemIDs.has(moduleItemID),
      true,
      "Expected plain List() on a stored ship inventory to include fitted rows",
    );
    assert.equal(
      explicitNullItemIDs.has(cargoItemID),
      true,
      "Expected explicit List(flag=None) on a stored ship to keep cargo rows",
    );
    assert.equal(
      explicitNullItemIDs.has(moduleItemID),
      true,
      "Expected explicit List(flag=None) on a stored ship to include fitted rows",
    );
  } finally {
    removeItemIfPresent(moduleItemID);
    removeItemIfPresent(cargoItemID);
  }
});

test("docked MachoBindObject ship inventory keeps the stored ship on the stock full-contents path", () => {
  const candidate = getDockedCandidate();
  const session = buildSession(candidate);
  const service = new InvBrokerService();
  const cargoType = resolveItemByName("Tritanium");
  const moduleType = resolveItemByName("Civilian Gatling Autocannon");
  assert.equal(cargoType && cargoType.success, true, "Expected Tritanium type metadata");
  assert.equal(
    moduleType && moduleType.success,
    true,
    "Expected Civilian Gatling Autocannon type metadata",
  );

  const cargoItemID = getNextTemporaryItemID();
  const moduleItemID = cargoItemID + 1;

  try {
    writeTemporaryItem(
      cargoItemID,
      buildInventoryItem({
        itemID: cargoItemID,
        typeID: cargoType.match.typeID,
        ownerID: candidate.characterID,
        locationID: candidate.storedShip.itemID,
        flagID: ITEM_FLAGS.CARGO_HOLD,
        itemName: cargoType.match.name,
        quantity: 50,
        stacksize: 50,
        singleton: 0,
      }),
    );
    writeTemporaryItem(
      moduleItemID,
      buildInventoryItem({
        itemID: moduleItemID,
        typeID: moduleType.match.typeID,
        ownerID: candidate.characterID,
        locationID: candidate.storedShip.itemID,
        flagID: 11,
        itemName: moduleType.match.name,
        singleton: 1,
      }),
    );

    const applyResult = applyCharacterToSession(session, candidate.characterID, {
      emitNotifications: false,
      logSelection: false,
    });
    assert.equal(applyResult.success, true);

    const bindResult = service.Handle_MachoBindObject(
      [
        candidate.storedShip.itemID,
        [
          "GetInventoryFromId",
          [candidate.storedShip.itemID, 1],
          {},
        ],
      ],
      session,
      { machoVersion: 1 },
    );

    const outerBoundID =
      Array.isArray(bindResult) && bindResult.length > 0
        ? getBoundID(bindResult[0])
        : null;
    const innerBoundID =
      Array.isArray(bindResult) && bindResult.length > 1
        ? getBoundID(bindResult[1])
        : null;
    assert.ok(outerBoundID, "Expected MachoBindObject to return an outer bound object");
    assert.ok(innerBoundID, "Expected nested GetInventoryFromId to return an inventory object");

    session.currentBoundObjectID = outerBoundID;
    const outerDefaultList = service.Handle_List([], session, {});

    session.currentBoundObjectID = innerBoundID;
    const innerDefaultList = service.Handle_List([], session, {});

    const outerItemIDs = new Set(
      getInventoryEntries(outerDefaultList)
        .map((row) => Number(row.itemID) || 0)
        .filter((itemID) => itemID > 0),
    );
    const innerItemIDs = new Set(
      getInventoryEntries(innerDefaultList)
        .map((row) => Number(row.itemID) || 0)
        .filter((itemID) => itemID > 0),
    );

    assert.equal(
      outerItemIDs.has(cargoItemID),
      true,
      "Expected the outer MachoBindObject inventory to keep cargo rows visible",
    );
    assert.equal(
      outerItemIDs.has(moduleItemID),
      true,
      "Expected the outer MachoBindObject inventory to include fitted rows",
    );
    assert.equal(
      innerItemIDs.has(cargoItemID),
      true,
      "Expected the nested ship inventory object to keep cargo rows visible",
    );
    assert.equal(
      innerItemIDs.has(moduleItemID),
      true,
      "Expected the nested ship inventory object to include fitted rows",
    );
  } finally {
    removeItemIfPresent(moduleItemID);
    removeItemIfPresent(cargoItemID);
  }
});
