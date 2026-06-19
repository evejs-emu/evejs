const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  getCharacterTutorialSnapshot,
  isAirNpeEnabled,
  markCharacterTutorialSkipped,
} = require(path.join(__dirname, "./tutorialRuntime"));

function resolveCharacterID(args, session) {
  const directArg = Array.isArray(args) ? Number(args[0]) : NaN;
  if (Number.isFinite(directArg) && Math.trunc(directArg) > 0) {
    return Math.trunc(directArg);
  }
  return Number(session && (session.charid || session.characterID || 0)) || 0;
}

class AirNpeService extends BaseService {
  constructor() {
    super("air_npe");
  }

  Handle_is_air_npe_enabled(args, session, kwargs) {
    log.debug("[AirNpeService] is_air_npe_enabled called");
    return isAirNpeEnabled();
  }

  Handle_get_air_npe_state(args, session) {
    log.debug("[AirNPE] get_air_npe_state called");
    return getCharacterTutorialSnapshot(resolveCharacterID(args, session))
      .airNpeState;
  }

  Handle_skip_air_npe(args, session) {
    const charId = resolveCharacterID(args, session);
    const skipResult = markCharacterTutorialSkipped(charId);
    if (
      skipResult.success &&
      skipResult.changed &&
      session &&
      typeof session.sendNotification === "function"
    ) {
      session.sendNotification("OnAirNpeStateChanged", "clientID", [
        charId,
        skipResult.snapshot.airNpeState,
      ]);
    }
    return null;
  }
}

module.exports = AirNpeService;
