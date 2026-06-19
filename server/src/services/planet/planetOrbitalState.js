const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  TABLE,
  readStaticRows,
} = require(path.join(__dirname, "../_shared/referenceData"));
const {
  findItemById,
  getItemMetadata,
  updateInventoryItem,
} = require(path.join(__dirname, "../inventory/itemStore"));

const TABLE_NAME = "planetOrbitalState";
const SCHEMA_VERSION = 1;

const CATEGORY_ORBITAL = 46;
const GROUP_PLANETARY_CUSTOMS_OFFICES = 1025;
const GROUP_ORBITAL_CONSTRUCTION_PLATFORM = 1106;
const TYPE_CUSTOMS_OFFICE = 2233;
const TYPE_CUSTOMS_OFFICE_GANTRY = 3962;
const TYPE_INTERBUS_CUSTOMS_OFFICE = 4318;

const ORBITAL_STATE = Object.freeze({
  OFFLINING: -7,
  ANCHORING: -6,
  ONLINING: -5,
  ANCHORED: -4,
  UNANCHORING: -3,
  UNANCHORED: -2,
  IDLE: 0,
  OPERATING: 1,
});

const DEFAULT_ORBITAL_TIMER_MS = Math.max(
  1_000,
  Number(process.env.EVEJS_PI_ORBITAL_TIMER_MS) || 60_000,
);

const DEFAULT_TAX_RATES = Object.freeze({
  corporation: 0.05,
  alliance: 0.05,
  standingHorrible: 0.05,
  standingBad: 0.05,
  standingNeutral: 0.05,
  standingGood: 0.05,
  standingHigh: 0.05,
});

const DEFAULT_DUN_ROTATION = Object.freeze([0, 0, 0]);
let planetCacheBySystem = null;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toInt(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.trunc(numericValue) : fallback;
}

