const path = require("path");

const config = require(path.join(__dirname, "../../config"));
const database = require(path.join(__dirname, "../../newDatabase"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { TABLE, readStaticRows } = require(path.join(
  __dirname,
  "../_shared/referenceData",
));
const { resolveItemByTypeID } = require(path.join(
  __dirname,
  "../inventory/itemTypeRegistry",
));
const { resolveShipByTypeID } = require(path.join(
  __dirname,
  "../chat/shipTypeRegistry",
));
const { getTypeAttributeValue } = require(path.join(
  __dirname,
  "../fitting/liveFittingState",
));
const { normalizeRoleValue } = require(path.join(
  __dirname,
  "../account/accountRoleProfiles",
));
const structureAssetSafetyState = require(path.join(
  __dirname,
  "./structureAssetSafetyState",
));
const structureDockedRecoveryState = require(path.join(
  __dirname,
  "./structureDockedRecoveryState",
));
const structureDestructionLootState = require(path.join(
  __dirname,
  "./structureDestructionLootState",
));
const {
  resolveStructureEffectiveHitpoints,
} = require(path.join(__dirname, "./structureFullPowerDogma"));
const {
  STRUCTURE_STATE,
  STRUCTURE_STATE_NAME_BY_ID,
  STRUCTURE_STATE_ID_BY_NAME,
  STRUCTURE_DISABLED_STATES,
  STRUCTURE_TETHER_ENABLED_STATES,
  STRUCTURE_VULNERABLE_STATES,
  STRUCTURE_UPKEEP_STATE,
  STRUCTURE_UPKEEP_NAME_BY_ID,
  STRUCTURE_UPKEEP_ID_BY_NAME,
  STRUCTURE_SERVICE_ID,
  STRUCTURE_SERVICE_STATE,
  STRUCTURE_SIZE,
  STRUCTURE_FAMILY,
  STRUCTURE_GROUP_ID,
  STRUCTURE_TIMER_SECONDS,
  STRUCTURE_UNANCHOR_CANCEL_STATES,
  STRUCTURE_REPAIR_SECONDS_BY_STATE,
  DEFAULT_REINFORCE_WEEKDAY,
  DEFAULT_REINFORCE_HOUR,
  DEFAULT_STRUCTURE_RADIUS,
  DEFAULT_STRUCTURE_TETHER_RANGE,
  NEXT_STRUCTURE_ID_START,
  NEXT_ASSET_WRAP_ID_START,
  STRUCTURE_TYPE_PRESETS,
  TATARA_EXCLUDED_DOCK_GROUP_NAMES,
  ONE_WAY_UNDOCK_TYPE_IDS,
  getAllowedServicesForStructureType,
} = require(path.join(__dirname, "./structureConstants"));

const STRUCTURE_TYPES_TABLE = "structureTypes";
const STRUCTURES_TABLE = "structures";
const STRUCTURE_ASSET_SAFETY_TABLE = "structureAssetSafety";
const FILETIME_EPOCH_OFFSET = 116444736000000000n;
const FILETIME_TICKS_PER_MS = 10000n;
const ONLINE_BY_DEFAULT = new Set([
  STRUCTURE_SERVICE_ID.DOCKING,
  STRUCTURE_SERVICE_ID.FITTING,
  STRUCTURE_SERVICE_ID.OFFICES,
  STRUCTURE_SERVICE_ID.REPAIR,
  STRUCTURE_SERVICE_ID.INSURANCE,
]);
const GM_BYPASS_ROLE_MASK = normalizeRoleValue("1600953932865792", 0n);
const REQUIRED_NON_CATEGORY_STRUCTURE_TYPE_IDS = Object.freeze([
  32226,
  32458,
  46363,
  46364,
  81080,
  84294,
  85230,
  87227,
]);

let typeCache = null;
let structureCache = null;
let solarCache = null;
const structureChangeListeners = new Set();

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFloat(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = toInt(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function normalizePosition(value, fallback = { x: 0, y: 0, z: 0 }) {
  if (!value || typeof value !== "object") {
    return { x: fallback.x, y: fallback.y, z: fallback.z };
  }
  return {
    x: toFloat(value.x, fallback.x),
    y: toFloat(value.y, fallback.y),
    z: toFloat(value.z, fallback.z),
  };
}

function normalizeRotation(value) {
  if (!Array.isArray(value) || value.length < 3) {
    return [0, 0, 0];
  }
  return [toFloat(value[0], 0), toFloat(value[1], 0), toFloat(value[2], 0)];
}

function normalizeConditionState(value) {
  const source = value && typeof value === "object" ? value : {};
  const clamp01 = (raw, fallback) => Math.max(0, Math.min(1, toFloat(raw, fallback)));
  return {
    damage: clamp01(source.damage, 0),
    charge: clamp01(source.charge, 1),
    armorDamage: clamp01(source.armorDamage, 0),
    shieldCharge: clamp01(source.shieldCharge, 1),
    incapacitated: Boolean(source.incapacitated),
  };
}

function toFileTimeLongFromMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return BigInt(Math.trunc(numeric)) * FILETIME_TICKS_PER_MS + FILETIME_EPOCH_OFFSET;
}

function readTable(tableName, fallbackValue) {
  const result = database.read(tableName, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return cloneValue(fallbackValue);
  }
  return cloneValue(result.data);
}

function writeTable(tableName, payload) {
  const result = database.write(tableName, "/", payload);
  if (!result.success) {
    return {
      success: false,
      errorMsg: result.errorMsg || "WRITE_FAILED",
    };
  }
  if (tableName === STRUCTURE_TYPES_TABLE) {
    typeCache = null;
  }
  if (tableName === STRUCTURES_TABLE) {
    structureCache = null;
  }
  return { success: true };
}

function listTopLevelItemsInStructure(structureID) {
  const targetID = toPositiveInt(structureID, 0);
  if (!targetID) {
    return [];
  }

  const itemsResult = database.read("items", "/");
  if (!itemsResult.success || !itemsResult.data || typeof itemsResult.data !== "object") {
    return [];
  }

  return Object.values(itemsResult.data)
    .filter((entry) => entry && toPositiveInt(entry.locationID, 0) === targetID)
    .map((entry) => cloneValue(entry));
}

function getSolarSystemsByID() {
  if (solarCache) {
    return solarCache;
  }
  solarCache = new Map(
    readStaticRows(TABLE.SOLAR_SYSTEMS)
      .map((entry) => [toPositiveInt(entry && entry.solarSystemID, 0), entry])
      .filter(([solarSystemID]) => solarSystemID > 0),
  );
  return solarCache;
}

function getSolarSystemRecord(solarSystemID) {
  return getSolarSystemsByID().get(toPositiveInt(solarSystemID, 0)) || null;
}

function deriveFamily(groupID, typeID) {
  const preset = STRUCTURE_TYPE_PRESETS[toPositiveInt(typeID, 0)] || null;
  if (preset && preset.family) {
    return preset.family;
  }
  switch (toPositiveInt(groupID, 0)) {
    case STRUCTURE_GROUP_ID.CITADEL:
      return STRUCTURE_FAMILY.CITADEL;
    case STRUCTURE_GROUP_ID.ENGINEERING_COMPLEX:
      return STRUCTURE_FAMILY.ENGINEERING;
    case STRUCTURE_GROUP_ID.REFINERY:
    case STRUCTURE_GROUP_ID.METENOX:
      return STRUCTURE_FAMILY.REFINERY;
    case STRUCTURE_GROUP_ID.CYNO_BEACON:
    case STRUCTURE_GROUP_ID.CYNO_JAMMER:
    case STRUCTURE_GROUP_ID.JUMP_GATE:
      return STRUCTURE_FAMILY.FLEX;
    case STRUCTURE_GROUP_ID.OBSERVATORY:
      return STRUCTURE_FAMILY.OBSERVATORY;
    case STRUCTURE_GROUP_ID.ADMINISTRATION_HUB:
      return STRUCTURE_FAMILY.SOV;
    case STRUCTURE_GROUP_ID.FOB:
    case STRUCTURE_GROUP_ID.PIRATE_STRONGHOLD:
      return STRUCTURE_FAMILY.STRONGHOLD;
    default:
      return STRUCTURE_FAMILY.UNKNOWN;
  }
}

function deriveSize(groupID, typeID) {
  const preset = STRUCTURE_TYPE_PRESETS[toPositiveInt(typeID, 0)] || null;
  if (preset && preset.size) {
    return preset.size;
  }
  if (toPositiveInt(groupID, 0) === STRUCTURE_GROUP_ID.CYNO_BEACON) {
    return STRUCTURE_SIZE.FLEX;
  }
  return STRUCTURE_SIZE.UNDEFINED;
}

function buildDefaultServiceStates(typeID, family) {
  const states = {};
  for (const serviceID of getAllowedServicesForStructureType(typeID, family)) {
    states[String(serviceID)] = ONLINE_BY_DEFAULT.has(serviceID)
      ? STRUCTURE_SERVICE_STATE.ONLINE
      : STRUCTURE_SERVICE_STATE.OFFLINE;
  }
  return states;
}

function normalizeServiceStates(value, typeID, family) {
  const next = buildDefaultServiceStates(typeID, family);
  const source = value && typeof value === "object" ? value : {};
  for (const [serviceID, stateID] of Object.entries(source)) {
    const numericServiceID = toPositiveInt(serviceID, 0);
    if (!numericServiceID) {
      continue;
    }
    next[String(numericServiceID)] =
      toInt(stateID, STRUCTURE_SERVICE_STATE.OFFLINE) === STRUCTURE_SERVICE_STATE.ONLINE
        ? STRUCTURE_SERVICE_STATE.ONLINE
        : STRUCTURE_SERVICE_STATE.OFFLINE;
  }
  return next;
}

function normalizeAccessProfile(value) {
  const source = value && typeof value === "object" ? value : {};
  const normalizePolicy = (raw, fallback) => {
    const normalized = String(raw || fallback).trim().toLowerCase();
    return ["public", "alliance", "corp", "owner", "none"].includes(normalized)
      ? normalized
      : fallback;
  };
  return {
    docking: normalizePolicy(source.docking, "public"),
    tethering: normalizePolicy(source.tethering, "public"),
  };
}

function normalizeStructureTypeRecord(entry = {}) {
  const typeID = toPositiveInt(entry.typeID, 0);
  const preset = STRUCTURE_TYPE_PRESETS[typeID] || null;
  const itemType = resolveItemByTypeID(typeID) || entry || {};
  const family = entry.structureFamily || deriveFamily(itemType.groupID, typeID);
  const size = entry.structureSize || deriveSize(itemType.groupID, typeID);
  const defaultQuantumCoreTypeID = toPositiveInt(
    entry.defaultQuantumCoreTypeID,
    (preset && preset.defaultQuantumCoreTypeID) || 0,
  ) || null;

  return {
    typeID,
    name: String(itemType.name || entry.name || `Structure ${typeID}`),
    groupID: toPositiveInt(itemType.groupID || entry.groupID, 0),
    categoryID: toPositiveInt(itemType.categoryID || entry.categoryID, 65),
    structureFamily: family,
    structureSize: size,
    radius: Math.max(
      DEFAULT_STRUCTURE_RADIUS,
      toFloat(entry.radius, getTypeAttributeValue(typeID, "radius")) || DEFAULT_STRUCTURE_RADIUS,
    ),
    shieldCapacity: Math.max(0, toFloat(entry.shieldCapacity, getTypeAttributeValue(typeID, "shieldCapacity"))),
    armorHP: Math.max(0, toFloat(entry.armorHP, getTypeAttributeValue(typeID, "armorHP"))),
    hullHP: Math.max(0, toFloat(entry.hullHP, getTypeAttributeValue(typeID, "hp", "structureHP"))),
    capacitorCapacity: Math.max(
      0,
      toFloat(entry.capacitorCapacity, getTypeAttributeValue(typeID, "capacitorCapacity")),
    ),
    maxTargetRange: Math.max(0, toFloat(entry.maxTargetRange, getTypeAttributeValue(typeID, "maxTargetRange"))),
    maxLockedTargets: Math.max(0, toFloat(entry.maxLockedTargets, getTypeAttributeValue(typeID, "maxLockedTargets"))),
    tetheringRange: Math.max(
      DEFAULT_STRUCTURE_TETHER_RANGE,
      toFloat(entry.tetheringRange, getTypeAttributeValue(typeID, "tetheringRange")) || DEFAULT_STRUCTURE_TETHER_RANGE,
    ),
    damageCap: Math.max(0, toFloat(entry.damageCap, getTypeAttributeValue(typeID, "damageCap"))),
    allowedServices: Array.isArray(entry.allowedServices)
      ? entry.allowedServices.map((serviceID) => toPositiveInt(serviceID, 0)).filter(Boolean)
      : Array.isArray(preset && preset.allowedServices)
      ? preset.allowedServices.map((serviceID) => toPositiveInt(serviceID, 0)).filter(Boolean)
      : getAllowedServicesForStructureType(typeID, family),
    dockable:
      typeof (preset && preset.dockable) === "boolean"
        ? preset.dockable
        : ![
          STRUCTURE_FAMILY.FLEX,
          STRUCTURE_FAMILY.OBSERVATORY,
          STRUCTURE_FAMILY.SOV,
        ].includes(family),
    defaultQuantumCoreTypeID,
    excludedDockGroupNames:
      typeID === 35836 ? [...TATARA_EXCLUDED_DOCK_GROUP_NAMES] : [],
    oneWayUndockClasses: [...(ONE_WAY_UNDOCK_TYPE_IDS[typeID] || [])],
    tetherRepairEffectMode:
      entry.tetherRepairEffectMode === undefined ||
      entry.tetherRepairEffectMode === null
        ? null
        : String(entry.tetherRepairEffectMode),
    published: itemType.published !== false,
  };
}

function ensureStructureTypes() {
  if (typeCache) {
    return typeCache;
  }

  const payload = readTable(STRUCTURE_TYPES_TABLE, {
    _meta: { seedVersion: 1, generatedAt: null },
    structureTypes: [],
  });
  let rows = Array.isArray(payload.structureTypes)
    ? payload.structureTypes.map((entry) => normalizeStructureTypeRecord(entry))
    : [];

  if (rows.length === 0) {
    rows = readStaticRows(TABLE.ITEM_TYPES)
      .filter((entry) => toPositiveInt(entry && entry.categoryID, 0) === 65)
      .map((entry) => normalizeStructureTypeRecord(entry))
      .filter((entry) => entry.typeID > 0)
      .sort((left, right) => left.typeID - right.typeID);

    const writeResult = writeTable(STRUCTURE_TYPES_TABLE, {
      _meta: {
        seedVersion: 1,
        generatedAt: new Date().toISOString(),
      },
      structureTypes: rows,
    });
    if (!writeResult.success) {
      log.warn(
        `[StructureState] Failed to persist structureTypes bootstrap: ${writeResult.errorMsg}`,
      );
    }
  }

  let rowsChanged = false;
  const typeIDs = new Set(rows.map((entry) => entry.typeID));
  for (const typeID of REQUIRED_NON_CATEGORY_STRUCTURE_TYPE_IDS) {
    if (typeIDs.has(typeID)) {
      continue;
    }
    rows.push(normalizeStructureTypeRecord({ typeID }));
    typeIDs.add(typeID);
    rowsChanged = true;
  }
  if (rowsChanged) {
    rows.sort((left, right) => left.typeID - right.typeID);
    const writeResult = writeTable(STRUCTURE_TYPES_TABLE, {
      _meta: {
        seedVersion: 2,
        generatedAt:
          payload &&
          payload._meta &&
          payload._meta.generatedAt
            ? String(payload._meta.generatedAt)
            : new Date().toISOString(),
      },
      structureTypes: rows,
    });
    if (!writeResult.success) {
      log.warn(
        `[StructureState] Failed to persist required sovereignty structure types: ${writeResult.errorMsg}`,
      );
    }
  }

  typeCache = {
    rows,
    byTypeID: new Map(rows.map((entry) => [entry.typeID, entry])),
  };
  return typeCache;
}

function getStructureTypeByID(typeID) {
  return ensureStructureTypes().byTypeID.get(toPositiveInt(typeID, 0)) || null;
}

function getStructureTypes() {
  return [...ensureStructureTypes().rows];
}

function normalizeStructureRecord(entry = {}) {
  const structureID = toPositiveInt(entry.structureID, 0);
  const typeID = toPositiveInt(entry.typeID, 0);
  const typeRecord = getStructureTypeByID(typeID) || normalizeStructureTypeRecord({ typeID });
  const system = getSolarSystemRecord(entry.solarSystemID);
  const reinforceWeekday = toInt(entry.reinforceWeekday, DEFAULT_REINFORCE_WEEKDAY);
  const reinforceHour = toInt(entry.reinforceHour, DEFAULT_REINFORCE_HOUR);

  return {
    structureID,
    typeID,
    name: String(entry.name || typeRecord.name || `Structure ${structureID}`),
    itemName: String(entry.itemName || entry.name || typeRecord.name || `Structure ${structureID}`),
    ownerCorpID: toPositiveInt(entry.ownerCorpID || entry.ownerID, 1),
    ownerID: toPositiveInt(entry.ownerCorpID || entry.ownerID, 1),
    allianceID: toPositiveInt(entry.allianceID, 0) || null,
    solarSystemID: toPositiveInt(entry.solarSystemID, toPositiveInt(system && system.solarSystemID, 30000142)),
    constellationID: toPositiveInt(entry.constellationID, toPositiveInt(system && system.constellationID, 20000020)),
    regionID: toPositiveInt(entry.regionID, toPositiveInt(system && system.regionID, 10000002)),
    position: normalizePosition(entry.position),
    rotation: normalizeRotation(entry.rotation),
    radius: Math.max(DEFAULT_STRUCTURE_RADIUS, toFloat(entry.radius, typeRecord.radius)),
    structureFamily: typeRecord.structureFamily,
    structureSize: typeRecord.structureSize,
    state: STRUCTURE_STATE_NAME_BY_ID[toInt(entry.state, -1)]
      ? toInt(entry.state, STRUCTURE_STATE.UNANCHORED)
      : STRUCTURE_STATE.UNANCHORED,
    stateStartedAt: Number.isFinite(Number(entry.stateStartedAt)) ? toInt(entry.stateStartedAt, 0) : null,
    stateEndsAt: Number.isFinite(Number(entry.stateEndsAt)) ? toInt(entry.stateEndsAt, 0) : null,
    upkeepState: STRUCTURE_UPKEEP_NAME_BY_ID[toInt(entry.upkeepState, -1)]
      ? toInt(entry.upkeepState, STRUCTURE_UPKEEP_STATE.FULL_POWER)
      : STRUCTURE_UPKEEP_STATE.FULL_POWER,
    hasQuantumCore: entry.hasQuantumCore === true,
    quantumCoreItemTypeID: toPositiveInt(
      entry.quantumCoreItemTypeID,
      typeRecord.defaultQuantumCoreTypeID || 0,
    ) || null,
    reinforceWeekday,
    reinforceHour,
    nextReinforceWeekday: toInt(entry.nextReinforceWeekday, reinforceWeekday),
    nextReinforceHour: toInt(entry.nextReinforceHour, reinforceHour),
    nextReinforceApply:
      entry.nextReinforceApply === undefined || entry.nextReinforceApply === null
        ? null
        : toInt(entry.nextReinforceApply, 0),
    profileID: toPositiveInt(entry.profileID, 1),
    serviceStates: normalizeServiceStates(entry.serviceStates, typeID, typeRecord.structureFamily),
    fuelExpiresAt: Number.isFinite(Number(entry.fuelExpiresAt)) ? toInt(entry.fuelExpiresAt, 0) : null,
    assetSafetyMode: String(entry.assetSafetyMode || "enabled"),
    destroyedAt: Number.isFinite(Number(entry.destroyedAt)) ? toInt(entry.destroyedAt, 0) : null,
    wars: Array.isArray(entry.wars) ? entry.wars.map((warID) => toPositiveInt(warID, 0)).filter(Boolean) : [],
    unanchoring:
      entry.unanchoring === undefined || entry.unanchoring === null
        ? null
        : toInt(entry.unanchoring, 0),
    abandonAt:
      entry.abandonAt === undefined || entry.abandonAt === null
        ? null
        : toInt(entry.abandonAt, 0),
    liquidOzoneQty: Math.max(0, toInt(entry.liquidOzoneQty, 0)),
    devFlags: entry.devFlags && typeof entry.devFlags === "object" ? cloneValue(entry.devFlags) : {},
    accessProfile: normalizeAccessProfile(entry.accessProfile),
    conditionState: normalizeConditionState(entry.conditionState),
    shieldCapacity: Math.max(0, toFloat(entry.shieldCapacity, typeRecord.shieldCapacity)),
    armorHP: Math.max(0, toFloat(entry.armorHP, typeRecord.armorHP)),
    hullHP: Math.max(0, toFloat(entry.hullHP, typeRecord.hullHP)),
    capacitorCapacity: Math.max(0, toFloat(entry.capacitorCapacity, typeRecord.capacitorCapacity)),
    maxTargetRange: Math.max(0, toFloat(entry.maxTargetRange, typeRecord.maxTargetRange)),
    maxLockedTargets: Math.max(0, toFloat(entry.maxLockedTargets, typeRecord.maxLockedTargets)),
    tetheringRange: Math.max(DEFAULT_STRUCTURE_TETHER_RANGE, toFloat(entry.tetheringRange, typeRecord.tetheringRange) || DEFAULT_STRUCTURE_TETHER_RANGE),
    tetherRepairEffectMode:
      entry.tetherRepairEffectMode === undefined ||
      entry.tetherRepairEffectMode === null
        ? typeRecord.tetherRepairEffectMode || null
        : String(entry.tetherRepairEffectMode),
    damageCap: Math.max(0, toFloat(entry.damageCap, typeRecord.damageCap)),
    dockable: typeRecord.dockable === true,
    published: typeRecord.published !== false,
  };
}

function ensureStructureCache() {
  if (structureCache) {
    return structureCache;
  }

  const payload = readTable(STRUCTURES_TABLE, {
    _meta: {
      nextStructureID: NEXT_STRUCTURE_ID_START,
      generatedAt: null,
      lastUpdatedAt: null,
    },
    structures: [],
  });
  const rows = Array.isArray(payload.structures)
    ? payload.structures.map((entry) => normalizeStructureRecord(entry))
    : [];

  structureCache = {
    meta: {
      nextStructureID: Math.max(
        NEXT_STRUCTURE_ID_START,
        toPositiveInt(payload._meta && payload._meta.nextStructureID, NEXT_STRUCTURE_ID_START),
      ),
      generatedAt: payload._meta && payload._meta.generatedAt ? String(payload._meta.generatedAt) : null,
      lastUpdatedAt: payload._meta && payload._meta.lastUpdatedAt ? String(payload._meta.lastUpdatedAt) : null,
    },
    rows,
    byStructureID: new Map(rows.map((entry) => [entry.structureID, entry])),
  };
  return structureCache;
}

function persistStructures(rows, metaOverrides = {}) {
  const previousRows = ensureStructureCache().rows.map((entry) => cloneValue(entry));
  const normalizedRows = rows.map((entry) => normalizeStructureRecord(entry));
  const nextStructureID = Math.max(
    NEXT_STRUCTURE_ID_START,
    ...normalizedRows.map((entry) => toPositiveInt(entry && entry.structureID, 0) + 1),
    NEXT_STRUCTURE_ID_START,
  );
  const nextMeta = {
    ...(ensureStructureCache().meta || {}),
    nextStructureID,
    lastUpdatedAt: new Date().toISOString(),
    ...metaOverrides,
  };
  const writeResult = writeTable(STRUCTURES_TABLE, {
    _meta: nextMeta,
    structures: normalizedRows,
  });
  if (!writeResult.success) {
    return writeResult;
  }

  const cachedRows = normalizedRows.map((entry) => cloneValue(entry));
  structureCache = {
    meta: {
      ...nextMeta,
    },
    rows: cachedRows,
    byStructureID: new Map(cachedRows.map((entry) => [entry.structureID, entry])),
  };
  notifyStructureChangeListeners(previousRows, cachedRows);
  return writeResult;
}

function buildStructureChangeSystemIDs(previousRows = [], nextRows = []) {
  const previousByID = new Map(
    (Array.isArray(previousRows) ? previousRows : [])
      .map((entry) => [toPositiveInt(entry && entry.structureID, 0), entry])
      .filter(([structureID]) => structureID > 0),
  );
  const nextByID = new Map(
    (Array.isArray(nextRows) ? nextRows : [])
      .map((entry) => [toPositiveInt(entry && entry.structureID, 0), entry])
      .filter(([structureID]) => structureID > 0),
  );
  const changedSystemIDs = new Set();
  const structureIDs = new Set([
    ...previousByID.keys(),
    ...nextByID.keys(),
  ]);
  for (const structureID of structureIDs) {
    const previous = previousByID.get(structureID) || null;
    const next = nextByID.get(structureID) || null;
    if (JSON.stringify(previous) === JSON.stringify(next)) {
      continue;
    }
    const previousSystemID = toPositiveInt(previous && previous.solarSystemID, 0);
    const nextSystemID = toPositiveInt(next && next.solarSystemID, 0);
    if (previousSystemID > 0) {
      changedSystemIDs.add(previousSystemID);
    }
    if (nextSystemID > 0) {
      changedSystemIDs.add(nextSystemID);
    }
  }
  return [...changedSystemIDs];
}

function notifyStructureChangeListeners(previousRows = [], nextRows = []) {
  if (structureChangeListeners.size <= 0) {
    return;
  }
  const systemIDs = buildStructureChangeSystemIDs(previousRows, nextRows);
  if (systemIDs.length <= 0) {
    return;
  }
  const payload = {
    systemIDs,
    previousRows: previousRows.map((entry) => cloneValue(entry)),
    nextRows: nextRows.map((entry) => cloneValue(entry)),
  };
  for (const listener of structureChangeListeners) {
    try {
      listener(payload);
    } catch (error) {
      log.warn(`[StructureState] Structure change listener failed: ${error.message}`);
    }
  }
}

function registerStructureChangeListener(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }
  structureChangeListeners.add(listener);
  return () => {
    structureChangeListeners.delete(listener);
  };
}

function getStructureByID(structureID, options = {}) {
  if (options.refresh !== false) {
    tickStructures(Date.now());
  }
  return ensureStructureCache().byStructureID.get(toPositiveInt(structureID, 0)) || null;
}

function getStructureByName(name) {
  const normalized = String(name || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return listStructures({
    includeDestroyed: true,
    refresh: false,
  }).find((entry) => String(entry.name || "").trim().toLowerCase() === normalized) || null;
}

function listStructures(options = {}) {
  if (options.refresh !== false) {
    tickStructures(Date.now());
  }
  const includeDestroyed = options.includeDestroyed === true;
  return ensureStructureCache().rows
    .filter((entry) => includeDestroyed || !entry.destroyedAt)
    .map((entry) => cloneValue(entry));
}

function listStructuresForSystem(solarSystemID, options = {}) {
  const numericSystemID = toPositiveInt(solarSystemID, 0);
  if (!numericSystemID) {
    return [];
  }
  return listStructures(options).filter((entry) => entry.solarSystemID === numericSystemID);
}

function listOwnedStructures(ownerCorpID, options = {}) {
  const numericOwnerCorpID = toPositiveInt(ownerCorpID, 0);
  if (!numericOwnerCorpID) {
    return [];
  }
  return listStructures(options).filter((entry) => entry.ownerCorpID === numericOwnerCorpID);
}

function updateStructureRecord(structureID, updater) {
  const targetID = toPositiveInt(structureID, 0);
  if (!targetID || typeof updater !== "function") {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }

  const rows = listStructures({
    includeDestroyed: true,
    refresh: false,
  });
  const current = rows.find((entry) => entry.structureID === targetID);
  if (!current) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }

  const next = normalizeStructureRecord(updater(cloneValue(current)) || current);
  if (shouldCancelUnanchoringForState(next)) {
    next.unanchoring = null;
  }
  const writeResult = persistStructures(
    rows.map((entry) => (entry.structureID === targetID ? next : entry)),
  );
  if (!writeResult.success) {
    return writeResult;
  }

  return {
    success: true,
    data: next,
  };
}

function createStructure(record) {
  const cache = ensureStructureCache();
  const structureID = Math.max(NEXT_STRUCTURE_ID_START, cache.meta.nextStructureID || NEXT_STRUCTURE_ID_START);
  const next = normalizeStructureRecord({
    ...record,
    structureID,
  });
  const writeResult = persistStructures([...cache.rows, next], {
    nextStructureID: structureID + 1,
  });
  if (!writeResult.success) {
    return writeResult;
  }

  return {
    success: true,
    data: next,
  };
}

function upsertStructureRecord(record) {
  const next = normalizeStructureRecord(record || {});
  const structureID = toPositiveInt(next && next.structureID, 0);
  if (!structureID) {
    return createStructure(record);
  }

  const cache = ensureStructureCache();
  const rows = cache.rows.map((entry) => cloneValue(entry));
  const index = rows.findIndex((entry) => entry.structureID === structureID);
  if (index >= 0) {
    rows[index] = next;
  } else {
    rows.push(next);
  }

  const writeResult = persistStructures(rows, {
    nextStructureID: Math.max(
      NEXT_STRUCTURE_ID_START,
      cache.meta && cache.meta.nextStructureID ? cache.meta.nextStructureID : NEXT_STRUCTURE_ID_START,
      structureID + 1,
    ),
  });
  if (!writeResult.success) {
    return writeResult;
  }

  return {
    success: true,
    data: next,
  };
}

function setStructureState(structureID, stateNameOrID, options = {}) {
  const numericState =
    typeof stateNameOrID === "string"
      ? (
          Number.isFinite(Number(String(stateNameOrID).trim()))
            ? toInt(stateNameOrID, 0)
            : STRUCTURE_STATE_ID_BY_NAME[String(stateNameOrID).trim().toLowerCase()] || 0
        )
      : toInt(stateNameOrID, 0);
  if (!STRUCTURE_STATE_NAME_BY_ID[numericState]) {
    return {
      success: false,
      errorMsg: "INVALID_STRUCTURE_STATE",
    };
  }
  const nowMs = toInt(options.nowMs, Date.now());
  return updateStructureRecord(structureID, (current) => ({
    ...current,
    state: numericState,
    stateStartedAt: nowMs,
    stateEndsAt:
      options.clearTimer === true
        ? null
        : Number.isFinite(Number(options.stateEndsAt))
        ? toInt(options.stateEndsAt, 0)
        : current.stateEndsAt,
  }));
}

function setStructureStateTimerRemaining(structureID, seconds, options = {}) {
  const remainingMs = Math.max(0, Math.round(Math.max(0, toFloat(seconds, 0)) * 1000));
  const nowMs = toInt(options.nowMs, Date.now());
  return updateStructureRecord(structureID, (current) => ({
    ...current,
    stateStartedAt: nowMs,
    stateEndsAt: nowMs + remainingMs,
  }));
}

function setStructureDeployTimerRemaining(structureID, seconds, options = {}) {
  const remainingMs = Math.max(0, Math.round(Math.max(0, toFloat(seconds, 0)) * 1000));
  const nowMs = toInt(options.nowMs, Date.now());
  return updateStructureRecord(structureID, (current) => ({
    ...current,
    state: STRUCTURE_STATE.DEPLOY_VULNERABLE,
    stateStartedAt: nowMs,
    stateEndsAt: nowMs + remainingMs,
  }));
}

function setStructureUnanchoringRemaining(structureID, seconds, options = {}) {
  const current = getStructureByID(structureID, { refresh: false });
  if (!current) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }
  if (STRUCTURE_UNANCHOR_CANCEL_STATES.has(toInt(current.state, 0))) {
    return {
      success: false,
      errorMsg: "STRUCTURE_CANNOT_UNANCHOR_IN_STATE",
    };
  }
  const remainingMs = Math.max(0, Math.round(Math.max(0, toFloat(seconds, 0)) * 1000));
  const nowMs = toInt(options.nowMs, Date.now());
  return updateStructureRecord(structureID, (record) => ({
    ...record,
    unanchoring: nowMs + remainingMs,
  }));
}

function setStructureAbandonTimerRemaining(structureID, seconds, options = {}) {
  const current = getStructureByID(structureID, { refresh: false });
  if (!current) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }
  if (toInt(current.upkeepState, 0) !== STRUCTURE_UPKEEP_STATE.LOW_POWER) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_LOW_POWER",
    };
  }
  const remainingMs = Math.max(0, Math.round(Math.max(0, toFloat(seconds, 0)) * 1000));
  const nowMs = toInt(options.nowMs, Date.now());
  return updateStructureRecord(structureID, (record) => ({
    ...record,
    abandonAt: nowMs + remainingMs,
  }));
}

