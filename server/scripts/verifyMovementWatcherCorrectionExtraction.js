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
  "movement-watcher-correction-baseline.json",
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

function createEntity(overrides = {}) {
  return {
    itemID: 9001,
    session: null,
    mode: "STOP",
    pendingDock: null,
    pendingWarp: null,
    warpState: null,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    lastObserverCorrectionBroadcastAt: 0,
    lastObserverCorrectionBroadcastStamp: 0,
    lastWarpCorrectionBroadcastAt: 0,
    lastWarpPositionBroadcastStamp: 0,
    ...overrides,
  };
}

function createSession(overrides = {}) {
  return {
    characterID: 9001,
    socket: {
      destroyed: false,
    },
    _space: {
      initialStateSent: true,
      ...((overrides && overrides._space) || {}),
    },
    ...overrides,
  };
}

function fallbackBuildPositionVelocityCorrectionUpdates(entity, options = {}) {
  const stamp = toInt(options.stamp, 0) >>> 0;
  const updates = [];
  if (options.includePosition === true) {
    updates.push({
      stamp,
      payload: destiny.buildSetBallPositionPayload(entity.itemID, entity.position),
    });
  }
  updates.push({
    stamp,
    payload: destiny.buildSetBallVelocityPayload(entity.itemID, entity.velocity),
  });
  return updates;
}

function fallbackBuildPilotWarpCorrectionUpdates(entity, stamp) {
  return fallbackBuildPositionVelocityCorrectionUpdates(entity, {
    stamp,
    includePosition: true,
  });
}

function fallbackUsesActiveSubwarpWatcherCorrections(entity) {
  return Boolean(
    entity &&
      entity.mode !== "WARP" &&
      entity.pendingDock == null &&
      (
        entity.mode === "GOTO" ||
        entity.mode === "FOLLOW" ||
        entity.mode === "ORBIT"
      ),
  );
}

function fallbackUsesLocalStopDecelContract(entity) {
  return Boolean(
    entity &&
      entity.mode === "STOP" &&
      entity.pendingDock == null &&
      !entity.pendingWarp &&
      !entity.warpState,
  );
}

