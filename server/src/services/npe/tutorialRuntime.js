const path = require("path");

const config = require(path.join(__dirname, "../../config"));

const AIR_NPE_STATE = Object.freeze({
  ACTIVE: 1,
  COMPLETED: 2,
  SKIPPED: 3,
});

const NES_INTRO_STATE = Object.freeze({
  UNSET: 0,
  ACTIVE: 1,
  COMPLETED: 2,
  SKIPPED: 3,
});

const TUTORIAL_CATEGORY_STATE = Object.freeze({
  LOCKED: 20,
  ACTIVE: 21,
  COMPLETE: 22,
  SKIPPED_BY_PLAYER: 23,
});

const TUTORIAL_ENTRY_MODE = Object.freeze({
  DISABLED: "disabled",
  TUTORIAL: "tutorial",
  CINEMATIC_INTRO_OVERLAY: "cinematic_intro_overlay",
});

const LEGACY_TUTORIAL_ENTRY_MODE = Object.freeze({
  CINEMATIC_ENTRY_TO_SPACE: "cinematic_entry_to_space",
  CINEMATIC_EXIT_TO_HANGAR: "cinematic_exit_to_hangar",
});

const TUTORIAL_FIRST_LOGIN_HANDOFF = Object.freeze({
  NONE: "none",
  CINEMATIC_EXIT_TO_HANGAR: "cinematic_exit_to_hangar",
});

function getCharacterStateModule() {
  return require(path.join(__dirname, "../character/characterState"));
}

function getCharacterRecord(charId) {
  const characterState = getCharacterStateModule();
  return characterState &&
    typeof characterState.getCharacterRecord === "function"
    ? characterState.getCharacterRecord(charId)
    : null;
}

function updateCharacterRecord(charId, mutator) {
  const characterState = getCharacterStateModule();
  return characterState &&
    typeof characterState.updateCharacterRecord === "function"
    ? characterState.updateCharacterRecord(charId, mutator)
    : {
        success: false,
        errorMsg: "CHARACTER_STATE_UNAVAILABLE",
      };
}

function getRuntimeConfig() {
  return config || {};
}

function isNewCharacterTutorialEnabled(runtimeConfig = getRuntimeConfig()) {
  return runtimeConfig.newCharacterTutorialEnabled === true;
}

function isNewCharacterIntroCinematicEnabled(
  runtimeConfig = getRuntimeConfig(),
) {
  return runtimeConfig.newCharacterIntroCinematicEnabled === true;
}

function normalizeAirNpeState(value, fallback = AIR_NPE_STATE.COMPLETED) {
  const numeric = Number(value);
  return numeric === AIR_NPE_STATE.ACTIVE ||
    numeric === AIR_NPE_STATE.COMPLETED ||
    numeric === AIR_NPE_STATE.SKIPPED
    ? numeric
    : fallback;
}

function normalizeNesIntroState(value, fallback = NES_INTRO_STATE.UNSET) {
  const numeric = Number(value);
  return numeric === NES_INTRO_STATE.UNSET ||
    numeric === NES_INTRO_STATE.ACTIVE ||
    numeric === NES_INTRO_STATE.COMPLETED ||
    numeric === NES_INTRO_STATE.SKIPPED
    ? numeric
    : fallback;
}

function normalizeTutorialEntryMode(
  value,
  fallback = TUTORIAL_ENTRY_MODE.DISABLED,
) {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    normalized === LEGACY_TUTORIAL_ENTRY_MODE.CINEMATIC_ENTRY_TO_SPACE ||
    normalized === LEGACY_TUTORIAL_ENTRY_MODE.CINEMATIC_EXIT_TO_HANGAR
  ) {
    return TUTORIAL_ENTRY_MODE.CINEMATIC_INTRO_OVERLAY;
  }
  return normalized === TUTORIAL_ENTRY_MODE.TUTORIAL ||
    normalized === TUTORIAL_ENTRY_MODE.CINEMATIC_INTRO_OVERLAY ||
    normalized === TUTORIAL_ENTRY_MODE.DISABLED
    ? normalized
    : fallback;
}

function normalizeTutorialFirstLoginHandoff(
  value,
  fallback = TUTORIAL_FIRST_LOGIN_HANDOFF.NONE,
) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === TUTORIAL_FIRST_LOGIN_HANDOFF.CINEMATIC_EXIT_TO_HANGAR) {
    return normalized;
  }
  if (normalized === TUTORIAL_FIRST_LOGIN_HANDOFF.NONE) {
    return TUTORIAL_FIRST_LOGIN_HANDOFF.NONE;
  }
  return fallback;
}

