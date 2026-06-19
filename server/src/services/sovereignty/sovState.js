const path = require("path");

const worldData = require(path.join(__dirname, "../../space/worldData"));
const {
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getAllianceRecord,
} = require(path.join(__dirname, "../corporation/corporationState"));
const {
  getAllianceRuntime,
} = require(path.join(__dirname, "../corporation/corporationRuntimeState"));
const {
  ATTRIBUTE_DEV_INDEX_INDUSTRIAL,
  ATTRIBUTE_DEV_INDEX_MILITARY,
  ATTRIBUTE_DEV_INDEX_SOVEREIGNTY,
  CAPITAL_SYSTEM_CHANGE_DELAY_MS,
  CLAIM_DAYS_TO_SECONDS,
  FILETIME_EPOCH_OFFSET,
  FILETIME_TICKS_PER_MILLISECOND,
  PRIME_TIME_CHANGE_DELAY_MS,
  STRUCTURE_SCORE_UPDATED,
  TYPE_INFRASTRUCTURE_HUB,
  TYPE_TERRITORIAL_CLAIM_UNIT,
  VULNERABILITY_WINDOW_BASE_HOURS,
} = require(path.join(__dirname, "./sovConstants"));
const {
  buildDefaultSovereigntyTable,
  cloneValue: cloneStoreValue,
  readSovereigntyTable,
  writeSovereigntyTable,
} = require(path.join(__dirname, "./sovStore"));
const {
  broadcastSolarSystemDevIndexChanged,
  broadcastSolarSystemSovStructuresUpdated,
  broadcastSovereigntyAudioEvent,
  broadcastSovereigntyChanged,
  broadcastSovHubHacked,
} = require(path.join(__dirname, "./sovNotifications"));
const {
  clearAllSovereigntyRelatedStructures,
  clearAllSovereigntyStructureMirrors,
  syncSovereigntyStructureRuntime,
} = require(path.join(__dirname, "./sovSpaceInterop"));

let tableCache = null;
let indexCache = null;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DEV_INDEX_LEVEL_WIDTH = 100000 * 96;
const STRATEGIC_INDEX_DAY_THRESHOLDS = [7, 21, 35, 65, 100];
const MILITARY_INDEX_TO_BONUS = { 1: 0.6, 2: 1.2, 3: 1.7, 4: 2.1, 5: 2.5 };
const INDUSTRIAL_INDEX_TO_BONUS = { 1: 0.6, 2: 1.2, 3: 1.7, 4: 2.1, 5: 2.5 };
const STRATEGIC_INDEX_TO_BONUS = { 1: 0.4, 2: 0.6, 3: 0.8, 4: 0.9, 5: 1.0 };
const CAPITAL_BONUS = 2.0;
const BASE_BONUS = 1.0;
const MIN_OCCUPANCY_BONUS = 1.0;
const MAX_OCCUPANCY_BONUS = 6.0;

function cloneValue(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function valuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeInteger(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.trunc(numericValue);
}

function normalizeNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function normalizePositiveInteger(value, fallback = null) {
  const numericValue = normalizeInteger(value, 0);
  return numericValue > 0 ? numericValue : fallback;
}

function normalizeNullablePositiveInteger(value, fallback = null) {
  if (value === null) {
    return null;
  }
  if (value === undefined) {
    return fallback;
  }
  return normalizePositiveInteger(value, fallback);
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return true;
    }
    if (normalized === "false" || normalized === "0") {
      return false;
    }
  }
  return Boolean(value);
}

function normalizeSpacePoint(value, fallback = null) {
  if (!value || typeof value !== "object") {
    return fallback;
  }
  const x = Number(value.x);
  const y = Number(value.y);
  const z = Number(value.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return fallback;
  }
  return { x, y, z };
}

function normalizeFiletimeString(value, fallback = "0") {
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  return fallback;
}

function normalizeFiletimeBigInt(value, fallback = 0n) {
  try {
    return BigInt(normalizeFiletimeString(value, fallback.toString()));
  } catch (error) {
    return fallback;
  }
}

function filetimeToUnixMs(value, fallback = 0) {
  const filetime = normalizeFiletimeBigInt(value, 0n);
  if (filetime <= FILETIME_EPOCH_OFFSET) {
    return fallback;
  }
  return Number((filetime - FILETIME_EPOCH_OFFSET) / FILETIME_TICKS_PER_MILLISECOND);
}

function unixMsToFiletimeString(value, fallback = "0") {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallback;
  }
  return (
    FILETIME_EPOCH_OFFSET +
    BigInt(Math.trunc(numericValue)) * FILETIME_TICKS_PER_MILLISECOND
  ).toString();
}

function addMillisecondsToCurrentFiletime(milliseconds) {
  const numericMilliseconds = Math.max(0, normalizeInteger(milliseconds, 0));
  return (
    currentFileTime() +
    BigInt(numericMilliseconds) * FILETIME_TICKS_PER_MILLISECOND
  ).toString();
}

function normalizePrimeHour(value, fallback = 0) {
  const hour = normalizeInteger(value, fallback);
  if (hour < 0) {
    return 0;
  }
  if (hour > 23) {
    return 23;
  }
  return hour;
}

function compareNumericStringsDescending(left, right) {
  try {
    const leftValue = BigInt(normalizeFiletimeString(left, "0"));
    const rightValue = BigInt(normalizeFiletimeString(right, "0"));
    if (leftValue > rightValue) {
      return -1;
    }
    if (leftValue < rightValue) {
      return 1;
    }
  } catch (error) {
    const leftValue = normalizeTextNumber(left);
    const rightValue = normalizeTextNumber(right);
    if (leftValue > rightValue) {
      return -1;
    }
    if (leftValue < rightValue) {
      return 1;
    }
  }
  return 0;
}

function normalizeTextNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function normalizeScoresByTeam(value) {
  const normalized = {};
  if (!value || typeof value !== "object") {
    return normalized;
  }
  for (const [teamID, score] of Object.entries(value)) {
    const numericTeamID = normalizeInteger(teamID, 0);
    if (numericTeamID <= 0) {
      continue;
    }
    normalized[String(numericTeamID)] = normalizeNumber(score, 0);
  }
  return normalized;
}

function normalizeStructureRecord(value = {}, solarSystemID, fallbackAllianceID, fallbackCorporationID) {
  const typeID = normalizePositiveInteger(value.typeID, null);
  const itemID = normalizePositiveInteger(value.itemID || value.structureID, null);
  if (!typeID || !itemID) {
    return null;
  }
  const corporationID = normalizePositiveInteger(
    value.corporationID,
    fallbackCorporationID,
  );
  const allianceID = normalizePositiveInteger(value.allianceID, fallbackAllianceID);
  return {
    itemID,
    typeID,
    name: String(value.name || "").trim() || null,
    solarSystemID,
    ownerID: normalizePositiveInteger(value.ownerID, corporationID),
    corporationID,
    allianceID,
    defenseMultiplier: normalizeNumber(value.defenseMultiplier, 1),
    campaignEventType: normalizeInteger(value.campaignEventType, 0),
    campaignStartTime: normalizeFiletimeString(value.campaignStartTime, "0"),
    campaignOccupancyLevel: normalizeNumber(value.campaignOccupancyLevel, 1),
    campaignScoresByTeam: normalizeScoresByTeam(value.campaignScoresByTeam),
    vulnerableStartTime: normalizeFiletimeString(value.vulnerableStartTime, "0"),
    vulnerableEndTime: normalizeFiletimeString(value.vulnerableEndTime, "0"),
    vulnerabilityOccupancyLevel: normalizeNumber(
      value.vulnerabilityOccupancyLevel,
      1,
    ),
    isCapital: normalizeBoolean(value.isCapital, false),
    position: normalizeSpacePoint(value.position, null),
  };
}

