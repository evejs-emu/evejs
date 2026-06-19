const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const config = require(path.join(repoRoot, "server/src/config"));
const wormholeRuntime = require(path.join(
  repoRoot,
  "server/src/services/exploration/wormholes/wormholeRuntime",
));
const wormholeRuntimeState = require(path.join(
  repoRoot,
  "server/src/services/exploration/wormholes/wormholeRuntimeState",
));
const wormholeEnvironmentRuntime = require(path.join(
  repoRoot,
  "server/src/services/exploration/wormholes/wormholeEnvironmentRuntime",
));
const {
  DEFAULT_AU_METERS,
} = require(path.join(
  repoRoot,
  "server/src/services/exploration/signatures/signaturePlacement",
));
const destiny = require(path.join(
  repoRoot,
  "server/src/space/destiny",
));
const worldData = require(path.join(
  repoRoot,
  "server/src/space/worldData",
));
const {
  listSystems,
} = require(path.join(
  repoRoot,
  "server/src/services/exploration/wormholes/wormholeAuthority",
));
const WormholeMgrService = require(path.join(
  repoRoot,
  "server/src/services/exploration/wormholes/wormholeMgrService",
));
const {
  buildShipResourceState,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));
const {
  resolveItemByName,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemTypeRegistry",
));
const {
  buildLiveModuleAttributeMap,
} = require(path.join(
  repoRoot,
  "server/src/space/modules/liveModuleAttributes",
));
const {
  executeWormholeCommand,
} = require(path.join(
  repoRoot,
  "server/src/services/chat/wormhole/wormholeCommandHandlers",
));

const TEST_SYSTEM_ID = 31000007;
const CATACLYSMIC_SYSTEM_ID = (
  listSystems().find((system) => Number(system.environmentEffectTypeID) === 30883) || {}
).solarSystemID || 31002263;
const BLACK_HOLE_SYSTEM_ID = (
  listSystems().find((system) => Number(system.environmentEffectTypeID) === 30852) || {}
).solarSystemID || 31002255;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function distanceBetween(left, right) {
  const dx = (Number(left && left.x) || 0) - (Number(right && right.x) || 0);
  const dy = (Number(left && left.y) || 0) - (Number(right && right.y) || 0);
  const dz = (Number(left && left.z) || 0) - (Number(right && right.z) || 0);
  return Math.sqrt((dx ** 2) + (dy ** 2) + (dz ** 2));
}

function createFakeScene(systemID) {
  const scene = {
    systemID,
    staticEntities: [],
    staticEntitiesByID: new Map(),
    sessions: new Map(),
    visibilitySyncs: 0,
    slimUpdates: [],
    addBalls: [],
    addStaticEntity(entity) {
      const clone = cloneValue(entity);
      this.staticEntities.push(clone);
      this.staticEntitiesByID.set(clone.itemID, clone);
      return true;
    },
    removeStaticEntity(itemID) {
      this.staticEntities = this.staticEntities.filter((entry) => Number(entry.itemID) !== Number(itemID));
      this.staticEntitiesByID.delete(itemID);
    },
    syncDynamicVisibilityForAllSessions() {
      this.visibilitySyncs += 1;
    },
    broadcastSlimItemChanges(changes) {
      this.slimUpdates.push(...changes.map((entry) => cloneValue(entry)));
    },
    sendAddBallsToSession(session, entities) {
      this.addBalls.push({
        sessionID: Number(session && session.clientID) || 0,
        entityIDs: (Array.isArray(entities) ? entities : [])
          .map((entry) => Number(entry && entry.itemID) || 0)
          .filter((value) => value > 0),
      });
    },
  };
  return scene;
}

function restoreState(snapshot) {
  database.write("wormholeRuntimeState", "/", cloneValue(snapshot));
  wormholeRuntimeState.clearRuntimeCache();
}

const originalWormholeState = cloneValue(
  database.read("wormholeRuntimeState", "/").data || {},
);
const emptyWormholeState = {
  version: 2,
  nextPairSequence: 1,
  nextEndpointSequence: 1,
  universeSeededAtMs: 0,
  pairsByID: {},
  staticSlotsByKey: {},
  polarizationByCharacter: {},
};
const originalWormholesEnabled = config.wormholesEnabled;
const originalWormholeWanderingEnabled = config.wormholeWanderingEnabled;
const originalWormholeWanderingCountScale = config.wormholeWanderingCountScale;
const originalWormholeWanderingRespawnDelaySeconds = config.wormholeWanderingRespawnDelaySeconds;

