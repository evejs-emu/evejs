#!/usr/bin/env node

const assert = require("assert");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";
process.env.EVEJS_DISABLE_NPC_ANCHOR_RELEVANCE = "1";

const runtime = require("../src/space/runtime");
const npcBehaviorLoop = require("../src/space/npc/npcBehaviorLoop");

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
    systemID: 30000142,
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
    getCurrentPresentedSessionDestinyStamp(_session, _now, maximumLead = 0) {
      const maximumFutureLead = Math.max(0, toInt(maximumLead, 0));
      return Math.min(
        config.currentPresentedStamp,
        (config.currentVisibleStamp + maximumFutureLead) >>> 0,
      ) >>> 0;
    },
    getImmediateDestinyStampForSession() {
      return config.currentImmediateStamp;
    },
    getHistoryFloorDestinyStampForSession() {
      return 1775151200;
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
      historyFloorDestinyStamp: 1775151296,
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

function verifyOwnerMissileFreshAcquire(proto) {
  const config = {
    nowMs: 1775151367495,
    currentSessionStamp: 1775151367,
    currentVisibleStamp: 1775151367,
    currentPresentedStamp: 1775151369,
    currentImmediateStamp: 1775151366,
  };
  const { session, notifications } = createSession({
    lastSentDestinyStamp: 1775151369,
    lastSentDestinyRawDispatchStamp: 1775151367,
    lastSentDestinyOnlyStaleProjectedOwnerMissileLane: false,
    lastSentDestinyWasOwnerCritical: true,
    lastOwnerNonMissileCriticalStamp: 1775151364,
    lastOwnerNonMissileCriticalRawDispatchStamp: 1775151362,
    lastPilotCommandMovementStamp: 1775151364,
    lastPilotCommandMovementAnchorStamp: 1775151362,
    lastPilotCommandMovementRawDispatchStamp: 1775151362,
    lastFreshAcquireLifecycleStamp: 1775151369,
    lastMissileLifecycleStamp: 1775151369,
    lastOwnerMissileLifecycleStamp: 1775151369,
    lastOwnerMissileLifecycleAnchorStamp: 1775151367,
    lastOwnerMissileFreshAcquireStamp: 1775151369,
    lastOwnerMissileFreshAcquireAnchorStamp: 1775151367,
    lastOwnerMissileFreshAcquireRawDispatchStamp: 1775151367,
    lastOwnerMissileLifecycleRawDispatchStamp: 1775151367,
  });
  const scene = createScene(proto, config);
  const sendOptions =
    runtime._testing.buildOwnerMissileFreshAcquireSendOptionsForTesting({
      translateStamps: false,
      allowAdjacentRawFreshAcquireLaneReuse: true,
    });

  scene.sendDestinyUpdates(session, [
    {
      stamp: 1775151367,
      freshAcquireLifecycleGroup: true,
      missileLifecycleGroup: true,
      ownerMissileLifecycleGroup: true,
      payload: ["AddBalls2", [{ batchIndex: 0 }]],
    },
  ], false, sendOptions);
  scene.flushDirectDestinyNotificationBatch();

  assert.strictEqual(notifications.length, 1);
  const emittedStamps = extractEmittedStamps(notifications[0]);
  assert.deepStrictEqual(emittedStamps, [1775151369]);

  return {
    liveBefore: {
      emittedStamp: 1775151368,
      currentPresentedStamp: config.currentPresentedStamp,
    },
    after: {
      emittedStamp: emittedStamps[0],
      sendOptions: {
        minimumLeadFromCurrentHistory: sendOptions.minimumLeadFromCurrentHistory,
        maximumLeadFromCurrentHistory: sendOptions.maximumLeadFromCurrentHistory,
        historyLeadUsesPresentedSessionStamp:
          sendOptions.historyLeadUsesPresentedSessionStamp === true,
        historyLeadPresentedMaximumFutureLead:
          sendOptions.historyLeadPresentedMaximumFutureLead,
      },
    },
  };
}

function verifyOwnerDamageFlush(proto) {
  const config = {
    nowMs: 1775151369988,
    currentSessionStamp: 1775151369,
    currentVisibleStamp: 1775151369,
    currentPresentedStamp: 1775151371,
    currentImmediateStamp: 1775151368,
  };
  const { session, notifications } = createSession({
    lastSentDestinyStamp: 1775151371,
    lastSentDestinyRawDispatchStamp: 1775151369,
    lastSentDestinyOnlyStaleProjectedOwnerMissileLane: false,
    lastSentDestinyWasOwnerCritical: false,
    lastOwnerNonMissileCriticalStamp: 1775151364,
    lastOwnerNonMissileCriticalRawDispatchStamp: 1775151362,
    lastPilotCommandMovementStamp: 1775151364,
    lastPilotCommandMovementAnchorStamp: 1775151362,
    lastPilotCommandMovementRawDispatchStamp: 1775151362,
    lastFreshAcquireLifecycleStamp: 1775151369,
    lastMissileLifecycleStamp: 1775151370,
    lastOwnerMissileLifecycleStamp: 1775151370,
    lastOwnerMissileLifecycleAnchorStamp: 1775151368,
    lastOwnerMissileFreshAcquireStamp: 1775151369,
    lastOwnerMissileFreshAcquireAnchorStamp: 1775151367,
    lastOwnerMissileFreshAcquireRawDispatchStamp: 1775151367,
    lastOwnerMissileLifecycleRawDispatchStamp: 1775151368,
  });
  const scene = createScene(proto, config);
  const sendOptions =
    runtime._testing.buildOwnerDamageStateSendOptionsForTesting({
      translateStamps: false,
    });

  scene.sendDestinyUpdates(session, [
    {
      stamp: 1775151370,
      payload: [
        "OnDamageStateChange",
        [
          991003010,
          [
            [0.5, 210000.0, 134196249698780000n],
            1.0,
            1.0,
          ],
        ],
      ],
    },
  ], false, sendOptions);
  scene.flushDirectDestinyNotificationBatch();

  assert.strictEqual(notifications.length, 1);
  const emittedStamps = extractEmittedStamps(notifications[0]);
  assert.deepStrictEqual(emittedStamps, [1775151371]);

  return {
    liveBefore: {
      emittedStamp: 1775151370,
      currentPresentedStamp: config.currentPresentedStamp,
    },
    after: {
      emittedStamp: emittedStamps[0],
      sendOptions: {
        historyLeadUsesPresentedSessionStamp:
          sendOptions.historyLeadUsesPresentedSessionStamp === true,
        historyLeadPresentedMaximumFutureLead:
          sendOptions.historyLeadPresentedMaximumFutureLead,
      },
    },
  };
}

function verifyNpcSyntheticPropulsionDelivery(proto) {
  const config = {
    nowMs: 1775151320190,
    currentSessionStamp: 1775151319,
    currentVisibleStamp: 1775151319,
    currentPresentedStamp: 1775151321,
    currentImmediateStamp: 1775151318,
  };
  const { session } = createSession({
    lastSentDestinyStamp: 1775151321,
    lastSentDestinyRawDispatchStamp: 1775151319,
  });
  const scene = createScene(proto, config);
  const broadcastOptions =
    npcBehaviorLoop.__testing.buildNpcSyntheticPropulsionBroadcastOptions();
  const fxOptions =
    npcBehaviorLoop.__testing.buildNpcSyntheticPropulsionFxOptions({
      start: true,
      active: true,
    });

  const broadcastDelivery = scene.resolveDestinyDeliveryStampForSession(
    session,
    1775151320,
    config.nowMs,
    broadcastOptions,
  );
  const fxDelivery = scene.resolveDestinyDeliveryStampForSession(
    session,
    1775151320,
    config.nowMs,
    fxOptions,
  );

  assert.strictEqual(broadcastDelivery, 1775151321);
  assert.strictEqual(fxDelivery, 1775151321);

  return {
    liveBefore: {
      emittedStamp: 1775151320,
      currentPresentedStamp: config.currentPresentedStamp,
    },
    after: {
      broadcastDelivery,
      fxDelivery,
      broadcastOptions: {
        minimumLeadFromCurrentHistory:
          broadcastOptions.minimumLeadFromCurrentHistory,
        maximumLeadFromCurrentHistory:
          broadcastOptions.maximumLeadFromCurrentHistory,
        historyLeadUsesPresentedSessionStamp:
          broadcastOptions.historyLeadUsesPresentedSessionStamp === true,
        historyLeadPresentedMaximumFutureLead:
          broadcastOptions.historyLeadPresentedMaximumFutureLead,
      },
      fxOptions: {
        useCurrentStamp: fxOptions.useCurrentStamp === true,
        minimumLeadFromCurrentHistory: fxOptions.minimumLeadFromCurrentHistory,
        maximumLeadFromCurrentHistory: fxOptions.maximumLeadFromCurrentHistory,
        historyLeadUsesPresentedSessionStamp:
          fxOptions.historyLeadUsesPresentedSessionStamp === true,
        historyLeadPresentedMaximumFutureLead:
          fxOptions.historyLeadPresentedMaximumFutureLead,
      },
    },
  };
}

function main() {
  const proto = buildScenePrototype();
  const result = {
    ownerMissileFreshAcquire: verifyOwnerMissileFreshAcquire(proto),
    ownerDamageFlush: verifyOwnerDamageFlush(proto),
    npcSyntheticPropulsion: verifyNpcSyntheticPropulsionDelivery(proto),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main();
