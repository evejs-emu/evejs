const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const config = require(path.join(repoRoot, "server/src/config"));
const {
  TABLE,
  readStaticRows,
} = require(path.join(
  repoRoot,
  "server/src/services/_shared/referenceData",
));
const dungeonRuntime = require(path.join(
  repoRoot,
  "server/src/services/dungeon/dungeonRuntime",
));
const dungeonRuntimeState = require(path.join(
  repoRoot,
  "server/src/services/dungeon/dungeonRuntimeState",
));
const dungeonUniverseRuntime = require(path.join(
  repoRoot,
  "server/src/services/dungeon/dungeonUniverseRuntime",
));
const dungeonAuthority = require(path.join(
  repoRoot,
  "server/src/services/dungeon/dungeonAuthority",
));
const miningResourceSiteService = require(path.join(
  repoRoot,
  "server/src/services/mining/miningResourceSiteService",
));
const {
  getMineableState,
} = require(path.join(
  repoRoot,
  "server/src/services/mining/miningRuntimeState",
));
const miningAnomalyProvider = require(path.join(
  repoRoot,
  "server/src/services/exploration/signatures/providers/miningAnomalyProvider",
));
const {
  listContainerItems,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const sceneAnomalySiteProvider = require(path.join(
  repoRoot,
  "server/src/services/exploration/signatures/providers/sceneAnomalySiteProvider",
));
const sceneSignatureSiteProvider = require(path.join(
  repoRoot,
  "server/src/services/exploration/signatures/providers/sceneSignatureSiteProvider",
));
const dungeonUniverseSiteService = require(path.join(
  repoRoot,
  "server/src/services/dungeon/dungeonUniverseSiteService",
));
const npcService = require(path.join(
  repoRoot,
  "server/src/space/npc/npcService",
));
const {
  resolveNpcSpawnPlan,
} = require(path.join(
  repoRoot,
  "server/src/space/npc/npcSelection",
));
const {
  applyCharacterToSession,
  getActiveShipRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  DEFAULT_AU_METERS,
} = require(path.join(
  repoRoot,
  "server/src/services/exploration/signatures/signaturePlacement",
));
const spaceRuntime = require(path.join(
  repoRoot,
  "server/src/space/runtime",
));

const SNAPSHOT_TABLES = [
  "dungeonRuntimeState",
  "miningRuntimeState",
  "items",
];

function readTable(tableName) {
  const result = database.read(tableName, "/");
  return result && result.success
    ? JSON.parse(JSON.stringify(result.data))
    : {};
}

function writeTable(tableName, payload) {
  const result = database.write(tableName, "/", payload);
  assert.equal(result.success, true, `Failed to restore ${tableName}`);
}

function pickAsteroidBeltSystem() {
  const belts = readStaticRows(TABLE.ASTEROID_BELTS);
  assert.ok(belts.length > 0, "expected asteroid belt rows");
  const firstBelt = belts[0];
  const systemID = Number(firstBelt && firstBelt.solarSystemID) || 0;
  assert.ok(systemID > 0, "expected asteroid belt system ID");
  return systemID;
}

function pickSystemsByBand() {
  const systems = readStaticRows(TABLE.SOLAR_SYSTEMS);
  const picked = {
    highsec: null,
    lowsec: null,
    nullsec: null,
    wormhole: null,
  };
  for (const system of systems) {
    const systemID = Number(system && system.solarSystemID) || 0;
    if (systemID <= 0) {
      continue;
    }
    const securityStatus = Number(system && (system.securityStatus ?? system.security)) || 0;
    const band = systemID >= 31_000_000 && systemID <= 31_999_999
      ? "wormhole"
      : securityStatus >= 0.45
        ? "highsec"
        : securityStatus >= 0
          ? "lowsec"
          : "nullsec";
    if (!picked[band]) {
      picked[band] = systemID;
    }
    if (picked.highsec && picked.lowsec && picked.nullsec && picked.wormhole) {
      break;
    }
  }
  return picked;
}

function countSystemsByBand() {
  const systems = readStaticRows(TABLE.SOLAR_SYSTEMS);
  const counts = {
    highsec: 0,
    lowsec: 0,
    nullsec: 0,
    wormhole: 0,
  };
  for (const system of systems) {
    const systemID = Number(system && system.solarSystemID) || 0;
    if (systemID <= 0) {
      continue;
    }
    const securityStatus = Number(system && (system.securityStatus ?? system.security)) || 0;
    const band = systemID >= 31_000_000 && systemID <= 31_999_999
      ? "wormhole"
      : securityStatus >= 0.45
        ? "highsec"
        : securityStatus >= 0
          ? "lowsec"
          : "nullsec";
    counts[band] += 1;
  }
  return counts;
}

function pickUniverseSeededSystemsByBand() {
  const systems = readStaticRows(TABLE.SOLAR_SYSTEMS);
  const picked = {
    highsec: null,
    lowsec: null,
    nullsec: null,
    wormhole: null,
  };
  const families = ["combat", "combat_anomaly", "data", "relic", "ore", "gas", "ghost", "combat_hacking"];
  for (const system of systems) {
    const systemID = Number(system && system.solarSystemID) || 0;
    if (systemID <= 0) {
      continue;
    }
    const securityStatus = Number(system && (system.securityStatus ?? system.security)) || 0;
    const band = systemID >= 31_000_000 && systemID <= 31_999_999
      ? "wormhole"
      : securityStatus >= 0.45
        ? "highsec"
        : securityStatus >= 0
          ? "lowsec"
          : "nullsec";
    if (picked[band]) {
      continue;
    }
    const seeded = families.some((family) => {
      const profile = dungeonAuthority.getSpawnProfile(family);
      const bandProfile = profile && profile.bands && profile.bands[band];
      return !!bandProfile && dungeonUniverseRuntime._testing.systemMatchesSpawnBandProfile(
        systemID,
        family,
        bandProfile,
      );
    });
    if (seeded) {
      picked[band] = systemID;
    }
    if (picked.highsec && picked.lowsec && picked.nullsec && picked.wormhole) {
      break;
    }
  }
  return picked;
}

function pickUniverseSeededSystemsForFamily(family) {
  const profile = dungeonAuthority.getSpawnProfile(family);
  assert.ok(profile && profile.bands, `expected ${family} spawn profile`);
  return ["highsec", "lowsec", "nullsec", "wormhole"]
    .flatMap((band) => {
      const bandProfile = profile.bands[band];
      return dungeonUniverseRuntime._testing.listEligibleSystemIDsForBandProfile(
        family,
        band,
        bandProfile,
      ).slice(0, 1);
    })
    .filter((systemID) => Number(systemID) > 0);
}

function pickGasSeedSystem() {
  const profile = dungeonAuthority.getSpawnProfile("gas");
  assert.ok(profile && profile.bands, "expected gas spawn profile");
  const systems = readStaticRows(TABLE.SOLAR_SYSTEMS);
  const preferredBands = ["lowsec", "nullsec", "wormhole"];
  for (const system of systems) {
    const systemID = Number(system && system.solarSystemID) || 0;
    if (systemID <= 0) {
      continue;
    }
    const securityStatus = Number(system && (system.securityStatus ?? system.security)) || 0;
    const band = systemID >= 31_000_000 && systemID <= 31_999_999
      ? "wormhole"
      : securityStatus >= 0.45
        ? "highsec"
        : securityStatus >= 0
          ? "lowsec"
          : "nullsec";
    if (!preferredBands.includes(band)) {
      continue;
    }
    const bandProfile = profile.bands[band];
    if (dungeonUniverseRuntime._testing.systemMatchesSpawnBandProfile(systemID, "gas", bandProfile)) {
      return systemID;
    }
  }
  assert.fail("expected at least one universe-seeded gas signature system");
}

function findClientTemplate(predicate, description) {
  const payload = dungeonAuthority.getPayload();
  for (const template of Object.values(payload.templatesByID || {})) {
    if (template && template.source === "client" && predicate(template)) {
      return template;
    }
  }
  assert.fail(`expected client dungeon template for ${description}`);
}

function findMissionTemplate(predicate, description) {
  const payload = dungeonAuthority.getPayload();
  for (const template of Object.values(payload.templatesByID || {})) {
    if (template && String(template.siteFamily || "") === "mission" && predicate(template)) {
      return template;
    }
  }
  assert.fail(`expected mission dungeon template for ${description}`);
}

function withSnapshots(fn) {
  return async () => {
    const snapshots = Object.fromEntries(
      SNAPSHOT_TABLES.map((tableName) => [tableName, readTable(tableName)]),
    );
    const configSnapshot = {
      miningGeneratedIceSitesEnabled: config.miningGeneratedIceSitesEnabled,
      miningGeneratedIceSiteLifetimeMinutes: config.miningGeneratedIceSiteLifetimeMinutes,
      miningGeneratedGasSitesEnabled: config.miningGeneratedGasSitesEnabled,
      miningIceSitesHighSecPerSystem: config.miningIceSitesHighSecPerSystem,
      miningIceSitesLowSecPerSystem: config.miningIceSitesLowSecPerSystem,
      miningIceSitesNullSecPerSystem: config.miningIceSitesNullSecPerSystem,
      miningIceSitesWormholePerSystem: config.miningIceSitesWormholePerSystem,
      miningIceTargetSystemsHighSec: config.miningIceTargetSystemsHighSec,
      miningIceTargetSystemsLowSec: config.miningIceTargetSystemsLowSec,
      miningIceTargetSystemsNullSec: config.miningIceTargetSystemsNullSec,
      miningIceTargetSystemsWormhole: config.miningIceTargetSystemsWormhole,
      miningGasSitesHighSecPerSystem: config.miningGasSitesHighSecPerSystem,
      miningGasSitesLowSecPerSystem: config.miningGasSitesLowSecPerSystem,
      miningGasSitesNullSecPerSystem: config.miningGasSitesNullSecPerSystem,
      miningGasSitesWormholePerSystem: config.miningGasSitesWormholePerSystem,
    };

    try {
      Object.assign(config, {
        miningGeneratedIceSitesEnabled: true,
        miningGeneratedIceSiteLifetimeMinutes: 60,
        miningGeneratedGasSitesEnabled: true,
        miningIceSitesHighSecPerSystem: 1,
        miningIceSitesLowSecPerSystem: 1,
        miningIceSitesNullSecPerSystem: 1,
        miningIceSitesWormholePerSystem: 0,
        miningIceTargetSystemsHighSec: 999999,
        miningIceTargetSystemsLowSec: 999999,
        miningIceTargetSystemsNullSec: 999999,
        miningIceTargetSystemsWormhole: 0,
        miningGasSitesHighSecPerSystem: 1,
        miningGasSitesLowSecPerSystem: 1,
        miningGasSitesNullSecPerSystem: 1,
        miningGasSitesWormholePerSystem: 1,
      });
      dungeonRuntime.resetRuntimeForTests();
      dungeonRuntime.clearRuntimeCache();
      spaceRuntime._testing.clearScenes();
      await fn();
    } finally {
      Object.assign(config, configSnapshot);
      for (const [tableName, payload] of Object.entries(snapshots)) {
        writeTable(tableName, payload);
      }
      dungeonRuntime.clearRuntimeCache();
      spaceRuntime._testing.clearScenes();
    }
  };
}

test("startup dungeon universe reconcile seeds stable generated mining and broad persistent site instances without loading scenes", withSnapshots(() => {
  const systemID = pickAsteroidBeltSystem();

  const summary = dungeonUniverseRuntime.reconcileUniversePersistentSites({
    systemIDs: [systemID],
    nowMs: 1111,
  });
  assert.equal(summary.systemCount, 1);
  assert.equal(summary.desiredSiteCount > 0, true);
  assert.equal(summary.createdInstances, summary.desiredSiteCount);

  const firstPassInstances = dungeonRuntime.listActiveInstancesBySystem(systemID, {
    full: true,
  });
  assert.equal(firstPassInstances.length, summary.desiredSiteCount);
  const miningInstances = firstPassInstances.filter((instance) => (
    String(instance.siteOrigin || "").trim().toLowerCase() === "generatedmining"
  ));
  const broadInstances = firstPassInstances.filter((instance) => (
    String(instance.siteOrigin || "").trim().toLowerCase() !== "generatedmining"
  ));
  const expectedBroadCount = Object.values(summary.families || {})
    .reduce((sum, familySummary) => sum + Number(familySummary && familySummary.desiredSiteCount || 0), 0);
  assert.equal(miningInstances.length, Number(summary.mining && summary.mining.desiredSiteCount || 0));
  assert.equal(broadInstances.length, expectedBroadCount);
  assert.equal(
    miningInstances.every((instance) => (
      String(instance.siteOrigin || "").trim().toLowerCase() === "generatedmining" &&
      instance.runtimeFlags &&
      instance.runtimeFlags.universeSeeded === true &&
      instance.runtimeFlags.universePersistent === true &&
      Number(instance.timers && instance.timers.expiresAtMs || 0) > Number(instance.timers && instance.timers.activatedAtMs || 0) &&
      Array.isArray(instance.spawnState && instance.spawnState.members) &&
      instance.spawnState.members.length > 0
    )),
    true,
  );
  assert.equal(
    broadInstances.every((instance) => (
      instance.runtimeFlags &&
      instance.runtimeFlags.universePersistent === true &&
      instance.runtimeFlags.universeSeeded === true &&
      instance.roomStatesByKey &&
      instance.roomStatesByKey["room:entry"] &&
      Object.keys(instance.gateStatesByKey || {}).length === 0
    )),
    true,
  );

  const persistedStateResult = database.read(
    "miningRuntimeState",
    `/systems/${String(systemID)}/entities`,
  );
  assert.equal(persistedStateResult.success, true);
  const persistedEntities = Object.values(persistedStateResult.data || {});
  assert.equal(persistedEntities.length > 0, true);
  assert.equal(
    persistedEntities.some((entry) => (
      miningResourceSiteService.resolveGeneratedMiningEntityDescriptor(entry && entry.entityID)
    )),
    true,
  );

  const secondSummary = dungeonUniverseRuntime.reconcileUniversePersistentSites({
    systemIDs: [systemID],
    nowMs: 2222,
  });
  assert.equal(secondSummary.createdInstances, 0);
  assert.equal(secondSummary.replacedInstances, 0);
  assert.equal(secondSummary.removedInstances, 0);
  assert.equal(secondSummary.retainedInstances, summary.desiredSiteCount);
}));

test("scene startup materializes seeded mining and broad persistent dungeon sites from runtime-backed universe state", withSnapshots(() => {
  const systemID = pickAsteroidBeltSystem();
  const summary = dungeonUniverseRuntime.reconcileUniversePersistentSites({
    systemIDs: [systemID],
    nowMs: 3333,
  });
  assert.equal(summary.desiredSiteCount > 0, true);

  const seededInstances = dungeonRuntime.listActiveInstancesBySystem(systemID, {
    full: true,
  });
  const seededMiningInstances = seededInstances.filter((instance) => (
    String(instance.siteOrigin || "").trim().toLowerCase() === "generatedmining"
  ));
  const seededBroadInstances = seededInstances.filter((instance) => (
    String(instance.siteOrigin || "").trim().toLowerCase() !== "generatedmining"
  ));
  const seededMiningSiteIDs = new Set(
    seededMiningInstances.map((instance) => Number(instance.metadata && instance.metadata.siteID)),
  );
  const seededBroadSiteIDs = new Set(
    seededBroadInstances.map((instance) => Number(instance.metadata && instance.metadata.siteID)),
  );

  const scene = spaceRuntime.ensureScene(systemID);
  const generatedAnchors = miningResourceSiteService._testing
    .listGeneratedResourceSiteEntities(scene)
    .filter((entity) => entity && entity.generatedMiningSiteAnchor === true);
  const materializedBroadSites = dungeonUniverseSiteService
    .listMaterializedUniverseSiteEntities(scene);
  assert.equal(generatedAnchors.length, seededMiningInstances.length);
  assert.equal(materializedBroadSites.length, seededBroadInstances.length);
  assert.deepEqual(
    generatedAnchors.map((entity) => Number(entity.itemID)).sort((left, right) => left - right),
    [...seededMiningSiteIDs].sort((left, right) => left - right),
  );
  assert.deepEqual(
    materializedBroadSites.map((entity) => Number(entity.itemID)).sort((left, right) => left - right),
    [...seededBroadSiteIDs].sort((left, right) => left - right),
  );

  const providerSites = miningAnomalyProvider.listAnomalySites(systemID, { scene });
  const broadAnomalySites = sceneAnomalySiteProvider.listAnomalySites(systemID, { scene });
  const broadSignatureSites = sceneSignatureSiteProvider.listSignatureSites(systemID, { scene });
  assert.equal(providerSites.length, seededMiningInstances.length);
  assert.equal(
    broadAnomalySites.length + broadSignatureSites.length,
    seededBroadInstances.length,
  );
  assert.equal(
    providerSites.every((site) => seededMiningSiteIDs.has(Number(site.siteID))),
    true,
  );
  assert.equal(
    providerSites.every((site) => Number(site.instanceID) > 0 && Number(site.dungeonID) > 0),
    true,
  );
  assert.equal(
    [...broadAnomalySites, ...broadSignatureSites].every((site) => (
      seededBroadSiteIDs.has(Number(site.siteID)) &&
      Number(site.instanceID) > 0 &&
      Number(site.dungeonID) > 0
    )),
    true,
  );
}));

test("gas sites are seeded as signatures through dungeon authority and materialize mineable gas clouds without mining anomalies", withSnapshots(() => {
  const systemID = pickGasSeedSystem();
  const summary = dungeonUniverseRuntime.reconcileUniversePersistentSites({
    systemIDs: [systemID],
    nowMs: 3456,
  });
  assert.equal(summary.desiredSiteCount > 0, true);

  const seededInstances = dungeonRuntime.listActiveInstancesBySystem(systemID, {
    full: true,
  });
  const gasInstances = seededInstances.filter((instance) => (
    String(instance.siteOrigin || "").trim().toLowerCase() !== "generatedmining" &&
    String(instance.siteFamily || "").trim().toLowerCase() === "gas" &&
    String(instance.siteKind || "").trim().toLowerCase() === "signature"
  ));
  assert.equal(gasInstances.length > 0, true);

  const scene = spaceRuntime.ensureScene(systemID);
  const generatedMiningEntities = miningResourceSiteService._testing
    .listGeneratedResourceSiteEntities(scene);
  assert.equal(
    generatedMiningEntities.some((entity) => (
      String(entity && entity.generatedMiningSiteKind || "").trim().toLowerCase() === "gas"
    )),
    false,
  );

  const gasClouds = (Array.isArray(scene && scene.staticEntities) ? scene.staticEntities : [])
    .filter((entity) => entity && entity.dungeonMaterializedGasSite === true);
  assert.equal(gasClouds.length > 0, true);

  const mineableState = getMineableState(scene, gasClouds[0].itemID);
  assert.ok(mineableState, "expected dungeon gas cloud to be tracked by the mining runtime");
  assert.equal(mineableState.yieldKind, "gas");

  const anomalySites = miningAnomalyProvider.listAnomalySites(systemID, { scene });
  assert.equal(
    anomalySites.some((site) => String(site && site.family || "").trim().toLowerCase() === "gas"),
    false,
  );

  const signatureSites = sceneSignatureSiteProvider.listSignatureSites(systemID, { scene });
  assert.equal(
    signatureSites.some((site) => String(site && site.family || "").trim().toLowerCase() === "gas"),
    true,
  );
}));

test("scene startup keeps seeded data/relic site roots lightweight until explicit content materialization", withSnapshots(() => {
  const broadSystemIDs = Object.values(pickUniverseSeededSystemsByBand()).filter(Boolean);
  const summary = dungeonUniverseRuntime.reconcileUniversePersistentSites({
    systemIDs: broadSystemIDs,
    nowMs: 3600,
  });
  assert.equal(summary.desiredSiteCount > 0, true);

  const instances = broadSystemIDs.flatMap((systemID) => (
    dungeonRuntime.listActiveInstancesBySystem(systemID, { full: true })
      .filter((instance) => String(instance.siteOrigin || "").trim().toLowerCase() !== "generatedmining")
  ));
  const contentInstance = instances.find((instance) => (
    instance &&
    instance.spawnState &&
    instance.spawnState.populationHints &&
    Array.isArray(instance.spawnState.populationHints.containers) &&
    instance.spawnState.populationHints.containers.length > 0
  ));
  assert.ok(contentInstance, "expected at least one seeded signature site with container manifests");

  const scene = spaceRuntime.ensureScene(Number(contentInstance.solarSystemID));
  const beforeContents = dungeonUniverseSiteService.listMaterializedUniverseSiteContentEntities(scene, {
    instanceID: Number(contentInstance.instanceID),
  });
  assert.equal(beforeContents.length, 0);

  const materialized = dungeonUniverseSiteService.ensureSiteContentsMaterialized(scene, contentInstance, {
    spawnEncounters: true,
  });
  assert.equal(materialized && materialized.success, true);

  const siteContents = dungeonUniverseSiteService.listMaterializedUniverseSiteContentEntities(scene, {
    instanceID: Number(contentInstance.instanceID),
  });
  assert.equal(siteContents.length > 0, true);
  assert.equal(
    siteContents.some((entity) => entity && entity.dungeonMaterializedContainer === true),
    true,
  );
  assert.equal(
    siteContents.every((entity) => (
      entity &&
      (
        entity.dungeonMaterializedContainer === true ||
        entity.dungeonMaterializedEnvironment === true ||
        entity.dungeonMaterializedGate === true ||
        entity.dungeonMaterializedObjective === true ||
        entity.dungeonMaterializedHazard === true
      )
    )),
    true,
  );
  assert.equal(
    siteContents.some((entity) => (
      String(entity && entity.dungeonSiteContentRole || "").trim().length > 0
    )),
    true,
  );

  npcService.clearNpcControllersInSystem(Number(contentInstance.solarSystemID), {
    destroyEntities: true,
  });
}));

test("seeded ghost-style sites now materialize hazard beacons only when the site is explicitly activated", withSnapshots(() => {
  const broadSystemIDs = pickUniverseSeededSystemsForFamily("ghost");
  const summary = dungeonUniverseRuntime.reconcileUniversePersistentSites({
    systemIDs: broadSystemIDs,
    nowMs: 3650,
  });
  assert.equal(summary.desiredSiteCount > 0, true);

  const ghostInstance = broadSystemIDs.flatMap((systemID) => (
    dungeonRuntime.listActiveInstancesBySystem(systemID, { full: true })
      .filter((instance) => String(instance.siteOrigin || "").trim().toLowerCase() !== "generatedmining")
  )).find((instance) => (
    instance &&
    instance.spawnState &&
    instance.spawnState.populationHints &&
    Array.isArray(instance.spawnState.populationHints.hazards) &&
    instance.spawnState.populationHints.hazards.length > 0
  ));
  assert.ok(ghostInstance, "expected at least one seeded ghost-style site with hazard manifests");

  const scene = spaceRuntime.ensureScene(Number(ghostInstance.solarSystemID));
  assert.equal(
    dungeonUniverseSiteService.listMaterializedUniverseSiteContentEntities(scene, {
      instanceID: Number(ghostInstance.instanceID),
    }).length,
    0,
  );
  const materialized = dungeonUniverseSiteService.ensureSiteContentsMaterialized(scene, ghostInstance, {
    spawnEncounters: true,
  });
  assert.equal(materialized && materialized.success, true);
  const siteContents = dungeonUniverseSiteService.listMaterializedUniverseSiteContentEntities(scene, {
    instanceID: Number(ghostInstance.instanceID),
  });
  assert.equal(
    siteContents.some((entity) => entity && entity.dungeonMaterializedHazard === true),
    true,
  );
}));

test("seeded combat-style sites pass encounter manifests through the live NPC spawn hook", withSnapshots(() => {
  const broadSystemIDs = pickUniverseSeededSystemsForFamily("combat");
  const summary = dungeonUniverseRuntime.reconcileUniversePersistentSites({
    systemIDs: broadSystemIDs,
    nowMs: 3700,
  });
  assert.equal(summary.desiredSiteCount > 0, true);

  const combatInstance = broadSystemIDs.flatMap((systemID) => (
    dungeonRuntime.listActiveInstancesBySystem(systemID, { full: true })
      .filter((instance) => String(instance.siteOrigin || "").trim().toLowerCase() !== "generatedmining")
  )).find((instance) => (
    instance &&
    instance.spawnState &&
    instance.spawnState.populationHints &&
    instance.spawnState.populationHints.encounter &&
    instance.spawnState.populationHints.encounter.supported === true
  ));
  assert.ok(combatInstance, "expected at least one seeded combat-style site with encounter manifests");

  const scene = spaceRuntime.ensureScene(Number(combatInstance.solarSystemID));
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(combatInstance);
  const template = dungeonAuthority.getTemplateByID(combatInstance.templateID);
  assert.ok(siteEntity);
  assert.ok(template);
  scene._dungeonUniverseEncounterKeys = new Set();

  const originalSpawnBatchInSystem = npcService.spawnNpcBatchInSystem;
  const calls = [];
  npcService.spawnNpcBatchInSystem = (systemID, options = {}) => {
    calls.push({
      systemID: Number(systemID),
      options: JSON.parse(JSON.stringify(options)),
    });
    return {
      success: true,
      data: {
        spawned: [{
          entity: {
            itemID: 999000000001,
          },
        }],
      },
    };
  };

  try {
    const materialized = dungeonUniverseSiteService._testing.materializeSiteContents(
      scene,
      combatInstance,
      siteEntity,
      template,
      { spawnEncounters: true },
    );
    assert.equal(materialized.encountersSpawned, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].systemID, Number(combatInstance.solarSystemID));
    assert.equal(
      String(calls[0].options.profileQuery || "").trim().length > 0,
      true,
    );
    assert.equal(
      Number(calls[0].options.amount || 0) > 0,
      true,
    );
  } finally {
    npcService.spawnNpcBatchInSystem = originalSpawnBatchInSystem;
  }
}));

