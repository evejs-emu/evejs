const path = require("path");

const {
  getAttributeIDByNames,
} = require(path.join(__dirname, "../../services/fitting/liveFittingState"));

const ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS_PER_CYCLE =
  getAttributeIDByNames("damageMultiplierBonusPerCycle") || 2733;
const ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS_MAX =
  getAttributeIDByNames("damageMultiplierBonusMax") || 2734;
const ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS_CURRENT =
  getAttributeIDByNames("damageMultiplierBonusCurrent") || 5804;
const ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS_MAX_TIMESTAMP =
  getAttributeIDByNames("damageMultiplierBonusMaxTimestamp") || 5818;

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function round6(value) {
  return Number(toFiniteNumber(value, 0).toFixed(6));
}

function isPrecursorTurretFamily(family) {
  return String(family || "") === "precursorTurret";
}

function getPrecursorBonusPerCycle(weaponSnapshot = null) {
  return Math.max(
    0,
    round6(toFiniteNumber(
      weaponSnapshot &&
        weaponSnapshot.moduleAttributes &&
        weaponSnapshot.moduleAttributes[ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS_PER_CYCLE],
      0,
    )),
  );
}

function getPrecursorBonusMax(weaponSnapshot = null) {
  return Math.max(
    0,
    round6(toFiniteNumber(
      weaponSnapshot &&
        weaponSnapshot.moduleAttributes &&
        weaponSnapshot.moduleAttributes[ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS_MAX],
      0,
    )),
  );
}

function computeRemainingCyclesToMax(currentBonus, bonusPerCycle, maxBonus) {
  const current = Math.max(0, toFiniteNumber(currentBonus, 0));
  const perCycle = Math.max(0, toFiniteNumber(bonusPerCycle, 0));
  const max = Math.max(0, toFiniteNumber(maxBonus, 0));
  if (perCycle <= 0 || max <= 0 || current >= max) {
    return 0;
  }
  return Math.max(0, Math.ceil((max - current) / perCycle));
}

function computeMaxTimestampMs(nowMs, currentBonus, bonusPerCycle, maxBonus, durationMs) {
  const remainingCycles = computeRemainingCyclesToMax(currentBonus, bonusPerCycle, maxBonus);
  if (remainingCycles <= 0) {
    return Math.max(0, toFiniteNumber(nowMs, 0));
  }
  return Math.max(
    0,
    round6(
      toFiniteNumber(nowMs, 0) +
      (remainingCycles * Math.max(1, toFiniteNumber(durationMs, 1))),
    ),
  );
}

function ensurePrecursorAttributeOverrides(effectState) {
  if (!effectState || typeof effectState !== "object") {
    return null;
  }
  if (!effectState.genericAttributeOverrides || typeof effectState.genericAttributeOverrides !== "object") {
    effectState.genericAttributeOverrides = {};
  }
  return effectState.genericAttributeOverrides;
}

function syncPrecursorAttributeOverrides(effectState) {
  if (!effectState || !isPrecursorTurretFamily(effectState.weaponFamily)) {
    return null;
  }
  const overrides = ensurePrecursorAttributeOverrides(effectState);
  if (!overrides) {
    return null;
  }
  overrides[ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS_CURRENT] = round6(
    Math.max(0, toFiniteNumber(effectState.precursorSpoolCurrent, 0)),
  );
  overrides[ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS_MAX_TIMESTAMP] =
    Math.max(0, round6(toFiniteNumber(effectState.precursorSpoolMaxTimestampMs, 0)));
  return overrides;
}

function initializePrecursorTurretEffectState(effectState, weaponSnapshot, nowMs) {
  if (!effectState || !isPrecursorTurretFamily(effectState.weaponFamily)) {
    return effectState;
  }

  effectState.precursorTurret = true;
  effectState.precursorSpoolCurrent = 0;
  effectState.precursorSpoolPerCycle = getPrecursorBonusPerCycle(weaponSnapshot);
  effectState.precursorSpoolMax = getPrecursorBonusMax(weaponSnapshot);
  effectState.precursorSpoolTargetID = toInt(effectState.targetID, 0);
  effectState.precursorSpoolMaxTimestampMs = computeMaxTimestampMs(
    nowMs,
    effectState.precursorSpoolCurrent,
    effectState.precursorSpoolPerCycle,
    effectState.precursorSpoolMax,
    weaponSnapshot && weaponSnapshot.durationMs,
  );
  syncPrecursorAttributeOverrides(effectState);
  return effectState;
}

