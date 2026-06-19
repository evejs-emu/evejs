function createMovementWatcherCorrections(deps = {}) {
  const {
    destiny,
    toInt,
    ACTIVE_SUBWARP_WATCHER_CORRECTION_INTERVAL_MS,
    ACTIVE_SUBWARP_WATCHER_POSITION_CORRECTION_INTERVAL_MS,
    ENABLE_PILOT_WARP_ACTIVE_CORRECTIONS,
    PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
    WATCHER_CORRECTION_INTERVAL_MS,
    WATCHER_POSITION_CORRECTION_INTERVAL_MS,
  } = deps;

  function buildPositionVelocityCorrectionUpdates(entity, options = {}) {
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

  function buildPilotWarpCorrectionUpdates(entity, stamp) {
    return buildPositionVelocityCorrectionUpdates(entity, {
      stamp,
      includePosition: true,
    });
  }

  function usesActiveSubwarpWatcherCorrections(entity) {
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

  function usesLocalStopDecelContract(entity) {
    return Boolean(
      entity &&
        entity.mode === "STOP" &&
        entity.pendingDock == null &&
        !entity.pendingWarp &&
        !entity.warpState,
    );
  }

  function getWatcherCorrectionIntervalMs(entity) {
    return usesActiveSubwarpWatcherCorrections(entity)
      ? ACTIVE_SUBWARP_WATCHER_CORRECTION_INTERVAL_MS
      : WATCHER_CORRECTION_INTERVAL_MS;
  }

  function getWatcherPositionCorrectionIntervalMs(entity) {
    return usesActiveSubwarpWatcherCorrections(entity)
      ? ACTIVE_SUBWARP_WATCHER_POSITION_CORRECTION_INTERVAL_MS
      : WATCHER_POSITION_CORRECTION_INTERVAL_MS;
  }

  function resolveWatcherCorrectionDispatch(options = {}) {
    const runtime = options.runtime;
    const entity = options.entity;
    const result = options.result || {};
    const now = Number(options.now) || 0;
    const sessionOnlyUpdates = Array.isArray(options.sessionOnlyUpdates)
      ? options.sessionOnlyUpdates
      : [];
    const watcherOnlyUpdates = Array.isArray(options.watcherOnlyUpdates)
      ? options.watcherOnlyUpdates
      : [];
    let correctionDebug = null;

    if (entity.mode === "WARP") {
      const warpState = entity.warpState || null;
      const warpCommandStamp = toInt(
        warpState && warpState.commandStamp,
        0,
      ) >>> 0;
      const warpCorrectionStamp = Math.max(
        runtime.getMovementStamp(now),
        warpCommandStamp,
      ) >>> 0;
      const inActivePilotWarpPhase =
        !entity.pendingWarp &&
        warpCommandStamp > 0;
      const shouldSendPilotWarpCorrection =
        ENABLE_PILOT_WARP_ACTIVE_CORRECTIONS &&
        inActivePilotWarpPhase &&
        warpCorrectionStamp > warpCommandStamp &&
        warpCorrectionStamp !==
          toInt(entity.lastWarpPositionBroadcastStamp, -1);
      if (shouldSendPilotWarpCorrection) {
        const pilotWarpCorrectionUpdates = buildPilotWarpCorrectionUpdates(
          entity,
          warpCorrectionStamp,
        );
        if (pilotWarpCorrectionUpdates.length > 0) {
          sessionOnlyUpdates.push({
            session: entity.session,
            updates: pilotWarpCorrectionUpdates,
            sendOptions: {
              minimumLeadFromCurrentHistory: PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
              maximumLeadFromCurrentHistory: PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
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
      return correctionDebug;
    }

    const correctionStamp = runtime.getMovementStamp(now);
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
        now - entity.lastObserverCorrectionBroadcastAt >=
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
    return correctionDebug;
  }

  return {
    buildPositionVelocityCorrectionUpdates,
    buildPilotWarpCorrectionUpdates,
    usesActiveSubwarpWatcherCorrections,
    usesLocalStopDecelContract,
    getWatcherCorrectionIntervalMs,
    getWatcherPositionCorrectionIntervalMs,
    resolveWatcherCorrectionDispatch,
  };
}

module.exports = {
  createMovementWatcherCorrections,
};
