const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const repoRoot = path.resolve(__dirname, "..", "..");
const npcData = require(path.join(repoRoot, "server/src/space/npc/npcData"));
const npcService = require(path.join(repoRoot, "server/src/space/npc"));
const {
  rollNpcLootEntries,
} = require(path.join(repoRoot, "server/src/space/npc/npcLoot"));
const {
  TABLE: REFERENCE_TABLE,
  readStaticRows,
} = require(path.join(repoRoot, "server/src/services/_shared/referenceData"));
const nativeNpcStore = require(path.join(repoRoot, "server/src/space/npc/nativeNpcStore"));
const dungeonRuntime = require(path.join(
  repoRoot,
  "server/src/services/dungeon/dungeonRuntime",
));
const dungeonUniverseRuntime = require(path.join(
  repoRoot,
  "server/src/services/dungeon/dungeonUniverseRuntime",
));
const trigDrifterSpawnAuthority = require(path.join(
  repoRoot,
  "server/src/space/npc/trigDrifter/trigDrifterSpawnAuthority",
));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));

const TEST_SYSTEM_ID = 30000142;
const registeredSessions = [];
const touchedSystemIDs = new Set();

function withMockedRandom(sequence, fn) {
  const originalRandom = Math.random;
  let index = 0;
  Math.random = () => {
    const value = sequence[index];
    index += 1;
    return typeof value === "number" ? value : 0;
  };
  try {
    return fn();
  } finally {
    Math.random = originalRandom;
  }
}

