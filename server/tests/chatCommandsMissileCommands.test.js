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
const {
  TABLE,
  readStaticRows,
} = require(path.join(
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

  assert.fail("Expected at least one docked character for missile command tests");
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

function listCompatibleCharges(moduleTypeID) {
  return (readStaticRows(TABLE.ITEM_TYPES) || [])
    .filter((row) => Number(row && row.categoryID) === 8)
    .filter((row) => row.published !== false)
    .filter((row) => !/blueprint/i.test(String(row && row.name || "")))
    .map((row) => resolveItemByTypeID(row.typeID))
    .filter(Boolean)
    .filter((itemType) => isChargeCompatibleWithModule(moduleTypeID, itemType.typeID));
}

function buildDockedSession(candidate) {
  return {
    clientID: candidate.characterID + 83000,
    userid: candidate.characterID,
    characterID: candidate.characterID,
    charid: candidate.characterID,
    stationid: candidate.stationID,
    stationID: candidate.stationID,
    locationid: candidate.stationID,
    sendNotification() {},
  };
}

function assertMissileCommandFit(config) {
  const candidate = getDockedCandidate();
  const beforeItemsResult = database.read("items", "/");
  assert.equal(beforeItemsResult.success, true, "Failed to read items table");
  const beforeItemIDs = new Set(
    Object.keys(beforeItemsResult.data || {}).map((itemID) => Number(itemID) || 0),
  );
  const session = buildDockedSession(candidate);

  try {
    const result = executeChatCommand(
      session,
      config.command,
      null,
      { emitChatFeedback: false },
    );

    assert.equal(result.handled, true);
    assert.match(result.message, new RegExp(config.shipName, "i"));
    assert.match(
      result.message,
      new RegExp(config.launcherName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
    );

    const afterItemsResult = database.read("items", "/");
    assert.equal(afterItemsResult.success, true, `Failed to read items table after ${config.command}`);
    const newItems = Object.values(afterItemsResult.data || {})
      .filter((item) => !beforeItemIDs.has(Number(item && item.itemID) || 0));

    const shipType = resolveShipByName(config.shipName);
    assert.equal(shipType.success, true, `Expected ship type ${config.shipName}`);
    const spawnedShips = newItems.filter((item) =>
      Number(item && item.typeID) === Number(shipType.match.typeID) &&
      Number(item && item.locationID) === candidate.stationID &&
      Number(item && item.flagID) === ITEM_FLAGS.HANGAR,
    );
    assert.equal(
      spawnedShips.length,
      1,
      `Expected ${config.command} to add exactly one ${config.shipName}`,
    );

    const shipItem = spawnedShips[0];
    const fittedItems = getFittedModuleItems(candidate.characterID, shipItem.itemID);
    const mwdType = resolveItemByName(config.mwdName);
    assert.equal(mwdType.success, true, `Expected MWD type ${config.mwdName}`);
    const launcherType = resolveItemByName(config.launcherName);
    assert.equal(launcherType.success, true, `Expected launcher type ${config.launcherName}`);

    const fittedMwd = fittedItems.filter((item) =>
      Number(item && item.typeID) === Number(mwdType.match.typeID),
    );
    assert.equal(fittedMwd.length, 1, `Expected ${config.command} to fit one MWD`);
    assert.ok(
      Number(fittedMwd[0].flagID) >= 19 && Number(fittedMwd[0].flagID) <= 26,
      "Expected the MWD to land in a middle slot",
    );

    const fittedLaunchers = fittedItems.filter((item) =>
      Number(item && item.typeID) === Number(launcherType.match.typeID),
    );
    assert.equal(
      fittedLaunchers.length,
      config.launcherCount,
      `Expected ${config.command} to fit ${config.launcherCount}x ${config.launcherName}`,
    );
    for (const launcher of fittedLaunchers) {
      assert.ok(
        Number(launcher.flagID) >= 27 && Number(launcher.flagID) <= 34,
        "Expected fitted launchers to use high slots",
      );
    }

    assert.equal(
      fittedItems.length,
      config.launcherCount + 1,
      `Expected ${config.command} to fit only the tested MWD and launcher rack`,
    );

    const cargoItems = listContainerItems(
      candidate.characterID,
      shipItem.itemID,
      ITEM_FLAGS.CARGO_HOLD,
    );
    const cargoCounts = buildTypeQuantityMap(cargoItems);
    const compatibleCharges = listCompatibleCharges(launcherType.match.typeID);
    assert.ok(
      compatibleCharges.length > 0,
      `Expected compatible charges for ${config.launcherName}`,
    );
    for (const chargeType of compatibleCharges) {
      assert.ok(
        (cargoCounts.get(Number(chargeType.typeID) || 0) || 0) >= config.chargeQuantity,
        `Expected at least ${config.chargeQuantity} of compatible charge ${chargeType.name}`,
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
      `Expected ${config.command} cargo seeding to stay within cargo capacity`,
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
}

const MISSILE_COMMAND_CASES = [
  {
    command: "/rocket",
    shipName: "Kestrel",
    launcherName: "Rocket Launcher II",
    launcherCount: 4,
    mwdName: "5MN Microwarpdrive II",
    chargeQuantity: 1000,
  },
  {
    command: "/light",
    shipName: "Corax",
    launcherName: "Light Missile Launcher II",
    launcherCount: 7,
    mwdName: "5MN Microwarpdrive II",
    chargeQuantity: 900,
  },
  {
    command: "/heavy",
    shipName: "Drake",
    launcherName: "Heavy Missile Launcher II",
    launcherCount: 6,
    mwdName: "50MN Microwarpdrive II",
    chargeQuantity: 450,
  },
  {
    command: "/torp",
    shipName: "Raven Navy Issue",
    launcherName: "Torpedo Launcher II",
    launcherCount: 7,
    mwdName: "500MN Microwarpdrive II",
    chargeQuantity: 650,
  },
];

for (const config of MISSILE_COMMAND_CASES) {
  test(`${config.command} spawns the validated missile hull, rack, and ammo`, () => {
    assertMissileCommandFit(config);
  });
}
