const path = require("path");

const config = require(path.join(__dirname, "../../config"));
const database = require(path.join(__dirname, "../../newDatabase"));
const log = require(path.join(__dirname, "../../utils/logger"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const {
  ITEM_FLAGS,
  findItemById,
  listContainerItems,
  moveItemToLocation,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  TABLE,
  readStaticRows,
} = require(path.join(__dirname, "../_shared/referenceData"));
const {
  NEXT_ASSET_WRAP_ID_START,
  STRUCTURE_UPKEEP_STATE,
} = require(path.join(__dirname, "./structureConstants"));

const STRUCTURE_ASSET_SAFETY_TABLE = "structureAssetSafety";
const ASSET_SAFETY_FLAG_ID = 36;
const ASSET_SAFETY_WRAP_TYPE_ID = 60;
const DAYS_UNTIL_CAN_DELIVER = 5;
const DAYS_UNTIL_AUTO_MOVE = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

let wrapCache = null;
let stationCache = null;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizePositiveInt(value, fallback = 0) {
  const numeric = normalizeInt(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function normalizeTimestampMs(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : fallback;
}

function readWrapTable() {
  const result = database.read(STRUCTURE_ASSET_SAFETY_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {
      _meta: {
        nextWrapID: NEXT_ASSET_WRAP_ID_START,
        generatedAt: null,
        lastUpdatedAt: null,
      },
      wraps: [],
    };
  }
  return cloneValue(result.data);
}

function writeWrapTable(payload) {
  const result = database.write(STRUCTURE_ASSET_SAFETY_TABLE, "/", payload);
  if (!result.success) {
    return {
      success: false,
      errorMsg: result.errorMsg || "WRITE_FAILED",
    };
  }
  wrapCache = null;
  return { success: true };
}

function getStaticStations() {
  if (stationCache) {
    return stationCache;
  }

  stationCache = readStaticRows(TABLE.STATIONS)
    .map((station) => ({
      itemID: normalizePositiveInt(station && station.stationID, 0),
      typeID: normalizePositiveInt(station && station.stationTypeID, 0),
      solarSystemID: normalizePositiveInt(station && station.solarSystemID, 0),
      constellationID: normalizePositiveInt(station && station.constellationID, 0),
      regionID: normalizePositiveInt(station && station.regionID, 0),
      itemName: String(
        station && (station.stationName || station.itemName || `Station ${station.stationID}`),
      ),
    }))
    .filter((station) => station.itemID > 0)
    .sort((left, right) => left.itemID - right.itemID);

  return stationCache;
}

function normalizeStationInfo(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const itemID = normalizePositiveInt(value.itemID || value.stationID, 0);
  if (!itemID) {
    return null;
  }

  return {
    itemID,
    typeID: normalizePositiveInt(value.typeID || value.stationTypeID, 0),
    solarSystemID: normalizePositiveInt(value.solarSystemID, 0),
    itemName: String(value.itemName || value.stationName || `Station ${itemID}`),
  };
}

function normalizeWrapRecord(entry = {}) {
  const assetWrapID = normalizePositiveInt(entry.assetWrapID, 0);
  const ownerKind = String(entry.ownerKind || "char").trim().toLowerCase() === "corp"
    ? "corp"
    : "char";
  const nearestNPCStationInfo = normalizeStationInfo(entry.nearestNPCStationInfo);
  const createdAt = normalizeTimestampMs(entry.createdAt, null) || Date.now();
  const ejectTimeMs =
    normalizeTimestampMs(entry.ejectTimeMs, null) ||
    normalizeTimestampMs(entry.ejectTime, null) ||
    createdAt;

  return {
    assetWrapID,
    ownerID: normalizePositiveInt(entry.ownerID, 0),
    ownerKind,
    sourceStructureID: normalizePositiveInt(entry.sourceStructureID, 0),
    solarSystemID: normalizePositiveInt(entry.solarSystemID, 0),
    wrapName: String(entry.wrapName || `Asset Safety Wrap ${assetWrapID}`),
    wrapTypeID: ASSET_SAFETY_WRAP_TYPE_ID,
    itemIDs: [...new Set((Array.isArray(entry.itemIDs) ? entry.itemIDs : []).map((itemID) => normalizePositiveInt(itemID, 0)).filter(Boolean))].sort((left, right) => left - right),
    createdAt,
    ejectTimeMs,
    daysUntilCanDeliverConst: DAYS_UNTIL_CAN_DELIVER,
    daysUntilAutoMoveConst: DAYS_UNTIL_AUTO_MOVE,
    nearestNPCStationInfo,
    destinationID: normalizePositiveInt(entry.destinationID, 0) || null,
    destinationKind: entry.destinationKind ? String(entry.destinationKind) : null,
    deliveredAt: normalizeTimestampMs(entry.deliveredAt, null),
    autoMovedAt: normalizeTimestampMs(entry.autoMovedAt, null),
    assetSafetyDisabled: Boolean(entry.assetSafetyDisabled),
  };
}

function ensureWrapCache() {
  if (wrapCache) {
    return wrapCache;
  }

  const payload = readWrapTable();
  const wraps = Array.isArray(payload.wraps)
    ? payload.wraps.map((entry) => normalizeWrapRecord(entry))
    : [];
  wrapCache = {
    meta: {
      nextWrapID: Math.max(
        NEXT_ASSET_WRAP_ID_START,
        normalizePositiveInt(payload._meta && payload._meta.nextWrapID, NEXT_ASSET_WRAP_ID_START),
      ),
      generatedAt: payload._meta && payload._meta.generatedAt ? String(payload._meta.generatedAt) : null,
      lastUpdatedAt: payload._meta && payload._meta.lastUpdatedAt ? String(payload._meta.lastUpdatedAt) : null,
    },
    wraps,
    byWrapID: new Map(wraps.map((wrap) => [wrap.assetWrapID, wrap])),
  };
  return wrapCache;
}

function persistWraps(wraps, metaOverrides = {}) {
  const normalizedWraps = wraps.map((wrap) => normalizeWrapRecord(wrap));
  const nextWrapID = Math.max(
    NEXT_ASSET_WRAP_ID_START,
    ...normalizedWraps.map((wrap) => normalizePositiveInt(wrap.assetWrapID, 0) + 1),
    NEXT_ASSET_WRAP_ID_START,
  );
  return writeWrapTable({
    _meta: {
      ...(ensureWrapCache().meta || {}),
      nextWrapID,
      lastUpdatedAt: new Date().toISOString(),
      ...metaOverrides,
    },
    wraps: normalizedWraps,
  });
}

function updateWrap(assetWrapID, updater) {
  const targetID = normalizePositiveInt(assetWrapID, 0);
  if (!targetID || typeof updater !== "function") {
    return {
      success: false,
      errorMsg: "WRAP_NOT_FOUND",
    };
  }

  const cache = ensureWrapCache();
  const current = cache.byWrapID.get(targetID);
  if (!current) {
    return {
      success: false,
      errorMsg: "WRAP_NOT_FOUND",
    };
  }

  const next = normalizeWrapRecord(updater(cloneValue(current)) || current);
  const writeResult = persistWraps(
    cache.wraps.map((wrap) => (wrap.assetWrapID === targetID ? next : wrap)),
  );
  if (!writeResult.success) {
    return writeResult;
  }

  return {
    success: true,
    data: next,
  };
}

function createWrap(record) {
  const cache = ensureWrapCache();
  const assetWrapID = Math.max(NEXT_ASSET_WRAP_ID_START, cache.meta.nextWrapID || NEXT_ASSET_WRAP_ID_START);
  const next = normalizeWrapRecord({
    ...record,
    assetWrapID,
  });
  const writeResult = persistWraps([...cache.wraps, next], {
    nextWrapID: assetWrapID + 1,
    generatedAt: cache.meta.generatedAt || new Date().toISOString(),
  });
  if (!writeResult.success) {
    return writeResult;
  }

  return {
    success: true,
    data: next,
  };
}

function listWraps(options = {}) {
  if (options.refresh !== false) {
    tickAssetSafetyWraps(options.nowMs);
  }
  const includeDelivered = options.includeDelivered === true;
  return ensureWrapCache().wraps
    .filter((wrap) => includeDelivered || !wrap.deliveredAt)
    .map((wrap) => cloneValue(wrap));
}

function getWrapByID(assetWrapID, options = {}) {
  if (options.refresh !== false) {
    tickAssetSafetyWraps(options.nowMs);
  }
  return ensureWrapCache().byWrapID.get(normalizePositiveInt(assetWrapID, 0)) || null;
}

function getWrapNames(wrapIDs = []) {
  return Object.fromEntries(
    (Array.isArray(wrapIDs) ? wrapIDs : [wrapIDs])
      .map((wrapID) => normalizePositiveInt(wrapID, 0))
      .filter(Boolean)
      .map((wrapID) => {
        const wrap = getWrapByID(wrapID);
        return [wrapID, wrap ? wrap.wrapName : null];
      }),
  );
}

function listWrapsForOwner(ownerKind, ownerID, options = {}) {
  const normalizedOwnerKind = String(ownerKind || "char").trim().toLowerCase() === "corp"
    ? "corp"
    : "char";
  const normalizedOwnerID = normalizePositiveInt(ownerID, 0);
  if (!normalizedOwnerID) {
    return [];
  }

  return listWraps(options).filter(
    (wrap) =>
      wrap.ownerKind === normalizedOwnerKind &&
      normalizePositiveInt(wrap.ownerID, 0) === normalizedOwnerID,
  );
}

function getSessionCharacterID(session) {
  return normalizePositiveInt(
    session && (session.characterID || session.charid || session.userid),
    0,
  );
}

function getSessionCorporationID(session) {
  return normalizePositiveInt(
    session && (session.corporationID || session.corpid),
    0,
  );
}

function sessionCanManageWrap(session, wrap) {
  if (!wrap) {
    return false;
  }
  if (config.devBypassAssetSafetyWrapAccess === true) {
    return true;
  }

  const structureState = require(path.join(__dirname, "./structureState"));
  if (structureState.hasStructureGmBypass(session)) {
    return true;
  }

  return (
    (wrap.ownerKind === "char" && wrap.ownerID === getSessionCharacterID(session)) ||
    (wrap.ownerKind === "corp" && wrap.ownerID === getSessionCorporationID(session))
  );
}

function getFallbackNpcStationInfo(solarSystemID) {
  const stations = getStaticStations();
  if (stations.length === 0) {
    return null;
  }

  const numericSystemID = normalizePositiveInt(solarSystemID, 0);
  const systemRecord = worldData.getSolarSystemByID(numericSystemID);
  const sameSystem = stations.find((station) => station.solarSystemID === numericSystemID);
  if (sameSystem) {
    return cloneValue(sameSystem);
  }

  if (systemRecord) {
    const sameConstellation = stations.find(
      (station) =>
        normalizePositiveInt(station.constellationID, 0) > 0 &&
        station.constellationID === normalizePositiveInt(systemRecord.constellationID, 0),
    );
    if (sameConstellation) {
      return cloneValue(sameConstellation);
    }

    const sameRegion = stations.find(
      (station) =>
        normalizePositiveInt(station.regionID, 0) > 0 &&
        station.regionID === normalizePositiveInt(systemRecord.regionID, 0),
    );
    if (sameRegion) {
      return cloneValue(sameRegion);
    }
  }

  return cloneValue(stations[0]);
}

function isAssetSafetyDisabledSolarSystem(solarSystemID) {
  const numericSystemID = normalizePositiveInt(solarSystemID, 0);
  const systemRecord = worldData.getSolarSystemByID(numericSystemID);
  if (!systemRecord) {
    return false;
  }

  if (numericSystemID >= 31000000) {
    return true;
  }

  if (normalizePositiveInt(systemRecord.regionID, 0) === 10000070) {
    return true;
  }

  return /^J\d+/i.test(String(systemRecord.solarSystemName || "").trim());
}

function getWrapUnlockTimeMs(wrap) {
  return normalizeTimestampMs(wrap && wrap.ejectTimeMs, 0) + DAYS_UNTIL_CAN_DELIVER * DAY_MS;
}

function getWrapAutoMoveTimeMs(wrap) {
  return normalizeTimestampMs(wrap && wrap.ejectTimeMs, 0) + DAYS_UNTIL_AUTO_MOVE * DAY_MS;
}

function listTopLevelStructureItems(ownerID, structureID, options = {}) {
  const excludedItemIDs = new Set(
    (Array.isArray(options.excludeItemIDs) ? options.excludeItemIDs : [])
      .map((itemID) => normalizePositiveInt(itemID, 0))
      .filter(Boolean),
  );

  return listContainerItems(normalizePositiveInt(ownerID, 0), normalizePositiveInt(structureID, 0), null)
    .filter((item) => item && !excludedItemIDs.has(normalizePositiveInt(item.itemID, 0)));
}

function createWrapFromItems(ownerKind, ownerID, structure, items = [], options = {}) {
  const topLevelItems = (Array.isArray(items) ? items : [])
    .map((item) => {
      const itemID = normalizePositiveInt(item && item.itemID, 0);
      return itemID > 0 ? (findItemById(itemID) || item) : null;
    })
    .filter(Boolean);

  if (topLevelItems.length === 0) {
    return {
      success: true,
      data: {
        createdWrap: null,
        movedItemIDs: [],
      },
    };
  }

  const structureName = String(
    structure && (structure.itemName || structure.name || `Structure ${structure.structureID}`),
  );
  const wrapCreateResult = createWrap({
    ownerID: normalizePositiveInt(ownerID, 0),
    ownerKind,
    sourceStructureID: normalizePositiveInt(structure && structure.structureID, 0),
    solarSystemID: normalizePositiveInt(structure && structure.solarSystemID, 0),
    wrapName: options.wrapName || `${structureName} Asset Safety`,
    itemIDs: topLevelItems.map((item) => normalizePositiveInt(item.itemID, 0)).filter(Boolean),
    createdAt: normalizeTimestampMs(options.nowMs, Date.now()) || Date.now(),
    ejectTimeMs: normalizeTimestampMs(options.nowMs, Date.now()) || Date.now(),
    nearestNPCStationInfo:
      normalizeStationInfo(options.nearestNPCStationInfo) ||
      getFallbackNpcStationInfo(structure && structure.solarSystemID),
    assetSafetyDisabled: Boolean(options.assetSafetyDisabled),
  });
  if (!wrapCreateResult.success) {
    return wrapCreateResult;
  }

  const movedItemIDs = [];
  for (const item of topLevelItems) {
    const moveResult = moveItemToLocation(
      item.itemID,
      wrapCreateResult.data.assetWrapID,
      ASSET_SAFETY_FLAG_ID,
    );
    if (!moveResult.success) {
      log.warn(
        `[StructureAssetSafety] Failed to move item ${item.itemID} into wrap ${wrapCreateResult.data.assetWrapID}: ${moveResult.errorMsg}`,
      );
      continue;
    }
    movedItemIDs.push(normalizePositiveInt(item.itemID, 0));
  }

  if (movedItemIDs.length > 0) {
    const refreshResult = updateWrap(wrapCreateResult.data.assetWrapID, (current) => ({
      ...current,
      itemIDs: movedItemIDs,
    }));
    if (!refreshResult.success) {
      return refreshResult;
    }
    return {
      success: true,
      data: {
        createdWrap: refreshResult.data,
        movedItemIDs,
      },
    };
  }

  return {
    success: true,
    data: {
      createdWrap: wrapCreateResult.data,
      movedItemIDs: [],
    },
  };
}

function listItemsInsideWrap(wrap) {
  if (!wrap) {
    return [];
  }
  return listContainerItems(
    normalizePositiveInt(wrap.ownerID, 0),
    normalizePositiveInt(wrap.assetWrapID, 0),
    ASSET_SAFETY_FLAG_ID,
  );
}

function deliverWrapToDestination(assetWrapID, destinationID, options = {}) {
  // Automatic delivery already runs inside tickAssetSafetyWraps. Refreshing
  // here would re-enter the tick before the current wrap can be delivered.
  const wrap = getWrapByID(assetWrapID, { refresh: false });
  if (!wrap) {
    return {
      success: false,
      errorMsg: "WRAP_NOT_FOUND",
    };
  }
  if (wrap.deliveredAt) {
    return {
      success: false,
      errorMsg: "WRAP_ALREADY_DELIVERED",
    };
  }

  const session = options.session || null;
  if (options.skipAccessCheck !== true && !sessionCanManageWrap(session, wrap)) {
    return {
      success: false,
      errorMsg: "WRAP_ACCESS_DENIED",
    };
  }

  const nowMs = normalizeTimestampMs(options.nowMs, Date.now()) || Date.now();
  const structureState = require(path.join(__dirname, "./structureState"));
  const bypass = Boolean(
    options.ignoreTimer === true || structureState.hasStructureGmBypass(session),
  );
  if (!bypass && nowMs < getWrapUnlockTimeMs(wrap)) {
    return {
      success: false,
      errorMsg: "WRAP_NOT_READY",
    };
  }

  const numericDestinationID = normalizePositiveInt(destinationID, 0) ||
    normalizePositiveInt(
      wrap.nearestNPCStationInfo && wrap.nearestNPCStationInfo.itemID,
      0,
    );
  if (!numericDestinationID) {
    return {
      success: false,
      errorMsg: "DESTINATION_NOT_FOUND",
    };
  }

  let destinationKind = "station";
  const destinationStructure = worldData.getStructureByID(numericDestinationID);
  if (destinationStructure) {
    destinationKind = "structure";
    if (
      destinationStructure.destroyedAt ||
      destinationStructure.solarSystemID !== wrap.solarSystemID
    ) {
      return {
        success: false,
        errorMsg: "INVALID_DESTINATION_STRUCTURE",
      };
    }

    const accessResult = structureState.canCharacterDockAtStructure(
      session,
      destinationStructure,
      {
        ignoreRestrictions: structureState.hasStructureGmBypass(session),
      },
    );
    if (!accessResult.success) {
      return {
        success: false,
        errorMsg: accessResult.errorMsg || "DESTINATION_ACCESS_DENIED",
      };
    }
  } else {
    const destinationStation = worldData.getStationByID(numericDestinationID);
    if (!destinationStation) {
      return {
        success: false,
        errorMsg: "DESTINATION_NOT_FOUND",
      };
    }
    if (
      normalizePositiveInt(destinationStation.solarSystemID, 0) !== wrap.solarSystemID &&
      numericDestinationID !== normalizePositiveInt(
        wrap.nearestNPCStationInfo && wrap.nearestNPCStationInfo.itemID,
        0,
      )
    ) {
      return {
        success: false,
        errorMsg: "INVALID_DESTINATION_STATION",
      };
    }
  }

  const movedItemIDs = [];
  for (const item of listItemsInsideWrap(wrap)) {
    const moveResult = moveItemToLocation(item.itemID, numericDestinationID, ITEM_FLAGS.HANGAR);
    if (!moveResult.success) {
      return moveResult;
    }
    movedItemIDs.push(normalizePositiveInt(item.itemID, 0));
  }

  return updateWrap(wrap.assetWrapID, (current) => ({
    ...current,
    destinationID: numericDestinationID,
    destinationKind,
    deliveredAt: nowMs,
    autoMovedAt: options.autoMove === true ? nowMs : current.autoMovedAt,
    itemIDs: movedItemIDs.length > 0 ? movedItemIDs : current.itemIDs,
  }));
}

function tickAssetSafetyWraps(nowMs = Date.now()) {
  const normalizedNowMs = normalizeTimestampMs(nowMs, Date.now()) || Date.now();
  const wraps = ensureWrapCache().wraps;
  let changed = false;

  for (const wrap of wraps) {
    if (wrap.deliveredAt || !wrap.nearestNPCStationInfo) {
      continue;
    }
    if (normalizedNowMs < getWrapAutoMoveTimeMs(wrap)) {
      continue;
    }

    const deliverResult = deliverWrapToDestination(
      wrap.assetWrapID,
      wrap.nearestNPCStationInfo.itemID,
      {
        session: null,
        skipAccessCheck: true,
        ignoreTimer: true,
        autoMove: true,
        nowMs: normalizedNowMs,
      },
    );
    if (!deliverResult.success) {
      log.warn(
        `[StructureAssetSafety] Auto-move failed for wrap ${wrap.assetWrapID}: ${deliverResult.errorMsg}`,
      );
      continue;
    }
    changed = true;
  }

  if (changed) {
    wrapCache = null;
  }
  return listWraps({
    includeDelivered: true,
    nowMs: normalizedNowMs,
    refresh: false,
  });
}

function movePersonalAssetsToSafety(session, solarSystemID, structureID, options = {}) {
  const structureState = require(path.join(__dirname, "./structureState"));
  const charID = getSessionCharacterID(session);
  const structure = worldData.getStructureByID(structureID);
  if (!charID || !structure) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }
  if (
    normalizePositiveInt(solarSystemID, structure.solarSystemID) !==
    normalizePositiveInt(structure.solarSystemID, 0)
  ) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_MISMATCH",
    };
  }

  const assetSafetyDisabled =
    isAssetSafetyDisabledSolarSystem(structure.solarSystemID) &&
    !structureState.hasStructureGmBypass(session);
  if (assetSafetyDisabled) {
    return {
      success: false,
      errorMsg: "ASSET_SAFETY_DISABLED",
    };
  }

  const activeShipID = normalizePositiveInt(
    options.excludeActiveShipID ||
      (session && session.structureID === structure.structureID && (session.activeShipID || session.shipID || session.shipid)),
    0,
  );
  return createWrapFromItems(
    "char",
    charID,
    structure,
    listTopLevelStructureItems(charID, structure.structureID, {
      excludeItemIDs: activeShipID ? [activeShipID] : [],
    }),
    options,
  );
}

function moveCorporationAssetsToSafety(session, solarSystemID, structureID, options = {}) {
  const structureState = require(path.join(__dirname, "./structureState"));
  const corpID = getSessionCorporationID(session);
  const structure = worldData.getStructureByID(structureID);
  if (!corpID || !structure) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }
  if (
    normalizePositiveInt(solarSystemID, structure.solarSystemID) !==
    normalizePositiveInt(structure.solarSystemID, 0)
  ) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_MISMATCH",
    };
  }

  const assetSafetyDisabled =
    isAssetSafetyDisabledSolarSystem(structure.solarSystemID) &&
    !structureState.hasStructureGmBypass(session);
  if (assetSafetyDisabled) {
    return {
      success: false,
      errorMsg: "ASSET_SAFETY_DISABLED",
    };
  }

  return createWrapFromItems(
    "corp",
    corpID,
    structure,
    listTopLevelStructureItems(corpID, structure.structureID),
    options,
  );
}

