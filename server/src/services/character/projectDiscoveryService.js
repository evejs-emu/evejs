const BaseService = require("../baseService");
const log = require("../../utils/logger");

class ProjectDiscoveryService extends BaseService {
  constructor() {
    super("ProjectDiscovery");
  }

  Handle_initialize_tutorial_status(args, session) {
    log.debug("[ProjectDiscovery] initialize_tutorial_status called");
    return true;
  }

  Handle_is_enabled(args, session) {
    log.debug("[ProjectDiscovery] is_enabled called");
    return false;
  }
}

module.exports = ProjectDiscoveryService;
