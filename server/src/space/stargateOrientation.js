"use strict";

const path = require("path");

const geo2 = require(path.join(__dirname, "../common/geo2"));

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeVector(vector, fallback = null) {
  if (!vector) {
    return fallback;
  }

  const normalized = geo2.Vec3Normalize(vector);
  if (
    Math.abs(normalized.x) <= 0 &&
    Math.abs(normalized.y) <= 0 &&
    Math.abs(normalized.z) <= 0
  ) {
    return fallback;
  }

  return normalized;
}

function subtractVectors(left, right) {
  return geo2.Vec3Subtract(left, right);
}

function coerceDunRotationTuple(value) {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }

  const yaw = Number(value[0]);
  const pitch = Number(value[1]);
  const roll = Number(value[2] || 0);
  if (![yaw, pitch, roll].every(Number.isFinite)) {
    return null;
  }

  return [yaw, pitch, roll];
}

function buildDunRotationFromNormalizedDirection(direction) {
  return coerceDunRotationTuple(
    geo2.buildDunRotationFromNormalizedDirection(direction),
  );
}

function buildDunRotationFromDirection(direction) {
  return buildDunRotationFromNormalizedDirection(normalizeVector(direction));
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

function getStargateSystemForwardDirection(stargate, sourceSystem, destinationSystem) {
  if (!stargate || !sourceSystem || !destinationSystem) {
    return null;
  }

  return normalizeVector(
    subtractVectors(destinationSystem.position, sourceSystem.position),
  );
}

function getResolvedStargateForwardDirection(
  stargate,
  sourceSystem,
  destinationSystem,
  fallback = null,
) {
  return (
    getDirectionFromDunRotation(stargate && stargate.dunRotation) ||
    getStargateSystemForwardDirection(stargate, sourceSystem, destinationSystem) ||
    normalizeVector(stargate && stargate.position, fallback)
  );
}

function getResolvedStargateDunRotation(stargate, sourceSystem, destinationSystem) {
  return (
    coerceDunRotationTuple(stargate && stargate.dunRotation) ||
    buildDunRotationFromNormalizedDirection(
      getStargateSystemForwardDirection(stargate, sourceSystem, destinationSystem),
    )
  );
}

module.exports = {
  buildDunRotationFromDirection,
  buildDunRotationFromNormalizedDirection,
  coerceDunRotationTuple,
  getDirectionFromDunRotation,
  getResolvedStargateDunRotation,
  getResolvedStargateForwardDirection,
  getStargateSystemForwardDirection,
};
