const path = require("path");

const config = require(path.join(__dirname, "../../config"));
const database = require(path.join(__dirname, "../../newDatabase"));
const {
  currentFileTime,
  normalizeBigInt,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getStructureByID,
} = require(path.join(__dirname, "../structure/structureState"));

const MINING_LEDGER_TABLE = "miningLedger";
const LEDGER_VERSION = 1;
const LEDGER_RETENTION_DAYS = 90;
const LEDGER_PRUNE_INTERVAL_MS = 5 * 60 * 1000;
const FILETIME_TICKS_PER_MS = 10000n;
const FILETIME_EPOCH_OFFSET = 116444736000000000n;
const LEDGER_RETENTION_TICKS =
  BigInt(LEDGER_RETENTION_DAYS) * 24n * 60n * 60n * 1000n * FILETIME_TICKS_PER_MS;

let ledgerTableCache = null;
let ledgerMutationVersion = 0;
let nextPruneAtMs = 0;
const characterLogCache = new Map();
const observerLogCache = new Map();
const observerHeaderCache = new Map();
let lastVisibilityCacheSecond = -1;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizePositiveInteger(value, fallback = 0) {
  const numeric = toInt(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function normalizeFiletimeString(value, fallback = null) {
  const normalized = normalizeBigInt(value, fallback === null ? currentFileTime() : fallback);
  return normalized > 0n ? normalized.toString() : currentFileTime().toString();
}

function filetimeFromUnixMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return currentFileTime();
  }
  return BigInt(Math.trunc(numeric)) * FILETIME_TICKS_PER_MS + FILETIME_EPOCH_OFFSET;
}

function filetimeToUnixMs(value, fallback = Date.now()) {
  const normalized = normalizeBigInt(value, -1n);
  if (normalized <= FILETIME_EPOCH_OFFSET) {
    return fallback;
  }
  return Number((normalized - FILETIME_EPOCH_OFFSET) / FILETIME_TICKS_PER_MS);
}

function coerceEventDateMs(value, fallback = Date.now()) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  const normalized = normalizeBigInt(value, -1n);
  if (normalized > FILETIME_EPOCH_OFFSET) {
    return filetimeToUnixMs(normalized, fallback);
  }
  return fallback;
}

function normalizeDelayMs(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Math.max(0, fallback);
  }
  return Math.max(0, Math.trunc(numeric));
}

function resolveCharacterLedgerDelayMs() {
  return normalizeDelayMs(config.miningCharacterLedgerDelayMs, 0);
}

function resolveObserverLedgerDelayMs() {
  return normalizeDelayMs(config.miningObserverLedgerDelayMs, 0);
}

function buildVisibleAfterFiletime(eventDate, delayMs = 0) {
  const normalizedDelayMs = normalizeDelayMs(delayMs, 0);
  const eventMs = coerceEventDateMs(eventDate);
  return filetimeFromUnixMs(eventMs + normalizedDelayMs).toString();
}

function getVisibilityCacheSecond(nowFiletime = currentFileTime()) {
  const numericNowMs = filetimeToUnixMs(nowFiletime);
  const cacheSecond = Math.max(0, Math.trunc(numericNowMs / 1000));
  if (cacheSecond !== lastVisibilityCacheSecond) {
    characterLogCache.clear();
    observerLogCache.clear();
    observerHeaderCache.clear();
    lastVisibilityCacheSecond = cacheSecond;
  }
  return cacheSecond;
}

function buildDefaultMiningLedgerTable() {
  return {
    _meta: {
      version: LEDGER_VERSION,
      nextEntryID: 1,
      lastPrunedAtFiletime: null,
    },
    characters: {},
    observers: {},
  };
}

