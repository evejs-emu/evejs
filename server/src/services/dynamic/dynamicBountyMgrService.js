const BaseService = require("../baseService");
const log = require("../../utils/logger");

class DynamicBountyMgrService extends BaseService {
  constructor() {
    super("dynamicBountyMgr");
  }

  Handle_GetOutputForClientSolarSystem(args, session, kwargs) {
    const solarSystemID = (session && session.solarsystemid) || null;
    log.debug(
      `[DynamicBountyMgr] GetOutputForClientSolarSystem called (solarsystemid=${solarSystemID})`,
    );

    // Client code unpacks this result, so keep it tuple-like.
    // Returning zeros disables dynamic bounty behavior safely.
    return [0, 0];
  }

  callMethod(method, args, session, kwargs) {
    const response = super.callMethod(method, args, session, kwargs);
    if (response !== null) {
      return response;
    }

    log.warn(`[DynamicBountyMgr] Unhandled method fallback: ${method}`);
    return [0, 0];
  }
}

module.exports = DynamicBountyMgrService;
