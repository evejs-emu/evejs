const path = require("path");

const {
  getCharacterSkillMap,
} = require(path.join(__dirname, "../skills/skillState"));

const ATTRIBUTE_MAX_JUMP_CLONES = 979;
const ATTRIBUTE_CLONE_JUMP_COOLDOWN = 1921;

const TYPE_INFOMORPH_PSYCHOLOGY = 24242;
const TYPE_ADVANCED_INFOMORPH_PSYCHOLOGY = 33407;
const TYPE_ELITE_INFOMORPH_PSYCHOLOGY = 73910;
const TYPE_INFOMORPH_SYNCHRONIZING = 33399;
const TYPE_CLONE_VAT_BAY_I = 23735;

const STRUCTURE_SERVICE_MEDICAL = 6;
const STRUCTURE_SERVICE_JUMP_CLONE = 10;
const STRUCTURE_SERVICE_STATE_ONLINE = 1;

const JUMP_CLONE_INSTALL_COST = 900000;
const REF_JUMP_CLONE_INSTALLATION_FEE = 55;
const REF_JUMP_CLONE_ACTIVATION_FEE = 128;

const NOTIFICATION_TYPE_JUMP_CLONE_DELETED_1 = 56;
const NOTIFICATION_TYPE_JUMP_CLONE_DELETED_2 = 57;

const EVENT_CLONE_JUMP = 165;
const EVENT_CLONE_DESTRUCTION = 166;
const EVENT_CLONE_INSTALLATION = 167;
const EVENT_CLONE_IMPLANT_INSTALLATION = 168;
const EVENT_CLONE_JUMP_TIME_RESET = 169;
const EVENT_CLONE_DESTROYED_WITH_LOCATION = 190;
const EVENT_CLONE_IMPLANT_REMOVAL = 451;

const CLONE_NAME_MAX_LENGTH = 100;
const BASE_CLONE_JUMP_COOLDOWN_HOURS = 24;

function getSkillLevelFromRecord(record) {
  if (!record || typeof record !== "object") {
    return 0;
  }

  const level = Number(
    record.effectiveSkillLevel ??
      record.trainedSkillLevel ??
      record.skillLevel ??
      0,
  );
  if (!Number.isFinite(level)) {
    return 0;
  }
  return Math.max(0, Math.min(5, Math.trunc(level)));
}

function getCharacterSkillLevel(characterID, typeID) {
  const skillMap = getCharacterSkillMap(characterID);
  return getSkillLevelFromRecord(skillMap.get(Number(typeID) || 0));
}

function getCharacterCloneLimit(characterID) {
  const charID = Number(characterID || 0) || 0;
  if (!charID) {
    return 0;
  }

  return (
    getCharacterSkillLevel(charID, TYPE_INFOMORPH_PSYCHOLOGY) +
    getCharacterSkillLevel(charID, TYPE_ADVANCED_INFOMORPH_PSYCHOLOGY) +
    getCharacterSkillLevel(charID, TYPE_ELITE_INFOMORPH_PSYCHOLOGY)
  );
}

function getCharacterCloneJumpCooldownHours(characterID) {
  const level = getCharacterSkillLevel(
    characterID,
    TYPE_INFOMORPH_SYNCHRONIZING,
  );
  return Math.max(0, BASE_CLONE_JUMP_COOLDOWN_HOURS - level);
}

module.exports = {
  ATTRIBUTE_MAX_JUMP_CLONES,
  ATTRIBUTE_CLONE_JUMP_COOLDOWN,
  TYPE_INFOMORPH_PSYCHOLOGY,
  TYPE_ADVANCED_INFOMORPH_PSYCHOLOGY,
  TYPE_ELITE_INFOMORPH_PSYCHOLOGY,
  TYPE_INFOMORPH_SYNCHRONIZING,
  TYPE_CLONE_VAT_BAY_I,
  STRUCTURE_SERVICE_MEDICAL,
  STRUCTURE_SERVICE_JUMP_CLONE,
  STRUCTURE_SERVICE_STATE_ONLINE,
  JUMP_CLONE_INSTALL_COST,
  REF_JUMP_CLONE_INSTALLATION_FEE,
  REF_JUMP_CLONE_ACTIVATION_FEE,
  NOTIFICATION_TYPE_JUMP_CLONE_DELETED_1,
  NOTIFICATION_TYPE_JUMP_CLONE_DELETED_2,
  EVENT_CLONE_JUMP,
  EVENT_CLONE_DESTRUCTION,
  EVENT_CLONE_INSTALLATION,
  EVENT_CLONE_IMPLANT_INSTALLATION,
  EVENT_CLONE_JUMP_TIME_RESET,
  EVENT_CLONE_DESTROYED_WITH_LOCATION,
  EVENT_CLONE_IMPLANT_REMOVAL,
  CLONE_NAME_MAX_LENGTH,
  BASE_CLONE_JUMP_COOLDOWN_HOURS,
  getCharacterSkillLevel,
  getCharacterCloneLimit,
  getCharacterCloneJumpCooldownHours,
};
