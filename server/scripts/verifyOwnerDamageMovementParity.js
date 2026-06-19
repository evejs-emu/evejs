#!/usr/bin/env node

process.env.EVEJS_SKIP_NPC_STARTUP = "1";
process.env.EVEJS_DISABLE_NPC_ANCHOR_RELEVANCE = "1";

const runtime = require("../src/space/runtime");
const destiny = require("../src/space/destiny");

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.trunc(numeric);
  }
  const fallbackNumeric = Number(fallback);
  return Number.isFinite(fallbackNumeric) ? Math.trunc(fallbackNumeric) : 0;
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
  if (typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      result[key] = stableClone(value[key]);
    }
    return result;
  }
  return String(value);
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

function createSession(overrides = {}) {
  return {
    clientID: 111,
    characterID: 222,
    socket: {
      destroyed: false,
    },
    _space: {
      initialStateSent: true,
      simTimeMs: 1000,
      simFileTime: "0",
      timeDilation: 1,
      shipID: 9001,
      lastVisibleDynamicDestinyStamp: 70,
      lastSentDestinyStamp: 0,
      lastSentDestinyRawDispatchStamp: 0,
      lastSentDestinyOnlyStaleProjectedOwnerMissileLane: false,
      lastSentDestinyWasOwnerCritical: false,
      lastFreshAcquireLifecycleStamp: 0,
      lastMissileLifecycleStamp: 0,
      lastMissileLifecycleRawDispatchStamp: 0,
      lastOwnerMissileLifecycleStamp: 0,
      lastOwnerMissileLifecycleAnchorStamp: 0,
      lastOwnerMissileLifecycleRawDispatchStamp: 0,
      lastOwnerMissileFreshAcquireStamp: 0,
      lastOwnerMissileFreshAcquireAnchorStamp: 0,
      lastOwnerMissileFreshAcquireRawDispatchStamp: 0,
      lastOwnerNonMissileCriticalStamp: 0,
      lastOwnerNonMissileCriticalRawDispatchStamp: 0,
      lastPilotCommandMovementStamp: 0,
      lastPilotCommandMovementAnchorStamp: 0,
      lastPilotCommandMovementRawDispatchStamp: 0,
      ...((overrides && overrides._space) || {}),
    },
    sendNotification() {},
    ...overrides,
  };
}

function createScene(proto, overrides = {}) {
  return Object.assign(Object.create(proto), {
    systemID: 30000142,
    nextStamp: 77,
    _tickDestinyPresentation: null,
    getCurrentSimTimeMs() {
      return 1000;
    },
    getCurrentDestinyStamp() {
      return 77;
    },
    getCurrentSessionDestinyStamp() {
      return 70;
    },
    getCurrentVisibleSessionDestinyStamp() {
      return 70;
    },
    getCurrentPresentedSessionDestinyStamp() {
      return 70;
    },
    getImmediateDestinyStampForSession(session, currentSessionStamp) {
      return toInt(currentSessionStamp, 0) >>> 0;
    },
    getSessionClockOffsetMs() {
      return 0;
    },
    translateDestinyStampForSession(session, rawStamp) {
      return toInt(rawStamp, 0) >>> 0;
    },
    getHistoryFloorDestinyStampForSession() {
      return 70;
    },
    refreshSessionClockSnapshot() {},
    ...overrides,
  });
}

function captureSessionState(session) {
  return stableClone({
    lastSentDestinyStamp:
      toInt(session && session._space && session._space.lastSentDestinyStamp, 0) >>> 0,
    lastSentDestinyRawDispatchStamp:
      toInt(session && session._space && session._space.lastSentDestinyRawDispatchStamp, 0) >>> 0,
    lastOwnerMissileLifecycleStamp:
      toInt(session && session._space && session._space.lastOwnerMissileLifecycleStamp, 0) >>> 0,
    lastOwnerMissileLifecycleRawDispatchStamp:
      toInt(session && session._space && session._space.lastOwnerMissileLifecycleRawDispatchStamp, 0) >>> 0,
  });
}

function main() {
  const proto = buildScenePrototype();
  const session = createSession();
  const scene = createScene(proto);

  const before = captureSessionState(session);
  const emittedStamp = proto.sendDestinyUpdates.call(
    scene,
    session,
    [
      {
        stamp: 71,
        payload: destiny.buildOnDamageStateChangePayload(
          9001,
          [
            [{ type: "real", value: 0.9 }, { type: "real", value: 1 }, { type: "long", value: "1" }],
            { type: "real", value: 1 },
            { type: "real", value: 1 },
          ],
        ),
      },
    ],
    false,
    {
      translateStamps: false,
    },
  );
  const after = captureSessionState(session);
  const missilePressureAfterDamage =
    proto.shouldDeferPilotMovementForMissilePressure.call(
      scene,
      session,
      1000,
    );

  const snapshot = {
    before,
    emittedStamp,
    after,
    missilePressureAfterDamage,
  };

  console.log(JSON.stringify(snapshot, null, 2));

  if ((toInt(after.lastOwnerMissileLifecycleStamp, 0) >>> 0) !== 0) {
    throw new Error(
      `Expected owner damage-state to leave lastOwnerMissileLifecycleStamp at 0, got ${after.lastOwnerMissileLifecycleStamp}.`,
    );
  }
  if ((toInt(after.lastOwnerMissileLifecycleRawDispatchStamp, 0) >>> 0) !== 0) {
    throw new Error(
      `Expected owner damage-state to leave lastOwnerMissileLifecycleRawDispatchStamp at 0, got ${after.lastOwnerMissileLifecycleRawDispatchStamp}.`,
    );
  }
  if (missilePressureAfterDamage !== false) {
    throw new Error(
      "Expected owner damage-state alone to not trigger missile-pressure defer.",
    );
  }
}

main();
