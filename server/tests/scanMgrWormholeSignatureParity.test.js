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
const MachoNetService = require(path.join(
  repoRoot,
  "server/src/services/machoNet/machoNetService",
));
const ScanMgrService = require(path.join(
  repoRoot,
  "server/src/services/exploration/scanMgrService",
));
const chatCommands = require(path.join(
  repoRoot,
  "server/src/services/chat/chatCommands",
));
const wormholeRuntime = require(path.join(
  repoRoot,
  "server/src/services/exploration/wormholes/wormholeRuntime",
));
const wormholeRuntimeState = require(path.join(
  repoRoot,
  "server/src/services/exploration/wormholes/wormholeRuntimeState",
));
const signatureRuntime = require(path.join(
  repoRoot,
  "server/src/services/exploration/signatures/signatureRuntime",
));
const explorationAuthority = require(path.join(
  repoRoot,
  "server/src/services/exploration/explorationAuthority",
));
const probeRuntimeState = require(path.join(
  repoRoot,
  "server/src/services/exploration/probes/probeRuntimeState",
));
const probeScanRuntime = require(path.join(
  repoRoot,
  "server/src/services/exploration/probes/probeScanRuntime",
));
const probeSceneRuntime = require(path.join(
  repoRoot,
  "server/src/services/exploration/probes/probeSceneRuntime",
));
const dungeonRuntime = require(path.join(
  repoRoot,
  "server/src/services/dungeon/dungeonRuntime",
));
const dungeonUniverseRuntime = require(path.join(
  repoRoot,
  "server/src/services/dungeon/dungeonUniverseRuntime",
));
const miningResourceSiteService = require(path.join(
  repoRoot,
  "server/src/services/mining/miningResourceSiteService",
));
const structureState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureState",
));
const spaceRuntime = require(path.join(
  repoRoot,
  "server/src/space/runtime",
));
const {
  extractDictEntries,
  marshalObjectToObject,
  unwrapMarshalValue,
} = require(path.join(
  repoRoot,
  "server/src/services/_shared/serviceHelpers",
));
const {
  getTypeAttributeValue,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));

const TEST_SYSTEM_ID = 31000007;

