const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  getAvailableNonDiminishingInjectionsForSession,
} = require(path.join(__dirname, "../skills/trading/skillTradingRuntime"));

class nonDiminishingInjectionMgrService extends BaseService {
  constructor() {
    super("nonDiminishingInjectionMgr");
  }

  Handle_GetAvailableNonDiminishingInjections(args, session) {
    return getAvailableNonDiminishingInjectionsForSession(session);
  }
}

module.exports = nonDiminishingInjectionMgrService;
