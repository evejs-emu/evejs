const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const beltRatRuntime = require(path.join(repoRoot, "server/src/space/npc/beltRatRuntime"));

const JITA_SYSTEM_ID = 30000142;
const AMARR_SYSTEM_ID = 30002187;
const VENAL_HOME_NULL_SYSTEM_ID = 30001336;
const TEST_BELT_ID = 400000123;

function buildBelt(itemID = TEST_BELT_ID, position = { x: 0, y: 0, z: 0 }) {
  return {
    kind: "asteroidBelt",
    itemID,
    itemName: `Test Belt ${itemID}`,
    solarSystemID: JITA_SYSTEM_ID,
    radius: 15000,
    position,
    direction: { x: 1, y: 0, z: 0 },
  };
}

function buildScene(systemID = JITA_SYSTEM_ID, belts = [buildBelt()]) {
  const dynamicEntities = new Map();
  const staticEntities = [...belts];
  return {
    systemID,
    staticEntities,
    dynamicEntities,
    getEntityByID(entityID) {
      const numericID = Number(entityID);
      return dynamicEntities.get(numericID) ||
        staticEntities.find((entity) => Number(entity.itemID) === numericID) ||
        null;
    },
  };
}

function buildSession(shipID = 900001) {
  return {
    characterID: 140000002,
    clientID: 123,
    _space: {
      shipID,
    },
  };
}

function buildShip(shipID = 900001, position = { x: 0, y: 0, z: 0 }) {
  return {
    kind: "ship",
    itemID: shipID,
    position,
    session: null,
  };
}

function enabledConfig(overrides = {}) {
  return {
    asteroidBeltNpcRatsEnabled: true,
    asteroidBeltNpcRatHighSecChance: 1,
    asteroidBeltNpcRatLowSecChance: 1,
    asteroidBeltNpcRatNullSecChance: 1,
    asteroidBeltNpcRatRollCooldownMs: 1000,
    asteroidBeltNpcRatRespawnCooldownMs: 10000,
    asteroidBeltNpcRatMaxActiveGroupsPerBelt: 1,
    asteroidBeltNpcRatLandingRadiusMeters: 250000,
    asteroidBeltNpcRatSpawnDistanceMeters: 30000,
    asteroidBeltNpcRatSpecialsEnabled: false,
    asteroidBeltNpcRatHaulerChance: 0,
    asteroidBeltNpcRatCommanderChance: 0,
    asteroidBeltNpcRatOfficerChance: 0,
    asteroidBeltNpcRatOfficerMaxSecurity: -0.7,
    asteroidBeltNpcRatOfficerRequireHomeRegion: true,
    asteroidBeltNpcRatCapitalEnabled: true,
    asteroidBeltNpcRatCapitalChance: 0,
    asteroidBeltNpcRatCapitalMaxSecurity: 0,
    asteroidBeltNpcRatCapitalClasses: "dreadnought",
    asteroidBeltNpcRatCapitalMaxActiveGroupsPerSystem: 1,
    ...overrides,
  };
}

function buildFakeSpawn(scene, calls) {
  return function spawnNativeDefinitionsInContext(context, selectionResult, options) {
    calls.push({ context, selectionResult, options });
    const spawned = selectionResult.data.definitions.map((definition, index) => {
      const entity = {
        kind: "ship",
        itemID: 910000 + calls.length * 100 + index,
        nativeNpc: true,
        operatorKind: options.operatorKind,
        anchorID: options.anchorID,
        anchorKind: options.anchorKind,
        spawnSiteID: options.spawnSiteID,
        selectionKind: options.selectionKind,
        selectionID: options.selectionID,
        profileID: definition.profile.profileID,
        capitalNpc: definition.profile.capitalNpc === true,
        capitalClassID: definition.profile.capitalClassID || null,
        capitalRarity: definition.profile.capitalRarity || null,
      };
      scene.dynamicEntities.set(entity.itemID, entity);
      return { entity };
    });
    return {
      success: true,
      data: {
        requestedAmount: spawned.length,
        spawned,
      },
    };
  };
}

test("belt rat spawn plans use local pirate faction and security-gated hull classes", (t) => {
  t.after(() => beltRatRuntime._testing.resetForTests());
  beltRatRuntime._testing.resetForTests();

  const jitaPlan = beltRatRuntime.buildBeltRatSpawnPlan(JITA_SYSTEM_ID, {
    skipSpecialSpawns: true,
    random: () => 0,
  });
  assert.equal(jitaPlan.success, true);
  assert.equal(jitaPlan.data.factionKey, "guristas");
  assert.equal(jitaPlan.data.securityBand, "highsec");
  assert.deepEqual(jitaPlan.data.profileIDs, ["parity_guristas_missile_frigate"]);

  const amarrPlan = beltRatRuntime.buildBeltRatSpawnPlan(AMARR_SYSTEM_ID, {
    skipSpecialSpawns: true,
    random: () => 0,
  });
  assert.equal(amarrPlan.success, true);
  assert.equal(amarrPlan.data.factionKey, "sanshas");
  assert.equal(amarrPlan.data.securityBand, "highsec");
  assert.deepEqual(amarrPlan.data.profileIDs, ["parity_sansha_pulse_frigate"]);
});