function hasStructureGmBypass(session) {
  if (!session) {
    return false;
  }
  if (config.upwellGmBypassRestrictions === true) {
    return true;
  }
  const role = normalizeRoleValue(session && session.role, 0n);
  return role > 0n && (role & GM_BYPASS_ROLE_MASK) !== 0n;
}

function buildDockAccessPolicy(structure, policyName, session) {
  const profile = structure && structure.accessProfile ? structure.accessProfile : normalizeAccessProfile(null);
  const policy = String(profile[policyName] || "public");
  if (policy === "public") {
    return true;
  }
  if (policy === "none") {
    return false;
  }
  const corpID = toPositiveInt(session && (session.corporationID || session.corpid), 0);
  const allianceID = toPositiveInt(session && (session.allianceID || session.allianceid), 0);
  if (policy === "owner" || policy === "corp") {
    return corpID > 0 && corpID === toPositiveInt(structure && structure.ownerCorpID, 0);
  }
  if (policy === "alliance") {
    const ownerAllianceID = toPositiveInt(structure && structure.allianceID, 0);
    return ownerAllianceID > 0
      ? ownerAllianceID === allianceID
      : corpID > 0 && corpID === toPositiveInt(structure && structure.ownerCorpID, 0);
  }
  return false;
}

function isDockingServiceOnline(structure) {
  if (!structure || !structure.dockable || structure.destroyedAt || structure.unanchoring) {
    return false;
  }
  if (STRUCTURE_DISABLED_STATES.has(toInt(structure.state, 0))) {
    return false;
  }
  return toInt(
    structure.serviceStates &&
      structure.serviceStates[String(STRUCTURE_SERVICE_ID.DOCKING)],
    STRUCTURE_SERVICE_STATE.OFFLINE,
  ) === STRUCTURE_SERVICE_STATE.ONLINE;
}

