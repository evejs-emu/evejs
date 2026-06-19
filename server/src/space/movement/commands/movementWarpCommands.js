const path = require("path");

const log = require(path.join(__dirname, "../../../utils/logger"));
const {
  DESTINY_CONTRACTS,
} = require("../authority/destinyContracts");

function createMovementWarpCommands(deps = {}) {
  const {
    activatePendingWarp,
    armMovementTrace,
    buildDirectedMovementUpdates,
    buildOfficialWarpReferenceProfile,
    buildPendingWarpRequest,
    buildPreparingWarpState,
    buildSessionlessWarpIngressState,
    buildWarpPrepareDispatch,
    buildWarpStartUpdates,
    clearTrackingState,
    cloneVector,
    getClientParityWarpInPoint,
    getStargateWarpLandingPoint,
    getStationWarpTargetPosition,
    getTargetMotionPosition,
    getWatcherWarpStartStamp,
    getWarpStopDistanceForTarget,
    isReadyForDestiny,
    logMovementDebug,
    logWarpDebug,
    normalizeVector,
    prewarmStartupControllersForWarpDestination,
    primePilotWarpActivationState,
    persistShipEntity,
    resolveStargateWarpTarget,
    subtractVectors,
    summarizePendingWarp,
    tagUpdatesRequireExistingVisibility,
    toFiniteNumber,
    toInt,
    DESTINY_STAMP_INTERVAL_MS,
    PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
    MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD,
  } = deps;

  return {
    warpToEntity(runtime, session, targetEntityID, options = {}) {
      const entity = runtime.getShipEntityForSession(session);
      const target = runtime.getEntityByID(targetEntityID);
      if (!entity || !target) {
        return {
          success: false,
          errorMsg: "TARGET_NOT_FOUND",
        };
      }

      if (target.kind === "stargate") {
        const stargateWarpTarget =
          typeof resolveStargateWarpTarget === "function"
            ? resolveStargateWarpTarget(
                entity,
                target,
                toFiniteNumber(options.minimumRange, 0),
              )
            : {
                rawDestination: getStargateWarpLandingPoint(
                  entity,
                  target,
                  toFiniteNumber(options.minimumRange, 0),
                ),
                stopDistance: 0,
              };
        return runtime.warpToPoint(
          session,
          stargateWarpTarget.rawDestination,
          {
            ...options,
            stopDistance: Math.max(
              0,
              toFiniteNumber(stargateWarpTarget.stopDistance, 0),
            ),
            targetEntityID: target.itemID,
          },
        );
      }

      const clientParityWarpInPoint =
        typeof getClientParityWarpInPoint === "function"
          ? getClientParityWarpInPoint(target)
          : null;
      if (clientParityWarpInPoint) {
        return runtime.warpToPoint(session, clientParityWarpInPoint, {
          ...options,
          stopDistance: Math.max(0, toFiniteNumber(options.minimumRange, 0)),
          targetEntityID: target.itemID,
        });
      }

      const stopDistance = getWarpStopDistanceForTarget(
        entity,
        target,
        toFiniteNumber(options.minimumRange, 0),
      );
      const warpTargetPoint =
        target && (target.kind === "station" || target.kind === "structure")
          ? getStationWarpTargetPosition(target, {
              shipTypeID: entity.typeID,
              selectionKey: entity.itemID,
            })
          : getTargetMotionPosition(target);
      return runtime.warpToPoint(session, warpTargetPoint, {
        ...options,
        stopDistance,
        targetEntityID: target.itemID,
      });
    },

    warpToPoint(runtime, session, point, options = {}) {
      const entity = runtime.getShipEntityForSession(session);
      if (!entity || entity.pendingDock) {
        return {
          success: false,
          errorMsg: "SHIP_NOT_FOUND",
        };
      }

      if (options.ignoreCrimewatchCheck !== true) {
        try {
          const crimewatchState = require(path.join(
            __dirname,
            "../../../services/security/crimewatchState",
          ));
          const crimewatchNow =
            session &&
            session._space &&
            Number.isFinite(Number(session._space.simTimeMs))
              ? Number(session._space.simTimeMs)
              : runtime.getCurrentSimTimeMs();
          if (
            crimewatchState &&
            crimewatchState.isCriminallyFlagged(
              session && session.characterID,
              crimewatchNow,
            )
          ) {
            return {
              success: false,
              errorMsg: "CRIMINAL_TIMER_ACTIVE",
            };
          }
        } catch (error) {
          log.warn(`[SpaceRuntime] Crimewatch warp check failed: ${error.message}`);
        }
      }

      const pendingWarp = buildPendingWarpRequest(entity, point, {
        ...options,
        nowMs: runtime.getCurrentSimTimeMs(),
        warpSpeedAU: options.warpSpeedAU || entity.warpSpeedAU,
      });
      if (!pendingWarp) {
        return {
          success: false,
          errorMsg: "WARP_DISTANCE_TOO_CLOSE",
        };
      }

      const now = runtime.getCurrentSimTimeMs();
      const movementStamp = runtime.getMovementStamp(now);
      const previousSpeedFraction = entity.speedFraction;
      const pilotPrepareStamp =
        session && isReadyForDestiny(session)
          ? runtime.getHistorySafeDestinyStamp(
              now,
              PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
              PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
            )
          : movementStamp;
      pendingWarp.prepareStamp = pilotPrepareStamp;
      pendingWarp.prepareVisibleStamp =
        session && isReadyForDestiny(session)
          ? runtime.getHistorySafeSessionDestinyStamp(
              session,
              now,
              PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
              PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
            )
          : pilotPrepareStamp;
      clearTrackingState(entity);
      entity.pendingWarp = pendingWarp;
      entity.mode = "WARP";
      entity.speedFraction = 1;
      entity.direction = normalizeVector(
        subtractVectors(pendingWarp.targetPoint, entity.position),
        entity.direction,
      );
      entity.targetPoint = cloneVector(pendingWarp.targetPoint);
      entity.targetEntityID = pendingWarp.targetEntityID || null;
      entity.warpState = buildPreparingWarpState(entity, pendingWarp, {
        nowMs: now,
      });
      persistShipEntity(entity);
      armMovementTrace(entity, "warp", {
        pendingWarp: summarizePendingWarp(pendingWarp),
      }, now);
      logMovementDebug("warp.requested", entity);
      logWarpDebug("warp.requested", entity, {
        officialProfile: buildOfficialWarpReferenceProfile(
          pendingWarp.totalDistance,
          pendingWarp.warpSpeedAU,
          entity.maxVelocity,
        ),
      });
      if (session) {
        runtime.clearPendingSubwarpMovementContract(entity);
        const prewarmTargetEntity =
          pendingWarp.targetEntityID
            ? runtime.getEntityByID(pendingWarp.targetEntityID)
            : null;
        const prewarmResult = prewarmStartupControllersForWarpDestination(runtime, {
          excludedSession: session,
          nowMs: now,
          relevantEntities: prewarmTargetEntity ? [prewarmTargetEntity] : [],
          relevantPositions: [
            pendingWarp.targetPoint,
            pendingWarp.rawDestination,
          ].filter(Boolean),
        });
        if (!prewarmResult.success) {
          log.warn(
            `[SpaceRuntime] Warp destination prewarm failed for system=${runtime.systemID} ship=${entity.itemID}: ${prewarmResult.errorMsg || "UNKNOWN_ERROR"}`,
          );
        }
      }

      const prepareDispatch = buildWarpPrepareDispatch(
        entity,
        pilotPrepareStamp,
        entity.warpState,
      );
      if (session) {
        if (isReadyForDestiny(session)) {
          // Keep the pilot prepare bundle authored on the raw warp-prepare
          // stamp and let the normal destiny delivery path place it safely for
          // the session. Forcing it directly onto the visible stamp causes
          // Michelle to flush/rebase the local warp-start handoff early, which
          // shortens the client-rendered accel into the tunnel.
          runtime.sendDestinyUpdates(session, prepareDispatch.pilotUpdates, false, {
            destinyAuthorityContract:
              DESTINY_CONTRACTS.CRITICAL_MOVEMENT_OR_SHIPPRIME,
            minimumLeadFromCurrentHistory: PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
            maximumLeadFromCurrentHistory: PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
          });
        }
        const observerAlignStamp = Math.max(
          movementStamp,
          pilotPrepareStamp,
        );
        const alignUpdates = tagUpdatesRequireExistingVisibility(
          buildDirectedMovementUpdates(
            entity,
            entity.direction,
            Math.abs(entity.speedFraction - previousSpeedFraction) > 0.000001,
            observerAlignStamp,
          ),
        );
        if (alignUpdates.length > 0) {
          runtime.broadcastMovementUpdates(alignUpdates, session, {
            minimumLeadFromCurrentHistory: MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD,
            minimumSessionStamp: pendingWarp.prepareVisibleStamp,
          });
          runtime.scheduleWatcherMovementAnchor(entity, now, "warpAlign");
        }
      } else {
        runtime.broadcastMovementUpdates(prepareDispatch.sharedUpdates);
      }
      return {
        success: true,
        data: pendingWarp,
      };
    },

    warpDynamicEntityToPoint(runtime, entityOrID, point, options = {}) {
      const entity =
        typeof entityOrID === "object" && entityOrID !== null
          ? entityOrID
          : runtime.getEntityByID(entityOrID);
      if (!entity || entity.kind !== "ship" || entity.pendingDock) {
        return {
          success: false,
          errorMsg: "SHIP_NOT_FOUND",
        };
      }

      const now = runtime.getCurrentSimTimeMs();
      const pendingWarp = buildPendingWarpRequest(entity, point, {
        ...options,
        nowMs: now,
        warpSpeedAU: options.warpSpeedAU || entity.warpSpeedAU,
      });
      if (!pendingWarp) {
        return {
          success: false,
          errorMsg: "WARP_DISTANCE_TOO_CLOSE",
        };
      }

      const desiredDirection = normalizeVector(
        subtractVectors(pendingWarp.targetPoint, entity.position),
        entity.direction,
      );
      clearTrackingState(entity);
      entity.pendingWarp = pendingWarp;
      entity.mode = "WARP";
      entity.speedFraction = 1;
      entity.direction = desiredDirection;
      entity.targetPoint = cloneVector(pendingWarp.targetPoint);
      entity.targetEntityID = pendingWarp.targetEntityID || null;
      if (options.forceImmediateStart === true) {
        entity.velocity = {
          x: desiredDirection.x * entity.maxVelocity,
          y: desiredDirection.y * entity.maxVelocity,
          z: desiredDirection.z * entity.maxVelocity,
        };
        pendingWarp.requestedAtMs = now - Math.max(
          1_000,
          (toFiniteNumber(entity.alignTime, 0) * 1000) + 500,
        );
      }
      entity.warpState = buildPreparingWarpState(entity, pendingWarp, {
        nowMs: now,
      });
      persistShipEntity(entity);
      armMovementTrace(entity, "warp", {
        pendingWarp: summarizePendingWarp(pendingWarp),
        forceImmediateStart: options.forceImmediateStart === true,
      }, now);
      logMovementDebug("warp.requested.sessionless", entity, {
        forceImmediateStart: options.forceImmediateStart === true,
      });
      logWarpDebug("warp.requested.sessionless", entity, {
        forceImmediateStart: options.forceImmediateStart === true,
        officialProfile: buildOfficialWarpReferenceProfile(
          pendingWarp.totalDistance,
          pendingWarp.warpSpeedAU,
          entity.maxVelocity,
        ),
      });

      const movementStamp = runtime.getMovementStamp(now);
      runtime.clearPendingSubwarpMovementContract(entity);
      pendingWarp.prepareStamp = movementStamp;
      const prepareDispatch = buildWarpPrepareDispatch(
        entity,
        movementStamp,
        entity.warpState,
      );
      runtime.broadcastMovementUpdates(prepareDispatch.sharedUpdates);
      return {
        success: true,
        data: pendingWarp,
      };
    },

    forceStartPendingWarp(runtime, entityOrID, options = {}) {
      const entity =
        typeof entityOrID === "object" && entityOrID !== null
          ? entityOrID
          : runtime.getEntityByID(entityOrID);
      if (!entity || entity.kind !== "ship") {
        return {
          success: false,
          errorMsg: "SHIP_NOT_FOUND",
        };
      }
      if (!entity.pendingWarp) {
        return {
          success: false,
          errorMsg: "WARP_NOT_PENDING",
        };
      }

      const now = toFiniteNumber(options.nowMs, runtime.getCurrentSimTimeMs());
      const pendingWarp = entity.pendingWarp;
      const currentStamp = runtime.getCurrentDestinyStamp(now);
      const warpState = activatePendingWarp(entity, pendingWarp, {
        nowMs: now,
        defaultEffectStamp: currentStamp,
      });
      if (!warpState) {
        return {
          success: false,
          errorMsg: "WARP_ACTIVATION_FAILED",
        };
      }
      const warpStartStamp =
        entity.session && isReadyForDestiny(entity.session)
          ? Math.max(
              currentStamp,
              toInt(pendingWarp && pendingWarp.prepareStamp, currentStamp),
            )
          : currentStamp;
      primePilotWarpActivationState(entity, warpState, warpStartStamp);

      if (options.clearVisibilitySuppression !== false) {
        entity.visibilitySuppressedUntilMs = 0;
        entity.suppressWarpAcquireUntilNextTick = false;
      }
      runtime.beginWarpDepartureOwnership(entity, now);
      runtime.beginPilotWarpVisibilityHandoff(entity, warpState, now);
      if (entity.session && isReadyForDestiny(entity.session)) {
        const watcherWarpStartStamp = getWatcherWarpStartStamp(
          warpState,
          pendingWarp,
          warpStartStamp,
        );
        const warpStartUpdates = buildWarpStartUpdates(
          entity,
          warpState,
          watcherWarpStartStamp,
          {
            includeEntityWarpIn: false,
          },
        );
        if (warpStartUpdates.length > 0) {
          runtime.broadcastMovementUpdates(
            warpStartUpdates,
            entity.session,
            {
              minimumSessionStamp: toInt(
                pendingWarp && pendingWarp.prepareVisibleStamp,
                0,
              ),
            },
          );
        }
      }
      persistShipEntity(entity);

      return {
        success: true,
        data: {
          entity,
          warpState,
        },
      };
    },

    sendSessionlessWarpStartToVisibleSessions(runtime, entity, updates) {
      if (
        !entity ||
        !Array.isArray(updates) ||
        updates.length === 0
      ) {
        return {
          deliveredCount: 0,
        };
      }

      let deliveredCount = 0;
      for (const session of runtime.sessions.values()) {
        if (!isReadyForDestiny(session) || !session._space) {
          continue;
        }
        if (
          !(session._space.visibleDynamicEntityIDs instanceof Set) ||
          !session._space.visibleDynamicEntityIDs.has(entity.itemID)
        ) {
          continue;
        }
        runtime.sendDestinyUpdates(session, updates, false, {
          destinyAuthorityContract:
            DESTINY_CONTRACTS.CRITICAL_MOVEMENT_OR_SHIPPRIME,
        });
        deliveredCount += 1;
      }

      return {
        deliveredCount,
      };
    },

    startSessionlessWarpIngress(runtime, entityOrID, point, options = {}) {
      const entity =
        typeof entityOrID === "object" && entityOrID !== null
          ? entityOrID
          : runtime.getEntityByID(entityOrID);
      if (!entity || entity.kind !== "ship") {
        return {
          success: false,
          errorMsg: "SHIP_NOT_FOUND",
        };
      }

      const now = toFiniteNumber(options.nowMs, runtime.getCurrentSimTimeMs());
      const warpResult = runtime.warpDynamicEntityToPoint(entity, point, options);
      if (!warpResult.success) {
        return warpResult;
      }
      if (entity.session) {
        return warpResult;
      }

      const activationResult = runtime.forceStartPendingWarp(entity, {
        nowMs: now,
        clearVisibilitySuppression: false,
      });
      if (!activationResult.success) {
        return activationResult;
      }
      const visibilitySuppressMs = Math.max(
        1,
        toFiniteNumber(options.visibilitySuppressMs, DESTINY_STAMP_INTERVAL_MS),
      );
      entity.suppressWarpAcquireUntilNextTick = true;
      entity.visibilitySuppressedUntilMs = Math.max(
        toFiniteNumber(entity.visibilitySuppressedUntilMs, 0),
        now + visibilitySuppressMs,
      );
      entity.sessionlessWarpIngress = buildSessionlessWarpIngressState(
        entity,
        activationResult.data && activationResult.data.warpState,
        {
          nowMs: now,
          durationMs: options.ingressDurationMs,
        },
      );

      if (options.broadcastWarpStartToVisibleSessions === true) {
        const warpStartStamp = runtime.getNextDestinyStamp(now);
        const warpStartUpdates = buildWarpStartUpdates(
          entity,
          activationResult.data && activationResult.data.warpState,
          warpStartStamp,
          {
            includeEntityWarpIn: false,
          },
        );
        runtime.sendSessionlessWarpStartToVisibleSessions(
          entity,
          warpStartUpdates,
        );
      }

      let acquireResult = null;
      if (options.acquireForRelevantSessions === true) {
        acquireResult = runtime.acquireDynamicEntitiesForRelevantSessions([entity], {
          nowMs: now,
          visibilityFn: (session, candidate, visibilityNow) =>
            runtime.canSessionSeeWarpingDynamicEntity(
              session,
              candidate,
              visibilityNow,
              {
                allowFreshWarpAcquire: true,
                ignoreVisibilitySuppression: true,
              },
            ),
        });
      } else {
        entity.deferUntilInitialVisibilitySync = false;
      }

      return {
        success: true,
        data: {
          entity,
          pendingWarp: warpResult.data,
          warpState: activationResult.data && activationResult.data.warpState,
          ingressCompleteAtMs:
            entity.sessionlessWarpIngress &&
            Number.isFinite(Number(entity.sessionlessWarpIngress.completeAtMs))
              ? Number(entity.sessionlessWarpIngress.completeAtMs)
              : now,
          acquireResult,
        },
      };
    },
  };
}

module.exports = {
  createMovementWarpCommands,
};
