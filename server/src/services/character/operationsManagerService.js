const BaseService = require("../baseService");
const log = require("../../utils/logger");
const {
  getCharacterTutorialSnapshot,
} = require("../npe/tutorialRuntime");

function resolveCharacterID(args, session) {
  const directArg = Array.isArray(args) ? Number(args[0]) : NaN;
  if (Number.isFinite(directArg) && Math.trunc(directArg) > 0) {
    return Math.trunc(directArg);
  }
  return Number(session && (session.charid || session.characterID || 0)) || 0;
}

class OperationsManagerService extends BaseService {
  constructor() {
    super("operationsManager");
  }

  Handle_can_character_play_the_tutorial(args, session) {
    log.debug("[OperationsManager] can_character_play_the_tutorial called");
    return getCharacterTutorialSnapshot(resolveCharacterID(args, session))
      .canPlayTutorial;
  }

  Handle_get_tutorial_state(args, session) {
    return getCharacterTutorialSnapshot(resolveCharacterID(args, session))
      .tutorialState;
  }

  Handle_is_main_tutorial_finished(args, session) {
    return getCharacterTutorialSnapshot(resolveCharacterID(args, session))
      .isMainTutorialFinished;
  }

  Handle_has_skipped_tutorial(args, session) {
    return getCharacterTutorialSnapshot(resolveCharacterID(args, session))
      .hasSkippedTutorial;
  }

  Handle_get_character_progress(args, session) {
    return {};
  }

  Handle_get_active_category_id(args, session) {
    return null;
  }

  Handle_start_site(args, session) {
    return null;
  }

  Handle_process_client_event(args, session, kwargs) {
    return null;
  }
}

module.exports = OperationsManagerService;
