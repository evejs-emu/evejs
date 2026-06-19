const path = require("path");

const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const {
  ONE_AU_IN_METERS,
  findSafeWarpOriginAnchor,
} = require(path.join(__dirname, "../../space/npc/npcWarpOrigins"));
const worldData = require(path.join(__dirname, "../../space/worldData"));

function normalizeInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.trunc(numeric);
}

function normalizePositiveInteger(value, fallback = null) {
  const numeric = normalizeInteger(value, 0);
  return numeric > 0 ? numeric : fallback;
}

function normalizeSpacePoint(value, fallback = null) {
  if (!value || typeof value !== "object") {
    return fallback;
  }
  const x = Number(value.x);
  const y = Number(value.y);
  const z = Number(value.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return fallback;
  }
  return { x, y, z };
}

function cloneSpacePoint(value, fallback = null) {
  const point = normalizeSpacePoint(value, fallback);
  return point ? { ...point } : fallback;
}

function addOffset(point, offset) {
  const basePoint = normalizeSpacePoint(point, null);
  const offsetPoint = normalizeSpacePoint(offset, null);
  if (!basePoint || !offsetPoint) {
    return null;
  }
  return {
    x: basePoint.x + offsetPoint.x,
    y: basePoint.y + offsetPoint.y,
    z: basePoint.z + offsetPoint.z,
  };
}

function magnitude(vector) {
  const point = normalizeSpacePoint(vector, { x: 0, y: 0, z: 0 });
  return Math.sqrt(
    (point.x * point.x) +
    (point.y * point.y) +
    (point.z * point.z),
  );
}

function normalizeDirection(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const point = normalizeSpacePoint(vector, fallback);
  const length = magnitude(point);
  if (length <= 1e-9) {
    return { ...fallback };
  }
  return {
    x: point.x / length,
    y: point.y / length,
    z: point.z / length,
  };
}

function buildOffsetPosition(anchor, options = {}) {
  const anchorPosition = cloneSpacePoint(anchor && anchor.position, {
    x: 0,
    y: 0,
    z: 0,
  });
  const fallbackDirection = normalizeDirection(
    options.fallbackDirection,
    { x: 1, y: 0, z: 0 },
  );
  const direction = normalizeDirection(
    magnitude(anchorPosition) > 0 ? anchorPosition : fallbackDirection,
    fallbackDirection,
  );
  const minOffset = Math.max(Number(options.minOffset) || 0, 0);
  const clearance = Math.max(Number(options.clearance) || 0, 0);
  const anchorRadius = Math.max(Number(anchor && anchor.radius) || 0, 0);
  const offset = Math.max(anchorRadius + clearance, minOffset);
  return {
    direction,
    position: addOffset(anchorPosition, {
      x: direction.x * offset,
      y: direction.y * offset,
      z: direction.z * offset,
    }),
  };
}

function buildSystemReferenceAnchor(solarSystemID) {
  const stargates = worldData.getStargatesForSystem(solarSystemID);
  if (stargates.length > 0) {
    const stargate = stargates[0];
    return buildOffsetPosition(stargate, {
      minOffset: Math.max((Number(stargate.radius) || 15000) * 0.4, 5000),
    });
  }

  const stations = worldData.getStationsForSystem(solarSystemID);
  if (stations.length > 0) {
    const station = stations[0];
    return buildOffsetPosition(station, {
      minOffset: Math.max((Number(station.radius) || 15000) * 0.4, 5000),
      clearance: 5000,
    });
  }

  const celestials = worldData.getCelestialsForSystem(solarSystemID);
  const celestial =
    celestials.find((entry) => entry.kind !== "sun" && Number(entry.groupID) !== 6) ||
    celestials.find((entry) => entry.kind === "sun" || Number(entry.groupID) === 6) ||
    celestials[0] ||
    null;
  if (celestial) {
    return buildOffsetPosition(celestial, {
      minOffset: 100000,
      clearance:
        celestial.kind === "sun" || Number(celestial.groupID) === 6
          ? 250000
          : 25000,
    });
  }

  return {
    direction: { x: 1, y: 0, z: 0 },
    position: { x: 1_000_000, y: 0, z: 0 },
  };
}

const CLAIM_TCU_OFFSET = Object.freeze({ x: 15000, y: 0, z: 0 });
const CLAIM_IHUB_OFFSET = Object.freeze({ x: -15000, y: 0, z: 15000 });

function buildDefaultAnchorOrigin(solarSystemID) {
  const referenceAnchor = buildSystemReferenceAnchor(solarSystemID);
  const scene = spaceRuntime.ensureScene(
    normalizePositiveInteger(solarSystemID, 0),
  );
  if (scene && referenceAnchor && referenceAnchor.position) {
    const safeOrigin = findSafeWarpOriginAnchor(
      scene,
      {
        position: referenceAnchor.position,
        direction: referenceAnchor.direction,
      },
      {
        clearanceMeters: ONE_AU_IN_METERS,
        minDistanceMeters: ONE_AU_IN_METERS * 2,
        maxDistanceMeters: ONE_AU_IN_METERS * 4,
        stepMeters: ONE_AU_IN_METERS / 2,
      },
    );
    if (safeOrigin && safeOrigin.position) {
      return cloneSpacePoint(safeOrigin.position, null);
    }
  }
  if (referenceAnchor && referenceAnchor.position) {
    return cloneSpacePoint(referenceAnchor.position, null);
  }
  return {
    x: 1_000_000,
    y: 0,
    z: 0,
  };
}

function buildAnchorLayout(solarSystemID, origin = null) {
  const anchorOrigin = cloneSpacePoint(
    origin,
    buildDefaultAnchorOrigin(solarSystemID),
  );
  const tcuPoint = addOffset(anchorOrigin, CLAIM_TCU_OFFSET);
  const iHubPoint = addOffset(anchorOrigin, CLAIM_IHUB_OFFSET);
  return {
    origin: cloneSpacePoint(anchorOrigin, null),
    positionsByKind: {
      tcu: cloneSpacePoint(tcuPoint, null),
      ihub: cloneSpacePoint(iHubPoint, null),
    },
    primaryPoint: cloneSpacePoint(tcuPoint || iHubPoint, null),
  };
}

module.exports = {
  buildAnchorLayout,
  buildDefaultAnchorOrigin,
  cloneSpacePoint,
  normalizePositiveInteger,
  normalizeSpacePoint,
};
