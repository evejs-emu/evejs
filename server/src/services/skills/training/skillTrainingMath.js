const path = require("path");

const config = require(path.join(__dirname, "../../../config"));
const {
  currentFileTime,
  normalizeBigInt,
} = require(path.join(__dirname, "../../_shared/serviceHelpers"));
const {
  resolveCharacterAccountID,
  resolveOmegaLicenseState,
} = require(path.join(__dirname, "../../newEdenStore/storeState"));
const {
  getTypeAttributeValue,
} = require(path.join(__dirname, "../../fitting/liveFittingState"));

const ATTRIBUTE_CHARISMA = 164;
const ATTRIBUTE_INTELLIGENCE = 165;
const ATTRIBUTE_MEMORY = 166;
const ATTRIBUTE_PERCEPTION = 167;
const ATTRIBUTE_WILLPOWER = 168;

const CLONE_STATE_ALPHA = 0;
const CLONE_STATE_OMEGA = 1;

const FILETIME_TICKS_PER_MINUTE = 600000000n;
const FILETIME_TICKS_PER_SECOND = 10000000n;
const DEFAULT_SKILL_RANK = 1;
const MAX_SKILL_LEVEL = 5;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeSkillRank(value) {
  const numeric = toFiniteNumber(value, DEFAULT_SKILL_RANK);
  return numeric > 0 ? numeric : DEFAULT_SKILL_RANK;
}

function cloneValue(value) {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, cloneValue(entryValue)]),
    );
  }
  return value;
}

function getSkillPointsForLevel(skillRank, level) {
  const normalizedLevel = Math.max(0, Math.min(MAX_SKILL_LEVEL, toInt(level, 0)));
  if (normalizedLevel <= 0) {
    return 0;
  }
  const normalizedRank = normalizeSkillRank(skillRank);
  return Math.ceil(
    normalizedRank * 250 * 2 ** (2.5 * (normalizedLevel - 1)),
  );
}

function getSkillLevelForPoints(skillRank, skillPoints) {
  const normalizedPoints = Math.max(0, toInt(skillPoints, 0));
  for (let level = MAX_SKILL_LEVEL; level >= 1; level -= 1) {
    if (normalizedPoints >= getSkillPointsForLevel(skillRank, level)) {
      return level;
    }
  }
  return 0;
}

function normalizeCharacterAttributes(characterRecord = {}) {
  const source =
    characterRecord && typeof characterRecord === "object"
      ? characterRecord.characterAttributes || {}
      : {};

  return {
    [ATTRIBUTE_CHARISMA]: toFiniteNumber(
      source[ATTRIBUTE_CHARISMA] ?? source.charisma,
      20,
    ),
    [ATTRIBUTE_INTELLIGENCE]: toFiniteNumber(
      source[ATTRIBUTE_INTELLIGENCE] ?? source.intelligence,
      20,
    ),
    [ATTRIBUTE_MEMORY]: toFiniteNumber(source[ATTRIBUTE_MEMORY] ?? source.memory, 20),
    [ATTRIBUTE_PERCEPTION]: toFiniteNumber(
      source[ATTRIBUTE_PERCEPTION] ?? source.perception,
      20,
    ),
    [ATTRIBUTE_WILLPOWER]: toFiniteNumber(
      source[ATTRIBUTE_WILLPOWER] ?? source.willpower,
      20,
    ),
  };
}

function resolveCloneGrade(characterID, accountID = 0) {
  const numericAccountID =
    toInt(accountID, 0) || resolveCharacterAccountID(toInt(characterID, 0));
  const omegaState = resolveOmegaLicenseState(numericAccountID);
  return omegaState && omegaState.hasLicense
    ? CLONE_STATE_OMEGA
    : CLONE_STATE_ALPHA;
}

function getCloneTrainingMultiplier(characterID, accountID = 0) {
  return resolveCloneGrade(characterID, accountID) === CLONE_STATE_OMEGA ? 1 : 0.5;
}

function getPrimaryAttributeID(skillTypeID) {
  return toInt(getTypeAttributeValue(skillTypeID, "primaryAttribute"), 0);
}

function getSecondaryAttributeID(skillTypeID) {
  return toInt(getTypeAttributeValue(skillTypeID, "secondaryAttribute"), 0);
}

