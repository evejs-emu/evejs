const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");

const config = require(path.join(repoRoot, "server/src/config"));
const runtime = require(path.join(repoRoot, "server/src/space/runtime"));
const miningRuntime = require(path.join(
  repoRoot,
  "server/src/services/mining/miningRuntime",
));
const {
  applyMiningDelta,
  clearPersistedSystemState,
  getMineableState,
} = require(path.join(
  repoRoot,
  "server/src/services/mining/miningRuntimeState",
));
const {
  resolveItemByName,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemTypeRegistry",
));
const {
  getTypeEffectRecords,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));

function disableGeneratedMiningSites(t) {
  const originalIceEnabled = config.miningGeneratedIceSitesEnabled;
  const originalGasEnabled = config.miningGeneratedGasSitesEnabled;
  config.miningGeneratedIceSitesEnabled = false;
  config.miningGeneratedGasSitesEnabled = false;
  t.after(() => {
    config.miningGeneratedIceSitesEnabled = originalIceEnabled;
    config.miningGeneratedGasSitesEnabled = originalGasEnabled;
  });
}

function resetScene(systemID) {
  clearPersistedSystemState(systemID);
  runtime._testing.clearScenes();
}

function buildModuleItem(typeRecord, itemID, locationID, flagID = 11) {
  return {
    itemID,
    ownerID: 0,
    locationID,
    flagID,
    typeID: Number(typeRecord.typeID),
    groupID: Number(typeRecord.groupID || 0),
    categoryID: Number(typeRecord.categoryID || 0),
    itemName: String(typeRecord.name || ""),
    singleton: 1,
    quantity: 1,
    stacksize: 1,
    moduleState: {
      online: true,
    },
  };
}

function buildChargeItem(typeRecord, itemID, locationID, moduleID) {
  return {
    itemID,
    ownerID: 0,
    locationID,
    moduleID,
    typeID: Number(typeRecord.typeID),
    groupID: Number(typeRecord.groupID || 0),
    categoryID: Number(typeRecord.categoryID || 0),
    itemName: String(typeRecord.name || ""),
    singleton: 0,
    quantity: 1,
    stacksize: 1,
    volume: Number(typeRecord.volume || 0),
  };
}

function attachSessionToShip(scene, shipEntity, clientID) {
  const notifications = [];
  const session = {
    clientID,
    characterID: 0,
    _space: {
      systemID: scene.systemID,
      shipID: shipEntity.itemID,
      initialStateSent: true,
      visibleDynamicEntityIDs: new Set([shipEntity.itemID]),
      visibleBubbleScopedStaticEntityIDs: new Set(),
      timeDilation: scene.getTimeDilation(),
      simTimeMs: scene.getCurrentSimTimeMs(),
      simFileTime: scene.getCurrentFileTime(),
    },
    socket: { destroyed: false },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };
  shipEntity.session = session;
  scene.spawnDynamicEntity(shipEntity, { broadcast: false });
  scene.sessions.set(clientID, session);
  return {
    session,
    notifications,
  };
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
    const items =
      payloadList &&
      payloadList.type === "list" &&
      Array.isArray(payloadList.items)
        ? payloadList.items
        : [];
    for (const entry of items) {
      const payload = Array.isArray(entry) ? entry[1] : null;
      if (!Array.isArray(payload) || typeof payload[0] !== "string") {
        continue;
      }
      updates.push({
        stamp: Array.isArray(entry) ? entry[0] : 0,
        name: payload[0],
        args: Array.isArray(payload[1]) ? payload[1] : [],
      });
    }
  }
  return updates;
}

function flushDirectDestinyNotifications(scene) {
  if (scene && typeof scene.flushDirectDestinyNotificationBatch === "function") {
    scene.flushDirectDestinyNotificationBatch();
  }
}

function advanceScene(scene, deltaMs) {
  const baseWallclock = Math.max(
    Number(scene.lastWallclockTickAt) || 0,
    Number(scene.getCurrentWallclockMs()) || 0,
    Number(scene.getCurrentSimTimeMs()) || 0,
  );
  scene.tick(baseWallclock + Math.max(0, Number(deltaMs) || 0));
}

function getRemoveBallsEntityIDs(update) {
  if (!update || update.name !== "RemoveBalls" || !Array.isArray(update.args)) {
    return [];
  }
  const listArg = update.args[0];
  return listArg && listArg.type === "list" && Array.isArray(listArg.items)
    ? listArg.items.map((value) => Number(value))
    : [];
}

function getGodmaShipEffectNotifications(notifications, moduleID, activeValue = null) {
  return notifications.filter((notification) => (
    notification &&
    notification.name === "OnGodmaShipEffect" &&
    Array.isArray(notification.payload) &&
    Number(notification.payload[0]) === Number(moduleID) &&
    (
      activeValue === null ||
      Number(notification.payload[3]) === Number(activeValue)
    )
  ));
}

function getExpectedSpecialFxModuleID(shipEntity, moduleItem) {
  const categoryID = Number(shipEntity && shipEntity.categoryID) || 0;
  const slimCategoryID = Number(shipEntity && shipEntity.slimCategoryID) || categoryID;
  const usesNpcHardpointPresentation = Boolean(
    shipEntity &&
    (
      shipEntity.nativeNpc === true ||
      shipEntity.nativeNpcOccupied === true ||
      (categoryID > 0 && slimCategoryID > 0 && slimCategoryID !== categoryID)
    ),
  );
  return usesNpcHardpointPresentation
    ? Number(shipEntity.itemID)
    : Number(moduleItem && moduleItem.itemID);
}

function hasLostTargetNotification(notifications, targetID) {
  return notifications.some((notification) => (
    notification &&
    notification.name === "OnTarget" &&
    Array.isArray(notification.payload) &&
    notification.payload[0] === "lost" &&
    Number(notification.payload[1]) === Number(targetID)
  ));
}

function getSlimDictEntry(dict, key) {
  const entries = Array.isArray(dict && dict.entries) ? dict.entries : [];
  const match = entries.find((entry) => Array.isArray(entry) && entry[0] === key);
  return match ? match[1] : undefined;
}

function getAddBallsSlimEntries(update) {
  if (!update || update.name !== "AddBalls2" || !Array.isArray(update.args)) {
    return [];
  }
  const ballEntries = Array.isArray(update.args[0]) ? update.args[0] : [];
  const slimList = ballEntries[1];
  return slimList && slimList.type === "list" && Array.isArray(slimList.items)
    ? slimList.items.map((entry) => Array.isArray(entry) ? entry[0] : entry)
    : [];
}

