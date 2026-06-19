process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");

const database = require(path.join(repoRoot, "server/src/newDatabase"));
const runtime = require(path.join(repoRoot, "server/src/space/runtime"));
const npcService = require(path.join(repoRoot, "server/src/space/npc/npcService"));
const nativeNpcStore = require(path.join(repoRoot, "server/src/space/npc/nativeNpcStore"));
const nativeNpcWreckService = require(path.join(repoRoot, "server/src/space/npc/nativeNpcWreckService"));
const shipDestruction = require(path.join(repoRoot, "server/src/space/shipDestruction"));
const InvBrokerService = require(path.join(repoRoot, "server/src/services/inventory/invBrokerService"));
const {
  launchNpcFighterWing,
} = require(path.join(repoRoot, "server/src/services/fighter/npc/npcSupercarrierDirector"));
const {
  marshalEncode,
} = require(path.join(repoRoot, "server/src/network/tcp/utils/marshal"));
const {
  findItemById,
  ITEM_FLAGS,
} = require(path.join(repoRoot, "server/src/services/inventory/itemStore"));
const {
  DEFAULT_STATION,
} = require(path.join(repoRoot, "server/src/services/_shared/stationStaticData"));

const TEST_SYSTEM_ID = 30000142;
const TABLE_NAMES = [
  "characters",
  "items",
  "skills",
  "npcEntities",
  "npcModules",
  "npcCargo",
  "npcRuntimeControllers",
  "npcWrecks",
  "npcWreckItems",
];

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function readTableSnapshot(tableName) {
  const result = database.read(tableName, "/");
  return result.success ? cloneValue(result.data) : {};
}

function writeTableSnapshot(tableName, snapshot) {
  database.write(tableName, "/", cloneValue(snapshot));
}

function snapshotAllTables() {
  return Object.fromEntries(TABLE_NAMES.map((tableName) => ([
    tableName,
    readTableSnapshot(tableName),
  ])));
}

function restoreAllTables(snapshot) {
  for (const tableName of TABLE_NAMES) {
    writeTableSnapshot(tableName, snapshot[tableName] || {});
  }
}

function countRows(tableName, key) {
  const snapshot = readTableSnapshot(tableName);
  const collection = snapshot && typeof snapshot === "object"
    ? snapshot[key]
    : null;
  return collection && typeof collection === "object"
    ? Object.keys(collection).length
    : 0;
}

function createNativeCombatNpc() {
  const spawnResult = npcService.spawnNpcBatchInSystem(TEST_SYSTEM_ID, {
    entityType: "concord",
    runtimeKind: "nativeCombat",
    amount: 1,
    profileQuery: "concord_response",
    transient: true,
    anchorDescriptor: {
      kind: "coordinates",
      position: { x: 150_000, y: 0, z: 75_000 },
      direction: { x: 1, y: 0, z: 0 },
    },
  });
  assert.equal(spawnResult.success, true);
  assert.ok(spawnResult.data);
  assert.ok(Array.isArray(spawnResult.data.spawned));
  assert.equal(spawnResult.data.spawned.length, 1);
  return spawnResult.data.spawned[0].entity;
}

function createTransientPirateNpc() {
  const spawnResult = npcService.spawnNpcBatchInSystem(TEST_SYSTEM_ID, {
    entityType: "npc",
    amount: 1,
    profileQuery: "generic_hostile",
    transient: true,
    anchorDescriptor: {
      kind: "coordinates",
      position: { x: 220_000, y: 0, z: 95_000 },
      direction: { x: 1, y: 0, z: 0 },
    },
  });
  assert.equal(spawnResult.success, true);
  assert.ok(spawnResult.data);
  assert.equal(spawnResult.data.spawned.length, 1);
  return spawnResult.data.spawned[0].entity;
}

function createTransientCapitalNpc(profileQuery) {
  const spawnResult = npcService.spawnNpcBatchInSystem(TEST_SYSTEM_ID, {
    entityType: "npc",
    amount: 1,
    profileQuery,
    transient: true,
    anchorDescriptor: {
      kind: "coordinates",
      position: { x: 260_000, y: 0, z: 115_000 },
      direction: { x: 1, y: 0, z: 0 },
    },
  });
  assert.equal(spawnResult.success, true);
  assert.ok(spawnResult.data);
  assert.equal(spawnResult.data.spawned.length, 1);
  return spawnResult.data.spawned[0].entity;
}

