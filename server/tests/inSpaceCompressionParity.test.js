const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..", "..");

const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const miningIndustry = require(path.join(
  repoRoot,
  "server/src/services/mining/miningIndustry",
));
const fleetRuntime = require(path.join(
  repoRoot,
  "server/src/services/fleets/fleetRuntime",
));
const {
  buildInventoryItem,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  resolveItemByName,
  resolveItemByTypeID,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemTypeRegistry",
));
const {
  getCharacterSkillMap,
} = require(path.join(
  repoRoot,
  "server/src/services/skills/skillState",
));

const DEFAULT_PASSIVE_STATE = Object.freeze({
  mass: 250_000_000,
  inertia: 0.5,
  agility: 0.5,
  maxVelocity: 500,
  maxTargetRange: 250_000,
  maxLockedTargets: 8,
  signatureRadius: 500,
  scanResolution: 300,
  cloakingTargetingDelay: 0,
  capacitorCapacity: 1_000_000,
  capacitorRechargeRate: 1_000,
  shieldCapacity: 250_000,
  shieldRechargeRate: 1_000,
  armorHP: 250_000,
  structureHP: 250_000,
});

function serialTest(name, fn) {
  return test(name, { concurrency: false }, fn);
}

function resolveExactItem(name) {
  const result = resolveItemByName(name);
  if (result && result.success === true && result.match) {
    return result.match;
  }
  if (
    result &&
    result.errorMsg === "AMBIGUOUS_ITEM_NAME" &&
    Array.isArray(result.suggestions)
  ) {
    const publishedExactMatch = result.suggestions.find((entry) => (
      typeof entry === "string" &&
      !entry.includes("unpublished") &&
      entry.startsWith(`${name} (`)
    ));
    if (publishedExactMatch) {
      const typeIDMatch = publishedExactMatch.match(/\((\d+)\)$/);
      const typeID = Number(typeIDMatch && typeIDMatch[1]);
      const resolvedByTypeID = resolveItemByTypeID(typeID);
      if (resolvedByTypeID && resolvedByTypeID.typeID) {
        return resolvedByTypeID;
      }
    }
  }

  assert.equal(result && result.success, true, `Expected item '${name}' to exist`);
  return result.match;
}

function buildFittedModule(typeName, itemID, shipID, flagID) {
  const type = resolveExactItem(typeName);
  return buildInventoryItem({
    itemID,
    typeID: type.typeID,
    ownerID: 9000001,
    locationID: shipID,
    flagID,
    singleton: 1,
    moduleState: {
      online: true,
    },
  });
}

function buildCargoItem(typeName, itemID, shipID, quantity = 1) {
  const type = resolveExactItem(typeName);
  return buildInventoryItem({
    itemID,
    typeID: type.typeID,
    ownerID: 9000001,
    locationID: shipID,
    flagID: 5,
    singleton: 0,
    quantity,
    stacksize: quantity,
  });
}

function buildRuntimeShipEntity(scene, typeName, itemID, characterID, position, fittedItems = []) {
  const type = resolveExactItem(typeName);
  return spaceRuntime._testing.buildRuntimeShipEntityForTesting({
    itemID,
    typeID: type.typeID,
    groupID: type.groupID,
    categoryID: type.categoryID,
    itemName: String(type.name || typeName),
    ownerID: characterID,
    characterID,
    // Keep the client-visible slim charID, but force runtime fitting lookups to
    // use the injected `fittedItems` array instead of player inventory state.
    pilotCharacterID: 0,
    position,
    fittedItems,
    passiveResourceState: {
      ...DEFAULT_PASSIVE_STATE,
    },
  }, scene.systemID);
}

