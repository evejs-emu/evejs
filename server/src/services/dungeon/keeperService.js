const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  throwWrappedUserError,
} = require(path.join(__dirname, "../../common/machoErrors"));
const dungeonAuthority = require(path.join(__dirname, "./dungeonAuthority"));
const dungeonRuntime = require(path.join(__dirname, "./dungeonRuntime"));
const dungeonUniverseSiteService = require(path.join(
  __dirname,
  "./dungeonUniverseSiteService",
));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));

const GATE_INTERACTION_BUFFER_METERS = 3_500;
const ROOM_ENTRY_BASE_DISTANCE_METERS = 1_000_000;
const ROOM_ENTRY_DISTANCE_STEP_METERS = 400_000;
const ROOM_ENTRY_VERTICAL_STEP_METERS = 10_000;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeText(value, fallback = "") {
  const normalized = String(value == null ? "" : value).trim();
  return normalized || fallback;
}

function normalizeLowerText(value, fallback = "") {
  return normalizeText(value, fallback).toLowerCase();
}

function clonePosition(value) {
  return {
    x: toFiniteNumber(value && value.x, 0),
    y: toFiniteNumber(value && value.y, 0),
    z: toFiniteNumber(value && value.z, 0),
  };
}

function addVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) + toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) + toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) + toFiniteNumber(right && right.z, 0),
  };
}

function subtractVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0),
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
  const x = toFiniteNumber(vector && vector.x, 0);
  const y = toFiniteNumber(vector && vector.y, 0);
  const z = toFiniteNumber(vector && vector.z, 0);
  return Math.sqrt((x * x) + (y * y) + (z * z));
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const length = magnitude(vector);
  if (length <= 0.000001) {
    return clonePosition(fallback);
  }
  return scaleVector(vector, 1 / length);
}

function resolveSceneEntity(scene, entityOrID) {
  if (!scene) {
    return null;
  }
  if (entityOrID && typeof entityOrID === "object") {
    return entityOrID;
  }
  const numericEntityID = Math.max(0, toInt(entityOrID, 0));
  if (numericEntityID <= 0) {
    return null;
  }
  if (typeof scene.getEntityByID === "function") {
    const entity = scene.getEntityByID(numericEntityID);
    if (entity) {
      return entity;
    }
  }
  if (scene.staticEntitiesByID && typeof scene.staticEntitiesByID.get === "function") {
    return scene.staticEntitiesByID.get(numericEntityID) || null;
  }
  return null;
}

function resolveOrderedRoomKeys(instance, template) {
  const sceneProfile =
    template &&
    template.siteSceneProfile &&
    typeof template.siteSceneProfile === "object"
      ? template.siteSceneProfile
      : {};
  const roomProfiles = Array.isArray(sceneProfile.roomProfiles)
    ? sceneProfile.roomProfiles
    : [];
  const roomKeys = roomProfiles
    .map((entry) => normalizeText(entry && entry.roomKey, ""))
    .filter(Boolean);
  if (roomKeys.length > 0) {
    return roomKeys;
  }
  const roomStatesByKey =
    instance &&
    instance.roomStatesByKey &&
    typeof instance.roomStatesByKey === "object"
      ? instance.roomStatesByKey
      : {};
  const dynamicRoomKeys = Object.keys(roomStatesByKey)
    .filter((roomKey) => roomKey && roomKey !== "room:entry")
    .sort((left, right) => (
      toInt(left.split(":").pop(), 0) - toInt(right.split(":").pop(), 0)
    ) || left.localeCompare(right));
  return ["room:entry", ...dynamicRoomKeys];
}

function resolveGateDestinationPoint(siteEntity, gateEntity, instance, template, destinationRoomKey) {
  const sitePosition = clonePosition(
    (siteEntity && siteEntity.position) ||
    (gateEntity && gateEntity.position),
  );
  const gatePosition = clonePosition(gateEntity && gateEntity.position);
  const orderedRoomKeys = resolveOrderedRoomKeys(instance, template);
  const roomIndex = Math.max(0, orderedRoomKeys.findIndex((roomKey) => roomKey === destinationRoomKey));
  const radialDirection = normalizeVector(
    subtractVectors(gatePosition, sitePosition),
    { x: 1, y: 0, z: 0 },
  );
  const baseDistance =
    ROOM_ENTRY_BASE_DISTANCE_METERS +
    (Math.max(0, roomIndex - 1) * ROOM_ENTRY_DISTANCE_STEP_METERS);
  return addVectors(sitePosition, {
    x: radialDirection.x * baseDistance,
    y: (roomIndex % 2 === 0 ? 1 : -1) * ROOM_ENTRY_VERTICAL_STEP_METERS * roomIndex,
    z: radialDirection.z * baseDistance,
  });
}

function resolveGateInteractionLimit(gateEntity, shipEntity) {
  return Math.max(
    2_500,
    toFiniteNumber(gateEntity && gateEntity.radius, 0) +
      toFiniteNumber(shipEntity && shipEntity.radius, 0) +
      GATE_INTERACTION_BUFFER_METERS,
  );
}

