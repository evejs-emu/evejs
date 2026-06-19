const path = require("path");

const database = require(path.join(__dirname, "../../../newDatabase"));
const explorationAuthority = require(path.join(
  __dirname,
  "../explorationAuthority",
));

const PROBE_RUNTIME_TABLE = "probeRuntimeState";
const PROBE_RUNTIME_VERSION = 2;
const MAX_ACTIVE_PROBES =
  Math.max(1, Number(explorationAuthority.getScanContracts().maxProbes) || 8);
const MAX_PROBE_DIST_FROM_SUN_SQUARED =
  Math.max(
    1,
    Number(explorationAuthority.getScanContracts().maxProbeDistanceFromSunSquared) ||
      ((149_597_870_700 * 250) ** 2),
  );
const PROBE_ID_BASE = 990000000000;
const DEFAULT_LAUNCH_RING_RADIUS_METERS = 10_000;

let cache = null;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function toFileTimeFromMs(value) {
  return (BigInt(Math.max(0, toInt(value, Date.now()))) * 10000n) + 116444736000000000n;
}

function clampVectorToProbeBounds(vector = [0, 0, 0]) {
  const normalized = [
    toFiniteNumber(vector[0], 0),
    toFiniteNumber(vector[1], 0),
    toFiniteNumber(vector[2], 0),
  ];
  const distanceSquared =
    (normalized[0] ** 2) +
    (normalized[1] ** 2) +
    (normalized[2] ** 2);
  if (
    !Number.isFinite(distanceSquared) ||
    distanceSquared <= 0 ||
    distanceSquared <= MAX_PROBE_DIST_FROM_SUN_SQUARED
  ) {
    return normalized;
  }

  const scale = Math.sqrt(MAX_PROBE_DIST_FROM_SUN_SQUARED / distanceSquared);
  return normalized.map((component) => component * scale);
}

function normalizeVector(value = null) {
  if (Array.isArray(value)) {
    return clampVectorToProbeBounds(value);
  }

  if (value && typeof value === "object") {
    return clampVectorToProbeBounds([
      toFiniteNumber(value.x, 0),
      toFiniteNumber(value.y, 0),
      toFiniteNumber(value.z, 0),
    ]);
  }

  return [0, 0, 0];
}

function resolveProbeRangeContract(typeID, rangeStep, scanRange) {
  const probeDefinition = explorationAuthority.getProbeDefinition(typeID);
  const rangeSteps = Array.isArray(probeDefinition && probeDefinition.rangeSteps)
    ? probeDefinition.rangeSteps
        .map((value) => Math.max(0, toFiniteNumber(value, 0)))
        .filter((value) => value > 0)
    : [];
  if (rangeSteps.length <= 0) {
    return {
      rangeStep: Math.max(1, toInt(rangeStep, 1)),
      scanRange: Math.max(0, toFiniteNumber(scanRange, 0)),
    };
  }

  const requestedRangeStep = toInt(rangeStep, 0);
  if (requestedRangeStep > 0) {
    const clampedRangeStep = Math.max(1, Math.min(rangeSteps.length, requestedRangeStep));
    return {
      rangeStep: clampedRangeStep,
      scanRange: rangeSteps[clampedRangeStep - 1],
    };
  }

  const requestedScanRange = Math.max(0, toFiniteNumber(scanRange, 0));
  if (requestedScanRange > 0) {
    const nearestIndex = rangeSteps.reduce((bestIndex, candidateRange, index) => {
      if (bestIndex < 0) {
        return index;
      }
      const bestDistance = Math.abs(rangeSteps[bestIndex] - requestedScanRange);
      const candidateDistance = Math.abs(candidateRange - requestedScanRange);
      return candidateDistance < bestDistance ? index : bestIndex;
    }, -1);
    const resolvedIndex = nearestIndex >= 0 ? nearestIndex : 0;
    return {
      rangeStep: resolvedIndex + 1,
      scanRange: rangeSteps[resolvedIndex],
    };
  }

  return {
    rangeStep: rangeSteps.length,
    scanRange: rangeSteps[rangeSteps.length - 1],
  };
}

