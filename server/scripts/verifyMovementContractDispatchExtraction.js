#!/usr/bin/env node

const assert = require("assert");

const {
  createMovementContractDispatch,
} = require("../src/space/movement/dispatch/movementContractDispatch");

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

function buildDeps(options = {}) {
  return {
    cloneVector(vector) {
      return vector && typeof vector === "object" ? { ...vector } : vector;
    },
    isReadyForDestiny(session) {
      return Boolean(session && session._space);
    },
    logMissileDebug() {},
    normalizeVector(vector) {
      return vector;
    },
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
    MICHELLE_HELD_FUTURE_DESTINY_LEAD: toInt(
      options.MICHELLE_HELD_FUTURE_DESTINY_LEAD,
      1,
    ),
    PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS: 1,
    MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD: toInt(
      options.MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD,
      1,
    ),
  };
}

function createRuntime(useTickBatch) {
  const captured = [];
  const ownerSession = {
    clientID: 1065450,
    characterID: 140000002,
    socket: {
      destroyed: false,
    },
    _space: {
      shipID: 990112367,
      lastOwnerNonMissileCriticalStamp: 0,
      lastOwnerNonMissileCriticalRawDispatchStamp: 0,
      lastPilotCommandMovementStamp: 0,
      lastPilotCommandMovementRawDispatchStamp: 0,
      lastPilotCommandMovementAnchorStamp: 0,
      lastPilotCommandDirection: null,
    },
  };
  const entity = {
    itemID: 990112367,
    session: ownerSession,
  };
  const runtime = {
    pendingSubwarpMovementContracts: new Map(),
    dynamicEntities: new Map([[entity.itemID, entity]]),
    sessions: new Map([[ownerSession.clientID, ownerSession]]),
    getCurrentSimTimeMs() {
      return 1775000199803;
    },
    getCurrentPresentedSessionDestinyStamp() {
      return 1775000200;
    },
    getCurrentVisibleSessionDestinyStamp() {
      return 1775000199;
    },
    getCurrentSessionDestinyStamp() {
      return 1775000199;
    },
    getCurrentDestinyStamp() {
      return 1775000199;
    },
    getHistorySafeDestinyStamp() {
      return 1775000202;
    },
    filterMovementUpdatesForSession(_session, updates) {
      return updates;
    },
    hasActiveTickDestinyPresentationBatch() {
      return useTickBatch;
    },
    queueTickDestinyPresentationUpdates(session, updates, options) {
      captured.push({
        kind: "queue",
        session,
        updates,
        options,
      });
    },
    sendDestinyUpdates(session, updates, _waitForBubble, options) {
      captured.push({
        kind: "send",
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

function createObserverQueuedOrbitRuntime() {
  const captured = [];
  const observerSession = {
    clientID: 1065450,
    characterID: 140000002,
    socket: {
      destroyed: false,
    },
    _space: {
      shipID: 990112367,
      lastSentDestinyStamp: 1775004711,
      lastSentDestinyRawDispatchStamp: 1775004710,
    },
  };
  const npcEntity = {
    itemID: 980000000100,
    session: null,
  };
  const runtime = {
    pendingSubwarpMovementContracts: new Map(),
    dynamicEntities: new Map([[npcEntity.itemID, npcEntity]]),
    sessions: new Map([[observerSession.clientID, observerSession]]),
    getCurrentSimTimeMs() {
      return 1775004711202;
    },
    getCurrentPresentedSessionDestinyStamp() {
      return 1775004711;
    },
    getCurrentVisibleSessionDestinyStamp() {
      return 1775004711;
    },
    getCurrentSessionDestinyStamp() {
      return 1775004711;
    },
    getCurrentDestinyStamp() {
      return 1775004711;
    },
    getHistorySafeDestinyStamp() {
      return 1775004713;
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
    npcEntity,
    observerSession,
    captured,
  };
}

function createObserverSameRawOwnerCriticalQueuedGotoRuntime() {
  const captured = [];
  const observerSession = {
    clientID: 1065450,
    characterID: 140000002,
    socket: {
      destroyed: false,
    },
    _space: {
      shipID: 990112727,
      lastSentDestinyStamp: 1775041677,
      lastSentDestinyRawDispatchStamp: 1775041671,
      lastSentDestinyWasOwnerCritical: true,
    },
  };
  const npcEntity = {
    itemID: 980000000112,
    session: null,
  };
  const runtime = {
    pendingSubwarpMovementContracts: new Map(),
    dynamicEntities: new Map([[npcEntity.itemID, npcEntity]]),
    sessions: new Map([[observerSession.clientID, observerSession]]),
    getCurrentSimTimeMs() {
      return 1775041671712;
    },
    getCurrentPresentedSessionDestinyStamp() {
      return 1775041671;
    },
    getCurrentVisibleSessionDestinyStamp() {
      return 1775041671;
    },
    getCurrentSessionDestinyStamp() {
      return 1775041671;
    },
    getCurrentDestinyStamp() {
      return 1775041671;
    },
    getHistorySafeDestinyStamp() {
      return 1775041673;
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
    npcEntity,
    observerSession,
    captured,
  };
}

function createObserverSameRawOwnerCriticalQueuedOrbitRuntime() {
  const captured = [];
  const observerSession = {
    clientID: 1065450,
    characterID: 140000002,
    socket: {
      destroyed: false,
    },
    _space: {
      shipID: 991000547,
      lastSentDestinyStamp: 1775040814,
      lastSentDestinyRawDispatchStamp: 1775040812,
      lastSentDestinyWasOwnerCritical: true,
    },
  };
  const npcEntity = {
    itemID: 980000000107,
    session: null,
  };
  const runtime = {
    pendingSubwarpMovementContracts: new Map(),
    dynamicEntities: new Map([[npcEntity.itemID, npcEntity]]),
    sessions: new Map([[observerSession.clientID, observerSession]]),
    getCurrentSimTimeMs() {
      return 1775040812968;
    },
    getCurrentPresentedSessionDestinyStamp() {
      return 1775040813;
    },
    getCurrentVisibleSessionDestinyStamp() {
      return 1775040813;
    },
    getCurrentSessionDestinyStamp() {
      return 1775040813;
    },
    getCurrentDestinyStamp() {
      return 1775040812;
    },
    getHistorySafeDestinyStamp() {
      return 1775040814;
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
    npcEntity,
    observerSession,
    captured,
  };
}

function captureQueuedOwnerMovementSendOptions(useTickBatch) {
  const { runtime, entity, ownerSession, captured } = createRuntime(useTickBatch);
  const dispatch = createMovementContractDispatch(buildDeps());
  const scheduledStamp = 1775000202;

  dispatch.queueSubwarpMovementContract(
    runtime,
    entity,
    (stamp) => [
      {
        stamp,
        payload: ["GotoDirection", [entity.itemID, 0.9, -0.3, 0.3]],
      },
    ],
    {
      nowMs: runtime.getCurrentSimTimeMs(),
      scheduledStamp,
    },
  );

  dispatch.flushPendingSubwarpMovementContracts(runtime, runtime.getCurrentSimTimeMs());

  assert.strictEqual(
    captured.length,
    1,
    `Expected one captured owner movement send for useTickBatch=${useTickBatch}.`,
  );

  const capturedEntry = captured[0];
  const sendOptions =
    capturedEntry.kind === "queue"
      ? capturedEntry.options && capturedEntry.options.sendOptions
      : capturedEntry.options;

  return {
    useTickBatch,
    deliveryKind: capturedEntry.kind,
    sentStamp: toInt(capturedEntry.updates && capturedEntry.updates[0] && capturedEntry.updates[0].stamp, 0) >>> 0,
    sendOptions,
    ownerStateAfter: {
      lastOwnerNonMissileCriticalStamp:
        toInt(ownerSession._space && ownerSession._space.lastOwnerNonMissileCriticalStamp, 0) >>> 0,
      lastOwnerNonMissileCriticalRawDispatchStamp:
        toInt(ownerSession._space && ownerSession._space.lastOwnerNonMissileCriticalRawDispatchStamp, 0) >>> 0,
      lastPilotCommandMovementStamp:
        toInt(ownerSession._space && ownerSession._space.lastPilotCommandMovementStamp, 0) >>> 0,
      lastPilotCommandMovementRawDispatchStamp:
        toInt(ownerSession._space && ownerSession._space.lastPilotCommandMovementRawDispatchStamp, 0) >>> 0,
    },
  };
}

function verifyQueuedOwnerMovementContract() {
  const directFlush = captureQueuedOwnerMovementSendOptions(false);
  const tickBatchFlush = captureQueuedOwnerMovementSendOptions(true);
  const snapshots = [directFlush, tickBatchFlush];

  for (const snapshot of snapshots) {
    assert.strictEqual(
      snapshot.sentStamp,
      1775000202,
      `Expected queued owner movement to stay on stamp 1775000202 for ${snapshot.deliveryKind}.`,
    );
    assert.strictEqual(
      snapshot.sendOptions && snapshot.sendOptions.translateStamps,
      false,
      `Expected translateStamps=false for ${snapshot.deliveryKind}.`,
    );
    assert.strictEqual(
      snapshot.sendOptions && snapshot.sendOptions.skipOwnerMonotonicRestamp,
      true,
      `Expected skipOwnerMonotonicRestamp=true for ${snapshot.deliveryKind}.`,
    );
  }

  return {
    directFlush,
    tickBatchFlush,
  };
}

function verifyQueuedObserverOrbitHeldWindow() {
  const { runtime, npcEntity, observerSession, captured } =
    createObserverQueuedOrbitRuntime();
  const dispatch = createMovementContractDispatch(buildDeps({
    MICHELLE_HELD_FUTURE_DESTINY_LEAD: 2,
    MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD: 3,
  }));

  dispatch.queueSubwarpMovementContract(
    runtime,
    npcEntity,
    (stamp) => [
      {
        stamp,
        payload: ["Orbit", [npcEntity.itemID, observerSession._space.shipID, 3000]],
      },
    ],
    {
      nowMs: runtime.getCurrentSimTimeMs(),
    },
  );

  dispatch.flushPendingSubwarpMovementContracts(runtime, runtime.getCurrentSimTimeMs());

  assert.strictEqual(
    captured.length,
    1,
    "Expected one observer-visible queued orbit send.",
  );

  const sentStamp =
    toInt(captured[0].updates && captured[0].updates[0] && captured[0].updates[0].stamp, 0) >>> 0;
  assert.strictEqual(
    sentStamp,
    1775004713,
    "Expected queued observer Orbit to stay inside Michelle's held-future window.",
  );

  return {
    currentPresentedStamp: 1775004711,
    currentVisibleStamp: 1775004711,
    sentStamp,
    sendOptions: captured[0].options,
  };
}

function verifyQueuedObserverSameRawOwnerCriticalClearFloor() {
  const { runtime, npcEntity, observerSession, captured } =
    createObserverSameRawOwnerCriticalQueuedGotoRuntime();
  const dispatch = createMovementContractDispatch(buildDeps({
    MICHELLE_HELD_FUTURE_DESTINY_LEAD: 2,
    MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD: 3,
  }));

  dispatch.queueSubwarpMovementContract(
    runtime,
    npcEntity,
    (stamp) => [
      {
        stamp,
        payload: ["GotoDirection", [npcEntity.itemID, -0.6, -0.6, 0.5]],
      },
    ],
    {
      nowMs: runtime.getCurrentSimTimeMs(),
    },
  );

  dispatch.flushPendingSubwarpMovementContracts(runtime, runtime.getCurrentSimTimeMs());

  assert.strictEqual(
    captured.length,
    1,
    "Expected one observer-visible queued GotoDirection send.",
  );

  const sentStamp =
    toInt(captured[0].updates && captured[0].updates[0] && captured[0].updates[0].stamp, 0) >>> 0;
  assert.strictEqual(
    sentStamp,
    1775041678,
    "Expected queued observer movement to clear the same-raw owner-critical future lane.",
  );

  return {
    currentPresentedStamp: 1775041671,
    lastSentDestinyStamp: toInt(observerSession._space.lastSentDestinyStamp, 0) >>> 0,
    lastSentDestinyRawDispatchStamp:
      toInt(observerSession._space.lastSentDestinyRawDispatchStamp, 0) >>> 0,
    sentStamp,
    sendOptions: captured[0].options,
  };
}

function verifyQueuedObserverSameRawOwnerCriticalOrbitClearFloor() {
  const { runtime, npcEntity, observerSession, captured } =
    createObserverSameRawOwnerCriticalQueuedOrbitRuntime();
  const dispatch = createMovementContractDispatch(buildDeps({
    MICHELLE_HELD_FUTURE_DESTINY_LEAD: 2,
    MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD: 3,
  }));

  dispatch.queueSubwarpMovementContract(
    runtime,
    npcEntity,
    (stamp) => [
      {
        stamp,
        payload: ["Orbit", [npcEntity.itemID, observerSession._space.shipID, 3000]],
      },
    ],
    {
      nowMs: runtime.getCurrentSimTimeMs(),
    },
  );

  dispatch.flushPendingSubwarpMovementContracts(runtime, runtime.getCurrentSimTimeMs());

  assert.strictEqual(
    captured.length,
    1,
    "Expected one observer-visible queued Orbit send.",
  );

  const sentStamp =
    toInt(captured[0].updates && captured[0].updates[0] && captured[0].updates[0].stamp, 0) >>> 0;
  assert.strictEqual(
    sentStamp,
    1775040815,
    "Expected queued observer Orbit to clear the same-raw owner-critical future lane.",
  );

  return {
    currentPresentedStamp: 1775040813,
    lastSentDestinyStamp: toInt(observerSession._space.lastSentDestinyStamp, 0) >>> 0,
    lastSentDestinyRawDispatchStamp:
      toInt(observerSession._space.lastSentDestinyRawDispatchStamp, 0) >>> 0,
    sentStamp,
    sendOptions: captured[0].options,
  };
}

try {
  const snapshots = {
    queuedOwnerMovement: verifyQueuedOwnerMovementContract(),
    queuedObserverOrbitHeldWindow: verifyQueuedObserverOrbitHeldWindow(),
    queuedObserverSameRawOwnerCriticalClearFloor:
      verifyQueuedObserverSameRawOwnerCriticalClearFloor(),
    queuedObserverSameRawOwnerCriticalOrbitClearFloor:
      verifyQueuedObserverSameRawOwnerCriticalOrbitClearFloor(),
  };
  console.log(JSON.stringify(snapshots, null, 2));
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
}