function ensureTableShape(table) {
  const nextTable =
    table && typeof table === "object" ? table : buildDefaultMiningLedgerTable();
  nextTable._meta =
    nextTable._meta && typeof nextTable._meta === "object"
      ? nextTable._meta
      : {};
  nextTable._meta.version = LEDGER_VERSION;
  nextTable._meta.nextEntryID = Math.max(
    1,
    normalizePositiveInteger(nextTable._meta.nextEntryID, 1),
  );
  nextTable._meta.lastPrunedAtFiletime =
    nextTable._meta.lastPrunedAtFiletime || null;
  nextTable.characters =
    nextTable.characters && typeof nextTable.characters === "object"
      ? nextTable.characters
      : {};
  nextTable.observers =
    nextTable.observers && typeof nextTable.observers === "object"
      ? nextTable.observers
      : {};
  return nextTable;
}

function clearComputedCaches() {
  characterLogCache.clear();
  observerLogCache.clear();
  observerHeaderCache.clear();
  lastVisibilityCacheSecond = -1;
}

function bumpLedgerMutationVersion() {
  ledgerMutationVersion += 1;
  clearComputedCaches();
}

function clearMiningLedgerCaches() {
  ledgerTableCache = null;
  ledgerMutationVersion = 0;
  nextPruneAtMs = 0;
  clearComputedCaches();
}

function ensureMiningLedgerTable() {
  if (ledgerTableCache) {
    return ledgerTableCache;
  }

  const readResult = database.read(MINING_LEDGER_TABLE, "/");
  const normalizedTable = ensureTableShape(
    readResult && readResult.success ? readResult.data : null,
  );
  ledgerTableCache = normalizedTable;

  if (!readResult || !readResult.success) {
    database.write(MINING_LEDGER_TABLE, "/", normalizedTable);
  }

  return ledgerTableCache;
}

function normalizeLedgerEntry(entry, overrides = {}) {
  const normalized = {
    entryID: normalizePositiveInteger(
      overrides.entryID ?? entry.entryID,
      0,
    ),
    eventDate: normalizeFiletimeString(
      overrides.eventDate ?? entry.eventDate,
    ),
    characterID: normalizePositiveInteger(
      overrides.characterID ?? entry.characterID,
      0,
    ),
    corporationID: normalizePositiveInteger(
      overrides.corporationID ?? entry.corporationID,
      0,
    ),
    solarSystemID: normalizePositiveInteger(
      overrides.solarSystemID ?? entry.solarSystemID,
      0,
    ),
    typeID: normalizePositiveInteger(overrides.typeID ?? entry.typeID, 0),
    quantity: Math.max(0, toInt(overrides.quantity ?? entry.quantity, 0)),
    quantityWasted: Math.max(
      0,
      toInt(overrides.quantityWasted ?? entry.quantityWasted, 0),
    ),
    quantityCritical: Math.max(
      0,
      toInt(overrides.quantityCritical ?? entry.quantityCritical, 0),
    ),
    shipTypeID: normalizePositiveInteger(
      overrides.shipTypeID ?? entry.shipTypeID,
      0,
    ),
    moduleTypeID: normalizePositiveInteger(
      overrides.moduleTypeID ?? entry.moduleTypeID,
      0,
    ),
    yieldKind: String(
      (overrides.yieldKind ?? entry.yieldKind) || "",
    ).trim().toLowerCase(),
    observerItemID: normalizePositiveInteger(
      overrides.observerItemID ?? entry.observerItemID,
      0,
    ),
    characterVisibleAfter: normalizeFiletimeString(
      overrides.characterVisibleAfter ?? entry.characterVisibleAfter,
      overrides.eventDate ?? entry.eventDate,
    ),
    observerVisibleAfter: normalizeFiletimeString(
      overrides.observerVisibleAfter ?? entry.observerVisibleAfter,
      overrides.eventDate ?? entry.eventDate,
    ),
  };

  return normalized;
}

function normalizeObserverBucket(observerID, bucket = {}, fallbackCorporationID = 0) {
  return {
    itemID: normalizePositiveInteger(bucket.itemID ?? observerID, 0),
    corporationID: normalizePositiveInteger(
      bucket.corporationID,
      fallbackCorporationID,
    ),
    solarSystemID: normalizePositiveInteger(bucket.solarSystemID, 0),
    itemName: String(bucket.itemName || "").trim(),
    entries: Array.isArray(bucket.entries)
      ? bucket.entries.map((entry) => normalizeLedgerEntry(entry))
      : [],
  };
}

