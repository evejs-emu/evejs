const path = require("path");

const structureLocatorGeometry = require(path.join(
  __dirname,
  "./structureLocatorGeometry",
));

const DEFAULT_RIGHT = Object.freeze({ x: 1, y: 0, z: 0 });

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
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

function scaleVector(vector, scalar) {
  return {
    x: toFiniteNumber(vector && vector.x, 0) * scalar,
    y: toFiniteNumber(vector && vector.y, 0) * scalar,
    z: toFiniteNumber(vector && vector.z, 0) * scalar,
  };
}

function magnitude(vector) {
  const resolved = cloneVector(vector);
  return Math.sqrt((resolved.x ** 2) + (resolved.y ** 2) + (resolved.z ** 2));
}

function normalizeVector(vector, fallback = DEFAULT_RIGHT) {
  const resolved = cloneVector(vector, fallback);
  const length = magnitude(resolved);
  if (!Number.isFinite(length) || length <= 0) {
    return cloneVector(fallback);
  }
  return scaleVector(resolved, 1 / length);
}

function getStructureSpaceDirection(structure, options = {}) {
  return structureLocatorGeometry.getStructureSpaceDirection(structure, options);
}

function buildStructureUndockSpawnState(structure, options = {}) {
  return structureLocatorGeometry.buildStructureUndockSpawnState(structure, {
    shipTypeID: options.shipTypeID,
    selectionStrategy: options.selectionStrategy || "hash",
    selectionKey:
      options.selectionKey ??
      options.shipID ??
      options.characterID ??
      null,
    extraUndockDistance: Math.max(
      0,
      toFiniteNumber(options.extraDistance, 0),
    ),
    random: options.random,
  });
}

function buildStructureScatterPosition(structure, index = 0, options = {}) {
  const resolvedIndex = Math.max(0, Math.trunc(Number(index) || 0));
  const radius = Math.max(
    Math.max(0, toFiniteNumber(structure && structure.radius, 0)) + 6000,
    Math.max(0, toFiniteNumber(options.scatterRadius, 0)) || 12000,
  );
  const angle = ((resolvedIndex % 8) / 8) * (Math.PI * 2);
  return addVectors(cloneVector(structure && structure.position), {
    x: Math.cos(angle) * radius,
    y: 0,
    z: Math.sin(angle) * radius,
  });
}

function buildStructureEmergencySpaceState(structure, index = 0, options = {}) {
  const spawnState = buildStructureUndockSpawnState(structure, {
    shipTypeID: options.shipTypeID,
    selectionStrategy: options.selectionStrategy || "hash",
    selectionKey:
      options.selectionKey ??
      options.shipID ??
      options.characterID ??
      null,
    extraDistance: Math.max(0, Math.trunc(Number(index) || 0)) * 350,
    random: options.random,
  });
  return {
    systemID: Number(structure && structure.solarSystemID) || 0,
    position: spawnState.position,
    direction: spawnState.direction,
    velocity: { x: 0, y: 0, z: 0 },
    targetPoint: spawnState.position,
    mode: "STOP",
    speedFraction: 0,
    ...(options || {}),
  };
}

module.exports = {
  DEFAULT_RIGHT,
  toFiniteNumber,
  cloneVector,
  addVectors,
  scaleVector,
  magnitude,
  normalizeVector,
  getStructureSpaceDirection,
  buildStructureUndockSpawnState,
  buildStructureScatterPosition,
  buildStructureEmergencySpaceState,
};