function attachSession(scene, entity, clientID, characterID) {
  const notifications = [];
  const session = {
    clientID,
    characterID,
    charid: characterID,
    corporationID: 1000044,
    shipTypeID: entity.typeID,
    _space: {
      systemID: scene.systemID,
      shipID: entity.itemID,
      initialStateSent: true,
      visibleDynamicEntityIDs: new Set(),
      freshlyVisibleDynamicEntityIDs: new Set(),
      timeDilation: scene.getTimeDilation(),
      simTimeMs: scene.getCurrentSimTimeMs(),
      simFileTime: scene.getCurrentFileTime(),
    },
    socket: { destroyed: false },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendServiceNotification() {},
    sendSessionChange() {},
  };

  entity.session = session;
  if (!scene.getEntityByID(entity.itemID)) {
    scene.spawnDynamicEntity(entity, { broadcast: false });
  }
  scene.sessions.set(clientID, session);
  return { session, notifications };
}

function flushDirectDestinyNotifications(scene) {
  if (scene && typeof scene.flushDirectDestinyNotificationBatch === "function") {
    scene.flushDirectDestinyNotificationBatch();
  }
}

function advanceScene(scene, deltaMs) {
  const baseWallclock = Number(scene.lastWallclockTickAt) || scene.getCurrentWallclockMs();
  scene.tick(baseWallclock + Math.max(0, Number(deltaMs) || 0));
}

function advanceSceneUntilSimTime(scene, targetSimTimeMs, extraMs = 0) {
  const desiredSimTimeMs =
    Math.max(0, Number(targetSimTimeMs) || 0) + Math.max(0, Number(extraMs) || 0);
  let previousSimTimeMs = scene.getCurrentSimTimeMs();
  let iterations = 0;
  while (scene.getCurrentSimTimeMs() < desiredSimTimeMs) {
    const remainingMs = Math.max(1, desiredSimTimeMs - scene.getCurrentSimTimeMs());
    advanceScene(scene, Math.max(remainingMs, 50));
    const currentSimTimeMs = scene.getCurrentSimTimeMs();
    assert.ok(currentSimTimeMs > previousSimTimeMs, "expected scene sim time to advance");
    previousSimTimeMs = currentSimTimeMs;
    iterations += 1;
    assert.ok(iterations <= 32, "expected scene to reach requested sim time promptly");
  }
}

function flattenDestinyUpdates(notifications = []) {
  const updates = [];
  for (const notification of notifications) {
    if (
      !notification ||
      notification.name !== "DoDestinyUpdate" ||
      !Array.isArray(notification.payload)
    ) {
      continue;
    }

    const payloadList = notification.payload[0];
    const items = Array.isArray(payloadList && payloadList.items)
      ? payloadList.items
      : [];
    for (const item of items) {
      const payload = Array.isArray(item) ? item[1] : null;
      if (!Array.isArray(payload) || typeof payload[0] !== "string") {
        continue;
      }
      updates.push({
        stamp: Number(Array.isArray(item) ? item[0] : 0) || 0,
        name: payload[0],
        args: Array.isArray(payload[1]) ? payload[1] : [],
      });
    }
  }
  return updates;
}

function getSpecialFxEvents(notifications = [], guid = null) {
  return flattenDestinyUpdates(notifications).filter((entry) => (
    entry.name === "OnSpecialFX" &&
    (guid === null || String(entry.args[5]) === String(guid))
  ));
}

function assertSpecialFxPayload(event, expected = {}) {
  assert.ok(event, "expected OnSpecialFX event");
  assert.equal(Number(event.args[1]), Number(expected.moduleID));
  assert.equal(Number(event.args[2]), Number(expected.moduleTypeID));
  assert.equal(event.args[3], expected.targetID ?? null);
  assert.equal(event.args[4], expected.chargeTypeID ?? null);
  assert.equal(String(event.args[5]), String(expected.guid));
  assert.equal(Number(event.args[6]), expected.isOffensive === true ? 1 : 0);
  assert.equal(Number(event.args[7]), expected.start === true ? 1 : 0);
  assert.equal(Number(event.args[8]), expected.active === true ? 1 : 0);
  assert.equal(Number(event.args[9]), Number(expected.duration));
}

