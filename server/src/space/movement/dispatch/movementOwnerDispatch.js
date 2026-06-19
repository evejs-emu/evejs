const {
  isSteeringPayloadName,
} = require("../movementParity");
const {
  resolveOwnerMovementRestampState,
} = require("../movementDeliveryPolicy");
const {
  rebuildOwnerKinematicUpdatesForProjectedStamp,
} = require("../movementProjection");
const {
  DESTINY_CONTRACTS,
} = require("../authority/destinyContracts");
const {
  snapshotDestinyAuthorityState,
  updateDestinyAuthorityState,
} = require("../authority/destinySessionState");

function createMovementOwnerDispatch(deps = {}) {
  const {
    buildMissileSessionMutation,
    buildMissileSessionSnapshot,
    cloneVector,
    directionsNearlyMatch,
    isReadyForDestiny,
    logMissileDebug,
    normalizeVector,
    roundNumber,
    sessionMatchesIdentity,
    summarizeMissileUpdatesForLog,
    summarizeVector,
    toFiniteNumber,
    toInt,
    advanceMovement,
    cloneDynamicEntityForDestinyPresentation,
    destiny,
    DEFAULT_RIGHT,
    MICHELLE_HELD_FUTURE_DESTINY_LEAD,
    PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
  } = deps;

  return {
    broadcastPilotCommandMovementUpdates(
      runtime,
      session,
      updates,
      nowMs = runtime.getCurrentSimTimeMs(),
      options = {},
    ) {
      if (!Array.isArray(updates) || updates.length === 0) {
        return false;
      }

      const preparedUpdates =
        options.requireExistingVisibility === true
          ? deps.tagUpdatesRequireExistingVisibility(updates)
          : updates;
      const excludedSession = options.excludedSession || null;
      const ownerShouldReceiveDirectUpdates =
        session &&
        isReadyForDestiny(session) &&
        !sessionMatchesIdentity(session, excludedSession);
      if (ownerShouldReceiveDirectUpdates) {
        const ownerAuthorityState = snapshotDestinyAuthorityState(session);
        const ownerMovementUpdates = runtime.filterMovementUpdatesForSession(
          session,
          preparedUpdates,
        );
        const ownerMovementPayloadNames = ownerMovementUpdates
          .map((update) => (
            update &&
            Array.isArray(update.payload) &&
            typeof update.payload[0] === "string"
              ? update.payload[0]
              : null
          ))
          .filter((name) => Boolean(name));
        const ownerHasSteeringCommand =
          ownerMovementPayloadNames.some(isSteeringPayloadName);
        const currentRawDispatchStamp = runtime.getCurrentDestinyStamp(nowMs);
        const liveOwnerSessionStamp = runtime.getCurrentSessionDestinyStamp(
          session,
          nowMs,
        );
        const quietWindowActive = runtime.isSessionInPilotWarpQuietWindow(
          session,
          nowMs,
        );
        const currentVisibleOwnerStamp = runtime.getCurrentVisibleSessionDestinyStamp(
          session,
          nowMs,
        );
        const presentedOwnerMaximumFutureLead = quietWindowActive
          ? PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS
          : MICHELLE_HELD_FUTURE_DESTINY_LEAD;
        const currentPresentedOwnerStamp =
          runtime.getCurrentPresentedSessionDestinyStamp(
            session,
            nowMs,
            presentedOwnerMaximumFutureLead,
          );
        const quietWindowMinimumStamp = quietWindowActive
          ? Math.max(
              toInt(session._space && session._space.pilotWarpQuietUntilStamp, 0),
              runtime.getHistorySafeSessionDestinyStamp(
                session,
                nowMs,
                PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
                PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
              ),
            ) >>> 0
          : 0;
        const lastFreshAcquireLifecycleStamp = toInt(
          ownerAuthorityState && ownerAuthorityState.lastFreshAcquireLifecycleStamp,
          session._space && session._space.lastFreshAcquireLifecycleStamp,
          0,
        ) >>> 0;
        if (ownerMovementUpdates.length > 0) {
          const lastOwnerNonMissileCriticalStamp = toInt(
            ownerAuthorityState && ownerAuthorityState.lastOwnerNonMissileCriticalStamp,
            session._space && session._space.lastOwnerNonMissileCriticalStamp,
            0,
          ) >>> 0;
          const lastOwnerNonMissileCriticalRawDispatchStamp = toInt(
            ownerAuthorityState && ownerAuthorityState.lastOwnerNonMissileCriticalRawDispatchStamp,
            session._space && session._space.lastOwnerNonMissileCriticalRawDispatchStamp,
            0,
          ) >>> 0;
          const lastOwnerMissileLifecycleStamp = toInt(
            ownerAuthorityState && ownerAuthorityState.lastOwnerMissileLifecycleStamp,
            session._space && session._space.lastOwnerMissileLifecycleStamp,
            0,
          ) >>> 0;
          const lastOwnerMissileLifecycleRawDispatchStamp = toInt(
            ownerAuthorityState && ownerAuthorityState.lastOwnerMissileLifecycleRawDispatchStamp,
            session._space && session._space.lastOwnerMissileLifecycleRawDispatchStamp,
            0,
          ) >>> 0;
          const lastOwnerMissileFreshAcquireStamp = toInt(
            ownerAuthorityState && ownerAuthorityState.lastOwnerMissileFreshAcquireStamp,
            session._space && session._space.lastOwnerMissileFreshAcquireStamp,
            0,
          ) >>> 0;
          const lastOwnerMissileFreshAcquireRawDispatchStamp = toInt(
            ownerAuthorityState && ownerAuthorityState.lastOwnerMissileFreshAcquireRawDispatchStamp,
            session._space && session._space.lastOwnerMissileFreshAcquireRawDispatchStamp,
            0,
          ) >>> 0;
          const previousOwnerPilotCommandStamp = toInt(
            ownerAuthorityState && ownerAuthorityState.lastOwnerCommandStamp,
            session._space && session._space.lastPilotCommandMovementStamp,
            0,
          ) >>> 0;
          const previousOwnerPilotCommandAnchorStamp = toInt(
            ownerAuthorityState && ownerAuthorityState.lastOwnerCommandAnchorStamp,
            session._space && session._space.lastPilotCommandMovementAnchorStamp,
            0,
          ) >>> 0;
          const previousOwnerPilotCommandRawDispatchStamp = toInt(
            ownerAuthorityState && ownerAuthorityState.lastOwnerCommandRawDispatchStamp,
            session._space && session._space.lastPilotCommandMovementRawDispatchStamp,
            0,
          ) >>> 0;
          const ownerRestampState = resolveOwnerMovementRestampState({
            ownerMovementUpdates,
            ownerHasSteeringCommand,
            ownerDirectEchoLeadOverride: options.ownerDirectEchoLeadOverride,
            currentRawDispatchStamp,
            liveOwnerSessionStamp,
            currentVisibleOwnerStamp,
            currentPresentedOwnerStamp,
            previousLastSentDestinyWasOwnerCritical:
              ownerAuthorityState &&
              ownerAuthorityState.lastSentWasOwnerCritical === true,
            quietWindowMinimumStamp,
            lastFreshAcquireLifecycleStamp,
            lastOwnerNonMissileCriticalStamp,
            lastOwnerNonMissileCriticalRawDispatchStamp,
            lastOwnerMissileLifecycleStamp,
            lastOwnerMissileLifecycleRawDispatchStamp,
            lastOwnerMissileFreshAcquireStamp,
            lastOwnerMissileFreshAcquireRawDispatchStamp,
            previousOwnerPilotCommandStamp,
            previousOwnerPilotCommandAnchorStamp,
            previousOwnerPilotCommandRawDispatchStamp,
            previousOwnerPilotCommandDirectionRaw:
              session &&
              session._space &&
              session._space.lastPilotCommandDirection,
            normalizeVector,
            directionsNearlyMatch,
            getPendingHistorySafeStamp: (authoredStamp, minimumLead) => (
              runtime.getPendingHistorySafeSessionDestinyStamp(
                session,
                authoredStamp,
                nowMs,
                minimumLead,
              )
            ),
            defaultRight: DEFAULT_RIGHT,
          });
          const {
            currentOwnerPilotCommandDirection,
            previousOwnerPilotCommandDirection,
            ownerDirectEchoMinimumStamp,
            repeatedOwnerPilotCommandLane,
            reusableHeldOwnerPilotCommandLane,
            nextDistinctOwnerPilotCommandLane,
            suppressSameRawDistinctFutureOwnerEcho,
            earlierTickOwnerPilotCommandMatches,
            recentPresentedFreshAcquireLane,
            recentOwnerNonMissileCriticalLane,
            recentOwnerMissileLifecycleLane,
            recentOwnerFreshAcquireLane,
            recentBufferedOwnerCriticalFloor,
            ownerVisibleStamp,
            ownerMinimumStamp,
            postFreshAcquireOwnerSteeringFloor,
            presentedNonCriticalOwnerEchoFloor,
            ownerStampFloor,
            ownerUpdates,
          } = ownerRestampState;
          logMissileDebug("movement.owner-restamp", {
            rawDispatchStamp: currentRawDispatchStamp,
            rawSimTimeMs: roundNumber(nowMs, 3),
            session: buildMissileSessionSnapshot(runtime, session, nowMs),
            ownerMovementUpdates: summarizeMissileUpdatesForLog(ownerMovementUpdates),
            ownerMovementFloor: {
              liveOwnerSessionStamp,
              currentVisibleOwnerStamp,
              currentPresentedOwnerStamp,
              ownerVisibleStamp,
              quietWindowMinimumStamp,
              lastFreshAcquireLifecycleStamp,
              recentPresentedFreshAcquireLane,
              lastOwnerNonMissileCriticalStamp,
              lastOwnerNonMissileCriticalRawDispatchStamp,
              lastOwnerMissileLifecycleStamp,
              lastOwnerMissileLifecycleRawDispatchStamp,
              lastOwnerMissileFreshAcquireStamp,
              lastOwnerMissileFreshAcquireRawDispatchStamp,
              recentOwnerNonMissileCriticalLane,
              recentOwnerMissileLifecycleLane,
              recentOwnerFreshAcquireLane,
              recentBufferedOwnerCriticalFloor,
              ownerMinimumStamp,
              ownerDirectEchoLeadOverride:
                toInt(options.ownerDirectEchoLeadOverride, 0) || null,
              ownerDirectEchoMinimumStamp,
              presentedNonCriticalOwnerEchoFloor,
              postFreshAcquireOwnerSteeringFloor,
              previousOwnerPilotCommandStamp,
              previousOwnerPilotCommandAnchorStamp,
              previousOwnerPilotCommandRawDispatchStamp,
              previousOwnerPilotCommandDirection:
                summarizeVector(previousOwnerPilotCommandDirection),
              currentOwnerPilotCommandDirection:
                summarizeVector(currentOwnerPilotCommandDirection),
              earlierTickOwnerPilotCommandMatches,
              repeatedOwnerPilotCommandLane,
              reusableHeldOwnerPilotCommandLane,
              nextDistinctOwnerPilotCommandLane,
              suppressSameRawDistinctFutureOwnerEcho,
              ownerStampFloor,
            },
          });
          const sessionBeforeOwnerMovementSend = buildMissileSessionSnapshot(
            runtime,
            session,
            nowMs,
          );
          const ownerEntity =
            typeof runtime.getShipEntityForSession === "function"
              ? runtime.getShipEntityForSession(session)
              : null;
          const ownerUpdatesForSend = suppressSameRawDistinctFutureOwnerEcho
            ? ownerUpdates
            : rebuildOwnerKinematicUpdatesForProjectedStamp({
                updates: ownerUpdates,
                entity: ownerEntity,
                rawNowMs: nowMs,
                scene: {
                  getEntityByID(targetEntityID) {
                    return typeof runtime.getEntityByID === "function"
                      ? runtime.getEntityByID(targetEntityID)
                      : null;
                  },
                },
                advanceMovement,
                cloneDynamicEntityForDestinyPresentation,
                destiny,
              });

          const highestQueuedOwnerMovementStamp = ownerUpdatesForSend.reduce(
            (highestStamp, update) => (
              Math.max(highestStamp, toInt(update && update.stamp, 0) >>> 0)
            ),
            0,
          ) >>> 0;
          const useTickPresentationBatch =
            !suppressSameRawDistinctFutureOwnerEcho &&
            typeof runtime.hasActiveTickDestinyPresentationBatch === "function" &&
            typeof runtime.queueTickDestinyPresentationUpdates === "function" &&
            runtime.hasActiveTickDestinyPresentationBatch();
          let emittedOwnerMovementStamp = 0;
          if (suppressSameRawDistinctFutureOwnerEcho) {
            emittedOwnerMovementStamp = 0;
          } else if (useTickPresentationBatch) {
            runtime.queueTickDestinyPresentationUpdates(
              session,
              ownerUpdatesForSend,
              {
                sendOptions: {
                  destinyAuthorityContract: DESTINY_CONTRACTS.OWNER_PILOT_COMMAND,
                  // Direct owner movement already resolved its held-future lane
                  // in resolveOwnerMovementRestampState. Running the generic
                  // owner-critical monotonic pass again pushes normal steering
                  // and stop packets onto later future lanes and recreates the
                  // pre-launch Michelle rewinds seen in bad.txt.
                  skipOwnerMonotonicRestamp: true,
                  translateStamps: false,
                },
              },
            );
            emittedOwnerMovementStamp = highestQueuedOwnerMovementStamp;
          } else {
            emittedOwnerMovementStamp = runtime.sendDestinyUpdates(
              session,
              ownerUpdatesForSend,
              false,
              {
                destinyAuthorityContract: DESTINY_CONTRACTS.OWNER_PILOT_COMMAND,
                // See tick-batch path above: these owner movement packets are
                // already restamped once and must not be lifted again by the
                // generic owner-critical monotonic pass.
                skipOwnerMonotonicRestamp: true,
                translateStamps: false,
              },
            );
          }
          if (session._space && emittedOwnerMovementStamp > 0) {
            session._space.lastOwnerNonMissileCriticalStamp = Math.max(
              toInt(session._space.lastOwnerNonMissileCriticalStamp, 0) >>> 0,
              emittedOwnerMovementStamp,
            ) >>> 0;
            session._space.lastOwnerNonMissileCriticalRawDispatchStamp =
              currentRawDispatchStamp;
            if (ownerHasSteeringCommand) {
              session._space.lastPilotCommandMovementStamp = Math.max(
                previousOwnerPilotCommandStamp,
                emittedOwnerMovementStamp,
              ) >>> 0;
              session._space.lastPilotCommandMovementRawDispatchStamp =
                currentRawDispatchStamp;
            }
            updateDestinyAuthorityState(session, {
              lastOwnerNonMissileCriticalStamp:
                toInt(session._space.lastOwnerNonMissileCriticalStamp, 0) >>> 0,
              lastOwnerNonMissileCriticalRawDispatchStamp:
                currentRawDispatchStamp,
              ...(ownerHasSteeringCommand
                ? {
                    lastOwnerCommandStamp:
                      toInt(session._space.lastPilotCommandMovementStamp, 0) >>> 0,
                    lastOwnerCommandRawDispatchStamp: currentRawDispatchStamp,
                  }
                : {}),
            });
          }
          const sessionAfterOwnerMovementSend = buildMissileSessionSnapshot(
            runtime,
            session,
            nowMs,
          );
          logMissileDebug("movement.owner-send-complete", {
            rawDispatchStamp: currentRawDispatchStamp,
            rawSimTimeMs: roundNumber(nowMs, 3),
            emittedOwnerMovementStamp,
            suppressSameRawDistinctFutureOwnerEcho,
            usedTickPresentationBatch: useTickPresentationBatch,
            ownerHasSteeringCommand,
            ownerUpdates: summarizeMissileUpdatesForLog(ownerUpdatesForSend),
            sessionBefore: sessionBeforeOwnerMovementSend,
            sessionAfter: sessionAfterOwnerMovementSend,
            sessionMutation: buildMissileSessionMutation(
              sessionBeforeOwnerMovementSend,
              sessionAfterOwnerMovementSend,
            ),
          });
          if (session._space && ownerHasSteeringCommand) {
            // A reused owner lane should only refresh its anchor while that
            // lane is still future. Once the reused lane has become current,
            // refreshing the anchor again renews the adjacent-raw reuse window
            // indefinitely and recreates the repeated stale replays in
            // `client/jolty17.txt`.
            if (
              emittedOwnerMovementStamp > previousOwnerPilotCommandStamp ||
              (
                emittedOwnerMovementStamp === previousOwnerPilotCommandStamp &&
                previousOwnerPilotCommandStamp > liveOwnerSessionStamp
              )
            ) {
              session._space.lastPilotCommandMovementAnchorStamp =
                liveOwnerSessionStamp;
            }
            const latestGotoDirection = currentOwnerPilotCommandDirection;
            if (latestGotoDirection) {
              session._space.lastPilotCommandDirection = cloneVector(
                latestGotoDirection,
              );
            }
            updateDestinyAuthorityState(session, {
              lastOwnerCommandAnchorStamp: toInt(
                session._space.lastPilotCommandMovementAnchorStamp,
                liveOwnerSessionStamp,
              ) >>> 0,
              lastOwnerCommandHeadingHash: latestGotoDirection
                ? JSON.stringify({
                    x: toFiniteNumber(latestGotoDirection.x, 0),
                    y: toFiniteNumber(latestGotoDirection.y, 0),
                    z: toFiniteNumber(latestGotoDirection.z, 0),
                  })
                : (
                    ownerAuthorityState &&
                    ownerAuthorityState.lastOwnerCommandHeadingHash
                  ) || "",
            });
          }
        }

        runtime.broadcastMovementUpdates(
          preparedUpdates,
          session,
          options.sendOptions || {},
        );
        return true;
      }

      runtime.broadcastMovementUpdates(
        preparedUpdates,
        excludedSession,
        options.sendOptions || {},
      );
      return true;
    },
  };
}

module.exports = {
  createMovementOwnerDispatch,
};
