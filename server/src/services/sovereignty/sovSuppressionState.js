const path = require("path");

const structureState = require(path.join(
  __dirname,
  "../structure/structureState",
));
const {
  STRUCTURE_STATE,
  STRUCTURE_UPKEEP_STATE,
  STRUCTURE_SERVICE_ID,
  STRUCTURE_SERVICE_STATE,
} = require(path.join(__dirname, "../structure/structureConstants"));
const {
  getHubIDForSolarSystem,
  getHubUpgrades,
} = require(path.join(__dirname, "./sovModernState"));
const {
  TYPE_CYNO_SUPPRESSION_UPGRADE,
  TYPE_TENEBREX_CYNO_JAMMER,
} = require(path.join(__dirname, "./sovUpgradeSupport"));

const ACTIVE_CYNO_JAMMER_STATES = new Set([
  STRUCTURE_STATE.SHIELD_VULNERABLE,
  STRUCTURE_STATE.ARMOR_REINFORCE,
  STRUCTURE_STATE.ARMOR_VULNERABLE,
  STRUCTURE_STATE.HULL_REINFORCE,
  STRUCTURE_STATE.HULL_VULNERABLE,
  STRUCTURE_STATE.FITTING_INVULNERABLE,
  STRUCTURE_STATE.ONLINE_DEPRECATED,
  STRUCTURE_STATE.FOB_INVULNERABLE,
]);

function normalizeInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.trunc(numeric);
}

function normalizePositiveInteger(value, fallback = null) {
  const numeric = normalizeInteger(value, 0);
  return numeric > 0 ? numeric : fallback;
}

function getLiveTenebrexForSolarSystem(solarSystemID) {
  const numericSolarSystemID = normalizePositiveInteger(solarSystemID, null);
  if (!numericSolarSystemID) {
    return null;
  }
  const structures = structureState.listStructuresForSystem(numericSolarSystemID, {
    includeDestroyed: true,
    refresh: false,
  });
  return structures.find((structure) => (
    normalizePositiveInteger(structure && structure.typeID, 0) === TYPE_TENEBREX_CYNO_JAMMER &&
    !normalizePositiveInteger(structure && structure.destroyedAt, null)
  )) || null;
}

function isCynoSuppressionUpgradeOnline(solarSystemID) {
  const hubID = normalizePositiveInteger(getHubIDForSolarSystem(solarSystemID), null);
  if (!hubID) {
    return false;
  }
  const upgrades = getHubUpgrades(hubID);
  const cynoSuppression = Array.isArray(upgrades && upgrades.upgrades)
    ? upgrades.upgrades.find(
      (upgrade) => normalizePositiveInteger(upgrade && upgrade.typeID, 0) === TYPE_CYNO_SUPPRESSION_UPGRADE,
    ) || null
    : null;
  return normalizeInteger(cynoSuppression && cynoSuppression.powerState, 0) === 2;
}

function isTenebrexOperational(structure, nowMs = Date.now()) {
  if (!structure) {
    return false;
  }
  if (
    normalizeInteger(
      structure &&
        structure.serviceStates &&
        structure.serviceStates[String(STRUCTURE_SERVICE_ID.CYNO_JAMMER)],
      0,
    ) !== STRUCTURE_SERVICE_STATE.ONLINE
  ) {
    return false;
  }
  if (
    normalizeInteger(structure && structure.upkeepState, 0) !==
    STRUCTURE_UPKEEP_STATE.FULL_POWER
  ) {
    return false;
  }
  if (normalizeInteger(structure && structure.liquidOzoneQty, 0) <= 0) {
    return false;
  }
  if (normalizeInteger(structure && structure.fuelExpiresAt, 0) <= normalizeInteger(nowMs, 0)) {
    return false;
  }
  return true;
}

function getCynoJammerActivationTimeMs(solarSystemID, options = {}) {
  const nowMs = normalizeInteger(options.nowMs, Date.now());
  if (!isCynoSuppressionUpgradeOnline(solarSystemID)) {
    return null;
  }
  const structure = getLiveTenebrexForSolarSystem(solarSystemID);
  if (!isTenebrexOperational(structure, nowMs)) {
    return null;
  }
  const state = normalizeInteger(structure && structure.state, 0);
  const stateEndsAt = normalizeInteger(structure && structure.stateEndsAt, 0);
  if (state === STRUCTURE_STATE.ONLINING_VULNERABLE && stateEndsAt > nowMs) {
    return stateEndsAt;
  }
  if (ACTIVE_CYNO_JAMMER_STATES.has(state)) {
    return 0;
  }
  return null;
}

function getCynoJammerOnlineSimTime(solarSystemID, options = {}) {
  const activationTimeMs = getCynoJammerActivationTimeMs(solarSystemID, options);
  if (activationTimeMs === null) {
    return null;
  }
  if (activationTimeMs === 0) {
    return 0;
  }
  return structureState.toFileTimeLongFromMs(activationTimeMs);
}

function isSolarSystemCynoJammed(solarSystemID, options = {}) {
  const nowMs = normalizeInteger(options.nowMs, Date.now());
  const activationTimeMs = getCynoJammerActivationTimeMs(solarSystemID, options);
  return activationTimeMs === 0 || (
    normalizePositiveInteger(activationTimeMs, null) !== null &&
    normalizeInteger(activationTimeMs, 0) <= nowMs
  );
}

module.exports = {
  getCynoJammerOnlineSimTime,
  getLiveTenebrexForSolarSystem,
  getCynoJammerActivationTimeMs,
  isSolarSystemCynoJammed,
};