function getSlimDictEntry(dict, key) {
  const entries = Array.isArray(dict && dict.entries) ? dict.entries : [];
  const match = entries.find((entry) => Array.isArray(entry) && entry[0] === key);
  return match ? match[1] : undefined;
}

function normalizeSlimValue(value) {
  if (value && typeof value === "object" && value.type === "object") {
    return value.args || null;
  }
  return value;
}

function getSlimItemForEntityFromUpdates(updates = [], entityID) {
  const numericEntityID = Number(entityID);
  for (let index = updates.length - 1; index >= 0; index -= 1) {
    const update = updates[index];
    if (!update) {
      continue;
    }
    if (
      update.name === "OnSlimItemChange" &&
      Number(update.args && update.args[0]) === numericEntityID
    ) {
      return normalizeSlimValue(update.args && update.args[1]);
    }
    if (update.name !== "AddBalls2" || !Array.isArray(update.args)) {
      continue;
    }
    for (const batchEntry of update.args) {
      const slimEntries = Array.isArray(batchEntry) ? batchEntry[1] : null;
      const normalizedSlimEntries = Array.isArray(slimEntries)
        ? slimEntries
        : slimEntries &&
            slimEntries.type === "list" &&
            Array.isArray(slimEntries.items)
          ? slimEntries.items
          : [];
      for (const slimEntry of normalizedSlimEntries) {
        const slimItem = normalizeSlimValue(Array.isArray(slimEntry) ? slimEntry[0] : slimEntry);
        const itemID = Number(getSlimDictEntry(slimItem, "itemID"));
        if (itemID === numericEntityID) {
          return slimItem;
        }
      }
    }
  }
  return null;
}

function getGodmaEffectNotifications(notifications = [], moduleID, active) {
  return notifications.filter((entry) => (
    entry &&
    entry.name === "OnGodmaShipEffect" &&
    Array.isArray(entry.payload) &&
    Number(entry.payload[0]) === Number(moduleID) &&
    Number(entry.payload[3]) === (active === true ? 1 : 0)
  ));
}

function joinSameFleet(leaderSession, memberSession) {
  const fleet = fleetRuntime.createFleetRecord(leaderSession);
  fleetRuntime.initFleet(leaderSession, fleet.fleetID);
  fleetRuntime.runtimeState.characterToFleet.set(memberSession.characterID, fleet.fleetID);
  return fleet;
}

test.afterEach(() => {
  spaceRuntime._testing.clearScenes();
  fleetRuntime.runtimeState.nextFleetSerial = 1;
  fleetRuntime.runtimeState.fleets.clear();
  fleetRuntime.runtimeState.characterToFleet.clear();
  fleetRuntime.runtimeState.invitesByCharacter.clear();
});

