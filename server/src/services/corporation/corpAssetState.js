const path = require("path");

const worldData = require(path.join(__dirname, "../../space/worldData"));
const {
  buildKeyVal,
  buildList,
  buildRowset,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getItemMetadata,
  getItemMutationVersion,
  listOwnedItems,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  getCorporationOffices,
} = require(path.join(__dirname, "./corporationRuntimeState"));
const {
  getStructureByID,
} = require(path.join(__dirname, "../structure/structureState"));
const {
  ASSET_SAFETY_WRAP_TYPE_ID,
  listWrapsForOwner,
} = require(path.join(__dirname, "../structure/structureAssetSafetyState"));

const FLAG_ASSET_SAFETY = 36;
const FLAG_CORP_DELIVERIES = 62;
const FLAG_CAPSULEER_DELIVERIES = 187;
const ASSET_BUCKETS = Object.freeze([
  "offices",
  "impounded",
  "property",
  "deliveries",
  "capsuleerdeliveries",
  "assetwraps",
]);
const ITEM_ROWSET_HEADER = [
  "itemID",
  "typeID",
  "ownerID",
  "locationID",
  "flagID",
  "quantity",
  "groupID",
  "categoryID",
  "customInfo",
  "stacksize",
  "singleton",
];
const assetSnapshotCacheByCorporationID = new Map();

function toInt(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.trunc(numericValue);
}

function normalizeWhich(which) {
  const value = String(which || "offices").trim().toLowerCase();
  return ASSET_BUCKETS.includes(value) ? value : "offices";
}

function createBucketMaps() {
  return Object.fromEntries(ASSET_BUCKETS.map((bucket) => [bucket, new Map()]));
}

function getLocationInfo(locationID) {
  const numericLocationID = toInt(locationID, 0);
  if (numericLocationID <= 0) {
    return null;
  }

  const station = worldData.getStationByID(numericLocationID);
  if (station) {
    return {
      locationID: numericLocationID,
      solarSystemID: toInt(station.solarSystemID, 0),
      typeID: toInt(station.stationTypeID, 0) || null,
    };
  }

  const structure = getStructureByID(numericLocationID);
  if (structure) {
    return {
      locationID: numericLocationID,
      solarSystemID: toInt(structure.solarSystemID, 0),
      typeID: toInt(structure.typeID, 0) || null,
    };
  }

  const solarSystem = worldData.getSolarSystemByID(numericLocationID);
  if (solarSystem) {
    return {
      locationID: numericLocationID,
      solarSystemID: numericLocationID,
      typeID: null,
    };
  }

  return null;
}

function ensureLocationRecord(bucketLocations, bucket, locationInfo) {
  const bucketMap = bucketLocations[bucket];
  if (!bucketMap.has(locationInfo.locationID)) {
    bucketMap.set(locationInfo.locationID, {
      locationID: locationInfo.locationID,
      solarSystemID: locationInfo.solarSystemID || null,
      typeID: locationInfo.typeID || null,
      itemCount: 0,
    });
  }
  return bucketMap.get(locationInfo.locationID);
}

function buildItemPayload(item) {
  const metadata = getItemMetadata(item && item.typeID, item && item.itemName);
  const singleton = toInt(item && item.singleton, 0);
  const quantity =
    singleton === 2
      ? -2
      : singleton === 1
        ? -1
      : toInt(item && item.quantity, toInt(item && item.stacksize, 0));
  return {
    itemID: toInt(item && item.itemID, 0),
    typeID: toInt(item && item.typeID, 0),
    ownerID: toInt(item && item.ownerID, 0),
    locationID: toInt(item && item.locationID, 0),
    flagID: toInt(item && item.flagID, 0),
    quantity,
    groupID: toInt(item && item.groupID, toInt(metadata && metadata.groupID, 0)),
    categoryID: toInt(
      item && item.categoryID,
      toInt(metadata && metadata.categoryID, 0),
    ),
    customInfo: String((item && item.customInfo) || ""),
    stacksize: toInt(item && item.stacksize, toInt(item && item.quantity, 0)),
    singleton,
  };
}

function buildWrapPseudoItem(corporationID, wrap, locationID) {
  const metadata = getItemMetadata(ASSET_SAFETY_WRAP_TYPE_ID, wrap && wrap.wrapName);
  return {
    itemID: toInt(wrap && wrap.assetWrapID, 0),
    typeID: ASSET_SAFETY_WRAP_TYPE_ID,
    ownerID: toInt(corporationID, 0),
    locationID: toInt(locationID, 0),
    flagID: FLAG_ASSET_SAFETY,
    quantity: -1,
    groupID: toInt(metadata && metadata.groupID, 0),
    categoryID: toInt(metadata && metadata.categoryID, 0),
    customInfo: String((wrap && wrap.wrapName) || ""),
    stacksize: 1,
    singleton: 1,
  };
}

