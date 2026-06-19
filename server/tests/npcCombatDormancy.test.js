const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

delete process.env.EVEJS_SKIP_NPC_STARTUP;

const repoRoot = path.join(__dirname, "..", "..");
const config = require(path.join(repoRoot, "server/src/config"));
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const runtime = require(path.join(repoRoot, "server/src/space/runtime"));
const npcService = require(path.join(repoRoot, "server/src/space/npc"));
const nativeNpcStore = require(path.join(repoRoot, "server/src/space/npc/nativeNpcStore"));
const worldData = require(path.join(repoRoot, "server/src/space/worldData"));
const {
  clearControllers,
} = require(path.join(repoRoot, "server/src/space/npc/npcRegistry"));
const {
  setStartupRuleEnabledOverride,
} = require(path.join(repoRoot, "server/src/space/npc/npcControlState"));
const {
  buildStartupPresenceSummary,
} = require(path.join(repoRoot, "server/src/space/npc/npcSceneActivity"));
const {
  NPC_COMBAT_DORMANCY_RECENT_AGGRESSION_GRACE_MS,
} = require(path.join(repoRoot, "server/src/space/npc/npcCombatDormancy"));

const TEST_SYSTEM_ID = 30000001;
const STARTUP_RULE_ID = "tanoo_blood_gate_ambush_startup";
const registeredSessions = [];
let originalNpcControlState = null;
let originalConfig = null;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function readTableSnapshot(table) {
  const result = database.read(table, "/");
  if (!result.success || result.data === null || result.data === undefined) {
    return {};
  }
  return cloneValue(result.data);
}

function writeTableSnapshot(table, snapshot) {
  const writeResult = database.write(table, "/", cloneValue(snapshot));
  assert.equal(
    writeResult.success,
    true,
    `Failed to restore table ${table}: ${(writeResult && writeResult.errorMsg) || "WRITE_ERROR"}`,
  );
}

function buildFarSessionPosition() {
  const firstGate = worldData.getStargatesForSystem(TEST_SYSTEM_ID)[0];
  assert(firstGate, "expected a gate in the combat dormancy test system");
  return {
    x: Number(firstGate.x || 0) + 10_000_000,
    y: Number(firstGate.y || 0),
    z: Number(firstGate.z || 0) + 10_000_000,
  };
}

function buildGateSessionPosition(scene) {
  assert(scene, "expected scene for gate-session position");
  const firstGate = scene.staticEntities.find((entity) => entity && entity.kind === "stargate");
  assert(firstGate, "expected a gate in the combat dormancy test system");
  return {
    x: Number(firstGate.position && firstGate.position.x || 0) + 1_000,
    y: Number(firstGate.position && firstGate.position.y || 0),
    z: Number(firstGate.position && firstGate.position.z || 0) + 1_000,
  };
}

function createFakeSession(clientID, characterID, position = buildFarSessionPosition()) {
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
    notifications: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
    shipItem: {
      itemID: clientID + 100000,
      typeID: 606,
      ownerID: characterID,
      groupID: 25,
      categoryID: 6,
      radius: 50,
      spaceState: {
        position: cloneValue(position),
        velocity: { x: 0, y: 0, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
        mode: "STOP",
        speedFraction: 0,
      },
    },
  };
}

function attachReadySession(session) {
  registeredSessions.push(session);
  runtime.attachSession(session, session.shipItem, {
    systemID: TEST_SYSTEM_ID,
    broadcast: false,
    spawnStopped: true,
  });
  assert.equal(runtime.ensureInitialBallpark(session), true);
  return session;
}

function listRuleControllersFromStore() {
  return nativeNpcStore.listNativeControllersForSystem(TEST_SYSTEM_ID)
    .filter((controller) => String(controller && controller.startupRuleID || "").trim() === STARTUP_RULE_ID);
}

function listRuleControllersFromRuntime() {
  return npcService.getNpcOperatorSummary()
    .filter((summary) => String(summary && summary.startupRuleID || "").trim() === STARTUP_RULE_ID);
}

function cleanupRuleRows() {
  for (const controller of listRuleControllersFromStore()) {
    try {
      runtime.removeDynamicEntity(TEST_SYSTEM_ID, controller.entityID, {
        allowSessionOwned: true,
      });
    } catch (error) {
      // Best-effort cleanup for tests.
    }
    try {
      nativeNpcStore.removeNativeEntityCascade(controller.entityID);
    } catch (error) {
      // Best-effort cleanup for tests.
    }
  }
}

function resetCombatDormancyState() {
  for (const session of registeredSessions.splice(0)) {
    try {
      runtime.detachSession(session, { broadcast: false });
    } catch (error) {
      // Best-effort cleanup for tests.
    }
  }
  runtime._testing.clearScenes();
  clearControllers();
  cleanupRuleRows();
  if (originalNpcControlState) {
    writeTableSnapshot("npcControlState", originalNpcControlState);
  }
  if (originalConfig) {
    config.npcAuthoredStartupEnabled = originalConfig.npcAuthoredStartupEnabled;
    config.npcDefaultConcordStartupEnabled = originalConfig.npcDefaultConcordStartupEnabled;
    config.npcDefaultConcordStationScreensEnabled = originalConfig.npcDefaultConcordStationScreensEnabled;
  }
}

function configureAuthoredCombatStartup() {
  config.npcAuthoredStartupEnabled = true;
  config.npcDefaultConcordStartupEnabled = false;
  config.npcDefaultConcordStationScreensEnabled = false;
  const overrideResult = setStartupRuleEnabledOverride(STARTUP_RULE_ID, true);
  assert.equal(overrideResult.success, true);
}

