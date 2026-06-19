const path = require("path");

const {
  getAttributeIDByNames,
  buildEffectiveItemAttributeMap,
} = require(path.join(__dirname, "../../services/fitting/liveFittingState"));
const {
  getCharacterSkillMap,
} = require(path.join(__dirname, "../../services/skills/skillState"));
const {
  updateInventoryItem,
  removeInventoryItem,
  normalizeShipConditionState,
} = require(path.join(__dirname, "../../services/inventory/itemStore"));
const {
  getEntityMaxHealthLayers,
} = require(path.join(__dirname, "../combat/damage"));
const {
  isNativeNpcEntity,
} = require(path.join(__dirname, "../npc/npcEquipment"));
const nativeNpcStore = require(path.join(__dirname, "../npc/nativeNpcStore"));
const {
  queueAutomaticLocalModuleReload,
  resolvePendingLocalModuleReload,
} = require("./localCycleReloads");
const {
  buildLiveModuleAttributeMap,
} = require("./liveModuleAttributes");

const ATTRIBUTE_CAPACITOR_NEED = getAttributeIDByNames("capacitorNeed") || 6;
const ATTRIBUTE_CAPACITOR_BONUS = getAttributeIDByNames("capacitorBonus") || 67;
const ATTRIBUTE_SHIELD_BONUS = getAttributeIDByNames("shieldBonus") || 68;
const ATTRIBUTE_DURATION = getAttributeIDByNames("duration") || 73;
const ATTRIBUTE_SPEED = getAttributeIDByNames("speed") || 51;
const ATTRIBUTE_ARMOR_DAMAGE_AMOUNT = getAttributeIDByNames("armorDamageAmount") || 84;
const ATTRIBUTE_STRUCTURE_DAMAGE_AMOUNT =
  getAttributeIDByNames("structureDamageAmount") || 83;
const ATTRIBUTE_CHARGED_ARMOR_DAMAGE_MULTIPLIER =
  getAttributeIDByNames("chargedArmorDamageMultiplier") || 1886;
const ATTRIBUTE_RELOAD_TIME = getAttributeIDByNames("reloadTime") || 1795;
const ATTRIBUTE_CHARGE_SIZE = getAttributeIDByNames("chargeSize") || 128;

const LOCAL_CYCLE_EFFECTS = new Set([
  "armorRepair",
  "shieldBoosting",
  "powerBooster",
  "structureRepair",
  "fueledShieldBoosting",
  "fueledArmorRepair",
]);

const START_OF_CYCLE_EFFECTS = new Set([
  "shieldBoosting",
  "powerBooster",
  "fueledShieldBoosting",
]);

function toInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function roundNumber(value, digits = 6) {
  return Number(toFiniteNumber(value, 0).toFixed(digits));
}

function getChargeItemQuantity(chargeItem) {
  return Math.max(
    0,
    toInt(chargeItem && (chargeItem.stacksize ?? chargeItem.quantity), 0),
  );
}

function normalizeEffectName(effectRecordOrName) {
  if (!effectRecordOrName) {
    return "";
  }

  const rawName =
    typeof effectRecordOrName === "string"
      ? effectRecordOrName
      : effectRecordOrName.name || effectRecordOrName.guid || "";
  return String(rawName).trim().replace(/^effects\./i, "");
}

function getApplicationTiming(effectName) {
  return START_OF_CYCLE_EFFECTS.has(effectName) ? "start" : "end";
}

