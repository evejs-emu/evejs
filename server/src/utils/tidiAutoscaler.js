"use strict";

const path = require("path");
const { performance } = require("perf_hooks");
const rotatingLog = require(path.join(__dirname, "./rotatingLog"));
const pc = require("picocolors");

const log = require(path.join(__dirname, "./logger"));
const config = require(path.join(__dirname, "../config"));
const spaceRuntime = require(path.join(__dirname, "../space/runtime"));
const {
  TIDI_ADVANCE_NOTICE_MS,
  scheduleAdvanceNoticeTimeDilationForSystems,
} = require(path.join(__dirname, "./synchronizedTimeDilation"));

const CONTROL_WINDOW_MS = 1000;
const DEFAULT_TARGET_TICK_INTERVAL_MS = 100;
const TICK_SLACK_MS = 5;
const OVERLOAD_ENGAGE_LATENESS_MS = 20;
const EPSILON = 0.02;
const RELAX_CONFIRM_WINDOWS = 2;
const TRANSITION_HOLD_MS = 5000;
const TIDI_LOG_PATH = path.join(__dirname, "../../logs/time-dilation.log");

function clampFactor(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 1.0;
  }
  return Math.min(1.0, Math.max(0.1, numeric));
}

function normalizePositiveNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function roundTo(value, digits = 3) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  const scale = 10 ** digits;
  return Math.round(numeric * scale) / scale;
}

function getCurrentMonotonicMs() {
  return performance.now();
}

function appendTimeDilationLog(entry) {
  try {
    rotatingLog.append(TIDI_LOG_PATH, `[${new Date().toISOString()}] ${entry}\n`);
  } catch (error) {
    log.warn(`[TiDi] Failed to append TiDi log: ${error.message}`);
  }
}

function intervalToFactor(actualIntervalMs, targetTickIntervalMs = DEFAULT_TARGET_TICK_INTERVAL_MS) {
  const targetMs = normalizePositiveNumber(
    targetTickIntervalMs,
    DEFAULT_TARGET_TICK_INTERVAL_MS,
  );
  const actualMs = Math.max(
    targetMs,
    normalizePositiveNumber(actualIntervalMs, targetMs),
  );
  const engageThresholdMs = targetMs + OVERLOAD_ENGAGE_LATENESS_MS;
  if (actualMs <= targetMs + TICK_SLACK_MS) {
    return 1.0;
  }
  if (actualMs <= engageThresholdMs) {
    return 1.0;
  }
  const overloadIntervalMs = targetMs + (actualMs - engageThresholdMs);
  return clampFactor(roundTo(targetMs / overloadIntervalMs, 3));
}

function normalizeRuntimeTickSample(sample = {}) {
  const targetTickIntervalMs = normalizePositiveNumber(
    sample.targetTickIntervalMs,
    DEFAULT_TARGET_TICK_INTERVAL_MS,
  );
  const actualIntervalMs = Math.max(
    targetTickIntervalMs,
    normalizePositiveNumber(sample.actualIntervalMs, targetTickIntervalMs),
  );
  const tickDurationMs = Math.max(
    0,
    normalizePositiveNumber(sample.tickDurationMs, 0),
  );
  return {
    startedAtMonotonicMs: normalizePositiveNumber(sample.startedAtMonotonicMs, 0),
    targetTickIntervalMs,
    actualIntervalMs,
    tickDurationMs,
    latenessMs: Math.max(0, actualIntervalMs - targetTickIntervalMs),
    sceneCount: Math.max(0, Math.trunc(Number(sample.sceneCount) || 0)),
  };
}

function createControlWindow(sample) {
  return {
    startedAtMonotonicMs: sample.startedAtMonotonicMs,
    endedAtMonotonicMs: sample.startedAtMonotonicMs,
    targetTickIntervalMs: sample.targetTickIntervalMs,
    sampleCount: 1,
    actualIntervalTotalMs: sample.actualIntervalMs,
    tickDurationTotalMs: sample.tickDurationMs,
    maxActualIntervalMs: sample.actualIntervalMs,
    maxTickDurationMs: sample.tickDurationMs,
    maxLatenessMs: sample.latenessMs,
    maxSceneCount: sample.sceneCount,
  };
}

