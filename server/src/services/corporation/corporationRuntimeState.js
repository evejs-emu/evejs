const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const {
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getStationRecord,
} = require(path.join(__dirname, "../_shared/stationStaticData"));
const {
  normalizeAggressionSettings,
} = require(path.join(__dirname, "./aggressionSettingsState"));
const {
  getAllianceCorporationIDs,
  ALLIANCES_TABLE,
  CORPORATIONS_TABLE,
  createCustomAllianceForCorporation,
  createCustomCorporation,
  ensureAlliancesInitialized,
  ensureCorporationsInitialized,
  getAllianceRecord,
  getCharacterIDsInCorporation,
  getCorporationRecord,
  setCorporationAlliance,
} = require(path.join(__dirname, "./corporationState"));

const CORPORATION_RUNTIME_TABLE = "corporationRuntime";
const RUNTIME_VERSION = 1;
const PAGE_SIZE = 50;
const CORPORATION_WALLET_KEY_START = 1000;
const MAX_TITLE_COUNT = 16;
const DEFAULT_STRUCTURE_REINFORCE_HOUR = 20;

const CORP_ROLE_DIRECTOR = 1n;
const CORP_ROLE_PERSONNEL_MANAGER = 128n;
const CORP_ROLE_ACCOUNTANT = 256n;
const CORP_ROLE_FACTORY_MANAGER = 1024n;
const CORP_ROLE_STATION_MANAGER = 2048n;
const CORP_ROLE_HANGAR_CAN_TAKE_ALL =
  8192n + 16384n + 32768n + 65536n + 131072n + 262144n + 524288n;
const CORP_ROLE_HANGAR_CAN_QUERY_ALL =
  1048576n + 2097152n + 4194304n + 8388608n + 16777216n + 33554432n + 67108864n;
const CORP_ROLE_BRAND_MANAGER = 34359738368n;
const CORP_ROLE_JUNIOR_ACCOUNTANT = 4503599627370496n;
const CORP_ROLE_TRADER = 18014398509481984n;
const CORP_ROLE_CHAT_MANAGER = 36028797018963968n;
const CORP_ROLE_PROJECT_MANAGER = 1152921504606846976n;
const FULL_ADMIN_ROLE_MASK =
  CORP_ROLE_DIRECTOR +
  CORP_ROLE_PERSONNEL_MANAGER +
  CORP_ROLE_ACCOUNTANT +
  CORP_ROLE_FACTORY_MANAGER +
  CORP_ROLE_STATION_MANAGER +
  CORP_ROLE_HANGAR_CAN_TAKE_ALL +
  CORP_ROLE_HANGAR_CAN_QUERY_ALL +
  CORP_ROLE_BRAND_MANAGER +
  CORP_ROLE_JUNIOR_ACCOUNTANT +
  CORP_ROLE_TRADER +
  CORP_ROLE_CHAT_MANAGER +
  CORP_ROLE_PROJECT_MANAGER;
const FULL_LOCATIONAL_ROLE_MASK =
  CORP_ROLE_HANGAR_CAN_TAKE_ALL + CORP_ROLE_HANGAR_CAN_QUERY_ALL;
const MARSHAL_TEXT_TYPES = new Set([
  "wstring",
  "string",
  "token",
  "PyWString",
  "PyString",
  "PyToken",
]);
const MARSHAL_NUMBER_TYPES = new Set([
  "int",
  "long",
  "float",
  "double",
  "bool",
  "PyInt",
  "PyLong",
  "PyFloat",
  "PyBool",
]);
let runtimeTableCache = null;
let runtimeBootstrapComplete = false;
let officesByStationCache = new Map();
let officesByInventoryIDCache = new Map();
let officesByStationCacheDirty = true;

function getCharacterState() {
  return require(path.join(__dirname, "../character/characterState"));
}

function resetRuntimeCaches() {
  runtimeTableCache = null;
  runtimeBootstrapComplete = false;
  officesByStationCache = new Map();
  officesByInventoryIDCache = new Map();
  officesByStationCacheDirty = true;
}

function cloneValue(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

// The live client sends PyString/PyWString wrappers for many corp fields.
// Without unwrapping them here, custom corps persist literal "[object Object]".
function unwrapMarshalScalar(value) {
  if (value === undefined || value === null) {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  if (
    value &&
    typeof value === "object" &&
    (MARSHAL_TEXT_TYPES.has(value.type) || MARSHAL_NUMBER_TYPES.has(value.type))
  ) {
    return unwrapMarshalScalar(value.value);
  }
  return value;
}

function normalizeInteger(value, fallback = 0) {
  const numericValue = Number(unwrapMarshalScalar(value));
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.trunc(numericValue);
}

function normalizePositiveInteger(value, fallback = null) {
  const numericValue = normalizeInteger(value, 0);
  return numericValue > 0 ? numericValue : fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }
  const unwrappedValue = unwrapMarshalScalar(value);
  if (typeof unwrappedValue === "string") {
    const normalizedValue = unwrappedValue.trim().toLowerCase();
    if (!normalizedValue) {
      return fallback;
    }
    if (normalizedValue === "0" || normalizedValue === "false") {
      return false;
    }
    if (normalizedValue === "1" || normalizedValue === "true") {
      return true;
    }
  }
  return Boolean(unwrappedValue);
}

function normalizeText(value, fallback = "") {
  if (value === undefined || value === null) {
    return fallback;
  }
  const unwrappedValue = unwrapMarshalScalar(value);
  if (unwrappedValue === undefined || unwrappedValue === null) {
    return fallback;
  }
  if (typeof unwrappedValue === "string") {
    return unwrappedValue;
  }
  return String(unwrappedValue);
}

function normalizeRgbColor(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const red = normalizeInteger(value.red, null);
  const green = normalizeInteger(value.green, null);
  const blue = normalizeInteger(value.blue, null);
  if (
    red === null ||
    green === null ||
    blue === null ||
    red < 0 ||
    red > 255 ||
    green < 0 ||
    green > 255 ||
    blue < 0 ||
    blue > 255
  ) {
    return null;
  }
  return { red, green, blue };
}

function normalizeCorporationColorPalette(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const mainColor = normalizeRgbColor(value.mainColor || value.main_color);
  if (!mainColor) {
    return null;
  }
  return {
    mainColor,
    secondaryColor: normalizeRgbColor(value.secondaryColor || value.secondary_color),
    tertiaryColor: normalizeRgbColor(value.tertiaryColor || value.tertiary_color),
    lastModifierCharacterID: normalizePositiveInteger(
      value.lastModifierCharacterID || value.last_modifier_character_id,
      null,
    ),
    lastModified: normalizeFiletimeString(value.lastModified || value.last_modified),
  };
}

function normalizeFiletimeString(value, fallback = null) {
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  return fallback || currentFileTime().toString();
}

function normalizeRoleMaskString(value, fallback = "0") {
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.trunc(value)).toString();
  }
  return fallback;
}

