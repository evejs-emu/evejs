#!/usr/bin/env node

process.env.EVEJS_SKIP_NPC_STARTUP = "1";
process.env.EVEJS_DISABLE_NPC_ANCHOR_RELEVANCE = "1";

const assert = require("assert");

const runtime = require("../src/space/runtime");
const {
  createMovementSubwarpCommands,
} = require("../src/space/movement/commands/movementSubwarpCommands");
const {
  OWNER_PENDING_GOTO_DUPLICATE_ALIGNMENT,
} = require("../src/space/movement/movementDeliveryPolicy");

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.trunc(numeric);
  }
  const fallbackNumeric = Number(fallback);
  return Number.isFinite(fallbackNumeric) ? Math.trunc(fallbackNumeric) : 0;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneVector(vector, fallback = { x: 0, y: 0, z: 0 }) {
  const source =
    vector && typeof vector === "object"
      ? vector
      : fallback && typeof fallback === "object"
        ? fallback
        : { x: 0, y: 0, z: 0 };
  return {
    x: toFiniteNumber(source.x, 0),
    y: toFiniteNumber(source.y, 0),
    z: toFiniteNumber(source.z, 0),
  };
}

function subtractVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0),
  };
}

function scaleVector(vector, scalar) {
  return {
    x: toFiniteNumber(vector && vector.x, 0) * toFiniteNumber(scalar, 0),
    y: toFiniteNumber(vector && vector.y, 0) * toFiniteNumber(scalar, 0),
    z: toFiniteNumber(vector && vector.z, 0) * toFiniteNumber(scalar, 0),
  };
}

function addVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) + toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) + toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) + toFiniteNumber(right && right.z, 0),
  };
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const source = cloneVector(vector, fallback);
  const magnitude = Math.sqrt(
    (source.x * source.x) +
    (source.y * source.y) +
    (source.z * source.z)
  );
  if (magnitude <= 0) {
    return cloneVector(fallback, { x: 1, y: 0, z: 0 });
  }
  return {
    x: source.x / magnitude,
    y: source.y / magnitude,
    z: source.z / magnitude,
  };
}

function directionsNearlyMatch(
  left,
  right,
  minimumDot = OWNER_PENDING_GOTO_DUPLICATE_ALIGNMENT,
) {
  const normalizedLeft = normalizeVector(left, { x: 1, y: 0, z: 0 });
  const normalizedRight = normalizeVector(right, { x: 1, y: 0, z: 0 });
  const dot =
    (normalizedLeft.x * normalizedRight.x) +
    (normalizedLeft.y * normalizedRight.y) +
    (normalizedLeft.z * normalizedRight.z);
  return dot >= minimumDot;
}

function buildDirectedMovementUpdates(entity, direction, speedFractionChanged, stamp) {
  const updates = [{
    stamp,
    payload: ["GotoDirection", [entity.itemID, direction.x, direction.y, direction.z]],
  }];
  if (speedFractionChanged) {
    updates.push({
      stamp,
      payload: ["SetSpeedFraction", [entity.itemID, 1]],
    });
  }
  return updates;
}

function createSubwarpHarness() {
  return createMovementSubwarpCommands({
    addVectors,
    armMovementTrace() {},
    buildDirectedMovementUpdates,
    buildPointMovementUpdates() {
      return [];
    },
    buildPerpendicular() {
      return { x: 0, y: 1, z: 0 };
    },
    clearTrackingState() {},
    cloneVector,
    crossProduct() {
      return { x: 0, y: 0, z: 1 };
    },
    directionsNearlyMatch,
    getShipDockingDistanceToStation() {
      return 0;
    },
    getTargetMotionPosition() {
      return { x: 0, y: 0, z: 0 };
    },
    logMovementDebug() {},
    normalizeVector,
    persistShipEntity() {},
    roundNumber(value) {
      return value;
    },
    scaleVector,
    subtractVectors,
    summarizeVector(vector) {
      return cloneVector(vector);
    },
    toFiniteNumber,
    toInt,
    DEFAULT_UP: { x: 0, y: 1, z: 0 },
    OWNER_PENDING_GOTO_DUPLICATE_ALIGNMENT,
  });
}

function buildScene(simTimeMs) {
  const Scene = runtime._testing.SolarSystemScene;
  const scene = new Scene(30000142);
  scene.simTimeMs = simTimeMs;
  return scene;
}

function buildSession(shipID = 991003010) {
  return {
    characterID: 140000008,
    charID: 140000008,
    socket: {
      destroyed: false,
    },
    _space: {
      shipID,
      simTimeMs: 0,
      simFileTime: 0n,
      timeDilation: 1,
      initialStateSent: true,
      historyFloorDestinyStamp: 1775152547,
      lastSentDestinyStamp: 1775152548,
      lastSentDestinyRawDispatchStamp: 1775152547,
    },
  };
}

