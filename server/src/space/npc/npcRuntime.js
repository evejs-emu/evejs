const path = require("path");

const spaceRuntime = require(path.join(__dirname, "../runtime"));
const npcService = require(path.join(__dirname, "./npcService"));
const {
  ONE_AU_IN_METERS,
  findSafeWarpOriginAnchor,
} = require(path.join(__dirname, "./npcWarpOrigins"));

const NPC_WARP_VISIBILITY_SUPPRESS_MS = 250;
// Controllers should not wake on the same scene tick that completes the
// sessionless ingress. If they do, FOLLOW/ORBIT can be issued just before the
// authoritative warp-complete STOP/SetBallPosition handoff, which is exactly
// the "moves for a moment then snaps dead" behavior seen in the client logs.
// `client/crime7.txt` and `client/crime9.txt` then showed the visible-origin
// CONCORD warp still needed one more full scene beat after landing before the
// controller starts issuing pursuit orders; otherwise the ships peel away
// before the client has finished reading the arrival.
const NPC_WARP_WAKE_GRACE_TICKS = 2;
const NPC_COMMAND_WARP_INGRESS_DURATION_MS = 2_500;
const NPC_COMMAND_WARP_LANDING_RADIUS_METERS = 3_000;

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function cloneVector(vector, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: toFiniteNumber(vector && vector.x, fallback.x),
    y: toFiniteNumber(vector && vector.y, fallback.y),
    z: toFiniteNumber(vector && vector.z, fallback.z),
  };
}

function buildWarpLandingPoint(center, index = 0, total = 1, radiusMeters = NPC_COMMAND_WARP_LANDING_RADIUS_METERS) {
  const resolvedCenter = cloneVector(center);
  const divisor = Math.max(1, toPositiveInt(total, 1));
  const angle = ((Math.PI * 2) / divisor) * Math.max(0, index);
  const resolvedRadiusMeters = Math.max(0, toFiniteNumber(radiusMeters, NPC_COMMAND_WARP_LANDING_RADIUS_METERS));
  return {
    x: resolvedCenter.x + (Math.cos(angle) * resolvedRadiusMeters),
    y: resolvedCenter.y,
    z: resolvedCenter.z + (Math.sin(angle) * resolvedRadiusMeters),
  };
}

function cleanupSpawnedEntries(spawned) {
  const entries = Array.isArray(spawned) ? spawned : [];
  for (const entry of entries) {
    const entityID = toPositiveInt(entry && entry.entity && entry.entity.itemID, 0);
    if (!entityID) {
      continue;
    }
    npcService.destroyNpcControllerByEntityID(entityID, {
      removeContents: true,
    });
  }
}

function estimateNpcWarpWakeAtMs(scene, options = {}) {
  const now = scene ? scene.getCurrentSimTimeMs() : 0;
  const tickIntervalMs = Math.max(
    1,
    toFiniteNumber(scene && scene._tickIntervalMs, 1000),
  );
  return Math.max(
    now,
    toFiniteNumber(options.ingressCompleteAtMs, now),
  ) + (tickIntervalMs * NPC_WARP_WAKE_GRACE_TICKS);
}

function startManagedNpcWarp(context, point, options = {}) {
  if (!context || !context.scene || !context.entity) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const scene = context.scene;
  const visibilitySuppressMs = Math.max(
    1,
    toFiniteNumber(
      options.visibilitySuppressMs,
      NPC_WARP_VISIBILITY_SUPPRESS_MS,
    ),
  );
  const warpResult = spaceRuntime.startSessionlessWarpIngress(
    context.systemID,
    context.entityID,
    cloneVector(point),
    {
      ...options,
      // Let the shared visibility sync acquire the ship on the next scene tick
      // instead of forcing a same-tick AddBalls2 burst. That preserves an
      // actual visible arrival window and avoids the "spawned in place"
      // feeling from same-tick acquire + immediate warp-complete correction.
      acquireForRelevantSessions: options.acquireForRelevantSessions === true,
      visibilitySuppressMs,
      ingressDurationMs: Math.max(
        visibilitySuppressMs,
        toFiniteNumber(options.ingressDurationMs, visibilitySuppressMs),
      ),
    },
  );
  if (!warpResult.success || !warpResult.data) {
    return warpResult;
  }
  const wakeAtMs = estimateNpcWarpWakeAtMs(scene, {
    ingressCompleteAtMs: toFiniteNumber(
      warpResult.data.ingressCompleteAtMs,
      scene.getCurrentSimTimeMs(),
    ),
  });
  if (warpResult.data.entity) {
    warpResult.data.entity.deferNpcWarpCompletionWakeUntilMs = wakeAtMs;
  }

  return {
    success: true,
    data: {
      ...context,
      ...warpResult.data,
      ingressCompleteAtMs: wakeAtMs,
    },
  };
}

