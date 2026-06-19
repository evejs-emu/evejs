const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");

const database = require(path.join(repoRoot, "server/src/newDatabase"));
const salvagerRuntime = require(path.join(
  repoRoot,
  "server/src/space/modules/salvagerRuntime",
));
const {
  ITEM_FLAGS,
  createSpaceItemForOwner,
  findItemById,
  grantItemsToCharacterLocation,
  listContainerItems,
} = require(path.join(repoRoot, "server/src/services/inventory/itemStore"));
const {
  getEffectTypeRecord,
} = require(path.join(repoRoot, "server/src/services/fitting/liveFittingState"));
const {
  resolveDroneSalvageSnapshot,
} = require(path.join(repoRoot, "server/src/services/drone/droneDogma"));
const {
  resolveItemByTypeID,
} = require(path.join(repoRoot, "server/src/services/inventory/itemTypeRegistry"));
const nativeNpcStore = require(path.join(
  repoRoot,
  "server/src/space/npc/nativeNpcStore",
));

const TEST_CHARACTER_ID = 991770001;
const TEST_SHIP_ID = 991770101;
const TEST_SYSTEM_ID = 30000142;
const TEST_SHIP_TYPE_ID = 32880; // Venture; enough cargo for salvage material tests.
const SALVAGER_I_TYPE_ID = 25861;
const SALVAGING_SKILL_TYPE_ID = 25863;
const SALVAGE_DRONE_I_TYPE_ID = 32787;
const ANGEL_SMALL_WRECK_TYPE_ID = 26561;
const ANGEL_LARGE_WRECK_TYPE_ID = 26563;
const VELDSPAR_TYPE_ID = 1230;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function readTableSnapshot(tableName) {
  const result = database.read(tableName, "/");
  return result.success ? cloneValue(result.data) : {};
}

function writeTableSnapshot(tableName, snapshot) {
  const result = database.write(tableName, "/", cloneValue(snapshot || {}));
  assert.equal(result.success, true, `failed to restore ${tableName}`);
}

function withInventorySnapshot(fn) {
  const snapshots = {
    characters: readTableSnapshot("characters"),
    items: readTableSnapshot("items"),
    npcWrecks: readTableSnapshot("npcWrecks"),
    npcWreckItems: readTableSnapshot("npcWreckItems"),
  };
  try {
    return fn();
  } finally {
    writeTableSnapshot("items", snapshots.items);
    writeTableSnapshot("characters", snapshots.characters);
    writeTableSnapshot("npcWrecks", snapshots.npcWrecks);
    writeTableSnapshot("npcWreckItems", snapshots.npcWreckItems);
  }
}

function seedTestCharacter() {
  const characters = readTableSnapshot("characters");
  characters[String(TEST_CHARACTER_ID)] = {
    characterID: TEST_CHARACTER_ID,
    charid: TEST_CHARACTER_ID,
    characterName: "Salvage Test Pilot",
    corporationID: 1000002,
    stationID: 60003760,
    solarSystemID: TEST_SYSTEM_ID,
    shipID: TEST_SHIP_ID,
    activeShipID: TEST_SHIP_ID,
  };
  writeTableSnapshot("characters", characters);
}

function buildShipItem() {
  const shipType = resolveItemByTypeID(TEST_SHIP_TYPE_ID);
  assert.ok(shipType, "expected Venture type metadata");
  return {
    itemID: TEST_SHIP_ID,
    typeID: TEST_SHIP_TYPE_ID,
    groupID: shipType.groupID,
    categoryID: shipType.categoryID,
    ownerID: TEST_CHARACTER_ID,
    locationID: TEST_SYSTEM_ID,
    flagID: ITEM_FLAGS.HANGAR,
    singleton: 1,
    quantity: 1,
    stacksize: 1,
    itemName: shipType.name,
  };
}

