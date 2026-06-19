const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const {
  TABLE,
  readStaticRows,
} = require(path.join(
  repoRoot,
  "server/src/services/_shared/referenceData",
));
const ScanMgrService = require(path.join(
  repoRoot,
  "server/src/services/exploration/scanMgrService",
));
const dungeonRuntime = require(path.join(
  repoRoot,
  "server/src/services/dungeon/dungeonRuntime",
));
const dungeonUniverseRuntime = require(path.join(
  repoRoot,
  "server/src/services/dungeon/dungeonUniverseRuntime",
));
const sceneAnomalySiteProvider = require(path.join(
  repoRoot,
  "server/src/services/exploration/signatures/providers/sceneAnomalySiteProvider",
));
const miningAnomalyProvider = require(path.join(
  repoRoot,
  "server/src/services/exploration/signatures/providers/miningAnomalyProvider",
));
const sceneSignatureSiteProvider = require(path.join(
  repoRoot,
  "server/src/services/exploration/signatures/providers/sceneSignatureSiteProvider",
));
const spaceRuntime = require(path.join(
  repoRoot,
  "server/src/space/runtime",
));
const {
  extractDictEntries,
} = require(path.join(
  repoRoot,
  "server/src/services/_shared/serviceHelpers",
));

const SNAPSHOT_TABLES = [
  "dungeonRuntimeState",
  "miningRuntimeState",
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
  return Number(belts[0] && belts[0].solarSystemID) || 0;
}

function pickBroadSeedSystem() {
  const dungeonAuthority = require(path.join(
    repoRoot,
    "server/src/services/dungeon/dungeonAuthority",
  ));
  const systems = readStaticRows(TABLE.SOLAR_SYSTEMS);
  const families = ["combat", "data", "relic", "ore", "gas", "ghost", "combat_hacking"];
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
      return systemID;
    }
  }
  assert.fail("expected at least one universe-seeded broad persistent site system");
}

function pickGasSeedSystem(nowMs = 7777) {
  const profile = require(path.join(
    repoRoot,
    "server/src/services/dungeon/dungeonAuthority",
  )).getSpawnProfile("gas");
  assert.ok(profile && profile.bands, "expected gas spawn profile");
  const systems = readStaticRows(TABLE.SOLAR_SYSTEMS);
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
    if (!["lowsec", "nullsec", "wormhole"].includes(band)) {
      continue;
    }
    if (dungeonUniverseRuntime._testing.systemMatchesSpawnBandProfile(systemID, "gas", profile.bands[band])) {
      return systemID;
    }
  }
  assert.fail("expected at least one universe-seeded gas signature system");
}

function buildSession(systemID) {
  return {
    characterID: 140000003,
    charid: 140000003,
    userid: 2,
    solarsystemid: systemID,
    solarsystemid2: systemID,
    _boundObjectIDs: {},
    _boundObjectState: {},
    sendNotification() {},
  };
}

function withSnapshots(fn) {
  return async () => {
    const snapshots = Object.fromEntries(
      SNAPSHOT_TABLES.map((tableName) => [tableName, readTable(tableName)]),
    );
    try {
      dungeonRuntime.resetRuntimeForTests();
      dungeonRuntime.clearRuntimeCache();
      ScanMgrService._testing.clearSignalTrackerState();
      spaceRuntime._testing.clearScenes();
      await fn();
    } finally {
      for (const [tableName, payload] of Object.entries(snapshots)) {
        writeTable(tableName, payload);
      }
      dungeonRuntime.clearRuntimeCache();
      ScanMgrService._testing.clearSignalTrackerState();
      spaceRuntime._testing.clearScenes();
    }
  };
}

