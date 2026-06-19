const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const structureState = require(path.join(__dirname, "../structure/structureState"));
const {
  structureHasOnlineService,
} = require(path.join(__dirname, "../structure/structureServiceAuthority"));
const {
  getFacilityTaxRate,
} = require(path.join(__dirname, "./industryFacilityState"));
const {
  INDUSTRY_ACTIVITY,
  INDUSTRY_BLUEPRINT_TABLE,
  INDUSTRY_FACILITY_TABLE,
  DEFAULT_TAX_RATE,
  DEFAULT_SCC_TAX_MODIFIER,
  FACILITY_ACTIVITY_SERVICE_IDS,
  INDUSTRY_REFERENCE,
} = require(path.join(__dirname, "./industryConstants"));

let blueprintCache = null;
let facilityCache = null;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFloat(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function readTable(tableName) {
  const result = database.read(tableName, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }
  return result.data;
}

function ensureBlueprintCache() {
  if (blueprintCache) {
    return blueprintCache;
  }

  const payload = readTable(INDUSTRY_BLUEPRINT_TABLE);
  const definitions = Array.isArray(payload.blueprintDefinitions)
    ? payload.blueprintDefinitions.map((entry) => cloneValue(entry))
    : [];
  const byTypeID = new Map();
  const byProductTypeID = new Map();

  for (const definition of definitions) {
    const blueprintTypeID = toInt(definition && definition.blueprintTypeID, 0);
    if (blueprintTypeID <= 0) {
      continue;
    }
    byTypeID.set(blueprintTypeID, definition);
    const productTypeID = toInt(definition && definition.productTypeID, 0);
    if (productTypeID > 0) {
      byProductTypeID.set(productTypeID, definition);
    }
  }

  blueprintCache = {
    payload,
    definitions,
    byTypeID,
    byProductTypeID,
  };
  return blueprintCache;
}

function ensureFacilityCache() {
  if (facilityCache) {
    return facilityCache;
  }

  const payload = readTable(INDUSTRY_FACILITY_TABLE);
  const profiles = Array.isArray(payload.npcFacilityProfiles)
    ? payload.npcFacilityProfiles.map((entry) => cloneValue(entry))
    : [];
  const byFacilityID = new Map();
  const byRegionID = new Map();

  for (const profile of profiles) {
    const facilityID = toInt(profile && profile.facilityID, 0);
    const regionID = toInt(profile && profile.regionID, 0);
    if (facilityID <= 0) {
      continue;
    }
    byFacilityID.set(facilityID, profile);
    if (regionID > 0) {
      if (!byRegionID.has(regionID)) {
        byRegionID.set(regionID, []);
      }
      byRegionID.get(regionID).push(profile);
    }
  }

  facilityCache = {
    payload,
    profiles,
    byFacilityID,
    byRegionID,
  };
  return facilityCache;
}

function clearIndustryStaticCaches() {
  blueprintCache = null;
  facilityCache = null;
}

function getBlueprintDefinitionByTypeID(blueprintTypeID) {
  return ensureBlueprintCache().byTypeID.get(toInt(blueprintTypeID, 0)) || null;
}

function getBlueprintDefinitionByProductTypeID(productTypeID) {
  return ensureBlueprintCache().byProductTypeID.get(toInt(productTypeID, 0)) || null;
}

function listBlueprintDefinitions() {
  return ensureBlueprintCache().definitions.map((entry) => cloneValue(entry));
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ blueprint$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function searchBlueprintDefinitions(query, limit = 20) {
  const normalizedQuery = normalizeName(query);
  if (!normalizedQuery) {
    return listBlueprintDefinitions().slice(0, Math.max(1, limit));
  }

  return listBlueprintDefinitions()
    .map((definition) => {
      const blueprintName = normalizeName(definition.blueprintName);
      const productName = normalizeName(definition.productName);
      let score = Number.POSITIVE_INFINITY;
      if (blueprintName === normalizedQuery || productName === normalizedQuery) {
        score = 0;
      } else if (
        blueprintName.startsWith(normalizedQuery) ||
        productName.startsWith(normalizedQuery)
      ) {
        score = 0.25;
      } else if (
        blueprintName.includes(normalizedQuery) ||
        productName.includes(normalizedQuery)
      ) {
        score = 0.75;
      }
      return { definition, score };
    })
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score;
      }
      return String(left.definition.blueprintName || "").localeCompare(
        String(right.definition.blueprintName || ""),
      );
    })
    .slice(0, Math.max(1, limit))
    .map((entry) => entry.definition);
}