function createFakeSession(
  clientID,
  characterID,
  position,
  direction = { x: 1, y: 0, z: 0 },
  systemID = TEST_SYSTEM_ID,
) {
  return {
    clientID,
    characterID,
    charID: characterID,
    characterName: `catalog-char-${characterID}`,
    shipName: `catalog-ship-${characterID}`,
    corporationID: 1,
    allianceID: 0,
    warFactionID: 0,
    solarsystemid: systemID,
    solarsystemid2: systemID,
    socket: { destroyed: false },
    notifications: [],
    sendNotification() {},
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
  touchedSystemIDs.add(Number(session && session.solarsystemid) || TEST_SYSTEM_ID);
  registeredSessions.push(session);
  sessionRegistry.register(session);
  spaceRuntime.attachSession(session, session.shipItem, {
    systemID: Number(session && session.solarsystemid) || TEST_SYSTEM_ID,
    broadcast: false,
    spawnStopped: true,
  });
  assert.equal(
    spaceRuntime.ensureInitialBallpark(session),
    true,
    "expected catalog test session to bootstrap into the scene",
  );
  return session;
}

function listSceneSignatureAnchors(scene, labelFragment) {
  const normalizedLabelFragment = String(labelFragment || "").trim().toLowerCase();
  return (scene && Array.isArray(scene.staticEntities) ? scene.staticEntities : [])
    .filter((entity) => (
      entity &&
      entity.signalTrackerSignatureSite === true &&
      String(entity.signalTrackerSiteLabel || entity.itemName || "")
        .trim()
        .toLowerCase()
        .includes(normalizedLabelFragment)
    ));
}

test.afterEach(() => {
  for (const session of registeredSessions.splice(0)) {
    try {
      sessionRegistry.unregister(session);
    } catch {}
  }
  for (const systemID of touchedSystemIDs) {
    try {
      npcService.clearNpcControllersInSystem(systemID, {
        entityType: "all",
        removeContents: true,
      });
    } catch {}
  }
  touchedSystemIDs.clear();
  try {
    spaceRuntime._testing.clearScenes();
  } catch {}
  try {
    dungeonRuntime.resetRuntimeForTests();
  } catch {}
});

test("generated Trig/Drifter NPC authority rows resolve through the shared npcData layer", () => {
  const trigProfileResolution = npcData.resolveNpcProfile("Renewing Rodiva");
  assert.equal(trigProfileResolution && trigProfileResolution.success, true);
  assert.equal(
    trigProfileResolution.data && trigProfileResolution.data.profileID,
    "parity_trig_renewing_rodiva",
  );

  const trigDefinition = npcData.buildNpcDefinition("parity_trig_renewing_rodiva");
  assert(trigDefinition, "expected generated Trig definition");
  assert.equal(trigDefinition.profile.shipTypeID, 52214);
  assert.equal(trigDefinition.loadout.modules[0].typeID, 47918);
  assert.equal(trigDefinition.loadout.charges[0].typeID, 47928);

  const drifterProfileResolution = npcData.resolveNpcProfile("Autothysian Lancer");
  assert.equal(drifterProfileResolution && drifterProfileResolution.success, true);
  assert.equal(
    drifterProfileResolution.data && drifterProfileResolution.data.profileID,
    "parity_drifter_lancer",
  );

  const drifterDefinition = npcData.buildNpcDefinition("parity_drifter_lancer");
  assert(drifterDefinition, "expected generated Drifter definition");
  assert.equal(drifterDefinition.profile.shipTypeID, 34337);
  assert.equal(
    Array.isArray(drifterDefinition.behaviorProfile.reinforcementDefinitions),
    true,
  );
  assert.equal(
    drifterDefinition.behaviorProfile.reinforcementDefinitions.length,
    1,
    "expected the generated lancer behavior row to preserve reinforcement authority",
  );
  assert.equal(
    drifterDefinition.behaviorProfile.reinforcementDefinitions[0].profile.shipTypeID,
    34495,
  );

  const responseProfileResolution = npcData.resolveNpcProfile("Drifter Response Battleship");
  assert.equal(responseProfileResolution && responseProfileResolution.success, true);
  assert.equal(
    responseProfileResolution.data && responseProfileResolution.data.profileID,
    "parity_drifter_response",
  );

  const responseDefinition = npcData.buildNpcDefinition("parity_drifter_response");
  assert(responseDefinition, "expected generated Drifter response definition");
  assert.equal(responseDefinition.profile.shipTypeID, 37473);

  const polemarkosProfileResolution = npcData.resolveNpcProfile("Polemarkos");
  assert.equal(polemarkosProfileResolution && polemarkosProfileResolution.success, true);
  assert.equal(
    polemarkosProfileResolution.data && polemarkosProfileResolution.data.profileID,
    "parity_drifter_polemarkos",
  );

  const polemarkosDefinition = npcData.buildNpcDefinition("parity_drifter_polemarkos");
  assert(polemarkosDefinition, "expected generated Drifter Polemarkos definition");
  assert.equal(polemarkosDefinition.profile.shipTypeID, 56217);

  const roamingProfileResolution = npcData.resolveNpcProfile("Roaming Drifter Battleship");
  assert.equal(roamingProfileResolution && roamingProfileResolution.success, true);
  assert.equal(
    roamingProfileResolution.data && roamingProfileResolution.data.profileID,
    "parity_drifter_roaming_battleship",
  );

  const roamingDefinition = npcData.buildNpcDefinition("parity_drifter_roaming_battleship");
  assert(roamingDefinition, "expected generated roaming Drifter definition");
  assert.equal(roamingDefinition.profile.shipTypeID, 34495);
  assert.equal(roamingDefinition.profile.loadoutID, "parity_drifter_battleship_loadout");
  assert.equal(roamingDefinition.profile.lootTableID, "parity_drifter_battleship_loot");
  assert.equal(roamingDefinition.behaviorProfile.drifterBehaviorFamily, "roaming");
  assert.equal(roamingDefinition.behaviorProfile.drifterEnablePackRegroup, true);
  assert.equal(roamingDefinition.behaviorProfile.drifterEnableEntosisPriority, false);
  assert.equal(roamingDefinition.behaviorProfile.drifterEnablePursuitWarp, false);

  const dungeonDefinition = npcData.buildNpcDefinition("parity_drifter_dungeon_battleship");
  assert(dungeonDefinition, "expected generated dungeon Drifter definition");
  assert.equal(dungeonDefinition.behaviorProfile.drifterBehaviorFamily, "dungeon");
  assert.equal(dungeonDefinition.behaviorProfile.idleAnchorOrbit, true);
  assert.equal(dungeonDefinition.behaviorProfile.drifterEnableReinforcements, false);
  assert.equal(dungeonDefinition.behaviorProfile.drifterEnablePackRegroup, false);

  const hiveDefinition = npcData.buildNpcDefinition("parity_drifter_hive_lancer");
  assert(hiveDefinition, "expected generated hive Drifter definition");
  assert.equal(hiveDefinition.behaviorProfile.drifterBehaviorFamily, "hive");
  assert.equal(hiveDefinition.behaviorProfile.drifterEnableReinforcements, true);
  assert.equal(hiveDefinition.behaviorProfile.drifterEnableEntosisPriority, false);
  assert.equal(
    Array.isArray(hiveDefinition.behaviorProfile.reinforcementDefinitions),
    true,
    "expected the generated hive lancer behavior row to preserve reinforcement authority",
  );
  assert.equal(
    hiveDefinition.behaviorProfile.reinforcementDefinitions.length,
    1,
    "expected exactly one generated hive reinforcement definition",
  );
  assert.equal(
    hiveDefinition.behaviorProfile.reinforcementDefinitions[0].behaviorProfile.drifterBehaviorFamily,
    "hive",
    "expected family-authored hive reinforcements to keep the explicit hive behavior family",
  );
});

test("generated Trig/Drifter spawn groups and pools resolve through the shared npcData layer", () => {
  const trigGroupResolution = npcData.resolveNpcSpawnGroup("Renewing Rodiva Singleton");
  assert.equal(trigGroupResolution && trigGroupResolution.success, true);
  assert.equal(
    trigGroupResolution.data && trigGroupResolution.data.spawnGroupID,
    "parity_trig_renewing_rodiva_solo",
  );

  const drifterGroupResolution = npcData.resolveNpcSpawnGroup("Autothysian Lancer Singleton");
  assert.equal(drifterGroupResolution && drifterGroupResolution.success, true);
  assert.equal(
    drifterGroupResolution.data && drifterGroupResolution.data.spawnGroupID,
    "parity_drifter_lancer_solo",
  );

  const trigPoolResolution = npcData.resolveNpcSpawnPool("Triglavian Native Parity Pool");
  assert.equal(trigPoolResolution && trigPoolResolution.success, true);
  assert(
    Array.isArray(trigPoolResolution.data.entries) &&
      trigPoolResolution.data.entries.some((entry) => entry.profileID === "parity_trig_liminal_leshak"),
    "expected the generated Trig pool to include canonical Trig hull profiles",
  );

  const drifterPoolResolution = npcData.resolveNpcSpawnPool("Drifter Response Callers");
  assert.equal(drifterPoolResolution && drifterPoolResolution.success, true);
  assert.deepEqual(
    drifterPoolResolution.data.entries.map((entry) => entry.profileID),
    ["parity_drifter_lancer"],
  );

  const drifterSuperweaponPoolResolution = npcData.resolveNpcSpawnPool("Drifter Superweapon Line");
  assert.equal(drifterSuperweaponPoolResolution && drifterSuperweaponPoolResolution.success, true);
  assert(
    Array.isArray(drifterSuperweaponPoolResolution.data.entries) &&
      drifterSuperweaponPoolResolution.data.entries.some((entry) => entry.profileID === "parity_drifter_polemarkos") &&
      drifterSuperweaponPoolResolution.data.entries.some((entry) => entry.profileID === "parity_drifter_strategos"),
    "expected the generated Drifter superweapon pool to include the expanded superweapon-capable hull families",
  );

  const drifterResponseGroupResolution = npcData.resolveNpcSpawnGroup("Drifter Lancer Response Screen");
  assert.equal(drifterResponseGroupResolution && drifterResponseGroupResolution.success, true);
  assert.deepEqual(
    drifterResponseGroupResolution.data.entries.map((entry) => String(entry.spawnPoolID || entry.profileID || "")),
    [
      "parity_drifter_lancer",
      "parity_drifter_response_battleships",
      "parity_drifter_disruption_cruisers",
    ],
  );

  const drifterHivePoolResolution = npcData.resolveNpcSpawnPool("Drifter Hive Family");
  assert.equal(drifterHivePoolResolution && drifterHivePoolResolution.success, true);
  assert.deepEqual(
    drifterHivePoolResolution.data.entries.map((entry) => entry.profileID),
    [
      "parity_drifter_hive_lancer",
      "parity_drifter_hive_battleship",
    ],
  );

  const drifterRoamingPoolResolution = npcData.resolveNpcSpawnPool("Drifter Roaming Family");
  assert.equal(drifterRoamingPoolResolution && drifterRoamingPoolResolution.success, true);
  assert.deepEqual(
    drifterRoamingPoolResolution.data.entries.map((entry) => entry.profileID),
    ["parity_drifter_roaming_battleship"],
  );

  const drifterDungeonGroupResolution = npcData.resolveNpcSpawnGroup("Dungeon Drifter Battleship Singleton");
  assert.equal(drifterDungeonGroupResolution && drifterDungeonGroupResolution.success, true);
  assert.deepEqual(
    drifterDungeonGroupResolution.data.entries.map((entry) => String(entry.profileID || "")),
    ["parity_drifter_dungeon_battleship"],
  );
});

test("generated Trig/Drifter loot tables resolve through the shared npcData layer", () => {
  const trigDefinition = npcData.buildNpcDefinition("parity_trig_renewing_rodiva");
  assert(trigDefinition, "expected generated Trig definition");
  assert(trigDefinition.lootTable, "expected generated Trig loot table");
  assert.equal(
    trigDefinition.lootTable.lootTableID,
    "parity_trig_renewing_rodiva_loot",
  );
  assert.deepEqual(
    trigDefinition.lootTable.guaranteedEntries,
    [{
      typeID: 48121,
      minQuantity: 2,
      maxQuantity: 2,
      singleton: false,
    }],
  );
  assert.deepEqual(
    trigDefinition.lootTable.entries.map((entry) => Number(entry && entry.typeID || 0)),
    [49735, 47765, 47761],
  );
  const trigLootRoll = withMockedRandom([0, 0.99, 0, 0], () => (
    rollNpcLootEntries(trigDefinition.lootTable)
  ));
  assert.deepEqual(
    trigLootRoll.map((entry) => ({
      typeID: Number(entry && entry.typeID || 0),
      quantity: Number(entry && entry.quantity || 0),
    })),
    [
      { typeID: 48121, quantity: 2 },
      { typeID: 49735, quantity: 1 },
    ],
  );

  const drifterDefinition = npcData.buildNpcDefinition("parity_drifter_lancer");
  assert(drifterDefinition, "expected generated Drifter definition");
  assert(drifterDefinition.lootTable, "expected generated Drifter loot table");
  assert.equal(
    drifterDefinition.lootTable.lootTableID,
    "parity_drifter_lancer_loot",
  );
  assert.deepEqual(
    drifterDefinition.lootTable.guaranteedEntries,
    [{
      typeID: 30745,
      minQuantity: 4,
      maxQuantity: 4,
      singleton: false,
    }],
  );
  assert.deepEqual(
    drifterDefinition.lootTable.entries.map((entry) => Number(entry && entry.typeID || 0)),
    [34575, 30746],
  );
  const drifterLootRoll = withMockedRandom([0, 0.99, 0, 0], () => (
    rollNpcLootEntries(drifterDefinition.lootTable)
  ));
  assert.deepEqual(
    drifterLootRoll.map((entry) => ({
      typeID: Number(entry && entry.typeID || 0),
      quantity: Number(entry && entry.quantity || 0),
    })),
    [
      { typeID: 30745, quantity: 4 },
      { typeID: 34575, quantity: 1 },
    ],
  );
});

test("generated Trig Pochven sites and startup rules resolve through the shared npcData layer", () => {
  const solarSystems = readStaticRows(REFERENCE_TABLE.SOLAR_SYSTEMS);
  const stargates = readStaticRows(REFERENCE_TABLE.STARGATES);
  const systemNameByID = new Map(
    solarSystems.map((row) => [Number(row && row.solarSystemID), String(row && row.solarSystemName || "")]),
  );
  const pochvenSystemIDs = new Set(
    solarSystems
      .filter((row) => Number(row && row.regionID) === 10000070)
      .map((row) => Number(row && row.solarSystemID)),
  );
  const expectedPochvenGateCount = stargates.filter((row) => (
    pochvenSystemIDs.has(Number(row && row.solarSystemID))
  )).length;
  assert.ok(expectedPochvenGateCount > 0, "expected repo-owned Pochven stargates");

  const generatedSites = npcData
    .listNpcSpawnSites()
    .filter((row) => String(row && row.spawnSiteID || "").startsWith("parity_trig_pochven_gate_site_"));
  assert.equal(
    generatedSites.length,
    expectedPochvenGateCount,
    "expected one generated Trig spawn site per repo-owned Pochven stargate",
  );

  const sampleSite = generatedSites[0] || null;
  assert(sampleSite, "expected at least one generated Pochven gate site");
  const siteResolution = npcData.resolveNpcSpawnSite(sampleSite.spawnSiteID);
  assert.equal(siteResolution && siteResolution.success, true);
  assert.match(
    String(siteResolution.data.spawnGroupID || ""),
    /^parity_trig_pochven_(border|internal|home)_gate_patrol$/,
  );
  assert.equal(Number(siteResolution.data.systemID) > 0, true);
  assert.equal(
    Number(siteResolution.data.anchor && siteResolution.data.anchor.itemID) > 0,
    true,
  );
  assert.equal(
    String(siteResolution.data.anchor && siteResolution.data.anchor.kind),
    "stargate",
  );

  for (const startupRuleID of [
    "parity_trig_pochven_border_gate_patrol_startup",
    "parity_trig_pochven_internal_gate_patrol_startup",
    "parity_trig_pochven_home_gate_patrol_startup",
  ]) {
    const startupRuleResolution = npcData.resolveNpcStartupRule(startupRuleID);
    assert.equal(startupRuleResolution && startupRuleResolution.success, true);
    assert.equal(startupRuleResolution.data.enabled, true);
    assert.equal(
      Array.isArray(startupRuleResolution.data.systemIDs),
      true,
      `expected explicit systemIDs on ${startupRuleID}`,
    );
    assert.equal(
      String(startupRuleResolution.data.anchorSelector && startupRuleResolution.data.anchorSelector.kind),
      "stargate",
    );
  }
  const borderRule = npcData.getNpcStartupRule("parity_trig_pochven_border_gate_patrol_startup");
  const internalRule = npcData.getNpcStartupRule("parity_trig_pochven_internal_gate_patrol_startup");
  const homeRule = npcData.getNpcStartupRule("parity_trig_pochven_home_gate_patrol_startup");
  assert.equal((borderRule.systemIDs || []).length, 6);
  assert.equal((internalRule.systemIDs || []).length, 18);
  assert.equal((homeRule.systemIDs || []).length, 3);
  assert.deepEqual(
    (homeRule.systemIDs || []).map((systemID) => systemNameByID.get(Number(systemID))).sort(),
    ["Archee", "Kino", "Niarja"],
  );
});

test("generated Trig Pochven station sites and startup rules resolve through the shared npcData layer", () => {
  const solarSystems = readStaticRows(REFERENCE_TABLE.SOLAR_SYSTEMS);
  const stations = readStaticRows(REFERENCE_TABLE.STATIONS);
  const systemNameByID = new Map(
    solarSystems.map((row) => [Number(row && row.solarSystemID), String(row && row.solarSystemName || "")]),
  );
  const pochvenSystemIDs = new Set(
    solarSystems
      .filter((row) => Number(row && row.regionID) === 10000070)
      .map((row) => Number(row && row.solarSystemID)),
  );
  const expectedPochvenStationCount = stations.filter((row) => (
    pochvenSystemIDs.has(Number(row && row.solarSystemID))
  )).length;
  assert.ok(expectedPochvenStationCount > 0, "expected repo-owned Pochven stations");

  const generatedSites = npcData
    .listNpcSpawnSites()
    .filter((row) => String(row && row.spawnSiteID || "").startsWith("parity_trig_pochven_station_site_"));
  assert.equal(
    generatedSites.length,
    expectedPochvenStationCount,
    "expected one generated Trig station site per repo-owned Pochven station",
  );

  const sampleSite = generatedSites[0] || null;
  assert(sampleSite, "expected at least one generated Pochven station site");
  const siteResolution = npcData.resolveNpcSpawnSite(sampleSite.spawnSiteID);
  assert.equal(siteResolution && siteResolution.success, true);
  assert.match(
    String(siteResolution.data.spawnGroupID || ""),
    /^parity_trig_pochven_(border|internal|home)_station_presence$/,
  );
  assert.equal(Number(siteResolution.data.systemID) > 0, true);
  assert.equal(
    Number(siteResolution.data.anchor && siteResolution.data.anchor.itemID) > 0,
    true,
  );
  assert.equal(
    String(siteResolution.data.anchor && siteResolution.data.anchor.kind),
    "station",
  );

  for (const startupRuleID of [
    "parity_trig_pochven_border_station_presence_startup",
    "parity_trig_pochven_internal_station_presence_startup",
    "parity_trig_pochven_home_station_presence_startup",
  ]) {
    const startupRuleResolution = npcData.resolveNpcStartupRule(startupRuleID);
    assert.equal(startupRuleResolution && startupRuleResolution.success, true);
    assert.equal(startupRuleResolution.data.enabled, true);
    assert.equal(
      Array.isArray(startupRuleResolution.data.systemIDs),
      true,
      `expected explicit systemIDs on ${startupRuleID}`,
    );
    assert.equal(
      String(startupRuleResolution.data.anchorSelector && startupRuleResolution.data.anchorSelector.kind),
      "station",
    );
  }
  const borderRule = npcData.getNpcStartupRule("parity_trig_pochven_border_station_presence_startup");
  const internalRule = npcData.getNpcStartupRule("parity_trig_pochven_internal_station_presence_startup");
  const homeRule = npcData.getNpcStartupRule("parity_trig_pochven_home_station_presence_startup");
  assert.equal((borderRule.systemIDs || []).length, 6);
  assert.equal((internalRule.systemIDs || []).length, 18);
  assert.equal((homeRule.systemIDs || []).length, 3);
  assert.deepEqual(
    (homeRule.systemIDs || []).map((systemID) => systemNameByID.get(Number(systemID))).sort(),
    ["Archee", "Kino", "Niarja"],
  );
});

test("generated Trig/Drifter authority rows can materialize through the live native NPC spawn path", () => {
  const session = registerAttachedSession(
    createFakeSession(
      989261,
      999261,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
    ),
  );

  const trigSpawnResult = npcService.spawnNpcForSession(session, {
    profileQuery: "Renewing Rodiva",
    fallbackProfileID: "parity_trig_renewing_rodiva",
    preferPools: false,
  });
  assert.equal(trigSpawnResult && trigSpawnResult.success, true);
  assert.equal(
    trigSpawnResult.data.definition.profile.profileID,
    "parity_trig_renewing_rodiva",
  );

  const drifterSpawnResult = npcService.spawnNpcForSession(session, {
    profileQuery: "Autothysian Lancer",
    fallbackProfileID: "parity_drifter_lancer",
    preferPools: false,
  });
  assert.equal(drifterSpawnResult && drifterSpawnResult.success, true);
  assert.equal(
    drifterSpawnResult.data.definition.profile.profileID,
    "parity_drifter_lancer",
  );
  assert.equal(
    drifterSpawnResult.data.definition.behaviorProfile.reinforcementDefinitions.length,
    1,
  );

  const responseSpawnResult = npcService.spawnNpcForSession(session, {
    profileQuery: "Drifter Response Battleship",
    fallbackProfileID: "parity_drifter_response",
    preferPools: false,
  });
  assert.equal(responseSpawnResult && responseSpawnResult.success, true);
  assert.equal(
    responseSpawnResult.data.definition.profile.profileID,
    "parity_drifter_response",
  );

  const polemarkosSpawnResult = npcService.spawnNpcForSession(session, {
    profileQuery: "Polemarkos",
    fallbackProfileID: "parity_drifter_polemarkos",
    preferPools: false,
  });
  assert.equal(polemarkosSpawnResult && polemarkosSpawnResult.success, true);
  assert.equal(
    polemarkosSpawnResult.data.definition.profile.profileID,
    "parity_drifter_polemarkos",
  );
});

test("generated Pochven startup rules materialize native Trig patrols on every gate anchor in-system", () => {
  const generatedSites = npcData
    .listNpcSpawnSites()
    .filter((row) => String(row && row.spawnSiteID || "").startsWith("parity_trig_pochven_gate_site_"));
  const sampleSite = generatedSites[0] || null;
  assert(sampleSite, "expected at least one generated Pochven site");

  const targetSystemID = Number(sampleSite.systemID);
  touchedSystemIDs.add(targetSystemID);
  npcService.clearNpcControllersInSystem(targetSystemID, {
    entityType: "all",
    removeContents: true,
  });

  const stargates = readStaticRows(REFERENCE_TABLE.STARGATES).filter((row) => (
    Number(row && row.solarSystemID) === targetSystemID
  ));
  assert.ok(stargates.length > 0, "expected repo-owned stargates in the target Pochven system");

  const previousSkipStartup = process.env.EVEJS_SKIP_NPC_STARTUP;
  delete process.env.EVEJS_SKIP_NPC_STARTUP;
  try {
    const startupResult = npcService.spawnStartupRulesForSystem(targetSystemID);
    assert.equal(startupResult && startupResult.success, true);

    const persistedControllers = nativeNpcStore.listNativeControllersForSystem(targetSystemID).filter((controller) => (
      /^parity_trig_pochven_(border|internal|home)_gate_patrol_startup$/.test(
        String(controller && controller.startupRuleID || ""),
      )
    ));
    assert.ok(
      persistedControllers.length > 0,
      "expected generated startup rule to materialize persisted native Trig controllers",
    );

    const anchorIDs = new Set(
      persistedControllers
        .map((controller) => Number(controller && controller.anchorID) || 0)
        .filter((value) => value > 0),
    );
    assert.equal(
      anchorIDs.size,
      stargates.length,
      "expected the generated Pochven startup rule to cover every stargate anchor in the sampled system",
    );
  } finally {
    process.env.EVEJS_SKIP_NPC_STARTUP = previousSkipStartup;
  }
});

test("generated Pochven startup rules wake into live runtime controllers when a player is present", () => {
  const generatedSites = npcData
    .listNpcSpawnSites()
    .filter((row) => String(row && row.spawnSiteID || "").startsWith("parity_trig_pochven_gate_site_"));
  const sampleSite = generatedSites[0] || null;
  assert(sampleSite, "expected at least one generated Pochven site");

  const targetSystemID = Number(sampleSite.systemID);
  touchedSystemIDs.add(targetSystemID);
  npcService.clearNpcControllersInSystem(targetSystemID, {
    entityType: "all",
    removeContents: true,
  });

  const stargates = readStaticRows(REFERENCE_TABLE.STARGATES).filter((row) => (
    Number(row && row.solarSystemID) === targetSystemID
  ));
  assert.ok(stargates.length > 0, "expected repo-owned stargates in the target Pochven system");
  const relevantGate = stargates.find((row) => (
    Number(row && row.itemID) === Number(sampleSite.anchor && sampleSite.anchor.itemID)
  )) || null;
  assert(relevantGate && relevantGate.position, "expected repo-owned gate position for the sampled site");

  const session = registerAttachedSession(
    createFakeSession(
      989271,
      999271,
      relevantGate.position,
      { x: 1, y: 0, z: 0 },
      targetSystemID,
    ),
  );
  assert.equal(Number(session.solarsystemid), targetSystemID);

  const previousSkipStartup = process.env.EVEJS_SKIP_NPC_STARTUP;
  delete process.env.EVEJS_SKIP_NPC_STARTUP;
  try {
    const startupResult = npcService.spawnStartupRulesForSystem(targetSystemID);
    assert.equal(startupResult && startupResult.success, true);

    const persistedControllers = nativeNpcStore.listNativeControllersForSystem(targetSystemID).filter((controller) => (
      /^parity_trig_pochven_(border|internal|home)_gate_patrol_startup$/.test(
        String(controller && controller.startupRuleID || ""),
      )
    ));
    const persistedAnchorIDs = new Set(
      persistedControllers
        .map((controller) => Number(controller && controller.anchorID) || 0)
        .filter((value) => value > 0),
    );
    assert.equal(
      persistedAnchorIDs.size,
      stargates.length,
      "expected active-session startup handling to keep persisted patrol coverage for every gate anchor in the sampled system",
    );

    const runtimeControllers = npcService.getNpcOperatorSummary().filter((summary) => (
      Number(summary && summary.systemID) === targetSystemID &&
      /^parity_trig_pochven_(border|internal|home)_gate_patrol_startup$/.test(
        String(summary && summary.startupRuleID || ""),
      )
    ));
    assert.ok(
      runtimeControllers.length > 0,
      "expected generated startup rule to materialize live runtime Trig controllers when a player is present",
    );

    const runtimeAnchorIDs = new Set(
      runtimeControllers
        .map((summary) => Number(summary && summary.anchorID) || 0)
        .filter((value) => value > 0),
    );
    assert.ok(
      runtimeAnchorIDs.has(Number(sampleSite.anchor && sampleSite.anchor.itemID)),
      "expected active-session startup materialization to wake the gate anchor the player is sitting on",
    );
    assert.ok(
      runtimeAnchorIDs.size <= stargates.length,
      "expected active-session startup materialization to stay relevance-scoped rather than waking more anchors than exist",
    );
  } finally {
    process.env.EVEJS_SKIP_NPC_STARTUP = previousSkipStartup;
  }
});

test("generated Pochven station startup rules materialize native Trig presence on every station anchor in-system", () => {
  const generatedSites = npcData
    .listNpcSpawnSites()
    .filter((row) => String(row && row.spawnSiteID || "").startsWith("parity_trig_pochven_station_site_"));
  const sampleSite = generatedSites[0] || null;
  assert(sampleSite, "expected at least one generated Pochven station site");

  const targetSystemID = Number(sampleSite.systemID);
  touchedSystemIDs.add(targetSystemID);
  npcService.clearNpcControllersInSystem(targetSystemID, {
    entityType: "all",
    removeContents: true,
  });

  const stations = readStaticRows(REFERENCE_TABLE.STATIONS).filter((row) => (
    Number(row && row.solarSystemID) === targetSystemID
  ));
  assert.ok(stations.length > 0, "expected repo-owned stations in the target Pochven system");

  const previousSkipStartup = process.env.EVEJS_SKIP_NPC_STARTUP;
  delete process.env.EVEJS_SKIP_NPC_STARTUP;
  try {
    const startupResult = npcService.spawnStartupRulesForSystem(targetSystemID);
    assert.equal(startupResult && startupResult.success, true);

    const persistedControllers = nativeNpcStore.listNativeControllersForSystem(targetSystemID).filter((controller) => (
      /^parity_trig_pochven_(border|internal|home)_station_presence_startup$/.test(
        String(controller && controller.startupRuleID || ""),
      )
    ));
    assert.ok(
      persistedControllers.length > 0,
      "expected generated station startup rule to materialize persisted native Trig controllers",
    );

    const anchorIDs = new Set(
      persistedControllers
        .map((controller) => Number(controller && controller.anchorID) || 0)
        .filter((value) => value > 0),
    );
    assert.equal(
      anchorIDs.size,
      stations.length,
      "expected the generated Pochven station startup rule to cover every station anchor in the sampled system",
    );
  } finally {
    process.env.EVEJS_SKIP_NPC_STARTUP = previousSkipStartup;
  }
});

test("generated Pochven station startup rules wake into live runtime controllers when a player is present", () => {
  const generatedSites = npcData
    .listNpcSpawnSites()
    .filter((row) => String(row && row.spawnSiteID || "").startsWith("parity_trig_pochven_station_site_"));
  const sampleSite = generatedSites[0] || null;
  assert(sampleSite, "expected at least one generated Pochven station site");

  const targetSystemID = Number(sampleSite.systemID);
  touchedSystemIDs.add(targetSystemID);
  npcService.clearNpcControllersInSystem(targetSystemID, {
    entityType: "all",
    removeContents: true,
  });

  const stations = readStaticRows(REFERENCE_TABLE.STATIONS).filter((row) => (
    Number(row && row.solarSystemID) === targetSystemID
  ));
  assert.ok(stations.length > 0, "expected repo-owned stations in the target Pochven system");
  const relevantStation = stations.find((row) => (
    Number(row && row.stationID) === Number(sampleSite.anchor && sampleSite.anchor.itemID)
  )) || null;
  assert(relevantStation && relevantStation.position, "expected repo-owned station position for the sampled site");

  const session = registerAttachedSession(
    createFakeSession(
      989281,
      999281,
      relevantStation.position,
      { x: 1, y: 0, z: 0 },
      targetSystemID,
    ),
  );
  assert.equal(Number(session.solarsystemid), targetSystemID);

  const previousSkipStartup = process.env.EVEJS_SKIP_NPC_STARTUP;
  delete process.env.EVEJS_SKIP_NPC_STARTUP;
  try {
    const startupResult = npcService.spawnStartupRulesForSystem(targetSystemID);
    assert.equal(startupResult && startupResult.success, true);

    const persistedControllers = nativeNpcStore.listNativeControllersForSystem(targetSystemID).filter((controller) => (
      /^parity_trig_pochven_(border|internal|home)_station_presence_startup$/.test(
        String(controller && controller.startupRuleID || ""),
      )
    ));
    const persistedAnchorIDs = new Set(
      persistedControllers
        .map((controller) => Number(controller && controller.anchorID) || 0)
        .filter((value) => value > 0),
    );
    assert.equal(
      persistedAnchorIDs.size,
      stations.length,
      "expected active-session station startup handling to keep persisted coverage for every station anchor in the sampled system",
    );

    const runtimeControllers = npcService.getNpcOperatorSummary().filter((summary) => (
      Number(summary && summary.systemID) === targetSystemID &&
      /^parity_trig_pochven_(border|internal|home)_station_presence_startup$/.test(
        String(summary && summary.startupRuleID || ""),
      )
    ));
    assert.ok(
      runtimeControllers.length > 0,
      "expected generated station startup rule to materialize live runtime Trig controllers when a player is present",
    );

    const runtimeAnchorIDs = new Set(
      runtimeControllers
        .map((summary) => Number(summary && summary.anchorID) || 0)
        .filter((value) => value > 0),
    );
    assert.ok(
      runtimeAnchorIDs.has(Number(sampleSite.anchor && sampleSite.anchor.itemID)),
      "expected active-session station startup materialization to wake the station anchor the player is sitting on",
    );
    assert.ok(
      runtimeAnchorIDs.size <= stations.length,
      "expected active-session station startup materialization to stay relevance-scoped rather than waking more station anchors than exist",
    );
  } finally {
    process.env.EVEJS_SKIP_NPC_STARTUP = previousSkipStartup;
  }
});

test("generated Drifter known-space startup rules resolve through the shared npcData layer", () => {
  const observatorySystemIDs = trigDrifterSpawnAuthority.getSystemList(
    "knownSpaceJoveObservatorySystemIDs",
  );
  const wormholeSystemIDs = trigDrifterSpawnAuthority.getSystemList(
    "knownSpaceUnidentifiedWormholeSystemIDs",
  );
  const drifterSpaceSystemIDs = trigDrifterSpawnAuthority.getSystemList(
    "drifterSpaceSystemIDs",
  );
  const drifterSpaceSentinelSystemIDs = trigDrifterSpawnAuthority.getSystemList(
    "drifterSpaceSentinelSystemIDs",
  );
  const drifterSpaceBarbicanSystemIDs = trigDrifterSpawnAuthority.getSystemList(
    "drifterSpaceBarbicanSystemIDs",
  );
  const drifterSpaceVidetteSystemIDs = trigDrifterSpawnAuthority.getSystemList(
    "drifterSpaceVidetteSystemIDs",
  );
  const drifterSpaceConfluxSystemIDs = trigDrifterSpawnAuthority.getSystemList(
    "drifterSpaceConfluxSystemIDs",
  );
  const drifterSpaceRedoubtSystemIDs = trigDrifterSpawnAuthority.getSystemList(
    "drifterSpaceRedoubtSystemIDs",
  );

  assert.equal(observatorySystemIDs.length > 0, true);
  assert.equal(wormholeSystemIDs.length > 0, true);
  assert.equal(drifterSpaceSystemIDs.length, 5);
  assert.equal(drifterSpaceSentinelSystemIDs.length, 1);
  assert.equal(drifterSpaceBarbicanSystemIDs.length, 1);
  assert.equal(drifterSpaceVidetteSystemIDs.length, 1);
  assert.equal(drifterSpaceConfluxSystemIDs.length, 1);
  assert.equal(drifterSpaceRedoubtSystemIDs.length, 1);

  const observatoryRuleResolution = npcData.resolveNpcStartupRule(
    "parity_drifter_known_space_observatory_presence_startup",
  );
  assert.equal(observatoryRuleResolution && observatoryRuleResolution.success, true);
  assert.equal(
    String(observatoryRuleResolution.data.anchorSelector && observatoryRuleResolution.data.anchorSelector.kind),
    "signatureSite",
  );
  assert.equal(
    (observatoryRuleResolution.data.systemIDs || []).length,
    observatorySystemIDs.length,
  );
  assert.equal(
    String(observatoryRuleResolution.data.spawnGroupID || ""),
    "parity_drifter_lancer_solo",
  );
  assert.equal(
    Boolean(observatoryRuleResolution.data.behaviorOverrides && observatoryRuleResolution.data.behaviorOverrides.autoAggro),
    false,
    "expected observatory Lancers to stay defensive by default instead of the older always-aggressive baseline",
  );
  assert.equal(
    Number(
      observatoryRuleResolution.data.behaviorOverrides &&
      observatoryRuleResolution.data.behaviorOverrides.proximityAggroRangeMeters,
    ),
    60_000,
    "expected observatory startup to use proximity aggression rather than immediate auto-aggro",
  );

  const wormholeRuleResolution = npcData.resolveNpcStartupRule(
    "parity_drifter_known_space_wormhole_presence_startup",
  );
  assert.equal(wormholeRuleResolution && wormholeRuleResolution.success, true);
  assert.equal(
    String(wormholeRuleResolution.data.anchorSelector && wormholeRuleResolution.data.anchorSelector.kind),
    "signatureSite",
  );
  assert.equal(
    (wormholeRuleResolution.data.systemIDs || []).length,
    wormholeSystemIDs.length,
  );
  assert.equal(
    String(wormholeRuleResolution.data.spawnGroupID || ""),
    "parity_drifter_lancer_response_screen",
    "expected active unidentified wormholes to use the heavier Lancer-plus-response screen baseline",
  );
  assert.equal(
    Boolean(wormholeRuleResolution.data.behaviorOverrides && wormholeRuleResolution.data.behaviorOverrides.autoAggro),
    false,
  );
  assert.equal(
    Number(
      wormholeRuleResolution.data.behaviorOverrides &&
      wormholeRuleResolution.data.behaviorOverrides.proximityAggroRangeMeters,
    ),
    80_000,
  );

  const drifterHiveRuleResolution = npcData.resolveNpcStartupRule(
    "parity_drifter_space_hive_guard_startup",
  );
  assert.equal(drifterHiveRuleResolution && drifterHiveRuleResolution.success, true);
  assert.equal(
    String(drifterHiveRuleResolution.data.anchorSelector && drifterHiveRuleResolution.data.anchorSelector.kind),
    "signatureSite",
  );
  assert.equal(
    (drifterHiveRuleResolution.data.systemIDs || []).length,
    drifterSpaceSystemIDs.length,
  );
  assert.equal(
    String(drifterHiveRuleResolution.data.spawnGroupID || ""),
    "parity_drifter_hive_guard_screen",
  );
  assert.deepEqual(
    (drifterHiveRuleResolution.data.anchorSelector && drifterHiveRuleResolution.data.anchorSelector.labelIncludesAny || [])
      .map((entry) => String(entry || "").trim().toLowerCase())
      .sort(),
    [
      "barbican hive",
      "conflux hive",
      "redoubt hive",
      "sentinel hive",
      "vidette hive",
    ],
    "expected Drifter-space hive startup to cover the exact generated hive signatures in the five repo-owned Drifter systems",
  );
});

test("known-space Drifter observatory startup rules materialize persisted native Drifters on every generated observatory signature anchor", () => {
  const targetSystemID = Number(
    trigDrifterSpawnAuthority.getSystemList("knownSpaceJoveObservatorySystemIDs")[0] || 0,
  );
  assert.equal(targetSystemID > 0, true, "expected observatory authority system");

  touchedSystemIDs.add(targetSystemID);
  npcService.clearNpcControllersInSystem(targetSystemID, {
    entityType: "all",
    removeContents: true,
  });
  spaceRuntime._testing.clearScenes();

  const reconcileSummary = dungeonUniverseRuntime.reconcileUniversePersistentSites({
    systemIDs: [targetSystemID],
    families: ["drifter_observatory"],
    includeMining: false,
    nowMs: 7100,
  });
  assert.equal(reconcileSummary.desiredSiteCount > 0, true);

  const previousSkipStartup = process.env.EVEJS_SKIP_NPC_STARTUP;
  delete process.env.EVEJS_SKIP_NPC_STARTUP;
  try {
    const scene = spaceRuntime.ensureScene(targetSystemID);
    assert(scene, "expected known-space Drifter startup scene");

    const observatoryAnchors = listSceneSignatureAnchors(scene, "jove observatory");
    assert.equal(
      observatoryAnchors.length > 0,
      true,
      "expected generated observatory signature anchors in the startup scene",
    );

    const persistedControllers = nativeNpcStore.listNativeControllersForSystem(targetSystemID).filter((controller) => (
      String(controller && controller.startupRuleID || "").trim() ===
        "parity_drifter_known_space_observatory_presence_startup"
    ));
    assert.equal(
      persistedControllers.length > 0,
      true,
      "expected post-site startup sweep to materialize persisted Drifter observatory controllers",
    );

    const anchorIDs = new Set(
      persistedControllers
        .map((controller) => Number(controller && controller.anchorID) || 0)
        .filter((value) => value > 0),
    );
    assert.equal(
      anchorIDs.size,
      observatoryAnchors.length,
      "expected Drifter observatory startup to cover every generated observatory signature anchor in-system",
    );
  } finally {
    process.env.EVEJS_SKIP_NPC_STARTUP = previousSkipStartup;
  }
});

test("known-space Drifter wormhole startup rules wake live runtime controllers when a player lands on a generated unidentified wormhole anchor", () => {
  const targetSystemID = Number(
    trigDrifterSpawnAuthority.getSystemList("knownSpaceUnidentifiedWormholeSystemIDs")[0] || 0,
  );
  assert.equal(targetSystemID > 0, true, "expected unidentified wormhole authority system");

  touchedSystemIDs.add(targetSystemID);
  npcService.clearNpcControllersInSystem(targetSystemID, {
    entityType: "all",
    removeContents: true,
  });
  spaceRuntime._testing.clearScenes();

  const definitions = dungeonUniverseRuntime.listDesiredUniverseDungeonSiteDefinitions(
    [targetSystemID],
    7200,
    { families: ["drifter_unidentified_wormhole"] },
  );
  assert.equal(definitions.definitions.length > 0, true);
  const relevantDefinition = definitions.definitions.find((definition) => (
    String(definition && definition.metadata && definition.metadata.label || "")
      .trim()
      .toLowerCase()
      .includes("unidentified wormhole")
  )) || definitions.definitions[0] || null;
  assert(relevantDefinition && relevantDefinition.position, "expected generated unidentified wormhole definition");

  const reconcileSummary = dungeonUniverseRuntime.reconcileUniversePersistentSites({
    systemIDs: [targetSystemID],
    families: ["drifter_unidentified_wormhole"],
    includeMining: false,
    nowMs: 7200,
  });
  assert.equal(reconcileSummary.desiredSiteCount > 0, true);

  const previousSkipStartup = process.env.EVEJS_SKIP_NPC_STARTUP;
  delete process.env.EVEJS_SKIP_NPC_STARTUP;
  try {
    const session = registerAttachedSession(
      createFakeSession(
        989291,
        999291,
        relevantDefinition.position,
        { x: 1, y: 0, z: 0 },
        targetSystemID,
      ),
    );
    assert.equal(Number(session.solarsystemid), targetSystemID);

    const scene = spaceRuntime.getSceneForSession(session);
    assert(scene, "expected active session scene for Drifter wormhole startup");
    const wormholeAnchors = listSceneSignatureAnchors(scene, "unidentified wormhole");
    assert.equal(wormholeAnchors.length > 0, true);

    const persistedControllers = nativeNpcStore.listNativeControllersForSystem(targetSystemID).filter((controller) => (
      String(controller && controller.startupRuleID || "").trim() ===
        "parity_drifter_known_space_wormhole_presence_startup"
    ));
    assert.equal(
      persistedControllers.length > 0,
      true,
      "expected post-site startup sweep to keep persisted Drifter wormhole coverage in-system",
    );

    const runtimeControllers = npcService.getNpcOperatorSummary().filter((summary) => (
      Number(summary && summary.systemID) === targetSystemID &&
      String(summary && summary.startupRuleID || "").trim() ===
        "parity_drifter_known_space_wormhole_presence_startup"
    ));
    assert.equal(
      runtimeControllers.length > 0,
      true,
      "expected generated Drifter wormhole startup to wake live runtime controllers for an active player",
    );

    const runtimeAnchorIDs = new Set(
      runtimeControllers
        .map((summary) => Number(summary && summary.anchorID) || 0)
        .filter((value) => value > 0),
    );
    assert.equal(
      runtimeAnchorIDs.size <= wormholeAnchors.length,
      true,
      "expected active-session Drifter startup materialization to stay relevance-scoped",
    );
    assert.equal(
      runtimeAnchorIDs.has(Number(wormholeAnchors[0] && wormholeAnchors[0].itemID)),
      true,
      "expected active-session Drifter startup materialization to wake the signature anchor the player lands on",
    );
  } finally {
    process.env.EVEJS_SKIP_NPC_STARTUP = previousSkipStartup;
  }
});

test("Drifter-space hive startup rules wake live runtime controllers when a player lands on a generated hive anchor", () => {
  const targetSystemID = Number(
    trigDrifterSpawnAuthority.getSystemList("drifterSpaceSentinelSystemIDs")[0] || 0,
  );
  assert.equal(targetSystemID > 0, true, "expected Drifter-space hive authority system");

  touchedSystemIDs.add(targetSystemID);
  npcService.clearNpcControllersInSystem(targetSystemID, {
    entityType: "all",
    removeContents: true,
  });
  spaceRuntime._testing.clearScenes();

  const definitions = dungeonUniverseRuntime.listDesiredUniverseDungeonSiteDefinitions(
    [targetSystemID],
    7300,
    { families: ["drifter_space_sentinel_hive"] },
  );
  assert.equal(definitions.definitions.length > 0, true);
  const relevantDefinition = definitions.definitions.find((definition) => (
    String(definition && definition.metadata && definition.metadata.label || "")
      .trim()
      .toLowerCase()
      .includes("sentinel hive")
  )) || definitions.definitions[0] || null;
  assert(relevantDefinition && relevantDefinition.position, "expected generated Sentinel hive definition");

  const reconcileSummary = dungeonUniverseRuntime.reconcileUniversePersistentSites({
    systemIDs: [targetSystemID],
    families: ["drifter_space_sentinel_hive"],
    includeMining: false,
    nowMs: 7300,
  });
  assert.equal(reconcileSummary.desiredSiteCount > 0, true);

  const previousSkipStartup = process.env.EVEJS_SKIP_NPC_STARTUP;
  delete process.env.EVEJS_SKIP_NPC_STARTUP;
  try {
    const session = registerAttachedSession(
      createFakeSession(
        989292,
        999292,
        relevantDefinition.position,
        { x: 1, y: 0, z: 0 },
        targetSystemID,
      ),
    );
    assert.equal(Number(session.solarsystemid), targetSystemID);

    const scene = spaceRuntime.getSceneForSession(session);
    assert(scene, "expected active session scene for Drifter-space hive startup");
    const hiveAnchors = listSceneSignatureAnchors(scene, "sentinel hive");
    assert.equal(hiveAnchors.length > 0, true);

    const persistedControllers = nativeNpcStore.listNativeControllersForSystem(targetSystemID).filter((controller) => (
      String(controller && controller.startupRuleID || "").trim() ===
        "parity_drifter_space_hive_guard_startup"
    ));
    assert.equal(
      persistedControllers.length > 0,
      true,
      "expected post-site startup sweep to keep persisted Drifter hive coverage in-system",
    );

    const runtimeControllers = npcService.getNpcOperatorSummary().filter((summary) => (
      Number(summary && summary.systemID) === targetSystemID &&
      String(summary && summary.startupRuleID || "").trim() ===
        "parity_drifter_space_hive_guard_startup"
    ));
    assert.equal(
      runtimeControllers.length > 0,
      true,
      "expected generated Drifter-space hive startup to wake live runtime controllers for an active player",
    );

    const runtimeAnchorIDs = new Set(
      runtimeControllers
        .map((summary) => Number(summary && summary.anchorID) || 0)
        .filter((value) => value > 0),
    );
    assert.equal(
      runtimeAnchorIDs.size <= hiveAnchors.length,
      true,
      "expected active-session Drifter-space hive startup to stay relevance-scoped",
    );
    assert.equal(
      runtimeAnchorIDs.has(Number(hiveAnchors[0] && hiveAnchors[0].itemID)),
      true,
      "expected active-session Drifter-space hive startup to wake the hive anchor the player lands on",
    );
  } finally {
    process.env.EVEJS_SKIP_NPC_STARTUP = previousSkipStartup;
  }
});

test("repo-owned Drifter occupation site families resolve into the intended Drifter-space and Tabbetzur systems", () => {
  const drifterSpaceSystemIDs = trigDrifterSpawnAuthority.getSystemList("drifterSpaceSystemIDs");
  const tabbetzurSystemID = Number(
    trigDrifterSpawnAuthority.getSystemList("tabbetzurSystemIDs")[0] || 0,
  );
  assert.equal(
    drifterSpaceSystemIDs.includes(tabbetzurSystemID),
    false,
    "expected Tabbetzur to stay outside the base Drifter-space system authority list",
  );

  const drifterSpaceDefinitions = dungeonUniverseRuntime.listDesiredUniverseDungeonSiteDefinitions(
    [Number(drifterSpaceSystemIDs[0] || 0)],
    7400,
    {
      families: [
        "drifter_space_reckoning_labyrinth",
        "drifter_space_reckoning_nexus",
      ],
    },
  );
  const drifterLabels = new Set(
    drifterSpaceDefinitions.definitions
      .map((definition) => String(definition && definition.metadata && definition.metadata.label || "").trim())
      .filter(Boolean),
  );
  assert.equal(
    drifterLabels.has("Reckoning: Labyrinth Complex"),
    true,
    "expected occupied Drifter-space systems to expose Reckoning: Labyrinth Complex through repo-owned universe-site authority",
  );
  assert.equal(
    drifterLabels.has("Reckoning: Nexus Point"),
    true,
    "expected occupied Drifter-space systems to expose Reckoning: Nexus Point through repo-owned universe-site authority",
  );

  const tabbetzurDefinitions = dungeonUniverseRuntime.listDesiredUniverseDungeonSiteDefinitions(
    [tabbetzurSystemID],
    7400,
    {
      families: [
        "drifter_occupied_tabbetzur_field_rescue",
        "drifter_occupied_tabbetzur_deathless_research_outpost",
      ],
    },
  );
  const tabbetzurLabels = new Set(
    tabbetzurDefinitions.definitions
      .map((definition) => String(definition && definition.metadata && definition.metadata.label || "").trim())
      .filter(Boolean),
  );
  assert.equal(
    tabbetzurLabels.has("Crisis: Field Rescue"),
    true,
    "expected Tabbetzur to expose the continuing Crisis: Field Rescue site through repo-owned universe-site authority",
  );
  assert.equal(
    tabbetzurLabels.has("Crisis: Deathless Research Outpost"),
    true,
    "expected Tabbetzur to expose the continuing Crisis: Deathless Research Outpost site through repo-owned universe-site authority",
  );
});

test("current persistent Drifter crisis site families stay in their intended live topology", () => {
  const solarSystems = readStaticRows(REFERENCE_TABLE.SOLAR_SYSTEMS);
  const pochvenSystemIDs = trigDrifterSpawnAuthority.getSystemList("pochvenSystemIDs");
  const drifterSpaceSystemIDs = trigDrifterSpawnAuthority.getSystemList("drifterSpaceSystemIDs");
  const highsecSystemIDs = solarSystems
    .filter((row) => {
      const systemID = Number(row && row.solarSystemID) || 0;
      const security = Number((row && (row.securityStatus ?? row.security)) || 0);
      return systemID > 0 && systemID < 31_000_000 && security >= 0.45;
    })
    .map((row) => Number(row && row.solarSystemID) || 0)
    .filter((value) => value > 0);
  const lowsecSystemIDs = solarSystems
    .filter((row) => {
      const systemID = Number(row && row.solarSystemID) || 0;
      const security = Number((row && (row.securityStatus ?? row.security)) || 0);
      return systemID > 0 && systemID < 31_000_000 && security >= 0 && security < 0.45;
    })
    .map((row) => Number(row && row.solarSystemID) || 0)
    .filter((value) => value > 0);
  const nullsecSystemIDs = solarSystems
    .filter((row) => {
      const systemID = Number(row && row.solarSystemID) || 0;
      const security = Number((row && (row.securityStatus ?? row.security)) || 0);
      return systemID > 0 && systemID < 31_000_000 && security < 0;
    })
    .map((row) => Number(row && row.solarSystemID) || 0)
    .filter((value) => value > 0);

  function firstSystemWithLabel(systemIDs, family, label) {
    for (const systemID of systemIDs) {
      const definitions = dungeonUniverseRuntime.listDesiredUniverseDungeonSiteDefinitions(
        [systemID],
        7500,
        { families: [family] },
      );
      if (definitions.definitions.some((definition) => (
        String(definition && definition.metadata && definition.metadata.label || "").trim() === label
      ))) {
        return systemID;
      }
    }
    return 0;
  }

  const vigilancePochvenSystemID = firstSystemWithLabel(
    pochvenSystemIDs,
    "drifter_vigilance_point",
    "Vigilance Point",
  );
  assert.equal(
    vigilancePochvenSystemID > 0,
    true,
    "expected Vigilance Point to resolve somewhere in Pochven through repo-owned universe-site authority",
  );

  const observatoryLowsecSystemID = firstSystemWithLabel(
    lowsecSystemIDs,
    "drifter_observatory_infiltration",
    "Observatory Infiltration",
  );
  assert.equal(
    observatoryLowsecSystemID > 0,
    true,
    "expected Observatory Infiltration to resolve somewhere in low-security empire space through repo-owned universe-site authority",
  );
  const observatoryPochvenSystemID = firstSystemWithLabel(
    pochvenSystemIDs,
    "drifter_observatory_infiltration",
    "Observatory Infiltration",
  );
  assert.equal(
    observatoryPochvenSystemID > 0,
    true,
    "expected Observatory Infiltration to resolve somewhere in Pochven through repo-owned universe-site authority",
  );

  const deepflowHighsecSystemID = firstSystemWithLabel(
    highsecSystemIDs,
    "drifter_deepflow_rift_knownspace",
    "Deepflow Rift",
  );
  assert.equal(
    deepflowHighsecSystemID > 0,
    true,
    "expected Deepflow Rift to resolve somewhere in high-security known space through repo-owned universe-site authority",
  );
  const deepflowLowsecSystemID = firstSystemWithLabel(
    lowsecSystemIDs,
    "drifter_deepflow_rift_knownspace",
    "Deepflow Rift",
  );
  assert.equal(
    deepflowLowsecSystemID > 0,
    true,
    "expected Deepflow Rift to resolve somewhere in low-security known space through repo-owned universe-site authority",
  );
  const deepflowNullsecSystemID = firstSystemWithLabel(
    nullsecSystemIDs,
    "drifter_deepflow_rift_knownspace",
    "Deepflow Rift",
  );
  assert.equal(
    deepflowNullsecSystemID > 0,
    true,
    "expected Deepflow Rift to resolve somewhere in null-security known space through repo-owned universe-site authority",
  );
  const deepflowPochvenSystemID = firstSystemWithLabel(
    pochvenSystemIDs,
    "drifter_deepflow_rift_pochven",
    "Deepflow Rift",
  );
  assert.equal(
    deepflowPochvenSystemID > 0,
    true,
    "expected Deepflow Rift to resolve somewhere in Pochven through the Pochven-scoped live family",
  );

  const deepflowKnownspaceInPochven = dungeonUniverseRuntime.listDesiredUniverseDungeonSiteDefinitions(
    [Number(pochvenSystemIDs[0] || 0)],
    7500,
    { families: ["drifter_deepflow_rift_knownspace"] },
  );
  assert.equal(
    deepflowKnownspaceInPochven.definitions.some((definition) => (
      String(definition && definition.metadata && definition.metadata.label || "").trim() === "Deepflow Rift"
    )),
    false,
    "expected the known-space Deepflow family to exclude Pochven so the higher-frequency Pochven family stays authoritative",
  );

  const deepflowInDrifterSpace = dungeonUniverseRuntime.listDesiredUniverseDungeonSiteDefinitions(
    [Number(drifterSpaceSystemIDs[0] || 0)],
    7500,
    { families: ["drifter_deepflow_rift_knownspace"] },
  );
  assert.equal(
    deepflowInDrifterSpace.definitions.some((definition) => (
      String(definition && definition.metadata && definition.metadata.label || "").trim() === "Deepflow Rift"
    )),
    false,
    "expected the current live Deepflow family to stay out of Drifter-space after the repo-authored wormhole exclusion",
  );

  const genericCombatLeak = dungeonUniverseRuntime.listDesiredUniverseDungeonSiteDefinitions(
    [deepflowHighsecSystemID, vigilancePochvenSystemID],
    7500,
    { families: ["combat"] },
  );
  const genericCombatLabels = new Set(
    genericCombatLeak.definitions
      .map((definition) => String(definition && definition.metadata && definition.metadata.label || "").trim())
      .filter(Boolean),
  );
  assert.equal(
    genericCombatLabels.has("Deepflow Rift"),
    false,
    "expected Deepflow Rift to resolve only through its explicit live family instead of leaking through the generic combat pool",
  );
  assert.equal(
    genericCombatLabels.has("Vigilance Point"),
    false,
    "expected Vigilance Point to resolve only through its explicit live family instead of leaking through the generic combat pool",
  );

  const genericRelicLeak = dungeonUniverseRuntime.listDesiredUniverseDungeonSiteDefinitions(
    [observatoryLowsecSystemID],
    7500,
    { families: ["relic"] },
  );
  const genericRelicLabels = new Set(
    genericRelicLeak.definitions
      .map((definition) => String(definition && definition.metadata && definition.metadata.label || "").trim())
      .filter(Boolean),
  );
  assert.equal(
    genericRelicLabels.has("Observatory Infiltration"),
    false,
    "expected Observatory Infiltration to resolve only through its explicit live family instead of leaking through the generic relic pool",
  );
});
