const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const {
  findSessionByCharacterID,
} = require(path.join(__dirname, "../chat/sessionRegistry"));
const {
  ITEM_FLAGS,
  findItemById,
  getItemMutationVersion,
  grantItemToCharacterLocation,
  listContainerItems,
  moveItemToLocation,
  removeInventoryItem,
  updateInventoryItem,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  buildShipResourceState,
  getAttributeIDByNames,
  getTypeAttributeValue,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const {
  getShipFittingSnapshot,
} = require(path.join(__dirname, "../../_secondary/fitting/fittingRuntime"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const {
  DRONE_CATEGORY_ID,
  isDroneItemRecord,
} = require(path.join(__dirname, "../fighter/fighterInventory"));
const {
  resolveDroneCombatSnapshot,
  resolveDroneMiningSnapshot,
  resolveDroneSalvageSnapshot,
} = require(path.join(__dirname, "./droneDogma"));
const jammerModuleRuntime = require(path.join(
  __dirname,
  "../../space/modules/jammerModuleRuntime",
));
const salvagerRuntime = require(path.join(
  __dirname,
  "../../space/modules/salvagerRuntime",
));
const {
  hasDamageableHealth,
} = require(path.join(__dirname, "../../space/combat/damage"));
const {
  computeMiningResult,
} = require(path.join(__dirname, "../mining/miningMath"));
const {
  MINING_HOLD_FLAGS,
  getPreferredMiningHoldFlagForType,
  getShipHoldCapacityByFlag,
} = require(path.join(__dirname, "../mining/miningInventory"));
const {
  ensureSceneMiningState,
  getMineableState,
  applyMiningDelta,
} = require(path.join(__dirname, "../mining/miningRuntimeState"));

const STATE_IDLE = 0;
const STATE_COMBAT = 1;
const STATE_MINING = 2;
const STATE_APPROACHING = 3;
const STATE_DEPARTING = 4;
const STATE_PURSUIT = 6;
const STATE_SALVAGING = 18;

const DRONE_COMMAND_RETURN_BAY = "RETURN_BAY";
const DRONE_COMMAND_RETURN_HOME = "RETURN_HOME";
const DRONE_COMMAND_ENGAGE = "ENGAGE";
const DRONE_COMMAND_MINE = "MINE";
const DRONE_COMMAND_SALVAGE = "SALVAGE";
const ATTRIBUTE_DRONE_IS_AGGRESSIVE =
  getAttributeIDByNames("droneIsAggressive", "droneIsAgressive") || 1275;
const ATTRIBUTE_DRONE_FOCUS_FIRE =
  getAttributeIDByNames("droneFocusFire") || 1297;

const DRONE_BAY_SCOOP_DISTANCE_METERS = 2500;
const DRONE_BAY_RETURN_APPROACH_DISTANCE_METERS = 0;
const DEFAULT_DRONE_LAUNCH_OFFSET_METERS = 75;
const MIN_ORBIT_DISTANCE_METERS = 500;
const MAX_ORBIT_DISTANCE_METERS = 5000;
const ONE_METER = 1;
const DEFAULT_DRONE_IS_AGGRESSIVE = true;
const DEFAULT_DRONE_FOCUS_FIRE = false;
const DRONE_AGGRESSION_THREAT_RETENTION_MS = 30_000;

function getCharacterStateService() {
  return require(path.join(__dirname, "../character/characterState"));
}

function resolveCharacterRecord(characterID) {
  const characterState = getCharacterStateService();
  return characterState && typeof characterState.getCharacterRecord === "function"
    ? characterState.getCharacterRecord(characterID)
    : null;
}

function resolveActiveShipRecord(characterID) {
  const characterState = getCharacterStateService();
  return characterState && typeof characterState.getActiveShipRecord === "function"
    ? characterState.getActiveShipRecord(characterID)
    : null;
}

function buildDogmaPrimeEntry(item, options = {}) {
  const characterState = getCharacterStateService();
  return characterState &&
    typeof characterState.buildInventoryDogmaPrimeEntry === "function"
    ? characterState.buildInventoryDogmaPrimeEntry(item, options)
    : characterState &&
      typeof characterState.buildChargeDogmaPrimeEntry === "function"
      ? characterState.buildChargeDogmaPrimeEntry(item, options)
    : null;
}

function syncInventoryItemForCharacterSession(session, item, previousData, options = {}) {
  const characterState = getCharacterStateService();
  if (!characterState || typeof characterState.syncInventoryItemForSession !== "function") {
    return false;
  }
  return characterState.syncInventoryItemForSession(
    session,
    item,
    previousData,
    options,
  );
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toInt(value, fallback = 0) {
  return Math.trunc(toNumber(value, fallback));
}

function buildCreatedInventoryInsertPreviousState(item) {
  return {
    locationID: 0,
    flagID: toInt(item && item.flagID, 0),
    quantity: 0,
    stacksize: 0,
    singleton: 0,
  };
}

function buildDroneLaunchPreviousState(entity, item, shipRecord) {
  const shipID = toInt(shipRecord && shipRecord.itemID, 0);
  const systemID = toInt(entity && entity.systemID, 0);
  if (
    shipID <= 0 ||
    systemID <= 0 ||
    !item ||
    !isDroneItemRecord(item) ||
    toInt(item.locationID, 0) !== systemID ||
    toInt(item.flagID, 0) !== 0
  ) {
    return null;
  }

  // CCP client godma treats launched drones specially only when the item
  // change says they moved from the controlling ship's drone bay into the
  // solar system. Without this old location/flag pair, split-created drones
  // look like generic brand-new space items and one can fall out of the
  // active-drone UI even though the ball exists.
  return {
    locationID: shipID,
    flagID: ITEM_FLAGS.DRONE_BAY,
  };
}

function buildDroneBayClientItem(item, shipRecord) {
  const shipID = toInt(shipRecord && shipRecord.itemID, 0);
  if (!item || shipID <= 0) {
    return null;
  }

  return {
    ...item,
    locationID: shipID,
    flagID: ITEM_FLAGS.DRONE_BAY,
    quantity: null,
    stacksize: 1,
    singleton: 1,
    launcherID: shipID,
  };
}

function primeDroneBayDogmaForLaunch(item, shipRecord, sessions = null) {
  const targetSessions = normalizeDroneSessions(sessions);
  if (targetSessions.length <= 0) {
    return false;
  }

  const bayItem = buildDroneBayClientItem(item, shipRecord);
  const shipID = toInt(shipRecord && shipRecord.itemID, 0);
  if (!bayItem || shipID <= 0) {
    return false;
  }

  const primeEntry = buildDogmaPrimeEntry(bayItem, {
    description: "drone",
    includeTypeAttributes: true,
  });
  if (!primeEntry) {
    return false;
  }

  for (const session of targetSessions) {
    if (!session || typeof session.sendNotification !== "function") {
      continue;
    }
    session.sendNotification("OnGodmaPrimeItem", "clientID", [shipID, primeEntry]);
  }
  syncInventoryItemToSessions(targetSessions, bayItem, {}, {
    emitCfgLocation: false,
  });
  return true;
}

function syncInventoryItemToSessions(
  sessions,
  item,
  previousData,
  options = {},
) {
  for (const session of normalizeDroneSessions(sessions)) {
    if (!session) {
      continue;
    }
    syncInventoryItemForCharacterSession(
      session,
      item,
      previousData,
      options,
    );
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(toNumber(value, min), min), max);
}

function normalizeDroneSessions(sessions) {
  const normalizedSessions = [];
  const seenSessions = new Set();
  for (const session of Array.isArray(sessions) ? sessions : []) {
    if (!session || seenSessions.has(session)) {
      continue;
    }
    seenSessions.add(session);
    normalizedSessions.push(session);
  }
  return normalizedSessions;
}

function getDroneIdentityPrimeSessionKey(session) {
  return toInt(
    session &&
      (session.clientID ||
        session.characterID ||
        session.charid),
    0,
  );
}

function getDroneIdentityPrimeCache(entity) {
  if (!entity || typeof entity !== "object") {
    return null;
  }

  if (!(entity.clientIdentityPrimedSessionKeys instanceof Set)) {
    entity.clientIdentityPrimedSessionKeys = new Set();
  }
  return entity.clientIdentityPrimedSessionKeys;
}

function cloneVector(source = null, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: toNumber(source && source.x, fallback.x),
    y: toNumber(source && source.y, fallback.y),
    z: toNumber(source && source.z, fallback.z),
  };
}

function addVectors(left, right) {
  return {
    x: toNumber(left && left.x, 0) + toNumber(right && right.x, 0),
    y: toNumber(left && left.y, 0) + toNumber(right && right.y, 0),
    z: toNumber(left && left.z, 0) + toNumber(right && right.z, 0),
  };
}

function subtractVectors(left, right) {
  return {
    x: toNumber(left && left.x, 0) - toNumber(right && right.x, 0),
    y: toNumber(left && left.y, 0) - toNumber(right && right.y, 0),
    z: toNumber(left && left.z, 0) - toNumber(right && right.z, 0),
  };
}

function scaleVector(vector, scalar) {
  return {
    x: toNumber(vector && vector.x, 0) * toNumber(scalar, 0),
    y: toNumber(vector && vector.y, 0) * toNumber(scalar, 0),
    z: toNumber(vector && vector.z, 0) * toNumber(scalar, 0),
  };
}

function magnitude(vector) {
  const resolved = cloneVector(vector);
  return Math.sqrt(
    (resolved.x * resolved.x) +
    (resolved.y * resolved.y) +
    (resolved.z * resolved.z),
  );
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const resolved = cloneVector(vector, fallback);
  const length = magnitude(resolved);
  if (length <= 0) {
    return cloneVector(fallback);
  }
  return scaleVector(resolved, 1 / length);
}

function distance(left, right) {
  return magnitude(subtractVectors(left, right));
}

function buildPerpendicular(vector) {
  const normalized = normalizeVector(vector, { x: 1, y: 0, z: 0 });
  if (Math.abs(normalized.x) < 0.5 && Math.abs(normalized.y) < 0.5) {
    return normalizeVector({ x: 0, y: 1, z: 0 });
  }
  return normalizeVector({ x: -normalized.y, y: normalized.x, z: 0 });
}

function serializeDroneSpaceState(entity) {
  return {
    systemID: toInt(entity && entity.systemID, 0),
    position: cloneVector(entity && entity.position),
    velocity: cloneVector(entity && entity.velocity),
    direction: cloneVector(entity && entity.direction, { x: 1, y: 0, z: 0 }),
    targetPoint: cloneVector(entity && entity.targetPoint, entity && entity.position),
    speedFraction: clamp(entity && entity.speedFraction, 0, 1),
    mode: String(entity && entity.mode || "STOP"),
    targetEntityID: toInt(entity && entity.targetEntityID, 0) || null,
    followRange: Math.max(0, toNumber(entity && entity.followRange, 0)),
    orbitDistance: Math.max(0, toNumber(entity && entity.orbitDistance, 0)),
    orbitNormal: cloneVector(entity && entity.orbitNormal, buildPerpendicular(entity && entity.direction)),
    orbitSign: toNumber(entity && entity.orbitSign, 1) < 0 ? -1 : 1,
    pendingWarp: null,
    warpState: null,
  };
}

function buildDroneErrorTuple(message) {
  return [
    "CustomNotify",
    buildMarshalDict([["notify", String(message || "")]]),
  ];
}

function buildMarshalDict(entries = []) {
  return {
    type: "dict",
    entries: Array.isArray(entries) ? entries : [],
  };
}

function buildMarshalList(items = []) {
  return {
    type: "list",
    items: Array.isArray(items) ? items : [],
  };
}

function buildNotifyErrorResult(message) {
  return buildMarshalDict([
    [
      "CustomNotify",
      buildMarshalDict([["notify", String(message || "")]]),
    ],
  ]);
}

function buildMultiDroneResult(droneIDs = []) {
  return buildMarshalDict();
}

function ensureLaunchResponseEntry(result, itemID) {
  const numericItemID = toInt(itemID, 0);
  if (
    !result ||
    result.type !== "dict" ||
    !Array.isArray(result.entries) ||
    numericItemID <= 0
  ) {
    return null;
  }

  let existingEntry = result.entries.find(
    (entry) => Array.isArray(entry) && toInt(entry[0], 0) === numericItemID,
  );
  if (!existingEntry) {
    existingEntry = [numericItemID, buildMarshalList()];
    result.entries.push(existingEntry);
  }

  if (
    !existingEntry[1] ||
    existingEntry[1].type !== "list" ||
    !Array.isArray(existingEntry[1].items)
  ) {
    existingEntry[1] = buildMarshalList();
  }

  return existingEntry[1];
}

function appendLaunchEntry(result, itemID, value) {
  const launchEntries = ensureLaunchResponseEntry(result, itemID);
  if (!launchEntries) {
    return result;
  }
  launchEntries.items.push(value);
  return result;
}

function appendLaunchError(result, itemID, message) {
  return appendLaunchEntry(result, itemID, buildDroneErrorTuple(message));
}

function appendDroneError(result, droneID, message) {
  const numericDroneID = toInt(droneID, 0);
  if (
    !result ||
    result.type !== "dict" ||
    !Array.isArray(result.entries) ||
    numericDroneID <= 0
  ) {
    return result;
  }

  const existingEntry = result.entries.find(
    (entry) => Array.isArray(entry) && toInt(entry[0], 0) === numericDroneID,
  );
  if (existingEntry) {
    existingEntry[1] = buildDroneErrorTuple(message);
    return result;
  }

  result.entries.push([numericDroneID, buildDroneErrorTuple(message)]);
  return result;
}

function listifyRawValue(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue;
  }
  if (rawValue && rawValue.type === "list" && Array.isArray(rawValue.items)) {
    return rawValue.items;
  }
  return rawValue === null || rawValue === undefined ? [] : [rawValue];
}

function isIterableCollection(rawValue) {
  return Boolean(
    rawValue &&
      typeof rawValue !== "string" &&
      typeof rawValue[Symbol.iterator] === "function",
  );
}

function flattenDroneCommandValues(rawValue, result = [], depth = 0) {
  if (rawValue === null || rawValue === undefined || depth > 8) {
    return result;
  }

  if (Array.isArray(rawValue)) {
    for (const entry of rawValue) {
      flattenDroneCommandValues(entry, result, depth + 1);
    }
    return result;
  }

  if (rawValue && rawValue.type === "list" && Array.isArray(rawValue.items)) {
    for (const entry of rawValue.items) {
      flattenDroneCommandValues(entry, result, depth + 1);
    }
    return result;
  }

  if (rawValue instanceof Map) {
    for (const key of rawValue.keys()) {
      flattenDroneCommandValues(key, result, depth + 1);
    }
    return result;
  }

  if (rawValue instanceof Set) {
    for (const entry of rawValue) {
      flattenDroneCommandValues(entry, result, depth + 1);
    }
    return result;
  }

  if (rawValue && rawValue.type === "dict" && Array.isArray(rawValue.entries)) {
    for (const entry of rawValue.entries) {
      if (Array.isArray(entry) && entry.length > 0) {
        flattenDroneCommandValues(entry[0], result, depth + 1);
      }
    }
    return result;
  }

  if (rawValue && typeof rawValue.keys === "function") {
    try {
      const keysView = rawValue.keys();
      if (isIterableCollection(keysView)) {
        for (const key of keysView) {
          flattenDroneCommandValues(key, result, depth + 1);
        }
        return result;
      }
    } catch (error) {
      void error;
    }
  }

  if (isIterableCollection(rawValue)) {
    for (const entry of rawValue) {
      flattenDroneCommandValues(entry, result, depth + 1);
    }
    return result;
  }

  if (rawValue && typeof rawValue === "object") {
    const objectKeys = Object.keys(rawValue);
    if (objectKeys.length > 0) {
      const numericKeys = objectKeys
        .map((key) => ({
          key,
          numeric: Number(key),
        }))
        .filter((entry) => Number.isInteger(entry.numeric) && entry.numeric >= 0);
      if (numericKeys.length === objectKeys.length) {
        const sortedNumericKeys = numericKeys
          .map((entry) => entry.numeric)
          .sort((left, right) => left - right);
        const looksArrayLike = sortedNumericKeys.every((value, index) => value === index);
        if (looksArrayLike) {
          for (const entry of objectKeys) {
            flattenDroneCommandValues(rawValue[entry], result, depth + 1);
          }
          return result;
        }
        for (const entry of objectKeys) {
          flattenDroneCommandValues(entry, result, depth + 1);
        }
        return result;
      }
    }
  }

  result.push(rawValue);
  return result;
}

function normalizeDroneIDList(rawValue) {
  return [...new Set(
    flattenDroneCommandValues(rawValue)
      .map((value) => toInt(value, 0))
      .filter((value) => value > 0),
  )];
}

function normalizeLaunchRequests(rawValue) {
  const normalized = [];
  for (const entry of listifyRawValue(rawValue)) {
    const tuple = listifyRawValue(entry);
    const itemID = toInt(tuple[0], 0);
    const quantity = Math.max(1, toInt(tuple[1], 1));
    if (itemID > 0) {
      normalized.push({ itemID, quantity });
    }
  }
  return normalized;
}

function isDroneEntity(entity) {
  return Boolean(entity && entity.kind === "drone");
}

function resolveDroneControllerOwnerCharacterID(controllerEntity = null, droneEntity = null) {
  return toInt(
    controllerEntity &&
      (
        controllerEntity.session &&
        controllerEntity.session.characterID
      ) ||
      controllerEntity &&
      (
        controllerEntity.pilotCharacterID ??
        controllerEntity.characterID ??
        controllerEntity.ownerID
      ) ||
      droneEntity &&
      (
        droneEntity.controllerOwnerID ??
        droneEntity.ownerID
      ),
    0,
  );
}

function getRuntime() {
  return require(path.join(__dirname, "../../space/runtime"));
}

function getInterestedDroneSessions(entity) {
  const sessions = new Set();
  const controllerOwnerID = toInt(entity && entity.controllerOwnerID, 0);
  const ownerID = toInt(entity && entity.ownerID, 0);
  const controllerEntity =
    entity && entity.systemID
      ? getRuntime().getEntity(entity.systemID, entity.controllerID)
      : null;

  if (controllerEntity && controllerEntity.session) {
    sessions.add(controllerEntity.session);
  }
  if (controllerOwnerID > 0) {
    const controllerOwnerSession = findSessionByCharacterID(controllerOwnerID);
    if (controllerOwnerSession) {
      sessions.add(controllerOwnerSession);
    }
  }
  if (ownerID > 0) {
    const ownerSession = findSessionByCharacterID(ownerID);
    if (ownerSession) {
      sessions.add(ownerSession);
    }
  }
  return [...sessions];
}

function ensureDroneClientIdentityState(
  entity,
  shipRecord = null,
  sessions = null,
  options = {},
) {
  if (!entity) {
    return false;
  }

  const targetSessions = normalizeDroneSessions(
    Array.isArray(sessions)
      ? sessions
      : getInterestedDroneSessions(entity),
  );
  if (targetSessions.length <= 0) {
    return false;
  }

  const primeCache = getDroneIdentityPrimeCache(entity);
  const forceInsert = options.forceInsert === true;
  const forceRefresh = options.forceRefresh === true;
  const skipInventorySync = options.skipInventorySync === true;
  const skipDogmaPrime = options.skipDogmaPrime === true;
  const sessionsNeedingIdentity = forceInsert || forceRefresh
    ? targetSessions
    : targetSessions.filter((session) => {
        const sessionKey = getDroneIdentityPrimeSessionKey(session);
        return sessionKey <= 0 || !primeCache || !primeCache.has(sessionKey);
      });
  if (sessionsNeedingIdentity.length <= 0) {
    return false;
  }

  const currentItem = findItemById(toInt(entity.itemID, 0));
  if (currentItem && !skipInventorySync) {
    const launchPreviousState = buildDroneLaunchPreviousState(
      entity,
      currentItem,
      shipRecord,
    );
    const previousInventoryState = launchPreviousState ||
      (forceInsert !== true
        ? {
            locationID: currentItem.locationID,
            flagID: currentItem.flagID,
            quantity: currentItem.quantity,
            stacksize: currentItem.stacksize,
            singleton: currentItem.singleton,
          }
        : buildCreatedInventoryInsertPreviousState(currentItem));
    syncInventoryItemToSessions(
      sessionsNeedingIdentity,
      currentItem,
      previousInventoryState,
      {
        emitCfgLocation: false,
      },
    );
  }

  if (shipRecord && !skipDogmaPrime) {
    emitDroneDogmaPrime(entity, shipRecord, sessionsNeedingIdentity, currentItem);
  }

  if (primeCache) {
    for (const session of sessionsNeedingIdentity) {
      const sessionKey = getDroneIdentityPrimeSessionKey(session);
      if (sessionKey > 0) {
        primeCache.add(sessionKey);
      }
    }
  }

  return Boolean(currentItem || shipRecord);
}

function buildDroneStateNotificationTuple(entity, overrides = {}) {
  return [
    toInt(overrides.droneID ?? (entity && entity.itemID), 0),
    toInt(overrides.ownerID ?? (entity && entity.ownerID), 0),
    toInt(overrides.controllerID ?? (entity && entity.controllerID), 0),
    toInt(overrides.activityState ?? (entity && entity.activityState), STATE_IDLE),
    toInt(overrides.typeID ?? (entity && entity.typeID), 0),
    toInt(
      overrides.controllerOwnerID ?? (entity && entity.controllerOwnerID),
      0,
    ),
    toInt(overrides.targetID ?? (entity && entity.targetID), 0) || null,
  ];
}

function emitDroneStateChange(entity, overrides = {}, sessions = null) {
  const targetSessions = normalizeDroneSessions(
    Array.isArray(sessions)
      ? sessions
      : getInterestedDroneSessions(entity),
  );
  const payload = buildDroneStateNotificationTuple(entity, overrides);
  for (const session of targetSessions) {
    if (!session || typeof session.sendNotification !== "function") {
      continue;
    }
    session.sendNotification("OnDroneStateChange", "charid", payload);
  }
}

function emitDroneActivityChange(entity, activityID = null, activity = null, sessions = null) {
  const targetSessions = normalizeDroneSessions(
    Array.isArray(sessions)
      ? sessions
      : getInterestedDroneSessions(entity),
  );
  const payload = [
    toInt(entity && entity.itemID, 0),
    toInt(activityID, 0) || null,
    activity === null || activity === undefined ? null : String(activity),
  ];
  for (const session of targetSessions) {
    if (!session || typeof session.sendNotification !== "function") {
      continue;
    }
    session.sendNotification("OnDroneActivityChange", "charid", payload);
  }
}

function emitDroneDogmaPrime(entity, shipRecord, sessions = null, itemOverride = null) {
  if (!entity || !shipRecord) {
    return;
  }

  const targetSessions = normalizeDroneSessions(
    Array.isArray(sessions)
      ? sessions
      : getInterestedDroneSessions(entity),
  );
  if (targetSessions.length === 0) {
    return;
  }

  const currentItem =
    itemOverride && typeof itemOverride === "object"
      ? itemOverride
      : findItemById(toInt(entity.itemID, 0)) || null;
  // Prime launched/returning drones as their real live in-space items. If we
  // advertise them as flag=DRONE_BAY under the controlling ship here, the
  // client synthesizes phantom bay rows and the drone UI/damage tracker churn.
  const dogmaPrimeItem = {
    itemID: toInt(entity.itemID, 0),
    typeID: toInt(
      currentItem && currentItem.typeID,
      toInt(entity.typeID, 0),
    ),
    ownerID: toInt(
      currentItem && currentItem.ownerID,
      toInt(entity.ownerID, 0),
    ),
    locationID: toInt(
      currentItem && currentItem.locationID,
      toInt(entity.systemID, 0),
    ),
    flagID: toInt(currentItem && currentItem.flagID, 0),
    quantity:
      currentItem && currentItem.quantity !== undefined
        ? currentItem.quantity
        : null,
    stacksize: Math.max(
      1,
      toInt(
        currentItem && (currentItem.stacksize ?? currentItem.quantity),
        1,
      ),
    ),
    singleton: toInt(currentItem && currentItem.singleton, 1),
    groupID: toInt(
      currentItem && currentItem.groupID,
      toInt(entity.groupID, 0),
    ),
    categoryID: toInt(
      currentItem && currentItem.categoryID,
      DRONE_CATEGORY_ID,
    ),
    customInfo:
      currentItem && currentItem.customInfo !== undefined && currentItem.customInfo !== null
        ? String(currentItem.customInfo)
        : "",
    moduleState: null,
    conditionState: null,
    launcherID: toInt(shipRecord.itemID, 0),
    volume: toNumber(
      currentItem && currentItem.volume,
      toNumber(entity.volume, null),
    ),
  };
  const primeEntry = buildDogmaPrimeEntry(dogmaPrimeItem, {
    description: "drone",
    includeTypeAttributes: true,
  });
  if (!primeEntry) {
    return;
  }

  const primeLocationID = toInt(
    dogmaPrimeItem.locationID,
    toInt(entity.systemID, 0),
  );
  for (const session of targetSessions) {
    if (!session || typeof session.sendNotification !== "function") {
      continue;
    }
    session.sendNotification("OnGodmaPrimeItem", "clientID", [primeLocationID, primeEntry]);
  }
}

function handleDroneDestroyed(scene, droneEntity) {
  if (!scene || !isDroneEntity(droneEntity)) {
    return false;
  }

  const interestedSessions = getInterestedDroneSessions(droneEntity);
  if (interestedSessions.length <= 0) {
    return false;
  }

  emitDroneStateChange(droneEntity, {
    ownerID: 0,
    controllerID: 0,
    activityState: STATE_IDLE,
    controllerOwnerID: 0,
    targetID: 0,
  }, interestedSessions);
  emitDroneActivityChange(droneEntity, null, null, interestedSessions);
  markSceneControlledCombatDroneIndexDirty(scene);
  return true;
}

function markSceneControlledCombatDroneIndexDirty(scene) {
  if (!scene) {
    return;
  }
  scene.droneControlledCombatIndexDirty = true;
}

function pruneSceneDroneAggressionThreats(scene, now) {
  if (!scene || !(scene.droneAggressionThreatsByController instanceof Map)) {
    return;
  }
  const threshold = toNumber(now, Date.now()) - DRONE_AGGRESSION_THREAT_RETENTION_MS;
  for (const [controllerID, threatMap] of scene.droneAggressionThreatsByController.entries()) {
    if (!(threatMap instanceof Map)) {
      scene.droneAggressionThreatsByController.delete(controllerID);
      continue;
    }
    for (const [targetID, lastAggressedAtMs] of threatMap.entries()) {
      if (toNumber(lastAggressedAtMs, 0) < threshold) {
        threatMap.delete(targetID);
      }
    }
    if (threatMap.size <= 0) {
      scene.droneAggressionThreatsByController.delete(controllerID);
    }
  }
}

function getSceneDroneAggressionThreats(scene) {
  if (!scene) {
    return new Map();
  }
  if (!(scene.droneAggressionThreatsByController instanceof Map)) {
    scene.droneAggressionThreatsByController = new Map();
  }
  return scene.droneAggressionThreatsByController;
}

function isDroneCombatCapable(droneEntity, controllerEntity = null) {
  if (!isDroneEntity(droneEntity)) {
    return false;
  }
  if (typeof droneEntity.droneCombatCapable === "boolean") {
    return droneEntity.droneCombatCapable;
  }
  droneEntity.droneCombatCapable = Boolean(
    resolveDroneCombatSnapshot(droneEntity, controllerEntity) || null,
  );
  return droneEntity.droneCombatCapable;
}

function normalizeDroneBehaviorSettings(rawSettings = null) {
  const source =
    rawSettings && typeof rawSettings === "object"
      ? rawSettings
      : {};
  return {
    aggressive: Object.prototype.hasOwnProperty.call(
      source,
      ATTRIBUTE_DRONE_IS_AGGRESSIVE,
    )
      ? Boolean(source[ATTRIBUTE_DRONE_IS_AGGRESSIVE])
      : DEFAULT_DRONE_IS_AGGRESSIVE,
    focusFire: Object.prototype.hasOwnProperty.call(
      source,
      ATTRIBUTE_DRONE_FOCUS_FIRE,
    )
      ? Boolean(source[ATTRIBUTE_DRONE_FOCUS_FIRE])
      : DEFAULT_DRONE_FOCUS_FIRE,
  };
}

function getControllerDroneBehaviorSettings(controllerEntity = null) {
  const characterID = resolveDroneControllerOwnerCharacterID(controllerEntity);
  const controllerSession =
    controllerEntity &&
    controllerEntity.session &&
    typeof controllerEntity.session === "object"
      ? controllerEntity.session
      : characterID > 0
        ? findSessionByCharacterID(characterID)
        : null;
  const cachedSettings =
    controllerSession &&
    controllerSession.droneSettings &&
    typeof controllerSession.droneSettings === "object"
      ? controllerSession.droneSettings
      : null;
  if (cachedSettings) {
    return normalizeDroneBehaviorSettings(cachedSettings);
  }

  const characterRecord = characterID > 0 ? resolveCharacterRecord(characterID) || null : null;
  const persistedSettings =
    characterRecord &&
    characterRecord.droneSettings &&
    typeof characterRecord.droneSettings === "object"
      ? characterRecord.droneSettings
      : {};
  const normalizedSettings = normalizeDroneBehaviorSettings(persistedSettings);
  if (controllerSession) {
    controllerSession.droneSettings = {
      ...persistedSettings,
      [ATTRIBUTE_DRONE_IS_AGGRESSIVE]: normalizedSettings.aggressive,
      [ATTRIBUTE_DRONE_FOCUS_FIRE]: normalizedSettings.focusFire,
    };
  }
  return normalizedSettings;
}

function isCreatedInventoryChange(change) {
  if (!change || !change.item || !change.previousData) {
    return false;
  }
  const previousLocationID = toInt(change.previousData.locationID, 0);
  const previousQuantity = Number(change.previousData.quantity);
  const previousStacksize = Number(change.previousData.stacksize);
  return previousLocationID === 0 && (
    previousQuantity === 0 ||
    previousStacksize === 0
  );
}

function emitRelevantInventoryChanges(session, shipID, changes = [], options = {}) {
  const numericShipID = toInt(shipID, 0);
  if (!session || numericShipID <= 0) {
    return;
  }
  const includeCreatedItems = options.includeCreatedItems === true;
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change || !change.item) {
      continue;
    }
    const currentLocationID = toInt(change.item.locationID, 0);
    const previousLocationID = toInt(change.previousData && change.previousData.locationID, 0);
    if (
      currentLocationID !== numericShipID &&
      previousLocationID !== numericShipID &&
      !(includeCreatedItems && isCreatedInventoryChange(change))
    ) {
      continue;
    }
    syncInventoryItemForCharacterSession(session, change.item, change.previousData || {}, {
      emitCfgLocation: true,
    });
  }
}

