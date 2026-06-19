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
const {
  NPC_TABLE,
  listCapitalNpcAuthority,
  getCapitalNpcGeneratedRows,
  resolveCapitalNpcCommandQuery,
} = require(path.join(
  repoRoot,
  "server/src/space/npc/capitals/capitalNpcCatalog",
));
const {
  resolveFuelTypeID,
  resolveFuelPerActivation,
} = require(path.join(
  repoRoot,
  "server/src/services/superweapons/superweaponCatalog",
));
const {
  resolveCapitalDoctrine,
} = require(path.join(
  repoRoot,
  "server/src/space/npc/capitals/capitalNpcDoctrine",
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

function advanceScene(scene, deltaMs, stepMs = 250) {
  let wallclockNow = scene.getCurrentWallclockMs();
  let remainingMs = Math.max(0, Number(deltaMs) || 0);
  while (remainingMs > 0) {
    const nextStepMs = Math.min(Math.max(1, Number(stepMs) || 1), remainingMs);
    wallclockNow += nextStepMs;
    scene.tick(wallclockNow);
    remainingMs -= nextStepMs;
  }
}

function flushDestinyNotifications() {
  return new Promise((resolve) => setImmediate(resolve));
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

function targetDamagedOrDestroyed(scene, entityID) {
  const entity = scene.getEntityByID(entityID);
  if (!entity) {
    return true;
  }
  return Boolean(
    entity.conditionState &&
    (
      Number(entity.conditionState.damage || 0) > 0 ||
      Number(entity.conditionState.armorDamage || 0) > 0 ||
      Number(entity.conditionState.shieldCharge || 1) < 1
    )
  );
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

function getCargoQuantityByType(entity, typeID) {
  const numericTypeID = Number(typeID) || 0;
  return (Array.isArray(entity && entity.nativeCargoItems) ? entity.nativeCargoItems : [])
    .filter((entry) => Number(entry && entry.typeID) === numericTypeID)
    .reduce((sum, entry) => sum + (Number(entry && entry.quantity) || Number(entry && entry.stacksize) || 0), 0);
}

async function assertTitanSuperweaponContract({
  profileID,
  moduleTypeID,
  expectedFxGuid,
  pilotClientID,
  pilotCharacterID,
  observerClientID,
  observerCharacterID,
}) {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      pilotClientID,
      pilotCharacterID,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );
  const observerSession = registerAttachedSession(
    createFakeSession(
      observerClientID,
      observerCharacterID,
      { x: -107303350000, y: -18744975360, z: 436489052160 },
    ),
  );

  const spawnResult = npcService.runtime.spawnBatchForSession(pilotSession, {
    profileQuery: profileID,
    amount: 1,
    transient: true,
    preferPools: false,
    defaultPoolID: "capital_npc_all",
  });
  assert.equal(spawnResult && spawnResult.success, true, `expected ${profileID} to spawn`);

  const npcSummary = npcService.getNpcOperatorSummary().find((summary) => (
    summary.systemID === TEST_SYSTEM_ID &&
    summary.profileID === profileID
  ));
  assert(npcSummary, `expected ${profileID} summary`);

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const titan = scene.getEntityByID(Number(npcSummary.entityID) || 0);
  assert(titan, `expected ${profileID} entity`);
  boostEntityLocking(titan);
  repositionEntityNear(
    scene,
    Number(pilotSession.shipItem.itemID),
    titan.itemID,
    15_000,
  );
  repositionEntityNear(
    scene,
    Number(observerSession.shipItem.itemID),
    titan.itemID,
    20_000,
  );

  const doomsdayModule = (Array.isArray(titan.fittedItems) ? titan.fittedItems : []).find((item) => (
    Number(item && item.typeID) === Number(moduleTypeID)
  ));
  assert(doomsdayModule, `expected ${profileID} to fit module ${moduleTypeID}`);

  const activated = advanceSceneUntil(
    scene,
    40_000,
    250,
    () => Boolean(
      titan.activeModuleEffects instanceof Map &&
      titan.activeModuleEffects.has(Number(doomsdayModule.itemID) || 0),
    ),
  );
  assert.equal(activated, true, `expected ${profileID} titan superweapon activation`);

  const effectState = titan.activeModuleEffects.get(Number(doomsdayModule.itemID) || 0);
  assert(effectState, `expected ${profileID} superweapon effect state`);
  assert.equal(String(effectState.guid), expectedFxGuid);

  await flushDestinyNotifications();

  const ownerFx = flattenDestinyUpdates(pilotSession.notifications)
    .find((entry) => entry.name === "OnSpecialFX" && String(entry.args[5]) === expectedFxGuid);
  const observerFx = flattenDestinyUpdates(observerSession.notifications)
    .find((entry) => entry.name === "OnSpecialFX" && String(entry.args[5]) === expectedFxGuid);
  assert.ok(ownerFx, `expected owner FX ${expectedFxGuid} for ${profileID}`);
  assert.ok(observerFx, `expected observer FX ${expectedFxGuid} for ${profileID}`);

  const targetShipID = Number(pilotSession.shipItem.itemID) || 0;
  const earlyWindowMs = Math.max(
    0,
    Number(effectState.superweaponWarningDurationMs || 0) +
      Number(effectState.superweaponDamageDelayMs || 0) -
      1_000,
  );
  if (earlyWindowMs > 0) {
    advanceScene(scene, earlyWindowMs);
    assert.equal(
      targetDamagedOrDestroyed(scene, targetShipID),
      false,
      `expected ${profileID} to preserve the warning/delay window before damage`,
    );
  }

  advanceScene(
    scene,
    Math.max(
      1_500,
      Number(effectState.superweaponDamageCycleTimeMs || 0) + 500,
    ),
  );
  assert.equal(
    targetDamagedOrDestroyed(scene, targetShipID),
    true,
    `expected ${profileID} delayed superweapon damage to resolve`,
  );
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

test("capital authority generates the full 18-hull capital NPC dataset", () => {
  const authority = listCapitalNpcAuthority();
  assert.equal(authority.length, 18);
  assert.equal(authority.filter((entry) => entry.classID === "dreadnought").length, 10);
  assert.equal(authority.filter((entry) => entry.classID === "titan").length, 4);
  assert.equal(authority.filter((entry) => entry.classID === "supercarrier").length, 4);
  assert.equal(authority.filter((entry) => Number(entry.bounty) === 60_000_000).length, 6);
  assert.equal(authority.filter((entry) => Number(entry.bounty) === 120_000_000).length, 6);
  assert.equal(authority.filter((entry) => Number(entry.bounty) === 240_000_000).length, 6);

  assert.equal(getCapitalNpcGeneratedRows(NPC_TABLE.PROFILES).length, 18);
  assert.equal(getCapitalNpcGeneratedRows(NPC_TABLE.LOADOUTS).length, 18);
  assert.equal(getCapitalNpcGeneratedRows(NPC_TABLE.BEHAVIOR_PROFILES).length, 18);
  assert.equal(getCapitalNpcGeneratedRows(NPC_TABLE.LOOT_TABLES).length, 18);
  assert.equal(getCapitalNpcGeneratedRows(NPC_TABLE.SPAWN_POOLS).length, 10);

  assert.deepEqual(resolveCapitalNpcCommandQuery("").data, {
    kind: "pool",
    id: "capital_npc_all",
  });
  assert.deepEqual(resolveCapitalNpcCommandQuery("titans").data, {
    kind: "pool",
    id: "capital_npc_titans",
  });
  assert.deepEqual(resolveCapitalNpcCommandQuery("bloodtitan").data, {
    kind: "profile",
    id: "capital_dark_blood_titan",
  });
  assert.deepEqual(resolveCapitalNpcCommandQuery("rogue supercarrier").data, {
    kind: "profile",
    id: "capital_sentient_infested_supercarrier",
  });

  for (const entry of authority.filter((candidate) => candidate.classID === "titan")) {
    const moduleTypeID = Number(entry && entry.behaviorProfile && entry.behaviorProfile.capitalSuperweaponModuleTypeID) || 0;
    const fuelTypeID = Number(resolveFuelTypeID(moduleTypeID)) || 0;
    const fuelPerActivation = Number(resolveFuelPerActivation(moduleTypeID)) || 0;
    const cargoQuantity = (Array.isArray(entry && entry.loadout && entry.loadout.cargo) ? entry.loadout.cargo : [])
      .filter((cargoEntry) => Number(cargoEntry && cargoEntry.typeID) === fuelTypeID)
      .reduce((sum, cargoEntry) => sum + (Number(cargoEntry && cargoEntry.quantity) || 0), 0);
    const lootFuelQuantity = (Array.isArray(entry && entry.lootTable && entry.lootTable.guaranteedEntries)
      ? entry.lootTable.guaranteedEntries
      : [])
      .filter((lootEntry) => Number(lootEntry && lootEntry.typeID) === fuelTypeID)
      .reduce((sum, lootEntry) => sum + (Number(lootEntry && lootEntry.minQuantity) || 0), 0);
    assert.equal(
      cargoQuantity,
      fuelPerActivation,
      `expected ${entry.profileID} to seed exactly one real superweapon activation in cargo`,
    );
    assert.equal(
      lootFuelQuantity,
      0,
      `expected ${entry.profileID} loot to rely on real cargo fuel rather than duplicating isotope drops`,
    );
  }
});

test("/capnpc spawns real capital NPC entities with runtime capital metadata", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      986001,
      996001,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const commandResult = executeChatCommand(
    pilotSession,
    "/capnpc 2 titans",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(commandResult.handled, true);
  assert.match(commandResult.message, /Spawned 2 hulls from Capital Titans/i);

  const npcSummaries = npcService.getNpcOperatorSummary().filter((summary) => (
    summary.systemID === TEST_SYSTEM_ID &&
    summary.capitalNpc === true
  ));
  assert.equal(npcSummaries.length, 2, "expected /capnpc 2 titans to spawn two capital NPCs");
  assert.ok(
    npcSummaries.every((summary) => summary.capitalClassID === "titan"),
    "expected titan pool summaries to keep capital class metadata",
  );

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  for (const summary of npcSummaries) {
    const entity = scene.getEntityByID(Number(summary.entityID) || 0);
    assert(entity, "expected spawned capital entity to exist in scene");
    assert.equal(entity.capitalNpc, true);
    assert.equal(entity.capitalClassID, "titan");
  }
});

test("/capnpc true sansha supercarrier launches fighter squadrons in staged waves", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      986101,
      996101,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const commandResult = executeChatCommand(
    pilotSession,
    "/capnpc 1 true sansha supercarrier",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(commandResult.handled, true);
  assert.match(commandResult.message, /True Sansha/i);

  const npcSummary = npcService.getNpcOperatorSummary().find((summary) => (
    summary.systemID === TEST_SYSTEM_ID &&
    summary.profileID === "capital_true_sanshas_supercarrier"
  ));
  assert(npcSummary, "expected true sansha supercarrier summary");

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const supercarrierID = Number(npcSummary.entityID) || 0;
  const supercarrier = scene.getEntityByID(supercarrierID);
  assert(supercarrier, "expected true sansha supercarrier entity");
  boostEntityLocking(supercarrier);
  repositionEntityNear(
    scene,
    Number(pilotSession._space && pilotSession._space.shipID) || Number(pilotSession.shipItem.itemID) || 0,
    supercarrierID,
    12_000,
  );
  const launchedFirstWave = advanceSceneUntil(
    scene,
    8_000,
    250,
    () => getFighterEntities(scene, supercarrierID).length >= 1,
  );
  assert.equal(launchedFirstWave, true, "expected the supercarrier to launch its first fighter wave");
  assert.ok(
    getFighterEntities(scene, supercarrierID).length < 5,
    "expected staged fighter launch rather than dumping the whole wing on the first tick",
  );

  const launchedFullWing = advanceSceneUntil(
    scene,
    15_000,
    250,
    () => getFighterEntities(scene, supercarrierID).length >= 5,
  );
  assert.equal(launchedFullWing, true, "expected the supercarrier to finish launching its full wing");
});

test("/capnpc true sansha supercarrier relaunches a lost fighter squadron instead of keeping stale tube occupancy", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      986151,
      996151,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const commandResult = executeChatCommand(
    pilotSession,
    "/capnpc 1 true sansha supercarrier",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(commandResult.handled, true);

  const npcSummary = npcService.getNpcOperatorSummary().find((summary) => (
    summary.systemID === TEST_SYSTEM_ID &&
    summary.profileID === "capital_true_sanshas_supercarrier"
  ));
  assert(npcSummary, "expected true sansha supercarrier summary");

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const supercarrierID = Number(npcSummary.entityID) || 0;
  const supercarrier = scene.getEntityByID(supercarrierID);
  assert(supercarrier, "expected true sansha supercarrier entity");
  boostEntityLocking(supercarrier);
  repositionEntityNear(
    scene,
    Number(pilotSession._space && pilotSession._space.shipID) || Number(pilotSession.shipItem.itemID) || 0,
    supercarrierID,
    12_000,
  );

  const launchedFullWing = advanceSceneUntil(
    scene,
    15_000,
    250,
    () => getFighterEntities(scene, supercarrierID).length >= 5,
  );
  assert.equal(launchedFullWing, true, "expected the supercarrier to finish launching its full wing");

  const fullWing = getFighterEntities(scene, supercarrierID);
  assert.equal(fullWing.length, 5, "expected five live fighter squadrons before the loss test");

  const destroyedFighterID = Number(fullWing[0] && fullWing[0].itemID) || 0;
  assert.ok(destroyedFighterID > 0, "expected a live fighter squadron to destroy");
  const destroyResult = scene.destroyInventoryBackedDynamicEntity(destroyedFighterID, {
    removeContents: true,
  });
  assert.equal(destroyResult && destroyResult.success, true, "expected fighter destruction to succeed");
  assert.equal(
    getFighterEntities(scene, supercarrierID).length,
    4,
    "expected one fighter squadron to be missing immediately after destruction",
  );

  const relaunched = advanceSceneUntil(
    scene,
    8_000,
    250,
    () => getFighterEntities(scene, supercarrierID).length >= 5,
  );
  assert.equal(relaunched, true, "expected the supercarrier to relaunch the missing fighter squadron");
  assert.ok(
    getFighterEntities(scene, supercarrierID).every((entity) => Number(entity.itemID) !== destroyedFighterID),
    "expected the destroyed fighter squadron to be replaced by a fresh launch",
  );
});

test("/capnpc bloodtitan activates its real titan superweapon module", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      986201,
      996201,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const commandResult = executeChatCommand(
    pilotSession,
    "/capnpc 1 bloodtitan",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(commandResult.handled, true);
  assert.match(commandResult.message, /Dark Blood Titan/i);

  const npcSummary = npcService.getNpcOperatorSummary().find((summary) => (
    summary.systemID === TEST_SYSTEM_ID &&
    summary.profileID === "capital_dark_blood_titan"
  ));
  assert(npcSummary, "expected dark blood titan summary");

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const titan = scene.getEntityByID(Number(npcSummary.entityID) || 0);
  assert(titan, "expected dark blood titan entity");
  boostEntityLocking(titan);
  repositionEntityNear(
    scene,
    Number(pilotSession._space && pilotSession._space.shipID) || Number(pilotSession.shipItem.itemID) || 0,
    titan.itemID,
    15_000,
  );

  const doomsdayModule = (Array.isArray(titan.fittedItems) ? titan.fittedItems : []).find((item) => (
    Number(item && item.typeID) === 24550
  ));
  assert(doomsdayModule, "expected the dark blood titan to fit its real doomsday module");
  const fuelTypeID = Number(resolveFuelTypeID(doomsdayModule.typeID)) || 0;
  const fuelPerActivation = Number(resolveFuelPerActivation(doomsdayModule.typeID)) || 0;
  const initialFuelQuantity = getCargoQuantityByType(titan, fuelTypeID);
  assert.equal(initialFuelQuantity, fuelPerActivation, "expected one full doomsday shot of real isotope fuel in cargo");

  const superweaponActivated = advanceSceneUntil(
    scene,
    40_000,
    250,
    () => Boolean(
      titan.activeModuleEffects instanceof Map &&
      titan.activeModuleEffects.has(Number(doomsdayModule.itemID) || 0),
    ),
  );
  assert.equal(superweaponActivated, true, "expected the dark blood titan to activate its doomsday");
  assert.equal(
    getCargoQuantityByType(titan, fuelTypeID),
    Math.max(0, initialFuelQuantity - fuelPerActivation),
    "expected the titan doomsday to consume its real cargo fuel on activation",
  );
});

test("/capnpc bloodtitan fits all authored beam turrets and emits laser FX while engaging", async () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      986251,
      996251,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );
  const observerSession = registerAttachedSession(
    createFakeSession(
      986252,
      996252,
      { x: -107303350000, y: -18744975360, z: 436489052160 },
    ),
  );

  const commandResult = executeChatCommand(
    pilotSession,
    "/capnpc 1 bloodtitan",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(commandResult.handled, true);

  const npcSummary = npcService.getNpcOperatorSummary().find((summary) => (
    summary.systemID === TEST_SYSTEM_ID &&
    summary.profileID === "capital_dark_blood_titan"
  ));
  assert(npcSummary, "expected dark blood titan summary");

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const titan = scene.getEntityByID(Number(npcSummary.entityID) || 0);
  assert(titan, "expected dark blood titan entity");
  const doctrine = resolveCapitalDoctrine(titan, npcSummary.behaviorProfile || {});

  const beamModules = (Array.isArray(titan.fittedItems) ? titan.fittedItems : [])
    .filter((item) => Number(item && item.typeID) === 41118)
    .sort((left, right) => (Number(left && left.flagID) || 0) - (Number(right && right.flagID) || 0));
  assert.equal(beamModules.length, 4, "expected the dark blood titan to fit all four authored beam turrets");
  assert.deepEqual(
    beamModules.map((item) => Number(item && item.flagID) || 0),
    [12, 13, 14, 15],
    "expected the authored beam turrets to occupy their explicit hardpoint flags",
  );

  boostEntityLocking(titan);
  repositionEntityNear(
    scene,
    Number(pilotSession.shipItem.itemID),
    titan.itemID,
    Math.max(15_000, Number(doctrine && doctrine.preferredCombatRangeMeters) || 15_000),
  );
  repositionEntityNear(
    scene,
    Number(observerSession.shipItem.itemID),
    titan.itemID,
    Math.max(20_000, (Number(doctrine && doctrine.preferredCombatRangeMeters) || 20_000) + 5_000),
  );

  const beamActivated = advanceSceneUntil(
    scene,
    30_000,
    250,
    () => beamModules.some((item) => (
      titan.activeModuleEffects instanceof Map &&
      titan.activeModuleEffects.has(Number(item.itemID) || 0)
    )),
  );
  assert.equal(beamActivated, true, "expected the dark blood titan to activate at least one beam turret");
  await flushDestinyNotifications();

  const ownerLaserFx = flattenDestinyUpdates(pilotSession.notifications)
    .find((entry) => (
      entry.name === "OnSpecialFX" &&
      String(entry.args[5]) === "effects.Laser"
    ));
  const observerLaserFx = flattenDestinyUpdates(observerSession.notifications)
    .find((entry) => (
      entry.name === "OnSpecialFX" &&
      String(entry.args[5]) === "effects.Laser"
    ));
  assert.ok(ownerLaserFx, "expected owner-facing laser FX for the dark blood titan");
  assert.ok(observerLaserFx, "expected observer-facing laser FX for the dark blood titan");
  assert.equal(
    Number(ownerLaserFx.args[1]) || 0,
    titan.itemID,
    "expected owner-facing NPC laser FX to bind to the EntityShip hardpoint key",
  );
  assert.equal(
    Number(observerLaserFx.args[1]) || 0,
    titan.itemID,
    "expected observer-facing NPC laser FX to bind to the EntityShip hardpoint key",
  );
});

test("/capnpc bloodtitan preserves the shared doomsday warning, FX, and delayed damage contract", async () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      986301,
      996301,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );
  const observerSession = registerAttachedSession(
    createFakeSession(
      986302,
      996302,
      { x: -107303350000, y: -18744975360, z: 436489052160 },
    ),
  );

  const commandResult = executeChatCommand(
    pilotSession,
    "/capnpc 1 bloodtitan",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(commandResult.handled, true);

  const npcSummary = npcService.getNpcOperatorSummary().find((summary) => (
    summary.systemID === TEST_SYSTEM_ID &&
    summary.profileID === "capital_dark_blood_titan"
  ));
  assert(npcSummary, "expected dark blood titan summary");

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const titan = scene.getEntityByID(Number(npcSummary.entityID) || 0);
  assert(titan, "expected dark blood titan entity");
  boostEntityLocking(titan);
  repositionEntityNear(
    scene,
    Number(pilotSession.shipItem.itemID),
    titan.itemID,
    15_000,
  );
  repositionEntityNear(
    scene,
    Number(observerSession.shipItem.itemID),
    titan.itemID,
    20_000,
  );

  const doomsdayModule = (Array.isArray(titan.fittedItems) ? titan.fittedItems : []).find((item) => (
    Number(item && item.typeID) === 24550
  ));
  assert(doomsdayModule, "expected dark blood titan doomsday");

  const activated = advanceSceneUntil(
    scene,
    40_000,
    250,
    () => Boolean(
      titan.activeModuleEffects instanceof Map &&
      titan.activeModuleEffects.has(Number(doomsdayModule.itemID) || 0),
    ),
  );
  assert.equal(activated, true, "expected titan doomsday activation");
  await flushDestinyNotifications();

  const ownerFx = flattenDestinyUpdates(pilotSession.notifications)
    .find((entry) => entry.name === "OnSpecialFX");
  const observerFx = flattenDestinyUpdates(observerSession.notifications)
    .find((entry) => entry.name === "OnSpecialFX");
  assert.ok(ownerFx, "expected owner doomsday FX");
  assert.ok(observerFx, "expected observer doomsday FX");
  assert.equal(String(ownerFx.args[5]), "effects.SuperWeaponAmarr");

  const targetShipID = Number(pilotSession.shipItem.itemID) || 0;
  advanceScene(scene, 5_000);
  assert.equal(
    targetDamagedOrDestroyed(scene, targetShipID),
    false,
    "expected the doomsday warning/delay window to prevent early damage",
  );

  advanceScene(scene, 6_000);
  assert.equal(
    targetDamagedOrDestroyed(scene, targetShipID),
    true,
    "expected the delayed doomsday damage to resolve after the warning window",
  );
});

test("/capnpc shadow serpentis titan preserves the Gallente superweapon FX and delayed damage contract", async () => {
  await assertTitanSuperweaponContract({
    profileID: "capital_shadow_serpentis_titan",
    moduleTypeID: 24554,
    expectedFxGuid: "effects.SuperWeaponGallente",
    pilotClientID: 986401,
    pilotCharacterID: 996401,
    observerClientID: 986402,
    observerCharacterID: 996402,
  });
});

test("/capnpc dread guristas titan preserves the Caldari superweapon FX and delayed damage contract", async () => {
  await assertTitanSuperweaponContract({
    profileID: "capital_dread_guristas_titan",
    moduleTypeID: 24552,
    expectedFxGuid: "effects.SuperWeaponCaldari",
    pilotClientID: 986501,
    pilotCharacterID: 996501,
    observerClientID: 986502,
    observerCharacterID: 996502,
  });
});

test("/capnpc domination titan preserves the Minmatar superweapon FX and delayed damage contract", async () => {
  await assertTitanSuperweaponContract({
    profileID: "capital_domination_titan",
    moduleTypeID: 23674,
    expectedFxGuid: "effects.SuperWeaponMinmatar",
    pilotClientID: 986601,
    pilotCharacterID: 996601,
    observerClientID: 986602,
    observerCharacterID: 996602,
  });
});
