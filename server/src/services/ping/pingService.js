/**
 * Ping Service
 *
 * Handles client pingService queries (different from low-level PingReq).
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

class PingService extends BaseService {
  constructor() {
    super("pingService");
  }

  Handle_Ping(args, session) {
    // log.debug("[PingService] Ping");
    return null;
  }
}

module.exports = PingService;
