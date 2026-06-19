const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const destiny = require(path.join(repoRoot, "server/src/space/destiny"));
const npcService = require(path.join(repoRoot, "server/src/space/npc"));
const {
  resolveMissileAppliedDamage,
} = require(path.join(
  repoRoot,
  "server/src/space/combat/missiles/missileSolver",
));
const DogmaService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dogmaService",
));
const {
  createSpaceItemForCharacter,
  grantItemToCharacterLocation,
  removeInventoryItem,
  listContainerItems,
  ITEM_FLAGS,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  resolveItemByName,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemTypeRegistry",
));
const {
  buildChargeTupleItemID,
  getAttributeIDByNames,
  getLoadedChargeByFlag,
  getModuleChargeCapacity,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));

const ATTRIBUTE_QUANTITY = getAttributeIDByNames("quantity") || 805;

const DEFAULT_PASSIVE_STATE = Object.freeze({
  mass: 1_000_000,
  inertia: 0.5,
  agility: 0.5,
  maxVelocity: 300,
  maxTargetRange: 250_000,
  maxLockedTargets: 7,
  signatureRadius: 120,
  scanResolution: 500,
  cloakingTargetingDelay: 0,
  capacitorCapacity: 5_000,
  capacitorRechargeRate: 1_000,
  shieldCapacity: 1_000,
  shieldRechargeRate: 1_000,
  armorHP: 1_000,
  structureHP: 1_000,
});

const transientCleanups = [];
let nextTransientCharacterID = 998710000;

function resolveExactItem(name) {
  const result = resolveItemByName(name);
  assert.equal(result && result.success, true, `Expected item '${name}' to exist`);
  return result.match;
}

function registerCleanup(fn) {
  transientCleanups.push(fn);
}

function buildShipEntity(scene, itemID, x, options = {}) {
  return spaceRuntime._testing.buildRuntimeShipEntityForTesting({
    itemID,
    typeID: options.typeID ?? 606,
    ownerID: options.ownerID ?? 0,
    characterID: options.characterID ?? 0,
    pilotCharacterID: options.characterID ?? 0,
    position: options.position ?? { x, y: 0, z: 0 },
    passiveResourceState: {
      ...DEFAULT_PASSIVE_STATE,
      ...(options.passiveResourceState || {}),
    },
  }, scene.systemID);
}

function advanceScene(scene, deltaMs) {
  const baseWallclock = Number(scene.lastWallclockTickAt) || scene.getCurrentWallclockMs();
  scene.tick(baseWallclock + Math.max(0, Number(deltaMs) || 0));
}

function advanceSceneUntilSimTime(scene, targetSimTimeMs, extraMs = 0) {
  const desiredSimTimeMs = Math.max(0, Number(targetSimTimeMs) || 0) + Math.max(0, Number(extraMs) || 0);
  let previousSimTimeMs = scene.getCurrentSimTimeMs();
  let iterations = 0;
  while (scene.getCurrentSimTimeMs() < desiredSimTimeMs) {
    const remainingMs = Math.max(1, desiredSimTimeMs - scene.getCurrentSimTimeMs());
    advanceScene(scene, Math.max(remainingMs, 50));
    const currentSimTimeMs = scene.getCurrentSimTimeMs();
    assert.ok(currentSimTimeMs > previousSimTimeMs, "expected scene sim time to advance");
    previousSimTimeMs = currentSimTimeMs;
    iterations += 1;
    assert.ok(iterations <= 20, "expected scene to reach the requested sim time promptly");
  }
}

function getMissileEntities(scene) {
  return [...scene.dynamicEntities.values()].filter(
    (entity) => entity && entity.kind === "missile",
  );
}

function advanceSceneUntilNoMissiles(scene, options = {}) {
  const stepMs = Math.max(50, Number(options.stepMs) || 500);
  const maxIterations = Math.max(1, Number(options.maxIterations) || 40);
  for (let index = 0; index < maxIterations; index += 1) {
    if (getMissileEntities(scene).length <= 0) {
      return;
    }
    advanceScene(scene, stepMs);
  }
  assert.equal(getMissileEntities(scene).length, 0, "expected all missile entities to resolve");
}

function getMarshalDictEntry(value, key) {
  if (!value || value.type !== "dict" || !Array.isArray(value.entries)) {
    return undefined;
  }
  const entry = value.entries.find(
    (candidate) => Array.isArray(candidate) && candidate[0] === key,
  );
  return entry ? entry[1] : undefined;
}

function sumDamageVector(rawDamage) {
  const resolvedDamage =
    rawDamage && typeof rawDamage === "object"
      ? rawDamage
      : {};
  return (
    (Number(resolvedDamage.em) || 0) +
    (Number(resolvedDamage.thermal) || 0) +
    (Number(resolvedDamage.kinetic) || 0) +
    (Number(resolvedDamage.explosive) || 0)
  );
}

