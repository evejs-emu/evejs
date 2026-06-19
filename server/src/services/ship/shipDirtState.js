const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const SHIP_DIRT_TABLE = "shipDirt";

let tableCache = null;

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function normalizeFiletime(value, fallback = null) {
  if (typeof value === "bigint") {
    return value > 0n ? value : fallback;
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return BigInt(Math.trunc(value));
  }
  if (typeof value === "string" && value.trim() !== "") {
    try {
      const parsed = BigInt(value.trim());
      return parsed > 0n ? parsed : fallback;
    } catch (error) {
      return fallback;
    }
  }
  if (Buffer.isBuffer(value)) {
    try {
      const parsed = BigInt(value.toString("utf8").trim());
      return parsed > 0n ? parsed : fallback;
    } catch (error) {
      return fallback;
    }
  }
  return fallback;
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeTable(rawTable = {}) {
  return {
    _meta: {
      schemaVersion: 1,
      ...(rawTable && typeof rawTable._meta === "object" ? rawTable._meta : {}),
    },
    ships:
      rawTable && rawTable.ships && typeof rawTable.ships === "object"
        ? rawTable.ships
        : {},
  };
}

function normalizeShipDirtRecord(rawRecord = {}, itemID = 0) {
  const numericItemID = toPositiveInt(
    rawRecord && rawRecord.itemID,
    toPositiveInt(itemID, 0),
  );
  const dirtTime = normalizeFiletime(rawRecord && rawRecord.dirtTime, null);
  return {
    itemID: numericItemID,
    dirtTime: dirtTime ? dirtTime.toString() : "",
    updatedAt: String(rawRecord && rawRecord.updatedAt || ""),
    reason: String(rawRecord && rawRecord.reason || ""),
  };
}

function ensureShipDirtTable() {
  if (tableCache) {
    return tableCache;
  }

  const readResult = database.read(SHIP_DIRT_TABLE, "/");
  if (!readResult.success) {
    tableCache = normalizeTable();
    database.write(SHIP_DIRT_TABLE, "/", tableCache);
    return tableCache;
  }

  tableCache = normalizeTable(readResult.data || {});
  return tableCache;
}

function writeShipDirtRecord(record) {
  if (!record || !record.itemID) {
    return false;
  }

  const table = ensureShipDirtTable();
  table.ships[String(record.itemID)] = record;
  const writeResult = database.write(
    SHIP_DIRT_TABLE,
    `/ships/${String(record.itemID)}`,
    record,
  );
  return writeResult.success === true;
}

function getShipDirtRecord(itemID, options = {}) {
  const numericItemID = toPositiveInt(itemID, 0);
  if (!numericItemID) {
    return null;
  }

  const table = ensureShipDirtTable();
  const existing = table.ships[String(numericItemID)] || null;
  if (existing) {
    return normalizeShipDirtRecord(existing, numericItemID);
  }

  if (options.createIfMissing === false) {
    return null;
  }

  const created = normalizeShipDirtRecord({
    itemID: numericItemID,
    dirtTime: currentFileTime().toString(),
    updatedAt: currentFileTime().toString(),
    reason: options.reason || "initialized",
  }, numericItemID);
  if (!writeShipDirtRecord(created)) {
    log.warn(`[ShipDirt] Failed to initialize dirt timestamp for ship=${numericItemID}`);
    return null;
  }
  return created;
}

function getShipDirtTimestamp(itemID, options = {}) {
  const record = getShipDirtRecord(itemID, options);
  return record ? normalizeFiletime(record.dirtTime, 0n) || 0n : 0n;
}

function resetShipDirtTimestamp(itemID, rawTimestamp = null, options = {}) {
  const numericItemID = toPositiveInt(itemID, 0);
  if (!numericItemID) {
    return {
      success: false,
      errorMsg: "INVALID_ITEM_ID",
    };
  }

  const dirtTime = normalizeFiletime(rawTimestamp, null) || currentFileTime();
  const now = currentFileTime().toString();
  const record = normalizeShipDirtRecord({
    itemID: numericItemID,
    dirtTime: dirtTime.toString(),
    updatedAt: now,
    reason: options.reason || "reset",
  }, numericItemID);
  if (!writeShipDirtRecord(record)) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  return {
    success: true,
    data: cloneValue(record),
    dirtTime,
  };
}

function clearShipDirtTimestamp(itemID, reason = "clear") {
  const numericItemID = toPositiveInt(itemID, 0);
  if (!numericItemID) {
    return {
      success: false,
      errorMsg: "INVALID_ITEM_ID",
    };
  }

  const table = ensureShipDirtTable();
  if (!table.ships[String(numericItemID)]) {
    return {
      success: true,
      changed: false,
      reason,
    };
  }

  delete table.ships[String(numericItemID)];
  const removeResult = database.remove(
    SHIP_DIRT_TABLE,
    `/ships/${String(numericItemID)}`,
  );
  return {
    success: removeResult.success === true || removeResult.errorMsg === "ENTRY_NOT_FOUND",
    changed: removeResult.success === true,
    reason,
  };
}

function resetShipDirtCacheForTests() {
  tableCache = null;
}

module.exports = {
  SHIP_DIRT_TABLE,
  clearShipDirtTimestamp,
  getShipDirtRecord,
  getShipDirtTimestamp,
  normalizeFiletime,
  resetShipDirtCacheForTests,
  resetShipDirtTimestamp,
};