function toReal(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function normalizeVector(value, fallback = { x: 0, y: 0, z: 0 }) {
  const source = isPlainObject(value) ? value : fallback;
  return {
    x: toReal(source && source.x, fallback.x),
    y: toReal(source && source.y, fallback.y),
    z: toReal(source && source.z, fallback.z),
  };
}

function normalizeDunRotation(value) {
  if (!Array.isArray(value) || value.length < 3) {
    return [...DEFAULT_DUN_ROTATION];
  }
  return [
    toReal(value[0], 0),
    toReal(value[1], 0),
    toReal(value[2], 0),
  ];
}

function distanceSquared(left, right) {
  const dx = toReal(left && left.x, 0) - toReal(right && right.x, 0);
  const dy = toReal(left && left.y, 0) - toReal(right && right.y, 0);
  const dz = toReal(left && left.z, 0) - toReal(right && right.z, 0);
  return dx * dx + dy * dy + dz * dz;
}

function normalizeTaxRates(rawRates = {}) {
  const rates = {};
  const source = isPlainObject(rawRates) ? rawRates : {};
  for (const [key, defaultValue] of Object.entries(DEFAULT_TAX_RATES)) {
    const value = Number(source[key]);
    rates[key] = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : defaultValue;
  }
  return rates;
}

function normalizeState(rawState = {}) {
  const state = isPlainObject(rawState) ? { ...rawState } : {};
  let changed = false;

  if (state.schemaVersion !== SCHEMA_VERSION) {
    state.schemaVersion = SCHEMA_VERSION;
    changed = true;
  }
  if (!isPlainObject(state.orbitalsByID)) {
    state.orbitalsByID = {};
    changed = true;
  }

  return { state, changed };
}

function readState(options = {}) {
  const result = database.read(TABLE_NAME, "/");
  if (!result.success) {
    log.warn(
      `[PlanetOrbitalState] Failed to read ${TABLE_NAME}: ${result.errorMsg || "READ_ERROR"}`,
    );
  }

  const { state, changed } = normalizeState(result.success ? result.data : {});
  if (changed && options.repair === true) {
    writeState(state);
  }
  return state;
}

function flushStateToDisk() {
  const result = database.flushTableSync(TABLE_NAME);
  if (!result.success) {
    log.warn(
      `[PlanetOrbitalState] Failed to flush ${TABLE_NAME}: ${result.errorMsg || "FLUSH_ERROR"}`,
    );
  }
  return result.success === true;
}

function writeState(state) {
  const { state: normalizedState } = normalizeState(state);
  const result = database.write(TABLE_NAME, "/", normalizedState, { force: true });
  if (!result.success) {
    log.warn(
      `[PlanetOrbitalState] Failed to write ${TABLE_NAME}: ${result.errorMsg || "WRITE_ERROR"}`,
    );
    return false;
  }
  return flushStateToDisk();
}

function getPlanetsBySystem() {
  if (planetCacheBySystem) {
    return planetCacheBySystem;
  }

  planetCacheBySystem = new Map();
  for (const row of readStaticRows(TABLE.CELESTIALS)) {
    if (!row || (row.kind !== "planet" && row.groupName !== "Planet")) {
      continue;
    }
    const solarSystemID = toInt(row.solarSystemID, 0);
    const planetID = toInt(row.itemID, 0);
    if (!solarSystemID || !planetID) {
      continue;
    }
    if (!planetCacheBySystem.has(solarSystemID)) {
      planetCacheBySystem.set(solarSystemID, []);
    }
    planetCacheBySystem.get(solarSystemID).push({
      planetID,
      solarSystemID,
      typeID: toInt(row.typeID, 0),
      radius: toReal(row.radius, 0),
      position: normalizeVector(row.position),
      celestialIndex: toInt(row.celestialIndex, 0),
    });
  }

  for (const planets of planetCacheBySystem.values()) {
    planets.sort((left, right) => (
      (left.celestialIndex || left.planetID) - (right.celestialIndex || right.planetID)
    ));
  }

  return planetCacheBySystem;
}

function listPlanetsForSystem(solarSystemID) {
  return [...(getPlanetsBySystem().get(toInt(solarSystemID, 0)) || [])];
}

function findNearestPlanetID(solarSystemID, position = null) {
  const planets = listPlanetsForSystem(solarSystemID);
  if (planets.length === 0) {
    return 0;
  }
  if (!isPlainObject(position)) {
    return planets[0].planetID;
  }

  const normalizedPosition = normalizeVector(position);
  let nearestPlanet = planets[0];
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const planet of planets) {
    const candidateDistance = distanceSquared(normalizedPosition, planet.position);
    if (candidateDistance < nearestDistance) {
      nearestDistance = candidateDistance;
      nearestPlanet = planet;
    }
  }
  return nearestPlanet ? nearestPlanet.planetID : 0;
}

function getDefaultStateForItem(item = {}) {
  const typeID = toInt(item.typeID, 0);
  const groupID = toInt(item.groupID, 0);
  if (typeID === TYPE_CUSTOMS_OFFICE_GANTRY || groupID === GROUP_ORBITAL_CONSTRUCTION_PLATFORM) {
    return ORBITAL_STATE.UNANCHORED;
  }
  return ORBITAL_STATE.IDLE;
}

