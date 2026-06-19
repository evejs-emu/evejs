const path = require("path");

const structureState = require(path.join(
  __dirname,
  "../services/structure/structureState",
));
const structureTetherRestrictionState = require(path.join(
  __dirname,
  "../services/structure/structureTetherRestrictionState",
));
const crimewatchState = require(path.join(
  __dirname,
  "../services/security/crimewatchState",
));

const TETHER_FX_GUID = "effects.Tethering";
const TETHER_REPAIR_FX_GUID = "effects.TetheringRepair";
const TETHER_SHIELD_REPAIR_FX_GUID = "effects.ShieldBoosting";
const TETHER_ARMOR_REPAIR_FX_GUID = "effects.ArmorRepair";
const TETHER_LINK_DURATION_MS = 86_400_000;
const TETHER_REPAIR_DURATION_MS = 10_000;
const TETHER_REPAIR_REPEAT = 10_000;

const TETHER_REPAIR_EFFECT_MODE = Object.freeze({
  GENERIC: "generic",
  SHIELD: "shield",
  ARMOR: "armor",
  BOTH: "both",
});

const TETHER_REPAIR_FX_GUIDS_BY_MODE = Object.freeze({
  [TETHER_REPAIR_EFFECT_MODE.GENERIC]: Object.freeze([TETHER_REPAIR_FX_GUID]),
  [TETHER_REPAIR_EFFECT_MODE.SHIELD]: Object.freeze([
    TETHER_SHIELD_REPAIR_FX_GUID,
  ]),
  [TETHER_REPAIR_EFFECT_MODE.ARMOR]: Object.freeze([
    TETHER_ARMOR_REPAIR_FX_GUID,
  ]),
  [TETHER_REPAIR_EFFECT_MODE.BOTH]: Object.freeze([
    TETHER_SHIELD_REPAIR_FX_GUID,
    TETHER_ARMOR_REPAIR_FX_GUID,
  ]),
});

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value));
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeTetherRepairEffectMode(
  value,
  fallback = TETHER_REPAIR_EFFECT_MODE.GENERIC,
) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  switch (normalized) {
    case "shield":
    case "shieldboost":
    case "shieldboosting":
      return TETHER_REPAIR_EFFECT_MODE.SHIELD;
    case "armor":
    case "armour":
    case "armorrepair":
    case "armourrepair":
      return TETHER_REPAIR_EFFECT_MODE.ARMOR;
    case "both":
    case "shieldarmor":
    case "shieldarmour":
    case "armorshield":
    case "armourshield":
      return TETHER_REPAIR_EFFECT_MODE.BOTH;
    case "generic":
    case "tether":
    case "tethering":
    case "tetheringrepair":
      return TETHER_REPAIR_EFFECT_MODE.GENERIC;
    default:
      return normalizeTetherRepairEffectMode(
        fallback,
        TETHER_REPAIR_EFFECT_MODE.GENERIC,
      );
  }
}

function getTetherRepairFxGuids(mode) {
  const normalizedMode = normalizeTetherRepairEffectMode(mode);
  return [
    ...(
      TETHER_REPAIR_FX_GUIDS_BY_MODE[normalizedMode] ||
      TETHER_REPAIR_FX_GUIDS_BY_MODE[TETHER_REPAIR_EFFECT_MODE.GENERIC]
    ),
  ];
}

function isEntityStructureTethered(entity) {
  return Boolean(
    entity &&
      entity.structureTether &&
      entity.structureTether.active === true &&
      toInt(entity.structureTether.structureID, 0) > 0
  );
}

function clearEntityStructureTether(entity, nowMs = Date.now(), reason = null) {
  if (!isEntityStructureTethered(entity)) {
    return false;
  }
  entity.structureTether = {
    ...entity.structureTether,
    active: false,
    clearedAtMs: toInt(nowMs, Date.now()),
    reason: reason || null,
  };
  return true;
}

function startEntityStructureTether(entity, structureEntity, nowMs = Date.now()) {
  const structureID = toInt(structureEntity && structureEntity.itemID, 0);
  if (!entity || structureID <= 0) {
    return false;
  }
  entity.structureTether = {
    active: true,
    structureID,
    startedAtMs: toInt(nowMs, Date.now()),
  };
  return true;
}

function hasActiveTargetedEffect(entity) {
  if (!entity || !(entity.activeModuleEffects instanceof Map)) {
    return false;
  }
  for (const effectState of entity.activeModuleEffects.values()) {
    if (!effectState) {
      continue;
    }
    if (toInt(effectState.targetID, 0) > 0 && toFiniteNumber(effectState.deactivateAtMs, 0) <= 0) {
      return true;
    }
  }
  return false;
}

