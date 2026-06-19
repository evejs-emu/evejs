const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const structureState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureState",
));
const structureLocatorGeometry = require(path.join(
  repoRoot,
  "server/src/services/structure/structureLocatorGeometry",
));

const DEFAULT_PASSIVE_STATE = Object.freeze({
  mass: 1_000_000,
  agility: 0.5,
  maxVelocity: 300,
  maxTargetRange: 250_000,
  maxLockedTargets: 7,
  signatureRadius: 50,
  scanResolution: 500,
  cloakingTargetingDelay: 0,
  capacitorCapacity: 1000,
  capacitorRechargeRate: 1000,
  shieldCapacity: 1000,
  shieldRechargeRate: 1000,
  armorHP: 1000,
  structureHP: 1000,
});

function readTable(tableName) {
  const result = database.read(tableName, "/");
  assert.equal(result.success, true, `Failed to read ${tableName}`);
  return result.data;
}

function writeTable(tableName, payload) {
  const result = database.write(tableName, "/", payload);
  assert.equal(result.success, true, `Failed to write ${tableName}`);
}

function assertNearlyEqual(actual, expected, tolerance = 0.01, label = "value") {
  assert.ok(
    Math.abs(Number(actual) - Number(expected)) <= tolerance,
    `${label}: expected ${expected}, got ${actual}`,
  );
}

function assertVectorAlmostEqual(actual, expected, tolerance = 0.01, label = "vector") {
  assertNearlyEqual(actual && actual.x, expected && expected.x, tolerance, `${label}.x`);
  assertNearlyEqual(actual && actual.y, expected && expected.y, tolerance, `${label}.y`);
  assertNearlyEqual(actual && actual.z, expected && expected.z, tolerance, `${label}.z`);
}

function buildShipEntity(scene, itemID, typeID, position) {
  const entity = spaceRuntime._testing.buildRuntimeShipEntityForTesting({
    itemID,
    typeID,
    position,
    passiveResourceState: {
      ...DEFAULT_PASSIVE_STATE,
    },
  }, scene.systemID);
  scene.spawnDynamicEntity(entity, { broadcast: false });
  return entity;
}

test.afterEach(() => {
  spaceRuntime._testing.clearScenes();
  structureState.clearStructureCaches();
  structureLocatorGeometry.clearStructureLocatorGeometryCache();
});

test("dockable Upwell structure types all resolve client-authored undock locators", () => {
  structureState.clearStructureCaches();

  const dockableTypes = structureState.getStructureTypes()
    .filter((row) => row && row.dockable === true && row.published !== false)
    .sort((left, right) => left.typeID - right.typeID);

  assert.equal(
    dockableTypes.some((row) => Number(row.typeID) === 81826),
    false,
    "Expected Metenox Moon Drill to stop being treated as dockable",
  );

  for (const typeRecord of dockableTypes) {
    const profile = structureLocatorGeometry.getStructureLocatorProfile(typeRecord.typeID);
    assert.ok(profile, `Expected a locator profile for dockable structure ${typeRecord.name}`);
    assert.equal(
      profile.hasUndockLocators,
      true,
      `Expected dockable structure ${typeRecord.name} to expose authored undock locators`,
    );
    assert.ok(
      Array.isArray(profile.directionalLocators) && profile.directionalLocators.length > 0,
      `Expected dockable structure ${typeRecord.name} to have at least one locator row`,
    );
  }
});

test("structure locator geometry rotates authored positions and directions by player placement", () => {
  const geometry = structureLocatorGeometry.buildStructureDockingGeometry(
    {
      structureID: 1030000000001,
      typeID: 35826,
      position: { x: 1000, y: 2000, z: 3000 },
      rotation: [90, 0, 0],
      radius: 20000,
    },
    {
      shipTypeID: 638,
      selectionStrategy: "first",
    },
  );

  assert.equal(geometry.source, "authored");
  assert.equal(geometry.locatorCategory, "undockPointLarge");
  assert.equal(geometry.locatorName, "large01");
  assertVectorAlmostEqual(
    geometry.dockPosition,
    {
      x: 33649.83203,
      y: 2801.25568,
      z: 22506.76172,
    },
    0.05,
    "dockPosition",
  );
  assertVectorAlmostEqual(
    geometry.dockOrientation,
    { x: 1, y: 0, z: 0 },
    0.0001,
    "dockOrientation",
  );
});