function isStructureTetheringAllowed(structure, session) {
  return Boolean(
    structure &&
      !structure.destroyedAt &&
      structure.hasQuantumCore === true &&
      toInt(structure.upkeepState, 0) !== STRUCTURE_UPKEEP_STATE.ABANDONED &&
      STRUCTURE_TETHER_ENABLED_STATES.has(toInt(structure.state, 0)) &&
      buildDockAccessPolicy(structure, "tethering", session),
  );
}

function getShipDockClass(shipTypeID) {
  const metadata =
    resolveShipByTypeID(toPositiveInt(shipTypeID, 0)) ||
    resolveItemByTypeID(toPositiveInt(shipTypeID, 0)) ||
    null;
  const haystack = [
    String(metadata && metadata.groupName || ""),
    String(metadata && metadata.name || ""),
  ].join(" ").toLowerCase();
  if (haystack.includes("titan") || haystack.includes("supercarrier")) {
    return "supercapital";
  }
  if (
    haystack.includes("carrier") ||
    haystack.includes("dreadnought") ||
    haystack.includes("force auxiliary") ||
    haystack.includes("capital industrial")
  ) {
    return "capital";
  }
  return "subcapital";
}

function canShipTypeDockAtStructure(shipTypeID, structure) {
  const typeRecord = getStructureTypeByID(structure && structure.typeID);
  if (!typeRecord || !typeRecord.dockable) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_DOCKABLE",
    };
  }

  const shipClass = getShipDockClass(shipTypeID);
  if (
    typeRecord.structureSize === STRUCTURE_SIZE.MEDIUM &&
    (shipClass === "capital" || shipClass === "supercapital")
  ) {
    return {
      success: false,
      errorMsg: "SHIP_TOO_LARGE_FOR_STRUCTURE",
    };
  }
  if (typeRecord.structureSize === STRUCTURE_SIZE.LARGE && shipClass === "supercapital") {
    return {
      success: false,
      errorMsg: "SHIP_TOO_LARGE_FOR_STRUCTURE",
    };
  }

  if (typeRecord.typeID === 35836) {
    const metadata =
      resolveShipByTypeID(toPositiveInt(shipTypeID, 0)) ||
      resolveItemByTypeID(toPositiveInt(shipTypeID, 0)) ||
      null;
    const groupName = String(metadata && metadata.groupName || "").toLowerCase();
    if (TATARA_EXCLUDED_DOCK_GROUP_NAMES.some((entry) => groupName.includes(entry))) {
      return {
        success: false,
        errorMsg: "SHIP_EXCLUDED_FROM_STRUCTURE",
      };
    }
  }

  return {
    success: true,
    data: {
      shipClass,
      oneWayUndock: (typeRecord.oneWayUndockClasses || []).includes(shipClass),
    },
  };
}

