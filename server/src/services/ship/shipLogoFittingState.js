const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const { findShipItemById } = require(path.join(
  __dirname,
  "../inventory/itemStore",
));
const {
  getOwnedShipLogoEntitlement,
} = require(path.join(__dirname, "../evermarks/evermarksEntitlements"));
const {
  COSMETIC_TYPE_ALLIANCE_LOGO,
  COSMETIC_TYPE_CORPORATION_LOGO,
  SHIP_LOGO_ENTITLEMENT_ALLIANCE,
  SHIP_LOGO_ENTITLEMENT_CORPORATION,
} = require(path.join(__dirname, "../evermarks/evermarksConstants"));

const TABLE_NAME = "shipLogoFittings";
const ROOT_VERSION = 1;

const DEFAULT_ROOT = Object.freeze({
  meta: {
    version: ROOT_VERSION,
    description: "DB-backed ship emblem fitting state keyed by ship and backend slot.",
    updatedAt: null,
  },
  ships: {},
});

let cachedRoot = null;
let cachedIndex = null;

function cloneValue(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizePositiveInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return fallback;
  }
  return numeric;
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) {
    return fallback;
  }
  return numeric;
}

function normalizeCosmeticType(value) {
  const numeric = Number(value || 0);
  if (numeric === COSMETIC_TYPE_ALLIANCE_LOGO) {
    return COSMETIC_TYPE_ALLIANCE_LOGO;
  }
  if (numeric === COSMETIC_TYPE_CORPORATION_LOGO) {
    return COSMETIC_TYPE_CORPORATION_LOGO;
  }
  return 0;
}

function getEntitlementTypeForCosmeticType(cosmeticType) {
  if (cosmeticType === COSMETIC_TYPE_ALLIANCE_LOGO) {
    return SHIP_LOGO_ENTITLEMENT_ALLIANCE;
  }
  if (cosmeticType === COSMETIC_TYPE_CORPORATION_LOGO) {
    return SHIP_LOGO_ENTITLEMENT_CORPORATION;
  }
  return 0;
}

function normalizeEntry(shipID, backendSlot, value = {}) {
  const normalizedShipID = normalizePositiveInteger(shipID, 0);
  const normalizedBackendSlot = normalizeNonNegativeInteger(backendSlot, -1);
  const cosmeticType = normalizeCosmeticType(value.cosmeticType);
  if (!normalizedShipID || normalizedBackendSlot < 0 || !cosmeticType) {
    return null;
  }

  return {
    shipID: normalizedShipID,
    backendSlot: normalizedBackendSlot,
    cosmeticType,
    changedByCharacterID: normalizePositiveInteger(value.changedByCharacterID, 0) || null,
    updatedAtMs: Math.max(
      0,
      Math.trunc(Number(value.updatedAtMs || Date.now()) || Date.now()),
    ),
  };
}

function readRoot() {
  const result = database.read(TABLE_NAME, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return cloneValue(DEFAULT_ROOT);
  }

  return {
    meta:
      result.data.meta && typeof result.data.meta === "object"
        ? {
            ...cloneValue(DEFAULT_ROOT.meta),
            ...cloneValue(result.data.meta),
            version: ROOT_VERSION,
          }
        : cloneValue(DEFAULT_ROOT.meta),
    ships:
      result.data.ships && typeof result.data.ships === "object"
        ? cloneValue(result.data.ships)
        : {},
  };
}

function ensureRoot() {
  if (!cachedRoot) {
    cachedRoot = readRoot();
  }
  return cachedRoot;
}

function writeRoot(root) {
  const nextRoot = {
    meta: {
      version: ROOT_VERSION,
      description: DEFAULT_ROOT.meta.description,
      updatedAt: new Date().toISOString(),
    },
    ships:
      root && root.ships && typeof root.ships === "object"
        ? cloneValue(root.ships)
        : {},
  };

  const result = database.write(TABLE_NAME, "/", nextRoot);
  if (!result.success) {
    return false;
  }

  cachedRoot = nextRoot;
  cachedIndex = null;
  return true;
}

function resetCache() {
  cachedRoot = null;
  cachedIndex = null;
}

function buildIndex() {
  if (cachedIndex) {
    return cachedIndex;
  }

  const root = ensureRoot();
  const byShipID = new Map();

  for (const [shipID, rawShipEntry] of Object.entries(root.ships || {})) {
    const numericShipID = normalizePositiveInteger(shipID, 0);
    if (!numericShipID) {
      continue;
    }

    const rawSlots =
      rawShipEntry &&
      rawShipEntry.enabledByBackendSlot &&
      typeof rawShipEntry.enabledByBackendSlot === "object"
        ? rawShipEntry.enabledByBackendSlot
        : {};
    const slotMap = new Map();

    for (const [backendSlot, rawEntry] of Object.entries(rawSlots)) {
      const normalized = normalizeEntry(numericShipID, backendSlot, rawEntry);
      if (!normalized) {
        continue;
      }
      slotMap.set(normalized.backendSlot, normalized);
    }

    byShipID.set(numericShipID, slotMap);
  }

  cachedIndex = {
    byShipID,
  };
  return cachedIndex;
}

