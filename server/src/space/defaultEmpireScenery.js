const path = require("path");

const config = require(path.join(__dirname, "../config"));
const log = require(path.join(__dirname, "../utils/logger"));
const worldData = require(path.join(__dirname, "./worldData"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../services/inventory/itemTypeRegistry"));
const {
  CONCORD_FACTION_ID,
  SENTRY_OWNER_ID,
  getEverMoreGateBillboardLayout,
  getEverMoreGateSentryLayout,
  isEverMoreGatePresenceSystem,
} = require(path.join(__dirname, "./empireGatePresence/everMoreGatePresence"));
const {
  CONCORD_BILLBOARD_TYPE_ID,
  getGateBillboardLayout,
  getGateSentryLayout,
} = require(path.join(__dirname, "./empireGatePresence/gateSceneryLayout"));
const {
  getStationSentryLayout,
} = require(path.join(__dirname, "./empireGatePresence/stationSceneryLayout"));

const BILLBOARD_ITEM_ID_BASE = 8_410_000_000_000_000;
const GATE_SENTRY_ITEM_ID_BASE = 8_420_000_000_000_000;
const STATION_SENTRY_ITEM_ID_BASE = 8_430_000_000_000_000;
const DESTINY_BALL_FLAG_IS_FREE = 0x01;
const DESTINY_BOOTSTRAP_DELIVERY_ADDBALLS2 = "addBalls2";

const ZERO_VECTOR = Object.freeze({ x: 0, y: 0, z: 0 });
const DEFAULT_FORWARD = Object.freeze({ x: 1, y: 0, z: 0 });

let cachedSignature = "";
let cachedEntitiesBySystemID = new Map();

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function cloneVector(source = null, fallback = ZERO_VECTOR) {
  return {
    x: toFiniteNumber(source && source.x, fallback.x),
    y: toFiniteNumber(source && source.y, fallback.y),
    z: toFiniteNumber(source && source.z, fallback.z),
  };
}

function addVectors(left = ZERO_VECTOR, right = ZERO_VECTOR) {
  return {
    x: toFiniteNumber(left.x, 0) + toFiniteNumber(right.x, 0),
    y: toFiniteNumber(left.y, 0) + toFiniteNumber(right.y, 0),
    z: toFiniteNumber(left.z, 0) + toFiniteNumber(right.z, 0),
  };
}

function subtractVectors(left = ZERO_VECTOR, right = ZERO_VECTOR) {
  return {
    x: toFiniteNumber(left.x, 0) - toFiniteNumber(right.x, 0),
    y: toFiniteNumber(left.y, 0) - toFiniteNumber(right.y, 0),
    z: toFiniteNumber(left.z, 0) - toFiniteNumber(right.z, 0),
  };
}

function scaleVector(vector = ZERO_VECTOR, scalar = 1) {
  const resolvedScalar = toFiniteNumber(scalar, 1);
  return {
    x: toFiniteNumber(vector.x, 0) * resolvedScalar,
    y: toFiniteNumber(vector.y, 0) * resolvedScalar,
    z: toFiniteNumber(vector.z, 0) * resolvedScalar,
  };
}

function dotProduct(left = ZERO_VECTOR, right = ZERO_VECTOR) {
  return (
    (toFiniteNumber(left.x, 0) * toFiniteNumber(right.x, 0)) +
    (toFiniteNumber(left.y, 0) * toFiniteNumber(right.y, 0)) +
    (toFiniteNumber(left.z, 0) * toFiniteNumber(right.z, 0))
  );
}

function magnitude(vector = ZERO_VECTOR) {
  return Math.sqrt(dotProduct(vector, vector));
}

function normalizeVector(vector = ZERO_VECTOR, fallback = DEFAULT_FORWARD) {
  const length = magnitude(vector);
  if (length <= 0.000001) {
    return cloneVector(fallback);
  }
  return scaleVector(vector, 1 / length);
}

function buildLookDunRotation(direction) {
  const forward = normalizeVector(direction, { x: 0, y: 0, z: -1 });
  const yawDegrees = Math.atan2(forward.x, forward.z) * (180 / Math.PI);
  const pitchDegrees = -Math.asin(clamp(forward.y, -1, 1)) * (180 / Math.PI);
  return [yawDegrees, pitchDegrees, 0];
}

function getDisplayedSecurity(system) {
  const security = clamp(toFiniteNumber(system && system.security, 0), 0, 1);
  if (security > 0 && security < 0.05) {
    return 0.05;
  }
  return Math.round(security * 10) / 10;
}

function getBillboardTypeIDForSystem(system) {
  return CONCORD_BILLBOARD_TYPE_ID;
}

function getResolvedTypeRecord(typeID) {
  const resolvedTypeID = toPositiveInt(typeID, 0);
  if (resolvedTypeID <= 0) {
    return null;
  }
  return resolveItemByTypeID(resolvedTypeID) || null;
}

function buildGeneratedItemID(base, anchorID, slot) {
  return base + (toPositiveInt(anchorID, 0) * 100) + toPositiveInt(slot, 0);
}

function markAddBalls2BootstrapEntity(entity) {
  return entity;
}

function applyAddBalls2StopPresentation(entity) {
  if (!entity) {
    return entity;
  }

  // Public keeps these generated visuals free so static STOP presentation does
  // not desync AddBalls2 parsing.
  entity.destinyBallMode = "STOP";
  entity.destinyForceFree = true;
  entity.destinyBallFlags = DESTINY_BALL_FLAG_IS_FREE;
  entity.mass = Math.max(1, toFiniteNumber(entity.mass, 1_000_000));
  entity.maxVelocity = Math.max(1, toFiniteNumber(entity.maxVelocity, 1));
  entity.inertia = Math.max(1, toFiniteNumber(entity.inertia, 1));
  entity.speedFraction = 1;
  return entity;
}

function createVisualEntity({
  kind,
  itemID,
  typeID,
  ownerID,
  corporationID,
  factionID,
  warFactionID = 0,
  position,
  direction,
  itemName = null,
  suppressSlimName = false,
}) {
  const typeRecord = getResolvedTypeRecord(typeID);
  if (!typeRecord) {
    return null;
  }

  const resolvedDirection = normalizeVector(direction, DEFAULT_FORWARD);
  return {
    kind,
    itemID,
    typeID: typeRecord.typeID,
    groupID: toPositiveInt(typeRecord.groupID, 0),
    categoryID: toPositiveInt(typeRecord.categoryID, 11),
    slimTypeID: typeRecord.typeID,
    slimGroupID: toPositiveInt(typeRecord.groupID, 0),
    slimCategoryID: toPositiveInt(typeRecord.categoryID, 11),
    itemName: itemName || typeRecord.name || kind,
    slimName: itemName || typeRecord.name || kind,
    suppressSlimName,
    ownerID: toPositiveInt(ownerID, 0),
    corporationID: toPositiveInt(corporationID, 0),
    allianceID: 0,
    factionID: toPositiveInt(factionID, 0),
    warFactionID: toPositiveInt(warFactionID, 0),
    graphicID: toPositiveInt(typeRecord.graphicID, 0) || null,
    slimGraphicID: toPositiveInt(typeRecord.graphicID, 0) || null,
    radius: Math.max(1, toFiniteNumber(typeRecord.radius, 1)),
    staticVisibilityScope: "publicgrid",
    position: cloneVector(position),
    velocity: cloneVector(ZERO_VECTOR),
    direction: resolvedDirection,
    dunRotation: buildLookDunRotation(resolvedDirection),
  };
}

function buildGateBillboardEntity(system, stargate) {
  if (isEverMoreGatePresenceSystem(system && system.solarSystemID, config)) {
    return buildEverMoreGateBillboardEntity(system, stargate);
  }

  const layout = getGateBillboardLayout(system, stargate);
  const typeRecord = getResolvedTypeRecord(layout.typeID);
  if (!typeRecord) {
    return null;
  }

  const position = addVectors(
    cloneVector(stargate && stargate.position),
    cloneVector(layout.offset),
  );
  const facingDirection = subtractVectors(
    cloneVector(stargate && stargate.position),
    position,
  );

  const entity = createVisualEntity({
    kind: "billboard",
    itemID: buildGeneratedItemID(BILLBOARD_ITEM_ID_BASE, stargate && stargate.itemID, 1),
    typeID: layout.typeID,
    ownerID: layout.ownerID,
    corporationID: layout.corporationID,
    factionID: layout.factionID,
    position,
    direction: facingDirection,
    itemName: typeRecord.name || "CONCORD Billboard",
    suppressSlimName: true,
  });
  if (entity) {
    markAddBalls2BootstrapEntity(entity);
    applyAddBalls2StopPresentation(entity);
    entity.suppressSlimDunRotation = true;
    entity.hostileResponseThreshold = -11;
    entity.friendlyResponseThreshold = 11;
  }
  return entity;
}

function buildEverMoreGateBillboardEntity(system, stargate) {
  const layout = getEverMoreGateBillboardLayout();
  const typeRecord = getResolvedTypeRecord(layout.typeID);
  if (!typeRecord) {
    return null;
  }

  const position = addVectors(
    cloneVector(stargate && stargate.position),
    cloneVector(layout.offset),
  );
  const entity = createVisualEntity({
    kind: "billboard",
    itemID: buildGeneratedItemID(BILLBOARD_ITEM_ID_BASE, stargate && stargate.itemID, 91),
    typeID: layout.typeID,
    ownerID: layout.ownerID,
    corporationID: layout.corporationID,
    factionID: layout.factionID,
    position,
    direction: subtractVectors(cloneVector(stargate && stargate.position), position),
    itemName: typeRecord.name || "CONCORD Billboard",
    suppressSlimName: true,
  });
  if (entity) {
    markAddBalls2BootstrapEntity(entity);
    applyAddBalls2StopPresentation(entity);
    entity.suppressSlimDunRotation = true;
    entity.hostileResponseThreshold = -11;
    entity.friendlyResponseThreshold = 11;
  }
  return entity;
}

function buildGateSentryEntities(system, stargate) {
  if (isEverMoreGatePresenceSystem(system && system.solarSystemID, config)) {
    return buildEverMoreGateSentryEntities(system, stargate);
  }

  return getGateSentryLayout(system, stargate)
    .map((slot, index) => {
      const position = addVectors(
        cloneVector(stargate && stargate.position),
        cloneVector(slot && slot.offset),
      );
      const direction = normalizeVector(
        subtractVectors(position, stargate && stargate.position),
        DEFAULT_FORWARD,
      );

      const entity = createVisualEntity({
        kind: "sentryGun",
        itemID: buildGeneratedItemID(
          GATE_SENTRY_ITEM_ID_BASE,
          stargate && stargate.itemID,
          index + 1,
        ),
        typeID: slot.typeID,
        ownerID: slot.ownerID,
        corporationID: 0,
        factionID: slot.factionID,
        warFactionID: 0,
        position,
        direction,
        suppressSlimName: true,
      });
      if (entity) {
        markAddBalls2BootstrapEntity(entity);
        applyAddBalls2StopPresentation(entity);
        entity.suppressSlimCorporationID = true;
        entity.suppressSlimDunRotation = true;
        entity.hostileResponseThreshold = -11;
        entity.friendlyResponseThreshold = -11;
      }
      return entity;
    })
    .filter(Boolean);
}

function buildEverMoreGateSentryEntities(system, stargate) {
  const systemID = toPositiveInt(system && system.solarSystemID, 0);
  const layout = getEverMoreGateSentryLayout(systemID, stargate && stargate.itemID);
  return layout
    .map((slot, index) => {
      const position = addVectors(
        cloneVector(stargate && stargate.position),
        cloneVector(slot && slot.offset),
      );
      const direction = normalizeVector(
        subtractVectors(position, stargate && stargate.position),
        DEFAULT_FORWARD,
      );
      const entity = createVisualEntity({
        kind: "sentryGun",
        itemID: buildGeneratedItemID(
          GATE_SENTRY_ITEM_ID_BASE,
          stargate && stargate.itemID,
          90 + index + 1,
        ),
        typeID: slot.typeID,
        ownerID: SENTRY_OWNER_ID,
        corporationID: 0,
        factionID: CONCORD_FACTION_ID,
        warFactionID: 0,
        position,
        direction,
        suppressSlimName: true,
      });
      if (entity) {
        markAddBalls2BootstrapEntity(entity);
        applyAddBalls2StopPresentation(entity);
        entity.suppressSlimCorporationID = true;
        entity.suppressSlimDunRotation = true;
        entity.hostileResponseThreshold = -11;
        entity.friendlyResponseThreshold = -11;
      }
      return entity;
    })
    .filter(Boolean);
}

function buildStationSentryEntities(system, station) {
  const ownerID = toPositiveInt(
    station && (station.corporationID || station.ownerID),
    toPositiveInt(system && system.factionID, CONCORD_FACTION_ID),
  );
  return getStationSentryLayout(system, station)
    .map((slot, index) => {
      const position = addVectors(
        cloneVector(station && station.position),
        cloneVector(slot && slot.offset),
      );
      const direction = normalizeVector(
        subtractVectors(position, station && station.position),
        DEFAULT_FORWARD,
      );

      const entity = createVisualEntity({
        kind: "sentryGun",
        itemID: buildGeneratedItemID(
          STATION_SENTRY_ITEM_ID_BASE,
          station && station.stationID,
          index + 1,
        ),
        typeID: slot.typeID,
        ownerID,
        corporationID: 0,
        factionID: slot.factionID,
        warFactionID: 0,
        position,
        direction,
        suppressSlimName: true,
      });
      if (entity) {
        markAddBalls2BootstrapEntity(entity);
        applyAddBalls2StopPresentation(entity);
        entity.suppressSlimCorporationID = true;
        entity.suppressSlimDunRotation = true;
        entity.hostileResponseThreshold = -11;
        entity.friendlyResponseThreshold = -11;
      }
      return entity;
    })
    .filter(Boolean);
}

function buildSystemEntities(system) {
  const entities = [];
  const displayedSecurity = getDisplayedSecurity(system);
  if (displayedSecurity <= 0) {
    return entities;
  }

  const systemID = toPositiveInt(system && system.solarSystemID, 0);
  if (systemID <= 0) {
    return entities;
  }

  if (config.defaultStargateBillboardsEnabled !== false) {
    for (const stargate of worldData.getStargatesForSystem(systemID)) {
      const entity = buildGateBillboardEntity(system, stargate);
      if (entity) {
        entities.push(entity);
      }
    }
  }

  if (config.defaultEmpireSentryGunsEnabled !== false) {
    for (const stargate of worldData.getStargatesForSystem(systemID)) {
      entities.push(...buildGateSentryEntities(system, stargate));
    }
    for (const station of worldData.getStationsForSystem(systemID)) {
      entities.push(...buildStationSentryEntities(system, station));
    }
  }

  return entities;
}

function cloneEntity(entity) {
  return {
    ...entity,
    position: cloneVector(entity && entity.position),
    velocity: cloneVector(entity && entity.velocity),
    direction: cloneVector(entity && entity.direction, DEFAULT_FORWARD),
    dunRotation: Array.isArray(entity && entity.dunRotation)
      ? [...entity.dunRotation]
      : null,
  };
}

function buildSignature() {
  return JSON.stringify({
    billboardsEnabled: config.defaultStargateBillboardsEnabled !== false,
    sentryGunsEnabled: config.defaultEmpireSentryGunsEnabled !== false,
    everMoreGatePresenceEnabled: config.npcDefaultEverMoreGatePresenceEnabled === true,
    everMoreGatePresenceSystemIDs: String(
      config.npcDefaultEverMoreGatePresenceSystemIDs || "",
    ).trim(),
  });
}

function rebuildCache() {
  const nextSignature = buildSignature();
  if (nextSignature === cachedSignature) {
    return;
  }

  const billboardsEnabled = config.defaultStargateBillboardsEnabled !== false;
  const sentryGunsEnabled = config.defaultEmpireSentryGunsEnabled !== false;
  if (!billboardsEnabled && !sentryGunsEnabled) {
    cachedSignature = nextSignature;
    cachedEntitiesBySystemID = new Map();
    return;
  }

  const startedAt = Date.now();
  const nextCache = new Map();
  let billboardCount = 0;
  let sentryGunCount = 0;
  for (const system of worldData.getSolarSystems()) {
    const systemID = toPositiveInt(system && system.solarSystemID, 0);
    if (systemID <= 0) {
      continue;
    }

    const entities = buildSystemEntities(system);
    if (entities.length <= 0) {
      continue;
    }

    billboardCount += entities.filter((entity) => entity && entity.kind === "billboard").length;
    sentryGunCount += entities.filter((entity) => entity && entity.kind === "sentryGun").length;
    nextCache.set(systemID, entities);
  }

  cachedSignature = nextSignature;
  cachedEntitiesBySystemID = nextCache;
  log.info(
    `[SpaceScenery] Generated ${billboardCount} gate billboards and ${sentryGunCount} sentry guns across ${nextCache.size} empire-space systems in ${Date.now() - startedAt} ms`,
  );
}

function getConfiguredStaticEntitiesForSystem(systemID) {
  rebuildCache();
  return (
    cachedEntitiesBySystemID.get(toPositiveInt(systemID, 0)) || []
  ).map(cloneEntity);
}

module.exports = {
  getConfiguredStaticEntitiesForSystem,
  _testing: {
    DESTINY_BOOTSTRAP_DELIVERY_ADDBALLS2,
    buildSystemEntities,
    getBillboardTypeIDForSystem,
  },
};
