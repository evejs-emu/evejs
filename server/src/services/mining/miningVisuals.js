const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function normalizeOreMapPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return {};
  }
  if (payload.systems && typeof payload.systems === "object") {
    return payload.systems;
  }
  if (payload.data && typeof payload.data === "object") {
    return payload.data;
  }
  return payload;
}

let cachedOreMap = null;

function loadSolarSystemOreMap() {
  if (cachedOreMap) {
    return cachedOreMap;
  }

  const candidates = [
    database.read("asteroidTypesBySolarSystemID", "/"),
    database.read("asteroidTypesBySolarSystemID", "/systems"),
    database.read("asteroidTypesBySolarSystemID", "/data"),
  ];

  for (const result of candidates) {
    if (result && result.success && result.data) {
      cachedOreMap = normalizeOreMapPayload(result.data);
      return cachedOreMap;
    }
  }

  cachedOreMap = {};
  return cachedOreMap;
}

function extractSystemOreEntries(oreMap, systemID) {
  if (!oreMap || typeof oreMap !== "object") {
    return [];
  }

  const key = String(toPositiveInt(systemID, 0));
  if (key && Array.isArray(oreMap[key])) {
    return oreMap[key];
  }

  if (Array.isArray(oreMap)) {
    const matched = oreMap.filter((row) => {
      const rowSystemID = toPositiveInt(
        row && (row.solarSystemID ?? row.systemID),
        0,
      );
      return rowSystemID === toPositiveInt(systemID, 0);
    });
    if (matched.length > 0) {
      return matched;
    }
  }

  return [];
}

function normalizeSystemOreEntry(entry) {
  if (typeof entry === "number" || typeof entry === "string") {
    const typeID = toPositiveInt(entry, 0);
    return typeID > 0 ? { typeID } : null;
  }
  if (!entry || typeof entry !== "object") {
    return null;
  }

  if (Array.isArray(entry.oreTypeIDs)) {
    return null;
  }

  const typeID = toPositiveInt(
    entry.typeID ?? entry.oreTypeID ?? entry.visualTypeID ?? entry.shellTypeID,
    0,
  );
  if (typeID <= 0) {
    return null;
  }

  const normalized = { typeID };
  const metadataKeys = [
    "weight",
    "spawnWeight",
    "chance",
    "probability",
    "frequency",
    "abundance",
    "quantity",
    "count",
  ];
  for (const key of metadataKeys) {
    if (Object.prototype.hasOwnProperty.call(entry, key)) {
      normalized[key] = entry[key];
    }
  }
  return normalized;
}

function getSolarSystemOreTypeRecords(systemID) {
  const normalizedSystemID = toPositiveInt(systemID, 0);
  if (normalizedSystemID <= 0) {
    return [];
  }

  const oreMap = loadSolarSystemOreMap();
  const entries = extractSystemOreEntries(oreMap, normalizedSystemID);

  const mergedByTypeID = new Map();
  for (const rawEntry of Array.isArray(entries) ? entries : []) {
    if (rawEntry && typeof rawEntry === "object" && Array.isArray(rawEntry.oreTypeIDs)) {
      for (const oreTypeID of rawEntry.oreTypeIDs) {
        const normalized = normalizeSystemOreEntry(oreTypeID);
        if (!normalized) {
          continue;
        }
        const item = resolveItemByTypeID(normalized.typeID);
        if (!item) {
          continue;
        }
        const existing = mergedByTypeID.get(normalized.typeID) || {};
        mergedByTypeID.set(normalized.typeID, {
          ...item,
          ...existing,
          ...normalized,
        });
      }
      continue;
    }

    const normalized = normalizeSystemOreEntry(rawEntry);
    if (!normalized) {
      continue;
    }
    const item = resolveItemByTypeID(normalized.typeID);
    if (!item) {
      continue;
    }
    const existing = mergedByTypeID.get(normalized.typeID) || {};
    mergedByTypeID.set(normalized.typeID, {
      ...item,
      ...existing,
      ...normalized,
    });
  }

  return Array.from(mergedByTypeID.values());
}

function resolveMiningVisualPresentation(typeRecord, overrides = {}) {
  const resolved = typeRecord && typeof typeRecord === "object"
    ? typeRecord
    : resolveItemByTypeID(toPositiveInt(typeRecord, 0));
  const visualTypeID = toPositiveInt(
    overrides.visualTypeID ?? overrides.typeID ?? (resolved && resolved.typeID),
    0,
  );
  const graphicID = toPositiveInt(
    overrides.graphicID ?? (resolved && resolved.graphicID),
    0,
  );
  const radius = Number.isFinite(Number(overrides.radius))
    ? Number(overrides.radius)
    : Number.isFinite(Number(resolved && resolved.radius))
      ? Number(resolved.radius)
      : null;
  return {
    graphicID,
    radius,
    typeID: visualTypeID,
    visualTypeID,
  };
}

module.exports = {
  getSolarSystemOreTypeRecords,
  resolveMiningVisualPresentation,
};
