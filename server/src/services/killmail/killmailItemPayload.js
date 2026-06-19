const path = require("path");

const {
  listContainerItems,
} = require(path.join(__dirname, "../inventory/itemStore"));

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

function resolveInventoryItemQuantity(item) {
  const singleton = toInt(item && item.singleton, 0);
  if (singleton > 0) {
    return 1;
  }
  const stacksize = toInt(item && item.stacksize, 0);
  if (stacksize > 0) {
    return stacksize;
  }
  const quantity = toInt(item && item.quantity, 0);
  if (quantity > 0) {
    return quantity;
  }
  return 1;
}

function buildKillmailItemTreeFromInventoryItem(item, options = {}) {
  const quantityField =
    options.quantityField === "qtyDestroyed" ? "qtyDestroyed" : "qtyDropped";
  const maxDepth = Math.max(0, toInt(options.maxDepth, 1));
  const currentDepth = Math.max(0, toInt(options.currentDepth, 0));
  const nextOptions = {
    ...options,
    quantityField,
    maxDepth,
    currentDepth: currentDepth + 1,
  };
  const contents =
    currentDepth < maxDepth
      ? listContainerItems(null, toPositiveInt(item && item.itemID, 0), null).map((child) =>
          buildKillmailItemTreeFromInventoryItem(child, nextOptions),
        )
      : [];
  const quantity = resolveInventoryItemQuantity(item);

  return {
    typeID: toPositiveInt(item && item.typeID, null),
    flag: toInt(item && item.flagID, 0),
    singleton: toInt(item && item.singleton, 0),
    qtyDropped: quantityField === "qtyDropped" ? quantity : 0,
    qtyDestroyed: quantityField === "qtyDestroyed" ? quantity : 0,
    contents,
  };
}

function buildKillmailItemTreeForLocation(locationID, options = {}) {
  const numericLocationID = toPositiveInt(locationID, null);
  if (!numericLocationID) {
    return [];
  }
  return listContainerItems(null, numericLocationID, null).map((item) =>
    buildKillmailItemTreeFromInventoryItem(item, options),
  );
}

module.exports = {
  buildKillmailItemTreeForLocation,
  buildKillmailItemTreeFromInventoryItem,
  resolveInventoryItemQuantity,
};
