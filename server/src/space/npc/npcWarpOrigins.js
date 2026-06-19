const ONE_AU_IN_METERS = 149_597_870_700;
const DEFAULT_CLEARANCE_METERS = ONE_AU_IN_METERS;
const DEFAULT_MIN_DISTANCE_METERS = ONE_AU_IN_METERS * 2;
const DEFAULT_MAX_DISTANCE_METERS = ONE_AU_IN_METERS * 4;
const DEFAULT_STEP_METERS = ONE_AU_IN_METERS / 2;

const DEFAULT_RIGHT = Object.freeze({ x: 1, y: 0, z: 0 });
const DEFAULT_UP = Object.freeze({ x: 0, y: 1, z: 0 });
const DEFAULT_FORWARD = Object.freeze({ x: 0, y: 0, z: 1 });

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
    x: toFiniteNumber(vector && vector.x, 0) * toFiniteNumber(scalar, 0),
    y: toFiniteNumber(vector && vector.y, 0) * toFiniteNumber(scalar, 0),
    z: toFiniteNumber(vector && vector.z, 0) * toFiniteNumber(scalar, 0),
  };
}

function dotProduct(left, right) {
  return (
    (toFiniteNumber(left && left.x, 0) * toFiniteNumber(right && right.x, 0)) +
    (toFiniteNumber(left && left.y, 0) * toFiniteNumber(right && right.y, 0)) +
    (toFiniteNumber(left && left.z, 0) * toFiniteNumber(right && right.z, 0))
  );
}

function crossProduct(left, right) {
  return {
    x:
      (toFiniteNumber(left && left.y, 0) * toFiniteNumber(right && right.z, 0)) -
      (toFiniteNumber(left && left.z, 0) * toFiniteNumber(right && right.y, 0)),
    y:
      (toFiniteNumber(left && left.z, 0) * toFiniteNumber(right && right.x, 0)) -
      (toFiniteNumber(left && left.x, 0) * toFiniteNumber(right && right.z, 0)),
    z:
      (toFiniteNumber(left && left.x, 0) * toFiniteNumber(right && right.y, 0)) -
      (toFiniteNumber(left && left.y, 0) * toFiniteNumber(right && right.x, 0)),
  };
}

function magnitude(vector) {
  return Math.sqrt(dotProduct(vector, vector));
}

function normalizeVector(vector, fallback = DEFAULT_RIGHT) {
  const resolved = cloneVector(vector, fallback);
  const length = magnitude(resolved);
  if (length <= 1e-9) {
    return cloneVector(fallback);
  }
  return scaleVector(resolved, 1 / length);
}

function distanceSquared(left, right) {
  const delta = subtractVectors(left, right);
  return dotProduct(delta, delta);
}

function buildPerpendicular(direction) {
  const resolvedDirection = normalizeVector(direction, DEFAULT_RIGHT);
  const firstPass = crossProduct(resolvedDirection, DEFAULT_UP);
  if (magnitude(firstPass) > 1e-6) {
    return normalizeVector(firstPass, DEFAULT_RIGHT);
  }
  return normalizeVector(
    crossProduct(resolvedDirection, DEFAULT_RIGHT),
    DEFAULT_FORWARD,
  );
}

function uniqueDirections(vectors) {
  const unique = [];
  const seen = new Set();
  for (const vector of vectors) {
    const normalized = normalizeVector(vector, DEFAULT_RIGHT);
    const key = [
      normalized.x.toFixed(6),
      normalized.y.toFixed(6),
      normalized.z.toFixed(6),
    ].join(":");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(normalized);
  }
  return unique;
}

function buildSearchDirections(targetDirection) {
  const towardTarget = normalizeVector(targetDirection, DEFAULT_RIGHT);
  const awayFromTarget = normalizeVector(scaleVector(towardTarget, -1), {
    x: -1,
    y: 0,
    z: 0,
  });
  const right = buildPerpendicular(towardTarget);
  const up = normalizeVector(crossProduct(right, towardTarget), DEFAULT_UP);

  return uniqueDirections([
    awayFromTarget,
    towardTarget,
    right,
    scaleVector(right, -1),
    up,
    scaleVector(up, -1),
    addVectors(awayFromTarget, right),
    subtractVectors(awayFromTarget, right),
    addVectors(awayFromTarget, up),
    subtractVectors(awayFromTarget, up),
    addVectors(addVectors(awayFromTarget, right), up),
    addVectors(subtractVectors(awayFromTarget, right), up),
    subtractVectors(addVectors(awayFromTarget, right), up),
    subtractVectors(subtractVectors(awayFromTarget, right), up),
    DEFAULT_RIGHT,
    scaleVector(DEFAULT_RIGHT, -1),
    DEFAULT_UP,
    scaleVector(DEFAULT_UP, -1),
    DEFAULT_FORWARD,
    scaleVector(DEFAULT_FORWARD, -1),
  ]);
}

