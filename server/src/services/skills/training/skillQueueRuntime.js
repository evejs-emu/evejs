const path = require("path");

const {
  throwWrappedUserError,
} = require(path.join(__dirname, "../../../common/machoErrors"));
const {
  getCharacterRecord,
  updateCharacterRecord,
} = require(path.join(__dirname, "../../character/characterState"));
const {
  buildSkillRecord,
  getCharacterBaseSkillMap,
  getCharacterBaseSkills,
  getSkillMutationVersion,
  getSkillTypeByID,
  replaceCharacterSkillRecords,
} = require(path.join(__dirname, "../skillState"));
const {
  getRequiredSkillRequirements,
} = require(path.join(__dirname, "../../fitting/liveFittingState"));
const {
  resolveCharacterAccountID,
  getTrainingSlotsForAccount,
} = require(path.join(__dirname, "../../newEdenStore/storeState"));
const {
  buildFiletimeLong,
  normalizeBigInt,
} = require(path.join(__dirname, "../../_shared/serviceHelpers"));
const {
  buildFiletimeString,
  cloneValue,
  FILETIME_TICKS_PER_SECOND,
  getEffectiveSkillPointsPerMinute,
  getEstimatedSkillPointsAtTime,
  getGlobalTrainingSpeedMultiplier,
  getNowFileTime,
  getSkillLevelForPoints,
  getSkillPointsForLevel,
  getTrainingDurationFiletimeTicks,
} = require("./skillTrainingMath");
const {
  getAllQueueStates,
  getCharacterQueueState,
  getQueueMutationVersion,
  setCharacterQueueState,
} = require("./skillQueueState");
const {
  notifyFreeSkillPointsChanged,
  notifyMultipleCharacterTrainingUpdated,
  notifySkillQueuePaused,
  notifySkillQueueSaved,
  notifySkillStateChanged,
} = require("./skillQueueNotifications");
const {
  ALPHA_MAX_TRAINING_SP,
  getAlphaTrainingCapBreakdown,
  getMaxTrainableLevelForClone,
  isSkillLevelRestrictedForClone,
  resolveCharacterCloneGrade,
} = require("./skillCloneRestrictions");
const {
  recordRecentSkillPointChanges,
} = require(path.join(__dirname, "../certificates/skillChangeTracker"));

const SKILLQUEUE_MAX_NUM_SKILLS = 150;
const SKILLQUEUE_TIME_LIMIT_TICKS = 10n * 365n * 24n * 60n * 60n * FILETIME_TICKS_PER_SECOND;

const SKILL_EVENT_TRAINING_STARTED = 36;
const SKILL_EVENT_TRAINING_COMPLETE = 37;
const SKILL_EVENT_TRAINING_CANCELLED = 38;
const SKILL_EVENT_QUEUE_TRAINING_COMPLETED = 53;
const SKILL_EVENT_FREE_SKILL_POINTS_USED = 307;

const snapshotCache = new Map();
const schedulerHandles = new Map();

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function buildKeyVal(entries) {
  return {
    type: "object",
    name: "util.KeyVal",
    args: {
      type: "dict",
      entries,
    },
  };
}

function buildDict(entries = []) {
  return {
    type: "dict",
    entries,
  };
}

function unwrapValue(value) {
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  if (value && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "value")) {
      return unwrapValue(value.value);
    }
    if (value.type === "int" || value.type === "long") {
      return unwrapValue(value.value);
    }
  }
  return value;
}

function readBooleanKwarg(kwargs, key, fallback = false) {
  if (!kwargs) {
    return fallback;
  }

  if (kwargs.type === "dict" && Array.isArray(kwargs.entries)) {
    const entry = kwargs.entries.find(([entryKey]) => entryKey === key);
    if (!entry) {
      return fallback;
    }
    return Boolean(unwrapValue(entry[1]));
  }

  if (typeof kwargs === "object" && Object.prototype.hasOwnProperty.call(kwargs, key)) {
    return Boolean(unwrapValue(kwargs[key]));
  }

  return fallback;
}

function normalizeQueueInput(queueInfo) {
  if (!queueInfo) {
    return [];
  }

  const entries = [];
  const sourceEntries =
    queueInfo instanceof Map
      ? [...queueInfo.entries()]
      : queueInfo && queueInfo.type === "dict" && Array.isArray(queueInfo.entries)
        ? queueInfo.entries
        : Array.isArray(queueInfo)
          ? queueInfo.map((value, index) => [index, value])
          : Object.entries(queueInfo);

  for (const [rawPosition, rawValue] of sourceEntries) {
    const queuePosition = toInt(unwrapValue(rawPosition), -1);
    let normalizedValue = rawValue;
    if (
      Array.isArray(rawValue) &&
      rawValue.length >= 2 &&
      typeof rawValue[0] !== "string"
    ) {
      normalizedValue = {
        trainingTypeID: unwrapValue(rawValue[0]),
        trainingToLevel: unwrapValue(rawValue[1]),
      };
    }

    const typeID = toInt(
      unwrapValue(
        normalizedValue &&
          typeof normalizedValue === "object" &&
          !Array.isArray(normalizedValue)
          ? normalizedValue.trainingTypeID ?? normalizedValue.typeID
          : Array.isArray(normalizedValue)
            ? normalizedValue[0]
            : null,
      ),
      0,
    );
    const toLevel = toInt(
      unwrapValue(
        normalizedValue &&
          typeof normalizedValue === "object" &&
          !Array.isArray(normalizedValue)
          ? normalizedValue.trainingToLevel ?? normalizedValue.toLevel
          : Array.isArray(normalizedValue)
            ? normalizedValue[1]
            : null,
      ),
      0,
    );
    if (queuePosition < 0 || typeID <= 0 || toLevel <= 0) {
      continue;
    }
    entries.push({
      queuePosition,
      typeID,
      toLevel,
    });
  }

  return entries.sort((left, right) => left.queuePosition - right.queuePosition);
}

