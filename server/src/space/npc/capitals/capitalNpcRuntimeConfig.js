const CAPITAL_CLASS_RUNTIME_CONFIG = Object.freeze({
  dreadnought: Object.freeze({
    preferredRangeFactor: 0.62,
    minimumPreferredRangeMeters: 12_000,
    maximumPreferredRangeMeters: 95_000,
    settleToleranceRatio: 0.18,
    settleToleranceMinMeters: 5_000,
    settledMovementMode: "hold",
    retargetStickMs: 7_000,
    retargetScoreMargin: 120,
    repositionThinkIntervalMs: 250,
    requireSettleBeforeWeapons: true,
    weaponRetargetDelayMs: 1_000,
    fighterLaunchPerThink: 0,
    fighterLaunchIntervalMs: 0,
    fighterAbilitySyncIntervalMs: 0,
    superweaponRetryMs: 2_000,
    superweaponSuccessfulRearmMs: 20_000,
  }),
  titan: Object.freeze({
    preferredRangeFactor: 0.72,
    minimumPreferredRangeMeters: 45_000,
    maximumPreferredRangeMeters: 160_000,
    settleToleranceRatio: 0.16,
    settleToleranceMinMeters: 8_000,
    settledMovementMode: "hold",
    retargetStickMs: 9_000,
    retargetScoreMargin: 140,
    repositionThinkIntervalMs: 300,
    requireSettleBeforeWeapons: true,
    weaponRetargetDelayMs: 1_500,
    fighterLaunchPerThink: 0,
    fighterLaunchIntervalMs: 0,
    fighterAbilitySyncIntervalMs: 0,
    superweaponRetryMs: 3_000,
    superweaponSuccessfulRearmMs: 30_000,
  }),
  supercarrier: Object.freeze({
    preferredRangeFactor: 1,
    minimumPreferredRangeMeters: 42_000,
    maximumPreferredRangeMeters: 85_000,
    settleToleranceRatio: 0.2,
    settleToleranceMinMeters: 7_000,
    settledMovementMode: "hold",
    retargetStickMs: 3_500,
    retargetScoreMargin: 80,
    repositionThinkIntervalMs: 350,
    requireSettleBeforeWeapons: false,
    weaponRetargetDelayMs: 0,
    fighterLaunchPerThink: 1,
    fighterLaunchIntervalMs: 1_500,
    fighterAbilitySyncIntervalMs: 1_000,
    superweaponRetryMs: 2_000,
    superweaponSuccessfulRearmMs: 20_000,
  }),
});

function getCapitalRuntimeConfig(classID = "") {
  return CAPITAL_CLASS_RUNTIME_CONFIG[String(classID || "").trim().toLowerCase()] ||
    CAPITAL_CLASS_RUNTIME_CONFIG.dreadnought;
}

module.exports = {
  CAPITAL_CLASS_RUNTIME_CONFIG,
  getCapitalRuntimeConfig,
};
