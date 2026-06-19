const path = require("path");

const sessionRegistry = require(path.join(__dirname, "../chat/sessionRegistry"));
const {
  buildFiletimeLong,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  buildExternalResponseEventKV,
} = require(path.join(__dirname, "./calendarPayloads"));
const {
  canViewEvent,
  getSessionCharacterID,
  toPositiveInt,
} = require(path.join(__dirname, "./calendarAccess"));

function getCharacterSessions(characterID, options = {}) {
  const numericCharacterID = toPositiveInt(characterID, 0);
  const excludedSession = options.excludeSession || null;
  if (numericCharacterID <= 0) {
    return [];
  }
  return sessionRegistry.getSessions().filter((session) => {
    if (session === excludedSession) {
      return false;
    }
    return (
      toPositiveInt(
        session &&
          (session.characterID || session.charID || session.charid || 0),
        0,
      ) === numericCharacterID
    );
  });
}

function sendToCharacterIDs(characterIDs, notifyType, payloadTuple, options = {}) {
  const normalized = [...new Set((Array.isArray(characterIDs) ? characterIDs : [characterIDs])
    .map((characterID) => toPositiveInt(characterID, 0))
    .filter((characterID) => characterID > 0))];
  for (const characterID of normalized) {
    for (const session of getCharacterSessions(characterID, options)) {
      if (!session || typeof session.sendNotification !== "function") {
        continue;
      }
      session.sendNotification(notifyType, "clientID", payloadTuple);
    }
  }
}

function listOnlineViewerCharacterIDs(event, options = {}) {
  const recipients = new Set();
  const excludedSession = options.excludeSession || null;
  const excludedCharacterIDs = new Set(
    (Array.isArray(options.excludeCharacterIDs)
      ? options.excludeCharacterIDs
      : [options.excludeCharacterIDs]
    )
      .map((characterID) => toPositiveInt(characterID, 0))
      .filter((characterID) => characterID > 0),
  );
  for (const session of sessionRegistry.getSessions()) {
    if (session === excludedSession) {
      continue;
    }
    const characterID = getSessionCharacterID(session);
    if (characterID <= 0 || excludedCharacterIDs.has(characterID)) {
      continue;
    }
    if (canViewEvent(event, session)) {
      recipients.add(characterID);
    }
  }
  return [...recipients];
}

function notifyNewCalendarEvent(characterIDs, event, options = {}) {
  sendToCharacterIDs(
    characterIDs,
    "OnNewCalendarEvent",
    [
      toPositiveInt(event && event.eventID, 0),
      toPositiveInt(event && event.ownerID, 0),
      buildFiletimeLong(event && event.eventDateTime),
      event && event.eventDuration == null ? null : Number(event.eventDuration),
      String((event && event.title) || ""),
      Number(event && event.importance ? 1 : 0),
      event && event.autoEventType == null ? null : Number(event.autoEventType),
      options.doBlink === undefined ? true : Boolean(options.doBlink),
    ],
    options,
  );
}

function notifyEditCalendarEvent(characterIDs, event, oldEventDateTime, options = {}) {
  sendToCharacterIDs(
    characterIDs,
    "OnEditCalendarEvent",
    [
      toPositiveInt(event && event.eventID, 0),
      toPositiveInt(event && event.ownerID, 0),
      buildFiletimeLong(oldEventDateTime),
      buildFiletimeLong(event && event.eventDateTime),
      event && event.eventDuration == null ? null : Number(event.eventDuration),
      String((event && event.title) || ""),
      Number(event && event.importance ? 1 : 0),
      event && event.autoEventType == null ? null : Number(event.autoEventType),
    ],
    options,
  );
}

function notifyRemoveCalendarEvent(characterIDs, event, isDeleted, options = {}) {
  sendToCharacterIDs(
    characterIDs,
    "OnRemoveCalendarEvent",
    [
      toPositiveInt(event && event.eventID, 0),
      buildFiletimeLong(event && event.eventDateTime),
      Boolean(isDeleted),
    ],
    options,
  );
}

function notifyExternalEventResponse(characterIDs, event, response, options = {}) {
  sendToCharacterIDs(
    characterIDs,
    "OnEventResponseByExternal",
    [
      toPositiveInt(event && event.eventID, 0),
      buildExternalResponseEventKV(event),
      Number(response),
    ],
    options,
  );
}

module.exports = {
  getCharacterSessions,
  listOnlineViewerCharacterIDs,
  notifyNewCalendarEvent,
  notifyEditCalendarEvent,
  notifyRemoveCalendarEvent,
  notifyExternalEventResponse,
};