test.beforeEach(() => {
  config.wormholesEnabled = true;
  config.wormholeWanderingEnabled = true;
  config.wormholeWanderingCountScale = 1;
  config.wormholeWanderingRespawnDelaySeconds = 60;
  restoreState(emptyWormholeState);
});

test.after(() => {
  config.wormholesEnabled = originalWormholesEnabled;
  config.wormholeWanderingEnabled = originalWormholeWanderingEnabled;
  config.wormholeWanderingCountScale = originalWormholeWanderingCountScale;
  config.wormholeWanderingRespawnDelaySeconds = originalWormholeWanderingRespawnDelaySeconds;
  restoreState(originalWormholeState);
});

test("wormhole static seeding creates an active J-space static with a hidden K162 endpoint", () => {
  const result = wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  assert.equal(result.success, true);
  assert.ok(result.data.createdPairs.length > 0);

  const pair = result.data.createdPairs[0];
  assert.equal(pair.kind, "static");
  assert.equal(pair.state, "active");
  assert.equal(pair.source.systemID, TEST_SYSTEM_ID);
  assert.equal(pair.source.discovered, true);
  assert.equal(pair.destination.code, "K162");
  assert.equal(pair.destination.discovered, false);
  assert(pair.destination.systemID > 0);
});

test("prepareJump reveals the opposite endpoint and commitJump applies endpoint polarization", () => {
  const seeded = wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  const pair = seeded.data.createdPairs[0];
  const jumpMass = Math.max(1, Number(pair.maxJumpMass) || 1);

  const prepareResult = wormholeRuntime.prepareJump(
    pair.source.endpointID,
    140000003,
    jumpMass,
    Date.now(),
  );
  assert.equal(prepareResult.success, true);
  assert.equal(prepareResult.data.destinationEndpointID, pair.destination.endpointID);

  const viewsAfterPrepare = wormholeRuntime.listPairViews({
    systemID: pair.destination.systemID,
    includeUndiscovered: true,
  });
  const preparedView = viewsAfterPrepare.find((entry) => entry.pairID === pair.pairID);
  assert(preparedView, "expected prepared pair to be listed");
  assert.equal(preparedView.destinationDiscovered, true);

  wormholeRuntime.commitJump(
    pair.source.endpointID,
    140000003,
    jumpMass,
    Date.now(),
  );
  const polarization = wormholeRuntime.getPolarization(
    pair.source.endpointID,
    140000003,
    Date.now(),
  );
  assert(polarization, "expected source endpoint polarization after jump commit");
  assert(polarization.endAtMs > Date.now());
  assert.equal(polarization.durationSeconds, wormholeRuntime.POLARIZATION_DURATION_SECONDS);
});

test("warping to a wormhole only promotes the far-side K162 to an invisible pending state", () => {
  const seeded = wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  const pair = seeded.data.createdPairs[0];

  wormholeRuntime.markWarpInitiated(pair.source.endpointID, Date.now());

  const viewsAfterWarp = wormholeRuntime.listPairViews({
    systemID: pair.destination.systemID,
    includeUndiscovered: true,
  });
  const entry = viewsAfterWarp.find((row) => row.pairID === pair.pairID);
  assert(entry, "expected wormhole pair view after warp initiation");
  assert.equal(entry.destinationVisibilityState, "invisible");
  assert.equal(entry.destinationDiscovered, false);

  const destinationScene = createFakeScene(pair.destination.systemID);
  wormholeRuntime.handleSceneCreated(destinationScene);
  assert.equal(
    destinationScene.staticEntitiesByID.has(pair.destination.endpointID),
    false,
    "expected invisible K162 to stay absent from the far-side scene",
  );
});

