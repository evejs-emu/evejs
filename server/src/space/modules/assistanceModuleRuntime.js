const path = require("path");

const {
  getAttributeIDByNames,
} = require(path.join(__dirname, "../../services/fitting/liveFittingState"));
const {
  buildLiveModuleAttributeMap,
} = require(path.join(__dirname, "./liveModuleAttributes"));

const ATTRIBUTE_CAPACITOR_NEED = getAttributeIDByNames("capacitorNeed") || 6;
const ATTRIBUTE_DURATION = getAttributeIDByNames("duration") || 73;
const ATTRIBUTE_SPEED = getAttributeIDByNames("speed") || 51;
const ATTRIBUTE_MAX_RANGE = getAttributeIDByNames("maxRange") || 54;
const ATTRIBUTE_FALLOFF_EFFECTIVENESS = getAttributeIDByNames("falloffEffectiveness") || 2044;
const ATTRIBUTE_SHIELD_BONUS = getAttributeIDByNames("shieldBonus") || 68;
const ATTRIBUTE_ARMOR_DAMAGE_AMOUNT = getAttributeIDByNames("armorDamageAmount") || 84;
const ATTRIBUTE_STRUCTURE_DAMAGE_AMOUNT = getAttributeIDByNames("structureDamageAmount") || 83;
const ATTRIBUTE_POWER_TRANSFER_AMOUNT = getAttributeIDByNames("powerTransferAmount") || 90;
const ATTRIBUTE_MAX_GROUP_ACTIVE = getAttributeIDByNames("maxGroupActive") || 763;
const ATTRIBUTE_REACTIVATION_DELAY =
  getAttributeIDByNames("moduleReactivationDelay", "reactivationDelay") || 669;
const PERSISTENT_SPECIAL_FX_WINDOW_MS = 12 * 60 * 60 * 1000;

const ASSISTANCE_EFFECTS = Object.freeze({
  shipmoduleremotecapacitortransmitter: Object.freeze({
    family: "remoteCapacitor",
    jammingType: "energyTransfer",
  }),
  shipmoduleremoteshieldbooster: Object.freeze({
    family: "remoteShield",
    jammingType: "shieldTransfer",
  }),
  shipmoduleremotearmorrepairer: Object.freeze({
    family: "remoteArmor",
    jammingType: "remoteArmorRepair",
  }),
  shipmoduleremotearmormutadaptiverepairer: Object.freeze({
    family: "remoteArmor",
    jammingType: "RemoteArmorMutadaptiveRepairer",
  }),
  shipmoduleremotehullrepairer: Object.freeze({
    family: "remoteHull",
    jammingType: "remoteHullRepair",
  }),
  npcbehaviorremotearmorrepairer: Object.freeze({
    family: "remoteArmor",
    jammingType: "remoteArmorRepair",
  }),
});

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function roundNumber(value, digits = 6) {
  return Number(toFiniteNumber(value, 0).toFixed(digits));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, toFiniteNumber(value, min)));
}

function normalizeEffectName(effectRecord) {
  return String(effectRecord && effectRecord.name || "").trim().toLowerCase();
}

function resolveAssistanceDefinition(effectRecord) {
  return ASSISTANCE_EFFECTS[normalizeEffectName(effectRecord)] || null;
}

function getPreferredAttributeValue(moduleAttributes, attributeIDs, fallback = 0) {
  const resolvedAttributes =
    moduleAttributes && typeof moduleAttributes === "object"
      ? moduleAttributes
      : null;
  if (!resolvedAttributes) {
    return toFiniteNumber(fallback, 0);
  }

  for (const attributeID of Array.isArray(attributeIDs) ? attributeIDs : [attributeIDs]) {
    const numericAttributeID = toInt(attributeID, 0);
    if (numericAttributeID <= 0) {
      continue;
    }
    const numericValue = Number(resolvedAttributes[numericAttributeID]);
    if (Number.isFinite(numericValue)) {
      return numericValue;
    }
  }

  return toFiniteNumber(fallback, 0);
}

