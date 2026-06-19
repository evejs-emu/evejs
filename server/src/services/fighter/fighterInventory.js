const path = require("path");

const {
  TABLE,
  readStaticRows,
} = require(path.join(__dirname, "../_shared/referenceData"));
const {
  ITEM_FLAGS,
  FIGHTER_TUBE_FLAGS,
} = require(path.join(__dirname, "../inventory/itemStore"));

const DRONE_CATEGORY_ID = 18;
const FIGHTER_CATEGORY_ID = 87;

let cachedPublishedTypesByID = null;
let cachedPublishedGroupSummaries = null;

function normalizeTypeRecord(record = {}) {
  return {
    ...record,
    typeID: Number(record.typeID) || 0,
    groupID: Number(record.groupID) || 0,
    categoryID: Number(record.categoryID) || 0,
    published: record.published !== false,
    groupName: String(record.groupName || "").trim(),
    name: String(record.name || "").trim(),
  };
}

function getPublishedTypesByID() {
  if (cachedPublishedTypesByID) {
    return cachedPublishedTypesByID;
  }

  const publishedTypesByID = new Map();
  for (const rawType of readStaticRows(TABLE.ITEM_TYPES)) {
    const typeRecord = normalizeTypeRecord(rawType);
    if (!typeRecord.published || typeRecord.typeID <= 0) {
      continue;
    }

    publishedTypesByID.set(typeRecord.typeID, typeRecord);
  }

  cachedPublishedTypesByID = publishedTypesByID;
  return cachedPublishedTypesByID;
}

function getPublishedTypeRecord(typeID) {
  const numericTypeID = Number(typeID) || 0;
  if (numericTypeID <= 0) {
    return null;
  }

  return getPublishedTypesByID().get(numericTypeID) || null;
}

function hasCategory(item, categoryID) {
  if (!item || typeof item !== "object") {
    return false;
  }

  const explicitCategoryID = Number(item.categoryID) || 0;
  if (explicitCategoryID > 0) {
    return explicitCategoryID === Number(categoryID);
  }

  const typeRecord = getPublishedTypeRecord(item.typeID);
  return Boolean(typeRecord && typeRecord.categoryID === Number(categoryID));
}

function isDroneTypeID(typeID) {
  const typeRecord = getPublishedTypeRecord(typeID);
  return Boolean(typeRecord && typeRecord.categoryID === DRONE_CATEGORY_ID);
}

function isFighterTypeID(typeID) {
  const typeRecord = getPublishedTypeRecord(typeID);
  return Boolean(typeRecord && typeRecord.categoryID === FIGHTER_CATEGORY_ID);
}

function isDroneItemRecord(item) {
  return hasCategory(item, DRONE_CATEGORY_ID);
}

function isFighterItemRecord(item) {
  return hasCategory(item, FIGHTER_CATEGORY_ID);
}

function isFighterTubeFlag(flagID) {
  const numericFlagID = Number(flagID) || 0;
  return FIGHTER_TUBE_FLAGS.includes(numericFlagID);
}

function buildInventorySquadronSize(item) {
  if (!item || typeof item !== "object") {
    return 0;
  }

  if (Number(item.singleton) === 1) {
    return 1;
  }

  return Math.max(0, Number(item.stacksize ?? item.quantity ?? 0) || 0);
}

function summarizePublishedTypesByCategory(categoryID) {
  if (!cachedPublishedGroupSummaries) {
    cachedPublishedGroupSummaries = new Map();
  }

  const numericCategoryID = Number(categoryID) || 0;
  if (cachedPublishedGroupSummaries.has(numericCategoryID)) {
    return cachedPublishedGroupSummaries.get(numericCategoryID);
  }

  const groupsByID = new Map();
  for (const typeRecord of getPublishedTypesByID().values()) {
    if (typeRecord.categoryID !== numericCategoryID) {
      continue;
    }

    const groupID = Number(typeRecord.groupID) || 0;
    if (!groupsByID.has(groupID)) {
      groupsByID.set(groupID, {
        groupID,
        groupName: typeRecord.groupName,
        count: 0,
      });
    }

    groupsByID.get(groupID).count += 1;
  }

  const summary = [...groupsByID.values()].sort(
    (left, right) => left.groupID - right.groupID,
  );
  cachedPublishedGroupSummaries.set(numericCategoryID, summary);
  return summary;
}

module.exports = {
  DRONE_CATEGORY_ID,
  FIGHTER_CATEGORY_ID,
  FIGHTER_BAY_FLAG: ITEM_FLAGS.FIGHTER_BAY,
  FIGHTER_TUBE_FLAGS,
  getPublishedTypeRecord,
  isDroneItemRecord,
  isFighterItemRecord,
  isDroneTypeID,
  isFighterTypeID,
  isFighterTubeFlag,
  buildInventorySquadronSize,
  summarizePublishedTypesByCategory,
};
