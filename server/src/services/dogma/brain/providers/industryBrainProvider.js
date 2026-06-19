const path = require("path");

const {
  TABLE,
  readStaticTable,
} = require(path.join(__dirname, "../../../_shared/referenceData"));
const {
  currentFileTime,
} = require(path.join(__dirname, "../../../_shared/serviceHelpers"));

const ATTRIBUTE_MANUFACTURE_SLOT_LIMIT = 196;
const ATTRIBUTE_MANUFACTURE_TIME_MULTIPLIER = 219;
const ATTRIBUTE_MANUFACTURING_TIME_RESEARCH_SPEED = 385;
const ATTRIBUTE_COPY_SPEED_PERCENT = 387;
const ATTRIBUTE_MINERAL_NEED_RESEARCH_SPEED = 398;
const ATTRIBUTE_MAX_LABORATORY_SLOTS = 467;
const ATTRIBUTE_INVENTION_RESEARCH_SPEED = 1959;
const ATTRIBUTE_REACTION_TIME_MULTIPLIER = 2662;
const ATTRIBUTE_REACTION_SLOT_LIMIT = 2664;

const INDUSTRY_SKILL_TYPE_INDUSTRY = 3380;
const INDUSTRY_SKILL_TYPE_MASS_PRODUCTION = 3387;
const INDUSTRY_SKILL_TYPE_ADVANCED_INDUSTRY = 3388;
const INDUSTRY_SKILL_TYPE_SCIENCE = 3402;
const INDUSTRY_SKILL_TYPE_RESEARCH = 3403;
const INDUSTRY_SKILL_TYPE_LABORATORY_OPERATION = 3406;
const INDUSTRY_SKILL_TYPE_METALLURGY = 3409;
const INDUSTRY_SKILL_TYPE_ADVANCED_LABORATORY_OPERATION = 24624;
const INDUSTRY_SKILL_TYPE_ADVANCED_MASS_PRODUCTION = 24625;
const INDUSTRY_SKILL_TYPE_REACTIONS = 45746;
const INDUSTRY_SKILL_TYPE_MASS_REACTIONS = 45748;
const INDUSTRY_SKILL_TYPE_ADVANCED_MASS_REACTIONS = 45749;

const INDUSTRY_BASE_SLOT_LIMIT = 1;
const INDUSTRY_CHARACTER_ATTRIBUTE_IDS = Object.freeze([
  ATTRIBUTE_MANUFACTURE_SLOT_LIMIT,
  ATTRIBUTE_MANUFACTURE_TIME_MULTIPLIER,
  ATTRIBUTE_MANUFACTURING_TIME_RESEARCH_SPEED,
  ATTRIBUTE_COPY_SPEED_PERCENT,
  ATTRIBUTE_MINERAL_NEED_RESEARCH_SPEED,
  ATTRIBUTE_MAX_LABORATORY_SLOTS,
  ATTRIBUTE_INVENTION_RESEARCH_SPEED,
  ATTRIBUTE_REACTION_TIME_MULTIPLIER,
  ATTRIBUTE_REACTION_SLOT_LIMIT,
]);

const INDUSTRY_BRAIN_SKILL_TYPE_IDS = Object.freeze([
  INDUSTRY_SKILL_TYPE_INDUSTRY,
  INDUSTRY_SKILL_TYPE_MASS_PRODUCTION,
  INDUSTRY_SKILL_TYPE_ADVANCED_INDUSTRY,
  INDUSTRY_SKILL_TYPE_SCIENCE,
  INDUSTRY_SKILL_TYPE_RESEARCH,
  INDUSTRY_SKILL_TYPE_LABORATORY_OPERATION,
  INDUSTRY_SKILL_TYPE_METALLURGY,
  INDUSTRY_SKILL_TYPE_ADVANCED_LABORATORY_OPERATION,
  INDUSTRY_SKILL_TYPE_ADVANCED_MASS_PRODUCTION,
  INDUSTRY_SKILL_TYPE_REACTIONS,
  INDUSTRY_SKILL_TYPE_MASS_REACTIONS,
  INDUSTRY_SKILL_TYPE_ADVANCED_MASS_REACTIONS,
]);

let characterStateModule = null;
let skillStateModule = null;
let typeDogmaPayload = null;

function getCharacterStateModule() {
  if (!characterStateModule) {
    characterStateModule = require(path.join(__dirname, "../../../character/characterState"));
  }
  return characterStateModule;
}

function getSkillStateModule() {
  if (!skillStateModule) {
    skillStateModule = require(path.join(__dirname, "../../../skills/skillState"));
  }
  return skillStateModule;
}

