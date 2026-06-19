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
const destiny = require(path.join(
  repoRoot,
  "server/src/space/destiny",
));
const npcService = require(path.join(
  repoRoot,
  "server/src/space/npc",
));
const ConfigService = require(path.join(
  repoRoot,
  "server/src/services/config/configService",
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

function getMissileEntities(scene) {
  return [...scene.dynamicEntities.values()].filter(
    (entity) => entity && entity.kind === "missile",
  );
}

function getMarshalDictEntry(value, key) {
  if (!value || value.type !== "dict" || !Array.isArray(value.entries)) {
    return undefined;
  }
  const entry = value.entries.find(
    (candidate) => Array.isArray(candidate) && candidate[0] === key,
  );
  return entry ? entry[1] : undefined;
}

function flattenDestinyUpdates(notifications = []) {
  const updates = [];
  for (const notification of notifications) {
    if (
      !notification ||
      notification.name !== "DoDestinyUpdate" ||
      !Array.isArray(notification.payload)
    ) {
      continue;
    }
    const payload = notification.payload[0];
    const items = payload && payload.items;
    if (!Array.isArray(items)) {
      continue;
    }
    for (const entry of items) {
      if (!Array.isArray(entry) || !Array.isArray(entry[1])) {
        continue;
      }
      updates.push({
        stamp: entry[0],
        name: entry[1][0],
        args: Array.isArray(entry[1][1]) ? entry[1][1] : [],
      });
    }
  }
  return updates;
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

test("/mnpc can spawn a launcher-fit Guristas missile battleship that locks and fires missiles", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      984001,
      994001,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const commandResult = executeChatCommand(
    pilotSession,
    "/mnpc 1 guristas_missile_battleship",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(commandResult.handled, true);
  assert.match(commandResult.message, /Dread Pith Extinguisher/i);

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const pilotShipID = Number(pilotSession._space.shipID) || 0;
  const npcSummaries = npcService.getNpcOperatorSummary().filter((summary) => (
    summary.systemID === TEST_SYSTEM_ID &&
    summary.entityType === "npc"
  ));
  assert.equal(npcSummaries.length, 1, "expected exactly one /mnpc test NPC");
  assert.equal(npcSummaries[0].profileID, "guristas_missile_battleship");
  assert.equal(npcSummaries[0].preferredTargetID, pilotShipID);

  const npcEntityID = Number(npcSummaries[0].entityID) || 0;
  const npcEntity = scene.getEntityByID(npcEntityID);
  assert(npcEntity, "expected spawned /mnpc entity");
  assert.equal(npcEntity.maxTargetRange > 0, true);

  const launchedMissile = advanceSceneUntil(
    scene,
    20_000,
    250,
    () => getMissileEntities(scene).some((entity) => Number(entity.sourceShipID) === npcEntityID),
  );
  assert.equal(launchedMissile, true, "expected /mnpc NPC to launch a missile");

  const missile = getMissileEntities(scene).find(
    (entity) => Number(entity.sourceShipID) === npcEntityID,
  );
  assert(missile, "expected a live missile entity from /mnpc");
  assert.ok(
    Array.isArray(missile.launchModules) &&
      missile.launchModules.length > 0 &&
      missile.launchModules.every((moduleID) => Number(moduleID) > 0),
    "expected launcher-fit /mnpc missiles to report real launcher module IDs",
  );
  const slimItem = destiny.buildSlimItemDict(missile);
  assert.equal(getMarshalDictEntry(slimItem, "sourceShipID"), npcEntityID);
  const launchModules = getMarshalDictEntry(slimItem, "launchModules");
  assert.ok(
    Array.isArray(launchModules && launchModules.items) &&
      launchModules.items.length > 0 &&
      launchModules.items.every((moduleID) => Number(moduleID) > 0),
    "expected launcher-fit /mnpc slim items to preserve real launcher module IDs",
  );

  const pilotEntity = scene.getEntityByID(pilotShipID);
  const missileDamageLanded = advanceSceneUntil(
    scene,
    10_000,
    250,
    () => {
      const currentPilotEntity = scene.getEntityByID(pilotShipID);
      return Boolean(
        currentPilotEntity &&
        currentPilotEntity.conditionState &&
        Number(currentPilotEntity.conditionState.shieldCharge) < 1,
      );
    },
  );
  assert.equal(missileDamageLanded, true, "expected /mnpc missile damage to land on the pilot");
  assert.ok(
    Number(pilotEntity.conditionState.shieldCharge) < 1,
    "expected the pilot ship shield to drop after missile impact",
  );
});

test("/npc without arguments now spawns five hulls from the mixed pirate pool", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      984051,
      994051,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const commandResult = executeChatCommand(
    pilotSession,
    "/npc",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(commandResult.handled, true);
  assert.match(commandResult.message, /Spawned 5 hulls from Pirate Hostiles/i);

  const npcSummaries = npcService.getNpcOperatorSummary().filter((summary) => (
    summary.systemID === TEST_SYSTEM_ID &&
    summary.entityType === "npc"
  ));
  assert.equal(npcSummaries.length, 5, "expected bare /npc to default to five pirate hulls");
});

test("/npc faction keywords prefer pirate spawn pools over single-profile aliases", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      984061,
      994061,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const cases = [
    {
      command: "/npc blood 5",
      selectionNamePattern: /Blood Raiders/i,
      expectedCount: 5,
      assertProfile(summary) {
        return String(summary && summary.profileID || "").startsWith("parity_blood_raider_");
      },
    },
    {
      command: "/npc sanshas 4",
      selectionNamePattern: /Sansha/i,
      expectedCount: 4,
      assertProfile(summary) {
        return String(summary && summary.profileID || "").startsWith("parity_sansha_");
      },
    },
    {
      command: "/npc guristas 4",
      selectionNamePattern: /Guristas/i,
      expectedCount: 4,
      assertProfile(summary) {
        return String(summary && summary.profileID || "").startsWith("parity_guristas_");
      },
    },
    {
      command: "/npc blood beam 4",
      selectionNamePattern: /Blood Raiders Beam/i,
      expectedCount: 4,
      assertProfile(summary) {
        const profileID = String(summary && summary.profileID || "");
        return (
          profileID.startsWith("parity_blood_raider_beam_") ||
          profileID === "parity_blood_raider_officer_draclira_merlonne" ||
          profileID === "parity_blood_raider_officer_raysere_giant"
        );
      },
    },
  ];

  for (const testCase of cases) {
    const commandResult = executeChatCommand(
      pilotSession,
      testCase.command,
      null,
      { emitChatFeedback: false },
    );
    assert.equal(commandResult.handled, true, `expected ${testCase.command} to be handled`);
    assert.match(commandResult.message, testCase.selectionNamePattern);

    const npcSummaries = npcService.getNpcOperatorSummary().filter((summary) => (
      summary.systemID === TEST_SYSTEM_ID &&
      summary.entityType === "npc"
    ));
    assert.equal(
      npcSummaries.length,
      testCase.expectedCount,
      `expected ${testCase.command} to spawn the requested number of faction hulls`,
    );
    assert.equal(
      npcSummaries.every((summary) => testCase.assertProfile(summary)),
      true,
      `expected ${testCase.command} to resolve the faction pool instead of a single profile alias`,
    );

    npcService.clearNpcControllersInSystem(TEST_SYSTEM_ID, {
      entityType: "npc",
    });
  }
});

test("/npc spawn does not inject an immediate movement contract on the spawn tick", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      984101,
      994101,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );
  const scene = spaceRuntime.getSceneForSession(pilotSession);
  const preSpawnVisibleStamp = scene.getCurrentVisibleDestinyStampForSession(
    pilotSession,
    scene.getCurrentDestinyStamp(),
  );

  const commandResult = executeChatCommand(
    pilotSession,
    "/npc 1",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(commandResult.handled, true);

  const immediateUpdates = flattenDestinyUpdates(pilotSession.notifications);
  assert.equal(
    immediateUpdates.some((entry) => (
      entry.name === "GotoDirection" ||
      entry.name === "FollowBall" ||
      entry.name === "Orbit" ||
      entry.name === "SetSpeedFraction"
    )),
    false,
    "expected /npc spawn to materialize first and defer the initial movement contract until the next scene tick",
  );
  assert.equal(
    immediateUpdates.some((entry) => entry.name === "AddBalls2"),
    true,
    "expected /npc spawn to remain visible immediately even though movement wake is deferred",
  );
  const addBallsUpdate = immediateUpdates.find((entry) => entry.name === "AddBalls2");
  assert.ok(addBallsUpdate, "expected /npc spawn to emit an AddBalls2 acquire");
  assert.equal(
    addBallsUpdate.stamp >= (preSpawnVisibleStamp + 2),
    true,
    "expected /npc spawn to land two server ticks ahead of the pilot's current visible tick so it reaches Michelle as a held-future update instead of current/current",
  );
  assert.equal(
    addBallsUpdate.stamp <= (preSpawnVisibleStamp + 2),
    true,
    "expected /npc spawn to use the calibrated +2 server headroom instead of a current/current lane",
  );
});

test("/npc spawn clears an already-presented owner gotoDirection lane instead of materializing on it", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      984151,
      994151,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );
  const scene = spaceRuntime.getSceneForSession(pilotSession);
  assert.ok(scene, "expected pilot scene to exist");

  assert.equal(
    scene.gotoDirection(pilotSession, { x: -0.6, y: -0.3, z: -0.7 }),
    true,
    "expected the pilot to establish a live owner movement lane before /npc spawn",
  );
  const movementUpdates = flattenDestinyUpdates(pilotSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  assert.equal(movementUpdates.length, 1, "expected a direct owner gotoDirection echo");
  const ownerMovementStamp = movementUpdates[0].stamp >>> 0;

  pilotSession.notifications.length = 0;

  const commandResult = executeChatCommand(
    pilotSession,
    "/npc 1",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(commandResult.handled, true);

  const immediateUpdates = flattenDestinyUpdates(pilotSession.notifications);
  const addBallsUpdate = immediateUpdates.find((entry) => entry.name === "AddBalls2");
  assert.ok(addBallsUpdate, "expected /npc spawn to emit an AddBalls2 acquire");
  assert.equal(
    addBallsUpdate.stamp,
    ((ownerMovementStamp + 2) >>> 0),
    "expected /npc fresh acquire materialization to clear the already-presented owner movement lane with the held-future addballs headroom",
  );
});

test("config owner lookup returns a generic row for ownerID 0 instead of an empty prime payload", () => {
  const configService = new ConfigService();
  const result = configService.Handle_GetMultiOwnersEx([[0]], null);

  assert.deepEqual(
    result,
    [[
      "ownerID",
      "ownerName",
      "typeID",
      "gender",
      "ownerNameID",
    ], [[0, "Item 0", 0, 0, null]]],
    "expected cfg.eveowners.Prime([0]) to get a generic owner row instead of an empty result that crashes cfg._Prime",
  );
});

test("/fire dummy spawn uses the default materialization path without injecting an immediate movement contract", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      984201,
      994201,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const commandResult = executeChatCommand(
    pilotSession,
    "/fire Drake",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(commandResult.handled, true);

  const immediateUpdates = flattenDestinyUpdates(pilotSession.notifications);
  const addBallsUpdate = immediateUpdates.find((entry) => entry.name === "AddBalls2");
  assert.ok(addBallsUpdate, "expected /fire dummy spawn to emit an AddBalls2 acquire");
  assert.equal(
    immediateUpdates.some((entry) => (
      entry.name === "GotoDirection" ||
      entry.name === "FollowBall" ||
      entry.name === "Orbit" ||
      entry.name === "SetSpeedFraction"
    )),
    false,
    "expected /fire dummy spawn to remain a plain materialization update on the spawn tick",
  );

  const dummyMatch = /dummy hull (\d+)/.exec(String(commandResult.message || ""));
  const dummyID = dummyMatch ? Number(dummyMatch[1]) || 0 : 0;
  assert.ok(dummyID > 0, "expected /fire to report the spawned dummy hull ID");
  assert.ok(
    dummyID >= 3900000000000000,
    "expected /fire dummy hulls to use the dedicated debug-combat ID range",
  );

  const scene = spaceRuntime.getSceneForSession(pilotSession);
  assert.ok(scene, "expected /fire pilot scene to exist");
  scene.tick(scene.getCurrentWallclockMs() + 1000);

  const dummyEntity = scene.getEntityByID(dummyID);
  assert.ok(dummyEntity, "expected /fire dummy hull to remain present in the scene");
  const lockResult = scene.addTarget(pilotSession, dummyID);
  assert.equal(
    lockResult && lockResult.success,
    true,
    "expected the freshly spawned /fire dummy hull to stay targetable after its initial acquire",
  );
});

test("/npc aggression flushes the first combat movement contract after fresh-acquire protection clears", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      984301,
      994301,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );
  const scene = spaceRuntime.getSceneForSession(pilotSession);
  assert.ok(scene, "expected pilot scene to exist");

  const commandResult = executeChatCommand(
    pilotSession,
    "/npc 1",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(commandResult.handled, true);

  const npcSummaries = npcService.getNpcOperatorSummary().filter((summary) => (
    summary.systemID === TEST_SYSTEM_ID &&
    summary.entityType === "npc"
  ));
  assert.equal(npcSummaries.length, 1, "expected exactly one /npc test NPC");

  const npcEntity = scene.getEntityByID(Number(npcSummaries[0].entityID) || 0);
  const pilotEntity = scene.getEntityByID(Number(pilotSession._space.shipID) || 0);
  assert.ok(npcEntity, "expected spawned /npc entity");
  assert.ok(pilotEntity, "expected pilot ship entity");

  pilotSession.notifications.length = 0;

  const aggressionNow = scene.getCurrentSimTimeMs();
  npcService.noteNpcIncomingAggression(npcEntity, pilotEntity, aggressionNow);

  const firstTickWallclock = scene.getCurrentWallclockMs() + 1000;
  scene.tick(firstTickWallclock);

  const firstTickMovement = flattenDestinyUpdates(pilotSession.notifications)
    .filter((entry) => (
      entry.name === "FollowBall" ||
      entry.name === "Orbit" ||
      entry.name === "GotoDirection" ||
      entry.name === "SetSpeedFraction"
    ));
  assert.equal(
    firstTickMovement.length,
    0,
    "expected aggression-driven NPC movement to queue on the think tick instead of rebasing the pilot immediately",
  );
  assert.equal(
    ["FOLLOW", "ORBIT", "GOTO"].includes(String(npcEntity.mode || "")),
    true,
    "expected incoming aggression to wake the hostile into a live combat movement mode immediately server-side",
  );
  assert.equal(
    Number(npcEntity.speedFraction || 0) > 0,
    true,
    "expected the hostile to keep real movement state while the fresh-acquire replay remains queued",
  );

  scene.tick(firstTickWallclock + 1000);

  const secondTickMovement = flattenDestinyUpdates(pilotSession.notifications)
    .filter((entry) => (
      entry.name === "FollowBall" ||
      entry.name === "Orbit" ||
      entry.name === "GotoDirection" ||
      entry.name === "SetSpeedFraction"
    ));
  assert.equal(
    secondTickMovement.length,
    0,
    "expected the queued hostile movement contract to stay deferred while fresh-acquire protection is still active",
  );

  scene.tick(firstTickWallclock + 2000);

  const thirdTickMovement = flattenDestinyUpdates(pilotSession.notifications)
    .filter((entry) => (
      entry.name === "FollowBall" ||
      entry.name === "Orbit" ||
      entry.name === "GotoDirection" ||
      entry.name === "SetSpeedFraction"
    ));
  assert.equal(
    thirdTickMovement.length,
    0,
    "expected the queued hostile movement contract to remain deferred until the fresh-acquire release tick arrives",
  );

  scene.tick(firstTickWallclock + 3000);

  const flushedMovement = flattenDestinyUpdates(pilotSession.notifications)
    .filter((entry) => (
      entry.name === "FollowBall" ||
      entry.name === "Orbit" ||
      entry.name === "GotoDirection" ||
      entry.name === "SetSpeedFraction"
    ));
  assert.equal(
    flushedMovement.length > 0,
    true,
    "expected the first /npc combat movement contract to flush on the fresh-acquire release tick instead of being dropped forever",
  );
  assert.equal(
    flushedMovement.some((entry) => (
      entry.name === "FollowBall" || entry.name === "Orbit"
    )),
    true,
    "expected the flushed /npc movement to include a real pursuit contract instead of staying permanently bootstrap-only",
  );
  assert.equal(
    npcEntity.targetEntityID,
    pilotEntity.itemID,
    "expected the hostile to still choose the pilot as its live aggression target",
  );
});
