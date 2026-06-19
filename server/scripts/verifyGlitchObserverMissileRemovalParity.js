#!/usr/bin/env node

const assert = require("assert");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";
process.env.EVEJS_DISABLE_NPC_ANCHOR_RELEVANCE = "1";

const runtime = require("../src/space/runtime");

function buildScenePrototype() {
  runtime._testing.clearScenes();
  const scene = runtime.ensureScene(30000140, {
    refreshStargates: false,
  });
  const prototype = Object.getPrototypeOf(scene);
  runtime._testing.clearScenes();
  return prototype;
}

function createScenario(proto) {
  let currentTick = 1775094815;
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
      simTimeMs: 1775094815015,
      simFileTime: "0",
      timeDilation: 1,
      lastVisibleDynamicDestinyStamp: 1775094783,
      lastSentDestinyStamp: 1775094818,
      lastSentDestinyRawDispatchStamp: 1775094814,
      lastSentDestinyOnlyStaleProjectedOwnerMissileLane: false,
      lastSentDestinyWasOwnerCritical: false,
      lastOwnerNonMissileCriticalStamp: 1775094799,
      lastOwnerNonMissileCriticalRawDispatchStamp: 1775094799,
      lastPilotCommandMovementStamp: 1775094799,
      lastPilotCommandMovementAnchorStamp: 1775094798,
      lastPilotCommandMovementRawDispatchStamp: 1775094799,
      lastFreshAcquireLifecycleStamp: 1775094812,
      lastMissileLifecycleStamp: 1775094818,
      lastOwnerMissileLifecycleStamp: 0,
      lastOwnerMissileLifecycleAnchorStamp: 0,
      lastOwnerMissileFreshAcquireStamp: 0,
      lastOwnerMissileFreshAcquireAnchorStamp: 0,
      lastOwnerMissileFreshAcquireRawDispatchStamp: 0,
      lastOwnerMissileLifecycleRawDispatchStamp: 0,
    },
    sendNotification(name, target, payload) {
      notifications.push({ tick: currentTick, name, target, payload });
    },
  };
  const scene = Object.assign(Object.create(proto), {
    systemID: 30000140,
    getCurrentSimTimeMs() {
      return currentTick * 1000 + 15;
    },
    getCurrentDestinyStamp() {
      return currentTick;
    },
    getCurrentSessionDestinyStamp() {
      return currentTick;
    },
    getCurrentVisibleSessionDestinyStamp() {
      return currentTick;
    },
    getCurrentPresentedSessionDestinyStamp(targetSession, _rawSimTimeMs, maximumFutureLead = 2) {
      const lastSent =
        targetSession &&
        targetSession._space &&
        Number.isFinite(Number(targetSession._space.lastSentDestinyStamp))
          ? Number(targetSession._space.lastSentDestinyStamp) >>> 0
          : currentTick;
      const trustedLead = Math.max(0, Number(maximumFutureLead) || 0) >>> 0;
      return lastSent > currentTick && lastSent <= ((currentTick + trustedLead) >>> 0)
        ? lastSent
        : currentTick;
    },
    getImmediateDestinyStampForSession() {
      return currentTick > 0 ? ((currentTick - 1) >>> 0) : currentTick;
    },
    getHistoryFloorDestinyStampForSession() {
      return 1775094783;
    },
    getSessionClockOffsetMs() {
      return 0;
    },
    translateDestinyStampForSession(_targetSession, rawStamp) {
      return Number(rawStamp) >>> 0;
    },
    refreshSessionClockSnapshot() {},
  });
  return {
    scene,
    session,
    notifications,
    setTick(value) {
      currentTick = value >>> 0;
    },
  };
}

function extractStamps(notification) {
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
    ? payloadList.map((entry) => Number(entry && entry[0]) >>> 0)
    : [];
}

function sendRemoveBalls(scene, session, tick, ids) {
  const updates = ids.map((entityID) => ({
    stamp: (tick + 1) >>> 0,
    missileLifecycleGroup: true,
    ownerMissileLifecycleGroup: false,
    freshAcquireLifecycleGroup: false,
    payload: ["RemoveBalls", [{ entityCount: 1, entityIDs: [entityID] }]],
  }));
  scene.sendDestinyUpdates(session, updates, false, {
    translateStamps: false,
  });
}

function main() {
  const proto = buildScenePrototype();
  const { scene, session, notifications, setTick } = createScenario(proto);

  // Replay the exact glitch teardown cadence that previously exploded into:
  // 4824, 4826, 4828, 4830, 4832, 4834.
  const batches = [
    [1775094815, [980000000209, 980000000210, 980000000211, 980000000212]],
    [1775094816, [980000000196, 980000000197]],
    [1775094817, [980000000213]],
    [1775094818, [980000000178, 980000000179, 980000000180]],
    [1775094819, [980000000193, 980000000194, 980000000195]],
    [1775094820, [980000000220, 980000000221, 980000000222, 980000000223, 980000000224]],
  ];

  for (const [tick, ids] of batches) {
    setTick(tick);
    sendRemoveBalls(scene, session, tick, ids);
  }

  const emitted = notifications.map((entry) => ({
    tick: entry.tick,
    stamps: extractStamps(entry),
  }));
  const uniqueStampsByTick = emitted.map((entry) => ({
    tick: entry.tick,
    uniqueStamps: [...new Set(entry.stamps)],
  }));

  const expectedAfter = [
    [1775094818],
    [1775094818],
    [1775094818],
    [1775094820],
    [1775094820],
    [1775094822],
  ];

  assert.strictEqual(uniqueStampsByTick.length, expectedAfter.length);
  for (let index = 0; index < uniqueStampsByTick.length; index += 1) {
    assert.deepStrictEqual(
      uniqueStampsByTick[index].uniqueStamps,
      expectedAfter[index],
    );
  }
  assert.strictEqual(session._space.lastSentDestinyStamp, 1775094822);
  assert.strictEqual(session._space.lastSentDestinyRawDispatchStamp, 1775094820);

  console.log(JSON.stringify({
    scenario: "glitchObserverMissileRemoval",
    liveBefore: {
      batches: [
        { dispatchTick: 1775094817, emittedStamp: 1775094824, entityIDs: [980000000209, 980000000210, 980000000211, 980000000212] },
        { dispatchTick: 1775094818, emittedStamp: 1775094826, entityIDs: [980000000196, 980000000197] },
        { dispatchTick: 1775094819, emittedStamp: 1775094828, entityIDs: [980000000213] },
        { dispatchTick: 1775094820, emittedStamp: 1775094830, entityIDs: [980000000178, 980000000179, 980000000180] },
        { dispatchTick: 1775094821, emittedStamp: 1775094832, entityIDs: [980000000193, 980000000194, 980000000195] },
        { dispatchTick: 1775094822, emittedStamp: 1775094834, entityIDs: [980000000220, 980000000221, 980000000222, 980000000223, 980000000224] },
      ],
    },
    after: {
      batches: uniqueStampsByTick,
      lastSentDestinyStamp: session._space.lastSentDestinyStamp,
      lastSentDestinyRawDispatchStamp: session._space.lastSentDestinyRawDispatchStamp,
    },
  }, null, 2));
}

main();