function getCharacterIDFromSession(session) {
  return toInt(
    session && (session.characterID || session.charid || session.userid),
    0,
  );
}

function getCharacterAccountID(characterID, session = null) {
  return (
    toInt(session && session.userid, 0) ||
    resolveCharacterAccountID(toInt(characterID, 0))
  );
}

function getAvailableTrainingSlotCount(accountID) {
  const numericAccountID = toInt(accountID, 0);
  let slotCount = 1;
  const now = getNowFileTime();
  const extraSlots = getTrainingSlotsForAccount(numericAccountID);
  for (const expiryValue of Object.values(extraSlots || {})) {
    const expiry = normalizeBigInt(expiryValue, 0n);
    if (expiry > now) {
      slotCount += 1;
    }
  }
  return slotCount;
}

function getActiveTrainingCharacterIDsForAccount(accountID) {
  const numericAccountID = toInt(accountID, 0);
  if (numericAccountID <= 0) {
    return [];
  }

  const activeCharacterIDs = [];
  for (const characterID of Object.keys(getAllQueueStates())) {
    const numericCharacterID = toInt(characterID, 0);
    if (numericCharacterID <= 0) {
      continue;
    }
    if (getCharacterAccountID(numericCharacterID) !== numericAccountID) {
      continue;
    }
    const state = getCharacterQueueState(numericCharacterID);
    if (state.active && state.queue.length > 0) {
      activeCharacterIDs.push(numericCharacterID);
    }
  }

  return activeCharacterIDs;
}

function appendSkillHistoryEntry(characterID, eventTypeID, skillTypeID, absolutePoints, level) {
  updateCharacterRecord(characterID, (record) => {
    const skillHistory = Array.isArray(record.skillHistory) ? [...record.skillHistory] : [];
    skillHistory.unshift({
      logDate: buildFiletimeString(getNowFileTime()),
      eventTypeID: toInt(eventTypeID, 0),
      skillTypeID: toInt(skillTypeID, 0),
      absolutePoints: Math.max(0, toInt(absolutePoints, 0)),
      level: Math.max(0, toInt(level, 0)),
    });
    return {
      ...record,
      skillHistory: skillHistory.slice(0, 100),
    };
  });
}

function updateFinishedSkills(characterID, finishedSkills = []) {
  updateCharacterRecord(characterID, (record) => ({
    ...record,
    finishedSkills: Array.isArray(finishedSkills) ? cloneValue(finishedSkills) : [],
  }));
}

function clearSnapshotCache(characterID) {
  if (characterID) {
    snapshotCache.delete(String(characterID));
    return;
  }
  snapshotCache.clear();
}

function getSkillRecordForProjection(characterID, skillMap, typeID, options = {}) {
  const existingSkillRecord = skillMap.get(typeID);
  if (existingSkillRecord) {
    return cloneValue(existingSkillRecord);
  }

  if (options.allowSynthetic !== true) {
    return null;
  }

  const skillType = getSkillTypeByID(typeID);
  if (!skillType) {
    return null;
  }

  return buildSkillRecord(characterID, skillType, 0);
}

function buildSatisfiedSkillRecord(characterID, skillRecord, toLevel, skillPoints) {
  const nextSkillPoints = Math.max(0, toInt(skillPoints, 0));
  const nextSkillLevel = getSkillLevelForPoints(skillRecord.skillRank, nextSkillPoints);
  return {
    ...cloneValue(skillRecord),
    skillLevel: nextSkillLevel,
    trainedSkillLevel: nextSkillLevel,
    effectiveSkillLevel: nextSkillLevel,
    skillPoints: nextSkillPoints,
    trainedSkillPoints: nextSkillPoints,
    inTraining: false,
    trainingStartSP: nextSkillPoints,
    trainingDestinationSP: nextSkillPoints,
    trainingStartTime: null,
    trainingEndTime: null,
  };
}

function buildQueueCacheKey(characterRecord) {
  return JSON.stringify([
    getQueueMutationVersion(),
    getSkillMutationVersion(),
    getGlobalTrainingSpeedMultiplier(),
    characterRecord && characterRecord.freeSkillPoints,
    characterRecord && characterRecord.characterAttributes,
  ]);
}

function persistSkillMap(characterID, skillMap) {
  return replaceCharacterSkillRecords(
    characterID,
    [...skillMap.values()].map((record) => cloneValue(record)),
  );
}

