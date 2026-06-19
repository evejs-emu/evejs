const fs = require("fs");
const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const {
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getFactionOwnerRecord,
} = require(path.join(__dirname, "../faction/factionState"));
const {
  getCorporationWarPermitStatus,
} = require(path.join(__dirname, "./warPermitState"));
const {
  readAggressionSettings,
  resolveFriendlyFireLegalAtTime,
} = require(path.join(__dirname, "./aggressionSettingsState"));

const CORPORATIONS_TABLE = "corporations";
const ALLIANCES_TABLE = "alliances";
const CHARACTERS_TABLE = "characters";
const STATIONS_TABLE = "stations";
const CUSTOM_CORPORATION_ID_START = 98000000;
const CUSTOM_ALLIANCE_ID_START = 99000000;
const NPC_CORPORATION_SEED_VERSION = 1;
const OWNER_TYPE_CORPORATION = 2;
const OWNER_TYPE_ALLIANCE = 16159;
const OWNER_TYPE_CHARACTER = 1373;
const DEFAULT_CUSTOM_CORPORATION_LOGO = Object.freeze({
  shape1: 419,
  shape2: null,
  shape3: null,
  color1: null,
  color2: null,
  color3: null,
  typeface: null,
});
const DATA_DIRECTORY_PATH = path.join(__dirname, "../../../../data");

let npcCorporationCache = null;
let npcCharacterCache = null;
let cachedStaticJsonlDirectoryPath = null;
let cachedNpcCorporationSourcePath = null;
let cachedNpcCharacterSourcePath = null;
let corporationsBootstrapComplete = false;
let alliancesBootstrapComplete = false;
let corporationMembersIndexCache = null;
let corporationMembersIndexDirty = true;
let allianceCorporationsIndexCache = null;
let allianceCorporationsIndexDirty = true;

function getCharacterStateService() {
  return require(path.join(__dirname, "../character/characterState"));
}

function updateCharacterStateRecord(characterID, mutator) {
  const characterState = getCharacterStateService();
  return characterState && typeof characterState.updateCharacterRecord === "function"
    ? characterState.updateCharacterRecord(characterID, mutator)
    : { success: false, errorMsg: "CHARACTER_STATE_UNAVAILABLE" };
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.trunc(numeric);
}

function normalizePositiveInteger(value, fallback = null) {
  const numeric = normalizeInteger(value, 0);
  return numeric > 0 ? numeric : fallback;
}

function normalizeLocalizedText(value, fallback = "") {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object") {
    if (typeof value.en === "string" && value.en.trim()) {
      return value.en;
    }

    for (const localizedValue of Object.values(value)) {
      if (typeof localizedValue === "string" && localizedValue.trim()) {
        return localizedValue;
      }
    }
  }

  return fallback;
}

function normalizeNameKey(value) {
  return String(value || "").trim().toLowerCase();
}

function filetimeNowString() {
  return currentFileTime().toString();
}

function normalizeLogoPart(value) {
  return normalizePositiveInteger(value, null);
}

function normalizeCorporationLogo(record = {}) {
  const normalized = {
    ...record,
    shape1: normalizeLogoPart(record.shape1),
    shape2: normalizeLogoPart(record.shape2),
    shape3: normalizeLogoPart(record.shape3),
    color1: normalizeLogoPart(record.color1),
    color2: normalizeLogoPart(record.color2),
    color3: normalizeLogoPart(record.color3),
    typeface: normalizeLogoPart(record.typeface),
  };

  const hasLogoLayer =
    normalized.shape1 !== null ||
    normalized.shape2 !== null ||
    normalized.shape3 !== null;

  if (!record.isNPC && !hasLogoLayer) {
    return {
      ...normalized,
      ...DEFAULT_CUSTOM_CORPORATION_LOGO,
    };
  }

  return normalized;
}

function readTable(tableName, defaultPayload) {
  const result = database.read(tableName, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return cloneValue(defaultPayload);
  }

  return cloneValue(result.data);
}

function readTableView(tableName, defaultPayload) {
  const result = database.read(tableName, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return defaultPayload;
  }

  return result.data;
}

function writeTable(tableName, payload) {
  const writeResult = database.write(tableName, "/", payload);
  if (writeResult && writeResult.success) {
    if (tableName === CORPORATIONS_TABLE || tableName === ALLIANCES_TABLE) {
      allianceCorporationsIndexDirty = true;
      allianceCorporationsIndexCache = null;
    }
  }
  return writeResult;
}

function normalizeCorporationTable(payload = {}) {
  return {
    _meta: {
      nextCustomCorporationID: normalizePositiveInteger(
        payload && payload._meta && payload._meta.nextCustomCorporationID,
        CUSTOM_CORPORATION_ID_START,
      ),
      npcSeedVersion: normalizeInteger(
        payload && payload._meta && payload._meta.npcSeedVersion,
        0,
      ),
    },
    records:
      payload && payload.records && typeof payload.records === "object"
        ? cloneValue(payload.records)
        : {},
  };
}