function normalizeDevIndices(value = {}) {
  const militaryPoints = Math.max(0, normalizeInteger(value.militaryPoints, 0));
  const industrialPoints = Math.max(0, normalizeInteger(value.industrialPoints, 0));
  const claimedForDays = Math.max(
    0,
    normalizeInteger(value.claimedForDays ?? value.claimedFor, 0),
  );
  const militaryIncreasing = normalizeBoolean(value.militaryIncreasing, false);
  const industrialIncreasing = normalizeBoolean(value.industrialIncreasing, false);
  return {
    militaryPoints,
    industrialPoints,
    claimedForDays,
    militaryIncreasing,
    industrialIncreasing,
  };
}

function getOperationalIndexLevel(points) {
  const normalizedPoints = Math.max(0, normalizeInteger(points, 0));
  if (normalizedPoints >= DEV_INDEX_LEVEL_WIDTH * 6) {
    return 5;
  }
  for (let level = 0; level <= 5; level += 1) {
    if (normalizedPoints < DEV_INDEX_LEVEL_WIDTH * (level + 1)) {
      return level;
    }
  }
  return 5;
}

function getStrategicIndexLevel(claimedForDays) {
  const normalizedDays = Math.max(0, normalizeInteger(claimedForDays, 0));
  for (let index = STRATEGIC_INDEX_DAY_THRESHOLDS.length - 1; index >= 0; index -= 1) {
    if (normalizedDays >= STRATEGIC_INDEX_DAY_THRESHOLDS[index]) {
      return index + 1;
    }
  }
  return 0;
}

function getSystemDefenseMultiplier(system = null, isCapital = false) {
  const devIndices = normalizeDevIndices(system && system.devIndices);
  const militaryLevel = getOperationalIndexLevel(devIndices.militaryPoints);
  const industrialLevel = getOperationalIndexLevel(devIndices.industrialPoints);
  const strategicLevel = getStrategicIndexLevel(devIndices.claimedForDays);
  const totalBonus =
    BASE_BONUS +
    (MILITARY_INDEX_TO_BONUS[militaryLevel] || 0) +
    (INDUSTRIAL_INDEX_TO_BONUS[industrialLevel] || 0) +
    (STRATEGIC_INDEX_TO_BONUS[strategicLevel] || 0) +
    (isCapital ? CAPITAL_BONUS : 0);
  return Math.max(MIN_OCCUPANCY_BONUS, Math.min(MAX_OCCUPANCY_BONUS, totalBonus));
}

function applyAllianceTimedTransitions(allianceState) {
  if (!allianceState || typeof allianceState !== "object") {
    return false;
  }
  let changed = false;
  const now = currentFileTime();
  const primeValidAfter = normalizeFiletimeBigInt(
    allianceState.primeInfo && allianceState.primeInfo.newPrimeHourValidAfter,
    0n,
  );
  if (
    allianceState.primeInfo &&
    normalizePrimeHour(allianceState.primeInfo.newPrimeHour, 0) >= 0 &&
    primeValidAfter > 0n &&
    primeValidAfter <= now
  ) {
    allianceState.primeInfo.currentPrimeHour = normalizePrimeHour(
      allianceState.primeInfo.newPrimeHour,
      allianceState.primeInfo.currentPrimeHour,
    );
    allianceState.primeInfo.newPrimeHour = allianceState.primeInfo.currentPrimeHour;
    allianceState.primeInfo.newPrimeHourValidAfter = "0";
    changed = true;
  }
  const capitalValidAfter = normalizeFiletimeBigInt(
    allianceState.capitalInfo && allianceState.capitalInfo.newCapitalSystemValidAfter,
    0n,
  );
  if (
    allianceState.capitalInfo &&
    allianceState.capitalInfo.newCapitalSystem &&
    capitalValidAfter > 0n &&
    capitalValidAfter <= now
  ) {
    allianceState.capitalInfo.currentCapitalSystem = normalizePositiveInteger(
      allianceState.capitalInfo.newCapitalSystem,
      allianceState.capitalInfo.currentCapitalSystem,
    );
    allianceState.capitalInfo.newCapitalSystem = null;
    allianceState.capitalInfo.newCapitalSystemValidAfter = "0";
    changed = true;
  }
  return changed;
}

function getStaticSystemLocationInfo(solarSystemID) {
  const staticSystem =
    worldData.ensureLoaded().solarSystemsById.get(Number(solarSystemID)) || null;
  return {
    solarSystemID: normalizePositiveInteger(
      staticSystem && staticSystem.solarSystemID,
      normalizePositiveInteger(solarSystemID, null),
    ),
    constellationID: normalizePositiveInteger(
      staticSystem && staticSystem.constellationID,
      null,
    ),
    regionID: normalizePositiveInteger(staticSystem && staticSystem.regionID, null),
  };
}

function buildDerivedCurrentDataRecord(system = null, solarSystemID = null) {
  const locationInfo = getStaticSystemLocationInfo(
    solarSystemID || (system && system.solarSystemID),
  );
  const ownerID = normalizePositiveInteger(system && system.allianceID, null);
  return {
    locationID: locationInfo.solarSystemID,
    solarSystemID: locationInfo.solarSystemID,
    constellationID: locationInfo.constellationID,
    regionID: locationInfo.regionID,
    ownerID,
    allianceID: ownerID,
    corporationID: normalizePositiveInteger(system && system.corporationID, null),
    claimStructureID: normalizePositiveInteger(
      system && system.claimStructureID,
      null,
    ),
    infrastructureHubID: normalizePositiveInteger(
      system && system.infrastructureHubID,
      null,
    ),
    stationID: null,
    claimTime: normalizeFiletimeString(system && system.claimTime, "0"),
  };
}

function normalizeCurrentDataRecord(value = {}, solarSystemID, system = null) {
  const fallback = buildDerivedCurrentDataRecord(system, solarSystemID);
  const ownerSource = Object.prototype.hasOwnProperty.call(value, "ownerID")
    ? value.ownerID
    : Object.prototype.hasOwnProperty.call(value, "allianceID")
      ? value.allianceID
      : fallback.ownerID;
  const ownerID = normalizeNullablePositiveInteger(
    ownerSource,
    fallback.ownerID,
  );
  const allianceSource = Object.prototype.hasOwnProperty.call(value, "allianceID")
    ? value.allianceID
    : Object.prototype.hasOwnProperty.call(value, "ownerID")
      ? value.ownerID
      : ownerID;
  const allianceID = normalizeNullablePositiveInteger(
    allianceSource,
    ownerID,
  );
  return {
    locationID: normalizePositiveInteger(value.locationID, fallback.locationID),
    solarSystemID: normalizePositiveInteger(value.solarSystemID, fallback.solarSystemID),
    constellationID: normalizePositiveInteger(
      value.constellationID,
      fallback.constellationID,
    ),
    regionID: normalizePositiveInteger(value.regionID, fallback.regionID),
    ownerID,
    allianceID,
    corporationID: normalizePositiveInteger(
      value.corporationID,
      fallback.corporationID,
    ),
    claimStructureID: normalizePositiveInteger(
      value.claimStructureID,
      fallback.claimStructureID,
    ),
    infrastructureHubID: normalizePositiveInteger(
      value.infrastructureHubID,
      fallback.infrastructureHubID,
    ),
    stationID: normalizePositiveInteger(value.stationID, fallback.stationID),
    claimTime: normalizeFiletimeString(value.claimTime, fallback.claimTime),
  };
}