function getTypeDogmaPayload() {
  if (!typeDogmaPayload) {
    typeDogmaPayload = readStaticTable(TABLE.TYPE_DOGMA);
  }
  return typeDogmaPayload || {};
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clampIndustrySkillLevel(value) {
  if (!Number.isFinite(Number(value))) {
    return 0;
  }
  return Math.max(0, Math.min(5, Math.trunc(Number(value))));
}

function applyIndustryPercentPerLevel(baseValue, percentPerLevel, level) {
  if (!(baseValue > 0) || !(level > 0) || !Number.isFinite(percentPerLevel)) {
    return baseValue;
  }
  return baseValue * Math.max(0, 1 + (percentPerLevel * level) / 100);
}

function roundIndustryAttributeValue(value) {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Number(value.toFixed(6));
}

function getCharacterIndustrySkillLevels(characterID) {
  const levels = new Map();
  const { getCharacterSkills } = getSkillStateModule();
  for (const skill of getCharacterSkills(toInt(characterID, 0))) {
    const typeID = toInt(skill && skill.typeID, 0);
    if (typeID <= 0) {
      continue;
    }
    levels.set(
      typeID,
      clampIndustrySkillLevel(
        skill &&
          (skill.effectiveSkillLevel ??
            skill.trainedSkillLevel ??
            skill.skillLevel),
      ),
    );
  }
  return levels;
}

function getCharacterIndustrySkillLevel(levels, typeID) {
  return clampIndustrySkillLevel(levels.get(typeID));
}

function getTypeDogmaEntry(typeID) {
  const payload = getTypeDogmaPayload();
  const typesByTypeID =
    payload && payload.typesByTypeID && typeof payload.typesByTypeID === "object"
      ? payload.typesByTypeID
      : {};
  return typesByTypeID[String(typeID)] || typesByTypeID[typeID] || null;
}

function getEffectTypeDogmaEntry(effectID) {
  const payload = getTypeDogmaPayload();
  const effectTypesByID =
    payload && payload.effectTypesByID && typeof payload.effectTypesByID === "object"
      ? payload.effectTypesByID
      : {};
  return effectTypesByID[String(effectID)] || effectTypesByID[effectID] || null;
}

function getAttributeDefaultValue(attributeID) {
  const payload = getTypeDogmaPayload();
  const attributeTypesByID =
    payload && payload.attributeTypesByID && typeof payload.attributeTypesByID === "object"
      ? payload.attributeTypesByID
      : {};
  const attributeRecord =
    attributeTypesByID[String(attributeID)] || attributeTypesByID[attributeID] || null;
  return toFiniteNumber(attributeRecord && attributeRecord.defaultValue, 0);
}

function buildIndustryBrainEffectDefinitions(characterID) {
  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return [];
  }

  const levels = getCharacterIndustrySkillLevels(numericCharacterID);
  const definitions = [];

  for (const skillTypeID of INDUSTRY_BRAIN_SKILL_TYPE_IDS) {
    const skillLevel = getCharacterIndustrySkillLevel(levels, skillTypeID);
    if (skillLevel <= 0) {
      continue;
    }

    const typeEntry = getTypeDogmaEntry(skillTypeID);
    if (!typeEntry || !Array.isArray(typeEntry.effects) || !typeEntry.attributes) {
      continue;
    }

    for (const effectID of typeEntry.effects) {
      const effectEntry = getEffectTypeDogmaEntry(effectID);
      const modifierInfo = Array.isArray(effectEntry && effectEntry.modifierInfo)
        ? effectEntry.modifierInfo
        : [];

      for (const modifier of modifierInfo) {
        if (
          !modifier ||
          modifier.domain !== "charID" ||
          modifier.func !== "ItemModifier"
        ) {
          continue;
        }

        const sourceAttributeID = toInt(modifier.modifyingAttributeID, 0);
        const targetAttributeID = toInt(modifier.modifiedAttributeID, 0);
        const operation = toInt(modifier.operation, 0);
        if (sourceAttributeID <= 0 || targetAttributeID <= 0) {
          continue;
        }

        let literalValue = 0;
        if (sourceAttributeID === 280) {
          literalValue = skillLevel;
        } else {
          const perLevelBase = toFiniteNumber(
            typeEntry.attributes[String(sourceAttributeID)] ??
              typeEntry.attributes[sourceAttributeID],
            getAttributeDefaultValue(sourceAttributeID),
          );
          literalValue = perLevelBase * skillLevel;
        }

        if (!Number.isFinite(literalValue) || literalValue === 0) {
          continue;
        }

        definitions.push({
          skillTypeID,
          targetAttributeID,
          operation,
          value: Number.isInteger(literalValue)
            ? literalValue
            : Number(literalValue.toFixed(6)),
        });
      }
    }
  }

  return definitions;
}

