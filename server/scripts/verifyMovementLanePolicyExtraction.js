#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const destiny = require("../src/space/destiny");

const {
  createMovementOwnerDispatch,
} = require("../src/space/movement/dispatch/movementOwnerDispatch");
const {
  MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
  MICHELLE_HELD_FUTURE_DESTINY_LEAD,
} = require("../src/space/movement/movementMichelleContract");
const {
  PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
} = require("../src/space/movement/warp/movementWarpContract");
const {
  OWNER_PENDING_GOTO_DUPLICATE_ALIGNMENT,
} = require("../src/space/movement/movementDeliveryPolicy");
const {
  resolvePreviousLastSentDestinyWasOwnerCritical,
  resolveOwnerMonotonicState,
  resolveGotoCommandSyncState,
  resolveOwnerMovementRestampState,
} = require("../src/space/movement/movementOwnerParity");

const DEFAULT_BASELINE_PATH = path.join(
  process.cwd(),
  "tmp",
  "movement-lane-policy-baseline.json",
);

const DEFAULT_RIGHT = Object.freeze({ x: 1, y: 0, z: 0 });

function ensureDirForFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function stableClone(value) {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => stableClone(entry));
  }
  if (value instanceof Set) {
    return [...value].map((entry) => stableClone(entry)).sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
  }
  if (value instanceof Map) {
    return [...value.entries()]
      .map(([key, entry]) => [stableClone(key), stableClone(entry)])
      .sort((left, right) => JSON.stringify(left[0]).localeCompare(JSON.stringify(right[0])));
  }
  if (typeof value === "function") {
    return "[Function]";
  }
  if (typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      result[key] = stableClone(value[key]);
    }
    return result;
  }
  return String(value);
}

function normalizeVector(vector, fallback = DEFAULT_RIGHT) {
  const source =
    vector && typeof vector === "object"
      ? vector
      : fallback && typeof fallback === "object"
        ? fallback
        : DEFAULT_RIGHT;
  const x = Number(source.x) || 0;
  const y = Number(source.y) || 0;
  const z = Number(source.z) || 0;
  const magnitude = Math.sqrt((x * x) + (y * y) + (z * z));
  if (magnitude <= 0) {
    return {
      x: Number(fallback.x) || 0,
      y: Number(fallback.y) || 0,
      z: Number(fallback.z) || 0,
    };
  }
  return {
    x: x / magnitude,
    y: y / magnitude,
    z: z / magnitude,
  };
}

function directionsNearlyMatch(left, right, alignment = OWNER_PENDING_GOTO_DUPLICATE_ALIGNMENT) {
  const normalizedLeft = normalizeVector(left, DEFAULT_RIGHT);
  const normalizedRight = normalizeVector(right, DEFAULT_RIGHT);
  const dot =
    (normalizedLeft.x * normalizedRight.x) +
    (normalizedLeft.y * normalizedRight.y) +
    (normalizedLeft.z * normalizedRight.z);
  return dot >= alignment;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number(fallback) || 0;
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.trunc(numeric);
  }
  const fallbackNumeric = Number(fallback);
  return Number.isFinite(fallbackNumeric) ? Math.trunc(fallbackNumeric) : 0;
}

function cloneVector(vector, fallback = DEFAULT_RIGHT) {
  const source =
    vector && typeof vector === "object"
      ? vector
      : fallback && typeof fallback === "object"
        ? fallback
        : DEFAULT_RIGHT;
  return {
    x: Number(source.x) || 0,
    y: Number(source.y) || 0,
    z: Number(source.z) || 0,
  };
}

function roundNumber(value, digits = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  const scale = 10 ** Math.max(0, Number(digits) || 0);
  return Math.round(numeric * scale) / scale;
}

function sessionMatchesIdentity(left, right) {
  return Boolean(left && right && left === right);
}

function summarizeVector(vector) {
  if (!vector || typeof vector !== "object") {
    return null;
  }
  return {
    x: roundNumber(vector.x, 6),
    y: roundNumber(vector.y, 6),
    z: roundNumber(vector.z, 6),
  };
}

function summarizeMissileUpdatesForLog(updates) {
  return Array.isArray(updates)
    ? updates.map((update) => ({
        stamp: toInt(update && update.stamp, 0) >>> 0,
        payloadName:
          update &&
          Array.isArray(update.payload) &&
          typeof update.payload[0] === "string"
            ? update.payload[0]
            : null,
      }))
    : [];
}

function buildMissileSessionSnapshot(runtime, session, nowMs) {
  return {
    nowMs: roundNumber(nowMs, 3),
    lastOwnerMissileLifecycleStamp:
      toInt(session && session._space && session._space.lastOwnerMissileLifecycleStamp, 0) >>> 0,
    lastPilotCommandMovementStamp:
      toInt(session && session._space && session._space.lastPilotCommandMovementStamp, 0) >>> 0,
    lastPilotCommandMovementAnchorStamp:
      toInt(session && session._space && session._space.lastPilotCommandMovementAnchorStamp, 0) >>> 0,
    lastPilotCommandMovementRawDispatchStamp:
      toInt(session && session._space && session._space.lastPilotCommandMovementRawDispatchStamp, 0) >>> 0,
    lastSentDestinyStamp:
      toInt(session && session._space && session._space.lastSentDestinyStamp, 0) >>> 0,
  };
}

function buildMissileSessionMutation(before, after) {
  return {
    before: stableClone(before),
    after: stableClone(after),
  };
}

function createSession(overrides = {}) {
  return {
    _space: {
      initialStateSent: true,
      shipID: 9001,
      lastOwnerMissileLifecycleStamp: 0,
      lastOwnerMissileLifecycleRawDispatchStamp: 0,
      lastPilotCommandMovementStamp: 0,
      lastPilotCommandMovementAnchorStamp: 0,
      lastPilotCommandMovementRawDispatchStamp: 0,
      lastPilotCommandDirection: null,
      lastSentDestinyStamp: 0,
      lastSentDestinyRawDispatchStamp: 0,
      lastSentDestinyOnlyStaleProjectedOwnerMissileLane: false,
      lastSentDestinyWasOwnerCritical: false,
      lastOwnerNonMissileCriticalStamp: 0,
      lastOwnerNonMissileCriticalRawDispatchStamp: 0,
      lastOwnerMissileFreshAcquireStamp: 0,
      pilotWarpQuietUntilStamp: 0,
      ...((overrides && overrides._space) || {}),
    },
    socket: {
      destroyed: false,
    },
    ...overrides,
  };
}

