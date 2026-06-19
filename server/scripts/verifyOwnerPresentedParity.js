#!/usr/bin/env node

process.env.EVEJS_SKIP_NPC_STARTUP = "1";
process.env.EVEJS_DISABLE_NPC_ANCHOR_RELEVANCE = "1";

const runtime = require("../src/space/runtime");
const destiny = require("../src/space/destiny");

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.trunc(numeric);
  }
  const fallbackNumeric = Number(fallback);
  return Number.isFinite(fallbackNumeric) ? Math.trunc(fallbackNumeric) : 0;
}

function buildScenePrototype() {
  runtime._testing.clearScenes();
  const scene = runtime.ensureScene(30000142, {
    refreshStargates: false,
  });
  const prototype = Object.getPrototypeOf(scene);
  runtime._testing.clearScenes();
  return prototype;
}

function createSession(overrides = {}) {
  return {
    clientID: 111,
    characterID: 222,
    socket: {
      destroyed: false,
    },
    _space: {
      initialStateSent: true,
      simTimeMs: 1000,
      simFileTime: "0",
      timeDilation: 1,
      shipID: 9001,
      lastVisibleDynamicDestinyStamp: 0,
      lastSentDestinyStamp: 0,
      lastSentDestinyRawDispatchStamp: 0,
      lastSentDestinyOnlyStaleProjectedOwnerMissileLane: false,
      lastSentDestinyWasOwnerCritical: false,
      lastFreshAcquireLifecycleStamp: 0,
      lastMissileLifecycleStamp: 0,
      lastMissileLifecycleRawDispatchStamp: 0,
      lastOwnerMissileLifecycleStamp: 0,
      lastOwnerMissileLifecycleAnchorStamp: 0,
      lastOwnerMissileLifecycleRawDispatchStamp: 0,
      lastOwnerMissileFreshAcquireStamp: 0,
      lastOwnerMissileFreshAcquireAnchorStamp: 0,
      lastOwnerMissileFreshAcquireRawDispatchStamp: 0,
      lastOwnerNonMissileCriticalStamp: 0,
      lastOwnerNonMissileCriticalRawDispatchStamp: 0,
      lastPilotCommandMovementStamp: 0,
      lastPilotCommandMovementAnchorStamp: 0,
      lastPilotCommandMovementRawDispatchStamp: 0,
      ...((overrides && overrides._space) || {}),
    },
    sendNotification() {},
    ...overrides,
  };
}

function createScene(proto, overrides = {}) {
  return Object.assign(Object.create(proto), {
    systemID: 30000142,
    nextStamp: 0,
    _tickDestinyPresentation: null,
    getCurrentSimTimeMs() {
      return 1000;
    },
    getCurrentDestinyStamp() {
      return 0;
    },
    getCurrentSessionDestinyStamp() {
      return 0;
    },
    getCurrentVisibleSessionDestinyStamp() {
      return 0;
    },
    getCurrentPresentedSessionDestinyStamp() {
      return 0;
    },
    getImmediateDestinyStampForSession(session, currentSessionStamp) {
      return toInt(currentSessionStamp, 0) >>> 0;
    },
    getSessionClockOffsetMs() {
      return 0;
    },
    translateDestinyStampForSession(session, rawStamp) {
      return toInt(rawStamp, 0) >>> 0;
    },
    getHistoryFloorDestinyStampForSession() {
      return 0;
    },
    refreshSessionClockSnapshot() {},
    ...overrides,
  });
}

function buildDamageStatePayload(entityID) {
  return destiny.buildOnDamageStateChangePayload(entityID, [
    [{ type: "real", value: 0.75 }, { type: "real", value: 508500 }, { type: "long", value: "1" }],
    { type: "real", value: 1 },
    { type: "real", value: 1 },
  ]);
}

function runDamageStateScenario(proto, mode) {
  const session = createSession({
    _space: {
      shipID: 990112367,
      lastSentDestinyStamp: 1775002922,
      lastSentDestinyRawDispatchStamp: 1775002919,
      lastOwnerNonMissileCriticalStamp: 1775002920,
      lastOwnerNonMissileCriticalRawDispatchStamp: 1775002919,
      lastPilotCommandMovementStamp: 1775002920,
      lastPilotCommandMovementAnchorStamp: 1775002919,
      lastPilotCommandMovementRawDispatchStamp: 1775002919,
    },
  });
  const scene = createScene(proto, {
    getCurrentSimTimeMs() {
      return 1775002919951;
    },
    getCurrentDestinyStamp() {
      return 1775002919;
    },
    getCurrentSessionDestinyStamp() {
      return 1775002919;
    },
    getCurrentVisibleSessionDestinyStamp() {
      return 1775002919;
    },
    getCurrentPresentedSessionDestinyStamp(sessionArg, rawSimTimeMs, maximumLead = 0) {
      if (mode === "legacy") {
        return 1775002919;
      }
      return maximumLead >= 4
        ? 1775002922
        : 1775002919;
    },
    getImmediateDestinyStampForSession() {
      return 1775002918;
    },
    getHistoryFloorDestinyStampForSession() {
      return 1775002592;
    },
  });

  const emittedStamp = proto.sendDestinyUpdates.call(
    scene,
    session,
    [{
      stamp: 1775002920,
      payload: buildDamageStatePayload(990112367),
    }],
    false,
    {
      translateStamps: false,
    },
  );

  return {
    emittedStamp: emittedStamp >>> 0,
    lastSentDestinyStamp:
      toInt(session._space && session._space.lastSentDestinyStamp, 0) >>> 0,
  };
}

