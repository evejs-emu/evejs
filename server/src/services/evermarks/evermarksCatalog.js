const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const {
  COSMETIC_TYPE_ALLIANCE_LOGO,
  COSMETIC_TYPE_CORPORATION_LOGO,
  HERALDRY_CORPORATION_ID,
  SLOT_GROUP_EMBLEM,
} = require("./evermarksConstants");

const TABLE_NAME = "evermarksCatalog";
const ROOT_VERSION = 1;

const DEFAULT_ROOT = Object.freeze({
  meta: {
    version: ROOT_VERSION,
    description: "Cached EverMarks heraldry emblem offers and ship-logo metadata.",
    generatedAt: null,
    sourceAuthority: "local-cache",
  },
  licensesByTypeID: {},
  offersByOfferID: {},
  offerIDsByTypeID: {},
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

function normalizeNonNegativeInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Math.max(0, Math.trunc(Number(fallback) || 0));
  }
  return Math.max(0, Math.trunc(numeric));
}

function normalizeLicenseRecord(typeID, value = {}) {
  const normalizedTypeID = normalizePositiveInteger(typeID || value.fsdTypeID, 0);
  const cosmeticType = Number(value.cosmeticType || 0);
  return {
    licenseID: normalizePositiveInteger(value.licenseID, normalizedTypeID) || normalizedTypeID,
    fsdTypeID: normalizedTypeID,
    shipTypeID: normalizePositiveInteger(value.shipTypeID, 0) || 0,
    cosmeticType:
      cosmeticType === COSMETIC_TYPE_ALLIANCE_LOGO
        ? COSMETIC_TYPE_ALLIANCE_LOGO
        : COSMETIC_TYPE_CORPORATION_LOGO,
    slotGroup: normalizePositiveInteger(value.slotGroup, SLOT_GROUP_EMBLEM) || SLOT_GROUP_EMBLEM,
    name: String(value.name || ""),
    published: value.published !== false,
  };
}

function normalizeRequiredStandings(value = null) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const standingValue = Number(value.value);
  const ownerID = normalizePositiveInteger(value.ownerID, 0);
  if (!Number.isFinite(standingValue) || !ownerID) {
    return null;
  }
  return {
    value: standingValue,
    ownerID,
  };
}

function normalizeOfferRecord(offerID, value = {}) {
  const reqItems = Array.isArray(value.reqItems)
    ? value.reqItems
        .map((entry) => [
          normalizePositiveInteger(entry && entry[0], 0),
          normalizeNonNegativeInteger(entry && entry[1], 0),
        ])
        .filter(([typeID, quantity]) => typeID > 0 && quantity > 0)
    : [];

  return {
    offerID: normalizePositiveInteger(offerID || value.offerID, 0) || 0,
    corpID: normalizePositiveInteger(value.corpID, HERALDRY_CORPORATION_ID) || HERALDRY_CORPORATION_ID,
    typeID: normalizePositiveInteger(value.typeID, 0) || 0,
    qty: normalizePositiveInteger(value.qty, 1) || 1,
    lpCost: normalizeNonNegativeInteger(value.lpCost, 0),
    iskCost: normalizeNonNegativeInteger(value.iskCost, 0),
    akCost: normalizeNonNegativeInteger(value.akCost, 0),
    reqItems,
    lootItems: [],
    requiredStandings: normalizeRequiredStandings(value.requiredStandings),
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
    licensesByTypeID:
      result.data.licensesByTypeID && typeof result.data.licensesByTypeID === "object"
        ? cloneValue(result.data.licensesByTypeID)
        : {},
    offersByOfferID:
      result.data.offersByOfferID && typeof result.data.offersByOfferID === "object"
        ? cloneValue(result.data.offersByOfferID)
        : {},
    offerIDsByTypeID:
      result.data.offerIDsByTypeID && typeof result.data.offerIDsByTypeID === "object"
        ? cloneValue(result.data.offerIDsByTypeID)
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

function buildIndexes() {
  if (cachedIndexes) {
    return cachedIndexes;
  }

  const root = ensureRoot();
  const licensesByTypeID = new Map();
  const licensesByShipAndCosmeticType = new Map();
  const offersByOfferID = new Map();
  const offerIDsByTypeID = new Map();

  for (const [typeID, rawLicense] of Object.entries(root.licensesByTypeID || {})) {
    const license = normalizeLicenseRecord(typeID, rawLicense);
    if (!license.fsdTypeID || !license.shipTypeID) {
      continue;
    }
    licensesByTypeID.set(license.fsdTypeID, license);
    licensesByShipAndCosmeticType.set(
      `${license.shipTypeID}:${license.cosmeticType}`,
      license,
    );
  }

  for (const [offerID, rawOffer] of Object.entries(root.offersByOfferID || {})) {
    const offer = normalizeOfferRecord(offerID, rawOffer);
    if (!offer.offerID || !offer.typeID) {
      continue;
    }
    offersByOfferID.set(offer.offerID, offer);
    offerIDsByTypeID.set(offer.typeID, offer.offerID);
  }

  for (const [typeID, offerID] of Object.entries(root.offerIDsByTypeID || {})) {
    const numericTypeID = normalizePositiveInteger(typeID, 0);
    const numericOfferID = normalizePositiveInteger(offerID, 0);
    if (!numericTypeID || !numericOfferID || offerIDsByTypeID.has(numericTypeID)) {
      continue;
    }
    offerIDsByTypeID.set(numericTypeID, numericOfferID);
  }

  cachedIndexes = {
    licensesByTypeID,
    licensesByShipAndCosmeticType,
    offersByOfferID,
    offerIDsByTypeID,
  };
  return cachedIndexes;
}

function listAllLicenses() {
  return [...buildIndexes().licensesByTypeID.values()]
    .map(cloneValue)
    .sort((left, right) => left.fsdTypeID - right.fsdTypeID);
}

function getLicenseByTypeID(typeID) {
  const license = buildIndexes().licensesByTypeID.get(
    normalizePositiveInteger(typeID, 0),
  );
  return license ? cloneValue(license) : null;
}

function getLicenseByShipAndCosmeticType(shipTypeID, cosmeticType) {
  const license = buildIndexes().licensesByShipAndCosmeticType.get(
    `${normalizePositiveInteger(shipTypeID, 0)}:${Number(cosmeticType || 0)}`,
  );
  return license ? cloneValue(license) : null;
}

function getHeraldryOfferByID(offerID) {
  const offer = buildIndexes().offersByOfferID.get(
    normalizePositiveInteger(offerID, 0),
  );
  return offer ? cloneValue(offer) : null;
}

function getHeraldryOfferByTypeID(typeID) {
  const normalizedTypeID = normalizePositiveInteger(typeID, 0);
  const offerID = buildIndexes().offerIDsByTypeID.get(normalizedTypeID);
  return offerID ? getHeraldryOfferByID(offerID) : null;
}

function listAllHeraldryOffers() {
  return [...buildIndexes().offersByOfferID.values()]
    .map(cloneValue)
    .sort((left, right) => left.offerID - right.offerID);
}

module.exports = {
  HERALDRY_CORPORATION_ID,
  TABLE_NAME,
  getHeraldryOfferByID,
  getHeraldryOfferByTypeID,
  getLicenseByShipAndCosmeticType,
  getLicenseByTypeID,
  listAllHeraldryOffers,
  listAllLicenses,
  _testing: {
    ensureRoot,
    normalizeLicenseRecord,
    normalizeOfferRecord,
    readRoot,
    resetCache,
  },
};