test("wormhole endpoints now land at roughly four AU from nearby scene anchors", () => {
  const pose = wormholeRuntime._testing.buildEndpointPose(TEST_SYSTEM_ID, "test-au-placement");
  const anchors = new Map([
    ...worldData.getCelestialsForSystem(TEST_SYSTEM_ID)
      .filter((entry) => entry && entry.itemID && Number(entry.groupID || 0) !== 6 && entry.kind !== "sun")
      .map((entry) => [Number(entry.itemID), entry.position]),
    ...worldData.getStargatesForSystem(TEST_SYSTEM_ID).map((entry) => [Number(entry.itemID), entry.position]),
    ...worldData.getStationsForSystem(TEST_SYSTEM_ID).map((entry) => [Number(entry.itemID), entry.position]),
  ]);
  const anchorPosition = anchors.get(Number(pose.anchorItemID));
  assert.ok(anchorPosition, "expected wormhole pose to preserve its selected anchor");

  const anchorDistance = distanceBetween(pose.position, anchorPosition);
  assert.equal(anchorDistance >= (3.5 * DEFAULT_AU_METERS), true);
  assert.equal(anchorDistance <= (4.5 * DEFAULT_AU_METERS), true);
  assert.equal(Number(pose.anchorDistanceAu) >= 3.5, true);
  assert.equal(Number(pose.anchorDistanceAu) <= 4.5, true);
});

test("full-mass wormholes do not advance mass state timestamps when no regeneration work is needed", () => {
  const pair = {
    totalMass: 1_000_000_000,
    remainingMass: 1_000_000_000,
    massRegeneration: 50_000_000,
    lastMassStateAtMs: 12345,
    massRegenRemainder: 0,
  };

  wormholeRuntime._testing.applyMassRegeneration(pair, 67890);

  assert.equal(pair.lastMassStateAtMs, 12345);
  assert.equal(pair.massRegenRemainder, 0);
});

test("revealed global K162 endpoints acquire into already loaded destination scenes", () => {
  const seeded = wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  const pair = seeded.data.createdPairs[0];
  const destinationScene = createFakeScene(pair.destination.systemID);
  destinationScene.sessions.set(1, {
    clientID: 1,
    _space: {
      initialStateSent: true,
    },
  });

  wormholeRuntime.handleSceneCreated(destinationScene);
  assert.equal(destinationScene.addBalls.length, 0);

  wormholeRuntime.prepareJump(
    pair.source.endpointID,
    140000003,
    Math.max(1, Number(pair.maxJumpMass) || 1),
    Date.now(),
  );
  wormholeRuntime.syncSceneEntities(destinationScene, Date.now());

  assert.equal(
    destinationScene.staticEntitiesByID.has(pair.destination.endpointID),
    true,
    "expected revealed K162 entity to materialize in the loaded destination scene",
  );
  assert.ok(
    destinationScene.addBalls.some((entry) => entry.entityIDs.includes(pair.destination.endpointID)),
    "expected revealed K162 to be sent through AddBalls to loaded destination sessions",
  );
});

test("wormhole slim payload uses client-safe controller fields", () => {
  const seeded = wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  const pair = seeded.data.createdPairs[0];
  const sourceEntity = wormholeRuntime.buildSystemSummaryViews({
    systemID: TEST_SYSTEM_ID,
    includeCollapsed: false,
    includeUndiscovered: true,
  });
  assert(sourceEntity);

  const scene = createFakeScene(TEST_SYSTEM_ID);
  wormholeRuntime.handleSceneCreated(scene);
  const wormholeEntity = scene.staticEntities.find((entry) => entry && entry.kind === "wormhole");
  assert(wormholeEntity, "expected visible wormhole entity in source scene");
  assert.ok([1, 0.7, 0.4].includes(Number(wormholeEntity.wormholeSize)));

  const slim = destiny.buildSlimItemDict(wormholeEntity);
  const slimEntries = new Map(Array.isArray(slim.entries) ? slim.entries : []);
  assert.equal(slimEntries.get("isDestTriglavian"), 0);
  assert.ok([1, 0.7, 0.4].includes(Number(slimEntries.get("wormholeSize"))));
});

test("wormholeMgr GetWormholePolarization returns the client tuple contract", () => {
  const seeded = wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  const pair = seeded.data.createdPairs[0];
  wormholeRuntime.commitJump(
    pair.source.endpointID,
    140000003,
    Math.max(1, Number(pair.maxJumpMass) || 1),
    Date.now(),
  );

  const service = new WormholeMgrService();
  const payload = service.Handle_GetWormholePolarization(
    [pair.source.endpointID],
    { characterID: 140000003 },
  );
  assert.ok(Array.isArray(payload));
  assert.equal(payload.length, 2);
  assert.equal(payload[0].type, "long");
  assert.equal(typeof payload[1], "number");
  assert(payload[1] > 0);
});

