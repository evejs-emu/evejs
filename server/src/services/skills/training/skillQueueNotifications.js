const path = require("path");

const sessionRegistry = require(path.join(__dirname, "../../chat/sessionRegistry"));
const {
  applyCharacterToSession,
  syncShipFittingStateForSession,
} = require(path.join(__dirname, "../../character/characterState"));
const {
  buildFiletimeLong,
  currentFileTime,
} = require(path.join(__dirname, "../../_shared/serviceHelpers"));
const {
  syncCharacterDogmaState,
} = require(path.join(__dirname, "../../dogma/brain/characterBrainRuntime"));
const {
  recordRecentSkillPointChangesFromDiff,
} = require(path.join(__dirname, "../certificates/skillChangeTracker"));
const {
  buildCharacterSkillDict,
  buildCharacterSkillEntry,
} = require(path.join(__dirname, "../skillTransport"));

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
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

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeSkillRecordTypeID(skillRecord) {
  return toInt(skillRecord && skillRecord.typeID, 0);
}

function dedupeSkillRecords(skillRecords = []) {
  const recordsByTypeID = new Map();
  for (const skillRecord of Array.isArray(skillRecords) ? skillRecords : []) {
    const typeID = normalizeSkillRecordTypeID(skillRecord);
    if (!typeID) {
      continue;
    }
    recordsByTypeID.set(typeID, cloneValue(skillRecord));
  }
  return [...recordsByTypeID.values()];
}

function buildSkillQueuePayload(entries = []) {
  return {
    type: "list",
    items: entries.map((entry) =>
      buildKeyVal([
        ["queuePosition", toInt(entry.queuePosition, 0)],
        [
          "trainingStartTime",
          entry.trainingStartTime ? buildFiletimeLong(entry.trainingStartTime) : null,
        ],
        [
          "trainingEndTime",
          entry.trainingEndTime ? buildFiletimeLong(entry.trainingEndTime) : null,
        ],
        ["trainingTypeID", toInt(entry.trainingTypeID, 0)],
        ["trainingToLevel", toInt(entry.trainingToLevel, 0)],
        ["trainingStartSP", toInt(entry.trainingStartSP, 0)],
        ["trainingDestinationSP", toInt(entry.trainingDestinationSP, 0)],
      ]),
    ),
  };
}

function buildSkillNotificationInfo(skillRecord) {
  return buildCharacterSkillEntry(skillRecord, {
    includeMetadata: true,
  });
}

function buildSkillNotificationDict(skillRecords = []) {
  return buildCharacterSkillDict(dedupeSkillRecords(skillRecords), {
    includeMetadata: true,
  });
}

function buildRemovedSkillNotificationRecord(skillRecord) {
  if (!skillRecord || typeof skillRecord !== "object") {
    return null;
  }

  return {
    ...cloneValue(skillRecord),
    locationID: 0,
    flagID: 0,
    skillLevel: 0,
    trainedSkillLevel: 0,
    effectiveSkillLevel: 0,
    virtualSkillLevel: null,
    skillPoints: 0,
    trainedSkillPoints: 0,
    inTraining: false,
    trainingStartSP: 0,
    trainingDestinationSP: 0,
    trainingStartTime: null,
    trainingEndTime: null,
  };
}

function buildRemovedSkillServerRecord(skillRecord) {
  const notificationRecord = buildRemovedSkillNotificationRecord(skillRecord);
  if (!notificationRecord) {
    return null;
  }

  // The client skill service deletes cached skills when trained points go negative.
  notificationRecord.skillPoints = -1;
  notificationRecord.trainedSkillPoints = -1;
  return notificationRecord;
}

function getLiveCharacterSession(characterID) {
  return sessionRegistry.findSessionByCharacterID(characterID);
}