function normalizeRecentActivityRecord(value = {}, solarSystemID, system = null) {
  const locationInfo = getStaticSystemLocationInfo(
    solarSystemID || (system && system.solarSystemID),
  );
  const ownerSource = Object.prototype.hasOwnProperty.call(value, "ownerID")
    ? value.ownerID
    : Object.prototype.hasOwnProperty.call(value, "allianceID")
      ? value.allianceID
      : normalizePositiveInteger(system && system.allianceID, null);
  return {
    solarSystemID: normalizePositiveInteger(
      value.solarSystemID,
      locationInfo.solarSystemID,
    ),
    ownerID: normalizeNullablePositiveInteger(
      ownerSource,
      normalizePositiveInteger(system && system.allianceID, null),
    ),
    oldOwnerID: normalizeNullablePositiveInteger(value.oldOwnerID, null),
    stationID: normalizeNullablePositiveInteger(value.stationID, null),
    changeTime: normalizeFiletimeString(value.changeTime, "0"),
  };
}

function buildDefaultAllianceState(allianceID) {
  const runtime = allianceID ? getAllianceRuntime(allianceID) || {} : {};
  return {
    allianceID: normalizePositiveInteger(allianceID, null),
    primeInfo: {
      currentPrimeHour: normalizeInteger(
        runtime.primeInfo && runtime.primeInfo.currentPrimeHour,
        0,
      ),
      newPrimeHour: normalizeInteger(runtime.primeInfo && runtime.primeInfo.newPrimeHour, 0),
      newPrimeHourValidAfter: normalizeFiletimeString(
        runtime.primeInfo && runtime.primeInfo.newPrimeHourValidAfter,
        "0",
      ),
    },
    capitalInfo: {
      currentCapitalSystem: normalizePositiveInteger(
        runtime.capitalInfo && runtime.capitalInfo.currentCapitalSystem,
        null,
      ),
      newCapitalSystem: normalizePositiveInteger(
        runtime.capitalInfo && runtime.capitalInfo.newCapitalSystem,
        null,
      ),
      newCapitalSystemValidAfter: normalizeFiletimeString(
        runtime.capitalInfo && runtime.capitalInfo.newCapitalSystemValidAfter,
        "0",
      ),
    },
  };
}

function normalizeAllianceState(value = {}, allianceID) {
  const fallback = buildDefaultAllianceState(allianceID);
  return {
    allianceID: normalizePositiveInteger(allianceID, fallback.allianceID),
    primeInfo: {
      currentPrimeHour: normalizeInteger(
        value.primeInfo && value.primeInfo.currentPrimeHour,
        fallback.primeInfo.currentPrimeHour,
      ),
      newPrimeHour: normalizeInteger(
        value.primeInfo && value.primeInfo.newPrimeHour,
        fallback.primeInfo.newPrimeHour,
      ),
      newPrimeHourValidAfter: normalizeFiletimeString(
        value.primeInfo && value.primeInfo.newPrimeHourValidAfter,
        fallback.primeInfo.newPrimeHourValidAfter,
      ),
    },
    capitalInfo: {
      currentCapitalSystem: normalizePositiveInteger(
        value.capitalInfo && value.capitalInfo.currentCapitalSystem,
        fallback.capitalInfo.currentCapitalSystem,
      ),
      newCapitalSystem: normalizePositiveInteger(
        value.capitalInfo && value.capitalInfo.newCapitalSystem,
        fallback.capitalInfo.newCapitalSystem,
      ),
      newCapitalSystemValidAfter: normalizeFiletimeString(
        value.capitalInfo && value.capitalInfo.newCapitalSystemValidAfter,
        fallback.capitalInfo.newCapitalSystemValidAfter,
      ),
    },
  };
}

function normalizeSystemState(value = {}, solarSystemID) {
  const numericSolarSystemID = normalizePositiveInteger(solarSystemID, 0) || 0;
  const hasAllianceIDField = Object.prototype.hasOwnProperty.call(value, "allianceID");
  const hasCorporationIDField = Object.prototype.hasOwnProperty.call(
    value,
    "corporationID",
  );
  const hasClaimStructureField = Object.prototype.hasOwnProperty.call(
    value,
    "claimStructureID",
  );
  const hasInfrastructureHubField = Object.prototype.hasOwnProperty.call(
    value,
    "infrastructureHubID",
  );
  let allianceID = normalizePositiveInteger(value.allianceID, null);
  let corporationID = normalizePositiveInteger(value.corporationID, null);
  let structures = Array.isArray(value.structures)
    ? value.structures
        .map((entry) =>
          normalizeStructureRecord(entry, numericSolarSystemID, allianceID, corporationID),
        )
        .filter(Boolean)
    : [];
  const tcuStructure = structures.find(
    (entry) => entry.typeID === TYPE_TERRITORIAL_CLAIM_UNIT,
  );
  const iHubStructure = structures.find(
    (entry) => entry.typeID === TYPE_INFRASTRUCTURE_HUB,
  );
  if (!hasAllianceIDField && !allianceID) {
    allianceID = normalizePositiveInteger(
      tcuStructure && tcuStructure.allianceID,
      normalizePositiveInteger(iHubStructure && iHubStructure.allianceID, null),
    );
  }
  if (!hasCorporationIDField && !corporationID) {
    corporationID = normalizePositiveInteger(
      iHubStructure && iHubStructure.corporationID,
      normalizePositiveInteger(tcuStructure && tcuStructure.corporationID, null),
    );
  }
  if (allianceID || corporationID) {
    structures = structures
      .map((entry) =>
        normalizeStructureRecord(entry, numericSolarSystemID, allianceID, corporationID),
      )
      .filter(Boolean);
  }
  return {
    solarSystemID: numericSolarSystemID,
    allianceID,
    corporationID,
    claimStructureID: hasClaimStructureField
      ? normalizePositiveInteger(value.claimStructureID, null)
      : normalizePositiveInteger(value.claimStructureID, tcuStructure && tcuStructure.itemID),
    infrastructureHubID: hasInfrastructureHubField
      ? normalizePositiveInteger(value.infrastructureHubID, null)
      : normalizePositiveInteger(
          value.infrastructureHubID,
          iHubStructure && iHubStructure.itemID,
        ),
    claimTime: normalizeFiletimeString(value.claimTime, "0"),
    fuelAccessGroupID: normalizePositiveInteger(value.fuelAccessGroupID, null),
    devIndices: normalizeDevIndices(value.devIndices),
    structures,
    recentActivity: Array.isArray(value.recentActivity)
      ? value.recentActivity
          .map((entry) =>
            normalizeRecentActivityRecord(
              entry,
              numericSolarSystemID,
              value,
            ),
          )
          .filter(Boolean)
      : [],
    currentData: Array.isArray(value.currentData)
      ? value.currentData
          .map((entry) =>
            normalizeCurrentDataRecord(
              entry,
              numericSolarSystemID,
              value,
            ),
          )
          .filter(Boolean)
      : [],
  };
}

function buildDefaultTable() {
  return buildDefaultSovereigntyTable();
}