function resolveShipStorageSnapshotForDrone(controllerEntity) {
  if (!controllerEntity) {
    return null;
  }

  const characterID = toInt(
    controllerEntity &&
      (
        controllerEntity.session &&
        controllerEntity.session.characterID
      ) ||
      controllerEntity &&
      (
        controllerEntity.pilotCharacterID ??
        controllerEntity.characterID ??
        controllerEntity.ownerID
      ),
    0,
  );
  const shipID = toInt(controllerEntity && controllerEntity.itemID, 0);
  if (characterID <= 0 || shipID <= 0) {
    return null;
  }

  const mutationVersion = toInt(getItemMutationVersion(), 0);
  const cacheKey = `${characterID}:${shipID}:${mutationVersion}`;
  const cached =
    controllerEntity.droneStorageCache &&
    controllerEntity.droneStorageCache.key === cacheKey
      ? controllerEntity.droneStorageCache.snapshot
      : null;
  if (cached) {
    return cached;
  }

  const shipItem = findItemById(shipID) || null;
  if (!shipItem) {
    return null;
  }

  const resourceState = buildShipResourceState(characterID, shipItem, {
    skillMap: controllerEntity.skillMap,
    fittedItems: controllerEntity.fittedItems,
  });
  const usedByFlag = new Map();
  for (const item of listContainerItems(characterID, shipID, null)) {
    const flagID = toInt(item && item.flagID, 0);
    const units = Math.max(
      0,
      toInt(item && (item.stacksize ?? item.quantity), 1) || 1,
    );
    const itemVolume = Math.max(
      0,
      toNumber(item && item.volume, 0),
    );
    usedByFlag.set(
      flagID,
      Number(
        (
          toNumber(usedByFlag.get(flagID), 0) +
          (itemVolume * units)
        ).toFixed(6)
      ),
    );
  }

  const snapshot = {
    characterID,
    shipID,
    resourceState,
    usedByFlag,
  };
  controllerEntity.droneStorageCache = {
    key: cacheKey,
    snapshot,
  };
  return snapshot;
}