test("belt rat spawn plans use asteroid-belt NPC names instead of anomaly names", (t) => {
  t.after(() => beltRatRuntime._testing.resetForTests());
  beltRatRuntime._testing.resetForTests();

  const guristasPlan = beltRatRuntime.buildBeltRatSpawnPlan(JITA_SYSTEM_ID, {
    skipSpecialSpawns: true,
    random: () => 0,
  });
  assert.equal(guristasPlan.success, true);
  assert.equal(guristasPlan.data.definitions[0].profile.shipNameTemplate, "Guristas Arrogator");

  const sanshaPlan = beltRatRuntime.buildBeltRatSpawnPlan(AMARR_SYSTEM_ID, {
    skipSpecialSpawns: true,
    random: () => 0,
  });
  assert.equal(sanshaPlan.success, true);
  assert.equal(sanshaPlan.data.definitions[0].profile.shipNameTemplate, "Sansha's Enslaver");

  const serpentisPlan = beltRatRuntime.buildBeltRatSpawnPlan(JITA_SYSTEM_ID, {
    skipSpecialSpawns: true,
    factionKey: "serpentis",
    random: () => 0,
  });
  assert.equal(serpentisPlan.success, true);
  assert.equal(serpentisPlan.data.definitions[0].profile.shipNameTemplate, "Serpentis Agent");

  const angelPlan = beltRatRuntime.buildBeltRatSpawnPlan(JITA_SYSTEM_ID, {
    skipSpecialSpawns: true,
    factionKey: "angels",
    random: () => 0,
  });
  assert.equal(angelPlan.success, true);
  assert.equal(angelPlan.data.definitions[0].profile.shipNameTemplate, "Angel Raider");
});

test("belt rat rare spawn plans use existing commander and hauler authority pools", (t) => {
  t.after(() => beltRatRuntime._testing.resetForTests());
  beltRatRuntime._testing.resetForTests();

  const commanderPlan = beltRatRuntime.buildBeltRatSpawnPlan(JITA_SYSTEM_ID, {
    config: enabledConfig({
      asteroidBeltNpcRatSpecialsEnabled: true,
    }),
    forceSpecialSpawnKind: "commander",
    random: () => 0,
  });
  assert.equal(commanderPlan.success, true);
  assert.equal(commanderPlan.data.factionKey, "guristas");
  assert.equal(commanderPlan.data.specialSpawnKind, "commander");
  assert.equal(commanderPlan.data.spawnPoolID, "guristas_deadspace");
  assert.match(commanderPlan.data.profileIDs[0], /^parity_guristas_dread_/);
  assert.equal(
    commanderPlan.data.definitions[0].profile.shipNameTemplate,
    "Dread Guristas Arrogator",
  );

  const haulerPlan = beltRatRuntime.buildBeltRatSpawnPlan(JITA_SYSTEM_ID, {
    config: enabledConfig({
      asteroidBeltNpcRatSpecialsEnabled: true,
    }),
    forceSpecialSpawnKind: "hauler",
    random: () => 0,
    haulerMinCount: 2,
    haulerMaxCount: 2,
  });
  assert.equal(haulerPlan.success, true);
  assert.equal(haulerPlan.data.specialSpawnKind, "hauler");
  assert.equal(haulerPlan.data.spawnPoolID, "npc_mining_hauler_highsec");
  assert.equal(haulerPlan.data.profileIDs.length, 2);
  assert.ok(haulerPlan.data.profileIDs.every((profileID) => profileID.includes("_hauler")));
});

test("belt rat officer plans obey pirate home/null eligibility", (t) => {
  t.after(() => beltRatRuntime._testing.resetForTests());
  beltRatRuntime._testing.resetForTests();

  const highsecOfficer = beltRatRuntime.buildBeltRatSpawnPlan(JITA_SYSTEM_ID, {
    config: enabledConfig({
      asteroidBeltNpcRatSpecialsEnabled: true,
    }),
    forceSpecialSpawnKind: "officer",
    random: () => 0,
  });
  assert.equal(highsecOfficer.success, false);
  assert.equal(highsecOfficer.errorMsg, "SPECIAL_SPAWN_NOT_ELIGIBLE");

  const venalOfficer = beltRatRuntime.buildBeltRatSpawnPlan(VENAL_HOME_NULL_SYSTEM_ID, {
    config: enabledConfig({
      asteroidBeltNpcRatSpecialsEnabled: true,
      asteroidBeltNpcRatOfficerChance: 1,
      asteroidBeltNpcRatOfficerRequireHomeRegion: true,
    }),
    forceSpecialSpawnKind: "officer",
    random: () => 0,
  });
  assert.equal(venalOfficer.success, true);
  assert.equal(venalOfficer.data.factionKey, "guristas");
  assert.equal(venalOfficer.data.specialSpawnKind, "officer");
  assert.equal(venalOfficer.data.spawnPoolID, "guristas_officer");
  assert.match(venalOfficer.data.profileIDs[0], /^parity_guristas_officer_/);
});