function getBaseSkillPointsPerMinute(characterRecord, skillTypeID, accountID = 0) {
  const primaryAttributeID = getPrimaryAttributeID(skillTypeID);
  const secondaryAttributeID = getSecondaryAttributeID(skillTypeID);
  const attributes = normalizeCharacterAttributes(characterRecord);
  const primaryValue = toFiniteNumber(attributes[primaryAttributeID], 0);
  const secondaryValue = toFiniteNumber(attributes[secondaryAttributeID], 0);
  const omegaSpPerMinute = primaryValue + secondaryValue / 2;
  return omegaSpPerMinute * getCloneTrainingMultiplier(characterRecord.characterID, accountID);
}

function getGlobalTrainingSpeedMultiplier() {
  const numeric = toFiniteNumber(config.skillTrainingSpeed, 1);
  return numeric > 0 ? numeric : 1;
}

function getEffectiveSkillPointsPerMinute(characterRecord, skillTypeID, accountID = 0) {
  return (
    getBaseSkillPointsPerMinute(characterRecord, skillTypeID, accountID) *
    getGlobalTrainingSpeedMultiplier()
  );
}

function getTrainingDurationFiletimeTicks(remainingSkillPoints, skillPointsPerMinute) {
  const normalizedRemainingSkillPoints = Math.max(0, toFiniteNumber(remainingSkillPoints, 0));
  const normalizedSpPerMinute = toFiniteNumber(skillPointsPerMinute, 0);
  if (normalizedRemainingSkillPoints <= 0 || normalizedSpPerMinute <= 0) {
    return 0n;
  }

  const durationTicks = Math.floor(
    (normalizedRemainingSkillPoints / normalizedSpPerMinute) *
      Number(FILETIME_TICKS_PER_MINUTE),
  );
  return BigInt(Math.max(0, durationTicks));
}

function getEstimatedSkillPointsAtTime(
  startSkillPoints,
  destinationSkillPoints,
  startFileTime,
  sampleFileTime,
  skillPointsPerMinute,
) {
  const startTicks = normalizeBigInt(startFileTime, 0n);
  const sampleTicks = normalizeBigInt(sampleFileTime, 0n);
  const fromSkillPoints = Math.max(0, toInt(startSkillPoints, 0));
  const toSkillPoints = Math.max(fromSkillPoints, toInt(destinationSkillPoints, fromSkillPoints));
  if (sampleTicks <= startTicks) {
    return fromSkillPoints;
  }

  const normalizedSpPerMinute = toFiniteNumber(skillPointsPerMinute, 0);
  if (normalizedSpPerMinute <= 0) {
    return fromSkillPoints;
  }

  const elapsedTicks = sampleTicks - startTicks;
  const gainedPoints = Math.floor(
    (Number(elapsedTicks) / Number(FILETIME_TICKS_PER_MINUTE)) * normalizedSpPerMinute,
  );
  return Math.max(
    fromSkillPoints,
    Math.min(toSkillPoints, fromSkillPoints + Math.max(0, gainedPoints)),
  );
}

function buildFiletimeString(value) {
  return normalizeBigInt(value, currentFileTime()).toString();
}

let nowOverride = null;

function getNowFileTime() {
  if (typeof nowOverride === "function") {
    return normalizeBigInt(nowOverride(), currentFileTime());
  }
  return currentFileTime();
}

function setNowFileTimeOverride(fn) {
  nowOverride = typeof fn === "function" ? fn : null;
}

function resetNowFileTimeOverride() {
  nowOverride = null;
}

module.exports = {
  ATTRIBUTE_CHARISMA,
  ATTRIBUTE_INTELLIGENCE,
  ATTRIBUTE_MEMORY,
  ATTRIBUTE_PERCEPTION,
  ATTRIBUTE_WILLPOWER,
  CLONE_STATE_ALPHA,
  CLONE_STATE_OMEGA,
  FILETIME_TICKS_PER_MINUTE,
  FILETIME_TICKS_PER_SECOND,
  MAX_SKILL_LEVEL,
  buildFiletimeString,
  cloneValue,
  getBaseSkillPointsPerMinute,
  getCloneTrainingMultiplier,
  getEffectiveSkillPointsPerMinute,
  getEstimatedSkillPointsAtTime,
  getGlobalTrainingSpeedMultiplier,
  getNowFileTime,
  getPrimaryAttributeID,
  getSecondaryAttributeID,
  getSkillLevelForPoints,
  getSkillPointsForLevel,
  getTrainingDurationFiletimeTicks,
  normalizeCharacterAttributes,
  normalizeSkillRank,
  resolveCloneGrade,
  setNowFileTimeOverride,
  resetNowFileTimeOverride,
};