function normalizeTable(table = {}) {
  const normalized = buildDefaultTable();
  normalized._meta.updatedAt =
    table && table._meta && table._meta.updatedAt ? table._meta.updatedAt : null;
  normalized.hubs = cloneStoreValue(table && table.hubs ? table.hubs : {});
  normalized.skyhooks = cloneStoreValue(table && table.skyhooks ? table.skyhooks : {});
  normalized.mercenaryDens = cloneStoreValue(
    table && table.mercenaryDens ? table.mercenaryDens : {},
  );
  normalized.resources = cloneStoreValue(
    table && table.resources ? table.resources : normalized.resources,
  );
  for (const [allianceID, record] of Object.entries(table.alliances || {})) {
    const numericAllianceID = normalizePositiveInteger(allianceID, null);
    if (!numericAllianceID || !getAllianceRecord(numericAllianceID)) {
      continue;
    }
    normalized.alliances[String(numericAllianceID)] = normalizeAllianceState(
      record,
      numericAllianceID,
    );
  }
  for (const [solarSystemID, record] of Object.entries(table.systems || {})) {
    const numericSolarSystemID = normalizePositiveInteger(solarSystemID, null);
    if (!numericSolarSystemID) {
      continue;
    }
    normalized.systems[String(numericSolarSystemID)] = normalizeSystemState(
      record,
      numericSolarSystemID,
    );
  }
  return normalized;
}

function applyTableTimedTransitions(table) {
  let changed = false;
  for (const allianceState of Object.values((table && table.alliances) || {})) {
    if (applyAllianceTimedTransitions(allianceState)) {
      changed = true;
    }
  }
  return changed;
}

function getAlliancePrimeHourFromIndexes(allianceID, primeHourByAllianceID) {
  const numericAllianceID = normalizePositiveInteger(allianceID, null);
  if (!numericAllianceID) {
    return 0;
  }
  if (primeHourByAllianceID.has(numericAllianceID)) {
    return primeHourByAllianceID.get(numericAllianceID);
  }
  return buildDefaultAllianceState(numericAllianceID).primeInfo.currentPrimeHour;
}

function buildVulnerabilityWindow(primeHour, defenseMultiplier, nowMs = Date.now()) {
  const centeredPrimeHour = normalizePrimeHour(primeHour, 0);
  const safeMultiplier = Math.max(
    MIN_OCCUPANCY_BONUS,
    normalizeNumber(defenseMultiplier, BASE_BONUS),
  );
  const durationMs = Math.max(
    HOUR_MS,
    Math.round((VULNERABILITY_WINDOW_BASE_HOURS * HOUR_MS) / safeMultiplier),
  );
  const referenceDate = new Date(Math.max(0, normalizeInteger(nowMs, Date.now())));
  let centerMs = Date.UTC(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    referenceDate.getUTCDate(),
    centeredPrimeHour,
    0,
    0,
    0,
  );
  let startMs = centerMs - Math.floor(durationMs / 2);
  let endMs = startMs + durationMs;
  if (nowMs > endMs) {
    startMs += DAY_MS;
    endMs += DAY_MS;
  }
  return {
    startTime: unixMsToFiletimeString(startMs),
    endTime: unixMsToFiletimeString(endMs),
  };
}

function buildStructureSnapshot(
  structure,
  system,
  capitalSystemByAllianceID,
  primeHourByAllianceID,
  nowMs = Date.now(),
) {
  const allianceID = normalizePositiveInteger(structure && structure.allianceID, null);
  const isCapital =
    normalizePositiveInteger(structure && structure.typeID, null) ===
      TYPE_INFRASTRUCTURE_HUB &&
    allianceID &&
    capitalSystemByAllianceID.get(allianceID) ===
      normalizePositiveInteger(system && system.solarSystemID, null);
  const defenseMultiplier = getSystemDefenseMultiplier(system, isCapital);
  let vulnerableStartTime = normalizeFiletimeString(
    structure && structure.vulnerableStartTime,
    "0",
  );
  let vulnerableEndTime = normalizeFiletimeString(
    structure && structure.vulnerableEndTime,
    "0",
  );
  if (
    allianceID &&
    (vulnerableStartTime === "0" || vulnerableEndTime === "0")
  ) {
    const vulnerabilityWindow = buildVulnerabilityWindow(
      getAlliancePrimeHourFromIndexes(allianceID, primeHourByAllianceID),
      defenseMultiplier,
      nowMs,
    );
    vulnerableStartTime = vulnerabilityWindow.startTime;
    vulnerableEndTime = vulnerabilityWindow.endTime;
  }
  return {
    ...cloneValue(structure),
    defenseMultiplier,
    campaignOccupancyLevel: defenseMultiplier,
    vulnerabilityOccupancyLevel: defenseMultiplier,
    vulnerableStartTime,
    vulnerableEndTime,
    isCapital,
  };
}