function normalizeOrbitalRecord(rawRecord = {}, defaults = {}) {
  const record = isPlainObject(rawRecord) ? rawRecord : {};
  const itemID = toInt(record.itemID ?? defaults.itemID, 0);
  const typeID = toInt(record.typeID ?? defaults.typeID, 0);
  const metadata = getItemMetadata(typeID, record.itemName || defaults.itemName);
  const ownerID = toInt(record.ownerID ?? defaults.ownerID, 0);
  const corporationID = toInt(
    record.corporationID ?? defaults.corporationID,
    ownerID,
  );
  const state = toInt(
    record.state ?? defaults.state,
    getDefaultStateForItem({
      typeID,
      groupID: toInt(record.groupID ?? defaults.groupID, metadata.groupID),
    }),
  );

  return {
    itemID,
    typeID: toInt(metadata.typeID, typeID),
    groupID: toInt(record.groupID ?? defaults.groupID, metadata.groupID),
    categoryID: CATEGORY_ORBITAL,
    itemName: String(record.itemName || defaults.itemName || metadata.name || "Orbital"),
    ownerID,
    corporationID,
    allianceID: toInt(record.allianceID ?? defaults.allianceID, 0),
    warFactionID: toInt(record.warFactionID ?? defaults.warFactionID, 0),
    solarSystemID: toInt(record.solarSystemID ?? defaults.solarSystemID, 0),
    planetID: toInt(record.planetID ?? defaults.planetID, 0),
    level: Math.max(1, toInt(record.level ?? defaults.level, 1)),
    state,
    stateStartedAtMs: toInt(record.stateStartedAtMs ?? defaults.stateStartedAtMs, 0) || null,
    stateEndsAtMs: toInt(record.stateEndsAtMs ?? defaults.stateEndsAtMs, 0) || null,
    reinforceHour: Math.max(0, Math.min(23, toInt(record.reinforceHour ?? defaults.reinforceHour, 18))),
    taxRates: normalizeTaxRates(record.taxRates || defaults.taxRates),
    standingLevel: toInt(record.standingLevel ?? defaults.standingLevel, 0),
    allowAlliance: Boolean(record.allowAlliance ?? defaults.allowAlliance ?? false),
    allowStandings: Boolean(record.allowStandings ?? defaults.allowStandings ?? false),
    aclGroupID: toInt(record.aclGroupID ?? defaults.aclGroupID, 0) || null,
    dunRotation: normalizeDunRotation(record.dunRotation || defaults.dunRotation),
  };
}

function buildDefaultsFromItem(item = {}, options = {}) {
  const solarSystemID = toInt(
    options.solarSystemID,
    toInt(item.locationID, toInt(item.spaceState && item.spaceState.systemID, 0)),
  );
  const position = item.spaceState && item.spaceState.position
    ? item.spaceState.position
    : options.position;
  const ownerID = toInt(options.ownerID, toInt(item.ownerID, 0));
  const corporationID = toInt(options.corporationID, ownerID);
  return {
    itemID: toInt(item.itemID, 0),
    typeID: toInt(item.typeID, 0),
    groupID: toInt(item.groupID, 0),
    categoryID: CATEGORY_ORBITAL,
    itemName: item.itemName,
    ownerID,
    corporationID,
    allianceID: toInt(options.allianceID, 0),
    warFactionID: toInt(options.warFactionID, 0),
    solarSystemID,
    planetID: toInt(
      options.planetID,
      findNearestPlanetID(solarSystemID, position),
    ),
    state: options.state,
    stateStartedAtMs: options.stateStartedAtMs,
    stateEndsAtMs: options.stateEndsAtMs,
    dunRotation: item.dunRotation || options.dunRotation || DEFAULT_DUN_ROTATION,
  };
}

function upsertOrbitalRecord(record, options = {}) {
  const normalizedRecord = normalizeOrbitalRecord(record);
  if (!normalizedRecord.itemID) {
    return {
      success: false,
      errorMsg: "ORBITAL_NOT_FOUND",
    };
  }

  const state = options.state || readState({ repair: true });
  state.orbitalsByID[String(normalizedRecord.itemID)] = normalizedRecord;
  if (options.deferWrite !== true && !writeState(state)) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }
  return {
    success: true,
    data: normalizedRecord,
    state,
  };
}

function completeOnliningOrbital(record) {
  const metadata = getItemMetadata(TYPE_CUSTOMS_OFFICE, "Customs Office");
  const updateResult = updateInventoryItem(record.itemID, (currentItem) => ({
    ...currentItem,
    typeID: TYPE_CUSTOMS_OFFICE,
    itemName: metadata.name || "Customs Office",
    singleton: 1,
  }));
  if (!updateResult.success) {
    log.warn(
      `[PlanetOrbitalState] Failed to convert gantry ${record.itemID} to POCO: ${updateResult.errorMsg || "UNKNOWN"}`,
    );
  }

  return normalizeOrbitalRecord({
    ...record,
    typeID: TYPE_CUSTOMS_OFFICE,
    groupID: GROUP_PLANETARY_CUSTOMS_OFFICES,
    itemName: metadata.name || "Customs Office",
    state: ORBITAL_STATE.IDLE,
    stateStartedAtMs: null,
    stateEndsAtMs: null,
  });
}

