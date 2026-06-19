const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const {
  CALENDAR_EVENTS_TABLE,
  CALENDAR_RESPONSES_TABLE,
  DEFAULT_EVENT_STATE,
  DEFAULT_RESPONSE_STATE,
  CALENDAR_MAX_INVITEES,
} = require(path.join(__dirname, "./calendarConstants"));
const {
  cloneValue,
  currentFileTimeString,
  filetimeToDate,
  getYearMonthFromFiletime,
  sanitizeDescription,
  sanitizeTitle,
  toBoolean,
  toInt,
  toOptionalPositiveInt,
  toPositiveInt,
  toFileTimeBigInt,
} = require(path.join(__dirname, "./calendarAccess"));

function buildDefaultEventState() {
  return cloneValue(DEFAULT_EVENT_STATE);
}

function buildDefaultResponseState() {
  return cloneValue(DEFAULT_RESPONSE_STATE);
}

function readRoot(tableName, fallbackFactory) {
  const result = database.read(tableName, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    const fallback = fallbackFactory();
    database.write(tableName, "/", fallback);
    return fallback;
  }
  return result.data;
}

function normalizeInviteeList(value) {
  const source = Array.isArray(value) ? value : [];
  return [...new Set(source.map((entry) => toPositiveInt(entry, 0)).filter((entry) => entry > 0))]
    .slice(0, CALENDAR_MAX_INVITEES)
    .sort((left, right) => left - right);
}

function normalizeEventRecord(record, eventIDHint = 0) {
  if (!record || typeof record !== "object") {
    return null;
  }

  const eventID = toPositiveInt(record.eventID, toPositiveInt(eventIDHint, 0));
  if (eventID <= 0) {
    return null;
  }

  const eventDateTime = toFileTimeBigInt(record.eventDateTime, 0n);
  if (eventDateTime <= 0n) {
    return null;
  }

  const updatedAt = String(record.updatedAt || currentFileTimeString());
  const createdAt = String(record.createdAt || updatedAt);
  const { year, month } = getYearMonthFromFiletime(eventDateTime);

  return {
    eventID,
    ownerID: toPositiveInt(record.ownerID, 0),
    creatorID: toPositiveInt(record.creatorID, toPositiveInt(record.ownerID, 0)),
    scope: String(record.scope || "personal"),
    source: String(record.source || "player"),
    title: sanitizeTitle(record.title),
    description: sanitizeDescription(record.description),
    eventDateTime: String(eventDateTime),
    eventDuration: record.eventDuration == null ? null : toInt(record.eventDuration, 0),
    importance: toBoolean(record.importance, false) ? 1 : 0,
    autoEventType: record.autoEventType == null ? null : toInt(record.autoEventType, 0),
    isDeleted: toBoolean(record.isDeleted, false),
    deletedAt: record.deletedAt == null ? null : String(record.deletedAt),
    createdAt,
    updatedAt,
    inviteeCharacterIDs: normalizeInviteeList(record.inviteeCharacterIDs),
    seedKey: record.seedKey == null ? null : String(record.seedKey),
    serverEditable: toBoolean(record.serverEditable, false),
    year,
    month,
  };
}

function normalizeResponseRecord(record, responseKeyHint = "") {
  if (!record || typeof record !== "object") {
    return null;
  }

  const eventID = toPositiveInt(record.eventID, 0);
  const characterID = toPositiveInt(record.characterID, 0);
  if (eventID <= 0 || characterID <= 0) {
    return null;
  }

  return {
    key:
      String(record.key || "").trim() ||
      `${eventID}:${characterID}`,
    eventID,
    characterID,
    ownerID: toPositiveInt(record.ownerID, 0),
    status: toInt(record.status, 3),
    updatedAt: String(record.updatedAt || currentFileTimeString()),
    responseKeyHint,
  };
}

function getMutableEventRoot() {
  const root = readRoot(CALENDAR_EVENTS_TABLE, buildDefaultEventState);
  let mutated = false;
  if (toInt(root.version, 0) !== DEFAULT_EVENT_STATE.version) {
    root.version = DEFAULT_EVENT_STATE.version;
    mutated = true;
  }
  const nextEventID = toPositiveInt(root.nextEventID, DEFAULT_EVENT_STATE.nextEventID);
  if (nextEventID !== root.nextEventID) {
    root.nextEventID = nextEventID;
    mutated = true;
  }
  if (!root.events || typeof root.events !== "object") {
    root.events = {};
    mutated = true;
  }

  for (const [eventID, record] of Object.entries(root.events)) {
    const normalized = normalizeEventRecord(record, eventID);
    if (!normalized) {
      delete root.events[eventID];
      mutated = true;
      continue;
    }
    if (JSON.stringify(normalized) !== JSON.stringify(record)) {
      root.events[String(normalized.eventID)] = normalized;
      if (String(normalized.eventID) !== String(eventID)) {
        delete root.events[eventID];
      }
      mutated = true;
    }
  }

  if (mutated) {
    database.write(CALENDAR_EVENTS_TABLE, "/", root);
  }
  return root;
}

function getMutableResponseRoot() {
  const root = readRoot(CALENDAR_RESPONSES_TABLE, buildDefaultResponseState);
  let mutated = false;
  if (toInt(root.version, 0) !== DEFAULT_RESPONSE_STATE.version) {
    root.version = DEFAULT_RESPONSE_STATE.version;
    mutated = true;
  }
  if (!root.responses || typeof root.responses !== "object") {
    root.responses = {};
    mutated = true;
  }

  for (const [responseKey, record] of Object.entries(root.responses)) {
    const normalized = normalizeResponseRecord(record, responseKey);
    if (!normalized) {
      delete root.responses[responseKey];
      mutated = true;
      continue;
    }
    if (JSON.stringify(normalized) !== JSON.stringify(record)) {
      root.responses[String(normalized.key)] = normalized;
      if (String(normalized.key) !== String(responseKey)) {
        delete root.responses[responseKey];
      }
      mutated = true;
    }
  }

  if (mutated) {
    database.write(CALENDAR_RESPONSES_TABLE, "/", root);
  }
  return root;
}

function persistEventRoot(root) {
  return database.write(CALENDAR_EVENTS_TABLE, "/", root);
}

function persistResponseRoot(root) {
  return database.write(CALENDAR_RESPONSES_TABLE, "/", root);
}

function allocateEventID(eventRoot) {
  const nextValue = toPositiveInt(eventRoot.nextEventID, DEFAULT_EVENT_STATE.nextEventID);
  eventRoot.nextEventID = nextValue + 1;
  return nextValue;
}

module.exports = {
  buildDefaultEventState,
  buildDefaultResponseState,
  normalizeEventRecord,
  normalizeResponseRecord,
  getMutableEventRoot,
  getMutableResponseRoot,
  persistEventRoot,
  persistResponseRoot,
  allocateEventID,
};