function resolveNpcContext(entityID) {
  const normalizedEntityID = toPositiveInt(entityID, 0);
  if (!normalizedEntityID) {
    return {
      success: false,
      errorMsg: "NPC_NOT_FOUND",
    };
  }

  const controller = npcService.getControllerByEntityID(normalizedEntityID);
  if (!controller) {
    return {
      success: false,
      errorMsg: "NPC_NOT_FOUND",
    };
  }

  const systemID = toPositiveInt(controller.systemID, 0);
  if (!systemID) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
    };
  }

  const scene = spaceRuntime.ensureScene(systemID);
  const entity = scene ? scene.getEntityByID(normalizedEntityID) : null;
  if (!scene || !entity) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  return {
    success: true,
    data: {
      entityID: normalizedEntityID,
      controller,
      systemID,
      scene,
      entity,
    },
  };
}

function wakeNpcController(entityID, whenMs = 0) {
  return npcService.wakeNpcController(entityID, whenMs);
}

function scheduleNpcController(entityID, whenMs = 0) {
  return npcService.scheduleNpcController(entityID, whenMs);
}

function spawnBatchForSession(session, options = {}) {
  return npcService.spawnNpcBatchForSession(session, options);
}

function spawnBatchInSystem(systemID, options = {}) {
  return npcService.spawnNpcBatchInSystem(systemID, options);
}

function spawnWarpBatchForSession(session, options = {}) {
  if (!session || !session._space) {
    return {
      success: false,
      errorMsg: "NOT_IN_SPACE",
    };
  }

  const systemID = toPositiveInt(session._space.systemID || session.solarsystemid2 || session.solarsystemid, 0);
  const shipID = toPositiveInt(session._space.shipID, 0);
  if (!systemID || !shipID) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const scene = spaceRuntime.ensureScene(systemID);
  const targetEntity = scene ? scene.getEntityByID(shipID) : null;
  if (!scene || !targetEntity) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const originAnchor = findSafeWarpOriginAnchor(scene, targetEntity, {
    clearanceMeters: Math.max(
      ONE_AU_IN_METERS,
      toFiniteNumber(options.originClearanceMeters, ONE_AU_IN_METERS),
    ),
    minDistanceMeters: toFiniteNumber(options.originMinDistanceMeters, ONE_AU_IN_METERS * 2),
    maxDistanceMeters: toFiniteNumber(options.originMaxDistanceMeters, ONE_AU_IN_METERS * 4),
    stepMeters: toFiniteNumber(options.originStepMeters, ONE_AU_IN_METERS / 2),
  });

  const spawnResult = npcService.spawnNpcBatchInSystem(systemID, {
    ...options,
    preferredTargetID: shipID,
    transient: options.transient !== false,
    broadcast: false,
    skipInitialBehaviorTick: true,
    anchorDescriptor: {
      kind: "coordinates",
      position: originAnchor.position,
      direction: originAnchor.direction,
      name: options.anchorName || "Transient NPC Warp Origin",
    },
  });
  if (!spawnResult.success || !spawnResult.data) {
    return spawnResult;
  }

  const spawned = Array.isArray(spawnResult.data.spawned)
    ? spawnResult.data.spawned.filter((entry) => entry && entry.entity)
    : [];
  if (spawned.length === 0) {
    return {
      success: false,
      errorMsg: "NPC_NATIVE_SPAWN_FAILED",
      suggestions: spawnResult.suggestions || [],
    };
  }

  for (const entry of spawned) {
    const attackResult = issueAttackOrder(
      toPositiveInt(entry.entity && entry.entity.itemID, 0),
      shipID,
      {
        keepLock: true,
      },
    );
    if (!attackResult.success) {
      cleanupSpawnedEntries(spawned);
      return attackResult;
    }
  }

  const landingRadiusMeters = Math.max(
    0,
    toFiniteNumber(
      options.landingRadiusMeters,
      NPC_COMMAND_WARP_LANDING_RADIUS_METERS,
    ),
  );
  const warpRequests = spawned.map((entry, index) => ({
    entityID: toPositiveInt(entry.entity && entry.entity.itemID, 0),
    point: buildWarpLandingPoint(
      targetEntity.position,
      index,
      spawned.length,
      landingRadiusMeters,
    ),
    options: {
      forceImmediateStart: true,
      broadcastWarpStartToVisibleSessions: true,
      targetEntityID: shipID,
      ingressDurationMs: Math.max(
        NPC_WARP_VISIBILITY_SUPPRESS_MS,
        toFiniteNumber(
          options.ingressDurationMs,
          NPC_COMMAND_WARP_INGRESS_DURATION_MS,
        ),
      ),
      visibilitySuppressMs: Math.max(
        1,
        toFiniteNumber(
          options.visibilitySuppressMs,
          NPC_WARP_VISIBILITY_SUPPRESS_MS,
        ),
      ),
      warpSpeedAU: toFiniteNumber(options.warpSpeedAU, 0) > 0
        ? toFiniteNumber(options.warpSpeedAU, 0)
        : undefined,
    },
  }));
  const warpResult = warpBatchToPoints(warpRequests, {
    groupWake: true,
  });
  if (!warpResult.success || !warpResult.data) {
    cleanupSpawnedEntries(spawned);
    return warpResult;
  }

  return {
    success: true,
    data: {
      ...spawnResult.data,
      originAnchor,
      warpBatch: warpResult.data,
      targetEntityID: shipID,
    },
    suggestions: spawnResult.suggestions || [],
  };
}