function getAddBallsSlimItemIDs(update) {
  return getAddBallsSlimEntries(update)
    .map((slim) => Number(getSlimDictEntry(slim, "itemID")))
    .filter((itemID) => Number.isFinite(itemID) && itemID > 0);
}

function addMineableEntity(scene, itemTypeName, itemID, kind, position, resourceQuantity) {
  const lookup = resolveItemByName(itemTypeName);
  assert.ok(lookup && lookup.success && lookup.match, `expected type ${itemTypeName}`);
  const typeRecord = lookup.match;
  const entity = {
    kind,
    itemID,
    typeID: Number(typeRecord.typeID),
    groupID: Number(typeRecord.groupID || 0),
    categoryID: Number(typeRecord.categoryID || 0),
    ownerID: 1,
    itemName: String(typeRecord.name || itemTypeName),
    slimName: String(typeRecord.name || itemTypeName),
    position: { ...position },
    velocity: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    radius: 150,
    resourceQuantity,
    staticVisibilityScope: "bubble",
  };
  assert.equal(scene.addStaticEntity(entity), true, `expected ${itemTypeName} to be added`);
  return entity;
}

function getMiningEffect(typeRecord, effectName) {
  const effectRecord = getTypeEffectRecords(Number(typeRecord.typeID)).find(
    (entry) => String(entry && entry.name || "").trim().toLowerCase() === String(effectName || "").trim().toLowerCase(),
  );
  assert.ok(effectRecord, `expected ${typeRecord.name} to expose ${effectName}`);
  return effectRecord;
}

test("survey scan returns CCP tuple payloads for ore, ice, and gas sorted by distance", (t) => {
  disableGeneratedMiningSites(t);
  const systemID = 39_990_001;
  resetScene(systemID);
  t.after(() => resetScene(systemID));

  const scene = runtime.ensureScene(systemID);
  const shipEntity = runtime._testing.buildRuntimeShipEntityForTesting({
    itemID: 9800001001,
    typeID: 32880,
    position: { x: 0, y: 0, z: 0 },
  }, systemID);
  const { session } = attachSessionToShip(scene, shipEntity, 401);

  const oreEntity = addMineableEntity(
    scene,
    "Veldspar",
    510000001,
    "asteroid",
    { x: 10_000, y: 0, z: 0 },
    250,
  );
  const gasEntity = addMineableEntity(
    scene,
    "Fullerite-C50",
    520000001,
    "gasCloud",
    { x: 20_000, y: 0, z: 0 },
    500,
  );
  const iceEntity = addMineableEntity(
    scene,
    "Blue Ice",
    530000001,
    "iceChunk",
    { x: 30_000, y: 0, z: 0 },
    2,
  );
  clearPersistedSystemState(systemID);
  scene._miningRuntimeState = null;

  const scanResults = miningRuntime.buildScanResultsForSession(session);
  assert.deepEqual(scanResults, [
    [oreEntity.itemID, oreEntity.typeID, 250],
    [gasEntity.itemID, gasEntity.typeID, 500],
    [iceEntity.itemID, iceEntity.typeID, 2],
  ]);
});

test("moving into an asteroid belt bubble streams bubble-scoped asteroid balls to the client", () => {
  const systemID = 30000145;
  resetScene(systemID);

  const scene = runtime.ensureScene(systemID);
  const belt = scene.getEntityByID(40009258);
  assert.ok(belt, "expected New Caldari asteroid belt anchor");

  const shipEntity = runtime._testing.buildRuntimeShipEntityForTesting({
    itemID: 9800001501,
    typeID: 32880,
    position: {
      x: belt.position.x + 2_000_000,
      y: belt.position.y,
      z: belt.position.z + 2_000_000,
    },
  }, systemID);
  const { session, notifications } = attachSessionToShip(scene, shipEntity, 405);
  session._space.initialBallparkVisualsSent = true;
  session._space.initialBallparkClockSynced = true;
  notifications.length = 0;

  const teleportResult = scene.teleportDynamicEntityToPoint(
    shipEntity,
    {
      x: belt.position.x + 1_000,
      y: belt.position.y,
      z: belt.position.z + 1_000,
    },
    {
      direction: { x: 1, y: 0, z: 0 },
      refreshOwnerSession: false,
    },
  );
  assert.equal(teleportResult.success, true, "expected ship teleport into belt bubble to succeed");
  flushDirectDestinyNotifications(scene);

  const expectedAsteroidIDs = scene
    .getVisibleBubbleScopedStaticEntitiesForSession(session)
    .filter((entity) => entity.kind === "asteroid")
    .map((entity) => Number(entity.itemID));
  assert.ok(expectedAsteroidIDs.length > 0, "expected asteroid entities in the destination bubble");

  const addBallsAsteroidIDs = flattenDestinyUpdates(notifications)
    .flatMap((update) => getAddBallsSlimItemIDs(update));
  assert.ok(
    expectedAsteroidIDs.some((itemID) => addBallsAsteroidIDs.includes(itemID)),
    "expected entering the belt bubble to emit AddBalls2 for asteroid entities",
  );

  const asteroidYieldTypes = new Map(
    expectedAsteroidIDs.map((itemID) => {
      const state = getMineableState(scene, itemID);
      return [itemID, Number(state && state.yieldTypeID)];
    }),
  );
  const asteroidSlims = flattenDestinyUpdates(notifications)
    .flatMap((update) => getAddBallsSlimEntries(update))
    .filter((slim) => expectedAsteroidIDs.includes(Number(getSlimDictEntry(slim, "itemID"))));
  assert.ok(
    asteroidSlims.length > 0,
    "expected asteroid slim entries to be present in AddBalls2 payloads",
  );
  for (const slim of asteroidSlims) {
    const itemID = Number(getSlimDictEntry(slim, "itemID"));
    assert.equal(
      Number(getSlimDictEntry(slim, "typeID")),
      asteroidYieldTypes.get(itemID),
      "expected asteroid slim typeID to match the mineable ore type",
    );
  }
});

