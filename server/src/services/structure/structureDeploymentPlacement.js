"use strict";

const path = require("path");

const { resolveItemByTypeID } = require(path.join(
  __dirname,
  "../inventory/itemTypeRegistry",
));
const { getClientParityWarpInPoint } = require(path.join(
  __dirname,
  "../../space/destiny/simulation/warpInPointParity",
));
const worldData = require(path.join(__dirname, "../../space/worldData"));

const CATEGORY_CELESTIAL = 2;
const CATEGORY_STATION = 3;
const CATEGORY_SHIP = 6;
const CATEGORY_ENTITY = 11;
const CATEGORY_DRONE = 18;
const CATEGORY_DEPLOYABLE = 22;
const CATEGORY_STARBASE = 23;
const CATEGORY_ASTEROID = 25;
const CATEGORY_SOVEREIGNTY_STRUCTURE = 40;
const CATEGORY_ORBITAL = 46;
const CATEGORY_STRUCTURE = 65;
const CATEGORY_FIGHTER = 87;

const GROUP_STARGATE = 10;
const GROUP_CARGO_CONTAINER = 12;
const GROUP_BIOMASS = 14;
const GROUP_WRECK = 186;
const GROUP_LARGE_COLLIDABLE_OBJECT = 226;
const GROUP_SPAWN_CONTAINER = 306;
const GROUP_SECURE_CARGO_CONTAINER = 340;
const GROUP_AUDIT_LOG_SECURE_CONTAINER = 448;
const GROUP_FREIGHT_CONTAINER = 649;
const GROUP_CONTROL_BUNKER = 925;
const GROUP_INFRASTRUCTURE_HUB = 1012;
const GROUP_ENCOUNTER_SURVEILLANCE_SYSTEM = 1273;
const GROUP_STRUCTURE_DRILLING_PLATFORM = 1406;
const GROUP_STRUCTURE_JUMP_BRIDGE = 1408;
const GROUP_MOON_MINING_BEACON = 1915;
const GROUP_INDUSTRIAL_SUPPORT_FACILITY = 1978;
const GROUP_STATION_CONVERSION_MONUMENT = 1998;
const GROUP_STRUCTURE_CYNO_JAMMER = 2016;
const GROUP_STRUCTURE_CYNO_BEACON = 2017;
const GROUP_STRUCTURE_NPC_ENGINEERING_COMPLEX = 1876;
const GROUP_UPWELL_MOON_DRILL = 4744;
const GROUP_MOON = 8;

const DEPLOYMENT_POINT_TYPE = Object.freeze({
  WARPIN_POINT: 1,
  REAL_BALL: 2,
});

const GROUP_DISTANCE = Object.freeze({
  [GROUP_MOON_MINING_BEACON]: 0,
  [GROUP_BIOMASS]: 5000,
  [GROUP_WRECK]: 5000,
  [GROUP_CARGO_CONTAINER]: 5000,
  [GROUP_SPAWN_CONTAINER]: 5000,
  [GROUP_SECURE_CARGO_CONTAINER]: 5000,
  [GROUP_AUDIT_LOG_SECURE_CONTAINER]: 5000,
  [GROUP_FREIGHT_CONTAINER]: 5000,
  [GROUP_INDUSTRIAL_SUPPORT_FACILITY]: 5000,
  [GROUP_STATION_CONVERSION_MONUMENT]: 100000,
  [GROUP_LARGE_COLLIDABLE_OBJECT]: 100000,
  [GROUP_ENCOUNTER_SURVEILLANCE_SYSTEM]: 1000000,
  [GROUP_STRUCTURE_NPC_ENGINEERING_COMPLEX]: 2000000,
  [GROUP_CONTROL_BUNKER]: 1000000,
  [GROUP_STRUCTURE_JUMP_BRIDGE]: 500000,
  [GROUP_STRUCTURE_CYNO_JAMMER]: 500000,
  [GROUP_STRUCTURE_CYNO_BEACON]: 200000,
  [GROUP_INFRASTRUCTURE_HUB]: 10000000,
});