function resolveLocalCycleState(options = {}) {
  const {
    entity,
    shipItem,
    moduleItem,
    effectRecord,
    effectName,
    effectState,
    chargeItem,
    callbacks = {},
    fallbackChargeTypeID = 0,
  } = options;
  const normalizedEffectName = normalizeEffectName(
    effectRecord ||
      effectName ||
      (effectState && effectState.localCycleFamily) ||
      (effectState && effectState.effectName),
  );
  if (!LOCAL_CYCLE_EFFECTS.has(normalizedEffectName)) {
    return null;
  }

  const resolveCharacterID =
    callbacks.resolveCharacterID ||
    ((candidate) => toInt(candidate && candidate.characterID, 0));
  const characterID = resolveCharacterID(entity);
  const skillMap = characterID > 0 ? getCharacterSkillMap(characterID) : new Map();
  const fittedItems =
    callbacks.getEntityRuntimeFittedItems &&
    typeof callbacks.getEntityRuntimeFittedItems === "function"
      ? callbacks.getEntityRuntimeFittedItems(entity)
      : [];
  const activeModuleContexts =
    callbacks.getEntityRuntimeActiveModuleContexts &&
    typeof callbacks.getEntityRuntimeActiveModuleContexts === "function"
      ? callbacks.getEntityRuntimeActiveModuleContexts(entity, {
        excludeModuleID: toInt(moduleItem && moduleItem.itemID, 0),
      })
      : [];
  const moduleAttributes = buildLiveModuleAttributeMap(
    shipItem,
    moduleItem,
    chargeItem,
    skillMap,
    fittedItems,
    activeModuleContexts,
  );
  if (!moduleAttributes) {
    return null;
  }

  const durationMs = Math.max(
    1,
    toFiniteNumber(
      moduleAttributes[ATTRIBUTE_DURATION],
      moduleAttributes[ATTRIBUTE_SPEED],
    ),
  );
  const durationAttributeID =
    Number.isFinite(Number(moduleAttributes[ATTRIBUTE_DURATION])) &&
      Number(moduleAttributes[ATTRIBUTE_DURATION]) > 0
      ? ATTRIBUTE_DURATION
      : ATTRIBUTE_SPEED;
  const capNeed = Math.max(0, toFiniteNumber(moduleAttributes[ATTRIBUTE_CAPACITOR_NEED], 0));
  const reloadTimeMs = Math.max(0, toFiniteNumber(moduleAttributes[ATTRIBUTE_RELOAD_TIME], 0));
  const loadedChargeQuantity = getChargeItemQuantity(chargeItem);
  const chargeTypeID = toInt(
    (chargeItem && chargeItem.typeID) || fallbackChargeTypeID,
    0,
  );

  const resolvedState = {
    effectName: normalizedEffectName,
    applicationTiming: getApplicationTiming(normalizedEffectName),
    durationMs: roundNumber(durationMs, 3),
    durationAttributeID,
    capNeed: roundNumber(capNeed, 6),
    reloadTimeMs: roundNumber(reloadTimeMs, 3),
    chargeItem: chargeItem || null,
    chargeTypeID,
    chargeQuantity: loadedChargeQuantity,
    chargeUnitsPerCycle: 0,
    chargeRequired: false,
    canContinueUnloaded: true,
    armorRepairAmount: 0,
    shieldBoostAmount: 0,
    structureRepairAmount: 0,
    capacitorBonus: 0,
  };

  if (normalizedEffectName === "armorRepair") {
    resolvedState.armorRepairAmount = Math.max(
      0,
      toFiniteNumber(moduleAttributes[ATTRIBUTE_ARMOR_DAMAGE_AMOUNT], 0),
    );
    return resolvedState;
  }

  if (normalizedEffectName === "shieldBoosting") {
    resolvedState.shieldBoostAmount = Math.max(
      0,
      toFiniteNumber(moduleAttributes[ATTRIBUTE_SHIELD_BONUS], 0),
    );
    return resolvedState;
  }

  if (normalizedEffectName === "structureRepair") {
    resolvedState.structureRepairAmount = Math.max(
      0,
      toFiniteNumber(moduleAttributes[ATTRIBUTE_STRUCTURE_DAMAGE_AMOUNT], 0),
    );
    return resolvedState;
  }

  if (normalizedEffectName === "powerBooster") {
    const chargeAttributes = chargeItem ? buildEffectiveItemAttributeMap(chargeItem) : {};
    resolvedState.chargeRequired = true;
    resolvedState.canContinueUnloaded = false;
    resolvedState.chargeUnitsPerCycle = chargeItem ? 1 : 0;
    resolvedState.capacitorBonus = Math.max(
      0,
      toFiniteNumber(chargeAttributes[ATTRIBUTE_CAPACITOR_BONUS], 0),
    );
    return resolvedState;
  }

  if (normalizedEffectName === "fueledShieldBoosting") {
    resolvedState.shieldBoostAmount = Math.max(
      0,
      toFiniteNumber(moduleAttributes[ATTRIBUTE_SHIELD_BONUS], 0),
    );
    resolvedState.chargeUnitsPerCycle = chargeItem ? 1 : 0;
    return resolvedState;
  }

  if (normalizedEffectName === "fueledArmorRepair") {
    const baseArmorAmount = Math.max(
      0,
      toFiniteNumber(moduleAttributes[ATTRIBUTE_ARMOR_DAMAGE_AMOUNT], 0),
    );
    const chargedMultiplier = Math.max(
      1,
      toFiniteNumber(moduleAttributes[ATTRIBUTE_CHARGED_ARMOR_DAMAGE_MULTIPLIER], 1),
    );
    const chargeUnitsPerCycle = Math.max(
      1,
      toInt(moduleAttributes[ATTRIBUTE_CHARGE_SIZE], 1),
    );
    const chargedCycle = loadedChargeQuantity > 0;
    resolvedState.chargeUnitsPerCycle = chargedCycle ? chargeUnitsPerCycle : 0;
    resolvedState.armorRepairAmount = chargedCycle
      ? roundNumber(baseArmorAmount * chargedMultiplier, 6)
      : roundNumber(baseArmorAmount, 6);
    return resolvedState;
  }

  return null;
}

