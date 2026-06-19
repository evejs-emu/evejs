const path = require("path");

const worldData = require(path.join(__dirname, "../../space/worldData"));
const {
  TABLE,
  readStaticTable,
} = require(path.join(__dirname, "../_shared/referenceData"));
const {
  getItemMetadata,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  getCharacterSkillMap,
  getSkillMutationVersion,
} = require(path.join(__dirname, "../skills/skillState"));
const standingRuntime = require(path.join(
  __dirname,
  "../character/standingRuntime",
));
const {
  STRUCTURE_SERVICE_ID,
} = require(path.join(__dirname, "../structure/structureConstants"));
const {
  getStructureByID,
} = require(path.join(__dirname, "../structure/structureState"));
const {
  getIndustryServiceID,
  structureHasOnlineService: structureRecordHasOnlineService,
} = require(path.join(__dirname, "../structure/structureServiceAuthority"));
const {
  INDUSTRY_ACTIVITY,
  INDUSTRY_ERROR,
} = require(path.join(__dirname, "./industryConstants"));

const BASE_SLOT_LIMIT = 1;
const POCHVEN_REGION_ID = 10000070;
const TRIGLAVIAN_FACTION_ID = 500026;
const TRIGLAVIAN_FACTORY_STANDING_REQUIREMENT = 3.0;

const SCIENCE_ACTIVITY_IDS = new Set([
  INDUSTRY_ACTIVITY.RESEARCH_TIME,
  INDUSTRY_ACTIVITY.RESEARCH_MATERIAL,
  INDUSTRY_ACTIVITY.COPYING,
  INDUSTRY_ACTIVITY.INVENTION,
]);

const SLOT_BONUS_ATTRIBUTE_ID_BY_ACTIVITY_GROUP = Object.freeze({
  manufacturing: 450,
  science: 471,
  reaction: 2661,
});

const SLOT_SKILL_TYPE_IDS_BY_ACTIVITY_GROUP = Object.freeze({
  manufacturing: Object.freeze([3387, 24625]),
  science: Object.freeze([3406, 24624]),
  reaction: Object.freeze([45748, 45749]),
});

const CAPITAL_MANUFACTURING_GROUP_NAMES = new Set([
  "Capital Industrial Ship",
  "Carrier",
  "Dreadnought",
  "Force Auxiliary",
  "Freighter",
  "Jump Freighter",
  "Lancer Dreadnought",
]);

const SUPERCAPITAL_MANUFACTURING_GROUP_NAMES = new Set([
  "Supercarrier",
  "Titan",
]);

let typeDogmaAttributesByTypeID = null;
const characterSkillLevelsCache = new Map();

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFloat(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function getTypeDogmaAttributesByTypeID() {
  if (typeDogmaAttributesByTypeID) {
    return typeDogmaAttributesByTypeID;
  }
  const table = readStaticTable(TABLE.TYPE_DOGMA);
  typeDogmaAttributesByTypeID =
    table && typeof table === "object" && table.typesByTypeID
      ? table.typesByTypeID
      : {};
  return typeDogmaAttributesByTypeID;
}

function getTypeAttributeValue(typeID, attributeID) {
  const numericTypeID = toInt(typeID, 0);
  const numericAttributeID = toInt(attributeID, 0);
  if (numericTypeID <= 0 || numericAttributeID <= 0) {
    return 0;
  }
  const typeRecord = getTypeDogmaAttributesByTypeID()[String(numericTypeID)] || null;
  const attributes =
    typeRecord && typeRecord.attributes && typeof typeRecord.attributes === "object"
      ? typeRecord.attributes
      : {};
  return toFloat(attributes[String(numericAttributeID)], 0);
}

function getCachedCharacterSkillLevels(characterID) {
  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return {};
  }

  const cacheKey = `${numericCharacterID}:${getSkillMutationVersion()}`;
  if (characterSkillLevelsCache.has(cacheKey)) {
    return characterSkillLevelsCache.get(cacheKey);
  }

  const levels = {};
  for (const [typeID, skillRecord] of getCharacterSkillMap(numericCharacterID).entries()) {
    levels[String(toInt(typeID, 0))] = Math.max(
      0,
      toInt(
        skillRecord &&
          (skillRecord.effectiveSkillLevel ??
            skillRecord.trainedSkillLevel ??
            skillRecord.skillLevel),
        0,
      ),
    );
  }

  characterSkillLevelsCache.set(cacheKey, levels);
  return levels;
}

