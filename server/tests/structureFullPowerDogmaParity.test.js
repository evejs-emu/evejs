const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

process.env.ELYSIAN_EVE_SKIP_NPC_STARTUP = "1";

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const {
  grantItemToCharacterLocation,
  resetInventoryStoreForTests,
} = require(path.join(repoRoot, "server/src/services/inventory/itemStore"));
const {
  getShipFittingSnapshot,
  resetFittingRuntimeForTests,
} = require(path.join(repoRoot, "server/src/_secondary/fitting/fittingRuntime"));
const structureState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureState",
));
const {
  STRUCTURE_STATE,
  STRUCTURE_UPKEEP_STATE,
} = require(path.join(
  repoRoot,
  "server/src/services/structure/structureConstants",
));
const {
  resolveStructureEffectiveHitpoints,
  resolveStructureFullPowerDogma,
} = require(path.join(
  repoRoot,
  "server/src/services/structure/structureFullPowerDogma",
));

const TEST_CHARACTER_ID = 140000002;
const TEST_STRUCTURE_ID = 103990080001;
const KEEPSTAR_TYPE_ID = 35834;
const MARKET_SERVICE_MODULE_TYPE_ID = 35892;
const SERVICE_SLOT_FLAG = 164;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function snapshotMutableTables() {
  return {
    identityState: cloneValue(database.read("identityState", "/").data || {}),
    items: cloneValue(database.read("items", "/").data || {}),
    structures: cloneValue(database.read("structures", "/").data || {}),
  };
}

function restoreMutableTables(snapshot) {
  database.write("identityState", "/", cloneValue(snapshot.identityState));
  database.write("items", "/", cloneValue(snapshot.items));
  database.write("structures", "/", cloneValue(snapshot.structures));
  database.flushAllSync();
  resetInventoryStoreForTests();
  resetFittingRuntimeForTests();
  structureState.clearStructureCaches();
}

function upsertTestKeepstar() {
  const result = structureState.upsertStructureRecord({
    structureID: TEST_STRUCTURE_ID,
    typeID: KEEPSTAR_TYPE_ID,
    ownerCorpID: 98000002,
    ownerID: 98000002,
    itemName: "Full Power Test Keepstar",
    solarSystemID: 30000142,
    position: { x: 1_000_000, y: 0, z: 1_000_000 },
    state: STRUCTURE_STATE.SHIELD_VULNERABLE,
    upkeepState: STRUCTURE_UPKEEP_STATE.LOW_POWER,
    hasQuantumCore: true,
    conditionState: {
      damage: 0,
      armorDamage: 0,
      shieldCharge: 1,
      charge: 1,
      incapacitated: false,
    },
  });
  assert.equal(result.success, true, result.errorMsg);
  return result.data;
}

function fitOnlineMarketService() {
  const result = grantItemToCharacterLocation(
    TEST_CHARACTER_ID,
    TEST_STRUCTURE_ID,
    SERVICE_SLOT_FLAG,
    MARKET_SERVICE_MODULE_TYPE_ID,
    1,
    {
      singleton: 1,
      moduleState: {
        online: true,
        damage: 0,
        charge: 0,
        armorDamage: 0,
        shieldCharge: 0,
        incapacitated: false,
      },
    },
  );
  assert.equal(result.success, true, result.errorMsg);
  assert.equal(result.data.items.length, 1);
  return result.data.items[0];
}

test("online service modules apply TQ Full Power shield and armor dogma to structures", () => {
  const snapshot = snapshotMutableTables();
  try {
    const structure = upsertTestKeepstar();

    const lowPowerHitpoints = resolveStructureEffectiveHitpoints(structure);
    assert.equal(lowPowerHitpoints.shieldCapacity, 33_750_000);
    assert.equal(lowPowerHitpoints.armorHP, 27_000_000);
    assert.equal(lowPowerHitpoints.structureHP, 108_000_000);
    assert.equal(lowPowerHitpoints.fullPowerDogma.isFullPower, false);
    assert.equal(lowPowerHitpoints.effectiveShieldCapacity, 33_750_000);
    assert.equal(lowPowerHitpoints.effectiveArmorHP, 27_000_000);

    fitOnlineMarketService();

    const dogma = resolveStructureFullPowerDogma(structure);
    assert.equal(dogma.isFullPower, true);
    assert.equal(dogma.onlineServiceModuleCount, 1);
    assert.equal(dogma.hitpointMultiplier, 4);

    const fullPowerHitpoints = resolveStructureEffectiveHitpoints(structure);
    assert.equal(fullPowerHitpoints.effectiveShieldCapacity, 135_000_000);
    assert.equal(fullPowerHitpoints.effectiveArmorHP, 108_000_000);
    assert.equal(fullPowerHitpoints.effectiveStructureHP, 108_000_000);
  } finally {
    restoreMutableTables(snapshot);
  }
});

test("admin/runtime structure damage consumes the effective Full Power HP envelope", () => {
  const snapshot = snapshotMutableTables();
  try {
    const structure = upsertTestKeepstar();
    fitOnlineMarketService();

    const baseShieldDamage = structure.shieldCapacity;
    const damageResult = structureState.applyAdminStructureDamage(
      TEST_STRUCTURE_ID,
      "shield",
      baseShieldDamage,
      { nowMs: 1_777_000_000_000 },
    );

    assert.equal(damageResult.success, true, damageResult.errorMsg);
    assert.equal(damageResult.data.structure.state, STRUCTURE_STATE.SHIELD_VULNERABLE);
    assert.equal(damageResult.data.structure.conditionState.shieldCharge, 0.75);
  } finally {
    restoreMutableTables(snapshot);
  }
});

test("structure-control fitting snapshots expose the same effective Full Power HP", () => {
  const snapshot = snapshotMutableTables();
  try {
    const structure = upsertTestKeepstar();
    fitOnlineMarketService();

    const fittingSnapshot = getShipFittingSnapshot(
      TEST_CHARACTER_ID,
      TEST_STRUCTURE_ID,
      {
        forceRefresh: true,
        shipItem: {
          itemID: structure.structureID,
          typeID: structure.typeID,
          ownerID: structure.ownerCorpID,
          locationID: structure.structureID,
          groupID: 1657,
          categoryID: 65,
          shieldCapacity: structure.shieldCapacity,
          armorHP: structure.armorHP,
          hullHP: structure.hullHP,
        },
      },
    );

    assert.ok(fittingSnapshot);
    assert.equal(fittingSnapshot.shipAttributes[263], 135_000_000);
    assert.equal(fittingSnapshot.shipAttributes[265], 108_000_000);
    assert.equal(fittingSnapshot.shipAttributes[9], 108_000_000);
    assert.equal(fittingSnapshot.resourceState.shieldCapacity, 135_000_000);
    assert.equal(fittingSnapshot.resourceState.fullPowerDogma.hitpointMultiplier, 4);
  } finally {
    restoreMutableTables(snapshot);
  }
});
