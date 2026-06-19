const path = require("path");

const { resolveItemByTypeID } = require(path.join(
  __dirname,
  "./itemTypeRegistry",
));

const FUEL_BAY_FLAG = 133;
const STRUCTURE_FUEL_BAY_FLAG = 172;
const CARGO_HOLD_FLAG = 5;
const FUEL_BAY_ATTRIBUTE_ID = 1549;
const FUEL_BAY_ATTRIBUTE_NAMES = Object.freeze(["specialFuelBayCapacity"]);
const FUEL_BAY_RESOURCE_KEY = "specialFuelBayCapacity";
const ICE_PRODUCT_GROUP_ID = 423;
const FUEL_BLOCK_GROUP_ID = 1136;

const fuelBayCompatibilityCache = new Map();

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function resolveTypeRecord(itemOrTypeID) {
  if (!itemOrTypeID) {
    return null;
  }

  if (typeof itemOrTypeID === "object") {
    return itemOrTypeID;
  }

  const typeID = toInt(itemOrTypeID, 0);
  if (typeID <= 0) {
    return null;
  }

  return resolveItemByTypeID(typeID) || null;
}

function computeFuelBayCompatibility(typeRecord) {
  if (!typeRecord) {
    return false;
  }

  const groupID = toInt(typeRecord.groupID, 0);
  if (groupID === ICE_PRODUCT_GROUP_ID || groupID === FUEL_BLOCK_GROUP_ID) {
    return true;
  }

  const groupName = String(typeRecord.groupName || "").trim().toLowerCase();
  return groupName === "ice product" || groupName === "fuel block";
}

function isFuelBayFlag(flagID) {
  return toInt(flagID, 0) === FUEL_BAY_FLAG;
}

function isStructureFuelBayFlag(flagID) {
  return toInt(flagID, 0) === STRUCTURE_FUEL_BAY_FLAG;
}

function isFuelBayCompatibleItem(itemOrTypeID) {
  const typeRecord = resolveTypeRecord(itemOrTypeID);
  if (!typeRecord) {
    return false;
  }

  const typeID = toInt(typeRecord.typeID, 0);
  if (typeID > 0 && fuelBayCompatibilityCache.has(typeID)) {
    return fuelBayCompatibilityCache.get(typeID) === true;
  }

  const isCompatible = computeFuelBayCompatibility(typeRecord);
  if (typeID > 0) {
    fuelBayCompatibilityCache.set(typeID, isCompatible);
  }
  return isCompatible;
}

function getFuelStorageFlagsForType(itemOrTypeID, priorityFlags = []) {
  const flags = [];
  const seen = new Set();

  const appendFlag = (flagID) => {
    const numericFlagID = toInt(flagID, 0);
    if (numericFlagID <= 0 || seen.has(numericFlagID)) {
      return;
    }
    seen.add(numericFlagID);
    flags.push(numericFlagID);
  };

  for (const flagID of Array.isArray(priorityFlags) ? priorityFlags : []) {
    appendFlag(flagID);
  }

  if (isFuelBayCompatibleItem(itemOrTypeID)) {
    appendFlag(FUEL_BAY_FLAG);
  }

  appendFlag(CARGO_HOLD_FLAG);
  return flags;
}

function getFuelBayCapacity(resourceState) {
  if (!resourceState || typeof resourceState !== "object") {
    return 0;
  }

  const directValue = toFiniteNumber(resourceState[FUEL_BAY_RESOURCE_KEY], NaN);
  if (Number.isFinite(directValue)) {
    return directValue;
  }

  const attributes =
    resourceState.attributes && typeof resourceState.attributes === "object"
      ? resourceState.attributes
      : null;
  if (!attributes) {
    return 0;
  }

  return toFiniteNumber(attributes[FUEL_BAY_ATTRIBUTE_ID], 0);
}

module.exports = {
  FUEL_BAY_FLAG,
  STRUCTURE_FUEL_BAY_FLAG,
  CARGO_HOLD_FLAG,
  FUEL_BAY_ATTRIBUTE_ID,
  FUEL_BAY_ATTRIBUTE_NAMES,
  FUEL_BAY_RESOURCE_KEY,
  ICE_PRODUCT_GROUP_ID,
  FUEL_BLOCK_GROUP_ID,
  isFuelBayFlag,
  isStructureFuelBayFlag,
  isFuelBayCompatibleItem,
  getFuelStorageFlagsForType,
  getFuelBayCapacity,
};