function getAvailableDroneStorageVolume(storageSnapshot, flagID) {
  if (!storageSnapshot || !storageSnapshot.resourceState) {
    return 0;
  }

  const normalizedFlagID = toInt(flagID, 0);
  const capacity =
    normalizedFlagID === ITEM_FLAGS.CARGO_HOLD
      ? toNumber(storageSnapshot.resourceState.cargoCapacity, 0)
      : getShipHoldCapacityByFlag(
        storageSnapshot.resourceState,
        normalizedFlagID,
      );
  const used = toNumber(storageSnapshot.usedByFlag.get(normalizedFlagID), 0);
  return Math.max(0, Number((capacity - used).toFixed(6)));
}

function invalidateDroneStorageSnapshot(controllerEntity) {
  if (!controllerEntity) {
    return;
  }
  controllerEntity.droneStorageCache = null;
}

function classifyDroneMiningYieldKind(droneEntity) {
  const typeRecord = resolveItemByTypeID(toInt(droneEntity && droneEntity.typeID, 0)) || null;
  const droneName = String(
    typeRecord && typeRecord.name ||
    droneEntity && droneEntity.itemName ||
    "",
  ).trim().toLowerCase();
  if (!droneName) {
    return null;
  }
  if (droneName.includes("ice harvesting")) {
    return "ice";
  }
  if (droneName.includes("excavator") || droneName.includes("mining")) {
    return "ore";
  }
  return null;
}

function isDroneMiningCompatibleWithTarget(droneEntity, mineableState) {
  if (!droneEntity || !mineableState) {
    return false;
  }
  const family = classifyDroneMiningYieldKind(droneEntity);
  if (!family) {
    return false;
  }
  return family === String(mineableState.yieldKind || "").trim().toLowerCase();
}

function resolveDroneMiningDestination(controllerEntity, yieldTypeID, yieldKind = "") {
  const storageSnapshot = resolveShipStorageSnapshotForDrone(controllerEntity);
  if (!storageSnapshot) {
    return null;
  }

  const preferredFlag = getPreferredMiningHoldFlagForType(
    storageSnapshot.resourceState,
    yieldTypeID,
  );
  const normalizedYieldKind = String(yieldKind || "").trim().toLowerCase();
  const orderedFlags = [
    preferredFlag,
    normalizedYieldKind === "ore" ? MINING_HOLD_FLAGS.SPECIALIZED_ASTEROID_HOLD : null,
    normalizedYieldKind === "gas" ? MINING_HOLD_FLAGS.SPECIALIZED_GAS_HOLD : null,
    normalizedYieldKind === "ice" ? MINING_HOLD_FLAGS.SPECIALIZED_ICE_HOLD : null,
    MINING_HOLD_FLAGS.GENERAL_MINING_HOLD,
    ITEM_FLAGS.CARGO_HOLD,
  ].filter((value, index, array) => value && array.indexOf(value) === index);
  for (const flagID of orderedFlags) {
    const availableVolume = getAvailableDroneStorageVolume(
      storageSnapshot,
      flagID,
    );
    if (availableVolume > 0) {
      return {
        storageSnapshot,
        flagID,
        availableVolume,
      };
    }
  }

  return {
    storageSnapshot,
    flagID: preferredFlag || ITEM_FLAGS.CARGO_HOLD,
    availableVolume: 0,
  };
}

function getDroneMiningCycleDurationMs(snapshot) {
  return Math.max(1, toNumber(snapshot && snapshot.durationMs, 1000));
}

function beginDroneMiningCycle(miningState, snapshot, now) {
  if (!miningState || typeof miningState !== "object") {
    return false;
  }

  const cycleStartedAtMs = Math.max(0, toNumber(now, Date.now()));
  miningState.cycleStartedAtMs = cycleStartedAtMs;
  miningState.nextCycleAtMs =
    cycleStartedAtMs + getDroneMiningCycleDurationMs(snapshot);
  miningState.fxCycleKey = null;
  return true;
}

function clearDroneMiningCycle(miningState) {
  if (!miningState || typeof miningState !== "object") {
    return false;
  }
  miningState.cycleStartedAtMs = null;
  miningState.nextCycleAtMs = null;
  miningState.fxCycleKey = null;
  return true;
}

function resolveDroneMiningFxTargetID(targetEntityOrID) {
  return toInt(
    targetEntityOrID && typeof targetEntityOrID === "object"
      ? targetEntityOrID.itemID
      : targetEntityOrID,
    0,
  );
}

function emitDroneMiningCycleFx(
  scene,
  droneEntity,
  targetEntityOrID,
  snapshot,
  miningState,
  now,
  options = {},
) {
  if (!scene || !droneEntity || !snapshot || !snapshot.effectGUID) {
    return false;
  }

  const targetID = resolveDroneMiningFxTargetID(targetEntityOrID);
  if (targetID <= 0) {
    return false;
  }

  const active = options.active !== false;
  const durationMs = getDroneMiningCycleDurationMs(snapshot);
  const cycleStartedAtMs = toNumber(
    miningState && miningState.cycleStartedAtMs,
    toNumber(now, Date.now()),
  );
  const fxCycleKey = `${targetID}:${Math.trunc(cycleStartedAtMs)}:${durationMs}`;
  if (active && miningState && miningState.fxCycleKey === fxCycleKey) {
    return false;
  }

  scene.broadcastSpecialFx(
    droneEntity.itemID,
    snapshot.effectGUID,
    {
      moduleID: droneEntity.itemID,
      moduleTypeID: droneEntity.typeID,
      targetID,
      isOffensive: false,
      start: active,
      active: true,
      duration: durationMs,
      repeat: 1,
      useCurrentVisibleStamp: true,
    },
    droneEntity,
  );

  if (miningState) {
    miningState.fxCycleKey = active ? fxCycleKey : null;
  }
  return true;
}

function stopDroneMiningCycleFx(scene, droneEntity) {
  const miningState =
    droneEntity &&
    droneEntity.droneMining &&
    typeof droneEntity.droneMining === "object"
      ? droneEntity.droneMining
      : null;
  if (!miningState || !miningState.fxCycleKey) {
    return false;
  }
  return emitDroneMiningCycleFx(
    scene,
    droneEntity,
    miningState.targetID,
    miningState.snapshot,
    miningState,
    Date.now(),
    { active: false },
  );
}

function syncDroneInventoryChangesToSession(session, changes = []) {
  if (!session || typeof session.sendNotification !== "function") {
    return;
  }
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change || !change.item) {
      continue;
    }
    syncInventoryItemForCharacterSession(
      session,
      change.item,
      change.previousData || change.previousState || {},
      {
        emitCfgLocation: true,
      },
    );
  }
}

function clearDroneTaskState(droneEntity) {
  if (!droneEntity) {
    return;
  }
  droneEntity.droneCommand = null;
  droneEntity.droneCombat = null;
  droneEntity.droneMining = null;
  droneEntity.droneSalvage = null;
  droneEntity.activityID = null;
  droneEntity.activity = null;
}

function copyControllerIdentity(droneEntity, controllerEntity = null, controllerOwnerID = 0) {
  if (!droneEntity) {
    return;
  }

  const fallbackControllerOwnerID = toInt(
    (
      controllerEntity &&
      controllerEntity.session &&
      controllerEntity.session.characterID
    ) ||
      (
        controllerEntity &&
        (
          controllerEntity.pilotCharacterID ??
          controllerEntity.characterID ??
          droneEntity.ownerID
        )
      ),
    0,
  );
  const resolvedControllerOwnerID =
    toInt(controllerOwnerID, 0) > 0
      ? toInt(controllerOwnerID, 0)
      : fallbackControllerOwnerID;
  droneEntity.controllerOwnerID = resolvedControllerOwnerID;
  droneEntity.characterID = toInt(droneEntity.ownerID, resolvedControllerOwnerID);
  droneEntity.pilotCharacterID = resolvedControllerOwnerID;
  if (controllerEntity) {
    droneEntity.corporationID = toInt(
      controllerEntity.corporationID,
      toInt(droneEntity.corporationID, 0),
    );
    droneEntity.allianceID = toInt(
      controllerEntity.allianceID,
      toInt(droneEntity.allianceID, 0),
    );
    droneEntity.warFactionID = toInt(
      controllerEntity.warFactionID,
      toInt(droneEntity.warFactionID, 0),
    );
  }
}

function captureDroneClientState(entity) {
  return {
    ownerID: toInt(entity && entity.ownerID, 0),
    controllerID: toInt(entity && entity.controllerID, 0),
    activityState: toInt(entity && entity.activityState, STATE_IDLE),
    typeID: toInt(entity && entity.typeID, 0),
    controllerOwnerID: toInt(entity && entity.controllerOwnerID, 0),
    targetID: toInt(entity && entity.targetID, 0) || null,
  };
}

function didDroneClientStateChange(before, entity) {
  if (!before || !entity) {
    return true;
  }
  return (
    before.ownerID !== toInt(entity.ownerID, 0) ||
    before.controllerID !== toInt(entity.controllerID, 0) ||
    before.activityState !== toInt(entity.activityState, STATE_IDLE) ||
    before.typeID !== toInt(entity.typeID, 0) ||
    before.controllerOwnerID !== toInt(entity.controllerOwnerID, 0) ||
    before.targetID !== (toInt(entity.targetID, 0) || null)
  );
}

function persistAndNotifyDroneState(droneEntity, beforeState = null, sessions = null) {
  persistDroneEntityState(droneEntity);
  if (!beforeState || didDroneClientStateChange(beforeState, droneEntity)) {
    emitDroneStateChange(droneEntity, {}, sessions);
  }
}

function buildDronePseudoModuleItem(droneEntity) {
  return {
    itemID: toInt(droneEntity && droneEntity.itemID, 0),
    typeID: toInt(droneEntity && droneEntity.typeID, 0),
    groupID: toInt(droneEntity && droneEntity.groupID, 0),
    flagID: 0,
    locationID: toInt(droneEntity && droneEntity.itemID, 0),
    singleton: 1,
    quantity: 1,
    stacksize: 1,
    itemName: String(droneEntity && droneEntity.itemName || "Drone"),
    moduleState: {
      isOnline: true,
      isActive: true,
    },
  };
}

function resolveDroneControllerSession(droneEntity, controllerEntity = null) {
  if (
    controllerEntity &&
    controllerEntity.session &&
    typeof controllerEntity.session.sendNotification === "function"
  ) {
    return controllerEntity.session;
  }

  const controllerCharacterID = resolveDroneControllerOwnerCharacterID(
    controllerEntity,
    droneEntity,
  );
  if (controllerCharacterID <= 0) {
    return null;
  }
  return findSessionByCharacterID(controllerCharacterID) || null;
}

function buildDroneCombatSourceEntity(droneEntity, controllerEntity = null) {
  if (!droneEntity) {
    return null;
  }

  const controllerSession = resolveDroneControllerSession(
    droneEntity,
    controllerEntity,
  );
  const controllerCharacterID = resolveDroneControllerOwnerCharacterID(
    controllerEntity,
    droneEntity,
  );
  return {
    ...droneEntity,
    session: controllerSession,
    characterID: controllerCharacterID || toInt(droneEntity.characterID, 0) || null,
    pilotCharacterID:
      controllerCharacterID || toInt(droneEntity.pilotCharacterID, 0) || null,
  };
}

