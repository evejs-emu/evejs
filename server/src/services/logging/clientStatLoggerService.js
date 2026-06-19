const BaseService = require("../baseService");
const log = require("../../utils/logger");

class ClientStatLoggerService extends BaseService {
  constructor() {
    super("clientStatLogger");
  }

  Handle_LogString(args, session) {
    log.debug("[ClientStatLogger] LogString called");
    return null;
  }
}

module.exports = ClientStatLoggerService;
