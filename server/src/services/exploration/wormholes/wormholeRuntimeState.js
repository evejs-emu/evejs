const path = require("path");

const database = require(path.join(__dirname, "../../../newDatabase"));
const targetIdRuntime = require(path.join(
  __dirname,
  "../signatures/targetIdRuntime",
));

const WORMHOLE_RUNTIME_TABLE = "wormholeRuntimeState";
const WORMHOLE_RUNTIME_VERSION = 3;

function normalizeVisibilityState(value, discovered = false) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "visible" || normalized === "hidden" || normalized === "invisible") {
    return normalized;
  }
  return discovered === true ? "visible" : "hidden";
}

let cache = null;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function cloneEndpoint(endpoint = {}) {
  return {
    ...endpoint,
    position: endpoint && endpoint.position && typeof endpoint.position === "object"
      ? { ...endpoint.position }
      : endpoint.position,
    direction: endpoint && endpoint.direction && typeof endpoint.direction === "object"
      ? { ...endpoint.direction }
      : endpoint.direction,
  };
}

function cloneRuntimeState(state = {}) {
  const pairsByID = {};
  for (const [pairKey, pair] of Object.entries(state.pairsByID || {})) {
    pairsByID[pairKey] = {
      ...pair,
      source: cloneEndpoint(pair && pair.source ? pair.source : {}),
      destination: cloneEndpoint(pair && pair.destination ? pair.destination : {}),
    };
  }

  const staticSlotsByKey = {};
  for (const [slotKey, slotState] of Object.entries(state.staticSlotsByKey || {})) {
    staticSlotsByKey[slotKey] = {
      ...slotState,
    };
  }

  const polarizationByCharacter = {};
  for (const [characterKey, endpoints] of Object.entries(state.polarizationByCharacter || {})) {
    const clonedEndpoints = {};
    for (const [endpointKey, record] of Object.entries(endpoints || {})) {
      clonedEndpoints[endpointKey] = {
        ...record,
      };
    }
    polarizationByCharacter[characterKey] = clonedEndpoints;
  }

  return {
    ...state,
    pairsByID,
    staticSlotsByKey,
    polarizationByCharacter,
  };
}

function normalizeEndpoint(endpoint = {}) {
  const discovered = endpoint.discovered === true;
  const visibilityState = normalizeVisibilityState(endpoint.visibilityState, discovered);
  const endpointID = toInt(endpoint.endpointID, 0);
  const systemID = toInt(endpoint.systemID, 0);
  const targetID = String(endpoint.targetID || "").trim().toUpperCase() || (
    endpointID > 0 && systemID > 0
      ? targetIdRuntime.encodeTargetID("wormhole", systemID, endpointID)
      : null
  );
  return {
    endpointID,
    systemID,
    typeID: toInt(endpoint.typeID, 0),
    targetID,
    code: String(endpoint.code || "").trim().toUpperCase() || null,
    discovered: visibilityState === "visible",
    visibilityState,
    wormholeClassID: toInt(endpoint.wormholeClassID, 0),
    nebulaID: toInt(endpoint.nebulaID, 0),
    typeName: String(endpoint.typeName || "").trim() || null,
    position: endpoint.position && typeof endpoint.position === "object"
      ? {
          x: Number(endpoint.position.x) || 0,
          y: Number(endpoint.position.y) || 0,
          z: Number(endpoint.position.z) || 0,
        }
      : { x: 0, y: 0, z: 0 },
    direction: endpoint.direction && typeof endpoint.direction === "object"
      ? {
          x: Number(endpoint.direction.x) || 1,
          y: Number(endpoint.direction.y) || 0,
          z: Number(endpoint.direction.z) || 0,
        }
      : { x: 1, y: 0, z: 0 },
    radius: Number(endpoint.radius) || 3000,
    graphicID: toInt(endpoint.graphicID, 0),
    slotKey: String(endpoint.slotKey || "").trim() || null,
  };
}