function captureChargeState(chargeItem) {
  if (!chargeItem) {
    return null;
  }

  return {
    typeID: toInt(chargeItem.typeID, 0),
    quantity: getChargeItemQuantity(chargeItem),
  };
}

function consumeLoadedChargeQuantity(entity, moduleItem, chargeItem, quantity, options = {}) {
  if (!entity || !moduleItem || !chargeItem) {
    return {
      success: false,
      errorMsg: "NO_AMMO",
      stopReason: "ammo",
    };
  }

  const requestedQuantity = Math.max(1, toInt(quantity, 1));
  const previousQuantity = getChargeItemQuantity(chargeItem);
  if (previousQuantity <= 0) {
    return {
      success: false,
      errorMsg: "NO_AMMO",
      stopReason: "ammo",
    };
  }

  const consumedQuantity = Math.min(previousQuantity, requestedQuantity);
  const nextQuantity = Math.max(0, previousQuantity - consumedQuantity);
  let updatedChargeItem = null;

  if (isNativeNpcEntity(entity)) {
    const entityID = toInt(entity.itemID, 0);
    const chargeItemID = toInt(chargeItem.itemID, 0);
    const moduleID = toInt(moduleItem.itemID, 0);
    const cargoRecord = nativeNpcStore
      .listNativeCargoForEntity(entityID)
      .find((entry) => (
        toInt(entry && entry.cargoID, 0) === chargeItemID ||
        (
          chargeItemID <= 0 &&
          moduleID > 0 &&
          toInt(entry && entry.moduleID, 0) === moduleID
        )
      )) || null;

    if (cargoRecord) {
      const persistResult = nextQuantity > 0
        ? nativeNpcStore.upsertNativeCargo({
          ...cargoRecord,
          quantity: nextQuantity,
        }, {
          transient: cargoRecord.transient === true,
        })
        : nativeNpcStore.removeNativeCargo(cargoRecord.cargoID);
      if (!persistResult.success) {
        return {
          success: false,
          errorMsg: persistResult.errorMsg || "AMMO_UPDATE_FAILED",
          stopReason: "ammo",
        };
      }
    }

    if (Array.isArray(entity.nativeCargoItems)) {
      entity.nativeCargoItems = entity.nativeCargoItems.flatMap((cargoItem) => {
        const matchesCharge = (
          toInt(cargoItem && cargoItem.itemID, 0) === chargeItemID ||
          (
            chargeItemID <= 0 &&
            moduleID > 0 &&
            toInt(cargoItem && cargoItem.moduleID, 0) === moduleID
          )
        );
        if (!matchesCharge) {
          return [cargoItem];
        }
        if (nextQuantity <= 0) {
          return [];
        }
        return [{
          ...cargoItem,
          quantity: nextQuantity,
          stacksize: nextQuantity,
        }];
      });
    }

    updatedChargeItem = nextQuantity > 0
      ? (
        options.callbacks &&
        typeof options.callbacks.getEntityRuntimeLoadedCharge === "function"
          ? options.callbacks.getEntityRuntimeLoadedCharge(entity, moduleItem)
          : null
      ) || {
        ...chargeItem,
        quantity: nextQuantity,
        stacksize: nextQuantity,
      }
      : null;
  } else {
    const chargeItemID = toInt(chargeItem.itemID, 0);
    if (chargeItemID <= 0) {
      return {
        success: false,
        errorMsg: "AMMO_NOT_FOUND",
        stopReason: "ammo",
      };
    }

    const persistResult = nextQuantity > 0
      ? updateInventoryItem(chargeItemID, (currentItem) => ({
        ...currentItem,
        quantity: nextQuantity,
        stacksize: nextQuantity,
      }))
      : removeInventoryItem(chargeItemID);
    if (!persistResult.success) {
      return {
        success: false,
        errorMsg: persistResult.errorMsg || "AMMO_UPDATE_FAILED",
        stopReason: "ammo",
      };
    }

    updatedChargeItem =
      nextQuantity > 0 &&
      options.callbacks &&
      typeof options.callbacks.getEntityRuntimeLoadedCharge === "function"
        ? options.callbacks.getEntityRuntimeLoadedCharge(entity, moduleItem)
        : null;
  }

  const ownerSession = options.session || entity.session || null;
  if (
    ownerSession &&
    options.callbacks &&
    typeof options.callbacks.notifyRuntimeChargeTransitionToSession === "function"
  ) {
    options.callbacks.notifyRuntimeChargeTransitionToSession(
      ownerSession,
      toInt(entity.itemID, 0),
      toInt(moduleItem.flagID, 0),
      captureChargeState(chargeItem),
      captureChargeState(updatedChargeItem),
      toInt(entity.ownerID, 0),
    );
  }

  return {
    success: true,
    data: {
      updatedChargeItem,
      consumedQuantity,
      depleted: nextQuantity <= 0,
      nextQuantity,
    },
  };
}