function hasStructureOneWayUndockRestriction(structure, shipTypeID) {
  const typeRecord = getStructureTypeByID(structure && structure.typeID);
  if (!typeRecord) {
    return false;
  }
  return (typeRecord.oneWayUndockClasses || []).includes(getShipDockClass(shipTypeID));
}

function canCharacterDockAtStructure(session, structure, options = {}) {
  if (!structure) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }
  if (hasStructureGmBypass(session) || options.ignoreRestrictions === true) {
    return { success: true, data: { bypassed: true } };
  }
  if (!isDockingServiceOnline(structure)) {
    return {
      success: false,
      errorMsg: "STRUCTURE_DOCKING_UNAVAILABLE",
    };
  }
  if (!buildDockAccessPolicy(structure, "docking", session)) {
    return {
      success: false,
      errorMsg: "STRUCTURE_DOCKING_DENIED",
    };
  }
  const shipTypeID = toPositiveInt(options.shipTypeID || (session && session.shipTypeID), 0);
  return shipTypeID > 0 ? canShipTypeDockAtStructure(shipTypeID, structure) : { success: true };
}

function resolveSecurityBand(structure) {
  const system = getSolarSystemRecord(structure && structure.solarSystemID);
  return toFloat(system && system.security, 0) >= 0.45 ? "high" : "low";
}

