function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function cloneVector(value, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: toFiniteNumber(value && value.x, fallback.x),
    y: toFiniteNumber(value && value.y, fallback.y),
    z: toFiniteNumber(value && value.z, fallback.z),
  };
}

function getCapitalControllerState(controller) {
  if (!controller || typeof controller !== "object") {
    return null;
  }
  if (!controller.capitalNpcState || typeof controller.capitalNpcState !== "object") {
    controller.capitalNpcState = {
      launchedTubeFlagIDs: [],
      nextFighterLaunchAtMs: 0,
      nextFighterAbilitySyncAtMs: 0,
      nextSuperweaponAttemptAtMs: 0,
      lastTargetID: 0,
      lastTargetSwapAtMs: 0,
      lastWeaponTargetID: 0,
      lastWeaponAuthorizeAtMs: 0,
      settledAtMs: 0,
      lastMeasuredDistanceMeters: 0,
      lastPreferredRangeMeters: 0,
      lastRangeBand: "unknown",
      lastMovementMode: "",
      lastMovementTargetID: 0,
      lastMovementRangeMeters: 0,
      lastMovementCommandAtMs: 0,
      lastMovementDirection: null,
    };
  }
  if (!Array.isArray(controller.capitalNpcState.launchedTubeFlagIDs)) {
    controller.capitalNpcState.launchedTubeFlagIDs = [];
  }
  return controller.capitalNpcState;
}

function listControlledNpcFighters(scene, controllerID) {
  const numericControllerID = toPositiveInt(controllerID, 0);
  if (!scene || numericControllerID <= 0) {
    return [];
  }
  return [...scene.dynamicEntities.values()].filter((entity) => (
    entity &&
    entity.kind === "fighter" &&
    toPositiveInt(entity.controllerID, 0) === numericControllerID
  ));
}

module.exports = {
  toFiniteNumber,
  toPositiveInt,
  cloneVector,
  getCapitalControllerState,
  listControlledNpcFighters,
};
