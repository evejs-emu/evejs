const path = require("path");

const config = require(path.join(__dirname, "../../config"));
const log = require(path.join(__dirname, "../../utils/logger"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const {
  buildRowset,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  listCharacterItems,
  getItemMetadata,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  buildDockableAssetLocationMetadata,
  isHiddenPersonalAssetLocation,
} = require(path.join(__dirname, "../inventory/inventoryVisibilityRules"));

const CONTAINER_GLOBAL_ID = 10002;
const FLAG_WALLET = 1;
const FLAG_HANGAR = 4;
const FLAG_ASSET_SAFETY = 36;
const CATEGORY_BLUEPRINT_ID = 9;
const TYPE_PLEX = 44992;
const MAX_SNAPSHOT_CACHE_SIZE = 64;
const STATION_ROWSET_HEADER = [
  "stationID",
  "typeID",
  "stationTypeID",
  "solarSystemID",
  "constellationID",
  "regionID",
  "itemCount",
  "upkeepState",
];
const INVENTORY_ROW_DESCRIPTOR_COLUMNS = [
  ["itemID", 20],
  ["typeID", 3],
  ["ownerID", 3],
  ["locationID", 20],
  ["flagID", 2],
  ["quantity", 3],
  ["groupID", 3],
  ["categoryID", 3],
  ["customInfo", 129],
  ["singleton", 2],
  ["stacksize", 3],
];

function toInteger(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.trunc(numericValue);
}

function roundIsk(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function normalizeMethodName(value) {
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  return String(value || "");
}

function normalizeCallArgs(value) {
  return Array.isArray(value) ? value : [value];
}

function isDockableAssetFlag(flagID) {
  const numericFlagID = toInteger(flagID, 0);
  return (
    numericFlagID === FLAG_WALLET ||
    numericFlagID === FLAG_HANGAR ||
    numericFlagID === FLAG_ASSET_SAFETY
  );
}

class CharMgrGlobalAssets {
  constructor() {
    this._boundContexts = new Map();
    this._assetSnapshots = new Map();
  }

  _getSessionCharacterId(session) {
    return toInteger(
      session && (session.characterID || session.charid || session.userid),
      0,
    );
  }

  _parseBindContext(bindParams, session) {
    const params = Array.isArray(bindParams) ? bindParams : [bindParams];
    if (params.length < 2) {
      return null;
    }

    const charID = toInteger(params[0], this._getSessionCharacterId(session));
    const containerID = toInteger(params[1], 0);
    if (charID <= 0 || containerID !== CONTAINER_GLOBAL_ID) {
      return null;
    }

    return {
      kind: "globalAssets",
      charID,
      containerID,
    };
  }

  _rememberBoundContext(oidString, context) {
    if (!oidString || !context) {
      return;
    }

    this._boundContexts.set(oidString, {
      kind: context.kind || "globalAssets",
      charID: toInteger(context.charID, 0),
      containerID: toInteger(context.containerID, CONTAINER_GLOBAL_ID),
    });
  }

  _getBoundContext(session) {
    if (!session || !session.currentBoundObjectID) {
      return null;
    }

    return this._boundContexts.get(session.currentBoundObjectID) || null;
  }

  _getResolvedCharacterId(session) {
    const boundContext = this._getBoundContext(session);
    if (boundContext && boundContext.kind === "globalAssets" && boundContext.charID > 0) {
      return boundContext.charID;
    }

    return this._getSessionCharacterId(session);
  }

  _buildSessionContextKey(session) {
    return [
      toInteger(session && (session.stationid || session.stationID || session.locationid), 0),
      toInteger(session && (session.solarsystemid2 || session.solarsystemid), 0),
      toInteger(session && (session.constellationid || session.constellationID), 0),
      toInteger(session && (session.regionid || session.regionID), 0),
      toInteger(session && session.structureTypeID, 0),
    ].join(":");
  }

  _buildAssetSnapshotCacheKey(session, charID) {
    return `${toInteger(charID, 0)}|${this._buildSessionContextKey(session)}`;
  }

  _buildAssetSnapshotSignature(items) {
    if (!Array.isArray(items) || items.length === 0) {
      return "0";
    }

    return items
      .map((item) => [
        toInteger(item && item.itemID, 0),
        toInteger(item && item.ownerID, 0),
        toInteger(item && item.locationID, 0),
        toInteger(item && item.flagID, 0),
        toInteger(item && item.typeID, 0),
        toInteger(item && item.categoryID, 0),
        toInteger(item && item.singleton, 0),
        toInteger(item && item.stacksize, toInteger(item && item.quantity, 0)),
        toInteger(item && item.quantity, 0),
      ].join(":"))
      .join("|");
  }

  _getCachedAssetSnapshot(cacheKey, signature) {
    if (!cacheKey || !signature) {
      return null;
    }

    const cachedEntry = this._assetSnapshots.get(cacheKey) || null;
    if (!cachedEntry || cachedEntry.signature !== signature) {
      return null;
    }

    this._assetSnapshots.delete(cacheKey);
    this._assetSnapshots.set(cacheKey, cachedEntry);
    return cachedEntry.snapshot;
  }

  _rememberAssetSnapshot(cacheKey, signature, snapshot) {
    if (!cacheKey || !signature || !snapshot) {
      return snapshot;
    }

    if (this._assetSnapshots.has(cacheKey)) {
      this._assetSnapshots.delete(cacheKey);
    }

    this._assetSnapshots.set(cacheKey, {
      signature,
      snapshot,
    });

    while (this._assetSnapshots.size > MAX_SNAPSHOT_CACHE_SIZE) {
      const oldestCacheKey = this._assetSnapshots.keys().next().value;
      if (!oldestCacheKey) {
        break;
      }
      this._assetSnapshots.delete(oldestCacheKey);
    }

    return snapshot;
  }

  _buildInventoryPackedRow(item) {
    return {
      type: "packedrow",
      header: {
        type: "objectex1",
        header: [
          { type: "token", value: "blue.DBRowDescriptor" },
          [INVENTORY_ROW_DESCRIPTOR_COLUMNS],
        ],
        list: [],
        dict: [],
      },
      columns: INVENTORY_ROW_DESCRIPTOR_COLUMNS,
      fields: {
        itemID: toInteger(item.itemID, 0),
        typeID: toInteger(item.typeID, 0),
        ownerID: toInteger(item.ownerID, 0),
        locationID: toInteger(item.locationID, 0),
        flagID: toInteger(item.flagID, 0),
        quantity: toInteger(item.quantity, 0),
        groupID: toInteger(item.groupID, 0),
        categoryID: toInteger(item.categoryID, 0),
        customInfo: String(item.customInfo || ""),
        singleton: toInteger(item.singleton, 0),
        stacksize: toInteger(item.stacksize, 0),
      },
    };
  }

  _buildPackedItemList(items) {
    return {
      type: "list",
      items: items.map((item) => this._buildInventoryPackedRow(item)),
    };
  }

  _isVisibleAssetItem(item) {
    return Boolean(item) && toInteger(item.stacksize, 0) !== 0;
  }

  _buildDockableLocation(locationID, session, dockableLocationByContext = null) {
    const numericLocationID = toInteger(locationID, 0);
    const cacheKey = `${numericLocationID}|${this._buildSessionContextKey(session)}`;

    if (
      dockableLocationByContext instanceof Map &&
      dockableLocationByContext.has(cacheKey)
    ) {
      return dockableLocationByContext.get(cacheKey) || null;
    }

    const location = buildDockableAssetLocationMetadata(locationID, session);

    if (dockableLocationByContext instanceof Map) {
      dockableLocationByContext.set(cacheKey, location);
    }

    return location;
  }

  _resolveRootLocation(item, itemById, session, caches = {}) {
    if (!item || typeof item !== "object") {
      return null;
    }

    const itemID = toInteger(item.itemID, 0);
    const rootLocationByItemID =
      caches.rootLocationByItemID instanceof Map ? caches.rootLocationByItemID : null;
    if (rootLocationByItemID && rootLocationByItemID.has(itemID)) {
      return rootLocationByItemID.get(itemID) || null;
    }

    const visitedLocationIDs = new Set();
    const traversedItemIDs = [];
    let currentItem = item;
    let resolvedRootLocation = null;

    while (currentItem) {
      const currentItemID = toInteger(currentItem.itemID, 0);
      if (rootLocationByItemID && rootLocationByItemID.has(currentItemID)) {
        resolvedRootLocation = rootLocationByItemID.get(currentItemID) || null;
        break;
      }
      if (currentItemID > 0) {
        traversedItemIDs.push(currentItemID);
      }

      const locationID = toInteger(currentItem.locationID, 0);
      if (locationID <= 0) {
        resolvedRootLocation = null;
        break;
      }

      if (worldData.getStationByID(locationID) || worldData.getStructureByID(locationID)) {
        resolvedRootLocation = this._buildDockableLocation(
          locationID,
          session,
          caches.dockableLocationByContext,
        );
        break;
      }

      if (visitedLocationIDs.has(locationID)) {
        resolvedRootLocation = null;
        break;
      }
      visitedLocationIDs.add(locationID);

      const parentItem = itemById.get(locationID) || null;
      if (!parentItem) {
        if (
          isDockableAssetFlag(currentItem.flagID) &&
          !isHiddenPersonalAssetLocation(locationID, session)
        ) {
          resolvedRootLocation = this._buildDockableLocation(
            locationID,
            session,
            caches.dockableLocationByContext,
          );
        }
        break;
      }

      currentItem = parentItem;
    }

    if (rootLocationByItemID) {
      for (const traversedItemID of traversedItemIDs) {
        rootLocationByItemID.set(traversedItemID, resolvedRootLocation);
      }
    }

    return resolvedRootLocation;
  }

  _buildAssetSnapshot(session) {
    const charID = this._getResolvedCharacterId(session);
    if (charID <= 0) {
      return {
        charID: 0,
        allEntries: [],
        topLevelEntries: [],
      };
    }

    const items = listCharacterItems(charID);
    const cacheKey = this._buildAssetSnapshotCacheKey(session, charID);
    const signature = this._buildAssetSnapshotSignature(items);
    const cachedSnapshot = this._getCachedAssetSnapshot(cacheKey, signature);
    if (cachedSnapshot) {
      return cachedSnapshot;
    }

    const itemById = new Map(
      items.map((item) => [toInteger(item && item.itemID, 0), item]).filter(
        ([itemID]) => itemID > 0,
      ),
    );
    const allEntries = [];
    const caches = {
      rootLocationByItemID: new Map(),
      dockableLocationByContext: new Map(),
    };

    for (const item of items) {
      const rootLocation = this._resolveRootLocation(item, itemById, session, caches);
      if (!rootLocation) {
        continue;
      }

      allEntries.push({
        item,
        rootLocation,
        isTopLevel: toInteger(item.locationID, 0) === rootLocation.locationID,
      });
    }

    return this._rememberAssetSnapshot(cacheKey, signature, {
      charID,
      allEntries,
      topLevelEntries: allEntries.filter((entry) => entry.isTopLevel),
    });
  }

  _buildStationRows(topLevelEntries) {
    const rowsByStationID = new Map();

    for (const entry of topLevelEntries) {
      if (!this._isVisibleAssetItem(entry && entry.item)) {
        continue;
      }

      const stationID = toInteger(entry.rootLocation && entry.rootLocation.stationID, 0);
      if (stationID <= 0) {
        continue;
      }

      if (!rowsByStationID.has(stationID)) {
        rowsByStationID.set(stationID, {
          ...entry.rootLocation,
          itemCount: 0,
        });
      }

      rowsByStationID.get(stationID).itemCount += 1;
    }

    return [...rowsByStationID.values()]
      .sort(
        (left, right) =>
          toInteger(left.solarSystemID, 0) - toInteger(right.solarSystemID, 0) ||
          toInteger(left.stationID, 0) - toInteger(right.stationID, 0),
      )
      .map((row) => [
        toInteger(row.stationID, 0),
        row.typeID === null ? null : toInteger(row.typeID, 0),
        row.stationTypeID === null ? null : toInteger(row.stationTypeID, 0),
        toInteger(row.solarSystemID, 0),
        toInteger(row.constellationID, 0),
        toInteger(row.regionID, 0),
        toInteger(row.itemCount, 0),
        row.upkeepState === undefined ? null : row.upkeepState,
      ]);
  }

  _calculateItemUnits(item) {
    if (!item || typeof item !== "object") {
      return 0;
    }

    if (toInteger(item.singleton, 0) === 1) {
      return 1;
    }

    return Math.max(
      0,
      toInteger(item.stacksize, toInteger(item.quantity, 0)),
    );
  }

  _resolvePlexUnitPrice() {
    const metadata = getItemMetadata(TYPE_PLEX, "PLEX");
    const basePrice = Number(metadata && metadata.basePrice);
    return Number.isFinite(basePrice) && basePrice > 0 ? basePrice : 0;
  }

  Handle_MachoResolveObject(args, session, _kwargs) {
    const bindParams = Array.isArray(args) && args.length > 0 ? args[0] : args;
    const context = this._parseBindContext(bindParams, session);
    if (!context) {
      return null;
    }

    log.debug(
      `[CharMgrGlobalAssets] MachoResolveObject char=${context.charID} container=${context.containerID}`,
    );
    return config.proxyNodeId;
  }

  async Handle_MachoBindObject(args, session, kwargs, invokeNestedCall) {
    const bindParams = Array.isArray(args) && args.length > 0 ? args[0] : null;
    const nestedCall = Array.isArray(args) && args.length > 1 ? args[1] : null;
    const context = this._parseBindContext(bindParams, session);
    if (!context) {
      return null;
    }

    const boundId = config.getNextBoundId();
    const idString = `N=${config.proxyNodeId}:${boundId}`;
    const oid = [
      idString,
      BigInt(Date.now()) * 10000n + 116444736000000000n,
    ];

    this._rememberBoundContext(idString, context);

    if (session) {
      if (!session._boundObjectIDs || typeof session._boundObjectIDs !== "object") {
        session._boundObjectIDs = {};
      }
      session._boundObjectIDs.charMgr = idString;
      session.lastBoundObjectID = idString;
    }

    let callResult = null;
    if (
      typeof invokeNestedCall === "function" &&
      Array.isArray(nestedCall) &&
      nestedCall.length >= 1
    ) {
      const methodName = normalizeMethodName(nestedCall[0]);
      const callArgs = nestedCall.length > 1 ? nestedCall[1] : [];
      const callKwargs = nestedCall.length > 2 ? nestedCall[2] : null;
      callResult = await invokeNestedCall(
        idString,
        methodName,
        normalizeCallArgs(callArgs),
        callKwargs,
      );
    }

    log.debug(
      `[CharMgrGlobalAssets] MachoBindObject char=${context.charID} bound=${idString} nested=${Array.isArray(nestedCall) && nestedCall.length ? normalizeMethodName(nestedCall[0]) : "none"} kwargs=${kwargs ? "yes" : "no"}`,
    );

    return [
      {
        type: "substruct",
        value: {
          type: "substream",
          value: oid,
        },
      },
      callResult != null ? callResult : null,
    ];
  }

  Handle_ListStations(_args, session) {
    const snapshot = this._buildAssetSnapshot(session);
    return buildRowset(
      STATION_ROWSET_HEADER,
      this._buildStationRows(snapshot.topLevelEntries),
      "eve.common.script.sys.rowset.Rowset",
    );
  }

  Handle_ListStationItems(args, session) {
    const locationID = toInteger(Array.isArray(args) && args.length > 0 ? args[0] : 0, 0);
    const snapshot = this._buildAssetSnapshot(session);
    const items = snapshot.topLevelEntries
      .filter(
        (entry) =>
          toInteger(entry.rootLocation && entry.rootLocation.stationID, 0) === locationID &&
          this._isVisibleAssetItem(entry.item),
      )
      .map((entry) => entry.item);

    return this._buildPackedItemList(items);
  }

  Handle_List(_args, session) {
    const snapshot = this._buildAssetSnapshot(session);
    const items = snapshot.topLevelEntries
      .filter((entry) => this._isVisibleAssetItem(entry.item))
      .map((entry) => entry.item);

    return this._buildPackedItemList(items);
  }

  Handle_ListIncludingContainers(_args, session) {
    const snapshot = this._buildAssetSnapshot(session);
    const items = snapshot.allEntries
      .filter((entry) => this._isVisibleAssetItem(entry.item))
      .map((entry) => entry.item);

    return this._buildPackedItemList(items);
  }

  Handle_GetAssetWorth(_args, session) {
    const snapshot = this._buildAssetSnapshot(session);
    const plexUnitPrice = this._resolvePlexUnitPrice();
    let assetWorth = 0;
    let plexWorth = 0;

    for (const entry of snapshot.allEntries) {
      const item = entry.item;
      if (!this._isVisibleAssetItem(item)) {
        continue;
      }

      const units = this._calculateItemUnits(item);
      if (units <= 0) {
        continue;
      }

      const typeID = toInteger(item.typeID, 0);
      if (typeID === TYPE_PLEX) {
        plexWorth += plexUnitPrice * units;
        continue;
      }

      if (toInteger(item.categoryID, 0) === CATEGORY_BLUEPRINT_ID) {
        continue;
      }

      const metadata = getItemMetadata(typeID, item.itemName || null);
      const basePrice = Number(metadata && metadata.basePrice);
      if (!Number.isFinite(basePrice) || basePrice <= 0) {
        continue;
      }

      assetWorth += basePrice * units;
    }

    return [roundIsk(assetWorth), roundIsk(plexWorth)];
  }
}

module.exports = {
  CharMgrGlobalAssets,
  CONTAINER_GLOBAL_ID,
};
