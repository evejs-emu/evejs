const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const transitions = require(path.join(repoRoot, "server/src/space/transitions"));
const worldData = require(path.join(repoRoot, "server/src/space/worldData"));
const {
  applyCharacterToSession,
  getCharacterRecord,
  getActiveShipRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  getFittedModuleItems,
  typeHasEffectName,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));

const MWD_EFFECT_NAME = "moduleBonusMicrowarpdrive";
const MWD_GUID = "effects.MicroWarpDrive";

function findPropulsionCandidate() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Failed to read characters table");

  const characterIDs = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .sort((left, right) => left - right);

  for (const characterID of characterIDs) {
    const characterRecord = getCharacterRecord(characterID);
    const ship = getActiveShipRecord(characterID);
    if (!characterRecord || !ship || !ship.spaceState) {
      continue;
    }
    if (Number(characterRecord.stationID || characterRecord.stationid || 0) > 0) {
      continue;
    }

    const propulsionModule = getFittedModuleItems(characterID, ship.itemID).find(
      (item) => typeHasEffectName(item.typeID, MWD_EFFECT_NAME),
    );
    if (propulsionModule) {
      return {
        characterID,
        moduleItem: propulsionModule,
      };
    }
  }

  assert.fail("Expected an in-space character with an active fitted MWD");
}

function buildSession() {
  const notifications = [];
  return {
    clientID: 65453,
    characterID: 0,
    _notifications: notifications,
    socket: {
      destroyed: false,
    },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendSessionChange() {},
  };
}

function attachCharacterToScene(systemID = 30000142) {
  const scene = spaceRuntime.ensureScene(systemID);
  const session = buildSession();
  const candidate = findPropulsionCandidate();

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
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
  });
  assert.ok(shipEntity);

  session._space.initialStateSent = true;
  scene.markBeyonceBound(session);

  const moduleItem = getFittedModuleItems(session.characterID, shipItem.itemID).find(
    (item) => Number(item.itemID) === Number(candidate.moduleItem.itemID),
  );
  assert.ok(moduleItem, "expected the fitted test ship to have the MWD module");

  return {
    scene,
    session,
    shipItem,
    shipEntity,
    moduleItem,
  };
}

function getDestinyEvents(session, eventName) {
  return session._notifications
    .filter((entry) => entry.name === "DoDestinyUpdate")
    .flatMap((entry) => {
      const payload = entry && entry.payload && entry.payload[0];
      const items = payload && payload.items;
      return Array.isArray(items) ? items : [];
    })
    .filter((entry) => Array.isArray(entry) && entry[1] && entry[1][0] === eventName);
}

function getSpecialFxEvents(session, guid) {
  return getDestinyEvents(session, "OnSpecialFX").filter(
    (entry) => entry[1][1][5] === guid,
  );
}

function getShipEffectNotifications(session) {
  return session._notifications.filter((entry) => entry.name === "OnGodmaShipEffect");
}

function withMockedNow(initialNowMs, callback) {
  const realDateNow = Date.now;
  let currentNowMs = initialNowMs;
  Date.now = () => currentNowMs;
  try {
    return callback({
      getNow: () => currentNowMs,
      setNow: (nextNowMs) => {
        currentNowMs = Number(nextNowMs);
      },
    });
  } finally {
    Date.now = realDateNow;
  }
}

test.afterEach(() => {
  spaceRuntime._testing.clearScenes();
});

test("propulsion activation FX clamps to the owner's visible stamp under TiDi without changing the scene clock", () => {
  const { scene, session, moduleItem } = attachCharacterToScene();

  scene.setTimeDilation(0.5, {
    syncSessions: false,
  });
  scene.tick(scene.getCurrentWallclockMs() + 4000);

  const currentStamp = scene.getCurrentDestinyStamp();
  const result = spaceRuntime.activatePropulsionModule(
    session,
    moduleItem,
    MWD_EFFECT_NAME,
    { repeat: 1000 },
  );

  assert.equal(result.success, true);

  const activationFxEvents = getSpecialFxEvents(session, MWD_GUID);
  const maxSpeedEvents = getDestinyEvents(session, "SetMaxSpeed");
  const currentVisibleStamp = scene.getCurrentVisibleDestinyStampForSession(
    session,
    currentStamp,
  );
  assert.equal(activationFxEvents.length, 1);
  assert.equal(maxSpeedEvents.length, 1);
  assert.equal(
    activationFxEvents[0][0] >= currentVisibleStamp,
    true,
    "MWD activation FX should clamp to the owner's visible history instead of backstepping behind it under TiDi",
  );
  assert.equal(
    maxSpeedEvents[0][0] >= currentVisibleStamp,
    true,
    "MWD prime updates should also clamp to the owner's visible history under TiDi",
  );
  assert.equal(
    activationFxEvents[0][0] >= maxSpeedEvents[0][0],
    true,
    "MWD FX should not backstep behind the prime updates it accompanies",
  );
  assert.equal(
    scene.getCurrentDestinyStamp(),
    currentStamp,
    "using a history-safe FX stamp should not advance the scene's current TiDi clock",
  );
});