function normalizeProbeRecord(record = {}) {
  const probeID = Math.max(0, toInt(record.probeID, 0));
  const typeID = Math.max(0, toInt(record.typeID, 0));
  const pos = normalizeVector(record.pos);
  const destination = normalizeVector(record.destination || record.pos);
  const resolvedRange = resolveProbeRangeContract(
    typeID,
    record.rangeStep,
    record.scanRange,
  );
  return {
    probeID,
    systemID: Math.max(0, toInt(record.systemID, 0)),
    typeID,
    launchShipID: Math.max(0, toInt(record.launchShipID, 0)),
    launcherItemID: Math.max(0, toInt(record.launcherItemID, 0)),
    launcherFlagID: Math.max(0, toInt(record.launcherFlagID, 0)),
    pos,
    destination,
    scanRange: resolvedRange.scanRange,
    rangeStep: resolvedRange.rangeStep,
    state: Math.max(0, toInt(record.state, 1)),
    expiry: String(record.expiry || "0"),
    lastSeenAtMs: Math.max(0, toInt(record.lastSeenAtMs, 0)),
  };
}

function isValidPersistedProbeRecord(record = {}) {
  return (
    Math.max(0, toInt(record.probeID, 0)) > 0 &&
    Math.max(0, toInt(record.systemID, 0)) > 0 &&
    Math.max(0, toInt(record.typeID, 0)) > 0 &&
    Math.max(0, toInt(record.launchShipID, 0)) > 0 &&
    Math.max(0, toInt(record.launcherItemID, 0)) > 0 &&
    Math.max(0, toInt(record.launcherFlagID, 0)) > 0
  );
}

function isProbeExpired(record = {}, nowFileTime = toFileTimeFromMs(Date.now())) {
  try {
    return BigInt(String(record && record.expiry ? record.expiry : "0")) <= nowFileTime;
  } catch (error) {
    return true;
  }
}

function normalizeCharacterState(record = {}) {
  const characterID = Math.max(0, toInt(record.characterID, 0));
  const probesByID = {};
  for (const [probeKey, probeRecord] of Object.entries(record.probesByID || {})) {
    const normalized = normalizeProbeRecord({
      ...probeRecord,
      probeID: toInt(probeRecord && probeRecord.probeID, toInt(probeKey, 0)),
    });
    if (normalized.probeID > 0) {
      probesByID[String(normalized.probeID)] = normalized;
    }
  }

  return {
    characterID,
    lastUpdatedAtMs: Math.max(0, toInt(record.lastUpdatedAtMs, 0)),
    probesByID,
  };
}

function normalizeState(table = {}) {
  const charactersByID = {};
  for (const [characterKey, characterState] of Object.entries(table.charactersByID || {})) {
    const normalized = normalizeCharacterState({
      ...characterState,
      characterID: toInt(characterState && characterState.characterID, toInt(characterKey, 0)),
    });
    if (normalized.characterID > 0) {
      charactersByID[String(normalized.characterID)] = normalized;
    }
  }

  return {
    version: PROBE_RUNTIME_VERSION,
    nextProbeSequence: Math.max(1, toInt(table.nextProbeSequence, 1)),
    charactersByID,
  };
}

function pruneState(table = {}, options = {}) {
  const normalized = normalizeState(table);
  const nowFileTime = toFileTimeFromMs(options.nowMs);
  let changed = false;

  for (const characterState of Object.values(normalized.charactersByID || {})) {
    for (const [probeKey, probeRecord] of Object.entries(characterState.probesByID || {})) {
      if (
        !isValidPersistedProbeRecord(probeRecord) ||
        isProbeExpired(probeRecord, nowFileTime)
      ) {
        delete characterState.probesByID[String(probeKey)];
        changed = true;
      }
    }
  }

  return {
    changed,
    state: normalized,
  };
}

function loadState() {
  if (cache) {
    return cache;
  }

  const result = database.read(PROBE_RUNTIME_TABLE, "/");
  const pruned = pruneState(result && result.success ? result.data : {}, {
    nowMs: Date.now(),
  });
  cache = pruned.state;
  if (pruned.changed) {
    database.write(PROBE_RUNTIME_TABLE, "/", cache);
  }
  return cache;
}

