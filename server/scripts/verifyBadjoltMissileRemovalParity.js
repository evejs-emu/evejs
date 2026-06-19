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

function createSession() {
  const notifications = [];
  const session = {
    clientID: 1065450,
    characterID: 140000002,
    socket: {
      destroyed: false,
    },
    _space: {
      initialStateSent: true,
      shipID: 991002978,
      simTimeMs: 1775082707963,
      simFileTime: "0",
      timeDilation: 1,
      lastVisibleDynamicDestinyStamp: 1775082680,
      lastSentDestinyStamp: 1775082712,
      lastSentDestinyRawDispatchStamp: 1775082707,
      lastSentDestinyOnlyStaleProjectedOwnerMissileLane: false,
      lastSentDestinyWasOwnerCritical: true,
      lastOwnerNonMissileCriticalStamp: 1775082712,
      lastOwnerNonMissileCriticalRawDispatchStamp: 1775082707,
      lastPilotCommandMovementStamp: 1775082712,
      lastPilotCommandMovementAnchorStamp: 1775082707,
      lastPilotCommandMovementRawDispatchStamp: 1775082707,
      lastFreshAcquireLifecycleStamp: 1775082709,
      lastMissileLifecycleStamp: 1775082711,
      lastMissileLifecycleRawDispatchStamp: 1775082707,
      lastOwnerMissileLifecycleStamp: 0,
      lastOwnerMissileLifecycleAnchorStamp: 0,
      lastOwnerMissileFreshAcquireStamp: 0,
      lastOwnerMissileFreshAcquireAnchorStamp: 0,
      lastOwnerMissileFreshAcquireRawDispatchStamp: 0,
      lastOwnerMissileLifecycleRawDispatchStamp: 0,
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

function createScene(proto) {
  return Object.assign(Object.create(proto), {
    systemID: 30000142,
    getCurrentSimTimeMs() {
      return 1775082707963;
    },
    getCurrentDestinyStamp() {
      return 1775082707;
    },
    getCurrentSessionDestinyStamp() {
      return 1775082707;
    },
    getCurrentVisibleSessionDestinyStamp() {
      return 1775082707;
    },
    getCurrentPresentedSessionDestinyStamp() {
      // Match the live badjolt window after the owner-critical lane moved too
      // far ahead to be considered "presented" by the narrow held-future helper.
      return 1775082707;
    },
    getImmediateDestinyStampForSession() {
      return 1775082706;
    },
    getHistoryFloorDestinyStampForSession() {
      return 1775082680;
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

function main() {
  const proto = buildScenePrototype();
  const { session, notifications } = createSession();
  const scene = createScene(proto);

  const removeIDs = [
    980000000176,
    980000000177,
    980000000178,
    980000000179,
    980000000180,
    980000000181,
    980000000182,
    980000000183,
    980000000184,
    980000000185,
    980000000186,
    980000000187,
    980000000188,
    980000000189,
  ];

  const updates = removeIDs.map((entityID) => ({
    stamp: 1775082708,
    missileLifecycleGroup: true,
    ownerMissileLifecycleGroup: false,
    freshAcquireLifecycleGroup: false,
    payload: ["RemoveBalls", [{ entityCount: 1, entityIDs: [entityID] }]],
  }));

  scene.sendDestinyUpdates(session, updates, false, {
    translateStamps: false,
  });

  assert.strictEqual(notifications.length, 1);
  const emittedStamps = extractEmittedStamps(notifications[0]);
  assert.strictEqual(emittedStamps.length, removeIDs.length);

  const uniqueEmittedStamps = [...new Set(emittedStamps)];
  assert.deepStrictEqual(uniqueEmittedStamps, [1775082713]);
  assert.strictEqual(session._space.lastSentDestinyStamp, 1775082713);
  assert.strictEqual(session._space.lastSentDestinyRawDispatchStamp, 1775082707);

  console.log(JSON.stringify({
    scenario: "badjoltObserverMissileRemoval",
    liveBefore: {
      previousLastSentDestinyStamp: 1775082712,
      emittedStamp: 1775082709,
      removeCount: removeIDs.length,
    },
    after: {
      emittedStamp: uniqueEmittedStamps[0],
      removeCount: emittedStamps.length,
      lastSentDestinyStamp: session._space.lastSentDestinyStamp,
      lastSentDestinyRawDispatchStamp: session._space.lastSentDestinyRawDispatchStamp,
    },
  }, null, 2));
}

main();