function getEntitySurfaceDistance(left, right) {
  return Math.max(
    0,
    distance(left && left.position, right && right.position) -
      Math.max(0, toNumber(left && left.radius, 0)) -
      Math.max(0, toNumber(right && right.radius, 0)),
  );
}

function syncDroneOrbitBehavior(scene, droneEntity, targetEntity, orbitDistanceMeters) {
  if (!scene || !droneEntity || !targetEntity) {
    return false;
  }
  return scene.orbitShipEntity(
    droneEntity,
    targetEntity.itemID,
    Math.max(0, toNumber(orbitDistanceMeters, 0)),
    {
      broadcast: true,
    },
  );
}

function syncDronePursuitBehavior(scene, droneEntity, targetEntity, followRangeMeters) {
  if (!scene || !droneEntity || !targetEntity) {
    return false;
  }
  return scene.followShipEntity(
    droneEntity,
    targetEntity.itemID,
    Math.max(0, toNumber(followRangeMeters, 0)),
    {
      broadcast: true,
    },
  );
}

function persistDroneEntityState(entity) {
  if (!isDroneEntity(entity)) {
    return false;
  }
  const result = updateInventoryItem(entity.itemID, (currentItem) => ({
    ...currentItem,
    locationID: toInt(entity.systemID, toInt(currentItem.locationID, 0)),
    flagID: 0,
    singleton: 1,
    quantity: null,
    stacksize: 1,
    launcherID: toInt(entity.launcherID ?? entity.controllerID, 0) || null,
    spaceState: serializeDroneSpaceState(entity),
  }));
  return result.success;
}

function getDroneBandwidthLoad(typeID) {
  return Math.max(
    0,
    toNumber(
      getTypeAttributeValue(typeID, "droneBandwidthLoad", "droneBandwidth"),
      0,
    ),
  );
}

function resolveDroneOrbitDistance(entity) {
  const authoredOrbitDistance = toNumber(
    getTypeAttributeValue(entity && entity.typeID, "orbitRange"),
    0,
  );
  if (authoredOrbitDistance > 0) {
    return clamp(
      authoredOrbitDistance,
      MIN_ORBIT_DISTANCE_METERS,
      MAX_ORBIT_DISTANCE_METERS,
    );
  }
  return MIN_ORBIT_DISTANCE_METERS;
}

function buildDroneLaunchSpaceState(shipEntity, launchIndex = 0) {
  const shipDirection = normalizeVector(shipEntity && shipEntity.direction, { x: 1, y: 0, z: 0 });
  const lateralDirection = buildPerpendicular(shipDirection);
  const launchDistance =
    Math.max(
      toNumber(shipEntity && shipEntity.radius, 0),
      ONE_METER,
    ) +
    DEFAULT_DRONE_LAUNCH_OFFSET_METERS;
  const lateralOffset = (launchIndex % 5) * 30;
  const signedSide = launchIndex % 2 === 0 ? 1 : -1;
  const position = addVectors(
    addVectors(
      cloneVector(shipEntity && shipEntity.position),
      scaleVector(shipDirection, launchDistance),
    ),
    scaleVector(lateralDirection, lateralOffset * signedSide),
  );
  return {
    systemID: toInt(shipEntity && shipEntity.systemID, 0),
    position,
    velocity: { x: 0, y: 0, z: 0 },
    direction: shipDirection,
    targetPoint: cloneVector(position),
    speedFraction: 0,
    mode: "STOP",
    targetEntityID: null,
    followRange: 0,
    orbitDistance: 0,
    orbitNormal: buildPerpendicular(shipDirection),
    orbitSign: 1,
    pendingWarp: null,
    warpState: null,
  };
}

function hydrateDroneEntityFromItem(entity, itemRecord = null) {
  if (!isDroneEntity(entity)) {
    return entity;
  }

  const item = itemRecord || findItemById(entity.itemID) || null;
  const typeID = toInt(item && item.typeID, toInt(entity.typeID, 0));
  const mass = Math.max(1, toNumber(getTypeAttributeValue(typeID, "mass"), entity.mass || 1));
  const inertia = Math.max(
    0.05,
    toNumber(getTypeAttributeValue(typeID, "agility"), entity.inertia || 0.1),
  );
  const maxVelocity = Math.max(
    1,
    toNumber(getTypeAttributeValue(typeID, "maxVelocity"), entity.maxVelocity || 1),
  );

  entity.kind = "drone";
  entity.typeID = typeID;
  entity.groupID = toInt(item && item.groupID, toInt(entity.groupID, 0));
  entity.categoryID = DRONE_CATEGORY_ID;
  entity.ownerID = toInt(item && item.ownerID, toInt(entity.ownerID, 0));
  entity.itemName = String(item && item.itemName || entity.itemName || "Drone");
  entity.mass = mass;
  entity.inertia = inertia;
  entity.maxVelocity = maxVelocity;
  entity.alignTime = inertia * Math.log(4);
  entity.maxAccelerationTime = inertia;
  entity.agilitySeconds = Math.max((mass * inertia) / 1000000, 0.05);
  entity.launcherID = toInt(item && item.launcherID, toInt(entity.launcherID, 0)) || null;
  entity.controllerID = toInt(entity.controllerID, entity.launcherID || 0) || null;
  entity.controllerOwnerID = toInt(entity.controllerOwnerID, entity.ownerID);
  entity.activityState = toInt(entity.activityState, STATE_IDLE);
  entity.targetID = toInt(entity.targetID, 0) || null;
  entity.droneStateVisible = entity.controllerID > 0;
  entity.persistSpaceState = true;
  if (!(entity.lockedTargets instanceof Map)) {
    entity.lockedTargets = new Map();
  }
  if (!(entity.pendingTargetLocks instanceof Map)) {
    entity.pendingTargetLocks = new Map();
  }
  if (!(entity.targetedBy instanceof Set)) {
    entity.targetedBy = new Set();
  }
  if (!(entity.activeModuleEffects instanceof Map)) {
    entity.activeModuleEffects = new Map();
  }
  if (!(entity.moduleReactivationLocks instanceof Map)) {
    entity.moduleReactivationLocks = new Map();
  }
  if (!entity.mode) {
    entity.mode = "STOP";
  }
  if (!entity.direction) {
    entity.direction = { x: 1, y: 0, z: 0 };
  }
  if (!entity.position) {
    entity.position = { x: 0, y: 0, z: 0 };
  }
  if (!entity.velocity) {
    entity.velocity = { x: 0, y: 0, z: 0 };
  }
  if (!entity.targetPoint) {
    entity.targetPoint = cloneVector(entity.position);
  }
  return entity;
}

function buildDroneStateRows(entities = []) {
  return entities
    .filter(isDroneEntity)
    .filter((entity) => toInt(entity.controllerID, 0) > 0)
    .map((entity) => [
      toInt(entity.itemID, 0),
      toInt(entity.ownerID, 0),
      toInt(entity.controllerID, 0),
      toInt(entity.activityState, STATE_IDLE),
      toInt(entity.typeID, 0),
      toInt(entity.controllerOwnerID, 0),
      toInt(entity.targetID, 0) || null,
    ]);
}

function getShipStateForSession(session) {
  const characterID = toInt(session && (session.characterID || session.charid), 0);
  if (characterID <= 0) {
    return null;
  }

  const shipRecord = resolveActiveShipRecord(characterID);
  const runtime = getRuntime();
  const scene =
    shipRecord && session && session._space
      ? runtime.ensureScene(toInt(session._space.systemID, 0))
      : null;
  const shipEntity = scene && shipRecord
    ? scene.getEntityByID(shipRecord.itemID)
    : null;

  if (!shipRecord || !scene || !shipEntity) {
    return null;
  }

  return {
    characterID,
    shipRecord,
    shipEntity,
    scene,
  };
}

function getSceneDroneEntities(scene) {
  if (!scene || !(scene.dynamicEntities instanceof Map) || scene.dynamicEntities.size === 0) {
    return [];
  }

  if (scene.droneEntityIDs instanceof Set && scene.droneEntityIDs.size > 0) {
    return [...scene.droneEntityIDs]
      .map((entityID) => scene.dynamicEntities.get(entityID) || null)
      .filter(Boolean);
  }

  return [...scene.dynamicEntities.values()].filter(isDroneEntity);
}

function listControlledDroneEntities(scene, shipID) {
  const numericShipID = toInt(shipID, 0);
  return getSceneDroneEntities(scene)
    .filter((entity) => toInt(entity.controllerID, 0) === numericShipID);
}

function getSceneControlledCombatDroneIndex(scene) {
  if (!scene) {
    return new Map();
  }

  const expectedCount =
    scene.droneEntityIDs instanceof Set
      ? scene.droneEntityIDs.size
      : 0;
  if (
    scene.droneControlledCombatIndex instanceof Map &&
    scene.droneControlledCombatIndexDirty !== true &&
    toInt(scene.droneControlledCombatIndexCount, -1) === expectedCount
  ) {
    return scene.droneControlledCombatIndex;
  }

  const byControllerID = new Map();
  const controllerCache = new Map();
  for (const droneEntity of getSceneDroneEntities(scene)) {
    const controllerID = toInt(droneEntity && droneEntity.controllerID, 0);
    if (controllerID <= 0) {
      continue;
    }

    const controllerEntity = controllerCache.has(controllerID)
      ? controllerCache.get(controllerID)
      : scene.getEntityByID(controllerID) || null;
    controllerCache.set(controllerID, controllerEntity);
    if (!isDroneCombatCapable(droneEntity, controllerEntity)) {
      continue;
    }

    let entry = byControllerID.get(controllerID);
    if (!entry) {
      entry = {
        combatDroneIDs: [],
        idleCombatDroneIDs: [],
      };
      byControllerID.set(controllerID, entry);
    }
    entry.combatDroneIDs.push(droneEntity.itemID);
    if (!droneEntity.droneCommand) {
      entry.idleCombatDroneIDs.push(droneEntity.itemID);
    }
  }

  scene.droneControlledCombatIndex = byControllerID;
  scene.droneControlledCombatIndexDirty = false;
  scene.droneControlledCombatIndexCount = expectedCount;
  return byControllerID;
}

function selectAggressiveTargetIDs(scene, controllerEntity, preferredTargetID, options = {}) {
  const controllerID = toInt(controllerEntity && controllerEntity.itemID, 0);
  const primaryTargetID = toInt(preferredTargetID, 0);
  const now = toNumber(options.nowMs, Date.now());
  const focusFire = options.focusFire === true;
  const desiredCount = Math.max(0, toInt(options.desiredCount, 0));
  if (!scene || controllerID <= 0 || primaryTargetID <= 0 || desiredCount <= 0) {
    return [];
  }

  const threatsByController = getSceneDroneAggressionThreats(scene);
  const controllerThreats = threatsByController.get(controllerID) || new Map();
  controllerThreats.set(primaryTargetID, now);
  threatsByController.set(controllerID, controllerThreats);
  pruneSceneDroneAggressionThreats(scene, now);

  const recentTargets = [...controllerThreats.entries()]
    .filter(([targetID, lastAggressedAtMs]) => (
      toNumber(lastAggressedAtMs, 0) >= now - DRONE_AGGRESSION_THREAT_RETENTION_MS &&
      Boolean(scene.getEntityByID(toInt(targetID, 0)))
    ))
    .sort((left, right) => (
      toNumber(right[1], 0) - toNumber(left[1], 0) ||
      toInt(left[0], 0) - toInt(right[0], 0)
    ))
    .map(([targetID]) => toInt(targetID, 0))
    .filter((targetID) => targetID > 0);
  if (recentTargets.length <= 0) {
    return [];
  }
  if (focusFire) {
    return Array.from({ length: desiredCount }, () => recentTargets[0]);
  }
  return recentTargets.slice(0, Math.min(desiredCount, recentTargets.length));
}

function assignDroneCombatTask(scene, droneEntity, controllerEntity, targetEntity, options = {}) {
  if (
    !scene ||
    !isDroneEntity(droneEntity) ||
    !controllerEntity ||
    !targetEntity ||
    !hasDamageableHealth(targetEntity)
  ) {
    return {
      success: false,
      errorMsg: "DRONE_INVALID_COMBAT_ASSIGNMENT",
    };
  }

  const snapshot = resolveDroneCombatSnapshot(droneEntity, controllerEntity);
  if (!snapshot) {
    return {
      success: false,
      errorMsg: "DRONE_NO_COMBAT_PROFILE",
    };
  }

  const now = Math.max(
    0,
    toNumber(
      options.nowMs,
      scene && typeof scene.getCurrentSimTimeMs === "function"
        ? scene.getCurrentSimTimeMs()
        : Date.now(),
    ),
  );
  const beforeState = captureDroneClientState(droneEntity);
  const controllerCharacterID = resolveDroneControllerOwnerCharacterID(
    controllerEntity,
    droneEntity,
  );
  copyControllerIdentity(droneEntity, controllerEntity, controllerCharacterID);
  droneEntity.launcherID = toInt(controllerEntity.itemID, 0);
  droneEntity.controllerID = toInt(controllerEntity.itemID, 0);
  droneEntity.droneCommand = DRONE_COMMAND_ENGAGE;
  droneEntity.droneCombat = {
    targetID: toInt(targetEntity.itemID, 0),
    nextCycleAtMs: now,
    snapshot,
    autoAssigned: options.autoAssigned === true,
  };
  droneEntity.droneMining = null;
  droneEntity.targetID = toInt(targetEntity.itemID, 0);

  const distanceToTarget = getEntitySurfaceDistance(droneEntity, targetEntity);
  const orbitDistance = Math.max(
    MIN_ORBIT_DISTANCE_METERS,
    toNumber(snapshot.orbitDistanceMeters, MIN_ORBIT_DISTANCE_METERS),
  );
  const attackRange = Math.max(orbitDistance, toNumber(snapshot.attackRangeMeters, 0));
  if (distanceToTarget > attackRange + 1) {
    syncDronePursuitBehavior(scene, droneEntity, targetEntity, orbitDistance);
    droneEntity.activityState = STATE_APPROACHING;
  } else {
    syncDroneOrbitBehavior(scene, droneEntity, targetEntity, orbitDistance);
    droneEntity.activityState = STATE_COMBAT;
  }

  persistAndNotifyDroneState(droneEntity, beforeState);
  if (options.emitActivity !== false) {
    emitDroneActivityChange(droneEntity, null, null);
  }
  markSceneControlledCombatDroneIndexDirty(scene);
  return {
    success: true,
    data: {
      snapshot,
    },
  };
}