function writeState(state) {
  const normalized = normalizeState(state);
  const result = database.write(PROBE_RUNTIME_TABLE, "/", normalized);
  if (!result || result.success !== true) {
    return false;
  }
  cache = normalized;
  return true;
}

function mutateState(mutator) {
  const current = cloneValue(loadState());
  const next = mutator(current) || current;
  const success = writeState(next);
  return {
    success,
    data: success ? cache : loadState(),
  };
}

function ensureCharacterState(table, characterID) {
  const numericCharacterID = Math.max(0, toInt(characterID, 0));
  if (numericCharacterID <= 0) {
    return null;
  }

  const key = String(numericCharacterID);
  if (!table.charactersByID[key]) {
    table.charactersByID[key] = {
      characterID: numericCharacterID,
      lastUpdatedAtMs: 0,
      probesByID: {},
    };
  }
  return table.charactersByID[key];
}

function getCharacterStateSnapshot(characterID) {
  const numericCharacterID = Math.max(0, toInt(characterID, 0));
  if (numericCharacterID <= 0) {
    return null;
  }
  const snapshot = loadState().charactersByID[String(numericCharacterID)] || null;
  return snapshot ? cloneValue(snapshot) : null;
}

function getCharacterSystemProbes(characterID, systemID) {
  const numericSystemID = Math.max(0, toInt(systemID, 0));
  const characterState = getCharacterStateSnapshot(characterID);
  if (!characterState || numericSystemID <= 0) {
    return [];
  }

  return Object.values(characterState.probesByID || {})
    .filter((probe) => Math.max(0, toInt(probe.systemID, 0)) === numericSystemID)
    .sort((left, right) => toInt(left.probeID, 0) - toInt(right.probeID, 0));
}

function removeInvalidCharacterProbes(characterID, options = {}) {
  const numericCharacterID = Math.max(0, toInt(characterID, 0));
  const numericSystemID = Math.max(0, toInt(options.systemID, 0));
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  if (numericCharacterID <= 0) {
    return [];
  }

  const removed = [];
  mutateState((table) => {
    const characterState = ensureCharacterState(table, numericCharacterID);
    if (!characterState) {
      return table;
    }

    characterState.lastUpdatedAtMs = nowMs;
    for (const [probeKey, probeRecord] of Object.entries(characterState.probesByID || {})) {
      const normalized = normalizeProbeRecord(probeRecord);
      if (
        numericSystemID > 0 &&
        Math.max(0, toInt(normalized.systemID, 0)) !== numericSystemID
      ) {
        continue;
      }
      if (isValidPersistedProbeRecord(normalized)) {
        continue;
      }
      removed.push(cloneValue(normalized));
      delete characterState.probesByID[String(probeKey)];
    }
    return table;
  });

  return removed.sort((left, right) => toInt(left.probeID, 0) - toInt(right.probeID, 0));
}

function removeExpiredCharacterProbes(characterID, options = {}) {
  const numericCharacterID = Math.max(0, toInt(characterID, 0));
  const numericSystemID = Math.max(0, toInt(options.systemID, 0));
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  if (numericCharacterID <= 0) {
    return [];
  }

  const nowFileTime = toFileTimeFromMs(nowMs);
  const removed = [];
  mutateState((table) => {
    const characterState = ensureCharacterState(table, numericCharacterID);
    if (!characterState) {
      return table;
    }

    characterState.lastUpdatedAtMs = nowMs;
    for (const [probeKey, probeRecord] of Object.entries(characterState.probesByID || {})) {
      const normalized = normalizeProbeRecord(probeRecord);
      if (
        numericSystemID > 0 &&
        Math.max(0, toInt(normalized.systemID, 0)) !== numericSystemID
      ) {
        continue;
      }
      if (!isProbeExpired(normalized, nowFileTime)) {
        continue;
      }
      removed.push(cloneValue(normalized));
      delete characterState.probesByID[String(probeKey)];
    }
    return table;
  });

  return removed.sort((left, right) => toInt(left.probeID, 0) - toInt(right.probeID, 0));
}

