const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));

const DUNGEON_RUNTIME_TABLE = "dungeonRuntimeState";
const DUNGEON_RUNTIME_VERSION = 1;
const UNIVERSE_RECONCILE_META_VERSION = 1;

const ACTIVE_LIFECYCLE_STATES = new Set(["seeded", "active", "paused"]);
const TERMINAL_LIFECYCLE_STATES = new Set(["completed", "failed", "despawned"]);
const VALID_LIFECYCLE_STATES = new Set([
  ...ACTIVE_LIFECYCLE_STATES,
  ...TERMINAL_LIFECYCLE_STATES,
]);

let cache = null;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toOptionalInt(value) {
  const numeric = toInt(value, 0);
  return numeric > 0 ? numeric : null;
}

function normalizeText(value, fallback = "") {
  const normalized = String(value == null ? "" : value).trim();
  return normalized || fallback;
}

function normalizeLowerText(value, fallback = "") {
  return normalizeText(value, fallback).toLowerCase();
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeJsonObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return cloneValue(value);
}

function normalizeNumberMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized = {};
  for (const [key, entry] of Object.entries(value)) {
    const numeric = Number(entry);
    if (Number.isFinite(numeric)) {
      normalized[String(key)] = numeric;
    }
  }
  return normalized;
}

function normalizeIDList(value) {
  return [...new Set((Array.isArray(value) ? value : [value])
    .map((entry) => toInt(entry, 0))
    .filter((entry) => entry > 0))].sort((left, right) => left - right);
}

function normalizeStateName(value, fallback) {
  const normalized = normalizeLowerText(value, fallback);
  return normalized || fallback;
}

function normalizeLifecycleState(value) {
  const normalized = normalizeLowerText(value, "seeded");
  return VALID_LIFECYCLE_STATES.has(normalized) ? normalized : "seeded";
}

function isActiveLifecycleState(lifecycleState) {
  return ACTIVE_LIFECYCLE_STATES.has(normalizeLifecycleState(lifecycleState));
}

function normalizePosition(value) {
  if (Array.isArray(value) && value.length >= 3) {
    return {
      x: Number(value[0]) || 0,
      y: Number(value[1]) || 0,
      z: Number(value[2]) || 0,
    };
  }

  if (value && typeof value === "object") {
    return {
      x: Number(value.x) || 0,
      y: Number(value.y) || 0,
      z: Number(value.z) || 0,
    };
  }

  return null;
}

function normalizeOwnership(value = {}) {
  return {
    visibilityScope: normalizeStateName(value.visibilityScope, "public"),
    characterID: toOptionalInt(value.characterID),
    corporationID: toOptionalInt(value.corporationID),
    fleetID: toOptionalInt(value.fleetID),
    missionOwnerCharacterID: toOptionalInt(value.missionOwnerCharacterID),
    sharedWithCharacterIDs: normalizeIDList(value.sharedWithCharacterIDs),
    metadata: normalizeJsonObject(value.metadata),
  };
}

function normalizeTimers(value = {}, lifecycleState = "seeded") {
  const createdAtMs = Math.max(0, toInt(value.createdAtMs, Date.now()));
  const activatedAtMs = Math.max(0, toInt(value.activatedAtMs, createdAtMs));
  const completedAtMs = Math.max(0, toInt(value.completedAtMs, 0));
  const failedAtMs = Math.max(0, toInt(value.failedAtMs, 0));
  const despawnAtMs = Math.max(0, toInt(value.despawnAtMs, 0));
  const expiresAtMs = Math.max(0, toInt(value.expiresAtMs, 0));

  let fallbackUpdatedAtMs = Math.max(createdAtMs, activatedAtMs);
  if (lifecycleState === "completed") {
    fallbackUpdatedAtMs = Math.max(fallbackUpdatedAtMs, completedAtMs);
  }
  if (lifecycleState === "failed") {
    fallbackUpdatedAtMs = Math.max(fallbackUpdatedAtMs, failedAtMs);
  }
  if (lifecycleState === "despawned") {
    fallbackUpdatedAtMs = Math.max(fallbackUpdatedAtMs, despawnAtMs);
  }

  return {
    createdAtMs,
    activatedAtMs,
    completedAtMs,
    failedAtMs,
    despawnAtMs,
    expiresAtMs,
    lastUpdatedAtMs: Math.max(0, toInt(value.lastUpdatedAtMs, fallbackUpdatedAtMs)),
  };
}