test("same-scene teleport into an asteroid belt bubble streams visibility without an owner SetState rebuild", () => {
  const systemID = 30000145;
  resetScene(systemID);

  const scene = runtime.ensureScene(systemID);
  const belt = scene.getEntityByID(40009258);
  assert.ok(belt, "expected New Caldari asteroid belt anchor");

  const shipEntity = runtime._testing.buildRuntimeShipEntityForTesting({
    itemID: 9800001503,
    typeID: 32880,
    position: {
      x: belt.position.x + 2_000_000,
      y: belt.position.y,
      z: belt.position.z + 2_000_000,
    },
  }, systemID);
  const { session, notifications } = attachSessionToShip(scene, shipEntity, 407);
  session._space.initialBallparkVisualsSent = true;
  session._space.initialBallparkClockSynced = true;
  notifications.length = 0;

  const teleportResult = scene.teleportDynamicEntityToPoint(
    shipEntity,
    {
      x: belt.position.x + 1_000,
      y: belt.position.y,
      z: belt.position.z + 1_000,
    },
    {
      direction: { x: 1, y: 0, z: 0 },
      refreshOwnerSession: true,
    },
  );
  assert.equal(
    teleportResult.success,
    true,
    "expected same-scene teleport into belt bubble to succeed",
  );
  flushDirectDestinyNotifications(scene);

  const flattened = flattenDestinyUpdates(notifications);
  const expectedAsteroidIDs = scene
    .getVisibleBubbleScopedStaticEntitiesForSession(session)
    .filter((entity) => entity.kind === "asteroid")
    .map((entity) => Number(entity.itemID));
  assert.ok(expectedAsteroidIDs.length > 0, "expected asteroid entities in the destination bubble");

  const addBallsAsteroidIDs = flattened
    .flatMap((update) => getAddBallsSlimItemIDs(update));
  assert.ok(
    expectedAsteroidIDs.some((itemID) => addBallsAsteroidIDs.includes(itemID)),
    "expected same-scene teleport to stream asteroid AddBalls2 into the owner session",
  );
  assert.equal(
    flattened.some((update) => update.name === "SetState"),
    false,
    "expected same-scene teleport visibility refresh not to rebuild the owner ballpark",
  );
  assert.ok(
    flattened.some((update) => (
      update.name === "SetBallPosition" &&
      Number(update.args[0]) === Number(shipEntity.itemID)
    )),
    "expected same-scene teleport to still emit authoritative owner position correction",
  );
});

test("pilot warp handoff preacquires destination belt asteroids before landing reconciliation", () => {
  const systemID = 30000145;
  resetScene(systemID);

  const scene = runtime.ensureScene(systemID);
  const belt = scene.getEntityByID(40009258);
  assert.ok(belt, "expected New Caldari asteroid belt anchor");

  const shipEntity = runtime._testing.buildRuntimeShipEntityForTesting({
    itemID: 9800001502,
    typeID: 32880,
    position: {
      x: belt.position.x + 1_000,
      y: belt.position.y,
      z: belt.position.z + 1_000,
    },
  }, systemID);
  const { session } = attachSessionToShip(scene, shipEntity, 406);
  session._space.initialBallparkVisualsSent = true;
  session._space.initialBallparkClockSynced = true;
  session._space.visibleBubbleScopedStaticEntityIDs = new Set();

  shipEntity.mode = "WARP";
  shipEntity.warpState = {
    targetPoint: { ...belt.position },
    rawDestination: { ...belt.position },
    startTimeMs: scene.getCurrentSimTimeMs() - 4_000,
  };
  scene.beginPilotWarpVisibilityHandoff(shipEntity, shipEntity.warpState);

  const sessionOnlyUpdates = [];
  scene.advancePilotWarpVisibilityHandoff(
    shipEntity,
    scene.getCurrentSimTimeMs(),
    sessionOnlyUpdates,
  );

  const expectedAsteroidIDs = scene
    .getBubbleScopedStaticEntitiesForPosition(belt.position, session)
    .filter((entity) => entity.kind === "asteroid")
    .map((entity) => Number(entity.itemID));
  assert.ok(expectedAsteroidIDs.length > 0, "expected belt bubble asteroids to exist");
  assert.ok(
    expectedAsteroidIDs.some((itemID) => session._space.visibleBubbleScopedStaticEntityIDs.has(itemID)),
    "expected warp handoff to stage destination bubble asteroid visibility",
  );

  const stagedAsteroidIDs = sessionOnlyUpdates
    .flatMap((entry) => Array.isArray(entry && entry.updates) ? entry.updates : [])
    .map((update) => ({
      name: Array.isArray(update && update.payload) ? update.payload[0] : null,
      args: Array.isArray(update && update.payload) ? update.payload[1] : [],
    }))
    .flatMap((update) => getAddBallsSlimItemIDs(update));
  assert.ok(
    expectedAsteroidIDs.some((itemID) => stagedAsteroidIDs.includes(itemID)),
    "expected warp handoff to stage AddBalls2 for destination belt asteroids",
  );
});

test("asteroid belt warp stop distance ignores the authored belt radius", () => {
  const stopDistance = runtime._testing.getWarpStopDistanceForTargetForTesting(
    { radius: 120 },
    {
      kind: "asteroidBelt",
      radius: 104_297,
    },
  );
  assert.ok(
    stopDistance < 10_000,
    `expected belt warp stop distance to stay close to the warp-in point, got ${stopDistance}`,
  );
});