function applyLocalShieldBoost(entity, amount) {
  const normalizedAmount = Math.max(0, toFiniteNumber(amount, 0));
  if (!entity || normalizedAmount <= 0) {
    return false;
  }

  const previousState = normalizeShipConditionState(entity.conditionState);
  const maxLayers = getEntityMaxHealthLayers(entity);
  if (maxLayers.shield <= 0) {
    return false;
  }

  const currentShield = maxLayers.shield * toFiniteNumber(previousState.shieldCharge, 0);
  const nextShield = Math.min(maxLayers.shield, currentShield + normalizedAmount);
  const nextState = normalizeShipConditionState({
    ...previousState,
    shieldCharge: nextShield / maxLayers.shield,
  });
  entity.conditionState = nextState;
  return true;
}

function applyLocalArmorRepair(entity, amount) {
  const normalizedAmount = Math.max(0, toFiniteNumber(amount, 0));
  if (!entity || normalizedAmount <= 0) {
    return false;
  }

  const previousState = normalizeShipConditionState(entity.conditionState);
  const maxLayers = getEntityMaxHealthLayers(entity);
  if (maxLayers.armor <= 0) {
    return false;
  }

  const currentArmor = maxLayers.armor * (
    1 - toFiniteNumber(previousState.armorDamage, 0)
  );
  const nextArmor = Math.min(maxLayers.armor, currentArmor + normalizedAmount);
  const nextState = normalizeShipConditionState({
    ...previousState,
    armorDamage: 1 - (nextArmor / maxLayers.armor),
  });
  entity.conditionState = nextState;
  return true;
}