function toRoleMaskBigInt(value, fallback = 0n) {
  try {
    if (typeof value === "bigint") {
      return value;
    }
    if (
      value &&
      typeof value === "object" &&
      (value.type === "long" || value.type === "int")
    ) {
      return toRoleMaskBigInt(value.value, fallback);
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return BigInt(Math.trunc(value));
    }
    if (typeof value === "string" && value.trim() !== "") {
      return BigInt(value);
    }
  } catch (error) {
    return fallback;
  }
  return fallback;
}

function readTable(tableName, fallback) {
  const result = database.read(tableName, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return cloneValue(fallback);
  }
  return cloneValue(result.data);
}

function readTableView(tableName, fallback) {
  const result = database.read(tableName, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return fallback;
  }
  return result.data;
}

function writeTable(tableName, payload) {
  const writeResult = database.write(tableName, "/", cloneValue(payload));
  return {
    success: Boolean(writeResult && writeResult.success),
    errorMsg: writeResult && writeResult.errorMsg ? writeResult.errorMsg : null,
  };
}

function readCorporationTable() {
  return readTable(CORPORATIONS_TABLE, { _meta: {}, records: {} });
}

function readAllianceTable() {
  return readTable(ALLIANCES_TABLE, { _meta: {}, records: {} });
}

function buildDefaultDivisionNames() {
  const names = {};
  for (let index = 1; index <= 7; index += 1) {
    names[index] = `Division ${index}`;
    names[index + 7] = `Wallet Division ${index}`;
  }
  return names;
}

function buildDefaultTitleMap() {
  const titles = {};
  for (let index = 0; index < MAX_TITLE_COUNT; index += 1) {
    const titleID = 2 ** index;
    titles[String(titleID)] = {
      titleID,
      titleName: "",
      roles: "0",
      grantableRoles: "0",
      rolesAtHQ: "0",
      grantableRolesAtHQ: "0",
      rolesAtBase: "0",
      grantableRolesAtBase: "0",
      rolesAtOther: "0",
      grantableRolesAtOther: "0",
    };
  }
  return titles;
}

function buildDefaultWalletDivisions() {
  const divisions = {};
  for (let index = 0; index < 7; index += 1) {
    const key = CORPORATION_WALLET_KEY_START + index;
    divisions[String(key)] = {
      key,
      balance: 0,
      journal: [],
      transactions: [],
    };
  }
  return divisions;
}

function buildDefaultMemberState(characterID, corporationRecord) {
  const characterState = getCharacterState();
  const getCharacterRecord =
    characterState && typeof characterState.getCharacterRecord === "function"
      ? characterState.getCharacterRecord
      : null;
  const characterRecord = getCharacterRecord ? (getCharacterRecord(characterID) || {}) : {};
  const isCEO = Number(corporationRecord && corporationRecord.ceoID) === Number(characterID);
  const roleMask = isCEO ? FULL_ADMIN_ROLE_MASK : 0n;
  const locationalRoleMask = isCEO ? FULL_LOCATIONAL_ROLE_MASK : 0n;
  return {
    characterID: normalizePositiveInteger(characterID, 0) || 0,
    corporationID: normalizePositiveInteger(
      corporationRecord && corporationRecord.corporationID,
      0,
    ) || 0,
    startDate: normalizeFiletimeString(
      characterRecord.startDateTime || characterRecord.createDateTime,
    ),
    title: normalizeText(characterRecord.title, ""),
    divisionID: normalizeInteger(characterRecord.divisionID, 0),
    squadronID: normalizeInteger(characterRecord.squadronID, 0),
    roles: roleMask.toString(),
    grantableRoles: roleMask.toString(),
    rolesAtHQ: locationalRoleMask.toString(),
    grantableRolesAtHQ: locationalRoleMask.toString(),
    rolesAtBase: locationalRoleMask.toString(),
    grantableRolesAtBase: locationalRoleMask.toString(),
    rolesAtOther: locationalRoleMask.toString(),
    grantableRolesAtOther: locationalRoleMask.toString(),
    baseID: normalizePositiveInteger(
      characterRecord.baseID ||
        characterRecord.homeStationID ||
        characterRecord.cloneStationID ||
        characterRecord.stationID,
      null,
    ),
    titleMask: 0,
    blockRoles: null,
    accountKey: CORPORATION_WALLET_KEY_START,
    isCEO,
    lastOnline: normalizeFiletimeString(currentFileTime()),
    locationID: normalizePositiveInteger(
      characterRecord.stationID ||
        characterRecord.structureID ||
        characterRecord.solarSystemID,
      null,
    ),
    shipTypeID: normalizePositiveInteger(characterRecord.shipTypeID, null),
  };
}

function ensureMetaDefaults(meta = {}) {
  return {
    version: RUNTIME_VERSION,
    nextLabelID: normalizePositiveInteger(meta.nextLabelID, 1) || 1,
    nextBulletinID: normalizePositiveInteger(meta.nextBulletinID, 1) || 1,
    nextApplicationID: normalizePositiveInteger(meta.nextApplicationID, 1) || 1,
    nextInvitationID: normalizePositiveInteger(meta.nextInvitationID, 1) || 1,
    nextRecruitmentAdID:
      normalizePositiveInteger(meta.nextRecruitmentAdID, 1) || 1,
    nextMedalID: normalizePositiveInteger(meta.nextMedalID, 1) || 1,
    nextOfficeID: normalizePositiveInteger(meta.nextOfficeID, 1) || 1,
    nextOfficeFolderID: normalizePositiveInteger(meta.nextOfficeFolderID, 1) || 1,
    nextOfficeItemID: normalizePositiveInteger(meta.nextOfficeItemID, 1) || 1,
    nextBillID: normalizePositiveInteger(meta.nextBillID, 1) || 1,
    nextWarID: normalizePositiveInteger(meta.nextWarID, 1) || 1,
    nextNegotiationID: normalizePositiveInteger(meta.nextNegotiationID, 1) || 1,
    nextTreatyID: normalizePositiveInteger(meta.nextTreatyID, 1) || 1,
  };
}

