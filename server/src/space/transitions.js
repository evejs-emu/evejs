const path = require("path");

const config = require(path.join(__dirname, "../config"));
const log = require(path.join(__dirname, "../utils/logger"));
const sessionRegistry = require(path.join(
  __dirname,
  "../services/chat/sessionRegistry",
));
const {
  describeSessionHydrationState,
  flushPendingCommandSessionEffects,
} = require(path.join(
  __dirname,
  "../services/chat/commandSessionEffects",
));
const {
  queuePostSpaceAttachFittingHydration,
} = require(path.join(__dirname, "./modules/spaceAttachHydration"));
const {
  applyCharacterToSession,
  clearDockedFittingBootstrap,
  clearDeferredDockedShipSessionChange,
  flushCharacterSessionNotificationPlan,
  getCharacterRecord,
  getCharacterShips,
  findCharacterShip,
  getActiveShipRecord,
  updateCharacterRecord,
  syncInventoryItemForSession,
} = require(path.join(__dirname, "../services/character/characterState"));
const {
  CAPSULE_TYPE_ID,
  ITEM_FLAGS,
  ensureCapsuleForCharacter,
  findItemById,
  findCharacterShipByType,
  moveShipToSpace,
  dockShipToLocation,
  dockShipToStation,
  normalizeShipConditionState,
  removeInventoryItem,
  setActiveShipForCharacter,
  updateShipItem,
} = require(path.join(__dirname, "../services/inventory/itemStore"));
const structureState = require(path.join(
  __dirname,
  "../services/structure/structureState",
));
const {
  getDockedLocationID,
  getDockedLocationKind,
  getSessionStructureID,
  isDockedSession,
  isStructureDockedSession,
} = require(path.join(__dirname, "../services/structure/structureLocation"));
const {
  currentFileTime,
} = require(path.join(__dirname, "../services/_shared/serviceHelpers"));
const {
  broadcastStationGuestJoined,
  broadcastStationGuestLeft,
  broadcastStructureGuestJoined,
  broadcastStructureGuestLeft,
} = require(path.join(__dirname, "../services/_shared/guestLists"));
const crimewatchState = require(path.join(__dirname, "../services/security/crimewatchState"));
const worldData = require(path.join(__dirname, "./worldData"));
const spaceRuntime = require(path.join(__dirname, "./runtime"));
const {
  snapshotDestinyAuthorityState,
} = require(path.join(__dirname, "./movement/authority/destinySessionState"));
const {
  resolveStargatePhysicalRadius,
} = require(path.join(__dirname, "./stargateRadius"));
const {
  getStargateSystemForwardDirection,
} = require(path.join(__dirname, "./stargateOrientation"));
const TRANSITION_GUARD_WINDOW_MS = 5000;
const STARGATE_JUMP_HANDOFF_DELAY_MS = 1250;
const STARGATE_JUMP_RANGE_METERS = 2500;
const STARGATE_JUMP_IN_SURFACE_CLEARANCE_METERS = 12000;
const SPACE_BOARDING_RANGE_METERS = 2500;
const SESSION_CHANGE_COOLDOWN_MS = 7000;
const FILETIME_EPOCH_OFFSET = 116444736000000000n;
const FILETIME_TICKS_PER_MS = 10000n;

function getCrimewatchReferenceMs(session) {
  if (session && session._space && Number.isFinite(Number(session._space.simTimeMs))) {
    return Number(session._space.simTimeMs);
  }
  return Date.now();
}

function topOffShipShieldAndCapacitorForDockingTransition(shipId) {
  return updateShipItem(shipId, (currentShip) => ({
    ...currentShip,
    conditionState: normalizeShipConditionState({
      ...(currentShip.conditionState || {}),
      charge: 1.0,
      shieldCharge: 1.0,
    }),
  }));
}

function deactivateActiveModulesForSpaceTransition(session, reason) {
  if (!session || !session._space) {
    return {
      success: true,
      data: {
        stoppedModuleIDs: [],
        errors: [],
      },
    };
  }

  const result = spaceRuntime.deactivateAllActiveModules(session, {
    reason,
    clampToVisibleStamp: true,
  });
  if (!result || result.success !== true) {
    log.warn(
      `[SpaceTransition] Failed to fully deactivate active modules before ${reason} ` +
      `for ${session.characterName || session.characterID}: ` +
      `${result && result.errorMsg ? result.errorMsg : "ACTIVE_MODULE_DEACTIVATION_FAILED"}`,
    );
  }
  return result || {
    success: false,
    errorMsg: "ACTIVE_MODULE_DEACTIVATION_FAILED",
  };
}

function syncInventoryChangesToSession(session, changes = [], options = {}) {
  if (!session || typeof session.sendNotification !== "function") {
    return 0;
  }

  let syncedCount = 0;
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change || !change.item) {
      continue;
    }

    syncInventoryItemForSession(
      session,
      change.item,
      change.previousData || change.previousState || {},
      {
        emitCfgLocation: options.emitCfgLocation !== false,
      },
    );
    syncedCount += 1;
  }

  return syncedCount;
}

function consumeBoardedCapsule(scene, session, capsuleEntity, options = {}) {
  if (!scene || !capsuleEntity || capsuleEntity.kind !== "ship") {
    return {
      success: false,
      errorMsg: "CAPSULE_ENTITY_NOT_FOUND",
    };
  }

  const removeEntityResult = scene.removeDynamicEntity(capsuleEntity.itemID, {
    allowSessionOwned: true,
    forceVisibleSessions: session ? [session] : [],
    stampOverride:
      options && Object.prototype.hasOwnProperty.call(options, "stampOverride")
        ? options.stampOverride
        : undefined,
  });
  if (!removeEntityResult.success) {
    return removeEntityResult;
  }

  const removeItemResult = removeInventoryItem(capsuleEntity.itemID, {
    removeContents: true,
  });
  if (!removeItemResult.success) {
    return removeItemResult;
  }

  syncInventoryChangesToSession(
    session,
    removeItemResult.data && removeItemResult.data.changes,
    {
      emitCfgLocation: true,
    },
  );

  return {
    success: true,
    data: {
      entityID: capsuleEntity.itemID,
      changes:
        removeItemResult.data && Array.isArray(removeItemResult.data.changes)
          ? removeItemResult.data.changes
          : [],
    },
  };
}

function buildBoundResult(session) {
  if (!session) {
    return null;
  }

  const preferredBoundId =
    session.currentBoundObjectID ||
    (session._boundObjectIDs && (session._boundObjectIDs.ship || session._boundObjectIDs.beyonce)) ||
    session.lastBoundObjectID ||
    null;
  if (!preferredBoundId) {
    return null;
  }

  const readyAtMs = Date.now() + SESSION_CHANGE_COOLDOWN_MS;
  const readyAtFileTime =
    BigInt(Math.trunc(readyAtMs)) * FILETIME_TICKS_PER_MS + FILETIME_EPOCH_OFFSET;
  if (typeof spaceRuntime.recordSessionJumpTimingTrace === "function") {
    spaceRuntime.recordSessionJumpTimingTrace(session, "build-bound-result", {
      preferredBoundId,
      readyAtMs,
      readyAtFileTime: readyAtFileTime.toString(),
      cooldownMs: SESSION_CHANGE_COOLDOWN_MS,
    });
  }
  return [preferredBoundId, readyAtFileTime];
}

function buildLocationIdentityPatch(record, solarSystemID, extra = {}) {
  const targetSolarSystemID = Number(solarSystemID || 0) || Number(record.solarSystemID || 30000142) || 30000142;
  const system = worldData.getSolarSystemByID(targetSolarSystemID);

  return {
    ...record,
    ...extra,
    solarSystemID: targetSolarSystemID,
    constellationID:
      Number((system && system.constellationID) || record.constellationID || 0) ||
      20000020,
    regionID:
      Number((system && system.regionID) || record.regionID || 0) ||
      10000002,
    worldSpaceID: 0,
  };
}

function resolveDockableLocation(locationID) {
  const numericLocationID = Number(locationID || 0) || 0;
  if (!numericLocationID) {
    return null;
  }

  const station = worldData.getStationByID(numericLocationID);
  if (station) {
    return {
      kind: "station",
      record: station,
      locationID: station.stationID,
      solarSystemID: station.solarSystemID,
      label: station.stationName || `Station ${station.stationID}`,
    };
  }

  const structure = worldData.getStructureByID(numericLocationID);
  if (structure) {
    return {
      kind: "structure",
      record: structure,
      locationID: structure.structureID,
      solarSystemID: structure.solarSystemID,
      label: structure.itemName || structure.name || `Structure ${structure.structureID}`,
    };
  }

  return null;
}

function beginTransition(session, kind, targetID = 0) {
  if (!session) {
    return false;
  }

  const now = Date.now();
  const activeTransition = session._transitionState || null;
  if (
    activeTransition &&
    activeTransition.kind === kind &&
    (now - Number(activeTransition.startedAt || 0)) < TRANSITION_GUARD_WINDOW_MS
  ) {
    return false;
  }

  session._transitionState = {
    kind,
    targetID: Number(targetID || 0) || 0,
    startedAt: now,
  };
  return true;
}

function endTransition(session, kind) {
  if (
    session &&
    session._transitionState &&
    session._transitionState.kind === kind
  ) {
    session._transitionState = null;
  }
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneVector(source = null, fallback = { x: 0, y: 0, z: 0 }) {
  const vectorSource =
    source && typeof source === "object"
      ? source
      : null;
  return {
    x: toFiniteNumber(vectorSource ? vectorSource.x : undefined, fallback.x),
    y: toFiniteNumber(vectorSource ? vectorSource.y : undefined, fallback.y),
    z: toFiniteNumber(vectorSource ? vectorSource.z : undefined, fallback.z),
  };
}

function addVectors(left, right) {
  return {
    x: left.x + right.x,
    y: left.y + right.y,
    z: left.z + right.z,
  };
}

function subtractVectors(left, right) {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  };
}

function scaleVector(vector, scalar) {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar,
  };
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const length = Math.sqrt((vector.x ** 2) + (vector.y ** 2) + (vector.z ** 2));
  if (!Number.isFinite(length) || length <= 0) {
    return cloneVector(fallback);
  }

  return scaleVector(vector, 1 / length);
}

function distance(left, right) {
  const delta = subtractVectors(left, right);
  return Math.sqrt((delta.x ** 2) + (delta.y ** 2) + (delta.z ** 2));
}

function magnitude(vector) {
  return Math.sqrt((vector.x ** 2) + (vector.y ** 2) + (vector.z ** 2));
}

function buildSharedWorldPosition(systemPosition, localPosition) {
  return {
    x: toFiniteNumber(systemPosition && systemPosition.x, 0) -
      toFiniteNumber(localPosition && localPosition.x, 0),
    y: toFiniteNumber(systemPosition && systemPosition.y, 0) +
      toFiniteNumber(localPosition && localPosition.y, 0),
    z: toFiniteNumber(systemPosition && systemPosition.z, 0) +
      toFiniteNumber(localPosition && localPosition.z, 0),
  };
}

