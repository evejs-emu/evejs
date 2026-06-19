function toInt(value, fallback = 0) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.trunc(numeric);
  }
  const fallbackNumeric = Number(fallback);
  return Number.isFinite(fallbackNumeric) ? Math.trunc(fallbackNumeric) : 0;
}

function toUInt32(value, fallback = 0) {
  return toInt(value, fallback) >>> 0;
}

function getRecentLaneWithinLead(
  laneStamp,
  currentImmediateSessionStamp,
  maximumLead,
) {
  const normalizedLaneStamp = toUInt32(laneStamp, 0);
  const normalizedCurrentImmediateSessionStamp = toUInt32(
    currentImmediateSessionStamp,
    0,
  );
  const normalizedMaximumLead = Math.max(0, toInt(maximumLead, 0));
  return (
    normalizedLaneStamp > normalizedCurrentImmediateSessionStamp &&
    normalizedLaneStamp <= (
      normalizedCurrentImmediateSessionStamp +
      normalizedMaximumLead
    )
  )
    ? normalizedLaneStamp
    : 0;
}

function resolveStateRefreshStamp(options = {}) {
  const requestedStamp = toUInt32(options.requestedStamp, 0);
  const currentImmediateSessionStamp = toUInt32(
    options.currentImmediateSessionStamp,
    0,
  );
  const recentEmittedOwnerCriticalMaxLead = Math.max(
    0,
    toInt(options.recentEmittedOwnerCriticalMaxLead, 0),
  );
  const recentFutureLastSentLane = getRecentLaneWithinLead(
    options.lastSentDestinyStamp,
    currentImmediateSessionStamp,
    recentEmittedOwnerCriticalMaxLead,
  );
  const recentProjectedLastSentLane = getRecentLaneWithinLead(
    options.projectedLastSentLane,
    currentImmediateSessionStamp,
    recentEmittedOwnerCriticalMaxLead,
  );
  const recentOwnerMissileLifecycleLane = getRecentLaneWithinLead(
    options.lastOwnerMissileLifecycleStamp,
    currentImmediateSessionStamp,
    recentEmittedOwnerCriticalMaxLead,
  );
  const recentProjectedOwnerMissileLifecycleLane = getRecentLaneWithinLead(
    options.projectedOwnerMissileLifecycleLane,
    currentImmediateSessionStamp,
    recentEmittedOwnerCriticalMaxLead,
  );
  const recentOwnerMovementLane = getRecentLaneWithinLead(
    options.lastPilotCommandMovementStamp,
    currentImmediateSessionStamp,
    recentEmittedOwnerCriticalMaxLead,
  );
  const monotonicRefreshFloorBase = Math.max(
    recentFutureLastSentLane,
    recentProjectedLastSentLane,
    recentOwnerMovementLane,
    recentOwnerMissileLifecycleLane,
    recentProjectedOwnerMissileLifecycleLane,
  ) >>> 0;
  const stamp = Math.max(
    requestedStamp,
    monotonicRefreshFloorBase > 0
      ? ((monotonicRefreshFloorBase + 1) >>> 0)
      : 0,
  ) >>> 0;

  return {
    recentFutureLastSentLane,
    recentProjectedLastSentLane,
    recentOwnerMissileLifecycleLane,
    recentProjectedOwnerMissileLifecycleLane,
    recentOwnerMovementLane,
    monotonicRefreshFloorBase,
    stamp,
  };
}

function clampQueuedSubwarpUpdates(options = {}) {
  const queuedUpdates = Array.isArray(options.queuedUpdates)
    ? options.queuedUpdates
    : [];
  if (queuedUpdates.length === 0) {
    return queuedUpdates;
  }

  const visibleFloorStamp = toUInt32(options.visibleFloorStamp, 0);
  const presentedFloorStamp = toUInt32(options.presentedFloorStamp, 0);
  const projectedFloorStamp = toUInt32(options.projectedFloorStamp, 0);
  const restampPayloadState =
    typeof options.restampPayloadState === "function"
      ? options.restampPayloadState
      : null;

  return queuedUpdates.map((update) => {
    const authoredStamp = toUInt32(update && update.stamp, 0);
    const deliveryStamp = Math.max(
      authoredStamp,
      visibleFloorStamp,
      presentedFloorStamp,
      projectedFloorStamp,
    ) >>> 0;
    if (deliveryStamp === authoredStamp) {
      return update;
    }
    return {
      ...update,
      stamp: deliveryStamp,
      payload: restampPayloadState
        ? restampPayloadState(update && update.payload, deliveryStamp)
        : (update && update.payload),
    };
  });
}

module.exports = {
  resolveStateRefreshStamp,
  clampQueuedSubwarpUpdates,
};