test("gas cloud mining emits targeted FX and RemoveBalls when the cloud depletes", (t) => {
  disableGeneratedMiningSites(t);
  const systemID = 39_990_002;
  resetScene(systemID);
  t.after(() => resetScene(systemID));

  const gasHarvester = resolveItemByName("Gas Cloud Harvester II").match;
  const gasEffect = getMiningEffect(gasHarvester, "miningClouds");
  const scene = runtime.ensureScene(systemID);
  const shipEntity = runtime._testing.buildRuntimeShipEntityForTesting({
    itemID: 9800002001,
    typeID: 32880,
    nativeNpc: true,
    position: { x: 0, y: 0, z: 0 },
  }, systemID);
  shipEntity.nativeNpc = true;
  shipEntity.corporationID = 1000129;
  shipEntity.factionID = 500014;
  shipEntity.ownerID = 1000129;
  shipEntity.fittedItems = [
    buildModuleItem(gasHarvester, 9800002101, shipEntity.itemID, 11),
  ];
  shipEntity.nativeCargoItems = [];
  const { session, notifications } = attachSessionToShip(scene, shipEntity, 402);

  const gasCloud = addMineableEntity(
    scene,
    "Fullerite-C50",
    520000002,
    "gasCloud",
    { x: 500, y: 0, z: 0 },
    1,
  );
  clearPersistedSystemState(systemID);
  scene._miningRuntimeState = null;
  scene.finalizeTargetLock(shipEntity, gasCloud, {
    nowMs: scene.getCurrentSimTimeMs(),
  });

  const activationResult = scene.activateGenericModule(
    session,
    shipEntity.fittedItems[0],
    gasEffect.name,
    { targetID: gasCloud.itemID },
  );
  assert.equal(activationResult.success, true, "expected gas harvester activation to succeed");
  flushDirectDestinyNotifications(scene);

  const moduleID = shipEntity.fittedItems[0].itemID;
  const fxModuleID = getExpectedSpecialFxModuleID(shipEntity, shipEntity.fittedItems[0]);
  const startFx = flattenDestinyUpdates(notifications).find((update) => (
    update.name === "OnSpecialFX" &&
    String(update.args[5]) === "effects.CloudMining" &&
    Number(update.args[1]) === Number(fxModuleID) &&
    Number(update.args[3]) === Number(gasCloud.itemID) &&
    Number(update.args[7]) === 1 &&
    Number(update.args[8]) === 1
  ));
  assert.ok(startFx, "expected gas harvester start FX to match the client-targeted payload");

  const godmaStart = notifications.find((notification) => (
    notification &&
    notification.name === "OnGodmaShipEffect" &&
    Array.isArray(notification.payload) &&
    Number(notification.payload[0]) === Number(moduleID) &&
    Number(notification.payload[3]) === 1
  ));
  assert.ok(godmaStart, "expected gas harvester activation to emit OnGodmaShipEffect");

  const cycleBoundaryMs =
    scene.getCurrentSimTimeMs() +
    Number(activationResult.data.effectState.durationMs || 1000);
  const cycleResult = miningRuntime.executeMiningCycle(
    scene,
    shipEntity,
    activationResult.data.effectState,
    cycleBoundaryMs,
  );
  assert.equal(cycleResult.success, true, "expected gas harvester cycle to complete");
  assert.equal(cycleResult.data.depleted, true, "expected single-unit gas cloud to deplete");
  flushDirectDestinyNotifications(scene);

  const updates = flattenDestinyUpdates(notifications);
  const removeUpdate = updates.find((update) =>
    getRemoveBallsEntityIDs(update).includes(gasCloud.itemID),
  );
  assert.ok(removeUpdate, "expected depleted gas cloud to emit RemoveBalls");

  const stopFx = updates.find((update) => (
    update.name === "OnSpecialFX" &&
    String(update.args[5]) === "effects.CloudMining" &&
    Number(update.args[1]) === Number(fxModuleID) &&
    Number(update.args[3]) === Number(gasCloud.itemID) &&
    Number(update.args[7]) === 0 &&
    Number(update.args[8]) === 1
  ));
  assert.ok(stopFx, "expected gas harvester stop FX to preserve the target context");

  const godmaStop = notifications.find((notification) => (
    notification &&
    notification.name === "OnGodmaShipEffect" &&
    Array.isArray(notification.payload) &&
    Number(notification.payload[0]) === Number(moduleID) &&
    Number(notification.payload[3]) === 0
  ));
  assert.ok(godmaStop, "expected gas harvester stop to emit OnGodmaShipEffect");
});

test("depleted asteroids emit the TQ destruction effect before RemoveBalls", (t) => {
  disableGeneratedMiningSites(t);
  const systemID = 39_990_014;
  resetScene(systemID);
  t.after(() => resetScene(systemID));

  const scene = runtime.ensureScene(systemID);
  const shipEntity = runtime._testing.buildRuntimeShipEntityForTesting({
    itemID: 9800014001,
    typeID: 32880,
    position: { x: 0, y: 0, z: 0 },
  }, systemID);
  const { session, notifications } = attachSessionToShip(scene, shipEntity, 414);
  const asteroid = addMineableEntity(
    scene,
    "Veldspar",
    550000014,
    "asteroid",
    { x: 500, y: 0, z: 0 },
    1,
  );
  session._space.visibleBubbleScopedStaticEntityIDs.add(asteroid.itemID);
  clearPersistedSystemState(systemID);
  scene._miningRuntimeState = null;

  const state = getMineableState(scene, asteroid.itemID);
  assert.ok(state, "expected mineable state for asteroid");
  const depletionResult = applyMiningDelta(
    scene,
    asteroid,
    state.remainingQuantity,
    0,
    {
      broadcast: true,
      nowMs: scene.getCurrentSimTimeMs(),
    },
  );
  assert.equal(depletionResult.success, true, "expected depletion to succeed");
  flushDirectDestinyNotifications(scene);

  const updates = flattenDestinyUpdates(notifications);
  const terminalEffect = updates.find((update) => (
    update.name === "TerminalPlayDestructionEffect" &&
    Number(update.args[0]) === Number(asteroid.itemID)
  ));
  assert.ok(terminalEffect, "expected asteroid depletion to emit TerminalPlayDestructionEffect");
  assert.equal(Number(terminalEffect.args[1]), 2, "expected TQ asteroid dissolve effect id");
  assert.ok(
    updates.some((update) => getRemoveBallsEntityIDs(update).includes(asteroid.itemID)),
    "expected depleted asteroid to emit RemoveBalls",
  );
});

test("scene command-time distance projects active subwarp movement", (t) => {
  disableGeneratedMiningSites(t);
  const systemID = 39_990_015;
  resetScene(systemID);
  t.after(() => resetScene(systemID));

  const scene = runtime.ensureScene(systemID);
  const shipEntity = runtime._testing.buildRuntimeShipEntityForTesting({
    itemID: 9800015001,
    typeID: 32880,
    nativeNpc: true,
    position: { x: 15_000, y: 0, z: 0 },
  }, systemID);
  const asteroid = addMineableEntity(
    scene,
    "Veldspar",
    550000015,
    "asteroid",
    { x: 0, y: 0, z: 0 },
    500,
  );

  shipEntity.mode = "FOLLOW";
  shipEntity.targetEntityID = asteroid.itemID;
  shipEntity.followRange = 5_000;
  shipEntity.speedFraction = 1;
  shipEntity.direction = { x: -1, y: 0, z: 0 };
  shipEntity.velocity = { x: 0, y: 0, z: 0 };
  shipEntity.targetPoint = { ...asteroid.position };

  const initialDistance = Math.max(
    0,
    Math.abs(shipEntity.position.x - asteroid.position.x) -
      Number(shipEntity.radius || 0) -
      Number(asteroid.radius || 0),
  );
  const baseSimTimeMs = 1_000_000;
  scene.simTimeMs = baseSimTimeMs;
  scene.lastWallclockTickAt = baseSimTimeMs;
  scene.getCurrentWallclockMs = () => baseSimTimeMs + 30_000;

  const projectedDistance = scene.getCommandTimeEntitySurfaceDistance(
    shipEntity,
    asteroid,
  );
  assert.ok(
    projectedDistance < initialDistance,
    `expected command-time movement projection to reduce ${initialDistance}, got ${projectedDistance}`,
  );
});