function extractLaunchedDroneItem(moveResult, systemID) {
  const changes = moveResult && moveResult.data && Array.isArray(moveResult.data.changes)
    ? moveResult.data.changes
    : [];
  return changes
    .map((change) => change && change.item)
    .find((item) =>
      item &&
      toInt(item.locationID, 0) === toInt(systemID, 0) &&
      toInt(item.flagID, 0) === 0,
    ) || null;
}

function recallDroneToBay(scene, shipRecord, droneEntity) {
  const shipID = toInt(shipRecord && shipRecord.itemID, 0);
  const shipOwnerID = toInt(shipRecord && shipRecord.ownerID, 0);
  const ownerSession = findSessionByCharacterID(toInt(shipRecord && shipRecord.ownerID, 0));
  emitDroneStateChange(droneEntity, {
    ownerID: 0,
    controllerID: 0,
    activityState: STATE_IDLE,
    controllerOwnerID: 0,
    targetID: 0,
  });
  emitDroneActivityChange(droneEntity, null, null);

  const removeResult = scene.removeDynamicEntity(droneEntity.itemID, {
    broadcast: true,
  });
  if (!removeResult || removeResult.success !== true) {
    return removeResult || {
      success: false,
      errorMsg: "DRONE_REMOVE_FAILED",
    };
  }

  const mergeTarget = listContainerItems(
    toInt(shipRecord && shipRecord.ownerID, 0),
    shipID,
    ITEM_FLAGS.DRONE_BAY,
  ).find((item) =>
    toInt(item.itemID, 0) !== toInt(droneEntity.itemID, 0) &&
    toInt(item.typeID, 0) === toInt(droneEntity.typeID, 0) &&
    toInt(item.ownerID, 0) === toInt(shipRecord && shipRecord.ownerID, 0),
  );

  const changes = [];
  if (mergeTarget) {
    const mergeTargetUpdateResult = updateInventoryItem(
      mergeTarget.itemID,
      (currentItem) => {
        const currentQuantity = Math.max(
          0,
          toInt(currentItem && (currentItem.stacksize ?? currentItem.quantity), 0),
        );
        return {
          ...currentItem,
          ownerID: shipOwnerID || toInt(currentItem && currentItem.ownerID, 0),
          locationID: shipID,
          flagID: ITEM_FLAGS.DRONE_BAY,
          customInfo: currentItem && currentItem.customInfo ? currentItem.customInfo : "",
          singleton: 0,
          quantity: currentQuantity + 1,
          stacksize: currentQuantity + 1,
        };
      },
    );
    if (!mergeTargetUpdateResult.success) {
      return mergeTargetUpdateResult;
    }

    const removalResult = removeInventoryItem(droneEntity.itemID, {
      removeContents: true,
    });
    if (!removalResult.success) {
      return removalResult;
    }

    changes.push({
      item: mergeTargetUpdateResult.data,
      previousData: mergeTargetUpdateResult.previousData || {},
    });
  } else {
    const bayUpdateResult = updateInventoryItem(droneEntity.itemID, (currentItem) => ({
      ...currentItem,
      ownerID: shipOwnerID || toInt(currentItem && currentItem.ownerID, 0),
      locationID: shipID,
      flagID: ITEM_FLAGS.DRONE_BAY,
      customInfo: currentItem && currentItem.customInfo ? currentItem.customInfo : "",
      singleton: 0,
      quantity: 1,
      stacksize: 1,
      launcherID: null,
      spaceState: null,
    }));
    if (!bayUpdateResult.success) {
      return bayUpdateResult;
    }

    changes.push({
      item: bayUpdateResult.data,
      previousData: bayUpdateResult.previousData || {},
    });
  }

  emitRelevantInventoryChanges(ownerSession, shipID, changes);
  markSceneControlledCombatDroneIndexDirty(scene);
  return {
    success: true,
    data: {
      droneID: toInt(droneEntity.itemID, 0),
      shipID,
      changes,
    },
  };
}

function launchDronesForSession(session, rawLaunchRequests) {
  const shipState = getShipStateForSession(session);
  const requests = normalizeLaunchRequests(rawLaunchRequests);
  const response = buildMarshalDict();
  if (!shipState) {
    return {
      success: false,
      errorMsg: "Unable to launch drones without an active in-space ship.",
      response,
    };
  }

  const { characterID, shipRecord, shipEntity, scene } = shipState;
  const ownerSession = findSessionByCharacterID(toInt(shipRecord && shipRecord.ownerID, 0));
  const launchIdentitySessions = normalizeDroneSessions([session, ownerSession]);
  const fittingSnapshot = getShipFittingSnapshot(characterID, shipRecord.itemID, {
    shipItem: shipRecord,
    reason: "drone.launch",
  });
  const shipAttributes = fittingSnapshot && fittingSnapshot.shipAttributes
    ? fittingSnapshot.shipAttributes
    : {};
  const maxActiveDrones = Math.max(0, toInt(shipAttributes.maxActiveDrones, 5));
  const droneBandwidth = Math.max(0, toNumber(shipAttributes.droneBandwidth, 0));
  let activeDroneEntities = listControlledDroneEntities(scene, shipRecord.itemID);
  let activeDroneCount = activeDroneEntities.length;
  let usedBandwidth = activeDroneEntities.reduce(
    (sum, entity) => sum + getDroneBandwidthLoad(entity.typeID),
    0,
  );
  let launchIndex = 0;

  for (const request of requests) {
    ensureLaunchResponseEntry(response, request.itemID);
    const sourceItem = findItemById(request.itemID);
    if (
      !sourceItem ||
      !isDroneItemRecord(sourceItem) ||
      toInt(sourceItem.locationID, 0) !== toInt(shipRecord.itemID, 0) ||
      toInt(sourceItem.flagID, 0) !== ITEM_FLAGS.DRONE_BAY
    ) {
      appendLaunchError(response, request.itemID, "That drone is not available in the active ship drone bay.");
      continue;
    }

    for (let count = 0; count < request.quantity; count += 1) {
      const refreshedSource = findItemById(request.itemID);
      if (!refreshedSource || !isDroneItemRecord(refreshedSource)) {
        appendLaunchError(response, request.itemID, "The requested drone stack is no longer available.");
        break;
      }
      if (maxActiveDrones <= 0 || activeDroneCount >= maxActiveDrones) {
        appendLaunchError(response, request.itemID, "Maximum active drones already in space.");
        break;
      }

      const launchBandwidth = getDroneBandwidthLoad(refreshedSource.typeID);
      if ((launchBandwidth > 0 && droneBandwidth <= 0) || usedBandwidth + launchBandwidth > droneBandwidth) {
        appendLaunchError(response, request.itemID, "Not enough drone bandwidth to launch that drone.");
        break;
      }

      const moveResult = moveItemToLocation(
        refreshedSource.itemID,
        scene.systemID,
        0,
        1,
      );
      if (!moveResult.success) {
        appendLaunchError(response, request.itemID, "Unable to launch that drone.");
        break;
      }

      const launchedItem = extractLaunchedDroneItem(moveResult, scene.systemID);
      if (!launchedItem) {
        appendLaunchError(response, request.itemID, "Drone launch created no in-space item.");
        break;
      }

      const inventoryChanges = Array.isArray(moveResult.data && moveResult.data.changes)
        ? moveResult.data.changes.filter(
            (change) =>
              toInt(change && change.item && change.item.itemID, 0) !==
              toInt(launchedItem.itemID, 0),
          )
        : [];
      emitRelevantInventoryChanges(
        session,
        shipRecord.itemID,
        inventoryChanges,
      );

      const spaceState = buildDroneLaunchSpaceState(shipEntity, launchIndex);
      const updateResult = updateInventoryItem(launchedItem.itemID, (currentItem) => ({
        ...currentItem,
        singleton: 1,
        quantity: null,
        stacksize: 1,
        launcherID: shipRecord.itemID,
        spaceState,
      }));
      if (!updateResult.success) {
        appendLaunchError(response, request.itemID, "Unable to finalize drone launch.");
        break;
      }

      primeDroneBayDogmaForLaunch(
        updateResult.data,
        shipRecord,
        launchIdentitySessions,
      );

      const spawnResult = getRuntime().spawnDynamicInventoryEntity(scene.systemID, launchedItem.itemID, {
        broadcast: true,
        excludedSession: null,
      });
      if (!spawnResult.success || !spawnResult.data || !spawnResult.data.entity) {
        appendLaunchError(response, request.itemID, "Unable to materialize drone in space.");
        break;
      }

      const droneEntity = hydrateDroneEntityFromItem(spawnResult.data.entity, updateResult.data);
      droneEntity.launcherID = shipRecord.itemID;
      droneEntity.controllerID = shipRecord.itemID;
      copyControllerIdentity(droneEntity, shipEntity, characterID);
      droneEntity.activityState = STATE_IDLE;
      droneEntity.targetID = null;
      clearDroneTaskState(droneEntity);
      droneEntity.droneHomeOrbitDistance = resolveDroneOrbitDistance(droneEntity);
      syncDroneOrbitBehavior(
        scene,
        droneEntity,
        shipEntity,
        droneEntity.droneHomeOrbitDistance,
      );
      droneEntity.droneStateVisible = true;
      persistDroneEntityState(droneEntity);
      const splitCreatedLaunch =
        toInt(droneEntity.itemID, 0) !== toInt(refreshedSource.itemID, 0);
      // Keep the first launch-side identity row on the finalized singleton
      // drone state instead of the transient split-stack row. That gives the
      // client a real inv/dogma item before OnDroneStateChange2 runs.
      ensureDroneClientIdentityState(
        droneEntity,
        shipRecord,
        launchIdentitySessions,
        {
          forceInsert: splitCreatedLaunch,
          skipDogmaPrime: true,
        },
      );
      emitDroneStateChange(droneEntity);
      emitDroneActivityChange(droneEntity, null, null);
      markSceneControlledCombatDroneIndexDirty(scene);
      appendLaunchEntry(response, request.itemID, toInt(droneEntity.itemID, 0));
      activeDroneEntities.push(droneEntity);
      activeDroneCount += 1;
      usedBandwidth += launchBandwidth;
      launchIndex += 1;
    }
  }

  return {
    success: true,
    response,
  };
}

function commandReturnDrones(session, rawDroneIDs, commandName) {
  const shipState = getShipStateForSession(session);
  const droneIDs = normalizeDroneIDList(rawDroneIDs);
  const response = buildMultiDroneResult(droneIDs);
  if (!shipState) {
    return response;
  }

  const { shipRecord, scene } = shipState;
  const ownerSession = findSessionByCharacterID(toInt(shipRecord && shipRecord.ownerID, 0));
  const interestedSessions = normalizeDroneSessions([session, ownerSession]);
  for (const droneID of droneIDs) {
    const droneEntity = scene.getEntityByID(droneID);
    if (!isDroneEntity(droneEntity) || toInt(droneEntity.controllerID, 0) !== toInt(shipRecord.itemID, 0)) {
      appendDroneError(response, droneID, "That drone is not currently under this ship's control.");
      continue;
    }

    const followDistance =
      commandName === DRONE_COMMAND_RETURN_BAY
        ? DRONE_BAY_RETURN_APPROACH_DISTANCE_METERS
        : resolveDroneOrbitDistance(droneEntity);
    scene.followShipEntity(droneEntity, shipRecord.itemID, followDistance, {
      broadcast: true,
    });
    droneEntity.launcherID = shipRecord.itemID;
    droneEntity.controllerID = shipRecord.itemID;
    droneEntity.controllerOwnerID = toInt(shipRecord.ownerID, 0);
    droneEntity.targetID = shipRecord.itemID;
    droneEntity.activityState = STATE_DEPARTING;
    droneEntity.droneCommand = commandName;
    droneEntity.droneHomeOrbitDistance = resolveDroneOrbitDistance(droneEntity);
    droneEntity.droneCombat = null;
    stopDroneMiningCycleFx(scene, droneEntity);
    droneEntity.droneMining = null;
    droneEntity.activityID = null;
    droneEntity.activity = null;
    persistDroneEntityState(droneEntity);
    // CCP client parity: returning drones must already have a dogma item by
    // the time OnDroneStateChange2 hits the RETURNING state. The client checks
    // both invCache and dogma first; if either side is missing it falls back
    // to a short synthesized DBRow and logs "sequence is too short".
    ensureDroneClientIdentityState(
      droneEntity,
      shipRecord,
      interestedSessions,
      {
        forceRefresh: true,
        skipInventorySync: true,
      },
    );
    emitDroneStateChange(droneEntity, {}, interestedSessions);
    emitDroneActivityChange(droneEntity, null, null, interestedSessions);
    markSceneControlledCombatDroneIndexDirty(scene);
  }

  return response;
}

function commandReturnHome(session, rawDroneIDs) {
  return commandReturnDrones(session, rawDroneIDs, DRONE_COMMAND_RETURN_HOME);
}

function commandReturnBay(session, rawDroneIDs) {
  return commandReturnDrones(session, rawDroneIDs, DRONE_COMMAND_RETURN_BAY);
}

function commandEngage(session, rawDroneIDs, rawTargetID) {
  const shipState = getShipStateForSession(session);
  const droneIDs = normalizeDroneIDList(rawDroneIDs);
  const response = buildMultiDroneResult(droneIDs);
  if (!shipState) {
    return response;
  }

  const targetID = toInt(rawTargetID, 0);
  const { shipRecord, shipEntity, scene } = shipState;
  const targetEntity = scene.getEntityByID(targetID);
  if (!targetEntity || !hasDamageableHealth(targetEntity)) {
    for (const droneID of droneIDs) {
      appendDroneError(response, droneID, "That target cannot be engaged by drones.");
    }
    return response;
  }

  for (const droneID of droneIDs) {
    const droneEntity = scene.getEntityByID(droneID);
    if (!isDroneEntity(droneEntity) || toInt(droneEntity.controllerID, 0) !== toInt(shipRecord.itemID, 0)) {
      appendDroneError(response, droneID, "That drone is not currently under this ship's control.");
      continue;
    }

    stopDroneMiningCycleFx(scene, droneEntity);
    const assignResult = assignDroneCombatTask(
      scene,
      droneEntity,
      shipEntity,
      targetEntity,
      {
        nowMs: scene.getCurrentSimTimeMs && scene.getCurrentSimTimeMs(),
        emitActivity: true,
      },
    );
    if (!assignResult || assignResult.success !== true) {
      appendDroneError(response, droneID, "That drone has no supported combat attack profile.");
      continue;
    }
  }

  return response;
}

