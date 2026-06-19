const path = require("path");

const { resolveItemByTypeID } = require(path.join(
  __dirname,
  "../inventory/itemTypeRegistry",
));
const {
  MINING_HOLD_FLAGS,
  MINING_HOLD_DEFINITIONS,
  getMiningHoldDefinitionByFlag,
} = require("./miningConstants");

const MINING_SHIP_BAY_FLAGS = Object.freeze(
  MINING_HOLD_DEFINITIONS.map((definition) => definition.flagID),
);
const miningMaterialKindCache = new Map();

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

function computeMiningMaterialKind(typeRecord) {
  if (!typeRecord) {
    return null;
  }

  const categoryID = toInt(typeRecord.categoryID, 0);
  const groupName = String(typeRecord.groupName || "").trim().toLowerCase();

  if (categoryID === 2 && groupName === "harvestable cloud") {
    return "gas";
  }

  if (categoryID === 25) {
    if (groupName === "ice") {
      return "ice";
    }
    return "ore";
  }

  return null;
}

function classifyMiningMaterialType(itemOrTypeID) {
  const typeRecord = resolveTypeRecord(itemOrTypeID);
  if (!typeRecord) {
    return null;
  }

  const typeID = toInt(typeRecord.typeID, 0);
  if (typeID > 0 && miningMaterialKindCache.has(typeID)) {
    const kind = miningMaterialKindCache.get(typeID);
    return kind
      ? {
          kind,
          typeRecord,
        }
      : null;
  }

  const kind = computeMiningMaterialKind(typeRecord);
  if (typeID > 0) {
    miningMaterialKindCache.set(typeID, kind || null);
  }

  return kind
    ? {
        kind,
        typeRecord,
      }
    : null;
}

function isMiningMaterialType(itemOrTypeID) {
  return Boolean(classifyMiningMaterialType(itemOrTypeID));
}

function isItemTypeAllowedInHoldFlag(itemOrTypeID, flagID) {
  const numericFlagID = toInt(flagID, 0);
  const classification = classifyMiningMaterialType(itemOrTypeID);
  if (!classification) {
    return false;
  }

  switch (numericFlagID) {
    case MINING_HOLD_FLAGS.GENERAL_MINING_HOLD:
      return true;
    case MINING_HOLD_FLAGS.SPECIALIZED_ASTEROID_HOLD:
      return classification.kind === "ore";
    case MINING_HOLD_FLAGS.SPECIALIZED_GAS_HOLD:
      return classification.kind === "gas";
    case MINING_HOLD_FLAGS.SPECIALIZED_ICE_HOLD:
      return classification.kind === "ice";
    default:
      return false;
  }
}

function getShipHoldCapacityByFlag(resourceState, flagID) {
  const definition = getMiningHoldDefinitionByFlag(flagID);
  if (!definition || !resourceState) {
    return 0;
  }
  return toFiniteNumber(resourceState[definition.resourceKey], 0);
}

function getPreferredMiningHoldFlagForType(resourceState, itemOrTypeID) {
  const classification = classifyMiningMaterialType(itemOrTypeID);
  if (!classification || !resourceState) {
    return null;
  }

  if (
    classification.kind === "ore" &&
    getShipHoldCapacityByFlag(resourceState, MINING_HOLD_FLAGS.SPECIALIZED_ASTEROID_HOLD) > 0
  ) {
    return MINING_HOLD_FLAGS.SPECIALIZED_ASTEROID_HOLD;
  }

  if (
    classification.kind === "gas" &&
    getShipHoldCapacityByFlag(resourceState, MINING_HOLD_FLAGS.SPECIALIZED_GAS_HOLD) > 0
  ) {
    return MINING_HOLD_FLAGS.SPECIALIZED_GAS_HOLD;
  }

  if (
    classification.kind === "ice" &&
    getShipHoldCapacityByFlag(resourceState, MINING_HOLD_FLAGS.SPECIALIZED_ICE_HOLD) > 0
  ) {
    return MINING_HOLD_FLAGS.SPECIALIZED_ICE_HOLD;
  }

  return getShipHoldCapacityByFlag(resourceState, MINING_HOLD_FLAGS.GENERAL_MINING_HOLD) > 0
    ? MINING_HOLD_FLAGS.GENERAL_MINING_HOLD
    : null;
}

module.exports = {
  MINING_HOLD_FLAGS,
  MINING_HOLD_DEFINITIONS,
  MINING_SHIP_BAY_FLAGS,
  classifyMiningMaterialType,
  isMiningMaterialType,
  isItemTypeAllowedInHoldFlag,
  getShipHoldCapacityByFlag,
  getPreferredMiningHoldFlagForType,
};
