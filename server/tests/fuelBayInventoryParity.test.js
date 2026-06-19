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
  grantItemToCharacterLocation,
  listContainerItems,
  removeInventoryItem,
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
const {
  getShipBaseAttributeValue,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));
const {
  FUEL_BAY_FLAG,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/fuelBayInventory",
));
const genericModuleFuelRuntime = require(path.join(
  repoRoot,
  "server/src/space/modules/genericModuleFuelRuntime",
));

const transientItemIDs = [];
const FUEL_TYPE_NAMES = Object.freeze([
  "Hydrogen Isotopes",
  "Oxygen Isotopes",
  "Helium Isotopes",
  "Nitrogen Isotopes",
  "Heavy Water",
  "Liquid Ozone",
]);

function trackTransientItems(grantResult) {
  const items = (grantResult && grantResult.data && grantResult.data.items) || [];
  for (const item of items) {
    const itemID = Number(item && item.itemID) || 0;
    if (itemID > 0) {
      transientItemIDs.push(itemID);
    }
  }
  return items;
}

function getFuelBayCandidate() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Failed to read characters");

  const resolvedFuelTypes = FUEL_TYPE_NAMES
    .map((name) => resolveItemByName(name))
    .filter((result) => result && result.success && result.match);
  assert.ok(resolvedFuelTypes.length > 0, "Expected at least one fuel type lookup");

  const candidates = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .map((characterID) => {
      const characterRecord = getCharacterRecord(characterID);
      const ship = getActiveShipRecord(characterID);
      if (!characterRecord || !ship || Number(ship.itemID) <= 0) {
        return null;
      }

      const fuelBayCapacity = Number(
        getShipBaseAttributeValue(ship.typeID, "specialFuelBayCapacity"),
      ) || 0;
      if (fuelBayCapacity <= 0) {
        return null;
      }

      const usableFuelType = resolvedFuelTypes.find((result) => {
        const typeID = Number(result.match.typeID) || 0;
        return (
          sumTypeQuantity(characterID, ship.itemID, ITEM_FLAGS.CARGO_HOLD, typeID) === 0 &&
          sumTypeQuantity(characterID, ship.itemID, FUEL_BAY_FLAG, typeID) === 0
        );
      });
      if (!usableFuelType) {
        return null;
      }

      return {
        characterID,
        characterRecord,
        ship,
        fuelBayCapacity,
        fuelType: usableFuelType.match,
      };
    })
    .filter(Boolean);

  assert.ok(
    candidates.length > 0,
    "Expected at least one active ship with an unused fuel type and a real fuel bay",
  );
  return candidates[0];
}

