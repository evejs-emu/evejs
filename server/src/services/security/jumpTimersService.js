const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

class JumpTimersService extends BaseService {
  constructor() {
    super("jumpTimers");
  }

  Handle_GetTimers(args, session) {
    log.debug("[JumpTimers] GetTimers called");
    // Returns (jumpActivation, jumpFatigue, lastUpdated)
    return [null, null, null];
  }
}

module.exports = JumpTimersService;
