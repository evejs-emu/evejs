#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";
process.env.EVEJS_DISABLE_NPC_ANCHOR_RELEVANCE = "1";

const runtime = require("../src/space/runtime");

const DEFAULT_BASELINE_PATH = path.join(
  process.cwd(),
  "tmp",
  "movement-command-extraction-baseline.json",
);

function ensureDirForFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

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
    return [...value].map((entry) => stableClone(entry)).sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
  }
  if (value instanceof Map) {
    return [...value.entries()]
      .map(([key, entry]) => [stableClone(key), stableClone(entry)])
      .sort((left, right) => JSON.stringify(left[0]).localeCompare(JSON.stringify(right[0])));
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
    };
  }
  if (typeof value === "function") {
    return "[Function]";
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

function createSession(overrides = {}) {
  const baseSpace = {
    initialStateSent: true,
    simTimeMs: 1000,
    shipID: 101,
    lastPilotCommandMovementStamp: 0,
    lastPilotCommandMovementAnchorStamp: 0,
    lastPilotCommandMovementRawDispatchStamp: 0,
    lastPilotCommandDirection: null,
  };
  const session = {
    characterID: 9001,
    socket: {
      destroyed: false,
    },
    _space: {
      ...baseSpace,
      ...(overrides._space || {}),
    },
    ...(overrides || {}),
  };
  if (!session.socket) {
    session.socket = {
      destroyed: false,
    };
  }
  if (!session._space) {
    session._space = { ...baseSpace };
  }
  return session;
}

function createShipEntity(overrides = {}) {
  const entity = {
    itemID: 101,
    kind: "ship",
    typeID: 587,
    systemID: 30000142,
    position: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    targetPoint: { x: 0, y: 0, z: 0 },
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
  entity.position = cloneVector(entity.position);
  entity.direction = cloneVector(entity.direction, { x: 1, y: 0, z: 0 });
  entity.velocity = cloneVector(entity.velocity);
  entity.targetPoint = cloneVector(entity.targetPoint, entity.position);
  return entity;
}

function recordCall(calls, name, data = {}) {
  calls.push({
    name,
    data: stableClone(data),
  });
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
        previewUpdates: typeof buildUpdates === "function" ? buildUpdates(previewStamp) : null,
      });
      return true;
    },
    broadcastPilotCommandMovementUpdates(session, updates, now, options) {
      recordCall(calls, "broadcastPilotCommandMovementUpdates", {
        session,
        updates,
        now,
        options,
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
        data: {
          acquiredCount: Array.isArray(entities) ? entities.length : 0,
        },
      };
    },
    canSessionSeeWarpingDynamicEntity(session, candidate, visibilityNow, options) {
      recordCall(calls, "canSessionSeeWarpingDynamicEntity", {
        session,
        candidate,
        visibilityNow,
        options,
      });
      return true;
    },
    syncDynamicVisibilityForAllSessions(now) {
      recordCall(calls, "syncDynamicVisibilityForAllSessions", {
        now,
      });
      return true;
    },
    warpToPoint(session, point, options) {
      recordCall(calls, "warpToPoint", {
        session,
        point,
        options,
      });
      return {
        success: true,
        data: {
          point: stableClone(point),
          options: stableClone(options),
        },
      };
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
          stub: "warpDynamicEntityToPoint",
        },
      };
    },
    forceStartPendingWarp(entity, options) {
      recordCall(calls, "forceStartPendingWarp", {
        entityID: entity && entity.itemID,
        options,
      });
      return {
        success: true,
        data: {
          warpState: {
            targetPoint: { x: 5000, y: 0, z: 0 },
          },
        },
      };
    },
    stop(session) {
      recordCall(calls, "stop", { session });
      return true;
    },
    followShipEntity(entity, targetEntityID, range, options) {
      recordCall(calls, "followShipEntity", {
        entityID: entity && entity.itemID,
        targetEntityID,
        range,
        options,
      });
      return true;
    },
    orbitShipEntity(entity, targetEntityID, distanceValue, options) {
      recordCall(calls, "orbitShipEntity", {
        entityID: entity && entity.itemID,
        targetEntityID,
        distanceValue,
        options,
      });
      return true;
    },
    stopShipEntity(entity, options) {
      recordCall(calls, "stopShipEntity", {
        entityID: entity && entity.itemID,
        options,
      });
      return true;
    },
    ...overrides,
  };
  return {
    scene,
    calls,
  };
}

