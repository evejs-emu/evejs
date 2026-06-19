const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const log = require(path.join(__dirname, "../../utils/logger"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const { resolveItemByTypeID } = require(path.join(
  __dirname,
  "./itemTypeRegistry",
));
const { resolveShipByTypeID } = require(path.join(
  __dirname,
  "../chat/shipTypeRegistry",
));
const {
  resolveRuntimeWreckRadius,
} = require(path.join(__dirname, "./wreckRadius"));
const {
  reserveItemIDs,
} = require(path.join(__dirname, "../_shared/identityAllocator"));
const {
  FUEL_BAY_FLAG,
} = require(path.join(__dirname, "./fuelBayInventory"));

// Fitting flag ranges (hi/med/lo slots, rigs, subsystems, service slots).
// Duplicated from liveFittingState to avoid circular dependency.
const FITTING_FLAG_RANGES = Object.freeze([
  [11, 34],
  [92, 99],
  [125, 132],
  [164, 171],
]);

function isFittingFlag(flagID) {
  const f = Number(flagID) || 0;
  return FITTING_FLAG_RANGES.some(([lo, hi]) => f >= lo && f <= hi);
}

const CHARACTERS_TABLE = "characters";
const ITEMS_TABLE = "items";
const SHIP_CATEGORY_ID = 6;
const BLUEPRINT_CATEGORY_ID = 9;
const DEFAULT_SHIP_TYPE_ID = 606;
const CAPSULE_TYPE_ID = 670;
const ITEM_FLAGS = {
  HANGAR: 4,
  CARGO_HOLD: 5,
  FUEL_BAY: FUEL_BAY_FLAG,
  DRONE_BAY: 87,
  SHIP_HANGAR: 90,
  FIGHTER_BAY: 158,
  FIGHTER_TUBE_0: 159,
  FIGHTER_TUBE_1: 160,
  FIGHTER_TUBE_2: 161,
  FIGHTER_TUBE_3: 162,
  FIGHTER_TUBE_4: 163,
  STRUCTURE_DEED: 180,
  GENERAL_MINING_HOLD: 134,
  SPECIALIZED_COMMAND_CENTER_HOLD: 148,
  SPECIALIZED_MATERIAL_BAY: 151,
  SPECIALIZED_GAS_HOLD: 135,
  SPECIALIZED_ICE_HOLD: 181,
  SPECIALIZED_ASTEROID_HOLD: 182,
  COLONY_RESOURCES_HOLD: 185,
};
const STRUCTURE_DEED_GROUP_ID = 4086;
const FIGHTER_TUBE_FLAGS = Object.freeze([
  ITEM_FLAGS.FIGHTER_TUBE_0,
  ITEM_FLAGS.FIGHTER_TUBE_1,
  ITEM_FLAGS.FIGHTER_TUBE_2,
  ITEM_FLAGS.FIGHTER_TUBE_3,
  ITEM_FLAGS.FIGHTER_TUBE_4,
]);
const JUNK_LOCATION_ID = 6;
const DEFAULT_SHIP_CONDITION_STATE = Object.freeze({
  damage: 0.0,
  charge: 1.0,
  armorDamage: 0.0,
  shieldCharge: 1.0,
  incapacitated: false,
});
const DEFAULT_MODULE_STATE = Object.freeze({
  online: false,
  damage: 0.0,
  charge: 0.0,
  skillPoints: 0,
  armorDamage: 0.0,
  shieldCharge: 0.0,
  incapacitated: false,
});
const CLIENT_INVENTORY_STACK_LIMIT = 2147483647;
const ITEM_ID_RESERVE_BATCH_SIZE = 128;

let migrationComplete = false;
let itemMutationVersion = 1;
let itemsTableCache = null;
let itemIndexesDirty = true;
let itemIndexesCache = null;
let reservedItemIDBatch = [];

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function maybeNotifyInsuranceInventoryMutation(
  previousItem,
  nextItem,
  reason = "inventory",
) {
  const previousCategoryID = toNumber(
    previousItem && previousItem.categoryID,
    0,
  );
  const nextCategoryID = toNumber(nextItem && nextItem.categoryID, 0);
  if (
    previousCategoryID !== SHIP_CATEGORY_ID &&
    nextCategoryID !== SHIP_CATEGORY_ID
  ) {
    return;
  }

  try {
    const insuranceRuntime = require(path.join(
      __dirname,
      "../insurance/insuranceRuntime",
    ));
    if (typeof insuranceRuntime.handleInventoryMutation === "function") {
      insuranceRuntime.handleInventoryMutation({
        previousItem: previousItem ? cloneValue(previousItem) : null,
        nextItem: nextItem ? cloneValue(nextItem) : null,
        reason,
      });
    }
  } catch (error) {
    log.warn(
      `[ItemStore] Insurance inventory hook failed item=${
        (nextItem && nextItem.itemID) ||
        (previousItem && previousItem.itemID) ||
        0
      }: ${error.message}`,
    );
  }
}

function notifyInsuranceInventoryMutationChanges(
  changes = [],
  reason = "inventory",
) {
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change || change.removed === true) {
      continue;
    }
    maybeNotifyInsuranceInventoryMutation(
      change.previousData || change.previousState || null,
      change.item || null,
      reason,
    );
  }
}

function normalizeTimestampMs(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
}

function readCharacters() {
  const result = database.read(CHARACTERS_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }

  return result.data;
}

function writeCharacters(data, options = {}) {
  const writeResult = database.write(CHARACTERS_TABLE, "/", data, options);
  return Boolean(writeResult && writeResult.success);
}

function readItems() {
  if (itemsTableCache) {
    return itemsTableCache;
  }
  const result = database.read(ITEMS_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }

  itemsTableCache = result.data;
  return itemsTableCache;
}

function writeItems(data, options = {}) {
  const writeResult = database.write(ITEMS_TABLE, "/", data, options);
  if (writeResult && writeResult.success) {
    itemsTableCache = data;
    itemIndexesDirty = true;
    itemIndexesCache = null;
    itemMutationVersion += 1;
    return true;
  }
  return false;
}

