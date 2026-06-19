const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const CalendarMgrService = require(path.join(
  repoRoot,
  "server/src/services/calendar/calendarMgrService",
));
const CalendarProxyService = require(path.join(
  repoRoot,
  "server/src/services/calendar/calendarProxyService",
));
const {
  executeCalendarAutoCommand,
} = require(path.join(
  repoRoot,
  "server/src/services/calendar/calendarChatCommands",
));
const runtime = require(path.join(
  repoRoot,
  "server/src/services/calendar/calendarRuntimeState",
));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));
const MachoNetService = require(path.join(
  repoRoot,
  "server/src/services/machoNet/machoNetService",
));
const {
  EVENT_RESPONSE_ACCEPTED,
  EVENT_RESPONSE_UNDECIDED,
} = require(path.join(
  repoRoot,
  "server/src/services/calendar/calendarConstants",
));
const {
  unwrapMarshalValue,
} = require(path.join(
  repoRoot,
  "server/src/services/_shared/serviceHelpers",
));

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildSession(characterID, overrides = {}) {
  const characters = database.read("characters", "/").data || {};
  const character = characters[String(characterID)] || {};
  return {
    characterID,
    charid: characterID,
    corpid: Number(character.corporationID || 0) || 0,
    corporationID: Number(character.corporationID || 0) || 0,
    allianceid: Number(character.allianceID || 0) || 0,
    allianceID: Number(character.allianceID || 0) || 0,
    corprole: 0n,
    notifications: [],
    socket: { destroyed: false },
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
    ...overrides,
  };
}

function buildFutureFiletimeString(daysAhead, hour = 12, minute = 0) {
  const target = new Date();
  target.setUTCDate(target.getUTCDate() + daysAhead);
  target.setUTCHours(hour, minute, 0, 0);
  return (
    BigInt(target.getTime()) * 10000n + 116444736000000000n
  ).toString();
}

function filetimeStringToMonthYear(filetimeString) {
  const unixMilliseconds = Number(
    (BigInt(String(filetimeString)) - 116444736000000000n) / 10000n,
  );
  const date = new Date(unixMilliseconds);
  return {
    month: date.getUTCMonth() + 1,
    year: date.getUTCFullYear(),
  };
}

function readTable(tableName) {
  const result = database.read(tableName, "/");
  return result && result.success ? cloneValue(result.data) : {};
}

function writeTable(tableName, payload) {
  const result = database.write(tableName, "/", payload);
  assert.equal(result.success, true, `failed to write ${tableName}`);
}

function withCalendarSnapshots(run) {
  return async (t) => {
    const originalEvents = readTable("calendarEvents");
    const originalResponses = readTable("calendarResponses");
    t.after(() => {
      writeTable("calendarEvents", originalEvents);
      writeTable("calendarResponses", originalResponses);
      runtime.__resetForTests();
      database.flushAllSync();
    });
    runtime.__resetForTests();
    await run();
  };
}

function withRegisteredSessions(sessions, run) {
  return async () => {
    const normalizedSessions = Array.isArray(sessions) ? sessions : [sessions];
    for (const session of normalizedSessions) {
      sessionRegistry.register(session);
    }
    try {
      await run(normalizedSessions);
    } finally {
      for (const session of normalizedSessions) {
        sessionRegistry.unregister(session);
      }
    }
  };
}

test("calendar personal create/list/detail/respond flows persist and stay visible to invitees", withCalendarSnapshots(() => {
  const calendarMgr = new CalendarMgrService();
  const calendarProxy = new CalendarProxyService();
  const ownerSession = buildSession(140000003);
  const inviteeSession = buildSession(140000002);
  const eventDateTime = buildFutureFiletimeString(3, 19, 30);
  const eventMonth = filetimeStringToMonthYear(eventDateTime);

  const eventID = calendarMgr.Handle_CreatePersonalEvent(
    [
      eventDateTime,
      120,
      "Parity Personal Event",
      "Bring ammo and good decisions.",
      1,
      [140000002],
    ],
    ownerSession,
  );

  assert.ok(Number(eventID) > 0, "expected numeric event ID");

  const ownerMonth = unwrapMarshalValue(
    calendarProxy.Handle_GetEventList([eventMonth.month, eventMonth.year], ownerSession),
  );
  const ownerEvents = ownerMonth.flat();
  assert.equal(
    ownerEvents.some((event) => Number(event.eventID) === Number(eventID)),
    true,
  );

  const inviteeMonth = unwrapMarshalValue(
    calendarProxy.Handle_GetEventList([eventMonth.month, eventMonth.year], inviteeSession),
  );
  const inviteeEvents = inviteeMonth.flat();
  assert.equal(
    inviteeEvents.some((event) => Number(event.eventID) === Number(eventID)),
    true,
  );

  const details = unwrapMarshalValue(
    calendarProxy.Handle_GetEventDetails([eventID, ownerSession.characterID], ownerSession),
  );
  assert.equal(details.eventText, "Bring ammo and good decisions.");
  assert.equal(Number(details.creatorID), ownerSession.characterID);

  const ownerResponses = unwrapMarshalValue(
    calendarMgr.Handle_GetResponsesForCharacter([], ownerSession),
  );
  assert.equal(
    ownerResponses.some(
      (response) =>
        Number(response.eventID) === Number(eventID) &&
        Number(response.status) === EVENT_RESPONSE_ACCEPTED,
    ),
    true,
  );

  const eventResponses = unwrapMarshalValue(
    calendarMgr.Handle_GetResponsesToEvent([eventID, ownerSession.characterID], ownerSession),
  );
  assert.equal(
    eventResponses.some(
      (response) =>
        Number(response.characterID) === 140000002 &&
        Number(response.status) === EVENT_RESPONSE_UNDECIDED,
    ),
    true,
  );
}));