function normalizePair(pair = {}) {
  return {
    pairID: toInt(pair.pairID, 0),
    kind: String(pair.kind || "static").trim().toLowerCase() || "static",
    randomProfileKey: String(pair.randomProfileKey || "").trim() || null,
    state: String(pair.state || "active").trim().toLowerCase() || "active",
    createdAtMs: Math.max(0, toInt(pair.createdAtMs, 0)),
    expiresAtMs: Math.max(0, toInt(pair.expiresAtMs, 0)),
    collapseAtMs: Math.max(0, toInt(pair.collapseAtMs, 0)),
    collapseReason: String(pair.collapseReason || "").trim() || null,
    totalMass: Math.max(0, toInt(pair.totalMass, 0)),
    remainingMass: Math.max(0, toInt(pair.remainingMass, 0)),
    massRegeneration: Math.max(0, toInt(pair.massRegeneration, 0)),
    maxJumpMass: Math.max(0, toInt(pair.maxJumpMass, 0)),
    lifetimeMinutes: Math.max(0, toInt(pair.lifetimeMinutes, 0)),
    lastMassStateAtMs: Math.max(
      0,
      toInt(pair.lastMassStateAtMs, pair.createdAtMs),
    ),
    massRegenRemainder: Math.max(0, Number(pair.massRegenRemainder) || 0),
    lastPassiveRevealCheckAtMs: Math.max(0, toInt(pair.lastPassiveRevealCheckAtMs, 0)),
    staticSlotKey: String(pair.staticSlotKey || "").trim() || null,
    source: normalizeEndpoint(pair.source || {}),
    destination: normalizeEndpoint(pair.destination || {}),
  };
}

function normalizeState(table = {}) {
  const nextPairSequence = Math.max(1, toInt(table.nextPairSequence, 1));
  const nextEndpointSequence = Math.max(1, toInt(table.nextEndpointSequence, 1));
  const universeSeededAtMs = Math.max(0, toInt(table.universeSeededAtMs, 0));
  const pairsByID = {};
  for (const [pairKey, pair] of Object.entries(table.pairsByID || {})) {
    const normalized = normalizePair(pair);
    if (normalized.pairID > 0) {
      pairsByID[String(normalized.pairID)] = normalized;
    } else if (toInt(pairKey, 0) > 0) {
      normalized.pairID = toInt(pairKey, 0);
      pairsByID[String(normalized.pairID)] = normalized;
    }
  }

  const staticSlotsByKey = {};
  for (const [slotKey, slotState] of Object.entries(table.staticSlotsByKey || {})) {
    const normalizedKey = String(slotKey || "").trim();
    if (!normalizedKey) {
      continue;
    }
    staticSlotsByKey[normalizedKey] = {
      slotKey: normalizedKey,
      systemID: toInt(slotState.systemID, 0),
      generation: Math.max(0, toInt(slotState.generation, 0)),
      activePairID: Math.max(0, toInt(slotState.activePairID, 0)),
      nextRespawnAtMs: Math.max(0, toInt(slotState.nextRespawnAtMs, 0)),
    };
  }

  const polarizationByCharacter = {};
  for (const [characterKey, endpoints] of Object.entries(table.polarizationByCharacter || {})) {
    const normalizedCharacterID = Math.max(0, toInt(characterKey, 0));
    if (!normalizedCharacterID) {
      continue;
    }
    const normalizedEndpoints = {};
    for (const [endpointKey, polarization] of Object.entries(endpoints || {})) {
      const endpointID = Math.max(0, toInt(endpointKey, 0));
      if (!endpointID) {
        continue;
      }
      const endAtMs = Math.max(0, toInt(polarization && polarization.endAtMs, 0));
      const durationSeconds = Math.max(
        0,
        toInt(polarization && polarization.durationSeconds, 0),
      );
      if (endAtMs > 0 && durationSeconds > 0) {
        normalizedEndpoints[String(endpointID)] = {
          endAtMs,
          durationSeconds,
        };
      }
    }
    polarizationByCharacter[String(normalizedCharacterID)] = normalizedEndpoints;
  }

  return {
    version: WORMHOLE_RUNTIME_VERSION,
    nextPairSequence,
    nextEndpointSequence,
    universeSeededAtMs,
    pairsByID,
    staticSlotsByKey,
    polarizationByCharacter,
  };
}

function loadState() {
  if (cache) {
    return cache;
  }

  const result = database.read(WORMHOLE_RUNTIME_TABLE, "/");
  cache = normalizeState(result && result.success ? result.data : {});
  return cache;
}

function getStateView() {
  return loadState();
}

function writeState(state, options = {}) {
  const normalized = options.normalize === false
    ? state
    : normalizeState(state);
  const result = database.write(WORMHOLE_RUNTIME_TABLE, "/", normalized, {
    force: options.force === true,
  });
  if (!result || result.success !== true) {
    return false;
  }
  cache = normalized;
  return true;
}

function mutateState(mutator) {
  const current = cloneRuntimeState(loadState());
  const next = mutator(current) || current;
  const success = writeState(next, {
    force: true,
    normalize: false,
  });
  return {
    success,
    data: success ? cache : loadState(),
  };
}

function getStateSnapshot() {
  return cloneRuntimeState(loadState());
}

function clearRuntimeCache() {
  cache = null;
}

module.exports = {
  WORMHOLE_RUNTIME_TABLE,
  clearRuntimeCache,
  getStateSnapshot,
  getStateView,
  loadState,
  mutateState,
  writeState,
};
