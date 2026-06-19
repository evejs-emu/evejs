const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const {
  buildStartupPresenceSummary,
  getSceneActivityState,
} = require(path.join(
  repoRoot,
  "server/src/space/npc/npcSceneActivity",
));
const {
  clearControllers,
  registerController,
} = require(path.join(
  repoRoot,
  "server/src/space/npc/npcRegistry",
));
const runtime = require(path.join(
  repoRoot,
  "server/src/space/runtime",
));

const TEST_SYSTEM_ID = 30000142;

function buildFakeScene(overrides = {}) {
  const scene = {
    systemID: TEST_SYSTEM_ID,
    sessions: new Map(),
    dynamicEntities: new Map(),
    staticEntities: [],
    lastWallclockTickAt: 1_000,
    simTimeMs: 1_000,
    destroyExpiredCalls: [],
    tickCalls: [],
    destroyExpiredInventoryBackedEntities(now) {
      this.destroyExpiredCalls.push(now);
      return [];
    },
    syncStructureEntitiesFromState() {
      return [];
    },
    peekSimTimeForWallclock(wallclockNow) {
      return this.simTimeMs + Math.max(0, Number(wallclockNow) - this.lastWallclockTickAt);
    },
    tick(wallclockNow) {
      this.tickCalls.push(wallclockNow);
      this.simTimeMs = this.peekSimTimeForWallclock(wallclockNow);
      this.lastWallclockTickAt = wallclockNow;
    },
    ...overrides,
  };
  return scene;
}

test.afterEach(() => {
  runtime._testing.clearScenes();
  clearControllers();
  delete process.env.EVEJS_DISABLE_NPC_COLD_SCENE_SLEEP;
});

test("scene activity stays cold when no sessions or deadlines are present", () => {
  const scene = buildFakeScene();
  const state = getSceneActivityState(scene, 6_000);

  assert.equal(state.shouldTick, false);
  assert.equal(state.sleepReason, "cold-no-deadline");
  assert.equal(state.nextDeadlineMs, null);
});

test("scene activity wakes when a non-ambient NPC controller is due", () => {
  const scene = buildFakeScene();
  registerController({
    entityID: 9001,
    systemID: TEST_SYSTEM_ID,
    runtimeKind: "nativeCombat",
    nextThinkAtMs: 0,
  });

  const state = getSceneActivityState(scene, 6_000);
  assert.equal(state.shouldTick, true);
  assert.equal(state.sleepReason, "deadline-due");
});

test("scene activity respects the internal cold-scene-sleep benchmark override", () => {
  process.env.EVEJS_DISABLE_NPC_COLD_SCENE_SLEEP = "1";
  const scene = buildFakeScene();

  const state = getSceneActivityState(scene, 6_000);
  assert.equal(state.shouldTick, true);
  assert.equal(state.sleepReason, "cold-scene-sleep-disabled");
});

test("startup presence summary counts concord and rat startup controllers separately", () => {
  registerController({
    entityID: 101,
    systemID: TEST_SYSTEM_ID,
    runtimeKind: "nativeAmbient",
    entityType: "concord",
    startupRuleID: "startup_concord",
    anchorKind: "stargate",
    anchorID: 5001,
  });
  registerController({
    entityID: 102,
    systemID: TEST_SYSTEM_ID,
    runtimeKind: "nativeAmbient",
    entityType: "concord",
    startupRuleID: "startup_concord",
    anchorKind: "station",
    anchorID: 7001,
  });
  registerController({
    entityID: 201,
    systemID: TEST_SYSTEM_ID,
    runtimeKind: "nativeCombat",
    entityType: "npc",
    startupRuleID: "startup_rats",
    anchorKind: "stargate",
    anchorID: 5002,
  });

  const summary = buildStartupPresenceSummary([TEST_SYSTEM_ID]);
  assert.equal(summary.totalStartupShips, 3);
  assert.equal(summary.startupSystemsWithPresence, 1);
  assert.equal(summary.concord.ships, 2);
  assert.equal(summary.concord.anchors, 2);
  assert.equal(summary.concord.stargateAnchors, 1);
  assert.equal(summary.npc.ships, 1);
  assert.equal(summary.npc.anchors, 1);
  assert.equal(summary.npc.stargateAnchors, 1);
});

test("runtime tick skips cold scenes but still wakes scenes with due NPC work", () => {
  const coldScene = buildFakeScene({ systemID: TEST_SYSTEM_ID });
  const hotScene = buildFakeScene({ systemID: TEST_SYSTEM_ID + 1 });
  runtime.scenes.set(TEST_SYSTEM_ID, coldScene);
  runtime.scenes.set(TEST_SYSTEM_ID + 1, hotScene);
  registerController({
    entityID: 3001,
    systemID: TEST_SYSTEM_ID + 1,
    runtimeKind: "nativeCombat",
    nextThinkAtMs: 0,
  });

  const summary = runtime.tick();

  assert.equal(coldScene.tickCalls.length, 0);
  assert.equal(hotScene.tickCalls.length, 1);
  assert.equal(summary.tickedSceneCount, 1);
});

test("wakeSceneForImmediateUse catches up a cold scene before it is reused", () => {
  const coldScene = buildFakeScene({ systemID: TEST_SYSTEM_ID });
  runtime.scenes.set(TEST_SYSTEM_ID, coldScene);

  const wakeResult = runtime._testing.wakeSceneForImmediateUseForTesting(TEST_SYSTEM_ID, {
    wallclockNowMs: 7_500,
    reason: "test-wake",
  });

  assert.equal(wakeResult.success, true);
  assert.equal(wakeResult.data.ticked, true);
  assert.equal(coldScene.tickCalls.length, 1);
  assert.equal(coldScene.lastWallclockTickAt, 7_500);
});