function getDirectionFromDunRotation(dunRotation) {
  if (!Array.isArray(dunRotation) || dunRotation.length < 2) {
    return null;
  }

  const yaw = toFiniteNumber(dunRotation[0], 0) * (Math.PI / 180);
  const pitch = toFiniteNumber(dunRotation[1], 0) * (Math.PI / 180);
  return normalizeVector({
    x: Math.sin(yaw) * Math.cos(pitch),
    y: -Math.sin(pitch),
    z: Math.cos(yaw) * Math.cos(pitch),
  });
}

function getDerivedStargateForwardDirection(stargate) {
  const sourceSystem = worldData.getSolarSystemByID(stargate && stargate.solarSystemID);
  const destinationGate = worldData.getStargateByID(stargate && stargate.destinationID);
  const destinationSystemID =
    toInt(stargate && stargate.destinationSolarSystemID, 0) ||
    toInt(destinationGate && destinationGate.solarSystemID, 0);
  const destinationSystem = worldData.getSolarSystemByID(
    destinationSystemID,
  );
  if (!sourceSystem || !destinationSystem) {
    return null;
  }

  return getStargateSystemForwardDirection(stargate, sourceSystem, destinationSystem);
}

function getResolvedStargateForwardDirection(stargate) {
  return (
    getDirectionFromDunRotation(stargate && stargate.dunRotation) ||
    getDerivedStargateForwardDirection(stargate) ||
    normalizeVector(cloneVector(stargate && stargate.position), { x: 1, y: 0, z: 0 })
  );
}

function resolveShipRadiusMeters(ship) {
  const directRadius = Math.max(
    0,
    toFiniteNumber(ship && (ship.radius ?? ship.spaceRadius), 0),
  );
  if (directRadius > 0) {
    return directRadius;
  }

  const shipTypeID = Number(ship && (ship.shipTypeID || ship.typeID)) || 0;
  if (shipTypeID <= 0) {
    return 0;
  }

  const movement = worldData.getMovementAttributesForType(shipTypeID);
  return Math.max(0, toFiniteNumber(movement && movement.radius, 0));
}

function buildGateSpawnState(stargate, ship = null) {
  const direction = getResolvedStargateForwardDirection(stargate);
  const offset =
    resolveStargatePhysicalRadius(stargate) +
    resolveShipRadiusMeters(ship) +
    STARGATE_JUMP_IN_SURFACE_CLEARANCE_METERS;

  return {
    direction,
    position: addVectors(
      cloneVector(stargate.position),
      scaleVector(direction, offset),
    ),
  };
}

function buildOffsetSpawnState(anchor, options = {}) {
  const fallbackDirection = cloneVector(
    options.fallbackDirection,
    { x: 1, y: 0, z: 0 },
  );
  const anchorPosition = cloneVector(anchor && anchor.position);
  const direction = normalizeVector(
    magnitude(anchorPosition) > 0 ? anchorPosition : fallbackDirection,
    fallbackDirection,
  );
  const minOffset = Math.max(toFiniteNumber(options.minOffset, 0), 0);
  const clearance = Math.max(toFiniteNumber(options.clearance, 0), 0);
  const offset = Math.max(toFiniteNumber(anchor && anchor.radius, 0) + clearance, minOffset);
  const position = addVectors(anchorPosition, scaleVector(direction, offset));

  return {
    direction,
    position,
  };
}

function buildSolarSystemSpawnState(solarSystemID) {
  const system = worldData.getSolarSystemByID(solarSystemID);
  if (!system) {
    return null;
  }

  const stargates = worldData.getStargatesForSystem(solarSystemID);
  if (stargates.length > 0) {
    const stargate = stargates[0];
    return {
      anchorType: "stargate",
      anchorID: stargate.itemID,
      anchorName: stargate.itemName || `Stargate ${stargate.itemID}`,
      ...buildOffsetSpawnState(stargate, {
        minOffset: Math.max(resolveStargatePhysicalRadius(stargate) * 0.4, 5000),
      }),
    };
  }

  const stations = worldData.getStationsForSystem(solarSystemID);
  if (stations.length > 0) {
    const station = stations[0];
    return {
      anchorType: "station",
      anchorID: station.stationID,
      anchorName: station.stationName || `Station ${station.stationID}`,
      ...buildOffsetSpawnState(station, {
        minOffset: Math.max((station.radius || 15000) * 0.4, 5000),
        clearance: 5000,
      }),
    };
  }

  const celestials = worldData.getCelestialsForSystem(solarSystemID);
  const celestial =
    celestials.find((entry) => entry.kind !== "sun" && entry.groupID !== 6) ||
    celestials.find((entry) => entry.kind === "sun" || entry.groupID === 6) ||
    celestials[0] ||
    null;
  if (celestial) {
    return {
      anchorType: celestial.kind || "celestial",
      anchorID: celestial.itemID,
      anchorName: celestial.itemName || `Celestial ${celestial.itemID}`,
      ...buildOffsetSpawnState(celestial, {
        minOffset: 100000,
        clearance: celestial.kind === "sun" || celestial.groupID === 6
          ? 250000
          : 25000,
      }),
    };
  }

  return {
    anchorType: "fallback",
    anchorID: system.solarSystemID,
    anchorName: system.solarSystemName || `System ${system.solarSystemID}`,
    direction: { x: 1, y: 0, z: 0 },
    position: { x: 1000000, y: 0, z: 0 },
  };
}

function broadcastOnCharNowInStation(session, stationID) {
  broadcastStationGuestJoined(session, stationID);
}

function broadcastOnCharNoLongerInStation(session, stationID) {
  broadcastStationGuestLeft(session, stationID);
}

function broadcastOnCharacterEnteredStructure(session, structureID) {
  broadcastStructureGuestJoined(session, structureID);
}

function broadcastOnCharacterLeftStructure(session, structureID) {
  broadcastStructureGuestLeft(session, structureID);
}

function buildSolarSessionChangeOptions(session, solarSystemID) {
  const sourceNodeID =
    Number(session && session._machoNodeID) ||
    Number(config.proxyNodeId) ||
    0;
  if (session && typeof session === "object" && sourceNodeID > 0) {
    session._machoNodeID = sourceNodeID;
  }
  return {
    sourceNodeID,
    nodesOfInterest: [sourceNodeID],
  };
}

function queuePendingSessionEffects(session, options = {}) {
  if (!session || typeof session !== "object") {
    return;
  }

  if (
    options.forceInitialBallpark ||
    options.awaitBeyonceBoundBallpark
  ) {
    session._pendingCommandInitialBallpark = {
      force: options.forceInitialBallpark === true,
      awaitBeyonceBound: options.awaitBeyonceBoundBallpark === true,
    };
  }

  if (Object.prototype.hasOwnProperty.call(options, "previousLocalChannelID")) {
    session._pendingLocalChannelSync = {
      previousChannelID: Number(options.previousLocalChannelID || 0) || 0,
    };
  }

}

function getSurfaceDistanceBetweenEntities(entity, targetEntity) {
  const centerDistance = distance(entity.position, targetEntity.position);
  return Math.max(
    0,
    centerDistance -
      Math.max(0, toFiniteNumber(entity && entity.radius, 0)) -
      Math.max(0, toFiniteNumber(targetEntity && targetEntity.radius, 0)),
  );
}

function buildStoppedSpaceStateFromEntity(entity) {
  const position = cloneVector(entity && entity.position);
  return {
    position,
    direction: normalizeVector(
      cloneVector(entity && entity.direction, { x: 1, y: 0, z: 0 }),
      { x: 1, y: 0, z: 0 },
    ),
    velocity: { x: 0, y: 0, z: 0 },
    speedFraction: 0,
    mode: "STOP",
    targetPoint: position,
  };
}

function buildCloneVatArrivalSpaceState(targetShipItem, targetEntity = null) {
  const sourceState =
    targetEntity && targetEntity.position
      ? {
          position: targetEntity.position,
          direction: targetEntity.direction,
          radius: targetEntity.radius,
        }
      : (targetShipItem && targetShipItem.spaceState) || {};
  const targetPosition = cloneVector(sourceState.position);
  const targetDirection = normalizeVector(
    cloneVector(sourceState.direction, { x: 1, y: 0, z: 0 }),
    { x: 1, y: 0, z: 0 },
  );
  const offsetMeters = Math.max(
    2500,
    toFiniteNumber(
      sourceState.radius,
      toFiniteNumber(targetShipItem && targetShipItem.spaceRadius, 0),
    ) + 1500,
  );
  const position = addVectors(
    targetPosition,
    scaleVector(targetDirection, -offsetMeters),
  );
  return {
    position,
    direction: targetDirection,
    velocity: { x: 0, y: 0, z: 0 },
    speedFraction: 0,
    mode: "STOP",
    targetPoint: position,
  };
}

