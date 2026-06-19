function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneVector(source = null, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: toFiniteNumber(source && source.x, fallback.x),
    y: toFiniteNumber(source && source.y, fallback.y),
    z: toFiniteNumber(source && source.z, fallback.z),
  };
}

function addVectors(left, right) {
  const resolvedLeft = cloneVector(left);
  const resolvedRight = cloneVector(right);
  return {
    x: resolvedLeft.x + resolvedRight.x,
    y: resolvedLeft.y + resolvedRight.y,
    z: resolvedLeft.z + resolvedRight.z,
  };
}

function scaleVector(vector, scalar) {
  const resolved = cloneVector(vector);
  const resolvedScalar = toFiniteNumber(scalar, 0);
  return {
    x: resolved.x * resolvedScalar,
    y: resolved.y * resolvedScalar,
    z: resolved.z * resolvedScalar,
  };
}

function subtractVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0),
  };
}

function crossVectors(left, right) {
  return {
    x: (toFiniteNumber(left && left.y, 0) * toFiniteNumber(right && right.z, 0)) -
      (toFiniteNumber(left && left.z, 0) * toFiniteNumber(right && right.y, 0)),
    y: (toFiniteNumber(left && left.z, 0) * toFiniteNumber(right && right.x, 0)) -
      (toFiniteNumber(left && left.x, 0) * toFiniteNumber(right && right.z, 0)),
    z: (toFiniteNumber(left && left.x, 0) * toFiniteNumber(right && right.y, 0)) -
      (toFiniteNumber(left && left.y, 0) * toFiniteNumber(right && right.x, 0)),
  };
}

function magnitude(vector) {
  const resolved = cloneVector(vector);
  return Math.sqrt((resolved.x ** 2) + (resolved.y ** 2) + (resolved.z ** 2));
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const resolved = cloneVector(vector, fallback);
  const length = magnitude(resolved);
  if (!Number.isFinite(length) || length <= 0) {
    return cloneVector(fallback, { x: 1, y: 0, z: 0 });
  }
  return {
    x: resolved.x / length,
    y: resolved.y / length,
    z: resolved.z / length,
  };
}

function distanceBetweenVectors(left, right) {
  return magnitude(subtractVectors(left, right));
}

function buildFormationBasis(direction) {
  const forward = normalizeVector(direction, { x: 1, y: 0, z: 0 });
  const upReference = Math.abs(toFiniteNumber(forward.y, 0)) >= 0.95
    ? { x: 1, y: 0, z: 0 }
    : { x: 0, y: 1, z: 0 };
  const right = normalizeVector(
    crossVectors(forward, upReference),
    { x: 0, y: 0, z: 1 },
  );
  const up = normalizeVector(crossVectors(right, forward), upReference);
  return { forward, right, up };
}

const path = require("path");
const nativeNpcStore = require(path.join(__dirname, "../space/npc/nativeNpcStore"));

function uniqueCandidates(values = []) {
  const seen = new Set();
  const resolved = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    resolved.push(normalized);
  }
  return resolved;
}

function buildNpcPseudoSession(entity) {
  return {
    characterID: toInt(
      entity && (
        entity.pilotCharacterID ??
        entity.characterID
      ),
      0,
    ),
    corporationID: toInt(entity && entity.corporationID, 0),
    allianceID: toInt(entity && entity.allianceID, 0),
    _space: {
      systemID: toInt(entity && entity.systemID, 0),
      shipID: toInt(entity && entity.itemID, 0),
    },
  };
}

