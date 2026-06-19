const path = require("path");

const spaceRuntime = require(path.join(__dirname, "../../../space/runtime"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../../inventory/itemTypeRegistry"));
const {
  normalizeNumber,
} = require(path.join(__dirname, "../../_shared/serviceHelpers"));

const GROUP_SCANNER_PROBE = 479;
const CATEGORY_CHARGE = 8;

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function buildVector(source = null, fallback = { x: 0, y: 0, z: 0 }) {
  if (Array.isArray(source)) {
    return {
      x: toFiniteNumber(source[0], fallback.x),
      y: toFiniteNumber(source[1], fallback.y),
      z: toFiniteNumber(source[2], fallback.z),
    };
  }
  if (source && typeof source === "object") {
    return {
      x: toFiniteNumber(source.x, fallback.x),
      y: toFiniteNumber(source.y, fallback.y),
      z: toFiniteNumber(source.z, fallback.z),
    };
  }
  return { ...fallback };
}

function buildProbeSceneEntity(probe = {}, options = {}) {
  const probeID = normalizeNumber(probe && probe.probeID, 0);
  const typeID = normalizeNumber(probe && probe.typeID, 0);
  const ownerID = normalizeNumber(options.ownerID, 0);
  const systemID = normalizeNumber(options.systemID, 0);
  if (probeID <= 0 || typeID <= 0 || systemID <= 0) {
    return null;
  }

  const typeRecord = resolveItemByTypeID(typeID) || {};
  const position = buildVector(probe.pos);
  return {
    kind: "probe",
    systemID,
    itemID: probeID,
    typeID,
    groupID: normalizeNumber(typeRecord.groupID, GROUP_SCANNER_PROBE),
    categoryID: normalizeNumber(typeRecord.categoryID, CATEGORY_CHARGE),
    itemName: String(typeRecord.name || "Scanner Probe"),
    ownerID,
    position,
    velocity: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    targetPoint: { ...position },
    mode: "STOP",
    speedFraction: 0,
    mass: Math.max(1, toFiniteNumber(typeRecord.mass, 1)),
    inertia: 1,
    maxVelocity: 0,
    radius: Math.max(1, toFiniteNumber(typeRecord.radius, 10)),
    signatureRadius: Math.max(1, toFiniteNumber(typeRecord.radius, 10)),
    graphicID: normalizeNumber(typeRecord.graphicID, 0) || null,
    bubbleID: null,
    publicGridKey: null,
    departureBubbleID: null,
    departureBubbleVisibleUntilMs: 0,
    persistSpaceState: false,
    createdAtMs: Date.now(),
    expiresAtMs: null,
    slimTypeID: typeID,
    slimGroupID: normalizeNumber(typeRecord.groupID, GROUP_SCANNER_PROBE),
    slimCategoryID: normalizeNumber(typeRecord.categoryID, CATEGORY_CHARGE),
  };
}

function ensureProbeEntitiesForSession(session, probes = [], options = {}) {
  const systemID = normalizeNumber(
    options.systemID ||
      (session && (session.solarsystemid2 || session.solarsystemid)) ||
      (session && session._space && session._space.systemID),
    0,
  );
  if (systemID <= 0) {
    return [];
  }

  const scene = spaceRuntime.ensureScene(systemID);
  if (!scene) {
    return [];
  }

  const ownerID = normalizeNumber(
    options.ownerID ||
      (session && (session.characterID || session.charid || session.userid)),
    0,
  );
  const spawned = [];
  for (const probe of Array.isArray(probes) ? probes : [probes]) {
    const probeID = normalizeNumber(probe && probe.probeID, 0);
    if (probeID <= 0) {
      continue;
    }
    const existingEntity = scene.getEntityByID(probeID);
    if (existingEntity) {
      existingEntity.position = buildVector(probe.pos, existingEntity.position || undefined);
      existingEntity.targetPoint = buildVector(
        probe.destination || probe.pos,
        existingEntity.targetPoint || existingEntity.position,
      );
      continue;
    }
    const entity = buildProbeSceneEntity(probe, {
      ownerID,
      systemID,
    });
    if (!entity) {
      continue;
    }
    const spawnResult = scene.spawnDynamicEntity(entity, {
      broadcast: options.broadcast !== false,
      excludedSession: options.excludedSession || null,
    });
    if (spawnResult && spawnResult.success === true) {
      spawned.push(entity);
    }
  }
  return spawned;
}

function removeProbeEntitiesForSession(session, probeIDs = [], options = {}) {
  const systemID = normalizeNumber(
    options.systemID ||
      (session && (session.solarsystemid2 || session.solarsystemid)) ||
      (session && session._space && session._space.systemID),
    0,
  );
  if (systemID <= 0) {
    return [];
  }

  const removed = [];
  for (const probeID of Array.isArray(probeIDs) ? probeIDs : [probeIDs]) {
    const numericProbeID = normalizeNumber(probeID, 0);
    if (numericProbeID <= 0) {
      continue;
    }
    const removeResult = spaceRuntime.removeDynamicEntity(systemID, numericProbeID, {
      excludedSession: options.excludedSession || null,
      allowSessionOwned: true,
    });
    if (removeResult && removeResult.success === true) {
      removed.push(numericProbeID);
    }
  }
  return removed;
}

module.exports = {
  buildProbeSceneEntity,
  ensureProbeEntitiesForSession,
  removeProbeEntitiesForSession,
};