function createTransientGeneratedNpc(profileQuery, position = { x: 240_000, y: 0, z: 105_000 }) {
  const spawnResult = npcService.spawnNpcBatchInSystem(TEST_SYSTEM_ID, {
    entityType: "npc",
    amount: 1,
    profileQuery,
    transient: true,
    anchorDescriptor: {
      kind: "coordinates",
      position,
      direction: { x: 1, y: 0, z: 0 },
    },
  });
  assert.equal(spawnResult.success, true);
  assert.ok(spawnResult.data);
  assert.equal(spawnResult.data.spawned.length, 1);
  return spawnResult.data.spawned[0].entity;
}

function withMockedRandom(sequence, fn) {
  const originalRandom = Math.random;
  let index = 0;
  Math.random = () => {
    const value = sequence[index];
    index += 1;
    return typeof value === "number" ? value : 0;
  };
  try {
    return fn();
  } finally {
    Math.random = originalRandom;
  }
}

function createInventorySession() {
  return {
    characterID: 140000001,
    charid: 140000001,
    userid: 1,
    stationid: DEFAULT_STATION.stationID,
    stationID: DEFAULT_STATION.stationID,
    shipID: 140000101,
    shipid: 140000101,
    activeShipID: 140000101,
    sendNotification() {},
    currentBoundObjectID: null,
  };
}

function getFighterEntities(scene, controllerID) {
  const numericControllerID = Number(controllerID) || 0;
  return [...scene.dynamicEntities.values()].filter((entity) => (
    entity &&
    entity.kind === "fighter" &&
    Number(entity.controllerID) === numericControllerID
  ));
}

test("native NPC destruction creates a native wreck without touching player tables", () => {
  const tableSnapshot = snapshotAllTables();
  runtime._testing.clearScenes();

  try {
    const playerCountsBefore = {
      characters: Object.keys(readTableSnapshot("characters")).length,
      items: Object.keys(readTableSnapshot("items")).length,
      skills: Object.keys(readTableSnapshot("skills")).length,
    };

    const entity = createNativeCombatNpc();
    const destroyResult = shipDestruction._testing.destroyShipEntityWithWreck(
      TEST_SYSTEM_ID,
      entity,
    );
    assert.equal(destroyResult.success, true);
    assert.ok(destroyResult.data);
    assert.ok(destroyResult.data.wreck);

    const wreckRecord = nativeNpcStore.getNativeWreck(destroyResult.data.wreck.wreckID);
    assert.ok(wreckRecord);
    assert.equal(nativeNpcStore.getNativeEntity(entity.itemID), null);
    assert.equal(nativeNpcStore.getNativeController(entity.itemID), null);
    assert.equal(nativeNpcStore.listNativeModulesForEntity(entity.itemID).length, 0);
    assert.equal(nativeNpcStore.listNativeCargoForEntity(entity.itemID).length, 0);

    const wreckItems = nativeNpcStore.listNativeWreckItemsForWreck(wreckRecord.wreckID);
    assert.ok(wreckItems.length > 0, "expected native wreck contents for destroyed native NPC");

    const scene = runtime.ensureScene(TEST_SYSTEM_ID);
    const wreckEntity = scene.getEntityByID(wreckRecord.wreckID);
    assert.ok(wreckEntity);
    assert.equal(wreckEntity.nativeNpcWreck, true);
    assert.equal(wreckEntity.kind, "wreck");
    assert.ok(
      Number(wreckEntity.structureHP || 0) > 0,
      "expected native wreck entities to carry attackable structure HP even when static wreck dogma omits it",
    );

    const playerCountsAfter = {
      characters: Object.keys(readTableSnapshot("characters")).length,
      items: Object.keys(readTableSnapshot("items")).length,
      skills: Object.keys(readTableSnapshot("skills")).length,
    };
    assert.deepEqual(playerCountsAfter, playerCountsBefore);
  } finally {
    runtime._testing.clearScenes();
    restoreAllTables(tableSnapshot);
  }
});