test("belt rat capital plans are nullsec-only and select existing capital authority", (t) => {
  t.after(() => beltRatRuntime._testing.resetForTests());
  beltRatRuntime._testing.resetForTests();

  const highsecCapital = beltRatRuntime.buildBeltRatSpawnPlan(JITA_SYSTEM_ID, {
    config: enabledConfig({
      asteroidBeltNpcRatSpecialsEnabled: true,
      asteroidBeltNpcRatCapitalChance: 1,
    }),
    forceSpecialSpawnKind: "capital",
    random: () => 0,
  });
  assert.equal(highsecCapital.success, false);
  assert.equal(highsecCapital.errorMsg, "SPECIAL_SPAWN_NOT_ELIGIBLE");

  const disabledCapital = beltRatRuntime.buildBeltRatSpawnPlan(VENAL_HOME_NULL_SYSTEM_ID, {
    config: enabledConfig({
      asteroidBeltNpcRatSpecialsEnabled: true,
      asteroidBeltNpcRatCapitalEnabled: false,
      asteroidBeltNpcRatCapitalChance: 1,
    }),
    forceSpecialSpawnKind: "capital",
    random: () => 0,
  });
  assert.equal(disabledCapital.success, false);
  assert.equal(disabledCapital.errorMsg, "SPECIAL_SPAWN_NOT_ELIGIBLE");

  const venalCapital = beltRatRuntime.buildBeltRatSpawnPlan(VENAL_HOME_NULL_SYSTEM_ID, {
    config: enabledConfig({
      asteroidBeltNpcRatSpecialsEnabled: true,
      asteroidBeltNpcRatCapitalChance: 1,
    }),
    forceSpecialSpawnKind: "capital",
    random: () => 0,
  });
  assert.equal(venalCapital.success, true);
  assert.equal(venalCapital.data.factionKey, "guristas");
  assert.equal(venalCapital.data.specialSpawnKind, "capital");
  assert.equal(venalCapital.data.spawnPoolID, "capital_npc_guristas");
  assert.equal(venalCapital.data.profileIDs[0], "capital_guristas_dreadnought");
  assert.equal(venalCapital.data.definitions[0].profile.capitalNpc, true);
  assert.equal(venalCapital.data.definitions[0].profile.capitalClassID, "dreadnought");

  const titanCapital = beltRatRuntime.buildBeltRatSpawnPlan(VENAL_HOME_NULL_SYSTEM_ID, {
    config: enabledConfig({
      asteroidBeltNpcRatSpecialsEnabled: true,
      asteroidBeltNpcRatCapitalChance: 1,
      asteroidBeltNpcRatCapitalClasses: "titan",
    }),
    forceSpecialSpawnKind: "capital",
    random: () => 0,
  });
  assert.equal(titanCapital.success, true);
  assert.equal(titanCapital.data.profileIDs[0], "capital_dread_guristas_titan");
  assert.equal(titanCapital.data.definitions[0].profile.capitalClassID, "titan");
});

test("belt rat arrival is disabled by config without touching the spawn path", (t) => {
  t.after(() => beltRatRuntime._testing.resetForTests());
  beltRatRuntime._testing.resetForTests();

  const belt = buildBelt();
  const scene = buildScene(JITA_SYSTEM_ID, [belt]);
  const calls = [];
  const result = beltRatRuntime.maybeSpawnForBeltArrival(
    scene,
    buildSession(),
    belt,
    {
      config: enabledConfig({ asteroidBeltNpcRatsEnabled: false }),
      spawnNativeDefinitionsInContext: buildFakeSpawn(scene, calls),
      random: () => 0,
      nowMs: 1000,
    },
  );

  assert.equal(result.success, true);
  assert.equal(result.spawned, false);
  assert.equal(result.reason, "DISABLED");
  assert.equal(calls.length, 0);
});