function buildProjectedQueueEntries(characterID, characterRecord, queueState, skillMap, accountID) {
  const entries = [];
  if (!queueState.queue.length) {
    return {
      entries,
      queueEndTime: null,
      projectedSkillMap: new Map(
        [...skillMap.entries()].map(([typeID, record]) => [typeID, cloneValue(record)]),
      ),
    };
  }

  const projectedSkillMap = new Map(
    [...skillMap.entries()].map(([typeID, record]) => [typeID, cloneValue(record)]),
  );
  const queueActive = queueState.active === true;
  let nextStartTime = queueActive
    ? normalizeBigInt(queueState.activeStartTime, getNowFileTime())
    : null;

  for (let index = 0; index < queueState.queue.length; index += 1) {
    const entry = queueState.queue[index];
    const skillRecord = getSkillRecordForProjection(characterID, projectedSkillMap, entry.typeID);
    if (!skillRecord) {
      continue;
    }

    const trainingStartSP =
      toInt(skillRecord.trainedSkillLevel, 0) === entry.toLevel - 1
        ? Math.max(
            getSkillPointsForLevel(skillRecord.skillRank, entry.toLevel - 1),
            toInt(skillRecord.trainedSkillPoints, 0),
          )
        : getSkillPointsForLevel(skillRecord.skillRank, entry.toLevel - 1);
    const trainingDestinationSP = getSkillPointsForLevel(skillRecord.skillRank, entry.toLevel);
    const skillPointsPerMinute = getEffectiveSkillPointsPerMinute(
      {
        ...characterRecord,
        characterID,
      },
      entry.typeID,
      accountID,
    );
    const durationTicks = queueActive
      ? getTrainingDurationFiletimeTicks(
          trainingDestinationSP - trainingStartSP,
          skillPointsPerMinute,
        )
      : 0n;
    const trainingStartTime = queueActive ? nextStartTime : null;
    const trainingEndTime = queueActive && trainingStartTime !== null
      ? trainingStartTime + durationTicks
      : null;

    entries.push({
      queuePosition: index,
      trainingTypeID: entry.typeID,
      trainingToLevel: entry.toLevel,
      trainingStartSP,
      trainingDestinationSP,
      trainingStartTime,
      trainingEndTime,
      skillPointsPerMinute,
    });

    projectedSkillMap.set(
      entry.typeID,
      buildSatisfiedSkillRecord(
        characterID,
        skillRecord,
        entry.toLevel,
        trainingDestinationSP,
      ),
    );

    if (queueActive) {
      nextStartTime = trainingEndTime;
    }
  }

  return {
    entries,
    queueEndTime:
      entries.length > 0 ? entries[entries.length - 1].trainingEndTime : null,
    projectedSkillMap,
  };
}

function validateQueueEntries(characterID, characterRecord, queueEntries) {
  if (queueEntries.length > SKILLQUEUE_MAX_NUM_SKILLS) {
    throwWrappedUserError("QueueTooManySkills", {
      num: SKILLQUEUE_MAX_NUM_SKILLS,
    });
  }

  const skillMap = getCharacterBaseSkillMap(characterID);
  const projectedLevels = new Map(
    [...skillMap.entries()].map(([typeID, record]) => [
      typeID,
      {
        level: toInt(record.trainedSkillLevel, 0),
        points: toInt(record.trainedSkillPoints, 0),
        rank: toFiniteNumber(record.skillRank, 1),
      },
    ]),
  );

  const normalizedQueueState = {
    queue: queueEntries.map((entry) => ({
      typeID: entry.typeID,
      toLevel: entry.toLevel,
    })),
    active: true,
    activeStartTime: buildFiletimeString(getNowFileTime()),
  };
  const projectedQueue = buildProjectedQueueEntries(
    characterID,
    characterRecord,
    normalizedQueueState,
    skillMap,
    getCharacterAccountID(characterID),
  );
  const queueStartTime = normalizeBigInt(normalizedQueueState.activeStartTime, 0n);
  if (
    projectedQueue.queueEndTime &&
    projectedQueue.queueEndTime - queueStartTime > SKILLQUEUE_TIME_LIMIT_TICKS
  ) {
    throwWrappedUserError("QueueTooLong");
  }

  for (const entry of queueEntries) {
    const skillRecord = getSkillRecordForProjection(
      characterID,
      skillMap,
      entry.typeID,
    );
    if (!skillRecord) {
      throwWrappedUserError("QueueSkillNotUploaded");
    }
    if (entry.toLevel > 5) {
      throwWrappedUserError("QueueCannotTrainPastMaximumLevel");
    }
    if (
      isSkillLevelRestrictedForClone(entry.typeID, entry.toLevel, {
        characterID,
      })
    ) {
      throwWrappedUserError("QueueCannotTrainOmegaRestrictedSkill", {
        skillID: entry.typeID,
      });
    }

    const projectedState = projectedLevels.get(entry.typeID) || {
      level: 0,
      points: 0,
      rank: toFiniteNumber(skillRecord.skillRank, 1),
    };
    if (projectedState.level >= entry.toLevel) {
      throwWrappedUserError("QueueCannotTrainPreviouslyTrainedSkills");
    }
    if (projectedState.level < entry.toLevel - 1) {
      throwWrappedUserError("QueueCannotPlaceSkillLevelsOutOfOrder");
    }

    for (const requirement of getRequiredSkillRequirements(entry.typeID)) {
      const requirementState = projectedLevels.get(requirement.skillTypeID) || {
        level: 0,
      };
      if (toInt(requirementState.level, 0) < toInt(requirement.level, 0)) {
        throwWrappedUserError("QueueCannotPlaceSkillBeforeRequirements");
      }
    }

    projectedLevels.set(entry.typeID, {
      level: entry.toLevel,
      points: getSkillPointsForLevel(projectedState.rank, entry.toLevel),
      rank: projectedState.rank,
    });
  }
}

