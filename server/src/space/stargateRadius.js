"use strict";

const path = require("path");

const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../services/inventory/itemTypeRegistry"));

const DEFAULT_STARGATE_PHYSICAL_RADIUS_METERS = 15_000;
const PHYSICAL_RADIUS_FIELDS = Object.freeze([
  "physicalRadius",
  "ballRadius",
  "destinyRadius",
  "typeRadius",
]);

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveRadius(value) {
  const radius = toFiniteNumber(value, 0);
  return radius > 0 ? radius : 0;
}

function resolveStargateTypeRadius(typeID) {
  const typeRecord = resolveItemByTypeID(Number(typeID) || 0);
  return toPositiveRadius(typeRecord && typeRecord.radius);
}

function resolveExplicitPhysicalRadius(stargate) {
  if (!stargate || typeof stargate !== "object") {
    return 0;
  }

  for (const fieldName of PHYSICAL_RADIUS_FIELDS) {
    const radius = toPositiveRadius(stargate[fieldName]);
    if (radius > 0) {
      return radius;
    }
  }

  return 0;
}

function resolveStargatePhysicalRadius(stargate, options = {}) {
  const explicitRadius = resolveExplicitPhysicalRadius(stargate);
  if (explicitRadius > 0) {
    return explicitRadius;
  }

  const typeRadius = resolveStargateTypeRadius(stargate && stargate.typeID);
  if (typeRadius > 0) {
    return typeRadius;
  }

  const instanceRadius = toPositiveRadius(stargate && stargate.radius);
  if (instanceRadius > 0) {
    return instanceRadius;
  }

  return toPositiveRadius(options.fallbackRadius) ||
    DEFAULT_STARGATE_PHYSICAL_RADIUS_METERS;
}

module.exports = {
  DEFAULT_STARGATE_PHYSICAL_RADIUS_METERS,
  resolveStargatePhysicalRadius,
  resolveStargateTypeRadius,
};