test("native NPC wreck broadcasts stay on the immediate lane instead of fresh-acquire bootstrap", () => {
  const tableSnapshot = snapshotAllTables();
  runtime._testing.clearScenes();

  try {
    const scene = runtime.ensureScene(TEST_SYSTEM_ID);
    const originalSpawnDynamicEntity = scene.spawnDynamicEntity.bind(scene);
    let capturedWreckSpawnOptions = null;
    scene.spawnDynamicEntity = (entity, options = {}) => {
      if (entity && entity.nativeNpcWreck === true) {
        capturedWreckSpawnOptions = cloneValue(options);
      }
      return originalSpawnDynamicEntity(entity, options);
    };

    const entity = createNativeCombatNpc();
    const destroyResult = shipDestruction._testing.destroyShipEntityWithWreck(
      TEST_SYSTEM_ID,
      entity,
    );
    assert.equal(destroyResult.success, true);
    assert.ok(capturedWreckSpawnOptions);
    assert.equal(
      capturedWreckSpawnOptions &&
        capturedWreckSpawnOptions.broadcastOptions &&
        capturedWreckSpawnOptions.broadcastOptions.freshAcquire,
      false,
      "expected live native NPC wreck handoff to avoid bootstrap-acquire lane",
    );
  } finally {
    runtime._testing.clearScenes();
    restoreAllTables(tableSnapshot);
  }
});

test("native NPC wrecks reuse the shared inventory-backed runtime shape", () => {
  const tableSnapshot = snapshotAllTables();
  runtime._testing.clearScenes();

  try {
    const entity = createNativeCombatNpc();
    const destroyResult = shipDestruction._testing.destroyShipEntityWithWreck(
      TEST_SYSTEM_ID,
      entity,
    );
    assert.equal(destroyResult.success, true);

    const wreckID = Number(
      destroyResult &&
      destroyResult.data &&
      destroyResult.data.wreck &&
      destroyResult.data.wreck.wreckID,
    ) || 0;
    assert.ok(wreckID > 0);

    const wreckItem = nativeNpcStore.buildNativeWreckInventoryItem(wreckID);
    assert.ok(wreckItem);
    assert.ok(wreckItem.spaceState);
    assert.deepEqual(wreckItem.spaceState.position, destroyResult.data.wreck.position);

    const wreckRecord = nativeNpcStore.getNativeWreck(wreckID);
    const wreckEntity = nativeNpcWreckService.buildNativeWreckRuntimeEntity(wreckRecord, {
      nowMs: wreckRecord.createdAtMs,
    });
    assert.ok(wreckEntity);
    assert.equal(wreckEntity.nativeNpcWreck, true);
    assert.equal(wreckEntity.persistSpaceState, false);
    assert.ok(wreckEntity.spaceState);
    assert.deepEqual(wreckEntity.spaceState.position, wreckItem.spaceState.position);
    assert.equal(wreckEntity.position.x, wreckItem.spaceState.position.x);
    assert.equal(wreckEntity.position.y, wreckItem.spaceState.position.y);
    assert.equal(wreckEntity.position.z, wreckItem.spaceState.position.z);
    assert.equal(typeof wreckEntity.mass, "number");
    assert.equal(typeof wreckEntity.inertia, "number");
    assert.equal(typeof wreckEntity.maxVelocity, "number");
    assert.ok(wreckEntity.passiveDerivedState);
  } finally {
    runtime._testing.clearScenes();
    restoreAllTables(tableSnapshot);
  }
});

test("ordinary pirate NPC destruction resolves faction-sized wrecks instead of empire hull wrecks", () => {
  const tableSnapshot = snapshotAllTables();
  runtime._testing.clearScenes();

  try {
    const entity = createTransientPirateNpc();
    assert.equal(String(entity.itemName || ""), "Blood Visionary");

    const resolvedWreck = shipDestruction._testing.resolveEntityWreckType({
      nativeNpc: true,
      shipTypeID: entity.typeID,
      itemName: entity.itemName,
      profileID: "generic_hostile",
      npcEntityType: "npc",
    });
    assert.ok(resolvedWreck);
    assert.equal(String(resolvedWreck.name || ""), "Blood Small Wreck");

    const destroyResult = shipDestruction._testing.destroyShipEntityWithWreck(
      TEST_SYSTEM_ID,
      entity,
    );
    assert.equal(destroyResult.success, true);
    assert.equal(
      String(destroyResult.data.wreck.itemName || ""),
      "Blood Small Wreck",
    );
  } finally {
    runtime._testing.clearScenes();
    restoreAllTables(tableSnapshot);
  }
});

