const path = require("path");

const worldData = require(path.join(__dirname, "../../space/worldData"));

const KNOWN_SPACE_SYSTEM_MIN = 30000000;
const KNOWN_SPACE_SYSTEM_MAX = 30999999;
const SOLAR_SYSTEM_ZARZAKH = 30100000;
const REGION_TRIGLAVIAN = 10000070;
const NON_CLAIMABLE_REGION_IDS = new Set([
  REGION_TRIGLAVIAN,
  10000004,
  10000017,
  10000019,
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

function resolveSolarSystemRecord(solarSystemOrID) {
  if (solarSystemOrID && typeof solarSystemOrID === "object") {
    return solarSystemOrID;
  }
  return worldData.getSolarSystemByID(solarSystemOrID);
}

function isKnownSpaceSolarSystemID(solarSystemID) {
  const numericSolarSystemID = normalizePositiveInteger(solarSystemID, 0);
  return (
    numericSolarSystemID >= KNOWN_SPACE_SYSTEM_MIN &&
    numericSolarSystemID <= KNOWN_SPACE_SYSTEM_MAX
  );
}

function isSovereigntyClaimableSolarSystem(solarSystemOrID) {
  const solarSystem = resolveSolarSystemRecord(solarSystemOrID);
  const solarSystemID = normalizePositiveInteger(
    solarSystem && solarSystem.solarSystemID,
    normalizePositiveInteger(solarSystemOrID, null),
  );
  if (!solarSystem || !solarSystemID || !isKnownSpaceSolarSystemID(solarSystemID)) {
    return false;
  }
  if (solarSystemID === SOLAR_SYSTEM_ZARZAKH) {
    return false;
  }

  // The local static map cache does not always preserve CCP's special-space
  // faction markers, so we explicitly exclude the known non-conquerable
  // regions that can otherwise look like factionless nullsec.
  const regionID = normalizePositiveInteger(solarSystem.regionID, 0);
  if (NON_CLAIMABLE_REGION_IDS.has(regionID)) {
    return false;
  }

  if (normalizePositiveInteger(solarSystem.factionID, 0)) {
    return false;
  }

  const security = Number(solarSystem.security);
  return Number.isFinite(security) && security <= 0;
}

module.exports = {
  KNOWN_SPACE_SYSTEM_MAX,
  KNOWN_SPACE_SYSTEM_MIN,
  NON_CLAIMABLE_REGION_IDS,
  REGION_TRIGLAVIAN,
  SOLAR_SYSTEM_ZARZAKH,
  isKnownSpaceSolarSystemID,
  isSovereigntyClaimableSolarSystem,
};