function spawnNpcForSession(session, options = {}) {
  return npcService.spawnNpcForSession(session, options);
}

function spawnConcordBatchForSession(session, options = {}) {
  return npcService.spawnConcordBatchForSession(session, options);
}

function spawnConcordForSession(session, options = {}) {
  return npcService.spawnConcordForSession(session, options);
}

function spawnGroupInSystem(systemID, options = {}) {
  return npcService.spawnNpcGroupInSystem(systemID, options);
}

function spawnSite(siteQuery, options = {}) {
  return npcService.spawnNpcSite(siteQuery, options);
}

function issueOrder(entityID, order) {
  return npcService.issueManualOrder(entityID, order);
}

function issueAttackOrder(entityID, targetID, options = {}) {
  return issueOrder(entityID, {
    type: "attack",
    targetID: toPositiveInt(targetID, 0),
    allowWeapons: options.allowWeapons !== false,
    keepLock: options.keepLock !== false,
    allowPodKill: options.allowPodKill === true,
  });
}

function holdFire(entityID) {
  return issueOrder(entityID, {
    type: "holdFire",
  });
}

function resumeBehavior(entityID) {
  return issueOrder(entityID, {
    type: "resumeBehavior",
  });
}

function stop(entityID, options = {}) {
  const contextResult = resolveNpcContext(entityID);
  if (!contextResult.success || !contextResult.data) {
    return contextResult;
  }

  const ok = spaceRuntime.stopDynamicEntity(
    contextResult.data.systemID,
    contextResult.data.entityID,
    {
      ...options,
      allowSessionlessWarpAbort: options.allowSessionlessWarpAbort !== false,
      reason: options.reason || "npcStop",
    },
  );
  if (!ok) {
    return {
      success: false,
      errorMsg: "NPC_STOP_FAILED",
    };
  }

  if (options.issueStopOrder !== false) {
    const orderResult = npcService.issueManualOrder(entityID, {
      type: "stop",
    });
    if (!orderResult.success) {
      return orderResult;
    }
  } else if (options.wakeController !== false) {
    npcService.wakeNpcController(entityID, 0);
  }

  return {
    success: true,
    data: contextResult.data,
  };
}

function follow(entityID, targetEntityID, range = 0, options = {}) {
  const contextResult = resolveNpcContext(entityID);
  if (!contextResult.success || !contextResult.data) {
    return contextResult;
  }

  const ok = spaceRuntime.followDynamicEntity(
    contextResult.data.systemID,
    contextResult.data.entityID,
    toPositiveInt(targetEntityID, 0),
    toFiniteNumber(range, 0),
    options,
  );
  if (!ok) {
    return {
      success: false,
      errorMsg: "NPC_FOLLOW_FAILED",
    };
  }

  if (options.wakeController !== false) {
    npcService.wakeNpcController(entityID, 0);
  }

  return {
    success: true,
    data: contextResult.data,
  };
}