function captureSpaceSessionState(session) {
  return {
    beyonceBound: Boolean(session && session._space && session._space.beyonceBound),
    initialStateSent: Boolean(
      session && session._space && session._space.initialStateSent,
    ),
    initialBallparkVisualsSent: Boolean(
      session && session._space && session._space.initialBallparkVisualsSent,
    ),
    initialBallparkClockSynced: Boolean(
      session && session._space && session._space.initialBallparkClockSynced,
    ),
  };
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function resolveSameSceneEgoAddBallsStamp(scene, session, nowMs = null) {
  if (!scene || !session) {
    return null;
  }

  const resolvedNowMs = toFiniteNumber(
    nowMs,
    typeof scene.getCurrentSimTimeMs === "function"
      ? scene.getCurrentSimTimeMs()
      : 0,
  );
  const currentPresentedStamp =
    typeof scene.getCurrentPresentedSessionDestinyStamp === "function"
      ? toInt(scene.getCurrentPresentedSessionDestinyStamp(session, resolvedNowMs), 0) >>> 0
      : 0;
  const authorityState = snapshotDestinyAuthorityState(session);
  const lastSentStamp = toInt(
    authorityState && authorityState.lastPresentedStamp,
    session && session._space && session._space.lastSentDestinyStamp,
    0,
  ) >>> 0;
  const floorStamp = lastSentStamp > 0 ? ((lastSentStamp + 1) >>> 0) : 0;
  const resolvedStamp = Math.max(currentPresentedStamp, floorStamp) >>> 0;
  return resolvedStamp > 0 ? resolvedStamp : null;
}

function repairSameSceneSessionViewState(session) {
  if (!session || !session._space) {
    return false;
  }

  // Same-scene ship swaps happen inside an already-live ballpark. If the local
  // bootstrap flags have drifted false, falling back to a fresh
  // ensureInitialBallpark() rebuild replays stale hull state and forces the
  // client through an owner SetState reset. Repair the bookkeeping instead.
  session._space.initialStateSent = true;
  session._space.initialBallparkVisualsSent = true;
  session._space.initialBallparkClockSynced = true;
  return true;
}

function ensureSameSceneBoardTargetVisible(session, scene, targetEntity) {
  if (!session || !session._space || !scene || !targetEntity) {
    return false;
  }

  const targetShipID = toInt(targetEntity.itemID, 0);
  if (targetShipID <= 0) {
    return false;
  }

  const visibleDynamicEntityIDs =
    session._space.visibleDynamicEntityIDs instanceof Set
      ? session._space.visibleDynamicEntityIDs
      : new Set();
  if (visibleDynamicEntityIDs.has(targetShipID)) {
    return false;
  }

  const stampOverride = resolveSameSceneEgoAddBallsStamp(scene, session);
  scene.sendAddBallsToSession(session, [targetEntity], {
    freshAcquire: true,
    sessionStampedAddBalls: true,
    stampOverride: stampOverride === null ? undefined : stampOverride,
    bypassTickPresentationBatch: true,
  });

  visibleDynamicEntityIDs.add(targetShipID);
  session._space.visibleDynamicEntityIDs = visibleDynamicEntityIDs;
  const freshlyVisibleDynamicEntityIDs =
    session._space.freshlyVisibleDynamicEntityIDs instanceof Set
      ? session._space.freshlyVisibleDynamicEntityIDs
      : new Set();
  freshlyVisibleDynamicEntityIDs.add(targetShipID);
  session._space.freshlyVisibleDynamicEntityIDs =
    freshlyVisibleDynamicEntityIDs;

  if (typeof scene.flushTickDestinyPresentationBatch === "function") {
    scene.flushTickDestinyPresentationBatch();
  }
  if (typeof scene.flushDirectDestinyNotificationBatch === "function") {
    scene.flushDirectDestinyNotificationBatch();
  }

  return true;
}

function refreshSameSceneSessionView(
  scene,
  session,
  egoEntity,
  additionalEntities = [],
  options = {},
) {
  if (!scene || !session || !session._space || !egoEntity) {
    return false;
  }

  const preserveExistingBallpark = options.preserveExistingBallpark === true;
  const needsFullBootstrap =
    session._space.initialStateSent !== true ||
    session._space.initialBallparkVisualsSent !== true ||
    session._space.initialBallparkClockSynced !== true;
  if (needsFullBootstrap) {
    if (preserveExistingBallpark) {
      repairSameSceneSessionViewState(session);
    } else if (scene.ensureInitialBallpark(session, { force: true })) {
      return true;
    }
  }

  const includeEgoEntity = options.includeEgoEntity !== false;
  const shouldSendStateRefresh = options.sendStateRefresh === true;
  const refreshEntities = [
    ...(includeEgoEntity ? [egoEntity] : []),
    ...additionalEntities,
  ].filter(Boolean);
  if (refreshEntities.length > 0) {
    scene.sendAddBallsToSession(session, refreshEntities, {
      sessionStampedAddBalls: options.sessionStampedAddBalls === true,
      stampOverride:
        options.stampOverride === undefined || options.stampOverride === null
          ? undefined
          : options.stampOverride,
    });
    if (session._space) {
      const visibleDynamicEntityIDs =
        session._space.visibleDynamicEntityIDs instanceof Set
          ? session._space.visibleDynamicEntityIDs
          : new Set();
      const freshlyVisibleDynamicEntityIDs =
        session._space.freshlyVisibleDynamicEntityIDs instanceof Set
          ? session._space.freshlyVisibleDynamicEntityIDs
          : new Set();
      for (const entity of refreshEntities) {
        const entityID = toInt(entity && entity.itemID, 0);
        if (
          entityID > 0 &&
          entityID !== toInt(session._space.shipID, 0) &&
          entity &&
          entity.kind === "ship"
        ) {
          visibleDynamicEntityIDs.add(entityID);
          freshlyVisibleDynamicEntityIDs.add(entityID);
        }
      }
      session._space.visibleDynamicEntityIDs = visibleDynamicEntityIDs;
      session._space.freshlyVisibleDynamicEntityIDs = freshlyVisibleDynamicEntityIDs;
    }
  }
  scene.syncDynamicVisibilityForSession(session);
  if (shouldSendStateRefresh) {
    scene.sendStateRefresh(session, egoEntity);
  }
  return true;
}

function flushSameSceneShipSwapNotificationPlan(session, plan) {
  return flushCharacterSessionNotificationPlan(session, plan, {
    sessionChangeOptions: {
      // Same-scene ship swaps should behave like remote attribute updates, not a
      // hard session-version transition. Otherwise the client can stall queued
      // Destiny packets behind "waiting for session change" during eject/board.
      sessionId: 0n,
    },
  });
}

function retargetCharacterSessionNotificationPlanShip(plan, oldShipID, shipID) {
  if (!plan || !plan.sessionChanges) {
    return false;
  }

  const normalizeShipID = (value) => {
    if (value === undefined || value === null) {
      return null;
    }
    const numericValue = Number(value) || 0;
    return numericValue > 0 ? numericValue : null;
  };

  const normalizedShipID = normalizeShipID(shipID);
  const previousShipID =
    normalizeShipID(oldShipID) ?? normalizeShipID(plan.oldShipID);
  if (normalizedShipID === null || previousShipID === null) {
    return false;
  }

  plan.newShipID = normalizedShipID;
  plan.sessionChanges.shipid = [previousShipID, normalizedShipID];
  if (plan.fittingBootstrap && Number(normalizedShipID) > 0) {
    plan.fittingBootstrap.shipID = Number(normalizedShipID);
  }
  return true;
}

function resolveReusableCapsuleForCharacter(
  characterID,
  excludedShipID,
  currentSolarSystemID,
  preferredStationID,
) {
  const excludedItemID = Number(excludedShipID || 0) || 0;
  const ships = getCharacterShips(characterID).filter(
    (shipItem) =>
      Number(shipItem && shipItem.typeID) === CAPSULE_TYPE_ID &&
      Number(shipItem && shipItem.itemID) !== excludedItemID,
  );

  const currentSystemCapsule = ships.find(
    (shipItem) =>
      Number(shipItem.locationID) === Number(currentSolarSystemID || 0) &&
      Number(shipItem.flagID) === 0,
  );
  if (currentSystemCapsule) {
    return {
      success: true,
      created: false,
      data: currentSystemCapsule,
    };
  }

  const storedCapsule = ships.find(
    (shipItem) => Number(shipItem.flagID) === ITEM_FLAGS.HANGAR,
  );
  if (storedCapsule) {
    return {
      success: true,
      created: false,
      data: storedCapsule,
    };
  }

  const existingCapsule = findCharacterShipByType(characterID, CAPSULE_TYPE_ID);
  if (existingCapsule && Number(existingCapsule.itemID) !== excludedItemID) {
    return {
      success: true,
      created: false,
      data: existingCapsule,
    };
  }

  return ensureCapsuleForCharacter(characterID, preferredStationID);
}

function completeStargateJump(
  session,
  sourceGate,
  destinationGate,
  activeShip,
) {
  if (
    !session ||
    !session.characterID ||
    !sourceGate ||
    !destinationGate ||
    !activeShip
  ) {
    endTransition(session, "stargate-jump");
    return {
      success: false,
      errorMsg: "INVALID_STARGATE_JUMP_STATE",
    };
  }

  if (
    !session._transitionState ||
    session._transitionState.kind !== "stargate-jump"
  ) {
    return {
      success: false,
      errorMsg: "STARGATE_JUMP_CANCELLED",
    };
  }

  const spawnState = buildGateSpawnState(destinationGate, activeShip);
  const sourceSimTimeMs =
    session && session._space
      ? spaceRuntime.getSimulationTimeMsForSession(session, null)
      : null;
  const sourceTimeDilation =
    session && session._space
      ? spaceRuntime.getSolarSystemTimeDilation(session._space.systemID)
      : null;
  const sourceClockCapturedAtWallclockMs = Date.now();
  if (typeof spaceRuntime.beginSessionJumpTimingTrace === "function") {
    spaceRuntime.beginSessionJumpTimingTrace(session, "stargate-jump", {
      sourceSystemID: sourceGate.solarSystemID,
      destinationSystemID: destinationGate.solarSystemID,
      sourceGateID: sourceGate.itemID,
      destinationGateID: destinationGate.itemID,
      sourceSimTimeMs,
      sourceTimeDilation,
      sourceClockCapturedAtWallclockMs,
      shipID: activeShip.itemID,
    });
  }

  deactivateActiveModulesForSpaceTransition(session, "stargate-jump");
  spaceRuntime.detachSession(session, {
    broadcast: true,
    lifecycleReason: "stargate-jump",
  });

  const moveResult = moveShipToSpace(activeShip.itemID, destinationGate.solarSystemID, {
    position: spawnState.position,
    direction: spawnState.direction,
    velocity: { x: 0, y: 0, z: 0 },
    speedFraction: 0,
    mode: "STOP",
    targetPoint: spawnState.position,
  });
  if (!moveResult.success) {
    endTransition(session, "stargate-jump");
    return moveResult;
  }

  syncInventoryItemForSession(
    session,
    moveResult.data,
    {
      locationID: moveResult.previousData.locationID,
      flagID: moveResult.previousData.flagID,
      quantity: moveResult.previousData.quantity,
      singleton: moveResult.previousData.singleton,
      stacksize: moveResult.previousData.stacksize,
    },
    {
      emitCfgLocation: false,
    },
  );

  const updateResult = updateCharacterRecord(session.characterID, (record) =>
    buildLocationIdentityPatch(record, destinationGate.solarSystemID, {
      stationID: null,
      structureID: null,
    }),
  );
  if (!updateResult.success) {
    endTransition(session, "stargate-jump");
    return updateResult;
  }

  const previousLocalChannelID = Number(
    session.solarsystemid2 ||
    session.solarsystemid ||
    getDockedLocationID(session) ||
    0,
  ) || 0;

  const applyResult = applyCharacterToSession(session, session.characterID, {
    emitNotifications: false,
    logSelection: true,
    selectionEvent: false,
  });
  if (!applyResult.success) {
    endTransition(session, "stargate-jump");
    return applyResult;
  }

  spaceRuntime.attachSession(session, moveResult.data, {
    systemID: destinationGate.solarSystemID,
    beyonceBound: false,
    pendingUndockMovement: false,
    broadcast: true,
    emitSimClockRebase: false,
    previousSimTimeMs: sourceSimTimeMs,
    initialBallparkPreviousSimTimeMs: sourceSimTimeMs,
    initialBallparkPreviousTimeDilation: sourceTimeDilation,
    initialBallparkPreviousCapturedAtWallclockMs: sourceClockCapturedAtWallclockMs,
    deferInitialBallparkStateUntilBind: true,
  });
  const observerArrivalFxResult = spaceRuntime.emitStargateArrivalObserverFx(
    session,
    destinationGate.itemID,
    moveResult.data && moveResult.data.itemID,
  );
  if (typeof spaceRuntime.recordSessionJumpTimingTrace === "function") {
    spaceRuntime.recordSessionJumpTimingTrace(session, "stargate-jump-attached", {
      destinationSystemID: destinationGate.solarSystemID,
      shipID: moveResult.data && moveResult.data.itemID,
      spawnState,
      observerArrivalFx: observerArrivalFxResult.success
        ? observerArrivalFxResult.data
        : {
            success: false,
            errorMsg: observerArrivalFxResult.errorMsg,
          },
    });
  }
  queuePostSpaceAttachFittingHydration(session, moveResult.data && moveResult.data.itemID, {
    inventoryBootstrapPending: false,
    hydrationProfile: "stargate",
  });
  flushCharacterSessionNotificationPlan(session, applyResult.notificationPlan);
  queuePendingSessionEffects(session, {
    awaitBeyonceBoundBallpark: true,
    previousLocalChannelID,
  });
  flushPendingCommandSessionEffects(session);

  log.info(
    `[SpaceTransition] Stargate jump ${session.characterName || session.characterID} ship=${activeShip.itemID} from=${sourceGate.itemID} to=${destinationGate.itemID}`,
  );

  endTransition(session, "stargate-jump");
  return {
    success: true,
    data: {
      stargate: destinationGate,
      spawnState,
      boundResult: buildBoundResult(session),
    },
  };
}

function syncDockedShipTransitionForSession(session, dockResult, options = {}) {
  if (!session || !dockResult || !dockResult.success || !dockResult.data) {
    return;
  }

  const dockedShip = dockResult.data;
  const previousData = dockResult.previousData || {};

  // Docking moves the active hull into the station hangar. The client needs
  // the location/flag delta for the move itself, then a second cache refresh
  // so the hangar scene can resolve the active hull immediately.
  syncInventoryItemForSession(
    session,
    dockedShip,
    {
      locationID: previousData.locationID,
      flagID: previousData.flagID,
      quantity: previousData.quantity,
      singleton: previousData.singleton,
      stacksize: previousData.stacksize,
    },
    {
      emitCfgLocation: true,
    },
  );

  if (options.refreshActiveShip !== false) {
    syncInventoryItemForSession(
      session,
      dockedShip,
      {
        locationID: dockedShip.locationID,
        flagID: dockedShip.flagID,
        quantity: dockedShip.quantity,
        singleton: dockedShip.singleton,
        stacksize: dockedShip.stacksize,
      },
      {
        emitCfgLocation: true,
      },
    );
  }
}

function undockSession(session) {
  if (!session || !session.characterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_SELECTED",
    };
  }

  const dockedLocationID = getDockedLocationID(session);
  if (!dockedLocationID) {
    return {
      success: false,
      errorMsg: "DOCK_REQUIRED",
    };
  }

  const dockable = resolveDockableLocation(dockedLocationID);
  if (!dockable) {
    return {
      success: false,
      errorMsg: "STATION_NOT_FOUND",
    };
  }

  const activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  if (!beginTransition(session, "undock", dockedLocationID)) {
    return {
      success: false,
      errorMsg: "UNDOCK_IN_PROGRESS",
    };
  }

  try {
    const previousLocalChannelID = Number(
      getDockedLocationID(session) ||
      session.solarsystemid2 ||
      session.solarsystemid ||
      0,
    ) || 0;
    if (
      dockable.kind === "structure" &&
      structureState.hasStructureOneWayUndockRestriction(
        dockable.record,
        session.shipTypeID,
      ) &&
      !structureState.hasStructureGmBypass(session)
    ) {
      return {
        success: false,
        errorMsg: "UNDOCK_RESTRICTED_BY_STRUCTURE",
      };
    }
    const undockState = spaceRuntime.getStationUndockSpawnState(dockable.record, {
      shipTypeID: session.shipTypeID || (activeShip && activeShip.typeID),
      selectionStrategy: dockable.kind === "structure" ? "random" : "first",
      selectionKey: activeShip && activeShip.itemID,
    });

    const moveResult = moveShipToSpace(activeShip.itemID, dockable.solarSystemID, {
      position: undockState.position,
      direction: undockState.direction,
      velocity: { x: 0, y: 0, z: 0 },
      speedFraction: 0,
      mode: "STOP",
      targetPoint: undockState.position,
    });
    if (!moveResult.success) {
      return moveResult;
    }

    const restoreResult = topOffShipShieldAndCapacitorForDockingTransition(
      moveResult.data.itemID,
    );
    if (restoreResult && restoreResult.success) {
      moveResult.data = restoreResult.data;
    }

    syncInventoryItemForSession(
      session,
      moveResult.data,
      {
        locationID: moveResult.previousData.locationID,
        flagID: moveResult.previousData.flagID,
        quantity: moveResult.previousData.quantity,
        singleton: moveResult.previousData.singleton,
        stacksize: moveResult.previousData.stacksize,
      },
      {
        emitCfgLocation: false,
      },
    );

    if (dockable.kind === "station") {
      broadcastOnCharNoLongerInStation(session, dockedLocationID);
    } else if (dockable.kind === "structure") {
      broadcastOnCharacterLeftStructure(session, dockedLocationID);
    }

    const updateResult = updateCharacterRecord(session.characterID, (record) =>
      buildLocationIdentityPatch(record, dockable.solarSystemID, {
        homeStationID:
          Number(record.homeStationID || record.cloneStationID || session.homeStationID || 60003760) ||
          60003760,
        cloneStationID:
          Number(record.cloneStationID || record.homeStationID || session.cloneStationID || 60003760) ||
          60003760,
        stationID: null,
        structureID: null,
      }),
    );
    if (!updateResult.success) {
      return updateResult;
    }

    clearDeferredDockedShipSessionChange(session);
    clearDockedFittingBootstrap(session);

    const applyResult = applyCharacterToSession(session, session.characterID, {
      emitNotifications: false,
      logSelection: true,
      selectionEvent: false,
      deferDockedShipSessionChange: false,
    });
    if (!applyResult.success) {
      return applyResult;
    }

    spaceRuntime.attachSession(session, moveResult.data, {
      systemID: dockable.solarSystemID,
      undockDirection: undockState.direction,
      speedFraction: 1,
      pendingUndockMovement: false,
      skipLegacyStationNormalization: true,
      broadcast: true,
      emitSimClockRebase: false,
      postAttachVisibilityReconcile: true,
      postAttachVisibilityReconcileReason: "undock",
    });
    queuePostSpaceAttachFittingHydration(session, moveResult.data.itemID, {
      inventoryBootstrapPending: false,
      hydrationProfile: "undock",
    });
    flushCharacterSessionNotificationPlan(session, applyResult.notificationPlan);
    queuePendingSessionEffects(session, {
      previousLocalChannelID,
    });
    flushPendingCommandSessionEffects(session);

    log.info(
      `[SpaceTransition] Undocked ${session.characterName || session.characterID} ship=${moveResult.data.itemID} location=${dockedLocationID} kind=${dockable.kind} system=${dockable.solarSystemID}`,
    );

    return {
      success: true,
      data: {
        station: dockable.record,
        ship: moveResult.data,
        boundResult: buildBoundResult(session),
      },
    };
  } finally {
    endTransition(session, "undock");
  }
}