function buildIndexes() {
  const systemsByAllianceID = new Map();
  const allAllianceSystems = [];
  const allDevelopmentIndices = [];
  const currentSovDataByLocationID = new Map();
  const recentSovActivity = [];
  const claimsBySolarSystemID = new Map();
  const infrastructureHubClaimsBySolarSystemID = new Map();
  const structureSnapshotsBySolarSystemID = new Map();
  const allianceSovRowsByAllianceID = new Map();
  const capitalSystemByAllianceID = new Map();
  const primeHourByAllianceID = new Map();
  const staticSystemIDs = new Set();
  const nowMs = Date.now();
  let nextInvalidationAtMs = Number.POSITIVE_INFINITY;

  const appendCurrentDataRows = (locationID, rows) => {
    const numericLocationID = normalizePositiveInteger(locationID, null);
    if (!numericLocationID || !Array.isArray(rows) || rows.length === 0) {
      return;
    }
    if (!currentSovDataByLocationID.has(numericLocationID)) {
      currentSovDataByLocationID.set(numericLocationID, []);
    }
    currentSovDataByLocationID.get(numericLocationID).push(...rows);
  };

  const getAllianceRows = (allianceID) => {
    const numericAllianceID = normalizePositiveInteger(allianceID, null);
    if (!numericAllianceID) {
      return null;
    }
    if (!allianceSovRowsByAllianceID.has(numericAllianceID)) {
      allianceSovRowsByAllianceID.set(numericAllianceID, {
        tcuRows: [],
        iHubRows: [],
        campaignScoreRows: [],
      });
    }
    return allianceSovRowsByAllianceID.get(numericAllianceID);
  };

  const getAllianceStructureRowID = (system, structure, hasInfrastructureHubStructure) => {
    const structureID = normalizePositiveInteger(
      structure && structure.itemID,
      null,
    );
    if (
      normalizePositiveInteger(structure && structure.typeID, null) !==
      TYPE_TERRITORIAL_CLAIM_UNIT
    ) {
      return structureID;
    }
    if (!hasInfrastructureHubStructure) {
      return structureID;
    }
    return normalizePositiveInteger(
      system && system.infrastructureHubID,
      structureID,
    );
  };

  for (const allianceState of Object.values(tableCache.alliances || {})) {
    const allianceID = normalizePositiveInteger(allianceState && allianceState.allianceID, null);
    if (!allianceID) {
      continue;
    }
    primeHourByAllianceID.set(
      allianceID,
      normalizePrimeHour(
        allianceState.primeInfo && allianceState.primeInfo.currentPrimeHour,
        0,
      ),
    );
    const capitalSystemID = normalizePositiveInteger(
      allianceState.capitalInfo && allianceState.capitalInfo.currentCapitalSystem,
      null,
    );
    if (capitalSystemID) {
      capitalSystemByAllianceID.set(allianceID, capitalSystemID);
    }
    const pendingPrimeMs = filetimeToUnixMs(
      allianceState.primeInfo && allianceState.primeInfo.newPrimeHourValidAfter,
      0,
    );
    if (pendingPrimeMs > nowMs) {
      nextInvalidationAtMs = Math.min(nextInvalidationAtMs, pendingPrimeMs);
    }
    const pendingCapitalMs = filetimeToUnixMs(
      allianceState.capitalInfo && allianceState.capitalInfo.newCapitalSystemValidAfter,
      0,
    );
    if (pendingCapitalMs > nowMs) {
      nextInvalidationAtMs = Math.min(nextInvalidationAtMs, pendingCapitalMs);
    }
  }

  for (const system of Object.values(tableCache.systems || {}).sort(
    (left, right) => left.solarSystemID - right.solarSystemID,
  )) {
    if (system.allianceID) {
      if (!systemsByAllianceID.has(system.allianceID)) {
        systemsByAllianceID.set(system.allianceID, []);
      }
      const systemRecord = {
        solarSystemID: system.solarSystemID,
        allianceID: system.allianceID,
      };
      systemsByAllianceID.get(system.allianceID).push(systemRecord);
      allAllianceSystems.push(systemRecord);
      claimsBySolarSystemID.set(system.solarSystemID, {
        claimStructureID: system.claimStructureID,
        corporationID: system.corporationID,
        allianceID: system.allianceID,
      });
    }
    if (system.infrastructureHubID && system.allianceID) {
      infrastructureHubClaimsBySolarSystemID.set(system.solarSystemID, {
        hubID: system.infrastructureHubID,
        corporationID: system.corporationID,
        allianceID: system.allianceID,
        claimTime: system.claimTime,
      });
    }
    allDevelopmentIndices.push({
      solarSystemID: system.solarSystemID,
      militaryPoints: system.devIndices.militaryPoints,
      industrialPoints: system.devIndices.industrialPoints,
      claimedFor: system.devIndices.claimedForDays,
    });
    if (system.recentActivity.length > 0) {
      recentSovActivity.push(...system.recentActivity);
    }
    const structureSnapshots = (system.structures || [])
      .map((structure) =>
        buildStructureSnapshot(
          structure,
          system,
          capitalSystemByAllianceID,
          primeHourByAllianceID,
          nowMs,
        ),
      )
      .sort((left, right) => left.itemID - right.itemID);
    const hasInfrastructureHubStructure = structureSnapshots.some(
      (structure) => structure.typeID === TYPE_INFRASTRUCTURE_HUB,
    );
    structureSnapshotsBySolarSystemID.set(system.solarSystemID, structureSnapshots);
    for (const structure of structureSnapshots) {
      const campaignStartMs = filetimeToUnixMs(structure.campaignStartTime, 0);
      if (campaignStartMs > nowMs) {
        nextInvalidationAtMs = Math.min(nextInvalidationAtMs, campaignStartMs);
      }
      const vulnerableStartMs = filetimeToUnixMs(structure.vulnerableStartTime, 0);
      if (vulnerableStartMs > nowMs) {
        nextInvalidationAtMs = Math.min(nextInvalidationAtMs, vulnerableStartMs);
      }
      const vulnerableEndMs = filetimeToUnixMs(structure.vulnerableEndTime, 0);
      if (vulnerableEndMs > nowMs) {
        nextInvalidationAtMs = Math.min(nextInvalidationAtMs, vulnerableEndMs);
      }
      const allianceRows = getAllianceRows(structure.allianceID);
      if (!allianceRows) {
        continue;
      }
      const allianceStructureRowID = getAllianceStructureRowID(
        system,
        structure,
        hasInfrastructureHubStructure,
      );
      const baseRow = {
        structureID: allianceStructureRowID,
        solarSystemID: system.solarSystemID,
        campaignStartTime: structure.campaignStartTime,
        campaignEventType: structure.campaignEventType,
        campaignOccupancyLevel: structure.defenseMultiplier,
        vulnerableStartTime: structure.vulnerableStartTime,
        vulnerableEndTime: structure.vulnerableEndTime,
        vulnerabilityOccupancyLevel: structure.defenseMultiplier,
      };
      if (structure.typeID === TYPE_TERRITORIAL_CLAIM_UNIT) {
        allianceRows.tcuRows.push(baseRow);
      } else if (structure.typeID === TYPE_INFRASTRUCTURE_HUB) {
        allianceRows.iHubRows.push({
          ...baseRow,
          corporationID: structure.corporationID,
        });
      }
      for (const [teamID, score] of Object.entries(structure.campaignScoresByTeam || {})) {
        allianceRows.campaignScoreRows.push({
          sourceItemID: allianceStructureRowID,
          teamID: normalizeInteger(teamID, 0),
          score: normalizeNumber(score, 0),
        });
      }
    }
  }

  for (const allianceSystems of systemsByAllianceID.values()) {
    allianceSystems.sort((left, right) => left.solarSystemID - right.solarSystemID);
  }
  allAllianceSystems.sort((left, right) => left.solarSystemID - right.solarSystemID);
  allDevelopmentIndices.sort((left, right) => left.solarSystemID - right.solarSystemID);
  for (const rows of allianceSovRowsByAllianceID.values()) {
    rows.tcuRows.sort(
      (left, right) =>
        left.solarSystemID - right.solarSystemID ||
        left.structureID - right.structureID,
    );
    rows.iHubRows.sort(
      (left, right) =>
        left.solarSystemID - right.solarSystemID ||
        left.structureID - right.structureID,
    );
    rows.campaignScoreRows.sort(
      (left, right) =>
        left.sourceItemID - right.sourceItemID ||
        left.teamID - right.teamID,
    );
  }

  for (const staticSystem of [...worldData.ensureLoaded().solarSystems].sort(
    (left, right) => Number(left.solarSystemID) - Number(right.solarSystemID),
  )) {
    staticSystemIDs.add(Number(staticSystem.solarSystemID) || 0);
    const systemState = tableCache.systems[String(staticSystem.solarSystemID)] || null;
    const rows =
      systemState && systemState.currentData.length > 0
        ? systemState.currentData
        : [buildDerivedCurrentDataRecord(systemState, staticSystem.solarSystemID)];
    appendCurrentDataRows(staticSystem.solarSystemID, rows);
    appendCurrentDataRows(staticSystem.constellationID, rows);
    appendCurrentDataRows(staticSystem.regionID, rows);
  }

  for (const system of Object.values(tableCache.systems || {})) {
    if (staticSystemIDs.has(system.solarSystemID)) {
      continue;
    }
    const rows =
      system.currentData.length > 0
        ? system.currentData
        : [buildDerivedCurrentDataRecord(system, system.solarSystemID)];
    appendCurrentDataRows(system.solarSystemID, rows);
    for (const row of rows) {
      appendCurrentDataRows(row.constellationID, [row]);
      appendCurrentDataRows(row.regionID, [row]);
    }
  }

  for (const rows of currentSovDataByLocationID.values()) {
    rows.sort((left, right) => {
      const locationDelta =
        Number(left.locationID || 0) - Number(right.locationID || 0);
      if (locationDelta !== 0) {
        return locationDelta;
      }
      const stationDelta =
        Number(left.stationID || 0) - Number(right.stationID || 0);
      if (stationDelta !== 0) {
        return stationDelta;
      }
      return Number(left.ownerID || 0) - Number(right.ownerID || 0);
    });
  }

  recentSovActivity.sort((left, right) => {
    const timeDelta = compareNumericStringsDescending(
      left.changeTime,
      right.changeTime,
    );
    if (timeDelta !== 0) {
      return timeDelta;
    }
    return Number(left.solarSystemID || 0) - Number(right.solarSystemID || 0);
  });

  indexCache = {
    systemsByAllianceID,
    allAllianceSystems,
    allDevelopmentIndices,
    currentSovDataByLocationID,
    recentSovActivity,
    claimsBySolarSystemID,
    infrastructureHubClaimsBySolarSystemID,
    structureSnapshotsBySolarSystemID,
    allianceSovRowsByAllianceID,
    capitalSystemByAllianceID,
    primeHourByAllianceID,
    debugSnapshot: {
      updatedAt:
        tableCache && tableCache._meta ? tableCache._meta.updatedAt || null : null,
      allianceCount: Object.keys((tableCache && tableCache.alliances) || {}).length,
      systemCount: Object.keys((tableCache && tableCache.systems) || {}).length,
      cachedAllianceSystemCount: allAllianceSystems.length,
      cachedCurrentSovLocationCount: currentSovDataByLocationID.size,
      cachedRecentActivityCount: recentSovActivity.length,
      cachedClaimCount: claimsBySolarSystemID.size,
      cachedHubClaimCount: infrastructureHubClaimsBySolarSystemID.size,
      cachedStructureSystemCount: structureSnapshotsBySolarSystemID.size,
      cachedAllianceRowCount: allianceSovRowsByAllianceID.size,
      nextInvalidationAtMs: Number.isFinite(nextInvalidationAtMs)
        ? Math.trunc(nextInvalidationAtMs)
        : null,
      capitalSystemByAllianceID: Object.fromEntries(
        [...capitalSystemByAllianceID.entries()].sort((left, right) => left[0] - right[0]),
      ),
    },
    generatedAtMs: nowMs,
    nextInvalidationAtMs: Number.isFinite(nextInvalidationAtMs)
      ? Math.trunc(nextInvalidationAtMs)
      : null,
  };
}