function allocateRuntimeID(table, key) {
  const currentValue = normalizePositiveInteger(table._meta[key], 1) || 1;
  table._meta[key] = currentValue + 1;
  return currentValue;
}

function buildOfficeRecord(table, corporationRecord, stationID) {
  const station = getStationRecord(null, stationID);
  const stationTypeID = normalizePositiveInteger(
    station && station.stationTypeID,
    null,
  );
  return {
    corporationID: corporationRecord.corporationID,
    stationID: normalizePositiveInteger(stationID, 0) || 0,
    officeID: allocateRuntimeID(table, "nextOfficeID"),
    officeFolderID: allocateRuntimeID(table, "nextOfficeFolderID"),
    itemID: allocateRuntimeID(table, "nextOfficeItemID"),
    solarSystemID: normalizePositiveInteger(station && station.solarSystemID, null),
    typeID: stationTypeID,
    stationTypeID,
    rentalCost: Number((station && station.officeRentalCost) || 0),
    expiryDate: normalizeFiletimeString(currentFileTime()),
    impounded: false,
  };
}

function normalizeMemberState(member, corporationRecord, explicitCharacterID = null) {
  const defaultState = buildDefaultMemberState(
    explicitCharacterID !== null && explicitCharacterID !== undefined
      ? explicitCharacterID
      : member && member.characterID,
    corporationRecord,
  );
  const isCEO = Boolean(defaultState.isCEO);
  const roles = isCEO
    ? defaultState.roles
    : normalizeRoleMaskString(member && member.roles, defaultState.roles);
  const grantableRoles = isCEO
    ? defaultState.grantableRoles
    : normalizeRoleMaskString(
        member && member.grantableRoles,
        defaultState.grantableRoles,
      );
  const rolesAtHQ = isCEO
    ? defaultState.rolesAtHQ
    : normalizeRoleMaskString(
        member && member.rolesAtHQ,
        defaultState.rolesAtHQ,
      );
  const grantableRolesAtHQ = isCEO
    ? defaultState.grantableRolesAtHQ
    : normalizeRoleMaskString(
        member && member.grantableRolesAtHQ,
        defaultState.grantableRolesAtHQ,
      );
  const rolesAtBase = isCEO
    ? defaultState.rolesAtBase
    : normalizeRoleMaskString(
        member && member.rolesAtBase,
        defaultState.rolesAtBase,
      );
  const grantableRolesAtBase = isCEO
    ? defaultState.grantableRolesAtBase
    : normalizeRoleMaskString(
        member && member.grantableRolesAtBase,
        defaultState.grantableRolesAtBase,
      );
  const rolesAtOther = isCEO
    ? defaultState.rolesAtOther
    : normalizeRoleMaskString(
        member && member.rolesAtOther,
        defaultState.rolesAtOther,
      );
  const grantableRolesAtOther = isCEO
    ? defaultState.grantableRolesAtOther
    : normalizeRoleMaskString(
        member && member.grantableRolesAtOther,
        defaultState.grantableRolesAtOther,
      );
  return {
    ...defaultState,
    ...cloneValue(member || {}),
    characterID: normalizePositiveInteger(
      member && member.characterID,
      defaultState.characterID,
    ),
    corporationID: normalizePositiveInteger(
      member && member.corporationID,
      defaultState.corporationID,
    ),
    startDate: normalizeFiletimeString(
      member && member.startDate,
      defaultState.startDate,
    ),
    title: normalizeText(member && member.title, defaultState.title),
    divisionID: normalizeInteger(
      member && member.divisionID,
      defaultState.divisionID,
    ),
    squadronID: normalizeInteger(
      member && member.squadronID,
      defaultState.squadronID,
    ),
    roles,
    grantableRoles,
    rolesAtHQ,
    grantableRolesAtHQ,
    rolesAtBase,
    grantableRolesAtBase,
    rolesAtOther,
    grantableRolesAtOther,
    baseID: normalizePositiveInteger(
      member && member.baseID,
      defaultState.baseID,
    ),
    titleMask: normalizeInteger(
      member && member.titleMask,
      defaultState.titleMask,
    ),
    blockRoles:
      member && member.blockRoles !== undefined && member.blockRoles !== null
        ? normalizeRoleMaskString(member.blockRoles, "0")
        : null,
    accountKey: normalizeInteger(
      member && member.accountKey,
      defaultState.accountKey,
    ),
    isCEO,
    lastOnline: normalizeFiletimeString(
      member && member.lastOnline,
      defaultState.lastOnline,
    ),
    locationID: normalizePositiveInteger(
      member && member.locationID,
      defaultState.locationID,
    ),
    shipTypeID: normalizePositiveInteger(
      member && member.shipTypeID,
      defaultState.shipTypeID,
    ),
  };
}

function normalizeTitleState(title, titleID) {
  return {
    titleID: normalizePositiveInteger(titleID || (title && title.titleID), 1) || 1,
    titleName: normalizeText(title && title.titleName, ""),
    roles: normalizeRoleMaskString(title && title.roles, "0"),
    grantableRoles: normalizeRoleMaskString(title && title.grantableRoles, "0"),
    rolesAtHQ: normalizeRoleMaskString(title && title.rolesAtHQ, "0"),
    grantableRolesAtHQ: normalizeRoleMaskString(
      title && title.grantableRolesAtHQ,
      "0",
    ),
    rolesAtBase: normalizeRoleMaskString(title && title.rolesAtBase, "0"),
    grantableRolesAtBase: normalizeRoleMaskString(
      title && title.grantableRolesAtBase,
      "0",
    ),
    rolesAtOther: normalizeRoleMaskString(title && title.rolesAtOther, "0"),
    grantableRolesAtOther: normalizeRoleMaskString(
      title && title.grantableRolesAtOther,
      "0",
    ),
  };
}