function dockSession(session, stationID) {
  if (!session || !session.characterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_SELECTED",
    };
  }

  if (isDockedSession(session)) {
    return {
      success: false,
      errorMsg: "ALREADY_DOCKED",
    };
  }

  const targetStationID = Number(stationID || 0);
  const dockable = resolveDockableLocation(targetStationID);
  if (!dockable) {
    return {
      success: false,
      errorMsg: "STATION_NOT_FOUND",
    };
  }

  const activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  if (crimewatchState.isCriminallyFlagged(session.characterID, getCrimewatchReferenceMs(session))) {
    return {
      success: false,
      errorMsg: "CRIMINAL_TIMER_ACTIVE",
    };
  }

  if (dockable.kind === "structure") {
    const dockCheck = structureState.canCharacterDockAtStructure(session, dockable.record, {
      shipTypeID: session.shipTypeID,
    });
    if (!dockCheck.success) {
      return dockCheck;
    }
  }

  if (!beginTransition(session, "dock", targetStationID)) {
    return {
      success: false,
      errorMsg: "DOCK_IN_PROGRESS",
    };
  }

  try {
    deactivateActiveModulesForSpaceTransition(session, "dock");
    spaceRuntime.detachSession(session, {
      broadcast: true,
      lifecycleReason: "dock",
      notifySelfOnTargetClear: true,
    });

    const dockResult = dockShipToLocation(activeShip.itemID, dockable.locationID);
    if (!dockResult.success) {
      return dockResult;
    }
    const topOffResult = topOffShipShieldAndCapacitorForDockingTransition(
      dockResult.data.itemID,
    );
    if (topOffResult && topOffResult.success) {
      dockResult.data = topOffResult.data;
    }

    const updateResult = updateCharacterRecord(session.characterID, (record) =>
      buildLocationIdentityPatch(record, dockable.solarSystemID, {
        homeStationID:
          Number(record.homeStationID || record.cloneStationID || session.homeStationID || 60003760) ||
          60003760,
        cloneStationID:
          Number(record.cloneStationID || record.homeStationID || session.cloneStationID || 60003760) ||
          60003760,
        stationID: dockable.kind === "station" ? dockable.locationID : null,
        structureID: dockable.kind === "structure" ? dockable.locationID : null,
      }),
    );
    if (!updateResult.success) {
      return updateResult;
    }

    const applyResult = applyCharacterToSession(session, session.characterID, {
      emitNotifications: false,
      logSelection: true,
      selectionEvent: false,
      deferDockedShipSessionChange: false,
    });
    if (!applyResult.success) {
      return applyResult;
    }

    flushCharacterSessionNotificationPlan(session, applyResult.notificationPlan);
    syncDockedShipTransitionForSession(session, dockResult);
    if (dockable.kind === "station") {
      broadcastOnCharNowInStation(session, dockable.locationID);
    } else if (dockable.kind === "structure") {
      broadcastOnCharacterEnteredStructure(session, dockable.locationID);
    }

    log.info(
      `[SpaceTransition] Docked ${session.characterName || session.characterID} ship=${activeShip.itemID} location=${dockable.locationID} kind=${dockable.kind}`,
    );

    return {
      success: true,
      data: {
        station: dockable.record,
        boundResult: buildBoundResult(session),
      },
    };
  } finally {
    endTransition(session, "dock");
  }
}

