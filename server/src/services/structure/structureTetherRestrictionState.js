const path = require("path");

const config = require(path.join(__dirname, "../../config"));
const database = require(path.join(__dirname, "../../newDatabase"));
const structureState = require(path.join(__dirname, "./structureState"));

const STRUCTURE_TETHER_RESTRICTIONS_TABLE = "structureTetherRestrictions";

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = toInt(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function toTimestampMs(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : fallback;
}

function buildDefaultRestrictionState(characterID = 0) {
  return {
    characterID: toPositiveInt(characterID, 0),
    warpScrambled: false,
    cynoActive: false,
    fightersLaunched: false,
    factionalWarfareBlocked: false,
    tetherDelayUntilMs: 0,
    updatedAtMs: 0,
  };
}

function normalizeRestrictionState(value, characterID = 0) {
  const source = value && typeof value === "object" ? value : {};
  return {
    characterID: toPositiveInt(
      source.characterID,
      toPositiveInt(characterID, 0),
    ),
    warpScrambled: source.warpScrambled === true,
    cynoActive: source.cynoActive === true,
    fightersLaunched: source.fightersLaunched === true,
    factionalWarfareBlocked: source.factionalWarfareBlocked === true,
    tetherDelayUntilMs: toTimestampMs(source.tetherDelayUntilMs, 0),
    updatedAtMs: toTimestampMs(source.updatedAtMs, 0),
  };
}

function isRestrictionStateEmpty(state, nowMs = Date.now()) {
  const normalized = normalizeRestrictionState(state);
  return !(
    normalized.warpScrambled === true ||
    normalized.cynoActive === true ||
    normalized.fightersLaunched === true ||
    normalized.factionalWarfareBlocked === true ||
    normalized.tetherDelayUntilMs > toTimestampMs(nowMs, Date.now())
  );
}

function readRestrictionPayload() {
  const result = database.read(STRUCTURE_TETHER_RESTRICTIONS_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {
      _meta: {
        generatedAt: null,
        lastUpdatedAt: null,
      },
      restrictions: {},
    };
  }

  const restrictions =
    result.data.restrictions && typeof result.data.restrictions === "object"
      ? result.data.restrictions
      : {};

  return {
    _meta:
      result.data._meta && typeof result.data._meta === "object"
        ? cloneValue(result.data._meta)
        : {
            generatedAt: null,
            lastUpdatedAt: null,
          },
    restrictions: cloneValue(restrictions),
  };
}

function writeRestrictionPayload(payload) {
  return database.write(STRUCTURE_TETHER_RESTRICTIONS_TABLE, "/", {
    _meta: {
      generatedAt:
        payload &&
        payload._meta &&
        payload._meta.generatedAt
          ? String(payload._meta.generatedAt)
          : null,
      lastUpdatedAt: new Date().toISOString(),
    },
    restrictions:
      payload && payload.restrictions && typeof payload.restrictions === "object"
        ? payload.restrictions
        : {},
  });
}

function getCharacterTetherRestrictionState(characterID, nowMs = Date.now()) {
  const numericCharacterID = toPositiveInt(characterID, 0);
  if (!numericCharacterID) {
    return buildDefaultRestrictionState(0);
  }

  const payload = readRestrictionPayload();
  const rawState = payload.restrictions[String(numericCharacterID)] || null;
  const normalized = normalizeRestrictionState(rawState, numericCharacterID);
  if (
    normalized.tetherDelayUntilMs > 0 &&
    normalized.tetherDelayUntilMs <= toTimestampMs(nowMs, Date.now())
  ) {
    normalized.tetherDelayUntilMs = 0;
  }
  return normalized;
}

function updateCharacterTetherRestrictionState(characterID, updater, options = {}) {
  const numericCharacterID = toPositiveInt(characterID, 0);
  if (!numericCharacterID || typeof updater !== "function") {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  const payload = readRestrictionPayload();
  const current = normalizeRestrictionState(
    payload.restrictions[String(numericCharacterID)] || null,
    numericCharacterID,
  );
  const updatedValue = updater(cloneValue(current));
  const next = normalizeRestrictionState(updatedValue, numericCharacterID);
  next.updatedAtMs = toTimestampMs(options.nowMs, Date.now());
  if (
    next.tetherDelayUntilMs > 0 &&
    next.tetherDelayUntilMs <= next.updatedAtMs
  ) {
    next.tetherDelayUntilMs = 0;
  }

  if (isRestrictionStateEmpty(next, next.updatedAtMs)) {
    delete payload.restrictions[String(numericCharacterID)];
  } else {
    payload.restrictions[String(numericCharacterID)] = next;
  }

  const writeResult = writeRestrictionPayload(payload);
  if (!writeResult.success) {
    return {
      success: false,
      errorMsg: writeResult.errorMsg || "WRITE_ERROR",
    };
  }

  return {
    success: true,
    data: next,
  };
}

function setCharacterTetherRestrictionFlags(characterID, flags = {}, options = {}) {
  return updateCharacterTetherRestrictionState(
    characterID,
    (current) => ({
      ...current,
      ...(Object.prototype.hasOwnProperty.call(flags, "warpScrambled")
        ? { warpScrambled: flags.warpScrambled === true }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(flags, "cynoActive")
        ? { cynoActive: flags.cynoActive === true }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(flags, "fightersLaunched")
        ? { fightersLaunched: flags.fightersLaunched === true }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(flags, "factionalWarfareBlocked")
        ? { factionalWarfareBlocked: flags.factionalWarfareBlocked === true }
        : {}),
    }),
    options,
  );
}

function setCharacterTetherDelay(characterID, delayMs, options = {}) {
  const numericDelayMs = Math.max(0, toTimestampMs(delayMs, 0));
  const now = toTimestampMs(options.nowMs, Date.now());
  return updateCharacterTetherRestrictionState(
    characterID,
    (current) => ({
      ...current,
      tetherDelayUntilMs: numericDelayMs > 0 ? now + numericDelayMs : 0,
    }),
    {
      nowMs: now,
    },
  );
}

function clearCharacterTetherRestrictions(characterID, options = {}) {
  return updateCharacterTetherRestrictionState(
    characterID,
    (current) => ({
      ...current,
      warpScrambled: false,
      cynoActive: false,
      fightersLaunched: false,
      factionalWarfareBlocked: false,
      tetherDelayUntilMs: 0,
    }),
    options,
  );
}

function pruneExpiredCharacterTetherRestrictions(nowMs = Date.now()) {
  const payload = readRestrictionPayload();
  const now = toTimestampMs(nowMs, Date.now());
  let changed = false;

  for (const [characterID, rawState] of Object.entries(payload.restrictions || {})) {
    const normalized = normalizeRestrictionState(rawState, characterID);
    if (
      normalized.tetherDelayUntilMs > 0 &&
      normalized.tetherDelayUntilMs <= now
    ) {
      normalized.tetherDelayUntilMs = 0;
      changed = true;
    }

    if (isRestrictionStateEmpty(normalized, now)) {
      delete payload.restrictions[String(characterID)];
      changed = true;
      continue;
    }

    payload.restrictions[String(characterID)] = normalized;
  }

  if (changed) {
    writeRestrictionPayload(payload);
  }

  return {
    success: true,
    data: {
      changed,
    },
  };
}

function describeCharacterTetherRestrictions(characterID, nowMs = Date.now()) {
  const state = getCharacterTetherRestrictionState(characterID, nowMs);
  const now = toTimestampMs(nowMs, Date.now());
  return {
    ...state,
    tetherDelayRemainingMs: Math.max(0, state.tetherDelayUntilMs - now),
    empty: isRestrictionStateEmpty(state, now),
  };
}

function hasTetherRestrictionBypass(session) {
  return structureState.hasStructureGmBypass(session) || config.upwellGmBypassRestrictions === true;
}

function getCharacterStructureTetherRestriction(characterID, nowMs = Date.now(), options = {}) {
  if (options.session && hasTetherRestrictionBypass(options.session)) {
    return {
      restricted: false,
      reason: null,
      state: describeCharacterTetherRestrictions(characterID, nowMs),
    };
  }

  const state = describeCharacterTetherRestrictions(characterID, nowMs);
  if (state.warpScrambled === true) {
    return { restricted: true, reason: "WARP_SCRAMBLED", state };
  }
  if (state.cynoActive === true) {
    return { restricted: true, reason: "CYNO_ACTIVE", state };
  }
  if (state.fightersLaunched === true) {
    return { restricted: true, reason: "FIGHTERS_LAUNCHED", state };
  }
  if (state.factionalWarfareBlocked === true) {
    return { restricted: true, reason: "FACTIONAL_WARFARE", state };
  }
  if (state.tetherDelayRemainingMs > 0) {
    return { restricted: true, reason: "TETHER_DELAY", state };
  }
  return {
    restricted: false,
    reason: null,
    state,
  };
}

function getCharacterStructureDockingRestriction(characterID, nowMs = Date.now(), options = {}) {
  if (options.session && hasTetherRestrictionBypass(options.session)) {
    return {
      restricted: false,
      reason: null,
      state: describeCharacterTetherRestrictions(characterID, nowMs),
    };
  }

  const state = describeCharacterTetherRestrictions(characterID, nowMs);
  if (state.warpScrambled === true) {
    return { restricted: true, reason: "WARP_SCRAMBLED", state };
  }
  return {
    restricted: false,
    reason: null,
    state,
  };
}

module.exports = {
  STRUCTURE_TETHER_RESTRICTIONS_TABLE,
  getCharacterTetherRestrictionState,
  describeCharacterTetherRestrictions,
  updateCharacterTetherRestrictionState,
  setCharacterTetherRestrictionFlags,
  setCharacterTetherDelay,
  clearCharacterTetherRestrictions,
  pruneExpiredCharacterTetherRestrictions,
  getCharacterStructureTetherRestriction,
  getCharacterStructureDockingRestriction,
};
