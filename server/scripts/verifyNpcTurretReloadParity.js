const path = require("path");

const runtime = require(path.join(__dirname, "../src/space/runtime"));
const nativeNpcStore = require(path.join(__dirname, "../src/space/npc/nativeNpcStore"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../src/services/inventory/itemTypeRegistry"));
const {
  resolvePendingLocalModuleReload,
} = require(path.join(__dirname, "../src/space/modules/localCycleReloads"));

function toInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildEntity(entityID) {
  return {
    itemID: entityID,
    ownerID: 1,
    typeID: 24702,
    groupID: 419,
    categoryID: 6,
    kind: "ship",
    nativeNpc: true,
    transient: true,
    nativeCargoItems: [],
  };
}

function listEntityCargo(entityID) {
  return nativeNpcStore.listNativeCargoForEntity(entityID).map((entry) => ({
    cargoID: toInt(entry && entry.cargoID, 0),
    moduleID: toInt(entry && entry.moduleID, 0),
    typeID: toInt(entry && entry.typeID, 0),
    quantity: Math.max(0, toInt(entry && entry.quantity, 0)),
  }));
}

function seedLoadedCharge(entity, moduleID, chargeTypeID, quantity) {
  const cargoID = nativeNpcStore.allocateCargoID({ transient: true }).data;
  const chargeType = resolveItemByTypeID(chargeTypeID);
  const result = nativeNpcStore.upsertNativeCargo({
    cargoID,
    entityID: entity.itemID,
    ownerID: entity.ownerID,
    moduleID,
    typeID: chargeTypeID,
    groupID: toInt(chargeType && chargeType.groupID, 0),
    categoryID: toInt(chargeType && chargeType.categoryID, 0),
    itemName: String((chargeType && chargeType.name) || "Charge"),
    quantity,
    singleton: true,
    transient: true,
  }, {
    transient: true,
  });
  assert(result.success, "Failed to seed native NPC charge");
  entity.nativeCargoItems = nativeNpcStore.buildNativeCargoItems(entity.itemID);
}

function consumeSeededCharge(entity, moduleID) {
  for (const cargo of listEntityCargo(entity.itemID)) {
    if (cargo.moduleID === moduleID) {
      const removeResult = nativeNpcStore.removeNativeCargo(cargo.cargoID);
      assert(removeResult.success, "Failed to remove depleted native NPC charge");
    }
  }
  entity.nativeCargoItems = nativeNpcStore.buildNativeCargoItems(entity.itemID);
}

function main() {
  const entityID = nativeNpcStore.allocateEntityID({ transient: true }).data;
  const moduleID = nativeNpcStore.allocateModuleID({ transient: true }).data;
  const entity = buildEntity(entityID);
  const moduleItem = {
    itemID: moduleID,
    typeID: 13784,
    flagID: 27,
    groupID: 55,
    categoryID: 7,
    itemName: "Domination 720mm Howitzer Artillery",
  };
  const chargeTypeID = 20783;

  seedLoadedCharge(entity, moduleID, chargeTypeID, 1);
  const beforeDepleteCargo = listEntityCargo(entityID).filter((entry) => entry.moduleID === moduleID);
  assert(beforeDepleteCargo.length === 1, "Expected seeded loaded charge");
  assert(beforeDepleteCargo[0].quantity === 1, "Seeded charge should be singleton quantity 1");

  consumeSeededCharge(entity, moduleID);
  const afterDepleteCargo = listEntityCargo(entityID).filter((entry) => entry.moduleID === moduleID);
  assert(afterDepleteCargo.length === 0, "Depleted singleton charge should be removed");

  const scene = {
    sessions: new Map(),
  };
  const reloadState = runtime._testing.queueAutomaticNpcTurretReloadForTesting(
    scene,
    entity,
    moduleItem,
    chargeTypeID,
    5_000,
  );
  assert(reloadState, "Runtime turret reload helper should schedule native NPC reload");
  assert(reloadState.virtualReserve === true, "Native NPC turret reload should use virtual reserve when no loose stacks exist");

  const effectState = {
    pendingLocalReload: reloadState,
    chargeTypeID,
  };
  const resolveResult = resolvePendingLocalModuleReload(entity, effectState, moduleItem, {
    nowMs: Math.max(5_000, toInt(reloadState.completeAtMs, 0)),
  });
  assert(resolveResult.success, "Queued native NPC turret reload should resolve successfully");

  const reloadedCargo = listEntityCargo(entityID).filter((entry) => entry.moduleID === moduleID);
  assert(reloadedCargo.length === 1, "Resolved turret reload should restore a module-bound charge");
  assert(reloadedCargo[0].quantity > 0, "Resolved turret reload should restore positive ammo quantity");

  console.log(JSON.stringify({
    beforeDepleteQuantity: beforeDepleteCargo[0].quantity,
    queuedReloadState: {
      chargeTypeID: toInt(reloadState.chargeTypeID, 0),
      reloadTimeMs: toInt(reloadState.reloadTimeMs, 0),
      virtualReserve: reloadState.virtualReserve === true,
    },
    resolvedReloadQuantity: reloadedCargo[0].quantity,
  }, null, 2));
}

main();
