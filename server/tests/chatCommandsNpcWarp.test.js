const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const repoRoot = path.join(__dirname, "..", "..");
const { executeChatCommand } = require(path.join(
  repoRoot,
  "server/src/services/chat/chatCommands",
));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));
const spaceRuntime = require(path.join(
  repoRoot,
  "server/src/space/runtime",
));
const npcService = require(path.join(
  repoRoot,
  "server/src/space/npc",
));

const TEST_SYSTEM_ID = 30000142;
const registeredSessions = [];

function createFakeSession(clientID, characterID, position, direction = { x: 1, y: 0, z: 0 }) {
  const notifications = [];
  return {
    clientID,
    characterID,
    charID: characterID,
    characterName: `char-${characterID}`,
    shipName: `ship-${characterID}`,
    corporationID: 1,
    allianceID: 0,
    warFactionID: 0,
    solarsystemid: TEST_SYSTEM_ID,
    solarsystemid2: TEST_SYSTEM_ID,
    socket: { destroyed: false },
    notifications,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    shipItem: {
      itemID: clientID + 100000,
      typeID: 606,
      ownerID: characterID,
      groupID: 25,
      categoryID: 6,
      radius: 50,
      spaceState: {
        position,
        velocity: { x: 0, y: 0, z: 0 },
        direction,
        mode: "STOP",
        speedFraction: 0,
      },
    },
  };
}

function registerAttachedSession(session) {
  registeredSessions.push(session);
  sessionRegistry.register(session);
  spaceRuntime.attachSession(session, session.shipItem, {
    systemID: TEST_SYSTEM_ID,
    broadcast: false,
    spawnStopped: true,
  });
  assert.equal(
    spaceRuntime.ensureInitialBallpark(session),
    true,
    "expected test session to finish initial ballpark bootstrap",
  );
  session.notifications.length = 0;
  return session;
}

function advanceSceneUntil(scene, maxDurationMs, stepMs, predicate) {
  let wallclockNow = scene.getCurrentWallclockMs();
  const maxSteps = Math.max(1, Math.ceil(maxDurationMs / Math.max(1, stepMs)));
  for (let index = 0; index < maxSteps; index += 1) {
    wallclockNow += Math.max(1, stepMs);
    scene.tick(wallclockNow);
    if (predicate()) {
      return true;
    }
  }
  return false;
}

function getVisibleDynamicEntityIDs(session) {
  return session &&
    session._space &&
    session._space.visibleDynamicEntityIDs instanceof Set
    ? session._space.visibleDynamicEntityIDs
    : new Set();
}

function flattenDestinyPayloadNames(notifications) {
  return notifications.flatMap((notification) =>
    ((((notification || {}).payload || [])[0] || {}).items || []).map(
      (entry) => entry[1][0],
    ),
  );
}

test.afterEach(() => {
  for (const session of registeredSessions.splice(0)) {
    sessionRegistry.unregister(session);
  }
  npcService.clearNpcControllersInSystem(TEST_SYSTEM_ID, {
    entityType: "all",
  });
  spaceRuntime._testing.clearScenes();
});

test("/npcw spawns a transient NPC off-grid and acquires through warp-in", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      982001,
      992001,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );
  const observerSession = registerAttachedSession(
    createFakeSession(
      982002,
      992002,
      { x: -107303358560, y: -18744975360, z: 436489052160 },
      { x: -1, y: 0, z: 0 },
    ),
  );

  const commandResult = executeChatCommand(
    pilotSession,
    "/npcw 1",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(commandResult.handled, true);
  assert.match(commandResult.message, /Warping it in from a safe off-grid origin/i);

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const pilotShipID = Number(pilotSession._space.shipID) || 0;
  const npcSummaries = npcService.getNpcOperatorSummary().filter((summary) => (
    summary.systemID === TEST_SYSTEM_ID &&
    summary.entityType === "npc"
  ));
  assert.equal(npcSummaries.length, 1, "expected exactly one /npcw test NPC");

  const npcEntityID = Number(npcSummaries[0].entityID) || 0;
  const npcEntity = scene.getEntityByID(npcEntityID);
  assert(npcEntity, "expected spawned NPC entity");
  assert.equal(npcEntity.nativeNpc, true);
  assert.equal(npcEntity.transient, true);
  const npcController = npcService.getControllerByEntityID(npcEntityID);
  assert(npcController, "expected /npcw test NPC controller");
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      npcController.behaviorOverrides || {},
      "useChasePropulsion",
    ),
    false,
    "expected plain /npcw to keep authored chase behavior unchanged",
  );
  assert.equal(getVisibleDynamicEntityIDs(pilotSession).has(npcEntityID), false);
  assert.equal(getVisibleDynamicEntityIDs(observerSession).has(npcEntityID), false);

  let firstPilotAcquireMode = null;
  let firstObserverAcquireMode = null;
  const acquiredDuringWarp = advanceSceneUntil(
    scene,
    15_000,
    250,
    () => {
      const visibleToPilot = getVisibleDynamicEntityIDs(pilotSession).has(npcEntityID);
      const visibleToObserver = getVisibleDynamicEntityIDs(observerSession).has(npcEntityID);
      if (visibleToPilot && firstPilotAcquireMode === null) {
        firstPilotAcquireMode = String(
          (scene.getEntityByID(npcEntityID) || {}).mode || "",
        );
      }
      if (visibleToObserver && firstObserverAcquireMode === null) {
        firstObserverAcquireMode = String(
          (scene.getEntityByID(npcEntityID) || {}).mode || "",
        );
      }
      return visibleToPilot && visibleToObserver;
    },
  );
  assert.equal(acquiredDuringWarp, true, "expected /npcw NPC to become visible");
  assert.equal(firstPilotAcquireMode, "WARP");
  assert.equal(firstObserverAcquireMode, "WARP");

  const responseNames = [
    ...flattenDestinyPayloadNames(pilotSession.notifications),
    ...flattenDestinyPayloadNames(observerSession.notifications),
  ];
  assert(responseNames.includes("EntityWarpIn"));
  assert.equal(responseNames.includes("WarpTo"), false);

  const engagedPilot = advanceSceneUntil(
    scene,
    12_000,
    250,
    () => {
      const entity = scene.getEntityByID(npcEntityID);
      return entity &&
        (entity.mode === "GOTO" || entity.mode === "FOLLOW" || entity.mode === "ORBIT") &&
        (
          Number(entity.targetEntityID) === pilotShipID ||
          npcService.getNpcOperatorSummary().some((summary) => (
            Number(summary.entityID) === npcEntityID &&
            Number(summary.preferredTargetID) === pilotShipID
          ))
        );
    },
  );
  assert.equal(engagedPilot, true, "expected warped-in NPC to resume active pursuit");
});

