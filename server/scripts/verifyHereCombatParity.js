const runtime = require("../src/space/runtime");
const movementDeliveryPolicy = require("../src/space/movement/movementDeliveryPolicy");

function assert(condition, message, details = null) {
  if (!condition) {
    const error = new Error(message);
    if (details !== null) {
      error.details = details;
    }
    throw error;
  }
}

function buildScene() {
  const Scene = runtime._testing.SolarSystemScene;
  const scene = new Scene(30000142);
  scene.simTimeMs = 1775146403000;
  return scene;
}

function buildSession(shipID = 991002587) {
  return {
    characterID: 140000008,
    charID: 140000008,
    socket: {
      destroyed: false,
    },
    _space: {
      shipID,
      simTimeMs: 1775146403000,
      simFileTime: 134196200000000000n,
      timeDilation: 1,
      initialStateSent: true,
      historyFloorDestinyStamp: 1775146403,
      lastSentDestinyStamp: 1775146404,
      lastSentDestinyRawDispatchStamp: 1775146403,
    },
  };
}

function verifyMissileDeploymentFxParity() {
  const scene = buildScene();
  const session = buildSession();
  const options = runtime._testing.buildMissileDeploymentSpecialFxOptionsForTesting({
    moduleID: 991002622,
    targetID: 980000000159,
    start: true,
    active: true,
  });

  scene.getCurrentVisibleSessionDestinyStamp = () => 1775146403;
  scene.getCurrentSessionDestinyStamp = () => 1775146403;
  scene.getCurrentPresentedSessionDestinyStamp = (_session, _now, maximumLead = 0) => {
    const trustedPresented = 1775146404;
    const visible = 1775146403;
    return Math.min(trustedPresented, (visible + Number(maximumLead || 0)) >>> 0) >>> 0;
  };

  const deliveryStamp = scene.resolveDestinyDeliveryStampForSession(
    session,
    1775146403,
    scene.getCurrentSimTimeMs(),
    options,
  );

  assert(
    options.historyLeadUsesPresentedSessionStamp === true,
    "Missile deployment FX should use the presented observer lane anchor",
    options,
  );
  assert(
    options.historyLeadPresentedMaximumFutureLead === 1,
    "Missile deployment FX should only trust one presented future tick",
    options,
  );
  assert(
    options.minimumLeadFromCurrentHistory === 1 &&
      options.maximumLeadFromCurrentHistory === 1,
    "Missile deployment FX should clear the current presented lane by exactly one tick",
    options,
  );
  assert(
    deliveryStamp === 1775146405,
    "Missile deployment FX should move from the stale 6403 lane to the safe 6405 lane",
    { deliveryStamp, options },
  );

  return {
    before: {
      authoredStamp: 1775146403,
      emittedStamp: 1775146403,
    },
    after: {
      authoredStamp: 1775146403,
      emittedStamp: deliveryStamp,
      options: {
        historyLeadUsesPresentedSessionStamp:
          options.historyLeadUsesPresentedSessionStamp === true,
        historyLeadPresentedMaximumFutureLead:
          options.historyLeadPresentedMaximumFutureLead,
        minimumLeadFromCurrentHistory: options.minimumLeadFromCurrentHistory,
        maximumLeadFromCurrentHistory: options.maximumLeadFromCurrentHistory,
      },
    },
  };
}

function verifyObserverMissileAcquireParity() {
  const scene = buildScene();
  const session = buildSession();
  const options = runtime._testing.buildObserverCombatPresentedSendOptionsForTesting({
    translateStamps: false,
  });

  scene.getCurrentVisibleSessionDestinyStamp = () => 1775146404;
  scene.getCurrentSessionDestinyStamp = () => 1775146404;
  scene.getCurrentPresentedSessionDestinyStamp = (_session, _now, maximumLead = 0) => {
    const trustedPresented = 1775146405;
    const visible = 1775146404;
    return Math.min(trustedPresented, (visible + Number(maximumLead || 0)) >>> 0) >>> 0;
  };

  const deliveryStamp = scene.resolveDestinyDeliveryStampForSession(
    session,
    1775146404,
    scene.getCurrentSimTimeMs(),
    options,
  );

  assert(
    deliveryStamp === 1775146407,
    "Observer missile AddBalls should move onto the held-future observer lane instead of reusing 6404",
    { deliveryStamp, options },
  );

  return {
    before: {
      authoredStamp: 1775146404,
      emittedStamp: 1775146404,
    },
    after: {
      authoredStamp: 1775146404,
      emittedStamp: deliveryStamp,
      options: {
        historyLeadUsesPresentedSessionStamp:
          options.historyLeadUsesPresentedSessionStamp === true,
        historyLeadPresentedMaximumFutureLead:
          options.historyLeadPresentedMaximumFutureLead,
        minimumLeadFromCurrentHistory: options.minimumLeadFromCurrentHistory,
        maximumLeadFromCurrentHistory: options.maximumLeadFromCurrentHistory,
      },
    },
  };
}

function verifyDamageStateParity() {
  const result = movementDeliveryPolicy.resolveDamageStateDispatchStamp({
    visibleStamp: 1775146400,
    currentPresentedStamp: 1775146402,
    previousLastSentDestinyStamp: 0,
    previousLastSentDestinyRawDispatchStamp: 0,
    currentRawDispatchStamp: 1775146400,
  });

  assert(
    result.finalStamp === 1775146402,
    "Damage-state should stay on the held-future +2 lane, not stale visible+1",
    result,
  );

  return {
    before: {
      directCriticalEchoStamp: 1775146401,
      emittedStamp: 1775146401,
    },
    after: {
      maximumHeldFutureDamageStamp: result.maximumHeldFutureDamageStamp,
      emittedStamp: result.finalStamp,
    },
  };
}

function main() {
  const result = {
    missileDeploymentFx: verifyMissileDeploymentFxParity(),
    observerMissileAcquire: verifyObserverMissileAcquireParity(),
    damageState: verifyDamageStateParity(),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main();