function hasWeaponTimer(entity, nowMs = Date.now()) {
  const characterID = toInt(
    entity &&
      entity.session &&
      entity.session.characterID,
    0,
  );
  if (characterID <= 0) {
    return false;
  }
  const state = crimewatchState.getCharacterCrimewatchState(characterID, nowMs);
  return Boolean(
    state &&
      toFiniteNumber(state.weaponTimerExpiresAtMs, 0) > toFiniteNumber(nowMs, Date.now())
  );
}

function resolveEligibleTetherStructure(scene, entity, nowMs = Date.now(), helpers = {}) {
  if (
    !scene ||
    !entity ||
    entity.kind !== "ship" ||
    !entity.session
  ) {
    return {
      eligible: false,
      reason: "ENTITY_NOT_ELIGIBLE",
      structure: null,
    };
  }

  if (
    (entity.mode === "WARP" && entity.warpState) ||
    entity.pendingWarp
  ) {
    return {
      eligible: false,
      reason: "ENTITY_WARPING",
      structure: null,
    };
  }

  if (hasWeaponTimer(entity, nowMs)) {
    return {
      eligible: false,
      reason: "WEAPONS_TIMER",
      structure: null,
    };
  }

  const lockedTargetCount = toInt(
    helpers.getLockedTargetCount && helpers.getLockedTargetCount(entity),
    0,
  );
  const pendingTargetCount = toInt(
    helpers.getPendingTargetLockCount && helpers.getPendingTargetLockCount(entity),
    0,
  );
  const targetedByCount = toInt(
    helpers.getTargetedByCount && helpers.getTargetedByCount(entity),
    0,
  );
  if (
    lockedTargetCount > 0 ||
    pendingTargetCount > 0 ||
    targetedByCount > 0 ||
    hasActiveTargetedEffect(entity)
  ) {
    return {
      eligible: false,
      reason: targetedByCount > 0 ? "TARGETED_BY_OTHER" : "TARGETING_ACTIVE",
      structure: null,
    };
  }

  const tetherRestriction = structureTetherRestrictionState.getCharacterStructureTetherRestriction(
    entity.session && entity.session.characterID,
    nowMs,
    {
      session: entity.session,
    },
  );
  if (tetherRestriction.restricted) {
    return {
      eligible: false,
      reason: tetherRestriction.reason || "TETHER_RESTRICTED",
      structure: null,
    };
  }

  const candidates = Array.isArray(scene.staticEntities)
    ? scene.staticEntities.filter((candidate) => candidate && candidate.kind === "structure")
    : [];
  const getSurfaceDistance = helpers.getSurfaceDistance;
  const sortedCandidates = candidates
    .map((candidate) => ({
      structure: candidate,
      surfaceDistance: getSurfaceDistance ? toFiniteNumber(getSurfaceDistance(entity, candidate), Infinity) : Infinity,
    }))
    .sort((left, right) => left.surfaceDistance - right.surfaceDistance);

  for (const candidate of sortedCandidates) {
    const structureEntity = candidate.structure;
    const structureRecord =
      structureState.getStructureByID(
        toInt(structureEntity && structureEntity.itemID, 0),
        {
          refresh: false,
        },
      ) ||
      structureEntity;
    if (!structureState.isStructureTetheringAllowed(structureRecord, entity.session)) {
      continue;
    }
    const dockCheck = structureState.canCharacterDockAtStructure(
      entity.session,
      structureRecord,
      {
        shipTypeID:
          toInt(entity.session.shipTypeID, 0) ||
          toInt(entity.typeID, 0),
      },
    );
    if (!dockCheck.success) {
      continue;
    }

    const tetherRange = Math.max(
      0,
      toFiniteNumber(
        structureRecord && structureRecord.tetheringRange,
        toFiniteNumber(structureEntity && structureEntity.tetheringRange, 0),
      ),
    );
    if (candidate.surfaceDistance > tetherRange + 1e-3) {
      continue;
    }

    return {
      eligible: true,
      reason: null,
      structure: structureEntity,
    };
  }

  return {
    eligible: false,
    reason: "NO_TETHER_STRUCTURE",
    structure: null,
  };
}

module.exports = {
  TETHER_FX_GUID,
  TETHER_REPAIR_FX_GUID,
  TETHER_SHIELD_REPAIR_FX_GUID,
  TETHER_ARMOR_REPAIR_FX_GUID,
  TETHER_REPAIR_EFFECT_MODE,
  TETHER_LINK_DURATION_MS,
  TETHER_REPAIR_DURATION_MS,
  TETHER_REPAIR_REPEAT,
  getTetherRepairFxGuids,
  normalizeTetherRepairEffectMode,
  isEntityStructureTethered,
  clearEntityStructureTether,
  startEntityStructureTether,
  resolveEligibleTetherStructure,
};
