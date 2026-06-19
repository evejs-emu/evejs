const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const runtime = require(path.join(__dirname, "./calendarRuntimeState"));
const payloads = require(path.join(__dirname, "./calendarPayloads"));

class CalendarProxyService extends BaseService {
  constructor() {
    super("calendarProxy");
    runtime.ensureLoaded();
  }

  Handle_GetEventList(args, session) {
    return payloads.buildEventListPayload(
      runtime.getEventsByMonthYear(session, args && args[0], args && args[1]),
      session,
    );
  }

  Handle_GetEventDetails(args, session) {
    return payloads.buildEventDetails(
      runtime.getEventDetails(session, args && args[0], args && args[1]),
    );
  }
}

module.exports = CalendarProxyService;