test("wormhole jumps use the retail delayed handoff window instead of mutating the session immediately", () => {
  let scheduledDelay = 0;
  let callback = null;
  const timer = WormholeMgrService._testing.scheduleWormholeJumpHandoff(
    () => {},
    (fn, delay) => {
      callback = fn;
      scheduledDelay = Number(delay) || 0;
      return {
        unrefCalled: false,
        unref() {
          this.unrefCalled = true;
        },
      };
    },
  );

  assert.equal(scheduledDelay, WormholeMgrService._testing.WORMHOLE_JUMP_HANDOFF_DELAY_MS);
  assert.equal(scheduledDelay, 1500);
  assert.equal(typeof callback, "function");
  assert(timer);
});

test("/wormholes renders active connections with readable per-line system output", () => {
  wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  const result = executeWormholeCommand(
    { solarsystemid2: TEST_SYSTEM_ID },
    "wormholes",
    "here",
  );
  assert.equal(result.success, true);
  assert.match(result.message, /^Tracked wormholes for J105443 \(\d+\):/);
  assert.match(result.message, /J105443/);
  assert.match(result.message, /\| -> /);
  assert.match(result.message, /\| life /);
  assert.match(result.message, /\| mass /);
  assert.match(result.message, /\| stability /);
  assert.match(result.message, /\| jump /);
});

