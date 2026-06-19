#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";
process.env.EVEJS_DISABLE_NPC_ANCHOR_RELEVANCE = "1";

const runtime = require("../src/space/runtime");
const destiny = require("../src/space/destiny");

const DEFAULT_BASELINE_PATH = path.join(
  process.cwd(),
  "tmp",
  "movement-destiny-dispatch-baseline.json",
);

function ensureDirForFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
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
  if (value instanceof Map) {
    return [...value.entries()].map(([key, entry]) => [
      stableClone(key),
      stableClone(entry),
    ]);
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

function createSession(overrides = {}) {
  const notifications = [];
  const session = {
    clientID: 111,
    characterID: 222,
    socket: {
      destroyed: false,
    },
    _space: {
      initialStateSent: true,
      simTimeMs: 1000,
      simFileTime: "0",
      timeDilation: 1,
      shipID: 9001,
      lastVisibleDynamicDestinyStamp: 70,
      lastMissileLifecycleStamp: 0,
      lastMissileLifecycleRawDispatchStamp: 0,
      lastOwnerMissileLifecycleStamp: 0,
      lastOwnerMissileLifecycleRawDispatchStamp: 0,
      ...((overrides && overrides._space) || {}),
    },
    sendNotification(name, target, payload) {
      notifications.push(
        stableClone({
          name,
          target,
          payload,
        }),
      );
    },
    ...overrides,
  };
  if (!session.socket) {
    session.socket = {
      destroyed: false,
    };
  }
  if (!session._space) {
    session._space = {
      initialStateSent: true,
      shipID: 9001,
    };
  }
  return {
    session,
    notifications,
  };
}

function createScene(proto, overrides = {}) {
  const sendCalls = [];
  const scene = Object.assign(Object.create(proto), {
    systemID: 30000142,
    nextStamp: 77,
    _tickDestinyPresentation: null,
    getCurrentSimTimeMs() {
      return 1000;
    },
    getCurrentDestinyStamp() {
      return 77;
    },
    getCurrentSessionDestinyStamp() {
      return 70;
    },
    getCurrentVisibleSessionDestinyStamp() {
      return 70;
    },
    getCurrentPresentedSessionDestinyStamp() {
      return 71;
    },
    getImmediateDestinyStampForSession(session, currentSessionStamp) {
      return toInt(currentSessionStamp, 0) >>> 0;
    },
    getSessionClockOffsetMs() {
      return 0;
    },
    translateDestinyStampForSession(session, rawStamp) {
      return toInt(rawStamp, 0) >>> 0;
    },
    getHistoryFloorDestinyStampForSession() {
      return 70;
    },
    refreshSessionClockSnapshot() {},
    sendDestinyUpdates(session, updates, waitForBubble, options) {
      sendCalls.push(
        stableClone({
          session,
          updates,
          waitForBubble,
          options,
        }),
      );
      return (Array.isArray(updates) ? updates : []).reduce(
        (highestStamp, update) => Math.max(highestStamp, toInt(update && update.stamp, 0) >>> 0),
        0,
      ) >>> 0;
    },
    ...overrides,
  });
  return {
    scene,
    sendCalls,
  };
}

function captureResolveDeliveryFloor(proto) {
  const { session } = createSession();
  const { scene } = createScene(proto, {
    getDestinyHistoryAnchorStampForSession() {
      return 70;
    },
  });
  return {
    authored68: proto.resolveDestinyDeliveryStampForSession.call(
      scene,
      session,
      68,
      1000,
      {
        minimumLeadFromCurrentHistory: 1,
        maximumLeadFromCurrentHistory: 2,
      },
    ),
    authored72: proto.resolveDestinyDeliveryStampForSession.call(
      scene,
      session,
      72,
      1000,
      {
        minimumLeadFromCurrentHistory: 1,
        maximumLeadFromCurrentHistory: 2,
      },
    ),
    authored74: proto.resolveDestinyDeliveryStampForSession.call(
      scene,
      session,
      74,
      1000,
      {
        minimumLeadFromCurrentHistory: 1,
        maximumLeadFromCurrentHistory: 2,
      },
    ),
  };
}

function capturePrepareRestamp(proto) {
  const { session } = createSession();
  const { scene } = createScene(proto, {
    getDestinyHistoryAnchorStampForSession() {
      return 70;
    },
  });
  return proto.prepareDestinyUpdateForSession.call(
    scene,
    session,
    {
      stamp: 68,
      payload: destiny.buildSetSpeedFractionPayload(9001, 0.5),
    },
    1000,
    {
      minimumLeadFromCurrentHistory: 1,
      maximumLeadFromCurrentHistory: 2,
    },
  );
}

function captureInactiveQueue(proto) {
  const { session } = createSession();
  const { scene, sendCalls } = createScene(proto);
  const updates = [
    {
      stamp: 70,
      payload: destiny.buildSetSpeedFractionPayload(9001, 0.5),
    },
  ];
  const queuedCount = proto.queueTickDestinyPresentationUpdates.call(
    scene,
    session,
    updates,
    {
      sendOptions: {
        minimumLeadFromCurrentHistory: 1,
      },
    },
  );
  return {
    queuedCount,
    sendCalls,
  };
}

function captureActiveQueueFlush(proto) {
  const { session } = createSession();
  const { scene, sendCalls } = createScene(proto);
  proto.beginTickDestinyPresentationBatch.call(scene);
  proto.queueTickDestinyPresentationUpdates.call(
    scene,
    session,
    [
      {
        stamp: 70,
        payload: destiny.buildSetSpeedFractionPayload(9001, 0.2),
      },
      {
        stamp: 70,
        payload: destiny.buildGotoDirectionPayload(9001, { x: 1, y: 0, z: 0 }),
      },
    ],
    {
      getDedupeKey(update) {
        const payload = update && Array.isArray(update.payload) ? update.payload : null;
        return payload && payload[0] === "SetSpeedFraction" ? "speed" : null;
      },
    },
  );
  proto.queueTickDestinyPresentationUpdates.call(
    scene,
    session,
    [
      {
        stamp: 71,
        payload: destiny.buildSetSpeedFractionPayload(9001, 0.7),
      },
    ],
    {
      getDedupeKey(update) {
        const payload = update && Array.isArray(update.payload) ? update.payload : null;
        return payload && payload[0] === "SetSpeedFraction" ? "speed" : null;
      },
    },
  );
  proto.flushTickDestinyPresentationBatch.call(scene);
  return {
    sendCalls,
  };
}

function captureMixedQueueSendOptions(proto) {
  const { session } = createSession();
  const { scene, sendCalls } = createScene(proto);
  proto.beginTickDestinyPresentationBatch.call(scene);
  proto.queueTickDestinyPresentationUpdates.call(
    scene,
    session,
    [
      {
        stamp: 78,
        payload: destiny.buildRemoveBallsPayload([3001]),
      },
    ],
  );
  proto.queueTickDestinyPresentationUpdates.call(
    scene,
    session,
    [
      {
        stamp: 79,
        payload: destiny.buildSetSpeedFractionPayload(9001, 0.5),
      },
    ],
    {
      sendOptions: {
        avoidCurrentHistoryInsertion: true,
        preservePayloadStateStamp: true,
        minimumLeadFromCurrentHistory: 2,
        maximumLeadFromCurrentHistory: 2,
      },
    },
  );
  proto.flushTickDestinyPresentationBatch.call(scene);
  return {
    sendCalls,
  };
}

function captureKillBurstQueueCoalescing(proto) {
  const { session } = createSession();
  const { scene, sendCalls } = createScene(proto);
  proto.beginTickDestinyPresentationBatch.call(scene);
  proto.queueTickDestinyPresentationUpdates.call(
    scene,
    session,
    [
      {
        stamp: 1774897448,
        payload: destiny.buildGotoDirectionPayload(
          9001,
          { x: -0.9752782296440112, y: -0.046602899700875236, z: -0.21601051947049535 },
        ),
      },
      {
        stamp: 1774897448,
        payload: destiny.buildOnDamageStateChangePayload(
          3900000000000001,
          [
            [0, 280000, "134193710473380000"],
            0,
            0.03696100000000002,
          ],
        ),
      },
      {
        stamp: 1774897448,
        payload: destiny.buildTerminalPlayDestructionEffectPayload(3900000000000001, 3),
      },
      {
        stamp: 1774897448,
        payload: destiny.buildRemoveBallsPayload([3900000000000001]),
      },
    ],
    {
      sendOptions: {
        translateStamps: false,
      },
    },
  );
  proto.queueTickDestinyPresentationUpdates.call(
    scene,
    session,
    [
      {
        stamp: 1774897449,
        freshAcquireLifecycleGroup: true,
        payload: ["AddBalls2", ["opaque-wreck-add"]],
      },
    ],
    {
      sendOptions: {
        translateStamps: false,
        avoidCurrentHistoryInsertion: true,
        preservePayloadStateStamp: true,
        minimumLeadFromCurrentHistory: 2,
        maximumLeadFromCurrentHistory: 2,
        historyLeadUsesCurrentSessionStamp: true,
      },
    },
  );
  proto.flushTickDestinyPresentationBatch.call(scene);
  return {
    sendCalls,
  };
}

function captureOwnerCriticalSameStampLaneRefresh(proto) {
  const session = {
    clientID: 111,
    characterID: 222,
    socket: {
      destroyed: false,
    },
    _space: {
      initialStateSent: true,
      simTimeMs: 1000,
      simFileTime: "0",
      timeDilation: 1,
      shipID: 9001,
      lastVisibleDynamicDestinyStamp: 1774999172,
      lastSentDestinyStamp: 1774999173,
      lastSentDestinyRawDispatchStamp: 1774999171,
      lastSentDestinyWasOwnerCritical: false,
      lastOwnerNonMissileCriticalStamp: 1774999172,
      lastOwnerNonMissileCriticalRawDispatchStamp: 1774999171,
      lastPilotCommandMovementStamp: 1774999172,
      lastPilotCommandMovementAnchorStamp: 1774999171,
      lastPilotCommandMovementRawDispatchStamp: 1774999171,
      lastMissileLifecycleStamp: 0,
      lastMissileLifecycleRawDispatchStamp: 0,
      lastOwnerMissileLifecycleStamp: 1774999171,
      lastOwnerMissileLifecycleAnchorStamp: 1774999170,
      lastOwnerMissileLifecycleRawDispatchStamp: 1774999170,
      lastOwnerMissileFreshAcquireStamp: 0,
      lastOwnerMissileFreshAcquireAnchorStamp: 0,
      lastOwnerMissileFreshAcquireRawDispatchStamp: 0,
      lastFreshAcquireLifecycleStamp: 1774999116,
    },
    sendNotification() {},
  };
  const scene = Object.assign(Object.create(proto), {
    systemID: 30000142,
    getCurrentSimTimeMs() {
      return 1774999172047;
    },
    getCurrentDestinyStamp() {
      return 1774999172;
    },
    getCurrentSessionDestinyStamp() {
      return 1774999172;
    },
    getCurrentVisibleSessionDestinyStamp() {
      return 1774999172;
    },
    getCurrentPresentedSessionDestinyStamp() {
      return 1774999173;
    },
    getImmediateDestinyStampForSession(_session, currentSessionStamp) {
      return toInt(currentSessionStamp, 0) >>> 0;
    },
    getSessionClockOffsetMs() {
      return 0;
    },
    translateDestinyStampForSession(_session, rawStamp) {
      return toInt(rawStamp, 0) >>> 0;
    },
    getHistoryFloorDestinyStampForSession() {
      return 1774999102;
    },
    refreshSessionClockSnapshot() {},
  });
  const emittedStamp = proto.sendDestinyUpdates.call(
    scene,
    session,
    [
      {
        stamp: 1774999173,
        payload: destiny.buildGotoDirectionPayload(
          9001,
          { x: -0.5, y: -0.2, z: -0.8 },
        ),
      },
    ],
    false,
    {
      skipOwnerMonotonicRestamp: true,
      translateStamps: false,
    },
  );
  return {
    emittedStamp,
    lastSentDestinyStamp:
      toInt(session._space && session._space.lastSentDestinyStamp, 0) >>> 0,
    lastSentDestinyRawDispatchStamp:
      toInt(session._space && session._space.lastSentDestinyRawDispatchStamp, 0) >>> 0,
    lastSentDestinyWasOwnerCritical:
      session &&
      session._space &&
      session._space.lastSentDestinyWasOwnerCritical === true,
  };
}

function captureSendBatch(proto) {
  const { session, notifications } = createSession();
  const { scene } = createScene(proto);
  proto.sendDestinyBatch.call(
    scene,
    session,
    [
      {
        stamp: 72,
        payload: destiny.buildSetSpeedFractionPayload(9001, 1),
      },
    ],
    false,
  );
  return {
    notifications,
  };
}

function captureSendIndividually(proto) {
  const { session } = createSession();
  const calls = [];
  const scene = Object.assign(Object.create(proto), {
    sendDestinyUpdates(targetSession, updates, waitForBubble, options) {
      calls.push(
        stableClone({
          targetSession,
          updates,
          waitForBubble,
          options,
        }),
      );
      return 0;
    },
  });
  proto.sendDestinyUpdatesIndividually.call(
    scene,
    session,
    [
      {
        stamp: 70,
        payload: destiny.buildSetSpeedFractionPayload(9001, 0.25),
      },
      {
        stamp: 71,
        payload: destiny.buildSetSpeedFractionPayload(9001, 0.5),
      },
    ],
    true,
  );
  return {
    calls,
  };
}

function captureSendMovementUpdates(proto) {
  const active = createSession();
  const inactive = createSession({
    socket: {
      destroyed: true,
    },
  });
  const calls = [];
  const scene = Object.assign(Object.create(proto), {
    sendDestinyUpdates(targetSession, updates, waitForBubble, options) {
      calls.push(
        stableClone({
          targetSession,
          updates,
          waitForBubble,
          options,
        }),
      );
      return 0;
    },
  });
  proto.sendMovementUpdatesToSession.call(
    scene,
    active.session,
    [
      {
        stamp: 70,
        payload: destiny.buildSetSpeedFractionPayload(9001, 1),
      },
    ],
  );
  proto.sendMovementUpdatesToSession.call(
    scene,
    inactive.session,
    [
      {
        stamp: 70,
        payload: destiny.buildSetSpeedFractionPayload(9001, 1),
      },
    ],
  );
  return {
    calls,
  };
}

function captureMissilePressure(proto) {
  const pressured = createSession({
    _space: {
      lastMissileLifecycleStamp: 72,
      lastMissileLifecycleRawDispatchStamp: 76,
      lastOwnerMissileLifecycleStamp: 0,
      lastOwnerMissileLifecycleRawDispatchStamp: 0,
    },
  });
  const clear = createSession();
  const { scene } = createScene(proto, {
    getCurrentSessionDestinyStamp() {
      return 70;
    },
    getCurrentVisibleSessionDestinyStamp() {
      return 70;
    },
    getCurrentDestinyStamp() {
      return 77;
    },
  });
  return {
    pressured: proto.shouldDeferPilotMovementForMissilePressure.call(
      scene,
      pressured.session,
      1000,
    ),
    clear: proto.shouldDeferPilotMovementForMissilePressure.call(
      scene,
      clear.session,
      1000,
    ),
  };
}

function buildSnapshots() {
  const proto = buildScenePrototype();
  return stableClone({
    resolveDeliveryFloor: captureResolveDeliveryFloor(proto),
    prepareRestamp: capturePrepareRestamp(proto),
    inactiveQueue: captureInactiveQueue(proto),
    activeQueueFlush: captureActiveQueueFlush(proto),
    mixedQueueSendOptions: captureMixedQueueSendOptions(proto),
    killBurstQueueCoalescing: captureKillBurstQueueCoalescing(proto),
    ownerCriticalSameStampLaneRefresh:
      captureOwnerCriticalSameStampLaneRefresh(proto),
    sendBatch: captureSendBatch(proto),
    sendIndividually: captureSendIndividually(proto),
    sendMovementUpdates: captureSendMovementUpdates(proto),
    missilePressure: captureMissilePressure(proto),
  });
}

function assertParityInvariants(snapshot) {
  const ownerCriticalSameStampLaneRefresh =
    snapshot && snapshot.ownerCriticalSameStampLaneRefresh;
  if (!ownerCriticalSameStampLaneRefresh) {
    throw new Error(
      "Missing ownerCriticalSameStampLaneRefresh snapshot.",
    );
  }
  if ((toInt(ownerCriticalSameStampLaneRefresh.emittedStamp, 0) >>> 0) !== 1774999173) {
    throw new Error(
      `Expected same-stamp owner-critical resend to emit stamp 1774999173, got ${ownerCriticalSameStampLaneRefresh.emittedStamp}.`,
    );
  }
  if ((toInt(ownerCriticalSameStampLaneRefresh.lastSentDestinyStamp, 0) >>> 0) !== 1774999173) {
    throw new Error(
      `Expected lastSentDestinyStamp to remain 1774999173, got ${ownerCriticalSameStampLaneRefresh.lastSentDestinyStamp}.`,
    );
  }
  if ((toInt(ownerCriticalSameStampLaneRefresh.lastSentDestinyRawDispatchStamp, 0) >>> 0) !== 1774999172) {
    throw new Error(
      `Expected same-stamp owner-critical resend to refresh lastSentDestinyRawDispatchStamp to 1774999172, got ${ownerCriticalSameStampLaneRefresh.lastSentDestinyRawDispatchStamp}.`,
    );
  }
  if (ownerCriticalSameStampLaneRefresh.lastSentDestinyWasOwnerCritical !== true) {
    throw new Error(
      "Expected same-stamp owner-critical resend to keep lastSentDestinyWasOwnerCritical true.",
    );
  }
}

function recordBaseline(outputPath = DEFAULT_BASELINE_PATH) {
  const snapshot = buildSnapshots();
  assertParityInvariants(snapshot);
  ensureDirForFile(outputPath);
  fs.writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Recorded movement destiny dispatch baseline to ${outputPath}`);
}

function verifyBaseline(inputPath = DEFAULT_BASELINE_PATH) {
  if (!fs.existsSync(inputPath)) {
    console.error(`Missing movement destiny dispatch baseline: ${inputPath}`);
    process.exitCode = 1;
    return;
  }
  const expected = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const actual = buildSnapshots();
  assertParityInvariants(actual);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error("Movement destiny dispatch extraction regression detected.");
    console.error(`Baseline: ${inputPath}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Movement destiny dispatch verified against ${inputPath}`);
}

const mode = process.argv[2] || "verify";
if (mode === "record") {
  recordBaseline(process.argv[3] || DEFAULT_BASELINE_PATH);
} else if (mode === "verify") {
  verifyBaseline(process.argv[3] || DEFAULT_BASELINE_PATH);
} else {
  console.error("Usage: node server/scripts/verifyMovementDestinyDispatchExtraction.js [record|verify] [baselinePath]");
  process.exitCode = 1;
}
