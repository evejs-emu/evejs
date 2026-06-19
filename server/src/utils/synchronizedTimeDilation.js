"use strict";

const path = require("path");

const sessionRegistry = require(path.join(
  __dirname,
  "../services/chat/sessionRegistry",
));

const TIDI_ADVANCE_NOTICE_MS = 2000;

function clampTimeDilationFactor(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 1.0;
  }
  return Math.min(1.0, Math.max(0.1, numeric));
}

function buildTimeDilationNotificationArgs(factor) {
  const normalizedFactor = clampTimeDilationFactor(factor);
  const isDisabling = normalizedFactor >= 1.0;
  return [
    isDisabling ? 1.0 : normalizedFactor,
    // Force a deterministic snap back to full speed on every client when
    // clearing TiDi; restoring the stock 0.1 minimum lets clients recover on
    // their own timeline under multi-client load.
    isDisabling ? 1.0 : normalizedFactor,
    isDisabling ? 100000000 : 0,
  ];
}

function sendTimeDilationNotificationToSystem(systemID, factor) {
  const notificationArgs = buildTimeDilationNotificationArgs(factor);
  let sentCount = 0;
  for (const targetSession of sessionRegistry.getSessions()) {
    const targetSystemID = Number(
      targetSession &&
        targetSession._space &&
        targetSession._space.systemID ||
        targetSession && targetSession.solarsystemid2 ||
        targetSession && targetSession.solarsystemid ||
        0,
    );
    if (targetSystemID !== Number(systemID)) {
      continue;
    }
    if (
      !targetSession.socket ||
      targetSession.socket.destroyed ||
      typeof targetSession.sendNotification !== "function"
    ) {
      continue;
    }
    targetSession.sendNotification(
      "OnSetTimeDilation",
      "clientID",
      notificationArgs,
    );
    sentCount += 1;
  }
  return sentCount;
}

function sendTimeDilationNotificationToSession(session, factor) {
  if (
    !session ||
    !session.socket ||
    session.socket.destroyed ||
    typeof session.sendNotification !== "function"
  ) {
    return false;
  }

  session.sendNotification(
    "OnSetTimeDilation",
    "clientID",
    buildTimeDilationNotificationArgs(factor),
  );
  return true;
}

function getCurrentSystemFactor(systemID) {
  const spaceRuntime = require(path.join(__dirname, "../space/runtime"));
  return clampTimeDilationFactor(
    spaceRuntime.getSolarSystemTimeDilation(systemID),
  );
}

function getSystemsNeedingTimeDilationChange(systemIDs, factor, options = {}) {
  const normalizedFactor = clampTimeDilationFactor(factor);
  const getCurrentSystemFactorFn =
    typeof options.getCurrentSystemFactorFn === "function"
      ? options.getCurrentSystemFactorFn
      : getCurrentSystemFactor;

  return normalizeSystemIDs(systemIDs).filter((systemID) => {
    const currentFactor = clampTimeDilationFactor(
      getCurrentSystemFactorFn(systemID),
    );
    return Math.abs(currentFactor - normalizedFactor) > 0.000001;
  });
}

function applyTimeDilationToSystem(systemID, factor) {
  const spaceRuntime = require(path.join(__dirname, "../space/runtime"));
  const normalizedFactor = clampTimeDilationFactor(factor);
  const currentFactor = clampTimeDilationFactor(
    spaceRuntime.getSolarSystemTimeDilation(systemID),
  );
  if (Math.abs(currentFactor - normalizedFactor) <= 0.000001) {
    return {
      success: true,
      data: {
        systemID: Number(systemID) || 0,
        factor: currentFactor,
        previousFactor: currentFactor,
        skippedNoop: true,
        syncedSessionCount: 0,
      },
    };
  }
  return spaceRuntime.setSolarSystemTimeDilation(systemID, normalizedFactor, {
    syncSessions: true,
    emit: true,
    forceRebase: true,
  });
}

function normalizeSystemIDs(systemIDs) {
  return [...new Set(
    (Array.isArray(systemIDs) ? systemIDs : [])
      .map((systemID) => Number(systemID) || 0)
      .filter((systemID) => systemID > 0),
  )];
}

function scheduleSynchronizedTimeDilationForSystems(
  systemIDs,
  factor,
  options = {},
) {
  const normalizedFactor = clampTimeDilationFactor(factor);
  const uniqueSystemIDs = getSystemsNeedingTimeDilationChange(
    systemIDs,
    normalizedFactor,
    options,
  );
  const delayMs = Number.isFinite(Number(options.delayMs))
    ? Number(options.delayMs)
    : TIDI_ADVANCE_NOTICE_MS;
  const setTimeoutFn = typeof options.setTimeoutFn === "function"
    ? options.setTimeoutFn
    : setTimeout;
  const notifySystemFn = typeof options.notifySystemFn === "function"
    ? options.notifySystemFn
    : sendTimeDilationNotificationToSystem;
  const applySystemFactorFn = typeof options.applySystemFactorFn === "function"
    ? options.applySystemFactorFn
    : applyTimeDilationToSystem;

  if (uniqueSystemIDs.length === 0) {
    return null;
  }

  return setTimeoutFn(() => {
    const systemsToApply = getSystemsNeedingTimeDilationChange(
      uniqueSystemIDs,
      normalizedFactor,
      options,
    );
    for (const systemID of systemsToApply) {
      notifySystemFn(systemID, normalizedFactor);
      applySystemFactorFn(systemID, normalizedFactor);
    }
  }, delayMs);
}

function scheduleAdvanceNoticeTimeDilationForSystems(
  systemIDs,
  factor,
  options = {},
) {
  const normalizedFactor = clampTimeDilationFactor(factor);
  const uniqueSystemIDs = getSystemsNeedingTimeDilationChange(
    systemIDs,
    normalizedFactor,
    options,
  );
  const delayMs = Number.isFinite(Number(options.delayMs))
    ? Number(options.delayMs)
    : TIDI_ADVANCE_NOTICE_MS;
  const setTimeoutFn = typeof options.setTimeoutFn === "function"
    ? options.setTimeoutFn
    : setTimeout;
  const notifySystemFn = typeof options.notifySystemFn === "function"
    ? options.notifySystemFn
    : sendTimeDilationNotificationToSystem;
  const applySystemFactorFn = typeof options.applySystemFactorFn === "function"
    ? options.applySystemFactorFn
    : applyTimeDilationToSystem;
  const onNotified = typeof options.onNotified === "function"
    ? options.onNotified
    : null;
  const onApplied = typeof options.onApplied === "function"
    ? options.onApplied
    : null;

  if (uniqueSystemIDs.length === 0) {
    return null;
  }

  for (const systemID of uniqueSystemIDs) {
    notifySystemFn(systemID, normalizedFactor);
  }
  if (onNotified) {
    onNotified(uniqueSystemIDs, normalizedFactor);
  }

  return setTimeoutFn(() => {
    const systemsToApply = getSystemsNeedingTimeDilationChange(
      uniqueSystemIDs,
      normalizedFactor,
      options,
    );
    for (const systemID of systemsToApply) {
      applySystemFactorFn(systemID, normalizedFactor);
    }
    if (onApplied) {
      onApplied(systemsToApply, normalizedFactor);
    }
  }, delayMs);
}

module.exports = {
  TIDI_ADVANCE_NOTICE_MS,
  applyTimeDilationToSystem,
  buildTimeDilationNotificationArgs,
  scheduleAdvanceNoticeTimeDilationForSystems,
  sendTimeDilationNotificationToSession,
  sendTimeDilationNotificationToSystem,
  scheduleSynchronizedTimeDilationForSystems,
};