function getSurfaceDistance(scene, entity, targetEntity) {
  if (
    scene &&
    typeof scene.getEntitySurfaceDistance === "function"
  ) {
    return Math.max(
      0,
      toFiniteNumber(scene.getEntitySurfaceDistance(entity, targetEntity), 0),
    );
  }
  const left = entity && entity.position || { x: 0, y: 0, z: 0 };
  const right = targetEntity && targetEntity.position || { x: 0, y: 0, z: 0 };
  const dx = toFiniteNumber(right.x, 0) - toFiniteNumber(left.x, 0);
  const dy = toFiniteNumber(right.y, 0) - toFiniteNumber(left.y, 0);
  const dz = toFiniteNumber(right.z, 0) - toFiniteNumber(left.z, 0);
  const centerDistance = Math.sqrt((dx ** 2) + (dy ** 2) + (dz ** 2));
  return Math.max(
    0,
    centerDistance -
      toFiniteNumber(entity && entity.radius, 0) -
      toFiniteNumber(targetEntity && targetEntity.radius, 0),
  );
}

function resolveControllerTargetEntity(scene, controller, entry, candidate) {
  const normalizedCandidate = String(candidate || "").trim();
  if (!scene || !controller || !normalizedCandidate) {
    return null;
  }

  if (normalizedCandidate === "player") {
    const playerEntity = scene.getEntityByID(toInt(controller.ownerShipID, 0));
    if (
      playerEntity &&
      playerEntity.kind === "ship" &&
      toInt(playerEntity.itemID, 0) !== toInt(entry && entry.entityID, 0)
    ) {
      return playerEntity;
    }
    return null;
  }

  const targetEntry = Array.isArray(controller.entries)
    ? controller.entries.find((candidateEntry) => (
      String(candidateEntry && candidateEntry.key || "") === normalizedCandidate
    ))
    : null;
  if (!targetEntry) {
    return null;
  }

  const targetEntity = scene.getEntityByID(toInt(targetEntry.entityID, 0));
  if (
    !targetEntity ||
    targetEntity.kind !== "ship" ||
    toInt(targetEntity.itemID, 0) === toInt(entry && entry.entityID, 0)
  ) {
    return null;
  }
  return targetEntity;
}

function resolveFirstTargetEntity(scene, controller, entry, candidates = []) {
  for (const candidate of uniqueCandidates(candidates)) {
    const targetEntity = resolveControllerTargetEntity(
      scene,
      controller,
      entry,
      candidate,
    );
    if (targetEntity) {
      return targetEntity;
    }
  }
  return null;
}

function ensureTargetLock(scene, sourceEntity, targetEntity, nowMs) {
  if (!scene || !sourceEntity || !targetEntity) {
    return false;
  }
  if (
    typeof scene.isEntityLockedTarget === "function" &&
    scene.isEntityLockedTarget(sourceEntity, targetEntity.itemID)
  ) {
    return true;
  }
  if (
    typeof scene.finalizeTargetLock !== "function"
  ) {
    return false;
  }
  const result = scene.finalizeTargetLock(sourceEntity, targetEntity, {
    nowMs,
  });
  return Boolean(result && result.success === true);
}

function restoreOwnerBurstAffinity(scene, controller) {
  if (!scene || !controller) {
    return;
  }

  const ownerEntity = scene.getEntityByID(toInt(controller.ownerShipID, 0));
  if (!ownerEntity || ownerEntity.kind !== "ship") {
    return;
  }

  const previousAffinity = toInt(
    controller.previousOwnerBurstAffinityGroupID,
    0,
  );
  if (previousAffinity > 0) {
    ownerEntity.remoteRepairBurstAffinityGroupID = previousAffinity;
    return;
  }
  delete ownerEntity.remoteRepairBurstAffinityGroupID;
}

