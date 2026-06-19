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

test.afterEach(() => {
  for (const session of registeredSessions.splice(0)) {
    sessionRegistry.unregister(session);
  }
  npcService.clearNpcControllersInSystem(TEST_SYSTEM_ID, {
    entityType: "all",
    removeContents: true,
  });
  spaceRuntime._testing.clearScenes();
});

test("/npc now accepts 50 spawns in one command", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      985001,
      995001,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const commandResult = executeChatCommand(
    pilotSession,
    "/npc 50",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(commandResult.handled, true);
  assert.match(commandResult.message, /spawned 50/i);

  const npcSummaries = npcService.getNpcOperatorSummary().filter((summary) => (
    summary.systemID === TEST_SYSTEM_ID &&
    summary.entityType === "npc"
  ));
  assert.equal(npcSummaries.length, 50, "expected /npc 50 to spawn 50 NPCs");
});

test("/npctest now accepts 50 spawns in one command", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      985101,
      995101,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const commandResult = executeChatCommand(
    pilotSession,
    "/npctest 50",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(commandResult.handled, true);
  assert.match(commandResult.message, /spawned 50 stationary \/npctest npcs/i);

  const npcSummaries = npcService.getNpcOperatorSummary().filter((summary) => (
    summary.systemID === TEST_SYSTEM_ID &&
    summary.operatorKind === "npctest"
  ));
  assert.equal(npcSummaries.length, 50, "expected /npctest 50 to spawn 50 NPCs");
});

test("/mnpc now defaults to five spawns", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      985151,
      995151,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const commandResult = executeChatCommand(
    pilotSession,
    "/mnpc",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(commandResult.handled, true);
  assert.match(commandResult.message, /spawned 5/i);

  const npcSummaries = npcService.getNpcOperatorSummary().filter((summary) => (
    summary.systemID === TEST_SYSTEM_ID &&
    summary.entityType === "npc"
  ));
  assert.equal(npcSummaries.length, 5, "expected bare /mnpc to default to five NPCs");
});

test("/npctest now defaults to five spawns", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      985161,
      995161,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const commandResult = executeChatCommand(
    pilotSession,
    "/npctest",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(commandResult.handled, true);
  assert.match(commandResult.message, /spawned 5 stationary \/npctest npcs/i);

  const npcSummaries = npcService.getNpcOperatorSummary().filter((summary) => (
    summary.systemID === TEST_SYSTEM_ID &&
    summary.operatorKind === "npctest"
  ));
  assert.equal(npcSummaries.length, 5, "expected bare /npctest to default to five NPCs");
});

test("/mnpc and /npctest2 still reject counts above 50", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      985201,
      995201,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const missileResult = executeChatCommand(
    pilotSession,
    "/mnpc 51",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(missileResult.handled, true);
  assert.match(missileResult.message, /between 1 and 50/i);

  const npcTestResult = executeChatCommand(
    pilotSession,
    "/npctest2 51",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(npcTestResult.handled, true);
  assert.match(npcTestResult.message, /between 1 and 50/i);
});