function normalizeAllianceTable(payload = {}) {
  return {
    _meta: {
      nextCustomAllianceID: normalizePositiveInteger(
        payload && payload._meta && payload._meta.nextCustomAllianceID,
        CUSTOM_ALLIANCE_ID_START,
      ),
    },
    records:
      payload && payload.records && typeof payload.records === "object"
        ? cloneValue(payload.records)
        : {},
  };
}

function parseJsonlFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean);
}

function resolveLatestStaticJsonlDirectoryPath() {
  if (cachedStaticJsonlDirectoryPath !== null) {
    return cachedStaticJsonlDirectoryPath;
  }

  try {
    const directoryEntries = fs.readdirSync(DATA_DIRECTORY_PATH, {
      withFileTypes: true,
    });
    const candidateDirectory = directoryEntries
      .filter((entry) =>
        entry &&
        entry.isDirectory() &&
        /^eve-online-static-data-\d+-jsonl$/i.test(entry.name),
      )
      .map((entry) => ({
        name: entry.name,
        fullPath: path.join(DATA_DIRECTORY_PATH, entry.name),
      }))
      .sort((left, right) => right.name.localeCompare(left.name))[0];

    cachedStaticJsonlDirectoryPath = candidateDirectory
      ? candidateDirectory.fullPath
      : "";
  } catch (_error) {
    cachedStaticJsonlDirectoryPath = "";
  }

  return cachedStaticJsonlDirectoryPath;
}

function resolveNpcCorporationSourcePath() {
  if (cachedNpcCorporationSourcePath !== null) {
    return cachedNpcCorporationSourcePath;
  }

  const directoryPath = resolveLatestStaticJsonlDirectoryPath();
  const candidatePath = directoryPath
    ? path.join(directoryPath, "npcCorporations.jsonl")
    : "";
  cachedNpcCorporationSourcePath = fs.existsSync(candidatePath)
    ? candidatePath
    : "";
  return cachedNpcCorporationSourcePath;
}

function resolveNpcCharacterSourcePath() {
  if (cachedNpcCharacterSourcePath !== null) {
    return cachedNpcCharacterSourcePath;
  }

  const directoryPath = resolveLatestStaticJsonlDirectoryPath();
  const candidatePath = directoryPath
    ? path.join(directoryPath, "npcCharacters.jsonl")
    : "";
  cachedNpcCharacterSourcePath = fs.existsSync(candidatePath)
    ? candidatePath
    : "";
  return cachedNpcCharacterSourcePath;
}

function loadNpcCorporations() {
  if (npcCorporationCache) {
    return npcCorporationCache;
  }

  npcCorporationCache = new Map(
    parseJsonlFile(resolveNpcCorporationSourcePath()).map((entry) => [
      normalizePositiveInteger(entry._key, 0),
      entry,
    ]),
  );
  return npcCorporationCache;
}

function loadNpcCharacters() {
  if (npcCharacterCache) {
    return npcCharacterCache;
  }

  npcCharacterCache = new Map(
    parseJsonlFile(resolveNpcCharacterSourcePath()).map((entry) => [
      normalizePositiveInteger(entry._key, 0),
      entry,
    ]),
  );
  return npcCharacterCache;
}

function readCharacters() {
  const result = database.read(CHARACTERS_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }

  return result.data;
}

function markCorporationMembersIndexDirty() {
  corporationMembersIndexDirty = true;
  corporationMembersIndexCache = null;
}

function ensureCorporationMembersIndex() {
  if (!corporationMembersIndexDirty && corporationMembersIndexCache) {
    return corporationMembersIndexCache;
  }

  const nextIndex = new Map();
  for (const [characterID, characterRecord] of Object.entries(readCharacters())) {
    const corporationID = normalizePositiveInteger(
      characterRecord && characterRecord.corporationID,
      null,
    );
    const numericCharacterID = normalizePositiveInteger(characterID, null);
    if (!corporationID || !numericCharacterID) {
      continue;
    }
    if (!nextIndex.has(corporationID)) {
      nextIndex.set(corporationID, []);
    }
    nextIndex.get(corporationID).push(numericCharacterID);
  }

  for (const members of nextIndex.values()) {
    members.sort((left, right) => left - right);
  }

  corporationMembersIndexCache = nextIndex;
  corporationMembersIndexDirty = false;
  return corporationMembersIndexCache;
}