test("/wormholes systems renders a readable grouped summary by solar system", () => {
  wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  const result = executeWormholeCommand(
    { solarsystemid2: TEST_SYSTEM_ID },
    "wormholes",
    "systems all",
  );
  assert.equal(result.success, true);
  assert.match(result.message, /^Systems with tracked wormholes \(\d+\):/);
  assert.match(result.message, /J105443 \(/);
  assert.match(result.message, /\| static /);
  assert.match(result.message, /\| discovered /);
  assert.match(result.message, /\| codes /);
});

test("wormhole runtime exposes stable system and universe summaries", () => {
  wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  const systemSummary = wormholeRuntime.buildSystemSummaryViews({
    systemID: TEST_SYSTEM_ID,
    includeCollapsed: false,
    includeUndiscovered: true,
  })[0];
  assert(systemSummary);
  assert.equal(systemSummary.systemID, TEST_SYSTEM_ID);
  assert(systemSummary.activePairCount >= 1);
  assert(systemSummary.codes.length >= 1);

  const universeSummary = wormholeRuntime.buildUniverseSummary({
    includeCollapsed: false,
    includeUndiscovered: true,
  });
  assert(universeSummary.activePairCount >= 1);
  assert(universeSummary.systemCount >= 1);
  assert.equal(
    universeSummary.staticPairCount + universeSummary.randomPairCount,
    universeSummary.activePairCount,
  );
});

test("global wormhole listing seeds the universe-wide static network on first access", () => {
  const result = executeWormholeCommand(
    { solarsystemid2: TEST_SYSTEM_ID },
    "wormholes",
    "all",
  );
  assert.equal(result.success, true);
  assert.match(result.message, /^Tracked wormholes \(\d+\):/);

  const state = database.read("wormholeRuntimeState", "/").data || {};
  assert(Number(state.universeSeededAtMs) > 0);
  assert(Object.keys(state.pairsByID || {}).length > 100);
  assert(
    Object.values(state.pairsByID || {}).some((pair) => String(pair.kind || "").toLowerCase() === "random"),
    "expected automatic wandering profiles to seed random wormhole pairs",
  );
});

test("/wormhole ensure all seeds universe statics and returns a useful summary", () => {
  const result = executeWormholeCommand(
    { solarsystemid2: TEST_SYSTEM_ID },
    "wormhole",
    "ensure all",
  );
  assert.equal(result.success, true);
  assert.match(result.message, /^Ensured wormhole statics across \d+ tracked connection\(s\)\./);

  const state = database.read("wormholeRuntimeState", "/").data || {};
  assert(Number(state.universeSeededAtMs) > 0);
  assert(Object.keys(state.pairsByID || {}).length > 100);
});

test("first scene load seeds universe statics automatically", () => {
  const scene = createFakeScene(TEST_SYSTEM_ID);
  wormholeRuntime.handleSceneCreated(scene);

  const state = database.read("wormholeRuntimeState", "/").data || {};
  assert(Number(state.universeSeededAtMs) > 0);
  assert(Object.keys(state.pairsByID || {}).length > 100);
  assert(scene.staticEntities.length > 0);
});

test("wormhole environment authority materializes a secondary sun in affected systems", () => {
  const descriptor = wormholeEnvironmentRuntime.getSystemEnvironmentDescriptor(CATACLYSMIC_SYSTEM_ID);
  assert(descriptor, "expected wormhole environment descriptor");
  assert.equal(descriptor.environmentFamily, "Cataclysmic Variable");
  assert.equal(descriptor.environmentEffectTypeID, 30883);
  assert(Number.isFinite(descriptor.environmentPosition.x));

  const scene = createFakeScene(CATACLYSMIC_SYSTEM_ID);
  wormholeRuntime.handleSceneCreated(scene);

  const secondarySun = scene.staticEntities.find((entry) => entry && entry.kind === "secondarySun");
  assert(secondarySun, "expected wormhole secondary sun entity");
  assert.equal(secondarySun.typeID, descriptor.environmentTypeID);
  assert.equal(secondarySun.environmentEffectTypeID, descriptor.environmentEffectTypeID);

  const effectBeacon = scene.staticEntities.find((entry) => entry && entry.kind === "effectBeacon");
  assert(effectBeacon, "expected wormhole effect beacon entity");
  assert.equal(effectBeacon.typeID, descriptor.environmentEffectTypeID);
  assert.equal(effectBeacon.environmentEffectTypeID, descriptor.environmentEffectTypeID);
});

test("wormhole environment authority exposes the packaged-client systemWideEffects HUD payload", () => {
  const descriptor = wormholeEnvironmentRuntime.getSystemEnvironmentDescriptor(CATACLYSMIC_SYSTEM_ID);
  assert(descriptor, "expected wormhole environment descriptor");

  const payload = wormholeEnvironmentRuntime.buildSystemWideEffectsPayloadForSystem(
    CATACLYSMIC_SYSTEM_ID,
  );
  assert(payload, "expected systemWideEffectsOnShip payload for wormhole environment systems");
  assert.equal(payload.type, "dict");
  assert.equal(payload.entries.length, 1);

  const [sourceKey, effectSet] = payload.entries[0];
  assert.equal(sourceKey && sourceKey.type, "tuple");
  assert.deepEqual(
    sourceKey.items,
    [
      wormholeEnvironmentRuntime.EFFECT_BEACON_ITEM_ID_BASE + CATACLYSMIC_SYSTEM_ID,
      descriptor.environmentEffectTypeID,
    ],
    "expected the HUD key to point at the effect-beacon source and environment effect type",
  );
  assert.equal(effectSet && effectSet.type, "objectex1");
  assert.equal(effectSet.header[0] && effectSet.header[0].value, "__builtin__.set");
  assert.ok(
    Array.isArray(effectSet.header[1]) &&
      effectSet.header[1][0] &&
      effectSet.header[1][0].type === "list",
    "expected the HUD payload to carry a Python set of active system-wide effect IDs",
  );
  assert.ok(
    effectSet.header[1][0].items.length > 0,
    "expected the environment HUD payload to expose at least one active effect ID",
  );
});

test("cataclysmic variable direct ship modifiers change capacitor state", () => {
  const shipType = resolveItemByName("587");
  assert(shipType && shipType.match, "expected Rifter item type");
  const shipItem = {
    itemID: 910000001,
    typeID: shipType.match.typeID,
    groupID: shipType.match.groupID,
    categoryID: shipType.match.categoryID,
    itemName: shipType.match.name,
  };

  const baseline = buildShipResourceState(0, shipItem, {
    fittedItems: [],
    skillMap: new Map(),
  });
  const modified = buildShipResourceState(0, shipItem, {
    fittedItems: [],
    skillMap: new Map(),
    additionalAttributeModifierEntries:
      wormholeEnvironmentRuntime.collectShipAttributeModifierEntriesForSystem(
        CATACLYSMIC_SYSTEM_ID,
      ),
  });

  assert(
    Number(modified.attributes[482]) > Number(baseline.attributes[482]),
    "expected capacitor capacity bonus from cataclysmic variable",
  );
  assert(
    Number(modified.attributes[55]) > Number(baseline.attributes[55]),
    "expected recharge time penalty from cataclysmic variable",
  );
});

test("wormhole environment location modifiers alter live module attributes", () => {
  const shipType = resolveItemByName("587");
  const moduleType = resolveItemByName("Small Shield Booster I");
  assert(shipType && shipType.match, "expected Rifter item type");
  assert(moduleType && moduleType.match, "expected Small Shield Booster I item type");

  const shipItem = {
    itemID: 910000002,
    typeID: shipType.match.typeID,
    groupID: shipType.match.groupID,
    categoryID: shipType.match.categoryID,
    itemName: shipType.match.name,
  };
  const moduleItem = {
    itemID: 910000003,
    typeID: moduleType.match.typeID,
    groupID: moduleType.match.groupID,
    categoryID: moduleType.match.categoryID,
    itemName: moduleType.match.name,
    locationID: shipItem.itemID,
    flagID: 27,
    singleton: 1,
    quantity: 1,
    stacksize: 1,
    moduleState: { online: true },
  };

  const baseline = buildLiveModuleAttributeMap(
    shipItem,
    moduleItem,
    null,
    new Map(),
    [],
    [],
  );
  const modified = buildLiveModuleAttributeMap(
    shipItem,
    moduleItem,
    null,
    new Map(),
    [],
    [],
    {
      additionalLocationModifierSources:
        wormholeEnvironmentRuntime.getLocationModifierSourcesForSystem(
          CATACLYSMIC_SYSTEM_ID,
        ),
    },
  );

  assert(
    Number(modified[68]) < Number(baseline[68]),
    "expected local shield boosting penalty from cataclysmic variable",
  );
});

test("black hole environment location modifiers improve missile flight attributes", () => {
  const shipType = resolveItemByName("587");
  const launcherType = resolveItemByName("Light Missile Launcher I");
  const chargeType = resolveItemByName("Scourge Light Missile");
  assert(shipType && shipType.match, "expected ship item type");
  assert(launcherType && launcherType.match, "expected launcher item type");
  assert(chargeType && chargeType.match, "expected missile charge type");

  const { buildWeaponModuleSnapshot } = require(path.join(
    repoRoot,
    "server/src/space/combat/weaponDogma",
  ));

  const shipItem = {
    itemID: 910000010,
    typeID: shipType.match.typeID,
    groupID: shipType.match.groupID,
    categoryID: shipType.match.categoryID,
    itemName: shipType.match.name,
  };
  const moduleItem = {
    itemID: 910000011,
    typeID: launcherType.match.typeID,
    groupID: launcherType.match.groupID,
    categoryID: launcherType.match.categoryID,
    itemName: launcherType.match.name,
    locationID: shipItem.itemID,
    flagID: 27,
    singleton: 1,
    quantity: 1,
    stacksize: 1,
    moduleState: { online: true },
  };
  const chargeItem = {
    itemID: 910000012,
    typeID: chargeType.match.typeID,
    groupID: chargeType.match.groupID,
    categoryID: chargeType.match.categoryID,
    itemName: chargeType.match.name,
    locationID: shipItem.itemID,
    flagID: 27,
    singleton: 0,
    quantity: 100,
    stacksize: 100,
  };

  const baseline = buildWeaponModuleSnapshot({
    characterID: 0,
    shipItem,
    moduleItem,
    chargeItem,
    fittedItems: [moduleItem],
    skillMap: new Map(),
    activeModuleContexts: [],
  });
  const modified = buildWeaponModuleSnapshot({
    characterID: 0,
    shipItem,
    moduleItem,
    chargeItem,
    fittedItems: [moduleItem],
    skillMap: new Map(),
    activeModuleContexts: [],
    additionalLocationModifierSources:
      wormholeEnvironmentRuntime.getLocationModifierSourcesForSystem(
        BLACK_HOLE_SYSTEM_ID,
      ),
  });

  assert(modified, "expected missile snapshot with environment");
  assert(
    Number(modified.maxVelocity) > Number(baseline.maxVelocity),
    "expected missile velocity bonus from black hole",
  );
  assert(
    Number(modified.explosionVelocity) > Number(baseline.explosionVelocity),
    "expected missile explosion velocity bonus from black hole",
  );
});

test("revealed destination wormhole materializes when the destination scene loads after jump prep", () => {
  const seeded = wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, Date.now());
  const pair = seeded.data.createdPairs[0];
  const prepareResult = wormholeRuntime.prepareJump(
    pair.source.endpointID,
    140000003,
    Math.max(1, Number(pair.maxJumpMass) || 1),
    Date.now(),
  );
  assert.equal(prepareResult.success, true);

  const destinationScene = createFakeScene(pair.destination.systemID);
  wormholeRuntime.handleSceneCreated(destinationScene);

  const destinationEntity = destinationScene.staticEntitiesByID.get(pair.destination.endpointID);
  assert(destinationEntity, "expected destination wormhole entity to materialize in loaded destination scene");
  assert.equal(destinationEntity.kind, "wormhole");
  assert.equal(destinationEntity.itemID, pair.destination.endpointID);
  assert.equal(destinationEntity.otherSolarSystemClass, pair.source.wormholeClassID);
});