test("live seeded site labels prefer resolved localized dungeon names when available", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    String(entry.siteFamily || "").trim().toLowerCase() === "ghost" &&
    Number(entry.dungeonNameID) > 0
  ), "localized live site label");
  const localizedName = dungeonUniverseSiteService._testing.resolveLocalizedTemplateName(template);
  assert.equal(localizedName.length > 0, true);

  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:localized-label",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 6630000000001,
    },
    nowMs: 3725,
  });
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  assert.equal(siteEntity.itemName, localizedName);
}));

test("client environment templates now materialize ambient environment props for seeded site content", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    entry.environmentTemplates &&
    entry.environmentTemplates.resolvedTemplateCatalog &&
    Object.keys(entry.environmentTemplates.resolvedTemplateCatalog).length > 0
  ), "environment-driven ambient props");
  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:environment-props",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 6630000000002,
    },
    nowMs: 3750,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);

  const materialized = dungeonUniverseSiteService._testing.materializeSiteContents(
    scene,
    instance,
    siteEntity,
    template,
    { spawnEncounters: false },
  );
  assert.equal(materialized.environmentPropsSpawned >= 0, true);
  const siteContents = dungeonUniverseSiteService.listMaterializedUniverseSiteContentEntities(scene, {
    instanceID: Number(instance.instanceID),
  });
  assert.equal(
    siteContents.some((entity) => entity && entity.dungeonMaterializedEnvironment === true),
    true,
  );
}));

test("objective-bearing seeded sites now materialize objective/task markers from extracted client metadata", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    entry.objectiveMetadata &&
    entry.objectiveMetadata.objectiveChain &&
    entry.objectiveMetadata.nodeGraph &&
    Array.isArray(entry.objectiveMetadata.objectiveTypeIDs) &&
    entry.objectiveMetadata.objectiveTypeIDs.length > 0
  ), "objective/task markers");
  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:objective-markers",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 6630000000003,
    },
    nowMs: 3775,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);

  const materialized = dungeonUniverseSiteService._testing.materializeSiteContents(
    scene,
    instance,
    siteEntity,
    template,
    { spawnEncounters: false },
  );
  assert.equal(materialized.objectivesSpawned >= 0, true);
  const siteContents = dungeonUniverseSiteService.listMaterializedUniverseSiteContentEntities(scene, {
    instanceID: Number(instance.instanceID),
  });
  assert.equal(
    siteContents.some((entity) => (
      entity &&
      entity.dungeonMaterializedObjective === true &&
      String(entity.dungeonObjectiveKey || "").trim().length > 0
    )),
    true,
  );
}));

