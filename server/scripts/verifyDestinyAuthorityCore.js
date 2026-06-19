#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");

process.env.EVEJS_LOG_LEVEL = process.env.EVEJS_LOG_LEVEL || "2";
process.env.EVEJS_SKIP_NPC_STARTUP = "1";
process.env.EVEJS_DISABLE_NPC_ANCHOR_RELEVANCE = "1";

const runtime = require("../src/space/runtime");
const {
  DESTINY_CONTRACTS,
} = require("../src/space/movement/authority/destinyContracts");
const {
  DESTINY_DROP_LOG_PATH,
  DESTINY_ENGINE_LOG_PATH,
  DESTINY_JOURNEY_LOG_PATH,
  DESTINY_RESTAMP_LOG_PATH,
  MICHELLE_CONTRACT_LOG_PATH,
} = require("../src/space/movement/authority/destinyJourneyLog");

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
      historyFloorDestinyStamp: 1775154000,
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

function resetDebugLogs() {
  for (const targetPath of [
    DESTINY_DROP_LOG_PATH,
    DESTINY_ENGINE_LOG_PATH,
    DESTINY_JOURNEY_LOG_PATH,
    DESTINY_RESTAMP_LOG_PATH,
    MICHELLE_CONTRACT_LOG_PATH,
  ]) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, "", "utf8");
  }
}

function verifyOwnerDamageContractAndAuthorityState(proto) {
  const config = {
    nowMs: 1775156000000,
    currentSessionStamp: 1775156000,
    currentVisibleStamp: 1775156000,
    currentPresentedStamp: 1775156002,
    currentImmediateStamp: 1775155999,
  };
  const { session, notifications } = createSession({
    lastSentDestinyStamp: 1775156001,
    lastSentDestinyRawDispatchStamp: 1775156000,
  });
  const scene = createScene(proto, config);
  const sendOptions = runtime._testing.buildOwnerDamageStateSendOptionsForTesting({
    translateStamps: false,
  });

  assert.strictEqual(
    sendOptions.destinyAuthorityContract,
    DESTINY_CONTRACTS.COMBAT_NONCRITICAL,
  );

  scene.sendDestinyUpdates(session, [
    {
      stamp: 1775156001,
      payload: [
        "OnDamageStateChange",
        [
          991003010,
          [
            [0.75, 210000.0, 134196249698780000n],
            1.0,
            1.0,
          ],
        ],
      ],
    },
  ], false, sendOptions);
  scene.flushDirectDestinyNotificationBatch();

  assert.strictEqual(notifications.length, 1);
  const emittedStamp = extractEmittedStamps(notifications[0])[0];
  const authorityState = session._space.destinyAuthorityState;
  assert.ok(authorityState);
  assert.ok(authorityState.lastJourneyId);
  assert.strictEqual(authorityState.lastNonCriticalStamp, emittedStamp);
  assert.strictEqual(authorityState.lastRawDispatchStamp, config.currentSessionStamp);

  return {
    emittedStamp,
    authorityState: {
      lastJourneyId: authorityState.lastJourneyId,
      lastNonCriticalStamp: authorityState.lastNonCriticalStamp,
      lastRawDispatchStamp: authorityState.lastRawDispatchStamp,
    },
  };
}

function verifyOwnerMissileLifecycleContractAndAuthorityState(proto) {
  const config = {
    nowMs: 1775156100000,
    currentSessionStamp: 1775156100,
    currentVisibleStamp: 1775156100,
    currentPresentedStamp: 1775156101,
    currentImmediateStamp: 1775156099,
  };
  const { session, notifications } = createSession({
    lastSentDestinyStamp: 1775156100,
    lastSentDestinyRawDispatchStamp: 1775156100,
  });
  const scene = createScene(proto, config);
  const sendOptions = runtime._testing.buildOwnerMissileFreshAcquireSendOptionsForTesting({
    translateStamps: false,
  });

  assert.strictEqual(
    sendOptions.destinyAuthorityContract,
    DESTINY_CONTRACTS.OWNER_MISSILE_LIFECYCLE,
  );

  scene.sendDestinyUpdates(session, [
    {
      stamp: 1775156100,
      freshAcquireLifecycleGroup: true,
      missileLifecycleGroup: true,
      ownerMissileLifecycleGroup: true,
      payload: ["AddBalls2", [{ batchIndex: 0 }]],
    },
  ], false, sendOptions);
  scene.flushDirectDestinyNotificationBatch();

  assert.strictEqual(notifications.length, 1);
  const emittedStamp = extractEmittedStamps(notifications[0])[0];
  const authorityState = session._space.destinyAuthorityState;
  assert.ok(authorityState);
  assert.ok(authorityState.lastJourneyId);
  assert.strictEqual(authorityState.lastBootstrapStamp, emittedStamp);
  assert.strictEqual(authorityState.lastMissileLifecycleStamp, emittedStamp);
  assert.strictEqual(authorityState.lastCriticalStamp, emittedStamp);

  return {
    emittedStamp,
    authorityState: {
      lastJourneyId: authorityState.lastJourneyId,
      lastBootstrapStamp: authorityState.lastBootstrapStamp,
      lastMissileLifecycleStamp: authorityState.lastMissileLifecycleStamp,
      lastCriticalStamp: authorityState.lastCriticalStamp,
    },
  };
}

function main() {
  resetDebugLogs();
  const proto = buildScenePrototype();
  const ownerDamage = verifyOwnerDamageContractAndAuthorityState(proto);
  const ownerMissile = verifyOwnerMissileLifecycleContractAndAuthorityState(proto);
  const engineLog = fs.readFileSync(DESTINY_ENGINE_LOG_PATH, "utf8");
  const journeyLog = fs.readFileSync(DESTINY_JOURNEY_LOG_PATH, "utf8");
  const contractLog = fs.readFileSync(MICHELLE_CONTRACT_LOG_PATH, "utf8");

  assert.match(engineLog, /destiny\.authority\.plan-group/);
  assert.match(engineLog, /destiny\.authority\.apply-legacy-session-state/);
  assert.match(journeyLog, /destiny\.authority\.emit-group/);
  assert.match(contractLog, /destiny\.contract\.classify/);

  console.log(JSON.stringify({
    ownerDamage,
    ownerMissile,
    logs: {
      engine: path.basename(DESTINY_ENGINE_LOG_PATH),
      journey: path.basename(DESTINY_JOURNEY_LOG_PATH),
      contract: path.basename(MICHELLE_CONTRACT_LOG_PATH),
    },
  }, null, 2));
}

main();
