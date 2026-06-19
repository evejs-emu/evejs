const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

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
const nativeNpcService = require(path.join(
  repoRoot,
  "server/src/space/npc/nativeNpcService",
));
const npcEquipment = require(path.join(
  repoRoot,
  "server/src/space/npc/npcEquipment",
));
const trigDrifterCommandModule = require(path.join(
  repoRoot,
  "server/src/services/chat/trigDrifter",
));
const {
  getTypeAttributeValue,
  getEffectTypeRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));
const {
  resolveItemByTypeID,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemTypeRegistry",
));
const hostileModuleRuntime = require(path.join(
  repoRoot,
  "server/src/space/modules/hostileModuleRuntime",
));
const { buildWeaponModuleSnapshot } = require(path.join(
  repoRoot,
  "server/src/space/combat/weaponDogma",
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

function createFakeCapsuleSession(
  clientID,
  characterID,
  capsuleOwnerID,
  position,
  direction = { x: 1, y: 0, z: 0 },
) {
  const session = createFakeSession(clientID, characterID, position, direction);
  const capsuleType = resolveItemByTypeID(670) || {};
  session.shipName = `capsule-${characterID}`;
  session.shipItem = {
    ...session.shipItem,
    typeID: 670,
    ownerID: capsuleOwnerID,
    groupID: Number(capsuleType.groupID) || 29,
    categoryID: Number(capsuleType.categoryID) || 6,
    radius: Number(capsuleType.radius) || 20,
  };
  return session;
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

function getOperatorEntities(operatorKind) {
  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  return npcService.getNpcOperatorSummary()
    .filter((summary) => (
      summary.systemID === TEST_SYSTEM_ID &&
      summary.operatorKind === operatorKind
    ))
    .map((summary) => scene.getEntityByID(Number(summary.entityID) || 0))
    .filter(Boolean);
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

function distanceBetweenPoints(a, b) {
  if (!a || !b) {
    return Number.POSITIVE_INFINITY;
  }
  const dx = (Number(a.x) || 0) - (Number(b.x) || 0);
  const dy = (Number(a.y) || 0) - (Number(b.y) || 0);
  const dz = (Number(a.z) || 0) - (Number(b.z) || 0);
  return Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
}

function normalizeDirection(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const x = Number(vector && vector.x) || 0;
  const y = Number(vector && vector.y) || 0;
  const z = Number(vector && vector.z) || 0;
  const length = Math.sqrt((x * x) + (y * y) + (z * z));
  if (!Number.isFinite(length) || length <= 0) {
    return { ...fallback };
  }
  return {
    x: x / length,
    y: y / length,
    z: z / length,
  };
}

function spawnNativeDrifterPack(anchorSession, variantQuery, amount, options = {}) {
  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const anchorEntity = scene.getEntityByID(anchorSession._space.shipID);
  assert(anchorEntity, "expected anchor session ship entity");

  const spawnSelection = trigDrifterCommandModule.__testing.resolveDrifterSpawnSelection(variantQuery);
  const variant = spawnSelection && spawnSelection.variant
    ? spawnSelection.variant
    : trigDrifterCommandModule.__testing.resolveDrifterVariant(variantQuery);
  assert(variant, `expected Drifter variant ${variantQuery} to resolve`);
  const definitionOptions = {
    ...(options.definitionOptions || {}),
  };
  if (
    !Object.prototype.hasOwnProperty.call(definitionOptions, "behaviorFamily") &&
    spawnSelection &&
    spawnSelection.behaviorFamily
  ) {
    definitionOptions.behaviorFamily = spawnSelection.behaviorFamily;
  }

  const definitions = Array.from({ length: amount }, (_, index) => (
    trigDrifterCommandModule.__testing.buildDrifterDefinition(variant, index, definitionOptions)
  ));
  const selectionResult = {
    data: {
      selectionKind: "gmTestPack",
      selectionID: String(options.selectionID || `test:${variantQuery}`),
      selectionName: String(options.selectionName || `Test ${variant.label} Pack`),
      definitions,
    },
    suggestions: [],
  };

  return nativeNpcService.spawnNativeDefinitionsInContext(
    {
      systemID: TEST_SYSTEM_ID,
      scene,
      anchorEntity,
      preferredTargetID: 0,
      anchorKind: "ship",
      anchorLabel: String(anchorSession.shipName || "Ship"),
    },
    selectionResult,
    {
      transient: true,
      operatorKind: String(options.operatorKind || "testDrifterPack"),
      preferredTargetID: toPositiveNumberOrZero(options.preferredTargetID),
      runtimeKind: "nativeCombat",
      behaviorOverrides: Object.prototype.hasOwnProperty.call(options, "behaviorOverrides")
        ? options.behaviorOverrides
        : null,
      skipInitialBehaviorTick: options.skipInitialBehaviorTick === true,
      spawnDistanceMeters: Number(options.spawnDistanceMeters) || 20_000,
      formationSpacingMeters: Number(options.formationSpacingMeters) || 1_500,
      spreadMeters: Number(options.spreadMeters) || 0,
      selectionKind: "gmTestPack",
      selectionID: String(options.selectionID || `test:${variantQuery}`),
      selectionName: String(options.selectionName || `Test ${variant.label} Pack`),
      anchorKind: "ship",
      anchorName: String(anchorSession.shipName || "Ship"),
      anchorID: Number(anchorEntity.itemID) || 0,
    },
  );
}

function spawnNativeDrifterPackOnAnchor(anchorEntity, variantQuery, amount, options = {}) {
  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  assert(anchorEntity, "expected static or dynamic anchor entity");

  const spawnSelection = trigDrifterCommandModule.__testing.resolveDrifterSpawnSelection(variantQuery);
  const variant = spawnSelection && spawnSelection.variant
    ? spawnSelection.variant
    : trigDrifterCommandModule.__testing.resolveDrifterVariant(variantQuery);
  assert(variant, `expected Drifter variant ${variantQuery} to resolve`);
  const definitionOptions = {
    ...(options.definitionOptions || {}),
  };
  if (
    !Object.prototype.hasOwnProperty.call(definitionOptions, "behaviorFamily") &&
    spawnSelection &&
    spawnSelection.behaviorFamily
  ) {
    definitionOptions.behaviorFamily = spawnSelection.behaviorFamily;
  }

  const definitions = Array.from({ length: amount }, (_, index) => (
    trigDrifterCommandModule.__testing.buildDrifterDefinition(variant, index, definitionOptions)
  ));
  const selectionResult = {
    data: {
      selectionKind: "gmTestPack",
      selectionID: String(options.selectionID || `test:${variantQuery}:anchor`),
      selectionName: String(options.selectionName || `Test ${variant.label} Anchor Pack`),
      definitions,
    },
    suggestions: [],
  };

  return nativeNpcService.spawnNativeDefinitionsInContext(
    {
      systemID: TEST_SYSTEM_ID,
      scene,
      anchorEntity,
      preferredTargetID: toPositiveNumberOrZero(options.preferredTargetID),
      anchorKind: String(anchorEntity.kind || "anchor"),
      anchorLabel: String(anchorEntity.itemName || anchorEntity.slimName || "Anchor"),
    },
    selectionResult,
    {
      transient: true,
      operatorKind: String(options.operatorKind || "testDrifterAnchorPack"),
      preferredTargetID: toPositiveNumberOrZero(options.preferredTargetID),
      runtimeKind: "nativeCombat",
      behaviorOverrides: Object.prototype.hasOwnProperty.call(options, "behaviorOverrides")
        ? options.behaviorOverrides
        : null,
      skipInitialBehaviorTick: options.skipInitialBehaviorTick === true,
      spawnDistanceMeters: Number(options.spawnDistanceMeters) || 20_000,
      formationSpacingMeters: Number(options.formationSpacingMeters) || 1_500,
      spreadMeters: Number(options.spreadMeters) || 0,
      selectionKind: "gmTestPack",
      selectionID: String(options.selectionID || `test:${variantQuery}:anchor`),
      selectionName: String(options.selectionName || `Test ${variant.label} Anchor Pack`),
      anchorKind: String(anchorEntity.kind || "anchor"),
      anchorName: String(anchorEntity.itemName || anchorEntity.slimName || "Anchor"),
      anchorID: Number(anchorEntity.itemID) || 0,
    },
  );
}

function toPositiveNumberOrZero(value) {
  return Math.max(0, Number(value) || 0);
}

function flushDirectDestinyNotifications(scene) {
  if (scene && typeof scene.flushDirectDestinyNotificationBatch === "function") {
    scene.flushDirectDestinyNotificationBatch();
  }
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
    removeContents: true,
  });
  spaceRuntime._testing.clearScenes();
});

test("/trigspawn spawns transient precursor NPC test hulls and replaces the old pack cleanly", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      989001,
      999001,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const firstResult = executeChatCommand(
    pilotSession,
    "/trigspawn 3 light",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(firstResult.handled, true);
  assert.match(firstResult.message, /Spawned 3 transient Liminal Damavik \/trigspawn hulls/i);

  let entities = getOperatorEntities("trigspawn");
  assert.equal(entities.length, 3, "expected first /trigspawn to materialize three NPCs");
  assert.ok(
    entities.every((entity) => Number(entity.categoryID) === 11),
    "expected /trigspawn light hulls to use proper NPC entity rows",
  );
  assert.ok(
    entities.every((entity) => Array.isArray(entity.fittedItems) && entity.fittedItems.some((item) => Number(item && item.typeID) === 47914)),
    "expected /trigspawn light hulls to fit Light Entropic Disintegrator II",
  );

  const secondResult = executeChatCommand(
    pilotSession,
    "/trigspawn 1 leshak",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(secondResult.handled, true);
  assert.match(secondResult.message, /Cleared 3 previous \/trigspawn hulls/i);

  entities = getOperatorEntities("trigspawn");
  assert.equal(entities.length, 1, "expected repeated /trigspawn to replace the old pack");
  assert.equal(Number(entities[0].typeID), 52184, "expected /trigspawn leshak to use the proper NPC Leshak hull");
  assert.ok(
    Array.isArray(entities[0].fittedItems) &&
    entities[0].fittedItems.some((item) => Number(item && item.typeID) === 47922),
    "expected /trigspawn leshak to fit Supratidal Entropic Disintegrator II",
  );
});

test("/trigspawn status and clear report the live transient pack honestly", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      989111,
      999111,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const emptyStatus = executeChatCommand(
    pilotSession,
    "/trigspawn status",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(emptyStatus.handled, true);
  assert.match(emptyStatus.message, /No active \/trigspawn pack is currently spawned in this system/i);

  const spawnResult = executeChatCommand(
    pilotSession,
    "/trigspawn 2 starving damavik",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(spawnResult.handled, true);

  const liveStatus = executeChatCommand(
    pilotSession,
    "/trigspawn status",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(liveStatus.handled, true);
  assert.match(liveStatus.message, /Active \/trigspawn pack in this system: 2 hulls/i);
  assert.match(liveStatus.message, /Starving Damavik/i);

  const clearResult = executeChatCommand(
    pilotSession,
    "/trigspawn clear",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(clearResult.handled, true);
  assert.match(clearResult.message, /Cleared 2 active \/trigspawn hulls/i);

  assert.equal(
    getOperatorEntities("trigspawn").length,
    0,
    "expected /trigspawn clear to remove the live pack",
  );
});

test("/trigspawn emits separate beam and attack-mode FX for spawned Trig NPCs", async () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      989201,
      999201,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const result = executeChatCommand(
    pilotSession,
    "/trigspawn 1 leshak",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(result.handled, true);

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const entity = getOperatorEntities("trigspawn")[0];
  assert(entity, "expected /trigspawn entity");
  assert.equal(Number(entity.categoryID), 11, "expected trig spawn to present as a proper NPC entity");

  const activated = advanceSceneUntil(
    scene,
    20_000,
    250,
    () => Boolean(entity.activeModuleEffects instanceof Map && entity.activeModuleEffects.size > 0),
  );
  assert.equal(activated, true, "expected spawned trig NPC to activate its precursor weapon");

  flushDirectDestinyNotifications(scene);
  await new Promise((resolve) => setImmediate(resolve));

  const fxUpdates = flattenDestinyUpdates(pilotSession.notifications)
    .filter((entry) => entry.name === "OnSpecialFX");
  assert.ok(
    fxUpdates.some((entry) => String(entry.args[5]) === "effects.TriglavianBeam"),
    "expected spawned trig NPC to emit the visible TriglavianBeam FX",
  );
  assert.ok(
    fxUpdates.some((entry) => String(entry.args[5]) === "effects.AttackMode"),
    "expected spawned trig NPC to emit the AttackMode controller FX",
  );
});

test("/trigspawn starving hulls fit and activate their hostile utility modules", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      989301,
      999301,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const result = executeChatCommand(
    pilotSession,
    "/trigspawn 1 starving damavik",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(result.handled, true);
  assert.match(result.message, /Starving hostile utility fit live: 2 extra role modules/i);

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const entity = getOperatorEntities("trigspawn")[0];
  assert(entity, "expected /trigspawn entity");
  assert.ok(
    Array.isArray(entity.fittedItems) &&
    entity.fittedItems.some((item) => Number(item && item.typeID) === 13003) &&
    entity.fittedItems.some((item) => Number(item && item.typeID) === 13001),
    "expected starving damavik to fit the hostile utility neut/nos pair",
  );

  const activated = advanceSceneUntil(
    scene,
    20_000,
    250,
    () => {
      const activeEffects = entity.activeModuleEffects instanceof Map
        ? [...entity.activeModuleEffects.values()]
        : [];
      return activeEffects.some((effectState) => (
        effectState &&
        effectState.hostileModuleEffect === true &&
        (
          effectState.hostileFamily === "energyNeutralizer" ||
          effectState.hostileFamily === "energyNosferatu"
        )
      ));
    },
  );
  assert.equal(
    activated,
    true,
    "expected starving trig hulls to activate their hostile utility modules on target",
  );
});

test("/drifter spawns transient hull-first test packs and replaces the old pack cleanly", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      989101,
      999101,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const firstResult = executeChatCommand(
    pilotSession,
    "/drifter 2 cruiser",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(firstResult.handled, true);
  assert.match(firstResult.message, /Spawned 2 transient Drifter Cruiser \/drifter hulls/i);

  let entities = getOperatorEntities("drifterspawn");
  assert.equal(entities.length, 2, "expected /drifter cruiser to materialize two hulls");
  assert.ok(
    entities.every((entity) => Number(entity.typeID) === 47153),
    "expected /drifter cruiser to use the Drifter Cruiser hull",
  );
  assert.ok(
    entities.every((entity) => !Array.isArray(entity.fittedItems) || entity.fittedItems.length === 0),
    "expected the current /drifter harness to stay hull-first without fake fitted combat modules",
  );

  const secondResult = executeChatCommand(
    pilotSession,
    "/drifter 1 commander",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(secondResult.handled, true);
  assert.match(secondResult.message, /Cleared 2 previous \/drifter hulls/i);

  entities = getOperatorEntities("drifterspawn");
  assert.equal(entities.length, 1, "expected repeated /drifter to replace the old pack");
  assert.equal(Number(entities[0].typeID), 47724, "expected /drifter commander to use the Drifter Strike Commander hull");
});

test("/drifter random spawns a mixed authority-backed Drifter pack", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      989104,
      999104,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const result = executeChatCommand(
    pilotSession,
    "/drifter 6 random",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(result.handled, true);
  assert.match(result.message, /random mixed \/drifter hulls/i);
  assert.match(result.message, /Composition:/i);

  const entities = getOperatorEntities("drifterspawn");
  assert.equal(entities.length, 6, "expected /drifter random to materialize the requested pack size");
  assert.ok(
    new Set(entities.map((entity) => Number(entity.typeID))).size > 1,
    "expected /drifter random to guarantee a mixed Drifter hull pack",
  );
  assert.ok(
    entities.every((entity) => Number(entity.categoryID) === 11),
    "expected random Drifter packs to stay on the category-11 native NPC path",
  );
});

test("/drifter combat packs maneuver on the native NPC path instead of holding stationary", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      9891041,
      9991041,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const result = executeChatCommand(
    pilotSession,
    "/drifter 1 battleship",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(result.handled, true);

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const entity = getOperatorEntities("drifterspawn")[0];
  assert(entity, "expected /drifter entity");

  const pilotEntity = scene.getEntityByID(pilotSession._space.shipID);
  assert(pilotEntity, "expected pilot ship entity");
  const aggressionResult = npcService.noteNpcIncomingAggression(
    entity,
    pilotEntity,
    scene.getCurrentSimTimeMs(),
  );
  assert.equal(aggressionResult && aggressionResult.success, true, "expected Drifter aggression note to succeed");

  npcService.wakeNpcController(entity.itemID, 0);
  const moving = advanceSceneUntil(
    scene,
    7_500,
    250,
    () => {
      const mode = String(entity.mode || "").toUpperCase();
      return (
        (mode === "FOLLOW" || mode === "ORBIT") &&
        Number(entity.targetEntityID) === Number(pilotEntity.itemID)
      );
    },
  );
  assert.equal(
    moving,
    true,
    "expected /drifter combat packs to maneuver onto their target instead of staying in HOLD",
  );
});

test("/drifter supports explicit behavior-family overrides on the GM harness", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      989102,
      999102,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const result = executeChatCommand(
    pilotSession,
    "/drifter 1 roaming battleship",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(result.handled, true);
  assert.match(result.message, /using the roaming behavior family/i);

  const entities = getOperatorEntities("drifterspawn");
  assert.equal(entities.length, 1, "expected /drifter roaming battleship to materialize one hull");
  assert.equal(Number(entities[0].typeID), 34495, "expected /drifter roaming battleship to still use the battleship hull");

  const controller = npcService.getControllerByEntityID(entities[0].itemID);
  assert(controller, "expected roaming /drifter hull to have a live controller");
  assert.equal(
    String(controller.behaviorProfile && controller.behaviorProfile.drifterBehaviorFamily || ""),
    "roaming",
    "expected the /drifter harness to carry the explicit roaming family into the shared Drifter behavior profile",
  );
  assert.equal(
    controller.behaviorProfile && controller.behaviorProfile.drifterEnablePackRegroup,
    true,
    "expected roaming-family /drifter hulls to keep pack regroup enabled",
  );
  assert.equal(
    controller.behaviorProfile && controller.behaviorProfile.drifterEnableEntosisPriority,
    false,
    "expected roaming-family /drifter hulls not to inherit hunter-only entosis-priority behavior",
  );
  assert.equal(
    controller.behaviorProfile && controller.behaviorProfile.drifterEnablePursuitWarp,
    false,
    "expected roaming-family /drifter hulls not to inherit hunter-only pursuit warp behavior",
  );
});

test("/trigspawn combat packs maneuver on the native NPC path instead of holding stationary", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      9891021,
      9991021,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const result = executeChatCommand(
    pilotSession,
    "/trigspawn 1 starving damavik",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(result.handled, true);

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const entity = getOperatorEntities("trigspawn")[0];
  assert(entity, "expected /trigspawn entity");

  const pilotEntity = scene.getEntityByID(pilotSession._space.shipID);
  assert(pilotEntity, "expected pilot ship entity");
  const aggressionResult = npcService.noteNpcIncomingAggression(
    entity,
    pilotEntity,
    scene.getCurrentSimTimeMs(),
  );
  assert.equal(aggressionResult && aggressionResult.success, true, "expected Trig aggression note to succeed");

  npcService.wakeNpcController(entity.itemID, 0);
  const moving = advanceSceneUntil(
    scene,
    7_500,
    250,
    () => {
      const mode = String(entity.mode || "").toUpperCase();
      return (
        (mode === "FOLLOW" || mode === "ORBIT") &&
        Number(entity.targetEntityID) === Number(pilotEntity.itemID)
      );
    },
  );
  assert.equal(
    moving,
    true,
    "expected /trigspawn combat packs to maneuver onto their target instead of staying in HOLD",
  );
});

test("/drifter supports explicit hive and dungeon behavior-family overrides on the GM harness", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      989103,
      999103,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const battleshipTypeID = trigDrifterCommandModule.__testing
    .resolveDrifterVariant("battleship")
    .shipTypeID;
  const cases = [
    {
      command: "/drifter 1 dungeon battleship",
      family: "dungeon",
      idleAnchorOrbit: true,
      drifterEnableReinforcements: false,
      drifterEnableEntosisPriority: false,
      drifterEnablePackRegroup: false,
      drifterEnablePursuitWarp: false,
    },
    {
      command: "/drifter 1 hive battleship",
      family: "hive",
      idleAnchorOrbit: false,
      drifterEnableReinforcements: true,
      drifterEnableEntosisPriority: false,
      drifterEnablePackRegroup: true,
      drifterEnablePursuitWarp: false,
    },
  ];

  for (const entry of cases) {
    const result = executeChatCommand(
      pilotSession,
      entry.command,
      null,
      { emitChatFeedback: false },
    );
    assert.equal(result.handled, true, `expected ${entry.command} to be handled`);
    assert.match(
      result.message,
      new RegExp(`using the ${entry.family} behavior family`, "i"),
      `expected ${entry.command} to report the explicit ${entry.family} family`,
    );

    const entities = getOperatorEntities("drifterspawn");
    assert.equal(entities.length, 1, `expected ${entry.command} to materialize one hull`);
    assert.equal(
      Number(entities[0].typeID),
      battleshipTypeID,
      `expected ${entry.command} to keep the canonical battleship hull`,
    );

    const controller = npcService.getControllerByEntityID(entities[0].itemID);
    assert(controller, `expected ${entry.command} to leave a live controller`);
    const behaviorProfile = controller.behaviorProfile || {};
    assert.equal(
      String(behaviorProfile.drifterBehaviorFamily || ""),
      entry.family,
      `expected ${entry.command} to carry the ${entry.family} family into the shared Drifter behavior profile`,
    );
    assert.equal(
      Boolean(behaviorProfile.idleAnchorOrbit),
      entry.idleAnchorOrbit,
      `expected ${entry.command} idleAnchorOrbit to match the ${entry.family} family contract`,
    );
    assert.equal(
      Boolean(behaviorProfile.drifterEnableReinforcements),
      entry.drifterEnableReinforcements,
      `expected ${entry.command} reinforcement behavior to match the ${entry.family} family contract`,
    );
    assert.equal(
      Boolean(behaviorProfile.drifterEnableEntosisPriority),
      entry.drifterEnableEntosisPriority,
      `expected ${entry.command} entosis-priority behavior to match the ${entry.family} family contract`,
    );
    assert.equal(
      Boolean(behaviorProfile.drifterEnablePackRegroup),
      entry.drifterEnablePackRegroup,
      `expected ${entry.command} regroup behavior to match the ${entry.family} family contract`,
    );
    assert.equal(
      Boolean(behaviorProfile.drifterEnablePursuitWarp),
      entry.drifterEnablePursuitWarp,
      `expected ${entry.command} pursuit-warp behavior to match the ${entry.family} family contract`,
    );
  }
});

test("/drifter extra hull variants resolve the exact repo-owned Drifter turret authority", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      989141,
      999141,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const cases = [
    {
      command: "/drifter 1 battleship",
      shipTypeID: 34495,
      turretTypeID: 34580,
      turretName: "Lux Kontos",
    },
    {
      command: "/drifter 1 cruiser",
      shipTypeID: 47153,
      turretTypeID: 47446,
      turretName: "Lux Xiphos",
    },
    {
      command: "/drifter 1 strike cruiser",
      shipTypeID: 47722,
      turretTypeID: 47446,
      turretName: "Lux Xiphos",
    },
    {
      command: "/drifter 1 commander",
      shipTypeID: 47724,
      turretTypeID: 47446,
      turretName: "Lux Xiphos",
    },
    {
      command: "/drifter 1 response",
      shipTypeID: 37473,
      turretTypeID: 34580,
      turretName: "Lux Kontos",
    },
    {
      command: "/drifter 1 polemarkos",
      shipTypeID: 56217,
      turretTypeID: 34580,
      turretName: "Lux Kontos",
    },
    {
      command: "/drifter 1 navarkos",
      shipTypeID: 56220,
      turretTypeID: 47446,
      turretName: "Lux Xiphos",
    },
    {
      command: "/drifter 1 tyrannos",
      shipTypeID: 87612,
      turretTypeID: 47446,
      turretName: "Lux Xiphos",
    },
    {
      command: "/drifter 1 strategos",
      shipTypeID: 88154,
      turretTypeID: 88348,
      turretName: "Lux Ballistra",
    },
    {
      command: "/drifter 1 hopilite",
      shipTypeID: 88153,
      turretTypeID: 88349,
      turretName: "Lux Kopis",
    },
  ];

  for (const entry of cases) {
    const result = executeChatCommand(
      pilotSession,
      entry.command,
      null,
      { emitChatFeedback: false },
    );
    assert.equal(result.handled, true, `expected ${entry.command} to be handled`);

    const entities = getOperatorEntities("drifterspawn");
    assert.equal(entities.length, 1, `expected ${entry.command} to leave exactly one active /drifter hull`);
    assert.equal(
      Number(entities[0].typeID),
      entry.shipTypeID,
      `expected ${entry.command} to use hull ${entry.shipTypeID}`,
    );

    const turretTypeID = Number(getTypeAttributeValue(entry.shipTypeID, "gfxTurretID")) || 0;
    assert.equal(
      turretTypeID,
      entry.turretTypeID,
      `expected ${entry.command} to use turret type ${entry.turretTypeID}`,
    );

    const turretType = resolveItemByTypeID(turretTypeID);
    assert.ok(turretType, `expected turret type ${turretTypeID} to resolve`);
    assert.equal(
      String(turretType.name || ""),
      entry.turretName,
      `expected ${entry.command} to resolve turret ${entry.turretName}`,
    );
  }
});

test("/drifter strategos hulls autonomously enter native siege and feed it into live ship and weapon state", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      989149,
      999149,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const spawnResult = executeChatCommand(
    pilotSession,
    "/drifter 1 strategos",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(spawnResult.handled, true);

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const entity = getOperatorEntities("drifterspawn")[0];
  assert(entity, "expected /drifter strategos entity");

  const siegeEntry = npcEquipment.getNpcSelfModules(entity).find((entry) => (
    entry &&
    entry.definition &&
    entry.definition.family === "siege"
  ));
  assert(siegeEntry, "expected Strategos hulls to expose a native siege self-effect");

  const weaponModule = npcEquipment.getNpcWeaponModules(entity)[0];
  assert(weaponModule, "expected Strategos hull to expose a native weapon lane");

  const baselineMaxVelocity = Math.max(
    0,
    Number(getTypeAttributeValue(entity.typeID, "maxVelocity")) || 0,
  );
  assert.ok(
    baselineMaxVelocity > 0,
    "expected Strategos hull type data to expose a valid baseline max velocity",
  );

  const baselineSnapshot = buildWeaponModuleSnapshot({
    characterID: 0,
    shipItem: {
      itemID: entity.itemID,
      typeID: entity.typeID,
    },
    moduleItem: weaponModule,
    chargeItem: null,
    fittedItems: [],
    skillMap: new Map(),
    activeModuleContexts: [],
  });
  assert(baselineSnapshot, "expected a baseline Strategos weapon snapshot");

  const sieged = advanceSceneUntil(
    scene,
    25_000,
    250,
    () => {
      const controller = npcService.getControllerByEntityID(entity.itemID);
      const activeSiegeEffect = entity.activeModuleEffects instanceof Map
        ? entity.activeModuleEffects.get(Number(siegeEntry.moduleItem.itemID) || 0) || null
        : null;
      return Boolean(
        controller &&
        Number(controller.currentTargetID) === pilotSession.shipItem.itemID &&
        activeSiegeEffect &&
        Number(entity.maxVelocity) < (baselineMaxVelocity * 0.05)
      );
    },
  );
  assert.equal(
    sieged,
    true,
    "expected Strategos hulls to autonomously enter siege while engaging a live target",
  );

  const siegeEffectState = entity.activeModuleEffects instanceof Map
    ? entity.activeModuleEffects.get(Number(siegeEntry.moduleItem.itemID) || 0) || null
    : null;
  assert(siegeEffectState, "expected active siege effect state after autonomous combat start");
  assert.equal(
    String(siegeEffectState.effectName || "").trim(),
    "npcBehaviorSiege",
    "expected the live self-effect lane to keep the exact siege effect name",
  );
  assert.equal(
    siegeEffectState.affectsShipDerivedState,
    true,
    "expected Strategos siege to flag ship-derived-state refresh",
  );

  const siegeEffectRecord = getEffectTypeRecord(Number(siegeEffectState.effectID) || 0);
  assert(siegeEffectRecord, "expected the active siege effect to resolve a dogma effect record");

  const siegedSnapshot = buildWeaponModuleSnapshot({
    characterID: 0,
    shipItem: {
      itemID: entity.itemID,
      typeID: entity.typeID,
    },
    moduleItem: weaponModule,
    chargeItem: null,
    fittedItems: [],
    skillMap: new Map(),
    activeModuleContexts: [
      {
        effectState: siegeEffectState,
        effectRecord: siegeEffectRecord,
        moduleItem: siegeEntry.moduleItem,
        chargeItem: null,
      },
    ],
  });
  assert(siegedSnapshot, "expected a Strategos weapon snapshot while siege is active");
  assert.ok(
    Number(siegedSnapshot.damageMultiplier) > Number(baselineSnapshot.damageMultiplier),
    "expected Strategos siege to increase the live weapon damage multiplier",
  );
});

test("/drifter commander hulls guard their authored anchor by default on the native NPC path", () => {
  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const sunAnchor = [...scene.staticEntities].find((entity) => (
    entity && String(entity.kind || "").trim().toLowerCase() === "sun"
  ));
  assert(sunAnchor, "expected a static sun anchor in the test scene");

  const spawnResult = spawnNativeDrifterPackOnAnchor(
    sunAnchor,
    "commander",
    1,
    {
      operatorKind: "testDrifterCommanderGuard",
      skipInitialBehaviorTick: true,
      preferredTargetID: 0,
      spawnDistanceMeters: 20_000,
      formationSpacingMeters: 1_500,
    },
  );
  assert.equal(
    spawnResult && spawnResult.success,
    true,
    "expected commander guard spawn to succeed",
  );

  const commanderEntity = getOperatorEntities("testDrifterCommanderGuard")[0];
  assert(commanderEntity, "expected spawned commander entity");

  npcService.wakeNpcController(commanderEntity.itemID, 0);
  const guarding = advanceSceneUntil(
    scene,
    5_000,
    250,
    () => (
      Number(commanderEntity.targetEntityID) === Number(sunAnchor.itemID) &&
      String(commanderEntity.mode || "").toUpperCase() === "ORBIT"
    ),
  );
  assert.equal(
    guarding,
    true,
    "expected commander hulls to orbit their guard anchor by default without test-only behavior overrides",
  );
});

test("/drifter dungeon-family hulls guard their authored anchor by default on the native NPC path", () => {
  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const sunAnchor = [...scene.staticEntities].find((entity) => (
    entity && String(entity.kind || "").trim().toLowerCase() === "sun"
  ));
  assert(sunAnchor, "expected a static sun anchor in the test scene");

  const spawnResult = spawnNativeDrifterPackOnAnchor(
    sunAnchor,
    "dungeon battleship",
    1,
    {
      operatorKind: "testDrifterDungeonGuard",
      skipInitialBehaviorTick: true,
      preferredTargetID: 0,
      spawnDistanceMeters: 20_000,
      formationSpacingMeters: 1_500,
    },
  );
  assert.equal(
    spawnResult && spawnResult.success,
    true,
    "expected dungeon guard spawn to succeed",
  );

  const dungeonEntity = getOperatorEntities("testDrifterDungeonGuard")[0];
  assert(dungeonEntity, "expected spawned dungeon entity");

  const controller = npcService.getControllerByEntityID(dungeonEntity.itemID);
  assert(controller, "expected dungeon Drifter controller");
  assert.equal(
    String(controller.behaviorProfile && controller.behaviorProfile.drifterBehaviorFamily || ""),
    "dungeon",
    "expected the dungeon guard test hull to keep the explicit dungeon family on the live controller",
  );

  npcService.wakeNpcController(dungeonEntity.itemID, 0);
  const guarding = advanceSceneUntil(
    scene,
    5_000,
    250,
    () => (
      Number(dungeonEntity.targetEntityID) === Number(sunAnchor.itemID) &&
      String(dungeonEntity.mode || "").toUpperCase() === "ORBIT"
    ),
  );
  assert.equal(
    guarding,
    true,
    "expected dungeon-family Drifter hulls to orbit their authored guard anchor by default on the shared native path",
  );
});

test("/drifter commander hulls keep default target scoring instead of hunter entosis-priority behavior", () => {
  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const sunAnchor = [...scene.staticEntities].find((entity) => (
    entity && String(entity.kind || "").trim().toLowerCase() === "sun"
  ));
  assert(sunAnchor, "expected a static sun anchor in the test scene");

  const spawnResult = spawnNativeDrifterPackOnAnchor(
    sunAnchor,
    "commander",
    1,
    {
      operatorKind: "testDrifterCommanderEntosis",
      skipInitialBehaviorTick: true,
      preferredTargetID: 0,
      spawnDistanceMeters: 20_000,
      formationSpacingMeters: 1_500,
    },
  );
  assert.equal(
    spawnResult && spawnResult.success,
    true,
    "expected commander entosis-scoring spawn to succeed",
  );

  const commanderEntity = getOperatorEntities("testDrifterCommanderEntosis")[0];
  assert(commanderEntity, "expected spawned commander entity");

  const nearbyPlayerSession = registerAttachedSession(
    createFakeSession(
      9891493,
      9991493,
      {
        x: Number(commanderEntity.position.x) + 8_000,
        y: Number(commanderEntity.position.y),
        z: Number(commanderEntity.position.z),
      },
    ),
  );
  const entosisPlayerSession = registerAttachedSession(
    createFakeSession(
      9891494,
      9991494,
      {
        x: Number(commanderEntity.position.x) + 30_000,
        y: Number(commanderEntity.position.y),
        z: Number(commanderEntity.position.z),
      },
    ),
  );

  const entosisEntity = scene.getEntityByID(entosisPlayerSession._space.shipID);
  assert(entosisEntity, "expected entosis target entity");
  entosisEntity.activeModuleEffects = new Map([
    [
      9901494001,
      {
        moduleID: 9901494001,
        effectName: "entosisLink",
      },
    ],
  ]);

  npcService.wakeNpcController(commanderEntity.itemID, 0);
  const targetedNearby = advanceSceneUntil(
    scene,
    5_000,
    250,
    () => {
      const controller = npcService.getControllerByEntityID(commanderEntity.itemID);
      return controller && Number(controller.currentTargetID) === nearbyPlayerSession.shipItem.itemID;
    },
  );
  assert.equal(
    targetedNearby,
    true,
    "expected commander hulls to keep distance-based target scoring instead of prioritizing entosis targets like hunter Drifters",
  );
  const controller = npcService.getControllerByEntityID(commanderEntity.itemID);
  assert(controller, "expected commander controller");
  assert.equal(
    Number(controller.currentTargetID),
    nearbyPlayerSession.shipItem.itemID,
    "expected the nearer non-entosis target to win commander target selection",
  );
  assert.notEqual(
    Number(controller.currentTargetID),
    entosisPlayerSession.shipItem.itemID,
    "expected commander hulls not to inherit the generic Drifter entosis-priority target override",
  );
});

test("/drifter hulls can now drive native hull-based combat effects without fake fitted modules", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      989151,
      999151,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const spawnResult = executeChatCommand(
    pilotSession,
    "/drifter 1 battleship",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(spawnResult.handled, true);

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const entity = getOperatorEntities("drifterspawn")[0];
  assert(entity, "expected /drifter entity");

  const targetEntity = scene.getEntityByID(pilotSession._space.shipID);
  assert(targetEntity, "expected player ship entity");

  const pseudoSession = {
    characterID: 0,
    corporationID: entity.corporationID,
    allianceID: entity.allianceID,
    _space: {
      systemID: entity.systemID,
      shipID: entity.itemID,
    },
  };

  const lockResult = scene.finalizeTargetLock(entity, targetEntity, {
    nowMs: scene.getCurrentSimTimeMs(),
  });
  assert.equal(lockResult && lockResult.success, true, "expected direct target lock for NPC hull test");

  const weaponModule = npcEquipment.getNpcWeaponModules(entity)[0];
  assert(weaponModule, "expected synthetic hull weapon module");
  const hostileEntry = npcEquipment.getNpcHostileModules(entity)[0];
  assert(hostileEntry && hostileEntry.moduleItem, "expected synthetic hull hostile module");

  const weaponActivation = scene.activateGenericModule(
    pseudoSession,
    weaponModule,
    String(weaponModule.npcEffectName || "").trim() || null,
    {
      targetID: targetEntity.itemID,
    },
  );
  assert.equal(
    weaponActivation && weaponActivation.success,
    true,
    "expected Drifter hull weapon activation to succeed on a locked target",
  );

  const hostileActivation = scene.activateGenericModule(
    pseudoSession,
    hostileEntry.moduleItem,
    hostileEntry.effectName || null,
    {
      targetID: targetEntity.itemID,
    },
  );
  assert.equal(
    hostileActivation && hostileActivation.success,
    true,
    "expected Drifter hull hostile activation to succeed on a locked target",
  );

  const effectsStayedLive = advanceSceneUntil(
    scene,
    2_000,
    250,
    () => {
      const activeEffects = entity.activeModuleEffects instanceof Map
        ? [...entity.activeModuleEffects.values()]
        : [];
      const hasHullWeapon = activeEffects.some((effectState) => (
        effectState &&
        String(effectState.effectName || "").trim().toLowerCase() === "targetattack" &&
        !effectState.deactivatedAtMs
      ));
      const hasHostileUtility = activeEffects.some((effectState) => (
        effectState &&
        effectState.hostileModuleEffect === true &&
        !effectState.deactivatedAtMs
      ));
      return hasHullWeapon && hasHostileUtility;
    },
  );
  assert.equal(
    effectsStayedLive,
    true,
    "expected Drifter hull weapon and hostile utility effects to stay live after activation",
  );
});

test("/drifter battleships can activate their hull superweapon and emit TurboLaser without fake fuel", async () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      989161,
      999161,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const spawnResult = executeChatCommand(
    pilotSession,
    "/drifter 1 battleship",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(spawnResult.handled, true);

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const entity = getOperatorEntities("drifterspawn")[0];
  assert(entity, "expected /drifter entity");

  const targetEntity = scene.getEntityByID(pilotSession._space.shipID);
  assert(targetEntity, "expected player ship entity");

  const lockResult = scene.finalizeTargetLock(entity, targetEntity, {
    nowMs: scene.getCurrentSimTimeMs(),
  });
  assert.equal(lockResult && lockResult.success, true, "expected direct target lock for Drifter superweapon test");

  const pseudoSession = {
    characterID: 0,
    corporationID: entity.corporationID,
    allianceID: entity.allianceID,
    _space: {
      systemID: entity.systemID,
      shipID: entity.itemID,
    },
  };

  const superweaponModule = npcEquipment.getNpcSuperweaponModules(entity)[0];
  assert(superweaponModule, "expected synthetic hull superweapon module");

  const activationResult = scene.activateGenericModule(
    pseudoSession,
    superweaponModule,
    String(superweaponModule.npcEffectName || "").trim() || null,
    {
      targetID: targetEntity.itemID,
    },
  );
  assert.equal(
    activationResult && activationResult.success,
    true,
    "expected Drifter hull superweapon activation to succeed without fuel cargo",
  );

  const superweaponState = entity.activeModuleEffects instanceof Map
    ? [...entity.activeModuleEffects.values()].find((effectState) => (
      effectState &&
      effectState.superweaponEffect === true &&
      String(effectState.guid || "").trim() === "effects.TurboLaser"
    )) || null
    : null;
  assert(superweaponState, "expected Drifter superweapon effect state to stay active after activation");
  assert.equal(
    Number(superweaponState.superweaponFuelTypeID || 0),
    0,
    "expected Drifter hull superweapon to stay on the zero-fuel execute path",
  );
  assert.equal(
    Number(superweaponState.superweaponFuelPerActivation || 0),
    0,
    "expected Drifter hull superweapon to consume no fuel",
  );

  flushDirectDestinyNotifications(scene);
  await new Promise((resolve) => setImmediate(resolve));
});

test("/drifter battleships eventually emit TurboLaser during autonomous combat", async () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      989171,
      999171,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const spawnResult = executeChatCommand(
    pilotSession,
    "/drifter 1 battleship",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(spawnResult.handled, true);

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const activated = advanceSceneUntil(
    scene,
    35_000,
    250,
    () => {
      const fxUpdates = flattenDestinyUpdates(pilotSession.notifications)
        .filter((entry) => entry.name === "OnSpecialFX");
      return fxUpdates.some((entry) => String(entry.args[5]) === "effects.TurboLaser");
    },
  );
  assert.equal(
    activated,
    true,
    "expected autonomous Drifter combat to eventually emit TurboLaser",
  );

  flushDirectDestinyNotifications(scene);
  await new Promise((resolve) => setImmediate(resolve));

  const fxUpdates = flattenDestinyUpdates(pilotSession.notifications)
    .filter((entry) => entry.name === "OnSpecialFX");
  assert.ok(
    fxUpdates.some((entry) => String(entry.args[5]) === "effects.TurboLaser"),
    "expected autonomous Drifter combat to keep the TurboLaser FX on the live wire path",
  );

  const entity = getOperatorEntities("drifterspawn")[0];
  const controller = entity ? npcService.getControllerByEntityID(entity.itemID) : null;
  assert.equal(
    Boolean(
      controller &&
        controller.drifterCombatState &&
        controller.drifterCombatState.waitingForTurboShieldResistive,
    ),
    true,
    "expected the Drifter superweapon to wait for the next turbo-shield RESISTIVE transition instead of rearming on the duration timer",
  );
  assert.equal(
    Number(controller.drifterCombatState.nextSuperweaponReadyAtMs || 0),
    0,
    "expected the Drifter superweapon not to queue a repeat shot solely from entitySuperWeaponDuration",
  );
});

test("/drifter superweapon podding intent retargets matching capsules after the shot", () => {
  const anchorSession = registerAttachedSession(
    createFakeSession(
      989172,
      999172,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );
  const victimSession = registerAttachedSession(
    createFakeSession(
      989173,
      999173,
      { x: -107303340000, y: -18744975360, z: 436489052160 },
    ),
  );

  const spawnResult = spawnNativeDrifterPack(
    anchorSession,
    "battleship",
    1,
    {
      operatorKind: "testDrifterPodding",
      preferredTargetID: 0,
      spawnDistanceMeters: 20_000,
      formationSpacingMeters: 1_500,
    },
  );
  assert.equal(spawnResult && spawnResult.success, true, "expected Drifter podding test spawn to succeed");

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const drifterEntity = getOperatorEntities("testDrifterPodding")[0];
  assert(drifterEntity, "expected spawned Drifter entity");

  const victimEntity = scene.getEntityByID(victimSession._space.shipID);
  assert(victimEntity, "expected victim ship entity");

  const aggressionResult = npcService.noteNpcIncomingAggression(
    drifterEntity,
    victimEntity,
    scene.getCurrentSimTimeMs(),
  );
  assert.equal(aggressionResult && aggressionResult.success, true, "expected aggression wake to succeed");

  const controller = npcService.getControllerByEntityID(drifterEntity.itemID);
  assert(controller, "expected Drifter controller");
  controller.preferredTargetID = victimEntity.itemID;
  controller.currentTargetID = victimEntity.itemID;
  if (!controller.drifterCombatState || typeof controller.drifterCombatState !== "object") {
    controller.drifterCombatState = {};
  }
  controller.drifterCombatState.nextSuperweaponReadyAtMs = scene.getCurrentSimTimeMs();

  const recordedOwner = advanceSceneUntil(
    scene,
    15_000,
    250,
    () => {
      const refreshedController = npcService.getControllerByEntityID(drifterEntity.itemID);
      return Boolean(
        refreshedController &&
        refreshedController.drifterCombatState &&
        Number(refreshedController.drifterCombatState.lastSuperweaponTargetID) === victimEntity.itemID &&
        Number(refreshedController.drifterCombatState.pendingPoddingOwnerID) === victimSession.characterID
      );
    },
  );
  assert.equal(
    recordedOwner,
    true,
    "expected the Drifter superweapon sequence to record a podding owner intent for the player target",
  );

  const capsuleSession = registerAttachedSession(
    createFakeCapsuleSession(
      989174,
      999174,
      victimSession.characterID,
      {
        x: Number(victimEntity.position.x) + 800,
        y: Number(victimEntity.position.y),
        z: Number(victimEntity.position.z),
      },
    ),
  );
  const capsuleEntity = scene.getEntityByID(capsuleSession._space.shipID);
  assert(capsuleEntity, "expected same-owner capsule entity");

  const teleportResult = spaceRuntime.teleportDynamicEntityToPoint(
    TEST_SYSTEM_ID,
    victimEntity.itemID,
    {
      x: Number(victimEntity.position.x) + 1_000_000_000,
      y: Number(victimEntity.position.y),
      z: Number(victimEntity.position.z),
    },
    {
      broadcast: false,
      direction: victimEntity.direction || { x: 1, y: 0, z: 0 },
    },
  );
  assert.equal(teleportResult && teleportResult.success, true, "expected victim ship teleport to succeed");
  npcService.wakeNpcController(drifterEntity.itemID, 0);

  const retargetedCapsule = advanceSceneUntil(
    scene,
    10_000,
    250,
    () => {
      const refreshedController = npcService.getControllerByEntityID(drifterEntity.itemID);
      return Boolean(
        refreshedController &&
        Number(refreshedController.currentTargetID) === capsuleEntity.itemID
      );
    },
  );
  assert.equal(
    retargetedCapsule,
    true,
    "expected the Drifter to retarget the matching-owner capsule once the original ship left the bubble",
  );
});

test("/drifter GM command packs explicitly enable capsule follow-through without changing shared site guard behavior", () => {
  const anchorSession = registerAttachedSession(
    createFakeSession(
      989171,
      999171,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const commandResult = trigDrifterCommandModule.executeTrigDrifterCommand(
    anchorSession,
    "drifter",
    "1 battleship",
  );
  assert.equal(commandResult && commandResult.success, true, "expected /drifter command spawn to succeed");

  const drifterEntity = getOperatorEntities("drifterspawn")[0];
  assert(drifterEntity, "expected command-spawned Drifter entity");

  const controller = npcService.getControllerByEntityID(drifterEntity.itemID);
  assert(controller, "expected command-spawned Drifter controller");
  assert.equal(
    Boolean(
      controller.behaviorOverrides &&
      controller.behaviorOverrides.allowPodKill === true
    ),
    true,
    "expected /drifter command packs to opt into capsule follow-through on the GM spawn path",
  );
});

test("/drifter podding follow-through destroys the matching capsule and clears podding intent", () => {
  const anchorSession = registerAttachedSession(
    createFakeSession(
      989272,
      999272,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );
  const victimSession = registerAttachedSession(
    createFakeSession(
      989273,
      999273,
      { x: -107303340000, y: -18744975360, z: 436489052160 },
    ),
  );

  const spawnResult = spawnNativeDrifterPack(
    anchorSession,
    "battleship",
    1,
    {
      operatorKind: "testDrifterPoddingDestroy",
      preferredTargetID: 0,
      spawnDistanceMeters: 20_000,
      formationSpacingMeters: 1_500,
    },
  );
  assert.equal(
    spawnResult && spawnResult.success,
    true,
    "expected Drifter podding-destroy test spawn to succeed",
  );

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const drifterEntity = getOperatorEntities("testDrifterPoddingDestroy")[0];
  assert(drifterEntity, "expected spawned Drifter entity");

  const victimEntity = scene.getEntityByID(victimSession._space.shipID);
  assert(victimEntity, "expected victim ship entity");

  const aggressionResult = npcService.noteNpcIncomingAggression(
    drifterEntity,
    victimEntity,
    scene.getCurrentSimTimeMs(),
  );
  assert.equal(
    aggressionResult && aggressionResult.success,
    true,
    "expected aggression wake to succeed",
  );

  const controller = npcService.getControllerByEntityID(drifterEntity.itemID);
  assert(controller, "expected Drifter controller");
  controller.preferredTargetID = victimEntity.itemID;
  controller.currentTargetID = victimEntity.itemID;
  if (!controller.drifterCombatState || typeof controller.drifterCombatState !== "object") {
    controller.drifterCombatState = {};
  }
  controller.drifterCombatState.nextSuperweaponReadyAtMs = scene.getCurrentSimTimeMs();

  const recordedOwner = advanceSceneUntil(
    scene,
    15_000,
    250,
    () => {
      const refreshedController = npcService.getControllerByEntityID(drifterEntity.itemID);
      return Boolean(
        refreshedController &&
        refreshedController.drifterCombatState &&
        Number(refreshedController.drifterCombatState.lastSuperweaponTargetID) === victimEntity.itemID &&
        Number(refreshedController.drifterCombatState.pendingPoddingOwnerID) === victimSession.characterID
      );
    },
  );
  assert.equal(
    recordedOwner,
    true,
    "expected the Drifter superweapon sequence to record podding follow-through intent for the victim owner",
  );

  const capsuleSession = registerAttachedSession(
    createFakeCapsuleSession(
      989274,
      999274,
      victimSession.characterID,
      {
        x: Number(victimEntity.position.x) + 800,
        y: Number(victimEntity.position.y),
        z: Number(victimEntity.position.z),
      },
    ),
  );
  const capsuleEntity = scene.getEntityByID(capsuleSession._space.shipID);
  assert(capsuleEntity, "expected same-owner capsule entity");

  const teleportResult = spaceRuntime.teleportDynamicEntityToPoint(
    TEST_SYSTEM_ID,
    victimEntity.itemID,
    {
      x: Number(victimEntity.position.x) + 1_000_000_000,
      y: Number(victimEntity.position.y),
      z: Number(victimEntity.position.z),
    },
    {
      broadcast: false,
      direction: victimEntity.direction || { x: 1, y: 0, z: 0 },
    },
  );
  assert.equal(teleportResult && teleportResult.success, true, "expected victim ship teleport to succeed");
  npcService.wakeNpcController(drifterEntity.itemID, 0);

  const retargetedCapsule = advanceSceneUntil(
    scene,
    10_000,
    250,
    () => {
      const refreshedController = npcService.getControllerByEntityID(drifterEntity.itemID);
      return Boolean(
        refreshedController &&
        Number(refreshedController.currentTargetID) === capsuleEntity.itemID
      );
    },
  );
  assert.equal(
    retargetedCapsule,
    true,
    "expected the Drifter to pick up the same-owner capsule as its follow-through target",
  );

  controller.drifterCombatState.nextSuperweaponReadyAtMs = scene.getCurrentSimTimeMs();
  npcService.wakeNpcController(drifterEntity.itemID, 0);

  const capsuleDestroyed = advanceSceneUntil(
    scene,
    20_000,
    250,
    () => !scene.getEntityByID(capsuleEntity.itemID),
  );
  assert.equal(
    capsuleDestroyed,
    true,
    "expected the Drifter to destroy the matching-owner capsule during podding follow-through",
  );

  const clearedPoddingIntent = advanceSceneUntil(
    scene,
    5_000,
    250,
    () => {
      const refreshedController = npcService.getControllerByEntityID(drifterEntity.itemID);
      return Boolean(
        refreshedController &&
        refreshedController.drifterCombatState &&
        Number(refreshedController.drifterCombatState.pendingPoddingOwnerID) === 0
      );
    },
  );
  assert.equal(
    clearedPoddingIntent,
    true,
    "expected the Drifter to clear podding intent once the matching capsule is gone",
  );
});

test("/drifter behavior prioritizes entosis-active targets over default nearest-player picks", () => {
  const anchorSession = registerAttachedSession(
    createFakeSession(
      989175,
      999175,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );
  const nearbyPlayerSession = registerAttachedSession(
    createFakeSession(
      989176,
      999176,
      { x: -107303360000, y: -18744975360, z: 436489052160 },
    ),
  );
  const entosisPlayerSession = registerAttachedSession(
    createFakeSession(
      989177,
      999177,
      { x: -107303300000, y: -18744975360, z: 436489052160 },
    ),
  );

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const entosisEntity = scene.getEntityByID(entosisPlayerSession._space.shipID);
  assert(entosisEntity, "expected entosis target entity");
  entosisEntity.activeModuleEffects = new Map([
    [
      990177001,
      {
        moduleID: 990177001,
        effectName: "entosisLink",
      },
    ],
  ]);

  const spawnResult = spawnNativeDrifterPack(
    anchorSession,
    "battleship",
    1,
    {
      operatorKind: "testDrifterEntosis",
      preferredTargetID: 0,
      spawnDistanceMeters: 20_000,
      formationSpacingMeters: 1_500,
    },
  );
  assert.equal(spawnResult && spawnResult.success, true, "expected Drifter pack spawn to succeed");

  const drifterEntity = getOperatorEntities("testDrifterEntosis")[0];
  assert(drifterEntity, "expected spawned Drifter entity");

  const targetedEntosis = advanceSceneUntil(
    scene,
    5_000,
    250,
    () => {
      const controller = npcService.getControllerByEntityID(drifterEntity.itemID);
      return controller && Number(controller.currentTargetID) === entosisPlayerSession.shipItem.itemID;
    },
  );
  assert.equal(
    targetedEntosis,
    true,
    "expected Drifter target selection to prioritize the entosis-active target",
  );

  const controller = npcService.getControllerByEntityID(drifterEntity.itemID);
  assert(controller, "expected Drifter controller");
  assert.equal(
    Number(controller.currentTargetID),
    entosisPlayerSession.shipItem.itemID,
    "expected Drifter target memory to resolve onto the entosis-active ship",
  );
  assert.notEqual(
    Number(controller.currentTargetID),
    nearbyPlayerSession.shipItem.itemID,
    "expected the closer non-entosis target not to win Drifter priority selection",
  );
});

test("/drifter roaming-family hulls keep distance-based target scoring instead of hunter entosis-priority behavior", () => {
  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const sunAnchor = [...scene.staticEntities].find((entity) => (
    entity && String(entity.kind || "").trim().toLowerCase() === "sun"
  ));
  assert(sunAnchor, "expected a static sun anchor in the test scene");

  const spawnResult = spawnNativeDrifterPackOnAnchor(
    sunAnchor,
    "roaming battleship",
    1,
    {
      operatorKind: "testDrifterRoamingEntosis",
      skipInitialBehaviorTick: true,
      preferredTargetID: 0,
      spawnDistanceMeters: 20_000,
      formationSpacingMeters: 1_500,
    },
  );
  assert.equal(spawnResult && spawnResult.success, true, "expected roaming Drifter spawn to succeed");

  const drifterEntity = getOperatorEntities("testDrifterRoamingEntosis")[0];
  assert(drifterEntity, "expected spawned roaming Drifter entity");

  const nearbyPlayerSession = registerAttachedSession(
    createFakeSession(
      989279,
      999279,
      {
        x: Number(drifterEntity.position.x) + 8_000,
        y: Number(drifterEntity.position.y),
        z: Number(drifterEntity.position.z),
      },
    ),
  );
  const entosisPlayerSession = registerAttachedSession(
    createFakeSession(
      989280,
      999280,
      {
        x: Number(drifterEntity.position.x) + 30_000,
        y: Number(drifterEntity.position.y),
        z: Number(drifterEntity.position.z),
      },
    ),
  );

  const entosisEntity = scene.getEntityByID(entosisPlayerSession._space.shipID);
  assert(entosisEntity, "expected entosis target entity");
  entosisEntity.activeModuleEffects = new Map([
    [
      990280001,
      {
        moduleID: 990280001,
        effectName: "entosisLink",
      },
    ],
  ]);
  npcService.wakeNpcController(drifterEntity.itemID, 0);

  const targetedNearby = advanceSceneUntil(
    scene,
    5_000,
    250,
    () => {
      const controller = npcService.getControllerByEntityID(drifterEntity.itemID);
      return controller && Number(controller.currentTargetID) === nearbyPlayerSession.shipItem.itemID;
    },
  );
  assert.equal(
    targetedNearby,
    true,
    "expected roaming-family Drifters to keep normal distance-based target scoring instead of hunter entosis-priority behavior",
  );

  const controller = npcService.getControllerByEntityID(drifterEntity.itemID);
  assert(controller, "expected roaming Drifter controller");
  assert.equal(
    String(controller.behaviorProfile && controller.behaviorProfile.drifterBehaviorFamily || ""),
    "roaming",
    "expected the roaming-family test hull to keep its explicit family tag on the live controller",
  );
  assert.equal(
    Number(controller.currentTargetID),
    nearbyPlayerSession.shipItem.itemID,
    "expected the nearer non-entosis target to win roaming-family target selection",
  );
  assert.notEqual(
    Number(controller.currentTargetID),
    entosisPlayerSession.shipItem.itemID,
    "expected roaming-family Drifters not to inherit the generic hunter entosis-priority target override",
  );
});

test("/drifter aggression propagates through the whole pack and wakes allied hulls onto the aggressor", () => {
  const anchorSession = registerAttachedSession(
    createFakeSession(
      989178,
      999178,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );
  const aggressorSession = registerAttachedSession(
    createFakeSession(
      989179,
      999179,
      { x: -107303340000, y: -18744975360, z: 436489052160 },
    ),
  );

  const spawnResult = spawnNativeDrifterPack(
    anchorSession,
    "battleship",
    2,
    {
      operatorKind: "testDrifterReinforce",
      skipInitialBehaviorTick: true,
      preferredTargetID: 0,
      spawnDistanceMeters: 20_000,
      formationSpacingMeters: 1_500,
    },
  );
  assert.equal(spawnResult && spawnResult.success, true, "expected Drifter pack spawn to succeed");

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const drifterEntities = getOperatorEntities("testDrifterReinforce");
  assert.equal(drifterEntities.length, 2, "expected two spawned Drifter entities");

  const aggressorEntity = scene.getEntityByID(aggressorSession._space.shipID);
  assert(aggressorEntity, "expected aggressor ship entity");

  const aggressionResult = npcService.noteNpcIncomingAggression(
    drifterEntities[0],
    aggressorEntity,
    scene.getCurrentSimTimeMs(),
  );
  assert.equal(aggressionResult && aggressionResult.success, true, "expected aggression note to succeed");
  assert.deepEqual(
    [...new Set((aggressionResult.data && aggressionResult.data.propagatedEntityIDs) || [])].sort((left, right) => left - right),
    [drifterEntities[1].itemID],
    "expected the allied Drifter hull to inherit the reinforcement wakeup",
  );

  const packAligned = advanceSceneUntil(
    scene,
    5_000,
    250,
    () => drifterEntities.every((entity) => {
      const controller = npcService.getControllerByEntityID(entity.itemID);
      return (
        controller &&
        Number(controller.preferredTargetID) === aggressorSession.shipItem.itemID &&
        Number(controller.currentTargetID) === aggressorSession.shipItem.itemID
      );
    }),
  );
  assert.equal(
    packAligned,
    true,
    "expected the whole Drifter pack to wake and align onto the aggressor target",
  );
});

test("/drifter lancer hulls can request configured Drifter reinforcements on the native NPC path", () => {
  const anchorSession = registerAttachedSession(
    createFakeSession(
      989181,
      999181,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );
  const aggressorSession = registerAttachedSession(
    createFakeSession(
      989180,
      999180,
      { x: -107303342560, y: -18744975360, z: 436489052160 },
    ),
  );

  const spawnResult = spawnNativeDrifterPack(
    anchorSession,
    "lancer",
    1,
    {
      operatorKind: "testDrifterLancerReinforcement",
      skipInitialBehaviorTick: true,
      preferredTargetID: 0,
      spawnDistanceMeters: 18_000,
      formationSpacingMeters: 1_200,
    },
  );
  assert.equal(
    spawnResult && spawnResult.success,
    true,
    "expected Drifter lancer spawn to succeed",
  );

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const initialEntities = getOperatorEntities("testDrifterLancerReinforcement");
  assert.equal(
    initialEntities.length,
    1,
    "expected only the lancer before reinforcements are requested",
  );

  const lancerEntity = initialEntities[0];
  assert(lancerEntity, "expected spawned lancer entity");
  const aggressorEntity = scene.getEntityByID(aggressorSession._space.shipID);
  assert(aggressorEntity, "expected aggressor ship entity");

  const aggressionResult = npcService.noteNpcIncomingAggression(
    lancerEntity,
    aggressorEntity,
    scene.getCurrentSimTimeMs(),
  );
  assert.equal(
    aggressionResult && aggressionResult.success,
    true,
    "expected lancer aggression wake to succeed",
  );
  npcService.wakeNpcController(lancerEntity.itemID, 0);

  const drifterBattleshipTypeID = trigDrifterCommandModule.__testing
    .resolveDrifterVariant("battleship")
    .shipTypeID;
  const reinforcementArrived = advanceSceneUntil(
    scene,
    10_000,
    250,
    () => {
      const entities = getOperatorEntities("testDrifterLancerReinforcement");
      const reinforcement = entities.find((entity) => (
        Number(entity && entity.typeID || 0) === Number(drifterBattleshipTypeID)
      ));
      if (!reinforcement) {
        return false;
      }
      const reinforcementController = npcService.getControllerByEntityID(reinforcement.itemID);
      return Boolean(
        reinforcementController &&
        (
          Number(reinforcementController.preferredTargetID || 0) === aggressorSession.shipItem.itemID ||
          Number(reinforcementController.currentTargetID || 0) === aggressorSession.shipItem.itemID
        ),
      );
    },
  );
  assert.equal(
    reinforcementArrived,
    true,
    "expected the lancer to request a Drifter battleship reinforcement that inherits the live aggressor as its combat focus",
  );
});

test("/drifter hive-family lancer hulls keep reinforcement requests on the native NPC path", () => {
  const anchorSession = registerAttachedSession(
    createFakeSession(
      989281,
      999281,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );
  const aggressorSession = registerAttachedSession(
    createFakeSession(
      989280,
      999280,
      { x: -107303342560, y: -18744975360, z: 436489052160 },
    ),
  );

  const spawnResult = spawnNativeDrifterPack(
    anchorSession,
    "hive lancer",
    1,
    {
      operatorKind: "testDrifterHiveLancerReinforcement",
      skipInitialBehaviorTick: true,
      preferredTargetID: 0,
      spawnDistanceMeters: 18_000,
      formationSpacingMeters: 1_200,
    },
  );
  assert.equal(
    spawnResult && spawnResult.success,
    true,
    "expected hive-family Drifter lancer spawn to succeed",
  );

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const initialEntities = getOperatorEntities("testDrifterHiveLancerReinforcement");
  assert.equal(
    initialEntities.length,
    1,
    "expected only the hive-family lancer before reinforcements are requested",
  );

  const lancerEntity = initialEntities[0];
  assert(lancerEntity, "expected spawned hive-family lancer entity");
  const lancerController = npcService.getControllerByEntityID(lancerEntity.itemID);
  assert(lancerController, "expected hive-family lancer controller");
  assert.equal(
    String(lancerController.behaviorProfile && lancerController.behaviorProfile.drifterBehaviorFamily || ""),
    "hive",
    "expected the hive-family lancer to keep the explicit hive family on the live controller",
  );
  assert.equal(
    Boolean(lancerController.behaviorProfile && lancerController.behaviorProfile.drifterEnableReinforcements),
    true,
    "expected hive-family lancers to keep reinforcement calls enabled",
  );
  assert.equal(
    Boolean(lancerController.behaviorProfile && lancerController.behaviorProfile.drifterEnableEntosisPriority),
    false,
    "expected hive-family lancers not to inherit hunter-only entosis-priority behavior",
  );

  const aggressorEntity = scene.getEntityByID(aggressorSession._space.shipID);
  assert(aggressorEntity, "expected aggressor ship entity");

  const aggressionResult = npcService.noteNpcIncomingAggression(
    lancerEntity,
    aggressorEntity,
    scene.getCurrentSimTimeMs(),
  );
  assert.equal(
    aggressionResult && aggressionResult.success,
    true,
    "expected hive-family lancer aggression wake to succeed",
  );
  npcService.wakeNpcController(lancerEntity.itemID, 0);

  const drifterBattleshipTypeID = trigDrifterCommandModule.__testing
    .resolveDrifterVariant("battleship")
    .shipTypeID;
  const reinforcementArrived = advanceSceneUntil(
    scene,
    10_000,
    250,
    () => {
      const entities = getOperatorEntities("testDrifterHiveLancerReinforcement");
      const reinforcement = entities.find((entity) => (
        Number(entity && entity.typeID || 0) === Number(drifterBattleshipTypeID)
      ));
      if (!reinforcement) {
        return false;
      }
      const reinforcementController = npcService.getControllerByEntityID(reinforcement.itemID);
      return Boolean(
        reinforcementController &&
        String(reinforcementController.behaviorProfile && reinforcementController.behaviorProfile.drifterBehaviorFamily || "") === "hive" &&
        (
          Number(reinforcementController.preferredTargetID || 0) === aggressorSession.shipItem.itemID ||
          Number(reinforcementController.currentTargetID || 0) === aggressorSession.shipItem.itemID
        )
      );
    },
  );
  assert.equal(
    reinforcementArrived,
    true,
    "expected hive-family lancers to keep the reinforcement lane while carrying the explicit hive family through the shared native path",
  );
});

test("/drifter defensive proximity aggression wakes passive site Lancers once a player enters the envelope", () => {
  const anchorSession = registerAttachedSession(
    createFakeSession(
      9891811,
      9991811,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const sunAnchor = [...scene.staticEntities].find((entity) => (
    entity && String(entity.kind || "").trim().toLowerCase() === "sun"
  ));
  assert(sunAnchor, "expected a static sun anchor in the test scene");

  const spawnResult = spawnNativeDrifterPackOnAnchor(
    sunAnchor,
    "lancer",
    1,
    {
      operatorKind: "testDrifterProximityAggro",
      skipInitialBehaviorTick: true,
      preferredTargetID: 0,
      spawnDistanceMeters: 20_000,
      formationSpacingMeters: 1_500,
      behaviorOverrides: {
        autoAggro: false,
        targetPreference: "none",
        autoActivateWeapons: true,
        aggressionRangeMeters: 70_000,
        proximityAggroRangeMeters: 70_000,
        proximityAggroTargetClasses: ["player"],
        returnToHomeWhenIdle: true,
        idleAnchorOrbit: true,
      },
    },
  );
  assert.equal(
    spawnResult && spawnResult.success,
    true,
    "expected defensive Drifter lancer spawn to succeed",
  );

  const lancerEntity = getOperatorEntities("testDrifterProximityAggro")[0];
  assert(lancerEntity, "expected spawned defensive Drifter lancer");
  const controller = npcService.getControllerByEntityID(lancerEntity.itemID);
  assert(controller, "expected defensive Drifter lancer controller");

  const farPlayerSession = registerAttachedSession(
    createFakeSession(
      9891812,
      9991812,
      {
        x: Number(lancerEntity.position.x) + 110_000,
        y: Number(lancerEntity.position.y),
        z: Number(lancerEntity.position.z),
      },
    ),
  );

  npcService.wakeNpcController(lancerEntity.itemID, 0);
  const targetedTooFar = advanceSceneUntil(
    scene,
    3_000,
    250,
    () => {
      const liveController = npcService.getControllerByEntityID(lancerEntity.itemID);
      return liveController && Number(liveController.currentTargetID) === farPlayerSession.shipItem.itemID;
    },
  );
  assert.equal(
    targetedTooFar,
    false,
    "expected defensive Drifter site behavior to stay passive while players remain outside the proximity envelope",
  );

  const nearbyPlayerSession = registerAttachedSession(
    createFakeSession(
      9891813,
      9991813,
      {
        x: Number(lancerEntity.position.x) + 12_000,
        y: Number(lancerEntity.position.y),
        z: Number(lancerEntity.position.z),
      },
    ),
  );

  const targetedNearby = advanceSceneUntil(
    scene,
    5_000,
    250,
    () => {
      const liveController = npcService.getControllerByEntityID(lancerEntity.itemID);
      return liveController && Number(liveController.currentTargetID) === nearbyPlayerSession.shipItem.itemID;
    },
  );
  assert.equal(
    targetedNearby,
    true,
    "expected defensive Drifter site behavior to wake once a player enters the proximity aggression envelope",
  );
  assert.notEqual(
    Number((npcService.getControllerByEntityID(lancerEntity.itemID) || {}).currentTargetID || 0),
    farPlayerSession.shipItem.itemID,
    "expected the farther player outside the proximity envelope not to win defensive Drifter target selection",
  );
});

test("/drifter idle packs regroup separated wingmates onto their leader bubble", () => {
  const anchorSession = registerAttachedSession(
    createFakeSession(
      989182,
      999182,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const spawnResult = spawnNativeDrifterPack(
    anchorSession,
    "battleship",
    2,
    {
      operatorKind: "testDrifterRegroup",
      skipInitialBehaviorTick: true,
      preferredTargetID: 0,
      spawnDistanceMeters: 20_000,
      formationSpacingMeters: 1_500,
      behaviorOverrides: {
        movementMode: "hold",
        autoAggro: false,
        autoActivateWeapons: false,
        targetPreference: "none",
        aggressionRangeMeters: 250_000,
        returnToHomeWhenIdle: false,
        useChasePropulsion: false,
        drifterBehavior: true,
      },
    },
  );
  assert.equal(spawnResult && spawnResult.success, true, "expected idle Drifter pack spawn to succeed");

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const drifterEntities = getOperatorEntities("testDrifterRegroup")
    .slice()
    .sort((left, right) => Number(left.itemID) - Number(right.itemID));
  assert.equal(drifterEntities.length, 2, "expected two spawned Drifter entities");

  const leaderEntity = drifterEntities[0];
  const wingmateEntity = drifterEntities[1];
  const teleportResult = spaceRuntime.teleportDynamicEntityToPoint(
    TEST_SYSTEM_ID,
    wingmateEntity.itemID,
    {
      x: Number(wingmateEntity.position.x) + 1_000_000_000,
      y: Number(wingmateEntity.position.y),
      z: Number(wingmateEntity.position.z),
    },
    {
      broadcast: false,
      direction: wingmateEntity.direction || { x: 1, y: 0, z: 0 },
    },
  );
  assert.equal(teleportResult && teleportResult.success, true, "expected wingmate separation teleport to succeed");
  assert.notEqual(
    Number(wingmateEntity.bubbleID) || 0,
    Number(leaderEntity.bubbleID) || 0,
    "expected the teleported wingmate to start outside the leader bubble",
  );
  npcService.wakeNpcController(leaderEntity.itemID, 0);
  npcService.wakeNpcController(wingmateEntity.itemID, 0);

  const regrouped = advanceSceneUntil(
    scene,
    20_000,
    250,
    () => (
      Number(wingmateEntity.bubbleID) > 0 &&
      Number(wingmateEntity.bubbleID) === Number(leaderEntity.bubbleID)
    ),
  );
  assert.equal(
    regrouped,
    true,
    "expected the separated Drifter wingmate to warp back onto the leader bubble",
  );
});

test("/drifter roaming-family idle packs still regroup separated wingmates onto their leader bubble", () => {
  const anchorSession = registerAttachedSession(
    createFakeSession(
      989281,
      999281,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const spawnResult = spawnNativeDrifterPack(
    anchorSession,
    "roaming battleship",
    2,
    {
      operatorKind: "testDrifterRoamingRegroup",
      skipInitialBehaviorTick: true,
      preferredTargetID: 0,
      spawnDistanceMeters: 20_000,
      formationSpacingMeters: 1_500,
      behaviorOverrides: {
        movementMode: "hold",
        autoAggro: false,
        autoActivateWeapons: false,
        targetPreference: "none",
        aggressionRangeMeters: 250_000,
        returnToHomeWhenIdle: false,
        useChasePropulsion: false,
        drifterBehavior: true,
      },
    },
  );
  assert.equal(spawnResult && spawnResult.success, true, "expected roaming idle Drifter pack spawn to succeed");

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const drifterEntities = getOperatorEntities("testDrifterRoamingRegroup")
    .slice()
    .sort((left, right) => Number(left.itemID) - Number(right.itemID));
  assert.equal(drifterEntities.length, 2, "expected two spawned roaming Drifter entities");

  const leaderEntity = drifterEntities[0];
  const wingmateEntity = drifterEntities[1];
  const leaderController = npcService.getControllerByEntityID(leaderEntity.itemID);
  assert(leaderController, "expected roaming leader controller");
  assert.equal(
    String(leaderController.behaviorProfile && leaderController.behaviorProfile.drifterBehaviorFamily || ""),
    "roaming",
    "expected roaming regroup test hulls to keep the explicit roaming family",
  );

  const teleportResult = spaceRuntime.teleportDynamicEntityToPoint(
    TEST_SYSTEM_ID,
    wingmateEntity.itemID,
    {
      x: Number(wingmateEntity.position.x) + 1_000_000_000,
      y: Number(wingmateEntity.position.y),
      z: Number(wingmateEntity.position.z),
    },
    {
      broadcast: false,
      direction: wingmateEntity.direction || { x: 1, y: 0, z: 0 },
    },
  );
  assert.equal(teleportResult && teleportResult.success, true, "expected roaming wingmate separation teleport to succeed");
  assert.notEqual(
    Number(wingmateEntity.bubbleID) || 0,
    Number(leaderEntity.bubbleID) || 0,
    "expected the teleported roaming wingmate to start outside the leader bubble",
  );

  npcService.wakeNpcController(leaderEntity.itemID, 0);
  npcService.wakeNpcController(wingmateEntity.itemID, 0);
  const regrouped = advanceSceneUntil(
    scene,
    20_000,
    250,
    () => (
      Number(wingmateEntity.bubbleID) > 0 &&
      Number(wingmateEntity.bubbleID) === Number(leaderEntity.bubbleID)
    ),
  );
  assert.equal(
    regrouped,
    true,
    "expected roaming-family Drifters to keep the CCP-style regroup lane instead of collapsing into the commander guard-only behavior family",
  );
});

test("/drifter idle guard packs warp back onto a moved anchor and resume guarding it", () => {
  const anchorSession = registerAttachedSession(
    createFakeSession(
      989185,
      999185,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const spawnResult = spawnNativeDrifterPack(
    anchorSession,
    "battleship",
    1,
    {
      operatorKind: "testDrifterGuardAnchor",
      skipInitialBehaviorTick: true,
      preferredTargetID: 0,
      spawnDistanceMeters: 20_000,
      formationSpacingMeters: 1_500,
      behaviorOverrides: {
        movementMode: "hold",
        autoAggro: false,
        autoActivateWeapons: false,
        targetPreference: "none",
        aggressionRangeMeters: 250_000,
        returnToHomeWhenIdle: false,
        idleAnchorOrbit: true,
        idleAnchorOrbitDistanceMeters: 10_000,
        useChasePropulsion: false,
        drifterBehavior: true,
      },
    },
  );
  assert.equal(spawnResult && spawnResult.success, true, "expected idle guard Drifter spawn to succeed");

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const drifterEntity = getOperatorEntities("testDrifterGuardAnchor")[0];
  assert(drifterEntity, "expected spawned Drifter guard entity");

  npcService.wakeNpcController(drifterEntity.itemID, 0);
  const initiallyGuarding = advanceSceneUntil(
    scene,
    5_000,
    250,
    () => (
      Number(drifterEntity.targetEntityID) === anchorSession.shipItem.itemID &&
      String(drifterEntity.mode || "").toUpperCase() === "ORBIT"
    ),
  );
  assert.equal(
    initiallyGuarding,
    true,
    "expected the idle Drifter guard pack to begin orbiting its anchor",
  );

  const anchorEntity = scene.getEntityByID(anchorSession._space.shipID);
  assert(anchorEntity, "expected anchor entity");
  const teleportResult = spaceRuntime.teleportDynamicEntityToPoint(
    TEST_SYSTEM_ID,
    anchorEntity.itemID,
    {
      x: Number(anchorEntity.position.x) + 1_000_000_000,
      y: Number(anchorEntity.position.y),
      z: Number(anchorEntity.position.z),
    },
    {
      broadcast: false,
      direction: anchorEntity.direction || { x: 1, y: 0, z: 0 },
    },
  );
  assert.equal(teleportResult && teleportResult.success, true, "expected anchor teleport to succeed");
  assert.notEqual(
    Number(drifterEntity.bubbleID) || 0,
    Number(anchorEntity.bubbleID) || 0,
    "expected the moved anchor to leave the Drifter guard bubble",
  );

  npcService.wakeNpcController(drifterEntity.itemID, 0);
  const reanchored = advanceSceneUntil(
    scene,
    25_000,
    250,
    () => (
      Number(drifterEntity.bubbleID) > 0 &&
      Number(drifterEntity.bubbleID) === Number(anchorEntity.bubbleID) &&
      Number(drifterEntity.targetEntityID) === anchorSession.shipItem.itemID &&
      String(drifterEntity.mode || "").toUpperCase() === "ORBIT"
    ),
  );
  assert.equal(
    reanchored,
    true,
    "expected the idle Drifter guard hull to warp back onto the moved anchor and resume orbiting it",
  );
});

test("/drifter guard packs prioritize threats sitting on their guarded anchor over slightly closer off-anchor ships", () => {
  const anchorSession = registerAttachedSession(
    createFakeCapsuleSession(
      989285,
      999285,
      999285,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const spawnResult = spawnNativeDrifterPack(
    anchorSession,
    "battleship",
    1,
    {
      operatorKind: "testDrifterGuardDefense",
      skipInitialBehaviorTick: true,
      preferredTargetID: 0,
      spawnDistanceMeters: 20_000,
      formationSpacingMeters: 1_500,
      behaviorOverrides: {
        movementMode: "hold",
        autoAggro: false,
        autoActivateWeapons: false,
        targetPreference: "preferredTargetThenNearestPlayer",
        aggressionRangeMeters: 250_000,
        returnToHomeWhenIdle: false,
        idleAnchorOrbit: true,
        idleAnchorOrbitDistanceMeters: 10_000,
        useChasePropulsion: false,
        drifterBehavior: true,
      },
    },
  );
  assert.equal(spawnResult && spawnResult.success, true, "expected Drifter guard-defense spawn to succeed");

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const drifterEntity = getOperatorEntities("testDrifterGuardDefense")[0];
  assert(drifterEntity, "expected spawned Drifter guard-defense entity");

  npcService.wakeNpcController(drifterEntity.itemID, 0);
  const initiallyGuarding = advanceSceneUntil(
    scene,
    5_000,
    250,
    () => (
      Number(drifterEntity.targetEntityID) === anchorSession.shipItem.itemID &&
      String(drifterEntity.mode || "").toUpperCase() === "ORBIT"
    ),
  );
  assert.equal(
    initiallyGuarding,
    true,
    "expected the Drifter guard-defense hull to begin orbiting its anchor before evaluating nearby threats",
  );

  const anchorEntity = scene.getEntityByID(anchorSession._space.shipID);
  assert(anchorEntity, "expected guard anchor entity");
  const anchorToDrifter = normalizeDirection({
    x: Number(drifterEntity.position.x) - Number(anchorEntity.position.x),
    y: Number(drifterEntity.position.y) - Number(anchorEntity.position.y),
    z: Number(drifterEntity.position.z) - Number(anchorEntity.position.z),
  });

  const offAnchorIntruderPosition = {
    x: Number(anchorEntity.position.x) + (anchorToDrifter.x * 20_000),
    y: Number(anchorEntity.position.y) + (anchorToDrifter.y * 20_000),
    z: Number(anchorEntity.position.z) + (anchorToDrifter.z * 20_000),
  };
  const onAnchorThreatPosition = {
    x: Number(anchorEntity.position.x) - (anchorToDrifter.x * 2_000),
    y: Number(anchorEntity.position.y) - (anchorToDrifter.y * 2_000),
    z: Number(anchorEntity.position.z) - (anchorToDrifter.z * 2_000),
  };

  const offAnchorIntruder = registerAttachedSession(
    createFakeSession(
      989286,
      999286,
      offAnchorIntruderPosition,
    ),
  );
  const onAnchorThreat = registerAttachedSession(
    createFakeSession(
      989287,
      999287,
      onAnchorThreatPosition,
    ),
  );

  const offAnchorEntity = scene.getEntityByID(offAnchorIntruder._space.shipID);
  const onAnchorEntity = scene.getEntityByID(onAnchorThreat._space.shipID);
  assert(offAnchorEntity, "expected off-anchor intruder entity");
  assert(onAnchorEntity, "expected on-anchor threat entity");

  const offAnchorDistanceToDrifter = distanceBetweenPoints(drifterEntity.position, offAnchorEntity.position);
  const onAnchorDistanceToDrifter = distanceBetweenPoints(drifterEntity.position, onAnchorEntity.position);
  const offAnchorDistanceToAnchor = distanceBetweenPoints(anchorEntity.position, offAnchorEntity.position);
  const onAnchorDistanceToAnchor = distanceBetweenPoints(anchorEntity.position, onAnchorEntity.position);
  assert.ok(
    offAnchorDistanceToDrifter < onAnchorDistanceToDrifter,
    "expected the off-anchor ship to be slightly closer to the Drifter by raw distance",
  );
  assert.ok(
    onAnchorDistanceToAnchor < offAnchorDistanceToAnchor,
    "expected the defended-anchor threat to sit materially closer to the guarded anchor",
  );

  const overrideResult = npcService.setBehaviorOverrides(drifterEntity.itemID, {
    movementMode: "hold",
    autoAggro: true,
    autoActivateWeapons: false,
    targetPreference: "preferredTargetThenNearestPlayer",
    aggressionRangeMeters: 250_000,
    returnToHomeWhenIdle: false,
    idleAnchorOrbit: true,
    idleAnchorOrbitDistanceMeters: 10_000,
    useChasePropulsion: false,
    drifterBehavior: true,
  });
  assert.equal(
    overrideResult && overrideResult.success,
    true,
    "expected guard-defense behavior overrides to apply cleanly before target selection",
  );

  npcService.wakeNpcController(drifterEntity.itemID, 0);
  const prioritizedAnchorThreat = advanceSceneUntil(
    scene,
    10_000,
    250,
    () => {
      const controller = npcService.getControllerByEntityID(drifterEntity.itemID);
      return Boolean(
        controller &&
        Number(controller.currentTargetID) === onAnchorThreat.shipItem.itemID,
      );
    },
  );
  assert.equal(
    prioritizedAnchorThreat,
    true,
    "expected the Drifter guard hull to prioritize the threat sitting on its guarded anchor over the slightly closer off-anchor ship",
  );
});

test("/drifter packs use published pursuit warps to bring off-grid members into a live fight", () => {
  const anchorSession = registerAttachedSession(
    createFakeSession(
      989183,
      999183,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );
  const aggressorSession = registerAttachedSession(
    createFakeSession(
      989184,
      999184,
      { x: -107303340000, y: -18744975360, z: 436489052160 },
    ),
  );

  const spawnResult = spawnNativeDrifterPack(
    anchorSession,
    "battleship",
    2,
    {
      operatorKind: "testDrifterPursuit",
      skipInitialBehaviorTick: true,
      preferredTargetID: 0,
      spawnDistanceMeters: 20_000,
      formationSpacingMeters: 1_500,
    },
  );
  assert.equal(spawnResult && spawnResult.success, true, "expected Drifter pursuit pack spawn to succeed");

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const drifterEntities = getOperatorEntities("testDrifterPursuit")
    .slice()
    .sort((left, right) => Number(left.itemID) - Number(right.itemID));
  assert.equal(drifterEntities.length, 2, "expected two spawned Drifter entities");

  const offgridLeader = drifterEntities[0];
  const ongridWingmate = drifterEntities[1];
  const teleportResult = spaceRuntime.teleportDynamicEntityToPoint(
    TEST_SYSTEM_ID,
    offgridLeader.itemID,
    {
      x: Number(offgridLeader.position.x) + 1_000_000_000,
      y: Number(offgridLeader.position.y),
      z: Number(offgridLeader.position.z),
    },
    {
      broadcast: false,
      direction: offgridLeader.direction || { x: 1, y: 0, z: 0 },
    },
  );
  assert.equal(teleportResult && teleportResult.success, true, "expected off-grid leader teleport to succeed");
  assert.notEqual(
    Number(offgridLeader.bubbleID) || 0,
    Number(ongridWingmate.bubbleID) || 0,
    "expected the teleported Drifter leader to begin off-grid",
  );

  const aggressorEntity = scene.getEntityByID(aggressorSession._space.shipID);
  assert(aggressorEntity, "expected aggressor ship entity");
  const aggressionResult = npcService.noteNpcIncomingAggression(
    ongridWingmate,
    aggressorEntity,
    scene.getCurrentSimTimeMs(),
  );
  assert.equal(aggressionResult && aggressionResult.success, true, "expected aggression note to succeed");

  const pursuedIn = advanceSceneUntil(
    scene,
    25_000,
    250,
    () => {
      const leaderController = npcService.getControllerByEntityID(offgridLeader.itemID);
      return (
        Number(offgridLeader.bubbleID) > 0 &&
        Number(offgridLeader.bubbleID) === Number(ongridWingmate.bubbleID) &&
        leaderController &&
        (
          Number(leaderController.currentTargetID) === aggressorSession.shipItem.itemID ||
          scene.getTargetsForEntity(offgridLeader).includes(aggressorSession.shipItem.itemID)
        )
      );
    },
  );
  assert.equal(
    pursuedIn,
    true,
    "expected the off-grid Drifter pack member to warp back into the live fight using the published pursuit location",
  );
});

test("/drifter engaged hunters pursue warped-off prey using pursuit memory", () => {
  const anchorSession = registerAttachedSession(
    createFakeSession(
      989186,
      999186,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );
  const aggressorSession = registerAttachedSession(
    createFakeSession(
      989187,
      999187,
      { x: -107303340000, y: -18744975360, z: 436489052160 },
    ),
  );

  const spawnResult = spawnNativeDrifterPack(
    anchorSession,
    "battleship",
    1,
    {
      operatorKind: "testDrifterHunterPursuit",
      skipInitialBehaviorTick: true,
      preferredTargetID: 0,
      spawnDistanceMeters: 20_000,
      formationSpacingMeters: 1_500,
    },
  );
  assert.equal(spawnResult && spawnResult.success, true, "expected Drifter hunter spawn to succeed");

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const hunterEntity = getOperatorEntities("testDrifterHunterPursuit")[0];
  assert(hunterEntity, "expected spawned Drifter hunter entity");

  const aggressorEntity = scene.getEntityByID(aggressorSession._space.shipID);
  assert(aggressorEntity, "expected aggressor ship entity");
  const aggressionResult = npcService.noteNpcIncomingAggression(
    hunterEntity,
    aggressorEntity,
    scene.getCurrentSimTimeMs(),
  );
  assert.equal(aggressionResult && aggressionResult.success, true, "expected aggression note to succeed");

  const lockedTarget = advanceSceneUntil(
    scene,
    5_000,
    250,
    () => {
      const controller = npcService.getControllerByEntityID(hunterEntity.itemID);
      return Boolean(
        controller &&
        (
          Number(controller.currentTargetID) === aggressorSession.shipItem.itemID ||
          scene.getTargetsForEntity(hunterEntity).includes(aggressorSession.shipItem.itemID)
        )
      );
    },
  );
  assert.equal(lockedTarget, true, "expected the Drifter hunter to engage the prey before it flees");

  const warpResult = scene.warpDynamicEntityToPoint(
    aggressorEntity.itemID,
    {
      x: Number(aggressorEntity.position.x) + 250_000_000,
      y: Number(aggressorEntity.position.y),
      z: Number(aggressorEntity.position.z),
    },
    {
      forceImmediateStart: true,
      direction: aggressorEntity.direction || { x: 1, y: 0, z: 0 },
    },
  );
  assert.equal(warpResult && warpResult.success, true, "expected prey warp to succeed");
  const pursuitDestination = warpResult && warpResult.data && warpResult.data.targetPoint;
  assert(pursuitDestination, "expected prey warp to expose a pursuit destination point");

  const preyEscapedBubble = advanceSceneUntil(
    scene,
    5_000,
    250,
    () => Number(hunterEntity.bubbleID) !== Number(aggressorEntity.bubbleID),
  );
  assert.equal(
    preyEscapedBubble,
    true,
    "expected the prey to leave the hunter bubble through a real warp escape",
  );

  npcService.wakeNpcController(hunterEntity.itemID, 0);
  const reachedPursuitDestination = advanceSceneUntil(
    scene,
    10_000,
    250,
    () => {
      return Boolean(
        hunterEntity.mode !== "WARP" &&
        Number(hunterEntity.bubbleID) > 0 &&
        distanceBetweenPoints(hunterEntity.position, pursuitDestination) <= 10_000
      );
    },
  );
  assert.equal(
    reachedPursuitDestination,
    true,
    "expected the engaged Drifter hunter to land on the prey's warp destination using pursuit memory",
  );

  const reacquiredPrey = advanceSceneUntil(
    scene,
    35_000,
    250,
    () => {
      const controller = npcService.getControllerByEntityID(hunterEntity.itemID);
      return Boolean(
        controller &&
        (
          Number(controller.currentTargetID) === aggressorSession.shipItem.itemID ||
          scene.getTargetsForEntity(hunterEntity).includes(aggressorSession.shipItem.itemID)
        )
      );
    },
  );
  assert.equal(
    reacquiredPrey,
    true,
    "expected the engaged Drifter hunter to reacquire the prey after landing on the pursuit bubble",
  );
});

test("/drifter hunters prefer a returning aggressor over unrelated nearby players after the original entity leaves", () => {
  const anchorSession = registerAttachedSession(
    createFakeSession(
      989177,
      999177,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );
  const aggressorSession = registerAttachedSession(
    createFakeSession(
      989178,
      999178,
      { x: -107303340000, y: -18744975360, z: 436489052160 },
    ),
  );
  const bystanderSession = registerAttachedSession(
    createFakeSession(
      989179,
      999179,
      { x: -107303344000, y: -18744975360, z: 436489052160 },
    ),
  );

  const spawnResult = spawnNativeDrifterPack(
    anchorSession,
    "battleship",
    1,
    {
      operatorKind: "testDrifterOwnerReturn",
      skipInitialBehaviorTick: true,
      preferredTargetID: 0,
      spawnDistanceMeters: 20_000,
      formationSpacingMeters: 1_500,
    },
  );
  assert.equal(spawnResult && spawnResult.success, true, "expected Drifter return-memory spawn to succeed");

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const hunterEntity = getOperatorEntities("testDrifterOwnerReturn")[0];
  assert(hunterEntity, "expected spawned Drifter hunter entity");

  const aggressorEntity = scene.getEntityByID(aggressorSession._space.shipID);
  assert(aggressorEntity, "expected aggressor ship entity");
  const aggressionResult = npcService.noteNpcIncomingAggression(
    hunterEntity,
    aggressorEntity,
    scene.getCurrentSimTimeMs(),
  );
  assert.equal(aggressionResult && aggressionResult.success, true, "expected aggression note to succeed");

  const initiallyTargetedAggressor = advanceSceneUntil(
    scene,
    5_000,
    250,
    () => {
      const controller = npcService.getControllerByEntityID(hunterEntity.itemID);
      return Boolean(
        controller &&
        Number(controller.currentTargetID) === aggressorSession.shipItem.itemID
      );
    },
  );
  assert.equal(
    initiallyTargetedAggressor,
    true,
    "expected the hunter to engage the aggressor before the aggressor leaves",
  );

  spaceRuntime.detachSession(aggressorSession, { broadcast: false });
  sessionRegistry.unregister(aggressorSession);
  npcService.wakeNpcController(hunterEntity.itemID, 0);

  const clearedOriginalAggressor = advanceSceneUntil(
    scene,
    10_000,
    250,
    () => {
      const controller = npcService.getControllerByEntityID(hunterEntity.itemID);
      return Boolean(
        controller &&
        Number(controller.currentTargetID) !== aggressorSession.shipItem.itemID
      );
    },
  );
  assert.equal(
    clearedOriginalAggressor,
    true,
    "expected the hunter to stop treating the vanished aggressor entity as its active target",
  );

  const controllerBeforeReturn = npcService.getControllerByEntityID(hunterEntity.itemID);
  assert(controllerBeforeReturn, "expected Drifter controller before return");
  controllerBeforeReturn.currentTargetID = bystanderSession.shipItem.itemID;
  if (
    !controllerBeforeReturn.drifterCombatState ||
    typeof controllerBeforeReturn.drifterCombatState !== "object"
  ) {
    controllerBeforeReturn.drifterCombatState = {};
  }
  controllerBeforeReturn.drifterCombatState.nextTargetSwitchAtMs = 0;

  const returnerSession = registerAttachedSession(
    createFakeSession(
      989180,
      999178,
      { x: -107303341500, y: -18744975360, z: 436489052160 },
    ),
  );

  npcService.wakeNpcController(hunterEntity.itemID, 0);
  const retargetedReturningAggressor = advanceSceneUntil(
    scene,
    15_000,
    250,
    () => {
      const controller = npcService.getControllerByEntityID(hunterEntity.itemID);
      return Boolean(
        controller &&
        Number(controller.currentTargetID) === returnerSession.shipItem.itemID
      );
    },
  );
  assert.equal(
    retargetedReturningAggressor,
    true,
    "expected the hunter to reclaim the same-owner returning aggressor instead of sticking to the unrelated bystander",
  );
});

test("/drifter target switching waits for the cadence gate and then retargets higher-priority entosis ships", () => {
  const anchorSession = registerAttachedSession(
    createFakeSession(
      989181,
      999181,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );
  const currentTargetSession = registerAttachedSession(
    createFakeSession(
      989182,
      999182,
      { x: -107303350000, y: -18744975360, z: 436489052160 },
    ),
  );
  const entosisTargetSession = registerAttachedSession(
    createFakeSession(
      989183,
      999183,
      { x: -107303330000, y: -18744975360, z: 436489052160 },
    ),
  );

  const spawnResult = spawnNativeDrifterPack(
    anchorSession,
    "battleship",
    1,
    {
      operatorKind: "testDrifterTargetSwitch",
      skipInitialBehaviorTick: true,
      preferredTargetID: 0,
      spawnDistanceMeters: 20_000,
      formationSpacingMeters: 1_500,
    },
  );
  assert.equal(
    spawnResult && spawnResult.success,
    true,
    "expected Drifter target-switch spawn to succeed",
  );

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const drifterEntity = getOperatorEntities("testDrifterTargetSwitch")[0];
  assert(drifterEntity, "expected spawned Drifter entity");

  const controller = npcService.getControllerByEntityID(drifterEntity.itemID);
  assert(controller, "expected Drifter controller");
  controller.drifterCombatState = {
    ...(controller.drifterCombatState || {}),
    nextSuperweaponReadyAtMs: scene.getCurrentSimTimeMs() + 120_000,
  };
  const currentTargetEntity = scene.getEntityByID(currentTargetSession._space.shipID);
  assert(currentTargetEntity, "expected current target entity");
  const aggressionResult = npcService.noteNpcIncomingAggression(
    drifterEntity,
    currentTargetEntity,
    scene.getCurrentSimTimeMs(),
  );
  assert.equal(
    aggressionResult && aggressionResult.success,
    true,
    "expected initial Drifter aggression wake to succeed",
  );
  npcService.wakeNpcController(drifterEntity.itemID, 0);

  const initiallyOnCurrentTarget = advanceSceneUntil(
    scene,
    8_000,
    250,
    () => {
      const refreshedController = npcService.getControllerByEntityID(drifterEntity.itemID);
      return Boolean(
        refreshedController &&
        Number(refreshedController.currentTargetID) === currentTargetSession.shipItem.itemID,
      );
    },
  );
  assert.equal(
    initiallyOnCurrentTarget,
    true,
    "expected the Drifter to start on the closer default target before a higher-priority switch becomes available",
  );

  const refreshedController = npcService.getControllerByEntityID(drifterEntity.itemID);
  assert(refreshedController, "expected refreshed Drifter controller");
  refreshedController.preferredTargetID = 0;
  refreshedController.drifterCombatState = {
    ...(refreshedController.drifterCombatState || {}),
    nextSuperweaponReadyAtMs: scene.getCurrentSimTimeMs() + 120_000,
    nextTargetSwitchAtMs: scene.getCurrentSimTimeMs() + 3_000,
  };

  const entosisEntity = scene.getEntityByID(entosisTargetSession._space.shipID);
  assert(entosisEntity, "expected entosis target entity");
  entosisEntity.activeModuleEffects = new Map([
    [
      990183001,
      {
        moduleID: 990183001,
        effectName: "entosisLink",
      },
    ],
  ]);
  npcService.wakeNpcController(drifterEntity.itemID, 0);

  const switchedTooEarly = advanceSceneUntil(
    scene,
    2_000,
    250,
    () => {
      const activeController = npcService.getControllerByEntityID(drifterEntity.itemID);
      return Boolean(
        activeController &&
        Number(activeController.currentTargetID) === entosisTargetSession.shipItem.itemID,
      );
    },
  );
  assert.equal(
    switchedTooEarly,
    false,
    "expected the Drifter to respect the active target-switch cadence gate before retargeting",
  );

  const switchedAfterGate = advanceSceneUntil(
    scene,
    10_000,
    250,
    () => {
      const activeController = npcService.getControllerByEntityID(drifterEntity.itemID);
      if (!activeController) {
        return false;
      }
      if (Number(activeController.currentTargetID) !== entosisTargetSession.shipItem.itemID) {
        return false;
      }
      const activeEffects = drifterEntity.activeModuleEffects instanceof Map
        ? [...drifterEntity.activeModuleEffects.values()]
        : [];
      const hasRetargetedCombatEffect = activeEffects.some((effectState) => (
        Number(effectState && effectState.targetID || 0) === entosisTargetSession.shipItem.itemID &&
        (
          String(effectState && effectState.effectName || "").trim().toLowerCase() === "targetattack" ||
          String(effectState && effectState.effectName || "").trim().toLowerCase() === "warpscrambleforentity"
        )
      ));
      const stillHittingOldTarget = activeEffects.some((effectState) => (
        Number(effectState && effectState.targetID || 0) === currentTargetSession.shipItem.itemID &&
        (
          String(effectState && effectState.effectName || "").trim().toLowerCase() === "targetattack" ||
          String(effectState && effectState.effectName || "").trim().toLowerCase() === "warpscrambleforentity"
        )
      ));
      return hasRetargetedCombatEffect && !stillHittingOldTarget;
    },
  );
  assert.equal(
    switchedAfterGate,
    true,
    "expected the Drifter to retarget the higher-priority entosis ship once the cadence gate expired and clear live combat effects off the old target",
  );
});

test("/drifter superweapon readiness scrams the target, stops normal weapons, and full-stops before TurboLaser", () => {
  const anchorSession = registerAttachedSession(
    createFakeSession(
      989184,
      999184,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );
  const victimSession = registerAttachedSession(
    createFakeSession(
      989185,
      999185,
      { x: -107303340000, y: -18744975360, z: 436489052160 },
    ),
  );

  const spawnResult = spawnNativeDrifterPack(
    anchorSession,
    "battleship",
    1,
    {
      operatorKind: "testDrifterShotPrep",
      skipInitialBehaviorTick: true,
      preferredTargetID: 0,
      spawnDistanceMeters: 20_000,
      formationSpacingMeters: 1_500,
    },
  );
  assert.equal(
    spawnResult && spawnResult.success,
    true,
    "expected Drifter superweapon-prep spawn to succeed",
  );

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const drifterEntity = getOperatorEntities("testDrifterShotPrep")[0];
  assert(drifterEntity, "expected spawned Drifter entity");

  const victimEntity = scene.getEntityByID(victimSession._space.shipID);
  assert(victimEntity, "expected victim ship entity");

  const controller = npcService.getControllerByEntityID(drifterEntity.itemID);
  assert(controller, "expected Drifter controller");
  controller.drifterCombatState = {
    ...(controller.drifterCombatState || {}),
    nextSuperweaponReadyAtMs: scene.getCurrentSimTimeMs() + 120_000,
  };

  const aggressionResult = npcService.noteNpcIncomingAggression(
    drifterEntity,
    victimEntity,
    scene.getCurrentSimTimeMs(),
  );
  assert.equal(
    aggressionResult && aggressionResult.success,
    true,
    "expected Drifter aggression wake to succeed",
  );

  const standardWeaponsActive = advanceSceneUntil(
    scene,
    10_000,
    250,
    () => {
      const activeEffects = drifterEntity.activeModuleEffects instanceof Map
        ? [...drifterEntity.activeModuleEffects.values()]
        : [];
      return activeEffects.some((effectState) => (
        String(effectState && effectState.effectName || "").trim().toLowerCase() === "targetattack" &&
        Number(effectState && effectState.targetID || 0) === victimSession.shipItem.itemID
      ));
    },
  );
  assert.equal(
    standardWeaponsActive,
    true,
    "expected the Drifter to begin with its normal weapon lane before the superweapon-prep sequence starts",
  );

  controller.drifterCombatState = {
    ...(controller.drifterCombatState || {}),
    nextSuperweaponReadyAtMs: scene.getCurrentSimTimeMs(),
  };
  npcService.wakeNpcController(drifterEntity.itemID, 0);

  const enteredShotPrep = advanceSceneUntil(
    scene,
    10_000,
    250,
    () => {
      const activeEffects = drifterEntity.activeModuleEffects instanceof Map
        ? [...drifterEntity.activeModuleEffects.values()]
        : [];
      const hasSuperweapon = activeEffects.some((effectState) => (
        effectState &&
        effectState.superweaponEffect === true &&
        String(effectState.guid || "").trim() === "effects.TurboLaser"
      ));
      const hasScramble = activeEffects.some((effectState) => (
        String(effectState && effectState.effectName || "").trim().toLowerCase() === "warpscrambleforentity" &&
        Number(effectState && effectState.targetID || 0) === victimSession.shipItem.itemID
      ));
      const hasStandardWeapons = activeEffects.some((effectState) => (
        String(effectState && effectState.effectName || "").trim().toLowerCase() === "targetattack"
      ));
      return (
        hasSuperweapon &&
        hasScramble &&
        !hasStandardWeapons &&
        String(drifterEntity.mode || "").trim().toUpperCase() === "STOP"
      );
    },
  );
  assert.equal(
    enteredShotPrep,
    true,
    "expected the Drifter shot-prep sequence to hold the target under scramble, stop normal weapons, and full-stop before TurboLaser lands",
  );
});

test("/drifter transient native hulls can dematerialize and rematerialize from stored definition snapshots without losing live combat memory", () => {
  const anchorSession = registerAttachedSession(
    createFakeSession(
      989190,
      999190,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const spawnResult = spawnNativeDrifterPack(
    anchorSession,
    "battleship",
    1,
    {
      operatorKind: "testDrifterSnapshotRemat",
      skipInitialBehaviorTick: true,
      preferredTargetID: 0,
      spawnDistanceMeters: 20_000,
      formationSpacingMeters: 1_500,
    },
  );
  assert.equal(spawnResult && spawnResult.success, true, "expected Drifter snapshot-remat spawn to succeed");

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const drifterEntity = getOperatorEntities("testDrifterSnapshotRemat")[0];
  assert(drifterEntity, "expected spawned Drifter entity");

  const controller = npcService.getControllerByEntityID(drifterEntity.itemID);
  assert(controller, "expected spawned Drifter controller");

  controller.preferredTargetOwnerID = anchorSession.characterID;
  controller.lastAggressorID = anchorSession.shipItem.itemID;
  controller.lastAggressorOwnerID = anchorSession.characterID;
  controller.lastAggressedAtMs = scene.getCurrentSimTimeMs();
  controller.drifterCombatState = {
    ...(controller.drifterCombatState || {}),
    lastPursuitPostedAtMs: scene.getCurrentSimTimeMs(),
    lastPursuitPosition: {
      x: Number(drifterEntity.position.x) + 50_000,
      y: Number(drifterEntity.position.y),
      z: Number(drifterEntity.position.z),
    },
    pendingPoddingOwnerID: anchorSession.characterID,
  };

  const dematerializeResult = nativeNpcService.dematerializeNativeController(controller, {
    persistState: true,
    broadcast: false,
  });
  assert.equal(
    dematerializeResult && dematerializeResult.success,
    true,
    "expected Drifter dematerialization to succeed",
  );
  assert.equal(
    scene.getEntityByID(drifterEntity.itemID),
    null,
    "expected runtime entity to be removed after dematerialization",
  );
  assert.equal(
    npcService.getControllerByEntityID(drifterEntity.itemID),
    null,
    "expected runtime controller to be removed after dematerialization",
  );

  const rematerializeResult = nativeNpcService.materializeStoredNativeController(
    scene,
    drifterEntity.itemID,
    { broadcast: false },
  );
  assert.equal(
    rematerializeResult && rematerializeResult.success,
    true,
    "expected stored Drifter controller to rematerialize from its definition snapshot",
  );
  assert(
    rematerializeResult &&
      rematerializeResult.data &&
      rematerializeResult.data.entity,
    "expected rematerialization to restore the Drifter entity",
  );
  assert(
    rematerializeResult &&
      rematerializeResult.data &&
      rematerializeResult.data.controller,
    "expected rematerialization to restore the Drifter controller",
  );

  const rematerializedController = rematerializeResult.data.controller;
  assert.equal(
    Number(rematerializedController.preferredTargetOwnerID),
    anchorSession.characterID,
    "expected preferred-target owner memory to survive rematerialization",
  );
  assert.equal(
    Number(rematerializedController.lastAggressorID),
    anchorSession.shipItem.itemID,
    "expected last-aggressor entity memory to survive rematerialization",
  );
  assert.equal(
    Number(rematerializedController.lastAggressorOwnerID),
    anchorSession.characterID,
    "expected last-aggressor owner memory to survive rematerialization",
  );
  assert.equal(
    Number(
      rematerializedController.drifterCombatState &&
        rematerializedController.drifterCombatState.pendingPoddingOwnerID,
    ),
    anchorSession.characterID,
    "expected Drifter podding intent memory to survive rematerialization",
  );
  assert.deepEqual(
    rematerializedController.drifterCombatState &&
      rematerializedController.drifterCombatState.lastPursuitPosition,
    controller.drifterCombatState.lastPursuitPosition,
    "expected Drifter pursuit-location memory to survive rematerialization",
  );
});

test("/trigspawn renewing hulls can repair damaged allies through native assistance modules", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      989181,
      999181,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const spawnResult = executeChatCommand(
    pilotSession,
    "/trigspawn 2 renewing rodiva",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(spawnResult.handled, true);

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const entities = getOperatorEntities("trigspawn");
  assert.equal(entities.length, 2, "expected /trigspawn renewing rodiva to materialize two NPCs");

  const supportEntity = entities[0];
  const damagedEntity = entities[1];
  const assistanceEntry = npcEquipment.getNpcAssistanceModules(supportEntity)[0];
  assert(assistanceEntry, "expected Renewing hulls to expose native assistance modules");

  damagedEntity.conditionState = {
    ...(damagedEntity.conditionState || {}),
    shieldCharge: 1,
    armorDamage: 0.5,
    damage: 0,
  };

  const pseudoSession = {
    characterID: 0,
    corporationID: supportEntity.corporationID,
    allianceID: supportEntity.allianceID,
    _space: {
      systemID: supportEntity.systemID,
      shipID: supportEntity.itemID,
    },
  };
  const lockResult = scene.finalizeTargetLock(supportEntity, damagedEntity, {
    nowMs: scene.getCurrentSimTimeMs(),
  });
  assert.equal(lockResult && lockResult.success, true, "expected friendly support lock to succeed");

  const activationResult = scene.activateGenericModule(
    pseudoSession,
    assistanceEntry.moduleItem,
    assistanceEntry.effectName || null,
    {
      targetID: damagedEntity.itemID,
    },
  );
  assert.equal(
    activationResult && activationResult.success,
    true,
    "expected Renewing assistance activation to succeed on a locked damaged ally",
  );
  assert.equal(
    activationResult &&
      activationResult.data &&
      activationResult.data.effectState &&
      activationResult.data.effectState.assistanceModuleEffect,
    true,
    "expected the live assistance runtime to create a real assistance effect state",
  );

  const repaired = advanceSceneUntil(
    scene,
    2_000,
    250,
    () => Number(damagedEntity.conditionState && damagedEntity.conditionState.armorDamage) < 0.5,
  );
  assert.equal(
    repaired,
    true,
    "expected a Renewing hull to repair its damaged ally through the native assistance lane",
  );
});

test("/trigspawn renewing hulls autonomously repair damaged allies while engaging a live hostile target", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      989186,
      999186,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const spawnResult = executeChatCommand(
    pilotSession,
    "/trigspawn 2 renewing rodiva",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(spawnResult.handled, true);

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const entities = getOperatorEntities("trigspawn");
  assert.equal(entities.length, 2, "expected /trigspawn renewing rodiva to materialize two NPCs");

  const damagedEntity = entities[0];
  damagedEntity.conditionState = {
    ...(damagedEntity.conditionState || {}),
    shieldCharge: 1,
    armorDamage: 0.5,
    damage: 0,
  };

  const autonomouslyRepaired = advanceSceneUntil(
    scene,
    8_000,
    250,
    () => {
      const allAggroed = entities.every((entity) => {
        const controller = npcService.getControllerByEntityID(entity.itemID);
        return controller && Number(controller.currentTargetID) === pilotSession.shipItem.itemID;
      });
      const supportLatched = entities.some((entity) => {
        if (entity.itemID === damagedEntity.itemID) {
          return false;
        }
        const activeEffects = entity.activeModuleEffects instanceof Map
          ? [...entity.activeModuleEffects.values()]
          : [];
        return activeEffects.some((effectState) => (
          effectState &&
          effectState.assistanceModuleEffect === true &&
          Number(effectState.targetID) === damagedEntity.itemID
        ));
      });
      return (
        allAggroed &&
        supportLatched &&
        Number(damagedEntity.conditionState && damagedEntity.conditionState.armorDamage) < 0.5
      );
    },
  );
  assert.equal(
    autonomouslyRepaired,
    true,
    "expected Renewing hulls to keep pressure on the hostile target while autonomously repairing their ally",
  );
});

test("/trigspawn blinding hulls apply real sensor dampening to live targeting stats", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      989188,
      999188,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const spawnResult = executeChatCommand(
    pilotSession,
    "/trigspawn 1 blinding damavik",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(spawnResult.handled, true);

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const blindingEntity = getOperatorEntities("trigspawn")[0];
  assert(blindingEntity, "expected /trigspawn blinding entity");

  const targetEntity = scene.getEntityByID(pilotSession._space.shipID);
  assert(targetEntity, "expected player ship entity");
  const baselineRange = Number(targetEntity.maxTargetRange) || 0;
  const baselineScanResolution = Number(targetEntity.scanResolution) || 0;
  assert.ok(baselineRange > 0, "expected the target ship to have baseline targeting range");
  assert.ok(baselineScanResolution > 0, "expected the target ship to have baseline scan resolution");

  const lockResult = scene.finalizeTargetLock(blindingEntity, targetEntity, {
    nowMs: scene.getCurrentSimTimeMs(),
  });
  assert.equal(lockResult && lockResult.success, true, "expected blinding hull to lock the target");

  const sensorDampEntry = npcEquipment.getNpcHostileModules(blindingEntity).find((entry) => (
    entry &&
    entry.definition &&
    entry.definition.family === "sensorDampener"
  ));
  assert(sensorDampEntry, "expected Blinding hull to expose a native sensor-dampening module");

  const pseudoSession = {
    characterID: 0,
    corporationID: blindingEntity.corporationID,
    allianceID: blindingEntity.allianceID,
    _space: {
      systemID: blindingEntity.systemID,
      shipID: blindingEntity.itemID,
    },
  };
  const activationResult = scene.activateGenericModule(
    pseudoSession,
    sensorDampEntry.moduleItem,
    sensorDampEntry.effectName || null,
    {
      targetID: targetEntity.itemID,
    },
  );
  assert.equal(
    activationResult && activationResult.success,
    true,
    "expected Blinding hostile activation to succeed",
  );

  const dampApplied = advanceSceneUntil(
    scene,
    1_000,
    100,
    () => (
      Number(targetEntity.maxTargetRange) < baselineRange &&
      Number(targetEntity.scanResolution) < baselineScanResolution
    ),
  );
  assert.equal(
    dampApplied,
    true,
    "expected Blinding dampening to reduce max target range and scan resolution",
  );

  scene.deactivateGenericModule(pseudoSession, sensorDampEntry.moduleItem.itemID, {
    reason: "npc",
    deferUntilCycle: false,
  });
  const dampCleared = advanceSceneUntil(
    scene,
    1_000,
    100,
    () => (
      Math.abs((Number(targetEntity.maxTargetRange) || 0) - baselineRange) < 0.0001 &&
      Math.abs((Number(targetEntity.scanResolution) || 0) - baselineScanResolution) < 0.0001
    ),
  );
  assert.equal(
    dampCleared,
    true,
    "expected targeting stats to recover once the Blinding dampener is removed",
  );
});

test("/trigspawn harrowing hulls apply real target painting to live signature radius", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      989189,
      999189,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const spawnResult = executeChatCommand(
    pilotSession,
    "/trigspawn 1 harrowing damavik",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(spawnResult.handled, true);

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const harrowingEntity = getOperatorEntities("trigspawn")[0];
  assert(harrowingEntity, "expected /trigspawn harrowing entity");

  const targetEntity = scene.getEntityByID(pilotSession._space.shipID);
  assert(targetEntity, "expected player ship entity");
  const baselineSignatureRadius = Number(targetEntity.signatureRadius) || 0;
  assert.ok(
    baselineSignatureRadius > 0,
    "expected the target ship to have a baseline signature radius",
  );

  const lockResult = scene.finalizeTargetLock(harrowingEntity, targetEntity, {
    nowMs: scene.getCurrentSimTimeMs(),
  });
  assert.equal(lockResult && lockResult.success, true, "expected harrowing hull to lock the target");

  const paintEntry = npcEquipment.getNpcHostileModules(harrowingEntity).find((entry) => (
    entry &&
    entry.definition &&
    entry.definition.family === "targetPainter"
  ));
  assert(paintEntry, "expected Harrowing hull to expose a native target-painter module");

  const pseudoSession = {
    characterID: 0,
    corporationID: harrowingEntity.corporationID,
    allianceID: harrowingEntity.allianceID,
    _space: {
      systemID: harrowingEntity.systemID,
      shipID: harrowingEntity.itemID,
    },
  };
  const activationResult = scene.activateGenericModule(
    pseudoSession,
    paintEntry.moduleItem,
    paintEntry.effectName || null,
    {
      targetID: targetEntity.itemID,
    },
  );
  assert.equal(
    activationResult && activationResult.success,
    true,
    "expected Harrowing hostile activation to succeed",
  );

  const paintApplied = advanceSceneUntil(
    scene,
    1_000,
    100,
    () => Number(targetEntity.signatureRadius) > baselineSignatureRadius,
  );
  assert.equal(
    paintApplied,
    true,
    "expected Harrowing target painting to increase live signature radius",
  );

  scene.deactivateGenericModule(pseudoSession, paintEntry.moduleItem.itemID, {
    reason: "npc",
    deferUntilCycle: false,
  });
  const paintCleared = advanceSceneUntil(
    scene,
    1_000,
    100,
    () => Math.abs((Number(targetEntity.signatureRadius) || 0) - baselineSignatureRadius) < 0.0001,
  );
  assert.equal(
    paintCleared,
    true,
    "expected signature radius to recover once the Harrowing painter is removed",
  );
});

test("/trigspawn ghosting hulls apply real tracking and guidance disruption to outgoing weapon snapshots", () => {
  const pilotSession = registerAttachedSession(
    createFakeSession(
      989191,
      999191,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const spawnResult = executeChatCommand(
    pilotSession,
    "/trigspawn 1 ghosting kikimora",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(spawnResult.handled, true);

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const ghostingEntity = getOperatorEntities("trigspawn")[0];
  assert(ghostingEntity, "expected /trigspawn ghosting entity");

  const targetEntity = scene.getEntityByID(pilotSession._space.shipID);
  assert(targetEntity, "expected player ship entity");

  const lockResult = scene.finalizeTargetLock(ghostingEntity, targetEntity, {
    nowMs: scene.getCurrentSimTimeMs(),
  });
  assert.equal(lockResult && lockResult.success, true, "expected ghosting hull to lock the target");

  const hostileEntries = npcEquipment.getNpcHostileModules(ghostingEntity);
  assert.ok(
    hostileEntries.some((entry) => entry && entry.definition && entry.definition.family === "trackingDisruptor"),
    "expected Ghosting hull to expose a tracking disruption module",
  );
  assert.ok(
    hostileEntries.some((entry) => entry && entry.definition && entry.definition.family === "guidanceDisruptor"),
    "expected Ghosting hull to expose a guidance disruption module",
  );

  const pseudoSession = {
    characterID: 0,
    corporationID: ghostingEntity.corporationID,
    allianceID: ghostingEntity.allianceID,
    _space: {
      systemID: ghostingEntity.systemID,
      shipID: ghostingEntity.itemID,
    },
  };

  for (const hostileEntry of hostileEntries) {
    const activationResult = scene.activateGenericModule(
      pseudoSession,
      hostileEntry.moduleItem,
      hostileEntry.effectName || null,
      {
        targetID: targetEntity.itemID,
      },
    );
    assert.equal(
      activationResult && activationResult.success,
      true,
      `expected Ghosting hostile activation for ${hostileEntry.effectName} to succeed`,
    );
  }

  const modifiersApplied = advanceSceneUntil(
    scene,
    1_000,
    100,
    () => {
      const modifiers = hostileModuleRuntime.collectWeaponModifierEntriesForTarget(targetEntity);
      return modifiers.moduleEntries.length > 0 && modifiers.chargeEntries.length > 0;
    },
  );
  assert.equal(
    modifiersApplied,
    true,
    "expected Ghosting disruption to materialize weapon-snapshot modifier entries on the target",
  );

  const weaponModifiers = hostileModuleRuntime.collectWeaponModifierEntriesForTarget(targetEntity);

  const turretModule = {
    itemID: 990191001,
    locationID: pilotSession.shipItem.itemID,
    typeID: 3082,
    groupID: 74,
    categoryID: 7,
    flagID: 27,
    singleton: 1,
    quantity: 1,
    moduleState: { online: true, isOnline: true },
  };
  const turretCharge = {
    itemID: 990191002,
    locationID: turretModule.itemID,
    typeID: 230,
    groupID: 85,
    categoryID: 8,
    quantity: 100,
    stacksize: 100,
    singleton: 0,
  };
  const missileModule = {
    itemID: 990191003,
    locationID: pilotSession.shipItem.itemID,
    typeID: 2410,
    groupID: 510,
    categoryID: 7,
    flagID: 28,
    singleton: 1,
    quantity: 1,
    moduleState: { online: true, isOnline: true },
  };
  const missileCharge = {
    itemID: 990191004,
    locationID: missileModule.itemID,
    typeID: 209,
    groupID: 385,
    categoryID: 8,
    quantity: 100,
    stacksize: 100,
    singleton: 0,
  };

  const baselineTurretSnapshot = buildWeaponModuleSnapshot({
    characterID: pilotSession.characterID,
    shipItem: pilotSession.shipItem,
    moduleItem: turretModule,
    chargeItem: turretCharge,
    fittedItems: [turretModule],
    skillMap: new Map(),
    activeModuleContexts: [],
  });
  const disruptedTurretSnapshot = buildWeaponModuleSnapshot({
    characterID: pilotSession.characterID,
    shipItem: pilotSession.shipItem,
    moduleItem: turretModule,
    chargeItem: turretCharge,
    fittedItems: [turretModule],
    skillMap: new Map(),
    activeModuleContexts: [],
    directModuleModifierEntries: weaponModifiers.moduleEntries,
    directChargeModifierEntries: weaponModifiers.chargeEntries,
  });
  assert(baselineTurretSnapshot, "expected baseline turret snapshot");
  assert(disruptedTurretSnapshot, "expected disrupted turret snapshot");
  assert.ok(
    disruptedTurretSnapshot.trackingSpeed < baselineTurretSnapshot.trackingSpeed,
    "expected Ghosting tracking disruption to reduce turret tracking speed",
  );

  const baselineMissileSnapshot = buildWeaponModuleSnapshot({
    characterID: pilotSession.characterID,
    shipItem: pilotSession.shipItem,
    moduleItem: missileModule,
    chargeItem: missileCharge,
    fittedItems: [missileModule],
    skillMap: new Map(),
    activeModuleContexts: [],
  });
  const disruptedMissileSnapshot = buildWeaponModuleSnapshot({
    characterID: pilotSession.characterID,
    shipItem: pilotSession.shipItem,
    moduleItem: missileModule,
    chargeItem: missileCharge,
    fittedItems: [missileModule],
    skillMap: new Map(),
    activeModuleContexts: [],
    directModuleModifierEntries: weaponModifiers.moduleEntries,
    directChargeModifierEntries: weaponModifiers.chargeEntries,
  });
  assert(baselineMissileSnapshot, "expected baseline missile snapshot");
  assert(disruptedMissileSnapshot, "expected disrupted missile snapshot");
  assert.ok(
    disruptedMissileSnapshot.maxVelocity < baselineMissileSnapshot.maxVelocity,
    "expected Ghosting guidance disruption to reduce missile velocity",
  );
  assert.ok(
    disruptedMissileSnapshot.explosionVelocity < baselineMissileSnapshot.explosionVelocity,
    "expected Ghosting guidance disruption to reduce missile explosion velocity",
  );
  assert.ok(
    disruptedMissileSnapshot.explosionRadius > baselineMissileSnapshot.explosionRadius,
    "expected Ghosting guidance disruption to increase missile explosion radius",
  );
});
