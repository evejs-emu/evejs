const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const {
  COSMETIC_TYPE_BY_ENTITLEMENT_TYPE,
  ENTITLEMENT_TYPE_BY_COSMETIC_TYPE,
} = require("./evermarksConstants");
const {
  getLicenseByShipAndCosmeticType,
  getLicenseByTypeID,
} = require("./evermarksCatalog");

const TABLE_NAME = "evermarkEntitlements";
const ROOT_VERSION = 1;

const DEFAULT_ROOT = Object.freeze({
  meta: {
    version: ROOT_VERSION,
    description: "DB-backed EverMarks ship-logo entitlements.",
    updatedAt: null,
  },
  characters: {},
});

let cachedRoot = null;
let cachedIndexes = null;

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

function buildEntitlementKey(entitlementType, shipTypeID) {
  return `${normalizePositiveInteger(entitlementType, 0)}:${normalizePositiveInteger(shipTypeID, 0)}`;
}

function normalizeEntitlementRecord(value = {}) {
  const characterID = normalizePositiveInteger(value.characterID, 0);
  const entitlementType = normalizePositiveInteger(value.entitlementType, 0);
  const shipTypeID = normalizePositiveInteger(value.shipTypeID, 0);
  const cosmeticType =
    Number(value.cosmeticType || 0) || COSMETIC_TYPE_BY_ENTITLEMENT_TYPE[entitlementType] || 0;
  const license =
    getLicenseByShipAndCosmeticType(shipTypeID, cosmeticType) ||
    getLicenseByTypeID(value.fsdTypeID || value.licenseID || 0);

  return {
    characterID,
    entitlementType,
    cosmeticType,
    shipTypeID,
    licenseID: normalizePositiveInteger(
      value.licenseID,
      license && license.licenseID,
    ) || normalizePositiveInteger(license && license.licenseID, 0),
    fsdTypeID: normalizePositiveInteger(
      value.fsdTypeID,
      license && license.fsdTypeID,
    ) || normalizePositiveInteger(license && license.fsdTypeID, 0),
    grantedAtMs: Math.max(0, Math.trunc(Number(value.grantedAtMs || Date.now()) || Date.now())),
    source: String(value.source || "manual"),
    offerID: normalizePositiveInteger(value.offerID, 0) || null,
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
            ...DEFAULT_ROOT.meta,
            ...cloneValue(result.data.meta),
            version: ROOT_VERSION,
          }
        : cloneValue(DEFAULT_ROOT.meta),
    characters:
      result.data.characters && typeof result.data.characters === "object"
        ? cloneValue(result.data.characters)
        : {},
  };
}

function ensureRoot() {
  if (!cachedRoot) {
    cachedRoot = readRoot();
  }
  return cachedRoot;
}

function resetCache() {
  cachedRoot = null;
  cachedIndexes = null;
}

function writeRoot(root) {
  const nextRoot = {
    meta: {
      version: ROOT_VERSION,
      description: DEFAULT_ROOT.meta.description,
      updatedAt: new Date().toISOString(),
      ...(root && root.meta && typeof root.meta === "object" ? root.meta : {}),
      version: ROOT_VERSION,
    },
    characters:
      root && root.characters && typeof root.characters === "object"
        ? cloneValue(root.characters)
        : {},
  };
  const result = database.write(TABLE_NAME, "/", nextRoot);
  if (!result.success) {
    return false;
  }
  cachedRoot = nextRoot;
  cachedIndexes = null;
  return true;
}

function buildIndexes() {
  if (cachedIndexes) {
    return cachedIndexes;
  }

  const root = ensureRoot();
  const byCharacter = new Map();
  const byCharacterAndTypeID = new Map();

  for (const [characterID, rawCharacter] of Object.entries(root.characters || {})) {
    const numericCharacterID = normalizePositiveInteger(characterID, 0);
    if (!numericCharacterID) {
      continue;
    }
    const rawEntitlements =
      rawCharacter && rawCharacter.shipLogosByKey && typeof rawCharacter.shipLogosByKey === "object"
        ? rawCharacter.shipLogosByKey
        : {};
    const normalized = Object.values(rawEntitlements)
      .map((entry) => normalizeEntitlementRecord(entry))
      .filter(
        (entry) =>
          entry.characterID > 0 &&
          entry.shipTypeID > 0 &&
          entry.entitlementType > 0 &&
          entry.fsdTypeID > 0,
      )
      .sort((left, right) => {
        if (left.shipTypeID !== right.shipTypeID) {
          return left.shipTypeID - right.shipTypeID;
        }
        return left.entitlementType - right.entitlementType;
      });
    byCharacter.set(numericCharacterID, normalized);
    byCharacterAndTypeID.set(
      numericCharacterID,
      new Map(normalized.map((entry) => [entry.fsdTypeID, entry])),
    );
  }

  cachedIndexes = {
    byCharacter,
    byCharacterAndTypeID,
  };
  return cachedIndexes;
}

function listOwnedShipLogoEntitlements(characterID) {
  return cloneValue(
    buildIndexes().byCharacter.get(normalizePositiveInteger(characterID, 0)) || [],
  );
}

function getOwnedShipLogoEntitlement(characterID, shipTypeID, entitlementType) {
  return (
    listOwnedShipLogoEntitlements(characterID).find(
      (entry) =>
        entry.shipTypeID === normalizePositiveInteger(shipTypeID, 0) &&
        entry.entitlementType === normalizePositiveInteger(entitlementType, 0),
    ) || null
  );
}

