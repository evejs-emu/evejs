#!/usr/bin/env node

const assert = require("assert");

const {
  createMovementContractDispatch,
} = require("../src/space/movement/dispatch/movementContractDispatch");
const {
  clampQueuedSubwarpUpdates,
} = require("../src/space/movement/movementSync");

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.trunc(numeric);
  }
  const fallbackNumeric = Number(fallback);
  return Number.isFinite(fallbackNumeric) ? Math.trunc(fallbackNumeric) : 0;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneVector(vector, fallback = { x: 0, y: 0, z: 0 }) {
  const source =
    vector && typeof vector === "object"
      ? vector
      : fallback && typeof fallback === "object"
        ? fallback
        : { x: 0, y: 0, z: 0 };
  return {
    x: toFiniteNumber(source.x, 0),
    y: toFiniteNumber(source.y, 0),
    z: toFiniteNumber(source.z, 0),
  };
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const source = cloneVector(vector, fallback);
  const magnitude = Math.sqrt(
    (source.x * source.x) +
    (source.y * source.y) +
    (source.z * source.z)
  );
  if (magnitude <= 0) {
    return cloneVector(fallback, { x: 1, y: 0, z: 0 });
  }
  return {
    x: source.x / magnitude,
    y: source.y / magnitude,
    z: source.z / magnitude,
  };
}

function directionsNearlyMatch(left, right, minimumDot = 0.9995) {
  const normalizedLeft = normalizeVector(left, { x: 1, y: 0, z: 0 });
  const normalizedRight = normalizeVector(right, { x: 1, y: 0, z: 0 });
  const dot =
    (normalizedLeft.x * normalizedRight.x) +
    (normalizedLeft.y * normalizedRight.y) +
    (normalizedLeft.z * normalizedRight.z);
  return dot >= minimumDot;
}

function buildDeps() {
  return {
    cloneVector,
    directionsNearlyMatch,
    isReadyForDestiny(session) {
      return Boolean(session && session._space);
    },
    logMissileDebug() {},
    normalizeVector,
    roundNumber(value) {
      return value;
    },
    sessionMatchesIdentity(a, b) {
      return a === b;
    },
    summarizeRuntimeEntityForMissileDebug() {
      return {};
    },
    buildMissileSessionSnapshot() {
      return {};
    },
    toFiniteNumber,
    toInt,
    DEFAULT_RIGHT: { x: 1, y: 0, z: 0 },
    MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD: 1,
    MICHELLE_HELD_FUTURE_DESTINY_LEAD: 2,
    PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS: 1,
    MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD: 3,
  };
}