function resolveOrbitDistanceForEntry(entry, nowMs) {
  const baseOrbitDistance = Math.max(
    0,
    toFiniteNumber(
      entry && entry.baseOrbitDistance,
      entry && entry.orbitDistance,
    ),
  );
  const pulseAmplitudeMeters = Math.max(
    0,
    toFiniteNumber(entry && entry.orbitPulseAmplitudeMeters, 0),
  );
  const pulsePeriodMs = Math.max(
    1,
    toInt(entry && entry.orbitPulsePeriodMs, 18_000),
  );
  if (pulseAmplitudeMeters <= 0 || pulsePeriodMs <= 0) {
    return baseOrbitDistance;
  }
  const phaseOffsetMs = toFiniteNumber(entry && entry.movementPhaseOffsetMs, 0);
  const normalizedPhase =
    (((toFiniteNumber(nowMs, 0) + phaseOffsetMs) % pulsePeriodMs) / pulsePeriodMs) *
    Math.PI *
    2;
  return Math.max(
    0,
    baseOrbitDistance + (Math.sin(normalizedPhase) * pulseAmplitudeMeters),
  );
}

function resolveAnchorDriftTarget(scene, controller, entry, nowMs) {
  if (!scene || !controller || !entry) {
    return null;
  }
  const ownerEntity = scene.getEntityByID(toInt(controller.ownerShipID, 0));
  if (!ownerEntity || ownerEntity.kind !== "ship") {
    return null;
  }
  const basis = buildFormationBasis(ownerEntity.direction);
  const wingSign = String(entry.wing || "") === "right" ? 1 : -1;
  const shellDistance = Math.max(
    12_000,
    toFiniteNumber(entry.anchorShellDistanceMeters, 14_000),
  );
  const driftPeriodMs = Math.max(1, toInt(entry.anchorDriftPeriodMs, 20_000));
  const phaseOffsetMs = toFiniteNumber(entry.movementPhaseOffsetMs, 0);
  const normalizedPhase =
    (((toFiniteNumber(nowMs, 0) + phaseOffsetMs) % driftPeriodMs) / driftPeriodMs) *
    Math.PI *
    2;
  const forwardAmplitudeMeters = Math.max(
    0,
    toFiniteNumber(entry.anchorDriftForwardAmplitudeMeters, 3_500),
  );
  const verticalAmplitudeMeters = Math.max(
    0,
    toFiniteNumber(entry.anchorDriftVerticalAmplitudeMeters, 1_250),
  );
  return addVectors(
    cloneVector(ownerEntity.position),
    addVectors(
      scaleVector(basis.right, wingSign * shellDistance),
      addVectors(
        scaleVector(basis.forward, Math.sin(normalizedPhase) * forwardAmplitudeMeters),
        scaleVector(basis.up, Math.cos(normalizedPhase * 0.75) * verticalAmplitudeMeters),
      ),
    ),
  );
}

function syncPrimaryAnchorDrift(scene, controller, entry, entity, nowMs, pseudoSession) {
  const desiredPoint = resolveAnchorDriftTarget(scene, controller, entry, nowMs);
  if (!desiredPoint) {
    return false;
  }

  const distanceToDesiredPoint = distanceBetweenVectors(entity.position, desiredPoint);
  const lastDriftCommandAtMs = toFiniteNumber(entry.lastDriftCommandAtMs, 0);
  const driftRefreshIntervalMs = Math.max(
    1_750,
    Math.trunc(Math.max(1, toInt(entry.anchorDriftPeriodMs, 20_000)) / 7),
  );
  const shouldRefreshDriftCommand =
    entity.mode !== "GOTO" ||
    distanceToDesiredPoint > 2_000 ||
    !lastDriftCommandAtMs ||
    (toFiniteNumber(nowMs, 0) - lastDriftCommandAtMs) >= driftRefreshIntervalMs;

  entry.lastDriftTargetPoint = cloneVector(desiredPoint);

  if (!shouldRefreshDriftCommand) {
    entry.lastMovementSyncAtMs = nowMs;
    return true;
  }

  scene.gotoPoint(pseudoSession, desiredPoint, {
    queueHistorySafeContract: true,
    suppressFreshAcquireReplay: true,
  });
  entry.lastDriftCommandAtMs = nowMs;
  entry.lastMovementSyncAtMs = nowMs;
  return true;
}

