const path = require("path");

const {
  TUTORIAL_FIRST_LOGIN_HANDOFF,
} = require(path.join(__dirname, "./tutorialRuntime"));

function isLiveSession(session) {
  return Boolean(
    session &&
    Number(session.characterID || session.charid || 0) > 0 &&
    (!session.socket || session.socket.destroyed !== true),
  );
}

function resolveReturnDockLocationID(session) {
  return Number(
    (session && (
      session.stationid ||
      session.stationID ||
      session.structureid ||
      session.structureID ||
      session.homeStationID ||
      session.homestationid ||
      session.cloneStationID ||
      session.clonestationid
    )) || 0,
  ) || 0;
}

function runTutorialFirstLoginHandoff(
  session,
  handoffMode,
  options = {},
) {
  const normalizedHandoffMode = String(handoffMode || "").trim().toLowerCase();
  if (normalizedHandoffMode !== TUTORIAL_FIRST_LOGIN_HANDOFF.CINEMATIC_EXIT_TO_HANGAR) {
    return {
      success: true,
      shouldConsume: false,
      startedSpaceBounce: false,
    };
  }

  if (!isLiveSession(session)) {
    return {
      success: false,
      shouldConsume: false,
      startedSpaceBounce: false,
      errorMsg: "SESSION_NOT_READY",
    };
  }

  const dockLocationID = Number(
    options.dockLocationID || resolveReturnDockLocationID(session),
  ) || 0;
  if (dockLocationID <= 0) {
    return {
      success: false,
      shouldConsume: false,
      startedSpaceBounce: false,
      errorMsg: "DOCK_LOCATION_NOT_FOUND",
    };
  }

  // Retail-style intro playback does not require the server to bounce the
  // character through space. The client intro controller keeps the movie
  // running while the game loads and marks hangar/station as "game loaded",
  // then reveals the docked UI when the movie ends or is skipped.
  return {
    success: true,
    shouldConsume: true,
    startedSpaceBounce: false,
    dockLocationID,
    presentation: "client_intro_overlay",
  };
}

function setTestingHooks(hooks) {
  void hooks;
}

module.exports = {
  runTutorialFirstLoginHandoff,
  _testing: {
    setTestingHooks,
  },
};
