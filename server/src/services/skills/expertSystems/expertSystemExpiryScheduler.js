const path = require("path");

const database = require(path.join(__dirname, "../../../newDatabase"));
const { getCharacterSkillMap } = require(path.join(__dirname, "../skillState"));
const {
  CHARACTER_EXPERT_SYSTEMS_TABLE,
  getCharacterExpertSystemEntries,
  removeCharacterExpertSystem,
} = require("./expertSystemState");
const {
  emitExpertSystemsUpdated,
} = require("./expertSystemNotifications");

const schedulerHandles = new Map();
const MAX_TIMER_DELAY_MS = 2_147_483_647;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function readStateTable() {
  const result = database.read(CHARACTER_EXPERT_SYSTEMS_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }
  return result.data;
}

function clearExpertSystemExpiryScheduler(characterID = 0) {
  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID > 0) {
    const existingHandle = schedulerHandles.get(numericCharacterID);
    if (existingHandle) {
      clearTimeout(existingHandle);
      schedulerHandles.delete(numericCharacterID);
    }
    return;
  }

  for (const handle of schedulerHandles.values()) {
    clearTimeout(handle);
  }
  schedulerHandles.clear();
}

function expireDueExpertSystems(characterID, options = {}) {
  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return {
      expired: [],
    };
  }

  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const activeAndExpiredEntries = getCharacterExpertSystemEntries(numericCharacterID, {
    nowMs,
    includeExpired: true,
    pruneExpired: false,
  });
  const dueEntries = activeAndExpiredEntries.filter((entry) => (
    toInt(entry && entry.expiresAtMs, 0) > 0 &&
    toInt(entry && entry.expiresAtMs, 0) <= nowMs
  ));
  if (dueEntries.length === 0) {
    scheduleExpertSystemExpiry(numericCharacterID, { nowMs });
    return {
      expired: [],
    };
  }

  const previousSkillMap = getCharacterSkillMap(numericCharacterID);
  const expiredEntries = [];
  for (const dueEntry of dueEntries) {
    const removeResult = removeCharacterExpertSystem(numericCharacterID, dueEntry.typeID);
    if (removeResult && removeResult.removed) {
      expiredEntries.push(dueEntry);
    }
  }

  if (expiredEntries.length > 0 && options.emitNotifications !== false) {
    emitExpertSystemsUpdated(numericCharacterID, {
      session: options.session || null,
      expertSystemAdded: false,
      expertSystemTypeID: expiredEntries[0].typeID,
      previousSkillMap,
      expired: true,
    });
  }

  scheduleExpertSystemExpiry(numericCharacterID, { nowMs: Date.now() });
  return {
    expired: expiredEntries,
  };
}

function scheduleExpertSystemExpiry(characterID, options = {}) {
  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return false;
  }

  clearExpertSystemExpiryScheduler(numericCharacterID);

  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const activeEntries = getCharacterExpertSystemEntries(numericCharacterID, {
    nowMs,
    pruneExpired: false,
  });
  const nextExpiry = activeEntries
    .map((entry) => toInt(entry && entry.expiresAtMs, 0))
    .filter((expiresAtMs) => expiresAtMs > nowMs)
    .sort((left, right) => left - right)[0];
  if (!nextExpiry) {
    return false;
  }

  const delayMs = Math.max(1, Math.min(nextExpiry - nowMs + 25, MAX_TIMER_DELAY_MS));
  const handle = setTimeout(() => {
    schedulerHandles.delete(numericCharacterID);
    expireDueExpertSystems(numericCharacterID);
  }, delayMs);
  if (typeof handle.unref === "function") {
    handle.unref();
  }
  schedulerHandles.set(numericCharacterID, handle);
  return true;
}

function primeExpertSystemExpirySchedulers() {
  clearExpertSystemExpiryScheduler();
  for (const characterID of Object.keys(readStateTable())) {
    scheduleExpertSystemExpiry(characterID);
  }
}

setImmediate(primeExpertSystemExpirySchedulers);

module.exports = {
  clearExpertSystemExpiryScheduler,
  expireDueExpertSystems,
  primeExpertSystemExpirySchedulers,
  scheduleExpertSystemExpiry,
};