function normalizeRoomState(roomKey, value = {}) {
  return {
    roomKey,
    state: normalizeStateName(value.state, "pending"),
    stage: normalizeText(value.stage, "") || null,
    pocketID: toOptionalInt(value.pocketID),
    nodeGraphID: toOptionalInt(value.nodeGraphID),
    activatedAtMs: Math.max(0, toInt(value.activatedAtMs, 0)),
    completedAtMs: Math.max(0, toInt(value.completedAtMs, 0)),
    lastUpdatedAtMs: Math.max(0, toInt(value.lastUpdatedAtMs, 0)),
    spawnedEntityIDs: normalizeIDList(value.spawnedEntityIDs),
    counters: normalizeNumberMap(value.counters),
    metadata: normalizeJsonObject(value.metadata),
  };
}

function normalizeGateState(gateKey, value = {}) {
  return {
    gateKey,
    state: normalizeStateName(value.state, "idle"),
    usesCount: Math.max(0, toInt(value.usesCount, 0)),
    unlockedAtMs: Math.max(0, toInt(value.unlockedAtMs, 0)),
    lastUsedAtMs: Math.max(0, toInt(value.lastUsedAtMs, 0)),
    destinationRoomKey: normalizeText(value.destinationRoomKey, "") || null,
    allowedShipGroupIDs: normalizeIDList(value.allowedShipGroupIDs),
    allowedShipTypeIDs: normalizeIDList(value.allowedShipTypeIDs),
    metadata: normalizeJsonObject(value.metadata),
  };
}

function normalizeObjectiveState(value = {}) {
  return {
    state: normalizeStateName(value.state, "pending"),
    currentNodeID: toOptionalInt(value.currentNodeID),
    currentObjectiveID: toOptionalInt(value.currentObjectiveID),
    currentObjectiveKey: normalizeText(value.currentObjectiveKey, "") || null,
    currentObjectiveTypeID: toOptionalInt(value.currentObjectiveTypeID),
    completedObjectiveIDs: normalizeIDList(value.completedObjectiveIDs),
    completedNodeIDs: normalizeIDList(value.completedNodeIDs),
    counters: normalizeNumberMap(value.counters),
    metadata: normalizeJsonObject(value.metadata),
  };
}

