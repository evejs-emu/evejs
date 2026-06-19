const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const {
  ITEM_FLAGS,
  findItemById,
  transferItemToOwnerLocation,
  updateInventoryItem,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  syncInventoryItemForSession,
} = require(path.join(__dirname, "../character/characterState"));
const {
  buildDict,
  buildList,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const planetOrbitalState = require(path.join(__dirname, "../planet/planetOrbitalState"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));

const ORBITAL_LAUNCH_DISTANCE_METERS = 2_500;

function toInt(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.trunc(numericValue) : fallback;
}

function toReal(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function normalizeVector(value, fallback = { x: 0, y: 0, z: 0 }) {
  const source = value && typeof value === "object" ? value : fallback;
  return {
    x: toReal(source.x, fallback.x),
    y: toReal(source.y, fallback.y),
    z: toReal(source.z, fallback.z),
  };
}

function normalizeDirection(value, fallback = { x: 1, y: 0, z: 0 }) {
  const vector = normalizeVector(value, fallback);
  const length = Math.sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z);
  if (length <= 0) {
    return { ...fallback };
  }
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function addVectors(left, right) {
  return {
    x: toReal(left && left.x, 0) + toReal(right && right.x, 0),
    y: toReal(left && left.y, 0) + toReal(right && right.y, 0),
    z: toReal(left && left.z, 0) + toReal(right && right.z, 0),
  };
}

function scaleVector(vector, scalar) {
  const factor = toReal(scalar, 0);
  return {
    x: toReal(vector && vector.x, 0) * factor,
    y: toReal(vector && vector.y, 0) * factor,
    z: toReal(vector && vector.z, 0) * factor,
  };
}

function buildNotifyErrorTuple(message) {
  return [
    "CustomNotify",
    buildDict([["notify", String(message || "Unable to launch item.")]]),
  ];
}

function ensureLaunchResponseEntry(response, itemID) {
  const numericItemID = toInt(itemID, 0);
  if (
    !response ||
    response.type !== "dict" ||
    !Array.isArray(response.entries) ||
    numericItemID <= 0
  ) {
    return null;
  }

  let entry = response.entries.find(
    (candidate) => Array.isArray(candidate) && toInt(candidate[0], 0) === numericItemID,
  );
  if (!entry) {
    entry = [numericItemID, buildList([])];
    response.entries.push(entry);
  }
  if (!entry[1] || entry[1].type !== "list" || !Array.isArray(entry[1].items)) {
    entry[1] = buildList([]);
  }
  return entry[1];
}

function appendLaunchResponseValue(response, sourceItemID, value) {
  const entryList = ensureLaunchResponseEntry(response, sourceItemID);
  if (entryList) {
    entryList.items.push(value);
  }
  return response;
}

function normalizeLaunchRequests(rawValue) {
  const unwrapped = unwrapMarshalValue(rawValue);
  const source = Array.isArray(unwrapped) ? unwrapped : [unwrapped];
  const requests = [];
  for (const entry of source) {
    let itemID = 0;
    let quantity = 1;
    if (Array.isArray(entry)) {
      itemID = toInt(entry[0], 0);
      quantity = Math.max(1, toInt(entry[1], 1));
    } else if (entry && typeof entry === "object") {
      itemID = toInt(entry.itemID ?? entry.id, 0);
      quantity = Math.max(1, toInt(entry.quantity ?? entry.qty, 1));
    } else {
      itemID = toInt(entry, 0);
    }
    if (itemID > 0) {
      requests.push({ itemID, quantity });
    }
  }
  return requests;
}

function syncInventoryChange(session, item, previousData) {
  syncInventoryItemForSession(
    session,
    item,
    previousData || {},
    { emitCfgLocation: true },
  );
}

function syncChangesExceptItem(session, changes = [], excludedItemID = 0) {
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change || !change.item || toInt(change.item.itemID, 0) === excludedItemID) {
      continue;
    }
    syncInventoryChange(session, change.item, change.previousData || change.previousState || {});
  }
}

function getSessionContext(session, options = {}) {
  const characterID = toInt(session && (session.characterID || session.charid), 0);
  const corporationID = toInt(
    session && (session.corporationID || session.corpid),
    characterID,
  );
  const behalfOwnerID = toInt(options.ownerID, 0);
  const allianceID = toInt(session && (session.allianceID || session.allianceid), 0);
  const warFactionID = toInt(session && (session.warFactionID || session.warfactionid), 0);
  const shipID = toInt(
    session && session._space && session._space.shipID,
    toInt(session && (session.shipID || session.shipid || session.activeShipID), 0),
  );
  const systemID = toInt(
    session && session._space && session._space.systemID,
    toInt(session && (session.solarsystemid2 || session.solarsystemid), 0),
  );

  return {
    characterID,
    corporationID,
    ownerID: behalfOwnerID || corporationID || characterID,
    allianceID,
    warFactionID,
    shipID,
    systemID,
  };
}

function buildOrbitalSpawnState(session, systemID) {
  const shipEntity =
    session && session._space && session._space.shipID
      ? spaceRuntime.getEntity(session, session._space.shipID)
      : null;
  const position = normalizeVector(
    shipEntity && shipEntity.position,
    { x: 0, y: 0, z: 0 },
  );
  const direction = normalizeDirection(
    shipEntity && shipEntity.direction,
    { x: 1, y: 0, z: 0 },
  );
  const launchedPosition = addVectors(
    position,
    scaleVector(direction, ORBITAL_LAUNCH_DISTANCE_METERS),
  );

  return {
    systemID,
    position: launchedPosition,
    velocity: { x: 0, y: 0, z: 0 },
    direction,
    targetPoint: launchedPosition,
    mode: "STOP",
    speedFraction: 0,
  };
}

