const {
  readVec3,
  toFiniteNumber,
} = require("../../common/geo2");

const CONCORD_FACTION_ID = 500006;

const GATE_SENTRY_RADIUS_METERS = 45;
const DEFAULT_EMPIRE_SENTRY_DISTANCE_METERS = 50_000;
const GATE_SENTRY_DIAGONAL_METERS = DEFAULT_EMPIRE_SENTRY_DISTANCE_METERS / Math.sqrt(2);
const EMPIRE_EIGHT_SENTRY_DISPLAY_SECURITY = 0.8;
const EMPIRE_SIX_SENTRY_DISPLAY_SECURITY = 0.5;

function buildEmpireSentryOffsets(distanceMeters = DEFAULT_EMPIRE_SENTRY_DISTANCE_METERS) {
  const diagonal = toFiniteNumber(distanceMeters, DEFAULT_EMPIRE_SENTRY_DISTANCE_METERS) / Math.sqrt(2);
  return Object.freeze([
    Object.freeze({ x: -diagonal, y: diagonal, z: 0 }),
    Object.freeze({ x: diagonal, y: -diagonal, z: 0 }),
    Object.freeze({ x: -diagonal, y: -diagonal, z: 0 }),
    Object.freeze({ x: diagonal, y: diagonal, z: 0 }),
    Object.freeze({ x: 0, y: diagonal, z: -diagonal }),
    Object.freeze({ x: 0, y: -diagonal, z: diagonal }),
    Object.freeze({ x: 0, y: -diagonal, z: -diagonal }),
    Object.freeze({ x: 0, y: diagonal, z: diagonal }),
  ]);
}

const EMPIRE_SENTRY_OFFSETS = buildEmpireSentryOffsets();

const FACTION_ID = Object.freeze({
  CALDARI_STATE: 500001,
  MINMATAR_REPUBLIC: 500002,
  AMARR_EMPIRE: 500003,
  GALLENTE_FEDERATION: 500004,
  CONCORD_ASSEMBLY: CONCORD_FACTION_ID,
  AMMATAR_MANDATE: 500007,
  KHANID_KINGDOM: 500008,
  INTERBUS: 500013,
});

const CALDARI_SENTRY_TYPE_IDS = Object.freeze([3740, 3741, 3739]);
const MINMATAR_SENTRY_TYPE_IDS = Object.freeze([3743]);
const AMARR_SENTRY_TYPE_IDS = Object.freeze([1194]);
const GALLENTE_SENTRY_TYPE_IDS = Object.freeze([3742]);

const SENTRY_TYPE_IDS_BY_FACTION_ID = Object.freeze({
  [FACTION_ID.CALDARI_STATE]: CALDARI_SENTRY_TYPE_IDS,
  [FACTION_ID.MINMATAR_REPUBLIC]: MINMATAR_SENTRY_TYPE_IDS,
  [FACTION_ID.AMARR_EMPIRE]: AMARR_SENTRY_TYPE_IDS,
  [FACTION_ID.GALLENTE_FEDERATION]: GALLENTE_SENTRY_TYPE_IDS,
  [FACTION_ID.CONCORD_ASSEMBLY]: CALDARI_SENTRY_TYPE_IDS,
  [FACTION_ID.AMMATAR_MANDATE]: AMARR_SENTRY_TYPE_IDS,
  [FACTION_ID.KHANID_KINGDOM]: AMARR_SENTRY_TYPE_IDS,
  [FACTION_ID.INTERBUS]: CALDARI_SENTRY_TYPE_IDS,
});

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function cloneVector(vector = {}) {
  return readVec3(vector, { x: 0, y: 0, z: 0 });
}

function getDisplayedSecurity(system) {
  const security = Math.max(0, Math.min(1, toFiniteNumber(system && system.security, 0)));
  if (security > 0 && security < 0.05) {
    return 0.05;
  }
  return Math.round(security * 10) / 10;
}

function getEmpireSentryCountForSystem(system) {
  const displayedSecurity = getDisplayedSecurity(system);
  if (displayedSecurity <= 0) {
    return 0;
  }
  if (displayedSecurity >= EMPIRE_EIGHT_SENTRY_DISPLAY_SECURITY) {
    return 8;
  }
  if (displayedSecurity >= EMPIRE_SIX_SENTRY_DISPLAY_SECURITY) {
    return 6;
  }
  return 2;
}

function getEmpireSentryTypeIDsForSystem(system) {
  const factionID = toPositiveInt(system && system.factionID, 0);
  return (
    SENTRY_TYPE_IDS_BY_FACTION_ID[factionID] ||
    SENTRY_TYPE_IDS_BY_FACTION_ID[CONCORD_FACTION_ID]
  );
}

function getEmpireSentryLayout(system, options = {}) {
  const count = getEmpireSentryCountForSystem(system);
  if (count <= 0) {
    return [];
  }
  const typeIDs = getEmpireSentryTypeIDsForSystem(system);
  const offsets = buildEmpireSentryOffsets(
    toFiniteNumber(options && options.distanceMeters, DEFAULT_EMPIRE_SENTRY_DISTANCE_METERS),
  );
  const factionID = toPositiveInt(system && system.factionID, CONCORD_FACTION_ID) ||
    CONCORD_FACTION_ID;
  return offsets.slice(0, count).map((offset, index) => ({
    typeID: typeIDs[index % typeIDs.length],
    ownerID: factionID,
    factionID,
    offset: cloneVector(offset),
  }));
}

module.exports = {
  AMARR_SENTRY_TYPE_IDS,
  CALDARI_SENTRY_TYPE_IDS,
  CONCORD_FACTION_ID,
  DEFAULT_EMPIRE_SENTRY_DISTANCE_METERS,
  EMPIRE_EIGHT_SENTRY_DISPLAY_SECURITY,
  EMPIRE_SENTRY_OFFSETS,
  EMPIRE_SIX_SENTRY_DISPLAY_SECURITY,
  FACTION_ID,
  GALLENTE_SENTRY_TYPE_IDS,
  GATE_SENTRY_DIAGONAL_METERS,
  GATE_SENTRY_RADIUS_METERS,
  MINMATAR_SENTRY_TYPE_IDS,
  SENTRY_TYPE_IDS_BY_FACTION_ID,
  buildEmpireSentryOffsets,
  getDisplayedSecurity,
  getEmpireSentryCountForSystem,
  getEmpireSentryLayout,
  getEmpireSentryTypeIDsForSystem,
};