function settleCharacterTraining(characterID) {
  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return {
      settled: false,
      changedSkills: [],
      queueState: getCharacterQueueState(numericCharacterID),
    };
  }

  const characterRecord = getCharacterRecord(numericCharacterID);
  if (!characterRecord) {
    return {
      settled: false,
      changedSkills: [],
      queueState: getCharacterQueueState(numericCharacterID),
    };
  }

  const accountID = getCharacterAccountID(numericCharacterID);
  const queueState = getCharacterQueueState(numericCharacterID);
  const skillMap = getCharacterBaseSkillMap(numericCharacterID);
  const finishedSkills = [];
  const changedSkills = [];
  const recentSkillPointChanges = [];
  let queueDirty = false;
  let skillsDirty = false;
  const now = getNowFileTime();

  while (queueState.queue.length > 0) {
    const projectedQueue = buildProjectedQueueEntries(
      numericCharacterID,
      characterRecord,
      queueState,
      skillMap,
      accountID,
    );
    const currentEntry = projectedQueue.entries[0];
    if (!currentEntry) {
      break;
    }

    const currentSkillRecord = getSkillRecordForProjection(
      numericCharacterID,
      skillMap,
      currentEntry.trainingTypeID,
    );
    if (!currentSkillRecord) {
      queueState.queue.shift();
      queueState.active = queueState.queue.length > 0;
      queueState.activeStartTime =
        queueState.active && queueState.queue.length > 0
          ? buildFiletimeString(now)
          : null;
      queueDirty = true;
      continue;
    }

    const alreadySatisfied =
      toInt(currentSkillRecord.trainedSkillLevel, 0) >= currentEntry.trainingToLevel ||
      toInt(currentSkillRecord.trainedSkillPoints, 0) >= currentEntry.trainingDestinationSP;
    if (alreadySatisfied) {
      queueState.queue.shift();
      queueState.active = queueState.queue.length > 0;
      queueState.activeStartTime =
        queueState.active && queueState.queue.length > 0
          ? buildFiletimeString(now)
          : null;
      queueDirty = true;
      continue;
    }

    if (!queueState.active || !currentEntry.trainingEndTime || currentEntry.trainingEndTime > now) {
      break;
    }

    const completedRecord = buildSatisfiedSkillRecord(
      numericCharacterID,
      currentSkillRecord,
      currentEntry.trainingToLevel,
      currentEntry.trainingDestinationSP,
    );
    skillMap.set(currentEntry.trainingTypeID, completedRecord);
    changedSkills.push(cloneValue(completedRecord));
    recentSkillPointChanges.push({
      typeID: currentEntry.trainingTypeID,
      pointChange:
        Math.max(0, toInt(currentEntry.trainingDestinationSP, 0)) -
        Math.max(0, toInt(currentSkillRecord.trainedSkillPoints, 0)),
    });
    finishedSkills.push({
      skillTypeID: currentEntry.trainingTypeID,
      level: currentEntry.trainingToLevel,
    });
    appendSkillHistoryEntry(
      numericCharacterID,
      queueState.queue.length > 1
        ? SKILL_EVENT_QUEUE_TRAINING_COMPLETED
        : SKILL_EVENT_TRAINING_COMPLETE,
      currentEntry.trainingTypeID,
      currentEntry.trainingDestinationSP,
      currentEntry.trainingToLevel,
    );

    queueState.queue.shift();
    queueState.active = queueState.queue.length > 0;
    queueState.activeStartTime = queueState.active
      ? buildFiletimeString(currentEntry.trainingEndTime)
      : null;
    queueDirty = true;
    skillsDirty = true;
  }

  if (skillsDirty) {
    persistSkillMap(numericCharacterID, skillMap);
  }

  if (queueDirty) {
    setCharacterQueueState(numericCharacterID, queueState);
    clearSnapshotCache(numericCharacterID);
  }

  if (finishedSkills.length > 0) {
    updateFinishedSkills(numericCharacterID, finishedSkills);
    recordRecentSkillPointChanges(numericCharacterID, recentSkillPointChanges);
    notifySkillStateChanged(numericCharacterID, changedSkills, {
      timeStamp: buildFiletimeString(getNowFileTime()),
    });
    const updatedProjection = buildProjectedQueueEntries(
      numericCharacterID,
      characterRecord,
      queueState,
      skillMap,
      accountID,
    );
    notifySkillQueueSaved(numericCharacterID, updatedProjection.entries);
    if (!queueState.active || queueState.queue.length === 0) {
      notifySkillQueuePaused(numericCharacterID);
    }
  }

  return {
    settled: queueDirty || skillsDirty,
    changedSkills,
    finishedSkills,
    queueState,
  };
}

function buildSkillRecordProjection(characterID, snapshotEntry, baseSkillMap) {
  const skillRecord = getSkillRecordForProjection(
    characterID,
    baseSkillMap,
    snapshotEntry.trainingTypeID,
  );
  if (!skillRecord) {
    return null;
  }

  const now = getNowFileTime();
  const estimatedPoints = snapshotEntry.trainingStartTime && snapshotEntry.trainingEndTime
    ? getEstimatedSkillPointsAtTime(
        snapshotEntry.trainingStartSP,
        snapshotEntry.trainingDestinationSP,
        snapshotEntry.trainingStartTime,
        now,
        snapshotEntry.skillPointsPerMinute,
      )
    : snapshotEntry.trainingStartSP;
  const estimatedLevel = getSkillLevelForPoints(skillRecord.skillRank, estimatedPoints);

  return {
    ...cloneValue(skillRecord),
    skillLevel: estimatedLevel,
    trainedSkillLevel: estimatedLevel,
    effectiveSkillLevel: estimatedLevel,
    skillPoints: estimatedPoints,
    trainedSkillPoints: estimatedPoints,
    inTraining: true,
    trainingStartSP: snapshotEntry.trainingStartSP,
    trainingDestinationSP: snapshotEntry.trainingDestinationSP,
    trainingStartTime: buildFiletimeString(snapshotEntry.trainingStartTime),
    trainingEndTime: buildFiletimeString(snapshotEntry.trainingEndTime),
  };
}