function ensureAllianceCorporationsIndex() {
  if (!allianceCorporationsIndexDirty && allianceCorporationsIndexCache) {
    return allianceCorporationsIndexCache;
  }

  ensureAlliancesInitialized();
  ensureCorporationsInitialized();

  const nextIndex = new Map();
  const allianceRecordsResult = database.read(ALLIANCES_TABLE, "/records");
  const corporationRecordsResult = database.read(CORPORATIONS_TABLE, "/records");
  const allianceRecords =
    allianceRecordsResult.success &&
    allianceRecordsResult.data &&
    typeof allianceRecordsResult.data === "object"
      ? allianceRecordsResult.data
      : {};
  const corporationRecords =
    corporationRecordsResult.success &&
    corporationRecordsResult.data &&
    typeof corporationRecordsResult.data === "object"
      ? corporationRecordsResult.data
      : {};

  for (const [allianceID, allianceRecord] of Object.entries(allianceRecords)) {
    const numericAllianceID = normalizePositiveInteger(allianceID, null);
    if (!numericAllianceID) {
      continue;
    }
    const members = new Set(
      (Array.isArray(allianceRecord && allianceRecord.memberCorporationIDs)
        ? allianceRecord.memberCorporationIDs
        : []
      )
        .map((corporationID) => normalizePositiveInteger(corporationID, null))
        .filter(Boolean),
    );
    nextIndex.set(numericAllianceID, members);
  }

  for (const corporationRecord of Object.values(corporationRecords)) {
    const corporationID = normalizePositiveInteger(
      corporationRecord && corporationRecord.corporationID,
      null,
    );
    const allianceID = normalizePositiveInteger(
      corporationRecord && corporationRecord.allianceID,
      null,
    );
    if (!corporationID || !allianceID) {
      continue;
    }
    if (!nextIndex.has(allianceID)) {
      nextIndex.set(allianceID, new Set());
    }
    nextIndex.get(allianceID).add(corporationID);
  }

  allianceCorporationsIndexCache = nextIndex;
  allianceCorporationsIndexDirty = false;
  return allianceCorporationsIndexCache;
}

function getCorporationMemberCount(corporationID) {
  const numericCorporationID = normalizePositiveInteger(corporationID, 0) || 0;
  if (!numericCorporationID) {
    return 0;
  }
  return (ensureCorporationMembersIndex().get(numericCorporationID) || []).length;
}

function readStations() {
  const result = database.read(STATIONS_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return [];
  }

  return Array.isArray(result.data.stations) ? result.data.stations : [];
}

function buildTickerFromName(name, fallback = "CORP") {
  const text = String(name || "")
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .trim();
  if (!text) {
    return fallback;
  }

  const initials = text
    .split(/\s+/)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase()
    .slice(0, 5);
  if (initials.length >= 2) {
    return initials;
  }

  const compact = text.replace(/[^A-Za-z0-9]+/g, "").toUpperCase();
  if (compact.length >= 2) {
    return compact.slice(0, 5);
  }

  return fallback;
}

function buildUniqueTicker(name, existingTickers = [], fallback = "CORP") {
  const baseTicker = buildTickerFromName(name, fallback);
  const used = new Set(
    existingTickers
      .map((value) => String(value || "").trim().toUpperCase())
      .filter(Boolean),
  );

  if (!used.has(baseTicker)) {
    return baseTicker;
  }

  for (let index = 1; index <= 999; index += 1) {
    const candidate = `${baseTicker}${String(index)}`.slice(0, 5);
    if (!used.has(candidate)) {
      return candidate;
    }
  }

  return baseTicker;
}

function isNpcCorporationID(corporationID) {
  const numericID = normalizePositiveInteger(corporationID, 0) || 0;
  return numericID >= 1000000 && numericID < 2000000;
}

function buildNpcCorporationRecord(rawRecord) {
  const corporationID = normalizePositiveInteger(rawRecord._key, 0) || 0;
  const corporationName = normalizeLocalizedText(
    rawRecord.name,
    `Corporation ${corporationID}`,
  );
  const tickerName =
    String(rawRecord.tickerName || "").trim() ||
    buildTickerFromName(corporationName, "NPC");

  return {
    corporationID,
    corporationName,
    tickerName,
    description: normalizeLocalizedText(rawRecord.description, ""),
    ceoID: normalizePositiveInteger(rawRecord.ceoID, null),
    creatorID: normalizePositiveInteger(rawRecord.ceoID, null),
    allianceID: null,
    stationID: normalizePositiveInteger(rawRecord.stationID, null),
    solarSystemID: normalizePositiveInteger(rawRecord.solarSystemID, null),
    factionID: normalizePositiveInteger(rawRecord.factionID, null),
    raceID: normalizePositiveInteger(rawRecord.raceID, null),
    deleted: rawRecord.deleted ? 1 : 0,
    shares: normalizeInteger(rawRecord.shares, 0),
    taxRate: Number(rawRecord.taxRate || 0),
    loyaltyPointTaxRate: 0.0,
    friendlyFire: 0,
    memberLimit: normalizeInteger(rawRecord.memberLimit, -1),
    url: "",
    hasPlayerPersonnelManager: Boolean(rawRecord.hasPlayerPersonnelManager),
    isNPC: true,
    createdAt: filetimeNowString(),
    shape1: null,
    shape2: null,
    shape3: null,
    color1: null,
    color2: null,
    color3: null,
    typeface: null,
  };
}

