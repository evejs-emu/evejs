const {
  readVec3,
} = require("../../common/geo2");
const {
  CONCORD_FACTION_ID,
  EMPIRE_SENTRY_OFFSETS,
  GATE_SENTRY_DIAGONAL_METERS,
  GATE_SENTRY_RADIUS_METERS,
  getDisplayedSecurity,
  getEmpireSentryCountForSystem,
  getEmpireSentryLayout,
  getEmpireSentryTypeIDsForSystem,
} = require("./empireSentryLayout");

const CONCORD_BILLBOARD_CORPORATION_ID = 1000125;
const CONCORD_BILLBOARD_TYPE_ID = 11136;

const GATE_BILLBOARD_OFFSET = Object.freeze({
  x: -18_000,
  y: 10_000,
  z: -28_000,
});

function cloneVector(vector = {}) {
  return readVec3(vector, { x: 0, y: 0, z: 0 });
}

function getGateSentryCountForSystem(system) {
  return getEmpireSentryCountForSystem(system);
}

function getGateSentryTypeIDsForSystem(system) {
  return getEmpireSentryTypeIDsForSystem(system);
}

function getGateBillboardLayout() {
  return {
    typeID: CONCORD_BILLBOARD_TYPE_ID,
    ownerID: CONCORD_BILLBOARD_CORPORATION_ID,
    corporationID: CONCORD_BILLBOARD_CORPORATION_ID,
    factionID: CONCORD_FACTION_ID,
    offset: cloneVector(GATE_BILLBOARD_OFFSET),
  };
}

function getGateSentryLayout(system, stargate = null) {
  return getEmpireSentryLayout(system);
}

module.exports = {
  CONCORD_BILLBOARD_CORPORATION_ID,
  CONCORD_BILLBOARD_TYPE_ID,
  CONCORD_FACTION_ID,
  GATE_BILLBOARD_OFFSET,
  GATE_SENTRY_DIAGONAL_METERS,
  GATE_SENTRY_OFFSETS: EMPIRE_SENTRY_OFFSETS,
  GATE_SENTRY_RADIUS_METERS,
  getDisplayedSecurity,
  getGateBillboardLayout,
  getGateSentryCountForSystem,
  getGateSentryLayout,
  getGateSentryTypeIDsForSystem,
};
