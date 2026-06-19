function createMovementWarpStateHelpers(deps = {}) {
  const {
    addVectors,
    clamp,
    clonePilotWarpMaxSpeedRamp,
    cloneVector,
    distance,
    getActualSpeedFraction,
    getCurrentAlignmentDirection,
    getTurnMetrics,
    magnitude,
    normalizeVector,
    scaleVector,
    serializeWarpState,
    subtractVectors,
    toFiniteNumber,
    toInt,
    DESTINY_STAMP_INTERVAL_MS,
    MIN_WARP_DISTANCE_METERS,
    ONE_AU_IN_METERS,
    SESSIONLESS_WARP_INGRESS_DURATION_MS,
    WARP_ALIGNMENT_RADIANS,
    WARP_COMPLETION_DISTANCE_MAX_METERS,
    WARP_COMPLETION_DISTANCE_MIN_METERS,
    WARP_COMPLETION_DISTANCE_RATIO,
    WARP_DECEL_RATE_MAX,
    WARP_DROPOUT_SPEED_MAX_MS,
    WARP_ENTRY_SPEED_FRACTION,
    WARP_NATIVE_DECEL_GRACE_MS,
  } = deps;

  function getWarpAccelRate(warpSpeedAU) {
    return Math.max(toFiniteNumber(warpSpeedAU, 0), 0.001);
  }

  function getWarpDecelRate(warpSpeedAU) {
    return clamp(getWarpAccelRate(warpSpeedAU) / 3, 0.001, WARP_DECEL_RATE_MAX);
  }

  function getWarpDropoutSpeedMs(entity) {
    return Math.max(
      Math.min(
        toFiniteNumber(entity && entity.maxVelocity, 0) / 2,
        WARP_DROPOUT_SPEED_MAX_MS,
      ),
      1,
    );
  }

  function getWarpCompletionDistance(warpState) {
    const stopDistance = Math.max(
      toFiniteNumber(warpState && warpState.stopDistance, 0),
      0,
    );
    return clamp(
      stopDistance * WARP_COMPLETION_DISTANCE_RATIO,
      WARP_COMPLETION_DISTANCE_MIN_METERS,
      WARP_COMPLETION_DISTANCE_MAX_METERS,
    );
  }

  function buildWarpProfile(entity, destination, options = {}) {
    const rawDestination = cloneVector(destination, entity.position);
    const stopDistance = Math.max(0, toFiniteNumber(options.stopDistance, 0));
    const travelVector = subtractVectors(rawDestination, entity.position);
    const direction = normalizeVector(travelVector, entity.direction);
    const targetPoint = subtractVectors(rawDestination, scaleVector(direction, stopDistance));
    const totalDistance = distance(entity.position, targetPoint);
    if (totalDistance < MIN_WARP_DISTANCE_METERS) {
      return null;
    }

    const warpSpeedAU =
      toFiniteNumber(options.warpSpeedAU, 0) > 0
        ? toFiniteNumber(options.warpSpeedAU, 0)
        : entity.warpSpeedAU;
    const cruiseWarpSpeedMs = Math.max(warpSpeedAU * ONE_AU_IN_METERS, 10000);
    const accelRate = getWarpAccelRate(warpSpeedAU);
    const decelRate = getWarpDecelRate(warpSpeedAU);
    const warpDropoutSpeedMs = getWarpDropoutSpeedMs(entity);

    let profileType = "long";
    let accelDistance = 0;
    let cruiseDistance = 0;
    let decelDistance = 0;
    let accelTimeMs = 0;
    let cruiseTimeMs = 0;
    let decelTimeMs = 0;
    let maxWarpSpeedMs = cruiseWarpSpeedMs;
    const accelDistanceAtCruise = Math.max(cruiseWarpSpeedMs / accelRate, 0);
    const decelDistanceAtCruise = Math.max(cruiseWarpSpeedMs / decelRate, 0);
    const shortWarpDistanceThreshold = accelDistanceAtCruise + decelDistanceAtCruise;

    if (totalDistance < shortWarpDistanceThreshold) {
      profileType = "short";
      maxWarpSpeedMs =
        (totalDistance * accelRate * decelRate) /
        Math.max(accelRate + decelRate, 0.001);
      accelDistance = Math.max(maxWarpSpeedMs / accelRate, 0);
      decelDistance = Math.max(maxWarpSpeedMs / decelRate, 0);
      accelTimeMs =
        (Math.log(Math.max(maxWarpSpeedMs / accelRate, 1)) /
          accelRate) *
        1000;
      decelTimeMs =
        (Math.log(Math.max(maxWarpSpeedMs / warpDropoutSpeedMs, 1)) /
          decelRate) *
        1000;
    } else {
      accelDistance = accelDistanceAtCruise;
      decelDistance = decelDistanceAtCruise;
      accelTimeMs =
        (Math.log(Math.max(cruiseWarpSpeedMs / accelRate, 1)) /
          accelRate) *
        1000;
      decelTimeMs =
        (Math.log(Math.max(cruiseWarpSpeedMs / warpDropoutSpeedMs, 1)) /
          decelRate) *
        1000;
      cruiseDistance = Math.max(
        totalDistance - accelDistance - decelDistance,
        0,
      );
      cruiseTimeMs = (cruiseDistance / cruiseWarpSpeedMs) * 1000;
    }

    return {
      startTimeMs: toFiniteNumber(options.nowMs, Date.now()),
      durationMs:
        accelTimeMs +
        cruiseTimeMs +
        decelTimeMs +
        Math.max(WARP_NATIVE_DECEL_GRACE_MS, 0),
      accelTimeMs,
      cruiseTimeMs,
      decelTimeMs,
      totalDistance,
      stopDistance,
      maxWarpSpeedMs,
      cruiseWarpSpeedMs,
      warpFloorSpeedMs: warpDropoutSpeedMs,
      warpDropoutSpeedMs,
      accelDistance,
      cruiseDistance,
      decelDistance,
      accelExponent: accelRate,
      decelExponent: decelRate,
      accelRate,
      decelRate,
      warpSpeed: Math.max(1, Math.round(warpSpeedAU * 1000)),
      commandStamp: toInt(options.commandStamp, 0),
      startupGuidanceStamp: toInt(options.startupGuidanceStamp, 0),
      startupGuidanceVelocity: cloneVector(
        options.startupGuidanceVelocity,
        entity.velocity,
      ),
      cruiseBumpStamp: toInt(options.cruiseBumpStamp, 0),
      effectStamp: toInt(options.effectStamp, toInt(options.defaultEffectStamp, 0)),
      targetEntityID: toInt(options.targetEntityID, 0),
      followID: toFiniteNumber(options.followID, 15000),
      followRangeMarker: toFiniteNumber(options.followRangeMarker, -1),
      profileType,
      origin: cloneVector(entity.position),
      rawDestination,
      targetPoint,
      pilotMaxSpeedRamp: clonePilotWarpMaxSpeedRamp(options.pilotMaxSpeedRamp),
    };
  }

  function buildPendingWarp(rawPendingWarp, position = { x: 0, y: 0, z: 0 }) {
    if (!rawPendingWarp || typeof rawPendingWarp !== "object") {
      return null;
    }

    return {
      requestedAtMs: toInt(rawPendingWarp.requestedAtMs, 0),
      preWarpSyncStamp: toInt(rawPendingWarp.preWarpSyncStamp, 0),
      prepareStamp: toInt(rawPendingWarp.prepareStamp, 0),
      prepareVisibleStamp: toInt(rawPendingWarp.prepareVisibleStamp, 0),
      stopDistance: Math.max(0, toFiniteNumber(rawPendingWarp.stopDistance, 0)),
      totalDistance: Math.max(0, toFiniteNumber(rawPendingWarp.totalDistance, 0)),
      warpSpeedAU: Math.max(0, toFiniteNumber(rawPendingWarp.warpSpeedAU, 0)),
      rawDestination: cloneVector(rawPendingWarp.rawDestination, position),
      targetPoint: cloneVector(rawPendingWarp.targetPoint, position),
      targetEntityID: toInt(rawPendingWarp.targetEntityID, 0) || null,
    };
  }

  function buildPendingWarpRequest(entity, destination, options = {}) {
    const rawDestination = cloneVector(destination, entity.position);
    const stopDistance = Math.max(0, toFiniteNumber(options.stopDistance, 0));
    const travelVector = subtractVectors(rawDestination, entity.position);
    const direction = normalizeVector(travelVector, entity.direction);
    const targetPoint = subtractVectors(
      rawDestination,
      scaleVector(direction, stopDistance),
    );
    const totalDistance = distance(entity.position, targetPoint);
    if (totalDistance < MIN_WARP_DISTANCE_METERS) {
      return null;
    }

    const warpSpeedAU =
      toFiniteNumber(options.warpSpeedAU, 0) > 0
        ? toFiniteNumber(options.warpSpeedAU, 0)
        : entity.warpSpeedAU;

    return {
      requestedAtMs: toFiniteNumber(options.nowMs, Date.now()),
      preWarpSyncStamp: 0,
      prepareStamp: toInt(options.prepareStamp, 0),
      prepareVisibleStamp: toInt(options.prepareVisibleStamp, 0),
      stopDistance,
      totalDistance,
      warpSpeedAU,
      rawDestination,
      targetPoint,
      targetEntityID: toInt(options.targetEntityID, 0) || null,
    };
  }

  function buildPreparingWarpState(entity, pendingWarp, options = {}) {
    const warpState = buildWarpProfile(entity, pendingWarp && pendingWarp.rawDestination, {
      stopDistance: pendingWarp && pendingWarp.stopDistance,
      targetEntityID: pendingWarp && pendingWarp.targetEntityID,
      warpSpeedAU: pendingWarp && pendingWarp.warpSpeedAU,
      nowMs:
        options.nowMs === undefined || options.nowMs === null
          ? pendingWarp && pendingWarp.requestedAtMs
          : options.nowMs,
      commandStamp: pendingWarp && pendingWarp.prepareStamp,
      startupGuidanceStamp: 0,
      startupGuidanceVelocity: entity && entity.velocity,
      cruiseBumpStamp: 0,
      effectStamp: -1,
      defaultEffectStamp: toInt(options.defaultEffectStamp, 0),
    });
    if (!warpState) {
      return null;
    }

    warpState.commandStamp = toInt(pendingWarp && pendingWarp.prepareStamp, 0);
    warpState.startupGuidanceAtMs = 0;
    warpState.startupGuidanceStamp = 0;
    warpState.startupGuidanceVelocity = cloneVector(
      entity && entity.velocity,
      { x: 0, y: 0, z: 0 },
    );
    warpState.cruiseBumpAtMs = 0;
    warpState.cruiseBumpStamp = 0;
    warpState.effectAtMs = 0;
    warpState.effectStamp = -1;
    warpState.pilotMaxSpeedRamp = [];
    return warpState;
  }

  function refreshPreparingWarpState(entity) {
    if (!entity || !entity.pendingWarp) {
      return null;
    }

    const refreshed = buildPreparingWarpState(entity, entity.pendingWarp);
    if (refreshed) {
      entity.warpState = refreshed;
    }
    return refreshed;
  }

  function evaluatePendingWarp(entity, pendingWarp, now = Date.now()) {
    const desiredDirection = normalizeVector(
      subtractVectors(pendingWarp.targetPoint, entity.position),
      entity.direction,
    );
    const alignmentDirection = getCurrentAlignmentDirection(
      entity,
      desiredDirection,
    );
    const turnMetrics = getTurnMetrics(alignmentDirection, desiredDirection);
    const degrees = (turnMetrics.radians * 180) / Math.PI;
    const actualSpeedFraction = getActualSpeedFraction(entity);
    const alignTimeMs = Math.max(
      1000,
      toFiniteNumber(entity.alignTime, 0) * 1000,
    );
    const elapsedMs = Math.max(
      0,
      toInt(now, Date.now()) - toInt(pendingWarp.requestedAtMs, 0),
    );
    const forced = elapsedMs >= (alignTimeMs + 300);
    return {
      ready:
        (Number.isFinite(degrees) &&
          degrees <= (WARP_ALIGNMENT_RADIANS * 180) / Math.PI &&
          actualSpeedFraction >= WARP_ENTRY_SPEED_FRACTION) ||
        forced,
      forced,
      degrees,
      actualSpeedFraction,
      elapsedMs,
      desiredDirection,
      alignmentDirection,
    };
  }

  function getPilotWarpActivationVelocity(entity, warpState) {
    if (!warpState) {
      return { x: 0, y: 0, z: 0 };
    }

    const direction = normalizeVector(
      subtractVectors(warpState.targetPoint, entity.position),
      entity.direction,
    );
    const startupGuidanceVelocity = cloneVector(
      warpState && warpState.startupGuidanceVelocity,
      entity && entity.velocity,
    );
    const activationSpeed = magnitude(startupGuidanceVelocity);
    if (activationSpeed <= 0.5) {
      return { x: 0, y: 0, z: 0 };
    }
    return scaleVector(direction, activationSpeed);
  }

  function activatePendingWarp(entity, pendingWarp, options = {}) {
    const startupGuidanceVelocity = cloneVector(entity.velocity);
    const warpState = buildWarpProfile(entity, pendingWarp.rawDestination, {
      stopDistance: pendingWarp.stopDistance,
      targetEntityID: pendingWarp.targetEntityID,
      warpSpeedAU: pendingWarp.warpSpeedAU,
      nowMs: toFiniteNumber(options.nowMs, pendingWarp && pendingWarp.requestedAtMs),
      commandStamp: 0,
      startupGuidanceStamp: 0,
      startupGuidanceVelocity,
      cruiseBumpStamp: 0,
      effectStamp: 0,
      defaultEffectStamp: toInt(options.defaultEffectStamp, 0),
    });
    if (!warpState) {
      return null;
    }

    entity.mode = "WARP";
    entity.speedFraction = 1;
    entity.direction = normalizeVector(
      subtractVectors(warpState.targetPoint, entity.position),
      entity.direction,
    );
    entity.targetPoint = cloneVector(warpState.targetPoint);
    entity.targetEntityID = warpState.targetEntityID || null;
    entity.warpState = warpState;
    entity.pendingWarp = null;
    entity.velocity = getPilotWarpActivationVelocity(entity, warpState);
    entity.lastWarpCorrectionBroadcastAt = 0;
    entity.lastWarpPositionBroadcastStamp = -1;
    entity.lastPilotWarpStartupGuidanceStamp = 0;
    entity.lastPilotWarpVelocityStamp = 0;
    entity.lastPilotWarpEffectStamp = 0;
    entity.lastPilotWarpCruiseBumpStamp = 0;
    entity.lastPilotWarpMaxSpeedRampIndex = -1;
    entity.lastWarpDiagnosticStamp = 0;
    return warpState;
  }

  function buildSessionlessWarpIngressState(entity, warpState, options = {}) {
    const startTimeMs = toFiniteNumber(options.nowMs, Date.now());
    const durationMs = Math.max(
      250,
      toFiniteNumber(options.durationMs, SESSIONLESS_WARP_INGRESS_DURATION_MS),
    );
    const completionHoldMs = Math.max(
      0,
      toFiniteNumber(options.completionHoldMs, DESTINY_STAMP_INTERVAL_MS),
    );
    const travelCompleteAtMs = startTimeMs + durationMs;
    return {
      startTimeMs,
      travelCompleteAtMs,
      completeAtMs: travelCompleteAtMs + completionHoldMs,
      durationMs,
      completionHoldMs,
      lastUpdateAtMs: startTimeMs,
      origin: cloneVector(entity.position),
      targetPoint: cloneVector(warpState && warpState.targetPoint, entity.position),
    };
  }

  function advanceSessionlessWarpIngress(entity, now) {
    const ingressState = entity && entity.sessionlessWarpIngress;
    if (!entity || !ingressState) {
      return { changed: false };
    }

    const previousPosition = cloneVector(entity.position);
    const previousVelocity = cloneVector(entity.velocity);
    const origin = cloneVector(ingressState.origin, entity.position);
    const targetPoint = cloneVector(ingressState.targetPoint, entity.position);
    const travelVector = subtractVectors(targetPoint, origin);
    const totalDistance = magnitude(travelVector);
    const direction = normalizeVector(travelVector, entity.direction);
    const startTimeMs = toFiniteNumber(ingressState.startTimeMs, now);
    const travelCompleteAtMs = Math.max(
      startTimeMs + 1,
      toFiniteNumber(
        ingressState.travelCompleteAtMs,
        toFiniteNumber(ingressState.completeAtMs, now),
      ),
    );
    const completeAtMs = Math.max(
      travelCompleteAtMs,
      toFiniteNumber(ingressState.completeAtMs, travelCompleteAtMs),
    );
    const durationMs = Math.max(travelCompleteAtMs - startTimeMs, 1);
    const rawProgress = clamp((now - startTimeMs) / durationMs, 0, 1);
    const easedProgress = rawProgress <= 0
      ? 0
      : rawProgress >= 1
        ? 1
        : (rawProgress * rawProgress * (3 - (2 * rawProgress)));
    const lastUpdateAtMs = toFiniteNumber(ingressState.lastUpdateAtMs, startTimeMs);
    const deltaSeconds = Math.max((now - lastUpdateAtMs) / 1000, 0.001);

    entity.direction = direction;
    entity.position = rawProgress >= 1
      ? cloneVector(targetPoint)
      : addVectors(origin, scaleVector(direction, totalDistance * easedProgress));
    entity.velocity = rawProgress >= 1
      ? { x: 0, y: 0, z: 0 }
      : scaleVector(
          direction,
          distance(previousPosition, entity.position) / deltaSeconds,
        );
    ingressState.lastUpdateAtMs = now;

    if (rawProgress >= 1 && now < completeAtMs) {
      return {
        changed:
          distance(previousPosition, entity.position) > 1 ||
          distance(previousVelocity, entity.velocity) > 0.5,
      };
    }

    if (rawProgress >= 1) {
      const completedWarpState = serializeWarpState({
        warpState: entity.warpState,
        position: entity.position,
      });
      entity.mode = "STOP";
      entity.speedFraction = 0;
      entity.targetPoint = cloneVector(entity.position);
      entity.warpState = null;
      entity.sessionlessWarpIngress = null;
      return {
        changed:
          distance(previousPosition, entity.position) > 1 ||
          distance(previousVelocity, entity.velocity) > 0.5,
        warpCompleted: true,
        completedWarpState,
      };
    }

    return {
      changed:
        distance(previousPosition, entity.position) > 1 ||
        distance(previousVelocity, entity.velocity) > 0.5,
    };
  }

  function getWarpProgress(warpState, now) {
    const elapsedMs = Math.max(0, toFiniteNumber(now, Date.now()) - warpState.startTimeMs);
    const accelMs = warpState.accelTimeMs;
    const cruiseMs = warpState.cruiseTimeMs;
    const decelMs = warpState.decelTimeMs;
    const resolvedWarpSpeedAU = Math.max(
      toFiniteNumber(warpState.warpSpeed, 0) / 1000,
      toFiniteNumber(warpState.cruiseWarpSpeedMs, 0) / ONE_AU_IN_METERS,
      0.001,
    );
    const accelRate = Math.max(
      toFiniteNumber(warpState.accelRate, 0) ||
        toFiniteNumber(warpState.accelExponent, 0) ||
        getWarpAccelRate(resolvedWarpSpeedAU),
      0.001,
    );
    const decelRate = Math.max(
      toFiniteNumber(warpState.decelRate, 0) ||
        toFiniteNumber(warpState.decelExponent, 0) ||
        getWarpDecelRate(resolvedWarpSpeedAU),
      0.001,
    );
    const maxWarpSpeedMs = Math.max(toFiniteNumber(warpState.maxWarpSpeedMs, 0), 0);
    const warpDropoutSpeedMs = Math.max(
      Math.min(
        toFiniteNumber(
          warpState.warpDropoutSpeedMs,
          toFiniteNumber(warpState.warpFloorSpeedMs, WARP_DROPOUT_SPEED_MAX_MS),
        ),
        maxWarpSpeedMs || 1,
      ),
      1,
    );
    const accelDistance = Math.max(toFiniteNumber(warpState.accelDistance, 0), 0);
    const cruiseDistance = Math.max(toFiniteNumber(warpState.cruiseDistance, 0), 0);
    const decelDistance = Math.max(toFiniteNumber(warpState.decelDistance, 0), 0);
    const cruiseWarpSpeedMs = Math.max(
      toFiniteNumber(warpState.cruiseWarpSpeedMs, maxWarpSpeedMs),
      0,
    );
    const decelSeconds = Math.max(decelMs / 1000, 0);
    const decelStartMs = accelMs + cruiseMs;

    if (elapsedMs >= warpState.durationMs) {
      return { complete: true, traveled: warpState.totalDistance, speed: 0 };
    }

    if (elapsedMs < accelMs) {
      const seconds = elapsedMs / 1000;
      const speed = Math.min(
        maxWarpSpeedMs,
        accelRate * Math.exp(accelRate * seconds),
      );
      return {
        complete: false,
        traveled: Math.min(
          accelDistance,
          Math.max(speed / accelRate, 0),
        ),
        speed,
      };
    }

    if (elapsedMs < accelMs + cruiseMs) {
      const seconds = (elapsedMs - accelMs) / 1000;
      return {
        complete: false,
        traveled: accelDistance + (cruiseWarpSpeedMs * seconds),
        speed: cruiseWarpSpeedMs,
      };
    }

    const seconds = Math.min(
      (elapsedMs - decelStartMs) / 1000,
      decelSeconds,
    );
    const speed = Math.max(
      warpDropoutSpeedMs,
      maxWarpSpeedMs * Math.exp(-decelRate * seconds),
    );
    const progress = {
      complete: false,
      traveled:
        accelDistance +
        cruiseDistance +
        Math.min(
          decelDistance,
          Math.max((maxWarpSpeedMs - speed) / decelRate, 0),
        ),
      speed,
    };
    const remainingDistance = Math.max(
      toFiniteNumber(warpState.totalDistance, 0) - progress.traveled,
      0,
    );
    if (remainingDistance <= getWarpCompletionDistance(warpState)) {
      return {
        complete: true,
        traveled: warpState.totalDistance,
        speed: 0,
      };
    }
    return progress;
  }

  function getWarpStopDistanceForTarget(shipEntity, targetEntity, minimumRange = 0) {
    const targetRadius = Math.max(0, toFiniteNumber(targetEntity && targetEntity.radius, 0));
    const desiredRange = Math.max(0, toFiniteNumber(minimumRange, 0));

    switch (targetEntity && targetEntity.kind) {
      case "planet":
      case "moon":
        return Math.max(targetRadius + 1000000, desiredRange) + (shipEntity.radius * 2);
      case "sun":
        return Math.max(targetRadius + 5000000, desiredRange) + (shipEntity.radius * 2);
      case "station":
        return targetRadius + desiredRange + (shipEntity.radius * 2);
      case "stargate":
        return Math.max(Math.max(2500, targetRadius * 0.3), desiredRange) + (shipEntity.radius * 2);
      case "asteroidBelt":
        return Math.max(2500, desiredRange) + (shipEntity.radius * 2);
      default:
        return Math.max(Math.max(1000, targetRadius), desiredRange) + (shipEntity.radius * 2);
    }
  }

  return {
    getWarpAccelRate,
    getWarpDecelRate,
    getWarpDropoutSpeedMs,
    getWarpCompletionDistance,
    buildWarpProfile,
    buildPendingWarp,
    buildPendingWarpRequest,
    buildPreparingWarpState,
    refreshPreparingWarpState,
    evaluatePendingWarp,
    getPilotWarpActivationVelocity,
    activatePendingWarp,
    buildSessionlessWarpIngressState,
    advanceSessionlessWarpIngress,
    getWarpProgress,
    getWarpStopDistanceForTarget,
  };
}

module.exports = {
  createMovementWarpStateHelpers,
};
