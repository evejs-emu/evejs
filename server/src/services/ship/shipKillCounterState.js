const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const {
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const SHIP_KILL_COUNTER_TABLE = "shipKillCounters";
const MAX_DISPLAYED_KILLMARKS = 999;

let tableCache = null;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function normalizeCounter(value) {
  const numeric = Math.trunc(Number(value) || 0);
  return Math.max(0, Math.min(MAX_DISPLAYED_KILLMARKS, numeric));
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

function normalizeShipCounterRecord(rawRecord = {}, itemID = 0) {
  const numericItemID = toPositiveInt(
    rawRecord && rawRecord.itemID,
    toPositiveInt(itemID, 0),
  );
  return {
    itemID: numericItemID,
    playerKills: normalizeCounter(rawRecord && rawRecord.playerKills),
    npcKills: normalizeCounter(rawRecord && rawRecord.npcKills),
    updatedAt: String(rawRecord && rawRecord.updatedAt || ""),
    lastAward:
      rawRecord && rawRecord.lastAward && typeof rawRecord.lastAward === "object"
        ? cloneValue(rawRecord.lastAward)
        : null,
  };
}

function ensureShipKillCounterTable() {
  if (tableCache) {
    return tableCache;
  }

  const readResult = database.read(SHIP_KILL_COUNTER_TABLE, "/");
  if (!readResult.success) {
    tableCache = normalizeTable();
    database.write(SHIP_KILL_COUNTER_TABLE, "/", tableCache);
    return tableCache;
  }

  tableCache = normalizeTable(readResult.data || {});
  return tableCache;
}

function writeShipCounterRecord(record) {
  if (!record || !record.itemID) {
    return false;
  }

  const table = ensureShipKillCounterTable();
  table.ships[String(record.itemID)] = record;
  const writeResult = database.write(
    SHIP_KILL_COUNTER_TABLE,
    `/ships/${String(record.itemID)}`,
    record,
  );
  return writeResult.success === true;
}

function readShipCounterRecord(itemID) {
  const numericItemID = toPositiveInt(itemID, 0);
  if (!numericItemID) {
    return normalizeShipCounterRecord({}, 0);
  }

  const table = ensureShipKillCounterTable();
  return normalizeShipCounterRecord(
    table.ships[String(numericItemID)] || {},
    numericItemID,
  );
}

function getItemKillCountPlayer(itemID) {
  return readShipCounterRecord(itemID).playerKills;
}

function getItemKillCountNPC(itemID) {
  return readShipCounterRecord(itemID).npcKills;
}

function setShipKillCounter(itemID, counts = {}) {
  const numericItemID = toPositiveInt(itemID, 0);
  if (!numericItemID) {
    return null;
  }

  const record = normalizeShipCounterRecord({
    itemID: numericItemID,
    playerKills: counts.playerKills,
    npcKills: counts.npcKills,
    updatedAt: counts.updatedAt || currentFileTime().toString(),
    lastAward: counts.lastAward || null,
  }, numericItemID);
  return writeShipCounterRecord(record) ? record : null;
}

function clearShipKillCounter(itemID, reason = "clear") {
  const numericItemID = toPositiveInt(itemID, 0);
  if (!numericItemID) {
    return {
      success: false,
      errorMsg: "INVALID_ITEM_ID",
    };
  }

  const table = ensureShipKillCounterTable();
  if (!table.ships[String(numericItemID)]) {
    return {
      success: true,
      changed: false,
      reason,
    };
  }

  delete table.ships[String(numericItemID)];
  const removeResult = database.remove(
    SHIP_KILL_COUNTER_TABLE,
    `/ships/${String(numericItemID)}`,
  );
  return {
    success: removeResult.success === true || removeResult.errorMsg === "ENTRY_NOT_FOUND",
    changed: removeResult.success === true,
    reason,
  };
}

function resetShipKillCounterCacheForTests() {
  tableCache = null;
}

module.exports = {
  SHIP_KILL_COUNTER_TABLE,
  MAX_DISPLAYED_KILLMARKS,
  clearShipKillCounter,
  getItemKillCountNPC,
  getItemKillCountPlayer,
  readShipCounterRecord,
  resetShipKillCounterCacheForTests,
  setShipKillCounter,
  setShipKillCounterForTests: setShipKillCounter,
};