function createWreck(typeID, options = {}) {
  const wreckType = resolveItemByTypeID(typeID);
  assert.ok(wreckType, `expected wreck type ${typeID}`);
  const createResult = createSpaceItemForOwner(
    TEST_CHARACTER_ID,
    TEST_SYSTEM_ID,
    wreckType,
    {
      position: { x: 4500, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      targetPoint: { x: 4500, y: 0, z: 0 },
      expiresAtMs: Date.now() + 60000,
      itemName: options.itemName || wreckType.name,
    },
  );
  assert.equal(createResult.success, true);
  assert.ok(createResult.data);
  return {
    itemRecord: createResult.data,
    entity: {
      kind: "wreck",
      itemID: createResult.data.itemID,
      typeID,
      groupID: wreckType.groupID,
      categoryID: wreckType.categoryID,
      itemName: options.itemName || wreckType.name,
      position: { x: 4500, y: 0, z: 0 },
      radius: 14,
      systemID: TEST_SYSTEM_ID,
    },
  };
}

function buildSourceEntity() {
  return {
    kind: "ship",
    itemID: TEST_SHIP_ID,
    typeID: TEST_SHIP_TYPE_ID,
    ownerID: TEST_CHARACTER_ID,
    characterID: TEST_CHARACTER_ID,
    position: { x: 0, y: 0, z: 0 },
    radius: 40,
    systemID: TEST_SYSTEM_ID,
    session: {
      characterID: TEST_CHARACTER_ID,
      sendNotification() {},
    },
  };
}

function buildScene(targetEntity) {
  const removedEntityIDs = [];
  const spawnedEntities = [];
  return {
    removedEntityIDs,
    spawnedEntities,
    getEntityByID(entityID) {
      if (Number(entityID) === Number(targetEntity.itemID)) {
        return targetEntity;
      }
      return spawnedEntities.find((entity) => Number(entity.itemID) === Number(entityID)) || null;
    },
    removeDynamicEntity(entityID) {
      removedEntityIDs.push(Number(entityID));
      return { success: true };
    },
    spawnDynamicEntity(entity) {
      spawnedEntities.push(entity);
      return {
        success: true,
        data: {
          entity,
        },
      };
    },
    sendSlimItemChangesToAllSessions() {},
  };
}

function sequenceRandom(values) {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    return typeof value === "number" ? value : 0;
  };
}

test("salvager activation uses dogma skill multiplier for access chance", () => {
  const wreckType = resolveItemByTypeID(ANGEL_SMALL_WRECK_TYPE_ID);
  const targetEntity = {
    kind: "wreck",
    itemID: 991770900,
    typeID: ANGEL_SMALL_WRECK_TYPE_ID,
    groupID: wreckType.groupID,
    itemName: wreckType.name,
    position: { x: 4500, y: 0, z: 0 },
    radius: 14,
  };
  const scene = buildScene(targetEntity);
  const sourceEntity = buildSourceEntity();
  const shipItem = buildShipItem();
  const moduleItem = {
    itemID: 991770201,
    typeID: SALVAGER_I_TYPE_ID,
    groupID: 1122,
    flagID: 27,
    ownerID: TEST_CHARACTER_ID,
    locationID: TEST_SHIP_ID,
    singleton: 1,
  };
  const activation = salvagerRuntime.resolveSalvagerActivation({
    scene,
    entity: sourceEntity,
    moduleItem,
    effectRecord: getEffectTypeRecord(salvagerRuntime.EFFECT_SALVAGING),
    shipItem,
    skillMap: new Map([
      [SALVAGING_SKILL_TYPE_ID, {
        typeID: SALVAGING_SKILL_TYPE_ID,
        skillLevel: 3,
      }],
    ]),
    fittedItems: [moduleItem],
    activeModuleContexts: [],
    options: { targetID: targetEntity.itemID },
    callbacks: {
      isEntityLockedTarget: () => true,
      getEntitySurfaceDistance: () => 4500,
    },
  });

  assert.equal(activation.success, true);
  assert.equal(activation.data.runtimeAttrs.salvagerSnapshot.accessBasePercent, 30);
  assert.equal(activation.data.runtimeAttrs.salvagerSnapshot.accessBonusPercent, 15);
  assert.equal(activation.data.runtimeAttrs.salvagerSnapshot.chancePercent, 45);
});

