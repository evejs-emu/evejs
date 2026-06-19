const path = require("path");
const { performance } = require("perf_hooks");

const {
  throwWrappedUserError,
} = require(path.join(__dirname, "../../common/machoErrors"));
const {
  CALENDAR_MAX_DESCRIPTION_SIZE,
  CALENDAR_MAX_INVITEES,
  CALENDAR_MAX_TITLE_SIZE,
  CALENDAR_VIEW_RANGE_IN_MONTHS,
  EVENT_RESPONSE_ACCEPTED,
  EVENT_RESPONSE_DECLINED,
  EVENT_RESPONSE_MAYBE,
  EVENT_RESPONSE_UNDECIDED,
  EVENT_RESPONSE_UNINVITED,
  OWNER_SYSTEM_ID,
  SOURCE_PLAYER,
  SOURCE_SERVER,
  SCOPE_ALLIANCE,
  SCOPE_CORPORATION,
  SCOPE_GLOBAL,
  SCOPE_PERSONAL,
} = require(path.join(__dirname, "./calendarConstants"));
const access = require(path.join(__dirname, "./calendarAccess"));
const store = require(path.join(__dirname, "./calendarStore"));

const state = {
  loaded: false,
  eventRoot: null,
  responseRoot: null,
  eventsByID: new Map(),
  responsesByEvent: new Map(),
  responsesByCharacter: new Map(),
  personalMonthIndex: new Map(),
  corporationMonthIndex: new Map(),
  allianceMonthIndex: new Map(),
  globalMonthIndex: new Map(),
  monthCache: new Map(),
  detailCache: new Map(),
  responsesForCharacterCache: new Map(),
  responsesToEventCache: new Map(),
};

function resetState() {
  state.loaded = false;
  state.eventRoot = null;
  state.responseRoot = null;
  state.eventsByID = new Map();
  state.responsesByEvent = new Map();
  state.responsesByCharacter = new Map();
  state.personalMonthIndex = new Map();
  state.corporationMonthIndex = new Map();
  state.allianceMonthIndex = new Map();
  state.globalMonthIndex = new Map();
  state.monthCache = new Map();
  state.detailCache = new Map();
  state.responsesForCharacterCache = new Map();
  state.responsesToEventCache = new Map();
}

function calendarAssert(condition, errorMessage, values = {}) {
  if (!condition) {
    throwWrappedUserError(errorMessage, values);
  }
}

function buildMonthToken(year, month) {
  return `${String(year)}-${String(month).padStart(2, "0")}`;
}

function buildScopedMonthKey(ownerID, year, month) {
  return `${String(ownerID)}:${buildMonthToken(year, month)}`;
}

function buildMonthCacheKey(session, year, month) {
  return [
    access.getSessionCharacterID(session),
    access.getSessionCorporationID(session),
    access.getSessionAllianceID(session),
    buildMonthToken(year, month),
  ].join(":");
}

function buildResponseKey(eventID, characterID) {
  return `${String(eventID)}:${String(characterID)}`;
}

function addIndexEntry(indexMap, key, eventID) {
  if (!indexMap.has(key)) {
    indexMap.set(key, []);
  }
  indexMap.get(key).push(eventID);
}

function clearCaches() {
  state.monthCache.clear();
  state.detailCache.clear();
  state.responsesForCharacterCache.clear();
  state.responsesToEventCache.clear();
}