test("generic derived data sites now materialize ambient research props and derived objective markers", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    String(entry.siteFamily || "") === "data" &&
    String(entry.populationHints && entry.populationHints.source || "") === "family_derived" &&
    (!entry.objectiveMetadata || !entry.objectiveMetadata.objectiveChain)
  ), "generic data environment and objectives");
  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:generic-data-environment",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 6630000000004,
    },
    nowMs: 3785,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);

  const materialized = dungeonUniverseSiteService._testing.materializeSiteContents(
    scene,
    instance,
    siteEntity,
    template,
    { spawnEncounters: false, nowMs: 3785 },
  );
  assert.equal(materialized.environmentPropsSpawned > 0, true);
  assert.equal(materialized.objectivesSpawned > 0, true);

  const siteContents = dungeonUniverseSiteService.listMaterializedUniverseSiteContentEntities(scene, {
    instanceID: Number(instance.instanceID),
  });
  const environments = siteContents.filter((entity) => entity && entity.dungeonMaterializedEnvironment === true);
  const objectives = siteContents.filter((entity) => entity && entity.dungeonMaterializedObjective === true);
  assert.equal(
    environments.some((entity) => /mainframe|databank|laboratory|research/i.test(String(entity.itemName || ""))),
    true,
  );
  assert.equal(
    objectives.some((entity) => /hack|recover|open/i.test(String(entity.itemName || ""))),
    true,
  );
}));

test("private mission sites now materialize derived encounter waves from mission room/group data", withSnapshots(() => {
  const template = findMissionTemplate((entry) => (
    /Silence the Informant/i.test(String(entry.title || "")) &&
    Array.isArray(entry.rooms) &&
    entry.rooms.length > 0
  ), "mission encounter derivation");
  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "mission:test:silence-the-informant",
    lifecycleState: "active",
    siteKind: "mission",
    runtimeFlags: {
      missionRuntime: true,
    },
    metadata: {
      siteID: 66300000000045,
    },
    nowMs: 3791,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);

  const originalSpawnBatchInSystem = npcService.spawnNpcBatchInSystem;
  const calls = [];
  npcService.spawnNpcBatchInSystem = (systemID, options = {}) => {
    calls.push({
      systemID: Number(systemID),
      options: JSON.parse(JSON.stringify(options)),
    });
    return {
      success: true,
      data: {
        spawned: [{
          entity: {
            itemID: 999000000101 + calls.length,
          },
        }],
      },
    };
  };

  try {
    const materialized = dungeonUniverseSiteService._testing.materializeSiteContents(
      scene,
      instance,
      siteEntity,
      template,
      { spawnEncounters: true, nowMs: 3791 },
    );
    assert.equal(materialized.encountersSpawned > 0, true);
    assert.equal(materialized.objectivesSpawned > 0, true);
    assert.equal(calls.length > 0, true);
    assert.equal(
      /Decimator|Mercenary Elite Fighter|Striker Alvatis/i.test(String(calls[0].options.profileQuery || "")),
      true,
    );
  } finally {
    npcService.spawnNpcBatchInSystem = originalSpawnBatchInSystem;
  }
}));

test("legacy pirate mission NPC names resolve to live parity spawn profiles instead of empty pockets", withSnapshots(() => {
  const template = findMissionTemplate((entry) => (
    /The Blood Raider Spies/i.test(String(entry.title || "")) &&
    /level 2/i.test(String(entry.title || "")) &&
    Array.isArray(entry.rooms) &&
    entry.rooms.length > 0
  ), "blood raider mission spawn alias bridge");
  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "mission:test:blood-raider-spies-level-2",
    lifecycleState: "active",
    siteKind: "mission",
    runtimeFlags: {
      missionRuntime: true,
    },
    metadata: {
      siteID: 663000000000451,
    },
    nowMs: 37915,
  });
  const populationHints = dungeonUniverseSiteService._testing.resolvePopulationHints(instance, template);
  const encounterPlans = dungeonUniverseSiteService._testing.resolveEncounterPlans(populationHints);
  assert.equal(encounterPlans.length > 0, true);
  assert.equal(
    encounterPlans.every((plan) => /^parity_blood_raider_pulse_(frigate|destroyer)$/.test(String(plan && plan.spawnQuery || ""))),
    true,
  );
  encounterPlans.forEach((plan) => {
    const resolution = resolveNpcSpawnPlan(plan.spawnQuery, {
      amount: plan.amount,
      entityType: "npc",
      defaultPoolID: "npc_hostiles",
      fallbackProfileID: "generic_hostile",
    });
    assert.equal(
      resolution.success,
      true,
      `expected mission spawn query ${String(plan.spawnQuery || "")} to resolve through live NPC selection`,
    );
  });
}));

test("mission templates with authored structure entries now materialize ambient props and mission markers", withSnapshots(() => {
  const template = findMissionTemplate((entry) => (
    /Amarrian Excavators/i.test(String(entry.title || "")) &&
    Array.isArray(entry.rooms) &&
    entry.rooms.some((room) => (
      [...(room.spawnEntries || []), ...((room.groups || []).flatMap((group) => group.spawnEntries || []))]
        .some((spawnEntry) => String(spawnEntry && spawnEntry.entityKind || "").toLowerCase() === "structure")
    ))
  ), "mission ambient structure derivation");
  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "mission:test:amarrian-excavators",
    lifecycleState: "active",
    siteKind: "mission",
    runtimeFlags: {
      missionRuntime: true,
    },
    metadata: {
      siteID: 66300000000046,
    },
    nowMs: 3792,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);

  const materialized = dungeonUniverseSiteService._testing.materializeSiteContents(
    scene,
    instance,
    siteEntity,
    template,
    { spawnEncounters: false, nowMs: 3792 },
  );
  assert.equal(materialized.environmentPropsSpawned > 0, true);
  assert.equal(materialized.objectivesSpawned > 0, true);
  const siteContents = dungeonUniverseSiteService.listMaterializedUniverseSiteContentEntities(scene, {
    instanceID: Number(instance.instanceID),
  });
  assert.equal(
    siteContents.some((entity) => entity && entity.dungeonMaterializedEnvironment === true),
    true,
  );
  assert.equal(
    siteContents.some((entity) => entity && entity.dungeonMaterializedObjective === true),
    true,
  );
}));

test("scene startup now adds private mission site roots for active mission instances", withSnapshots(() => {
  const template = findMissionTemplate((entry) => (
    /Silence the Informant/i.test(String(entry.title || ""))
  ), "mission scene root startup");
  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "mission:test:scene-root",
    lifecycleState: "active",
    siteKind: "mission",
    runtimeFlags: {
      missionRuntime: true,
    },
    metadata: {
      siteID: 66300000000047,
      label: "Mission Pocket",
    },
    nowMs: 3793,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  delete scene._universeDungeonSitesInitialized;

  const result = dungeonUniverseSiteService.handleSceneCreated(scene);
  assert.equal(result.success, true);
  assert.ok(scene.staticEntitiesByID.get(Number(instance.metadata.siteID)));
}));

test("site environment props normalize starbase/entity slim categories to a safe client category", withSnapshots(() => {
  const combatTemplate = findClientTemplate((entry) => (
    String(entry.siteFamily || "") === "combat" &&
    Array.isArray(entry.siteSceneProfile && entry.siteSceneProfile.structureProfiles) &&
    entry.siteSceneProfile.structureProfiles.length > 0
  ), "combat site slim category normalization");
  const dataTemplate = findClientTemplate((entry) => (
    String(entry.siteFamily || "") === "data" &&
    String(entry.populationHints && entry.populationHints.source || "") === "family_derived"
  ), "data site slim category normalization");
  const combatInstance = dungeonRuntime.createInstance({
    templateID: combatTemplate.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:combat-slim-category",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 66300000000043,
    },
    nowMs: 3789,
  });
  const dataInstance = dungeonRuntime.createInstance({
    templateID: dataTemplate.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:data-slim-category",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 66300000000044,
    },
    nowMs: 3790,
  });
  const combatSite = dungeonUniverseSiteService.buildSiteEntity(combatInstance);
  const dataSite = dungeonUniverseSiteService.buildSiteEntity(dataInstance);
  const combatEntities = dungeonUniverseSiteService._testing.buildEnvironmentEntities(
    combatInstance,
    combatSite,
    combatTemplate,
    dungeonUniverseSiteService._testing.resolvePopulationHints(combatInstance, combatTemplate),
  );
  const dataEntities = dungeonUniverseSiteService._testing.buildEnvironmentEntities(
    dataInstance,
    dataSite,
    dataTemplate,
    dungeonUniverseSiteService._testing.resolvePopulationHints(dataInstance, dataTemplate),
  );
  const normalizedEntities = [...combatEntities, ...dataEntities]
    .filter((entity) => [11, 23].includes(Number(entity && entity.categoryID)));
  assert.equal(normalizedEntities.length > 0, true);
  assert.equal(
    normalizedEntities.every((entity) => Number(entity && entity.slimCategoryID) === 2),
    true,
  );
}));

test("seeded combat site materialization broadcasts ambient structures and objective props when requested", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    String(entry.siteFamily || "") === "combat" &&
    Array.isArray(entry.siteSceneProfile && entry.siteSceneProfile.structureProfiles) &&
    entry.siteSceneProfile.structureProfiles.length > 0
  ), "combat site with ambient structure scene profile");
  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:combat-broadcast-environment",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 66300000000041,
    },
    nowMs: 3787,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);

  const originalBroadcastAddBalls = scene.broadcastAddBalls;
  const broadcastCalls = [];
  scene.broadcastAddBalls = (entities) => {
    broadcastCalls.push(Array.isArray(entities) ? [...entities] : []);
    return [];
  };

  try {
    const materialized = dungeonUniverseSiteService._testing.materializeSiteContents(
      scene,
      instance,
      siteEntity,
      template,
      { spawnEncounters: false, nowMs: 3787, broadcast: true },
    );
    assert.equal(materialized.environmentPropsSpawned > 0, true);
    assert.equal(materialized.objectivesSpawned > 0, true);
  } finally {
    scene.broadcastAddBalls = originalBroadcastAddBalls;
  }

  assert.equal(broadcastCalls.length, 1);
  const broadcasted = broadcastCalls[0] || [];
  assert.equal(
    broadcasted.some((entity) => entity && entity.dungeonMaterializedEnvironment === true),
    true,
  );
  assert.equal(
    broadcasted.some((entity) => entity && entity.dungeonMaterializedObjective === true),
    true,
  );
}));

test("pre-bootstrap combat site props do not broadcast before the initial ballpark is ready", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    String(entry.siteFamily || "") === "combat" &&
    Array.isArray(entry.siteSceneProfile && entry.siteSceneProfile.structureProfiles) &&
    entry.siteSceneProfile.structureProfiles.length > 0
  ), "combat site with ambient structure scene profile bootstrap suppression");
  const session = {
    clientID: 65490,
    characterID: 0,
    socket: {
      destroyed: false,
    },
    sendNotification() {},
  };
  const applyResult = applyCharacterToSession(session, 140000004, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);
  const shipItem = getActiveShipRecord(session.characterID);
  assert.ok(shipItem);

  const scene = spaceRuntime.ensureScene(30000142);
  const attached = scene.attachSession(session, shipItem, {
    broadcast: false,
    emitSimClockRebase: false,
  });
  assert.ok(attached);
  assert.equal(session._space.initialStateSent, false);

  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:combat-pre-bootstrap-static-suppress",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 66300000000041,
    },
    nowMs: 3787,
  });
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  siteEntity.position = {
    x: Number(attached.position && attached.position.x) || 0,
    y: Number(attached.position && attached.position.y) || 0,
    z: Number(attached.position && attached.position.z) || 0,
  };
  scene.addStaticEntity(siteEntity);

  const propEntities = [
    ...dungeonUniverseSiteService._testing.buildEnvironmentEntities(
      instance,
      siteEntity,
      template,
      dungeonUniverseSiteService._testing.resolvePopulationHints(instance, template),
    ),
    ...dungeonUniverseSiteService._testing.buildObjectiveEntities(
      instance,
      siteEntity,
      template,
      dungeonUniverseSiteService._testing.resolvePopulationHints(instance, template),
    ),
  ];
  assert.equal(propEntities.length > 0, true);
  for (const entity of propEntities) {
    scene.addStaticEntity(entity);
  }

  const originalSendAddBallsToSession = scene.sendAddBallsToSession;
  const sendCalls = [];
  scene.sendAddBallsToSession = (targetSession, entities, options = {}) => {
    sendCalls.push({
      targetSession,
      entityIDs: (Array.isArray(entities) ? entities : [])
        .map((entity) => Number(entity && entity.itemID) || 0)
        .filter((entityID) => entityID > 0),
      options,
    });
    return {
      delivered: true,
      stamp: 1775747000,
    };
  };

  try {
    scene.broadcastAddBalls(propEntities);
  } finally {
    scene.sendAddBallsToSession = originalSendAddBallsToSession;
  }

  assert.equal(sendCalls.length, 0);
  assert.equal(
    propEntities.every((entity) => !session._space.visibleBubbleScopedStaticEntityIDs.has(Number(entity.itemID))),
    true,
  );
}));