function commandMineRepeatedly(session, rawDroneIDs, rawTargetID) {
  const shipState = getShipStateForSession(session);
  const droneIDs = normalizeDroneIDList(rawDroneIDs);
  const response = buildMultiDroneResult(droneIDs);
  if (!shipState) {
    return response;
  }

  const targetID = toInt(rawTargetID, 0);
  const { characterID, shipRecord, shipEntity, scene } = shipState;
  ensureSceneMiningState(scene);
  const targetEntity = scene.getEntityByID(targetID);
  const mineableState = getMineableState(scene, targetID);
  const targetIsMineable = Boolean(
    targetEntity &&
      mineableState &&
      toInt(mineableState.remainingQuantity, 0) > 0,
  );
  const targetIsSalvageable = Boolean(
    targetEntity &&
      salvagerRuntime.isSalvageableTarget(targetEntity),
  );
  if (
    !targetIsMineable &&
    !targetIsSalvageable
  ) {
    for (const droneID of droneIDs) {
      appendDroneError(response, droneID, "That target cannot be mined or salvaged by drones.");
    }
    return response;
  }

  for (const droneID of droneIDs) {
    const droneEntity = scene.getEntityByID(droneID);
    if (!isDroneEntity(droneEntity) || toInt(droneEntity.controllerID, 0) !== toInt(shipRecord.itemID, 0)) {
      appendDroneError(response, droneID, "That drone is not currently under this ship's control.");
      continue;
    }

    if (targetIsMineable) {
      const snapshot = resolveDroneMiningSnapshot(droneEntity, shipEntity);
      if (!snapshot) {
        appendDroneError(response, droneID, "That drone has no supported mining profile.");
        continue;
      }
      if (!isDroneMiningCompatibleWithTarget(droneEntity, mineableState)) {
        appendDroneError(response, droneID, "That drone cannot mine the selected resource.");
        continue;
      }

      const beforeState = captureDroneClientState(droneEntity);
      const nowMs = Math.max(
        toNumber(scene.getCurrentSimTimeMs && scene.getCurrentSimTimeMs(), Date.now()),
        Date.now(),
      );
      stopDroneMiningCycleFx(scene, droneEntity);
      copyControllerIdentity(droneEntity, shipEntity, characterID);
      droneEntity.launcherID = shipRecord.itemID;
      droneEntity.controllerID = shipRecord.itemID;
      droneEntity.targetID = targetID;
      droneEntity.droneCommand = DRONE_COMMAND_MINE;
      droneEntity.droneMining = {
        targetID,
        cycleStartedAtMs: null,
        nextCycleAtMs: null,
        fxCycleKey: null,
        snapshot,
      };
      droneEntity.droneSalvage = null;
      droneEntity.droneCombat = null;

      const distanceToTarget = getEntitySurfaceDistance(droneEntity, targetEntity);
      const orbitDistance = Math.max(
        MIN_ORBIT_DISTANCE_METERS,
        toNumber(snapshot.orbitDistanceMeters, MIN_ORBIT_DISTANCE_METERS),
      );
      const maxRange = Math.max(
        orbitDistance,
        toNumber(snapshot.maxRangeMeters, orbitDistance),
      );
      if (distanceToTarget > maxRange + 1) {
        syncDronePursuitBehavior(scene, droneEntity, targetEntity, orbitDistance);
        droneEntity.activityState = STATE_APPROACHING;
      } else {
        syncDroneOrbitBehavior(scene, droneEntity, targetEntity, orbitDistance);
        droneEntity.activityState = STATE_MINING;
        beginDroneMiningCycle(droneEntity.droneMining, snapshot, nowMs);
      }

      persistAndNotifyDroneState(droneEntity, beforeState);
      if (droneEntity.activityState === STATE_MINING) {
        emitDroneMiningCycleFx(
          scene,
          droneEntity,
          targetEntity,
          snapshot,
          droneEntity.droneMining,
          nowMs,
        );
      }
    } else {
      const snapshot = resolveDroneSalvageSnapshot(droneEntity, shipEntity);
      if (!snapshot) {
        appendDroneError(response, droneID, "That drone has no supported salvaging profile.");
        continue;
      }

      const chanceSnapshot = salvagerRuntime.buildSalvageChanceSnapshot(
        targetEntity,
        snapshot.accessBonusPercent,
      );
      const beforeState = captureDroneClientState(droneEntity);
      stopDroneMiningCycleFx(scene, droneEntity);
      copyControllerIdentity(droneEntity, shipEntity, characterID);
      droneEntity.launcherID = shipRecord.itemID;
      droneEntity.controllerID = shipRecord.itemID;
      droneEntity.targetID = targetID;
      droneEntity.droneCommand = DRONE_COMMAND_SALVAGE;
      droneEntity.droneSalvage = {
        targetID,
        nextCycleAtMs:
          Math.max(
            toNumber(scene.getCurrentSimTimeMs && scene.getCurrentSimTimeMs(), Date.now()),
            Date.now(),
          ) + Math.max(1, toNumber(snapshot.durationMs, 1000)),
        snapshot,
        chanceSnapshot,
      };
      droneEntity.droneMining = null;
      droneEntity.droneCombat = null;

      const distanceToTarget = getEntitySurfaceDistance(droneEntity, targetEntity);
      const orbitDistance = Math.max(
        MIN_ORBIT_DISTANCE_METERS,
        toNumber(snapshot.orbitDistanceMeters, MIN_ORBIT_DISTANCE_METERS),
      );
      const maxRange = Math.max(
        orbitDistance,
        toNumber(snapshot.maxRangeMeters, orbitDistance),
      );
      if (distanceToTarget > maxRange + 1) {
        syncDronePursuitBehavior(scene, droneEntity, targetEntity, orbitDistance);
        droneEntity.activityState = STATE_APPROACHING;
      } else {
        syncDroneOrbitBehavior(scene, droneEntity, targetEntity, orbitDistance);
        droneEntity.activityState = STATE_SALVAGING;
      }

      persistAndNotifyDroneState(droneEntity, beforeState);
    }

    emitDroneActivityChange(droneEntity, null, null);
    markSceneControlledCombatDroneIndexDirty(scene);
  }

  return response;
}

function commandAbandonDrone(session, rawDroneIDs) {
  const shipState = getShipStateForSession(session);
  const droneIDs = normalizeDroneIDList(rawDroneIDs);
  const response = buildMultiDroneResult(droneIDs);
  if (!shipState) {
    return response;
  }

  const { scene, shipRecord } = shipState;
  for (const droneID of droneIDs) {
    const droneEntity = scene.getEntityByID(droneID);
    if (!isDroneEntity(droneEntity) || toInt(droneEntity.controllerID, 0) !== toInt(shipRecord.itemID, 0)) {
      appendDroneError(response, droneID, "That drone is not currently under this ship's control.");
      continue;
    }
    abandonDroneInSpace(scene, droneEntity, {
      stopMovement: true,
    });
  }

  return response;
}

function abandonDroneInSpace(scene, droneEntity, options = {}) {
  if (!scene || !isDroneEntity(droneEntity)) {
    return false;
  }

  if (options.stopMovement !== false && typeof scene.stopShipEntity === "function") {
    scene.stopShipEntity(droneEntity, {
      allowSessionOwned: true,
      broadcast: options.broadcastMovement !== false,
    });
  }

  droneEntity.launcherID = null;
  droneEntity.controllerID = null;
  droneEntity.controllerOwnerID = 0;
  droneEntity.targetID = null;
  droneEntity.activityState = STATE_IDLE;
  stopDroneMiningCycleFx(scene, droneEntity);
  clearDroneTaskState(droneEntity);
  droneEntity.droneStateVisible = false;
  droneEntity.activityID = null;
  droneEntity.activity = null;
  updateInventoryItem(droneEntity.itemID, (currentItem) => ({
    ...currentItem,
    launcherID: null,
    spaceState: serializeDroneSpaceState(droneEntity),
  }));
  emitDroneStateChange(droneEntity, {
    ownerID: 0,
    controllerID: 0,
    activityState: STATE_IDLE,
    controllerOwnerID: 0,
    targetID: 0,
  });
  emitDroneActivityChange(droneEntity, null, null);
  markSceneControlledCombatDroneIndexDirty(scene);
  return true;
}

function handleControllerLost(scene, controllerEntity, options = {}) {
  if (!scene || !controllerEntity) {
    return {
      success: false,
      releasedCount: 0,
      recoveredCount: 0,
    };
  }

  const controllerID = toInt(controllerEntity.itemID, 0);
  if (controllerID <= 0) {
    return {
      success: false,
      releasedCount: 0,
      recoveredCount: 0,
    };
  }

  const shipRecord =
    options.shipRecord ||
    findItemById(controllerID) ||
    null;
  const shouldAttemptBayRecovery =
    options.attemptBayRecovery === true ||
    ["disconnect", "logoff"].includes(String(options.lifecycleReason || "").trim().toLowerCase());
  let releasedCount = 0;
  let recoveredCount = 0;

  for (const droneEntity of listControlledDroneEntities(scene, controllerID)) {
    if (
      shouldAttemptBayRecovery &&
      shipRecord &&
      getEntitySurfaceDistance(droneEntity, controllerEntity) <= DRONE_BAY_SCOOP_DISTANCE_METERS
    ) {
      const recallResult = recallDroneToBay(scene, shipRecord, droneEntity);
      if (recallResult && recallResult.success === true) {
        releasedCount += 1;
        recoveredCount += 1;
        continue;
      }
    }

    if (abandonDroneInSpace(scene, droneEntity, options)) {
      releasedCount += 1;
    }
  }

  return {
    success: true,
    releasedCount,
    recoveredCount,
  };
}

function commandReconnectToDrones(session, rawDroneIDs) {
  const shipState = getShipStateForSession(session);
  if (!shipState) {
    return buildMarshalDict();
  }

  const { characterID, shipRecord, scene } = shipState;
  const droneIDs = normalizeDroneIDList(rawDroneIDs);
  const fittingSnapshot = getShipFittingSnapshot(characterID, shipRecord.itemID, {
    shipItem: shipRecord,
    reason: "drone.reconnect",
  });
  const shipAttributes = fittingSnapshot && fittingSnapshot.shipAttributes
    ? fittingSnapshot.shipAttributes
    : {};
  const maxActiveDrones = Math.max(0, toInt(shipAttributes.maxActiveDrones, 5));
  const droneBandwidth = Math.max(0, toNumber(shipAttributes.droneBandwidth, 0));
  const controlledDroneEntities = listControlledDroneEntities(scene, shipRecord.itemID);
  let activeDroneCount = controlledDroneEntities.length;
  let usedBandwidth = controlledDroneEntities.reduce(
    (sum, entity) => sum + getDroneBandwidthLoad(entity.typeID),
    0,
  );

  for (const droneID of droneIDs) {
    const droneEntity = scene.getEntityByID(droneID);
    if (!isDroneEntity(droneEntity)) {
      continue;
    }
    if (toInt(droneEntity.ownerID, 0) !== characterID || toInt(droneEntity.controllerID, 0) > 0) {
      continue;
    }
    if (maxActiveDrones <= 0 || activeDroneCount >= maxActiveDrones) {
      return buildNotifyErrorResult("Maximum active drones already in space.");
    }
    const droneBandwidthLoad = getDroneBandwidthLoad(droneEntity.typeID);
    if (
      (droneBandwidthLoad > 0 && droneBandwidth <= 0) ||
      usedBandwidth + droneBandwidthLoad > droneBandwidth
    ) {
      return buildNotifyErrorResult(
        "Not enough drone bandwidth to reconnect to those drones.",
      );
    }

    droneEntity.controllerID = shipRecord.itemID;
    copyControllerIdentity(droneEntity, scene.getEntityByID(shipRecord.itemID), characterID);
    droneEntity.activityState = STATE_IDLE;
    droneEntity.targetID = null;
    clearDroneTaskState(droneEntity);
    droneEntity.droneStateVisible = true;
    droneEntity.launcherID = shipRecord.itemID;
    persistDroneEntityState(droneEntity);
    emitDroneStateChange(droneEntity);
    emitDroneActivityChange(droneEntity, null, null);
    markSceneControlledCombatDroneIndexDirty(scene);
    activeDroneCount += 1;
    usedBandwidth += droneBandwidthLoad;
  }

  return buildMarshalDict();
}

function scoopDrone(session, rawDroneIDs) {
  const shipState = getShipStateForSession(session);
  const droneIDs = normalizeDroneIDList(rawDroneIDs);
  const response = buildMultiDroneResult(droneIDs);
  if (!shipState) {
    return response;
  }

  const { characterID, shipRecord, shipEntity, scene } = shipState;
  for (const droneID of droneIDs) {
    const droneEntity = scene.getEntityByID(droneID);
    if (!isDroneEntity(droneEntity)) {
      appendDroneError(response, droneID, "That drone is not in local space.");
      continue;
    }
    if (toInt(droneEntity.controllerID, 0) > 0) {
      appendDroneError(response, droneID, "That drone cannot currently be scooped into the drone bay.");
      continue;
    }
    if (getEntitySurfaceDistance(droneEntity, shipEntity) > DRONE_BAY_SCOOP_DISTANCE_METERS) {
      appendDroneError(response, droneID, "Drone is too far away to scoop into the bay.");
      continue;
    }

    const recallResult = recallDroneToBay(scene, shipRecord, droneEntity);
    if (!recallResult || recallResult.success !== true) {
      appendDroneError(response, droneID, "Unable to scoop that drone.");
    }
  }

  return response;
}

function resetDroneToIdle(droneEntity, controllerEntity = null, options = {}) {
  if (!droneEntity) {
    return false;
  }

  const beforeState = captureDroneClientState(droneEntity);
  const keepController = options.keepController !== false;
  if (!keepController) {
    droneEntity.controllerID = null;
    droneEntity.controllerOwnerID = 0;
  } else if (controllerEntity) {
    droneEntity.controllerID = toInt(controllerEntity.itemID, 0) || droneEntity.controllerID;
    copyControllerIdentity(
      droneEntity,
      controllerEntity,
      toInt(
        controllerEntity &&
          (
            controllerEntity.session && controllerEntity.session.characterID
          ) ||
          controllerEntity &&
          (
            controllerEntity.pilotCharacterID ??
            controllerEntity.characterID ??
            droneEntity.controllerOwnerID
          ),
        0,
      ),
    );
  }
  stopDroneMiningCycleFx(options.scene || null, droneEntity);
  clearDroneTaskState(droneEntity);
  droneEntity.activityState = STATE_IDLE;
  droneEntity.targetID = null;
  if (options.stopMovement === true && controllerEntity) {
    const orbitDistance = Math.max(
      MIN_ORBIT_DISTANCE_METERS,
      resolveDroneOrbitDistance(droneEntity),
    );
    syncDroneOrbitBehavior(
      options.scene,
      droneEntity,
      controllerEntity,
      orbitDistance,
    );
  }
  persistAndNotifyDroneState(droneEntity, beforeState, options.sessions || null);
  emitDroneActivityChange(droneEntity, null, null, options.sessions || null);
  markSceneControlledCombatDroneIndexDirty(options.scene || null);
  return true;
}