function normalizeInstanceRecord(record = {}) {
  const instanceID = Math.max(0, toInt(record.instanceID, 0));
  const lifecycleState = normalizeLifecycleState(record.lifecycleState);
  const roomStatesByKey = {};
  for (const [roomKey, roomState] of Object.entries(record.roomStatesByKey || {})) {
    const normalizedRoomKey = normalizeText(roomKey, "");
    if (!normalizedRoomKey) {
      continue;
    }
    roomStatesByKey[normalizedRoomKey] = normalizeRoomState(normalizedRoomKey, roomState);
  }

  const gateStatesByKey = {};
  for (const [gateKey, gateState] of Object.entries(record.gateStatesByKey || {})) {
    const normalizedGateKey = normalizeText(gateKey, "");
    if (!normalizedGateKey) {
      continue;
    }
    gateStatesByKey[normalizedGateKey] = normalizeGateState(normalizedGateKey, gateState);
  }

  return {
    instanceID,
    templateID: normalizeText(record.templateID, ""),
    solarSystemID: Math.max(0, toInt(record.solarSystemID, 0)),
    siteKey: normalizeText(record.siteKey, "") || null,
    lifecycleState,
    lifecycleReason: normalizeText(record.lifecycleReason, "") || null,
    instanceScope: normalizeStateName(record.instanceScope, "shared"),
    siteFamily: normalizeLowerText(record.siteFamily, "unknown"),
    siteKind: normalizeLowerText(record.siteKind, "unknown"),
    siteOrigin: normalizeLowerText(record.siteOrigin, "unknown"),
    source: normalizeLowerText(record.source, "unknown"),
    sourceDungeonID: toOptionalInt(record.sourceDungeonID),
    archetypeID: toOptionalInt(record.archetypeID),
    factionID: toOptionalInt(record.factionID),
    difficulty: toOptionalInt(record.difficulty),
    entryObjectTypeID: toOptionalInt(record.entryObjectTypeID),
    dungeonNameID: toOptionalInt(record.dungeonNameID),
    position: normalizePosition(record.position),
    ownership: normalizeOwnership(record.ownership),
    timers: normalizeTimers(record.timers || {}, lifecycleState),
    roomStatesByKey,
    gateStatesByKey,
    objectiveState: normalizeObjectiveState(record.objectiveState),
    hazardState: normalizeJsonObject(record.hazardState),
    environmentState: normalizeJsonObject(record.environmentState),
    spawnState: normalizeJsonObject(record.spawnState),
    runtimeFlags: normalizeJsonObject(record.runtimeFlags),
    metadata: normalizeJsonObject(record.metadata),
  };
}

function normalizeUniverseReconcileMeta(value = {}) {
  const summary =
    value.summary && typeof value.summary === "object" && !Array.isArray(value.summary)
      ? cloneValue(value.summary)
      : {};
  return {
    version: Math.max(1, toInt(value.version, UNIVERSE_RECONCILE_META_VERSION)),
    descriptorKey: normalizeText(value.descriptorKey, ""),
    broadDescriptorKey: normalizeText(value.broadDescriptorKey, ""),
    miningDescriptorKey: normalizeText(value.miningDescriptorKey, ""),
    lastStartedAtMs: Math.max(0, toInt(value.lastStartedAtMs, 0)),
    lastCompletedAtMs: Math.max(0, toInt(value.lastCompletedAtMs, 0)),
    lastScope: normalizeText(value.lastScope, ""),
    lastReason: normalizeText(value.lastReason, ""),
    summary,
  };
}

function normalizeState(table = {}) {
  const instancesByID = {};
  for (const [instanceKey, instanceRecord] of Object.entries(table.instancesByID || {})) {
    const normalized = normalizeInstanceRecord({
      ...instanceRecord,
      instanceID: toInt(
        instanceRecord && instanceRecord.instanceID,
        toInt(instanceKey, 0),
      ),
    });
    if (normalized.instanceID > 0 && normalized.templateID && normalized.solarSystemID > 0) {
      instancesByID[String(normalized.instanceID)] = normalized;
    }
  }

  return {
    version: DUNGEON_RUNTIME_VERSION,
    nextInstanceSequence: Math.max(1, toInt(table.nextInstanceSequence, 1)),
    instancesByID,
    universeReconcileMeta: normalizeUniverseReconcileMeta(table.universeReconcileMeta || {}),
  };
}

function buildInstanceSummary(instance) {
  return {
    instanceID: instance.instanceID,
    templateID: instance.templateID,
    solarSystemID: instance.solarSystemID,
    siteKey: instance.siteKey,
    lifecycleState: instance.lifecycleState,
    lifecycleReason: instance.lifecycleReason,
    instanceScope: instance.instanceScope,
    siteFamily: instance.siteFamily,
    siteKind: instance.siteKind,
    siteOrigin: instance.siteOrigin,
    source: instance.source,
    sourceDungeonID: instance.sourceDungeonID,
    archetypeID: instance.archetypeID,
    factionID: instance.factionID,
    difficulty: instance.difficulty,
    entryObjectTypeID: instance.entryObjectTypeID,
    dungeonNameID: instance.dungeonNameID,
    position: instance.position,
    ownership: cloneValue(instance.ownership),
    timers: cloneValue(instance.timers),
    roomCount: Object.keys(instance.roomStatesByKey || {}).length,
    gateCount: Object.keys(instance.gateStatesByKey || {}).length,
    completedObjectiveCount: Array.isArray(instance.objectiveState && instance.objectiveState.completedObjectiveIDs)
      ? instance.objectiveState.completedObjectiveIDs.length
      : 0,
    runtimeFlags: cloneValue(instance.runtimeFlags),
    metadata: cloneValue(instance.metadata),
  };
}

