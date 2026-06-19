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
  const scene = runtime.ensureScene(30000140, {
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
      shipID: 991002978,
      simTimeMs: 1775127678000,
      simFileTime: "0",
      timeDilation: 1,
      lastVisibleDynamicDestinyStamp: 1775127678,
      lastFreshAcquireLifecycleStamp: 0,
      lastMissileLifecycleStamp: 0,
      lastMissileLifecycleRawDispatchStamp: 0,
      lastOwnerMissileLifecycleStamp: 0,
      lastOwnerMissileLifecycleAnchorStamp: 0,
      lastOwnerMissileFreshAcquireStamp: 0,
      lastOwnerMissileFreshAcquireAnchorStamp: 0,
      lastOwnerMissileFreshAcquireRawDispatchStamp: 0,
      lastOwnerMissileLifecycleRawDispatchStamp: 0,
      lastOwnerNonMissileCriticalStamp: 0,
      lastOwnerNonMissileCriticalRawDispatchStamp: 0,
      lastPilotCommandMovementStamp: 0,
      lastPilotCommandMovementAnchorStamp: 0,
      lastPilotCommandMovementRawDispatchStamp: 0,
      lastSentDestinyStamp: 0,
      lastSentDestinyRawDispatchStamp: 0,
      lastSentDestinyOnlyStaleProjectedOwnerMissileLane: false,
      lastSentDestinyWasOwnerCritical: false,
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
    systemID: 30000140,
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

function sendAndExtract(proto, scene, session, updates, options = {}) {
  const startIndex = session.__notifications.length;
  proto.sendDestinyUpdates.call(
    scene,
    session,
    updates,
    false,
    {
      translateStamps: false,
      ...options,
    },
  );
  const newNotifications = session.__notifications.slice(startIndex);
  return newNotifications.flatMap(extractEmittedStamps);
}

function verifyJoltsLateObserverRemoveBalls(proto) {
  const { session, notifications } = createSession({
    simTimeMs: 1775127678000,
    lastVisibleDynamicDestinyStamp: 1775127678,
    lastSentDestinyStamp: 1775127680,
    lastSentDestinyRawDispatchStamp: 1775127677,
    lastSentDestinyWasOwnerCritical: false,
    lastOwnerNonMissileCriticalStamp: 1775127680,
    lastOwnerNonMissileCriticalRawDispatchStamp: 1775127677,
    lastPilotCommandMovementStamp: 1775127680,
    lastPilotCommandMovementAnchorStamp: 1775127677,
    lastPilotCommandMovementRawDispatchStamp: 1775127677,
  });
  session.__notifications = notifications;
  const scene = createMockScene({
    currentRawDispatchStamp: 1775127678,
    currentSessionStamp: 1775127678,
    currentVisibleStamp: 1775127678,
    currentImmediateStamp: 1775127677,
    historyFloorDestinyStamp: 1775127677,
    rawSimTimeMs: 1775127678000,
  });

  const emitted = sendAndExtract(proto, scene, session, [{
    stamp: 1775127681,
    missileLifecycleGroup: true,
    ownerMissileLifecycleGroup: false,
    freshAcquireLifecycleGroup: false,
    payload: ["RemoveBalls", [{ entityCount: 1, entityIDs: [980000000179] }]],
  }]);

  const uniqueEmittedStamps = [...new Set(emitted)];
  assert.deepStrictEqual(uniqueEmittedStamps, [1775127682]);
  return {
    liveBefore: 1775127681,
    after: uniqueEmittedStamps[0],
  };
}

function verifyNonTargetedPropGuard(proto) {
  const { session, notifications } = createSession({
    simTimeMs: 1775127678000,
    lastVisibleDynamicDestinyStamp: 1775127678,
    lastSentDestinyStamp: 1775127680,
    lastSentDestinyRawDispatchStamp: 1775127677,
    lastSentDestinyWasOwnerCritical: false,
    lastOwnerNonMissileCriticalStamp: 1775127680,
    lastOwnerNonMissileCriticalRawDispatchStamp: 1775127677,
    lastPilotCommandMovementStamp: 1775127680,
    lastPilotCommandMovementAnchorStamp: 1775127677,
    lastPilotCommandMovementRawDispatchStamp: 1775127677,
  });
  session.__notifications = notifications;
  const scene = createMockScene({
    currentRawDispatchStamp: 1775127678,
    currentSessionStamp: 1775127678,
    currentVisibleStamp: 1775127678,
    currentImmediateStamp: 1775127677,
    historyFloorDestinyStamp: 1775127677,
    rawSimTimeMs: 1775127678000,
  });

  const emitted = sendAndExtract(proto, scene, session, [
    {
      stamp: 1775127681,
      payload: ["SetBallAgility", [980000000142, { type: "real", value: 3.27 }]],
    },
    {
      stamp: 1775127681,
      payload: ["SetBallMass", [980000000142, { type: "real", value: 1113000 }]],
    },
    {
      stamp: 1775127681,
      payload: ["SetMaxSpeed", [980000000142, { type: "real", value: 325 }]],
    },
    {
      stamp: 1775127681,
      payload: ["SetBallMassive", [980000000142, 0]],
    },
  ]);

  const uniqueEmittedStamps = [...new Set(emitted)];
  assert.deepStrictEqual(uniqueEmittedStamps, [1775127680]);
  return uniqueEmittedStamps[0];
}

function verifyGlitchGuard(proto) {
  const { session, notifications } = createSession({
    simTimeMs: 1775094816000,
    lastVisibleDynamicDestinyStamp: 1775094816,
    lastSentDestinyStamp: 1775094818,
    lastSentDestinyRawDispatchStamp: 1775094815,
    lastSentDestinyWasOwnerCritical: false,
  });
  session.__notifications = notifications;
  const scene = createMockScene({
    currentRawDispatchStamp: 1775094816,
    currentSessionStamp: 1775094816,
    currentVisibleStamp: 1775094816,
    currentImmediateStamp: 1775094815,
    historyFloorDestinyStamp: 1775094783,
    rawSimTimeMs: 1775094816000,
  });

  const emitted = sendAndExtract(proto, scene, session, [{
    stamp: 1775094817,
    missileLifecycleGroup: true,
    ownerMissileLifecycleGroup: false,
    freshAcquireLifecycleGroup: false,
    payload: ["RemoveBalls", [{ entityCount: 1, entityIDs: [980000000196] }]],
  }]);

  const uniqueEmittedStamps = [...new Set(emitted)];
  assert.deepStrictEqual(uniqueEmittedStamps, [1775094818]);
  return uniqueEmittedStamps[0];
}

function main() {
  const proto = buildScenePrototype();
  const lateObserverRemoveBalls = verifyJoltsLateObserverRemoveBalls(proto);
  const nonTargetedPropGuard = verifyNonTargetedPropGuard(proto);
  const glitchGuard = verifyGlitchGuard(proto);

  console.log(JSON.stringify({
    scenario: "joltsObserverParity",
    lateObserverRemoveBalls,
    nonTargetedPropGuard,
    glitchGuard,
  }, null, 2));
}

main();