function resolveCoverSlotTarget(scene, controller, entry, nowMs) {
  if (!scene || !controller || !entry) {
    return null;
  }

  const ownerEntity = scene.getEntityByID(toInt(controller.ownerShipID, 0));
  if (!ownerEntity || ownerEntity.kind !== "ship") {
    return null;
  }

  const basis = buildFormationBasis(ownerEntity.direction);
  const phaseOffsetMs = toFiniteNumber(entry.movementPhaseOffsetMs, 0);
  const driftPeriodMs = Math.max(1, toInt(entry.coverDriftPeriodMs, 22_000));
  const normalizedPhase =
    (((toFiniteNumber(nowMs, 0) + phaseOffsetMs) % driftPeriodMs) / driftPeriodMs) *
    Math.PI *
    2;
  const forwardMeters =
    toFiniteNumber(entry.coverOffsetForwardMeters, 0) +
    (Math.sin(normalizedPhase * 0.85) * toFiniteNumber(entry.coverDriftForwardAmplitudeMeters, 0));
  const lateralMeters =
    toFiniteNumber(entry.coverOffsetLateralMeters, 0) +
    (Math.sin(normalizedPhase) * toFiniteNumber(entry.coverDriftLateralAmplitudeMeters, 0));
  const verticalMeters =
    toFiniteNumber(entry.coverOffsetVerticalMeters, 0) +
    (Math.cos(normalizedPhase * 1.15) * toFiniteNumber(entry.coverDriftVerticalAmplitudeMeters, 0));

  return addVectors(
    cloneVector(ownerEntity.position),
    addVectors(
      scaleVector(basis.forward, forwardMeters),
      addVectors(
        scaleVector(basis.right, lateralMeters),
        scaleVector(basis.up, verticalMeters),
      ),
    ),
  );
}

function syncCoverSlotMovement(scene, controller, entry, entity, nowMs, pseudoSession) {
  const desiredPoint = resolveCoverSlotTarget(scene, controller, entry, nowMs);
  if (!desiredPoint) {
    return false;
  }

  const distanceToDesiredPoint = distanceBetweenVectors(entity.position, desiredPoint);
  const distanceFromLastCommandPoint = entry.lastCoverIssuedTargetPoint
    ? distanceBetweenVectors(entry.lastCoverIssuedTargetPoint, desiredPoint)
    : Number.POSITIVE_INFINITY;
  const holdRadiusMeters = Math.max(
    300,
    toFiniteNumber(entry.coverHoldRadiusMeters, 900),
  );
  const refreshIntervalMs = Math.max(
    750,
    toInt(entry.coverRefreshIntervalMs, 1_250),
  );
  const refreshJitterMs = Math.max(
    0,
    toInt(entry.coverRefreshJitterMs, 0),
  );
  const minimumRetargetShiftMeters = Math.max(
    200,
    toFiniteNumber(entry.coverRetargetThresholdMeters, holdRadiusMeters * 0.4),
  );
  const nextEligibleRefreshAtMs =
    toFiniteNumber(entry.lastCoverCommandAtMs, 0) +
    refreshIntervalMs +
    refreshJitterMs;
  const shouldRefreshCommand =
    entity.mode !== "GOTO" ||
    distanceToDesiredPoint > holdRadiusMeters ||
    !entry.lastCoverCommandAtMs ||
    (
      toFiniteNumber(nowMs, 0) >= nextEligibleRefreshAtMs &&
      distanceFromLastCommandPoint >= minimumRetargetShiftMeters
    );

  entry.lastCoverTargetPoint = cloneVector(desiredPoint);
  if (!shouldRefreshCommand) {
    entry.lastMovementSyncAtMs = nowMs;
    return true;
  }

  scene.gotoPoint(pseudoSession, desiredPoint, {
    queueHistorySafeContract: true,
    suppressFreshAcquireReplay: true,
  });
  entry.lastCoverCommandAtMs = nowMs;
  entry.lastCoverIssuedTargetPoint = cloneVector(desiredPoint);
  entry.lastMovementSyncAtMs = nowMs;
  return true;
}

