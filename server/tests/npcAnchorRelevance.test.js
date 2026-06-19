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
  NPC_COMBAT_DORMANCY_RECENT_AGGRESSION_GRACE_MS,
} = require(path.join(repoRoot, "server/src/space/npc/npcCombatDormancy"));
const {
  syncRelevantStartupControllersForScene,
} = require(path.join(repoRoot, "server/src/space/npc/npcAnchorRelevance"));

const AMBIENT_SYSTEM_ID = 30000142;
const AMBIENT_STARTUP_RULE_ID = "jita_concord_gate_checkpoint_startup";
const COMBAT_SYSTEM_ID = 30000001;
const COMBAT_STARTUP_RULE_ID = "tanoo_blood_gate_ambush_startup";
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

function createFakeSession(systemID, clientID, characterID, position) {
  return {
    clientID,
    characterID,
    charID: characterID,
    characterName: `char-${characterID}`,
    shipName: `ship-${characterID}`,
    corporationID: 1,
    allianceID: 0,
    warFactionID: 0,
    solarsystemid: systemID,
    solarsystemid2: systemID,
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

function attachReadySession(systemID, session) {
  registeredSessions.push(session);
  runtime.attachSession(session, session.shipItem, {
    systemID,
    broadcast: false,
    spawnStopped: true,
  });
  assert.equal(runtime.ensureInitialBallpark(session), true);
  return session;
}

function cleanupRuleRows(systemID, startupRuleID) {
  for (const controller of nativeNpcStore.listNativeControllersForSystem(systemID)) {
    if (String(controller && controller.startupRuleID || "").trim() !== startupRuleID) {
      continue;
    }
    try {
      runtime.removeDynamicEntity(systemID, controller.entityID, {
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

function resetTestState() {
  for (const session of registeredSessions.splice(0)) {
    try {
      runtime.detachSession(session, { broadcast: false });
    } catch (error) {
      // Best-effort cleanup for tests.
    }
  }
  runtime._testing.clearScenes();
  clearControllers();
  cleanupRuleRows(AMBIENT_SYSTEM_ID, AMBIENT_STARTUP_RULE_ID);
  cleanupRuleRows(COMBAT_SYSTEM_ID, COMBAT_STARTUP_RULE_ID);
  if (originalNpcControlState) {
    writeTableSnapshot("npcControlState", originalNpcControlState);
  }
  if (originalConfig) {
    config.npcAuthoredStartupEnabled = originalConfig.npcAuthoredStartupEnabled;
    config.npcDefaultConcordStartupEnabled = originalConfig.npcDefaultConcordStartupEnabled;
    config.npcDefaultConcordStationScreensEnabled = originalConfig.npcDefaultConcordStationScreensEnabled;
  }
}

function getDistinctGateAnchors(scene) {
  const stargates = worldData.getStargatesForSystem(scene.systemID)
    .map((gate) => scene.getEntityByID(gate.itemID))
    .filter(Boolean);
  const seenClusters = new Set();
  const distinctAnchors = [];
  for (const gate of stargates) {
    const clusterKey = scene.getPublicGridClusterKeyForEntity(gate);
    if (!clusterKey || seenClusters.has(clusterKey)) {
      continue;
    }
    seenClusters.add(clusterKey);
    distinctAnchors.push(gate);
  }
  return distinctAnchors;
}

function buildAnchorPosition(anchorEntity) {
  return {
    x: Number(anchorEntity.position.x || 0) + 1_000,
    y: Number(anchorEntity.position.y || 0),
    z: Number(anchorEntity.position.z || 0) + 1_000,
  };
}

function listLiveStartupSummaries(systemID, startupRuleID) {
  return npcService.getNpcOperatorSummary()
    .filter((summary) => (
      Number(summary && summary.systemID || 0) === Number(systemID) &&
      String(summary && summary.startupRuleID || "").trim() === startupRuleID
    ));
}

function moveSessionShipToAnchor(scene, session, anchorEntity) {
  const shipEntity = scene.getShipEntityForSession(session);
  assert(shipEntity, "expected ship entity for session");
  const position = buildAnchorPosition(anchorEntity);
  shipEntity.position = cloneValue(position);
  shipEntity.targetPoint = cloneValue(position);
  shipEntity.velocity = { x: 0, y: 0, z: 0 };
  shipEntity.mode = "STOP";
  shipEntity.speedFraction = 0;
  session.shipItem.spaceState.position = cloneValue(position);
  scene.reconcileEntityPublicGrid(shipEntity);
  scene.reconcileEntityBubble(shipEntity);
  scene.ensurePublicGridComposition();
  return shipEntity;
}

function detachSessionAndTick(session) {
  runtime.detachSession(session, { broadcast: false });
  runtime.tick();
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
  resetTestState();
});

test("anchor relevance wakes only the player-visible passive CONCORD gate cluster", () => {
  config.npcAuthoredStartupEnabled = true;
  config.npcDefaultConcordStartupEnabled = false;
  config.npcDefaultConcordStationScreensEnabled = false;
  assert.equal(setStartupRuleEnabledOverride(AMBIENT_STARTUP_RULE_ID, true).success, true);

  const scene = runtime.ensureScene(AMBIENT_SYSTEM_ID);
  assert(scene, "expected ambient startup test scene");
  const [gateA, gateB] = getDistinctGateAnchors(scene);
  assert(gateA && gateB, "expected at least two distinct gate clusters");

  const session = attachReadySession(
    AMBIENT_SYSTEM_ID,
    createFakeSession(
      AMBIENT_SYSTEM_ID,
      986001,
      996001,
      buildAnchorPosition(gateA),
    ),
  );

  let liveSummaries = listLiveStartupSummaries(AMBIENT_SYSTEM_ID, AMBIENT_STARTUP_RULE_ID);
  const gateAClusterKey = scene.getPublicGridClusterKeyForEntity(gateA);
  const gateBClusterKey = scene.getPublicGridClusterKeyForEntity(gateB);
  assert.notEqual(gateAClusterKey, gateBClusterKey, "expected distinct public-grid clusters");
  assert(liveSummaries.length > 0, "expected passive CONCORD to materialize on first relevant gate");
  assert(
    liveSummaries.every((summary) => (
      scene.getPublicGridClusterKeyForEntity(scene.getEntityByID(summary.anchorID)) === gateAClusterKey
    )),
    "first attach should only materialize startup CONCORD anchored in the session-visible gate cluster",
  );
  assert.equal(
    liveSummaries.some((summary) => Number(summary.anchorID) === Number(gateB.itemID)),
    false,
    "off-cluster passive CONCORD should stay virtualized",
  );

  moveSessionShipToAnchor(scene, session, gateB);
  runtime.tick();

  liveSummaries = listLiveStartupSummaries(AMBIENT_SYSTEM_ID, AMBIENT_STARTUP_RULE_ID);
  assert(liveSummaries.length > 0, "expected passive CONCORD to remain present after moving clusters");
  assert(
    liveSummaries.every((summary) => (
      scene.getPublicGridClusterKeyForEntity(scene.getEntityByID(summary.anchorID)) === gateBClusterKey
    )),
    "hot-scene anchor relevance should dematerialize the old passive gate cluster and materialize the new one",
  );
  assert.equal(
    liveSummaries.some((summary) => Number(summary.anchorID) === Number(gateA.itemID)),
    false,
    "old passive gate cluster should dematerialize once the player leaves it",
  );
});

test("player warp pre-wakes the passive CONCORD destination cluster before departure", () => {
  config.npcAuthoredStartupEnabled = true;
  config.npcDefaultConcordStartupEnabled = false;
  config.npcDefaultConcordStationScreensEnabled = false;
  assert.equal(setStartupRuleEnabledOverride(AMBIENT_STARTUP_RULE_ID, true).success, true);

  const scene = runtime.ensureScene(AMBIENT_SYSTEM_ID);
  assert(scene, "expected ambient startup test scene");
  const [gateA, gateB] = getDistinctGateAnchors(scene);
  assert(gateA && gateB, "expected at least two distinct gate clusters");

  const session = attachReadySession(
    AMBIENT_SYSTEM_ID,
    createFakeSession(
      AMBIENT_SYSTEM_ID,
      986011,
      996011,
      buildAnchorPosition(gateA),
    ),
  );

  let liveSummaries = listLiveStartupSummaries(AMBIENT_SYSTEM_ID, AMBIENT_STARTUP_RULE_ID);
  assert(
    liveSummaries.some((summary) => Number(summary.anchorID) === Number(gateA.itemID)),
    "expected the source passive CONCORD gate cluster to be live before warp",
  );
  assert.equal(
    liveSummaries.some((summary) => Number(summary.anchorID) === Number(gateB.itemID)),
    false,
    "destination passive CONCORD gate cluster should stay virtualized before warp request",
  );

  const warpResult = scene.warpToEntity(session, gateB.itemID);
  assert.equal(warpResult.success, true, "expected same-system warp request to succeed");

  liveSummaries = listLiveStartupSummaries(AMBIENT_SYSTEM_ID, AMBIENT_STARTUP_RULE_ID);
  assert(
    liveSummaries.some((summary) => Number(summary.anchorID) === Number(gateA.itemID)),
    "source passive CONCORD gate cluster should stay live until the player actually leaves it",
  );
  assert(
    liveSummaries.some((summary) => Number(summary.anchorID) === Number(gateB.itemID)),
    "warp start should pre-wake the passive CONCORD destination gate cluster before departure",
  );
});

test("multiple sessions on different passive CONCORD clusters keep both clusters live until the last relevant session leaves", () => {
  config.npcAuthoredStartupEnabled = true;
  config.npcDefaultConcordStartupEnabled = false;
  config.npcDefaultConcordStationScreensEnabled = false;
  assert.equal(setStartupRuleEnabledOverride(AMBIENT_STARTUP_RULE_ID, true).success, true);

  const scene = runtime.ensureScene(AMBIENT_SYSTEM_ID);
  assert(scene, "expected ambient startup test scene");
  const [gateA, gateB] = getDistinctGateAnchors(scene);
  assert(gateA && gateB, "expected at least two distinct gate clusters");

  const sessionA = attachReadySession(
    AMBIENT_SYSTEM_ID,
    createFakeSession(
      AMBIENT_SYSTEM_ID,
      986021,
      996021,
      buildAnchorPosition(gateA),
    ),
  );
  const sessionB = attachReadySession(
    AMBIENT_SYSTEM_ID,
    createFakeSession(
      AMBIENT_SYSTEM_ID,
      986022,
      996022,
      buildAnchorPosition(gateB),
    ),
  );

  let liveSummaries = listLiveStartupSummaries(AMBIENT_SYSTEM_ID, AMBIENT_STARTUP_RULE_ID);
  assert(
    liveSummaries.some((summary) => Number(summary.anchorID) === Number(gateA.itemID)),
    "expected gate A passive CONCORD cluster to stay live with a relevant session present",
  );
  assert(
    liveSummaries.some((summary) => Number(summary.anchorID) === Number(gateB.itemID)),
    "expected gate B passive CONCORD cluster to stay live with a relevant session present",
  );

  detachSessionAndTick(sessionA);

  liveSummaries = listLiveStartupSummaries(AMBIENT_SYSTEM_ID, AMBIENT_STARTUP_RULE_ID);
  assert.equal(
    liveSummaries.some((summary) => Number(summary.anchorID) === Number(gateA.itemID)),
    false,
    "gate A passive CONCORD cluster should dematerialize once its last relevant session leaves",
  );
  assert(
    liveSummaries.some((summary) => Number(summary.anchorID) === Number(gateB.itemID)),
    "gate B passive CONCORD cluster should remain live while its session stays on-cluster",
  );

  detachSessionAndTick(sessionB);

  liveSummaries = listLiveStartupSummaries(AMBIENT_SYSTEM_ID, AMBIENT_STARTUP_RULE_ID);
  assert.equal(
    liveSummaries.length,
    0,
    "all passive CONCORD startup clusters should dematerialize once the scene is no longer relevant to any session",
  );
});

test("anchor relevance keeps active off-cluster startup combat live until it cools down", () => {
  config.npcAuthoredStartupEnabled = true;
  config.npcDefaultConcordStartupEnabled = false;
  config.npcDefaultConcordStationScreensEnabled = false;
  assert.equal(setStartupRuleEnabledOverride(COMBAT_STARTUP_RULE_ID, true).success, true);

  const scene = runtime.ensureScene(COMBAT_SYSTEM_ID);
  assert(scene, "expected combat startup test scene");
  const [gateA, gateB] = getDistinctGateAnchors(scene);
  assert(gateA && gateB, "expected at least two distinct gate clusters");

  const session = attachReadySession(
    COMBAT_SYSTEM_ID,
    createFakeSession(
      COMBAT_SYSTEM_ID,
      986101,
      996101,
      buildAnchorPosition(gateA),
    ),
  );

  let liveSummaries = listLiveStartupSummaries(COMBAT_SYSTEM_ID, COMBAT_STARTUP_RULE_ID);
  assert(liveSummaries.length > 0, "expected startup combat rats to materialize on the first gate cluster");
  assert.equal(
    liveSummaries.some((summary) => Number(summary.anchorID) === Number(gateB.itemID)),
    false,
    "off-cluster startup combat should stay virtualized before the player moves there",
  );

  const activeSummary = liveSummaries.find(
    (summary) => Number(summary.anchorID) === Number(gateA.itemID),
  );
  assert(activeSummary, "expected a live startup combat rat on the first gate");
  const activeController = npcService.getControllerByEntityID(activeSummary.entityID);
  const activeEntity = scene.getEntityByID(activeSummary.entityID);
  assert(activeController, "expected active combat controller");
  assert(activeEntity, "expected active combat entity");

  activeController.currentTargetID = session.shipItem.itemID;
  activeController.lastAggressedAtMs = scene.getCurrentSimTimeMs();
  activeEntity.activeModuleEffects.set(activeEntity.itemID, {
    moduleID: activeEntity.itemID,
    effectName: "targetAttack",
  });

  moveSessionShipToAnchor(scene, session, gateB);
  runtime.tick();

  liveSummaries = listLiveStartupSummaries(COMBAT_SYSTEM_ID, COMBAT_STARTUP_RULE_ID);
  assert(
    liveSummaries.some((summary) => Number(summary.anchorID) === Number(gateA.itemID)),
    "active off-cluster startup combat must stay live until the fight cools down",
  );
  assert(
    liveSummaries.some((summary) => Number(summary.anchorID) === Number(gateB.itemID)),
    "moving to a new gate cluster should still materialize the newly relevant startup combat",
  );

  activeEntity.activeModuleEffects.clear();
  activeController.currentTargetID = 0;
  activeController.lastAggressedAtMs =
    scene.getCurrentSimTimeMs() - NPC_COMBAT_DORMANCY_RECENT_AGGRESSION_GRACE_MS - 1;
  activeController.returningHome = false;
  activeEntity.mode = "STOP";
  activeEntity.speedFraction = 0;
  activeEntity.velocity = { x: 0, y: 0, z: 0 };
  activeEntity.targetEntityID = 0;
  activeEntity.position = cloneValue(activeController.homePosition);
  activeEntity.targetPoint = cloneValue(activeController.homePosition);

  runtime.tick();

  liveSummaries = listLiveStartupSummaries(COMBAT_SYSTEM_ID, COMBAT_STARTUP_RULE_ID);
  assert.equal(
    liveSummaries.some((summary) => Number(summary.anchorID) === Number(gateA.itemID)),
    false,
    "once off-cluster combat cools down, dormant startup combat should dematerialize",
  );
  assert(
    liveSummaries.some((summary) => Number(summary.anchorID) === Number(gateB.itemID)),
    "the currently relevant gate cluster should remain materialized",
  );
});

test("multiple sessions on different startup combat clusters keep both clusters live until the last relevant session leaves", () => {
  config.npcAuthoredStartupEnabled = true;
  config.npcDefaultConcordStartupEnabled = false;
  config.npcDefaultConcordStationScreensEnabled = false;
  assert.equal(setStartupRuleEnabledOverride(COMBAT_STARTUP_RULE_ID, true).success, true);

  const scene = runtime.ensureScene(COMBAT_SYSTEM_ID);
  assert(scene, "expected combat startup test scene");
  const [gateA, gateB] = getDistinctGateAnchors(scene);
  assert(gateA && gateB, "expected at least two distinct gate clusters");

  const sessionA = attachReadySession(
    COMBAT_SYSTEM_ID,
    createFakeSession(
      COMBAT_SYSTEM_ID,
      986121,
      996121,
      buildAnchorPosition(gateA),
    ),
  );
  const sessionB = attachReadySession(
    COMBAT_SYSTEM_ID,
    createFakeSession(
      COMBAT_SYSTEM_ID,
      986122,
      996122,
      buildAnchorPosition(gateB),
    ),
  );

  let liveSummaries = listLiveStartupSummaries(COMBAT_SYSTEM_ID, COMBAT_STARTUP_RULE_ID);
  assert(
    liveSummaries.some((summary) => Number(summary.anchorID) === Number(gateA.itemID)),
    "expected gate A startup combat cluster to stay live with a relevant session present",
  );
  assert(
    liveSummaries.some((summary) => Number(summary.anchorID) === Number(gateB.itemID)),
    "expected gate B startup combat cluster to stay live with a relevant session present",
  );

  detachSessionAndTick(sessionA);

  liveSummaries = listLiveStartupSummaries(COMBAT_SYSTEM_ID, COMBAT_STARTUP_RULE_ID);
  assert.equal(
    liveSummaries.some((summary) => Number(summary.anchorID) === Number(gateA.itemID)),
    false,
    "gate A dormant startup combat should dematerialize once its last relevant session leaves",
  );
  assert(
    liveSummaries.some((summary) => Number(summary.anchorID) === Number(gateB.itemID)),
    "gate B startup combat should remain live while its session stays on-cluster",
  );

  detachSessionAndTick(sessionB);

  liveSummaries = listLiveStartupSummaries(COMBAT_SYSTEM_ID, COMBAT_STARTUP_RULE_ID);
  assert.equal(
    liveSummaries.length,
    0,
    "all dormant startup combat clusters should dematerialize once the scene is no longer relevant to any session",
  );
});

test("player warp pre-wakes the dormant startup combat destination cluster before departure", () => {
  config.npcAuthoredStartupEnabled = true;
  config.npcDefaultConcordStartupEnabled = false;
  config.npcDefaultConcordStationScreensEnabled = false;
  assert.equal(setStartupRuleEnabledOverride(COMBAT_STARTUP_RULE_ID, true).success, true);

  const scene = runtime.ensureScene(COMBAT_SYSTEM_ID);
  assert(scene, "expected combat startup test scene");
  const [gateA, gateB] = getDistinctGateAnchors(scene);
  assert(gateA && gateB, "expected at least two distinct gate clusters");

  const session = attachReadySession(
    COMBAT_SYSTEM_ID,
    createFakeSession(
      COMBAT_SYSTEM_ID,
      986111,
      996111,
      buildAnchorPosition(gateA),
    ),
  );

  let liveSummaries = listLiveStartupSummaries(COMBAT_SYSTEM_ID, COMBAT_STARTUP_RULE_ID);
  assert(
    liveSummaries.some((summary) => Number(summary.anchorID) === Number(gateA.itemID)),
    "expected the source startup combat gate cluster to be live before warp",
  );
  assert.equal(
    liveSummaries.some((summary) => Number(summary.anchorID) === Number(gateB.itemID)),
    false,
    "destination startup combat gate cluster should stay virtualized before warp request",
  );

  const warpResult = scene.warpToEntity(session, gateB.itemID);
  assert.equal(warpResult.success, true, "expected same-system warp request to succeed");

  liveSummaries = listLiveStartupSummaries(COMBAT_SYSTEM_ID, COMBAT_STARTUP_RULE_ID);
  assert(
    liveSummaries.some((summary) => Number(summary.anchorID) === Number(gateA.itemID)),
    "source startup combat gate cluster should stay live until the player actually leaves it",
  );
  assert(
    liveSummaries.some((summary) => Number(summary.anchorID) === Number(gateB.itemID)),
    "warp start should pre-wake the dormant startup combat destination gate cluster before departure",
  );
});

test("stopping a preparing warp collapses the pre-warmed passive CONCORD destination cluster back to the source cluster", () => {
  config.npcAuthoredStartupEnabled = true;
  config.npcDefaultConcordStartupEnabled = false;
  config.npcDefaultConcordStationScreensEnabled = false;
  assert.equal(setStartupRuleEnabledOverride(AMBIENT_STARTUP_RULE_ID, true).success, true);

  const scene = runtime.ensureScene(AMBIENT_SYSTEM_ID);
  assert(scene, "expected ambient startup test scene");
  const [gateA, gateB] = getDistinctGateAnchors(scene);
  assert(gateA && gateB, "expected at least two distinct gate clusters");

  const session = attachReadySession(
    AMBIENT_SYSTEM_ID,
    createFakeSession(
      AMBIENT_SYSTEM_ID,
      986031,
      996031,
      buildAnchorPosition(gateA),
    ),
  );

  const warpResult = scene.warpToEntity(session, gateB.itemID);
  assert.equal(warpResult.success, true, "expected same-system warp request to succeed");

  let liveSummaries = listLiveStartupSummaries(AMBIENT_SYSTEM_ID, AMBIENT_STARTUP_RULE_ID);
  assert(
    liveSummaries.some((summary) => Number(summary.anchorID) === Number(gateB.itemID)),
    "expected passive CONCORD destination cluster to be pre-warmed while the warp is preparing",
  );

  assert.equal(runtime.stop(session), true, "expected stop to cancel the preparing warp");
  runtime.tick();

  liveSummaries = listLiveStartupSummaries(AMBIENT_SYSTEM_ID, AMBIENT_STARTUP_RULE_ID);
  assert(
    liveSummaries.some((summary) => Number(summary.anchorID) === Number(gateA.itemID)),
    "source passive CONCORD cluster should remain live after cancelling the warp",
  );
  assert.equal(
    liveSummaries.some((summary) => Number(summary.anchorID) === Number(gateB.itemID)),
    false,
    "pre-warmed passive CONCORD destination cluster should collapse once the preparing warp is cancelled",
  );
});

test("anchor relevance prunes invalid transient startup controllers instead of failing every tick", () => {
  config.npcAuthoredStartupEnabled = true;
  config.npcDefaultConcordStartupEnabled = false;
  config.npcDefaultConcordStationScreensEnabled = false;
  assert.equal(setStartupRuleEnabledOverride(AMBIENT_STARTUP_RULE_ID, true).success, true);

  const scene = runtime.ensureScene(AMBIENT_SYSTEM_ID);
  assert(scene, "expected ambient startup test scene");

  const storedControllers = nativeNpcStore.listNativeControllersForSystem(AMBIENT_SYSTEM_ID)
    .filter((controller) => String(controller && controller.startupRuleID || "").trim() === AMBIENT_STARTUP_RULE_ID);
  assert(storedControllers.length > 0, "expected cold startup controllers in the transient native store");

  const brokenController = storedControllers[0];
  const writeResult = nativeNpcStore.upsertNativeController(
    {
      ...brokenController,
      profileID: "missing_profile_for_anchor_relevance_test",
    },
    {
      transient: true,
    },
  );
  assert.equal(writeResult.success, true, "expected transient controller corruption write to succeed");

  const anchorEntity = scene.getEntityByID(Number(brokenController.anchorID) || 0);
  assert(anchorEntity, "expected startup controller anchor to resolve in the scene");

  const clusterKey = scene.getPublicGridClusterKeyForEntity(anchorEntity);
  assert(clusterKey, "expected startup controller anchor to resolve to a public-grid cluster");

  const syncResult = syncRelevantStartupControllersForScene(scene, {
    includeSceneSessions: false,
    relevantClusterKeys: [clusterKey],
    catchUpBehavior: false,
  });
  assert.equal(
    syncResult.success,
    true,
    "expected anchor relevance sync to prune invalid transient startup controllers instead of failing",
  );
  assert.equal(
    nativeNpcStore.getNativeController(brokenController.entityID),
    null,
    "expected broken transient startup controller row to be removed from the native store",
  );
  assert.equal(
    nativeNpcStore.getNativeEntity(brokenController.entityID),
    null,
    "expected broken transient startup entity row to be removed from the native store",
  );
});
