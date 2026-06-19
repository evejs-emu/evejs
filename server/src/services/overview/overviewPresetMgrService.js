const path = require("path");
const crypto = require("crypto");
const YAML = require("yaml");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const database = require(path.join(__dirname, "../../newDatabase"));
const {
  buildKeyVal,
  normalizeNumber,
  normalizeText,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const TABLE = "overviewSharedPresets";
const ROOT_PATH = "/";
const STATE_META_REPAIRED = Symbol("overviewSharedPresetsStateRepaired");

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildHashValue(payloadString) {
  return crypto.createHash("sha1").update(payloadString).digest("hex");
}

function normalizeOverviewPayload(payload) {
  const unwrapped = unwrapMarshalValue(payload);
  if (!isPlainObject(unwrapped)) {
    return null;
  }

  return unwrapped;
}

function buildPayloadStringFromOverviewPayload(payload) {
  return JSON.stringify(
    Object.keys(payload)
      .sort()
      .map((key) => [key, payload[key]]),
  );
}

function buildDeterministicValueFromYaml(value, activeObjects = new Set()) {
  if (Array.isArray(value)) {
    return value.map((entry) => buildDeterministicValueFromYaml(entry, activeObjects));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  if (activeObjects.has(value)) {
    throw new Error("Circular overview YAML object graph");
  }

  activeObjects.add(value);
  try {
    return Object.keys(value)
      .sort()
      .map((key) => [key, buildDeterministicValueFromYaml(value[key], activeObjects)]);
  } finally {
    activeObjects.delete(value);
  }
}

function repairExportedOverviewYamlPayloadString(payloadString) {
  const normalizedPayloadString = normalizeText(payloadString, "");
  if (!normalizedPayloadString.trim()) {
    return null;
  }

  let parsedPayload = null;
  try {
    parsedPayload = YAML.parse(normalizedPayloadString);
  } catch (error) {
    return null;
  }

  if (!isPlainObject(parsedPayload)) {
    return null;
  }

  try {
    return JSON.stringify(buildDeterministicValueFromYaml(parsedPayload));
  } catch (error) {
    return null;
  }
}

function looksLikeByteMap(value) {
  if (!isPlainObject(value)) {
    return false;
  }

  const keys = Object.keys(value);
  if (keys.length <= 0) {
    return false;
  }

  return keys.every((key) => {
    if (!/^\d+$/.test(key)) {
      return false;
    }
    const byteValue = Number(value[key]);
    return Number.isInteger(byteValue) && byteValue >= 0 && byteValue <= 255;
  });
}

function decodeByteMap(value) {
  const orderedBytes = Object.keys(value)
    .map((key) => [Number(key), Number(value[key])])
    .sort((left, right) => left[0] - right[0])
    .map(([, byteValue]) => byteValue);
  return Buffer.from(orderedBytes).toString("utf8");
}

function repairLegacyMarshalJsonValue(value, depth = 0) {
  if (depth > 12 || value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => repairLegacyMarshalJsonValue(entry, depth + 1));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  if (looksLikeByteMap(value)) {
    return decodeByteMap(value);
  }

  if (value.type === "dict" && Array.isArray(value.entries)) {
    return {
      ...value,
      entries: value.entries.map((entry) => [
        repairLegacyMarshalJsonValue(entry[0], depth + 1),
        repairLegacyMarshalJsonValue(entry[1], depth + 1),
      ]),
    };
  }

  if (
    (value.type === "list" || value.type === "tuple" || value.type === "set") &&
    Array.isArray(value.items)
  ) {
    return {
      ...value,
      items: value.items.map((entry) => repairLegacyMarshalJsonValue(entry, depth + 1)),
    };
  }

  if (Object.prototype.hasOwnProperty.call(value, "value")) {
    return {
      ...value,
      value: repairLegacyMarshalJsonValue(value.value, depth + 1),
    };
  }

  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      repairLegacyMarshalJsonValue(entryValue, depth + 1),
    ]),
  );
}

function repairLegacyPayloadString(payloadString) {
  const normalizedPayloadString = normalizeText(payloadString, "");
  if (!normalizedPayloadString.trim()) {
    return null;
  }

  let parsedPayload = null;
  try {
    parsedPayload = JSON.parse(normalizedPayloadString);
  } catch (error) {
    return null;
  }

  if (!Array.isArray(parsedPayload)) {
    return null;
  }

  const parsedObject = Object.fromEntries(
    parsedPayload.filter((entry) => Array.isArray(entry) && entry.length >= 2),
  );
  if (parsedObject.type !== "dict" || !Array.isArray(parsedObject.entries)) {
    return null;
  }

  const repairedPayload = normalizeOverviewPayload({
    type: "dict",
    entries: repairLegacyMarshalJsonValue(parsedObject.entries),
  });
  if (!repairedPayload) {
    return null;
  }

  const repairedPayloadString = buildPayloadStringFromOverviewPayload(
    repairedPayload,
  );
  return repairedPayloadString !== normalizedPayloadString
    ? repairedPayloadString
    : null;
}