function upsertCharacterProbes(characterID, systemID, probeMap, options = {}) {
  const numericCharacterID = Math.max(0, toInt(characterID, 0));
  const numericSystemID = Math.max(0, toInt(systemID, 0));
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  if (numericCharacterID <= 0 || numericSystemID <= 0 || !(probeMap instanceof Map)) {
    return [];
  }

  const result = mutateState((table) => {
    const characterState = ensureCharacterState(table, numericCharacterID);
    if (!characterState) {
      return table;
    }

    characterState.lastUpdatedAtMs = nowMs;
    for (const probe of probeMap.values()) {
      const existing = characterState.probesByID[String(probe.probeID)] || null;
      characterState.probesByID[String(probe.probeID)] = normalizeProbeRecord({
        ...existing,
        ...probe,
        systemID: numericSystemID,
        lastSeenAtMs: nowMs,
      });
    }
    return table;
  });

  if (!result.success) {
    return [];
  }
  return getCharacterSystemProbes(numericCharacterID, numericSystemID);
}

function synchronizeCharacterProbeGeometry(characterID, systemID, probeMap, options = {}) {
  const numericCharacterID = Math.max(0, toInt(characterID, 0));
  const numericSystemID = Math.max(0, toInt(systemID, 0));
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  if (numericCharacterID <= 0 || numericSystemID <= 0 || !(probeMap instanceof Map)) {
    return [];
  }

  const updated = [];
  mutateState((table) => {
    const characterState = ensureCharacterState(table, numericCharacterID);
    if (!characterState) {
      return table;
    }

    characterState.lastUpdatedAtMs = nowMs;
    for (const [probeID, probePatch] of probeMap.entries()) {
      const key = String(Math.max(0, toInt(probeID, 0)));
      if (!key || !characterState.probesByID[key]) {
        continue;
      }

      const existing = normalizeProbeRecord(characterState.probesByID[key]);
      if (Math.max(0, toInt(existing.systemID, 0)) !== numericSystemID) {
        continue;
      }

      const nextRecord = normalizeProbeRecord({
        ...existing,
        typeID: Math.max(0, toInt(probePatch && probePatch.typeID, existing.typeID)),
        pos: probePatch && probePatch.pos ? probePatch.pos : existing.pos,
        destination:
          probePatch && probePatch.destination
            ? probePatch.destination
            : (
              probePatch && probePatch.pos
                ? probePatch.pos
                : existing.destination
            ),
        scanRange:
          probePatch && Number.isFinite(Number(probePatch.scanRange))
            ? probePatch.scanRange
            : existing.scanRange,
        rangeStep:
          probePatch && Number.isFinite(Number(probePatch.rangeStep))
            ? probePatch.rangeStep
            : existing.rangeStep,
        state:
          probePatch && Number.isFinite(Number(probePatch.state))
            ? probePatch.state
            : existing.state,
        lastSeenAtMs: nowMs,
      });
      characterState.probesByID[key] = nextRecord;
      updated.push(cloneValue(nextRecord));
    }
    return table;
  });

  return updated.sort((left, right) => toInt(left.probeID, 0) - toInt(right.probeID, 0));
}

function setCharacterProbeActivity(characterID, probeIDs, active, options = {}) {
  const numericCharacterID = Math.max(0, toInt(characterID, 0));
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const normalizedProbeIDs = [...new Set((Array.isArray(probeIDs) ? probeIDs : [probeIDs])
    .map((probeID) => Math.max(0, toInt(probeID, 0)))
    .filter((probeID) => probeID > 0))];
  if (numericCharacterID <= 0 || normalizedProbeIDs.length <= 0) {
    return [];
  }

  const nextState = active === true ? 1 : 0;
  const updatedProbeIDs = [];
  mutateState((table) => {
    const characterState = ensureCharacterState(table, numericCharacterID);
    if (!characterState) {
      return table;
    }
    characterState.lastUpdatedAtMs = nowMs;
    for (const probeID of normalizedProbeIDs) {
      const key = String(probeID);
      if (!characterState.probesByID[key]) {
        continue;
      }
      characterState.probesByID[key].state = nextState;
      characterState.probesByID[key].lastSeenAtMs = nowMs;
      updatedProbeIDs.push(probeID);
    }
    return table;
  });
  return updatedProbeIDs;
}

