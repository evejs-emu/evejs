const crypto = require("crypto");
const path = require("path");

const {
  ITEM_FLAGS,
  findItemById,
  listContainerItems,
  moveItemToLocation,
  removeInventoryItem,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  resolveInventoryItemQuantity,
} = require(path.join(__dirname, "./killmailItemPayload"));

const ROOT_LOOT_FLAG_ID = ITEM_FLAGS.HANGAR;
const RIG_FLAG_MIN = 92;
const RIG_FLAG_MAX = 99;
const SUBSYSTEM_FLAG_MIN = 125;
const SUBSYSTEM_FLAG_MAX = 132;

function toInt(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.trunc(numericValue);
}

function toPositiveInt(value, fallback = null) {
  const numericValue = toInt(value, 0);
  return numericValue > 0 ? numericValue : fallback;
}

function cloneValue(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function isAlwaysDestroyedFlag(flagID) {
  const numericFlagID = toInt(flagID, 0);
  return (
    (numericFlagID >= RIG_FLAG_MIN && numericFlagID <= RIG_FLAG_MAX) ||
    (numericFlagID >= SUBSYSTEM_FLAG_MIN && numericFlagID <= SUBSYSTEM_FLAG_MAX)
  );
}

function buildSnapshotNode(item) {
  return {
    itemID: toPositiveInt(item && item.itemID, null),
    typeID: toPositiveInt(item && item.typeID, null),
    flag: toInt(item && item.flagID, 0),
    singleton: toInt(item && item.singleton, 0),
    quantity: Math.max(1, resolveInventoryItemQuantity(item)),
    children: listContainerItems(null, toPositiveInt(item && item.itemID, 0), null)
      .slice()
      .sort((left, right) => (Number(left.itemID) || 0) - (Number(right.itemID) || 0))
      .map((child) => buildSnapshotNode(child)),
  };
}

function buildSnapshotTree(locationID) {
  return listContainerItems(null, toPositiveInt(locationID, 0), null)
    .slice()
    .sort((left, right) => (Number(left.itemID) || 0) - (Number(right.itemID) || 0))
    .map((item) => buildSnapshotNode(item));
}

function hashToDrop(seed, itemID, unitIndex) {
  const digest = crypto
    .createHash("sha1")
    .update(`${String(seed)}:${Number(itemID) || 0}:${Number(unitIndex) || 0}`, "utf8")
    .digest();
  return (digest.readUInt32BE(0) / 0xffffffff) < 0.5;
}

function resolveStackDropCounts(snapshot, seed, options = {}) {
  const quantity = Math.max(1, toInt(snapshot && snapshot.quantity, 1));
  if (options.forceAllDestroyed === true || isAlwaysDestroyedFlag(snapshot && snapshot.flag)) {
    return {
      qtyDropped: 0,
      qtyDestroyed: quantity,
    };
  }
  if (options.forceAllDropped === true) {
    return {
      qtyDropped: quantity,
      qtyDestroyed: 0,
    };
  }

  let qtyDropped = 0;
  for (let unitIndex = 0; unitIndex < quantity; unitIndex += 1) {
    if (hashToDrop(seed, snapshot && snapshot.itemID, unitIndex)) {
      qtyDropped += 1;
    }
  }
  return {
    qtyDropped,
    qtyDestroyed: quantity - qtyDropped,
  };
}

function resolveSnapshotNode(snapshot, seed, options = {}) {
  const quantity = Math.max(1, toInt(snapshot && snapshot.quantity, 1));
  const isSingleton = toInt(snapshot && snapshot.singleton, 0) === 1 || quantity === 1;
  const stackResolution = resolveStackDropCounts(snapshot, seed, options);
  const childResolutions = (Array.isArray(snapshot && snapshot.children) ? snapshot.children : [])
    .map((child) => resolveSnapshotNode(child, seed, options));

  if (!isSingleton) {
    return {
      ...snapshot,
      qtyDropped: stackResolution.qtyDropped,
      qtyDestroyed: stackResolution.qtyDestroyed,
      children: [],
      resolvedChildren: childResolutions,
    };
  }

  const dropped =
    options.forceAllDestroyed === true || isAlwaysDestroyedFlag(snapshot && snapshot.flag)
      ? 0
      : options.forceAllDropped === true
        ? 1
        : (hashToDrop(seed, snapshot && snapshot.itemID, 0) ? 1 : 0);
  return {
    ...snapshot,
    qtyDropped: dropped,
    qtyDestroyed: dropped ? 0 : 1,
    children: childResolutions,
  };
}

function buildKillmailNodePayload(resolution) {
  return {
    typeID: toPositiveInt(resolution && resolution.typeID, null),
    flag: toInt(resolution && resolution.flag, 0),
    singleton: toInt(resolution && resolution.singleton, 0),
    qtyDropped: Math.max(0, toInt(resolution && resolution.qtyDropped, 0)),
    qtyDestroyed: Math.max(0, toInt(resolution && resolution.qtyDestroyed, 0)),
    contents: (Array.isArray(resolution && resolution.children) ? resolution.children : [])
      .map((child) => buildKillmailNodePayload(child)),
  };
}

function moveResolvedQuantity(itemID, destinationLocationID, quantity) {
  if (!(Number(quantity) > 0) || !(Number(destinationLocationID) > 0)) {
    return [];
  }
  const moveResult = moveItemToLocation(
    itemID,
    destinationLocationID,
    ROOT_LOOT_FLAG_ID,
    quantity,
  );
  if (!moveResult.success || !moveResult.data || !Array.isArray(moveResult.data.changes)) {
    return [];
  }
  return moveResult.data.changes;
}

function removeResolvedItem(itemID) {
  const removeResult = removeInventoryItem(itemID, {
    removeContents: false,
  });
  if (!removeResult.success || !removeResult.data || !Array.isArray(removeResult.data.changes)) {
    return [];
  }
  return removeResult.data.changes;
}

function applyResolvedNode(resolution, rootLootLocationID, parentDropped = false) {
  const movedChanges = [];
  const destroyChanges = [];
  const currentItem = findItemById(resolution && resolution.itemID);
  if (!currentItem) {
    return {
      movedChanges,
      destroyChanges,
    };
  }

  const quantity = Math.max(1, toInt(resolution && resolution.quantity, 1));
  const isSingleton = toInt(resolution && resolution.singleton, 0) === 1 || quantity === 1;

  if (!isSingleton) {
    if (toInt(resolution && resolution.qtyDropped, 0) > 0) {
      movedChanges.push(
        ...moveResolvedQuantity(
          currentItem.itemID,
          rootLootLocationID,
          toInt(resolution.qtyDropped, 0),
        ),
      );
    }
    const remainingItem = findItemById(currentItem.itemID);
    if (remainingItem && toInt(resolution && resolution.qtyDestroyed, 0) > 0) {
      destroyChanges.push(...removeResolvedItem(remainingItem.itemID));
    }
    return {
      movedChanges,
      destroyChanges,
    };
  }

  const itemDropped = toInt(resolution && resolution.qtyDropped, 0) > 0;
  if (itemDropped && !parentDropped && toPositiveInt(rootLootLocationID, null)) {
    movedChanges.push(...moveResolvedQuantity(currentItem.itemID, rootLootLocationID, 1));
  }

  for (const childResolution of Array.isArray(resolution && resolution.children) ? resolution.children : []) {
    const childResult = applyResolvedNode(
      childResolution,
      rootLootLocationID,
      itemDropped,
    );
    movedChanges.push(...childResult.movedChanges);
    destroyChanges.push(...childResult.destroyChanges);
  }

  const refreshedItem = findItemById(currentItem.itemID);
  if (refreshedItem && !itemDropped) {
    destroyChanges.push(...removeResolvedItem(refreshedItem.itemID));
  }

  return {
    movedChanges,
    destroyChanges,
  };
}

function resolveLocationDeathOutcome(locationID, options = {}) {
  const seed = options.seed || `death:${String(locationID || 0)}`;
  const rootLootLocationID =
    options.forceAllDestroyed === true
      ? null
      : toPositiveInt(options.rootLootLocationID, null);
  const snapshotTree = buildSnapshotTree(locationID);
  const resolvedTree = snapshotTree.map((snapshot) =>
    resolveSnapshotNode(snapshot, seed, options),
  );
  const movedChanges = [];
  const destroyChanges = [];
  for (const resolution of resolvedTree) {
    const applyResult = applyResolvedNode(
      resolution,
      rootLootLocationID,
      false,
    );
    movedChanges.push(...applyResult.movedChanges);
    destroyChanges.push(...applyResult.destroyChanges);
  }

  return {
    success: true,
    data: {
      items: resolvedTree.map((resolution) => buildKillmailNodePayload(resolution)),
      movedChanges,
      destroyChanges,
      snapshotTree: cloneValue(snapshotTree),
    },
  };
}

module.exports = {
  resolveLocationDeathOutcome,
};
