const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const DogmaService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dogmaService",
));
const {
  buildInventoryItem,
  createSpaceItemForCharacter,
  grantItemToCharacterLocation,
  removeInventoryItem,
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
  getLoadedChargeByFlag,
  getAttributeIDByNames,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));

const ATTRIBUTE_SHIP_DAMAGE = getAttributeIDByNames("damage") || 3;
const ATTRIBUTE_SHIP_SHIELD_CHARGE = getAttributeIDByNames("shieldCharge") || 264;
const ATTRIBUTE_SHIP_ARMOR_DAMAGE = getAttributeIDByNames("armorDamage") || 266;

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
let nextTransientCharacterID = 998720000;

function serialTest(name, fn) {
  return test(name, { concurrency: false }, fn);
}

function resolveExactItem(name) {
  const result = resolveItemByName(name);
  assert.equal(result && result.success, true, `Expected item '${name}' to exist`);
  return result.match;
}

function registerCleanup(fn) {
  transientCleanups.push(fn);
}

function buildShipItem(typeName, itemID = 983000001) {
  const type = resolveExactItem(typeName);
  return buildInventoryItem({
    itemID,
    typeID: type.typeID,
    ownerID: 9000001,
    locationID: 60003760,
    singleton: 1,
  });
}

function buildFittedModule(typeName, itemID, shipID, flagID, options = {}) {
  const type = resolveExactItem(typeName);
  return buildInventoryItem({
    itemID,
    typeID: type.typeID,
    ownerID: 9000001,
    locationID: shipID,
    flagID,
    singleton: 1,
    moduleState: {
      online: options.online !== false,
    },
  });
}

function buildRuntimeShipEntity(scene, shipItem, options = {}) {
  return spaceRuntime._testing.buildRuntimeShipEntityForTesting({
    itemID: shipItem.itemID,
    typeID: shipItem.typeID,
    groupID: shipItem.groupID,
    categoryID: shipItem.categoryID,
    itemName: shipItem.itemName,
    ownerID: options.ownerID ?? shipItem.ownerID,
    characterID: options.characterID ?? 0,
    pilotCharacterID: options.characterID ?? 0,
    radius: shipItem.radius,
    position: options.position ?? { x: 0, y: 0, z: 0 },
    conditionState: options.conditionState || shipItem.conditionState || {},
    fittedItems: Array.isArray(options.fittedItems) ? options.fittedItems : [],
    passiveResourceState: {
      ...DEFAULT_PASSIVE_STATE,
      ...(options.passiveResourceState || {}),
    },
  }, scene.systemID);
}

function attachSession(scene, entity, clientID, characterID = 0) {
  const notifications = [];
  const session = {
    clientID,
    characterID,
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
  };

  entity.session = session;
  if (!scene.getEntityByID(entity.itemID)) {
    scene.spawnDynamicEntity(entity, { broadcast: false });
  }
  scene.sessions.set(clientID, session);
  return { session, notifications };
}

function flattenAttributeChanges(notifications = []) {
  const changes = [];
  for (const notification of notifications) {
    if (
      !notification ||
      notification.name !== "OnModuleAttributeChanges" ||
      !Array.isArray(notification.payload)
    ) {
      continue;
    }

    const payloadList = notification.payload[0];
    const items = Array.isArray(payloadList && payloadList.items)
      ? payloadList.items
      : [];
    changes.push(...items);
  }
  return changes;
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
  assert.equal(event.args[10], expected.repeat ?? null);
  assert.equal(event.args[11], expected.startTime ?? null);
  assert.equal(Number(event.args[12]), Number(expected.timeFromStart ?? 0));
  assert.equal(event.args[13], expected.graphicInfo ?? null);
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
    assert.ok(iterations <= 20, "expected scene to reach requested sim time promptly");
  }
}

function getCurrentCapacitorAmount(entity) {
  return (Number(entity && entity.capacitorChargeRatio) || 0) *
    Math.max(0, Number(entity && entity.capacitorCapacity) || 0);
}

