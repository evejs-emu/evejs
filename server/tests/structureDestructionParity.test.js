const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const structureState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureState",
));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
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
  listSystemSpaceItems,
  moveItemToLocation,
  resetInventoryStoreForTests,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  resolveItemByTypeID,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemTypeRegistry",
));

function readTable(tableName) {
  const result = database.read(tableName, "/");
  assert.equal(result.success, true, `Failed to read ${tableName}`);
  return JSON.parse(JSON.stringify(result.data));
}

function writeTable(tableName, payload) {
  const result = database.write(tableName, "/", payload);
  assert.equal(result.success, true, `Failed to write ${tableName}`);
}

function getCandidate() {
  const characters = readTable("characters");
  const characterIDs = Object.keys(characters || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .sort((left, right) => left - right);

  for (const characterID of characterIDs) {
    const characterRecord = getCharacterRecord(characterID);
    const activeShip = getActiveShipRecord(characterID);
    if (!characterRecord || !activeShip) {
      continue;
    }

    return {
      characterID,
      characterRecord,
      activeShip,
      solarSystemID: Number(characterRecord.solarSystemID) || 30000142,
    };
  }

  assert.fail("Expected at least one character with an active ship");
}

function buildDockedSession(characterID) {
  return {
    clientID: characterID + 991000,
    userid: characterID,
    characterID,
    charid: characterID,
    socket: {
      destroyed: false,
      write() {},
    },
    notifications: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
    sendServiceNotification() {},
    sendSessionChange() {},
  };
}

test.afterEach(() => {
  resetInventoryStoreForTests();
  structureState.clearStructureCaches();
  spaceRuntime._testing.clearScenes();
});

test("destroyed full-power structures move docked pilots to space, wrap remaining assets, and drop the quantum core", () => {
  const charactersBackup = readTable("characters");
  const itemsBackup = readTable("items");
  const structuresBackup = readTable("structures");
  const wrapsBackup = readTable("structureAssetSafety");
  const candidate = getCandidate();
  const session = buildDockedSession(candidate.characterID);

  try {
    structureState.clearStructureCaches();

    const createResult = structureState.createStructure({
      typeID: 35832,
      name: "Destroyed Full Power Astrahus",
      itemName: "Destroyed Full Power Astrahus",
      ownerCorpID: Number(candidate.characterRecord.corporationID || 1000009) || 1000009,
      solarSystemID: candidate.solarSystemID,
      position: { x: 440000, y: 0, z: 180000 },
      state: 110,
      upkeepState: 1,
      hasQuantumCore: true,
      accessProfile: {
        docking: "public",
        tethering: "public",
      },
      serviceStates: {
        "1": 1,
        "2": 1,
      },
    });
    assert.equal(createResult.success, true, "Expected structure creation to succeed");
    const structure = createResult.data;

    const moveActiveShipResult = moveItemToLocation(
      candidate.activeShip.itemID,
      structure.structureID,
      ITEM_FLAGS.HANGAR,
    );
    assert.equal(moveActiveShipResult.success, true, "Expected the active ship to move into the structure");

    const spareShipResult = grantItemToCharacterLocation(
      candidate.characterID,
      structure.structureID,
      ITEM_FLAGS.HANGAR,
      candidate.activeShip.typeID,
      1,
      {
        itemName: "Spare Wrapped Ship",
        singleton: 1,
      },
    );
    assert.equal(spareShipResult.success, true, "Expected a spare ship to be granted into the structure hangar");
    const spareShip = spareShipResult.data.items[0];

    const nextCharacters = readTable("characters");
    nextCharacters[String(candidate.characterID)] = {
      ...nextCharacters[String(candidate.characterID)],
      stationID: null,
      structureID: structure.structureID,
      solarSystemID: candidate.solarSystemID,
    };
    writeTable("characters", nextCharacters);

    const applyResult = applyCharacterToSession(session, candidate.characterID, {
      emitNotifications: false,
      logSelection: false,
    });
    assert.equal(applyResult.success, true, "Expected the docked session to apply cleanly");
    sessionRegistry.register(session);

    const destroyResult = structureState.destroyStructure(structure.structureID);
    assert.equal(destroyResult.success, true, "Expected structure destruction to succeed");
    assert.ok(
      destroyResult.data.assetSafety &&
        Array.isArray(destroyResult.data.assetSafety.createdWraps) &&
        destroyResult.data.assetSafety.createdWraps.length > 0,
      "Expected full-power destruction to create asset safety wraps",
    );

    const activeShipAfter = getActiveShipRecord(candidate.characterID);
    assert.equal(
      Number(activeShipAfter.locationID) || 0,
      candidate.solarSystemID,
      "Expected the actively boarded ship to be moved to space instead of asset safety",
    );
    assert.equal(
      Number(activeShipAfter.spaceState && activeShipAfter.spaceState.systemID) || 0,
      candidate.solarSystemID,
      "Expected the actively boarded ship to receive a space-state handoff",
    );

    const characterAfter = getCharacterRecord(candidate.characterID);
    assert.equal(
      Number(characterAfter.structureID) || 0,
      0,
      "Expected the docked character to be detached from the destroyed structure",
    );
    assert.ok(session._space, "Expected the live docked session to be rebuilt in space");
    assert.equal(
      Number(session.structureID || session.structureid || 0),
      0,
      "Expected the live session to stop reporting the destroyed structure as docked",
    );

    const wrapRows = readTable("structureAssetSafety");
    const wraps = Array.isArray(wrapRows && wrapRows.wraps) ? wrapRows.wraps : [];
    assert.equal(
      wraps.some((wrap) => Number(wrap && wrap.ownerID) === candidate.characterID),
      true,
      "Expected the character to own at least one persisted asset safety wrap",
    );

    const wreckID =
      Number(
        destroyResult.data &&
          destroyResult.data.loot &&
          destroyResult.data.loot.wreck &&
          destroyResult.data.loot.wreck.itemID,
      ) || 0;
    const wreckItem = findItemById(wreckID);
    assert.ok(wreckItem, "Expected a spawned structure wreck row in system space");
    const wreckType = resolveItemByTypeID(wreckItem.typeID);
    assert.equal(
      String(wreckType && wreckType.groupName || "").trim().toLowerCase(),
      "wreck",
      "Expected destroyed structures to drop a real wreck item instead of a generic container",
    );
    assert.equal(
      Number(wreckItem && wreckItem.typeID) || 0,
      40644,
      "Expected an Astrahus destruction to resolve the Astrahus Wreck type",
    );
    assert.equal(
      String(wreckItem && wreckItem.itemName || "").includes("Wreck"),
      true,
      "Expected the returned loot holder to advertise a wreck label",
    );
    assert.equal(
      listSystemSpaceItems(candidate.solarSystemID).some((item) => (
        Number(item && item.itemID) === wreckID
      )),
      true,
      "Expected the returned wreck to exist in system space",
    );

    const coreContents = listContainerItems(null, wreckItem.itemID, null);
    assert.equal(
      coreContents.some((item) => Number(item && item.typeID) === Number(structure.quantumCoreItemTypeID)),
      true,
      "Expected the quantum core item to exist in the wreck",
    );
  } finally {
    sessionRegistry.unregister(session);
    writeTable("characters", charactersBackup);
    writeTable("items", itemsBackup);
    writeTable("structures", structuresBackup);
    writeTable("structureAssetSafety", wrapsBackup);
    structureState.clearStructureCaches();
    spaceRuntime._testing.clearScenes();
  }
});

test("destroyed abandoned structures eject remaining assets into space instead of asset safety", () => {
  const charactersBackup = readTable("characters");
  const itemsBackup = readTable("items");
  const structuresBackup = readTable("structures");
  const wrapsBackup = readTable("structureAssetSafety");
  const candidate = getCandidate();

  try {
    structureState.clearStructureCaches();

    const createResult = structureState.createStructure({
      typeID: 35832,
      name: "Destroyed Abandoned Astrahus",
      itemName: "Destroyed Abandoned Astrahus",
      ownerCorpID: Number(candidate.characterRecord.corporationID || 1000009) || 1000009,
      solarSystemID: candidate.solarSystemID,
      position: { x: 470000, y: 0, z: 225000 },
      state: 110,
      upkeepState: 3,
      hasQuantumCore: true,
      accessProfile: {
        docking: "public",
        tethering: "public",
      },
      serviceStates: {
        "1": 1,
        "2": 1,
      },
    });
    assert.equal(createResult.success, true, "Expected structure creation to succeed");
    const structure = createResult.data;
    const setAbandonedResult = structureState.setStructureUpkeepState(
      structure.structureID,
      "abandoned",
    );
    assert.equal(setAbandonedResult.success, true, "Expected the structure to enter abandoned state before destruction");

    const spareShipResult = grantItemToCharacterLocation(
      candidate.characterID,
      structure.structureID,
      ITEM_FLAGS.HANGAR,
      candidate.activeShip.typeID,
      1,
      {
        itemName: "Spare Dropped Ship",
        singleton: 1,
      },
    );
    assert.equal(spareShipResult.success, true, "Expected a spare ship to be granted into the abandoned structure");
    const spareShip = spareShipResult.data.items[0];

    const destroyResult = structureState.destroyStructure(structure.structureID);
    assert.equal(destroyResult.success, true, "Expected abandoned structure destruction to succeed");
    assert.equal(
      destroyResult.data.assetSafety,
      null,
      "Expected abandoned structure destruction to bypass asset safety",
    );

    const wrapRows = readTable("structureAssetSafety");
    const wraps = Array.isArray(wrapRows && wrapRows.wraps) ? wrapRows.wraps : [];
    assert.equal(
      wraps.some((wrap) => Number(wrap && wrap.ownerID) === candidate.characterID),
      false,
      "Expected abandoned destruction to leave no asset safety wraps for the character",
    );

    const destroyedWreckID =
      Number(
        destroyResult.data &&
          destroyResult.data.loot &&
          destroyResult.data.loot.wreck &&
          destroyResult.data.loot.wreck.itemID,
      ) || 0;
    const destroyedWreck = findItemById(destroyedWreckID);
    assert.ok(
      destroyedWreck,
      "Expected abandoned structure contents to be ejected into a structure wreck",
    );
    const destroyedWreckType = resolveItemByTypeID(destroyedWreck.typeID);
    assert.equal(
      String(destroyedWreckType && destroyedWreckType.groupName || "").trim().toLowerCase(),
      "wreck",
      "Expected abandoned structure destruction to use a real wreck item",
    );
    assert.equal(
      listSystemSpaceItems(candidate.solarSystemID).some((item) => (
        Number(item && item.itemID) === destroyedWreckID
      )),
      true,
      "Expected the returned destroyed-structure wreck to exist in system space",
    );

    const droppedContents = listContainerItems(null, destroyedWreck.itemID, null);
    const spareShipDropped = droppedContents.some(
      (item) => Number(item && item.itemID) === Number(spareShip.itemID),
    );
    assert.equal(
      spareShipDropped,
      true,
      `Expected spare ship ${spareShip.itemID} to be dropped into wreck ${
        destroyedWreck.itemID
      }; contents=${droppedContents.map((item) => item && item.itemID).join(",")}; outcome=${
        JSON.stringify(destroyResult.data && destroyResult.data.loot && destroyResult.data.loot.lootOutcome)
      }`,
    );
    assert.equal(
      droppedContents.some((item) => Number(item && item.typeID) === Number(structure.quantumCoreItemTypeID)),
      true,
      "Expected the abandoned-structure wreck to contain the quantum core",
    );
  } finally {
    writeTable("characters", charactersBackup);
    writeTable("items", itemsBackup);
    writeTable("structures", structuresBackup);
    writeTable("structureAssetSafety", wrapsBackup);
    structureState.clearStructureCaches();
    spaceRuntime._testing.clearScenes();
  }
});