function buildSession(candidate) {
  return {
    clientID: candidate.characterID + 99100,
    userid: candidate.characterID,
    characterID: candidate.characterID,
    charid: candidate.characterID,
    stationid: Number(candidate.characterRecord.stationID) || 0,
    stationID: Number(candidate.characterRecord.stationID) || 0,
    structureid: Number(candidate.characterRecord.structureID) || 0,
    structureID: Number(candidate.characterRecord.structureID) || 0,
    socket: { destroyed: false },
    currentBoundObjectID: null,
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

function getInventoryEntries(value) {
  if (!(value && value.type === "list" && Array.isArray(value.items))) {
    return [];
  }

  return value.items
    .map((item) => (item && item.type === "packedrow" && item.fields ? item.fields : item))
    .filter(Boolean);
}

function extractCapacityValue(keyVal, key) {
  if (
    !keyVal ||
    !keyVal.args ||
    keyVal.args.type !== "dict" ||
    !Array.isArray(keyVal.args.entries)
  ) {
    return 0;
  }
  const entry = keyVal.args.entries.find(([entryKey]) => entryKey === key);
  return Number(entry && entry[1]) || 0;
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

function sumTypeQuantity(characterID, shipID, flagID, typeID) {
  return listContainerItems(characterID, shipID, flagID)
    .filter((item) => Number(item && item.typeID) === Number(typeID))
    .reduce(
      (sum, item) => sum + Math.max(0, Number(item.stacksize ?? item.quantity ?? 0) || 0),
      0,
    );
}

function grantTransientItem(candidate, flagID, typeMatch, quantity = 1, options = {}) {
  const grantResult = grantItemToCharacterLocation(
    candidate.characterID,
    candidate.ship.itemID,
    flagID,
    typeMatch,
    quantity,
    {
      transient: true,
      ...options,
    },
  );
  assert.equal(grantResult.success, true, "Expected transient inventory grant");
  const items = trackTransientItems(grantResult);
  assert.ok(items.length > 0, "Expected a transient item record");
  return items[0];
}

test.afterEach(() => {
  for (const itemID of transientItemIDs.splice(0)) {
    if (itemID > 0) {
      removeInventoryItem(itemID, { removeContents: true });
    }
  }
  resetInventoryStoreForTests();
});

test("fuel bay moves route explicit flag 133 into the ship fuel bay instead of auto-fit", () => {
  resetInventoryStoreForTests();
  const candidate = getFuelBayCandidate();
  const session = buildSession(candidate);
  const service = new InvBrokerService();

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  bindShipInventory(service, session, candidate.ship.itemID);

  const cargoBefore = sumTypeQuantity(
    candidate.characterID,
    candidate.ship.itemID,
    ITEM_FLAGS.CARGO_HOLD,
    candidate.fuelType.typeID,
  );
  const fuelBefore = sumTypeQuantity(
    candidate.characterID,
    candidate.ship.itemID,
    FUEL_BAY_FLAG,
    candidate.fuelType.typeID,
  );

  const fuelStack = grantTransientItem(
    candidate,
    ITEM_FLAGS.CARGO_HOLD,
    candidate.fuelType,
    25,
  );
  const movedItemID = service.Handle_Add(
    [fuelStack.itemID, candidate.ship.itemID],
    session,
    { flag: FUEL_BAY_FLAG },
  );

  const cargoAfter = sumTypeQuantity(
    candidate.characterID,
    candidate.ship.itemID,
    ITEM_FLAGS.CARGO_HOLD,
    candidate.fuelType.typeID,
  );
  const fuelAfter = sumTypeQuantity(
    candidate.characterID,
    candidate.ship.itemID,
    FUEL_BAY_FLAG,
    candidate.fuelType.typeID,
  );

  assert.ok(
    movedItemID === null || Number(movedItemID) > 0,
    "Expected invbroker Add to either move the original stack or return the merged destination stack",
  );
  assert.equal(cargoAfter, cargoBefore, "Expected fuel to leave cargo after the move");
  assert.equal(fuelAfter, fuelBefore + 25, "Expected fuel to land in the specialized fuel bay");
});

test("fuel bay rejects non-ice-product inventory items", () => {
  resetInventoryStoreForTests();
  const candidate = getFuelBayCandidate();
  const session = buildSession(candidate);
  const service = new InvBrokerService();
  const moduleType = resolveItemByName("Civilian Gatling Autocannon");
  assert.equal(moduleType && moduleType.success, true, "Expected a singleton invalid test item");

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  bindShipInventory(service, session, candidate.ship.itemID);

  const invalidItem = grantTransientItem(
    candidate,
    ITEM_FLAGS.CARGO_HOLD,
    moduleType.match,
    1,
  );
  assert.throws(
    () =>
      service.Handle_Add(
        [invalidItem.itemID, candidate.ship.itemID],
        session,
        { flag: FUEL_BAY_FLAG },
      ),
    (error) => getUserErrorMessage(error) === "NotEnoughCargoSpace",
  );

  const currentItem = listContainerItems(
    candidate.characterID,
    candidate.ship.itemID,
    ITEM_FLAGS.CARGO_HOLD,
  ).find((item) => Number(item && item.itemID) === Number(invalidItem.itemID));
  assert.ok(currentItem, "Expected invalid item to remain in cargo");
});

test("fuel bay list and capacity reflect the real specialized fuel bay state", () => {
  resetInventoryStoreForTests();
  const candidate = getFuelBayCandidate();
  const session = buildSession(candidate);
  const service = new InvBrokerService();

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  bindShipInventory(service, session, candidate.ship.itemID);

  const fuelBefore = sumTypeQuantity(
    candidate.characterID,
    candidate.ship.itemID,
    FUEL_BAY_FLAG,
    candidate.fuelType.typeID,
  );
  grantTransientItem(candidate, FUEL_BAY_FLAG, candidate.fuelType, 40);

  const rows = getInventoryEntries(service.Handle_ListFuelBay([], session, {}));
  const listedFuel = rows.filter(
    (row) => Number(row.typeID) === Number(candidate.fuelType.typeID),
  ).reduce(
    (sum, row) => sum + Math.max(0, Number(row.stacksize ?? row.quantity ?? 0) || 0),
    0,
  );
  const capacityInfo = service.Handle_GetCapacity([FUEL_BAY_FLAG], session, {});
  const capacity = extractCapacityValue(capacityInfo, "capacity");
  const used = extractCapacityValue(capacityInfo, "used");
  const expectedUsed = listContainerItems(
    candidate.characterID,
    candidate.ship.itemID,
    FUEL_BAY_FLAG,
  ).reduce((sum, item) => {
    const quantity = Math.max(0, Number(item.stacksize ?? item.quantity ?? 0) || 0);
    const volume = Math.max(0, Number(item.volume) || 0);
    return sum + (quantity * volume);
  }, 0);

  assert.equal(
    listedFuel,
    fuelBefore + 40,
    "Expected ListFuelBay to expose the actual specialized fuel bay contents",
  );
  assert.equal(
    capacity,
    candidate.fuelBayCapacity,
    "Expected GetCapacity(flag=133) to reflect the ship's fuel bay dogma capacity",
  );
  assert.equal(
    used,
    expectedUsed,
    "Expected GetCapacity(flag=133) used volume to match the real bay contents",
  );
});

test("fuel consumption drains the fuel bay before cargo for ice products", () => {
  resetInventoryStoreForTests();
  const candidate = getFuelBayCandidate();

  grantTransientItem(candidate, FUEL_BAY_FLAG, candidate.fuelType, 20);
  grantTransientItem(candidate, ITEM_FLAGS.CARGO_HOLD, candidate.fuelType, 30);

  const fuelBefore = sumTypeQuantity(
    candidate.characterID,
    candidate.ship.itemID,
    FUEL_BAY_FLAG,
    candidate.fuelType.typeID,
  );
  const cargoBefore = sumTypeQuantity(
    candidate.characterID,
    candidate.ship.itemID,
    ITEM_FLAGS.CARGO_HOLD,
    candidate.fuelType.typeID,
  );

  const consumeResult = genericModuleFuelRuntime.consumeShipModuleFuel(
    {
      kind: "ship",
      itemID: candidate.ship.itemID,
    },
    candidate.fuelType.typeID,
    10,
    {
      resolveCharacterID() {
        return candidate.characterID;
      },
    },
  );
  assert.equal(consumeResult.success, true, "Expected fuel consumption to succeed");

  const fuelAfter = sumTypeQuantity(
    candidate.characterID,
    candidate.ship.itemID,
    FUEL_BAY_FLAG,
    candidate.fuelType.typeID,
  );
  const cargoAfter = sumTypeQuantity(
    candidate.characterID,
    candidate.ship.itemID,
    ITEM_FLAGS.CARGO_HOLD,
    candidate.fuelType.typeID,
  );

  assert.equal(
    fuelAfter,
    fuelBefore - 10,
    "Expected module fuel consumption to drain the specialized fuel bay first",
  );
  assert.equal(
    cargoAfter,
    cargoBefore,
    "Expected cargo fuel to remain untouched while the fuel bay still had fuel",
  );
});