function removeCharacterProbes(characterID, probeIDs, options = {}) {
  const numericCharacterID = Math.max(0, toInt(characterID, 0));
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const normalizedProbeIDs = [...new Set((Array.isArray(probeIDs) ? probeIDs : [probeIDs])
    .map((probeID) => Math.max(0, toInt(probeID, 0)))
    .filter((probeID) => probeID > 0))];
  if (numericCharacterID <= 0 || normalizedProbeIDs.length <= 0) {
    return [];
  }

  const removed = [];
  mutateState((table) => {
    const characterState = ensureCharacterState(table, numericCharacterID);
    if (!characterState) {
      return table;
    }
    characterState.lastUpdatedAtMs = nowMs;
    for (const probeID of normalizedProbeIDs) {
      const key = String(probeID);
      if (!characterState.probesByID[key]) {
        continue;
      }
      removed.push(cloneValue(characterState.probesByID[key]));
      delete characterState.probesByID[key];
    }
    return table;
  });
  return removed.sort((left, right) => toInt(left.probeID, 0) - toInt(right.probeID, 0));
}

function getReconnectableCharacterProbes(characterID, systemID) {
  const nowFileTime = toFileTimeFromMs(Date.now());
  return getCharacterSystemProbes(characterID, systemID)
    .filter((probe) => isValidPersistedProbeRecord(probe))
    .filter((probe) => Math.max(0, toInt(probe.state, 0)) > 0)
    .filter((probe) => !isProbeExpired(probe, nowFileTime));
}

function buildLaunchOffset(index, totalCount, radiusMeters = DEFAULT_LAUNCH_RING_RADIUS_METERS) {
  const normalizedCount = Math.max(1, toInt(totalCount, 1));
  const angle = (Math.PI * 2 * Math.max(0, toInt(index, 0))) / normalizedCount;
  return [
    Math.cos(angle) * radiusMeters,
    0,
    Math.sin(angle) * radiusMeters,
  ];
}

