const runtime = require("../src/space/runtime");
const runtimeTesting = runtime && runtime._testing ? runtime._testing : {};
const npcBehaviorLoop = require("../src/space/npc/npcBehaviorLoop");

function assert(condition, message, details = null) {
  if (!condition) {
    const error = new Error(message);
    if (details !== null) {
      error.details = details;
    }
    throw error;
  }
}

function buildReadySession(shipID = 991002587) {
  return {
    characterID: 140000008,
    charID: 140000008,
    socket: {
      destroyed: false,
    },
    _space: {
      shipID,
      initialStateSent: true,
      clockOffsetMs: 0,
      historyFloorDestinyStamp: 1775137940,
      lastSentDestinyStamp: 1775137941,
      lastSentDestinyRawDispatchStamp: 1775137941,
    },
  };
}

function verifyNpcOffensiveFxOptions() {
  const options = runtimeTesting.buildNpcOffensiveSpecialFxOptionsForTesting({
    moduleID: 10,
    start: true,
  });
  assert(options.useCurrentStamp === true, "NPC offensive FX should use current raw stamp");
  assert(
    options.useCurrentVisibleStamp !== true,
    "NPC offensive FX should not pin to current visible stamp",
    options,
  );
  assert(
    options.minimumLeadFromCurrentHistory === 2 &&
      options.maximumLeadFromCurrentHistory === 2,
    "NPC offensive FX should use the held-future observer lane from jolts2/jolting555",
    options,
  );
  assert(
    options.historyLeadUsesPresentedSessionStamp === true,
    "NPC offensive FX should use the presented observer lane",
    options,
  );
  return {
    before: {
      useCurrentVisibleStamp: true,
      minimumLeadFromCurrentHistory: 1,
      maximumLeadFromCurrentHistory: 1,
    },
    after: {
      useCurrentStamp: options.useCurrentStamp === true,
      minimumLeadFromCurrentHistory: options.minimumLeadFromCurrentHistory,
      maximumLeadFromCurrentHistory: options.maximumLeadFromCurrentHistory,
      historyLeadPresentedMaximumFutureLead:
        options.historyLeadPresentedMaximumFutureLead,
    },
  };
}

function verifyObserverDamageStateQueuePath() {
  const session = buildReadySession();
  const queued = [];
  const sent = [];
  const scene = {
    sessions: new Map([["observer", session]]),
    staticEntitiesByID: new Map(),
    getCurrentDestinyStamp() {
      return 1775146447;
    },
    getCurrentSimTimeMs() {
      return 1775137942123;
    },
    getCurrentVisibleDestinyStampForSession() {
      return 1775146447;
    },
    getCurrentVisibleSessionDestinyStamp() {
      return 1775146447;
    },
    getCurrentSessionDestinyStamp() {
      return 1775137943;
    },
    getCurrentPresentedSessionDestinyStamp(_session, _now, maximumLead = 0) {
      const trustedPresented = 1775146449;
      const visible = 1775146447;
      return Math.min(trustedPresented, (visible + Number(maximumLead || 0)) >>> 0) >>> 0;
    },
    getCurrentClampedSessionFileTime() {
      return 134196115560000000n;
    },
    canSessionSeeDynamicEntity() {
      return true;
    },
    getEntityByID() {
      return null;
    },
    hasActiveTickDestinyPresentationBatch() {
      return true;
    },
    queueTickDestinyPresentationUpdates(targetSession, updates, options = {}) {
      queued.push({
        targetSession,
        updates,
        options,
      });
    },
    sendDestinyUpdates(targetSession, updates, waitForBubble, options = {}) {
      sent.push({
        targetSession,
        updates,
        waitForBubble,
        options,
      });
    },
  };
  const entity = {
    itemID: 980000000146,
    session: null,
    shieldCapacity: 250000,
    armorHP: 250000,
    structureHP: 250000,
    conditionState: {
      shieldCharge: 0.9,
      armorDamage: 0,
      damage: 0,
    },
  };
  const deliveredCount = runtimeTesting.broadcastDamageStateChangeForTesting(
    scene,
    entity,
    scene.getCurrentSimTimeMs(),
  );
  assert(deliveredCount === 1, "Expected one observer damage-state recipient", {
    deliveredCount,
  });
  assert(queued.length === 1, "Expected queued observer damage-state update", {
    queuedCount: queued.length,
    sentCount: sent.length,
  });
  const sendOptions = queued[0].options && queued[0].options.sendOptions
    ? queued[0].options.sendOptions
    : null;
  assert(sendOptions, "Queued observer damage-state should preserve sendOptions");
  const queuedStamp = Number(
    queued[0] &&
      Array.isArray(queued[0].updates) &&
      queued[0].updates[0] &&
      queued[0].updates[0].stamp,
  ) || 0;
  assert(
    queuedStamp === 1775146449,
    "Observer damage-state queue should still author the current presented lane before final delivery restamp",
    { queuedStamp },
  );
  assert(
    sendOptions.minimumLeadFromCurrentHistory === 2 &&
      sendOptions.maximumLeadFromCurrentHistory === 2,
    "Observer damage-state should use held-future presented-lane observer send options",
    sendOptions,
  );
  assert(
    sendOptions.historyLeadUsesPresentedSessionStamp === true,
    "Observer damage-state should use the presented observer lane",
    sendOptions,
  );
  return {
    before: {
      deliveredCount,
      queuedCount: 1,
      authoredStamp: 1775146448,
      sendOptions: null,
    },
    after: {
      deliveredCount,
      queuedCount: queued.length,
      authoredStamp: queuedStamp,
      minimumLeadFromCurrentHistory: sendOptions.minimumLeadFromCurrentHistory,
      maximumLeadFromCurrentHistory: sendOptions.maximumLeadFromCurrentHistory,
      historyLeadPresentedMaximumFutureLead:
        sendOptions.historyLeadPresentedMaximumFutureLead,
    },
  };
}

