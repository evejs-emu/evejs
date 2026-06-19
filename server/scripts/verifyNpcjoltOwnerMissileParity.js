#!/usr/bin/env node

const assert = require("assert");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";
process.env.EVEJS_DISABLE_NPC_ANCHOR_RELEVANCE = "1";

const runtime = require("../src/space/runtime");

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.trunc(numeric);
  }
  const fallbackNumeric = Number(fallback);
  return Number.isFinite(fallbackNumeric) ? Math.trunc(fallbackNumeric) : 0;
}

function buildScenePrototype() {
  runtime._testing.clearScenes();
  const scene = runtime.ensureScene(30000142, {
    refreshStargates: false,
  });
  const prototype = Object.getPrototypeOf(scene);
  runtime._testing.clearScenes();
  return prototype;
}

function createScene(proto, config) {
  return Object.assign(Object.create(proto), {
    systemID: 30002187,
    getCurrentSimTimeMs() {
      return config.nowMs;
    },
    getCurrentDestinyStamp() {
      return config.currentSessionStamp;
    },
    getCurrentSessionDestinyStamp() {
      return config.currentSessionStamp;
    },
    getCurrentVisibleSessionDestinyStamp() {
      return config.currentVisibleStamp;
    },
    getCurrentPresentedSessionDestinyStamp() {
      return config.currentPresentedStamp;
    },
    getImmediateDestinyStampForSession() {
      return config.currentImmediateStamp;
    },
    getHistoryFloorDestinyStampForSession() {
      return 1775136940;
    },
    getSessionClockOffsetMs() {
      return 0;
    },
    translateDestinyStampForSession(_session, rawStamp) {
      return toInt(rawStamp, 0) >>> 0;
    },
    refreshSessionClockSnapshot() {},
  });
}

function createSession(spaceOverrides = {}) {
  const notifications = [];
  const session = {
    clientID: 1065450,
    characterID: 140000008,
    socket: {
      destroyed: false,
    },
    _space: {
      initialStateSent: true,
      shipID: 991002587,
      simTimeMs: 0,
      simFileTime: "0",
      timeDilation: 1,
      lastVisibleDynamicDestinyStamp: 1775136940,
      ...spaceOverrides,
    },
    sendNotification(name, target, payload) {
      notifications.push({ name, target, payload });
    },
  };
  return {
    session,
    notifications,
  };
}

function extractEmittedStamps(notification) {
  if (!notification || notification.name !== "DoDestinyUpdate") {
    return [];
  }
  const payloadList =
    Array.isArray(notification.payload) &&
    notification.payload[0] &&
    notification.payload[0].type === "list"
      ? notification.payload[0].items
      : [];
  return Array.isArray(payloadList)
    ? payloadList.map((entry) => toInt(entry && entry[0], 0) >>> 0)
    : [];
}

