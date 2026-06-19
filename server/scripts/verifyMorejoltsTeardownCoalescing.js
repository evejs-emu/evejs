#!/usr/bin/env node

const assert = require("assert");

process.env.EVEJS_LOG_LEVEL = process.env.EVEJS_LOG_LEVEL || "2";
process.env.EVEJS_SKIP_NPC_STARTUP = "1";
process.env.EVEJS_DISABLE_NPC_ANCHOR_RELEVANCE = "1";

const runtime = require("../src/space/runtime");
const destiny = require("../src/space/destiny");
const {
  DESTINY_CONTRACTS,
} = require("../src/space/movement/authority/destinyContracts");

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
      historyFloorDestinyStamp: 1775182548,
      visibleDynamicEntityIDs: new Set([991003010, 3950000000000059]),
      ...spaceOverrides,
      destinyAuthorityState: {
        lastRawDispatchStamp: 1775182547,
        lastPresentedStamp: 1775182549,
        lastCriticalStamp: 1775182549,
        lastNonCriticalStamp: 1775182549,
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

function extractDestinyUpdates(notification) {
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
    ? payloadList.map((entry) => ({
      stamp: toInt(entry && entry[0], 0) >>> 0,
      payloadName: Array.isArray(entry && entry[1])
        ? entry[1][0]
        : null,
    }))
    : [];
}

function main() {
  const proto = buildScenePrototype();
  const scene = createScene(proto, {
    nowMs: 1775182548661,
    currentSessionStamp: 1775182548,
    currentVisibleStamp: 1775182548,
    currentPresentedStamp: 1775182550,
    currentImmediateStamp: 1775182547,
  });
  const { session, notifications } = createSession();

  scene.beginTickDestinyPresentationBatch();

  scene.queueTickDestinyPresentationUpdates(session, [
    {
      stamp: 1775182546,
      payload: destiny.buildRemoveBallsPayload([3950000000000059]),
    },
  ], {
    sendOptions: {
      translateStamps: false,
      destinyAuthorityContract: DESTINY_CONTRACTS.DESTRUCTION_TEARDOWN,
    },
    getDedupeKey(update) {
      if (
        update &&
        Array.isArray(update.payload) &&
        update.payload[0] === "RemoveBalls"
      ) {
        return "remove:3950000000000059";
      }
      return null;
    },
  });

  scene.sendDestinyUpdates(session, [
    {
      stamp: 1775182548,
      payload: destiny.buildGotoDirectionPayload(991003010, -1, -0.3, 0.1),
    },
  ], false, {
    destinyAuthorityContract: DESTINY_CONTRACTS.CRITICAL_MOVEMENT_OR_SHIPPRIME,
  });

  assert.strictEqual(
    notifications.length,
    0,
    "tick-batched teardown and direct movement should not emit before flush",
  );

  scene.flushTickDestinyPresentationBatch();

  assert.strictEqual(
    notifications.length,
    1,
    "queued destruction and direct same-stamp movement should merge into one notification",
  );

  const updates = extractDestinyUpdates(notifications[0]);
  const mergedFinalStamp = updates.reduce(
    (highest, update) => Math.max(highest, update.stamp >>> 0) >>> 0,
    0,
  );

  assert.deepStrictEqual(
    updates.map((update) => update.payloadName),
    ["GotoDirection", "RemoveBalls"],
    "merged notification should contain both the direct steer and teardown payload",
  );
  assert.strictEqual(
    mergedFinalStamp,
    1775182550,
    "merged destruction/movement bundle should land on the authority-final stamp",
  );

  console.log(JSON.stringify({
    queuedTeardownCount: 1,
    emittedNotificationCount: notifications.length,
    mergedFinalStamp,
    payloadNames: updates.map((update) => update.payloadName),
  }, null, 2));
}

main();