function addSampleToControlWindow(windowState, sample) {
  windowState.endedAtMonotonicMs = sample.startedAtMonotonicMs;
  windowState.sampleCount += 1;
  windowState.actualIntervalTotalMs += sample.actualIntervalMs;
  windowState.tickDurationTotalMs += sample.tickDurationMs;
  windowState.maxActualIntervalMs = Math.max(
    windowState.maxActualIntervalMs,
    sample.actualIntervalMs,
  );
  windowState.maxTickDurationMs = Math.max(
    windowState.maxTickDurationMs,
    sample.tickDurationMs,
  );
  windowState.maxLatenessMs = Math.max(
    windowState.maxLatenessMs,
    sample.latenessMs,
  );
  windowState.maxSceneCount = Math.max(
    windowState.maxSceneCount,
    sample.sceneCount,
  );
  return windowState;
}

function finalizeControlWindow(windowState) {
  const sampleCount = Math.max(1, Number(windowState && windowState.sampleCount) || 1);
  const targetTickIntervalMs = normalizePositiveNumber(
    windowState && windowState.targetTickIntervalMs,
    DEFAULT_TARGET_TICK_INTERVAL_MS,
  );
  const avgActualIntervalMs = (
    normalizePositiveNumber(windowState && windowState.actualIntervalTotalMs, targetTickIntervalMs) /
    sampleCount
  );
  const avgTickDurationMs = (
    Math.max(0, Number(windowState && windowState.tickDurationTotalMs) || 0) /
    sampleCount
  );
  const effectiveIntervalMs = Math.max(
    targetTickIntervalMs,
    avgActualIntervalMs,
    avgTickDurationMs,
  );
  return {
    startedAtMonotonicMs: roundTo(
      Number(windowState && windowState.startedAtMonotonicMs),
      3,
    ),
    endedAtMonotonicMs: roundTo(
      Number(windowState && windowState.endedAtMonotonicMs),
      3,
    ),
    sampleCount,
    targetTickIntervalMs,
    avgActualIntervalMs: roundTo(avgActualIntervalMs, 3),
    avgTickDurationMs: roundTo(avgTickDurationMs, 3),
    maxActualIntervalMs: roundTo(
      normalizePositiveNumber(windowState && windowState.maxActualIntervalMs, targetTickIntervalMs),
      3,
    ),
    maxTickDurationMs: roundTo(
      Math.max(0, Number(windowState && windowState.maxTickDurationMs) || 0),
      3,
    ),
    maxLatenessMs: roundTo(
      Math.max(0, Number(windowState && windowState.maxLatenessMs) || 0),
      3,
    ),
    sceneCount: Math.max(0, Math.trunc(Number(windowState && windowState.maxSceneCount) || 0)),
    windowElapsedMs: roundTo(Math.max(
      targetTickIntervalMs,
      Number(windowState && windowState.endedAtMonotonicMs) -
      Number(windowState && windowState.startedAtMonotonicMs),
    ), 3),
    effectiveIntervalMs: roundTo(effectiveIntervalMs, 3),
    factor: intervalToFactor(effectiveIntervalMs, targetTickIntervalMs),
  };
}

const LABEL = pc.bgCyan(pc.black(" TIDI "));

function logTidiChange(metrics, previousFactor, newFactor) {
  const timestamp = new Date().toISOString().slice(11, 19);
  const arrow = newFactor < previousFactor ? pc.red("v") : pc.green("^");
  const factorStr = newFactor >= 1.0
    ? pc.green("1.000")
    : pc.yellow(newFactor.toFixed(3));
  const intervalStr = `${roundTo(metrics && metrics.avgActualIntervalMs, 1).toFixed(1)}ms`;
  const durationStr = `${roundTo(metrics && metrics.avgTickDurationMs, 1).toFixed(1)}ms`;
  const lateStr = `${roundTo(metrics && metrics.maxLatenessMs, 1).toFixed(1)}ms`;
  const sceneCount = Math.max(0, Math.trunc(Number(metrics && metrics.sceneCount) || 0));
  const solarSystemLabel = `${sceneCount} solar system${sceneCount !== 1 ? "s" : ""}`;
  const detail = newFactor >= 1.0
    ? `${arrow} TiDi cleared - factor ${factorStr} (avg tick ${pc.green(intervalStr)}, work ${pc.green(durationStr)})`
    : `${arrow} factor ${factorStr} (avg tick ${pc.yellow(intervalStr)}, work ${pc.yellow(durationStr)}, max behind ${pc.yellow(lateStr)}, ${solarSystemLabel})`;
  const fileDetail = newFactor >= 1.0
    ? `CHANGE factor=${Number(newFactor).toFixed(3)} previous=${Number(previousFactor).toFixed(3)} avgTickMs=${intervalStr} workMs=${durationStr}`
    : `CHANGE factor=${Number(newFactor).toFixed(3)} previous=${Number(previousFactor).toFixed(3)} avgTickMs=${intervalStr} workMs=${durationStr} maxBehindMs=${lateStr} solarSystems=${sceneCount}`;

  log.flushStack();
  console.log(`${pc.dim(timestamp)} ${LABEL} ${detail}`);
  appendTimeDilationLog(fileDetail);
}

