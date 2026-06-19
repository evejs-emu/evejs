const path = require("path");

const {
  TABLE,
  readStaticTable,
} = require(path.join(__dirname, "../_shared/referenceData"));
const {
  getCharacterSkillMap,
  getSkillMutationVersion,
} = require(path.join(__dirname, "../skills/skillState"));
const {
  resolveCharacterIndustryAttributes,
} = require(path.join(__dirname, "../dogma/brain/providers/industryBrainProvider"));
const {
  INDUSTRY_ACTIVITY,
  MAX_MATERIAL_EFFICIENCY,
  MAX_TIME_EFFICIENCY,
  MATERIAL_ROUND_PRECISION,
  RESEARCH_TIME_MULTIPLIERS,
  STEP_MATERIAL_EFFICIENCY,
  STEP_TIME_EFFICIENCY,
} = require(path.join(__dirname, "./industryConstants"));
const {
  resolveBlueprintActivityPrice,
} = require(path.join(__dirname, "./industryPricing"));

const REQUIRED_SKILL_TIME_ATTRIBUTE_ID = 1982;
const ATTRIBUTE_MANUFACTURE_TIME_MULTIPLIER = 219;

const ACTIVITY_KEY_BY_ID = Object.freeze({
  [INDUSTRY_ACTIVITY.MANUFACTURING]: "manufacturing",
  [INDUSTRY_ACTIVITY.RESEARCH_TIME]: "research_time",
  [INDUSTRY_ACTIVITY.RESEARCH_MATERIAL]: "research_material",
  [INDUSTRY_ACTIVITY.COPYING]: "copying",
  [INDUSTRY_ACTIVITY.INVENTION]: "invention",
  [INDUSTRY_ACTIVITY.REACTION]: "reaction",
});

const CHARACTER_TIME_PERCENT_BY_ACTIVITY = Object.freeze({
  [INDUSTRY_ACTIVITY.MANUFACTURING]: Object.freeze([
    Object.freeze([3380, -4]),
    Object.freeze([3388, -3]),
  ]),
  [INDUSTRY_ACTIVITY.RESEARCH_TIME]: Object.freeze([
    Object.freeze([3403, -5]),
    Object.freeze([3388, -3]),
  ]),
  [INDUSTRY_ACTIVITY.RESEARCH_MATERIAL]: Object.freeze([
    Object.freeze([3409, -5]),
    Object.freeze([3388, -3]),
  ]),
  [INDUSTRY_ACTIVITY.COPYING]: Object.freeze([
    Object.freeze([3402, -5]),
    Object.freeze([3388, -3]),
  ]),
  [INDUSTRY_ACTIVITY.INVENTION]: Object.freeze([
    Object.freeze([3388, -3]),
  ]),
});

let typeDogmaAttributesByTypeID = null;
const characterSkillLevelsCache = new Map();
const requiredSkillTimePercentCache = new Map();

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