function rebuildIndexes() {
  state.eventsByID = new Map();
  state.responsesByEvent = new Map();
  state.responsesByCharacter = new Map();
  state.personalMonthIndex = new Map();
  state.corporationMonthIndex = new Map();
  state.allianceMonthIndex = new Map();
  state.globalMonthIndex = new Map();

  const normalizedEvents = {};
  let eventRootMutated = false;
  for (const [eventID, rawRecord] of Object.entries(state.eventRoot.events || {})) {
    const normalized = store.normalizeEventRecord(rawRecord, eventID);
    if (!normalized) {
      delete state.eventRoot.events[eventID];
      eventRootMutated = true;
      continue;
    }
    normalizedEvents[String(normalized.eventID)] = normalized;
    if (JSON.stringify(normalized) !== JSON.stringify(rawRecord)) {
      eventRootMutated = true;
    }
    state.eventsByID.set(normalized.eventID, normalized);

    const monthKey = buildMonthToken(normalized.year, normalized.month);
    if (normalized.scope === SCOPE_PERSONAL) {
      addIndexEntry(
        state.personalMonthIndex,
        buildScopedMonthKey(normalized.ownerID, normalized.year, normalized.month),
        normalized.eventID,
      );
      for (const inviteeCharacterID of normalized.inviteeCharacterIDs) {
        addIndexEntry(
          state.personalMonthIndex,
          buildScopedMonthKey(inviteeCharacterID, normalized.year, normalized.month),
          normalized.eventID,
        );
      }
    } else if (normalized.scope === SCOPE_CORPORATION) {
      addIndexEntry(
        state.corporationMonthIndex,
        buildScopedMonthKey(normalized.ownerID, normalized.year, normalized.month),
        normalized.eventID,
      );
    } else if (normalized.scope === SCOPE_ALLIANCE) {
      addIndexEntry(
        state.allianceMonthIndex,
        buildScopedMonthKey(normalized.ownerID, normalized.year, normalized.month),
        normalized.eventID,
      );
    } else if (normalized.scope === SCOPE_GLOBAL) {
      addIndexEntry(state.globalMonthIndex, monthKey, normalized.eventID);
    }
  }

  if (eventRootMutated) {
    state.eventRoot.events = normalizedEvents;
    store.persistEventRoot(state.eventRoot);
  }

  const normalizedResponses = {};
  let responseRootMutated = false;
  for (const [responseKey, rawRecord] of Object.entries(state.responseRoot.responses || {})) {
    const normalized = store.normalizeResponseRecord(rawRecord, responseKey);
    if (!normalized) {
      delete state.responseRoot.responses[responseKey];
      responseRootMutated = true;
      continue;
    }
    const event = state.eventsByID.get(normalized.eventID);
    if (!event) {
      delete state.responseRoot.responses[responseKey];
      responseRootMutated = true;
      continue;
    }
    normalized.ownerID = event.ownerID;
    normalizedResponses[normalized.key] = normalized;
    if (JSON.stringify(normalized) !== JSON.stringify(rawRecord)) {
      responseRootMutated = true;
    }
    if (!state.responsesByEvent.has(normalized.eventID)) {
      state.responsesByEvent.set(normalized.eventID, new Map());
    }
    if (!state.responsesByCharacter.has(normalized.characterID)) {
      state.responsesByCharacter.set(normalized.characterID, new Map());
    }
    state.responsesByEvent.get(normalized.eventID).set(normalized.characterID, normalized);
    state.responsesByCharacter.get(normalized.characterID).set(normalized.eventID, normalized);
  }

  if (responseRootMutated) {
    state.responseRoot.responses = normalizedResponses;
    store.persistResponseRoot(state.responseRoot);
  }

  clearCaches();
}

function ensureLoaded() {
  if (state.loaded) {
    return;
  }
  state.eventRoot = store.getMutableEventRoot();
  state.responseRoot = store.getMutableResponseRoot();
  rebuildIndexes();
  state.loaded = true;
}

function getEvent(eventID) {
  ensureLoaded();
  return state.eventsByID.get(access.toPositiveInt(eventID, 0)) || null;
}

function requireEvent(eventID) {
  const event = getEvent(eventID);
  calendarAssert(Boolean(event), "CustomNotify", {
    notify: "Calendar event not found.",
  });
  return event;
}