function restoreSpaceSession(session) {
  if (!session || !session.characterID || isDockedSession(session)) {
    return false;
  }

  if (typeof spaceRuntime.beginSessionJumpTimingTrace === "function") {
    spaceRuntime.beginSessionJumpTimingTrace(session, "space-login", {
      characterID: session.characterID,
      systemID: Number(session.solarsystemid2 || session.solarsystemid || 0) || 0,
      shipID: Number(session.shipid || session.shipID || session.activeShipID || 0) || 0,
    });
  }
  if (typeof spaceRuntime.recordSessionJumpTimingTrace === "function") {
    spaceRuntime.recordSessionJumpTimingTrace(session, "space-login-restore-enter", {
      characterID: session.characterID,
      systemID: Number(session.solarsystemid2 || session.solarsystemid || 0) || 0,
    });
  }

  const activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip || !activeShip.spaceState) {
    return false;
  }

  const attachStartedAtMs = Date.now();
  const shipEntity = spaceRuntime.attachSession(session, activeShip, {
    systemID:
      activeShip.spaceState.systemID ||
      session.solarsystemid ||
      session.solarsystemid2,
    pendingUndockMovement: false,
    broadcast: true,
    emitSimClockRebase: false,
  });
  const attachElapsedMs = Date.now() - attachStartedAtMs;
  if (typeof spaceRuntime.recordSessionJumpTimingTrace === "function") {
    spaceRuntime.recordSessionJumpTimingTrace(session, "space-login-restore-attached", {
      shipID: Number(activeShip.itemID) || 0,
      systemID:
        Number(activeShip.spaceState && activeShip.spaceState.systemID) ||
        Number(session.solarsystemid2 || session.solarsystemid) ||
        0,
      attachMs: attachElapsedMs,
      attached: Boolean(shipEntity),
    });
  }
  if (attachElapsedMs >= 250) {
    log.info(
      `[SpaceTransition] restoreSpaceSession attach ship=${Number(activeShip.itemID) || 0} ` +
      `system=${Number(activeShip.spaceState && activeShip.spaceState.systemID) || Number(session.solarsystemid2 || session.solarsystemid) || 0} ` +
      `took ${attachElapsedMs}ms`,
    );
  }
  if (!shipEntity) {
    return false;
  }

  const hydrationQueuedAtMs = Date.now();
  queuePostSpaceAttachFittingHydration(session, activeShip.itemID, {
    // Direct login-in-space issues one early ship-inventory List(flag=None)
    // before the HUD stabilizes. Let invbroker suppress only that first call;
    // later explicit None requests still need the full ship contents.
    inventoryBootstrapPending: session._loginInventoryBootstrapPending === true,
    hydrationProfile: "login",
  });
  if (typeof spaceRuntime.recordSessionJumpTimingTrace === "function") {
    spaceRuntime.recordSessionJumpTimingTrace(session, "space-login-restore-hydration-queued", {
      shipID: Number(activeShip.itemID) || 0,
      queueLatencyMs: Date.now() - hydrationQueuedAtMs,
      inventoryBootstrapPending: session._loginInventoryBootstrapPending === true,
    });
  }
  // CCP client parity: Michelle creates its local Ballpark only after the
  // inflight/structure view path calls beyonce.GetFormations. Sending the
  // initial destiny bootstrap from restore-time can arrive before
  // SessionChange/GameUI/AddBallpark, which leaves the client with no bp to
  // consume and can black-screen login. Keep restore to attach-only; Beyonce
  // remains the first safe bootstrap trigger for direct space login.
  log.debug(
    `[space-login-restore] attached shipID=${Number(activeShip.itemID) || 0} ` +
    `systemID=${Number(
      activeShip.spaceState &&
      activeShip.spaceState.systemID,
    ) || Number(session.solarsystemid || session.solarsystemid2) || 0} ` +
    `${describeSessionHydrationState(session, activeShip.itemID)}`,
  );
  flushPendingCommandSessionEffects(session);
  if (typeof spaceRuntime.recordSessionJumpTimingTrace === "function") {
    spaceRuntime.recordSessionJumpTimingTrace(session, "space-login-restore-return", {
      shipID: Number(activeShip.itemID) || 0,
      systemID:
        Number(activeShip.spaceState && activeShip.spaceState.systemID) ||
        Number(session.solarsystemid2 || session.solarsystemid) ||
        0,
      success: true,
    });
  }

  return true;
}

function ejectSession(session, options = {}) {
  if (!session || !session.characterID || !session._space) {
    return {
      success: false,
      errorMsg: "NOT_IN_SPACE",
    };
  }

  const activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }
  if (Number(activeShip.typeID) === CAPSULE_TYPE_ID) {
    return {
      success: false,
      errorMsg: "ALREADY_IN_CAPSULE",
    };
  }

  const scene = spaceRuntime.getSceneForSession(session);
  const currentEntity = spaceRuntime.getEntity(session, activeShip.itemID);
  if (!scene || !currentEntity) {
    return {
      success: false,
      errorMsg: "SCENE_NOT_FOUND",
    };
  }

  if (!beginTransition(session, "eject", activeShip.itemID)) {
    return {
      success: false,
      errorMsg: "EJECT_IN_PROGRESS",
    };
  }

  try {
    const sendAbandonedShipSlimToVictim =
      options.sendAbandonedShipSlimToVictim !== false;
    const refreshAbandonedShipViewForVictim =
      options.refreshAbandonedShipViewForVictim !== false;
    const syncAllSessionsVisibilityAfterSwap =
      options.syncAllSessionsVisibilityAfterSwap !== false;
    const currentSystemID = Number(session._space.systemID || session.solarsystemid2 || session.solarsystemid || 0);
    const characterRecord = getCharacterRecord(session.characterID) || {};
    const preferredStationID =
      Number(
        characterRecord.homeStationID ||
          characterRecord.cloneStationID ||
          session.stationid ||
          session.stationID ||
          60003760,
      ) || 60003760;
    const preservedSpaceState = captureSpaceSessionState(session);
    const capsuleResult = resolveReusableCapsuleForCharacter(
      session.characterID,
      activeShip.itemID,
      currentSystemID,
      preferredStationID,
    );
    if (!capsuleResult.success || !capsuleResult.data) {
      return {
        success: false,
        errorMsg: capsuleResult.errorMsg || "CAPSULE_NOT_FOUND",
      };
    }

    const abandonedShipEntity = spaceRuntime.disembarkSession(session, {
      broadcast: true,
      lifecycleReason: "disembark",
    });
    if (!abandonedShipEntity) {
      return {
        success: false,
        errorMsg: "ACTIVE_SHIP_ENTITY_NOT_FOUND",
      };
    }

    const capsuleMoveResult = moveShipToSpace(
      capsuleResult.data.itemID,
      currentSystemID,
      buildStoppedSpaceStateFromEntity(currentEntity),
    );
    if (!capsuleMoveResult.success) {
      return capsuleMoveResult;
    }

    const activeShipResult = setActiveShipForCharacter(
      session.characterID,
      capsuleMoveResult.data.itemID,
    );
    if (!activeShipResult.success) {
      return activeShipResult;
    }

    syncInventoryItemForSession(
      session,
      capsuleMoveResult.data,
      {
        locationID: capsuleMoveResult.previousData.locationID,
        flagID: capsuleMoveResult.previousData.flagID,
        quantity: capsuleMoveResult.previousData.quantity,
        singleton: capsuleMoveResult.previousData.singleton,
        stacksize: capsuleMoveResult.previousData.stacksize,
      },
      {
        emitCfgLocation: false,
      },
    );

    const updateResult = updateCharacterRecord(session.characterID, (record) =>
      buildLocationIdentityPatch(record, currentSystemID, {
        stationID: null,
        structureID: null,
      }),
    );
    if (!updateResult.success) {
      return updateResult;
    }

    clearDeferredDockedShipSessionChange(session);
    clearDockedFittingBootstrap(session);

    const applyResult = applyCharacterToSession(session, session.characterID, {
      emitNotifications: false,
      logSelection: true,
      selectionEvent: false,
      deferDockedShipSessionChange: false,
    });
    if (!applyResult.success) {
      return applyResult;
    }

    const capsuleEntity = spaceRuntime.attachSession(session, capsuleMoveResult.data, {
      systemID: currentSystemID,
      pendingUndockMovement: false,
      spawnStopped: true,
      broadcast: false,
      emitEgoBallAdd: true,
      beyonceBound: preservedSpaceState.beyonceBound,
      initialStateSent: preservedSpaceState.initialStateSent,
      initialBallparkVisualsSent: preservedSpaceState.initialBallparkVisualsSent,
      initialBallparkClockSynced: preservedSpaceState.initialBallparkClockSynced,
    });
    if (!capsuleEntity) {
      return {
        success: false,
        errorMsg: "CAPSULE_ATTACH_FAILED",
      };
    }

    queuePostSpaceAttachFittingHydration(session, capsuleMoveResult.data.itemID, {
      inventoryBootstrapPending: false,
      hydrationProfile: "capsule",
    });
    flushSameSceneShipSwapNotificationPlan(session, applyResult.notificationPlan);
    repairSameSceneSessionViewState(session);
    const egoAddBallsStamp = resolveSameSceneEgoAddBallsStamp(scene, session);
    scene.sendAddBallsToSession(session, [capsuleEntity], {
      sessionStampedAddBalls: true,
      stampOverride: egoAddBallsStamp === null ? undefined : egoAddBallsStamp,
    });
    if (typeof scene.flushTickDestinyPresentationBatch === "function") {
      scene.flushTickDestinyPresentationBatch();
    }
    if (typeof scene.flushDirectDestinyNotificationBatch === "function") {
      scene.flushDirectDestinyNotificationBatch();
    }

    if (sendAbandonedShipSlimToVictim) {
      // CCP parity: After the ejecting player is attached to their capsule,
      // send an explicit slim-item update for the abandoned ship so the client
      // knows charID is now 0 (unpiloted). The earlier broadcastSlimItemChanges
      // in disembarkSession cannot reach this session because it was already
      // removed from the scene's session map at that point. Without this, the
      // client's cached slim item still shows a pilot, blocking re-boarding.
      scene.sendSlimItemChangesToSession(session, [abandonedShipEntity]);
    }
    if (refreshAbandonedShipViewForVictim) {
      refreshSameSceneSessionView(
        scene,
        session,
        capsuleEntity,
        [abandonedShipEntity],
        {
          includeEgoEntity: false,
          preserveExistingBallpark: true,
          sessionStampedAddBalls: true,
          stampOverride:
            egoAddBallsStamp === null ? undefined : egoAddBallsStamp,
          // Same-scene ship swaps are not a mini bootstrap. `eject.txt` showed
          // the extra owner SetState landing in the held session-change lane
          // with AddBalls2/FX and re-seeding the stale hull view after the
          // client had already adopted the capsule.
          sendStateRefresh: false,
        },
      );
    }
    if (syncAllSessionsVisibilityAfterSwap) {
      scene.syncDynamicVisibilityForAllSessions();
    }

    scene.broadcastSpecialFx(activeShip.itemID, "effects.ShipEjector", {
      targetID: capsuleMoveResult.data.itemID,
      start: true,
      active: false,
      duration: 4000,
      graphicInfo: {
        poseID: 0,
      },
    }, abandonedShipEntity);
    scene.broadcastSpecialFx(capsuleMoveResult.data.itemID, "effects.CapsuleFlare", {
      start: true,
      active: false,
      duration: 4000,
      graphicInfo: {
        poseID: 0,
      },
    }, capsuleEntity);

    log.info(
      `[SpaceTransition] Ejected ${session.characterName || session.characterID} from ship=${activeShip.itemID} into capsule=${capsuleMoveResult.data.itemID} system=${currentSystemID}`,
    );

    return {
      success: true,
      data: {
        abandonedShip: activeShip,
        capsule: capsuleMoveResult.data,
        boundResult: buildBoundResult(session),
      },
    };
  } finally {
    endTransition(session, "eject");
  }
}

