const path = require("path");

const database = require(path.join(__dirname, "../../../newDatabase"));

const CHARACTER_EXPERT_SYSTEMS_TABLE = "characterExpertSystems";

let expertSystemMutationVersion = 1;
const characterCache = new Map();

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneValue(value) {
  if (value === null || value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function readStateTable() {
  const result = database.read(CHARACTER_EXPERT_SYSTEMS_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }
  return result.data;
}

function writeStateTable(stateTable) {
  const result = database.write(CHARACTER_EXPERT_SYSTEMS_TABLE, "/", stateTable);
  if (result && result.success) {
    expertSystemMutationVersion += 1;
    characterCache.clear();
  }
  return result;
}

function normalizeInstallEntry(characterID, rawEntry, fallbackTypeID = 0) {
  const typeID = toInt(rawEntry && rawEntry.typeID, fallbackTypeID);
  if (typeID <= 0) {
    return null;
  }
  const installedAtMs = Math.max(
    0,
    toFiniteNumber(rawEntry && rawEntry.installedAtMs, Date.now()),
  );
  const expiresAtMs = Math.max(
    installedAtMs,
    toFiniteNumber(rawEntry && rawEntry.expiresAtMs, installedAtMs),
  );

  return {
    characterID: toInt(characterID, 0),
    typeID,
    installedAtMs: Math.trunc(installedAtMs),
    expiresAtMs: Math.trunc(expiresAtMs),
    sourceItemID: toInt(rawEntry && rawEntry.sourceItemID, 0) || null,
    grantReason: String(rawEntry && rawEntry.grantReason || "unknown"),
    updatedAtMs: Math.max(0, toFiniteNumber(rawEntry && rawEntry.updatedAtMs, Date.now())),
  };
}

function normalizeCharacterState(characterID, rawState = {}) {
  const normalized = {};
  const source =
    rawState && typeof rawState === "object" && !Array.isArray(rawState)
      ? rawState
      : {};

  for (const [rawTypeID, rawEntry] of Object.entries(source)) {
    const entry = normalizeInstallEntry(characterID, rawEntry, rawTypeID);
    if (entry) {
      normalized[String(entry.typeID)] = entry;
    }
  }

  return normalized;
}

function getCharacterExpertSystemState(characterID, options = {}) {
  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return {};
  }

  if (!options.refresh && characterCache.has(numericCharacterID)) {
    return cloneValue(characterCache.get(numericCharacterID));
  }

  const table = readStateTable();
  const normalized = normalizeCharacterState(
    numericCharacterID,
    table[String(numericCharacterID)] || {},
  );
  characterCache.set(numericCharacterID, normalized);
  return cloneValue(normalized);
}

function setCharacterExpertSystemState(characterID, nextState) {
  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return { success: false, errorMsg: "INVALID_CHARACTER" };
  }

  const table = readStateTable();
  const normalized = normalizeCharacterState(numericCharacterID, nextState);
  table[String(numericCharacterID)] = normalized;
  const writeResult = writeStateTable(table);
  if (!writeResult || !writeResult.success) {
    return {
      success: false,
      errorMsg: writeResult && writeResult.errorMsg
        ? writeResult.errorMsg
        : "WRITE_ERROR",
    };
  }

  return { success: true, data: cloneValue(normalized) };
}

function getCharacterExpertSystemEntries(characterID, options = {}) {
  const nowMs = Math.max(0, toFiniteNumber(options.nowMs, Date.now()));
  const includeExpired = Boolean(options.includeExpired);
  const pruneExpired = options.pruneExpired !== false;
  const state = getCharacterExpertSystemState(characterID, {
    refresh: Boolean(options.refresh),
  });
  const entries = Object.values(state)
    .map((entry) => cloneValue(entry))
    .sort((left, right) => left.typeID - right.typeID);
  const activeEntries = entries.filter((entry) => entry.expiresAtMs > nowMs);

  if (pruneExpired && activeEntries.length !== entries.length) {
    const nextState = Object.fromEntries(
      activeEntries.map((entry) => [String(entry.typeID), entry]),
    );
    setCharacterExpertSystemState(characterID, nextState);
  }

  return includeExpired ? entries : activeEntries;
}

function upsertCharacterExpertSystem(characterID, installEntry) {
  const numericCharacterID = toInt(characterID, 0);
  const normalizedEntry = normalizeInstallEntry(
    numericCharacterID,
    installEntry,
    installEntry && installEntry.typeID,
  );
  if (numericCharacterID <= 0 || !normalizedEntry) {
    return { success: false, errorMsg: "INVALID_EXPERT_SYSTEM_INSTALL" };
  }

  const state = getCharacterExpertSystemState(numericCharacterID, { refresh: true });
  state[String(normalizedEntry.typeID)] = normalizedEntry;
  return setCharacterExpertSystemState(numericCharacterID, state);
}

function removeCharacterExpertSystem(characterID, typeID) {
  const numericCharacterID = toInt(characterID, 0);
  const numericTypeID = toInt(typeID, 0);
  if (numericCharacterID <= 0 || numericTypeID <= 0) {
    return { success: false, errorMsg: "INVALID_EXPERT_SYSTEM_INSTALL" };
  }

  const state = getCharacterExpertSystemState(numericCharacterID, { refresh: true });
  const removedEntry = state[String(numericTypeID)] || null;
  if (!removedEntry) {
    return { success: true, removed: false, data: null };
  }
  delete state[String(numericTypeID)];
  const writeResult = setCharacterExpertSystemState(numericCharacterID, state);
  return {
    ...writeResult,
    removed: Boolean(writeResult && writeResult.success),
    data: cloneValue(removedEntry),
  };
}

function clearCharacterExpertSystems(characterID) {
  const previousState = getCharacterExpertSystemState(characterID, { refresh: true });
  const writeResult = setCharacterExpertSystemState(characterID, {});
  return {
    ...writeResult,
    previousEntries: Object.values(previousState).map((entry) => cloneValue(entry)),
  };
}

function getExpertSystemMutationVersion() {
  return expertSystemMutationVersion;
}

function resetExpertSystemStateForTests() {
  characterCache.clear();
  expertSystemMutationVersion += 1;
}

module.exports = {
  CHARACTER_EXPERT_SYSTEMS_TABLE,
  clearCharacterExpertSystems,
  getCharacterExpertSystemEntries,
  getCharacterExpertSystemState,
  getExpertSystemMutationVersion,
  removeCharacterExpertSystem,
  resetExpertSystemStateForTests,
  setCharacterExpertSystemState,
  upsertCharacterExpertSystem,
};