function getTimerScale(structure) {
  const structureScale = toFloat(structure && structure.devFlags && structure.devFlags.timerScale, 0);
  if (structureScale > 0) {
    return structureScale;
  }
  const configScale = toFloat(config.upwellTimerScale, 0);
  return configScale > 0 ? configScale : 1;
}

function scaledTimerMs(seconds, structure) {
  return Math.max(0, Math.round(Math.max(0, toFloat(seconds, 0)) * getTimerScale(structure) * 1000));
}

function resolveStructureUnanchoringSeconds(structure) {
  const typeID = toPositiveInt(structure && structure.typeID, 0);
  const typeRecord = getStructureTypeByID(typeID);
  const groupID = toPositiveInt(
    typeRecord && typeRecord.groupID,
    toPositiveInt(structure && structure.groupID, 0),
  );
  const family = String(
    (typeRecord && typeRecord.structureFamily) ||
    (structure && structure.structureFamily) ||
    "",
  ).trim().toLowerCase();

  if (groupID === STRUCTURE_GROUP_ID.METENOX || typeID === 81826) {
    return STRUCTURE_TIMER_SECONDS.METENOX_UNANCHORING;
  }
  if (family === STRUCTURE_FAMILY.FLEX) {
    return STRUCTURE_TIMER_SECONDS.FLEX_UNANCHORING;
  }
  return STRUCTURE_TIMER_SECONDS.UNANCHORING;
}

function shouldCancelUnanchoringForState(structure) {
  return Boolean(
    structure &&
    structure.unanchoring &&
    STRUCTURE_UNANCHOR_CANCEL_STATES.has(toInt(structure.state, 0)),
  );
}

function repairStructureState(structure, preserveState = false) {
  return {
    ...structure,
    state: preserveState ? structure.state : STRUCTURE_STATE.SHIELD_VULNERABLE,
    stateStartedAt: Date.now(),
    stateEndsAt: preserveState ? structure.stateEndsAt : null,
    conditionState: normalizeConditionState({
      damage: 0,
      charge: structure.conditionState && structure.conditionState.charge,
      armorDamage: 0,
      shieldCharge: 1,
    }),
  };
}

function buildOnliningVulnerableStructure(structure, nowMs) {
  const hasCore = structure && structure.hasQuantumCore === true;
  return {
    ...structure,
    state: STRUCTURE_STATE.ONLINING_VULNERABLE,
    stateStartedAt: nowMs,
    stateEndsAt: hasCore
      ? nowMs + scaledTimerMs(
        STRUCTURE_REPAIR_SECONDS_BY_STATE[STRUCTURE_STATE.ONLINING_VULNERABLE],
        structure,
      )
      : null,
  };
}

function maybeAdvanceStructureState(structure, nowMs = Date.now()) {
  const stateEndsAt = Number(structure && structure.stateEndsAt);
  if (
    structure &&
    !structure.destroyedAt &&
    structure.state === STRUCTURE_STATE.ANCHORING &&
    (
      structure.stateEndsAt === null ||
      structure.stateEndsAt === undefined ||
      !Number.isFinite(stateEndsAt) ||
      stateEndsAt <= 0
    )
  ) {
    return {
      structure: buildOnliningVulnerableStructure(structure, nowMs),
      changed: true,
    };
  }
  if (
    !structure ||
    structure.destroyedAt ||
    structure.stateEndsAt === null ||
    structure.stateEndsAt === undefined ||
    !Number.isFinite(stateEndsAt) ||
    stateEndsAt <= 0 ||
    nowMs < stateEndsAt
  ) {
    return { structure, changed: false };
  }
  if (structure.state === STRUCTURE_STATE.ANCHOR_VULNERABLE) {
    return {
      structure: {
        ...structure,
        state: STRUCTURE_STATE.ANCHORING,
        stateStartedAt: nowMs,
        stateEndsAt: nowMs + scaledTimerMs(STRUCTURE_TIMER_SECONDS.ANCHORING, structure),
      },
      changed: true,
    };
  }
  if (structure.state === STRUCTURE_STATE.ANCHORING) {
    return {
      structure: buildOnliningVulnerableStructure(structure, nowMs),
      changed: true,
    };
  }
  if (structure.state === STRUCTURE_STATE.ONLINING_VULNERABLE) {
    if (structure.hasQuantumCore !== true) {
      return {
        structure: {
          ...structure,
          stateEndsAt: null,
        },
        changed: structure.stateEndsAt !== null && structure.stateEndsAt !== undefined,
      };
    }
    return {
      structure: {
        ...repairStructureState(structure),
        state: STRUCTURE_STATE.SHIELD_VULNERABLE,
        stateStartedAt: nowMs,
        stateEndsAt: null,
      },
      changed: true,
    };
  }
  if (structure.state === STRUCTURE_STATE.ARMOR_REINFORCE || structure.state === STRUCTURE_STATE.HULL_REINFORCE) {
    const nextState =
      structure.state === STRUCTURE_STATE.ARMOR_REINFORCE
        ? STRUCTURE_STATE.ARMOR_VULNERABLE
        : STRUCTURE_STATE.HULL_VULNERABLE;
    return {
      structure: {
        ...structure,
        state: nextState,
        stateStartedAt: nowMs,
        stateEndsAt: nowMs + scaledTimerMs(
          STRUCTURE_REPAIR_SECONDS_BY_STATE[nextState],
          structure,
        ),
      },
      changed: true,
    };
  }
  if (STRUCTURE_VULNERABLE_STATES.has(structure.state)) {
    return {
      structure: {
        ...repairStructureState(structure),
        stateStartedAt: nowMs,
        stateEndsAt: null,
      },
      changed: true,
    };
  }
  return { structure, changed: false };
}