serialTest("industrial core activation emits SiegeMode start and stop FX to owner and observers", () => {
  const scene = spaceRuntime.ensureScene(39_990_091);
  const coreModule = buildFittedModule("Large Industrial Core II", 991100001, 991100000, 27);
  const orca = buildRuntimeShipEntity(
    scene,
    "Orca",
    991100000,
    9110001,
    { x: 0, y: 0, z: 0 },
    [coreModule],
  );
  orca.nativeNpc = true;
  orca.nativeCargoItems = [
    buildCargoItem("Heavy Water", 991100020, orca.itemID, 2_000),
  ];
  const observerShip = buildRuntimeShipEntity(
    scene,
    "Venture",
    991100010,
    9110002,
    { x: 3_000, y: 0, z: 0 },
    [],
  );
  const { session: ownerSession, notifications: ownerNotifications } = attachSession(
    scene,
    orca,
    9111001,
    9110001,
  );
  const { notifications: observerNotifications } = attachSession(
    scene,
    observerShip,
    9111002,
    9110002,
  );

  const activateResult = scene.activateGenericModule(
    ownerSession,
    coreModule,
    "industrialCompactCoreEffect2",
  );
  assert.equal(activateResult.success, true);
  const activeCoreEffect = orca.activeModuleEffects.get(coreModule.itemID);
  assert.ok(activeCoreEffect, "expected industrial core to become active");
  flushDirectDestinyNotifications(scene);

  const ownerStartFx = getSpecialFxEvents(ownerNotifications, "effects.SiegeMode").find(
    (entry) => Number(entry.args[7]) === 1 && Number(entry.args[8]) === 1,
  );
  const observerStartFx = getSpecialFxEvents(observerNotifications, "effects.SiegeMode").find(
    (entry) => Number(entry.args[7]) === 1 && Number(entry.args[8]) === 1,
  );
  assertSpecialFxPayload(ownerStartFx, {
    moduleID: coreModule.itemID,
    moduleTypeID: coreModule.typeID,
    guid: "effects.SiegeMode",
    isOffensive: false,
    start: true,
    active: true,
    duration: activeCoreEffect.durationMs,
  });
  assertSpecialFxPayload(observerStartFx, {
    moduleID: coreModule.itemID,
    moduleTypeID: coreModule.typeID,
    guid: "effects.SiegeMode",
    isOffensive: false,
    start: true,
    active: true,
    duration: activeCoreEffect.durationMs,
  });

  const deactivateResult = scene.deactivateGenericModule(ownerSession, coreModule.itemID, {
    deferUntilCycle: false,
  });
  assert.equal(deactivateResult.success, true);
  flushDirectDestinyNotifications(scene);

  const ownerStopFx = getSpecialFxEvents(ownerNotifications, "effects.SiegeMode").find(
    (entry) => Number(entry.args[7]) === 0 && Number(entry.args[8]) === 0,
  );
  const observerStopFx = getSpecialFxEvents(observerNotifications, "effects.SiegeMode").find(
    (entry) => Number(entry.args[7]) === 0 && Number(entry.args[8]) === 0,
  );
  assertSpecialFxPayload(ownerStopFx, {
    moduleID: coreModule.itemID,
    moduleTypeID: coreModule.typeID,
    guid: "effects.SiegeMode",
    isOffensive: false,
    start: false,
    active: false,
    duration: activeCoreEffect.durationMs,
  });
  assertSpecialFxPayload(observerStopFx, {
    moduleID: coreModule.itemID,
    moduleTypeID: coreModule.typeID,
    guid: "effects.SiegeMode",
    isOffensive: false,
    start: false,
    active: false,
    duration: activeCoreEffect.durationMs,
  });
});

