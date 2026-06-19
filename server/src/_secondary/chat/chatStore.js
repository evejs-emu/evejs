const fs = require("fs");
const path = require("path");
const {
  getXmppConferenceDomain,
  getXmppConferenceDomainPattern,
} = require(path.join(__dirname, "../../services/chat/xmppConfig"));

const DATA_ROOT = path.resolve(
  process.env.EVEJS_CHAT_DATA_ROOT || path.join(__dirname, "../data/chat"),
);
const STATE_PATH = path.join(DATA_ROOT, "state.json");
const BACKLOG_DIR = path.join(DATA_ROOT, "backlog");
const DISCOVERY_PATH = path.join(DATA_ROOT, "staticContracts.json");
const STATE_VERSION = 1;
const DEFAULT_STATE = Object.freeze({
  version: STATE_VERSION,
  nextPlayerChannelID: 1000000,
  nextPrivateChannelID: 1,
  channels: {},
  privateChannelByPair: {},
});

let stateCache = null;
let stateWriteTimer = null;
let discoveryCache = null;
let discoveryWriteTimer = null;
const backlogCache = new Map();
const INVALID_ROOM_NAMES = new Set([
  "[object object]",
]);
const LEGACY_ROOM_NAME_ALIASES = Object.freeze({
  system_evejs_elysian_chat: "player_900001",
  system_263328_900001: "player_900001",
});

function cloneValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureDataRoot() {
  ensureDir(DATA_ROOT);
  ensureDir(BACKLOG_DIR);
}

function getBacklogCacheEntry(roomName) {
  const normalizedRoomName = normalizeString(roomName, "").trim();
  if (!normalizedRoomName) {
    return [];
  }

  if (backlogCache.has(normalizedRoomName)) {
    return backlogCache.get(normalizedRoomName).map((entry) => cloneValue(entry));
  }

  const backlogPath = getBacklogPath(normalizedRoomName);
  if (!fs.existsSync(backlogPath)) {
    backlogCache.set(normalizedRoomName, []);
    return [];
  }

  try {
    const entries = fs
      .readFileSync(backlogPath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (error) {
          return null;
        }
      })
      .filter(Boolean);
    backlogCache.set(normalizedRoomName, entries);
    return entries.map((entry) => cloneValue(entry));
  } catch (error) {
    backlogCache.set(normalizedRoomName, []);
    return [];
  }
}

function writeBacklogEntries(roomName, entries = []) {
  const normalizedRoomName = normalizeString(roomName, "").trim();
  if (!normalizedRoomName) {
    return false;
  }

  ensureDataRoot();
  const backlogPath = getBacklogPath(normalizedRoomName);
  const normalizedEntries = (Array.isArray(entries) ? entries : [])
    .filter(Boolean)
    .map((entry) => cloneValue(entry));
  backlogCache.set(normalizedRoomName, normalizedEntries);

  if (normalizedEntries.length === 0) {
    if (fs.existsSync(backlogPath)) {
      fs.unlinkSync(backlogPath);
    }
    return true;
  }

  const payload = normalizedEntries
    .map((entry) => JSON.stringify(entry))
    .join("\n");
  fs.writeFileSync(backlogPath, `${payload}\n`, "utf8");
  return true;
}

function unwrapMarshalScalar(value) {
  if (value === undefined || value === null) {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  if (value && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "value")) {
      return unwrapMarshalScalar(value.value);
    }
    if (
      value.type === "object" &&
      Object.prototype.hasOwnProperty.call(value, "name")
    ) {
      return unwrapMarshalScalar(value.name);
    }
  }
  return value;
}

function normalizePositiveInteger(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue <= 0) {
    return fallback;
  }
  return numericValue;
}

function normalizeString(value, fallback = "") {
  const unwrappedValue = unwrapMarshalScalar(value);
  if (typeof unwrappedValue === "string") {
    return unwrappedValue;
  }
  if (unwrappedValue === null || unwrappedValue === undefined) {
    return fallback;
  }
  return String(unwrappedValue);
}

