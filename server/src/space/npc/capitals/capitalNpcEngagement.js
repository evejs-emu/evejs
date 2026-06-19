const {
  getCapitalRuntimeConfig,
} = require("./capitalNpcRuntimeConfig");
const {
  resolveCapitalDoctrine,
} = require("./capitalNpcDoctrine");
const {
  getCapitalControllerState,
} = require("./capitalNpcState");

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function resolveRangeBand(distanceMeters, doctrine) {
  if (!doctrine) {
    return "unknown";
  }
  const preferredRangeMeters = Math.max(
    0,
    toFiniteNumber(doctrine.preferredCombatRangeMeters, 0),
  );
  const settleToleranceMeters = Math.max(
    0,
    toFiniteNumber(doctrine.settleToleranceMeters, 0),
  );
  if (preferredRangeMeters <= 0) {
    return "unknown";
  }
  if (distanceMeters > preferredRangeMeters + settleToleranceMeters) {
    return "tooFar";
  }
  if (distanceMeters < Math.max(0, preferredRangeMeters - settleToleranceMeters)) {
    return "inside";
  }
  return "settled";
}

function resolveCapitalEngagementPolicy(entity, controller, behaviorProfile, target, options = {}) {
  if (!entity || entity.capitalNpc !== true || !target) {
    return {
      allowWeapons: true,
      nextThinkOverrideMs: null,
      doctrine: null,
      rangeBand: "unknown",
      settled: false,
    };
  }

  const doctrine = options.doctrine || resolveCapitalDoctrine(entity, behaviorProfile);
  const classID = String(
    doctrine && doctrine.classID ||
    entity && entity.capitalClassID ||
    "",
  ).trim().toLowerCase();
  const runtimeConfig = getCapitalRuntimeConfig(classID);
  const capitalState = getCapitalControllerState(controller);
  const nowMs = toFiniteNumber(options.nowMs, Date.now());
  const distanceMeters = Math.max(
    0,
    toFiniteNumber(
      options.getSurfaceDistance
        ? options.getSurfaceDistance(entity, target)
        : 0,
      0,
    ),
  );
  const rangeBand = resolveRangeBand(distanceMeters, doctrine);
  const targetID = toPositiveInt(target && target.itemID, 0);

  if (capitalState) {
    capitalState.lastMeasuredDistanceMeters = distanceMeters;
    capitalState.lastRangeBand = rangeBand;
    capitalState.lastPreferredRangeMeters = Math.max(
      0,
      toFiniteNumber(doctrine && doctrine.preferredCombatRangeMeters, 0),
    );
    if (toPositiveInt(capitalState.lastWeaponTargetID, 0) !== targetID) {
      capitalState.lastWeaponTargetID = targetID;
      capitalState.lastWeaponAuthorizeAtMs =
        nowMs + Math.max(0, toPositiveInt(runtimeConfig.weaponRetargetDelayMs, 0));
    }
    if (rangeBand === "settled") {
      if (toFiniteNumber(capitalState.settledAtMs, 0) <= 0) {
        capitalState.settledAtMs = nowMs;
      }
    } else {
      capitalState.settledAtMs = 0;
    }
  }

  let allowWeapons = true;
  let nextThinkOverrideMs = null;
  if (runtimeConfig.requireSettleBeforeWeapons === true && rangeBand !== "settled") {
    allowWeapons = false;
    nextThinkOverrideMs =
      nowMs + Math.max(50, toPositiveInt(runtimeConfig.repositionThinkIntervalMs, 250));
  }
  if (
    allowWeapons &&
    capitalState &&
    nowMs < toFiniteNumber(capitalState.lastWeaponAuthorizeAtMs, 0)
  ) {
    allowWeapons = false;
    nextThinkOverrideMs = toFiniteNumber(capitalState.lastWeaponAuthorizeAtMs, null);
  }

  return {
    allowWeapons,
    nextThinkOverrideMs,
    doctrine,
    rangeBand,
    settled: rangeBand === "settled",
  };
}

module.exports = {
  resolveCapitalEngagementPolicy,
  __testing: {
    resolveRangeBand,
  },
};
