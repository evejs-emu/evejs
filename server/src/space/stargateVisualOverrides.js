const path = require("path");

const database = require(path.join(__dirname, "../newDatabase"));

const TABLE_NAME = "stargateVisualOverrides";
const SUPPORTED_FIELDS = Object.freeze([
  "skinMaterialSetID",
]);

let cache = null;

function toPositiveInt(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function normalizeOverride(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const override = {};
  for (const fieldName of SUPPORTED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(raw, fieldName)) {
      continue;
    }
    const numeric = toPositiveInt(raw[fieldName]);
    if (numeric !== null) {
      override[fieldName] = numeric;
    }
  }

  return Object.keys(override).length > 0 ? Object.freeze(override) : null;
}

function buildCache() {
  const result = database.read(TABLE_NAME, "/");
  const payload = result.success && result.data && typeof result.data === "object"
    ? result.data
    : {};
  const byItemID = new Map();
  const rows = payload.byItemID && typeof payload.byItemID === "object"
    ? payload.byItemID
    : {};

  for (const [rawItemID, rawOverride] of Object.entries(rows)) {
    const itemID = toPositiveInt(rawItemID);
    const override = normalizeOverride(rawOverride);
    if (itemID !== null && override) {
      byItemID.set(itemID, override);
    }
  }

  return {
    byItemID,
  };
}

function ensureCache() {
  if (!cache) {
    cache = buildCache();
  }
  return cache;
}

function getStargateVisualOverride(itemID) {
  const numericItemID = toPositiveInt(itemID);
  if (numericItemID === null) {
    return null;
  }
  return ensureCache().byItemID.get(numericItemID) || null;
}

function getStargateVisualOverrideField(stargateOrItemID, fieldName) {
  if (!fieldName) {
    return undefined;
  }
  const itemID = typeof stargateOrItemID === "object"
    ? stargateOrItemID && stargateOrItemID.itemID
    : stargateOrItemID;
  const override = getStargateVisualOverride(itemID);
  if (!override || !Object.prototype.hasOwnProperty.call(override, fieldName)) {
    return undefined;
  }
  return override[fieldName];
}

function clearCacheForTests() {
  cache = null;
}

module.exports = {
  getStargateVisualOverride,
  getStargateVisualOverrideField,
  _testing: {
    clearCacheForTests,
  },
};