function normalizeRoomName(value) {
  let roomName = normalizeString(value, "").trim();
  if (!roomName) {
    return "";
  }

  if (getXmppConferenceDomainPattern().test(roomName)) {
    roomName = roomName.split("@")[0].trim();
  }

  const normalizedRoomName = roomName.toLowerCase();
  if (
    !roomName ||
    INVALID_ROOM_NAMES.has(normalizedRoomName) ||
    normalizedRoomName === String(getXmppConferenceDomain()).toLowerCase()
  ) {
    return "";
  }

  return resolveRoomNameAlias(roomName);
}

function resolveRoomNameAlias(roomName) {
  const normalizedRoomName = normalizeString(roomName, "").trim().toLowerCase();
  if (!normalizedRoomName) {
    return "";
  }
  return LEGACY_ROOM_NAME_ALIASES[normalizedRoomName] || normalizeString(roomName, "").trim();
}

function normalizeDisplayName(value, fallback = "") {
  const displayName = normalizeString(value, fallback).trim();
  if (!displayName || displayName === "[object Object]") {
    return normalizeString(fallback, "").trim();
  }
  return displayName;
}

function normalizeUniqueIntegerList(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => normalizePositiveInteger(value, 0))
      .filter((value) => value > 0),
  )].sort((left, right) => left - right);
}

function normalizeModerationMap(entries = {}) {
  const nextEntries = {};
  if (!entries || typeof entries !== "object") {
    return nextEntries;
  }

  for (const [rawCharacterID, entry] of Object.entries(entries)) {
    const characterID = normalizePositiveInteger(rawCharacterID, 0);
    if (!characterID) {
      continue;
    }

    nextEntries[String(characterID)] = {
      characterID,
      untilMs: Math.max(0, Number(entry && entry.untilMs) || 0),
      reason: normalizeString(entry && entry.reason, ""),
      byCharacterID: normalizePositiveInteger(entry && entry.byCharacterID, 0),
      createdAtMs: Math.max(0, Number(entry && entry.createdAtMs) || 0),
    };
  }

  return nextEntries;
}

function normalizeChannelRecord(record = {}) {
  const roomName = normalizeRoomName(record.roomName);
  if (!roomName) {
    return null;
  }

  const type = normalizeString(record.type, "system").trim().toLowerCase() || "system";
  const scope = normalizeString(record.scope, type).trim().toLowerCase() || type;
  const nowMs = Date.now();
  const ownerCharacterID = normalizePositiveInteger(record.ownerCharacterID, 0);
  const passwordRequired = Boolean(record.passwordRequired);
  const password = passwordRequired ? normalizeString(record.password, "") : "";
  const operatorCharacterIDs = normalizeUniqueIntegerList(record.operatorCharacterIDs);
  return {
    roomName,
    type,
    scope,
    entityID: normalizePositiveInteger(record.entityID, 0),
    displayName: normalizeDisplayName(record.displayName, roomName),
    motd: normalizeString(record.motd, ""),
    topic: normalizeString(record.topic, ""),
    ownerCharacterID,
    password,
    passwordRequired,
    static: record.static !== false,
    verifiedContract: record.verifiedContract === true,
    contractSource: normalizeString(record.contractSource, "runtime"),
    memberless: Boolean(record.memberless),
    temporary: Boolean(record.temporary),
    destroyWhenEmpty: Boolean(record.destroyWhenEmpty),
    inviteOnly: Boolean(record.inviteOnly),
    persistBacklog: record.persistBacklog !== false,
    backlogLimit: Math.max(0, Number(record.backlogLimit) || 100),
    createdAtMs: Math.max(0, Number(record.createdAtMs) || nowMs),
    updatedAtMs: Math.max(0, Number(record.updatedAtMs) || nowMs),
    inviteToken: normalizeString(record.inviteToken, ""),
    invitedCharacters: normalizeUniqueIntegerList(record.invitedCharacters),
    adminCharacterIDs: normalizeUniqueIntegerList(record.adminCharacterIDs),
    operatorCharacterIDs:
      type === "player" && ownerCharacterID > 0
        ? normalizeUniqueIntegerList([
            ...operatorCharacterIDs,
            ownerCharacterID,
          ])
        : operatorCharacterIDs,
    allowCharacterIDs: normalizeUniqueIntegerList(record.allowCharacterIDs),
    denyCharacterIDs: normalizeUniqueIntegerList(record.denyCharacterIDs),
    allowCorporationIDs: normalizeUniqueIntegerList(record.allowCorporationIDs),
    denyCorporationIDs: normalizeUniqueIntegerList(record.denyCorporationIDs),
    allowAllianceIDs: normalizeUniqueIntegerList(record.allowAllianceIDs),
    denyAllianceIDs: normalizeUniqueIntegerList(record.denyAllianceIDs),
    allowedParticipantCharacterIDs: normalizeUniqueIntegerList(
      record.allowedParticipantCharacterIDs,
    ),
    metadata:
      record.metadata && typeof record.metadata === "object"
        ? cloneValue(record.metadata)
        : {},
    mutedCharacters: normalizeModerationMap(record.mutedCharacters),
    bannedCharacters: normalizeModerationMap(record.bannedCharacters),
  };
}

