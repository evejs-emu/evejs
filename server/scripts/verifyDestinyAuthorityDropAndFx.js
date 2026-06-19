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
  MICHELLE_CONTRACT_LOG_PATH,
} = require("../src/space/movement/authority/destinyJourneyLog");
const {
  snapshotDestinyAuthorityState,
} = require("../src/space/movement/authority/destinySessionState");

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
    MICHELLE_CONTRACT_LOG_PATH,
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

function createShipEntity(itemID) {
  return {
    itemID,
    kind: "ship",
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    mass: 1000,
    radius: 50,
    agility: 1,
    maxSpeed: 250,
    isMassive: false,
  };
}

function verifyDroppedUnsafeSend(proto) {
  const scene = createScene(proto, {
    nowMs: 1775157000000,
    currentSessionStamp: 1775157000,
    currentVisibleStamp: 1775157000,
    currentPresentedStamp: 1775157001,
    currentImmediateStamp: 1775156999,
  });
  const { session, notifications } = createSession({
    lastSentDestinyStamp: 1775157010,
    lastSentDestinyRawDispatchStamp: 1775157005,
    lastSentDestinyWasOwnerCritical: false,
  });

  const emitted = scene.sendDestinyUpdates(session, [
    {
      stamp: 1775156998,
      payload: destiny.buildSetSpeedFractionPayload(991003010, 0.5),
    },
  ], false, {
    translateStamps: false,
    destinyAuthorityContract: DESTINY_CONTRACTS.CRITICAL_MOVEMENT_OR_SHIPPRIME,
  });

  assert.strictEqual(emitted, 0);
  assert.strictEqual(notifications.length, 0);

  const dropLog = fs.readFileSync(DESTINY_DROP_LOG_PATH, "utf8");
  const engineLog = fs.readFileSync(DESTINY_ENGINE_LOG_PATH, "utf8");
  assert.match(dropLog, /destiny\.authority\.reject-group/);
  assert.match(engineLog, /destiny\.authority\.reject-group/);
  assert.match(dropLog, /recordedAtIso/);
  assert.match(dropLog, /decisionTree/);
  assert.match(dropLog, /journeyTree/);
  assert.match(dropLog, /backstep-behind-last-sent/);

  return {
    emitted,
    dropLogFile: path.basename(DESTINY_DROP_LOG_PATH),
  };
}

function verifySpecialFxUsesExplicitContract(proto) {
  const scene = createScene(proto, {
    nowMs: 1775157100000,
    currentSessionStamp: 1775157100,
    currentVisibleStamp: 1775157100,
    currentPresentedStamp: 1775157102,
    currentImmediateStamp: 1775157099,
  });
  const { session, notifications } = createSession();

  const result = scene.sendSpecialFxToSession(
    session,
    991003010,
    "effects.TestFx",
    {},
    null,
  );
  scene.flushDirectDestinyNotificationBatch();

  assert.strictEqual(result.delivered, true);
  assert.strictEqual(notifications.length, 1);

  const contractLog = fs.readFileSync(MICHELLE_CONTRACT_LOG_PATH, "utf8");
  assert.match(contractLog, /combat_noncritical/);

  return {
    delivered: result.delivered,
    stamp: result.stamp,
    contractLogFile: path.basename(MICHELLE_CONTRACT_LOG_PATH),
  };
}

function verifyQueuedHeldQueueState(proto) {
  const scene = createScene(proto, {
    nowMs: 1775157200000,
    currentSessionStamp: 1775157200,
    currentVisibleStamp: 1775157200,
    currentPresentedStamp: 1775157201,
    currentImmediateStamp: 1775157199,
  });
  const { session } = createSession();

  scene.beginTickDestinyPresentationBatch();
  scene.queueTickDestinyPresentationUpdates(session, [
    {
      stamp: 1775157201,
      payload: destiny.buildSetSpeedFractionPayload(991003010, 0.5),
    },
  ], {
    sendOptions: {
      destinyAuthorityContract: DESTINY_CONTRACTS.CRITICAL_MOVEMENT_OR_SHIPPRIME,
    },
  });

  const queuedState = snapshotDestinyAuthorityState(session);
  assert.strictEqual(queuedState.heldQueueState.active, true);
  assert.strictEqual(queuedState.heldQueueState.queuedCount, 1);
  assert.strictEqual(queuedState.heldQueueState.lastQueueStamp, 1775157201);

  scene.flushTickDestinyPresentationBatch();

  const flushedState = snapshotDestinyAuthorityState(session);
  assert.strictEqual(flushedState.heldQueueState.active, false);
  assert.strictEqual(flushedState.heldQueueState.queuedCount, 0);
  assert.strictEqual(flushedState.heldQueueState.lastQueueStamp, 0);

  return {
    queued: queuedState.heldQueueState,
    flushed: flushedState.heldQueueState,
  };
}

function verifyTeardownAndShipPrimeContracts(proto) {
  const scene = createScene(proto, {
    nowMs: 1775157300000,
    currentSessionStamp: 1775157300,
    currentVisibleStamp: 1775157300,
    currentPresentedStamp: 1775157302,
    currentImmediateStamp: 1775157299,
  });
  const first = createSession();
  const second = createSession({
    shipID: 991004001,
  });
  scene.sessions.set(`${first.session.clientID}`, first.session);
  scene.sessions.set(`${second.session.clientID}`, second.session);

  const deliveredRemove = scene.broadcastRemoveStaticEntity(
    88000001,
    null,
    { terminalDestructionEffectID: 1234 },
  );
  const shipEntity = createShipEntity(991004001);
  scene.dynamicEntities.set(shipEntity.itemID, shipEntity);
  const primeResult = scene.broadcastShipPrimeUpdates(shipEntity, {
    stampMode: "currentVisible",
  });

  const contractLog = fs.readFileSync(MICHELLE_CONTRACT_LOG_PATH, "utf8");
  assert.match(contractLog, /destruction_teardown/);
  assert.match(contractLog, /critical_movement_or_shipprime/);
  assert.ok(deliveredRemove.deliveredCount >= 1);
  assert.ok(primeResult.deliveredCount >= 1);

  return {
    removeDeliveredCount: deliveredRemove.deliveredCount,
    primeDeliveredCount: primeResult.deliveredCount,
  };
}

function main() {
  resetDebugLogs();
  const proto = buildScenePrototype();
  const droppedUnsafeSend = verifyDroppedUnsafeSend(proto);
  const specialFx = verifySpecialFxUsesExplicitContract(proto);
  const queuedHeldQueueState = verifyQueuedHeldQueueState(proto);
  const teardownAndShipPrime = verifyTeardownAndShipPrimeContracts(proto);

  console.log(JSON.stringify({
    droppedUnsafeSend,
    specialFx,
    queuedHeldQueueState,
    teardownAndShipPrime,
  }, null, 2));
}

main();
