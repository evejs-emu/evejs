const path = require("path");

const { buildFiletimeLong, buildKeyVal, buildMarshalReal } = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));
const structureState = require(path.join(__dirname, "./structureState"));
const {
  STRUCTURE_STATE,
  STRUCTURE_STATE_NAME_BY_ID,
  STRUCTURE_UPKEEP_STATE,
  STRUCTURE_UPKEEP_NAME_BY_ID,
} = require(path.join(__dirname, "./structureConstants"));

const STRUCTURE_DAMAGE_STATE_BY_OPERATING_STATE = Object.freeze({
  [STRUCTURE_STATE.UNKNOWN]: [1, 1, 1],
  [STRUCTURE_STATE.UNANCHORED]: [1, 1, 1],
  [STRUCTURE_STATE.ANCHORING]: [0, 0, 1],
  [STRUCTURE_STATE.ONLINE_DEPRECATED]: [1, 1, 1],
  [STRUCTURE_STATE.FITTING_INVULNERABLE]: [0, 0, 1],
  [STRUCTURE_STATE.ONLINING_VULNERABLE]: [0, 0, 1],
  [STRUCTURE_STATE.SHIELD_VULNERABLE]: [1, 1, 1],
  [STRUCTURE_STATE.ARMOR_REINFORCE]: [0, 1, 1],
  [STRUCTURE_STATE.ARMOR_VULNERABLE]: [0, 1, 1],
  [STRUCTURE_STATE.HULL_REINFORCE]: [0, 0, 1],
  [STRUCTURE_STATE.HULL_VULNERABLE]: [0, 0, 1],
  [STRUCTURE_STATE.ANCHOR_VULNERABLE]: [0, 0, 1],
  [STRUCTURE_STATE.DEPLOY_VULNERABLE]: [0, 0, 1],
  [STRUCTURE_STATE.FOB_INVULNERABLE]: [1, 1, 1],
});

function clamp01(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return Math.max(0, Math.min(1, Number(fallback) || 0));
  }
  return Math.max(0, Math.min(1, numericValue));
}

function normalizeOperatingState(value) {
  const numericValue = Number(value);
  return STRUCTURE_STATE_NAME_BY_ID[numericValue]
    ? numericValue
    : STRUCTURE_STATE.UNKNOWN;
}

function normalizeUpkeepState(value) {
  const numericValue = Number(value);
  return STRUCTURE_UPKEEP_NAME_BY_ID[numericValue]
    ? numericValue
    : STRUCTURE_UPKEEP_STATE.FULL_POWER;
}

function buildStructureHangarDamageState(structure = null) {
  const operatingState = normalizeOperatingState(structure && structure.state);
  const defaultDamageState =
    STRUCTURE_DAMAGE_STATE_BY_OPERATING_STATE[operatingState] || [1, 1, 1];
  const conditionState =
    structure && structure.conditionState && typeof structure.conditionState === "object"
      ? structure.conditionState
      : {};

  return [
    clamp01(conditionState.shieldCharge, defaultDamageState[0]),
    clamp01(
      conditionState.armorDamage === undefined
        ? defaultDamageState[1]
        : 1 - Number(conditionState.armorDamage),
      defaultDamageState[1],
    ),
    clamp01(
      conditionState.damage === undefined
        ? defaultDamageState[2]
        : 1 - Number(conditionState.damage),
      defaultDamageState[2],
    ),
  ];
}

function buildStructureHangarTimer(structure = null) {
  const startAtMs = Number(structure && structure.stateStartedAt);
  const endAtMs = Number(structure && structure.stateEndsAt);
  const pauseAtMs = Number(structure && structure.timerPausedAt);

  if (!Number.isFinite(startAtMs) || startAtMs <= 0) {
    return null;
  }
  if (!Number.isFinite(endAtMs) || endAtMs <= 0) {
    return null;
  }

  return [
    buildFiletimeLong(structureState.toFileTimeLongFromMs(startAtMs)),
    buildFiletimeLong(structureState.toFileTimeLongFromMs(endAtMs)),
    Number.isFinite(pauseAtMs) && pauseAtMs > 0
      ? buildFiletimeLong(structureState.toFileTimeLongFromMs(pauseAtMs))
      : null,
  ];
}

function buildStructureHangarTimerState(structure = null) {
  const timer = buildStructureHangarTimer(structure);
  if (!timer) {
    return {
      timerStartAt: null,
      timerEndAt: null,
      timerPauseAt: null,
      timerIsProgressing: false,
      timerIsPaused: false,
      timerProgress: null,
    };
  }

  const startAtMs = Number(structure && structure.stateStartedAt);
  const endAtMs = Number(structure && structure.stateEndsAt);
  const pauseAtMs = Number(structure && structure.timerPausedAt);
  const currentAtMs =
    Number.isFinite(pauseAtMs) && pauseAtMs > 0 ? pauseAtMs : Date.now();

  let timerProgress = null;
  if (
    Number.isFinite(startAtMs) &&
    Number.isFinite(endAtMs) &&
    endAtMs > startAtMs
  ) {
    const rawProgress = (currentAtMs - startAtMs) / (endAtMs - startAtMs);
    timerProgress = buildMarshalReal(Math.max(0, Math.min(1, rawProgress)));
  }

  return {
    timerStartAt: timer[0],
    timerEndAt: timer[1],
    timerPauseAt: timer[2],
    timerIsProgressing: timer[0] !== null && timer[2] === null,
    timerIsPaused: timer[0] !== null && timer[2] !== null,
    timerProgress,
  };
}

function buildStructureHangarViewState(structure = null) {
  if (!structure) {
    return null;
  }

  const timerState = buildStructureHangarTimerState(structure);

  return buildKeyVal([
    ["operatingState", normalizeOperatingState(structure.state)],
    ["upkeepState", normalizeUpkeepState(structure.upkeepState)],
    ["damageState", buildStructureHangarDamageState(structure)],
    ["timerStartAt", timerState.timerStartAt],
    ["timerEndAt", timerState.timerEndAt],
    ["timerPauseAt", timerState.timerPauseAt],
    ["timerIsProgressing", timerState.timerIsProgressing],
    ["timerIsPaused", timerState.timerIsPaused],
    ["timerProgress", timerState.timerProgress],
  ]);
}

module.exports = {
  buildStructureHangarDamageState,
  buildStructureHangarTimer,
  buildStructureHangarTimerState,
  buildStructureHangarViewState,
};
