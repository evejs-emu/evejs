#!/usr/bin/env node

const assert = require("assert");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";
process.env.EVEJS_DISABLE_NPC_ANCHOR_RELEVANCE = "1";

const runtime = require("../src/space/runtime");
const destiny = require("../src/space/destiny");
const movementParity = require("../src/space/movement/movementParity");

function cloneVector(vector, fallback = { x: 0, y: 0, z: 0 }) {
  const source =
    vector && typeof vector === "object"
      ? vector
      : fallback && typeof fallback === "object"
        ? fallback
        : { x: 0, y: 0, z: 0 };
  return {
    x: Number(source.x) || 0,
    y: Number(source.y) || 0,
    z: Number(source.z) || 0,
  };
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
  if (value instanceof Set) {
    return [...value].map((entry) => stableClone(entry));
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

function recordCall(calls, name, data = {}) {
  calls.push({
    name,
    data: stableClone(data),
  });
}

function getPayloadNames(updates) {
  return (Array.isArray(updates) ? updates : [])
    .map((update) => (
      update && Array.isArray(update.payload) && typeof update.payload[0] === "string"
        ? update.payload[0]
        : null
    ))
    .filter(Boolean);
}

function getUpdateStamps(updates) {
  return (Array.isArray(updates) ? updates : [])
    .map((update) => Number(update && update.stamp))
    .filter((stamp) => Number.isFinite(stamp));
}

function createSession(overrides = {}) {
  const session = {
    characterID: 9001,
    socket: {
      destroyed: false,
    },
    ...overrides,
  };
  session._space = {
    initialStateSent: true,
    simTimeMs: 1000,
    shipID: 101,
    lastPilotCommandMovementStamp: 0,
    lastPilotCommandMovementAnchorStamp: 0,
    lastPilotCommandMovementRawDispatchStamp: 0,
    lastPilotCommandDirection: null,
    ...(overrides._space || {}),
  };
  if (!session.socket) {
    session.socket = {
      destroyed: false,
    };
  }
  return session;
}

function createShipEntity(overrides = {}) {
  return {
    itemID: 101,
    kind: "ship",
    typeID: 587,
    systemID: 30000142,
    position: cloneVector(overrides.position),
    direction: cloneVector(overrides.direction, { x: 1, y: 0, z: 0 }),
    velocity: cloneVector(overrides.velocity),
    targetPoint: cloneVector(overrides.targetPoint, overrides.position),
    targetEntityID: null,
    dockingTargetID: null,
    speedFraction: 0,
    followRange: 0,
    orbitDistance: 0,
    orbitNormal: null,
    orbitSign: 1,
    warpSpeedAU: 3,
    maxVelocity: 200,
    alignTime: 5,
    radius: 50,
    mode: "STOP",
    pendingDock: null,
    pendingWarp: null,
    warpState: null,
    sessionlessWarpIngress: null,
    session: null,
    persistSpaceState: false,
    visibilitySuppressedUntilMs: 0,
    suppressWarpAcquireUntilNextTick: false,
    deferUntilInitialVisibilitySync: true,
    lastObserverCorrectionBroadcastAt: 0,
    lastObserverPositionBroadcastAt: 0,
    lastWarpCorrectionBroadcastAt: 0,
    ...overrides,
  };
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

function createMockScene(overrides = {}) {
  const calls = [];
  const scene = {
    systemID: 30000142,
    sessions: new Map(),
    dynamicEntities: new Map(),
    getCurrentSimTimeMs() {
      return 1000;
    },
    getCurrentDestinyStamp() {
      return 77;
    },
    getCurrentSessionDestinyStamp() {
      return 70;
    },
    getMovementStamp() {
      return 81;
    },
    getHistorySafeDestinyStamp() {
      return 83;
    },
    getHistorySafeSessionDestinyStamp() {
      return 84;
    },
    getNextDestinyStamp() {
      return 90;
    },
    getShipEntityForSession() {
      return null;
    },
    getEntityByID() {
      return null;
    },
    dispatchConfiguredSubwarpMovement(entity, buildUpdates, now, options) {
      const previewStamp = 500;
      recordCall(calls, "dispatchConfiguredSubwarpMovement", {
        entityID: entity && entity.itemID,
        now,
        options,
        previewStamp,
        previewUpdates: typeof buildUpdates === "function" ? buildUpdates(previewStamp) : [],
      });
      return true;
    },
    broadcastMovementUpdates(updates, excludedSession, options) {
      recordCall(calls, "broadcastMovementUpdates", {
        updates,
        excludedSession,
        options,
      });
      return true;
    },
    scheduleWatcherMovementAnchor(entity, now, reason) {
      recordCall(calls, "scheduleWatcherMovementAnchor", {
        entityID: entity && entity.itemID,
        now,
        reason,
      });
      return true;
    },
    clearPendingSubwarpMovementContract(entity) {
      recordCall(calls, "clearPendingSubwarpMovementContract", {
        entityID: entity && entity.itemID,
      });
      return true;
    },
    sendDestinyUpdates(session, updates, useQueue, options) {
      recordCall(calls, "sendDestinyUpdates", {
        session,
        updates,
        useQueue,
        options,
      });
      return true;
    },
    beginWarpDepartureOwnership(entity, now) {
      recordCall(calls, "beginWarpDepartureOwnership", {
        entityID: entity && entity.itemID,
        now,
      });
    },
    beginPilotWarpVisibilityHandoff(entity, warpState, now) {
      recordCall(calls, "beginPilotWarpVisibilityHandoff", {
        entityID: entity && entity.itemID,
        warpState,
        now,
      });
    },
    sendSessionlessWarpStartToVisibleSessions(entity, updates) {
      recordCall(calls, "sendSessionlessWarpStartToVisibleSessions", {
        entityID: entity && entity.itemID,
        updates,
      });
      return {
        deliveredCount: 1,
      };
    },
    acquireDynamicEntitiesForRelevantSessions(entities, options) {
      recordCall(calls, "acquireDynamicEntitiesForRelevantSessions", {
        entities,
        options,
      });
      return {
        success: true,
      };
    },
    canSessionSeeWarpingDynamicEntity() {
      return true;
    },
    warpDynamicEntityToPoint(entity, point, options) {
      recordCall(calls, "warpDynamicEntityToPoint", {
        entityID: entity && entity.itemID,
        point,
        options,
      });
      return {
        success: true,
        data: {
          point,
          options,
        },
      };
    },
    ...overrides,
  };
  return {
    scene,
    calls,
  };
}

function verifyGotoPointClassification() {
  const update = {
    stamp: 1,
    payload: destiny.buildGotoPointPayload(101, { x: 100, y: 0, z: 0 }),
  };
  assert.strictEqual(
    movementParity.updatesContainMovementContractPayload([update]),
    true,
    "GotoPoint must count as a movement contract payload",
  );
  assert.strictEqual(
    movementParity.isSteeringPayloadName("GotoPoint"),
    true,
    "GotoPoint must count as a steering payload name",
  );
}

function verifyWarpPrepareUsesCommittedContract(proto) {
  const session = createSession({
    _space: {
      shipID: 101,
    },
  });
  const entity = createShipEntity({
    session,
  });
  const target = {
    itemID: 909,
    kind: "ship",
    position: { x: 1.0e9, y: 0, z: 0 },
    radius: 100,
  };
  const { scene, calls } = createMockScene({
    getShipEntityForSession: () => entity,
    getEntityByID: (id) => (id === target.itemID ? target : null),
  });

  const result = proto.warpToPoint.call(
    scene,
    session,
    { x: 1.0e9, y: 0, z: 0 },
    {
      ignoreCrimewatchCheck: true,
      targetEntityID: target.itemID,
    },
  );
  assert.strictEqual(result.success, true, "warpToPoint should succeed");

  const ownerPrepare = calls.find((entry) => entry.name === "sendDestinyUpdates");
  assert(ownerPrepare, "warp prepare must send owner destiny updates");
  assert.deepStrictEqual(
    getPayloadNames(ownerPrepare.data.updates),
    ["SetMaxSpeed", "WarpTo", "OnSpecialFX", "SetSpeedFraction"],
    "pilot warp prepare must stay on the committed seed + WarpTo + FX + speed contract",
  );
  assert.deepStrictEqual(
    getUpdateStamps(ownerPrepare.data.updates),
    [83, 83, 83, 83],
    "pilot warp prepare must stay on the history-safe prepare stamp",
  );

  const watcherPrepare = calls.find((entry) => entry.name === "broadcastMovementUpdates");
  assert(watcherPrepare, "warp prepare must broadcast watcher movement updates");
  assert.deepStrictEqual(
    getPayloadNames(watcherPrepare.data.updates),
    ["GotoDirection", "SetSpeedFraction"],
    "watcher warp prepare must stay on the committed align contract",
  );
  assert.deepStrictEqual(
    getUpdateStamps(watcherPrepare.data.updates),
    [83, 83],
    "watcher warp prepare must stay on the same prepare stamp",
  );
}

function verifyDirectGotoPointCommand(proto) {
  const session = createSession();
  const entity = createShipEntity({
    session,
  });
  const { scene, calls } = createMockScene({
    getShipEntityForSession: () => entity,
  });

  const result = proto.gotoPoint.call(
    scene,
    session,
    { x: 2500, y: 10, z: -50 },
    {},
  );
  assert.strictEqual(result, true, "gotoPoint should dispatch successfully");

  const dispatchCall = calls.find(
    (entry) => entry.name === "dispatchConfiguredSubwarpMovement",
  );
  assert(dispatchCall, "gotoPoint should dispatch through the shared subwarp path");
  assert.deepStrictEqual(
    getPayloadNames(dispatchCall.data.previewUpdates),
    ["GotoPoint", "SetSpeedFraction"],
    "gotoPoint should emit GotoPoint + SetSpeedFraction when starting from STOP",
  );
}

function verifyWarpStartSuppressesPilotActivation(proto) {
  const session = createSession();
  const entity = createShipEntity({
    session,
    mode: "WARP",
    speedFraction: 1,
    pendingWarp: {
      requestedAtMs: 1000,
      prepareStamp: 83,
      prepareVisibleStamp: 84,
      stopDistance: 0,
      totalDistance: 1.0e9,
      warpSpeedAU: 3,
      rawDestination: { x: 1.0e9, y: 0, z: 0 },
      targetPoint: { x: 1.0e9, y: 0, z: 0 },
      targetEntityID: null,
    },
    targetPoint: { x: 1.0e9, y: 0, z: 0 },
  });
  const { scene, calls } = createMockScene({
    getEntityByID: (id) => (id === entity.itemID ? entity : null),
    getCurrentDestinyStamp: () => 90,
  });

  const result = proto.forceStartPendingWarp.call(scene, entity, {
    nowMs: 1000,
  });
  assert.strictEqual(result.success, true, "forceStartPendingWarp should succeed");

  const ownerActivation = calls.find((entry) => entry.name === "sendDestinyUpdates");
  assert.strictEqual(
    ownerActivation,
    undefined,
    "pilot warp start must stay silent after prepare to avoid WarpState=1 rebases",
  );

  const watcherActivation = calls.find((entry) => entry.name === "broadcastMovementUpdates");
  assert(watcherActivation, "warp start must still broadcast watcher activation updates");
  assert.deepStrictEqual(
    getPayloadNames(watcherActivation.data.updates),
    ["WarpTo", "OnSpecialFX", "SetBallMassive"],
    "watcher warp start must stay on the watcher warp family",
  );
  assert.deepStrictEqual(
    getUpdateStamps(watcherActivation.data.updates),
    [91, 91, 91],
    "watcher warp activation updates must stay on the watcher start stamp",
  );
}

function verifySessionlessVisibleWarpStart(proto) {
  const entity = createShipEntity({
    itemID: 1001,
  });
  const visibleSession = createSession();
  visibleSession._space.visibleDynamicEntityIDs = new Set([entity.itemID]);
  const hiddenSession = createSession();
  hiddenSession._space.visibleDynamicEntityIDs = new Set();
  const deadSession = createSession();
  deadSession.socket.destroyed = true;
  const { scene, calls } = createMockScene({
    sessions: new Map([
      ["visible", visibleSession],
      ["hidden", hiddenSession],
      ["dead", deadSession],
    ]),
  });

  const result = proto.sendSessionlessWarpStartToVisibleSessions.call(
    scene,
    entity,
    [{ stamp: 1, payload: ["WarpStart"] }],
  );
  assert.deepStrictEqual(
    result,
    { deliveredCount: 1 },
    "sessionless visible-session warp start must still deliver to visible sessions",
  );
  assert.strictEqual(calls.filter((entry) => entry.name === "sendDestinyUpdates").length, 1);
}

function main() {
  const proto = buildScenePrototype();
  verifyGotoPointClassification();
  verifyWarpPrepareUsesCommittedContract(proto);
  verifyDirectGotoPointCommand(proto);
  verifyWarpStartSuppressesPilotActivation(proto);
  verifySessionlessVisibleWarpStart(proto);
  console.log("Movement warp parity checks passed.");
}

main();
