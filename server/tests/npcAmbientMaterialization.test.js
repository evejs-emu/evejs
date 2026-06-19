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
const {
  clearControllers,
} = require(path.join(repoRoot, "server/src/space/npc/npcRegistry"));
const {
  setStartupRuleEnabledOverride,
} = require(path.join(repoRoot, "server/src/space/npc/npcControlState"));
const {
  buildStartupPresenceSummary,
} = require(path.join(repoRoot, "server/src/space/npc/npcSceneActivity"));

const TEST_SYSTEM_ID = 30000142;
const STARTUP_RULE_ID = "jita_concord_gate_checkpoint_startup";
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

function buildGateSessionPosition(scene) {
  assert(scene, "expected scene for gate-session position");
  const firstGate = scene.staticEntities.find((entity) => entity && entity.kind === "stargate");
  assert(firstGate, "expected a gate in the ambient startup test system");
  return {
    x: Number(firstGate.position && firstGate.position.x || 0) + 1_000,
    y: Number(firstGate.position && firstGate.position.y || 0),
    z: Number(firstGate.position && firstGate.position.z || 0) + 1_000,
  };
}

function createFakeSession(clientID, characterID, position) {
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
      nativeNpcStore.removeNativeEntityCascade(controller.entityID);
    } catch (error) {
      // Best-effort cleanup for tests.
    }
  }
}

function resetAmbientTestState() {
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

function configureAuthoredAmbientStartup() {
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
  resetAmbientTestState();
});

test("cold scene create keeps passive startup CONCORD virtualized", () => {
  configureAuthoredAmbientStartup();

  const scene = runtime.ensureScene(TEST_SYSTEM_ID);
  assert(scene, "expected cold startup scene");

  const coldStoreControllers = listRuleControllersFromStore();
  assert(
    coldStoreControllers.length > 0,
    "expected passive startup CONCORD rows to exist in the transient native store",
  );
  assert.deepStrictEqual(
    listRuleControllersFromRuntime(),
    [],
    "cold scene create should not register live passive startup CONCORD controllers",
  );

  const summary = buildStartupPresenceSummary([TEST_SYSTEM_ID]);
  assert.equal(summary.concord.ships > 0, true);
  assert.equal(summary.concord.liveShips, 0);
  assert.equal(summary.concord.virtualizedShips, coldStoreControllers.length);
});

test("attach-session wake materializes passive startup CONCORD before visibility", () => {
  configureAuthoredAmbientStartup();

  runtime.ensureScene(TEST_SYSTEM_ID);
  assert.deepStrictEqual(listRuleControllersFromRuntime(), []);

  const session = attachReadySession(
    createFakeSession(984001, 994001, buildGateSessionPosition(runtime.ensureScene(TEST_SYSTEM_ID))),
  );
  const scene = runtime.getSceneForSession(session);
  const runtimeControllers = listRuleControllersFromRuntime();
  assert(
    runtimeControllers.length > 0,
    "attach-session wake should materialize passive startup CONCORD before the player finishes ballpark bootstrap",
  );
  assert(
    runtimeControllers.every((summary) => scene.getEntityByID(summary.entityID)),
    "materialized startup CONCORD should exist as real scene entities once the first player enters",
  );
});

test("last-session detach dematerializes pristine passive startup CONCORD back to descriptors", () => {
  configureAuthoredAmbientStartup();

  const session = attachReadySession(
    createFakeSession(984101, 994101, buildGateSessionPosition(runtime.ensureScene(TEST_SYSTEM_ID))),
  );
  const scene = runtime.getSceneForSession(session);
  assert(scene, "expected scene for detach test");
  assert.equal(listRuleControllersFromRuntime().length > 0, true);

  runtime.detachSession(session, { broadcast: false });

  assert.deepStrictEqual(
    listRuleControllersFromRuntime(),
    [],
    "last-session detach should remove live passive startup CONCORD controllers from the cold scene",
  );
  assert.equal(
    listRuleControllersFromStore().length > 0,
    true,
    "dematerialized passive startup CONCORD should still exist as transient native rows",
  );
  assert.equal(
    scene.getDynamicEntities().some((entity) => entity && entity.npcEntityType === "concord"),
    false,
    "cold scene should no longer hold live passive CONCORD ships after dematerialization",
  );
});
