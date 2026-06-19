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
const {
  ONE_AU_IN_METERS,
  findSafeWarpOriginAnchor,
} = require(path.join(
  repoRoot,
  "server/src/space/npc/npcWarpOrigins",
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

function clonePosition(position) {
  return {
    x: Number(position && position.x) || 0,
    y: Number(position && position.y) || 0,
    z: Number(position && position.z) || 0,
  };
}

function distance(left, right) {
  const dx = (Number(left && left.x) || 0) - (Number(right && right.x) || 0);
  const dy = (Number(left && left.y) || 0) - (Number(right && right.y) || 0);
  const dz = (Number(left && left.z) || 0) - (Number(right && right.z) || 0);
  return Math.sqrt((dx ** 2) + (dy ** 2) + (dz ** 2));
}

function getVisibleDynamicEntityIDs(session) {
  return session &&
    session._space &&
    session._space.visibleDynamicEntityIDs instanceof Set
    ? session._space.visibleDynamicEntityIDs
    : new Set();
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

test.afterEach(() => {
  for (const session of registeredSessions.splice(0)) {
    sessionRegistry.unregister(session);
  }
  spaceRuntime._testing.clearScenes();
});

test("/deadwarp force-starts a warp from the pilot's current position to a safe off-grid point", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      983001,
      993001,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );
  const observerSession = registerAttachedSession(
    createFakeSession(
      983002,
      993002,
      { x: -107303358560, y: -18744975360, z: 436489052160 },
      { x: -1, y: 0, z: 0 },
    ),
  );

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const pilotShipID = Number(pilotSession._space.shipID) || 0;
  const originalEntity = scene.getEntityByID(pilotShipID);
  assert(originalEntity, "expected pilot ship entity");
  const originalPosition = clonePosition(originalEntity.position);
  const expectedAnchor = findSafeWarpOriginAnchor(scene, originalEntity, {
    clearanceMeters: ONE_AU_IN_METERS,
    minDistanceMeters: ONE_AU_IN_METERS * 2,
    maxDistanceMeters: ONE_AU_IN_METERS * 4,
    stepMeters: ONE_AU_IN_METERS / 2,
  });
  assert.equal(
    getVisibleDynamicEntityIDs(observerSession).has(pilotShipID),
    true,
    "observer should initially see the pilot",
  );

  const commandResult = executeChatCommand(
    pilotSession,
    "/deadwarp",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(commandResult.handled, true);
  assert.match(commandResult.message, /Deadwarp started to a safe point/i);

  const warpedEntity = scene.getEntityByID(pilotShipID);
  assert(warpedEntity, "expected pilot ship entity after /deadwarp");
  assert.equal(warpedEntity.mode, "WARP");
  assert(warpedEntity.warpState, "expected active warp state");
  assert.equal(
    warpedEntity.warpState.commandStamp > 0,
    true,
    "deadwarp should keep a non-zero pilot warp command stamp",
  );
  assert.equal(
    warpedEntity.warpState.effectStamp > 0,
    true,
    "deadwarp should keep a non-zero pilot warp effect stamp",
  );
  assert.equal(
    warpedEntity.warpState.commandStamp,
    warpedEntity.warpState.effectStamp,
    "deadwarp should keep pilot warp command/effect stamps aligned",
  );
  assert.equal(
    distance(warpedEntity.position, originalPosition) < 1,
    true,
    "pilot should start the warp from the original position instead of teleporting first",
  );
  assert.equal(
    distance(warpedEntity.warpState.origin, originalPosition) < 1,
    true,
    "warp origin should remain the pilot's current position",
  );
  assert.equal(
    distance(warpedEntity.warpState.rawDestination, expectedAnchor.position) < 1,
    true,
    "warp raw destination should be the generated safe point",
  );
  assert.equal(
    distance(warpedEntity.warpState.targetPoint, expectedAnchor.position) < 1,
    true,
    "warp target point should be the generated safe point",
  );
  assert.equal(
    distance(warpedEntity.warpState.targetPoint, originalPosition) >= (ONE_AU_IN_METERS * 1.75),
    true,
    "deadwarp destination should still be safely off-grid",
  );
  assert.equal(
    getVisibleDynamicEntityIDs(observerSession).has(pilotShipID),
    true,
    "observer should still see the pilot at the departure point immediately after warp start",
  );

  const observerLostPilot = advanceSceneUntil(
    scene,
    20_000,
    250,
    () => !getVisibleDynamicEntityIDs(observerSession).has(pilotShipID),
  );
  assert.equal(observerLostPilot, true, "observer should lose the pilot once the deadwarp leaves grid");
});