function normalizeCorporationRuntime(runtime, corporationRecord, table) {
  const base = runtime && typeof runtime === "object" ? cloneValue(runtime) : {};
  const memberIDs = getCharacterIDsInCorporation(corporationRecord.corporationID);
  const members = {};
  for (const memberID of memberIDs) {
    members[String(memberID)] = normalizeMemberState(
      base.members && base.members[String(memberID)],
      corporationRecord,
      memberID,
    );
  }

  const titles = {};
  const defaultTitles = buildDefaultTitleMap();
  for (const [titleKey, defaultTitle] of Object.entries(defaultTitles)) {
    titles[titleKey] = normalizeTitleState(
      base.titles && base.titles[titleKey],
      defaultTitle.titleID,
    );
  }

  const offices = {};
  if (base.offices && typeof base.offices === "object") {
    for (const [officeKey, office] of Object.entries(base.offices)) {
      const stationID = normalizePositiveInteger(office && office.stationID, null);
      if (!stationID) {
        continue;
      }
      offices[officeKey] = {
        corporationID: corporationRecord.corporationID,
        stationID,
        officeID: normalizePositiveInteger(office.officeID, null),
        officeFolderID: normalizePositiveInteger(office.officeFolderID, null),
        itemID: normalizePositiveInteger(office.itemID, null),
        solarSystemID: normalizePositiveInteger(office.solarSystemID, null),
        stationTypeID: normalizePositiveInteger(
          office.stationTypeID,
          normalizePositiveInteger(office.typeID, null),
        ),
        typeID: normalizePositiveInteger(
          office.typeID,
          normalizePositiveInteger(office.stationTypeID, null),
        ),
        rentalCost: Number(office.rentalCost || 0),
        expiryDate: normalizeFiletimeString(office.expiryDate),
        impounded: normalizeBoolean(office.impounded, false),
      };
    }
  }
  if (
    Object.keys(offices).length === 0 &&
    normalizePositiveInteger(corporationRecord.stationID, null)
  ) {
    const office = buildOfficeRecord(
      table,
      corporationRecord,
      corporationRecord.stationID,
    );
    offices[String(office.officeID)] = office;
  }

  const divisionNames = buildDefaultDivisionNames();
  if (base.divisionNames && typeof base.divisionNames === "object") {
    for (const [key, value] of Object.entries(base.divisionNames)) {
      const index = normalizeInteger(key, 0);
      if (index >= 1 && index <= 14) {
        divisionNames[index] = normalizeText(value, divisionNames[index]);
      }
    }
  }

  const wallet = {
    divisions: buildDefaultWalletDivisions(),
    lpBalance: Number((base.wallet && base.wallet.lpBalance) || 0),
    billBalance: Number((base.wallet && base.wallet.billBalance) || 0),
  };
  if (
    base.wallet &&
    base.wallet.divisions &&
    typeof base.wallet.divisions === "object"
  ) {
    for (const [divisionKey, division] of Object.entries(base.wallet.divisions)) {
      if (!wallet.divisions[divisionKey]) {
        continue;
      }
      wallet.divisions[divisionKey] = {
        key: normalizeInteger(
          division && division.key,
          wallet.divisions[divisionKey].key,
        ),
        balance: Number(
          (division && division.balance) || wallet.divisions[divisionKey].balance,
        ),
        journal: Array.isArray(division && division.journal)
          ? cloneValue(division.journal)
          : [],
        transactions: Array.isArray(division && division.transactions)
          ? cloneValue(division.transactions)
          : [],
      };
    }
  }

  return {
    version: RUNTIME_VERSION,
    divisionNames,
    welcomeMail: normalizeText(base.welcomeMail, ""),
    welcomeMailCharacterID: normalizePositiveInteger(
      base.welcomeMailCharacterID,
      null,
    ),
    welcomeMailChangeDate: normalizeFiletimeString(
      base.welcomeMailChangeDate,
      "0",
    ),
    applicationsEnabled:
      base.applicationsEnabled === undefined
        ? 1
        : normalizeBoolean(base.applicationsEnabled, true)
          ? 1
          : 0,
    acceptStructures: normalizeBoolean(base.acceptStructures, true),
    restrictCorpMails: normalizeBoolean(base.restrictCorpMails, false),
    structureReinforceDefault: normalizeInteger(
      base.structureReinforceDefault,
      DEFAULT_STRUCTURE_REINFORCE_HOUR,
    ),
    aggressionSettings: normalizeAggressionSettings(base.aggressionSettings, {
      isNpcCorporation: Boolean(corporationRecord && corporationRecord.isNPC),
    }),
    contacts:
      base.contacts && typeof base.contacts === "object"
        ? cloneValue(base.contacts)
        : {},
    labels:
      base.labels && typeof base.labels === "object"
        ? cloneValue(base.labels)
        : {},
    bulletins: Array.isArray(base.bulletins) ? cloneValue(base.bulletins) : [],
    members,
    titles,
    applications:
      base.applications && typeof base.applications === "object"
        ? cloneValue(base.applications)
        : {},
    applicationHistory: Array.isArray(base.applicationHistory)
      ? cloneValue(base.applicationHistory)
      : [],
    invitations:
      base.invitations && typeof base.invitations === "object"
        ? cloneValue(base.invitations)
        : {},
    invitationHistory: Array.isArray(base.invitationHistory)
      ? cloneValue(base.invitationHistory)
      : [],
    shares:
      base.shares && typeof base.shares === "object"
        ? cloneValue(base.shares)
        : {
            [String(corporationRecord.corporationID)]: normalizeInteger(
              corporationRecord && corporationRecord.shares,
              1000,
            ),
          },
    medals:
      base.medals && typeof base.medals === "object"
        ? cloneValue(base.medals)
        : { medals: {}, recipientsByMedalID: {} },
    corpColorPalette: normalizeCorporationColorPalette(base.corpColorPalette),
    offices,
    lockedItemsByLocation:
      base.lockedItemsByLocation && typeof base.lockedItemsByLocation === "object"
        ? cloneValue(base.lockedItemsByLocation)
        : {},
    wallet,
    recruitmentAds:
      base.recruitmentAds && typeof base.recruitmentAds === "object"
        ? cloneValue(base.recruitmentAds)
        : {},
    allianceApplications:
      base.allianceApplications && typeof base.allianceApplications === "object"
        ? cloneValue(base.allianceApplications)
        : {},
    recentKills: Array.isArray(base.recentKills) ? cloneValue(base.recentKills) : [],
    recentLosses: Array.isArray(base.recentLosses)
      ? cloneValue(base.recentLosses)
      : [],
    pendingAutoKicks: Array.isArray(base.pendingAutoKicks)
      ? cloneValue(base.pendingAutoKicks)
      : [],
    fw:
      base.fw && typeof base.fw === "object"
        ? {
            allowedEnlistmentFactions: Array.isArray(base.fw.allowedEnlistmentFactions)
              ? cloneValue(base.fw.allowedEnlistmentFactions)
              : [],
            cooldownTimestamp:
              normalizeInteger(base.fw.cooldownTimestamp, 0) || 0,
            directEnlistment:
              base.fw.directEnlistment && typeof base.fw.directEnlistment === "object"
                ? cloneValue(base.fw.directEnlistment)
                : null,
          }
        : {
            allowedEnlistmentFactions: [],
            cooldownTimestamp: 0,
            directEnlistment: null,
          },
  };
}