function getOwnedShipLogoEntitlementByTypeID(characterID, typeID) {
  const entry = (
    buildIndexes().byCharacterAndTypeID.get(normalizePositiveInteger(characterID, 0)) ||
    new Map()
  ).get(normalizePositiveInteger(typeID, 0));
  return entry ? cloneValue(entry) : null;
}

function grantShipLogoEntitlement(characterID, shipTypeID, entitlementType, options = {}) {
  const normalizedCharacterID = normalizePositiveInteger(characterID, 0);
  const normalizedShipTypeID = normalizePositiveInteger(shipTypeID, 0);
  const normalizedEntitlementType = normalizePositiveInteger(entitlementType, 0);
  const cosmeticType = COSMETIC_TYPE_BY_ENTITLEMENT_TYPE[normalizedEntitlementType] || 0;
  if (!normalizedCharacterID || !normalizedShipTypeID || !cosmeticType) {
    return {
      success: false,
      errorMsg: "INVALID_DATA",
    };
  }

  const license = getLicenseByShipAndCosmeticType(normalizedShipTypeID, cosmeticType);
  if (!license) {
    return {
      success: false,
      errorMsg: "LICENSE_NOT_FOUND",
    };
  }

  const root = ensureRoot();
  const characterKey = String(normalizedCharacterID);
  if (!root.characters[characterKey] || typeof root.characters[characterKey] !== "object") {
    root.characters[characterKey] = {
      shipLogosByKey: {},
    };
  }
  if (
    !root.characters[characterKey].shipLogosByKey ||
    typeof root.characters[characterKey].shipLogosByKey !== "object"
  ) {
    root.characters[characterKey].shipLogosByKey = {};
  }

  const entitlementKey = buildEntitlementKey(normalizedEntitlementType, normalizedShipTypeID);
  const existing = root.characters[characterKey].shipLogosByKey[entitlementKey];
  if (existing) {
    return {
      success: true,
      alreadyOwned: true,
      data: normalizeEntitlementRecord(existing),
    };
  }

  const record = normalizeEntitlementRecord({
    characterID: normalizedCharacterID,
    entitlementType: normalizedEntitlementType,
    cosmeticType,
    shipTypeID: normalizedShipTypeID,
    licenseID: license.licenseID,
    fsdTypeID: license.fsdTypeID,
    grantedAtMs: options.grantedAtMs || Date.now(),
    source: options.source || "manual",
    offerID: options.offerID || null,
  });
  root.characters[characterKey].shipLogosByKey[entitlementKey] = record;
  if (!writeRoot(root)) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  return {
    success: true,
    alreadyOwned: false,
    data: record,
  };
}

function grantShipLogoEntitlementByTypeID(characterID, typeID, options = {}) {
  const license = getLicenseByTypeID(typeID);
  if (!license) {
    return {
      success: false,
      errorMsg: "LICENSE_NOT_FOUND",
    };
  }
  const entitlementType = ENTITLEMENT_TYPE_BY_COSMETIC_TYPE[license.cosmeticType];
  if (!entitlementType) {
    return {
      success: false,
      errorMsg: "INVALID_DATA",
    };
  }
  return grantShipLogoEntitlement(characterID, license.shipTypeID, entitlementType, {
    ...options,
    offerID: options.offerID || null,
  });
}

function revokeShipLogoEntitlement(characterID, shipTypeID, entitlementType) {
  const normalizedCharacterID = normalizePositiveInteger(characterID, 0);
  const normalizedShipTypeID = normalizePositiveInteger(shipTypeID, 0);
  const normalizedEntitlementType = normalizePositiveInteger(entitlementType, 0);
  if (!normalizedCharacterID || !normalizedShipTypeID || !normalizedEntitlementType) {
    return {
      success: false,
      errorMsg: "INVALID_DATA",
    };
  }

  const root = ensureRoot();
  const characterKey = String(normalizedCharacterID);
  const entitlementKey = buildEntitlementKey(normalizedEntitlementType, normalizedShipTypeID);
  const currentRecord =
    root.characters &&
    root.characters[characterKey] &&
    root.characters[characterKey].shipLogosByKey
      ? root.characters[characterKey].shipLogosByKey[entitlementKey]
      : null;
  if (!currentRecord) {
    return {
      success: false,
      errorMsg: "NOT_FOUND",
    };
  }

  delete root.characters[characterKey].shipLogosByKey[entitlementKey];
  if (Object.keys(root.characters[characterKey].shipLogosByKey).length === 0) {
    delete root.characters[characterKey];
  }
  if (!writeRoot(root)) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  return {
    success: true,
    data: normalizeEntitlementRecord(currentRecord),
  };
}

module.exports = {
  TABLE_NAME,
  getOwnedShipLogoEntitlement,
  getOwnedShipLogoEntitlementByTypeID,
  grantShipLogoEntitlement,
  grantShipLogoEntitlementByTypeID,
  listOwnedShipLogoEntitlements,
  revokeShipLogoEntitlement,
  _testing: {
    buildEntitlementKey,
    ensureRoot,
    normalizeEntitlementRecord,
    readRoot,
    resetCache,
    writeRoot,
  },
};