function getItemMutationVersion() {
  return itemMutationVersion;
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function appendIndexedItem(indexMap, key, item) {
  if (!Number.isFinite(Number(key))) {
    return;
  }
  if (!indexMap.has(key)) {
    indexMap.set(key, []);
  }
  indexMap.get(key).push(item);
}

function ensureItemIndexes() {
  ensureMigrated();
  if (!itemIndexesDirty && itemIndexesCache) {
    return itemIndexesCache;
  }

  const nextIndexes = {
    byID: new Map(),
    byLocation: new Map(),
    byOwner: new Map(),
  };

  for (const rawItem of Object.values(readItems())) {
    const item = normalizeInventoryItem(rawItem);
    if (!item) {
      continue;
    }
    nextIndexes.byID.set(item.itemID, item);
    appendIndexedItem(nextIndexes.byLocation, item.locationID, item);
    appendIndexedItem(nextIndexes.byOwner, item.ownerID, item);
  }

  for (const indexMap of [
    nextIndexes.byLocation,
    nextIndexes.byOwner,
  ]) {
    for (const items of indexMap.values()) {
      items.sort((left, right) => left.itemID - right.itemID);
    }
  }

  itemIndexesCache = nextIndexes;
  itemIndexesDirty = false;
  return itemIndexesCache;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeSpaceVector(rawValue, fallback = { x: 0, y: 0, z: 0 }) {
  if (!rawValue || typeof rawValue !== "object") {
    return {
      x: fallback.x,
      y: fallback.y,
      z: fallback.z,
    };
  }

  return {
    x: toFiniteNumber(rawValue.x, fallback.x),
    y: toFiniteNumber(rawValue.y, fallback.y),
    z: toFiniteNumber(rawValue.z, fallback.z),
  };
}

function normalizeDunRotation(rawValue) {
  if (!Array.isArray(rawValue) || rawValue.length < 3) {
    return null;
  }

  return [
    toFiniteNumber(rawValue[0], 0),
    toFiniteNumber(rawValue[1], 0),
    toFiniteNumber(rawValue[2], 0),
  ];
}

function normalizeSpaceState(rawValue) {
  if (!rawValue || typeof rawValue !== "object") {
    return null;
  }

  const normalizedMode = ["GOTO", "FOLLOW", "WARP", "ORBIT"].includes(rawValue.mode)
    ? rawValue.mode
    : "STOP";

  return {
    systemID: toNumber(rawValue.systemID, 0),
    position: normalizeSpaceVector(rawValue.position),
    velocity: normalizeSpaceVector(rawValue.velocity),
    direction: normalizeSpaceVector(rawValue.direction, { x: 1, y: 0, z: 0 }),
    targetPoint: rawValue.targetPoint
      ? normalizeSpaceVector(rawValue.targetPoint)
      : null,
    speedFraction: toFiniteNumber(rawValue.speedFraction, 0),
    mode: normalizedMode,
    targetEntityID: rawValue.targetEntityID
      ? toNumber(rawValue.targetEntityID, 0)
      : null,
    followRange: toFiniteNumber(rawValue.followRange, 0),
    orbitDistance: toFiniteNumber(rawValue.orbitDistance, 0),
    orbitNormal: rawValue.orbitNormal
      ? normalizeSpaceVector(rawValue.orbitNormal, { x: 0, y: 1, z: 0 })
      : null,
    orbitSign: toFiniteNumber(rawValue.orbitSign, 1) < 0 ? -1 : 1,
    warpState:
      rawValue.warpState && typeof rawValue.warpState === "object"
        ? {
            startTimeMs: toFiniteNumber(rawValue.warpState.startTimeMs, Date.now()),
            durationMs: toFiniteNumber(rawValue.warpState.durationMs, 0),
            accelTimeMs: toFiniteNumber(rawValue.warpState.accelTimeMs, 0),
            cruiseTimeMs: toFiniteNumber(rawValue.warpState.cruiseTimeMs, 0),
            decelTimeMs: toFiniteNumber(rawValue.warpState.decelTimeMs, 0),
            totalDistance: toFiniteNumber(rawValue.warpState.totalDistance, 0),
            stopDistance: toFiniteNumber(rawValue.warpState.stopDistance, 0),
            maxWarpSpeedMs: toFiniteNumber(rawValue.warpState.maxWarpSpeedMs, 0),
            warpSpeed: toNumber(rawValue.warpState.warpSpeed, 0),
            effectStamp: toNumber(rawValue.warpState.effectStamp, 0),
            targetEntityID: rawValue.warpState.targetEntityID
              ? toNumber(rawValue.warpState.targetEntityID, 0)
              : null,
            followID: rawValue.warpState.followID
              ? toNumber(rawValue.warpState.followID, 0)
              : null,
            followRangeMarker: toFiniteNumber(
              rawValue.warpState.followRangeMarker,
              rawValue.warpState.stopDistance,
            ),
            origin: rawValue.warpState.origin
              ? normalizeSpaceVector(rawValue.warpState.origin)
              : null,
            rawDestination: rawValue.warpState.rawDestination
              ? normalizeSpaceVector(rawValue.warpState.rawDestination)
              : null,
            targetPoint: rawValue.warpState.targetPoint
              ? normalizeSpaceVector(rawValue.warpState.targetPoint)
              : null,
          }
        : null,
  };
}

function normalizeFighterState(rawValue) {
  if (!rawValue || typeof rawValue !== "object") {
    return null;
  }

  const normalized = {};
  const tubeFlagID = toNumber(rawValue.tubeFlagID, 0);
  const controllerID = toNumber(rawValue.controllerID, 0);
  const controllerOwnerID = toNumber(rawValue.controllerOwnerID, 0);

  if (tubeFlagID > 0) {
    normalized.tubeFlagID = tubeFlagID;
  }
  if (controllerID > 0) {
    normalized.controllerID = controllerID;
  }
  if (controllerOwnerID > 0) {
    normalized.controllerOwnerID = controllerOwnerID;
  }

  const abilityStates = normalizeFighterAbilityStates(rawValue.abilityStates);
  if (abilityStates) {
    normalized.abilityStates = abilityStates;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeFighterAbilitySlotState(rawValue) {
  if (!rawValue || typeof rawValue !== "object") {
    return null;
  }

  const normalized = {};
  const activeSinceMs = toFiniteNumber(rawValue.activeSinceMs, null);
  const durationMs = toFiniteNumber(rawValue.durationMs, null);
  const activeUntilMs = toFiniteNumber(rawValue.activeUntilMs, null);
  const cooldownStartMs = toFiniteNumber(rawValue.cooldownStartMs, null);
  const cooldownEndMs = toFiniteNumber(rawValue.cooldownEndMs, null);
  const remainingChargeCount = toNumber(rawValue.remainingChargeCount, null);
  const targetID = toNumber(rawValue.targetID, 0);
  const targetPoint =
    rawValue.targetPoint && typeof rawValue.targetPoint === "object"
      ? normalizeSpaceVector(rawValue.targetPoint)
      : null;

  if (activeSinceMs !== null && activeSinceMs >= 0) {
    normalized.activeSinceMs = activeSinceMs;
  }
  if (durationMs !== null && durationMs > 0) {
    normalized.durationMs = durationMs;
  }
  if (activeUntilMs !== null && activeUntilMs >= 0) {
    normalized.activeUntilMs = activeUntilMs;
  }
  if (cooldownStartMs !== null && cooldownStartMs >= 0) {
    normalized.cooldownStartMs = cooldownStartMs;
  }
  if (cooldownEndMs !== null && cooldownEndMs >= 0) {
    normalized.cooldownEndMs = cooldownEndMs;
  }
  if (remainingChargeCount !== null && remainingChargeCount >= 0) {
    normalized.remainingChargeCount = remainingChargeCount;
  }
  if (targetID > 0) {
    normalized.targetID = targetID;
  }
  if (targetPoint) {
    normalized.targetPoint = targetPoint;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeFighterAbilityStates(rawValue) {
  if (!rawValue || typeof rawValue !== "object") {
    return null;
  }

  const normalized = {};
  for (const [slotID, slotState] of Object.entries(rawValue)) {
    const numericSlotID = toNumber(slotID, -1);
    if (numericSlotID < 0 || numericSlotID > 2) {
      continue;
    }

    const normalizedState = normalizeFighterAbilitySlotState(slotState);
    if (normalizedState) {
      normalized[numericSlotID] = normalizedState;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeShipConditionState(rawValue) {
  const source =
    rawValue && typeof rawValue === "object" ? rawValue : DEFAULT_SHIP_CONDITION_STATE;

  return {
    damage: toFiniteNumber(source.damage, DEFAULT_SHIP_CONDITION_STATE.damage),
    charge: toFiniteNumber(source.charge, DEFAULT_SHIP_CONDITION_STATE.charge),
    armorDamage: toFiniteNumber(
      source.armorDamage,
      DEFAULT_SHIP_CONDITION_STATE.armorDamage,
    ),
    shieldCharge: toFiniteNumber(
      source.shieldCharge,
      DEFAULT_SHIP_CONDITION_STATE.shieldCharge,
    ),
    incapacitated: Boolean(
      source.incapacitated ?? DEFAULT_SHIP_CONDITION_STATE.incapacitated,
    ),
  };
}

function normalizeModuleState(rawValue) {
  if (rawValue === undefined) {
    return undefined;
  }

  const source =
    rawValue && typeof rawValue === "object" ? rawValue : DEFAULT_MODULE_STATE;

  const normalizedState = {
    online: Boolean(source.online),
    damage: toFiniteNumber(source.damage, DEFAULT_MODULE_STATE.damage),
    charge: toFiniteNumber(source.charge, DEFAULT_MODULE_STATE.charge),
    skillPoints: toNumber(source.skillPoints, DEFAULT_MODULE_STATE.skillPoints),
    armorDamage: toFiniteNumber(
      source.armorDamage,
      DEFAULT_MODULE_STATE.armorDamage,
    ),
    shieldCharge: toFiniteNumber(
      source.shieldCharge,
      DEFAULT_MODULE_STATE.shieldCharge,
    ),
    incapacitated: Boolean(source.incapacitated),
  };
  for (const key of [
    "serviceFuelOnlineAt",
    "serviceFuelLastCycleAt",
    "serviceFuelNextCycleAt",
  ]) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const value = source[key];
      normalizedState[key] =
        value === null || value === undefined
          ? null
          : toNumber(value, null);
    }
  }
  return normalizedState;
}

function normalizePositiveInteger(value, fallback = 1) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function normalizePositiveSafeInteger(value, fallback = null) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function isStackableInventoryItem(item) {
  return Boolean(item) && toNumber(item.singleton, 0) === 0;
}

function getStackableItemQuantity(item) {
  if (!item) {
    return 0;
  }
  if (!isStackableInventoryItem(item)) {
    return 1;
  }
  return Math.max(
    0,
    toNumber(item.quantity, 0),
    toNumber(item.stacksize, 0),
  );
}

function splitStackQuantityIntoClientSafeChunks(totalQuantity) {
  const normalizedQuantity = normalizePositiveSafeInteger(totalQuantity, 0);
  if (normalizedQuantity <= 0) {
    return [];
  }

  const chunks = [];
  let remainingQuantity = normalizedQuantity;
  while (remainingQuantity > 0) {
    const chunkQuantity = Math.min(
      remainingQuantity,
      CLIENT_INVENTORY_STACK_LIMIT,
    );
    chunks.push(chunkQuantity);
    remainingQuantity -= chunkQuantity;
  }

  return chunks;
}

function appendStackIndexEntry(stackIndex, item) {
  if (!stackIndex || !isStackableInventoryItem(item)) {
    return;
  }

  const stackKey = buildStackKey(
    item.ownerID,
    item.locationID,
    item.flagID,
    item.typeID,
  );
  let entries = stackIndex.get(stackKey);
  if (!entries) {
    entries = [];
    stackIndex.set(stackKey, entries);
  }

  const existingIndex = entries.findIndex(
    (candidate) => toNumber(candidate && candidate.itemID, 0) === toNumber(item.itemID, 0),
  );
  if (existingIndex >= 0) {
    entries[existingIndex] = item;
  } else {
    entries.push(item);
  }

  entries.sort((left, right) => toNumber(left.itemID, 0) - toNumber(right.itemID, 0));
}

function buildStackIndex(items) {
  const stackIndex = new Map();
  for (const rawItem of Object.values(items || {})) {
    const item = normalizeInventoryItem(rawItem);
    if (!isStackableInventoryItem(item)) {
      continue;
    }
    appendStackIndexEntry(stackIndex, item);
  }
  return stackIndex;
}

function findStackWithAvailableCapacity(
  stackIndex,
  ownerID,
  locationID,
  flagID,
  typeID,
) {
  const entries = stackIndex.get(
    buildStackKey(ownerID, locationID, flagID, typeID),
  ) || [];
  return entries.find(
    (candidate) => getStackableItemQuantity(candidate) < CLIENT_INVENTORY_STACK_LIMIT,
  ) || null;
}

function captureItemState(item) {
  if (!item || typeof item !== "object") {
    return {};
  }

  return {
    locationID: item.locationID,
    flagID: item.flagID,
    quantity: item.quantity,
    singleton: item.singleton,
    stacksize: item.stacksize,
    moduleState: Object.prototype.hasOwnProperty.call(item, "moduleState")
      ? cloneValue(item.moduleState)
      : undefined,
  };
}

function getItemMetadata(typeID, name = null) {
  const resolvedTypeID = toNumber(typeID, 0);
  const resolvedItem = resolveItemByTypeID(resolvedTypeID);
  if (resolvedItem) {
    return {
      ...resolvedItem,
      name: resolvedItem.name || name || "Item",
    };
  }

  const resolvedShip = resolveShipByTypeID(resolvedTypeID);
  if (resolvedShip) {
    return {
      ...resolvedShip,
      name: resolvedShip.name || name || "Ship",
      portionSize: 1,
      basePrice: null,
      marketGroupID: null,
      iconID: null,
      soundID: null,
      graphicID: null,
      raceID: null,
    };
  }

  return {
    typeID: resolvedTypeID,
    name: name || "Item",
    groupID: 0,
    categoryID: 0,
    groupName: "",
    mass: null,
    volume: null,
    capacity: null,
    portionSize: 1,
    raceID: null,
    basePrice: null,
    marketGroupID: null,
    iconID: null,
    soundID: null,
    graphicID: null,
    radius: null,
    published: true,
  };
}

function getShipMetadata(typeID, name = null) {
  const resolvedTypeID = toNumber(typeID, DEFAULT_SHIP_TYPE_ID);
  return (
    resolveShipByTypeID(resolvedTypeID) || {
      typeID: resolvedTypeID,
      name: name || "Ship",
      groupID: 25,
      categoryID: SHIP_CATEGORY_ID,
      mass: null,
      volume: null,
      capacity: null,
      radius: null,
    }
  );
}

function shouldItemDefaultToSingleton(metadata) {
  const categoryID = toNumber(metadata && metadata.categoryID, 0);
  return categoryID === SHIP_CATEGORY_ID || categoryID === BLUEPRINT_CATEGORY_ID;
}

function buildInventoryItem({
  itemID,
  typeID,
  ownerID,
  locationID,
  flagID = ITEM_FLAGS.HANGAR,
  itemName = null,
  quantity = null,
  stacksize = null,
  singleton = null,
  customInfo = "",
  spaceState = null,
  conditionState = null,
  moduleState = undefined,
  createdAtMs = null,
  expiresAtMs = null,
  launcherID = null,
  dunRotation = null,
  spaceRadius = null,
  stackOriginID = null,
  fighterState = null,
}) {
  const metadata = getItemMetadata(typeID, itemName);
  const defaultSingleton = shouldItemDefaultToSingleton(metadata) ? 1 : 0;
  const rawSingleton = singleton === null || singleton === undefined
    ? defaultSingleton
    : toNumber(singleton, defaultSingleton);
  const normalizedSingleton = rawSingleton === 2 ? 2 : rawSingleton > 0 ? 1 : 0;
  const normalizedUnits = normalizePositiveInteger(
    quantity === null || quantity === undefined ? stacksize : quantity,
    normalizePositiveInteger(metadata.portionSize, 1),
  );

  const item = {
    itemID: toNumber(itemID),
    typeID: toNumber(metadata.typeID, 0),
    ownerID: toNumber(ownerID),
    locationID: toNumber(locationID),
    flagID: toNumber(flagID, ITEM_FLAGS.HANGAR),
    quantity:
      normalizedSingleton === 2
        ? -2
        : normalizedSingleton === 1
          ? -1
          : normalizedUnits,
    stacksize: normalizedSingleton > 0 ? 1 : normalizedUnits,
    singleton: normalizedSingleton,
    groupID: toNumber(metadata.groupID, 0),
    categoryID: toNumber(metadata.categoryID, 0),
    customInfo: String(customInfo || ""),
    itemName: itemName || metadata.name || "Item",
    mass: toFiniteNumber(metadata.mass, 0),
    volume: toFiniteNumber(metadata.volume, 0),
    capacity: toFiniteNumber(metadata.capacity, 0),
    radius: toFiniteNumber(metadata.radius, 0),
  };
  const normalizedSpaceState = normalizeSpaceState(spaceState);
  const normalizedModuleState = normalizeModuleState(moduleState);
  const normalizedConditionState =
    conditionState === null || conditionState === undefined
      ? null
      : normalizeShipConditionState(conditionState);
  const normalizedCreatedAtMs = normalizeTimestampMs(createdAtMs);
  const normalizedExpiresAtMs = normalizeTimestampMs(expiresAtMs);
  const normalizedFighterState = normalizeFighterState(fighterState);

  if (normalizedCreatedAtMs !== null) {
    item.createdAtMs = normalizedCreatedAtMs;
  }
  if (normalizedExpiresAtMs !== null) {
    item.expiresAtMs = normalizedExpiresAtMs;
  }
  if (toNumber(launcherID, 0) > 0) {
    item.launcherID = toNumber(launcherID, 0);
  }
  if (toFiniteNumber(spaceRadius, 0) > 0) {
    item.spaceRadius = toFiniteNumber(spaceRadius, 0);
  }
  if (toNumber(stackOriginID, 0) > 0) {
    item.stackOriginID = toNumber(stackOriginID, 0);
  }
  const normalizedDunRotation = normalizeDunRotation(dunRotation);
  if (normalizedDunRotation) {
    item.dunRotation = normalizedDunRotation;
  }

  if (item.categoryID === SHIP_CATEGORY_ID) {
    item.spaceState = normalizedSpaceState;
    item.conditionState = normalizedConditionState || normalizeShipConditionState(null);
    if (item.flagID !== 0) {
      item.spaceState = null;
    }

    return {
      ...item,
      shipID: item.itemID,
      shipTypeID: item.typeID,
      shipName: item.itemName,
    };
  }

  if (item.flagID === 0 && normalizedSpaceState) {
    item.spaceState = normalizedSpaceState;
  }

  if (normalizedConditionState) {
    item.conditionState = normalizedConditionState;
  }

  if (normalizedModuleState !== undefined) {
    item.moduleState = normalizedModuleState;
  }
  if (normalizedFighterState) {
    item.fighterState = normalizedFighterState;
  }

  return item;
}

function buildShipItem({
  itemID,
  typeID,
  ownerID,
  locationID,
  flagID = ITEM_FLAGS.HANGAR,
  itemName = null,
  quantity = null,
  stacksize = 1,
  singleton = null,
  customInfo = "",
  spaceState = null,
  conditionState = null,
}) {
  const metadata = getShipMetadata(typeID, itemName);
  return buildInventoryItem({
    itemID,
    typeID: metadata.typeID,
    ownerID,
    locationID,
    flagID,
    itemName: itemName || metadata.name || "Ship",
    quantity,
    stacksize,
    singleton:
      singleton === null || singleton === undefined ? 1 : singleton,
    customInfo,
    spaceState,
    conditionState,
  });
}

function normalizeInventoryItem(rawItem, defaults = {}) {
  if (!rawItem || typeof rawItem !== "object") {
    return null;
  }

  const itemID = toNumber(rawItem.itemID ?? rawItem.shipID, 0);
  const typeID = toNumber(rawItem.typeID ?? rawItem.shipTypeID, 0);
  if (itemID <= 0 || typeID <= 0) {
    return null;
  }

  return buildInventoryItem({
    itemID,
    typeID,
    ownerID: rawItem.ownerID ?? defaults.ownerID ?? 0,
    locationID: rawItem.locationID ?? defaults.locationID ?? 0,
    flagID: rawItem.flagID ?? defaults.flagID ?? ITEM_FLAGS.HANGAR,
    itemName: rawItem.itemName ?? rawItem.shipName ?? defaults.itemName ?? null,
    quantity: rawItem.quantity ?? defaults.quantity ?? null,
    stacksize: rawItem.stacksize ?? defaults.stacksize ?? null,
    singleton: rawItem.singleton ?? defaults.singleton ?? null,
    customInfo: rawItem.customInfo ?? defaults.customInfo ?? "",
    spaceState: Object.prototype.hasOwnProperty.call(rawItem, "spaceState")
      ? rawItem.spaceState
      : defaults.spaceState ?? null,
    conditionState: Object.prototype.hasOwnProperty.call(rawItem, "conditionState")
      ? rawItem.conditionState
      : defaults.conditionState ?? null,
    moduleState: Object.prototype.hasOwnProperty.call(rawItem, "moduleState")
      ? rawItem.moduleState
      : defaults.moduleState,
    createdAtMs: Object.prototype.hasOwnProperty.call(rawItem, "createdAtMs")
      ? rawItem.createdAtMs
      : defaults.createdAtMs ?? null,
    expiresAtMs: Object.prototype.hasOwnProperty.call(rawItem, "expiresAtMs")
      ? rawItem.expiresAtMs
      : defaults.expiresAtMs ?? null,
    launcherID: Object.prototype.hasOwnProperty.call(rawItem, "launcherID")
      ? rawItem.launcherID
      : defaults.launcherID ?? null,
    spaceRadius: Object.prototype.hasOwnProperty.call(rawItem, "spaceRadius")
      ? rawItem.spaceRadius
      : defaults.spaceRadius ?? null,
    stackOriginID: Object.prototype.hasOwnProperty.call(rawItem, "stackOriginID")
      ? rawItem.stackOriginID
      : defaults.stackOriginID ?? null,
    dunRotation: Object.prototype.hasOwnProperty.call(rawItem, "dunRotation")
      ? rawItem.dunRotation
      : defaults.dunRotation ?? null,
    fighterState: Object.prototype.hasOwnProperty.call(rawItem, "fighterState")
      ? rawItem.fighterState
      : defaults.fighterState ?? null,
  });
}

function normalizeShipItem(rawItem, defaults = {}) {
  const normalizedItem = normalizeInventoryItem(rawItem, defaults);
  return normalizedItem && normalizedItem.categoryID === SHIP_CATEGORY_ID
    ? normalizedItem
    : null;
}

function getStructureState() {
  return require(path.join(__dirname, "../structure/structureState"));
}

function collectLegacyShips(charId, record) {
  const collected = [];
  const seen = new Set();

  const addShip = (candidate) => {
    const normalized = normalizeShipItem(candidate, {
      ownerID: charId,
      locationID: record.stationID || 60003760,
      flagID: ITEM_FLAGS.HANGAR,
    });
    if (!normalized || seen.has(normalized.itemID)) {
      return;
    }

    seen.add(normalized.itemID);
    collected.push(normalized);
  };

  if (Array.isArray(record.storedShips)) {
    for (const ship of record.storedShips) {
      addShip(ship);
    }
  }

  addShip({
    itemID: record.shipID || charId + 100,
    typeID: record.shipTypeID || DEFAULT_SHIP_TYPE_ID,
    itemName: record.shipName || null,
  });

  return collected;
}

function getLocalItemIDHighWaterMark(charId, items, characterRecord = null) {
  let maxItemID = toNumber(charId, 0) + 100;
  const record = characterRecord || null;

  if (record && record.shipID && toNumber(record.shipID, 0) > maxItemID) {
    maxItemID = toNumber(record.shipID, maxItemID);
  }

  for (const rawItem of Object.values(items)) {
    const item = normalizeInventoryItem(rawItem);
    if (!item) {
      continue;
    }

    if (item.itemID > maxItemID) {
      maxItemID = item.itemID;
    }
  }

  return maxItemID;
}

function nextItemID(charId, items, characterRecord = null) {
  if (!Array.isArray(reservedItemIDBatch) || reservedItemIDBatch.length <= 0) {
    const localHighWaterMark =
      getLocalItemIDHighWaterMark(charId, items, characterRecord) + 1;
    reservedItemIDBatch = reserveItemIDs(ITEM_ID_RESERVE_BATCH_SIZE, {
      minCandidate: localHighWaterMark,
    });
  }

  const allocatedItemID = toNumber(
    reservedItemIDBatch.shift(),
    0,
  );
  if (allocatedItemID <= 0) {
    return getLocalItemIDHighWaterMark(charId, items, characterRecord) + 1;
  }
  return allocatedItemID;
}

function repairOversizedStackableItems(items, characters = {}) {
  let itemsDirty = false;
  const repairs = [];
  const stackableItems = Object.values(items || {})
    .map((rawItem) => normalizeInventoryItem(rawItem))
    .filter((item) => isStackableInventoryItem(item))
    .sort((left, right) => toNumber(left.itemID, 0) - toNumber(right.itemID, 0));

  for (const item of stackableItems) {
    const currentQuantity = getStackableItemQuantity(item);
    if (currentQuantity <= CLIENT_INVENTORY_STACK_LIMIT) {
      continue;
    }

    const chunks = splitStackQuantityIntoClientSafeChunks(currentQuantity);
    if (chunks.length === 0) {
      continue;
    }

    const [primaryChunk, ...overflowChunks] = chunks;
    const updatedPrimary = buildInventoryItem({
      ...item,
      quantity: primaryChunk,
      stacksize: primaryChunk,
      singleton: 0,
    });
    items[String(updatedPrimary.itemID)] = updatedPrimary;

    const ownerRecord = characters[String(toNumber(item.ownerID, 0))] || null;
    const stackOriginID =
      toNumber(item.stackOriginID, 0) > 0
        ? toNumber(item.stackOriginID, 0)
        : toNumber(item.itemID, 0);

    for (const chunkQuantity of overflowChunks) {
      const splitItem = buildInventoryItem({
        ...item,
        itemID: nextItemID(item.ownerID, items, ownerRecord),
        quantity: chunkQuantity,
        stacksize: chunkQuantity,
        singleton: 0,
        stackOriginID,
      });
      items[String(splitItem.itemID)] = splitItem;
    }

    repairs.push({
      itemID: toNumber(item.itemID, 0),
      ownerID: toNumber(item.ownerID, 0),
      typeID: toNumber(item.typeID, 0),
      originalQuantity: currentQuantity,
      resultingStacks: chunks.length,
    });
    itemsDirty = true;
  }

  return {
    itemsDirty,
    repairs,
  };
}

function applyStackableGrant({
  ownerID,
  locationID,
  flagID,
  metadata,
  quantity,
  options = {},
  items,
  stackIndex,
  changes,
  createdItems,
  transientCreatedItemIDs,
  characterRecord = null,
}) {
  let remainingQuantity = quantity;
  let stackTouchCount = 0;
  let splitApplied = false;

  while (remainingQuantity > 0) {
    const existingStack = findStackWithAvailableCapacity(
      stackIndex,
      ownerID,
      locationID,
      flagID,
      metadata.typeID,
    );

    if (existingStack) {
      const currentQuantity = getStackableItemQuantity(existingStack);
      const availableCapacity = Math.max(
        0,
        CLIENT_INVENTORY_STACK_LIMIT - currentQuantity,
      );
      if (availableCapacity > 0) {
        const mergedQuantity = Math.min(remainingQuantity, availableCapacity);
        const previousState = captureItemState(existingStack);
        const updatedItem = buildInventoryItem({
          ...existingStack,
          quantity: currentQuantity + mergedQuantity,
          stacksize: currentQuantity + mergedQuantity,
          singleton: 0,
        });
        items[String(updatedItem.itemID)] = updatedItem;
        appendStackIndexEntry(stackIndex, updatedItem);
        changes.push({
          created: false,
          item: cloneValue(updatedItem),
          previousState,
        });
        createdItems.push(cloneValue(updatedItem));
        remainingQuantity -= mergedQuantity;
        stackTouchCount += 1;
        splitApplied = splitApplied || remainingQuantity > 0;
        continue;
      }
    }

    const chunkQuantity = Math.min(
      remainingQuantity,
      CLIENT_INVENTORY_STACK_LIMIT,
    );
    const item = buildInventoryItem({
      itemID: nextItemID(ownerID, items, characterRecord),
      typeID: metadata.typeID,
      ownerID,
      locationID,
      flagID,
      itemName: options.itemName || metadata.name,
      quantity: chunkQuantity,
      stacksize: chunkQuantity,
      singleton: 0,
      customInfo: options.customInfo || "",
      spaceState: options.spaceState || null,
      conditionState: options.conditionState || null,
      moduleState: options.moduleState,
      createdAtMs: options.createdAtMs ?? null,
      expiresAtMs: options.expiresAtMs ?? null,
      launcherID: options.launcherID ?? null,
      dunRotation: options.dunRotation ?? null,
      spaceRadius: options.spaceRadius ?? null,
    });
    items[String(item.itemID)] = item;
    appendStackIndexEntry(stackIndex, item);
    changes.push({
      created: true,
      item: cloneValue(item),
      previousState: {
        locationID: 0,
        flagID: 0,
      },
    });
    createdItems.push(cloneValue(item));
    if (options.transient === true) {
      transientCreatedItemIDs.push(item.itemID);
    }
    remainingQuantity -= chunkQuantity;
    stackTouchCount += 1;
    splitApplied =
      splitApplied ||
      chunkQuantity !== quantity ||
      remainingQuantity > 0;
  }

  return {
    stackTouchCount,
    splitApplied,
  };
}

function ensureMigrated() {
  if (migrationComplete) {
    return;
  }

  const characters = readCharacters();
  const items = readItems();
  let itemsDirty = false;
  let charactersDirty = false;

  for (const [charIdKey, rawRecord] of Object.entries(characters)) {
    const charId = toNumber(charIdKey, 0);
    const stationID = toNumber(rawRecord.stationID, 60003760);
    const legacyShips = collectLegacyShips(charId, rawRecord);

    for (const legacyShip of legacyShips) {
      if (!items[String(legacyShip.itemID)]) {
        items[String(legacyShip.itemID)] = normalizeShipItem(legacyShip, {
          ownerID: charId,
          locationID: stationID,
          flagID: ITEM_FLAGS.HANGAR,
        });
        itemsDirty = true;
      }
    }

    let characterShipItems = Object.values(items)
      .map((entry) => normalizeShipItem(entry))
      .filter(
        (entry) =>
          entry &&
          entry.ownerID === charId &&
          entry.categoryID === SHIP_CATEGORY_ID,
      )
      .sort((left, right) => left.itemID - right.itemID);

    if (characterShipItems.length === 0) {
      const starterShip = buildShipItem({
        itemID: nextItemID(charId, items, rawRecord),
        typeID: rawRecord.shipTypeID || DEFAULT_SHIP_TYPE_ID,
        ownerID: charId,
        locationID: stationID,
        flagID: ITEM_FLAGS.HANGAR,
        itemName: rawRecord.shipName || null,
      });
      items[String(starterShip.itemID)] = starterShip;
      itemsDirty = true;
      characterShipItems = [starterShip];
    }

    const activeShip =
      characterShipItems.find(
        (entry) => entry.itemID === toNumber(rawRecord.shipID, 0),
      ) || characterShipItems[0];

    const nextRecord = {
      ...rawRecord,
      shipID: activeShip.itemID,
      shipTypeID: activeShip.typeID,
      shipName: activeShip.itemName,
    };

    if (Object.prototype.hasOwnProperty.call(nextRecord, "storedShips")) {
      delete nextRecord.storedShips;
    }

    if (JSON.stringify(rawRecord) !== JSON.stringify(nextRecord)) {
      characters[charIdKey] = nextRecord;
      charactersDirty = true;
    }
  }

  const stackRepairResult = repairOversizedStackableItems(items, characters);
  if (stackRepairResult.itemsDirty) {
    itemsDirty = true;
    for (const repair of stackRepairResult.repairs) {
      log.warn(
        `[ItemStore] Repaired oversized stack item=${repair.itemID} owner=${repair.ownerID} type=${repair.typeID} quantity=${repair.originalQuantity} into ${repair.resultingStacks} client-safe stacks`,
      );
    }
  }

  if (itemsDirty && !writeItems(items)) {
    log.warn("[ItemStore] Failed to persist migrated items table");
  }

  if (charactersDirty && !writeCharacters(characters)) {
    log.warn("[ItemStore] Failed to persist migrated characters table");
  }

  migrationComplete = true;
}

function getAllItems() {
  ensureMigrated();
  return cloneValue(readItems());
}

function listOwnedItems(ownerId, options = {}) {
  ensureMigrated();
  const numericOwnerId = toNumber(ownerId, 0);
  const locationID =
    options.locationID === undefined || options.locationID === null
      ? null
      : toNumber(options.locationID, 0);
  const flagID =
    options.flagID === undefined || options.flagID === null
      ? null
      : toNumber(options.flagID, ITEM_FLAGS.HANGAR);
  const categoryID =
    options.categoryID === undefined || options.categoryID === null
      ? null
      : toNumber(options.categoryID, 0);
  const typeID =
    options.typeID === undefined || options.typeID === null
      ? null
      : toNumber(options.typeID, 0);

  return (ensureItemIndexes().byOwner.get(numericOwnerId) || [])
    .filter(
      (entry) =>
        entry &&
        (locationID === null || entry.locationID === locationID) &&
        (flagID === null || entry.flagID === flagID) &&
        (categoryID === null || entry.categoryID === categoryID) &&
        (typeID === null || entry.typeID === typeID),
    )
    .map((entry) => cloneValue(entry));
}

function listCharacterItems(charId, options = {}) {
  return listOwnedItems(charId, options);
}

function listCharacterShipItems(charId, options = {}) {
  return listCharacterItems(charId, {
    ...options,
    categoryID: SHIP_CATEGORY_ID,
  });
}

function getCharacterShipItems(charId) {
  return listCharacterShipItems(charId);
}

function getCharacterHangarShipItems(charId, stationId) {
  return listCharacterShipItems(charId, {
    locationID: stationId,
    flagID: ITEM_FLAGS.HANGAR,
  });
}

function findCharacterShipItem(charId, shipId) {
  const numericShipId = toNumber(shipId, 0);
  if (numericShipId <= 0) {
    return null;
  }

  return (
    listCharacterShipItems(charId).find((entry) => entry.itemID === numericShipId) ||
    null
  );
}

function findShipItemById(shipId) {
  const numericShipId = toNumber(shipId, 0);
  if (numericShipId <= 0) {
    return null;
  }

  const entry = ensureItemIndexes().byID.get(numericShipId) || null;
  return entry && entry.categoryID === SHIP_CATEGORY_ID ? cloneValue(entry) : null;
}

function findItemById(itemId) {
  const numericItemId = toNumber(itemId, 0);
  if (numericItemId <= 0) {
    return null;
  }

  const entry = ensureItemIndexes().byID.get(numericItemId) || null;
  return entry ? cloneValue(entry) : null;
}

function findCharacterShipByType(charId, typeId, stationId = null) {
  const numericTypeId = toNumber(typeId, 0);
  if (numericTypeId <= 0) {
    return null;
  }

  const ships =
    stationId === null || stationId === undefined
      ? listCharacterShipItems(charId)
      : getCharacterHangarShipItems(charId, stationId);

  return ships.find((entry) => entry.typeID === numericTypeId) || null;
}

function ensureCharacterActiveShipItem(charId, existingRecord = null) {
  ensureMigrated();

  const numericCharId = toNumber(charId, 0);
  if (numericCharId <= 0) {
    return null;
  }

  const characters = readCharacters();
  const record = existingRecord || characters[String(numericCharId)];
  if (!record) {
    return null;
  }

  const activeShip = findCharacterShipItem(numericCharId, record.shipID);
  if (activeShip) {
    return activeShip;
  }

  const ownedShips = listCharacterShipItems(numericCharId);
  if (ownedShips.length > 0) {
    const repairedShip = ownedShips[0];
    const syncResult = syncCharacterActiveShip(numericCharId, repairedShip);
    if (!syncResult.success) {
      log.warn(
        `[ItemStore] Failed to repair active ship for char=${numericCharId} from owned ship=${repairedShip.itemID}`,
      );
    } else {
      log.info(
        `[ItemStore] Repaired active ship for char=${numericCharId} -> ship=${repairedShip.itemID}`,
      );
    }
    return repairedShip;
  }

  const stationID = toNumber(record.stationID, 60003760);
  try {
    const {
      getStarterShipFitting,
    } = require(path.join(__dirname, "../ship/starterShipFittingState"));
    const starterShipFitting = getStarterShipFitting(record.shipTypeID);
    if (starterShipFitting) {
      const {
      spawnRookieShipForCharacter,
      } = require(path.join(__dirname, "../ship/rookieShipRuntime"));
      const rookieShipResult = spawnRookieShipForCharacter(
        numericCharId,
        stationID,
        {
          characterRecord: record,
          shipTypeID: toNumber(record.shipTypeID, DEFAULT_SHIP_TYPE_ID),
          shipName: record.shipName || null,
          preferExplicitShipType: true,
          setActiveShip: true,
          logLabel: "EnsureCharacterActiveShipItem",
        },
      );
      if (rookieShipResult.success && rookieShipResult.data && rookieShipResult.data.ship) {
        return cloneValue(rookieShipResult.data.ship);
      }
      log.warn(
        `[ItemStore] Failed to provision rookie ship for char=${numericCharId} error=${rookieShipResult.errorMsg}`,
      );
    }
  } catch (error) {
    log.warn(
      `[ItemStore] Failed to provision rookie ship for char=${numericCharId}: ${error.message}`,
    );
  }

  const items = readItems();
  const starterShip = buildShipItem({
    itemID: nextItemID(numericCharId, items, record),
    typeID: record.shipTypeID || DEFAULT_SHIP_TYPE_ID,
    ownerID: numericCharId,
    locationID: stationID,
    flagID: ITEM_FLAGS.HANGAR,
    itemName: record.shipName || null,
  });

  items[String(starterShip.itemID)] = starterShip;
  if (!writeItems(items)) {
    log.warn(
      `[ItemStore] Failed to provision starter ship for char=${numericCharId}`,
    );
    return null;
  }

  const syncResult = syncCharacterActiveShip(numericCharId, starterShip);
  if (!syncResult.success) {
    log.warn(
      `[ItemStore] Provisioned starter ship=${starterShip.itemID} for char=${numericCharId} but failed to sync character record`,
    );
  } else {
    log.info(
      `[ItemStore] Provisioned starter ship for char=${numericCharId} -> ship=${starterShip.itemID}`,
    );
  }

  return cloneValue(starterShip);
}

function getActiveShipItem(charId) {
  return ensureCharacterActiveShipItem(charId);
}

function syncCharacterActiveShip(charId, shipItem) {
  ensureMigrated();
  const characters = readCharacters();
  const record = characters[String(charId)];
  if (!record || !shipItem) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  const nextRecord = {
    ...record,
    shipID: shipItem.itemID,
    shipTypeID: shipItem.typeID,
    shipName: shipItem.itemName,
  };

  if (Object.prototype.hasOwnProperty.call(nextRecord, "storedShips")) {
    delete nextRecord.storedShips;
  }

  characters[String(charId)] = nextRecord;
  if (!writeCharacters(characters)) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  return {
    success: true,
    data: nextRecord,
  };
}

function resolveItemTypeReference(itemType) {
  if (itemType && typeof itemType === "object" && itemType.typeID) {
    return getItemMetadata(itemType.typeID, itemType.name || itemType.itemName || null);
  }

  return getItemMetadata(itemType);
}

function buildStackKey(ownerID, locationID, flagID, typeID) {
  return [
    toNumber(ownerID, 0),
    toNumber(locationID, 0),
    toNumber(flagID, ITEM_FLAGS.HANGAR),
    toNumber(typeID, 0),
  ].join(":");
}

function grantItemsToCharacterLocation(
  charId,
  locationId,
  flagId,
  grantEntries = [],
) {
  ensureMigrated();
  const characters = readCharacters();
  const items = readItems();
  const record = characters[String(charId)];
  if (!record) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  const entries = Array.isArray(grantEntries)
    ? grantEntries.filter(Boolean)
    : [];
  if (entries.length === 0) {
    return {
      success: true,
      data: {
        quantity: 0,
        items: [],
        changes: [],
        grantedEntries: [],
      },
    };
  }

  const numericLocationId = toNumber(locationId, 0);
  const numericFlagId = toNumber(flagId, ITEM_FLAGS.HANGAR);
  const changes = [];
  const createdItems = [];
  const grantedEntries = [];
  const transientCreatedItemIDs = [];
  const stackIndex = buildStackIndex(items);
  let stackSplitApplied = false;
  let stackSplitStackCount = 0;

  for (const entry of entries) {
    const metadata = resolveItemTypeReference(entry.itemType);
    if (!metadata || !Number.isInteger(toNumber(metadata.typeID, 0)) || metadata.typeID <= 0) {
      return {
        success: false,
        errorMsg: "ITEM_TYPE_NOT_FOUND",
      };
    }

    const normalizedQuantity = normalizePositiveSafeInteger(entry.quantity, null);
    if (!normalizedQuantity) {
      return {
        success: false,
        errorMsg: "ITEM_QUANTITY_OUT_OF_RANGE",
      };
    }
    const options =
      entry.options && typeof entry.options === "object"
        ? entry.options
        : {};
    const singletonMode =
      options.singleton === undefined || options.singleton === null
        ? shouldItemDefaultToSingleton(metadata)
        : toNumber(options.singleton, 0) > 0;
    const resolvedSingleton =
      options.singleton !== undefined && options.singleton !== null
        ? toNumber(options.singleton, 1)
        : 1;

    if (singletonMode) {
      for (let index = 0; index < normalizedQuantity; index += 1) {
        const item = buildInventoryItem({
          itemID: nextItemID(charId, items, record),
          typeID: metadata.typeID,
          ownerID: charId,
          locationID: numericLocationId,
          flagID: numericFlagId,
          itemName: options.itemName || metadata.name,
          singleton: resolvedSingleton,
          customInfo: options.customInfo || "",
          spaceState: options.spaceState || null,
          conditionState: options.conditionState || null,
          moduleState: options.moduleState,
          createdAtMs: options.createdAtMs ?? null,
          expiresAtMs: options.expiresAtMs ?? null,
          launcherID: options.launcherID ?? null,
          dunRotation: options.dunRotation ?? null,
          spaceRadius: options.spaceRadius ?? null,
        });

        items[String(item.itemID)] = item;
        changes.push({
          created: true,
          item: cloneValue(item),
          previousState: {
            locationID: 0,
            flagID: 0,
          },
        });
        createdItems.push(cloneValue(item));
        if (options.transient === true) {
          transientCreatedItemIDs.push(item.itemID);
        }
      }
    } else {
      const stackGrantResult = applyStackableGrant({
        ownerID: charId,
        locationID: numericLocationId,
        flagID: numericFlagId,
        metadata,
        quantity: normalizedQuantity,
        options,
        items,
        stackIndex,
        changes,
        createdItems,
        transientCreatedItemIDs,
        characterRecord: record,
      });
      stackSplitApplied = stackSplitApplied || stackGrantResult.splitApplied;
      stackSplitStackCount += stackGrantResult.stackTouchCount;
    }

    grantedEntries.push({
      itemType: cloneValue(metadata),
      quantity: normalizedQuantity,
    });
  }

  if (!writeItems(items)) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  if (transientCreatedItemIDs.length > 0) {
    for (const itemID of transientCreatedItemIDs) {
      database.setTransientPath(ITEMS_TABLE, `/${String(itemID)}`, true);
    }
  }

  const singleEntry = entries.length === 1 ? grantedEntries[0] || null : null;
  return {
    success: true,
    data: {
      itemType: singleEntry ? singleEntry.itemType : null,
      quantity: singleEntry ? singleEntry.quantity : grantedEntries.reduce(
        (sum, entry) => sum + entry.quantity,
        0,
      ),
      items: createdItems,
      changes,
      grantedEntries,
      stackSplitApplied,
      stackSplitStackCount,
    },
  };
}

function grantItemToCharacterLocation(
  charId,
  locationId,
  flagId,
  itemType,
  quantity = 1,
  options = {},
) {
  return grantItemsToCharacterLocation(
    charId,
    locationId,
    flagId,
    [{
      itemType,
      quantity,
      options,
    }],
  );
}

function grantItemToCharacterStationHangar(charId, stationId, itemType, quantity = 1) {
  return grantItemToCharacterLocation(
    charId,
    stationId,
    ITEM_FLAGS.HANGAR,
    itemType,
    quantity,
  );
}

function grantItemsToCharacterStationHangar(charId, stationId, grantEntries = []) {
  return grantItemsToCharacterLocation(
    charId,
    stationId,
    ITEM_FLAGS.HANGAR,
    grantEntries,
  );
}

function grantItemsToOwnerLocation(
  ownerId,
  locationId,
  flagId,
  grantEntries = [],
) {
  ensureMigrated();
  const numericOwnerId = toNumber(ownerId, 0);
  if (numericOwnerId <= 0) {
    return {
      success: false,
      errorMsg: "OWNER_NOT_FOUND",
    };
  }

  const characters = readCharacters();
  if (characters[String(numericOwnerId)]) {
    return grantItemsToCharacterLocation(
      numericOwnerId,
      locationId,
      flagId,
      grantEntries,
    );
  }

  const items = readItems();
  const entries = Array.isArray(grantEntries)
    ? grantEntries.filter(Boolean)
    : [];
  if (entries.length === 0) {
    return {
      success: true,
      data: {
        quantity: 0,
        items: [],
        changes: [],
        grantedEntries: [],
      },
    };
  }

  const numericLocationId = toNumber(locationId, 0);
  const numericFlagId = toNumber(flagId, ITEM_FLAGS.HANGAR);
  const changes = [];
  const createdItems = [];
  const grantedEntries = [];
  const transientCreatedItemIDs = [];
  const stackIndex = buildStackIndex(items);
  let stackSplitApplied = false;
  let stackSplitStackCount = 0;

  for (const entry of entries) {
    const metadata = resolveItemTypeReference(entry.itemType);
    if (!metadata || !Number.isInteger(toNumber(metadata.typeID, 0)) || metadata.typeID <= 0) {
      return {
        success: false,
        errorMsg: "ITEM_TYPE_NOT_FOUND",
      };
    }

    const normalizedQuantity = normalizePositiveSafeInteger(entry.quantity, null);
    if (!normalizedQuantity) {
      return {
        success: false,
        errorMsg: "ITEM_QUANTITY_OUT_OF_RANGE",
      };
    }
    const options =
      entry.options && typeof entry.options === "object"
        ? entry.options
        : {};
    const singletonMode =
      options.singleton === undefined || options.singleton === null
        ? shouldItemDefaultToSingleton(metadata)
        : toNumber(options.singleton, 0) > 0;
    const resolvedSingleton =
      options.singleton !== undefined && options.singleton !== null
        ? toNumber(options.singleton, 1)
        : 1;

    if (singletonMode) {
      for (let index = 0; index < normalizedQuantity; index += 1) {
        const item = buildInventoryItem({
          itemID: nextItemID(
            numericOwnerId,
            items,
            characters[String(numericOwnerId)] || null,
          ),
          typeID: metadata.typeID,
          ownerID: numericOwnerId,
          locationID: numericLocationId,
          flagID: numericFlagId,
          itemName: options.itemName || metadata.name,
          singleton: resolvedSingleton,
          customInfo: options.customInfo || "",
          spaceState: options.spaceState || null,
          conditionState: options.conditionState || null,
          moduleState: options.moduleState,
          createdAtMs: options.createdAtMs ?? null,
          expiresAtMs: options.expiresAtMs ?? null,
          launcherID: options.launcherID ?? null,
          dunRotation: options.dunRotation ?? null,
          spaceRadius: options.spaceRadius ?? null,
        });

        items[String(item.itemID)] = item;
        changes.push({
          created: true,
          item: cloneValue(item),
          previousState: {
            locationID: 0,
            flagID: 0,
          },
        });
        createdItems.push(cloneValue(item));
        if (options.transient === true) {
          transientCreatedItemIDs.push(item.itemID);
        }
      }
    } else {
      const stackGrantResult = applyStackableGrant({
        ownerID: numericOwnerId,
        locationID: numericLocationId,
        flagID: numericFlagId,
        metadata,
        quantity: normalizedQuantity,
        options,
        items,
        stackIndex,
        changes,
        createdItems,
        transientCreatedItemIDs,
        characterRecord: characters[String(numericOwnerId)] || null,
      });
      stackSplitApplied = stackSplitApplied || stackGrantResult.splitApplied;
      stackSplitStackCount += stackGrantResult.stackTouchCount;
    }

    grantedEntries.push({
      itemType: cloneValue(metadata),
      quantity: normalizedQuantity,
    });
  }

  if (!writeItems(items)) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  if (transientCreatedItemIDs.length > 0) {
    for (const itemID of transientCreatedItemIDs) {
      database.setTransientPath(ITEMS_TABLE, `/${String(itemID)}`, true);
    }
  }

  const singleEntry = entries.length === 1 ? grantedEntries[0] || null : null;
  return {
    success: true,
    data: {
      itemType: singleEntry ? singleEntry.itemType : null,
      quantity: singleEntry ? singleEntry.quantity : grantedEntries.reduce(
        (sum, item) => sum + item.quantity,
        0,
      ),
      items: createdItems,
      changes,
      grantedEntries,
      stackSplitApplied,
      stackSplitStackCount,
    },
  };
}

function grantItemToOwnerLocation(
  ownerId,
  locationId,
  flagId,
  itemType,
  quantity = 1,
  options = {},
) {
  return grantItemsToOwnerLocation(
    ownerId,
    locationId,
    flagId,
    [{
      itemType,
      quantity,
      options,
    }],
  );
}

function resolveSpawnedSpaceItemRadius(itemType, options = {}) {
  const explicitSpaceRadius = toFiniteNumber(options && options.spaceRadius, 0);
  if (explicitSpaceRadius > 0) {
    return explicitSpaceRadius;
  }

  const metadata = getItemMetadata(
    itemType && itemType.typeID,
    itemType && (itemType.itemName || itemType.name),
  );
  const groupName = String(
    metadata && metadata.groupName || itemType && itemType.groupName || "",
  ).trim().toLowerCase();
  if (groupName !== "wreck") {
    return 0;
  }

  return resolveRuntimeWreckRadius(metadata, toFiniteNumber(metadata && metadata.radius, 0));
}

function createSpaceItemForCharacter(charId, solarSystemId, itemType, options = {}) {
  const normalizedSystemId = toNumber(solarSystemId, 0);
  if (normalizedSystemId <= 0) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
    };
  }

  const createResult = grantItemToCharacterLocation(
    charId,
    normalizedSystemId,
    0,
    itemType,
    1,
    {
      ...options,
      singleton: 1,
      createdAtMs: options.createdAtMs ?? Date.now(),
      expiresAtMs: options.expiresAtMs ?? null,
      spaceRadius: (
        resolveSpawnedSpaceItemRadius(itemType, options) || null
      ),
      spaceState: normalizeSpaceState({
        systemID: normalizedSystemId,
        position: options.position,
        velocity: options.velocity,
        direction: options.direction,
        targetPoint: options.targetPoint,
        speedFraction: options.speedFraction,
        mode: options.mode || "STOP",
        targetEntityID: options.targetEntityID,
        followRange: options.followRange,
        orbitDistance: options.orbitDistance,
        orbitNormal: options.orbitNormal,
        orbitSign: options.orbitSign,
      }),
    },
  );
  if (!createResult.success) {
    return createResult;
  }

  return {
    success: true,
    data: createResult.data.items[0] || null,
    changes: createResult.data.changes || [],
  };
}

function createSpaceItemForOwner(ownerId, solarSystemId, itemType, options = {}) {
  const normalizedSystemId = toNumber(solarSystemId, 0);
  if (normalizedSystemId <= 0) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
    };
  }

  const createResult = grantItemToOwnerLocation(
    ownerId,
    normalizedSystemId,
    0,
    itemType,
    1,
    {
      ...options,
      singleton: 1,
      createdAtMs: options.createdAtMs ?? Date.now(),
      expiresAtMs: options.expiresAtMs ?? null,
      spaceRadius: (
        resolveSpawnedSpaceItemRadius(itemType, options) || null
      ),
      spaceState: normalizeSpaceState({
        systemID: normalizedSystemId,
        position: options.position,
        velocity: options.velocity,
        direction: options.direction,
        targetPoint: options.targetPoint,
        speedFraction: options.speedFraction,
        mode: options.mode || "STOP",
        targetEntityID: options.targetEntityID,
        followRange: options.followRange,
        orbitDistance: options.orbitDistance,
        orbitNormal: options.orbitNormal,
        orbitSign: options.orbitSign,
      }),
    },
  );
  if (!createResult.success) {
    return createResult;
  }

  return {
    success: true,
    data: createResult.data.items[0] || null,
    changes: createResult.data.changes || [],
  };
}

function takeItemTypeFromCharacterLocation(
  charId,
  locationId,
  flagId,
  typeId,
  quantity = 1,
) {
  ensureMigrated();
  const numericCharId = toNumber(charId, 0);
  const numericLocationId = toNumber(locationId, 0);
  const numericFlagId =
    flagId === null || flagId === undefined ? null : toNumber(flagId, 0);
  const numericTypeId = toNumber(typeId, 0);
  const normalizedQuantity = normalizePositiveInteger(quantity, 1);
  if (numericCharId <= 0 || numericTypeId <= 0) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const items = readItems();
  const matchingItems = Object.values(items)
    .map((entry) => normalizeInventoryItem(entry))
    .filter(
      (entry) =>
        entry &&
        entry.ownerID === numericCharId &&
        entry.locationID === numericLocationId &&
        (numericFlagId === null || entry.flagID === numericFlagId) &&
        entry.typeID === numericTypeId,
    )
    .sort((left, right) => left.itemID - right.itemID);

  const availableQuantity = matchingItems.reduce(
    (sum, entry) => sum + (entry.singleton === 1 ? 1 : toNumber(entry.quantity, 0)),
    0,
  );
  if (availableQuantity < normalizedQuantity) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_ITEMS",
      data: {
        availableQuantity,
        requestedQuantity: normalizedQuantity,
      },
    };
  }

  let remaining = normalizedQuantity;
  const changes = [];
  for (const item of matchingItems) {
    if (remaining <= 0) {
      break;
    }

    const previousData = cloneValue(item);
    if (item.singleton === 1) {
      delete items[String(item.itemID)];
      database.setTransientPath(ITEMS_TABLE, `/${String(item.itemID)}`, false);
      changes.push({
        removed: true,
        previousData,
        item: null,
      });
      remaining -= 1;
      continue;
    }

    const currentQuantity = toNumber(item.quantity, 0);
    if (currentQuantity <= remaining) {
      delete items[String(item.itemID)];
      database.setTransientPath(ITEMS_TABLE, `/${String(item.itemID)}`, false);
      changes.push({
        removed: true,
        previousData,
        item: null,
      });
      remaining -= currentQuantity;
      continue;
    }

    const updatedQuantity = currentQuantity - remaining;
    const updatedItem = buildInventoryItem({
      ...item,
      quantity: updatedQuantity,
      stacksize: updatedQuantity,
      singleton: 0,
    });
    items[String(updatedItem.itemID)] = updatedItem;
    changes.push({
      removed: false,
      previousData,
      item: cloneValue(updatedItem),
    });
    remaining = 0;
  }

  if (!writeItems(items)) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  return {
    success: true,
    data: {
      quantity: normalizedQuantity,
      changes,
    },
  };
}

function takeItemTypeFromOwnerLocation(
  ownerId,
  locationId,
  flagId,
  typeId,
  quantity = 1,
) {
  ensureMigrated();
  const numericOwnerId = toNumber(ownerId, 0);
  const characters = readCharacters();
  if (characters[String(numericOwnerId)]) {
    return takeItemTypeFromCharacterLocation(
      numericOwnerId,
      locationId,
      flagId,
      typeId,
      quantity,
    );
  }

  const numericLocationId = toNumber(locationId, 0);
  const numericFlagId =
    flagId === null || flagId === undefined ? null : toNumber(flagId, 0);
  const numericTypeId = toNumber(typeId, 0);
  const normalizedQuantity = normalizePositiveInteger(quantity, 1);
  if (numericOwnerId <= 0 || numericTypeId <= 0) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const items = readItems();
  const matchingItems = Object.values(items)
    .map((entry) => normalizeInventoryItem(entry))
    .filter(
      (entry) =>
        entry &&
        entry.ownerID === numericOwnerId &&
        entry.locationID === numericLocationId &&
        (numericFlagId === null || entry.flagID === numericFlagId) &&
        entry.typeID === numericTypeId,
    )
    .sort((left, right) => left.itemID - right.itemID);

  const availableQuantity = matchingItems.reduce(
    (sum, entry) => sum + (entry.singleton === 1 ? 1 : toNumber(entry.quantity, 0)),
    0,
  );
  if (availableQuantity < normalizedQuantity) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_ITEMS",
      data: {
        availableQuantity,
        requestedQuantity: normalizedQuantity,
      },
    };
  }

  let remaining = normalizedQuantity;
  const changes = [];
  for (const item of matchingItems) {
    if (remaining <= 0) {
      break;
    }

    const previousData = cloneValue(item);
    if (item.singleton === 1) {
      delete items[String(item.itemID)];
      database.setTransientPath(ITEMS_TABLE, `/${String(item.itemID)}`, false);
      changes.push({
        removed: true,
        previousData,
        item: null,
      });
      remaining -= 1;
      continue;
    }

    const currentQuantity = toNumber(item.quantity, 0);
    if (currentQuantity <= remaining) {
      delete items[String(item.itemID)];
      database.setTransientPath(ITEMS_TABLE, `/${String(item.itemID)}`, false);
      changes.push({
        removed: true,
        previousData,
        item: null,
      });
      remaining -= currentQuantity;
      continue;
    }

    const updatedQuantity = currentQuantity - remaining;
    const updatedItem = buildInventoryItem({
      ...item,
      quantity: updatedQuantity,
      stacksize: updatedQuantity,
      singleton: 0,
    });
    items[String(updatedItem.itemID)] = updatedItem;
    changes.push({
      removed: false,
      previousData,
      item: cloneValue(updatedItem),
    });
    remaining = 0;
  }

  if (!writeItems(items)) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  return {
    success: true,
    data: {
      quantity: normalizedQuantity,
      changes,
    },
  };
}

