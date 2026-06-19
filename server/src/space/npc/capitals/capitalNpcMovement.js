const {
  getCapitalRuntimeConfig,
} = require("./capitalNpcRuntimeConfig");
const {
  getCapitalControllerState,
  toFiniteNumber,
  toPositiveInt,
} = require("./capitalNpcState");

const CAPITAL_MOVEMENT_OPTIONS = Object.freeze({
  queueHistorySafeContract: true,
  suppressFreshAcquireReplay: true,
});

function buildNpcPseudoSession(entity) {
  const pilotCharacterID = toPositiveInt(
    entity && (
      entity.pilotCharacterID ??
      entity.characterID
    ),
    0,
  );
  return {
    characterID: pilotCharacterID,
    corporationID: toPositiveInt(entity && entity.corporationID, 0),
    allianceID: toPositiveInt(entity && entity.allianceID, 0),
    _space: {
      systemID: toPositiveInt(entity && entity.systemID, 0),
      shipID: toPositiveInt(entity && entity.itemID, 0),
    },
  };
}

function distance(left, right) {
  const dx = toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0);
  const dy = toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0);
  const dz = toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0);
  return Math.sqrt((dx ** 2) + (dy ** 2) + (dz ** 2));
}

function getSurfaceDistance(left, right) {
  return Math.max(
    0,
    distance(left && left.position, right && right.position) -
      toFiniteNumber(left && left.radius, 0) -
      toFiniteNumber(right && right.radius, 0),
  );
}

function subtractVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0),
  };
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const resolved = {
    x: toFiniteNumber(vector && vector.x, fallback.x),
    y: toFiniteNumber(vector && vector.y, fallback.y),
    z: toFiniteNumber(vector && vector.z, fallback.z),
  };
  const length = Math.sqrt(
    (resolved.x ** 2) + (resolved.y ** 2) + (resolved.z ** 2),
  );
  if (!Number.isFinite(length) || length <= 0) {
    return { ...fallback };
  }
  return {
    x: resolved.x / length,
    y: resolved.y / length,
    z: resolved.z / length,
  };
}

function isDirectionChangeSignificant(left, right) {
  if (!left || !right) {
    return true;
  }

  const leftLength = Math.sqrt((left.x ** 2) + (left.y ** 2) + (left.z ** 2));
  const rightLength = Math.sqrt((right.x ** 2) + (right.y ** 2) + (right.z ** 2));
  if (leftLength <= 0 || rightLength <= 0) {
    return true;
  }

  const dot = (
    ((left.x * right.x) + (left.y * right.y) + (left.z * right.z)) /
    (leftLength * rightLength)
  );
  return dot < 0.995;
}

function rememberMovementState(capitalState, options = {}) {
  if (!capitalState) {
    return;
  }
  capitalState.lastMovementMode = String(options.mode || "").trim().toLowerCase();
  capitalState.lastMovementTargetID = toPositiveInt(options.targetID, 0);
  capitalState.lastMovementRangeMeters = Math.max(0, toFiniteNumber(options.rangeMeters, 0));
  capitalState.lastMovementCommandAtMs = Math.max(0, toFiniteNumber(options.issuedAtMs, 0));
  capitalState.lastMovementDirection = options.direction
    ? normalizeVector(options.direction, { x: 1, y: 0, z: 0 })
    : null;
}

function stopCapitalNpc(scene, entity, controller, nowMs, mode = "hold") {
  if (!scene || !entity) {
    return false;
  }
  if (entity.mode !== "STOP" || toFiniteNumber(entity.speedFraction, 0) > 0) {
    scene.stop(buildNpcPseudoSession(entity));
  }
  rememberMovementState(getCapitalControllerState(controller), {
    mode,
    issuedAtMs: nowMs,
  });
  return true;
}

function hasMatchingFollowCommand(entity, targetID, desiredRangeMeters) {
  return (
    entity &&
    entity.mode === "FOLLOW" &&
    toPositiveInt(entity.targetEntityID, 0) === toPositiveInt(targetID, 0) &&
    Math.abs(toFiniteNumber(entity.followRange, 0) - desiredRangeMeters) <= 1
  );
}

function shouldRefreshDirectionalCommand(entity, capitalState, mode, direction, nowMs, refreshIntervalMs) {
  if (!entity || !capitalState) {
    return true;
  }
  if (entity.mode !== "GOTO") {
    return true;
  }
  if (String(capitalState.lastMovementMode || "").trim().toLowerCase() !== String(mode || "").trim().toLowerCase()) {
    return true;
  }
  if (nowMs >= toFiniteNumber(capitalState.lastMovementCommandAtMs, 0) + refreshIntervalMs) {
    return true;
  }
  return isDirectionChangeSignificant(capitalState.lastMovementDirection, direction);
}

