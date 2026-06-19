const path = require("path");

const {
  normalizeNumber,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const runtime = require(path.join(__dirname, "./bookmarkRuntimeState"));
const {
  TYPE_SOLAR_SYSTEM,
} = require(path.join(__dirname, "./bookmarkConstants"));

function getSessionSolarSystemID(session) {
  return normalizeNumber(
    session &&
      (
        (session._space && session._space.systemID) ||
        session.solarsystemid2 ||
        session.solarsystemid
      ),
    0,
  );
}

function buildCoordinateBookmarkTarget(entity, systemID) {
  if (!entity || systemID <= 0) {
    return null;
  }
  const x = normalizeNumber(entity.position && entity.position.x, null);
  const y = normalizeNumber(entity.position && entity.position.y, null);
  const z = normalizeNumber(entity.position && entity.position.z, null);
  if (x === null || y === null || z === null) {
    return null;
  }
  return {
    itemID: null,
    typeID: TYPE_SOLAR_SYSTEM,
    locationID: systemID,
    x,
    y,
    z,
  };
}

function resolveLocationBookmarkTarget(itemID, session, scene = null) {
  const numericItemID = normalizeNumber(itemID, 0);
  if (numericItemID <= 0) {
    return null;
  }

  const staticTarget = runtime.resolveStaticBookmarkTarget(numericItemID, session);
  if (staticTarget) {
    return staticTarget;
  }

  const systemID = getSessionSolarSystemID(session);
  const shipEntity = scene ? scene.getShipEntityForSession(session) : null;
  if (shipEntity && numericItemID === normalizeNumber(shipEntity.itemID, 0)) {
    return buildCoordinateBookmarkTarget(shipEntity, systemID);
  }

  const targetEntity = scene ? scene.getEntityByID(numericItemID) : null;
  if (targetEntity) {
    return buildCoordinateBookmarkTarget(targetEntity, systemID);
  }

  return null;
}

module.exports = {
  buildCoordinateBookmarkTarget,
  getSessionSolarSystemID,
  resolveLocationBookmarkTarget,
};
