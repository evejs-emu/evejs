const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));

const FACTIONS_TABLE = "factions";
const CORPORATIONS_TABLE = "corporations";
const OWNER_TYPE_FACTION = 30;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizePositiveInteger(value, fallback = null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  const normalized = Math.trunc(numeric);
  return normalized > 0 ? normalized : fallback;
}

function normalizeLocalizedText(value, fallback = "") {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object") {
    if (typeof value.en === "string" && value.en.trim()) {
      return value.en;
    }

    for (const localizedValue of Object.values(value)) {
      if (typeof localizedValue === "string" && localizedValue.trim()) {
        return localizedValue;
      }
    }
  }

  return fallback;
}

function readTable(tableName) {
  const result = database.read(tableName, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }

  return result.data;
}

function readFactionTable() {
  const table = readTable(FACTIONS_TABLE);
  if (table.records && typeof table.records === "object") {
    return table.records;
  }

  return table;
}

function normalizeFactionRecord(record = {}) {
  const factionID =
    normalizePositiveInteger(record.factionID, null) ||
    normalizePositiveInteger(record._key, null);
  if (!factionID) {
    return null;
  }

  return {
    factionID,
    corporationID: normalizePositiveInteger(record.corporationID, null),
    name: normalizeLocalizedText(record.name, `Faction ${factionID}`),
    shortDescription: normalizeLocalizedText(record.shortDescription, ""),
    description: normalizeLocalizedText(record.description, ""),
    flatLogo: typeof record.flatLogo === "string" ? record.flatLogo : null,
    flatLogoWithName:
      typeof record.flatLogoWithName === "string"
        ? record.flatLogoWithName
        : null,
    iconID: normalizePositiveInteger(record.iconID, null),
    militiaCorporationID: normalizePositiveInteger(
      record.militiaCorporationID,
      null,
    ),
    solarSystemID: normalizePositiveInteger(record.solarSystemID, null),
    sizeFactor: Number(record.sizeFactor || 0) || 0,
    uniqueName: Boolean(record.uniqueName),
    memberRaces: Array.isArray(record.memberRaces)
      ? record.memberRaces
          .map((value) => normalizePositiveInteger(value, null))
          .filter(Boolean)
      : [],
  };
}

function getFactionRecord(factionID) {
  const numericFactionID = normalizePositiveInteger(factionID, null);
  if (!numericFactionID) {
    return null;
  }

  const records = readFactionTable();
  const rawRecord = records[String(numericFactionID)] || records[numericFactionID];
  if (!rawRecord) {
    return null;
  }

  return normalizeFactionRecord(cloneValue(rawRecord));
}

function getAllFactionRecords() {
  return Object.values(readFactionTable())
    .map((record) => normalizeFactionRecord(cloneValue(record)))
    .filter(Boolean)
    .sort((left, right) => left.factionID - right.factionID);
}

function isFactionID(ownerID) {
  return Boolean(getFactionRecord(ownerID));
}

function getFactionRecordByCorporationID(corporationID) {
  const numericCorporationID = normalizePositiveInteger(corporationID, null);
  if (!numericCorporationID) {
    return null;
  }

  const corporationTable = readTable(CORPORATIONS_TABLE);
  const corporationRecords =
    corporationTable.records && typeof corporationTable.records === "object"
      ? corporationTable.records
      : corporationTable;
  const corporationRecord =
    corporationRecords[String(numericCorporationID)] ||
    corporationRecords[numericCorporationID];
  if (!corporationRecord || typeof corporationRecord !== "object") {
    return null;
  }

  return getFactionRecord(corporationRecord.factionID);
}

function getFactionIDForCorporation(corporationID) {
  const factionRecord = getFactionRecordByCorporationID(corporationID);
  return factionRecord ? factionRecord.factionID : null;
}

function getFactionOwnerRecord(ownerID) {
  const factionRecord = getFactionRecord(ownerID);
  if (!factionRecord) {
    return null;
  }

  return {
    ownerID: factionRecord.factionID,
    ownerName: factionRecord.name,
    typeID: OWNER_TYPE_FACTION,
    gender: 0,
    tickerName: null,
    factionID: factionRecord.factionID,
  };
}

module.exports = {
  FACTIONS_TABLE,
  OWNER_TYPE_FACTION,
  getAllFactionRecords,
  getFactionIDForCorporation,
  getFactionOwnerRecord,
  getFactionRecord,
  getFactionRecordByCorporationID,
  isFactionID,
};