function createShipItemForCharacter(charId, stationId, shipType) {
  const createResult = grantItemToCharacterLocation(
    charId,
    stationId,
    ITEM_FLAGS.HANGAR,
    shipType,
    1,
  );
  if (!createResult.success) {
    return createResult;
  }

  return {
    success: true,
    data: createResult.data.items[0] || null,
    changes: createResult.data.changes,
  };
}

function updateInventoryItem(itemId, updater) {
  ensureMigrated();
  const numericItemId = toNumber(itemId, 0);
  if (numericItemId <= 0) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const items = readItems();
  const currentItem = normalizeInventoryItem(items[String(numericItemId)]);
  if (!currentItem) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const updatedValue =
    typeof updater === "function" ? updater(cloneValue(currentItem)) : updater;
  const normalizedItem = normalizeInventoryItem(updatedValue, currentItem);
  if (!normalizedItem) {
    return {
      success: false,
      errorMsg: "INVALID_ITEM_STATE",
    };
  }

  items[String(numericItemId)] = normalizedItem;
  if (!writeItems(items)) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  maybeNotifyInsuranceInventoryMutation(
    currentItem,
    normalizedItem,
    "updateInventoryItem",
  );

  return {
    success: true,
    previousData: cloneValue(currentItem),
    data: cloneValue(normalizedItem),
  };
}

