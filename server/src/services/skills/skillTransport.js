const path = require("path");

const {
  buildObjectEx1,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const CHARACTER_SKILL_ENTRY_CLASS =
  "characterskills.common.character_skill_entry.CharacterSkillEntry";

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toOptionalInt(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildCharacterSkillEntry(skillRecord, options = {}) {
  if (!skillRecord || typeof skillRecord !== "object") {
    return null;
  }

  const typeID = toInt(skillRecord.typeID, 0);
  if (typeID <= 0) {
    return null;
  }

  const trainedSkillLevel = toOptionalInt(skillRecord.trainedSkillLevel);
  const trainedSkillPoints = toOptionalInt(
    skillRecord.trainedSkillPoints ?? skillRecord.skillPoints,
  );
  const skillRank = Math.max(1, toInt(skillRecord.skillRank, 1));
  const virtualSkillLevel = toOptionalInt(skillRecord.virtualSkillLevel);

  const stateEntries = [];
  if (options.includeMetadata !== false) {
    stateEntries.push(
      ["itemID", toOptionalInt(skillRecord.itemID)],
      ["ownerID", toOptionalInt(skillRecord.ownerID)],
      ["locationID", toOptionalInt(skillRecord.locationID)],
      ["flagID", toOptionalInt(skillRecord.flagID)],
      ["groupID", toOptionalInt(skillRecord.groupID)],
      ["categoryID", toOptionalInt(skillRecord.categoryID)],
      ["groupName", skillRecord.groupName || ""],
      ["published", Boolean(skillRecord.published)],
      ["inTraining", Boolean(skillRecord.inTraining)],
    );
  }

  return buildObjectEx1(
    CHARACTER_SKILL_ENTRY_CLASS,
    [
      typeID,
      trainedSkillLevel,
      trainedSkillPoints,
      skillRank,
      virtualSkillLevel,
    ],
    stateEntries,
  );
}

function buildCharacterSkillDict(skillRecords = [], options = {}) {
  const entriesByTypeID = new Map();
  for (const rawSkillRecord of Array.isArray(skillRecords) ? skillRecords : []) {
    const skillRecord = cloneValue(rawSkillRecord);
    const typeID = toInt(skillRecord && skillRecord.typeID, 0);
    if (typeID > 0) {
      entriesByTypeID.set(typeID, skillRecord);
    }
  }

  return {
    type: "dict",
    entries: [...entriesByTypeID.entries()]
      .map(([typeID, skillRecord]) => [
        typeID,
        buildCharacterSkillEntry(skillRecord, options),
      ])
      .filter(([, payload]) => Boolean(payload)),
  };
}

module.exports = {
  CHARACTER_SKILL_ENTRY_CLASS,
  buildCharacterSkillDict,
  buildCharacterSkillEntry,
};