function captureScenario(name, fn) {
  try {
    return {
      name,
      success: true,
      snapshot: stableClone(fn()),
    };
  } catch (error) {
    return {
      name,
      success: false,
      error: stableClone(error),
    };
  }
}

function sanitizeWarpToPointResult(result, pointToken = "[randomized-point]") {
  if (!result || typeof result !== "object") {
    return result;
  }
  return {
    ...result,
    data:
      result.data && typeof result.data === "object"
        ? {
            ...result.data,
            point: pointToken,
          }
        : result.data,
  };
}

function sanitizeWarpToPointCalls(calls, pointToken = "[randomized-point]") {
  return calls.map((entry) => (
    entry && entry.name === "warpToPoint"
      ? {
          ...entry,
          data: {
            ...entry.data,
            point: pointToken,
          },
        }
      : entry
  ));
}

function buildScenarios(proto) {
  return [
    captureScenario("gotoDirection_normal", () => {
      const session = createSession();
      const entity = createShipEntity({
        session,
      });
      const { scene, calls } = createMockScene({
        getShipEntityForSession: () => entity,
      });
      const result = proto.gotoDirection.call(
        scene,
        session,
        { x: 0, y: 1, z: 0 },
        { sendOptions: { tag: "goto" } },
      );
      return { result, calls, entity, session };
    }),
    captureScenario("gotoDirection_sameRawSuppressed", () => {
      const session = createSession({
        _space: {
          lastPilotCommandMovementStamp: 71,
          lastPilotCommandMovementAnchorStamp: 70,
          lastPilotCommandMovementRawDispatchStamp: 77,
          lastPilotCommandDirection: { x: 1, y: 0, z: 0 },
        },
      });
      const entity = createShipEntity({
        session,
        speedFraction: 1,
        mode: "GOTO",
        targetPoint: { x: 1.0e6, y: 0, z: 0 },
      });
      const { scene, calls } = createMockScene({
        getShipEntityForSession: () => entity,
      });
      const result = proto.gotoDirection.call(
        scene,
        session,
        { x: 0, y: 1, z: 0 },
        {
          commandSource: "CmdSteerDirection",
          sendOptions: { tag: "same-raw" },
        },
      );
      return { result, calls, entity, session };
    }),
    captureScenario("gotoDirection_duplicateCurrent", () => {
      const session = createSession();
      const entity = createShipEntity({
        session,
        speedFraction: 1,
        mode: "GOTO",
        targetPoint: { x: 1.0e6, y: 0, z: 0 },
      });
      const { scene, calls } = createMockScene({
        getShipEntityForSession: () => entity,
      });
      const result = proto.gotoDirection.call(
        scene,
        session,
        { x: 1, y: 0, z: 0 },
        {},
      );
      return { result, calls, entity, session };
    }),
    captureScenario("gotoDirection_adjacentRecentDuplicate", () => {
      const session = createSession({
        _space: {
          lastPilotCommandMovementStamp: 72,
          lastPilotCommandMovementAnchorStamp: 71,
          lastPilotCommandMovementRawDispatchStamp: 76,
          lastPilotCommandDirection: { x: -0.2, y: 0.4, z: 0.9 },
        },
      });
      const entity = createShipEntity({
        session,
        speedFraction: 1,
        mode: "FOLLOW",
      });
      const { scene, calls } = createMockScene({
        getShipEntityForSession: () => entity,
        getCurrentDestinyStamp() {
          return 77;
        },
        getCurrentSessionDestinyStamp() {
          return 72;
        },
      });
      const result = proto.gotoDirection.call(
        scene,
        session,
        { x: -0.2, y: 0.4, z: 0.9 },
        { sendOptions: { tag: "adjacent-duplicate" } },
      );
      return { result, calls, entity, session };
    }),
    captureScenario("gotoDirection_stop6AdjacentRawCoalesced", () => {
      const session = createSession({
        _space: {
          lastPilotCommandMovementStamp: 1774898105,
          lastPilotCommandMovementAnchorStamp: 1774898104,
          lastPilotCommandMovementRawDispatchStamp: 1774898104,
          lastPilotCommandDirection: {
            x: 0.7851041555404663,
            y: 0.05202391743659973,
            z: 0.6171751022338867,
          },
        },
      });
      const entity = createShipEntity({
        session,
        speedFraction: 1,
        mode: "GOTO",
        targetPoint: {
          x: 7851041555404663,
          y: 520239174365997.3,
          z: 6171751022338867,
        },
      });
      const { scene, calls } = createMockScene({
        getShipEntityForSession: () => entity,
        getCurrentDestinyStamp() {
          return 1774898105;
        },
        getCurrentSessionDestinyStamp() {
          return 1774898105;
        },
        getMovementStamp() {
          return 1774898106;
        },
      });
      const result = proto.gotoDirection.call(
        scene,
        session,
        {
          x: 0.7744033336639404,
          y: 0.0517071932554245,
          z: 0.6305758357048035,
        },
        { sendOptions: { tag: "stop6-adjacent-raw" } },
      );
      return { result, calls, entity, session };
    }),
    captureScenario("gotoDirection_recentCurrentDuplicate", () => {
      const session = createSession({
        _space: {
          lastPilotCommandMovementStamp: 77,
          lastPilotCommandMovementAnchorStamp: 76,
          lastPilotCommandMovementRawDispatchStamp: 80,
          lastPilotCommandDirection: {
            x: -0.847705039283543,
            y: -0.5271110367273572,
            z: 0.0595828946384571,
          },
        },
      });
      const entity = createShipEntity({
        session,
        speedFraction: 1,
        mode: "FOLLOW",
      });
      const { scene, calls } = createMockScene({
        getShipEntityForSession: () => entity,
        getCurrentDestinyStamp() {
          return 81;
        },
        getCurrentSessionDestinyStamp() {
          return 78;
        },
      });
      const result = proto.gotoDirection.call(
        scene,
        session,
        {
          x: -0.847705039283543,
          y: -0.5271110367273572,
          z: 0.0595828946384571,
        },
        { sendOptions: { tag: "recent-current-duplicate" } },
      );
      return { result, calls, entity, session };
    }),
    captureScenario("gotoDirection_recentCurrentNearDuplicate", () => {
      const session = createSession({
        _space: {
          lastPilotCommandMovementStamp: 6060,
          lastPilotCommandMovementAnchorStamp: 6059,
          lastPilotCommandMovementRawDispatchStamp: 6060,
          lastPilotCommandDirection: {
            x: 0.7639862586742434,
            y: -0.14127709503660435,
            z: -0.6295758722941582,
          },
        },
      });
      const entity = createShipEntity({
        session,
        speedFraction: 1,
        mode: "FOLLOW",
      });
      const { scene, calls } = createMockScene({
        getShipEntityForSession: () => entity,
        getCurrentDestinyStamp() {
          return 6061;
        },
        getCurrentSessionDestinyStamp() {
          return 6061;
        },
      });
      const result = proto.gotoDirection.call(
        scene,
        session,
        {
          x: 0.775304689059785,
          y: -0.14277771372340983,
          z: -0.6152374855174431,
        },
        { sendOptions: { tag: "recent-current-near-duplicate" } },
      );
      return { result, calls, entity, session };
    }),
    captureScenario("gotoDirection_pendingDuplicateSameRawCoalesced", () => {
      const session = createSession({
        _space: {
          lastPilotCommandMovementStamp: 1774897250,
          lastPilotCommandMovementAnchorStamp: 1774897249,
          lastPilotCommandMovementRawDispatchStamp: 1774897249,
          lastPilotCommandDirection: {
            x: -0.8947393298149109,
            y: -0.06507185846567154,
            z: -0.4418225884437561,
          },
        },
      });
      const entity = createShipEntity({
        session,
        speedFraction: 1,
        mode: "GOTO",
        targetPoint: {
          x: -894739.3298149109,
          y: -65071.85846567154,
          z: -441822.5884437561,
        },
      });
      const { scene, calls } = createMockScene({
        getShipEntityForSession: () => entity,
        getCurrentDestinyStamp() {
          return 1774897249;
        },
        getCurrentSessionDestinyStamp() {
          return 1774897249;
        },
      });
      const result = proto.gotoDirection.call(
        scene,
        session,
        {
          x: -0.8980890512466431,
          y: -0.06397569179534912,
          z: -0.4351359009742737,
        },
        { sendOptions: { tag: "pending-duplicate-same-raw" } },
      );
      return { result, calls, entity, session };
    }),
    captureScenario("alignTo_normal", () => {
      const session = createSession();
      const entity = createShipEntity({
        session,
      });
      const target = {
        itemID: 202,
        kind: "ship",
        position: { x: 1000, y: 200, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
      };
      const { scene, calls } = createMockScene({
        getShipEntityForSession: () => entity,
        getEntityByID: (id) => (id === target.itemID ? target : null),
      });
      const result = proto.alignTo.call(scene, session, target.itemID);
      return { result, calls, entity, target };
    }),
    captureScenario("followShipEntity_normal", () => {
      const entity = createShipEntity({
        itemID: 303,
        radius: 80,
      });
      const target = {
        itemID: 404,
        kind: "station",
        position: { x: 2500, y: 0, z: 0 },
        dockPosition: { x: 2600, y: 0, z: 0 },
        radius: 1200,
      };
      const { scene, calls } = createMockScene({
        getEntityByID: (id) => {
          if (id === entity.itemID) {
            return entity;
          }
          return id === target.itemID ? target : null;
        },
      });
      const result = proto.followShipEntity.call(
        scene,
        entity,
        target.itemID,
        1500,
        {
          dockingTargetID: target.itemID,
        },
      );
      return { result, calls, entity, target };
    }),
    captureScenario("followShipEntity_duplicate", () => {
      const entity = createShipEntity({
        itemID: 303,
        mode: "FOLLOW",
        targetEntityID: 404,
        dockingTargetID: 404,
        followRange: 1500,
        speedFraction: 1,
      });
      const target = {
        itemID: 404,
        kind: "station",
        position: { x: 2500, y: 0, z: 0 },
        dockPosition: { x: 2600, y: 0, z: 0 },
        radius: 1200,
      };
      const { scene, calls } = createMockScene({
        getEntityByID: (id) => {
          if (id === entity.itemID) {
            return entity;
          }
          return id === target.itemID ? target : null;
        },
      });
      const result = proto.followShipEntity.call(
        scene,
        entity,
        target.itemID,
        1500,
        {
          dockingTargetID: target.itemID,
        },
      );
      return { result, calls, entity, target };
    }),
    captureScenario("followBall_wrapper", () => {
      const session = createSession();
      const entity = createShipEntity({
        session,
      });
      const { scene, calls } = createMockScene({
        getShipEntityForSession: () => entity,
        followShipEntity: (shipEntity, targetEntityID, range, options) => {
          recordCall(calls, "followShipEntityWrapper", {
            shipEntity,
            targetEntityID,
            range,
            options,
          });
          return "wrapped-follow";
        },
      });
      const result = proto.followBall.call(
        scene,
        session,
        999,
        1234,
        { hello: "world" },
      );
      return { result, calls, entity };
    }),
    captureScenario("orbitShipEntity_normal", () => {
      const entity = createShipEntity({
        itemID: 505,
        position: { x: 600, y: 0, z: 0 },
        direction: { x: 0, y: 1, z: 0 },
      });
      const target = {
        itemID: 606,
        kind: "ship",
        position: { x: 0, y: 0, z: 0 },
        radius: 40,
      };
      const { scene, calls } = createMockScene({
        getEntityByID: (id) => {
          if (id === entity.itemID) {
            return entity;
          }
          return id === target.itemID ? target : null;
        },
      });
      const result = proto.orbitShipEntity.call(
        scene,
        entity,
        target.itemID,
        2000,
        {},
      );
      return { result, calls, entity, target };
    }),
    captureScenario("orbitShipEntity_duplicate", () => {
      const entity = createShipEntity({
        itemID: 505,
        mode: "ORBIT",
        speedFraction: 1,
        targetEntityID: 606,
        orbitDistance: 2000,
      });
      const target = {
        itemID: 606,
        kind: "ship",
        position: { x: 0, y: 0, z: 0 },
        radius: 40,
      };
      const { scene, calls } = createMockScene({
        getEntityByID: (id) => {
          if (id === entity.itemID) {
            return entity;
          }
          return id === target.itemID ? target : null;
        },
      });
      const result = proto.orbitShipEntity.call(
        scene,
        entity,
        target.itemID,
        2000,
        {},
      );
      return { result, calls, entity, target };
    }),
    captureScenario("orbit_wrapper", () => {
      const session = createSession();
      const entity = createShipEntity({
        session,
      });
      const { scene, calls } = createMockScene({
        getShipEntityForSession: () => entity,
        orbitShipEntity: (shipEntity, targetEntityID, distanceValue, options) => {
          recordCall(calls, "orbitShipEntityWrapper", {
            shipEntity,
            targetEntityID,
            distanceValue,
            options,
          });
          return "wrapped-orbit";
        },
      });
      const result = proto.orbit.call(
        scene,
        session,
        123,
        4567,
        { orbit: true },
      );
      return { result, calls, entity };
    }),
    captureScenario("warpToEntity_stargate", () => {
      const session = createSession();
      const entity = createShipEntity({
        session,
      });
      const target = {
        itemID: 707,
        kind: "stargate",
        position: { x: 1.0e8, y: 0, z: 0 },
        destinationSolarSystemID: 30000144,
        radius: 1000,
      };
      const { scene, calls } = createMockScene({
        getShipEntityForSession: () => entity,
        getEntityByID: (id) => (id === target.itemID ? target : null),
      });
      const result = proto.warpToEntity.call(scene, session, target.itemID, {
        minimumRange: 2500,
      });
      return {
        result: sanitizeWarpToPointResult(result, "[stargate-randomized-point]"),
        calls: sanitizeWarpToPointCalls(calls, "[stargate-randomized-point]"),
        entity,
        target,
      };
    }),
    captureScenario("warpToEntity_targetShip", () => {
      const session = createSession();
      const entity = createShipEntity({
        session,
      });
      const target = {
        itemID: 808,
        kind: "ship",
        position: { x: 2.0e8, y: 5.0e6, z: 0 },
        radius: 120,
      };
      const { scene, calls } = createMockScene({
        getShipEntityForSession: () => entity,
        getEntityByID: (id) => (id === target.itemID ? target : null),
      });
      const result = proto.warpToEntity.call(scene, session, target.itemID, {
        minimumRange: 15000,
      });
      return { result, calls, entity, target };
    }),
    captureScenario("warpToPoint_player", () => {
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
      return { result, calls, entity, session, target };
    }),
    captureScenario("warpDynamicEntityToPoint_sessionless", () => {
      const entity = createShipEntity({
        session: null,
      });
      const { scene, calls } = createMockScene({});
      const result = proto.warpDynamicEntityToPoint.call(
        scene,
        entity,
        { x: 2.0e9, y: 0, z: 0 },
        {
          ignoreCrimewatchCheck: true,
          forceImmediateStart: true,
        },
      );
      return { result, calls, entity };
    }),
    captureScenario("forceStartPendingWarp_success", () => {
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
      return { result, calls, entity, session };
    }),
    captureScenario("sendSessionlessWarpStartToVisibleSessions", () => {
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
      return { result, calls };
    }),
    captureScenario("startSessionlessWarpIngress_success", () => {
      const entity = createShipEntity({
        session: null,
      });
      const { scene, calls } = createMockScene({
        forceStartPendingWarp: (entityArg, options) => {
          recordCall(calls, "forceStartPendingWarpOverride", {
            entityID: entityArg && entityArg.itemID,
            options,
          });
          return {
            success: true,
            data: {
              warpState: {
                targetPoint: { x: 9.0e8, y: 0, z: 0 },
              },
            },
          };
        },
        warpDynamicEntityToPoint: (entityArg, point, options) => {
          recordCall(calls, "warpDynamicEntityToPointOverride", {
            entityID: entityArg && entityArg.itemID,
            point,
            options,
          });
          entityArg.pendingWarp = {
            requestedAtMs: 1000,
            totalDistance: 9.0e8,
          };
          return {
            success: true,
            data: {
              requestedAtMs: 1000,
              totalDistance: 9.0e8,
            },
          };
        },
      });
      const result = proto.startSessionlessWarpIngress.call(
        scene,
        entity,
        { x: 9.0e8, y: 0, z: 0 },
        {
          nowMs: 1000,
          broadcastWarpStartToVisibleSessions: true,
          acquireForRelevantSessions: true,
        },
      );
      return { result, calls, entity };
    }),
    captureScenario("setSpeedFraction_positive", () => {
      const session = createSession();
      const entity = createShipEntity({
        session,
      });
      const { scene, calls } = createMockScene({
        getShipEntityForSession: () => entity,
      });
      const result = proto.setSpeedFraction.call(scene, session, 0.5);
      return { result, calls, entity };
    }),
    captureScenario("setSpeedFraction_zeroDelegatesStop", () => {
      const session = createSession();
      const entity = createShipEntity({
        session,
      });
      const { scene, calls } = createMockScene({
        getShipEntityForSession: () => entity,
        stop: (sessionArg) => {
          recordCall(calls, "stopOverride", { session: sessionArg });
          return "delegated-stop";
        },
      });
      const result = proto.setSpeedFraction.call(scene, session, 0);
      return { result, calls, entity };
    }),
    captureScenario("stopShipEntity_normal", () => {
      const entity = createShipEntity({
        mode: "GOTO",
        speedFraction: 1,
        velocity: { x: 5, y: 0, z: 0 },
        targetPoint: { x: 1000, y: 0, z: 0 },
      });
      const { scene, calls } = createMockScene({
        getEntityByID: (id) => (id === entity.itemID ? entity : null),
      });
      const result = proto.stopShipEntity.call(scene, entity, {});
      return { result, calls, entity };
    }),
    captureScenario("stopShipEntity_alreadyStopped", () => {
      const entity = createShipEntity({
        mode: "STOP",
        speedFraction: 0,
        velocity: { x: 0, y: 0, z: 0 },
      });
      const { scene, calls } = createMockScene({
        getEntityByID: (id) => (id === entity.itemID ? entity : null),
      });
      const result = proto.stopShipEntity.call(scene, entity, {});
      return { result, calls, entity };
    }),
    captureScenario("stopShipEntity_activeWarpIgnored", () => {
      const entity = createShipEntity({
        mode: "WARP",
        warpState: {
          targetPoint: { x: 1.0e9, y: 0, z: 0 },
        },
        pendingWarp: null,
      });
      const { scene, calls } = createMockScene({
        getEntityByID: (id) => (id === entity.itemID ? entity : null),
      });
      const result = proto.stopShipEntity.call(scene, entity, {});
      return { result, calls, entity };
    }),
    captureScenario("stopShipEntity_sessionlessWarpAbort", () => {
      const session = createSession();
      const entity = createShipEntity({
        session,
        mode: "WARP",
        speedFraction: 1,
        position: { x: 1000, y: 0, z: 0 },
        warpState: {
          targetPoint: { x: 2000, y: 0, z: 0 },
        },
        sessionlessWarpIngress: {
          targetPoint: { x: 2100, y: 0, z: 0 },
        },
        pendingWarp: null,
      });
      const { scene, calls } = createMockScene({
        getEntityByID: (id) => (id === entity.itemID ? entity : null),
      });
      const result = proto.stopShipEntity.call(scene, entity, {
        allowSessionlessWarpAbort: true,
        reason: "test-abort",
      });
      return { result, calls, entity, session };
    }),
    captureScenario("stop_wrapper", () => {
      const session = createSession();
      const entity = createShipEntity({
        session,
      });
      const { scene, calls } = createMockScene({
        getShipEntityForSession: () => entity,
        stopShipEntity: (entityArg, options) => {
          recordCall(calls, "stopShipEntityWrapper", {
            entity: entityArg,
            options,
          });
          return "wrapped-stop";
        },
      });
      const result = proto.stop.call(scene, session);
      return { result, calls, entity };
    }),
  ];
}

function writeBaseline(filePath, snapshot) {
  ensureDirForFile(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

function readBaseline(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function compareSnapshots(expected, actual) {
  const expectedText = JSON.stringify(expected, null, 2);
  const actualText = JSON.stringify(actual, null, 2);
  return {
    matches: expectedText === actualText,
    expectedText,
    actualText,
  };
}

function findScenario(snapshot, name) {
  return Array.isArray(snapshot)
    ? snapshot.find((entry) => entry && entry.name === name)
    : null;
}

function assertParityInvariants(snapshot) {
  const sameRawGotoScenario = findScenario(snapshot, "gotoDirection_sameRawSuppressed");
  if (!sameRawGotoScenario || !sameRawGotoScenario.snapshot) {
    throw new Error("Missing gotoDirection_sameRawSuppressed scenario.");
  }
  const sameRawGotoCalls = Array.isArray(sameRawGotoScenario.snapshot.calls)
    ? sameRawGotoScenario.snapshot.calls
    : [];
  if (sameRawGotoCalls.some((entry) => entry && entry.name === "dispatchConfiguredSubwarpMovement")) {
    throw new Error("gotoDirection_sameRawSuppressed should not dispatch another owner echo.");
  }
  const sameRawGotoBroadcast = sameRawGotoCalls.find((entry) => (
    entry && entry.name === "broadcastMovementUpdates"
  ));
  if (!sameRawGotoBroadcast) {
    throw new Error("Expected gotoDirection_sameRawSuppressed to broadcast the latest steer to observers.");
  }
  const sameRawGotoUpdates =
    sameRawGotoBroadcast &&
    sameRawGotoBroadcast.data &&
    Array.isArray(sameRawGotoBroadcast.data.updates)
      ? sameRawGotoBroadcast.data.updates
      : [];
  const sameRawGotoNames = sameRawGotoUpdates.map((entry) => (
    entry &&
    Array.isArray(entry.payload) &&
    typeof entry.payload[0] === "string"
      ? entry.payload[0]
      : null
  )).filter(Boolean);
  if (sameRawGotoNames.join(",") !== "GotoDirection") {
    throw new Error(`Expected gotoDirection_sameRawSuppressed to send only the latest observer GotoDirection, got ${JSON.stringify(sameRawGotoNames)}.`);
  }
  const sameRawGotoSession =
    sameRawGotoScenario.snapshot && sameRawGotoScenario.snapshot.session
      ? sameRawGotoScenario.snapshot.session
      : null;
  if (!sameRawGotoSession || !sameRawGotoSession._space) {
    throw new Error("Missing gotoDirection_sameRawSuppressed session snapshot.");
  }
  if ((Number(sameRawGotoSession._space.lastPilotCommandMovementStamp) >>> 0) !== 71) {
    throw new Error(`Expected gotoDirection_sameRawSuppressed to keep the first owner echo stamp 71, got ${sameRawGotoSession._space.lastPilotCommandMovementStamp}.`);
  }
  if ((Number(sameRawGotoSession._space.lastPilotCommandMovementAnchorStamp) >>> 0) !== 70) {
    throw new Error(`Expected gotoDirection_sameRawSuppressed anchor to stay on live owner tick 70, got ${sameRawGotoSession._space.lastPilotCommandMovementAnchorStamp}.`);
  }
  if ((Number(sameRawGotoSession._space.lastPilotCommandMovementRawDispatchStamp) >>> 0) !== 77) {
    throw new Error(`Expected gotoDirection_sameRawSuppressed raw dispatch stamp to stay on 77, got ${sameRawGotoSession._space.lastPilotCommandMovementRawDispatchStamp}.`);
  }
  if (!(sameRawGotoSession._space.lastPilotCommandDirection && Number(sameRawGotoSession._space.lastPilotCommandDirection.y) > 0.9)) {
    throw new Error("Expected gotoDirection_sameRawSuppressed to retain the latest steering heading.");
  }

  const speedScenario = findScenario(snapshot, "setSpeedFraction_positive");
  if (!speedScenario || !speedScenario.snapshot) {
    throw new Error("Missing setSpeedFraction_positive scenario.");
  }
  const speedCalls = Array.isArray(speedScenario.snapshot.calls)
    ? speedScenario.snapshot.calls
    : [];
  const speedBroadcast = speedCalls.find((entry) => entry && entry.name === "broadcastMovementUpdates");
  if (!speedBroadcast) {
    throw new Error("Expected setSpeedFraction_positive to use broadcastMovementUpdates.");
  }
  if (speedCalls.some((entry) => entry && entry.name === "broadcastPilotCommandMovementUpdates")) {
    throw new Error("setSpeedFraction_positive should not use broadcastPilotCommandMovementUpdates.");
  }
  const speedUpdates =
    speedBroadcast &&
    speedBroadcast.data &&
    Array.isArray(speedBroadcast.data.updates)
      ? speedBroadcast.data.updates
      : [];
  const speedStamps = speedUpdates.map((entry) => Number(entry && entry.stamp));
  if (speedStamps.length === 0 || speedStamps.some((stamp) => stamp !== 84)) {
    throw new Error(`Expected setSpeedFraction_positive updates to use history-safe stamp 84, got ${JSON.stringify(speedStamps)}.`);
  }

  const stopScenario = findScenario(snapshot, "stopShipEntity_normal");
  if (!stopScenario || !stopScenario.snapshot) {
    throw new Error("Missing stopShipEntity_normal scenario.");
  }
  const stopCalls = Array.isArray(stopScenario.snapshot.calls)
    ? stopScenario.snapshot.calls
    : [];
  const stopBroadcast = stopCalls.find((entry) => entry && entry.name === "broadcastMovementUpdates");
  if (!stopBroadcast) {
    throw new Error("Expected stopShipEntity_normal to use broadcastMovementUpdates.");
  }
  if (stopCalls.some((entry) => entry && entry.name === "broadcastPilotCommandMovementUpdates")) {
    throw new Error("stopShipEntity_normal should not use broadcastPilotCommandMovementUpdates.");
  }
  const stopUpdates =
    stopBroadcast &&
    stopBroadcast.data &&
    Array.isArray(stopBroadcast.data.updates)
      ? stopBroadcast.data.updates
      : [];
  const stopStamps = stopUpdates.map((entry) => Number(entry && entry.stamp));
  if (stopStamps.length === 0 || stopStamps.some((stamp) => stamp !== 84)) {
    throw new Error(`Expected stopShipEntity_normal updates to use history-safe stamp 84, got ${JSON.stringify(stopStamps)}.`);
  }
}

function main() {
  const mode = String(process.argv[2] || "verify").toLowerCase();
  const baselinePath = path.resolve(process.argv[3] || DEFAULT_BASELINE_PATH);
  const prototype = buildScenePrototype();
  const snapshot = buildScenarios(prototype);
  assertParityInvariants(snapshot);

  if (mode === "record") {
    writeBaseline(baselinePath, snapshot);
    console.log(`Recorded movement command baseline to ${baselinePath}`);
    return;
  }

  if (!fs.existsSync(baselinePath)) {
    console.error(`Baseline file not found: ${baselinePath}`);
    process.exitCode = 1;
    return;
  }

  const expected = readBaseline(baselinePath);
  const comparison = compareSnapshots(expected, snapshot);
  if (!comparison.matches) {
    console.error("Movement command extraction regression detected.");
    console.error(`Baseline: ${baselinePath}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Movement command extraction verified against ${baselinePath}`);
}

main();
