const path = require("path");

const {
  TABLE,
  readStaticTable,
} = require(path.join(__dirname, "../_shared/referenceData"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "./itemTypeRegistry"));

const TRADE_NON_TRADABLE_TYPE_LIST_ID = 36;
const TRADE_SOULBOUND_TYPE_LIST_ID = 142;
const TRADE_RESTRICTED_TYPE_LIST_IDS = Object.freeze([
  TRADE_NON_TRADABLE_TYPE_LIST_ID,
  TRADE_SOULBOUND_TYPE_LIST_ID,
]);

let cachedAuthority = null;

function normalizeNumericSet(values) {
  return new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => Number(value) || 0)
      .filter((value) => value > 0),
  );
}

function buildNormalizedTypeList(entry) {
  const listID = Number(entry && entry.listID) || 0;
  if (listID <= 0) {
    return null;
  }

  return {
    listID,
    includedTypeIDs: normalizeNumericSet(entry && entry.includedTypeIDs),
    includedGroupIDs: normalizeNumericSet(entry && entry.includedGroupIDs),
    includedCategoryIDs: normalizeNumericSet(entry && entry.includedCategoryIDs),
    excludedTypeIDs: normalizeNumericSet(entry && entry.excludedTypeIDs),
    excludedGroupIDs: normalizeNumericSet(entry && entry.excludedGroupIDs),
    excludedCategoryIDs: normalizeNumericSet(entry && entry.excludedCategoryIDs),
  };
}

function loadAuthority() {
  if (cachedAuthority) {
    return cachedAuthority;
  }

  const payload = readStaticTable(TABLE.CLIENT_TYPE_LISTS);
  const rows = Array.isArray(payload && payload.typeLists) ? payload.typeLists : [];
  const byID = new Map();

  for (const row of rows) {
    const normalized = buildNormalizedTypeList(row);
    if (!normalized) {
      continue;
    }
    byID.set(normalized.listID, normalized);
  }

  cachedAuthority = {
    meta: payload && typeof payload === "object" ? (payload._meta || {}) : {},
    byID,
  };
  return cachedAuthority;
}

function clearClientTypeListAuthorityCache() {
  cachedAuthority = null;
}

function getTypeList(listID) {
  const numericListID = Number(listID) || 0;
  if (numericListID <= 0) {
    return null;
  }
  return loadAuthority().byID.get(numericListID) || null;
}

function normalizeTypeContext(itemOrTypeContext) {
  const typeID = Number(
    itemOrTypeContext &&
      (itemOrTypeContext.typeID ?? itemOrTypeContext.itemTypeID ?? itemOrTypeContext.id),
  ) || 0;
  let groupID = Number(itemOrTypeContext && itemOrTypeContext.groupID) || 0;
  let categoryID = Number(itemOrTypeContext && itemOrTypeContext.categoryID) || 0;

  if (typeID > 0 && (groupID <= 0 || categoryID <= 0)) {
    const type = resolveItemByTypeID(typeID);
    if (type) {
      if (groupID <= 0) {
        groupID = Number(type.groupID) || 0;
      }
      if (categoryID <= 0) {
        categoryID = Number(type.categoryID) || 0;
      }
    }
  }

  return {
    typeID,
    groupID,
    categoryID,
  };
}

function matchesAnyIncludedIdentifier(typeContext, typeList) {
  return (
    typeList.includedTypeIDs.has(typeContext.typeID) ||
    typeList.includedGroupIDs.has(typeContext.groupID) ||
    typeList.includedCategoryIDs.has(typeContext.categoryID)
  );
}

function matchesAnyExcludedIdentifier(typeContext, typeList) {
  return (
    typeList.excludedTypeIDs.has(typeContext.typeID) ||
    typeList.excludedGroupIDs.has(typeContext.groupID) ||
    typeList.excludedCategoryIDs.has(typeContext.categoryID)
  );
}

function matchesTypeList(itemOrTypeContext, listID) {
  const typeList = getTypeList(listID);
  if (!typeList) {
    return false;
  }

  const typeContext = normalizeTypeContext(itemOrTypeContext);
  if (typeContext.typeID <= 0) {
    return false;
  }

  if (!matchesAnyIncludedIdentifier(typeContext, typeList)) {
    return false;
  }

  return !matchesAnyExcludedIdentifier(typeContext, typeList);
}

function matchesAnyTypeList(itemOrTypeContext, listIDs = []) {
  for (const listID of Array.isArray(listIDs) ? listIDs : [listIDs]) {
    if (matchesTypeList(itemOrTypeContext, listID)) {
      return true;
    }
  }
  return false;
}

function isTradableInventoryItem(itemOrTypeContext) {
  return !matchesAnyTypeList(itemOrTypeContext, TRADE_RESTRICTED_TYPE_LIST_IDS);
}

module.exports = {
  TRADE_NON_TRADABLE_TYPE_LIST_ID,
  TRADE_SOULBOUND_TYPE_LIST_ID,
  TRADE_RESTRICTED_TYPE_LIST_IDS,
  clearClientTypeListAuthorityCache,
  getTypeList,
  matchesTypeList,
  matchesAnyTypeList,
  isTradableInventoryItem,
};
