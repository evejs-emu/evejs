const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const repoRoot = path.join(__dirname, "..", "..");

const {
  buildWeaponModuleSnapshot,
} = require(path.join(repoRoot, "server/src/space/combat/weaponDogma"));
const {
  resolveTurretShot,
} = require(path.join(repoRoot, "server/src/space/combat/laserTurrets"));
const {
  resolveItemByTypeID,
} = require(path.join(repoRoot, "server/src/services/inventory/itemTypeRegistry"));

function buildInventoryItem(typeID, itemID, extras = {}) {
  const type = resolveItemByTypeID(typeID);
  assert.ok(type, `expected type ${typeID} to exist`);
  return {
    itemID,
    typeID,
    ownerID: 1,
    locationID: Number(extras.locationID || 0),
    flagID: Number(extras.flagID || 0),
    groupID: Number(type.groupID || 0),
    categoryID: Number(type.categoryID || 0),
    itemName: type.name,
    quantity: extras.quantity ?? 1,
    stacksize: extras.stacksize ?? extras.quantity ?? 1,
    singleton: Object.prototype.hasOwnProperty.call(extras, "singleton")
      ? extras.singleton
      : true,
    moduleState: extras.moduleState || {
      online: true,
      damage: 0,
      armorDamage: 0,
      shieldCharge: 0,
      incapacitated: false,
    },
    ...extras,
  };
}

function buildBenchmarkCase({
  shipTypeID,
  moduleTypeID,
  chargeTypeID,
  expectedFamily,
}) {
  const shipItem = buildInventoryItem(shipTypeID, 900000001, {
    categoryID: 6,
    locationID: 0,
  });
  const attackerEntity = {
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    radius: 50,
    signatureRadius: 120,
  };
  const targetEntity = {
    position: { x: 4_500, y: 0, z: 0 },
    velocity: { x: 0, y: 45, z: 0 },
    radius: 50,
    signatureRadius: 135,
  };

  const fittedModules = [];
  const loadedCharges = [];
  for (let index = 0; index < 50; index += 1) {
    const moduleID = 910000000 + index;
    fittedModules.push(buildInventoryItem(moduleTypeID, moduleID, {
      locationID: shipItem.itemID,
      flagID: 27 + index,
    }));
    loadedCharges.push(buildInventoryItem(chargeTypeID, 920000000 + index, {
      locationID: shipItem.itemID,
      moduleID,
      quantity: 1,
      stacksize: 1,
      singleton: false,
      flagID: 27 + index,
    }));
  }

  const warmSnapshot = buildWeaponModuleSnapshot({
    characterID: 0,
    shipItem,
    moduleItem: fittedModules[0],
    chargeItem: loadedCharges[0],
    fittedItems: fittedModules,
    skillMap: new Map(),
    activeModuleContexts: [],
  });
  assert.ok(warmSnapshot, "expected benchmark snapshot to build");
  assert.equal(warmSnapshot.family, expectedFamily);

  return {
    shipItem,
    attackerEntity,
    targetEntity,
    fittedModules,
    loadedCharges,
    expectedFamily,
  };
}

function benchmarkWeaponHotPath(benchmarkCase, iterations = 250) {
  const {
    shipItem,
    attackerEntity,
    targetEntity,
    fittedModules,
    loadedCharges,
  } = benchmarkCase;

  for (let warmup = 0; warmup < 20; warmup += 1) {
    for (let index = 0; index < fittedModules.length; index += 1) {
      const snapshot = buildWeaponModuleSnapshot({
        characterID: 0,
        shipItem,
        moduleItem: fittedModules[index],
        chargeItem: loadedCharges[index],
        fittedItems: fittedModules,
        skillMap: new Map(),
        activeModuleContexts: [],
      });
      resolveTurretShot({
        attackerEntity,
        targetEntity,
        weaponSnapshot: snapshot,
        randomValue: 0.5,
      });
    }
  }

  const startedAt = performance.now();
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (let index = 0; index < fittedModules.length; index += 1) {
      const snapshot = buildWeaponModuleSnapshot({
        characterID: 0,
        shipItem,
        moduleItem: fittedModules[index],
        chargeItem: loadedCharges[index],
        fittedItems: fittedModules,
        skillMap: new Map(),
        activeModuleContexts: [],
      });
      resolveTurretShot({
        attackerEntity,
        targetEntity,
        weaponSnapshot: snapshot,
        randomValue: 0.5,
      });
    }
  }
  const elapsedMs = performance.now() - startedAt;
  return elapsedMs / (iterations * fittedModules.length);
}

function median(values = []) {
  const sorted = [...values]
    .map((value) => Number(value) || 0)
    .sort((left, right) => left - right);
  if (sorted.length <= 0) {
    return 0;
  }
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function benchmarkWeaponHotPathMedian(benchmarkCase, iterations = 600, sampleCount = 3) {
  const samples = [];
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    samples.push(benchmarkWeaponHotPath(benchmarkCase, iterations));
  }
  return {
    medianMs: median(samples),
    samples,
  };
}

test("precursor turret hot path stays under 0.1ms average and near the existing turret baseline", () => {
  const hybridBaseline = buildBenchmarkCase({
    shipTypeID: 12005, // Ishtar
    moduleTypeID: 3186, // Neutron Blaster Cannon II
    chargeTypeID: 238, // Antimatter Charge L
    expectedFamily: "hybridTurret",
  });
  const precursorCase = buildBenchmarkCase({
    shipTypeID: 47269, // Damavik
    moduleTypeID: 47914, // Light Entropic Disintegrator II
    chargeTypeID: 47924, // Baryon Exotic Plasma S
    expectedFamily: "precursorTurret",
  });

  const hybridMeasurement = benchmarkWeaponHotPathMedian(hybridBaseline);
  const precursorMeasurement = benchmarkWeaponHotPathMedian(precursorCase);
  const hybridAverageMs = hybridMeasurement.medianMs;
  const precursorAverageMs = precursorMeasurement.medianMs;

  assert.ok(
    precursorAverageMs < 0.1,
    `expected precursor hot-path median < 0.1ms, got ${precursorAverageMs.toFixed(6)}ms from samples ${precursorMeasurement.samples.map((value) => value.toFixed(6)).join(", ")}`,
  );
  assert.ok(
    precursorAverageMs - hybridAverageMs < 0.02,
    `expected precursor hot-path delta < 0.02ms, got ${(precursorAverageMs - hybridAverageMs).toFixed(6)}ms (hybrid median ${hybridAverageMs.toFixed(6)}ms from ${hybridMeasurement.samples.map((value) => value.toFixed(6)).join(", ")}, precursor median ${precursorAverageMs.toFixed(6)}ms from ${precursorMeasurement.samples.map((value) => value.toFixed(6)).join(", ")})`,
  );
});
