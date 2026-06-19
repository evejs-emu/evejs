const destiny = require("../../destiny");
const {
  resolveGotoCommandSyncState,
} = require("../movementDeliveryPolicy");
const {
  snapshotDestinyAuthorityState,
  updateDestinyAuthorityState,
} = require("../authority/destinySessionState");

function createMovementSubwarpCommands(deps = {}) {
  const {
    addVectors,
    armMovementTrace,
    buildDirectedMovementUpdates,
    buildPointMovementUpdates,
    buildPerpendicular,
    clearTrackingState,
    cloneVector,
    crossProduct,
    directionsNearlyMatch,
    getShipDockingDistanceToStation,
    getTargetMotionPosition,
    logMovementDebug,
    normalizeVector,
    persistShipEntity,
    roundNumber,
    scaleVector,
    subtractVectors,
    summarizeVector,
    toFiniteNumber,
    toInt,
    DEFAULT_UP,
    OWNER_PENDING_GOTO_DUPLICATE_ALIGNMENT,
  } = deps;

  return {
    gotoDirection(runtime, session, direction, options = {}) {
      const entity = runtime.getShipEntityForSession(session);
      if (!entity || entity.mode === "WARP" || entity.pendingDock) {
        return false;
      }

      const now = runtime.getCurrentSimTimeMs();
      const authorityState = snapshotDestinyAuthorityState(session);
      const commandDirection = normalizeVector(direction, entity.direction);
      const currentRawDispatchStamp = runtime.getCurrentDestinyStamp(now);
      const liveOwnerSessionStamp = runtime.getCurrentSessionDestinyStamp(
        session,
        now,
      );
      const pendingOwnerMovementStamp = toInt(
        authorityState && authorityState.lastOwnerCommandStamp,
        session && session._space && session._space.lastPilotCommandMovementStamp,
        0,
      ) >>> 0;
      const pendingOwnerMovementAnchorStamp = toInt(
        authorityState && authorityState.lastOwnerCommandAnchorStamp,
        session &&
          session._space &&
          session._space.lastPilotCommandMovementAnchorStamp,
        0,
      ) >>> 0;
      const pendingOwnerMovementRawDispatchStamp = toInt(
        authorityState && authorityState.lastOwnerCommandRawDispatchStamp,
        session &&
          session._space &&
          session._space.lastPilotCommandMovementRawDispatchStamp,
        0,
      ) >>> 0;
      const recentOwnerMovementRawDispatchDelta =
        pendingOwnerMovementRawDispatchStamp > 0 &&
        currentRawDispatchStamp >= pendingOwnerMovementRawDispatchStamp
          ? (
            currentRawDispatchStamp -
              pendingOwnerMovementRawDispatchStamp
          ) >>> 0
          : 0;
      const recentOwnerMovementStillRelevant =
        session &&
        session._space &&
        session._space.lastPilotCommandDirection &&
        // `client/jolts2.txt` still shows duplicate plain CmdGotoDirection
        // echoes surviving one skipped raw dispatch. Keep the recent owner
        // command relevant for one extra raw tick so those duplicates are
        // suppressed instead of being replayed as fresh movement jolts.
        recentOwnerMovementRawDispatchDelta <= 2 &&
        (
          pendingOwnerMovementStamp >= liveOwnerSessionStamp ||
          (
            liveOwnerSessionStamp > 0 &&
            pendingOwnerMovementStamp > 0 &&
            pendingOwnerMovementStamp >= ((liveOwnerSessionStamp - 1) >>> 0)
          )
        );
      const pendingOwnerCommandDirection =
        pendingOwnerMovementStamp > liveOwnerSessionStamp &&
        pendingOwnerMovementAnchorStamp === liveOwnerSessionStamp &&
        session &&
        session._space &&
        session._space.lastPilotCommandDirection
          ? normalizeVector(
              session._space.lastPilotCommandDirection,
              commandDirection,
            )
          : null;
      const recentOwnerCommandDirection =
        recentOwnerMovementStillRelevant
          ? normalizeVector(
              session._space.lastPilotCommandDirection,
              commandDirection,
            )
          : pendingOwnerCommandDirection;
      const currentGotoDirection =
        entity.mode === "GOTO" &&
        entity.targetEntityID === null &&
        entity.targetPoint
          ? normalizeVector(
              subtractVectors(entity.targetPoint, entity.position),
              entity.direction,
            )
          : null;
      const speedFractionChanged =
        entity.speedFraction <= 0 || entity.mode === "STOP";
      const ownerLocallyPredictsHeading =
        options.ownerLocallyPredictsHeading === true ||
        options.commandSource === "CmdSteerDirection";
      // Plain CmdGotoDirection is not locally predicted by the client ship
      // ball, so it still needs the held-future +2 owner echo contract.
      // The real regression was not the +2 base lead itself; it was the later
      // presented-lane rescue re-adding the full lead on top of an already
      // consumed owner lane. Keep the +2 request here and let delivery policy
      // clear only the next owner-visible lane when presentation has already
      // advanced.
      const ownerDirectEchoLeadOverride =
        ownerLocallyPredictsHeading
          ? undefined
          : 2;
      const gotoCommandSyncState = resolveGotoCommandSyncState({
        ownerLocallyPredictsHeading,
        speedFractionChanged,
        currentGotoDirectionMatches:
          Boolean(currentGotoDirection) &&
          directionsNearlyMatch(currentGotoDirection, commandDirection),
        pendingOwnerCommandDirectionMatches:
          Boolean(recentOwnerCommandDirection) &&
          directionsNearlyMatch(
            recentOwnerCommandDirection,
            commandDirection,
            OWNER_PENDING_GOTO_DUPLICATE_ALIGNMENT,
          ),
        pendingOwnerMovementStamp,
        liveOwnerSessionStamp,
        pendingOwnerMovementRawDispatchStamp,
        currentRawDispatchStamp,
      });
      if (gotoCommandSyncState.isCurrentGotoDuplicate) {
        logMovementDebug("cmd.goto.duplicate", entity, {
          commandDirection: summarizeVector(commandDirection),
        });
        return true;
      }
      const suppressOwnerGotoEchoRecentDuplicate =
        gotoCommandSyncState.suppressOwnerGotoEchoRecentDuplicate;
      const suppressOwnerGotoEchoSameRawPendingFutureSteer =
        gotoCommandSyncState.suppressOwnerGotoEchoSameRawPendingFutureSteer;
      const suppressOwnerGotoEcho =
        suppressOwnerGotoEchoRecentDuplicate ||
        suppressOwnerGotoEchoSameRawPendingFutureSteer;
      const coalescePendingGotoRecentDuplicate =
        gotoCommandSyncState.isPendingGotoDuplicate &&
        suppressOwnerGotoEchoRecentDuplicate;
      if (
        gotoCommandSyncState.isPendingGotoDuplicate &&
        !coalescePendingGotoRecentDuplicate &&
        !suppressOwnerGotoEchoSameRawPendingFutureSteer
      ) {
        logMovementDebug("cmd.goto.pendingDuplicate", entity, {
          commandDirection: summarizeVector(commandDirection),
          pendingOwnerMovementStamp,
          recentOwnerMovementRawDispatchDelta,
        });
        return true;
      }
      clearTrackingState(entity);
      entity.targetPoint = addVectors(
        cloneVector(entity.position),
        scaleVector(commandDirection, 1.0e16),
      );
      if (speedFractionChanged) {
        entity.speedFraction = 1.0;
      }
      entity.mode = "GOTO";
      persistShipEntity(entity);
      armMovementTrace(entity, "goto", {
        commandDirection: summarizeVector(commandDirection),
      }, now);
      logMovementDebug("cmd.goto", entity, {
        commandDirection: summarizeVector(commandDirection),
      });

      if (suppressOwnerGotoEcho) {
        const updates = buildDirectedMovementUpdates(
          entity,
          commandDirection,
          speedFractionChanged,
          runtime.getMovementStamp(now),
        );
        if (session && session._space) {
          session._space.lastPilotCommandDirection = cloneVector(commandDirection);
          session._space.lastPilotCommandMovementAnchorStamp = liveOwnerSessionStamp;
          session._space.lastPilotCommandMovementRawDispatchStamp =
            currentRawDispatchStamp;
          updateDestinyAuthorityState(session, {
            lastOwnerCommandAnchorStamp: liveOwnerSessionStamp,
            lastOwnerCommandRawDispatchStamp: currentRawDispatchStamp,
            lastOwnerCommandHeadingHash: JSON.stringify({
              x: toFiniteNumber(commandDirection.x, 0),
              y: toFiniteNumber(commandDirection.y, 0),
              z: toFiniteNumber(commandDirection.z, 0),
            }),
          });
        }
        logMovementDebug(
          suppressOwnerGotoEchoSameRawPendingFutureSteer
            ? "cmd.goto.ownerEchoSuppressedSameRawPendingFutureSteer"
            : "cmd.goto.ownerEchoSuppressedRecentDuplicate",
          entity,
          {
            commandDirection: summarizeVector(commandDirection),
            currentRawDispatchStamp,
            pendingOwnerMovementStamp,
            pendingOwnerMovementAnchorStamp,
            pendingOwnerMovementRawDispatchStamp,
          },
        );
        runtime.broadcastMovementUpdates(
          updates,
          session,
          options.sendOptions || {},
        );
        runtime.scheduleWatcherMovementAnchor(entity, now, "gotoDirection");
        return true;
      }

      runtime.dispatchConfiguredSubwarpMovement(
        entity,
        (stamp) => buildDirectedMovementUpdates(
          entity,
          commandDirection,
          speedFractionChanged,
          stamp,
        ),
        now,
        {
          ...options,
          ownerDirectEchoLeadOverride,
        },
      );
      runtime.scheduleWatcherMovementAnchor(entity, now, "gotoDirection");

      return true;
    },

    gotoPoint(runtime, session, point, options = {}) {
      const entity = runtime.getShipEntityForSession(session);
      if (!entity || entity.mode === "WARP" || entity.pendingDock) {
        return false;
      }

      const now = runtime.getCurrentSimTimeMs();
      const commandPoint = cloneVector(point, entity.position);
      const commandDirection = normalizeVector(
        subtractVectors(commandPoint, entity.position),
        entity.direction,
      );
      const speedFractionChanged =
        entity.speedFraction <= 0 || entity.mode === "STOP";
      clearTrackingState(entity);
      entity.targetPoint = commandPoint;
      if (speedFractionChanged) {
        entity.speedFraction = 1.0;
      }
      entity.mode = "GOTO";
      persistShipEntity(entity);
      armMovementTrace(entity, "gotoPoint", {
        commandDirection: summarizeVector(commandDirection),
        commandPoint: summarizeVector(commandPoint),
      }, now);
      logMovementDebug("cmd.gotoPoint", entity, {
        commandDirection: summarizeVector(commandDirection),
        commandPoint: summarizeVector(commandPoint),
      });

      runtime.dispatchConfiguredSubwarpMovement(
        entity,
        (stamp) => buildPointMovementUpdates(
          entity,
          commandPoint,
          speedFractionChanged,
          stamp,
        ),
        now,
        options,
      );
      runtime.scheduleWatcherMovementAnchor(entity, now, "gotoPoint");

      return true;
    },

    alignTo(runtime, session, targetEntityID) {
      const entity = runtime.getShipEntityForSession(session);
      const target = runtime.getEntityByID(targetEntityID);
      if (!entity || !target || entity.mode === "WARP" || entity.pendingDock) {
        return false;
      }

      const now = runtime.getCurrentSimTimeMs();
      const alignTargetPosition = getTargetMotionPosition(target);
      const commandDirection = normalizeVector(
        subtractVectors(alignTargetPosition, entity.position),
        entity.direction,
      );
      clearTrackingState(entity);
      entity.targetPoint = addVectors(
        cloneVector(entity.position),
        scaleVector(commandDirection, 1.0e16),
      );
      const previousSpeedFraction = entity.speedFraction;
      entity.speedFraction = previousSpeedFraction > 0 ? previousSpeedFraction : 0.75;
      const speedFractionChanged =
        Math.abs(entity.speedFraction - previousSpeedFraction) > 0.000001;
      entity.mode = "GOTO";
      persistShipEntity(entity);
      armMovementTrace(entity, "align", {
        commandDirection: summarizeVector(commandDirection),
        alignTargetID: target.itemID,
        alignTargetPosition: summarizeVector(alignTargetPosition),
      }, now);
      logMovementDebug("cmd.align", entity, {
        commandDirection: summarizeVector(commandDirection),
        alignTargetID: target.itemID,
        alignTargetPosition: summarizeVector(alignTargetPosition),
      });

      const movementStamp = runtime.getMovementStamp(now);
      const updates = buildDirectedMovementUpdates(
        entity,
        commandDirection,
        speedFractionChanged,
        movementStamp,
      );

      runtime.broadcastPilotCommandMovementUpdates(session, updates, now);
      runtime.scheduleWatcherMovementAnchor(entity, now, "alignTo");

      return true;
    },

    followShipEntity(runtime, entityOrID, targetEntityID, range = 0, options = {}) {
      const entity =
        typeof entityOrID === "object" && entityOrID !== null
          ? entityOrID
          : runtime.getEntityByID(entityOrID);
      const target = runtime.getEntityByID(targetEntityID);
      if (
        !entity ||
        !target ||
        entity.itemID === target.itemID ||
        entity.mode === "WARP" ||
        entity.pendingDock
      ) {
        return false;
      }

      const now = runtime.getCurrentSimTimeMs();
      const explicitDockingTargetID =
        (target.kind === "station" || target.kind === "structure") &&
        Number(options.dockingTargetID || 0) === target.itemID
          ? target.itemID
          : null;
      const preservedDockingTargetID =
        explicitDockingTargetID === null &&
        (target.kind === "station" || target.kind === "structure") &&
        Number(entity.targetEntityID || 0) === target.itemID &&
        Number(entity.dockingTargetID || 0) === target.itemID
          ? target.itemID
          : null;
      const dockingTargetID = explicitDockingTargetID || preservedDockingTargetID;
      const normalizedRange = Math.max(0, toFiniteNumber(range, 0));
      if (
        entity.mode === "FOLLOW" &&
        entity.targetEntityID === target.itemID &&
        entity.dockingTargetID === dockingTargetID &&
        Math.abs(toFiniteNumber(entity.followRange, 0) - normalizedRange) < 1
      ) {
        logMovementDebug("cmd.follow.duplicate", entity, {
          followTargetID: target.itemID,
          followRange: roundNumber(normalizedRange),
          dockingTargetID: dockingTargetID || 0,
        });
        return true;
      }

      const followTargetPosition = getTargetMotionPosition(target, {
        useDockPosition: dockingTargetID === target.itemID,
        shipTypeID: entity.typeID,
        selectionKey: entity.itemID,
      });
      clearTrackingState(entity);
      entity.mode = "FOLLOW";
      entity.targetEntityID = target.itemID;
      entity.dockingTargetID = dockingTargetID;
      entity.followRange = normalizedRange;
      entity.targetPoint = followTargetPosition;
      const previousSpeedFraction = entity.speedFraction;
      entity.speedFraction = previousSpeedFraction > 0 ? previousSpeedFraction : 1;
      const speedFractionChanged =
        Math.abs(entity.speedFraction - previousSpeedFraction) > 0.000001;
      persistShipEntity(entity);
      armMovementTrace(entity, "follow", {
        followTargetID: target.itemID,
        followRange: roundNumber(entity.followRange),
        followTargetPosition: summarizeVector(followTargetPosition),
        dockingTargetID: dockingTargetID || 0,
        preservedDockingTargetID: preservedDockingTargetID || 0,
      }, now);
      logMovementDebug("cmd.follow", entity, {
        followTargetID: target.itemID,
        followRange: roundNumber(entity.followRange),
        followTargetKind: target.kind,
        followTargetPosition: summarizeVector(followTargetPosition),
        explicitDockingTargetID: explicitDockingTargetID || 0,
        preservedDockingTargetID: preservedDockingTargetID || 0,
        dockPosition:
          (target.kind === "station" || target.kind === "structure") && target.dockPosition
            ? summarizeVector(target.dockPosition)
            : null,
        dockingDistance:
          (target.kind === "station" || target.kind === "structure")
            ? roundNumber(getShipDockingDistanceToStation(entity, target))
            : null,
      });

      runtime.dispatchConfiguredSubwarpMovement(
        entity,
        (stamp) => {
          const updates = [
            {
              stamp,
              payload: destiny.buildFollowBallPayload(
                entity.itemID,
                target.itemID,
                entity.followRange,
              ),
            },
          ];
          if (speedFractionChanged) {
            updates.push({
              stamp,
              payload: destiny.buildSetSpeedFractionPayload(
                entity.itemID,
                entity.speedFraction,
              ),
            });
          }
          return updates;
        },
        now,
        options,
      );
      runtime.scheduleWatcherMovementAnchor(entity, now, "followBall");

      return true;
    },

    followBall(runtime, session, targetEntityID, range = 0, options = {}) {
      const entity = runtime.getShipEntityForSession(session);
      return runtime.followShipEntity(entity, targetEntityID, range, options);
    },

    orbitShipEntity(runtime, entityOrID, targetEntityID, distanceValue = 0, options = {}) {
      const entity =
        typeof entityOrID === "object" && entityOrID !== null
          ? entityOrID
          : runtime.getEntityByID(entityOrID);
      const target = runtime.getEntityByID(targetEntityID);
      if (
        !entity ||
        !target ||
        entity.itemID === target.itemID ||
        entity.mode === "WARP" ||
        entity.pendingDock
      ) {
        return false;
      }

      const now = runtime.getCurrentSimTimeMs();
      const normalizedDistance = Math.max(0, toFiniteNumber(distanceValue, 0));
      if (
        entity.mode === "ORBIT" &&
        entity.speedFraction > 0 &&
        entity.targetEntityID === target.itemID &&
        Math.abs(toFiniteNumber(entity.orbitDistance, 0) - normalizedDistance) < 1
      ) {
        logMovementDebug("cmd.orbit.duplicate", entity, {
          orbitTargetID: target.itemID,
          orbitDistance: roundNumber(normalizedDistance),
        });
        return true;
      }
      const radial = normalizeVector(
        subtractVectors(entity.position, target.position),
        buildPerpendicular(entity.direction),
      );

      clearTrackingState(entity);
      entity.mode = "ORBIT";
      entity.targetEntityID = target.itemID;
      entity.orbitDistance = normalizedDistance;
      entity.orbitNormal = normalizeVector(
        crossProduct(radial, DEFAULT_UP),
        buildPerpendicular(radial),
      );
      entity.orbitSign = 1;
      entity.targetPoint = cloneVector(target.position);
      const previousSpeedFraction = entity.speedFraction;
      entity.speedFraction = previousSpeedFraction > 0 ? previousSpeedFraction : 1;
      const speedFractionChanged =
        Math.abs(entity.speedFraction - previousSpeedFraction) > 0.000001;
      persistShipEntity(entity);
      armMovementTrace(entity, "orbit", {
        orbitTargetID: target.itemID,
        orbitDistance: roundNumber(entity.orbitDistance),
        orbitTargetPosition: summarizeVector(target.position),
      }, now);
      logMovementDebug("cmd.orbit", entity, {
        orbitTargetID: target.itemID,
        orbitDistance: roundNumber(entity.orbitDistance),
        orbitTargetPosition: summarizeVector(target.position),
      });

      runtime.dispatchConfiguredSubwarpMovement(
        entity,
        (stamp) => {
          const updates = [
            {
              stamp,
              payload: destiny.buildOrbitPayload(
                entity.itemID,
                target.itemID,
                entity.orbitDistance,
              ),
            },
          ];
          if (speedFractionChanged) {
            updates.push({
              stamp,
              payload: destiny.buildSetSpeedFractionPayload(
                entity.itemID,
                entity.speedFraction,
              ),
            });
          }
          return updates;
        },
        now,
        options,
      );
      runtime.scheduleWatcherMovementAnchor(entity, now, "orbit");

      return true;
    },

    orbit(runtime, session, targetEntityID, distanceValue = 0, options = {}) {
      const entity = runtime.getShipEntityForSession(session);
      return runtime.orbitShipEntity(
        entity,
        targetEntityID,
        distanceValue,
        options,
      );
    },
  };
}

module.exports = {
  createMovementSubwarpCommands,
};