test("mining activation uses command-time projected distance", (t) => {
  disableGeneratedMiningSites(t);
  const systemID = 39_990_016;
  resetScene(systemID);
  t.after(() => resetScene(systemID));

  const minerLookup = resolveItemByName("Miner II");
  assert.ok(minerLookup && minerLookup.success && minerLookup.match, "expected Miner II type");
  const miner = minerLookup.match;
  const shipEntity = runtime._testing.buildRuntimeShipEntityForTesting({
    itemID: 9800016001,
    typeID: 32880,
    nativeNpc: true,
    position: { x: 0, y: 0, z: 0 },
  }, systemID);
  shipEntity.nativeNpc = true;
  shipEntity.fittedItems = [
    buildModuleItem(miner, 9800016101, shipEntity.itemID, 11),
  ];
  const veldsparLookup = resolveItemByName("Veldspar");
  assert.ok(veldsparLookup && veldsparLookup.success && veldsparLookup.match, "expected Veldspar type");
  const veldspar = veldsparLookup.match;
  const asteroid = {
    itemID: 550000016,
    typeID: Number(veldspar.typeID),
    groupID: Number(veldspar.groupID || 0),
    categoryID: Number(veldspar.categoryID || 0),
    kind: "asteroid",
    position: { x: 50_000, y: 0, z: 0 },
    radius: 150,
  };
  let projectedAtMs = null;
  const scene = {
    systemID,
    _miningRuntimeState: {
      byEntityID: new Map([[
        asteroid.itemID,
        {
          entityID: asteroid.itemID,
          visualTypeID: asteroid.typeID,
          yieldTypeID: asteroid.typeID,
          yieldKind: "ore",
          unitVolume: Number(veldspar.volume || 0.1),
          originalQuantity: 500,
          remainingQuantity: 500,
          originalRadius: asteroid.radius,
          updatedAtMs: 1,
        },
      ]]),
    },
    getCurrentSimTimeMs: () => 1_000,
    getEntityByID: (entityID) => (
      Number(entityID) === Number(asteroid.itemID) ? asteroid : null
    ),
    getTargetsForEntity: () => [asteroid.itemID],
    getCommandTimeEntitySurfaceDistance: (_source, _target, nowMs) => {
      projectedAtMs = nowMs;
      return 11_999;
    },
  };

  const miningEffect = getMiningEffect(miner, "miningLaser");
  const activationResult = miningRuntime.resolveMiningActivation(
    scene,
    shipEntity,
    shipEntity.fittedItems[0],
    miningEffect,
    { targetID: asteroid.itemID },
  );
  assert.equal(
    activationResult.success,
    true,
    "expected projected command-time distance to satisfy mining range",
  );
  assert.equal(projectedAtMs, 1_000, "expected the current simulation timestamp");
});

test("manual mining deactivation stops immediately and grants partial-cycle yield", (t) => {
  disableGeneratedMiningSites(t);
  const systemID = 39_990_017;
  resetScene(systemID);
  t.after(() => resetScene(systemID));

  const minerType = resolveItemByName("Miner II").match;
  const miningEffect = getMiningEffect(minerType, "miningLaser");
  const scene = runtime.ensureScene(systemID);
  const shipEntity = runtime._testing.buildRuntimeShipEntityForTesting({
    itemID: 9800017001,
    typeID: 32880,
    nativeNpc: true,
    position: { x: 0, y: 0, z: 0 },
  }, systemID);
  shipEntity.nativeNpc = true;
  shipEntity.fittedItems = [
    buildModuleItem(minerType, 9800017101, shipEntity.itemID, 11),
  ];
  shipEntity.nativeCargoItems = [];
  const { session, notifications } = attachSessionToShip(scene, shipEntity, 417);

  const veldspar = addMineableEntity(
    scene,
    "Veldspar",
    550000017,
    "asteroid",
    { x: 500, y: 0, z: 0 },
    10_000,
  );
  clearPersistedSystemState(systemID);
  scene._miningRuntimeState = null;
  scene.finalizeTargetLock(shipEntity, veldspar, {
    nowMs: scene.getCurrentSimTimeMs(),
  });

  const activationResult = scene.activateGenericModule(
    session,
    shipEntity.fittedItems[0],
    miningEffect.name,
    { targetID: veldspar.itemID },
  );
  assert.equal(activationResult.success, true, "expected mining laser activation to succeed");
  flushDirectDestinyNotifications(scene);

  const effectState = activationResult.data.effectState;
  const durationMs = Number(effectState.durationMs);
  const stopAtMs = Number(effectState.startedAtMs) + Math.floor(durationMs / 2);
  scene.simTimeMs = stopAtMs;
  scene.lastWallclockTickAt = stopAtMs;
  const beforeStopNotificationIndex = notifications.length;

  const deactivationResult = scene.deactivateGenericModule(
    session,
    shipEntity.fittedItems[0].itemID,
    { reason: "manual" },
  );
  assert.equal(deactivationResult.success, true, "expected manual mining stop to succeed");
  assert.equal(
    Boolean(deactivationResult.data && deactivationResult.data.pending),
    false,
    "expected mining stop not to wait for the cycle boundary",
  );
  assert.ok(
    deactivationResult.data.partialMiningCycle.efficiency > 0.45 &&
      deactivationResult.data.partialMiningCycle.efficiency < 0.55,
    "expected partial yield to use the elapsed half-cycle",
  );
  assert.equal(
    deactivationResult.data.partialMiningCycle.result.success,
    true,
    "expected elapsed-cycle mining to grant ore",
  );
  assert.ok(
    deactivationResult.data.partialMiningCycle.result.data.transferredQuantity > 0,
    "expected a positive partial-cycle yield",
  );
  assert.ok(
    shipEntity.nativeCargoItems.some((entry) => Number(entry && entry.quantity) > 0),
    "expected partial-cycle ore in the mining ship cargo",
  );
  assert.equal(
    shipEntity.activeModuleEffects.has(shipEntity.fittedItems[0].itemID),
    false,
    "expected the mining module to become inactive immediately",
  );

  flushDirectDestinyNotifications(scene);
  const stopNotifications = notifications.slice(beforeStopNotificationIndex);
  const stopUpdates = flattenDestinyUpdates(stopNotifications);
  assert.ok(
    getGodmaShipEffectNotifications(
      stopNotifications,
      shipEntity.fittedItems[0].itemID,
      0,
    ).length > 0,
    "expected immediate inactive OnGodmaShipEffect",
  );
  assert.ok(
    stopNotifications.some((notification) => notification.name === "OnOreMined"),
    "expected the partial yield to emit OnOreMined",
  );
  assert.ok(
    stopUpdates.some((update) => (
      update.name === "OnSpecialFX" &&
      String(update.args[5]) === "effects.Laser" &&
      Number(update.args[3]) === Number(veldspar.itemID) &&
      Number(update.args[7]) === 0 &&
      Number(update.args[8]) === 1 &&
      Number(update.args[12]) > 0
    )),
    "expected the immediate stop FX to preserve mining timing context",
  );
});

