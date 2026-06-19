const BaseService = require("../baseService");
const log = require("../../utils/logger");

class EventLogService extends BaseService {
  constructor() {
    super("eventLog");
  }

  Handle_LogClientStats(args, session) {
    log.debug("[EventLog] LogClientStats called");
    return null;
  }

  Handle_LogPlayerRequestedDisconnect(args, session) {
    log.debug("[EventLog] LogPlayerRequestedDisconnect called");
    return null;
  }
}

module.exports = EventLogService;
