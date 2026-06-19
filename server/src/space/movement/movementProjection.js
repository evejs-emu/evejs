function toInt(value, fallback = 0) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.trunc(numeric);
  }
  const fallbackNumeric = Number(fallback);
  return Number.isFinite(fallbackNumeric) ? Math.trunc(fallbackNumeric) : 0;
}

function magnitude(vector) {
  const x = Number(vector && vector.x) || 0;
  const y = Number(vector && vector.y) || 0;
  const z = Number(vector && vector.z) || 0;
  return Math.sqrt((x ** 2) + (y ** 2) + (z ** 2));
}


function projectEntityForDestinyStamp(options = {}) {
  const entity = options.entity;
  const advanceMovement = options.advanceMovement;
  const cloneDynamicEntityForDestinyPresentation =
    options.cloneDynamicEntityForDestinyPresentation;
  if (
    !entity ||
    typeof advanceMovement !== "function" ||
    typeof cloneDynamicEntityForDestinyPresentation !== "function"
  ) {
    return entity;
  }

  const rawNowMs = Math.max(0, Number(options.rawNowMs) || 0);
  const targetStamp = toInt(options.stamp, 0) >>> 0;
  if (targetStamp <= 0) {
    return cloneDynamicEntityForDestinyPresentation(entity);
  }

  const projectedEntity = cloneDynamicEntityForDestinyPresentation(entity);
  const targetRawSimTimeMs = Math.max(rawNowMs, targetStamp * 1000);
  if (
    targetRawSimTimeMs <= rawNowMs + 0.000001 ||
    projectedEntity.sessionlessWarpIngress
  ) {
    return projectedEntity;
  }

  const scene =
    options.scene && typeof options.scene === "object"
      ? options.scene
      : {
          getEntityByID() {
            return null;
          },
        };
  advanceMovement(
    projectedEntity,
    scene,
    (targetRawSimTimeMs - rawNowMs) / 1000,
    targetRawSimTimeMs,
  );
  return projectedEntity;
}

function rebuildKinematicUpdatesForProjectedStamp(options = {}) {
  const updates = Array.isArray(options.updates) ? options.updates : [];
  const entity = options.entity;
  const destiny = options.destiny;
  if (
    !entity ||
    updates.length === 0 ||
    !destiny ||
    typeof destiny.buildSetBallVelocityPayload !== "function"
  ) {
    return updates;
  }

  const entityID = toInt(entity.itemID, 0);
  if (entityID <= 0) {
    return updates;
  }

  const stopVelocitySeedStamps = new Set();
  for (const update of updates) {
    const payload = update && Array.isArray(update.payload) ? update.payload : null;
    const args = payload && Array.isArray(payload[1]) ? payload[1] : null;
    if (
      !payload ||
      payload[0] !== "Stop" ||
      toInt(args && args[0], 0) !== entityID
    ) {
      continue;
    }
    stopVelocitySeedStamps.add(toInt(update && update.stamp, 0) >>> 0);
  }

  const projectedByStamp = new Map();
  let changed = false;
  const rewrittenUpdates = updates.map((update) => {
    const payload = update && Array.isArray(update.payload) ? update.payload : null;
    const args = payload && Array.isArray(payload[1]) ? payload[1] : null;
    const payloadEntityID =
      payload && payload[0] === "SetBallVelocity"
        ? toInt(args && args[0], 0)
        : 0;
    if (payloadEntityID !== entityID) {
      return update;
    }

    const stamp = toInt(update && update.stamp, 0) >>> 0;
    if (stamp <= 0) {
      return update;
    }

    let projectedEntity = projectedByStamp.get(stamp);
    if (!projectedEntity) {
      projectedEntity = projectEntityForDestinyStamp({
        entity,
        scene: options.scene,
        advanceMovement: options.advanceMovement,
        cloneDynamicEntityForDestinyPresentation:
          options.cloneDynamicEntityForDestinyPresentation,
        rawNowMs: options.rawNowMs,
        stamp,
      });
      projectedByStamp.set(stamp, projectedEntity);
    }
    const projectedVelocity = projectedEntity && projectedEntity.velocity;
    // CCP sends the ball's actual velocity at the moment of the stop
    // command — no projection, no direction substitution. Projecting
    // forward with mode=STOP pre-decelerates the speed (the client
    // hasn't started decelerating yet) and rewriting the direction to
    // entity.direction can rotate the velocity vector, both of which
    // cause visible jolts.  See `client/stop11.txt` lines 6593/6935.
    const stopSeedVelocity = stopVelocitySeedStamps.has(stamp)
      ? (
        magnitude(entity.velocity) <= 0.000001
          ? { x: 0, y: 0, z: 0 }
          : { x: entity.velocity.x, y: entity.velocity.y, z: entity.velocity.z }
      )
      : projectedVelocity;
    changed = true;
    return {
      ...update,
      payload: destiny.buildSetBallVelocityPayload(
        entityID,
        stopSeedVelocity,
      ),
    };
  });

  return changed ? rewrittenUpdates : updates;
}

const rebuildOwnerKinematicUpdatesForProjectedStamp =
  rebuildKinematicUpdatesForProjectedStamp;

module.exports = {
  projectEntityForDestinyStamp,
  rebuildKinematicUpdatesForProjectedStamp,
  rebuildOwnerKinematicUpdatesForProjectedStamp,
};