function tickStructures(nowMs = Date.now()) {
  const cache = ensureStructureCache();
  const nextRows = [];
  let changed = false;
  for (const structure of cache.rows) {
    let current = cloneValue(structure);
    if (shouldCancelUnanchoringForState(current)) {
      current.unanchoring = null;
      changed = true;
    }
    if (
      current.abandonAt &&
      Number.isFinite(Number(current.abandonAt)) &&
      Number(current.abandonAt) > 0
    ) {
      if (toInt(current.upkeepState, 0) !== STRUCTURE_UPKEEP_STATE.LOW_POWER) {
        current.abandonAt = null;
        changed = true;
      } else if (nowMs >= Number(current.abandonAt)) {
        current.upkeepState = STRUCTURE_UPKEEP_STATE.ABANDONED;
        current.abandonAt = null;
        changed = true;
      }
    }
    if (
      current.unanchoring &&
      Number.isFinite(Number(current.unanchoring)) &&
      Number(current.unanchoring) > 0 &&
      nowMs >= Number(current.unanchoring)
    ) {
      const recoveryResult = structureDockedRecoveryState.evacuateDockedCharactersFromStructure(
        current,
        { nowMs: toInt(nowMs, Date.now()) },
      );
      if (!recoveryResult.success) {
        nextRows.push(current);
        log.warn(
          `[StructureState] Failed to finalize unanchoring for ${current.structureID}: ${recoveryResult.errorMsg}`,
        );
        continue;
      }

      const remainingTopLevelItems = listTopLevelItemsInStructure(current.structureID);
      if (remainingTopLevelItems.length > 0) {
        nextRows.push(current);
        log.warn(
          `[StructureState] Delaying unanchoring completion for ${current.structureID}: structure still has ${remainingTopLevelItems.length} top-level item(s)`,
        );
        continue;
      }

      changed = true;
      continue;
    }

    const next = maybeAdvanceStructureState(current, nowMs);
    nextRows.push(next.structure);
    changed = changed || next.changed;
  }
  if (changed) {
    const writeResult = persistStructures(nextRows);
    if (!writeResult.success) {
      log.warn(`[StructureState] Failed to persist timer tick: ${writeResult.errorMsg}`);
    }
  }
  return listStructures({
    includeDestroyed: true,
    refresh: false,
  });
}

function seedStructureForSession(session, typeToken, options = {}) {
  const typeMap = {
    astrahus: 35832,
    fortizar: 35833,
    keepstar: 35834,
    palatine: 40340,
    raitaru: 35825,
    azbel: 35826,
    sotiyo: 35827,
    athanor: 35835,
    tatara: 35836,
  };
  const typeID = typeMap[String(typeToken || "").trim().toLowerCase()] || toPositiveInt(typeToken, 0);
  const typeRecord = getStructureTypeByID(typeID);
  if (!typeRecord) {
    return {
      success: false,
      errorMsg: "STRUCTURE_TYPE_NOT_FOUND",
    };
  }

  return createStructure({
      typeID,
      name: options.name || typeRecord.name,
      itemName: options.itemName || options.name || typeRecord.name,
      ownerCorpID: toPositiveInt(options.ownerCorpID || (session && (session.corporationID || session.corpid)), 1000009),
      allianceID: toPositiveInt(options.allianceID || (session && (session.allianceID || session.allianceid)), 0) || null,
      solarSystemID: toPositiveInt(options.solarSystemID || (session && (session.solarsystemid2 || session.solarsystemid)), 30000142),
      position: normalizePosition(options.position, { x: 100000, y: 0, z: 100000 }),
      rotation: normalizeRotation(options.rotation),
      state: STRUCTURE_STATE.UNANCHORED,
      upkeepState: STRUCTURE_UPKEEP_STATE.FULL_POWER,
      hasQuantumCore: false,
      quantumCoreItemTypeID: typeRecord.defaultQuantumCoreTypeID,
      profileID: toPositiveInt(options.profileID, 1),
      reinforceWeekday: toInt(options.reinforceWeekday, DEFAULT_REINFORCE_WEEKDAY),
      reinforceHour: toInt(options.reinforceHour, DEFAULT_REINFORCE_HOUR),
      devFlags: {
        seeded: true,
        ...(options.devFlags || {}),
      },
    });
}

function startAnchoring(structureID, nowMs = Date.now()) {
  return updateStructureRecord(structureID, (current) => ({
    ...current,
    state: STRUCTURE_STATE.ANCHOR_VULNERABLE,
    stateStartedAt: nowMs,
    stateEndsAt: nowMs + scaledTimerMs(
      STRUCTURE_REPAIR_SECONDS_BY_STATE[STRUCTURE_STATE.ANCHOR_VULNERABLE],
      current,
    ),
    destroyedAt: null,
    conditionState: normalizeConditionState({
      damage: 0,
      armorDamage: 0,
      shieldCharge: 0,
    }),
  }));
}

function startStructureUnanchoring(structureID, nowMs = Date.now()) {
  const current = getStructureByID(structureID, { refresh: false });
  if (!current) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }
  if (current.destroyedAt) {
    return {
      success: false,
      errorMsg: "STRUCTURE_DESTROYED",
    };
  }
  if (STRUCTURE_UNANCHOR_CANCEL_STATES.has(toInt(current.state, 0))) {
    return {
      success: false,
      errorMsg: "STRUCTURE_CANNOT_UNANCHOR_IN_STATE",
    };
  }
  if (
    current.unanchoring &&
    Number.isFinite(Number(current.unanchoring)) &&
    Number(current.unanchoring) > nowMs
  ) {
    return {
      success: true,
      data: current,
    };
  }

  return updateStructureRecord(structureID, (record) => ({
    ...record,
    unanchoring: nowMs + scaledTimerMs(
      resolveStructureUnanchoringSeconds(record),
      record,
    ),
  }));
}

function cancelStructureUnanchoring(structureID) {
  const current = getStructureByID(structureID, { refresh: false });
  if (!current) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }
  if (!current.unanchoring) {
    return {
      success: true,
      data: {
        ...current,
        cancelled: false,
      },
    };
  }

  const updateResult = updateStructureRecord(structureID, (record) => ({
    ...record,
    unanchoring: null,
  }));
  if (!updateResult.success) {
    return updateResult;
  }

  return {
    success: true,
    data: {
      ...updateResult.data,
      cancelled: true,
    },
  };
}

function setStructureQuantumCoreInstalled(structureID, installed, nowMs = Date.now()) {
  const hasActiveTimer =
    (current) => (
      current &&
      current.stateEndsAt !== null &&
      current.stateEndsAt !== undefined &&
      Number.isFinite(Number(current.stateEndsAt)) &&
      Number(current.stateEndsAt) > 0
    );
  return updateStructureRecord(structureID, (current) => {
    const shouldStartOnliningRepair =
      installed === true &&
      !hasActiveTimer(current) &&
      (
        current.state === STRUCTURE_STATE.ANCHORING ||
        current.state === STRUCTURE_STATE.ONLINING_VULNERABLE
      );
    return {
      ...current,
      hasQuantumCore: installed === true,
      state: shouldStartOnliningRepair
        ? STRUCTURE_STATE.ONLINING_VULNERABLE
        : current.state,
      stateStartedAt: shouldStartOnliningRepair
        ? nowMs
        : current.stateStartedAt,
      stateEndsAt: shouldStartOnliningRepair
        ? nowMs + scaledTimerMs(
          STRUCTURE_REPAIR_SECONDS_BY_STATE[STRUCTURE_STATE.ONLINING_VULNERABLE],
          current,
        )
        : installed !== true && current.state === STRUCTURE_STATE.ONLINING_VULNERABLE
          ? null
          : current.stateEndsAt,
    };
  });
}

function setStructureUpkeepState(structureID, upkeepState) {
  const numericUpkeepState =
    typeof upkeepState === "string"
      ? STRUCTURE_UPKEEP_ID_BY_NAME[String(upkeepState).trim().toLowerCase()] || 0
      : toInt(upkeepState, 0);
  if (!STRUCTURE_UPKEEP_NAME_BY_ID[numericUpkeepState]) {
    return {
      success: false,
      errorMsg: "INVALID_UPKEEP_STATE",
    };
  }
  return updateStructureRecord(structureID, (current) => ({
    ...current,
    upkeepState: numericUpkeepState,
  }));
}

function setStructureServiceState(structureID, serviceID, serviceState) {
  const numericServiceID = toPositiveInt(serviceID, 0);
  if (!numericServiceID) {
    return {
      success: false,
      errorMsg: "INVALID_SERVICE_ID",
    };
  }
  return updateStructureRecord(structureID, (current) => ({
    ...current,
    serviceStates: {
      ...(current.serviceStates || {}),
      [String(numericServiceID)]:
        toInt(serviceState, STRUCTURE_SERVICE_STATE.OFFLINE) === STRUCTURE_SERVICE_STATE.ONLINE
          ? STRUCTURE_SERVICE_STATE.ONLINE
          : STRUCTURE_SERVICE_STATE.OFFLINE,
    },
  }));
}

function repairStructure(structureID) {
  return updateStructureRecord(structureID, (current) => repairStructureState({
    ...current,
    stateEndsAt: null,
  }));
}