function emitSkillSessionState(
  session,
  characterID,
  changedSkillRecords = [],
  options = {},
) {
  if (options.skipRecentSkillTracking !== true) {
    recordRecentSkillPointChangesFromDiff(
      characterID,
      changedSkillRecords,
      options.previousSkillMap,
    );
  }

  if (!session || typeof session.sendNotification !== "function") {
    return;
  }

  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return;
  }

  const changedSkills = dedupeSkillRecords(changedSkillRecords);
  const removedSkills = dedupeSkillRecords(options.removedSkillRecords);
  const hasSkillMutation = changedSkills.length > 0 || removedSkills.length > 0;
  const timeStamp = options.timeStamp || currentFileTime();

  if (hasSkillMutation) {
    applyCharacterToSession(session, numericCharacterID, {
      emitNotifications: false,
      logSelection: false,
      selectionEvent: false,
    });
  }

  const clientSkillChanges = [
    ...changedSkills,
    ...removedSkills
      .map((skillRecord) => buildRemovedSkillNotificationRecord(skillRecord))
      .filter(Boolean),
  ];
  if (clientSkillChanges.length > 0) {
    session.sendNotification("OnSkillsChanged", "clientID", [
      buildSkillNotificationDict(clientSkillChanges),
    ]);
  }

  const trainedTypeIDs = Array.isArray(options.trainedTypeIDs)
    ? options.trainedTypeIDs.map((typeID) => toInt(typeID, 0)).filter(Boolean)
    : changedSkills.map((record) => toInt(record.typeID, 0)).filter(Boolean);
  if (trainedTypeIDs.length > 0 && options.emitSkillLevelsTrained !== false) {
    session.sendNotification("OnSkillLevelsTrained", "clientID", [
      {
        type: "list",
        items: trainedTypeIDs,
      },
    ]);
  }

  if (changedSkills.length > 0) {
    session.sendNotification("OnServerSkillsChanged", "clientID", [
      buildSkillNotificationDict(changedSkills),
      null,
      buildFiletimeLong(timeStamp),
    ]);
  }

  if (removedSkills.length > 0) {
    session.sendNotification("OnServerSkillsRemoved", "clientID", [
      buildSkillNotificationDict(
        removedSkills
          .map((skillRecord) => buildRemovedSkillServerRecord(skillRecord))
          .filter(Boolean),
      ),
      buildFiletimeLong(timeStamp),
    ]);
  }

  if (options.freeSkillPoints !== undefined) {
    session.sendNotification("OnFreeSkillPointsChanged", "clientID", [
      Math.max(0, toInt(options.freeSkillPoints, 0)),
    ]);
  }

  if (options.queueEntries) {
    session.sendNotification("OnNewSkillQueueSaved", "clientID", [
      buildSkillQueuePayload(options.queueEntries),
    ]);
  }

  if (options.emitQueuePaused === true) {
    session.sendNotification("OnSkillQueuePausedServer", "clientID", []);
  }

  if (hasSkillMutation) {
    const activeShipID = toInt(
      session.activeShipID || session.shipID || session.shipid,
      0,
    );
    if (activeShipID > 0) {
      syncShipFittingStateForSession(session, activeShipID, {
        includeOfflineModules: true,
        includeCharges: true,
        emitChargeInventoryRows: true,
        emitOnlineEffects: true,
      });
    }
    syncCharacterDogmaState(session, numericCharacterID);
  }
}

function notifySkillQueueSaved(characterID, queueEntries = []) {
  const session = getLiveCharacterSession(characterID);
  if (!session || typeof session.sendNotification !== "function") {
    return;
  }
  session.sendNotification("OnNewSkillQueueSaved", "clientID", [
    buildSkillQueuePayload(queueEntries),
  ]);
}

function notifySkillQueuePaused(characterID) {
  const session = getLiveCharacterSession(characterID);
  if (!session || typeof session.sendNotification !== "function") {
    return;
  }
  session.sendNotification("OnSkillQueuePausedServer", "clientID", []);
}

function notifyFreeSkillPointsChanged(characterID, newFreeSkillPoints) {
  const session = getLiveCharacterSession(characterID);
  if (!session || typeof session.sendNotification !== "function") {
    return;
  }
  session.sendNotification("OnFreeSkillPointsChanged", "clientID", [
    toInt(newFreeSkillPoints, 0),
  ]);
}

function notifyMultipleCharacterTrainingUpdated(accountID) {
  const numericAccountID = toInt(accountID, 0);
  if (numericAccountID <= 0) {
    return;
  }

  for (const session of sessionRegistry.getSessions()) {
    if (toInt(session && session.userid, 0) !== numericAccountID) {
      continue;
    }
    if (typeof session.sendNotification !== "function") {
      continue;
    }
    session.sendNotification("OnMultipleCharactersTrainingUpdated", "userid", []);
  }
}

function notifySkillStateChanged(characterID, changedSkillRecords = [], options = {}) {
  recordRecentSkillPointChangesFromDiff(
    characterID,
    changedSkillRecords,
    options.previousSkillMap,
  );

  const session = getLiveCharacterSession(characterID);
  if (!session || typeof session.sendNotification !== "function") {
    return;
  }

  emitSkillSessionState(session, characterID, changedSkillRecords, {
    ...options,
    skipRecentSkillTracking: true,
  });
}

module.exports = {
  buildSkillNotificationDict,
  buildSkillQueuePayload,
  emitSkillSessionState,
  getLiveCharacterSession,
  notifyFreeSkillPointsChanged,
  notifyMultipleCharacterTrainingUpdated,
  notifySkillQueuePaused,
  notifySkillQueueSaved,
  notifySkillStateChanged,
};