function syncFighterEntryMovement(scene, controller, fighterEntry, nowMs) {
  if (!scene || !controller || !fighterEntry) {
    return;
  }

  const fighterEntity = scene.getEntityByID(toInt(fighterEntry.entityID, 0));
  if (!fighterEntity || fighterEntity.kind !== "fighter") {
    return;
  }

  const parentEntity = scene.getEntityByID(toInt(fighterEntry.parentEntityID, 0));
  if (!parentEntity || (parentEntity.kind !== "ship" && parentEntity.kind !== "fighter")) {
    return;
  }

  const desiredOrbitDistance = Math.max(
    500,
    toFiniteNumber(
      controller.formationMode === "cover"
        ? fighterEntry.coverOrbitDistance
        : fighterEntry.orbitDistance,
      fighterEntry.orbitDistance,
    ),
  );
  const surfaceDistance = getSurfaceDistance(scene, fighterEntity, parentEntity);
  const retuneThresholdMeters = Math.max(75, desiredOrbitDistance * 0.15);
  const reacquireDistance = desiredOrbitDistance + Math.max(1_500, desiredOrbitDistance * 0.45);
  const retuneIntervalMs = 850;
  const allowRetune =
    !fighterEntry.lastOrbitRetuneAtMs ||
    (toFiniteNumber(nowMs, 0) - toFiniteNumber(fighterEntry.lastOrbitRetuneAtMs, 0)) >= retuneIntervalMs;
  const sameTarget = toInt(fighterEntity.targetEntityID, 0) === toInt(parentEntity.itemID, 0);
  const activeRange = Math.max(
    0,
    fighterEntity.mode === "FOLLOW"
      ? toFiniteNumber(fighterEntity.followRange, 0)
      : toFiniteNumber(fighterEntity.orbitDistance, 0),
  );

  const needsReacquire =
    !sameTarget ||
    surfaceDistance > reacquireDistance;
  if (needsReacquire) {
    scene.followShipEntity(fighterEntity, parentEntity.itemID, desiredOrbitDistance, {
      broadcast: true,
    });
    fighterEntry.lastOrbitRetuneAtMs = nowMs;
    fighterEntry.lastResolvedOrbitDistance = desiredOrbitDistance;
    return;
  }

  if (
    fighterEntity.mode !== "ORBIT" ||
    !sameTarget ||
    (
      allowRetune &&
      Math.abs(activeRange - desiredOrbitDistance) > retuneThresholdMeters
    )
  ) {
    scene.orbitShipEntity(fighterEntity, parentEntity.itemID, desiredOrbitDistance, {
      broadcast: true,
    });
    fighterEntry.lastOrbitRetuneAtMs = nowMs;
  }

  fighterEntry.lastResolvedOrbitDistance = desiredOrbitDistance;
}

