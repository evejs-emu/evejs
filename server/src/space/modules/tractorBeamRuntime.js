const path = require("path");

const destiny = require(path.join(__dirname, "../destiny"));
const {
  getAttributeIDByNames,
} = require(path.join(__dirname, "../../services/fitting/liveFittingState"));
const {
  buildLiveModuleAttributeMap,
} = require(path.join(__dirname, "./liveModuleAttributes"));

const ATTRIBUTE_CAPACITOR_NEED = getAttributeIDByNames("capacitorNeed") || 6;
const ATTRIBUTE_DURATION = getAttributeIDByNames("duration") || 73;
const ATTRIBUTE_SPEED = getAttributeIDByNames("speed") || 51;
const ATTRIBUTE_MAX_RANGE = getAttributeIDByNames("maxRange") || 54;
const ATTRIBUTE_MAX_TRACTOR_VELOCITY = getAttributeIDByNames("maxTractorVelocity") || 1045;
const ATTRIBUTE_MAX_GROUP_ACTIVE = getAttributeIDByNames("maxGroupActive") || 763;
const ATTRIBUTE_REACTIVATION_DELAY =
  getAttributeIDByNames("moduleReactivationDelay", "reactivationDelay") || 669;
const PERSISTENT_SPECIAL_FX_WINDOW_MS = 12 * 60 * 60 * 1000;
const TRACTORABLE_ENTITY_KINDS = new Set(["container", "wreck"]);
const DEFAULT_TRACTOR_HOLD_DISTANCE_METERS = 2500;
const TRACTOR_PERSIST_INTERVAL_MS = 1000;
// Michelle integrates tractor pulls smoothly once the wreck has a velocity
// seed. Re-sending velocity multiple times inside the same destiny stamp, or
// rebasing position on every correction window, makes the pull look like a
// teleport ladder instead of a continuous glide.
const TRACTOR_VELOCITY_DELTA_EPSILON_METERS_PER_SECOND = 1;
const TRACTOR_VELOCITY_REBROADCAST_EPSILON_METERS_PER_SECOND = 25;
const TRACTOR_HOLD_DISTANCE_HYSTERESIS_METERS = 25;
const TRACTOR_SETTLE_LEAD_DESTINY_STAMPS = 1;
const TRACTOR_GOTO_RETARGET_EPSILON_METERS = 25;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function roundNumber(value, digits = 6) {
  return Number(toFiniteNumber(value, 0).toFixed(digits));
}

function cloneVector(source = null, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: toFiniteNumber(source && source.x, fallback.x),
    y: toFiniteNumber(source && source.y, fallback.y),
    z: toFiniteNumber(source && source.z, fallback.z),
  };
}

function subtractVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0),
  };
}

function addVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) + toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) + toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) + toFiniteNumber(right && right.z, 0),
  };
}

function scaleVector(vector, scalar) {
  return {
    x: toFiniteNumber(vector && vector.x, 0) * scalar,
    y: toFiniteNumber(vector && vector.y, 0) * scalar,
    z: toFiniteNumber(vector && vector.z, 0) * scalar,
  };
}

function magnitude(vector) {
  return Math.sqrt(
    (toFiniteNumber(vector && vector.x, 0) ** 2) +
    (toFiniteNumber(vector && vector.y, 0) ** 2) +
    (toFiniteNumber(vector && vector.z, 0) ** 2),
  );
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const length = magnitude(vector);
  if (!Number.isFinite(length) || length <= 0) {
    return cloneVector(fallback);
  }
  return scaleVector(vector, 1 / length);
}

function resolvePersistentRepeat(durationMs) {
  const cycleMs = Math.max(1, toFiniteNumber(durationMs, 1000));
  return Math.max(1, Math.ceil(PERSISTENT_SPECIAL_FX_WINDOW_MS / cycleMs));
}

function normalizeEffectName(effectRecord) {
  return String(effectRecord && effectRecord.name || "").trim();
}

