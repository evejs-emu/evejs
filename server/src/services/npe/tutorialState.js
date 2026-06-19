const runtime = require("./tutorialRuntime");

function getInitialAirNpeStateForNewCharacter(runtimeConfig) {
  return runtime.buildNewCharacterTutorialState(runtimeConfig).airNpeState;
}

function shouldRevealCompletedAirNpeOnFirstLogin(runtimeConfig) {
  return runtime.buildNewCharacterTutorialState(runtimeConfig)
    .airNpeRevealOnFirstLogin;
}

module.exports = {
  ...runtime,
  getInitialAirNpeStateForNewCharacter,
  isNewCharacterAirNpeEntryEnabled: runtime.isAirNpeEnabled,
  shouldRevealCompletedAirNpeOnFirstLogin,
};