test("ensureSiteContentsMaterialized forces a session static-visibility resync for seeded combat props", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    String(entry.siteFamily || "") === "combat" &&
    Array.isArray(entry.siteSceneProfile && entry.siteSceneProfile.structureProfiles) &&
    entry.siteSceneProfile.structureProfiles.length > 0
  ), "combat site with ambient structure scene profile resync");
  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:combat-static-resync",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 66300000000042,
    },
    nowMs: 3788,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);

  const expectedStaticIDs = [
    ...dungeonUniverseSiteService._testing.buildEnvironmentEntities(
      instance,
      siteEntity,
      template,
      dungeonUniverseSiteService._testing.resolvePopulationHints(instance, template),
    ).map((entity) => Number(entity.itemID)),
    ...dungeonUniverseSiteService._testing.buildObjectiveEntities(
      instance,
      siteEntity,
      template,
      dungeonUniverseSiteService._testing.resolvePopulationHints(instance, template),
    ).map((entity) => Number(entity.itemID)),
  ];
  assert.equal(expectedStaticIDs.length > 0, true);

  const session = {
    _space: {
      initialStateSent: true,
      visibleBubbleScopedStaticEntityIDs: new Set([9990001]),
    },
    socket: {
      destroyed: false,
    },
  };
  const originalSyncStaticVisibilityForSession = scene.syncStaticVisibilityForSession;
  const syncCalls = [];
  scene.syncStaticVisibilityForSession = (targetSession, now, options = {}) => {
    syncCalls.push({
      targetSession,
      now,
      options,
      visibleIDs: [...targetSession._space.visibleBubbleScopedStaticEntityIDs].sort((left, right) => left - right),
    });
  };

  try {
    const result = dungeonUniverseSiteService.ensureSiteContentsMaterialized(scene, instance, {
      spawnEncounters: false,
      session,
      nowMs: 3788,
    });
    assert.equal(result && result.success, true);
  } finally {
    scene.syncStaticVisibilityForSession = originalSyncStaticVisibilityForSession;
  }

  assert.equal(syncCalls.length, 1);
  assert.equal(syncCalls[0].targetSession, session);
  assert.equal(syncCalls[0].now, 3788);
  assert.deepEqual(syncCalls[0].visibleIDs, [9990001]);
  assert.equal(session._space.visibleBubbleScopedStaticEntityIDs.has(9990001), true);
}));

test("forceResyncSiteStaticContentForSession skips already-visible dungeon props instead of re-sending them", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    String(entry.siteFamily || "") === "combat" &&
    Array.isArray(entry.siteSceneProfile && entry.siteSceneProfile.structureProfiles) &&
    entry.siteSceneProfile.structureProfiles.length > 0
  ), "combat site already-visible static props");
  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:combat-static-resync-noop",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 66300000000043,
    },
    nowMs: 3789,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);

  dungeonUniverseSiteService._testing.materializeSiteContents(
    scene,
    instance,
    siteEntity,
    template,
    { spawnEncounters: false, nowMs: 3789 },
  );

  const visibleIDs = dungeonUniverseSiteService
    .listMaterializedUniverseSiteContentEntities(scene, {
      instanceID: Number(instance.instanceID),
    })
    .filter((entity) => (
      entity &&
      (entity.dungeonMaterializedEnvironment === true ||
        entity.dungeonMaterializedGate === true ||
        entity.dungeonMaterializedObjective === true ||
        entity.dungeonMaterializedHazard === true)
    ))
    .map((entity) => Number(entity.itemID))
    .filter((entityID) => entityID > 0);
  assert.equal(visibleIDs.length > 0, true);

  const session = {
    _space: {
      initialStateSent: true,
      visibleBubbleScopedStaticEntityIDs: new Set([9990001, ...visibleIDs]),
    },
  };
  const originalSyncStaticVisibilityForSession = scene.syncStaticVisibilityForSession;
  const syncCalls = [];
  scene.syncStaticVisibilityForSession = (...args) => {
    syncCalls.push(args);
  };

  try {
    const result = dungeonUniverseSiteService._testing.forceResyncSiteStaticContentForSession(
      scene,
      session,
      instance,
      { nowMs: 3789 },
    );
    assert.equal(result, false);
  } finally {
    scene.syncStaticVisibilityForSession = originalSyncStaticVisibilityForSession;
  }

  assert.equal(syncCalls.length, 0);
  assert.equal(session._space.visibleBubbleScopedStaticEntityIDs.has(9990001), true);
  assert.equal(
    visibleIDs.every((entityID) => session._space.visibleBubbleScopedStaticEntityIDs.has(entityID)),
    true,
  );
}));

test("site environment props materialize with real damageable health from type dogma", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    String(entry.siteFamily || "") === "combat" &&
    Array.isArray(entry.siteSceneProfile && entry.siteSceneProfile.structureProfiles) &&
    entry.siteSceneProfile.structureProfiles.length > 0
  ), "damageable combat environment props");
  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:combat-damageable-environment",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 66300000000044,
    },
    nowMs: 3790,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);

  const materialized = dungeonUniverseSiteService._testing.materializeSiteContents(
    scene,
    instance,
    siteEntity,
    template,
    { spawnEncounters: false, nowMs: 3790 },
  );
  assert.equal(materialized.environmentPropsSpawned > 0, true);

  const environmentProps = dungeonUniverseSiteService.listMaterializedUniverseSiteContentEntities(scene, {
    instanceID: Number(instance.instanceID),
  }).filter((entity) => entity && entity.dungeonMaterializedEnvironment === true);
  assert.equal(environmentProps.length > 0, true);
  assert.equal(
    environmentProps.some((entity) => (
      (Number(entity.shieldCapacity) || 0) > 0 ||
      (Number(entity.armorHP) || 0) > 0 ||
      (Number(entity.structureHP) || 0) > 0
    )),
    true,
  );
  assert.equal(
    environmentProps.some((entity) => Number(entity.structureHP || 0) > 0),
    true,
  );
}));

test("materializeSiteContents rehydrates stale active encounter waves when a fresh scene no longer has their transient NPCs", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    String(entry.siteFamily || "") === "combat" &&
    String(entry.populationHints && entry.populationHints.source || "") === "combat_wave_derived" &&
    Array.isArray(entry.populationHints && entry.populationHints.encounters) &&
    entry.populationHints.encounters.some((plan) => String(plan && plan.trigger || "") === "on_load")
  ), "combat site stale encounter rehydrate");
  const onLoadPlan = template.populationHints.encounters.find((plan) => String(plan && plan.trigger || "") === "on_load");
  assert.ok(onLoadPlan && onLoadPlan.key, "expected on-load encounter plan");

  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:combat-stale-encounter-rehydrate",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 66300000000046,
    },
    spawnState: {
      encounterStatesByKey: {
        [String(onLoadPlan.key)]: {
          key: String(onLoadPlan.key),
          armedAtMs: 3700,
          spawnedAtMs: 3710,
          spawnedEntityIDs: [9910001],
          remainingEntityIDs: [9910001],
          waveIndex: Number(onLoadPlan.waveIndex || 1) || 1,
        },
      },
    },
    nowMs: 3792,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);
  scene._dungeonUniverseEncounterKeys = new Set();

  const originalSpawnBatchInSystem = npcService.spawnNpcBatchInSystem;
  const spawnedIDs = [];
  npcService.spawnNpcBatchInSystem = (_systemID, options = {}) => {
    const baseID = 9920000 + spawnedIDs.length + 1;
    const entity = {
      itemID: baseID,
      position: options.position || { x: 0, y: 0, z: 0 },
    };
    scene.dynamicEntities.set(baseID, entity);
    spawnedIDs.push(baseID);
    return {
      success: true,
      data: {
        spawned: [{ entity }],
      },
    };
  };

  try {
    const materialized = dungeonUniverseSiteService._testing.materializeSiteContents(
      scene,
      instance,
      siteEntity,
      template,
      { spawnEncounters: true, nowMs: 3792 },
    );
    assert.equal(materialized.encountersSpawned > 0, true);
  } finally {
    npcService.spawnNpcBatchInSystem = originalSpawnBatchInSystem;
  }

  const refreshed = dungeonRuntime.getInstance(instance.instanceID);
  const encounterState = refreshed &&
    refreshed.spawnState &&
    refreshed.spawnState.encounterStatesByKey &&
    refreshed.spawnState.encounterStatesByKey[String(onLoadPlan.key)];
  assert.ok(encounterState, "expected refreshed encounter state");
  assert.equal(Number(encounterState.spawnedAtMs) >= 3792, true);
  assert.equal(
    Array.isArray(encounterState.spawnedEntityIDs) && encounterState.spawnedEntityIDs.some((entityID) => spawnedIDs.includes(Number(entityID))),
    true,
  );
  assert.equal(
    Array.isArray(encounterState.remainingEntityIDs) && encounterState.remainingEntityIDs.some((entityID) => spawnedIDs.includes(Number(entityID))),
    true,
  );
}));

test("spawn-state updates do not churn a materialized combat site root or tear down its static props", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    String(entry.siteFamily || "") === "combat" &&
    Array.isArray(entry.siteSceneProfile && entry.siteSceneProfile.structureProfiles) &&
    entry.siteSceneProfile.structureProfiles.length > 0
  ), "combat site stable root signature");
  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:combat-stable-root-signature",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 66300000000045,
    },
    nowMs: 3791,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);
  const materialized = dungeonUniverseSiteService._testing.materializeSiteContents(
    scene,
    instance,
    siteEntity,
    template,
    { spawnEncounters: false, nowMs: 3791 },
  );
  assert.equal(materialized.environmentPropsSpawned > 0, true);

  const siteID = Number(instance && instance.metadata && instance.metadata.siteID) || 0;
  const contentIDsBefore = dungeonUniverseSiteService
    .listMaterializedUniverseSiteContentEntities(scene, {
      instanceID: Number(instance.instanceID),
    })
    .map((entity) => Number(entity && entity.itemID) || 0)
    .filter((entityID) => entityID > 0);
  assert.equal(contentIDsBefore.length > 0, true);

  const removedIDs = [];
  const originalRemoveStaticEntity = scene.removeStaticEntity.bind(scene);
  scene.removeStaticEntity = (entityID, options = {}) => {
    removedIDs.push(Number(entityID) || 0);
    return originalRemoveStaticEntity(entityID, {
      ...options,
      broadcast: false,
    });
  };

  try {
    const changedInstance = JSON.parse(JSON.stringify(instance));
    changedInstance.spawnState = {
      ...(changedInstance.spawnState && typeof changedInstance.spawnState === "object"
        ? changedInstance.spawnState
        : {}),
      contentEntityRefsByKey: {
        marker: {
          entityID: contentIDsBefore[0],
          contentKey: "marker",
        },
      },
    };
    dungeonUniverseSiteService._testing.handleRuntimeChange({
      changeType: "updated",
      instanceID: Number(instance.instanceID),
      solarSystemID: 30000142,
      previousSolarSystemID: 30000142,
      before: instance,
      after: changedInstance,
    });
  } finally {
    scene.removeStaticEntity = originalRemoveStaticEntity;
  }

  assert.deepEqual(removedIDs, []);
  assert.equal(scene.staticEntitiesByID.has(siteID), true);
  assert.equal(
    contentIDsBefore.every((entityID) => scene.staticEntitiesByID.has(entityID)),
    true,
  );
}));

test("generic derived relic sites now materialize ambient ruins props and derived objective markers", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    String(entry.siteFamily || "") === "relic" &&
    String(entry.populationHints && entry.populationHints.source || "") === "family_derived" &&
    (!entry.objectiveMetadata || !entry.objectiveMetadata.objectiveChain)
  ), "generic relic environment and objectives");
  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:generic-relic-environment",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 6630000000005,
    },
    nowMs: 3790,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);

  const materialized = dungeonUniverseSiteService._testing.materializeSiteContents(
    scene,
    instance,
    siteEntity,
    template,
    { spawnEncounters: false, nowMs: 3790 },
  );
  assert.equal(materialized.environmentPropsSpawned > 0, true);
  assert.equal(materialized.objectivesSpawned > 0, true);

  const siteContents = dungeonUniverseSiteService.listMaterializedUniverseSiteContentEntities(scene, {
    instanceID: Number(instance.instanceID),
  });
  const environments = siteContents.filter((entity) => entity && entity.dungeonMaterializedEnvironment === true);
  const objectives = siteContents.filter((entity) => entity && entity.dungeonMaterializedObjective === true);
  assert.equal(
    environments.some((entity) => /ruin|debris|rubble|remains/i.test(String(entity.itemName || ""))),
    true,
  );
  assert.equal(
    objectives.some((entity) => /recover|salvage|open/i.test(String(entity.itemName || ""))),
    true,
  );
}));

test("ghost sites now materialize ambient research props and derived objective markers alongside hazards", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    String(entry.siteFamily || "") === "ghost"
  ), "ghost ambient environment and objectives");
  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:ghost-environment-objectives",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 6630000000006,
    },
    nowMs: 3795,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);

  const materialized = dungeonUniverseSiteService._testing.materializeSiteContents(
    scene,
    instance,
    siteEntity,
    template,
    { spawnEncounters: false, nowMs: 3795 },
  );
  assert.equal(materialized.environmentPropsSpawned > 0, true);
  assert.equal(materialized.objectivesSpawned > 0, true);

  const siteContents = dungeonUniverseSiteService.listMaterializedUniverseSiteContentEntities(scene, {
    instanceID: Number(instance.instanceID),
  });
  const environments = siteContents.filter((entity) => entity && entity.dungeonMaterializedEnvironment === true);
  const objectives = siteContents.filter((entity) => entity && entity.dungeonMaterializedObjective === true);
  assert.equal(
    environments.some((entity) => /lab|research|mainframe|databank/i.test(String(entity.itemName || ""))),
    true,
  );
  assert.equal(
    objectives.some((entity) => /hack|timer|detonation|open/i.test(String(entity.itemName || ""))),
    true,
  );
}));

test("derived combat sites now materialize broader ambient structures and objective markers instead of only hostiles", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    String(entry.siteFamily || "") === "combat" &&
    String(entry.populationHints && entry.populationHints.source || "") === "combat_wave_derived"
  ), "generic combat environment and objectives");
  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:combat-environment-objectives",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 6630000000007,
    },
    nowMs: 3800,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);

  const materialized = dungeonUniverseSiteService._testing.materializeSiteContents(
    scene,
    instance,
    siteEntity,
    template,
    { spawnEncounters: false, nowMs: 3800 },
  );
  assert.equal(materialized.environmentPropsSpawned > 0, true);
  assert.equal(materialized.objectivesSpawned > 0, true);

  const siteContents = dungeonUniverseSiteService.listMaterializedUniverseSiteContentEntities(scene, {
    instanceID: Number(instance.instanceID),
  });
  const environments = siteContents.filter((entity) => entity && entity.dungeonMaterializedEnvironment === true);
  const objectives = siteContents.filter((entity) => entity && entity.dungeonMaterializedObjective === true);
  assert.equal(
    environments.some((entity) => /bunker|warehouse|battery|shipyard|facility/i.test(String(entity.itemName || ""))),
    true,
  );
  assert.equal(
    objectives.some((entity) => /eliminate|neutralize/i.test(String(entity.itemName || ""))),
    true,
  );
}));