function tickDueOrbitals(nowMs = Date.now()) {
  const state = readState({ repair: true });
  let changed = false;
  const normalizedNow = toInt(nowMs, Date.now());

  for (const [key, rawRecord] of Object.entries(state.orbitalsByID)) {
    let record = normalizeOrbitalRecord(rawRecord);
    const stateEndsAtMs = toInt(record.stateEndsAtMs, 0);
    if (!stateEndsAtMs || stateEndsAtMs > normalizedNow) {
      if (JSON.stringify(record) !== JSON.stringify(rawRecord)) {
        state.orbitalsByID[key] = record;
        changed = true;
      }
      continue;
    }

    if (record.state === ORBITAL_STATE.ANCHORING) {
      record = normalizeOrbitalRecord({
        ...record,
        state: ORBITAL_STATE.ANCHORED,
        stateStartedAtMs: null,
        stateEndsAtMs: null,
      });
      changed = true;
    } else if (record.state === ORBITAL_STATE.ONLINING) {
      record = completeOnliningOrbital(record);
      changed = true;
    } else if (record.state === ORBITAL_STATE.UNANCHORING) {
      record = normalizeOrbitalRecord({
        ...record,
        state: ORBITAL_STATE.UNANCHORED,
        stateStartedAtMs: null,
        stateEndsAtMs: null,
      });
      changed = true;
    }

    state.orbitalsByID[key] = record;
  }

  if (changed) {
    writeState(state);
  }

  return {
    success: true,
    data: state,
    changed,
  };
}

function ensureOrbitalForItem(item, options = {}) {
  if (!item || toInt(item.itemID, 0) <= 0 || toInt(item.categoryID, 0) !== CATEGORY_ORBITAL) {
    return null;
  }

  tickDueOrbitals();
  const state = readState({ repair: true });
  const key = String(item.itemID);
  const existing = state.orbitalsByID[key];
  if (existing) {
    const normalized = normalizeOrbitalRecord(existing, buildDefaultsFromItem(item, options));
    if (JSON.stringify(existing) !== JSON.stringify(normalized)) {
      state.orbitalsByID[key] = normalized;
      writeState(state);
    }
    return normalized;
  }

  const record = normalizeOrbitalRecord({}, buildDefaultsFromItem(item, {
    ...options,
    state: options.state ?? getDefaultStateForItem(item),
  }));
  state.orbitalsByID[key] = record;
  writeState(state);
  return record;
}

function getOrbitalByID(itemID, options = {}) {
  if (options.refresh !== false) {
    tickDueOrbitals();
  }
  const state = readState({ repair: true });
  const record = state.orbitalsByID[String(toInt(itemID, 0))];
  if (record) {
    return normalizeOrbitalRecord(record);
  }

  const item = findItemById(itemID);
  return ensureOrbitalForItem(item, options);
}

function listOrbitalsForSystem(solarSystemID) {
  tickDueOrbitals();
  const state = readState({ repair: true });
  const numericSystemID = toInt(solarSystemID, 0);
  return Object.values(state.orbitalsByID)
    .map((record) => normalizeOrbitalRecord(record))
    .filter((record) => record.solarSystemID === numericSystemID);
}

function listOrbitalsForPlanet(planetID) {
  tickDueOrbitals();
  const state = readState({ repair: true });
  const numericPlanetID = toInt(planetID, 0);
  return Object.values(state.orbitalsByID)
    .map((record) => normalizeOrbitalRecord(record))
    .filter((record) => record.planetID === numericPlanetID);
}