function boardSpaceShip(session, shipID) {
  if (!session || !session.characterID || !session._space) {
    return {
      success: false,
      errorMsg: "NOT_IN_SPACE",
    };
  }

  const targetShipID = Number(shipID || 0) || 0;
  if (!targetShipID) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const currentShip = getActiveShipRecord(session.characterID);
  if (!currentShip) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }
  if (Number(currentShip.itemID) === targetShipID) {
    return {
      success: true,
      data: {
        ship: currentShip,
        boundResult: buildBoundResult(session),
      },
    };
  }

  const scene = spaceRuntime.getSceneForSession(session);
  const currentEntity = spaceRuntime.getEntity(session, currentShip.itemID);
  if (!scene || !currentEntity) {
    return {
      success: false,
      errorMsg: "SCENE_NOT_FOUND",
    };
  }

  const targetShip = findCharacterShip(session.characterID, targetShipID);
  if (!targetShip) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_OWNED",
    };
  }
  if (Number(targetShip.locationID) !== Number(scene.systemID)) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_IN_SYSTEM",
    };
  }

  const targetEntity = scene.getEntityByID(targetShipID);
  if (!targetEntity || targetEntity.kind !== "ship") {
    return {
      success: false,
      errorMsg: "TARGET_SHIP_NOT_ON_GRID",
    };
  }
  if (!scene.canSessionSeeDynamicEntity(session, targetEntity)) {
    return {
      success: false,
      errorMsg: "TARGET_SHIP_NOT_ON_GRID",
    };
  }
  if (targetEntity.session && targetEntity.session !== session) {
    return {
      success: false,
      errorMsg: "SHIP_ALREADY_OCCUPIED",
    };
  }

  const boardingDistance = getSurfaceDistanceBetweenEntities(
    currentEntity,
    targetEntity,
  );
  if (boardingDistance > SPACE_BOARDING_RANGE_METERS) {
    return {
      success: false,
      errorMsg: "TOO_FAR_AWAY",
      data: {
        distanceMeters: boardingDistance,
        maxDistanceMeters: SPACE_BOARDING_RANGE_METERS,
      },
    };
  }

  if (!beginTransition(session, "board", targetShipID)) {
    return {
      success: false,
      errorMsg: "BOARD_IN_PROGRESS",
    };
  }

  try {
    const currentSystemID = Number(scene.systemID || session.solarsystemid2 || session.solarsystemid || 0);
    const preservedSpaceState = captureSpaceSessionState(session);
    const targetWasPreAcquired = ensureSameSceneBoardTargetVisible(
      session,
      scene,
      targetEntity,
    );
    const shouldConsumePreviousCapsule =
      Number(currentShip.typeID) === CAPSULE_TYPE_ID &&
      Number(targetShip.typeID) !== CAPSULE_TYPE_ID;
    const abandonedCurrentEntity = spaceRuntime.disembarkSession(session, {
      broadcast: true,
      lifecycleReason: "disembark",
    });
    if (!abandonedCurrentEntity) {
      return {
        success: false,
        errorMsg: "ACTIVE_SHIP_ENTITY_NOT_FOUND",
      };
    }

    const activeShipResult = setActiveShipForCharacter(
      session.characterID,
      targetShipID,
    );
    if (!activeShipResult.success) {
      return activeShipResult;
    }

    const updateResult = updateCharacterRecord(session.characterID, (record) =>
      buildLocationIdentityPatch(record, currentSystemID, {
        stationID: null,
        structureID: null,
      }),
    );
    if (!updateResult.success) {
      return updateResult;
    }

    const applyResult = applyCharacterToSession(session, session.characterID, {
      emitNotifications: false,
      logSelection: true,
      selectionEvent: false,
      deferDockedShipSessionChange: false,
    });
    if (!applyResult.success) {
      return applyResult;
    }

    const boardedEntity = spaceRuntime.attachSessionToExistingEntity(
      session,
      targetShip,
      targetEntity,
      {
        systemID: currentSystemID,
        pendingUndockMovement: false,
        broadcast: false,
        beyonceBound: preservedSpaceState.beyonceBound,
        initialStateSent: preservedSpaceState.initialStateSent,
        initialBallparkVisualsSent: preservedSpaceState.initialBallparkVisualsSent,
        initialBallparkClockSynced: preservedSpaceState.initialBallparkClockSynced,
      },
    );
    if (!boardedEntity) {
      return {
        success: false,
        errorMsg: "BOARD_ATTACH_FAILED",
      };
    }

    flushSameSceneShipSwapNotificationPlan(session, applyResult.notificationPlan);
    repairSameSceneSessionViewState(session);
    const egoAddBallsStamp = resolveSameSceneEgoAddBallsStamp(scene, session);
    if (!targetWasPreAcquired) {
      scene.sendAddBallsToSession(session, [boardedEntity], {
        sessionStampedAddBalls: true,
        stampOverride: egoAddBallsStamp === null ? undefined : egoAddBallsStamp,
      });
      if (typeof scene.flushTickDestinyPresentationBatch === "function") {
        scene.flushTickDestinyPresentationBatch();
      }
      if (typeof scene.flushDirectDestinyNotificationBatch === "function") {
        scene.flushDirectDestinyNotificationBatch();
      }
    }
    scene.broadcastSlimItemChanges([boardedEntity]);
    scene.broadcastBallRefresh([boardedEntity], session);

    let previousCapsuleConsumed = false;
    if (shouldConsumePreviousCapsule) {
      const capsuleConsumeResult = consumeBoardedCapsule(
        scene,
        session,
        abandonedCurrentEntity,
        {
          stampOverride: resolveSameSceneEgoAddBallsStamp(scene, session),
        },
      );
      if (!capsuleConsumeResult.success) {
        log.warn(
          `[SpaceTransition] Failed to consume boarded capsule=${currentShip.itemID} ` +
          `for ${session.characterName || session.characterID}: ${capsuleConsumeResult.errorMsg}`,
        );
      } else {
        previousCapsuleConsumed = true;
      }
    }

    scene.syncDynamicVisibilityForAllSessions();
    if (!previousCapsuleConsumed) {
      scene.sendSlimItemChangesToSession(session, [abandonedCurrentEntity]);
      refreshSameSceneSessionView(
        scene,
        session,
        boardedEntity,
        [abandonedCurrentEntity],
        {
          includeEgoEntity: false,
          preserveExistingBallpark: true,
          sessionStampedAddBalls: true,
          stampOverride:
            egoAddBallsStamp === null ? undefined : egoAddBallsStamp,
          // Same-scene boarding should stay on the live ballpark path. A full
          // owner SetState here is a Michelle reset, not a harmless handoff.
          sendStateRefresh: false,
        },
      );
    }
    // Same-scene boarding changes the owner's active ship identity, not just
    // their visible neighborhood. If the immediate ego AddBalls2 lands on a
    // rejected bootstrap-acquire lane, the client can stay half-bound to the
    // old hull and stop updating the new ship HUD/heat state. A targeted owner
    // SetState here is a controlled ship-swap rebind after the remote-style
    // shipid session change, not a generic scene bootstrap.
    scene.sendStateRefresh(session, boardedEntity, null, {
      reason: "same-scene-boarding",
    });
    queuePostSpaceAttachFittingHydration(session, targetShipID, {
      inventoryBootstrapPending: false,
      hydrationProfile: "transition",
    });

    log.info(
      `[SpaceTransition] Boarded ${session.characterName || session.characterID} ship=${targetShipID} from=${currentShip.itemID} system=${currentSystemID}`,
    );

    return {
      success: true,
      data: {
        ship: targetShip,
        previousShip: currentShip,
        boundResult: buildBoundResult(session),
      },
    };
  } finally {
    endTransition(session, "board");
  }
}

function jumpSessionViaStargate(session, fromStargateID, toStargateID) {
  if (!session || !session.characterID || !session._space) {
    return {
      success: false,
      errorMsg: "NOT_IN_SPACE",
    };
  }

  const sourceGate = worldData.getStargateByID(fromStargateID);
  const destinationGate = worldData.getStargateByID(
    toStargateID || (sourceGate && sourceGate.destinationID),
  );
  if (!sourceGate || !destinationGate) {
    return {
      success: false,
      errorMsg: "STARGATE_NOT_FOUND",
    };
  }
  if (!beginTransition(session, "stargate-jump", sourceGate.itemID)) {
    return {
      success: false,
      errorMsg: "STARGATE_JUMP_IN_PROGRESS",
    };
  }
  if (
    Number(sourceGate.destinationID || 0) !== Number(destinationGate.itemID || 0)
  ) {
    endTransition(session, "stargate-jump");
    return {
      success: false,
      errorMsg: "STARGATE_DESTINATION_MISMATCH",
    };
  }
  if (
    Number(sourceGate.solarSystemID || 0) !== Number(session._space.systemID || 0)
  ) {
    endTransition(session, "stargate-jump");
    return {
      success: false,
      errorMsg: "WRONG_SOLAR_SYSTEM",
    };
  }

  const activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip) {
    endTransition(session, "stargate-jump");
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  if (crimewatchState.isCriminallyFlagged(session.characterID, getCrimewatchReferenceMs(session))) {
    endTransition(session, "stargate-jump");
    return {
      success: false,
      errorMsg: "CRIMINAL_TIMER_ACTIVE",
    };
  }

  const shipEntity = spaceRuntime.getEntity(session, activeShip.itemID);
  const sourceEntity = spaceRuntime.getEntity(session, sourceGate.itemID);
  if (shipEntity && sourceEntity) {
    const jumpDistance = getSurfaceDistanceBetweenEntities(shipEntity, sourceEntity);
    if (jumpDistance > STARGATE_JUMP_RANGE_METERS) {
      endTransition(session, "stargate-jump");
      return {
        success: false,
        errorMsg: "TOO_FAR_FROM_STARGATE",
      };
    }
  }

  const startResult = spaceRuntime.startStargateJump(session, sourceGate.itemID);
  if (!startResult.success) {
    endTransition(session, "stargate-jump");
    return startResult;
  }

  // Scale the handoff delay by the TiDi factor so the client-side gate FX
  // (which plays in dilated sim time) has enough wallclock time to finish
  // before we detach the session and reset TiDi to 1.0.
  const tidiFactor = spaceRuntime.getSolarSystemTimeDilation(sourceGate.solarSystemID);
  const scaledDelay = Math.round(STARGATE_JUMP_HANDOFF_DELAY_MS / tidiFactor);

  setTimeout(() => {
    const completionResult = completeStargateJump(
      session,
      sourceGate,
      destinationGate,
      activeShip,
    );
    if (!completionResult.success) {
      log.warn(
        `[SpaceTransition] Delayed stargate jump failed for ${session.characterName || session.characterID}: ${completionResult.errorMsg}`,
      );
    }
  }, scaledDelay);

  return {
    success: true,
    data: {
      stargate: destinationGate,
      jumpOutStamp: startResult.data.stamp,
      boundResult: buildBoundResult(session),
    },
  };
}