function removeInventoryItem(itemId, options = {}) {
  ensureMigrated();
  const numericItemId = toNumber(itemId, 0);
  if (numericItemId <= 0) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const items = readItems();
  const rootItem = normalizeInventoryItem(items[String(numericItemId)]);
  if (!rootItem) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const removeContents = options.removeContents !== false;
  const orderedRemovalIDs = [];
  const seen = new Set();

  const collect = (currentID) => {
    const normalizedCurrentID = toNumber(currentID, 0);
    if (normalizedCurrentID <= 0 || seen.has(normalizedCurrentID)) {
      return;
    }

    seen.add(normalizedCurrentID);
    if (removeContents) {
      for (const rawItem of Object.values(items)) {
        const nestedItem = normalizeInventoryItem(rawItem);
        if (
          nestedItem &&
          toNumber(nestedItem.locationID, 0) === normalizedCurrentID &&
          toNumber(nestedItem.itemID, 0) !== normalizedCurrentID
        ) {
          collect(nestedItem.itemID);
        }
      }
    }

    orderedRemovalIDs.push(normalizedCurrentID);
  };

  collect(numericItemId);

  const changes = [];
  const removedItems = [];
  for (const removalID of orderedRemovalIDs) {
    const currentItem = normalizeInventoryItem(items[String(removalID)]);
    if (!currentItem) {
      continue;
    }

    delete items[String(removalID)];
    database.setTransientPath(ITEMS_TABLE, `/${String(removalID)}`, false);
    changes.push({
      removed: true,
      previousData: cloneValue(currentItem),
      item: buildRemovedItemNotificationState(currentItem),
    });
    removedItems.push(cloneValue(currentItem));
  }

  if (!writeItems(items)) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  return {
    success: true,
    data: {
      removedItems,
      changes,
    },
  };
}