function syncEntryMovement(scene, controller, entry, nowMs) {
  if (!scene || !controller || !entry) {
    return;
  }

  const entity = scene.getEntityByID(toInt(entry.entityID, 0));
  if (!entity || entity.kind !== "ship") {
    return;
  }

  const pseudoSession = buildNpcPseudoSession(entity);
  if (String(entry.movementProfile || "") === "anchorDrift") {
    if (syncPrimaryAnchorDrift(scene, controller, entry, entity, nowMs, pseudoSession)) {
      return;
    }
  }
  if (String(entry.movementProfile || "") === "coverSlot") {
    if (syncCoverSlotMovement(scene, controller, entry, entity, nowMs, pseudoSession)) {
      return;
    }
  }

  const orbitDistance = resolveOrbitDistanceForEntry(entry, nowMs);
  entry.lastResolvedOrbitDistance = orbitDistance;
  const targetEntity = resolveFirstTargetEntity(
    scene,
    controller,
    entry,
    entry.orbitTargetCandidates,
  );
  if (!targetEntity || orbitDistance <= 0) {
    if (entity.mode !== "STOP" && typeof scene.stopShipEntity === "function") {
      scene.stopShipEntity(entity, {
        reason: "remote_repair_show",
        allowSessionlessWarpAbort: true,
      });
    }
    return;
  }

  const sameTarget =
    toInt(entity.targetEntityID, 0) === toInt(targetEntity.itemID, 0);
  const surfaceDistance = getSurfaceDistance(scene, entity, targetEntity);
  const orbitReacquireDistanceMeters =
    orbitDistance + Math.max(5_000, orbitDistance * 0.5);
  const orbitSettleDistanceMeters =
    orbitDistance + Math.max(1_000, orbitDistance * 0.2);
  const orbitRetuneThresholdMeters = Math.max(
    50,
    toFiniteNumber(entry.orbitRetuneThresholdMeters, 225),
  );
  const orbitRetuneIntervalMs = Math.max(
    500,
    toInt(entry.orbitRetuneIntervalMs, 2_000),
  );
  const allowOrbitRetune =
    !entry.lastOrbitRetuneAtMs ||
    (toFiniteNumber(nowMs, 0) - toFiniteNumber(entry.lastOrbitRetuneAtMs, 0)) >= orbitRetuneIntervalMs;
  const currentlyFollowingOrbitBand =
    entity.mode === "FOLLOW" &&
    sameTarget &&
    Math.abs(toFiniteNumber(entity.followRange, 0) - orbitDistance) <= 1;

  if (
    surfaceDistance > orbitReacquireDistanceMeters ||
    (
      currentlyFollowingOrbitBand &&
      surfaceDistance > orbitSettleDistanceMeters
    )
  ) {
    if (
      entity.mode !== "FOLLOW" ||
      !sameTarget ||
      (
        allowOrbitRetune &&
        Math.abs(toFiniteNumber(entity.followRange, 0) - orbitDistance) > orbitRetuneThresholdMeters
      )
    ) {
      scene.followBall(pseudoSession, targetEntity.itemID, orbitDistance, {
        queueHistorySafeContract: true,
        suppressFreshAcquireReplay: true,
      });
      entry.lastOrbitRetuneAtMs = nowMs;
    }
    return;
  }

  if (
    entity.mode !== "ORBIT" ||
    !sameTarget ||
    (
      allowOrbitRetune &&
      Math.abs(toFiniteNumber(entity.orbitDistance, 0) - orbitDistance) > orbitRetuneThresholdMeters
    )
  ) {
    scene.orbit(pseudoSession, targetEntity.itemID, orbitDistance, {
      queueHistorySafeContract: true,
      suppressFreshAcquireReplay: true,
    });
    entry.lastOrbitRetuneAtMs = nowMs;
  }

  if (entry.lastMovementSyncAtMs !== nowMs) {
    entry.lastMovementSyncAtMs = nowMs;
  }
}