function resolveComputedIndustryAttributes(characterID) {
  const levels = getCharacterIndustrySkillLevels(characterID);
  const industryLevel = getCharacterIndustrySkillLevel(levels, INDUSTRY_SKILL_TYPE_INDUSTRY);
  const advancedIndustryLevel = getCharacterIndustrySkillLevel(levels, INDUSTRY_SKILL_TYPE_ADVANCED_INDUSTRY);
  const researchLevel = getCharacterIndustrySkillLevel(levels, INDUSTRY_SKILL_TYPE_RESEARCH);
  const metallurgyLevel = getCharacterIndustrySkillLevel(levels, INDUSTRY_SKILL_TYPE_METALLURGY);
  const scienceLevel = getCharacterIndustrySkillLevel(levels, INDUSTRY_SKILL_TYPE_SCIENCE);
  const reactionsLevel = getCharacterIndustrySkillLevel(levels, INDUSTRY_SKILL_TYPE_REACTIONS);

  return {
    [ATTRIBUTE_MANUFACTURE_SLOT_LIMIT]:
      INDUSTRY_BASE_SLOT_LIMIT +
      getCharacterIndustrySkillLevel(levels, INDUSTRY_SKILL_TYPE_MASS_PRODUCTION) +
      getCharacterIndustrySkillLevel(levels, INDUSTRY_SKILL_TYPE_ADVANCED_MASS_PRODUCTION),
    [ATTRIBUTE_MAX_LABORATORY_SLOTS]:
      INDUSTRY_BASE_SLOT_LIMIT +
      getCharacterIndustrySkillLevel(levels, INDUSTRY_SKILL_TYPE_LABORATORY_OPERATION) +
      getCharacterIndustrySkillLevel(levels, INDUSTRY_SKILL_TYPE_ADVANCED_LABORATORY_OPERATION),
    [ATTRIBUTE_REACTION_SLOT_LIMIT]:
      INDUSTRY_BASE_SLOT_LIMIT +
      getCharacterIndustrySkillLevel(levels, INDUSTRY_SKILL_TYPE_MASS_REACTIONS) +
      getCharacterIndustrySkillLevel(levels, INDUSTRY_SKILL_TYPE_ADVANCED_MASS_REACTIONS),
    [ATTRIBUTE_MANUFACTURE_TIME_MULTIPLIER]: roundIndustryAttributeValue(
      applyIndustryPercentPerLevel(
        applyIndustryPercentPerLevel(1, -4, industryLevel),
        -3,
        advancedIndustryLevel,
      ),
    ),
    [ATTRIBUTE_MANUFACTURING_TIME_RESEARCH_SPEED]: roundIndustryAttributeValue(
      applyIndustryPercentPerLevel(
        applyIndustryPercentPerLevel(1, -5, researchLevel),
        -3,
        advancedIndustryLevel,
      ),
    ),
    [ATTRIBUTE_COPY_SPEED_PERCENT]: roundIndustryAttributeValue(
      applyIndustryPercentPerLevel(
        applyIndustryPercentPerLevel(1, -5, scienceLevel),
        -3,
        advancedIndustryLevel,
      ),
    ),
    [ATTRIBUTE_MINERAL_NEED_RESEARCH_SPEED]: roundIndustryAttributeValue(
      applyIndustryPercentPerLevel(
        applyIndustryPercentPerLevel(1, -5, metallurgyLevel),
        -3,
        advancedIndustryLevel,
      ),
    ),
    [ATTRIBUTE_INVENTION_RESEARCH_SPEED]: roundIndustryAttributeValue(
      applyIndustryPercentPerLevel(1, -3, advancedIndustryLevel),
    ),
    [ATTRIBUTE_REACTION_TIME_MULTIPLIER]: roundIndustryAttributeValue(
      applyIndustryPercentPerLevel(1, -4, reactionsLevel),
    ),
  };
}