function launchCharacterProbes(characterID, systemID, typeID, requestedCount, options = {}) {
  const numericCharacterID = Math.max(0, toInt(characterID, 0));
  const numericSystemID = Math.max(0, toInt(systemID, 0));
  const numericTypeID = Math.max(0, toInt(typeID, 0));
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const nowFileTime =
    (BigInt(nowMs) * 10000n) + 116444736000000000n;
  const expirySeconds = Math.max(0, toInt(options.expirySeconds, 60 * 60));
  const requested = Math.max(0, toInt(requestedCount, 0));
  const basePosition = normalizeVector(options.position || options.destination || [0, 0, 0]);
  const scanRange = Math.max(0, toFiniteNumber(options.scanRange, 0));
  const rangeStep = Math.max(1, toInt(options.rangeStep, 7));
  const state = Math.max(0, toInt(options.state, 1));
  const launchRingRadiusMeters = Math.max(
    0,
    toFiniteNumber(options.launchRingRadiusMeters, DEFAULT_LAUNCH_RING_RADIUS_METERS),
  );
  const launchShipID = Math.max(0, toInt(options.shipID, 0));
  const launcherItemID = Math.max(0, toInt(options.launcherItemID, 0));
  const launcherFlagID = Math.max(0, toInt(options.launcherFlagID, 0));
  if (
    numericCharacterID <= 0 ||
    numericSystemID <= 0 ||
    numericTypeID <= 0 ||
    requested <= 0
  ) {
    return [];
  }

  const launched = [];
  mutateState((table) => {
    const characterState = ensureCharacterState(table, numericCharacterID);
    if (!characterState) {
      return table;
    }

    const activeProbeCount = Object.values(characterState.probesByID || {})
      .filter((probe) => Math.max(0, toInt(probe.systemID, 0)) === numericSystemID)
      .filter((probe) => Math.max(0, toInt(probe.state, 0)) > 0)
      .length;
    const availableSlots = Math.max(0, MAX_ACTIVE_PROBES - activeProbeCount);
    const launchCount = Math.min(requested, availableSlots);
    if (launchCount <= 0) {
      return table;
    }

    characterState.lastUpdatedAtMs = nowMs;
    let nextProbeSequence = Math.max(1, toInt(table.nextProbeSequence, 1));
    const launchSlotCount = Math.max(1, MAX_ACTIVE_PROBES);
    for (let index = 0; index < launchCount; index += 1) {
      const probeID = PROBE_ID_BASE + nextProbeSequence;
      nextProbeSequence += 1;
      // Use the active-probe ordinal on a shared ring so sequential one-by-one
      // launches do not stack scene probes at the same point beside the ship.
      const launchOffset = buildLaunchOffset(
        activeProbeCount + index,
        launchSlotCount,
        launchRingRadiusMeters,
      );
      const probe = normalizeProbeRecord({
        probeID,
        systemID: numericSystemID,
        typeID: numericTypeID,
        launchShipID,
        launcherItemID,
        launcherFlagID,
        pos: [
          basePosition[0] + launchOffset[0],
          basePosition[1] + launchOffset[1],
          basePosition[2] + launchOffset[2],
        ],
        destination: [
          basePosition[0] + launchOffset[0],
          basePosition[1] + launchOffset[1],
          basePosition[2] + launchOffset[2],
        ],
        scanRange,
        rangeStep,
        state,
        expiry: (nowFileTime + (BigInt(expirySeconds) * 10_000_000n)).toString(),
        lastSeenAtMs: nowMs,
      });
      characterState.probesByID[String(probe.probeID)] = probe;
      launched.push(cloneValue(probe));
    }
    table.nextProbeSequence = nextProbeSequence;
    return table;
  });

  return launched.sort((left, right) => toInt(left.probeID, 0) - toInt(right.probeID, 0));
}

function overrideCharacterProbeExpiry(characterID, durationSeconds, options = {}) {
  const numericCharacterID = Math.max(0, toInt(characterID, 0));
  const numericSystemID = Math.max(0, toInt(options.systemID, 0));
  const clampedDurationSeconds = Math.max(0, toInt(durationSeconds, 0));
  if (numericCharacterID <= 0) {
    return [];
  }

  const expiresAt = (
    (BigInt(Date.now()) * 10000n) +
    116444736000000000n +
    (BigInt(clampedDurationSeconds) * 10_000_000n)
  ).toString();
  const updated = [];
  mutateState((table) => {
    const characterState = ensureCharacterState(table, numericCharacterID);
    if (!characterState) {
      return table;
    }
    for (const probe of Object.values(characterState.probesByID || {})) {
      if (numericSystemID > 0 && Math.max(0, toInt(probe.systemID, 0)) !== numericSystemID) {
        continue;
      }
      probe.expiry = expiresAt;
      updated.push(cloneValue(probe));
    }
    return table;
  });
  return updated.sort((left, right) => toInt(left.probeID, 0) - toInt(right.probeID, 0));
}

function clearRuntimeCache() {
  cache = null;
}

module.exports = {
  MAX_ACTIVE_PROBES,
  MAX_PROBE_DIST_FROM_SUN_SQUARED,
  PROBE_RUNTIME_TABLE,
  clampVectorToProbeBounds,
  clearRuntimeCache,
  getCharacterStateSnapshot,
  getCharacterSystemProbes,
  getReconnectableCharacterProbes,
  isProbeExpired,
  removeExpiredCharacterProbes,
  launchCharacterProbes,
  loadState,
  mutateState,
  resolveProbeRangeContract,
  isValidPersistedProbeRecord,
  overrideCharacterProbeExpiry,
  removeInvalidCharacterProbes,
  removeCharacterProbes,
  setCharacterProbeActivity,
  synchronizeCharacterProbeGeometry,
  upsertCharacterProbes,
  writeState,
};