test("belt rat arrival spawns once, then active group and respawn cooldown suppress duplicates", (t) => {
  t.after(() => beltRatRuntime._testing.resetForTests());
  beltRatRuntime._testing.resetForTests();

  const belt = buildBelt();
  const scene = buildScene(JITA_SYSTEM_ID, [belt]);
  const calls = [];
  const spawn = buildFakeSpawn(scene, calls);

  const first = beltRatRuntime.maybeSpawnForBeltArrival(
    scene,
    buildSession(),
    belt,
    {
      config: enabledConfig(),
      spawnNativeDefinitionsInContext: spawn,
      random: () => 0,
      nowMs: 1000,
      broadcast: false,
    },
  );
  assert.equal(first.success, true);
  assert.equal(first.spawned, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.broadcast, false);
  assert.equal(calls[0].options.operatorKind, beltRatRuntime.OPERATOR_KIND);
  assert.equal(calls[0].options.anchorID, belt.itemID);

  const second = beltRatRuntime.maybeSpawnForBeltArrival(
    scene,
    buildSession(),
    belt,
    {
      config: enabledConfig(),
      spawnNativeDefinitionsInContext: spawn,
      random: () => 0,
      nowMs: 2000,
    },
  );
  assert.equal(second.spawned, false);
  assert.equal(second.reason, "ACTIVE_GROUP_PRESENT");
  assert.equal(calls.length, 1);

  scene.dynamicEntities.clear();
  const third = beltRatRuntime.maybeSpawnForBeltArrival(
    scene,
    buildSession(),
    belt,
    {
      config: enabledConfig(),
      spawnNativeDefinitionsInContext: spawn,
      random: () => 0,
      nowMs: 5000,
    },
  );
  assert.equal(third.spawned, false);
  assert.equal(third.reason, "RESPAWN_COOLDOWN");
  assert.equal(calls.length, 1);
});

test("belt rat capital arrivals enforce the active capital group cap per system", (t) => {
  t.after(() => beltRatRuntime._testing.resetForTests());
  beltRatRuntime._testing.resetForTests();

  const firstBelt = buildBelt(TEST_BELT_ID, { x: 0, y: 0, z: 0 });
  const secondBelt = buildBelt(TEST_BELT_ID + 1, { x: 250000, y: 0, z: 0 });
  const scene = buildScene(VENAL_HOME_NULL_SYSTEM_ID, [firstBelt, secondBelt]);
  const calls = [];
  const spawn = buildFakeSpawn(scene, calls);
  const capitalConfig = enabledConfig({
    asteroidBeltNpcRatSpecialsEnabled: true,
    asteroidBeltNpcRatCapitalChance: 1,
    asteroidBeltNpcRatCapitalMaxActiveGroupsPerSystem: 1,
    asteroidBeltNpcRatRollCooldownMs: 0,
    asteroidBeltNpcRatRespawnCooldownMs: 0,
  });

  const first = beltRatRuntime.maybeSpawnForBeltArrival(
    scene,
    buildSession(),
    firstBelt,
    {
      config: capitalConfig,
      spawnNativeDefinitionsInContext: spawn,
      forceSpecialSpawnKind: "capital",
      random: () => 0,
      nowMs: 1000,
    },
  );
  assert.equal(first.success, true);
  assert.equal(first.spawned, true);
  assert.equal(first.data.specialSpawnKind, "capital");
  assert.equal(calls.length, 1);

  const second = beltRatRuntime.maybeSpawnForBeltArrival(
    scene,
    buildSession(),
    secondBelt,
    {
      config: capitalConfig,
      spawnNativeDefinitionsInContext: spawn,
      forceSpecialSpawnKind: "capital",
      random: () => 0,
      nowMs: 2000,
    },
  );
  assert.equal(second.success, true);
  assert.equal(second.spawned, false);
  assert.equal(second.reason, "CAPITAL_ACTIVE_SYSTEM_LIMIT");
  assert.equal(second.activeCapitalGroups, 1);
  assert.equal(calls.length, 1);
});

test("session arrival resolves a belt target directly before falling back to nearest belt radius", (t) => {
  t.after(() => beltRatRuntime._testing.resetForTests());
  beltRatRuntime._testing.resetForTests();

  const nearBelt = buildBelt(TEST_BELT_ID, { x: 0, y: 0, z: 0 });
  const farBelt = buildBelt(TEST_BELT_ID + 1, { x: 2_000_000, y: 0, z: 0 });
  const scene = buildScene(JITA_SYSTEM_ID, [nearBelt, farBelt]);
  const ship = buildShip(900001, { x: 10_000, y: 0, z: 0 });
  const session = buildSession(ship.itemID);
  ship.session = session;
  const calls = [];

  const result = beltRatRuntime.maybeSpawnForSessionArrival(
    scene,
    session,
    ship,
    {
      config: enabledConfig({ asteroidBeltNpcRatRollCooldownMs: 0 }),
      spawnNativeDefinitionsInContext: buildFakeSpawn(scene, calls),
      random: () => 0,
      nowMs: 1000,
    },
  );

  assert.equal(result.success, true);
  assert.equal(result.spawned, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.anchorID, nearBelt.itemID);
});