function resolvePersistentRepeat(durationMs) {
  const cycleMs = Math.max(1, toFiniteNumber(durationMs, 1000));
  return Math.max(1, Math.ceil(PERSISTENT_SPECIAL_FX_WINDOW_MS / cycleMs));
}

function resolveAssistanceMultiplier(effectState, sourceEntity, targetEntity, callbacks = {}) {
  const surfaceDistance = Math.max(
    0,
    toFiniteNumber(
      callbacks.getEntitySurfaceDistance &&
        callbacks.getEntitySurfaceDistance(sourceEntity, targetEntity),
      0,
    ),
  );
  const optimalRangeMeters = Math.max(
    0,
    toFiniteNumber(effectState && effectState.assistanceMaxRangeMeters, 0),
  );
  const falloffMeters = Math.max(
    0,
    toFiniteNumber(effectState && effectState.assistanceFalloffMeters, 0),
  );

  if (surfaceDistance <= optimalRangeMeters + 1) {
    return {
      success: true,
      multiplier: 1,
      surfaceDistance,
    };
  }
  if (falloffMeters <= 0) {
    return {
      success: false,
      errorMsg: "TARGET_OUT_OF_RANGE",
      stopReason: "target",
      surfaceDistance,
    };
  }

  const distanceIntoFalloff = surfaceDistance - optimalRangeMeters;
  if (distanceIntoFalloff > falloffMeters + 1) {
    return {
      success: false,
      errorMsg: "TARGET_OUT_OF_RANGE",
      stopReason: "target",
      surfaceDistance,
    };
  }

  const normalizedDistance = distanceIntoFalloff / Math.max(falloffMeters, 1);
  return {
    success: true,
    multiplier: roundNumber(0.5 ** (normalizedDistance ** 2), 6),
    surfaceDistance,
  };
}

