const path = require("path");

const nativeNpcStore = require(path.join(__dirname, "../src/space/npc/nativeNpcStore"));
const {
  queueAutomaticMissileReload,
  resolvePendingMissileReload,
} = require(path.join(__dirname, "../src/space/combat/missiles/missileReloads"));
const {
  queueAutomaticLocalModuleReload,
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
    typeID: 23984,
    groupID: 0,
    categoryID: 6,
    kind: "ship",
    nativeNpc: true,
    transient: true,
    nativeCargoItems: [],
  };
}

function allocateTransientIDs() {
  return {
    entityID: nativeNpcStore.allocateEntityID({ transient: true }).data,
    missileModuleID: nativeNpcStore.allocateModuleID({ transient: true }).data,
    localModuleID: nativeNpcStore.allocateModuleID({ transient: true }).data,
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

function runMissileReloadCase() {
  const ids = allocateTransientIDs();
  const entity = buildEntity(ids.entityID);
  const moduleItem = {
    itemID: ids.missileModuleID,
    typeID: 13920,
    flagID: 27,
    groupID: 0,
    categoryID: 7,
    itemName: "Pithior Missile Launcher",
  };
  const chargeTypeID = 27365;
  const beforeLooseSourceCount = listEntityCargo(ids.entityID)
    .filter((entry) => entry.typeID === chargeTypeID && entry.moduleID <= 0 && entry.quantity > 0)
    .length;
  const queueResult = queueAutomaticMissileReload({
    entity,
    moduleItem,
    chargeTypeID,
    reloadTimeMs: 1000,
    startedAtMs: 2000,
    shipID: ids.entityID,
  });
  assert(queueResult.success, "Missile reload should queue for native NPC without loose reserve stacks");
  const effectState = {
    pendingMissileReload: queueResult.data.reloadState,
    chargeTypeID,
  };
  const completionResult = resolvePendingMissileReload(entity, effectState, moduleItem, {
    nowMs: 3000,
  });
  assert(completionResult.success, "Missile reload should complete for native NPC without loose reserve stacks");
  const afterCargo = listEntityCargo(ids.entityID).filter((entry) => entry.moduleID === ids.missileModuleID);
  assert(afterCargo.length === 1, "Missile reload should restore a loaded module-bound charge stack");
  assert(afterCargo[0].quantity > 0, "Missile reload should restore positive charge quantity");

  nativeNpcStore.removeNativeCargo(afterCargo[0].cargoID);
  entity.nativeCargoItems = nativeNpcStore.buildNativeCargoItems(ids.entityID);
  const secondQueueResult = queueAutomaticMissileReload({
    entity,
    moduleItem,
    chargeTypeID,
    reloadTimeMs: 500,
    startedAtMs: 4000,
    shipID: ids.entityID,
  });
  assert(secondQueueResult.success, "Missile reload should still queue after the previous loaded stack was removed");

  return {
    beforeLooseSourceCount,
    firstReloadVirtualReserve: queueResult.data.reloadState.virtualReserve === true,
    firstReloadQuantity: afterCargo[0].quantity,
    secondReloadVirtualReserve: secondQueueResult.data.reloadState.virtualReserve === true,
  };
}

function runLocalReloadCase() {
  const ids = allocateTransientIDs();
  const entity = buildEntity(ids.entityID);
  const moduleItem = {
    itemID: ids.localModuleID,
    typeID: 13867,
    flagID: 12,
    groupID: 0,
    categoryID: 7,
    itemName: "Pithior Railgun",
  };
  const chargeTypeID = 21398;
  const beforeLooseSourceCount = listEntityCargo(ids.entityID)
    .filter((entry) => entry.typeID === chargeTypeID && entry.moduleID <= 0 && entry.quantity > 0)
    .length;
  const queueResult = queueAutomaticLocalModuleReload({
    entity,
    moduleItem,
    chargeTypeID,
    reloadTimeMs: 1200,
    startedAtMs: 5000,
    shipID: ids.entityID,
    resumeMode: "start",
  });
  assert(queueResult.success, "Local-cycle reload should queue for native NPC without loose reserve stacks");
  const effectState = {
    pendingLocalReload: queueResult.data.reloadState,
    chargeTypeID,
  };
  const completionResult = resolvePendingLocalModuleReload(entity, effectState, moduleItem, {
    nowMs: 6200,
  });
  assert(completionResult.success, "Local-cycle reload should complete for native NPC without loose reserve stacks");
  const afterCargo = listEntityCargo(ids.entityID).filter((entry) => entry.moduleID === ids.localModuleID);
  assert(afterCargo.length === 1, "Local-cycle reload should restore a loaded module-bound charge stack");
  assert(afterCargo[0].quantity > 0, "Local-cycle reload should restore positive charge quantity");
  return {
    beforeLooseSourceCount,
    reloadVirtualReserve: queueResult.data.reloadState.virtualReserve === true,
    reloadQuantity: afterCargo[0].quantity,
  };
}

function main() {
  const missile = runMissileReloadCase();
  const local = runLocalReloadCase();
  console.log(JSON.stringify({
    missile,
    local,
  }, null, 2));
}

main();
