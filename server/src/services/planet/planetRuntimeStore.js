const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  currentFileTime,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const planetStaticData = require("./planetStaticData");

const TABLE_NAME = "planetRuntimeState";
const SCHEMA_VERSION = 1;
const RESOURCE_RECORD_VERSION = 2;
const RESOURCE_LAYER_VERSION = 1;
const PLANET_RESOURCE_MAX_VALUE = 1.21;
const MAX_DISPLAY_QUALITY = 154;
const LINK_TYPE_ID = 2280;
const STATE_IDLE = 0;
const STATE_ACTIVE = 1;
const SECOND_TICKS = 10000000;
const HOUR_TICKS = 60 * 60 * 10000000;
const DAY_TICKS = 24n * 60n * 60n * 10000000n;
const FILETIME_UNIX_EPOCH_OFFSET = 116444736000000000n;
const MAX_SIMULATION_EVENTS = 20000;
const COMMAND_CENTER_LAUNCH_CYCLE_TICKS = 60n * 10000000n;
const PI_LAUNCH_ORBIT_DECAY_TICKS = 5n * DAY_TICKS;
const PI_LAUNCH_CLEANUP_GRACE_TICKS = 30n * DAY_TICKS;
const EXPEDITED_TRANSFER_MINIMUM_TICKS = 5 * 60 * 10000000;
const MAX_ROUTE_WAYPOINTS = 5;
const LINK_MAX_UPGRADE = 10;
const RADIUS_DRILL_AREA_MIN = 0.01;
const RADIUS_DRILL_AREA_MAX = 0.05;
const RADIUS_DRILL_AREA_DIFF = RADIUS_DRILL_AREA_MAX - RADIUS_DRILL_AREA_MIN;
const RESOURCE_LAYER_HOTSPOT_MIN = 6;
const RESOURCE_LAYER_HOTSPOT_SPREAD = 4;
const RESOURCE_DEPLETION_EVENT_LIMIT = 24;
const RESOURCE_DEPLETION_RECOVERY_HOURS = 96;
const RESOURCE_SH_MAX_BANDS = 30;
const RESOURCE_SH_COEFFICIENT_BYTES = 4;
const DEFAULT_ECU_TYPE_ID = 2848;

const COMMAND = Object.freeze({
  CREATEPIN: 1,
  REMOVEPIN: 2,
  CREATELINK: 3,
  REMOVELINK: 4,
  SETLINKLEVEL: 5,
  CREATEROUTE: 6,
  REMOVEROUTE: 7,
  SETSCHEMATIC: 8,
  UPGRADECOMMANDCENTER: 9,
  ADDEXTRACTORHEAD: 10,
  KILLEXTRACTORHEAD: 11,
  MOVEEXTRACTORHEAD: 12,
  INSTALLPROGRAM: 13,
});

const DEFAULT_NEXT_IDS = Object.freeze({
  pinID: 900000000000,
  routeID: 1,
  launchID: 910000000000,
});

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeState(rawState = {}) {
  const state = isPlainObject(rawState) ? { ...rawState } : {};
  let changed = false;

  if (state.schemaVersion !== SCHEMA_VERSION) {
    state.schemaVersion = SCHEMA_VERSION;
    changed = true;
  }

  for (const key of [
    "resourcesByPlanetID",
    "coloniesByKey",
    "launchesByID",
    "acceptedNetworkEditsByKey",
  ]) {
    if (!isPlainObject(state[key])) {
      state[key] = {};
      changed = true;
    }
  }

  if (!isPlainObject(state.nextIDs)) {
    state.nextIDs = cloneJson(DEFAULT_NEXT_IDS);
    changed = true;
  } else {
    for (const [key, value] of Object.entries(DEFAULT_NEXT_IDS)) {
      if (!Number.isFinite(Number(state.nextIDs[key]))) {
        state.nextIDs[key] = value;
        changed = true;
      }
    }
  }

  return { state, changed };
}

function readState(options = {}) {
  const result = database.read(TABLE_NAME, "/");
  if (!result.success) {
    log.warn(
      `[PlanetRuntimeStore] Failed to read ${TABLE_NAME}: ${result.errorMsg || "READ_ERROR"}`,
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
      `[PlanetRuntimeStore] Failed to flush ${TABLE_NAME}: ${result.errorMsg || "FLUSH_ERROR"}`,
    );
  }
  return result.success === true;
}

function writeState(state) {
  const { state: normalizedState } = normalizeState(state);
  const result = database.write(TABLE_NAME, "/", normalizedState, { force: true });
  if (!result.success) {
    log.warn(
      `[PlanetRuntimeStore] Failed to write ${TABLE_NAME}: ${result.errorMsg || "WRITE_ERROR"}`,
    );
    return false;
  }
  return flushStateToDisk();
}

function normalizeInteger(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.trunc(numericValue);
}

function normalizeReal(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function normalizeNullableInteger(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.trunc(numericValue) : null;
}

function currentFileTimeString() {
  return currentFileTime().toString();
}

function filetimeBigInt(value, fallback = currentFileTime()) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  try {
    if (typeof value === "bigint") {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return BigInt(Math.trunc(value));
    }
    if (typeof value === "string") {
      return BigInt(value);
    }
  } catch (error) {
    return fallback;
  }

  return fallback;
}

function colonyKey(planetID, ownerID) {
  return `${normalizeInteger(planetID, 0)}:${normalizeInteger(ownerID, 0)}`;
}

function getAcceptedNetworkEditBucket(state, key, options = {}) {
  if (!isPlainObject(state.acceptedNetworkEditsByKey)) {
    state.acceptedNetworkEditsByKey = {};
  }
  if (!isPlainObject(state.acceptedNetworkEditsByKey[key])) {
    if (options.create !== true) {
      return null;
    }
    state.acceptedNetworkEditsByKey[key] = {};
  }
  return state.acceptedNetworkEditsByKey[key];
}

function hasAcceptedNetworkEdit({
  planetID,
  ownerID,
  editHash,
} = {}) {
  const normalizedPlanetID = normalizeInteger(planetID, 0);
  const normalizedOwnerID = normalizeInteger(ownerID, 0);
  if (normalizedPlanetID <= 0 || normalizedOwnerID <= 0 || !editHash) {
    return false;
  }

  const state = readState({ repair: true });
  const bucket = getAcceptedNetworkEditBucket(
    state,
    colonyKey(normalizedPlanetID, normalizedOwnerID),
  );
  return Boolean(bucket && bucket[String(editHash)]);
}

