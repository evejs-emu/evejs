const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(
  repoRoot,
  "server/src/newDatabase",
));
const { executeChatCommand } = require(path.join(
  repoRoot,
  "server/src/services/chat/chatCommands",
));
const { TABLE, readStaticRows } = require(path.join(
  repoRoot,
  "server/src/services/_shared/referenceData",
));
const {
  ITEM_FLAGS,
  listContainerItems,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  resolveShipByName,
} = require(path.join(
  repoRoot,
  "server/src/services/chat/shipTypeRegistry",
));
const {
  resolveItemByName,
  resolveItemByTypeID,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemTypeRegistry",
));
const {
  buildShipResourceState,
  getFittedModuleItems,
  isChargeCompatibleWithModule,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));

function getDockedCandidate() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Failed to read characters table");

  for (const [characterID, record] of Object.entries(charactersResult.data || {})) {
    const numericCharacterID = Number(characterID) || 0;
    const stationID = Number(record && (record.stationID || record.stationid || 0)) || 0;
    if (numericCharacterID > 0 && stationID > 0) {
      return {
        characterID: numericCharacterID,
        stationID,
      };
    }
  }

  assert.fail("Expected at least one docked character for /laser test");
}

function buildTypeQuantityMap(items) {
  const counts = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const typeID = Number(item && item.typeID) || 0;
    if (typeID <= 0) {
      continue;
    }
    const quantity = Number(item && item.singleton) === 1
      ? 1
      : Number(item && (item.quantity || item.stacksize || 0)) || 0;
    counts.set(typeID, (counts.get(typeID) || 0) + quantity);
  }
  return counts;
}

test("/laser spawns and fits an Apocalypse Navy Issue with compatible crystals in cargo", () => {
  const candidate = getDockedCandidate();
  const beforeItemsResult = database.read("items", "/");
  assert.equal(beforeItemsResult.success, true, "Failed to read items table");
  const beforeItemIDs = new Set(
    Object.keys(beforeItemsResult.data || {}).map((itemID) => Number(itemID) || 0),
  );

  const session = {
    clientID: candidate.characterID + 81000,
    userid: candidate.characterID,
    characterID: candidate.characterID,
    charid: candidate.characterID,
    stationid: candidate.stationID,
    stationID: candidate.stationID,
    locationid: candidate.stationID,
    sendNotification() {},
  };

  try {
    const result = executeChatCommand(
      session,
      "/laser",
      null,
      { emitChatFeedback: false },
    );

    assert.equal(result.handled, true);
    assert.match(result.message, /Apocalypse Navy Issue/i);

    const afterItemsResult = database.read("items", "/");
    assert.equal(afterItemsResult.success, true, "Failed to read items table after /laser");
    const newItems = Object.values(afterItemsResult.data || {})
      .filter((item) => !beforeItemIDs.has(Number(item && item.itemID) || 0));

    const apocalypseType = resolveShipByName("Apocalypse Navy Issue");
    assert.equal(apocalypseType.success, true, "Expected Apocalypse Navy Issue type");
    const newShips = newItems.filter((item) =>
      Number(item && item.typeID) === Number(apocalypseType.match.typeID) &&
      Number(item && item.locationID) === candidate.stationID &&
      Number(item && item.flagID) === ITEM_FLAGS.HANGAR,
    );
    assert.equal(newShips.length, 1, "Expected /laser to add exactly one new Apocalypse Navy Issue hull");

    const shipItem = newShips[0];
    const fittedItems = getFittedModuleItems(candidate.characterID, shipItem.itemID);
    const mwdType = resolveItemByName("500MN Microwarpdrive II");
    assert.equal(mwdType.success, true, "Expected 500MN Microwarpdrive II type");

    const fittedMwd = fittedItems.filter((item) => Number(item && item.typeID) === Number(mwdType.match.typeID));
    assert.equal(fittedMwd.length, 1, "Expected exactly one fitted 500MN Microwarpdrive II");
    assert.ok(
      Number(fittedMwd[0].flagID) >= 19 && Number(fittedMwd[0].flagID) <= 26,
      "Expected the MWD to land in a middle slot",
    );

    const fittedTurrets = fittedItems.filter(
      (item) => Number(item && item.typeID) !== Number(mwdType.match.typeID),
    );
    assert.ok(fittedTurrets.length > 0, "Expected /laser to fit at least one turret");

    const fittedTurretTypeIDs = new Set(
      fittedTurrets.map((item) => Number(item && item.typeID) || 0),
    );
    assert.equal(fittedTurretTypeIDs.size, 1, "Expected /laser to fit one turret type consistently");
    for (const turret of fittedTurrets) {
      assert.ok(
        Number(turret.flagID) >= 27 && Number(turret.flagID) <= 34,
        "Expected fitted turrets to use high slots",
      );
    }

    const turretTypeID = Number(fittedTurrets[0].typeID) || 0;
    const cargoItems = listContainerItems(
      candidate.characterID,
      shipItem.itemID,
      ITEM_FLAGS.CARGO_HOLD,
    );
    const cargoCounts = buildTypeQuantityMap(cargoItems);
    const compatibleCrystals = (readStaticRows(TABLE.ITEM_TYPES) || [])
      .filter((row) => Number(row && row.categoryID) === 8)
      .filter((row) => row.published !== false)
      .filter((row) => !/blueprint/i.test(String(row && row.name || "")))
      .map((row) => resolveItemByTypeID(row.typeID))
      .filter(Boolean)
      .filter((itemType) => isChargeCompatibleWithModule(turretTypeID, itemType.typeID));

    assert.ok(compatibleCrystals.length > 0, "Expected at least one compatible L crystal");
    for (const crystalType of compatibleCrystals) {
      assert.ok(
        (cargoCounts.get(Number(crystalType.typeID) || 0) || 0) >= 5,
        `Expected at least 5 of compatible crystal ${crystalType.name}`,
      );
    }

    const resourceState = buildShipResourceState(candidate.characterID, shipItem, {
      fittedItems,
    });
    const usedCargoVolume = cargoItems.reduce((sum, item) => {
      const itemType = resolveItemByTypeID(item.typeID) || item;
      const quantity = Number(item && item.singleton) === 1
        ? 1
        : Number(item && (item.quantity || item.stacksize || 0)) || 0;
      return sum + (quantity * (Number(itemType && itemType.volume) || 0));
    }, 0);
    assert.ok(
      usedCargoVolume <= resourceState.cargoCapacity + 1e-6,
      "Expected /laser cargo seeding to stay within cargo capacity",
    );
  } finally {
    const currentItemsResult = database.read("items", "/");
    if (currentItemsResult.success) {
      for (const itemID of Object.keys(currentItemsResult.data || {})) {
        const numericItemID = Number(itemID) || 0;
        if (numericItemID > 0 && !beforeItemIDs.has(numericItemID)) {
          database.remove("items", `/${numericItemID}`);
        }
      }
    }
  }
});