function consumeInventoryItemQuantity(itemId, quantity = 1, options = {}) {
  ensureMigrated();
  const numericItemId = toNumber(itemId, 0);
  if (numericItemId <= 0) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const items = readItems();
  const currentItem = normalizeInventoryItem(items[String(numericItemId)]);
  if (!currentItem) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const availableQuantity =
    currentItem.singleton === 1
      ? 1
      : normalizePositiveInteger(currentItem.stacksize ?? currentItem.quantity, 1);
  const consumeQuantity =
    quantity === null || quantity === undefined
      ? availableQuantity
      : normalizePositiveSafeInteger(quantity, null);
  if (!consumeQuantity) {
    return {
      success: false,
      errorMsg: "ITEM_QUANTITY_OUT_OF_RANGE",
    };
  }
  if (consumeQuantity > availableQuantity) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_ITEMS",
    };
  }

  if (currentItem.singleton === 1 || consumeQuantity === availableQuantity) {
    return removeInventoryItem(itemId, options);
  }

  const previousData = cloneValue(currentItem);
  const updatedItem = buildInventoryItem({
    ...currentItem,
    quantity: availableQuantity - consumeQuantity,
    stacksize: availableQuantity - consumeQuantity,
    singleton: 0,
  });
  items[String(updatedItem.itemID)] = updatedItem;

  if (!writeItems(items)) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  return {
    success: true,
    data: {
      quantity: consumeQuantity,
      removedItems: [],
      changes: [{
        removed: false,
        previousData,
        item: cloneValue(updatedItem),
      }],
    },
  };
}