function collectVisibleMonthEventIDs(session, month, year) {
  const characterID = access.getSessionCharacterID(session);
  const corporationID = access.getSessionCorporationID(session);
  const allianceID = access.getSessionAllianceID(session);
  const ids = new Set();
  const monthToken = buildMonthToken(year, month);

  for (const eventID of state.personalMonthIndex.get(
    buildScopedMonthKey(characterID, year, month),
  ) || []) {
    ids.add(eventID);
  }
  if (corporationID > 0) {
    for (const eventID of state.corporationMonthIndex.get(
      buildScopedMonthKey(corporationID, year, month),
    ) || []) {
      ids.add(eventID);
    }
  }
  if (allianceID > 0) {
    for (const eventID of state.allianceMonthIndex.get(
      buildScopedMonthKey(allianceID, year, month),
    ) || []) {
      ids.add(eventID);
    }
  }
  for (const eventID of state.globalMonthIndex.get(monthToken) || []) {
    ids.add(eventID);
  }

  return [...ids]
    .map((eventID) => state.eventsByID.get(eventID))
    .filter((event) => event && access.canViewEvent(event, session))
    .sort((left, right) => {
      const leftTime = access.toFileTimeBigInt(left.eventDateTime, 0n);
      const rightTime = access.toFileTimeBigInt(right.eventDateTime, 0n);
      if (leftTime !== rightTime) {
        return leftTime < rightTime ? -1 : 1;
      }
      return left.eventID - right.eventID;
    });
}

function getEventsByMonthYear(session, month, year) {
  ensureLoaded();
  const numericMonth = access.toPositiveInt(month, 0);
  const numericYear = access.toPositiveInt(year, 0);
  const cacheKey = buildMonthCacheKey(session, numericYear, numericMonth);
  if (state.monthCache.has(cacheKey)) {
    return state.monthCache.get(cacheKey);
  }
  const events = collectVisibleMonthEventIDs(session, numericMonth, numericYear);
  state.monthCache.set(cacheKey, events);
  return events;
}

function getEventDetails(session, eventID, ownerID) {
  ensureLoaded();
  const numericEventID = access.toPositiveInt(eventID, 0);
  if (state.detailCache.has(numericEventID)) {
    const cached = state.detailCache.get(numericEventID);
    if (cached && access.canViewEvent(cached, session)) {
      return cached;
    }
  }
  const event = requireEvent(numericEventID);
  calendarAssert(
    ownerID == null || access.toPositiveInt(ownerID, event.ownerID) === event.ownerID,
    "CustomNotify",
    { notify: "Calendar event owner mismatch." },
  );
  calendarAssert(access.canViewEvent(event, session), "CustomNotify", {
    notify: "You do not have access to that calendar event.",
  });
  state.detailCache.set(numericEventID, event);
  return event;
}

function getResponsesForCharacter(session) {
  ensureLoaded();
  const characterID = access.getSessionCharacterID(session);
  if (state.responsesForCharacterCache.has(characterID)) {
    return state.responsesForCharacterCache.get(characterID);
  }
  const rows = [...(state.responsesByCharacter.get(characterID)?.values() || [])]
    .sort((left, right) => {
      if (left.eventID !== right.eventID) {
        return left.eventID - right.eventID;
      }
      return String(left.updatedAt).localeCompare(String(right.updatedAt));
    });
  state.responsesForCharacterCache.set(characterID, rows);
  return rows;
}

function getResponsesToEvent(session, eventID, ownerID = null) {
  ensureLoaded();
  const numericEventID = access.toPositiveInt(eventID, 0);
  if (state.responsesToEventCache.has(numericEventID)) {
    return state.responsesToEventCache.get(numericEventID);
  }
  const event = requireEvent(numericEventID);
  calendarAssert(
    ownerID == null || access.toPositiveInt(ownerID, event.ownerID) === event.ownerID,
    "CustomNotify",
    { notify: "Calendar event owner mismatch." },
  );
  calendarAssert(access.canViewEvent(event, session), "CustomNotify", {
    notify: "You do not have access to those calendar responses.",
  });
  const rows = [...(state.responsesByEvent.get(numericEventID)?.values() || [])]
    .sort((left, right) => left.characterID - right.characterID);
  state.responsesToEventCache.set(numericEventID, rows);
  return rows;
}