test("calendar edit, participant updates, and delete persist cleanly", withCalendarSnapshots(() => {
  const calendarMgr = new CalendarMgrService();
  const calendarProxy = new CalendarProxyService();
  const ownerSession = buildSession(140000003);
  const eventDateTime = buildFutureFiletimeString(5, 18, 15);
  const editedDateTime = buildFutureFiletimeString(7, 20, 45);
  const editedMonth = filetimeStringToMonthYear(editedDateTime);

  const eventID = calendarMgr.Handle_CreatePersonalEvent(
    [
      eventDateTime,
      60,
      "Draft Event",
      "Initial text",
      0,
      [140000002],
    ],
    ownerSession,
  );

  calendarMgr.Handle_EditPersonalEvent(
    [
      eventID,
      eventDateTime,
      editedDateTime,
      180,
      "Edited Event",
      "Edited description",
      1,
    ],
    ownerSession,
  );

  calendarMgr.Handle_UpdateEventParticipants(
    [eventID, [140000001], [140000002]],
    ownerSession,
  );

  const detailsAfterEdit = unwrapMarshalValue(
    calendarProxy.Handle_GetEventDetails([eventID, ownerSession.characterID], ownerSession),
  );
  assert.equal(detailsAfterEdit.eventText, "Edited description");

  const responsesAfterEdit = unwrapMarshalValue(
    calendarMgr.Handle_GetResponsesToEvent([eventID, ownerSession.characterID], ownerSession),
  );
  assert.equal(
    responsesAfterEdit.some(
      (response) =>
        Number(response.characterID) === 140000002 &&
        Number(response.status) === 0,
    ),
    true,
  );
  assert.equal(
    responsesAfterEdit.some(
      (response) =>
        Number(response.characterID) === 140000001 &&
        Number(response.status) === EVENT_RESPONSE_UNDECIDED,
    ),
    true,
  );

  calendarMgr.Handle_DeleteEvent([eventID, ownerSession.characterID], ownerSession);

  const monthRows = unwrapMarshalValue(
    calendarProxy.Handle_GetEventList([editedMonth.month, editedMonth.year], ownerSession),
  ).flat();
  const deletedRow = monthRows.find((event) => Number(event.eventID) === Number(eventID));
  assert.ok(deletedRow, "expected deleted event to remain tombstoned in month payload");
  assert.equal(Boolean(deletedRow.isDeleted), true);
}));

test("calendar corporation and alliance visibility follows session owner scope", withCalendarSnapshots(() => {
  const calendarMgr = new CalendarMgrService();
  const calendarProxy = new CalendarProxyService();
  const corpManagerSession = buildSession(140000003, {
    corprole: 36028797018963968n,
  });
  const corpMateSession = buildSession(140000002);
  const outsiderSession = buildSession(140000001);
  const eventDateTime = buildFutureFiletimeString(4, 15, 0);
  const eventMonth = filetimeStringToMonthYear(eventDateTime);

  const corpEventID = calendarMgr.Handle_CreateCorporationEvent(
    [eventDateTime, 90, "Corp Standup", "Corp-only parity meeting.", 1],
    corpManagerSession,
  );
  const allianceEventID = calendarMgr.Handle_CreateAllianceEvent(
    [eventDateTime, 45, "Alliance Ping", "Alliance-only parity meeting.", 0],
    corpManagerSession,
  );

  const corpMateRows = unwrapMarshalValue(
    calendarProxy.Handle_GetEventList([eventMonth.month, eventMonth.year], corpMateSession),
  ).flat();
  assert.equal(
    corpMateRows.some((event) => Number(event.eventID) === Number(corpEventID)),
    true,
  );
  assert.equal(
    corpMateRows.some((event) => Number(event.eventID) === Number(allianceEventID)),
    true,
  );

  const outsiderRows = unwrapMarshalValue(
    calendarProxy.Handle_GetEventList([eventMonth.month, eventMonth.year], outsiderSession),
  ).flat();
  assert.equal(
    outsiderRows.some((event) => Number(event.eventID) === Number(corpEventID)),
    false,
  );
  assert.equal(
    outsiderRows.some((event) => Number(event.eventID) === Number(allianceEventID)),
    false,
  );
}));

