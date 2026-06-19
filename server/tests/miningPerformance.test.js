const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");

const config = require(path.join(repoRoot, "server/src/config"));
const {
  buildReprocessingQuoteForItem,
  buildReprocessingOptionsForTypes,
} = require(path.join(
  repoRoot,
  "server/src/services/mining/miningIndustry",
));
const {
  getCompressedTypeID,
} = require(path.join(
  repoRoot,
  "server/src/services/mining/miningStaticData",
));
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const {
  getNpcOreCargoSummary,
  _testing: miningNpcTesting,
} = require(path.join(
  repoRoot,
  "server/src/services/mining/miningNpcOperations",
));
const {
  _testing: miningRuntimeStateTesting,
} = require(path.join(
  repoRoot,
  "server/src/services/mining/miningRuntimeState",
));
const {
  resolveAggressorStandingProfile,
} = require(path.join(
  repoRoot,
  "server/src/services/mining/miningNpcStandings",
));
const {
  MINING_LEDGER_TABLE,
  buildVisibleAfterFiletime,
  buildDefaultMiningLedgerTable,
  clearMiningLedgerCaches,
  getCharacterMiningLogs,
  getObserverMiningLedger,
  recordMiningLedgerEvent,
} = require(path.join(
  repoRoot,
  "server/src/services/mining/miningLedgerState",
));

function measureAverageMs(fn, iterations = 5_000, warmup = 500) {
  for (let index = 0; index < warmup; index += 1) {
    fn();
  }

  const start = process.hrtime.bigint();
  for (let index = 0; index < iterations; index += 1) {
    fn();
  }
  const elapsedNs = process.hrtime.bigint() - start;
  return Number(elapsedNs) / 1e6 / iterations;
}

