const path = require("path");

const {
  getModuleChargeCapacity,
} = require(path.join(__dirname, "../../../services/fitting/liveFittingState"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../../../services/inventory/itemTypeRegistry"));
const nativeNpcStore = require(path.join(__dirname, "../../npc/nativeNpcStore"));
const {
  logNpcCombatDebug,
  summarizeNpcCombatCargo,
  summarizeNpcCombatEntity,
  summarizeNpcCombatModule,
} = require(path.join(__dirname, "../../npc/npcCombatDebug"));

function toInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function isNativeNpcEntity(entity) {
  return Boolean(
    entity &&
    entity.kind === "ship" &&
    entity.nativeNpc === true,
  );
}

function normalizeReloadState(reloadState, source) {
  if (!reloadState) {
    return null;
  }

  return {
    source,
    moduleID: toInt(reloadState.moduleID, 0),
    moduleFlagID: toInt(reloadState.moduleFlagID, 0),
    chargeTypeID: toInt(reloadState.chargeTypeID, 0),
    reloadTimeMs: Math.max(0, Number(reloadState.reloadTimeMs) || 0),
    completeAtMs: Math.max(0, Number(reloadState.completeAtMs) || 0),
    virtualReserve: reloadState.virtualReserve === true,
  };
}

function resolveNativeNpcReloadSources(entity, chargeTypeID) {
  const entityID = toInt(entity && entity.itemID, 0);
  if (entityID <= 0 || chargeTypeID <= 0) {
    return [];
  }

  return nativeNpcStore
    .listNativeCargoForEntity(entityID)
    .filter((cargoRecord) => toInt(cargoRecord && cargoRecord.typeID, 0) === chargeTypeID)
    .filter((cargoRecord) => toInt(cargoRecord && cargoRecord.moduleID, 0) <= 0)
    .filter((cargoRecord) => Math.max(0, Number(cargoRecord && cargoRecord.quantity) || 0) > 0)
    .sort((left, right) => toInt(left && left.cargoID, 0) - toInt(right && right.cargoID, 0));
}

function canUseVirtualNativeNpcReloadReserve(entity, moduleItem, chargeTypeID) {
  return Boolean(
    isNativeNpcEntity(entity) &&
    moduleItem &&
    toInt(moduleItem.itemID, 0) > 0 &&
    chargeTypeID > 0,
  );
}

function queuePlayerMissileReload(session, moduleItem, chargeTypeID, options = {}) {
  const DogmaService = require(path.join(__dirname, "../../../services/dogma/dogmaService"));
  const dogma = new DogmaService();
  return dogma.queueAutomaticModuleReload(session, moduleItem, {
    ...options,
    chargeTypeID,
  });
}

function queueNativeNpcMissileReload(entity, moduleItem, chargeTypeID, options = {}) {
  const sourceStacks = resolveNativeNpcReloadSources(entity, chargeTypeID);
  const usingVirtualReserve =
    sourceStacks.length === 0 &&
    canUseVirtualNativeNpcReloadReserve(entity, moduleItem, chargeTypeID);
  logNpcCombatDebug("npc.reload.queue.request", {
    reloadKind: "missile",
    entity: summarizeNpcCombatEntity(entity),
    moduleItem: summarizeNpcCombatModule(moduleItem),
    chargeTypeID,
    sourceStackCount: sourceStacks.length,
    sourceStacks: sourceStacks.map(summarizeNpcCombatCargo),
    usingVirtualReserve,
    reloadTimeMs: Math.max(0, Number(options.reloadTimeMs) || 0),
    startedAtMs: Math.max(0, Number(options.startedAtMs) || 0),
  });
  if (sourceStacks.length === 0 && !usingVirtualReserve) {
    logNpcCombatDebug("npc.reload.queue.failed", {
      reloadKind: "missile",
      reason: "NO_AMMO",
      entity: summarizeNpcCombatEntity(entity),
      moduleItem: summarizeNpcCombatModule(moduleItem),
      chargeTypeID,
    });
    return {
      success: false,
      errorMsg: "NO_AMMO",
    };
  }

  const reloadTimeMs = Math.max(0, Number(options.reloadTimeMs) || 0);
  if (reloadTimeMs <= 0) {
    return {
      success: false,
      errorMsg: "NO_RELOAD_TIME",
    };
  }

  const startedAtMs = Math.max(0, Number(options.startedAtMs) || 0);
  return {
    success: true,
    data: {
      reloadState: normalizeReloadState({
        moduleID: moduleItem && moduleItem.itemID,
        moduleFlagID: moduleItem && moduleItem.flagID,
        chargeTypeID,
        reloadTimeMs,
        completeAtMs: startedAtMs + reloadTimeMs,
        virtualReserve: usingVirtualReserve,
      }, "nativeNpc"),
    },
  };
}

function queueAutomaticMissileReload(options = {}) {
  const entity = options.entity || null;
  const moduleItem = options.moduleItem || null;
  const chargeTypeID = toInt(options.chargeTypeID, 0);
  if (!moduleItem || chargeTypeID <= 0) {
    return {
      success: false,
      errorMsg: "NO_AMMO",
    };
  }

  if (isNativeNpcEntity(entity)) {
    return queueNativeNpcMissileReload(entity, moduleItem, chargeTypeID, options);
  }

  return queuePlayerMissileReload(options.session || null, moduleItem, chargeTypeID, options);
}

function completeNativeNpcMissileReload(entity, moduleItem, reloadState) {
  if (!isNativeNpcEntity(entity) || !moduleItem || !reloadState) {
    return {
      success: false,
      errorMsg: "RELOAD_NOT_FOUND",
    };
  }

  const entityID = toInt(entity.itemID, 0);
  const moduleID = toInt(moduleItem.itemID, 0);
  const chargeTypeID = toInt(reloadState.chargeTypeID, 0);
  const capacity = Math.max(1, getModuleChargeCapacity(moduleItem.typeID, chargeTypeID));
  const existingLoaded = nativeNpcStore
    .listNativeCargoForEntity(entityID)
    .find((cargoRecord) => toInt(cargoRecord && cargoRecord.moduleID, 0) === moduleID)
    || null;
  const sourceStacks = resolveNativeNpcReloadSources(entity, chargeTypeID);
  const usingVirtualReserve =
    sourceStacks.length === 0 &&
    reloadState &&
    reloadState.virtualReserve === true &&
    canUseVirtualNativeNpcReloadReserve(entity, moduleItem, chargeTypeID);
  if (sourceStacks.length === 0 && !usingVirtualReserve) {
    logNpcCombatDebug("npc.reload.complete.failed", {
      reloadKind: "missile",
      reason: "NO_AMMO",
      entity: summarizeNpcCombatEntity(entity),
      moduleItem: summarizeNpcCombatModule(moduleItem),
      chargeTypeID,
      reloadState,
      existingLoaded: summarizeNpcCombatCargo(existingLoaded),
    });
    return {
      success: false,
      errorMsg: "NO_AMMO",
    };
  }

  let movedQuantity = existingLoaded
    ? Math.max(0, Number(existingLoaded.quantity) || 0)
    : 0;
  const desiredQuantity = Math.max(1, capacity);
  const transient = entity.transient === true;

  if (usingVirtualReserve) {
    movedQuantity = Math.max(movedQuantity, desiredQuantity);
  } else {
    for (const sourceStack of sourceStacks) {
      if (movedQuantity >= desiredQuantity) {
        break;
      }

      const availableQuantity = Math.max(0, Number(sourceStack && sourceStack.quantity) || 0);
      if (availableQuantity <= 0) {
        continue;
      }

      const takeQuantity = Math.min(availableQuantity, desiredQuantity - movedQuantity);
      movedQuantity += takeQuantity;
      if (takeQuantity >= availableQuantity) {
        const removeResult = nativeNpcStore.removeNativeCargo(sourceStack.cargoID);
        if (!removeResult.success) {
          return removeResult;
        }
      } else {
        const updateResult = nativeNpcStore.upsertNativeCargo({
          ...sourceStack,
          quantity: availableQuantity - takeQuantity,
        }, {
          transient,
        });
        if (!updateResult.success) {
          return updateResult;
        }
      }
    }
  }

  if (movedQuantity <= 0) {
    return {
      success: false,
      errorMsg: "NO_AMMO",
    };
  }

  const cargoID = existingLoaded
    ? toInt(existingLoaded.cargoID, 0)
    : (
      nativeNpcStore.allocateCargoID({ transient }).data || 0
    );
  if (cargoID <= 0) {
    return {
      success: false,
      errorMsg: "NPC_NATIVE_CARGO_ID_REQUIRED",
    };
  }

  const chargeType = resolveItemByTypeID(chargeTypeID);
  const sourceTemplate = existingLoaded || sourceStacks[0] || {
    entityID,
    ownerID: toInt(entity.ownerID, 0),
    moduleID,
    typeID: chargeTypeID,
    groupID: toInt(chargeType && chargeType.groupID, 0),
    categoryID: toInt(chargeType && chargeType.categoryID, 0),
    itemName: String(chargeType && chargeType.name || "Charge"),
    singleton: false,
  };
  const writeResult = nativeNpcStore.upsertNativeCargo({
    ...sourceTemplate,
    cargoID,
    entityID,
    ownerID: toInt(sourceTemplate && sourceTemplate.ownerID, toInt(entity.ownerID, 0)),
    moduleID,
    typeID: chargeTypeID,
    quantity: movedQuantity,
  }, {
    transient,
  });
  if (!writeResult.success) {
    return writeResult;
  }

  entity.nativeCargoItems = nativeNpcStore.buildNativeCargoItems(entityID);
  logNpcCombatDebug("npc.reload.complete", {
    reloadKind: "missile",
    entity: summarizeNpcCombatEntity(entity),
    moduleItem: summarizeNpcCombatModule(moduleItem),
    chargeTypeID,
    capacity,
    usingVirtualReserve,
    sourceStackCount: sourceStacks.length,
    sourceStacks: sourceStacks.map(summarizeNpcCombatCargo),
    existingLoaded: summarizeNpcCombatCargo(existingLoaded),
    resultingQuantity: movedQuantity,
  });
  return {
    success: true,
    data: {
      quantity: movedQuantity,
    },
  };
}

function flushDogmaReloadsAtSimTime(nowMs) {
  const DogmaService = require(path.join(__dirname, "../../../services/dogma/dogmaService"));
  return DogmaService.flushPendingModuleReloads(nowMs);
}

function resolvePendingMissileReload(entity, effectState, moduleItem, options = {}) {
  const reloadState =
    effectState && effectState.pendingMissileReload
      ? effectState.pendingMissileReload
      : null;
  if (!reloadState) {
    return {
      success: true,
      waiting: false,
      data: {
        completed: false,
      },
    };
  }

  const nowMs = Math.max(0, Number(options.nowMs) || 0);
  const completeAtMs = Math.max(0, Number(reloadState.completeAtMs) || 0);
  if (completeAtMs > nowMs) {
    logNpcCombatDebug("npc.reload.waiting", {
      reloadKind: "missile",
      entity: summarizeNpcCombatEntity(entity),
      moduleItem: summarizeNpcCombatModule(moduleItem),
      reloadState,
      nowMs,
    });
    return {
      success: true,
      waiting: true,
      data: {
        reloadState,
      },
    };
  }

  if (reloadState.source === "nativeNpc") {
    const completionResult = completeNativeNpcMissileReload(entity, moduleItem, reloadState);
    if (!completionResult.success) {
      logNpcCombatDebug("npc.reload.resolve.failed", {
        reloadKind: "missile",
        entity: summarizeNpcCombatEntity(entity),
        moduleItem: summarizeNpcCombatModule(moduleItem),
        reloadState,
        nowMs,
        errorMsg: completionResult.errorMsg || "NO_AMMO",
      });
      return completionResult;
    }
  }

  effectState.pendingMissileReload = null;
  effectState.chargeTypeID = toInt(reloadState.chargeTypeID, effectState.chargeTypeID);
  logNpcCombatDebug("npc.reload.resolve.completed", {
    reloadKind: "missile",
    entity: summarizeNpcCombatEntity(entity),
    moduleItem: summarizeNpcCombatModule(moduleItem),
    reloadState,
    nowMs,
  });
  return {
    success: true,
    waiting: false,
    data: {
      completed: true,
      reloadState,
    },
  };
}

module.exports = {
  flushDogmaReloadsAtSimTime,
  queueAutomaticMissileReload,
  resolvePendingMissileReload,
};