function getSlotActivityGroup(activityID) {
  const numericActivityID = toInt(activityID, 0);
  if (numericActivityID === INDUSTRY_ACTIVITY.MANUFACTURING) {
    return "manufacturing";
  }
  if (SCIENCE_ACTIVITY_IDS.has(numericActivityID)) {
    return "science";
  }
  if (numericActivityID === INDUSTRY_ACTIVITY.REACTION) {
    return "reaction";
  }
  return null;
}

function resolveIndustrySlotLimit(activityID, characterID) {
  const activityGroup = getSlotActivityGroup(activityID);
  if (!activityGroup) {
    return BASE_SLOT_LIMIT;
  }

  const attributeID = SLOT_BONUS_ATTRIBUTE_ID_BY_ACTIVITY_GROUP[activityGroup];
  const skillLevels = getCachedCharacterSkillLevels(characterID);
  let slotLimit = BASE_SLOT_LIMIT;

  for (const skillTypeID of SLOT_SKILL_TYPE_IDS_BY_ACTIVITY_GROUP[activityGroup] || []) {
    const perLevelBonus = getTypeAttributeValue(skillTypeID, attributeID);
    const skillLevel = Math.max(0, toInt(skillLevels[String(skillTypeID)], 0));
    if (perLevelBonus > 0 && skillLevel > 0) {
      slotLimit += perLevelBonus * skillLevel;
    }
  }

  return Math.max(BASE_SLOT_LIMIT, Math.trunc(slotLimit));
}

function resolveIndustrySlotUsage(activityID, jobCounts = {}) {
  const numericCounts =
    jobCounts && typeof jobCounts === "object"
      ? jobCounts
      : {};
  const numericActivityID = toInt(activityID, 0);
  if (numericActivityID === INDUSTRY_ACTIVITY.MANUFACTURING) {
    return Math.max(0, toInt(numericCounts[INDUSTRY_ACTIVITY.MANUFACTURING], 0));
  }
  if (SCIENCE_ACTIVITY_IDS.has(numericActivityID)) {
    return [
      INDUSTRY_ACTIVITY.RESEARCH_TIME,
      INDUSTRY_ACTIVITY.RESEARCH_MATERIAL,
      INDUSTRY_ACTIVITY.COPYING,
      INDUSTRY_ACTIVITY.INVENTION,
    ].reduce(
      (total, scienceActivityID) => total + Math.max(0, toInt(numericCounts[scienceActivityID], 0)),
      0,
    );
  }
  if (numericActivityID === INDUSTRY_ACTIVITY.REACTION) {
    return Math.max(0, toInt(numericCounts[INDUSTRY_ACTIVITY.REACTION], 0));
  }
  return Math.max(0, toInt(numericCounts[numericActivityID], 0));
}

function resolveIndustrySlotContext(activityID, characterID, jobCounts = {}) {
  const limit = resolveIndustrySlotLimit(activityID, characterID);
  const used = resolveIndustrySlotUsage(activityID, jobCounts);
  return {
    limit,
    used,
    full: used >= limit,
  };
}

function isTriglavianSolarSystem(solarSystemID) {
  const solarSystem = worldData.getSolarSystemByID(toInt(solarSystemID, 0));
  return (
    toInt(solarSystem && solarSystem.factionID, 0) === TRIGLAVIAN_FACTION_ID ||
    toInt(solarSystem && solarSystem.regionID, 0) === POCHVEN_REGION_ID ||
    String(solarSystem && solarSystem.regionName || "").trim().toLowerCase() === "pochven"
  );
}

function resolveStandingValueForOwner(session, ownerID, standingTargetID) {
  const characterID = toInt(session && (session.characterID || session.charid), 0);
  const corporationID = toInt(session && (session.corporationID || session.corpid), 0);
  if (characterID <= 0) {
    return 0;
  }

  const numericStandingTargetID = toInt(standingTargetID, 0);
  if (numericStandingTargetID <= 0) {
    return 0;
  }

  if (
    toInt(ownerID, 0) === corporationID &&
    corporationID > 0
  ) {
    const row = standingRuntime.listCorporationStandings(corporationID).find(
      (entry) => toInt(entry && entry.fromID, 0) === numericStandingTargetID,
    );
    return row ? toFloat(row.standing, 0) : 0;
  }

  return standingRuntime.getCharacterRawStanding(characterID, numericStandingTargetID);
}

