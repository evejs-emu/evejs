const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

class PublicGatewayService extends BaseService {
  constructor(name = "publicGateway") {
    super(name);
  }

  callMethod(method, args, session, kwargs) {
    log.info(`[PublicGateway] called: ${method}`);
    if (args) {
      log.info(
        `[PublicGateway] args: ${JSON.stringify(args, (k, v) => (typeof v === "bigint" ? v.toString() : Buffer.isBuffer(v) ? v.toString("utf8") : v))}`,
      );
    }
    if (kwargs) {
      log.info(
        `[PublicGateway] kwargs: ${JSON.stringify(kwargs, (k, v) => (typeof v === "bigint" ? v.toString() : Buffer.isBuffer(v) ? v.toString("utf8") : v))}`,
      );
    }

    // Try finding handler just in case
    const res = super.callMethod(method, args, session, kwargs);
    if (res !== null) return res;

    // Return dummy response to prevent ECONNRESET or exceptions
    return { type: "dict", entries: [] };
  }

  Handle_send_request(args, session, kwargs) {
    log.debug(`[PublicGateway] Handle_send_request`);
    return { type: "dict", entries: [] };
  }
}

class PublicGatewaySvcAlias extends PublicGatewayService {
  constructor() {
    super("publicGatewaySvc");
  }
}

module.exports = {
  PublicGatewayService,
  PublicGatewaySvcAlias,
};