function ensureCorporationsInitialized() {
  if (corporationsBootstrapComplete) {
    const table = readTableView(CORPORATIONS_TABLE, {
      _meta: {
        nextCustomCorporationID: CUSTOM_CORPORATION_ID_START,
        npcSeedVersion: NPC_CORPORATION_SEED_VERSION,
      },
      records: {},
    });
    table._meta =
      table._meta && typeof table._meta === "object" ? table._meta : {};
    table.records =
      table.records && typeof table.records === "object" ? table.records : {};
    return table;
  }

  const table = normalizeCorporationTable(
    readTable(CORPORATIONS_TABLE, {
      _meta: {
        nextCustomCorporationID: CUSTOM_CORPORATION_ID_START,
        npcSeedVersion: 0,
      },
      records: {},
    }),
  );
  let mutated = table._meta.npcSeedVersion !== NPC_CORPORATION_SEED_VERSION;

  for (const [corporationID, rawRecord] of loadNpcCorporations().entries()) {
    const recordKey = String(corporationID);
    if (!table.records[recordKey] || table.records[recordKey].isNPC !== true) {
      table.records[recordKey] = buildNpcCorporationRecord(rawRecord);
      mutated = true;
    }
  }

  for (const [recordKey, storedRecord] of Object.entries(table.records)) {
    const normalizedRecord = normalizeCorporationLogo(storedRecord);
    if (JSON.stringify(storedRecord) !== JSON.stringify(normalizedRecord)) {
      table.records[recordKey] = normalizedRecord;
      mutated = true;
    }
  }

  if (table._meta.npcSeedVersion !== NPC_CORPORATION_SEED_VERSION) {
    table._meta.npcSeedVersion = NPC_CORPORATION_SEED_VERSION;
    mutated = true;
  }

  if (mutated) {
    writeTable(CORPORATIONS_TABLE, table);
  }

  corporationsBootstrapComplete = true;
  return table;
}

function ensureAlliancesInitialized() {
  if (alliancesBootstrapComplete) {
    const table = readTableView(ALLIANCES_TABLE, {
      _meta: {
        nextCustomAllianceID: CUSTOM_ALLIANCE_ID_START,
      },
      records: {},
    });
    table._meta =
      table._meta && typeof table._meta === "object" ? table._meta : {};
    table.records =
      table.records && typeof table.records === "object" ? table.records : {};
    return table;
  }

  const table = normalizeAllianceTable(
    readTable(ALLIANCES_TABLE, {
      _meta: {
        nextCustomAllianceID: CUSTOM_ALLIANCE_ID_START,
      },
      records: {},
    }),
  );
  const normalizedNextAllianceID = normalizePositiveInteger(
    table._meta.nextCustomAllianceID,
    CUSTOM_ALLIANCE_ID_START,
  );

  if (normalizedNextAllianceID !== table._meta.nextCustomAllianceID) {
    table._meta.nextCustomAllianceID = normalizedNextAllianceID;
    writeTable(ALLIANCES_TABLE, table);
  }

  alliancesBootstrapComplete = true;
  return table;
}

function getCharacterIDsInCorporation(corporationID) {
  const numericCorporationID = normalizePositiveInteger(corporationID, 0) || 0;
  if (!numericCorporationID) {
    return [];
  }

  return cloneValue(
    ensureCorporationMembersIndex().get(numericCorporationID) || [],
  );
}

function getAllianceCorporationIDs(allianceID) {
  const numericAllianceID = normalizePositiveInteger(allianceID, 0) || 0;
  if (!numericAllianceID) {
    return [];
  }

  const members = ensureAllianceCorporationsIndex().get(numericAllianceID);
  if (!members) {
    return [];
  }
  return [...members].sort((left, right) => left - right);
}

function getCorporationRecord(corporationID) {
  const numericCorporationID = normalizePositiveInteger(corporationID, 0) || 0;
  if (!numericCorporationID) {
    return null;
  }

  ensureCorporationsInitialized();
  const result = database.read(
    CORPORATIONS_TABLE,
    `/records/${String(numericCorporationID)}`,
  );
  const storedRecord =
    result.success && result.data && typeof result.data === "object"
      ? result.data
      : null;
  if (!storedRecord) {
    return null;
  }

  const record = normalizeCorporationLogo(cloneValue(storedRecord));
  record.corporationID = numericCorporationID;
  record.allianceID = normalizePositiveInteger(record.allianceID, null);
  record.memberCount = getCorporationMemberCount(numericCorporationID);
  return record;
}

function getAllianceRecord(allianceID) {
  const numericAllianceID = normalizePositiveInteger(allianceID, 0) || 0;
  if (!numericAllianceID) {
    return null;
  }

  ensureAlliancesInitialized();
  const result = database.read(
    ALLIANCES_TABLE,
    `/records/${String(numericAllianceID)}`,
  );
  const storedRecord =
    result.success && result.data && typeof result.data === "object"
      ? result.data
      : null;
  if (!storedRecord) {
    return null;
  }

  const record = cloneValue(storedRecord);
  record.allianceID = numericAllianceID;
  record.memberCorporationIDs = getAllianceCorporationIDs(numericAllianceID);
  record.memberCount = record.memberCorporationIDs.reduce(
    (count, corporationID) =>
      count + getCorporationMemberCount(corporationID),
    0,
  );
  return record;
}

