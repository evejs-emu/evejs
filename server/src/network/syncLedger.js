const path = require("path");
const config = require(path.join(__dirname, "../config"));
const rotatingLog = require(path.join(__dirname, "../utils/rotatingLog"));

const LOG_PATH = path.join(__dirname, "../../logs/sync-ledger.log");
const DEFAULT_MAX_SESSION_EVENTS = 500;
const MAX_DETAIL_DEPTH = 5;
const MAX_ARRAY_ITEMS = 64;
const MAX_STRING_LENGTH = 512;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.trunc(numeric);
  }
  const fallbackNumeric = Number(fallback);
  return Number.isFinite(fallbackNumeric) ? Math.trunc(fallbackNumeric) : 0;
}

function isVerboseDebugEnabled() {
  const numericLevel = Number(config && config.logLevel);
  return Number.isFinite(numericLevel) && numericLevel >= 2;
}

function isLedgerFileEnabled() {
  return (
    process.env.EVEJS_SYNC_LEDGER === "1" ||
    process.env.EVEJS_SYNC_LEDGER_LOG === "1" ||
    Boolean(config && config.syncLedgerLogEnabled) ||
    isVerboseDebugEnabled()
  );
}

function nextSequence(session) {
  if (!session || typeof session !== "object") {
    return 0;
  }
  const current = toInt(session._syncLedgerSeq, 0);
  const next = current + 1;
  session._syncLedgerSeq = next;
  return next;
}