function verifySkippedRawDuplicateGotoSuppressed() {
  const movementSubwarpCommands = createSubwarpHarness();
  const dispatched = [];
  const broadcast = [];
  const desiredDirection = normalizeVector({
    x: 0.585043982024455,
    y: 0.30636248791317056,
    z: -0.7509098248768769,
  });
  const entity = {
    itemID: 991003010,
    position: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    targetPoint: { x: 1.0e16, y: 0, z: 0 },
    targetEntityID: null,
    speedFraction: 1,
    mode: "GOTO",
    pendingDock: null,
  };
  const session = {
    characterID: 140000008,
    charID: 140000008,
    socket: { destroyed: false },
    _space: {
      shipID: entity.itemID,
      lastPilotCommandMovementStamp: 1775152564,
      lastPilotCommandMovementAnchorStamp: 1775152563,
      lastPilotCommandMovementRawDispatchStamp: 1775152561,
      lastPilotCommandDirection: cloneVector(desiredDirection),
    },
  };
  const runtimeMock = {
    getShipEntityForSession() {
      return entity;
    },
    getCurrentSimTimeMs() {
      return 1775152563000;
    },
    getCurrentDestinyStamp() {
      return 1775152563;
    },
    getCurrentSessionDestinyStamp() {
      return 1775152563;
    },
    getMovementStamp() {
      return 1775152563;
    },
    dispatchConfiguredSubwarpMovement(_entity, buildUpdates, now, options) {
      dispatched.push({
        now,
        options,
        preview: buildUpdates(1775152565),
      });
      return true;
    },
    broadcastMovementUpdates(updates, targetSession, options) {
      broadcast.push({ updates, targetSession, options });
      return true;
    },
    scheduleWatcherMovementAnchor() {},
  };

  const result = movementSubwarpCommands.gotoDirection(
    runtimeMock,
    session,
    desiredDirection,
    {
      commandSource: "CmdGotoDirection",
    },
  );

  assert.strictEqual(result, true);
  assert.strictEqual(
    dispatched.length,
    0,
    "jolts2 duplicate plain CmdGotoDirection should be suppressed after one skipped raw dispatch",
  );
  assert.strictEqual(
    broadcast.length,
    0,
    "No owner echo should be broadcast for the skipped-raw duplicate steer",
  );

  return {
    liveBefore: {
      firstDispatchStamp: 1775152564,
      duplicateDispatchStamp: 1775152565,
      duplicateCurrentAtClient: 1775152566,
    },
    after: {
      duplicateSuppressed: true,
      recentOwnerMovementRawDispatchDelta: 2,
    },
  };
}

function verifyObserverDamageWindow() {
  const scene = buildScene(1775152547000);
  const session = buildSession();
  const options = runtime._testing.buildObserverDamageStateSendOptionsForTesting({
    translateStamps: false,
  });

  scene.getCurrentVisibleSessionDestinyStamp = () => 1775152547;
  scene.getCurrentSessionDestinyStamp = () => 1775152547;
  scene.getCurrentPresentedSessionDestinyStamp = (_session, _now, maximumLead = 0) => {
    const trustedPresented = 1775152547;
    const visible = 1775152547;
    return Math.min(trustedPresented, (visible + Number(maximumLead || 0)) >>> 0) >>> 0;
  };

  const deliveryStamp = scene.resolveDestinyDeliveryStampForSession(
    session,
    1775152547,
    scene.getCurrentSimTimeMs(),
    options,
  );

  assert.strictEqual(
    deliveryStamp,
    1775152549,
    "jolts2 observer damage should move from the stale 2548 lane to 2549",
  );

  return {
    liveBefore: {
      emittedStamp: 1775152548,
      currentAtClient: 1775152549,
    },
    after: {
      emittedStamp: deliveryStamp,
      minimumLeadFromCurrentHistory: options.minimumLeadFromCurrentHistory,
      maximumLeadFromCurrentHistory: options.maximumLeadFromCurrentHistory,
    },
  };
}

function verifyObserverProjectileWindow() {
  const scene = buildScene(1775152637000);
  const session = buildSession();
  const options = runtime._testing.buildNpcOffensiveSpecialFxOptionsForTesting({
    moduleID: 980000000098,
    targetID: 991003010,
    chargeTypeID: 20040,
    start: true,
    active: true,
  });

  scene.getCurrentVisibleSessionDestinyStamp = () => 1775152637;
  scene.getCurrentSessionDestinyStamp = () => 1775152637;
  scene.getCurrentPresentedSessionDestinyStamp = (_session, _now, maximumLead = 0) => {
    const trustedPresented = 1775152637;
    const visible = 1775152637;
    return Math.min(trustedPresented, (visible + Number(maximumLead || 0)) >>> 0) >>> 0;
  };

  const deliveryStamp = scene.resolveDestinyDeliveryStampForSession(
    session,
    1775152637,
    scene.getCurrentSimTimeMs(),
    options,
  );

  assert.strictEqual(
    deliveryStamp,
    1775152639,
    "jolts2 ProjectileFired should move from the stale 2638 lane to 2639",
  );

  return {
    liveBefore: {
      emittedStamp: 1775152638,
      currentAtClient: 1775152639,
    },
    after: {
      emittedStamp: deliveryStamp,
      minimumLeadFromCurrentHistory: options.minimumLeadFromCurrentHistory,
      maximumLeadFromCurrentHistory: options.maximumLeadFromCurrentHistory,
    },
  };
}

function main() {
  const result = {
    skippedRawDuplicateGoto: verifySkippedRawDuplicateGotoSuppressed(),
    observerDamageWindow: verifyObserverDamageWindow(),
    observerProjectileWindow: verifyObserverProjectileWindow(),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main();