test("generated Trig NPC destruction seeds authored survey-data loot through the native wreck path", () => {
  const tableSnapshot = snapshotAllTables();
  runtime._testing.clearScenes();

  try {
    const entity = createTransientGeneratedNpc(
      "parity_trig_renewing_rodiva",
      { x: 225_000, y: 0, z: 90_000 },
    );
    const destroyResult = withMockedRandom([0, 0.99, 0, 0], () => (
      shipDestruction._testing.destroyShipEntityWithWreck(
        TEST_SYSTEM_ID,
        entity,
      )
    ));
    assert.equal(destroyResult.success, true);

    const wreckItems = nativeNpcStore.listNativeWreckItemsForWreck(
      destroyResult.data.wreck.wreckID,
    );
    assert.ok(wreckItems.length >= 2, "expected generated Trig wreck items");
    assert.equal(
      wreckItems.some((entry) => (
        Number(entry && entry.typeID) === 48121 &&
        Number(entry && entry.quantity) === 2
      )),
      true,
      "expected authored Trig survey database drop in the wreck",
    );
    assert.equal(
      wreckItems.some((entry) => Number(entry && entry.typeID) === 49735),
      true,
      "expected authored Trig mutaplasmid roll in the wreck",
    );
  } finally {
    runtime._testing.clearScenes();
    restoreAllTables(tableSnapshot);
  }
});

test("generated Drifter NPC destruction seeds authored blue-loot drops through the native wreck path", () => {
  const tableSnapshot = snapshotAllTables();
  runtime._testing.clearScenes();

  try {
    const entity = createTransientGeneratedNpc(
      "parity_drifter_lancer",
      { x: 245_000, y: 0, z: 110_000 },
    );
    const destroyResult = withMockedRandom([0, 0.99, 0, 0], () => (
      shipDestruction._testing.destroyShipEntityWithWreck(
        TEST_SYSTEM_ID,
        entity,
      )
    ));
    assert.equal(destroyResult.success, true);

    const wreckItems = nativeNpcStore.listNativeWreckItemsForWreck(
      destroyResult.data.wreck.wreckID,
    );
    assert.ok(wreckItems.length >= 2, "expected generated Drifter wreck items");
    assert.equal(
      wreckItems.some((entry) => (
        Number(entry && entry.typeID) === 30745 &&
        Number(entry && entry.quantity) === 4
      )),
      true,
      "expected authored Drifter sleeper-library drop in the wreck",
    );
    assert.equal(
      wreckItems.some((entry) => Number(entry && entry.typeID) === 34575),
      true,
      "expected authored Drifter Antikythera roll in the wreck",
    );
  } finally {
    runtime._testing.clearScenes();
    restoreAllTables(tableSnapshot);
  }
});

test("capital NPC destruction uses explicit faction wreck mappings instead of the generic wreck fallback", () => {
  const tableSnapshot = snapshotAllTables();
  runtime._testing.clearScenes();

  try {
    const bloodTitan = createTransientCapitalNpc("capital_dark_blood_titan");
    const bloodTitanDestroyResult = shipDestruction._testing.destroyShipEntityWithWreck(
      TEST_SYSTEM_ID,
      bloodTitan,
    );
    assert.equal(bloodTitanDestroyResult.success, true);
    assert.equal(
      String(bloodTitanDestroyResult.data.wreck.itemName || ""),
      "Blood Titan Wreck",
    );

    const sanshaSuper = createTransientCapitalNpc("capital_true_sanshas_supercarrier");
    const sanshaSuperDestroyResult = shipDestruction._testing.destroyShipEntityWithWreck(
      TEST_SYSTEM_ID,
      sanshaSuper,
    );
    assert.equal(sanshaSuperDestroyResult.success, true);
    assert.equal(
      String(sanshaSuperDestroyResult.data.wreck.itemName || ""),
      "Sanshas Supercarrier Wreck",
    );

    const rogueCarrier = createTransientCapitalNpc("capital_infested_carrier");
    const rogueCarrierDestroyResult = shipDestruction._testing.destroyShipEntityWithWreck(
      TEST_SYSTEM_ID,
      rogueCarrier,
    );
    assert.equal(rogueCarrierDestroyResult.success, true);
    assert.equal(
      String(rogueCarrierDestroyResult.data.wreck.itemName || ""),
      "Rogue Carrier Wreck",
    );
  } finally {
    runtime._testing.clearScenes();
    restoreAllTables(tableSnapshot);
  }
});