function verifyOwnerFreshAcquire(proto) {
  const config = {
    nowMs: 1775137095209,
    currentSessionStamp: 1775137095,
    currentVisibleStamp: 1775137095,
    currentPresentedStamp: 1775137096,
    currentImmediateStamp: 1775137094,
  };
  const { session, notifications } = createSession({
    lastSentDestinyStamp: 1775137096,
    lastSentDestinyRawDispatchStamp: 1775137094,
    lastSentDestinyOnlyStaleProjectedOwnerMissileLane: false,
    lastSentDestinyWasOwnerCritical: true,
    lastOwnerNonMissileCriticalStamp: 1775137097,
    lastOwnerNonMissileCriticalRawDispatchStamp: 1775137095,
    lastPilotCommandMovementStamp: 1775137097,
    lastPilotCommandMovementAnchorStamp: 1775137095,
    lastPilotCommandMovementRawDispatchStamp: 1775137095,
    lastFreshAcquireLifecycleStamp: 1775137096,
    lastMissileLifecycleStamp: 1775137096,
    lastOwnerMissileLifecycleStamp: 1775137096,
    lastOwnerMissileLifecycleAnchorStamp: 1775137094,
    lastOwnerMissileFreshAcquireStamp: 1775137096,
    lastOwnerMissileFreshAcquireAnchorStamp: 1775137094,
    lastOwnerMissileFreshAcquireRawDispatchStamp: 1775137094,
    lastOwnerMissileLifecycleRawDispatchStamp: 1775137094,
  });
  const scene = createScene(proto, config);

  scene.sendDestinyUpdates(session, [
    {
      stamp: 1775137096,
      freshAcquireLifecycleGroup: true,
      missileLifecycleGroup: true,
      ownerMissileLifecycleGroup: true,
      payload: ["AddBalls2", [{ batchIndex: 0 }]],
    },
  ], false, {
    translateStamps: false,
    allowAdjacentRawFreshAcquireLaneReuse: false,
    preservePayloadStateStamp: false,
    skipOwnerMonotonicRestampWhenPreviousNotOwnerCritical: true,
    minimumHistoryLeadFloor: 2,
    minimumLeadFromCurrentHistory: 2,
    maximumLeadFromCurrentHistory: 2,
    maximumHistorySafeLeadOverride: 2,
    historyLeadUsesImmediateSessionStamp: true,
    avoidCurrentHistoryInsertion: true,
  });
  scene.flushDirectDestinyNotificationBatch();

  assert.strictEqual(notifications.length, 1);
  const emittedStamps = extractEmittedStamps(notifications[0]);
  assert.deepStrictEqual(emittedStamps, [1775137097]);
  assert.strictEqual(session._space.lastSentDestinyStamp, 1775137097);

  return {
    liveBefore: {
      emittedStamp: 1775137096,
      currentPresentedStamp: config.currentPresentedStamp,
    },
    after: {
      emittedStamp: emittedStamps[0],
      lastSentDestinyStamp: session._space.lastSentDestinyStamp,
    },
  };
}

function verifyOwnerTeardown(proto) {
  const config = {
    nowMs: 1775137051318,
    currentSessionStamp: 1775137051,
    currentVisibleStamp: 1775137051,
    currentPresentedStamp: 1775137052,
    currentImmediateStamp: 1775137050,
  };
  const { session, notifications } = createSession({
    lastSentDestinyStamp: 1775137052,
    lastSentDestinyRawDispatchStamp: 1775137051,
    lastSentDestinyOnlyStaleProjectedOwnerMissileLane: false,
    lastSentDestinyWasOwnerCritical: true,
    lastOwnerNonMissileCriticalStamp: 1775137047,
    lastOwnerNonMissileCriticalRawDispatchStamp: 1775137045,
    lastPilotCommandMovementStamp: 1775137047,
    lastPilotCommandMovementAnchorStamp: 1775137045,
    lastPilotCommandMovementRawDispatchStamp: 1775137045,
    lastFreshAcquireLifecycleStamp: 1775137052,
    lastMissileLifecycleStamp: 1775137052,
    lastOwnerMissileLifecycleStamp: 1775137052,
    lastOwnerMissileLifecycleAnchorStamp: 1775137051,
    lastOwnerMissileFreshAcquireStamp: 1775137052,
    lastOwnerMissileFreshAcquireAnchorStamp: 1775137051,
    lastOwnerMissileFreshAcquireRawDispatchStamp: 1775137051,
    lastOwnerMissileLifecycleRawDispatchStamp: 1775137051,
  });
  const scene = createScene(proto, config);

  scene.sendDestinyUpdates(session, [
    {
      stamp: 1775137051,
      freshAcquireLifecycleGroup: false,
      missileLifecycleGroup: true,
      ownerMissileLifecycleGroup: true,
      payload: ["TerminalPlayDestructionEffect", [980000000156, 3]],
    },
    {
      stamp: 1775137051,
      freshAcquireLifecycleGroup: false,
      missileLifecycleGroup: true,
      ownerMissileLifecycleGroup: true,
      payload: ["RemoveBalls", [{ entityCount: 1, entityIDs: [980000000156] }]],
    },
  ], false, {
    translateStamps: false,
    minimumHistoryLeadFloor: 2,
    minimumLeadFromCurrentHistory: 2,
    maximumLeadFromCurrentHistory: 2,
    maximumHistorySafeLeadOverride: 2,
    historyLeadUsesImmediateSessionStamp: true,
    avoidCurrentHistoryInsertion: true,
  });
  scene.flushDirectDestinyNotificationBatch();

  assert.strictEqual(notifications.length, 1);
  const emittedStamps = extractEmittedStamps(notifications[0]);
  assert.deepStrictEqual(emittedStamps, [1775137053, 1775137053]);
  assert.strictEqual(session._space.lastSentDestinyStamp, 1775137053);

  return {
    liveBefore: {
      emittedStamp: 1775137051,
      currentPresentedStamp: config.currentPresentedStamp,
    },
    after: {
      emittedStamp: emittedStamps[0],
      emittedCount: emittedStamps.length,
      lastSentDestinyStamp: session._space.lastSentDestinyStamp,
    },
  };
}

