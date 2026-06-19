const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const repoRoot = path.join(__dirname, "..", "..");
const config = require(path.join(repoRoot, "server/src/config"));
const runtime = require(path.join(repoRoot, "server/src/space/runtime"));
const nativeNpcService = require(path.join(
  repoRoot,
  "server/src/space/npc/nativeNpcService",
));
const {
  buildNpcDefinition,
  getNpcSpawnGroup,
  listNpcStartupRules,
} = require(path.join(repoRoot, "server/src/space/npc/npcData"));
const {
  buildSpawnStateForDefinition,
} = require(path.join(repoRoot, "server/src/space/npc/npcAnchors"));
const {
  EVERMORE_CUSTOMS_MAJOR_PROFILE_ID,
  EVERMORE_CUSTOMS_MAJOR_TYPE_ID,
  EVERMORE_CUSTOMS_OFFICIAL_PROFILE_ID,
  EVERMORE_CUSTOMS_OFFICIAL_TYPE_ID,
  EVERMORE_CUSTOMS_SPAWN_GROUP_ID,
  EVERMORE_GATE_STARTUP_RULE_PREFIX,
  JITA_SOLAR_SYSTEM_ID,
  getEverMoreGateCustomsExpectedCount,
  getEverMoreGateCustomsLayout,
} = require(path.join(
  repoRoot,
  "server/src/space/empireGatePresence/everMoreGatePresence",
));

test("Jita gate startup replaces generic CONCORD with exact EverMore customs", { concurrency: false }, (t) => {
  const originalStartupEnabled = config.npcDefaultConcordStartupEnabled;
  const originalEverMoreEnabled = config.npcDefaultEverMoreGatePresenceEnabled;
  t.after(() => {
    config.npcDefaultConcordStartupEnabled = originalStartupEnabled;
    config.npcDefaultEverMoreGatePresenceEnabled = originalEverMoreEnabled;
  });

  config.npcDefaultConcordStartupEnabled = true;
  config.npcDefaultEverMoreGatePresenceEnabled = true;

  const rules = listNpcStartupRules();
  const everMoreRuleID = `${EVERMORE_GATE_STARTUP_RULE_PREFIX}${JITA_SOLAR_SYSTEM_ID}`;
  const everMoreRule = rules.find((rule) => rule.startupRuleID === everMoreRuleID);

  assert.ok(everMoreRule);
  assert.equal(everMoreRule.spawnGroupID, EVERMORE_CUSTOMS_SPAWN_GROUP_ID);
  assert.equal(everMoreRule.exactEverMoreGatePresence, true);
  assert.equal(
    rules.some(
      (rule) =>
        rule.startupRuleID === `default_concord_gate_presence_${JITA_SOLAR_SYSTEM_ID}`,
    ),
    false,
  );

  const spawnGroup = getNpcSpawnGroup(EVERMORE_CUSTOMS_SPAWN_GROUP_ID);
  assert.deepEqual(spawnGroup.entries, [
    { profileID: EVERMORE_CUSTOMS_MAJOR_PROFILE_ID, count: 2 },
    { profileID: EVERMORE_CUSTOMS_OFFICIAL_PROFILE_ID, count: 2 },
  ]);

  const major = buildNpcDefinition(EVERMORE_CUSTOMS_MAJOR_PROFILE_ID);
  const official = buildNpcDefinition(EVERMORE_CUSTOMS_OFFICIAL_PROFILE_ID);
  assert.equal(major.profile.presentationTypeID, EVERMORE_CUSTOMS_MAJOR_TYPE_ID);
  assert.equal(official.profile.presentationTypeID, EVERMORE_CUSTOMS_OFFICIAL_TYPE_ID);
});