test("capital NPC destruction still resolves the authored wreck when the profile record is unavailable at death time", () => {
  const tableSnapshot = snapshotAllTables();
  runtime._testing.clearScenes();

  try {
    const bloodTitan = createTransientCapitalNpc("capital_dark_blood_titan");
    nativeNpcStore.removeNativeEntityCascade(bloodTitan.itemID);
    assert.equal(nativeNpcStore.getNativeEntity(bloodTitan.itemID), null);

    const destroyResult = shipDestruction._testing.destroyShipEntityWithWreck(
      TEST_SYSTEM_ID,
      bloodTitan,
    );
    assert.equal(destroyResult.success, true);
    assert.equal(
      String(destroyResult.data.wreck.itemName || ""),
      "Blood Titan Wreck",
    );
  } finally {
    runtime._testing.clearScenes();
    restoreAllTables(tableSnapshot);
  }
});

test("fighter-capable capital destruction removes launched NPC fighters before wreck handoff", () => {
  const tableSnapshot = snapshotAllTables();
  runtime._testing.clearScenes();

  try {
    const supercarrier = createTransientCapitalNpc("capital_true_sanshas_supercarrier");
    const scene = runtime.ensureScene(TEST_SYSTEM_ID);
    const controller = npcService.getControllerByEntityID(supercarrier.itemID);
    assert.ok(controller, "expected capital controller");
    assert.ok(
      Array.isArray(controller.behaviorProfile && controller.behaviorProfile.capitalFighterWingTypeIDs),
      "expected fighter-capable behavior profile",
    );

    const launchResult = launchNpcFighterWing(
      scene,
      supercarrier,
      controller.behaviorProfile,
      {
        maxLaunchCount: 5,
      },
    );
    assert.equal(launchResult.success, true);
    assert.ok(getFighterEntities(scene, supercarrier.itemID).length > 0, "expected launched NPC fighter squadrons");

    const destroyResult = shipDestruction._testing.destroyShipEntityWithWreck(
      TEST_SYSTEM_ID,
      supercarrier,
    );
    assert.equal(destroyResult.success, true);
    assert.ok(
      Number(destroyResult.data && destroyResult.data.destroyedFighterCount) > 0,
      "expected the death path to report destroyed fighter squadrons",
    );
    assert.equal(
      getFighterEntities(scene, supercarrier.itemID).length,
      0,
      "expected launched fighter squadrons to be removed when the capital dies",
    );
  } finally {
    runtime._testing.clearScenes();
    restoreAllTables(tableSnapshot);
  }
});

test("transient pirate NPC spawns now use the native NPC path", () => {
  const tableSnapshot = snapshotAllTables();
  runtime._testing.clearScenes();

  try {
    const entity = createTransientPirateNpc();
    assert.equal(entity.nativeNpc, true);
    assert.equal(nativeNpcStore.getNativeEntity(entity.itemID) !== null, true);
    assert.equal(nativeNpcStore.getNativeController(entity.itemID) !== null, true);
  } finally {
    runtime._testing.clearScenes();
    restoreAllTables(tableSnapshot);
  }
});

test("default pirate batch spawns now use runtime-only native controllers", () => {
  const tableSnapshot = snapshotAllTables();
  runtime._testing.clearScenes();

  try {
    const spawnResult = npcService.spawnNpcBatchInSystem(TEST_SYSTEM_ID, {
      entityType: "npc",
      amount: 1,
      profileQuery: "generic_hostile",
      anchorDescriptor: {
        kind: "coordinates",
        position: { x: 320_000, y: 0, z: 145_000 },
        direction: { x: 1, y: 0, z: 0 },
      },
    });
    assert.equal(spawnResult.success, true);
    assert.ok(spawnResult.data);
    assert.equal(spawnResult.data.spawned.length, 1);

    const entity = spawnResult.data.spawned[0].entity;
    const controller = npcService.getControllerByEntityID(entity.itemID);
    assert.equal(entity.nativeNpc, true);
    assert.ok(controller);
    assert.equal(String(controller.runtimeKind || "").startsWith("native"), true);
    assert.equal(controller.transient, true);
  } finally {
    runtime._testing.clearScenes();
    restoreAllTables(tableSnapshot);
  }
});