test("small-ship wormholes regenerate mass over runtime ticks", () => {
  const nowMs = Date.now();
  wormholeRuntime.ensureUniverseStatics(nowMs);
  const activePairs = Object.values(database.read("wormholeRuntimeState", "/").data.pairsByID || {});
  const pair = activePairs.find((entry) => Number(entry.massRegeneration || 0) > 0);
  assert(pair, "expected at least one active regenerating wormhole pair");

  wormholeRuntime.commitJump(
    pair.source.endpointID,
    140000003,
    Math.min(1_000_000, Math.max(1, Number(pair.maxJumpMass || 1))),
    nowMs,
  );
  const afterCommit = Object.values(database.read("wormholeRuntimeState", "/").data.pairsByID || {})
    .find((entry) => Number(entry.pairID) === Number(pair.pairID));
  assert(afterCommit);
  assert(Number(afterCommit.remainingMass) < Number(afterCommit.totalMass));

  const scene = createFakeScene(afterCommit.source.systemID);
  wormholeRuntime.tickScene(scene, nowMs + (60 * 60 * 1000));

  const afterTick = Object.values(database.read("wormholeRuntimeState", "/").data.pairsByID || {})
    .find((entry) => Number(entry.pairID) === Number(pair.pairID));
  assert(afterTick);
  assert(Number(afterTick.remainingMass) > Number(afterCommit.remainingMass));
  assert(Number(afterTick.remainingMass) <= Number(afterTick.totalMass));
});

