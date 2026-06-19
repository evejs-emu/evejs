#!/usr/bin/env node

const assert = require("assert");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";
process.env.EVEJS_DISABLE_NPC_ANCHOR_RELEVANCE = "1";

const runtime = require("../src/space/runtime");
const {
  resolvePresentedSessionDestinyStamp,
} = require("../src/space/movement/movementSessionWindows");
const {
  MICHELLE_HELD_FUTURE_DESTINY_LEAD,
  MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD,
} = require("../src/space/movement/movementMichelleContract");

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
  const scene = runtime.ensureScene(30000143, {
    refreshStargates: false,
  });
  const prototype = Object.getPrototypeOf(scene);
  runtime._testing.clearScenes();
  return prototype;
}

function createSession(spaceOverrides = {}) {
  const notifications = [];
  const session = {
    clientID: 1065450,
    characterID: 140000002,
    socket: {
      destroyed: false,
    },
    _space: {
      initialStateSent: true,
      shipID: 991002587,
      simTimeMs: 1775143482744,
      simFileTime: "0",
      timeDilation: 1,
      lastVisibleDynamicDestinyStamp: 1775143482,
      lastFreshAcquireLifecycleStamp: 1775143481,
      lastMissileLifecycleStamp: 1775143483,
      lastMissileLifecycleRawDispatchStamp: 0,
      lastOwnerMissileLifecycleStamp: 0,
      lastOwnerMissileLifecycleAnchorStamp: 0,
      lastOwnerMissileFreshAcquireStamp: 0,
      lastOwnerMissileFreshAcquireAnchorStamp: 0,
      lastOwnerMissileFreshAcquireRawDispatchStamp: 0,
      lastOwnerMissileLifecycleRawDispatchStamp: 0,
      lastOwnerNonMissileCriticalStamp: 1775143484,
      lastOwnerNonMissileCriticalRawDispatchStamp: 1775143481,
      lastPilotCommandMovementStamp: 1775143484,
      lastPilotCommandMovementAnchorStamp: 1775143481,
      lastPilotCommandMovementRawDispatchStamp: 1775143481,
      lastSentDestinyStamp: 1775143484,
      lastSentDestinyRawDispatchStamp: 1775143481,
      lastSentDestinyOnlyStaleProjectedOwnerMissileLane: false,
      lastSentDestinyWasOwnerCritical: true,
      ...spaceOverrides,
    },
    sendNotification(name, target, payload) {
      notifications.push({ name, target, payload });
    },
  };
  return { session, notifications };
}

function createMockScene(config) {
  const currentRawDispatchStamp = toInt(config.currentRawDispatchStamp, 0) >>> 0;
  const currentSessionStamp = toInt(config.currentSessionStamp, 0) >>> 0;
  const currentVisibleStamp = toInt(config.currentVisibleStamp, 0) >>> 0;
  const currentImmediateStamp = toInt(config.currentImmediateStamp, 0) >>> 0;
  const historyFloorDestinyStamp =
    toInt(config.historyFloorDestinyStamp, 0) >>> 0;
  const rawSimTimeMs =
    toInt(config.rawSimTimeMs, currentRawDispatchStamp * 1000) >>> 0;

  return {
    systemID: 30000143,
    refreshSessionClockSnapshot() {},
    getCurrentSimTimeMs() {
      return rawSimTimeMs;
    },
    getCurrentDestinyStamp() {
      return currentRawDispatchStamp;
    },
    prepareDestinyUpdateForSession(_session, rawPayload) {
      return rawPayload;
    },
    getCurrentSessionDestinyStamp() {
      return currentSessionStamp;
    },
    getCurrentVisibleSessionDestinyStamp() {
      return currentVisibleStamp;
    },
    getCurrentPresentedSessionDestinyStamp(session, _rawSimTimeMs, maximumFutureLead) {
      return resolvePresentedSessionDestinyStamp({
        currentVisibleStamp,
        hasSessionSpace: Boolean(session && session._space),
        lastSentStamp:
          session && session._space
            ? (toInt(session._space.lastSentDestinyStamp, currentVisibleStamp) >>> 0)
            : currentVisibleStamp,
        maximumFutureLead,
        defaultMaximumFutureLead: MICHELLE_HELD_FUTURE_DESTINY_LEAD,
        maximumTrustedLead:
          MICHELLE_HELD_FUTURE_DESTINY_LEAD +
          MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD,
      });
    },
    getImmediateDestinyStampForSession() {
      return currentImmediateStamp;
    },
    getHistoryFloorDestinyStampForSession() {
      return historyFloorDestinyStamp;
    },
    getSessionClockOffsetMs() {
      return 0;
    },
    translateDestinyStampForSession(_session, rawStamp) {
      return toInt(rawStamp, 0) >>> 0;
    },
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

function main() {
  const proto = buildScenePrototype();
  const { session, notifications } = createSession();
  const scene = createMockScene({
    currentRawDispatchStamp: 1775143482,
    currentSessionStamp: 1775143482,
    currentVisibleStamp: 1775143482,
    currentImmediateStamp: 1775143481,
    historyFloorDestinyStamp: 1775143405,
    rawSimTimeMs: 1775143482744,
  });

  proto.sendDestinyUpdates.call(
    scene,
    session,
    [{
      stamp: 1775143485,
      payload: ["Orbit", [980000000147, 991002587, 12000]],
    }],
    false,
    {
      translateStamps: false,
    },
  );

  assert.strictEqual(notifications.length, 1);
  const emittedStamps = extractEmittedStamps(notifications[0]);
  assert.deepStrictEqual([...new Set(emittedStamps)], [1775143485]);

  console.log(JSON.stringify({
    scenario: "badjoltingObserverOrbit",
    liveBefore: {
      authoredStamp: 1775143485,
      emittedStamp: 1775143484,
      currentPresentedStamp: 1775143484,
    },
    after: {
      emittedStamp: emittedStamps[0],
      lastSentDestinyStamp: session._space.lastSentDestinyStamp,
      lastSentDestinyRawDispatchStamp: session._space.lastSentDestinyRawDispatchStamp,
    },
  }, null, 2));
}

main();