function normalizeAllianceRuntime(runtime, allianceRecord) {
  const base = runtime && typeof runtime === "object" ? cloneValue(runtime) : {};
  const memberCorporationIDs = getAllianceCorporationIDs(allianceRecord.allianceID);
  const executorSupportByCorporation =
    base.executorSupportByCorporation &&
    typeof base.executorSupportByCorporation === "object"
      ? cloneValue(base.executorSupportByCorporation)
      : {};
  const memberJoinedAtByCorporation =
    base.memberJoinedAtByCorporation &&
    typeof base.memberJoinedAtByCorporation === "object"
      ? cloneValue(base.memberJoinedAtByCorporation)
      : {};

  for (const corporationID of memberCorporationIDs) {
    if (
      memberJoinedAtByCorporation[String(corporationID)] === undefined ||
      memberJoinedAtByCorporation[String(corporationID)] === null
    ) {
      memberJoinedAtByCorporation[String(corporationID)] = normalizeFiletimeString(
        allianceRecord.createdAt,
        "0",
      );
    }
  }
  for (const corporationID of Object.keys(memberJoinedAtByCorporation)) {
    if (!memberCorporationIDs.includes(Number(corporationID))) {
      delete memberJoinedAtByCorporation[corporationID];
    }
  }
  if (
    allianceRecord.executorCorporationID &&
    memberCorporationIDs.includes(Number(allianceRecord.executorCorporationID)) &&
    executorSupportByCorporation[String(allianceRecord.executorCorporationID)] === undefined
  ) {
    executorSupportByCorporation[String(allianceRecord.executorCorporationID)] =
      Number(allianceRecord.executorCorporationID);
  }
  for (const corporationID of Object.keys(executorSupportByCorporation)) {
    if (!memberCorporationIDs.includes(Number(corporationID))) {
      delete executorSupportByCorporation[corporationID];
    }
  }

  return {
    version: RUNTIME_VERSION,
    contacts:
      base.contacts && typeof base.contacts === "object"
        ? cloneValue(base.contacts)
        : {},
    labels:
      base.labels && typeof base.labels === "object"
        ? cloneValue(base.labels)
        : {},
    bulletins: Array.isArray(base.bulletins) ? cloneValue(base.bulletins) : [],
    relationships:
      base.relationships && typeof base.relationships === "object"
        ? cloneValue(base.relationships)
        : {},
    applications:
      base.applications && typeof base.applications === "object"
        ? cloneValue(base.applications)
        : {},
    executorSupportByCorporation,
    memberJoinedAtByCorporation,
    bills: Array.isArray(base.bills) ? cloneValue(base.bills) : [],
    billBalance: Number(base.billBalance || 0),
    primeInfo: {
      currentPrimeHour: normalizeInteger(
        (base.primeInfo && base.primeInfo.currentPrimeHour) ||
          allianceRecord.currentPrimeHour,
        0,
      ),
      newPrimeHour: normalizeInteger(
        (base.primeInfo && base.primeInfo.newPrimeHour) ||
          allianceRecord.newPrimeHour ||
          allianceRecord.currentPrimeHour,
        0,
      ),
      newPrimeHourValidAfter: normalizeFiletimeString(
        base.primeInfo && base.primeInfo.newPrimeHourValidAfter,
        "0",
      ),
    },
    capitalInfo: {
      currentCapitalSystem: normalizePositiveInteger(
        (base.capitalInfo && base.capitalInfo.currentCapitalSystem) ||
          allianceRecord.currentCapital,
        null,
      ),
      newCapitalSystem: normalizePositiveInteger(
        base.capitalInfo && base.capitalInfo.newCapitalSystem,
        null,
      ),
      newCapitalSystemValidAfter: normalizeFiletimeString(
        base.capitalInfo && base.capitalInfo.newCapitalSystemValidAfter,
        "0",
      ),
    },
  };
}