test("calendar seeds make-a-wish global events and hot month fetch stays extremely fast", withCalendarSnapshots(() => {
  runtime.ensureLoaded();
  const session = buildSession(140000001);
  const currentYear = new Date().getUTCFullYear();
  let seededEventFound = false;
  for (let month = 1; month <= 12; month += 1) {
    const rows = runtime.getEventsByMonthYear(session, month, currentYear);
    if (rows.some((event) => String(event.title) === "Make a wish")) {
      seededEventFound = true;
      break;
    }
  }
  assert.equal(seededEventFound, true, "expected seeded Make a wish global events");

  const benchmark = runtime.measureHotMonthFetch(
    session,
    new Date().getUTCMonth() + 1,
    currentYear,
    20000,
  );
  assert.ok(benchmark.averageMs < 0.1, `expected hot calendar cache fetch under 0.1ms, got ${benchmark.averageMs.toFixed(4)}ms`);
}));

test("calendar personal create avoids duplicate self notification but still updates other live viewers", withCalendarSnapshots(() => withRegisteredSessions([
  buildSession(140000003),
  buildSession(140000003, { clientID: 2, clientId: 2 }),
  buildSession(140000002),
], ([originSession, altSession, inviteeSession]) => {
  const calendarMgr = new CalendarMgrService();
  const eventDateTime = buildFutureFiletimeString(2, 19, 0);

  const eventID = calendarMgr.Handle_CreatePersonalEvent(
    [
      eventDateTime,
      60,
      "No duplicate self add",
      "Current client should local-inject, other viewers should get notified.",
      1,
      [inviteeSession.characterID],
    ],
    originSession,
  );

  assert.ok(Number(eventID) > 0);
  assert.equal(
    originSession.notifications.some((entry) => entry.name === "OnNewCalendarEvent"),
    false,
  );
  assert.equal(
    altSession.notifications.some((entry) => entry.name === "OnNewCalendarEvent"),
    true,
  );
  assert.equal(
    inviteeSession.notifications.some((entry) => entry.name === "OnNewCalendarEvent"),
    true,
  );
})));

test("calendar corp live notifications reach online viewers and external responses fan out beyond the responder", withCalendarSnapshots(() => withRegisteredSessions([
  buildSession(240000001, {
    corporationID: 98000001,
    corpid: 98000001,
    allianceID: 99000001,
    allianceid: 99000001,
    corprole: 36028797018963968n,
  }),
  buildSession(240000002, {
    corporationID: 98000001,
    corpid: 98000001,
    allianceID: 99000001,
    allianceid: 99000001,
  }),
  buildSession(240000003, {
    corporationID: 98000001,
    corpid: 98000001,
    allianceID: 99000001,
    allianceid: 99000001,
  }),
], ([managerSession, responderSession, watcherSession]) => {
  const calendarMgr = new CalendarMgrService();
  const eventDateTime = buildFutureFiletimeString(4, 17, 45);

  const eventID = calendarMgr.Handle_CreateCorporationEvent(
    [eventDateTime, 30, "Corp live notify", "Corp event create should reach online corp viewers.", 1],
    managerSession,
  );

  assert.ok(Number(eventID) > 0);
  assert.equal(
    managerSession.notifications.some((entry) => entry.name === "OnNewCalendarEvent"),
    true,
  );
  assert.equal(
    watcherSession.notifications.some((entry) => entry.name === "OnNewCalendarEvent"),
    true,
  );

  responderSession.notifications.length = 0;
  watcherSession.notifications.length = 0;
  managerSession.notifications.length = 0;

  calendarMgr.Handle_SendEventResponse(
    [eventID, managerSession.corporationID, EVENT_RESPONSE_ACCEPTED],
    responderSession,
  );

  assert.equal(
    responderSession.notifications.some((entry) => entry.name === "OnEventResponseByExternal"),
    false,
  );
  assert.equal(
    managerSession.notifications.some((entry) => entry.name === "OnEventResponseByExternal"),
    true,
  );
  assert.equal(
    watcherSession.notifications.some((entry) => entry.name === "OnEventResponseByExternal"),
    true,
  );
})));

test("calendar machoNet service info and calauto smoke expose the calendar slice cleanly", withCalendarSnapshots(() => {
  const machoNet = new MachoNetService();
  const entries = machoNet.getServiceInfoDict().entries;
  assert.equal(
    entries.some(([serviceName, binding]) => serviceName === "calendarMgr" && binding === null),
    true,
  );
  assert.equal(
    entries.some(([serviceName, binding]) => serviceName === "calendarProxy" && binding === null),
    true,
  );

  const session = buildSession(140000003, {
    corprole: 36028797018963968n,
  });
  const result = executeCalendarAutoCommand(session, "smoke");
  assert.equal(result.success, true);
  assert.match(result.message, /Created personal calendar demo event/);
  assert.match(result.message, /Created corporation calendar demo event/);
  assert.match(result.message, /Created alliance calendar demo event/);
  assert.match(result.message, /Created global calendar demo event/);

  const summary = runtime.getStateSummary();
  assert.ok(summary.totalEvents >= 4);
}));
