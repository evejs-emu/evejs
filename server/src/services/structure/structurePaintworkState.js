const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const {
  createUuidString,
} = require(path.join(
  __dirname,
  "../../_secondary/express/gatewayServices/gatewayServiceHelpers",
));
const {
  normalizeRoleValue,
} = require(path.join(__dirname, "../account/accountRoleProfiles"));
const sessionRegistry = require(path.join(__dirname, "../chat/sessionRegistry"));
const {
  adjustCorporationWalletLPBalance,
  EVERMARK_ISSUER_CORP_ID,
  getCorporationWalletLPBalance,
} = require(path.join(__dirname, "../corporation/lpWalletState"));
const {
  CORP_ROLE_BRAND_MANAGER,
  CORP_ROLE_DIRECTOR,
  getCorporationMember,
  normalizePositiveInteger,
  toRoleMaskBigInt,
} = require(path.join(__dirname, "../corporation/corporationRuntimeState"));
const {
  getStructureByID,
  getStructureTypeByID,
  listOwnedStructures,
} = require(path.join(__dirname, "./structureState"));
const {
  STRUCTURE_OFFLINE_STATES,
  STRUCTURE_SERVICE_STATE,
  STRUCTURE_SIZE,
  STRUCTURE_UPKEEP_STATE,
} = require(path.join(__dirname, "./structureConstants"));

const TABLE_NAME = "structurePaintwork";
const ROOT_VERSION = 2;
const DEFAULT_DURATION_SECONDS = 30 * 24 * 60 * 60;
const DURATION_90_DAYS_SECONDS = 90 * 24 * 60 * 60;
const DURATION_180_DAYS_SECONDS = 180 * 24 * 60 * 60;
const STRUCTURE_PAINTWORK_DURATION_SECONDS = Object.freeze([
  DEFAULT_DURATION_SECONDS,
  DURATION_90_DAYS_SECONDS,
  DURATION_180_DAYS_SECONDS,
]);
const STRUCTURE_PAINTWORK_EXPIRY_REFLECTION_SECONDS = 5 * 60;
const DEFAULT_PRICE_AMOUNT = 0;
const HERALDRY_CORPORATION_ID = EVERMARK_ISSUER_CORP_ID;
const ACCOUNT_ROLE_PROGRAMMER = 2251799813685248n;
const ACCOUNT_ROLE_QA = 4503599627370496n;
const ACCOUNT_ROLE_GML = 18014398509481984n;
const STRUCTURE_PAINTWORK_ADMIN_ROLE_MASK =
  ACCOUNT_ROLE_PROGRAMMER | ACCOUNT_ROLE_QA | ACCOUNT_ROLE_GML;
const PAINT_ELIGIBLE_STRUCTURE_TYPE_IDS = new Set([
  35832, // Astrahus
  35833, // Fortizar
  35834, // Keepstar
  35825, // Raitaru
  35826, // Azbel
  35827, // Sotiyo
  35835, // Athanor
  35836, // Tatara
  35840, // Upwell Cynosural Beacon
  37534, // Upwell Cynosural System Jammer
  35841, // Upwell Small Stargate
]);