function resolveRootLocation(item, itemByID, officeByKnownLocationID) {
  const visited = new Set();
  let current = item;
  while (current) {
    const locationID = toInt(current && current.locationID, 0);
    if (locationID <= 0 || visited.has(locationID)) {
      return null;
    }
    visited.add(locationID);

    const office = officeByKnownLocationID.get(locationID) || null;
    if (office) {
      return {
        kind: "office",
        office,
        locationInfo: {
          locationID: toInt(office.stationID, 0),
          solarSystemID: toInt(office.solarSystemID, 0) || null,
          typeID: toInt(office.typeID, 0) || null,
        },
      };
    }

    const locationInfo = getLocationInfo(locationID);
    if (locationInfo) {
      return {
        kind: "location",
        locationInfo,
      };
    }

    current = itemByID.get(locationID) || null;
  }

  return null;
}

function buildCorporationAssetSnapshot(corporationID) {
  const numericCorporationID = toInt(corporationID, 0);
  const offices = getCorporationOffices(numericCorporationID);
  const officeSignature = offices
    .map((office) =>
      [
        toInt(office && office.officeID, 0),
        toInt(office && office.stationID, 0),
        office && office.impounded ? 1 : 0,
      ].join(":"),
    )
    .join("|");
  const wraps = listWrapsForOwner("corp", numericCorporationID);
  const wrapSignature = wraps
    .map((wrap) =>
      [
        toInt(wrap && wrap.assetWrapID, 0),
        toInt(wrap && wrap.destinationID, 0),
        toInt(wrap && wrap.solarSystemID, 0),
      ].join(":"),
    )
    .join("|");
  const snapshotSignature = `${getItemMutationVersion()}|${officeSignature}|${wrapSignature}`;
  const cachedSnapshot = assetSnapshotCacheByCorporationID.get(numericCorporationID);
  if (cachedSnapshot && cachedSnapshot.signature === snapshotSignature) {
    return cachedSnapshot.snapshot;
  }

  const bucketLocations = createBucketMaps();
  const bucketItems = createBucketMaps();
  const officeByKnownLocationID = new Map();
  for (const office of offices) {
    for (const locationID of [
      toInt(office.officeID, 0),
      toInt(office.officeFolderID, 0),
      toInt(office.itemID, 0),
    ]) {
      if (locationID > 0) {
        officeByKnownLocationID.set(locationID, office);
      }
    }
  }
  const officeStationIDs = new Set(
    offices.map((office) => toInt(office.stationID, 0)).filter(Boolean),
  );
  const items = listOwnedItems(numericCorporationID);
  const itemByID = new Map(
    items.map((item) => [toInt(item && item.itemID, 0), item]).filter(([itemID]) => itemID > 0),
  );

  for (const office of offices) {
    const bucket = office.impounded ? "impounded" : "offices";
    ensureLocationRecord(bucketLocations, bucket, {
      locationID: toInt(office.stationID, 0),
      solarSystemID: toInt(office.solarSystemID, 0) || null,
      typeID: toInt(office.typeID, 0) || null,
    });
  }

  for (const item of items) {
    if (toInt(item && item.flagID, 0) === FLAG_ASSET_SAFETY) {
      continue;
    }

    const root = resolveRootLocation(item, itemByID, officeByKnownLocationID);
    if (!root || !root.locationInfo) {
      continue;
    }

    let bucket = "property";
    if (root.kind === "office") {
      bucket = root.office && root.office.impounded ? "impounded" : "offices";
    } else {
      const flagID = toInt(item && item.flagID, 0);
      if (flagID === FLAG_CORP_DELIVERIES) {
        bucket = "deliveries";
      } else if (flagID === FLAG_CAPSULEER_DELIVERIES) {
        bucket = "capsuleerdeliveries";
      } else if (
        officeStationIDs.has(toInt(root.locationInfo.locationID, 0)) &&
        (flagID === FLAG_CORP_DELIVERIES || flagID === FLAG_CAPSULEER_DELIVERIES)
      ) {
        bucket = flagID === FLAG_CORP_DELIVERIES ? "deliveries" : "capsuleerdeliveries";
      }
    }

    const payload = buildItemPayload(item);
    ensureLocationRecord(bucketLocations, bucket, root.locationInfo).itemCount += 1;
    if (!bucketItems[bucket].has(root.locationInfo.locationID)) {
      bucketItems[bucket].set(root.locationInfo.locationID, []);
    }
    bucketItems[bucket].get(root.locationInfo.locationID).push(payload);
  }

  for (const wrap of wraps) {
    const locationID = toInt(wrap && (wrap.destinationID || wrap.solarSystemID), 0);
    const locationInfo = getLocationInfo(locationID);
    if (!locationInfo) {
      continue;
    }
    const payload = buildWrapPseudoItem(numericCorporationID, wrap, locationID);
    ensureLocationRecord(bucketLocations, "assetwraps", locationInfo).itemCount += 1;
    if (!bucketItems.assetwraps.has(locationID)) {
      bucketItems.assetwraps.set(locationID, []);
    }
    bucketItems.assetwraps.get(locationID).push(payload);
  }

  const sortedLocations = Object.fromEntries(
    ASSET_BUCKETS.map((bucket) => [
      bucket,
      [...bucketLocations[bucket].values()].sort(
        (left, right) =>
          toInt(left.solarSystemID, 0) - toInt(right.solarSystemID, 0) ||
          toInt(left.locationID, 0) - toInt(right.locationID, 0),
      ),
    ]),
  );
  const sortedItems = Object.fromEntries(
    ASSET_BUCKETS.map((bucket) => [
      bucket,
      new Map(
        [...bucketItems[bucket].entries()].map(([locationID, bucketLocationItems]) => [
          locationID,
          [...bucketLocationItems].sort(
            (left, right) =>
              toInt(left.flagID, 0) - toInt(right.flagID, 0) ||
              toInt(left.typeID, 0) - toInt(right.typeID, 0) ||
              toInt(left.itemID, 0) - toInt(right.itemID, 0),
          ),
        ]),
      ),
    ]),
  );

  const snapshot = {
    locations: sortedLocations,
    items: sortedItems,
  };
  assetSnapshotCacheByCorporationID.set(numericCorporationID, {
    signature: snapshotSignature,
    snapshot,
  });
  return snapshot;
}