function compareEntriesDescending(left, right) {
  const leftFiletime = normalizeBigInt(left && left.eventDate, 0n);
  const rightFiletime = normalizeBigInt(right && right.eventDate, 0n);
  if (leftFiletime === rightFiletime) {
    return toInt(right && right.entryID, 0) - toInt(left && left.entryID, 0);
  }
  return rightFiletime > leftFiletime ? 1 : -1;
}

function isEntryVisible(entry, visibilityField, nowFiletime = currentFileTime()) {
  return normalizeBigInt(entry && entry[visibilityField], 0n) <=
    normalizeBigInt(nowFiletime, currentFileTime());
}

function filterVisibleEntries(entries = [], visibilityField, nowFiletime = currentFileTime()) {
  return entries.filter((entry) => isEntryVisible(entry, visibilityField, nowFiletime));
}

function buildObserverDescriptor(observerID, bucket = null) {
  const numericObserverID = normalizePositiveInteger(observerID, 0);
  const structure = numericObserverID
    ? getStructureByID(numericObserverID, { refresh: false })
    : null;
  const normalizedBucket = normalizeObserverBucket(
    numericObserverID,
    bucket || {},
    normalizePositiveInteger(
      structure && (structure.ownerCorpID || structure.ownerID),
      0,
    ),
  );
  return {
    itemID: numericObserverID,
    corporationID: normalizedBucket.corporationID,
    solarSystemID: normalizePositiveInteger(
      normalizedBucket.solarSystemID || (structure && structure.solarSystemID),
      0,
    ),
    itemName:
      normalizedBucket.itemName ||
      String(structure && (structure.name || structure.itemName) || `Observer ${numericObserverID}`),
  };
}

function maybePruneExpiredEntries(nowFiletime = currentFileTime(), options = {}) {
  const force = options.force === true;
  const nowMs = Date.now();
  if (!force && nextPruneAtMs > nowMs) {
    return false;
  }

  const table = ensureMiningLedgerTable();
  const cutoffFiletime = normalizeBigInt(nowFiletime, currentFileTime()) - LEDGER_RETENTION_TICKS;
  let changed = false;

  for (const [characterID, bucket] of Object.entries(table.characters || {})) {
    const entries = Array.isArray(bucket && bucket.entries) ? bucket.entries : [];
    const retainedEntries = entries.filter(
      (entry) => normalizeBigInt(entry && entry.eventDate, 0n) >= cutoffFiletime,
    );
    if (retainedEntries.length === entries.length) {
      continue;
    }
    changed = true;
    if (retainedEntries.length > 0) {
      bucket.entries = retainedEntries;
    } else {
      delete table.characters[characterID];
    }
  }

  for (const [observerID, bucket] of Object.entries(table.observers || {})) {
    const entries = Array.isArray(bucket && bucket.entries) ? bucket.entries : [];
    const retainedEntries = entries.filter(
      (entry) => normalizeBigInt(entry && entry.eventDate, 0n) >= cutoffFiletime,
    );
    if (retainedEntries.length === entries.length) {
      continue;
    }
    changed = true;
    if (retainedEntries.length > 0) {
      bucket.entries = retainedEntries;
    } else {
      delete table.observers[observerID];
    }
  }

  table._meta.lastPrunedAtFiletime = normalizeBigInt(
    nowFiletime,
    currentFileTime(),
  ).toString();
  nextPruneAtMs = nowMs + LEDGER_PRUNE_INTERVAL_MS;

  if (changed) {
    database.write(MINING_LEDGER_TABLE, "/", table);
    bumpLedgerMutationVersion();
  }

  return changed;
}