function getQueueSnapshot(characterID, options = {}) {
  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return {
      characterID: 0,
      queueEntries: [],
      queuePayload: {
        type: "list",
        items: [],
      },
      queueEndTime: null,
      currentEntry: null,
      active: false,
      freeSkillPoints: 0,
      projectedSkills: [],
      projectedSkillMap: new Map(),
    };
  }

  settleCharacterTraining(numericCharacterID);
  const characterRecord = getCharacterRecord(numericCharacterID) || {};
  const cacheKey = buildQueueCacheKey(characterRecord);
  const cached = snapshotCache.get(String(numericCharacterID));
  const now = getNowFileTime();
  if (
    cached &&
    cached.cacheKey === cacheKey &&
    (!cached.nextBoundary || cached.nextBoundary > now)
  ) {
    const snapshot = cloneValue(cached.snapshot);
    const projectedSkillMap = new Map(
      (cached.projectedSkills || []).map((record) => [record.typeID, cloneValue(record)]),
    );
    if (snapshot.currentEntry && snapshot.active) {
      const liveProjection = buildSkillRecordProjection(
        numericCharacterID,
        {
          ...snapshot.currentEntry,
          trainingStartTime: normalizeBigInt(snapshot.currentEntry.trainingStartTime, 0n),
          trainingEndTime: normalizeBigInt(snapshot.currentEntry.trainingEndTime, 0n),
        },
        getCharacterBaseSkillMap(numericCharacterID),
      );
      if (liveProjection) {
        projectedSkillMap.set(liveProjection.typeID, liveProjection);
      }
    }
    return {
      ...snapshot,
      projectedSkillMap,
      projectedSkills: [...projectedSkillMap.values()].map((record) => cloneValue(record)),
    };
  }

  const accountID = getCharacterAccountID(numericCharacterID);
  const queueState = getCharacterQueueState(numericCharacterID);
  const skillMap = getCharacterBaseSkillMap(numericCharacterID);
  const projection = buildProjectedQueueEntries(
    numericCharacterID,
    characterRecord,
    queueState,
    skillMap,
    accountID,
  );
  const queueEntries = projection.entries.map((entry) => ({
    queuePosition: entry.queuePosition,
    trainingTypeID: entry.trainingTypeID,
    trainingToLevel: entry.trainingToLevel,
    trainingStartSP: entry.trainingStartSP,
    trainingDestinationSP: entry.trainingDestinationSP,
    trainingStartTime: entry.trainingStartTime
      ? buildFiletimeString(entry.trainingStartTime)
      : null,
    trainingEndTime: entry.trainingEndTime ? buildFiletimeString(entry.trainingEndTime) : null,
  }));
  const projectedSkillMap = new Map(
    getCharacterBaseSkills(numericCharacterID).map((record) => [record.typeID, record]),
  );
  const currentEntry = projection.entries[0] || null;
  if (currentEntry) {
    const projectedRecord = buildSkillRecordProjection(
      numericCharacterID,
      currentEntry,
      skillMap,
    );
    if (projectedRecord) {
      projectedSkillMap.set(projectedRecord.typeID, projectedRecord);
    }
  }

  const projectedSkills = [...projectedSkillMap.values()].map((record) => cloneValue(record));
  const snapshot = {
    characterID: numericCharacterID,
    accountID,
    active: queueState.active && queueEntries.length > 0,
    queueEntries,
    queuePayload: {
      type: "list",
      items: queueEntries.map((entry) =>
        buildKeyVal([
          ["queuePosition", entry.queuePosition],
          [
            "trainingStartTime",
            entry.trainingStartTime ? buildFiletimeLong(entry.trainingStartTime) : null,
          ],
          [
            "trainingEndTime",
            entry.trainingEndTime ? buildFiletimeLong(entry.trainingEndTime) : null,
          ],
          ["trainingTypeID", entry.trainingTypeID],
          ["trainingToLevel", entry.trainingToLevel],
          ["trainingStartSP", entry.trainingStartSP],
          ["trainingDestinationSP", entry.trainingDestinationSP],
        ]),
      ),
    },
    queueEndTime:
      queueEntries.length > 0 ? queueEntries[queueEntries.length - 1].trainingEndTime : null,
    currentEntry:
      currentEntry && queueEntries.length > 0
        ? {
            ...queueEntries[0],
            skillPointsPerMinute: currentEntry.skillPointsPerMinute,
          }
        : null,
    freeSkillPoints: Math.max(0, toInt(characterRecord.freeSkillPoints, 0)),
    projectedSkills,
    projectedSkillMap,
  };

  snapshotCache.set(String(numericCharacterID), {
    cacheKey,
    nextBoundary: currentEntry && currentEntry.trainingEndTime ? currentEntry.trainingEndTime : null,
    snapshot: cloneValue({
      ...snapshot,
      projectedSkillMap: undefined,
    }),
    projectedSkills: cloneValue(projectedSkills),
  });

  return snapshot;
}

function scheduleQueueCompletion(characterID) {
  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return;
  }

  const existingTimer = schedulerHandles.get(numericCharacterID);
  if (existingTimer) {
    clearTimeout(existingTimer);
    schedulerHandles.delete(numericCharacterID);
  }

  const snapshot = getQueueSnapshot(numericCharacterID);
  if (!snapshot.currentEntry || !snapshot.currentEntry.trainingEndTime) {
    return;
  }

  const now = getNowFileTime();
  const endTime = normalizeBigInt(snapshot.currentEntry.trainingEndTime, 0n);
  const diffMs = Number((endTime - now) / 10000n);
  const delayMs = Math.max(1000, Math.min(diffMs + 100, 2147483647));
  const timer = setTimeout(() => {
    schedulerHandles.delete(numericCharacterID);
    clearSnapshotCache(numericCharacterID);
    settleCharacterTraining(numericCharacterID);
    scheduleQueueCompletion(numericCharacterID);
  }, delayMs);
  if (typeof timer.unref === "function") {
    timer.unref();
  }
  schedulerHandles.set(numericCharacterID, timer);
}

