const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const worldData = require(path.join(repoRoot, "server/src/space/worldData"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const stationLocatorGeometry = require(path.join(
  repoRoot,
  "server/src/services/station/stationLocatorGeometry",
));

function readTable(tableName) {
  const result = database.read(tableName, "/");
  assert.equal(result.success, true, `Failed to read ${tableName}`);
  return result.data;
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

test.afterEach(() => {
  stationLocatorGeometry.clearStationLocatorGeometryCache();
});

test("all cached station types resolve client-authored station locator profiles", () => {
  const stationTypes = readTable("stationTypes").stationTypes || [];
  const locatorRows = readTable("stationGraphicLocators").locators || [];

  assert.equal(locatorRows.length, stationTypes.length);

  for (const stationType of stationTypes) {
    const profile = stationLocatorGeometry.getStationLocatorProfile(
      stationType.stationTypeID,
    );
    assert.ok(profile, `Expected locator profile for ${stationType.typeName}`);
    assert.equal(
      profile.hasUndockLocators,
      true,
      `Expected authored undock locators for ${stationType.typeName}`,
    );
    assert.ok(
      Array.isArray(profile.directionalLocators) &&
        profile.directionalLocators.length > 0,
      `Expected locator rows for ${stationType.typeName}`,
    );
  }
});

test("station type records now carry client-authored dock vectors for previously empty station types", () => {
  const airOutpost = worldData.getStationTypeByID(59956);
  const paragonCenter = worldData.getStationTypeByID(71361);
  const damagedTradePost = worldData.getStationTypeByID(74397);
  const ancientOutpost = worldData.getStationTypeByID(78334);

  for (const record of [
    airOutpost,
    paragonCenter,
    damagedTradePost,
    ancientOutpost,
  ]) {
    assert.ok(record, "Expected station type record to exist");
    assert.ok(record.dockEntry, `Expected dockEntry for ${record.typeName}`);
    assert.ok(
      record.dockOrientation,
      `Expected dockOrientation for ${record.typeName}`,
    );
    assert.ok(
      Array.isArray(record.undockLocatorCategories) &&
        record.undockLocatorCategories.length > 0,
      `Expected locator category metadata for ${record.typeName}`,
    );
  }
});

test("runtime station warp and undock paths honor client ship-class locator categories", () => {
  const jitaTradeHub = worldData.getStationByID(60003760);
  assert.ok(jitaTradeHub, "Expected Jita 4-4 station record");
  assert.ok(
    Array.isArray(jitaTradeHub.dunRotation) &&
      jitaTradeHub.dunRotation.length === 3,
    "Expected regenerated station rotation data",
  );

  const defaultGeometry = stationLocatorGeometry.buildStationDockingGeometry(
    jitaTradeHub,
    { selectionStrategy: "first" },
  );
  const largeGeometry = stationLocatorGeometry.buildStationDockingGeometry(
    jitaTradeHub,
    {
      shipTypeID: 638,
      selectionStrategy: "first",
    },
  );
  const titanGeometry = stationLocatorGeometry.buildStationDockingGeometry(
    jitaTradeHub,
    {
      shipTypeID: 11567,
      selectionStrategy: "first",
    },
  );

  assert.equal(defaultGeometry.source, "authored");
  assert.equal(defaultGeometry.locatorCategory, "undockPointSmall");
  assert.equal(largeGeometry.locatorCategory, "undockPointLarge");
  assert.equal(titanGeometry.locatorCategory, "undockPointSupercapital");

  assert.notDeepEqual(
    largeGeometry.dockPosition,
    titanGeometry.dockPosition,
    "Expected Jita large and supercapital locator positions to differ",
  );

  const runtimeLargeWarpTarget = spaceRuntime._testing.getStationWarpTargetPositionForTesting(
    jitaTradeHub,
    {
      shipTypeID: 638,
      selectionStrategy: "first",
      selectionKey: 920001,
    },
  );
  assertVectorAlmostEqual(
    runtimeLargeWarpTarget,
    largeGeometry.dockPosition,
    0.05,
    "runtimeLargeWarpTarget",
  );

  const runtimeTitanUndock = spaceRuntime._testing.getStationUndockSpawnStateForTesting(
    jitaTradeHub,
    {
      shipTypeID: 11567,
      selectionStrategy: "first",
      selectionKey: 920002,
    },
  );
  assert.equal(runtimeTitanUndock.source, "authored");
  assert.equal(runtimeTitanUndock.locatorCategory, "undockPointSupercapital");
  assertVectorAlmostEqual(
    runtimeTitanUndock.position,
    titanGeometry.undockPosition,
    0.05,
    "runtimeTitanUndock.position",
  );
  assertVectorAlmostEqual(
    runtimeTitanUndock.direction,
    titanGeometry.undockDirection,
    0.0001,
    "runtimeTitanUndock.direction",
  );
});
