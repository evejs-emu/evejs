const BaseService = require("../baseService");
const log = require("../../utils/logger");

class MilestoneMgrService extends BaseService {
  constructor() {
    super("milestoneMgr");
  }

  Handle_ProcessCharacterLogon(args, session) {
    log.debug("[MilestoneMgr] ProcessCharacterLogon called");
    return null;
  }
}

module.exports = MilestoneMgrService;