function createGotoUpdate(stamp, direction) {
  return {
    stamp,
    payload: [
      "GotoDirection",
      [
        9001,
        direction.x,
        direction.y,
        direction.z,
      ],
    ],
  };
}

function createStopUpdates(stamp, velocity) {
  return [
    {
      stamp,
      payload: ["SetSpeedFraction", [9001, 0]],
    },
    {
      stamp,
      payload: ["Stop", [9001]],
    },
    {
      stamp,
      payload: [
        "SetBallVelocity",
        [
          9001,
          Number(velocity && velocity.x) || 0,
          Number(velocity && velocity.y) || 0,
          Number(velocity && velocity.z) || 0,
        ],
      ],
    },
  ];
}

function createOwnerDispatchHarness(overrides = {}) {
  const logs = [];
  const sends = [];
  const broadcasts = [];
  const queuedPresentations = [];
  const ownerDispatchDeps =
    overrides && overrides.ownerDispatchDeps && typeof overrides.ownerDispatchDeps === "object"
      ? overrides.ownerDispatchDeps
      : {};
  const runtimeOverrides = { ...(overrides || {}) };
  delete runtimeOverrides.ownerDispatchDeps;
  const runtime = {
    getCurrentSimTimeMs() {
      return 1000;
    },
    filterMovementUpdatesForSession(session, updates) {
      return Array.isArray(updates) ? updates : [];
    },
    getCurrentDestinyStamp() {
      return 77;
    },
    getCurrentSessionDestinyStamp() {
      return 70;
    },
    isSessionInPilotWarpQuietWindow() {
      return false;
    },
    getCurrentPresentedSessionDestinyStamp() {
      return 70;
    },
    getCurrentVisibleSessionDestinyStamp() {
      return 70;
    },
    getHistorySafeSessionDestinyStamp(session, nowMs, minimumLead = 0) {
      return (70 + toInt(minimumLead, 0)) >>> 0;
    },
    getPendingHistorySafeSessionDestinyStamp(session, authoredStamp, nowMs, minimumLead = 0) {
      return Math.max(
        toInt(authoredStamp, 0) >>> 0,
        (70 + toInt(minimumLead, 0)) >>> 0,
      ) >>> 0;
    },
    sendDestinyUpdates(session, updates) {
      sends.push(stableClone(updates));
      return updates.reduce((highestStamp, update) => (
        Math.max(highestStamp, toInt(update && update.stamp, 0) >>> 0)
      ), 0) >>> 0;
    },
    hasActiveTickDestinyPresentationBatch() {
      return false;
    },
    queueTickDestinyPresentationUpdates(session, updates, options = {}) {
      queuedPresentations.push(
        stableClone({
          session,
          updates,
          options,
        }),
      );
      return Array.isArray(updates) ? updates.length : 0;
    },
    getShipEntityForSession() {
      return null;
    },
    getEntityByID() {
      return null;
    },
    broadcastMovementUpdates(updates, excludedSession, options) {
      broadcasts.push(
        stableClone({
          updates,
          excludedSession,
          options,
        }),
      );
      return true;
    },
    ...runtimeOverrides,
  };
  const ownerDispatch = createMovementOwnerDispatch({
    buildMissileSessionMutation,
    buildMissileSessionSnapshot,
    cloneDynamicEntityForDestinyPresentation:
      ownerDispatchDeps.cloneDynamicEntityForDestinyPresentation,
    cloneVector,
    directionsNearlyMatch,
    destiny: ownerDispatchDeps.destiny,
    isReadyForDestiny: () => true,
    logMissileDebug(name, payload) {
      logs.push({
        name,
        payload: stableClone(payload),
      });
    },
    normalizeVector,
    roundNumber,
    sessionMatchesIdentity,
    summarizeMissileUpdatesForLog,
    summarizeVector,
    tagUpdatesRequireExistingVisibility: (updates) => updates,
    toFiniteNumber,
    toInt,
    advanceMovement: ownerDispatchDeps.advanceMovement,
    DEFAULT_RIGHT,
    MICHELLE_HELD_FUTURE_DESTINY_LEAD,
    MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
    OWNER_PENDING_GOTO_DUPLICATE_ALIGNMENT,
    PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
    MICHELLE_HELD_FUTURE_DESTINY_LEAD,
  });
  return {
    runtime,
    ownerDispatch,
    logs,
    sends,
    broadcasts,
    queuedPresentations,
  };
}