function logTidiHold(metrics, factor, reason, transitionState = null) {
  const timestamp = new Date().toISOString().slice(11, 19);
  const factorStr = factor >= 1.0
    ? pc.green("1.000")
    : pc.yellow(Number(factor).toFixed(3));
  const intervalStr = `${roundTo(metrics && metrics.avgActualIntervalMs, 1).toFixed(1)}ms`;
  const durationStr = `${roundTo(metrics && metrics.avgTickDurationMs, 1).toFixed(1)}ms`;
  const lateStr = `${roundTo(metrics && metrics.maxLatenessMs, 1).toFixed(1)}ms`;
  const sceneCount = Math.max(0, Math.trunc(Number(metrics && metrics.sceneCount) || 0));
  const solarSystemLabel = `${sceneCount} solar system${sceneCount !== 1 ? "s" : ""}`;
  let suffix = "";
  if (transitionState) {
    suffix = `, ${transitionState.phase} ${roundTo(transitionState.remainingMs, 1).toFixed(1)}ms remaining`;
  } else if (reason === "await-relax-confirmation") {
    suffix = ", waiting for recovery confirmation";
  }

  log.flushStack();
  console.log(
    `${pc.dim(timestamp)} ${LABEL} ${pc.cyan("= hold")} factor ${factorStr} ` +
    `(${pc.yellow(intervalStr)} avg tick, ${pc.yellow(durationStr)} work, ${pc.yellow(lateStr)} max behind, ${solarSystemLabel}, ${reason}${suffix})`,
  );
  appendTimeDilationLog(
    `HOLD factor=${Number(factor).toFixed(3)} reason=${reason} avgTickMs=${intervalStr} workMs=${durationStr} maxBehindMs=${lateStr} solarSystems=${sceneCount}` +
    `${transitionState ? ` phase=${transitionState.phase} remainingMs=${roundTo(transitionState.remainingMs, 1).toFixed(1)}` : ""}`,
  );
}

let autoscalerEnabled = false;
let runtimeEnabledOverride = null;
let currentFactor = 1.0;
let pendingRelaxFactor = null;
let pendingRelaxWindows = 0;
const manualOverridesBySystem = new Map();
let controlWindow = null;
let latestWindowMetrics = null;
let scheduledFactor = null;
let scheduledChangeHandle = null;
let skipNextSample = false;
let transitionLock = null;

function isConfigEnabled() {
  return config.tidiAutoscaler !== false;
}

function isEffectivelyEnabled() {
  return runtimeEnabledOverride === null
    ? isConfigEnabled()
    : runtimeEnabledOverride === true;
}

function resetRelaxationState() {
  pendingRelaxFactor = null;
  pendingRelaxWindows = 0;
}

function clearPendingScheduledChange() {
  if (scheduledChangeHandle) {
    clearTimeout(scheduledChangeHandle);
    scheduledChangeHandle = null;
  }
  scheduledFactor = null;
}

function clearTransitionLock() {
  transitionLock = null;
}

function normalizeSystemID(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : 0;
}

function getManualOverride(systemID) {
  const normalizedSystemID = normalizeSystemID(systemID);
  if (normalizedSystemID <= 0) {
    return null;
  }
  const override = manualOverridesBySystem.get(normalizedSystemID);
  return override ? { ...override } : null;
}

function hasManualOverride(systemID) {
  return Boolean(getManualOverride(systemID));
}

function listManualOverrides() {
  return [...manualOverridesBySystem.values()].map((entry) => ({ ...entry }));
}