function appendIndex(map, key, value) {
  if (!key && key !== 0) {
    return;
  }
  const normalizedKey = String(key);
  if (!map.has(normalizedKey)) {
    map.set(normalizedKey, []);
  }
  map.get(normalizedKey).push(value);
}

function buildCache(sourceState = null) {
  const state = sourceState
    ? normalizeState(sourceState)
    : (() => {
      const result = database.read(DUNGEON_RUNTIME_TABLE, "/");
      return normalizeState(result && result.success ? result.data : {});
    })();
  const instancesByID = new Map();
  const summariesByID = new Map();
  const instanceIDsBySystem = new Map();
  const activeInstanceIDsBySystem = new Map();
  const instanceIDsByTemplate = new Map();
  const instanceIDsByFamily = new Map();
  const instanceIDsByLifecycle = new Map();
  const instanceIDBySiteKey = new Map();
  const activeExpiringEntries = [];
  const universePersistentTerminalInstanceIDs = [];
  let nextActiveExpiryAtMs = 0;

  for (const instance of Object.values(state.instancesByID || {})) {
    const summary = buildInstanceSummary(instance);
    instancesByID.set(instance.instanceID, instance);
    summariesByID.set(instance.instanceID, summary);

    appendIndex(instanceIDsBySystem, instance.solarSystemID, instance.instanceID);
    appendIndex(instanceIDsByTemplate, instance.templateID, instance.instanceID);
    appendIndex(instanceIDsByFamily, instance.siteFamily, instance.instanceID);
    appendIndex(instanceIDsByLifecycle, instance.lifecycleState, instance.instanceID);
    if (isActiveLifecycleState(instance.lifecycleState)) {
      appendIndex(activeInstanceIDsBySystem, instance.solarSystemID, instance.instanceID);
      const expiresAtMs = Math.max(0, toInt(instance && instance.timers && instance.timers.expiresAtMs, 0));
      if (expiresAtMs > 0) {
        activeExpiringEntries.push({
          instanceID: instance.instanceID,
          expiresAtMs,
        });
        nextActiveExpiryAtMs = nextActiveExpiryAtMs > 0
          ? Math.min(nextActiveExpiryAtMs, expiresAtMs)
          : expiresAtMs;
      }
    } else if (
      instance &&
      instance.runtimeFlags &&
      instance.runtimeFlags.universePersistent === true &&
      instance.runtimeFlags.universeSeeded === true
    ) {
      universePersistentTerminalInstanceIDs.push(instance.instanceID);
    }
    if (instance.siteKey) {
      const existing = instanceIDBySiteKey.get(instance.siteKey) || null;
      if (
        !existing ||
        !isActiveLifecycleState(summariesByID.get(existing) && summariesByID.get(existing).lifecycleState)
      ) {
        instanceIDBySiteKey.set(instance.siteKey, instance.instanceID);
      }
    }
  }

  for (const indexMap of [
    instanceIDsBySystem,
    activeInstanceIDsBySystem,
    instanceIDsByTemplate,
    instanceIDsByFamily,
    instanceIDsByLifecycle,
  ]) {
    for (const [key, values] of indexMap.entries()) {
      indexMap.set(key, [...new Set(values)].sort((left, right) => left - right));
    }
  }

  activeExpiringEntries.sort((left, right) => (
    left.expiresAtMs - right.expiresAtMs
  ) || (
    left.instanceID - right.instanceID
  ));
  universePersistentTerminalInstanceIDs.sort((left, right) => left - right);

  return {
    state,
    instancesByID,
    summariesByID,
    instanceIDsBySystem,
    activeInstanceIDsBySystem,
    instanceIDsByTemplate,
    instanceIDsByFamily,
    instanceIDsByLifecycle,
    instanceIDBySiteKey,
    activeExpiringEntries,
    nextActiveExpiryAtMs,
    universePersistentTerminalInstanceIDs,
  };
}