function handleStructureDestroyed(structure, options = {}) {
  if (!structure || normalizePositiveInt(structure.structureID, 0) <= 0) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }

  const structureState = require(path.join(__dirname, "./structureState"));
  const bypass = structureState.hasStructureGmBypass(options.session);
  const assetSafetyDisabled = (
    isAssetSafetyDisabledSolarSystem(structure.solarSystemID) ||
    Number(structure.upkeepState || 0) === STRUCTURE_UPKEEP_STATE.ABANDONED
  ) && !bypass;
  if (assetSafetyDisabled) {
    log.warn(
      `[StructureAssetSafety] Asset safety is disabled for destroyed structure ${structure.structureID}; structure contents must be handled by the destruction-loot path instead.`,
    );
    return {
      success: false,
      errorMsg: "ASSET_SAFETY_DISABLED",
    };
  }

  const ownerIDs = new Set();
  for (const item of listContainerItems(null, structure.structureID, null)) {
    ownerIDs.add(normalizePositiveInt(item && item.ownerID, 0));
  }

  const createdWraps = [];
  for (const ownerID of ownerIDs) {
    if (!ownerID) {
      continue;
    }
    const ownerKind =
      ownerID >= 140000000 && ownerID < 200000000
        ? "char"
        : "corp";
    const wrapResult = createWrapFromItems(
      ownerKind,
      ownerID,
      structure,
      listTopLevelStructureItems(ownerID, structure.structureID),
      {
        nowMs: options.nowMs,
      },
    );
    if (!wrapResult.success) {
      log.warn(
        `[StructureAssetSafety] Failed to create ${ownerKind} wrap for owner ${ownerID} on structure ${structure.structureID}: ${wrapResult.errorMsg}`,
      );
      continue;
    }
    if (wrapResult.data && wrapResult.data.createdWrap) {
      createdWraps.push(wrapResult.data.createdWrap);
    }
  }

  return {
    success: true,
    data: {
      createdWraps,
    },
  };
}