function applyLocalStructureRepair(entity, amount) {
  const normalizedAmount = Math.max(0, toFiniteNumber(amount, 0));
  if (!entity || normalizedAmount <= 0) {
    return false;
  }

  const previousState = normalizeShipConditionState(entity.conditionState);
  const maxLayers = getEntityMaxHealthLayers(entity);
  if (maxLayers.structure <= 0) {
    return false;
  }

  const currentStructure = maxLayers.structure * (
    1 - toFiniteNumber(previousState.damage, 0)
  );
  const nextStructure = Math.min(maxLayers.structure, currentStructure + normalizedAmount);
  const nextState = normalizeShipConditionState({
    ...previousState,
    damage: 1 - (nextStructure / maxLayers.structure),
  });
  entity.conditionState = nextState;
  return true;
}

function commitLocalHealthChange(entity, scene, ownerSession, previousConditionState, callbacks, nowMs) {
  if (!entity || !scene || !callbacks) {
    return;
  }

  const healthTransitionResult = callbacks.buildShipHealthTransitionResult(
    entity,
    previousConditionState,
  );
  callbacks.persistDynamicEntity(entity);
  if (ownerSession) {
    callbacks.notifyShipHealthAttributesToSession(
      ownerSession,
      entity,
      healthTransitionResult,
      nowMs,
    );
  }
  callbacks.broadcastDamageStateChange(scene, entity, nowMs);
}

function commitLocalCapacitorChange(entity, ownerSession, callbacks, previousChargeAmount, nowMs) {
  if (
    !entity ||
    !ownerSession ||
    !callbacks ||
    typeof callbacks.notifyCapacitorChangeToSession !== "function"
  ) {
    return;
  }

  callbacks.persistDynamicEntity(entity);
  callbacks.notifyCapacitorChangeToSession(
    ownerSession,
    entity,
    nowMs,
    previousChargeAmount,
  );
}

function scheduleLocalReload(options = {}) {
  const {
    entity,
    scene,
    session,
    moduleItem,
    cycleState,
    effectMomentMs,
  } = options;
  if (!cycleState || cycleState.reloadTimeMs <= 0 || cycleState.chargeTypeID <= 0) {
    return null;
  }

  const waitTimeMs = cycleState.applicationTiming === "start"
    ? cycleState.durationMs + cycleState.reloadTimeMs
    : cycleState.reloadTimeMs;
  const queueResult = queueAutomaticLocalModuleReload({
    entity,
    session,
    moduleItem,
    chargeTypeID: cycleState.chargeTypeID,
    reloadTimeMs: waitTimeMs,
    startedAtMs: effectMomentMs,
    shipID: toInt(entity && entity.itemID, 0),
    ammoLocationID: toInt(entity && entity.itemID, 0),
    resumeMode: cycleState.applicationTiming,
  });
  if (!queueResult.success) {
    return null;
  }

  return queueResult.data && queueResult.data.reloadState
    ? queueResult.data.reloadState
    : null;
}