// CCP exposes the structure-license duration rules publicly, but not the
// raw price matrix in the shipped client bundle. These defaults are only the
// bootstrap seed; the DB cache on disk is the local runtime authority.
const DEFAULT_CATALOGUE_PRICE_BY_SIZE = Object.freeze({
  [STRUCTURE_SIZE.FLEX]: Object.freeze({
    [DEFAULT_DURATION_SECONDS]: 75000,
    [DURATION_90_DAYS_SECONDS]: 225000,
    [DURATION_180_DAYS_SECONDS]: 450000,
  }),
  [STRUCTURE_SIZE.MEDIUM]: Object.freeze({
    [DEFAULT_DURATION_SECONDS]: 100000,
    [DURATION_90_DAYS_SECONDS]: 300000,
    [DURATION_180_DAYS_SECONDS]: 600000,
  }),
  [STRUCTURE_SIZE.LARGE]: Object.freeze({
    [DEFAULT_DURATION_SECONDS]: 250000,
    [DURATION_90_DAYS_SECONDS]: 750000,
    [DURATION_180_DAYS_SECONDS]: 1500000,
  }),
  [STRUCTURE_SIZE.EXTRA_LARGE]: Object.freeze({
    [DEFAULT_DURATION_SECONDS]: 1000000,
    [DURATION_90_DAYS_SECONDS]: 3000000,
    [DURATION_180_DAYS_SECONDS]: 6000000,
  }),
  [STRUCTURE_SIZE.UNDEFINED]: Object.freeze({
    [DEFAULT_DURATION_SECONDS]: 100000,
    [DURATION_90_DAYS_SECONDS]: 300000,
    [DURATION_180_DAYS_SECONDS]: 600000,
  }),
});

let cachedRoot = null;
let cachedIndexes = null;

function getCharacterRecord(characterID) {
  const characterState = require(path.join(
    __dirname,
    "../character/characterState",
  ));
  return characterState && typeof characterState.getCharacterRecord === "function"
    ? characterState.getCharacterRecord(characterID)
    : null;
}