test("scanMgr full state includes universe-seeded broad dungeon signatures and anomalies after Phase 3 reconcile", withSnapshots(() => {
  const systemID = pickBroadSeedSystem();
  dungeonUniverseRuntime.reconcileUniversePersistentSites({
    systemIDs: [systemID],
    nowMs: 6666,
  });

  const scene = spaceRuntime.ensureScene(systemID);
  const broadSignatureSites = sceneSignatureSiteProvider.listSignatureSites(systemID, { scene });
  const broadAnomalySites = sceneAnomalySiteProvider.listAnomalySites(systemID, { scene });
  assert.equal(broadSignatureSites.length + broadAnomalySites.length > 0, true);

  const service = new ScanMgrService();
  const session = buildSession(systemID);
  const fullState = service.Handle_GetFullState([], session);
  const anomalyEntries = extractDictEntries(Array.isArray(fullState) ? fullState[0] : null);
  const signatureEntries = extractDictEntries(Array.isArray(fullState) ? fullState[1] : null);

  const anomalySiteIDs = new Set(anomalyEntries.map(([siteID]) => Number(siteID)));
  const signatureSiteIDs = new Set(signatureEntries.map(([siteID]) => Number(siteID)));
  assert.equal(
    broadAnomalySites.every((site) => anomalySiteIDs.has(Number(site.siteID))),
    true,
  );
  assert.equal(
    broadSignatureSites.every((site) => signatureSiteIDs.has(Number(site.siteID))),
    true,
  );
}));

test("scanMgr exposes seeded gas sites through the signature lane instead of the mining anomaly lane", withSnapshots(() => {
  const systemID = pickGasSeedSystem();
  dungeonUniverseRuntime.reconcileUniversePersistentSites({
    systemIDs: [systemID],
    nowMs: 7777,
  });

  const scene = spaceRuntime.ensureScene(systemID);
  const gasSignatureSites = sceneSignatureSiteProvider.listSignatureSites(systemID, { scene })
    .filter((site) => String(site && site.family || "").trim().toLowerCase() === "gas");
  const gasAnomalySites = sceneAnomalySiteProvider.listAnomalySites(systemID, { scene })
    .filter((site) => String(site && site.family || "").trim().toLowerCase() === "gas");
  assert.equal(gasSignatureSites.length > 0, true);
  assert.equal(gasAnomalySites.length, 0);

  const service = new ScanMgrService();
  const session = buildSession(systemID);
  const fullState = service.Handle_GetFullState([], session);
  const anomalyEntries = extractDictEntries(Array.isArray(fullState) ? fullState[0] : null);
  const signatureEntries = extractDictEntries(Array.isArray(fullState) ? fullState[1] : null);
  const anomalySiteIDs = new Set(anomalyEntries.map(([siteID]) => Number(siteID)));
  const signatureSiteIDs = new Set(signatureEntries.map(([siteID]) => Number(siteID)));

  assert.equal(
    gasSignatureSites.every((site) => signatureSiteIDs.has(Number(site.siteID))),
    true,
  );
  assert.equal(
    gasSignatureSites.some((site) => anomalySiteIDs.has(Number(site.siteID))),
    false,
  );
}));

test("scene-backed site providers do not materialize off-system scenes unless explicitly requested", withSnapshots(() => {
  const gasSystemID = pickGasSeedSystem();
  const miningSystemID = pickAsteroidBeltSystem();

  dungeonUniverseRuntime.reconcileUniversePersistentSites({
    systemIDs: [gasSystemID, miningSystemID],
    nowMs: 8888,
  });

  assert.equal(spaceRuntime.isSolarSystemSceneLoaded(gasSystemID), false);
  assert.equal(spaceRuntime.isSolarSystemSceneLoaded(miningSystemID), false);

  const cachedGasSites = sceneSignatureSiteProvider.listSignatureSites(gasSystemID);
  const cachedMiningSites = miningAnomalyProvider.listAnomalySites(miningSystemID);

  assert.deepEqual(cachedGasSites, []);
  assert.deepEqual(cachedMiningSites, []);
  assert.equal(spaceRuntime.isSolarSystemSceneLoaded(gasSystemID), false);
  assert.equal(spaceRuntime.isSolarSystemSceneLoaded(miningSystemID), false);

  const loadedGasSites = sceneSignatureSiteProvider.listSignatureSites(gasSystemID, {
    loadScene: true,
  });
  const loadedMiningSites = miningAnomalyProvider.listAnomalySites(miningSystemID, {
    loadScene: true,
  });

  assert.equal(loadedGasSites.length > 0, true);
  assert.equal(loadedMiningSites.length > 0, true);
  assert.equal(spaceRuntime.isSolarSystemSceneLoaded(gasSystemID), true);
  assert.equal(spaceRuntime.isSolarSystemSceneLoaded(miningSystemID), true);
}));