function getNpcFacilityProfileByID(facilityID) {
  return ensureFacilityCache().byFacilityID.get(toInt(facilityID, 0)) || null;
}

function listNpcFacilityProfilesForRegion(regionID) {
  return [
    ...(ensureFacilityCache().byRegionID.get(toInt(regionID, 0)) || []),
  ].map((entry) => cloneValue(entry));
}

function buildDefaultGlobalModifiers() {
  return {
    faction: 1.0,
    system: {
      [INDUSTRY_ACTIVITY.MANUFACTURING]: 1.0,
      [INDUSTRY_ACTIVITY.RESEARCH_TIME]: 1.0,
      [INDUSTRY_ACTIVITY.RESEARCH_MATERIAL]: 1.0,
      [INDUSTRY_ACTIVITY.COPYING]: 1.0,
    },
  };
}

function buildActivityEntry(timeFactor = 1.0) {
  const normalizedTimeFactor = toFloat(timeFactor, 1.0);
  const timeModifiers =
    normalizedTimeFactor > 0 && Math.abs(normalizedTimeFactor - 1.0) > 1e-9
      ? [[normalizedTimeFactor, null, null, null, INDUSTRY_REFERENCE.FACILITY]]
      : [];
  return [
    timeModifiers,
    [],
    [],
    [],
    [],
    [],
  ];
}

function buildNpcFacilityActivitiesPayload(profile = null) {
  const activities = {};
  if (!profile || profile.supportsFactory !== false) {
    activities[INDUSTRY_ACTIVITY.MANUFACTURING] = buildActivityEntry(
      profile && profile.manufacturingFactor,
    );
  }
  if (profile && profile.supportsLaboratory) {
    const researchFactor = toFloat(profile && profile.researchFactor, 1.0);
    activities[INDUSTRY_ACTIVITY.RESEARCH_TIME] = buildActivityEntry(researchFactor);
    activities[INDUSTRY_ACTIVITY.RESEARCH_MATERIAL] = buildActivityEntry(researchFactor);
    activities[INDUSTRY_ACTIVITY.COPYING] = buildActivityEntry(researchFactor);
  }
  return activities;
}

function buildStructureFacilityActivitiesPayload(structure) {
  const activities = {};
  for (const activityID of [
    INDUSTRY_ACTIVITY.MANUFACTURING,
    INDUSTRY_ACTIVITY.RESEARCH_TIME,
    INDUSTRY_ACTIVITY.RESEARCH_MATERIAL,
    INDUSTRY_ACTIVITY.COPYING,
  ]) {
    if (structureSupportsActivity(structure, activityID)) {
      activities[activityID] = buildActivityEntry(1.0);
    }
  }
  return activities;
}

function buildFacilityPayloadFromNpcProfile(profile) {
  const facilityID = toInt(profile && profile.facilityID, 0);
  return {
    facilityID,
    typeID: toInt(profile && profile.typeID, 0),
    ownerID: toInt(profile && profile.ownerID, 0),
    tax: getFacilityTaxRate(facilityID, {
      facilityID,
      tax: DEFAULT_TAX_RATE,
      ownerID: toInt(profile && profile.ownerID, 0),
    }),
    solarSystemID: toInt(profile && profile.solarSystemID, 0),
    online: true,
    serviceAccess: {},
    sccTaxModifier: DEFAULT_SCC_TAX_MODIFIER,
    rigModifiers: {},
    globalModifiers: buildDefaultGlobalModifiers(),
    activities: buildNpcFacilityActivitiesPayload(profile),
  };
}

function structureSupportsActivity(structure, activityID) {
  const allowed = FACILITY_ACTIVITY_SERVICE_IDS[activityID];
  if (!structure || !allowed || !(allowed instanceof Set)) {
    return false;
  }
  for (const serviceID of allowed) {
    const numericServiceID = toInt(serviceID, 0);
    if (structureHasOnlineService(structure, numericServiceID)) {
      return true;
    }
  }
  return false;
}