function fastForwardStructure(structureID, seconds) {
  const deltaMs = Math.max(0, Math.round(Math.max(0, toFloat(seconds, 0)) * 1000));
  return updateStructureRecord(structureID, (current) => ({
    ...current,
    stateStartedAt: Number.isFinite(Number(current.stateStartedAt))
      ? toInt(current.stateStartedAt, 0) - deltaMs
      : current.stateStartedAt,
    stateEndsAt: Number.isFinite(Number(current.stateEndsAt))
      ? toInt(current.stateEndsAt, 0) - deltaMs
      : current.stateEndsAt,
  }));
}

function setStructureTimerScale(structureID, timerScale) {
  const normalizedScale = toFloat(timerScale, 0);
  if (!(normalizedScale > 0)) {
    return {
      success: false,
      errorMsg: "INVALID_TIMER_SCALE",
    };
  }

  return updateStructureRecord(structureID, (current) => ({
    ...current,
    devFlags: {
      ...(current.devFlags || {}),
      timerScale: normalizedScale,
    },
  }));
}

function removeStructure(structureID, options = {}) {
  const targetID = toPositiveInt(structureID, 0);
  if (!targetID) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }

  const rows = listStructures({
    includeDestroyed: true,
    refresh: false,
  });
  const existing = rows.find((entry) => entry.structureID === targetID);
  if (!existing) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }

  const recoveryResult = structureDockedRecoveryState.evacuateDockedCharactersFromStructure(
    existing,
    {
      nowMs: toInt(options.nowMs, Date.now()),
    },
  );
  if (!recoveryResult.success) {
    return recoveryResult;
  }

  const remainingTopLevelItems = listTopLevelItemsInStructure(targetID);
  if (remainingTopLevelItems.length > 0) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_EMPTY",
    };
  }

  const writeResult = persistStructures(
    rows.filter((entry) => entry.structureID !== targetID),
  );
  if (!writeResult.success) {
    return writeResult;
  }

  return {
    success: true,
    data: existing,
  };
}

function destroyStructure(structureID, options = {}) {
  const nowMs = toInt(options.nowMs, Date.now());
  const current = getStructureByID(structureID, { refresh: false });
  if (!current) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }

  let assetSafetyResult = null;
  let recoveryResult = null;
  let lootResult = null;
  if (!current.destroyedAt) {
    recoveryResult = structureDockedRecoveryState.evacuateDockedCharactersFromStructure(
      current,
      {
        nowMs,
      },
    );
  }

  let assetSafetyDisabled = false;
  if (options.skipAssetSafety !== true && !current.destroyedAt) {
    assetSafetyResult = structureAssetSafetyState.handleStructureDestroyed(
      current,
      {
        nowMs,
        session: options.session,
      },
    );
    if (assetSafetyResult && !assetSafetyResult.success) {
      if (assetSafetyResult.errorMsg === "ASSET_SAFETY_DISABLED") {
        assetSafetyDisabled = true;
      }
      log.warn(
        `[StructureState] Asset safety handoff failed for structure ${current.structureID}: ${assetSafetyResult.errorMsg}`,
      );
    }
  }
  if (!current.destroyedAt) {
    lootResult = structureDestructionLootState.handleStructureDestroyedLoot(
      current,
      {
        nowMs,
        includeStructureContents: assetSafetyDisabled,
        includeQuantumCore: true,
      },
    );
  }

  const updateResult = updateStructureRecord(structureID, (currentStructure) => ({
    ...currentStructure,
    destroyedAt: nowMs,
    stateEndsAt: null,
    hasQuantumCore: false,
    serviceStates: Object.fromEntries(
      Object.keys(currentStructure.serviceStates || {}).map((serviceID) => [
        String(serviceID),
        STRUCTURE_SERVICE_STATE.OFFLINE,
      ]),
    ),
  }));
  if (!updateResult.success) {
    return updateResult;
  }

  return {
    success: true,
    data: {
      ...updateResult.data,
      assetSafety:
        assetSafetyResult && assetSafetyResult.success && assetSafetyResult.data
          ? assetSafetyResult.data
          : null,
      dockedRecovery:
        recoveryResult && recoveryResult.success && recoveryResult.data
          ? recoveryResult.data
          : null,
      loot:
        lootResult && lootResult.success && lootResult.data
          ? lootResult.data
          : null,
    },
  };
}

function applyStructureDamageTransition(structure, damageResult, nowMs = Date.now()) {
  if (!structure || !damageResult || !damageResult.success || !damageResult.data) {
    return { structure, preventDestroy: false, destroy: false, changed: false };
  }

  const next = normalizeStructureRecord({
    ...structure,
    conditionState: damageResult.data.afterConditionState,
  });
  const before = damageResult.data.beforeLayers || {};
  const after = damageResult.data.afterLayers || {};
  const shieldBroke = Number(before.shield || 0) > 0 && Number(after.shield || 0) <= 1e-9;
  const armorBroke = Number(before.armor || 0) > 0 && Number(after.armor || 0) <= 1e-9;
  const destroyed = damageResult.data.destroyed === true;

  if (next.upkeepState === STRUCTURE_UPKEEP_STATE.ABANDONED) {
    return { structure: next, preventDestroy: false, destroy: destroyed, changed: true };
  }

  if (next.state === STRUCTURE_STATE.SHIELD_VULNERABLE && shieldBroke) {
    const reinforceState =
      next.structureSize === STRUCTURE_SIZE.MEDIUM ||
      next.upkeepState === STRUCTURE_UPKEEP_STATE.FULL_POWER
        ? STRUCTURE_STATE.ARMOR_REINFORCE
        : STRUCTURE_STATE.HULL_REINFORCE;
    return {
      structure: {
        ...next,
        state: reinforceState,
        stateStartedAt: nowMs,
        stateEndsAt: nowMs + scaledTimerMs(
          reinforceState === STRUCTURE_STATE.ARMOR_REINFORCE
            ? resolveSecurityBand(next) === "high"
              ? STRUCTURE_TIMER_SECONDS.ARMOR_REINFORCE_HIGH
              : next.structureSize === STRUCTURE_SIZE.MEDIUM
              ? STRUCTURE_TIMER_SECONDS.ARMOR_REINFORCE_NULL_LOW
              : STRUCTURE_TIMER_SECONDS.ARMOR_REINFORCE_DEFAULT
            : resolveSecurityBand(next) === "high"
            ? STRUCTURE_TIMER_SECONDS.HULL_REINFORCE_HIGH
            : STRUCTURE_TIMER_SECONDS.HULL_REINFORCE_NULL_LOW,
          next,
        ),
        conditionState: normalizeConditionState(
          reinforceState === STRUCTURE_STATE.ARMOR_REINFORCE
            ? { damage: 0, armorDamage: 0, shieldCharge: 0 }
            : { damage: 0, armorDamage: 1, shieldCharge: 0 },
        ),
      },
      preventDestroy: true,
      destroy: false,
      changed: true,
    };
  }

  if (next.state === STRUCTURE_STATE.ARMOR_VULNERABLE && armorBroke) {
    if (
      (next.structureSize === STRUCTURE_SIZE.LARGE || next.structureSize === STRUCTURE_SIZE.EXTRA_LARGE) &&
      next.upkeepState === STRUCTURE_UPKEEP_STATE.FULL_POWER
    ) {
      return {
        structure: {
          ...next,
          state: STRUCTURE_STATE.HULL_REINFORCE,
          stateStartedAt: nowMs,
          stateEndsAt: nowMs + scaledTimerMs(
            resolveSecurityBand(next) === "high"
              ? STRUCTURE_TIMER_SECONDS.HULL_REINFORCE_HIGH
              : STRUCTURE_TIMER_SECONDS.HULL_REINFORCE_NULL_LOW,
            next,
          ),
          conditionState: normalizeConditionState({ damage: 0, armorDamage: 1, shieldCharge: 0 }),
        },
        preventDestroy: true,
        destroy: false,
        changed: true,
      };
    }

    return {
      structure: {
        ...next,
        state: STRUCTURE_STATE.HULL_VULNERABLE,
        stateStartedAt: nowMs,
        stateEndsAt: nowMs + scaledTimerMs(
          STRUCTURE_REPAIR_SECONDS_BY_STATE[STRUCTURE_STATE.HULL_VULNERABLE],
          next,
        ),
      },
      preventDestroy: false,
      destroy: destroyed,
      changed: true,
    };
  }

  return {
    structure: next,
    preventDestroy: false,
    destroy: destroyed,
    changed: true,
  };
}

function applyRuntimeStructureDamage(structureID, damageResult, nowMs = Date.now()) {
  const structure = getStructureByID(structureID, { refresh: false });
  if (!structure) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }
  const transition = applyStructureDamageTransition(structure, damageResult, nowMs);
  const updateResult = updateStructureRecord(structureID, () => transition.structure);
  if (!updateResult.success) {
    return updateResult;
  }
  return {
    success: true,
    data: {
      structure: updateResult.data,
      preventDestroy: transition.preventDestroy === true,
      destroy: transition.destroy === true,
      changed: transition.changed === true,
    },
  };
}

