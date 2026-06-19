const path = require("path");

const {
  getSovereigntyStaticSnapshot,
} = require(path.join(__dirname, "./sovStaticData"));

const TYPE_CYNO_NAVIGATION_UPGRADE = 81615;
const TYPE_CYNO_SUPPRESSION_UPGRADE = 81619;
const TYPE_ADVANCED_LOGISTICS_NETWORK_UPGRADE = 81621;
const TYPE_PHAROLUX_CYNO_BEACON = 35840;
const TYPE_ANSIBLEX_JUMP_BRIDGE = 35841;
const TYPE_TENEBREX_CYNO_JAMMER = 37534;
const SHOWCASE_SOV_FLEX_REQUIRED_UPGRADE_TYPE_IDS = Object.freeze([
  TYPE_CYNO_NAVIGATION_UPGRADE,
  TYPE_CYNO_SUPPRESSION_UPGRADE,
  TYPE_ADVANCED_LOGISTICS_NETWORK_UPGRADE,
]);
const MAX_OPERATIONAL_INDEX_POINTS = 57_600_000;
const MAX_STRATEGIC_CLAIM_DAYS = 100;

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

function getUpgradeDefinition(installationTypeID) {
  const snapshot = getSovereigntyStaticSnapshot();
  return snapshot.upgradeDefinitionsByTypeID.get(
    normalizePositiveInteger(installationTypeID, 0),
  ) || null;
}

function getLocalSovereigntyResourceCapacity(solarSystemID) {
  const snapshot = getSovereigntyStaticSnapshot();
  const numericSolarSystemID = normalizePositiveInteger(solarSystemID, null);
  if (!numericSolarSystemID) {
    return {
      solarSystemID: null,
      power: 0,
      workforce: 0,
    };
  }

  const star = snapshot.starConfigurationsBySolarSystemID.get(numericSolarSystemID) || null;
  let power = Number(star && star.power) || 0;
  let workforce = 0;
  const planetIDs = snapshot.planetsBySolarSystemID.get(numericSolarSystemID) || [];
  for (const planetID of planetIDs) {
    const planet = snapshot.planetDefinitionsByPlanetID.get(planetID) || null;
    power += Number(planet && planet.power) || 0;
    workforce += Number(planet && planet.workforce) || 0;
  }

  return {
    solarSystemID: numericSolarSystemID,
    power,
    workforce,
  };
}

function canSolarSystemSupportUpgrade(solarSystemID, installationTypeID) {
  const definition = getUpgradeDefinition(installationTypeID);
  if (!definition) {
    return false;
  }
  const capacity = getLocalSovereigntyResourceCapacity(solarSystemID);
  return (
    capacity.power >= Math.max(0, Number(definition.powerRequired) || 0) &&
    capacity.workforce >= Math.max(0, Number(definition.workforceRequired) || 0)
  );
}

function canSolarSystemSupportUpgrades(solarSystemID, installationTypeIDs) {
  const requiredTypeIDs = Array.isArray(installationTypeIDs)
    ? [...new Set(
      installationTypeIDs
        .map((typeID) => normalizePositiveInteger(typeID, null))
        .filter(Boolean),
    )]
    : [];
  return requiredTypeIDs.every((typeID) => (
    canSolarSystemSupportUpgrade(solarSystemID, typeID)
  ));
}

function canSolarSystemSupportSovFlexShowcase(solarSystemID) {
  return canSolarSystemSupportUpgrades(
    solarSystemID,
    SHOWCASE_SOV_FLEX_REQUIRED_UPGRADE_TYPE_IDS,
  );
}

module.exports = {
  MAX_OPERATIONAL_INDEX_POINTS,
  MAX_STRATEGIC_CLAIM_DAYS,
  SHOWCASE_SOV_FLEX_REQUIRED_UPGRADE_TYPE_IDS,
  TYPE_ADVANCED_LOGISTICS_NETWORK_UPGRADE,
  TYPE_ANSIBLEX_JUMP_BRIDGE,
  TYPE_CYNO_NAVIGATION_UPGRADE,
  TYPE_CYNO_SUPPRESSION_UPGRADE,
  TYPE_PHAROLUX_CYNO_BEACON,
  TYPE_TENEBREX_CYNO_JAMMER,
  canSolarSystemSupportSovFlexShowcase,
  canSolarSystemSupportUpgrade,
  canSolarSystemSupportUpgrades,
  getLocalSovereigntyResourceCapacity,
  getUpgradeDefinition,
};