test("salvage reward rolling is faction-shaped and independent from skill quality", () => {
  const angelType = resolveItemByTypeID(ANGEL_LARGE_WRECK_TYPE_ID);
  const targetEntity = {
    kind: "wreck",
    itemID: 991770901,
    typeID: ANGEL_LARGE_WRECK_TYPE_ID,
    groupID: angelType.groupID,
    itemName: angelType.name,
  };

  const rewards = salvagerRuntime._testing.buildSalvageRewardEntries(targetEntity, {
    callbacks: {
      // no empty result, one large-wreck roll, choose the first weighted Angel entry.
      random: sequenceRandom([0.99, 0, 0, 0]),
    },
  });

  assert.deepEqual(rewards, [{ itemType: 25595, quantity: 1 }]);
});

test("salvage drone dogma resolves the client salvage effect and access bonus", () => withInventorySnapshot(() => {
  seedTestCharacter();
  const shipGrant = grantItemsToCharacterLocation(
    TEST_CHARACTER_ID,
    TEST_SYSTEM_ID,
    ITEM_FLAGS.HANGAR,
    [{ itemType: TEST_SHIP_TYPE_ID, quantity: 1 }],
  );
  assert.equal(shipGrant.success, true);
  const controllerShipItem = shipGrant.data.items[0];
  assert.ok(controllerShipItem);

  const controllerEntity = {
    kind: "ship",
    itemID: controllerShipItem.itemID,
    typeID: TEST_SHIP_TYPE_ID,
    ownerID: TEST_CHARACTER_ID,
    characterID: TEST_CHARACTER_ID,
    systemID: TEST_SYSTEM_ID,
  };
  const droneEntity = {
    kind: "drone",
    itemID: 991770301,
    typeID: SALVAGE_DRONE_I_TYPE_ID,
    ownerID: TEST_CHARACTER_ID,
  };
  const snapshot = resolveDroneSalvageSnapshot(droneEntity, controllerEntity);

  assert.ok(snapshot);
  assert.equal(snapshot.effectID, salvagerRuntime.EFFECT_SALVAGE_DRONE);
  assert.equal(snapshot.effectGUID, "effects.Salvaging");
  assert.equal(snapshot.durationMs, 10000);
  assert.equal(snapshot.maxRangeMeters, 5000);
  assert.equal(snapshot.accessBonusPercent, 3);
}));

