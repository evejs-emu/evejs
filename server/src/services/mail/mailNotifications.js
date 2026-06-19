const path = require("path");

const sessionRegistry = require(path.join(__dirname, "../chat/sessionRegistry"));
const {
  buildFiletimeLong,
  buildKeyVal,
  normalizeNumber,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

function getCharacterSessions(characterID, options = {}) {
  const numericCharacterID = Number(characterID || 0);
  const excludedSession = options.excludeSession || null;
  if (!Number.isInteger(numericCharacterID) || numericCharacterID <= 0) {
    return [];
  }

  return sessionRegistry.getSessions().filter((session) => {
    if (session === excludedSession) {
      return false;
    }
    const sessionCharacterID = Number(
      session &&
        (session.characterID || session.charID || session.charid || 0),
    ) || 0;
    return sessionCharacterID === numericCharacterID;
  });
}

function sendNotificationToCharacter(characterID, notifyType, payloadTuple, options = {}) {
  for (const session of getCharacterSessions(characterID, options)) {
    if (!session || typeof session.sendNotification !== "function") {
      continue;
    }
    session.sendNotification(notifyType, "clientID", payloadTuple);
  }
}

function sendMailSentNotification(characterID, message, statusMask, options = {}) {
  if (!message || typeof message !== "object") {
    return;
  }

  sendNotificationToCharacter(
    characterID,
    "OnMailSent",
    [
      Number(message.messageID || 0) || 0,
      Number(message.senderID || 0) || 0,
      buildFiletimeLong(message.sentDate || "0"),
      Array.isArray(message.toCharacterIDs) ? message.toCharacterIDs : [],
      message.toListID == null ? null : Number(message.toListID || 0) || null,
      message.toCorpOrAllianceID == null
        ? null
        : Number(message.toCorpOrAllianceID || 0) || null,
      String(message.title || ""),
      Math.max(0, Math.trunc(normalizeNumber(statusMask, 0))),
    ],
    options,
  );
}

function sendMailDeletedNotification(characterID, messageIDs, options = {}) {
  sendNotificationToCharacter(characterID, "OnMailDeleted", [messageIDs], options);
}

function sendMailUpdatedNotification(
  characterID,
  messageIDs,
  isRead,
  newLabel,
  options = {},
) {
  sendNotificationToCharacter(
    characterID,
    "OnMailUpdatedByExternal",
    [
      messageIDs,
      isRead == null ? null : Boolean(isRead),
      newLabel == null ? null : Math.max(0, Math.trunc(normalizeNumber(newLabel, 0))),
    ],
    options,
  );
}

function sendMailTrashedNotification(characterID, messageIDs, options = {}) {
  sendNotificationToCharacter(characterID, "OnMailTrashed", [messageIDs], options);
}

function sendMailRestoredNotification(characterID, messageIDs, options = {}) {
  sendNotificationToCharacter(characterID, "OnMailRestored", [messageIDs], options);
}

function sendMailUndeletedNotification(characterID, messageIDs, options = {}) {
  sendNotificationToCharacter(characterID, "OnMailUndeleted", [messageIDs], options);
}

function sendLabelsCreatedNotification(characterID, label, options = {}) {
  if (!label || typeof label !== "object") {
    return;
  }
  sendNotificationToCharacter(
    characterID,
    "OnLabelsCreatedByExternal",
    [
      buildKeyVal([
        ["labelID", Number(label.labelID || 0) || 0],
        ["name", String(label.name || "")],
        ["color", Math.max(0, Math.trunc(normalizeNumber(label.color, 0)))],
      ]),
    ],
    options,
  );
}

function sendMailingListRoleOperatorNotification(characterID, listID, options = {}) {
  sendNotificationToCharacter(characterID, "OnMailingListSetOperator", [Number(listID || 0) || 0], options);
}

function sendMailingListRoleMutedNotification(characterID, listID, options = {}) {
  sendNotificationToCharacter(characterID, "OnMailingListSetMuted", [Number(listID || 0) || 0], options);
}

function sendMailingListRoleClearNotification(characterID, listID, options = {}) {
  sendNotificationToCharacter(characterID, "OnMailingListSetClear", [Number(listID || 0) || 0], options);
}

function sendMailingListLeaveNotification(characterID, listID, affectedCharacterID, options = {}) {
  sendNotificationToCharacter(
    characterID,
    "OnMailingListLeave",
    [Number(listID || 0) || 0, Number(affectedCharacterID || 0) || 0],
    options,
  );
}

function sendMailingListDeletedNotification(characterID, listID, options = {}) {
  sendNotificationToCharacter(characterID, "OnMailingListDeleted", [Number(listID || 0) || 0], options);
}

module.exports = {
  getCharacterSessions,
  sendLabelsCreatedNotification,
  sendMailDeletedNotification,
  sendMailRestoredNotification,
  sendMailSentNotification,
  sendMailTrashedNotification,
  sendMailUndeletedNotification,
  sendMailUpdatedNotification,
  sendMailingListDeletedNotification,
  sendMailingListLeaveNotification,
  sendMailingListRoleClearNotification,
  sendMailingListRoleMutedNotification,
  sendMailingListRoleOperatorNotification,
};