function markAcceptedNetworkEdit(state, key, editHash, details = {}) {
  if (!editHash) {
    return;
  }
  const bucket = getAcceptedNetworkEditBucket(state, key, { create: true });
  bucket[String(editHash)] = {
    editHash: String(editHash),
    acceptedAt: new Date().toISOString(),
    constructionCost: normalizeReal(details.constructionCost, 0),
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeResourceTypeIDs(resourceTypeIDs = []) {
  return [...new Set(
    (Array.isArray(resourceTypeIDs) ? resourceTypeIDs : [])
      .map((typeID) => normalizeInteger(typeID, 0))
      .filter((typeID) => typeID > 0),
  )].sort((left, right) => left - right);
}

function stableHash(parts = []) {
  let hash = 2166136261;
  const source = parts.map((part) => String(part)).join(":");
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function hashRatio(parts = []) {
  return stableHash(parts) / 0xffffffff;
}

function signedHashRatio(parts = []) {
  return (hashRatio(parts) * 2) - 1;
}

function normalizeLongitude(value) {
  const tau = Math.PI * 2;
  const rawValue = normalizeReal(value, 0);
  const wrapped = rawValue % tau;
  return wrapped < 0 ? wrapped + tau : wrapped;
}

function normalizeLatitude(value) {
  return clamp(normalizeReal(value, 0), 0, Math.PI);
}

function normalizeSurfacePoint(latitude, longitude) {
  return {
    latitude: normalizeLatitude(latitude),
    longitude: normalizeLongitude(longitude),
  };
}

function sphericalDistance(left, right) {
  const deltaLongitude = normalizeLongitude(left.longitude - right.longitude);
  const shortestDelta = deltaLongitude > Math.PI
    ? (Math.PI * 2) - deltaLongitude
    : deltaLongitude;
  const cosineDistance = (
    Math.cos(left.latitude) * Math.cos(right.latitude) +
    Math.sin(left.latitude) * Math.sin(right.latitude) * Math.cos(shortestDelta)
  );
  return Math.acos(clamp(cosineDistance, -1, 1));
}

function filetimeToUnixMs(value, fallbackMs = Date.now()) {
  if (value === null || value === undefined || value === "") {
    return fallbackMs;
  }

  try {
    const filetime = typeof value === "bigint" ? value : BigInt(String(value));
    return Number((filetime - FILETIME_UNIX_EPOCH_OFFSET) / 10000n);
  } catch (error) {
    return fallbackMs;
  }
}

function buildResourceQuality(planetMeta, resourceTypeID, index) {
  const planetID = normalizeInteger(planetMeta && planetMeta.planetID, 0);
  const planetTypeID = normalizeInteger(planetMeta && planetMeta.typeID, 0);
  const security = Number(planetMeta && planetMeta.security);
  const securityBonus = Number.isFinite(security)
    ? clamp(1 - security, 0, 1.25) * 22
    : 10;
  const noise = hashRatio([planetID, planetTypeID, resourceTypeID, "quality"]);
  const spread = 42 + noise * 78 + securityBonus + index * 2.5;
  return Math.round(clamp(spread, 18, MAX_DISPLAY_QUALITY));
}

function buildResourceHotspot(planetMeta, resourceTypeID, quality, index, hotspotIndex) {
  const planetID = normalizeInteger(planetMeta && planetMeta.planetID, 0);
  const planetTypeID = normalizeInteger(planetMeta && planetMeta.typeID, 0);
  const seedParts = [
    planetID,
    planetTypeID,
    resourceTypeID,
    index,
    hotspotIndex,
    "resource-hotspot",
  ];
  const qualityScale = clamp(quality / MAX_DISPLAY_QUALITY, 0.08, 1);

  return {
    latitude: Number((hashRatio([...seedParts, "latitude"]) * Math.PI).toFixed(6)),
    longitude: Number((hashRatio([...seedParts, "longitude"]) * Math.PI * 2).toFixed(6)),
    radius: Number((0.16 + hashRatio([...seedParts, "radius"]) * 0.34).toFixed(6)),
    amplitude: Number(((0.24 + hashRatio([...seedParts, "amplitude"]) * 0.94) * qualityScale).toFixed(6)),
  };
}

function buildResourceLayer(planetMeta, resourceTypeID, quality, index) {
  const planetID = normalizeInteger(planetMeta && planetMeta.planetID, 0);
  const planetTypeID = normalizeInteger(planetMeta && planetMeta.typeID, 0);
  const solarSystemID = normalizeInteger(planetMeta && planetMeta.solarSystemID, 0);
  const seed = stableHash([
    planetID,
    planetTypeID,
    solarSystemID,
    resourceTypeID,
    "resource-layer",
  ]);
  const qualityScale = clamp(quality / MAX_DISPLAY_QUALITY, 0.08, 1);
  const hotspotCount = RESOURCE_LAYER_HOTSPOT_MIN +
    Math.floor(hashRatio([seed, "hotspot-count"]) * RESOURCE_LAYER_HOTSPOT_SPREAD);
  const hotspots = [];
  for (let hotspotIndex = 0; hotspotIndex < hotspotCount; hotspotIndex += 1) {
    hotspots.push(buildResourceHotspot(
      planetMeta,
      resourceTypeID,
      quality,
      index,
      hotspotIndex,
    ));
  }

  return {
    version: RESOURCE_LAYER_VERSION,
    resourceTypeID,
    seed,
    quality,
    background: Number((qualityScale * (0.08 + hashRatio([seed, "background"]) * 0.08)).toFixed(6)),
    hotspots,
    depletionEvents: [],
  };
}

function normalizeResourceLayer(layer = {}) {
  const normalizedLayer = isPlainObject(layer) ? { ...layer } : {};
  normalizedLayer.version = normalizeInteger(normalizedLayer.version, 0);
  normalizedLayer.resourceTypeID = normalizeInteger(normalizedLayer.resourceTypeID, 0);
  normalizedLayer.seed = normalizeInteger(normalizedLayer.seed, 0);
  normalizedLayer.quality = normalizeInteger(normalizedLayer.quality, 0);
  normalizedLayer.background = clamp(normalizeReal(normalizedLayer.background, 0), 0, PLANET_RESOURCE_MAX_VALUE);
  normalizedLayer.hotspots = (Array.isArray(normalizedLayer.hotspots) ? normalizedLayer.hotspots : [])
    .map((hotspot) => ({
      latitude: normalizeLatitude(hotspot && hotspot.latitude),
      longitude: normalizeLongitude(hotspot && hotspot.longitude),
      radius: clamp(normalizeReal(hotspot && hotspot.radius, 0.2), 0.01, Math.PI),
      amplitude: clamp(normalizeReal(hotspot && hotspot.amplitude, 0), 0, PLANET_RESOURCE_MAX_VALUE),
    }));
  normalizedLayer.depletionEvents = (Array.isArray(normalizedLayer.depletionEvents)
    ? normalizedLayer.depletionEvents
    : [])
    .map((event) => ({
      installTime: event && event.installTime ? String(event.installTime) : null,
      expiryTime: event && event.expiryTime ? String(event.expiryTime) : null,
      headRadius: clamp(
        normalizeReal(event && event.headRadius, RADIUS_DRILL_AREA_MIN),
        RADIUS_DRILL_AREA_MIN,
        RADIUS_DRILL_AREA_MAX,
      ),
      depletionRadius: clamp(normalizeReal(event && event.depletionRadius, 0.15), 0.01, Math.PI),
      strength: clamp(normalizeReal(event && event.strength, 0), 0, PLANET_RESOURCE_MAX_VALUE),
      heads: normalizeHeads(event && event.heads),
    }))
    .filter((event) => event.strength > 0 && event.heads.length > 0);
  return normalizedLayer;
}

function buildResourceRecord(planetMeta, resourceTypeIDs = []) {
  const normalizedTypeIDs = normalizeResourceTypeIDs(resourceTypeIDs);
  const planetID = normalizeInteger(planetMeta && planetMeta.planetID, 0);
  const planetTypeID = normalizeInteger(planetMeta && planetMeta.typeID, 0);
  const solarSystemID = normalizeInteger(planetMeta && planetMeta.solarSystemID, 0);
  const seed = stableHash([planetID, planetTypeID, solarSystemID, "planet-resource"]);
  const qualitiesByTypeID = {};
  const layersByTypeID = {};

  normalizedTypeIDs.forEach((resourceTypeID, index) => {
    const quality = buildResourceQuality(
      planetMeta,
      resourceTypeID,
      index,
    );
    qualitiesByTypeID[String(resourceTypeID)] = quality;
    layersByTypeID[String(resourceTypeID)] = buildResourceLayer(
      planetMeta,
      resourceTypeID,
      quality,
      index,
    );
  });

  return {
    version: RESOURCE_RECORD_VERSION,
    planetID,
    planetTypeID,
    solarSystemID,
    seed,
    resourceTypeIDs: normalizedTypeIDs,
    qualitiesByTypeID,
    layersByTypeID,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function shouldRefreshResourceRecord(record, planetMeta, resourceTypeIDs) {
  if (!isPlainObject(record) || record.version !== RESOURCE_RECORD_VERSION) {
    return true;
  }

  const normalizedTypeIDs = normalizeResourceTypeIDs(resourceTypeIDs);
  const storedTypeIDs = normalizeResourceTypeIDs(record.resourceTypeIDs);
  if (storedTypeIDs.length !== normalizedTypeIDs.length) {
    return true;
  }

  if (!isPlainObject(record.layersByTypeID)) {
    return true;
  }

  if (normalizedTypeIDs.some((typeID) => {
    const layer = record.layersByTypeID[String(typeID)];
    return !isPlainObject(layer) || normalizeInteger(layer.version, 0) !== RESOURCE_LAYER_VERSION;
  })) {
    return true;
  }

  return normalizedTypeIDs.some((typeID, index) => storedTypeIDs[index] !== typeID) ||
    normalizeInteger(record.planetTypeID, 0) !== normalizeInteger(planetMeta && planetMeta.typeID, 0);
}

function getOrCreatePlanetResources(planetMeta, resourceTypeIDs = []) {
  const planetID = normalizeInteger(planetMeta && planetMeta.planetID, 0);
  if (planetID <= 0) {
    return buildResourceRecord(planetMeta || {}, resourceTypeIDs);
  }

  const state = readState({ repair: true });
  const key = String(planetID);
  if (shouldRefreshResourceRecord(state.resourcesByPlanetID[key], planetMeta, resourceTypeIDs)) {
    const previousRecord = state.resourcesByPlanetID[key];
    const nextRecord = buildResourceRecord(planetMeta, resourceTypeIDs);
    if (previousRecord && previousRecord.createdAt) {
      nextRecord.createdAt = previousRecord.createdAt;
    }
    state.resourcesByPlanetID[key] = nextRecord;
    writeState(state);
  }

  return state.resourcesByPlanetID[key];
}

function getResourceLayerFromRecord(resourceRecord, resourceTypeID) {
  if (!isPlainObject(resourceRecord) || !isPlainObject(resourceRecord.layersByTypeID)) {
    return null;
  }
  const layer = resourceRecord.layersByTypeID[String(normalizeInteger(resourceTypeID, 0))];
  return isPlainObject(layer) ? normalizeResourceLayer(layer) : null;
}

function getResourceLayer(planetID, resourceTypeID, options = {}) {
  const normalizedPlanetID = normalizeInteger(planetID, 0);
  const normalizedResourceTypeID = normalizeInteger(resourceTypeID, 0);
  if (normalizedPlanetID <= 0 || normalizedResourceTypeID <= 0) {
    return null;
  }

  const state = options.state || readState({ repair: true });
  const resourceRecord = state.resourcesByPlanetID[String(normalizedPlanetID)];
  return getResourceLayerFromRecord(resourceRecord, normalizedResourceTypeID);
}

function buildResourceLayerCoefficient(layer, coefficientIndex, options = {}) {
  const normalizedLayer = normalizeResourceLayer(layer);
  const band = Math.floor(Math.sqrt(coefficientIndex)) + 1;
  const bandStart = (band - 1) ** 2;
  const withinBand = coefficientIndex - bandStart;
  const qualityScale = clamp(normalizedLayer.quality / MAX_DISPLAY_QUALITY, 0.08, 1);

  if (coefficientIndex === 0) {
    return 64 + (qualityScale * 142);
  }

  const seed = normalizedLayer.seed || stableHash([
    normalizedLayer.resourceTypeID,
    normalizedLayer.quality,
    "resource-sh",
  ]);
  const bandDecay = 1 / (1 + (band * 0.32));
  const angleMultiplier = withinBand + 1;
  const hotspots = normalizedLayer.hotspots.length > 0
    ? normalizedLayer.hotspots
    : [{ latitude: Math.PI / 2, longitude: 0, amplitude: normalizedLayer.background || 0.1 }];
  let hotspotSignal = 0;
  for (let index = 0; index < hotspots.length; index += 1) {
    const hotspot = hotspots[index];
    const phase = (
      band * Math.cos(hotspot.latitude) +
      angleMultiplier * Math.sin(hotspot.longitude) +
      index
    );
    hotspotSignal += hotspot.amplitude * Math.cos(phase);
  }
  hotspotSignal /= Math.max(1, hotspots.length);

  let depletionSignal = 0;
  const nowMs = normalizeInteger(options.nowMs, Date.now());
  for (const event of normalizedLayer.depletionEvents) {
    const timeFactor = getDepletionEventFactor(event, nowMs);
    if (timeFactor < 0.01) {
      continue;
    }

    for (const head of event.heads) {
      const phase = (
        band * Math.cos(head[1]) +
        angleMultiplier * Math.sin(head[2])
      );
      depletionSignal += event.strength * timeFactor * Math.cos(phase);
    }
  }

  const noise = signedHashRatio([
    seed,
    normalizedLayer.resourceTypeID,
    band,
    withinBand,
    "resource-sh-coeff",
  ]);
  const coefficient = (
    (hotspotSignal * 13.5) +
    (noise * 2.25 * qualityScale) -
    (depletionSignal * 9.5)
  ) * bandDecay;
  return Number.isFinite(coefficient) ? coefficient : 0;
}

function buildResourceLayerBuffer(layer, numBands, options = {}) {
  const normalizedBands = clamp(
    normalizeInteger(numBands, 0),
    0,
    RESOURCE_SH_MAX_BANDS,
  );
  const coefficientCount = normalizedBands ** 2;
  const buffer = Buffer.alloc(coefficientCount * RESOURCE_SH_COEFFICIENT_BYTES);
  for (let coefficientIndex = 0; coefficientIndex < coefficientCount; coefficientIndex += 1) {
    buffer.writeFloatLE(
      buildResourceLayerCoefficient(layer, coefficientIndex, options),
      coefficientIndex * RESOURCE_SH_COEFFICIENT_BYTES,
    );
  }
  return buffer;
}

function getResourceDataForClient(planetMeta, resourceTypeID, resourceTypeIDs = [], info = {}) {
  const resourceRecord = getOrCreatePlanetResources(planetMeta, resourceTypeIDs);
  const layer = getResourceLayerFromRecord(resourceRecord, resourceTypeID);
  const oldBand = normalizeInteger(info.oldBand, 0);
  const requestedBand = clamp(
    normalizeInteger(info.newBand, oldBand),
    0,
    RESOURCE_SH_MAX_BANDS,
  );

  if (!layer || requestedBand <= 0) {
    return {
      data: null,
      numBands: oldBand,
      proximity: Object.prototype.hasOwnProperty.call(info, "proximity")
        ? info.proximity
        : null,
      layer,
    };
  }

  return {
    data: {
      type: "bytes",
      value: buildResourceLayerBuffer(layer, requestedBand),
    },
    numBands: requestedBand,
    proximity: Object.prototype.hasOwnProperty.call(info, "proximity")
      ? info.proximity
      : null,
    layer,
  };
}

function getDepletionEventFactor(event, nowMs = Date.now()) {
  const expiryMs = filetimeToUnixMs(event && event.expiryTime, nowMs);
  if (nowMs <= expiryMs) {
    return 1;
  }

  const hoursSinceExpiry = Math.max(0, (nowMs - expiryMs) / (60 * 60 * 1000));
  return Math.exp(-hoursSinceExpiry / RESOURCE_DEPLETION_RECOVERY_HOURS);
}

function evaluateResourceLayerValue(layer, latitude, longitude, options = {}) {
  if (!isPlainObject(layer)) {
    return 0;
  }

  const normalizedLayer = normalizeResourceLayer(layer);
  const point = normalizeSurfacePoint(latitude, longitude);
  let value = normalizedLayer.background;

  for (const hotspot of normalizedLayer.hotspots) {
    const distance = sphericalDistance(point, hotspot);
    const radius = Math.max(0.01, hotspot.radius);
    value += hotspot.amplitude * Math.exp(-(distance * distance) / (2 * radius * radius));
  }

  const nowMs = normalizeInteger(options.nowMs, Date.now());
  for (const event of normalizedLayer.depletionEvents) {
    const timeFactor = getDepletionEventFactor(event, nowMs);
    if (timeFactor < 0.01) {
      continue;
    }

    for (const head of event.heads) {
      const headPoint = normalizeSurfacePoint(head[1], head[2]);
      const distance = sphericalDistance(point, headPoint);
      const radius = Math.max(0.01, event.depletionRadius);
      value -= event.strength * timeFactor *
        Math.exp(-(distance * distance) / (2 * radius * radius));
    }
  }

  return clamp(value, 0, PLANET_RESOURCE_MAX_VALUE);
}

function evaluateResourceValueAt(planetID, resourceTypeID, latitude, longitude, options = {}) {
  const layer = getResourceLayer(planetID, resourceTypeID, options);
  return evaluateResourceLayerValue(layer, latitude, longitude, options);
}

function pruneDepletionEvents(events = [], nowMs = Date.now()) {
  return (Array.isArray(events) ? events : [])
    .map((event) => normalizeResourceLayer({ depletionEvents: [event] }).depletionEvents[0])
    .filter((event) => event && getDepletionEventFactor(event, nowMs) >= 0.01)
    .slice(-RESOURCE_DEPLETION_EVENT_LIMIT);
}

function normalizeIDTuple(value) {
  const unwrapped = unwrapMarshalValue(value);
  if (!Array.isArray(unwrapped) || unwrapped.length < 2) {
    return null;
  }

  const namespace = normalizeInteger(unwrapped[0], 0);
  const localID = normalizeInteger(unwrapped[1], 0);
  if (namespace <= 0 || localID <= 0) {
    return null;
  }
  return [namespace, localID];
}

function temporaryIDKey(value) {
  const tuple = normalizeIDTuple(value);
  if (tuple) {
    return `tmp:${tuple[0]}:${tuple[1]}`;
  }

  const normalizedID = normalizeInteger(value, 0);
  return normalizedID > 0 ? `id:${normalizedID}` : null;
}

function isTemporaryID(value, namespace = null) {
  const tuple = normalizeIDTuple(value);
  if (!tuple) {
    return false;
  }
  return namespace === null || tuple[0] === namespace;
}

function collectUsedIDs(state, fieldName) {
  const usedIDs = new Set();
  for (const colony of Object.values(state.coloniesByKey || {})) {
    for (const pin of Array.isArray(colony && colony.pins) ? colony.pins : []) {
      if (fieldName === "pinID") {
        const pinID = normalizeInteger(pin && (pin.pinID ?? pin.id), 0);
        if (pinID > 0) {
          usedIDs.add(pinID);
        }
      }
    }
    for (const route of Array.isArray(colony && colony.routes) ? colony.routes : []) {
      if (fieldName === "routeID") {
        const routeID = normalizeInteger(route && route.routeID, 0);
        if (routeID > 0) {
          usedIDs.add(routeID);
        }
      }
    }
  }
  if (fieldName === "launchID") {
    for (const [key, launch] of Object.entries(state.launchesByID || {})) {
      const launchID = normalizeInteger((launch && launch.launchID) || key, 0);
      if (launchID > 0) {
        usedIDs.add(launchID);
      }
    }
  }
  return usedIDs;
}

function allocateNextID(state, key, usedIDs = new Set()) {
  if (!isPlainObject(state.nextIDs)) {
    state.nextIDs = cloneJson(DEFAULT_NEXT_IDS);
  }

  const fallbackID = DEFAULT_NEXT_IDS[key] || 1;
  let candidate = normalizeInteger(state.nextIDs[key], fallbackID);
  if (candidate <= 0) {
    candidate = fallbackID;
  }

  while (usedIDs.has(candidate)) {
    candidate += 1;
  }

  usedIDs.add(candidate);
  state.nextIDs[key] = candidate + 1;
  return candidate;
}

function resolveSubmittedID(value, idMap) {
  const key = temporaryIDKey(value);
  if (key && idMap.has(key)) {
    return idMap.get(key);
  }

  const normalizedID = normalizeInteger(value, 0);
  return normalizedID > 0 ? normalizedID : 0;
}

function findPin(colony, pinID) {
  const normalizedPinID = normalizeInteger(pinID, 0);
  return (Array.isArray(colony.pins) ? colony.pins : [])
    .find((pin) => normalizeInteger(pin && (pin.pinID ?? pin.id), 0) === normalizedPinID) || null;
}

function normalizeContents(contents) {
  if (!isPlainObject(contents)) {
    return {};
  }

  const normalizedContents = {};
  for (const [typeID, quantity] of Object.entries(contents)) {
    const normalizedTypeID = normalizeInteger(typeID, 0);
    const normalizedQuantity = normalizeInteger(quantity, 0);
    if (normalizedTypeID > 0 && normalizedQuantity > 0) {
      normalizedContents[String(normalizedTypeID)] = normalizedQuantity;
    }
  }
  return normalizedContents;
}

function normalizeLaunchRecord(launch = {}) {
  const launchID = normalizeInteger(launch.launchID ?? launch.itemID, 0);
  return {
    ...launch,
    launchID,
    itemID: normalizeInteger(launch.itemID ?? launchID, launchID),
    ownerID: normalizeInteger(launch.ownerID, 0),
    planetID: normalizeInteger(launch.planetID, 0),
    solarSystemID: normalizeInteger(launch.solarSystemID, 0),
    commandPinID: normalizeInteger(launch.commandPinID, 0),
    launchTime: launch.launchTime ? String(launch.launchTime) : currentFileTimeString(),
    x: normalizeReal(launch.x, 0),
    y: normalizeReal(launch.y, 0),
    z: normalizeReal(launch.z, 0),
    contents: normalizeContents(launch.contents),
    deleted: launch.deleted === true,
    createdAt: launch.createdAt || new Date().toISOString(),
    updatedAt: launch.updatedAt || launch.createdAt || new Date().toISOString(),
  };
}

function isLaunchExpired(launch, nowFileTime = currentFileTime()) {
  const normalizedLaunch = normalizeLaunchRecord(launch);
  const launchTime = filetimeBigInt(normalizedLaunch.launchTime, nowFileTime);
  return nowFileTime - launchTime >= PI_LAUNCH_ORBIT_DECAY_TICKS;
}

function isLaunchCleanupEligible(launch, nowFileTime = currentFileTime(), maxAgeTicks = null) {
  const normalizedLaunch = normalizeLaunchRecord(launch);
  const launchTime = filetimeBigInt(normalizedLaunch.launchTime, nowFileTime);
  const cleanupAge = maxAgeTicks === null
    ? PI_LAUNCH_ORBIT_DECAY_TICKS + PI_LAUNCH_CLEANUP_GRACE_TICKS
    : BigInt(maxAgeTicks);
  return nowFileTime - launchTime >= cleanupAge;
}

function summarizeContents(contents = {}) {
  const normalizedContents = normalizeContents(contents);
  return Object.entries(normalizedContents)
    .map(([typeID, quantity]) => ({
      typeID: normalizeInteger(typeID, 0),
      quantity: normalizeInteger(quantity, 0),
    }))
    .sort((left, right) => left.typeID - right.typeID);
}

function normalizePin(pin = {}, ownerID = 0) {
  const pinID = normalizeInteger(pin.pinID ?? pin.id, 0);
  const typeID = normalizeInteger(pin.typeID, 0);
  const entityType = planetStaticData.getPinEntityType(typeID);
  const normalizedPin = {
    ...pin,
    id: pinID,
    pinID,
    ownerID: normalizeInteger(pin.ownerID ?? pin.charID, ownerID),
    typeID,
    latitude: normalizeReal(pin.latitude, 0),
    longitude: normalizeReal(pin.longitude, 0),
    lastRunTime: pin.lastRunTime ? String(pin.lastRunTime) : currentFileTimeString(),
    contents: normalizeContents(pin.contents),
    state: normalizeInteger(pin.state, STATE_IDLE),
  };

  if (entityType === "command" || entityType === "spaceport") {
    normalizedPin.lastLaunchTime = pin.lastLaunchTime ? String(pin.lastLaunchTime) : "0";
  }

  if (entityType === "process") {
    normalizedPin.schematicID = normalizeNullableInteger(pin.schematicID);
    normalizedPin.hasReceivedInputs = pin.hasReceivedInputs === true;
    normalizedPin.receivedInputsLastCycle = pin.receivedInputsLastCycle === true;
  }

  if (entityType === "ecu") {
    normalizedPin.cycleTime = normalizeInteger(pin.cycleTime, 0);
    normalizedPin.programType = normalizeNullableInteger(pin.programType);
    normalizedPin.qtyPerCycle = normalizeInteger(pin.qtyPerCycle, 0);
    normalizedPin.expiryTime = pin.expiryTime ? String(pin.expiryTime) : null;
    normalizedPin.installTime = pin.installTime ? String(pin.installTime) : null;
    normalizedPin.headRadius = normalizeReal(pin.headRadius, RADIUS_DRILL_AREA_MIN);
    normalizedPin.heads = (Array.isArray(pin.heads) ? pin.heads : [])
      .map((head) => (Array.isArray(head) ? head : []))
      .map((head) => [
        normalizeInteger(head[0], 0),
        normalizeReal(head[1], normalizedPin.latitude),
        normalizeReal(head[2], normalizedPin.longitude),
      ])
      .sort((left, right) => left[0] - right[0]);
  }

  return normalizedPin;
}

function buildPin(pinID, typeID, ownerID, latitude, longitude) {
  const entityType = planetStaticData.getPinEntityType(typeID);
  if (!entityType || entityType === "link") {
    throw new Error(`Invalid PI pin typeID ${typeID}`);
  }

  return normalizePin({
    id: pinID,
    pinID,
    ownerID,
    typeID,
    latitude,
    longitude,
    lastRunTime: currentFileTimeString(),
    contents: {},
    state: STATE_IDLE,
  }, ownerID);
}

function buildLaunchCoordinates(planetMeta = {}, launchID = 0) {
  const position = isPlainObject(planetMeta.position) ? planetMeta.position : {};
  const baseX = normalizeReal(position.x ?? planetMeta.x, 0);
  const baseY = normalizeReal(position.y ?? planetMeta.y, 0);
  const baseZ = normalizeReal(position.z ?? planetMeta.z, 0);
  const radius = Math.max(0, normalizeReal(planetMeta.radius, 0));
  const distance = Math.max(radius + 2500000, 10000000);
  const seed = stableHash([
    planetMeta.planetID,
    planetMeta.ownerID,
    launchID,
    "planetary-launch",
  ]);
  const theta = hashRatio([seed, "theta"]) * Math.PI * 2;
  const phi = Math.acos((hashRatio([seed, "phi"]) * 2) - 1);
  return {
    x: Math.round(baseX + (Math.sin(phi) * Math.cos(theta) * distance)),
    y: Math.round(baseY + (Math.sin(phi) * Math.sin(theta) * distance)),
    z: Math.round(baseZ + (Math.cos(phi) * distance)),
  };
}

function normalizeColony(rawColony, context = {}) {
  const planetID = normalizeInteger(
    context.planetID ?? (rawColony && rawColony.planetID),
    0,
  );
  const ownerID = normalizeInteger(
    context.ownerID ?? (rawColony && rawColony.ownerID),
    0,
  );
  const now = currentFileTimeString();

  const colony = isPlainObject(rawColony) ? cloneJson(rawColony) : {};
  colony.planetID = planetID;
  colony.ownerID = ownerID;
  colony.solarSystemID = normalizeInteger(
    context.solarSystemID ?? colony.solarSystemID,
    0,
  );
  colony.planetTypeID = normalizeInteger(
    context.planetTypeID ?? colony.planetTypeID ?? colony.typeID,
    0,
  );
  colony.planetRadius = normalizeReal(context.planetRadius ?? colony.planetRadius, 0);
  colony.typeID = colony.planetTypeID;
  colony.level = normalizeInteger(colony.level ?? colony.commandCenterLevel, 0);
  colony.commandCenterLevel = colony.level;
  colony.currentSimTime = colony.currentSimTime ? String(colony.currentSimTime) : now;
  colony.createdAt = colony.createdAt || new Date().toISOString();
  colony.updatedAt = colony.updatedAt || colony.createdAt;
  colony.pins = (Array.isArray(colony.pins) ? colony.pins : [])
    .map((pin) => normalizePin(pin, ownerID))
    .filter((pin) => normalizeInteger(pin.pinID, 0) > 0);
  colony.links = (Array.isArray(colony.links) ? colony.links : [])
    .map((link) => {
      const endpoints = sortEndpoints(link && link.endpoint1, link && link.endpoint2);
      return {
        ...link,
        typeID: normalizeInteger(link && link.typeID, LINK_TYPE_ID),
        endpoint1: endpoints[0],
        endpoint2: endpoints[1],
        level: normalizeInteger(link && link.level, 0),
      };
    })
    .filter((link) => link.endpoint1 > 0 && link.endpoint2 > 0 && link.endpoint1 !== link.endpoint2);
  colony.routes = (Array.isArray(colony.routes) ? colony.routes : [])
    .map((route) => ({
      ...route,
      routeID: normalizeInteger(route && route.routeID, 0),
      charID: normalizeInteger(route && (route.charID ?? route.ownerID), ownerID),
      path: (Array.isArray(route && route.path) ? route.path : [])
        .map((pinID) => normalizeInteger(pinID, 0))
        .filter((pinID) => pinID > 0),
      commodityTypeID: normalizeInteger(route && (route.commodityTypeID ?? route.typeID), 0),
      commodityQuantity: normalizeInteger(route && (route.commodityQuantity ?? route.quantity), 0),
    }))
    .filter((route) => route.routeID > 0 && route.path.length >= 2);

  return colony;
}

function getPinEntityType(pin) {
  return planetStaticData.getPinEntityType(pin && pin.typeID);
}

function isStorageEntityType(entityType) {
  return entityType === "storage" || entityType === "spaceport" || entityType === "command";
}

function getTypeVolume(typeID) {
  const type = planetStaticData.getType(typeID);
  const volume = Number(type && type.volume);
  return Number.isFinite(volume) && volume > 0 ? volume : 0;
}

function getPinCapacity(pin) {
  if (!isStorageEntityType(getPinEntityType(pin))) {
    return 0;
  }

  const info = planetStaticData.getPITypeInfo(pin && pin.typeID);
  const capacity = Number(info && info.capacity);
  return Number.isFinite(capacity) && capacity >= 0 ? capacity : Infinity;
}

function getPinUsedVolume(pin) {
  const contents = normalizeContents(pin && pin.contents);
  return Object.entries(contents).reduce((total, [typeID, quantity]) => (
    total + (getTypeVolume(typeID) * quantity)
  ), 0);
}

function getPinFreeSpace(pin) {
  const capacity = getPinCapacity(pin);
  if (capacity === Infinity) {
    return Infinity;
  }
  return Math.max(0, capacity - getPinUsedVolume(pin));
}

function getPinCycleTime(pin) {
  const entityType = getPinEntityType(pin);
  if (entityType === "ecu") {
    return Math.max(0, normalizeInteger(pin && pin.cycleTime, 0));
  }
  if (entityType === "process") {
    const schematic = planetStaticData.getSchematicByID(pin && pin.schematicID);
    return schematic ? Math.max(1, schematic.cycleTime * SECOND_TICKS) : 0;
  }
  return 0;
}

function getContentsQuantity(pin, typeID) {
  const key = String(normalizeInteger(typeID, 0));
  return normalizeInteger(pin && pin.contents && pin.contents[key], 0);
}

function setContentsQuantity(pin, typeID, quantity) {
  if (!pin) {
    return;
  }
  const key = String(normalizeInteger(typeID, 0));
  const normalizedQuantity = normalizeInteger(quantity, 0);
  pin.contents = normalizeContents(pin.contents);
  if (normalizedQuantity > 0) {
    pin.contents[key] = normalizedQuantity;
  } else {
    delete pin.contents[key];
  }
}

function getProcessSchematic(pin) {
  if (getPinEntityType(pin) !== "process") {
    return null;
  }
  return planetStaticData.getSchematicByID(pin && pin.schematicID);
}

function getProcessDemand(pin, typeID) {
  const schematic = getProcessSchematic(pin);
  const normalizedTypeID = normalizeInteger(typeID, 0);
  return schematic
    ? schematic.inputs.find((entry) => entry.typeID === normalizedTypeID) || null
    : null;
}

function getProcessCycleTime(pin) {
  const schematic = getProcessSchematic(pin);
  return schematic ? Math.max(1, schematic.cycleTime * SECOND_TICKS) : 0;
}

function getAcceptableQuantity(pin, typeID, desiredQuantity) {
  const desired = normalizeInteger(desiredQuantity, 0);
  if (!pin || desired <= 0) {
    return 0;
  }

  const entityType = getPinEntityType(pin);
  if (entityType === "process") {
    const demand = getProcessDemand(pin, typeID);
    if (!demand) {
      return 0;
    }
    return Math.min(
      desired,
      Math.max(0, demand.quantity - getContentsQuantity(pin, typeID)),
    );
  }

  if (!isStorageEntityType(entityType)) {
    return 0;
  }

  const volume = getTypeVolume(typeID);
  if (volume <= 0) {
    return desired;
  }
  const freeSpace = getPinFreeSpace(pin);
  if (freeSpace === Infinity) {
    return desired;
  }
  return Math.min(desired, Math.max(0, Math.floor((freeSpace + 1e-9) / volume)));
}

function addCommodityToPin(pin, typeID, quantity) {
  const acceptedQuantity = getAcceptableQuantity(pin, typeID, quantity);
  if (acceptedQuantity <= 0) {
    return 0;
  }

  setContentsQuantity(
    pin,
    typeID,
    getContentsQuantity(pin, typeID) + acceptedQuantity,
  );
  return acceptedQuantity;
}

function removeCommodityFromPin(pin, typeID, quantity) {
  const removedQuantity = Math.min(
    getContentsQuantity(pin, typeID),
    Math.max(0, normalizeInteger(quantity, 0)),
  );
  if (removedQuantity <= 0) {
    return 0;
  }

  setContentsQuantity(
    pin,
    typeID,
    getContentsQuantity(pin, typeID) - removedQuantity,
  );
  return removedQuantity;
}

function hasEnoughProcessInputs(pin) {
  const schematic = getProcessSchematic(pin);
  return Boolean(
    schematic &&
    schematic.inputs.every((input) => getContentsQuantity(pin, input.typeID) >= input.quantity),
  );
}

function consumeProcessInputs(pin) {
  const schematic = getProcessSchematic(pin);
  if (!schematic) {
    return false;
  }
  if (!hasEnoughProcessInputs(pin)) {
    return false;
  }

  for (const input of schematic.inputs) {
    removeCommodityFromPin(pin, input.typeID, input.quantity);
  }
  return true;
}

function activateProcessPin(pin, runTime) {
  if (!pin || getPinEntityType(pin) !== "process" || pin.state === STATE_ACTIVE) {
    return false;
  }
  if (!consumeProcessInputs(pin)) {
    return false;
  }

  pin.state = STATE_ACTIVE;
  pin.hasReceivedInputs = true;
  pin.receivedInputsLastCycle = false;
  pin.lastRunTime = runTime.toString();
  return true;
}

function runProcessCycle(pin, runTime) {
  const schematic = getProcessSchematic(pin);
  if (!schematic || pin.state !== STATE_ACTIVE) {
    return {};
  }

  const products = {};
  for (const output of schematic.outputs) {
    products[String(output.typeID)] = (products[String(output.typeID)] || 0) + output.quantity;
  }

  pin.lastRunTime = runTime.toString();
  pin.receivedInputsLastCycle = pin.hasReceivedInputs === true;
  if (consumeProcessInputs(pin)) {
    pin.state = STATE_ACTIVE;
    pin.hasReceivedInputs = true;
  } else {
    pin.state = STATE_IDLE;
    pin.hasReceivedInputs = false;
  }
  return products;
}

function runEcuCycle(pin, runTime) {
  if (
    !pin ||
    getPinEntityType(pin) !== "ecu" ||
    pin.state !== STATE_ACTIVE ||
    !pin.programType ||
    normalizeInteger(pin.qtyPerCycle, 0) <= 0
  ) {
    return {};
  }

  const expiryTime = filetimeBigInt(pin.expiryTime, null);
  if (expiryTime !== null && runTime > expiryTime) {
    pin.state = STATE_IDLE;
    return {};
  }

  pin.lastRunTime = runTime.toString();
  if (expiryTime !== null && runTime >= expiryTime) {
    pin.state = STATE_IDLE;
  }

  return {
    [String(pin.programType)]: normalizeInteger(pin.qtyPerCycle, 0),
  };
}

function getRouteSourceID(route) {
  return Array.isArray(route && route.path) && route.path.length > 0
    ? normalizeInteger(route.path[0], 0)
    : 0;
}

function getRouteDestinationID(route) {
  return Array.isArray(route && route.path) && route.path.length > 0
    ? normalizeInteger(route.path[route.path.length - 1], 0)
    : 0;
}

function sortRoutesForOutput(colony, routes) {
  return [...routes].sort((left, right) => {
    const leftDestinationType = getPinEntityType(findPin(colony, getRouteDestinationID(left)));
    const rightDestinationType = getPinEntityType(findPin(colony, getRouteDestinationID(right)));
    const leftPriority = leftDestinationType === "process" ? 0 : 1;
    const rightPriority = rightDestinationType === "process" ? 0 : 1;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    return normalizeInteger(left.routeID, 0) - normalizeInteger(right.routeID, 0);
  });
}

function getSourceRoutes(colony, sourcePinID, commodityTypeID = 0) {
  const normalizedSourcePinID = normalizeInteger(sourcePinID, 0);
  const normalizedCommodityTypeID = normalizeInteger(commodityTypeID, 0);
  return sortRoutesForOutput(
    colony,
    (Array.isArray(colony.routes) ? colony.routes : []).filter((route) => (
      getRouteSourceID(route) === normalizedSourcePinID &&
      normalizeInteger(route.commodityQuantity, 0) > 0 &&
      (
        normalizedCommodityTypeID <= 0 ||
        normalizeInteger(route.commodityTypeID, 0) === normalizedCommodityTypeID
      )
    )),
  );
}

function getDestinationRoutes(colony, destinationPinID, commodityTypeID = 0) {
  const normalizedDestinationPinID = normalizeInteger(destinationPinID, 0);
  const normalizedCommodityTypeID = normalizeInteger(commodityTypeID, 0);
  return (Array.isArray(colony.routes) ? colony.routes : [])
    .filter((route) => (
      getRouteDestinationID(route) === normalizedDestinationPinID &&
      normalizeInteger(route.commodityQuantity, 0) > 0 &&
      (
        normalizedCommodityTypeID <= 0 ||
        normalizeInteger(route.commodityTypeID, 0) === normalizedCommodityTypeID
      )
    ))
    .sort((left, right) => normalizeInteger(left.routeID, 0) - normalizeInteger(right.routeID, 0));
}

function moveCommodityOverRoute(colony, route, sourcePin, typeID, maxQuantity, options = {}) {
  const destinationPin = findPin(colony, getRouteDestinationID(route));
  if (!destinationPin) {
    return { movedQuantity: 0, destinationPin: null };
  }

  const routeQuantity = normalizeInteger(route.commodityQuantity, 0);
  let quantity = Math.min(normalizeInteger(maxQuantity, 0), routeQuantity);
  if (options.consumeSource === true) {
    quantity = Math.min(quantity, getContentsQuantity(sourcePin, typeID));
  }
  if (quantity <= 0) {
    return { movedQuantity: 0, destinationPin };
  }

  const movedQuantity = addCommodityToPin(destinationPin, typeID, quantity);
  if (movedQuantity > 0 && options.consumeSource === true) {
    removeCommodityFromPin(sourcePin, typeID, movedQuantity);
  }
  return { movedQuantity, destinationPin };
}

function routeCommodityOutput(colony, sourcePin, commodities = {}, options = {}) {
  if (!sourcePin || !isPlainObject(commodities) || normalizeInteger(options.depth, 0) > 8) {
    return 0;
  }

  const sourceConsumes = options.consumeSource === true;
  let movedTotal = 0;
  for (const [typeIDKey, quantity] of Object.entries(normalizeContents(commodities))) {
    const typeID = normalizeInteger(typeIDKey, 0);
    let remainingQuantity = sourceConsumes
      ? Math.min(quantity, getContentsQuantity(sourcePin, typeID))
      : quantity;

    for (const route of getSourceRoutes(colony, sourcePin.pinID, typeID)) {
      if (remainingQuantity <= 0) {
        break;
      }

      const { movedQuantity, destinationPin } = moveCommodityOverRoute(
        colony,
        route,
        sourcePin,
        typeID,
        remainingQuantity,
        { consumeSource: sourceConsumes },
      );
      if (movedQuantity <= 0) {
        continue;
      }

      movedTotal += movedQuantity;
      remainingQuantity -= movedQuantity;

      if (
        destinationPin &&
        isStorageEntityType(getPinEntityType(destinationPin)) &&
        !isStorageEntityType(getPinEntityType(sourcePin))
      ) {
        routeCommodityOutput(
          colony,
          destinationPin,
          { [String(typeID)]: getContentsQuantity(destinationPin, typeID) },
          { consumeSource: true, depth: normalizeInteger(options.depth, 0) + 1 },
        );
      }
    }
  }
  return movedTotal;
}

function routeCommodityInput(colony, processPin) {
  const schematic = getProcessSchematic(processPin);
  if (!schematic) {
    return 0;
  }

  let movedTotal = 0;
  for (const input of schematic.inputs) {
    let missingQuantity = Math.max(
      0,
      input.quantity - getContentsQuantity(processPin, input.typeID),
    );
    if (missingQuantity <= 0) {
      continue;
    }

    for (const route of getDestinationRoutes(colony, processPin.pinID, input.typeID)) {
      if (missingQuantity <= 0) {
        break;
      }

      const sourcePin = findPin(colony, getRouteSourceID(route));
      if (!sourcePin || !isStorageEntityType(getPinEntityType(sourcePin))) {
        continue;
      }

      const { movedQuantity } = moveCommodityOverRoute(
        colony,
        route,
        sourcePin,
        input.typeID,
        missingQuantity,
        { consumeSource: true },
      );
      movedTotal += movedQuantity;
      missingQuantity -= movedQuantity;
    }
  }
  return movedTotal;
}

function primeReadyProcessors(colony, runTime) {
  let changed = false;
  for (const pin of Array.isArray(colony.pins) ? colony.pins : []) {
    if (getPinEntityType(pin) !== "process" || pin.state === STATE_ACTIVE) {
      continue;
    }

    if (routeCommodityInput(colony, pin) > 0) {
      changed = true;
    }
    if (activateProcessPin(pin, runTime)) {
      changed = true;
    }
  }
  return changed;
}

function getNextPinRunTime(pin, targetTime) {
  const entityType = getPinEntityType(pin);
  if (entityType === "ecu") {
    if (
      pin.state !== STATE_ACTIVE ||
      !pin.programType ||
      normalizeInteger(pin.cycleTime, 0) <= 0 ||
      normalizeInteger(pin.qtyPerCycle, 0) <= 0
    ) {
      return null;
    }

    const nextRunTime = filetimeBigInt(pin.lastRunTime, targetTime) +
      BigInt(normalizeInteger(pin.cycleTime, 0));
    const expiryTime = filetimeBigInt(pin.expiryTime, null);
    if (expiryTime !== null && nextRunTime > expiryTime) {
      return null;
    }
    return nextRunTime <= targetTime ? nextRunTime : null;
  }

  if (entityType === "process" && pin.state === STATE_ACTIVE) {
    const cycleTime = getProcessCycleTime(pin);
    if (cycleTime <= 0) {
      return null;
    }
    const nextRunTime = filetimeBigInt(pin.lastRunTime, targetTime) + BigInt(cycleTime);
    return nextRunTime <= targetTime ? nextRunTime : null;
  }

  return null;
}

function getNextSimulationEvent(colony, targetTime) {
  let nextEvent = null;
  for (const pin of Array.isArray(colony.pins) ? colony.pins : []) {
    const nextRunTime = getNextPinRunTime(pin, targetTime);
    if (nextRunTime === null) {
      continue;
    }
    if (
      !nextEvent ||
      nextRunTime < nextEvent.runTime ||
      (
        nextRunTime === nextEvent.runTime &&
        normalizeInteger(pin.pinID, 0) < normalizeInteger(nextEvent.pinID, 0)
      )
    ) {
      nextEvent = {
        pinID: normalizeInteger(pin.pinID, 0),
        runTime: nextRunTime,
      };
    }
  }
  return nextEvent;
}

function runColonySimulation(rawColony, targetFileTime = currentFileTimeString(), context = {}) {
  const colony = normalizeColony(rawColony, context);
  const targetTime = filetimeBigInt(targetFileTime, currentFileTime());
  let simulationTime = filetimeBigInt(colony.currentSimTime, targetTime);
  if (targetTime <= simulationTime) {
    return { colony, changed: false };
  }

  let changed = primeReadyProcessors(colony, simulationTime);
  let eventCount = 0;
  while (eventCount < MAX_SIMULATION_EVENTS) {
    const event = getNextSimulationEvent(colony, targetTime);
    if (!event) {
      break;
    }

    simulationTime = event.runTime;
    colony.currentSimTime = simulationTime.toString();
    const pin = findPin(colony, event.pinID);
    if (!pin) {
      break;
    }

    const entityType = getPinEntityType(pin);
    let products = {};
    if (entityType === "ecu") {
      products = runEcuCycle(pin, simulationTime);
    } else if (entityType === "process") {
      products = runProcessCycle(pin, simulationTime);
      routeCommodityInput(colony, pin);
      activateProcessPin(pin, simulationTime);
    }

    if (Object.keys(products).length > 0) {
      routeCommodityOutput(colony, pin, products);
    }
    primeReadyProcessors(colony, simulationTime);
    changed = true;
    eventCount += 1;
  }

  if (eventCount >= MAX_SIMULATION_EVENTS) {
    log.warn(
      `[PlanetRuntimeStore] PI simulation event cap reached planetID=${colony.planetID} ownerID=${colony.ownerID}`,
    );
  }

  const targetTimeString = targetTime.toString();
  if (colony.currentSimTime !== targetTimeString) {
    colony.currentSimTime = targetTimeString;
    changed = true;
  }
  if (changed) {
    colony.updatedAt = new Date().toISOString();
  }
  return {
    colony: normalizeColony(colony, context),
    changed,
  };
}

function sortEndpoints(endpoint1, endpoint2) {
  const left = normalizeInteger(endpoint1, 0);
  const right = normalizeInteger(endpoint2, 0);
  return left <= right ? [left, right] : [right, left];
}

function linkKey(endpoint1, endpoint2) {
  return sortEndpoints(endpoint1, endpoint2).join(":");
}

function getLinkByEndpoints(colony, endpoint1, endpoint2) {
  const key = linkKey(endpoint1, endpoint2);
  return (Array.isArray(colony.links) ? colony.links : [])
    .find((link) => linkKey(link.endpoint1, link.endpoint2) === key) || null;
}

function getPinDistanceMeters(pinA, pinB, planetRadius = 0) {
  const radius = Math.max(0, normalizeReal(planetRadius, 0));
  if (!pinA || !pinB || radius <= 0) {
    return 0;
  }
  return sphericalDistance(
    normalizeSurfacePoint(pinA.latitude, pinA.longitude),
    normalizeSurfacePoint(pinB.latitude, pinB.longitude),
  ) * radius;
}

function getLinkCpuUsage(link, colony, context = {}) {
  const params = planetStaticData.getUsageParametersForLinkType(link && link.typeID);
  const pinA = findPin(colony, link && link.endpoint1);
  const pinB = findPin(colony, link && link.endpoint2);
  const length = getPinDistanceMeters(pinA, pinB, context.planetRadius);
  const level = Math.max(0, normalizeInteger(link && link.level, 0));
  return params.baseCpuUsage +
    Math.ceil(params.cpuUsagePerKm * (length / 1000) * ((level + 1) ** params.cpuUsageLevelModifier));
}

function getLinkPowerUsage(link, colony, context = {}) {
  const params = planetStaticData.getUsageParametersForLinkType(link && link.typeID);
  const pinA = findPin(colony, link && link.endpoint1);
  const pinB = findPin(colony, link && link.endpoint2);
  const length = getPinDistanceMeters(pinA, pinB, context.planetRadius);
  const level = Math.max(0, normalizeInteger(link && link.level, 0));
  return params.basePowerUsage +
    Math.ceil(params.powerUsagePerKm * (length / 1000) * ((level + 1) ** params.powerUsageLevelModifier));
}

function getPinCpuPower(pin) {
  const typeUsage = planetStaticData.getCPUAndPowerForPinType(pin && pin.typeID);
  const entityType = getPinEntityType(pin);
  if (entityType !== "ecu") {
    return {
      cpuUsage: typeUsage.cpuUsage,
      powerUsage: typeUsage.powerUsage,
    };
  }

  const headCount = Array.isArray(pin.heads) ? pin.heads.length : 0;
  return {
    cpuUsage: typeUsage.cpuUsage +
      Math.max(0, planetStaticData.getTypeAttribute(
        pin.typeID,
        planetStaticData.ATTRIBUTE.EXTRACTOR_HEAD_CPU,
        0,
      )) * headCount,
    powerUsage: typeUsage.powerUsage +
      Math.max(0, planetStaticData.getTypeAttribute(
        pin.typeID,
        planetStaticData.ATTRIBUTE.EXTRACTOR_HEAD_POWER,
        0,
      )) * headCount,
  };
}

function getColonyCpuPowerStats(colony, context = {}) {
  const level = clamp(normalizeInteger(colony && colony.level, 0), 0, 5);
  const commandPin = (Array.isArray(colony.pins) ? colony.pins : [])
    .find((pin) => getPinEntityType(pin) === "command") || null;
  const commandInfo = planetStaticData.getCommandCenterInfo(level) || {};
  const stats = {
    hasCommandPin: Boolean(commandPin),
    cpuSupply: commandPin ? normalizeInteger(commandInfo.cpuOutput, 0) : 0,
    powerSupply: commandPin ? normalizeInteger(commandInfo.powerOutput, 0) : 0,
    cpuUsage: 0,
    powerUsage: 0,
  };

  for (const pin of Array.isArray(colony.pins) ? colony.pins : []) {
    const entityType = getPinEntityType(pin);
    if (entityType === "command") {
      continue;
    }
    const usage = getPinCpuPower(pin);
    stats.cpuUsage += usage.cpuUsage;
    stats.powerUsage += usage.powerUsage;
  }

  for (const link of Array.isArray(colony.links) ? colony.links : []) {
    stats.cpuUsage += getLinkCpuUsage(link, colony, context);
    stats.powerUsage += getLinkPowerUsage(link, colony, context);
  }

  stats.cpuUsage = Math.ceil(stats.cpuUsage);
  stats.powerUsage = Math.ceil(stats.powerUsage);
  return stats;
}

function getRouteCycleTime(colony, route) {
  const path = Array.isArray(route && route.path) ? route.path : [];
  const sourcePin = findPin(colony, path[0]);
  const destinationPin = findPin(colony, path[path.length - 1]);
  const sourceCycleTime = getPinCycleTime(sourcePin);
  const destinationCycleTime = getPinCycleTime(destinationPin);
  if (sourceCycleTime > 0 && getPinEntityType(sourcePin) !== "storage") {
    return sourceCycleTime;
  }
  if (destinationCycleTime > 0) {
    return destinationCycleTime;
  }
  return Math.max(sourceCycleTime, destinationCycleTime);
}

function getRouteBandwidthUsage(colony, route) {
  const typeID = normalizeInteger(route && route.commodityTypeID, 0);
  const quantity = normalizeInteger(route && route.commodityQuantity, 0);
  const volumePerCycle = getTypeVolume(typeID) * quantity;
  const cycleTime = getRouteCycleTime(colony, route);
  if (cycleTime > 0) {
    return volumePerCycle * (HOUR_TICKS / cycleTime);
  }
  return volumePerCycle;
}

function getLinkBandwidthCapacity(link) {
  const params = planetStaticData.getUsageParametersForLinkType(link && link.typeID);
  const level = Math.max(0, normalizeInteger(link && link.level, 0));
  return Math.max(0, Number(params.logisticalCapacity) || 0) * (2 ** level);
}

function getCommodityTotalVolume(commodities = {}) {
  return Object.entries(normalizeContents(commodities)).reduce(
    (total, [typeID, quantity]) => total + (getTypeVolume(typeID) * quantity),
    0,
  );
}

function getExpeditedTransferTimeTicks(linkBandwidth, commodities = {}) {
  const bandwidth = Math.max(0, Number(linkBandwidth) || 0);
  if (!(bandwidth > 0)) {
    return EXPEDITED_TRANSFER_MINIMUM_TICKS;
  }
  const commodityVolume = getCommodityTotalVolume(commodities);
  return Math.ceil(Math.max(
    EXPEDITED_TRANSFER_MINIMUM_TICKS,
    (commodityVolume / bandwidth) * HOUR_TICKS,
  ));
}

function normalizeTransferPath(path = []) {
  const unwrappedPath = unwrapMarshalValue(path);
  return (Array.isArray(unwrappedPath) ? unwrappedPath : [])
    .map((pinID) => normalizeInteger(unwrapMarshalValue(pinID), 0))
    .filter((pinID) => pinID > 0);
}

function getMinimumLinkBandwidthForPath(colony, path = []) {
  let minBandwidth = null;
  for (let index = 0; index < path.length - 1; index += 1) {
    const link = getLinkByEndpoints(colony, path[index], path[index + 1]);
    if (!link) {
      throw new Error("RouteFailedValidationLinkDoesNotExist");
    }
    const bandwidth = getLinkBandwidthCapacity(link);
    if (minBandwidth === null || bandwidth < minBandwidth) {
      minBandwidth = bandwidth;
    }
  }
  if (minBandwidth === null || minBandwidth < 0) {
    throw new Error("RouteFailedValidationNoBandwidthAvailable");
  }
  return minBandwidth;
}

function validateColonyRoutesAndLinks(colony) {
  for (const link of Array.isArray(colony.links) ? colony.links : []) {
    if (normalizeInteger(link.level, 0) > LINK_MAX_UPGRADE) {
      throw new Error("CannotUpgradeLinkTooHigh");
    }
    ensurePinsExist(colony, [link.endpoint1, link.endpoint2]);
  }

  const bandwidthByLinkKey = new Map();
  for (const route of Array.isArray(colony.routes) ? colony.routes : []) {
    const path = Array.isArray(route.path) ? route.path : [];
    if (path.length < 2) {
      throw new Error("CreateRouteTooShort");
    }
    if (path.length - 2 > MAX_ROUTE_WAYPOINTS) {
      throw new Error("CannotRouteTooManyWaypoints");
    }
    ensurePinsExist(colony, path);

    const bandwidthUsage = getRouteBandwidthUsage(colony, route);
    for (let index = 0; index < path.length - 1; index += 1) {
      const previousPinID = path[index];
      const nextPinID = path[index + 1];
      const link = getLinkByEndpoints(colony, previousPinID, nextPinID);
      if (!link) {
        throw new Error("RouteFailedValidationLinkDoesNotExist");
      }
      const key = linkKey(previousPinID, nextPinID);
      bandwidthByLinkKey.set(
        key,
        (bandwidthByLinkKey.get(key) || 0) + bandwidthUsage,
      );
    }
  }

  for (const [key, bandwidthUsage] of bandwidthByLinkKey.entries()) {
    const link = (Array.isArray(colony.links) ? colony.links : [])
      .find((candidate) => linkKey(candidate.endpoint1, candidate.endpoint2) === key);
    if (link && bandwidthUsage > getLinkBandwidthCapacity(link) + 1e-9) {
      throw new Error("RouteFailedValidationCannotRouteCommodities");
    }
  }
}

function validateColonyCpuPower(colony, context = {}) {
  const stats = getColonyCpuPowerStats(colony, context);
  if (!stats.hasCommandPin) {
    return stats;
  }
  if (stats.cpuUsage > stats.cpuSupply) {
    throw new Error("CannotAddToColonyCPUUsageExceeded");
  }
  if (stats.powerUsage > stats.powerSupply) {
    throw new Error("CannotAddToColonyPowerUsageExceeded");
  }
  return stats;
}

function validateColonyNetwork(colony, context = {}) {
  validateColonyRoutesAndLinks(colony);
  return validateColonyCpuPower(colony, context);
}

function removeRoutesTouchingPin(colony, pinID) {
  const normalizedPinID = normalizeInteger(pinID, 0);
  colony.routes = (Array.isArray(colony.routes) ? colony.routes : [])
    .filter((route) => !(Array.isArray(route.path) && route.path.includes(normalizedPinID)));
}

function routeUsesLink(route, endpoint1, endpoint2) {
  const targetKey = linkKey(endpoint1, endpoint2);
  const path = Array.isArray(route && route.path) ? route.path : [];
  for (let index = 0; index < path.length - 1; index += 1) {
    if (linkKey(path[index], path[index + 1]) === targetKey) {
      return true;
    }
  }
  return false;
}

function removeRoutesTouchingLink(colony, endpoint1, endpoint2) {
  colony.routes = (Array.isArray(colony.routes) ? colony.routes : [])
    .filter((route) => !routeUsesLink(route, endpoint1, endpoint2));
}

function setExtractorHead(pin, headID, latitude, longitude) {
  if (!pin) {
    return;
  }
  const normalizedHeadID = normalizeInteger(headID, 0);
  pin.heads = (Array.isArray(pin.heads) ? pin.heads : [])
    .filter((head) => normalizeInteger(head && head[0], 0) !== normalizedHeadID);
  pin.heads.push([
    normalizedHeadID,
    normalizeReal(latitude, pin.latitude),
    normalizeReal(longitude, pin.longitude),
  ]);
  pin.heads.sort((left, right) => left[0] - right[0]);
}

function removeExtractorHead(pin, headID) {
  if (!pin) {
    return;
  }
  const normalizedHeadID = normalizeInteger(headID, 0);
  pin.heads = (Array.isArray(pin.heads) ? pin.heads : [])
    .filter((head) => normalizeInteger(head && head[0], 0) !== normalizedHeadID);
}

function getProgramLengthFromHeadRadius(headRadius) {
  return (
    (clamp(headRadius, RADIUS_DRILL_AREA_MIN, RADIUS_DRILL_AREA_MAX) - RADIUS_DRILL_AREA_MIN) /
    RADIUS_DRILL_AREA_DIFF *
    335 +
    1
  );
}

function getCycleTimeFromProgramLength(programLength) {
  return 0.25 * 2 ** Math.max(0, Math.floor(Math.log2(programLength / 25.0)) + 1);
}

function normalizeHeads(heads = []) {
  return (Array.isArray(heads) ? heads : [])
    .map((head) => (Array.isArray(head) ? head : []))
    .map((head) => [
      normalizeInteger(head[0], 0),
      normalizeReal(head[1], 0),
      normalizeReal(head[2], 0),
    ]);
}

function getEcuAttribute(ecuTypeID, attributeID, fallback) {
  const normalizedTypeID = normalizeInteger(ecuTypeID, DEFAULT_ECU_TYPE_ID);
  const value = planetStaticData.getTypeAttribute(normalizedTypeID, attributeID, fallback);
  return Number.isFinite(value) ? value : fallback;
}

function getEcuMaxVolume(ecuTypeID) {
  return Math.max(
    1,
    getEcuAttribute(
      ecuTypeID,
      planetStaticData.ATTRIBUTE.PIN_EXTRACTION_QUANTITY,
      1000,
    ),
  );
}

function getCircleOverlapRatio(distance, radius) {
  const safeRadius = Math.max(0.0001, radius);
  if (distance >= safeRadius * 2) {
    return 0;
  }
  if (distance <= 0) {
    return 1;
  }

  const radiusSquared = safeRadius ** 2;
  const overlapArea = (
    2 * radiusSquared * Math.acos(0.5 * (distance / safeRadius)) -
    0.5 * distance * Math.sqrt(Math.max(0, (4 * radiusSquared) - (distance ** 2)))
  );
  return clamp(overlapArea / (Math.PI * radiusSquared), 0, 1);
}

function getOwnHeadModifiers(heads, headRadius, overlapFactor) {
  const modifiers = new Map(heads.map((head) => [normalizeInteger(head[0], 0), 1]));
  for (let leftIndex = 0; leftIndex < heads.length; leftIndex += 1) {
    const left = heads[leftIndex];
    const leftPoint = normalizeSurfacePoint(left[1], left[2]);
    for (let rightIndex = leftIndex + 1; rightIndex < heads.length; rightIndex += 1) {
      const right = heads[rightIndex];
      const rightPoint = normalizeSurfacePoint(right[1], right[2]);
      const distance = sphericalDistance(leftPoint, rightPoint);
      const overlap = getCircleOverlapRatio(distance, headRadius);
      if (overlap <= 0) {
        continue;
      }

      const modifier = clamp(1 - (overlap * overlapFactor), 0, 1);
      const leftID = normalizeInteger(left[0], 0);
      const rightID = normalizeInteger(right[0], 0);
      modifiers.set(leftID, (modifiers.get(leftID) || 1) * modifier);
      modifiers.set(rightID, (modifiers.get(rightID) || 1) * modifier);
    }
  }
  return modifiers;
}

function getFallbackResourceValue(planetID, resourceTypeID, head, quality) {
  const qualityValue = clamp(quality / MAX_DISPLAY_QUALITY, 0.08, 1);
  const noise = hashRatio([
    planetID,
    resourceTypeID,
    head[0],
    head[1],
    head[2],
    "fallback-resource-head",
  ]);
  return clamp((qualityValue * 0.72) + (noise * 0.22), 0, PLANET_RESOURCE_MAX_VALUE);
}

function estimateProgramResult({
  planetID = 0,
  resourceTypeID = 0,
  heads = [],
  headRadius = RADIUS_DRILL_AREA_MIN,
  ecuTypeID = DEFAULT_ECU_TYPE_ID,
  state = null,
} = {}) {
  const normalizedPlanetID = normalizeInteger(planetID, 0);
  const normalizedResourceTypeID = normalizeInteger(resourceTypeID, 0);
  if (normalizedResourceTypeID <= 0) {
    return {
      qtyToDistribute: 0,
      cycleTime: 0,
      numCycles: 0,
    };
  }

  const normalizedHeads = normalizeHeads(heads);
  const clampedRadius = clamp(
    normalizeReal(headRadius, RADIUS_DRILL_AREA_MIN),
    RADIUS_DRILL_AREA_MIN,
    RADIUS_DRILL_AREA_MAX,
  );
  const programLength = getProgramLengthFromHeadRadius(clampedRadius);
  const cycleTimeHours = getCycleTimeFromProgramLength(programLength);
  const cycleTime = Math.max(1, Math.trunc(cycleTimeHours * HOUR_TICKS));
  const numCycles = Math.max(1, Math.trunc(programLength / cycleTimeHours));

  const sourceState = state || readState({ repair: true });
  const resourceRecord = sourceState.resourcesByPlanetID[String(normalizedPlanetID)] || {};
  const layer = getResourceLayerFromRecord(resourceRecord, normalizedResourceTypeID);
  const quality = normalizeInteger(
    resourceRecord.qualitiesByTypeID &&
      resourceRecord.qualitiesByTypeID[String(normalizedResourceTypeID)],
    65,
  );
  const overlapFactor = clamp(
    getEcuAttribute(ecuTypeID, planetStaticData.ATTRIBUTE.ECU_OVERLAP_FACTOR, 0.5),
    0,
    1,
  );
  const maxVolume = getEcuMaxVolume(ecuTypeID);
  const headModifiers = getOwnHeadModifiers(normalizedHeads, clampedRadius, overlapFactor);
  const summedHeadValue = normalizedHeads.reduce((total, head) => {
    const resourceValue = layer
      ? evaluateResourceLayerValue(layer, head[1], head[2])
      : getFallbackResourceValue(
        normalizedPlanetID,
        normalizedResourceTypeID,
        head,
        quality,
      );
    const modifier = headModifiers.get(normalizeInteger(head[0], 0)) || 1;
    return total + (resourceValue * modifier);
  }, 0);
  const qtyToDistribute = Math.max(1, Math.trunc(maxVolume * summedHeadValue));

  return {
    qtyToDistribute,
    cycleTime,
    numCycles,
  };
}

function recordResourceDepletionEvent({
  state,
  planetID,
  resourceTypeID,
  heads = [],
  headRadius = RADIUS_DRILL_AREA_MIN,
  ecuTypeID = DEFAULT_ECU_TYPE_ID,
  result = {},
  installTime = null,
  expiryTime = null,
} = {}) {
  if (!state || !isPlainObject(state.resourcesByPlanetID)) {
    return;
  }

  const resourceRecord = state.resourcesByPlanetID[String(normalizeInteger(planetID, 0))];
  if (!isPlainObject(resourceRecord) || !isPlainObject(resourceRecord.layersByTypeID)) {
    return;
  }

  const layerKey = String(normalizeInteger(resourceTypeID, 0));
  const layer = resourceRecord.layersByTypeID[layerKey];
  if (!isPlainObject(layer)) {
    return;
  }

  const normalizedHeads = normalizeHeads(heads);
  if (normalizedHeads.length < 1) {
    return;
  }

  const normalizedHeadRadius = clamp(
    normalizeReal(headRadius, RADIUS_DRILL_AREA_MIN),
    RADIUS_DRILL_AREA_MIN,
    RADIUS_DRILL_AREA_MAX,
  );
  const depletionRange = Math.max(
    1,
    getEcuAttribute(
      ecuTypeID,
      planetStaticData.ATTRIBUTE.EXTRACTOR_DEPLETION_RANGE,
      5,
    ),
  );
  const depletionRate = Math.max(
    0.1,
    getEcuAttribute(
      ecuTypeID,
      planetStaticData.ATTRIBUTE.EXTRACTOR_DEPLETION_RATE,
      1,
    ),
  );
  const maxVolume = getEcuMaxVolume(ecuTypeID);
  const pressurePerHead = normalizeInteger(result.qtyToDistribute, 0) /
    Math.max(1, maxVolume * normalizedHeads.length);
  const strength = clamp(pressurePerHead * 0.16 * depletionRate, 0.01, 0.2);
  const depletionRadius = clamp(
    normalizedHeadRadius * depletionRange,
    normalizedHeadRadius,
    0.45,
  );

  layer.depletionEvents = pruneDepletionEvents(layer.depletionEvents);
  layer.depletionEvents.push({
    installTime: installTime ? String(installTime) : currentFileTimeString(),
    expiryTime: expiryTime ? String(expiryTime) : currentFileTimeString(),
    headRadius: normalizedHeadRadius,
    depletionRadius,
    strength: Number(strength.toFixed(6)),
    heads: normalizedHeads,
  });
  layer.depletionEvents = pruneDepletionEvents(layer.depletionEvents);
  resourceRecord.updatedAt = new Date().toISOString();
}

function installECUProgram(pin, programTypeID, headRadius, context = {}) {
  const normalizedProgramTypeID = normalizeNullableInteger(programTypeID);
  if (!normalizedProgramTypeID) {
    pin.cycleTime = 0;
    pin.programType = null;
    pin.qtyPerCycle = 0;
    pin.expiryTime = null;
    pin.installTime = null;
    pin.headRadius = normalizeReal(headRadius, pin.headRadius || RADIUS_DRILL_AREA_MIN);
    pin.state = STATE_IDLE;
    return;
  }

  const result = estimateProgramResult({
    planetID: context.planetID,
    resourceTypeID: normalizedProgramTypeID,
    heads: pin.heads,
    headRadius,
    ecuTypeID: pin.typeID,
    state: context.state,
  });
  const installTime = currentFileTimeString();
  const expiryTime = (
    BigInt(installTime) +
    BigInt(result.cycleTime) * BigInt(result.numCycles)
  ).toString();

  pin.cycleTime = result.cycleTime;
  pin.programType = normalizedProgramTypeID;
  pin.qtyPerCycle = result.qtyToDistribute;
  pin.expiryTime = expiryTime;
  pin.installTime = installTime;
  pin.lastRunTime = installTime;
  pin.headRadius = clamp(
    normalizeReal(headRadius, RADIUS_DRILL_AREA_MIN),
    RADIUS_DRILL_AREA_MIN,
    RADIUS_DRILL_AREA_MAX,
  );
  pin.state = STATE_ACTIVE;

  recordResourceDepletionEvent({
    state: context.state,
    planetID: context.planetID,
    resourceTypeID: normalizedProgramTypeID,
    heads: pin.heads,
    headRadius: pin.headRadius,
    ecuTypeID: pin.typeID,
    result,
    installTime,
    expiryTime,
  });
}

function normalizeCommandStream(serializedChanges = []) {
  const stream = unwrapMarshalValue(serializedChanges);
  if (!Array.isArray(stream)) {
    return [];
  }

  return stream
    .map((entry) => {
      const unwrappedEntry = unwrapMarshalValue(entry);
      if (Array.isArray(unwrappedEntry)) {
        const args = Array.isArray(unwrappedEntry[1])
          ? unwrappedEntry[1]
          : [unwrappedEntry[1]].filter((value) => value !== undefined);
        return {
          id: normalizeInteger(unwrappedEntry[0], 0),
          args,
        };
      }

      if (isPlainObject(unwrappedEntry)) {
        const args = Array.isArray(unwrappedEntry.args)
          ? unwrappedEntry.args
          : Array.isArray(unwrappedEntry.argTuple)
            ? unwrappedEntry.argTuple
            : [];
        return {
          id: normalizeInteger(unwrappedEntry.id ?? unwrappedEntry.commandID, 0),
          args,
        };
      }

      return null;
    })
    .filter((entry) => entry && entry.id > 0);
}

function ensurePinsExist(colony, pinIDs = []) {
  for (const pinID of pinIDs) {
    if (!findPin(colony, pinID)) {
      throw new Error(`Invalid PI command references missing pin ${pinID}`);
    }
  }
}

function upsertLink(colony, endpoint1, endpoint2, level) {
  const endpoints = sortEndpoints(endpoint1, endpoint2);
  if (endpoints[0] <= 0 || endpoints[1] <= 0 || endpoints[0] === endpoints[1]) {
    return;
  }
  ensurePinsExist(colony, endpoints);
  const key = linkKey(endpoints[0], endpoints[1]);
  colony.links = (Array.isArray(colony.links) ? colony.links : [])
    .filter((link) => linkKey(link.endpoint1, link.endpoint2) !== key);
  colony.links.push({
    typeID: LINK_TYPE_ID,
    endpoint1: endpoints[0],
    endpoint2: endpoints[1],
    level: Math.max(0, normalizeInteger(level, 0)),
  });
  colony.links.sort((left, right) => (
    left.endpoint1 === right.endpoint1
      ? left.endpoint2 - right.endpoint2
      : left.endpoint1 - right.endpoint1
  ));
}

function applyUserUpdateNetwork({
  planetID,
  ownerID,
  solarSystemID = 0,
  planetTypeID = 0,
  planetRadius = 0,
  serializedChanges = [],
  commands = null,
  editHash = null,
  constructionCost = 0,
  dryRun = false,
} = {}) {
  const normalizedPlanetID = normalizeInteger(planetID, 0);
  const normalizedOwnerID = normalizeInteger(ownerID, 0);
  if (normalizedPlanetID <= 0 || normalizedOwnerID <= 0) {
    throw new Error("Cannot update PI network without a planet and owner");
  }

  const commandStream = normalizeCommandStream(commands || serializedChanges);
  const persistedState = readState({ repair: true });
  const state = dryRun ? cloneJson(persistedState) : persistedState;
  const key = colonyKey(normalizedPlanetID, normalizedOwnerID);
  if (!dryRun && editHash) {
    const acceptedBucket = getAcceptedNetworkEditBucket(state, key);
    if (acceptedBucket && acceptedBucket[String(editHash)] && state.coloniesByKey[key]) {
      return normalizeColony(state.coloniesByKey[key], {
        planetID: normalizedPlanetID,
        ownerID: normalizedOwnerID,
        solarSystemID,
        planetTypeID,
        planetRadius,
      });
    }
  }
  const simulationResult = runColonySimulation(state.coloniesByKey[key], currentFileTimeString(), {
    planetID: normalizedPlanetID,
    ownerID: normalizedOwnerID,
    solarSystemID,
    planetTypeID,
    planetRadius,
  });
  const colony = simulationResult.colony;
  colony.planetRadius = normalizeReal(planetRadius, normalizeReal(colony.planetRadius, 0));
  const idMap = new Map();
  const usedPinIDs = collectUsedIDs(state, "pinID");
  const usedRouteIDs = collectUsedIDs(state, "routeID");

  for (const command of commandStream) {
    const args = Array.isArray(command.args) ? command.args : [];

    switch (command.id) {
      case COMMAND.CREATEPIN: {
        const submittedPinID = args[0];
        const typeID = normalizeInteger(args[1], 0);
        const pinID = isTemporaryID(submittedPinID, 1)
          ? allocateNextID(state, "pinID", usedPinIDs)
          : normalizeInteger(submittedPinID, 0);
        if (pinID <= 0) {
          throw new Error("CREATEPIN requires a valid pin ID");
        }
        const submittedKey = temporaryIDKey(submittedPinID);
        if (submittedKey) {
          idMap.set(submittedKey, pinID);
        }

        const entityType = planetStaticData.getPinEntityType(typeID);
        if (entityType === "command") {
          const existingCommandPin = colony.pins.find((pin) => (
            normalizeInteger(pin.pinID, 0) !== pinID &&
            planetStaticData.getPinEntityType(pin.typeID) === "command"
          ));
          if (existingCommandPin) {
            throw new Error("Cannot build multiple PI command centers on one planet");
          }
        }

        colony.pins = colony.pins.filter((pin) => normalizeInteger(pin.pinID, 0) !== pinID);
        colony.pins.push(buildPin(
          pinID,
          typeID,
          normalizedOwnerID,
          normalizeReal(args[2], 0),
          normalizeReal(args[3], 0),
        ));
        colony.pins.sort((left, right) => normalizeInteger(left.pinID, 0) - normalizeInteger(right.pinID, 0));
        break;
      }

      case COMMAND.REMOVEPIN: {
        const pinID = resolveSubmittedID(args[0], idMap);
        colony.pins = colony.pins.filter((pin) => normalizeInteger(pin.pinID, 0) !== pinID);
        colony.links = colony.links.filter((link) => (
          normalizeInteger(link.endpoint1, 0) !== pinID &&
          normalizeInteger(link.endpoint2, 0) !== pinID
        ));
        removeRoutesTouchingPin(colony, pinID);
        break;
      }

      case COMMAND.CREATELINK: {
        upsertLink(
          colony,
          resolveSubmittedID(args[0], idMap),
          resolveSubmittedID(args[1], idMap),
          args[2],
        );
        break;
      }

      case COMMAND.REMOVELINK: {
        const endpoints = sortEndpoints(
          resolveSubmittedID(args[0], idMap),
          resolveSubmittedID(args[1], idMap),
        );
        const keyToRemove = linkKey(endpoints[0], endpoints[1]);
        colony.links = colony.links.filter((link) => linkKey(link.endpoint1, link.endpoint2) !== keyToRemove);
        removeRoutesTouchingLink(colony, endpoints[0], endpoints[1]);
        break;
      }

      case COMMAND.SETLINKLEVEL: {
        upsertLink(
          colony,
          resolveSubmittedID(args[0], idMap),
          resolveSubmittedID(args[1], idMap),
          args[2],
        );
        break;
      }

      case COMMAND.CREATEROUTE: {
        const submittedRouteID = args[0];
        const routeID = isTemporaryID(submittedRouteID, 2)
          ? allocateNextID(state, "routeID", usedRouteIDs)
          : normalizeInteger(submittedRouteID, 0);
        if (routeID <= 0) {
          throw new Error("CREATEROUTE requires a valid route ID");
        }
        const submittedKey = temporaryIDKey(submittedRouteID);
        if (submittedKey) {
          idMap.set(submittedKey, routeID);
        }

        const path = (Array.isArray(args[1]) ? args[1] : [])
          .map((pinID) => resolveSubmittedID(pinID, idMap))
          .filter((pinID) => pinID > 0);
        ensurePinsExist(colony, path);
        colony.routes = colony.routes.filter((route) => normalizeInteger(route.routeID, 0) !== routeID);
        colony.routes.push({
          routeID,
          charID: normalizedOwnerID,
          path,
          commodityTypeID: normalizeInteger(args[2], 0),
          commodityQuantity: normalizeInteger(args[3], 0),
        });
        colony.routes.sort((left, right) => normalizeInteger(left.routeID, 0) - normalizeInteger(right.routeID, 0));
        break;
      }

      case COMMAND.REMOVEROUTE: {
        const routeID = resolveSubmittedID(args[0], idMap);
        colony.routes = colony.routes.filter((route) => normalizeInteger(route.routeID, 0) !== routeID);
        break;
      }

      case COMMAND.SETSCHEMATIC: {
        const pin = findPin(colony, resolveSubmittedID(args[0], idMap));
        if (pin) {
          pin.schematicID = normalizeNullableInteger(args[1]);
          pin.hasReceivedInputs = false;
          pin.receivedInputsLastCycle = false;
        }
        break;
      }

      case COMMAND.UPGRADECOMMANDCENTER: {
        const pin = findPin(colony, resolveSubmittedID(args[0], idMap));
        const level = clamp(normalizeInteger(args[1], 0), 0, 5);
        if (!pin || planetStaticData.getPinEntityType(pin.typeID) === "command") {
          colony.level = level;
          colony.commandCenterLevel = level;
        }
        break;
      }

      case COMMAND.ADDEXTRACTORHEAD: {
        setExtractorHead(
          findPin(colony, resolveSubmittedID(args[0], idMap)),
          args[1],
          args[2],
          args[3],
        );
        break;
      }

      case COMMAND.KILLEXTRACTORHEAD: {
        removeExtractorHead(
          findPin(colony, resolveSubmittedID(args[0], idMap)),
          args[1],
        );
        break;
      }

      case COMMAND.MOVEEXTRACTORHEAD: {
        setExtractorHead(
          findPin(colony, resolveSubmittedID(args[0], idMap)),
          args[1],
          args[2],
          args[3],
        );
        break;
      }

      case COMMAND.INSTALLPROGRAM: {
        const pin = findPin(colony, resolveSubmittedID(args[0], idMap));
        if (pin) {
          installECUProgram(pin, args[1], args[2], {
            planetID: normalizedPlanetID,
            state,
          });
        }
        break;
      }

      default:
        log.warn(`[PlanetRuntimeStore] Ignoring unsupported PI command ${command.id}`);
        break;
    }
  }

  colony.currentSimTime = currentFileTimeString();
  colony.updatedAt = new Date().toISOString();
  validateColonyNetwork(colony, { planetRadius });
  state.coloniesByKey[key] = normalizeColony(colony, {
    planetID: normalizedPlanetID,
    ownerID: normalizedOwnerID,
    solarSystemID,
    planetTypeID,
    planetRadius,
  });
  if (dryRun) {
    return state.coloniesByKey[key];
  }
  markAcceptedNetworkEdit(state, key, editHash, { constructionCost });
  writeState(state);
  return state.coloniesByKey[key];
}

function previewUserUpdateNetwork(options = {}) {
  return applyUserUpdateNetwork({
    ...options,
    dryRun: true,
  });
}

function prepareLaunchCommodities({
  planetID,
  ownerID,
  solarSystemID = 0,
  planetTypeID = 0,
  commandPinID,
  commodities = {},
  planetMeta = {},
} = {}) {
  const normalizedPlanetID = normalizeInteger(planetID, 0);
  const normalizedOwnerID = normalizeInteger(ownerID, 0);
  const normalizedCommandPinID = normalizeInteger(commandPinID, 0);
  if (normalizedPlanetID <= 0 || normalizedOwnerID <= 0 || normalizedCommandPinID <= 0) {
    return { success: false, errorMsg: "CannotLaunchWithoutColony" };
  }

  const commoditiesToLaunch = normalizeContents(commodities);
  if (Object.keys(commoditiesToLaunch).length < 1) {
    return { success: false, errorMsg: "PleaseSelectCommoditiesToLaunch" };
  }

  const state = readState({ repair: true });
  const key = colonyKey(normalizedPlanetID, normalizedOwnerID);
  if (!state.coloniesByKey[key]) {
    return { success: false, errorMsg: "CannotLaunchWithoutColony" };
  }

  const launchTime = currentFileTimeString();
  const simulationResult = runColonySimulation(state.coloniesByKey[key], launchTime, {
    planetID: normalizedPlanetID,
    ownerID: normalizedOwnerID,
    solarSystemID,
    planetTypeID,
  });
  const colony = simulationResult.colony;
  const commandPin = findPin(colony, normalizedCommandPinID);
  if (!commandPin || getPinEntityType(commandPin) !== "command") {
    return { success: false, errorMsg: "CanOnlyLaunchFromCommandCenters" };
  }

  const lastLaunchTime = filetimeBigInt(commandPin.lastLaunchTime, 0n);
  const currentLaunchTime = filetimeBigInt(launchTime, currentFileTime());
  if (lastLaunchTime > 0n && lastLaunchTime + COMMAND_CENTER_LAUNCH_CYCLE_TICKS > currentLaunchTime) {
    return { success: false, errorMsg: "CannotLaunchCommandPinNotReady" };
  }

  for (const [typeID, quantity] of Object.entries(commoditiesToLaunch)) {
    if (getContentsQuantity(commandPin, typeID) < quantity) {
      return { success: false, errorMsg: "CannotLaunchCommoditiesNotFound" };
    }
  }

  return {
    success: true,
    state,
    key,
    colony,
    commandPin,
    launchTime,
    commoditiesToLaunch,
  };
}

function previewLaunchCommodities(options = {}) {
  const result = prepareLaunchCommodities(options);
  if (!result.success) {
    return result;
  }
  return {
    success: true,
    commandPin: { ...result.commandPin },
    commoditiesToLaunch: { ...result.commoditiesToLaunch },
    launchTime: result.launchTime,
  };
}

function launchCommodities(options = {}) {
  const {
    planetID,
    ownerID,
    solarSystemID = 0,
    planetTypeID = 0,
    commandPinID,
    planetMeta = {},
  } = options;
  const normalizedPlanetID = normalizeInteger(planetID, 0);
  const normalizedOwnerID = normalizeInteger(ownerID, 0);
  const normalizedCommandPinID = normalizeInteger(commandPinID, 0);
  const result = prepareLaunchCommodities(options);
  if (!result.success) {
    return result;
  }

  const {
    state,
    key,
    colony,
    commandPin,
    launchTime,
    commoditiesToLaunch,
  } = result;

  for (const [typeID, quantity] of Object.entries(commoditiesToLaunch)) {
    removeCommodityFromPin(commandPin, typeID, quantity);
  }
  commandPin.lastLaunchTime = launchTime;

  const launchID = allocateNextID(state, "launchID", collectUsedIDs(state, "launchID"));
  const coordinates = buildLaunchCoordinates({
    ...planetMeta,
    planetID: normalizedPlanetID,
    ownerID: normalizedOwnerID,
    solarSystemID,
    planetTypeID,
  }, launchID);
  const launch = normalizeLaunchRecord({
    launchID,
    itemID: launchID,
    ownerID: normalizedOwnerID,
    planetID: normalizedPlanetID,
    solarSystemID: normalizeInteger(solarSystemID, 0),
    commandPinID: normalizedCommandPinID,
    launchTime,
    x: coordinates.x,
    y: coordinates.y,
    z: coordinates.z,
    contents: commoditiesToLaunch,
    deleted: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  state.launchesByID[String(launchID)] = launch;
  state.coloniesByKey[key] = normalizeColony(colony, {
    planetID: normalizedPlanetID,
    ownerID: normalizedOwnerID,
    solarSystemID,
    planetTypeID,
  });
  writeState(state);

  return {
    success: true,
    lastLaunchTime: launchTime,
    launch,
  };
}

function abandonColony(planetID, ownerID) {
  const normalizedPlanetID = normalizeInteger(planetID, 0);
  const normalizedOwnerID = normalizeInteger(ownerID, 0);
  if (normalizedPlanetID <= 0 || normalizedOwnerID <= 0) {
    return false;
  }

  const state = readState({ repair: true });
  delete state.coloniesByKey[colonyKey(normalizedPlanetID, normalizedOwnerID)];
  writeState(state);
  return true;
}

function getColony(planetID, ownerID) {
  const normalizedPlanetID = normalizeInteger(planetID, 0);
  const normalizedOwnerID = normalizeInteger(ownerID, 0);
  if (normalizedPlanetID <= 0 || normalizedOwnerID <= 0) {
    return null;
  }

  const state = readState({ repair: true });
  const key = colonyKey(normalizedPlanetID, normalizedOwnerID);
  const colony = state.coloniesByKey[key];
  if (!colony) {
    return null;
  }

  const simulationResult = runColonySimulation(colony, currentFileTimeString(), {
    planetID: normalizedPlanetID,
    ownerID: normalizedOwnerID,
  });
  if (simulationResult.changed) {
    state.coloniesByKey[key] = simulationResult.colony;
    writeState(state);
  }
  return simulationResult.colony;
}

function listColoniesForCharacter(ownerID) {
  const normalizedOwnerID = normalizeInteger(ownerID, 0);
  if (normalizedOwnerID <= 0) {
    return [];
  }

  const state = readState({ repair: true });
  const colonies = [];
  let changed = false;
  for (const [key, rawColony] of Object.entries(state.coloniesByKey)) {
    if (normalizeInteger(rawColony && rawColony.ownerID, 0) !== normalizedOwnerID) {
      continue;
    }

    const simulationResult = runColonySimulation(rawColony, currentFileTimeString(), {
      planetID: rawColony && rawColony.planetID,
      ownerID: normalizedOwnerID,
    });
    if (simulationResult.changed) {
      state.coloniesByKey[key] = simulationResult.colony;
      changed = true;
    }
    colonies.push(simulationResult.colony);
  }
  if (changed) {
    writeState(state);
  }
  return colonies;
}

function listColoniesForPlanet(planetID) {
  const normalizedPlanetID = normalizeInteger(planetID, 0);
  if (normalizedPlanetID <= 0) {
    return [];
  }

  const state = readState({ repair: true });
  const colonies = [];
  let changed = false;
  for (const [key, rawColony] of Object.entries(state.coloniesByKey)) {
    if (normalizeInteger(rawColony && rawColony.planetID, 0) !== normalizedPlanetID) {
      continue;
    }

    const simulationResult = runColonySimulation(rawColony, currentFileTimeString(), {
      planetID: normalizedPlanetID,
      ownerID: rawColony && rawColony.ownerID,
    });
    if (simulationResult.changed) {
      state.coloniesByKey[key] = simulationResult.colony;
      changed = true;
    }
    colonies.push(simulationResult.colony);
  }
  if (changed) {
    writeState(state);
  }
  return colonies;
}

function getColonyByPin(ownerID, pinID) {
  const normalizedOwnerID = normalizeInteger(ownerID, 0);
  const normalizedPinID = normalizeInteger(pinID, 0);
  if (normalizedOwnerID <= 0 || normalizedPinID <= 0) {
    return null;
  }

  const state = readState({ repair: true });
  let changed = false;
  for (const [key, rawColony] of Object.entries(state.coloniesByKey || {})) {
    if (normalizeInteger(rawColony && rawColony.ownerID, 0) !== normalizedOwnerID) {
      continue;
    }

    const simulationResult = runColonySimulation(rawColony, currentFileTimeString(), {
      planetID: rawColony && rawColony.planetID,
      ownerID: normalizedOwnerID,
    });
    const colony = simulationResult.colony;
    if (simulationResult.changed) {
      state.coloniesByKey[key] = colony;
      changed = true;
    }
    if (findPin(colony, normalizedPinID)) {
      if (changed) {
        writeState(state);
      }
      return colony;
    }
  }

  if (changed) {
    writeState(state);
  }
  return null;
}

function prepareSpaceportImportExport({
  planetID,
  ownerID,
  spaceportPinID,
  importCommodities = {},
  exportCommodities = {},
} = {}) {
  const normalizedPlanetID = normalizeInteger(planetID, 0);
  const normalizedOwnerID = normalizeInteger(ownerID, 0);
  const normalizedSpaceportPinID = normalizeInteger(spaceportPinID, 0);
  if (normalizedPlanetID <= 0 || normalizedOwnerID <= 0 || normalizedSpaceportPinID <= 0) {
    return { success: false, errorMsg: "CannotImportEndpointNotFound" };
  }

  const normalizedImports = normalizeContents(importCommodities);
  const normalizedExports = normalizeContents(exportCommodities);
  if (
    Object.keys(normalizedImports).length < 1 &&
    Object.keys(normalizedExports).length < 1
  ) {
    return { success: false, errorMsg: "PleaseSelectCommoditiesToImport" };
  }

  const state = readState({ repair: true });
  const key = colonyKey(normalizedPlanetID, normalizedOwnerID);
  if (!state.coloniesByKey[key]) {
    return { success: false, errorMsg: "CannotImportEndpointNotFound" };
  }

  const simulationResult = runColonySimulation(state.coloniesByKey[key], currentFileTimeString(), {
    planetID: normalizedPlanetID,
    ownerID: normalizedOwnerID,
  });
  const colony = simulationResult.colony;
  const spaceportPin = findPin(colony, normalizedSpaceportPinID);
  if (!spaceportPin || getPinEntityType(spaceportPin) !== "spaceport") {
    return { success: false, errorMsg: "CannotImportEndpointNotFound" };
  }

  const workingPin = cloneJson(spaceportPin);
  for (const [typeID, quantity] of Object.entries(normalizedExports)) {
    if (getContentsQuantity(workingPin, typeID) < quantity) {
      return { success: false, errorMsg: "CannotLaunchCommoditiesNotFound" };
    }
    removeCommodityFromPin(workingPin, typeID, quantity);
  }

  for (const [typeID, quantity] of Object.entries(normalizedImports)) {
    if (getAcceptableQuantity(workingPin, typeID, quantity) < quantity) {
      return { success: false, errorMsg: "NotEnoughCargoSpace" };
    }
    addCommodityToPin(workingPin, typeID, quantity);
  }

  return {
    success: true,
    state,
    key,
    colony,
    spaceportPin,
    workingPin,
    importCommodities: normalizedImports,
    exportCommodities: normalizedExports,
  };
}

function prepareExpeditedTransfer({
  planetID,
  ownerID,
  solarSystemID = 0,
  planetTypeID = 0,
  planetRadius = 0,
  path = [],
  commodities = {},
} = {}) {
  const normalizedPlanetID = normalizeInteger(planetID, 0);
  const normalizedOwnerID = normalizeInteger(ownerID, 0);
  const normalizedPath = normalizeTransferPath(path);
  const normalizedCommodities = normalizeContents(commodities);
  if (normalizedPlanetID <= 0 || normalizedOwnerID <= 0) {
    return { success: false, errorMsg: "CannotManagePlanetWithoutCommandCenter" };
  }
  if (normalizedPath.length < 2) {
    return { success: false, errorMsg: "CreateRouteTooShort" };
  }
  if (Object.keys(normalizedCommodities).length < 1) {
    return { success: false, errorMsg: "CreateRouteWithoutCommodities" };
  }

  const state = readState({ repair: true });
  const key = colonyKey(normalizedPlanetID, normalizedOwnerID);
  if (!state.coloniesByKey[key]) {
    return { success: false, errorMsg: "CannotManagePlanetWithoutCommandCenter" };
  }

  const runTime = currentFileTimeString();
  const simulationResult = runColonySimulation(state.coloniesByKey[key], runTime, {
    planetID: normalizedPlanetID,
    ownerID: normalizedOwnerID,
    solarSystemID,
    planetTypeID,
    planetRadius,
  });
  const colony = simulationResult.colony;
  const sourcePin = findPin(colony, normalizedPath[0]);
  const destinationPin = findPin(colony, normalizedPath[normalizedPath.length - 1]);
  if (!sourcePin || !destinationPin) {
    return { success: false, errorMsg: "RouteFailedValidationPinDoesNotExist" };
  }
  if (!isStorageEntityType(getPinEntityType(sourcePin))) {
    return { success: false, errorMsg: "RouteFailedValidationExpeditedSourceNotStorage" };
  }

  for (const pinID of normalizedPath) {
    const pin = findPin(colony, pinID);
    if (!pin) {
      return { success: false, errorMsg: "RouteFailedValidationPinDoesNotExist" };
    }
    if (normalizeInteger(pin.ownerID, normalizedOwnerID) !== normalizedOwnerID) {
      return { success: false, errorMsg: "RouteFailedValidationPinNotYours" };
    }
  }

  for (const [typeID, quantity] of Object.entries(normalizedCommodities)) {
    if (getContentsQuantity(sourcePin, typeID) <= 0) {
      return { success: false, errorMsg: "RouteFailedValidationExpeditedSourceLacksCommodity" };
    }
    if (getContentsQuantity(sourcePin, typeID) < quantity) {
      return { success: false, errorMsg: "RouteFailedValidationExpeditedSourceLacksCommodityQty" };
    }
    if (getAcceptableQuantity(destinationPin, typeID, quantity) < 1) {
      return { success: false, errorMsg: "RouteFailedValidationExpeditedDestinationCannotAccept" };
    }
  }

  let minBandwidth;
  try {
    minBandwidth = getMinimumLinkBandwidthForPath(colony, normalizedPath);
  } catch (error) {
    return {
      success: false,
      errorMsg: error && error.message ? error.message : "RouteFailedValidationNoBandwidthAvailable",
    };
  }
  if (!(minBandwidth > 0)) {
    return { success: false, errorMsg: "RouteFailedValidationNoBandwidthAvailable" };
  }

  const nextTransferTime = filetimeBigInt(sourcePin.lastRunTime, 0n);
  const currentRunTime = filetimeBigInt(runTime, currentFileTime());
  if (nextTransferTime > currentRunTime) {
    return { success: false, errorMsg: "RouteFailedValidationExpeditedSourceNotReady" };
  }

  return {
    success: true,
    state,
    key,
    colony,
    sourcePin,
    destinationPin,
    path: normalizedPath,
    commoditiesToTransfer: normalizedCommodities,
    minBandwidth,
    runTime,
  };
}

function previewTransferCommodities(options = {}) {
  const result = prepareExpeditedTransfer(options);
  if (!result.success) {
    return result;
  }
  return {
    success: true,
    path: [...result.path],
    commoditiesToTransfer: { ...result.commoditiesToTransfer },
    minBandwidth: result.minBandwidth,
    runTime: result.runTime,
    sourcePin: { ...result.sourcePin },
    destinationPin: { ...result.destinationPin },
  };
}

function transferCommodities(options = {}) {
  const result = prepareExpeditedTransfer(options);
  if (!result.success) {
    return result;
  }

  const movedCommodities = {};
  for (const [typeID, quantity] of Object.entries(result.commoditiesToTransfer)) {
    const transferQuantity = Math.min(
      normalizeInteger(quantity, 0),
      getContentsQuantity(result.sourcePin, typeID),
    );
    const movedQuantity = addCommodityToPin(result.destinationPin, typeID, transferQuantity);
    if (movedQuantity > 0) {
      removeCommodityFromPin(result.sourcePin, typeID, movedQuantity);
      movedCommodities[String(typeID)] = movedQuantity;
    }
  }

  if (Object.keys(movedCommodities).length < 1) {
    return { success: false, errorMsg: "RouteFailedValidationExpeditedDestinationCannotAccept" };
  }

  const transferTicks = BigInt(getExpeditedTransferTimeTicks(
    result.minBandwidth,
    movedCommodities,
  ));
  const sourceRunTime = (
    filetimeBigInt(result.runTime, currentFileTime()) + transferTicks
  ).toString();
  result.sourcePin.lastRunTime = sourceRunTime;
  result.colony.currentSimTime = result.runTime;
  result.colony.updatedAt = new Date().toISOString();
  result.state.coloniesByKey[result.key] = normalizeColony(result.colony, {
    planetID: options.planetID,
    ownerID: options.ownerID,
    solarSystemID: options.solarSystemID,
    planetTypeID: options.planetTypeID,
    planetRadius: options.planetRadius,
  });
  writeState(result.state);

  return {
    success: true,
    simTime: result.runTime,
    sourceRunTime,
    movedCommodities,
    path: result.path,
    sourcePinID: normalizeInteger(result.sourcePin.pinID, 0),
    destinationPinID: normalizeInteger(result.destinationPin.pinID, 0),
  };
}

function previewSpaceportImportExport(options = {}) {
  const result = prepareSpaceportImportExport(options);
  if (!result.success) {
    return result;
  }
  return {
    success: true,
    colony: result.colony,
    spaceportPin: { ...result.spaceportPin },
    importCommodities: { ...result.importCommodities },
    exportCommodities: { ...result.exportCommodities },
  };
}

function applySpaceportImportExport(options = {}) {
  const {
    planetID,
    ownerID,
  } = options;
  const normalizedPlanetID = normalizeInteger(planetID, 0);
  const normalizedOwnerID = normalizeInteger(ownerID, 0);
  const result = prepareSpaceportImportExport(options);
  if (!result.success) {
    return result;
  }

  result.spaceportPin.contents = normalizeContents(result.workingPin.contents);
  result.colony.currentSimTime = currentFileTimeString();
  result.colony.updatedAt = new Date().toISOString();
  result.state.coloniesByKey[result.key] = normalizeColony(result.colony, {
    planetID: normalizedPlanetID,
    ownerID: normalizedOwnerID,
  });
  writeState(result.state);

  return {
    success: true,
    colony: result.state.coloniesByKey[result.key],
    spaceportPin: normalizePin(result.spaceportPin, normalizedOwnerID),
    importCommodities: result.importCommodities,
    exportCommodities: result.exportCommodities,
  };
}

function listLaunchesForCharacter(ownerID) {
  const normalizedOwnerID = normalizeInteger(ownerID, 0);
  if (normalizedOwnerID <= 0) {
    return [];
  }

  const state = readState({ repair: true });
  return Object.values(state.launchesByID)
    .map(normalizeLaunchRecord)
    .filter((launch) => (
      normalizeInteger(launch && launch.ownerID, 0) === normalizedOwnerID &&
      launch.deleted !== true
    ));
}

function cleanupExpiredLaunches(options = {}) {
  const state = readState({ repair: true });
  const nowFileTime = filetimeBigInt(options.nowFileTime, currentFileTime());
  const maxAgeDays = normalizeInteger(options.maxAgeDays, 0);
  const maxAgeTicks = maxAgeDays > 0
    ? BigInt(maxAgeDays) * DAY_TICKS
    : null;
  const ownerID = normalizeInteger(options.ownerID, 0);
  const planetID = normalizeInteger(options.planetID, 0);
  let scanned = 0;
  let deleted = 0;
  const deletedLaunchIDs = [];

  for (const [launchKey, rawLaunch] of Object.entries(state.launchesByID || {})) {
    const launch = normalizeLaunchRecord(rawLaunch);
    if (ownerID > 0 && normalizeInteger(launch.ownerID, 0) !== ownerID) {
      continue;
    }
    if (planetID > 0 && normalizeInteger(launch.planetID, 0) !== planetID) {
      continue;
    }

    scanned += 1;
    if (launch.deleted === true || !isLaunchCleanupEligible(launch, nowFileTime, maxAgeTicks)) {
      continue;
    }

    launch.deleted = true;
    launch.deletedAt = new Date().toISOString();
    launch.updatedAt = launch.deletedAt;
    state.launchesByID[launchKey] = launch;
    deleted += 1;
    deletedLaunchIDs.push(normalizeInteger(launch.launchID, 0));
  }

  if (deleted > 0) {
    writeState(state);
  }

  return {
    scanned,
    deleted,
    deletedLaunchIDs,
    maxAgeDays: maxAgeDays > 0
      ? maxAgeDays
      : Number((PI_LAUNCH_ORBIT_DECAY_TICKS + PI_LAUNCH_CLEANUP_GRACE_TICKS) / DAY_TICKS),
  };
}

function summarizePin(pin = {}) {
  const entityType = getPinEntityType(pin);
  return {
    pinID: normalizeInteger(pin.pinID ?? pin.id, 0),
    typeID: normalizeInteger(pin.typeID, 0),
    entityType: entityType || "",
    state: normalizeInteger(pin.state, STATE_IDLE),
    schematicID: normalizeNullableInteger(pin.schematicID),
    programType: normalizeNullableInteger(pin.programType),
    contents: summarizeContents(pin.contents),
    lastRunTime: pin.lastRunTime ? String(pin.lastRunTime) : null,
    lastLaunchTime: pin.lastLaunchTime ? String(pin.lastLaunchTime) : null,
  };
}

function summarizeColony(colony = {}) {
  const normalizedColony = normalizeColony(colony, {
    planetID: colony && colony.planetID,
    ownerID: colony && colony.ownerID,
  });
  const pinSummaries = (Array.isArray(normalizedColony.pins) ? normalizedColony.pins : [])
    .map(summarizePin)
    .sort((left, right) => left.pinID - right.pinID);
  const contentsByTypeID = {};
  for (const pin of normalizedColony.pins) {
    for (const [typeID, quantity] of Object.entries(normalizeContents(pin.contents))) {
      contentsByTypeID[typeID] = normalizeInteger(contentsByTypeID[typeID], 0) +
        normalizeInteger(quantity, 0);
    }
  }

  return {
    planetID: normalizeInteger(normalizedColony.planetID, 0),
    ownerID: normalizeInteger(normalizedColony.ownerID, 0),
    level: normalizeInteger(normalizedColony.level, 0),
    currentSimTime: normalizedColony.currentSimTime ? String(normalizedColony.currentSimTime) : null,
    pinCount: pinSummaries.length,
    linkCount: Array.isArray(normalizedColony.links) ? normalizedColony.links.length : 0,
    routeCount: Array.isArray(normalizedColony.routes) ? normalizedColony.routes.length : 0,
    activePinCount: pinSummaries.filter((pin) => pin.state === STATE_ACTIVE).length,
    pins: pinSummaries,
    contentsByTypeID: summarizeContents(contentsByTypeID),
  };
}

function summarizeResourceRecord(record = {}) {
  if (!isPlainObject(record)) {
    return {
      resourceTypeIDs: [],
      qualitiesByTypeID: {},
      layers: [],
    };
  }

  const layers = [];
  for (const resourceTypeID of normalizeResourceTypeIDs(record.resourceTypeIDs)) {
    const layer = getResourceLayerFromRecord(record, resourceTypeID);
    layers.push({
      resourceTypeID,
      quality: normalizeInteger(
        record.qualitiesByTypeID && record.qualitiesByTypeID[String(resourceTypeID)],
        0,
      ),
      hotspotCount: layer && Array.isArray(layer.hotspots) ? layer.hotspots.length : 0,
      depletionEventCount: layer && Array.isArray(layer.depletionEvents)
        ? layer.depletionEvents.length
        : 0,
    });
  }

  return {
    version: normalizeInteger(record.version, 0),
    planetID: normalizeInteger(record.planetID, 0),
    resourceTypeIDs: normalizeResourceTypeIDs(record.resourceTypeIDs),
    qualitiesByTypeID: isPlainObject(record.qualitiesByTypeID)
      ? { ...record.qualitiesByTypeID }
      : {},
    layers,
  };
}

function getPlanetDiagnostics(options = {}) {
  const state = readState({ repair: true });
  const planetID = normalizeInteger(options.planetID, 0);
  const ownerID = normalizeInteger(options.ownerID, 0);
  const nowFileTime = currentFileTime();
  const colonies = Object.values(state.coloniesByKey || {})
    .filter((colony) => (
      (planetID <= 0 || normalizeInteger(colony && colony.planetID, 0) === planetID) &&
      (ownerID <= 0 || normalizeInteger(colony && colony.ownerID, 0) === ownerID)
    ))
    .map(summarizeColony)
    .sort((left, right) => (
      left.planetID === right.planetID
        ? left.ownerID - right.ownerID
        : left.planetID - right.planetID
    ));
  const launches = Object.values(state.launchesByID || {})
    .map(normalizeLaunchRecord)
    .filter((launch) => (
      (planetID <= 0 || normalizeInteger(launch.planetID, 0) === planetID) &&
      (ownerID <= 0 || normalizeInteger(launch.ownerID, 0) === ownerID)
    ));
  const activeLaunches = launches.filter((launch) => (
    launch.deleted !== true && !isLaunchExpired(launch, nowFileTime)
  ));
  const expiredLaunches = launches.filter((launch) => (
    launch.deleted !== true && isLaunchExpired(launch, nowFileTime)
  ));
  const resourceRecord = planetID > 0
    ? state.resourcesByPlanetID[String(planetID)]
    : null;

  return {
    schemaVersion: normalizeInteger(state.schemaVersion, SCHEMA_VERSION),
    planetID,
    ownerID,
    colonyCount: colonies.length,
    colonies,
    launches: {
      total: launches.length,
      active: activeLaunches.length,
      expired: expiredLaunches.length,
      deleted: launches.filter((launch) => launch.deleted === true).length,
    },
    resources: summarizeResourceRecord(resourceRecord),
    nextIDs: isPlainObject(state.nextIDs) ? { ...state.nextIDs } : cloneJson(DEFAULT_NEXT_IDS),
  };
}

function addCommodityToColonyPin({
  planetID,
  ownerID,
  pinID,
  typeID,
  quantity,
} = {}) {
  const normalizedPlanetID = normalizeInteger(planetID, 0);
  const normalizedOwnerID = normalizeInteger(ownerID, 0);
  const normalizedPinID = normalizeInteger(pinID, 0);
  const normalizedTypeID = normalizeInteger(typeID, 0);
  const normalizedQuantity = normalizeInteger(quantity, 0);
  if (
    normalizedPlanetID <= 0 ||
    normalizedOwnerID <= 0 ||
    normalizedPinID <= 0 ||
    normalizedTypeID <= 0 ||
    normalizedQuantity <= 0
  ) {
    return { success: false, errorMsg: "INVALID_ARGUMENTS" };
  }

  const state = readState({ repair: true });
  const key = colonyKey(normalizedPlanetID, normalizedOwnerID);
  const colony = state.coloniesByKey[key]
    ? normalizeColony(state.coloniesByKey[key], {
      planetID: normalizedPlanetID,
      ownerID: normalizedOwnerID,
    })
    : null;
  if (!colony) {
    return { success: false, errorMsg: "COLONY_NOT_FOUND" };
  }

  const pin = findPin(colony, normalizedPinID);
  if (!pin) {
    return { success: false, errorMsg: "PIN_NOT_FOUND" };
  }

  const added = addCommodityToPin(pin, normalizedTypeID, normalizedQuantity);
  if (added <= 0) {
    return { success: false, errorMsg: "PIN_CANNOT_ACCEPT_COMMODITY" };
  }

  state.coloniesByKey[key] = normalizeColony(colony, {
    planetID: normalizedPlanetID,
    ownerID: normalizedOwnerID,
  });
  writeState(state);
  return {
    success: true,
    added,
    colony: state.coloniesByKey[key],
  };
}

function getLaunch(launchID, ownerID = 0) {
  const normalizedLaunchID = normalizeInteger(launchID, 0);
  if (normalizedLaunchID <= 0) {
    return null;
  }

  const state = readState({ repair: true });
  const launch = state.launchesByID[String(normalizedLaunchID)];
  if (!launch) {
    return null;
  }

  const normalizedLaunch = normalizeLaunchRecord(launch);
  const normalizedOwnerID = normalizeInteger(ownerID, 0);
  if (
    normalizedLaunch.deleted === true ||
    (
      normalizedOwnerID > 0 &&
      normalizeInteger(normalizedLaunch.ownerID, 0) > 0 &&
      normalizeInteger(normalizedLaunch.ownerID, 0) !== normalizedOwnerID
    )
  ) {
    return null;
  }
  return normalizedLaunch;
}

function deleteLaunch(launchID, ownerID = 0) {
  const normalizedLaunchID = normalizeInteger(launchID, 0);
  if (normalizedLaunchID <= 0) {
    return false;
  }

  const state = readState({ repair: true });
  const launch = state.launchesByID[String(normalizedLaunchID)];
  if (!launch) {
    return true;
  }

  const normalizedOwnerID = normalizeInteger(ownerID, 0);
  if (
    normalizedOwnerID > 0 &&
    normalizeInteger(launch.ownerID, 0) > 0 &&
    normalizeInteger(launch.ownerID, 0) !== normalizedOwnerID
  ) {
    return false;
  }

  launch.deleted = true;
  launch.deletedAt = new Date().toISOString();
  writeState(state);
  return true;
}

function attachLaunchContainer({
  launchID,
  ownerID = 0,
  itemID,
} = {}) {
  const normalizedLaunchID = normalizeInteger(launchID, 0);
  const normalizedItemID = normalizeInteger(itemID, 0);
  if (normalizedLaunchID <= 0 || normalizedItemID <= 0) {
    return null;
  }

  const state = readState({ repair: true });
  const launch = state.launchesByID[String(normalizedLaunchID)];
  if (!launch) {
    return null;
  }

  const normalizedOwnerID = normalizeInteger(ownerID, 0);
  if (
    normalizedOwnerID > 0 &&
    normalizeInteger(launch.ownerID, 0) > 0 &&
    normalizeInteger(launch.ownerID, 0) !== normalizedOwnerID
  ) {
    return null;
  }

  const updatedLaunch = normalizeLaunchRecord({
    ...launch,
    itemID: normalizedItemID,
    physicalContainerID: normalizedItemID,
    updatedAt: new Date().toISOString(),
  });
  state.launchesByID[String(normalizedLaunchID)] = updatedLaunch;
  writeState(state);
  return updatedLaunch;
}

module.exports = {
  TABLE_NAME,
  SCHEMA_VERSION,
  DEFAULT_NEXT_IDS,
  COMMAND,
  LINK_TYPE_ID,
  PLANET_RESOURCE_MAX_VALUE,
  PI_LAUNCH_ORBIT_DECAY_TICKS,
  EXPEDITED_TRANSFER_MINIMUM_TICKS,
  getOrCreatePlanetResources,
  getResourceDataForClient,
  getResourceLayer,
  evaluateResourceValueAt,
  getColony,
  getColonyByPin,
  listColoniesForCharacter,
  listColoniesForPlanet,
  listLaunchesForCharacter,
  hasAcceptedNetworkEdit,
  cleanupExpiredLaunches,
  getPlanetDiagnostics,
  addCommodityToColonyPin,
  getLaunch,
  deleteLaunch,
  attachLaunchContainer,
  previewLaunchCommodities,
  launchCommodities,
  previewTransferCommodities,
  transferCommodities,
  previewSpaceportImportExport,
  applySpaceportImportExport,
  previewUserUpdateNetwork,
  applyUserUpdateNetwork,
  abandonColony,
  estimateProgramResult,
  _testing: {
    buildPin,
    buildResourceRecord,
    buildResourceLayer,
    evaluateResourceLayerValue,
    normalizeCommandStream,
    normalizeColony,
    normalizeResourceLayer,
    normalizeState,
    stableHash,
    validateColonyNetwork,
    getExpeditedTransferTimeTicks,
  },
};