function verifyNpcSyntheticPropulsionOptions() {
  const broadcastOptions =
    npcBehaviorLoop.__testing.buildNpcSyntheticPropulsionBroadcastOptions();
  const fxOptions = npcBehaviorLoop.__testing.buildNpcSyntheticPropulsionFxOptions({
    start: true,
    active: true,
  });
  assert(
    broadcastOptions.minimumLeadFromCurrentHistory === 1 &&
      broadcastOptions.maximumLeadFromCurrentHistory === 1 &&
      broadcastOptions.historyLeadUsesPresentedSessionStamp === true &&
      broadcastOptions.historyLeadPresentedMaximumFutureLead === 1,
    "NPC synthetic propulsion ship-prime should clear the presented observer lane by one safe tick",
    broadcastOptions,
  );
  assert(
    fxOptions.useCurrentStamp === true &&
      fxOptions.minimumLeadFromCurrentHistory === 1 &&
      fxOptions.maximumLeadFromCurrentHistory === 1 &&
      fxOptions.historyLeadUsesPresentedSessionStamp === true &&
      fxOptions.historyLeadPresentedMaximumFutureLead === 1,
    "NPC synthetic propulsion FX should use the presented observer lane plus one safe tick",
    fxOptions,
  );
  return {
    before: {
      broadcast: {
        useCurrentVisibleStamp: true,
      },
      fx: {
        useCurrentVisibleStamp: true,
      },
    },
    after: {
      broadcast: {
        minimumLeadFromCurrentHistory: broadcastOptions.minimumLeadFromCurrentHistory,
        maximumLeadFromCurrentHistory: broadcastOptions.maximumLeadFromCurrentHistory,
        historyLeadUsesPresentedSessionStamp:
          broadcastOptions.historyLeadUsesPresentedSessionStamp === true,
      },
      fx: {
        useCurrentStamp: fxOptions.useCurrentStamp === true,
        minimumLeadFromCurrentHistory: fxOptions.minimumLeadFromCurrentHistory,
        maximumLeadFromCurrentHistory: fxOptions.maximumLeadFromCurrentHistory,
        historyLeadUsesPresentedSessionStamp:
          fxOptions.historyLeadUsesPresentedSessionStamp === true,
      },
    },
  };
}

function main() {
  const result = {
    npcOffensiveFx: verifyNpcOffensiveFxOptions(),
    observerDamageState: verifyObserverDamageStateQueuePath(),
    npcSyntheticPropulsion: verifyNpcSyntheticPropulsionOptions(),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main();
