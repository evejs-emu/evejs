const path = require("path");

const {
  cloneVector,
  getCapitalControllerState,
  toFiniteNumber,
  toPositiveInt,
} = require(path.join(__dirname, "../../../space/npc/capitals/capitalNpcState"));
const {
  getCapitalRuntimeConfig,
} = require(path.join(__dirname, "../../../space/npc/capitals/capitalNpcRuntimeConfig"));

function buildNpcPseudoSession(entity) {
  return {
    characterID: 0,
    charID: 0,
    corporationID: toPositiveInt(entity && entity.corporationID, 0),
    allianceID: toPositiveInt(entity && entity.allianceID, 0),
    warFactionID: toPositiveInt(entity && entity.warFactionID, 0),
    solarsystemid: toPositiveInt(entity && entity.systemID, 0),
    solarsystemid2: toPositiveInt(entity && entity.systemID, 0),
    _space: {
      systemID: toPositiveInt(entity && entity.systemID, 0),
      shipID: toPositiveInt(entity && entity.itemID, 0),
    },
    shipItem: entity,
    sendNotification() {
      return false;
    },
  };
}

function syncNpcTitanSuperweapon(scene, entity, controller, behaviorProfile, targetEntity, options = {}) {
  const moduleTypeID = toPositiveInt(
    behaviorProfile && behaviorProfile.capitalSuperweaponModuleTypeID,
    0,
  );
  if (!scene || !entity || !controller || !targetEntity || moduleTypeID <= 0) {
    return false;
  }

  const capitalState = getCapitalControllerState(controller);
  const nowMs = toFiniteNumber(options.nowMs, Date.now());
  const runtimeConfig = getCapitalRuntimeConfig(entity && entity.capitalClassID);
  if (capitalState && nowMs < toFiniteNumber(capitalState.nextSuperweaponAttemptAtMs, 0)) {
    return false;
  }

  const moduleItem = (Array.isArray(entity.fittedItems) ? entity.fittedItems : []).find((entry) => (
    toPositiveInt(entry && entry.typeID, 0) === moduleTypeID
  )) || null;
  if (!moduleItem) {
    return false;
  }

  const activeEffect =
    entity.activeModuleEffects instanceof Map
      ? entity.activeModuleEffects.get(toPositiveInt(moduleItem.itemID, 0)) || null
      : null;
  if (activeEffect) {
    if (capitalState) {
      capitalState.nextSuperweaponAttemptAtMs = nowMs + Math.max(
        runtimeConfig.superweaponSuccessfulRearmMs,
        toPositiveInt(activeEffect.durationMs, runtimeConfig.superweaponSuccessfulRearmMs),
      );
    }
    return false;
  }

  const targetMode = String(
    behaviorProfile && behaviorProfile.capitalSuperweaponTargetMode || "item",
  ).trim().toLowerCase();
  const activationResult = scene.activateGenericModule(
    buildNpcPseudoSession(entity),
    moduleItem,
    null,
    targetMode === "point"
      ? { targetPoint: cloneVector(targetEntity.position) }
      : { targetID: targetEntity.itemID },
  );
  if (!(activationResult && activationResult.success)) {
    if (capitalState) {
      capitalState.nextSuperweaponAttemptAtMs = nowMs + runtimeConfig.superweaponRetryMs;
    }
    return false;
  }

  if (capitalState) {
    const refreshedEffect =
      entity.activeModuleEffects instanceof Map
        ? entity.activeModuleEffects.get(toPositiveInt(moduleItem.itemID, 0)) || null
        : null;
    capitalState.nextSuperweaponAttemptAtMs = nowMs + Math.max(
      runtimeConfig.superweaponSuccessfulRearmMs,
      toPositiveInt(refreshedEffect && refreshedEffect.durationMs, runtimeConfig.superweaponSuccessfulRearmMs),
    );
  }
  return true;
}

module.exports = {
  syncNpcTitanSuperweapon,
};
