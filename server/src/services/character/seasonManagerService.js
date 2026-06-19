const BaseService = require("../baseService");
const log = require("../../utils/logger");

class SeasonManagerService extends BaseService {
  constructor() {
    super("seasonManager");
  }

  Handle_get_season_data_for_character(args, session) {
    log.debug("[SeasonManager] get_season_data_for_character called");
    return null;
  }
}

module.exports = SeasonManagerService;