function hydrateTable(rawTable) {
  tableCache = normalizeTable(rawTable);
  if (applyTableTimedTransitions(tableCache)) {
    tableCache = writeSovereigntyTable(tableCache);
  }
  buildIndexes();
  return tableCache;
}

function ensureLoaded() {
  const rawTable = readSovereigntyTable();
  const updatedAt =
    rawTable && rawTable._meta ? rawTable._meta.updatedAt || null : null;
  if (tableCache && tableCache._meta && tableCache._meta.updatedAt === updatedAt) {
    if (
      indexCache &&
      indexCache.nextInvalidationAtMs &&
      Date.now() >= indexCache.nextInvalidationAtMs
    ) {
      if (applyTableTimedTransitions(tableCache)) {
        tableCache = writeSovereigntyTable(tableCache);
      }
      buildIndexes();
    }
    return tableCache;
  }
  return hydrateTable(rawTable);
}

function persist() {
  ensureLoaded();
  tableCache = writeSovereigntyTable(tableCache);
  if (applyTableTimedTransitions(tableCache)) {
    tableCache = writeSovereigntyTable(tableCache);
  }
  buildIndexes();
  return tableCache;
}

function ensureAllianceState(allianceID) {
  ensureLoaded();
  const numericAllianceID = normalizePositiveInteger(allianceID, null);
  if (!numericAllianceID) {
    return buildDefaultAllianceState(null);
  }
  const key = String(numericAllianceID);
  if (!tableCache.alliances[key]) {
    tableCache.alliances[key] = buildDefaultAllianceState(numericAllianceID);
    persist();
  }
  return tableCache.alliances[key];
}

function getResolvedAllianceState(allianceID) {
  const allianceState = ensureAllianceState(allianceID);
  if (applyAllianceTimedTransitions(allianceState)) {
    persist();
  }
  return allianceState;
}

function getAllianceSovereigntySnapshot(allianceID) {
  return cloneValue(getResolvedAllianceState(allianceID));
}

function getAlliancePrimeInfo(allianceID) {
  return cloneValue(getResolvedAllianceState(allianceID).primeInfo);
}

function setAlliancePrimeHour(allianceID, hour) {
  const allianceState = getResolvedAllianceState(allianceID);
  const nextHour = normalizePrimeHour(hour, allianceState.primeInfo.currentPrimeHour);
  if (
    allianceState.primeInfo.currentPrimeHour === nextHour &&
    normalizeFiletimeBigInt(allianceState.primeInfo.newPrimeHourValidAfter, 0n) <= 0n
  ) {
    return cloneValue(allianceState.primeInfo);
  }
  allianceState.primeInfo.newPrimeHour = nextHour;
  allianceState.primeInfo.newPrimeHourValidAfter = addMillisecondsToCurrentFiletime(
    PRIME_TIME_CHANGE_DELAY_MS,
  );
  persist();
  return cloneValue(allianceState.primeInfo);
}

function getAllianceCapitalInfo(allianceID) {
  return cloneValue(getResolvedAllianceState(allianceID).capitalInfo);
}

function setAllianceCapitalSystem(allianceID, solarSystemID) {
  const allianceState = getResolvedAllianceState(allianceID);
  const nextCapitalSystemID = normalizePositiveInteger(
    solarSystemID,
    null,
  );
  if (!nextCapitalSystemID) {
    return cloneValue(allianceState.capitalInfo);
  }
  if (
    allianceState.capitalInfo.currentCapitalSystem === nextCapitalSystemID &&
    !allianceState.capitalInfo.newCapitalSystem
  ) {
    return cloneValue(allianceState.capitalInfo);
  }
  allianceState.capitalInfo.newCapitalSystem = nextCapitalSystemID;
  allianceState.capitalInfo.newCapitalSystemValidAfter = addMillisecondsToCurrentFiletime(
    CAPITAL_SYSTEM_CHANGE_DELAY_MS,
  );
  persist();
  return cloneValue(allianceState.capitalInfo);
}

function cancelAllianceCapitalTransition(allianceID) {
  const allianceState = getResolvedAllianceState(allianceID);
  allianceState.capitalInfo.newCapitalSystem = null;
  allianceState.capitalInfo.newCapitalSystemValidAfter = "0";
  persist();
  return cloneValue(allianceState.capitalInfo);
}

function upsertAllianceState(allianceID, patch = {}) {
  ensureLoaded();
  const numericAllianceID = normalizePositiveInteger(allianceID, null);
  if (!numericAllianceID) {
    return null;
  }
  const current = cloneValue(ensureAllianceState(numericAllianceID));
  const next = normalizeAllianceState(
    {
      ...current,
      ...cloneValue(patch),
      primeInfo:
        patch.primeInfo !== undefined
          ? { ...cloneValue(current.primeInfo), ...cloneValue(patch.primeInfo) }
          : cloneValue(current.primeInfo),
      capitalInfo:
        patch.capitalInfo !== undefined
          ? { ...cloneValue(current.capitalInfo), ...cloneValue(patch.capitalInfo) }
          : cloneValue(current.capitalInfo),
    },
    numericAllianceID,
  );
  tableCache.alliances[String(numericAllianceID)] = next;
  persist();
  return cloneValue(next);
}

function getSystemState(solarSystemID) {
  ensureLoaded();
  const numericSolarSystemID = normalizePositiveInteger(solarSystemID, null);
  if (!numericSolarSystemID) {
    return null;
  }
  return tableCache.systems[String(numericSolarSystemID)] || null;
}