function buildDefaultState() {
  return cloneValue(DEFAULT_STATE);
}

function loadStateFromDisk() {
  ensureDataRoot();
  if (!fs.existsSync(STATE_PATH)) {
    return buildDefaultState();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    const nextState = buildDefaultState();
    nextState.version = normalizePositiveInteger(parsed && parsed.version, STATE_VERSION);
    nextState.nextPlayerChannelID = Math.max(
      1000000,
      normalizePositiveInteger(parsed && parsed.nextPlayerChannelID, 1000000),
    );
    nextState.nextPrivateChannelID = Math.max(
      1,
      normalizePositiveInteger(parsed && parsed.nextPrivateChannelID, 1),
    );

    const channels = parsed && parsed.channels && typeof parsed.channels === "object"
      ? parsed.channels
      : {};
    for (const [roomName, rawRecord] of Object.entries(channels)) {
      const normalized = normalizeChannelRecord({
        ...rawRecord,
        roomName,
      });
      if (!normalized) {
        continue;
      }
      nextState.channels[normalized.roomName] = normalized;
    }

    const privateChannelByPair =
      parsed &&
      parsed.privateChannelByPair &&
      typeof parsed.privateChannelByPair === "object"
        ? parsed.privateChannelByPair
        : {};
    for (const [pairKey, roomName] of Object.entries(privateChannelByPair)) {
      const normalizedRoomName = normalizeString(roomName, "").trim();
      if (!normalizedRoomName) {
        continue;
      }
      nextState.privateChannelByPair[normalizeString(pairKey, "")] =
        normalizedRoomName;
    }

    return nextState;
  } catch (error) {
    return buildDefaultState();
  }
}

function getState() {
  if (!stateCache) {
    stateCache = loadStateFromDisk();
  }
  return stateCache;
}

function flushStateNow() {
  ensureDataRoot();
  if (stateWriteTimer) {
    clearTimeout(stateWriteTimer);
    stateWriteTimer = null;
  }

  const payload = JSON.stringify(getState(), null, 2);
  const tempPath = `${STATE_PATH}.tmp`;
  fs.writeFileSync(tempPath, payload, "utf8");
  fs.renameSync(tempPath, STATE_PATH);
}

function scheduleStateWrite() {
  if (stateWriteTimer) {
    return;
  }
  stateWriteTimer = setTimeout(() => {
    stateWriteTimer = null;
    flushStateNow();
  }, 25);
  if (typeof stateWriteTimer.unref === "function") {
    stateWriteTimer.unref();
  }
}

function loadDiscoveryFromDisk() {
  ensureDataRoot();
  if (!fs.existsSync(DISCOVERY_PATH)) {
    return {
      version: STATE_VERSION,
      observations: {},
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(DISCOVERY_PATH, "utf8"));
    return {
      version: normalizePositiveInteger(parsed && parsed.version, STATE_VERSION),
      observations:
        parsed && parsed.observations && typeof parsed.observations === "object"
          ? parsed.observations
          : {},
    };
  } catch (error) {
    return {
      version: STATE_VERSION,
      observations: {},
    };
  }
}

function getDiscovery() {
  if (!discoveryCache) {
    discoveryCache = loadDiscoveryFromDisk();
  }
  return discoveryCache;
}

function flushDiscoveryNow() {
  ensureDataRoot();
  if (discoveryWriteTimer) {
    clearTimeout(discoveryWriteTimer);
    discoveryWriteTimer = null;
  }

  const payload = JSON.stringify(getDiscovery(), null, 2);
  const tempPath = `${DISCOVERY_PATH}.tmp`;
  fs.writeFileSync(tempPath, payload, "utf8");
  fs.renameSync(tempPath, DISCOVERY_PATH);
}

