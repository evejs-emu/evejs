const destiny = require("../../destiny");
const {
  isSteeringPayloadName,
} = require("../movementParity");
const {
  projectPreviouslySentDestinyLane,
  resolveOwnerMovementRestampState,
} = require("../movementDeliveryPolicy");
const {
  clampQueuedSubwarpUpdates,
} = require("../movementSync");
const {
  tagUpdatesRequireExistingVisibility,
} = require("./movementDispatchUtils");
const {
  DESTINY_CONTRACTS,
} = require("../authority/destinyContracts");
const {
  snapshotDestinyAuthorityState,
  updateDestinyAuthorityState,
} = require("../authority/destinySessionState");

function createMovementContractDispatch(deps = {}) {
  const {
    cloneVector,
    isReadyForDestiny,
    logMissileDebug,
    normalizeVector,
    roundNumber,
    sessionMatchesIdentity,
    summarizeRuntimeEntityForMissileDebug,
    buildMissileSessionSnapshot,
    directionsNearlyMatch,
    toFiniteNumber,
    toInt,
    DEFAULT_RIGHT,
    MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
    MICHELLE_HELD_FUTURE_DESTINY_LEAD,
    PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
    MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD,
  } = deps;

  return {
    dispatchConfiguredSubwarpMovement(
      runtime,
      entity,
      buildUpdates,
      nowMs = runtime.getCurrentSimTimeMs(),
      options = {},
    ) {
      if (!entity || typeof buildUpdates !== "function") {
        return false;
      }

      const requireExistingVisibility =
        options.requireExistingVisibility === true ||
        options.suppressFreshAcquireReplay === true;
      const prepareUpdates = (stamp) => {
        const updates = buildUpdates(stamp);
        if (!Array.isArray(updates) || updates.length === 0) {
          return [];
        }
        return requireExistingVisibility
          ? tagUpdatesRequireExistingVisibility(updates)
          : updates;
      };

      const ownerSession =
        entity && entity.session && isReadyForDestiny(entity.session)
          ? entity.session
          : null;
      const deferForMissilePressure =
        options.queueHistorySafeContract !== true &&
        ownerSession &&
        runtime.shouldDeferPilotMovementForMissilePressure(ownerSession, nowMs);

      if (deferForMissilePressure) {
        logMissileDebug("movement.defer-for-missile-pressure", {
          rawDispatchStamp: runtime.getCurrentDestinyStamp(nowMs),
          rawSimTimeMs: roundNumber(nowMs, 3),
          entity: summarizeRuntimeEntityForMissileDebug(entity),
          session: buildMissileSessionSnapshot(runtime, ownerSession, nowMs),
        });
      }

      if (options.queueHistorySafeContract === true || deferForMissilePressure) {
        return runtime.queueSubwarpMovementContract(entity, prepareUpdates, {
          nowMs,
          scheduledStamp: options.scheduledStamp,
          excludedSession: options.excludedSession || null,
          suppressedSessions:
            options.suppressedSessions instanceof Set
              ? options.suppressedSessions
              : null,
          suppressOwnerGotoEcho: options.suppressOwnerGotoEcho === true,
        });
      }

      return runtime.broadcastPilotCommandMovementUpdates(
        entity.session || null,
        prepareUpdates(runtime.getMovementStamp(nowMs)),
        nowMs,
        {
          ...options,
          sendOptions: options.sendOptions || {},
        },
      );
    },

    dispatchSubwarpMovementUpdates(runtime, entity, updates, options = {}) {
      if (!entity || !Array.isArray(updates) || updates.length === 0) {
        return false;
      }

      const preparedUpdates =
        options.requireExistingVisibility === true
          ? tagUpdatesRequireExistingVisibility(updates)
          : updates;

      runtime.broadcastMovementUpdates(
        preparedUpdates,
        options.excludedSession || null,
        options.sendOptions || {},
      );
      return true;
    },

    queueSubwarpMovementContract(runtime, entity, buildUpdates, options = {}) {
      if (!entity || typeof buildUpdates !== "function") {
        return false;
      }

      runtime.pendingSubwarpMovementContracts.set(entity.itemID, {
        entityID: entity.itemID,
        buildUpdates,
        includeSpeedFraction: options.includeSpeedFraction === true,
        suppressOwnerGotoEcho: options.suppressOwnerGotoEcho === true,
        scheduledStamp:
          options.scheduledStamp === undefined || options.scheduledStamp === null
            ? runtime.getHistorySafeDestinyStamp(
                options.nowMs === undefined || options.nowMs === null
                  ? runtime.getCurrentSimTimeMs()
                  : options.nowMs,
                MICHELLE_HELD_FUTURE_DESTINY_LEAD,
              )
            : (toInt(options.scheduledStamp, 0) >>> 0),
        excludedSession: options.excludedSession || null,
        suppressedSessions:
          options.suppressedSessions instanceof Set
            ? new Set(options.suppressedSessions)
            : null,
        ownerDirectEchoLeadOverride:
          options.ownerDirectEchoLeadOverride === undefined ||
          options.ownerDirectEchoLeadOverride === null
            ? undefined
            : (toInt(options.ownerDirectEchoLeadOverride, 0) || 0),
      });
      return true;
    },

    clearPendingSubwarpMovementContract(runtime, entityOrID) {
      const entityID =
        typeof entityOrID === "object" && entityOrID !== null
          ? toInt(entityOrID.itemID, 0)
          : toInt(entityOrID, 0);
      if (entityID <= 0) {
        return false;
      }
      return runtime.pendingSubwarpMovementContracts.delete(entityID);
    },

    flushPendingSubwarpMovementContracts(runtime, now = runtime.getCurrentSimTimeMs()) {
      if (runtime.pendingSubwarpMovementContracts.size === 0) {
        return;
      }

      const deferredPendingContracts = new Map();

      const clampQueuedSubwarpUpdatesForSession = (
        session,
        queuedUpdates,
        options = {},
      ) => {
        if (
          !session ||
          !session._space ||
          !Array.isArray(queuedUpdates) ||
          queuedUpdates.length === 0
        ) {
          return queuedUpdates;
        }

        const authorityState = snapshotDestinyAuthorityState(session);
        const presentedFloorStamp = runtime.getCurrentPresentedSessionDestinyStamp(
          session,
          now,
          MICHELLE_HELD_FUTURE_DESTINY_LEAD,
        );
        const currentRawDispatchStamp = runtime.getCurrentDestinyStamp(now);
        const lastSentDestinyStamp = toInt(
          authorityState && authorityState.lastPresentedStamp,
          session._space && session._space.lastSentDestinyStamp,
          0,
        ) >>> 0;
        const lastSentDestinyRawDispatchStamp = toInt(
          authorityState && authorityState.lastRawDispatchStamp,
          session._space && session._space.lastSentDestinyRawDispatchStamp,
          0,
        ) >>> 0;
        const lastSentDestinyWasOwnerCritical =
          authorityState &&
          authorityState.lastSentWasOwnerCritical === true;
        const projectedFloorStamp =
          lastSentDestinyStamp > 0 &&
          lastSentDestinyRawDispatchStamp > 0 &&
          currentRawDispatchStamp > lastSentDestinyRawDispatchStamp &&
          (
            currentRawDispatchStamp - lastSentDestinyRawDispatchStamp
          ) <= 1 &&
          !(
            authorityState &&
            authorityState.lastSentOnlyStaleProjectedOwnerMissileLane === true
          )
            ? projectPreviouslySentDestinyLane(
                lastSentDestinyStamp,
                lastSentDestinyRawDispatchStamp,
                currentRawDispatchStamp,
              )
            : 0;
        // Keep queued observer movement inside Michelle's held-future window.
        // `client/jolty8.txt` showed that clamping queued Orbit/FollowBall to
        // visible+3 forces an immediate SynchroniseToSimulationTime + rebase.
        // The visible stamp equals the session stamp, which is ~1 tick ahead
        // of the client's _current_time. Subtract that offset so the floor
        // lands at client+2 (delta 2, held) instead of client+3 (delta 3,
        // jolt).
        const rawVisibleStamp = runtime.getCurrentVisibleSessionDestinyStamp(
          session,
          now,
        );
        const visibleFloorStamp = (
          (rawVisibleStamp > MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD
            ? rawVisibleStamp - MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD
            : rawVisibleStamp) +
          MICHELLE_HELD_FUTURE_DESTINY_LEAD
        ) >>> 0;
        // If we already emitted an owner-critical future lane on this raw tick,
        // observer-visible queued movement must clear that consumed lane instead
        // of reusing an older held-future stamp. `client/fulldesync2.txt` shows
        // Michelle escalating this into UpdateStateRequest when an NPC
        // GotoDirection lands on 1775041673 after the owner's same-raw future
        // lane already reached 1775041677.
        const sameRawOwnerCriticalClearFloorStamp =
          options.isObserverVisibleContract === true &&
          lastSentDestinyStamp > 0 &&
          lastSentDestinyWasOwnerCritical &&
          lastSentDestinyRawDispatchStamp === currentRawDispatchStamp &&
          lastSentDestinyStamp >= Math.max(
            visibleFloorStamp,
            presentedFloorStamp,
            projectedFloorStamp,
          )
            ? ((lastSentDestinyStamp + 1) >>> 0)
            : 0;
        return clampQueuedSubwarpUpdates({
          queuedUpdates,
          visibleFloorStamp,
          presentedFloorStamp,
          projectedFloorStamp: Math.max(
            projectedFloorStamp,
            sameRawOwnerCriticalClearFloorStamp,
          ) >>> 0,
          restampPayloadState: destiny.restampPayloadState,
        });
      };

      const minimumFutureStamp = runtime.getHistorySafeDestinyStamp(
        now,
        MICHELLE_HELD_FUTURE_DESTINY_LEAD,
      );
      for (const pending of runtime.pendingSubwarpMovementContracts.values()) {
        const stamp = Math.max(
          toInt(pending && pending.scheduledStamp, minimumFutureStamp) >>> 0,
          minimumFutureStamp,
        ) >>> 0;
        const updates = pending.buildUpdates(stamp);
        if (!Array.isArray(updates) || updates.length === 0) {
          continue;
        }
        const entity = runtime.dynamicEntities.get(toInt(pending.entityID, 0));
        let delivered = false;
        const ownerSession =
          entity &&
          entity.session &&
          entity.session !== pending.excludedSession &&
          isReadyForDestiny(entity.session)
            ? entity.session
            : null;
        const suppressedSessions =
          pending && pending.suppressedSessions instanceof Set
            ? pending.suppressedSessions
            : null;
        if (ownerSession && !(suppressedSessions && suppressedSessions.has(ownerSession))) {
          const ownerAuthorityState = snapshotDestinyAuthorityState(ownerSession);
          const liveOwnerSessionStamp = runtime.getCurrentSessionDestinyStamp(
            ownerSession,
            now,
          );
          const currentRawDispatchStamp = runtime.getCurrentDestinyStamp(now);
          let ownerUpdates = runtime.filterMovementUpdatesForSession(
            ownerSession,
            updates,
          );
          if (pending.suppressOwnerGotoEcho === true) {
            ownerUpdates = ownerUpdates.filter((update) => (
              !Array.isArray(update && update.payload) ||
              update.payload[0] !== "GotoDirection"
            ));
          }
          const ownerMovementPayloadNamesBeforeClamp = ownerUpdates
            .map((update) => (
              update &&
              Array.isArray(update.payload) &&
              typeof update.payload[0] === "string"
                ? update.payload[0]
                : null
            ))
            .filter((name) => Boolean(name));
          const ownerHasSteeringCommandBeforeClamp =
            ownerMovementPayloadNamesBeforeClamp.some(isSteeringPayloadName);
          let queuedOwnerRestampState = null;
          if (ownerHasSteeringCommandBeforeClamp) {
            const quietWindowActive =
              typeof runtime.isSessionInPilotWarpQuietWindow === "function" &&
              runtime.isSessionInPilotWarpQuietWindow(ownerSession, now);
            const currentVisibleOwnerStamp =
              runtime.getCurrentVisibleSessionDestinyStamp(
                ownerSession,
                now,
              );
            const currentPresentedOwnerStamp =
              runtime.getCurrentPresentedSessionDestinyStamp(
                ownerSession,
                now,
                quietWindowActive
                  ? PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS
                  : MICHELLE_HELD_FUTURE_DESTINY_LEAD,
              );
            const quietWindowMinimumStamp = quietWindowActive
              ? Math.max(
                  toInt(
                    ownerSession._space &&
                      ownerSession._space.pilotWarpQuietUntilStamp,
                    0,
                  ),
                  typeof runtime.getHistorySafeSessionDestinyStamp === "function"
                    ? runtime.getHistorySafeSessionDestinyStamp(
                        ownerSession,
                        now,
                        PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
                        PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
                      )
                    : 0,
                ) >>> 0
              : 0;
            queuedOwnerRestampState = resolveOwnerMovementRestampState({
              ownerMovementUpdates: ownerUpdates,
              ownerHasSteeringCommand: true,
              ownerDirectEchoLeadOverride: pending.ownerDirectEchoLeadOverride,
              currentRawDispatchStamp,
              liveOwnerSessionStamp,
              currentVisibleOwnerStamp,
              currentPresentedOwnerStamp,
              previousLastSentDestinyWasOwnerCritical:
                ownerAuthorityState &&
                ownerAuthorityState.lastSentWasOwnerCritical === true,
              quietWindowMinimumStamp,
              lastFreshAcquireLifecycleStamp: toInt(
                ownerAuthorityState &&
                  ownerAuthorityState.lastFreshAcquireLifecycleStamp,
                ownerSession._space &&
                  ownerSession._space.lastFreshAcquireLifecycleStamp,
                0,
              ) >>> 0,
              lastOwnerNonMissileCriticalStamp: toInt(
                ownerAuthorityState &&
                  ownerAuthorityState.lastOwnerNonMissileCriticalStamp,
                ownerSession._space &&
                  ownerSession._space.lastOwnerNonMissileCriticalStamp,
                0,
              ) >>> 0,
              lastOwnerNonMissileCriticalRawDispatchStamp: toInt(
                ownerAuthorityState &&
                  ownerAuthorityState.lastOwnerNonMissileCriticalRawDispatchStamp,
                ownerSession._space &&
                  ownerSession._space.lastOwnerNonMissileCriticalRawDispatchStamp,
                0,
              ) >>> 0,
              lastOwnerMissileLifecycleStamp: toInt(
                ownerAuthorityState &&
                  ownerAuthorityState.lastOwnerMissileLifecycleStamp,
                ownerSession._space &&
                  ownerSession._space.lastOwnerMissileLifecycleStamp,
                0,
              ) >>> 0,
              lastOwnerMissileLifecycleRawDispatchStamp: toInt(
                ownerAuthorityState &&
                  ownerAuthorityState.lastOwnerMissileLifecycleRawDispatchStamp,
                ownerSession._space &&
                  ownerSession._space.lastOwnerMissileLifecycleRawDispatchStamp,
                0,
              ) >>> 0,
              lastOwnerMissileFreshAcquireStamp: toInt(
                ownerAuthorityState &&
                  ownerAuthorityState.lastOwnerMissileFreshAcquireStamp,
                ownerSession._space &&
                  ownerSession._space.lastOwnerMissileFreshAcquireStamp,
                0,
              ) >>> 0,
              lastOwnerMissileFreshAcquireRawDispatchStamp: toInt(
                ownerAuthorityState &&
                  ownerAuthorityState.lastOwnerMissileFreshAcquireRawDispatchStamp,
                ownerSession._space &&
                  ownerSession._space.lastOwnerMissileFreshAcquireRawDispatchStamp,
                0,
              ) >>> 0,
              previousOwnerPilotCommandStamp: toInt(
                ownerAuthorityState && ownerAuthorityState.lastOwnerCommandStamp,
                ownerSession._space &&
                  ownerSession._space.lastPilotCommandMovementStamp,
                0,
              ) >>> 0,
              previousOwnerPilotCommandAnchorStamp: toInt(
                ownerAuthorityState &&
                  ownerAuthorityState.lastOwnerCommandAnchorStamp,
                ownerSession._space &&
                  ownerSession._space.lastPilotCommandMovementAnchorStamp,
                0,
              ) >>> 0,
              previousOwnerPilotCommandRawDispatchStamp: toInt(
                ownerAuthorityState &&
                  ownerAuthorityState.lastOwnerCommandRawDispatchStamp,
                ownerSession._space &&
                  ownerSession._space.lastPilotCommandMovementRawDispatchStamp,
                0,
              ) >>> 0,
              previousOwnerPilotCommandDirectionRaw:
                ownerSession &&
                ownerSession._space &&
                ownerSession._space.lastPilotCommandDirection,
              normalizeVector,
              directionsNearlyMatch,
              getPendingHistorySafeStamp: (authoredStamp, minimumLead = 0) => (
                typeof runtime.getPendingHistorySafeSessionDestinyStamp === "function"
                  ? runtime.getPendingHistorySafeSessionDestinyStamp(
                      ownerSession,
                      authoredStamp,
                      now,
                      minimumLead,
                    )
                  : Math.max(
                      toInt(authoredStamp, 0) >>> 0,
                      (
                        liveOwnerSessionStamp +
                        toInt(minimumLead, 0)
                      ) >>> 0,
                    ) >>> 0
              ),
              defaultRight:
                DEFAULT_RIGHT && typeof DEFAULT_RIGHT === "object"
                  ? DEFAULT_RIGHT
                  : { x: 1, y: 0, z: 0 },
            });
            if (
              queuedOwnerRestampState &&
              Array.isArray(queuedOwnerRestampState.ownerUpdates)
            ) {
              ownerUpdates = queuedOwnerRestampState.ownerUpdates;
            }
          }
          ownerUpdates = clampQueuedSubwarpUpdatesForSession(
            ownerSession,
            ownerUpdates,
            {
              isObserverVisibleContract: false,
            },
          );
          if (ownerUpdates.length > 0) {
            const ownerMovementPayloadNames = ownerUpdates
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
            const highestQueuedOwnerMovementStamp = ownerUpdates.reduce(
              (highestStamp, update) => Math.max(
                highestStamp,
                toInt(update && update.stamp, 0) >>> 0,
              ) >>> 0,
              0,
            );
            const latestGotoDirection = ownerUpdates.reduce(
              (latestDirection, update) => {
                const payload = update && Array.isArray(update.payload)
                  ? update.payload
                  : null;
                if (!payload || payload[0] !== "GotoDirection") {
                  return latestDirection;
                }
                const args = Array.isArray(payload[1]) ? payload[1] : null;
                if (!args || args.length < 4) {
                  return latestDirection;
                }
                return normalizeVector(
                  {
                    x: toFiniteNumber(
                      args[1] && typeof args[1] === "object" ? args[1].value : args[1],
                      0,
                    ),
                    y: toFiniteNumber(
                      args[2] && typeof args[2] === "object" ? args[2].value : args[2],
                      0,
                    ),
                    z: toFiniteNumber(
                      args[3] && typeof args[3] === "object" ? args[3].value : args[3],
                      0,
                    ),
                  },
                  latestDirection ||
                    (
                      DEFAULT_RIGHT && typeof DEFAULT_RIGHT === "object"
                        ? DEFAULT_RIGHT
                        : { x: 1, y: 0, z: 0 }
                    ),
                );
              },
              queuedOwnerRestampState &&
                queuedOwnerRestampState.currentOwnerPilotCommandDirection
                ? queuedOwnerRestampState.currentOwnerPilotCommandDirection
                : null,
            );
            let recordedOwnerMovementStamp = 0;
            if (runtime.hasActiveTickDestinyPresentationBatch()) {
              runtime.queueTickDestinyPresentationUpdates(ownerSession, ownerUpdates, {
                sendOptions: {
                  destinyAuthorityContract: DESTINY_CONTRACTS.OWNER_PILOT_COMMAND,
                  // Queued owner steering was already clamped onto its safe
                  // presented lane before entering the generic destiny sender.
                  // Re-running owner monotonic restamp here can push or clamp
                  // that same steer onto a different lane, which recreates the
                  // Michelle backstep seen in jolty4.
                  skipOwnerMonotonicRestamp: true,
                  translateStamps: false,
                },
              });
              recordedOwnerMovementStamp = highestQueuedOwnerMovementStamp;
            } else {
              recordedOwnerMovementStamp = runtime.sendDestinyUpdates(
                ownerSession,
                ownerUpdates,
                false,
                {
                  destinyAuthorityContract: DESTINY_CONTRACTS.OWNER_PILOT_COMMAND,
                  // Match the direct owner movement path above: queued owner
                  // steering is already restamped once and must not be
                  // reprocessed by the generic owner-critical monotonic pass.
                  skipOwnerMonotonicRestamp: true,
                  translateStamps: false,
                },
              );
            }
            if (
              ownerSession._space &&
              recordedOwnerMovementStamp > 0
            ) {
              ownerSession._space.lastOwnerNonMissileCriticalStamp = Math.max(
                toInt(ownerSession._space.lastOwnerNonMissileCriticalStamp, 0) >>> 0,
                recordedOwnerMovementStamp,
              ) >>> 0;
              ownerSession._space.lastOwnerNonMissileCriticalRawDispatchStamp =
                runtime.getCurrentDestinyStamp(now);
              if (ownerHasSteeringCommand) {
                const previousOwnerPilotCommandMovementStamp = toInt(
                  ownerSession._space.lastPilotCommandMovementStamp,
                  0,
                ) >>> 0;
                ownerSession._space.lastPilotCommandMovementStamp = Math.max(
                  previousOwnerPilotCommandMovementStamp,
                  recordedOwnerMovementStamp,
                ) >>> 0;
                ownerSession._space.lastPilotCommandMovementRawDispatchStamp =
                  runtime.getCurrentDestinyStamp(now);
                if (
                  recordedOwnerMovementStamp >
                  previousOwnerPilotCommandMovementStamp ||
                  (
                    recordedOwnerMovementStamp ===
                      previousOwnerPilotCommandMovementStamp &&
                    previousOwnerPilotCommandMovementStamp >
                      liveOwnerSessionStamp
                  )
                ) {
                  ownerSession._space.lastPilotCommandMovementAnchorStamp =
                    liveOwnerSessionStamp;
                }
                if (latestGotoDirection) {
                  ownerSession._space.lastPilotCommandDirection = cloneVector(
                    latestGotoDirection,
                  );
                }
              }
              updateDestinyAuthorityState(ownerSession, {
                lastOwnerNonMissileCriticalStamp:
                  toInt(ownerSession._space.lastOwnerNonMissileCriticalStamp, 0) >>> 0,
                lastOwnerNonMissileCriticalRawDispatchStamp:
                  runtime.getCurrentDestinyStamp(now),
                ...(ownerHasSteeringCommand
                  ? {
                      lastOwnerCommandStamp:
                        toInt(ownerSession._space.lastPilotCommandMovementStamp, 0) >>> 0,
                      lastOwnerCommandAnchorStamp:
                        toInt(
                          ownerSession._space.lastPilotCommandMovementAnchorStamp,
                          liveOwnerSessionStamp,
                        ) >>> 0,
                      lastOwnerCommandRawDispatchStamp:
                        runtime.getCurrentDestinyStamp(now),
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
                    }
                  : {}),
              });
            }
            delivered = true;
          }
        }
        for (const session of runtime.sessions.values()) {
          if (
            sessionMatchesIdentity(session, ownerSession || pending.excludedSession) ||
            (
              suppressedSessions instanceof Set &&
              suppressedSessions.has(session)
            ) ||
            !isReadyForDestiny(session)
          ) {
            continue;
          }
          const filteredUpdates = runtime.filterMovementUpdatesForSession(
            session,
            updates,
          );
          if (filteredUpdates.length === 0) {
            continue;
          }
          const queuedUpdates = clampQueuedSubwarpUpdatesForSession(
            session,
            filteredUpdates,
            {
              isObserverVisibleContract:
                toInt(session._space && session._space.shipID, 0) !==
                toInt(pending && pending.entityID, 0),
            },
          );
          if (runtime.hasActiveTickDestinyPresentationBatch()) {
            runtime.queueTickDestinyPresentationUpdates(session, queuedUpdates, {
              sendOptions: {
                destinyAuthorityContract:
                  DESTINY_CONTRACTS.CRITICAL_MOVEMENT_OR_SHIPPRIME,
                translateStamps: false,
              },
            });
          } else {
            runtime.sendDestinyUpdates(
              session,
              queuedUpdates,
              false,
              {
                destinyAuthorityContract:
                  DESTINY_CONTRACTS.CRITICAL_MOVEMENT_OR_SHIPPRIME,
                translateStamps: false,
              },
            );
          }
          delivered = true;
        }
        if (!delivered && entity) {
          // Fresh-acquire protected movement can be filtered for a few scene
          // beats even though the server already committed the new mode. Keep
          // the queued contract alive until at least one observer can legally
          // receive it instead of dropping the first pursuit order forever.
          deferredPendingContracts.set(entity.itemID, pending);
        }
      }

      runtime.pendingSubwarpMovementContracts.clear();
      for (const [entityID, pending] of deferredPendingContracts.entries()) {
        runtime.pendingSubwarpMovementContracts.set(entityID, pending);
      }
    },
  };
}

module.exports = {
  createMovementContractDispatch,
};