test("propulsion deactivation FX also clamps to the owner's visible stamp under TiDi", () => {
  const { scene, session, moduleItem } = attachCharacterToScene();

  scene.setTimeDilation(0.5, {
    syncSessions: false,
  });
  scene.tick(scene.getCurrentWallclockMs() + 4000);

  const activationResult = spaceRuntime.activatePropulsionModule(
    session,
    moduleItem,
    MWD_EFFECT_NAME,
    { repeat: 1000 },
  );
  assert.equal(activationResult.success, true);

  session._notifications.length = 0;
  const currentStamp = scene.getCurrentDestinyStamp();
  const stopResult = scene.finalizePropulsionModuleDeactivation(
    session,
    moduleItem.itemID,
    {
      reason: "manual",
      nowMs: scene.getCurrentSimTimeMs(),
    },
  );

  assert.equal(stopResult.success, true);

  const stopFxEvents = getSpecialFxEvents(session, MWD_GUID);
  const maxSpeedEvents = getDestinyEvents(session, "SetMaxSpeed");
  const currentVisibleStamp = scene.getCurrentVisibleDestinyStampForSession(
    session,
    currentStamp,
  );
  assert.equal(stopFxEvents.length, 1);
  assert.equal(maxSpeedEvents.length, 1);
  assert.equal(
    stopFxEvents[0][0] >= currentVisibleStamp,
    true,
    "MWD stop FX should clamp to the owner's visible history instead of backstepping behind it under TiDi",
  );
  assert.equal(
    maxSpeedEvents[0][0] >= currentVisibleStamp,
    true,
    "MWD stop prime updates should also clamp to the owner's visible history under TiDi",
  );
  assert.equal(
    stopFxEvents[0][0] >= maxSpeedEvents[0][0],
    true,
    "MWD stop FX should not backstep behind the prime updates it accompanies",
  );
  assert.equal(
    scene.getCurrentDestinyStamp(),
    currentStamp,
    "using a history-safe stop stamp should not advance the scene's current TiDi clock",
  );
});

test("propulsion prime and FX clamp to the owner's live session-visible history instead of the raw scene tick", () => {
  const { scene, session, moduleItem } = attachCharacterToScene();

  session._space.clockOffsetMs = 3000;
  scene.refreshSessionClockSnapshot(session);
  const currentVisibleStamp = scene.getCurrentVisibleSessionDestinyStamp(session);

  const result = spaceRuntime.activatePropulsionModule(
    session,
    moduleItem,
    MWD_EFFECT_NAME,
    { repeat: 1000 },
  );

  assert.equal(result.success, true);

  const activationFxEvents = getSpecialFxEvents(session, MWD_GUID);
  const maxSpeedEvents = getDestinyEvents(session, "SetMaxSpeed");
  assert.equal(activationFxEvents.length, 1);
  assert.equal(maxSpeedEvents.length, 1);
  assert.equal(
    maxSpeedEvents[0][0] >= currentVisibleStamp,
    true,
    "MWD prime updates should clamp to the owner's live session-visible history instead of backstepping onto the raw scene tick",
  );
  assert.equal(
    activationFxEvents[0][0] >= currentVisibleStamp,
    true,
    "MWD FX should clamp to the owner's live session-visible history instead of backstepping onto the raw scene tick",
  );
});