const CATEGORY_DISTANCE = Object.freeze({
  [CATEGORY_ENTITY]: 5000,
  [CATEGORY_SHIP]: 5000,
  [CATEGORY_DRONE]: 5000,
  [CATEGORY_FIGHTER]: 5000,
  [CATEGORY_DEPLOYABLE]: 5000,
  [CATEGORY_ASTEROID]: 5000,
  [CATEGORY_CELESTIAL]: 1000000,
  [CATEGORY_ORBITAL]: 1000000,
  [CATEGORY_SOVEREIGNTY_STRUCTURE]: 1000000,
  [CATEGORY_STATION]: 1000000,
  [CATEGORY_STARBASE]: 1000000,
  [CATEGORY_STRUCTURE]: 1000000,
});

const GROUP_MIN_DISTANCE_TO_STARGATE = Object.freeze({
  [GROUP_STRUCTURE_JUMP_BRIDGE]: 100000000,
});

const MINIMUM_MOON_DISTANCE = 4000000;
const MAXIMUM_MINING_BEACON_DISTANCE = 250000;
const DEPLOY_DIST_MAX = 800000;

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  const integer = Math.trunc(numeric);
  return integer > 0 ? integer : fallback;
}

function cloneVector(value, fallback = { x: 0, y: 0, z: 0 }) {
  const fallbackVector = fallback && typeof fallback === "object"
    ? fallback
    : { x: 0, y: 0, z: 0 };
  if (!value || typeof value !== "object") {
    if (!fallback || typeof fallback !== "object") {
      return null;
    }
    return {
      x: toFiniteNumber(fallbackVector.x, 0),
      y: toFiniteNumber(fallbackVector.y, 0),
      z: toFiniteNumber(fallbackVector.z, 0),
    };
  }
  const source = value;
  return {
    x: toFiniteNumber(source.x, fallbackVector.x),
    y: toFiniteNumber(source.y, fallbackVector.y),
    z: toFiniteNumber(source.z, fallbackVector.z),
  };
}

function distanceBetween(left, right) {
  const a = cloneVector(left);
  const b = cloneVector(right);
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
}

function resolveTypeRecord(typeID) {
  return resolveItemByTypeID(typeID) || null;
}

function getTypeGroupID(typeID) {
  const record = resolveTypeRecord(typeID);
  return toPositiveInt(record && record.groupID, 0);
}

function getTypeCategoryID(typeID) {
  const record = resolveTypeRecord(typeID);
  return toPositiveInt(record && record.categoryID, 0);
}

function getTypeRadius(typeID) {
  const record = resolveTypeRecord(typeID);
  return Math.max(0, toFiniteNumber(record && record.radius, 0));
}

function getDeploymentDistance(typeID) {
  const groupID = getTypeGroupID(typeID);
  const categoryID = getTypeCategoryID(typeID);
  return GROUP_DISTANCE[groupID] ?? CATEGORY_DISTANCE[categoryID] ?? 0;
}

function isDrillingPlatform(typeID) {
  const groupID = getTypeGroupID(typeID);
  return groupID === GROUP_STRUCTURE_DRILLING_PLATFORM ||
    groupID === GROUP_UPWELL_MOON_DRILL;
}

function hasGroupStargateRestriction(groupID) {
  return Object.prototype.hasOwnProperty.call(
    GROUP_MIN_DISTANCE_TO_STARGATE,
    groupID,
  );
}

function isStargate(typeID) {
  return getTypeGroupID(typeID) === GROUP_STARGATE;
}

function isBallMoon(ballTypeID, pointType) {
  return pointType === DEPLOYMENT_POINT_TYPE.REAL_BALL &&
    getTypeGroupID(ballTypeID) === GROUP_MOON;
}

function normalizeBallEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const typeID = toPositiveInt(entry.typeID, 0);
  const itemID = toPositiveInt(entry.itemID || entry.structureID || entry.stationID, 0);
  const position = cloneVector(entry.position, null);
  if (!itemID || !typeID || !position) {
    return null;
  }
  return {
    itemID,
    typeID,
    position,
    radius: Math.max(0, toFiniteNumber(entry.radius || entry.interactionRadius, getTypeRadius(typeID))),
    pointType: DEPLOYMENT_POINT_TYPE.REAL_BALL,
  };
}

function buildStaticFallbackBalls(solarSystemID) {
  const systemID = toPositiveInt(solarSystemID, 0);
  if (!systemID) {
    return [];
  }
  const staticRows = [
    ...worldData.getStationsForSystem(systemID).map((station) => ({
      ...station,
      itemID: station.stationID,
      typeID: station.stationTypeID,
    })),
    ...worldData.getStructuresForSystem(systemID).map((structure) => ({
      ...structure,
      itemID: structure.structureID,
    })),
    ...worldData.getAsteroidBeltsForSystem(systemID),
    ...worldData.getCelestialsForSystem(systemID),
    ...worldData.getStargatesForSystem(systemID),
  ];
  return staticRows.map(normalizeBallEntry).filter(Boolean);
}

function buildSceneBalls(scene, options = {}) {
  if (!scene || typeof scene !== "object") {
    return [];
  }
  const includeDynamic = options.includeDynamic !== false;
  const balls = [];
  const push = (entity) => {
    if (!entity || entity.destroyedAt) {
      return;
    }
    const normalized = normalizeBallEntry(entity);
    if (normalized) {
      balls.push(normalized);
    }
  };
  for (const entity of Array.isArray(scene.staticEntities) ? scene.staticEntities : []) {
    push(entity);
  }
  if (includeDynamic && scene.dynamicEntities instanceof Map) {
    for (const entity of scene.dynamicEntities.values()) {
      push(entity);
    }
  }
  return balls;
}

function appendWarpInPoints(balls) {
  const output = [];
  for (const ball of balls) {
    output.push(ball);
    const warpInPoint = getClientParityWarpInPoint({
      itemID: ball.itemID,
      typeID: ball.typeID,
      groupID: getTypeGroupID(ball.typeID),
      categoryID: getTypeCategoryID(ball.typeID),
      radius: ball.radius,
      position: ball.position,
    });
    if (!warpInPoint) {
      continue;
    }
    output.push({
      itemID: ball.itemID,
      typeID: ball.typeID,
      position: warpInPoint,
      radius: 0,
      pointType: DEPLOYMENT_POINT_TYPE.WARPIN_POINT,
    });
  }
  return output;
}

function findMoonBeaconInRange(solarSystemID, location, maxRange = MAXIMUM_MINING_BEACON_DISTANCE) {
  const systemID = toPositiveInt(solarSystemID, 0);
  if (!systemID) {
    return null;
  }
  for (const ball of buildStaticFallbackBalls(systemID)) {
    if (getTypeGroupID(ball.typeID) !== GROUP_MOON_MINING_BEACON) {
      continue;
    }
    if (distanceBetween(location, ball.position) < maxRange) {
      return ball.itemID;
    }
  }
  return null;
}