function idleMiningDronesTargeting(scene, rawTargetID, options = {}) {
  if (!scene) {
    return 0;
  }

  const targetID = toInt(rawTargetID, 0);
  const excludeDroneID = toInt(options.excludeDroneID, 0);
  if (targetID <= 0) {
    return 0;
  }

  let idledCount = 0;
  for (const droneEntity of getSceneDroneEntities(scene)) {
    const droneID = toInt(droneEntity && droneEntity.itemID, 0);
    if (droneID <= 0 || droneID === excludeDroneID) {
      continue;
    }

    const miningState =
      droneEntity &&
      droneEntity.droneMining &&
      typeof droneEntity.droneMining === "object"
        ? droneEntity.droneMining
        : null;
    const miningTargetID = toInt(
      miningState && miningState.targetID,
      toInt(droneEntity && droneEntity.targetID, 0),
    );
    if (miningTargetID !== targetID) {
      continue;
    }
    if (droneEntity.droneCommand !== DRONE_COMMAND_MINE && !miningState) {
      continue;
    }

    const controllerID = toInt(droneEntity.controllerID, 0);
    const controllerEntity = controllerID > 0 ? scene.getEntityByID(controllerID) : null;
    if (resetDroneToIdle(droneEntity, controllerEntity, {
      scene,
      stopMovement: Boolean(controllerEntity),
      sessions: options.sessions || null,
    })) {
      idledCount += 1;
    }
  }

  return idledCount;
}

function noteIncomingAggression(attackerEntity, targetEntity, whenMs = Date.now()) {
  const targetSystemID = toInt(targetEntity && targetEntity.systemID, 0);
  if (
    !attackerEntity ||
    !targetEntity ||
    targetSystemID <= 0 ||
    toInt(attackerEntity.itemID, 0) <= 0 ||
    toInt(targetEntity.itemID, 0) <= 0 ||
    toInt(attackerEntity.itemID, 0) === toInt(targetEntity.itemID, 0) ||
    String(targetEntity.kind || "") !== "ship" ||
    !hasDamageableHealth(attackerEntity)
  ) {
    return 0;
  }

  const runtime = getRuntime();
  const scene =
    runtime && typeof runtime.ensureScene === "function"
      ? runtime.ensureScene(targetSystemID)
      : null;
  if (!scene) {
    return 0;
  }

  const controllerEntity = scene.getEntityByID(toInt(targetEntity.itemID, 0)) || null;
  const hostileEntity = scene.getEntityByID(toInt(attackerEntity.itemID, 0)) || null;
  if (!controllerEntity || !hostileEntity) {
    return 0;
  }

  const behaviorSettings = getControllerDroneBehaviorSettings(controllerEntity);
  if (behaviorSettings.aggressive !== true) {
    return 0;
  }

  const controlledCombatIndex = getSceneControlledCombatDroneIndex(scene);
  const controllerEntry =
    controlledCombatIndex.get(toInt(controllerEntity.itemID, 0)) || null;
  const idleCombatDroneIDs =
    controllerEntry && Array.isArray(controllerEntry.idleCombatDroneIDs)
      ? controllerEntry.idleCombatDroneIDs
      : [];
  if (idleCombatDroneIDs.length <= 0) {
    return 0;
  }

  const targetIDs = selectAggressiveTargetIDs(
    scene,
    controllerEntity,
    hostileEntity.itemID,
    {
      focusFire: behaviorSettings.focusFire,
      desiredCount: idleCombatDroneIDs.length,
      nowMs: whenMs,
    },
  );
  if (targetIDs.length <= 0) {
    return 0;
  }

  let engagedCount = 0;
  const assignmentCount =
    behaviorSettings.focusFire === true
      ? idleCombatDroneIDs.length
      : Math.min(idleCombatDroneIDs.length, targetIDs.length);
  for (let index = 0; index < assignmentCount; index += 1) {
    const droneEntity = scene.getEntityByID(toInt(idleCombatDroneIDs[index], 0));
    const targetID = toInt(targetIDs[Math.min(index, targetIDs.length - 1)], 0);
    const assignedTarget = targetID > 0 ? scene.getEntityByID(targetID) : null;
    if (!droneEntity || !assignedTarget || !hasDamageableHealth(assignedTarget)) {
      continue;
    }

    const assignResult = assignDroneCombatTask(
      scene,
      droneEntity,
      controllerEntity,
      assignedTarget,
      {
        nowMs: whenMs,
        autoAssigned: true,
        emitActivity: true,
      },
    );
    if (assignResult && assignResult.success === true) {
      engagedCount += 1;
    }
  }
  return engagedCount;
}

function tickDroneCombat(scene, droneEntity, controllerEntity, now) {
  const combatState =
    droneEntity &&
    droneEntity.droneCombat &&
    typeof droneEntity.droneCombat === "object"
      ? droneEntity.droneCombat
      : null;
  const targetID = toInt(
    combatState && combatState.targetID,
    toInt(droneEntity && droneEntity.targetID, 0),
  );
  const targetEntity = targetID > 0 ? scene.getEntityByID(targetID) : null;
  if (!combatState || !controllerEntity || !targetEntity || !hasDamageableHealth(targetEntity)) {
    resetDroneToIdle(droneEntity, controllerEntity, {
      scene,
      stopMovement: Boolean(controllerEntity),
    });
    return;
  }

  const snapshot =
    resolveDroneCombatSnapshot(droneEntity, controllerEntity) ||
    combatState.snapshot ||
    null;
  if (!snapshot) {
    resetDroneToIdle(droneEntity, controllerEntity, {
      scene,
      stopMovement: Boolean(controllerEntity),
    });
    return;
  }
  combatState.snapshot = snapshot;

  const orbitDistance = Math.max(
    MIN_ORBIT_DISTANCE_METERS,
    toNumber(snapshot.orbitDistanceMeters, MIN_ORBIT_DISTANCE_METERS),
  );
  const attackRange = Math.max(
    orbitDistance,
    toNumber(snapshot.attackRangeMeters, 0),
  );
  const chaseRange = Math.max(
    attackRange,
    toNumber(snapshot.chaseRangeMeters, attackRange),
  );
  const surfaceDistance = getEntitySurfaceDistance(droneEntity, targetEntity);
  const beforeState = captureDroneClientState(droneEntity);
  copyControllerIdentity(droneEntity, controllerEntity);
  droneEntity.targetID = targetEntity.itemID;
  if (surfaceDistance > attackRange + 1) {
    syncDronePursuitBehavior(scene, droneEntity, targetEntity, orbitDistance);
    droneEntity.activityState =
      surfaceDistance > chaseRange + 1
        ? STATE_PURSUIT
        : STATE_APPROACHING;
    persistAndNotifyDroneState(droneEntity, beforeState);
    return;
  }

  syncDroneOrbitBehavior(scene, droneEntity, targetEntity, orbitDistance);
  droneEntity.activityState = STATE_COMBAT;
  persistAndNotifyDroneState(droneEntity, beforeState);

  if (toNumber(combatState.nextCycleAtMs, 0) > now) {
    return;
  }

  if (String(snapshot && snapshot.effectKind || "") === "jammer") {
    const runtime = getRuntime();
    if (snapshot.effectGUID) {
      scene.broadcastSpecialFx(
        droneEntity.itemID,
        snapshot.effectGUID,
        {
          moduleID: toInt(droneEntity && droneEntity.itemID, 0),
          moduleTypeID: toInt(droneEntity && droneEntity.typeID, 0),
          targetID: targetEntity.itemID,
          isOffensive: true,
          start: true,
          active: false,
          duration: Math.max(1, toNumber(snapshot.durationMs, 20_000)),
          repeat: 1,
          useCurrentVisibleStamp: true,
          avoidCurrentHistoryInsertion: true,
        },
        droneEntity,
      );
    }
    const effectState = {
      moduleID: toInt(droneEntity && droneEntity.itemID, 0),
      targetID: targetEntity.itemID,
      hostileJammingType: jammerModuleRuntime.ECM_JAMMING_TYPE,
      jammerModuleEffect: true,
      jammerStrengthBySensorType: snapshot.jammerStrengthBySensorType || {},
      jammerMaxRangeMeters: Math.max(0, toNumber(snapshot.optimalRange, 0)),
      jammerFalloffMeters: Math.max(0, toNumber(snapshot.falloff, 0)),
      durationMs: Math.max(1, toNumber(snapshot.durationMs, 20_000)),
      jamDurationMs: Math.max(1, toNumber(snapshot.jamDurationMs, 5_000)),
      nextCycleAtMs: now + Math.max(1, toNumber(snapshot.durationMs, 20_000)),
    };
    const cycleResult = jammerModuleRuntime.executeJammerModuleCycle({
      scene,
      entity: droneEntity,
      effectState,
      nowMs: now,
      callbacks: {
        getEntityByID(entityID) {
          return scene && typeof scene.getEntityByID === "function"
            ? scene.getEntityByID(entityID)
            : null;
        },
        isEntityLockedTarget() {
          return true;
        },
        getEntitySurfaceDistance(sourceEntity, externalTargetEntity) {
          return getEntitySurfaceDistance(sourceEntity, externalTargetEntity);
        },
        clearOutgoingTargetLocksExcept(externalTargetEntity, allowedTargetIDs, options = {}) {
          return scene && typeof scene.clearOutgoingTargetLocksExcept === "function"
            ? scene.clearOutgoingTargetLocksExcept(externalTargetEntity, allowedTargetIDs, options)
            : {
              clearedTargetIDs: [],
              cancelledPendingIDs: [],
            };
        },
        random() {
          return scene && typeof scene.__jammerRandom === "function"
            ? Number(scene.__jammerRandom()) || 0
            : Math.random();
        },
      },
    });
    if (
      cycleResult.success &&
      runtime &&
      typeof runtime.applyJammerCyclePresentation === "function"
    ) {
      runtime.applyJammerCyclePresentation(
        scene,
        droneEntity,
        effectState,
        now,
        cycleResult,
      );
    }
    combatState.nextCycleAtMs = now + Math.max(1, toNumber(snapshot.durationMs, 20_000));
    persistDroneEntityState(droneEntity);
    return;
  }

  const runtime = getRuntime();
  const droneInterop =
    runtime && runtime.droneInterop && typeof runtime.droneInterop === "object"
      ? runtime.droneInterop
      : null;
  if (!droneInterop || typeof droneInterop.resolveTurretShot !== "function") {
    return;
  }

  const pseudoModuleItem = buildDronePseudoModuleItem(droneEntity);
  const combatSourceEntity = buildDroneCombatSourceEntity(
    droneEntity,
    controllerEntity,
  ) || droneEntity;
  const shotResult = droneInterop.resolveTurretShot({
    attackerEntity: droneEntity,
    targetEntity,
    weaponSnapshot: snapshot,
  });
  if (snapshot.effectGUID) {
    scene.broadcastSpecialFx(
      droneEntity.itemID,
      snapshot.effectGUID,
      {
        moduleID: pseudoModuleItem.itemID,
        moduleTypeID: pseudoModuleItem.typeID,
        targetID: targetEntity.itemID,
        isOffensive: true,
        start: true,
        active: false,
        duration: snapshot.durationMs,
        repeat: 1,
        useCurrentVisibleStamp: true,
        avoidCurrentHistoryInsertion: true,
      },
      droneEntity,
    );
  }

  let damageResult = null;
  let destroyResult = null;
  if (
    shotResult &&
    shotResult.hit === true &&
    typeof droneInterop.applyWeaponDamageToTarget === "function"
  ) {
    const weaponDamageResult = droneInterop.applyWeaponDamageToTarget(
      scene,
      droneEntity,
      targetEntity,
      shotResult.shotDamage,
      now,
    );
    damageResult = weaponDamageResult && weaponDamageResult.damageResult
      ? weaponDamageResult.damageResult
      : null;
    destroyResult = weaponDamageResult && weaponDamageResult.destroyResult
      ? weaponDamageResult.destroyResult
      : null;
    const appliedDamageAmount =
      typeof droneInterop.getAppliedDamageAmount === "function"
        ? droneInterop.getAppliedDamageAmount(damageResult)
        : 0;
    if (
      appliedDamageAmount > 0 &&
      typeof droneInterop.noteKillmailDamage === "function"
    ) {
      droneInterop.noteKillmailDamage(
        combatSourceEntity,
        targetEntity,
        appliedDamageAmount,
        {
          whenMs: now,
          weaponSnapshot: {
            ...snapshot,
            moduleTypeID: pseudoModuleItem.typeID,
          },
          moduleItem: pseudoModuleItem,
          chargeItem: null,
        },
      );
    }
    if (
      destroyResult &&
      destroyResult.success === true &&
      typeof droneInterop.recordKillmailFromDestruction === "function"
    ) {
      droneInterop.recordKillmailFromDestruction(targetEntity, destroyResult, {
        attackerEntity: combatSourceEntity,
        whenMs: now,
        weaponSnapshot: {
          ...snapshot,
          moduleTypeID: pseudoModuleItem.typeID,
        },
        moduleItem: pseudoModuleItem,
        chargeItem: null,
      });
    }
  }

  if (typeof droneInterop.notifyWeaponDamageMessages === "function") {
    droneInterop.notifyWeaponDamageMessages(
      combatSourceEntity,
      targetEntity,
      pseudoModuleItem,
      shotResult && shotResult.shotDamage,
      typeof droneInterop.getAppliedDamageAmount === "function"
        ? droneInterop.getAppliedDamageAmount(damageResult)
        : 0,
      typeof droneInterop.getCombatMessageHitQuality === "function"
        ? droneInterop.getCombatMessageHitQuality(shotResult)
        : 0,
    );
  }

  combatState.nextCycleAtMs = now + Math.max(1, toNumber(snapshot.durationMs, 1000));
  if (destroyResult && destroyResult.success === true) {
    resetDroneToIdle(droneEntity, controllerEntity, {
      scene,
      stopMovement: true,
    });
  } else {
    persistDroneEntityState(droneEntity);
  }
}