function updateShipItem(shipId, updater) {
  const updateResult = updateInventoryItem(shipId, updater);
  if (!updateResult.success) {
    return {
      ...updateResult,
      errorMsg:
        updateResult.errorMsg === "ITEM_NOT_FOUND"
          ? "SHIP_NOT_FOUND"
          : updateResult.errorMsg === "INVALID_ITEM_STATE"
            ? "INVALID_SHIP_STATE"
            : updateResult.errorMsg,
    };
  }

  if (updateResult.data.categoryID !== SHIP_CATEGORY_ID) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  return updateResult;
}

function buildRemovedItemNotificationState(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  return {
    ...cloneValue(item),
    // The client removes container rows most reliably when the disappearing
    // item looks like it moved to a junk location, rather than an in-place
    // zero-stack update inside the same container.
    locationID: JUNK_LOCATION_ID,
    quantity:
      item.singleton === 2
        ? -2
        : item.singleton === 1
          ? -1
        : toNumber(item.stacksize ?? item.quantity, 0),
    stacksize:
      toNumber(item.singleton, 0) > 0
        ? 1
        : toNumber(item.stacksize ?? item.quantity, 0),
  };
}

function buildCreatedItemNotificationPreviousState(
  item,
  fallbackFlagID = ITEM_FLAGS.HANGAR,
  fallbackOwnerID = undefined,
) {
  return {
    ownerID:
      fallbackOwnerID === undefined
        ? toNumber(item && item.ownerID, 0)
        : toNumber(fallbackOwnerID, 0),
    locationID: 0,
    flagID: toNumber(item && item.flagID, fallbackFlagID),
    quantity: 0,
    stacksize: 0,
    singleton: toNumber(item && item.singleton, 0),
  };
}

