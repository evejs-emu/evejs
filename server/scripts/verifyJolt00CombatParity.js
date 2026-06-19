const runtime = require("../src/space/runtime");

function assert(condition, message, details = null) {
  if (!condition) {
    const error = new Error(message);
    if (details !== null) {
      error.details = details;
    }
    throw error;
  }
}

function buildScene(simTimeMs = 1775147936000) {
  const Scene = runtime._testing.SolarSystemScene;
  const scene = new Scene(30000142);
  scene.simTimeMs = simTimeMs;
  return scene;
}

function buildSession(shipID = 991003010) {
  return {
    characterID: 140000008,
    charID: 140000008,
    socket: {
      destroyed: false,
    },
    _space: {
      shipID,
      simTimeMs: 1775147936000,
      simFileTime: 134196215410000000n,
      timeDilation: 1,
      initialStateSent: true,
      historyFloorDestinyStamp: 1775147936,
      lastSentDestinyStamp: 1775147937,
      lastSentDestinyRawDispatchStamp: 1775147936,
    },
  };
}

function verifyProjectileFxParity() {
  const scene = buildScene();
  const session = buildSession();
  const options = runtime._testing.buildNpcOffensiveSpecialFxOptionsForTesting({
    moduleID: 980100000614,
    targetID: 991003010,
    chargeTypeID: 20040,
    start: true,
    active: true,
  });

  scene.getCurrentVisibleSessionDestinyStamp = () => 1775147936;
  scene.getCurrentSessionDestinyStamp = () => 1775147936;
  scene.getCurrentPresentedSessionDestinyStamp = (_session, _now, maximumLead = 0) => {
    const trustedPresented = 1775147937;
    const visible = 1775147936;
    return Math.min(trustedPresented, (visible + Number(maximumLead || 0)) >>> 0) >>> 0;
  };

  const deliveryStamp = scene.resolveDestinyDeliveryStampForSession(
    session,
    1775147936,
    scene.getCurrentSimTimeMs(),
    options,
  );

  assert(
    options.historyLeadUsesPresentedSessionStamp === true,
    "Observer projectile FX should use the presented observer lane",
    options,
  );
  assert(
    deliveryStamp === 1775147939,
    "Observer projectile FX should move off the stale 7937 lane and onto the held-future observer lane",
    { deliveryStamp, options },
  );

  return {
    before: {
      emittedStamp: 1775147937,
      currentAtClient: 1775147938,
    },
    after: {
      emittedStamp: deliveryStamp,
      historyLeadUsesPresentedSessionStamp: true,
      historyLeadPresentedMaximumFutureLead: options.historyLeadPresentedMaximumFutureLead,
      minimumLeadFromCurrentHistory: options.minimumLeadFromCurrentHistory,
      maximumLeadFromCurrentHistory: options.maximumLeadFromCurrentHistory,
    },
  };
}

function verifyDamageStateParity() {
  const scene = buildScene(1775147941000);
  const session = buildSession();
  const options = runtime._testing.buildObserverDamageStateSendOptionsForTesting({});

  scene.getCurrentVisibleSessionDestinyStamp = () => 1775147941;
  scene.getCurrentSessionDestinyStamp = () => 1775147941;
  scene.getCurrentPresentedSessionDestinyStamp = (_session, _now, maximumLead = 0) => {
    const trustedPresented = 1775147942;
    const visible = 1775147941;
    return Math.min(trustedPresented, (visible + Number(maximumLead || 0)) >>> 0) >>> 0;
  };

  const deliveryStamp = scene.resolveDestinyDeliveryStampForSession(
    session,
    1775147941,
    scene.getCurrentSimTimeMs(),
    options,
  );

  assert(
    options.historyLeadUsesPresentedSessionStamp === true,
    "Observer damage-state should use the presented observer lane",
    options,
  );
  assert(
    deliveryStamp === 1775147944,
    "Observer damage-state should move off the stale 7942 lane and onto the held-future observer lane",
    { deliveryStamp, options },
  );

  return {
    before: {
      emittedStamp: 1775147942,
      currentAtClient: 1775147943,
    },
    after: {
      emittedStamp: deliveryStamp,
      historyLeadUsesPresentedSessionStamp: true,
      historyLeadPresentedMaximumFutureLead: options.historyLeadPresentedMaximumFutureLead,
      minimumLeadFromCurrentHistory: options.minimumLeadFromCurrentHistory,
      maximumLeadFromCurrentHistory: options.maximumLeadFromCurrentHistory,
    },
  };
}

function main() {
  const result = {
    projectileFx: verifyProjectileFxParity(),
    damageState: verifyDamageStateParity(),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main();