function validateSharedEventFields(eventDateTime, title, description, importance) {
  const normalizedTitle = access.sanitizeTitle(title);
  calendarAssert(normalizedTitle.length > 0, "CalendarEventMustSpecifyTitle");
  calendarAssert(
    normalizedTitle.length <= CALENDAR_MAX_TITLE_SIZE,
    "CalendarTitleTooLong",
  );
  const normalizedDescription = access.sanitizeDescription(description);
  calendarAssert(
    normalizedDescription.length <= CALENDAR_MAX_DESCRIPTION_SIZE,
    "CustomNotify",
    { notify: "Calendar event description is too long." },
  );
  const eventDate = access.filetimeToDate(eventDateTime);
  calendarAssert(
    eventDate.getTime() > Date.now(),
    "CalendarCannotPlanThePast",
  );

  const currentDate = new Date();
  const currentMonthIndex = currentDate.getUTCFullYear() * 12 + currentDate.getUTCMonth();
  const eventMonthIndex = eventDate.getUTCFullYear() * 12 + eventDate.getUTCMonth();
  calendarAssert(
    eventMonthIndex - currentMonthIndex <= CALENDAR_VIEW_RANGE_IN_MONTHS,
    "CalendarTooFarIntoFuture",
    { numMonths: CALENDAR_VIEW_RANGE_IN_MONTHS },
  );

  return {
    title: normalizedTitle,
    description: normalizedDescription,
    importance: importance ? 1 : 0,
  };
}

function upsertResponse(event, characterID, status) {
  const numericCharacterID = access.toPositiveInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return null;
  }
  const key = buildResponseKey(event.eventID, numericCharacterID);
  const record = {
    key,
    eventID: event.eventID,
    characterID: numericCharacterID,
    ownerID: event.ownerID,
    status: access.toInt(status, EVENT_RESPONSE_UNDECIDED),
    updatedAt: access.currentFileTimeString(),
  };
  state.responseRoot.responses[key] = record;
  return record;
}

function deleteResponse(eventID, characterID) {
  const key = buildResponseKey(eventID, characterID);
  delete state.responseRoot.responses[key];
}

function createEventRecord({
  session,
  scope,
  eventDateTime,
  duration,
  title,
  description,
  importance,
  inviteeCharacterIDs = [],
}) {
  ensureLoaded();
  const sanitized = validateSharedEventFields(
    eventDateTime,
    title,
    description,
    importance,
  );
  const characterID = access.getSessionCharacterID(session);
  const corporationID = access.getSessionCorporationID(session);
  const allianceID = access.getSessionAllianceID(session);

  let ownerID = characterID;
  if (scope === SCOPE_CORPORATION) {
    calendarAssert(
      access.canCreateCorpOrAllianceEvent(session, scope),
      "CustomNotify",
      { notify: "You do not have permission to create corporation calendar events." },
    );
    ownerID = corporationID;
  } else if (scope === SCOPE_ALLIANCE) {
    calendarAssert(
      access.canCreateCorpOrAllianceEvent(session, scope),
      "CustomNotify",
      { notify: "You do not have permission to create alliance calendar events." },
    );
    ownerID = allianceID;
  }

  const eventID = store.allocateEventID(state.eventRoot);
  const event = store.normalizeEventRecord({
    eventID,
    ownerID,
    creatorID: characterID,
    scope,
    source: SOURCE_PLAYER,
    title: sanitized.title,
    description: sanitized.description,
    eventDateTime: String(access.toFileTimeBigInt(eventDateTime, 0n)),
    eventDuration: duration == null ? null : access.toInt(duration, 0),
    importance: sanitized.importance,
    autoEventType: null,
    isDeleted: false,
    deletedAt: null,
    createdAt: access.currentFileTimeString(),
    updatedAt: access.currentFileTimeString(),
    inviteeCharacterIDs:
      scope === SCOPE_PERSONAL
        ? [...new Set(
            (Array.isArray(inviteeCharacterIDs) ? inviteeCharacterIDs : [])
              .map((entry) => access.toPositiveInt(entry, 0))
              .filter((entry) => entry > 0 && entry !== characterID),
          )].slice(0, CALENDAR_MAX_INVITEES)
        : [],
    seedKey: null,
    serverEditable: false,
  });

  calendarAssert(
    event.inviteeCharacterIDs.length <= CALENDAR_MAX_INVITEES,
    "CustomNotify",
    { notify: "Too many invitees selected for that event." },
  );

  state.eventRoot.events[String(event.eventID)] = event;
  upsertResponse(event, characterID, EVENT_RESPONSE_ACCEPTED);
  if (scope === SCOPE_PERSONAL) {
    for (const inviteeCharacterID of event.inviteeCharacterIDs) {
      upsertResponse(event, inviteeCharacterID, EVENT_RESPONSE_UNDECIDED);
    }
  }
  store.persistEventRoot(state.eventRoot);
  store.persistResponseRoot(state.responseRoot);
  rebuildIndexes();
  return event;
}