function resolveNewCharacterTutorialEntryMode(
  runtimeConfig = getRuntimeConfig(),
) {
  if (isNewCharacterIntroCinematicEnabled(runtimeConfig)) {
    return TUTORIAL_ENTRY_MODE.CINEMATIC_INTRO_OVERLAY;
  }
  if (isNewCharacterTutorialEnabled(runtimeConfig)) {
    return TUTORIAL_ENTRY_MODE.TUTORIAL;
  }
  return TUTORIAL_ENTRY_MODE.DISABLED;
}

function isAirNpeEnabled(runtimeConfig = getRuntimeConfig()) {
  return isNewCharacterTutorialEnabled(runtimeConfig) ||
    isNewCharacterIntroCinematicEnabled(runtimeConfig);
}

function buildNewCharacterTutorialState(runtimeConfig = getRuntimeConfig()) {
  const entryMode = resolveNewCharacterTutorialEntryMode(runtimeConfig);
  if (entryMode === TUTORIAL_ENTRY_MODE.TUTORIAL) {
    return {
      tutorialEntryMode: entryMode,
      tutorialFirstLoginHandoff: TUTORIAL_FIRST_LOGIN_HANDOFF.NONE,
      airNpeState: AIR_NPE_STATE.ACTIVE,
      airNpeRevealOnFirstLogin: false,
      nesIntroState: NES_INTRO_STATE.UNSET,
    };
  }
  if (entryMode === TUTORIAL_ENTRY_MODE.CINEMATIC_INTRO_OVERLAY) {
    return {
      tutorialEntryMode: entryMode,
      tutorialFirstLoginHandoff: TUTORIAL_FIRST_LOGIN_HANDOFF.NONE,
      airNpeState: AIR_NPE_STATE.COMPLETED,
      // The intro movie controller already owns when the hidden game load is
      // revealed. Sending a completed AIR reveal here leaks the station view
      // under the movie and makes the intro appear to restart.
      airNpeRevealOnFirstLogin: false,
      nesIntroState: NES_INTRO_STATE.UNSET,
    };
  }
  return {
    tutorialEntryMode: entryMode,
    tutorialFirstLoginHandoff: TUTORIAL_FIRST_LOGIN_HANDOFF.NONE,
    airNpeState: AIR_NPE_STATE.COMPLETED,
    airNpeRevealOnFirstLogin: false,
    nesIntroState: NES_INTRO_STATE.UNSET,
  };
}

function inferLegacyTutorialEntryMode(record) {
  if (!record || typeof record !== "object") {
    return TUTORIAL_ENTRY_MODE.DISABLED;
  }
  if (Boolean(record.airNpeRevealOnFirstLogin)) {
    return TUTORIAL_ENTRY_MODE.CINEMATIC_INTRO_OVERLAY;
  }
  if (normalizeAirNpeState(record.airNpeState, AIR_NPE_STATE.COMPLETED) === AIR_NPE_STATE.ACTIVE) {
    return TUTORIAL_ENTRY_MODE.TUTORIAL;
  }
  return TUTORIAL_ENTRY_MODE.DISABLED;
}

function inferLegacyFirstLoginHandoff(record) {
  if (!record || typeof record !== "object") {
    return TUTORIAL_FIRST_LOGIN_HANDOFF.NONE;
  }
  return Boolean(record.airNpeRevealOnFirstLogin)
    ? TUTORIAL_FIRST_LOGIN_HANDOFF.CINEMATIC_EXIT_TO_HANGAR
    : TUTORIAL_FIRST_LOGIN_HANDOFF.NONE;
}