function buildFacilityPayloadFromStructure(structure) {
  if (!structure) {
    return null;
  }
  const activities = buildStructureFacilityActivitiesPayload(structure);
  if (Object.keys(activities).length === 0) {
    return null;
  }
  const facilityID = toInt(structure.structureID, 0);
  const ownerID = toInt(structure.ownerCorpID || structure.ownerID, 0);
  return {
    facilityID,
    typeID: toInt(structure.typeID, 0),
    ownerID,
    tax: getFacilityTaxRate(facilityID, {
      facilityID,
      ownerID,
      tax: DEFAULT_TAX_RATE,
    }),
    solarSystemID: toInt(structure.solarSystemID, 0),
    online: !structure.destroyedAt,
    serviceAccess: {},
    sccTaxModifier: DEFAULT_SCC_TAX_MODIFIER,
    rigModifiers: {},
    globalModifiers: buildDefaultGlobalModifiers(),
    activities,
  };
}

function getFacilityPayloadByID(facilityID) {
  const numericFacilityID = toInt(facilityID, 0);
  const npcProfile = getNpcFacilityProfileByID(numericFacilityID);
  if (npcProfile) {
    return buildFacilityPayloadFromNpcProfile(npcProfile);
  }

  const station = worldData.getStationByID(numericFacilityID);
  if (station) {
    return {
      facilityID: numericFacilityID,
      typeID: toInt(station.stationTypeID, 0),
      ownerID: toInt(station.corporationID || station.ownerID, 0),
      tax: getFacilityTaxRate(numericFacilityID, {
        facilityID: numericFacilityID,
        ownerID: toInt(station.corporationID || station.ownerID, 0),
        tax: DEFAULT_TAX_RATE,
      }),
      solarSystemID: toInt(station.solarSystemID, 0),
      online: true,
      serviceAccess: {},
      sccTaxModifier: DEFAULT_SCC_TAX_MODIFIER,
      rigModifiers: {},
      globalModifiers: buildDefaultGlobalModifiers(),
      activities: {
        [INDUSTRY_ACTIVITY.MANUFACTURING]: buildActivityEntry(1.0),
        [INDUSTRY_ACTIVITY.RESEARCH_TIME]: buildActivityEntry(1.0),
        [INDUSTRY_ACTIVITY.RESEARCH_MATERIAL]: buildActivityEntry(1.0),
        [INDUSTRY_ACTIVITY.COPYING]: buildActivityEntry(1.0),
      },
    };
  }

  return buildFacilityPayloadFromStructure(
    structureState.getStructureByID(numericFacilityID, { refresh: false }),
  );
}

function listFacilitiesForSession(session) {
  const regionID = toInt(session && session.regionid, 0);
  const facilities = [];
  const seen = new Set();

  for (const profile of listNpcFacilityProfilesForRegion(regionID)) {
    const payload = buildFacilityPayloadFromNpcProfile(profile);
    if (payload && !seen.has(payload.facilityID)) {
      seen.add(payload.facilityID);
      facilities.push(payload);
    }
  }

  for (const structure of structureState.listStructures({
    includeDestroyed: false,
    refresh: false,
  })) {
    if (toInt(structure && structure.regionID, 0) !== regionID) {
      continue;
    }
    const payload = buildFacilityPayloadFromStructure(structure);
    if (payload && !seen.has(payload.facilityID)) {
      seen.add(payload.facilityID);
      facilities.push(payload);
    }
  }

  facilities.sort((left, right) => left.facilityID - right.facilityID);
  return facilities;
}

module.exports = {
  clearIndustryStaticCaches,
  getBlueprintDefinitionByProductTypeID,
  getBlueprintDefinitionByTypeID,
  getFacilityPayloadByID,
  getNpcFacilityProfileByID,
  listBlueprintDefinitions,
  listFacilitiesForSession,
  listNpcFacilityProfilesForRegion,
  searchBlueprintDefinitions,
  structureSupportsActivity,
};