function vectorsDiffer(left, right, epsilon = TRACTOR_VELOCITY_DELTA_EPSILON_METERS_PER_SECOND) {
  return magnitude(subtractVectors(left, right)) > Math.max(0, toFiniteNumber(epsilon, 0));
}

function pointsDiffer(left, right, epsilon = TRACTOR_GOTO_RETARGET_EPSILON_METERS) {
  return magnitude(subtractVectors(left, right)) > Math.max(0, toFiniteNumber(epsilon, 0));
}

function buildTractorHoldPosition(
  sourceEntity,
  targetEntity,
  movementDirection,
  holdDistanceMeters,
) {
  const sourceRadius = Math.max(0, toFiniteNumber(sourceEntity && sourceEntity.radius, 0));
  const targetRadius = Math.max(0, toFiniteNumber(targetEntity && targetEntity.radius, 0));
  const centerDistanceMeters = Math.max(0, toFiniteNumber(holdDistanceMeters, 0)) +
    sourceRadius +
    targetRadius;
  return addVectors(
    sourceEntity.position,
    scaleVector(movementDirection, -centerDistanceMeters),
  );
}

function isTractorableTarget(targetEntity) {
  return Boolean(
    targetEntity &&
    TRACTORABLE_ENTITY_KINDS.has(String(targetEntity.kind || "").trim()),
  );
}

function resolveTractorBeamActivation({
  scene,
  entity,
  moduleItem,
  effectRecord,
  chargeItem = null,
  shipItem,
  skillMap = null,
  fittedItems = null,
  activeModuleContexts = null,
  options = {},
  callbacks = {},
} = {}) {
  if (normalizeEffectName(effectRecord) !== "tractorBeamCan") {
    return { matched: false };
  }

  if (!scene || !entity || !moduleItem || !shipItem) {
    return {
      matched: true,
      success: false,
      errorMsg: "UNSUPPORTED_MODULE",
    };
  }

  const normalizedTargetID = toInt(options.targetID, 0);
  if (normalizedTargetID <= 0) {
    return {
      matched: true,
      success: false,
      errorMsg: "TARGET_REQUIRED",
    };
  }

  const targetEntity = scene.getEntityByID(normalizedTargetID);
  if (!isTractorableTarget(targetEntity)) {
    return {
      matched: true,
      success: false,
      errorMsg: "TARGET_NOT_FOUND",
    };
  }

  const moduleAttributes = buildLiveModuleAttributeMap(
    shipItem,
    moduleItem,
    chargeItem,
    skillMap,
    fittedItems,
    activeModuleContexts,
  );
  if (!moduleAttributes) {
    return {
      matched: true,
      success: false,
      errorMsg: "UNSUPPORTED_MODULE",
    };
  }

  const maxRangeMeters = Math.max(
    0,
    roundNumber(toFiniteNumber(moduleAttributes[ATTRIBUTE_MAX_RANGE], 0), 3),
  );
  const surfaceDistance = callbacks.getEntitySurfaceDistance
    ? callbacks.getEntitySurfaceDistance(entity, targetEntity)
    : 0;
  if (surfaceDistance > maxRangeMeters + 1) {
    return {
      matched: true,
      success: false,
      errorMsg: "TARGET_OUT_OF_RANGE",
    };
  }

  const rawDurationMs = toFiniteNumber(
    moduleAttributes[ATTRIBUTE_DURATION],
    moduleAttributes[ATTRIBUTE_SPEED],
  );
  const durationAttributeID =
    toFiniteNumber(moduleAttributes[ATTRIBUTE_DURATION], 0) > 0
      ? ATTRIBUTE_DURATION
      : ATTRIBUTE_SPEED;

  return {
    matched: true,
    success: true,
    data: {
      targetEntity,
      runtimeAttrs: {
        capNeed: Math.max(
          0,
          roundNumber(toFiniteNumber(moduleAttributes[ATTRIBUTE_CAPACITOR_NEED], 0), 6),
        ),
        durationMs: Math.max(1, roundNumber(rawDurationMs, 3)),
        durationAttributeID,
        reactivationDelayMs: Math.max(
          0,
          roundNumber(toFiniteNumber(moduleAttributes[ATTRIBUTE_REACTIVATION_DELAY], 0), 3),
        ),
        maxGroupActive: Math.max(0, toInt(moduleAttributes[ATTRIBUTE_MAX_GROUP_ACTIVE], 0)),
        weaponFamily: null,
        attributeOverrides: {
          ...moduleAttributes,
        },
      },
      effectStatePatch: {
        tractorBeamEffect: true,
        tractorBeamRangeMeters: maxRangeMeters,
        tractorBeamVelocityMetersPerSecond: Math.max(
          0,
          roundNumber(toFiniteNumber(moduleAttributes[ATTRIBUTE_MAX_TRACTOR_VELOCITY], 0), 3),
        ),
        tractorBeamHoldDistanceMeters: DEFAULT_TRACTOR_HOLD_DISTANCE_METERS,
        forceFreshAcquireSpecialFxReplay: true,
        repeat: resolvePersistentRepeat(rawDurationMs),
      },
    },
  };
}

