const path = require("path");

const {
  getCharacterRecord,
  updateCharacterRecord,
} = require(path.join(__dirname, "../character/characterState"));
const {
  getCharacterCreationRace,
  resolveCharacterCreationBloodlineProfile,
} = require(path.join(__dirname, "../character/characterCreationData"));
const {
  getCharacterBaseSkillMap,
  replaceCharacterSkillRecords,
  setCharacterSkillBootstrapSuppressed,
} = require(path.join(__dirname, "./skillState"));
const {
  getQueueSnapshot,
  saveQueue,
} = require(path.join(__dirname, "./training/skillQueueRuntime"));

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function mapsEqualQueueEntries(leftEntries = [], rightEntries = []) {
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  for (let index = 0; index < leftEntries.length; index += 1) {
    const left = leftEntries[index];
    const right = rightEntries[index];
    if (
      toInt(left && left.trainingTypeID, 0) !== toInt(right && right.typeID, 0) ||
      toInt(left && left.trainingToLevel, 0) !== toInt(right && right.toLevel, 0)
    ) {
      return false;
    }
  }

  return true;
}

function buildSkillMap(skillRecords = []) {
  const skillMap = new Map();
  for (const skillRecord of Array.isArray(skillRecords) ? skillRecords : []) {
    const typeID = toInt(skillRecord && skillRecord.typeID, 0);
    if (typeID <= 0) {
      continue;
    }
    skillMap.set(typeID, cloneValue(skillRecord));
  }
  return skillMap;
}

function diffSkillMaps(previousSkillMap, nextSkillMap) {
  const changedSkillRecords = [];
  const removedSkillRecords = [];

  for (const [typeID, nextSkillRecord] of nextSkillMap.entries()) {
    const previousSkillRecord = previousSkillMap.get(typeID) || null;
    if (JSON.stringify(previousSkillRecord) !== JSON.stringify(nextSkillRecord)) {
      changedSkillRecords.push(cloneValue(nextSkillRecord));
    }
  }

  for (const [typeID, previousSkillRecord] of previousSkillMap.entries()) {
    if (!nextSkillMap.has(typeID)) {
      removedSkillRecords.push(cloneValue(previousSkillRecord));
    }
  }

  return {
    changedSkillRecords,
    removedSkillRecords,
  };
}

function resolveStarterSkillProfile(characterID) {
  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return null;
  }

  const characterRecord = getCharacterRecord(numericCharacterID);
  if (!characterRecord) {
    return null;
  }

  const bloodlineProfile = resolveCharacterCreationBloodlineProfile(
    characterRecord.bloodlineID,
    {
      raceID: characterRecord.raceID,
      corporationID: characterRecord.corporationID,
    },
  );
  const raceProfile = getCharacterCreationRace(
    bloodlineProfile.raceID || characterRecord.raceID,
  );
  if (!raceProfile || !Array.isArray(raceProfile.skills) || raceProfile.skills.length === 0) {
    return null;
  }

  return {
    characterID: numericCharacterID,
    bloodlineID: toInt(characterRecord.bloodlineID, bloodlineProfile.bloodlineID || 0),
    bloodlineName: bloodlineProfile.name || "",
    raceID: toInt(characterRecord.raceID, raceProfile.raceID || 0) || raceProfile.raceID,
    raceName: raceProfile.name || "",
    starterSkills: cloneValue(raceProfile.skills),
  };
}