function mergeItemStacks(sourceItemId, destinationItemId, quantity = null) {
  ensureMigrated();
  const numericSourceItemID = toNumber(sourceItemId, 0);
  const numericDestinationItemID = toNumber(destinationItemId, 0);
  if (numericSourceItemID <= 0 || numericDestinationItemID <= 0) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const items = readItems();
  const sourceItem = normalizeInventoryItem(items[String(numericSourceItemID)]);
  const destinationItem = normalizeInventoryItem(items[String(numericDestinationItemID)]);
  if (!sourceItem || !destinationItem) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  if (sourceItem.singleton === 1 || destinationItem.singleton === 1) {
    return {
      success: false,
      errorMsg: "STACK_REQUIRED",
    };
  }

  if (
    toNumber(sourceItem.typeID, 0) !== toNumber(destinationItem.typeID, 0) ||
    toNumber(sourceItem.ownerID, 0) !== toNumber(destinationItem.ownerID, 0)
  ) {
    return {
      success: false,
      errorMsg: "STACK_MISMATCH",
    };
  }

  const sourceQuantity = toNumber(sourceItem.stacksize ?? sourceItem.quantity, 0);
  const destinationQuantity = toNumber(destinationItem.stacksize ?? destinationItem.quantity, 0);
  const requestedQuantity =
    quantity === null || quantity === undefined
      ? sourceQuantity
      : normalizePositiveSafeInteger(quantity, null);
  if (!requestedQuantity) {
    return {
      success: false,
      errorMsg: "ITEM_QUANTITY_OUT_OF_RANGE",
    };
  }
  if (requestedQuantity > sourceQuantity) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_ITEMS",
    };
  }

  const availableDestinationCapacity = Math.max(
    0,
    CLIENT_INVENTORY_STACK_LIMIT - destinationQuantity,
  );
  if (availableDestinationCapacity <= 0) {
    return {
      success: false,
      errorMsg: "STACK_LIMIT_REACHED",
      data: {
        stackLimit: CLIENT_INVENTORY_STACK_LIMIT,
      },
    };
  }

  const transferQuantity = Math.min(requestedQuantity, availableDestinationCapacity);

  const changes = [];
  const destinationPreviousData = captureItemState(destinationItem);
  const updatedDestination = buildInventoryItem({
    ...destinationItem,
    quantity: destinationQuantity + transferQuantity,
    stacksize: destinationQuantity + transferQuantity,
    singleton: 0,
  });
  items[String(updatedDestination.itemID)] = updatedDestination;
  changes.push({
    removed: false,
    previousData: destinationPreviousData,
    item: cloneValue(updatedDestination),
  });

  const sourcePreviousData = cloneValue(sourceItem);
  if (transferQuantity === sourceQuantity) {
    delete items[String(sourceItem.itemID)];
    changes.push({
      removed: true,
      previousData: sourcePreviousData,
      item: buildRemovedItemNotificationState(sourceItem),
    });
  } else {
    const updatedSource = buildInventoryItem({
      ...sourceItem,
      quantity: sourceQuantity - transferQuantity,
      stacksize: sourceQuantity - transferQuantity,
      singleton: 0,
    });
    items[String(updatedSource.itemID)] = updatedSource;
    changes.push({
      removed: false,
      previousData: sourcePreviousData,
      item: cloneValue(updatedSource),
    });
  }

  if (!writeItems(items)) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  return {
    success: true,
    data: {
      quantity: transferQuantity,
      changes,
    },
  };
}

function buildMovedItemState(currentItem, destinationLocationID, destinationFlagID) {
  const nextState = {
    ...currentItem,
    locationID: destinationLocationID,
    flagID: destinationFlagID,
  };

  const isCharge = toNumber(currentItem.categoryID, 0) === 8;
  if (!isCharge && destinationFlagID >= 11 && destinationFlagID <= 132) {
    // CCP parity: modules auto-online when fitted to a ship slot.  The client
    // expects fitted modules to be online so that CPU/powergrid load is
    // reflected correctly in the fitting window.  Charges (categoryID 8)
    // placed in the same flag as their parent module are NOT modules and
    // should not receive a moduleState at all.
    nextState.moduleState = normalizeModuleState({
      ...(currentItem.moduleState || {}),
      online: true,
    });
  } else if (!isCharge) {
    nextState.moduleState = normalizeModuleState({
      ...(currentItem.moduleState || {}),
      online: false,
    });
  }

  return nextState;
}

function moveItemToLocation(
  itemId,
  destinationLocationId,
  destinationFlagId,
  quantity = null,
) {
  ensureMigrated();
  const numericItemId = toNumber(itemId, 0);
  const destinationLocationID = toNumber(destinationLocationId, 0);
  const destinationFlagID = toNumber(destinationFlagId, ITEM_FLAGS.HANGAR);
  if (numericItemId <= 0 || destinationLocationID <= 0) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const items = readItems();
  const characters = readCharacters();
  const currentItem = normalizeInventoryItem(items[String(numericItemId)]);
  if (!currentItem) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const availableQuantity =
    currentItem.singleton === 1
      ? 1
      : normalizePositiveInteger(currentItem.stacksize, 1);
  const moveQuantity =
    quantity === null || quantity === undefined
      ? availableQuantity
      : normalizePositiveInteger(quantity, 1);
  if (moveQuantity > availableQuantity) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_ITEMS",
    };
  }

  const changes = [];
  const movingWholeItem = currentItem.singleton === 1 || moveQuantity === availableQuantity;
  const movedBase = buildMovedItemState(
    currentItem,
    destinationLocationID,
    destinationFlagID,
  );

  const fittingDestination = isFittingFlag(destinationFlagID);
  // CCP parity: only modules (categoryID 7) become singletons when fitted.
  // Charges (categoryID 8) loaded into a module's flag keep their stack
  // quantity — they are NOT singletons.
  const isChargeCategory = toNumber(currentItem.categoryID, 0) === 8;
  const convertToSingleton =
    (fittingDestination && !isChargeCategory) ||
    (
      destinationFlagID === ITEM_FLAGS.STRUCTURE_DEED &&
      toNumber(currentItem.groupID, 0) === STRUCTURE_DEED_GROUP_ID
    );

  if (movingWholeItem) {
    const previousData = cloneValue(currentItem);
    const destinationSingleton = convertToSingleton ? 1 : currentItem.singleton;
    const movedItem = buildInventoryItem({
      ...movedBase,
      quantity:
        destinationSingleton === 1 ? null : moveQuantity,
      stacksize:
        destinationSingleton === 1 ? 1 : moveQuantity,
      singleton: destinationSingleton,
    });
    items[String(movedItem.itemID)] = movedItem;
    changes.push({
      removed: false,
      previousData,
      item: cloneValue(movedItem),
    });
  } else {
    const sourcePreviousData = cloneValue(currentItem);
    const updatedSource = buildInventoryItem({
      ...currentItem,
      quantity: availableQuantity - moveQuantity,
      stacksize: availableQuantity - moveQuantity,
      singleton: 0,
    });
    items[String(updatedSource.itemID)] = updatedSource;
    changes.push({
      removed: false,
      previousData: sourcePreviousData,
      item: cloneValue(updatedSource),
    });

    const splitSingleton = convertToSingleton ? 1 : 0;
    const nextItem = buildInventoryItem({
      ...movedBase,
      itemID: nextItemID(currentItem.ownerID, items, characters[String(currentItem.ownerID)]),
      quantity: splitSingleton === 1 ? null : moveQuantity,
      stacksize: splitSingleton === 1 ? 1 : moveQuantity,
      singleton: splitSingleton,
      stackOriginID:
        toNumber(currentItem.stackOriginID, 0) > 0
          ? toNumber(currentItem.stackOriginID, 0)
          : currentItem.itemID,
    });
    items[String(nextItem.itemID)] = nextItem;
    changes.push({
      removed: false,
      // CCP parity: a partial-stack move creates a brand-new item row in the
      // destination inventory. The client never knew about this new itemID in
      // the source container, so advertise it as arriving from "outside"
      // instead of as a move from the source stack's previous location.
      previousData: buildCreatedItemNotificationPreviousState(
        nextItem,
        sourcePreviousData.flagID,
        sourcePreviousData.ownerID,
      ),
      item: cloneValue(nextItem),
    });
  }

  if (!writeItems(items)) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  notifyInsuranceInventoryMutationChanges(changes, "moveItemToLocation");

  return {
    success: true,
    data: {
      quantity: moveQuantity,
      changes,
    },
  };
}

function transferItemToOwnerLocation(
  itemId,
  destinationOwnerId,
  destinationLocationId,
  destinationFlagId,
  quantity = null,
) {
  ensureMigrated();
  const numericItemId = toNumber(itemId, 0);
  const destinationOwnerID = toNumber(destinationOwnerId, 0);
  const destinationLocationID = toNumber(destinationLocationId, 0);
  const destinationFlagID = toNumber(destinationFlagId, ITEM_FLAGS.HANGAR);
  if (
    numericItemId <= 0 ||
    destinationOwnerID <= 0 ||
    destinationLocationID <= 0
  ) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const items = readItems();
  const characters = readCharacters();
  const currentItem = normalizeInventoryItem(items[String(numericItemId)]);
  if (!currentItem) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const availableQuantity =
    currentItem.singleton === 1
      ? 1
      : normalizePositiveInteger(currentItem.stacksize, 1);
  const moveQuantity =
    quantity === null || quantity === undefined
      ? availableQuantity
      : normalizePositiveInteger(quantity, 1);
  if (moveQuantity > availableQuantity) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_ITEMS",
    };
  }

  const changes = [];
  const movingWholeItem =
    currentItem.singleton === 1 || moveQuantity === availableQuantity;
  const movedBase = buildMovedItemState(
    currentItem,
    destinationLocationID,
    destinationFlagID,
  );
  const isChargeCategory = toNumber(currentItem.categoryID, 0) === 8;
  const fittingDestination = isFittingFlag(destinationFlagID);
  const convertToSingleton =
    (fittingDestination && !isChargeCategory) ||
    (
      destinationFlagID === ITEM_FLAGS.STRUCTURE_DEED &&
      toNumber(currentItem.groupID, 0) === STRUCTURE_DEED_GROUP_ID
    );

  if (movingWholeItem) {
    const previousData = cloneValue(currentItem);
    const destinationSingleton = convertToSingleton ? 1 : currentItem.singleton;
    const movedItem = buildInventoryItem({
      ...movedBase,
      ownerID: destinationOwnerID,
      quantity: destinationSingleton === 1 ? null : moveQuantity,
      stacksize: destinationSingleton === 1 ? 1 : moveQuantity,
      singleton: destinationSingleton,
    });
    items[String(movedItem.itemID)] = movedItem;
    changes.push({
      removed: false,
      previousData,
      item: cloneValue(movedItem),
    });
  } else {
    const sourcePreviousData = cloneValue(currentItem);
    const updatedSource = buildInventoryItem({
      ...currentItem,
      quantity: availableQuantity - moveQuantity,
      stacksize: availableQuantity - moveQuantity,
      singleton: 0,
    });
    items[String(updatedSource.itemID)] = updatedSource;
    changes.push({
      removed: false,
      previousData: sourcePreviousData,
      item: cloneValue(updatedSource),
    });

    const splitSingleton = convertToSingleton ? 1 : 0;
    const nextItem = buildInventoryItem({
      ...movedBase,
      itemID: nextItemID(
        destinationOwnerID,
        items,
        characters[String(destinationOwnerID)] || null,
      ),
      ownerID: destinationOwnerID,
      quantity: splitSingleton === 1 ? null : moveQuantity,
      stacksize: splitSingleton === 1 ? 1 : moveQuantity,
      singleton: splitSingleton,
      stackOriginID:
        toNumber(currentItem.stackOriginID, 0) > 0
          ? toNumber(currentItem.stackOriginID, 0)
          : currentItem.itemID,
    });
    items[String(nextItem.itemID)] = nextItem;
    changes.push({
      removed: false,
      previousData: buildCreatedItemNotificationPreviousState(
        nextItem,
        sourcePreviousData.flagID,
        sourcePreviousData.ownerID,
      ),
      item: cloneValue(nextItem),
    });
  }

  if (!writeItems(items)) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  notifyInsuranceInventoryMutationChanges(
    changes,
    "transferItemToOwnerLocation",
  );

  return {
    success: true,
    data: {
      quantity: moveQuantity,
      changes,
    },
  };
}