test("manual partial-cycle mining stop stays successful when its yield depletes the target", (t) => {
  disableGeneratedMiningSites(t);
  const systemID = 39_990_018;
  resetScene(systemID);
  t.after(() => resetScene(systemID));

  const minerType = resolveItemByName("Miner II").match;
  const miningEffect = getMiningEffect(minerType, "miningLaser");
  const scene = runtime.ensureScene(systemID);
  const shipEntity = runtime._testing.buildRuntimeShipEntityForTesting({
    itemID: 9800018001,
    typeID: 32880,
    nativeNpc: true,
    position: { x: 0, y: 0, z: 0 },
  }, systemID);
  shipEntity.nativeNpc = true;
  shipEntity.fittedItems = [
    buildModuleItem(minerType, 9800018101, shipEntity.itemID, 11),
  ];
  shipEntity.nativeCargoItems = [];
  const { session } = attachSessionToShip(scene, shipEntity, 418);

  const veldspar = addMineableEntity(
    scene,
    "Veldspar",
    550000018,
    "asteroid",
    { x: 500, y: 0, z: 0 },
    1,
  );
  clearPersistedSystemState(systemID);
  scene._miningRuntimeState = null;
  scene.finalizeTargetLock(shipEntity, veldspar, {
    nowMs: scene.getCurrentSimTimeMs(),
  });

  const activationResult = scene.activateGenericModule(
    session,
    shipEntity.fittedItems[0],
    miningEffect.name,
    { targetID: veldspar.itemID },
  );
  assert.equal(activationResult.success, true);

  const effectState = activationResult.data.effectState;
  const stopAtMs =
    Number(effectState.startedAtMs) +
    Math.floor(Number(effectState.durationMs) / 2);
  scene.simTimeMs = stopAtMs;
  scene.lastWallclockTickAt = stopAtMs;

  const deactivationResult = scene.deactivateGenericModule(
    session,
    shipEntity.fittedItems[0].itemID,
    { reason: "manual" },
  );
  assert.equal(
    deactivationResult.success,
    true,
    "expected target-depletion cleanup not to turn a successful manual stop into MODULE_NOT_ACTIVE",
  );
  assert.equal(
    deactivationResult.data.partialMiningCycle.result.data.depleted,
    true,
    "expected the partial yield to deplete the one-unit asteroid",
  );
  assert.equal(scene.getEntityByID(veldspar.itemID), null);
  assert.equal(
    shipEntity.activeModuleEffects.has(shipEntity.fittedItems[0].itemID),
    false,
  );
});

test("mining cycle tick depletion stops the laser without reactivating it", (t) => {
  disableGeneratedMiningSites(t);
  const systemID = 39_990_005;
  resetScene(systemID);
  t.after(() => resetScene(systemID));

  const minerType = resolveItemByName("Miner II").match;
  const miningEffect = getMiningEffect(minerType, "miningLaser");
  const scene = runtime.ensureScene(systemID);
  const shipEntity = runtime._testing.buildRuntimeShipEntityForTesting({
    itemID: 9800005001,
    typeID: 32880,
    nativeNpc: true,
    position: { x: 0, y: 0, z: 0 },
  }, systemID);
  shipEntity.nativeNpc = true;
  shipEntity.fittedItems = [
    buildModuleItem(minerType, 9800005101, shipEntity.itemID, 11),
  ];
  shipEntity.nativeCargoItems = [];
  const { session, notifications } = attachSessionToShip(scene, shipEntity, 408);

  const veldspar = addMineableEntity(
    scene,
    "Veldspar",
    550000005,
    "asteroid",
    { x: 500, y: 0, z: 0 },
    1,
  );
  clearPersistedSystemState(systemID);
  scene._miningRuntimeState = null;
  scene.finalizeTargetLock(shipEntity, veldspar, {
    nowMs: scene.getCurrentSimTimeMs(),
  });

  const activationResult = scene.activateGenericModule(
    session,
    shipEntity.fittedItems[0],
    miningEffect.name,
    { targetID: veldspar.itemID },
  );
  assert.equal(activationResult.success, true, "expected mining laser activation to succeed");
  flushDirectDestinyNotifications(scene);

  const moduleID = shipEntity.fittedItems[0].itemID;
  const fxModuleID = getExpectedSpecialFxModuleID(shipEntity, shipEntity.fittedItems[0]);
  const afterActivationIndex = notifications.length;
  const cycleBoundaryMs = Number(activationResult.data.effectState.nextCycleAtMs);
  advanceScene(scene, cycleBoundaryMs - scene.getCurrentSimTimeMs() + 50);
  flushDirectDestinyNotifications(scene);

  const depletionNotifications = notifications.slice(afterActivationIndex);
  const depletionUpdates = flattenDestinyUpdates(depletionNotifications);
  assert.ok(
    shipEntity.nativeCargoItems.some((entry) => Number(entry && entry.quantity) > 0),
    "expected the final mining tick to deposit ore before depletion",
  );
  assert.ok(
    hasLostTargetNotification(depletionNotifications, veldspar.itemID),
    "expected depletion to notify the miner that the asteroid target was lost",
  );
  assert.ok(
    depletionUpdates.some((update) => getRemoveBallsEntityIDs(update).includes(veldspar.itemID)),
    "expected depleted asteroid to emit RemoveBalls",
  );
  assert.ok(
    depletionUpdates.some((update) => (
      update.name === "OnSpecialFX" &&
      String(update.args[5]) === "effects.Laser" &&
      Number(update.args[1]) === Number(fxModuleID) &&
      Number(update.args[3]) === Number(veldspar.itemID) &&
      Number(update.args[7]) === 0 &&
      Number(update.args[8]) === 1
    )),
    "expected depletion to emit mining laser stop FX",
  );
  assert.ok(
    getGodmaShipEffectNotifications(depletionNotifications, moduleID, 0).length > 0,
    "expected depletion to emit inactive OnGodmaShipEffect",
  );
  assert.equal(
    getGodmaShipEffectNotifications(depletionNotifications, moduleID, 1).length,
    0,
    "expected depletion tick not to re-emit active OnGodmaShipEffect",
  );
  assert.equal(
    shipEntity.activeModuleEffects.has(moduleID),
    false,
    "expected depleted target cleanup to remove the active mining effect",
  );
  assert.ok(
    Number(shipEntity.moduleReactivationLocks.get(moduleID)) >= cycleBoundaryMs,
    "expected module reactivation lock to be based on the depletion cycle boundary",
  );
});

