const path = require("path");

const config = require(path.join(__dirname, "../../../config"));
const { getExpertSystemByTypeID } = require("./expertSystemCatalog");
const {
  getCharacterExpertSystemEntries,
  getExpertSystemMutationVersion,
} = require("./expertSystemState");

const projectionCache = new Map();

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function cloneValue(value) {
  if (value === null || value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function buildSkillItemID(characterID, typeID) {
  return toInt(characterID, 0) * 100000 + toInt(typeID, 0);
}

function getActiveExpertSkillGrantMap(characterID, options = {}) {
  if (config.expertSystemsEnabled === false) {
    return new Map();
  }

  const grantMap = new Map();
  for (const installEntry of getCharacterExpertSystemEntries(characterID, options)) {
    const expertSystem = getExpertSystemByTypeID(installEntry.typeID);
    if (!expertSystem) {
      continue;
    }
    for (const grant of expertSystem.skillsGranted || []) {
      const typeID = toInt(grant && grant.typeID, 0);
      const level = Math.max(0, Math.min(5, toInt(grant && grant.level, 0)));
      if (typeID <= 0 || level <= 0) {
        continue;
      }
      grantMap.set(typeID, Math.max(level, grantMap.get(typeID) || 0));
    }
  }
  return grantMap;
}

function buildVirtualSkillRecord(characterID, skillType, virtualLevel) {
  const typeID = toInt(skillType && skillType.typeID, 0);
  return {
    itemID: buildSkillItemID(characterID, typeID),
    typeID,
    ownerID: toInt(characterID, 0),
    locationID: toInt(characterID, 0),
    flagID: 7,
    categoryID: skillType.categoryID || 16,
    groupID: skillType.groupID || 0,
    groupName: skillType.groupName || "",
    itemName: skillType.name || `Skill ${typeID}`,
    published: skillType.published !== false,
    skillLevel: virtualLevel,
    trainedSkillLevel: null,
    effectiveSkillLevel: virtualLevel,
    virtualSkillLevel: virtualLevel,
    skillRank: skillType.skillRank || 1,
    skillPoints: null,
    trainedSkillPoints: null,
    inTraining: false,
    trainingStartSP: null,
    trainingDestinationSP: null,
    trainingStartTime: null,
    trainingEndTime: null,
  };
}

function projectExistingSkillRecord(skillRecord, virtualLevel) {
  const currentTrainedLevel = Math.max(
    0,
    toInt(
      skillRecord.trainedSkillLevel ??
        skillRecord.skillLevel ??
        skillRecord.effectiveSkillLevel,
      0,
    ),
  );
  const currentEffectiveLevel = Math.max(
    currentTrainedLevel,
    toInt(skillRecord.effectiveSkillLevel, currentTrainedLevel),
  );
  const nextVirtualLevel = virtualLevel > currentTrainedLevel ? virtualLevel : null;
  const nextEffectiveLevel = Math.max(currentEffectiveLevel, currentTrainedLevel, virtualLevel);

  return {
    ...skillRecord,
    skillLevel: Math.max(toInt(skillRecord.skillLevel, currentTrainedLevel), nextEffectiveLevel),
    trainedSkillLevel: skillRecord.trainedSkillLevel ?? currentTrainedLevel,
    effectiveSkillLevel: nextEffectiveLevel,
    virtualSkillLevel: nextVirtualLevel,
  };
}

function normalizeSkillRecords(skillRecords = []) {
  const map = new Map();
  for (const rawRecord of Array.isArray(skillRecords) ? skillRecords : []) {
    const typeID = toInt(rawRecord && rawRecord.typeID, 0);
    if (typeID > 0) {
      map.set(typeID, cloneValue(rawRecord));
    }
  }
  return map;
}

function buildProjectionCacheKey(characterID, skillRecords, options = {}) {
  return [
    toInt(characterID, 0),
    toInt(options.skillMutationVersion, 0),
    getExpertSystemMutationVersion(),
    config.expertSystemsEnabled === false ? 0 : 1,
    Array.isArray(skillRecords) ? skillRecords.length : 0,
  ].join(":");
}

function projectSkillRecordsForCharacter(characterID, skillRecords = [], options = {}) {
  const numericCharacterID = toInt(characterID, 0);
  const baseRecords = Array.isArray(skillRecords) ? skillRecords : [];
  if (numericCharacterID <= 0 || config.expertSystemsEnabled === false) {
    return baseRecords.map((record) => cloneValue(record));
  }

  const cacheKey = buildProjectionCacheKey(numericCharacterID, baseRecords, options);
  if (!options.skipCache && projectionCache.has(cacheKey)) {
    return projectionCache.get(cacheKey).map((record) => cloneValue(record));
  }

  const skillMap = normalizeSkillRecords(baseRecords);
  const grantMap = getActiveExpertSkillGrantMap(numericCharacterID, options);
  if (grantMap.size === 0) {
    const clonedRecords = baseRecords.map((record) => cloneValue(record));
    projectionCache.set(cacheKey, clonedRecords);
    return clonedRecords.map((record) => cloneValue(record));
  }

  const getSkillTypeByID =
    typeof options.getSkillTypeByID === "function" ? options.getSkillTypeByID : null;

  for (const [typeID, virtualLevel] of grantMap.entries()) {
    const existingRecord = skillMap.get(typeID);
    if (existingRecord) {
      skillMap.set(typeID, projectExistingSkillRecord(existingRecord, virtualLevel));
      continue;
    }
    if (!getSkillTypeByID) {
      continue;
    }
    const skillType = getSkillTypeByID(typeID);
    if (!skillType) {
      continue;
    }
    skillMap.set(typeID, buildVirtualSkillRecord(numericCharacterID, skillType, virtualLevel));
  }

  const projectedRecords = [...skillMap.values()].sort((left, right) => left.typeID - right.typeID);
  projectionCache.set(cacheKey, projectedRecords.map((record) => cloneValue(record)));
  return projectedRecords.map((record) => cloneValue(record));
}

function buildProjectedSkillMap(skillRecords = []) {
  const map = new Map();
  for (const record of Array.isArray(skillRecords) ? skillRecords : []) {
    const typeID = toInt(record && record.typeID, 0);
    if (typeID > 0) {
      map.set(typeID, cloneValue(record));
    }
  }
  return map;
}

function diffProjectedSkillMaps(previousSkillMap, nextSkillMap) {
  const changedSkillRecords = [];
  const removedSkillRecords = [];
  const previous = previousSkillMap instanceof Map ? previousSkillMap : new Map();
  const next = nextSkillMap instanceof Map ? nextSkillMap : new Map();

  for (const [typeID, nextRecord] of next.entries()) {
    const previousRecord = previous.get(typeID) || null;
    if (JSON.stringify(previousRecord) !== JSON.stringify(nextRecord)) {
      changedSkillRecords.push(cloneValue(nextRecord));
    }
  }

  for (const [typeID, previousRecord] of previous.entries()) {
    if (!next.has(typeID)) {
      removedSkillRecords.push(cloneValue(previousRecord));
    }
  }

  return { changedSkillRecords, removedSkillRecords };
}

function clearExpertSystemProjectionCache() {
  projectionCache.clear();
}

module.exports = {
  buildProjectedSkillMap,
  clearExpertSystemProjectionCache,
  diffProjectedSkillMaps,
  getActiveExpertSkillGrantMap,
  projectSkillRecordsForCharacter,
};
