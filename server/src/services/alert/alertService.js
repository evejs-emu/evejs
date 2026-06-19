/**
 * Alert Service
 *
 * Handles client alert calls like crash reports (BeanCount).
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

class AlertService extends BaseService {
  constructor() {
    super("alert");
  }

  Handle_BeanCount(args, session) {
    log.debug("[AlertService] BeanCount (crash report)");
    // Client unpacks: (nextErrorKeyHash, nodeID) = result
    return [null, null];
  }

  Handle_SendClientStackTraceAlert(args, session) {
    const traceData = args && args.length > 0 ? args : [];
    log.warn(
      `[AlertService] SendClientStackTraceAlert char=${session && session.characterID} trace=${JSON.stringify(traceData).slice(0, 2000)}`,
    );
    return null;
  }
}

module.exports = AlertService;