test("deadspace-style client dungeons now materialize visible acceleration gate objects from compiled scene profiles", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    String(entry.siteFamily || "") === "combat" &&
    Array.isArray(entry.connections) &&
    entry.connections.length > 0 &&
    entry.siteSceneProfile &&
    Array.isArray(entry.siteSceneProfile.gateProfiles) &&
    entry.siteSceneProfile.gateProfiles.length > 0
  ), "compiled gate scene profiles");
  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:gate-scene-profile",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 6630000000042,
    },
    nowMs: 3805,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);

  const materialized = dungeonUniverseSiteService._testing.materializeSiteContents(
    scene,
    instance,
    siteEntity,
    template,
    { spawnEncounters: false, nowMs: 3805 },
  );
  assert.equal(materialized.gatesSpawned > 0, true);

  const siteContents = dungeonUniverseSiteService.listMaterializedUniverseSiteContentEntities(scene, {
    instanceID: Number(instance.instanceID),
  });
  const gates = siteContents.filter((entity) => entity && entity.dungeonMaterializedGate === true);
  assert.equal(gates.length > 0, true);
  assert.equal(
    gates.some((entity) => /acceleration gate|conduit/i.test(String(entity.itemName || ""))),
    true,
  );
  assert.equal(
    gates.some((entity) => String(entity.dungeonGateKey || "").trim().length > 0),
    true,
  );
}));

test("pirate data sites now materialize exact faction-specific container mixes from the EVE University layouts", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    String(entry.resolvedName || "") === "Local Angel Data Terminal"
  ), "exact pirate data site container layout");
  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:pirate-data-layout",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 6630000000004,
    },
    nowMs: 3800,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);

  dungeonUniverseSiteService._testing.materializeSiteContents(
    scene,
    instance,
    siteEntity,
    template,
    { spawnEncounters: false },
  );
  const siteContents = dungeonUniverseSiteService.listMaterializedUniverseSiteContentEntities(scene, {
    instanceID: Number(instance.instanceID),
  }).filter((entity) => entity && entity.dungeonMaterializedContainer === true);

  assert.equal(siteContents.length, 4);
  assert.equal(
    siteContents.filter((entity) => String(entity.itemName || "").startsWith("Angel Info Shard")).length,
    3,
  );
  assert.equal(
    siteContents.filter((entity) => String(entity.itemName || "").startsWith("Angel Com Tower")).length,
    1,
  );
}));

test("blood raider pirate data sites now materialize exact faction-specific container mixes instead of falling back to generic data caches", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    String(entry.resolvedName || "") === "Local Blood Raider Data Terminal"
  ), "exact blood raider pirate data site container layout");
  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:blood-raider-data-layout",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 6630000000006,
    },
    nowMs: 3840,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);

  dungeonUniverseSiteService._testing.materializeSiteContents(
    scene,
    instance,
    siteEntity,
    template,
    { spawnEncounters: false },
  );
  const siteContents = dungeonUniverseSiteService.listMaterializedUniverseSiteContentEntities(scene, {
    instanceID: Number(instance.instanceID),
  }).filter((entity) => entity && entity.dungeonMaterializedContainer === true);

  assert.equal(siteContents.length, 4);
  assert.equal(
    siteContents.filter((entity) => String(entity.itemName || "").startsWith("Blood Info Shard")).length,
    3,
  );
  assert.equal(
    siteContents.filter((entity) => String(entity.itemName || "").startsWith("Blood Com Tower")).length,
    1,
  );
}));

test("pirate data sites now populate deterministic loot into inventory-backed hackable containers from loot-profile metadata", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    String(entry.resolvedName || "") === "Local Angel Data Terminal"
  ), "pirate data loot population");
  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:pirate-data-loot",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 6630000000024,
    },
    nowMs: 3845,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);

  dungeonUniverseSiteService._testing.materializeSiteContents(
    scene,
    instance,
    siteEntity,
    template,
    { spawnEncounters: false, nowMs: 3845 },
  );
  const siteContents = dungeonUniverseSiteService.listMaterializedUniverseSiteContentEntities(scene, {
    instanceID: Number(instance.instanceID),
  }).filter((entity) => entity && entity.dungeonMaterializedContainer === true);
  assert.equal(siteContents.length, 4);
  assert.equal(
    siteContents.every((entity) => String(entity.dungeonSiteContentLootProfile || "") === "pirate_data_loot"),
    true,
  );
  const containerLoot = siteContents.flatMap((entity) => listContainerItems(null, Number(entity.itemID)));
  assert.equal(containerLoot.length > 0, true);
  assert.equal(
    containerLoot.some((item) => /Datacore|Decryptor|Data Interface/i.test(String(item && item.itemName || ""))),
    true,
  );
}));

test("ghost sites now materialize tier-specific bonus containers and hazard timer metadata", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    String(entry.resolvedName || "") === "Lesser Sansha Covert Research Facility"
  ), "ghost tier-specific layout");
  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:ghost-layout",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 6630000000005,
    },
    nowMs: 3825,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);

  dungeonUniverseSiteService._testing.materializeSiteContents(
    scene,
    instance,
    siteEntity,
    template,
    { spawnEncounters: false },
  );
  const siteContents = dungeonUniverseSiteService.listMaterializedUniverseSiteContentEntities(scene, {
    instanceID: Number(instance.instanceID),
  });
  const containers = siteContents.filter((entity) => entity && entity.dungeonMaterializedContainer === true);
  const hazards = siteContents.filter((entity) => entity && entity.dungeonMaterializedHazard === true);
  assert.equal(containers.length, 5);
  assert.equal(
    containers.some((entity) => entity && entity.dungeonSiteContentBonus === true),
    true,
  );
  assert.equal(
    hazards.some((entity) => Number(entity && entity.dungeonHazardVisibleCountdownSeconds || 0) === 30),
    true,
  );
}));

test("ghost response fleets no longer spawn immediately on site load when the encounter trigger is timer-driven", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    String(entry.resolvedName || "") === "Lesser Sansha Covert Research Facility"
  ), "ghost delayed encounter trigger");
  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:ghost-delayed-encounter",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 6630000000007,
    },
    nowMs: 3850,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);
  scene._dungeonUniverseEncounterKeys = new Set();

  const originalSpawnBatchInSystem = npcService.spawnNpcBatchInSystem;
  let callCount = 0;
  npcService.spawnNpcBatchInSystem = () => {
    callCount += 1;
    return {
      success: true,
      data: {
        spawned: [],
      },
    };
  };

  try {
    const materialized = dungeonUniverseSiteService._testing.materializeSiteContents(
      scene,
      instance,
      siteEntity,
      template,
      { spawnEncounters: true },
    );
    assert.equal(materialized.encountersSpawned, 0);
    assert.equal(callCount, 0);
  } finally {
    npcService.spawnNpcBatchInSystem = originalSpawnBatchInSystem;
  }
}));

test("abandoned research complexes now materialize their real can mix and do not spawn defender drones until a hack fails", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    String(entry.resolvedName || "") === "Abandoned Research Complex DC035"
  ), "abandoned research complex layout");
  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:abandoned-research-complex",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 6630000000008,
    },
    nowMs: 3860,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);
  scene._dungeonUniverseEncounterKeys = new Set();

  const originalSpawnBatchInSystem = npcService.spawnNpcBatchInSystem;
  let callCount = 0;
  npcService.spawnNpcBatchInSystem = () => {
    callCount += 1;
    return {
      success: true,
      data: {
        spawned: [],
      },
    };
  };

  try {
    const materialized = dungeonUniverseSiteService._testing.materializeSiteContents(
      scene,
      instance,
      siteEntity,
      template,
      { spawnEncounters: true },
    );
    assert.equal(materialized.encountersSpawned, 0);
    assert.equal(callCount, 0);
  } finally {
    npcService.spawnNpcBatchInSystem = originalSpawnBatchInSystem;
  }

  const siteContents = dungeonUniverseSiteService.listMaterializedUniverseSiteContentEntities(scene, {
    instanceID: Number(instance.instanceID),
  }).filter((entity) => entity && entity.dungeonMaterializedContainer === true);
  assert.equal(siteContents.length, 3);
  assert.equal(
    siteContents.filter((entity) => String(entity.itemName || "") === "High Security Containment Facility").length,
    2,
  );
  assert.equal(
    siteContents.filter((entity) => String(entity.itemName || "") === "Research and Development Laboratories").length,
    1,
  );
}));

test("unsafe sleeper data sites now materialize sleeper databanks and immediate defenders instead of generic data cans", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    String(entry.resolvedName || "") === "Unsecured Frontier Database"
  ), "unsafe sleeper data layout");
  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:unsafe-sleeper-data",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 6630000000009,
    },
    nowMs: 3870,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);
  scene._dungeonUniverseEncounterKeys = new Set();

  const originalSpawnBatchInSystem = npcService.spawnNpcBatchInSystem;
  const calls = [];
  npcService.spawnNpcBatchInSystem = (systemID, options = {}) => {
    calls.push({
      systemID: Number(systemID),
      options: JSON.parse(JSON.stringify(options)),
    });
    return {
      success: true,
      data: {
        spawned: [{
          entity: {
            itemID: 999000000002,
          },
        }],
      },
    };
  };

  try {
    const materialized = dungeonUniverseSiteService._testing.materializeSiteContents(
      scene,
      instance,
      siteEntity,
      template,
      { spawnEncounters: true },
    );
    assert.equal(materialized.encountersSpawned, 1);
  } finally {
    npcService.spawnNpcBatchInSystem = originalSpawnBatchInSystem;
  }

  const siteContents = dungeonUniverseSiteService.listMaterializedUniverseSiteContentEntities(scene, {
    instanceID: Number(instance.instanceID),
  }).filter((entity) => entity && entity.dungeonMaterializedContainer === true);
  assert.equal(siteContents.length, 4);
  assert.equal(
    siteContents.some((entity) => /Sleeper Databank/i.test(String(entity.itemName || ""))),
    true,
  );
  assert.equal(calls.length, 1);
}));

test("silent battleground now materializes mixed relic/data caches and the central wrecked revenant prop", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    String(entry.resolvedName || "") === "Silent Battleground"
  ), "silent battleground layout");
  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:silent-battleground",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 6630000000010,
    },
    nowMs: 3880,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);

  dungeonUniverseSiteService._testing.materializeSiteContents(
    scene,
    instance,
    siteEntity,
    template,
    { spawnEncounters: false },
  );
  const siteContents = dungeonUniverseSiteService.listMaterializedUniverseSiteContentEntities(scene, {
    instanceID: Number(instance.instanceID),
  });
  const containers = siteContents.filter((entity) => entity && entity.dungeonMaterializedContainer === true);
  const environmentProps = siteContents.filter((entity) => entity && entity.dungeonMaterializedEnvironment === true);
  assert.equal(containers.length, 20);
  assert.equal(
    containers.filter((entity) => entity && entity.dungeonSiteContentAnalyzer === "data").length,
    10,
  );
  assert.equal(
    containers.filter((entity) => entity && entity.dungeonSiteContentAnalyzer === "relic").length,
    10,
  );
  assert.equal(
    environmentProps.some((entity) => /Wrecked Revenant/i.test(String(entity.itemName || ""))),
    true,
  );
}));

test("empire outpost combat signatures now materialize faction-appropriate outpost structures around the encounter", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    String(entry.resolvedName || "") === "Forgotten Amarr Outpost"
  ), "empire outpost combat layout");
  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:empire-outpost-combat",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 6630000000011,
    },
    nowMs: 3890,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);

  dungeonUniverseSiteService._testing.materializeSiteContents(
    scene,
    instance,
    siteEntity,
    template,
    { spawnEncounters: false },
  );
  const environmentProps = dungeonUniverseSiteService.listMaterializedUniverseSiteContentEntities(scene, {
    instanceID: Number(instance.instanceID),
  }).filter((entity) => entity && entity.dungeonMaterializedEnvironment === true);
  assert.equal(environmentProps.length > 0, true);
  assert.equal(
    environmentProps.some((entity) => /Amarr Outpost/i.test(String(entity.itemName || ""))),
    true,
  );
}));

test("AEGIS special combat signatures now materialize authored facility objects instead of only generic combat state", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    String(entry.resolvedName || "") === "AEGIS Secure Capital Construction Forges"
  ), "AEGIS authored facility layout");
  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:aegis-facility",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 6630000000012,
    },
    nowMs: 3900,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);

  dungeonUniverseSiteService._testing.materializeSiteContents(
    scene,
    instance,
    siteEntity,
    template,
    { spawnEncounters: false },
  );
  const environmentProps = dungeonUniverseSiteService.listMaterializedUniverseSiteContentEntities(scene, {
    instanceID: Number(instance.instanceID),
  }).filter((entity) => entity && entity.dungeonMaterializedEnvironment === true);
  assert.equal(environmentProps.length >= 5, true);
  assert.equal(
    environmentProps.some((entity) => /Capital Construction Forge/i.test(String(entity.itemName || ""))),
    true,
  );
}));

