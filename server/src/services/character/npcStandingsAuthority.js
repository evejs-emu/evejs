const path = require("path");

const {
  TABLE,
  readStaticTable,
} = require(path.join(__dirname, "../_shared/referenceData"));

let cache = null;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizePayload(payload = {}) {
  return {
    version: toInt(payload.version, 0),
    generatedAt: String(payload.generatedAt || "").trim(),
    source: payload && typeof payload.source === "object" ? payload.source : {},
    counts: payload && typeof payload.counts === "object" ? payload.counts : {},
    relationsByOwnerID:
      payload && typeof payload.relationsByOwnerID === "object"
        ? payload.relationsByOwnerID
        : {},
    entries: Array.isArray(payload.entries) ? payload.entries : [],
  };
}

function buildCache() {
  const payload = normalizePayload(readStaticTable(TABLE.NPC_STANDINGS_AUTHORITY));
  const relationsByOwnerID = new Map();

  for (const [ownerID, relations] of Object.entries(payload.relationsByOwnerID || {})) {
    const normalizedOwnerID = toInt(ownerID, 0);
    if (!normalizedOwnerID) {
      continue;
    }
    const normalizedRelations = Array.isArray(relations)
      ? relations
          .map((entry) => ({
            toID: toInt(entry && entry.toID, 0),
            standing: Number(entry && entry.standing),
            propagationMultiplier:
              entry && Object.prototype.hasOwnProperty.call(entry, "propagationMultiplier")
                ? Number(entry.propagationMultiplier)
                : Number(entry && entry.standing),
            source: String(entry && entry.source || ""),
            sourceLabel: String(entry && entry.sourceLabel || ""),
          }))
          .filter(
            (entry) =>
              entry.toID > 0 &&
              entry.toID !== normalizedOwnerID &&
              Number.isFinite(entry.standing) &&
              Number.isFinite(entry.propagationMultiplier),
          )
      : [];
    relationsByOwnerID.set(normalizedOwnerID, normalizedRelations);
  }

  const entries = Array.isArray(payload.entries)
    ? payload.entries
        .map((entry) => ({
          fromID: toInt(entry && entry.fromID, 0),
          toID: toInt(entry && entry.toID, 0),
          standing: Number(entry && entry.standing),
          propagationMultiplier:
            entry && Object.prototype.hasOwnProperty.call(entry, "propagationMultiplier")
              ? Number(entry.propagationMultiplier)
              : Number(entry && entry.standing),
          source: String(entry && entry.source || ""),
          sourceLabel: String(entry && entry.sourceLabel || ""),
        }))
        .filter(
          (entry) =>
            entry.fromID > 0 &&
            entry.toID > 0 &&
            entry.fromID !== entry.toID &&
            Number.isFinite(entry.standing) &&
            Number.isFinite(entry.propagationMultiplier),
        )
    : [];

  return {
    payload,
    relationsByOwnerID,
    entries,
  };
}

function ensureCache() {
  if (!cache) {
    cache = buildCache();
  }
  return cache;
}

function clearCache() {
  cache = null;
}

function listNpcStandings() {
  return cloneValue(ensureCache().entries);
}

function getRelationsForOwner(ownerID) {
  const record = ensureCache().relationsByOwnerID.get(toInt(ownerID, 0));
  return record ? cloneValue(record) : [];
}

function getPayload() {
  return cloneValue(ensureCache().payload);
}

module.exports = {
  clearCache,
  getPayload,
  getRelationsForOwner,
  listNpcStandings,
};