function getCorporationOwnerRecord(corporationID) {
  const record = getCorporationRecord(corporationID);
  if (!record) {
    return null;
  }

  return {
    ownerID: record.corporationID,
    ownerName: record.corporationName,
    typeID: OWNER_TYPE_CORPORATION,
    gender: 0,
    tickerName: record.tickerName || null,
    factionID: normalizePositiveInteger(record.factionID, null),
  };
}

function getAllianceOwnerRecord(allianceID) {
  const record = getAllianceRecord(allianceID);
  if (!record) {
    return null;
  }

  return {
    ownerID: record.allianceID,
    ownerName: record.allianceName,
    typeID: OWNER_TYPE_ALLIANCE,
    gender: 0,
    tickerName: record.shortName || null,
  };
}

function getNpcCharacterOwnerRecord(characterID) {
  const numericCharacterID = normalizePositiveInteger(characterID, 0) || 0;
  if (!numericCharacterID) {
    return null;
  }

  const rawRecord = loadNpcCharacters().get(numericCharacterID);
  if (!rawRecord) {
    return null;
  }

  return {
    ownerID: numericCharacterID,
    ownerName: normalizeLocalizedText(
      rawRecord.name,
      `Entity ${numericCharacterID}`,
    ),
    typeID: OWNER_TYPE_CHARACTER,
    gender: rawRecord.gender ? 1 : 0,
    tickerName: null,
  };
}

function getOwnerLookupRecord(ownerID) {
  return (
    getCorporationOwnerRecord(ownerID) ||
    getAllianceOwnerRecord(ownerID) ||
    getFactionOwnerRecord(ownerID) ||
    getNpcCharacterOwnerRecord(ownerID) ||
    null
  );
}

function getAllianceShortNameRecord(allianceID) {
  const record = getAllianceRecord(allianceID);
  if (!record) {
    return null;
  }

  return {
    allianceID: record.allianceID,
    shortName: record.shortName || buildTickerFromName(record.allianceName, "ALLY"),
  };
}

function getCorporationStationSolarSystems(corporationID) {
  const numericCorporationID = normalizePositiveInteger(corporationID, 0) || 0;
  if (!numericCorporationID) {
    return [];
  }

  const stationCountBySystemID = new Map();

  for (const stationRecord of readStations()) {
    const ownerID = normalizePositiveInteger(
      stationRecord && (stationRecord.corporationID || stationRecord.ownerID),
      0,
    );
    if (ownerID !== numericCorporationID) {
      continue;
    }

    const solarSystemID = normalizePositiveInteger(
      stationRecord && stationRecord.solarSystemID,
      0,
    );
    if (!solarSystemID) {
      continue;
    }

    stationCountBySystemID.set(
      solarSystemID,
      (stationCountBySystemID.get(solarSystemID) || 0) + 1,
    );
  }

  return [...stationCountBySystemID.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([solarSystemID, stationCount]) => ({
      ownerID: numericCorporationID,
      solarSystemID,
      stationCount,
    }));
}

function getCorporationPublicInfo(corporationID) {
  const record = getCorporationRecord(corporationID);
  if (!record) {
    return null;
  }

  const aggressionSettings = readAggressionSettings(record.corporationID, {
    isNpcCorporation: Boolean(record.isNPC),
  });
  const currentFriendlyFire = resolveFriendlyFireLegalAtTime(aggressionSettings, {
    isNpcCorporation: Boolean(record.isNPC),
  })
    ? 1
    : 0;

  return {
    corporationID: record.corporationID,
    corporationName: record.corporationName,
    ticker: record.tickerName || "CORP",
    tickerName: record.tickerName || "CORP",
    ceoID: normalizePositiveInteger(record.ceoID, null),
    creatorID: normalizePositiveInteger(
      record.creatorID,
      normalizePositiveInteger(record.ceoID, null),
    ),
    allianceID: normalizePositiveInteger(record.allianceID, null),
    description: record.description || "",
    stationID: normalizePositiveInteger(record.stationID, null),
    solarSystemID: normalizePositiveInteger(record.solarSystemID, null),
    shares: normalizeInteger(record.shares, 0),
    deleted: record.deleted ? 1 : 0,
    url: record.url || "",
    taxRate: Number(record.taxRate || 0),
    loyaltyPointTaxRate: Number(record.loyaltyPointTaxRate || 0),
    friendlyFire: currentFriendlyFire,
    allowWar: getCorporationWarPermitStatus(record.corporationID),
    memberCount: normalizeInteger(record.memberCount, 0),
    isNPC: Boolean(record.isNPC),
    factionID: normalizePositiveInteger(record.factionID, null),
    warFactionID: normalizePositiveInteger(
      record.warFactionID,
      normalizePositiveInteger(record.factionID, null),
    ),
    raceID: normalizePositiveInteger(record.raceID, null),
    shape1: normalizeLogoPart(record.shape1),
    shape2: normalizeLogoPart(record.shape2),
    shape3: normalizeLogoPart(record.shape3),
    color1: normalizeLogoPart(record.color1),
    color2: normalizeLogoPart(record.color2),
    color3: normalizeLogoPart(record.color3),
    typeface: normalizeLogoPart(record.typeface),
  };
}