function scheduleDiscoveryWrite() {
  if (discoveryWriteTimer) {
    return;
  }
  discoveryWriteTimer = setTimeout(() => {
    discoveryWriteTimer = null;
    flushDiscoveryNow();
  }, 25);
  if (typeof discoveryWriteTimer.unref === "function") {
    discoveryWriteTimer.unref();
  }
}

function getChannelRecord(roomName) {
  const record = getState().channels[normalizeString(roomName, "").trim()];
  return record ? cloneValue(record) : null;
}

function setChannelRecord(record) {
  const normalized = normalizeChannelRecord(record);
  if (!normalized) {
    return null;
  }
  normalized.updatedAtMs = Date.now();
  getState().channels[normalized.roomName] = normalized;
  scheduleStateWrite();
  return cloneValue(normalized);
}

function updateChannelRecord(roomName, mutator) {
  const current = getChannelRecord(roomName) || normalizeChannelRecord({ roomName });
  const nextRecord = mutator ? mutator(cloneValue(current)) : current;
  return setChannelRecord({
    ...nextRecord,
    roomName: normalizeString(roomName, "").trim(),
  });
}

function deleteChannelRecord(roomName) {
  const normalizedRoomName = normalizeString(roomName, "").trim();
  if (!normalizedRoomName) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(getState().channels, normalizedRoomName)) {
    return false;
  }

  delete getState().channels[normalizedRoomName];
  for (const [pairKey, mappedRoomName] of Object.entries(getState().privateChannelByPair)) {
    if (mappedRoomName === normalizedRoomName) {
      delete getState().privateChannelByPair[pairKey];
    }
  }
  scheduleStateWrite();
  return true;
}

function listChannelRecords() {
  return Object.values(getState().channels).map((record) => cloneValue(record));
}

function getBacklogPath(roomName) {
  const safeFileName = normalizeString(roomName, "")
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "_")
    .slice(0, 200);
  return path.join(BACKLOG_DIR, `${safeFileName || "channel"}.jsonl`);
}

function appendBacklogEntry(roomName, entry, options = {}) {
  const normalizedRoomName = normalizeString(roomName, "").trim();
  if (!normalizedRoomName) {
    return false;
  }

  const limit = Math.max(0, Number(options.limit) || 0);
  const nextEntry = {
    roomName: normalizedRoomName,
    createdAtMs: Date.now(),
    ...cloneValue(entry),
  };
  const nextEntries = getBacklogCacheEntry(normalizedRoomName);
  nextEntries.push(nextEntry);
  const trimmedEntries =
    limit > 0 ? nextEntries.slice(-limit) : nextEntries;
  writeBacklogEntries(normalizedRoomName, trimmedEntries);
  return true;
}

function listBacklogEntries(roomName, limit = 50, options = {}) {
  const normalizedRoomName = normalizeString(roomName, "").trim();
  if (!normalizedRoomName) {
    return [];
  }

  const sinceMs = Math.max(0, Number(options.sinceMs) || 0);
  const afterCreatedAtMs = Math.max(0, Number(options.afterCreatedAtMs) || 0);
  const entries = getBacklogCacheEntry(normalizedRoomName).filter((entry) => {
    const createdAtMs = Math.max(0, Number(entry && entry.createdAtMs) || 0);
    if (sinceMs > 0 && createdAtMs < sinceMs) {
      return false;
    }
    if (afterCreatedAtMs > 0 && createdAtMs <= afterCreatedAtMs) {
      return false;
    }
    return true;
  });
  return entries.slice(-Math.max(0, Number(limit) || 0));
}

function clearBacklogEntries(roomName) {
  const normalizedRoomName = normalizeString(roomName, "").trim();
  if (!normalizedRoomName) {
    return;
  }
  backlogCache.delete(normalizedRoomName);
  const backlogPath = getBacklogPath(normalizedRoomName);
  if (fs.existsSync(backlogPath)) {
    fs.unlinkSync(backlogPath);
  }
}

function allocatePlayerChannelID() {
  const state = getState();
  const nextValue = Math.max(1000000, Number(state.nextPlayerChannelID) || 1000000);
  state.nextPlayerChannelID = nextValue + 1;
  scheduleStateWrite();
  return nextValue;
}