function verifyHelloSameRawNonCriticalAdvance(proto) {
  const config = {
    nowMs: 1775141964822,
    currentSessionStamp: 1775141964,
    currentVisibleStamp: 1775141964,
    currentPresentedStamp: 1775141966,
    currentImmediateStamp: 1775141963,
  };
  const { session, notifications } = createSession({
    lastSentDestinyStamp: 1775141966,
    lastSentDestinyRawDispatchStamp: 1775141964,
    lastSentDestinyOnlyStaleProjectedOwnerMissileLane: false,
    lastSentDestinyWasOwnerCritical: false,
    lastOwnerNonMissileCriticalStamp: 1775141959,
    lastOwnerNonMissileCriticalRawDispatchStamp: 1775141957,
    lastPilotCommandMovementStamp: 1775141959,
    lastPilotCommandMovementAnchorStamp: 1775141957,
    lastPilotCommandMovementRawDispatchStamp: 1775141957,
    lastFreshAcquireLifecycleStamp: 1775141965,
    lastMissileLifecycleStamp: 1775141965,
    lastOwnerMissileLifecycleStamp: 1775141965,
    lastOwnerMissileLifecycleAnchorStamp: 1775141963,
    lastOwnerMissileFreshAcquireStamp: 1775141965,
    lastOwnerMissileFreshAcquireAnchorStamp: 1775141963,
    lastOwnerMissileFreshAcquireRawDispatchStamp: 1775141963,
    lastOwnerMissileLifecycleRawDispatchStamp: 1775141963,
  });
  const scene = createScene(proto, config);

  scene.sendDestinyUpdates(session, [
    {
      stamp: 1775141964,
      freshAcquireLifecycleGroup: true,
      missileLifecycleGroup: true,
      ownerMissileLifecycleGroup: true,
      payload: ["AddBalls2", [{ batchIndex: 0 }]],
    },
  ], false, {
    translateStamps: false,
    allowAdjacentRawFreshAcquireLaneReuse: false,
    preservePayloadStateStamp: false,
    skipOwnerMonotonicRestampWhenPreviousNotOwnerCritical: true,
    minimumHistoryLeadFloor: 2,
    minimumLeadFromCurrentHistory: 2,
    maximumLeadFromCurrentHistory: 2,
    maximumHistorySafeLeadOverride: 2,
    historyLeadUsesImmediateSessionStamp: true,
    avoidCurrentHistoryInsertion: true,
  });
  scene.flushDirectDestinyNotificationBatch();

  assert.strictEqual(notifications.length, 1);
  const emittedStamps = extractEmittedStamps(notifications[0]);
  assert.deepStrictEqual(emittedStamps, [1775141966]);
  assert.strictEqual(session._space.lastSentDestinyStamp, 1775141966);

  return {
    liveBefore: {
      emittedStamp: 1775141965,
      currentPresentedStamp: config.currentPresentedStamp,
      previousLastSentDestinyStamp: 1775141966,
      previousLastSentDestinyWasOwnerCritical: false,
    },
    after: {
      emittedStamp: emittedStamps[0],
      lastSentDestinyStamp: session._space.lastSentDestinyStamp,
    },
  };
}

function main() {
  const proto = buildScenePrototype();
  const ownerFreshAcquire = verifyOwnerFreshAcquire(proto);
  const ownerTeardown = verifyOwnerTeardown(proto);
  const helloSameRawNonCriticalAdvance =
    verifyHelloSameRawNonCriticalAdvance(proto);

  console.log(JSON.stringify({
    ownerFreshAcquire,
    ownerTeardown,
    helloSameRawNonCriticalAdvance,
  }, null, 2));
}

main();