function syncCapitalNpcMovement(scene, entity, controller, target, movementDirective, options = {}) {
  if (!scene || !entity || entity.capitalNpc !== true || !target) {
    return false;
  }

  const movementMode = String(movementDirective && movementDirective.movementMode || "").trim().toLowerCase();
  const doctrine = movementDirective && movementDirective.capitalDoctrine
    ? movementDirective.capitalDoctrine
    : null;
  const nowMs = toFiniteNumber(options.nowMs, Date.now());

  if (movementMode === "hold" || movementMode === "stop") {
    return stopCapitalNpc(scene, entity, controller, nowMs, movementMode || "hold");
  }
  if (!doctrine) {
    return false;
  }

  const capitalState = getCapitalControllerState(controller);
  const runtimeConfig = getCapitalRuntimeConfig(doctrine.classID);
  const refreshIntervalMs = Math.max(
    50,
    toPositiveInt(runtimeConfig.repositionThinkIntervalMs, 250),
  );
  const preferredRangeMeters = Math.max(
    0,
    toFiniteNumber(doctrine.preferredCombatRangeMeters, 0),
  );
  const settleToleranceMeters = Math.max(
    0,
    toFiniteNumber(doctrine.settleToleranceMeters, 0),
  );
  const surfaceDistanceMeters = getSurfaceDistance(entity, target);
  const targetID = toPositiveInt(target && target.itemID, 0);
  const lowerBoundMeters = Math.max(0, preferredRangeMeters - settleToleranceMeters);
  const upperBoundMeters = preferredRangeMeters + settleToleranceMeters;

  if (surfaceDistanceMeters > upperBoundMeters) {
    if (!hasMatchingFollowCommand(entity, targetID, preferredRangeMeters)) {
      scene.followBall(
        buildNpcPseudoSession(entity),
        targetID,
        preferredRangeMeters,
        CAPITAL_MOVEMENT_OPTIONS,
      );
      rememberMovementState(capitalState, {
        mode: "follow",
        targetID,
        rangeMeters: preferredRangeMeters,
        issuedAtMs: nowMs,
      });
    }
    return true;
  }

  if (surfaceDistanceMeters < lowerBoundMeters) {
    const withdrawDirection = normalizeVector(
      subtractVectors(entity && entity.position, target && target.position),
      entity && entity.direction || { x: 1, y: 0, z: 0 },
    );
    if (
      shouldRefreshDirectionalCommand(
        entity,
        capitalState,
        "withdraw",
        withdrawDirection,
        nowMs,
        refreshIntervalMs,
      )
    ) {
      scene.gotoDirection(
        buildNpcPseudoSession(entity),
        withdrawDirection,
        CAPITAL_MOVEMENT_OPTIONS,
      );
      rememberMovementState(capitalState, {
        mode: "withdraw",
        targetID,
        rangeMeters: preferredRangeMeters,
        direction: withdrawDirection,
        issuedAtMs: nowMs,
      });
    }
    return true;
  }

  return stopCapitalNpc(scene, entity, controller, nowMs, "hold");
}

function syncCapitalNpcReturnHome(scene, entity, controller, behaviorProfile, options = {}) {
  if (!scene || !entity || entity.capitalNpc !== true || !controller) {
    return false;
  }

  const nowMs = toFiniteNumber(options.nowMs, Date.now());
  const homePosition = controller.homePosition;
  if (!homePosition || behaviorProfile.returnToHomeWhenIdle === false) {
    controller.returningHome = false;
    return stopCapitalNpc(scene, entity, controller, nowMs, "home");
  }

  const arrivalMeters = Math.max(
    1_000,
    toFiniteNumber(behaviorProfile.homeArrivalMeters, 6_000),
  );
  const distanceToHome = distance(entity && entity.position, homePosition);
  if (distanceToHome <= arrivalMeters) {
    controller.returningHome = false;
    return stopCapitalNpc(scene, entity, controller, nowMs, "home");
  }

  const capitalState = getCapitalControllerState(controller);
  const runtimeConfig = getCapitalRuntimeConfig(entity && entity.capitalClassID);
  const refreshIntervalMs = Math.max(
    50,
    toPositiveInt(runtimeConfig.repositionThinkIntervalMs, 250),
  );
  const homeDirection = normalizeVector(
    subtractVectors(homePosition, entity && entity.position),
    entity && entity.direction || controller.homeDirection || { x: 1, y: 0, z: 0 },
  );
  controller.returningHome = true;
  if (
    shouldRefreshDirectionalCommand(
      entity,
      capitalState,
      "home",
      homeDirection,
      nowMs,
      refreshIntervalMs,
    )
  ) {
    scene.gotoDirection(
      buildNpcPseudoSession(entity),
      homeDirection,
      CAPITAL_MOVEMENT_OPTIONS,
    );
    controller.lastHomeCommandAtMs = nowMs;
    controller.lastHomeDirection = homeDirection;
    rememberMovementState(capitalState, {
      mode: "home",
      direction: homeDirection,
      issuedAtMs: nowMs,
    });
  }
  return true;
}

module.exports = {
  syncCapitalNpcMovement,
  syncCapitalNpcReturnHome,
  __testing: {
    buildNpcPseudoSession,
    getSurfaceDistance,
    isDirectionChangeSignificant,
    normalizeVector,
    stopCapitalNpc,
  },
};
