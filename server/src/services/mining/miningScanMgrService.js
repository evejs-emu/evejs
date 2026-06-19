const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const miningRuntime = require("./miningRuntime");

class MiningScanMgrService extends BaseService {
  constructor() {
    super("miningScanMgr");
  }

  Handle_perform_scan(args, session) {
    return miningRuntime.buildScanResultsForSession(session);
  }

  perform_scan(args, session) {
    return this.Handle_perform_scan(args, session);
  }
}

module.exports = MiningScanMgrService;
