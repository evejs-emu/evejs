const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

process.env.EVEJS_ASTEROID_FIELDS = "true";

const repoRoot = path.join(__dirname, "..", "..");

const config = require(path.join(repoRoot, "server/src/config"));
const runtime = require(path.join(repoRoot, "server/src/space/runtime"));
const {
  TABLE,
  readStaticRows,
} = require(path.join(
  repoRoot,
  "server/src/services/_shared/referenceData",
));
const {
  getMineableState,
  resetSceneMiningState,
  summarizeSceneMiningState,
} = require(path.join(
  repoRoot,
  "server/src/services/mining/miningRuntimeState",
));
const miningResourceSiteService = require(path.join(
  repoRoot,
  "server/src/services/mining/miningResourceSiteService",
));

function pickAsteroidBeltSystem() {
  const belts = readStaticRows(TABLE.ASTEROID_BELTS);
  assert.ok(belts.length > 0, "expected stored asteroid belt rows");
  const firstBelt = belts[0];
  const systemID = Number(firstBelt && firstBelt.solarSystemID) || 0;
  assert.ok(systemID > 0, "expected asteroid belt system ID");
  return systemID;
}

function snapshotMiningSiteConfig() {
  return {
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
    miningGeneratedSiteRadiusMeters: config.miningGeneratedSiteRadiusMeters,
    miningIceChunksPerSite: config.miningIceChunksPerSite,
    miningGasCloudsPerSite: config.miningGasCloudsPerSite,
  };
}

function restoreMiningSiteConfig(snapshot) {
  Object.assign(config, snapshot);
}

test("scene bootstrap adds deterministic generated ice runtime content with live mineable state", (t) => {
  const originalConfig = snapshotMiningSiteConfig();
  t.after(() => {
    restoreMiningSiteConfig(originalConfig);
    runtime._testing.clearScenes();
  });

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
    miningGeneratedSiteRadiusMeters: 12_000,
    miningIceChunksPerSite: 4,
    miningGasCloudsPerSite: 5,
  });

  runtime._testing.clearScenes();
  const systemID = pickAsteroidBeltSystem();
  const scene = runtime.ensureScene(systemID);
  const generatedEntities = miningResourceSiteService._testing.listGeneratedResourceSiteEntities(scene);
  const iceMineables = generatedEntities.filter((entity) => (
    entity.generatedMiningSiteKind === "ice" &&
    entity.generatedMiningSiteAnchor !== true
  ));

  assert.ok(iceMineables.length > 0, "expected generated ice mineables");

  const iceState = getMineableState(scene, iceMineables[0].itemID);
  assert.ok(iceState, "expected live mining state for generated ice");
  assert.equal(iceState.yieldKind, "ice");
  assert.ok(iceState.originalQuantity > 0);

  const summary = summarizeSceneMiningState(scene);
  assert.ok(summary.iceCount >= iceMineables.length);
  assert.equal(
    generatedEntities.some((entity) => entity.generatedMiningSiteKind === "gas"),
    false,
    "expected gas to be materialized through dungeon signatures, not generated mining anomalies",
  );

  const firstIceIDs = iceMineables.map((entity) => entity.itemID).sort((left, right) => left - right);
  const resetResult = resetSceneMiningState(scene, {
    rebuildAsteroids: false,
    rebuildResourceSites: true,
    broadcast: false,
    nowMs: scene.getCurrentSimTimeMs(),
  });
  assert.equal(resetResult.success, true);

  const secondIceIDs = miningResourceSiteService._testing
    .listGeneratedResourceSiteEntities(scene)
    .filter((entity) => entity.generatedMiningSiteKind === "ice" && entity.generatedMiningSiteAnchor !== true)
    .map((entity) => entity.itemID)
    .sort((left, right) => left - right);
  assert.deepEqual(secondIceIDs, firstIceIDs, "expected deterministic resource-site entity IDs after reset");
});

test("generated mining ice sites never anchor from the sun in Zarzakh fallback scenes", (t) => {
  const originalConfig = snapshotMiningSiteConfig();
  t.after(() => {
    restoreMiningSiteConfig(originalConfig);
    runtime._testing.clearScenes();
  });

  Object.assign(config, {
    miningGeneratedIceSitesEnabled: true,
    miningGeneratedGasSitesEnabled: false,
    miningIceSitesHighSecPerSystem: 0,
    miningIceSitesLowSecPerSystem: 0,
    miningIceSitesNullSecPerSystem: 1,
    miningIceSitesWormholePerSystem: 0,
    miningIceChunksPerSite: 3,
  });

  runtime._testing.clearScenes();
  const zarzakhSystemID = 30100000;
  const scene = runtime.ensureScene(zarzakhSystemID);
  const anchors = miningResourceSiteService._testing.getAnchorCandidates(scene);

  assert.ok(anchors.length > 0, "expected fallback anchors for Zarzakh");
  assert.equal(
    anchors.some((anchor) => String(anchor.itemName || "").trim() === "Zarzakh - Star"),
    false,
    "expected Zarzakh fallback anchors to exclude the sun",
  );

  const generatedAnchors = miningResourceSiteService._testing
    .listGeneratedResourceSiteEntities(scene)
    .filter((entity) => entity && entity.generatedMiningSiteAnchor === true);
  assert.ok(generatedAnchors.length > 0, "expected generated ice site anchors in Zarzakh");
  assert.equal(
    generatedAnchors.every((entity) => {
      const x = Number(entity.position && entity.position.x) || 0;
      const y = Number(entity.position && entity.position.y) || 0;
      const z = Number(entity.position && entity.position.z) || 0;
      return Math.sqrt((x * x) + (y * y) + (z * z)) > 326_000_000;
    }),
    true,
    "expected generated Zarzakh ice sites to spawn outside the local sun radius",
  );
});

test("generated mining site geometry clamps field centers and mineables outside the local sun exclusion radius", () => {
  const exclusionScene = {
    staticEntities: [
      {
        kind: "sun",
        groupID: 6,
        radius: 300_000_000,
        position: { x: 0, y: 0, z: 0 },
      },
    ],
  };
  const exclusionRadius = miningResourceSiteService._testing.resolveSunExclusionRadius(exclusionScene);
  assert.ok(exclusionRadius > 300_000_000);

  const clampedCenter = miningResourceSiteService._testing.clampPositionOutsideSun(
    exclusionScene,
    { x: 50_000_000, y: 0, z: 0 },
    100_000,
  );
  const centerDistance = Math.sqrt(
    (Number(clampedCenter.x) || 0) ** 2 +
    (Number(clampedCenter.y) || 0) ** 2 +
    (Number(clampedCenter.z) || 0) ** 2
  );
  assert.ok(
    centerDistance >= exclusionRadius + 100_000,
    "expected clamped site centers to stay outside the sun exclusion radius",
  );

  const clampedMineable = miningResourceSiteService._testing.clampPositionOutsideSun(
    exclusionScene,
    { x: 10_000_000, y: 10_000_000, z: 0 },
    40_000,
  );
  const mineableDistance = Math.sqrt(
    (Number(clampedMineable.x) || 0) ** 2 +
    (Number(clampedMineable.y) || 0) ** 2 +
    (Number(clampedMineable.z) || 0) ** 2
  );
  assert.ok(
    mineableDistance >= exclusionRadius + 40_000,
    "expected clamped mineables to stay outside the sun exclusion radius",
  );
});
