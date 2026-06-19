const path = require("path");

const database = require(path.join(__dirname, "../../../newDatabase"));
const alphaCapsResult = database.read("skillTrainingAlphaCaps", "/");
const alphaCapsAuthority = alphaCapsResult.success ? alphaCapsResult.data : {};
const {
  getCharacterRecord,
} = require(path.join(__dirname, "../../character/characterState"));
const {
  getCharacterCreationRaces,
} = require(path.join(__dirname, "../../character/characterCreationData"));
const {
  resolveCharacterAccountID,
  resolveOmegaLicenseState,
} = require(path.join(__dirname, "../../newEdenStore/storeState"));
const {
  getCharacterBaseSkills,
} = require(path.join(__dirname, "../skillState"));
const {
  CLONE_STATE_ALPHA,
  CLONE_STATE_OMEGA,
  getSkillPointsForLevel,
} = require("./skillTrainingMath");

const ALPHA_MAX_TRAINING_SP = 5000000;
const MAX_SKILL_LEVEL = 5;

let alphaCapsByTypeIDCache = null;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
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

function getAlphaCapsByTypeID() {
  if (alphaCapsByTypeIDCache) {
    return alphaCapsByTypeIDCache;
  }

  const authorityCaps =
    alphaCapsAuthority &&
    typeof alphaCapsAuthority === "object" &&
    alphaCapsAuthority.capsByTypeID &&
    typeof alphaCapsAuthority.capsByTypeID === "object"
      ? alphaCapsAuthority.capsByTypeID
      : {};
  const nextCache = new Map();
  for (const [typeID, maxLevel] of Object.entries(authorityCaps)) {
    const numericTypeID = toInt(typeID, 0);
    const numericLevel = Math.max(0, Math.min(MAX_SKILL_LEVEL, toInt(maxLevel, 0)));
    if (numericTypeID > 0) {
      nextCache.set(numericTypeID, numericLevel);
    }
  }
  alphaCapsByTypeIDCache = nextCache;
  return alphaCapsByTypeIDCache;
}

function resolveCharacterCloneGrade(characterID, accountID = 0) {
  const numericAccountID =
    toInt(accountID, 0) || resolveCharacterAccountID(toInt(characterID, 0));
  const omegaState = resolveOmegaLicenseState(numericAccountID);
  return omegaState && omegaState.hasLicense
    ? CLONE_STATE_OMEGA
    : CLONE_STATE_ALPHA;
}

function getMaxTrainableLevelForClone(skillTypeID, options = {}) {
  const cloneGrade =
    options.cloneGrade !== undefined && options.cloneGrade !== null
      ? toInt(options.cloneGrade, CLONE_STATE_ALPHA)
      : resolveCharacterCloneGrade(options.characterID, options.accountID);

  if (cloneGrade === CLONE_STATE_OMEGA) {
    return MAX_SKILL_LEVEL;
  }

  return getAlphaCapsByTypeID().get(toInt(skillTypeID, 0)) || 0;
}

function isSkillLevelRestrictedForClone(skillTypeID, level, options = {}) {
  return getMaxTrainableLevelForClone(skillTypeID, options) < toInt(level, 0);
}

function buildCurrentPointsBySkillType(skillRecords = []) {
  const currentPointsBySkillType = new Map();
  for (const record of Array.isArray(skillRecords) ? skillRecords : []) {
    const typeID = toInt(record && record.typeID, 0);
    if (typeID <= 0) {
      continue;
    }
    currentPointsBySkillType.set(
      typeID,
      Math.max(0, toInt(record.trainedSkillPoints ?? record.skillPoints, 0)),
    );
  }
  return currentPointsBySkillType;
}

function getCharacterTotalSkillPoints(characterID, skillRecords = null) {
  const sourceSkillRecords =
    Array.isArray(skillRecords) && skillRecords.length > 0
      ? skillRecords
      : getCharacterBaseSkills(characterID);
  return sourceSkillRecords.reduce(
    (sum, record) => sum + Math.max(0, toInt(record && (record.trainedSkillPoints ?? record.skillPoints), 0)),
    0,
  );
}