function resolveAssistanceModuleActivation({
  scene,
  entity,
  moduleItem,
  effectRecord,
  chargeItem = null,
  shipItem,
  skillMap = null,
  fittedItems = null,
  activeModuleContexts = null,
  options = {},
  callbacks = {},
} = {}) {
  const definition = resolveAssistanceDefinition(effectRecord);
  if (!definition) {
    return { matched: false };
  }

  if (!scene || !entity || !moduleItem || !shipItem) {
    return {
      matched: true,
      success: false,
      errorMsg: "UNSUPPORTED_MODULE",
    };
  }

  const normalizedTargetID = toInt(options.targetID, 0);
  if (normalizedTargetID <= 0) {
    return {
      matched: true,
      success: false,
      errorMsg: "TARGET_REQUIRED",
    };
  }

  const targetEntity = scene.getEntityByID(normalizedTargetID);
  if (!targetEntity || targetEntity.kind !== "ship") {
    return {
      matched: true,
      success: false,
      errorMsg: "TARGET_NOT_FOUND",
    };
  }

  if (
    !callbacks.isEntityLockedTarget ||
    callbacks.isEntityLockedTarget(entity, normalizedTargetID) !== true
  ) {
    return {
      matched: true,
      success: false,
      errorMsg: "TARGET_NOT_LOCKED",
    };
  }

  const moduleAttributes = buildLiveModuleAttributeMap(
    shipItem,
    moduleItem,
    chargeItem,
    skillMap,
    fittedItems,
    activeModuleContexts,
  );
  if (!moduleAttributes) {
    return {
      matched: true,
      success: false,
      errorMsg: "UNSUPPORTED_MODULE",
    };
  }

  const preferredDurationAttributeID = (
    getPreferredAttributeValue(moduleAttributes, [
      effectRecord && effectRecord.durationAttributeID,
    ], 0) > 0
  )
    ? toInt(effectRecord && effectRecord.durationAttributeID, 0)
    : 0;
  const rawDurationMs = getPreferredAttributeValue(
    moduleAttributes,
    [
      preferredDurationAttributeID,
      ATTRIBUTE_DURATION,
      ATTRIBUTE_SPEED,
    ],
    1000,
  );
  const durationAttributeID =
    preferredDurationAttributeID > 0
      ? preferredDurationAttributeID
      : toFiniteNumber(moduleAttributes[ATTRIBUTE_DURATION], 0) > 0
        ? ATTRIBUTE_DURATION
      : ATTRIBUTE_SPEED;
  const effectStatePatch = {
    assistanceModuleEffect: true,
    assistanceFamily: definition.family,
    assistanceJammingType: String(definition.jammingType || ""),
    assistanceMaxRangeMeters: Math.max(
      0,
      roundNumber(getPreferredAttributeValue(
        moduleAttributes,
        [
          effectRecord && effectRecord.rangeAttributeID,
          ATTRIBUTE_MAX_RANGE,
        ],
        0,
      ), 3),
    ),
    assistanceFalloffMeters: Math.max(
      0,
      roundNumber(getPreferredAttributeValue(
        moduleAttributes,
        [
          effectRecord && effectRecord.falloffAttributeID,
          ATTRIBUTE_FALLOFF_EFFECTIVENESS,
        ],
        0,
      ), 3),
    ),
    assistanceShieldBonusAmount: Math.max(
      0,
      roundNumber(toFiniteNumber(moduleAttributes[ATTRIBUTE_SHIELD_BONUS], 0), 6),
    ),
    assistanceArmorRepairAmount: Math.max(
      0,
      roundNumber(toFiniteNumber(moduleAttributes[ATTRIBUTE_ARMOR_DAMAGE_AMOUNT], 0), 6),
    ),
    assistanceHullRepairAmount: Math.max(
      0,
      roundNumber(toFiniteNumber(moduleAttributes[ATTRIBUTE_STRUCTURE_DAMAGE_AMOUNT], 0), 6),
    ),
    assistancePowerTransferAmount: Math.max(
      0,
      roundNumber(toFiniteNumber(moduleAttributes[ATTRIBUTE_POWER_TRANSFER_AMOUNT], 0), 6),
    ),
    forceFreshAcquireSpecialFxReplay: true,
    repeat: resolvePersistentRepeat(rawDurationMs),
  };

  const rangeResult = resolveAssistanceMultiplier(
    effectStatePatch,
    entity,
    targetEntity,
    callbacks,
  );
  if (!rangeResult.success) {
    return {
      matched: true,
      success: false,
      errorMsg: rangeResult.errorMsg || "TARGET_OUT_OF_RANGE",
    };
  }

  return {
    matched: true,
    success: true,
    data: {
      targetEntity,
      runtimeAttrs: {
        capNeed: Math.max(
          0,
          roundNumber(getPreferredAttributeValue(
            moduleAttributes,
            [
              ATTRIBUTE_CAPACITOR_NEED,
              effectRecord && effectRecord.dischargeAttributeID,
            ],
            0,
          ), 6),
        ),
        durationMs: Math.max(1, roundNumber(rawDurationMs, 3)),
        durationAttributeID,
        reactivationDelayMs: Math.max(
          0,
          roundNumber(toFiniteNumber(moduleAttributes[ATTRIBUTE_REACTIVATION_DELAY], 0), 3),
        ),
        maxGroupActive: Math.max(0, toInt(moduleAttributes[ATTRIBUTE_MAX_GROUP_ACTIVE], 0)),
        weaponFamily: null,
        attributeOverrides: {
          ...moduleAttributes,
        },
      },
      effectStatePatch,
    },
  };
}

function buildNormalizedConditionState(targetEntity, callbacks = {}) {
  return callbacks.normalizeShipConditionState
    ? callbacks.normalizeShipConditionState(targetEntity && targetEntity.conditionState)
    : {
        ...((targetEntity && targetEntity.conditionState) || {}),
      };
}