function moveItemTypeFromCharacterLocation(
  charId,
  sourceLocationId,
  sourceFlagId,
  destinationLocationId,
  destinationFlagId,
  typeId,
  quantity = 1,
) {
  ensureMigrated();
  const numericCharId = toNumber(charId, 0);
  const numericSourceLocationId = toNumber(sourceLocationId, 0);
  const numericDestinationLocationId = toNumber(destinationLocationId, 0);
  const numericDestinationFlagId = toNumber(destinationFlagId, ITEM_FLAGS.HANGAR);
  const numericTypeId = toNumber(typeId, 0);
  const numericQuantity = normalizePositiveInteger(quantity, 1);
  const numericSourceFlagId =
    sourceFlagId === null || sourceFlagId === undefined
      ? null
      : toNumber(sourceFlagId, 0);

  if (
    numericCharId <= 0 ||
    numericSourceLocationId <= 0 ||
    numericDestinationLocationId <= 0 ||
    numericTypeId <= 0
  ) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const sourceItems = listContainerItems(
    numericCharId,
    numericSourceLocationId,
    numericSourceFlagId,
  )
    .filter((item) => item && toNumber(item.typeID, 0) === numericTypeId)
    .sort((left, right) => left.itemID - right.itemID);

  const availableQuantity = sourceItems.reduce((sum, item) => (
    sum + (toNumber(item.singleton, 0) === 1 ? 1 : normalizePositiveInteger(item.stacksize, 1))
  ), 0);
  if (availableQuantity < numericQuantity) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_ITEMS",
      data: {
        availableQuantity,
        requestedQuantity: numericQuantity,
      },
    };
  }

  const allChanges = [];
  const movedItems = [];
  let remaining = numericQuantity;

  for (const sourceItem of sourceItems) {
    if (remaining <= 0) {
      break;
    }

    const movableQuantity =
      toNumber(sourceItem.singleton, 0) === 1
        ? 1
        : Math.min(
            remaining,
            normalizePositiveInteger(sourceItem.stacksize, 1),
          );
    const moveResult = moveItemToLocation(
      sourceItem.itemID,
      numericDestinationLocationId,
      numericDestinationFlagId,
      movableQuantity,
    );
    if (!moveResult.success) {
      return moveResult;
    }

    allChanges.push(...((moveResult.data && moveResult.data.changes) || []));
    const movedChange = ((moveResult.data && moveResult.data.changes) || []).find((change) => (
      change &&
      change.item &&
      toNumber(change.item.locationID, 0) === numericDestinationLocationId &&
      toNumber(change.item.flagID, 0) === numericDestinationFlagId &&
      toNumber(change.item.typeID, 0) === numericTypeId
    ));
    if (movedChange && movedChange.item) {
      movedItems.push(cloneValue(movedChange.item));
    }
    remaining -= movableQuantity;
  }

  return {
    success: true,
    data: {
      quantity: numericQuantity,
      changes: allChanges,
      items: movedItems,
    },
  };
}

function setShipPackagingState(shipId, packaged) {
  const result = updateShipItem(shipId, (currentItem) => ({
    ...currentItem,
    singleton: packaged ? 0 : 1,
    quantity: packaged ? 1 : -1,
    stacksize: 1,
  }));
  if (packaged && result && result.success) {
    try {
      const {
        clearShipDirtTimestamp,
      } = require(path.join(__dirname, "../ship/shipDirtState"));
      if (typeof clearShipDirtTimestamp === "function") {
        clearShipDirtTimestamp(shipId, "packaged");
      }
    } catch (error) {
      log.warn(`[ItemStore] Failed to clear ship dirt for packaged ship=${shipId}: ${error.message}`);
    }
  }
  return result;
}

function setItemPackagingState(itemId, packaged) {
  return updateInventoryItem(itemId, (currentItem) => ({
    ...currentItem,
    singleton: packaged ? 0 : 1,
    quantity: packaged ? 1 : -1,
    stacksize: packaged ? 1 : 1,
  }));
}

function moveShipToSpace(shipId, solarSystemId, spaceState) {
  return updateShipItem(shipId, (currentItem) => ({
    ...currentItem,
    locationID: toNumber(solarSystemId, currentItem.locationID),
    flagID: 0,
    spaceState: normalizeSpaceState({
      ...(spaceState || {}),
      systemID: toNumber(solarSystemId, currentItem.locationID),
    }),
    conditionState: normalizeShipConditionState(currentItem.conditionState),
  }));
}

function dockShipToStation(shipId, stationId) {
  return dockShipToLocation(shipId, stationId);
}

function dockShipToLocation(shipId, locationId) {
  const numericLocationId = toNumber(locationId, 0);
  const station = worldData.getStationByID(numericLocationId);
  const structure =
    station || numericLocationId <= 0
      ? null
      : getStructureState().getStructureByID(numericLocationId, {
          refresh: false,
        });
  if (!station && !structure) {
    return {
      success: false,
      errorMsg: "DOCK_LOCATION_NOT_FOUND",
    };
  }

  return updateShipItem(shipId, (currentItem) => ({
    ...currentItem,
    locationID: numericLocationId,
    flagID: ITEM_FLAGS.HANGAR,
    spaceState: null,
  }));
}

function spawnShipInStationHangar(charId, stationId, shipType) {
  ensureMigrated();
  const createResult = createShipItemForCharacter(charId, stationId, shipType);
  if (!createResult.success) {
    return createResult;
  }

  return {
    success: true,
    created: true,
    data: createResult.data,
  };
}

function setActiveShipForCharacter(charId, shipId) {
  const shipItem = findCharacterShipItem(charId, shipId);
  if (!shipItem) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const syncResult = syncCharacterActiveShip(charId, shipItem);
  if (!syncResult.success) {
    return syncResult;
  }

  return {
    success: true,
    data: shipItem,
  };
}

function ensureCapsuleForCharacter(charId, stationId) {
  const existingCapsule = findCharacterShipByType(charId, CAPSULE_TYPE_ID, stationId);
  if (existingCapsule) {
    return {
      success: true,
      created: false,
      data: existingCapsule,
    };
  }

  return createShipItemForCharacter(charId, stationId, {
    typeID: CAPSULE_TYPE_ID,
    name: "Capsule",
  });
}

function listContainerItems(ownerId, locationId, flagId = null) {
  const numericLocationId = toNumber(locationId, 0);
  const numericOwnerId =
    ownerId === null || ownerId === undefined ? null : toNumber(ownerId, 0);
  const numericFlagId =
    flagId === null || flagId === undefined ? null : toNumber(flagId, 0);

  return (ensureItemIndexes().byLocation.get(numericLocationId) || [])
    .filter(
      (entry) =>
        entry &&
        entry.locationID === numericLocationId &&
        (numericOwnerId === null || entry.ownerID === numericOwnerId) &&
        (numericFlagId === null || entry.flagID === numericFlagId),
    )
    .map((entry) => cloneValue(entry));
}

function listSystemSpaceItems(systemId) {
  const numericSystemId = toNumber(systemId, 0);
  if (numericSystemId <= 0) {
    return [];
  }

  const now = Date.now();

  return (ensureItemIndexes().byLocation.get(numericSystemId) || [])
    .filter(
      (entry) =>
        entry &&
        entry.locationID === numericSystemId &&
        entry.flagID === 0 &&
        entry.spaceState &&
        toNumber(entry.spaceState.systemID, 0) === numericSystemId &&
        (
          !Number.isFinite(Number(entry.expiresAtMs)) ||
          Number(entry.expiresAtMs) > now
        ),
    )
    .map((entry) => cloneValue(entry));
}

function pruneExpiredSpaceItems(now = Date.now()) {
  ensureMigrated();
  const numericNow = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const items = Object.values(readItems())
    .map((entry) => normalizeInventoryItem(entry))
    .filter(Boolean)
    .sort((left, right) => left.itemID - right.itemID);

  const removedTopLevelItemIDs = [];
  const removedChanges = [];
  const seen = new Set();

  for (const item of items) {
    const itemID = toNumber(item && item.itemID, 0);
    if (
      itemID <= 0 ||
      seen.has(itemID) ||
      toNumber(item.locationID, 0) <= 0 ||
      toNumber(item.flagID, 0) !== 0 ||
      !item.spaceState ||
      !Number.isFinite(Number(item.expiresAtMs)) ||
      Number(item.expiresAtMs) > numericNow
    ) {
      continue;
    }

    const removeResult = removeInventoryItem(itemID, { removeContents: true });
    if (!removeResult.success) {
      continue;
    }

    removedTopLevelItemIDs.push(itemID);
    removedChanges.push(...((removeResult.data && removeResult.data.changes) || []));
    for (const removedItem of (removeResult.data && removeResult.data.removedItems) || []) {
      seen.add(toNumber(removedItem && removedItem.itemID, 0));
    }
  }

  return {
    success: true,
    data: {
      removedTopLevelItemIDs,
      changes: removedChanges,
    },
  };
}

function getShipConditionState(shipItem) {
  return normalizeShipConditionState(shipItem && shipItem.conditionState);
}

function resetInventoryStoreForTests() {
  migrationComplete = false;
  itemsTableCache = null;
  itemIndexesDirty = true;
  itemIndexesCache = null;
  reservedItemIDBatch = [];
  itemMutationVersion += 1;
}

module.exports = {
  ITEMS_TABLE,
  ITEM_FLAGS,
  FIGHTER_TUBE_FLAGS,
  SHIP_CATEGORY_ID,
  CAPSULE_TYPE_ID,
  CLIENT_INVENTORY_STACK_LIMIT,
  ensureMigrated,
  getAllItems,
  listOwnedItems,
  listCharacterItems,
  getCharacterShipItems,
  getCharacterHangarShipItems,
  findCharacterShipItem,
  findItemById,
  findShipItemById,
  findCharacterShipByType,
  ensureCharacterActiveShipItem,
  getActiveShipItem,
  grantItemsToCharacterLocation,
  grantItemToCharacterLocation,
  grantItemsToOwnerLocation,
  grantItemToOwnerLocation,
  grantItemToCharacterStationHangar,
  grantItemsToCharacterStationHangar,
  createSpaceItemForCharacter,
  createSpaceItemForOwner,
  takeItemTypeFromCharacterLocation,
  takeItemTypeFromOwnerLocation,
  spawnShipInStationHangar,
  updateInventoryItem,
  removeInventoryItem,
  consumeInventoryItemQuantity,
  pruneExpiredSpaceItems,
  moveItemToLocation,
  transferItemToOwnerLocation,
  moveItemTypeFromCharacterLocation,
  mergeItemStacks,
  updateShipItem,
  setShipPackagingState,
  setItemPackagingState,
  moveShipToSpace,
  dockShipToLocation,
  dockShipToStation,
  setActiveShipForCharacter,
  ensureCapsuleForCharacter,
  buildRemovedItemNotificationState,
  listContainerItems,
  listSystemSpaceItems,
  buildInventoryItem,
  buildShipItem,
  normalizeInventoryItem,
  normalizeShipItem,
  captureItemState,
  getShipConditionState,
  resetInventoryStoreForTests,
  normalizeShipConditionState,
  normalizeModuleState,
  getItemMetadata,
  getItemMutationVersion,
};
