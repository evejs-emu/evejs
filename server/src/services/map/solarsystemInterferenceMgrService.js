const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildDict,
  buildFiletimeLong,
  buildObjectEx1,
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const STATE_CLASS_NAME =
  "solarsysteminterference.solarsystemInterferenceState.SolarsystemInterferenceState";

function buildQuietInterferenceState() {
  return buildObjectEx1(STATE_CLASS_NAME, [
    0,
    buildFiletimeLong(currentFileTime()),
    1,
    3600,
    100,
    0,
  ]);
}

class SolarSystemInterferenceMgrService extends BaseService {
  constructor() {
    super("solarsystemInterferenceMgr");
  }

  Handle_GetLocalInterferenceState() {
    log.debug("[SolarSystemInterferenceMgr] GetLocalInterferenceState -> quiet");
    return buildQuietInterferenceState();
  }

  Handle_GetAllInterferenceBands() {
    log.debug("[SolarSystemInterferenceMgr] GetAllInterferenceBands -> empty");
    return buildDict([]);
  }
}

module.exports = SolarSystemInterferenceMgrService;