function ensureCharacterBucket(table, characterID, corporationID) {
  const key = String(characterID);
  if (!table.characters[key] || typeof table.characters[key] !== "object") {
    table.characters[key] = {
      characterID,
      corporationID,
      entries: [],
    };
  }
  table.characters[key].characterID = characterID;
  table.characters[key].corporationID = corporationID;
  if (!Array.isArray(table.characters[key].entries)) {
    table.characters[key].entries = [];
  }
  return table.characters[key];
}

function ensureObserverBucket(table, observerID, descriptor) {
  const key = String(observerID);
  const currentBucket =
    table.observers[key] && typeof table.observers[key] === "object"
      ? table.observers[key]
      : {};
  table.observers[key] = normalizeObserverBucket(
    observerID,
    {
      ...currentBucket,
      ...descriptor,
      entries: Array.isArray(currentBucket.entries) ? currentBucket.entries : [],
    },
    descriptor.corporationID,
  );
  return table.observers[key];
}

function recordMiningLedgerEvent(payload = {}) {
  const characterID = normalizePositiveInteger(payload.characterID, 0);
  const corporationID = normalizePositiveInteger(payload.corporationID, 0);
  const typeID = normalizePositiveInteger(payload.typeID, 0);
  const quantity = Math.max(0, toInt(payload.quantity, 0));
  const quantityWasted = Math.max(0, toInt(payload.quantityWasted, 0));
  if (characterID <= 0 || typeID <= 0 || (quantity <= 0 && quantityWasted <= 0)) {
    return {
      success: false,
      errorMsg: "INVALID_EVENT",
    };
  }

  const table = ensureMiningLedgerTable();
  const eventDate = normalizeFiletimeString(
    payload.eventDate || filetimeFromUnixMs(payload.eventDateMs),
  );
  maybePruneExpiredEntries(eventDate);

  const entryID = table._meta.nextEntryID;
  table._meta.nextEntryID += 1;
  const entry = normalizeLedgerEntry(payload, {
    entryID,
    eventDate,
    characterID,
    corporationID,
    typeID,
    quantity,
    quantityWasted,
    characterVisibleAfter: buildVisibleAfterFiletime(
      eventDate,
      resolveCharacterLedgerDelayMs(),
    ),
    observerVisibleAfter: buildVisibleAfterFiletime(
      eventDate,
      resolveObserverLedgerDelayMs(),
    ),
  });

  const characterBucket = ensureCharacterBucket(table, characterID, corporationID);
  characterBucket.entries.push(entry);
  database.write(
    MINING_LEDGER_TABLE,
    `/characters/${String(characterID)}`,
    characterBucket,
  );

  if (entry.observerItemID > 0) {
    const observerDescriptor = buildObserverDescriptor(entry.observerItemID, {
      corporationID,
      solarSystemID: entry.solarSystemID,
      itemName: payload.observerItemName,
    });
    const observerBucket = ensureObserverBucket(
      table,
      entry.observerItemID,
      observerDescriptor,
    );
    observerBucket.entries.push(entry);
    database.write(
      MINING_LEDGER_TABLE,
      `/observers/${String(entry.observerItemID)}`,
      observerBucket,
    );
  }

  bumpLedgerMutationVersion();
  return {
    success: true,
    data: cloneValue(entry),
  };
}

function getCharacterMiningLogs(characterID, options = {}) {
  const numericCharacterID = normalizePositiveInteger(characterID, 0);
  if (!numericCharacterID) {
    return [];
  }

  const nowFiletime = normalizeBigInt(
    options.nowFiletime,
    currentFileTime(),
  );
  const visibilityToken = options.includeHidden === true
    ? "all"
    : String(getVisibilityCacheSecond(nowFiletime));
  maybePruneExpiredEntries(nowFiletime);
  const bucketKey = String(numericCharacterID);
  const cacheKey = `${bucketKey}:${visibilityToken}`;
  const cached = characterLogCache.get(cacheKey);
  if (cached && cached.version === ledgerMutationVersion) {
    return cached.entries;
  }

  const table = ensureMiningLedgerTable();
  const entries = Array.isArray(
    table.characters &&
      table.characters[bucketKey] &&
      table.characters[bucketKey].entries,
  )
    ? table.characters[bucketKey].entries.slice().sort(compareEntriesDescending)
    : [];
  const visibleEntries = options.includeHidden === true
    ? entries
    : filterVisibleEntries(entries, "characterVisibleAfter", nowFiletime);

  characterLogCache.set(cacheKey, {
    version: ledgerMutationVersion,
    entries: visibleEntries,
  });
  return visibleEntries;
}

