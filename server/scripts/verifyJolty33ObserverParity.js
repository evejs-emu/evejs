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
  const scene = runtime.ensureScene(30000142, {
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
      simTimeMs: 1775093868000,
      simFileTime: "0",
      timeDilation: 1,
      lastVisibleDynamicDestinyStamp: 1775093868,
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

function runLateObserverMissileAdd(proto) {
  const { session, notifications } = createSession({
    simTimeMs: 1775093859000,
    lastVisibleDynamicDestinyStamp: 1775093859,
    lastSentDestinyStamp: 1775093862,
    lastSentDestinyRawDispatchStamp: 1775093858,
    lastSentDestinyWasOwnerCritical: false,
  });
  session.__notifications = notifications;
  const scene = createMockScene({
    currentRawDispatchStamp: 1775093859,
    currentSessionStamp: 1775093859,
    currentVisibleStamp: 1775093859,
    currentImmediateStamp: 1775093858,
    historyFloorDestinyStamp: 1775093858,
    rawSimTimeMs: 1775093859000,
  });

  const emitted = sendAndExtract(proto, scene, session, [{
    stamp: 1775093861,
    freshAcquireLifecycleGroup: true,
    missileLifecycleGroup: true,
    ownerMissileLifecycleGroup: false,
    payload: ["AddBalls2", [[], "0"]],
  }], {
    avoidCurrentHistoryInsertion: true,
    minimumLeadFromCurrentHistory: 2,
    maximumLeadFromCurrentHistory: 2,
    maximumHistorySafeLeadOverride: 2,
  });

  assert.deepStrictEqual(emitted, [1775093862]);
  assert.strictEqual(session._space.lastSentDestinyStamp, 1775093862);

  return {
    liveBefore: {
      emittedStamp: 1775093861,
    },
    after: {
      emittedStamp: emitted[0],
      lastSentDestinyStamp: session._space.lastSentDestinyStamp,
    },
  };
}

function runLateObserverPropBurst(proto) {
  const { session, notifications } = createSession({
    simTimeMs: 1775093868000,
    lastVisibleDynamicDestinyStamp: 1775093868,
    lastSentDestinyStamp: 1775093871,
    lastSentDestinyRawDispatchStamp: 1775093868,
    lastSentDestinyWasOwnerCritical: false,
  });
  session.__notifications = notifications;
  const scene = createMockScene({
    currentRawDispatchStamp: 1775093868,
    currentSessionStamp: 1775093868,
    currentVisibleStamp: 1775093868,
    currentImmediateStamp: 1775093867,
    historyFloorDestinyStamp: 1775093867,
    rawSimTimeMs: 1775093868000,
  });

  const emitted = sendAndExtract(proto, scene, session, [
    {
      stamp: 1775093870,
      payload: ["SetBallAgility", [980000000134, { type: "real", value: 3.27 }]],
    },
    {
      stamp: 1775093870,
      payload: ["SetBallMass", [980000000134, { type: "real", value: 1113000 }]],
    },
    {
      stamp: 1775093870,
      payload: ["SetMaxSpeed", [980000000134, { type: "real", value: 325 }]],
    },
    {
      stamp: 1775093870,
      payload: ["SetBallMassive", [980000000134, 0]],
    },
  ]);

  const uniqueEmittedStamps = [...new Set(emitted)];
  assert.deepStrictEqual(uniqueEmittedStamps, [1775093871]);
  assert.strictEqual(session._space.lastSentDestinyStamp, 1775093871);

  return {
    liveBefore: {
      emittedStamp: 1775093870,
    },
    after: {
      emittedStamp: uniqueEmittedStamps[0],
      lastSentDestinyStamp: session._space.lastSentDestinyStamp,
    },
  };
}

function runOwnerSelfPropulsionGuard(proto) {
  const { session, notifications } = createSession({
    simTimeMs: 1775093900000,
    lastVisibleDynamicDestinyStamp: 1775093900,
    lastSentDestinyStamp: 1775093903,
    lastSentDestinyRawDispatchStamp: 1775093899,
    lastSentDestinyWasOwnerCritical: false,
  });
  session.__notifications = notifications;
  const scene = createMockScene({
    currentRawDispatchStamp: 1775093900,
    currentSessionStamp: 1775093900,
    currentVisibleStamp: 1775093900,
    currentImmediateStamp: 1775093899,
    historyFloorDestinyStamp: 1775093899,
    rawSimTimeMs: 1775093900000,
  });

  const emitted = sendAndExtract(proto, scene, session, [
    {
      stamp: 1775093902,
      payload: ["SetBallAgility", [991002978, { type: "real", value: 3.27 }]],
    },
    {
      stamp: 1775093902,
      payload: ["SetBallMass", [991002978, { type: "real", value: 1113000 }]],
    },
  ]);

  const uniqueEmittedStamps = [...new Set(emitted)];
  // Guard only that the new observer-presented floor does not pull owner
  // self-propulsion off its existing owner-path lane contract.
  assert.deepStrictEqual(uniqueEmittedStamps, [1775093903]);

  return {
    emittedStamp: uniqueEmittedStamps[0],
  };
}

function main() {
  const proto = buildScenePrototype();

  const lateObserverMissileAdd = runLateObserverMissileAdd(proto);
  const lateObserverPropBurst = runLateObserverPropBurst(proto);
  const ownerSelfPropulsionGuard = runOwnerSelfPropulsionGuard(proto);

  console.log(JSON.stringify({
    scenario: "jolty33ObserverParity",
    lateObserverMissileAdd,
    lateObserverPropBurst,
    ownerSelfPropulsionGuard,
  }, null, 2));
}

main();
