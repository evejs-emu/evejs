#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");

process.env.EVEJS_LOG_LEVEL = process.env.EVEJS_LOG_LEVEL || "2";
process.env.EVEJS_SKIP_NPC_STARTUP = "1";
process.env.EVEJS_DISABLE_NPC_ANCHOR_RELEVANCE = "1";

const runtime = require("../src/space/runtime");
const destiny = require("../src/space/destiny");
const {
  DESTINY_CONTRACTS,
} = require("../src/space/movement/authority/destinyContracts");
const {
  DESTINY_DROP_LOG_PATH,
  DESTINY_ENGINE_LOG_PATH,
} = require("../src/space/movement/authority/destinyJourneyLog");

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.trunc(numeric);
  }
  const fallbackNumeric = Number(fallback);
  return Number.isFinite(fallbackNumeric) ? Math.trunc(fallbackNumeric) : 0;
}

function resetDebugLogs() {
  for (const targetPath of [
    DESTINY_DROP_LOG_PATH,
    DESTINY_ENGINE_LOG_PATH,
  ]) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, "", "utf8");
  }
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
    systemID: 30000142,
    sessions: new Map(),
    dynamicEntities: new Map(),
    staticEntities: new Set(),
    getCurrentSimTimeMs() {
      return config.nowMs;
    },
    getCurrentDestinyStamp() {
      return config.currentSessionStamp;
    },
    getNextDestinyStamp() {
      return (config.currentSessionStamp + 1) >>> 0;
    },
    getCurrentSessionDestinyStamp() {
      return config.currentSessionStamp;
    },
    getCurrentVisibleSessionDestinyStamp() {
      return config.currentVisibleStamp;
    },
    getCurrentPresentedSessionDestinyStamp(_session, _now, maximumLead = 0) {
      const normalizedLead = Math.max(0, toInt(maximumLead, 0));
      if (normalizedLead <= 3) {
        return config.currentPresentedObserverStamp >>> 0;
      }
      return config.currentPresentedOwnerStamp >>> 0;
    },
    getImmediateDestinyStampForSession() {
      return config.currentImmediateStamp;
    },
    getHistoryFloorDestinyStampForSession() {
      return config.currentVisibleStamp;
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

function createSession(spaceOverrides = {}, authorityOverrides = {}) {
  const notifications = [];
  const session = {
    clientID: 1065450 + Math.floor(Math.random() * 1000),
    characterID: 140000008,
    charID: 140000008,
    socket: {
      destroyed: false,
    },
    _space: {
      initialStateSent: true,
      shipID: 991003010,
      simTimeMs: 0,
      simFileTime: "0",
      timeDilation: 1,
      historyFloorDestinyStamp: 1775154000,
      visibleDynamicEntityIDs: new Set([991003010]),
      ...spaceOverrides,
      destinyAuthorityState: {
        lastRawDispatchStamp: 0,
        lastPresentedStamp: 0,
        lastCriticalStamp: 0,
        lastNonCriticalStamp: 0,
        lastSentWasOwnerCritical: false,
        lastSentOnlyStaleProjectedOwnerMissileLane: false,
        lastOwnerCommandStamp: 0,
        lastOwnerCommandAnchorStamp: 0,
        lastOwnerCommandRawDispatchStamp: 0,
        lastOwnerCommandHeadingHash: "",
        lastFreshAcquireLifecycleStamp: 0,
        lastBootstrapStamp: 0,
        lastMissileLifecycleStamp: 0,
        lastOwnerMissileLifecycleStamp: 0,
        lastOwnerMissileLifecycleAnchorStamp: 0,
        lastOwnerMissileLifecycleRawDispatchStamp: 0,
        lastOwnerMissileFreshAcquireStamp: 0,
        lastOwnerMissileFreshAcquireAnchorStamp: 0,
        lastOwnerMissileFreshAcquireRawDispatchStamp: 0,
        lastOwnerNonMissileCriticalStamp: 0,
        lastOwnerNonMissileCriticalRawDispatchStamp: 0,
        lastResetStamp: 0,
        heldQueueState: {
          active: false,
          queuedCount: 0,
          lastQueueStamp: 0,
        },
        lastJourneyId: "",
        ...authorityOverrides,
      },
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

function verifyFreshSubwarpChainStaysInsideHeldFuture(proto) {
  resetDebugLogs();
  const config = {
    nowMs: 1775168477035,
    currentSessionStamp: 1775168477,
    currentVisibleStamp: 1775168477,
    currentPresentedOwnerStamp: 1775168481,
    currentPresentedObserverStamp: 1775168481,
    currentImmediateStamp: 1775168476,
  };
  const scene = createScene(proto, config);
  const { session, notifications } = createSession({
    lastSentDestinyStamp: 1775168477,
    lastSentDestinyRawDispatchStamp: 1775168476,
    lastSentDestinyWasOwnerCritical: false,
  }, {
    lastRawDispatchStamp: 1775168476,
    lastPresentedStamp: 1775168477,
    lastCriticalStamp: 1775168477,
    lastNonCriticalStamp: 1775168477,
    lastSentWasOwnerCritical: false,
  });

  const ownerDamageEmitted = scene.sendDestinyUpdates(session, [
    {
      stamp: 1775168477,
      payload: [
        "OnDamageStateChange",
        [
          991003010,
          [
            [0.884794, 210000.0, 134196420767010000n],
            1.0,
            1.0,
          ],
        ],
      ],
    },
  ], false, {
    translateStamps: false,
    destinyAuthorityContract: DESTINY_CONTRACTS.COMBAT_NONCRITICAL,
  });
  scene.flushDirectDestinyNotificationBatch();

  assert.strictEqual(ownerDamageEmitted, 1775168479);
  assert.strictEqual(notifications.length, 1);
  assert.deepStrictEqual(
    extractEmittedStamps(notifications[0]),
    [1775168479],
  );

  config.nowMs = 1775168478080;
  config.currentSessionStamp = 1775168478;
  config.currentVisibleStamp = 1775168478;
  config.currentPresentedOwnerStamp = 1775168480;
  config.currentPresentedObserverStamp = 1775168480;
  config.currentImmediateStamp = 1775168477;

  const observerLifecycleEmitted = scene.sendDestinyUpdates(session, [
    {
      stamp: 1775168480,
      missileLifecycleGroup: true,
      payload: destiny.buildTerminalPlayDestructionEffectPayload(980000000999, 3),
    },
    {
      stamp: 1775168480,
      missileLifecycleGroup: true,
      payload: destiny.buildRemoveBallsPayload([980000000999]),
    },
  ], false, {
    translateStamps: false,
    destinyAuthorityContract: DESTINY_CONTRACTS.OBSERVER_MISSILE_LIFECYCLE,
  });
  scene.flushDirectDestinyNotificationBatch();

  assert.strictEqual(observerLifecycleEmitted, 1775168480);
  assert.strictEqual(notifications.length, 2);
  assert.deepStrictEqual(
    extractEmittedStamps(notifications[1]),
    [1775168480, 1775168480],
  );

  const dropLog = fs.readFileSync(DESTINY_DROP_LOG_PATH, "utf8");
  assert.strictEqual(dropLog.trim(), "");

  return {
    ownerDamageEmitted,
    observerLifecycleEmitted,
  };
}

function verifyLateObserverMissileStormDropsInsteadOfPublishingPostHeld(proto) {
  resetDebugLogs();
  const scene = createScene(proto, {
    nowMs: 1775168478080,
    currentSessionStamp: 1775168478,
    currentVisibleStamp: 1775168478,
    currentPresentedOwnerStamp: 1775168482,
    currentPresentedObserverStamp: 1775168482,
    currentImmediateStamp: 1775168477,
  });
  const { session, notifications } = createSession({
    lastSentDestinyStamp: 1775168482,
    lastSentDestinyRawDispatchStamp: 1775168477,
    lastSentDestinyWasOwnerCritical: false,
    lastFreshAcquireLifecycleStamp: 1775168481,
    lastMissileLifecycleStamp: 1775168482,
    lastOwnerMissileLifecycleStamp: 1775168480,
    lastOwnerMissileLifecycleAnchorStamp: 1775168476,
    lastOwnerMissileLifecycleRawDispatchStamp: 1775168476,
    lastOwnerMissileFreshAcquireStamp: 1775168478,
    lastOwnerMissileFreshAcquireAnchorStamp: 1775168474,
    lastOwnerMissileFreshAcquireRawDispatchStamp: 1775168474,
    lastOwnerNonMissileCriticalStamp: 1775168472,
    lastOwnerNonMissileCriticalRawDispatchStamp: 1775168469,
  }, {
    lastRawDispatchStamp: 1775168477,
    lastPresentedStamp: 1775168482,
    lastCriticalStamp: 1775168482,
    lastNonCriticalStamp: 1775168481,
    lastSentWasOwnerCritical: false,
    lastFreshAcquireLifecycleStamp: 1775168481,
    lastBootstrapStamp: 1775168481,
    lastMissileLifecycleStamp: 1775168482,
    lastOwnerMissileLifecycleStamp: 1775168480,
    lastOwnerMissileLifecycleAnchorStamp: 1775168476,
    lastOwnerMissileLifecycleRawDispatchStamp: 1775168476,
    lastOwnerMissileFreshAcquireStamp: 1775168478,
    lastOwnerMissileFreshAcquireAnchorStamp: 1775168474,
    lastOwnerMissileFreshAcquireRawDispatchStamp: 1775168474,
    lastOwnerNonMissileCriticalStamp: 1775168472,
    lastOwnerNonMissileCriticalRawDispatchStamp: 1775168469,
  });

  const emitted = scene.sendDestinyUpdates(session, [
    {
      stamp: 1775168480,
      missileLifecycleGroup: true,
      payload: destiny.buildTerminalPlayDestructionEffectPayload(980000000999, 3),
    },
    {
      stamp: 1775168480,
      missileLifecycleGroup: true,
      payload: destiny.buildRemoveBallsPayload([980000000999]),
    },
  ], false, {
    translateStamps: false,
    destinyAuthorityContract: DESTINY_CONTRACTS.OBSERVER_MISSILE_LIFECYCLE,
  });

  assert.strictEqual(emitted, 0);
  assert.strictEqual(notifications.length, 0);

  const engineLog = fs.readFileSync(DESTINY_ENGINE_LOG_PATH, "utf8");
  const dropLog = fs.readFileSync(DESTINY_DROP_LOG_PATH, "utf8");
  assert.match(engineLog, /authority\.subwarpHeldFutureCeiling/);
  assert.match(dropLog, /authority\.subwarpHeldFutureCeiling/);
  assert.match(dropLog, /backstep-behind-last-sent/);
  assert.doesNotMatch(dropLog, /1775168483/);

  return {
    emitted,
    dropLogFile: path.basename(DESTINY_DROP_LOG_PATH),
  };
}

function verifyExplicitPostHeldFutureOptOutStillAllowed(proto) {
  resetDebugLogs();
  const scene = createScene(proto, {
    nowMs: 1775168600000,
    currentSessionStamp: 1775168600,
    currentVisibleStamp: 1775168600,
    currentPresentedOwnerStamp: 1775168600,
    currentPresentedObserverStamp: 1775168600,
    currentImmediateStamp: 1775168599,
  });
  const { session, notifications } = createSession();

  const emitted = scene.sendDestinyUpdates(session, [
    {
      stamp: 1775168600,
      payload: [
        "OnSpecialFX",
        [
          991003010,
          991003010,
          null,
          991003010,
          null,
          "effects.TestFx",
          0,
          1,
          1,
          1000,
          null,
          null,
          0,
          null,
        ],
      ],
    },
  ], false, {
    translateStamps: false,
    destinyAuthorityContract: DESTINY_CONTRACTS.COMBAT_NONCRITICAL,
    destinyAuthorityAllowPostHeldFuture: true,
    minimumLeadFromCurrentHistory: 5,
    maximumLeadFromCurrentHistory: 5,
  });
  scene.flushDirectDestinyNotificationBatch();

  assert.strictEqual(emitted, 1775168602);
  assert.strictEqual(notifications.length, 1);
  const emittedStamps = extractEmittedStamps(notifications[0]);
  assert.deepStrictEqual(emittedStamps, [1775168602]);

  return {
    emitted,
    emittedStamp: emittedStamps[0],
  };
}

function main() {
  const proto = buildScenePrototype();
  const freshSubwarpChain = verifyFreshSubwarpChainStaysInsideHeldFuture(proto);
  const lateObserverStorm = verifyLateObserverMissileStormDropsInsteadOfPublishingPostHeld(proto);
  const explicitPostHeldFutureOptOut = verifyExplicitPostHeldFutureOptOutStillAllowed(proto);

  console.log(JSON.stringify({
    freshSubwarpChain,
    lateObserverStorm,
    explicitPostHeldFutureOptOut,
  }, null, 2));
}

main();