function normalizeDetails(value, depth = 0, seen = new Set()) {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}...`
      : value;
  }
  if (Buffer.isBuffer(value)) {
    return {
      type: "Buffer",
      length: value.length,
    };
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      code: value.code || undefined,
    };
  }
  if (depth >= MAX_DETAIL_DEPTH) {
    return "[MaxDepth]";
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => normalizeDetails(item, depth + 1, seen));
    if (value.length > MAX_ARRAY_ITEMS) {
      items.push(`[+${value.length - MAX_ARRAY_ITEMS} more]`);
    }
    seen.delete(value);
    return items;
  }

  if (value instanceof Set) {
    const items = Array.from(value)
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => normalizeDetails(item, depth + 1, seen));
    seen.delete(value);
    return {
      type: "Set",
      items,
      size: value.size,
    };
  }

  if (value instanceof Map) {
    const entries = Array.from(value.entries())
      .slice(0, MAX_ARRAY_ITEMS)
      .map(([key, item]) => [
        normalizeDetails(key, depth + 1, seen),
        normalizeDetails(item, depth + 1, seen),
      ]);
    seen.delete(value);
    return {
      type: "Map",
      entries,
      size: value.size,
    };
  }

  const output = {};
  for (const key of Object.keys(value).slice(0, MAX_ARRAY_ITEMS)) {
    if (typeof value[key] === "function") {
      continue;
    }
    output[key] = normalizeDetails(value[key], depth + 1, seen);
  }
  seen.delete(value);
  return output;
}

function getSessionSnapshot(session) {
  return {
    clientID: toInt(session && session.clientID, 0) || null,
    characterID: toInt(
      session && (session.characterID || session.charID || session.charid),
      0,
    ) || null,
    shipID: toInt(
      session && session._space && session._space.shipID,
      toInt(session && session.shipID, 0),
    ) || null,
    systemID: toInt(
      session && session._space && session._space.systemID,
      toInt(session && (session.solarsystemid2 || session.solarsystemid), 0),
    ) || null,
    address: session && session.address ? String(session.address) : null,
  };
}

function appendSessionRecord(session, record) {
  if (!session || typeof session !== "object") {
    return;
  }
  if (!Array.isArray(session._syncLedgerEvents)) {
    session._syncLedgerEvents = [];
  }
  session._syncLedgerEvents.push(record);
  const maxEvents = Math.max(
    10,
    toInt(session._syncLedgerMaxEvents, DEFAULT_MAX_SESSION_EVENTS),
  );
  if (session._syncLedgerEvents.length > maxEvents) {
    session._syncLedgerEvents.splice(
      0,
      session._syncLedgerEvents.length - maxEvents,
    );
  }
}

function appendLedgerFile(record) {
  if (!isLedgerFileEnabled()) {
    return;
  }
  try {
    rotatingLog.append(LOG_PATH, `${JSON.stringify(record)}\n`);
  } catch (_) {}
}

function recordSyncLedgerEvent(session, event, details = {}) {
  const record = {
    ts: new Date().toISOString(),
    seq: nextSequence(session),
    event: String(event || "unknown"),
    session: getSessionSnapshot(session),
    details: normalizeDetails(details),
  };
  appendSessionRecord(session, record);
  appendLedgerFile(record);
  return record;
}

function getMarshalDictEntry(value, key) {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  if (Object.prototype.hasOwnProperty.call(value, key)) {
    return value[key];
  }
  const entries = Array.isArray(value.entries) ? value.entries : null;
  if (!entries) {
    return undefined;
  }
  for (const entry of entries) {
    if (Array.isArray(entry) && entry[0] === key) {
      return entry[1];
    }
  }
  return undefined;
}

function normalizeMarshalList(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && value.type === "list" && Array.isArray(value.items)) {
    return value.items;
  }
  return [];
}

function getSlimItemID(slimEntry) {
  const slimItem = Array.isArray(slimEntry) ? slimEntry[0] : slimEntry;
  const itemID = Number(
    slimItem && typeof slimItem === "object" && "itemID" in slimItem
      ? slimItem.itemID
      : getMarshalDictEntry(slimItem, "itemID"),
  );
  return Number.isFinite(itemID) && itemID > 0 ? Math.trunc(itemID) : 0;
}

function extractAddBalls2EntityIDs(args = []) {
  const entityIDs = [];
  for (const batchEntry of Array.isArray(args) ? args : []) {
    const slimEntries = Array.isArray(batchEntry) ? batchEntry[1] : null;
    for (const slimEntry of normalizeMarshalList(slimEntries)) {
      const itemID = getSlimItemID(slimEntry);
      if (itemID > 0) {
        entityIDs.push(itemID);
      }
    }
  }
  return entityIDs;
}

function extractEntityIDsFromPayload(payload) {
  if (!Array.isArray(payload) || typeof payload[0] !== "string") {
    return [];
  }
  const name = payload[0];
  const args = Array.isArray(payload[1]) ? payload[1] : [];
  if (name === "AddBalls2") {
    return extractAddBalls2EntityIDs(args);
  }
  if (name === "RemoveBalls") {
    return normalizeMarshalList(args[0])
      .map((id) => toInt(id, 0))
      .filter((id) => id > 0);
  }
  const firstArgID = toInt(args[0], 0);
  return firstArgID > 0 ? [firstArgID] : [];
}

function summarizeDestinyUpdates(updates = []) {
  const names = [];
  const stamps = [];
  const entityIDs = [];
  const updateSummaries = [];

  for (const update of Array.isArray(updates) ? updates : []) {
    const payload = update && Array.isArray(update.payload)
      ? update.payload
      : Array.isArray(update)
        ? update
        : null;
    const name = payload && typeof payload[0] === "string" ? payload[0] : "unknown";
    const stamp = update && Object.prototype.hasOwnProperty.call(update, "stamp")
      ? toInt(update.stamp, 0) >>> 0
      : null;
    const payloadEntityIDs = extractEntityIDsFromPayload(payload);
    names.push(name);
    if (stamp !== null) {
      stamps.push(stamp);
    }
    for (const entityID of payloadEntityIDs) {
      entityIDs.push(entityID);
    }
    updateSummaries.push({
      name,
      stamp,
      entityIDs: payloadEntityIDs,
    });
  }

  return {
    count: updateSummaries.length,
    names,
    uniqueNames: [...new Set(names)],
    stamps: [...new Set(stamps)],
    entityIDs: [...new Set(entityIDs)],
    updates: updateSummaries,
  };
}

function summarizeDestinyNotificationPayload(payloadTuple = []) {
  const payloadList = Array.isArray(payloadTuple) ? payloadTuple[0] : null;
  const entries = Array.isArray(payloadList && payloadList.items)
    ? payloadList.items
    : [];
  const updates = [];
  for (const entry of entries) {
    const stamp = Array.isArray(entry) ? entry[0] : null;
    const payload = Array.isArray(entry) ? entry[1] : null;
    if (!Array.isArray(payload) || typeof payload[0] !== "string") {
      continue;
    }
    updates.push({
      stamp,
      payload,
    });
  }
  return {
    waitForBubble: Boolean(Array.isArray(payloadTuple) ? payloadTuple[1] : false),
    ...summarizeDestinyUpdates(updates),
  };
}

function summarizeNotificationPayload(notifyType, payloadTuple = []) {
  if (notifyType === "DoDestinyUpdate") {
    return {
      destiny: summarizeDestinyNotificationPayload(payloadTuple),
    };
  }
  return {
    argCount: Array.isArray(payloadTuple) ? payloadTuple.length : 0,
  };
}

function trackSocketLifecycle(session) {
  const socket = session && session.socket;
  if (!session || !socket || socket._evejsSyncLedgerTracked === true) {
    return;
  }
  if (typeof socket.on !== "function") {
    return;
  }
  socket._evejsSyncLedgerTracked = true;
  socket.on("drain", () => {
    recordSyncLedgerEvent(session, "socket.drain", {
      writableLength: toInt(socket.writableLength, 0),
    });
  });
  socket.on("close", (hadError) => {
    recordSyncLedgerEvent(session, "socket.close", {
      hadError: hadError === true,
      writableLength: toInt(socket.writableLength, 0),
    });
  });
  socket.on("error", (error) => {
    recordSyncLedgerEvent(session, "socket.error", {
      error,
      writableLength: toInt(socket.writableLength, 0),
    });
  });
}

module.exports = {
  extractEntityIDsFromPayload,
  normalizeDetails,
  recordSyncLedgerEvent,
  summarizeDestinyNotificationPayload,
  summarizeDestinyUpdates,
  summarizeNotificationPayload,
  trackSocketLifecycle,
};