function orbit(entityID, targetEntityID, distance, options = {}) {
  const contextResult = resolveNpcContext(entityID);
  if (!contextResult.success || !contextResult.data) {
    return contextResult;
  }

  const ok = spaceRuntime.orbitDynamicEntity(
    contextResult.data.systemID,
    contextResult.data.entityID,
    toPositiveInt(targetEntityID, 0),
    toFiniteNumber(distance, 0),
    options,
  );
  if (!ok) {
    return {
      success: false,
      errorMsg: "NPC_ORBIT_FAILED",
    };
  }

  if (options.wakeController !== false) {
    npcService.wakeNpcController(entityID, 0);
  }

  return {
    success: true,
    data: contextResult.data,
  };
}

function warpToPoint(entityID, point, options = {}) {
  const contextResult = resolveNpcContext(entityID);
  if (!contextResult.success || !contextResult.data) {
    return contextResult;
  }

  const warpResult = startManagedNpcWarp(
    contextResult.data,
    point,
    options,
  );
  if (!warpResult.success || !warpResult.data) {
    return warpResult;
  }

  if (options.scheduleWake !== false) {
    npcService.scheduleNpcController(
      entityID,
      toFiniteNumber(
        warpResult.data.ingressCompleteAtMs,
        contextResult.data.scene.getCurrentSimTimeMs(),
      ),
    );
  }

  return {
    success: true,
    data: {
      ...contextResult.data,
      ...warpResult.data,
    },
  };
}

function warpToEntity(entityID, targetEntityID, options = {}) {
  const contextResult = resolveNpcContext(entityID);
  if (!contextResult.success || !contextResult.data) {
    return contextResult;
  }

  const targetEntity = contextResult.data.scene.getEntityByID(
    toPositiveInt(targetEntityID, 0),
  );
  if (!targetEntity) {
    return {
      success: false,
      errorMsg: "TARGET_NOT_FOUND",
    };
  }

  return warpToPoint(entityID, targetEntity.position, {
    ...options,
    targetEntityID: toPositiveInt(targetEntityID, 0),
  });
}

function warpBatchToPoints(requests, options = {}) {
  const normalizedRequests = Array.isArray(requests)
    ? requests.filter((request) => (
      request &&
      toPositiveInt(request.entityID, 0) > 0 &&
      request.point &&
      typeof request.point === "object"
    ))
    : [];
  if (normalizedRequests.length === 0) {
    return {
      success: false,
      errorMsg: "NPC_WARP_BATCH_EMPTY",
    };
  }

  const results = [];
  let commonWakeAtMs = 0;

  for (const request of normalizedRequests) {
    const contextResult = resolveNpcContext(request.entityID);
    if (!contextResult.success || !contextResult.data) {
      return contextResult;
    }

    const requestOptions = {
      ...options,
      ...(request.options || {}),
      scheduleWake: false,
    };
    const warpResult = startManagedNpcWarp(
      contextResult.data,
      request.point,
      requestOptions,
    );
    if (!warpResult.success || !warpResult.data) {
      return warpResult;
    }

    const resultEntry = {
      ...contextResult.data,
      ...warpResult.data,
    };
    results.push(resultEntry);
    commonWakeAtMs = Math.max(
      commonWakeAtMs,
      toFiniteNumber(
        warpResult.data.ingressCompleteAtMs,
        contextResult.data.scene.getCurrentSimTimeMs(),
      ),
    );
  }

  if (options.scheduleWake !== false) {
    const groupedWake = options.groupWake !== false;
    for (const resultEntry of results) {
      npcService.scheduleNpcController(
        resultEntry.entityID,
        groupedWake
          ? commonWakeAtMs
          : toFiniteNumber(
            resultEntry.ingressCompleteAtMs,
            commonWakeAtMs,
          ),
      );
    }
  }

  return {
    success: true,
    data: {
      results,
      commonWakeAtMs,
    },
  };
}

function despawn(entityID, options = {}) {
  return npcService.destroyNpcControllerByEntityID(entityID, options);
}

module.exports = {
  resolveNpcContext,
  wakeNpcController,
  scheduleNpcController,
  spawnBatchForSession,
  spawnBatchInSystem,
  spawnWarpBatchForSession,
  spawnNpcForSession,
  spawnConcordBatchForSession,
  spawnConcordForSession,
  spawnGroupInSystem,
  spawnSite,
  issueOrder,
  issueAttackOrder,
  holdFire,
  resumeBehavior,
  stop,
  follow,
  orbit,
  warpToPoint,
  warpToEntity,
  warpBatchToPoints,
  despawn,
};