test("inventory broker can list and loot native wreck contents", () => {
  const tableSnapshot = snapshotAllTables();
  runtime._testing.clearScenes();

  try {
    const entity = createNativeCombatNpc();
    const destroyResult = shipDestruction._testing.destroyShipEntityWithWreck(
      TEST_SYSTEM_ID,
      entity,
    );
    assert.equal(destroyResult.success, true);

    const wreckID = destroyResult.data.wreck.wreckID;
    const contentsBefore = nativeNpcStore.buildNativeWreckContents(wreckID);
    assert.ok(contentsBefore.length > 0);
    const firstItem = contentsBefore[0];

    const invBroker = new InvBrokerService();
    const session = createInventorySession();
    invBroker._rememberBoundContext("test-station-hangar", {
      inventoryID: DEFAULT_STATION.stationID,
      locationID: DEFAULT_STATION.stationID,
      flagID: ITEM_FLAGS.HANGAR,
      kind: "stationHangar",
    });
    session.currentBoundObjectID = "test-station-hangar";

    const listedItems = invBroker._resolveContainerItems(
      session,
      null,
      {
        inventoryID: wreckID,
        locationID: wreckID,
        flagID: null,
        kind: "container",
      },
    );
    assert.equal(listedItems.length, contentsBefore.length);

    const movedItemID = invBroker.Handle_Add(
      [firstItem.itemID, wreckID],
      session,
      { flag: ITEM_FLAGS.HANGAR },
    );
    assert.ok(Number(movedItemID) > 0);

    const lootedItem = findItemById(movedItemID);
    assert.ok(lootedItem);
    assert.equal(Number(lootedItem.locationID), DEFAULT_STATION.stationID);
    assert.equal(Number(lootedItem.flagID), ITEM_FLAGS.HANGAR);

    const contentsAfter = nativeNpcStore.buildNativeWreckContents(wreckID);
    assert.equal(
      contentsAfter.length,
      contentsBefore.length - 1,
      "expected one wreck item to be removed after looting",
    );

    nativeNpcWreckService.destroyNativeWreck(wreckID, {
      systemID: TEST_SYSTEM_ID,
    });
    assert.equal(nativeNpcStore.getNativeWreck(wreckID), null);
  } finally {
    runtime._testing.clearScenes();
    restoreAllTables(tableSnapshot);
  }
});

test("inventory broker native wreck lists marshal large wreck location IDs", () => {
  const tableSnapshot = snapshotAllTables();
  runtime._testing.clearScenes();

  try {
    const entity = createNativeCombatNpc();
    const destroyResult = shipDestruction._testing.destroyShipEntityWithWreck(
      TEST_SYSTEM_ID,
      entity,
    );
    assert.equal(destroyResult.success, true);

    const wreckID = destroyResult.data.wreck.wreckID;
    const invBroker = new InvBrokerService();
    const session = createInventorySession();
    invBroker._rememberBoundContext("test-native-wreck", {
      inventoryID: wreckID,
      locationID: wreckID,
      flagID: null,
      kind: "container",
    });
    session.currentBoundObjectID = "test-native-wreck";

    const result = invBroker.Handle_List([], session, {
      type: "dict",
      entries: [
        ["flag", null],
        ["machoVersion", 1],
      ],
    });
    assert.ok(result);
    assert.equal(result.type, "list");
    assert.ok(Array.isArray(result.items));
    assert.ok(result.items.length > 0);
    assert.doesNotThrow(
      () => marshalEncode(result),
      "Expected native wreck inventory lists to marshal without int32 overflow",
    );
  } finally {
    runtime._testing.clearScenes();
    restoreAllTables(tableSnapshot);
  }
});