function repairStoredPayloadString(payloadString) {
  const normalizedPayloadString = normalizeText(payloadString, "");
  if (!normalizedPayloadString.trim()) {
    return null;
  }

  return (
    repairLegacyPayloadString(normalizedPayloadString) ||
    repairExportedOverviewYamlPayloadString(normalizedPayloadString)
  );
}

function rebuildHashIndex(entries) {
  const hashIndex = {};
  for (const entry of Object.values(entries || {})) {
    if (!entry || !entry.hashvalue || !entry.sqID) {
      continue;
    }
    if (!Array.isArray(hashIndex[entry.hashvalue])) {
      hashIndex[entry.hashvalue] = [];
    }
    hashIndex[entry.hashvalue].push(entry.sqID);
  }
  for (const hashvalue of Object.keys(hashIndex)) {
    hashIndex[hashvalue].sort((left, right) => left - right);
  }
  return hashIndex;
}

function ensureStateShape(state) {
  const nextState =
    state && typeof state === "object"
      ? state
      : {};

  let stateTouched = false;
  const rawNextSqID = nextState.nextSqID;
  const normalizedNextSqID = Math.max(1, normalizeNumber(rawNextSqID, 1));

  nextState.nextSqID = normalizedNextSqID;
  if (normalizedNextSqID !== rawNextSqID) {
    stateTouched = true;
  }

  if (!isPlainObject(nextState.entries)) {
    nextState.entries = {};
    stateTouched = true;
  }
  if (!isPlainObject(nextState.hashIndex)) {
    nextState.hashIndex = rebuildHashIndex(nextState.entries);
    stateTouched = true;
  }

  let requiresRebuild = false;
  for (const [hashvalue, sqIDs] of Object.entries(nextState.hashIndex)) {
    if (!Array.isArray(sqIDs) || sqIDs.some((sqID) => !Number.isFinite(Number(sqID)))) {
      requiresRebuild = true;
      break;
    }
    nextState.hashIndex[hashvalue] = sqIDs
      .map((sqID) => Math.max(0, normalizeNumber(sqID, 0)))
      .filter((sqID) => sqID > 0)
      .sort((left, right) => left - right);
  }

  if (requiresRebuild) {
    nextState.hashIndex = rebuildHashIndex(nextState.entries);
    stateTouched = true;
  }

  const repairedEntries = {};
  let repairedEntryCount = 0;
  let highestSqID = 0;
  for (const rawEntry of Object.values(nextState.entries || {})) {
    if (!rawEntry || typeof rawEntry !== "object") {
      continue;
    }

    const sqID = Math.max(0, normalizeNumber(rawEntry.sqID, 0));
    if (sqID <= 0) {
      continue;
    }
    highestSqID = Math.max(highestSqID, sqID);

    const originalPayloadString = normalizeText(rawEntry.payload, "");
    const repairedPayloadString =
      repairStoredPayloadString(originalPayloadString) || originalPayloadString;
    const repairedHashvalue =
      normalizeText(rawEntry.hashvalue, "") || buildHashValue(repairedPayloadString);
    if (repairedPayloadString !== originalPayloadString) {
      repairedEntryCount += 1;
    }

    repairedEntries[buildEntryKey(repairedHashvalue, sqID)] = {
      ...rawEntry,
      hashvalue: repairedHashvalue,
      sqID,
      payload: repairedPayloadString,
    };
  }

  if (repairedEntryCount > 0) {
    nextState.entries = repairedEntries;
    nextState.hashIndex = rebuildHashIndex(repairedEntries);
    stateTouched = true;
  }
  const nextSqID = Math.max(nextState.nextSqID, highestSqID + 1);
  if (nextSqID !== nextState.nextSqID) {
    stateTouched = true;
  }
  nextState.nextSqID = nextSqID;
  nextState[STATE_META_REPAIRED] = stateTouched;

  return nextState;
}

function buildInitialState() {
  return {
    nextSqID: 1,
    entries: {},
    hashIndex: {},
  };
}

function parsePresetKey(rawValue) {
  if (Array.isArray(rawValue) && rawValue.length >= 2) {
    return {
      hashvalue: normalizeText(rawValue[0], "").trim(),
      sqID: Math.max(0, normalizeNumber(rawValue[1], 0)),
    };
  }

  if (isPlainObject(rawValue)) {
    return {
      hashvalue: normalizeText(rawValue.hashvalue, "").trim(),
      sqID: Math.max(0, normalizeNumber(rawValue.sqID, 0)),
    };
  }

  return {
    hashvalue: "",
    sqID: 0,
  };
}

function buildEntryKey(hashvalue, sqID) {
  return `${hashvalue}::${sqID}`;
}

class OverviewPresetMgrService extends BaseService {
  constructor() {
    super("overviewPresetMgr");
    this._state = null;
  }

