const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  getNextAvailableAlphaInjectionForSession,
} = require(path.join(__dirname, "../skills/trading/skillTradingRuntime"));

class AlphaInjectorMgrService extends BaseService {
  constructor() {
    super("alphaInjectorMgr");
  }

  Handle_GetNextAvailableInjection(args, session) {
    return {
      type: "long",
      value: getNextAvailableAlphaInjectionForSession(session),
    };
  }
}

module.exports = AlphaInjectorMgrService;
