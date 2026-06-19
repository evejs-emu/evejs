#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";
process.env.EVEJS_DISABLE_NPC_ANCHOR_RELEVANCE = "1";

const runtime = require("../src/space/runtime");

const DEFAULT_BASELINE_PATH = path.join(
  process.cwd(),
  "tmp",
  "movement-destiny-lane-baseline.json",
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
  if (typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      result[key] = stableClone(value[key]);
    }
    return result;
  }
  return String(value);
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
    _space: {
      initialStateSent: true,
      shipID: 9001,
      simTimeMs: 1000,
      simFileTime: "0",
      timeDilation: 1,
      lastFreshAcquireLifecycleStamp: 0,
      lastMissileLifecycleStamp: 0,
      lastOwnerMissileLifecycleStamp: 0,
      lastOwnerMissileLifecycleRawDispatchStamp: 0,
      lastOwnerMissileFreshAcquireStamp: 0,
      lastOwnerMissileFreshAcquireRawDispatchStamp: 0,
      lastOwnerNonMissileCriticalStamp: 0,
      lastOwnerNonMissileCriticalRawDispatchStamp: 0,
      lastPilotCommandMovementStamp: 0,
      lastPilotCommandMovementRawDispatchStamp: 0,
      lastSentDestinyStamp: 0,
      lastSentDestinyRawDispatchStamp: 0,
      lastSentDestinyOnlyStaleProjectedOwnerMissileLane: false,
      lastSentDestinyWasOwnerCritical: false,
      ...((overrides && overrides._space) || {}),
    },
    sendNotification(name, target, payload) {
      notifications.push({
        name,
        target,
        payload: stableClone(payload),
      });
    },
    ...overrides,
  };
  return {
    session,
    notifications,
  };
}

function createMockScene(overrides = {}) {
  return {
    refreshSessionClockSnapshot() {},
    getCurrentSimTimeMs() {
      return 1000;
    },
    getCurrentDestinyStamp() {
      return 77;
    },
    prepareDestinyUpdateForSession(session, rawPayload) {
      return rawPayload;
    },
    getCurrentSessionDestinyStamp() {
      return 70;
    },
    getImmediateDestinyStampForSession(session, currentSessionStamp) {
      return currentSessionStamp;
    },
    getCurrentPresentedSessionDestinyStamp() {
      return 70;
    },
    ...overrides,
  };
}

function runScenario(name, payloads, sessionOverrides = {}, sceneOverrides = {}, sendOptions = {}) {
  const proto = buildScenePrototype();
  const { session, notifications } = createSession(sessionOverrides);
  const scene = createMockScene(sceneOverrides);
  const result = proto.sendDestinyUpdates.call(
    scene,
    session,
    payloads,
    false,
    sendOptions,
  );
  return stableClone({
    name,
    result,
    notifications,
    session,
  });
}