function beginOrbitalState(itemID, nextState, durationMs, session = null) {
  const numericItemID = toInt(itemID, 0);
  const item = findItemById(numericItemID);
  if (!item || toInt(item.categoryID, 0) !== CATEGORY_ORBITAL) {
    return {
      success: false,
      errorMsg: "ORBITAL_NOT_FOUND",
    };
  }

  const nowMs = Date.now();
  const record = ensureOrbitalForItem(item, {
    corporationID: toInt(session && (session.corporationID || session.corpid), toInt(item.ownerID, 0)),
    allianceID: toInt(session && (session.allianceID || session.allianceid), 0),
    warFactionID: toInt(session && (session.warFactionID || session.warfactionid), 0),
    solarSystemID: toInt(
      session && session._space && session._space.systemID,
      toInt(item.locationID, 0),
    ),
  });
  if (!record) {
    return {
      success: false,
      errorMsg: "ORBITAL_NOT_FOUND",
    };
  }

  const updatedRecord = normalizeOrbitalRecord({
    ...record,
    typeID: toInt(item.typeID, record.typeID),
    groupID: toInt(item.groupID, record.groupID),
    itemName: item.itemName || record.itemName,
    ownerID: toInt(item.ownerID, record.ownerID),
    corporationID: toInt(session && (session.corporationID || session.corpid), record.corporationID),
    allianceID: toInt(session && (session.allianceID || session.allianceid), record.allianceID),
    warFactionID: toInt(session && (session.warFactionID || session.warfactionid), record.warFactionID),
    state: nextState,
    stateStartedAtMs: nowMs,
    stateEndsAtMs: nowMs + Math.max(1_000, toInt(durationMs, DEFAULT_ORBITAL_TIMER_MS)),
  });

  return upsertOrbitalRecord(updatedRecord);
}

function anchorOrbital(itemID, session = null) {
  const record = getOrbitalByID(itemID);
  if (
    record &&
    ![ORBITAL_STATE.UNANCHORED, null, undefined].includes(record.state)
  ) {
    return {
      success: false,
      errorMsg: "ORBITAL_NOT_UNANCHORED",
      data: record,
    };
  }
  return beginOrbitalState(itemID, ORBITAL_STATE.ANCHORING, DEFAULT_ORBITAL_TIMER_MS, session);
}

function onlineOrbital(itemID, session = null) {
  const record = getOrbitalByID(itemID);
  if (
    record &&
    ![ORBITAL_STATE.ANCHORED, ORBITAL_STATE.UNANCHORED].includes(record.state)
  ) {
    return {
      success: false,
      errorMsg: "ORBITAL_NOT_ANCHORED",
      data: record,
    };
  }
  return beginOrbitalState(itemID, ORBITAL_STATE.ONLINING, DEFAULT_ORBITAL_TIMER_MS, session);
}

function unanchorOrbital(itemID, session = null) {
  const record = getOrbitalByID(itemID);
  if (
    record &&
    [ORBITAL_STATE.UNANCHORED, ORBITAL_STATE.UNANCHORING].includes(record.state)
  ) {
    return {
      success: false,
      errorMsg: "ORBITAL_ALREADY_UNANCHORED",
      data: record,
    };
  }
  return beginOrbitalState(itemID, ORBITAL_STATE.UNANCHORING, DEFAULT_ORBITAL_TIMER_MS, session);
}