function commitHealthRepair({
  scene,
  targetEntity,
  previousConditionState,
  callbacks = {},
  nowMs,
} = {}) {
  const healthResult =
    callbacks.buildShipHealthTransitionResult &&
    callbacks.buildShipHealthTransitionResult(targetEntity, previousConditionState);
  if (targetEntity.session && healthResult && callbacks.notifyShipHealthAttributesToSession) {
    callbacks.notifyShipHealthAttributesToSession(
      targetEntity.session,
      targetEntity,
      healthResult,
      nowMs,
    );
  }
  if (callbacks.broadcastDamageStateChange) {
    callbacks.broadcastDamageStateChange(scene, targetEntity, nowMs);
  }
  if (callbacks.persistDynamicEntity) {
    callbacks.persistDynamicEntity(targetEntity);
  }
}

function executeAssistanceModuleCycle({
  scene,
  session,
  entity,
  effectState,
  nowMs,
  callbacks = {},
} = {}) {
  if (!scene || !entity || !effectState) {
    return {
      success: false,
      stopReason: "module",
    };
  }

  const targetEntity = scene.getEntityByID(toInt(effectState.targetID, 0));
  if (!targetEntity || targetEntity.kind !== "ship") {
    return {
      success: false,
      errorMsg: "TARGET_NOT_FOUND",
      stopReason: "target",
    };
  }

  if (
    !callbacks.isEntityLockedTarget ||
    callbacks.isEntityLockedTarget(entity, effectState.targetID) !== true
  ) {
    return {
      success: false,
      errorMsg: "TARGET_NOT_LOCKED",
      stopReason: "target",
    };
  }

  const multiplierResult = resolveAssistanceMultiplier(
    effectState,
    entity,
    targetEntity,
    callbacks,
  );
  if (!multiplierResult.success) {
    return multiplierResult;
  }

  if (effectState.assistanceFamily === "remoteShield") {
    const shieldCapacity = Math.max(
      0,
      toFiniteNumber(targetEntity && targetEntity.shieldCapacity, 0),
    );
    const shieldBonusAmount = Math.max(
      0,
      toFiniteNumber(effectState.assistanceShieldBonusAmount, 0),
    ) * Math.max(multiplierResult.multiplier, 0);
    const previousConditionState = buildNormalizedConditionState(targetEntity, callbacks);

    if (shieldCapacity > 0 && shieldBonusAmount > 0) {
      const currentShieldRatio = toFiniteNumber(
        previousConditionState && previousConditionState.shieldCharge,
        toFiniteNumber(targetEntity && targetEntity.capacitorChargeRatio, 0),
      );
      const nextShieldRatio = Math.min(1, currentShieldRatio + (shieldBonusAmount / shieldCapacity));
      targetEntity.conditionState = callbacks.normalizeShipConditionState
        ? callbacks.normalizeShipConditionState({
            ...previousConditionState,
            shieldCharge: nextShieldRatio,
          })
        : {
            ...previousConditionState,
            shieldCharge: nextShieldRatio,
          };
    }

    commitHealthRepair({
      scene,
      targetEntity,
      previousConditionState,
      callbacks,
      nowMs,
    });

    return {
      success: true,
      data: {
        targetEntity,
        multiplier: multiplierResult.multiplier,
        appliedAmount: roundNumber(shieldBonusAmount, 6),
      },
    };
  }

  if (effectState.assistanceFamily === "remoteCapacitor") {
    const capacitorCapacity = Math.max(
      0,
      toFiniteNumber(targetEntity && targetEntity.capacitorCapacity, 0),
    );
    const capacitorBonusAmount = Math.max(
      0,
      toFiniteNumber(effectState.assistancePowerTransferAmount, 0),
    ) * Math.max(multiplierResult.multiplier, 0);
    if (capacitorCapacity > 0 && capacitorBonusAmount > 0) {
      const previousChargeAmount = callbacks.getEntityCapacitorAmount
        ? callbacks.getEntityCapacitorAmount(targetEntity)
        : 0;
      const nextChargeAmount = Math.min(
        capacitorCapacity,
        previousChargeAmount + capacitorBonusAmount,
      );
      if (callbacks.setEntityCapacitorRatio) {
        callbacks.setEntityCapacitorRatio(
          targetEntity,
          nextChargeAmount / capacitorCapacity,
        );
      }
      if (callbacks.persistDynamicEntity) {
        callbacks.persistDynamicEntity(targetEntity);
      }
      if (
        targetEntity.session &&
        callbacks.notifyCapacitorChangeToSession
      ) {
        callbacks.notifyCapacitorChangeToSession(
          targetEntity.session,
          targetEntity,
          nowMs,
          previousChargeAmount,
        );
      }
    }

    return {
      success: true,
      data: {
        targetEntity,
        multiplier: multiplierResult.multiplier,
        appliedAmount: roundNumber(capacitorBonusAmount, 6),
      },
    };
  }

  if (effectState.assistanceFamily === "remoteArmor") {
    const armorHP = Math.max(
      0,
      toFiniteNumber(targetEntity && targetEntity.armorHP, 0),
    );
    const armorRepairAmount = Math.max(
      0,
      toFiniteNumber(effectState.assistanceArmorRepairAmount, 0),
    ) * Math.max(multiplierResult.multiplier, 0);
    const previousConditionState = buildNormalizedConditionState(targetEntity, callbacks);

    if (armorHP > 0 && armorRepairAmount > 0) {
      const currentArmorDamageRatio = clamp(
        toFiniteNumber(previousConditionState && previousConditionState.armorDamage, 0),
        0,
        1,
      );
      const nextArmorDamageRatio = Math.max(
        0,
        currentArmorDamageRatio - (armorRepairAmount / armorHP),
      );
      targetEntity.conditionState = callbacks.normalizeShipConditionState
        ? callbacks.normalizeShipConditionState({
            ...previousConditionState,
            armorDamage: nextArmorDamageRatio,
          })
        : {
            ...previousConditionState,
            armorDamage: nextArmorDamageRatio,
          };
    }

    commitHealthRepair({
      scene,
      targetEntity,
      previousConditionState,
      callbacks,
      nowMs,
    });

    return {
      success: true,
      data: {
        targetEntity,
        multiplier: multiplierResult.multiplier,
        appliedAmount: roundNumber(armorRepairAmount, 6),
      },
    };
  }

  if (effectState.assistanceFamily === "remoteHull") {
    const structureHP = Math.max(
      0,
      toFiniteNumber(targetEntity && targetEntity.structureHP, 0),
    );
    const hullRepairAmount = Math.max(
      0,
      toFiniteNumber(effectState.assistanceHullRepairAmount, 0),
    ) * Math.max(multiplierResult.multiplier, 0);
    const previousConditionState = buildNormalizedConditionState(targetEntity, callbacks);

    if (structureHP > 0 && hullRepairAmount > 0) {
      const currentStructureDamageRatio = clamp(
        toFiniteNumber(previousConditionState && previousConditionState.damage, 0),
        0,
        1,
      );
      const nextStructureDamageRatio = Math.max(
        0,
        currentStructureDamageRatio - (hullRepairAmount / structureHP),
      );
      targetEntity.conditionState = callbacks.normalizeShipConditionState
        ? callbacks.normalizeShipConditionState({
            ...previousConditionState,
            damage: nextStructureDamageRatio,
          })
        : {
            ...previousConditionState,
            damage: nextStructureDamageRatio,
          };
    }

    commitHealthRepair({
      scene,
      targetEntity,
      previousConditionState,
      callbacks,
      nowMs,
    });

    return {
      success: true,
      data: {
        targetEntity,
        multiplier: multiplierResult.multiplier,
        appliedAmount: roundNumber(hullRepairAmount, 6),
      },
    };
  }

  return {
    success: false,
    stopReason: "module",
  };
}

module.exports = {
  resolveAssistanceDefinition,
  resolveAssistanceModuleActivation,
  executeAssistanceModuleCycle,
};