serialTest("industrial core requires Heavy Water and consumes it each cycle until the fuel runs out", () => {
  const scene = spaceRuntime.ensureScene(39_990_095);
  const coreModule = buildFittedModule("Large Industrial Core II", 991500001, 991500000, 27);
  const orca = buildRuntimeShipEntity(
    scene,
    "Orca",
    991500000,
    9150001,
    { x: 0, y: 0, z: 0 },
    [coreModule],
  );
  orca.nativeNpc = true;
  const { session: ownerSession, notifications: ownerNotifications } = attachSession(
    scene,
    orca,
    9151001,
    9150001,
  );
  const shipItem = {
    itemID: orca.itemID,
    typeID: orca.typeID,
    ownerID: orca.characterID,
    locationID: scene.systemID,
    itemName: orca.itemName,
  };
  const runtimeAttrs = spaceRuntime.getGenericModuleRuntimeAttributes(
    ownerSession.characterID,
    shipItem,
    coreModule,
    null,
    null,
    {
      skillMap: getCharacterSkillMap(ownerSession.characterID),
      fittedItems: [coreModule],
    },
  );
  const expectedFuelPerActivation = Number(runtimeAttrs && runtimeAttrs.fuelPerActivation) || 0;
  assert.ok(expectedFuelPerActivation > 0, "expected industrial core to resolve a live Heavy Water cost");
  const fuelStack = buildCargoItem(
    "Heavy Water",
    991500020,
    orca.itemID,
    expectedFuelPerActivation * 2,
  );

  orca.nativeCargoItems = [];
  const rejectedActivation = scene.activateGenericModule(
    ownerSession,
    coreModule,
    "industrialCompactCoreEffect2",
  );
  assert.equal(rejectedActivation.success, false);
  assert.equal(rejectedActivation.errorMsg, "NO_FUEL");

  orca.nativeCargoItems = [fuelStack];
  const activationResult = scene.activateGenericModule(
    ownerSession,
    coreModule,
    "industrialCompactCoreEffect2",
  );
  assert.equal(activationResult.success, true);
  flushDirectDestinyNotifications(scene);

  const activeCoreEffect = orca.activeModuleEffects.get(coreModule.itemID);
  assert.ok(activeCoreEffect, "expected industrial core effect state");
  assert.equal(
    Number(orca.nativeCargoItems[0] && orca.nativeCargoItems[0].quantity),
    expectedFuelPerActivation,
    "expected activation to consume one cycle of Heavy Water",
  );

  advanceSceneUntilSimTime(scene, activeCoreEffect.nextCycleAtMs, 25);
  flushDirectDestinyNotifications(scene);
  const remainingFuelAfterSecondCycle = (Array.isArray(orca.nativeCargoItems)
    ? orca.nativeCargoItems
    : []
  ).reduce((sum, entry) => (
    sum + Number(entry && (entry.quantity ?? entry.stacksize) || 0)
  ), 0);
  assert.equal(
    remainingFuelAfterSecondCycle,
    0,
    "expected the next cycle to consume the remaining Heavy Water",
  );
  assert.ok(
    orca.activeModuleEffects.has(coreModule.itemID),
    "expected the industrial core to stay active while fuel existed for that cycle",
  );

  const secondCycleBoundaryMs = Number(orca.activeModuleEffects.get(coreModule.itemID).nextCycleAtMs);
  advanceSceneUntilSimTime(scene, secondCycleBoundaryMs, 25);
  flushDirectDestinyNotifications(scene);
  assert.equal(
    orca.activeModuleEffects.has(coreModule.itemID),
    false,
    "expected the industrial core to stop once the next cycle had no Heavy Water left",
  );
  assert.ok(
    getGodmaEffectNotifications(ownerNotifications, coreModule.itemID, false).length > 0,
    "expected fuel exhaustion to emit an inactive OnGodmaShipEffect",
  );
});

