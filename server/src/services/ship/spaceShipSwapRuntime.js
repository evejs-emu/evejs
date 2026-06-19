const path = require("path");

const {
  getActiveShipRecord,
  syncInventoryItemForSession,
} = require(path.join(__dirname, "../character/characterState"));
const {
  moveShipToSpace,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  destroyShipEntityWithWreck,
} = require(path.join(__dirname, "../../space/shipDestruction"));
const {
  boardSpaceShip,
} = require(path.join(__dirname, "../../space/transitions"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));

const CAPSULE_TYPE_ID = 670;
const DEFAULT_SPACE_SWAP_OFFSET_METERS = 1_000;

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

function scaleVector(vector, scalar) {
  const resolved = cloneVector(vector);
  const resolvedScalar = toFiniteNumber(scalar, 0);
  return {
    x: resolved.x * resolvedScalar,
    y: resolved.y * resolvedScalar,
    z: resolved.z * resolvedScalar,
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

function syncInventoryChangesToSession(session, changes = []) {
  if (!session) {
    return;
  }
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change || !change.item) {
      continue;
    }
    syncInventoryItemForSession(
      session,
      change.item,
      change.previousData || change.previousState || {},
      {
        emitCfgLocation: true,
      },
    );
  }
}

function buildStoppedSpawnStateNearEntity(entity, offsetMeters = DEFAULT_SPACE_SWAP_OFFSET_METERS) {
  const direction = normalizeVector(
    entity && entity.direction,
    { x: 1, y: 0, z: 0 },
  );
  const offset = Math.max(100, toFiniteNumber(offsetMeters, DEFAULT_SPACE_SWAP_OFFSET_METERS));
  const position = addVectors(
    cloneVector(entity && entity.position),
    scaleVector(direction, offset),
  );
  return {
    position,
    velocity: { x: 0, y: 0, z: 0 },
    direction,
    targetPoint: position,
    mode: "STOP",
    speedFraction: 0,
  };
}

function destroyAbandonedShipForSwap(session, shipRecord) {
  if (!session || !session._space || !shipRecord || toInt(shipRecord.itemID, 0) <= 0) {
    return {
      success: false,
      errorMsg: "ABANDONED_SHIP_NOT_FOUND",
    };
  }

  const systemID = toInt(
    session._space.systemID,
    toInt(shipRecord.locationID, 0),
  );
  const scene = spaceRuntime.ensureScene(systemID);
  const shipEntity = scene && scene.getEntityByID(shipRecord.itemID);
  if (!scene || !shipEntity || shipEntity.kind !== "ship" || shipEntity.session) {
    return {
      success: false,
      errorMsg: "ABANDONED_SHIP_NOT_FOUND",
    };
  }

  const destroyResult = destroyShipEntityWithWreck(systemID, shipEntity, {
    ownerCharacterID: session.characterID,
    shipRecord,
    forceVisibleSessions: [session],
  });
  if (!destroyResult.success || !destroyResult.data) {
    return destroyResult;
  }

  syncInventoryChangesToSession(session, destroyResult.data.wreckChanges || []);
  syncInventoryChangesToSession(session, destroyResult.data.movedChanges || []);
  syncInventoryChangesToSession(session, destroyResult.data.destroyChanges || []);

  if (typeof scene.flushTickDestinyPresentationBatch === "function") {
    scene.flushTickDestinyPresentationBatch();
  }
  if (typeof scene.flushDirectDestinyNotificationBatch === "function") {
    scene.flushDirectDestinyNotificationBatch();
  }

  return {
    success: true,
    data: {
      ...destroyResult.data,
      destroyedShipID: shipRecord.itemID,
    },
  };
}

function boardPreparedShipInSpace(session, shipItem) {
  if (!session || !session._space) {
    return {
      success: false,
      errorMsg: "NOT_IN_SPACE",
    };
  }

  const currentShip = getActiveShipRecord(session.characterID);
  const scene = spaceRuntime.getSceneForSession(session);
  const anchorEntity = spaceRuntime.getEntity(session, session._space.shipID);
  if (!scene || !anchorEntity) {
    return {
      success: false,
      errorMsg: "ACTIVE_SHIP_ENTITY_NOT_FOUND",
    };
  }

  const moveResult = moveShipToSpace(
    shipItem.itemID,
    session._space.systemID,
    buildStoppedSpawnStateNearEntity(anchorEntity),
  );
  if (!moveResult.success) {
    return moveResult;
  }

  const spawnResult = spaceRuntime.spawnDynamicInventoryEntity(
    session._space.systemID,
    shipItem.itemID,
    {
      excludedSession: session,
      broadcastOptions: {
        // Same-scene GM swaps need the replacement hull to materialize on the
        // immediate owner lane, even if a tick presentation batch is active.
        bypassTickPresentationBatch: true,
      },
    },
  );
  if (!spawnResult || !spawnResult.success) {
    return {
      success: false,
      errorMsg: spawnResult && spawnResult.errorMsg || "SPACE_SPAWN_FAILED",
    };
  }

  const spawnedEntity = scene.getEntityByID(shipItem.itemID);
  if (!spawnedEntity || spawnedEntity.kind !== "ship") {
    return {
      success: false,
      errorMsg: "SPACE_SPAWN_ENTITY_NOT_FOUND",
    };
  }

  const boardResult = boardSpaceShip(session, shipItem.itemID);
  if (!boardResult.success) {
    return boardResult;
  }

  let destroyResult = {
    success: true,
    data: {
      destroyedShipID: 0,
    },
  };
  if (currentShip && toInt(currentShip.typeID, 0) !== CAPSULE_TYPE_ID) {
    destroyResult = destroyAbandonedShipForSwap(session, currentShip);
    if (!destroyResult.success) {
      return destroyResult;
    }
  }

  return {
    success: true,
    data: {
      destroyResult: destroyResult.data || null,
      moveResult: moveResult.data || null,
      spawnResult: spawnResult.data || null,
      boardResult: boardResult.data || null,
    },
  };
}

module.exports = {
  buildStoppedSpawnStateNearEntity,
  boardPreparedShipInSpace,
};
