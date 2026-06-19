const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const {
  TABLE,
  readStaticTable,
} = require(path.join(__dirname, "./referenceData"));

let cache = null;

function logDataLoad(message) {
  const writer =
    (log && typeof log.dataLoad === "function" && log.dataLoad.bind(log)) ||
    (log && typeof log.info === "function" && log.info.bind(log)) ||
    null;
  if (writer) {
    writer(message);
  }
}

function normalizeTypeID(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : 0;
}

function normalizeThreshold(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function freezeThresholds(row) {
  return Object.freeze({
    hostileResponseThreshold: normalizeThreshold(
      row && row.hostileResponseThreshold,
      -11,
    ),
    friendlyResponseThreshold: normalizeThreshold(
      row && row.friendlyResponseThreshold,
      11,
    ),
  });
}

function buildCache() {
  const payload = readStaticTable(TABLE.CLIENT_ENTITY_STANDINGS);
  const rows = Array.isArray(payload && payload.types) ? payload.types : [];
  const standingsByTypeID = new Map();

  for (const row of rows) {
    const typeID = normalizeTypeID(row && row.typeID);
    if (!typeID) {
      continue;
    }
    standingsByTypeID.set(typeID, freezeThresholds(row));
  }

  return {
    standingsByTypeID,
    typeCount: standingsByTypeID.size,
  };
}

function ensureLoaded() {
  if (!cache) {
    cache = buildCache();
    logDataLoad(
      `[ClientEntityStandings] Loaded ${cache.typeCount} type thresholds.`,
    );
  }
  return cache;
}

function getEntityStandingsForType(typeID) {
  return ensureLoaded().standingsByTypeID.get(normalizeTypeID(typeID)) || null;
}

function getCacheStats() {
  const loaded = ensureLoaded();
  return {
    typeCount: loaded.typeCount,
  };
}

ensureLoaded();

module.exports = {
  ensureLoaded,
  getEntityStandingsForType,
  getCacheStats,
};
