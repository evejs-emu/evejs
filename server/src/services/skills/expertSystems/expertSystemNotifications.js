const path = require("path");

const sessionRegistry = require(path.join(__dirname, "../../chat/sessionRegistry"));
const { getCharacterSkillMap } = require(path.join(__dirname, "../skillState"));
const {
  emitSkillSessionState,
} = require(path.join(__dirname, "../training/skillQueueNotifications"));
const {
  diffProjectedSkillMaps,
} = require("./expertSystemProjection");
const {
  buildExpertSystemsPayload,
} = require("./expertSystemSerializer");

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function getLiveSession(characterID, fallbackSession = null) {
  return (
    sessionRegistry.findSessionByCharacterID(toInt(characterID, 0)) ||
    fallbackSession ||
    null
  );
}

function emitExpertSystemsUpdated(characterID, options = {}) {
  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return false;
  }

  const session = getLiveSession(numericCharacterID, options.session || null);
  if (!session || typeof session.sendNotification !== "function") {
    return false;
  }

  session.sendNotification("OnExpertSystemsUpdated", "clientID", [
    buildExpertSystemsPayload(numericCharacterID),
    Boolean(options.expertSystemAdded),
    toInt(options.expertSystemTypeID, 0) || null,
  ]);

  const previousSkillMap =
    options.previousSkillMap instanceof Map ? options.previousSkillMap : null;
  if (previousSkillMap) {
    const nextSkillMap = getCharacterSkillMap(numericCharacterID);
    const diff = diffProjectedSkillMaps(previousSkillMap, nextSkillMap);
    if (
      diff.changedSkillRecords.length > 0 ||
      diff.removedSkillRecords.length > 0
    ) {
      emitSkillSessionState(
        session,
        numericCharacterID,
        diff.changedSkillRecords,
        {
          previousSkillMap,
          removedSkillRecords: diff.removedSkillRecords,
          emitSkillLevelsTrained: false,
        },
      );
    }
  }

  if (options.expired === true) {
    session.sendNotification("OnExpertSystemExpired", "clientID", [
      toInt(options.expertSystemTypeID, 0) || null,
    ]);
  }

  return true;
}

module.exports = {
  emitExpertSystemsUpdated,
  getLiveSession,
};