test("propulsion restart after a same-tick stop moves ship-prime and FX off the just-stopped presentation tick", () => {
  withMockedNow(1773765000900, ({ getNow, setNow }) => {
    const { scene, session, moduleItem } = attachCharacterToScene();

    const firstActivation = spaceRuntime.activatePropulsionModule(
      session,
      moduleItem,
      MWD_EFFECT_NAME,
      { repeat: 1000 },
    );
    assert.equal(firstActivation.success, true);

    const stopTimeMs = firstActivation.data.effectState.nextCycleAtMs;
    session._notifications.length = 0;
    const stopResult = scene.finalizePropulsionModuleDeactivation(
      session,
      moduleItem.itemID,
      {
        reason: "manual",
        nowMs: stopTimeMs,
      },
    );
    assert.equal(stopResult.success, true);

    const stopStamp = scene.getCurrentDestinyStamp(stopTimeMs);
    const stopEffectNotification = getShipEffectNotifications(session)[0];
    assert.ok(stopEffectNotification, "expected the stop path to emit OnGodmaShipEffect");

    session._notifications.length = 0;
    setNow(stopTimeMs + 50);
    scene.tick(getNow());
    assert.equal(
      scene.getCurrentDestinyStamp(),
      stopStamp,
      "setup should keep the restart inside the same destiny stamp as the stop",
    );

    const restartResult = spaceRuntime.activatePropulsionModule(
      session,
      moduleItem,
      MWD_EFFECT_NAME,
      { repeat: 1000 },
    );
    assert.equal(restartResult.success, true);

    const restartFxEvents = getSpecialFxEvents(session, MWD_GUID);
    const maxSpeedEvents = getDestinyEvents(session, "SetMaxSpeed");
    assert.equal(restartFxEvents.length, 1);
    assert.equal(maxSpeedEvents.length, 1);
    assert.equal(
      restartFxEvents[0][0] > stopStamp,
      true,
      "same-tick propulsion restarts should author FX on a fresh presentation stamp instead of replaying them on the just-stopped tick",
    );
    assert.equal(
      maxSpeedEvents[0][0] > stopStamp,
      true,
      "same-tick propulsion restarts should author ship-prime updates on a fresh presentation stamp instead of replaying them on the just-stopped tick",
    );

    const restartEffectNotification = getShipEffectNotifications(session)[0];
    assert.ok(
      restartEffectNotification,
      "expected the restart path to emit OnGodmaShipEffect",
    );
    assert.equal(
      restartEffectNotification.payload[2] > stopEffectNotification.payload[2],
      true,
      "owner module timing should still advance when the restart is presented on the next tick",
    );
  });
});

test("deferred manual propulsion stop still resolves the owning session when entity.session is missing", () => {
  withMockedNow(1773765001500, ({ getNow, setNow }) => {
    const { scene, session, shipEntity, moduleItem } = attachCharacterToScene();

    const activationResult = spaceRuntime.activatePropulsionModule(
      session,
      moduleItem,
      MWD_EFFECT_NAME,
      { repeat: 1000 },
    );
    assert.equal(activationResult.success, true);

    const pendingStopResult = scene.deactivatePropulsionModule(
      session,
      moduleItem.itemID,
      { reason: "manual" },
    );
    assert.equal(pendingStopResult.success, true);
    assert.ok(
      Number(pendingStopResult.data && pendingStopResult.data.deactivateAtMs) > 0,
      "expected manual stop to defer until the propulsion cycle boundary",
    );

    shipEntity.session = null;
    session._notifications.length = 0;
    setNow(Number(pendingStopResult.data.deactivateAtMs) + 25);
    scene.tick(getNow());

    const stopEffectNotification = getShipEffectNotifications(session).find(
      (entry) =>
        Array.isArray(entry && entry.payload) &&
        Number(entry.payload[0]) === Number(moduleItem.itemID) &&
        Number(entry.payload[3]) === 0,
    );
    assert.ok(
      stopEffectNotification,
      "expected deferred manual propulsion stop to emit an inactive OnGodmaShipEffect packet through the owning session",
    );
  });
});

test("dock transition stops active propulsion effects before the space session detaches", () => {
  const { session, shipEntity, moduleItem } = attachCharacterToScene();

  const activationResult = spaceRuntime.activatePropulsionModule(
    session,
    moduleItem,
    MWD_EFFECT_NAME,
    { repeat: 1000 },
  );
  assert.equal(activationResult.success, true);
  assert.ok(
    shipEntity.activeModuleEffects instanceof Map &&
      shipEntity.activeModuleEffects.has(Number(moduleItem.itemID) || 0),
    "expected propulsion effect to be active before docking",
  );

  const characterRecord = getCharacterRecord(session.characterID);
  const dockStationID = Number(
    (characterRecord && (
      characterRecord.homeStationID ||
      characterRecord.cloneStationID ||
      characterRecord.stationID ||
      characterRecord.stationid
    )) ||
    60003760,
  ) || 60003760;
  assert.ok(
    worldData.getStationByID(dockStationID),
    `expected a valid dock target station ${dockStationID}`,
  );

  session._notifications.length = 0;
  const dockResult = transitions.dockSession(session, dockStationID);
  assert.equal(dockResult.success, true, "expected dock transition to succeed");

  const stopEffectNotification = getShipEffectNotifications(session).find(
    (entry) =>
      Array.isArray(entry && entry.payload) &&
      Number(entry.payload[0]) === Number(moduleItem.itemID) &&
      Number(entry.payload[3]) === 0,
  );
  assert.ok(
    stopEffectNotification,
    "expected dock transition to emit an inactive OnGodmaShipEffect for the active propulsion module",
  );
});
