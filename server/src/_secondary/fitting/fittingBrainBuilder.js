const path = require("path");

const {
  getCharacterSkills,
} = require(path.join(__dirname, "../../services/skills/skillState"));
const {
  buildSkillEffectiveAttributes,
  getTypeEffectRecords,
} = require(path.join(__dirname, "../../services/fitting/liveFittingState"));

const INDUSTRY_CHARACTER_ATTRIBUTE_IDS = new Set([
  196,
  219,
  385,
  387,
  398,
  467,
  1959,
  2662,
  2664,
]);

const BRAIN_MODIFIER_TYPE_BY_FUNC = Object.freeze({
  ItemModifier: Object.freeze({
    modifierType: "M",
    buildExtras() {
      return [];
    },
  }),
  LocationModifier: Object.freeze({
    modifierType: "L",
    buildExtras() {
      return [];
    },
  }),
  LocationGroupModifier: Object.freeze({
    modifierType: "LG",
    buildExtras(modifierInfo) {
      const groupID = toInt(modifierInfo && modifierInfo.groupID, 0);
      return groupID > 0 ? [groupID] : null;
    },
  }),
  LocationRequiredSkillModifier: Object.freeze({
    modifierType: "LRS",
    buildExtras(modifierInfo) {
      const skillTypeID = toInt(modifierInfo && modifierInfo.skillTypeID, 0);
      return skillTypeID > 0 ? [skillTypeID] : null;
    },
  }),
  OwnerRequiredSkillModifier: Object.freeze({
    modifierType: "ORS",
    buildExtras(modifierInfo) {
      const skillTypeID = toInt(modifierInfo && modifierInfo.skillTypeID, 0);
      return skillTypeID > 0 ? [skillTypeID] : null;
    },
  }),
});

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function round6(value) {
  return Number(toFiniteNumber(value, 0).toFixed(6));
}

function getNormalizedBrainDomain(domain) {
  switch (String(domain || "")) {
    case "charID":
      return "character";
    case "shipID":
      return "ship";
    case "structureID":
      return "structure";
    default:
      return null;
  }
}

function normalizeSkillLevel(skill) {
  return Math.max(
    0,
    Math.min(
      5,
      toInt(
        skill &&
          (skill.effectiveSkillLevel ??
            skill.trainedSkillLevel ??
            skill.skillLevel),
        0,
      ),
    ),
  );
}

function shouldIncludeCharacterTargetAttribute(attributeID) {
  return !INDUSTRY_CHARACTER_ATTRIBUTE_IDS.has(toInt(attributeID, 0));
}

function buildFittingBrainEffectDefinition(skill, skillAttributes, modifierInfo) {
  const funcInfo =
    BRAIN_MODIFIER_TYPE_BY_FUNC[String(modifierInfo && modifierInfo.func) || ""] ||
    null;
  if (!funcInfo) {
    return null;
  }

  const domain = getNormalizedBrainDomain(modifierInfo && modifierInfo.domain);
  if (!domain) {
    return null;
  }

  const skillTypeID = toInt(skill && skill.typeID, 0);
  const targetAttributeID = toInt(modifierInfo && modifierInfo.modifiedAttributeID, 0);
  const sourceAttributeID = toInt(modifierInfo && modifierInfo.modifyingAttributeID, 0);
  const operation = toInt(modifierInfo && modifierInfo.operation, 0);
  if (skillTypeID <= 0 || targetAttributeID <= 0 || sourceAttributeID <= 0) {
    return null;
  }

  if (
    domain === "character" &&
    !shouldIncludeCharacterTargetAttribute(targetAttributeID)
  ) {
    return null;
  }

  const extras = funcInfo.buildExtras(modifierInfo);
  if (extras === null) {
    return null;
  }

  const value = toFiniteNumber(skillAttributes[sourceAttributeID], NaN);
  if (!Number.isFinite(value) || Math.abs(value) <= 1e-9) {
    return null;
  }

  return {
    domain,
    skillTypeID,
    skills: [skillTypeID],
    targetAttributeID,
    operation,
    modifierType: funcInfo.modifierType,
    extras,
    value: round6(value),
  };
}

function compareBrainEffectDefinitions(left, right) {
  return (
    toInt(left && left.skillTypeID, 0) - toInt(right && right.skillTypeID, 0) ||
    String(left && left.modifierType || "").localeCompare(
      String(right && right.modifierType || ""),
    ) ||
    toInt(left && left.targetAttributeID, 0) -
      toInt(right && right.targetAttributeID, 0) ||
    toInt(left && left.operation, 0) - toInt(right && right.operation, 0) ||
    JSON.stringify(Array.isArray(left && left.extras) ? left.extras : []).localeCompare(
      JSON.stringify(Array.isArray(right && right.extras) ? right.extras : []),
    ) ||
    toFiniteNumber(left && left.value, 0) - toFiniteNumber(right && right.value, 0)
  );
}

function buildFittingBrainEffectDefinitions(characterID) {
  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return {
      characterEffects: [],
      shipEffects: [],
      structureEffects: [],
    };
  }

  const definitions = {
    characterEffects: [],
    shipEffects: [],
    structureEffects: [],
  };

  for (const skill of getCharacterSkills(numericCharacterID)) {
    const skillTypeID = toInt(skill && skill.typeID, 0);
    if (skillTypeID <= 0 || normalizeSkillLevel(skill) <= 0) {
      continue;
    }

    const skillAttributes = buildSkillEffectiveAttributes(skill);
    for (const effectRecord of getTypeEffectRecords(skillTypeID)) {
      for (const modifierInfo of effectRecord && effectRecord.modifierInfo || []) {
        const definition = buildFittingBrainEffectDefinition(
          skill,
          skillAttributes,
          modifierInfo,
        );
        if (!definition) {
          continue;
        }

        switch (definition.domain) {
          case "character":
            definitions.characterEffects.push(definition);
            break;
          case "ship":
            definitions.shipEffects.push(definition);
            break;
          case "structure":
            definitions.structureEffects.push(definition);
            break;
          default:
            break;
        }
      }
    }
  }

  definitions.characterEffects.sort(compareBrainEffectDefinitions);
  definitions.shipEffects.sort(compareBrainEffectDefinitions);
  definitions.structureEffects.sort(compareBrainEffectDefinitions);
  return definitions;
}

module.exports = {
  buildFittingBrainEffectDefinitions,
};