test("combat hacking distribution bases now materialize exact booster-lab containers, site loot metadata, and staged encounter plans", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    String(entry.resolvedName || "") === "Core Runner Exile Distribution Base"
  ), "combat hacking distribution base layout");
  assert.equal(String(template.populationHints && template.populationHints.source || ""), "site_specific_combat_hacking");
  assert.equal(Array.isArray(template.populationHints && template.populationHints.encounters), true);
  assert.equal(template.populationHints.encounters.length, 2);
  assert.equal(String(template.populationHints.encounters[0].trigger || ""), "on_load");
  assert.equal(String(template.populationHints.encounters[1].trigger || ""), "battleships_destroyed");
  assert.equal(template.populationHints.encounters[1].supported, true);

  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:combat-hacking-distribution",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 6630000000013,
    },
    nowMs: 3910,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  assert.equal(Array.isArray(siteEntity.dungeonLootProfiles), true);
  assert.equal(siteEntity.dungeonLootProfiles.length > 0, true);
  scene.addStaticEntity(siteEntity);

  dungeonUniverseSiteService._testing.materializeSiteContents(
    scene,
    instance,
    siteEntity,
    template,
    { spawnEncounters: false },
  );
  const siteContents = dungeonUniverseSiteService.listMaterializedUniverseSiteContentEntities(scene, {
    instanceID: Number(instance.instanceID),
  });
  const containers = siteContents.filter((entity) => entity && entity.dungeonMaterializedContainer === true);
  const environmentProps = siteContents.filter((entity) => entity && entity.dungeonMaterializedEnvironment === true);
  assert.equal(containers.length, 6);
  assert.equal(
    containers.some((entity) => /Test Crate/i.test(String(entity.itemName || ""))),
    true,
  );
  assert.equal(
    containers.some((entity) => /Victim's Stash/i.test(String(entity.itemName || ""))),
    true,
  );
  assert.equal(
    containers.some((entity) => /Prototype Crate/i.test(String(entity.itemName || ""))),
    true,
  );
  assert.equal(
    containers.every((entity) => String(entity.dungeonSiteContentLootProfile || "").trim() === "booster_site_loot"),
    true,
  );
  assert.equal(
    environmentProps.some((entity) => /Chemical Laboratory|Storage|Drug Lab/i.test(String(entity.itemName || ""))),
    true,
  );
}));

test("combat hacking distribution bases now seed actual loot into their inventory-backed hackable containers", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    String(entry.resolvedName || "") === "Core Runner Exile Distribution Base"
  ), "combat hacking loot population");
  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:combat-hacking-loot",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 6630000000025,
    },
    nowMs: 3915,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);

  dungeonUniverseSiteService._testing.materializeSiteContents(
    scene,
    instance,
    siteEntity,
    template,
    { spawnEncounters: false, nowMs: 3915 },
  );
  const containers = dungeonUniverseSiteService.listMaterializedUniverseSiteContentEntities(scene, {
    instanceID: Number(instance.instanceID),
  }).filter((entity) => entity && entity.dungeonMaterializedContainer === true);
  assert.equal(containers.length > 0, true);
  assert.equal(
    containers.every((entity) => listContainerItems(null, Number(entity.itemID)).length > 0),
    true,
  );
  const lootItems = containers.flatMap((entity) => listContainerItems(null, Number(entity.itemID)));
  assert.equal(
    lootItems.some((item) => /Booster|Reaction Formula|Biology|Neurotoxin|Drug Manufacturing/i.test(String(item && item.itemName || ""))),
    true,
  );
}));

test("combat hacking production facilities now materialize exact hackable can mixes and sentry-backed facility props", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    String(entry.resolvedName || "") === "Elohim Sooth Sayer Production Facility"
  ), "combat hacking production facility layout");
  assert.equal(String(template.populationHints && template.populationHints.source || ""), "site_specific_combat_hacking");
  assert.equal(Array.isArray(template.populationHints && template.populationHints.encounters), true);
  assert.equal(template.populationHints.encounters.length, 2);
  assert.equal(String(template.populationHints.encounters[1].trigger || ""), "battleships_destroyed");
  assert.equal(template.populationHints.encounters[1].supported, true);

  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:combat-hacking-production",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 6630000000014,
    },
    nowMs: 3920,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);

  dungeonUniverseSiteService._testing.materializeSiteContents(
    scene,
    instance,
    siteEntity,
    template,
    { spawnEncounters: false },
  );
  const siteContents = dungeonUniverseSiteService.listMaterializedUniverseSiteContentEntities(scene, {
    instanceID: Number(instance.instanceID),
  });
  const containers = siteContents.filter((entity) => entity && entity.dungeonMaterializedContainer === true);
  const environmentProps = siteContents.filter((entity) => entity && entity.dungeonMaterializedEnvironment === true);
  assert.equal(containers.length, 7);
  assert.equal(
    containers.filter((entity) => /Com Relay/i.test(String(entity.itemName || ""))).length,
    3,
  );
  assert.equal(
    containers.filter((entity) => entity && entity.dungeonSiteContentBonus === true).length,
    4,
  );
  assert.equal(
    environmentProps.some((entity) => /Cruise Missile Battery/i.test(String(entity.itemName || ""))),
    true,
  );
  assert.equal(
    environmentProps.some((entity) => /Energy Neutralizer Sentry/i.test(String(entity.itemName || ""))),
    true,
  );
}));

test("vital core reservoirs now arm delayed sleeper responses and materialize gas-cloud props instead of staying generic", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    String(entry.resolvedName || "") === "Vital Core Reservoir"
  ), "vital core reservoir exact layout");
  assert.equal(String(template.populationHints && template.populationHints.source || ""), "site_specific_gas");
  assert.equal(Array.isArray(template.populationHints && template.populationHints.encounters), true);
  assert.equal(String(template.populationHints.encounters[0] && template.populationHints.encounters[0].trigger || ""), "visible_countdown");

  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:vital-core-reservoir",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 6630000000015,
    },
    nowMs: 3930,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);
  scene._dungeonUniverseEncounterKeys = new Set();

  const originalSpawnBatchInSystem = npcService.spawnNpcBatchInSystem;
  let callCount = 0;
  npcService.spawnNpcBatchInSystem = () => {
    callCount += 1;
    return {
      success: true,
      data: {
        spawned: [{
          entity: {
            itemID: 999000000004,
          },
        }],
      },
    };
  };

  try {
    const materialized = dungeonUniverseSiteService._testing.materializeSiteContents(
      scene,
      instance,
      siteEntity,
      template,
      { spawnEncounters: true, nowMs: 3930 },
    );
    assert.equal(materialized.encountersSpawned, 0);
    assert.equal(callCount, 0);

    const afterArm = dungeonRuntime.getInstance(instance.instanceID);
    const armedAtMs = Number(
      afterArm &&
      afterArm.spawnState &&
      afterArm.spawnState.encounterStatesByKey &&
      afterArm.spawnState.encounterStatesByKey.vital_core_delayed_sleepers &&
      afterArm.spawnState.encounterStatesByKey.vital_core_delayed_sleepers.armedAtMs || 0
    );
    assert.equal(armedAtMs > 0, true);

    const tickResult = dungeonUniverseSiteService._testing.tickSceneSiteBehaviors(scene, {
      nowMs: armedAtMs + (900 * 1000) + 1,
    });
    assert.equal(tickResult.encountersSpawned, 1);
    assert.equal(callCount, 1);
  } finally {
    npcService.spawnNpcBatchInSystem = originalSpawnBatchInSystem;
  }

  const siteContents = dungeonUniverseSiteService.listMaterializedUniverseSiteContentEntities(scene, {
    instanceID: Number(instance.instanceID),
  });
  const hazards = siteContents.filter((entity) => entity && entity.dungeonMaterializedHazard === true);
  const environmentProps = siteContents.filter((entity) => entity && entity.dungeonMaterializedEnvironment === true);
  assert.equal(
    hazards.some((entity) => Number(entity && entity.dungeonHazardVisibleCountdownSeconds || 0) === 900),
    true,
  );
  assert.equal(environmentProps.length > 0, true);
}));

test("combat hacking staged reinforcements now spawn after the initial defender wave is cleared", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    String(entry.resolvedName || "") === "Core Runner Exile Distribution Base"
  ), "combat hacking staged reinforcements");
  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:combat-hacking-reinforcements",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 6630000000017,
    },
    nowMs: 3935,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);
  scene._dungeonUniverseEncounterKeys = new Set();

  const spawnedWaveIDs = [];
  const originalSpawnBatchInSystem = npcService.spawnNpcBatchInSystem;
  npcService.spawnNpcBatchInSystem = (systemID, options = {}) => {
    const waveNumber = spawnedWaveIDs.length + 1;
    const entityID = 999000000100 + waveNumber;
    scene.dynamicEntities.set(entityID, {
      itemID: entityID,
      kind: "npc",
    });
    spawnedWaveIDs.push(entityID);
    return {
      success: true,
      data: {
        spawned: [{
          entity: {
            itemID: entityID,
          },
        }],
      },
    };
  };

  try {
    const materialized = dungeonUniverseSiteService._testing.materializeSiteContents(
      scene,
      instance,
      siteEntity,
      template,
      { spawnEncounters: true, nowMs: 3935 },
    );
    assert.equal(materialized.encountersSpawned, 1);
    assert.deepEqual(spawnedWaveIDs, [999000000101]);

    scene.dynamicEntities.delete(999000000101);
    const tickResult = dungeonUniverseSiteService._testing.tickSceneSiteBehaviors(scene, {
      nowMs: 3936,
    });
    assert.equal(tickResult.encountersSpawned, 1);
    assert.deepEqual(spawnedWaveIDs, [999000000101, 999000000102]);

    const refreshed = dungeonRuntime.getInstance(instance.instanceID);
    const encounterStates = refreshed && refreshed.spawnState && refreshed.spawnState.encounterStatesByKey;
    assert.equal(
      Number(encounterStates && encounterStates.distribution_initial_defenders && encounterStates.distribution_initial_defenders.completedAtMs || 0) > 0,
      true,
    );
    assert.deepEqual(
      encounterStates && encounterStates.distribution_reinforcements && encounterStates.distribution_reinforcements.spawnedEntityIDs,
      [999000000102],
    );
  } finally {
    npcService.spawnNpcBatchInSystem = originalSpawnBatchInSystem;
  }
}));

test("hack failure effects now remove explosive ghost caches and mark hazard beacons as triggered", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    String(entry.resolvedName || "") === "Lesser Sansha Covert Research Facility"
  ), "ghost hack failure cleanup");
  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:ghost-hack-failure",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 6630000000018,
    },
    nowMs: 3937,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);

  dungeonUniverseSiteService._testing.materializeSiteContents(
    scene,
    instance,
    siteEntity,
    template,
    { spawnEncounters: false, nowMs: 3937 },
  );
  const beforeContents = dungeonUniverseSiteService.listMaterializedUniverseSiteContentEntities(scene, {
    instanceID: Number(instance.instanceID),
  });
  const beforeExplodingContainers = beforeContents.filter((entity) => (
    entity &&
    entity.dungeonMaterializedContainer === true &&
    entity.dungeonSiteContentFailureExplodes === true
  ));
  assert.equal(beforeExplodingContainers.length, 4);

  const triggerResult = dungeonUniverseSiteService._testing.triggerSiteEncounter(
    scene,
    instance,
    "hack_failure",
    { nowMs: 3938 },
  );
  assert.equal(triggerResult.success, true);
  assert.equal(triggerResult.data.encountersSpawned, 0);
  assert.equal(triggerResult.data.removedContainers, 4);
  assert.equal(triggerResult.data.triggeredHazards > 0, true);

  const afterContents = dungeonUniverseSiteService.listMaterializedUniverseSiteContentEntities(scene, {
    instanceID: Number(instance.instanceID),
  });
  assert.equal(
    afterContents.some((entity) => (
      entity &&
      entity.dungeonMaterializedContainer === true &&
      entity.dungeonSiteContentFailureExplodes === true
    )),
    false,
  );
  assert.equal(
    afterContents.some((entity) => (
      entity &&
      entity.dungeonMaterializedHazard === true &&
      String(entity.dungeonHazardState || "") === "triggered"
    )),
    true,
  );
}));

test("visible ghost countdowns now strip non-persistent caches, leave the bonus cache behind, and trigger hazard state", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    String(entry.resolvedName || "") === "Lesser Sansha Covert Research Facility"
  ), "ghost visible countdown cleanup");
  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:ghost-visible-countdown",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 6630000000026,
    },
    nowMs: 3940,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);
  scene._dungeonUniverseEncounterKeys = new Set();

  const originalSpawnBatchInSystem = npcService.spawnNpcBatchInSystem;
  let spawnCalls = 0;
  npcService.spawnNpcBatchInSystem = () => {
    spawnCalls += 1;
    return {
      success: true,
      data: {
        spawned: [{
          entity: {
            itemID: 999000000130,
          },
        }],
      },
    };
  };

  try {
    dungeonUniverseSiteService._testing.materializeSiteContents(
      scene,
      instance,
      siteEntity,
      template,
      { spawnEncounters: true, nowMs: 3940 },
    );
    const beforeContents = dungeonUniverseSiteService.listMaterializedUniverseSiteContentEntities(scene, {
      instanceID: Number(instance.instanceID),
    });
    assert.equal(
      beforeContents.filter((entity) => entity && entity.dungeonMaterializedContainer === true).length,
      5,
    );

    const tickResult = dungeonUniverseSiteService._testing.tickSceneSiteBehaviors(scene, {
      nowMs: 3940 + 31_000,
    });
    assert.equal(tickResult.encountersSpawned >= 1, true);
    assert.equal(spawnCalls >= 1, true);

    const afterContents = dungeonUniverseSiteService.listMaterializedUniverseSiteContentEntities(scene, {
      instanceID: Number(instance.instanceID),
    });
    const remainingContainers = afterContents.filter((entity) => entity && entity.dungeonMaterializedContainer === true);
    assert.equal(remainingContainers.length, 1);
    assert.equal(
      remainingContainers.every((entity) => entity && entity.dungeonSiteContentBonus === true),
      true,
    );
    assert.equal(
      afterContents.some((entity) => (
        entity &&
        entity.dungeonMaterializedHazard === true &&
        String(entity.dungeonHazardState || "") === "triggered"
      )),
      true,
    );
  } finally {
    npcService.spawnNpcBatchInSystem = originalSpawnBatchInSystem;
  }
}));

