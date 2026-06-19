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
} = require("../src/space/movement/movementMichelleContract");
const {
  PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
} = require("../src/space/movement/warp/movementWarpContract");

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
      simTimeMs: 1775092955000,
      simFileTime: "0",
      timeDilation: 1,
      lastVisibleDynamicDestinyStamp: 1775092955,
      lastFreshAcquireLifecycleStamp: 0,
      lastMissileLifecycleStamp: 0,
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
        maximumTrustedLead: Math.max(
          MICHELLE_HELD_FUTURE_DESTINY_LEAD,
          PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
        ),
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

function buildObserverMissileAdd(updateStamp) {
  return {
    stamp: updateStamp >>> 0,
    freshAcquireLifecycleGroup: true,
    missileLifecycleGroup: true,
    ownerMissileLifecycleGroup: false,
    payload: ["AddBalls2", [[], "0"]],
  };
}

function sendObserverMissileAdd(proto, scene, session, updateStamp) {
  const startIndex = session.__notifications.length;
  proto.sendDestinyUpdates.call(
    scene,
    session,
    [buildObserverMissileAdd(updateStamp)],
    false,
    {
      translateStamps: false,
      avoidCurrentHistoryInsertion: true,
      minimumLeadFromCurrentHistory: 2,
      maximumLeadFromCurrentHistory: 2,
      maximumHistorySafeLeadOverride: 2,
    },
  );
  const newNotifications = session.__notifications.slice(startIndex);
  const emittedStamps = newNotifications.flatMap(extractEmittedStamps);
  return emittedStamps;
}

function runFirstRawWindow(proto) {
  const { session, notifications } = createSession({
    simTimeMs: 1775092955078,
    lastVisibleDynamicDestinyStamp: 1775092955,
    lastSentDestinyStamp: 1775092958,
    lastSentDestinyRawDispatchStamp: 1775092954,
    lastSentDestinyWasOwnerCritical: false,
    lastOwnerNonMissileCriticalStamp: 1775092943,
    lastOwnerNonMissileCriticalRawDispatchStamp: 1775092942,
    lastFreshAcquireLifecycleStamp: 1775092958,
    lastMissileLifecycleStamp: 1775092958,
  });
  session.__notifications = notifications;
  const scene = createMockScene({
    currentRawDispatchStamp: 1775092955,
    currentSessionStamp: 1775092955,
    currentVisibleStamp: 1775092955,
    currentImmediateStamp: 1775092954,
    historyFloorDestinyStamp: 1775092943,
    rawSimTimeMs: 1775092955078,
  });

  const firstEmission = sendObserverMissileAdd(
    proto,
    scene,
    session,
    1775092958,
  );
  const secondEmission = sendObserverMissileAdd(
    proto,
    scene,
    session,
    1775092955,
  );

  return {
    liveBefore: {
      firstEmission: 1775092960,
      secondEmission: 1775092957,
    },
    after: {
      firstEmission,
      secondEmission,
      lastSentDestinyStamp: toInt(session._space.lastSentDestinyStamp, 0) >>> 0,
      currentPresentedAfterSecond: scene.getCurrentPresentedSessionDestinyStamp(
        session,
        scene.getCurrentSimTimeMs(),
        PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
      ),
    },
  };
}

function runLaterInflationWindow(proto) {
  const { session, notifications } = createSession({
    simTimeMs: 1775092958064,
    lastVisibleDynamicDestinyStamp: 1775092958,
    lastSentDestinyStamp: 1775092963,
    lastSentDestinyRawDispatchStamp: 1775092957,
    lastSentDestinyWasOwnerCritical: false,
    lastOwnerNonMissileCriticalStamp: 1775092958,
    lastOwnerNonMissileCriticalRawDispatchStamp: 1775092956,
    lastFreshAcquireLifecycleStamp: 1775092963,
    lastMissileLifecycleStamp: 1775092963,
  });
  session.__notifications = notifications;
  const scene = createMockScene({
    currentRawDispatchStamp: 1775092958,
    currentSessionStamp: 1775092958,
    currentVisibleStamp: 1775092958,
    currentImmediateStamp: 1775092957,
    historyFloorDestinyStamp: 1775092943,
    rawSimTimeMs: 1775092958064,
  });

  const emitted = sendObserverMissileAdd(
    proto,
    scene,
    session,
    1775092957,
  );

  return {
    liveBefore: {
      emission: 1775092965,
    },
    after: {
      emission: emitted,
      lastSentDestinyStamp: toInt(session._space.lastSentDestinyStamp, 0) >>> 0,
      currentPresentedAfter: scene.getCurrentPresentedSessionDestinyStamp(
        session,
        scene.getCurrentSimTimeMs(),
        PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
      ),
    },
  };
}

function main() {
  const proto = buildScenePrototype();

  const firstRawWindow = runFirstRawWindow(proto);
  assert.deepStrictEqual(firstRawWindow.after.firstEmission, [1775092958]);
  assert.deepStrictEqual(firstRawWindow.after.secondEmission, [1775092958]);
  assert.strictEqual(firstRawWindow.after.lastSentDestinyStamp, 1775092958);
  assert.strictEqual(firstRawWindow.after.currentPresentedAfterSecond, 1775092958);

  const laterInflationWindow = runLaterInflationWindow(proto);
  assert.deepStrictEqual(laterInflationWindow.after.emission, [1775092960]);
  assert.strictEqual(laterInflationWindow.after.lastSentDestinyStamp, 1775092963);
  assert.strictEqual(laterInflationWindow.after.currentPresentedAfter, 1775092958);

  console.log(JSON.stringify({
    scenario: "fulldesync9ObserverMissileLifecycleParity",
    firstRawWindow,
    laterInflationWindow,
  }, null, 2));
}

main();