test("late-life invisible K162 exits can appear passively before first jump", () => {
  const nowMs = Date.now();
  const seeded = wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, nowMs);
  const pair = seeded.data.createdPairs[0];
  wormholeRuntime.markWarpInitiated(pair.source.endpointID, nowMs);

  const state = cloneValue(database.read("wormholeRuntimeState", "/").data || {});
  const trackedPair = Object.values(state.pairsByID || {})
    .find((entry) => Number(entry.pairID) === Number(pair.pairID));
  assert(trackedPair);
  trackedPair.expiresAtMs = nowMs + (10 * 60 * 1000);
  database.write("wormholeRuntimeState", "/", state);
  wormholeRuntimeState.clearRuntimeCache();

  const scene = createFakeScene(pair.source.systemID);
  wormholeRuntime.tickScene(scene, nowMs + 1000);

  const afterTick = Object.values(database.read("wormholeRuntimeState", "/").data.pairsByID || {})
    .find((entry) => Number(entry.pairID) === Number(pair.pairID));
  assert(afterTick);
  assert.equal(afterTick.destination.visibilityState, "visible");
  assert.equal(afterTick.destination.discovered, true);
});

test("wormhole age states follow CCP's absolute lifetime buckets, not percent-of-life buckets", () => {
  const nowMs = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const pair = {
    createdAtMs: nowMs - (23 * 60 * 60 * 1000),
    expiresAtMs: nowMs + (101 * 60 * 1000),
  };

  assert.equal(wormholeRuntime._testing.resolveWormholeAge(pair, nowMs), 2);
  assert.equal(wormholeRuntime._testing.resolveWormholeAge({
    ...pair,
    expiresAtMs: nowMs + (59 * 60 * 1000),
  }, nowMs), 3);
  assert.equal(wormholeRuntime._testing.resolveWormholeAge({
    ...pair,
    expiresAtMs: nowMs + (3 * 60 * 60 * 1000),
  }, nowMs), 2);
  assert.equal(wormholeRuntime._testing.resolveWormholeAge({
    ...pair,
    expiresAtMs: nowMs + (12 * 60 * 60 * 1000),
  }, nowMs), 1);
  assert.equal(wormholeRuntime._testing.resolveWormholeAge({
    createdAtMs: nowMs,
    expiresAtMs: nowMs + (2 * dayMs),
  }, nowMs), 0);
  assert.equal(wormholeRuntime._testing.resolveWormholeAge({
    ...pair,
    state: "collapsed",
    collapseAtMs: nowMs - 1,
  }, nowMs), 4);
});