test.before(() => {
  originalNpcControlState = readTableSnapshot("npcControlState");
  originalConfig = {
    npcAuthoredStartupEnabled: config.npcAuthoredStartupEnabled,
    npcDefaultConcordStartupEnabled: config.npcDefaultConcordStartupEnabled,
    npcDefaultConcordStationScreensEnabled: config.npcDefaultConcordStationScreensEnabled,
  };
});

test.afterEach(() => {
  resetCombatDormancyState();
});

test("cold scene create keeps startup combat rats virtualized", () => {
  configureAuthoredCombatStartup();

  const scene = runtime.ensureScene(TEST_SYSTEM_ID);
  assert(scene, "expected cold pirate startup scene");

  const coldStoreControllers = listRuleControllersFromStore();
  assert(
    coldStoreControllers.length > 0,
    "expected startup combat rat rows to exist in the transient native store",
  );
  assert.deepStrictEqual(
    listRuleControllersFromRuntime(),
    [],
    "cold scene create should not register live startup combat rat controllers",
  );

  const summary = buildStartupPresenceSummary([TEST_SYSTEM_ID]);
  assert.equal(summary.npc.ships > 0, true);
  assert.equal(summary.npc.liveShips, 0);
  assert.equal(summary.npc.virtualizedShips, coldStoreControllers.length);
});

test("attach-session wake materializes startup combat rats before visibility", () => {
  configureAuthoredCombatStartup();

  runtime.ensureScene(TEST_SYSTEM_ID);
  assert.deepStrictEqual(listRuleControllersFromRuntime(), []);

  const session = attachReadySession(
    createFakeSession(985001, 995001, buildGateSessionPosition(runtime.ensureScene(TEST_SYSTEM_ID))),
  );
  const scene = runtime.getSceneForSession(session);
  const runtimeControllers = listRuleControllersFromRuntime();
  assert(
    runtimeControllers.length > 0,
    "attach-session wake should materialize startup combat rats before the player finishes bootstrap",
  );
  assert(
    runtimeControllers.every((summary) => scene.getEntityByID(summary.entityID)),
    "materialized startup combat rats should exist as real scene entities once the first player enters",
  );
});

test("last-session detach dematerializes quiescent startup combat rats back to descriptors", () => {
  configureAuthoredCombatStartup();

  const session = attachReadySession(
    createFakeSession(985101, 995101, buildGateSessionPosition(runtime.ensureScene(TEST_SYSTEM_ID))),
  );
  const scene = runtime.getSceneForSession(session);
  assert(scene, "expected scene for detach test");
  assert.equal(listRuleControllersFromRuntime().length > 0, true);

  runtime.detachSession(session, { broadcast: false });

  assert.deepStrictEqual(
    listRuleControllersFromRuntime(),
    [],
    "last-session detach should remove live startup combat rat controllers from the cold scene",
  );
  assert.equal(
    listRuleControllersFromStore().length > 0,
    true,
    "dematerialized startup combat rats should still exist as transient native rows",
  );
  assert.equal(
    scene.getDynamicEntities().some((entity) => entity && entity.npcEntityType === "npc"),
    false,
    "cold scene should no longer hold live combat rat ships after dematerialization",
  );
});

test("active combat startup rats stay live until the fight cools down", () => {
  configureAuthoredCombatStartup();

  const session = attachReadySession(
    createFakeSession(985201, 995201, buildGateSessionPosition(runtime.ensureScene(TEST_SYSTEM_ID))),
  );
  const scene = runtime.getSceneForSession(session);
  const liveSummary = listRuleControllersFromRuntime()[0];
  assert(liveSummary, "expected a live startup combat rat");
  const controller = npcService.getControllerByEntityID(liveSummary.entityID);
  const entity = scene.getEntityByID(liveSummary.entityID);
  assert(controller, "expected live controller");
  assert(entity, "expected live entity");

  controller.currentTargetID = session.shipItem.itemID;
  controller.lastAggressedAtMs = scene.getCurrentSimTimeMs();
  entity.activeModuleEffects.set(980000000001, {
    moduleID: 980000000001,
    effectName: "targetAttack",
  });

  runtime.detachSession(session, { broadcast: false });

  assert.equal(
    listRuleControllersFromRuntime().length > 0,
    true,
    "active combat startup rats should stay materialized when the last session leaves",
  );
  assert.equal(
    scene.getEntityByID(liveSummary.entityID) !== null,
    true,
    "active combat startup rat entity should remain live after the last session leaves",
  );

  entity.activeModuleEffects.clear();
  controller.currentTargetID = 0;
  controller.lastAggressedAtMs =
    scene.getCurrentSimTimeMs() - NPC_COMBAT_DORMANCY_RECENT_AGGRESSION_GRACE_MS - 1;
  controller.returningHome = false;
  controller.nextThinkAtMs = 0;
  entity.mode = "STOP";
  entity.speedFraction = 0;
  entity.velocity = { x: 0, y: 0, z: 0 };
  entity.targetEntityID = 0;

  runtime.tick();

  assert.deepStrictEqual(
    listRuleControllersFromRuntime(),
    [],
    "once combat cools down, the cold-scene runtime tick should dematerialize the startup rats",
  );
  assert.equal(
    listRuleControllersFromStore().length > 0,
    true,
    "post-combat dormancy should keep the startup rat descriptors in the transient store",
  );
});
