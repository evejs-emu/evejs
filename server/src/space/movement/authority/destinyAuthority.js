const path = require("path");

const log = require(path.join(__dirname, "../../../utils/logger"));

const {
  DESTINY_CONTRACTS,
  inferDestinyContract,
} = require("./destinyContracts");
const {
  createDestinyJourneyLog,
} = require("./destinyJourneyLog");
const {
  snapshotDestinyAuthorityState,
  updateDestinyAuthorityState,
} = require("./destinySessionState");

function createDestinyAuthority(deps = {}) {
  const {
    buildMissileSessionSnapshot,
    clamp,
    destiny,
    getPayloadPrimaryEntityID,
    isMovementContractPayload,
    logMissileDebug,
    normalizeTraceValue,
    resolveDestinyLifecycleRestampState,
    resolveOwnerMonotonicState,
    resolvePreviousLastSentDestinyWasOwnerCritical,
    roundNumber,
    summarizeMissileUpdatesForLog,
    toInt,
    updatesContainMovementContractPayload,
    MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
    MICHELLE_HELD_FUTURE_DESTINY_LEAD,
    MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD,
    PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
  } = deps;

  const journeyLog = createDestinyJourneyLog({
    normalizeTraceValue,
  });

  function buildSessionSnapshotSafe(runtime, session, rawSimTimeMs) {
    return typeof buildMissileSessionSnapshot === "function"
      ? buildMissileSessionSnapshot(runtime, session, rawSimTimeMs)
      : null;
  }

  function buildDecisionTree(restampSteps = []) {
    if (!Array.isArray(restampSteps) || restampSteps.length === 0) {
      return [];
    }
    return restampSteps.map((step, index) => ({
      order: index + 1,
      reason: step && typeof step.reason === "string"
        ? step.reason
        : "unknown",
      kind: step && typeof step.kind === "string"
        ? step.kind
        : "unknown",
      beforeStamp: toInt(step && step.beforeStamp, 0) >>> 0,
      candidateStamp: toInt(step && step.candidateStamp, 0) >>> 0,
      applied: step && step.applied === true,
      afterStamp: toInt(step && step.afterStamp, 0) >>> 0,
      metadata: normalizeTraceValue(step || {}),
    }));
  }

  function classifyEnvelope(payloads = [], options = {}) {
    const contract = inferDestinyContract(payloads, options);
    journeyLog.logMichelle("destiny.contract.classify", {
      contract,
      options,
      updates: summarizeMissileUpdatesForLog(payloads),
    });
    return contract;
  }

  function getDestinyHistoryAnchorStampForSession(
    runtime,
    session,
    rawSimTimeMs = runtime.getCurrentSimTimeMs(),
    options = {},
  ) {
    if (options && options.historyLeadUsesImmediateSessionStamp === true) {
      const currentSessionStamp = runtime.getCurrentSessionDestinyStamp(
        session,
        rawSimTimeMs,
      );
      return runtime.getImmediateDestinyStampForSession(
        session,
        currentSessionStamp,
      );
    }
    if (options && options.historyLeadUsesPresentedSessionStamp === true) {
      const presentedMaximumFutureLead = Math.max(
        0,
        toInt(
          options.historyLeadPresentedMaximumFutureLead,
          MICHELLE_HELD_FUTURE_DESTINY_LEAD,
        ),
      );
      return runtime.getCurrentPresentedSessionDestinyStamp(
        session,
        rawSimTimeMs,
        presentedMaximumFutureLead,
      );
    }
    if (options && options.historyLeadUsesCurrentSessionStamp === true) {
      return runtime.getCurrentSessionDestinyStamp(session, rawSimTimeMs);
    }
    const visibleStamp = runtime.getCurrentVisibleSessionDestinyStamp(
      session,
      rawSimTimeMs,
    );
    return visibleStamp > MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD
      ? ((visibleStamp - MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD) >>> 0)
      : visibleStamp;
  }

  function resolveDestinyDeliveryStampForSession(
    runtime,
    session,
    authoredStamp,
    rawSimTimeMs = runtime.getCurrentSimTimeMs(),
    options = {},
  ) {
    const maximumHistorySafeLead = Math.max(
      MICHELLE_HELD_FUTURE_DESTINY_LEAD,
      MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD,
      PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
      clamp(
        toInt(options && options.maximumHistorySafeLeadOverride, 0),
        0,
        16,
      ),
    );
    const normalizedAuthoredStamp = toInt(authoredStamp, 0) >>> 0;
    const hasMinimumLead =
      options &&
      Object.prototype.hasOwnProperty.call(
        options,
        "minimumLeadFromCurrentHistory",
      );
    const hasMaximumLead =
      options &&
      Object.prototype.hasOwnProperty.call(
        options,
        "maximumLeadFromCurrentHistory",
      );
    const avoidCurrentHistoryInsertion =
      options && options.avoidCurrentHistoryInsertion === true;
    if (
      !session ||
      !session._space ||
      (!avoidCurrentHistoryInsertion && !hasMinimumLead && !hasMaximumLead)
    ) {
      return normalizedAuthoredStamp;
    }

    const minimumLeadFloor = avoidCurrentHistoryInsertion ? 1 : 0;
    const minimumLead = clamp(
      toInt(
        hasMinimumLead
          ? options.minimumLeadFromCurrentHistory
          : minimumLeadFloor,
        minimumLeadFloor,
      ),
      minimumLeadFloor,
      maximumHistorySafeLead,
    );
    const maximumLead = hasMaximumLead
      ? clamp(
        toInt(options.maximumLeadFromCurrentHistory, minimumLead),
        minimumLead,
        maximumHistorySafeLead,
      )
      : null;
    const historyAnchorStamp = getDestinyHistoryAnchorStampForSession(
      runtime,
      session,
      rawSimTimeMs,
      options,
    );
    const minimumStamp = (historyAnchorStamp + minimumLead) >>> 0;
    const maximumStamp =
      maximumLead === null
        ? null
        : ((historyAnchorStamp + maximumLead) >>> 0);

    let deliveryStamp = Math.max(
      normalizedAuthoredStamp,
      minimumStamp,
    ) >>> 0;
    if (
      maximumStamp !== null &&
      normalizedAuthoredStamp <= maximumStamp + MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD
    ) {
      deliveryStamp = Math.min(deliveryStamp, maximumStamp) >>> 0;
    }
    journeyLog.logMichelle("destiny.delivery.resolve", {
      charID: session && session.characterID ? session.characterID : 0,
      shipID: session && session._space ? toInt(session._space.shipID, 0) : 0,
      authoredStamp: normalizedAuthoredStamp,
      rawSimTimeMs: roundNumber(rawSimTimeMs, 3),
      historyAnchorStamp,
      avoidCurrentHistoryInsertion,
      minimumLead,
      maximumLead,
      minimumStamp,
      maximumStamp,
      deliveryStamp,
      options,
    });
    return deliveryStamp >>> 0;
  }

  function prepareDestinyUpdateForSession(
    runtime,
    session,
    rawPayload,
    rawSimTimeMs = runtime.getCurrentSimTimeMs(),
    options = {},
  ) {
    if (!rawPayload || !Number.isFinite(Number(rawPayload.stamp))) {
      return rawPayload;
    }

    const translateStamps = options && options.translateStamps === true;
    const authoredStamp = translateStamps
      ? runtime.translateDestinyStampForSession(session, rawPayload.stamp)
      : (toInt(rawPayload.stamp, 0) >>> 0);
    const deliveryStamp = resolveDestinyDeliveryStampForSession(
      runtime,
      session,
      authoredStamp,
      rawSimTimeMs,
      options,
    );
    const preservePayloadStateStamp =
      options && options.preservePayloadStateStamp === true;
    const payload =
      deliveryStamp !== authoredStamp && !preservePayloadStateStamp
        ? destiny.restampPayloadState(rawPayload.payload, deliveryStamp)
        : rawPayload.payload;
    return {
      ...rawPayload,
      authoredStamp,
      stamp: deliveryStamp,
      payload,
    };
  }

  function beginGroupJourney({
    session,
    updates,
    options = {},
    rawSimTimeMs = 0,
    currentRawDispatchStamp = 0,
  }) {
    const journeyId = journeyLog.allocateJourneyID("destiny");
    const contract = classifyEnvelope(updates, options);
    const authoritySessionBefore = snapshotDestinyAuthorityState(session);
    updateDestinyAuthorityState(session, {
      lastJourneyId: journeyId,
    });
    journeyLog.logJourney("destiny.authority.begin-group", {
      journeyId,
      contract,
      charID: session && session.characterID ? session.characterID : 0,
      shipID: session && session._space ? toInt(session._space.shipID, 0) : 0,
      rawDispatchStamp: toInt(currentRawDispatchStamp, 0) >>> 0,
      rawSimTimeMs: roundNumber(rawSimTimeMs, 3),
      authoritySessionBefore,
      originalUpdates: summarizeMissileUpdatesForLog(updates),
      options,
    });
    return {
      journeyId,
      contract,
      authoritySessionBefore,
      rawSimTimeMs: roundNumber(rawSimTimeMs, 3),
      currentRawDispatchStamp: toInt(currentRawDispatchStamp, 0) >>> 0,
      originalUpdates: summarizeMissileUpdatesForLog(updates),
    };
  }

  function planGroupEmission({
    runtime,
    session,
    updatesGroup,
    emitOptions = {},
    sendOptions = {},
    rawSimTimeMs = runtime.getCurrentSimTimeMs(),
    currentRawDispatchStamp = 0,
    shouldTraceDispatch = false,
    destinyCallTraceID = 0,
    waitForBubble = false,
    firstGroup = false,
    sessionState = {},
    updatesContainObserverPresentedMonotonicPayload,
  }) {
    if (!Array.isArray(updatesGroup) || updatesGroup.length === 0) {
      return null;
    }

    const authoritySessionState = snapshotDestinyAuthorityState(session);
    let localUpdates = updatesGroup;
    let localStamp = toInt(localUpdates[0] && localUpdates[0].stamp, 0) >>> 0;
    const minimumPostFreshAcquireStamp = toInt(
      emitOptions && emitOptions.minimumPostFreshAcquireStamp,
      0,
    ) >>> 0;
    const isFreshAcquireLifecycleGroup = localUpdates.some(
      (payload) => payload && payload.freshAcquireLifecycleGroup === true,
    );
    const isMissileLifecycleGroup = localUpdates.some(
      (payload) => (
        payload &&
        (
          payload.missileLifecycleGroup === true ||
          payload.ownerMissileLifecycleGroup === true
        )
      ),
    );
    const isOwnerMissileLifecycleGroup = localUpdates.some(
      (payload) => payload && payload.ownerMissileLifecycleGroup === true,
    );
    const isSetStateGroup = localUpdates.some((payload) => (
      payload &&
      Array.isArray(payload.payload) &&
      payload.payload[0] === "SetState"
    ));
    const containsWarpPayload = localUpdates.some((update) => {
      const payload = update && Array.isArray(update.payload)
        ? update.payload
        : null;
      return payload && payload[0] === "WarpTo";
    });
    const originalStamp = localStamp >>> 0;
    const authorityClassificationOptions = {
      ...(sendOptions && typeof sendOptions === "object" ? sendOptions : {}),
      ...(emitOptions && typeof emitOptions === "object" ? emitOptions : {}),
    };
    const authorityJourney = beginGroupJourney({
      session,
      updates: localUpdates,
      options: authorityClassificationOptions,
      rawSimTimeMs,
      currentRawDispatchStamp,
    });
    const isBootstrapAcquireGroup =
      authorityJourney.contract === DESTINY_CONTRACTS.BOOTSTRAP_ACQUIRE;
    const isDestructionTeardownGroup =
      authorityJourney.contract === DESTINY_CONTRACTS.DESTRUCTION_TEARDOWN;
    const traceDetails =
      shouldTraceDispatch || isSetStateGroup
        ? {
            journeyId: authorityJourney.journeyId,
            contract: authorityJourney.contract,
            destinyCallTraceID,
            rawDispatchStamp: currentRawDispatchStamp,
            rawSimTimeMs: roundNumber(rawSimTimeMs, 3),
            waitForBubble: waitForBubble && firstGroup,
            sendReason:
              typeof emitOptions.missileDebugReason === "string"
                ? emitOptions.missileDebugReason
                : null,
            groupReason:
              typeof emitOptions.groupReason === "string"
                ? emitOptions.groupReason
                : null,
            requestedMinimumPostFreshAcquireStamp: minimumPostFreshAcquireStamp,
            sessionBefore: buildSessionSnapshotSafe(runtime, session, rawSimTimeMs),
            authoritySessionBefore: authorityJourney.authoritySessionBefore,
            originalStamp,
            originalUpdates: summarizeMissileUpdatesForLog(localUpdates),
            groupFlags: {
              freshAcquireLifecycle: isFreshAcquireLifecycleGroup,
              missileLifecycle: isMissileLifecycleGroup,
              ownerMissileLifecycle: isOwnerMissileLifecycleGroup,
              setState: isSetStateGroup,
            },
            restampSteps: [],
          }
        : null;

    const restampLocalUpdates = (nextStamp) => {
      if ((nextStamp >>> 0) === (localStamp >>> 0)) {
        return false;
      }
      localUpdates = localUpdates.map((payload) => ({
        ...payload,
        stamp: nextStamp,
        payload:
          sendOptions &&
          sendOptions.preservePayloadStateStamp === true &&
          payload &&
          payload.freshAcquireLifecycleGroup === true
            ? payload.payload
            : destiny.restampPayloadState(payload.payload, nextStamp),
      }));
      localStamp = nextStamp >>> 0;
      return true;
    };
    const recordFloorStage = (reason, candidateStamp, metadata = {}) => {
      if (!traceDetails) {
        if (
          candidateStamp > 0 &&
          (localStamp >>> 0) < (candidateStamp >>> 0)
        ) {
          restampLocalUpdates(candidateStamp);
        }
        return;
      }
      const beforeStamp = localStamp >>> 0;
      const normalizedCandidateStamp = toInt(candidateStamp, 0) >>> 0;
      const applied =
        normalizedCandidateStamp > 0 &&
        beforeStamp < normalizedCandidateStamp;
      if (applied) {
        restampLocalUpdates(normalizedCandidateStamp);
      }
      traceDetails.restampSteps.push({
        reason,
        kind: "floor",
        beforeStamp,
        candidateStamp: normalizedCandidateStamp,
        applied,
        afterStamp: localStamp >>> 0,
        ...metadata,
      });
    };
    const recordCeilingStage = (reason, candidateStamp, metadata = {}) => {
      const beforeUpdates =
        metadata && metadata.captureBeforeUpdates === true
          ? summarizeMissileUpdatesForLog(localUpdates)
          : null;
      if (!traceDetails) {
        if (
          candidateStamp > 0 &&
          (localStamp >>> 0) > (candidateStamp >>> 0)
        ) {
          restampLocalUpdates(candidateStamp);
        }
        return;
      }
      const beforeStamp = localStamp >>> 0;
      const normalizedCandidateStamp = toInt(candidateStamp, 0) >>> 0;
      const applied =
        normalizedCandidateStamp > 0 &&
        beforeStamp > normalizedCandidateStamp;
      if (applied) {
        restampLocalUpdates(normalizedCandidateStamp);
      }
      traceDetails.restampSteps.push({
        reason,
        kind: "ceiling",
        beforeStamp,
        candidateStamp: normalizedCandidateStamp,
        applied,
        afterStamp: localStamp >>> 0,
        beforeUpdates,
        ...metadata,
      });
    };

    const currentSessionStamp = runtime.getCurrentSessionDestinyStamp(
      session,
      rawSimTimeMs,
    );
    const currentImmediateSessionStamp =
      runtime.getImmediateDestinyStampForSession(
        session,
        currentSessionStamp,
      );
    const lastOwnerPilotCommandMovementStamp = toInt(
      authoritySessionState && authoritySessionState.lastOwnerCommandStamp,
      session &&
      session._space &&
      session._space.lastPilotCommandMovementStamp,
    ) >>> 0;
    const lastOwnerPilotCommandMovementAnchorStamp = toInt(
      authoritySessionState && authoritySessionState.lastOwnerCommandAnchorStamp,
      session &&
      session._space &&
      session._space.lastPilotCommandMovementAnchorStamp,
    ) >>> 0;
    const lastOwnerPilotCommandMovementRawDispatchStamp = toInt(
      authoritySessionState && authoritySessionState.lastOwnerCommandRawDispatchStamp,
      session &&
      session._space &&
      session._space.lastPilotCommandMovementRawDispatchStamp,
    ) >>> 0;
    const lifecyclePreviousLastSentDestinyStamp = toInt(
      authoritySessionState && authoritySessionState.lastPresentedStamp,
      session &&
      session._space &&
      session._space.lastSentDestinyStamp,
    ) >>> 0;
    const lifecyclePreviousLastSentDestinyRawDispatchStamp = toInt(
      authoritySessionState && authoritySessionState.lastRawDispatchStamp,
      session &&
      session._space &&
      session._space.lastSentDestinyRawDispatchStamp,
    ) >>> 0;
    const lifecyclePreviousLastSentDestinyWasOwnerCritical =
      authoritySessionState &&
      authoritySessionState.lastSentWasOwnerCritical === true
        ? true
        : (
            session &&
            session._space &&
            session._space.lastSentDestinyWasOwnerCritical === true
          );
    const lifecycleRestampState =
      typeof resolveDestinyLifecycleRestampState === "function"
        ? resolveDestinyLifecycleRestampState({
            localStamp,
            minimumPostFreshAcquireStamp,
            isFreshAcquireLifecycleGroup,
            isMissileLifecycleGroup,
            isOwnerMissileLifecycleGroup,
            currentSessionStamp,
            currentImmediateSessionStamp,
            currentRawDispatchStamp,
            lastFreshAcquireLifecycleStamp:
              toInt(sessionState.lastFreshAcquireLifecycleStamp, 0) >>> 0,
            lastMissileLifecycleStamp:
              toInt(sessionState.lastMissileLifecycleStamp, 0) >>> 0,
            lastOwnerMissileLifecycleStamp:
              toInt(sessionState.lastOwnerMissileLifecycleStamp, 0) >>> 0,
            lastOwnerMissileFreshAcquireStamp:
              toInt(sessionState.lastOwnerMissileFreshAcquireStamp, 0) >>> 0,
            lastOwnerMissileFreshAcquireRawDispatchStamp:
              toInt(sessionState.lastOwnerMissileFreshAcquireRawDispatchStamp, 0) >>> 0,
            lastOwnerMissileLifecycleRawDispatchStamp:
              toInt(sessionState.lastOwnerMissileLifecycleRawDispatchStamp, 0) >>> 0,
            previousLastSentDestinyStamp: lifecyclePreviousLastSentDestinyStamp,
            previousLastSentDestinyRawDispatchStamp:
              lifecyclePreviousLastSentDestinyRawDispatchStamp,
            previousLastSentDestinyWasOwnerCritical:
              lifecyclePreviousLastSentDestinyWasOwnerCritical,
            lastOwnerPilotCommandMovementStamp,
            lastOwnerPilotCommandMovementAnchorStamp,
            lastOwnerPilotCommandMovementRawDispatchStamp,
          })
        : {
            finalStamp: localStamp,
            freshAcquireFloor: 0,
            missileLifecycleFloor: 0,
            ownerMissileLifecycleFloor: 0,
          };
    if (traceDetails && lifecycleRestampState.freshAcquireFloor) {
      traceDetails.freshAcquireFloor = lifecycleRestampState.freshAcquireFloor;
    }
    if (traceDetails && lifecycleRestampState.missileLifecycleFloor) {
      traceDetails.missileLifecycleFloor = lifecycleRestampState.missileLifecycleFloor;
    }
    if (traceDetails && lifecycleRestampState.ownerMissileLifecycleFloor) {
      traceDetails.ownerMissileLifecycleFloor =
        lifecycleRestampState.ownerMissileLifecycleFloor;
    }
    recordFloorStage(
      "lifecycle.finalStamp",
      lifecycleRestampState.finalStamp,
      {
        freshAcquireFloor: lifecycleRestampState.freshAcquireFloor,
        missileLifecycleFloor: lifecycleRestampState.missileLifecycleFloor,
        ownerMissileLifecycleFloor:
          lifecycleRestampState.ownerMissileLifecycleFloor,
      },
    );

    const sessionStampFloorCap = (
      currentSessionStamp +
      MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD
    ) >>> 0;
    const allowsPostHeldFutureDelivery =
      (isBootstrapAcquireGroup && isFreshAcquireLifecycleGroup) ||
      isDestructionTeardownGroup ||
      isSetStateGroup ||
      containsWarpPayload ||
      (
        sendOptions &&
        (
          sendOptions.destinyAuthorityAllowPostHeldFuture === true ||
          toInt(sendOptions.minimumLeadFromCurrentHistory, 0) >
            MICHELLE_HELD_FUTURE_DESTINY_LEAD ||
          toInt(sendOptions.maximumLeadFromCurrentHistory, 0) >
            MICHELLE_HELD_FUTURE_DESTINY_LEAD ||
          toInt(sendOptions.maximumHistorySafeLeadOverride, 0) >
            MICHELLE_HELD_FUTURE_DESTINY_LEAD
        )
      );
    const subwarpHeldFutureCeilingStamp =
      allowsPostHeldFutureDelivery
        ? 0
        : ((currentSessionStamp + MICHELLE_HELD_FUTURE_DESTINY_LEAD) >>> 0);
    const capSubwarpSafeFloor = (stamp) => {
      const normalizedStamp = toInt(stamp, 0) >>> 0;
      if (subwarpHeldFutureCeilingStamp === 0 || normalizedStamp === 0) {
        return normalizedStamp;
      }
      return Math.min(
        normalizedStamp,
        subwarpHeldFutureCeilingStamp,
      ) >>> 0;
    };
    const rawSameRawPublishedLastSentFloor =
      lifecyclePreviousLastSentDestinyStamp > 0 &&
      lifecyclePreviousLastSentDestinyRawDispatchStamp > 0 &&
      lifecyclePreviousLastSentDestinyRawDispatchStamp === currentRawDispatchStamp
        ? lifecyclePreviousLastSentDestinyStamp
        : 0;
    const sameRawPublishedLastSentFloor =
      rawSameRawPublishedLastSentFloor > sessionStampFloorCap
        ? sessionStampFloorCap
        : rawSameRawPublishedLastSentFloor;
    recordFloorStage(
      "published.sameRawLastSentFloor",
      sameRawPublishedLastSentFloor,
    );
    if (
      lifecyclePreviousLastSentDestinyStamp > 0 &&
      lifecyclePreviousLastSentDestinyRawDispatchStamp > 0 &&
      lifecyclePreviousLastSentDestinyRawDispatchStamp !== currentRawDispatchStamp
    ) {
      const cappedCrossRawLastSentFloor =
        lifecyclePreviousLastSentDestinyStamp > sessionStampFloorCap
          ? sessionStampFloorCap
          : lifecyclePreviousLastSentDestinyStamp;
      recordFloorStage(
        "published.crossRawLastSentFloor",
        cappedCrossRawLastSentFloor,
      );
    }

    const ownerShipID =
      session && session._space
        ? (toInt(session._space.shipID, 0) >>> 0)
        : 0;
    const skipOwnerMonotonicRestamp =
      sendOptions && sendOptions.skipOwnerMonotonicRestamp === true;
    const containsMovementContractPayload =
      typeof updatesContainMovementContractPayload === "function"
        ? updatesContainMovementContractPayload(localUpdates)
        : false;
    const isOwnerPilotMovementGroup =
      ownerShipID > 0 &&
      localUpdates.some((update) => {
        const payload = update && Array.isArray(update.payload)
          ? update.payload
          : null;
        if (!payload || typeof isMovementContractPayload !== "function") {
          return false;
        }
        if (!isMovementContractPayload(payload)) {
          return false;
        }
        return typeof getPayloadPrimaryEntityID === "function" &&
          getPayloadPrimaryEntityID(payload) === ownerShipID;
      });
    const isOwnerDamageStateGroup =
      ownerShipID > 0 &&
      localUpdates.some((update) => {
        const payload = update && Array.isArray(update.payload)
          ? update.payload
          : null;
        if (!payload || payload[0] !== "OnDamageStateChange") {
          return false;
        }
        return (toInt(payload[1] && payload[1][0], 0) >>> 0) === ownerShipID;
      });
    const isOwnerCriticalGroup =
      ownerShipID > 0 &&
      (
        isOwnerMissileLifecycleGroup ||
        isSetStateGroup ||
        isOwnerPilotMovementGroup
      );
    const previousLastSentDestinyStamp = toInt(
      authoritySessionState && authoritySessionState.lastPresentedStamp,
      session && session._space && session._space.lastSentDestinyStamp,
    ) >>> 0;
    const previousLastSentDestinyRawDispatchStamp = toInt(
      authoritySessionState && authoritySessionState.lastRawDispatchStamp,
      session && session._space && session._space.lastSentDestinyRawDispatchStamp,
    ) >>> 0;
    const previousLastSentDestinyOnlyStaleProjectedOwnerMissileLane =
      authoritySessionState &&
      authoritySessionState.lastSentOnlyStaleProjectedOwnerMissileLane === true
        ? true
        : (
            session &&
            session._space &&
            session._space.lastSentDestinyOnlyStaleProjectedOwnerMissileLane === true
          );
    const previousLastSentDestinyWasOwnerCritical =
      typeof resolvePreviousLastSentDestinyWasOwnerCritical === "function"
        ? resolvePreviousLastSentDestinyWasOwnerCritical({
            explicitWasOwnerCritical:
              authoritySessionState &&
              typeof authoritySessionState.lastSentWasOwnerCritical === "boolean"
                ? authoritySessionState.lastSentWasOwnerCritical === true
                : (
                    session &&
                    session._space &&
                    typeof session._space.lastSentDestinyWasOwnerCritical === "boolean"
                      ? session._space.lastSentDestinyWasOwnerCritical === true
                      : undefined
                  ),
            previousLastSentDestinyStamp,
            lastOwnerMissileLifecycleStamp:
              toInt(sessionState.lastOwnerMissileLifecycleStamp, 0) >>> 0,
            lastOwnerMissileFreshAcquireStamp:
              toInt(sessionState.lastOwnerMissileFreshAcquireStamp, 0) >>> 0,
            lastOwnerNonMissileCriticalStamp:
              toInt(sessionState.lastOwnerNonMissileCriticalStamp, 0) >>> 0,
            lastOwnerPilotCommandMovementStamp,
          })
        : lifecyclePreviousLastSentDestinyWasOwnerCritical;
    const containsObserverPresentedMonotonicPayload =
      typeof updatesContainObserverPresentedMonotonicPayload === "function"
        ? updatesContainObserverPresentedMonotonicPayload(localUpdates, ownerShipID)
        : false;
    const currentPresentedObserverStamp =
      containsObserverPresentedMonotonicPayload &&
      previousLastSentDestinyOnlyStaleProjectedOwnerMissileLane !== true
        ? runtime.getCurrentPresentedSessionDestinyStamp(
            session,
            rawSimTimeMs,
            (
              MICHELLE_HELD_FUTURE_DESTINY_LEAD +
              MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD
            ) >>> 0,
          ) >>> 0
        : 0;
    const rawPresentedOwnerCriticalStamp =
      ownerShipID > 0
        ? runtime.getCurrentPresentedSessionDestinyStamp(
            session,
            rawSimTimeMs,
            PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
          ) >>> 0
        : 0;
    const currentPresentedOwnerCriticalStamp =
      isMissileLifecycleGroup &&
      isOwnerMissileLifecycleGroup !== true
        ? Math.min(
            rawPresentedOwnerCriticalStamp,
            ((currentSessionStamp + MICHELLE_HELD_FUTURE_DESTINY_LEAD) >>> 0),
          ) >>> 0
        : rawPresentedOwnerCriticalStamp;
    const currentPresentedObserverSubwarpSafeStamp =
      capSubwarpSafeFloor(currentPresentedObserverStamp);
    const bootstrapAcquireNeedsOwnerMovementClearance =
      isBootstrapAcquireGroup &&
      isFreshAcquireLifecycleGroup &&
      lastOwnerPilotCommandMovementStamp > 0 &&
      lastOwnerPilotCommandMovementStamp >= currentImmediateSessionStamp &&
      (
        currentPresentedOwnerCriticalStamp === 0 ||
        lastOwnerPilotCommandMovementStamp <= currentPresentedOwnerCriticalStamp
      );
    const observerDirectPresentedMonotonicFloor =
      !isOwnerCriticalGroup &&
      !isOwnerDamageStateGroup &&
      containsObserverPresentedMonotonicPayload
        ? currentPresentedObserverSubwarpSafeStamp
        : 0;
    const bootstrapAcquireClearCeilingStamp =
      isBootstrapAcquireGroup &&
      isFreshAcquireLifecycleGroup &&
      !isMissileLifecycleGroup &&
      !isOwnerCriticalGroup &&
      !isOwnerDamageStateGroup
        ? (
            bootstrapAcquireNeedsOwnerMovementClearance
              ? (
                  (
                    Math.max(
                      currentPresentedObserverSubwarpSafeStamp,
                      lastOwnerPilotCommandMovementStamp,
                    ) +
                    MICHELLE_HELD_FUTURE_DESTINY_LEAD
                  ) >>> 0
                )
              : (
                  (
                    currentImmediateSessionStamp +
                    MICHELLE_HELD_FUTURE_DESTINY_LEAD
                  ) >>> 0
                )
          )
        : 0;
    const sameRawNonCriticalPresentedLaneHasClearedOwnerFreshAcquireLane =
      previousLastSentDestinyStamp > 0 &&
      previousLastSentDestinyRawDispatchStamp > 0 &&
      previousLastSentDestinyRawDispatchStamp === currentRawDispatchStamp &&
      currentPresentedOwnerCriticalStamp > 0 &&
      previousLastSentDestinyStamp === currentPresentedOwnerCriticalStamp &&
      Math.max(
        toInt(sessionState.lastOwnerMissileFreshAcquireStamp, 0) >>> 0,
        toInt(sessionState.lastFreshAcquireLifecycleStamp, 0) >>> 0,
      ) > 0 &&
      previousLastSentDestinyStamp >
        Math.max(
          toInt(sessionState.lastOwnerMissileFreshAcquireStamp, 0) >>> 0,
          toInt(sessionState.lastFreshAcquireLifecycleStamp, 0) >>> 0,
        );
    const skipOwnerMonotonicRestampForNonCriticalPresentedLane =
      skipOwnerMonotonicRestamp !== true &&
      sendOptions &&
      sendOptions.skipOwnerMonotonicRestampWhenPreviousNotOwnerCritical === true &&
      isOwnerMissileLifecycleGroup === true &&
      isFreshAcquireLifecycleGroup === true &&
      !sameRawNonCriticalPresentedLaneHasClearedOwnerFreshAcquireLane &&
      previousLastSentDestinyWasOwnerCritical !== true &&
      !(
        previousLastSentDestinyStamp > 0 &&
        previousLastSentDestinyStamp === (
          toInt(sessionState.lastOwnerMissileLifecycleStamp, 0) >>> 0
        ) &&
        previousLastSentDestinyStamp !== (
          toInt(sessionState.lastOwnerMissileFreshAcquireStamp, 0) >>> 0
        )
      ) &&
      previousLastSentDestinyStamp > 0 &&
      previousLastSentDestinyStamp === currentPresentedOwnerCriticalStamp &&
      previousLastSentDestinyRawDispatchStamp > 0 &&
      previousLastSentDestinyRawDispatchStamp === currentRawDispatchStamp;
    const ownerMonotonicState = (
      skipOwnerMonotonicRestamp ||
      skipOwnerMonotonicRestampForNonCriticalPresentedLane
    )
      ? {
          maximumTrustedRecentEmittedOwnerCriticalStamp: 0,
          projectedRecentLastSentLane: 0,
          presentedLastSentMonotonicFloor: 0,
          genericMonotonicFloor: 0,
          recentOwnerCriticalMonotonicFloor: 0,
          ownerCriticalCeilingStamp: 0,
        }
      : (
        typeof resolveOwnerMonotonicState === "function"
          ? resolveOwnerMonotonicState({
              hasOwnerShip: ownerShipID > 0,
              containsMovementContractPayload,
              isSetStateGroup,
              isOwnerPilotMovementGroup,
              isMissileLifecycleGroup,
              isOwnerMissileLifecycleGroup,
              isOwnerCriticalGroup,
              isFreshAcquireLifecycleGroup,
              isOwnerDamageStateGroup,
              currentLocalStamp: localStamp,
              currentSessionStamp,
              currentImmediateSessionStamp,
              currentPresentedOwnerCriticalStamp,
              currentRawDispatchStamp,
              recentEmittedOwnerCriticalMaxLead:
                MICHELLE_HELD_FUTURE_DESTINY_LEAD +
                MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD +
                PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
              ownerCriticalCeilingLead: MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
              previousLastSentDestinyStamp,
              previousLastSentDestinyRawDispatchStamp,
              previousLastSentDestinyExplicitWasOwnerCritical:
                authoritySessionState &&
                typeof authoritySessionState.lastSentWasOwnerCritical === "boolean"
                  ? authoritySessionState.lastSentWasOwnerCritical === true
                  : (
                      session &&
                      session._space &&
                      typeof session._space.lastSentDestinyWasOwnerCritical === "boolean"
                        ? session._space.lastSentDestinyWasOwnerCritical === true
                        : false
                    ),
              previousLastSentDestinyWasOwnerCritical,
              previousLastSentDestinyOnlyStaleProjectedOwnerMissileLane:
                authoritySessionState &&
                authoritySessionState.lastSentOnlyStaleProjectedOwnerMissileLane === true
                  ? true
                  : (
                      session &&
                      session._space &&
                      session._space.lastSentDestinyOnlyStaleProjectedOwnerMissileLane === true
                    ),
              lastOwnerPilotCommandMovementStamp,
              lastOwnerPilotCommandMovementAnchorStamp,
              lastOwnerPilotCommandMovementRawDispatchStamp,
              lastOwnerNonMissileCriticalStamp:
                toInt(sessionState.lastOwnerNonMissileCriticalStamp, 0) >>> 0,
              lastOwnerMissileLifecycleStamp:
                toInt(sessionState.lastOwnerMissileLifecycleStamp, 0) >>> 0,
              lastOwnerMissileLifecycleAnchorStamp:
                toInt(sessionState.lastOwnerMissileLifecycleAnchorStamp, 0) >>> 0,
              lastOwnerMissileLifecycleRawDispatchStamp:
                toInt(sessionState.lastOwnerMissileLifecycleRawDispatchStamp, 0) >>> 0,
              lastOwnerMissileFreshAcquireStamp:
                toInt(sessionState.lastOwnerMissileFreshAcquireStamp, 0) >>> 0,
              lastOwnerMissileFreshAcquireAnchorStamp:
                toInt(sessionState.lastOwnerMissileFreshAcquireAnchorStamp, 0) >>> 0,
              lastOwnerMissileFreshAcquireRawDispatchStamp:
                toInt(sessionState.lastOwnerMissileFreshAcquireRawDispatchStamp, 0) >>> 0,
              allowAdjacentRawFreshAcquireLaneReuse:
                sendOptions &&
                sendOptions.allowAdjacentRawFreshAcquireLaneReuse === true,
            })
          : {
              maximumTrustedRecentEmittedOwnerCriticalStamp: 0,
              projectedRecentLastSentLane: 0,
              presentedLastSentMonotonicFloor: 0,
              genericMonotonicFloor: 0,
              recentOwnerCriticalMonotonicFloor: 0,
              ownerCriticalCeilingStamp: 0,
            }
      );
    const {
      maximumTrustedRecentEmittedOwnerCriticalStamp,
      projectedRecentLastSentLane,
      presentedLastSentMonotonicFloor,
      genericMonotonicFloor,
      recentOwnerCriticalMonotonicFloor,
      ownerCriticalCeilingStamp,
      decisionSummary: ownerMonotonicDecisionSummary,
    } = ownerMonotonicState;
    const destructionTeardownLastSentMonotonicFloor =
      isDestructionTeardownGroup &&
      presentedLastSentMonotonicFloor > 0
        ? presentedLastSentMonotonicFloor
        : 0;
    const sameRawPublishedLastSentSubwarpSafeFloor =
      capSubwarpSafeFloor(sameRawPublishedLastSentFloor);
    const presentedLastSentSubwarpSafeFloor =
      capSubwarpSafeFloor(presentedLastSentMonotonicFloor);
    const recentOwnerCriticalSubwarpSafeFloor =
      capSubwarpSafeFloor(recentOwnerCriticalMonotonicFloor);
    if (traceDetails) {
      traceDetails.genericMonotonicFloor = {
        ownerShipID,
        containsMovementContractPayload,
        isOwnerCriticalGroup,
        isOwnerDamageStateGroup,
        isOwnerPilotMovementGroup,
        previousLastSentDestinyStamp,
        previousLastSentDestinyRawDispatchStamp,
        previousLastSentDestinyWasOwnerCritical,
        currentPresentedOwnerCriticalStamp,
        skipOwnerMonotonicRestamp,
        skipOwnerMonotonicRestampForNonCriticalPresentedLane,
        allowAdjacentRawFreshAcquireLaneReuse:
          sendOptions &&
          sendOptions.allowAdjacentRawFreshAcquireLaneReuse === true,
        maximumTrustedRecentEmittedOwnerCriticalStamp,
        projectedRecentLastSentLane,
        presentedLastSentMonotonicFloor,
        presentedLastSentSubwarpSafeFloor,
        genericMonotonicFloor,
        recentOwnerCriticalMonotonicFloor,
        recentOwnerCriticalSubwarpSafeFloor,
        ownerCriticalCeilingStamp,
      };
      traceDetails.ownerMonotonicDecisionTrace =
        ownerMonotonicDecisionSummary || null;
    }
    recordFloorStage(
      "owner.presentedLastSentMonotonicFloor",
      presentedLastSentMonotonicFloor,
    );
    recordFloorStage(
      "owner.genericMonotonicFloor",
      genericMonotonicFloor,
    );
    recordFloorStage(
      "owner.recentOwnerCriticalMonotonicFloor",
      recentOwnerCriticalMonotonicFloor,
    );
    recordFloorStage(
      "destructionTeardown.lastSentMonotonicFloor",
      destructionTeardownLastSentMonotonicFloor,
    );
    if (traceDetails) {
      traceDetails.observerDirectPresentedMonotonicFloor = {
        ownerShipID,
        containsObserverPresentedMonotonicPayload,
        currentPresentedObserverStamp,
        currentPresentedObserverSubwarpSafeStamp,
        previousLastSentDestinyOnlyStaleProjectedOwnerMissileLane,
        observerDirectPresentedMonotonicFloor,
      };
    }
    const observerMovementContractProjectedClearFloor =
      containsMovementContractPayload &&
      !isMissileLifecycleGroup &&
      !isOwnerCriticalGroup &&
      !isOwnerDamageStateGroup &&
      previousLastSentDestinyWasOwnerCritical === true &&
      currentPresentedObserverSubwarpSafeStamp > 0 &&
      projectedRecentLastSentLane > currentPresentedObserverSubwarpSafeStamp
        ? ((currentPresentedObserverSubwarpSafeStamp + 1) >>> 0)
        : 0;
    if (traceDetails) {
      traceDetails.observerMovementContractProjectedClearFloor = {
        ownerShipID,
        containsMovementContractPayload,
        previousLastSentDestinyWasOwnerCritical,
        currentPresentedObserverStamp,
        currentPresentedObserverSubwarpSafeStamp,
        projectedRecentLastSentLane,
        observerMovementContractProjectedClearFloor,
      };
    }
    const observerMissileLifecyclePostHeldClearFloor =
      isMissileLifecycleGroup &&
      !isOwnerCriticalGroup &&
      !isOwnerDamageStateGroup &&
      isFreshAcquireLifecycleGroup !== true &&
      currentPresentedObserverSubwarpSafeStamp > 0 &&
      currentPresentedObserverSubwarpSafeStamp >= (
        (currentSessionStamp + MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD) >>> 0
      ) &&
      recentOwnerCriticalSubwarpSafeFloor >= currentPresentedObserverSubwarpSafeStamp
        ? ((currentPresentedObserverSubwarpSafeStamp + 1) >>> 0)
        : 0;
    if (traceDetails) {
      traceDetails.observerMissileLifecyclePostHeldClearFloor = {
        ownerShipID,
        isMissileLifecycleGroup,
        isFreshAcquireLifecycleGroup,
        currentSessionStamp,
        currentPresentedObserverStamp,
        currentPresentedObserverSubwarpSafeStamp,
        recentOwnerCriticalMonotonicFloor,
        recentOwnerCriticalSubwarpSafeFloor,
        observerMissileLifecyclePostHeldClearFloor,
      };
    }
    const lastFreshAcquirePublishedStamp = Math.max(
      toInt(sessionState.lastFreshAcquireLifecycleStamp, 0) >>> 0,
      toInt(
        authoritySessionState && authoritySessionState.lastFreshAcquireLifecycleStamp,
        0,
      ) >>> 0,
      toInt(
        session && session._space && session._space.lastFreshAcquireLifecycleStamp,
        0,
      ) >>> 0,
      toInt(
        authoritySessionState && authoritySessionState.lastBootstrapStamp,
        0,
      ) >>> 0,
    ) >>> 0;
    const movementAfterSameRawFreshAcquireCatchUpFloor =
      containsMovementContractPayload &&
      !isMissileLifecycleGroup &&
      !isOwnerCriticalGroup &&
      !isOwnerDamageStateGroup &&
      previousLastSentDestinyStamp > 0 &&
      previousLastSentDestinyRawDispatchStamp > 0 &&
      previousLastSentDestinyRawDispatchStamp === currentRawDispatchStamp &&
      previousLastSentDestinyStamp === lastFreshAcquirePublishedStamp
        ? previousLastSentDestinyStamp
        : 0;
    recordFloorStage(
      "observer.directPresentedMonotonicFloor",
      observerDirectPresentedMonotonicFloor,
    );
    recordCeilingStage(
      "bootstrapAcquire.clearCeiling",
      bootstrapAcquireClearCeilingStamp,
    );
    recordFloorStage(
      "observer.movementContractProjectedClearFloor",
      observerMovementContractProjectedClearFloor,
    );
    recordFloorStage(
      "observer.missileLifecyclePostHeldClearFloor",
      observerMissileLifecyclePostHeldClearFloor,
    );
    recordCeilingStage(
      "owner.ownerCriticalCeilingStamp",
      ownerCriticalCeilingStamp,
      {
        ownerCriticalCeilingStamp,
        captureBeforeUpdates: true,
      },
    );
    if (
      ownerCriticalCeilingStamp > 0 &&
      traceDetails &&
      traceDetails.restampSteps.length > 0
    ) {
      const latestRestampStep =
        traceDetails.restampSteps[traceDetails.restampSteps.length - 1];
      if (
        latestRestampStep &&
        latestRestampStep.reason === "owner.ownerCriticalCeilingStamp" &&
        latestRestampStep.applied === true &&
        typeof logMissileDebug === "function"
      ) {
        const unclampedStamp = latestRestampStep.beforeStamp >>> 0;
        const unclampedUpdates = Array.isArray(latestRestampStep.beforeUpdates)
          ? latestRestampStep.beforeUpdates
          : [];
        traceDetails.ownerCriticalCeilingClamp = {
          unclampedStamp,
          clampedStamp: localStamp >>> 0,
          ownerCriticalCeilingStamp,
        };
        logMissileDebug("destiny.owner-critical-ceiling-clamp", {
          destinyCallTraceID,
          rawDispatchStamp: currentRawDispatchStamp,
          rawSimTimeMs: roundNumber(rawSimTimeMs, 3),
          ownerCriticalCeilingStamp,
          unclampedStamp,
          clampedStamp: localStamp >>> 0,
          session: buildSessionSnapshotSafe(runtime, session, rawSimTimeMs),
          unclampedUpdates,
          clampedUpdates: summarizeMissileUpdatesForLog(localUpdates),
          traceDetails: normalizeTraceValue(traceDetails),
        });
      }
    }
    if (
      isMissileLifecycleGroup &&
      !isOwnerCriticalGroup &&
      !isOwnerDamageStateGroup &&
      ownerCriticalCeilingStamp === 0
    ) {
      const missileLifecycleBaseCeilingStamp = Math.max(
        ((currentSessionStamp + MICHELLE_HELD_FUTURE_DESTINY_LEAD) >>> 0),
        currentPresentedOwnerCriticalStamp,
      ) >>> 0;
      const missileLifecycleMonotonicFloor = Math.max(
        sameRawPublishedLastSentSubwarpSafeFloor,
        presentedLastSentSubwarpSafeFloor,
        recentOwnerCriticalSubwarpSafeFloor,
        observerDirectPresentedMonotonicFloor,
        observerMissileLifecyclePostHeldClearFloor,
      ) >>> 0;
      const missileLifecycleCeilingStamp = Math.max(
        missileLifecycleBaseCeilingStamp,
        missileLifecycleMonotonicFloor,
      ) >>> 0;
      recordCeilingStage(
        "missile.nonOwnerLifecycleCeiling",
        missileLifecycleCeilingStamp,
      );
    }
    if (
      !isMissileLifecycleGroup &&
      !isOwnerCriticalGroup &&
      !isOwnerDamageStateGroup &&
      ownerCriticalCeilingStamp === 0
    ) {
      const observerBroadcastMonotonicFloor = Math.max(
        sameRawPublishedLastSentSubwarpSafeFloor,
        presentedLastSentSubwarpSafeFloor,
        recentOwnerCriticalSubwarpSafeFloor,
        observerDirectPresentedMonotonicFloor,
        observerMovementContractProjectedClearFloor,
        observerMissileLifecyclePostHeldClearFloor,
      ) >>> 0;
      const observerBroadcastCeilingStamp = Math.max(
        sessionStampFloorCap,
        ((currentSessionStamp + MICHELLE_HELD_FUTURE_DESTINY_LEAD) >>> 0),
        bootstrapAcquireClearCeilingStamp,
        observerBroadcastMonotonicFloor,
        destructionTeardownLastSentMonotonicFloor,
      ) >>> 0;
      recordCeilingStage(
        "observer.heldFutureCeiling",
        observerBroadcastCeilingStamp,
      );
    }
    recordCeilingStage(
      "authority.subwarpHeldFutureCeiling",
      subwarpHeldFutureCeilingStamp,
      {
        allowsPostHeldFutureDelivery,
        containsWarpPayload,
        minimumLeadFromCurrentHistory:
          toInt(sendOptions && sendOptions.minimumLeadFromCurrentHistory, 0),
        maximumLeadFromCurrentHistory:
          toInt(sendOptions && sendOptions.maximumLeadFromCurrentHistory, 0),
        maximumHistorySafeLeadOverride:
          toInt(sendOptions && sendOptions.maximumHistorySafeLeadOverride, 0),
      },
    );
    const ownerSkippedMonotonicLastSentCatchUpIsSafe =
      allowsPostHeldFutureDelivery ||
      subwarpHeldFutureCeilingStamp === 0 ||
      previousLastSentDestinyStamp <= subwarpHeldFutureCeilingStamp;
    const ownerSkippedMonotonicLastSentCatchUpFloor =
      authorityJourney.contract === DESTINY_CONTRACTS.OWNER_PILOT_COMMAND &&
      isOwnerPilotMovementGroup &&
      skipOwnerMonotonicRestamp === true &&
      previousLastSentDestinyOnlyStaleProjectedOwnerMissileLane !== true &&
      previousLastSentDestinyStamp > 0 &&
      localStamp < previousLastSentDestinyStamp &&
      ownerSkippedMonotonicLastSentCatchUpIsSafe
        ? previousLastSentDestinyStamp
        : 0;
    recordFloorStage(
      "owner.skippedMonotonicLastSentCatchUpFloor",
      ownerSkippedMonotonicLastSentCatchUpFloor,
      {
        previousLastSentDestinyStamp,
        previousLastSentDestinyRawDispatchStamp,
        currentRawDispatchStamp,
        currentSessionStamp,
        subwarpHeldFutureCeilingStamp,
        allowsPostHeldFutureDelivery,
        skipOwnerMonotonicRestamp,
        previousLastSentDestinyOnlyStaleProjectedOwnerMissileLane,
        isSafe: ownerSkippedMonotonicLastSentCatchUpIsSafe,
      },
    );
    const bootstrapAcquireLastSentCatchUpFloor =
      isBootstrapAcquireGroup &&
      isFreshAcquireLifecycleGroup &&
      previousLastSentDestinyStamp > 0 &&
      localStamp < previousLastSentDestinyStamp &&
      allowsPostHeldFutureDelivery
        ? previousLastSentDestinyStamp
        : 0;
    recordFloorStage(
      "bootstrapAcquire.lastSentCatchUpFloor",
      bootstrapAcquireLastSentCatchUpFloor,
      {
        previousLastSentDestinyStamp,
        previousLastSentDestinyRawDispatchStamp,
        currentRawDispatchStamp,
        currentSessionStamp,
        bootstrapAcquireClearCeilingStamp,
        allowsPostHeldFutureDelivery,
      },
    );
    recordFloorStage(
      "movement.sameRawFreshAcquireCatchUpFloor",
      movementAfterSameRawFreshAcquireCatchUpFloor,
      {
        previousLastSentDestinyStamp,
        previousLastSentDestinyRawDispatchStamp,
        currentRawDispatchStamp,
        currentSessionStamp,
        lastFreshAcquirePublishedStamp,
        containsMovementContractPayload,
        isOwnerCriticalGroup,
      },
    );
    if (
      traceDetails &&
      previousLastSentDestinyStamp > 0 &&
      localStamp < previousLastSentDestinyStamp &&
      typeof logMissileDebug === "function"
    ) {
      logMissileDebug("destiny.backstep-risk", {
        destinyCallTraceID,
        rawDispatchStamp: currentRawDispatchStamp,
        rawSimTimeMs: roundNumber(rawSimTimeMs, 3),
        previousLastSentDestinyStamp,
        emittedStamp: localStamp >>> 0,
        session: buildSessionSnapshotSafe(runtime, session, rawSimTimeMs),
        updates: summarizeMissileUpdatesForLog(localUpdates),
        traceDetails: normalizeTraceValue(traceDetails),
      });
    }
    journeyLog.logEngine("destiny.authority.plan-group", {
      journeyId: authorityJourney.journeyId,
      contract: authorityJourney.contract,
      charID: session && session.characterID ? session.characterID : 0,
      shipID: ownerShipID,
      rawDispatchStamp: currentRawDispatchStamp,
      rawSimTimeMs: roundNumber(rawSimTimeMs, 3),
      originalStamp,
      finalStamp: localStamp >>> 0,
      currentSessionStamp,
      currentImmediateSessionStamp,
      currentPresentedOwnerCriticalStamp,
      currentPresentedObserverStamp,
      flags: {
        isFreshAcquireLifecycleGroup,
        isMissileLifecycleGroup,
        isOwnerMissileLifecycleGroup,
        isSetStateGroup,
        isOwnerPilotMovementGroup,
        isOwnerDamageStateGroup,
        isOwnerCriticalGroup,
      },
      floors: {
        sameRawPublishedLastSentFloor,
        sameRawPublishedLastSentSubwarpSafeFloor,
        presentedLastSentMonotonicFloor,
        presentedLastSentSubwarpSafeFloor,
        genericMonotonicFloor,
        recentOwnerCriticalMonotonicFloor,
        recentOwnerCriticalSubwarpSafeFloor,
        observerDirectPresentedMonotonicFloor,
        observerMovementContractProjectedClearFloor,
        observerMissileLifecyclePostHeldClearFloor,
        ownerSkippedMonotonicLastSentCatchUpFloor,
        bootstrapAcquireLastSentCatchUpFloor,
        movementAfterSameRawFreshAcquireCatchUpFloor,
      },
      ceilings: {
        ownerCriticalCeilingStamp,
        subwarpHeldFutureCeilingStamp,
      },
      restampSteps: traceDetails ? traceDetails.restampSteps : [],
      updates: summarizeMissileUpdatesForLog(localUpdates),
    });
    return {
      authorityJourney,
      updates: localUpdates,
      finalStamp: localStamp >>> 0,
      originalStamp,
      traceDetails,
      currentSessionStamp: currentSessionStamp >>> 0,
      flags: {
        isFreshAcquireLifecycleGroup,
        isMissileLifecycleGroup,
        isOwnerMissileLifecycleGroup,
        isSetStateGroup,
        isOwnerPilotMovementGroup,
        isOwnerDamageStateGroup,
        isOwnerCriticalGroup,
        previousLastSentDestinyStamp: previousLastSentDestinyStamp >>> 0,
      },
    };
  }

  function applyLegacySessionEmissionState(context = {}, details = {}) {
    const {
      journeyId,
      contract,
      currentRawDispatchStamp,
    } = context;
    const {
      session,
      finalStamp,
      currentSessionStamp,
      flags = {},
      legacyStateBefore = {},
    } = details;
    if (!session || !session._space) {
      return {
        ...legacyStateBefore,
      };
    }
    const localStamp = toInt(finalStamp, 0) >>> 0;
    const currentSessionAnchorStamp = toInt(currentSessionStamp, 0) >>> 0;
    const nextLegacyState = {
      lastFreshAcquireLifecycleStamp:
        toInt(legacyStateBefore.lastFreshAcquireLifecycleStamp, 0) >>> 0,
      lastMissileLifecycleStamp:
        toInt(legacyStateBefore.lastMissileLifecycleStamp, 0) >>> 0,
      lastOwnerMissileLifecycleStamp:
        toInt(legacyStateBefore.lastOwnerMissileLifecycleStamp, 0) >>> 0,
      lastOwnerMissileLifecycleAnchorStamp:
        toInt(legacyStateBefore.lastOwnerMissileLifecycleAnchorStamp, 0) >>> 0,
      lastOwnerMissileFreshAcquireStamp:
        toInt(legacyStateBefore.lastOwnerMissileFreshAcquireStamp, 0) >>> 0,
      lastOwnerMissileFreshAcquireAnchorStamp:
        toInt(legacyStateBefore.lastOwnerMissileFreshAcquireAnchorStamp, 0) >>> 0,
      lastOwnerMissileFreshAcquireRawDispatchStamp:
        toInt(legacyStateBefore.lastOwnerMissileFreshAcquireRawDispatchStamp, 0) >>> 0,
      lastOwnerMissileLifecycleRawDispatchStamp:
        toInt(legacyStateBefore.lastOwnerMissileLifecycleRawDispatchStamp, 0) >>> 0,
      lastOwnerNonMissileCriticalStamp:
        toInt(legacyStateBefore.lastOwnerNonMissileCriticalStamp, 0) >>> 0,
      lastOwnerNonMissileCriticalRawDispatchStamp:
        toInt(legacyStateBefore.lastOwnerNonMissileCriticalRawDispatchStamp, 0) >>> 0,
    };
    const previousSessionLastSentDestinyStamp = toInt(
      session._space.lastSentDestinyStamp,
      0,
    ) >>> 0;
    const localStampEstablishedLastSentLane =
      localStamp > previousSessionLastSentDestinyStamp;
    const localStampMatchedLastSentLane =
      localStamp === previousSessionLastSentDestinyStamp;
    session._space.lastSentDestinyStamp = Math.max(
      previousSessionLastSentDestinyStamp,
      localStamp,
    ) >>> 0;
    if (localStampEstablishedLastSentLane) {
      session._space.lastSentDestinyRawDispatchStamp =
        currentRawDispatchStamp;
      session._space.lastSentDestinyOnlyStaleProjectedOwnerMissileLane =
        false;
      session._space.lastSentDestinyWasOwnerCritical =
        flags.isOwnerCriticalGroup === true;
    } else if (
      localStampMatchedLastSentLane &&
      flags.isOwnerCriticalGroup === true
    ) {
      session._space.lastSentDestinyRawDispatchStamp = Math.max(
        toInt(session._space.lastSentDestinyRawDispatchStamp, 0) >>> 0,
        currentRawDispatchStamp,
      ) >>> 0;
      session._space.lastSentDestinyOnlyStaleProjectedOwnerMissileLane =
        false;
      session._space.lastSentDestinyWasOwnerCritical = true;
    }
    if (flags.isSetStateGroup === true) {
      const previousOwnerNonMissileCriticalSessionStamp = toInt(
        session._space.lastOwnerNonMissileCriticalStamp,
        0,
      ) >>> 0;
      if (localStamp >= previousOwnerNonMissileCriticalSessionStamp) {
        session._space.lastOwnerNonMissileCriticalStamp = localStamp;
        nextLegacyState.lastOwnerNonMissileCriticalStamp = localStamp;
        session._space.lastOwnerNonMissileCriticalRawDispatchStamp =
          currentRawDispatchStamp;
        nextLegacyState.lastOwnerNonMissileCriticalRawDispatchStamp =
          currentRawDispatchStamp;
      }
    }
    if (
      flags.isFreshAcquireLifecycleGroup === true &&
      localStamp >= nextLegacyState.lastFreshAcquireLifecycleStamp
    ) {
      session._space.lastFreshAcquireLifecycleStamp = localStamp;
      nextLegacyState.lastFreshAcquireLifecycleStamp = localStamp;
    }
    if (
      flags.isMissileLifecycleGroup === true &&
      localStamp >= nextLegacyState.lastMissileLifecycleStamp
    ) {
      session._space.lastMissileLifecycleStamp = localStamp;
      nextLegacyState.lastMissileLifecycleStamp = localStamp;
    }
    if (flags.isOwnerMissileLifecycleGroup === true) {
      if (localStamp >= nextLegacyState.lastOwnerMissileLifecycleStamp) {
        session._space.lastOwnerMissileLifecycleStamp = localStamp;
        nextLegacyState.lastOwnerMissileLifecycleStamp = localStamp;
        session._space.lastOwnerMissileLifecycleAnchorStamp =
          currentSessionAnchorStamp;
        nextLegacyState.lastOwnerMissileLifecycleAnchorStamp =
          currentSessionAnchorStamp;
        session._space.lastOwnerMissileLifecycleRawDispatchStamp =
          currentRawDispatchStamp;
        nextLegacyState.lastOwnerMissileLifecycleRawDispatchStamp =
          currentRawDispatchStamp;
      }
      if (
        flags.isFreshAcquireLifecycleGroup === true &&
        localStamp >= nextLegacyState.lastOwnerMissileFreshAcquireStamp
      ) {
        session._space.lastOwnerMissileFreshAcquireStamp = localStamp;
        nextLegacyState.lastOwnerMissileFreshAcquireStamp = localStamp;
        session._space.lastOwnerMissileFreshAcquireAnchorStamp =
          currentSessionAnchorStamp;
        nextLegacyState.lastOwnerMissileFreshAcquireAnchorStamp =
          currentSessionAnchorStamp;
        session._space.lastOwnerMissileFreshAcquireRawDispatchStamp =
          currentRawDispatchStamp;
        nextLegacyState.lastOwnerMissileFreshAcquireRawDispatchStamp =
          currentRawDispatchStamp;
      }
    }
    journeyLog.logEngine("destiny.authority.apply-legacy-session-state", {
      journeyId,
      contract,
      charID: session && session.characterID ? session.characterID : 0,
      shipID: session && session._space ? toInt(session._space.shipID, 0) : 0,
      rawDispatchStamp: currentRawDispatchStamp,
      currentSessionStamp: currentSessionAnchorStamp,
      finalStamp: localStamp,
      flags,
      legacyStateBefore,
      legacyStateAfter: nextLegacyState,
      lastSentDestinyStamp: toInt(session._space.lastSentDestinyStamp, 0) >>> 0,
      lastSentDestinyRawDispatchStamp:
        toInt(session._space.lastSentDestinyRawDispatchStamp, 0) >>> 0,
    });
    updateDestinyAuthorityState(session, {
      lastPresentedStamp: toInt(session._space.lastSentDestinyStamp, 0) >>> 0,
      lastRawDispatchStamp:
        toInt(session._space.lastSentDestinyRawDispatchStamp, 0) >>> 0,
      lastSentWasOwnerCritical:
        session._space.lastSentDestinyWasOwnerCritical === true,
      lastSentOnlyStaleProjectedOwnerMissileLane:
        session._space.lastSentDestinyOnlyStaleProjectedOwnerMissileLane === true,
      lastFreshAcquireLifecycleStamp:
        nextLegacyState.lastFreshAcquireLifecycleStamp,
      lastMissileLifecycleStamp:
        nextLegacyState.lastMissileLifecycleStamp,
      lastOwnerMissileLifecycleStamp:
        nextLegacyState.lastOwnerMissileLifecycleStamp,
      lastOwnerMissileLifecycleAnchorStamp:
        nextLegacyState.lastOwnerMissileLifecycleAnchorStamp,
      lastOwnerMissileLifecycleRawDispatchStamp:
        nextLegacyState.lastOwnerMissileLifecycleRawDispatchStamp,
      lastOwnerMissileFreshAcquireStamp:
        nextLegacyState.lastOwnerMissileFreshAcquireStamp,
      lastOwnerMissileFreshAcquireAnchorStamp:
        nextLegacyState.lastOwnerMissileFreshAcquireAnchorStamp,
      lastOwnerMissileFreshAcquireRawDispatchStamp:
        nextLegacyState.lastOwnerMissileFreshAcquireRawDispatchStamp,
      lastOwnerNonMissileCriticalStamp:
        nextLegacyState.lastOwnerNonMissileCriticalStamp,
      lastOwnerNonMissileCriticalRawDispatchStamp:
        nextLegacyState.lastOwnerNonMissileCriticalRawDispatchStamp,
    });
    return nextLegacyState;
  }

  function completeGroupJourney(context = {}, details = {}) {
    const {
      journeyId,
      contract,
      authoritySessionBefore,
      rawSimTimeMs,
      currentRawDispatchStamp,
      originalUpdates,
    } = context;
    const authoritySessionAfter = updateDestinyAuthorityState(
      details.session,
      {
        lastJourneyId: journeyId,
        lastRawDispatchStamp: currentRawDispatchStamp,
        lastPresentedStamp: Math.max(
          toInt(
            authoritySessionBefore && authoritySessionBefore.lastPresentedStamp,
            0,
          ),
          toInt(details.finalStamp, 0),
        ),
        lastCriticalStamp:
          details.isCritical === true
            ? Math.max(
                toInt(
                  authoritySessionBefore && authoritySessionBefore.lastCriticalStamp,
                  0,
                ),
                toInt(details.finalStamp, 0),
              ) >>> 0
            : toInt(
                authoritySessionBefore && authoritySessionBefore.lastCriticalStamp,
                0,
              ) >>> 0,
        lastNonCriticalStamp:
          details.isCritical === true
            ? toInt(
                authoritySessionBefore && authoritySessionBefore.lastNonCriticalStamp,
                0,
              ) >>> 0
            : Math.max(
                toInt(
                  authoritySessionBefore && authoritySessionBefore.lastNonCriticalStamp,
                  0,
                ),
                toInt(details.finalStamp, 0),
              ) >>> 0,
        lastOwnerCommandStamp:
          contract === DESTINY_CONTRACTS.OWNER_PILOT_COMMAND
            ? Math.max(
                toInt(
                  authoritySessionBefore && authoritySessionBefore.lastOwnerCommandStamp,
                  0,
                ),
                toInt(details.finalStamp, 0),
              ) >>> 0
            : toInt(
                authoritySessionBefore && authoritySessionBefore.lastOwnerCommandStamp,
                0,
              ) >>> 0,
        lastOwnerCommandAnchorStamp:
          contract === DESTINY_CONTRACTS.OWNER_PILOT_COMMAND
            ? Math.max(
                toInt(
                  authoritySessionBefore &&
                    authoritySessionBefore.lastOwnerCommandAnchorStamp,
                  0,
                ),
                toInt(
                  details.currentSessionStamp,
                  authoritySessionBefore &&
                    authoritySessionBefore.lastOwnerCommandAnchorStamp,
                ),
              ) >>> 0
            : toInt(
                authoritySessionBefore &&
                  authoritySessionBefore.lastOwnerCommandAnchorStamp,
                0,
              ) >>> 0,
        lastOwnerCommandRawDispatchStamp:
          contract === DESTINY_CONTRACTS.OWNER_PILOT_COMMAND
            ? Math.max(
                toInt(
                  authoritySessionBefore &&
                    authoritySessionBefore.lastOwnerCommandRawDispatchStamp,
                  0,
                ),
                currentRawDispatchStamp,
              ) >>> 0
            : toInt(
                authoritySessionBefore &&
                  authoritySessionBefore.lastOwnerCommandRawDispatchStamp,
                0,
              ) >>> 0,
        lastBootstrapStamp:
          contract === DESTINY_CONTRACTS.BOOTSTRAP_ACQUIRE
          || details.isFreshAcquireLifecycleGroup === true
          ? Math.max(
              toInt(
                authoritySessionBefore && authoritySessionBefore.lastBootstrapStamp,
                0,
              ),
              toInt(details.finalStamp, 0),
            ) >>> 0
          : toInt(
              authoritySessionBefore && authoritySessionBefore.lastBootstrapStamp,
              0,
            ) >>> 0,
        lastFreshAcquireLifecycleStamp:
          details.isFreshAcquireLifecycleGroup === true
            ? Math.max(
                toInt(
                  authoritySessionBefore &&
                    authoritySessionBefore.lastFreshAcquireLifecycleStamp,
                  0,
                ),
                toInt(details.finalStamp, 0),
              ) >>> 0
            : toInt(
                authoritySessionBefore &&
                  authoritySessionBefore.lastFreshAcquireLifecycleStamp,
                0,
              ) >>> 0,
        lastMissileLifecycleStamp:
          contract === DESTINY_CONTRACTS.OWNER_MISSILE_LIFECYCLE ||
          contract === DESTINY_CONTRACTS.OBSERVER_MISSILE_LIFECYCLE ||
          details.isMissileLifecycleGroup === true
            ? Math.max(
                toInt(
                  authoritySessionBefore && authoritySessionBefore.lastMissileLifecycleStamp,
                  0,
                ),
                toInt(details.finalStamp, 0),
              ) >>> 0
            : toInt(
              authoritySessionBefore && authoritySessionBefore.lastMissileLifecycleStamp,
              0,
            ) >>> 0,
        lastOwnerMissileLifecycleStamp:
          contract === DESTINY_CONTRACTS.OWNER_MISSILE_LIFECYCLE
          || details.flags && details.flags.isOwnerMissileLifecycleGroup === true
            ? Math.max(
                toInt(
                  authoritySessionBefore &&
                    authoritySessionBefore.lastOwnerMissileLifecycleStamp,
                  0,
                ),
                toInt(details.finalStamp, 0),
              ) >>> 0
            : toInt(
                authoritySessionBefore &&
                  authoritySessionBefore.lastOwnerMissileLifecycleStamp,
                0,
              ) >>> 0,
        lastOwnerMissileLifecycleAnchorStamp:
          contract === DESTINY_CONTRACTS.OWNER_MISSILE_LIFECYCLE
          || details.flags && details.flags.isOwnerMissileLifecycleGroup === true
            ? Math.max(
                toInt(
                  authoritySessionBefore &&
                    authoritySessionBefore.lastOwnerMissileLifecycleAnchorStamp,
                  0,
                ),
                toInt(details.currentSessionStamp, 0),
              ) >>> 0
            : toInt(
                authoritySessionBefore &&
                  authoritySessionBefore.lastOwnerMissileLifecycleAnchorStamp,
                0,
              ) >>> 0,
        lastOwnerMissileLifecycleRawDispatchStamp:
          contract === DESTINY_CONTRACTS.OWNER_MISSILE_LIFECYCLE
          || details.flags && details.flags.isOwnerMissileLifecycleGroup === true
            ? Math.max(
                toInt(
                  authoritySessionBefore &&
                    authoritySessionBefore.lastOwnerMissileLifecycleRawDispatchStamp,
                  0,
                ),
                currentRawDispatchStamp,
              ) >>> 0
            : toInt(
                authoritySessionBefore &&
                  authoritySessionBefore.lastOwnerMissileLifecycleRawDispatchStamp,
                0,
              ) >>> 0,
        lastOwnerMissileFreshAcquireStamp:
          contract === DESTINY_CONTRACTS.OWNER_MISSILE_LIFECYCLE &&
          details.isFreshAcquireLifecycleGroup === true
            ? Math.max(
                toInt(
                  authoritySessionBefore &&
                    authoritySessionBefore.lastOwnerMissileFreshAcquireStamp,
                  0,
                ),
                toInt(details.finalStamp, 0),
              ) >>> 0
            : toInt(
                authoritySessionBefore &&
                  authoritySessionBefore.lastOwnerMissileFreshAcquireStamp,
                0,
              ) >>> 0,
        lastOwnerMissileFreshAcquireAnchorStamp:
          contract === DESTINY_CONTRACTS.OWNER_MISSILE_LIFECYCLE &&
          details.isFreshAcquireLifecycleGroup === true
            ? Math.max(
                toInt(
                  authoritySessionBefore &&
                    authoritySessionBefore.lastOwnerMissileFreshAcquireAnchorStamp,
                  0,
                ),
                toInt(details.currentSessionStamp, 0),
              ) >>> 0
            : toInt(
                authoritySessionBefore &&
                  authoritySessionBefore.lastOwnerMissileFreshAcquireAnchorStamp,
                0,
              ) >>> 0,
        lastOwnerMissileFreshAcquireRawDispatchStamp:
          contract === DESTINY_CONTRACTS.OWNER_MISSILE_LIFECYCLE &&
          details.isFreshAcquireLifecycleGroup === true
            ? Math.max(
                toInt(
                  authoritySessionBefore &&
                    authoritySessionBefore.lastOwnerMissileFreshAcquireRawDispatchStamp,
                  0,
                ),
                currentRawDispatchStamp,
              ) >>> 0
            : toInt(
                authoritySessionBefore &&
                  authoritySessionBefore.lastOwnerMissileFreshAcquireRawDispatchStamp,
                0,
              ) >>> 0,
        lastOwnerNonMissileCriticalStamp:
          details.flags && details.flags.isSetStateGroup === true
            ? Math.max(
                toInt(
                  authoritySessionBefore &&
                    authoritySessionBefore.lastOwnerNonMissileCriticalStamp,
                  0,
                ),
                toInt(details.finalStamp, 0),
              ) >>> 0
            : toInt(
                authoritySessionBefore &&
                  authoritySessionBefore.lastOwnerNonMissileCriticalStamp,
                0,
              ) >>> 0,
        lastOwnerNonMissileCriticalRawDispatchStamp:
          details.flags && details.flags.isSetStateGroup === true
            ? Math.max(
                toInt(
                  authoritySessionBefore &&
                    authoritySessionBefore.lastOwnerNonMissileCriticalRawDispatchStamp,
                  0,
                ),
                currentRawDispatchStamp,
              ) >>> 0
            : toInt(
                authoritySessionBefore &&
                  authoritySessionBefore.lastOwnerNonMissileCriticalRawDispatchStamp,
                0,
              ) >>> 0,
        lastSentWasOwnerCritical:
          details.flags && details.flags.isOwnerCriticalGroup === true
            ? true
            : (
                authoritySessionBefore &&
                authoritySessionBefore.lastSentWasOwnerCritical === true &&
                toInt(details.finalStamp, 0) < toInt(
                  authoritySessionBefore.lastPresentedStamp,
                  0,
                )
              ),
        lastSentOnlyStaleProjectedOwnerMissileLane: false,
        lastResetStamp:
          contract === DESTINY_CONTRACTS.STATE_RESET
            ? Math.max(
                toInt(
                  authoritySessionBefore && authoritySessionBefore.lastResetStamp,
                  0,
                ),
                toInt(details.finalStamp, 0),
              ) >>> 0
            : toInt(
                authoritySessionBefore && authoritySessionBefore.lastResetStamp,
                0,
              ) >>> 0,
      },
    );

    journeyLog.logJourney("destiny.authority.emit-group", {
      journeyId,
      contract,
      charID: details.session && details.session.characterID
        ? details.session.characterID
        : 0,
      shipID: details.session && details.session._space
        ? toInt(details.session._space.shipID, 0)
        : 0,
      rawDispatchStamp: currentRawDispatchStamp,
      rawSimTimeMs,
      originalStamp: toInt(details.originalStamp, 0) >>> 0,
      finalStamp: toInt(details.finalStamp, 0) >>> 0,
      isCritical: details.isCritical === true,
      restampSteps: Array.isArray(details.restampSteps)
        ? details.restampSteps
        : [],
      originalUpdates,
      emittedUpdates: summarizeMissileUpdatesForLog(details.updates),
      authoritySessionBefore,
      authoritySessionAfter,
      flags: details.flags || null,
    });

    const appliedRestampSteps = Array.isArray(details.restampSteps)
      ? details.restampSteps.filter((step) => step && step.applied === true)
      : [];
    if (appliedRestampSteps.length > 0) {
      journeyLog.logRestamp("destiny.authority.repaired-group", {
        journeyId,
        contract,
        charID: details.session && details.session.characterID
          ? details.session.characterID
          : 0,
        shipID: details.session && details.session._space
          ? toInt(details.session._space.shipID, 0)
          : 0,
        originalStamp: toInt(details.originalStamp, 0) >>> 0,
        finalStamp: toInt(details.finalStamp, 0) >>> 0,
        appliedRestampSteps,
      });
      const repairSummary = appliedRestampSteps
        .map((step) => `${step.reason}:${step.beforeStamp}->${step.afterStamp}`)
        .join(", ");
      log.info(
        `[DestinyAuthority] Repaired ${contract} for char ${details.session && details.session.characterID ? details.session.characterID : 0}: ${repairSummary}`,
      );
    }

    return authoritySessionAfter;
  }

  function rejectGroupJourney(context = {}, details = {}) {
    const {
      journeyId,
      contract,
      authoritySessionBefore,
      rawSimTimeMs,
      currentRawDispatchStamp,
      originalUpdates,
    } = context;
    const normalizedRestampSteps = Array.isArray(details.restampSteps)
      ? details.restampSteps
      : [];
    const decisionTree = buildDecisionTree(normalizedRestampSteps);
    const authoritySessionCurrent = snapshotDestinyAuthorityState(details.session);
    const rejection = {
      policy:
        typeof details.dropPolicy === "string" && details.dropPolicy
          ? details.dropPolicy
          : "backstep-behind-last-sent",
      reason: details.reason || "unsafe delivery",
      originalStamp: toInt(details.originalStamp, 0) >>> 0,
      attemptedStamp: toInt(details.attemptedStamp, 0) >>> 0,
      rawDispatchStamp: currentRawDispatchStamp,
      rawSimTimeMs,
    };
    journeyLog.logJourney("destiny.authority.reject-group", {
      journeyId,
      contract,
      charID: details.session && details.session.characterID
        ? details.session.characterID
        : 0,
      shipID: details.session && details.session._space
        ? toInt(details.session._space.shipID, 0)
        : 0,
      rawDispatchStamp: currentRawDispatchStamp,
      rawSimTimeMs,
      rejection,
      originalUpdates,
      authoritySessionBefore,
      authoritySessionCurrent,
      restampSteps: normalizedRestampSteps,
      decisionTree,
    });
    journeyLog.logRestamp("destiny.authority.reject-group", {
      journeyId,
      contract,
      charID: details.session && details.session.characterID
        ? details.session.characterID
        : 0,
      shipID: details.session && details.session._space
        ? toInt(details.session._space.shipID, 0)
        : 0,
      rejection,
      restampSteps: normalizedRestampSteps,
      decisionTree,
    });
    journeyLog.logDrop("destiny.authority.reject-group", {
      journeyId,
      contract,
      charID: details.session && details.session.characterID
        ? details.session.characterID
        : 0,
      shipID: details.session && details.session._space
        ? toInt(details.session._space.shipID, 0)
        : 0,
      rejection,
      authoritySessionBefore,
      authoritySessionCurrent,
      restampSteps: normalizedRestampSteps,
      decisionTree,
      originalUpdates,
      journeyTree: {
        contract,
        source: "destiny.authority.reject-group",
        authored: {
          originalStamp: rejection.originalStamp,
          updates: originalUpdates,
        },
        dispatch: {
          rawDispatchStamp: rejection.rawDispatchStamp,
          rawSimTimeMs: rejection.rawSimTimeMs,
        },
        evaluation: {
          attemptedStamp: rejection.attemptedStamp,
          decisionTree,
        },
        rejection,
      },
    });
    journeyLog.logEngine("destiny.authority.reject-group", {
      journeyId,
      contract,
      charID: details.session && details.session.characterID
        ? details.session.characterID
        : 0,
      shipID: details.session && details.session._space
        ? toInt(details.session._space.shipID, 0)
        : 0,
      rejection,
      decisionTree,
    });
    log.criticalAlert("DESTINY DROP", [
      { label: "Journey", value: journeyId },
      { label: "Contract", value: contract },
      {
        label: "Character",
        value: details.session && details.session.characterID
          ? details.session.characterID
          : 0,
      },
      {
        label: "Ship",
        value: details.session && details.session._space
          ? toInt(details.session._space.shipID, 0)
          : 0,
      },
      { label: "Raw", value: currentRawDispatchStamp },
      { label: "From", value: toInt(details.originalStamp, 0) >>> 0 },
      { label: "To", value: toInt(details.attemptedStamp, 0) >>> 0 },
      { label: "Reason", value: details.reason || "unsafe delivery" },
      { label: "Policy", value: rejection.policy || "unknown" },
      {
        label: "Drop Log",
        value: journeyLog.DESTINY_DROP_LOG_PATH,
      },
    ], {
      subtitle: "Unsafe Destiny send rejected before it could jolt Michelle",
    });
    log.warn(
      `[DestinyAuthority] Rejected ${contract} for char ${details.session && details.session.characterID ? details.session.characterID : 0}: ${details.reason || "unsafe delivery"}`,
    );
  }

  return {
    DESTINY_CONTRACTS,
    classifyEnvelope,
    getDestinyHistoryAnchorStampForSession,
    resolveDestinyDeliveryStampForSession,
    prepareDestinyUpdateForSession,
    beginGroupJourney,
    planGroupEmission,
    applyLegacySessionEmissionState,
    completeGroupJourney,
    rejectGroupJourney,
  };
}

module.exports = {
  createDestinyAuthority,
};
