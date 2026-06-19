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
    characterID: 140000008,
    socket: {
      destroyed: false,
    },
    _space: {
      initialStateSent: true,
      shipID: 991002587,
      simTimeMs: 1775130592000,
      simFileTime: "0",
      timeDilation: 1,
      lastVisibleDynamicDestinyStamp: 1775130593,
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
    systemID: 30000142,
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

function sendAndExtract(proto, scene, session, updates) {
  const startIndex = session.__notifications.length;
  proto.sendDestinyUpdates.call(
    scene,
    session,
    updates,
    false,
    {
      translateStamps: false,
    },
  );
  const newNotifications = session.__notifications.slice(startIndex);
  return newNotifications.flatMap(extractEmittedStamps);
}

function runMwdStart(proto) {
  const { session, notifications } = createSession({
    simTimeMs: 1775130592000,
    lastVisibleDynamicDestinyStamp: 1775130593,
    lastSentDestinyStamp: 1775130593,
    lastSentDestinyRawDispatchStamp: 1775130591,
    lastSentDestinyWasOwnerCritical: true,
    lastPilotCommandMovementStamp: 1775130593,
    lastPilotCommandMovementAnchorStamp: 1775130592,
    lastPilotCommandMovementRawDispatchStamp: 1775130591,
  });
  session.__notifications = notifications;
  const scene = createMockScene({
    currentRawDispatchStamp: 1775130592,
    currentSessionStamp: 1775130592,
    currentVisibleStamp: 1775130593,
    currentImmediateStamp: 1775130591,
    historyFloorDestinyStamp: 1775130593,
    rawSimTimeMs: 1775130592000,
  });

  const presentationStamp = proto.getOwnerPropulsionTogglePresentationStamp.call(
    scene,
    session,
    1775130592000,
  );
  assert.strictEqual(presentationStamp, 1775130594);

  return {
    liveBefore: {
      emittedStamp: 1775130593,
    },
    after: {
      computedStamp: presentationStamp,
      emittedStamp: presentationStamp,
    },
  };
}

function runMwdStop(proto) {
  const { session, notifications } = createSession({
    simTimeMs: 1775130602000,
    lastVisibleDynamicDestinyStamp: 1775130602,
    lastSentDestinyStamp: 1775130602,
    lastSentDestinyRawDispatchStamp: 1775130601,
    lastSentDestinyWasOwnerCritical: false,
  });
  session.__notifications = notifications;
  const scene = createMockScene({
    currentRawDispatchStamp: 1775130602,
    currentSessionStamp: 1775130602,
    currentVisibleStamp: 1775130602,
    currentImmediateStamp: 1775130601,
    historyFloorDestinyStamp: 1775130602,
    rawSimTimeMs: 1775130602000,
  });

  const presentationStamp = proto.getOwnerPropulsionTogglePresentationStamp.call(
    scene,
    session,
    1775130602000,
  );
  assert.strictEqual(presentationStamp, 1775130603);

  return {
    liveBefore: {
      emittedStamp: 1775130602,
    },
    after: {
      computedStamp: presentationStamp,
      emittedStamp: presentationStamp,
    },
  };
}

function runHeldFutureCapGuard(proto) {
  const { session } = createSession({
    simTimeMs: 1775130700000,
    lastVisibleDynamicDestinyStamp: 1775130700,
    lastSentDestinyStamp: 1775130702,
    lastSentDestinyRawDispatchStamp: 1775130699,
    lastSentDestinyWasOwnerCritical: true,
  });
  const scene = createMockScene({
    currentRawDispatchStamp: 1775130700,
    currentSessionStamp: 1775130700,
    currentVisibleStamp: 1775130700,
    currentImmediateStamp: 1775130699,
    historyFloorDestinyStamp: 1775130700,
    rawSimTimeMs: 1775130700000,
  });

  const presentationStamp = proto.getOwnerPropulsionTogglePresentationStamp.call(
    scene,
    session,
    1775130700000,
  );
  assert.strictEqual(presentationStamp, 1775130702);

  return {
    computedStamp: presentationStamp,
  };
}

function runLateStopUsesLiveSceneTime(proto) {
  const stopTimeMs = 1775183194000;
  const currentSimTimeMs = 1775183220000;
  const session = {
    characterID: 0,
    _space: {
      shipID: 991003087,
      systemID: 30000142,
    },
  };
  const stampFromTimeMs = (rawTimeMs) => toInt(rawTimeMs / 1000, 0) >>> 0;
  const scene = {
    systemID: 30000142,
    getCurrentSimTimeMs() {
      return currentSimTimeMs;
    },
    getCurrentDestinyStamp() {
      return stampFromTimeMs(currentSimTimeMs);
    },
    getCurrentSessionDestinyStamp(_session, rawTimeMs = currentSimTimeMs) {
      return stampFromTimeMs(rawTimeMs);
    },
    getCurrentVisibleSessionDestinyStamp(_session, rawTimeMs = currentSimTimeMs) {
      return stampFromTimeMs(rawTimeMs);
    },
    getCurrentPresentedSessionDestinyStamp(targetSession, rawTimeMs = currentSimTimeMs, maximumFutureLead) {
      const currentVisibleStamp = stampFromTimeMs(rawTimeMs);
      return resolvePresentedSessionDestinyStamp({
        currentVisibleStamp,
        hasSessionSpace: Boolean(targetSession && targetSession._space),
        lastSentStamp:
          targetSession && targetSession._space
            ? (toInt(targetSession._space.lastSentDestinyStamp, currentVisibleStamp) >>> 0)
            : currentVisibleStamp,
        maximumFutureLead,
        defaultMaximumFutureLead: MICHELLE_HELD_FUTURE_DESTINY_LEAD,
        maximumTrustedLead:
          MICHELLE_HELD_FUTURE_DESTINY_LEAD +
          MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD,
      });
    },
  };
  const entity = {
    itemID: 991003087,
    activeModuleEffects: new Map([
      [9001, {
        moduleID: 9001,
        effectName: "effect_microwarpdrive",
        effectID: 0,
        groupID: 46,
        typeID: 12076,
        durationMs: 10000,
        reactivationDelayMs: 0,
        guid: "effects.MicroWarpDrive",
        targetID: 0,
        chargeTypeID: 0,
        weaponFamily: null,
      }],
    ]),
    moduleReactivationLocks: new Map(),
  };

  let capturedBroadcastStamp = null;
  let capturedBroadcastOptions = null;
  let capturedFxOptions = null;
  const oldComputedStamp = proto.getOwnerPropulsionTogglePresentationStamp.call(
    scene,
    session,
    stopTimeMs,
  );
  const liveComputedStamp = proto.getOwnerPropulsionTogglePresentationStamp.call(
    scene,
    session,
    currentSimTimeMs,
  );

  scene.getShipEntityForSession = () => entity;
  scene.getOwnerPropulsionTogglePresentationStamp = (...args) =>
    proto.getOwnerPropulsionTogglePresentationStamp.call(scene, ...args);
  scene.refreshSessionShipDerivedState = (_session, options = {}) => {
    capturedBroadcastStamp = toInt(options.broadcastStamp, 0) >>> 0;
    return { success: false };
  };
  scene.refreshShipEntityDerivedState = (_entity, options = {}) => {
    capturedBroadcastOptions = options && options.broadcastOptions
      ? { ...options.broadcastOptions }
      : null;
    return { success: true };
  };
  scene.broadcastSpecialFx = (_shipID, _guid, options = {}) => {
    capturedFxOptions = { ...options };
    return { deliveredCount: 0, stamp: null };
  };

  const result = proto.finalizePropulsionModuleDeactivation.call(
    scene,
    session,
    9001,
    {
      nowMs: stopTimeMs,
      reason: "cycleBoundary",
    },
  );

  assert.strictEqual(result.success, true);
  assert.strictEqual(oldComputedStamp, 1775183195);
  assert.strictEqual(liveComputedStamp, 1775183221);
  assert.strictEqual(capturedBroadcastStamp, null);
  assert.ok(capturedBroadcastOptions);
  assert.strictEqual(
    capturedBroadcastOptions.historyLeadUsesPresentedSessionStamp,
    true,
  );
  assert.strictEqual(
    capturedBroadcastOptions.minimumLeadFromCurrentHistory,
    1,
  );
  assert.strictEqual(
    capturedBroadcastOptions.maximumLeadFromCurrentHistory,
    1,
  );
  assert.ok(capturedFxOptions);
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(capturedFxOptions, "stampOverride"),
    false,
  );
  assert.strictEqual(
    capturedFxOptions.historyLeadUsesPresentedSessionStamp,
    true,
  );

  return {
    before: {
      staleBoundaryStamp: oldComputedStamp,
    },
    after: {
      liveSceneStamp: liveComputedStamp,
      appliedBroadcastOptions: capturedBroadcastOptions,
      appliedFxOptions: capturedFxOptions,
    },
  };
}

function main() {
  const proto = buildScenePrototype();
  const mwdStart = runMwdStart(proto);
  const mwdStop = runMwdStop(proto);
  const heldFutureCapGuard = runHeldFutureCapGuard(proto);
  const lateStopUsesLiveSceneTime = runLateStopUsesLiveSceneTime(proto);

  console.log(JSON.stringify({
    scenario: "jolt222PropulsionParity",
    mwdStart,
    mwdStop,
    heldFutureCapGuard,
    lateStopUsesLiveSceneTime,
  }, null, 2));
}

main();