test("/wnpc enables chase propulsion override on warped NPC spawns", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      983001,
      993001,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const commandResult = executeChatCommand(
    pilotSession,
    "/wnpc 1",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(commandResult.handled, true);
  assert.match(commandResult.message, /Chase propulsion override enabled/i);

  const npcSummaries = npcService.getNpcOperatorSummary().filter((summary) => (
    summary.systemID === TEST_SYSTEM_ID &&
    summary.entityType === "npc"
  ));
  assert.equal(npcSummaries.length, 1, "expected exactly one /wnpc test NPC");

  const npcEntityID = Number(npcSummaries[0].entityID) || 0;
  const npcController = npcService.getControllerByEntityID(npcEntityID);
  assert(npcController, "expected /wnpc test NPC controller");
  assert.equal(
    npcController.behaviorOverrides.useChasePropulsion,
    true,
    "expected /wnpc to force chase propulsion on",
  );
  assert.match(
    npcController.behaviorOverrides.syntheticChasePropulsionTier,
    /^(small|medium|large)$/,
    "expected /wnpc to assign a valid synthetic chase tier",
  );
  assert.equal(
    npcController.behaviorOverrides.chasePropulsionActivateDistanceMeters,
    10_000,
  );
  assert.equal(
    npcController.behaviorOverrides.chasePropulsionDeactivateDistanceMeters,
    10_000,
  );
  assert.equal(
    npcController.behaviorOverrides.returnToHomeWhenIdle,
    false,
    "expected /wnpc to keep warped-in pirates from leashing back to the off-grid origin",
  );
  assert.equal(
    npcController.behaviorOverrides.leashRangeMeters,
    0,
    "expected /wnpc to disable the default pirate leash range",
  );

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const pilotShipID = Number(pilotSession.shipItem.itemID) || 0;
  const engagedPilot = advanceSceneUntil(
    scene,
    12_000,
    250,
    () => {
      const entity = scene.getEntityByID(npcEntityID);
      const controller = npcService.getControllerByEntityID(npcEntityID);
      return Boolean(
        entity &&
        controller &&
        controller.returningHome !== true &&
        Number(controller.currentTargetID) === pilotShipID &&
        (
          entity.mode === "FOLLOW" ||
          entity.mode === "ORBIT" ||
          scene.getTargetsForEntity(entity).includes(pilotShipID) ||
          scene.getSortedPendingTargetLocks(entity).some(
            (pendingLock) => Number(pendingLock && pendingLock.targetID) === pilotShipID,
          )
        )
      );
    },
  );
  assert.equal(
    engagedPilot,
    true,
    "expected /wnpc to stay engaged with the pilot after landing",
  );

  const pilotEntity = scene.getEntityByID(pilotShipID);
  assert(pilotEntity, "expected pilot entity for /wnpc propulsion test");
  pilotEntity.position = {
    ...pilotEntity.position,
    x: Number(pilotEntity.position.x) + 100_000,
  };
  pilotEntity.targetPoint = { ...pilotEntity.position };

  const activatedSyntheticPropulsion = advanceSceneUntil(
    scene,
    5_000,
    250,
    () => {
      const entity = scene.getEntityByID(npcEntityID);
      if (!entity || !(entity.activeModuleEffects instanceof Map)) {
        return false;
      }
      return [...entity.activeModuleEffects.values()].some(
        (effectState) => effectState && effectState.npcSyntheticPropulsion === true,
      );
    },
  );
  assert.equal(
    activatedSyntheticPropulsion,
    true,
    "expected /wnpc to activate synthetic chase propulsion after the pilot opens range",
  );
});
