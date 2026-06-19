function toInt(value, fallback = 0) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.trunc(numeric);
  }
  const fallbackNumeric = Number(fallback);
  return Number.isFinite(fallbackNumeric) ? Math.trunc(fallbackNumeric) : 0;
}

function cloneHeldQueueState(source) {
  if (!source || typeof source !== "object") {
    return {
      active: false,
      queuedCount: 0,
      lastQueueStamp: 0,
    };
  }
  return {
    active: source.active === true,
    queuedCount: Math.max(0, toInt(source.queuedCount, 0)),
    lastQueueStamp: toInt(source.lastQueueStamp, 0) >>> 0,
  };
}

function ensureDestinyAuthorityState(session) {
  if (!session || !session._space) {
    return null;
  }
  const spaceState = session._space;
  const currentState =
    spaceState.destinyAuthorityState &&
    typeof spaceState.destinyAuthorityState === "object"
      ? spaceState.destinyAuthorityState
      : {};

  const nextState = {
    lastRawDispatchStamp: toInt(
      currentState.lastRawDispatchStamp,
      spaceState.lastSentDestinyRawDispatchStamp,
    ) >>> 0,
    lastPresentedStamp: toInt(
      currentState.lastPresentedStamp,
      spaceState.lastSentDestinyStamp,
    ) >>> 0,
    lastCriticalStamp: toInt(
      currentState.lastCriticalStamp,
      Math.max(
        toInt(spaceState.lastOwnerNonMissileCriticalStamp, 0),
        toInt(spaceState.lastOwnerMissileLifecycleStamp, 0),
        toInt(spaceState.lastOwnerMissileFreshAcquireStamp, 0),
        toInt(spaceState.lastPilotCommandMovementStamp, 0),
      ),
    ) >>> 0,
    lastNonCriticalStamp: toInt(
      currentState.lastNonCriticalStamp,
      spaceState.lastSentDestinyWasOwnerCritical === true
        ? 0
        : toInt(spaceState.lastSentDestinyStamp, 0),
    ) >>> 0,
    lastSentWasOwnerCritical:
      currentState.lastSentWasOwnerCritical === true ||
      (
        currentState.lastSentWasOwnerCritical !== false &&
        spaceState.lastSentDestinyWasOwnerCritical === true
      ),
    lastSentOnlyStaleProjectedOwnerMissileLane:
      currentState.lastSentOnlyStaleProjectedOwnerMissileLane === true ||
      (
        currentState.lastSentOnlyStaleProjectedOwnerMissileLane !== false &&
        spaceState.lastSentDestinyOnlyStaleProjectedOwnerMissileLane === true
      ),
    lastOwnerCommandStamp: toInt(
      currentState.lastOwnerCommandStamp,
      spaceState.lastPilotCommandMovementStamp,
    ) >>> 0,
    lastOwnerCommandAnchorStamp: toInt(
      currentState.lastOwnerCommandAnchorStamp,
      spaceState.lastPilotCommandMovementAnchorStamp,
    ) >>> 0,
    lastOwnerCommandRawDispatchStamp: toInt(
      currentState.lastOwnerCommandRawDispatchStamp,
      spaceState.lastPilotCommandMovementRawDispatchStamp,
    ) >>> 0,
    lastOwnerCommandHeadingHash: typeof currentState.lastOwnerCommandHeadingHash === "string"
      ? currentState.lastOwnerCommandHeadingHash
      : "",
    lastFreshAcquireLifecycleStamp: toInt(
      currentState.lastFreshAcquireLifecycleStamp,
      spaceState.lastFreshAcquireLifecycleStamp,
    ) >>> 0,
    lastBootstrapStamp: toInt(
      currentState.lastBootstrapStamp,
      Math.max(
        toInt(spaceState.lastFreshAcquireLifecycleStamp, 0),
        toInt(spaceState.lastOwnerMissileFreshAcquireStamp, 0),
      ),
    ) >>> 0,
    lastMissileLifecycleStamp: toInt(
      currentState.lastMissileLifecycleStamp,
      Math.max(
        toInt(spaceState.lastMissileLifecycleStamp, 0),
        toInt(spaceState.lastOwnerMissileLifecycleStamp, 0),
      ),
    ) >>> 0,
    lastOwnerMissileLifecycleStamp: toInt(
      currentState.lastOwnerMissileLifecycleStamp,
      spaceState.lastOwnerMissileLifecycleStamp,
    ) >>> 0,
    lastOwnerMissileLifecycleAnchorStamp: toInt(
      currentState.lastOwnerMissileLifecycleAnchorStamp,
      spaceState.lastOwnerMissileLifecycleAnchorStamp,
    ) >>> 0,
    lastOwnerMissileLifecycleRawDispatchStamp: toInt(
      currentState.lastOwnerMissileLifecycleRawDispatchStamp,
      spaceState.lastOwnerMissileLifecycleRawDispatchStamp,
    ) >>> 0,
    lastOwnerMissileFreshAcquireStamp: toInt(
      currentState.lastOwnerMissileFreshAcquireStamp,
      spaceState.lastOwnerMissileFreshAcquireStamp,
    ) >>> 0,
    lastOwnerMissileFreshAcquireAnchorStamp: toInt(
      currentState.lastOwnerMissileFreshAcquireAnchorStamp,
      spaceState.lastOwnerMissileFreshAcquireAnchorStamp,
    ) >>> 0,
    lastOwnerMissileFreshAcquireRawDispatchStamp: toInt(
      currentState.lastOwnerMissileFreshAcquireRawDispatchStamp,
      spaceState.lastOwnerMissileFreshAcquireRawDispatchStamp,
    ) >>> 0,
    lastOwnerNonMissileCriticalStamp: toInt(
      currentState.lastOwnerNonMissileCriticalStamp,
      spaceState.lastOwnerNonMissileCriticalStamp,
    ) >>> 0,
    lastOwnerNonMissileCriticalRawDispatchStamp: toInt(
      currentState.lastOwnerNonMissileCriticalRawDispatchStamp,
      spaceState.lastOwnerNonMissileCriticalRawDispatchStamp,
    ) >>> 0,
    lastResetStamp: toInt(
      currentState.lastResetStamp,
      0,
    ) >>> 0,
    heldQueueState: cloneHeldQueueState(currentState.heldQueueState),
    lastJourneyId: typeof currentState.lastJourneyId === "string"
      ? currentState.lastJourneyId
      : "",
  };

  spaceState.destinyAuthorityState = nextState;
  return nextState;
}