function buildOwnershipChangeActivity(currentSystem, nextSystem) {
  return {
    solarSystemID: normalizePositiveInteger(nextSystem && nextSystem.solarSystemID, null),
    ownerID: normalizeNullablePositiveInteger(nextSystem && nextSystem.allianceID, null),
    oldOwnerID: normalizeNullablePositiveInteger(currentSystem && currentSystem.allianceID, null),
    stationID: null,
    changeTime: currentFileTime().toString(),
  };
}

function collectSystemAllianceIDs(currentSystem, nextSystem, structureSnapshots = []) {
  const allianceIDs = new Set();
  for (const candidate of [
    currentSystem && currentSystem.allianceID,
    nextSystem && nextSystem.allianceID,
    ...(currentSystem && Array.isArray(currentSystem.structures)
      ? currentSystem.structures.map((entry) => entry && entry.allianceID)
      : []),
    ...(nextSystem && Array.isArray(nextSystem.structures)
      ? nextSystem.structures.map((entry) => entry && entry.allianceID)
      : []),
    ...(Array.isArray(structureSnapshots)
      ? structureSnapshots.map((entry) => entry && entry.allianceID)
      : []),
  ]) {
    const numericAllianceID = normalizePositiveInteger(candidate, null);
    if (numericAllianceID) {
      allianceIDs.add(numericAllianceID);
    }
  }
  return [...allianceIDs].sort((left, right) => left - right);
}

function upsertSystemState(solarSystemID, patch = {}, options = {}) {
  ensureLoaded();
  const numericSolarSystemID = normalizePositiveInteger(solarSystemID, null);
  if (!numericSolarSystemID) {
    return null;
  }
  const current =
    cloneValue(getSystemState(numericSolarSystemID)) ||
    normalizeSystemState({}, numericSolarSystemID);
  const next = normalizeSystemState(
    {
      ...current,
      ...cloneValue(patch),
      structures:
        patch.structures !== undefined
          ? cloneValue(patch.structures)
          : cloneValue(current.structures),
      devIndices:
        patch.devIndices !== undefined
          ? { ...cloneValue(current.devIndices), ...cloneValue(patch.devIndices) }
          : cloneValue(current.devIndices),
      recentActivity:
        patch.recentActivity !== undefined
          ? cloneValue(patch.recentActivity)
          : cloneValue(current.recentActivity),
      currentData:
        patch.currentData !== undefined
          ? cloneValue(patch.currentData)
          : cloneValue(current.currentData),
    },
    numericSolarSystemID,
  );
  if (
    patch.recentActivity === undefined &&
    current.allianceID !== next.allianceID
  ) {
    next.recentActivity = [
      buildOwnershipChangeActivity(current, next),
      ...next.recentActivity,
    ];
  }
  tableCache.systems[String(numericSolarSystemID)] = next;
  persist();
  try {
    const {
      invalidateSovereigntyModernStateCache,
    } = require(path.join(__dirname, "./sovModernState"));
    invalidateSovereigntyModernStateCache();
  } catch (_error) {
    // Avoid bootstrap-time circular dependency failures.
  }

  if (!valuesEqual(current.structures, next.structures)) {
    syncSovereigntyStructureRuntime(next, {
      broadcast: !normalizeBoolean(options.suppressNotifications, false),
    });
  }

  if (!normalizeBoolean(options.suppressNotifications, false)) {
    const structureSnapshots = listSovStructuresForSystem(numericSolarSystemID);
    const allianceIDs = collectSystemAllianceIDs(current, next, structureSnapshots);
    if (!valuesEqual(current.devIndices, next.devIndices)) {
      broadcastSolarSystemDevIndexChanged(numericSolarSystemID, allianceIDs);
    }
    if (
      current.allianceID !== next.allianceID ||
      current.corporationID !== next.corporationID ||
      current.claimStructureID !== next.claimStructureID
    ) {
      broadcastSovereigntyChanged(
        numericSolarSystemID,
        getSystemSovClaim(numericSolarSystemID),
        allianceIDs,
      );
    }
    if (!valuesEqual(current.structures, next.structures)) {
      broadcastSolarSystemSovStructuresUpdated(
        numericSolarSystemID,
        structureSnapshots,
        options.changesByStructureID || null,
        { allianceIDs },
      );
    }
    if (options.audioEventID) {
      broadcastSovereigntyAudioEvent(
        numericSolarSystemID,
        options.audioEventID,
        options.audioTextParams || {},
        allianceIDs,
      );
    }
    if (options.sovHubHack) {
      broadcastSovHubHacked(
        numericSolarSystemID,
        options.sovHubHack.sovHubID,
        options.sovHubHack.upgrades || [],
        allianceIDs,
      );
    }
  }

  return cloneValue(next);
}

function mutateStructureInSystem(
  solarSystemID,
  structureID,
  mutator,
  options = {},
) {
  const system = cloneValue(getSystemState(solarSystemID));
  if (!system) {
    return null;
  }
  const numericStructureID = normalizePositiveInteger(structureID, null);
  if (!numericStructureID) {
    return null;
  }
  const structureIndex = system.structures.findIndex(
    (entry) => normalizePositiveInteger(entry && entry.itemID, null) === numericStructureID,
  );
  if (structureIndex < 0) {
    return null;
  }
  const normalizedStructure = normalizeStructureRecord(
    mutator(cloneValue(system.structures[structureIndex])),
    system.solarSystemID,
    system.allianceID,
    system.corporationID,
  );
  if (!normalizedStructure) {
    return null;
  }
  const nextStructures = cloneValue(system.structures);
  nextStructures[structureIndex] = normalizedStructure;
  return upsertSystemState(
    system.solarSystemID,
    {
      structures: nextStructures,
    },
    options,
  );
}

function setStructureCampaignState(
  solarSystemID,
  structureID,
  campaignState = {},
  options = {},
) {
  return mutateStructureInSystem(
    solarSystemID,
    structureID,
    (structure) => ({
      ...structure,
      campaignEventType: normalizeInteger(campaignState.campaignEventType, 0),
      campaignStartTime: normalizeFiletimeString(campaignState.campaignStartTime, "0"),
      campaignScoresByTeam:
        campaignState.campaignScoresByTeam !== undefined
          ? normalizeScoresByTeam(campaignState.campaignScoresByTeam)
          : cloneValue(structure.campaignScoresByTeam || {}),
    }),
    options,
  );
}

function clearStructureCampaignState(solarSystemID, structureID, options = {}) {
  return mutateStructureInSystem(
    solarSystemID,
    structureID,
    (structure) => ({
      ...structure,
      campaignEventType: 0,
      campaignStartTime: "0",
      campaignScoresByTeam: {},
    }),
    options,
  );
}

function setStructureCampaignScores(
  solarSystemID,
  structureID,
  campaignScoresByTeam = {},
  options = {},
) {
  const numericStructureID = normalizePositiveInteger(structureID, null);
  return mutateStructureInSystem(
    solarSystemID,
    structureID,
    (structure) => ({
      ...structure,
      campaignScoresByTeam: normalizeScoresByTeam(campaignScoresByTeam),
    }),
    {
      ...options,
      changesByStructureID: numericStructureID
        ? { [numericStructureID]: [STRUCTURE_SCORE_UPDATED] }
        : options.changesByStructureID,
    },
  );
}

function setStructureVulnerabilityState(
  solarSystemID,
  structureID,
  vulnerabilityState = {},
  options = {},
) {
  return mutateStructureInSystem(
    solarSystemID,
    structureID,
    (structure) => ({
      ...structure,
      vulnerableStartTime: normalizeFiletimeString(
        vulnerabilityState.vulnerableStartTime,
        "0",
      ),
      vulnerableEndTime: normalizeFiletimeString(
        vulnerabilityState.vulnerableEndTime,
        "0",
      ),
    }),
    options,
  );
}

