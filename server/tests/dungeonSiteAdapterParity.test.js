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
const dungeonAuthority = require(path.join(
  repoRoot,
  "server/src/services/dungeon/dungeonAuthority",
));
const dungeonRuntime = require(path.join(
  repoRoot,
  "server/src/services/dungeon/dungeonRuntime",
));
const DungeonExplorationMgrService = require(path.join(
  repoRoot,
  "server/src/services/dungeon/dungeonExplorationMgrService",
));
const miningAnomalyProvider = require(path.join(
  repoRoot,
  "server/src/services/exploration/signatures/providers/miningAnomalyProvider",
));
const sceneAnomalySiteProvider = require(path.join(
  repoRoot,
  "server/src/services/exploration/signatures/providers/sceneAnomalySiteProvider",
));
const sceneSignatureSiteProvider = require(path.join(
  repoRoot,
  "server/src/services/exploration/signatures/providers/sceneSignatureSiteProvider",
));
const sceneStaticSiteProvider = require(path.join(
  repoRoot,
  "server/src/services/exploration/signatures/providers/sceneStaticSiteProvider",
));
const miningResourceSiteService = require(path.join(
  repoRoot,
  "server/src/services/mining/miningResourceSiteService",
));
const spaceRuntime = require(path.join(
  repoRoot,
  "server/src/space/runtime",
));
const {
  extractDictEntries,
  marshalObjectToObject,
} = require(path.join(
  repoRoot,
  "server/src/services/_shared/serviceHelpers",
));

const SNAPSHOT_TABLES = [
  "dungeonRuntimeState",
];

function readTable(tableName) {
  const result = database.read(tableName, "/");
  return result && result.success ? JSON.parse(JSON.stringify(result.data)) : {};
}

function writeTable(tableName, payload) {
  const result = database.write(tableName, "/", payload);
  assert.equal(result.success, true, `Failed to restore ${tableName}`);
}

function withSnapshots(fn) {
  return async () => {
    const tableSnapshots = Object.fromEntries(
      SNAPSHOT_TABLES.map((tableName) => [tableName, readTable(tableName)]),
    );
    const configSnapshot = {
      miningGeneratedIceSitesEnabled: config.miningGeneratedIceSitesEnabled,
      miningGeneratedGasSitesEnabled: config.miningGeneratedGasSitesEnabled,
      miningIceSitesHighSecPerSystem: config.miningIceSitesHighSecPerSystem,
      miningIceSitesLowSecPerSystem: config.miningIceSitesLowSecPerSystem,
      miningIceSitesNullSecPerSystem: config.miningIceSitesNullSecPerSystem,
      miningIceSitesWormholePerSystem: config.miningIceSitesWormholePerSystem,
      miningGasSitesHighSecPerSystem: config.miningGasSitesHighSecPerSystem,
      miningGasSitesLowSecPerSystem: config.miningGasSitesLowSecPerSystem,
      miningGasSitesNullSecPerSystem: config.miningGasSitesNullSecPerSystem,
      miningGasSitesWormholePerSystem: config.miningGasSitesWormholePerSystem,
    };

    try {
      dungeonAuthority.clearCache();
      dungeonRuntime.resetRuntimeForTests();
      spaceRuntime._testing.clearScenes();
      await fn();
    } finally {
      Object.assign(config, configSnapshot);
      for (const [tableName, payload] of Object.entries(tableSnapshots)) {
        writeTable(tableName, payload);
      }
      dungeonRuntime.clearRuntimeCache();
      dungeonAuthority.clearCache();
      spaceRuntime._testing.clearScenes();
    }
  };
}

function pickAsteroidBeltSystem() {
  const belts = readStaticRows(TABLE.ASTEROID_BELTS);
  assert.ok(belts.length > 0, "expected stored asteroid belt rows");
  const firstBelt = belts[0];
  const systemID = Number(firstBelt && firstBelt.solarSystemID) || 0;
  assert.ok(systemID > 0, "expected asteroid belt system ID");
  return systemID;
}