function createServerEventRecord({
  ownerID = OWNER_SYSTEM_ID,
  creatorID = OWNER_SYSTEM_ID,
  scope = SCOPE_GLOBAL,
  eventDateTime,
  duration,
  title,
  description,
  importance,
  autoEventType = null,
  seedKey = null,
  serverEditable = true,
}) {
  ensureLoaded();
  const sanitized = validateSharedEventFields(
    eventDateTime,
    title,
    description,
    importance,
  );
  let normalizedOwnerID = access.toPositiveInt(ownerID, OWNER_SYSTEM_ID);
  if (scope === SCOPE_GLOBAL) {
    normalizedOwnerID = OWNER_SYSTEM_ID;
  } else if ([SCOPE_CORPORATION, SCOPE_ALLIANCE].includes(scope)) {
    calendarAssert(normalizedOwnerID > 0, "CustomNotify", {
      notify: "Server calendar events require a valid owner.",
    });
  } else {
    calendarAssert(false, "CustomNotify", {
      notify: "Unsupported server calendar scope.",
    });
  }

  const eventID = store.allocateEventID(state.eventRoot);
  const event = store.normalizeEventRecord({
    eventID,
    ownerID: normalizedOwnerID,
    creatorID: access.toPositiveInt(creatorID, OWNER_SYSTEM_ID),
    scope,
    source: SOURCE_SERVER,
    title: sanitized.title,
    description: sanitized.description,
    eventDateTime: String(access.toFileTimeBigInt(eventDateTime, 0n)),
    eventDuration: duration == null ? null : access.toInt(duration, 0),
    importance: sanitized.importance,
    autoEventType: autoEventType == null ? null : access.toInt(autoEventType, 0),
    isDeleted: false,
    deletedAt: null,
    createdAt: access.currentFileTimeString(),
    updatedAt: access.currentFileTimeString(),
    inviteeCharacterIDs: [],
    seedKey: seedKey == null ? null : String(seedKey),
    serverEditable,
  });

  state.eventRoot.events[String(event.eventID)] = event;
  if (scope !== SCOPE_GLOBAL) {
    upsertResponse(
      event,
      access.toPositiveInt(creatorID, OWNER_SYSTEM_ID),
      EVENT_RESPONSE_ACCEPTED,
    );
  }
  store.persistEventRoot(state.eventRoot);
  store.persistResponseRoot(state.responseRoot);
  rebuildIndexes();
  return event;
}