function stopTractorTarget(scene, targetEntity, nowMs, options = {}) {
  if (!scene || !targetEntity) {
    return false;
  }

  const effectState = options.effectState || null;
  const restoreMaxVelocity = Math.max(
    0,
    toFiniteNumber(
      effectState && effectState.tractorBeamOriginalMaxVelocity,
      targetEntity.maxVelocity,
    ),
  );
  targetEntity.maxVelocity = restoreMaxVelocity;
  targetEntity.speedFraction = 0;
  targetEntity.mode = "STOP";
  targetEntity.targetPoint = cloneVector(targetEntity.position);
  targetEntity.velocity = { x: 0, y: 0, z: 0 };
  const stamp = scene.getMovementStamp(nowMs);
  const updates = [];
  const restoreSpeedUpdateNeeded =
    effectState && effectState.tractorBeamPresentationPrimed === true;
  if (restoreSpeedUpdateNeeded) {
    updates.push({
      stamp,
      payload: destiny.buildSetMaxSpeedPayload(targetEntity.itemID, restoreMaxVelocity),
    });
    updates.push({
      stamp,
      payload: destiny.buildSetSpeedFractionPayload(targetEntity.itemID, 0),
    });
    effectState.tractorBeamPresentationPrimed = false;
    effectState.lastTractorGotoPoint = null;
    effectState.lastTractorGotoStamp = 0;
  }
  if (options.includePosition === true) {
    updates.push({
      stamp,
      payload: destiny.buildSetBallPositionPayload(targetEntity.itemID, targetEntity.position),
    });
  }
  updates.push(
    {
      stamp,
      payload: destiny.buildSetBallVelocityPayload(targetEntity.itemID, targetEntity.velocity),
    },
    {
      stamp,
      payload: destiny.buildStopPayload(targetEntity.itemID),
    },
  );
  scene.broadcastMovementUpdates(updates);
  if (options.persist !== false && typeof options.persistDynamicEntity === "function") {
    options.persistDynamicEntity(targetEntity);
  }
  return true;
}

function handleTractorBeamDeactivation(scene, effectState, nowMs, options = {}) {
  if (!scene || !effectState) {
    return false;
  }
  const targetEntity = scene.getEntityByID(toInt(effectState.targetID, 0));
  if (!targetEntity) {
    return false;
  }
  return stopTractorTarget(scene, targetEntity, nowMs, {
    ...options,
    effectState,
    includePosition: false,
  });
}