function ensureRuntimeInitialized() {
  if (runtimeBootstrapComplete && runtimeTableCache) {
    return runtimeTableCache;
  }

  ensureCorporationsInitialized();
  ensureAlliancesInitialized();
  const corporationTable = readCorporationTable();
  const allianceTable = readAllianceTable();
  const runtimeTable = readTable(CORPORATION_RUNTIME_TABLE, {
    _meta: { version: RUNTIME_VERSION },
    corporations: {},
    alliances: {},
    wars: {},
    warNegotiations: {},
    mutualWarInvites: {},
    mutualWarInviteBlocks: {},
    peaceTreaties: {},
  });

  runtimeTable._meta = ensureMetaDefaults(runtimeTable._meta);
  runtimeTable.corporations =
    runtimeTable.corporations && typeof runtimeTable.corporations === "object"
      ? runtimeTable.corporations
      : {};
  runtimeTable.alliances =
    runtimeTable.alliances && typeof runtimeTable.alliances === "object"
      ? runtimeTable.alliances
      : {};
  runtimeTable.wars =
    runtimeTable.wars && typeof runtimeTable.wars === "object"
      ? runtimeTable.wars
      : {};
  runtimeTable.warNegotiations =
    runtimeTable.warNegotiations &&
    typeof runtimeTable.warNegotiations === "object"
      ? runtimeTable.warNegotiations
      : {};
  runtimeTable.mutualWarInvites =
    runtimeTable.mutualWarInvites &&
    typeof runtimeTable.mutualWarInvites === "object"
      ? runtimeTable.mutualWarInvites
      : {};
  runtimeTable.mutualWarInviteBlocks =
    runtimeTable.mutualWarInviteBlocks &&
    typeof runtimeTable.mutualWarInviteBlocks === "object"
      ? runtimeTable.mutualWarInviteBlocks
      : {};
  runtimeTable.peaceTreaties =
    runtimeTable.peaceTreaties &&
    typeof runtimeTable.peaceTreaties === "object"
      ? runtimeTable.peaceTreaties
      : {};

  for (const corporationID of Object.keys(corporationTable.records || {})) {
    const record = getCorporationRecord(corporationID);
    if (!record) {
      continue;
    }
    runtimeTable.corporations[String(record.corporationID)] =
      normalizeCorporationRuntime(
        runtimeTable.corporations[String(record.corporationID)],
        record,
        runtimeTable,
      );
  }

  for (const allianceID of Object.keys(allianceTable.records || {})) {
    const record = getAllianceRecord(allianceID);
    if (!record) {
      continue;
    }
    runtimeTable.alliances[String(record.allianceID)] = normalizeAllianceRuntime(
      runtimeTable.alliances[String(record.allianceID)],
      record,
    );
  }

  writeTable(CORPORATION_RUNTIME_TABLE, runtimeTable);
  runtimeTableCache = runtimeTable;
  runtimeBootstrapComplete = true;
  officesByStationCacheDirty = true;
  return runtimeTable;
}

function updateRuntimeState(updater) {
  const runtimeTable = ensureRuntimeInitialized();
  const nextTable =
    typeof updater === "function" ? updater(runtimeTable) || runtimeTable : runtimeTable;
  const writeResult = writeTable(CORPORATION_RUNTIME_TABLE, nextTable);
  if (writeResult && writeResult.success) {
    runtimeTableCache = nextTable;
    officesByStationCacheDirty = true;
  }
  return writeResult;
}

function getCorporationRuntime(corporationID) {
  const runtimeTable = ensureRuntimeInitialized();
  const runtime = runtimeTable.corporations[String(corporationID)];
  return runtime ? cloneValue(runtime) : null;
}

function updateCorporationRuntime(corporationID, updater) {
  return updateRuntimeState((runtimeTable) => {
    const corporationRecord = getCorporationRecord(corporationID);
    if (!corporationRecord) {
      return runtimeTable;
    }
    const currentRuntime = runtimeTable.corporations[String(corporationRecord.corporationID)];
    const nextRuntime =
      typeof updater === "function"
        ? updater(cloneValue(currentRuntime), corporationRecord, runtimeTable) ||
          currentRuntime
        : currentRuntime;
    runtimeTable.corporations[String(corporationRecord.corporationID)] =
      normalizeCorporationRuntime(nextRuntime, corporationRecord, runtimeTable);
    return runtimeTable;
  });
}

function getAllianceRuntime(allianceID) {
  const runtimeTable = ensureRuntimeInitialized();
  const runtime = runtimeTable.alliances[String(allianceID)];
  return runtime ? cloneValue(runtime) : null;
}

function updateAllianceRuntime(allianceID, updater) {
  return updateRuntimeState((runtimeTable) => {
    const allianceRecord = getAllianceRecord(allianceID);
    if (!allianceRecord) {
      return runtimeTable;
    }
    const currentRuntime = runtimeTable.alliances[String(allianceRecord.allianceID)];
    const nextRuntime =
      typeof updater === "function"
        ? updater(cloneValue(currentRuntime), allianceRecord, runtimeTable) ||
          currentRuntime
        : currentRuntime;
    runtimeTable.alliances[String(allianceRecord.allianceID)] = normalizeAllianceRuntime(
      nextRuntime,
      allianceRecord,
    );
    return runtimeTable;
  });
}

function listCorporationMembers(corporationID) {
  const runtimeTable = ensureRuntimeInitialized();
  const runtime = runtimeTable.corporations[String(corporationID)] || null;
  const members = runtime && runtime.members ? runtime.members : {};
  return cloneValue(Object.values(members).sort(
    (left, right) => Number(left.characterID) - Number(right.characterID),
  ));
}

function getCorporationMember(corporationID, characterID) {
  const runtimeTable = ensureRuntimeInitialized();
  const runtime = runtimeTable.corporations[String(corporationID)] || null;
  if (!runtime || !runtime.members) {
    return null;
  }
  return cloneValue(runtime.members[String(characterID)] || null);
}

function getCorporationDivisionNames(corporationID) {
  const runtime = getCorporationRuntime(corporationID);
  return runtime
    ? cloneValue(runtime.divisionNames || buildDefaultDivisionNames())
    : buildDefaultDivisionNames();
}

function getCorporationOffices(corporationID) {
  const runtimeTable = ensureRuntimeInitialized();
  const runtime = runtimeTable.corporations[String(corporationID)] || null;
  if (!runtime || !runtime.offices) {
    return [];
  }
  return cloneValue(Object.values(runtime.offices).sort(
    (left, right) => Number(left.stationID) - Number(right.stationID),
  ));
}

function rebuildOfficesByStationCache() {
  const runtimeTable = ensureRuntimeInitialized();
  const nextStationCache = new Map();
  const nextInventoryCache = new Map();
  for (const runtime of Object.values(runtimeTable.corporations || {})) {
    for (const office of Object.values((runtime && runtime.offices) || {})) {
      const stationID = normalizePositiveInteger(office && office.stationID, null);
      if (!stationID) {
        continue;
      }
      if (!nextStationCache.has(stationID)) {
        nextStationCache.set(stationID, []);
      }
      nextStationCache.get(stationID).push(cloneValue(office));
      for (const inventoryID of [
        normalizePositiveInteger(office && office.officeID, null),
        normalizePositiveInteger(office && office.officeFolderID, null),
        normalizePositiveInteger(office && office.itemID, null),
      ]) {
        if (!inventoryID) {
          continue;
        }
        nextInventoryCache.set(inventoryID, cloneValue(office));
      }
    }
  }
  for (const offices of nextStationCache.values()) {
    offices.sort((left, right) => Number(left.corporationID) - Number(right.corporationID));
  }
  officesByStationCache = nextStationCache;
  officesByInventoryIDCache = nextInventoryCache;
  officesByStationCacheDirty = false;
}

