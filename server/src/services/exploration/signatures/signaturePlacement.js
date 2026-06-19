const path = require("path");

const explorationAuthority = require(path.join(__dirname, "..", "explorationAuthority"));

const DEFAULT_AU_METERS = Number(explorationAuthority.getScanContracts().auMeters) || 149_597_870_700;
const DEFAULT_SIGNATURE_ANCHOR_DISTANCE_AU = 4;
const DEFAULT_SIGNATURE_DISTANCE_JITTER_AU = 0.45;
const DEFAULT_SIGNATURE_VERTICAL_JITTER_AU = 0.18;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneVector(vector = null, fallback = { x: 0, y: 0, z: 0 }) {
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

function scaleVector(vector, scalar) {
  return {
    x: toFiniteNumber(vector && vector.x, 0) * toFiniteNumber(scalar, 0),
    y: toFiniteNumber(vector && vector.y, 0) * toFiniteNumber(scalar, 0),
    z: toFiniteNumber(vector && vector.z, 0) * toFiniteNumber(scalar, 0),
  };
}

function magnitude(vector) {
  const x = toFiniteNumber(vector && vector.x, 0);
  const y = toFiniteNumber(vector && vector.y, 0);
  const z = toFiniteNumber(vector && vector.z, 0);
  return Math.sqrt((x ** 2) + (y ** 2) + (z ** 2));
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const numeric = cloneVector(vector, fallback);
  const length = magnitude(numeric);
  if (!Number.isFinite(length) || length <= 0) {
    return cloneVector(fallback);
  }
  return scaleVector(numeric, 1 / length);
}

function distanceBetween(left, right) {
  return magnitude({
    x: toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0),
  });
}

function hashSeed(seed) {
  const normalized = String(seed == null ? "" : seed);
  let state = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    state = Math.imul(state ^ normalized.charCodeAt(index), 0x45d9f3b);
    state ^= state >>> 16;
  }
  state = Math.imul(state ^ (state >>> 16), 0x45d9f3b);
  state ^= state >>> 16;
  return state >>> 0;
}

function buildAnchorRelativeSignaturePlacement(anchorCandidates = [], seed, options = {}) {
  const candidates = (Array.isArray(anchorCandidates) ? anchorCandidates : [])
    .filter((entry) => entry && typeof entry === "object");
  const fallbackAnchor = {
    itemID: toInt(options.fallbackAnchorItemID, 0) || null,
    position: cloneVector(options.fallbackPosition, {
      x: DEFAULT_AU_METERS * DEFAULT_SIGNATURE_ANCHOR_DISTANCE_AU,
      y: 0,
      z: 0,
    }),
  };
  const resolvedCandidates = candidates.length > 0 ? candidates : [fallbackAnchor];
  const anchorIndex = hashSeed(`${seed}:anchor`) % resolvedCandidates.length;
  const anchor = resolvedCandidates[anchorIndex] || resolvedCandidates[0] || fallbackAnchor;
  const baseDistanceAu = Math.max(
    0.5,
    toFiniteNumber(options.baseDistanceAu, DEFAULT_SIGNATURE_ANCHOR_DISTANCE_AU),
  );
  const distanceJitterAu = Math.max(
    0,
    toFiniteNumber(options.distanceJitterAu, DEFAULT_SIGNATURE_DISTANCE_JITTER_AU),
  );
  const verticalJitterAu = Math.max(
    0,
    toFiniteNumber(options.verticalJitterAu, DEFAULT_SIGNATURE_VERTICAL_JITTER_AU),
  );
  const auMeters = Math.max(1, toFiniteNumber(options.auMeters, DEFAULT_AU_METERS));
  const yaw = ((hashSeed(`${seed}:yaw`) % 360_000) / 360_000) * Math.PI * 2;
  const pitchOffset = (((hashSeed(`${seed}:pitch`) % 200_001) / 100_000) - 1) * verticalJitterAu;
  const direction = normalizeVector({
    x: Math.cos(pitchOffset) * Math.cos(yaw),
    y: Math.sin(pitchOffset),
    z: Math.cos(pitchOffset) * Math.sin(yaw),
  });
  const distanceAu = baseDistanceAu +
    ((((hashSeed(`${seed}:distance`) % 200_001) / 100_000) - 1) * distanceJitterAu);
  const distanceMeters = Math.max(0.5 * auMeters, distanceAu * auMeters);
  const anchorPosition = cloneVector(anchor && anchor.position);

  return {
    anchorIndex,
    anchorItemID: toInt(anchor && anchor.itemID, 0) || null,
    anchorPosition,
    direction,
    distanceAu,
    distanceMeters,
    position: addVectors(anchorPosition, scaleVector(direction, distanceMeters)),
  };
}

function estimateNearestAnchorDistanceMeters(position, anchorCandidates = []) {
  const candidates = (Array.isArray(anchorCandidates) ? anchorCandidates : [])
    .filter((entry) => entry && entry.position && typeof entry.position === "object");
  if (candidates.length <= 0) {
    return 0;
  }
  return candidates.reduce((best, anchor) => {
    const nextDistance = distanceBetween(position, anchor.position);
    return best === null || nextDistance < best ? nextDistance : best;
  }, null) || 0;
}

module.exports = {
  DEFAULT_AU_METERS,
  DEFAULT_SIGNATURE_ANCHOR_DISTANCE_AU,
  buildAnchorRelativeSignaturePlacement,
  estimateNearestAnchorDistanceMeters,
};