function cloneValue(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function areJsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readRoot() {
  const result = database.read(TABLE_NAME, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }
  return result.data;
}

function buildDefaultRoot() {
  return {
    meta: {
      version: ROOT_VERSION,
      description: "DB-backed corporation structure paintwork licenses.",
      updatedAt: new Date().toISOString(),
    },
    catalogueByTypeID: {},
    licensesByID: {},
    structureAssignments: {},
  };
}

function writeRoot(root) {
  const next = {
    meta: {
      version: ROOT_VERSION,
      description: "DB-backed corporation structure paintwork licenses.",
      ...(root && root.meta && typeof root.meta === "object" ? root.meta : {}),
      updatedAt: new Date().toISOString(),
      version: ROOT_VERSION,
    },
    catalogueByTypeID:
      root && root.catalogueByTypeID && typeof root.catalogueByTypeID === "object"
        ? root.catalogueByTypeID
        : {},
    licensesByID:
      root && root.licensesByID && typeof root.licensesByID === "object"
        ? root.licensesByID
        : {},
    structureAssignments:
      root && root.structureAssignments && typeof root.structureAssignments === "object"
        ? root.structureAssignments
        : {},
  };
  const result = database.write(TABLE_NAME, "/", next);
  if (!result.success) {
    return false;
  }
  cachedRoot = next;
  cachedIndexes = null;
  return true;
}

function ensureRoot() {
  if (cachedRoot) {
    return cachedRoot;
  }

  const current = readRoot();
  const next = buildDefaultRoot();
  next.meta =
    current.meta && typeof current.meta === "object"
      ? {
          ...next.meta,
          ...current.meta,
          version: ROOT_VERSION,
        }
      : next.meta;
  next.catalogueByTypeID =
    current.catalogueByTypeID && typeof current.catalogueByTypeID === "object"
      ? current.catalogueByTypeID
      : {};
  next.licensesByID =
    current.licensesByID && typeof current.licensesByID === "object"
      ? current.licensesByID
      : {};
  next.structureAssignments =
    current.structureAssignments && typeof current.structureAssignments === "object"
      ? current.structureAssignments
      : {};
  cachedRoot = next;
  if (
    current.meta !== next.meta ||
    current.catalogueByTypeID !== next.catalogueByTypeID ||
    current.licensesByID !== next.licensesByID ||
    current.structureAssignments !== next.structureAssignments
  ) {
    writeRoot(next);
  }
  return cachedRoot;
}

function getCorporationIDForCharacter(characterID) {
  const character = getCharacterRecord(characterID) || {};
  return normalizePositiveInteger(character.corporationID, null);
}

function canCharacterManageStructurePaintwork(characterID, corporationID = null) {
  const numericCharacterID = normalizePositiveInteger(characterID, null);
  const numericCorporationID =
    normalizePositiveInteger(corporationID, null) ||
    getCorporationIDForCharacter(numericCharacterID);
  if (!numericCharacterID || !numericCorporationID) {
    return false;
  }
  const member = getCorporationMember(numericCorporationID, numericCharacterID);
  if (!member) {
    return false;
  }
  if (member.isCEO) {
    return true;
  }
  const roles = toRoleMaskBigInt(member.roles, 0n);
  return (
    (roles & CORP_ROLE_DIRECTOR) === CORP_ROLE_DIRECTOR ||
    (roles & CORP_ROLE_BRAND_MANAGER) === CORP_ROLE_BRAND_MANAGER
  );
}

function hasStructurePaintworkAdminPrivileges(characterID) {
  const session = sessionRegistry.findSessionByCharacterID(characterID);
  const roleMask = normalizeRoleValue(session && session.role, 0n);
  return (
    roleMask > 0n &&
    (roleMask & STRUCTURE_PAINTWORK_ADMIN_ROLE_MASK) !== 0n
  );
}

function normalizeSlotValue(slot) {
  if (!slot || typeof slot !== "object") {
    return { empty: true };
  }
  if (slot.paint !== undefined && slot.paint !== null) {
    return { paint: Number(slot.paint || 0) || 0 };
  }
  if (slot.empty !== undefined) {
    return { empty: Boolean(slot.empty) };
  }
  return { empty: true };
}

function normalizePaintwork(value) {
  const paintwork = value && typeof value === "object" ? value : {};
  const next = {};
  for (const slotName of [
    "first",
    "second",
    "third",
    "fourth",
    "primary",
    "secondary",
    "detailing",
  ]) {
    if (paintwork[slotName] !== undefined) {
      next[slotName] = normalizeSlotValue(paintwork[slotName]);
    }
  }
  return next;
}

function normalizeLicenseRecord(licenseID, value = {}) {
  return {
    licenseID: String(licenseID || value.licenseID || createUuidString()).toLowerCase(),
    corporationID: normalizePositiveInteger(value.corporationID, 0) || 0,
    activatorCharacterID:
      normalizePositiveInteger(value.activatorCharacterID, 0) || 0,
    issuedAtMs: Math.max(0, Number(value.issuedAtMs || 0) || 0),
    durationSeconds: Math.max(
      0,
      Math.trunc(Number(value.durationSeconds || DEFAULT_DURATION_SECONDS) || DEFAULT_DURATION_SECONDS),
    ),
    structureID: normalizePositiveInteger(value.structureID, 0) || 0,
    structureTypeID: normalizePositiveInteger(value.structureTypeID, 0) || 0,
    solarSystemID: normalizePositiveInteger(value.solarSystemID, 0) || 0,
    priceAmount: Math.max(
      0,
      Math.trunc(Number(value.priceAmount || 0) || 0),
    ),
    associatedCorporationID:
      normalizePositiveInteger(
        value.associatedCorporationID,
        HERALDRY_CORPORATION_ID,
      ) || HERALDRY_CORPORATION_ID,
    paintwork: normalizePaintwork(value.paintwork),
  };
}

function normalizeCatalogueEntry(entry, fallbackDurationSeconds) {
  return {
    durationSeconds: Math.max(
      0,
      Math.trunc(
        Number(
          entry && entry.durationSeconds !== undefined
            ? entry.durationSeconds
            : fallbackDurationSeconds,
        ) || fallbackDurationSeconds,
      ),
    ),
    priceAmount: Math.max(
      0,
      Math.trunc(Number(entry && entry.priceAmount) || DEFAULT_PRICE_AMOUNT),
    ),
    associatedCorporationID:
      normalizePositiveInteger(
        entry && entry.associatedCorporationID,
        HERALDRY_CORPORATION_ID,
      ) || HERALDRY_CORPORATION_ID,
  };
}

function getBootstrapCataloguePrice(structureTypeID, durationSeconds) {
  const typeRecord = getStructureTypeByID(structureTypeID) || {};
  const sizeKey =
    String(typeRecord.structureSize || STRUCTURE_SIZE.UNDEFINED) || STRUCTURE_SIZE.UNDEFINED;
  const priceTable =
    DEFAULT_CATALOGUE_PRICE_BY_SIZE[sizeKey] ||
    DEFAULT_CATALOGUE_PRICE_BY_SIZE[STRUCTURE_SIZE.UNDEFINED];
  return Math.max(
    0,
    Math.trunc(Number(priceTable[durationSeconds]) || DEFAULT_PRICE_AMOUNT),
  );
}

function buildDefaultCatalogueEntries(structureTypeID) {
  return STRUCTURE_PAINTWORK_DURATION_SECONDS.map((durationSeconds) => ({
    durationSeconds,
    priceAmount: getBootstrapCataloguePrice(structureTypeID, durationSeconds),
    associatedCorporationID: HERALDRY_CORPORATION_ID,
  }));
}

function normalizeCatalogueEntriesForType(structureTypeID, rawEntries) {
  const existingByDuration = new Map();
  for (const rawEntry of Array.isArray(rawEntries) ? rawEntries : []) {
    const normalized = normalizeCatalogueEntry(rawEntry, DEFAULT_DURATION_SECONDS);
    if (
      !STRUCTURE_PAINTWORK_DURATION_SECONDS.includes(normalized.durationSeconds) ||
      existingByDuration.has(normalized.durationSeconds)
    ) {
      continue;
    }
    existingByDuration.set(normalized.durationSeconds, normalized);
  }

  return STRUCTURE_PAINTWORK_DURATION_SECONDS.map((durationSeconds) => {
    const existing = existingByDuration.get(durationSeconds);
    if (existing && existing.priceAmount > 0) {
      return existing;
    }
    return {
      durationSeconds,
      priceAmount: getBootstrapCataloguePrice(structureTypeID, durationSeconds),
      associatedCorporationID: HERALDRY_CORPORATION_ID,
    };
  });
}

function ensureCatalogueDefaults() {
  const root = ensureRoot();
  const nextCatalogue = {
    ...(root.catalogueByTypeID && typeof root.catalogueByTypeID === "object"
      ? root.catalogueByTypeID
      : {}),
  };
  let changed = false;

  for (const typeID of PAINT_ELIGIBLE_STRUCTURE_TYPE_IDS) {
    const key = String(typeID);
    const nextEntries = normalizeCatalogueEntriesForType(typeID, nextCatalogue[key]);
    if (!areJsonEqual(nextEntries, nextCatalogue[key])) {
      nextCatalogue[key] = nextEntries;
      changed = true;
    }
  }

  if (changed) {
    root.catalogueByTypeID = nextCatalogue;
    writeRoot(root);
  }

  return cloneValue(root.catalogueByTypeID || {});
}

function getCatalogueItems() {
  const catalogueByTypeID = ensureCatalogueDefaults();
  return [...PAINT_ELIGIBLE_STRUCTURE_TYPE_IDS]
    .sort((left, right) => left - right)
    .flatMap((typeID) =>
      (Array.isArray(catalogueByTypeID[String(typeID)])
        ? catalogueByTypeID[String(typeID)]
        : []
      ).map((entry) => ({
        structureTypeID: typeID,
        ...normalizeCatalogueEntry(entry, DEFAULT_DURATION_SECONDS),
      })),
    );
}

function getCatalogueItemForStructureTypeAndDuration(structureTypeID, durationSeconds) {
  const normalizedStructureTypeID = normalizePositiveInteger(structureTypeID, 0);
  const normalizedDurationSeconds = Math.max(
    0,
    Math.trunc(Number(durationSeconds || 0) || 0),
  );
  const entries = ensureCatalogueDefaults()[String(normalizedStructureTypeID)];
  if (!Array.isArray(entries)) {
    return null;
  }
  const match = entries.find(
    (entry) =>
      Math.trunc(Number(entry && entry.durationSeconds) || 0) ===
      normalizedDurationSeconds,
  );
  return match
    ? {
        structureTypeID: normalizedStructureTypeID,
        ...normalizeCatalogueEntry(match, normalizedDurationSeconds),
      }
    : null;
}

function getLicenseExpiresAtMs(license) {
  return (
    Math.max(0, Number(license && license.issuedAtMs) || 0) +
    Math.max(0, Number(license && license.durationSeconds) || 0) * 1000
  );
}

function isLicenseExpired(license, nowMs = Date.now()) {
  return (
    getLicenseExpiresAtMs(license) +
      STRUCTURE_PAINTWORK_EXPIRY_REFLECTION_SECONDS * 1000 <=
    Math.max(0, Number(nowMs || 0) || 0)
  );
}

function hasAnyOnlineServiceModule(structure) {
  const serviceStates =
    structure && structure.serviceStates && typeof structure.serviceStates === "object"
      ? structure.serviceStates
      : {};
  return Object.values(serviceStates).some(
    (stateID) =>
      Number(stateID || 0) === STRUCTURE_SERVICE_STATE.ONLINE,
  );
}

function canApplyPaintworkLicenseToStructure(structure) {
  if (!structure || structure.destroyedAt || structure.unanchoring) {
    return false;
  }
  if (!PAINT_ELIGIBLE_STRUCTURE_TYPE_IDS.has(Number(structure.typeID || 0) || 0)) {
    return false;
  }
  if (STRUCTURE_OFFLINE_STATES.has(Number(structure.state || 0) || 0)) {
    return false;
  }
  if (Number(structure.upkeepState || 0) !== STRUCTURE_UPKEEP_STATE.FULL_POWER) {
    return false;
  }
  return hasAnyOnlineServiceModule(structure);
}

function isStructurePaintworkDisplayable(structure) {
  return canApplyPaintworkLicenseToStructure(structure);
}

function buildIndexes() {
  ensureCatalogueDefaults();
  const root = ensureRoot();
  const licenseCandidatesByStructureID = new Map();

  for (const [licenseID, rawLicense] of Object.entries(root.licensesByID || {})) {
    const license = normalizeLicenseRecord(licenseID, rawLicense);
    const structure = getStructureByID(license.structureID, { refresh: false });
    if (!structure) {
      continue;
    }
    if (!PAINT_ELIGIBLE_STRUCTURE_TYPE_IDS.has(Number(structure.typeID || 0) || 0)) {
      continue;
    }
    if (Number(structure.ownerCorpID || 0) !== Number(license.corporationID || 0)) {
      continue;
    }
    if (isLicenseExpired(license)) {
      continue;
    }

    const normalizedLicense = {
      ...license,
      structureTypeID: Number(structure.typeID || 0) || 0,
      solarSystemID: Number(structure.solarSystemID || 0) || 0,
    };
    const existing = licenseCandidatesByStructureID.get(normalizedLicense.structureID);
    if (
      existing &&
      Number(existing.issuedAtMs || 0) > Number(normalizedLicense.issuedAtMs || 0)
    ) {
      continue;
    }
    licenseCandidatesByStructureID.set(normalizedLicense.structureID, normalizedLicense);
  }

  const sanitizedLicenses = [...licenseCandidatesByStructureID.values()].sort((left, right) => {
    if (left.corporationID !== right.corporationID) {
      return left.corporationID - right.corporationID;
    }
    if (left.structureID !== right.structureID) {
      return left.structureID - right.structureID;
    }
    return left.licenseID.localeCompare(right.licenseID);
  });
  const sanitizedLicensesByID = Object.fromEntries(
    sanitizedLicenses.map((license) => [license.licenseID, cloneValue(license)]),
  );
  const sanitizedStructureAssignments = Object.fromEntries(
    sanitizedLicenses.map((license) => [String(license.structureID), license.licenseID]),
  );

  if (
    !areJsonEqual(root.licensesByID || {}, sanitizedLicensesByID) ||
    !areJsonEqual(root.structureAssignments || {}, sanitizedStructureAssignments)
  ) {
    root.licensesByID = sanitizedLicensesByID;
    root.structureAssignments = sanitizedStructureAssignments;
    writeRoot(root);
  }

  const licensesByID = new Map();
  const visibleLicenseByStructureID = new Map();
  const licensesByCorporation = new Map();
  const paintworksBySolarSystem = new Map();

  for (const license of sanitizedLicenses) {
    licensesByID.set(license.licenseID, license);
    if (!licensesByCorporation.has(license.corporationID)) {
      licensesByCorporation.set(license.corporationID, []);
    }
    licensesByCorporation.get(license.corporationID).push(license);

    const structure = getStructureByID(license.structureID, { refresh: false });
    if (!isStructurePaintworkDisplayable(structure)) {
      continue;
    }
    visibleLicenseByStructureID.set(license.structureID, license);
    if (!paintworksBySolarSystem.has(license.solarSystemID)) {
      paintworksBySolarSystem.set(license.solarSystemID, []);
    }
    paintworksBySolarSystem.get(license.solarSystemID).push(license);
  }

  cachedIndexes = {
    licensesByID,
    visibleLicenseByStructureID,
    licensesByCorporation,
    paintworksBySolarSystem,
  };
  return cachedIndexes;
}

function getLicense(licenseID) {
  const license = buildIndexes().licensesByID.get(String(licenseID || "").toLowerCase());
  return license ? cloneValue(license) : null;
}

function getLicenseForStructure(structureID) {
  const license = buildIndexes().visibleLicenseByStructureID.get(Number(structureID) || 0);
  return license ? cloneValue(license) : null;
}

function getLicensesForCorporation(corporationID) {
  return cloneValue(
    buildIndexes().licensesByCorporation.get(Number(corporationID) || 0) || [],
  );
}

function getPaintworksForSolarSystem(solarSystemID) {
  return cloneValue(
    buildIndexes().paintworksBySolarSystem.get(Number(solarSystemID) || 0) || [],
  );
}

function removeLicenseRecord(licenseID) {
  const targetID = String(licenseID || "").toLowerCase();
  if (!targetID) {
    return false;
  }

  buildIndexes();
  const root = ensureRoot();
  if (!root.licensesByID || !root.licensesByID[targetID]) {
    return false;
  }

  delete root.licensesByID[targetID];
  if (root.structureAssignments && typeof root.structureAssignments === "object") {
    for (const [structureID, assignedLicenseID] of Object.entries(root.structureAssignments)) {
      if (String(assignedLicenseID || "").toLowerCase() === targetID) {
        delete root.structureAssignments[structureID];
      }
    }
  }
  writeRoot(root);
  return true;
}

function buildWritableLicenseMapFromIndexes() {
  return Object.fromEntries(
    [...buildIndexes().licensesByID.values()].map((license) => [
      license.licenseID,
      cloneValue(license),
    ]),
  );
}

function normalizeIssueOptions(options = {}) {
  return {
    adminRequest: options.adminRequest === true,
    useCatalogue: options.useCatalogue !== false,
    priceAmount:
      options.priceAmount === undefined || options.priceAmount === null
        ? null
        : Math.max(0, Math.trunc(Number(options.priceAmount) || 0)),
  };
}

function resolvePerStructureIssuePrice(structure, durationSeconds, options = {}) {
  const normalizedOptions = normalizeIssueOptions(options);
  if (!normalizedOptions.adminRequest || normalizedOptions.useCatalogue) {
    const catalogueItem = getCatalogueItemForStructureTypeAndDuration(
      structure && structure.typeID,
      durationSeconds,
    );
    if (!catalogueItem) {
      return {
        success: false,
        errorMsg: "INVALID_DATA",
      };
    }
    return {
      success: true,
      data: catalogueItem.priceAmount,
    };
  }

  if (normalizedOptions.priceAmount === null) {
    return {
      success: false,
      errorMsg: "INVALID_DATA",
    };
  }

  return {
    success: true,
    data: normalizedOptions.priceAmount,
  };
}

function issueLicenses(characterID, paintwork, durationSeconds, structureIDs = [], options = {}) {
  const normalizedOptions = normalizeIssueOptions(options);
  const corporationID = getCorporationIDForCharacter(characterID);
  const hasAdminPrivileges =
    normalizedOptions.adminRequest && hasStructurePaintworkAdminPrivileges(characterID);

  if (normalizedOptions.adminRequest && !hasAdminPrivileges) {
    return { success: false, errorMsg: "INSUFFICIENT_ROLES" };
  }

  if (!normalizedOptions.adminRequest && !canCharacterManageStructurePaintwork(characterID, corporationID)) {
    return { success: false, errorMsg: "INSUFFICIENT_ROLES" };
  }

  const requestedDurationSeconds = Math.max(
    0,
    Math.trunc(Number(durationSeconds || 0) || 0),
  );
  if (
    requestedDurationSeconds <= 0 ||
    (!normalizedOptions.adminRequest &&
      !STRUCTURE_PAINTWORK_DURATION_SECONDS.includes(requestedDurationSeconds))
  ) {
    return { success: false, errorMsg: "INVALID_DATA" };
  }

  const requestedStructureIDs = Array.isArray(structureIDs)
    ? structureIDs.map((structureID) => Number(structureID || 0) || 0).filter(Boolean)
    : [];
  if (requestedStructureIDs.length === 0 || !corporationID) {
    return { success: false, errorMsg: "INVALID_DATA" };
  }

  const ownedStructureIDs = new Set(
    listOwnedStructures(corporationID).map(
      (structure) => Number(structure.structureID || 0) || 0,
    ),
  );
  const normalizedPaintwork = normalizePaintwork(paintwork);
  if (Object.keys(normalizedPaintwork).length === 0) {
    return { success: false, errorMsg: "INVALID_DATA" };
  }

  const issues = [];
  for (const structureID of requestedStructureIDs) {
    if (!ownedStructureIDs.has(structureID)) {
      return { success: false, errorMsg: "INVALID_DATA" };
    }
    const structure = getStructureByID(structureID, { refresh: false });
    if (!structure || !canApplyPaintworkLicenseToStructure(structure)) {
      return { success: false, errorMsg: "INVALID_DATA" };
    }

    const priceResult = resolvePerStructureIssuePrice(
      structure,
      requestedDurationSeconds,
      normalizedOptions,
    );
    if (!priceResult.success) {
      return priceResult;
    }

    issues.push({
      structure,
      priceAmount: priceResult.data,
    });
  }

  const totalPriceAmount = issues.reduce(
    (total, entry) => total + Math.max(0, Number(entry.priceAmount || 0) || 0),
    0,
  );
  if (
    getCorporationWalletLPBalance(corporationID, HERALDRY_CORPORATION_ID) <
    totalPriceAmount
  ) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_BALANCE",
    };
  }

  let debitApplied = false;
  if (totalPriceAmount > 0) {
    const debitResult = adjustCorporationWalletLPBalance(
      corporationID,
      HERALDRY_CORPORATION_ID,
      -totalPriceAmount,
      { reason: "structure_paintwork_issue" },
    );
    if (!debitResult.success) {
      return {
        success: false,
        errorMsg: "INSUFFICIENT_BALANCE",
      };
    }
    debitApplied = true;
  }

  const root = ensureRoot();
  const nextRoot = cloneValue(root);
  nextRoot.licensesByID = buildWritableLicenseMapFromIndexes();
  nextRoot.structureAssignments = Object.fromEntries(
    Object.values(nextRoot.licensesByID || {}).map((license) => [
      String(license.structureID),
      license.licenseID,
    ]),
  );

  const issued = [];
  for (const entry of issues) {
    const structure = entry.structure;
    const existing = Object.values(nextRoot.licensesByID || {}).find(
      (license) => Number(license && license.structureID) === Number(structure.structureID),
    );
    if (existing) {
      delete nextRoot.licensesByID[existing.licenseID];
      delete nextRoot.structureAssignments[String(existing.structureID)];
    }

    const license = normalizeLicenseRecord(createUuidString(), {
      corporationID,
      activatorCharacterID: characterID,
      issuedAtMs: Date.now(),
      durationSeconds: requestedDurationSeconds,
      structureID: Number(structure.structureID || 0) || 0,
      structureTypeID: Number(structure.typeID || 0) || 0,
      solarSystemID: Number(structure.solarSystemID || 0) || 0,
      priceAmount: entry.priceAmount,
      associatedCorporationID: HERALDRY_CORPORATION_ID,
      paintwork: normalizedPaintwork,
    });
    nextRoot.licensesByID[license.licenseID] = cloneValue(license);
    nextRoot.structureAssignments[String(license.structureID)] = license.licenseID;
    issued.push(license);
  }

  if (!writeRoot(nextRoot)) {
    if (debitApplied) {
      adjustCorporationWalletLPBalance(
        corporationID,
        HERALDRY_CORPORATION_ID,
        totalPriceAmount,
        { reason: "structure_paintwork_issue_rollback" },
      );
    }
    return {
      success: false,
      errorMsg: "WRITE_FAILED",
    };
  }

  return {
    success: true,
    data: issued,
  };
}

