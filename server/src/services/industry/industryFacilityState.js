const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const {
  throwWrappedUserError,
} = require(path.join(__dirname, "../../common/machoErrors"));
const {
  normalizeRoleValue,
  hasCorporationIndustryJobAccess,
  isCorporationOwner,
} = require(path.join(__dirname, "./industryAccess"));
const {
  DEFAULT_TAX_RATE,
  INDUSTRY_FACILITY_STATE_TABLE,
  ITEM_FLAG_CORP_DELIVERIES,
  ROLE_FACTORY_MANAGER,
} = require(path.join(__dirname, "./industryConstants"));

const FACILITY_TAX_FIELDS = Object.freeze([
  "taxCorporation",
  "taxAlliance",
  "taxStandingsHorrible",
  "taxStandingsBad",
  "taxStandingsNeutral",
  "taxStandingsGood",
  "taxStandingsHigh",
]);

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toTaxValue(value, fallback = null) {
  if (value === null || value === undefined) {
    return fallback;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, numeric);
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function readTable() {
  const result = database.read(INDUSTRY_FACILITY_STATE_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {
      _meta: {
        version: 1,
        generatedAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
      },
      facilities: {},
    };
  }
  return cloneValue(result.data);
}

function writeTable(payload) {
  payload._meta = {
    ...(payload._meta || {}),
    version: 1,
    lastUpdatedAt: new Date().toISOString(),
  };
  return Boolean(database.write(INDUSTRY_FACILITY_STATE_TABLE, "/", payload).success);
}

function buildDefaultTaxConfig(facility = null) {
  return {
    facilityID: toInt(facility && facility.facilityID, 0),
    ownerID: toInt(facility && facility.ownerID, 0),
    locationFlagID: ITEM_FLAG_CORP_DELIVERIES,
    taxCorporation: Number(facility && facility.tax !== undefined ? facility.tax : DEFAULT_TAX_RATE),
    taxAlliance: null,
    taxStandingsHorrible: null,
    taxStandingsBad: null,
    taxStandingsNeutral: null,
    taxStandingsGood: null,
    taxStandingsHigh: null,
    updatedAt: Date.now(),
  };
}

function getFacilityTaxConfig(facilityID, facility = null) {
  const numericFacilityID = toInt(facilityID || (facility && facility.facilityID), 0);
  if (numericFacilityID <= 0) {
    return buildDefaultTaxConfig(facility);
  }
  const payload = readTable();
  const existing = payload.facilities && payload.facilities[String(numericFacilityID)];
  if (existing && typeof existing === "object") {
    return {
      ...buildDefaultTaxConfig(facility),
      ...existing,
      facilityID: numericFacilityID,
    };
  }
  return buildDefaultTaxConfig(facility);
}

function getFacilityTaxRate(facilityID, facility = null) {
  return Number(getFacilityTaxConfig(facilityID, facility).taxCorporation ?? DEFAULT_TAX_RATE);
}

function setFacilityTaxConfig(session, facility, corporationID, taxRateValues = {}) {
  const numericCorporationID = toInt(corporationID, 0);
  const numericFacilityID = toInt(facility && facility.facilityID, 0);
  if (!facility || numericFacilityID <= 0) {
    throwWrappedUserError("CustomNotify", {
      notify: "That facility could not be found.",
    });
  }
  if (!isCorporationOwner(session, numericCorporationID) || numericCorporationID !== toInt(facility.ownerID, 0)) {
    throwWrappedUserError("CustomNotify", {
      notify: "You cannot configure taxes for that facility.",
    });
  }
  if (!hasCorporationIndustryJobAccess(session, numericCorporationID)) {
    throwWrappedUserError("CustomNotify", {
      notify: "You need factory manager access to configure this facility.",
    });
  }

  const roles = normalizeRoleValue(session && session.corprole);
  if ((roles & ROLE_FACTORY_MANAGER) !== ROLE_FACTORY_MANAGER) {
    throwWrappedUserError("CustomNotify", {
      notify: "You need factory manager access to configure this facility.",
    });
  }

  const current = getFacilityTaxConfig(numericFacilityID, facility);
  const next = {
    ...current,
    ownerID: numericCorporationID,
    updatedAt: Date.now(),
  };
  for (const fieldName of FACILITY_TAX_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(taxRateValues || {}, fieldName)) {
      next[fieldName] = toTaxValue(taxRateValues[fieldName], null);
    }
  }

  const payload = readTable();
  payload.facilities = payload.facilities && typeof payload.facilities === "object"
    ? payload.facilities
    : {};
  payload.facilities[String(numericFacilityID)] = next;
  if (!writeTable(payload)) {
    throwWrappedUserError("CustomNotify", {
      notify: "Failed to persist facility tax settings.",
    });
  }
  return next;
}

module.exports = {
  FACILITY_TAX_FIELDS,
  getFacilityTaxConfig,
  getFacilityTaxRate,
  setFacilityTaxConfig,
};