test("encounter-cleared dungeon rooms now advance deeper pocket progression instead of stopping at the first room", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    Array.isArray(entry.connections) &&
    entry.connections.length > 1 &&
    entry.environmentTemplates &&
    entry.environmentTemplates.roomTemplates &&
    Object.keys(entry.environmentTemplates.roomTemplates).length > 1
  ), "encounter-driven room progression");
  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:encounter-progression",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    spawnState: {
      populationHints: {
        source: "test_progression",
        encounters: [
          {
            key: "progression_wave_1",
            supported: true,
            spawnQuery: "npc_hostiles",
            amount: 1,
            trigger: "on_load",
            waveIndex: 1,
          },
          {
            key: "progression_wave_2",
            supported: true,
            spawnQuery: "npc_hostiles",
            amount: 1,
            trigger: "wave_cleared",
            waveIndex: 2,
          },
        ],
      },
    },
    metadata: {
      siteID: 6630000000019,
    },
    nowMs: 3939,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);
  scene._dungeonUniverseEncounterKeys = new Set();

  const spawnedWaveIDs = [];
  const originalSpawnBatchInSystem = npcService.spawnNpcBatchInSystem;
  npcService.spawnNpcBatchInSystem = () => {
    const entityID = 999000000200 + spawnedWaveIDs.length + 1;
    scene.dynamicEntities.set(entityID, { itemID: entityID, kind: "npc" });
    spawnedWaveIDs.push(entityID);
    return {
      success: true,
      data: {
        spawned: [{
          entity: {
            itemID: entityID,
          },
        }],
      },
    };
  };

  try {
    dungeonUniverseSiteService._testing.materializeSiteContents(
      scene,
      instance,
      siteEntity,
      template,
      { spawnEncounters: true, nowMs: 3939 },
    );
    scene.dynamicEntities.delete(999000000201);
    const firstTick = dungeonUniverseSiteService._testing.tickSceneSiteBehaviors(scene, { nowMs: 3940 });
    scene.dynamicEntities.delete(999000000202);
    const secondTick = dungeonUniverseSiteService._testing.tickSceneSiteBehaviors(scene, { nowMs: 3941 });
    assert.equal((firstTick.gatesUnlocked + secondTick.gatesUnlocked) >= 1, true);

    const refreshed = dungeonRuntime.getInstance(instance.instanceID);
    assert.equal(
      String(refreshed.roomStatesByKey && refreshed.roomStatesByKey["room:entry"] && refreshed.roomStatesByKey["room:entry"].state || ""),
      "completed",
    );
    assert.equal(
      Object.entries(refreshed.roomStatesByKey || {}).some(([roomKey, roomState]) => (
        roomKey !== "room:entry" &&
        ["active", "completed"].includes(String(roomState && roomState.state || ""))
      )),
      true,
    );
    assert.equal(
      Object.values(refreshed.gateStatesByKey || {}).some((gateState) => String(gateState && gateState.state || "") === "unlocked"),
      true,
    );
    assert.equal(
      ["in_progress", "completed"].includes(String(refreshed.objectiveState && refreshed.objectiveState.state || "")),
      true,
    );
  } finally {
    npcService.spawnNpcBatchInSystem = originalSpawnBatchInSystem;
  }
}));

test("generic derived data sites now realize loot into their default hackable containers", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    String(entry.siteFamily || "") === "data" &&
    String(entry.populationHints && entry.populationHints.source || "") === "family_derived"
  ), "generic derived data site");
  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:generic-data-loot",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 6630000000021,
    },
    nowMs: 3950,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);

  dungeonUniverseSiteService._testing.materializeSiteContents(
    scene,
    instance,
    siteEntity,
    template,
    { spawnEncounters: false, nowMs: 3950 },
  );

  const containers = dungeonUniverseSiteService.listMaterializedUniverseSiteContentEntities(scene, {
    instanceID: Number(instance.instanceID),
  }).filter((entity) => entity && entity.dungeonMaterializedContainer === true);
  assert.equal(containers.length > 0, true);
  assert.equal(
    containers.some((entity) => listContainerItems(null, Number(entity.itemID)).length > 0),
    true,
  );
}));

test("completed combat encounter waves now materialize reward caches from encounter loot metadata", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    String(entry.siteFamily || "") === "combat"
  ), "combat reward cache");
  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:combat-reward-cache",
    lifecycleState: "active",
    siteKind: "signature",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    spawnState: {
      populationHints: {
        source: "test_combat_rewards",
        encounters: [
          {
            key: "reward_wave_1",
            supported: true,
            spawnQuery: "npc_hostiles",
            amount: 1,
            trigger: "on_load",
            waveIndex: 1,
          },
          {
            key: "reward_wave_2",
            supported: true,
            spawnQuery: "npc_hostiles",
            amount: 1,
            trigger: "wave_cleared",
            waveIndex: 2,
            lootProfile: "combat_overseer_loot",
            lootTags: ["overseer_effect", "pirate_tag"],
          },
        ],
      },
    },
    metadata: {
      siteID: 6630000000022,
    },
    nowMs: 3955,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);
  scene._dungeonUniverseEncounterKeys = new Set();

  const spawnedWaveIDs = [];
  const originalSpawnBatchInSystem = npcService.spawnNpcBatchInSystem;
  npcService.spawnNpcBatchInSystem = () => {
    const entityID = 999000000260 + spawnedWaveIDs.length + 1;
    scene.dynamicEntities.set(entityID, { itemID: entityID, kind: "npc" });
    spawnedWaveIDs.push(entityID);
    return {
      success: true,
      data: {
        spawned: [{
          entity: {
            itemID: entityID,
          },
        }],
      },
    };
  };

  try {
    dungeonUniverseSiteService._testing.materializeSiteContents(
      scene,
      instance,
      siteEntity,
      template,
      { spawnEncounters: true, nowMs: 3955 },
    );
    scene.dynamicEntities.delete(999000000261);
    dungeonUniverseSiteService._testing.tickSceneSiteBehaviors(scene, { nowMs: 3956 });
    dungeonUniverseSiteService._testing.tickSceneSiteBehaviors(scene, { nowMs: 3957 });
    scene.dynamicEntities.delete(999000000262);
    const rewardTicks = [
      dungeonUniverseSiteService._testing.tickSceneSiteBehaviors(scene, { nowMs: 3958 }),
      dungeonUniverseSiteService._testing.tickSceneSiteBehaviors(scene, { nowMs: 3959 }),
    ];
    assert.equal(
      rewardTicks.some((tick) => Math.max(0, Number(tick && tick.rewardContainersSpawned) || 0) >= 1),
      true,
    );

    const rewardContainers = dungeonUniverseSiteService.listMaterializedUniverseSiteContentEntities(scene, {
      instanceID: Number(instance.instanceID),
    }).filter((entity) => (
      entity &&
      entity.dungeonMaterializedContainer === true &&
      String(entity.dungeonSiteContentRole || "") === "encounter_reward"
    ));
    assert.equal(rewardContainers.length > 0, true);
    assert.equal(
      rewardContainers.some((entity) => listContainerItems(null, Number(entity.itemID)).length > 0),
      true,
    );
  } finally {
    npcService.spawnNpcBatchInSystem = originalSpawnBatchInSystem;
  }
}));

test("cleared combat anomalies now mark lifecycle completed for rotation instead of lingering empty", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    String(entry.siteFamily || "") === "combat"
  ), "cleared combat anomaly rotation");
  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:cleared-combat-anomaly-rotation",
    lifecycleState: "active",
    siteKind: "anomaly",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    spawnState: {
      populationHints: {
        source: "test_completed_anomaly",
        encounters: [
          {
            key: "rotation_wave_1",
            supported: true,
            spawnQuery: "npc_hostiles",
            amount: 1,
            trigger: "on_load",
            waveIndex: 1,
          },
          {
            key: "rotation_wave_2",
            supported: true,
            spawnQuery: "npc_hostiles",
            amount: 1,
            trigger: "wave_cleared",
            waveIndex: 2,
          },
        ],
        encounterStatesByKey: {
          rotation_wave_1: {
            key: "rotation_wave_1",
            spawnedAtMs: 4000,
            completedAtMs: 4010,
            remainingEntityIDs: [],
            spawnedEntityIDs: [999000000301],
          },
          rotation_wave_2: {
            key: "rotation_wave_2",
            spawnedAtMs: 4020,
            completedAtMs: 4030,
            remainingEntityIDs: [],
            spawnedEntityIDs: [999000000302],
          },
        },
      },
      encounterStatesByKey: {
        rotation_wave_1: {
          key: "rotation_wave_1",
          spawnedAtMs: 4000,
          completedAtMs: 4010,
          remainingEntityIDs: [],
          spawnedEntityIDs: [999000000301],
        },
        rotation_wave_2: {
          key: "rotation_wave_2",
          spawnedAtMs: 4020,
          completedAtMs: 4030,
          remainingEntityIDs: [],
          spawnedEntityIDs: [999000000302],
        },
      },
    },
    metadata: {
      siteID: 6630000000023,
    },
    nowMs: 3999,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);

  const materializeResult = dungeonUniverseSiteService.ensureSiteContentsMaterialized(scene, instance, {
    spawnEncounters: false,
    nowMs: 4040,
  });
  assert.equal(materializeResult && materializeResult.success, true);

  const tickResult = dungeonUniverseSiteService._testing.tickSceneSiteBehaviors(scene, {
    nowMs: 4041,
  });
  assert.equal(Math.max(0, Number(tickResult && tickResult.encounterCompletions) || 0) >= 0, true);

  const refreshed = dungeonRuntime.getInstance(instance.instanceID);
  assert.equal(String(refreshed && refreshed.lifecycleState || ""), "completed");
  assert.equal(
    Math.max(0, Number(refreshed && refreshed.timers && refreshed.timers.expiresAtMs) || 0),
    4041,
  );
}));

test("wormhole ore deposits now materialize exact ore-field dressing and immediate sleeper defenders instead of generic anomalies", withSnapshots(() => {
  const template = findClientTemplate((entry) => (
    String(entry.resolvedName || "") === "Rarified Core Deposit"
  ), "exact wormhole ore layout");
  assert.equal(String(template.populationHints && template.populationHints.source || ""), "site_specific_ore");

  const instance = dungeonRuntime.createInstance({
    templateID: template.templateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:rarified-core-deposit",
    lifecycleState: "active",
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
    },
    metadata: {
      siteID: 6630000000016,
    },
    nowMs: 3940,
  });
  const scene = spaceRuntime.ensureScene(30000142);
  const siteEntity = dungeonUniverseSiteService.buildSiteEntity(instance);
  assert.ok(siteEntity);
  scene.addStaticEntity(siteEntity);
  scene._dungeonUniverseEncounterKeys = new Set();

  const originalSpawnBatchInSystem = npcService.spawnNpcBatchInSystem;
  let callCount = 0;
  npcService.spawnNpcBatchInSystem = () => {
    callCount += 1;
    return {
      success: true,
      data: {
        spawned: [{
          entity: {
            itemID: 999000000005,
          },
        }],
      },
    };
  };

  try {
    const materialized = dungeonUniverseSiteService._testing.materializeSiteContents(
      scene,
      instance,
      siteEntity,
      template,
      { spawnEncounters: true, nowMs: 3940 },
    );
    assert.equal(materialized.encountersSpawned, 1);
    assert.equal(callCount, 1);
  } finally {
    npcService.spawnNpcBatchInSystem = originalSpawnBatchInSystem;
  }

  const environmentProps = dungeonUniverseSiteService.listMaterializedUniverseSiteContentEntities(scene, {
    instanceID: Number(instance.instanceID),
  }).filter((entity) => entity && entity.dungeonMaterializedEnvironment === true);
  assert.equal(environmentProps.length > 0, true);
  assert.equal(
    environmentProps.some((entity) => /Arkonor|Bistot|Gneiss|Kernite|Omber|Pyroxeres/i.test(String(entity.itemName || ""))),
    true,
  );
}));

test("phase 3 universe reconcile seeds broad persistent families across security bands and runtime rotation advances them without reseeding", withSnapshots(() => {
  const systemsByBand = pickUniverseSeededSystemsByBand();
  const systemIDs = Object.values(systemsByBand).filter(Boolean);
  const firstSummary = dungeonUniverseRuntime.reconcileUniversePersistentSites({
    systemIDs,
    nowMs: 4444,
  });
  assert.equal(systemIDs.length >= 4, true);
  assert.equal(
    Object.values(firstSummary.families || {}).some((familySummary) => Number(familySummary && familySummary.desiredSiteCount || 0) > 0),
    true,
  );

  const broadInstancesBefore = systemIDs.flatMap((systemID) => (
    dungeonRuntime.listActiveInstancesBySystem(systemID, { full: true })
      .filter((instance) => String(instance.siteOrigin || "").trim().toLowerCase() !== "generatedmining")
  ));
  assert.equal(broadInstancesBefore.length > 0, true);
  const broadFamilies = new Set(broadInstancesBefore.map((instance) => String(instance.siteFamily || "").trim().toLowerCase()));
  assert.equal(broadFamilies.has("combat") || broadFamilies.has("combat_anomaly"), true);

  const firstHashes = new Map(
    broadInstancesBefore.map((instance) => [
      String(instance.siteKey),
      String(instance.metadata && instance.metadata.definitionHash || ""),
    ]),
  );
  const firstRotations = new Map(
    broadInstancesBefore.map((instance) => [
      String(instance.siteKey),
      Number(instance.metadata && instance.metadata.rotationIndex || 0),
    ]),
  );
  const laterSummary = dungeonUniverseRuntime.advanceUniversePersistentSites({
    nowMs: 7 * 24 * 60 * 60 * 1000,
  });
  const broadInstancesAfter = systemIDs.flatMap((systemID) => (
    dungeonRuntime.listActiveInstancesBySystem(systemID, { full: true })
      .filter((instance) => String(instance.siteOrigin || "").trim().toLowerCase() !== "generatedmining")
  ));
  assert.equal(broadInstancesAfter.length > 0, true);
  assert.equal(laterSummary.rotatedCount > 0, true);
  assert.equal(broadInstancesAfter.length, broadInstancesBefore.length);
  assert.equal(
    broadInstancesAfter.some((instance) => (
      (
        firstHashes.get(String(instance.siteKey)) !== String(instance.metadata && instance.metadata.definitionHash || "")
      ) ||
      (
        Number(instance.metadata && instance.metadata.rotationIndex || 0) >
        Number(firstRotations.get(String(instance.siteKey)) || 0)
      )
    )),
    true,
  );
}));

