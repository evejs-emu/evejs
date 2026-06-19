const runtime = require("../src/space/runtime");
const movementDeliveryPolicy = require("../src/space/movement/movementDeliveryPolicy");

const runtimeTesting = runtime && runtime._testing ? runtime._testing : {};

function assert(condition, message, details = null) {
  if (!condition) {
    const error = new Error(message);
    if (details !== null) {
      error.details = details;
    }
    throw error;
  }
}

function buildReadySession(overrides = {}) {
  const spaceOverrides = overrides._space || {};
  return {
    characterID: 140000008,
    charID: 140000008,
    clientID: 1065450,
    socket: {
      destroyed: false,
    },
    ...overrides,
    _space: {
      shipID: 991002587,
      initialStateSent: true,
      clockOffsetMs: 0,
      historyFloorDestinyStamp: 1775143957,
      lastSentDestinyStamp: 0,
      lastSentDestinyRawDispatchStamp: 0,
      ...spaceOverrides,
    },
  };
}

function buildOwnerDamageScene(config) {
  const session = buildReadySession({
    _space: {
      shipID: 991002587,
      lastSentDestinyStamp: config.lastSentDestinyStamp,
      lastSentDestinyRawDispatchStamp: config.lastSentDestinyRawDispatchStamp,
    },
  });
  const queued = [];
  const sent = [];
  const scene = {
    sessions: new Map([["owner", session]]),
    staticEntitiesByID: new Map(),
    getCurrentDestinyStamp() {
      return config.rawDispatchStamp;
    },
    getCurrentSimTimeMs() {
      return (config.rawDispatchStamp * 1000) + 123;
    },
    getCurrentVisibleDestinyStampForSession() {
      return config.visibleStamp;
    },
    getCurrentSessionDestinyStamp() {
      return config.sessionStamp;
    },
    getCurrentPresentedSessionDestinyStamp() {
      return config.presentedStamp;
    },
    getCurrentClampedSessionFileTime() {
      return BigInt("134196176370770000");
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
    itemID: 991002587,
    session,
    bubbleID: 19,
    shieldCapacity: 210000,
    armorHP: 1,
    structureHP: 1,
    conditionState: {
      shieldCharge: 0.7,
      armorDamage: 0,
      damage: 0,
    },
  };
  return {
    scene,
    session,
    entity,
    queued,
    sent,
  };
}

function verifySameRawOwnerDamageReuseClear() {
  const legacyBefore = 1775144038;
  const resolverResult = movementDeliveryPolicy.resolveDamageStateDispatchStamp({
    visibleStamp: 1775144037,
    currentPresentedStamp: 1775144038,
    previousLastSentDestinyStamp: 1775144038,
    previousLastSentDestinyRawDispatchStamp: 1775144037,
    currentRawDispatchStamp: 1775144037,
  });
  assert(
    resolverResult.finalStamp === 1775144039,
    `Expected same-raw owner damage to clear from 1775144038 to 1775144039, got ${resolverResult.finalStamp}.`,
    resolverResult,
  );

  const { scene, entity, queued } = buildOwnerDamageScene({
    rawDispatchStamp: 1775144037,
    visibleStamp: 1775144037,
    sessionStamp: 1775144037,
    presentedStamp: 1775144038,
    lastSentDestinyStamp: 1775144038,
    lastSentDestinyRawDispatchStamp: 1775144037,
  });
  const deliveredCount = runtimeTesting.broadcastDamageStateChangeForTesting(
    scene,
    entity,
    1775144037186,
  );
  assert(deliveredCount === 1, "Expected one owner damage-state recipient", {
    deliveredCount,
  });
  assert(queued.length === 1, "Expected one queued owner damage update", {
    queuedCount: queued.length,
  });
  const emittedStamp = queued[0].updates[0].stamp >>> 0;
  assert(
    emittedStamp === 1775144039,
    `Expected queued same-raw owner damage to emit on 1775144039, got ${emittedStamp}.`,
    queued[0],
  );
  return {
    beforeStamp: legacyBefore,
    afterStamp: emittedStamp,
  };
}

function verifyPresentedOwnerDamageClear() {
  const legacyBefore = 1775144039;
  const resolverResult = movementDeliveryPolicy.resolveDamageStateDispatchStamp({
    visibleStamp: 1775144038,
    currentPresentedStamp: 1775144040,
    previousLastSentDestinyStamp: 1775144040,
    previousLastSentDestinyRawDispatchStamp: 1775144038,
    currentRawDispatchStamp: 1775144038,
  });
  assert(
    resolverResult.finalStamp === 1775144040,
    `Expected owner damage behind presented lane to clear from 1775144039 to 1775144040, got ${resolverResult.finalStamp}.`,
    resolverResult,
  );

  const { scene, entity, queued } = buildOwnerDamageScene({
    rawDispatchStamp: 1775144038,
    visibleStamp: 1775144038,
    sessionStamp: 1775144038,
    presentedStamp: 1775144040,
    lastSentDestinyStamp: 1775144040,
    lastSentDestinyRawDispatchStamp: 1775144038,
  });
  const deliveredCount = runtimeTesting.broadcastDamageStateChangeForTesting(
    scene,
    entity,
    1775144038497,
  );
  assert(deliveredCount === 1, "Expected one owner damage-state recipient", {
    deliveredCount,
  });
  assert(queued.length === 1, "Expected one queued owner damage update", {
    queuedCount: queued.length,
  });
  const emittedStamp = queued[0].updates[0].stamp >>> 0;
  assert(
    emittedStamp === 1775144040,
    `Expected queued presented-lane owner damage to emit on 1775144040, got ${emittedStamp}.`,
    queued[0],
  );
  return {
    beforeStamp: legacyBefore,
    afterStamp: emittedStamp,
  };
}

function verifyHeldFutureCap() {
  const result = movementDeliveryPolicy.resolveDamageStateDispatchStamp({
    visibleStamp: 100,
    currentPresentedStamp: 105,
    previousLastSentDestinyStamp: 105,
    previousLastSentDestinyRawDispatchStamp: 100,
    currentRawDispatchStamp: 100,
  });
  assert(
    result.finalStamp === 102,
    `Expected owner damage stamp to stay capped inside held-future window at 102, got ${result.finalStamp}.`,
    result,
  );
  return {
    beforeStamp: 101,
    afterStamp: result.finalStamp,
  };
}

function main() {
  const result = {
    sameRawOwnerDamageReuse: verifySameRawOwnerDamageReuseClear(),
    presentedOwnerDamageClear: verifyPresentedOwnerDamageClear(),
    heldFutureCap: verifyHeldFutureCap(),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main();