function getAlphaTrainingCapBreakdown(characterID, queueEntries = [], options = {}) {
  const cloneGrade =
    options.cloneGrade !== undefined && options.cloneGrade !== null
      ? toInt(options.cloneGrade, CLONE_STATE_ALPHA)
      : resolveCharacterCloneGrade(characterID, options.accountID);
  const sourceSkillRecords =
    Array.isArray(options.skillRecords) && options.skillRecords.length > 0
      ? options.skillRecords
      : getCharacterBaseSkills(characterID);
  const totalSkillPoints = getCharacterTotalSkillPoints(characterID, sourceSkillRecords);
  const currentPointsBySkillType = buildCurrentPointsBySkillType(sourceSkillRecords);
  const breakdown = [];
  let accumulatedSkillPoints = 0;
  let firstBlocked = null;

  for (const entry of Array.isArray(queueEntries) ? queueEntries : []) {
    const typeID = toInt(entry && (entry.typeID ?? entry.trainingTypeID), 0);
    const toLevel = toInt(entry && (entry.toLevel ?? entry.trainingToLevel), 0);
    const skillRank = Number(entry && entry.skillRank) || 1;
    if (typeID <= 0 || toLevel <= 0) {
      continue;
    }

    const maxLevel = getMaxTrainableLevelForClone(typeID, {
      ...options,
      cloneGrade,
      characterID,
    });
    const previousLevelPoints = getSkillPointsForLevel(skillRank, toLevel - 1);
    const thisLevelPoints = getSkillPointsForLevel(skillRank, toLevel);
    const totalSkillPointsInThisLevel = Math.max(0, thisLevelPoints - previousLevelPoints);
    const currentSkillPoints = currentPointsBySkillType.get(typeID) || 0;
    const skillPointsAlreadyTrainedThisLevel = Math.max(
      0,
      currentSkillPoints - previousLevelPoints,
    );
    const addedSkillPoints = Math.max(
      0,
      totalSkillPointsInThisLevel - skillPointsAlreadyTrainedThisLevel,
    );
    accumulatedSkillPoints += addedSkillPoints;
    const overAlphaTrainingCap =
      cloneGrade === CLONE_STATE_ALPHA &&
      totalSkillPoints + accumulatedSkillPoints > ALPHA_MAX_TRAINING_SP;
    const restrictedForClone = maxLevel < toLevel;
    const entryBreakdown = {
      queuePosition: toInt(entry && entry.queuePosition, breakdown.length),
      typeID,
      toLevel,
      maxTrainableLevel: maxLevel,
      addedSkillPoints,
      totalSkillPoints,
      projectedSkillPoints: totalSkillPoints + accumulatedSkillPoints,
      restrictedForClone,
      overAlphaTrainingCap,
    };
    breakdown.push(entryBreakdown);
    currentPointsBySkillType.set(typeID, Math.max(currentSkillPoints, thisLevelPoints));
    if (!firstBlocked && (restrictedForClone || overAlphaTrainingCap)) {
      firstBlocked = entryBreakdown;
    }
  }

  return {
    cloneGrade,
    totalSkillPoints,
    accumulatedSkillPoints,
    firstBlocked,
    entries: breakdown,
  };
}

function getAlphaGradeRestrictionsByRace(raceIDs = null) {
  const requestedRaceIDs = Array.isArray(raceIDs) && raceIDs.length > 0
    ? raceIDs.map((raceID) => toInt(raceID, 0)).filter(Boolean)
    : getCharacterCreationRaces().map((race) => toInt(race && race.raceID, 0)).filter(Boolean);
  const alphaLimitSkills = [...getAlphaCapsByTypeID().entries()]
    .map(([typeID, maxTrainLevel]) => ({
      skillTypeID: typeID,
      maxTrainLevel,
    }))
    .sort((left, right) => left.skillTypeID - right.skillTypeID);

  return requestedRaceIDs.map((raceID) => ({
    raceID,
    alphaLimitSkills: cloneValue(alphaLimitSkills),
  }));
}

function getCharacterCloneRestrictionSummary(characterID, options = {}) {
  const characterRecord =
    options.characterRecord && typeof options.characterRecord === "object"
      ? options.characterRecord
      : getCharacterRecord(characterID) || {};
  const cloneGrade =
    options.cloneGrade !== undefined && options.cloneGrade !== null
      ? toInt(options.cloneGrade, CLONE_STATE_ALPHA)
      : resolveCharacterCloneGrade(characterID, options.accountID);

  return {
    cloneGrade,
    raceID: toInt(characterRecord.raceID, 0),
    alphaMaxTrainingSP: ALPHA_MAX_TRAINING_SP,
  };
}

module.exports = {
  ALPHA_MAX_TRAINING_SP,
  getAlphaCapsByTypeID,
  getAlphaGradeRestrictionsByRace,
  getAlphaTrainingCapBreakdown,
  getCharacterCloneRestrictionSummary,
  getCharacterTotalSkillPoints,
  getMaxTrainableLevelForClone,
  isSkillLevelRestrictedForClone,
  resolveCharacterCloneGrade,
};