test("EverMore Jita layouts retain chained orbit movement authority", () => {
  const gateID = 50001248;
  const layout = getEverMoreGateCustomsLayout(JITA_SOLAR_SYSTEM_ID, gateID);

  assert.equal(getEverMoreGateCustomsExpectedCount(JITA_SOLAR_SYSTEM_ID, gateID), 4);
  assert.equal(layout.length, 4);
  assert.equal(layout[0].orbitTarget, "anchor");
  assert.equal(layout[1].orbitTarget, 0);
  assert.equal(layout[2].orbitTarget, 1);
  assert.equal(layout[3].orbitTarget, 2);

  const anchor = {
    itemID: gateID,
    position: { x: 1_000, y: 2_000, z: 3_000 },
    direction: { x: 1, y: 0, z: 0 },
  };
  const movement = buildSpawnStateForDefinition(anchor, {}, {
    spawnStateOverride: {
      position: { x: 3_175, y: 1_653.4, z: 13_293.3 },
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: -0.2, y: 0.1, z: -0.9 },
      targetPoint: anchor.position,
      mode: "ORBIT",
      speedFraction: layout[0].speedFraction,
      targetEntityID: gateID,
      followRange: layout[0].orbitDistanceMeters,
      orbitDistance: layout[0].orbitDistanceMeters,
      maxVelocity: layout[0].maxVelocity,
    },
  });

  assert.equal(movement.mode, "ORBIT");
  assert.equal(movement.targetEntityID, gateID);
  assert.equal(movement.followRange, 6_000);
  assert.equal(movement.orbitDistance, 6_000);
  assert.equal(movement.maxVelocity, 1_500);
  assert.equal(movement.speedFraction, layout[0].speedFraction);
});

test("materialized EverMore ships retain their authored orbit speed and target", { concurrency: false }, (t) => {
  const gateID = 50001248;
  const scene = runtime.ensureScene(JITA_SOLAR_SYSTEM_ID);
  const anchor = scene.getEntityByID(gateID);
  const slot = getEverMoreGateCustomsLayout(JITA_SOLAR_SYSTEM_ID, gateID)[0];
  const definition = buildNpcDefinition(slot.profileID);

  assert.ok(anchor);
  assert.ok(definition);

  const position = {
    x: Number(anchor.position.x) + Number(slot.offset.x),
    y: Number(anchor.position.y) + Number(slot.offset.y),
    z: Number(anchor.position.z) + Number(slot.offset.z),
  };
  const spawnResult = nativeNpcService.spawnNativeNpcEntityInContext(
    {
      systemID: JITA_SOLAR_SYSTEM_ID,
      scene,
      anchorEntity: anchor,
      anchorKind: "stargate",
      anchorLabel: anchor.itemName,
    },
    definition,
    {
      transient: true,
      broadcast: false,
      materializeRuntime: true,
      runtimeKind: "nativeAmbient",
      skipInitialBehaviorTick: true,
      spawnStateOverride: {
        position,
        velocity: { x: 0, y: 0, z: 0 },
        direction: { x: -0.2, y: 0.1, z: -0.9 },
        targetPoint: anchor.position,
        mode: "ORBIT",
        speedFraction: slot.speedFraction,
        targetEntityID: gateID,
        followRange: slot.orbitDistanceMeters,
        orbitDistance: slot.orbitDistanceMeters,
        maxVelocity: slot.maxVelocity,
      },
    },
  );

  assert.equal(spawnResult.success, true);
  const entity = spawnResult.data.entity;
  t.after(() => {
    nativeNpcService.destroyNativeNpcController({
      entityID: spawnResult.data.entityRecord.entityID,
      systemID: JITA_SOLAR_SYSTEM_ID,
    });
    runtime._testing.clearScenes();
  });

  assert.equal(entity.mode, "ORBIT");
  assert.equal(entity.targetEntityID, gateID);
  assert.equal(entity.followRange, 6_000);
  assert.equal(entity.orbitDistance, 6_000);
  assert.equal(entity.maxVelocity, 1_500);
  assert.equal(entity.speedFraction, slot.speedFraction);
});