function buildSnapshots() {
  return stableClone({
    ownerMissileLifecycleSimple: runScenario(
      "ownerMissileLifecycleSimple",
      [
        {
          stamp: 70,
          payload: ["RemoveBalls", [[3001]]],
          ownerMissileLifecycleGroup: true,
        },
      ],
      {
        _space: {
          lastOwnerMissileLifecycleStamp: 72,
          lastOwnerMissileLifecycleRawDispatchStamp: 76,
          lastOwnerNonMissileCriticalStamp: 71,
          lastOwnerNonMissileCriticalRawDispatchStamp: 76,
          lastPilotCommandMovementStamp: 72,
          lastSentDestinyStamp: 72,
          lastSentDestinyRawDispatchStamp: 76,
          lastSentDestinyWasOwnerCritical: true,
        },
      },
    ),
    ownerMissileFreshAcquireSplit: runScenario(
      "ownerMissileFreshAcquireSplit",
      [
        {
          stamp: 70,
          payload: ["AddBalls2", [[], "0"]],
          ownerMissileLifecycleGroup: true,
          freshAcquireLifecycleGroup: true,
        },
        {
          stamp: 70,
          payload: ["RemoveBalls", [[3002]]],
          ownerMissileLifecycleGroup: true,
        },
      ],
      {
        _space: {
          lastOwnerMissileLifecycleStamp: 72,
          lastOwnerMissileLifecycleRawDispatchStamp: 76,
          lastOwnerMissileFreshAcquireStamp: 71,
          lastOwnerMissileFreshAcquireRawDispatchStamp: 76,
          lastOwnerNonMissileCriticalStamp: 71,
          lastOwnerNonMissileCriticalRawDispatchStamp: 76,
          lastPilotCommandMovementStamp: 72,
          lastSentDestinyStamp: 72,
          lastSentDestinyRawDispatchStamp: 76,
          lastSentDestinyWasOwnerCritical: true,
        },
      },
    ),
    observerMissileLifecycle: runScenario(
      "observerMissileLifecycle",
      [
        {
          stamp: 70,
          payload: ["RemoveBalls", [[3003]]],
          missileLifecycleGroup: true,
        },
      ],
      {
        _space: {
          lastMissileLifecycleStamp: 72,
          lastPilotCommandMovementStamp: 72,
        },
      },
    ),
    ownerPilotMovementNoSyntheticPostFloor: runScenario(
      "ownerPilotMovementNoSyntheticPostFloor",
      [
        {
          stamp: 1774888215,
          payload: ["GotoDirection", [9001, 1, 0, 0]],
        },
      ],
      {
        _space: {
          lastSentDestinyStamp: 1774888214,
          lastSentDestinyRawDispatchStamp: 1774888213,
          lastSentDestinyOnlyStaleProjectedOwnerMissileLane: false,
          lastSentDestinyWasOwnerCritical: false,
        },
      },
      {
        getCurrentDestinyStamp() {
          return 1774888214;
        },
        getCurrentSessionDestinyStamp() {
          return 1774888214;
        },
        getCurrentVisibleSessionDestinyStamp() {
          return 1774888214;
        },
        getCurrentPresentedSessionDestinyStamp() {
          return 1774888215;
        },
      },
    ),
    freshAcquireDoesNotReusePostHeldFutureLane: runScenario(
      "freshAcquireDoesNotReusePostHeldFutureLane",
      [
        {
          stamp: 102,
          payload: ["AddBalls2", [[], "0"]],
          freshAcquireLifecycleGroup: true,
        },
      ],
      {
        _space: {
          lastFreshAcquireLifecycleStamp: 103,
          lastSentDestinyStamp: 103,
          lastSentDestinyRawDispatchStamp: 99,
        },
      },
      {
        getCurrentDestinyStamp() {
          return 100;
        },
        getCurrentSessionDestinyStamp() {
          return 100;
        },
        getCurrentVisibleSessionDestinyStamp() {
          return 100;
        },
        getCurrentPresentedSessionDestinyStamp() {
          return 100;
        },
      },
    ),
    ownerFreshAcquireDoesNotReusePostHeldFutureLane: runScenario(
      "ownerFreshAcquireDoesNotReusePostHeldFutureLane",
      [
        {
          stamp: 102,
          payload: ["AddBalls2", [[], "0"]],
          freshAcquireLifecycleGroup: true,
          missileLifecycleGroup: true,
          ownerMissileLifecycleGroup: true,
        },
      ],
      {
        _space: {
          lastFreshAcquireLifecycleStamp: 103,
          lastOwnerMissileLifecycleStamp: 103,
          lastOwnerMissileLifecycleRawDispatchStamp: 99,
          lastSentDestinyStamp: 103,
          lastSentDestinyRawDispatchStamp: 99,
          lastSentDestinyWasOwnerCritical: true,
        },
      },
      {
        getCurrentDestinyStamp() {
          return 100;
        },
        getCurrentSessionDestinyStamp() {
          return 100;
        },
        getImmediateDestinyStampForSession(session, currentSessionStamp) {
          return currentSessionStamp;
        },
        getCurrentVisibleSessionDestinyStamp() {
          return 100;
        },
        getCurrentPresentedSessionDestinyStamp() {
          return 100;
        },
      },
    ),
  });
}

function assertParityInvariants(snapshot) {
  for (const scenarioName of [
    "ownerMissileLifecycleSimple",
    "ownerMissileFreshAcquireSplit",
    "ownerFreshAcquireDoesNotReusePostHeldFutureLane",
  ]) {
    const scenario = snapshot && snapshot[scenarioName];
    const sessionSpace = scenario && scenario.session && scenario.session._space;
    if (!sessionSpace) {
      throw new Error(`Missing session snapshot for ${scenarioName}.`);
    }
    for (const removedField of [
      "lastOwnerMissileLifecycleAnchorStamp",
      "lastOwnerMissileFreshAcquireAnchorStamp",
    ]) {
      if (Object.prototype.hasOwnProperty.call(sessionSpace, removedField)) {
        throw new Error(
          `Expected ${scenarioName} session snapshot to drop removed parity field ${removedField}.`,
        );
      }
    }
  }
}

function recordBaseline(outputPath = DEFAULT_BASELINE_PATH) {
  const snapshot = buildSnapshots();
  assertParityInvariants(snapshot);
  ensureDirForFile(outputPath);
  fs.writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Recorded movement destiny lane baseline to ${outputPath}`);
}

function verifyBaseline(inputPath = DEFAULT_BASELINE_PATH) {
  if (!fs.existsSync(inputPath)) {
    console.error(`Missing movement destiny lane baseline: ${inputPath}`);
    process.exitCode = 1;
    return;
  }
  const expected = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const actual = buildSnapshots();
  assertParityInvariants(actual);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error("Movement destiny lane extraction regression detected.");
    console.error(`Baseline: ${inputPath}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Movement destiny lane verified against ${inputPath}`);
}

const mode = process.argv[2] || "verify";
if (mode === "record") {
  recordBaseline(process.argv[3] || DEFAULT_BASELINE_PATH);
} else if (mode === "verify") {
  verifyBaseline(process.argv[3] || DEFAULT_BASELINE_PATH);
} else {
  console.error("Usage: node server/scripts/verifyMovementDestinyLaneExtraction.js [record|verify] [baselinePath]");
  process.exitCode = 1;
}