function getOfficesAtStation(stationID) {
  const numericStationID = normalizePositiveInteger(stationID, null);
  if (!numericStationID) {
    return [];
  }
  if (officesByStationCacheDirty) {
    rebuildOfficesByStationCache();
  }
  return cloneValue(officesByStationCache.get(numericStationID) || []);
}

function getCorporationOfficeByInventoryID(corporationID, inventoryID) {
  const numericCorporationID = normalizePositiveInteger(corporationID, null);
  const numericInventoryID = normalizePositiveInteger(inventoryID, null);
  if (!numericCorporationID || !numericInventoryID) {
    return null;
  }
  if (officesByStationCacheDirty) {
    rebuildOfficesByStationCache();
  }
  const office = officesByInventoryIDCache.get(numericInventoryID) || null;
  if (!office || Number(office.corporationID) !== Number(numericCorporationID)) {
    return null;
  }
  return cloneValue(office);
}

function getLockedItemsByLocation(corporationID, locationID) {
  const runtime = getCorporationRuntime(corporationID);
  if (!runtime || !runtime.lockedItemsByLocation) {
    return [];
  }
  const locationState = runtime.lockedItemsByLocation[String(locationID)];
  if (Array.isArray(locationState)) {
    return cloneValue(locationState);
  }
  if (locationState && typeof locationState === "object") {
    return cloneValue(
      Object.values(locationState).sort(
        (left, right) =>
          normalizePositiveInteger(left && left.itemID, 0) -
          normalizePositiveInteger(right && right.itemID, 0),
      ),
    );
  }
  return [];
}

function getLockedItemLocations(corporationID) {
  const runtime = getCorporationRuntime(corporationID);
  if (!runtime || !runtime.lockedItemsByLocation) {
    return [];
  }
  return Object.keys(runtime.lockedItemsByLocation)
    .filter((locationID) => {
      const locationState = runtime.lockedItemsByLocation[locationID];
      if (Array.isArray(locationState)) {
        return locationState.length > 0;
      }
      if (locationState && typeof locationState === "object") {
        return Object.keys(locationState).length > 0;
      }
      return false;
    })
    .map((locationID) => normalizePositiveInteger(locationID, null))
    .filter(Boolean)
    .sort((left, right) => left - right);
}

function updateCorporationRecord(corporationID, changes = {}) {
  const currentRecord = getCorporationRecord(corporationID);
  if (!currentRecord) {
    return { success: false, errorMsg: "CORPORATION_NOT_FOUND" };
  }
  const table = readCorporationTable();
  table.records[String(corporationID)] = {
    ...(table.records[String(corporationID)] || {}),
    ...cloneValue(currentRecord),
    ...cloneValue(changes),
    corporationID: currentRecord.corporationID,
  };
  return writeTable(CORPORATIONS_TABLE, table);
}

function updateAllianceRecord(allianceID, changes = {}) {
  const currentRecord = getAllianceRecord(allianceID);
  if (!currentRecord) {
    return { success: false, errorMsg: "ALLIANCE_NOT_FOUND" };
  }
  const table = readAllianceTable();
  table.records[String(allianceID)] = {
    ...(table.records[String(allianceID)] || {}),
    ...cloneValue(currentRecord),
    ...cloneValue(changes),
    allianceID: currentRecord.allianceID,
  };
  return writeTable(ALLIANCES_TABLE, table);
}

function createCorporationWithRuntime(characterID, options = {}) {
  const name = normalizeText(options.name, "").trim();
  const result = createCustomCorporation(characterID, name);
  if (!result.success) {
    return result;
  }
  const corporationID = result.data.corporationID;
  const updateResult = updateCorporationRecord(corporationID, {
    corporationName: name,
    tickerName: normalizeText(
      options.tickerName,
      result.data.corporationRecord && result.data.corporationRecord.tickerName,
    ),
    description: normalizeText(
      options.description,
      `Capsuleer corporation ${name}.`,
    ),
    url: normalizeText(options.url, ""),
    taxRate: Number(options.taxRate || 0),
    loyaltyPointTaxRate: Number(options.loyaltyPointTaxRate || 0),
    friendlyFire: options.friendlyFireEnabled ? 1 : 0,
    shape1:
      options.shape1 !== undefined
        ? normalizePositiveInteger(options.shape1, null)
        : result.data.corporationRecord.shape1,
    shape2:
      options.shape2 !== undefined
        ? normalizePositiveInteger(options.shape2, null)
        : result.data.corporationRecord.shape2,
    shape3:
      options.shape3 !== undefined
        ? normalizePositiveInteger(options.shape3, null)
        : result.data.corporationRecord.shape3,
    color1:
      options.color1 !== undefined
        ? normalizePositiveInteger(options.color1, null)
        : result.data.corporationRecord.color1,
    color2:
      options.color2 !== undefined
        ? normalizePositiveInteger(options.color2, null)
        : result.data.corporationRecord.color2,
    color3:
      options.color3 !== undefined
        ? normalizePositiveInteger(options.color3, null)
        : result.data.corporationRecord.color3,
    typeface:
      options.typeface !== undefined
        ? normalizePositiveInteger(options.typeface, null)
        : result.data.corporationRecord.typeface,
  });
  if (!updateResult.success) {
    return updateResult;
  }
  updateCorporationRuntime(corporationID, (runtime) => ({
    ...runtime,
    applicationsEnabled:
      options.applicationsEnabled === undefined
        ? 1
        : options.applicationsEnabled
          ? 1
          : 0,
    acceptStructures: true,
    restrictCorpMails: false,
    structureReinforceDefault: DEFAULT_STRUCTURE_REINFORCE_HOUR,
    aggressionSettings: normalizeAggressionSettings(
      options.friendlyFireEnabled
        ? { enableAfter: "0", disableAfter: null }
        : { enableAfter: null, disableAfter: "0" },
      { isNpcCorporation: false },
    ),
  }));
  return {
    success: true,
    data: {
      corporationID,
      corporationRecord: getCorporationRecord(corporationID),
      corporationRuntime: getCorporationRuntime(corporationID),
    },
  };
}

