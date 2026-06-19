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

function getFighterEntities(scene, controllerID) {
  const numericControllerID = Number(controllerID) || 0;
  return [...scene.dynamicEntities.values()].filter((entity) => (
    entity &&
    entity.kind === "fighter" &&
    Number(entity.controllerID) === numericControllerID
  ));
}

function repositionEntityNear(scene, entityID, anchorID, distanceMeters = 12_000) {
  const entity = scene.getEntityByID(Number(entityID) || 0);
  const anchor = scene.getEntityByID(Number(anchorID) || 0);
  assert(entity, `expected entity ${entityID} to exist`);
  assert(anchor, `expected anchor ${anchorID} to exist`);

  const nextPosition = {
    x: Number(anchor.position && anchor.position.x) + Number(distanceMeters || 0),
    y: Number(anchor.position && anchor.position.y) || 0,
    z: Number(anchor.position && anchor.position.z) || 0,
  };
  entity.position = nextPosition;
  entity.targetPoint = { ...nextPosition };
  entity.velocity = { x: 0, y: 0, z: 0 };
  if (entity.spaceState && typeof entity.spaceState === "object") {
    entity.spaceState.position = { ...nextPosition };
    entity.spaceState.targetPoint = { ...nextPosition };
    entity.spaceState.velocity = { x: 0, y: 0, z: 0 };
  }
  return entity;
}