function applyAdminStructureDamage(structureID, layerToken, amount = null, options = {}) {
  const structure = getStructureByID(structureID, { refresh: false });
  if (!structure) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }

  const normalizedLayer = String(layerToken || "").trim().toLowerCase();
  if (!["shield", "armor", "hull", "kill", "all"].includes(normalizedLayer)) {
    return {
      success: false,
      errorMsg: "INVALID_DAMAGE_LAYER",
    };
  }

  const effectiveHitpoints = resolveStructureEffectiveHitpoints(structure);
  const maxShield = Math.max(0, effectiveHitpoints.effectiveShieldCapacity);
  const maxArmor = Math.max(0, effectiveHitpoints.effectiveArmorHP);
  const maxHull = Math.max(0, effectiveHitpoints.effectiveStructureHP);
  const beforeLayers = {
    shield: Math.max(0, maxShield * toFloat(structure.conditionState && structure.conditionState.shieldCharge, 1)),
    armor: Math.max(0, maxArmor * (1 - toFloat(structure.conditionState && structure.conditionState.armorDamage, 0))),
    structure: Math.max(0, maxHull * (1 - toFloat(structure.conditionState && structure.conditionState.damage, 0))),
  };
  const afterLayers = { ...beforeLayers };
  const normalizedAmount = Number(amount);
  const toAbsoluteDamage = (currentValue, maxValue) => {
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      return currentValue;
    }
    if (normalizedAmount <= 1 && maxValue > 0) {
      return Math.min(currentValue, normalizedAmount * maxValue);
    }
    return Math.min(currentValue, normalizedAmount);
  };

  if (normalizedLayer === "kill" || normalizedLayer === "all") {
    afterLayers.shield = 0;
    afterLayers.armor = 0;
    afterLayers.structure = 0;
  } else if (normalizedLayer === "shield") {
    afterLayers.shield = Math.max(0, beforeLayers.shield - toAbsoluteDamage(beforeLayers.shield, maxShield));
  } else if (normalizedLayer === "armor") {
    afterLayers.shield = 0;
    afterLayers.armor = Math.max(0, beforeLayers.armor - toAbsoluteDamage(beforeLayers.armor, maxArmor));
  } else if (normalizedLayer === "hull") {
    afterLayers.shield = 0;
    afterLayers.armor = 0;
    afterLayers.structure = Math.max(0, beforeLayers.structure - toAbsoluteDamage(beforeLayers.structure, maxHull));
  }

  const damageResult = {
    success: true,
    data: {
      beforeLayers,
      afterLayers,
      afterConditionState: normalizeConditionState({
        shieldCharge: maxShield > 0 ? afterLayers.shield / maxShield : 0,
        armorDamage: maxArmor > 0 ? 1 - afterLayers.armor / maxArmor : 1,
        damage: maxHull > 0 ? 1 - afterLayers.structure / maxHull : 1,
        charge: structure.conditionState && structure.conditionState.charge,
      }),
      destroyed: afterLayers.structure <= 1e-9,
    },
  };

  const result = applyRuntimeStructureDamage(
    structureID,
    damageResult,
    toInt(options.nowMs, Date.now()),
  );
  if (!result.success) {
    return result;
  }

  if (
    result.data &&
    result.data.destroy === true &&
    result.data.preventDestroy !== true
  ) {
    const destroyResult = destroyStructure(structureID, {
      nowMs: options.nowMs,
      session: options.session,
    });
    if (!destroyResult.success) {
      return destroyResult;
    }
    return {
      success: true,
      data: {
        structure: destroyResult.data,
        destroy: true,
        changed: true,
      },
    };
  }

  return result;
}

function getStructureServices(structure) {
  return Object.fromEntries(
    Object.entries(structure && structure.serviceStates || {})
      .map(([serviceID, stateID]) => [toPositiveInt(serviceID, 0), toInt(stateID, STRUCTURE_SERVICE_STATE.OFFLINE)])
      .filter(([serviceID]) => serviceID > 0),
  );
}

function buildStructureDirectoryInfo(structure) {
  const next = normalizeStructureRecord(structure);
  const typeRecord = getStructureTypeByID(next.typeID);
  return {
    itemID: next.structureID,
    structureID: next.structureID,
    itemName: next.itemName,
    solarSystemID: next.solarSystemID,
    locationID: next.solarSystemID,
    ownerID: next.ownerCorpID,
    allianceID: next.allianceID,
    typeID: next.typeID,
    groupID: toPositiveInt(typeRecord && typeRecord.groupID, 0),
    categoryID: 65,
    x: next.position.x,
    y: next.position.y,
    z: next.position.z,
    inSpace: !next.destroyedAt,
    profileID: next.profileID,
    services: getStructureServices(next),
    fuelExpires: next.fuelExpiresAt ? toFileTimeLongFromMs(next.fuelExpiresAt) : null,
    upkeepState: next.upkeepState,
    state: next.state,
    timerEnd: next.stateEndsAt ? toFileTimeLongFromMs(next.stateEndsAt) : null,
    reinforce_weekday: next.reinforceWeekday,
    reinforce_hour: next.reinforceHour,
    next_reinforce_weekday: next.nextReinforceWeekday,
    next_reinforce_hour: next.nextReinforceHour,
    next_reinforce_apply: next.nextReinforceApply,
    unanchoring: next.unanchoring ? toFileTimeLongFromMs(next.unanchoring) : null,
    liquidOzoneQty: next.liquidOzoneQty,
    wars: [...next.wars],
  };
}

function buildStructureLocationRecord(structure) {
  const next = normalizeStructureRecord(structure);
  return {
    locationID: next.structureID,
    locationName: next.itemName,
    solarSystemID: next.solarSystemID,
    x: next.position.x,
    y: next.position.y,
    z: next.position.z,
    locationNameID: next.itemName,
  };
}

function buildStructureMapEntry(structure) {
  const next = normalizeStructureRecord(structure);
  const typeRecord = getStructureTypeByID(next.typeID);
  return [
    toPositiveInt(typeRecord && typeRecord.groupID, 0),
    next.typeID,
    next.structureID,
    next.itemName,
    next.solarSystemID,
    null,
    false,
    next.position.x,
    next.position.y,
    next.position.z,
    null,
    null,
  ];
}

function listDockableStructuresForCharacter(session, options = {}) {
  const solarSystemID =
    options.solarSystemID === undefined || options.solarSystemID === null
      ? null
      : toPositiveInt(options.solarSystemID, 0);
  return listStructures({
    includeDestroyed: false,
    refresh: options.refresh !== false,
  }).filter((structure) => {
    if (solarSystemID && structure.solarSystemID !== solarSystemID) {
      return false;
    }
    return canCharacterDockAtStructure(session, structure, {
      ignoreRestrictions: options.ignoreRestrictions === true,
      shipTypeID: options.shipTypeID,
    }).success;
  });
}

function clearStructureCaches() {
  typeCache = null;
  structureCache = null;
  solarCache = null;
}

function listAssetSafetyWraps() {
  const payload = readTable(STRUCTURE_ASSET_SAFETY_TABLE, {
    _meta: {
      nextWrapID: NEXT_ASSET_WRAP_ID_START,
      generatedAt: null,
      lastUpdatedAt: null,
    },
    wraps: [],
  });
  return Array.isArray(payload.wraps) ? payload.wraps.map((entry) => cloneValue(entry)) : [];
}

Object.assign(module.exports, {
  STRUCTURE_TYPES_TABLE,
  STRUCTURES_TABLE,
  STRUCTURE_ASSET_SAFETY_TABLE,
  ensureStructureTypes,
  getStructureTypes,
  getStructureTypeByID,
  getStructureByID,
  getStructureByName,
  listStructures,
  listStructuresForSystem,
  listOwnedStructures,
  listDockableStructuresForCharacter,
  clearStructureCaches,
  createStructure,
  upsertStructureRecord,
  updateStructureRecord,
  seedStructureForSession,
  startAnchoring,
  startStructureUnanchoring,
  setStructureState,
  setStructureStateTimerRemaining,
  setStructureDeployTimerRemaining,
  setStructureUnanchoringRemaining,
  setStructureAbandonTimerRemaining,
  setStructureQuantumCoreInstalled,
  setStructureUpkeepState,
  setStructureServiceState,
  repairStructure,
  fastForwardStructure,
  setStructureTimerScale,
  cancelStructureUnanchoring,
  removeStructure,
  destroyStructure,
  hasStructureGmBypass,
  isDockingServiceOnline,
  isStructureTetheringAllowed,
  canCharacterDockAtStructure,
  canShipTypeDockAtStructure,
  hasStructureOneWayUndockRestriction,
  applyAdminStructureDamage,
  applyRuntimeStructureDamage,
  tickStructures,
  getStructureServices,
  resolveStructureEffectiveHitpoints,
    buildStructureDirectoryInfo,
    buildStructureLocationRecord,
    buildStructureMapEntry,
    registerStructureChangeListener,
    listAssetSafetyWraps,
  toFileTimeLongFromMs,
  _testing: {
    normalizeStructureTypeRecord,
    normalizeStructureRecord,
    applyStructureDamageTransition,
    maybeAdvanceStructureState,
    getShipDockClass,
    resolveStructureUnanchoringSeconds,
  },
});
