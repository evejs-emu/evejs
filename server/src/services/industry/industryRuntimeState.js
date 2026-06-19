const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const structureState = require(path.join(__dirname, "../structure/structureState"));
const {
  syncInventoryItemForSession,
} = require(path.join(__dirname, "../character/characterState"));
const {
  getCharacterWallet,
  adjustCharacterBalance,
} = require(path.join(__dirname, "../account/walletState"));
const {
  adjustCorporationWalletDivisionBalance,
  getCorporationWalletBalance,
  normalizeCorporationWalletKey,
} = require(path.join(__dirname, "../corporation/corpWalletState"));
const {
  findItemById,
  ITEM_FLAGS,
  listContainerItems,
  listOwnedItems,
  grantItemsToCharacterLocation,
  grantItemsToOwnerLocation,
  removeInventoryItem,
  takeItemTypeFromCharacterLocation,
  takeItemTypeFromOwnerLocation,
  updateInventoryItem,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  buildIndustryValidationErrors,
  parseIndustryRequest,
} = require(path.join(__dirname, "./industryPayloads"));
const {
  notifyBlueprintsUpdated,
  notifyIndustryJob,
} = require(path.join(__dirname, "./industryNotifications"));
const {
  getBlueprintDefinitionByTypeID,
  getFacilityPayloadByID,
  listFacilitiesForSession,
} = require(path.join(__dirname, "./industryStaticData"));
const {
  buildIndustryActivityMaterials,
  getIndustryActivity,
  resolveIndustryJobBaseCost,
  resolveIndustryJobTimeSeconds,
} = require(path.join(__dirname, "./industryParityHelpers"));
const {
  resolveIndustryFacilityRestriction,
  resolveIndustrySlotContext,
  resolveIndustryStandingRestriction,
} = require(path.join(__dirname, "./industryRestrictions"));
const {
  canSeeCorporationBlueprints,
  canTakeFromOwnerLocation,
  canUseCorporationWallet,
  canViewOwnerLocation,
  getAccessibleCorpHangarFlags,
  getSessionCharacterID,
  getSessionCorporationID,
  hasCorporationIndustryJobAccess,
  isCharacterOwner,
  isCorporationOwner,
  normalizeRoleValue,
} = require(path.join(__dirname, "./industryAccess"));
const {
  throwWrappedUserError,
} = require(path.join(__dirname, "../../common/machoErrors"));
const {
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  BLUEPRINT_CATEGORY_ID,
  COST_PERCENTAGE,
  DEFAULT_ACCOUNT_KEY,
  DEFAULT_TAX_RATE,
  INDUSTRY_ACTIVITY,
  INDUSTRY_BLUEPRINT_STATE_TABLE,
  INDUSTRY_ERROR,
  INDUSTRY_INSTALLED_LOCATION_ID,
  INDUSTRY_JOBS_TABLE,
  INDUSTRY_RUNTIME_TABLE,
  INDUSTRY_STATUS,
  ITEM_FLAG_CORP_DELIVERIES,
  ITEM_FLAG_CORP_HANGAR_1,
  ITEM_FLAG_HANGAR,
  MAX_JOB_LENGTH_SECONDS,
  MAX_COPY_RUNS,
  MAX_MATERIAL_EFFICIENCY,
  MAX_MANUFACTURING_RUNS,
  MAX_TIME_EFFICIENCY,
  RESEARCH_TIME_MULTIPLIERS,
  SCC_SURCHARGE_RATE,
  SCC_SURCHARGE_RESEARCH_DISCOUNT_MODIFIER,
  STEP_MATERIAL_EFFICIENCY,
  STEP_TIME_EFFICIENCY,
} = require(path.join(__dirname, "./industryConstants"));