function filterAutoscaleEligibleSystemIDs(systemIDs) {
  return (Array.isArray(systemIDs) ? systemIDs : [])
    .map((systemID) => normalizeSystemID(systemID))
    .filter((systemID, index, values) => (
      systemID > 0 &&
      values.indexOf(systemID) === index &&
      !manualOverridesBySystem.has(systemID)
    ));
}

function getTransitionLockState(nowMonotonicMs = getCurrentMonotonicMs()) {
  if (!transitionLock) {
    return null;
  }

  const normalizedNowMonotonicMs = normalizePositiveNumber(
    nowMonotonicMs,
    getCurrentMonotonicMs(),
  );
  if (
    transitionLock.phase === "hold" &&
    normalizedNowMonotonicMs >= Number(transitionLock.holdUntilMonotonicMs || 0)
  ) {
    clearTransitionLock();
    return null;
  }

  return {
    ...transitionLock,
    remainingMs: Math.max(
      0,
      roundTo(
        Number(transitionLock.phase === "pending"
          ? transitionLock.applyAtMonotonicMs
          : transitionLock.holdUntilMonotonicMs) - normalizedNowMonotonicMs,
        3,
      ),
    ),
  };
}

function setManualOverride(systemID, factor) {
  const override = {
    systemID: normalizeSystemID(systemID),
    factor: clampFactor(factor),
  };
  if (override.systemID <= 0) {
    return null;
  }
  manualOverridesBySystem.set(override.systemID, override);
  appendTimeDilationLog(
    `MANUAL_OVERRIDE systemID=${override.systemID} factor=${override.factor.toFixed(3)}`,
  );
  return { ...override };
}

function clearManualOverride(systemID, options = {}) {
  const normalizedSystemID = normalizeSystemID(systemID);
  if (normalizedSystemID <= 0) {
    return false;
  }
  const removed = manualOverridesBySystem.delete(normalizedSystemID);
  if (!removed) {
    return false;
  }
  if (Number.isFinite(Number(options.resumeFactor)) && currentFactor >= 1.0) {
    currentFactor = clampFactor(options.resumeFactor);
  }
  appendTimeDilationLog(`MANUAL_OVERRIDE_CLEAR systemID=${normalizedSystemID}`);
  return true;
}

function scheduleAutoscaledFactorChange(factor, options = {}) {
  const requestedSystemIDs = typeof options.getSystemIDs === "function"
    ? options.getSystemIDs()
    : [...spaceRuntime.scenes.keys()];
  const systemIDs = filterAutoscaleEligibleSystemIDs(requestedSystemIDs);
  if (systemIDs.length === 0) {
    scheduledFactor = null;
    return null;
  }
  clearPendingScheduledChange();
  scheduledFactor = factor;
  const announcedAtMonotonicMs = normalizePositiveNumber(
    options.nowMonotonicMs,
    getCurrentMonotonicMs(),
  );
  const applyAtMonotonicMs = announcedAtMonotonicMs + TIDI_ADVANCE_NOTICE_MS;
  transitionLock = {
    phase: "pending",
    factor,
    announcedAtMonotonicMs: roundTo(announcedAtMonotonicMs, 3),
    applyAtMonotonicMs: roundTo(applyAtMonotonicMs, 3),
    holdUntilMonotonicMs: roundTo(
      applyAtMonotonicMs + TRANSITION_HOLD_MS,
      3,
    ),
  };

  const schedule = typeof options.scheduleChange === "function"
    ? options.scheduleChange
    : (targetSystemIDs, targetFactor) => scheduleAdvanceNoticeTimeDilationForSystems(
      targetSystemIDs,
      targetFactor,
      {
        delayMs: TIDI_ADVANCE_NOTICE_MS,
        notifySystemFn: options.notifySystemFn,
        applySystemFactorFn: options.applySystemFactorFn,
        onApplied: () => {
          const appliedAtMonotonicMs = getCurrentMonotonicMs();
          transitionLock = {
            phase: "hold",
            factor: targetFactor,
            announcedAtMonotonicMs: roundTo(announcedAtMonotonicMs, 3),
            applyAtMonotonicMs: roundTo(appliedAtMonotonicMs, 3),
            holdUntilMonotonicMs: roundTo(
              appliedAtMonotonicMs + TRANSITION_HOLD_MS,
              3,
            ),
          };
          if (typeof options.onApplied === "function") {
            options.onApplied(targetSystemIDs, targetFactor, { ...transitionLock });
          }
        },
        setTimeoutFn: typeof options.setTimeoutFn === "function"
          ? options.setTimeoutFn
          : (callback, delayMs) => {
            const handle = setTimeout(() => {
              scheduledChangeHandle = null;
              callback();
            }, delayMs);
            if (handle && typeof handle.unref === "function") {
              handle.unref();
            }
            return handle;
          },
      },
    );

  scheduledChangeHandle = schedule(systemIDs, factor);
  if (
    scheduledChangeHandle &&
    typeof scheduledChangeHandle.unref === "function" &&
    typeof options.setTimeoutFn === "function"
  ) {
    scheduledChangeHandle.unref();
  }
  return scheduledChangeHandle;
}