serialTest("industrial compression requires an active core and advertises the live facility through ship slim data", () => {
  const scene = spaceRuntime.ensureScene(39_990_092);
  const coreModule = buildFittedModule("Large Industrial Core II", 991200001, 991200000, 27);
  const compressorModule = buildFittedModule(
    "Large Asteroid Ore Compressor I",
    991200002,
    991200000,
    28,
  );
  const orca = buildRuntimeShipEntity(
    scene,
    "Orca",
    991200000,
    9120001,
    { x: 0, y: 0, z: 0 },
    [coreModule, compressorModule],
  );
  orca.nativeNpc = true;
  orca.nativeCargoItems = [
    buildCargoItem("Heavy Water", 991200020, orca.itemID, 2_000),
  ];
  const miner = buildRuntimeShipEntity(
    scene,
    "Venture",
    991200010,
    9120002,
    { x: 2_000, y: 0, z: 0 },
    [],
  );
  const { session: ownerSession, notifications: ownerNotifications } = attachSession(
    scene,
    orca,
    9121001,
    9120001,
  );
  const { session: minerSession, notifications: minerNotifications } = attachSession(
    scene,
    miner,
    9121002,
    9120002,
  );
  joinSameFleet(ownerSession, minerSession);

  const rejectedCompression = scene.activateGenericModule(
    ownerSession,
    compressorModule,
    "industrialItemCompression",
  );
  assert.equal(rejectedCompression.success, false);
  assert.equal(rejectedCompression.errorMsg, "ACTIVE_INDUSTRIAL_CORE_REQUIRED");

  const coreActivation = scene.activateGenericModule(
    ownerSession,
    coreModule,
    "industrialCompactCoreEffect2",
  );
  assert.equal(coreActivation.success, true);
  const compressionActivation = scene.activateGenericModule(
    ownerSession,
    compressorModule,
    "industrialItemCompression",
  );
  assert.equal(compressionActivation.success, true);
  flushDirectDestinyNotifications(scene);

  const activeCompressionTypelists =
    spaceRuntime.resolveCompressionFacilityTypelistsForEntity(orca);
  assert.deepEqual(
    activeCompressionTypelists,
    [[334, 250000]],
    "expected the active Orca compressor to advertise the asteroid ore typelist at client range",
  );
  assert.deepEqual(orca.compressionFacilityTypelists, activeCompressionTypelists);

  const minerUpdates = flattenDestinyUpdates(minerNotifications);
  const minerSlim = getSlimItemForEntityFromUpdates(minerUpdates, orca.itemID);
  assert.ok(minerSlim, "expected observer to receive the Orca slim update");
  assert.equal(Number(getSlimDictEntry(minerSlim, "charID")), 9120001);
  const facilityTypelists = getSlimDictEntry(
    minerSlim,
    "compression_facility_typelists",
  );
  assert.ok(facilityTypelists && facilityTypelists.type === "dict");
  assert.deepEqual(facilityTypelists.entries, [[334, 250000]]);

  const ownerCompressionFx = getSpecialFxEvents(ownerNotifications).filter(
    (entry) => Number(entry.args[1]) === compressorModule.itemID,
  );
  const observerCompressionFx = getSpecialFxEvents(minerNotifications).filter(
    (entry) => Number(entry.args[1]) === compressorModule.itemID,
  );
  assert.equal(ownerCompressionFx.length, 0, "expected no compressor OnSpecialFX because the dogma effect has no GUID");
  assert.equal(observerCompressionFx.length, 0, "expected no observer compressor OnSpecialFX because the dogma effect has no GUID");

  const contextResult = miningIndustry.resolveInSpaceCompressionContext(
    minerSession,
    orca.itemID,
  );
  assert.equal(contextResult.success, true);
  assert.deepEqual(contextResult.data.facilityTypelists, [[334, 250000]]);
  assert.equal(contextResult.data.maxRangeMeters, 250000);
});

