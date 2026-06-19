const BaseService = require("../baseService");
const log = require("../../utils/logger");

class AchievementTrackerMgrService extends BaseService {
  constructor() {
    super("achievementTrackerMgr");
  }

  Handle_GetCompletedAchievementsAndClientEventCount(args, session) {
    log.debug(
      "[AchievementTrackerMgr] GetCompletedAchievementsAndClientEventCount called",
    );
    return {
      type: "dict",
      entries: [
        ["completedDict", { type: "dict", entries: [] }],
        ["eventDict", { type: "dict", entries: [] }],
      ],
    };
  }

  Handle_UpdateClientAchievmentsAndCounters(args, session) {
    log.debug(
      "[AchievementTrackerMgr] UpdateClientAchievmentsAndCounters called",
    );
    return null;
  }
}

module.exports = AchievementTrackerMgrService;