function revokeLicense(characterID, licenseID, options = {}) {
  const normalizedOptions = normalizeIssueOptions(options);
  const license = getLicense(licenseID);
  if (!license) {
    return { success: false, errorMsg: "NOT_FOUND" };
  }
  const hasAdminPrivileges =
    normalizedOptions.adminRequest && hasStructurePaintworkAdminPrivileges(characterID);
  if (normalizedOptions.adminRequest && !hasAdminPrivileges) {
    return { success: false, errorMsg: "INSUFFICIENT_ROLES" };
  }
  if (
    !normalizedOptions.adminRequest &&
    !canCharacterManageStructurePaintwork(characterID, license.corporationID)
  ) {
    return { success: false, errorMsg: "INSUFFICIENT_ROLES" };
  }
  removeLicenseRecord(license.licenseID);
  return { success: true, data: license };
}

function resetCache() {
  cachedRoot = null;
  cachedIndexes = null;
}

module.exports = {
  DEFAULT_DURATION_SECONDS,
  DEFAULT_PRICE_AMOUNT,
  HERALDRY_CORPORATION_ID,
  PAINT_ELIGIBLE_STRUCTURE_TYPE_IDS,
  STRUCTURE_PAINTWORK_DURATION_SECONDS,
  STRUCTURE_PAINTWORK_EXPIRY_REFLECTION_SECONDS,
  canApplyPaintworkLicenseToStructure,
  canCharacterManageStructurePaintwork,
  getCatalogueItemForStructureTypeAndDuration,
  getCatalogueItems,
  getCorporationIDForCharacter,
  getLicense,
  getLicenseForStructure,
  getLicensesForCorporation,
  getPaintworksForSolarSystem,
  hasStructurePaintworkAdminPrivileges,
  issueLicenses,
  isLicenseExpired,
  isStructurePaintworkDisplayable,
  normalizePaintwork,
  revokeLicense,
  _testing: {
    buildDefaultCatalogueEntries,
    normalizeLicenseRecord,
    readRoot,
    resetCache,
  },
};
