const destiny = require("../../destiny");
const {
  currentFileTime,
} = require("../../../services/_shared/serviceHelpers");
const {
  tagUpdatesRequireExistingVisibility,
} = require("../dispatch/movementDispatchUtils");

function createMovementWarpBuilders(deps = {}) {
  const {
    clamp,
    cloneVector,
    getCurrentDestinyStamp,
    getNextStamp,
    magnitude,
    normalizeVector,
    scaleVector,
    subtractVectors,
    toFiniteNumber,
    toInt,
    DEFAULT_RIGHT,
    DESTINY_STAMP_INTERVAL_MS,
    ENABLE_PILOT_WARP_FACTOR_OPTION_A,
    ENABLE_PILOT_WARP_MAX_SPEED_RAMP,
    ENABLE_PILOT_WARP_SOLVER_ASSIST_OPTION_B,
    MAX_SUBWARP_SPEED_FRACTION,
    PILOT_WARP_FACTOR_OPTION_A_SCALE,
    PILOT_WARP_SOLVER_ASSIST_LEAD_MS,
    PILOT_WARP_SOLVER_ASSIST_SCALE,
    PILOT_WARP_SPEED_RAMP_FRACTIONS,
    PILOT_WARP_SPEED_RAMP_SCALES,
    WARP_NATIVE_ACTIVATION_SPEED_FRACTION,
    WARP_NATIVE_ACTIVATION_SPEED_MARGIN_MS,
    WARP_START_ACTIVATION_SEED_SCALE,
  } = deps;

  function buildPilotPreWarpAddBallUpdate(entity, stamp) {
    return {
      stamp,
      payload: destiny.buildAddBallPayload(entity.itemID, {
        mass: entity.mass,
        radius: entity.radius,
        maxSpeed: entity.maxVelocity,
        isFree: true,
        isGlobal: false,
        isMassive: false,
        isInteractive: true,
        isMoribund: false,
        position: entity.position,
        velocity: entity.velocity,
        inertia: entity.inertia,
        speedFraction: clamp(
          toFiniteNumber(entity.speedFraction, 1),
          0,
          MAX_SUBWARP_SPEED_FRACTION,
        ),
      }),
    };
  }

  function buildPilotPreWarpRebaselineUpdates(entity, pendingWarp, stamp) {
    const speed = magnitude(entity.velocity);
    let alignedVelocity = entity.velocity;
    if (speed > 0.5 && pendingWarp && pendingWarp.targetPoint) {
      const warpDir = normalizeVector(
        subtractVectors(pendingWarp.targetPoint, entity.position),
        entity.direction,
      );
      alignedVelocity = scaleVector(warpDir, speed);
    }
    return [
      {
        stamp,
        payload: destiny.buildSetBallVelocityPayload(
          entity.itemID,
          alignedVelocity,
        ),
      },
    ];
  }

  function buildPilotWarpEgoStateRefreshUpdates(
    system,
    entity,
    stamp,
    simFileTime = currentFileTime(),
  ) {
    const egoEntities = [entity];
    return [
      {
        stamp,
        payload: destiny.buildAddBalls2Payload(stamp, egoEntities, simFileTime),
      },
      {
        stamp,
        payload: destiny.buildSetStatePayload(
          stamp,
          system,
          entity.itemID,
          egoEntities,
          simFileTime,
        ),
      },
    ];
  }

  function buildPilotWarpActivationStateRefreshUpdates(
    entity,
    stamp,
    simFileTime = currentFileTime(),
  ) {
    return [
      {
        stamp,
        payload: destiny.buildAddBalls2Payload(stamp, [entity], simFileTime),
      },
    ];
  }

  function getNominalWarpFactor(entity, warpState) {
    return Math.max(
      1,
      toInt(
        warpState && warpState.warpSpeed,
        Math.round(toFiniteNumber(entity && entity.warpSpeedAU, 0) * 1000),
      ),
    );
  }

  function getPilotWarpFactorOptionA(entity, warpState) {
    const nominalWarpFactor = getNominalWarpFactor(entity, warpState);
    if (!ENABLE_PILOT_WARP_FACTOR_OPTION_A) {
      return nominalWarpFactor;
    }
    return Math.max(
      nominalWarpFactor + 1,
      Math.round(nominalWarpFactor * PILOT_WARP_FACTOR_OPTION_A_SCALE),
    );
  }

  function buildWarpStartCommandUpdate(entity, stamp, warpState, options = {}) {
    const warpFactor = Math.max(
      1,
      toInt(options.warpFactor, getNominalWarpFactor(entity, warpState)),
    );
    return {
      stamp,
      payload: destiny.buildWarpToPayload(
        entity.itemID,
        warpState.rawDestination,
        warpState.stopDistance,
        warpFactor,
      ),
    };
  }

  function buildWarpPrepareCommandUpdate(entity, stamp, warpState) {
    return buildWarpStartCommandUpdate(entity, stamp, warpState);
  }

  function getPilotWarpPeakSpeed(entity, warpState) {
    if (!warpState) {
      return Math.max(toFiniteNumber(entity && entity.maxVelocity, 0), 0);
    }

    const peakWarpSpeedMs =
      warpState.profileType === "short"
        ? toFiniteNumber(warpState.maxWarpSpeedMs, 0)
        : toFiniteNumber(warpState.cruiseWarpSpeedMs, 0);
    return Math.max(
      peakWarpSpeedMs,
      toFiniteNumber(warpState.maxWarpSpeedMs, 0),
      toFiniteNumber(entity && entity.maxVelocity, 0),
    );
  }

  function shouldSchedulePilotWarpCruiseBump(warpState) {
    return (
      ENABLE_PILOT_WARP_MAX_SPEED_RAMP &&
      toFiniteNumber(warpState && warpState.cruiseDistance, 0) > 0 &&
      toFiniteNumber(warpState && warpState.cruiseWarpSpeedMs, 0) > 0
    );
  }

  function getPilotWarpStartupGuidanceAtMs(warpState) {
    if (!warpState) {
      return 0;
    }
    const startTimeMs = toFiniteNumber(warpState.startTimeMs, 0);
    if (startTimeMs <= 0) {
      return 0;
    }
    return startTimeMs + DESTINY_STAMP_INTERVAL_MS;
  }

  function getPilotWarpStartupGuidanceStamp(warpStartStamp, warpState) {
    const scheduledStamp = getCurrentDestinyStamp(
      getPilotWarpStartupGuidanceAtMs(warpState),
    );
    return (Math.max(toInt(warpStartStamp, 0) + 1, scheduledStamp) & 0x7fffffff) >>> 0;
  }

  function getPilotWarpCruiseBumpAtMs(warpState) {
    const startTimeMs = toFiniteNumber(warpState && warpState.startTimeMs, Date.now());
    const accelTimeMs = Math.max(
      toFiniteNumber(warpState && warpState.accelTimeMs, 0),
      0,
    );
    const accelEndAtMs = startTimeMs + accelTimeMs;
    const startupGuidanceAtMs = getPilotWarpStartupGuidanceAtMs(warpState);
    return Math.max(
      accelEndAtMs,
      startupGuidanceAtMs + DESTINY_STAMP_INTERVAL_MS,
    );
  }

  function getPilotWarpEffectAtMs(warpState) {
    return toFiniteNumber(warpState && warpState.startTimeMs, Date.now());
  }

  function getPilotWarpCruiseBumpStamp(warpStartStamp, warpState) {
    return getCurrentDestinyStamp(getPilotWarpCruiseBumpAtMs(warpState));
  }

  function getPilotWarpEffectStamp(warpStartStamp, warpState) {
    return warpStartStamp;
  }

  function getPilotWarpActivationSeedSpeed(entity) {
    return Math.max(
      toFiniteNumber(entity && entity.maxVelocity, 0) * WARP_START_ACTIVATION_SEED_SCALE,
      0,
    );
  }

  function getPilotWarpActivationKickoffSpeed(entity, warpState) {
    const peakWarpSpeedMs = Math.max(getPilotWarpPeakSpeed(entity, warpState), 0);
    const firstRampScale = clamp(
      PILOT_WARP_SPEED_RAMP_SCALES[0],
      0,
      0.95,
    );
    return Math.max(
      peakWarpSpeedMs * firstRampScale,
      getPilotWarpActivationSeedSpeed(entity),
      toFiniteNumber(entity && entity.maxVelocity, 0) + 1,
    );
  }

  function buildPilotWarpMaxSpeedRamp(entity, warpState, warpStartStamp) {
    if (!warpState) {
      return [];
    }

    const startTimeMs = toFiniteNumber(warpState.startTimeMs, 0);
    if (startTimeMs <= 0) {
      return [];
    }

    const ramp = [];
    let previousStamp = toInt(warpStartStamp, 0);
    const cruiseBumpStamp = shouldSchedulePilotWarpCruiseBump(warpState)
      ? getPilotWarpCruiseBumpStamp(warpStartStamp, warpState)
      : 0;
    if (ENABLE_PILOT_WARP_SOLVER_ASSIST_OPTION_B) {
      const accelTimeMs = Math.max(toFiniteNumber(warpState.accelTimeMs, 0), 0);
      const cruiseTimeMs = Math.max(toFiniteNumber(warpState.cruiseTimeMs, 0), 0);
      const decelAssistAtMs = Math.max(
        startTimeMs,
        (startTimeMs + accelTimeMs + cruiseTimeMs) - PILOT_WARP_SOLVER_ASSIST_LEAD_MS,
      );
      const resolvedStamp = Math.max(
        previousStamp + 1,
        getCurrentDestinyStamp(decelAssistAtMs),
      );
      const assistSpeed = Math.max(
        getPilotWarpActivationSeedSpeed(entity) * PILOT_WARP_SOLVER_ASSIST_SCALE,
        toFiniteNumber(entity && entity.maxVelocity, 0) + 1,
      );
      if (assistSpeed > 0) {
        ramp.push({
          atMs: decelAssistAtMs,
          stamp: resolvedStamp >>> 0,
          speed: assistSpeed,
          label: "decel_assist",
        });
        previousStamp = resolvedStamp >>> 0;
      }
    }

    if (!ENABLE_PILOT_WARP_MAX_SPEED_RAMP) {
      return ramp;
    }

    const accelTimeMs = Math.max(toFiniteNumber(warpState.accelTimeMs, 0), 0);
    const peakWarpSpeedMs = Math.max(getPilotWarpPeakSpeed(entity, warpState), 0);
    if (accelTimeMs <= 0 || peakWarpSpeedMs <= 0) {
      return ramp;
    }

    for (let index = 0; index < PILOT_WARP_SPEED_RAMP_FRACTIONS.length; index += 1) {
      const phaseFraction = clamp(PILOT_WARP_SPEED_RAMP_FRACTIONS[index], 0, 1);
      const speedScale = clamp(PILOT_WARP_SPEED_RAMP_SCALES[index], 0, 0.95);
      const atMs = startTimeMs + (accelTimeMs * phaseFraction);
      const resolvedStamp = Math.max(
        previousStamp + 1,
        getCurrentDestinyStamp(atMs),
      );
      const speed = peakWarpSpeedMs * speedScale;
      if (speed <= 0) {
        continue;
      }
      if (cruiseBumpStamp > 0 && resolvedStamp === cruiseBumpStamp) {
        continue;
      }
      ramp.push({
        atMs,
        stamp: resolvedStamp >>> 0,
        speed,
        label: `accel_${index + 1}`,
      });
      previousStamp = resolvedStamp >>> 0;
    }

    return ramp;
  }

  function buildPilotWarpSeedUpdate(entity, stamp) {
    return {
      stamp,
      payload: destiny.buildSetMaxSpeedPayload(
        entity.itemID,
        getPilotWarpActivationSeedSpeed(entity),
      ),
    };
  }

  function buildPilotWarpActivationKickoffUpdate(entity, stamp, warpState) {
    return {
      stamp,
      payload: destiny.buildSetMaxSpeedPayload(
        entity.itemID,
        getPilotWarpActivationKickoffSpeed(entity, warpState),
      ),
    };
  }

  function buildEntityWarpInUpdate(entity, stamp, warpState) {
    const warpFactor = Math.max(
      1,
      toInt(getNominalWarpFactor(entity, warpState), 30),
    );
    return {
      stamp,
      payload: destiny.buildEntityWarpInPayload(
        entity.itemID,
        warpState.targetPoint,
        warpFactor,
      ),
    };
  }

  function getPilotWarpNativeActivationSpeedFloor(entity) {
    return Math.max(
      (toFiniteNumber(entity && entity.maxVelocity, 0) *
        WARP_NATIVE_ACTIVATION_SPEED_FRACTION) +
        WARP_NATIVE_ACTIVATION_SPEED_MARGIN_MS,
      WARP_NATIVE_ACTIVATION_SPEED_MARGIN_MS,
    );
  }

  function buildWarpActivationVelocityUpdate(entity, stamp, warpState) {
    const currentVelocity = cloneVector(entity && entity.velocity);
    const currentSpeed = magnitude(currentVelocity);
    const activationSpeedFloor = getPilotWarpNativeActivationSpeedFloor(entity);
    let resolvedVelocity = currentVelocity;

    if (currentSpeed + 0.0001 < activationSpeedFloor) {
      const targetPoint = cloneVector(
        warpState && warpState.targetPoint,
        entity && entity.targetPoint,
      );
      const direction = normalizeVector(
        subtractVectors(targetPoint, cloneVector(entity && entity.position)),
        cloneVector(entity && entity.direction, DEFAULT_RIGHT),
      );
      resolvedVelocity = scaleVector(direction, activationSpeedFloor);
    }

    if (magnitude(resolvedVelocity) <= 0.5) {
      return null;
    }
    return {
      stamp,
      payload: destiny.buildSetBallVelocityPayload(entity.itemID, resolvedVelocity),
    };
  }

  function buildWarpStartVelocityCarryoverUpdate(entity, stamp, warpState) {
    const startupGuidanceVelocity = cloneVector(
      warpState && warpState.startupGuidanceVelocity,
      { x: 0, y: 0, z: 0 },
    );
    if (magnitude(startupGuidanceVelocity) <= 0.5) {
      return null;
    }
    return {
      stamp,
      payload: destiny.buildSetBallVelocityPayload(
        entity.itemID,
        startupGuidanceVelocity,
      ),
    };
  }

  function primePilotWarpActivationState(entity, warpState, warpStartStamp) {
    if (!entity || !warpState) {
      return warpState || null;
    }
    const resolvedStamp = toInt(warpStartStamp, 0);
    warpState.commandStamp = resolvedStamp;
    warpState.startupGuidanceAtMs = 0;
    warpState.startupGuidanceStamp = 0;
    warpState.cruiseBumpAtMs = shouldSchedulePilotWarpCruiseBump(warpState)
      ? getPilotWarpCruiseBumpAtMs(warpState)
      : 0;
    warpState.cruiseBumpStamp = shouldSchedulePilotWarpCruiseBump(warpState)
      ? getPilotWarpCruiseBumpStamp(resolvedStamp, warpState)
      : 0;
    warpState.effectAtMs = getPilotWarpEffectAtMs(warpState);
    warpState.effectStamp = getPilotWarpEffectStamp(resolvedStamp, warpState);
    warpState.pilotMaxSpeedRamp = buildPilotWarpMaxSpeedRamp(
      entity,
      warpState,
      resolvedStamp,
    );
    return warpState;
  }

  function getWatcherWarpStartStamp(warpState, pendingWarp, activationStamp) {
    const normalizedActivationStamp = toInt(activationStamp, getNextStamp());
    const pilotVisiblePrepareStamp = Math.max(
      toInt(pendingWarp && pendingWarp.prepareStamp, 0),
      toInt(warpState && warpState.commandStamp, 0),
    );
    return Math.max(
      (normalizedActivationStamp + 1) >>> 0,
      pilotVisiblePrepareStamp,
    );
  }

  function buildWarpStartEffectUpdate(entity, stamp) {
    return {
      stamp,
      payload: destiny.buildOnSpecialFXPayload(entity.itemID, "effects.Warping", {
        active: false,
      }),
    };
  }

  function buildWarpPrepareDispatch(entity, stamp, warpState) {
    const sharedUpdates = tagUpdatesRequireExistingVisibility([
      buildWarpPrepareCommandUpdate(entity, stamp, warpState),
      {
        stamp,
        payload: destiny.buildSetSpeedFractionPayload(entity.itemID, 1),
      },
    ]);
    const pilotPrepareUpdates = [
      buildPilotWarpSeedUpdate(entity, stamp),
      sharedUpdates[0],
      buildWarpStartEffectUpdate(entity, stamp),
      sharedUpdates[1],
    ];

    return {
      sharedUpdates,
      pilotUpdates: pilotPrepareUpdates,
    };
  }

  function buildPilotWarpActivationUpdates(entity, stamp, warpState) {
    // Keep the pilot-local activation phase empty. Any owner DoDestinyUpdate
    // between prepare and completion perturbs WarpState=1 alignment.
    return [];
  }

  function buildWarpCompletionUpdates(entity, stamp, options = {}) {
    const dir = normalizeVector(entity.direction, { x: 0, y: 0, z: 1 });
    const headingVelocity = scaleVector(dir, 0.01);
    const updates = [
      {
        stamp,
        payload: destiny.buildSetSpeedFractionPayload(entity.itemID, 0),
      },
      {
        stamp,
        payload: destiny.buildStopPayload(entity.itemID),
      },
      {
        stamp,
        payload: destiny.buildSetBallVelocityPayload(entity.itemID, headingVelocity),
      },
    ];
    if (options.includePosition !== false) {
      updates.splice(1, 0, {
        stamp,
        payload: destiny.buildSetBallPositionPayload(entity.itemID, entity.position),
      });
    }
    return updates;
  }

  function buildPilotWarpCompletionUpdates(entity, stamp) {
    return [
      ...buildWarpCompletionUpdates(entity, stamp, {
        includePosition: true,
      }),
      {
        stamp,
        payload: destiny.buildSetMaxSpeedPayload(entity.itemID, entity.maxVelocity),
      },
    ];
  }

  function buildWarpStartUpdates(entity, warpState, stampOverride = null, options = {}) {
    const stamp =
      stampOverride === null ? getNextStamp() : toInt(stampOverride, getNextStamp());
    const updates = tagUpdatesRequireExistingVisibility([
      buildWarpStartCommandUpdate(entity, stamp, warpState),
      buildWarpStartEffectUpdate(entity, stamp),
      {
        stamp,
        payload: destiny.buildSetBallMassivePayload(entity.itemID, false),
      },
    ]);
    if (options.includeEntityWarpIn !== false) {
      updates.splice(1, 0, buildEntityWarpInUpdate(entity, stamp, warpState));
    }
    if (magnitude(entity.velocity) > 0.5) {
      updates.push({
        stamp,
        payload: destiny.buildSetBallVelocityPayload(entity.itemID, entity.velocity),
      });
    }
    return updates;
  }

  function buildPlayerWarpInFlightAcquireUpdates(entity, warpState, stampOverride = null) {
    return buildWarpStartUpdates(entity, warpState, stampOverride, {
      includeEntityWarpIn: false,
    });
  }

  function buildSessionlessWarpInFlightAcquireUpdates(entity, warpState, stampOverride = null) {
    const stamp =
      stampOverride === null ? getNextStamp() : toInt(stampOverride, getNextStamp());
    return [
      buildEntityWarpInUpdate(entity, stamp, warpState),
    ];
  }

  return {
    buildPilotPreWarpAddBallUpdate,
    buildPilotPreWarpRebaselineUpdates,
    buildPilotWarpEgoStateRefreshUpdates,
    buildPilotWarpActivationStateRefreshUpdates,
    getNominalWarpFactor,
    getPilotWarpFactorOptionA,
    buildWarpStartCommandUpdate,
    buildWarpPrepareCommandUpdate,
    getPilotWarpPeakSpeed,
    shouldSchedulePilotWarpCruiseBump,
    getPilotWarpStartupGuidanceAtMs,
    getPilotWarpStartupGuidanceStamp,
    getPilotWarpCruiseBumpAtMs,
    getPilotWarpEffectAtMs,
    getPilotWarpCruiseBumpStamp,
    getPilotWarpEffectStamp,
    getPilotWarpActivationSeedSpeed,
    getPilotWarpActivationKickoffSpeed,
    buildPilotWarpMaxSpeedRamp,
    buildPilotWarpSeedUpdate,
    buildPilotWarpActivationKickoffUpdate,
    buildEntityWarpInUpdate,
    getPilotWarpNativeActivationSpeedFloor,
    buildWarpActivationVelocityUpdate,
    buildWarpStartVelocityCarryoverUpdate,
    primePilotWarpActivationState,
    getWatcherWarpStartStamp,
    buildWarpStartEffectUpdate,
    buildWarpPrepareDispatch,
    buildPilotWarpActivationUpdates,
    buildWarpCompletionUpdates,
    buildPilotWarpCompletionUpdates,
    buildWarpStartUpdates,
    buildPlayerWarpInFlightAcquireUpdates,
    buildSessionlessWarpInFlightAcquireUpdates,
  };
}

module.exports = {
  createMovementWarpBuilders,
};