test("runtime docking and undock paths use ship-class-aware Upwell locator geometry", () => {
  const structuresBackup = readTable("structures");

  try {
    structureState.clearStructureCaches();

    const createResult = structureState.createStructure({
      typeID: 35834,
      name: "Locator Test Keepstar",
      itemName: "Locator Test Keepstar",
      ownerCorpID: 1000009,
      solarSystemID: 30000142,
      position: { x: 450000, y: 1200, z: -330000 },
      rotation: [180, 0, 0],
      state: 110,
      upkeepState: 1,
      hasQuantumCore: true,
      accessProfile: {
        docking: "public",
        tethering: "public",
      },
      serviceStates: {
        "1": 1,
      },
    });
    assert.equal(createResult.success, true, "Expected structure creation to succeed");
    const structure = createResult.data;

    const scene = spaceRuntime.ensureScene(structure.solarSystemID);
    scene.syncStructureEntitiesFromState({ broadcast: false });
    const structureEntity = scene.getEntityByID(structure.structureID);
    assert.ok(structureEntity, "Expected the structure entity to exist");

    const battleship = buildShipEntity(
      scene,
      920001,
      638,
      { x: structure.position.x + 150000, y: 1200, z: structure.position.z + 50000 },
    );
    const titan = buildShipEntity(
      scene,
      920002,
      11567,
      { x: structure.position.x - 150000, y: 1200, z: structure.position.z - 50000 },
    );

    const expectedBattleshipDock = structureLocatorGeometry.getStructureDockPosition(
      structureEntity,
      {
        shipTypeID: battleship.typeID,
        selectionStrategy: "hash",
        selectionKey: battleship.itemID,
      },
    );
    const expectedTitanDock = structureLocatorGeometry.getStructureDockPosition(
      structureEntity,
      {
        shipTypeID: titan.typeID,
        selectionStrategy: "hash",
        selectionKey: titan.itemID,
      },
    );

    assert.equal(
      scene.followShipEntity(
        battleship,
        structureEntity.itemID,
        0,
        {
          dockingTargetID: structureEntity.itemID,
        },
      ),
      true,
      "Expected battleship docking follow to start",
    );
    assert.equal(
      scene.followShipEntity(
        titan,
        structureEntity.itemID,
        0,
        {
          dockingTargetID: structureEntity.itemID,
        },
      ),
      true,
      "Expected titan docking follow to start",
    );
    assertVectorAlmostEqual(
      battleship.targetPoint,
      expectedBattleshipDock,
      0.05,
      "battleship.targetPoint",
    );
    assertVectorAlmostEqual(
      titan.targetPoint,
      expectedTitanDock,
      0.05,
      "titan.targetPoint",
    );
    assert.notDeepEqual(
      expectedBattleshipDock,
      expectedTitanDock,
      "Expected ship class selection to choose different Keepstar locator sets",
    );

    const runtimeWarpTarget = spaceRuntime._testing.getStationWarpTargetPositionForTesting(
      structureEntity,
      {
        shipTypeID: titan.typeID,
        selectionKey: titan.itemID,
      },
    );
    assertVectorAlmostEqual(
      runtimeWarpTarget,
      structureEntity.position,
      0.05,
      "runtimeWarpTarget",
    );

    const recordUndockState = spaceRuntime.getStationUndockSpawnState(structure, {
      shipTypeID: titan.typeID,
      selectionStrategy: "first",
      selectionKey: titan.itemID,
    });
    const entityUndockState = spaceRuntime.getStationUndockSpawnState(structureEntity, {
      shipTypeID: titan.typeID,
      selectionStrategy: "first",
      selectionKey: titan.itemID,
    });
    const expectedUndockState = structureLocatorGeometry.buildStructureUndockSpawnState(
      structureEntity,
      {
        shipTypeID: titan.typeID,
        selectionStrategy: "first",
        selectionKey: titan.itemID,
      },
    );
    assertVectorAlmostEqual(
      recordUndockState.position,
      expectedUndockState.position,
      0.05,
      "recordUndockState.position",
    );
    assertVectorAlmostEqual(
      entityUndockState.position,
      expectedUndockState.position,
      0.05,
      "entityUndockState.position",
    );
    assertVectorAlmostEqual(
      entityUndockState.direction,
      expectedUndockState.direction,
      0.0001,
      "entityUndockState.direction",
    );
  } finally {
    writeTable("structures", structuresBackup);
    structureState.clearStructureCaches();
  }
});