function saveQueue(characterID, queueEntries, options = {}) {
  const numericCharacterID = toInt(characterID, 0);
  const characterRecord = getCharacterRecord(numericCharacterID);
  if (!characterRecord) {
    throwWrappedUserError("QueueSkillNotUploaded");
  }

  validateQueueEntries(numericCharacterID, characterRecord, queueEntries);
  const activate = options.activate !== false;
  const accountID = getCharacterAccountID(numericCharacterID);
  const currentState = getCharacterQueueState(numericCharacterID);
  const nextQueue = queueEntries.map((entry) => ({
    typeID: entry.typeID,
    toLevel: entry.toLevel,
  }));
  const cloneGrade = resolveCharacterCloneGrade(numericCharacterID, accountID);

  let nextActive = Boolean(activate && nextQueue.length > 0);
  const availableSlotCount = getAvailableTrainingSlotCount(accountID);
  const activeCharacters = getActiveTrainingCharacterIDsForAccount(accountID);
  const alreadyActive = activeCharacters.includes(numericCharacterID);
  if (nextActive && !alreadyActive && activeCharacters.length >= availableSlotCount) {
    throwWrappedUserError("UserAlreadyHasSkillInTraining");
  }
  if (nextActive && cloneGrade !== undefined) {
    for (const entry of nextQueue) {
      if (
        isSkillLevelRestrictedForClone(entry.typeID, entry.toLevel, {
          characterID: numericCharacterID,
          accountID,
          cloneGrade,
        })
      ) {
        throwWrappedUserError("SkillInQueueRequiresOmegaCloneState");
      }
    }

    const currentSnapshot = getQueueSnapshot(numericCharacterID);
    const capBreakdown = getAlphaTrainingCapBreakdown(
      numericCharacterID,
      nextQueue.map((entry) => {
        const skillRecord =
          currentSnapshot.projectedSkillMap.get(entry.typeID) ||
          getCharacterBaseSkillMap(numericCharacterID).get(entry.typeID);
        return {
          ...entry,
          skillRank: Number(skillRecord && skillRecord.skillRank) || 1,
        };
      }),
      {
        accountID,
        cloneGrade,
        skillRecords: currentSnapshot.projectedSkills,
      },
    );
    if (capBreakdown.firstBlocked && capBreakdown.firstBlocked.overAlphaTrainingCap) {
      throwWrappedUserError("SkillInQueueOverAlphaSpTrainingSize", {
        limit: ALPHA_MAX_TRAINING_SP,
      });
    }
  }

  const preserveActiveStart =
    currentState.active &&
    nextActive &&
    currentState.queue.length > 0 &&
    nextQueue.length > 0 &&
    currentState.queue[0].typeID === nextQueue[0].typeID &&
    currentState.queue[0].toLevel === nextQueue[0].toLevel &&
    currentState.activeStartTime;

  const nextState = {
    queue: nextQueue,
    active: nextActive,
    activeStartTime: nextActive
      ? preserveActiveStart || buildFiletimeString(getNowFileTime())
      : null,
  };
  setCharacterQueueState(numericCharacterID, nextState);
  clearSnapshotCache(numericCharacterID);

  const snapshot = getQueueSnapshot(numericCharacterID);
  const emitNotifications = options.emitNotifications !== false;
  if (emitNotifications) {
    notifySkillQueueSaved(numericCharacterID, snapshot.queueEntries);
  }
  if (nextActive && snapshot.currentEntry) {
    const startedFresh =
      !currentState.active ||
      !preserveActiveStart ||
      !currentState.queue.length ||
      currentState.queue[0].typeID !== snapshot.currentEntry.trainingTypeID ||
      currentState.queue[0].toLevel !== snapshot.currentEntry.trainingToLevel;
    if (startedFresh) {
    appendSkillHistoryEntry(
      numericCharacterID,
      SKILL_EVENT_TRAINING_STARTED,
      snapshot.currentEntry.trainingTypeID,
      snapshot.currentEntry.trainingStartSP,
      snapshot.currentEntry.trainingToLevel,
    );
    }
    scheduleQueueCompletion(numericCharacterID);
  } else if (!nextActive) {
    if (emitNotifications) {
      notifySkillQueuePaused(numericCharacterID);
    }
  }
  notifyMultipleCharacterTrainingUpdated(accountID);
  return snapshot;
}

function abortTraining(characterID, options = {}) {
  const numericCharacterID = toInt(characterID, 0);
  const queueState = getCharacterQueueState(numericCharacterID);
  if (!queueState.active || queueState.queue.length === 0) {
    return getQueueSnapshot(numericCharacterID);
  }

  const snapshot = getQueueSnapshot(numericCharacterID);
  const currentEntry = snapshot.currentEntry;
  queueState.active = false;
  queueState.activeStartTime = null;
  setCharacterQueueState(numericCharacterID, queueState);
  clearSnapshotCache(numericCharacterID);
  const scheduler = schedulerHandles.get(numericCharacterID);
  if (scheduler) {
    clearTimeout(scheduler);
    schedulerHandles.delete(numericCharacterID);
  }
  if (currentEntry) {
    appendSkillHistoryEntry(
      numericCharacterID,
      SKILL_EVENT_TRAINING_CANCELLED,
      currentEntry.trainingTypeID,
      currentEntry.trainingStartSP,
      currentEntry.trainingToLevel,
    );
  }
  if (options.emitNotifications !== false) {
    notifySkillQueuePaused(numericCharacterID);
  }
  notifyMultipleCharacterTrainingUpdated(getCharacterAccountID(numericCharacterID));
  return getQueueSnapshot(numericCharacterID);
}