test("post-jump spawn distance scales by ship mass and wormhole disruption", () => {
  const nowMs = Date.now();
  const seeded = wormholeRuntime.ensureSystemStatics(TEST_SYSTEM_ID, nowMs);
  const pair = seeded.data.createdPairs[0];

  const smallSpawn = wormholeRuntime.buildJumpSpawnState(pair, "source", {
    shipMass: 1_280_000,
    nowMs,
    characterID: 1,
    randomSeed: 999999,
  });
  const capitalSpawn = wormholeRuntime.buildJumpSpawnState(pair, "source", {
    shipMass: 1_240_000_000,
    nowMs,
    characterID: 1,
    randomSeed: 999999,
  });
  const smallSurfaceDistance =
    distanceBetween(smallSpawn.position, pair.destination.position) - Number(pair.destination.radius || 0);
  const capitalSurfaceDistance =
    distanceBetween(capitalSpawn.position, pair.destination.position) - Number(pair.destination.radius || 0);
  assert(capitalSurfaceDistance > smallSurfaceDistance);

  const criticalPair = cloneValue(pair);
  criticalPair.remainingMass = Math.max(1, Math.round(Number(criticalPair.totalMass || 0) * 0.05));
  const freshDistance =
    distanceBetween(
      wormholeRuntime.buildJumpSpawnState(pair, "source", {
        shipMass: 250_000_000,
        nowMs,
        characterID: 1,
        randomSeed: 999999,
      }).position,
      pair.destination.position,
    ) - Number(pair.destination.radius || 0);
  const criticalDistance =
    distanceBetween(
      wormholeRuntime.buildJumpSpawnState(criticalPair, "source", {
        shipMass: 250_000_000,
        nowMs,
        characterID: 1,
        randomSeed: 999999,
      }).position,
      criticalPair.destination.position,
    ) - Number(criticalPair.destination.radius || 0);
  assert(criticalDistance > freshDistance);
});

test("automatic wandering profiles seed active random pairs during universe initialization", () => {
  const seeded = wormholeRuntime.ensureUniverseStatics(Date.now());
  assert.equal(seeded.success, true);

  const entries = wormholeRuntime.listPairViews({
    includeCollapsed: false,
    includeUndiscovered: true,
  });
  const randomEntries = entries.filter((entry) => entry.kind === "random");
  assert(randomEntries.length > 0, "expected automatic wandering wormholes to be active");
  assert(
    randomEntries.every((entry) => entry.randomProfileKey),
    "expected automatic wandering pairs to carry a randomProfileKey",
  );
});

test("collapsed wandering profiles wait out their respawn delay before replenishing", () => {
  const nowMs = Date.now();
  const seeded = wormholeRuntime.ensureUniverseStatics(nowMs);
  assert.equal(seeded.success, true);

  const beforeEntries = wormholeRuntime.listPairViews({
    includeCollapsed: false,
    includeUndiscovered: true,
  }).filter((entry) => entry.kind === "random");
  const targetEntry = beforeEntries.find((entry) => entry.randomProfileKey);
  assert(targetEntry, "expected at least one automatic wandering profile entry");

  const profileKey = targetEntry.randomProfileKey;
  const countBefore = beforeEntries.filter((entry) => entry.randomProfileKey === profileKey).length;
  wormholeRuntime.clearPairs(targetEntry.sourceSystemID, nowMs);

  wormholeRuntime.ensureUniverseStatics(nowMs);
  const immediateCount = wormholeRuntime.listPairViews({
    includeCollapsed: false,
    includeUndiscovered: true,
  }).filter((entry) => entry.kind === "random" && entry.randomProfileKey === profileKey).length;
  assert.equal(immediateCount, countBefore - 1);

  wormholeRuntime.ensureUniverseStatics(
    nowMs + (config.wormholeWanderingRespawnDelaySeconds * 1000) + 1,
  );
  const replenishedCount = wormholeRuntime.listPairViews({
    includeCollapsed: false,
    includeUndiscovered: true,
  }).filter((entry) => entry.kind === "random" && entry.randomProfileKey === profileKey).length;
  assert.equal(replenishedCount, countBefore);
});