function fallbackResolveWatcherCorrectionDispatch(options = {}) {
  const entity = options.entity;
  const result = options.result || {};
  const now = Number(options.now) || 0;
  const movementStamp = toInt(options.movementStamp, 0) >>> 0;
  const pilotWarpActivationDelayTicks = toInt(
    options.pilotWarpActivationDelayTicks,
    4,
  );
  const exportedPilotWarpActiveCorrections =
    typeof runtime._testing.ENABLE_PILOT_WARP_ACTIVE_CORRECTIONS === "boolean"
      ? runtime._testing.ENABLE_PILOT_WARP_ACTIVE_CORRECTIONS
      : false;
  const enablePilotWarpActiveCorrections =
    typeof options.enablePilotWarpActiveCorrections === "boolean"
      ? options.enablePilotWarpActiveCorrections
      : exportedPilotWarpActiveCorrections;
  const buildPositionVelocityCorrectionUpdates =
    typeof options.buildPositionVelocityCorrectionUpdates === "function"
      ? options.buildPositionVelocityCorrectionUpdates
      : fallbackBuildPositionVelocityCorrectionUpdates;
  const buildPilotWarpCorrectionUpdates =
    typeof options.buildPilotWarpCorrectionUpdates === "function"
      ? options.buildPilotWarpCorrectionUpdates
      : fallbackBuildPilotWarpCorrectionUpdates;
  const usesActiveSubwarpWatcherCorrections =
    typeof options.usesActiveSubwarpWatcherCorrections === "function"
      ? options.usesActiveSubwarpWatcherCorrections
      : (
        runtime._testing.usesActiveSubwarpWatcherCorrections ||
        fallbackUsesActiveSubwarpWatcherCorrections
      );
  const usesLocalStopDecelContract =
    typeof options.usesLocalStopDecelContract === "function"
      ? options.usesLocalStopDecelContract
      : (
        runtime._testing.usesLocalStopDecelContract ||
        fallbackUsesLocalStopDecelContract
      );
  const getWatcherCorrectionIntervalMs =
    typeof options.getWatcherCorrectionIntervalMs === "function"
      ? options.getWatcherCorrectionIntervalMs
      : runtime._testing.getWatcherCorrectionIntervalMs;

  const sessionOnlyUpdates = [];
  const watcherOnlyUpdates = [];
  let correctionDebug = null;

  if (entity.mode === "WARP") {
    const warpState = entity.warpState || null;
    const warpCommandStamp = toInt(
      warpState && warpState.commandStamp,
      0,
    ) >>> 0;
    const warpCorrectionStamp = Math.max(movementStamp, warpCommandStamp) >>> 0;
    const inActivePilotWarpPhase =
      !entity.pendingWarp &&
      warpCommandStamp > 0;
    const shouldSendPilotWarpCorrection =
      enablePilotWarpActiveCorrections &&
      inActivePilotWarpPhase &&
      warpCorrectionStamp > warpCommandStamp &&
      warpCorrectionStamp !== toInt(entity.lastWarpPositionBroadcastStamp, -1);
    if (
      shouldSendPilotWarpCorrection &&
      entity.session &&
      entity.session.socket &&
      entity.session.socket.destroyed !== true
    ) {
      const pilotWarpCorrectionUpdates = buildPilotWarpCorrectionUpdates(
        entity,
        warpCorrectionStamp,
      );
      if (pilotWarpCorrectionUpdates.length > 0) {
        sessionOnlyUpdates.push({
          session: entity.session,
          updates: pilotWarpCorrectionUpdates,
          sendOptions: {
            minimumLeadFromCurrentHistory: pilotWarpActivationDelayTicks,
            maximumLeadFromCurrentHistory: pilotWarpActivationDelayTicks,
          },
        });
      }
      entity.lastWarpCorrectionBroadcastAt = now;
      entity.lastWarpPositionBroadcastStamp = warpCorrectionStamp;
      correctionDebug = {
        stamp: warpCorrectionStamp,
        includePosition: true,
        includeVelocity: true,
        target: "pilot-active-warp-hops+watchers-local-warpto",
        dispatched: pilotWarpCorrectionUpdates.length > 0,
      };
    } else {
      correctionDebug = {
        stamp: warpCorrectionStamp,
        includePosition: false,
        includeVelocity: false,
        target: inActivePilotWarpPhase
          ? "pilot-warp-edges+watchers-local-warpto"
          : "pilot-prep-no-hops+watchers-local-warpto",
        dispatched: false,
      };
    }
    return {
      correctionDebug,
      sessionOnlyUpdates,
      watcherOnlyUpdates,
      entity: stableClone(entity),
    };
  }

  const correctionStamp = movementStamp;
  if (usesActiveSubwarpWatcherCorrections(entity)) {
    correctionDebug = {
      stamp: correctionStamp,
      includePosition: false,
      includeVelocity: false,
      target: "watchers-local-subwarp-command",
      dispatched: false,
    };
  } else if (usesLocalStopDecelContract(entity)) {
    correctionDebug = {
      stamp: correctionStamp,
      includePosition: false,
      includeVelocity: false,
      target: "local-stop-contract",
      dispatched: false,
    };
  } else {
    const observerNeedsPositionAnchor = false;
    const correctionUpdates = buildPositionVelocityCorrectionUpdates(entity, {
      stamp: correctionStamp,
      includePosition: observerNeedsPositionAnchor,
    });
    correctionDebug = {
      stamp: correctionStamp,
      includePosition: observerNeedsPositionAnchor,
      includeVelocity: true,
      target: "watchers-only",
      dispatched: false,
    };
    if (
      !result.warpCompleted &&
      now - toInt(entity.lastObserverCorrectionBroadcastAt, 0) >=
        getWatcherCorrectionIntervalMs(entity) &&
      correctionStamp !== toInt(entity.lastObserverCorrectionBroadcastStamp, -1)
    ) {
      watcherOnlyUpdates.push({
        excludedSession: entity.session || null,
        updates: correctionUpdates,
      });
      entity.lastObserverCorrectionBroadcastAt = now;
      entity.lastObserverCorrectionBroadcastStamp = correctionStamp;
      correctionDebug.dispatched = correctionUpdates.length > 0;
    }
  }

  return {
    correctionDebug,
    sessionOnlyUpdates,
    watcherOnlyUpdates,
    entity: stableClone(entity),
  };
}

function resolveWatcherCorrectionDispatch(options = {}) {
  if (typeof runtime._testing.resolveWatcherCorrectionDispatchForTesting === "function") {
    return runtime._testing.resolveWatcherCorrectionDispatchForTesting({
      runtime: {
        getMovementStamp() {
          return toInt(options.movementStamp, 0) >>> 0;
        },
      },
      ...options,
    });
  }
  return fallbackResolveWatcherCorrectionDispatch(options);
}