function previewFreeSkillPointsApplication(characterID, entries = []) {
  const snapshot = getQueueSnapshot(characterID);
  let remainingPoints = snapshot.freeSkillPoints;
  const pointsBySkillTypeID = new Map();
  const projectedPoints = new Map();
  const sourceEntries = Array.isArray(entries) && entries.length > 0
    ? entries
    : snapshot.queueEntries.map((entry) => ({
        typeID: entry.trainingTypeID,
        toLevel: entry.trainingToLevel,
      }));

  for (const entry of sourceEntries) {
    if (remainingPoints <= 0) {
      break;
    }
    const typeID = toInt(entry.typeID, 0);
    const skillRecord =
      snapshot.projectedSkillMap.get(typeID) ||
      getSkillRecordForProjection(characterID, getCharacterBaseSkillMap(characterID), typeID);
    if (!skillRecord) {
      continue;
    }
    const maxLevel = getMaxTrainableLevelForClone(typeID, {
      characterID,
      accountID: snapshot.accountID,
    });
    if (maxLevel <= 0) {
      continue;
    }
    const currentPoints = projectedPoints.has(typeID)
      ? projectedPoints.get(typeID)
      : Math.max(0, toInt(skillRecord.trainedSkillPoints, 0));
    const targetPoints = getSkillPointsForLevel(
      skillRecord.skillRank,
      Math.min(toInt(entry.toLevel, 0), maxLevel),
    );
    if (currentPoints >= targetPoints) {
      continue;
    }
    const appliedPoints = Math.min(remainingPoints, targetPoints - currentPoints);
    remainingPoints -= appliedPoints;
    projectedPoints.set(typeID, currentPoints + appliedPoints);
    pointsBySkillTypeID.set(typeID, (pointsBySkillTypeID.get(typeID) || 0) + appliedPoints);
  }

  return pointsBySkillTypeID;
}

function buildPointsDict(pointsBySkillTypeID) {
  return buildDict(
    [...pointsBySkillTypeID.entries()].map(([typeID, points]) => [typeID, points]),
  );
}

function applyFreeSkillPointsInternal(characterID, entries = []) {
  let requestedPointsBySkillTypeID = null;
  let requestedEntries = entries;
  if (entries && !Array.isArray(entries) && typeof entries === "object") {
    requestedEntries = Array.isArray(entries.entries) ? entries.entries : [];
    if (entries.pointsBySkillTypeID instanceof Map) {
      requestedPointsBySkillTypeID = entries.pointsBySkillTypeID;
    } else if (entries.pointsBySkillTypeID && typeof entries.pointsBySkillTypeID === "object") {
      requestedPointsBySkillTypeID = new Map(
        Object.entries(entries.pointsBySkillTypeID).map(([typeID, points]) => [
          toInt(typeID, 0),
          toInt(points, 0),
        ]),
      );
    }
  }

  const numericCharacterID = toInt(characterID, 0);
  const snapshot = getQueueSnapshot(numericCharacterID);
  const pointsBySkillTypeID =
    requestedPointsBySkillTypeID ||
    previewFreeSkillPointsApplication(numericCharacterID, requestedEntries);
  if (pointsBySkillTypeID.size === 0) {
    return {
      newFreeSkillPoints: snapshot.freeSkillPoints,
      changedSkills: [],
    };
  }

  const queueState = getCharacterQueueState(numericCharacterID);
  const skillMap = getCharacterBaseSkillMap(numericCharacterID);
  let remainingFreeSkillPoints = snapshot.freeSkillPoints;
  const changedSkills = [];
  const recentSkillPointChanges = [];

  for (const [typeID, appliedPoints] of pointsBySkillTypeID.entries()) {
    if (appliedPoints <= 0 || remainingFreeSkillPoints <= 0) {
      continue;
    }
    const skillRecord = getSkillRecordForProjection(numericCharacterID, skillMap, typeID);
    if (!skillRecord) {
      continue;
    }
    const pointsUsed = Math.min(remainingFreeSkillPoints, appliedPoints);
    const nextSkillPoints = Math.max(
      0,
      toInt(skillRecord.trainedSkillPoints, 0) + pointsUsed,
    );
    const nextSkillLevel = getSkillLevelForPoints(skillRecord.skillRank, nextSkillPoints);
    const nextRecord = {
      ...cloneValue(skillRecord),
      skillLevel: nextSkillLevel,
      trainedSkillLevel: nextSkillLevel,
      effectiveSkillLevel: nextSkillLevel,
      skillPoints: nextSkillPoints,
      trainedSkillPoints: nextSkillPoints,
      inTraining: false,
      trainingStartSP: nextSkillPoints,
      trainingDestinationSP: nextSkillPoints,
      trainingStartTime: null,
      trainingEndTime: null,
    };
    skillMap.set(typeID, nextRecord);
    changedSkills.push(cloneValue(nextRecord));
    recentSkillPointChanges.push({
      typeID,
      pointChange: pointsUsed,
    });
    remainingFreeSkillPoints -= pointsUsed;
    appendSkillHistoryEntry(
      numericCharacterID,
      SKILL_EVENT_FREE_SKILL_POINTS_USED,
      typeID,
      nextSkillPoints,
      nextSkillLevel,
    );
  }

  queueState.queue = queueState.queue.filter((entry) => {
    const skillRecord = skillMap.get(toInt(entry.typeID, 0));
    return !skillRecord || toInt(skillRecord.trainedSkillLevel, 0) < toInt(entry.toLevel, 0);
  });
  if (queueState.active) {
    if (queueState.queue.length > 0) {
      queueState.activeStartTime = buildFiletimeString(getNowFileTime());
    } else {
      queueState.active = false;
      queueState.activeStartTime = null;
    }
  }

  persistSkillMap(numericCharacterID, skillMap);
  updateCharacterRecord(numericCharacterID, (record) => ({
    ...record,
    freeSkillPoints: remainingFreeSkillPoints,
  }));
  setCharacterQueueState(numericCharacterID, queueState);
  clearSnapshotCache(numericCharacterID);
  recordRecentSkillPointChanges(numericCharacterID, recentSkillPointChanges);
  notifySkillStateChanged(numericCharacterID, changedSkills, {
    timeStamp: buildFiletimeString(getNowFileTime()),
  });
  notifyFreeSkillPointsChanged(numericCharacterID, remainingFreeSkillPoints);
  const updatedSnapshot = getQueueSnapshot(numericCharacterID);
  notifySkillQueueSaved(numericCharacterID, updatedSnapshot.queueEntries);
  if (!updatedSnapshot.active) {
    notifySkillQueuePaused(numericCharacterID);
  } else {
    scheduleQueueCompletion(numericCharacterID);
  }

  return {
    newFreeSkillPoints: remainingFreeSkillPoints,
    changedSkills,
  };
}