function boostEntityLocking(entity, scanResolution = 2_500) {
  assert(entity, "expected entity to exist");
  entity.scanResolution = Math.max(Number(entity.scanResolution) || 0, Number(scanResolution) || 0);
  if (entity.passiveDerivedState && typeof entity.passiveDerivedState === "object") {
    entity.passiveDerivedState.scanResolution = entity.scanResolution;
  }
  return entity;
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

test("capital command family exposes info and live status", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      987001,
      997001,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const infoResult = executeChatCommand(
    pilotSession,
    "/capnpcinfo bloodtitan",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(infoResult.handled, true);
  assert.match(infoResult.message, /Dark Blood Titan/);
  assert.match(infoResult.message, /240,000,000 ISK/);

  const spawnResult = executeChatCommand(
    pilotSession,
    "/capnpc 2 titans",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(spawnResult.handled, true);

  const statusResult = executeChatCommand(
    pilotSession,
    "/capnpcstatus titans",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(statusResult.handled, true);
  assert.match(statusResult.message, /Live Capital Titans: 2 hulls/i);
});

test("capital command family can retarget and send capitals home", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      987101,
      997101,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  executeChatCommand(
    pilotSession,
    "/capnpc 1 bloodtitan",
    null,
    { emitChatFeedback: false },
  );
  const summary = npcService.getNpcOperatorSummary().find((entry) => (
    entry.systemID === TEST_SYSTEM_ID &&
    entry.profileID === "capital_dark_blood_titan"
  ));
  assert(summary, "expected spawned blood titan");

  const targetResult = executeChatCommand(
    pilotSession,
    "/capnpctarget bloodtitan me",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(targetResult.handled, true);
  assert.match(targetResult.message, /Set attack order/i);

  const targetedSummary = npcService.getNpcOperatorSummary().find((entry) => (
    entry.entityID === summary.entityID
  ));
  assert.equal(targetedSummary.manualOrderType, "attack");
  assert.equal(
    Number(targetedSummary.currentTargetID) || Number(targetedSummary.preferredTargetID) || 0,
    Number(pilotSession.shipItem.itemID),
  );
  const targetedController = npcService.getControllerByEntityID(summary.entityID);
  assert.equal(targetedController.manualOrder.keepLock, true);
  assert.equal(targetedController.manualOrder.allowWeapons, true);

  const homeResult = executeChatCommand(
    pilotSession,
    "/capnpchome bloodtitan",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(homeResult.handled, true);
  assert.match(homeResult.message, /return-home/i);

  const homeSummary = npcService.getNpcOperatorSummary().find((entry) => (
    entry.entityID === summary.entityID
  ));
  assert.equal(homeSummary.manualOrderType, "returnHome");
});

test("capital attack orders clear stale destroyed targets and reacquire replacement ships", () => {
  const firstSession = registerAttachedSession(
    createFakeSession(
      987151,
      997151,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  executeChatCommand(
    firstSession,
    "/capnpc 1 bloodtitan",
    null,
    { emitChatFeedback: false },
  );
  const summary = npcService.getNpcOperatorSummary().find((entry) => (
    entry.systemID === TEST_SYSTEM_ID &&
    entry.profileID === "capital_dark_blood_titan"
  ));
  assert(summary, "expected spawned blood titan");

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const titan = scene.getEntityByID(Number(summary.entityID) || 0);
  assert(titan, "expected spawned titan entity");
  boostEntityLocking(titan);
  repositionEntityNear(
    scene,
    Number(firstSession.shipItem.itemID),
    titan.itemID,
    12_000,
  );

  const targetResult = executeChatCommand(
    firstSession,
    "/capnpctarget bloodtitan me",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(targetResult.handled, true);

  spaceRuntime.detachSession(firstSession, { broadcast: false });
  sessionRegistry.unregister(firstSession);
  const firstIndex = registeredSessions.indexOf(firstSession);
  if (firstIndex >= 0) {
    registeredSessions.splice(firstIndex, 1);
  }

  const replacementSession = registerAttachedSession(
    createFakeSession(
      987152,
      997152,
      { x: -107303350560, y: -18744975360, z: 436489052160 },
    ),
  );
  repositionEntityNear(
    scene,
    Number(replacementSession.shipItem.itemID),
    titan.itemID,
    12_000,
  );

  const reacquired = advanceSceneUntil(
    scene,
    12_000,
    250,
    () => {
      const liveSummary = npcService.getNpcOperatorSummary().find((entry) => (
        Number(entry && entry.entityID) === Number(summary.entityID)
      ));
      return Boolean(
        liveSummary &&
        Number(liveSummary.currentTargetID) === Number(replacementSession.shipItem.itemID),
      );
    },
  );
  assert.equal(reacquired, true, "expected titan to reacquire a replacement ship after the original target vanished");

  const controller = npcService.getControllerByEntityID(summary.entityID);
  assert.equal(controller.manualOrder, null);
});

test("capital fighter commands can launch and reset supercarrier wings", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      987201,
      997201,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  executeChatCommand(
    pilotSession,
    "/capnpc 1 true sansha supercarrier",
    null,
    { emitChatFeedback: false },
  );
  const summary = npcService.getNpcOperatorSummary().find((entry) => (
    entry.systemID === TEST_SYSTEM_ID &&
    entry.profileID === "capital_true_sanshas_supercarrier"
  ));
  assert(summary, "expected spawned true sansha supercarrier");

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const carrier = scene.getEntityByID(Number(summary.entityID) || 0);
  assert(carrier, "expected spawned carrier entity");
  boostEntityLocking(carrier);
  repositionEntityNear(
    scene,
    Number(pilotSession.shipItem.itemID),
    carrier.itemID,
    12_000,
  );

  const launchCommand = executeChatCommand(
    pilotSession,
    "/capnpcfighters launch true sansha supercarrier",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(launchCommand.handled, true);
  assert.match(launchCommand.message, /Queued fighter relaunch/i);

  const launched = advanceSceneUntil(
    scene,
    8_000,
    250,
    () => getFighterEntities(scene, carrier.itemID).length >= 1,
  );
  assert.equal(launched, true, "expected fighter command to cause a launch");

  const statusCommand = executeChatCommand(
    pilotSession,
    "/capnpcfighters status true sansha supercarrier",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(statusCommand.handled, true);
  assert.match(statusCommand.message, /fighters=1|fighters=2|fighters=3|fighters=4|fighters=5/);

  const resetCommand = executeChatCommand(
    pilotSession,
    "/capnpcfighters reset true sansha supercarrier",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(resetCommand.handled, true);
  assert.match(resetCommand.message, /Reset fighter wings/i);
  assert.equal(getFighterEntities(scene, carrier.itemID).length, 0);
});

test("capital superweapon commands can arm titans and cleanup them", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      987301,
      997301,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  executeChatCommand(
    pilotSession,
    "/capnpc 1 bloodtitan",
    null,
    { emitChatFeedback: false },
  );
  const summary = npcService.getNpcOperatorSummary().find((entry) => (
    entry.systemID === TEST_SYSTEM_ID &&
    entry.profileID === "capital_dark_blood_titan"
  ));
  assert(summary, "expected spawned blood titan");

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const titan = scene.getEntityByID(Number(summary.entityID) || 0);
  assert(titan, "expected titan entity");
  boostEntityLocking(titan);
  repositionEntityNear(
    scene,
    Number(pilotSession.shipItem.itemID),
    titan.itemID,
    15_000,
  );

  const superStatus = executeChatCommand(
    pilotSession,
    "/capnpcsuper status bloodtitan",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(superStatus.handled, true);
  assert.match(superStatus.message, /module=24550/);

  const superFire = executeChatCommand(
    pilotSession,
    "/capnpcsuper fire bloodtitan me",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(superFire.handled, true);
  assert.match(superFire.message, /Armed superweapons/i);

  const controller = npcService.getControllerByEntityID(summary.entityID);
  assert(controller, "expected titan controller after /capnpcsuper fire");
  const armedSummary = npcService.getNpcOperatorSummary().find((entry) => (
    entry.entityID === summary.entityID
  ));
  assert.equal(armedSummary.manualOrderType, "attack");
  assert.equal(
    Number(armedSummary.currentTargetID) || Number(armedSummary.preferredTargetID) || 0,
    Number(pilotSession.shipItem.itemID),
  );
  assert.equal(controller.manualOrder.keepLock, true);
  assert.equal(controller.manualOrder.allowWeapons, true);
  assert.equal(
    Number(controller.capitalNpcState && controller.capitalNpcState.nextSuperweaponAttemptAtMs) || 0,
    0,
    "expected /capnpcsuper fire to clear the superweapon retry gate",
  );

  const clearResult = executeChatCommand(
    pilotSession,
    "/capnpcclear bloodtitan",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(clearResult.handled, true);
  assert.match(clearResult.message, /Cleared 1 Dark Blood Titan/i);
  assert.equal(
    npcService.getNpcOperatorSummary().filter((entry) => entry.systemID === TEST_SYSTEM_ID).length,
    0,
  );
});

test("capital signoff command prepares a fresh titan superweapon validation pass", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      987351,
      997351,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const signoffResult = executeChatCommand(
    pilotSession,
    "/capnpcsignoff bloodtitan me",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(signoffResult.handled, true);
  assert.match(signoffResult.message, /Prepared Dark Blood Titan#/i);
  assert.match(signoffResult.message, /Spawned fresh hull|Reused live hull/i);
  assert.match(signoffResult.message, /fx=effects\.SuperWeaponAmarr/i);
  assert.match(signoffResult.message, /Fuel \d+\/\d+ Helium Isotopes/i);

  const summary = npcService.getNpcOperatorSummary().find((entry) => (
    entry.systemID === TEST_SYSTEM_ID &&
    entry.profileID === "capital_dark_blood_titan"
  ));
  assert(summary, "expected signoff to leave a live dark blood titan");
  assert.equal(summary.manualOrderType, "attack");
  assert.equal(
    Number(summary.currentTargetID) || Number(summary.preferredTargetID) || 0,
    Number(pilotSession.shipItem.itemID),
  );

  const controller = npcService.getControllerByEntityID(summary.entityID);
  assert(controller, "expected titan controller after signoff prep");
  assert.equal(controller.manualOrder.keepLock, true);
  assert.equal(controller.manualOrder.allowWeapons, true);
  assert.equal(
    Number(controller.capitalNpcState && controller.capitalNpcState.nextSuperweaponAttemptAtMs) || 0,
    0,
    "expected signoff prep to clear the titan superweapon retry gate",
  );
});

test("capital signoff command resets a supercarrier into a clean staged-launch validation state", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      987361,
      997361,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  executeChatCommand(
    pilotSession,
    "/capnpc 1 true sansha supercarrier",
    null,
    { emitChatFeedback: false },
  );
  const summary = npcService.getNpcOperatorSummary().find((entry) => (
    entry.systemID === TEST_SYSTEM_ID &&
    entry.profileID === "capital_true_sanshas_supercarrier"
  ));
  assert(summary, "expected spawned true sansha supercarrier");

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const carrier = scene.getEntityByID(Number(summary.entityID) || 0);
  assert(carrier, "expected spawned carrier entity");
  boostEntityLocking(carrier);
  repositionEntityNear(
    scene,
    Number(pilotSession.shipItem.itemID),
    carrier.itemID,
    12_000,
  );

  const launched = advanceSceneUntil(
    scene,
    8_000,
    250,
    () => getFighterEntities(scene, carrier.itemID).length >= 1,
  );
  assert.equal(launched, true, "expected the supercarrier to have a dirty live wing before signoff prep");

  const signoffResult = executeChatCommand(
    pilotSession,
    "/capnpcsignoff true sansha supercarrier me",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(signoffResult.handled, true);
  assert.match(signoffResult.message, /Prepared True Sansha's Supercarrier#/i);
  assert.match(signoffResult.message, /Spawned fresh hull/i);
  assert.match(signoffResult.message, /Launch quota 1 every 2s/i);
  assert.match(signoffResult.message, /Ability sync 1s/i);

  const preparedEntityMatch = signoffResult.message.match(/#(\d+)/);
  assert(preparedEntityMatch, "expected signoff prep to identify the prepared hull");
  const preparedEntityID = Number(preparedEntityMatch[1]) || 0;
  assert.ok(preparedEntityID > 0, "expected a numeric prepared hull id");
  const preparedCarrier = scene.getEntityByID(preparedEntityID);
  assert(preparedCarrier, "expected the prepared signoff hull to exist");
  boostEntityLocking(preparedCarrier);
  repositionEntityNear(
    scene,
    Number(pilotSession.shipItem.itemID),
    preparedEntityID,
    12_000,
  );

  assert.equal(
    getFighterEntities(scene, preparedEntityID).length,
    0,
    "expected signoff prep to begin from a clean fighter state on the prepared hull",
  );
  const preparedSummary = npcService.getNpcOperatorSummary().find((entry) => (
    Number(entry && entry.entityID) === preparedEntityID
  ));
  assert(preparedSummary, "expected the prepared signoff hull to have a live summary");
  assert.equal(preparedSummary.manualOrderType, "attack");
  assert.equal(
    Number(preparedSummary.currentTargetID) || Number(preparedSummary.preferredTargetID) || 0,
    Number(pilotSession.shipItem.itemID),
  );

  const preparedController = npcService.getControllerByEntityID(preparedEntityID);
  assert(preparedController, "expected prepared signoff hull controller");
  assert.equal(preparedController.manualOrder.keepLock, true);
  assert.equal(preparedController.manualOrder.allowWeapons, true);
  assert.equal(
    Number(preparedController.capitalNpcState && preparedController.capitalNpcState.nextFighterLaunchAtMs) || 0,
    0,
    "expected signoff prep to clear the fighter relaunch gate",
  );
});

test("clearing a fighter-capable capital also removes its NPC fighter squadrons", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      987401,
      997401,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  executeChatCommand(
    pilotSession,
    "/capnpc 1 true sansha supercarrier",
    null,
    { emitChatFeedback: false },
  );
  const summary = npcService.getNpcOperatorSummary().find((entry) => (
    entry.systemID === TEST_SYSTEM_ID &&
    entry.profileID === "capital_true_sanshas_supercarrier"
  ));
  assert(summary, "expected spawned true sansha supercarrier");

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const carrier = scene.getEntityByID(Number(summary.entityID) || 0);
  assert(carrier, "expected spawned carrier entity");
  boostEntityLocking(carrier);
  repositionEntityNear(
    scene,
    Number(pilotSession.shipItem.itemID),
    carrier.itemID,
    12_000,
  );

  const launched = advanceSceneUntil(
    scene,
    8_000,
    250,
    () => getFighterEntities(scene, carrier.itemID).length >= 1,
  );
  assert.equal(launched, true, "expected the supercarrier to launch at least one fighter squadron");

  const clearResult = executeChatCommand(
    pilotSession,
    "/capnpcclear true sansha supercarrier",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(clearResult.handled, true);
  assert.match(clearResult.message, /Cleared 1 True Sansha's Supercarrier/i);
  assert.equal(
    getFighterEntities(scene, carrier.itemID).length,
    0,
    "expected clearing the supercarrier to clean up its NPC fighter squadrons",
  );
});