function executeTractorBeamCycle({
  scene,
  entity,
  effectState,
  callbacks = {},
} = {}) {
  if (!scene || !entity || !effectState) {
    return {
      success: false,
      stopReason: "module",
    };
  }

  const targetEntity = scene.getEntityByID(toInt(effectState.targetID, 0));
  if (!isTractorableTarget(targetEntity)) {
    return {
      success: false,
      errorMsg: "TARGET_NOT_FOUND",
      stopReason: "target",
    };
  }

  const surfaceDistance = callbacks.getEntitySurfaceDistance
    ? callbacks.getEntitySurfaceDistance(entity, targetEntity)
    : 0;
  if (surfaceDistance > Math.max(0, toFiniteNumber(effectState.tractorBeamRangeMeters, 0)) + 1) {
    return {
      success: false,
      errorMsg: "TARGET_OUT_OF_RANGE",
      stopReason: "target",
    };
  }

  return {
    success: true,
    data: {
      targetEntity,
    },
  };
}

function tickScene(scene, nowMs, options = {}) {
  if (!scene) {
    return;
  }

  const callbacks = options && typeof options === "object" ? options : {};
  for (const sourceEntity of scene.dynamicEntities.values()) {
    if (!sourceEntity || !(sourceEntity.activeModuleEffects instanceof Map)) {
      continue;
    }

    for (const effectState of sourceEntity.activeModuleEffects.values()) {
      if (!effectState || effectState.tractorBeamEffect !== true) {
        continue;
      }

      const targetEntity = scene.getEntityByID(toInt(effectState.targetID, 0));
      if (!isTractorableTarget(targetEntity)) {
        continue;
      }

      const stamp = scene.getMovementStamp(nowMs);

      const lastTickAtMs = Math.max(
        0,
        toFiniteNumber(effectState.lastTractorTickAtMs, nowMs),
      );
      const deltaMs = Math.max(0, toFiniteNumber(nowMs, 0) - lastTickAtMs);
      effectState.lastTractorTickAtMs = nowMs;
      if (deltaMs <= 0) {
        continue;
      }

      const surfaceDistance = callbacks.getEntitySurfaceDistance
        ? callbacks.getEntitySurfaceDistance(sourceEntity, targetEntity)
        : 0;
      const holdDistanceMeters = Math.max(
        0,
        toFiniteNumber(effectState.tractorBeamHoldDistanceMeters, DEFAULT_TRACTOR_HOLD_DISTANCE_METERS),
      );
      const settleDistanceMeters = holdDistanceMeters + TRACTOR_HOLD_DISTANCE_HYSTERESIS_METERS;
      const pendingTractorStopStamp = toInt(effectState.pendingTractorStopStamp, 0);
      const tractorSpeedMetersPerSecond = Math.max(
        0,
        toFiniteNumber(effectState.tractorBeamVelocityMetersPerSecond, 0),
      );
      const baseTargetMaxVelocity = Math.max(0, toFiniteNumber(targetEntity.maxVelocity, 0));
      const currentHoldDirection = normalizeVector(
        subtractVectors(sourceEntity.position, targetEntity.position),
        targetEntity.direction || sourceEntity.direction || { x: 1, y: 0, z: 0 },
      );
      const currentHoldPosition = buildTractorHoldPosition(
        sourceEntity,
        targetEntity,
        currentHoldDirection,
        holdDistanceMeters,
      );
      if (surfaceDistance <= settleDistanceMeters) {
        targetEntity.direction = currentHoldDirection;
        targetEntity.targetPoint = cloneVector(currentHoldPosition);
        targetEntity.maxVelocity = tractorSpeedMetersPerSecond;
        targetEntity.speedFraction = 1;
        targetEntity.mode = "GOTO";

        if (pendingTractorStopStamp <= 0 && effectState.tractorBeamSettled !== true) {
          effectState.pendingTractorStopStamp =
            (stamp + TRACTOR_SETTLE_LEAD_DESTINY_STAMPS) >>> 0;
          effectState.tractorBeamSettled = true;
        }

        const settleUpdates = [];
        const shouldPrimePresentation =
          effectState.tractorBeamPresentationPrimed !== true ||
          pointsDiffer(effectState.lastTractorGotoPoint, currentHoldPosition) ||
          toInt(effectState.lastTractorGotoStamp, 0) !== stamp;
        if (shouldPrimePresentation) {
          if (effectState.tractorBeamPresentationPrimed !== true) {
            effectState.tractorBeamOriginalMaxVelocity = Math.max(
              0,
              toFiniteNumber(effectState.tractorBeamOriginalMaxVelocity, baseTargetMaxVelocity),
            );
            settleUpdates.push({
              stamp,
              payload: destiny.buildSetMaxSpeedPayload(
                targetEntity.itemID,
                tractorSpeedMetersPerSecond,
              ),
            });
            settleUpdates.push({
              stamp,
              payload: destiny.buildSetSpeedFractionPayload(targetEntity.itemID, 1),
            });
          }
          settleUpdates.push({
            stamp,
            payload: destiny.buildGotoPointPayload(targetEntity.itemID, currentHoldPosition),
          });
          effectState.tractorBeamPresentationPrimed = true;
          effectState.lastTractorGotoPoint = cloneVector(currentHoldPosition);
          effectState.lastTractorGotoStamp = stamp;
        }
        if (settleUpdates.length > 0) {
          scene.broadcastMovementUpdates(settleUpdates);
        }

        if (pendingTractorStopStamp > 0 && stamp >= pendingTractorStopStamp) {
          stopTractorTarget(scene, targetEntity, nowMs, {
            ...callbacks,
            effectState,
            includePosition: false,
          });
          effectState.pendingTractorStopStamp = 0;
          effectState.tractorBeamSettled = true;
          effectState.lastTractorPositionBroadcastAtMs = nowMs;
          effectState.lastTractorVelocityBroadcastAtMs = nowMs;
          effectState.lastTractorVelocityBroadcastStamp = stamp;
          effectState.lastTractorBroadcastVelocity = cloneVector(targetEntity.velocity);
        }
        continue;
      }
      effectState.pendingTractorStopStamp = 0;
      effectState.tractorBeamSettled = false;

      const maxRangeMeters = Math.max(0, toFiniteNumber(effectState.tractorBeamRangeMeters, 0));
      if (surfaceDistance > maxRangeMeters + 1) {
        continue;
      }

      const moveDistanceMeters = Math.min(
        surfaceDistance - holdDistanceMeters,
        Math.max(0, toFiniteNumber(effectState.tractorBeamVelocityMetersPerSecond, 0)) *
          (deltaMs / 1000),
      );
      if (moveDistanceMeters <= 0) {
        continue;
      }

      const movementDirection = normalizeVector(
        subtractVectors(sourceEntity.position, targetEntity.position),
        targetEntity.direction || sourceEntity.direction || { x: 1, y: 0, z: 0 },
      );
      const holdPosition = buildTractorHoldPosition(
        sourceEntity,
        targetEntity,
        movementDirection,
        holdDistanceMeters,
      );
      const previousPosition = cloneVector(targetEntity.position);
      const previousBubbleID = toInt(targetEntity.bubbleID, 0);
      const previousPublicGridClusterKey = targetEntity.publicGridClusterKey || null;

      targetEntity.position = addVectors(
        targetEntity.position,
        scaleVector(movementDirection, moveDistanceMeters),
      );
      targetEntity.direction = movementDirection;
      targetEntity.velocity = scaleVector(
        movementDirection,
        tractorSpeedMetersPerSecond,
      );
      targetEntity.targetPoint = cloneVector(holdPosition);
      if (effectState.tractorBeamPresentationPrimed !== true) {
        effectState.tractorBeamOriginalMaxVelocity = Math.max(
          0,
          baseTargetMaxVelocity,
        );
      }
      targetEntity.maxVelocity = tractorSpeedMetersPerSecond;
      targetEntity.speedFraction = 1;
      targetEntity.mode = "GOTO";

      scene.reconcileEntityPublicGrid(targetEntity);
      scene.reconcileEntityBubble(targetEntity);
      scene.publicGridCompositionDirty = true;
      scene.ensurePublicGridComposition();

      const visibilityChanged =
        toInt(targetEntity.bubbleID, 0) !== previousBubbleID ||
        (targetEntity.publicGridClusterKey || null) !== previousPublicGridClusterKey;
      if (visibilityChanged) {
        scene.syncDynamicVisibilityForAllSessions(nowMs, {
          stampOverride: stamp,
        });
      }
      const lastVelocityBroadcastStamp = toInt(
        effectState.lastTractorVelocityBroadcastStamp,
        -1,
      );
      const firstVelocitySeed = !effectState.lastTractorBroadcastVelocity;
      const movementUpdates = [];
      const shouldPrimePresentation =
        visibilityChanged ||
        effectState.tractorBeamPresentationPrimed !== true ||
        pointsDiffer(effectState.lastTractorGotoPoint, holdPosition) ||
        toInt(effectState.lastTractorGotoStamp, 0) !== stamp;
      if (shouldPrimePresentation) {
        if (effectState.tractorBeamPresentationPrimed !== true) {
          movementUpdates.push({
            stamp,
            payload: destiny.buildSetMaxSpeedPayload(
              targetEntity.itemID,
              tractorSpeedMetersPerSecond,
            ),
          });
          movementUpdates.push({
            stamp,
            payload: destiny.buildSetSpeedFractionPayload(targetEntity.itemID, 1),
          });
        }
        movementUpdates.push({
          stamp,
          payload: destiny.buildGotoPointPayload(targetEntity.itemID, holdPosition),
        });
        effectState.tractorBeamPresentationPrimed = true;
        effectState.lastTractorGotoPoint = cloneVector(holdPosition);
        effectState.lastTractorGotoStamp = stamp;
      }
      const shouldBroadcastPosition = visibilityChanged || firstVelocitySeed;
      if (shouldBroadcastPosition) {
        effectState.lastTractorPositionBroadcastAtMs = nowMs;
        movementUpdates.push({
          stamp,
          payload: destiny.buildSetBallPositionPayload(
            targetEntity.itemID,
            firstVelocitySeed && !visibilityChanged
              ? previousPosition
              : targetEntity.position,
          ),
        });
      }

      const shouldBroadcastVelocity =
        visibilityChanged ||
        firstVelocitySeed ||
        lastVelocityBroadcastStamp !== stamp ||
        vectorsDiffer(
          targetEntity.velocity,
          effectState.lastTractorBroadcastVelocity,
          TRACTOR_VELOCITY_REBROADCAST_EPSILON_METERS_PER_SECOND,
        );
      if (shouldBroadcastVelocity) {
        effectState.lastTractorVelocityBroadcastAtMs = nowMs;
        effectState.lastTractorVelocityBroadcastStamp = stamp;
        effectState.lastTractorBroadcastVelocity = cloneVector(targetEntity.velocity);
        movementUpdates.push({
          stamp,
          payload: destiny.buildSetBallVelocityPayload(targetEntity.itemID, targetEntity.velocity),
        });
      }

      if (movementUpdates.length > 0) {
        scene.broadcastMovementUpdates(movementUpdates);
      }

      if (
        callbacks.persistDynamicEntity &&
        (
          !Number.isFinite(Number(effectState.lastTractorPersistAtMs)) ||
          (nowMs - Number(effectState.lastTractorPersistAtMs)) >= TRACTOR_PERSIST_INTERVAL_MS
        )
      ) {
        effectState.lastTractorPersistAtMs = nowMs;
        callbacks.persistDynamicEntity(targetEntity);
      }
    }
  }
}

module.exports = {
  resolveTractorBeamActivation,
  executeTractorBeamCycle,
  tickScene,
  handleTractorBeamDeactivation,
};