function ensureShipEntry(root, shipID) {
  const shipKey = String(shipID);
  if (!root.ships[shipKey] || typeof root.ships[shipKey] !== "object") {
    root.ships[shipKey] = {
      enabledByBackendSlot: {},
    };
  }

  if (
    !root.ships[shipKey].enabledByBackendSlot ||
    typeof root.ships[shipKey].enabledByBackendSlot !== "object"
  ) {
    root.ships[shipKey].enabledByBackendSlot = {};
  }

  return root.ships[shipKey];
}

function getEnabledCosmeticsEntries(shipID) {
  const slotMap =
    buildIndex().byShipID.get(normalizePositiveInteger(shipID, 0)) || new Map();
  return [...slotMap.values()]
    .sort((left, right) => left.backendSlot - right.backendSlot)
    .map((entry) => cloneValue(entry));
}

function getEnabledCosmetics(shipID) {
  const enabled = {};
  for (const entry of getEnabledCosmeticsEntries(shipID)) {
    enabled[entry.backendSlot] = entry.cosmeticType;
  }
  return enabled;
}

function validateDisplayRequest(shipID, backendSlot, cosmeticType, characterID) {
  const normalizedShipID = normalizePositiveInteger(shipID, 0);
  const normalizedBackendSlot = normalizeNonNegativeInteger(backendSlot, -1);
  const normalizedCosmeticType = normalizeCosmeticType(cosmeticType);
  const normalizedCharacterID = normalizePositiveInteger(characterID, 0);
  if (!normalizedShipID || normalizedBackendSlot < 0 || !normalizedCosmeticType) {
    return {
      success: false,
      errorMsg: "INVALID_DATA",
    };
  }
  if (!normalizedCharacterID) {
    return {
      success: false,
      errorMsg: "INVALID_CHARACTER",
    };
  }

  const shipItem = findShipItemById(normalizedShipID);
  if (!shipItem) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const entitlementType = getEntitlementTypeForCosmeticType(normalizedCosmeticType);
  const entitlement = getOwnedShipLogoEntitlement(
    normalizedCharacterID,
    Number(shipItem.typeID || 0) || 0,
    entitlementType,
  );
  if (!entitlement) {
    return {
      success: false,
      errorMsg: "ENTITLEMENT_NOT_OWNED",
    };
  }

  return {
    success: true,
    data: {
      shipItem,
      shipID: normalizedShipID,
      backendSlot: normalizedBackendSlot,
      cosmeticType: normalizedCosmeticType,
      characterID: normalizedCharacterID,
    },
  };
}

function setDisplayedLogo(shipID, backendSlot, cosmeticType, options = {}) {
  const validation = validateDisplayRequest(
    shipID,
    backendSlot,
    cosmeticType,
    options.characterID,
  );
  if (!validation.success) {
    return validation;
  }

  const root = ensureRoot();
  const shipEntry = ensureShipEntry(root, validation.data.shipID);
  const entry = normalizeEntry(validation.data.shipID, validation.data.backendSlot, {
    cosmeticType: validation.data.cosmeticType,
    changedByCharacterID: validation.data.characterID,
    updatedAtMs: Date.now(),
  });

  shipEntry.enabledByBackendSlot[String(validation.data.backendSlot)] = entry;
  if (!writeRoot(root)) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  return {
    success: true,
    data: cloneValue(entry),
  };
}

function clearDisplayedLogo(shipID, backendSlot) {
  const normalizedShipID = normalizePositiveInteger(shipID, 0);
  const normalizedBackendSlot = normalizeNonNegativeInteger(backendSlot, -1);
  if (!normalizedShipID || normalizedBackendSlot < 0) {
    return {
      success: false,
      errorMsg: "INVALID_DATA",
    };
  }

  const shipItem = findShipItemById(normalizedShipID);
  if (!shipItem) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const root = ensureRoot();
  const shipKey = String(normalizedShipID);
  const shipEntry =
    root.ships && root.ships[shipKey] && typeof root.ships[shipKey] === "object"
      ? root.ships[shipKey]
      : null;
  const currentEntry =
    shipEntry &&
    shipEntry.enabledByBackendSlot &&
    typeof shipEntry.enabledByBackendSlot === "object"
      ? shipEntry.enabledByBackendSlot[String(normalizedBackendSlot)] || null
      : null;

  if (!currentEntry) {
    return {
      success: true,
      alreadyCleared: true,
      data: null,
    };
  }

  delete shipEntry.enabledByBackendSlot[String(normalizedBackendSlot)];
  if (Object.keys(shipEntry.enabledByBackendSlot).length === 0) {
    delete root.ships[shipKey];
  }

  if (!writeRoot(root)) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  return {
    success: true,
    alreadyCleared: false,
    data: normalizeEntry(normalizedShipID, normalizedBackendSlot, currentEntry),
  };
}

module.exports = {
  TABLE_NAME,
  clearDisplayedLogo,
  getEnabledCosmetics,
  getEnabledCosmeticsEntries,
  setDisplayedLogo,
  _testing: {
    ensureRoot,
    getEntitlementTypeForCosmeticType,
    normalizeEntry,
    readRoot,
    resetCache,
    validateDisplayRequest,
    writeRoot,
  },
};