test("generated mining anomaly sites shadow stable dungeon instances with real template metadata", withSnapshots(() => {
  Object.assign(config, {
    miningGeneratedIceSitesEnabled: true,
    miningGeneratedGasSitesEnabled: true,
    miningIceSitesHighSecPerSystem: 1,
    miningIceSitesLowSecPerSystem: 1,
    miningIceSitesNullSecPerSystem: 1,
    miningIceSitesWormholePerSystem: 0,
    miningGasSitesHighSecPerSystem: 1,
    miningGasSitesLowSecPerSystem: 1,
    miningGasSitesNullSecPerSystem: 1,
    miningGasSitesWormholePerSystem: 1,
  });

  const systemID = pickAsteroidBeltSystem();
  const scene = spaceRuntime.ensureScene(systemID);
  const generatedAnchors = miningResourceSiteService._testing
    .listGeneratedResourceSiteEntities(scene)
    .filter((entity) => entity && entity.generatedMiningSiteAnchor === true);
  assert.equal(generatedAnchors.length > 0, true);

  const firstPass = miningAnomalyProvider.listAnomalySites(systemID, { scene });
  const secondPass = miningAnomalyProvider.listAnomalySites(systemID, { scene });
  assert.equal(firstPass.length > 0, true);
  assert.equal(secondPass.length, firstPass.length);

  for (const site of firstPass) {
    assert.equal(Number(site.instanceID) > 0, true);
    assert.equal(Number(site.dungeonID) > 0, true);
    assert.equal(Number(site.dungeonNameID) > 0, true);
    assert.ok(site.templateID);
    assert.ok(site.siteKey);
    if (site.archetypeID != null) {
      assert.equal(Number(site.archetypeID) > 0, true);
    }
  }

  const firstBySiteID = new Map(firstPass.map((site) => [site.siteID, site]));
  for (const site of secondPass) {
    const previous = firstBySiteID.get(site.siteID);
    assert.ok(previous);
    assert.equal(site.instanceID, previous.instanceID);
    assert.equal(site.templateID, previous.templateID);
    assert.equal(site.dungeonID, previous.dungeonID);
  }

  const runtimeSummaries = dungeonRuntime.listActiveInstancesBySystem(systemID);
  assert.equal(runtimeSummaries.length, firstPass.length);
}));

test("scene static sites can shadow dungeon runtime instances from dungeonNameID and faction parity hints", withSnapshots(() => {
  const template = dungeonAuthority.getTemplateByID("client-dungeon:43");
  assert.ok(template);

  const systemID = 30000142;
  const scene = spaceRuntime.ensureScene(systemID);
  scene.staticEntities.push({
    itemID: 991000123456,
    typeID: 16,
    itemName: "Parity Static Site",
    position: { x: 42000, y: 0, z: -12000 },
    signalTrackerStaticSite: true,
    signalTrackerStaticSiteNameID: template.dungeonNameID,
    signalTrackerStaticSiteFactionID: template.factionID,
    signalTrackerStaticSiteFamily: template.siteFamily,
  });

  const firstPass = sceneStaticSiteProvider.listStaticSites(systemID, { scene });
  const secondPass = sceneStaticSiteProvider.listStaticSites(systemID, { scene });
  assert.equal(firstPass.length, 1);
  assert.equal(secondPass.length, 1);

  const site = firstPass[0];
  assert.equal(site.templateID, template.templateID);
  assert.equal(Number(site.instanceID) > 0, true);
  assert.equal(Number(site.dungeonID), Number(template.sourceDungeonID));
  assert.equal(Number(site.dungeonNameID), Number(template.dungeonNameID));
  assert.equal(Number(site.factionID), Number(template.factionID));

  assert.equal(secondPass[0].instanceID, site.instanceID);
  assert.equal(secondPass[0].templateID, site.templateID);
}));

