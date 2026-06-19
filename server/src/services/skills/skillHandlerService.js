const SkillMgrService = require("./skillMgrService");

class SkillHandlerService extends SkillMgrService {
  constructor() {
    super();
    this._name = "skillHandler";
  }
}

module.exports = SkillHandlerService;