function getRequiredSkillTimePercentPerLevel(typeID) {
  const numericTypeID = toInt(typeID, 0);
  if (numericTypeID <= 0) {
    return 0;
  }
  if (requiredSkillTimePercentCache.has(numericTypeID)) {
    return requiredSkillTimePercentCache.get(numericTypeID);
  }

  const typeRecord = getTypeDogmaAttributesByTypeID()[String(numericTypeID)] || null;
  const attributes =
    typeRecord && typeRecord.attributes && typeof typeRecord.attributes === "object"
      ? typeRecord.attributes
      : {};
  const value = toFloat(attributes[String(REQUIRED_SKILL_TIME_ATTRIBUTE_ID)], 0);
  requiredSkillTimePercentCache.set(numericTypeID, value);
  return value;
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

  const skillMap = getCharacterSkillMap(numericCharacterID);
  const levels = {};
  for (const [typeID, skillRecord] of skillMap.entries()) {
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

function getIndustryActivityKey(activityID) {
  return ACTIVITY_KEY_BY_ID[toInt(activityID, 0)] || null;
}

function getIndustryActivity(definition, activityID) {
  const activityKey = getIndustryActivityKey(activityID);
  if (!activityKey) {
    return null;
  }
  return (
    definition &&
    definition.activities &&
    typeof definition.activities === "object" &&
    definition.activities[activityKey]
  ) || null;
}

function roundMaterialQuantity(quantity, runs) {
  return Math.max(
    Math.trunc(
      Math.ceil(
        Math.round(quantity * (10 ** MATERIAL_ROUND_PRECISION)) /
          (10 ** MATERIAL_ROUND_PRECISION),
      ),
    ),
    runs,
  );
}

function buildIndustryActivityMaterials(
  definition,
  activityID,
  runs,
  options = {},
) {
  const activity = getIndustryActivity(definition, activityID);
  const baseMaterials = Array.isArray(activity && activity.materials)
    ? activity.materials
    : [];
  const normalizedRuns = Math.max(0, toInt(runs, 0));
  const materialEfficiency = Math.max(0, toInt(options.materialEfficiency, 0));
  const blueprintModifier =
    toInt(activityID, 0) === INDUSTRY_ACTIVITY.MANUFACTURING
      ? 1.0 - materialEfficiency / 100.0
      : 1.0;

  return baseMaterials
    .map((material) => {
      const quantity =
        Math.max(0, toInt(material && material.quantity, 0)) * normalizedRuns * blueprintModifier;
      return {
        typeID: toInt(material && material.typeID, 0),
        quantity: roundMaterialQuantity(quantity, normalizedRuns),
      };
    })
    .filter((material) => material.typeID > 0 && material.quantity > 0);
}

function resolveFacilityTimeModifier(facility, activityID) {
  const activityEntry =
    facility &&
    facility.activities &&
    facility.activities[toInt(activityID, 0)];
  const timeModifiers = Array.isArray(activityEntry && activityEntry[0]) ? activityEntry[0] : [];
  let facilityModifier = 1.0;
  for (const modifier of timeModifiers) {
    facilityModifier *= Math.max(0, toFloat(Array.isArray(modifier) ? modifier[0] : 1, 1));
  }
  return facilityModifier;
}

function applyTimePercentModifier(currentValue, percentPerLevel, level) {
  if (!(currentValue > 0) || !(level > 0) || !Number.isFinite(percentPerLevel) || percentPerLevel === 0) {
    return currentValue;
  }
  return currentValue * Math.max(0, 1.0 + (percentPerLevel * level) / 100.0);
}

function resolveRequiredSkillTimeModifier(activityID, characterID, requiredSkills = []) {
  const levels = getCachedCharacterSkillLevels(characterID);
  let modifier = 1.0;

  if (toInt(activityID, 0) === INDUSTRY_ACTIVITY.MANUFACTURING) {
    for (const skill of Array.isArray(requiredSkills) ? requiredSkills : []) {
      const skillTypeID = toInt(skill && skill.typeID, 0);
      if (skillTypeID <= 0) {
        continue;
      }
      const percentPerLevel = getRequiredSkillTimePercentPerLevel(skillTypeID);
      if (!(percentPerLevel < 0)) {
        continue;
      }
      const level = Math.max(0, toInt(levels[String(skillTypeID)], 0));
      modifier = applyTimePercentModifier(modifier, percentPerLevel, level);
    }
  }

  return modifier;
}

function resolveCharacterIndustryTimeModifier(activityID, characterID) {
  if (toInt(activityID, 0) !== INDUSTRY_ACTIVITY.MANUFACTURING) {
    let modifier = 1.0;
    const levels = getCachedCharacterSkillLevels(characterID);
    for (const [skillTypeID, percentPerLevel] of CHARACTER_TIME_PERCENT_BY_ACTIVITY[toInt(activityID, 0)] || []) {
      const level = Math.max(0, toInt(levels[String(skillTypeID)], 0));
      modifier = applyTimePercentModifier(modifier, percentPerLevel, level);
    }
    return modifier;
  }

  const attributes = resolveCharacterIndustryAttributes(characterID);
  const modifier = toFloat(
    attributes && attributes[ATTRIBUTE_MANUFACTURE_TIME_MULTIPLIER],
    1.0,
  );
  return modifier > 0 ? modifier : 1.0;
}

function resolveIndustryJobBaseCost(definition, activityID, costPercentage = 1) {
  const blueprintTypeID = toInt(definition && definition.blueprintTypeID, 0);
  if (blueprintTypeID <= 0) {
    return 0;
  }
  return Math.max(
    0,
    resolveBlueprintActivityPrice(blueprintTypeID, activityID) * Math.max(0, toFloat(costPercentage, 0)),
  );
}

function resolveIndustryJobTimeSeconds(
  definition,
  activityID,
  runs,
  timeEfficiency,
  facility,
  characterID,
  licensedRuns = 1,
) {
  const activity = getIndustryActivity(definition, activityID);
  const activityBaseTime = Math.max(0, toInt(activity && activity.time, 0));
  const normalizedRuns = Math.max(1, toInt(runs, 1));
  const normalizedLicensedRuns = Math.max(1, toInt(licensedRuns, 1));
  let baseTime = activityBaseTime * normalizedRuns;

  if (toInt(activityID, 0) === INDUSTRY_ACTIVITY.COPYING) {
    baseTime = activityBaseTime * normalizedLicensedRuns * normalizedRuns;
  } else if (
    toInt(activityID, 0) === INDUSTRY_ACTIVITY.RESEARCH_TIME ||
    toInt(activityID, 0) === INDUSTRY_ACTIVITY.RESEARCH_MATERIAL
  ) {
    const stepSize =
      toInt(activityID, 0) === INDUSTRY_ACTIVITY.RESEARCH_TIME
        ? STEP_TIME_EFFICIENCY
        : STEP_MATERIAL_EFFICIENCY;
    const maxEfficiency =
      toInt(activityID, 0) === INDUSTRY_ACTIVITY.RESEARCH_TIME
        ? MAX_TIME_EFFICIENCY
        : MAX_MATERIAL_EFFICIENCY;
    const currentLevel = Math.max(0, toInt(timeEfficiency, 0)) / stepSize;
    const maxIndex = Math.max(0, RESEARCH_TIME_MULTIPLIERS.length - 1);
    baseTime = 0;
    for (let index = 0; index < normalizedRuns; index += 1) {
      const levelIndex = Math.min(currentLevel + index, maxIndex);
      if (currentLevel + index >= maxEfficiency / stepSize) {
        break;
      }
      baseTime += activityBaseTime * RESEARCH_TIME_MULTIPLIERS[levelIndex];
    }
  }
  const blueprintModifier =
    toInt(activityID, 0) === INDUSTRY_ACTIVITY.MANUFACTURING
      ? Math.max(0, 1.0 - toInt(timeEfficiency, 0) / 100.0)
      : 1.0;
  const facilityModifier = resolveFacilityTimeModifier(facility, activityID);
  const characterModifier = resolveCharacterIndustryTimeModifier(
    activityID,
    characterID,
  );
  const requiredSkillModifier = resolveRequiredSkillTimeModifier(
    activityID,
    characterID,
    activity && activity.skills,
  );
  const totalSeconds =
    baseTime *
    blueprintModifier *
    facilityModifier *
    characterModifier *
    requiredSkillModifier;
  return Math.max(
    1,
    Math.round(totalSeconds),
  );
}

function clearIndustryParityCaches() {
  characterSkillLevelsCache.clear();
  requiredSkillTimePercentCache.clear();
}

module.exports = {
  buildIndustryActivityMaterials,
  clearIndustryParityCaches,
  getIndustryActivity,
  getIndustryActivityKey,
  resolveIndustryJobBaseCost,
  resolveIndustryJobTimeSeconds,
};