function readOnItemChangeItemID(notification) {
  const payload = notification && Array.isArray(notification.payload)
    ? notification.payload
    : null;
  const row = Array.isArray(payload) ? payload[0] : null;
  return row &&
    row.fields &&
    row.fields.itemID !== undefined
      ? row.fields.itemID
      : null;
}

function keyValEntries(value) {
  return (
    value &&
    value.name === "util.KeyVal" &&
    value.args &&
    value.args.type === "dict" &&
    Array.isArray(value.args.entries)
  )
    ? value.args.entries
    : [];
}

function dictEntries(value) {
  return value && value.type === "dict" && Array.isArray(value.entries)
    ? value.entries
    : [];
}

function readPrimeItemID(notification) {
  const primeEntry =
    notification &&
    Array.isArray(notification.payload)
      ? notification.payload[1]
      : null;
  const entry = keyValEntries(primeEntry).find(
    (candidate) => Array.isArray(candidate) && candidate[0] === "itemID",
  );
  return entry ? entry[1] : null;
}

function readPrimeAttributes(notification) {
  const primeEntry =
    notification &&
    Array.isArray(notification.payload)
      ? notification.payload[1]
      : null;
  const entry = keyValEntries(primeEntry).find(
    (candidate) => Array.isArray(candidate) && candidate[0] === "attributes",
  );
  return new Map(
    dictEntries(entry && entry[1]).map((candidate) => [
      Number(Array.isArray(candidate) ? candidate[0] : 0) || 0,
      Number(Array.isArray(candidate) ? candidate[1] : 0) || 0,
    ]),
  );
}

function extractModuleAttributeChanges(notifications) {
  return notifications
    .filter((entry) => entry && entry.name === "OnModuleAttributeChanges")
    .flatMap((entry) => {
      const payload = Array.isArray(entry.payload) ? entry.payload[0] : null;
      return payload && payload.type === "list" && Array.isArray(payload.items)
        ? payload.items
        : [];
    });
}