function commitFactorChange(metrics, factor, options = {}) {
  const previousFactor = currentFactor;
  currentFactor = factor;
  resetRelaxationState();

  if (options.logChange !== false) {
    logTidiChange(metrics, previousFactor, factor);
  }

  if (options.schedule !== false) {
    scheduleAutoscaledFactorChange(factor, {
      ...options,
      nowMonotonicMs: metrics && metrics.endedAtMonotonicMs,
    });
  }

  return {
    changed: true,
    previousFactor,
    factor,
    metrics,
  };
}

function evaluateWindowMetrics(metrics, options = {}) {
  latestWindowMetrics = metrics;
  const shouldLogHold = options.logChange !== false;

  const transitionState = getTransitionLockState(
    metrics && metrics.endedAtMonotonicMs,
  );
  if (transitionState) {
    resetRelaxationState();
    if (shouldLogHold && currentFactor < 1.0) {
      logTidiHold(
        metrics,
        currentFactor,
        transitionState.phase === "pending" ? "transition-pending" : "transition-hold",
        transitionState,
      );
    }
    return {
      changed: false,
      factor: currentFactor,
      metrics,
      transitionState,
      reason: transitionState.phase === "pending"
        ? "transition-pending"
        : "transition-hold",
    };
  }

  const targetFactor = clampFactor(metrics && metrics.factor);
  if (Math.abs(targetFactor - currentFactor) < EPSILON) {
    resetRelaxationState();
    if (shouldLogHold && currentFactor < 1.0) {
      logTidiHold(metrics, currentFactor, "stable");
    }
    return {
      changed: false,
      factor: currentFactor,
      metrics,
      targetFactor,
      reason: "stable",
    };
  }

  if (targetFactor < currentFactor) {
    return {
      ...commitFactorChange(metrics, targetFactor, options),
      metrics,
      targetFactor,
      reason: "tighten",
    };
  }

  pendingRelaxFactor = targetFactor;
  pendingRelaxWindows += 1;
  if (pendingRelaxWindows < RELAX_CONFIRM_WINDOWS) {
    if (shouldLogHold && currentFactor < 1.0) {
      logTidiHold(metrics, currentFactor, "await-relax-confirmation");
    }
    return {
      changed: false,
      factor: currentFactor,
      pendingFactor: pendingRelaxFactor,
      pendingRelaxWindows,
      metrics,
      targetFactor,
      reason: "await-relax-confirmation",
    };
  }

  return {
    ...commitFactorChange(metrics, pendingRelaxFactor, options),
    metrics,
    targetFactor,
    reason: "relax",
  };
}

function observeRuntimeTickSampleInternal(sample, options = {}) {
  const normalizedSample = normalizeRuntimeTickSample(sample);
  if (skipNextSample) {
    skipNextSample = false;
    controlWindow = null;
    return {
      changed: false,
      factor: currentFactor,
      reason: "warmup-skip",
      sample: normalizedSample,
    };
  }
  if (!controlWindow) {
    controlWindow = createControlWindow(normalizedSample);
    return {
      changed: false,
      factor: currentFactor,
      reason: "collecting-window",
      sample: normalizedSample,
    };
  }

  addSampleToControlWindow(controlWindow, normalizedSample);
  const elapsedMs = (
    Number(controlWindow.endedAtMonotonicMs) -
    Number(controlWindow.startedAtMonotonicMs)
  );
  if (elapsedMs < CONTROL_WINDOW_MS) {
    return {
      changed: false,
      factor: currentFactor,
      reason: "collecting-window",
      sample: normalizedSample,
    };
  }

  const completedWindow = controlWindow;
  controlWindow = null;
  return evaluateWindowMetrics(finalizeControlWindow(completedWindow), options);
}