function ensureCache() {
  if (!cache) {
    cache = buildCache();
  }
  return cache;
}

function loadState() {
  return ensureCache().state;
}

function writeState(state) {
  const normalized = normalizeState(state);
  const result = database.write(DUNGEON_RUNTIME_TABLE, "/", normalized);
  if (!result || result.success !== true) {
    return false;
  }
  cache = buildCache(normalized);
  return true;
}

function mutateState(mutator) {
  const before = cloneValue(loadState());
  const working = cloneValue(before);
  const next = mutator(working) || working;
  const normalizedBefore = normalizeState(before);
  const normalizedNext = normalizeState(next);
  if (JSON.stringify(normalizedBefore) === JSON.stringify(normalizedNext)) {
    return {
      success: true,
      skippedWrite: true,
      data: cloneValue(loadState()),
    };
  }
  const success = writeState(normalizedNext);
  return {
    success,
    skippedWrite: false,
    data: success ? cloneValue(loadState()) : cloneValue(loadState()),
  };
}

function getStateSnapshot() {
  return cloneValue(loadState());
}

function getUniverseReconcileMeta() {
  return cloneValue(loadState().universeReconcileMeta || normalizeUniverseReconcileMeta());
}

function getInstanceSnapshot(instanceID) {
  const instance = ensureCache().instancesByID.get(Math.max(0, toInt(instanceID, 0)));
  return instance ? cloneValue(instance) : null;
}

function getInstanceSummary(instanceID) {
  const summary = ensureCache().summariesByID.get(Math.max(0, toInt(instanceID, 0)));
  return summary ? cloneValue(summary) : null;
}

function filterSummaryList(instanceIDs, options = {}) {
  const normalizedLifecycleFilter = Array.isArray(options.lifecycleStates)
    ? [...new Set(options.lifecycleStates.map((entry) => normalizeLifecycleState(entry)))]
    : (
      options.lifecycleState
        ? [normalizeLifecycleState(options.lifecycleState)]
        : null
    );

  return (Array.isArray(instanceIDs) ? instanceIDs : [])
    .map((instanceID) => ensureCache().summariesByID.get(instanceID) || null)
    .filter(Boolean)
    .filter((summary) => {
      if (options.activeOnly === true && !isActiveLifecycleState(summary.lifecycleState)) {
        return false;
      }
      if (
        normalizedLifecycleFilter &&
        !normalizedLifecycleFilter.includes(summary.lifecycleState)
      ) {
        return false;
      }
      return true;
    })
    .map((summary) => cloneValue(summary));
}

function listInstanceSummariesBySystem(solarSystemID, options = {}) {
  const normalizedSystemID = Math.max(0, toInt(solarSystemID, 0));
  if (normalizedSystemID <= 0) {
    return [];
  }
  const indexMap = options.activeOnly === true
    ? ensureCache().activeInstanceIDsBySystem
    : ensureCache().instanceIDsBySystem;
  return filterSummaryList(indexMap.get(String(normalizedSystemID)) || [], options);
}

function listInstanceSummariesByTemplate(templateID, options = {}) {
  const normalizedTemplateID = normalizeText(templateID, "");
  if (!normalizedTemplateID) {
    return [];
  }
  return filterSummaryList(
    ensureCache().instanceIDsByTemplate.get(normalizedTemplateID) || [],
    options,
  );
}