function getDeliveryTargetsForSession(session, solarSystemID) {
  const structureState = require(path.join(__dirname, "./structureState"));
  const numericSystemID = normalizePositiveInt(solarSystemID, 0);
  const structures = structureState.listDockableStructuresForCharacter(session, {
    solarSystemID: numericSystemID,
  }).map((structure) => ({
    itemID: structure.structureID,
    typeID: structure.typeID,
    solarSystemID: structure.solarSystemID,
    itemName: structure.itemName || structure.name || `Structure ${structure.structureID}`,
  }));
  return {
    structures,
    nearestNPCStationInfo: getFallbackNpcStationInfo(numericSystemID),
  };
}

function shiftWrapEjectTimeGM(assetWrapID, daysDelta) {
  const normalizedDays = Number(daysDelta) || 0;
  return updateWrap(assetWrapID, (current) => ({
    ...current,
    ejectTimeMs: normalizeTimestampMs(current.ejectTimeMs, Date.now()) + Math.round(normalizedDays * DAY_MS),
  }));
}

module.exports = {
  STRUCTURE_ASSET_SAFETY_TABLE,
  ASSET_SAFETY_FLAG_ID,
  ASSET_SAFETY_WRAP_TYPE_ID,
  DAYS_UNTIL_CAN_DELIVER,
  DAYS_UNTIL_AUTO_MOVE,
  listWraps,
  getWrapByID,
  getWrapNames,
  listWrapsForOwner,
  movePersonalAssetsToSafety,
  moveCorporationAssetsToSafety,
  getDeliveryTargetsForSession,
  deliverWrapToDestination,
  shiftWrapEjectTimeGM,
  tickAssetSafetyWraps,
  handleStructureDestroyed,
  isAssetSafetyDisabledSolarSystem,
};