function reconcileQueueForSkillMutation(characterID, policy = "prune_satisfied") {
  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return {
      snapshot: getQueueSnapshot(numericCharacterID),
      changed: false,
      cleared: false,
    };
  }

  const currentSnapshot = getQueueSnapshot(numericCharacterID);
  const previousQueueEntries = Array.isArray(currentSnapshot.queueEntries)
    ? currentSnapshot.queueEntries
    : [];
  if (policy === "clear") {
    const queueChanged = previousQueueEntries.length > 0 || currentSnapshot.active;
    const snapshot = saveQueue(
      numericCharacterID,
      [],
      {
        activate: false,
        emitNotifications: false,
      },
    );
    return {
      snapshot,
      changed: queueChanged,
      cleared: queueChanged,
    };
  }

  const skillMap = getCharacterBaseSkillMap(numericCharacterID);
  const filteredEntries = previousQueueEntries
    .filter((entry) => {
      const typeID = toInt(entry && entry.trainingTypeID, 0);
      const toLevel = toInt(entry && entry.trainingToLevel, 0);
      if (typeID <= 0 || toLevel <= 0) {
        return false;
      }
      const skillRecord = skillMap.get(typeID);
      if (!skillRecord) {
        return false;
      }
      return toInt(skillRecord.trainedSkillLevel, 0) < toLevel;
    })
    .map((entry) => ({
      typeID: toInt(entry.trainingTypeID, 0),
      toLevel: toInt(entry.trainingToLevel, 0),
    }));

  const queueUnchanged =
    currentSnapshot.active === (filteredEntries.length > 0 && currentSnapshot.active) &&
    mapsEqualQueueEntries(previousQueueEntries, filteredEntries);
  if (queueUnchanged) {
    return {
      snapshot: currentSnapshot,
      changed: false,
      cleared: false,
    };
  }

  const snapshot = saveQueue(
    numericCharacterID,
    filteredEntries,
    {
      activate: currentSnapshot.active && filteredEntries.length > 0,
      emitNotifications: false,
    },
  );
  return {
    snapshot,
    changed: true,
    cleared: filteredEntries.length === 0 && previousQueueEntries.length > 0,
  };
}

function resetCharacterSkillsToStarterProfile(characterID, options = {}) {
  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return {
      success: false,
      errorMsg: "INVALID_CHARACTER",
    };
  }

  const starterProfile = resolveStarterSkillProfile(numericCharacterID);
  if (!starterProfile) {
    return {
      success: false,
      errorMsg: "STARTER_PROFILE_NOT_FOUND",
    };
  }

  const previousSkillMap = getCharacterBaseSkillMap(numericCharacterID);
  const starterSkillRecords = starterProfile.starterSkills.map((entry) => ({
    typeID: toInt(entry.typeID, 0),
    skillLevel: Math.max(0, Math.min(5, toInt(entry.level, 0))),
  }));
  const replaceResult = replaceCharacterSkillRecords(
    numericCharacterID,
    starterSkillRecords,
  );
  if (!replaceResult || !replaceResult.success) {
    return {
      success: false,
      errorMsg: replaceResult && replaceResult.errorMsg
        ? replaceResult.errorMsg
        : "WRITE_ERROR",
    };
  }

  setCharacterSkillBootstrapSuppressed(numericCharacterID, false);
  updateCharacterRecord(numericCharacterID, (record) => ({
    ...record,
    freeSkillPoints:
      options.resetFreeSkillPoints === false ? record.freeSkillPoints : 0,
    finishedSkills: [],
  }));

  const queueResult = reconcileQueueForSkillMutation(numericCharacterID, "clear");
  const nextSkillMap = buildSkillMap(replaceResult.data);
  const diffResult = diffSkillMaps(previousSkillMap, nextSkillMap);
  const characterRecord = getCharacterRecord(numericCharacterID) || {};

  return {
    success: true,
    data: {
      starterProfile,
      previousSkillMap,
      nextSkillMap,
      changedSkillRecords: diffResult.changedSkillRecords,
      removedSkillRecords: diffResult.removedSkillRecords,
      queueSnapshot: queueResult.snapshot,
      freeSkillPoints: Math.max(0, toInt(characterRecord.freeSkillPoints, 0)),
      totalSkillPoints: Math.max(0, toInt(characterRecord.skillPoints, 0)),
    },
  };
}

module.exports = {
  reconcileQueueForSkillMutation,
  resetCharacterSkillsToStarterProfile,
  resolveStarterSkillProfile,
};
