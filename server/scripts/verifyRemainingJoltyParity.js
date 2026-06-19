#!/usr/bin/env node

const assert = require("assert");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";
process.env.EVEJS_DISABLE_NPC_ANCHOR_RELEVANCE = "1";

const runtime = require("../src/space/runtime");
const {
  resolveOwnerMovementRestampState,
  OWNER_PENDING_GOTO_DUPLICATE_ALIGNMENT,
} = require("../src/space/movement/movementDeliveryPolicy");
const {
  createMovementSubwarpCommands,
} = require("../src/space/movement/commands/movementSubwarpCommands");
const {
  createMovementContractDispatch,
} = require("../src/space/movement/dispatch/movementContractDispatch");

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

function addVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) + toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) + toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) + toFiniteNumber(right && right.z, 0),
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

function directionsNearlyMatch(left, right, minimumDot = OWNER_PENDING_GOTO_DUPLICATE_ALIGNMENT) {
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

function buildScenePrototype() {
  runtime._testing.clearScenes();
  const scene = runtime.ensureScene(30000142, {
    refreshStargates: false,
  });
  const prototype = Object.getPrototypeOf(scene);
  runtime._testing.clearScenes();
  return prototype;
}

function verifyPlainGotoLeadPlumbing() {
  const captured = [];
  const movementSubwarpCommands = createMovementSubwarpCommands({
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
  const entity = {
    itemID: 990112367,
    position: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    targetPoint: { x: 0, y: 1.0e16, z: 0 },
    targetEntityID: null,
    speedFraction: 1,
    mode: "GOTO",
    pendingDock: null,
  };
  const session = {
    characterID: 140000002,
    socket: {
      destroyed: false,
    },
    _space: {
      shipID: entity.itemID,
      lastPilotCommandMovementStamp: 0,
      lastPilotCommandMovementAnchorStamp: 0,
      lastPilotCommandMovementRawDispatchStamp: 0,
      lastPilotCommandDirection: null,
    },
  };
  const runtimeMock = {
    getShipEntityForSession() {
      return entity;
    },
    getCurrentSimTimeMs() {
      return 1775005695000;
    },
    getCurrentDestinyStamp() {
      return 1775005695;
    },
    getCurrentSessionDestinyStamp() {
      return 1775005695;
    },
    getMovementStamp() {
      return 1775005695;
    },
    dispatchConfiguredSubwarpMovement(_entity, buildUpdates, now, options) {
      captured.push({
        now,
        options,
        previewUpdates: buildUpdates(1775005695),
      });
      return true;
    },
    broadcastMovementUpdates() {
      throw new Error("owner echo should not be suppressed in this scenario");
    },
    scheduleWatcherMovementAnchor() {},
  };

  movementSubwarpCommands.gotoDirection(
    runtimeMock,
    session,
    { x: -0.4, y: -0.2, z: 0.9 },
    {
      commandSource: "CmdGotoDirection",
      ownerLocallyPredictsHeading: false,
    },
  );

  assert.strictEqual(captured.length, 1);
  assert.strictEqual(
    captured[0].options.ownerDirectEchoLeadOverride,
    2,
    "Expected plain moving CmdGotoDirection to request the held-future +2 owner echo lane.",
  );

  return {
    appliedLeadOverride: captured[0].options.ownerDirectEchoLeadOverride,
    previewStamp:
      toInt(captured[0].previewUpdates && captured[0].previewUpdates[0] && captured[0].previewUpdates[0].stamp, 0) >>> 0,
  };
}

function verifyOwnerRestampBeforeAfter() {
  const baseOptions = {
    ownerMovementUpdates: [{
      stamp: 1775005695,
      payload: ["GotoDirection", [990112367, -0.4, -0.2, 0.9]],
    }],
    ownerHasSteeringCommand: true,
    currentRawDispatchStamp: 1775005695,
    liveOwnerSessionStamp: 1775005695,
    currentVisibleOwnerStamp: 1775005695,
    quietWindowMinimumStamp: 0,
    lastFreshAcquireLifecycleStamp: 1775005517,
    lastOwnerNonMissileCriticalStamp: 0,
    lastOwnerNonMissileCriticalRawDispatchStamp: 0,
    lastOwnerMissileLifecycleStamp: 0,
    lastOwnerMissileLifecycleRawDispatchStamp: 0,
    lastOwnerMissileFreshAcquireStamp: 0,
    lastOwnerMissileFreshAcquireRawDispatchStamp: 0,
    previousOwnerPilotCommandStamp: 0,
    previousOwnerPilotCommandAnchorStamp: 0,
    previousOwnerPilotCommandRawDispatchStamp: 0,
    previousOwnerPilotCommandDirectionRaw: null,
    normalizeVector,
    directionsNearlyMatch,
    getPendingHistorySafeStamp(authoredStamp, minimumLead = 0) {
      return Math.max(
        toInt(authoredStamp, 0) >>> 0,
        (1775005695 + toInt(minimumLead, 0)) >>> 0,
      ) >>> 0;
    },
    defaultRight: { x: 1, y: 0, z: 0 },
  };

  const beforeState = resolveOwnerMovementRestampState(baseOptions);
  const afterState = resolveOwnerMovementRestampState({
    ...baseOptions,
    ownerDirectEchoLeadOverride: 2,
  });
  const beforeStamp =
    toInt(beforeState.ownerUpdates && beforeState.ownerUpdates[0] && beforeState.ownerUpdates[0].stamp, 0) >>> 0;
  const afterStamp =
    toInt(afterState.ownerUpdates && afterState.ownerUpdates[0] && afterState.ownerUpdates[0].stamp, 0) >>> 0;

  assert.strictEqual(beforeStamp, 1775005696);
  assert.strictEqual(afterStamp, 1775005697);

  return {
    beforeStamp,
    afterStamp,
  };
}

function buildContractDispatchDeps() {
  return {
    cloneVector,
    isReadyForDestiny(session) {
      return Boolean(session && session._space);
    },
    logMissileDebug() {},
    normalizeVector,
    roundNumber(value) {
      return value;
    },
    sessionMatchesIdentity(left, right) {
      return left === right;
    },
    summarizeRuntimeEntityForMissileDebug() {
      return {};
    },
    buildMissileSessionSnapshot() {
      return {};
    },
    toFiniteNumber,
    toInt,
    MICHELLE_HELD_FUTURE_DESTINY_LEAD: 2,
    PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS: 4,
    MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD: 3,
  };
}

function verifyObserverFollowBallBeforeAfter() {
  const dispatch = createMovementContractDispatch(buildContractDispatchDeps());
  const captured = [];
  const observerSession = {
    clientID: 1065450,
    characterID: 140000002,
    socket: {
      destroyed: false,
    },
    _space: {
      shipID: 990112367,
      lastSentDestinyStamp: 1775005682,
      lastSentDestinyRawDispatchStamp: 1775005679,
      lastSentDestinyOnlyStaleProjectedOwnerMissileLane: false,
    },
  };
  const npcEntity = {
    itemID: 980000000113,
    session: null,
  };
  const runtimeMock = {
    pendingSubwarpMovementContracts: new Map(),
    dynamicEntities: new Map([[npcEntity.itemID, npcEntity]]),
    sessions: new Map([[observerSession.clientID, observerSession]]),
    getCurrentSimTimeMs() {
      return 1775005680000;
    },
    getCurrentDestinyStamp() {
      return 1775005680;
    },
    getCurrentVisibleSessionDestinyStamp() {
      return 1775005680;
    },
    getCurrentPresentedSessionDestinyStamp() {
      return 1775005682;
    },
    getCurrentSessionDestinyStamp() {
      return 1775005680;
    },
    filterMovementUpdatesForSession(_session, updates) {
      return updates;
    },
    getHistorySafeDestinyStamp() {
      return 1775005682;
    },
    hasActiveTickDestinyPresentationBatch() {
      return false;
    },
    sendDestinyUpdates(_session, updates) {
      captured.push(updates);
      return updates.reduce(
        (highestStamp, update) => Math.max(highestStamp, toInt(update && update.stamp, 0) >>> 0),
        0,
      ) >>> 0;
    },
  };

  dispatch.queueSubwarpMovementContract(
    runtimeMock,
    npcEntity,
    (stamp) => [{
      stamp,
      payload: ["FollowBall", [npcEntity.itemID, observerSession._space.shipID, 3000]],
    }],
    {
      nowMs: runtimeMock.getCurrentSimTimeMs(),
    },
  );
  dispatch.flushPendingSubwarpMovementContracts(runtimeMock, runtimeMock.getCurrentSimTimeMs());

  assert.strictEqual(captured.length, 1);
  const afterStamp =
    toInt(captured[0] && captured[0][0] && captured[0][0].stamp, 0) >>> 0;
  const beforeStamp = 1775005682;
  assert.strictEqual(afterStamp, 1775005683);

  return {
    beforeStamp,
    afterStamp,
  };
}

function verifyOwnerLeadOverrideDispatchHandoff() {
  const dispatch = createMovementContractDispatch(buildContractDispatchDeps());
  const captured = [];
  const ownerSession = {
    clientID: 1065450,
    characterID: 140000002,
    socket: {
      destroyed: false,
    },
    _space: {
      shipID: 990112367,
    },
  };
  const ownerEntity = {
    itemID: 990112367,
    session: ownerSession,
  };
  const runtimeMock = {
    getCurrentSimTimeMs() {
      return 1775033368000;
    },
    shouldDeferPilotMovementForMissilePressure() {
      return false;
    },
    getMovementStamp() {
      return 1775033368;
    },
    broadcastPilotCommandMovementUpdates(_session, updates, nowMs, options) {
      captured.push({
        updates,
        nowMs,
        options,
      });
      return true;
    },
    queueSubwarpMovementContract() {
      throw new Error("expected direct owner movement dispatch");
    },
  };

  dispatch.dispatchConfiguredSubwarpMovement(
    runtimeMock,
    ownerEntity,
    (stamp) => [{
      stamp,
      payload: ["GotoDirection", [ownerEntity.itemID, -0.5, 0.3, 0.8]],
    }],
    runtimeMock.getCurrentSimTimeMs(),
    {
      ownerDirectEchoLeadOverride: 2,
      sendOptions: {
        translateStamps: false,
      },
    },
  );

  assert.strictEqual(captured.length, 1);
  assert.strictEqual(
    toInt(captured[0].options && captured[0].options.ownerDirectEchoLeadOverride, 0),
    2,
    "Expected direct contract dispatch to preserve ownerDirectEchoLeadOverride into owner movement delivery.",
  );

  return {
    preservedLeadOverride:
      toInt(captured[0].options && captured[0].options.ownerDirectEchoLeadOverride, 0) >>> 0,
    stampedUpdate:
      toInt(captured[0].updates && captured[0].updates[0] && captured[0].updates[0].stamp, 0) >>> 0,
  };
}

function verifyJolty11PresentedNonCriticalOwnerEchoFloor() {
  const commonOptions = {
    ownerHasSteeringCommand: true,
    ownerDirectEchoLeadOverride: 2,
    quietWindowMinimumStamp: 0,
    lastFreshAcquireLifecycleStamp: 1775035273,
    lastOwnerMissileLifecycleStamp: 0,
    lastOwnerMissileLifecycleRawDispatchStamp: 0,
    lastOwnerMissileFreshAcquireStamp: 0,
    lastOwnerMissileFreshAcquireRawDispatchStamp: 0,
    normalizeVector,
    directionsNearlyMatch,
    getPendingHistorySafeStamp(authoredStamp, minimumLead = 0) {
      return Math.max(
        toInt(authoredStamp, 0) >>> 0,
        (
          this.liveOwnerSessionStamp +
          toInt(minimumLead, 0)
        ) >>> 0,
      ) >>> 0;
    },
    defaultRight: { x: 1, y: 0, z: 0 },
  };

  const beforeFirst = resolveOwnerMovementRestampState({
    ...commonOptions,
    ownerMovementUpdates: [{
      stamp: 1775035299,
      payload: ["GotoDirection", [990112367, -0.5, -0.2, 0.9]],
    }],
    currentRawDispatchStamp: 1775035299,
    liveOwnerSessionStamp: 1775035299,
    currentVisibleOwnerStamp: 1775035299,
    currentPresentedOwnerStamp: 0,
    previousLastSentDestinyWasOwnerCritical: false,
    lastOwnerNonMissileCriticalStamp: 1775035292,
    lastOwnerNonMissileCriticalRawDispatchStamp: 1775035290,
    previousOwnerPilotCommandStamp: 1775035292,
    previousOwnerPilotCommandAnchorStamp: 1775035290,
    previousOwnerPilotCommandRawDispatchStamp: 1775035290,
    previousOwnerPilotCommandDirectionRaw: { x: 0, y: 0, z: 0 },
    getPendingHistorySafeStamp(authoredStamp, minimumLead = 0) {
      return Math.max(
        toInt(authoredStamp, 0) >>> 0,
        (1775035299 + toInt(minimumLead, 0)) >>> 0,
      ) >>> 0;
    },
  });
  const afterFirst = resolveOwnerMovementRestampState({
    ...commonOptions,
    ownerMovementUpdates: [{
      stamp: 1775035299,
      payload: ["GotoDirection", [990112367, -0.5, -0.2, 0.9]],
    }],
    currentRawDispatchStamp: 1775035299,
    liveOwnerSessionStamp: 1775035299,
    currentVisibleOwnerStamp: 1775035299,
    currentPresentedOwnerStamp: 1775035300,
    previousLastSentDestinyWasOwnerCritical: false,
    lastOwnerNonMissileCriticalStamp: 1775035292,
    lastOwnerNonMissileCriticalRawDispatchStamp: 1775035290,
    previousOwnerPilotCommandStamp: 1775035292,
    previousOwnerPilotCommandAnchorStamp: 1775035290,
    previousOwnerPilotCommandRawDispatchStamp: 1775035290,
    previousOwnerPilotCommandDirectionRaw: { x: 0, y: 0, z: 0 },
    getPendingHistorySafeStamp(authoredStamp, minimumLead = 0) {
      return Math.max(
        toInt(authoredStamp, 0) >>> 0,
        (1775035299 + toInt(minimumLead, 0)) >>> 0,
      ) >>> 0;
    },
  });
  const beforeSecond = resolveOwnerMovementRestampState({
    ...commonOptions,
    ownerMovementUpdates: [{
      stamp: 1775035300,
      payload: ["GotoDirection", [990112367, -0.8, -0.2, 0.5]],
    }],
    currentRawDispatchStamp: 1775035300,
    liveOwnerSessionStamp: 1775035300,
    currentVisibleOwnerStamp: 1775035300,
    currentPresentedOwnerStamp: 0,
    previousLastSentDestinyWasOwnerCritical: false,
    lastOwnerNonMissileCriticalStamp: 1775035301,
    lastOwnerNonMissileCriticalRawDispatchStamp: 1775035299,
    previousOwnerPilotCommandStamp: 1775035301,
    previousOwnerPilotCommandAnchorStamp: 1775035299,
    previousOwnerPilotCommandRawDispatchStamp: 1775035299,
    previousOwnerPilotCommandDirectionRaw: { x: -0.5, y: -0.2, z: 0.9 },
    getPendingHistorySafeStamp(authoredStamp, minimumLead = 0) {
      return Math.max(
        toInt(authoredStamp, 0) >>> 0,
        (1775035300 + toInt(minimumLead, 0)) >>> 0,
      ) >>> 0;
    },
  });
  const afterSecond = resolveOwnerMovementRestampState({
    ...commonOptions,
    ownerMovementUpdates: [{
      stamp: 1775035300,
      payload: ["GotoDirection", [990112367, -0.8, -0.2, 0.5]],
    }],
    currentRawDispatchStamp: 1775035300,
    liveOwnerSessionStamp: 1775035300,
    currentVisibleOwnerStamp: 1775035300,
    currentPresentedOwnerStamp: 1775035301,
    previousLastSentDestinyWasOwnerCritical: false,
    lastOwnerNonMissileCriticalStamp: 1775035301,
    lastOwnerNonMissileCriticalRawDispatchStamp: 1775035299,
    previousOwnerPilotCommandStamp: 1775035301,
    previousOwnerPilotCommandAnchorStamp: 1775035299,
    previousOwnerPilotCommandRawDispatchStamp: 1775035299,
    previousOwnerPilotCommandDirectionRaw: { x: -0.5, y: -0.2, z: 0.9 },
    getPendingHistorySafeStamp(authoredStamp, minimumLead = 0) {
      return Math.max(
        toInt(authoredStamp, 0) >>> 0,
        (1775035300 + toInt(minimumLead, 0)) >>> 0,
      ) >>> 0;
    },
  });

  const beforeFirstStamp =
    toInt(beforeFirst.ownerUpdates && beforeFirst.ownerUpdates[0] && beforeFirst.ownerUpdates[0].stamp, 0) >>> 0;
  const afterFirstStamp =
    toInt(afterFirst.ownerUpdates && afterFirst.ownerUpdates[0] && afterFirst.ownerUpdates[0].stamp, 0) >>> 0;
  const beforeSecondStamp =
    toInt(beforeSecond.ownerUpdates && beforeSecond.ownerUpdates[0] && beforeSecond.ownerUpdates[0].stamp, 0) >>> 0;
  const afterSecondStamp =
    toInt(afterSecond.ownerUpdates && afterSecond.ownerUpdates[0] && afterSecond.ownerUpdates[0].stamp, 0) >>> 0;

  assert.strictEqual(beforeFirstStamp, 1775035301);
  assert.strictEqual(afterFirstStamp, 1775035302);
  assert.strictEqual(beforeSecondStamp, 1775035301);
  assert.strictEqual(afterSecondStamp, 1775035303);

  return {
    firstWindow: {
      beforeStamp: beforeFirstStamp,
      afterStamp: afterFirstStamp,
    },
    secondWindow: {
      beforeStamp: beforeSecondStamp,
      afterStamp: afterSecondStamp,
    },
  };
}

function verifyAwfulPresentedOwnerRecoveryWindow() {
  const commonOptions = {
    ownerMovementUpdates: [{
      stamp: 1775081887,
      payload: ["GotoDirection", [991002978, -0.4, 0, -0.9]],
    }],
    ownerHasSteeringCommand: true,
    currentRawDispatchStamp: 1775081887,
    liveOwnerSessionStamp: 1775081887,
    currentVisibleOwnerStamp: 1775081887,
    currentPresentedOwnerStamp: 1775081889,
    previousLastSentDestinyWasOwnerCritical: false,
    quietWindowMinimumStamp: 0,
    lastFreshAcquireLifecycleStamp: 1775081878,
    lastOwnerNonMissileCriticalStamp: 1775081879,
    lastOwnerNonMissileCriticalRawDispatchStamp: 1775081876,
    lastOwnerMissileLifecycleStamp: 0,
    lastOwnerMissileLifecycleRawDispatchStamp: 0,
    lastOwnerMissileFreshAcquireStamp: 0,
    lastOwnerMissileFreshAcquireRawDispatchStamp: 0,
    previousOwnerPilotCommandStamp: 1775081879,
    previousOwnerPilotCommandAnchorStamp: 1775081876,
    previousOwnerPilotCommandRawDispatchStamp: 1775081876,
    previousOwnerPilotCommandDirectionRaw: { x: 0, y: 0, z: 0 },
    normalizeVector,
    directionsNearlyMatch,
    getPendingHistorySafeStamp(authoredStamp, minimumLead = 0) {
      return Math.max(
        toInt(authoredStamp, 0) >>> 0,
        (1775081887 + toInt(minimumLead, 0)) >>> 0,
      ) >>> 0;
    },
    defaultRight: { x: 1, y: 0, z: 0 },
  };

  const beforeState = resolveOwnerMovementRestampState(commonOptions);
  const afterState = resolveOwnerMovementRestampState({
    ...commonOptions,
    ownerDirectEchoLeadOverride: 2,
  });

  const beforeStamp =
    toInt(beforeState.ownerUpdates && beforeState.ownerUpdates[0] && beforeState.ownerUpdates[0].stamp, 0) >>> 0;
  const afterStamp =
    toInt(afterState.ownerUpdates && afterState.ownerUpdates[0] && afterState.ownerUpdates[0].stamp, 0) >>> 0;

  assert.strictEqual(beforeStamp, 1775081888);
  assert.strictEqual(afterStamp, 1775081890);

  return {
    beforeStamp,
    afterStamp,
  };
}

function verifyExplodingRemovalBeforeAfter() {
  const proto = buildScenePrototype();
  const queued = [];
  const session = {
    clientID: 1065450,
    characterID: 140000002,
    socket: {
      destroyed: false,
    },
    _space: {
      initialStateSent: true,
      shipID: 990112367,
      visibleDynamicEntityIDs: new Set([980000000101]),
      freshlyVisibleDynamicEntityIDs: new Set([980000000101]),
    },
  };
  const scene = {
    systemID: 30000142,
    sessions: new Map([[session.clientID, session]]),
    getCurrentSimTimeMs() {
      return 1775005767000;
    },
    getCurrentDestinyStamp() {
      return 1775005767;
    },
    getNextDestinyStamp() {
      return 1775005768;
    },
    getCurrentVisibleDestinyStampForSession(_session, baseStamp) {
      return Number(baseStamp) || 1775005767;
    },
    getCurrentSessionDestinyStamp() {
      return 1775005767;
    },
    getImmediateDestinyStampForSession(_session, currentStamp = 1775005767) {
      return (toInt(currentStamp, 1775005767) - 1) >>> 0;
    },
    getHistorySafeSessionDestinyStamp(_session, _nowMs, minimumLead) {
      return minimumLead >= 2 ? 1775005768 : 1775005767;
    },
    getCurrentPresentedSessionDestinyStamp() {
      return 1775005767;
    },
    hasActiveTickDestinyPresentationBatch() {
      return true;
    },
    queueTickDestinyPresentationUpdates(_session, updates) {
      queued.push(updates);
    },
    sendDestinyUpdates() {},
    canSessionSeeDynamicEntity() {
      return false;
    },
  };

  proto.broadcastRemoveBall.call(scene, 980000000101, null, {
    terminalDestructionEffectID: 3,
    visibilityEntity: {
      itemID: 980000000101,
      kind: "wreck",
    },
  });

  assert.strictEqual(queued.length, 1);
  const afterStamp =
    toInt(queued[0] && queued[0][0] && queued[0][0].stamp, 0) >>> 0;
  const beforeStamp = 1775005767;
  assert.strictEqual(afterStamp, 1775005768);

  return {
    beforeStamp,
    afterStamp,
  };
}

function main() {
  const snapshots = {
    plainGotoLeadPlumbing: verifyPlainGotoLeadPlumbing(),
    ownerLeadOverrideDispatchHandoff: verifyOwnerLeadOverrideDispatchHandoff(),
    ownerRestampBeforeAfter: verifyOwnerRestampBeforeAfter(),
    awfulPresentedOwnerRecoveryWindow:
      verifyAwfulPresentedOwnerRecoveryWindow(),
    jolty11PresentedNonCriticalOwnerEchoFloor:
      verifyJolty11PresentedNonCriticalOwnerEchoFloor(),
    observerFollowBallBeforeAfter: verifyObserverFollowBallBeforeAfter(),
    explodingRemovalBeforeAfter: verifyExplodingRemovalBeforeAfter(),
  };
  console.log(JSON.stringify(snapshots, null, 2));
}

main();