function buildTutorialSnapshot(record, runtimeConfig = getRuntimeConfig()) {
  const entryMode = normalizeTutorialEntryMode(
    record && record.tutorialEntryMode,
    inferLegacyTutorialEntryMode(record),
  );
  const enabled = entryMode === TUTORIAL_ENTRY_MODE.TUTORIAL &&
    isNewCharacterTutorialEnabled(runtimeConfig);
  const isCinematicEntry = entryMode ===
      TUTORIAL_ENTRY_MODE.CINEMATIC_INTRO_OVERLAY &&
    isNewCharacterIntroCinematicEnabled(runtimeConfig);
  const storedAirNpeState = normalizeAirNpeState(
    record && record.airNpeState,
    AIR_NPE_STATE.COMPLETED,
  );
  const effectiveAirNpeState = enabled
    ? storedAirNpeState
    : AIR_NPE_STATE.COMPLETED;
  const storedNesIntroState = normalizeNesIntroState(
    record && record.nesIntroState,
    NES_INTRO_STATE.UNSET,
  );
  const effectiveNesIntroState = enabled
    ? storedNesIntroState
    : NES_INTRO_STATE.UNSET;
  const firstLoginHandoff = enabled
    ? normalizeTutorialFirstLoginHandoff(
      record && record.tutorialFirstLoginHandoff,
      inferLegacyFirstLoginHandoff(record),
    )
    : TUTORIAL_FIRST_LOGIN_HANDOFF.NONE;
  const revealCompletedStateOnFirstLogin = (enabled || isCinematicEntry) &&
    Boolean(record && record.airNpeRevealOnFirstLogin) &&
    effectiveAirNpeState === AIR_NPE_STATE.COMPLETED;
  const hasSkippedTutorial = effectiveAirNpeState === AIR_NPE_STATE.SKIPPED;
  const canPlayTutorial = enabled &&
    effectiveAirNpeState === AIR_NPE_STATE.ACTIVE;

  return {
    exists: Boolean(record),
    enabled,
    airNpeEnabled: enabled || isCinematicEntry,
    entryMode,
    storedAirNpeState,
    airNpeState: effectiveAirNpeState,
    storedNesIntroState,
    nesIntroState: effectiveNesIntroState,
    firstLoginHandoff,
    revealCompletedStateOnFirstLogin,
    hasSkippedTutorial,
    canPlayTutorial,
    isMainTutorialFinished: !canPlayTutorial,
    tutorialState: canPlayTutorial
      ? TUTORIAL_CATEGORY_STATE.ACTIVE
      : hasSkippedTutorial
        ? TUTORIAL_CATEGORY_STATE.SKIPPED_BY_PLAYER
        : TUTORIAL_CATEGORY_STATE.COMPLETE,
  };
}

function getCharacterTutorialSnapshot(
  charId,
  runtimeConfig = getRuntimeConfig(),
) {
  const numericCharId = Number(charId) || 0;
  const record = numericCharId > 0 ? getCharacterRecord(numericCharId) : null;
  return buildTutorialSnapshot(record, runtimeConfig);
}

function buildMissingCharacterResult(runtimeConfig = getRuntimeConfig()) {
  return {
    success: false,
    changed: false,
    errorMsg: "CHARACTER_NOT_FOUND",
    snapshot: buildTutorialSnapshot(null, runtimeConfig),
  };
}

function markCharacterTutorialSkipped(
  charId,
  runtimeConfig = getRuntimeConfig(),
) {
  const numericCharId = Number(charId) || 0;
  if (numericCharId <= 0) {
    return buildMissingCharacterResult(runtimeConfig);
  }

  const currentSnapshot = getCharacterTutorialSnapshot(
    numericCharId,
    runtimeConfig,
  );
  if (!currentSnapshot.exists) {
    return buildMissingCharacterResult(runtimeConfig);
  }

  const canForceSkipCompletedCinematicEntry =
    currentSnapshot.entryMode === TUTORIAL_ENTRY_MODE.CINEMATIC_INTRO_OVERLAY &&
    currentSnapshot.firstLoginHandoff !== TUTORIAL_FIRST_LOGIN_HANDOFF.NONE &&
    currentSnapshot.airNpeState === AIR_NPE_STATE.COMPLETED;

  if (
    currentSnapshot.airNpeState !== AIR_NPE_STATE.ACTIVE &&
    !canForceSkipCompletedCinematicEntry
  ) {
    return {
      success: true,
      changed: false,
      snapshot: currentSnapshot,
    };
  }

  const updateResult = updateCharacterRecord(numericCharId, (record) => ({
    ...record,
    airNpeState: AIR_NPE_STATE.SKIPPED,
    tutorialFirstLoginHandoff: TUTORIAL_FIRST_LOGIN_HANDOFF.NONE,
    airNpeRevealOnFirstLogin: false,
  }));
  const nextSnapshot = getCharacterTutorialSnapshot(numericCharId, runtimeConfig);

  return {
    success: updateResult.success !== false,
    changed: updateResult.success !== false,
    errorMsg: updateResult && updateResult.errorMsg,
    snapshot: nextSnapshot,
  };
}

