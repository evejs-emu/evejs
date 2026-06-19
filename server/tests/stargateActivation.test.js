const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const config = require(path.join(repoRoot, "server/src/config"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const transitions = require(path.join(repoRoot, "server/src/space/transitions"));
const worldData = require(path.join(repoRoot, "server/src/space/worldData"));
const BeyonceService = require(path.join(
  repoRoot,
  "server/src/services/ship/beyonceService",
));
const {
  applyCharacterToSession,
  getActiveShipRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const originalNewEdenSystemLoading = config.NewEdenSystemLoading;
const FILETIME_EPOCH_OFFSET = 116444736000000000n;

function msToFileTime(value) {
  return BigInt(Math.trunc(Number(value))) * 10000n + FILETIME_EPOCH_OFFSET;
}

function fileTimeToMs(value) {
  return Number((BigInt(value) - FILETIME_EPOCH_OFFSET) / 10000n);
}

function buildSession(overrides = {}) {
  const notifications = [];
  const sessionChanges = [];
  return {
    clientID: overrides.clientID ?? 65451,
    characterID: 0,
    _notifications: notifications,
    _sessionChanges: sessionChanges,
    socket: {
      destroyed: false,
    },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendSessionChange(change) {
      sessionChanges.push(change);
    },
  };
}

function attachCharacterToScene(
  systemID = 30000142,
  characterID = 140000004,
  clientID = 65451,
) {
  const scene = spaceRuntime.ensureScene(systemID);
  const session = buildSession({ clientID });

  const applyResult = applyCharacterToSession(session, characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const shipItem = getActiveShipRecord(session.characterID);
  assert.ok(shipItem);

  const shipEntity = scene.attachSession(session, shipItem, {
    broadcast: false,
    emitSimClockRebase: false,
    spawnStopped: true,
    initialStateSent: true,
    initialBallparkVisualsSent: true,
    initialBallparkClockSynced: true,
  });
  assert.ok(shipEntity);

  return { scene, session, shipEntity };
}

function attachCharacterToSourceScene(
  sourceSystemID = 30000142,
  characterID = 140000004,
  clientID = 65451,
) {
  return attachCharacterToScene(sourceSystemID, characterID, clientID);
}

function prepareOpenGate(scene) {
  const stargate = scene.staticEntities.find((entity) => entity.kind === "stargate");
  assert.ok(stargate, "expected at least one stargate in the source scene");
  spaceRuntime.ensureScene(stargate.destinationSolarSystemID);
  spaceRuntime.refreshStargateActivationStates({
    broadcast: false,
    animateOpenTransitions: false,
  });
  scene.settleTransientStargateActivationStates(
    Date.now() + spaceRuntime._testing.STARGATE_ACTIVATION_TRANSITION_MS + 1,
  );
  const openGate = scene.getEntityByID(stargate.itemID);
  assert.ok(openGate, "expected refreshed stargate entity");
  assert.equal(
    openGate.activationState,
    spaceRuntime._testing.STARGATE_ACTIVATION_STATE.OPEN,
  );
  return openGate;
}

function getNotifications(session, name) {
  return session._notifications.filter((entry) => entry.name === name);
}

function getDestinyEvents(session, eventName) {
  return getNotifications(session, "DoDestinyUpdate")
    .flatMap((entry) => {
      const payload = entry && entry.payload && entry.payload[0];
      const items = payload && payload.items;
      return Array.isArray(items) ? items : [];
    })
    .filter((entry) => Array.isArray(entry) && entry[1] && entry[1][0] === eventName);
}

function getDestinyEventArgs(session, eventName) {
  return getDestinyEvents(session, eventName).map((entry) => entry[1][1]);
}

function findSpecialFxArgs(session, guid) {
  return getDestinyEventArgs(session, "OnSpecialFX").find(
    (args) => Array.isArray(args) && args[5] === guid,
  );
}

function withMockedNow(initialNowMs, callback) {
  const realDateNow = Date.now;
  let currentNowMs = initialNowMs;
  Date.now = () => currentNowMs;
  try {
    return callback({
      getNow() {
        return currentNowMs;
      },
      setNow(value) {
        currentNowMs = Number(value);
      },
    });
  } finally {
    Date.now = realDateNow;
  }
}

test.afterEach(() => {
  config.NewEdenSystemLoading = originalNewEdenSystemLoading;
  spaceRuntime._testing.resetStargateActivationOverrides();
  spaceRuntime._testing.clearScenes();
});

test("stable-open stargates do not repeatedly settle on normal ticks", () => {
  const states = spaceRuntime._testing.STARGATE_ACTIVATION_STATE;
  assert.equal(states.CLOSED, 0);
  assert.equal(states.ACTIVATING, 1);
  assert.equal(states.OPEN, 2);

  const scene = spaceRuntime.ensureScene(30000142);
  const gate = scene.staticEntities.find((entity) => entity.kind === "stargate");
  assert.ok(gate);
  gate.activationState = states.OPEN;
  gate.activationTransitionAtMs = 0;

  assert.deepEqual(
    scene.settleTransientStargateActivationStates(Date.now()),
    [],
  );
  assert.equal(gate.activationState, states.OPEN);
});

test("closed stargates transition through ACTIVATING before settling OPEN", () => {
  const states = spaceRuntime._testing.STARGATE_ACTIVATION_STATE;
  const scene = spaceRuntime.ensureScene(30000142);
  const gate = scene.staticEntities.find((entity) => entity.kind === "stargate");
  assert.ok(gate);
  gate.activationState = states.CLOSED;
  gate.activationTransitionAtMs = 0;

  spaceRuntime.setStargateActivationState(gate.itemID, states.OPEN);
  assert.equal(gate.activationState, states.ACTIVATING);
  assert.ok(gate.activationTransitionAtMs > Date.now());

  const changed = scene.settleTransientStargateActivationStates(
    gate.activationTransitionAtMs + 1,
  );
  assert.deepEqual(changed.map((entity) => entity.itemID), [gate.itemID]);
  assert.equal(gate.activationState, states.OPEN);
  assert.equal(gate.activationTransitionAtMs, 0);
});

test("CmdStargateJump failure mapper throws a user-facing offline gate error", () => {
  const service = new BeyonceService();

  assert.throws(
    () => service._throwStargateJumpUserError("STARGATE_NOT_ACTIVE"),
    (error) => {
      assert.equal(error && error.name, "MachoWrappedException");
      assert.equal(
        error.machoErrorResponse.payload.header[1][0],
        "CustomInfo",
      );
      assert.deepEqual(
        error.machoErrorResponse.payload.header[1][1],
        {
          type: "dict",
          entries: [[
            "info",
            [101, "UI/GateIcons/GateClosed"],
          ]],
        },
      );
      return true;
    },
  );
});

test("CmdStargateJump failure mapper uses the official stargate range hint", () => {
  const service = new BeyonceService();

  assert.throws(
    () => service._throwStargateJumpUserError("TOO_FAR_FROM_STARGATE"),
    (error) => {
      assert.equal(error && error.name, "MachoWrappedException");
      assert.equal(
        error.machoErrorResponse.payload.header[1][0],
        "CustomInfo",
      );
      assert.deepEqual(
        error.machoErrorResponse.payload.header[1][1],
        {
          type: "dict",
          entries: [[
            "info",
            [101, "UI/Menusvc/MenuHints/NotWithingMaxJumpDist"],
          ]],
        },
      );
      return true;
    },
  );
});

test("startStargateJump rejects closed gates and does not lazy-load the destination system", () => {
  const { scene, session, shipEntity } = attachCharacterToSourceScene();
  const closedGate = scene.staticEntities.find(
    (entity) =>
      entity.kind === "stargate" &&
      entity.activationState ===
        spaceRuntime._testing.STARGATE_ACTIVATION_STATE.CLOSED,
  );
  assert.ok(closedGate, "expected a closed stargate in the source scene");
  assert.equal(
    spaceRuntime.isSolarSystemSceneLoaded(closedGate.destinationSolarSystemID),
    false,
    "expected the test gate destination scene to start unloaded",
  );

  shipEntity.position = { ...closedGate.position };
  shipEntity.velocity = { x: 0, y: 0, z: 0 };
  shipEntity.mode = "STOP";
  shipEntity.speedFraction = 0;

  const result = spaceRuntime.startStargateJump(session, closedGate.itemID);

  assert.equal(result.success, false);
  assert.equal(result.errorMsg, "STARGATE_NOT_ACTIVE");
  assert.equal(
    spaceRuntime.isSolarSystemSceneLoaded(closedGate.destinationSolarSystemID),
    false,
    "closed-gate jump should not load the destination scene",
  );
});

test("startStargateJump still allows an open gate", () => {
  const { scene, session, shipEntity } = attachCharacterToSourceScene();
  const closedGate = scene.staticEntities.find(
    (entity) =>
      entity.kind === "stargate" &&
      entity.activationState ===
        spaceRuntime._testing.STARGATE_ACTIVATION_STATE.CLOSED,
  );
  assert.ok(closedGate, "expected a closed stargate in the source scene");

  spaceRuntime.ensureScene(closedGate.destinationSolarSystemID);
  spaceRuntime.refreshStargateActivationStates({
    broadcast: false,
    animateOpenTransitions: false,
  });
  scene.settleTransientStargateActivationStates(
    Date.now() + spaceRuntime._testing.STARGATE_ACTIVATION_TRANSITION_MS + 1,
  );

  const reopenedGate = scene.getEntityByID(closedGate.itemID);
  assert.equal(
    reopenedGate.activationState,
    spaceRuntime._testing.STARGATE_ACTIVATION_STATE.OPEN,
  );

  shipEntity.position = { ...reopenedGate.position };
  shipEntity.velocity = { x: 0, y: 0, z: 0 };
  shipEntity.mode = "STOP";
  shipEntity.speedFraction = 0;

  const result = spaceRuntime.startStargateJump(session, reopenedGate.itemID);

  assert.equal(result.success, true);
  assert.equal(result.data.sourceGateID, reopenedGate.itemID);
});

test("source-side observer GateActivity uses a short one-shot duration", () => {
  const {
    scene,
    session: pilotSession,
    shipEntity: pilotShipEntity,
  } = attachCharacterToSourceScene(30000142, 140000004, 65451);
  const openGate = prepareOpenGate(scene);

  pilotShipEntity.position = { ...openGate.position };
  pilotShipEntity.velocity = { x: 0, y: 0, z: 0 };
  pilotShipEntity.mode = "STOP";
  pilotShipEntity.speedFraction = 0;
  const broadcastCalls = [];
  const originalBroadcastSpecialFx = scene.broadcastSpecialFx.bind(scene);
  scene.broadcastSpecialFx = (entityID, guid, options, visibilityEntity) => {
    broadcastCalls.push({
      entityID,
      guid,
      options,
      visibilityEntityID: visibilityEntity && visibilityEntity.itemID,
    });
    return {
      stamp: 1234,
      deliveredCount: guid === "effects.GateActivity" ? 1 : 2,
    };
  };

  let result;
  try {
    result = spaceRuntime.startStargateJump(pilotSession, openGate.itemID);
  } finally {
    scene.broadcastSpecialFx = originalBroadcastSpecialFx;
  }
  assert.equal(result.success, true);

  const jumpOutCall = broadcastCalls.find((call) => call.guid === "effects.JumpOut");
  const observerGateActivity = broadcastCalls.find(
    (call) => call.guid === "effects.GateActivity",
  );
  assert.ok(jumpOutCall, "jump start should still emit JumpOut");
  assert.ok(observerGateActivity, "jump start should emit observer GateActivity");
  assert.equal(
    observerGateActivity.entityID,
    openGate.itemID,
    "GateActivity should stay anchored to the source gate ball",
  );
  assert.equal(
    observerGateActivity.options.duration,
    1,
    "observer GateActivity should use a minimal one-shot duration so later jumps can retrigger the flash",
  );
});

test("destination-side observer GateActivity stays short while JumpIn keeps its long duration", () => {
  const sourceScene = spaceRuntime.ensureScene(30000142);
  const openGate = prepareOpenGate(sourceScene);
  const sourceGate = worldData.getStargateByID(openGate.itemID);
  const destinationGate = worldData.getStargateByID(sourceGate.destinationID);
  assert.ok(destinationGate);

  const {
    session: arrivingPilotSession,
    shipEntity: arrivingPilotShipEntity,
  } = attachCharacterToScene(destinationGate.solarSystemID, 140000004, 65453);

  arrivingPilotShipEntity.position = { ...destinationGate.position };
  arrivingPilotShipEntity.velocity = { x: 0, y: 0, z: 0 };
  arrivingPilotShipEntity.mode = "STOP";
  arrivingPilotShipEntity.speedFraction = 0;
  const destinationScene = spaceRuntime.getSceneForSession(arrivingPilotSession);
  const broadcastCalls = [];
  const originalBroadcastSpecialFx = destinationScene.broadcastSpecialFx.bind(destinationScene);
  destinationScene.broadcastSpecialFx = (entityID, guid, options, visibilityEntity) => {
    broadcastCalls.push({
      entityID,
      guid,
      options,
      visibilityEntityID: visibilityEntity && visibilityEntity.itemID,
    });
    return {
      stamp: 5678,
      deliveredCount: 1,
    };
  };

  let result;
  try {
    result = spaceRuntime.emitStargateArrivalObserverFx(
      arrivingPilotSession,
      destinationGate.itemID,
      arrivingPilotShipEntity.itemID,
    );
  } finally {
    destinationScene.broadcastSpecialFx = originalBroadcastSpecialFx;
  }
  assert.equal(result.success, true);

  const observerGateActivity = broadcastCalls.find(
    (call) => call.guid === "effects.GateActivity",
  );
  const observerJumpIn = broadcastCalls.find((call) => call.guid === "effects.JumpIn");
  assert.ok(observerGateActivity, "destination observer should receive gate activity");
  assert.ok(observerJumpIn, "destination observer should receive JumpIn");
  assert.equal(
    observerGateActivity.options.duration,
    1,
    "destination GateActivity should also use the minimal one-shot duration",
  );
  assert.equal(
    observerJumpIn.options.duration,
    5000,
    "JumpIn should keep its authored long-duration observer presentation",
  );
});

test("cross-TiDi jump to a normal system keeps a continuous session clock during bootstrap", () => {
  const { scene, session, shipEntity } = attachCharacterToSourceScene();
  const openGate = prepareOpenGate(scene);
  const sourceGate = worldData.getStargateByID(openGate.itemID);
  const destinationGate = worldData.getStargateByID(sourceGate.destinationID);
  assert.ok(sourceGate);
  assert.ok(destinationGate);

  scene.setTimeDilation(0.5, {
    syncSessions: false,
  });
  scene.tick(scene.getCurrentWallclockMs() + 4000);
  const destinationScene = spaceRuntime.ensureScene(destinationGate.solarSystemID);
  destinationScene.setTimeDilation(1.0, {
    syncSessions: false,
  });
  destinationScene.tick(destinationScene.getCurrentWallclockMs() + 5000);

  shipEntity.position = { ...openGate.position };
  shipEntity.velocity = { x: 0, y: 0, z: 0 };
  shipEntity.mode = "STOP";
  shipEntity.speedFraction = 0;

  const currentStamp = scene.getCurrentDestinyStamp();
  const jumpOutResult = spaceRuntime.startStargateJump(session, sourceGate.itemID);
  assert.equal(jumpOutResult.success, true);
  assert.equal(
    jumpOutResult.data.stamp,
    currentStamp,
    "JumpOut FX should dispatch on the current destiny stamp under TiDi",
  );

  session._notifications.length = 0;
  session._transitionState = {
    kind: "stargate-jump",
    targetID: sourceGate.itemID,
    startedAt: Date.now(),
  };

  const activeShip = getActiveShipRecord(session.characterID);
  const completionResult = transitions._testing.completeStargateJumpForTesting(
    session,
    sourceGate,
    destinationGate,
    activeShip,
  );
  assert.equal(completionResult.success, true);

  const attachRebases = getNotifications(session, "DoSimClockRebase");
  assert.equal(
    attachRebases.length,
    0,
    "jump attach should not rebase the client while the source scene is still being torn down",
  );
  assert.equal(
    getNotifications(session, "OnSetTimeDilation").length,
    0,
    "cross-system jump attach should not reset TiDi before the destination ballpark is ready",
  );

  const attachedScene = spaceRuntime.getSceneForSession(session);
  assert.equal(attachedScene.systemID, destinationGate.solarSystemID);
  attachedScene.tick(attachedScene.getCurrentWallclockMs() + 2500);
  const service = new BeyonceService();
  const formations = service.Handle_GetFormations([], session, null);
  assert.ok(Array.isArray(formations));
  const addBallsAfterFormations = getDestinyEvents(session, "AddBalls2");
  const setStateAfterFormations = getDestinyEvents(session, "SetState");
  assert.equal(addBallsAfterFormations.length, 1);
  assert.equal(
    setStateAfterFormations.length,
    0,
    "jump arrival should defer SetState until the later MachoBindObject bind completes",
  );
  assert.equal(
    getNotifications(session, "DoSimClockRebase").length,
    1,
    "jump arrival should rebase the client as soon as the destination ballpark exists",
  );
  assert.equal(
    getNotifications(session, "OnSetTimeDilation").length,
    1,
    "jump arrival should announce the destination TiDi factor with the first destination ballpark bootstrap",
  );

  const bindResult = service.Handle_MachoBindObject([destinationGate.solarSystemID, null], session, null);
  assert.ok(Array.isArray(bindResult));
  assert.equal(
    getNotifications(session, "DoSimClockRebase").length,
    1,
    "jump bind should not emit a second rebase after GetFormations already synced the destination clock",
  );
  assert.equal(
    getNotifications(session, "OnSetTimeDilation").length,
    1,
    "jump bind should not re-announce TiDi after GetFormations already synced the destination clock",
  );
  assert.equal(
    getDestinyEvents(session, "SetState").length,
    1,
    "jump bind should complete the deferred SetState once MachoBindObject finishes",
  );

  const rebasesAfterBootstrap = getNotifications(session, "DoSimClockRebase");
  assert.equal(
    rebasesAfterBootstrap.length,
    1,
    "jump arrival should only emit one authoritative rebase across GetFormations and MachoBindObject",
  );
  assert.equal(
    rebasesAfterBootstrap[0].payload[0][0].value,
    rebasesAfterBootstrap[0].payload[0][1].value,
    "bootstrap should keep the arriving pilot on one continuous session clock instead of rebasing onto the destination scene's raw absolute time",
  );
  const addBallsEvents = getDestinyEvents(session, "AddBalls2");
  assert.equal(addBallsEvents.length, 1);
  const translatedBootstrapStamp = Math.trunc(
    fileTimeToMs(rebasesAfterBootstrap[0].payload[0][1].value) / 1000,
  );
  assert.equal(
    addBallsEvents[0][0],
    attachedScene.getCurrentDestinyStamp(),
    "TiDi-source jump bootstrap should seed Michelle from the destination scene's raw current stamp",
  );
  assert.notEqual(
    addBallsEvents[0][0],
    translatedBootstrapStamp,
    "ballpark history should stay on the destination scene clock instead of the translated player clock",
  );
  const setStateEvents = getDestinyEvents(session, "SetState");
  assert.equal(setStateEvents.length, 1);
  assert.ok(
    setStateEvents[0][0] >= addBallsEvents[0][0],
    "deferred SetState should land after the early AddBalls2 visual bootstrap",
  );
  const firstTidiNotificationIndex = session._notifications.findIndex(
    (entry) => entry.name === "OnSetTimeDilation",
  );
  const firstRebaseNotificationIndex = session._notifications.findIndex(
    (entry) => entry.name === "DoSimClockRebase",
  );
  const firstDestinyUpdateIndex = session._notifications.findIndex(
    (entry) => entry.name === "DoDestinyUpdate",
  );
  assert.ok(firstTidiNotificationIndex >= 0, "expected an explicit 1.0 TiDi notification on normal-system entry");
  assert.ok(firstRebaseNotificationIndex >= 0, "expected a bootstrap sim-clock rebase");
  assert.ok(firstDestinyUpdateIndex >= 0, "expected bootstrap destiny updates");
  assert.ok(
    firstTidiNotificationIndex < firstRebaseNotificationIndex,
    "normal-system entry should restore 1.0 TiDi before the bootstrap rebase",
  );
  const firstSetStateIndex = session._notifications.findIndex(
    (entry) =>
      entry.name === "DoDestinyUpdate" &&
      (entry.payload[0].items || []).some((item) => item[1] && item[1][0] === "SetState"),
  );
  assert.ok(firstSetStateIndex > firstRebaseNotificationIndex);
  assert.ok(
    firstRebaseNotificationIndex < firstSetStateIndex,
    "normal-system entry should rebase the client before the deferred SetState bootstrap completes",
  );
  assert.ok(firstSetStateIndex > firstDestinyUpdateIndex);
});

test("cross-TiDi jump bootstrap rebases from the transition-advanced source clock", () => {
  withMockedNow(1773792800000, ({ getNow, setNow }) => {
    const { scene, session } = attachCharacterToSourceScene();
    const openGate = prepareOpenGate(scene);
    const sourceGate = worldData.getStargateByID(openGate.itemID);
    const destinationGate = worldData.getStargateByID(sourceGate.destinationID);
    assert.ok(sourceGate);
    assert.ok(destinationGate);

    scene.setTimeDilation(0.5, {
      syncSessions: false,
      wallclockNowMs: getNow(),
    });
    scene.tick(getNow() + 4000);
    setNow(getNow() + 4000);

    const destinationScene = spaceRuntime.ensureScene(destinationGate.solarSystemID);
    destinationScene.setTimeDilation(1.0, {
      syncSessions: false,
      wallclockNowMs: getNow(),
    });

    const sourceSimTimeMs = spaceRuntime.getSimulationTimeMsForSession(session, null);
    const captureWallclockMs = getNow();
    session._transitionState = {
      kind: "stargate-jump",
      targetID: sourceGate.itemID,
      startedAt: captureWallclockMs,
    };

    const activeShip = getActiveShipRecord(session.characterID);
    const completionResult = transitions._testing.completeStargateJumpForTesting(
      session,
      sourceGate,
      destinationGate,
      activeShip,
    );
    assert.equal(completionResult.success, true);

    setNow(captureWallclockMs + 2200);
    const attachedScene = spaceRuntime.getSceneForSession(session);
    attachedScene.tick(getNow());

    const service = new BeyonceService();
    const formations = service.Handle_GetFormations([], session, null);
    assert.ok(Array.isArray(formations));

    const rebaseNotifications = getNotifications(session, "DoSimClockRebase");
    assert.equal(rebaseNotifications.length, 1);
    assert.equal(
      rebaseNotifications[0].payload[0][0].value,
      msToFileTime(sourceSimTimeMs + 1100),
      "jump bootstrap should rebase from the source clock advanced by elapsed transition time at the old TiDi factor",
    );
    assert.equal(
      rebaseNotifications[0].payload[0][1].value,
      msToFileTime(sourceSimTimeMs + 1100),
      "jump bootstrap should keep the player's session clock continuous at arrival instead of snapping to the destination scene's raw absolute time",
    );
  });
});

test("stargate JumpOut FX stays within the client's immediate visible destiny window under extreme TiDi", () => {
  const { scene, session, shipEntity } = attachCharacterToSourceScene();
  const openGate = prepareOpenGate(scene);

  scene.setTimeDilation(0.1, {
    syncSessions: false,
  });
  scene.tick(scene.getCurrentWallclockMs() + 4000);

  shipEntity.position = { ...openGate.position };
  shipEntity.velocity = { x: 0, y: 0, z: 0 };
  shipEntity.mode = "STOP";
  shipEntity.speedFraction = 0;

  const currentStamp = scene.getCurrentDestinyStamp();
  session._space.initialStateSent = true;
  session._space.lastSentDestinyStamp = (currentStamp - 1) >>> 0;

  const jumpOutResult = spaceRuntime.startStargateJump(session, openGate.itemID);
  assert.equal(jumpOutResult.success, true);
  assert.equal(
    jumpOutResult.data.stamp,
    session._space.lastSentDestinyStamp,
    "JumpOut should use the last already-visible stamp when raw current is one tick ahead of Michelle's live history",
  );
});

test("stargate JumpOut FX does not backstep to a stale last-sent stamp after the client has locally advanced", () => {
  const { scene, session, shipEntity } = attachCharacterToSourceScene();
  const openGate = prepareOpenGate(scene);

  scene.setTimeDilation(0.1, {
    syncSessions: false,
  });
  scene.tick(scene.getCurrentWallclockMs() + 4000);

  shipEntity.position = { ...openGate.position };
  shipEntity.velocity = { x: 0, y: 0, z: 0 };
  shipEntity.mode = "STOP";
  shipEntity.speedFraction = 0;

  const currentStamp = scene.getCurrentDestinyStamp();
  session._space.initialStateSent = true;
  session._space.lastSentDestinyStamp = (currentStamp - 30) >>> 0;

  const jumpOutResult = spaceRuntime.startStargateJump(session, openGate.itemID);
  assert.equal(jumpOutResult.success, true);
  assert.equal(
    jumpOutResult.data.stamp,
    (currentStamp - 1) >>> 0,
    "JumpOut should stay in Michelle's current history window instead of rewinding to an old stamp that the client will discard",
  );
});

test("broadcastSpecialFx matches the jumping client by clientID for immediate visible JumpOut stamping", () => {
  const { scene, session, shipEntity } = attachCharacterToSourceScene();

  scene.setTimeDilation(0.1, {
    syncSessions: false,
  });
  scene.tick(scene.getCurrentWallclockMs() + 4000);

  const currentStamp = scene.getCurrentDestinyStamp();
  session._space.initialStateSent = true;
  session._space.lastSentDestinyStamp = (currentStamp - 1) >>> 0;

  const wrappedResultSession = {
    clientID: session.clientID,
  };

  const result = scene.broadcastSpecialFx(
    shipEntity.itemID,
    "effects.JumpOut",
    {
      start: true,
      active: false,
      useCurrentStamp: true,
      useImmediateClientVisibleStamp: true,
      resultSession: wrappedResultSession,
    },
    shipEntity,
  );

  assert.equal(
    result.stamp,
    session._space.lastSentDestinyStamp,
    "the immediate visible JumpOut path should still trigger when the caller uses a session wrapper with the same clientID",
  );
});

test("direct solar-system jumps leaving TiDi keep a continuous session clock during bootstrap", () => {
  const targetSolarSystemID = 30000140;
  const { scene, session, shipEntity } = attachCharacterToSourceScene();

  scene.setTimeDilation(0.5, {
    syncSessions: false,
  });
  scene.tick(scene.getCurrentWallclockMs() + 4000);

  const destinationScene = spaceRuntime.ensureScene(targetSolarSystemID);
  destinationScene.setTimeDilation(1.0, {
    syncSessions: false,
  });
  destinationScene.tick(destinationScene.getCurrentWallclockMs() + 5000);

  const jumpResult = transitions.jumpSessionToSolarSystem(session, targetSolarSystemID);
  assert.equal(jumpResult.success, true);

  const attachRebases = getNotifications(session, "DoSimClockRebase");
  assert.equal(
    attachRebases.length,
    0,
    "solar jump attach should not rebase the client while the source scene is still active",
  );

  const attachedScene = spaceRuntime.getSceneForSession(session);
  assert.equal(attachedScene.systemID, targetSolarSystemID);
  attachedScene.tick(attachedScene.getCurrentWallclockMs() + 2500);
  const service = new BeyonceService();
  const formations = service.Handle_GetFormations([], session, null);
  assert.ok(Array.isArray(formations));
  assert.equal(getDestinyEvents(session, "AddBalls2").length, 1);
  assert.equal(
    getDestinyEvents(session, "SetState").length,
    0,
    "solar jump visuals should arrive before the final SetState bind completes",
  );
  assert.equal(
    getNotifications(session, "DoSimClockRebase").length,
    1,
    "solar jump should rebase the client once the destination ballpark exists",
  );
  assert.equal(
    getNotifications(session, "OnSetTimeDilation").length,
    1,
    "solar jump should announce the destination TiDi factor during GetFormations",
  );

  const bindResult = service.Handle_MachoBindObject([targetSolarSystemID, null], session, null);
  assert.ok(Array.isArray(bindResult));
  assert.equal(
    getNotifications(session, "DoSimClockRebase").length,
    1,
    "solar jump bind should not emit a second rebase after the destination ballpark was already synced",
  );
  assert.equal(
    getDestinyEvents(session, "SetState").length,
    1,
    "solar jump bind should complete the deferred SetState",
  );

  const rebasesAfterBootstrap = getNotifications(session, "DoSimClockRebase");
  assert.equal(
    rebasesAfterBootstrap.length,
    1,
    "solar jump bootstrap should emit one authoritative rebase",
  );
  assert.equal(
    rebasesAfterBootstrap[0].payload[0][0].value,
    rebasesAfterBootstrap[0].payload[0][1].value,
    "solar jump bootstrap should keep the arriving pilot on one continuous session clock",
  );
  const addBallsEvents = getDestinyEvents(session, "AddBalls2");
  assert.equal(addBallsEvents.length, 1);
  const translatedBootstrapStamp = Math.trunc(
    fileTimeToMs(rebasesAfterBootstrap[0].payload[0][1].value) / 1000,
  );
  assert.equal(
    addBallsEvents[0][0],
    attachedScene.getCurrentDestinyStamp(),
    "solar jump bootstrap should use the destination scene's raw current stamp",
  );
  assert.notEqual(
    addBallsEvents[0][0],
    translatedBootstrapStamp,
    "solar jump ballpark history should stay out of the translated session clock domain",
  );
});

test("jumping into a TiDi destination keeps immediate FX and sends TiDi before ballpark", () => {
  const { scene, session, shipEntity } = attachCharacterToSourceScene();
  const openGate = prepareOpenGate(scene);
  const sourceGate = worldData.getStargateByID(openGate.itemID);
  const destinationGate = worldData.getStargateByID(sourceGate.destinationID);
  assert.ok(sourceGate);
  assert.ok(destinationGate);

  scene.setTimeDilation(1.0, {
    syncSessions: false,
  });
  const destinationScene = spaceRuntime.ensureScene(destinationGate.solarSystemID);
  destinationScene.setTimeDilation(0.5, {
    syncSessions: false,
  });

  shipEntity.position = { ...openGate.position };
  shipEntity.velocity = { x: 0, y: 0, z: 0 };
  shipEntity.mode = "STOP";
  shipEntity.speedFraction = 0;

  const currentStamp = scene.getCurrentDestinyStamp();
  const jumpOutResult = spaceRuntime.startStargateJump(session, sourceGate.itemID);
  assert.equal(jumpOutResult.success, true);
  assert.equal(jumpOutResult.data.stamp, currentStamp);

  session._notifications.length = 0;
  session._transitionState = {
    kind: "stargate-jump",
    targetID: sourceGate.itemID,
    startedAt: Date.now(),
  };

  const activeShip = getActiveShipRecord(session.characterID);
  const completionResult = transitions._testing.completeStargateJumpForTesting(
    session,
    sourceGate,
    destinationGate,
    activeShip,
  );
  assert.equal(completionResult.success, true);
  assert.equal(
    getNotifications(session, "DoSimClockRebase").length,
    0,
    "jump attach should not emit a pre-bootstrap rebase while the session is still changing",
  );

  const attachedScene = spaceRuntime.getSceneForSession(session);
  assert.equal(attachedScene.systemID, destinationGate.solarSystemID);
  attachedScene.tick(attachedScene.getCurrentWallclockMs() + 2500);
  const service = new BeyonceService();
  const formations = service.Handle_GetFormations([], session, null);
  assert.ok(Array.isArray(formations));
  assert.equal(
    getDestinyEvents(session, "AddBalls2").length,
    1,
  );
  assert.equal(
    getDestinyEvents(session, "SetState").length,
    0,
    "TiDi destination jump should defer SetState until MachoBindObject completes",
  );
  assert.equal(
    getNotifications(session, "DoSimClockRebase").length,
    1,
    "TiDi destination jump should rebase the client once the destination ballpark exists",
  );
  assert.equal(
    getNotifications(session, "OnSetTimeDilation").length,
    1,
    "TiDi destination jump should announce TiDi during GetFormations",
  );

  const bindResult = service.Handle_MachoBindObject([destinationGate.solarSystemID, null], session, null);
  assert.ok(Array.isArray(bindResult));
  assert.equal(
    getNotifications(session, "DoSimClockRebase").length,
    1,
    "TiDi destination bind should not emit a second rebase after GetFormations already synced the ballpark",
  );
  assert.equal(
    getNotifications(session, "OnSetTimeDilation").length,
    1,
    "TiDi destination bind should not re-announce TiDi after GetFormations already synced the ballpark",
  );
  assert.equal(
    getDestinyEvents(session, "SetState").length,
    1,
    "TiDi destination bind should complete the deferred SetState",
  );

  const rebaseNotifications = getNotifications(session, "DoSimClockRebase");
  assert.equal(
    rebaseNotifications.length,
    1,
    "non-TiDi source jumps should still get one bootstrap rebase",
  );

  const firstTidiNotificationIndex = session._notifications.findIndex(
    (entry) => entry.name === "OnSetTimeDilation",
  );
  const firstDestinyUpdateIndex = session._notifications.findIndex(
    (entry) => entry.name === "DoDestinyUpdate",
  );
  assert.ok(firstTidiNotificationIndex >= 0, "expected TiDi notification on TiDi destination entry");
  const firstRebaseNotificationIndex = session._notifications.findIndex(
    (entry) => entry.name === "DoSimClockRebase",
  );
  assert.ok(firstRebaseNotificationIndex >= 0, "expected a bootstrap rebase on TiDi destination entry");
  assert.ok(firstDestinyUpdateIndex >= 0, "expected initial ballpark destiny updates");
  assert.ok(
    firstTidiNotificationIndex < firstRebaseNotificationIndex,
    "TiDi destination entry should notify the client before the bootstrap rebase",
  );
  const firstSetStateIndex = session._notifications.findIndex(
    (entry) =>
      entry.name === "DoDestinyUpdate" &&
      (entry.payload[0].items || []).some((item) => item[1] && item[1][0] === "SetState"),
  );
  assert.ok(firstTidiNotificationIndex < firstSetStateIndex);
  assert.ok(firstRebaseNotificationIndex < firstSetStateIndex);
  assert.equal(
    getDestinyEvents(session, "SetState").length,
    1,
    "TiDi destination jump should emit exactly one deferred SetState during MachoBindObject",
  );
});

test("jumping from one TiDi system to another keeps destination TiDi but a continuous session clock", () => {
  withMockedNow(1773793800000, ({ getNow, setNow }) => {
    const { scene, session, shipEntity } = attachCharacterToSourceScene();
    const openGate = prepareOpenGate(scene);
    const sourceGate = worldData.getStargateByID(openGate.itemID);
    const destinationGate = worldData.getStargateByID(sourceGate.destinationID);
    assert.ok(sourceGate);
    assert.ok(destinationGate);

    scene.setTimeDilation(0.5, {
      syncSessions: false,
      wallclockNowMs: getNow(),
    });
    scene.tick(getNow() + 4000);
    setNow(getNow() + 4000);

    const destinationScene = spaceRuntime.ensureScene(destinationGate.solarSystemID);
    destinationScene.setTimeDilation(0.7, {
      syncSessions: false,
      wallclockNowMs: getNow(),
    });
    destinationScene.tick(getNow() + 3000);
    setNow(getNow() + 3000);

    shipEntity.position = { ...openGate.position };
    shipEntity.velocity = { x: 0, y: 0, z: 0 };
    shipEntity.mode = "STOP";
    shipEntity.speedFraction = 0;

    const sourceSimTimeMs = spaceRuntime.getSimulationTimeMsForSession(session, null);
    const captureWallclockMs = getNow();
    const currentStamp = scene.getCurrentDestinyStamp();
    const jumpOutResult = spaceRuntime.startStargateJump(session, sourceGate.itemID);
    assert.equal(jumpOutResult.success, true);
    assert.equal(jumpOutResult.data.stamp, currentStamp);

    session._notifications.length = 0;
    session._transitionState = {
      kind: "stargate-jump",
      targetID: sourceGate.itemID,
      startedAt: captureWallclockMs,
    };

    const activeShip = getActiveShipRecord(session.characterID);
    const completionResult = transitions._testing.completeStargateJumpForTesting(
      session,
      sourceGate,
      destinationGate,
      activeShip,
    );
    assert.equal(completionResult.success, true);
    assert.equal(
      getNotifications(session, "DoSimClockRebase").length,
      0,
      "TiDi-to-TiDi attach should still avoid rebasing before destination bootstrap",
    );

    setNow(captureWallclockMs + 2200);
    const attachedScene = spaceRuntime.getSceneForSession(session);
    assert.equal(attachedScene.systemID, destinationGate.solarSystemID);
    attachedScene.tick(getNow());
    const service = new BeyonceService();
    const formations = service.Handle_GetFormations([], session, null);
    assert.ok(Array.isArray(formations));

    const tidiNotifications = getNotifications(session, "OnSetTimeDilation");
    assert.equal(tidiNotifications.length, 1);
    assert.deepEqual(
      tidiNotifications[0].payload,
      [0.7, 0.7, 0],
      "TiDi-to-TiDi arrival should announce the destination system's factor",
    );

    const rebaseNotifications = getNotifications(session, "DoSimClockRebase");
    assert.equal(rebaseNotifications.length, 1);
    assert.equal(
      rebaseNotifications[0].payload[0][0].value,
      msToFileTime(sourceSimTimeMs + 1100),
      "bootstrap should preserve elapsed source TiDi drift when rebasing into another TiDi system",
    );
    assert.equal(
      rebaseNotifications[0].payload[0][1].value,
      msToFileTime(sourceSimTimeMs + 1100),
      "the player clock should stay continuous even when the destination scene itself is on a different absolute timeline",
    );

    const addBallsEvents = getDestinyEvents(session, "AddBalls2");
    assert.equal(addBallsEvents.length, 1);
    const translatedBootstrapStamp = Math.trunc(
      fileTimeToMs(rebaseNotifications[0].payload[0][1].value) / 1000,
    );
    assert.equal(
      addBallsEvents[0][0],
      attachedScene.getCurrentDestinyStamp(),
      "TiDi-to-TiDi arrival should seed Michelle from the destination scene's raw current stamp",
    );
    assert.notEqual(
      addBallsEvents[0][0],
      translatedBootstrapStamp,
      "TiDi-to-TiDi ballpark history should remain separate from the translated player clock",
    );

    const bindResult = service.Handle_MachoBindObject([destinationGate.solarSystemID, null], session, null);
    assert.ok(Array.isArray(bindResult));
    assert.equal(
      getNotifications(session, "OnSetTimeDilation").length,
      1,
      "bind should not re-announce TiDi after GetFormations",
    );
    assert.equal(
      getNotifications(session, "DoSimClockRebase").length,
      1,
      "bind should not emit a second rebase after the destination bootstrap",
    );
    assert.equal(
      getDestinyEvents(session, "SetState").length,
      1,
      "bind should complete the deferred SetState once the destination ballpark is bound",
    );
  });
});

test("jumping back out of a TiDi destination never stamps JumpOut behind that destination's latest SetState floor", () => {
  const { scene, session, shipEntity } = attachCharacterToSourceScene();
  const openGate = prepareOpenGate(scene);
  const sourceGate = worldData.getStargateByID(openGate.itemID);
  const destinationGate = worldData.getStargateByID(sourceGate.destinationID);
  assert.ok(sourceGate);
  assert.ok(destinationGate);

  scene.setTimeDilation(1.0, {
    syncSessions: false,
  });
  const destinationScene = spaceRuntime.ensureScene(destinationGate.solarSystemID);
  destinationScene.setTimeDilation(0.5, {
    syncSessions: false,
  });
  destinationScene.tick(destinationScene.getCurrentWallclockMs() + 5000);

  shipEntity.position = { ...openGate.position };
  shipEntity.velocity = { x: 0, y: 0, z: 0 };
  shipEntity.mode = "STOP";
  shipEntity.speedFraction = 0;

  const firstJumpResult = spaceRuntime.startStargateJump(session, sourceGate.itemID);
  assert.equal(firstJumpResult.success, true);

  session._notifications.length = 0;
  session._transitionState = {
    kind: "stargate-jump",
    targetID: sourceGate.itemID,
    startedAt: Date.now(),
  };

  const activeShip = getActiveShipRecord(session.characterID);
  const completionResult = transitions._testing.completeStargateJumpForTesting(
    session,
    sourceGate,
    destinationGate,
    activeShip,
  );
  assert.equal(completionResult.success, true);

  const service = new BeyonceService();
  const formations = service.Handle_GetFormations([], session, null);
  assert.ok(Array.isArray(formations));
  const bindResult = service.Handle_MachoBindObject([destinationGate.solarSystemID, null], session, null);
  assert.ok(Array.isArray(bindResult));

  const destinationSetStateEvents = getDestinyEvents(session, "SetState");
  assert.equal(destinationSetStateEvents.length, 1);
  const destinationLatestSetStateStamp = destinationSetStateEvents[0][0];

  const destinationShip = spaceRuntime.getEntity(session, activeShip.itemID);
  assert.ok(destinationShip);
  destinationShip.position = { ...destinationGate.position };
  destinationShip.velocity = { x: 0, y: 0, z: 0 };
  destinationShip.mode = "STOP";
  destinationShip.speedFraction = 0;

  const jumpBackResult = spaceRuntime.startStargateJump(session, destinationGate.itemID);
  assert.equal(jumpBackResult.success, true);
  assert.ok(
    jumpBackResult.data.stamp >= destinationLatestSetStateStamp,
    "JumpOut should not be stamped behind the current destination ballpark floor after a prior cross-system arrival",
  );
});

test("stargate jumps advertise a fixed 7 second wallclock session-change cooldown", () => {
  withMockedNow(1773783000000, ({ getNow }) => {
    const { session } = attachCharacterToSourceScene();
    session.currentBoundObjectID = "N=65450:11";
    session._space.clockOffsetMs = -211781.033;
    const boundResult = transitions._testing.buildBoundResultForTesting(session);

    assert.ok(Array.isArray(boundResult));
    assert.equal(
      boundResult[1],
      msToFileTime(getNow() + 7000),
      "jump session timers should stay on the normal 7 second wallclock cooldown even when the source scene is in TiDi",
    );
  });
});

test("OnGoingLazy keeps unloaded destinations jumpable and loads them only on jump completion", () => {
  config.NewEdenSystemLoading = 4;

  const { scene, session, shipEntity } = attachCharacterToSourceScene();
  const onDemandGate = scene.staticEntities.find(
    (entity) =>
      entity.kind === "stargate" &&
      !spaceRuntime.isSolarSystemSceneLoaded(entity.destinationSolarSystemID),
  );
  assert.ok(onDemandGate, "expected an on-demand stargate in the source scene");
  assert.equal(
    onDemandGate.activationState,
    spaceRuntime._testing.STARGATE_ACTIVATION_STATE.OPEN,
  );
  assert.equal(
    spaceRuntime.isSolarSystemSceneLoaded(onDemandGate.destinationSolarSystemID),
    false,
    "OnGoingLazy should not preload the destination scene",
  );

  shipEntity.position = { ...onDemandGate.position };
  shipEntity.velocity = { x: 0, y: 0, z: 0 };
  shipEntity.mode = "STOP";
  shipEntity.speedFraction = 0;

  const jumpOutResult = spaceRuntime.startStargateJump(session, onDemandGate.itemID);
  assert.equal(jumpOutResult.success, true);
  assert.equal(
    spaceRuntime.isSolarSystemSceneLoaded(onDemandGate.destinationSolarSystemID),
    false,
    "starting the jump should not load the destination scene yet",
  );

  const sourceGate = worldData.getStargateByID(onDemandGate.itemID);
  const destinationGate = worldData.getStargateByID(sourceGate.destinationID);
  const activeShip = getActiveShipRecord(session.characterID);
  session._transitionState = {
    kind: "stargate-jump",
    targetID: sourceGate.itemID,
    startedAt: Date.now(),
  };

  const completionResult = transitions._testing.completeStargateJumpForTesting(
    session,
    sourceGate,
    destinationGate,
    activeShip,
  );
  assert.equal(completionResult.success, true);
  assert.equal(
    spaceRuntime.isSolarSystemSceneLoaded(destinationGate.solarSystemID),
    true,
    "completing the jump should lazy-load the destination scene",
  );
  assert.equal(
    spaceRuntime.getSceneForSession(session).systemID,
    destinationGate.solarSystemID,
  );
});
