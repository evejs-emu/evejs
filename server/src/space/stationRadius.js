"use strict";

const path = require("path");

const worldData = require(path.join(__dirname, "./worldData"));

const DEFAULT_STATION_PHYSICAL_RADIUS_METERS = 15_000;
const PHYSICAL_RADIUS_FIELDS = Object.freeze([
  "physicalRadius",
  "ballRadius",
  "destinyRadius",
]);

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveRadius(value) {
  const radius = toFiniteNumber(value, 0);
  return radius > 0 ? radius : 0;
}

function getStationTypeID(station) {
  return Math.trunc(Number(
    station && (
      station.stationTypeID ||
      station.typeID ||
      station.typeId
    ),
  ) || 0);
}

function resolveExplicitPhysicalRadius(source) {
  if (!source || typeof source !== "object") {
    return 0;
  }

  for (const fieldName of PHYSICAL_RADIUS_FIELDS) {
    const radius = toPositiveRadius(source[fieldName]);
    if (radius > 0) {
      return radius;
    }
  }

  return 0;
}

function resolveStationType(station, options = {}) {
  if (options.stationType && typeof options.stationType === "object") {
    return options.stationType;
  }

  const stationTypeID = getStationTypeID(station);
  if (stationTypeID <= 0) {
    return null;
  }

  if (typeof options.stationTypeByID === "function") {
    return options.stationTypeByID(stationTypeID) || null;
  }

  return worldData.getStationTypeByID(stationTypeID) || null;
}

function describeStationPhysicalRadius(station, options = {}) {
  const explicitRadius = resolveExplicitPhysicalRadius(station);
  if (explicitRadius > 0) {
    return {
      radius: explicitRadius,
      source: "station.physicalRadius",
    };
  }

  const stationType = resolveStationType(station, options);
  const typeExplicitRadius = resolveExplicitPhysicalRadius(stationType);
  if (typeExplicitRadius > 0) {
    return {
      radius: typeExplicitRadius,
      source: "stationType.physicalRadius",
    };
  }

  const stationRadius = toPositiveRadius(station && station.radius);
  if (stationRadius > 0) {
    return {
      radius: stationRadius,
      source: "station.radius",
    };
  }

  const typeRadius = toPositiveRadius(stationType && stationType.radius);
  if (typeRadius > 0) {
    return {
      radius: typeRadius,
      source: "stationType.radius",
    };
  }

  const interactionRadius = toPositiveRadius(station && station.interactionRadius);
  if (interactionRadius > 0) {
    return {
      radius: interactionRadius,
      source: "station.interactionRadius",
    };
  }

  const fallbackRadius = toPositiveRadius(options.fallbackRadius) ||
    DEFAULT_STATION_PHYSICAL_RADIUS_METERS;
  return {
    radius: fallbackRadius,
    source: "fallback",
  };
}

function resolveStationPhysicalRadius(station, options = {}) {
  return describeStationPhysicalRadius(station, options).radius;
}

module.exports = {
  DEFAULT_STATION_PHYSICAL_RADIUS_METERS,
  PHYSICAL_RADIUS_FIELDS,
  describeStationPhysicalRadius,
  resolveExplicitPhysicalRadius,
  resolveStationPhysicalRadius,
};