function tickDroneMining(scene, droneEntity, controllerEntity, now) {
  const miningState =
    droneEntity &&
    droneEntity.droneMining &&
    typeof droneEntity.droneMining === "object"
      ? droneEntity.droneMining
      : null;
  const targetID = toInt(
    miningState && miningState.targetID,
    toInt(droneEntity && droneEntity.targetID, 0),
  );
  ensureSceneMiningState(scene);
  const targetEntity = targetID > 0 ? scene.getEntityByID(targetID) : null;
  const mineableState = getMineableState(scene, targetID);
  if (
    !miningState ||
    !controllerEntity ||
    !targetEntity ||
    !mineableState ||
    toInt(mineableState.remainingQuantity, 0) <= 0
  ) {
    resetDroneToIdle(droneEntity, controllerEntity, {
      scene,
      stopMovement: Boolean(controllerEntity),
    });
    return;
  }

  const snapshot =
    resolveDroneMiningSnapshot(droneEntity, controllerEntity) ||
    miningState.snapshot ||
    null;
  if (!snapshot || !isDroneMiningCompatibleWithTarget(droneEntity, mineableState)) {
    resetDroneToIdle(droneEntity, controllerEntity, {
      scene,
      stopMovement: Boolean(controllerEntity),
    });
    return;
  }
  miningState.snapshot = snapshot;

  const orbitDistance = Math.max(
    MIN_ORBIT_DISTANCE_METERS,
    toNumber(snapshot.orbitDistanceMeters, MIN_ORBIT_DISTANCE_METERS),
  );
  const maxRange = Math.max(
    orbitDistance,
    toNumber(snapshot.maxRangeMeters, orbitDistance),
  );
  const surfaceDistance = getEntitySurfaceDistance(droneEntity, targetEntity);
  const beforeState = captureDroneClientState(droneEntity);

  copyControllerIdentity(droneEntity, controllerEntity);
  droneEntity.targetID = targetEntity.itemID;
  if (surfaceDistance > maxRange + 1) {
    syncDronePursuitBehavior(scene, droneEntity, targetEntity, orbitDistance);
    droneEntity.activityState = STATE_APPROACHING;
    clearDroneMiningCycle(miningState);
    persistAndNotifyDroneState(droneEntity, beforeState);
    return;
  }

  syncDroneOrbitBehavior(scene, droneEntity, targetEntity, orbitDistance);
  droneEntity.activityState = STATE_MINING;
  if (
    toNumber(miningState.cycleStartedAtMs, 0) <= 0 ||
    toNumber(miningState.nextCycleAtMs, 0) <= 0
  ) {
    beginDroneMiningCycle(miningState, snapshot, now);
  }
  persistAndNotifyDroneState(droneEntity, beforeState);
  emitDroneMiningCycleFx(
    scene,
    droneEntity,
    targetEntity,
    snapshot,
    miningState,
    now,
  );

  if (toNumber(miningState.nextCycleAtMs, 0) > now) {
    return;
  }

  const destination = resolveDroneMiningDestination(
    controllerEntity,
    mineableState.yieldTypeID,
    mineableState.yieldKind,
  );
  const miningAmountM3 = Math.max(0, toNumber(snapshot.miningAmountM3, 0));
  if (!destination || destination.availableVolume <= 0 || miningAmountM3 <= 0) {
    resetDroneToIdle(droneEntity, controllerEntity, {
      scene,
      stopMovement: true,
    });
    return;
  }

  const quantityVolumeAvailable =
    Math.max(0, toInt(mineableState.remainingQuantity, 0)) *
    Math.max(0.000001, toNumber(mineableState.unitVolume, 1));
  const clampFactor = Math.min(
    1,
    quantityVolumeAvailable / miningAmountM3,
    destination.availableVolume / miningAmountM3,
  );
  if (clampFactor <= 0) {
    resetDroneToIdle(droneEntity, controllerEntity, {
      scene,
      stopMovement: true,
    });
    return;
  }

  const miningResult = computeMiningResult({
    clampFactor,
    volume: miningAmountM3,
    unitVolume: mineableState.unitVolume,
    asteroidQuantity: mineableState.remainingQuantity,
    wasteVolumeMultiplier: 0,
    wasteProbability: 0,
    critQuantityMultiplier: 0,
    critProbability: 0,
    efficiency: 1,
  });
  const transferredQuantity = miningResult.getTotalTransferredQuantity();
  const yieldTypeRecord = resolveItemByTypeID(toInt(mineableState.yieldTypeID, 0)) || null;
  if (!yieldTypeRecord || transferredQuantity <= 0) {
    beginDroneMiningCycle(miningState, snapshot, now);
    return;
  }

  const grantResult = grantItemToCharacterLocation(
    destination.storageSnapshot.characterID,
    destination.storageSnapshot.shipID,
    destination.flagID,
    yieldTypeRecord,
    transferredQuantity,
  );
  if (!grantResult || grantResult.success !== true) {
    resetDroneToIdle(droneEntity, controllerEntity, {
      scene,
      stopMovement: true,
    });
    return;
  }
  syncDroneInventoryChangesToSession(
    resolveDroneControllerSession(droneEntity, controllerEntity),
    grantResult.data && grantResult.data.changes,
  );
  invalidateDroneStorageSnapshot(controllerEntity);

  const pseudoModuleItem = buildDronePseudoModuleItem(droneEntity);
  const deltaResult = applyMiningDelta(
    scene,
    targetEntity,
    miningResult.normalQuantity,
    miningResult.wastedQuantity,
    {
      broadcast: true,
      nowMs: now,
      sourceDroneID: droneEntity.itemID,
      sourceEntity: controllerEntity,
      moduleItem: pseudoModuleItem,
      quantityAdded: transferredQuantity,
      amountWasted: miningResult.wastedQuantity,
      moduleItemID: droneEntity.itemID,
      moduleTypeID: droneEntity.typeID,
      moduleGroupID: droneEntity.groupID,
    },
  );
  if (!deltaResult || deltaResult.success !== true) {
    resetDroneToIdle(droneEntity, controllerEntity, {
      scene,
      stopMovement: true,
    });
    return;
  }

  if (
    deltaResult.data &&
    deltaResult.data.depleted === true
  ) {
    resetDroneToIdle(droneEntity, controllerEntity, {
      scene,
      stopMovement: true,
    });
    return;
  }

  beginDroneMiningCycle(miningState, snapshot, now);
  emitDroneMiningCycleFx(
    scene,
    droneEntity,
    targetEntity,
    snapshot,
    miningState,
    now,
  );
  persistDroneEntityState(droneEntity);
}

function tickDroneSalvage(scene, droneEntity, controllerEntity, now) {
  const salvageState =
    droneEntity &&
    droneEntity.droneSalvage &&
    typeof droneEntity.droneSalvage === "object"
      ? droneEntity.droneSalvage
      : null;
  const targetID = toInt(
    salvageState && salvageState.targetID,
    toInt(droneEntity && droneEntity.targetID, 0),
  );
  const targetEntity = targetID > 0 ? scene.getEntityByID(targetID) : null;
  if (
    !salvageState ||
    !controllerEntity ||
    !targetEntity ||
    !salvagerRuntime.isSalvageableTarget(targetEntity)
  ) {
    resetDroneToIdle(droneEntity, controllerEntity, {
      scene,
      stopMovement: Boolean(controllerEntity),
    });
    return;
  }

  const snapshot =
    resolveDroneSalvageSnapshot(droneEntity, controllerEntity) ||
    salvageState.snapshot ||
    null;
  if (!snapshot) {
    resetDroneToIdle(droneEntity, controllerEntity, {
      scene,
      stopMovement: Boolean(controllerEntity),
    });
    return;
  }
  salvageState.snapshot = snapshot;
  salvageState.chanceSnapshot = salvagerRuntime.buildSalvageChanceSnapshot(
    targetEntity,
    snapshot.accessBonusPercent,
  );

  const orbitDistance = Math.max(
    MIN_ORBIT_DISTANCE_METERS,
    toNumber(snapshot.orbitDistanceMeters, MIN_ORBIT_DISTANCE_METERS),
  );
  const maxRange = Math.max(
    orbitDistance,
    toNumber(snapshot.maxRangeMeters, orbitDistance),
  );
  const surfaceDistance = getEntitySurfaceDistance(droneEntity, targetEntity);
  const beforeState = captureDroneClientState(droneEntity);

  copyControllerIdentity(droneEntity, controllerEntity);
  droneEntity.targetID = targetEntity.itemID;
  if (surfaceDistance > maxRange + 1) {
    syncDronePursuitBehavior(scene, droneEntity, targetEntity, orbitDistance);
    droneEntity.activityState = STATE_APPROACHING;
    persistAndNotifyDroneState(droneEntity, beforeState);
    return;
  }

  syncDroneOrbitBehavior(scene, droneEntity, targetEntity, orbitDistance);
  droneEntity.activityState = STATE_SALVAGING;
  persistAndNotifyDroneState(droneEntity, beforeState);

  if (toNumber(salvageState.nextCycleAtMs, 0) > now) {
    return;
  }

  const controllerSession = resolveDroneControllerSession(droneEntity, controllerEntity);
  const controllerCharacterID = toInt(
    (
      controllerSession &&
      (controllerSession.characterID || controllerSession.charid)
    ) ||
      controllerEntity.pilotCharacterID ||
      controllerEntity.characterID ||
      controllerEntity.ownerID,
    0,
  );
  const controllerShipItem =
    findItemById(toInt(controllerEntity && controllerEntity.itemID, 0)) || {
      itemID: toInt(controllerEntity && controllerEntity.itemID, 0),
      typeID: toInt(controllerEntity && controllerEntity.typeID, 0),
      ownerID: controllerCharacterID,
    };
  const cycleResult = salvagerRuntime.executeSalvagerCycle({
    scene,
    entity: droneEntity,
    effectState: {
      moduleID: toInt(droneEntity && droneEntity.itemID, 0),
      moduleFlagID: 0,
      typeID: toInt(droneEntity && droneEntity.typeID, 0),
      targetID,
      salvagerRangeMeters: snapshot.maxRangeMeters,
      salvageChancePercent: salvageState.chanceSnapshot.chancePercent,
    },
    nowMs: now,
    callbacks: {
      isEntityLockedTarget: () => true,
      getEntitySurfaceDistance,
      resolveCharacterID: () => controllerCharacterID,
      getEntityRuntimeShipItem: () => controllerShipItem,
      getEntityRuntimeFittedItems: () => controllerEntity.fittedItems || [],
      getEntityRuntimeSkillMap: () => controllerEntity.skillMap || new Map(),
      resolveSession: () => controllerSession,
      syncInventoryChangesToSession: syncDroneInventoryChangesToSession,
      random() {
        return scene && typeof scene.__salvageRandom === "function"
          ? scene.__salvageRandom()
          : Math.random();
      },
    },
  });

  if (snapshot.effectGUID) {
    scene.broadcastSpecialFx(
      droneEntity.itemID,
      snapshot.effectGUID,
      {
        moduleID: droneEntity.itemID,
        moduleTypeID: droneEntity.typeID,
        targetID: targetEntity.itemID,
        isOffensive: false,
        start: true,
        active: false,
        duration: snapshot.durationMs,
        repeat: 1,
        useCurrentVisibleStamp: true,
      },
      droneEntity,
    );
  }

  if (!cycleResult.success) {
    resetDroneToIdle(droneEntity, controllerEntity, {
      scene,
      stopMovement: true,
    });
    return;
  }

  salvageState.nextCycleAtMs = now + Math.max(1, toNumber(snapshot.durationMs, 1000));
  persistDroneEntityState(droneEntity);
}

function tickScene(scene, now) {
  void now;
  const droneEntities = getSceneDroneEntities(scene);
  if (droneEntities.length === 0) {
    return;
  }

  for (const droneEntity of droneEntities) {
    const controllerID = toInt(droneEntity.controllerID, 0);
    const controllerEntity = controllerID > 0 ? scene.getEntityByID(controllerID) : null;
    if (!controllerEntity && controllerID > 0) {
      abandonDroneInSpace(scene, droneEntity, {
        stopMovement: true,
      });
      continue;
    }

    if (droneEntity.droneCommand === DRONE_COMMAND_ENGAGE && controllerEntity) {
      tickDroneCombat(scene, droneEntity, controllerEntity, toNumber(now, Date.now()));
      continue;
    }

    if (droneEntity.droneCommand === DRONE_COMMAND_MINE && controllerEntity) {
      tickDroneMining(scene, droneEntity, controllerEntity, toNumber(now, Date.now()));
      continue;
    }

    if (droneEntity.droneCommand === DRONE_COMMAND_SALVAGE && controllerEntity) {
      tickDroneSalvage(scene, droneEntity, controllerEntity, toNumber(now, Date.now()));
      continue;
    }

    if (droneEntity.droneCommand === DRONE_COMMAND_RETURN_HOME && controllerEntity) {
      const orbitDistance = Math.max(
        resolveDroneOrbitDistance(droneEntity),
        toNumber(droneEntity.droneHomeOrbitDistance, 0),
      );
      if (distance(droneEntity.position, controllerEntity.position) <= orbitDistance + controllerEntity.radius + droneEntity.radius) {
        scene.orbitShipEntity(droneEntity, controllerEntity.itemID, orbitDistance, {
          broadcast: true,
        });
        droneEntity.activityState = STATE_IDLE;
        droneEntity.targetID = null;
        droneEntity.droneCommand = null;
        droneEntity.activityID = null;
        droneEntity.activity = null;
        persistDroneEntityState(droneEntity);
        emitDroneStateChange(droneEntity);
        emitDroneActivityChange(droneEntity, null, null);
        markSceneControlledCombatDroneIndexDirty(scene);
      }
      continue;
    }

    if (droneEntity.droneCommand === DRONE_COMMAND_RETURN_BAY && controllerEntity) {
      if (getEntitySurfaceDistance(droneEntity, controllerEntity) <= DRONE_BAY_SCOOP_DISTANCE_METERS) {
        const shipRecord = findItemById(controllerEntity.itemID);
        if (shipRecord) {
          recallDroneToBay(scene, shipRecord, droneEntity);
        }
      }
    }
  }
}

module.exports = {
  DRONE_CATEGORY_ID,
  DRONE_COMMAND_RETURN_BAY,
  DRONE_COMMAND_RETURN_HOME,
  DRONE_COMMAND_ENGAGE,
  DRONE_COMMAND_MINE,
  DRONE_COMMAND_SALVAGE,
  STATE_IDLE,
  STATE_COMBAT,
  STATE_MINING,
  STATE_APPROACHING,
  STATE_DEPARTING,
  STATE_PURSUIT,
  STATE_SALVAGING,
  isDroneEntity,
  hydrateDroneEntityFromItem,
  buildDroneStateRows,
  buildDroneStateNotificationTuple,
  emitDroneActivityChange,
  handleDroneDestroyed,
  noteIncomingAggression,
  normalizeDroneIDList,
  normalizeLaunchRequests,
  launchDronesForSession,
  commandEngage,
  commandMineRepeatedly,
  commandReturnHome,
  commandReturnBay,
  commandAbandonDrone,
  commandReconnectToDrones,
  handleControllerLost,
  scoopDrone,
  idleMiningDronesTargeting,
  tickScene,
};