  _getState() {
    if (this._state) {
      return this._state;
    }

    const existing = database.read(TABLE, ROOT_PATH);
    if (existing.success && existing.data && typeof existing.data === "object") {
      this._state = ensureStateShape(existing.data);
      const stateNeedsPersist = Boolean(this._state[STATE_META_REPAIRED]);
      delete this._state[STATE_META_REPAIRED];
      if (stateNeedsPersist) {
        database.write(TABLE, ROOT_PATH, this._state);
      }
      return this._state;
    }

    this._state = buildInitialState();
    database.write(TABLE, ROOT_PATH, this._state);
    return this._state;
  }

  _persistState() {
    database.write(TABLE, ROOT_PATH, this._state);
    return this._state;
  }

  _buildPresetKeyVal(hashvalue, sqID) {
    return buildKeyVal([
      ["hashvalue", hashvalue],
      ["sqID", sqID],
    ]);
  }

  _findExistingEntry(hashvalue, payloadString) {
    const state = this._getState();
    const sqIDs = Array.isArray(state.hashIndex[hashvalue])
      ? state.hashIndex[hashvalue]
      : [];

    for (const sqID of sqIDs) {
      const entry = state.entries[buildEntryKey(hashvalue, sqID)];
      if (entry && entry.payload === payloadString) {
        return entry;
      }
    }

    return null;
  }

  _findExistingEntryByPayloadString(payloadString) {
    const state = this._getState();
    for (const entry of Object.values(state.entries || {})) {
      if (entry && entry.payload === payloadString) {
        return entry;
      }
    }

    return null;
  }

  _storePayloadString(payloadString, options = {}) {
    const normalizedPayloadString = normalizeText(payloadString, "");
    if (!normalizedPayloadString.trim()) {
      return null;
    }

    const hashvalue = buildHashValue(normalizedPayloadString);
    const state = this._getState();
    const entries = state.entries;

    const existingEntry =
      this._findExistingEntry(hashvalue, normalizedPayloadString) ||
      this._findExistingEntryByPayloadString(normalizedPayloadString);
    if (existingEntry) {
      const nextSource = normalizeText(options.source, existingEntry.source);
      const nextLabel = normalizeText(options.label, existingEntry.label);
      const nextSourcePath = normalizeText(
        options.sourcePath,
        existingEntry.sourcePath,
      );
      if (
        nextSource !== existingEntry.source ||
        nextLabel !== existingEntry.label ||
        nextSourcePath !== existingEntry.sourcePath
      ) {
        existingEntry.source = nextSource;
        existingEntry.label = nextLabel;
        existingEntry.sourcePath = nextSourcePath;
        this._persistState();
      }
      return existingEntry;
    }

    const sqID = state.nextSqID;
    state.nextSqID += 1;

    const entry = {
      hashvalue,
      sqID,
      payload: normalizedPayloadString,
      ownerID: Math.max(0, normalizeNumber(options.ownerID, 0)),
      createdAt: Date.now(),
      source: normalizeText(options.source, ""),
      label: normalizeText(options.label, ""),
      sourcePath: normalizeText(options.sourcePath, ""),
    };
    entries[buildEntryKey(hashvalue, sqID)] = entry;

    if (!Array.isArray(state.hashIndex[hashvalue])) {
      state.hashIndex[hashvalue] = [];
    }
    state.hashIndex[hashvalue].push(sqID);
    this._persistState();

    log.info(
      `[OverviewPresetMgr] Stored shared overview profile hash=${hashvalue} sqID=${sqID}${entry.source ? ` source=${entry.source}` : ""}`,
    );

    return entry;
  }

  storeOverviewPayload(payload, options = {}) {
    const normalizedPayload = normalizeOverviewPayload(payload);
    if (!normalizedPayload) {
      return null;
    }

    const payloadString = buildPayloadStringFromOverviewPayload(normalizedPayload);
    return this._storePayloadString(payloadString, options);
  }

  storeRawPresetString(payloadString, options = {}) {
    return this._storePayloadString(
      repairExportedOverviewYamlPayloadString(payloadString) || payloadString,
      options,
    );
  }

  Handle_StoreLinkAndGetID(args = [], session) {
    const payload = args[0];
    const storedEntry = this.storeOverviewPayload(payload, {
      ownerID: session && (session.characterID || session.userid || 0),
      source: "client_drag",
    });
    if (!storedEntry) {
      log.warn("[OverviewPresetMgr] StoreLinkAndGetID received invalid payload");
      return null;
    }

    return this._buildPresetKeyVal(storedEntry.hashvalue, storedEntry.sqID);
  }

  Handle_GetStoredPreset(args = []) {
    const state = this._getState();
    const { hashvalue, sqID } = parsePresetKey(args[0]);
    if (!hashvalue || !sqID) {
      return null;
    }

    const entry = state.entries && state.entries[buildEntryKey(hashvalue, sqID)];
    if (!entry || entry.hashvalue !== hashvalue) {
      return null;
    }

    return entry.payload || null;
  }
}

module.exports = OverviewPresetMgrService;