function hydrateOrbitalEntityFromInventoryItem(entity, item, options = {}) {
  if (!entity || !item) {
    return entity;
  }

  const record = ensureOrbitalForItem(item, {
    solarSystemID: toInt(options.solarSystemID, toInt(entity.systemID, toInt(item.locationID, 0))),
  });
  if (!record) {
    return entity;
  }

  const latestItem = findItemById(item.itemID) || item;
  entity.typeID = toInt(latestItem.typeID, record.typeID);
  entity.groupID = toInt(latestItem.groupID, record.groupID);
  entity.categoryID = CATEGORY_ORBITAL;
  entity.itemName = String(latestItem.itemName || record.itemName || "Orbital");
  entity.ownerID = toInt(latestItem.ownerID, record.ownerID);
  entity.corporationID = toInt(record.corporationID, entity.ownerID);
  entity.allianceID = toInt(record.allianceID, 0);
  entity.warFactionID = toInt(record.warFactionID, 0);
  entity.locationID = toInt(record.solarSystemID, toInt(latestItem.locationID, entity.systemID));
  entity.planetID = toInt(record.planetID, 0);
  entity.level = Math.max(1, toInt(record.level, 1));
  entity.orbitalState = toInt(record.state, ORBITAL_STATE.UNANCHORED);
  entity.orbitalTimestampMs = toInt(record.stateEndsAtMs, 0) || null;
  entity.orbitalHackerID = null;
  entity.orbitalHackerProgress = null;
  entity.dunRotation = normalizeDunRotation(latestItem.dunRotation || record.dunRotation);
  return entity;
}

function buildOrbitalSettingsInfo(orbitalID) {
  const record = getOrbitalByID(orbitalID) || normalizeOrbitalRecord({
    itemID: orbitalID,
    typeID: TYPE_CUSTOMS_OFFICE,
    groupID: GROUP_PLANETARY_CUSTOMS_OFFICES,
    state: ORBITAL_STATE.IDLE,
  });
  return {
    reinforceHour: record.reinforceHour,
    taxRates: normalizeTaxRates(record.taxRates),
    standingLevel: record.standingLevel,
    allowAlliance: record.allowAlliance,
    allowStandings: record.allowStandings,
    aclGroupID: record.aclGroupID,
  };
}

function updateOrbitalSettings(orbitalID, settings = {}) {
  const record = getOrbitalByID(orbitalID, { refresh: true });
  if (!record) {
    return {
      success: false,
      errorMsg: "ORBITAL_NOT_FOUND",
    };
  }

  const updatedRecord = normalizeOrbitalRecord({
    ...record,
    reinforceHour: settings.reinforceHour,
    taxRates: settings.taxRates || record.taxRates,
    standingLevel: settings.standingLevel,
    allowAlliance: settings.allowAlliance,
    allowStandings: settings.allowStandings,
    aclGroupID: settings.aclGroupID,
  });
  return upsertOrbitalRecord(updatedRecord);
}

function getTaxRate(orbitalID) {
  const record = getOrbitalByID(orbitalID, { refresh: true });
  if (!record) {
    return DEFAULT_TAX_RATES.corporation;
  }
  const rates = normalizeTaxRates(record.taxRates);
  return rates.corporation;
}

function resetForTests(snapshot = null) {
  const payload = snapshot || {
    schemaVersion: SCHEMA_VERSION,
    orbitalsByID: {},
  };
  return writeState(cloneJson(payload));
}

module.exports = {
  TABLE_NAME,
  SCHEMA_VERSION,
  CATEGORY_ORBITAL,
  GROUP_PLANETARY_CUSTOMS_OFFICES,
  GROUP_ORBITAL_CONSTRUCTION_PLATFORM,
  TYPE_CUSTOMS_OFFICE,
  TYPE_CUSTOMS_OFFICE_GANTRY,
  TYPE_INTERBUS_CUSTOMS_OFFICE,
  ORBITAL_STATE,
  DEFAULT_ORBITAL_TIMER_MS,
  DEFAULT_TAX_RATES,
  readState,
  writeState,
  tickDueOrbitals,
  ensureOrbitalForItem,
  getOrbitalByID,
  listOrbitalsForSystem,
  listOrbitalsForPlanet,
  findNearestPlanetID,
  anchorOrbital,
  onlineOrbital,
  unanchorOrbital,
  hydrateOrbitalEntityFromInventoryItem,
  buildOrbitalSettingsInfo,
  updateOrbitalSettings,
  getTaxRate,
  resetForTests,
  _testing: {
    normalizeOrbitalRecord,
    normalizeTaxRates,
    findNearestPlanetID,
  },
};