function applyFreeSkillPoints(characterID, skillTypeID, pointsToApply) {
  const numericCharacterID = toInt(characterID, 0);
  const typeID = toInt(skillTypeID, 0);
  const requestedPoints = Math.max(0, toInt(pointsToApply, 0));
  if (typeID <= 0 || requestedPoints <= 0) {
    return getQueueSnapshot(numericCharacterID).freeSkillPoints;
  }

  const snapshot = getQueueSnapshot(numericCharacterID);
  if (
    snapshot.currentEntry &&
    toInt(snapshot.currentEntry.trainingTypeID, 0) === typeID &&
    snapshot.active
  ) {
    throwWrappedUserError("CannotApplyFreePointsWhileTrainingSkill");
  }

  const skillRecord =
    snapshot.projectedSkillMap.get(typeID) ||
    getSkillRecordForProjection(numericCharacterID, getCharacterBaseSkillMap(numericCharacterID), typeID);
  if (!skillRecord) {
    throwWrappedUserError("CannotApplyFreePointsDoNotHaveSkill");
  }
  const maxTrainableLevel = getMaxTrainableLevelForClone(typeID, {
    characterID: numericCharacterID,
    accountID: snapshot.accountID,
  });
  const maxPoints = getSkillPointsForLevel(skillRecord.skillRank, maxTrainableLevel);
  const missingPoints = Math.max(0, maxPoints - toInt(skillRecord.trainedSkillPoints, 0));
  const cappedPointsToApply = Math.min(requestedPoints, missingPoints);
  if (cappedPointsToApply > snapshot.freeSkillPoints) {
    throwWrappedUserError("CannotApplyFreePointsNotEnoughRemaining", {
      pointsRequested: cappedPointsToApply,
      pointsRemaining: snapshot.freeSkillPoints,
    });
  }
  if (cappedPointsToApply <= 0) {
    return snapshot.freeSkillPoints;
  }

  const result = applyFreeSkillPointsInternal(numericCharacterID, {
    pointsBySkillTypeID: new Map([[typeID, cappedPointsToApply]]),
  });
  return result.newFreeSkillPoints;
}

function buildTrainingSelectionInfo(characterID) {
  const snapshot = getQueueSnapshot(characterID);
  const currentEntry = snapshot.currentEntry;
  if (!currentEntry) {
    return {
      skillTypeID: null,
      toLevel: null,
      trainingStartTime: null,
      trainingEndTime: null,
      queueEndTime: null,
      finishSP: null,
      trainedSP: null,
      finishedSkills: [],
    };
  }

  const characterRecord = getCharacterRecord(characterID) || {};
  const finishedSkills = Array.isArray(characterRecord.finishedSkills)
    ? cloneValue(characterRecord.finishedSkills)
    : [];
  return {
    skillTypeID: currentEntry.trainingTypeID,
    currentSkill: currentEntry.trainingTypeID,
    toLevel: currentEntry.trainingToLevel,
    trainingStartTime: currentEntry.trainingStartTime,
    trainingEndTime: currentEntry.trainingEndTime,
    queueEndTime: snapshot.queueEndTime,
    fromSP: getSkillPointsForLevel(
      snapshot.projectedSkillMap.get(currentEntry.trainingTypeID)?.skillRank || 1,
      Math.max(0, currentEntry.trainingToLevel - 1),
    ),
    finishSP: currentEntry.trainingDestinationSP,
    trainedSP: getEstimatedSkillPointsAtTime(
      currentEntry.trainingStartSP,
      currentEntry.trainingDestinationSP,
      currentEntry.trainingStartTime,
      getNowFileTime(),
      currentEntry.skillPointsPerMinute,
    ),
    finishedSkills,
  };
}

function primeQueueSchedulers() {
  for (const [characterID, rawState] of Object.entries(getAllQueueStates())) {
    if (!rawState || rawState.active !== true) {
      continue;
    }
    scheduleQueueCompletion(characterID);
  }
}

setImmediate(primeQueueSchedulers);

module.exports = {
  SKILLQUEUE_MAX_NUM_SKILLS,
  abortTraining,
  applyFreeSkillPoints,
  applyFreeSkillPointsInternal,
  buildPointsDict,
  buildTrainingSelectionInfo,
  getCharacterIDFromSession,
  getQueueSnapshot,
  normalizeQueueInput,
  previewFreeSkillPointsApplication,
  primeQueueSchedulers,
  readBooleanKwarg,
  saveQueue,
  scheduleQueueCompletion,
  settleCharacterTraining,
};