function getCorporationInfoRecord(corporationID) {
  const publicInfo = getCorporationPublicInfo(corporationID);
  if (!publicInfo) {
    return null;
  }

  return {
    corporationID: publicInfo.corporationID,
    corporationName: publicInfo.corporationName,
    ticker: publicInfo.ticker,
    tickerName: publicInfo.tickerName,
    ceoID: publicInfo.ceoID,
    creatorID: publicInfo.creatorID,
    allianceID: publicInfo.allianceID,
    description: publicInfo.description,
    stationID: publicInfo.stationID,
    solarSystemID: publicInfo.solarSystemID,
    shares: publicInfo.shares,
    deleted: publicInfo.deleted,
    url: publicInfo.url,
    taxRate: publicInfo.taxRate,
    loyaltyPointTaxRate: publicInfo.loyaltyPointTaxRate,
    friendlyFire: publicInfo.friendlyFire,
    allowWar: publicInfo.allowWar,
    memberCount: publicInfo.memberCount,
    isNPC: publicInfo.isNPC,
    factionID: publicInfo.factionID,
    warFactionID: publicInfo.warFactionID,
    raceID: publicInfo.raceID,
    shape1: publicInfo.shape1,
    shape2: publicInfo.shape2,
    shape3: publicInfo.shape3,
    color1: publicInfo.color1,
    color2: publicInfo.color2,
    color3: publicInfo.color3,
    typeface: publicInfo.typeface,
  };
}

function findCorporationByName(name) {
  const normalizedName = normalizeNameKey(name);
  if (!normalizedName) {
    return null;
  }

  const table = ensureCorporationsInitialized();
  return (
    Object.values(table.records)
      .map((record) => getCorporationRecord(record.corporationID))
      .find(
        (record) => normalizeNameKey(record && record.corporationName) === normalizedName,
      ) || null
  );
}

function findAllianceByName(name) {
  const normalizedName = normalizeNameKey(name);
  if (!normalizedName) {
    return null;
  }

  const table = ensureAlliancesInitialized();
  return (
    Object.values(table.records)
      .map((record) => getAllianceRecord(record.allianceID))
      .find(
        (record) =>
          normalizeNameKey(record && record.allianceName) === normalizedName ||
          normalizeNameKey(record && record.shortName) === normalizedName,
      ) || null
  );
}

function setCorporationRecord(record) {
  const corporationID =
    normalizePositiveInteger(record && record.corporationID, 0) || 0;
  if (!corporationID) {
    return {
      success: false,
      errorMsg: "CORPORATION_ID_REQUIRED",
    };
  }

  const table = ensureCorporationsInitialized();
  table.records[String(corporationID)] = normalizeCorporationLogo(
    cloneValue(record),
  );
  return writeTable(CORPORATIONS_TABLE, table);
}

function setCharacterAffiliation(characterID, corporationID, allianceID = null) {
  const numericCharacterID = normalizePositiveInteger(characterID, 0) || 0;
  const numericCorporationID = normalizePositiveInteger(corporationID, 0) || 0;
  const normalizedAllianceID = normalizePositiveInteger(allianceID, null);

  if (!numericCharacterID || !numericCorporationID) {
    return {
      success: false,
      errorMsg: "INVALID_AFFILIATION",
    };
  }

  const updateResult = updateCharacterStateRecord(numericCharacterID, (record) => {
    const nowFiletime = filetimeNowString();
    const currentCorporationID = normalizePositiveInteger(record.corporationID, 0);
    const corporationChanged = currentCorporationID !== numericCorporationID;
    const updatedRecord = {
      ...record,
      corporationID: numericCorporationID,
      allianceID: normalizedAllianceID || 0,
      allianceMemberStartDate: normalizedAllianceID ? nowFiletime : 0,
      startDateTime: corporationChanged
        ? nowFiletime
        : String(record.startDateTime || record.createDateTime || nowFiletime),
    };
    const employmentHistory = Array.isArray(updatedRecord.employmentHistory)
      ? updatedRecord.employmentHistory.slice()
      : [];
    const lastEntry = employmentHistory.length
      ? employmentHistory[employmentHistory.length - 1]
      : null;

    if (
      corporationChanged &&
      normalizePositiveInteger(lastEntry && lastEntry.corporationID, 0) !==
        numericCorporationID
    ) {
      employmentHistory.push({
        corporationID: numericCorporationID,
        startDate: nowFiletime,
        deleted: 0,
      });
    }

    updatedRecord.employmentHistory = employmentHistory;
    return updatedRecord;
  });
  if (updateResult && updateResult.success) {
    markCorporationMembersIndexDirty();
  }
  return updateResult;
}