function listInstanceSummariesByFamily(siteFamily, options = {}) {
  const normalizedFamily = normalizeLowerText(siteFamily, "");
  if (!normalizedFamily) {
    return [];
  }
  return filterSummaryList(
    ensureCache().instanceIDsByFamily.get(normalizedFamily) || [],
    options,
  );
}

function listInstanceSummariesByLifecycle(lifecycleState, options = {}) {
  const normalizedLifecycleState = normalizeLifecycleState(lifecycleState);
  return filterSummaryList(
    ensureCache().instanceIDsByLifecycle.get(normalizedLifecycleState) || [],
    {
      ...options,
      lifecycleState: normalizedLifecycleState,
    },
  );
}

function getNextActiveExpiryAtMs() {
  return Math.max(0, toInt(ensureCache().nextActiveExpiryAtMs, 0));
}

function listExpiredActiveInstanceSummaries(nowMs) {
  const normalizedNowMs = Math.max(0, toInt(nowMs, Date.now()));
  const cacheState = ensureCache();
  if (
    cacheState.activeExpiringEntries.length <= 0 ||
    getNextActiveExpiryAtMs() <= 0 ||
    getNextActiveExpiryAtMs() > normalizedNowMs
  ) {
    return [];
  }

  const expired = [];
  for (const entry of cacheState.activeExpiringEntries) {
    if (entry.expiresAtMs > normalizedNowMs) {
      break;
    }
    const summary = cacheState.summariesByID.get(entry.instanceID) || null;
    if (summary && isActiveLifecycleState(summary.lifecycleState)) {
      expired.push(cloneValue(summary));
    }
  }
  return expired;
}

function listUniversePersistentTerminalInstanceIDs() {
  return [...ensureCache().universePersistentTerminalInstanceIDs];
}

function findInstanceSummaryBySiteKey(siteKey) {
  const normalizedSiteKey = normalizeText(siteKey, "");
  if (!normalizedSiteKey) {
    return null;
  }
  const instanceID = ensureCache().instanceIDBySiteKey.get(normalizedSiteKey);
  if (!instanceID) {
    return null;
  }
  return getInstanceSummary(instanceID);
}

function clearRuntimeCache() {
  cache = null;
}

function writeUniverseReconcileMeta(meta = {}) {
  const normalizedMeta = normalizeUniverseReconcileMeta(meta);
  const result = mutateState((table) => {
    table.universeReconcileMeta = normalizedMeta;
    return table;
  });
  return result && result.success === true
    ? cloneValue(result.data.universeReconcileMeta || normalizedMeta)
    : getUniverseReconcileMeta();
}

function resetRuntimeStateForTests() {
  writeState({
    version: DUNGEON_RUNTIME_VERSION,
    nextInstanceSequence: 1,
    instancesByID: {},
    universeReconcileMeta: normalizeUniverseReconcileMeta(),
  });
}

module.exports = {
  ACTIVE_LIFECYCLE_STATES,
  DUNGEON_RUNTIME_TABLE,
  DUNGEON_RUNTIME_VERSION,
  TERMINAL_LIFECYCLE_STATES,
  UNIVERSE_RECONCILE_META_VERSION,
  clearRuntimeCache,
  findInstanceSummaryBySiteKey,
  getInstanceSnapshot,
  getInstanceSummary,
  getNextActiveExpiryAtMs,
  getStateSnapshot,
  getUniverseReconcileMeta,
  isActiveLifecycleState,
  listExpiredActiveInstanceSummaries,
  listInstanceSummariesByLifecycle,
  listInstanceSummariesByFamily,
  listInstanceSummariesBySystem,
  listInstanceSummariesByTemplate,
  listUniversePersistentTerminalInstanceIDs,
  loadState,
  mutateState,
  normalizeInstanceRecord,
  normalizeUniverseReconcileMeta,
  resetRuntimeStateForTests,
  writeUniverseReconcileMeta,
  writeState,
};
