const destiny = require("../../destiny");
const {
  projectPreviouslySentDestinyLane,
} = require("../movementDeliveryPolicy");
const {
  resolveStateRefreshStamp,
} = require("../movementSync");
const {
  DESTINY_CONTRACTS,
} = require("../authority/destinyContracts");
const {
  snapshotDestinyAuthorityState,
} = require("../authority/destinySessionState");

function createMovementSceneRefresh(deps = {}) {
  const {
    buildMissileSessionSnapshot,
    buildDbuffStateEntriesForSession,
    notifyActiveAssistanceJamStatesToSession,
    notifyActiveHostileJamStatesToSession,
    notifyActiveCommandBurstHudStatesToSession,
    isReadyForDestiny,
    logMissileDebug,
    logMovementDebug,
    refreshEntitiesForSlimPayload,
    refreshShipPresentationFields,
    roundNumber,
    summarizeRuntimeEntityForMissileDebug,
    toInt,
    MICHELLE_HELD_FUTURE_DESTINY_LEAD,
  } = deps;

  return {
    sendStateRefresh(runtime, session, egoEntity, stampOverride = null, options = {}) {
      if (!session || !egoEntity || !isReadyForDestiny(session)) {
        return;
      }

      refreshShipPresentationFields(egoEntity);
      const visibleEntities = refreshEntitiesForSlimPayload(
        runtime.getVisibleEntitiesForSession(session),
      );
      const stateRefreshVisibleEntities = visibleEntities.filter((entity) => !(
        entity &&
        entity.dungeonMaterializedSiteContent === true &&
        entity.staticVisibilityScope === "bubble"
      ));
      const rawStamp =
        stampOverride === null
          ? runtime.getNextDestinyStamp()
          : toInt(stampOverride, runtime.getNextDestinyStamp());
      const rawSimTimeMs =
        options.nowMs === undefined || options.nowMs === null
          ? runtime.getCurrentSimTimeMs()
          : Number(options.nowMs);
      const currentRawDispatchStamp = runtime.getCurrentDestinyStamp(rawSimTimeMs);
      const requestedStamp = runtime.translateDestinyStampForSession(session, rawStamp);
      const currentSessionStamp = runtime.getCurrentSessionDestinyStamp(
        session,
        rawSimTimeMs,
      );
      const authorityState = snapshotDestinyAuthorityState(session);
      const currentImmediateSessionStamp = runtime.getImmediateDestinyStampForSession(
        session,
        currentSessionStamp,
      );
      const lastSentDestinyStamp = toInt(
        authorityState && authorityState.lastPresentedStamp,
        session._space && session._space.lastSentDestinyStamp,
        requestedStamp,
      ) >>> 0;
      const lastSentDestinyRawDispatchStamp = toInt(
        authorityState && authorityState.lastRawDispatchStamp,
        session._space && session._space.lastSentDestinyRawDispatchStamp,
        0,
      ) >>> 0;
      const projectedLastSentLane =
        lastSentDestinyStamp > 0 &&
        lastSentDestinyRawDispatchStamp > 0 &&
        currentRawDispatchStamp > lastSentDestinyRawDispatchStamp &&
        (currentRawDispatchStamp - lastSentDestinyRawDispatchStamp) <= 1
          ? projectPreviouslySentDestinyLane(
            lastSentDestinyStamp,
            lastSentDestinyRawDispatchStamp,
            currentRawDispatchStamp,
          )
          : 0;
      const lastOwnerMissileLifecycleStamp = toInt(
        authorityState && authorityState.lastOwnerMissileLifecycleStamp,
        session._space && session._space.lastOwnerMissileLifecycleStamp,
        0,
      ) >>> 0;
      const lastOwnerMissileLifecycleRawDispatchStamp = toInt(
        authorityState && authorityState.lastOwnerMissileLifecycleRawDispatchStamp,
        session._space && session._space.lastOwnerMissileLifecycleRawDispatchStamp,
        0,
      ) >>> 0;
      const projectedOwnerMissileLifecycleLane =
        lastOwnerMissileLifecycleStamp > 0 &&
        lastOwnerMissileLifecycleRawDispatchStamp > 0 &&
        currentRawDispatchStamp > lastOwnerMissileLifecycleRawDispatchStamp &&
        (currentRawDispatchStamp - lastOwnerMissileLifecycleRawDispatchStamp) <= 1
          ? projectPreviouslySentDestinyLane(
            lastOwnerMissileLifecycleStamp,
            lastOwnerMissileLifecycleRawDispatchStamp,
            currentRawDispatchStamp,
          )
          : 0;
      const lastPilotCommandMovementStamp = toInt(
        authorityState && authorityState.lastOwnerCommandStamp,
        session._space && session._space.lastPilotCommandMovementStamp,
        0,
      ) >>> 0;
      const refreshStampState = resolveStateRefreshStamp({
        requestedStamp,
        currentImmediateSessionStamp,
        recentEmittedOwnerCriticalMaxLead: MICHELLE_HELD_FUTURE_DESTINY_LEAD,
        lastSentDestinyStamp,
        projectedLastSentLane,
        lastOwnerMissileLifecycleStamp,
        projectedOwnerMissileLifecycleLane,
        lastPilotCommandMovementStamp,
      });
      const {
        recentFutureLastSentLane,
        recentProjectedLastSentLane,
        recentOwnerMissileLifecycleLane,
        recentProjectedOwnerMissileLifecycleLane,
        recentOwnerMovementLane,
        monotonicRefreshFloorBase,
        stamp,
      } = refreshStampState;
      const simFileTime = runtime.getCurrentSessionFileTime(session, rawSimTimeMs);
      logMissileDebug("set-state.refresh", {
        reason:
          typeof options.reason === "string"
            ? options.reason
            : null,
        session: buildMissileSessionSnapshot(runtime, session, rawSimTimeMs),
        egoEntity: summarizeRuntimeEntityForMissileDebug(egoEntity),
        rawSimTimeMs: roundNumber(rawSimTimeMs, 3),
        rawDispatchStamp: currentRawDispatchStamp,
        rawRequestedStamp: rawStamp >>> 0,
        requestedStamp,
        recentFutureLastSentLane,
        recentProjectedLastSentLane,
        recentOwnerMissileLifecycleLane,
        recentProjectedOwnerMissileLifecycleLane,
        recentOwnerMovementLane,
        monotonicRefreshFloorBase,
        finalStamp: stamp,
        visibleEntityCount: stateRefreshVisibleEntities.length,
      });
      // SetState must skip the owner-critical monotonic restamp pass.
      // During missile combat, lifecycle stamps compound far ahead of
      // current time. The monotonic pass would lift the SetState stamp to
      // match those compounded stamps, creating a _latest_set_state_time
      // floor that invalidates all subsequent near-current-time updates.
      // SetState at near-current time is safe: in-flight missile updates
      // at higher stamps are ABOVE the floor and won't be discarded.
      runtime.sendDestinyUpdates(session, [
        {
          stamp,
          payload: destiny.buildSetStatePayload(
            stamp,
            runtime.system,
            egoEntity.itemID,
            stateRefreshVisibleEntities,
            simFileTime,
            typeof buildDbuffStateEntriesForSession === "function"
              ? buildDbuffStateEntriesForSession(session, egoEntity, rawSimTimeMs)
              : [],
          ),
        },
      ], false, {
        destinyAuthorityContract: DESTINY_CONTRACTS.STATE_RESET,
        skipOwnerMonotonicRestamp: true,
        translateStamps: false,
        missileDebugReason:
          typeof options.reason === "string"
            ? `set-state:${options.reason}`
            : "set-state:unspecified",
      });
      if (
        options.skipHudIconReseed !== true &&
        typeof notifyActiveAssistanceJamStatesToSession === "function"
      ) {
        notifyActiveAssistanceJamStatesToSession(
          runtime,
          session,
          egoEntity,
          stateRefreshVisibleEntities,
          rawSimTimeMs,
        );
      }
      if (
        options.skipHudIconReseed !== true &&
        typeof notifyActiveHostileJamStatesToSession === "function"
      ) {
        notifyActiveHostileJamStatesToSession(
          runtime,
          session,
          egoEntity,
          stateRefreshVisibleEntities,
          rawSimTimeMs,
        );
      }
      if (
        options.skipHudIconReseed !== true &&
        typeof notifyActiveCommandBurstHudStatesToSession === "function"
      ) {
        notifyActiveCommandBurstHudStatesToSession(
          runtime,
          session,
          egoEntity,
          rawSimTimeMs,
        );
      }
    },

    scheduleWatcherMovementAnchor(
      runtime,
      entity,
      now = runtime.getCurrentSimTimeMs(),
      reason = "movement",
    ) {
      if (!entity) {
        return false;
      }

      entity.lastObserverCorrectionBroadcastAt = 0;
      logMovementDebug("observer.anchor.scheduled", entity, {
        reason,
      });
      return true;
    },
  };
}

module.exports = {
  createMovementSceneRefresh,
};