const JOB_ID_START = 970000000000000;
const MONITOR_ID_START = 1;
const FILETIME_EPOCH_OFFSET = 116444736000000000n;
const FILETIME_TICKS_PER_MILLISECOND = 10000n;
const FILETIME_TICKS_PER_SECOND = 10000000n;
const LEGACY_UNIX_MS_MAX = 9999999999999n;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFloat(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeBigIntLike(value, fallback = 0n) {
  try {
    if (typeof value === "bigint") {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return BigInt(Math.trunc(value));
    }
    if (typeof value === "string" && value.trim() !== "") {
      return BigInt(value.trim());
    }
  } catch (error) {
    return fallback;
  }
  return fallback;
}

function normalizeIndustryFileTime(value, fallback = 0n) {
  const normalized = normalizeBigIntLike(value, fallback);
  if (normalized <= 0n) {
    return fallback;
  }
  if (normalized <= LEGACY_UNIX_MS_MAX) {
    return normalized * FILETIME_TICKS_PER_MILLISECOND + FILETIME_EPOCH_OFFSET;
  }
  return normalized;
}

function serializeIndustryFileTime(value, fallback = 0n) {
  return normalizeIndustryFileTime(value, fallback).toString();
}

function normalizeIndustryJobRecord(job) {
  if (!job || typeof job !== "object") {
    return null;
  }
  const normalizedJob = {
    ...cloneValue(job),
  };
  normalizedJob.startDate = serializeIndustryFileTime(normalizedJob.startDate, 0n);
  normalizedJob.endDate = serializeIndustryFileTime(normalizedJob.endDate, 0n);
  normalizedJob.pauseDate = normalizedJob.pauseDate
    ? serializeIndustryFileTime(normalizedJob.pauseDate, 0n)
    : null;
  return normalizedJob;
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
  return Boolean(result && result.success);
}

function ensureBlueprintStateTable() {
  const payload = readTable(INDUSTRY_BLUEPRINT_STATE_TABLE, {
    _meta: {
      version: 1,
      generatedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
    },
    records: {},
  });
  if (!payload.records || typeof payload.records !== "object") {
    payload.records = {};
  }
  return payload;
}

function persistBlueprintStateTable(payload) {
  payload._meta = {
    ...(payload._meta || {}),
    version: 1,
    lastUpdatedAt: new Date().toISOString(),
  };
  return writeTable(INDUSTRY_BLUEPRINT_STATE_TABLE, payload);
}

function ensureJobsTable() {
  const payload = readTable(INDUSTRY_JOBS_TABLE, {
    _meta: {
      version: 1,
      nextJobID: JOB_ID_START,
      generatedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
    },
    jobs: {},
  });
  if (!payload.jobs || typeof payload.jobs !== "object") {
    payload.jobs = {};
  }
  payload._meta = payload._meta && typeof payload._meta === "object" ? payload._meta : {};
  payload._meta.nextJobID = Math.max(JOB_ID_START, toInt(payload._meta.nextJobID, JOB_ID_START));
  return payload;
}

function persistJobsTable(payload) {
  payload._meta = {
    ...(payload._meta || {}),
    version: 1,
    lastUpdatedAt: new Date().toISOString(),
  };
  return writeTable(INDUSTRY_JOBS_TABLE, payload);
}

function ensureRuntimeTable() {
  const payload = readTable(INDUSTRY_RUNTIME_TABLE, {
    _meta: {
      version: 1,
      nextMonitorID: MONITOR_ID_START,
      generatedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
    },
    monitors: {},
  });
  if (!payload.monitors || typeof payload.monitors !== "object") {
    payload.monitors = {};
  }
  payload._meta = payload._meta && typeof payload._meta === "object" ? payload._meta : {};
  payload._meta.nextMonitorID = Math.max(MONITOR_ID_START, toInt(payload._meta.nextMonitorID, MONITOR_ID_START));
  return payload;
}

function persistRuntimeTable(payload) {
  payload._meta = {
    ...(payload._meta || {}),
    version: 1,
    lastUpdatedAt: new Date().toISOString(),
  };
  return writeTable(INDUSTRY_RUNTIME_TABLE, payload);
}

function canViewBlueprintInstance(session, item) {
  if (!session || !item) {
    return true;
  }
  const state = getBlueprintState(item.itemID, item);
  const installedJob = state && state.jobID ? getJobByID(state.jobID) : null;
  const accessLocationID = installedJob
    ? toInt(installedJob.blueprintLocationID, 0)
    : toInt(item.locationID, 0);
  const accessFlagID = installedJob
    ? toInt(installedJob.blueprintLocationFlagID, 0)
    : toInt(item.flagID, 0);
  const ownerID = toInt(item.ownerID, 0);
  if (isCharacterOwner(session, ownerID)) {
    return true;
  }
  if (!isCorporationOwner(session, ownerID)) {
    return false;
  }
  return (
    canSeeCorporationBlueprints(session, ownerID) &&
    canViewOwnerLocation(
      session,
      ownerID,
      accessLocationID,
      accessFlagID,
    )
  );
}

function getBlueprintState(itemID, inventoryItem = null) {
  const numericItemID = toInt(itemID, 0);
  if (numericItemID <= 0) {
    return null;
  }
  const payload = ensureBlueprintStateTable();
  const existing = payload.records[String(numericItemID)];
  if (existing && typeof existing === "object") {
    return cloneValue(existing);
  }

  const item = inventoryItem || findItemById(numericItemID);
  if (!item || toInt(item.categoryID, 0) !== BLUEPRINT_CATEGORY_ID) {
    return null;
  }

  const nextState = {
    itemID: numericItemID,
    typeID: toInt(item.typeID, 0),
    materialEfficiency: 0,
    timeEfficiency: 0,
    original: true,
    runsRemaining: -1,
    jobID: null,
    updatedAt: Date.now(),
  };
  payload.records[String(numericItemID)] = nextState;
  persistBlueprintStateTable(payload);
  return cloneValue(nextState);
}

function updateBlueprintState(itemID, updater) {
  const numericItemID = toInt(itemID, 0);
  const payload = ensureBlueprintStateTable();
  const current = getBlueprintState(numericItemID);
  if (!current) {
    return {
      success: false,
      errorMsg: "BLUEPRINT_NOT_FOUND",
    };
  }

  const nextState =
    typeof updater === "function" ? updater(cloneValue(current)) : updater;
  if (!nextState || typeof nextState !== "object") {
    return {
      success: false,
      errorMsg: "INVALID_BLUEPRINT_STATE",
    };
  }

  payload.records[String(numericItemID)] = {
    ...current,
    ...nextState,
    itemID: numericItemID,
    updatedAt: Date.now(),
  };
  if (!persistBlueprintStateTable(payload)) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  return {
    success: true,
    data: cloneValue(payload.records[String(numericItemID)]),
  };
}

function removeBlueprintState(itemID) {
  const numericItemID = toInt(itemID, 0);
  if (numericItemID <= 0) {
    return;
  }
  const payload = ensureBlueprintStateTable();
  delete payload.records[String(numericItemID)];
  persistBlueprintStateTable(payload);
}

function resolveLocationType(locationID) {
  const numericLocationID = toInt(locationID, 0);
  const station = worldData.getStationByID(numericLocationID);
  if (station) {
    return {
      typeID: toInt(station.stationTypeID, 0),
      solarSystemID: toInt(station.solarSystemID, 0),
      facilityID: numericLocationID,
    };
  }
  const structure = structureState.getStructureByID(numericLocationID, { refresh: false });
  if (structure) {
    return {
      typeID: toInt(structure.typeID, 0),
      solarSystemID: toInt(structure.solarSystemID, 0),
      facilityID: numericLocationID,
    };
  }
  const item = findItemById(numericLocationID);
  return {
    typeID: toInt(item && item.typeID, 0),
    solarSystemID: 0,
    facilityID: 0,
  };
}

function buildBlueprintInstance(item) {
  const state = getBlueprintState(item && item.itemID, item);
  if (!item || !state) {
    return null;
  }
  const installedJob = state.jobID ? getJobByID(state.jobID) : null;
  const resolvedLocationID = installedJob
    ? toInt(installedJob.blueprintLocationID, 0)
    : toInt(item.locationID, 0);
  const resolvedFlagID = installedJob
    ? toInt(installedJob.blueprintLocationFlagID, 0)
    : toInt(item.flagID, 0);
  const location = resolveLocationType(resolvedLocationID);
  const resolvedFacilityID = installedJob
    ? toInt(installedJob.facilityID, 0)
    : toInt(location.facilityID, 0);
  return {
    typeID: toInt(item.typeID, 0),
    itemID: toInt(item.itemID, 0),
    timeEfficiency: toInt(state.timeEfficiency, 0),
    materialEfficiency: toInt(state.materialEfficiency, 0),
    original: state.original === true,
    runs: state.original ? -1 : Math.max(0, toInt(state.runsRemaining, 0)),
    quantity: state.original ? -1 : -2,
    locationID: resolvedLocationID,
    locationTypeID: toInt(location.typeID, 0),
    locationFlagID: resolvedFlagID,
    flagID: resolvedFlagID,
    facilityID: resolvedFacilityID > 0 ? resolvedFacilityID : null,
    ownerID: toInt(item.ownerID, 0),
    jobID: state.jobID ? toInt(state.jobID, 0) : null,
    isImpounded: false,
    solarSystemID: toInt(location.solarSystemID, 0),
  };
}

function listBlueprintInstancesByOwner(ownerID, facilityID = null, session = null) {
  const numericOwnerID = toInt(ownerID, 0);
  const numericFacilityID =
    facilityID === null || facilityID === undefined ? null : toInt(facilityID, 0);
  const counts = {};
  const blueprints = [];

  for (const item of listOwnedItems(numericOwnerID, {
    categoryID: BLUEPRINT_CATEGORY_ID,
  })) {
    if (!canViewBlueprintInstance(session, item)) {
      continue;
    }
    const instance = buildBlueprintInstance(item);
    if (!instance) {
      continue;
    }
    const resolvedFacilityID =
      instance.facilityID === null || instance.facilityID === undefined
        ? null
        : toInt(instance.facilityID, 0);
    const countKey = resolvedFacilityID && resolvedFacilityID > 0
      ? String(resolvedFacilityID)
      : "null";
    counts[countKey] = (counts[countKey] || 0) + 1;
    if (numericFacilityID !== null && resolvedFacilityID !== numericFacilityID) {
      continue;
    }
    blueprints.push(instance);
  }

  blueprints.sort((left, right) => left.itemID - right.itemID);
  return {
    blueprints,
    counts,
  };
}

function getBlueprintByItemID(itemID, session = null) {
  const item = findItemById(itemID);
  if (!item || toInt(item.categoryID, 0) !== BLUEPRINT_CATEGORY_ID) {
    return null;
  }
  if (!canViewBlueprintInstance(session, item)) {
    return null;
  }
  return buildBlueprintInstance(item);
}

function getJobStatus(job) {
  if (!job) {
    return INDUSTRY_STATUS.UNSUBMITTED;
  }
  const endDate = normalizeIndustryFileTime(job.endDate, 0n);
  if (
    toInt(job.status, 0) === INDUSTRY_STATUS.INSTALLED &&
    endDate > 0n &&
    endDate <= currentFileTime()
  ) {
    return INDUSTRY_STATUS.READY;
  }
  return toInt(job.status, 0);
}

function listJobsByOwner(ownerID, includeCompleted = false) {
  const payload = ensureJobsTable();
  return Object.values(payload.jobs || {})
    .filter((job) => toInt(job && job.ownerID, 0) === toInt(ownerID, 0))
    .map((job) => {
      const normalizedJob = normalizeIndustryJobRecord(job);
      return {
        ...normalizedJob,
        status: getJobStatus(normalizedJob),
      };
    })
    .filter((job) => includeCompleted || toInt(job.status, 0) < INDUSTRY_STATUS.COMPLETED)
    .sort((left, right) => left.jobID - right.jobID);
}

function getJobByID(jobID) {
  const payload = ensureJobsTable();
  const job = payload.jobs[String(toInt(jobID, 0))];
  if (!job) {
    return null;
  }
  const normalizedJob = normalizeIndustryJobRecord(job);
  return {
    ...normalizedJob,
    status: getJobStatus(normalizedJob),
  };
}

function allocateJobID(payload) {
  const allocated = Math.max(JOB_ID_START, toInt(payload._meta.nextJobID, JOB_ID_START));
  payload._meta.nextJobID = allocated + 1;
  return allocated;
}

function getStationIDForFacility(facilityID) {
  const station = worldData.getStationByID(facilityID);
  return station ? toInt(station.stationID, 0) : 0;
}

function buildIndustryValidationError(code, ...args) {
  return {
    code: toInt(code, 0),
    args,
  };
}

function throwIndustryValidationError(errors = []) {
  throwWrappedUserError("IndustryValidationError", {
    errors: buildIndustryValidationErrors(errors),
  });
}

function resolveFacilityLocations(facilityID, ownerID, blueprint = null, session = null) {
  const facility = getFacilityPayloadByID(facilityID);
  if (!facility) {
    return [];
  }
  const locations = [];
  const seen = new Set();
  const numericOwnerID = toInt(ownerID, 0);
  const pushLocation = (entry) => {
    if (!entry || toInt(entry.itemID, 0) <= 0) {
      return;
    }
    const key = `${entry.itemID}:${entry.flagID}:${entry.ownerID}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    locations.push(entry);
  };

  if (session && isCorporationOwner(session, numericOwnerID)) {
    for (const flagID of getAccessibleCorpHangarFlags(session, facility.facilityID)) {
      pushLocation({
        itemID: facility.facilityID,
        typeID: facility.typeID,
        ownerID: numericOwnerID,
        flagID,
        solarSystemID: facility.solarSystemID,
        canView: canViewOwnerLocation(session, numericOwnerID, facility.facilityID, flagID),
        canTake: canTakeFromOwnerLocation(session, numericOwnerID, facility.facilityID, flagID),
      });
    }
    pushLocation({
      itemID: facility.facilityID,
      typeID: facility.typeID,
      ownerID: numericOwnerID,
      flagID: ITEM_FLAG_CORP_DELIVERIES,
      solarSystemID: facility.solarSystemID,
      canView: canViewOwnerLocation(session, numericOwnerID, facility.facilityID, ITEM_FLAG_CORP_DELIVERIES),
      canTake: canTakeFromOwnerLocation(session, numericOwnerID, facility.facilityID, ITEM_FLAG_CORP_DELIVERIES),
    });
  } else {
    pushLocation({
      itemID: facility.facilityID,
      typeID: facility.typeID,
      ownerID: numericOwnerID,
      flagID: ITEM_FLAG_HANGAR,
      solarSystemID: facility.solarSystemID,
      canView: true,
      canTake: true,
    });
  }

  if (blueprint && toInt(blueprint.locationID, 0) > 0) {
    const locationType = resolveLocationType(blueprint.locationID);
    const canView = session
      ? canViewOwnerLocation(
          session,
          numericOwnerID,
          toInt(blueprint.locationID, 0),
          toInt(blueprint.flagID, 0),
        )
      : true;
    const canTake = session
      ? canTakeFromOwnerLocation(
          session,
          numericOwnerID,
          toInt(blueprint.locationID, 0),
          toInt(blueprint.flagID, 0),
        )
      : true;
    pushLocation({
      itemID: toInt(blueprint.locationID, 0),
      typeID: toInt(locationType.typeID, 0),
      ownerID: toInt(blueprint.ownerID, 0),
      flagID: toInt(blueprint.flagID, 0),
      solarSystemID: toInt(locationType.solarSystemID, 0),
      canView,
      canTake,
    });
  }

  return locations.filter((location) => location.canView !== false);
}

function resolveAvailableMaterials(ownerID, inputLocation) {
  if (!inputLocation) {
    return {};
  }
  const materials = {};
  for (const item of listContainerItems(
    toInt(ownerID, 0),
    toInt(inputLocation.itemID, 0),
    toInt(inputLocation.flagID, 0),
  )) {
    const typeID = toInt(item && item.typeID, 0);
    if (typeID <= 0 || toInt(item.categoryID, 0) === BLUEPRINT_CATEGORY_ID) {
      continue;
    }
    const quantity =
      toInt(item.singleton, 0) === 1 ? 1 : Math.max(0, toInt(item.stacksize || item.quantity, 0));
    materials[typeID] = (materials[typeID] || 0) + quantity;
  }
  return materials;
}

function buildManufacturingMaterials(definition, runs, materialEfficiency = 0) {
  return buildIndustryActivityMaterials(
    definition,
    INDUSTRY_ACTIVITY.MANUFACTURING,
    runs,
    { materialEfficiency },
  );
}

function buildProductOutput(definition, runs) {
  const activity = definition && definition.activities && definition.activities.manufacturing;
  const products = Array.isArray(activity && activity.products)
    ? activity.products
    : [];
  return products.map((product) => ({
    typeID: toInt(product && product.typeID, 0),
    quantity: Math.max(1, toInt(product && product.quantity, 1)) * runs,
  })).filter((product) => product.typeID > 0 && product.quantity > 0);
}

function getActivityBlueprintTypeID(definition, blueprintTypeID) {
  const numericBlueprintTypeID = toInt(blueprintTypeID, 0);
  if (numericBlueprintTypeID > 0) {
    return numericBlueprintTypeID;
  }
  return toInt(definition && definition.blueprintTypeID, 0);
}

function getActivityResearchCurrentLevel(state, activityID) {
  if (!state) {
    return 0;
  }
  if (toInt(activityID, 0) === INDUSTRY_ACTIVITY.RESEARCH_MATERIAL) {
    return Math.max(0, toInt(state.materialEfficiency, 0)) / STEP_MATERIAL_EFFICIENCY;
  }
  if (toInt(activityID, 0) === INDUSTRY_ACTIVITY.RESEARCH_TIME) {
    return Math.max(0, toInt(state.timeEfficiency, 0)) / STEP_TIME_EFFICIENCY;
  }
  return 0;
}

function getActivityResearchMaxLevel(activityID) {
  if (toInt(activityID, 0) === INDUSTRY_ACTIVITY.RESEARCH_MATERIAL) {
    return MAX_MATERIAL_EFFICIENCY / STEP_MATERIAL_EFFICIENCY;
  }
  if (toInt(activityID, 0) === INDUSTRY_ACTIVITY.RESEARCH_TIME) {
    return MAX_TIME_EFFICIENCY / STEP_TIME_EFFICIENCY;
  }
  return 0;
}

function getActivityResearchRunsRemaining(state, activityID) {
  const maxLevel = getActivityResearchMaxLevel(activityID);
  const currentLevel = getActivityResearchCurrentLevel(state, activityID);
  return Math.max(0, maxLevel - currentLevel);
}

function resolveResearchActivityTimeSeconds(definition, activityID, runs) {
  const activity = getIndustryActivity(definition, activityID);
  const baseTime = Math.max(0, toInt(activity && activity.time, 0));
  const normalizedRuns = Math.max(1, toInt(runs, 1));
  const currentLevel = Math.max(0, getActivityResearchCurrentLevel({
    materialEfficiency: 0,
    timeEfficiency: 0,
  }, activityID));
  const maxIndex = Math.max(0, RESEARCH_TIME_MULTIPLIERS.length - 1);
  let totalSeconds = 0;
  for (let index = 0; index < normalizedRuns; index += 1) {
    const levelIndex = Math.min(currentLevel + index, maxIndex);
    totalSeconds += baseTime * RESEARCH_TIME_MULTIPLIERS[levelIndex];
  }
  return totalSeconds;
}

function resolveActivityBaseCost(definition, blueprintTypeID, activityID, runs, licensedRuns, state = null) {
  const numericActivityID = toInt(activityID, 0);
  const numericRuns = Math.max(1, toInt(runs, 1));
  if (
    numericActivityID === INDUSTRY_ACTIVITY.MANUFACTURING ||
    numericActivityID === INDUSTRY_ACTIVITY.REACTION
  ) {
    return Math.round(
      resolveIndustryJobBaseCost(
        definition,
        numericActivityID,
        1,
      ) * numericRuns,
    );
  }

  const blueprintValue = resolveIndustryJobBaseCost(
    {
      blueprintTypeID: getActivityBlueprintTypeID(definition, blueprintTypeID),
      activities: {},
    },
    INDUSTRY_ACTIVITY.MANUFACTURING,
    COST_PERCENTAGE,
  );
  if (!(blueprintValue > 0)) {
    return 0;
  }

  if (
    numericActivityID === INDUSTRY_ACTIVITY.RESEARCH_MATERIAL ||
    numericActivityID === INDUSTRY_ACTIVITY.RESEARCH_TIME
  ) {
    const baseResearchTime = Math.max(
      1,
      toInt(getIndustryActivity(definition, numericActivityID)?.time, 0),
    );
    const currentLevel = getActivityResearchCurrentLevel(state, numericActivityID);
    const maxIndex = Math.max(0, RESEARCH_TIME_MULTIPLIERS.length - 1);
    let weightedSeconds = 0;
    for (let index = 0; index < numericRuns; index += 1) {
      const levelIndex = Math.min(currentLevel + index, maxIndex);
      weightedSeconds += baseResearchTime * RESEARCH_TIME_MULTIPLIERS[levelIndex];
    }
    return Math.round(blueprintValue * (weightedSeconds / baseResearchTime));
  }

  if (numericActivityID === INDUSTRY_ACTIVITY.COPYING) {
    return Math.round(
      blueprintValue *
        Math.max(1, toInt(licensedRuns, 1)) *
        numericRuns,
    );
  }

  return Math.round(
    resolveIndustryJobBaseCost(definition, numericActivityID, COST_PERCENTAGE) * numericRuns,
  );
}

function resolveActivitySccSurcharge(cost, activityID, facility) {
  let surchargeRate =
    SCC_SURCHARGE_RATE * Math.max(0, toFloat(facility && facility.sccTaxModifier, 1));
  if (
    toInt(activityID, 0) === INDUSTRY_ACTIVITY.RESEARCH_TIME ||
    toInt(activityID, 0) === INDUSTRY_ACTIVITY.RESEARCH_MATERIAL
  ) {
    surchargeRate *= SCC_SURCHARGE_RESEARCH_DISCOUNT_MODIFIER;
  }
  return Math.round(Math.max(0, toInt(cost, 0)) * surchargeRate);
}

function resolveActivityProductTypeID(definition, activityID, blueprintTypeID) {
  const numericActivityID = toInt(activityID, 0);
  if (
    numericActivityID === INDUSTRY_ACTIVITY.RESEARCH_TIME ||
    numericActivityID === INDUSTRY_ACTIVITY.RESEARCH_MATERIAL ||
    numericActivityID === INDUSTRY_ACTIVITY.COPYING
  ) {
    return getActivityBlueprintTypeID(definition, blueprintTypeID);
  }
  return toInt(definition && definition.productTypeID, 0);
}

function buildCopyOutputBlueprintEntries(job, outputLocationID, outputFlagID) {
  const entries = [];
  const quantity = Math.max(1, toInt(job && job.runs, 1));
  const blueprintTypeID = toInt(job && job.blueprintTypeID, 0);
  const licensedRuns = Math.max(1, toInt(job && job.licensedRuns, 1));
  for (let index = 0; index < quantity; index += 1) {
    entries.push({
      itemType: blueprintTypeID,
      quantity: 1,
      options: {
        singleton: 2,
        itemName: null,
      },
      blueprintState: {
        typeID: blueprintTypeID,
        materialEfficiency: 0,
        timeEfficiency: 0,
        original: false,
        runsRemaining: licensedRuns,
        jobID: null,
      },
      outputLocationID,
      outputFlagID,
    });
  }
  return entries;
}

function resolveBaseJobCost(definition) {
  return resolveIndustryJobBaseCost(
    definition,
    INDUSTRY_ACTIVITY.MANUFACTURING,
    COST_PERCENTAGE,
  );
}

function resolveJobTimeSeconds(definition, runs, timeEfficiency, facility, characterID) {
  return resolveIndustryJobTimeSeconds(
    definition,
    INDUSTRY_ACTIVITY.MANUFACTURING,
    runs,
    timeEfficiency,
    facility,
    characterID,
  );
}

function resolveActivityJobTimeSeconds(
  definition,
  activityID,
  runs,
  state,
  facility,
  characterID,
  licensedRuns = 1,
) {
  const numericActivityID = toInt(activityID, 0);
  const currentEfficiency =
    numericActivityID === INDUSTRY_ACTIVITY.RESEARCH_MATERIAL
      ? Math.max(0, toInt(state && state.materialEfficiency, 0))
      : numericActivityID === INDUSTRY_ACTIVITY.RESEARCH_TIME
        ? Math.max(0, toInt(state && state.timeEfficiency, 0))
        : Math.max(0, toInt(state && state.timeEfficiency, 0));
  return resolveIndustryJobTimeSeconds(
    definition,
    numericActivityID,
    runs,
    currentEfficiency,
    facility,
    characterID,
    licensedRuns,
  );
}

function normalizeAccountForOwner(ownerID, requestAccount, session = null) {
  if (Array.isArray(requestAccount) && requestAccount.length >= 2) {
    return [toInt(requestAccount[0], 0), toInt(requestAccount[1], 0)];
  }
  if (session && isCorporationOwner(session, ownerID)) {
    return [
      toInt(ownerID, 0),
      normalizeCorporationWalletKey(session.corpAccountKey || DEFAULT_ACCOUNT_KEY),
    ];
  }
  return [toInt(ownerID, 0), DEFAULT_ACCOUNT_KEY];
}

function normalizeLocationForFacility(
  facility,
  ownerID,
  requestLocation,
  blueprint,
  session = null,
  options = {},
) {
  const requireTake = options && options.requireTake === true;
  const preferDeliveries = options && options.preferDeliveries === true;
  const locations = resolveFacilityLocations(facility.facilityID, ownerID, blueprint, session);
  if (requestLocation) {
    const match = locations.find((entry) => (
      toInt(entry.itemID, 0) === toInt(requestLocation.itemID, 0) &&
      toInt(entry.flagID, 0) === toInt(requestLocation.flagID, 0) &&
      toInt(entry.ownerID, 0) === toInt(requestLocation.ownerID || ownerID, 0)
    ));
    if (match && (!requireTake || match.canTake !== false)) {
      return match;
    }
  }
  if (preferDeliveries) {
    const deliveries = locations.find((entry) => (
      toInt(entry.flagID, 0) === ITEM_FLAG_CORP_DELIVERIES &&
      (!requireTake || entry.canTake !== false)
    ));
    if (deliveries) {
      return deliveries;
    }
  }
  if (session && isCorporationOwner(session, ownerID) && requireTake) {
    const firstHangarFlag = getAccessibleCorpHangarFlags(session, facility.facilityID, {
      takeRequired: true,
    })[0];
    if (firstHangarFlag) {
      return locations.find((entry) => toInt(entry.flagID, 0) === firstHangarFlag) || null;
    }
  }
  if (session && isCorporationOwner(session, ownerID) && !requireTake) {
    const deliveries = locations.find((entry) => toInt(entry.flagID, 0) === ITEM_FLAG_CORP_DELIVERIES);
    if (deliveries) {
      return deliveries;
    }
  }
  return locations[0] || null;
}

function quoteIndustryJob(session, requestInput) {
  const request =
    requestInput && requestInput.rawRequest
      ? requestInput
      : parseIndustryRequest(requestInput);
  const errors = [];
  const activityID = toInt(request.activityID, 0);

  if (![
    INDUSTRY_ACTIVITY.MANUFACTURING,
    INDUSTRY_ACTIVITY.RESEARCH_TIME,
    INDUSTRY_ACTIVITY.RESEARCH_MATERIAL,
    INDUSTRY_ACTIVITY.COPYING,
  ].includes(activityID)) {
    errors.push(buildIndustryValidationError(INDUSTRY_ERROR.INVALID_ACTIVITY));
  }

  const blueprint = getBlueprintByItemID(request.blueprintID);
  const definition = getBlueprintDefinitionByTypeID(blueprint && blueprint.typeID);
  const activity = getIndustryActivity(definition, activityID);
  const facility = getFacilityPayloadByID(request.facilityID);
  if (!blueprint) {
    errors.push(buildIndustryValidationError(INDUSTRY_ERROR.MISSING_BLUEPRINT));
  }
  if (!definition) {
    errors.push(buildIndustryValidationError(INDUSTRY_ERROR.INVALID_PRODUCT));
  } else if (!activity) {
    errors.push(buildIndustryValidationError(INDUSTRY_ERROR.INCOMPATIBLE_ACTIVITY));
  }
  if (!facility) {
    errors.push(buildIndustryValidationError(INDUSTRY_ERROR.MISSING_FACILITY));
  } else if (!facility.online) {
    errors.push(buildIndustryValidationError(INDUSTRY_ERROR.FACILITY_OFFLINE));
  } else if (!facility.activities || !facility.activities[activityID]) {
    errors.push(buildIndustryValidationError(INDUSTRY_ERROR.FACILITY_ACTIVITY));
  }
  if (errors.length > 0) {
    return { success: false, errors };
  }

  const ownerID = toInt(blueprint.ownerID, 0);
  if (!canViewBlueprintInstance(session, findItemById(blueprint.itemID))) {
    errors.push(buildIndustryValidationError(INDUSTRY_ERROR.BLUEPRINT_ACCESS));
  }
  if (!isCharacterOwner(session, ownerID) && !hasCorporationIndustryJobAccess(session, ownerID)) {
    errors.push(buildIndustryValidationError(INDUSTRY_ERROR.INVALID_OWNER));
  }

  const state = getBlueprintState(blueprint.itemID);
  if (state && state.jobID) {
    errors.push(buildIndustryValidationError(INDUSTRY_ERROR.BLUEPRINT_INSTALLED));
  }
  if (
    state &&
    activityID !== INDUSTRY_ACTIVITY.MANUFACTURING &&
    state.original !== true
  ) {
    errors.push(buildIndustryValidationError(INDUSTRY_ERROR.INCOMPATIBLE_ACTIVITY));
  }

  const runs = Math.max(0, toInt(request.runs, 0));
  const licensedRuns = Math.max(1, toInt(request.licensedRuns, 1) || 1);
  if (activityID === INDUSTRY_ACTIVITY.MANUFACTURING) {
    if (runs <= 0 || runs > MAX_MANUFACTURING_RUNS) {
      errors.push(buildIndustryValidationError(INDUSTRY_ERROR.INVALID_RUNS, state ? state.runsRemaining : 0));
    }
    if (state && !state.original && runs > Math.max(0, toInt(state.runsRemaining, 0))) {
      errors.push(buildIndustryValidationError(INDUSTRY_ERROR.INVALID_RUNS, toInt(state.runsRemaining, 0)));
    }
  } else if (activityID === INDUSTRY_ACTIVITY.COPYING) {
    if (runs <= 0 || runs > MAX_COPY_RUNS) {
      errors.push(buildIndustryValidationError(INDUSTRY_ERROR.INVALID_RUNS, MAX_COPY_RUNS));
    }
    if (
      licensedRuns <= 0 ||
      licensedRuns > Math.max(1, toInt(definition && definition.maxProductionLimit, 1))
    ) {
      errors.push(buildIndustryValidationError(INDUSTRY_ERROR.INVALID_LICENSED_RUNS, licensedRuns));
    }
  } else {
    const remainingResearchRuns = getActivityResearchRunsRemaining(state, activityID);
    if (remainingResearchRuns <= 0) {
      errors.push(buildIndustryValidationError(
        INDUSTRY_ERROR.RESEARCH_LIMIT,
        getActivityResearchCurrentLevel(state, activityID),
        getActivityResearchMaxLevel(activityID),
      ));
    } else if (runs <= 0 || runs > remainingResearchRuns) {
      errors.push(buildIndustryValidationError(INDUSTRY_ERROR.INVALID_RUNS, remainingResearchRuns));
    }
  }

  const installerID = toInt(session && (session.characterID || session.charid), 0);
  const slotContext = resolveIndustrySlotContext(
    activityID,
    installerID,
    getJobCountsByInstaller(installerID),
  );
  if (slotContext.full) {
    errors.push(buildIndustryValidationError(INDUSTRY_ERROR.SLOTS_FULL));
  }

  const standingRestriction = resolveIndustryStandingRestriction(
    session,
    ownerID,
    facility,
    activityID,
  );
  if (standingRestriction) {
    errors.push(
      buildIndustryValidationError(
        INDUSTRY_ERROR.STANDINGS_RESTRICTION,
        standingRestriction,
      ),
    );
  }

  const facilityRestriction = resolveIndustryFacilityRestriction(
    activityID,
    activityID === INDUSTRY_ACTIVITY.MANUFACTURING
      ? toInt(definition && definition.productTypeID, 0)
      : 0,
    facility,
    toInt(blueprint && blueprint.typeID, 0),
  );
  if (facilityRestriction) {
    errors.push(
      buildIndustryValidationError(
        facilityRestriction.code,
        ...(Array.isArray(facilityRestriction.args) ? facilityRestriction.args : []),
      ),
    );
  }

  const inputLocation = normalizeLocationForFacility(
    facility,
    ownerID,
    request.inputLocation,
    blueprint,
    session,
    { requireTake: true },
  );
  const outputLocation = normalizeLocationForFacility(
    facility,
    ownerID,
    request.outputLocation,
    blueprint,
    session,
    { preferDeliveries: true },
  );
  if (!inputLocation) {
    errors.push(buildIndustryValidationError(INDUSTRY_ERROR.MISSING_INPUT_LOCATION));
  } else if (inputLocation.canTake === false) {
    errors.push(buildIndustryValidationError(INDUSTRY_ERROR.INPUT_ACCESS));
  }
  if (!outputLocation) {
    errors.push(buildIndustryValidationError(INDUSTRY_ERROR.MISSING_OUTPUT_LOCATION));
  }

  const materials = buildIndustryActivityMaterials(
    definition,
    activityID,
    runs,
    activityID === INDUSTRY_ACTIVITY.MANUFACTURING
      ? { materialEfficiency: state && state.materialEfficiency }
      : {},
  );
  const materialMap = Object.fromEntries(materials.map((material) => [String(material.typeID), material.quantity]));
  const availableMaterials = resolveAvailableMaterials(ownerID, inputLocation);
  for (const material of materials) {
    const available = toInt(availableMaterials[material.typeID], 0);
    if (available < material.quantity) {
      errors.push(buildIndustryValidationError(
        INDUSTRY_ERROR.MISSING_MATERIAL,
        material.typeID,
        material.quantity,
        available,
        material.quantity - available,
      ));
    }
  }

  const cost = resolveActivityBaseCost(
    definition,
    blueprint.typeID,
    activityID,
    runs,
    licensedRuns,
    state,
  );
  const tax = Math.round(cost * toFloat(facility && facility.tax, DEFAULT_TAX_RATE));
  const sccSurcharge = resolveActivitySccSurcharge(cost, activityID, facility);
  const totalCost = cost + tax + sccSurcharge;
  const timeInSeconds = resolveActivityJobTimeSeconds(
    definition,
    activityID,
    runs,
    state,
    facility,
    session && (session.characterID || session.charid),
    licensedRuns,
  );
  const previousRunLengthSeconds =
    runs > 0 ? timeInSeconds - timeInSeconds / Math.max(1, toInt(runs, 1)) : timeInSeconds;
  if (previousRunLengthSeconds > MAX_JOB_LENGTH_SECONDS) {
    errors.push(
      buildIndustryValidationError(
        INDUSTRY_ERROR.RUN_LENGTH,
        previousRunLengthSeconds,
        MAX_JOB_LENGTH_SECONDS,
      ),
    );
  }

  const account = normalizeAccountForOwner(ownerID, request.account, session);
  if (toInt(account[0], 0) !== ownerID) {
    errors.push(buildIndustryValidationError(INDUSTRY_ERROR.ACCOUNT_INVALID));
  } else if (
    isCorporationOwner(session, ownerID) &&
    !canUseCorporationWallet(session, ownerID, account[1])
  ) {
    errors.push(buildIndustryValidationError(INDUSTRY_ERROR.ACCOUNT_ACCESS));
  } else {
    const balance =
      isCharacterOwner(session, ownerID)
        ? toFloat(getCharacterWallet(ownerID)?.balance, 0)
        : toFloat(getCorporationWalletBalance(ownerID, normalizeCorporationWalletKey(account[1])), 0);
    if (balance < totalCost) {
      errors.push(buildIndustryValidationError(INDUSTRY_ERROR.ACCOUNT_FUNDS, balance, totalCost));
    }
  }

  const requestMaterials = request.materials && typeof request.materials === "object"
    ? request.materials
    : {};
  if (Object.keys(requestMaterials).length > 0) {
    for (const material of materials) {
      if (toInt(requestMaterials[material.typeID], 0) !== material.quantity) {
        errors.push(buildIndustryValidationError(INDUSTRY_ERROR.MISMATCH_MATERIAL, requestMaterials, materialMap));
        break;
      }
    }
  }
  if (request.cost && Math.round(request.cost) !== cost) {
    errors.push(buildIndustryValidationError(INDUSTRY_ERROR.MISMATCH_COST, request.cost, cost));
  }
  if (request.tax && Math.round(request.tax) !== tax) {
    errors.push(buildIndustryValidationError(INDUSTRY_ERROR.MISMATCH_TAX, request.tax, tax));
  }
  if (request.time && Math.round(request.time) !== timeInSeconds) {
    errors.push(buildIndustryValidationError(INDUSTRY_ERROR.MISMATCH_TIME, request.time, timeInSeconds));
  }

  return {
    success: errors.length === 0,
    errors,
    quote: {
      activityID,
      ownerID,
      account,
      blueprint,
      definition,
      facility,
      inputLocation,
      outputLocation,
      materials,
      materialMap,
      availableMaterials,
      runs,
      slotUsage: slotContext.used,
      slotLimit: slotContext.limit,
      cost,
      tax,
      sccSurcharge,
      totalCost,
      timeInSeconds,
      productTypeID: resolveActivityProductTypeID(definition, activityID, blueprint.typeID),
      licensedRuns,
      state,
    },
  };
}

function quoteManufacturingJob(session, requestInput) {
  return quoteIndustryJob(session, requestInput);
}

function syncInventoryChanges(session, changes = []) {
  if (!session || typeof session.sendNotification !== "function") {
    return;
  }
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change) {
      continue;
    }
    if (change.item) {
      syncInventoryItemForSession(
        session,
        change.item,
        change.previousState || change.previousData || {},
      );
      continue;
    }
    if (change.removed === true && change.previousData) {
      const removedState = {
        ...change.previousData,
        locationID: 6,
      };
      syncInventoryItemForSession(session, removedState, change.previousData);
    }
  }
}

function moveBlueprintItemToInstalledLocation(job, session) {
  const blueprintID = toInt(job && job.blueprintID, 0);
  if (blueprintID <= 0) {
    return {
      success: false,
      errorMsg: "BLUEPRINT_NOT_FOUND",
    };
  }

  const updateResult = updateInventoryItem(blueprintID, (currentItem) => {
    if (!currentItem) {
      return currentItem;
    }
    return {
      ...currentItem,
      locationID: INDUSTRY_INSTALLED_LOCATION_ID,
    };
  });
  if (!updateResult.success) {
    return updateResult;
  }

  // updateInventoryItem returns { data: item, previousData: item }, not { data: { changes } }.
  // Notify the client that the blueprint has left the hangar by sending it at junk location 6.
  syncInventoryItemForSession(
    session,
    { ...updateResult.previousData, locationID: 6 },
    updateResult.previousData,
  );
  return updateResult;
}

function restoreBlueprintItemFromInstalledLocation(job, session) {
  const blueprintID = toInt(job && job.blueprintID, 0);
  if (blueprintID <= 0) {
    return {
      success: false,
      errorMsg: "BLUEPRINT_NOT_FOUND",
    };
  }

  const targetLocationID = toInt(job && job.blueprintLocationID, 0);
  const targetFlagID = toInt(job && job.blueprintLocationFlagID, 0);
  const updateResult = updateInventoryItem(blueprintID, (currentItem) => {
    if (!currentItem) {
      return currentItem;
    }
    return {
      ...currentItem,
      locationID: targetLocationID,
      flagID: targetFlagID,
    };
  });
  if (!updateResult.success) {
    return updateResult;
  }

  // updateInventoryItem returns { data: item, previousData: item }, not { data: { changes } }.
  // Notify the client that the blueprint has returned to the hangar.
  syncInventoryItemForSession(session, updateResult.data, updateResult.previousData || {});
  return updateResult;
}

function applyWalletCharge(ownerID, account, amount, session) {
  if (isCharacterOwner(session, ownerID)) {
    return adjustCharacterBalance(ownerID, -amount, {
      description: `Industry job install by ${session && (session.characterName || session.userName || session.characterID || ownerID)}`,
      ownerID1: ownerID,
      ownerID2: ownerID,
      referenceID: ownerID,
    });
  }
  return adjustCorporationWalletDivisionBalance(
    ownerID,
    normalizeCorporationWalletKey(account && account[1]),
    -amount,
    {
      description: `Industry job install by ${session && (session.characterName || session.userName || session.characterID || ownerID)}`,
      ownerID1: ownerID,
      ownerID2: toInt(session && session.characterID, 0),
      referenceID: toInt(session && session.characterID, 0),
    },
  );
}

function installIndustryJob(session, requestInput) {
  const quoteResult = quoteIndustryJob(session, requestInput);
  if (!quoteResult.success) {
    throwIndustryValidationError(quoteResult.errors);
  }

  const { quote } = quoteResult;
  const itemChanges = [];
  for (const material of quote.materials) {
    const takeResult =
      isCharacterOwner(session, quote.ownerID)
        ? takeItemTypeFromCharacterLocation(
            quote.ownerID,
            quote.inputLocation.itemID,
            quote.inputLocation.flagID,
            material.typeID,
            material.quantity,
          )
        : takeItemTypeFromOwnerLocation(
            quote.ownerID,
            quote.inputLocation.itemID,
            quote.inputLocation.flagID,
            material.typeID,
            material.quantity,
          );
    if (!takeResult.success) {
      throwIndustryValidationError([
        buildIndustryValidationError(
          INDUSTRY_ERROR.MISSING_MATERIAL,
          material.typeID,
          material.quantity,
          0,
          material.quantity,
        ),
      ]);
    }
    itemChanges.push(...((takeResult.data && takeResult.data.changes) || []));
  }

  const walletResult = applyWalletCharge(
    quote.ownerID,
    quote.account,
    quote.totalCost,
    session,
  );
  if (!walletResult.success) {
    throwIndustryValidationError([
      buildIndustryValidationError(INDUSTRY_ERROR.ACCOUNT_FUNDS, 0, quote.totalCost),
    ]);
  }

  const jobsTable = ensureJobsTable();
  const jobID = allocateJobID(jobsTable);
  const nowFiletime = currentFileTime();
  const jobRecord = {
    activityID: quote.activityID,
    jobID,
    blueprintID: quote.blueprint.itemID,
    blueprintTypeID: quote.blueprint.typeID,
    blueprintCopy: quote.state.original !== true,
    blueprintLocationID: quote.blueprint.locationID,
    blueprintLocationFlagID: quote.blueprint.flagID,
    facilityID: quote.facility.facilityID,
    ownerID: quote.ownerID,
    status: INDUSTRY_STATUS.INSTALLED,
    installerID: toInt(session && session.characterID, 0),
    completedCharacterID: 0,
    solarSystemID: quote.facility.solarSystemID,
    stationID: getStationIDForFacility(quote.facility.facilityID),
    startDate: nowFiletime.toString(),
    endDate: (nowFiletime + BigInt(Math.max(0, toInt(quote.timeInSeconds, 0))) * FILETIME_TICKS_PER_SECOND).toString(),
    pauseDate: null,
    runs: quote.runs,
    licensedRuns: quote.licensedRuns,
    successfulRuns: 0,
    cost: quote.cost,
    tax: quote.tax,
    totalCost: quote.totalCost,
    timeInSeconds: quote.timeInSeconds,
    probability: 1,
    productTypeID: quote.productTypeID,
    optionalTypeID: null,
    optionalTypeID2: null,
    outputLocationID: quote.outputLocation.itemID,
    outputFlagID: quote.outputLocation.flagID,
    inputLocationID: quote.inputLocation.itemID,
    inputFlagID: quote.inputLocation.flagID,
    account: cloneValue(quote.account),
    materials: cloneValue(quote.materialMap),
  };
  jobsTable.jobs[String(jobID)] = jobRecord;
  if (!persistJobsTable(jobsTable)) {
    throwWrappedUserError("CustomNotify", {
      notify: "Failed to persist the industry job.",
    });
  }

  const stateResult = updateBlueprintState(quote.blueprint.itemID, (current) => ({
    ...current,
    jobID,
  }));
  if (!stateResult.success) {
    throwWrappedUserError("CustomNotify", {
      notify: "Failed to lock the blueprint for industry.",
    });
  }

  const installMoveResult = moveBlueprintItemToInstalledLocation(jobRecord, session);
  if (!installMoveResult.success) {
    throwWrappedUserError("CustomNotify", {
      notify: "Failed to move the blueprint into installed items.",
    });
  }

  syncInventoryChanges(session, itemChanges);
  notifyBlueprintsUpdated(quote.ownerID);
  notifyIndustryJob(jobRecord);

  return {
    success: true,
    data: {
      jobID,
      quote,
      job: getJobByID(jobID),
    },
  };
}

function installManufacturingJob(session, requestInput) {
  return installIndustryJob(session, requestInput);
}

function finishBlueprintAfterDelivery(job, session) {
  const blueprintState = getBlueprintState(job.blueprintID);
  if (!blueprintState) {
    return;
  }
  if (blueprintState.original) {
    restoreBlueprintItemFromInstalledLocation(job, session);
    updateBlueprintState(job.blueprintID, (current) => ({
      ...current,
      jobID: null,
    }));
    return;
  }

  const remainingRuns = Math.max(0, toInt(blueprintState.runsRemaining, 0) - toInt(job.runs, 0));
  if (remainingRuns <= 0) {
    const item = findItemById(job.blueprintID);
    if (item) {
      const removeResult = removeInventoryItem(item.itemID, { removeContents: false });
      if (removeResult.success) {
        syncInventoryChanges(session, (removeResult.data && removeResult.data.changes) || []);
      }
    }
    removeBlueprintState(job.blueprintID);
    return;
  }

  restoreBlueprintItemFromInstalledLocation(job, session);
  updateBlueprintState(job.blueprintID, (current) => ({
    ...current,
    runsRemaining: remainingRuns,
    jobID: null,
  }));
}

function finishResearchBlueprintAfterDelivery(job, session) {
  restoreBlueprintItemFromInstalledLocation(job, session);
  updateBlueprintState(job.blueprintID, (current) => ({
    ...current,
    materialEfficiency:
      toInt(job && job.activityID, 0) === INDUSTRY_ACTIVITY.RESEARCH_MATERIAL
        ? Math.min(
            MAX_MATERIAL_EFFICIENCY,
            Math.max(0, toInt(current && current.materialEfficiency, 0)) +
              STEP_MATERIAL_EFFICIENCY * Math.max(0, toInt(job && job.runs, 0)),
          )
        : Math.max(0, toInt(current && current.materialEfficiency, 0)),
    timeEfficiency:
      toInt(job && job.activityID, 0) === INDUSTRY_ACTIVITY.RESEARCH_TIME
        ? Math.min(
            MAX_TIME_EFFICIENCY,
            Math.max(0, toInt(current && current.timeEfficiency, 0)) +
              STEP_TIME_EFFICIENCY * Math.max(0, toInt(job && job.runs, 0)),
          )
        : Math.max(0, toInt(current && current.timeEfficiency, 0)),
    jobID: null,
  }));
}

function applyBlueprintStateToGrantedCopies(grantResult, templateState) {
  const createdItems =
    grantResult &&
    grantResult.data &&
    Array.isArray(grantResult.data.items)
      ? grantResult.data.items
      : [];
  for (const item of createdItems) {
    updateBlueprintState(item.itemID, (state) => ({
      ...state,
      typeID: toInt(templateState && templateState.typeID, 0),
      materialEfficiency: Math.max(0, toInt(templateState && templateState.materialEfficiency, 0)),
      timeEfficiency: Math.max(0, toInt(templateState && templateState.timeEfficiency, 0)),
      original: false,
      runsRemaining: Math.max(1, toInt(templateState && templateState.runsRemaining, 1)),
      jobID: null,
    }));
  }
}

function deliverIndustryJob(session, jobID) {
  const currentJob = getJobByID(jobID);
  if (!currentJob) {
    throwWrappedUserError("CustomNotify", {
      notify: "That industry job could not be found.",
    });
  }
  if (!isCharacterOwner(session, currentJob.ownerID) && !hasCorporationIndustryJobAccess(session, currentJob.ownerID)) {
    throwWrappedUserError("CustomNotify", {
      notify: "You do not have access to that industry job.",
    });
  }
  if (getJobStatus(currentJob) !== INDUSTRY_STATUS.READY) {
    throwWrappedUserError("CustomNotify", {
      notify: "That industry job is not ready yet.",
    });
  }

  let grantResult = {
    success: true,
    data: {
      changes: [],
      items: [],
    },
  };
  if (toInt(currentJob.activityID, 0) === INDUSTRY_ACTIVITY.MANUFACTURING) {
    const definition = getBlueprintDefinitionByTypeID(currentJob.blueprintTypeID);
    const outputs = buildProductOutput(definition, currentJob.runs);
    const grantEntries = outputs.map((output) => ({
      itemType: output.typeID,
      quantity: output.quantity,
    }));
    grantResult =
      isCharacterOwner(session, currentJob.ownerID)
        ? grantItemsToCharacterLocation(
            currentJob.ownerID,
            currentJob.outputLocationID,
            currentJob.outputFlagID,
            grantEntries,
          )
        : grantItemsToOwnerLocation(
            currentJob.ownerID,
            currentJob.outputLocationID,
            currentJob.outputFlagID,
            grantEntries,
          );
    if (!grantResult.success) {
      throwWrappedUserError("CustomNotify", {
        notify: "Failed to deliver the industry job outputs.",
      });
    }
  } else if (toInt(currentJob.activityID, 0) === INDUSTRY_ACTIVITY.COPYING) {
    const sourceBlueprintState = getBlueprintState(currentJob.blueprintID) || {};
    const copyEntries = buildCopyOutputBlueprintEntries(
      currentJob,
      currentJob.outputLocationID,
      currentJob.outputFlagID,
    );
    grantResult =
      isCharacterOwner(session, currentJob.ownerID)
        ? grantItemsToCharacterLocation(
            currentJob.ownerID,
            currentJob.outputLocationID,
            currentJob.outputFlagID,
            copyEntries.map((entry) => ({
              itemType: entry.itemType,
              quantity: entry.quantity,
              options: entry.options,
            })),
          )
        : grantItemsToOwnerLocation(
            currentJob.ownerID,
            currentJob.outputLocationID,
            currentJob.outputFlagID,
            copyEntries.map((entry) => ({
              itemType: entry.itemType,
              quantity: entry.quantity,
              options: entry.options,
            })),
          );
    if (!grantResult.success) {
      throwWrappedUserError("CustomNotify", {
        notify: "Failed to deliver the blueprint copies.",
      });
    }
    applyBlueprintStateToGrantedCopies(grantResult, {
      typeID: currentJob.blueprintTypeID,
      materialEfficiency: Math.max(0, toInt(sourceBlueprintState.materialEfficiency, 0)),
      timeEfficiency: Math.max(0, toInt(sourceBlueprintState.timeEfficiency, 0)),
      runsRemaining: currentJob.licensedRuns,
    });
  }

  const jobsTable = ensureJobsTable();
  jobsTable.jobs[String(currentJob.jobID)] = {
    ...currentJob,
    status: INDUSTRY_STATUS.DELIVERED,
    completedCharacterID: toInt(session && session.characterID, 0),
    successfulRuns: currentJob.runs,
    deliveredAt: currentFileTime().toString(),
  };
  persistJobsTable(jobsTable);

  if (
    toInt(currentJob.activityID, 0) === INDUSTRY_ACTIVITY.RESEARCH_TIME ||
    toInt(currentJob.activityID, 0) === INDUSTRY_ACTIVITY.RESEARCH_MATERIAL
  ) {
    finishResearchBlueprintAfterDelivery(currentJob, session);
  } else {
    finishBlueprintAfterDelivery(currentJob, session);
  }
  syncInventoryChanges(session, (grantResult.data && grantResult.data.changes) || []);
  notifyBlueprintsUpdated(currentJob.ownerID);
  notifyIndustryJob(jobsTable.jobs[String(currentJob.jobID)]);

  return {
    success: true,
    data: getJobByID(currentJob.jobID),
  };
}

function deliverManufacturingJob(session, jobID) {
  return deliverIndustryJob(session, jobID);
}

function markIndustryJobReady(jobID) {
  const currentJob = getJobByID(jobID);
  if (!currentJob) {
    return {
      success: false,
      errorMsg: "JOB_NOT_FOUND",
    };
  }
  if (toInt(currentJob.status, 0) >= INDUSTRY_STATUS.COMPLETED) {
    return {
      success: true,
      data: currentJob,
    };
  }

  const jobsTable = ensureJobsTable();
  const updatedJob = {
    ...jobsTable.jobs[String(currentJob.jobID)],
    status: INDUSTRY_STATUS.READY,
    endDate: (currentFileTime() - 1n).toString(),
    pauseDate: null,
  };
  jobsTable.jobs[String(currentJob.jobID)] = updatedJob;
  if (!persistJobsTable(jobsTable)) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  notifyIndustryJob(updatedJob);

  return {
    success: true,
    data: getJobByID(currentJob.jobID),
  };
}

function cancelIndustryJob(session, jobID) {
  const currentJob = getJobByID(jobID);
  if (!currentJob) {
    throwWrappedUserError("CustomNotify", {
      notify: "That industry job could not be found.",
    });
  }
  if (!isCharacterOwner(session, currentJob.ownerID) && !hasCorporationIndustryJobAccess(session, currentJob.ownerID)) {
    throwWrappedUserError("CustomNotify", {
      notify: "You do not have access to that industry job.",
    });
  }

  const jobsTable = ensureJobsTable();
  jobsTable.jobs[String(currentJob.jobID)] = {
    ...currentJob,
    status: INDUSTRY_STATUS.CANCELLED,
    completedCharacterID: toInt(session && session.characterID, 0),
    successfulRuns: 0,
    cancelledAt: currentFileTime().toString(),
  };
  persistJobsTable(jobsTable);
  restoreBlueprintItemFromInstalledLocation(currentJob, session);
  updateBlueprintState(currentJob.blueprintID, (state) => ({
    ...state,
    jobID: null,
  }));
  notifyBlueprintsUpdated(currentJob.ownerID);
  notifyIndustryJob(jobsTable.jobs[String(currentJob.jobID)]);
  return {
    success: true,
    data: getJobByID(currentJob.jobID),
  };
}

function getJobCountsByInstaller(installerID) {
  const counts = {};
  for (const job of Object.values(ensureJobsTable().jobs || {})) {
    if (toInt(job && job.installerID, 0) !== toInt(installerID, 0)) {
      continue;
    }
    const status = getJobStatus(job);
    if (status >= INDUSTRY_STATUS.COMPLETED) {
      continue;
    }
    const activityID = toInt(job.activityID, 0);
    counts[activityID] = (counts[activityID] || 0) + 1;
  }
  return counts;
}

function resolveMonitorAvailableMaterials(session, request) {
  const blueprint = getBlueprintByItemID(request && request.blueprintID);
  const definition = getBlueprintDefinitionByTypeID(blueprint && blueprint.typeID);
  const activity = getIndustryActivity(definition, request && request.activityID);
  if (!blueprint || !definition || !activity) {
    return {};
  }

  const ownerID = toInt(blueprint.ownerID, 0);
  const facility = getFacilityPayloadByID(request && request.facilityID);

  let inputLocation = null;
  if (facility) {
    inputLocation = normalizeLocationForFacility(
      facility,
      ownerID,
      request && request.inputLocation,
      blueprint,
      session,
      { requireTake: true },
    );
  }
  if (!inputLocation && request && request.inputLocation) {
    inputLocation = {
      ...request.inputLocation,
      ownerID: toInt(request.inputLocation.ownerID || ownerID, ownerID),
    };
  }
  if (!inputLocation || inputLocation.canTake === false) {
    return {};
  }

  return resolveAvailableMaterials(ownerID, inputLocation);
}

function connectMonitor(session, requestInput) {
  const request =
    requestInput && requestInput.rawRequest
      ? requestInput
      : parseIndustryRequest(requestInput);
  const runtimeTable = ensureRuntimeTable();
  const monitorID = Math.max(MONITOR_ID_START, toInt(runtimeTable._meta.nextMonitorID, MONITOR_ID_START));
  runtimeTable._meta.nextMonitorID = monitorID + 1;
  runtimeTable.monitors[String(monitorID)] = {
    monitorID,
    activityID: toInt(request.activityID, 0),
    blueprintID: toInt(request.blueprintID, 0),
    createdAt: Date.now(),
  };
  persistRuntimeTable(runtimeTable);
  return {
    success: true,
    data: {
      monitorID,
      availableMaterials: resolveMonitorAvailableMaterials(session, request),
    },
  };
}

function disconnectMonitor(monitorID) {
  const runtimeTable = ensureRuntimeTable();
  delete runtimeTable.monitors[String(toInt(monitorID, 0))];
  persistRuntimeTable(runtimeTable);
  return {
    success: true,
  };
}

function seedBlueprintForOwner(ownerID, locationID, options = {}) {
  const blueprintTypeID = toInt(options.blueprintTypeID, 0);
  const isOriginal = options.original !== false;
  const corporationOwned = options.isCorporation === true || options.ownerMode === "corp";
  const flagID = toInt(
    options.flagID,
    corporationOwned ? ITEM_FLAG_CORP_HANGAR_1 : ITEM_FLAGS.HANGAR,
  );
  const createResult =
    !corporationOwned
      ? grantItemsToCharacterLocation(
          ownerID,
          locationID,
          flagID,
          [{
            itemType: blueprintTypeID,
            quantity: 1,
            options: {
              singleton: isOriginal ? 1 : 2,
              itemName: options.itemName || null,
            },
          }],
        )
      : grantItemsToOwnerLocation(
          ownerID,
          locationID,
          flagID,
          [{
            itemType: blueprintTypeID,
            quantity: 1,
            options: {
              singleton: isOriginal ? 1 : 2,
              itemName: options.itemName || null,
            },
          }],
        );
  if (!createResult.success) {
    return createResult;
  }
  const blueprintItem = createResult.data.items[0];
  const stateResult = updateBlueprintState(blueprintItem.itemID, (state) => ({
    ...state,
    typeID: blueprintTypeID,
    materialEfficiency: toInt(options.materialEfficiency, 0),
    timeEfficiency: toInt(options.timeEfficiency, 0),
    original: isOriginal,
    runsRemaining: isOriginal ? -1 : Math.max(1, toInt(options.runsRemaining, 1)),
    jobID: null,
  }));
  return {
    success: stateResult.success,
    data: {
      item: blueprintItem,
      state: stateResult.data,
      changes: createResult.data.changes || [],
    },
    errorMsg: stateResult.errorMsg || null,
  };
}

module.exports = {
  buildManufacturingMaterials,
  cancelIndustryJob,
  connectMonitor,
  deliverIndustryJob,
  deliverManufacturingJob,
  disconnectMonitor,
  getBlueprintByItemID,
  getBlueprintState,
  getJobByID,
  getJobCountsByInstaller,
  installIndustryJob,
  installManufacturingJob,
  listBlueprintInstancesByOwner,
  listFacilitiesForSession,
  listJobsByOwner,
  markIndustryJobReady,
  quoteIndustryJob,
  quoteManufacturingJob,
  removeBlueprintState,
  resolveAvailableMaterials,
  resolveFacilityLocations,
  seedBlueprintForOwner,
  updateBlueprintState,
};