function createTransientCharacter(systemID) {
  const characterID = nextTransientCharacterID;
  nextTransientCharacterID += 100;
  const characterRecord = {
    characterID,
    characterName: `local-cycle-test-${characterID}`,
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

function createInventoryBackedLocalCycleScenario(options = {}) {
  const systemID = options.systemID ?? 30000142;
  const characterRecord = createTransientCharacter(systemID);
  const shipType = resolveExactItem(options.shipName ?? "Rokh");
  const moduleType = resolveExactItem(options.moduleName);

  const shipCreateResult = createSpaceItemForCharacter(
    characterRecord.characterID,
    systemID,
    shipType,
    {
      transient: true,
      position: options.position ?? { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      mode: "STOP",
      speedFraction: 0,
      conditionState: {
        damage: 0,
        charge: 1,
        armorDamage: 0,
        shieldCharge: 1,
        ...(options.shipConditionState || {}),
      },
    },
  );
  assert.equal(shipCreateResult.success, true, "Failed to create transient ship");
  const shipItem = shipCreateResult.data;
  registerCleanup(() => {
    removeInventoryItem(shipItem.itemID, { removeContents: true });
  });

  const moduleGrantResult = grantItemToCharacterLocation(
    characterRecord.characterID,
    shipItem.itemID,
    options.flagID ?? 19,
    moduleType,
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
  assert.equal(moduleGrantResult.success, true, "Failed to grant local-cycle module");
  const moduleItem = moduleGrantResult.data.items[0];

  if (options.loadedChargeName) {
    const loadedChargeType = resolveExactItem(options.loadedChargeName);
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
    assert.equal(loadedGrantResult.success, true, "Failed to grant loaded module charge");
  }

  if ((options.cargoQuantity ?? 0) > 0 && options.cargoChargeName) {
    const cargoChargeType = resolveExactItem(options.cargoChargeName);
    const cargoGrantResult = grantItemToCharacterLocation(
      characterRecord.characterID,
      shipItem.itemID,
      ITEM_FLAGS.CARGO_HOLD,
      cargoChargeType,
      options.cargoQuantity,
      {
        transient: true,
        singleton: false,
      },
    );
    assert.equal(cargoGrantResult.success, true, "Failed to grant cargo charge stack");
  }

  const scene = spaceRuntime.ensureScene(systemID);
  const passiveResourceState = {
    ...DEFAULT_PASSIVE_STATE,
    ...(options.passiveResourceState || {}),
  };
  let shipEntity = scene.getEntityByID(shipItem.itemID) || null;
  if (!shipEntity) {
    shipEntity = spaceRuntime._testing.buildRuntimeShipEntityForTesting({
      itemID: shipItem.itemID,
      typeID: shipItem.typeID,
      groupID: shipItem.groupID,
      categoryID: shipItem.categoryID,
      itemName: shipItem.itemName,
      ownerID: characterRecord.characterID,
      characterID: characterRecord.characterID,
      pilotCharacterID: characterRecord.characterID,
      radius: shipItem.radius,
      position: options.position ?? { x: 0, y: 0, z: 0 },
      conditionState: {
        damage: 0,
        charge: 1,
        armorDamage: 0,
        shieldCharge: 1,
        ...(options.runtimeConditionState || {}),
      },
      passiveResourceState,
    }, scene.systemID);
  }
  shipEntity.ownerID = characterRecord.characterID;
  shipEntity.characterID = characterRecord.characterID;
  shipEntity.pilotCharacterID = characterRecord.characterID;
  shipEntity.conditionState = {
    damage: 0,
    charge: 1,
    armorDamage: 0,
    shieldCharge: 1,
    ...(options.runtimeConditionState || {}),
  };
  shipEntity.capacitorCapacity = passiveResourceState.capacitorCapacity;
  shipEntity.capacitorRechargeRate = passiveResourceState.capacitorRechargeRate;
  shipEntity.shieldCapacity = passiveResourceState.shieldCapacity;
  shipEntity.shieldRechargeRate = passiveResourceState.shieldRechargeRate;
  shipEntity.armorHP = passiveResourceState.armorHP;
  shipEntity.structureHP = passiveResourceState.structureHP;
  shipEntity.capacitorChargeRatio = Number(shipEntity.conditionState.charge) || 0;
  const attached = attachSession(
    scene,
    shipEntity,
    characterRecord.characterID + 5000,
    characterRecord.characterID,
  );
  const runtimeShip = scene.getEntityByID(shipItem.itemID);
  assert.ok(runtimeShip, "expected spawned runtime ship entity");

  return {
    scene,
    characterRecord,
    shipItem,
    shipEntity: runtimeShip,
    session: attached.session,
    notifications: attached.notifications,
    moduleItem,
  };
}

test.afterEach(() => {
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

serialTest("shield boosters apply at activation and notify owner and observers immediately", () => {
  const scene = spaceRuntime.ensureScene(30000142);
  const shipItem = buildShipItem("Rokh", 983100001);
  const shieldBooster = buildFittedModule(
    "Medium Shield Booster II",
    983100011,
    shipItem.itemID,
    19,
  );
  const ownerEntity = buildRuntimeShipEntity(scene, shipItem, {
    characterID: 0,
    conditionState: {
      damage: 0,
      charge: 1,
      armorDamage: 0,
      shieldCharge: 0.4,
      incapacitated: false,
    },
    fittedItems: [shieldBooster],
  });
  const observerShipItem = buildShipItem("Rokh", 983100101);
  const observerEntity = buildRuntimeShipEntity(scene, observerShipItem, {
    characterID: 0,
    position: { x: 500, y: 0, z: 0 },
  });
  const owner = attachSession(scene, ownerEntity, 1001, 0);
  const observer = attachSession(scene, observerEntity, 1002, 0);

  const activationResult = scene.activateGenericModule(owner.session, shieldBooster);

  assert.equal(activationResult.success, true);
  assert.ok(
    Math.abs(Number(ownerEntity.conditionState.shieldCharge) - 0.504) < 1e-6,
    "expected shield booster to repair at activation",
  );

  const shieldChanges = flattenAttributeChanges(owner.notifications)
    .filter((entry) => Number(entry[2]) === shipItem.itemID)
    .filter((entry) => Number(entry[3]) === ATTRIBUTE_SHIP_SHIELD_CHARGE);
  assert.ok(shieldChanges.length > 0, "expected owner shield HUD update on activation");
  assert.ok(
    shieldChanges.some((entry) => Number(entry[5]) > Number(entry[6])),
    "expected shield HUD delta to move upward",
  );

  const ownerDamageState = flattenDestinyUpdates(owner.notifications).some((entry) => (
    entry.name === "OnDamageStateChange" &&
    Number(entry.args[0]) === shipItem.itemID
  ));
  const observerDamageState = flattenDestinyUpdates(observer.notifications).some((entry) => (
    entry.name === "OnDamageStateChange" &&
    Number(entry.args[0]) === shipItem.itemID
  ));
  assert.equal(ownerDamageState, true, "expected owner damage state refresh on boost");
  assert.equal(observerDamageState, true, "expected observer damage state refresh on boost");
});

serialTest("armor repairers repair only at end of cycle", () => {
  const scene = spaceRuntime.ensureScene(30000142);
  const shipItem = buildShipItem("Rokh", 983200001);
  const armorRepairer = buildFittedModule(
    "Medium Armor Repairer II",
    983200011,
    shipItem.itemID,
    11,
  );
  const entity = buildRuntimeShipEntity(scene, shipItem, {
    characterID: 0,
    conditionState: {
      damage: 0,
      charge: 1,
      armorDamage: 0.6,
      shieldCharge: 1,
      incapacitated: false,
    },
    fittedItems: [armorRepairer],
  });
  const owner = attachSession(scene, entity, 1011, 0);

  const activationResult = scene.activateGenericModule(owner.session, armorRepairer);
  assert.equal(activationResult.success, true);
  assert.equal(entity.conditionState.armorDamage, 0.6);

  const firstCycleAtMs = Number(activationResult.data.effectState.nextCycleAtMs || 0);
  advanceSceneUntilSimTime(scene, Math.max(0, firstCycleAtMs - 50));
  assert.equal(entity.conditionState.armorDamage, 0.6);

  owner.notifications.length = 0;
  advanceScene(scene, 100);
  assert.ok(
    Math.abs(Number(entity.conditionState.armorDamage) - 0.232) < 1e-6,
    "expected medium armor repairer to land at cycle end",
  );

  const armorChanges = flattenAttributeChanges(owner.notifications)
    .filter((entry) => Number(entry[2]) === shipItem.itemID)
    .filter((entry) => Number(entry[3]) === ATTRIBUTE_SHIP_ARMOR_DAMAGE);
  assert.ok(armorChanges.length > 0, "expected armor HUD update at cycle end");
});

serialTest("hull repairers repair only at end of cycle", () => {
  const scene = spaceRuntime.ensureScene(30000142);
  const shipItem = buildShipItem("Rokh", 983300001);
  const hullRepairer = buildFittedModule(
    "Small Hull Repairer II",
    983300011,
    shipItem.itemID,
    12,
  );
  const entity = buildRuntimeShipEntity(scene, shipItem, {
    characterID: 0,
    conditionState: {
      damage: 0.5,
      charge: 1,
      armorDamage: 0,
      shieldCharge: 1,
      incapacitated: false,
    },
    fittedItems: [hullRepairer],
  });
  const owner = attachSession(scene, entity, 1021, 0);

  const activationResult = scene.activateGenericModule(owner.session, hullRepairer);
  assert.equal(activationResult.success, true);
  assert.equal(entity.conditionState.damage, 0.5);

  const firstCycleAtMs = Number(activationResult.data.effectState.nextCycleAtMs || 0);
  advanceSceneUntilSimTime(scene, Math.max(0, firstCycleAtMs - 50));
  assert.equal(entity.conditionState.damage, 0.5);

  owner.notifications.length = 0;
  advanceScene(scene, 100);
  assert.ok(
    Math.abs(Number(entity.conditionState.damage) - 0.47) < 1e-6,
    "expected hull repairer to land at cycle end",
  );

  const hullChanges = flattenAttributeChanges(owner.notifications)
    .filter((entry) => Number(entry[2]) === shipItem.itemID)
    .filter((entry) => Number(entry[3]) === ATTRIBUTE_SHIP_DAMAGE);
  assert.ok(hullChanges.length > 0, "expected hull HUD update at cycle end");
});

serialTest("capacitor boosters inject at activation and resume after reload completion", () => {
  const {
    scene,
    characterRecord,
    shipItem,
    shipEntity,
    session,
    moduleItem,
  } = createInventoryBackedLocalCycleScenario({
    moduleName: "Medium Capacitor Booster II",
    flagID: 19,
    loadedChargeName: "Cap Booster 400",
    loadedQuantity: 1,
    cargoChargeName: "Cap Booster 400",
    cargoQuantity: 1,
    passiveResourceState: {
      capacitorRechargeRate: 1_000_000_000_000,
    },
    runtimeConditionState: {
      damage: 0,
      charge: 0.2,
      armorDamage: 0,
      shieldCharge: 1,
      incapacitated: false,
    },
  });

  const activationResult = scene.activateGenericModule(session, moduleItem);

  assert.equal(activationResult.success, true);
  assert.ok(
    Math.abs(getCurrentCapacitorAmount(shipEntity) - 1_400) < 1,
    "expected cap booster to inject immediately",
  );

  const activeEffect = shipEntity.activeModuleEffects.get(moduleItem.itemID);
  assert.ok(activeEffect && activeEffect.pendingLocalReload, "expected queued local reload");
  const reloadCompleteAtMs = Number(activeEffect.pendingLocalReload.completeAtMs || 0);
  assert.ok(reloadCompleteAtMs > scene.getCurrentSimTimeMs());

  advanceSceneUntilSimTime(scene, Math.max(0, reloadCompleteAtMs - 50));
  const capacitorBeforeReload = getCurrentCapacitorAmount(shipEntity);
  assert.ok(
    capacitorBeforeReload < 1_500,
    "expected no second injection before reload completion",
  );

  advanceScene(scene, 100);
  assert.ok(
    getCurrentCapacitorAmount(shipEntity) > capacitorBeforeReload + 300,
    "expected cap booster to inject again when reload completes",
  );

  const loadedChargeAfterSecondShot = getLoadedChargeByFlag(
    characterRecord.characterID,
    shipItem.itemID,
    moduleItem.flagID,
  );
  assert.equal(loadedChargeAfterSecondShot, null, "expected second booster charge to be consumed");

  const refreshedEffect = shipEntity.activeModuleEffects.get(moduleItem.itemID);
  assert.equal(
    refreshedEffect && refreshedEffect.pendingLocalStopReason,
    "ammo",
    "expected empty cap booster to stop after the next cycle boundary",
  );
});

serialTest("ancillary shield boosters run capacitor-free when loaded and dry with capacitor after depletion", () => {
  const {
    scene,
    shipEntity,
    session,
    moduleItem,
  } = createInventoryBackedLocalCycleScenario({
    moduleName: "Medium Ancillary Shield Booster",
    flagID: 20,
    loadedChargeName: "Cap Booster 50",
    loadedQuantity: 1,
    cargoQuantity: 0,
    passiveResourceState: {
      capacitorRechargeRate: 1_000_000_000_000,
    },
    runtimeConditionState: {
      damage: 0,
      charge: 0.5,
      armorDamage: 0,
      shieldCharge: 0.4,
      incapacitated: false,
    },
  });

  const baselineCapacitor = getCurrentCapacitorAmount(shipEntity);
  const activationResult = scene.activateGenericModule(session, moduleItem);

  assert.equal(activationResult.success, true);
  assert.ok(
    Math.abs(Number(shipEntity.conditionState.shieldCharge) - 0.546) < 1e-6,
    "expected loaded ASB to boost immediately",
  );
  assert.ok(
    Math.abs(getCurrentCapacitorAmount(shipEntity) - baselineCapacitor) < 1e-6,
    "expected loaded ASB cycle to consume no capacitor",
  );

  const firstDryCycleAtMs = Number(activationResult.data.effectState.nextCycleAtMs || 0);
  advanceSceneUntilSimTime(scene, Math.max(0, firstDryCycleAtMs - 50));
  const capacitorBeforeDryCycle = getCurrentCapacitorAmount(shipEntity);
  assert.ok(
    Math.abs(capacitorBeforeDryCycle - baselineCapacitor) < 1,
    "expected no dry-cycle capacitor spend before the boundary",
  );

  advanceScene(scene, 100);
  assert.ok(
    Math.abs(Number(shipEntity.conditionState.shieldCharge) - 0.692) < 1e-6,
    "expected dry ASB cycle to keep boosting shields",
  );
  assert.ok(
    getCurrentCapacitorAmount(shipEntity) < capacitorBeforeDryCycle - 150,
    "expected dry ASB cycle to consume capacitor",
  );
});

serialTest("ancillary armor repairers use charged repair first and dry repair after paste is spent", () => {
  const {
    scene,
    shipEntity,
    session,
    moduleItem,
  } = createInventoryBackedLocalCycleScenario({
    moduleName: "Medium Ancillary Armor Repairer",
    flagID: 11,
    loadedChargeName: "Nanite Repair Paste",
    loadedQuantity: 1,
    cargoQuantity: 0,
    passiveResourceState: {
      capacitorRechargeRate: 1_000_000_000_000,
    },
    runtimeConditionState: {
      damage: 0,
      charge: 1,
      armorDamage: 0.9,
      shieldCharge: 1,
      incapacitated: false,
    },
  });

  const activationResult = scene.activateGenericModule(session, moduleItem);

  assert.equal(activationResult.success, true);
  assert.equal(shipEntity.conditionState.armorDamage, 0.9);

  const firstCycleAtMs = Number(activationResult.data.effectState.nextCycleAtMs || 0);
  advanceSceneUntilSimTime(scene, Math.max(0, firstCycleAtMs - 50));
  assert.equal(shipEntity.conditionState.armorDamage, 0.9);

  advanceScene(scene, 100);
  const firstCycleArmorDamage = Number(shipEntity.conditionState.armorDamage);
  assert.ok(
    Math.abs(firstCycleArmorDamage - 0.279) < 1e-6,
    "expected charged AAR repair amount at first cycle end",
  );

  const secondCycleAtMs = Number(
    (shipEntity.activeModuleEffects.get(moduleItem.itemID) || {}).nextCycleAtMs || 0,
  );
  advanceSceneUntilSimTime(scene, Math.max(0, secondCycleAtMs - 50));
  assert.ok(Math.abs(Number(shipEntity.conditionState.armorDamage) - firstCycleArmorDamage) < 1e-6);

  advanceScene(scene, 100);
  assert.ok(
    Math.abs(Number(shipEntity.conditionState.armorDamage) - 0.072) < 1e-6,
    "expected dry AAR repair amount after paste depletion",
  );
});

serialTest("local-cycle module families emit the expected owner and observer OnSpecialFX start/stop packets", () => {
  const capBooster50 = resolveExactItem("Cap Booster 50");
  const naniteRepairPaste = resolveExactItem("Nanite Repair Paste");
  const cases = [
    {
      label: "shield booster",
      moduleName: "Medium Shield Booster II",
      flagID: 19,
      guid: "effects.ShieldBoosting",
      chargeTypeID: null,
    },
    {
      label: "armor repairer",
      moduleName: "Medium Armor Repairer II",
      flagID: 11,
      guid: "effects.ArmorRepair",
      chargeTypeID: null,
    },
    {
      label: "hull repairer",
      moduleName: "Small Hull Repairer II",
      flagID: 12,
      guid: "effects.StructureRepair",
      chargeTypeID: null,
    },
    {
      label: "ancillary shield booster",
      moduleName: "Medium Ancillary Shield Booster",
      flagID: 20,
      loadedChargeName: "Cap Booster 50",
      loadedQuantity: 1,
      guid: "effects.ShieldBoosting",
      chargeTypeID: capBooster50.typeID,
    },
    {
      label: "ancillary armor repairer",
      moduleName: "Medium Ancillary Armor Repairer",
      flagID: 13,
      loadedChargeName: "Nanite Repair Paste",
      loadedQuantity: 1,
      guid: "effects.ArmorRepair",
      chargeTypeID: naniteRepairPaste.typeID,
    },
  ];

  for (const [index, testCase] of cases.entries()) {
    const scenario = createInventoryBackedLocalCycleScenario({
      moduleName: testCase.moduleName,
      flagID: testCase.flagID,
      loadedChargeName: testCase.loadedChargeName,
      loadedQuantity: testCase.loadedQuantity,
    });
    const observerShipItem = buildShipItem("Rokh", scenario.shipItem.itemID + 50);
    const observerEntity = buildRuntimeShipEntity(
      scenario.scene,
      observerShipItem,
      {
        characterID: 0,
        position: { x: 500 + (index * 10), y: 0, z: 0 },
      },
    );
    const observer = attachSession(
      scenario.scene,
      observerEntity,
      scenario.characterRecord.characterID + 6000,
      0,
    );

    scenario.notifications.length = 0;
    observer.notifications.length = 0;

    const activationResult = scenario.scene.activateGenericModule(
      scenario.session,
      scenario.moduleItem,
    );
    assert.equal(
      activationResult.success,
      true,
      `expected ${testCase.label} activation to succeed`,
    );
    const effectState = activationResult.data.effectState;

    const ownerStartFx = getSpecialFxEvents(scenario.notifications, testCase.guid);
    const observerStartFx = getSpecialFxEvents(observer.notifications, testCase.guid);
    assert.equal(
      ownerStartFx.length,
      1,
      `expected one owner start FX for ${testCase.label}`,
    );
    assert.equal(
      observerStartFx.length,
      1,
      `expected one observer start FX for ${testCase.label}`,
    );
    assertSpecialFxPayload(ownerStartFx[0], {
      moduleID: scenario.moduleItem.itemID,
      moduleTypeID: scenario.moduleItem.typeID,
      targetID: null,
      chargeTypeID: testCase.chargeTypeID,
      guid: testCase.guid,
      isOffensive: false,
      start: true,
      active: true,
      duration: effectState.durationMs,
      repeat: null,
    });
    assertSpecialFxPayload(observerStartFx[0], {
      moduleID: scenario.moduleItem.itemID,
      moduleTypeID: scenario.moduleItem.typeID,
      targetID: null,
      chargeTypeID: testCase.chargeTypeID,
      guid: testCase.guid,
      isOffensive: false,
      start: true,
      active: true,
      duration: effectState.durationMs,
      repeat: null,
    });

    scenario.notifications.length = 0;
    observer.notifications.length = 0;

    const deactivateResult = scenario.scene.deactivateGenericModule(
      scenario.session,
      scenario.moduleItem.itemID,
    );
    assert.equal(
      deactivateResult.success,
      true,
      `expected ${testCase.label} deactivation to succeed`,
    );
    const stopAtMs = Number(
      (deactivateResult.data && deactivateResult.data.deactivateAtMs) ||
      (deactivateResult.data && deactivateResult.data.stoppedAtMs) ||
      0,
    );
    if (stopAtMs > scenario.scene.getCurrentSimTimeMs()) {
      advanceSceneUntilSimTime(scenario.scene, stopAtMs, 100);
    }

    const ownerStopFx = getSpecialFxEvents(scenario.notifications, testCase.guid)
      .filter((entry) => Number(entry.args[7]) === 0);
    const observerStopFx = getSpecialFxEvents(observer.notifications, testCase.guid)
      .filter((entry) => Number(entry.args[7]) === 0);
    assert.equal(
      ownerStopFx.length,
      1,
      `expected one owner stop FX for ${testCase.label}`,
    );
    assert.equal(
      observerStopFx.length,
      1,
      `expected one observer stop FX for ${testCase.label}`,
    );
    assertSpecialFxPayload(ownerStopFx[0], {
      moduleID: scenario.moduleItem.itemID,
      moduleTypeID: scenario.moduleItem.typeID,
      targetID: null,
      chargeTypeID: testCase.chargeTypeID,
      guid: testCase.guid,
      isOffensive: false,
      start: false,
      active: false,
      duration: effectState.durationMs,
      repeat: null,
    });
    assertSpecialFxPayload(observerStopFx[0], {
      moduleID: scenario.moduleItem.itemID,
      moduleTypeID: scenario.moduleItem.typeID,
      targetID: null,
      chargeTypeID: testCase.chargeTypeID,
      guid: testCase.guid,
      isOffensive: false,
      start: false,
      active: false,
      duration: effectState.durationMs,
      repeat: null,
    });
  }
});

serialTest("capacitor boosters emit no OnSpecialFX because the activation effect has no GUID", () => {
  const scenario = createInventoryBackedLocalCycleScenario({
    moduleName: "Medium Capacitor Booster II",
    flagID: 19,
    loadedChargeName: "Cap Booster 400",
    loadedQuantity: 1,
    cargoQuantity: 0,
  });
  const observerShipItem = buildShipItem("Rokh", scenario.shipItem.itemID + 75);
  const observerEntity = buildRuntimeShipEntity(
    scenario.scene,
    observerShipItem,
    {
      characterID: 0,
      position: { x: 500, y: 0, z: 0 },
    },
  );
  const observer = attachSession(
    scenario.scene,
    observerEntity,
    scenario.characterRecord.characterID + 7000,
    0,
  );

  scenario.notifications.length = 0;
  observer.notifications.length = 0;

  const activationResult = scenario.scene.activateGenericModule(
    scenario.session,
    scenario.moduleItem,
  );
  assert.equal(activationResult.success, true);
  assert.equal(getSpecialFxEvents(scenario.notifications).length, 0);
  assert.equal(getSpecialFxEvents(observer.notifications).length, 0);

  const effectState = activationResult.data.effectState;
  scenario.notifications.length = 0;
  observer.notifications.length = 0;
  advanceSceneUntilSimTime(
    scenario.scene,
    Number(effectState.nextCycleAtMs || scenario.scene.getCurrentSimTimeMs()),
    100,
  );
  assert.equal(getSpecialFxEvents(scenario.notifications).length, 0);
  assert.equal(getSpecialFxEvents(observer.notifications).length, 0);
});