function buildRuntimeOverrides(cycleState, baseRuntimeAttributes = null) {
  return {
    capNeed: cycleState ? cycleState.capNeed : 0,
    durationMs: cycleState ? cycleState.durationMs : 0,
    durationAttributeID: cycleState ? cycleState.durationAttributeID : ATTRIBUTE_DURATION,
    reactivationDelayMs:
      baseRuntimeAttributes && Number.isFinite(Number(baseRuntimeAttributes.reactivationDelayMs))
        ? Number(baseRuntimeAttributes.reactivationDelayMs)
        : 0,
    maxGroupActive:
      baseRuntimeAttributes && Number.isFinite(Number(baseRuntimeAttributes.maxGroupActive))
        ? Number(baseRuntimeAttributes.maxGroupActive)
        : 0,
  };
}

function prepareLocalCycleActivation(options = {}) {
  const cycleState = resolveLocalCycleState(options);
  if (!cycleState) {
    return {
      matched: false,
    };
  }

  if (cycleState.chargeRequired && !cycleState.chargeItem) {
    return {
      matched: true,
      success: false,
      errorMsg: "NO_AMMO",
    };
  }

  return {
    matched: true,
    success: true,
    cycleState,
    runtimeAttributes: buildRuntimeOverrides(cycleState, options.baseRuntimeAttributes),
    effectStatePatch: {
      localCycleEffect: true,
      localCycleTiming: cycleState.applicationTiming,
      localCycleFamily: cycleState.effectName,
      localCycleResolvedState: cycleState,
    },
  };
}

function prepareLocalCycleBoundary(options = {}) {
  const {
    entity,
    moduleItem,
    effectState,
    callbacks = {},
    nowMs = 0,
  } = options;
  if (!effectState || effectState.localCycleEffect !== true) {
    return {
      matched: false,
    };
  }

  if (effectState.pendingLocalStopReason) {
    return {
      matched: true,
      success: false,
      stopReason: effectState.pendingLocalStopReason,
    };
  }

  if (effectState.pendingLocalReload) {
    const reloadResult = resolvePendingLocalModuleReload(
      entity,
      effectState,
      moduleItem,
      {
        nowMs,
      },
    );
    if (!reloadResult.success) {
      return {
        matched: true,
        success: false,
        stopReason: "ammo",
      };
    }
    if (reloadResult.waiting) {
      return {
        matched: true,
        success: true,
        waiting: true,
      };
    }
    if (
      reloadResult.data &&
      reloadResult.data.reloadState &&
      reloadResult.data.reloadState.resumeMode === "end"
    ) {
      effectState.localCycleResumeEndCycle = true;
    }
  }

  const shipItem =
    callbacks.getEntityRuntimeShipItem &&
    typeof callbacks.getEntityRuntimeShipItem === "function"
      ? callbacks.getEntityRuntimeShipItem(entity)
      : null;
  const chargeItem =
    callbacks.getEntityRuntimeLoadedCharge &&
    typeof callbacks.getEntityRuntimeLoadedCharge === "function"
      ? callbacks.getEntityRuntimeLoadedCharge(entity, moduleItem)
      : null;
  const cycleState = resolveLocalCycleState({
    ...options,
    shipItem,
    chargeItem,
    fallbackChargeTypeID: toInt(effectState.chargeTypeID, 0),
  });
  if (!cycleState) {
    return {
      matched: true,
      success: false,
      stopReason: "localCycle",
    };
  }

  if (cycleState.chargeRequired && !cycleState.chargeItem) {
    return {
      matched: true,
      success: false,
      stopReason: "ammo",
    };
  }

  effectState.localCycleResolvedState = cycleState;
  effectState.capNeed = cycleState.capNeed;
  effectState.durationMs = cycleState.durationMs;
  effectState.durationAttributeID = cycleState.durationAttributeID;
  effectState.localCycleTiming = cycleState.applicationTiming;
  effectState.localCycleFamily = cycleState.effectName;
  return {
    matched: true,
    success: true,
    cycleState,
  };
}