function findDeploymentConflict(solarSystemID, typeID, location, balls) {
  const deployedTypeID = toPositiveInt(typeID, 0);
  const deployedGroupID = getTypeGroupID(deployedTypeID);
  const deployedRadius = getTypeRadius(deployedTypeID);
  const myDeploymentDistance = getDeploymentDistance(deployedTypeID);
  const drillingPlatform = isDrillingPlatform(deployedTypeID);
  const stargateRestricted = hasGroupStargateRestriction(deployedGroupID);

  for (const ball of Array.isArray(balls) ? balls : []) {
    if (!ball || !ball.typeID || !ball.position) {
      continue;
    }
    const distance = distanceBetween(location, ball.position);
    const blockerRadius = Math.max(0, toFiniteNumber(ball.radius, 0));
    const blockerTypeID = toPositiveInt(ball.typeID, 0);
    const blockerPointType = toPositiveInt(
      ball.pointType,
      DEPLOYMENT_POINT_TYPE.REAL_BALL,
    );

    if (
      isBallMoon(blockerTypeID, blockerPointType) &&
      distance < MINIMUM_MOON_DISTANCE + deployedRadius + blockerRadius
    ) {
      const canDeployNearMoon =
        drillingPlatform &&
        findMoonBeaconInRange(solarSystemID, location, MAXIMUM_MINING_BEACON_DISTANCE);
      if (!canDeployNearMoon) {
        return {
          ballTypeID: blockerTypeID,
          minimumDistance: MINIMUM_MOON_DISTANCE,
          pointType: blockerPointType,
          distance,
          blockerItemID: ball.itemID,
        };
      }
    }

    if (stargateRestricted && isStargate(blockerTypeID)) {
      const minimumDistance = GROUP_MIN_DISTANCE_TO_STARGATE[deployedGroupID];
      if (distance < minimumDistance + deployedRadius + blockerRadius) {
        return {
          ballTypeID: blockerTypeID,
          minimumDistance,
          pointType: blockerPointType,
          distance,
          blockerItemID: ball.itemID,
        };
      }
    }

    let minimum = getDeploymentDistance(blockerTypeID);
    if (getTypeCategoryID(blockerTypeID) === CATEGORY_STRUCTURE) {
      minimum = Math.min(minimum, myDeploymentDistance);
    }
    if (minimum && distance < minimum + deployedRadius + blockerRadius) {
      return {
        ballTypeID: blockerTypeID,
        minimumDistance: minimum,
        pointType: blockerPointType,
        distance,
        blockerItemID: ball.itemID,
      };
    }
  }
  return null;
}

function resolveDeploymentBalls(solarSystemID, options = {}) {
  const scene = options.scene || null;
  const balls = scene
    ? buildSceneBalls(scene, options)
    : buildStaticFallbackBalls(solarSystemID);
  return appendWarpInPoints(balls);
}

function validateDeploymentPlacement({ solarSystemID, typeID, position, offset, scene }) {
  const deploymentPosition = cloneVector(position, null);
  if (!deploymentPosition) {
    return {
      success: false,
      errorMsg: "INVALID_DEPLOYMENT_POSITION",
    };
  }

  if (offset && typeof offset === "object") {
    const clientOffset = cloneVector(offset);
    const offsetDistance = Math.sqrt(
      (clientOffset.x * clientOffset.x) +
      (clientOffset.y * clientOffset.y) +
      (clientOffset.z * clientOffset.z),
    );
    if (offsetDistance > DEPLOY_DIST_MAX + 1e-6) {
      return {
        success: false,
        errorMsg: "DEPLOYMENT_DISTANCE_EXCEEDED",
        data: {
          distance: offsetDistance,
          maximumDistance: DEPLOY_DIST_MAX,
        },
      };
    }
  }

  const balls = resolveDeploymentBalls(solarSystemID, { scene });
  const conflict = findDeploymentConflict(
    solarSystemID,
    typeID,
    deploymentPosition,
    balls,
  );
  if (conflict) {
    return {
      success: false,
      errorMsg: "DEPLOYMENT_CONFLICT",
      data: conflict,
    };
  }

  return {
    success: true,
    data: {
      checkedBalls: balls.length,
    },
  };
}

module.exports = {
  CATEGORY_DISTANCE,
  DEPLOYMENT_POINT_TYPE,
  DEPLOY_DIST_MAX,
  GROUP_DISTANCE,
  GROUP_MIN_DISTANCE_TO_STARGATE,
  MAXIMUM_MINING_BEACON_DISTANCE,
  MINIMUM_MOON_DISTANCE,
  appendWarpInPoints,
  buildSceneBalls,
  buildStaticFallbackBalls,
  distanceBetween,
  findDeploymentConflict,
  getDeploymentDistance,
  resolveDeploymentBalls,
  validateDeploymentPlacement,
};