function buildLocationList(locations = []) {
  return buildList(
    locations.map((location) =>
      buildKeyVal([
        ["locationID", toInt(location && location.locationID, 0)],
        ["solarsystemID", location && location.solarSystemID ? toInt(location.solarSystemID, 0) : null],
        ["typeID", location && location.typeID ? toInt(location.typeID, 0) : null],
        ["itemCount", toInt(location && location.itemCount, 0)],
      ]),
    ),
  );
}

function buildAssetItemRowset(items = []) {
  return buildRowset(
    ITEM_ROWSET_HEADER,
    items.map((item) =>
      buildList([
        toInt(item && item.itemID, 0),
        toInt(item && item.typeID, 0),
        toInt(item && item.ownerID, 0),
        toInt(item && item.locationID, 0),
        toInt(item && item.flagID, 0),
        toInt(item && item.quantity, 0),
        toInt(item && item.groupID, 0),
        toInt(item && item.categoryID, 0),
        String((item && item.customInfo) || ""),
        toInt(item && item.stacksize, 0),
        toInt(item && item.singleton, 0),
      ]),
    ),
    "eve.common.script.sys.rowset.Rowset",
  );
}

function listAssetLocations(corporationID, which) {
  const bucket = normalizeWhich(which);
  const snapshot = buildCorporationAssetSnapshot(corporationID);
  return snapshot.locations[bucket] || [];
}

function listAssetItemsForLocation(corporationID, locationID, which) {
  const bucket = normalizeWhich(which);
  const snapshot = buildCorporationAssetSnapshot(corporationID);
  return snapshot.items[bucket].get(toInt(locationID, 0)) || [];
}

function matchesFilters(item, filters = {}) {
  const categoryID = toInt(filters.categoryID, 0);
  const groupID = toInt(filters.groupID, 0);
  const typeID = toInt(filters.typeID, 0);
  const minimumQuantity = toInt(filters.minimumQuantity, 0);

  if (categoryID > 0 && toInt(item && item.categoryID, 0) !== categoryID) {
    return false;
  }
  if (groupID > 0 && toInt(item && item.groupID, 0) !== groupID) {
    return false;
  }
  if (typeID > 0 && toInt(item && item.typeID, 0) !== typeID) {
    return false;
  }
  if (minimumQuantity > 0 && toInt(item && item.stacksize, 0) < minimumQuantity) {
    return false;
  }
  return true;
}

function searchAssetLocations(corporationID, which, filters = {}) {
  const bucket = normalizeWhich(which);
  const snapshot = buildCorporationAssetSnapshot(corporationID);
  const itemsByLocation = snapshot.items[bucket];
  return (snapshot.locations[bucket] || []).filter((location) => {
    const items = itemsByLocation.get(toInt(location && location.locationID, 0)) || [];
    return items.some((item) => matchesFilters(item, filters));
  });
}

module.exports = {
  buildAssetItemRowset,
  buildLocationList,
  listAssetItemsForLocation,
  listAssetLocations,
  searchAssetLocations,
};