function editEventRecord(session, eventID, oldDateTime, nextFields = {}) {
  ensureLoaded();
  const event = requireEvent(eventID);
  calendarAssert(access.canEditOrDeleteEvent(event, session), "CustomNotify", {
    notify: "You do not have permission to edit that calendar event.",
  });
  calendarAssert(!event.isDeleted, "CustomNotify", {
    notify: "That calendar event has been deleted.",
  });
  calendarAssert(
    access.toFileTimeBigInt(oldDateTime, 0n) ===
      access.toFileTimeBigInt(event.eventDateTime, 0n),
    "CustomNotify",
    { notify: "The calendar event changed before it could be edited." },
  );

  const sanitized = validateSharedEventFields(
    nextFields.eventDateTime,
    nextFields.title,
    nextFields.description,
    nextFields.importance,
  );
  const previousEventDateTime = event.eventDateTime;
  event.eventDateTime = String(access.toFileTimeBigInt(nextFields.eventDateTime, 0n));
  event.eventDuration = nextFields.duration == null ? null : access.toInt(nextFields.duration, 0);
  event.title = sanitized.title;
  event.description = sanitized.description;
  event.importance = sanitized.importance;
  event.updatedAt = access.currentFileTimeString();
  const normalizedEvent = store.normalizeEventRecord(event, event.eventID);
  state.eventRoot.events[String(event.eventID)] = normalizedEvent;

  if (previousEventDateTime !== normalizedEvent.eventDateTime) {
    for (const response of state.responsesByEvent.get(normalizedEvent.eventID)?.values() || []) {
      if (
        response.characterID !== normalizedEvent.creatorID &&
        [
          EVENT_RESPONSE_ACCEPTED,
          EVENT_RESPONSE_MAYBE,
          EVENT_RESPONSE_UNDECIDED,
        ].includes(response.status)
      ) {
        upsertResponse(normalizedEvent, response.characterID, EVENT_RESPONSE_UNDECIDED);
      }
    }
  }

  store.persistEventRoot(state.eventRoot);
  store.persistResponseRoot(state.responseRoot);
  rebuildIndexes();
  return {
    event: normalizedEvent,
    oldEventDateTime: previousEventDateTime,
  };
}

function updateEventParticipants(session, eventID, charsToAdd = [], charsToRemove = []) {
  ensureLoaded();
  const event = requireEvent(eventID);
  calendarAssert(access.canEditOrDeleteEvent(event, session), "CustomNotify", {
    notify: "You do not have permission to update event participants.",
  });
  calendarAssert(event.scope === SCOPE_PERSONAL, "CustomNotify", {
    notify: "Only personal events support invitee updates.",
  });
  const addedCharacterIDs = [...new Set(
    (Array.isArray(charsToAdd) ? charsToAdd : [])
      .map((entry) => access.toPositiveInt(entry, 0))
      .filter((entry) => entry > 0 && entry !== event.creatorID),
  )];
  const removedCharacterIDs = [...new Set(
    (Array.isArray(charsToRemove) ? charsToRemove : [])
      .map((entry) => access.toPositiveInt(entry, 0))
      .filter((entry) => entry > 0 && entry !== event.creatorID),
  )];

  const inviteeSet = new Set(event.inviteeCharacterIDs);
  for (const characterID of removedCharacterIDs) {
    inviteeSet.delete(characterID);
    upsertResponse(event, characterID, EVENT_RESPONSE_UNINVITED);
  }
  for (const characterID of addedCharacterIDs) {
    inviteeSet.add(characterID);
    upsertResponse(event, characterID, EVENT_RESPONSE_UNDECIDED);
  }
  calendarAssert(inviteeSet.size <= CALENDAR_MAX_INVITEES, "CustomNotify", {
    notify: "Too many invitees selected for that event.",
  });

  event.inviteeCharacterIDs = [...inviteeSet].sort((left, right) => left - right);
  event.updatedAt = access.currentFileTimeString();
  state.eventRoot.events[String(event.eventID)] = store.normalizeEventRecord(event, event.eventID);

  store.persistEventRoot(state.eventRoot);
  store.persistResponseRoot(state.responseRoot);
  rebuildIndexes();
  return {
    event: requireEvent(event.eventID),
    addedCharacterIDs,
    removedCharacterIDs,
  };
}