function snapshotDestinyAuthorityState(session) {
  const state = ensureDestinyAuthorityState(session);
  if (!state) {
    return null;
  }
  return {
    ...state,
    heldQueueState: cloneHeldQueueState(state.heldQueueState),
  };
}

function updateDestinyAuthorityState(session, patch = {}) {
  const state = ensureDestinyAuthorityState(session);
  if (!state || !patch || typeof patch !== "object") {
    return state;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "lastRawDispatchStamp")) {
    state.lastRawDispatchStamp = toInt(patch.lastRawDispatchStamp, state.lastRawDispatchStamp) >>> 0;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "lastPresentedStamp")) {
    state.lastPresentedStamp = toInt(patch.lastPresentedStamp, state.lastPresentedStamp) >>> 0;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "lastCriticalStamp")) {
    state.lastCriticalStamp = toInt(patch.lastCriticalStamp, state.lastCriticalStamp) >>> 0;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "lastNonCriticalStamp")) {
    state.lastNonCriticalStamp = toInt(patch.lastNonCriticalStamp, state.lastNonCriticalStamp) >>> 0;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "lastSentWasOwnerCritical")) {
    state.lastSentWasOwnerCritical = patch.lastSentWasOwnerCritical === true;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "lastSentOnlyStaleProjectedOwnerMissileLane")) {
    state.lastSentOnlyStaleProjectedOwnerMissileLane =
      patch.lastSentOnlyStaleProjectedOwnerMissileLane === true;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "lastOwnerCommandStamp")) {
    state.lastOwnerCommandStamp = toInt(patch.lastOwnerCommandStamp, state.lastOwnerCommandStamp) >>> 0;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "lastOwnerCommandAnchorStamp")) {
    state.lastOwnerCommandAnchorStamp = toInt(
      patch.lastOwnerCommandAnchorStamp,
      state.lastOwnerCommandAnchorStamp,
    ) >>> 0;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "lastOwnerCommandRawDispatchStamp")) {
    state.lastOwnerCommandRawDispatchStamp = toInt(
      patch.lastOwnerCommandRawDispatchStamp,
      state.lastOwnerCommandRawDispatchStamp,
    ) >>> 0;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "lastOwnerCommandHeadingHash")) {
    state.lastOwnerCommandHeadingHash =
      typeof patch.lastOwnerCommandHeadingHash === "string"
        ? patch.lastOwnerCommandHeadingHash
        : state.lastOwnerCommandHeadingHash;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "lastFreshAcquireLifecycleStamp")) {
    state.lastFreshAcquireLifecycleStamp = toInt(
      patch.lastFreshAcquireLifecycleStamp,
      state.lastFreshAcquireLifecycleStamp,
    ) >>> 0;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "lastBootstrapStamp")) {
    state.lastBootstrapStamp = toInt(patch.lastBootstrapStamp, state.lastBootstrapStamp) >>> 0;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "lastMissileLifecycleStamp")) {
    state.lastMissileLifecycleStamp = toInt(
      patch.lastMissileLifecycleStamp,
      state.lastMissileLifecycleStamp,
    ) >>> 0;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "lastOwnerMissileLifecycleStamp")) {
    state.lastOwnerMissileLifecycleStamp = toInt(
      patch.lastOwnerMissileLifecycleStamp,
      state.lastOwnerMissileLifecycleStamp,
    ) >>> 0;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "lastOwnerMissileLifecycleAnchorStamp")) {
    state.lastOwnerMissileLifecycleAnchorStamp = toInt(
      patch.lastOwnerMissileLifecycleAnchorStamp,
      state.lastOwnerMissileLifecycleAnchorStamp,
    ) >>> 0;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "lastOwnerMissileLifecycleRawDispatchStamp")) {
    state.lastOwnerMissileLifecycleRawDispatchStamp = toInt(
      patch.lastOwnerMissileLifecycleRawDispatchStamp,
      state.lastOwnerMissileLifecycleRawDispatchStamp,
    ) >>> 0;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "lastOwnerMissileFreshAcquireStamp")) {
    state.lastOwnerMissileFreshAcquireStamp = toInt(
      patch.lastOwnerMissileFreshAcquireStamp,
      state.lastOwnerMissileFreshAcquireStamp,
    ) >>> 0;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "lastOwnerMissileFreshAcquireAnchorStamp")) {
    state.lastOwnerMissileFreshAcquireAnchorStamp = toInt(
      patch.lastOwnerMissileFreshAcquireAnchorStamp,
      state.lastOwnerMissileFreshAcquireAnchorStamp,
    ) >>> 0;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "lastOwnerMissileFreshAcquireRawDispatchStamp")) {
    state.lastOwnerMissileFreshAcquireRawDispatchStamp = toInt(
      patch.lastOwnerMissileFreshAcquireRawDispatchStamp,
      state.lastOwnerMissileFreshAcquireRawDispatchStamp,
    ) >>> 0;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "lastOwnerNonMissileCriticalStamp")) {
    state.lastOwnerNonMissileCriticalStamp = toInt(
      patch.lastOwnerNonMissileCriticalStamp,
      state.lastOwnerNonMissileCriticalStamp,
    ) >>> 0;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "lastOwnerNonMissileCriticalRawDispatchStamp")) {
    state.lastOwnerNonMissileCriticalRawDispatchStamp = toInt(
      patch.lastOwnerNonMissileCriticalRawDispatchStamp,
      state.lastOwnerNonMissileCriticalRawDispatchStamp,
    ) >>> 0;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "lastResetStamp")) {
    state.lastResetStamp = toInt(patch.lastResetStamp, state.lastResetStamp) >>> 0;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "heldQueueState")) {
    state.heldQueueState = cloneHeldQueueState(patch.heldQueueState);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "lastJourneyId")) {
    state.lastJourneyId =
      typeof patch.lastJourneyId === "string"
        ? patch.lastJourneyId
        : state.lastJourneyId;
  }

  return state;
}

module.exports = {
  ensureDestinyAuthorityState,
  snapshotDestinyAuthorityState,
  updateDestinyAuthorityState,
};
