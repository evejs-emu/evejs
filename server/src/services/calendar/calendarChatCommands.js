const path = require("path");

const runtime = require(path.join(__dirname, "./calendarRuntimeState"));
const notifications = require(path.join(__dirname, "./calendarNotifications"));
const {
  OWNER_SYSTEM_ID,
  SCOPE_ALLIANCE,
  SCOPE_CORPORATION,
  SCOPE_GLOBAL,
  SCOPE_PERSONAL,
} = require(path.join(__dirname, "./calendarConstants"));

function toInt(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.trunc(numericValue) : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numericValue = toInt(value, fallback);
  return numericValue > 0 ? numericValue : fallback;
}

function getContext(session) {
  if (!session || typeof session !== "object") {
    return {
      lastEventID: null,
    };
  }
  session._calendarAutoContext =
    session._calendarAutoContext && typeof session._calendarAutoContext === "object"
      ? session._calendarAutoContext
      : {
          lastEventID: null,
        };
  return session._calendarAutoContext;
}

function buildHelpText() {
  return [
    "/calauto help",
    "/calauto status",
    "/calauto personal [daysAhead]",
    "/calauto corp [daysAhead]",
    "/calauto alliance [daysAhead]",
    "/calauto global [daysAhead]",
    "/calauto future [daysAhead]",
    "/calauto smoke",
  ].join("\n");
}

function buildFutureFiletimeString(daysAhead, hour = 11, minute = 11) {
  const target = new Date();
  target.setUTCDate(target.getUTCDate() + Math.max(1, toPositiveInt(daysAhead, 3)));
  target.setUTCHours(hour, minute, 0, 0);
  return (
    BigInt(target.getTime()) * 10000n + 116444736000000000n
  ).toString();
}

function notifyCreatedEvent(event, options = {}) {
  notifications.notifyNewCalendarEvent(
    notifications.listOnlineViewerCharacterIDs(event, options),
    event,
    options,
  );
}

function createPersonalDemoEvent(session, daysAhead = 3) {
  const event = runtime.createEventRecord({
    session,
    scope: SCOPE_PERSONAL,
    eventDateTime: buildFutureFiletimeString(daysAhead, 20, 0),
    duration: 90,
    title: "Calendar Auto Personal",
    description: "Personal calendar parity demo event.",
    importance: 1,
    inviteeCharacterIDs: [],
  });
  notifyCreatedEvent(event, { excludeSession: session });
  return event;
}

function createCorporationDemoEvent(session, daysAhead = 4) {
  const event = runtime.createEventRecord({
    session,
    scope: SCOPE_CORPORATION,
    eventDateTime: buildFutureFiletimeString(daysAhead, 19, 0),
    duration: 60,
    title: "Calendar Auto Corp",
    description: "Corporation calendar parity demo event.",
    importance: 1,
  });
  notifyCreatedEvent(event);
  return event;
}

function createAllianceDemoEvent(session, daysAhead = 5) {
  const event = runtime.createEventRecord({
    session,
    scope: SCOPE_ALLIANCE,
    eventDateTime: buildFutureFiletimeString(daysAhead, 18, 0),
    duration: 45,
    title: "Calendar Auto Alliance",
    description: "Alliance calendar parity demo event.",
    importance: 0,
  });
  notifyCreatedEvent(event);
  return event;
}

function createGlobalDemoEvent(daysAhead = 6) {
  const event = runtime.createServerEventRecord({
    ownerID: OWNER_SYSTEM_ID,
    creatorID: OWNER_SYSTEM_ID,
    scope: SCOPE_GLOBAL,
    eventDateTime: buildFutureFiletimeString(daysAhead, 11, 11),
    duration: 30,
    title: "Calendar Auto Global",
    description: "Server-managed global calendar parity demo event.",
    importance: 1,
    serverEditable: true,
  });
  notifyCreatedEvent(event);
  return event;
}

function executeCalendarAutoCommand(session, rawText = "") {
  const tokens = String(rawText || "").trim().split(/\s+/).filter(Boolean);
  const subcommand = String(tokens[0] || "help").toLowerCase();
  const daysAhead = toPositiveInt(tokens[1], 3);
  const context = getContext(session);

  try {
    if (subcommand === "help") {
      return { success: true, message: buildHelpText() };
    }

    if (subcommand === "status") {
      const summary = runtime.getStateSummary();
      return {
        success: true,
        message:
          `Events=${summary.totalEvents} responses=${summary.totalResponses} ` +
          `personal=${summary.byScope.personal} corp=${summary.byScope.corporation} ` +
          `alliance=${summary.byScope.alliance} global=${summary.byScope.global} ` +
          `player=${summary.bySource.player} server=${summary.bySource.server} ` +
          `lastEventID=${context.lastEventID || "none"}`,
      };
    }

    if (subcommand === "personal") {
      const event = createPersonalDemoEvent(session, daysAhead);
      context.lastEventID = event.eventID;
      return {
        success: true,
        message: `Created personal calendar demo event ${event.eventID}.`,
      };
    }

    if (subcommand === "corp") {
      const event = createCorporationDemoEvent(session, daysAhead);
      context.lastEventID = event.eventID;
      return {
        success: true,
        message: `Created corporation calendar demo event ${event.eventID}.`,
      };
    }

    if (subcommand === "alliance") {
      const event = createAllianceDemoEvent(session, daysAhead);
      context.lastEventID = event.eventID;
      return {
        success: true,
        message: `Created alliance calendar demo event ${event.eventID}.`,
      };
    }

    if (subcommand === "global") {
      const event = createGlobalDemoEvent(daysAhead);
      context.lastEventID = event.eventID;
      return {
        success: true,
        message: `Created global calendar demo event ${event.eventID}.`,
      };
    }

    if (subcommand === "future") {
      const event = createGlobalDemoEvent(Math.max(14, daysAhead));
      context.lastEventID = event.eventID;
      return {
        success: true,
        message: `Created future global calendar event ${event.eventID}.`,
      };
    }

    if (subcommand === "smoke") {
      const results = [
        executeCalendarAutoCommand(session, "personal 2"),
        executeCalendarAutoCommand(session, "corp 3"),
        executeCalendarAutoCommand(session, "alliance 4"),
        executeCalendarAutoCommand(session, "global 5"),
      ];
      return {
        success: true,
        message: results.map((entry) => entry.message).join("\n"),
      };
    }

    return { success: false, message: `Unknown /calauto subcommand: ${subcommand}` };
  } catch (error) {
    return {
      success: false,
      message: `Calendar auto command failed: ${(error && error.message) || "UNKNOWN_ERROR"}`,
    };
  }
}

module.exports = {
  executeCalendarAutoCommand,
};