function collectSceneAnchors(scene, options = {}) {
  const anchors = [];
  const excludedEntityIDs = new Set(
    Array.isArray(options.excludeEntityIDs)
      ? options.excludeEntityIDs
        .map((value) => toPositiveInt(value, 0))
        .filter((value) => value > 0)
      : [],
  );

  const noteEntity = (entity) => {
    if (!entity || !entity.position) {
      return;
    }
    const entityID = toPositiveInt(entity.itemID, 0);
    if (entityID > 0 && excludedEntityIDs.has(entityID)) {
      return;
    }
    anchors.push({
      entityID,
      position: cloneVector(entity.position),
      radius: Math.max(0, toFiniteNumber(entity.radius, 0)),
    });
  };

  const staticEntities = Array.isArray(scene && scene.staticEntities)
    ? scene.staticEntities
    : [];
  for (const entity of staticEntities) {
    noteEntity(entity);
  }

  const dynamicEntities =
    scene && scene.dynamicEntities instanceof Map
      ? [...scene.dynamicEntities.values()]
      : [];
  for (const entity of dynamicEntities) {
    noteEntity(entity);
  }

  return anchors;
}

function measureNearestSurfaceDistanceMeters(position, anchors) {
  let nearestSurfaceDistanceMeters = Number.POSITIVE_INFINITY;
  for (const anchor of anchors) {
    const surfaceDistanceMeters = Math.sqrt(
      distanceSquared(position, anchor.position),
    ) - Math.max(0, toFiniteNumber(anchor.radius, 0));
    if (surfaceDistanceMeters < nearestSurfaceDistanceMeters) {
      nearestSurfaceDistanceMeters = surfaceDistanceMeters;
    }
  }
  return nearestSurfaceDistanceMeters;
}

function findSafeWarpOriginAnchor(scene, target, options = {}) {
  const targetPosition = cloneVector(
    target && target.position ? target.position : target,
  );
  const targetDirection = normalizeVector(
    target && target.direction ? target.direction : options.direction,
    DEFAULT_RIGHT,
  );
  const clearanceMeters = Math.max(
    1,
    toFiniteNumber(options.clearanceMeters, DEFAULT_CLEARANCE_METERS),
  );
  const minDistanceMeters = Math.max(
    clearanceMeters + 1,
    toFiniteNumber(options.minDistanceMeters, DEFAULT_MIN_DISTANCE_METERS),
  );
  const maxDistanceMeters = Math.max(
    minDistanceMeters,
    toFiniteNumber(options.maxDistanceMeters, DEFAULT_MAX_DISTANCE_METERS),
  );
  const stepMeters = Math.max(
    1,
    toFiniteNumber(options.stepMeters, DEFAULT_STEP_METERS),
  );
  const anchors = collectSceneAnchors(scene, options);
  const fallbackPosition = addVectors(
    targetPosition,
    scaleVector(
      normalizeVector(scaleVector(targetDirection, -1), {
        x: -1,
        y: 0,
        z: 0,
      }),
      minDistanceMeters,
    ),
  );

  let bestCandidate = null;
  for (const direction of buildSearchDirections(targetDirection)) {
    for (
      let distanceMeters = minDistanceMeters;
      distanceMeters <= maxDistanceMeters + 1;
      distanceMeters += stepMeters
    ) {
      const candidatePosition = addVectors(
        targetPosition,
        scaleVector(direction, distanceMeters),
      );
      const nearestSurfaceDistanceMeters =
        measureNearestSurfaceDistanceMeters(candidatePosition, anchors);
      if (nearestSurfaceDistanceMeters >= clearanceMeters) {
        return {
          position: candidatePosition,
          direction: normalizeVector(
            subtractVectors(targetPosition, candidatePosition),
            targetDirection,
          ),
          distanceMeters,
          nearestSurfaceDistanceMeters,
          clearanceMeters,
          clearanceSatisfied: true,
        };
      }
      if (
        !bestCandidate ||
        nearestSurfaceDistanceMeters > bestCandidate.nearestSurfaceDistanceMeters
      ) {
        bestCandidate = {
          position: candidatePosition,
          direction: normalizeVector(
            subtractVectors(targetPosition, candidatePosition),
            targetDirection,
          ),
          distanceMeters,
          nearestSurfaceDistanceMeters,
          clearanceMeters,
          clearanceSatisfied: false,
        };
      }
    }
  }

  return bestCandidate || {
    position: fallbackPosition,
    direction: normalizeVector(
      subtractVectors(targetPosition, fallbackPosition),
      targetDirection,
    ),
    distanceMeters: minDistanceMeters,
    nearestSurfaceDistanceMeters: Number.NEGATIVE_INFINITY,
    clearanceMeters,
    clearanceSatisfied: false,
  };
}

module.exports = {
  ONE_AU_IN_METERS,
  DEFAULT_CLEARANCE_METERS,
  DEFAULT_MIN_DISTANCE_METERS,
  DEFAULT_MAX_DISTANCE_METERS,
  DEFAULT_STEP_METERS,
  findSafeWarpOriginAnchor,
};