function createAllianceWithRuntime(characterID, corporationID, options = {}) {
  const name = normalizeText(options.name, "").trim();
  const result = createCustomAllianceForCorporation(characterID, corporationID, name);
  if (!result.success) {
    return result;
  }
  const allianceID = result.data.allianceID;
  const updateResult = updateAllianceRecord(allianceID, {
    allianceName: name,
    shortName: normalizeText(
      options.shortName,
      result.data.allianceRecord && result.data.allianceRecord.shortName,
    ),
    description: normalizeText(
      options.description,
      `Capsuleer alliance ${name}.`,
    ),
    url: normalizeText(options.url, ""),
  });
  if (!updateResult.success) {
    return updateResult;
  }
  return {
    success: true,
    data: {
      allianceID,
      allianceRecord: getAllianceRecord(allianceID),
      allianceRuntime: getAllianceRuntime(allianceID),
    },
  };
}

function ensureCharacterMemberState(corporationID, characterID) {
  const currentMember = getCorporationMember(corporationID, characterID);
  if (currentMember) {
    return currentMember;
  }
  updateCorporationRuntime(corporationID, (runtime, corporationRecord) => {
    runtime.members[String(characterID)] = buildDefaultMemberState(
      characterID,
      corporationRecord,
    );
    return runtime;
  });
  return getCorporationMember(corporationID, characterID);
}

function getCorporationSessionRoleState(corporationID, characterID) {
  const memberState = ensureCharacterMemberState(corporationID, characterID);
  if (!memberState) {
    return {
      corprole: 0n,
      rolesAtAll: 0n,
      rolesAtBase: 0n,
      rolesAtHQ: 0n,
      rolesAtOther: 0n,
      baseID: null,
      accountKey: CORPORATION_WALLET_KEY_START,
    };
  }
  const baseMask = toRoleMaskBigInt(memberState.roles, 0n);
  const isDirector =
    memberState.isCEO ||
    (baseMask & CORP_ROLE_DIRECTOR) === CORP_ROLE_DIRECTOR;
  const effectiveCorpRole = isDirector ? FULL_ADMIN_ROLE_MASK : baseMask;
  const effectiveLocationalRoles = isDirector
    ? FULL_LOCATIONAL_ROLE_MASK
    : toRoleMaskBigInt(memberState.rolesAtHQ, 0n);
  return {
    corprole: effectiveCorpRole,
    rolesAtAll: effectiveCorpRole,
    rolesAtBase: toRoleMaskBigInt(memberState.rolesAtBase, effectiveLocationalRoles),
    rolesAtHQ: toRoleMaskBigInt(memberState.rolesAtHQ, effectiveLocationalRoles),
    rolesAtOther: toRoleMaskBigInt(
      memberState.rolesAtOther,
      effectiveLocationalRoles,
    ),
    baseID: normalizePositiveInteger(memberState.baseID, null),
    accountKey: normalizeInteger(
      memberState.accountKey,
      CORPORATION_WALLET_KEY_START,
    ),
  };
}

function syncMemberStateToCharacterRecord(corporationID, characterID) {
  const memberState = getCorporationMember(corporationID, characterID);
  if (!memberState) {
    return;
  }
  const characterState = getCharacterState();
  const updateCharacterRecord =
    characterState && typeof characterState.updateCharacterRecord === "function"
      ? characterState.updateCharacterRecord
      : null;
  if (typeof updateCharacterRecord !== "function") {
    return;
  }
  updateCharacterRecord(characterID, (record) => {
    record.title = memberState.title || "";
    record.baseID = normalizePositiveInteger(memberState.baseID, null);
    record.divisionID = normalizeInteger(memberState.divisionID, 0);
    record.squadronID = normalizeInteger(memberState.squadronID, 0);
    return record;
  });
}

function getPageForMembers(pageNumber = 1) {
  const page = Math.max(1, normalizeInteger(pageNumber, 1));
  return {
    start: (page - 1) * PAGE_SIZE,
    end: page * PAGE_SIZE,
  };
}

module.exports = {
  CORPORATION_RUNTIME_TABLE,
  CORPORATION_WALLET_KEY_START,
  CORP_ROLE_DIRECTOR,
  CORP_ROLE_ACCOUNTANT,
  CORP_ROLE_BRAND_MANAGER,
  CORP_ROLE_CHAT_MANAGER,
  CORP_ROLE_JUNIOR_ACCOUNTANT,
  CORP_ROLE_PERSONNEL_MANAGER,
  CORP_ROLE_PROJECT_MANAGER,
  FULL_ADMIN_ROLE_MASK,
  FULL_LOCATIONAL_ROLE_MASK,
  PAGE_SIZE,
  DEFAULT_STRUCTURE_REINFORCE_HOUR,
  buildDefaultDivisionNames,
  buildDefaultMemberState,
  buildDefaultTitleMap,
  cloneValue,
  createAllianceWithRuntime,
  createCorporationWithRuntime,
  ensureCharacterMemberState,
  ensureRuntimeInitialized,
  getAllianceRuntime,
  getCorporationDivisionNames,
  getCorporationMember,
  getCorporationOfficeByInventoryID,
  getCorporationOffices,
  getCorporationRuntime,
  getOfficesAtStation,
  getCorporationSessionRoleState,
  getLockedItemLocations,
  getLockedItemsByLocation,
  getPageForMembers,
  listCorporationMembers,
  normalizeFiletimeString,
  normalizeBoolean,
  normalizeInteger,
  normalizePositiveInteger,
  normalizeRoleMaskString,
  normalizeText,
  setCorporationAlliance,
  syncMemberStateToCharacterRecord,
  toRoleMaskBigInt,
  updateAllianceRecord,
  updateAllianceRuntime,
  updateCorporationRecord,
  updateCorporationRuntime,
  updateRuntimeState,
  _testing: {
    resetRuntimeCaches,
  },
};