function createLagRuntime() {
  const captured = [];
  const ownerSession = {
    clientID: 1065450,
    characterID: 140000008,
    socket: {
      destroyed: false,
    },
    _space: {
      shipID: 991003010,
      lastSentDestinyStamp: 1775154450,
      lastSentDestinyRawDispatchStamp: 1775154447,
      lastSentDestinyWasOwnerCritical: true,
      lastSentDestinyOnlyStaleProjectedOwnerMissileLane: false,
      lastOwnerNonMissileCriticalStamp: 1775154450,
      lastOwnerNonMissileCriticalRawDispatchStamp: 1775154447,
      lastPilotCommandMovementStamp: 1775154450,
      lastPilotCommandMovementAnchorStamp: 1775154447,
      lastPilotCommandMovementRawDispatchStamp: 1775154447,
      lastPilotCommandDirection: { x: -0.9, y: 0.1, z: -0.3 },
      lastFreshAcquireLifecycleStamp: 1775154447,
      lastMissileLifecycleStamp: 1775154448,
      lastOwnerMissileLifecycleStamp: 1775154442,
      lastOwnerMissileLifecycleRawDispatchStamp: 1775154440,
      lastOwnerMissileFreshAcquireStamp: 1775154442,
      lastOwnerMissileFreshAcquireRawDispatchStamp: 1775154440,
    },
  };
  const entity = {
    itemID: 991003010,
    session: ownerSession,
  };
  const runtime = {
    pendingSubwarpMovementContracts: new Map(),
    dynamicEntities: new Map([[entity.itemID, entity]]),
    sessions: new Map([[ownerSession.clientID, ownerSession]]),
    getCurrentSimTimeMs() {
      return 1775154448513;
    },
    getCurrentPresentedSessionDestinyStamp() {
      return 1775154450;
    },
    getCurrentVisibleSessionDestinyStamp() {
      return 1775154448;
    },
    getCurrentSessionDestinyStamp() {
      return 1775154448;
    },
    getCurrentDestinyStamp() {
      return 1775154448;
    },
    getHistorySafeDestinyStamp() {
      return 1775154450;
    },
    getPendingHistorySafeSessionDestinyStamp(_session, authoredStamp, _now, minimumLead = 0) {
      return Math.max(
        toInt(authoredStamp, 0) >>> 0,
        (1775154448 + toInt(minimumLead, 0)) >>> 0,
      ) >>> 0;
    },
    filterMovementUpdatesForSession(_session, updates) {
      return updates;
    },
    hasActiveTickDestinyPresentationBatch() {
      return false;
    },
    sendDestinyUpdates(session, updates, _waitForBubble, options) {
      captured.push({
        session,
        updates,
        options,
      });
      return updates.reduce(
        (highestStamp, update) => Math.max(highestStamp, toInt(update && update.stamp, 0) >>> 0),
        0,
      ) >>> 0;
    },
  };
  return {
    runtime,
    ownerSession,
    entity,
    captured,
  };
}

function verifyLagQueuedOwnerGoto() {
  const { runtime, ownerSession, entity, captured } = createLagRuntime();
  const dispatch = createMovementContractDispatch(buildDeps());
  const queuedUpdate = {
    stamp: 1775154450,
    payload: ["GotoDirection", [entity.itemID, 0.1, -0.2, 1]],
  };
  const beforeGenericClamp = clampQueuedSubwarpUpdates({
    queuedUpdates: [queuedUpdate],
    visibleFloorStamp: 1775154449,
    presentedFloorStamp: 1775154450,
    projectedFloorStamp: 0,
  });
  const beforeStamp =
    toInt(beforeGenericClamp[0] && beforeGenericClamp[0].stamp, 0) >>> 0;

  dispatch.queueSubwarpMovementContract(
    runtime,
    entity,
    () => [queuedUpdate],
    {
      nowMs: runtime.getCurrentSimTimeMs(),
      scheduledStamp: 1775154450,
      ownerDirectEchoLeadOverride: 2,
    },
  );
  dispatch.flushPendingSubwarpMovementContracts(
    runtime,
    runtime.getCurrentSimTimeMs(),
  );

  assert.strictEqual(captured.length, 1);
  const afterStamp =
    toInt(captured[0].updates && captured[0].updates[0] && captured[0].updates[0].stamp, 0) >>> 0;

  assert.strictEqual(beforeStamp, 1775154450);
  assert.strictEqual(afterStamp, 1775154451);
  assert.strictEqual(
    toInt(ownerSession._space && ownerSession._space.lastPilotCommandMovementStamp, 0) >>> 0,
    1775154451,
  );

  return {
    beforeStamp,
    afterStamp,
    ownerStateAfter: {
      lastPilotCommandMovementStamp:
        toInt(ownerSession._space && ownerSession._space.lastPilotCommandMovementStamp, 0) >>> 0,
      lastPilotCommandMovementAnchorStamp:
        toInt(ownerSession._space && ownerSession._space.lastPilotCommandMovementAnchorStamp, 0) >>> 0,
      lastPilotCommandMovementRawDispatchStamp:
        toInt(ownerSession._space && ownerSession._space.lastPilotCommandMovementRawDispatchStamp, 0) >>> 0,
    },
  };
}

try {
  const snapshots = {
    lagQueuedOwnerGoto: verifyLagQueuedOwnerGoto(),
  };
  console.log(`${JSON.stringify(snapshots, null, 2)}\n`);
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
}