function syncEntryModules(scene, controller, entry, nowMs) {
  if (!scene || !controller || !entry) {
    return;
  }

  const entity = scene.getEntityByID(toInt(entry.entityID, 0));
  if (
    !entity ||
    entity.kind !== "ship" ||
    !Array.isArray(entity.fittedItems)
  ) {
    return;
  }

  const pseudoSession = buildNpcPseudoSession(entity);
  const activeEffects =
    entity.activeModuleEffects instanceof Map
      ? entity.activeModuleEffects
      : new Map();

  for (const modulePlan of Array.isArray(entry.modulePlans) ? entry.modulePlans : []) {
    if (!modulePlan) {
      continue;
    }

    const moduleID = toInt(modulePlan.moduleID, 0);
    if (moduleID <= 0) {
      continue;
    }

    const moduleItem = entity.fittedItems.find((item) => (
      toInt(item && item.itemID, 0) === moduleID
    )) || null;
    if (!moduleItem) {
      continue;
    }

    const desiredTarget = resolveFirstTargetEntity(
      scene,
      controller,
      entry,
      modulePlan.candidates,
    );
    const activeEffect = activeEffects.get(moduleID) || null;
    const activeTargetID = toInt(activeEffect && activeEffect.targetID, 0);
    const targetless = modulePlan.targetless === true;
    const notBeforeAtMs = toFiniteNumber(modulePlan && modulePlan.notBeforeAtMs, 0);
    if (!activeEffect && notBeforeAtMs > 0 && toFiniteNumber(nowMs, 0) < notBeforeAtMs) {
      continue;
    }

    if (
      activeEffect &&
      !targetless &&
      (
        !desiredTarget ||
        activeTargetID !== toInt(desiredTarget.itemID, 0)
      )
    ) {
      scene.deactivateGenericModule(pseudoSession, moduleID, {
        reason: "remote_repair_show_retarget",
        deferUntilCycle: false,
      });
      continue;
    }

    if (activeEffect) {
      continue;
    }

    if (!targetless && !desiredTarget) {
      continue;
    }

    if (!targetless && !ensureTargetLock(scene, entity, desiredTarget, nowMs)) {
      continue;
    }

    scene.activateGenericModule(
      pseudoSession,
      moduleItem,
      modulePlan.effectName || null,
      targetless
        ? {}
        : {
          targetID: desiredTarget.itemID,
        },
    );
  }
}

function clearRemoteRepairShowFighters(scene, options = {}) {
  const controller = scene && scene.remoteRepairShowController;
  if (!scene || !controller) {
    return {
      success: true,
      removedCount: 0,
    };
  }

  let removedCount = 0;
  for (const fighterEntry of Array.isArray(controller.fighterEntries) ? controller.fighterEntries : []) {
    const fighterID = toInt(fighterEntry && fighterEntry.entityID, 0);
    if (fighterID <= 0) {
      continue;
    }

    const entity = scene.getEntityByID(fighterID);
    if (entity && entity.kind === "fighter") {
      const destroyResult = scene.destroyInventoryBackedDynamicEntity(fighterID, {
        removeContents: true,
      });
      if (destroyResult && destroyResult.success === true) {
        removedCount += 1;
        continue;
      }
    }
  }

  controller.fighterEntries = [];
  delete controller.fightersDeployedAtMs;
  return {
    success: true,
    removedCount,
  };
}

function clearRemoteRepairShowController(scene, options = {}) {
  if (!scene || !scene.remoteRepairShowController) {
    return {
      success: true,
      removedCount: 0,
    };
  }

  const controller = scene.remoteRepairShowController;
  const nowMs = toFiniteNumber(
    options.nowMs,
    scene.getCurrentSimTimeMs && scene.getCurrentSimTimeMs(),
  );
  let removedCount = 0;
  for (const entry of Array.isArray(controller.entries) ? controller.entries : []) {
    const entityID = toInt(entry && entry.entityID, 0);
    if (entityID <= 0 || !scene.getEntityByID(entityID)) {
      nativeNpcStore.removeNativeEntityCascade(entityID);
      continue;
    }
    const removeResult = scene.removeDynamicEntity(entityID, {
      nowMs,
    });
    if (removeResult && removeResult.success === true) {
      removedCount += 1;
    }
    nativeNpcStore.removeNativeEntityCascade(entityID);
  }

  clearRemoteRepairShowFighters(scene, options);

  restoreOwnerBurstAffinity(scene, controller);
  scene.remoteRepairShowController = null;
  return {
    success: true,
    removedCount,
  };
}