function clearStructureVulnerabilityState(solarSystemID, structureID, options = {}) {
  return mutateStructureInSystem(
    solarSystemID,
    structureID,
    (structure) => ({
      ...structure,
      vulnerableStartTime: "0",
      vulnerableEndTime: "0",
    }),
    options,
  );
}

function listAllAllianceSystems() {
  ensureLoaded();
  return cloneValue(indexCache.allAllianceSystems);
}

function listAllianceSystems(allianceID) {
  ensureLoaded();
  const numericAllianceID = normalizePositiveInteger(allianceID, null);
  if (!numericAllianceID) {
    return [];
  }
  return cloneValue(indexCache.systemsByAllianceID.get(numericAllianceID) || []);
}

function getDevelopmentIndicesForSystem(solarSystemID) {
  const system = getSystemState(solarSystemID);
  const devIndices = system ? system.devIndices : normalizeDevIndices();
  return {
    [ATTRIBUTE_DEV_INDEX_MILITARY]: {
      points: devIndices.militaryPoints,
      increasing: devIndices.militaryIncreasing,
    },
    [ATTRIBUTE_DEV_INDEX_INDUSTRIAL]: {
      points: devIndices.industrialPoints,
      increasing: devIndices.industrialIncreasing,
    },
    [ATTRIBUTE_DEV_INDEX_SOVEREIGNTY]: {
      points: devIndices.claimedForDays * CLAIM_DAYS_TO_SECONDS,
      increasing: false,
    },
  };
}

function listAllDevelopmentIndices() {
  ensureLoaded();
  return cloneValue(indexCache.allDevelopmentIndices);
}

function listCurrentSovData(locationID) {
  ensureLoaded();
  const numericLocationID = normalizePositiveInteger(locationID, null);
  if (!numericLocationID) {
    return [];
  }
  return cloneValue(indexCache.currentSovDataByLocationID.get(numericLocationID) || []);
}

function listRecentSovActivity() {
  ensureLoaded();
  return cloneValue(indexCache.recentSovActivity);
}

function getSystemSovClaim(solarSystemID) {
  ensureLoaded();
  const numericSolarSystemID = normalizePositiveInteger(solarSystemID, null);
  if (!numericSolarSystemID) {
    return null;
  }
  return cloneValue(indexCache.claimsBySolarSystemID.get(numericSolarSystemID) || null);
}

function getInfrastructureHubClaim(solarSystemID) {
  ensureLoaded();
  const numericSolarSystemID = normalizePositiveInteger(solarSystemID, null);
  if (!numericSolarSystemID) {
    return null;
  }
  return cloneValue(
    indexCache.infrastructureHubClaimsBySolarSystemID.get(numericSolarSystemID) || null,
  );
}

function listSovStructuresForSystem(solarSystemID) {
  ensureLoaded();
  const numericSolarSystemID = normalizePositiveInteger(solarSystemID, null);
  if (!numericSolarSystemID) {
    return [];
  }
  return cloneValue(indexCache.structureSnapshotsBySolarSystemID.get(numericSolarSystemID) || []);
}

function getAllianceSovereigntyRows(allianceID) {
  ensureLoaded();
  const numericAllianceID = normalizePositiveInteger(allianceID, null);
  if (!numericAllianceID) {
    return {
      tcuRows: [],
      iHubRows: [],
      campaignScoreRows: [],
    };
  }
  return cloneValue(
    indexCache.allianceSovRowsByAllianceID.get(numericAllianceID) || {
      tcuRows: [],
      iHubRows: [],
      campaignScoreRows: [],
    },
  );
}

function getFuelAccessGroupID(solarSystemID) {
  const system = getSystemState(solarSystemID);
  return system ? system.fuelAccessGroupID : null;
}

function setFuelAccessGroupID(solarSystemID, fuelAccessGroupID) {
  const system = upsertSystemState(solarSystemID, {
    fuelAccessGroupID: normalizePositiveInteger(fuelAccessGroupID, null),
  });
  return system ? system.fuelAccessGroupID : null;
}

function emitSovereigntyAudioEvent(
  solarSystemID,
  eventID,
  textParams = {},
  allianceIDs = [],
) {
  broadcastSovereigntyAudioEvent(solarSystemID, eventID, textParams, allianceIDs);
}

function emitSovHubHacked(
  solarSystemID,
  sovHubID,
  upgrades = [],
  allianceIDs = [],
) {
  broadcastSovHubHacked(solarSystemID, sovHubID, upgrades, allianceIDs);
}

function destroySkyhooks() {
  return [];
}

function acquireSkyhooks() {
  return [];
}

function getSovereigntyDebugSnapshot() {
  ensureLoaded();
  return cloneValue(indexCache.debugSnapshot);
}

function wipeAllSovereigntyState(options = {}) {
  const currentTable = readSovereigntyTable();
  const nextTable = buildDefaultSovereigntyTable();
  if (options.preserveResources !== false) {
    nextTable.resources = cloneStoreValue(
      currentTable && currentTable.resources ? currentTable.resources : nextTable.resources,
    );
  }
  if (options.preserveVersion !== false) {
    nextTable._meta.version = Math.max(
      1,
      normalizeInteger(
        currentTable && currentTable._meta && currentTable._meta.version,
        nextTable._meta.version,
      ),
    );
  }
  tableCache = writeSovereigntyTable(nextTable);
  indexCache = null;
  clearAllSovereigntyRelatedStructures({
    broadcast: options.broadcast === true,
    syncScene: options.syncScene === true,
    excludedSession: options.excludedSession || null,
  });
  buildIndexes();
  return cloneValue(tableCache);
}

function resetSovereigntyStateForTests() {
  tableCache = null;
  indexCache = null;
  clearAllSovereigntyRelatedStructures({
    broadcast: false,
    syncScene: false,
  });
}

module.exports = {
  ATTRIBUTE_DEV_INDEX_INDUSTRIAL,
  ATTRIBUTE_DEV_INDEX_MILITARY,
  ATTRIBUTE_DEV_INDEX_SOVEREIGNTY,
  TYPE_INFRASTRUCTURE_HUB,
  TYPE_TERRITORIAL_CLAIM_UNIT,
  acquireSkyhooks,
  cancelAllianceCapitalTransition,
  clearStructureCampaignState,
  clearStructureVulnerabilityState,
  destroySkyhooks,
  emitSovHubHacked,
  emitSovereigntyAudioEvent,
  getAllianceCapitalInfo,
  getAlliancePrimeInfo,
  getAllianceSovereigntyRows,
  getAllianceSovereigntySnapshot,
  getDevelopmentIndicesForSystem,
  getFuelAccessGroupID,
  getInfrastructureHubClaim,
  getOperationalIndexLevel,
  getStrategicIndexLevel,
  getSovereigntyDebugSnapshot,
  wipeAllSovereigntyState,
  listCurrentSovData,
  listRecentSovActivity,
  getSystemSovClaim,
  getSystemState,
  listAllAllianceSystems,
  listAllDevelopmentIndices,
  listAllianceSystems,
  listSovStructuresForSystem,
  resetSovereigntyStateForTests,
  setAllianceCapitalSystem,
  setAlliancePrimeHour,
  setFuelAccessGroupID,
  setStructureCampaignScores,
  setStructureCampaignState,
  setStructureVulnerabilityState,
  upsertAllianceState,
  upsertSystemState,
};