function buildSnapshots() {
  const helperSnapshots = {
    previousLastSentExplicitFalse: resolvePreviousLastSentDestinyWasOwnerCritical({
      explicitWasOwnerCritical: false,
      previousLastSentDestinyStamp: 7,
      lastOwnerMissileLifecycleStamp: 7,
    }),
    previousLastSentInferredPilotCommand: resolvePreviousLastSentDestinyWasOwnerCritical({
      previousLastSentDestinyStamp: 12,
      lastOwnerPilotCommandMovementStamp: 12,
    }),
    ownerMonotonicOwnerCriticalNoSyntheticPostFloor: resolveOwnerMonotonicState({
      hasOwnerShip: true,
      containsMovementContractPayload: true,
      isSetStateGroup: false,
      isOwnerPilotMovementGroup: true,
      isOwnerMissileLifecycleGroup: false,
      isOwnerCriticalGroup: true,
      isFreshAcquireLifecycleGroup: false,
      currentSessionStamp: 1774869721,
      currentImmediateSessionStamp: 1774869721,
      currentRawDispatchStamp: 1774869722,
      recentEmittedOwnerCriticalMaxLead: 2,
      previousLastSentDestinyStamp: 1774869723,
      previousLastSentDestinyRawDispatchStamp: 1774869721,
      previousLastSentDestinyOnlyStaleProjectedOwnerMissileLane: false,
      previousLastSentDestinyWasOwnerCritical: false,
      lastOwnerMissileLifecycleStamp: 0,
      lastOwnerMissileLifecycleRawDispatchStamp: 0,
      lastOwnerMissileFreshAcquireStamp: 0,
      lastOwnerMissileFreshAcquireRawDispatchStamp: 0,
    }),
    ownerMonotonicRecentCriticalCeiling: resolveOwnerMonotonicState({
      hasOwnerShip: true,
      containsMovementContractPayload: true,
      isSetStateGroup: false,
      isOwnerPilotMovementGroup: false,
      isOwnerMissileLifecycleGroup: true,
      isOwnerCriticalGroup: true,
      isFreshAcquireLifecycleGroup: false,
      currentSessionStamp: 100,
      currentImmediateSessionStamp: 100,
      currentRawDispatchStamp: 50,
      recentEmittedOwnerCriticalMaxLead: 2,
      previousLastSentDestinyStamp: 102,
      previousLastSentDestinyRawDispatchStamp: 49,
      previousLastSentDestinyOnlyStaleProjectedOwnerMissileLane: false,
      previousLastSentDestinyWasOwnerCritical: true,
      lastOwnerMissileLifecycleStamp: 102,
      lastOwnerMissileLifecycleRawDispatchStamp: 49,
      lastOwnerMissileFreshAcquireStamp: 0,
      lastOwnerMissileFreshAcquireRawDispatchStamp: 0,
    }),
    gotoSyncSameRawSuppressed: resolveGotoCommandSyncState({
      speedFractionChanged: false,
      currentGotoDirectionMatches: false,
      pendingOwnerCommandDirectionMatches: false,
      pendingOwnerMovementStamp: 71,
      liveOwnerSessionStamp: 70,
      pendingOwnerMovementRawDispatchStamp: 77,
      currentRawDispatchStamp: 77,
    }),
    gotoSyncDuplicateCurrent: resolveGotoCommandSyncState({
      speedFractionChanged: false,
      currentGotoDirectionMatches: true,
      pendingOwnerCommandDirectionMatches: true,
      pendingOwnerMovementStamp: 0,
      liveOwnerSessionStamp: 70,
      pendingOwnerMovementRawDispatchStamp: 0,
      currentRawDispatchStamp: 77,
    }),
    ownerRestampDistinctFutureSteerAdvances: resolveOwnerMovementRestampState({
      ownerMovementUpdates: [
        createGotoUpdate(1774898526, { x: -0.6, y: 0, z: 0.8 }),
      ],
      ownerHasSteeringCommand: true,
      currentRawDispatchStamp: 1774898526,
      liveOwnerSessionStamp: 1774898526,
      recentOwnerMissileLifecycleStamp: 0,
      currentPresentedOwnerStamp: 1774898527,
      currentVisibleOwnerStamp: 1774898526,
      quietWindowMinimumStamp: 0,
      lastFreshAcquireLifecycleStamp: 1774898501,
      recentOwnerMissileLifecycleRawDispatchStamp: 0,
      previousOwnerPilotCommandStamp: 1774898527,
      previousOwnerPilotCommandAnchorStamp: 1774898525,
      previousOwnerPilotCommandRawDispatchStamp: 1774898525,
      previousOverallOwnerDestinyStamp: 1774898527,
      previousOverallOwnerDestinyRawDispatchStamp: 1774898525,
      previousOverallOwnerDestinyOnlyStaleProjectedOwnerMissileLane: false,
      previousOwnerNonMissileCriticalStamp: 1774898527,
      previousOwnerNonMissileCriticalRawDispatchStamp: 1774898525,
      previousOwnerMissileFreshAcquireStamp: 0,
      previousOwnerMissileLifecycleAnchorStamp: 0,
      previousOverallOwnerDestinyWasOwnerCritical: true,
      previousOwnerPilotCommandDirectionRaw: { x: -0.2, y: 0.3, z: 0.9 },
      normalizeVector,
      directionsNearlyMatch,
      getPendingHistorySafeStamp: (authoredStamp, minimumLead = 0) => Math.max(
        toInt(authoredStamp, 0) >>> 0,
        (1774898526 + toInt(minimumLead, 0)) >>> 0,
      ) >>> 0,
      defaultRight: DEFAULT_RIGHT,
    }),
    ownerRestampSameRawDistinctFutureSteerKeepsFirstEcho: resolveOwnerMovementRestampState({
      ownerMovementUpdates: [
        createGotoUpdate(1774898526, { x: -0.6, y: 0, z: 0.8 }),
      ],
      ownerHasSteeringCommand: true,
      currentRawDispatchStamp: 1774898525,
      liveOwnerSessionStamp: 1774898526,
      recentOwnerMissileLifecycleStamp: 0,
      currentPresentedOwnerStamp: 1774898527,
      currentVisibleOwnerStamp: 1774898526,
      quietWindowMinimumStamp: 0,
      lastFreshAcquireLifecycleStamp: 1774898501,
      recentOwnerMissileLifecycleRawDispatchStamp: 0,
      previousOwnerPilotCommandStamp: 1774898527,
      previousOwnerPilotCommandAnchorStamp: 1774898526,
      previousOwnerPilotCommandRawDispatchStamp: 1774898525,
      previousOverallOwnerDestinyStamp: 1774898527,
      previousOverallOwnerDestinyRawDispatchStamp: 1774898525,
      previousOverallOwnerDestinyOnlyStaleProjectedOwnerMissileLane: false,
      previousOwnerNonMissileCriticalStamp: 1774898527,
      previousOwnerNonMissileCriticalRawDispatchStamp: 1774898525,
      previousOwnerMissileFreshAcquireStamp: 0,
      previousOwnerMissileLifecycleAnchorStamp: 0,
      previousOverallOwnerDestinyWasOwnerCritical: true,
      previousOwnerPilotCommandDirectionRaw: { x: -0.2, y: 0.3, z: 0.9 },
      normalizeVector,
      directionsNearlyMatch,
      getPendingHistorySafeStamp: (authoredStamp, minimumLead = 0) => Math.max(
        toInt(authoredStamp, 0) >>> 0,
        (1774898526 + toInt(minimumLead, 0)) >>> 0,
      ) >>> 0,
      defaultRight: DEFAULT_RIGHT,
    }),
    ownerRestampDoesNotReuseOwnerMissileLifecycleLane: resolveOwnerMovementRestampState({
      ownerMovementUpdates: [
        createGotoUpdate(1774811310, { x: 0, y: 1, z: 0 }),
        {
          stamp: 1774811310,
          payload: ["SetSpeedFraction", [100001, 1]],
        },
      ],
      ownerHasSteeringCommand: true,
      currentRawDispatchStamp: 1774811310,
      liveOwnerSessionStamp: 1774811310,
      currentVisibleOwnerStamp: 1774811311,
      quietWindowMinimumStamp: 0,
      lastFreshAcquireLifecycleStamp: 0,
      previousOwnerPilotCommandStamp: 1774811310,
      previousOwnerPilotCommandAnchorStamp: 0,
      previousOwnerPilotCommandRawDispatchStamp: 0,
      previousOwnerPilotCommandDirectionRaw: null,
      normalizeVector,
      directionsNearlyMatch,
      getPendingHistorySafeStamp: (authoredStamp, minimumLead = 0) => Math.max(
        toInt(authoredStamp, 0) >>> 0,
        (1774811310 + toInt(minimumLead, 0)) >>> 0,
      ) >>> 0,
      defaultRight: DEFAULT_RIGHT,
    }),
  };

  const normalHarness = createOwnerDispatchHarness();
  const normalSession = createSession();
  normalHarness.ownerDispatch.broadcastPilotCommandMovementUpdates(
    normalHarness.runtime,
    normalSession,
    [createGotoUpdate(70, { x: 0, y: 1, z: 0 })],
    1000,
    { sendOptions: { tag: "normal" } },
  );

  const repeatedHarness = createOwnerDispatchHarness();
  const repeatedSession = createSession({
    _space: {
      lastPilotCommandMovementStamp: 1774869723,
      lastPilotCommandMovementAnchorStamp: 1774869720,
      lastPilotCommandMovementRawDispatchStamp: 1774869721,
      lastPilotCommandDirection: { x: 0, y: 1, z: 0 },
      lastSentDestinyStamp: 1774869723,
      lastSentDestinyRawDispatchStamp: 1774869721,
      lastSentDestinyOnlyStaleProjectedOwnerMissileLane: false,
      lastSentDestinyWasOwnerCritical: false,
      lastOwnerNonMissileCriticalStamp: 1774869721,
      lastOwnerNonMissileCriticalRawDispatchStamp: 1774869719,
    },
  });
  repeatedHarness.ownerDispatch.broadcastPilotCommandMovementUpdates(
    repeatedHarness.runtime,
    repeatedSession,
    [createGotoUpdate(1774869722, { x: 0, y: 1, z: 0 })],
    1000,
    { sendOptions: { tag: "repeated" } },
  );

  const joltHarness = createOwnerDispatchHarness({
    getCurrentDestinyStamp() {
      return 1774885683;
    },
    getCurrentSessionDestinyStamp() {
      return 1774885683;
    },
    getCurrentPresentedSessionDestinyStamp() {
      return 1774885684;
    },
    getCurrentVisibleSessionDestinyStamp() {
      return 1774885683;
    },
    getPendingHistorySafeSessionDestinyStamp(session, authoredStamp, nowMs, minimumLead = 0) {
      return Math.max(
        toInt(authoredStamp, 0) >>> 0,
        (1774885683 + toInt(minimumLead, 0)) >>> 0,
      ) >>> 0;
    },
  });
  const joltSession = createSession({
    _space: {
      lastPilotCommandMovementStamp: 1774885684,
      lastPilotCommandMovementAnchorStamp: 1774885682,
      lastPilotCommandMovementRawDispatchStamp: 1774885682,
      lastPilotCommandDirection: { x: -0.7, y: -0.1, z: 0.7 },
      lastSentDestinyStamp: 1774885684,
      lastSentDestinyRawDispatchStamp: 1774885682,
      lastSentDestinyOnlyStaleProjectedOwnerMissileLane: false,
      lastSentDestinyWasOwnerCritical: true,
      lastOwnerNonMissileCriticalStamp: 1774885684,
      lastOwnerNonMissileCriticalRawDispatchStamp: 1774885682,
    },
  });
  joltHarness.ownerDispatch.broadcastPilotCommandMovementUpdates(
    joltHarness.runtime,
    joltSession,
    [createGotoUpdate(1774885683, { x: -0.6, y: -0.2, z: 0.8 })],
    1000,
    { sendOptions: { tag: "jolt-window" } },
  );

  const combatHarness = createOwnerDispatchHarness({
    getCurrentDestinyStamp() {
      return 1774892574;
    },
    getCurrentSessionDestinyStamp() {
      return 1774892574;
    },
    getCurrentPresentedSessionDestinyStamp() {
      return 1774892575;
    },
    getCurrentVisibleSessionDestinyStamp() {
      return 1774892574;
    },
    getPendingHistorySafeSessionDestinyStamp(session, authoredStamp, nowMs, minimumLead = 0) {
      return Math.max(
        toInt(authoredStamp, 0) >>> 0,
        (1774892574 + toInt(minimumLead, 0)) >>> 0,
      ) >>> 0;
    },
  });
  const combatSession = createSession({
    _space: {
      lastPilotCommandMovementStamp: 1774892575,
      lastPilotCommandMovementAnchorStamp: 1774892574,
      lastPilotCommandMovementRawDispatchStamp: 1774892574,
      lastPilotCommandDirection: { x: 0.3, y: 0.1, z: 0.9 },
      lastSentDestinyStamp: 1774892575,
      lastSentDestinyRawDispatchStamp: 1774892574,
      lastSentDestinyOnlyStaleProjectedOwnerMissileLane: false,
      lastSentDestinyWasOwnerCritical: true,
      lastOwnerNonMissileCriticalStamp: 1774892575,
      lastOwnerNonMissileCriticalRawDispatchStamp: 1774892574,
    },
  });
  combatHarness.ownerDispatch.broadcastPilotCommandMovementUpdates(
    combatHarness.runtime,
    combatSession,
    [createGotoUpdate(1774892574, { x: -0.2, y: -0.1, z: 1.0 })],
    1000,
    { sendOptions: { tag: "combat-window" } },
  );

  const stopHarness = createOwnerDispatchHarness({
    getCurrentDestinyStamp() {
      return 1774889448;
    },
    getCurrentSessionDestinyStamp() {
      return 1774889448;
    },
    getCurrentPresentedSessionDestinyStamp() {
      return 1774889448;
    },
    getCurrentVisibleSessionDestinyStamp() {
      return 1774889449;
    },
    getPendingHistorySafeSessionDestinyStamp(session, authoredStamp, nowMs, minimumLead = 0) {
      return Math.max(
        toInt(authoredStamp, 0) >>> 0,
        (1774889448 + toInt(minimumLead, 0)) >>> 0,
      ) >>> 0;
    },
  });
  const stopSession = createSession({
    _space: {
      lastSentDestinyStamp: 1774889449,
      lastSentDestinyRawDispatchStamp: 1774889447,
      lastSentDestinyOnlyStaleProjectedOwnerMissileLane: false,
      lastSentDestinyWasOwnerCritical: false,
      lastOwnerNonMissileCriticalStamp: 1774889447,
      lastOwnerNonMissileCriticalRawDispatchStamp: 1774889447,
      lastPilotCommandMovementStamp: 1774889447,
      lastPilotCommandMovementAnchorStamp: 1774889447,
      lastPilotCommandMovementRawDispatchStamp: 1774889447,
    },
  });
  stopHarness.ownerDispatch.broadcastPilotCommandMovementUpdates(
    stopHarness.runtime,
    stopSession,
    createStopUpdates(1774889448, {
      x: -249.23401180166266,
      y: -79.9307427603294,
      z: -81.70332541178757,
    }),
    1000,
    { sendOptions: { tag: "stop-window" } },
  );

  const killWindowHarness = createOwnerDispatchHarness({
    getCurrentDestinyStamp() {
      return 1774891775;
    },
    getCurrentSessionDestinyStamp() {
      return 1774891775;
    },
    getCurrentPresentedSessionDestinyStamp() {
      return 1774891776;
    },
    getCurrentVisibleSessionDestinyStamp() {
      return 1774891775;
    },
    getPendingHistorySafeSessionDestinyStamp(session, authoredStamp, nowMs, minimumLead = 0) {
      return Math.max(
        toInt(authoredStamp, 0) >>> 0,
        (1774891775 + toInt(minimumLead, 0)) >>> 0,
      ) >>> 0;
    },
  });
  const killWindowSession = createSession({
    _space: {
      lastSentDestinyStamp: 1774891776,
      lastSentDestinyRawDispatchStamp: 1774891774,
      lastSentDestinyOnlyStaleProjectedOwnerMissileLane: false,
      lastSentDestinyWasOwnerCritical: false,
      lastOwnerNonMissileCriticalStamp: 1774891775,
      lastOwnerNonMissileCriticalRawDispatchStamp: 1774891774,
      lastPilotCommandMovementStamp: 1774891775,
      lastPilotCommandMovementAnchorStamp: 1774891774,
      lastPilotCommandMovementRawDispatchStamp: 1774891774,
    },
  });
  killWindowHarness.ownerDispatch.broadcastPilotCommandMovementUpdates(
    killWindowHarness.runtime,
    killWindowSession,
    [createGotoUpdate(1774891775, { x: 0.2, y: -0.3, z: -0.9 })],
    1000,
    { sendOptions: { tag: "kill-window" } },
  );

  const postFreshAcquireHarness = createOwnerDispatchHarness({
    getCurrentDestinyStamp() {
      return 1774894131;
    },
    getCurrentSessionDestinyStamp() {
      return 1774894131;
    },
    getCurrentPresentedSessionDestinyStamp() {
      return 1774894132;
    },
    getCurrentVisibleSessionDestinyStamp() {
      return 1774894131;
    },
    getPendingHistorySafeSessionDestinyStamp(session, authoredStamp, nowMs, minimumLead = 0) {
      return Math.max(
        toInt(authoredStamp, 0) >>> 0,
        (1774894131 + toInt(minimumLead, 0)) >>> 0,
      ) >>> 0;
    },
  });
  const postFreshAcquireSession = createSession({
    _space: {
      lastFreshAcquireLifecycleStamp: 1774894132,
      lastSentDestinyStamp: 1774894132,
      lastSentDestinyRawDispatchStamp: 1774894130,
      lastSentDestinyOnlyStaleProjectedOwnerMissileLane: false,
      lastSentDestinyWasOwnerCritical: false,
      lastOwnerNonMissileCriticalStamp: 1774894129,
      lastOwnerNonMissileCriticalRawDispatchStamp: 1774894128,
      lastPilotCommandMovementStamp: 1774894129,
      lastPilotCommandMovementAnchorStamp: 1774894128,
      lastPilotCommandMovementRawDispatchStamp: 1774894128,
      lastPilotCommandDirection: { x: 0.6, y: -0.4, z: 0.7 },
    },
  });
  postFreshAcquireHarness.ownerDispatch.broadcastPilotCommandMovementUpdates(
    postFreshAcquireHarness.runtime,
    postFreshAcquireSession,
    [createGotoUpdate(1774894131, { x: 0.7, y: -0.6, z: 0.4 })],
    1000,
    { sendOptions: { tag: "post-fresh-acquire-window" } },
  );

  const projectedStopEntity = {
    itemID: 9001,
    mode: "STOP",
    pendingDock: null,
    pendingWarp: null,
    warpState: null,
    sessionlessWarpIngress: null,
    position: { x: 10, y: 20, z: 30 },
    velocity: { x: 163.2, y: -25.2, z: -72.9 },
    direction: { x: 0.8, y: -0.1, z: -0.6 },
    maxVelocity: 324.95,
    agilitySeconds: 30,
  };
  const projectedStopHarness = createOwnerDispatchHarness({
    getCurrentSimTimeMs() {
      return 1774896451371;
    },
    getCurrentDestinyStamp() {
      return 1774896451;
    },
    getCurrentSessionDestinyStamp() {
      return 1774896451;
    },
    getCurrentPresentedSessionDestinyStamp() {
      return 1774896451;
    },
    getCurrentVisibleSessionDestinyStamp() {
      return 1774896451;
    },
    getShipEntityForSession() {
      return projectedStopEntity;
    },
    ownerDispatchDeps: {
      advanceMovement(entity, scene, deltaSeconds, nowMs) {
        entity.position = { x: 12, y: 21, z: 31 };
        entity.velocity = { x: 121.5, y: -18.9, z: -54.7 };
        entity.projectedDeltaSeconds = roundNumber(deltaSeconds, 3);
        entity.projectedNowMs = roundNumber(nowMs, 3);
      },
      cloneDynamicEntityForDestinyPresentation(entity) {
        return stableClone(entity);
      },
      destiny,
    },
  });
  const projectedStopSession = createSession({
    _space: {
      lastSentDestinyStamp: 1774896450,
      lastSentDestinyRawDispatchStamp: 1774896449,
      lastSentDestinyOnlyStaleProjectedOwnerMissileLane: false,
      lastSentDestinyWasOwnerCritical: true,
      lastOwnerNonMissileCriticalStamp: 1774896450,
      lastOwnerNonMissileCriticalRawDispatchStamp: 1774896449,
      lastPilotCommandMovementStamp: 1774896450,
      lastPilotCommandMovementAnchorStamp: 1774896449,
      lastPilotCommandMovementRawDispatchStamp: 1774896449,
    },
  });
  projectedStopHarness.ownerDispatch.broadcastPilotCommandMovementUpdates(
    projectedStopHarness.runtime,
    projectedStopSession,
    createStopUpdates(1774896451, projectedStopEntity.velocity),
    1774896451371,
    { sendOptions: { tag: "projected-stop-window" } },
  );

  const batchedKillHarness = createOwnerDispatchHarness({
    getCurrentDestinyStamp() {
      return 1774897447;
    },
    getCurrentSessionDestinyStamp() {
      return 1774897447;
    },
    getCurrentPresentedSessionDestinyStamp() {
      return 1774897448;
    },
    getCurrentVisibleSessionDestinyStamp() {
      return 1774897447;
    },
    hasActiveTickDestinyPresentationBatch() {
      return true;
    },
    getPendingHistorySafeSessionDestinyStamp(session, authoredStamp, nowMs, minimumLead = 0) {
      return Math.max(
        toInt(authoredStamp, 0) >>> 0,
        (1774897447 + toInt(minimumLead, 0)) >>> 0,
      ) >>> 0;
    },
  });
  const batchedKillSession = createSession({
    _space: {
      lastSentDestinyStamp: 1774897448,
      lastSentDestinyRawDispatchStamp: 1774897447,
      lastSentDestinyOnlyStaleProjectedOwnerMissileLane: false,
      lastSentDestinyWasOwnerCritical: false,
      lastOwnerNonMissileCriticalStamp: 1774897447,
      lastOwnerNonMissileCriticalRawDispatchStamp: 1774897446,
      lastPilotCommandMovementStamp: 1774897447,
      lastPilotCommandMovementAnchorStamp: 1774897446,
      lastPilotCommandMovementRawDispatchStamp: 1774897446,
      lastPilotCommandDirection: { x: -1, y: 0, z: -0.2 },
    },
  });
  batchedKillHarness.ownerDispatch.broadcastPilotCommandMovementUpdates(
    batchedKillHarness.runtime,
    batchedKillSession,
    [createGotoUpdate(1774897447, { x: -0.9752782296440112, y: -0.046602899700875236, z: -0.21601051947049535 })],
    1774897447661,
    { sendOptions: { tag: "batched-kill-window" } },
  );

  const distinctFutureSteerHarness = createOwnerDispatchHarness({
    getCurrentDestinyStamp() {
      return 1774898526;
    },
    getCurrentSessionDestinyStamp() {
      return 1774898526;
    },
    getCurrentPresentedSessionDestinyStamp() {
      return 1774898527;
    },
    getCurrentVisibleSessionDestinyStamp() {
      return 1774898526;
    },
    getPendingHistorySafeSessionDestinyStamp(session, authoredStamp, nowMs, minimumLead = 0) {
      return Math.max(
        toInt(authoredStamp, 0) >>> 0,
        (1774898526 + toInt(minimumLead, 0)) >>> 0,
      ) >>> 0;
    },
  });
  const distinctFutureSteerSession = createSession({
    _space: {
      lastSentDestinyStamp: 1774898527,
      lastSentDestinyRawDispatchStamp: 1774898525,
      lastSentDestinyOnlyStaleProjectedOwnerMissileLane: false,
      lastSentDestinyWasOwnerCritical: true,
      lastOwnerNonMissileCriticalStamp: 1774898527,
      lastOwnerNonMissileCriticalRawDispatchStamp: 1774898525,
      lastPilotCommandMovementStamp: 1774898527,
      lastPilotCommandMovementAnchorStamp: 1774898525,
      lastPilotCommandMovementRawDispatchStamp: 1774898525,
      lastPilotCommandDirection: { x: -0.2, y: 0.3, z: 0.9 },
      lastFreshAcquireLifecycleStamp: 1774898501,
    },
  });
  distinctFutureSteerHarness.ownerDispatch.broadcastPilotCommandMovementUpdates(
    distinctFutureSteerHarness.runtime,
    distinctFutureSteerSession,
    [createGotoUpdate(1774898526, { x: -0.6, y: 0, z: 0.8 })],
    1774898526646,
    { sendOptions: { tag: "distinct-future-steer-window" } },
  );

  return stableClone({
    helperSnapshots,
    ownerDispatchSnapshots: {
      normal: {
        logs: normalHarness.logs,
        sends: normalHarness.sends,
        broadcasts: normalHarness.broadcasts,
        session: normalSession,
      },
      repeated: {
        logs: repeatedHarness.logs,
        sends: repeatedHarness.sends,
        broadcasts: repeatedHarness.broadcasts,
        session: repeatedSession,
      },
      joltWindow: {
        logs: joltHarness.logs,
        sends: joltHarness.sends,
        broadcasts: joltHarness.broadcasts,
        session: joltSession,
      },
      combatWindow: {
        logs: combatHarness.logs,
        sends: combatHarness.sends,
        broadcasts: combatHarness.broadcasts,
        session: combatSession,
      },
      stopWindow: {
        logs: stopHarness.logs,
        sends: stopHarness.sends,
        broadcasts: stopHarness.broadcasts,
        session: stopSession,
      },
      killWindow: {
        logs: killWindowHarness.logs,
        sends: killWindowHarness.sends,
        broadcasts: killWindowHarness.broadcasts,
        session: killWindowSession,
      },
      postFreshAcquireWindow: {
        logs: postFreshAcquireHarness.logs,
        sends: postFreshAcquireHarness.sends,
        broadcasts: postFreshAcquireHarness.broadcasts,
        session: postFreshAcquireSession,
      },
      projectedStopWindow: {
        logs: projectedStopHarness.logs,
        sends: projectedStopHarness.sends,
        broadcasts: projectedStopHarness.broadcasts,
        queuedPresentations: projectedStopHarness.queuedPresentations,
        session: projectedStopSession,
      },
      batchedKillWindow: {
        logs: batchedKillHarness.logs,
        sends: batchedKillHarness.sends,
        broadcasts: batchedKillHarness.broadcasts,
        queuedPresentations: batchedKillHarness.queuedPresentations,
        session: batchedKillSession,
      },
      distinctFutureSteerWindow: {
        logs: distinctFutureSteerHarness.logs,
        sends: distinctFutureSteerHarness.sends,
        broadcasts: distinctFutureSteerHarness.broadcasts,
        queuedPresentations: distinctFutureSteerHarness.queuedPresentations,
        session: distinctFutureSteerSession,
      },
    },
  });
}