function rebuildDockedSessionAtStation(session, stationID, options = {}) {
  if (!session || !session.characterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_SELECTED",
    };
  }

  const targetStationID = Number(stationID || 0);
  const station = worldData.getStationByID(targetStationID);
  if (!station) {
    return {
      success: false,
      errorMsg: "STATION_NOT_FOUND",
    };
  }

  const previousLocalChannelID = Number(
    session.solarsystemid2 ||
    session.solarsystemid ||
    session.stationid ||
    session.stationID ||
    0,
  ) || 0;
  const preRespawnShipID = Number(
    session.shipID ||
    session.shipid ||
    session.activeShipID ||
    0,
  ) || 0;

  const capsuleResult = ensureCapsuleForCharacter(
    session.characterID,
    station.stationID,
  );
  if (!capsuleResult.success || !capsuleResult.data) {
    return {
      success: false,
      errorMsg: capsuleResult.errorMsg || "CAPSULE_NOT_FOUND",
    };
  }

  const capsuleShip = capsuleResult.data;
  const activeShipResult = setActiveShipForCharacter(
    session.characterID,
    capsuleShip.itemID,
  );
  if (!activeShipResult.success) {
    return activeShipResult;
  }

  const currentRecord = getCharacterRecord(session.characterID);
  const authoritativeHomeStationID =
    Number(
      (currentRecord && (
        currentRecord.homeStationID ||
        currentRecord.cloneStationID
      )) ||
      session.homeStationID ||
      session.homestationid ||
      session.cloneStationID ||
      session.clonestationid ||
      0,
    ) || 0;

  const updateResult = updateCharacterRecord(session.characterID, (record) =>
    buildLocationIdentityPatch(record, station.solarSystemID, {
      homeStationID: authoritativeHomeStationID || station.stationID,
      cloneStationID:
        Number(record.cloneStationID || authoritativeHomeStationID || station.stationID) ||
        station.stationID,
      stationID: station.stationID,
    }),
  );
  if (!updateResult.success) {
    return updateResult;
  }

  const applyResult = applyCharacterToSession(session, session.characterID, {
    emitNotifications: false,
    logSelection: options.logSelection !== false,
    selectionEvent: false,
    deferDockedShipSessionChange: false,
  });
  if (!applyResult.success) {
    return applyResult;
  }

  let newbieShipResult = null;
  if (options.boardNewbieShip === true) {
    const DogmaService = require(path.join(
      __dirname,
      "../services/dogma/dogmaService",
    ));
    if (typeof DogmaService.boardNewbieShipForSession === "function") {
      newbieShipResult = DogmaService.boardNewbieShipForSession(session, {
        emitNotifications: false,
        logSelection: false,
        repairExistingShip: true,
        logLabel: options.newbieShipLogLabel || "PodRespawn",
      });
      if (!newbieShipResult.success) {
        log.warn(
          `[SpaceTransition] Failed to auto-board corvette for ${session.characterName || session.characterID} station=${station.stationID} error=${newbieShipResult.errorMsg}`,
        );
      } else if (
        newbieShipResult.data &&
        newbieShipResult.data.ship &&
        Number(newbieShipResult.data.ship.itemID) > 0
      ) {
        retargetCharacterSessionNotificationPlanShip(
          applyResult.notificationPlan,
          preRespawnShipID,
          newbieShipResult.data.ship.itemID,
        );
      }
    }
  }

  if (options.emitNotifications !== false) {
    flushCharacterSessionNotificationPlan(session, applyResult.notificationPlan);
  }

  const refreshedCapsule =
    Number(capsuleShip && capsuleShip.itemID) > 0
      ? findCharacterShip(session.characterID, capsuleShip.itemID)
      : null;

  if (refreshedCapsule) {
    const capsuleChanges = Array.isArray(capsuleResult.changes)
      ? capsuleResult.changes
      : [];
    for (const change of capsuleChanges) {
      if (!change || !change.item) {
        continue;
      }

      syncInventoryItemForSession(
        session,
        change.item,
        change.previousState || {
          locationID: 0,
          flagID: ITEM_FLAGS.HANGAR,
        },
        {
          emitCfgLocation: true,
        },
      );
    }

    // Pod respawn briefly seeds a docked capsule before the corvette board
    // step runs. If that board consumes the capsule, never replay the stale
    // capsule row back into the hangar or the client materializes a ghost ship.
    syncInventoryItemForSession(
      session,
      refreshedCapsule,
      {
        locationID: refreshedCapsule.locationID,
        flagID: refreshedCapsule.flagID,
        quantity: refreshedCapsule.quantity,
        singleton: refreshedCapsule.singleton,
        stacksize: refreshedCapsule.stacksize,
      },
      {
        emitCfgLocation: true,
      },
    );
  }

  const refreshedActiveShip =
    getActiveShipRecord(session.characterID) ||
    refreshedCapsule ||
    capsuleShip;
  if (
    refreshedCapsule &&
    Number(refreshedActiveShip.itemID) !== Number(refreshedCapsule.itemID)
  ) {
    syncInventoryItemForSession(
      session,
      refreshedActiveShip,
      {
        locationID: refreshedActiveShip.locationID,
        flagID: refreshedActiveShip.flagID,
        quantity: refreshedActiveShip.quantity,
        singleton: refreshedActiveShip.singleton,
        stacksize: refreshedActiveShip.stacksize,
      },
      {
        emitCfgLocation: true,
      },
    );
  }

  queuePendingSessionEffects(session, {
    previousLocalChannelID,
  });
  flushPendingCommandSessionEffects(session);
  broadcastOnCharNowInStation(session, station.stationID);

  const activeShip =
    getActiveShipRecord(session.characterID) ||
    (newbieShipResult && newbieShipResult.data && newbieShipResult.data.ship) ||
    refreshedCapsule;

  log.info(
    `[SpaceTransition] Rebuilt docked session for ${session.characterName || session.characterID} station=${station.stationID} ship=${activeShip && activeShip.itemID}`,
  );

  return {
    success: true,
    data: {
      station,
      capsule: refreshedCapsule,
      ship: activeShip,
      newbieShipResult,
      boundResult: buildBoundResult(session),
    },
  };
}

function jumpSessionToStation(session, stationID) {
  if (!session || !session.characterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_SELECTED",
    };
  }

  const targetStationID = Number(stationID || 0);
  const station = worldData.getStationByID(targetStationID);
  if (!station) {
    return {
      success: false,
      errorMsg: "STATION_NOT_FOUND",
    };
  }

  const activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  if (!beginTransition(session, "station-jump", targetStationID)) {
    return {
      success: false,
      errorMsg: "STATION_JUMP_IN_PROGRESS",
    };
  }

  try {
    const previousLocalChannelID = Number(
      session.solarsystemid2 ||
      session.solarsystemid ||
      session.stationid ||
      session.stationID ||
      0,
    ) || 0;

    if (session._space) {
      deactivateActiveModulesForSpaceTransition(session, "station-jump");
      spaceRuntime.detachSession(session, {
        broadcast: true,
        lifecycleReason: "station-jump",
      });
    }

    const dockResult = dockShipToStation(activeShip.itemID, station.stationID);
    if (!dockResult.success) {
      return dockResult;
    }

    const currentRecord = getCharacterRecord(session.characterID);
    const authoritativeHomeStationID =
      Number(
        (currentRecord && (
          currentRecord.homeStationID ||
          currentRecord.cloneStationID
        )) ||
        session.homeStationID ||
        session.homestationid ||
        session.cloneStationID ||
        session.clonestationid ||
        0,
      ) || 0;

    const updateResult = updateCharacterRecord(session.characterID, (record) =>
      buildLocationIdentityPatch(record, station.solarSystemID, {
        homeStationID: authoritativeHomeStationID || station.stationID,
        cloneStationID:
          Number(record.cloneStationID || authoritativeHomeStationID || station.stationID) ||
          station.stationID,
        stationID: station.stationID,
      }),
    );
    if (!updateResult.success) {
      return updateResult;
    }

    const applyResult = applyCharacterToSession(session, session.characterID, {
      emitNotifications: false,
      logSelection: true,
      selectionEvent: false,
      deferDockedShipSessionChange: false,
    });
    if (!applyResult.success) {
      return applyResult;
    }

    flushCharacterSessionNotificationPlan(session, applyResult.notificationPlan);
    syncDockedShipTransitionForSession(session, dockResult);

    queuePendingSessionEffects(session, {
      previousLocalChannelID,
    });
    broadcastOnCharNowInStation(session, station.stationID);

    log.info(
      `[SpaceTransition] Station jump ${session.characterName || session.characterID} ship=${activeShip.itemID} station=${station.stationID} system=${station.solarSystemID}`,
    );

    return {
      success: true,
      data: {
        station,
        boundResult: buildBoundResult(session),
      },
    };
  } finally {
    endTransition(session, "station-jump");
  }
}

function jumpSessionToSolarSystem(session, solarSystemID, options = {}) {
  if (!session || !session.characterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_SELECTED",
    };
  }

  const targetSolarSystemID = Number(solarSystemID || 0);
  const system = worldData.getSolarSystemByID(targetSolarSystemID);
  if (!system) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
    };
  }

  const activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  if (!beginTransition(session, "solar-jump", targetSolarSystemID)) {
    return {
      success: false,
      errorMsg: "SOLAR_JUMP_IN_PROGRESS",
    };
  }

  try {
    const destinationSceneAlreadyLoaded = Boolean(
      spaceRuntime &&
        spaceRuntime.scenes instanceof Map &&
        spaceRuntime.scenes.has(targetSolarSystemID),
    );
    const sourceStationID = Number(session.stationid || session.stationID || 0);
    const sourceStructureID = Number(session.structureid || session.structureID || 0);
    const wasInSpace = Boolean(session._space);
    const sourceSimTimeMs = wasInSpace
      ? spaceRuntime.getSimulationTimeMsForSession(session, null)
      : null;
    const sourceTimeDilation = wasInSpace
      ? spaceRuntime.getSolarSystemTimeDilation(session._space.systemID)
      : null;
    const sourceClockCapturedAtWallclockMs = wasInSpace ? Date.now() : null;
    if (typeof spaceRuntime.beginSessionJumpTimingTrace === "function") {
      spaceRuntime.beginSessionJumpTimingTrace(session, "solar-jump", {
        sourceSystemID:
          wasInSpace && session && session._space
            ? Number(session._space.systemID || 0) || null
            : null,
        destinationSystemID: targetSolarSystemID,
        sourceSimTimeMs,
        sourceTimeDilation,
        sourceClockCapturedAtWallclockMs,
        shipID: activeShip.itemID,
      });
    }
    const previousLocalChannelID = Number(
      session.solarsystemid2 ||
      session.solarsystemid ||
      getDockedLocationID(session) ||
      0,
    ) || 0;
    const spawnState = options.spawnStateOverride || buildSolarSystemSpawnState(targetSolarSystemID);
    if (!spawnState) {
      return {
        success: false,
        errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
      };
    }

    if (wasInSpace) {
      deactivateActiveModulesForSpaceTransition(session, "solar-jump");
      spaceRuntime.detachSession(session, {
        broadcast: true,
        lifecycleReason: "solar-jump",
      });
    }

    const moveResult = moveShipToSpace(activeShip.itemID, targetSolarSystemID, {
      position: spawnState.position,
      direction: spawnState.direction,
      velocity: { x: 0, y: 0, z: 0 },
      speedFraction: 0,
      mode: "STOP",
      targetPoint: spawnState.position,
    });
    if (!moveResult.success) {
      return moveResult;
    }

    syncInventoryItemForSession(
      session,
      moveResult.data,
      {
        locationID: moveResult.previousData.locationID,
        flagID: moveResult.previousData.flagID,
        quantity: moveResult.previousData.quantity,
        singleton: moveResult.previousData.singleton,
        stacksize: moveResult.previousData.stacksize,
      },
      {
        emitCfgLocation: false,
      },
    );

    if (sourceStationID) {
      broadcastOnCharNoLongerInStation(session, sourceStationID);
    } else if (sourceStructureID) {
      broadcastOnCharacterLeftStructure(session, sourceStructureID);
    }

    const updateResult = updateCharacterRecord(session.characterID, (record) =>
      buildLocationIdentityPatch(record, targetSolarSystemID, {
        ...(sourceStationID
          ? {
              homeStationID:
                Number(record.homeStationID || record.cloneStationID || sourceStationID) ||
                sourceStationID,
              cloneStationID:
                Number(record.cloneStationID || record.homeStationID || sourceStationID) ||
                sourceStationID,
            }
          : {}),
        stationID: null,
        structureID: null,
      }),
    );
    if (!updateResult.success) {
      return updateResult;
    }

    const applyResult = applyCharacterToSession(session, session.characterID, {
      emitNotifications: false,
      logSelection: true,
      selectionEvent: false,
    });
    if (!applyResult.success) {
      return applyResult;
    }

    spaceRuntime.attachSession(session, moveResult.data, {
      systemID: targetSolarSystemID,
      beyonceBound: false,
      pendingUndockMovement: false,
      spawnStopped: true,
      broadcast: true,
      emitSimClockRebase: false,
      previousSimTimeMs: sourceSimTimeMs,
      initialBallparkPreviousSimTimeMs: sourceSimTimeMs,
      initialBallparkPreviousTimeDilation: sourceTimeDilation,
      initialBallparkPreviousCapturedAtWallclockMs: sourceClockCapturedAtWallclockMs,
      deferInitialBallparkStateUntilBind: true,
    });
    if (typeof spaceRuntime.recordSessionJumpTimingTrace === "function") {
      spaceRuntime.recordSessionJumpTimingTrace(session, "solar-jump-attached", {
        destinationSystemID: targetSolarSystemID,
        shipID: moveResult.data && moveResult.data.itemID,
        spawnState,
      });
    }
    queuePostSpaceAttachFittingHydration(
      session,
      moveResult.data && moveResult.data.itemID,
      {
        inventoryBootstrapPending: false,
        hydrationProfile: destinationSceneAlreadyLoaded ? "solarWarm" : "solar",
      },
    );
    flushCharacterSessionNotificationPlan(session, applyResult.notificationPlan);
    queuePendingSessionEffects(session, {
      awaitBeyonceBoundBallpark: true,
      previousLocalChannelID,
    });
    flushPendingCommandSessionEffects(session);

    log.info(
      `[SpaceTransition] Solar jump ${session.characterName || session.characterID} ship=${activeShip.itemID} system=${targetSolarSystemID} anchor=${spawnState.anchorType}:${spawnState.anchorID} warmScene=${destinationSceneAlreadyLoaded}`,
    );

    return {
      success: true,
      data: {
        solarSystem: system,
        ship: moveResult.data,
        spawnState,
        boundResult: buildBoundResult(session),
      },
    };
  } finally {
    endTransition(session, "solar-jump");
  }
}

