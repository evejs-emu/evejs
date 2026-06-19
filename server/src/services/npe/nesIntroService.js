const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  getCharacterTutorialSnapshot,
  markCharacterNesIntroSkipped,
} = require(path.join(__dirname, "./tutorialRuntime"));

function resolveCharacterID(args, session) {
  const directArg = Array.isArray(args) ? Number(args[0]) : NaN;
  if (Number.isFinite(directArg) && Math.trunc(directArg) > 0) {
    return Math.trunc(directArg);
  }
  return Number(session && (session.charid || session.characterID || 0)) || 0;
}

class NesIntroService extends BaseService {
  constructor() {
    super("nes_intro");
  }

  Handle_get_nes_intro_state(args, session) {
    log.debug("[NesIntroService] get_nes_intro_state called");
    return getCharacterTutorialSnapshot(resolveCharacterID(args, session))
      .nesIntroState;
  }

  Handle_skip_nes_intro(args, session) {
    const charId = resolveCharacterID(args, session);
    const skipResult = markCharacterNesIntroSkipped(charId);
    if (
      skipResult.success &&
      skipResult.changed &&
      session &&
      typeof session.sendNotification === "function"
    ) {
      session.sendNotification("OnNesIntroStateChanged", "clientID", [
        charId,
        skipResult.snapshot.nesIntroState,
      ]);
    }
    return Boolean(skipResult.success);
  }
}

module.exports = NesIntroService;