function sameItemID(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function findTupleQuantityChange(notifications, tupleItemID, nextValue) {
  return extractModuleAttributeChanges(notifications).find((change) => (
    Array.isArray(change) &&
    change[3] === ATTRIBUTE_QUANTITY &&
    sameItemID(change[2], tupleItemID) &&
    Number(change[5]) === Number(nextValue)
  )) || null;
}

function createTransientCharacter(systemID) {
  const characterID = nextTransientCharacterID;
  nextTransientCharacterID += 100;
  const characterRecord = {
    characterID,
    characterName: `missile-test-${characterID}`,
    corporationID: 0,
    allianceID: 0,
    warFactionID: 0,
    solarSystemID: systemID,
    solarsystemid: systemID,
    locationID: systemID,
    locationid: systemID,
    stationID: 0,
    stationid: 0,
  };
  const writeResult = database.write("characters", `/${characterID}`, characterRecord, {
    transient: true,
  });
  assert.equal(writeResult.success, true, "Failed to create transient character");
  registerCleanup(() => {
    database.remove("characters", `/${characterID}`);
  });
  return characterRecord;
}

function attachPlayerSession(scene, entity, characterRecord) {
  const notifications = [];
  const serviceNotifications = [];
  const session = {
    clientID: characterRecord.characterID + 5000,
    userid: characterRecord.characterID,
    characterID: characterRecord.characterID,
    charid: characterRecord.characterID,
    corporationID: characterRecord.corporationID || 0,
    allianceID: characterRecord.allianceID || 0,
    warFactionID: characterRecord.warFactionID || 0,
    shipID: entity.itemID,
    shipid: entity.itemID,
    activeShipID: entity.itemID,
    locationid: scene.systemID,
    solarsystemid: scene.systemID,
    solarsystemid2: scene.systemID,
    socket: { destroyed: false },
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
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendServiceNotification(serviceName, methodName, payload) {
      serviceNotifications.push({ serviceName, methodName, payload });
    },
  };

  entity.session = session;
  scene.spawnDynamicEntity(entity, { broadcast: false });
  scene.sessions.set(session.clientID, session);
  return {
    session,
    notifications,
    serviceNotifications,
  };
}

function createInventoryBackedLauncherScenario(options = {}) {
  const systemID = options.systemID ?? 30000142;
  const characterRecord = createTransientCharacter(systemID);
  const shipType = resolveExactItem(options.shipName ?? "Cerberus");
  const launcherType = resolveExactItem(options.launcherName ?? "Light Missile Launcher I");
  const loadedChargeType = resolveExactItem(options.loadedChargeName ?? "Scourge Light Missile");
  const cargoChargeType = resolveExactItem(options.cargoChargeName ?? options.loadedChargeName ?? "Scourge Light Missile");

  const shipCreateResult = createSpaceItemForCharacter(
    characterRecord.characterID,
    systemID,
    shipType,
    {
      transient: true,
      position: { x: -2_000, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      mode: "STOP",
      speedFraction: 0,
      conditionState: {
        shieldCharge: 1,
        armorDamage: 0,
        structureDamage: 0,
        charge: 1,
      },
    },
  );
  assert.equal(shipCreateResult.success, true, "Failed to create transient launcher ship");
  const shipItem = shipCreateResult.data;
  Object.assign(characterRecord, {
    accountID: characterRecord.characterID,
    accountId: characterRecord.characterID,
    shipID: shipItem.itemID,
    shipid: shipItem.itemID,
    activeShipID: shipItem.itemID,
  });
  database.write("characters", `/${characterRecord.characterID}`, characterRecord, {
    transient: true,
  });
  registerCleanup(() => {
    removeInventoryItem(shipItem.itemID, { removeContents: true });
  });

  const moduleGrantResult = grantItemToCharacterLocation(
    characterRecord.characterID,
    shipItem.itemID,
    27,
    launcherType,
    1,
    {
      transient: true,
      moduleState: {
        online: true,
        damage: 0,
        charge: 0,
        armorDamage: 0,
        shieldCharge: 0,
        incapacitated: false,
      },
    },
  );
  assert.equal(moduleGrantResult.success, true, "Failed to grant launcher module");
  const moduleItem = moduleGrantResult.data.items[0];

  const loadedGrantResult = grantItemToCharacterLocation(
    characterRecord.characterID,
    shipItem.itemID,
    moduleItem.flagID,
    loadedChargeType,
    options.loadedQuantity ?? 1,
    {
      transient: true,
      singleton: false,
    },
  );
  assert.equal(loadedGrantResult.success, true, "Failed to grant loaded missile charge");

  if ((options.cargoQuantity ?? 80) > 0) {
    const cargoGrantResult = grantItemToCharacterLocation(
      characterRecord.characterID,
      shipItem.itemID,
      ITEM_FLAGS.CARGO_HOLD,
      cargoChargeType,
      options.cargoQuantity ?? 80,
      {
        transient: true,
        singleton: false,
      },
    );
    assert.equal(cargoGrantResult.success, true, "Failed to grant missile cargo");
  }

  const scene = spaceRuntime.ensureScene(systemID);
  const attacker = buildShipEntity(scene, shipItem.itemID, -2_000, {
    typeID: shipItem.typeID,
    ownerID: characterRecord.characterID,
    characterID: characterRecord.characterID,
  });
  const attackerSession = attachPlayerSession(scene, attacker, characterRecord);
  const runtimeAttacker = scene.getEntityByID(shipItem.itemID);
  assert.ok(runtimeAttacker, "expected spawned runtime attacker entity");

  const target = buildShipEntity(scene, shipItem.itemID + 1000, options.targetX ?? 20_000, {
    passiveResourceState: {
      ...DEFAULT_PASSIVE_STATE,
      shieldCapacity: 400,
      armorHP: 400,
      structureHP: 400,
    },
  });
  scene.spawnDynamicEntity(target, { broadcast: false });
  const runtimeTarget = scene.getEntityByID(target.itemID);
  assert.ok(runtimeTarget, "expected spawned runtime target entity");

  const lockResult = scene.finalizeTargetLock(runtimeAttacker, runtimeTarget, {
    nowMs: scene.getCurrentSimTimeMs(),
  });
  assert.equal(lockResult.success, true, "Expected attacker to lock the target");

  return {
    scene,
    characterRecord,
    shipItem,
    attacker: runtimeAttacker,
    attackerSession,
    target: runtimeTarget,
    moduleItem,
    loadedChargeType,
    cargoChargeType,
  };
}

function fitAdditionalLauncherToScenario(scenario, options = {}) {
  const launcherType = resolveExactItem(options.launcherName ?? "Light Missile Launcher I");
  const loadedChargeType = resolveExactItem(options.loadedChargeName ?? "Scourge Light Missile");
  const flagID = options.flagID ?? 28;

  const moduleGrantResult = grantItemToCharacterLocation(
    scenario.characterRecord.characterID,
    scenario.shipItem.itemID,
    flagID,
    launcherType,
    1,
    {
      transient: true,
      moduleState: {
        online: true,
        damage: 0,
        charge: 0,
        armorDamage: 0,
        shieldCharge: 0,
        incapacitated: false,
      },
    },
  );
  assert.equal(moduleGrantResult.success, true, "Failed to grant grouped launcher module");
  const moduleItem = moduleGrantResult.data.items[0];

  const loadedGrantResult = grantItemToCharacterLocation(
    scenario.characterRecord.characterID,
    scenario.shipItem.itemID,
    moduleItem.flagID,
    loadedChargeType,
    options.loadedQuantity ?? 1,
    {
      transient: true,
      singleton: false,
    },
  );
  assert.equal(loadedGrantResult.success, true, "Failed to grant grouped launcher charge");
  return moduleItem;
}

test.afterEach(() => {
  npcService.clearNpcControllersInSystem(30000142, {
    entityType: "all",
  });
  spaceRuntime._testing.clearScenes();
  while (transientCleanups.length > 0) {
    const cleanup = transientCleanups.pop();
    try {
      cleanup();
    } catch (error) {
      assert.fail(`Cleanup failed: ${error.message}`);
    }
  }
  DogmaService._testing.clearPendingModuleReloads();
});

test("missile launchers can activate against native NPC ships spawned for missions", () => {
  const {
    scene,
    attacker,
    attackerSession,
    moduleItem,
  } = createInventoryBackedLauncherScenario({
    launcherName: "Light Missile Launcher I",
    loadedChargeName: "Scourge Light Missile",
    cargoChargeName: "Scourge Light Missile",
    loadedQuantity: 4,
    cargoQuantity: 0,
    targetX: 12_000,
  });

  const npcSpawnResult = npcService.spawnNpcBatchInSystem(scene.systemID, {
    amount: 1,
    profileQuery: "guristas_missile_battleship",
    defaultPoolID: "npc_missile_hostiles",
    fallbackProfileID: "guristas_missile_battleship",
    entityType: "npc",
    transient: true,
    broadcast: false,
    skipInitialBehaviorTick: true,
    position: { x: 0, y: 0, z: 0 },
    spawnStateOverride: {
      position: { x: 8_000, y: 2_000, z: 0 },
      direction: { x: -1, y: 0, z: 0 },
      mode: "STOP",
      speedFraction: 0,
    },
  });
  assert.equal(npcSpawnResult.success, true, "expected native NPC spawn to succeed");
  const nativeNpcEntity =
    npcSpawnResult.data &&
    Array.isArray(npcSpawnResult.data.spawned)
      ? npcSpawnResult.data.spawned[0].entity
      : null;
  assert.ok(nativeNpcEntity, "expected native NPC runtime entity");
  assert.equal(
    nativeNpcEntity.shieldCapacity > 0 ||
      nativeNpcEntity.armorHP > 0 ||
      nativeNpcEntity.structureHP > 0,
    true,
    "expected native NPCs to carry dogma health layers",
  );

  const lockResult = scene.finalizeTargetLock(attacker, nativeNpcEntity, {
    nowMs: scene.getCurrentSimTimeMs(),
  });
  assert.equal(lockResult.success, true, "expected attacker to lock native NPC target");

  const activationResult = scene.activateGenericModule(
    attackerSession.session,
    moduleItem,
    "useMissiles",
    {
      targetID: nativeNpcEntity.itemID,
      repeat: 1000,
    },
  );
  assert.equal(activationResult.success, true);
  assert.equal(
    getMissileEntities(scene).some((entity) => (
      Number(entity.sourceShipID) === Number(attacker.itemID) &&
      Number(entity.targetEntityID) === Number(nativeNpcEntity.itemID)
    )),
    true,
    "expected player missile launch against native NPC target",
  );
});

test("standard missile launchers auto-reload on depletion and resume fire after reload", () => {
  const {
    scene,
    characterRecord,
    shipItem,
    attacker,
    attackerSession,
    moduleItem,
    target,
  } = createInventoryBackedLauncherScenario({
    launcherName: "Light Missile Launcher I",
    loadedChargeName: "Scourge Light Missile",
    cargoChargeName: "Scourge Light Missile",
    loadedQuantity: 1,
    cargoQuantity: 80,
    targetX: 8_000,
  });

  const activationResult = scene.activateGenericModule(
    attackerSession.session,
    moduleItem,
    null,
    {
      targetID: target.itemID,
      repeat: 1000,
    },
  );
  assert.equal(activationResult.success, true);
  assert.equal(getMissileEntities(scene).length, 1, "expected first missile launch");
  assert.ok(
    attacker.activeModuleEffects.has(moduleItem.itemID),
    "expected launcher to remain active while reloading",
  );

  const activeEffect = attacker.activeModuleEffects.get(moduleItem.itemID);
  assert.ok(activeEffect && activeEffect.pendingMissileReload, "expected queued missile reload");
  const reloadCompleteAtMs = Number(activeEffect.pendingMissileReload.completeAtMs || 0);
  assert.ok(reloadCompleteAtMs > scene.getCurrentSimTimeMs(), "expected reload to complete in the future");

  advanceSceneUntilNoMissiles(scene);
  assert.equal(getMissileEntities(scene).length, 0, "expected first missile to have impacted");

  const remainingReloadMs = Math.max(0, reloadCompleteAtMs - scene.getCurrentSimTimeMs());
  const beforeReloadAdvanceMs = Math.max(0, remainingReloadMs - 50);
  if (beforeReloadAdvanceMs > 0) {
    advanceScene(scene, beforeReloadAdvanceMs);
  }
  assert.equal(getMissileEntities(scene).length, 0, "expected no second launch before reload completes");
  assert.ok(
    attacker.activeModuleEffects.has(moduleItem.itemID),
    "expected module to stay active through reload countdown",
  );

  advanceSceneUntilSimTime(scene, reloadCompleteAtMs, 25);
  assert.equal(getMissileEntities(scene).length, 1, "expected second missile launch after reload");
  const reloadedCharge = getLoadedChargeByFlag(
    characterRecord.characterID,
    shipItem.itemID,
    moduleItem.flagID,
  );
  assert.ok(reloadedCharge, "expected launcher to be reloaded");
  assert.equal(
    Number(reloadedCharge.stacksize || reloadedCharge.quantity || 0),
    getModuleChargeCapacity(moduleItem.typeID, reloadedCharge.typeID) - 1,
    "expected reload to refill the launcher before the next volley consumes one charge",
  );
});

test("rapid light missile launchers respect the long reload before firing again", () => {
  const {
    scene,
    characterRecord,
    shipItem,
    attacker,
    attackerSession,
    moduleItem,
    target,
  } = createInventoryBackedLauncherScenario({
    launcherName: "Rapid Light Missile Launcher I",
    loadedChargeName: "Scourge Light Missile",
    cargoChargeName: "Scourge Light Missile",
    loadedQuantity: 1,
    cargoQuantity: 80,
    targetX: 8_000,
  });

  const activationResult = scene.activateGenericModule(
    attackerSession.session,
    moduleItem,
    null,
    {
      targetID: target.itemID,
      repeat: 1000,
    },
  );
  assert.equal(activationResult.success, true);
  assert.equal(getMissileEntities(scene).length, 1, "expected first rapid-light volley");
  const activeEffect = attacker.activeModuleEffects.get(moduleItem.itemID);
  assert.ok(activeEffect && activeEffect.pendingMissileReload, "expected queued rapid-light reload");
  const reloadCompleteAtMs = Number(activeEffect.pendingMissileReload.completeAtMs || 0);
  assert.ok(reloadCompleteAtMs > scene.getCurrentSimTimeMs(), "expected rapid-light reload to complete in the future");

  advanceSceneUntilNoMissiles(scene);
  assert.equal(getMissileEntities(scene).length, 0, "expected first rapid-light missile to impact");

  const remainingReloadMs = Math.max(0, reloadCompleteAtMs - scene.getCurrentSimTimeMs());
  const beforeReloadAdvanceMs = Math.max(0, remainingReloadMs - 50);
  if (beforeReloadAdvanceMs > 0) {
    advanceScene(scene, beforeReloadAdvanceMs);
  }
  assert.equal(
    getMissileEntities(scene).length,
    0,
    "expected no follow-up launch before the 35s rapid-light reload ends",
  );
  assert.ok(
    attacker.activeModuleEffects.has(moduleItem.itemID),
    "expected rapid-light launcher to remain active during long reload",
  );

  advanceSceneUntilSimTime(scene, reloadCompleteAtMs, 25);
  assert.equal(getMissileEntities(scene).length, 1, "expected rapid-light launcher to fire after reload");
  const reloadedCharge = getLoadedChargeByFlag(
    characterRecord.characterID,
    shipItem.itemID,
    moduleItem.flagID,
  );
  assert.ok(reloadedCharge, "expected rapid-light launcher to be reloaded");
  assert.equal(
    Number(reloadedCharge.stacksize || reloadedCharge.quantity || 0),
    getModuleChargeCapacity(moduleItem.typeID, reloadedCharge.typeID) - 1,
  );
});

test("grouped missile launchers apply banked volley damage and consume one charge per launcher", () => {
  const baseline = createInventoryBackedLauncherScenario({
    systemID: 30000142,
    launcherName: "Light Missile Launcher I",
    loadedChargeName: "Scourge Light Missile",
    cargoChargeName: "Scourge Light Missile",
    loadedQuantity: 1,
    cargoQuantity: 0,
    targetX: 8_000,
  });

  const baselineActivationResult = baseline.scene.activateGenericModule(
    baseline.attackerSession.session,
    baseline.moduleItem,
    null,
    {
      targetID: baseline.target.itemID,
    },
  );
  assert.equal(baselineActivationResult.success, true);
  const baselineMissiles = getMissileEntities(baseline.scene);
  assert.equal(baselineMissiles.length, 1, "expected one baseline missile entity");
  const baselineDamage = sumDamageVector(
    resolveMissileAppliedDamage(
      baselineMissiles[0].missileSnapshot,
      baseline.target,
    ).appliedDamage,
  );
  assert.ok(baselineDamage > 0, "expected baseline missile damage to land");

  spaceRuntime._testing.clearScenes();

  const grouped = createInventoryBackedLauncherScenario({
    systemID: 30000144,
    launcherName: "Light Missile Launcher I",
    loadedChargeName: "Scourge Light Missile",
    cargoChargeName: "Scourge Light Missile",
    loadedQuantity: 1,
    cargoQuantity: 0,
    targetX: 8_000,
  });
  const groupedSlaveModule = fitAdditionalLauncherToScenario(grouped, {
    launcherName: "Light Missile Launcher I",
    loadedChargeName: "Scourge Light Missile",
    loadedQuantity: 1,
    flagID: 28,
  });
  const dogma = new DogmaService();
  const bankInfo = dogma.Handle_LinkWeapons(
    [grouped.shipItem.itemID, grouped.moduleItem.itemID, groupedSlaveModule.itemID],
    grouped.attackerSession.session,
  );
  assert.ok(bankInfo, "expected grouped launcher bank creation to succeed");

  const groupedActivationResult = dogma.Handle_Activate(
    [groupedSlaveModule.itemID, "", grouped.target.itemID, null],
    grouped.attackerSession.session,
  );
  assert.equal(groupedActivationResult, 1, "expected grouped DogmaIM activation to succeed");

  const launchedMissiles = getMissileEntities(grouped.scene);
  assert.equal(launchedMissiles.length, 1, "expected a single banked missile entity");
  const missileSlim = destiny.buildSlimItemDict(launchedMissiles[0]);
  const launchModules = getMarshalDictEntry(missileSlim, "launchModules");
  assert.deepEqual(
    Array.isArray(launchModules && launchModules.items) ? launchModules.items : [],
    [grouped.moduleItem.itemID, groupedSlaveModule.itemID],
    "expected the banked missile payload to carry both launcher module IDs",
  );
  assert.equal(
    Boolean(launchedMissiles[0].missileSnapshot && launchedMissiles[0].missileSnapshot.isBanked),
    true,
    "expected the grouped missile snapshot to stay marked as banked for the impact damage path",
  );

  const groupedDamage = sumDamageVector(
    resolveMissileAppliedDamage(
      launchedMissiles[0].missileSnapshot,
      grouped.target,
    ).appliedDamage,
  );
  assert.ok(
    groupedDamage >= baselineDamage * 1.95,
    `expected grouped launcher volley damage to scale with the bank (${groupedDamage} vs ${baselineDamage})`,
  );
  assert.ok(
    groupedDamage <= baselineDamage * 2.05,
    `expected grouped launcher volley damage to stay close to a 2x bank multiplier (${groupedDamage} vs ${baselineDamage})`,
  );

  advanceSceneUntilNoMissiles(grouped.scene);

  assert.equal(
    getLoadedChargeByFlag(
      grouped.characterRecord.characterID,
      grouped.shipItem.itemID,
      grouped.moduleItem.flagID,
    ),
    null,
    "expected the grouped master launcher to consume its loaded charge",
  );
  assert.equal(
    getLoadedChargeByFlag(
      grouped.characterRecord.characterID,
      grouped.shipItem.itemID,
      groupedSlaveModule.flagID,
    ),
    null,
    "expected the grouped slave launcher to consume its loaded charge",
  );

});

test("in-space weapon-bank mutations do not emit real loaded charge inventory rows", () => {
  const scenario = createInventoryBackedLauncherScenario({
    shipName: "Raven Navy Issue",
    launcherName: "Torpedo Launcher II",
    loadedChargeName: "Inferno Rage Torpedo",
    cargoChargeName: "Inferno Rage Torpedo",
    loadedQuantity: 40,
    cargoQuantity: 650,
    targetX: 15_000,
  });
  const groupedSlaveModule = fitAdditionalLauncherToScenario(scenario, {
    launcherName: "Torpedo Launcher II",
    loadedChargeName: "Inferno Rage Torpedo",
    loadedQuantity: 40,
    flagID: 28,
  });
  const dogma = new DogmaService();
  const session = scenario.attackerSession.session;

  const masterCharge = getLoadedChargeByFlag(
    scenario.characterRecord.characterID,
    scenario.shipItem.itemID,
    scenario.moduleItem.flagID,
  );
  const slaveCharge = getLoadedChargeByFlag(
    scenario.characterRecord.characterID,
    scenario.shipItem.itemID,
    groupedSlaveModule.flagID,
  );
  assert.ok(masterCharge, "expected the grouped master launcher to start with a loaded charge");
  assert.ok(slaveCharge, "expected the grouped slave launcher to start with a loaded charge");

  scenario.attackerSession.notifications.length = 0;
  dogma.Handle_LinkWeapons(
    [scenario.shipItem.itemID, scenario.moduleItem.itemID, groupedSlaveModule.itemID],
    session,
  );

  const linkedChargeItemIDs = scenario.attackerSession.notifications
    .filter((entry) => entry.name === "OnItemChange")
    .map(readOnItemChangeItemID);
  assert.equal(
    linkedChargeItemIDs.includes(masterCharge.itemID),
    false,
    "expected linking a launcher bank to avoid emitting the master real charge row",
  );
  assert.equal(
    linkedChargeItemIDs.includes(slaveCharge.itemID),
    false,
    "expected linking a launcher bank to avoid emitting the slave real charge row",
  );

  scenario.attackerSession.notifications.length = 0;
  const peeledModuleID = dogma.Handle_UnlinkModule(
    [scenario.shipItem.itemID, scenario.moduleItem.itemID],
    session,
  );
  assert.equal(
    Number(peeledModuleID),
    groupedSlaveModule.itemID,
    "expected unlinking to peel the grouped slave launcher back out of the bank",
  );

  const unlinkedChargeItemIDs = scenario.attackerSession.notifications
    .filter((entry) => entry.name === "OnItemChange")
    .map(readOnItemChangeItemID);
  assert.equal(
    unlinkedChargeItemIDs.includes(masterCharge.itemID),
    false,
    "expected unlinking a launcher bank to avoid emitting the master real charge row",
  );
  assert.equal(
    unlinkedChargeItemIDs.includes(slaveCharge.itemID),
    false,
    "expected unlinking a launcher bank to avoid emitting the peeled real charge row",
  );
});

test("manual missile reload tops off the current ammo type through the queued in-space reload path", () => {
  const {
    scene,
    characterRecord,
    shipItem,
    attackerSession,
    moduleItem,
    loadedChargeType,
  } = createInventoryBackedLauncherScenario({
    launcherName: "Light Missile Launcher I",
    loadedChargeName: "Scourge Light Missile",
    cargoChargeName: "Scourge Light Missile",
    loadedQuantity: 5,
    cargoQuantity: 50,
  });

  const dogma = new DogmaService();
  dogma.Handle_LoadAmmo(
    [
      shipItem.itemID,
      [moduleItem.itemID],
      [{ typeID: loadedChargeType.typeID }],
      shipItem.itemID,
    ],
    attackerSession.session,
  );

  assert.ok(
    DogmaService._testing.getPendingModuleReloads().has(moduleItem.itemID),
    "expected LoadAmmo to queue a timed reload for in-space missile topoff",
  );
  const queuedReload = DogmaService._testing.getPendingModuleReloads().get(moduleItem.itemID);
  const reloadCompleteAtMs = Number(queuedReload && queuedReload.completeAtMs || 0);
  assert.ok(reloadCompleteAtMs > scene.getCurrentSimTimeMs(), "expected queued topoff reload to complete in the future");

  advanceSceneUntilSimTime(scene, reloadCompleteAtMs, 25);
  const loadedCharge = getLoadedChargeByFlag(
    characterRecord.characterID,
    shipItem.itemID,
    moduleItem.flagID,
  );
  assert.ok(loadedCharge, "expected loaded missile stack after topoff");
  assert.equal(
    Number(loadedCharge.stacksize || loadedCharge.quantity || 0),
    getModuleChargeCapacity(moduleItem.typeID, loadedCharge.typeID),
    "expected same-ammo reload to top the launcher off to full capacity",
  );
});

test("manual missile reload swaps ammo types and returns the old clip to cargo", () => {
  const {
    scene,
    characterRecord,
    shipItem,
    attackerSession,
    moduleItem,
  } = createInventoryBackedLauncherScenario({
    launcherName: "Light Missile Launcher I",
    loadedChargeName: "Scourge Light Missile",
    cargoChargeName: "Inferno Light Missile",
    loadedQuantity: 5,
    cargoQuantity: 60,
  });
  const infernoLight = resolveExactItem("Inferno Light Missile");

  const dogma = new DogmaService();
  dogma.Handle_LoadAmmo(
    [
      shipItem.itemID,
      [moduleItem.itemID],
      [{ typeID: infernoLight.typeID }],
      shipItem.itemID,
    ],
    attackerSession.session,
  );

  const queuedReload = DogmaService._testing.getPendingModuleReloads().get(moduleItem.itemID);
  const reloadCompleteAtMs = Number(queuedReload && queuedReload.completeAtMs || 0);
  assert.ok(reloadCompleteAtMs > scene.getCurrentSimTimeMs(), "expected queued ammo-swap reload to complete in the future");

  advanceSceneUntilSimTime(scene, reloadCompleteAtMs, 25);
  const loadedCharge = getLoadedChargeByFlag(
    characterRecord.characterID,
    shipItem.itemID,
    moduleItem.flagID,
  );
  assert.ok(loadedCharge, "expected loaded missile stack after ammo swap");
  assert.equal(loadedCharge.typeID, infernoLight.typeID);
  assert.equal(
    Number(loadedCharge.stacksize || loadedCharge.quantity || 0),
    getModuleChargeCapacity(moduleItem.typeID, infernoLight.typeID),
  );

  const cargoItems = listContainerItems(
    characterRecord.characterID,
    shipItem.itemID,
    ITEM_FLAGS.CARGO_HOLD,
  );
  const returnedScourge = cargoItems
    .filter((item) => item.typeID === resolveExactItem("Scourge Light Missile").typeID)
    .reduce((sum, item) => sum + (Number(item.stacksize || item.quantity || 0) || 0), 0);
  const remainingInferno = cargoItems
    .filter((item) => item.typeID === infernoLight.typeID)
    .reduce((sum, item) => sum + (Number(item.stacksize || item.quantity || 0) || 0), 0);

  assert.equal(returnedScourge, 5, "expected the old missile clip to be moved back to cargo");
  assert.equal(
    remainingInferno,
    60 - getModuleChargeCapacity(moduleItem.typeID, infernoLight.typeID),
    "expected the new ammo stack to be consumed from cargo by the reload",
  );
});

test("login-profile reload completion primes the next tuple before publishing quantity", () => {
  const {
    scene,
    shipItem,
    attackerSession,
    moduleItem,
  } = createInventoryBackedLauncherScenario({
    launcherName: "Light Missile Launcher I",
    loadedChargeName: "Scourge Light Missile",
    cargoChargeName: "Inferno Light Missile",
    loadedQuantity: 5,
    cargoQuantity: 60,
  });
  const infernoLight = resolveExactItem("Inferno Light Missile");
  const session = attackerSession.session;
  session._space.loginChargeHydrationProfile = "login";

  const dogma = new DogmaService();
  dogma.Handle_LoadAmmo(
    [
      shipItem.itemID,
      [moduleItem.itemID],
      [{ typeID: infernoLight.typeID }],
      shipItem.itemID,
    ],
    session,
  );

  const queuedReload = DogmaService._testing.getPendingModuleReloads().get(moduleItem.itemID);
  const reloadCompleteAtMs = Number(queuedReload && queuedReload.completeAtMs || 0);
  assert.ok(
    reloadCompleteAtMs > scene.getCurrentSimTimeMs(),
    "expected queued ammo-swap reload to complete in the future",
  );

  attackerSession.notifications.length = 0;
  advanceSceneUntilSimTime(scene, reloadCompleteAtMs, 25);

  const tupleItemID = buildChargeTupleItemID(
    shipItem.itemID,
    moduleItem.flagID,
    infernoLight.typeID,
  );
  const primeIndex = attackerSession.notifications.findIndex((entry) => (
    entry &&
    entry.name === "OnGodmaPrimeItem" &&
    sameItemID(readPrimeItemID(entry), tupleItemID)
  ));
  assert.ok(
    primeIndex >= 0,
    "expected reload completion to prime the newly loaded tuple charge",
  );
  assert.equal(
    Number(readPrimeAttributes(attackerSession.notifications[primeIndex]).get(ATTRIBUTE_QUANTITY)),
    0,
    "expected the tuple prime to seed quantity 0 before the quantity update",
  );
  const quantityNotificationIndex = attackerSession.notifications.findIndex((entry) => (
    entry &&
    entry.name === "OnModuleAttributeChanges" &&
    Boolean(findTupleQuantityChange(
      [entry],
      tupleItemID,
      getModuleChargeCapacity(moduleItem.typeID, infernoLight.typeID),
    ))
  ));
  assert.equal(
    quantityNotificationIndex > primeIndex,
    true,
    "expected reload completion to publish tuple quantity only after OnGodmaPrimeItem",
  );
});