const originalWormholeState = JSON.parse(JSON.stringify(
  database.read("wormholeRuntimeState", "/").data || {},
));
const originalProbeState = JSON.parse(JSON.stringify(
  database.read("probeRuntimeState", "/").data || {},
));
const originalStructuresState = JSON.parse(JSON.stringify(
  database.read("structures", "/").data || {},
));
const emptyWormholeState = {
  version: 2,
  nextPairSequence: 1,
  nextEndpointSequence: 1,
  universeSeededAtMs: 0,
  pairsByID: {},
  staticSlotsByKey: {},
  polarizationByCharacter: {},
};
const emptyProbeState = {
  version: 2,
  nextProbeSequence: 1,
  charactersByID: {},
};
const originalWormholesEnabled = config.wormholesEnabled;
const PERSISTENT_SITE_TABLES = [
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

function snapshotPersistentSiteTables() {
  return Object.fromEntries(
    PERSISTENT_SITE_TABLES.map((tableName) => [tableName, readTable(tableName)]),
  );
}

function restorePersistentSiteTables(snapshot) {
  for (const [tableName, payload] of Object.entries(snapshot || {})) {
    writeTable(tableName, payload);
  }
  dungeonRuntime.clearRuntimeCache();
}

function restoreState(snapshot) {
  database.write("wormholeRuntimeState", "/", JSON.parse(JSON.stringify(snapshot)));
  wormholeRuntimeState.clearRuntimeCache();
}

function restoreProbeState(snapshot) {
  database.write("probeRuntimeState", "/", JSON.parse(JSON.stringify(snapshot)));
  probeRuntimeState.clearRuntimeCache();
}

function restoreStructuresState(snapshot) {
  database.write("structures", "/", JSON.parse(JSON.stringify(snapshot)));
  structureState.clearStructureCaches();
}

function buildSession(systemID = TEST_SYSTEM_ID) {
  const notifications = [];
  return {
    characterID: 140000003,
    charid: 140000003,
    userid: 2,
    solarsystemid: systemID,
    solarsystemid2: systemID,
    _boundObjectIDs: {},
    _boundObjectState: {},
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    get notifications() {
      return notifications;
    },
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

function pickGeneratedMiningSeedSystem(nowMs = Date.now()) {
  const definitions = dungeonUniverseRuntime.listDesiredGeneratedMiningDefinitions(null, nowMs);
  const systemID = Number(definitions[0] && definitions[0].solarSystemID) || 0;
  assert.ok(systemID > 0, "expected at least one generated-mining seed system");
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
  };
}

function restoreMiningSiteConfig(snapshot) {
  Object.assign(config, snapshot);
}

function seedPersistedProbes(session, probeSpecs = []) {
  const expiry = (
    (BigInt(Date.now()) * 10000n) +
    116444736000000000n +
    (BigInt(60 * 60) * 10_000_000n)
  ).toString();
  const probeMap = new Map(
    (Array.isArray(probeSpecs) ? probeSpecs : []).map((probe, index) => {
      const probeID = Number(probe && probe.probeID) || (9800 + index);
      return [
        probeID,
        {
          probeID,
          typeID: Number(probe && probe.typeID) || 30013,
          launchShipID: Number(probe && probe.launchShipID) || 2990000728,
          launcherItemID: Number(probe && probe.launcherItemID) || 2990000732,
          launcherFlagID: Number(probe && probe.launcherFlagID) || 27,
          pos: Array.isArray(probe && probe.pos) ? probe.pos : [1000 * (index + 1), 0, 0],
          destination: Array.isArray(probe && probe.destination)
            ? probe.destination
            : Array.isArray(probe && probe.pos)
              ? probe.pos
              : [1000 * (index + 1), 0, 0],
          scanRange: Number(probe && probe.scanRange) || 10_000,
          rangeStep: Number(probe && probe.rangeStep) || 2,
          state: probe && probe.state === 0 ? 0 : 1,
          expiry: String(probe && probe.expiry ? probe.expiry : expiry),
        },
      ];
    }),
  );
  probeRuntimeState.upsertCharacterProbes(
    session.characterID,
    session.solarsystemid2 || session.solarsystemid,
    probeMap,
    { nowMs: Date.now() },
  );
}

function getSignatureEntries(fullState) {
  const signatures = Array.isArray(fullState) ? fullState[1] : null;
  return extractDictEntries(signatures);
}

function getAnomalyEntries(fullState) {
  const anomalies = Array.isArray(fullState) ? fullState[0] : null;
  return extractDictEntries(anomalies);
}

function getStructureEntries(fullState) {
  const structures = Array.isArray(fullState) ? fullState[3] : null;
  return extractDictEntries(structures);
}

function getStaticEntries(fullState) {
  const staticSites = Array.isArray(fullState) ? fullState[2] : null;
  return extractDictEntries(staticSites);
}

function getKeyValField(rawKeyVal, fieldName) {
  const entries = extractDictEntries(rawKeyVal && rawKeyVal.args);
  const match = entries.find(([key]) => String(key) === String(fieldName));
  return match ? match[1] : undefined;
}

test.beforeEach(() => {
  config.wormholesEnabled = true;
  restoreState(emptyWormholeState);
  restoreProbeState(emptyProbeState);
  restoreStructuresState(originalStructuresState);
  ScanMgrService._testing.clearSignalTrackerState();
  spaceRuntime._testing.clearScenes();
});

test.after(() => {
  config.wormholesEnabled = originalWormholesEnabled;
  restoreState(originalWormholeState);
  restoreProbeState(originalProbeState);
  restoreStructuresState(originalStructuresState);
});

test("machoNet advertises scanMgr to the packaged client", () => {
  const service = new MachoNetService();
  const serviceInfo = service.getServiceInfoDict();
  const entries = extractDictEntries(serviceInfo);
  assert(entries.some(([name]) => String(name) === "scanMgr"));
});

test("scanMgr GetSystemScanMgr returns a real bound object registration", () => {
  const service = new ScanMgrService();
  const session = buildSession();

  const boundObject = service.Handle_GetSystemScanMgr([], session);

  assert.equal(boundObject.type, "substruct");
  assert.equal(boundObject.value.type, "substream");
  assert.match(String(boundObject.value.value[0]), /^N=\d+:\d+$/);
  assert.equal(session._boundObjectIDs.scanMgr, boundObject.value.value[0]);
});

test("scanMgr full state exposes source-side wormhole signatures with stable scan target IDs", () => {
  const seeded = wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  assert.equal(seeded.success, true);

  const pair = seeded.data.createdPairs[0];
  const service = new ScanMgrService();
  const session = buildSession(TEST_SYSTEM_ID);

  const fullState = service.Handle_GetFullState([], session);
  const signatureEntries = getSignatureEntries(fullState);
  assert(signatureEntries.length >= 1);

  const sourceEntry = signatureEntries.find(
    ([siteID]) => Number(siteID) === Number(pair.source.endpointID),
  );
  assert(sourceEntry, "expected source-side signature entry");

  const sourceInfo = marshalObjectToObject(sourceEntry[1]);
  assert.match(String(sourceInfo.targetID), /^[A-Z]{3}-\d{3}$/);
  assert(Array.isArray(sourceInfo.position));
  assert.equal(sourceInfo.position.length, 3);
  assert(Number(sourceInfo.deviation) > 0);
  const deviationEntry = (sourceEntry[1] && sourceEntry[1].args && sourceEntry[1].args.entries || [])
    .find(([name]) => String(name) === "deviation");
  assert(deviationEntry, "expected deviation entry on signature KeyVal");
  assert.equal(deviationEntry[1].type, "real");

  const firstTargetID = service.Handle_GetScanTargetID([pair.source.endpointID], session);
  const secondTargetID = service.Handle_GetScanTargetID([pair.source.endpointID], session);
  assert.equal(firstTargetID, secondTargetID);
  assert.equal(firstTargetID, sourceInfo.targetID);
});

test("existing wormhole signature target IDs stay stable when new wormholes are added to the same system", () => {
  const seeded = wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  assert.equal(seeded.success, true);

  const pair = seeded.data.createdPairs[0];
  const service = new ScanMgrService();
  const session = buildSession(TEST_SYSTEM_ID);
  const targetIDBefore = service.Handle_GetScanTargetID([pair.source.endpointID], session);

  const spawned = wormholeRuntime.spawnRandomPairs(TEST_SYSTEM_ID, 1, Date.now() + 1);
  assert.equal(Array.isArray(spawned), true);
  assert.equal(spawned.length, 1);

  const targetIDAfter = service.Handle_GetScanTargetID([pair.source.endpointID], session);
  assert.equal(
    targetIDAfter,
    targetIDBefore,
    "expected existing visible signature IDs to remain stable when new wormholes appear in-system",
  );

  const fullState = service.Handle_GetFullState([], session);
  const signatureEntries = getSignatureEntries(fullState);
  const sourceEntry = signatureEntries.find(
    ([siteID]) => Number(siteID) === Number(pair.source.endpointID),
  );
  assert(sourceEntry, "expected original wormhole signature entry after random spawn");
  const sourceInfo = marshalObjectToObject(sourceEntry[1]);
  assert.equal(String(sourceInfo.targetID), String(targetIDBefore));
});

test("signature runtime uses a unified provider-backed authority across wormhole signatures and mining anomalies", () => {
  const seeded = wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  assert.equal(seeded.success, true);

  const providers = signatureRuntime._testing.listSignatureProviders();
  assert.equal(providers.length >= 2, true);
  assert.deepEqual(
    providers.map((provider) => provider.providerID).sort(),
    ["sceneSignatureSite", "wormhole"],
  );
  assert.equal(signatureRuntime._testing.anomalyProviders.length >= 2, true);
  assert.deepEqual(
    signatureRuntime._testing.anomalyProviders.map((provider) => provider.providerID).sort(),
    ["generatedMining", "sceneAnomalySite"],
  );

  const systemSignatures = signatureRuntime.listSystemSignatureSites(TEST_SYSTEM_ID);
  const wormholeSignatures = signatureRuntime.listWormholeSignatureSites(TEST_SYSTEM_ID);
  assert.equal(systemSignatures.length >= wormholeSignatures.length, true);
  assert.equal(wormholeSignatures.length > 0, true);
  assert.equal(
    wormholeSignatures.every((wormholeSite) => (
      systemSignatures.some((site) => Number(site.siteID) === Number(wormholeSite.siteID))
    )),
    true,
  );
  assert.equal(
    systemSignatures.some((site) => site.family === "wormhole"),
    true,
  );

  const fullState = signatureRuntime.buildSignalTrackerFullState(TEST_SYSTEM_ID);
  assert.equal(getSignatureEntries(fullState).length, systemSignatures.length);
});

test("scanMgr full state exposes generated mining sites as anomalies through the unified signal tracker authority", (t) => {
  const originalMiningConfig = snapshotMiningSiteConfig();
  const persistentSiteSnapshot = snapshotPersistentSiteTables();
  t.after(() => {
    restoreMiningSiteConfig(originalMiningConfig);
    restorePersistentSiteTables(persistentSiteSnapshot);
    spaceRuntime._testing.clearScenes();
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
  });

  const systemID = pickGeneratedMiningSeedSystem();
  dungeonUniverseRuntime.reconcileUniversePersistentSites({
    systemIDs: [systemID],
    nowMs: Date.now(),
  });
  const scene = spaceRuntime.ensureScene(systemID);
  const generatedAnchors = miningResourceSiteService._testing
    .listGeneratedResourceSiteEntities(scene)
    .filter((entity) => entity && entity.generatedMiningSiteAnchor === true);
  assert(generatedAnchors.length > 0, "expected generated mining-site anchors in the loaded scene");

  const service = new ScanMgrService();
  const session = buildSession(systemID);
  const fullState = service.Handle_GetFullState([], session);
  const anomalyEntries = getAnomalyEntries(fullState);
  assert(anomalyEntries.length > 0, "expected mining anomalies in signal-tracker full state");

  const firstAnomaly = marshalObjectToObject(anomalyEntries[0][1]);
  assert.match(String(firstAnomaly.targetID), /^[A-Z]{3}-\d{3}$/);
  assert.equal(Array.isArray(firstAnomaly.position), true);
  assert.equal(Number(firstAnomaly.instanceID) > 0, true);
  assert.equal(Number(firstAnomaly.solarSystemID), systemID);
  assert([209, 211].includes(Number(firstAnomaly.scanStrengthAttribute)));
  assert.equal(
    Number(firstAnomaly.dungeonID) > 0,
    true,
    "expected generated anomaly rows to resolve to real numeric dungeonIDs from the dungeon authority",
  );
  assert.equal(Number(firstAnomaly.dungeonNameID) > 0, true);
  if (firstAnomaly.archetypeID != null) {
    assert.equal(Number(firstAnomaly.archetypeID) > 0, true);
  }

  const siteViews = signatureRuntime.buildSystemScannableViews(systemID);
  assert(siteViews.some((site) => site.siteKind === "anomaly"));
  assert(siteViews.some((site) => site.family === "ice"));
});

test("scanMgr full state exposes authored static overlay sites through the third full-state map", () => {
  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  scene.staticEntities.push({
    itemID: 992000009901,
    typeID: 16,
    itemName: "Ancient Landmark Beacon",
    position: { x: 125000, y: 0, z: -45000 },
    signalTrackerStaticSite: true,
    signalTrackerStaticSiteNameID: 330000001,
    signalTrackerStaticSiteFactionID: 500001,
    signalTrackerStaticSiteFamily: "landmark",
  });

  const service = new ScanMgrService();
  const session = buildSession(TEST_SYSTEM_ID);
  const fullState = service.Handle_GetFullState([], session);
  const staticEntries = getStaticEntries(fullState);
  assert.equal(staticEntries.length, 1);

  const [siteID, siteInfo] = staticEntries[0];
  assert.equal(Number(siteID), 992000009901);
  const resolved = marshalObjectToObject(siteInfo);
  assert.deepEqual(resolved.position, [125000, 0, -45000]);
  assert.equal(Number(resolved.dungeonNameID), 330000001);
  assert.equal(Number(resolved.factionID), 500001);
});

test("hidden K162 signatures stay absent until the wormhole is revealed", () => {
  const seeded = wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  assert.equal(seeded.success, true);

  const pair = seeded.data.createdPairs[0];
  const service = new ScanMgrService();
  const destinationSession = buildSession(pair.destination.systemID);

  const initialDestinationEntries = getSignatureEntries(
    service.Handle_GetFullState([], destinationSession),
  );
  assert.equal(
    initialDestinationEntries.some(
      ([siteID]) => Number(siteID) === Number(pair.destination.endpointID),
    ),
    false,
  );

  const prepareResult = wormholeRuntime.prepareJump(
    pair.source.endpointID,
    140000003,
    1,
    Date.now(),
  );
  assert.equal(prepareResult.success, true);

  const revealedDestinationEntries = getSignatureEntries(
    service.Handle_GetFullState([], destinationSession),
  );
  assert.equal(
    revealedDestinationEntries.some(
      ([siteID]) => Number(siteID) === Number(pair.destination.endpointID),
    ),
    true,
  );
});

test("SignalTrackerRegister pushes OnSignalTrackerFullState for the current system", () => {
  wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  const service = new ScanMgrService();
  const session = buildSession(TEST_SYSTEM_ID);

  const result = service.Handle_SignalTrackerRegister([], session);

  assert.equal(result, null);
  assert.equal(session.notifications.length, 1);
  assert.equal(session.notifications[0].name, "OnSignalTrackerFullState");
  assert.equal(session.notifications[0].idType, "solarsystemid2");
  assert.equal(session.notifications[0].payload[0], TEST_SYSTEM_ID);
  assert.equal(session.notifications[0].payload[2], false);
  assert(getSignatureEntries(session.notifications[0].payload[1]).length >= 1);
});

test("/sigscan resolves all current-system signatures to 100% and pushes the live scanner notifications", () => {
  wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  const session = buildSession(TEST_SYSTEM_ID);

  const commandResult = chatCommands.executeChatCommand(
    session,
    "/sigscan",
    null,
    { emitChatFeedback: false },
  );

  assert.equal(commandResult.handled, true);
  assert.match(commandResult.message, /^Resolved \d+ signatures? to 100% in /);

  const notificationNames = session.notifications.map((entry) => entry.name);
  assert.deepEqual(notificationNames, [
    "OnSignalTrackerFullState",
    "OnSystemScanStarted",
    "OnSystemScanStopped",
  ]);
  assert.equal(session.notifications[0].payload[2], true);

  const fullStateEntries = getSignatureEntries(session.notifications[0].payload[1]);
  assert(fullStateEntries.length >= 1, "expected signature full-state bootstrap");

  const stoppedPayload = session.notifications[2].payload;
  const scanResults = Array.isArray(stoppedPayload[1]) ? stoppedPayload[1] : [];
  assert.equal(scanResults.length, fullStateEntries.length);
  for (const resultEntry of scanResults) {
    const resolved = marshalObjectToObject(resultEntry);
    assert.equal(Number(resolved.certainty), 1);
  }
});

test("/sigs lists the current visible signature families and labels for the system", () => {
  wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  const session = buildSession(TEST_SYSTEM_ID);

  const commandResult = chatCommands.executeChatCommand(
    session,
    "/sigs",
    null,
    { emitChatFeedback: false },
  );

  assert.equal(commandResult.handled, true);
  assert.match(commandResult.message, /^Scannable sites in /);
  assert.match(commandResult.message, /\bWormhole\b/);
  assert.match(commandResult.message, /\bstatic\b|\brandom\b/);
  assert.match(commandResult.message, /site \d+/);
});

test("mining-site anomaly resets push OnSignalTrackerAnomalyUpdate to registered sessions", (t) => {
  const originalMiningConfig = snapshotMiningSiteConfig();
  const persistentSiteSnapshot = snapshotPersistentSiteTables();
  t.after(() => {
    restoreMiningSiteConfig(originalMiningConfig);
    restorePersistentSiteTables(persistentSiteSnapshot);
    spaceRuntime._testing.clearScenes();
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
  });

  const systemID = pickGeneratedMiningSeedSystem();
  dungeonUniverseRuntime.reconcileUniversePersistentSites({
    systemIDs: [systemID],
    nowMs: Date.now(),
  });
  const service = new ScanMgrService();
  const session = buildSession(systemID);
  const scene = spaceRuntime.ensureScene(systemID);

  service.Handle_SignalTrackerRegister([], session);
  session.notifications.length = 0;

  Object.assign(config, {
    miningGeneratedIceSitesEnabled: false,
    miningGeneratedGasSitesEnabled: false,
  });
  const resetResult = miningResourceSiteService.resetSceneGeneratedResourceSites(scene, {
    broadcast: false,
    nowMs: Date.now(),
  });
  assert.equal(resetResult.success, true);

  assert.equal(session.notifications.length, 1);
  assert.equal(session.notifications[0].name, "OnSignalTrackerAnomalyUpdate");
  assert.equal(session.notifications[0].payload[0], systemID);

  const removedPayload = unwrapMarshalValue(session.notifications[0].payload[2]);
  assert(Array.isArray(removedPayload));
  assert(removedPayload.length > 0);
});

test("anomaly delta updates re-emit unchanged site IDs when the packaged-client payload changes", (t) => {
  const originalMiningConfig = snapshotMiningSiteConfig();
  const persistentSiteSnapshot = snapshotPersistentSiteTables();
  t.after(() => {
    restoreMiningSiteConfig(originalMiningConfig);
    restorePersistentSiteTables(persistentSiteSnapshot);
    spaceRuntime._testing.clearScenes();
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
  });

  const systemID = pickGeneratedMiningSeedSystem();
  dungeonUniverseRuntime.reconcileUniversePersistentSites({
    systemIDs: [systemID],
    nowMs: Date.now(),
  });
  const service = new ScanMgrService();
  const session = buildSession(systemID);
  const scene = spaceRuntime.ensureScene(systemID);

  service.Handle_SignalTrackerRegister([], session);
  session.notifications.length = 0;

  const anchors = miningResourceSiteService._testing
    .listGeneratedResourceSiteEntities(scene)
    .filter((entity) => entity && entity.generatedMiningSiteAnchor === true);
  assert(anchors.length > 0, "expected generated mining-site anchors");

  const anchor = anchors[0];
  anchor.position = {
    x: Number(anchor.position && anchor.position.x) + 12_345,
    y: Number(anchor.position && anchor.position.y) || 0,
    z: Number(anchor.position && anchor.position.z) || 0,
  };

  ScanMgrService._testing.notifyAnomalyDeltaForSystem(systemID);

  assert.equal(session.notifications.length, 1);
  assert.equal(session.notifications[0].name, "OnSignalTrackerAnomalyUpdate");
  assert.equal(session.notifications[0].payload[0], systemID);

  const addedEntries = extractDictEntries(session.notifications[0].payload[1]);
  assert.equal(addedEntries.length, 1);
  assert.equal(Number(addedEntries[0][0]), Number(anchor.itemID));
  const removedPayload = unwrapMarshalValue(session.notifications[0].payload[2]);
  assert(Array.isArray(removedPayload));
  assert(removedPayload.includes(Number(anchor.itemID)));
});

test("scanMgr full state exposes persisted Upwell structures through the packaged-client structure overlay lane", (t) => {
  t.after(() => {
    restoreStructuresState(originalStructuresState);
  });

  const systemID = TEST_SYSTEM_ID;
  const session = buildSession(systemID);
  const seedResult = structureState.seedStructureForSession(session, "astrahus", {
    solarSystemID: systemID,
    name: "Overlay Test Astrahus",
    position: { x: 250000, y: 0, z: -175000 },
  });
  assert.equal(seedResult.success, true);

  const service = new ScanMgrService();
  const fullState = service.Handle_GetFullState([], session);
  const structureEntries = getStructureEntries(fullState);
  assert(structureEntries.length >= 1, "expected structure overlay entries in signal-tracker full state");

  const structureID = Number(seedResult.data && seedResult.data.structureID) || 0;
  const structureType = structureState.getStructureTypeByID(
    seedResult.data && seedResult.data.typeID,
  );
  const entry = structureEntries.find(([siteID]) => Number(siteID) === structureID);
  assert(entry, "expected seeded structure to appear in overlay full state");

  const structureInfo = marshalObjectToObject(entry[1]);
  assert.equal(Number(structureInfo.typeID), Number(seedResult.data.typeID));
  assert.equal(Number(structureInfo.groupID), Number(structureType && structureType.groupID));
  assert.equal(Number(structureInfo.categoryID), Number(structureType && structureType.categoryID));
  assert.match(String(structureInfo.targetID), /^[A-Z]{3}-\d{3}$/);
  assert.equal(
    service.Handle_GetScanTargetID([structureID], session),
    structureInfo.targetID,
  );
  assert.deepEqual(structureInfo.position, [
    Number(seedResult.data.position.x),
    Number(seedResult.data.position.y),
    Number(seedResult.data.position.z),
  ]);
});

test("structure create and remove events push OnSignalTrackerStructureUpdate to registered sessions", (t) => {
  t.after(() => {
    restoreStructuresState(originalStructuresState);
  });

  const systemID = TEST_SYSTEM_ID;
  const service = new ScanMgrService();
  const session = buildSession(systemID);

  service.Handle_SignalTrackerRegister([], session);
  session.notifications.length = 0;

  const seedResult = structureState.seedStructureForSession(session, "astrahus", {
    solarSystemID: systemID,
    name: "Overlay Delta Astrahus",
    position: { x: 300000, y: 0, z: 120000 },
  });
  assert.equal(seedResult.success, true);

  assert.equal(session.notifications.length, 1);
  assert.equal(session.notifications[0].name, "OnSignalTrackerStructureUpdate");
  assert.equal(session.notifications[0].payload[0], systemID);
  const addedEntries = extractDictEntries(session.notifications[0].payload[1]);
  assert.equal(addedEntries.length, 1);
  assert.equal(
    Number(addedEntries[0][0]),
    Number(seedResult.data.structureID),
  );
  const addedInfo = marshalObjectToObject(addedEntries[0][1]);
  assert.match(String(addedInfo.targetID), /^[A-Z]{3}-\d{3}$/);

  session.notifications.length = 0;
  const removeResult = structureState.removeStructure(seedResult.data.structureID);
  assert.equal(removeResult.success, true);
  assert.equal(session.notifications.length, 1);
  assert.equal(session.notifications[0].name, "OnSignalTrackerStructureUpdate");
  const removedPayload = unwrapMarshalValue(session.notifications[0].payload[2]);
  assert(Array.isArray(removedPayload));
  assert(removedPayload.includes(Number(seedResult.data.structureID)));
});

test("revealing a hidden K162 pushes OnSignalTrackerSignatureUpdate to registered sessions in the destination system", () => {
  const seeded = wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  assert.equal(seeded.success, true);

  const pair = seeded.data.createdPairs[0];
  const service = new ScanMgrService();
  const destinationSession = buildSession(pair.destination.systemID);

  service.Handle_SignalTrackerRegister([], destinationSession);
  destinationSession.notifications.length = 0;

  const prepareResult = wormholeRuntime.prepareJump(
    pair.source.endpointID,
    140000003,
    1,
    Date.now(),
  );
  assert.equal(prepareResult.success, true);

  assert.equal(destinationSession.notifications.length, 1);
  assert.equal(destinationSession.notifications[0].name, "OnSignalTrackerSignatureUpdate");
  assert.equal(destinationSession.notifications[0].payload[0], pair.destination.systemID);

  const addedEntries = extractDictEntries(destinationSession.notifications[0].payload[1]);
  assert.equal(addedEntries.length, 1);
  assert.equal(Number(addedEntries[0][0]), Number(pair.destination.endpointID));
  const addedInfo = marshalObjectToObject(addedEntries[0][1]);
  assert.match(String(addedInfo.targetID), /^[A-Z]{3}-\d{3}$/);
});

test("signature delta updates re-emit unchanged site IDs when the packaged-client payload changes", () => {
  const seeded = wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  assert.equal(seeded.success, true);

  const pair = seeded.data.createdPairs[0];
  const service = new ScanMgrService();
  const session = buildSession(TEST_SYSTEM_ID);

  service.Handle_SignalTrackerRegister([], session);
  session.notifications.length = 0;

  const pairID = Number(pair.pairID);
  const endpointID = Number(pair.source.endpointID);
  const result = wormholeRuntimeState.mutateState((table) => {
    const runtimePair = table.pairsByID && table.pairsByID[String(pairID)];
    runtimePair.source.position.x = Number(runtimePair.source.position.x) + 25_000;
    return table;
  });
  assert.equal(result.success, true);

  ScanMgrService._testing.notifySignatureDeltaForSystem(TEST_SYSTEM_ID);

  assert.equal(session.notifications.length, 1);
  assert.equal(session.notifications[0].name, "OnSignalTrackerSignatureUpdate");
  assert.equal(session.notifications[0].payload[0], TEST_SYSTEM_ID);

  const addedEntries = extractDictEntries(session.notifications[0].payload[1]);
  assert.equal(addedEntries.length, 1);
  assert.equal(Number(addedEntries[0][0]), endpointID);
  const removedPayload = unwrapMarshalValue(session.notifications[0].payload[2]);
  assert(Array.isArray(removedPayload));
  assert(removedPayload.includes(endpointID));
});

test("collapsing an active wormhole pushes removed signature updates to registered sessions", () => {
  const seeded = wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  assert.equal(seeded.success, true);

  const pair = seeded.data.createdPairs[0];
  const service = new ScanMgrService();
  const sourceSession = buildSession(TEST_SYSTEM_ID);

  service.Handle_SignalTrackerRegister([], sourceSession);
  sourceSession.notifications.length = 0;

  wormholeRuntime.clearPairs(TEST_SYSTEM_ID, Date.now());

  assert.equal(sourceSession.notifications.length, 1);
  assert.equal(sourceSession.notifications[0].name, "OnSignalTrackerSignatureUpdate");
  assert.equal(sourceSession.notifications[0].payload[0], TEST_SYSTEM_ID);

  const removedPayload = unwrapMarshalValue(sourceSession.notifications[0].payload[2]);
  assert(Array.isArray(removedPayload));
  assert(removedPayload.includes(Number(pair.source.endpointID)));
});

test("full signal-tracker refresh can prune stale static overlay sites for registered sessions", () => {
  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  scene.staticEntities.push({
    itemID: 992000009902,
    typeID: 16,
    itemName: "Stale Landmark Beacon",
    position: { x: 50000, y: 0, z: 50000 },
    signalTrackerStaticSite: true,
    signalTrackerStaticSiteNameID: 330000002,
    signalTrackerStaticSiteFactionID: 500001,
    signalTrackerStaticSiteFamily: "landmark",
  });

  const service = new ScanMgrService();
  const session = buildSession(TEST_SYSTEM_ID);
  service.Handle_SignalTrackerRegister([], session);
  const initialStaticEntries = getStaticEntries(session.notifications[0].payload[1]);
  assert.equal(initialStaticEntries.length, 1);

  session.notifications.length = 0;
  scene.staticEntities = scene.staticEntities.filter(
    (entity) => Number(entity && entity.itemID) !== 992000009902,
  );

  const refreshResult = ScanMgrService._testing.notifyFullStateRefreshForSystem(
    TEST_SYSTEM_ID,
    { shouldRemoveOldSites: true },
  );
  assert.equal(refreshResult.success, true);
  assert.equal(session.notifications.length, 1);
  assert.equal(session.notifications[0].name, "OnSignalTrackerFullState");
  assert.equal(session.notifications[0].payload[0], TEST_SYSTEM_ID);
  assert.equal(session.notifications[0].payload[2], true);
  assert.equal(getStaticEntries(session.notifications[0].payload[1]).length, 0);
});

test("/overlayrefresh pushes a prune-capable signal-tracker full refresh for the current system", () => {
  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  scene.staticEntities.push({
    itemID: 992000009903,
    typeID: 16,
    itemName: "Overlay Refresh Beacon",
    position: { x: -25000, y: 0, z: 75000 },
    signalTrackerStaticSite: true,
    signalTrackerStaticSiteNameID: 330000003,
    signalTrackerStaticSiteFactionID: 500001,
    signalTrackerStaticSiteFamily: "landmark",
  });

  const session = buildSession(TEST_SYSTEM_ID);
  const commandResult = chatCommands.executeChatCommand(
    session,
    "/overlayrefresh",
    null,
    { emitChatFeedback: false },
  );

  assert.equal(commandResult.handled, true);
  assert.match(commandResult.message, /^Refreshed the sensor overlay for /);
  assert.equal(session.notifications.length, 1);
  assert.equal(session.notifications[0].name, "OnSignalTrackerFullState");
  assert.equal(session.notifications[0].payload[2], true);
  assert.equal(getStaticEntries(session.notifications[0].payload[1]).length, 1);
});

test("RequestScans emits probe scan lifecycle notifications and returns wormhole signature results from client-sent probe geometry", () => {
  const seeded = wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  assert.equal(seeded.success, true);

  const pair = seeded.data.createdPairs[0];
  const service = new ScanMgrService();
  const session = buildSession(TEST_SYSTEM_ID);
  const sourceTargetID = service.Handle_GetScanTargetID([pair.source.endpointID], session);
  const basePosition = pair.source.position;
  const auMeters = 149_597_870_700;
  const probeDefinition = explorationAuthority.getProbeDefinition(30013);
  const probes = {
    9101: {
      probeID: 9101,
      typeID: 30013,
      pos: [basePosition.x + auMeters, basePosition.y, basePosition.z],
      destination: [basePosition.x + auMeters, basePosition.y, basePosition.z],
      scanRange: 8 * auMeters,
      rangeStep: 5,
      state: 1,
    },
    9102: {
      probeID: 9102,
      typeID: 30013,
      pos: [basePosition.x - auMeters, basePosition.y, basePosition.z],
      destination: [basePosition.x - auMeters, basePosition.y, basePosition.z],
      scanRange: 8 * auMeters,
      rangeStep: 5,
      state: 1,
    },
    9103: {
      probeID: 9103,
      typeID: 30013,
      pos: [basePosition.x, basePosition.y + auMeters, basePosition.z],
      destination: [basePosition.x, basePosition.y + auMeters, basePosition.z],
      scanRange: 8 * auMeters,
      rangeStep: 5,
      state: 1,
    },
    9104: {
      probeID: 9104,
      typeID: 30013,
      pos: [basePosition.x, basePosition.y, basePosition.z + auMeters],
      destination: [basePosition.x, basePosition.y, basePosition.z + auMeters],
      scanRange: 8 * auMeters,
      rangeStep: 5,
      state: 1,
    },
  };
  seedPersistedProbes(session, [
    { probeID: 9101, pos: probes[9101].destination, destination: probes[9101].destination, scanRange: 1_000, rangeStep: 1 },
    { probeID: 9102, pos: probes[9102].destination, destination: probes[9102].destination, scanRange: 1_000, rangeStep: 1 },
    { probeID: 9103, pos: probes[9103].destination, destination: probes[9103].destination, scanRange: 1_000, rangeStep: 1 },
    { probeID: 9104, pos: probes[9104].destination, destination: probes[9104].destination, scanRange: 1_000, rangeStep: 1 },
  ]);

  service.Handle_RequestScans([probes], session, { _testingDurationMs: 1 });

  assert.equal(session.notifications.length, 2);

  const started = session.notifications[0];
  assert.equal(started.name, "OnSystemScanStarted");
  assert.equal(started.payload[1], 1);
  const startedProbeEntries = extractDictEntries(started.payload[2]);
  assert.equal(startedProbeEntries.length, 4);
  for (const [, probeEntry] of startedProbeEntries) {
    const startedProbe = marshalObjectToObject(probeEntry);
    const rawStartedProbePosition = getKeyValField(probeEntry, "pos");
    const rawStartedProbeDestination = getKeyValField(probeEntry, "destination");
    assert.equal(
      Array.isArray(startedProbe.pos),
      true,
      "expected started probe payload to include a concrete scan position",
    );
    assert.equal(
      Array.isArray(rawStartedProbePosition),
      true,
      "expected started probe position to be emitted as a vector payload",
    );
    assert.equal(
      rawStartedProbePosition.every((entry) => entry && entry.type === "real"),
      true,
      "expected started probe position to stay marshal-real so the packaged probe tracker can update moved probes without geo2 type errors",
    );
    assert.equal(
      Array.isArray(rawStartedProbeDestination),
      true,
      "expected started probe destination to be emitted as a vector payload",
    );
    assert.equal(
      rawStartedProbeDestination.every((entry) => entry && entry.type === "real"),
      true,
      "expected started probe destination to stay marshal-real for moved-probe scan start parity",
    );
    assert.deepEqual(
      startedProbe.pos,
      startedProbe.destination,
      "expected started probe payload to preserve the effective drag destination as the scan-time position",
    );
    assert.ok(
      startedProbe.scanBonuses &&
        typeof startedProbe.scanBonuses === "object" &&
        startedProbe.scanBonuses.strength &&
        typeof startedProbe.scanBonuses.strength === "object",
      "expected started probe payload to expose scanBonuses for the packaged probe scanner UI",
    );
    assert.equal(
      Number.isFinite(Number(startedProbe.scanBonuses.strength.modules)),
      true,
      "expected scanBonuses strength.modules to be numeric",
    );
  }

  const stopped = session.notifications[1];
  assert.equal(stopped.name, "OnSystemScanStopped");
  assert.deepEqual(stopped.payload[0], [9101, 9102, 9103, 9104]);
  assert.equal(Array.isArray(stopped.payload[1]), true);
  assert(stopped.payload[1].length >= 1);
  const resultEntry = stopped.payload[1].find((entry) => {
    const resolved = marshalObjectToObject(entry);
    return String(resolved.id) === String(sourceTargetID);
  });
  assert.ok(resultEntry, "expected scan results to include the source-side wormhole signature");
  const result = marshalObjectToObject(resultEntry);
  assert.equal(String(result.id), String(sourceTargetID));
  assert.equal(Number(result.scanGroupID), 3);
  assert.equal(Number(result.groupID), 502);
  assert.equal(Number(result.strengthAttributeID), 1908);
  assert.equal(Number(result.certainty), 1);
  assert(Array.isArray(stopped.payload[2]));
  assert.equal(
    stopped.payload[2].includes(String(sourceTargetID)),
    false,
  );
  const persisted = probeRuntimeState.getCharacterSystemProbes(
    session.characterID,
    TEST_SYSTEM_ID,
  );
  assert.equal(
    persisted.length,
    4,
    "expected RequestScans to reconcile already-launched probes instead of dropping their runtime state",
  );
  for (const probe of persisted) {
    const requestedProbe = probes[probe.probeID];
    assert.ok(requestedProbe, `expected persisted probe ${probe.probeID} to come from the Analyze request`);
    const authoritativeRangeSteps =
      Array.isArray(probeDefinition && probeDefinition.rangeSteps)
        ? probeDefinition.rangeSteps
        : [];
    assert.deepEqual(
      probe.pos,
      requestedProbe.destination,
      "expected RequestScans to persist the effective drag destination for launched probes",
    );
    assert.deepEqual(
      probe.destination,
      requestedProbe.destination,
      "expected RequestScans to persist probe destinations for reconnect parity",
    );
    assert.equal(Number(probe.rangeStep), Number(requestedProbe.rangeStep));
    assert.equal(
      Number(probe.scanRange),
      Number(authoritativeRangeSteps[Number(requestedProbe.rangeStep) - 1] || requestedProbe.scanRange),
    );
  }

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  for (const probeID of [9101, 9102, 9103, 9104]) {
    const entity = scene.getEntityByID(probeID);
    assert.ok(entity, `expected RequestScans to keep probe ${probeID} materialized in-space`);
    assert.deepEqual(
      [
        Number(entity.position.x),
        Number(entity.position.y),
        Number(entity.position.z),
      ],
      probes[probeID].destination,
      "expected scene probe entities to match the authoritative scan-time probe geometry",
    );
  }
});

test("RequestScans emits absentTargets as stable scan target IDs so packaged-client ignored/history state can clear correctly", () => {
  const seeded = wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  assert.equal(seeded.success, true);

  const pair = seeded.data.createdPairs[0];
  const service = new ScanMgrService();
  const session = buildSession(TEST_SYSTEM_ID);
  const sourceTargetID = service.Handle_GetScanTargetID([pair.source.endpointID], session);
  const basePosition = pair.source.position;
  const auMeters = 149_597_870_700;
  const probes = {
    9181: {
      probeID: 9181,
      typeID: 30013,
      pos: [basePosition.x + (16 * auMeters), basePosition.y, basePosition.z],
      destination: [basePosition.x + (16 * auMeters), basePosition.y, basePosition.z],
      scanRange: 0.5 * auMeters,
      rangeStep: 1,
      state: 1,
    },
  };
  seedPersistedProbes(session, [{
    probeID: 9181,
    pos: probes[9181].destination,
    destination: probes[9181].destination,
    scanRange: probes[9181].scanRange,
    rangeStep: probes[9181].rangeStep,
    state: 1,
  }]);

  service.Handle_RequestScans([probes], session, { _testingDurationMs: 1 });

  assert.equal(session.notifications.length, 2);
  const stopped = session.notifications[1];
  assert.equal(stopped.name, "OnSystemScanStopped");
  assert.deepEqual(
    Array.isArray(stopped.payload[1]) ? stopped.payload[1] : [],
    [],
    "expected scan to miss the wormhole entirely",
  );
  assert.deepEqual(
    stopped.payload[2],
    [sourceTargetID],
    "expected absentTargets to use the stable packaged-client scan target ID",
  );
});

test("partial signature hits use approximate positions plus deviation instead of reporting fake-perfect exact points", () => {
  const seeded = wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  assert.equal(seeded.success, true);

  const pair = seeded.data.createdPairs[0];
  const service = new ScanMgrService();
  const session = buildSession(TEST_SYSTEM_ID);
  const sourceTargetID = service.Handle_GetScanTargetID([pair.source.endpointID], session);
  const basePosition = pair.source.position;
  const auMeters = 149_597_870_700;
  const probes = {
    9121: {
      probeID: 9121,
      typeID: 30013,
      pos: [basePosition.x, basePosition.y, basePosition.z],
      destination: [basePosition.x, basePosition.y, basePosition.z],
      scanRange: 8 * auMeters,
      rangeStep: 5,
      state: 1,
    },
  };
  seedPersistedProbes(session, [{
    probeID: 9121,
    pos: probes[9121].destination,
    destination: probes[9121].destination,
    scanRange: probes[9121].scanRange,
    rangeStep: probes[9121].rangeStep,
    state: 1,
  }]);

  service.Handle_RequestScans([probes], session, { _testingDurationMs: 1 });

  assert.equal(session.notifications.length, 2);
  const stopped = session.notifications[1];
  assert.equal(stopped.name, "OnSystemScanStopped");
  const resultEntry = stopped.payload[1].find((entry) => {
    const resolved = marshalObjectToObject(entry);
    return String(resolved.id) === String(sourceTargetID);
  });
  assert.ok(resultEntry, "expected partial scan result for the source-side wormhole");
  const result = marshalObjectToObject(resultEntry);
  assert(Number(result.certainty) > 0);
  assert(Number(result.certainty) < 1);
  assert.equal(Number.isFinite(Number(result.data)), true);
  assert(Array.isArray(result.pos));
  assert.notDeepEqual(
    result.pos,
    [pair.source.position.x, pair.source.position.y, pair.source.position.z],
    "expected partial result position to stay approximate until 100% certainty",
  );
});

test("RequestScans emits probe warp notifications and delays scan start until launched probes arrive at their destinations", () => {
  const seeded = wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  assert.equal(seeded.success, true);

  const pair = seeded.data.createdPairs[0];
  const service = new ScanMgrService();
  const session = buildSession(TEST_SYSTEM_ID);
  const basePosition = pair.source.position;
  const auMeters = 149_597_870_700;
  const scheduledCallbacks = [];

  seedPersistedProbes(session, [{
    probeID: 9191,
    pos: [basePosition.x, basePosition.y, basePosition.z],
    destination: [basePosition.x, basePosition.y, basePosition.z],
    scanRange: 1_000,
    rangeStep: 1,
  }]);

  const probes = {
    9191: {
      probeID: 9191,
      typeID: 30013,
      pos: [basePosition.x + auMeters, basePosition.y, basePosition.z],
      destination: [basePosition.x + auMeters, basePosition.y, basePosition.z],
      scanRange: 8 * auMeters,
      rangeStep: 5,
      state: 1,
    },
  };

  service.Handle_RequestScans([probes], session, {
    _testingDurationMs: 1,
    _testingMoveDurationMs: 25,
    _testingSetTimeout(callback, durationMs) {
      const handle = { callback, durationMs };
      scheduledCallbacks.push(handle);
      return handle;
    },
    _testingClearTimeout() {},
  });

  assert.equal(session.notifications.length, 1);
  assert.equal(session.notifications[0].name, "OnProbeWarpStart");
  assert.equal(Number(session.notifications[0].payload[0]), 9191);
  assert.deepEqual(session.notifications[0].payload[1], [basePosition.x, basePosition.y, basePosition.z]);
  assert.deepEqual(session.notifications[0].payload[2], probes[9191].destination);
  assert.equal(scheduledCallbacks.length >= 1, true);

  scheduledCallbacks[0].callback();

  assert.equal(session.notifications[1].name, "OnProbeWarpEnd");
  assert.equal(session.notifications[2].name, "OnSystemScanStarted");
  assert.equal(session.notifications[3].name, "OnSystemScanStopped");
  const startedProbeEntries = extractDictEntries(session.notifications[2].payload[2]);
  assert.equal(startedProbeEntries.length, 1);
  const [, startedProbeEntry] = startedProbeEntries[0];
  const rawStartedProbePosition = getKeyValField(startedProbeEntry, "pos");
  const rawStartedProbeDestination = getKeyValField(startedProbeEntry, "destination");
  assert.equal(
    Array.isArray(rawStartedProbePosition),
    true,
    "expected moved probe scan-start payload to carry a concrete position vector",
  );
  assert.equal(
    rawStartedProbePosition.every((entry) => entry && entry.type === "real"),
    true,
    "expected moved probe scan-start position to stay marshal-real so packaged-client analyze animation survives repositioned probes",
  );
  assert.equal(
    Array.isArray(rawStartedProbeDestination),
    true,
    "expected moved probe scan-start payload to carry a concrete destination vector",
  );
  assert.equal(
    rawStartedProbeDestination.every((entry) => entry && entry.type === "real"),
    true,
    "expected moved probe scan-start destination to stay marshal-real for client probe tracker parity",
  );

  const persisted = probeRuntimeState.getCharacterSystemProbes(
    session.characterID,
    TEST_SYSTEM_ID,
  );
  assert.equal(persisted.length, 1);
  assert.deepEqual(persisted[0].pos, probes[9191].destination);
  assert.deepEqual(persisted[0].destination, probes[9191].destination);
});

test("RequestScans ignores client-only probe geometry that has no launched server probe behind it", () => {
  const seeded = wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  assert.equal(seeded.success, true);

  const pair = seeded.data.createdPairs[0];
  const service = new ScanMgrService();
  const session = buildSession(TEST_SYSTEM_ID);
  const basePosition = pair.source.position;
  const auMeters = 149_597_870_700;

  service.Handle_RequestScans([{
    9901: {
      probeID: 9901,
      typeID: 30013,
      pos: [basePosition.x + auMeters, basePosition.y, basePosition.z],
      destination: [basePosition.x + auMeters, basePosition.y, basePosition.z],
      scanRange: 8 * auMeters,
      rangeStep: 5,
      state: 1,
    },
  }], session, { _testingDurationMs: 1 });

  const started = session.notifications[0];
  assert.equal(started.name, "OnSystemScanStarted");
  const startedProbeEntries = extractDictEntries(started.payload[2]);
  assert.equal(
    startedProbeEntries.length,
    0,
    "expected scan start payload to ignore client-only probe geometry with no launched server probe",
  );

  const stopped = session.notifications[1];
  assert.equal(stopped.name, "OnSystemScanStopped");
  assert.deepEqual(
    Array.isArray(stopped.payload[1]) ? stopped.payload[1] : [],
    [],
    "expected server scan results to ignore unknown client-only probes",
  );
  assert.equal(
    probeRuntimeState.getCharacterSystemProbes(session.characterID, TEST_SYSTEM_ID).length,
    0,
    "expected RequestScans to leave no persisted ghost probes behind",
  );
});

test("RequestScans can schedule the scan stop notification instead of sending it immediately", () => {
  const seeded = wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  assert.equal(seeded.success, true);

  const pair = seeded.data.createdPairs[0];
  const service = new ScanMgrService();
  const session = buildSession(TEST_SYSTEM_ID);
  const scheduledStops = [];
  const clearedStops = [];
  const basePosition = pair.source.position;
  seedPersistedProbes(session, [{
    probeID: 9111,
    pos: [basePosition.x + 1_000, basePosition.y, basePosition.z],
    destination: [basePosition.x + 1_000, basePosition.y, basePosition.z],
  }]);
  const probes = {
    9111: {
      probeID: 9111,
      typeID: 30013,
      pos: [basePosition.x + 1_000, basePosition.y, basePosition.z],
      destination: [basePosition.x + 1_000, basePosition.y, basePosition.z],
      scanRange: 1_000_000,
      rangeStep: 4,
      state: 1,
    },
  };

  service.Handle_RequestScans([probes], session, {
    _testingDurationMs: 25,
    _testingSetTimeout(callback, durationMs) {
      const handle = { callback, durationMs };
      scheduledStops.push(handle);
      return handle;
    },
    _testingClearTimeout(handle) {
      clearedStops.push(handle);
    },
  });

  assert.equal(session.notifications.length, 1);
  assert.equal(session.notifications[0].name, "OnSystemScanStarted");
  assert.equal(session.notifications[0].payload[1], 25);
  assert.equal(scheduledStops.length, 1);
  assert.equal(scheduledStops[0].durationMs, 25);
  assert.equal(clearedStops.length, 0);

  scheduledStops[0].callback();

  assert.equal(session.notifications.length, 2);
  assert.equal(session.notifications[1].name, "OnSystemScanStopped");
});

test("RequestScans ignores inactive probes and caps the active scan wave at eight probes", () => {
  wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  const service = new ScanMgrService();
  const session = buildSession(TEST_SYSTEM_ID);

  const probes = {};
  const persistedProbeSpecs = [];
  for (let index = 1; index <= 10; index += 1) {
    probes[9200 + index] = {
      probeID: 9200 + index,
      typeID: 30013,
      pos: [index * 1000, 0, 0],
      destination: [index * 1000, 0, 0],
      scanRange: 1_000_000,
      rangeStep: 3,
      state: index === 10 ? 0 : 1,
    };
    if (index <= 9) {
      persistedProbeSpecs.push({
        probeID: 9200 + index,
        pos: probes[9200 + index].destination,
        destination: probes[9200 + index].destination,
        state: index === 10 ? 0 : 1,
      });
    }
  }
  seedPersistedProbes(session, persistedProbeSpecs);

  service.Handle_RequestScans([probes], session, { _testingDurationMs: 1 });

  assert.equal(session.notifications.length, 2);
  const startedProbeEntries = extractDictEntries(session.notifications[0].payload[2]);
  assert.equal(startedProbeEntries.length, 8);
  assert.deepEqual(
    startedProbeEntries.map(([probeID]) => Number(probeID)),
    [9201, 9202, 9203, 9204, 9205, 9206, 9207, 9208],
  );
  assert.deepEqual(
    session.notifications[1].payload[0],
    [9201, 9202, 9203, 9204, 9205, 9206, 9207, 9208],
  );
});

test("SetActivityState updates persisted probe activity for the current character", () => {
  wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  const service = new ScanMgrService();
  const session = buildSession(TEST_SYSTEM_ID);

  seedPersistedProbes(session, [{ probeID: 9301 }]);

  service.Handle_SetActivityState([[9301], false], session);

  const persisted = probeRuntimeState.getCharacterSystemProbes(
    session.characterID,
    TEST_SYSTEM_ID,
  );
  assert.equal(persisted.length, 1);
  assert.equal(Number(persisted[0].state), 0);
});

test("SetProbeDestination updates the persisted destination for a launched probe and retargets its scene entity", () => {
  wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  const service = new ScanMgrService();
  const session = buildSession(TEST_SYSTEM_ID);

  seedPersistedProbes(session, [{
    probeID: 9351,
    pos: [1000, 0, 0],
    destination: [1000, 0, 0],
  }]);
  probeSceneRuntime.ensureProbeEntitiesForSession(session, probeRuntimeState.getCharacterSystemProbes(
    session.characterID,
    TEST_SYSTEM_ID,
  ));

  const nextDestination = [2500, 500, -750];
  service.Handle_SetProbeDestination([9351, nextDestination], session);

  const persisted = probeRuntimeState.getCharacterSystemProbes(
    session.characterID,
    TEST_SYSTEM_ID,
  );
  assert.equal(persisted.length, 1);
  assert.deepEqual(persisted[0].pos, [1000, 0, 0]);
  assert.deepEqual(persisted[0].destination, nextDestination);

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const entity = scene.getEntityByID(9351);
  assert.ok(entity);
  assert.deepEqual(
    [
      Number(entity.position.x),
      Number(entity.position.y),
      Number(entity.position.z),
    ],
    [1000, 0, 0],
  );
  assert.deepEqual(
    [
      Number(entity.targetPoint.x),
      Number(entity.targetPoint.y),
      Number(entity.targetPoint.z),
    ],
    nextDestination,
  );
});

test("SetProbeDestination clamps launched probe destinations to the packaged-client max scan volume", () => {
  wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  const service = new ScanMgrService();
  const session = buildSession(TEST_SYSTEM_ID);

  seedPersistedProbes(session, [{
    probeID: 9353,
    pos: [1000, 0, 0],
    destination: [1000, 0, 0],
  }]);
  probeSceneRuntime.ensureProbeEntitiesForSession(
    session,
    probeRuntimeState.getCharacterSystemProbes(session.characterID, TEST_SYSTEM_ID),
  );

  service.Handle_SetProbeDestination([9353, [1e20, 0, 0]], session);

  const persisted = probeRuntimeState.getCharacterSystemProbes(
    session.characterID,
    TEST_SYSTEM_ID,
  );
  assert.equal(persisted.length, 1);

  const maxDistanceSquared =
    Number(explorationAuthority.getScanContracts().maxProbeDistanceFromSunSquared) ||
    ((149_597_870_700 * 250) ** 2);
  const persistedDistanceSquared =
    (persisted[0].destination[0] ** 2) +
    (persisted[0].destination[1] ** 2) +
    (persisted[0].destination[2] ** 2);
  assert.equal(
    persistedDistanceSquared <= (maxDistanceSquared + 1),
    true,
    "expected persisted probe destination to stay inside the packaged-client probe volume",
  );

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const entity = scene.getEntityByID(9353);
  assert.ok(entity);
  const targetDistanceSquared =
    (Number(entity.targetPoint.x) ** 2) +
    (Number(entity.targetPoint.y) ** 2) +
    (Number(entity.targetPoint.z) ** 2);
  assert.equal(
    targetDistanceSquared <= (maxDistanceSquared + 1),
    true,
    "expected scene target point to use the same clamped probe destination",
  );
});

test("SetProbeRangeStep updates persisted probe scanRange from the CCP probe dogma contract", () => {
  wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  const service = new ScanMgrService();
  const session = buildSession(TEST_SYSTEM_ID);

  seedPersistedProbes(session, [{
    probeID: 9352,
    typeID: 30013,
    rangeStep: 1,
    scanRange: 1,
  }]);

  service.Handle_SetProbeRangeStep([9352, 4], session);

  const persisted = probeRuntimeState.getCharacterSystemProbes(
    session.characterID,
    TEST_SYSTEM_ID,
  );
  assert.equal(persisted.length, 1);
  assert.equal(Number(persisted[0].rangeStep), 4);

  const baseScanRange = Number(getTypeAttributeValue(30013, "baseScanRange")) || 0;
  const rangeFactor = Number(getTypeAttributeValue(30013, "rangeFactor")) || 0;
  const expectedScanRange = baseScanRange * (rangeFactor ** 3) * 149_597_870_700;
  assert.equal(Number(persisted[0].scanRange), expectedScanRange);
});

test("RequestScans snaps probe geometry onto the authoritative CCP range-step ladder", () => {
  wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  const service = new ScanMgrService();
  const session = buildSession(TEST_SYSTEM_ID);
  const probeDefinition = explorationAuthority.getProbeDefinition(30013);
  const expectedRangeStep = 4;
  const expectedScanRange = Number(
    probeDefinition &&
      Array.isArray(probeDefinition.rangeSteps) &&
      probeDefinition.rangeSteps[expectedRangeStep - 1],
  ) || 0;

  seedPersistedProbes(session, [{
    probeID: 9354,
    typeID: 30013,
    pos: [2500, 0, 0],
    destination: [2500, 0, 0],
    rangeStep: 1,
    scanRange: 1,
  }]);

  service.Handle_RequestScans([{
    9354: {
      probeID: 9354,
      typeID: 30013,
      pos: [2500, 0, 0],
      destination: [2500, 0, 0],
      scanRange: expectedScanRange + 5000,
      rangeStep: 0,
      state: 1,
    },
  }], session, { _testingDurationMs: 1 });

  const started = session.notifications[0];
  assert.equal(started.name, "OnSystemScanStarted");
  const startedProbeEntries = extractDictEntries(started.payload[2]);
  assert.equal(startedProbeEntries.length, 1);
  const startedProbe = marshalObjectToObject(startedProbeEntries[0][1]);
  assert.equal(Number(startedProbe.rangeStep), expectedRangeStep);
  assert.equal(Number(startedProbe.scanRange), expectedScanRange);

  const persisted = probeRuntimeState.getCharacterSystemProbes(
    session.characterID,
    TEST_SYSTEM_ID,
  );
  assert.equal(persisted.length, 1);
  assert.equal(Number(persisted[0].rangeStep), expectedRangeStep);
  assert.equal(Number(persisted[0].scanRange), expectedScanRange);
});

test("DestroyProbe removes persisted probe state immediately", () => {
  wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  const service = new ScanMgrService();
  const session = buildSession(TEST_SYSTEM_ID);

  seedPersistedProbes(session, [{ probeID: 9401 }]);

  service.Handle_DestroyProbe([9401], session);

  const persisted = probeRuntimeState.getCharacterSystemProbes(
    session.characterID,
    TEST_SYSTEM_ID,
  );
  assert.equal(persisted.length, 0);
});

test("RecoverProbes removes persisted probes and emits OnRemoveProbe notifications", async () => {
  wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  const service = new ScanMgrService();
  const session = buildSession(TEST_SYSTEM_ID);

  seedPersistedProbes(session, [{ probeID: 9501 }, { probeID: 9502 }]);
  session.notifications.length = 0;

  const recovered = service.Handle_RecoverProbes([
    {
      type: "list",
      items: [
        { type: "long", value: 9501n },
        { type: "long", value: 9502n },
      ],
    },
  ], session);
  assert.deepEqual(recovered, [9501, 9502]);

  await new Promise((resolve) => setImmediate(resolve));

  const persisted = probeRuntimeState.getCharacterSystemProbes(
    session.characterID,
    TEST_SYSTEM_ID,
  );
  assert.equal(persisted.length, 0);
  const removalNotifications = session.notifications
    .filter((entry) => entry.name === "OnRemoveProbe")
    .map((entry) => [entry.name, Number(entry.payload[0])]);
  assert.deepEqual(
    removalNotifications,
    [
      ["OnRemoveProbe", 9501],
      ["OnRemoveProbe", 9502],
    ],
  );
});

test("ReconnectToLostProbes replays persisted probes through OnNewProbe and OnProbesIdle", async () => {
  wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  const service = new ScanMgrService();
  const session = buildSession(TEST_SYSTEM_ID);

  seedPersistedProbes(session, [{ probeID: 9601 }, { probeID: 9602 }]);
  session.notifications.length = 0;

  service.Handle_ReconnectToLostProbes([], session);

  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(session.notifications.length, 3);
  assert.deepEqual(
    session.notifications.slice(0, 2).map((entry) => entry.name),
    ["OnNewProbe", "OnNewProbe"],
  );
  assert.equal(session.notifications[2].name, "OnProbesIdle");
  assert.equal(session.notifications[2].payload.length, 1);
  assert.equal(session.notifications[2].payload[0].length, 2);
});

test("QAOverrideProbeExpiry updates persisted probe expiry for the current character and system", () => {
  wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  const service = new ScanMgrService();
  const session = buildSession(TEST_SYSTEM_ID);

  seedPersistedProbes(session, [{ probeID: 9701 }]);

  const before = probeRuntimeState.getCharacterSystemProbes(
    session.characterID,
    TEST_SYSTEM_ID,
  );
  assert.equal(before.length, 1);

  service.Handle_QAOverrideProbeExpiry([1_000], session);

  const after = probeRuntimeState.getCharacterSystemProbes(
    session.characterID,
    TEST_SYSTEM_ID,
  );
  assert.equal(after.length, 1);
  assert.notEqual(String(after[0].expiry), String(before[0].expiry));
});

test("QAScanSites returns live resolved wormhole signature rows for the current system", () => {
  const seeded = wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  assert.equal(seeded.success, true);

  const pair = seeded.data.createdPairs[0];
  const service = new ScanMgrService();
  const session = buildSession(TEST_SYSTEM_ID);
  const sourceTargetID = service.Handle_GetScanTargetID([pair.source.endpointID], session);

  const allResults = service.Handle_QAScanSites([], session);
  assert(Array.isArray(allResults));
  assert(allResults.length >= 1);
  const resolvedAll = allResults.map((entry) => marshalObjectToObject(entry));
  assert(
    resolvedAll.some((entry) => String(entry.id) === String(sourceTargetID)),
    "expected QA results to include the source-side wormhole signature",
  );

  const filteredResults = service.Handle_QAScanSites([[sourceTargetID]], session);
  assert.equal(filteredResults.length, 1);
  const filtered = marshalObjectToObject(filteredResults[0]);
  assert.equal(String(filtered.id), String(sourceTargetID));
  assert.equal(Number(filtered.certainty), 1);

  const legacyFilteredResults = service.Handle_QAScanSites([[pair.source.endpointID]], session);
  assert.equal(legacyFilteredResults.length, 1);
  assert.equal(
    String(marshalObjectToObject(legacyFilteredResults[0]).id),
    String(sourceTargetID),
  );
});

test("probe scan result rows preserve provider metadata for packaged-client result history and labels", () => {
  const resultEntry = probeScanRuntime.buildScanResultEntry({
    siteID: 991001,
    targetID: "ABC-123",
    scanGroupID: 3,
    groupID: 502,
    typeID: 12345,
    strengthAttributeID: 1908,
    dungeonID: 44,
    dungeonNameID: 55,
    archetypeID: 66,
    factionID: 500001,
    itemID: 777,
    difficulty: 2,
    actualPosition: { x: 100, y: 200, z: 300 },
    position: [120, 220, 320],
    deviation: 5000,
  }, 1);

  const resolved = marshalObjectToObject(resultEntry);
  assert.equal(String(resolved.id), "ABC-123");
  assert.equal(Number(resolved.scanGroupID), 3);
  assert.equal(Number(resolved.groupID), 502);
  assert.equal(Number(resolved.typeID), 12345);
  assert.equal(Number(resolved.strengthAttributeID), 1908);
  assert.equal(Number(resolved.dungeonID), 44);
  assert.equal(Number(resolved.dungeonNameID), 55);
  assert.equal(Number(resolved.archetypeID), 66);
  assert.equal(Number(resolved.factionID), 500001);
  assert.equal(Number(resolved.itemID), 777);
  assert.equal(Number(resolved.difficulty), 2);
  assert.equal(Number(resolved.certainty), 1);
  assert.deepEqual(resolved.data, [100, 200, 300]);
  assert.deepEqual(resolved.pos, [100, 200, 300]);
});

test("probe scan result rows serialize exact positions as marshal-real vectors for packaged-client distance math", () => {
  const resultEntry = probeScanRuntime.buildScanResultEntry({
    siteID: 991001,
    targetID: "ABC-123",
    scanGroupID: 3,
    groupID: 502,
    typeID: 12345,
    strengthAttributeID: 1908,
    actualPosition: { x: 100, y: 200, z: 300 },
    position: [120, 220, 320],
    deviation: 5000,
  }, 1);

  const rawData = getKeyValField(resultEntry, "data");
  const rawPos = getKeyValField(resultEntry, "pos");

  assert.equal(Array.isArray(rawData), true);
  assert.equal(Array.isArray(rawPos), true);
  assert.equal(rawData.every((component) => component && component.type === "real"), true);
  assert.equal(rawPos.every((component) => component && component.type === "real"), true);
});

test("signal tracker signature positions serialize as marshal-real vectors for packaged-client overlays", () => {
  const seeded = wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  assert.equal(seeded.success, true);

  const service = new ScanMgrService();
  const session = buildSession(TEST_SYSTEM_ID);
  const fullState = service.Handle_GetFullState([], session);
  const signatureEntries = getSignatureEntries(fullState);
  assert.ok(signatureEntries.length >= 1);

  const rawSiteInfo = signatureEntries[0][1];
  const rawPosition = getKeyValField(rawSiteInfo, "position");

  assert.equal(Array.isArray(rawPosition), true);
  assert.equal(rawPosition.length, 3);
  assert.equal(rawPosition.every((component) => component && component.type === "real"), true);
});