test("another miner depleting the asteroid stops competing lasers", (t) => {
  disableGeneratedMiningSites(t);
  const systemID = 39_990_006;
  resetScene(systemID);
  t.after(() => resetScene(systemID));

  const minerType = resolveItemByName("Miner II").match;
  const miningEffect = getMiningEffect(minerType, "miningLaser");
  const scene = runtime.ensureScene(systemID);
  const shipA = runtime._testing.buildRuntimeShipEntityForTesting({
    itemID: 9800006001,
    typeID: 32880,
    nativeNpc: true,
    position: { x: 0, y: -100, z: 0 },
  }, systemID);
  const shipB = runtime._testing.buildRuntimeShipEntityForTesting({
    itemID: 9800006002,
    typeID: 32880,
    nativeNpc: true,
    position: { x: 0, y: 100, z: 0 },
  }, systemID);
  shipA.nativeNpc = true;
  shipB.nativeNpc = true;
  shipA.fittedItems = [buildModuleItem(minerType, 9800006101, shipA.itemID, 11)];
  shipB.fittedItems = [buildModuleItem(minerType, 9800006102, shipB.itemID, 11)];
  shipA.nativeCargoItems = [];
  shipB.nativeCargoItems = [];
  const { session: sessionA, notifications: notificationsA } = attachSessionToShip(scene, shipA, 409);
  const { session: sessionB, notifications: notificationsB } = attachSessionToShip(scene, shipB, 410);

  const veldspar = addMineableEntity(
    scene,
    "Veldspar",
    550000006,
    "asteroid",
    { x: 500, y: 0, z: 0 },
    1,
  );
  clearPersistedSystemState(systemID);
  scene._miningRuntimeState = null;
  for (const shipEntity of [shipA, shipB]) {
    scene.finalizeTargetLock(shipEntity, veldspar, {
      nowMs: scene.getCurrentSimTimeMs(),
    });
  }

  const activationA = scene.activateGenericModule(
    sessionA,
    shipA.fittedItems[0],
    miningEffect.name,
    { targetID: veldspar.itemID },
  );
  const activationB = scene.activateGenericModule(
    sessionB,
    shipB.fittedItems[0],
    miningEffect.name,
    { targetID: veldspar.itemID },
  );
  assert.equal(activationA.success, true, "expected first miner activation to succeed");
  assert.equal(activationB.success, true, "expected competing miner activation to succeed");
  flushDirectDestinyNotifications(scene);

  const afterActivationA = notificationsA.length;
  const afterActivationB = notificationsB.length;
  const moduleAID = shipA.fittedItems[0].itemID;
  const moduleBID = shipB.fittedItems[0].itemID;
  const fxModuleBID = getExpectedSpecialFxModuleID(shipB, shipB.fittedItems[0]);
  const cycleBoundaryMs = Number(activationA.data.effectState.nextCycleAtMs);
  advanceScene(scene, cycleBoundaryMs - scene.getCurrentSimTimeMs() + 50);
  flushDirectDestinyNotifications(scene);

  const depletionA = notificationsA.slice(afterActivationA);
  const depletionB = notificationsB.slice(afterActivationB);
  const updatesB = flattenDestinyUpdates(depletionB);
  assert.ok(
    shipA.nativeCargoItems.some((entry) => Number(entry && entry.quantity) > 0),
    "expected the depleting miner to receive the final ore",
  );
  assert.equal(
    shipB.nativeCargoItems.length,
    0,
    "expected the competing miner not to receive ore from a stale later cycle",
  );
  assert.ok(
    hasLostTargetNotification(depletionB, veldspar.itemID),
    "expected competing miner to receive target loss when another miner depletes the asteroid",
  );
  assert.ok(
    updatesB.some((update) => (
      update.name === "OnSpecialFX" &&
      String(update.args[5]) === "effects.Laser" &&
      Number(update.args[1]) === Number(fxModuleBID) &&
      Number(update.args[3]) === Number(veldspar.itemID) &&
      Number(update.args[7]) === 0 &&
      Number(update.args[8]) === 1
    )),
    "expected competing miner laser stop FX when another miner depletes the asteroid",
  );
  assert.ok(
    getGodmaShipEffectNotifications(depletionA, moduleAID, 0).length > 0,
    "expected depleting miner to receive inactive OnGodmaShipEffect",
  );
  assert.ok(
    getGodmaShipEffectNotifications(depletionB, moduleBID, 0).length > 0,
    "expected competing miner to receive inactive OnGodmaShipEffect",
  );
  assert.equal(
    getGodmaShipEffectNotifications(depletionB, moduleBID, 1).length,
    0,
    "expected competing miner not to receive active re-notification after external depletion",
  );
  assert.equal(shipA.activeModuleEffects.has(moduleAID), false);
  assert.equal(shipB.activeModuleEffects.has(moduleBID), false);
  assert.ok(Number(shipA.moduleReactivationLocks.get(moduleAID)) >= cycleBoundaryMs);
  assert.ok(Number(shipB.moduleReactivationLocks.get(moduleBID)) >= cycleBoundaryMs);
});