test("failed salvage cycle leaves the wreck and cargo untouched", () => withInventorySnapshot(() => {
  seedTestCharacter();
  const { entity: wreckEntity } = createWreck(ANGEL_SMALL_WRECK_TYPE_ID);
  const scene = buildScene(wreckEntity);
  const sourceEntity = buildSourceEntity();

  const result = salvagerRuntime.executeSalvagerCycle({
    scene,
    entity: sourceEntity,
    effectState: {
      moduleID: 991770201,
      moduleFlagID: 27,
      typeID: SALVAGER_I_TYPE_ID,
      targetID: wreckEntity.itemID,
      salvagerRangeMeters: 5000,
      salvageChancePercent: 35,
    },
    nowMs: Date.now(),
    callbacks: {
      isEntityLockedTarget: () => true,
      getEntitySurfaceDistance: () => 4500,
      random: sequenceRandom([0.99]),
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.data.salvaged, false);
  assert.ok(findItemById(wreckEntity.itemID), "wreck should remain after failed cycle");
  assert.equal(listContainerItems(TEST_CHARACTER_ID, TEST_SHIP_ID, ITEM_FLAGS.CARGO_HOLD).length, 0);
}));

test("successful salvage grants material and removes an empty wreck", () => withInventorySnapshot(() => {
  seedTestCharacter();
  const { entity: wreckEntity } = createWreck(ANGEL_SMALL_WRECK_TYPE_ID);
  const scene = buildScene(wreckEntity);
  const sourceEntity = buildSourceEntity();

  const result = salvagerRuntime.executeSalvagerCycle({
    scene,
    entity: sourceEntity,
    effectState: {
      moduleID: 991770201,
      moduleFlagID: 27,
      typeID: SALVAGER_I_TYPE_ID,
      targetID: wreckEntity.itemID,
      salvagerRangeMeters: 5000,
      salvageChancePercent: 100,
    },
    nowMs: Date.now(),
    callbacks: {
      isEntityLockedTarget: () => true,
      getEntitySurfaceDistance: () => 4500,
      getEntityRuntimeShipItem: () => buildShipItem(),
      getEntityRuntimeFittedItems: () => [],
      getEntityRuntimeSkillMap: () => new Map(),
      resolveCharacterID: () => TEST_CHARACTER_ID,
      syncInventoryChangesToSession() {},
      random: sequenceRandom([0, 0.99, 0, 0]),
    },
  });

  assert.equal(result.success, false, "successful salvage stops the module after cleanup");
  assert.equal(result.stopReason, "target");
  assert.equal(result.data.salvaged, true);
  assert.equal(findItemById(wreckEntity.itemID), null);
  assert.deepEqual(scene.removedEntityIDs, [wreckEntity.itemID]);

  const cargo = listContainerItems(TEST_CHARACTER_ID, TEST_SHIP_ID, ITEM_FLAGS.CARGO_HOLD);
  assert.equal(cargo.length, 1);
  assert.equal(cargo[0].typeID, 25595);
  assert.equal(cargo[0].stacksize, 1);
}));

test("successful salvage converts an unlooted wreck into a real cargo container", () => withInventorySnapshot(() => {
  seedTestCharacter();
  const { entity: wreckEntity } = createWreck(ANGEL_SMALL_WRECK_TYPE_ID);
  const lootResult = grantItemsToCharacterLocation(
    TEST_CHARACTER_ID,
    wreckEntity.itemID,
    ITEM_FLAGS.HANGAR,
    [{ itemType: VELDSPAR_TYPE_ID, quantity: 1 }],
  );
  assert.equal(lootResult.success, true);

  const scene = buildScene(wreckEntity);
  const sourceEntity = buildSourceEntity();
  const result = salvagerRuntime.executeSalvagerCycle({
    scene,
    entity: sourceEntity,
    effectState: {
      moduleID: 991770201,
      moduleFlagID: 27,
      typeID: SALVAGER_I_TYPE_ID,
      targetID: wreckEntity.itemID,
      salvagerRangeMeters: 5000,
      salvageChancePercent: 100,
    },
    nowMs: Date.now(),
    callbacks: {
      isEntityLockedTarget: () => true,
      getEntitySurfaceDistance: () => 4500,
      getEntityRuntimeShipItem: () => buildShipItem(),
      getEntityRuntimeFittedItems: () => [],
      getEntityRuntimeSkillMap: () => new Map(),
      resolveCharacterID: () => TEST_CHARACTER_ID,
      syncInventoryChangesToSession() {},
      spawnInventoryBackedEntity(itemRecord) {
        const containerEntity = {
          kind: "container",
          itemID: itemRecord.itemID,
          typeID: itemRecord.typeID,
          groupID: itemRecord.groupID,
          categoryID: itemRecord.categoryID,
          itemName: itemRecord.itemName,
          ownerID: itemRecord.ownerID,
          position: itemRecord.spaceState.position,
          radius: itemRecord.radius,
          systemID: TEST_SYSTEM_ID,
        };
        return scene.spawnDynamicEntity(containerEntity);
      },
      random: sequenceRandom([0, 0.99, 0, 0]),
    },
  });

  assert.equal(result.data.salvaged, true);
  assert.equal(findItemById(wreckEntity.itemID), null, "salvaged wreck should be removed");
  assert.deepEqual(scene.removedEntityIDs, [wreckEntity.itemID]);
  assert.equal(scene.spawnedEntities.length, 1);
  assert.equal(scene.spawnedEntities[0].kind, "container");
  assert.equal(scene.spawnedEntities[0].itemName, "Cargo Container");
  assert.equal(salvagerRuntime.isSalvageableTarget(scene.spawnedEntities[0]), false);

  const containerID = result.data.containerID;
  assert.ok(containerID, "salvaged loot should move into a new cargo container");
  const containerRecord = findItemById(containerID);
  assert.ok(containerRecord, "expected cargo container inventory item");
  assert.equal(containerRecord.itemName, "Cargo Container");
  assert.equal(
    listContainerItems(TEST_CHARACTER_ID, containerID, ITEM_FLAGS.HANGAR).length,
    1,
  );
  assert.equal(salvagerRuntime._testing.resolveAccessDifficultyBase(wreckEntity), 30);
}));

test("successful salvage converts an unlooted native NPC wreck into a cargo container", () => withInventorySnapshot(() => {
  seedTestCharacter();
  const wreckType = resolveItemByTypeID(ANGEL_LARGE_WRECK_TYPE_ID);
  const lootType = resolveItemByTypeID(VELDSPAR_TYPE_ID);
  assert.ok(wreckType);
  assert.ok(lootType);
  const wreckID = 991771900;
  const wreckItemID = 991771901;
  const nowMs = Date.now();
  const wreckRecord = {
    wreckID,
    systemID: TEST_SYSTEM_ID,
    ownerID: TEST_CHARACTER_ID,
    typeID: ANGEL_LARGE_WRECK_TYPE_ID,
    groupID: wreckType.groupID,
    categoryID: wreckType.categoryID,
    itemName: wreckType.name,
    radius: 32,
    capacity: 120,
    position: { x: 4500, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    targetPoint: { x: 4500, y: 0, z: 0 },
    createdAtMs: nowMs,
    expiresAtMs: nowMs + 60000,
    transient: true,
  };
  assert.equal(nativeNpcStore.upsertNativeWreck(wreckRecord, { transient: true }).success, true);
  assert.equal(nativeNpcStore.upsertNativeWreckItem({
    wreckItemID,
    wreckID,
    ownerID: TEST_CHARACTER_ID,
    locationID: wreckID,
    flagID: ITEM_FLAGS.HANGAR,
    typeID: VELDSPAR_TYPE_ID,
    groupID: lootType.groupID,
    categoryID: lootType.categoryID,
    itemName: lootType.name,
    quantity: 1,
    singleton: false,
    transient: true,
  }, { transient: true }).success, true);

  const wreckEntity = {
    kind: "wreck",
    nativeNpcWreck: true,
    itemID: wreckID,
    typeID: ANGEL_LARGE_WRECK_TYPE_ID,
    groupID: wreckType.groupID,
    categoryID: wreckType.categoryID,
    itemName: wreckType.name,
    ownerID: TEST_CHARACTER_ID,
    position: { x: 4500, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    radius: 32,
    systemID: TEST_SYSTEM_ID,
  };
  const scene = buildScene(wreckEntity);
  const sourceEntity = buildSourceEntity();
  const result = salvagerRuntime.executeSalvagerCycle({
    scene,
    entity: sourceEntity,
    effectState: {
      moduleID: 991770201,
      moduleFlagID: 27,
      typeID: SALVAGER_I_TYPE_ID,
      targetID: wreckEntity.itemID,
      salvagerRangeMeters: 5000,
      salvageChancePercent: 100,
    },
    nowMs,
    callbacks: {
      isEntityLockedTarget: () => true,
      getEntitySurfaceDistance: () => 4500,
      getEntityRuntimeShipItem: () => buildShipItem(),
      getEntityRuntimeFittedItems: () => [],
      getEntityRuntimeSkillMap: () => new Map(),
      resolveCharacterID: () => TEST_CHARACTER_ID,
      syncInventoryChangesToSession() {},
      spawnInventoryBackedEntity(itemRecord) {
        const containerEntity = {
          kind: "container",
          itemID: itemRecord.itemID,
          typeID: itemRecord.typeID,
          groupID: itemRecord.groupID,
          categoryID: itemRecord.categoryID,
          itemName: itemRecord.itemName,
          ownerID: itemRecord.ownerID,
          position: itemRecord.spaceState.position,
          radius: itemRecord.radius,
          systemID: TEST_SYSTEM_ID,
        };
        return scene.spawnDynamicEntity(containerEntity);
      },
      random: sequenceRandom([0, 0.99, 0, 0]),
    },
  });

  assert.equal(result.data.salvaged, true);
  assert.equal(nativeNpcStore.getNativeWreck(wreckID), null);
  assert.equal(nativeNpcStore.listNativeWreckItemsForWreck(wreckID).length, 0);
  assert.deepEqual(scene.removedEntityIDs, [wreckID]);
  assert.equal(scene.spawnedEntities.length, 1);
  assert.equal(scene.spawnedEntities[0].itemName, "Cargo Container");
  assert.equal(salvagerRuntime.isSalvageableTarget(scene.spawnedEntities[0]), false);

  const containerID = result.data.containerID;
  assert.ok(containerID);
  assert.equal(
    listContainerItems(TEST_CHARACTER_ID, containerID, ITEM_FLAGS.HANGAR).length,
    1,
  );
}));