function synchronizePrecursorTurretEffectState(effectState, weaponSnapshot, nowMs) {
  if (!effectState || !isPrecursorTurretFamily(effectState.weaponFamily)) {
    return effectState;
  }

  const nextTargetID = toInt(effectState.targetID, 0);
  const previousTargetID = toInt(effectState.precursorSpoolTargetID, 0);
  if (previousTargetID > 0 && nextTargetID > 0 && previousTargetID !== nextTargetID) {
    effectState.precursorSpoolCurrent = 0;
  }

  effectState.precursorTurret = true;
  effectState.precursorSpoolTargetID = nextTargetID;
  effectState.precursorSpoolPerCycle = getPrecursorBonusPerCycle(weaponSnapshot);
  effectState.precursorSpoolMax = getPrecursorBonusMax(weaponSnapshot);
  effectState.precursorSpoolCurrent = round6(
    Math.min(
      Math.max(0, toFiniteNumber(effectState.precursorSpoolCurrent, 0)),
      Math.max(0, toFiniteNumber(effectState.precursorSpoolMax, 0)),
    ),
  );
  effectState.precursorSpoolMaxTimestampMs = computeMaxTimestampMs(
    nowMs,
    effectState.precursorSpoolCurrent,
    effectState.precursorSpoolPerCycle,
    effectState.precursorSpoolMax,
    weaponSnapshot && weaponSnapshot.durationMs,
  );
  syncPrecursorAttributeOverrides(effectState);
  return effectState;
}

function advancePrecursorTurretSpool(effectState, weaponSnapshot, nowMs) {
  if (!effectState || !isPrecursorTurretFamily(effectState.weaponFamily)) {
    return effectState;
  }

  synchronizePrecursorTurretEffectState(effectState, weaponSnapshot, nowMs);
  effectState.precursorSpoolCurrent = round6(
    Math.min(
      Math.max(0, toFiniteNumber(effectState.precursorSpoolMax, 0)),
      Math.max(0, toFiniteNumber(effectState.precursorSpoolCurrent, 0)) +
        Math.max(0, toFiniteNumber(effectState.precursorSpoolPerCycle, 0)),
    ),
  );
  effectState.precursorSpoolMaxTimestampMs = computeMaxTimestampMs(
    nowMs,
    effectState.precursorSpoolCurrent,
    effectState.precursorSpoolPerCycle,
    effectState.precursorSpoolMax,
    weaponSnapshot && weaponSnapshot.durationMs,
  );
  syncPrecursorAttributeOverrides(effectState);
  return effectState;
}

function resetPrecursorTurretSpool(effectState) {
  if (!effectState || !isPrecursorTurretFamily(effectState.weaponFamily)) {
    return effectState;
  }

  effectState.precursorSpoolCurrent = 0;
  effectState.precursorSpoolTargetID = 0;
  effectState.precursorSpoolMaxTimestampMs = 0;
  syncPrecursorAttributeOverrides(effectState);
  return effectState;
}

function buildPrecursorTurretGraphicInfo(effectState) {
  if (!effectState || !isPrecursorTurretFamily(effectState.weaponFamily)) {
    return null;
  }

  const multiplierBonusPerCycle = round6(
    Math.max(0, toFiniteNumber(effectState.precursorSpoolPerCycle, 0)),
  );
  return {
    // CCP packaged-client parity: triglavianBeam.py indexes the historical
    // typo `mulitplierBonusPerCycle` directly. Keep the corrected alias too so
    // any repo-side/debug consumers can read the sane spelling.
    mulitplierBonusPerCycle: multiplierBonusPerCycle,
    multiplierBonusPerCycle,
    multiplierBonusMax: round6(
      Math.max(0, toFiniteNumber(effectState.precursorSpoolMax, 0)),
    ),
  };
}

function applyPrecursorTurretSpoolToSnapshot(weaponSnapshot, effectState) {
  if (
    !weaponSnapshot ||
    !effectState ||
    !isPrecursorTurretFamily(weaponSnapshot.family) ||
    !isPrecursorTurretFamily(effectState.weaponFamily)
  ) {
    return weaponSnapshot;
  }

  const spoolBonusCurrent = Math.max(0, toFiniteNumber(effectState.precursorSpoolCurrent, 0));
  if (spoolBonusCurrent <= 0) {
    return weaponSnapshot;
  }

  const spoolMultiplier = round6(1 + spoolBonusCurrent);
  return {
    ...weaponSnapshot,
    spoolBonusCurrent,
    spoolMultiplier,
    damageMultiplier: round6(
      Math.max(0, toFiniteNumber(weaponSnapshot.damageMultiplier, 0)) * spoolMultiplier,
    ),
    rawShotDamage: {
      em: round6(toFiniteNumber(weaponSnapshot.rawShotDamage && weaponSnapshot.rawShotDamage.em, 0) * spoolMultiplier),
      thermal: round6(toFiniteNumber(weaponSnapshot.rawShotDamage && weaponSnapshot.rawShotDamage.thermal, 0) * spoolMultiplier),
      kinetic: round6(toFiniteNumber(weaponSnapshot.rawShotDamage && weaponSnapshot.rawShotDamage.kinetic, 0) * spoolMultiplier),
      explosive: round6(toFiniteNumber(weaponSnapshot.rawShotDamage && weaponSnapshot.rawShotDamage.explosive, 0) * spoolMultiplier),
    },
  };
}

module.exports = {
  ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS_PER_CYCLE,
  ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS_MAX,
  ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS_CURRENT,
  ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS_MAX_TIMESTAMP,
  isPrecursorTurretFamily,
  initializePrecursorTurretEffectState,
  synchronizePrecursorTurretEffectState,
  advancePrecursorTurretSpool,
  resetPrecursorTurretSpool,
  buildPrecursorTurretGraphicInfo,
  applyPrecursorTurretSpoolToSnapshot,
};