test("mining beam FX ignores repeat=1 so observer beams do not expire after one cycle", (t) => {
  disableGeneratedMiningSites(t);
  const systemID = 39_990_004;
  resetScene(systemID);
  t.after(() => resetScene(systemID));

  const stripMiner = resolveItemByName("Modulated Strip Miner II").match;
  const scene = runtime.ensureScene(systemID);
  const shipEntity = runtime._testing.buildRuntimeShipEntityForTesting({
    itemID: 9800004001,
    typeID: 22544,
    position: { x: 0, y: 0, z: 0 },
  }, systemID);
  shipEntity.fittedItems = [
    buildModuleItem(stripMiner, 9800004101, shipEntity.itemID, 11),
  ];
  shipEntity.nativeCargoItems = [];
  const { session, notifications } = attachSessionToShip(scene, shipEntity, 404);

  const veldspar = addMineableEntity(
    scene,
    "Veldspar",
    550000004,
    "asteroid",
    { x: 500, y: 0, z: 0 },
    500,
  );
  clearPersistedSystemState(systemID);
  scene._miningRuntimeState = null;
  scene.finalizeTargetLock(shipEntity, veldspar, {
    nowMs: scene.getCurrentSimTimeMs(),
  });

  const stripEffect = getMiningEffect(stripMiner, "miningLaser");
  const activationResult = scene.activateGenericModule(
    session,
    shipEntity.fittedItems[0],
    stripEffect.name,
    {
      targetID: veldspar.itemID,
      repeat: 1,
    },
  );
  assert.equal(activationResult.success, true, "expected strip miner activation to succeed");
  flushDirectDestinyNotifications(scene);

  const startFx = flattenDestinyUpdates(notifications).find((update) => (
    update.name === "OnSpecialFX" &&
    String(update.args[5]) === "effects.Laser" &&
    Number(update.args[1]) === Number(shipEntity.fittedItems[0].itemID) &&
    Number(update.args[3]) === Number(veldspar.itemID) &&
    Number(update.args[7]) === 1 &&
    Number(update.args[8]) === 1
  ));
  assert.ok(startFx, "expected strip miner activation to emit OnSpecialFX");
  assert.ok(
    Number(startFx.args[10]) > 1,
    "expected mining beam FX repeat to ignore the client repeat=1 override",
  );
});

test("mining modules reject incompatible targets and mismatched crystals", (t) => {
  disableGeneratedMiningSites(t);
  const systemID = 39_990_003;
  resetScene(systemID);
  t.after(() => resetScene(systemID));

  const stripMiner = resolveItemByName("Modulated Strip Miner II").match;
  const iceHarvester = resolveItemByName("Ice Harvester II").match;
  const gasHarvester = resolveItemByName("Gas Cloud Harvester II").match;
  const veldsparCrystal = resolveItemByName("Veldspar Mining Crystal II").match;
  const scene = runtime.ensureScene(systemID);
  const shipEntity = runtime._testing.buildRuntimeShipEntityForTesting({
    itemID: 9800003001,
    typeID: 22544,
    nativeNpc: true,
    position: { x: 0, y: 0, z: 0 },
  }, systemID);
  shipEntity.nativeNpc = true;
  shipEntity.fittedItems = [
    buildModuleItem(stripMiner, 9800003101, shipEntity.itemID, 11),
    buildModuleItem(iceHarvester, 9800003102, shipEntity.itemID, 12),
    buildModuleItem(gasHarvester, 9800003103, shipEntity.itemID, 13),
  ];
  shipEntity.nativeCargoItems = [
    buildChargeItem(
      veldsparCrystal,
      9800003201,
      shipEntity.itemID,
      shipEntity.fittedItems[0].itemID,
    ),
  ];
  const { session } = attachSessionToShip(scene, shipEntity, 403);
  void session;

  const gasCloud = addMineableEntity(
    scene,
    "Fullerite-C50",
    520000003,
    "gasCloud",
    { x: 1_500, y: 0, z: 0 },
    500,
  );
  const iceChunk = addMineableEntity(
    scene,
    "Blue Ice",
    530000003,
    "iceChunk",
    { x: 2_000, y: 0, z: 0 },
    10,
  );
  const scordite = addMineableEntity(
    scene,
    "Scordite",
    540000003,
    "asteroid",
    { x: 2_500, y: 0, z: 0 },
    500,
  );
  const veldspar = addMineableEntity(
    scene,
    "Veldspar",
    550000003,
    "asteroid",
    { x: 3_000, y: 0, z: 0 },
    500,
  );
  clearPersistedSystemState(systemID);
  scene._miningRuntimeState = null;
  for (const targetEntity of [gasCloud, iceChunk, scordite, veldspar]) {
    scene.finalizeTargetLock(shipEntity, targetEntity, {
      nowMs: scene.getCurrentSimTimeMs(),
    });
  }

  const stripEffect = getMiningEffect(stripMiner, "miningLaser");
  const iceEffect = getMiningEffect(iceHarvester, "miningLaser");
  const gasEffect = getMiningEffect(gasHarvester, "miningClouds");

  const stripToGas = miningRuntime.resolveMiningActivation(
    scene,
    shipEntity,
    shipEntity.fittedItems[0],
    stripEffect,
    { targetID: gasCloud.itemID },
  );
  assert.equal(stripToGas.success, false);
  assert.equal(stripToGas.errorMsg, "TARGET_INVALID_FOR_MODULE");

  const gasToIce = miningRuntime.resolveMiningActivation(
    scene,
    shipEntity,
    shipEntity.fittedItems[2],
    gasEffect,
    { targetID: iceChunk.itemID },
  );
  assert.equal(gasToIce.success, false);
  assert.equal(gasToIce.errorMsg, "TARGET_INVALID_FOR_MODULE");

  const iceToGas = miningRuntime.resolveMiningActivation(
    scene,
    shipEntity,
    shipEntity.fittedItems[1],
    iceEffect,
    { targetID: gasCloud.itemID },
  );
  assert.equal(iceToGas.success, false);
  assert.equal(iceToGas.errorMsg, "TARGET_INVALID_FOR_MODULE");

  const stripToScordite = miningRuntime.resolveMiningActivation(
    scene,
    shipEntity,
    shipEntity.fittedItems[0],
    stripEffect,
    { targetID: scordite.itemID },
  );
  assert.equal(stripToScordite.success, false);
  assert.equal(stripToScordite.errorMsg, "CHARGE_NOT_COMPATIBLE");

  const stripToVeldspar = miningRuntime.resolveMiningActivation(
    scene,
    shipEntity,
    shipEntity.fittedItems[0],
    stripEffect,
    { targetID: veldspar.itemID },
  );
  assert.equal(stripToVeldspar.success, true, "expected matching crystal and ore to activate");
});