function resolveIndustryStandingRestriction(session, ownerID, facility, activityID) {
  if (toInt(activityID, 0) !== INDUSTRY_ACTIVITY.MANUFACTURING) {
    return null;
  }
  const facilityID = toInt(facility && facility.facilityID, 0);
  const station = worldData.getStationByID(facilityID);
  if (!station || !isTriglavianSolarSystem(station.solarSystemID)) {
    return null;
  }

  const currentStanding = resolveStandingValueForOwner(
    session,
    ownerID,
    TRIGLAVIAN_FACTION_ID,
  );
  if (currentStanding + 1e-9 >= TRIGLAVIAN_FACTORY_STANDING_REQUIREMENT) {
    return null;
  }

  return {
    from_id: TRIGLAVIAN_FACTION_ID,
    to_id: toInt(ownerID, 0),
    required_standing: TRIGLAVIAN_FACTORY_STANDING_REQUIREMENT,
    current_standing: currentStanding,
  };
}

function resolveManufacturingStructureServiceID(productTypeID) {
  const productMetadata = getItemMetadata(productTypeID, null);
  const groupID = toInt(productMetadata && productMetadata.groupID, 0);
  const serviceID = getIndustryServiceID(
    INDUSTRY_ACTIVITY.MANUFACTURING,
    groupID,
    INDUSTRY_ACTIVITY,
  );
  if (serviceID) {
    return serviceID;
  }
  const groupName = String(productMetadata && productMetadata.groupName || "").trim();
  if (SUPERCAPITAL_MANUFACTURING_GROUP_NAMES.has(groupName)) {
    return STRUCTURE_SERVICE_ID.MANUFACTURING_SUPERCAPITAL;
  }
  if (CAPITAL_MANUFACTURING_GROUP_NAMES.has(groupName)) {
    return STRUCTURE_SERVICE_ID.MANUFACTURING_CAPITAL;
  }
  return STRUCTURE_SERVICE_ID.MANUFACTURING_BASIC;
}

function resolveIndustryStructureServiceID(activityID, productTypeID) {
  const normalizedActivityID = toInt(activityID, 0);
  if (normalizedActivityID === INDUSTRY_ACTIVITY.MANUFACTURING) {
    return resolveManufacturingStructureServiceID(productTypeID);
  }
  const productMetadata = getItemMetadata(productTypeID, null);
  const groupID = toInt(productMetadata && productMetadata.groupID, 0);
  return getIndustryServiceID(normalizedActivityID, groupID, INDUSTRY_ACTIVITY);
}

function isStructureFacility(facilityID) {
  return Boolean(getStructureByID(toInt(facilityID, 0), { refresh: false }));
}

function structureHasOnlineService(facilityID, serviceID) {
  const structure = getStructureByID(toInt(facilityID, 0), { refresh: false });
  return structureRecordHasOnlineService(structure, serviceID);
}

function resolveIndustryFacilityRestriction(activityID, productTypeID, facility, blueprintTypeID = 0) {
  const facilityID = toInt(facility && facility.facilityID, 0);
  if (!isStructureFacility(facilityID)) {
    return null;
  }

  const requiredServiceID = resolveIndustryStructureServiceID(activityID, productTypeID);
  if (requiredServiceID && !structureHasOnlineService(facilityID, requiredServiceID)) {
    return {
      code: INDUSTRY_ERROR.FACILITY_ACTIVITY,
      args: [],
      requiredServiceID,
    };
  }

  if (
    isTriglavianSolarSystem(facility && facility.solarSystemID) &&
    (
      requiredServiceID === STRUCTURE_SERVICE_ID.MANUFACTURING_CAPITAL ||
      requiredServiceID === STRUCTURE_SERVICE_ID.MANUFACTURING_SUPERCAPITAL
    )
  ) {
    return {
      code: INDUSTRY_ERROR.FACILITY_TYPE,
      args: [toInt(blueprintTypeID, 0)],
      requiredServiceID,
    };
  }

  return null;
}

function clearIndustryRestrictionCaches() {
  characterSkillLevelsCache.clear();
}

module.exports = {
  BASE_SLOT_LIMIT,
  TRIGLAVIAN_FACTORY_STANDING_REQUIREMENT,
  TRIGLAVIAN_FACTION_ID,
  clearIndustryRestrictionCaches,
  resolveIndustryFacilityRestriction,
  resolveIndustrySlotContext,
  resolveIndustrySlotLimit,
  resolveIndustrySlotUsage,
  resolveIndustryStandingRestriction,
  resolveIndustryStructureServiceID,
};