function jumpSessionToShipCloneBay(session, targetShipID) {
  if (!session || !session.characterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_SELECTED",
    };
  }

  const targetItemID = Number(targetShipID || 0) || 0;
  if (!targetItemID) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const targetShip = findItemById(targetItemID);
  if (!targetShip || Number(targetShip.categoryID || 0) !== 6) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const targetSystemID =
    Number(targetShip.spaceState && targetShip.spaceState.systemID) ||
    Number(targetShip.locationID || 0) ||
    0;
  if (!targetSystemID || !targetShip.spaceState) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_IN_SPACE",
    };
  }

  let activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  if (Number(activeShip.typeID) !== CAPSULE_TYPE_ID) {
    if (!isDockedSession(session)) {
      return {
        success: false,
        errorMsg: "PILOT_NOT_IN_CAPSULE",
      };
    }
    const dockedLocationID = getDockedLocationID(session);
    const capsuleResult = resolveReusableCapsuleForCharacter(
      session.characterID,
      activeShip.itemID,
      Number(session.solarsystemid2 || session.solarsystemid || targetSystemID) ||
        targetSystemID,
      dockedLocationID ||
        session.homeStationID ||
        session.cloneStationID ||
        60003760,
    );
    if (!capsuleResult.success || !capsuleResult.data) {
      return {
        success: false,
        errorMsg: capsuleResult.errorMsg || "CAPSULE_NOT_FOUND",
      };
    }
    const activeShipResult = setActiveShipForCharacter(
      session.characterID,
      capsuleResult.data.itemID,
    );
    if (!activeShipResult.success) {
      return activeShipResult;
    }
    activeShip = capsuleResult.data;
  }

  if (!beginTransition(session, "clone-vat-jump", targetItemID)) {
    return {
      success: false,
      errorMsg: "CLONE_VAT_JUMP_IN_PROGRESS",
    };
  }

  try {
    const sourceStationID = Number(session.stationid || session.stationID || 0);
    const sourceStructureID = Number(
      session.structureid || session.structureID || 0,
    );
    const wasInSpace = Boolean(session._space);
    const sourceSimTimeMs = wasInSpace
      ? spaceRuntime.getSimulationTimeMsForSession(session, null)
      : null;
    const sourceTimeDilation = wasInSpace
      ? spaceRuntime.getSolarSystemTimeDilation(session._space.systemID)
      : null;
    const sourceClockCapturedAtWallclockMs = wasInSpace ? Date.now() : null;
    const previousLocalChannelID =
      Number(
        session.solarsystemid2 ||
          session.solarsystemid ||
          getDockedLocationID(session) ||
          0,
      ) || 0;

    const scene = spaceRuntime.ensureScene(targetSystemID);
    let targetEntity = scene ? scene.getEntityByID(targetItemID) : null;
    if (!targetEntity && targetShip.spaceState) {
      const spawnResult = spaceRuntime.spawnDynamicInventoryEntity(
        targetSystemID,
        targetItemID,
        {
          broadcastOptions: {
            freshAcquire: false,
          },
        },
      );
      if (spawnResult && spawnResult.success && spawnResult.data) {
        targetEntity = spawnResult.data.entity || null;
      }
    }
    const spawnState = buildCloneVatArrivalSpaceState(targetShip, targetEntity);

    if (typeof spaceRuntime.beginSessionJumpTimingTrace === "function") {
      spaceRuntime.beginSessionJumpTimingTrace(session, "clone-vat-jump", {
        sourceSystemID:
          wasInSpace && session._space
            ? Number(session._space.systemID || 0) || null
            : null,
        destinationSystemID: targetSystemID,
        targetShipID: targetItemID,
        sourceSimTimeMs,
        sourceTimeDilation,
        sourceClockCapturedAtWallclockMs,
        shipID: activeShip.itemID,
      });
    }

    if (wasInSpace) {
      deactivateActiveModulesForSpaceTransition(session, "clone-vat-jump");
      spaceRuntime.detachSession(session, {
        broadcast: true,
        lifecycleReason: "clone-vat-jump",
      });
    }

    const moveResult = moveShipToSpace(
      activeShip.itemID,
      targetSystemID,
      spawnState,
    );
    if (!moveResult.success) {
      return moveResult;
    }

    syncInventoryItemForSession(
      session,
      moveResult.data,
      {
        locationID: moveResult.previousData.locationID,
        flagID: moveResult.previousData.flagID,
        quantity: moveResult.previousData.quantity,
        singleton: moveResult.previousData.singleton,
        stacksize: moveResult.previousData.stacksize,
      },
      {
        emitCfgLocation: false,
      },
    );

    if (sourceStationID) {
      broadcastOnCharNoLongerInStation(session, sourceStationID);
    } else if (sourceStructureID) {
      broadcastOnCharacterLeftStructure(session, sourceStructureID);
    }

    const updateResult = updateCharacterRecord(session.characterID, (record) =>
      buildLocationIdentityPatch(record, targetSystemID, {
        ...(sourceStationID
          ? {
              homeStationID:
                Number(
                  record.homeStationID ||
                    record.cloneStationID ||
                    sourceStationID,
                ) || sourceStationID,
              cloneStationID:
                Number(
                  record.cloneStationID ||
                    record.homeStationID ||
                    sourceStationID,
                ) || sourceStationID,
            }
          : {}),
        stationID: null,
        structureID: null,
      }),
    );
    if (!updateResult.success) {
      return updateResult;
    }

    clearDeferredDockedShipSessionChange(session);
    clearDockedFittingBootstrap(session);

    const applyResult = applyCharacterToSession(session, session.characterID, {
      emitNotifications: false,
      logSelection: true,
      selectionEvent: false,
      deferDockedShipSessionChange: false,
    });
    if (!applyResult.success) {
      return applyResult;
    }

    spaceRuntime.attachSession(session, moveResult.data, {
      systemID: targetSystemID,
      beyonceBound: false,
      pendingUndockMovement: false,
      spawnStopped: true,
      broadcast: true,
      emitSimClockRebase: false,
      previousSimTimeMs: sourceSimTimeMs,
      initialBallparkPreviousSimTimeMs: sourceSimTimeMs,
      initialBallparkPreviousTimeDilation: sourceTimeDilation,
      initialBallparkPreviousCapturedAtWallclockMs:
        sourceClockCapturedAtWallclockMs,
      deferInitialBallparkStateUntilBind: true,
    });
    if (typeof spaceRuntime.recordSessionJumpTimingTrace === "function") {
      spaceRuntime.recordSessionJumpTimingTrace(
        session,
        "clone-vat-jump-attached",
        {
          destinationSystemID: targetSystemID,
          targetShipID: targetItemID,
          shipID: moveResult.data && moveResult.data.itemID,
          spawnState,
        },
      );
    }

    queuePostSpaceAttachFittingHydration(
      session,
      moveResult.data && moveResult.data.itemID,
      {
        inventoryBootstrapPending: false,
        hydrationProfile: "cloneVat",
      },
    );
    flushCharacterSessionNotificationPlan(session, applyResult.notificationPlan, {
      sessionChangeOptions: buildSolarSessionChangeOptions(
        session,
        targetSystemID,
      ),
    });
    queuePendingSessionEffects(session, {
      awaitBeyonceBoundBallpark: true,
      previousLocalChannelID,
    });
    flushPendingCommandSessionEffects(session);

    log.info(
      `[SpaceTransition] Clone-vat jump ${
        session.characterName || session.characterID
      } capsule=${moveResult.data.itemID} targetShip=${targetItemID} system=${targetSystemID}`,
    );

    return {
      success: true,
      data: {
        ship: moveResult.data,
        targetShip,
        targetEntity,
        spawnState,
        boundResult: buildBoundResult(session),
      },
    };
  } finally {
    endTransition(session, "clone-vat-jump");
  }
}

module.exports = {
  buildBoundResult,
  buildSolarSystemSpawnState,
  undockSession,
  dockSession,
  restoreSpaceSession,
  ejectSession,
  boardSpaceShip,
  jumpSessionViaStargate,
  rebuildDockedSessionAtStation,
  jumpSessionToStation,
  jumpSessionToShipCloneBay,
  jumpSessionToSolarSystem,
  resolveSameSceneEgoAddBallsStamp,
  repairSameSceneSessionViewState,
};
module.exports._testing = {
  buildBoundResultForTesting: buildBoundResult,
  buildGateSpawnState,
  completeStargateJumpForTesting: completeStargateJump,
  getResolvedStargateForwardDirection,
  getSurfaceDistanceBetweenEntities,
  resolveSameSceneEgoAddBallsStamp,
  repairSameSceneSessionViewState,
};