function executeLocalCycle(options = {}) {
  const {
    scene,
    session,
    entity,
    moduleItem,
    effectState,
    nowMs = 0,
    activation = false,
    callbacks = {},
  } = options;
  if (!effectState || effectState.localCycleEffect !== true) {
    return {
      matched: false,
    };
  }

  if (effectState.localCycleResumeEndCycle === true) {
    effectState.localCycleResumeEndCycle = false;
    return {
      matched: true,
      success: true,
      data: {
        startCycleOnly: true,
      },
    };
  }

  const cycleState = effectState.localCycleResolvedState;
  if (!cycleState) {
    return {
      matched: true,
      success: false,
      stopReason: "localCycle",
    };
  }

  if (activation && cycleState.applicationTiming !== "start") {
    return {
      matched: true,
      success: true,
      data: {
        applied: false,
      },
    };
  }

  const ownerSession = session || entity.session || null;
  const previousConditionState = normalizeShipConditionState(entity.conditionState);
  let healthChanged = false;
  let capacitorChanged = false;
  let previousChargeAmount = null;

  if (cycleState.effectName === "shieldBoosting" || cycleState.effectName === "fueledShieldBoosting") {
    healthChanged = applyLocalShieldBoost(entity, cycleState.shieldBoostAmount);
  } else if (cycleState.effectName === "armorRepair" || cycleState.effectName === "fueledArmorRepair") {
    healthChanged = applyLocalArmorRepair(entity, cycleState.armorRepairAmount);
  } else if (cycleState.effectName === "structureRepair") {
    healthChanged = applyLocalStructureRepair(entity, cycleState.structureRepairAmount);
  } else if (cycleState.effectName === "powerBooster") {
    previousChargeAmount = callbacks.getEntityCapacitorAmount(entity);
    const capacitorCapacity = Math.max(0, toFiniteNumber(entity && entity.capacitorCapacity, 0));
    if (capacitorCapacity > 0 && cycleState.capacitorBonus > 0) {
      const nextAmount = Math.min(
        capacitorCapacity,
        previousChargeAmount + cycleState.capacitorBonus,
      );
      callbacks.setEntityCapacitorRatio(entity, nextAmount / capacitorCapacity);
      capacitorChanged = Math.abs(nextAmount - previousChargeAmount) > 1e-6;
    }
  }

  let reloadState = null;
  if (cycleState.chargeUnitsPerCycle > 0 && cycleState.chargeItem) {
    const consumeResult = consumeLoadedChargeQuantity(
      entity,
      moduleItem,
      cycleState.chargeItem,
      cycleState.chargeUnitsPerCycle,
      {
        session: ownerSession,
        callbacks,
      },
    );
    if (!consumeResult.success) {
      return {
        matched: true,
        success: false,
        stopReason: consumeResult.stopReason || "ammo",
      };
    }

    const nextQuantity = toInt(
      consumeResult.data && consumeResult.data.nextQuantity,
      0,
    );
    if (nextQuantity <= 0) {
      const queuedReloadState = scheduleLocalReload({
        entity,
        scene,
        session: ownerSession,
        moduleItem,
        cycleState,
        effectMomentMs: nowMs,
      });
      if (queuedReloadState) {
        reloadState = queuedReloadState;
      } else if (cycleState.canContinueUnloaded !== true) {
        effectState.pendingLocalStopReason = "ammo";
      }
    }
  }

  if (healthChanged) {
    commitLocalHealthChange(
      entity,
      scene,
      ownerSession,
      previousConditionState,
      callbacks,
      nowMs,
    );
  }
  if (capacitorChanged) {
    commitLocalCapacitorChange(
      entity,
      ownerSession,
      callbacks,
      previousChargeAmount,
      nowMs,
    );
  }

  return {
    matched: true,
    success: true,
    data: {
      applied: healthChanged || capacitorChanged,
      reloadState,
    },
  };
}

module.exports = {
  prepareLocalCycleActivation,
  prepareLocalCycleBoundary,
  executeLocalCycle,
};