function allocatePrivateChannelID() {
  const state = getState();
  const nextValue = Math.max(1, Number(state.nextPrivateChannelID) || 1);
  state.nextPrivateChannelID = nextValue + 1;
  scheduleStateWrite();
  return nextValue;
}

function normalizePrivatePairKey(leftCharacterID, rightCharacterID) {
  const members = [
    normalizePositiveInteger(leftCharacterID, 0),
    normalizePositiveInteger(rightCharacterID, 0),
  ].filter((value) => value > 0);
  if (members.length !== 2) {
    return "";
  }
  members.sort((left, right) => left - right);
  return members.join(":");
}

function getPrivateChannelByPair(leftCharacterID, rightCharacterID) {
  const pairKey = normalizePrivatePairKey(leftCharacterID, rightCharacterID);
  if (!pairKey) {
    return null;
  }
  return normalizeString(getState().privateChannelByPair[pairKey], "").trim() || null;
}

function setPrivateChannelByPair(leftCharacterID, rightCharacterID, roomName) {
  const pairKey = normalizePrivatePairKey(leftCharacterID, rightCharacterID);
  const normalizedRoomName = normalizeString(roomName, "").trim();
  if (!pairKey || !normalizedRoomName) {
    return null;
  }

  getState().privateChannelByPair[pairKey] = normalizedRoomName;
  scheduleStateWrite();
  return normalizedRoomName;
}

function recordStaticContractObservation(roomName, observation = {}) {
  const normalizedRoomName = normalizeString(roomName, "").trim();
  if (!normalizedRoomName) {
    return null;
  }

  const discovery = getDiscovery();
  if (!Array.isArray(discovery.observations[normalizedRoomName])) {
    discovery.observations[normalizedRoomName] = [];
  }

  discovery.observations[normalizedRoomName].push({
    observedAtMs: Date.now(),
    ...cloneValue(observation),
  });
  scheduleDiscoveryWrite();
  return cloneValue(discovery.observations[normalizedRoomName]);
}

function getPaths() {
  ensureDataRoot();
  return {
    dataRoot: DATA_ROOT,
    statePath: STATE_PATH,
    backlogDir: BACKLOG_DIR,
    discoveryPath: DISCOVERY_PATH,
  };
}

function reloadFromDisk() {
  if (stateWriteTimer) {
    clearTimeout(stateWriteTimer);
    stateWriteTimer = null;
  }
  if (discoveryWriteTimer) {
    clearTimeout(discoveryWriteTimer);
    discoveryWriteTimer = null;
  }

  stateCache = null;
  discoveryCache = null;
  backlogCache.clear();

  return {
    state: cloneValue(getState()),
    discovery: cloneValue(getDiscovery()),
  };
}

function resetAll(options = {}) {
  if (stateWriteTimer) {
    clearTimeout(stateWriteTimer);
    stateWriteTimer = null;
  }
  if (discoveryWriteTimer) {
    clearTimeout(discoveryWriteTimer);
    discoveryWriteTimer = null;
  }

  if (options.removeFiles === true && fs.existsSync(DATA_ROOT)) {
    fs.rmSync(DATA_ROOT, {
      recursive: true,
      force: true,
    });
  }

  stateCache = buildDefaultState();
  discoveryCache = {
    version: STATE_VERSION,
    observations: {},
  };
  backlogCache.clear();
  ensureDataRoot();

  if (options.flush === true) {
    flushStateNow();
    flushDiscoveryNow();
  }

  return {
    state: cloneValue(stateCache),
    discovery: cloneValue(discoveryCache),
  };
}

module.exports = {
  allocatePlayerChannelID,
  allocatePrivateChannelID,
  appendBacklogEntry,
  clearBacklogEntries,
  deleteChannelRecord,
  flushDiscoveryNow,
  flushStateNow,
  getBacklogPath,
  getChannelRecord,
  getDiscovery,
  getPaths,
  getPrivateChannelByPair,
  getState,
  reloadFromDisk,
  listBacklogEntries,
  listChannelRecords,
  normalizePositiveInteger,
  normalizePrivatePairKey,
  recordStaticContractObservation,
  resolveRoomNameAlias,
  resetAll,
  setChannelRecord,
  setPrivateChannelByPair,
  updateChannelRecord,
};