function registerRemoteRepairShowController(scene, options = {}) {
  if (!scene) {
    return null;
  }

  const nowMs =
    scene.getCurrentSimTimeMs &&
    typeof scene.getCurrentSimTimeMs === "function"
      ? scene.getCurrentSimTimeMs()
      : Date.now();
  scene.remoteRepairShowController = {
    active: true,
    ownerShipID: toInt(options.ownerShipID, 0),
    formationMode: String(options.formationMode || "standard"),
    entries: Array.isArray(options.entries)
      ? options.entries.map((entry) => ({
        ...entry,
        orbitTargetCandidates: uniqueCandidates(entry && entry.orbitTargetCandidates),
        modulePlans: Array.isArray(entry && entry.modulePlans)
          ? entry.modulePlans.map((plan) => ({
            ...plan,
            candidates: uniqueCandidates(plan && plan.candidates),
            notBeforeAtMs:
              toFiniteNumber(nowMs, 0) +
              Math.max(0, toFiniteNumber(plan && plan.notBeforeOffsetMs, 0)),
          }))
          : [],
      }))
      : [],
    fighterEntries: Array.isArray(options.fighterEntries)
      ? options.fighterEntries.map((entry) => ({ ...entry }))
      : [],
    manageIntervalMs: Math.max(100, toInt(options.manageIntervalMs, 500)),
    movementIntervalMs: Math.max(250, toInt(options.movementIntervalMs, 1000)),
    nextManageAtMs: nowMs,
    nextMovementAtMs: nowMs,
  };
  return scene.remoteRepairShowController;
}

function tickRemoteRepairShowScene(scene, nowMs) {
  const controller = scene && scene.remoteRepairShowController;
  if (!scene || !controller || controller.active !== true) {
    return;
  }

  controller.entries = (Array.isArray(controller.entries) ? controller.entries : [])
    .filter((entry) => {
      const entity = scene.getEntityByID(toInt(entry && entry.entityID, 0));
      if (!entity) {
        nativeNpcStore.removeNativeEntityCascade(toInt(entry && entry.entityID, 0));
      }
      return Boolean(entity && entity.kind === "ship");
    });

  if (controller.entries.length === 0) {
    clearRemoteRepairShowController(scene, {
      nowMs,
    });
    return;
  }

  controller.fighterEntries = (Array.isArray(controller.fighterEntries) ? controller.fighterEntries : [])
    .filter((fighterEntry) => {
      const fighterEntity = scene.getEntityByID(toInt(fighterEntry && fighterEntry.entityID, 0));
      if (!fighterEntity || fighterEntity.kind !== "fighter") {
        return false;
      }
      const parentEntity = scene.getEntityByID(toInt(fighterEntry && fighterEntry.parentEntityID, 0));
      if (!parentEntity || parentEntity.kind !== "ship") {
        scene.destroyInventoryBackedDynamicEntity(fighterEntity.itemID, {
          removeContents: true,
        });
        return false;
      }
      return true;
    });

  if (toFiniteNumber(controller.nextMovementAtMs, 0) <= toFiniteNumber(nowMs, 0)) {
    for (const entry of controller.entries) {
      syncEntryMovement(scene, controller, entry, nowMs);
    }
    for (const fighterEntry of controller.fighterEntries) {
      syncFighterEntryMovement(scene, controller, fighterEntry, nowMs);
    }
    controller.nextMovementAtMs =
      nowMs + Math.max(250, toInt(controller.movementIntervalMs, 1000));
  }

  if (toFiniteNumber(controller.nextManageAtMs, 0) <= toFiniteNumber(nowMs, 0)) {
    for (const entry of controller.entries) {
      syncEntryModules(scene, controller, entry, nowMs);
    }
    controller.nextManageAtMs =
      nowMs + Math.max(100, toInt(controller.manageIntervalMs, 500));
  }
}

module.exports = {
  buildNpcPseudoSession,
  clearRemoteRepairShowController,
  clearRemoteRepairShowFighters,
  registerRemoteRepairShowController,
  tickScene: tickRemoteRepairShowScene,
  _testing: {
    resolveCoverSlotTarget,
    syncCoverSlotMovement,
    syncFighterEntryMovement,
  },
};