function assertParityInvariants(snapshot) {
  const helperState =
    snapshot &&
    snapshot.helperSnapshots &&
    snapshot.helperSnapshots.ownerRestampDistinctFutureSteerAdvances;
  if (!helperState) {
    throw new Error("Missing helper snapshot for distinct future owner steering parity.");
  }
  if ((toInt(helperState.nextDistinctOwnerPilotCommandLane, 0) >>> 0) !== 1774898528) {
    throw new Error(
      `Expected nextDistinctOwnerPilotCommandLane to advance to 1774898528, got ${helperState.nextDistinctOwnerPilotCommandLane}.`,
    );
  }
  if ((toInt(helperState.ownerStampFloor, 0) >>> 0) !== 1774898528) {
    throw new Error(
      `Expected ownerStampFloor to advance to 1774898528, got ${helperState.ownerStampFloor}.`,
    );
  }
  const sameRawHelperState =
    snapshot &&
    snapshot.helperSnapshots &&
    snapshot.helperSnapshots.ownerRestampSameRawDistinctFutureSteerKeepsFirstEcho;
  if (!sameRawHelperState) {
    throw new Error("Missing helper snapshot for same-raw distinct future owner steering parity.");
  }
  if ((toInt(sameRawHelperState.nextDistinctOwnerPilotCommandLane, 0) >>> 0) !== 0) {
    throw new Error(
      `Expected same-raw distinct future owner steering not to ratchet another owner lane, got ${sameRawHelperState.nextDistinctOwnerPilotCommandLane}.`,
    );
  }
  if ((toInt(sameRawHelperState.ownerStampFloor, 0) >>> 0) !== 1774898527) {
    throw new Error(
      `Expected same-raw distinct future owner steering to keep the first owner echo on 1774898527, got ${sameRawHelperState.ownerStampFloor}.`,
    );
  }
  const noOwnerMissileLaneState =
    snapshot &&
    snapshot.helperSnapshots &&
    snapshot.helperSnapshots.ownerRestampDoesNotReuseOwnerMissileLifecycleLane;
  if (!noOwnerMissileLaneState) {
    throw new Error("Missing helper snapshot for owner missile lifecycle reuse parity.");
  }
  if ((toInt(noOwnerMissileLaneState.ownerDirectEchoMinimumStamp, 0) >>> 0) !== 1774811311) {
    throw new Error(
      `Expected ownerDirectEchoMinimumStamp to stay on 1774811311, got ${noOwnerMissileLaneState.ownerDirectEchoMinimumStamp}.`,
    );
  }
  if ((toInt(noOwnerMissileLaneState.ownerStampFloor, 0) >>> 0) !== 1774811311) {
    throw new Error(
      `Expected ownerStampFloor to stay on direct echo 1774811311 instead of reusing a missile lane, got ${noOwnerMissileLaneState.ownerStampFloor}.`,
    );
  }
  for (const removedField of [
    "sameRawOwnerMissileLifecycleMonotonicFloor",
    "sameRawPresentedNonCriticalOwnerLaneFloor",
    "maximumTrustedOwnerMissileActiveLane",
    "ownerMissileActiveMinimumStamp",
    "ownerMissileActiveWindow",
    "maximumTrustedEarlierTickOwnerPilotCommandLane",
    "recentOwnerNonMissileCriticalRawDispatchDelta",
    "maximumTrustedPresentedOwnerNonMissileCriticalLane",
    "recentPresentedOwnerNonMissileCriticalLane",
    "recentPresentedOverallOwnerLane",
    "recentAdjacentOverallOwnerLane",
    "recentNearbyOverallOwnerLane",
    "recentOverallOwnerLaneIsOnlyStalePriorMissileLane",
    "maximumTrustedRecentBufferedOverallOwnerLane",
    "stillBufferedOverallOwnerCriticalLane",
    "recentBufferedOverallOwnerCriticalLane",
    "recentAdjacentEarlierTickOwnerPilotCommandLane",
    "recentOverallOwnerRawDispatchDelta",
    "recentOverallOwnerLaneHasTrustedMovementSource",
    "trustedEarlierTickOwnerPilotCommandLane",
    "trustedOwnerMissileActiveLane",
    "recentPresentedOwnerPilotCommandLane",
    "sharedMissileActiveOwnerMovementLane",
    "clearingOwnerPilotCommandLane",
  ]) {
    if (Object.prototype.hasOwnProperty.call(helperState, removedField)) {
      throw new Error(
        `Expected helper snapshot to drop removed parity field ${removedField}.`,
      );
    }
  }

  const ownerDispatchScenario =
    snapshot &&
    snapshot.ownerDispatchSnapshots &&
    snapshot.ownerDispatchSnapshots.distinctFutureSteerWindow;
  if (!ownerDispatchScenario) {
    throw new Error("Missing owner-dispatch snapshot for distinct future steering parity.");
  }
  const firstOwnerSend =
    Array.isArray(ownerDispatchScenario.sends) &&
    ownerDispatchScenario.sends[0] &&
    ownerDispatchScenario.sends[0][0];
  if (!firstOwnerSend) {
    throw new Error("Missing emitted owner steering send in distinct future steering snapshot.");
  }
  if ((toInt(firstOwnerSend.stamp, 0) >>> 0) !== 1774898528) {
    throw new Error(
      `Expected emitted owner steering stamp 1774898528, got ${firstOwnerSend.stamp}.`,
    );
  }
  const ownerRestampLog = Array.isArray(ownerDispatchScenario.logs)
    ? ownerDispatchScenario.logs.find((entry) => entry && entry.name === "movement.owner-restamp")
    : null;
  const loggedNextDistinctLane =
    ownerRestampLog &&
    ownerRestampLog.payload &&
    ownerRestampLog.payload.ownerMovementFloor &&
    ownerRestampLog.payload.ownerMovementFloor.nextDistinctOwnerPilotCommandLane;
  if ((toInt(loggedNextDistinctLane, 0) >>> 0) !== 1774898528) {
    throw new Error(
      `Expected logged nextDistinctOwnerPilotCommandLane 1774898528, got ${loggedNextDistinctLane}.`,
    );
  }
  const ownerMovementFloor =
    ownerRestampLog &&
    ownerRestampLog.payload &&
    ownerRestampLog.payload.ownerMovementFloor;
  if (!ownerMovementFloor) {
    throw new Error("Missing ownerMovementFloor in owner-restamp log snapshot.");
  }
  for (const removedField of [
    "previousOverallOwnerDestinyOnlyStaleProjectedOwnerMissileLane",
    "maximumTrustedOwnerMissileActiveLane",
    "ownerMissileActiveMinimumStamp",
    "ownerMissileActiveWindow",
    "previousOverallOwnerDestinyStamp",
    "previousOverallOwnerDestinyRawDispatchStamp",
    "previousOverallOwnerDestinyWasOwnerCritical",
    "previousOwnerMissileFreshAcquireStamp",
    "previousOwnerMissileLifecycleAnchorStamp",
    "previousOwnerNonMissileCriticalStamp",
    "previousOwnerNonMissileCriticalRawDispatchStamp",
    "maximumTrustedEarlierTickOwnerPilotCommandLane",
    "recentOwnerNonMissileCriticalRawDispatchDelta",
    "maximumTrustedPresentedOwnerNonMissileCriticalLane",
    "recentPresentedOwnerNonMissileCriticalLane",
    "recentPresentedOverallOwnerLane",
    "recentAdjacentOverallOwnerLane",
    "recentNearbyOverallOwnerLane",
    "recentOverallOwnerLaneIsOnlyStalePriorMissileLane",
    "maximumTrustedRecentBufferedOverallOwnerLane",
    "stillBufferedOverallOwnerCriticalLane",
    "recentBufferedOverallOwnerCriticalLane",
    "recentAdjacentEarlierTickOwnerPilotCommandLane",
    "recentOverallOwnerRawDispatchDelta",
    "recentOverallOwnerLaneHasTrustedMovementSource",
    "trustedEarlierTickOwnerPilotCommandLane",
    "trustedOwnerMissileActiveLane",
    "recentPresentedOwnerPilotCommandLane",
    "sharedMissileActiveOwnerMovementLane",
    "clearingOwnerPilotCommandLane",
  ]) {
    if (Object.prototype.hasOwnProperty.call(ownerMovementFloor, removedField)) {
      throw new Error(
        `Expected owner-restamp log to drop removed parity field ${removedField}.`,
      );
    }
  }
}

function recordBaseline(outputPath = DEFAULT_BASELINE_PATH) {
  const snapshot = buildSnapshots();
  assertParityInvariants(snapshot);
  ensureDirForFile(outputPath);
  fs.writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Recorded movement lane policy baseline to ${outputPath}`);
}

function verifyBaseline(inputPath = DEFAULT_BASELINE_PATH) {
  if (!fs.existsSync(inputPath)) {
    console.error(`Missing movement lane policy baseline: ${inputPath}`);
    process.exitCode = 1;
    return;
  }
  const expected = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const actual = buildSnapshots();
  assertParityInvariants(actual);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error("Movement lane policy extraction regression detected.");
    console.error(`Baseline: ${inputPath}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Movement lane policy verified against ${inputPath}`);
}

const mode = process.argv[2] || "verify";
if (mode === "record") {
  recordBaseline(process.argv[3] || DEFAULT_BASELINE_PATH);
} else if (mode === "verify") {
  verifyBaseline(process.argv[3] || DEFAULT_BASELINE_PATH);
} else {
  console.error("Usage: node server/scripts/verifyMovementLanePolicyExtraction.js [record|verify] [baselinePath]");
  process.exitCode = 1;
}
