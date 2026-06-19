const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));

const SHIP_INSURANCE_PRICES_TABLE = "shipInsurancePrices";
const BASE_INSURANCE_FRACTION = 0.4;
const DEFAULT_INSURANCE_FRACTION = BASE_INSURANCE_FRACTION;
const INSURANCE_FRACTION_INCREMENT = 0.5;
const PACKAGE_ORDER = Object.freeze([
  Object.freeze({ name: "Basic", fraction: 0.5 }),
  Object.freeze({ name: "Standard", fraction: 0.6 }),
  Object.freeze({ name: "Bronze", fraction: 0.7 }),
  Object.freeze({ name: "Silver", fraction: 0.8 }),
  Object.freeze({ name: "Gold", fraction: 0.9 }),
  Object.freeze({ name: "Platinum", fraction: 1.0 }),
]);

let cachedAuthority = null;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(toNumber(value, fallback));
  return numeric > 0 ? numeric : fallback;
}

function iskToCents(value) {
  return Math.round(toNumber(value, 0) * 100);
}

function centsToIsk(value) {
  return Math.round(toNumber(value, 0)) / 100;
}

function roundFraction(value) {
  return Math.round(toNumber(value, 0) * 10) / 10;
}

function computePremiumCents(fullInsurancePriceCents, fraction) {
  const fullPriceCents = Math.max(0, Math.round(toNumber(fullInsurancePriceCents, 0)));
  const normalizedFraction = roundFraction(fraction);
  const increment =
    (normalizedFraction - BASE_INSURANCE_FRACTION) * INSURANCE_FRACTION_INCREMENT;
  return Math.max(0, Math.round(fullPriceCents * increment));
}

function computePayoutCents(fullInsurancePriceCents, fraction) {
  const fullPriceCents = Math.max(0, Math.round(toNumber(fullInsurancePriceCents, 0)));
  return Math.max(0, Math.round(fullPriceCents * roundFraction(fraction)));
}

function normalizePriceRow(row = {}) {
  const typeID = toPositiveInt(row.typeID, 0);
  const fullInsurancePriceCents = Math.max(
    0,
    Math.round(toNumber(row.fullInsurancePriceCents, 0)),
  );
  if (!typeID || fullInsurancePriceCents <= 0) {
    return null;
  }

  return {
    typeID,
    fullInsurancePriceCents,
  };
}

function loadAuthority() {
  if (cachedAuthority) {
    return cachedAuthority;
  }

  const result = database.read(SHIP_INSURANCE_PRICES_TABLE, "/");
  const payload =
    result.success && result.data && typeof result.data === "object"
      ? result.data
      : { byTypeID: {} };
  const rowsByTypeID = new Map();
  for (const [key, rawRow] of Object.entries(payload.byTypeID || {})) {
    const row = normalizePriceRow({
      typeID: rawRow && rawRow.typeID ? rawRow.typeID : key,
      fullInsurancePriceCents: rawRow && rawRow.fullInsurancePriceCents,
    });
    if (row) {
      rowsByTypeID.set(row.typeID, row);
    }
  }

  cachedAuthority = {
    meta: cloneValue(payload._meta || {}),
    rowsByTypeID,
  };
  return cachedAuthority;
}

function resetInsurancePriceCacheForTests() {
  cachedAuthority = null;
}

function getFullInsurancePriceCents(typeID) {
  const row = loadAuthority().rowsByTypeID.get(toPositiveInt(typeID, 0));
  return row ? row.fullInsurancePriceCents : 0;
}

function getFullInsurancePrice(typeID) {
  return centsToIsk(getFullInsurancePriceCents(typeID));
}

function getInsurancePrices(typeIDs = []) {
  const authority = loadAuthority();
  const prices = {};
  for (const rawTypeID of Array.isArray(typeIDs) ? typeIDs : []) {
    const typeID = toPositiveInt(rawTypeID, 0);
    if (!typeID) {
      continue;
    }
    const row = authority.rowsByTypeID.get(typeID);
    prices[typeID] = row ? centsToIsk(row.fullInsurancePriceCents) : 0;
  }
  return prices;
}

function getPackageByFraction(fraction) {
  const normalizedFraction = roundFraction(fraction);
  return (
    PACKAGE_ORDER.find((packageInfo) => packageInfo.fraction === normalizedFraction) ||
    null
  );
}

function getPackageByName(name) {
  const normalizedName = String(name || "").trim().toLowerCase();
  return (
    PACKAGE_ORDER.find(
      (packageInfo) => packageInfo.name.toLowerCase() === normalizedName,
    ) || null
  );
}

function resolvePackageFromPremium(fullInsurancePriceCents, quotedPremium) {
  const premiumCents = iskToCents(quotedPremium);
  return (
    PACKAGE_ORDER.find((packageInfo) => (
      Math.abs(
        computePremiumCents(fullInsurancePriceCents, packageInfo.fraction) -
          premiumCents,
      ) <= 1
    )) || null
  );
}

module.exports = {
  SHIP_INSURANCE_PRICES_TABLE,
  BASE_INSURANCE_FRACTION,
  DEFAULT_INSURANCE_FRACTION,
  INSURANCE_FRACTION_INCREMENT,
  PACKAGE_ORDER,
  centsToIsk,
  computePayoutCents,
  computePremiumCents,
  getFullInsurancePrice,
  getFullInsurancePriceCents,
  getInsurancePrices,
  getPackageByFraction,
  getPackageByName,
  iskToCents,
  resetInsurancePriceCacheForTests,
  resolvePackageFromPremium,
};