function buildSnapshots() {
  const helperBuildPositionVelocityCorrectionUpdates =
    runtime._testing.buildPositionVelocityCorrectionUpdates ||
    fallbackBuildPositionVelocityCorrectionUpdates;
  return stableClone({
    helperSnapshots: {
      withPosition: helperBuildPositionVelocityCorrectionUpdates(
        createEntity({
          position: { x: 100, y: 0, z: -50 },
          velocity: { x: 1, y: 2, z: 3 },
        }),
        {
          stamp: 81,
          includePosition: true,
        },
      ),
      velocityOnly: helperBuildPositionVelocityCorrectionUpdates(
        createEntity({
          velocity: { x: 5, y: 0, z: 0 },
        }),
        {
          stamp: 82,
          includePosition: false,
        },
      ),
      activeSubwarpGoto: runtime._testing.usesActiveSubwarpWatcherCorrections(
        createEntity({
          mode: "GOTO",
        }),
      ),
      localStop: fallbackUsesLocalStopDecelContract(
        createEntity({
          mode: "STOP",
        }),
      ),
      activeInterval: runtime._testing.getWatcherCorrectionIntervalMs(
        createEntity({
          mode: "FOLLOW",
        }),
      ),
      idleInterval: runtime._testing.getWatcherCorrectionIntervalMs(
        createEntity({
          mode: "STOP",
          pendingWarp: {},
        }),
      ),
    },
    scenarioSnapshots: {
      activeSubwarpNoCorrection: resolveWatcherCorrectionDispatch({
        entity: createEntity({
          mode: "GOTO",
        }),
        result: {
          changed: true,
          warpCompleted: false,
        },
        now: 1000,
        movementStamp: 81,
      }),
      localStopNoCorrection: resolveWatcherCorrectionDispatch({
        entity: createEntity({
          mode: "STOP",
        }),
        result: {
          changed: true,
          warpCompleted: false,
        },
        now: 1000,
        movementStamp: 81,
      }),
      watcherVelocityCorrection: resolveWatcherCorrectionDispatch({
        entity: createEntity({
          mode: "IDLE",
          velocity: { x: 10, y: 0, z: 0 },
          lastObserverCorrectionBroadcastAt: 0,
          lastObserverCorrectionBroadcastStamp: 0,
        }),
        result: {
          changed: true,
          warpCompleted: false,
        },
        now: 1000,
        movementStamp: 81,
      }),
      watcherSameStampSuppressed: resolveWatcherCorrectionDispatch({
        entity: createEntity({
          mode: "IDLE",
          velocity: { x: 10, y: 0, z: 0 },
          lastObserverCorrectionBroadcastAt: 0,
          lastObserverCorrectionBroadcastStamp: 81,
        }),
        result: {
          changed: true,
          warpCompleted: false,
        },
        now: 1000,
        movementStamp: 81,
      }),
      pilotWarpCorrection: resolveWatcherCorrectionDispatch({
        entity: createEntity({
          mode: "WARP",
          session: createSession(),
          position: { x: 1000, y: 0, z: 0 },
          velocity: { x: 1500, y: 0, z: 0 },
          pendingWarp: null,
          warpState: {
            commandStamp: 80,
          },
          lastWarpPositionBroadcastStamp: -1,
        }),
        result: {
          changed: true,
          warpCompleted: false,
        },
        now: 1000,
        movementStamp: 82,
        pilotWarpActivationDelayTicks: 4,
      }),
      pilotWarpNoCorrectionAtCommandStamp: resolveWatcherCorrectionDispatch({
        entity: createEntity({
          mode: "WARP",
          session: createSession(),
          pendingWarp: null,
          warpState: {
            commandStamp: 82,
          },
          lastWarpPositionBroadcastStamp: -1,
        }),
        result: {
          changed: true,
          warpCompleted: false,
        },
        now: 1000,
        movementStamp: 82,
        pilotWarpActivationDelayTicks: 4,
      }),
    },
  });
}

function recordBaseline(outputPath = DEFAULT_BASELINE_PATH) {
  const snapshot = buildSnapshots();
  ensureDirForFile(outputPath);
  fs.writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Recorded movement watcher correction baseline to ${outputPath}`);
}

function verifyBaseline(inputPath = DEFAULT_BASELINE_PATH) {
  if (!fs.existsSync(inputPath)) {
    console.error(`Missing movement watcher correction baseline: ${inputPath}`);
    process.exitCode = 1;
    return;
  }
  const expected = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const actual = buildSnapshots();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error("Movement watcher correction extraction regression detected.");
    console.error(`Baseline: ${inputPath}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Movement watcher correction verified against ${inputPath}`);
}

const mode = process.argv[2] || "verify";
if (mode === "record") {
  recordBaseline(process.argv[3] || DEFAULT_BASELINE_PATH);
} else if (mode === "verify") {
  verifyBaseline(process.argv[3] || DEFAULT_BASELINE_PATH);
} else {
  console.error("Usage: node server/scripts/verifyMovementWatcherCorrectionExtraction.js [record|verify] [baselinePath]");
  process.exitCode = 1;
}