function observeRuntimeTickSample(sample, options = {}) {
  if (!isEffectivelyEnabled() || autoscalerEnabled !== true) {
    return {
      changed: false,
      factor: currentFactor,
      reason: "disabled",
    };
  }
  return observeRuntimeTickSampleInternal(sample, options);
}

function setRuntimeEnabled(value) {
  if (value === null || value === undefined) {
    runtimeEnabledOverride = null;
  } else {
    runtimeEnabledOverride = Boolean(value);
  }
  const target = isEffectivelyEnabled();
  if (target && !autoscalerEnabled) {
    start();
  } else if (!target && autoscalerEnabled) {
    stop();
  }
  appendTimeDilationLog(
    `RUNTIME_ENABLED_OVERRIDE override=${runtimeEnabledOverride === null ? "null" : runtimeEnabledOverride} effective=${target} config=${isConfigEnabled()}`,
  );
  return {
    runtimeOverride: runtimeEnabledOverride,
    configEnabled: isConfigEnabled(),
    effectivelyEnabled: target,
  };
}

function getEnabledState() {
  return {
    runtimeOverride: runtimeEnabledOverride,
    configEnabled: isConfigEnabled(),
    effectivelyEnabled: isEffectivelyEnabled(),
    autoscalerRunning: autoscalerEnabled,
  };
}

function start() {
  autoscalerEnabled = true;
  controlWindow = null;
  latestWindowMetrics = null;
  resetRelaxationState();
  skipNextSample = true;
}

function stop() {
  autoscalerEnabled = false;
  clearPendingScheduledChange();
  clearTransitionLock();
}

function resetState() {
  stop();
  currentFactor = 1.0;
  manualOverridesBySystem.clear();
  controlWindow = null;
  latestWindowMetrics = null;
  skipNextSample = false;
  clearTransitionLock();
  resetRelaxationState();
}

function logStartupStatus() {
  log.flushStack();
  const enabled = config.tidiAutoscaler !== false;
  const timestamp = new Date().toISOString().slice(11, 19);
  if (enabled) {
    const line =
      `${pc.dim(timestamp)} ${LABEL} ${pc.cyan("autoscaler")} ${pc.bold(pc.green("enabled"))} ${pc.dim(`(lateness based, ${CONTROL_WINDOW_MS}ms window)`)}`
    ;
    console.log(line);
    appendTimeDilationLog(
      `START enabled=true mode=lateness-based controlWindowMs=${CONTROL_WINDOW_MS} engageLatenessMs=${OVERLOAD_ENGAGE_LATENESS_MS} transitionHoldMs=${TRANSITION_HOLD_MS} advanceNoticeMs=${TIDI_ADVANCE_NOTICE_MS}`,
    );
  } else {
    const line =
      `${pc.dim(timestamp)} ${LABEL} ${pc.cyan("autoscaler")} ${pc.dim("disabled")}`
    ;
    console.log(line);
    appendTimeDilationLog("START enabled=false");
  }
}

function init() {
  logStartupStatus();
  if (isEffectivelyEnabled()) {
    start();
  }
}

module.exports = {
  init,
  start,
  stop,
  logStartupStatus,
  intervalToFactor,
  observeRuntimeTickSample,
  getCurrentFactor: () => currentFactor,
  setManualOverride,
  clearManualOverride,
  getManualOverride,
  hasManualOverride,
  listManualOverrides,
  setRuntimeEnabled,
  getEnabledState,
  isEffectivelyEnabled,
  getTransitionLockState,
  _testing: {
    createControlWindow,
    finalizeControlWindow,
    normalizeRuntimeTickSample,
    observeRuntimeTickSample: observeRuntimeTickSampleInternal,
    evaluateWindowMetrics,
    getCurrentFactor: () => currentFactor,
    getLatestWindowMetrics: () => (latestWindowMetrics ? { ...latestWindowMetrics } : null),
    getManualOverride,
    hasManualOverride,
    listManualOverrides,
    filterAutoscaleEligibleSystemIDs,
    getPendingRelaxFactor: () => pendingRelaxFactor,
    getPendingRelaxWindows: () => pendingRelaxWindows,
    getScheduledFactor: () => scheduledFactor,
    getSkipNextSample: () => skipNextSample,
    getTransitionLockState,
    resetState,
  },
};