function findLaunchedChange(changes = [], systemID, ownerID, sourceTypeID) {
  return (Array.isArray(changes) ? changes : []).find((change) => {
    const item = change && change.item;
    return Boolean(
      item &&
        toInt(item.locationID, 0) === systemID &&
        toInt(item.flagID, -1) === 0 &&
        toInt(item.ownerID, 0) === ownerID &&
        toInt(item.typeID, 0) === sourceTypeID,
    );
  }) || null;
}

function launchOrbitalItem(session, itemID, options = {}) {
  const context = getSessionContext(session, options);
  if (!context.characterID || !context.ownerID || !context.shipID || !context.systemID) {
    return {
      success: false,
      errorMsg: "INVALID_SESSION",
    };
  }

  const item = findItemById(itemID);
  if (!item) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }
  if (toInt(item.categoryID, 0) !== planetOrbitalState.CATEGORY_ORBITAL) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_ORBITAL",
    };
  }
  if (
    ![context.characterID, context.corporationID, context.ownerID].includes(toInt(item.ownerID, 0)) ||
    toInt(item.locationID, 0) !== context.shipID ||
    toInt(item.flagID, 0) !== ITEM_FLAGS.CARGO_HOLD
  ) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_IN_SHIP_CARGO",
    };
  }

  const sourceTypeID = toInt(item.typeID, 0);
  const transferResult = transferItemToOwnerLocation(
    item.itemID,
    context.ownerID,
    context.systemID,
    0,
    1,
  );
  if (!transferResult.success) {
    return transferResult;
  }

  const transferChanges = transferResult.data && transferResult.data.changes
    ? transferResult.data.changes
    : [];
  const launchedChange = findLaunchedChange(
    transferChanges,
    context.systemID,
    context.ownerID,
    sourceTypeID,
  );
  const launchedItemID = toInt(launchedChange && launchedChange.item && launchedChange.item.itemID, 0);
  if (!launchedItemID) {
    return {
      success: false,
      errorMsg: "LAUNCHED_ITEM_NOT_FOUND",
    };
  }

  const spawnState = buildOrbitalSpawnState(session, context.systemID);
  const updatedResult = updateInventoryItem(launchedItemID, (currentItem) => ({
    ...currentItem,
    ownerID: context.ownerID,
    locationID: context.systemID,
    flagID: 0,
    singleton: 1,
    createdAtMs: currentItem.createdAtMs || Date.now(),
    spaceRadius: currentItem.spaceRadius || currentItem.radius || null,
    dunRotation: currentItem.dunRotation || [0, 0, 0],
    spaceState: spawnState,
  }));
  if (!updatedResult.success || !updatedResult.data) {
    return updatedResult;
  }

  syncChangesExceptItem(session, transferChanges, launchedItemID);
  syncInventoryChange(
    session,
    updatedResult.data,
    launchedChange.previousData || updatedResult.previousData || {},
  );

  const orbitalRecord = planetOrbitalState.ensureOrbitalForItem(updatedResult.data, {
    corporationID: context.corporationID,
    allianceID: context.allianceID,
    warFactionID: context.warFactionID,
    solarSystemID: context.systemID,
    state: planetOrbitalState.ORBITAL_STATE.UNANCHORED,
  });

  const spawnResult = spaceRuntime.spawnDynamicInventoryEntity(context.systemID, launchedItemID);
  if (!spawnResult || !spawnResult.success) {
    log.warn(
      `[OrbitalLaunch] Launched orbital ${launchedItemID} but space spawn failed: ${spawnResult ? spawnResult.errorMsg : "UNKNOWN"}`,
    );
  }

  log.info(
    `[OrbitalLaunch] char=${context.characterID} launched orbital itemID=${launchedItemID} typeID=${sourceTypeID} owner=${context.ownerID} system=${context.systemID} planet=${orbitalRecord ? orbitalRecord.planetID : 0}`,
  );

  return {
    success: true,
    data: {
      itemID: launchedItemID,
      sourceItemID: item.itemID,
      orbital: orbitalRecord,
    },
  };
}

function launchOrbitalsFromShip(session, rawItemIDs, options = {}) {
  const requests = normalizeLaunchRequests(rawItemIDs);
  const response = buildDict([]);
  if (requests.length === 0) {
    return {
      success: false,
      errorMsg: "NO_ITEMS",
      launchedItemIDs: [],
      errors: [],
      response,
    };
  }

  const launchedItemIDs = [];
  const errors = [];
  for (const request of requests) {
    ensureLaunchResponseEntry(response, request.itemID);
    for (let index = 0; index < request.quantity; index += 1) {
      const result = launchOrbitalItem(session, request.itemID, options);
      if (result.success) {
        launchedItemIDs.push(result.data.itemID);
        appendLaunchResponseValue(response, request.itemID, result.data.itemID);
        continue;
      }
      const error = {
        itemID: request.itemID,
        errorMsg: result.errorMsg || "UNKNOWN_ERROR",
      };
      errors.push(error);
      appendLaunchResponseValue(
        response,
        request.itemID,
        buildNotifyErrorTuple(error.errorMsg),
      );
      log.warn(
        `[OrbitalLaunch] LaunchFromShip failed itemID=${request.itemID}: ${error.errorMsg}`,
      );
      break;
    }
  }

  return {
    success: launchedItemIDs.length > 0,
    errorMsg: launchedItemIDs.length > 0 ? null : "NO_VALID_ORBITALS",
    launchedItemIDs,
    errors,
    response,
  };
}

module.exports = {
  launchOrbitalsFromShip,
  _testing: {
    normalizeLaunchRequests,
    buildOrbitalSpawnState,
  },
};