function consumeTutorialFirstLoginHandoff(
  charId,
  runtimeConfig = getRuntimeConfig(),
) {
  const numericCharId = Number(charId) || 0;
  if (numericCharId <= 0) {
    return {
      ...buildMissingCharacterResult(runtimeConfig),
      consumedHandoffMode: TUTORIAL_FIRST_LOGIN_HANDOFF.NONE,
    };
  }

  const currentSnapshot = getCharacterTutorialSnapshot(
    numericCharId,
    runtimeConfig,
  );
  if (!currentSnapshot.exists) {
    return {
      ...buildMissingCharacterResult(runtimeConfig),
      consumedHandoffMode: TUTORIAL_FIRST_LOGIN_HANDOFF.NONE,
    };
  }

  const consumedHandoffMode = currentSnapshot.firstLoginHandoff;
  if (consumedHandoffMode === TUTORIAL_FIRST_LOGIN_HANDOFF.NONE) {
    return {
      success: true,
      changed: false,
      consumedHandoffMode,
      snapshot: currentSnapshot,
    };
  }

  const updateResult = updateCharacterRecord(numericCharId, (record) => ({
    ...record,
    tutorialFirstLoginHandoff: TUTORIAL_FIRST_LOGIN_HANDOFF.NONE,
  }));
  const nextSnapshot = getCharacterTutorialSnapshot(numericCharId, runtimeConfig);

  return {
    success: updateResult.success !== false,
    changed: updateResult.success !== false,
    errorMsg: updateResult && updateResult.errorMsg,
    consumedHandoffMode,
    snapshot: nextSnapshot,
  };
}

function consumeCompletedAirNpeRevealOnFirstLogin(
  charId,
  runtimeConfig = getRuntimeConfig(),
) {
  const numericCharId = Number(charId) || 0;
  if (numericCharId <= 0) {
    return buildMissingCharacterResult(runtimeConfig);
  }

  const currentSnapshot = getCharacterTutorialSnapshot(
    numericCharId,
    runtimeConfig,
  );
  if (!currentSnapshot.exists) {
    return buildMissingCharacterResult(runtimeConfig);
  }

  if (!currentSnapshot.revealCompletedStateOnFirstLogin) {
    return {
      success: true,
      changed: false,
      snapshot: currentSnapshot,
    };
  }

  const updateResult = updateCharacterRecord(numericCharId, (record) => ({
    ...record,
    airNpeRevealOnFirstLogin: false,
  }));
  const nextSnapshot = getCharacterTutorialSnapshot(numericCharId, runtimeConfig);

  return {
    success: updateResult.success !== false,
    changed: updateResult.success !== false,
    errorMsg: updateResult && updateResult.errorMsg,
    snapshot: nextSnapshot,
  };
}

function markCharacterNesIntroSkipped(
  charId,
  runtimeConfig = getRuntimeConfig(),
) {
  const numericCharId = Number(charId) || 0;
  if (numericCharId <= 0) {
    return buildMissingCharacterResult(runtimeConfig);
  }

  const currentSnapshot = getCharacterTutorialSnapshot(
    numericCharId,
    runtimeConfig,
  );
  if (!currentSnapshot.exists) {
    return buildMissingCharacterResult(runtimeConfig);
  }

  if (currentSnapshot.nesIntroState !== NES_INTRO_STATE.ACTIVE) {
    return {
      success: true,
      changed: false,
      snapshot: currentSnapshot,
    };
  }

  const updateResult = updateCharacterRecord(numericCharId, (record) => ({
    ...record,
    nesIntroState: NES_INTRO_STATE.SKIPPED,
  }));
  const nextSnapshot = getCharacterTutorialSnapshot(numericCharId, runtimeConfig);

  return {
    success: updateResult.success !== false,
    changed: updateResult.success !== false,
    errorMsg: updateResult && updateResult.errorMsg,
    snapshot: nextSnapshot,
  };
}

module.exports = {
  AIR_NPE_STATE,
  LEGACY_TUTORIAL_ENTRY_MODE,
  NES_INTRO_STATE,
  TUTORIAL_CATEGORY_STATE,
  TUTORIAL_ENTRY_MODE,
  TUTORIAL_FIRST_LOGIN_HANDOFF,
  buildNewCharacterTutorialState,
  buildTutorialSnapshot,
  consumeCompletedAirNpeRevealOnFirstLogin,
  consumeTutorialFirstLoginHandoff,
  getCharacterTutorialSnapshot,
  isAirNpeEnabled,
  isNewCharacterIntroCinematicEnabled,
  isNewCharacterTutorialEnabled,
  markCharacterNesIntroSkipped,
  markCharacterTutorialSkipped,
  normalizeAirNpeState,
  normalizeNesIntroState,
  normalizeTutorialEntryMode,
  normalizeTutorialFirstLoginHandoff,
  resolveNewCharacterTutorialEntryMode,
};