function setCorporationAlliance(corporationID, allianceID = null) {
  const corporationRecord = getCorporationRecord(corporationID);
  if (!corporationRecord) {
    return {
      success: false,
      errorMsg: "CORPORATION_NOT_FOUND",
    };
  }

  const normalizedAllianceID = normalizePositiveInteger(allianceID, null);
  const previousAllianceID = normalizePositiveInteger(
    corporationRecord.allianceID,
    null,
  );
  const alliances = ensureAlliancesInitialized();

  if (previousAllianceID && alliances.records[String(previousAllianceID)]) {
    const previousAllianceRecord = cloneValue(
      alliances.records[String(previousAllianceID)],
    );
    previousAllianceRecord.memberCorporationIDs = (
      Array.isArray(previousAllianceRecord.memberCorporationIDs)
        ? previousAllianceRecord.memberCorporationIDs
        : []
    ).filter(
      (memberCorporationID) =>
        normalizePositiveInteger(memberCorporationID, 0) !==
        corporationRecord.corporationID,
    );
    alliances.records[String(previousAllianceID)] = previousAllianceRecord;
  }

  if (normalizedAllianceID) {
    const targetAllianceRecord = alliances.records[String(normalizedAllianceID)];
    if (!targetAllianceRecord) {
      return {
        success: false,
        errorMsg: "ALLIANCE_NOT_FOUND",
      };
    }

    const memberCorporationIDs = new Set(
      (
        Array.isArray(targetAllianceRecord.memberCorporationIDs)
          ? targetAllianceRecord.memberCorporationIDs
          : []
      )
        .map((memberCorporationID) => normalizePositiveInteger(memberCorporationID, 0))
        .filter(Boolean),
    );
    memberCorporationIDs.add(corporationRecord.corporationID);
    targetAllianceRecord.memberCorporationIDs = Array.from(
      memberCorporationIDs,
    ).sort((left, right) => left - right);
    alliances.records[String(normalizedAllianceID)] = targetAllianceRecord;
  }

  const writeAllianceResult = writeTable(ALLIANCES_TABLE, alliances);
  if (!writeAllianceResult.success) {
    return writeAllianceResult;
  }

  const writeCorporationResult = setCorporationRecord({
    ...corporationRecord,
    allianceID: normalizedAllianceID,
  });
  if (!writeCorporationResult.success) {
    return writeCorporationResult;
  }

  const affectedCharacterIDs = getCharacterIDsInCorporation(
    corporationRecord.corporationID,
  );
  for (const characterID of affectedCharacterIDs) {
    const updateResult = setCharacterAffiliation(
      characterID,
      corporationRecord.corporationID,
      normalizedAllianceID,
    );
    if (!updateResult.success) {
      return updateResult;
    }
  }

  return {
    success: true,
    data: {
      corporationID: corporationRecord.corporationID,
      allianceID: normalizedAllianceID,
      affectedCharacterIDs,
    },
  };
}

function createCustomCorporation(characterID, name) {
  const normalizedName = String(name || "").trim();
  if (!normalizedName) {
    return {
      success: false,
      errorMsg: "CORPORATION_NAME_REQUIRED",
    };
  }

  if (findCorporationByName(normalizedName)) {
    return {
      success: false,
      errorMsg: "CORPORATION_NAME_TAKEN",
    };
  }

  const table = ensureCorporationsInitialized();
  const existingTickers = Object.values(table.records).map(
    (record) => record && record.tickerName,
  );
  const corporationID = table._meta.nextCustomCorporationID;
  const characterRecord = readCharacters()[String(characterID)] || {};

  table._meta.nextCustomCorporationID += 1;
  table.records[String(corporationID)] = {
    corporationID,
    corporationName: normalizedName,
    tickerName: buildUniqueTicker(normalizedName, existingTickers, "CORP"),
    description: `Capsuleer corporation ${normalizedName}.`,
    ceoID: normalizePositiveInteger(characterID, null),
    creatorID: normalizePositiveInteger(characterID, null),
    allianceID: null,
    stationID: normalizePositiveInteger(
      characterRecord.homeStationID ||
        characterRecord.cloneStationID ||
        characterRecord.stationID,
      null,
    ),
    solarSystemID: normalizePositiveInteger(characterRecord.solarSystemID, null),
    factionID: null,
    raceID: null,
    deleted: 0,
    shares: 1000,
    taxRate: 0.0,
    loyaltyPointTaxRate: 0.0,
    friendlyFire: 0,
    memberLimit: -1,
    url: "",
    hasPlayerPersonnelManager: true,
    isNPC: false,
    createdAt: filetimeNowString(),
    ...DEFAULT_CUSTOM_CORPORATION_LOGO,
  };

  const writeResult = writeTable(CORPORATIONS_TABLE, table);
  if (!writeResult.success) {
    return writeResult;
  }

  const affiliationResult = setCharacterAffiliation(characterID, corporationID, null);
  if (!affiliationResult.success) {
    return affiliationResult;
  }

  return {
    success: true,
    data: {
      corporationID,
      corporationRecord: getCorporationRecord(corporationID),
      affectedCharacterIDs: [normalizePositiveInteger(characterID, 0)],
    },
  };
}