test("scene signature and anomaly providers shadow stable dungeon runtime instances for dynamic authored sites", withSnapshots(() => {
  const signatureTemplate = dungeonAuthority.getTemplateByID("client-dungeon:43");
  const anomalyTemplate = dungeonAuthority.getTemplateByID("client-dungeon:1215");
  assert.ok(signatureTemplate);
  assert.ok(anomalyTemplate);

  const systemID = 30000142;
  const scene = spaceRuntime.ensureScene(systemID);
  scene.dynamicEntities.set(991000000101, {
    itemID: 991000000101,
    typeID: 30574,
    slimName: "Parity Signature Dungeon",
    position: { x: 1250, y: 2500, z: -1250 },
    signalTrackerSignatureSite: true,
    signalTrackerSiteFamily: signatureTemplate.siteFamily,
    signalTrackerSiteTemplateID: signatureTemplate.templateID,
    dungeonID: signatureTemplate.sourceDungeonID,
    dungeonNameID: signatureTemplate.dungeonNameID,
    archetypeID: signatureTemplate.archetypeID,
    factionID: signatureTemplate.factionID,
    signalTrackerSiteDifficulty: signatureTemplate.difficulty || 1,
  });
  scene.dynamicEntities.set(991000000102, {
    itemID: 991000000102,
    typeID: anomalyTemplate.entryObjectTypeID || 30574,
    slimName: "Parity Anomaly Dungeon",
    position: { x: -2250, y: 1500, z: 500 },
    signalTrackerAnomalySite: true,
    signalTrackerSiteFamily: anomalyTemplate.siteFamily,
    signalTrackerSiteTemplateID: anomalyTemplate.templateID,
    dungeonID: anomalyTemplate.sourceDungeonID,
    dungeonNameID: anomalyTemplate.dungeonNameID,
    archetypeID: anomalyTemplate.archetypeID,
    factionID: anomalyTemplate.factionID,
    signalTrackerStrengthAttributeID: 209,
    signalTrackerEntryObjectTypeID: anomalyTemplate.entryObjectTypeID || 30574,
  });

  const signatureSites = sceneSignatureSiteProvider.listSignatureSites(systemID, { scene });
  const anomalySites = sceneAnomalySiteProvider.listAnomalySites(systemID, { scene });
  assert.equal(signatureSites.length, 1);
  assert.equal(anomalySites.length, 1);

  assert.equal(signatureSites[0].templateID, signatureTemplate.templateID);
  assert.equal(Number(signatureSites[0].instanceID) > 0, true);
  assert.equal(Number(signatureSites[0].dungeonID), Number(signatureTemplate.sourceDungeonID));
  assert.equal(anomalySites[0].templateID, anomalyTemplate.templateID);
  assert.equal(Number(anomalySites[0].instanceID) > 0, true);
  assert.equal(Number(anomalySites[0].dungeonID), Number(anomalyTemplate.sourceDungeonID));

  const runtimeBySystem = dungeonRuntime.listActiveInstancesBySystem(systemID);
  const dynamicProviderInstances = runtimeBySystem.filter((entry) => (
    String(entry.siteKey || "").startsWith("sceneanomalysite:") ||
    String(entry.siteKey || "").startsWith("scenesignaturesite:")
  ));
  assert.equal(dynamicProviderInstances.length, 2);
  assert.equal(
    dynamicProviderInstances.every((entry) => String(entry.siteKey || "").length > 0),
    true,
  );
}));