serialTest("deactivating the industrial core also tears down dependent compression and removes the facility advertisement", () => {
  const scene = spaceRuntime.ensureScene(39_990_093);
  const coreModule = buildFittedModule("Large Industrial Core II", 991300001, 991300000, 27);
  const compressorModule = buildFittedModule(
    "Large Asteroid Ore Compressor I",
    991300002,
    991300000,
    28,
  );
  const orca = buildRuntimeShipEntity(
    scene,
    "Orca",
    991300000,
    9130001,
    { x: 0, y: 0, z: 0 },
    [coreModule, compressorModule],
  );
  orca.nativeNpc = true;
  orca.nativeCargoItems = [
    buildCargoItem("Heavy Water", 991300020, orca.itemID, 2_000),
  ];
  const miner = buildRuntimeShipEntity(
    scene,
    "Venture",
    991300010,
    9130002,
    { x: 2_000, y: 0, z: 0 },
    [],
  );
  const { session: ownerSession, notifications: ownerNotifications } = attachSession(
    scene,
    orca,
    9131001,
    9130001,
  );
  const { session: minerSession, notifications: minerNotifications } = attachSession(
    scene,
    miner,
    9131002,
    9130002,
  );
  joinSameFleet(ownerSession, minerSession);

  assert.equal(
    scene.activateGenericModule(ownerSession, coreModule, "industrialCompactCoreEffect2").success,
    true,
  );
  assert.equal(
    scene.activateGenericModule(ownerSession, compressorModule, "industrialItemCompression").success,
    true,
  );
  flushDirectDestinyNotifications(scene);

  const deactivateResult = scene.deactivateGenericModule(ownerSession, coreModule.itemID, {
    deferUntilCycle: false,
  });
  assert.equal(deactivateResult.success, true);
  flushDirectDestinyNotifications(scene);

  assert.equal(orca.activeModuleEffects.has(coreModule.itemID), false);
  assert.equal(orca.activeModuleEffects.has(compressorModule.itemID), false);
  assert.equal(orca.compressionFacilityTypelists, null);

  const compressorStopNotifications = getGodmaEffectNotifications(
    ownerNotifications,
    compressorModule.itemID,
    false,
  );
  assert.ok(
    compressorStopNotifications.length > 0,
    "expected dependent compressor shutdown to emit an inactive OnGodmaShipEffect",
  );

  const minerUpdates = flattenDestinyUpdates(minerNotifications);
  const latestMinerSlim = getSlimItemForEntityFromUpdates(minerUpdates, orca.itemID);
  assert.ok(latestMinerSlim, "expected observer to receive a follow-up Orca slim update");
  assert.equal(
    getSlimDictEntry(latestMinerSlim, "compression_facility_typelists"),
    undefined,
    "expected compression facility advertisement to be removed after the core stops",
  );

  const contextResult = miningIndustry.resolveInSpaceCompressionContext(
    minerSession,
    orca.itemID,
  );
  assert.equal(contextResult.success, false);
  assert.equal(contextResult.errorMsg, "FACILITY_NOT_ACTIVE");
});

serialTest("fresh acquire replays SiegeMode for an already-active industrial core ship", () => {
  const scene = spaceRuntime.ensureScene(39_990_094);
  const coreModule = buildFittedModule("Large Industrial Core II", 991400001, 991400000, 27);
  const orca = buildRuntimeShipEntity(
    scene,
    "Orca",
    991400000,
    9140001,
    { x: 0, y: 0, z: 0 },
    [coreModule],
  );
  orca.nativeNpc = true;
  orca.nativeCargoItems = [
    buildCargoItem("Heavy Water", 991400020, orca.itemID, 2_000),
  ];
  const { session: ownerSession } = attachSession(
    scene,
    orca,
    9141001,
    9140001,
  );
  assert.equal(
    scene.activateGenericModule(ownerSession, coreModule, "industrialCompactCoreEffect2").success,
    true,
  );
  flushDirectDestinyNotifications(scene);

  const observerShip = buildRuntimeShipEntity(
    scene,
    "Venture",
    991400010,
    9140002,
    { x: 1_500, y: 0, z: 0 },
    [],
  );
  const { session: observerSession, notifications: observerNotifications } = attachSession(
    scene,
    observerShip,
    9141002,
    9140002,
  );

  const acquireResult = scene.sendAddBallsToSession(observerSession, [orca], {
    freshAcquire: true,
    bypassTickPresentationBatch: true,
  });
  assert.equal(acquireResult.delivered, true);
  flushDirectDestinyNotifications(scene);

  const replayFx = getSpecialFxEvents(observerNotifications, "effects.SiegeMode").find(
    (entry) => Number(entry.args[7]) === 1 && Number(entry.args[8]) === 1,
  );
  const activeCoreEffect = orca.activeModuleEffects.get(coreModule.itemID);
  assertSpecialFxPayload(replayFx, {
    moduleID: coreModule.itemID,
    moduleTypeID: coreModule.typeID,
    guid: "effects.SiegeMode",
    isOffensive: false,
    start: true,
    active: true,
    duration: activeCoreEffect.durationMs,
  });
});