function resolvePresentedAlignmentDelivery(proto, authoredStamp, sendOptions) {
  const session = createSession({
    _space: {
      shipID: 990112367,
      lastSentDestinyStamp: 1775002909,
      lastSentDestinyRawDispatchStamp: 1775002905,
    },
  });
  const scene = createScene(proto, {
    getCurrentSimTimeMs() {
      return 1775002905937;
    },
    getCurrentDestinyStamp() {
      return 1775002905;
    },
    getCurrentSessionDestinyStamp() {
      return 1775002905;
    },
    getCurrentVisibleSessionDestinyStamp() {
      return 1775002905;
    },
    getCurrentPresentedSessionDestinyStamp(sessionArg, rawSimTimeMs, maximumLead = 0) {
      return maximumLead >= 4
        ? 1775002909
        : 1775002905;
    },
    getImmediateDestinyStampForSession() {
      return 1775002904;
    },
  });

  return proto.resolveDestinyDeliveryStampForSession.call(
    scene,
    session,
    authoredStamp,
    1775002905937,
    sendOptions,
  ) >>> 0;
}

function main() {
  const proto = buildScenePrototype();

  const legacyDamage = runDamageStateScenario(proto, "legacy");
  const fixedDamage = runDamageStateScenario(proto, "fixed");

  const legacyPrimeOptions = {
    translateStamps: false,
    avoidCurrentHistoryInsertion: true,
    minimumLeadFromCurrentHistory: 2,
    maximumLeadFromCurrentHistory: 2,
    historyLeadUsesCurrentSessionStamp: true,
  };
  const fixedPresentedOptions = {
    translateStamps: false,
    avoidCurrentHistoryInsertion: false,
    minimumLeadFromCurrentHistory: 0,
    maximumLeadFromCurrentHistory: 0,
    historyLeadUsesPresentedSessionStamp: true,
  };

  const legacyPrime = resolvePresentedAlignmentDelivery(
    proto,
    1775002907,
    legacyPrimeOptions,
  );
  const fixedPrime = resolvePresentedAlignmentDelivery(
    proto,
    1775002907,
    fixedPresentedOptions,
  );
  const legacyFx = resolvePresentedAlignmentDelivery(
    proto,
    1775002906,
    {
      translateStamps: false,
    },
  );
  const fixedFx = resolvePresentedAlignmentDelivery(
    proto,
    1775002906,
    fixedPresentedOptions,
  );

  const snapshot = {
    damageState: {
      liveProblemShape: {
        previousLastSentDestinyStamp: 1775002922,
        currentSessionStamp: 1775002919,
        authoredDamageStateStamp: 1775002920,
      },
      legacy: legacyDamage,
      fixed: fixedDamage,
    },
    propulsionStart: {
      liveProblemShape: {
        currentPresentedStamp: 1775002909,
        authoredShipPrimeStamp: 1775002907,
        authoredFxStamp: 1775002906,
      },
      shipPrime: {
        legacy: legacyPrime,
        fixed: fixedPrime,
      },
      specialFx: {
        legacy: legacyFx,
        fixed: fixedFx,
      },
    },
  };

  console.log(JSON.stringify(snapshot, null, 2));

  if (legacyDamage.emittedStamp >= 1775002922) {
    throw new Error(
      `Expected legacy damage-state reproduction to backstep below 1775002922, got ${legacyDamage.emittedStamp}.`,
    );
  }
  if (fixedDamage.emittedStamp !== 1775002922) {
    throw new Error(
      `Expected fixed damage-state stamp to stay on presented lane 1775002922, got ${fixedDamage.emittedStamp}.`,
    );
  }
  if (legacyPrime !== 1775002907) {
    throw new Error(
      `Expected legacy ship-prime reproduction to stay at authored stamp 1775002907, got ${legacyPrime}.`,
    );
  }
  if (fixedPrime !== 1775002909) {
    throw new Error(
      `Expected fixed ship-prime stamp to align to presented lane 1775002909, got ${fixedPrime}.`,
    );
  }
  if (legacyFx !== 1775002906) {
    throw new Error(
      `Expected legacy propulsion FX reproduction to stay at authored stamp 1775002906, got ${legacyFx}.`,
    );
  }
  if (fixedFx !== 1775002909) {
    throw new Error(
      `Expected fixed propulsion FX stamp to align to presented lane 1775002909, got ${fixedFx}.`,
    );
  }
}

main();