test("phase 3 spawn profiles now use exact sparse target system pools instead of near-universe blanket coverage", () => {
  const bandCounts = countSystemsByBand();
  const families = ["combat", "combat_anomaly", "data", "relic", "ore", "gas", "ghost", "combat_hacking"];
  const activeSystems = new Set();

  for (const family of families) {
    const profile = dungeonAuthority.getSpawnProfile(family);
    assert.ok(profile && profile.bands, `expected ${family} spawn profile`);
    for (const band of ["highsec", "lowsec", "nullsec", "wormhole"]) {
      const bandProfile = profile.bands[band];
      const eligible = dungeonUniverseRuntime._testing.listEligibleSystemIDsForBandProfile(
        family,
        band,
        bandProfile,
      );
      const expected = dungeonUniverseRuntime._testing.resolveBandTargetSystemCount(
        bandCounts[band],
        bandProfile,
      );
      if (expected > 0) {
        assert.equal(
          eligible.length,
          expected,
          `expected ${family}/${band} to seed exactly ${expected} systems`,
        );
      } else if (Number(bandProfile && bandProfile.slotsPerSystem || 0) <= 0) {
        assert.equal(eligible.length, 0, `expected ${family}/${band} to be disabled`);
      }
      for (const systemID of eligible) {
        activeSystems.add(systemID);
      }
    }
  }

  assert.equal(activeSystems.size < 5000, true, "expected combat anomaly density without near-universe blanket seeding");
  assert.equal(activeSystems.size > 1000, true, "expected meaningful persistent site coverage across New Eden");
});

test("phase 3 wormhole-band profiles seed non-wormhole families in wormhole space without replacing wormhole mechanics", () => {
  for (const family of ["combat", "combat_anomaly", "data", "relic", "gas", "ghost", "combat_hacking"]) {
    const profile = dungeonAuthority.getSpawnProfile(family);
    assert.ok(profile && profile.bands && profile.bands.wormhole, `expected ${family} wormhole band profile`);
    const eligible = dungeonUniverseRuntime._testing.listEligibleSystemIDsForBandProfile(
      family,
      "wormhole",
      profile.bands.wormhole,
    );
    assert.equal(eligible.length > 0, true, `expected ${family} to seed at least one wormhole system`);
    assert.equal(
      eligible.every((systemID) => dungeonUniverseRuntime._testing.getSecurityBand(systemID) === "wormhole"),
      true,
      `expected ${family} wormhole pool to stay inside wormhole space`,
    );
  }
});

test("combat anomalies now seed through a denser pool than probe-only combat signatures, especially in nullsec", () => {
  const anomalyProfile = dungeonAuthority.getSpawnProfile("combat_anomaly");
  const signatureProfile = dungeonAuthority.getSpawnProfile("combat");
  assert.ok(anomalyProfile && anomalyProfile.bands, "expected combat_anomaly spawn profile");
  assert.ok(signatureProfile && signatureProfile.bands, "expected combat signature spawn profile");

  const nullAnomalySystems = dungeonUniverseRuntime._testing.listEligibleSystemIDsForBandProfile(
    "combat_anomaly",
    "nullsec",
    anomalyProfile.bands.nullsec,
  );
  const nullSignatureSystems = dungeonUniverseRuntime._testing.listEligibleSystemIDsForBandProfile(
    "combat",
    "nullsec",
    signatureProfile.bands.nullsec,
  );

  assert.equal(nullAnomalySystems.length > nullSignatureSystems.length, true);
  assert.equal(Number(anomalyProfile.bands.nullsec.slotsPerSystem) > Number(signatureProfile.bands.nullsec.slotsPerSystem), true);

  const sampledSystemIDs = nullAnomalySystems.slice(0, 3);
  const summary = dungeonUniverseRuntime.reconcileUniversePersistentSites({
    systemIDs: sampledSystemIDs,
    includeMining: false,
    nowMs: 4610,
  });
  assert.equal(summary.desiredSiteCount > 0, true);

  for (const systemID of sampledSystemIDs) {
    const anomalies = dungeonRuntime.listActiveInstancesBySystem(systemID, { full: true })
      .filter((instance) => instance && String(instance.siteKind || "").trim().toLowerCase() === "anomaly");
    assert.equal(anomalies.length >= Number(anomalyProfile.bands.nullsec.slotsPerSystem || 0), true);
  }
});

test("universe-seeded persistent sites now anchor at roughly four AU from nearby scene anchors", withSnapshots(() => {
  const systemsByBand = pickUniverseSeededSystemsByBand();
  const broadSystemIDs = Object.values(systemsByBand).filter(Boolean);
  const broadSummary = dungeonUniverseRuntime.reconcileUniversePersistentSites({
    systemIDs: broadSystemIDs,
    nowMs: 4600,
  });
  assert.equal(broadSummary.desiredSiteCount > 0, true);

  const broadInstances = broadSystemIDs.flatMap((systemID) => (
    dungeonRuntime.listActiveInstancesBySystem(systemID, { full: true })
      .filter((instance) => String(instance.siteOrigin || "").trim().toLowerCase() !== "generatedmining")
  ));
  assert.equal(broadInstances.length > 0, true);
  assert.equal(
    broadInstances.every((instance) => {
      const anchorDistanceAu = Number(
        instance &&
        instance.metadata &&
        instance.metadata.anchorDistanceAu,
      ) || Number(
        instance &&
        instance.spawnState &&
        instance.spawnState.anchorDistanceAu,
      ) || 0;
      return anchorDistanceAu >= 3.5 && anchorDistanceAu <= 4.5;
    }),
    true,
  );

  const miningSystemID = pickAsteroidBeltSystem();
  const miningSummary = dungeonUniverseRuntime.reconcileUniversePersistentSites({
    systemIDs: [miningSystemID],
    nowMs: 4700,
  });
  assert.equal(miningSummary.desiredSiteCount > 0, true);
  const generatedMiningInstances = dungeonRuntime.listActiveInstancesBySystem(miningSystemID, {
    full: true,
  }).filter((instance) => String(instance.siteOrigin || "").trim().toLowerCase() === "generatedmining");
  assert.equal(generatedMiningInstances.length > 0, true);
  assert.equal(
    generatedMiningInstances.every((instance) => {
      const anchorDistanceMeters = Number(
        instance &&
        instance.metadata &&
        instance.metadata.anchorDistanceMeters,
      ) || 0;
      return anchorDistanceMeters >= (3.5 * DEFAULT_AU_METERS) &&
        anchorDistanceMeters <= (4.5 * DEFAULT_AU_METERS);
    }),
    true,
  );
}));

test("generated mining ice slots now rotate through the same timed universe-slot lifecycle and refresh persisted mining rows", withSnapshots(() => {
  const systemID = pickAsteroidBeltSystem();
  const firstSummary = dungeonUniverseRuntime.reconcileUniversePersistentSites({
    systemIDs: [systemID],
    nowMs: 5000,
  });
  assert.equal(firstSummary.desiredSiteCount > 0, true);

  const generatedBefore = dungeonRuntime.listActiveInstancesBySystem(systemID, { full: true })
    .filter((instance) => String(instance.siteOrigin || "").trim().toLowerCase() === "generatedmining");
  assert.equal(generatedBefore.length > 0, true);

  const beforeBySiteKey = new Map(
    generatedBefore.map((instance) => [
      String(instance.siteKey),
      {
        definitionHash: String(instance.metadata && instance.metadata.definitionHash || ""),
        rotationIndex: Number(instance.metadata && instance.metadata.rotationIndex || 0),
        expiresAtMs: Number(instance.timers && instance.timers.expiresAtMs || 0),
        position: JSON.stringify(instance.position || null),
      },
    ]),
  );
  const laterNowMs = Math.max(
    ...generatedBefore.map((instance) => Number(instance.timers && instance.timers.expiresAtMs || 0)),
  ) + 1;

  const rotationSummary = dungeonUniverseRuntime.advanceUniversePersistentSites({
    nowMs: laterNowMs,
  });
  assert.equal(rotationSummary.rotatedCount > 0, true);

  const generatedAfter = dungeonRuntime.listActiveInstancesBySystem(systemID, { full: true })
    .filter((instance) => String(instance.siteOrigin || "").trim().toLowerCase() === "generatedmining");
  assert.equal(generatedAfter.length, generatedBefore.length);
  assert.equal(
    generatedAfter.every((instance) => (
      instance.runtimeFlags &&
      instance.runtimeFlags.universePersistent === true &&
      Number(instance.timers && instance.timers.expiresAtMs || 0) > laterNowMs
    )),
    true,
  );
  assert.equal(
    generatedAfter.some((instance) => {
      const before = beforeBySiteKey.get(String(instance.siteKey));
      return before && (
        String(instance.metadata && instance.metadata.definitionHash || "") !== before.definitionHash ||
        Number(instance.metadata && instance.metadata.rotationIndex || 0) > before.rotationIndex ||
        JSON.stringify(instance.position || null) !== before.position
      );
    }),
    true,
  );

  const persistedStateResult = database.read(
    "miningRuntimeState",
    `/systems/${String(systemID)}/entities`,
  );
  assert.equal(persistedStateResult.success, true);
  const persistedEntities = Object.values(persistedStateResult.data || {});
  assert.equal(persistedEntities.length > 0, true);
  assert.equal(
    persistedEntities.some((entry) => Number(entry && entry.updatedAtMs || 0) === laterNowMs),
    true,
  );
}));

test("startup-style universe persistent rotation preserves active seeded totals for the targeted systems", withSnapshots(() => {
  const systemsByBand = pickUniverseSeededSystemsByBand();
  const systemIDs = Object.values(systemsByBand).filter(Boolean);
  const firstSummary = dungeonUniverseRuntime.reconcileUniversePersistentSites({
    systemIDs,
    nowMs: 6100,
  });
  assert.equal(firstSummary.desiredSiteCount > 0, true);

  const beforeCounts = dungeonUniverseRuntime.summarizeActiveUniverseSeededCounts(systemIDs);
  const latestExpiry = Math.max(
    0,
    ...systemIDs.flatMap((systemID) => (
      dungeonRuntime.listActiveInstancesBySystem(systemID, { full: true })
        .map((instance) => Number(instance && instance.timers && instance.timers.expiresAtMs || 0))
    )),
  );
  const laterNowMs = latestExpiry + 1;

  const rotationSummary = dungeonUniverseRuntime.advanceUniversePersistentSites({
    nowMs: laterNowMs,
    lifecycleReason: "startup-resume",
  });
  const afterCounts = dungeonUniverseRuntime.summarizeActiveUniverseSeededCounts(systemIDs);
  const expectedAfterTotal = beforeCounts.totalCount - rotationSummary.expiredCount + rotationSummary.rotatedCount;

  assert.equal(rotationSummary.rotatedCount > 0, true);
  assert.equal(afterCounts.totalCount, expectedAfterTotal);
  assert.equal(afterCounts.totalCount, beforeCounts.totalCount);
}));

test("universe reconcile status stays current over time once the one-time seed descriptor matches", withSnapshots(() => {
  const seededAtMs = 8888;
  const laterNowMs = seededAtMs + (90 * 24 * 60 * 60 * 1000);
  const status = dungeonUniverseRuntime.getUniverseReconcileStatus(seededAtMs);
  dungeonRuntimeState.writeUniverseReconcileMeta({
    descriptorKey: status.descriptor.descriptorKey,
    broadDescriptorKey: status.descriptor.broadDescriptorKey,
    miningDescriptorKey: status.descriptor.miningDescriptorKey,
    lastCompletedAtMs: seededAtMs,
    lastScope: "full",
    lastReason: "test-current",
  });

  const laterStatus = dungeonUniverseRuntime.getUniverseReconcileStatus(laterNowMs);
  assert.equal(laterStatus.fullUpToDate, true);
  assert.equal(laterStatus.broadUpToDate, true);
  assert.equal(laterStatus.miningUpToDate, true);
}));

test("startup prepare skips startup mutation when cached full-universe state is already current", withSnapshots(() => {
  const systemID = pickAsteroidBeltSystem();
  const seededAtMs = 8888;
  const laterNowMs = seededAtMs + (90 * 24 * 60 * 60 * 1000);
  const status = dungeonUniverseRuntime.getUniverseReconcileStatus(seededAtMs);
  dungeonRuntimeState.writeUniverseReconcileMeta({
    descriptorKey: status.descriptor.descriptorKey,
    broadDescriptorKey: status.descriptor.broadDescriptorKey,
    miningDescriptorKey: status.descriptor.miningDescriptorKey,
    lastCompletedAtMs: seededAtMs,
    lastScope: "full",
    lastReason: "test-current",
  });

  const prepare = dungeonUniverseRuntime.prepareStartupUniversePersistentSites({
    startupSystemIDs: [systemID],
    nowMs: laterNowMs,
  });
  assert.equal(prepare.status.fullUpToDate, true);
  assert.equal(Boolean(prepare.startupSummary && prepare.startupSummary.skipped), true);
  assert.equal(prepare.startupSummary.reason, "cached_universe_current");
  assert.equal(prepare.background.needsFullReconcile, false);
  assert.equal(
    dungeonRuntime.listActiveInstancesBySystem(systemID, { full: true }).length,
    0,
  );
}));

test("startup prepare reports manual seed required instead of mutating startup systems when universe state is stale", withSnapshots(() => {
  const systemID = pickAsteroidBeltSystem();
  const nowMs = 9999;

  const prepare = dungeonUniverseRuntime.prepareStartupUniversePersistentSites({
    startupSystemIDs: [systemID],
    nowMs,
  });
  assert.equal(prepare.status.fullUpToDate, false);
  assert.equal(Boolean(prepare.startupSummary && prepare.startupSummary.skipped), true);
  assert.equal(prepare.startupSummary.reason, "manual_seed_required");
  assert.equal(prepare.background.needsFullReconcile, true);
  assert.equal(
    dungeonRuntime.listActiveInstancesBySystem(systemID, { full: true }).length,
    0,
  );
}));