function createCustomAllianceForCorporation(characterID, corporationID, name) {
  const normalizedName = String(name || "").trim();
  if (!normalizedName) {
    return {
      success: false,
      errorMsg: "ALLIANCE_NAME_REQUIRED",
    };
  }

  const corporationRecord = getCorporationRecord(corporationID);
  if (!corporationRecord) {
    return {
      success: false,
      errorMsg: "CORPORATION_NOT_FOUND",
    };
  }

  if (corporationRecord.isNPC) {
    return {
      success: false,
      errorMsg: "CUSTOM_CORPORATION_REQUIRED",
    };
  }

  if (findAllianceByName(normalizedName)) {
    return {
      success: false,
      errorMsg: "ALLIANCE_NAME_TAKEN",
    };
  }

  const table = ensureAlliancesInitialized();
  const existingTickers = Object.values(table.records).map(
    (record) => record && record.shortName,
  );
  const allianceID = table._meta.nextCustomAllianceID;

  table._meta.nextCustomAllianceID += 1;
  table.records[String(allianceID)] = {
    allianceID,
    allianceName: normalizedName,
    shortName: buildUniqueTicker(normalizedName, existingTickers, "ALLY"),
    creatorID: normalizePositiveInteger(characterID, null),
    executorCorporationID: corporationRecord.corporationID,
    description: `Capsuleer alliance ${normalizedName}.`,
    url: "",
    memberCorporationIDs: [corporationRecord.corporationID],
    isNPC: false,
    createdAt: filetimeNowString(),
  };

  const writeResult = writeTable(ALLIANCES_TABLE, table);
  if (!writeResult.success) {
    return writeResult;
  }

  const affiliationResult = setCorporationAlliance(
    corporationRecord.corporationID,
    allianceID,
  );
  if (!affiliationResult.success) {
    return affiliationResult;
  }

  return {
    success: true,
    data: {
      allianceID,
      allianceRecord: getAllianceRecord(allianceID),
      affectedCharacterIDs: affiliationResult.data.affectedCharacterIDs,
    },
  };
}

function joinCorporationToAllianceByName(corporationID, allianceName) {
  const corporationRecord = getCorporationRecord(corporationID);
  if (!corporationRecord) {
    return {
      success: false,
      errorMsg: "CORPORATION_NOT_FOUND",
    };
  }

  if (corporationRecord.isNPC) {
    return {
      success: false,
      errorMsg: "CUSTOM_CORPORATION_REQUIRED",
    };
  }

  const allianceRecord = findAllianceByName(allianceName);
  if (!allianceRecord) {
    return {
      success: false,
      errorMsg: "ALLIANCE_NOT_FOUND",
    };
  }

  if (
    normalizePositiveInteger(corporationRecord.allianceID, 0) ===
    allianceRecord.allianceID
  ) {
    return {
      success: false,
      errorMsg: "ALREADY_IN_ALLIANCE",
    };
  }

  const affiliationResult = setCorporationAlliance(
    corporationRecord.corporationID,
    allianceRecord.allianceID,
  );
  if (!affiliationResult.success) {
    return affiliationResult;
  }

  return {
    success: true,
    data: {
      allianceID: allianceRecord.allianceID,
      allianceRecord: getAllianceRecord(allianceRecord.allianceID),
      affectedCharacterIDs: affiliationResult.data.affectedCharacterIDs,
    },
  };
}

module.exports = {
  ALLIANCES_TABLE,
  CORPORATIONS_TABLE,
  CUSTOM_ALLIANCE_ID_START,
  CUSTOM_CORPORATION_ID_START,
  createCustomAllianceForCorporation,
  createCustomCorporation,
  ensureAlliancesInitialized,
  ensureCorporationsInitialized,
  findAllianceByName,
  findCorporationByName,
  getAllianceCorporationIDs,
  getAllianceOwnerRecord,
  getAllianceRecord,
  getAllianceShortNameRecord,
  getCharacterIDsInCorporation,
  getCorporationInfoRecord,
  getCorporationOwnerRecord,
  getCorporationPublicInfo,
  getCorporationRecord,
  getCorporationStationSolarSystems,
  getNpcCharacterOwnerRecord,
  getOwnerLookupRecord,
  isNpcCorporationID,
  joinCorporationToAllianceByName,
  setCharacterAffiliation,
  setCorporationAlliance,
};