test("hot mining helpers stay comfortably below 1ms average", () => {
  miningNpcTesting.clearState();
  const originalCharacterDelayMs = config.miningCharacterLedgerDelayMs;
  const originalObserverDelayMs = config.miningObserverLedgerDelayMs;
  const characterResult = database.read("characters", "/");
  const characters = characterResult && characterResult.success && characterResult.data
    ? characterResult.data
    : {};
  const sampleCharacterID = Number(Object.keys(characters)[0] || 0);
  const reprocessingContext = {
    dockedKind: "station",
    stationRecord: {
      reprocessingEfficiency: 0.5,
      reprocessingStationsTake: 0.05,
    },
    skillMap: new Map(),
    implants: [],
  };
  const oreItem = {
    itemID: 910001,
    typeID: 1230,
    singleton: 0,
    quantity: 500,
    stacksize: 500,
  };
  const npcEntity = {
    nativeCargoItems: [
      { moduleID: 0, typeID: 34, quantity: 5000, stacksize: 5000, volume: 0.01 },
      { moduleID: 0, typeID: 35, quantity: 500, stacksize: 500, volume: 0.01 },
      { moduleID: 980100000001, typeID: 11101, quantity: 1, stacksize: 1, volume: 0.1 },
    ],
  };
  const aggressorEntity = {
    kind: "ship",
    itemID: 920000001,
    session: {
      characterID: sampleCharacterID,
    },
  };
  const miningNpcEntity = {
    kind: "ship",
    itemID: 920000002,
    corporationID: 1000129,
    factionID: 500014,
    hostileResponseThreshold: 11,
    friendlyResponseThreshold: 11,
  };
  const originalLedgerSnapshot = JSON.parse(
    JSON.stringify(
      (database.read(MINING_LEDGER_TABLE, "/").data || buildDefaultMiningLedgerTable()),
    ),
  );
  config.miningCharacterLedgerDelayMs = 0;
  config.miningObserverLedgerDelayMs = 0;
  database.write(MINING_LEDGER_TABLE, "/", buildDefaultMiningLedgerTable());
  clearMiningLedgerCaches();
  for (let index = 0; index < 20; index += 1) {
    recordMiningLedgerEvent({
      characterID: 99000021,
      corporationID: 98000021,
      solarSystemID: 30000142,
      typeID: index % 2 === 0 ? 1230 : 18,
      quantity: 100 + index,
      quantityWasted: index % 3,
      quantityCritical: index % 5,
      shipTypeID: 22544,
      moduleTypeID: 482,
      yieldKind: "ore",
      observerItemID: 1030000000042,
      eventDateMs: Date.now() - index,
    });
  }
  const haulingFleetRecord = miningNpcTesting.createMiningFleetRecord({
    systemID: 30000001,
    createdAtMs: 1_000,
    minerEntityIDs: [9300000001],
    haulerEntityIDs: [9300000002],
    haulerNextArrivalAtMs: 2_000,
  });
  const haulingScene = {
    getEntityByID(entityID) {
      if (Number(entityID) === 9300000001) {
        return {
          itemID: 9300000001,
          typeID: 32880,
          nativeCargoItems: [
            {
              moduleID: 0,
              typeID: 34,
              quantity: 450000,
              stacksize: 450000,
              volume: 0.01,
            },
          ],
        };
      }
      if (Number(entityID) === 9300000002) {
        return {
          itemID: 9300000002,
          typeID: 1944,
          nativeCargoItems: [],
        };
      }
      return null;
    },
  };
  const targetSelectionMiner = {
    itemID: 9300000101,
    kind: "ship",
    position: { x: 250_000, y: 0, z: 0 },
    radius: 80,
    mode: "STOP",
  };
  const targetSelectionClaimedAsteroid = {
    itemID: 9300000201,
    kind: "asteroid",
    position: { x: 250_100, y: 0, z: 0 },
    radius: 120,
  };
  const targetSelectionScene = {
    systemID: 30000145,
    staticEntities: [targetSelectionClaimedAsteroid],
    dynamicEntitiesByID: new Map([
      [targetSelectionMiner.itemID, targetSelectionMiner],
      [targetSelectionClaimedAsteroid.itemID, targetSelectionClaimedAsteroid],
    ]),
    _miningRuntimeState: {
      byEntityID: new Map([
        [targetSelectionClaimedAsteroid.itemID, {
          entityID: targetSelectionClaimedAsteroid.itemID,
          remainingQuantity: 10_000,
          yieldTypeID: 34,
        }],
      ]),
    },
    getEntityByID(entityID) {
      return this.dynamicEntitiesByID.get(Number(entityID)) || null;
    },
  };
  for (let index = 0; index < 64; index += 1) {
    const asteroid = {
      itemID: 9300000300 + index,
      kind: "asteroid",
      position: {
        x: 250_300 + (index * 300),
        y: (index % 4) * 150,
        z: 0,
      },
      radius: 120,
    };
    targetSelectionScene.staticEntities.push(asteroid);
    targetSelectionScene.dynamicEntitiesByID.set(asteroid.itemID, asteroid);
    targetSelectionScene._miningRuntimeState.byEntityID.set(asteroid.itemID, {
      entityID: asteroid.itemID,
      remainingQuantity: 10_000 + index,
      yieldTypeID: 34,
    });
  }
  const targetSelectionFleet = miningNpcTesting.createMiningFleetRecord({
    systemID: targetSelectionScene.systemID,
    minerEntityIDs: [targetSelectionMiner.itemID],
    haulerEntityIDs: [],
    originAnchor: {
      position: { x: 0, y: 0, z: 0 },
    },
  });
  miningNpcTesting.createMiningFleetRecord({
    systemID: targetSelectionScene.systemID,
    minerEntityIDs: [],
    haulerEntityIDs: [],
    activeAsteroidID: targetSelectionClaimedAsteroid.itemID,
    originAnchor: {
      position: { x: 0, y: 0, z: 0 },
    },
  });

  const quoteAvgMs = measureAverageMs(
    () => buildReprocessingQuoteForItem(oreItem, reprocessingContext),
    2_500,
  );
  const optionsAvgMs = measureAverageMs(
    () => buildReprocessingOptionsForTypes([1230, 18, 20, 62399, 62516]),
    5_000,
  );
  const compressionLookupAvgMs = measureAverageMs(
    () => getCompressedTypeID(1230),
    20_000,
  );
  const cargoSummaryAvgMs = measureAverageMs(
    () => getNpcOreCargoSummary(npcEntity),
    10_000,
  );
  const characterLedgerAvgMs = measureAverageMs(
    () => getCharacterMiningLogs(99000021),
    10_000,
  );
  const observerLedgerAvgMs = measureAverageMs(
    () => getObserverMiningLedger(1030000000042, 98000021, {
      nowFiletime: buildVisibleAfterFiletime(Date.now(), 0),
    }),
    10_000,
  );
  const standingsAvgMs = measureAverageMs(
    () => resolveAggressorStandingProfile(aggressorEntity, miningNpcEntity),
    10_000,
  );
  const beltTemplateLookupAvgMs = measureAverageMs(
    () => miningRuntimeStateTesting.getTemplateEntriesForFieldStyle(
      "empire_highsec_standard",
    ),
    20_000,
  );
  const miningQueryAvgMs = measureAverageMs(
    () => miningNpcTesting.resolveMiningFleetQuery(null, "", 30000001),
    10_000,
  );
  const haulingDecisionAvgMs = measureAverageMs(
    () => miningNpcTesting.shouldTriggerHauling(haulingScene, haulingFleetRecord, false, 2_500),
    10_000,
  );
  const fleetTargetChoiceAvgMs = measureAverageMs(
    () => miningNpcTesting.chooseFleetMineableTarget(
      targetSelectionScene,
      targetSelectionFleet,
    ),
    10_000,
  );

  database.write(MINING_LEDGER_TABLE, "/", originalLedgerSnapshot);
  clearMiningLedgerCaches();
  config.miningCharacterLedgerDelayMs = originalCharacterDelayMs;
  config.miningObserverLedgerDelayMs = originalObserverDelayMs;
  miningNpcTesting.clearState();

  assert.ok(quoteAvgMs < 1, `expected quote builder <1ms avg, got ${quoteAvgMs.toFixed(4)}ms`);
  assert.ok(optionsAvgMs < 1, `expected options builder <1ms avg, got ${optionsAvgMs.toFixed(4)}ms`);
  assert.ok(compressionLookupAvgMs < 1, `expected compression lookup <1ms avg, got ${compressionLookupAvgMs.toFixed(4)}ms`);
  assert.ok(cargoSummaryAvgMs < 1, `expected cargo summary <1ms avg, got ${cargoSummaryAvgMs.toFixed(4)}ms`);
  assert.ok(characterLedgerAvgMs < 1, `expected character ledger read <1ms avg, got ${characterLedgerAvgMs.toFixed(4)}ms`);
  assert.ok(observerLedgerAvgMs < 1, `expected observer ledger read <1ms avg, got ${observerLedgerAvgMs.toFixed(4)}ms`);
  assert.ok(standingsAvgMs < 1, `expected standings resolution <1ms avg, got ${standingsAvgMs.toFixed(4)}ms`);
  assert.ok(beltTemplateLookupAvgMs < 1, `expected belt template lookup <1ms avg, got ${beltTemplateLookupAvgMs.toFixed(4)}ms`);
  assert.ok(miningQueryAvgMs < 1, `expected mining query resolution <1ms avg, got ${miningQueryAvgMs.toFixed(4)}ms`);
  assert.ok(haulingDecisionAvgMs < 1, `expected hauling decision <1ms avg, got ${haulingDecisionAvgMs.toFixed(4)}ms`);
  assert.ok(fleetTargetChoiceAvgMs < 1, `expected fleet mineable target choice <1ms avg, got ${fleetTargetChoiceAvgMs.toFixed(4)}ms`);
});