function deleteEventRecord(session, eventID, ownerID = null) {
  ensureLoaded();
  const event = requireEvent(eventID);
  calendarAssert(
    ownerID == null || access.toPositiveInt(ownerID, event.ownerID) === event.ownerID,
    "CustomNotify",
    { notify: "Calendar event owner mismatch." },
  );
  calendarAssert(access.canEditOrDeleteEvent(event, session), "CustomNotify", {
    notify: "You do not have permission to delete that calendar event.",
  });
  event.isDeleted = true;
  event.deletedAt = access.currentFileTimeString();
  event.updatedAt = access.currentFileTimeString();
  state.eventRoot.events[String(event.eventID)] = store.normalizeEventRecord(event, event.eventID);
  store.persistEventRoot(state.eventRoot);
  rebuildIndexes();
  return requireEvent(event.eventID);
}

function sendEventResponse(session, eventID, ownerID = null, response) {
  ensureLoaded();
  const event = requireEvent(eventID);
  const characterID = access.getSessionCharacterID(session);
  calendarAssert(
    ownerID == null || access.toPositiveInt(ownerID, event.ownerID) === event.ownerID,
    "CustomNotify",
    { notify: "Calendar event owner mismatch." },
  );
  calendarAssert(access.canViewEvent(event, session), "CustomNotify", {
    notify: "You do not have access to that calendar event.",
  });
  if (event.scope === SCOPE_PERSONAL) {
    calendarAssert(
      event.ownerID === characterID || event.inviteeCharacterIDs.includes(characterID),
      "CustomNotify",
      { notify: "You are not invited to that calendar event." },
    );
  }
  const normalizedResponse = access.toInt(response, EVENT_RESPONSE_UNDECIDED);
  calendarAssert(
    [
      EVENT_RESPONSE_ACCEPTED,
      EVENT_RESPONSE_DECLINED,
      EVENT_RESPONSE_MAYBE,
      EVENT_RESPONSE_UNDECIDED,
    ].includes(normalizedResponse),
    "CustomNotify",
    { notify: "Invalid calendar response." },
  );
  upsertResponse(event, characterID, normalizedResponse);
  store.persistResponseRoot(state.responseRoot);
  rebuildIndexes();
  return {
    event,
    characterID,
    response: normalizedResponse,
  };
}

function getStateSummary() {
  ensureLoaded();
  const summary = {
    totalEvents: 0,
    totalResponses: 0,
    byScope: {
      [SCOPE_PERSONAL]: 0,
      [SCOPE_CORPORATION]: 0,
      [SCOPE_ALLIANCE]: 0,
      [SCOPE_GLOBAL]: 0,
    },
    bySource: {
      [SOURCE_PLAYER]: 0,
      [SOURCE_SERVER]: 0,
    },
  };
  for (const event of state.eventsByID.values()) {
    summary.totalEvents += 1;
    if (Object.prototype.hasOwnProperty.call(summary.byScope, event.scope)) {
      summary.byScope[event.scope] += 1;
    }
    if (Object.prototype.hasOwnProperty.call(summary.bySource, event.source)) {
      summary.bySource[event.source] += 1;
    }
  }
  for (const rows of state.responsesByEvent.values()) {
    summary.totalResponses += rows.size;
  }
  return summary;
}

function measureHotMonthFetch(session, month, year, iterations = 10000) {
  ensureLoaded();
  getEventsByMonthYear(session, month, year);
  const startedAt = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    getEventsByMonthYear(session, month, year);
  }
  const elapsedMs = performance.now() - startedAt;
  return {
    iterations,
    totalMs: elapsedMs,
    averageMs: elapsedMs / Math.max(1, iterations),
  };
}

module.exports = {
  getEvent,
  getEventsByMonthYear,
  getEventDetails,
  getResponsesForCharacter,
  getResponsesToEvent,
  createEventRecord,
  createServerEventRecord,
  editEventRecord,
  updateEventParticipants,
  deleteEventRecord,
  sendEventResponse,
  getStateSummary,
  measureHotMonthFetch,
  ensureLoaded,
  __resetForTests() {
    resetState();
  },
};