function getObserverMiningLedger(observerItemID, corporationID = 0, options = {}) {
  const numericObserverID = normalizePositiveInteger(observerItemID, 0);
  const numericCorporationID = normalizePositiveInteger(corporationID, 0);
  if (!numericObserverID) {
    return [];
  }

  const nowFiletime = normalizeBigInt(
    options.nowFiletime,
    currentFileTime(),
  );
  const visibilityToken = options.includeHidden === true
    ? "all"
    : String(getVisibilityCacheSecond(nowFiletime));
  maybePruneExpiredEntries(nowFiletime);
  const cacheKey = `${numericCorporationID}:${numericObserverID}:${visibilityToken}`;
  const cached = observerLogCache.get(cacheKey);
  if (cached && cached.version === ledgerMutationVersion) {
    return cached.entries;
  }

  const table = ensureMiningLedgerTable();
  const bucket =
    table.observers && table.observers[String(numericObserverID)]
      ? normalizeObserverBucket(
          numericObserverID,
          table.observers[String(numericObserverID)],
        )
      : null;
  const entries =
    bucket &&
    (!numericCorporationID || bucket.corporationID === numericCorporationID)
      ? bucket.entries.slice().sort(compareEntriesDescending)
      : [];
  const visibleEntries = options.includeHidden === true
    ? entries
    : filterVisibleEntries(entries, "observerVisibleAfter", nowFiletime);

  observerLogCache.set(cacheKey, {
    version: ledgerMutationVersion,
    entries: visibleEntries,
  });
  return visibleEntries;
}

function listObserverHeadersForCorporation(corporationID, options = {}) {
  const numericCorporationID = normalizePositiveInteger(corporationID, 0);
  if (!numericCorporationID) {
    return [];
  }

  const nowFiletime = normalizeBigInt(
    options.nowFiletime,
    currentFileTime(),
  );
  const visibilityToken = options.includeHidden === true
    ? "all"
    : String(getVisibilityCacheSecond(nowFiletime));
  maybePruneExpiredEntries(nowFiletime);
  const cacheKey = `${numericCorporationID}:${visibilityToken}`;
  const cached = observerHeaderCache.get(cacheKey);
  if (cached && cached.version === ledgerMutationVersion) {
    return cached.headers;
  }

  const table = ensureMiningLedgerTable();
  const headers = Object.entries(table.observers || {})
    .filter(([, bucket]) => Array.isArray(bucket && bucket.entries) && bucket.entries.length > 0)
    .filter(([, bucket]) => (
      options.includeHidden === true ||
      filterVisibleEntries(bucket.entries, "observerVisibleAfter", nowFiletime).length > 0
    ))
    .map(([observerID, bucket]) => buildObserverDescriptor(observerID, bucket))
    .filter(
      (entry) =>
        entry.corporationID === numericCorporationID,
    )
    .sort(
      (left, right) =>
        String(left.itemName || "").localeCompare(String(right.itemName || "")) ||
        left.itemID - right.itemID,
    );

  observerHeaderCache.set(cacheKey, {
    version: ledgerMutationVersion,
    headers,
  });
  return headers;
}

module.exports = {
  MINING_LEDGER_TABLE,
  LEDGER_RETENTION_DAYS,
  buildVisibleAfterFiletime,
  buildDefaultMiningLedgerTable,
  clearMiningLedgerCaches,
  ensureMiningLedgerTable,
  filetimeFromUnixMs,
  filetimeToUnixMs,
  getCharacterMiningLogs,
  getObserverMiningLedger,
  listObserverHeadersForCorporation,
  maybePruneExpiredEntries,
  recordMiningLedgerEvent,
};
