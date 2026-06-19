const {
  createDestinyAuthority,
} = require("../authority/destinyAuthority");
const {
  snapshotDestinyAuthorityState,
  updateDestinyAuthorityState,
} = require("../authority/destinySessionState");
const {
  DESTINY_CONTRACTS,
} = require("../authority/destinyContracts");
const {
  extractEntityIDsFromPayload,
  recordSyncLedgerEvent,
  summarizeDestinyUpdates,
} = require("../../../network/syncLedger");

function createMovementDestinyDispatch(deps = {}) {
  const {
    buildMissileSessionMutation,
    buildMissileSessionSnapshot,
    clamp,
    destiny,
    getPayloadPrimaryEntityID,
    getNextMissileDebugTraceID,
    isMovementContractPayload,
    isReadyForDestiny,
    logDestinyDispatch,
    logMissileDebug,
    normalizeTraceValue,
    resolveDestinyLifecycleRestampState,
    resolveOwnerMonotonicState,
    resolvePreviousLastSentDestinyWasOwnerCritical,
    roundNumber,
    shouldLogMissilePayloadGroup,
    summarizeMissileUpdatesForLog,
    toInt,
    updatesContainMovementContractPayload,
    MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
    MICHELLE_HELD_FUTURE_DESTINY_LEAD,
    MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD,
    PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
  } = deps;
  const OBSERVER_DIRECT_PRESENTED_MONOTONIC_PAYLOAD_NAMES = new Set([
    "AddBalls2",
    "RemoveBalls",
    "GotoDirection",
    "GotoPoint",
    "Orbit",
    "FollowBall",
    "Stop",
    "WarpTo",
    "SetBallAgility",
    "SetBallMass",
    "SetMaxSpeed",
    "SetBallMassive",
    "SetSpeedFraction",
    "SetBallPosition",
    "SetBallVelocity",
  ]);
  const destinyAuthority = createDestinyAuthority({
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
  });

  function updatesContainObserverPresentedMonotonicPayload(
    updates,
    ownerShipID = 0,
  ) {
    return Array.isArray(updates) && updates.some((update) => {
      const payload = update && Array.isArray(update.payload)
        ? update.payload
        : null;
      if (!payload) {
        return false;
      }
      const payloadName = typeof payload[0] === "string"
        ? payload[0]
        : "";
      if (!OBSERVER_DIRECT_PRESENTED_MONOTONIC_PAYLOAD_NAMES.has(payloadName)) {
        return false;
      }
      const primaryEntityID = getPayloadPrimaryEntityID(payload) >>> 0;
      return ownerShipID <= 0 || primaryEntityID <= 0 || primaryEntityID !== ownerShipID;
    });
  }

  function getDestinyHistoryAnchorStampForSession(
    runtime,
    session,
    rawSimTimeMs = runtime.getCurrentSimTimeMs(),
    options = {},
  ) {
    return destinyAuthority.getDestinyHistoryAnchorStampForSession(
      runtime,
      session,
      rawSimTimeMs,
      options,
    );
  }

  function resolveDestinyDeliveryStampForSession(
    runtime,
    session,
    authoredStamp,
    rawSimTimeMs = runtime.getCurrentSimTimeMs(),
    options = {},
  ) {
    return destinyAuthority.resolveDestinyDeliveryStampForSession(
      runtime,
      session,
      authoredStamp,
      rawSimTimeMs,
      options,
    );
  }

  function prepareDestinyUpdateForSession(
    runtime,
    session,
    rawPayload,
    rawSimTimeMs = runtime.getCurrentSimTimeMs(),
    options = {},
  ) {
    return destinyAuthority.prepareDestinyUpdateForSession(
      runtime,
      session,
      rawPayload,
      rawSimTimeMs,
      options,
    );
  }

  function beginTickDestinyPresentationBatch(runtime) {
    flushDirectDestinyNotificationBatch(runtime);
    runtime._tickDestinyPresentation = {
      nextOrder: 0,
      bySession: new Map(),
    };
  }

  function hasActiveTickDestinyPresentationBatch(runtime) {
    return Boolean(
      runtime._tickDestinyPresentation &&
      runtime._tickDestinyPresentation.bySession instanceof Map,
    );
  }

  function shouldDeferPilotMovementForMissilePressure(
    runtime,
    session,
    nowMs = runtime.getCurrentSimTimeMs(),
  ) {
    if (!session || !session._space || !isReadyForDestiny(session)) {
      return false;
    }

    const authorityState = snapshotDestinyAuthorityState(session);
    const currentSessionStamp = runtime.getCurrentSessionDestinyStamp(
      session,
      nowMs,
    );
    const currentVisibleStamp = runtime.getCurrentVisibleSessionDestinyStamp(
      session,
      nowMs,
    );
    const currentRawDispatchStamp = runtime.getCurrentDestinyStamp(nowMs);
    const lastSentDestinyStamp = toInt(
      authorityState && authorityState.lastPresentedStamp,
      toInt(session._space.lastSentDestinyStamp, 0) >>> 0,
    ) >>> 0;
    const lastSentDestinyRawDispatchStamp = toInt(
      authorityState && authorityState.lastRawDispatchStamp,
      toInt(session._space.lastSentDestinyRawDispatchStamp, 0) >>> 0,
    ) >>> 0;
    const maximumTrustedMissilePressureLane = Math.max(
      currentVisibleStamp,
      lastSentDestinyStamp,
      (
        currentSessionStamp +
        PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS
      ) >>> 0,
    ) >>> 0;
    const lastMissileLifecycleStamp = toInt(
      authorityState && authorityState.lastMissileLifecycleStamp,
      toInt(session._space.lastMissileLifecycleStamp, 0) >>> 0,
    ) >>> 0;
    const lastMissileLifecycleRawDispatchStamp = toInt(
      authorityState && authorityState.lastRawDispatchStamp,
      toInt(session._space.lastMissileLifecycleRawDispatchStamp, 0) >>> 0,
    ) >>> 0;
    const lastOwnerMissileLifecycleStamp = toInt(
      authorityState && authorityState.lastOwnerMissileLifecycleStamp,
      toInt(session._space.lastOwnerMissileLifecycleStamp, 0) >>> 0,
    ) >>> 0;
    const lastOwnerMissileLifecycleRawDispatchStamp = toInt(
      authorityState && authorityState.lastOwnerMissileLifecycleRawDispatchStamp,
      toInt(session._space.lastOwnerMissileLifecycleRawDispatchStamp, 0) >>> 0,
    ) >>> 0;

    const hasRecentVisibleMissileLifecycle =
      lastMissileLifecycleStamp > currentSessionStamp &&
      lastMissileLifecycleStamp <= maximumTrustedMissilePressureLane &&
      lastMissileLifecycleRawDispatchStamp > 0 &&
      currentRawDispatchStamp >= lastMissileLifecycleRawDispatchStamp &&
      (
        currentRawDispatchStamp - lastMissileLifecycleRawDispatchStamp
      ) <= 2;
    const hasRecentOwnerMissileLifecycle =
      lastOwnerMissileLifecycleStamp > currentSessionStamp &&
      lastOwnerMissileLifecycleStamp <= maximumTrustedMissilePressureLane &&
      lastOwnerMissileLifecycleRawDispatchStamp > 0 &&
      currentRawDispatchStamp >= lastOwnerMissileLifecycleRawDispatchStamp &&
      (
        currentRawDispatchStamp - lastOwnerMissileLifecycleRawDispatchStamp
      ) <= 2;

    return hasRecentVisibleMissileLifecycle || hasRecentOwnerMissileLifecycle;
  }

  function normalizeQueuedPresentationSendOptions(sendOptions) {
    const normalized = {
      translateStamps: false,
    };
    if (!sendOptions || typeof sendOptions !== "object") {
      return normalized;
    }
    for (const key of Object.keys(sendOptions)) {
      const value = sendOptions[key];
      if (value !== undefined) {
        normalized[key] = value;
      }
    }
    normalized.translateStamps = false;
    return normalized;
  }

  function buildQueuedPresentationSendOptionsSignature(sendOptions) {
    const normalized = normalizeQueuedPresentationSendOptions(sendOptions);
    return JSON.stringify(
      Object.keys(normalized)
        .sort()
        .map((key) => [key, normalized[key]]),
    );
  }

  function appendCollectedDestinyGroup(collectedGroups, groupDetails = {}) {
    if (!Array.isArray(collectedGroups) || !groupDetails) {
      return;
    }
    collectedGroups.push({
      stamp: toInt(groupDetails.stamp, 0) >>> 0,
      waitForBubble: groupDetails.waitForBubble === true,
      order: Math.max(0, toInt(groupDetails.order, collectedGroups.length)),
      updates: Array.isArray(groupDetails.updates)
        ? groupDetails.updates
        : [],
      contract:
        typeof groupDetails.contract === "string"
          ? groupDetails.contract
          : "",
    });
  }

  function canFlushInitialBallparkBootstrapGroups(session, collectedGroups) {
    if (
      !session ||
      !session._space ||
      session._space.initialBallparkBootstrapInProgress !== true ||
      !Array.isArray(collectedGroups) ||
      collectedGroups.length === 0
    ) {
      return false;
    }
    return collectedGroups.every((group) => (
      group &&
      (
        group.contract === DESTINY_CONTRACTS.BOOTSTRAP_ACQUIRE ||
        group.contract === DESTINY_CONTRACTS.STATE_RESET
      )
    ));
  }

  function recordDestinyLedger(session, event, details = {}) {
    return recordSyncLedgerEvent(session, event, {
      kind: "destiny",
      ...details,
    });
  }

  function ensureDestinyLifecycleLedger(session) {
    if (!session || typeof session !== "object") {
      return null;
    }
    if (!session._syncLedgerDestinyLifecycle) {
      session._syncLedgerDestinyLifecycle = {
        lastNotificationStamp: 0,
        addStampByEntityID: new Map(),
      };
    }
    return session._syncLedgerDestinyLifecycle;
  }

  function validateDestinyNotificationGroup(
    session,
    groupStamp,
    updates,
    context = {},
  ) {
    const lifecycle = ensureDestinyLifecycleLedger(session);
    const normalizedGroupStamp = toInt(groupStamp, 0) >>> 0;
    const updateStamps = [...new Set(
      (Array.isArray(updates) ? updates : [])
        .map((update) => toInt(update && update.stamp, 0) >>> 0),
    )];
    const violations = [];

    if (updateStamps.length > 1) {
      violations.push({
        rule: "single-destiny-stamp-per-notification",
        stamps: updateStamps,
      });
    }
    if (updateStamps.length === 1 && updateStamps[0] !== normalizedGroupStamp) {
      violations.push({
        rule: "group-stamp-matches-update-stamp",
        groupStamp: normalizedGroupStamp,
        updateStamp: updateStamps[0],
      });
    }
    if (
      lifecycle &&
      lifecycle.lastNotificationStamp > 0 &&
      normalizedGroupStamp < lifecycle.lastNotificationStamp
    ) {
      violations.push({
        rule: "monotonic-destiny-notification-stamp",
        previousStamp: lifecycle.lastNotificationStamp,
        groupStamp: normalizedGroupStamp,
      });
    }

    for (const update of Array.isArray(updates) ? updates : []) {
      const payload = update && Array.isArray(update.payload)
        ? update.payload
        : null;
      if (!payload || typeof payload[0] !== "string") {
        continue;
      }
      const payloadName = payload[0];
      const entityIDs = extractEntityIDsFromPayload(payload);
      if (payloadName === "SetState" && lifecycle) {
        lifecycle.addStampByEntityID.clear();
      }
      if (payloadName === "AddBalls2" && lifecycle) {
        for (const entityID of entityIDs) {
          lifecycle.addStampByEntityID.set(
            toInt(entityID, 0) >>> 0,
            normalizedGroupStamp,
          );
        }
      }
      if (payloadName === "RemoveBalls" && lifecycle) {
        for (const entityID of entityIDs) {
          const normalizedEntityID = toInt(entityID, 0) >>> 0;
          const lastAddStamp = toInt(
            lifecycle.addStampByEntityID.get(normalizedEntityID),
            0,
          ) >>> 0;
          if (lastAddStamp > 0 && normalizedGroupStamp <= lastAddStamp) {
            violations.push({
              rule: "remove-after-addballs",
              entityID: normalizedEntityID,
              addStamp: lastAddStamp,
              removeStamp: normalizedGroupStamp,
            });
          }
          lifecycle.addStampByEntityID.delete(normalizedEntityID);
        }
      }
    }

    if (lifecycle) {
      lifecycle.lastNotificationStamp = Math.max(
        lifecycle.lastNotificationStamp,
        normalizedGroupStamp,
      ) >>> 0;
    }

    if (violations.length > 0) {
      recordDestinyLedger(session, "destiny.invariant.violation", {
        ...context,
        stamp: normalizedGroupStamp,
        violations,
        updates: summarizeDestinyUpdates(updates),
      });
    }

    return violations;
  }

  function flushCollectedDestinyGroups(runtime, session, collectedGroups) {
    if (
      !session ||
      (
        !isReadyForDestiny(session) &&
        !canFlushInitialBallparkBootstrapGroups(session, collectedGroups)
      ) ||
      !Array.isArray(collectedGroups) ||
      collectedGroups.length === 0
    ) {
      return 0;
    }

    const orderedGroups = collectedGroups
      .filter((group) => (
        group &&
        Array.isArray(group.updates) &&
        group.updates.length > 0
      ))
      .sort((left, right) => {
        const leftStamp = toInt(left && left.stamp, 0) >>> 0;
        const rightStamp = toInt(right && right.stamp, 0) >>> 0;
        if (leftStamp !== rightStamp) {
          return leftStamp - rightStamp;
        }
        return toInt(left && left.order, 0) - toInt(right && right.order, 0);
      });
    if (orderedGroups.length === 0) {
      return 0;
    }

    let currentStamp = null;
    let currentWaitForBubble = false;
    let currentUpdates = [];
    let currentGroupContainsSetState = false;
    let highestStamp = 0;
    const groupContainsSetState = (group) => Array.isArray(group && group.updates) && group.updates.some(
      (update) => (
        update &&
        Array.isArray(update.payload) &&
        update.payload[0] === "SetState"
      ),
    );
    const flushMergedGroup = () => {
      if (currentUpdates.length === 0 || currentStamp === null) {
        return;
      }
      const updateSummary = summarizeDestinyUpdates(currentUpdates);
      const violations = validateDestinyNotificationGroup(
        session,
        currentStamp,
        currentUpdates,
        {
          waitForBubble: currentWaitForBubble,
          containsSetState: currentGroupContainsSetState,
          phase: "flush-collected",
        },
      );
      recordDestinyLedger(session, "destiny.group.flushed", {
        stamp: toInt(currentStamp, 0) >>> 0,
        waitForBubble: currentWaitForBubble,
        containsSetState: currentGroupContainsSetState,
        violationCount: violations.length,
        updates: updateSummary,
      });
      logDestinyDispatch(session, currentUpdates, currentWaitForBubble);
      session.sendNotification(
        "DoDestinyUpdate",
        "clientID",
        destiny.buildDestinyUpdatePayload(currentUpdates, currentWaitForBubble),
      );
      highestStamp = Math.max(highestStamp, toInt(currentStamp, 0) >>> 0) >>> 0;
      currentStamp = null;
      currentWaitForBubble = false;
      currentUpdates = [];
      currentGroupContainsSetState = false;
    };

    for (const group of orderedGroups) {
      const groupStamp = toInt(group && group.stamp, 0) >>> 0;
      const groupWaitForBubble = group && group.waitForBubble === true;
      const nextGroupContainsSetState = groupContainsSetState(group);
      if (
        currentUpdates.length > 0 &&
        (
          groupStamp !== (toInt(currentStamp, 0) >>> 0) ||
          groupWaitForBubble !== currentWaitForBubble ||
          currentGroupContainsSetState === true ||
          nextGroupContainsSetState === true
        )
      ) {
        flushMergedGroup();
      }
      if (currentUpdates.length === 0) {
        currentStamp = groupStamp;
        currentWaitForBubble = groupWaitForBubble;
        currentGroupContainsSetState = nextGroupContainsSetState;
      }
      currentUpdates.push(...group.updates);
    }

    flushMergedGroup();
    return highestStamp >>> 0;
  }

  function queueCollectedDestinyGroupsForDirectFlush(
    runtime,
    session,
    collectedGroups,
  ) {
    if (
      !runtime ||
      !session ||
      !Array.isArray(collectedGroups) ||
      collectedGroups.length === 0
    ) {
      return 0;
    }

    const orderedGroups = collectedGroups
      .filter((group) => (
        group &&
        Array.isArray(group.updates) &&
        group.updates.length > 0
      ))
      .sort((left, right) => {
        const leftStamp = toInt(left && left.stamp, 0) >>> 0;
        const rightStamp = toInt(right && right.stamp, 0) >>> 0;
        if (leftStamp !== rightStamp) {
          return leftStamp - rightStamp;
        }
        return toInt(left && left.order, 0) - toInt(right && right.order, 0);
      });
    if (orderedGroups.length === 0) {
      return 0;
    }

    let queuedCount = 0;
    for (const group of orderedGroups) {
      queuedCount += queueDirectDestinyNotificationGroup(runtime, session, {
        stamp: group.stamp,
        waitForBubble: group.waitForBubble === true,
        updates: group.updates,
        contract: group.contract,
      });
    }

    return queuedCount;
  }

  function getDirectDestinyNotificationBatch(runtime) {
    if (
      runtime &&
      runtime._directDestinyNotificationBatch &&
      runtime._directDestinyNotificationBatch.bySession instanceof Map
    ) {
      return runtime._directDestinyNotificationBatch;
    }

    const batch = {
      bySession: new Map(),
      nextOrder: 0,
      rawDispatchStamp: 0,
      scheduled: false,
    };
    runtime._directDestinyNotificationBatch = batch;
    return batch;
  }

  function scheduleDirectDestinyNotificationFlush(runtime, batch) {
    if (!runtime || !batch || batch.scheduled === true) {
      return;
    }

    batch.scheduled = true;
    const scheduleFlush =
      typeof queueMicrotask === "function"
        ? queueMicrotask
        : (callback) => Promise.resolve().then(callback);
    scheduleFlush(() => {
      if (runtime._directDestinyNotificationBatch !== batch) {
        return;
      }
      flushDirectDestinyNotificationBatch(runtime);
    });
  }

  function queueDirectDestinyNotificationGroup(
    runtime,
    session,
    groupDetails = {},
  ) {
    if (
      !runtime ||
      !session ||
      !Array.isArray(groupDetails.updates) ||
      groupDetails.updates.length <= 0
    ) {
      return 0;
    }

    const groupRawDispatchStamp = toInt(
      groupDetails.rawDispatchStamp,
      0,
    ) >>> 0;
    let batch = runtime._directDestinyNotificationBatch;
    if (
      batch &&
      batch.bySession instanceof Map &&
      batch.rawDispatchStamp > 0 &&
      groupRawDispatchStamp > 0 &&
      groupRawDispatchStamp !== batch.rawDispatchStamp
    ) {
      flushDirectDestinyNotificationBatch(runtime);
      batch = null;
    }

    batch = batch || getDirectDestinyNotificationBatch(runtime);
    if (groupRawDispatchStamp > 0) {
      batch.rawDispatchStamp = groupRawDispatchStamp;
    }

    const sessionKey = `${toInt(session.clientID, 0)}`;
    let queued = batch.bySession.get(sessionKey);
    if (!queued) {
      queued = {
        session,
        groups: [],
      };
      batch.bySession.set(sessionKey, queued);
    }
    appendCollectedDestinyGroup(queued.groups, {
      stamp: groupDetails.stamp,
      waitForBubble: groupDetails.waitForBubble === true,
      order: batch.nextOrder++,
      updates: groupDetails.updates,
      contract: groupDetails.contract,
    });
    recordDestinyLedger(session, "destiny.group.queued", {
      stamp: toInt(groupDetails.stamp, 0) >>> 0,
      waitForBubble: groupDetails.waitForBubble === true,
      contract:
        typeof groupDetails.contract === "string"
          ? groupDetails.contract
          : "",
      rawDispatchStamp: groupRawDispatchStamp,
      queueSize: queued.groups.length,
      updates: summarizeDestinyUpdates(groupDetails.updates),
    });
    scheduleDirectDestinyNotificationFlush(runtime, batch);
    return queued.groups.length;
  }

  function flushDirectDestinyNotificationBatch(runtime) {
    if (
      !runtime ||
      !runtime._directDestinyNotificationBatch ||
      !(runtime._directDestinyNotificationBatch.bySession instanceof Map)
    ) {
      return 0;
    }

    const batch = runtime._directDestinyNotificationBatch;
    runtime._directDestinyNotificationBatch = null;

    let highestFlushedStamp = 0;
    for (const queued of batch.bySession.values()) {
      if (
        !queued ||
        !queued.session ||
        !Array.isArray(queued.groups) ||
        queued.groups.length <= 0
      ) {
        continue;
      }
      highestFlushedStamp = Math.max(
        highestFlushedStamp,
        flushCollectedDestinyGroups(runtime, queued.session, queued.groups),
      ) >>> 0;
    }
    return highestFlushedStamp >>> 0;
  }

  function isFreshAcquireLifecycleUpdate(update) {
    return Boolean(update && update.freshAcquireLifecycleGroup === true);
  }

  function shouldSplitMixedFreshAcquirePayloads(payloads, options = {}) {
    return (
      options &&
      options.preservePayloadStateStamp === true &&
      Array.isArray(payloads) &&
      payloads.some((update) => isFreshAcquireLifecycleUpdate(update)) &&
      payloads.some((update) => !isFreshAcquireLifecycleUpdate(update))
    );
  }

  function buildNonFreshMixedPayloadSendOptions(baseOptions = {}) {
    const nextOptions = {
      ...(baseOptions && typeof baseOptions === "object" ? baseOptions : {}),
    };
    delete nextOptions.preservePayloadStateStamp;
    delete nextOptions.skipOwnerMonotonicRestamp;
    delete nextOptions.skipOwnerMonotonicRestampWhenPreviousNotOwnerCritical;
    delete nextOptions.avoidCurrentHistoryInsertion;
    delete nextOptions.minimumLeadFromCurrentHistory;
    delete nextOptions.maximumLeadFromCurrentHistory;
    delete nextOptions.maximumHistorySafeLeadOverride;
    delete nextOptions.historyLeadUsesCurrentSessionStamp;
    delete nextOptions.historyLeadUsesImmediateSessionStamp;
    delete nextOptions.historyLeadUsesPresentedSessionStamp;
    delete nextOptions.historyLeadPresentedMaximumFutureLead;
    return nextOptions;
  }

  function splitContiguousFreshAcquirePayloadGroups(payloads = []) {
    const groups = [];
    let currentGroup = [];
    let currentFreshAcquireState = null;

    for (const payload of Array.isArray(payloads) ? payloads : []) {
      const isFreshAcquire = isFreshAcquireLifecycleUpdate(payload);
      if (
        currentGroup.length > 0 &&
        currentFreshAcquireState !== isFreshAcquire
      ) {
        groups.push({
          isFreshAcquire: currentFreshAcquireState,
          updates: currentGroup,
        });
        currentGroup = [];
      }
      if (currentGroup.length === 0) {
        currentFreshAcquireState = isFreshAcquire;
      }
      currentGroup.push(payload);
    }

    if (currentGroup.length > 0) {
      groups.push({
        isFreshAcquire: currentFreshAcquireState,
        updates: currentGroup,
      });
    }

    return groups;
  }

  function queueTickDestinyPresentationUpdates(
    runtime,
    session,
    updates,
    options = {},
  ) {
    if (
      !session ||
      !isReadyForDestiny(session) ||
      !Array.isArray(updates) ||
      updates.length === 0
    ) {
      return 0;
    }

    const queuedSendOptions =
      options &&
      options.sendOptions &&
      typeof options.sendOptions === "object"
        ? options.sendOptions
        : null;
    const normalizedQueuedSendOptions =
      normalizeQueuedPresentationSendOptions(queuedSendOptions);

    if (!runtime.hasActiveTickDestinyPresentationBatch()) {
      runtime.sendDestinyUpdates(session, updates, false, {
        ...normalizedQueuedSendOptions,
      });
      return updates.length;
    }

    const batch = runtime._tickDestinyPresentation;
    const sessionKey = `${toInt(session.clientID, 0)}`;
    let queued = batch.bySession.get(sessionKey);
    if (!queued) {
      queued = {
        session,
        updates: [],
        dedupeIndexes: new Map(),
      };
      batch.bySession.set(sessionKey, queued);
    }

    const getDedupeKey =
      typeof options.getDedupeKey === "function"
        ? options.getDedupeKey
        : null;

    for (const update of updates) {
      if (!update || !Number.isFinite(Number(update.stamp))) {
        continue;
      }
      const dedupeKey = getDedupeKey ? getDedupeKey(update) : null;
      const queuedEntry = {
        update,
        order: batch.nextOrder++,
        sendOptions: normalizedQueuedSendOptions,
      };
      if (dedupeKey && queued.dedupeIndexes.has(dedupeKey)) {
        const existingIndex = queued.dedupeIndexes.get(dedupeKey);
        queuedEntry.order = queued.updates[existingIndex].order;
        queued.updates[existingIndex] = queuedEntry;
        continue;
      }
      if (dedupeKey) {
        queued.dedupeIndexes.set(dedupeKey, queued.updates.length);
      }
      queued.updates.push(queuedEntry);
    }

    if (shouldLogMissilePayloadGroup(updates)) {
      logMissileDebug("destiny.presentation-queue", {
        rawSimTimeMs: roundNumber(runtime.getCurrentSimTimeMs(), 3),
        session: buildMissileSessionSnapshot(runtime, session),
        queuedCount: queued.updates.length,
        sendOptions: normalizeTraceValue(normalizedQueuedSendOptions),
        updates: summarizeMissileUpdatesForLog(updates),
      });
    }

    updateDestinyAuthorityState(session, {
      heldQueueState: {
        active: true,
        queuedCount: queued.updates.length,
        lastQueueStamp: queued.updates.reduce(
          (highest, entry) => Math.max(
            highest,
            toInt(entry && entry.update && entry.update.stamp, 0) >>> 0,
          ) >>> 0,
          0,
        ),
      },
    });

    return updates.length;
  }

  function flushTickDestinyPresentationBatch(runtime) {
    if (!runtime.hasActiveTickDestinyPresentationBatch()) {
      return;
    }

    const batch = runtime._tickDestinyPresentation;
    runtime._tickDestinyPresentation = null;

    for (const queued of batch.bySession.values()) {
      if (
        !queued ||
        !queued.session ||
        !isReadyForDestiny(queued.session) ||
        !Array.isArray(queued.updates) ||
        queued.updates.length === 0
      ) {
        if (queued && queued.session) {
          updateDestinyAuthorityState(queued.session, {
            heldQueueState: {
              active: false,
              queuedCount: 0,
              lastQueueStamp: 0,
            },
          });
        }
        continue;
      }

      const orderedEntries = queued.updates
        .slice()
        .sort((left, right) => {
          const leftStamp = toInt(left && left.update && left.update.stamp, 0) >>> 0;
          const rightStamp = toInt(right && right.update && right.update.stamp, 0) >>> 0;
          if (leftStamp !== rightStamp) {
            return leftStamp - rightStamp;
          }
          return toInt(left && left.order, 0) - toInt(right && right.order, 0);
        });
      if (orderedEntries.length <= 0) {
        updateDestinyAuthorityState(queued.session, {
          heldQueueState: {
            active: false,
            queuedCount: 0,
            lastQueueStamp: 0,
          },
        });
        continue;
      }

      let currentGroupUpdates = [];
      let currentGroupSendOptions = null;
      let currentGroupSignature = "";
      const collectedGroups = [];
      let collectedGroupOrder = 0;
      const flushQueuedGroup = () => {
        if (currentGroupUpdates.length <= 0) {
          return;
        }
        if (shouldLogMissilePayloadGroup(currentGroupUpdates)) {
          logMissileDebug("destiny.presentation-flush", {
            rawSimTimeMs: roundNumber(runtime.getCurrentSimTimeMs(), 3),
            session: buildMissileSessionSnapshot(runtime, queued.session),
            sendOptions: normalizeTraceValue(currentGroupSendOptions),
            updates: summarizeMissileUpdatesForLog(currentGroupUpdates),
          });
        }
        runtime.sendDestinyUpdates(queued.session, currentGroupUpdates, false, {
          ...currentGroupSendOptions,
          _collectNotificationGroups: collectedGroups,
          _collectNotificationOrder: collectedGroupOrder++,
        });
      };

      for (const entry of orderedEntries) {
        const update = entry && entry.update;
        if (!update) {
          continue;
        }
        const entrySendOptions = normalizeQueuedPresentationSendOptions(
          entry && entry.sendOptions,
        );
        const entrySignature =
          buildQueuedPresentationSendOptionsSignature(entrySendOptions);
        if (
          currentGroupUpdates.length > 0 &&
          entrySignature !== currentGroupSignature
        ) {
          flushQueuedGroup();
          currentGroupUpdates = [];
          currentGroupSendOptions = null;
          currentGroupSignature = "";
        }
        if (currentGroupUpdates.length <= 0) {
          currentGroupSendOptions = entrySendOptions;
          currentGroupSignature = entrySignature;
        }
        currentGroupUpdates.push(update);
      }

      flushQueuedGroup();
      queueCollectedDestinyGroupsForDirectFlush(
        runtime,
        queued.session,
        collectedGroups,
      );
      updateDestinyAuthorityState(queued.session, {
        heldQueueState: {
          active: false,
          queuedCount: 0,
          lastQueueStamp: 0,
        },
      });
    }

    flushDirectDestinyNotificationBatch(runtime);
  }

  function sendDestinyUpdates(
    runtime,
    session,
    payloads,
    waitForBubble = false,
    options = {},
  ) {
    if (!session || payloads.length === 0) {
      return 0;
    }

    runtime.refreshSessionClockSnapshot(session);
    const rawSimTimeMs = runtime.getCurrentSimTimeMs();
    const currentRawDispatchStamp = runtime.getCurrentDestinyStamp(rawSimTimeMs);
    const shouldTraceMissileDispatch =
      shouldLogMissilePayloadGroup(payloads) ||
      payloads.some((payload) => (
        payload &&
        Array.isArray(payload.payload) &&
        payload.payload[0] === "SetState"
      )) ||
      typeof options.missileDebugReason === "string";
    const destinyCallTraceID = shouldTraceMissileDispatch
      ? getNextMissileDebugTraceID()
      : 0;
    const sessionBeforeSend = shouldTraceMissileDispatch
      ? buildMissileSessionSnapshot(runtime, session, rawSimTimeMs)
      : null;

    if (shouldSplitMixedFreshAcquirePayloads(payloads, options)) {
      const payloadGroups = splitContiguousFreshAcquirePayloadGroups(payloads);
      if (shouldTraceMissileDispatch) {
        logMissileDebug("destiny.split-mixed-fresh-acquire-batch", {
          rawDispatchStamp: currentRawDispatchStamp,
          rawSimTimeMs: roundNumber(rawSimTimeMs, 3),
          waitForBubble,
          session: sessionBeforeSend,
          sendOptions: normalizeTraceValue(options),
          groups: payloadGroups.map((group) => ({
            isFreshAcquire: group.isFreshAcquire,
            updateCount: group.updates.length,
            updates: summarizeMissileUpdatesForLog(group.updates),
          })),
        });
      }
      let highestEmittedGroupStamp = 0;
      let allowWaitForBubble = waitForBubble;
      for (const group of payloadGroups) {
        if (!group || !Array.isArray(group.updates) || group.updates.length === 0) {
          continue;
        }
        const groupOptions = group.isFreshAcquire
          ? options
          : buildNonFreshMixedPayloadSendOptions(options);
        const emittedStamp = sendDestinyUpdates(
          runtime,
          session,
          group.updates,
          allowWaitForBubble,
          groupOptions,
        );
        highestEmittedGroupStamp = Math.max(
          highestEmittedGroupStamp,
          toInt(emittedStamp, 0) >>> 0,
        ) >>> 0;
        allowWaitForBubble = false;
      }
      return highestEmittedGroupStamp >>> 0;
    }

    if (shouldTraceMissileDispatch) {
      logMissileDebug("destiny.send-request", {
        destinyCallTraceID,
        rawDispatchStamp: currentRawDispatchStamp,
        rawSimTimeMs: roundNumber(rawSimTimeMs, 3),
        waitForBubble,
        sendReason:
          typeof options.missileDebugReason === "string"
            ? options.missileDebugReason
            : null,
        session: sessionBeforeSend,
        payloads: summarizeMissileUpdatesForLog(payloads),
      });
    }
    let groupedUpdates = [];
    let currentStamp = null;
    let firstGroup = true;
    let highestEmittedStamp = 0;
    const emittedGroupSummaries = [];
    const collectNotificationGroups = Array.isArray(
      options && options._collectNotificationGroups,
    )
      ? options._collectNotificationGroups
      : null;
    const collectNotificationBaseOrder = Math.max(
      0,
      toInt(options && options._collectNotificationOrder, 0),
    );
    let emittedGroupOrder = 0;
    const authorityStateBeforeSend = snapshotDestinyAuthorityState(session);
    let lastFreshAcquireLifecycleStamp = toInt(
      authorityStateBeforeSend && authorityStateBeforeSend.lastFreshAcquireLifecycleStamp,
      toInt(
        session &&
        session._space &&
        session._space.lastFreshAcquireLifecycleStamp,
        0,
      ) >>> 0,
    ) >>> 0;
    let lastMissileLifecycleStamp = toInt(
      authorityStateBeforeSend && authorityStateBeforeSend.lastMissileLifecycleStamp,
      toInt(
        session &&
        session._space &&
        session._space.lastMissileLifecycleStamp,
        0,
      ) >>> 0,
    ) >>> 0;
    let lastOwnerMissileLifecycleStamp = toInt(
      authorityStateBeforeSend && authorityStateBeforeSend.lastOwnerMissileLifecycleStamp,
      toInt(
        session &&
        session._space &&
        session._space.lastOwnerMissileLifecycleStamp,
        0,
      ) >>> 0,
    ) >>> 0;
    let lastOwnerMissileLifecycleAnchorStamp = toInt(
      authorityStateBeforeSend && authorityStateBeforeSend.lastOwnerMissileLifecycleAnchorStamp,
      toInt(
        session &&
        session._space &&
        session._space.lastOwnerMissileLifecycleAnchorStamp,
        0,
      ) >>> 0,
    ) >>> 0;
    let lastOwnerMissileFreshAcquireStamp = toInt(
      authorityStateBeforeSend && authorityStateBeforeSend.lastOwnerMissileFreshAcquireStamp,
      toInt(
        session &&
        session._space &&
        session._space.lastOwnerMissileFreshAcquireStamp,
        0,
      ) >>> 0,
    ) >>> 0;
    let lastOwnerMissileFreshAcquireAnchorStamp = toInt(
      authorityStateBeforeSend && authorityStateBeforeSend.lastOwnerMissileFreshAcquireAnchorStamp,
      toInt(
        session &&
        session._space &&
        session._space.lastOwnerMissileFreshAcquireAnchorStamp,
        0,
      ) >>> 0,
    ) >>> 0;
    let lastOwnerMissileFreshAcquireRawDispatchStamp = toInt(
      authorityStateBeforeSend && authorityStateBeforeSend.lastOwnerMissileFreshAcquireRawDispatchStamp,
      toInt(
        session &&
        session._space &&
        session._space.lastOwnerMissileFreshAcquireRawDispatchStamp,
        0,
      ) >>> 0,
    ) >>> 0;
    let lastOwnerMissileLifecycleRawDispatchStamp = toInt(
      authorityStateBeforeSend && authorityStateBeforeSend.lastOwnerMissileLifecycleRawDispatchStamp,
      toInt(
        session &&
        session._space &&
        session._space.lastOwnerMissileLifecycleRawDispatchStamp,
        0,
      ) >>> 0,
    ) >>> 0;
    let lastOwnerNonMissileCriticalStamp = toInt(
      authorityStateBeforeSend && authorityStateBeforeSend.lastOwnerNonMissileCriticalStamp,
      toInt(
        session &&
        session._space &&
        session._space.lastOwnerNonMissileCriticalStamp,
        0,
      ) >>> 0,
    ) >>> 0;
    let lastOwnerNonMissileCriticalRawDispatchStamp = toInt(
      authorityStateBeforeSend &&
        authorityStateBeforeSend.lastOwnerNonMissileCriticalRawDispatchStamp,
      toInt(
        session &&
        session._space &&
        session._space.lastOwnerNonMissileCriticalRawDispatchStamp,
        0,
      ) >>> 0,
    ) >>> 0;
    const flushGroup = () => {
      if (groupedUpdates.length === 0) {
        return;
      }

      const emitGroupedUpdates = (updatesGroup, emitOptions = {}) => {
        if (!Array.isArray(updatesGroup) || updatesGroup.length === 0) {
          return 0;
        }
        const authorityPlan = destinyAuthority.planGroupEmission({
          runtime,
          session,
          updatesGroup,
          emitOptions,
          sendOptions: options,
          rawSimTimeMs,
          currentRawDispatchStamp,
          shouldTraceDispatch: shouldTraceMissileDispatch,
          destinyCallTraceID,
          waitForBubble,
          firstGroup,
          sessionState: {
            lastFreshAcquireLifecycleStamp,
            lastMissileLifecycleStamp,
            lastOwnerMissileLifecycleStamp,
            lastOwnerMissileLifecycleAnchorStamp,
            lastOwnerMissileFreshAcquireStamp,
            lastOwnerMissileFreshAcquireAnchorStamp,
            lastOwnerMissileFreshAcquireRawDispatchStamp,
            lastOwnerMissileLifecycleRawDispatchStamp,
            lastOwnerNonMissileCriticalStamp,
            lastOwnerNonMissileCriticalRawDispatchStamp,
          },
          updatesContainObserverPresentedMonotonicPayload,
        });
        if (authorityPlan) {
          const {
            authorityJourney,
            updates: authorityUpdates,
            finalStamp: authorityStamp,
            originalStamp: authorityOriginalStamp,
            traceDetails: authorityTraceDetails,
            currentSessionStamp: authorityCurrentSessionStamp,
            flags: authorityFlags,
          } = authorityPlan;
          if (
            authorityFlags.previousLastSentDestinyStamp > 0 &&
            authorityStamp < authorityFlags.previousLastSentDestinyStamp &&
            authorityFlags.previousLastSentTrustedForBackstepGuard === true &&
            authorityFlags.previousLastSentDestinyOnlyStaleProjectedOwnerMissileLane !== true &&
            authorityFlags.allowSoftBackstepBehindNonCriticalPresentation !== true
          ) {
            destinyAuthority.rejectGroupJourney(authorityJourney, {
              session,
              reason: `final stamp ${authorityStamp >>> 0} behind last sent ${authorityFlags.previousLastSentDestinyStamp}`,
              originalStamp: authorityOriginalStamp,
              attemptedStamp: authorityStamp >>> 0,
              restampSteps: authorityTraceDetails
                ? authorityTraceDetails.restampSteps
                : [],
            });
            recordDestinyLedger(session, "destiny.group.rejected", {
              reason: "final-stamp-behind-last-sent",
              attemptedStamp: authorityStamp >>> 0,
              previousLastSentDestinyStamp:
                authorityFlags.previousLastSentDestinyStamp,
              originalStamp: authorityOriginalStamp,
              contract: authorityJourney.contract,
              updates: summarizeDestinyUpdates(authorityUpdates),
            });
            firstGroup = false;
            return 0;
          }
          if (collectNotificationGroups) {
            appendCollectedDestinyGroup(collectNotificationGroups, {
              stamp: authorityStamp >>> 0,
              waitForBubble: waitForBubble && firstGroup,
              order: ((collectNotificationBaseOrder * 100000) + emittedGroupOrder) >>> 0,
              updates: authorityUpdates,
              contract: authorityJourney.contract,
            });
            emittedGroupOrder += 1;
          } else {
            queueDirectDestinyNotificationGroup(runtime, session, {
              stamp: authorityStamp >>> 0,
              waitForBubble: waitForBubble && firstGroup,
              updates: authorityUpdates,
              contract: authorityJourney.contract,
              rawDispatchStamp: currentRawDispatchStamp,
            });
          }
          const authorityLegacyState =
            destinyAuthority.applyLegacySessionEmissionState(
              authorityJourney,
              {
                session,
                finalStamp: authorityStamp >>> 0,
                currentSessionStamp: authorityCurrentSessionStamp,
                flags: authorityFlags,
                legacyStateBefore: {
                  lastFreshAcquireLifecycleStamp,
                  lastMissileLifecycleStamp,
                  lastOwnerMissileLifecycleStamp,
                  lastOwnerMissileLifecycleAnchorStamp,
                  lastOwnerMissileFreshAcquireStamp,
                  lastOwnerMissileFreshAcquireAnchorStamp,
                  lastOwnerMissileFreshAcquireRawDispatchStamp,
                  lastOwnerMissileLifecycleRawDispatchStamp,
                  lastOwnerNonMissileCriticalStamp,
                  lastOwnerNonMissileCriticalRawDispatchStamp,
                },
              },
            );
          lastFreshAcquireLifecycleStamp =
            authorityLegacyState.lastFreshAcquireLifecycleStamp;
          lastMissileLifecycleStamp =
            authorityLegacyState.lastMissileLifecycleStamp;
          lastOwnerMissileLifecycleStamp =
            authorityLegacyState.lastOwnerMissileLifecycleStamp;
          lastOwnerMissileLifecycleAnchorStamp =
            authorityLegacyState.lastOwnerMissileLifecycleAnchorStamp;
          lastOwnerMissileFreshAcquireStamp =
            authorityLegacyState.lastOwnerMissileFreshAcquireStamp;
          lastOwnerMissileFreshAcquireAnchorStamp =
            authorityLegacyState.lastOwnerMissileFreshAcquireAnchorStamp;
          lastOwnerMissileFreshAcquireRawDispatchStamp =
            authorityLegacyState.lastOwnerMissileFreshAcquireRawDispatchStamp;
          lastOwnerMissileLifecycleRawDispatchStamp =
            authorityLegacyState.lastOwnerMissileLifecycleRawDispatchStamp;
          lastOwnerNonMissileCriticalStamp =
            authorityLegacyState.lastOwnerNonMissileCriticalStamp;
          lastOwnerNonMissileCriticalRawDispatchStamp =
            authorityLegacyState.lastOwnerNonMissileCriticalRawDispatchStamp;
          const authoritySessionAfter = destinyAuthority.completeGroupJourney(
            authorityJourney,
            {
              session,
              originalStamp: authorityOriginalStamp,
              finalStamp: authorityStamp >>> 0,
              currentSessionStamp: authorityCurrentSessionStamp,
              isCritical:
                authorityFlags.isOwnerCriticalGroup ||
                authorityFlags.isSetStateGroup ||
                authorityFlags.isMissileLifecycleGroup,
              isFreshAcquireLifecycleGroup:
                authorityFlags.isFreshAcquireLifecycleGroup,
              isMissileLifecycleGroup:
                authorityFlags.isMissileLifecycleGroup,
              flags: authorityFlags,
              restampSteps: authorityTraceDetails
                ? authorityTraceDetails.restampSteps
                : [],
              updates: authorityUpdates,
            },
          );
          if (authoritySessionAfter) {
            lastFreshAcquireLifecycleStamp = toInt(
              authoritySessionAfter.lastFreshAcquireLifecycleStamp,
              lastFreshAcquireLifecycleStamp,
            ) >>> 0;
            lastMissileLifecycleStamp = toInt(
              authoritySessionAfter.lastMissileLifecycleStamp,
              lastMissileLifecycleStamp,
            ) >>> 0;
            lastOwnerMissileLifecycleStamp = toInt(
              authoritySessionAfter.lastOwnerMissileLifecycleStamp,
              lastOwnerMissileLifecycleStamp,
            ) >>> 0;
            lastOwnerMissileLifecycleAnchorStamp = toInt(
              authoritySessionAfter.lastOwnerMissileLifecycleAnchorStamp,
              lastOwnerMissileLifecycleAnchorStamp,
            ) >>> 0;
            lastOwnerMissileFreshAcquireStamp = toInt(
              authoritySessionAfter.lastOwnerMissileFreshAcquireStamp,
              lastOwnerMissileFreshAcquireStamp,
            ) >>> 0;
            lastOwnerMissileFreshAcquireAnchorStamp = toInt(
              authoritySessionAfter.lastOwnerMissileFreshAcquireAnchorStamp,
              lastOwnerMissileFreshAcquireAnchorStamp,
            ) >>> 0;
            lastOwnerMissileFreshAcquireRawDispatchStamp = toInt(
              authoritySessionAfter.lastOwnerMissileFreshAcquireRawDispatchStamp,
              lastOwnerMissileFreshAcquireRawDispatchStamp,
            ) >>> 0;
            lastOwnerMissileLifecycleRawDispatchStamp = toInt(
              authoritySessionAfter.lastOwnerMissileLifecycleRawDispatchStamp,
              lastOwnerMissileLifecycleRawDispatchStamp,
            ) >>> 0;
            lastOwnerNonMissileCriticalStamp = toInt(
              authoritySessionAfter.lastOwnerNonMissileCriticalStamp,
              lastOwnerNonMissileCriticalStamp,
            ) >>> 0;
            lastOwnerNonMissileCriticalRawDispatchStamp = toInt(
              authoritySessionAfter.lastOwnerNonMissileCriticalRawDispatchStamp,
              lastOwnerNonMissileCriticalRawDispatchStamp,
            ) >>> 0;
          }
          if (authorityTraceDetails) {
            authorityTraceDetails.finalStamp = authorityStamp >>> 0;
            authorityTraceDetails.emittedUpdates =
              summarizeMissileUpdatesForLog(authorityUpdates);
            authorityTraceDetails.sessionAfter = buildMissileSessionSnapshot(
              runtime,
              session,
              rawSimTimeMs,
            );
            authorityTraceDetails.authoritySessionAfter = authoritySessionAfter;
            authorityTraceDetails.sessionMutation = buildMissileSessionMutation(
              authorityTraceDetails.sessionBefore,
              authorityTraceDetails.sessionAfter,
            );
            emittedGroupSummaries.push({
              groupReason: authorityTraceDetails.groupReason,
              contract: authorityJourney.contract,
              originalStamp: authorityTraceDetails.originalStamp,
              finalStamp: authorityTraceDetails.finalStamp,
              groupFlags: authorityTraceDetails.groupFlags,
              sessionMutation: authorityTraceDetails.sessionMutation,
              emittedUpdates: authorityTraceDetails.emittedUpdates,
            });
            logMissileDebug("destiny.emit-group", authorityTraceDetails);
          }
          firstGroup = false;
          highestEmittedStamp = Math.max(
            highestEmittedStamp,
            authorityStamp >>> 0,
          ) >>> 0;
          return authorityStamp >>> 0;
        }
        firstGroup = false;
        return 0;
      };

      const hasMixedOwnerMissileFreshAcquireAndLifecycle = (
        groupedUpdates.some(
          (payload) =>
            payload &&
            payload.freshAcquireLifecycleGroup === true &&
            payload.ownerMissileLifecycleGroup === true,
        ) &&
        groupedUpdates.some(
          (payload) =>
            payload &&
            payload.ownerMissileLifecycleGroup === true &&
            payload.freshAcquireLifecycleGroup !== true,
        )
      );
      if (hasMixedOwnerMissileFreshAcquireAndLifecycle) {
        if (shouldTraceMissileDispatch) {
          logMissileDebug("destiny.split-owner-missile-group", {
            destinyCallTraceID,
            rawDispatchStamp: currentRawDispatchStamp,
            rawSimTimeMs: roundNumber(rawSimTimeMs, 3),
            sendReason:
              typeof options.missileDebugReason === "string"
                ? options.missileDebugReason
                : null,
            session: buildMissileSessionSnapshot(runtime, session, rawSimTimeMs),
            updates: summarizeMissileUpdatesForLog(groupedUpdates),
          });
        }
        const freshAcquireUpdates = groupedUpdates.filter(
          (payload) => payload && payload.freshAcquireLifecycleGroup === true,
        );
        const lifecycleUpdates = groupedUpdates.filter(
          (payload) => !payload || payload.freshAcquireLifecycleGroup !== true,
        );
        const freshAcquireStamp = emitGroupedUpdates(freshAcquireUpdates, {
          missileDebugReason: options.missileDebugReason,
          groupReason: "owner-missile-fresh-acquire",
        });
        emitGroupedUpdates(lifecycleUpdates, {
          missileDebugReason: options.missileDebugReason,
          groupReason: "owner-missile-lifecycle",
          minimumPostFreshAcquireStamp:
            freshAcquireStamp > 0
              ? ((freshAcquireStamp + 1) >>> 0)
              : 0,
        });
        groupedUpdates = [];
        currentStamp = null;
        return;
      }

      emitGroupedUpdates(groupedUpdates, {
        missileDebugReason: options.missileDebugReason,
      });
      groupedUpdates = [];
      currentStamp = null;
    };

    for (const rawPayload of payloads) {
      const payload = runtime.prepareDestinyUpdateForSession(
        session,
        rawPayload,
        rawSimTimeMs,
        options,
      );
      const stamp = Number(payload && payload.stamp);
      if (groupedUpdates.length === 0) {
        groupedUpdates.push(payload);
        currentStamp = stamp;
        continue;
      }

      if (stamp === currentStamp) {
        groupedUpdates.push(payload);
        continue;
      }

      flushGroup();
      groupedUpdates.push(payload);
      currentStamp = stamp;
    }

    flushGroup();
    if (
      !collectNotificationGroups &&
      !(options && options.deferDirectDestinyFlush === true)
    ) {
      flushDirectDestinyNotificationBatch(runtime);
    }
    if (shouldTraceMissileDispatch) {
      const sessionAfterSend = buildMissileSessionSnapshot(
        runtime,
        session,
        rawSimTimeMs,
      );
      logMissileDebug("destiny.send-complete", {
        destinyCallTraceID,
        rawDispatchStamp: currentRawDispatchStamp,
        rawSimTimeMs: roundNumber(rawSimTimeMs, 3),
        waitForBubble,
        highestEmittedStamp,
        payloadCount: payloads.length,
        sessionBefore: sessionBeforeSend,
        sessionAfter: sessionAfterSend,
        sessionMutation: buildMissileSessionMutation(
          sessionBeforeSend,
          sessionAfterSend,
        ),
        emittedGroups: emittedGroupSummaries,
      });
    }
    return highestEmittedStamp >>> 0;
  }

  function sendDestinyBatch(
    runtime,
    session,
    payloads,
    waitForBubble = false,
    options = {},
  ) {
    return sendDestinyUpdates(
      runtime,
      session,
      payloads,
      waitForBubble,
      options,
    );
  }

  function sendDestinyUpdatesIndividually(
    runtime,
    session,
    payloads,
    waitForBubble = false,
    options = {},
  ) {
    if (!session || payloads.length === 0) {
      return;
    }

    for (let index = 0; index < payloads.length; index += 1) {
      runtime.sendDestinyUpdates(
        session,
        [payloads[index]],
        waitForBubble && index === 0,
        options,
      );
    }
  }

  function sendMovementUpdatesToSession(runtime, session, updates) {
    if (!session || !isReadyForDestiny(session) || updates.length === 0) {
      return;
    }

    runtime.sendDestinyUpdates(session, updates, false, {
      destinyAuthorityContract: DESTINY_CONTRACTS.CRITICAL_MOVEMENT_OR_SHIPPRIME,
    });
  }

  return {
    getDestinyHistoryAnchorStampForSession,
    resolveDestinyDeliveryStampForSession,
    prepareDestinyUpdateForSession,
    beginTickDestinyPresentationBatch,
    hasActiveTickDestinyPresentationBatch,
    shouldDeferPilotMovementForMissilePressure,
    queueTickDestinyPresentationUpdates,
    flushTickDestinyPresentationBatch,
    queueDirectDestinyNotificationGroup,
    flushDirectDestinyNotificationBatch,
    sendDestinyUpdates,
    sendDestinyBatch,
    sendDestinyUpdatesIndividually,
    sendMovementUpdatesToSession,
  };
}

module.exports = {
  createMovementDestinyDispatch,
};