function activateAccelerationGateForSession(session, gateEntityOrID, options = {}) {
  const scene = spaceRuntime.getSceneForSession(session);
  if (!scene) {
    throwWrappedUserError("DeniedShipChanged");
  }

  const gateEntity = resolveSceneEntity(scene, gateEntityOrID);
  if (!(gateEntity && gateEntity.dungeonMaterializedGate === true)) {
    throwWrappedUserError("DeniedTargetAttemptFailed");
  }

  const shipEntity =
    typeof scene.getShipEntityForSession === "function"
      ? scene.getShipEntityForSession(session)
      : null;
  if (!shipEntity) {
    throwWrappedUserError("DeniedShipChanged");
  }

  const separation = magnitude(subtractVectors(shipEntity.position, gateEntity.position));
  if (separation > resolveGateInteractionLimit(gateEntity, shipEntity)) {
    throwWrappedUserError("TargetTooFar");
  }

  const instanceID = Math.max(0, toInt(gateEntity.dungeonSiteInstanceID, 0));
  const siteID = Math.max(0, toInt(gateEntity.dungeonSiteID, 0));
  const gateKey = normalizeText(gateEntity.dungeonGateKey, "");
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  if (instanceID <= 0 || siteID <= 0 || !gateKey) {
    throwWrappedUserError("DeniedTargetAttemptFailed");
  }

  dungeonUniverseSiteService.ensureSiteContentsMaterialized(scene, {
    instanceID,
    siteID,
  }, {
    broadcast: true,
    spawnEncounters: true,
    session,
    nowMs,
  });

  let instance = dungeonRuntime.ensureTemplateRuntimeState(instanceID, { nowMs });
  if (!instance) {
    throwWrappedUserError("DeniedTargetAttemptFailed");
  }
  const gateState =
    instance.gateStatesByKey &&
    typeof instance.gateStatesByKey === "object"
      ? instance.gateStatesByKey[gateKey]
      : null;
  if (!gateState) {
    throwWrappedUserError("DeniedTargetAttemptFailed");
  }

  if (normalizeLowerText(gateState.state, "locked") === "locked") {
    throwWrappedUserError("CustomInfo", {
      info: "The acceleration gate is locked.",
    });
  }

  const destinationRoomKey =
    normalizeText(
      gateEntity.dungeonGateDestinationRoomKey,
      normalizeText(gateState.destinationRoomKey, ""),
    ) || null;
  if (
    destinationRoomKey &&
    instance.roomStatesByKey &&
    instance.roomStatesByKey[destinationRoomKey] &&
    normalizeLowerText(instance.roomStatesByKey[destinationRoomKey].state, "pending") === "pending"
  ) {
    instance = dungeonRuntime.activateRoom(instance.instanceID, destinationRoomKey, {
      nowMs,
      stage: destinationRoomKey === "room:entry" ? "entry" : "pocket",
    });
  }

  instance = dungeonRuntime.recordGateUse(instance.instanceID, gateKey, {
    nowMs,
    destinationRoomKey,
  });

  const siteEntity = resolveSceneEntity(scene, siteID);
  const template = dungeonAuthority.getTemplateByID(instance.templateID) || null;
  const destinationPoint = resolveGateDestinationPoint(
    siteEntity,
    gateEntity,
    instance,
    template,
    destinationRoomKey,
  );
  const teleportDirection = normalizeVector(
    subtractVectors(destinationPoint, gateEntity.position),
    shipEntity.direction || { x: 1, y: 0, z: 0 },
  );
  const warpResult = spaceRuntime.warpDynamicEntityToPoint(
    scene.systemID,
    shipEntity,
    destinationPoint,
    {
      direction: teleportDirection,
      forceImmediateStart: true,
    },
  );
  if (!warpResult || warpResult.success !== true) {
    throwWrappedUserError("DeniedTargetAttemptFailed");
  }

  const forceStartResult = spaceRuntime.forceStartPendingWarp(scene.systemID, shipEntity, {
    clearVisibilitySuppression: true,
  });
  if (!forceStartResult || forceStartResult.success !== true) {
    throwWrappedUserError("DeniedTargetAttemptFailed");
  }

  if (typeof scene.flushDirectDestinyNotificationBatchIfIdle === "function") {
    scene.flushDirectDestinyNotificationBatchIfIdle();
  }

  log.info(
    `[Keeper] ActivateAccelerationGate char=${session && session.characterID} gate=${gateKey} instance=${instanceID} destinationRoom=${destinationRoomKey || "room:entry"}`,
  );
  return null;
}

class KeeperService extends BaseService {
  constructor() {
    super("keeper");
  }

  Handle_GetCurrentDungeonForCharacter() {
    return null;
  }

  Handle_ActivateAccelerationGate(args, session) {
    const gateEntityID = args && args.length > 0 ? args[0] : null;
    return activateAccelerationGateForSession(session, gateEntityID);
  }
}

KeeperService._testing = {
  activateAccelerationGateForSession,
  resolveGateDestinationPoint,
  resolveOrderedRoomKeys,
};

module.exports = KeeperService;