function resolveCharacterIndustryAttributes(characterID) {
  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return {};
  }

  const { getCharacterRecord } = getCharacterStateModule();
  const record = getCharacterRecord(numericCharacterID) || {};
  const source =
    record.characterAttributes && typeof record.characterAttributes === "object"
      ? record.characterAttributes
      : {};
  const computed = resolveComputedIndustryAttributes(numericCharacterID);

  return {
    [ATTRIBUTE_MANUFACTURE_SLOT_LIMIT]: toFiniteNumber(
      source[ATTRIBUTE_MANUFACTURE_SLOT_LIMIT] ?? computed[ATTRIBUTE_MANUFACTURE_SLOT_LIMIT],
      computed[ATTRIBUTE_MANUFACTURE_SLOT_LIMIT],
    ),
    [ATTRIBUTE_MANUFACTURE_TIME_MULTIPLIER]: toFiniteNumber(
      source[ATTRIBUTE_MANUFACTURE_TIME_MULTIPLIER] ?? computed[ATTRIBUTE_MANUFACTURE_TIME_MULTIPLIER],
      computed[ATTRIBUTE_MANUFACTURE_TIME_MULTIPLIER],
    ),
    [ATTRIBUTE_MANUFACTURING_TIME_RESEARCH_SPEED]: toFiniteNumber(
      source[ATTRIBUTE_MANUFACTURING_TIME_RESEARCH_SPEED] ?? computed[ATTRIBUTE_MANUFACTURING_TIME_RESEARCH_SPEED],
      computed[ATTRIBUTE_MANUFACTURING_TIME_RESEARCH_SPEED],
    ),
    [ATTRIBUTE_COPY_SPEED_PERCENT]: toFiniteNumber(
      source[ATTRIBUTE_COPY_SPEED_PERCENT] ?? computed[ATTRIBUTE_COPY_SPEED_PERCENT],
      computed[ATTRIBUTE_COPY_SPEED_PERCENT],
    ),
    [ATTRIBUTE_MINERAL_NEED_RESEARCH_SPEED]: toFiniteNumber(
      source[ATTRIBUTE_MINERAL_NEED_RESEARCH_SPEED] ?? computed[ATTRIBUTE_MINERAL_NEED_RESEARCH_SPEED],
      computed[ATTRIBUTE_MINERAL_NEED_RESEARCH_SPEED],
    ),
    [ATTRIBUTE_MAX_LABORATORY_SLOTS]: toFiniteNumber(
      source[ATTRIBUTE_MAX_LABORATORY_SLOTS] ?? computed[ATTRIBUTE_MAX_LABORATORY_SLOTS],
      computed[ATTRIBUTE_MAX_LABORATORY_SLOTS],
    ),
    [ATTRIBUTE_INVENTION_RESEARCH_SPEED]: toFiniteNumber(
      source[ATTRIBUTE_INVENTION_RESEARCH_SPEED] ?? computed[ATTRIBUTE_INVENTION_RESEARCH_SPEED],
      computed[ATTRIBUTE_INVENTION_RESEARCH_SPEED],
    ),
    [ATTRIBUTE_REACTION_TIME_MULTIPLIER]: toFiniteNumber(
      source[ATTRIBUTE_REACTION_TIME_MULTIPLIER] ?? computed[ATTRIBUTE_REACTION_TIME_MULTIPLIER],
      computed[ATTRIBUTE_REACTION_TIME_MULTIPLIER],
    ),
    [ATTRIBUTE_REACTION_SLOT_LIMIT]: toFiniteNumber(
      source[ATTRIBUTE_REACTION_SLOT_LIMIT] ?? computed[ATTRIBUTE_REACTION_SLOT_LIMIT],
      computed[ATTRIBUTE_REACTION_SLOT_LIMIT],
    ),
  };
}

function buildIndustryAttributeChangePayloads(session, characterID = null) {
  const numericCharacterID = toInt(
    characterID ?? session?.characterID ?? session?.charid,
    0,
  );
  if (numericCharacterID <= 0) {
    return [];
  }

  const attributes = resolveCharacterIndustryAttributes(numericCharacterID);
  const when =
    session && session._space && typeof session._space.simFileTime === "bigint"
      ? session._space.simFileTime
      : currentFileTime();

  return INDUSTRY_CHARACTER_ATTRIBUTE_IDS.map((attributeID) => [
    "OnModuleAttributeChanges",
    numericCharacterID,
    numericCharacterID,
    attributeID,
    when,
    attributes[attributeID],
    null,
    null,
  ]);
}

function syncIndustryCharacterModifiers(session, characterID = null) {
  if (!session || typeof session.sendNotification !== "function") {
    return false;
  }

  const changes = buildIndustryAttributeChangePayloads(session, characterID);
  if (changes.length <= 0) {
    return false;
  }

  session.sendNotification("OnModuleAttributeChanges", "clientID", [{
    type: "list",
    items: changes,
  }]);
  return true;
}

const INDUSTRY_BRAIN_PROVIDER = Object.freeze({
  key: "industry",
  buildCharacterEffects: buildIndustryBrainEffectDefinitions,
  syncCharacterAttributeState: syncIndustryCharacterModifiers,
});

module.exports = {
  INDUSTRY_BRAIN_PROVIDER,
  buildIndustryAttributeChangePayloads,
  buildIndustryBrainEffectDefinitions,
  resolveCharacterIndustryAttributes,
  syncIndustryCharacterModifiers,
};