test("dungeonExplorationMgr surfaces runtime-backed anomaly and signature instances for the packaged-client dungeon seam", withSnapshots(() => {
  const signatureTemplate = dungeonAuthority.getTemplateByID("client-dungeon:43");
  const anomalyTemplate = dungeonAuthority.getTemplateByID("client-dungeon:1215");
  assert.ok(signatureTemplate);
  assert.ok(anomalyTemplate);

  const systemID = 30000142;
  const scene = spaceRuntime.ensureScene(systemID);
  scene.dynamicEntities.set(991000000201, {
    itemID: 991000000201,
    typeID: 30574,
    slimName: "Parity Signature Dungeon",
    position: { x: 5000, y: 1000, z: 2500 },
    signalTrackerSignatureSite: true,
    signalTrackerSiteFamily: signatureTemplate.siteFamily,
    signalTrackerSiteTemplateID: signatureTemplate.templateID,
    dungeonID: signatureTemplate.sourceDungeonID,
    dungeonNameID: signatureTemplate.dungeonNameID,
    archetypeID: signatureTemplate.archetypeID,
    factionID: signatureTemplate.factionID,
  });
  scene.dynamicEntities.set(991000000202, {
    itemID: 991000000202,
    typeID: anomalyTemplate.entryObjectTypeID || 30574,
    slimName: "Parity Anomaly Dungeon",
    position: { x: -5000, y: 500, z: 1200 },
    signalTrackerAnomalySite: true,
    signalTrackerSiteFamily: anomalyTemplate.siteFamily,
    signalTrackerSiteTemplateID: anomalyTemplate.templateID,
    dungeonID: anomalyTemplate.sourceDungeonID,
    dungeonNameID: anomalyTemplate.dungeonNameID,
    archetypeID: anomalyTemplate.archetypeID,
    factionID: anomalyTemplate.factionID,
    signalTrackerStrengthAttributeID: 209,
    signalTrackerEntryObjectTypeID: anomalyTemplate.entryObjectTypeID || 30574,
  });

  const service = new DungeonExplorationMgrService();
  const result = service.Handle_GetInstancesForSolarsystem([systemID]);
  const entries = extractDictEntries(result);
  assert.equal(entries.length >= 2, true);

  const resolved = entries.map(([, value]) => marshalObjectToObject(value));
  const anomaly = resolved.find((entry) => Number(entry.signatureID) === 991000000202);
  const signature = resolved.find((entry) => Number(entry.signatureID) === 991000000201);
  assert.ok(anomaly);
  assert.ok(signature);
  assert.equal(Number(anomaly.instanceID) > 0, true);
  assert.equal(Number(signature.instanceID) > 0, true);
  assert.equal(Number(anomaly.dungeonID), Number(anomalyTemplate.sourceDungeonID));
  assert.equal(Number(signature.dungeonID), Number(signatureTemplate.sourceDungeonID));
  assert.equal(Number(anomaly.scanStrengthAttribute), 209);
  assert.equal(Number(signature.signatureRadius) > 0, true);
  assert.equal(Number(signature.scanStrengthValue) > 0, true);
  assert.equal(signature.isScannable, true);
  assert.equal(anomaly.isScannable, true);
}));

test("scene provider shadow sites recreate a fresh active dungeon instance when the old one is terminal", withSnapshots(() => {
  const signatureTemplate = dungeonAuthority.getTemplateByID("client-dungeon:43");
  assert.ok(signatureTemplate);

  const systemID = 30000142;
  const scene = spaceRuntime.ensureScene(systemID);
  scene.dynamicEntities.set(991000000301, {
    itemID: 991000000301,
    typeID: 30574,
    slimName: "Parity Signature Dungeon",
    position: { x: 800, y: 1600, z: -400 },
    signalTrackerSignatureSite: true,
    signalTrackerSiteFamily: signatureTemplate.siteFamily,
    signalTrackerSiteTemplateID: signatureTemplate.templateID,
    dungeonID: signatureTemplate.sourceDungeonID,
    dungeonNameID: signatureTemplate.dungeonNameID,
    archetypeID: signatureTemplate.archetypeID,
    factionID: signatureTemplate.factionID,
  });

  const firstPass = sceneSignatureSiteProvider.listSignatureSites(systemID, { scene });
  assert.equal(firstPass.length, 1);
  const firstInstanceID = Number(firstPass[0].instanceID);
  assert.equal(firstInstanceID > 0, true);

  dungeonRuntime.setLifecycleState(firstInstanceID, "despawned", {
    lifecycleReason: "test-expired",
    despawnAtMs: 4000,
    nowMs: 4000,
  });

  const secondPass = sceneSignatureSiteProvider.listSignatureSites(systemID, { scene });
  assert.equal(secondPass.length, 1);
  const secondInstanceID = Number(secondPass[0].instanceID);
  assert.equal(secondInstanceID > 0, true);
  assert.notEqual(secondInstanceID, firstInstanceID);
  assert.equal(secondPass[0].templateID, signatureTemplate.templateID);

  const activeInstances = dungeonRuntime.listActiveInstancesBySystem(systemID)
    .filter((entry) => String(entry.siteKey || "").startsWith("scenesignaturesite:"));
  assert.equal(activeInstances.length, 1);
  assert.equal(Number(activeInstances[0].instanceID), secondInstanceID);
}));
