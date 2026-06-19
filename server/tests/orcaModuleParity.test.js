const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..", "..");

const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const destiny = require(path.join(repoRoot, "server/src/space/destiny"));
const {
  buildWeaponModuleSnapshot,
  resolveWeaponFamily,
} = require(path.join(repoRoot, "server/src/space/combat/weaponDogma"));
const {
  getTypeAttributeValue,
} = require(path.join(repoRoot, "server/src/services/fitting/liveFittingState"));
const {
  resolveItemByName,
  resolveItemByTypeID,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemTypeRegistry",
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
  assert.equal(result && result.success, true, `expected item '${name}' to exist`);
  return result.match;
}

function buildFittedModule(typeName, itemID, shipID, flagID) {
  const type = resolveExactItem(typeName);
  return {
    itemID,
    ownerID: 0,
    locationID: shipID,
    flagID,
    typeID: Number(type.typeID),
    groupID: Number(type.groupID || 0),
    categoryID: Number(type.categoryID || 0),
    itemName: String(type.name || typeName),
    singleton: 1,
    quantity: 1,
    stacksize: 1,
    moduleState: {
      online: true,
    },
  };
}

function buildInventoryCharge(typeName, itemID, shipID, flagID = 5, quantity = 100) {
  const type = resolveExactItem(typeName);
  return {
    itemID,
    ownerID: 0,
    locationID: shipID,
    flagID,
    typeID: Number(type.typeID),
    groupID: Number(type.groupID || 0),
    categoryID: Number(type.categoryID || 0),
    itemName: String(type.name || typeName),
    singleton: 0,
    quantity,
    stacksize: quantity,
  };
}

function buildShipItem(typeName, itemID) {
  const type = resolveExactItem(typeName);
  return {
    itemID,
    ownerID: 0,
    locationID: 30000142,
    flagID: 4,
    typeID: Number(type.typeID),
    groupID: Number(type.groupID || 0),
    categoryID: Number(type.categoryID || 0),
    itemName: String(type.name || typeName),
    singleton: 1,
    quantity: 1,
    stacksize: 1,
  };
}

function buildRuntimeShipEntity(scene, typeName, itemID, characterID, position, fittedItems = [], options = {}) {
  const type = resolveExactItem(typeName);
  return spaceRuntime._testing.buildRuntimeShipEntityForTesting({
    itemID,
    typeID: Number(type.typeID),
    groupID: Number(type.groupID || 0),
    categoryID: Number(type.categoryID || 0),
    itemName: String(type.name || typeName),
    ownerID: characterID,
    characterID,
    pilotCharacterID: characterID,
    nativeNpc: true,
    position: { ...position },
    direction: options.direction || { x: 1, y: 0, z: 0 },
    conditionState: options.conditionState || {
      damage: 0,
      armorDamage: 0,
      shieldCharge: 1,
      charge: 1,
    },
    fittedItems,
    passiveResourceState: {
      ...DEFAULT_PASSIVE_STATE,
      ...(options.passiveResourceState || {}),
    },
  }, scene.systemID);
}

function buildRuntimeWreckEntity(scene, itemID, position) {
  const wreckEntity = spaceRuntime._testing.buildRuntimeInventoryEntityForTesting({
    itemID,
    typeID: 26506,
    groupID: 186,
    categoryID: 6,
    ownerID: 140000004,
    itemName: "Caldari Frigate Wreck",
    spaceState: {
      systemID: scene.systemID,
      position: { ...position },
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      targetPoint: { ...position },
      speedFraction: 0,
      mode: "STOP",
    },
  }, scene.systemID, Date.now());
  wreckEntity.persistSpaceState = false;
  return wreckEntity;
}

function attachSession(scene, entity, clientID, characterID) {
  const notifications = [];
  const serviceNotifications = [];
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
      visibleBubbleScopedStaticEntityIDs: new Set(),
      freshlyVisibleDynamicEntityIDs: new Set(),
      timeDilation: scene.getTimeDilation(),
      simTimeMs: scene.getCurrentSimTimeMs(),
      simFileTime: scene.getCurrentFileTime(),
    },
    socket: { destroyed: false },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendServiceNotification(serviceName, methodName, payload, kwargs = null) {
      serviceNotifications.push({ serviceName, methodName, payload, kwargs });
    },
    sendSessionChange() {},
  };

  entity.session = session;
  if (!scene.getEntityByID(entity.itemID)) {
    scene.spawnDynamicEntity(entity, { broadcast: false });
  }
  scene.sessions.set(clientID, session);
  return { session, notifications, serviceNotifications };
}

function flushDirectDestinyNotifications(scene) {
  if (scene && typeof scene.flushDirectDestinyNotificationBatch === "function") {
    scene.flushDirectDestinyNotificationBatch();
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
        stamp: Number(Array.isArray(entry) ? entry[0] : 0) || 0,
        name: payload[0],
        args: Array.isArray(payload[1]) ? payload[1] : [],
      });
    }
  }
  return updates;
}

function getSpecialFxEvents(notifications = [], guid = null) {
  const expectedGuids =
    guid === null
      ? null
      : String(guid)
        .split(",")
        .map((entry) => String(entry || "").trim())
        .filter(Boolean);
  return flattenDestinyUpdates(notifications).filter((entry) => (
    entry.name === "OnSpecialFX" &&
    (
      expectedGuids === null ||
      expectedGuids.includes(String(entry.args[5]))
    )
  ));
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

function getJamNotifications(notifications = [], name) {
  return notifications.filter((entry) => (
    entry &&
    entry.name === name &&
    Array.isArray(entry.payload)
  ));
}

function getServiceNotifications(serviceNotifications = [], serviceName, methodName) {
  return serviceNotifications.filter((entry) => (
    entry &&
    entry.serviceName === serviceName &&
    entry.methodName === methodName
  ));
}

function assertJamNotification(event, expected = {}) {
  assert.ok(event, `expected ${expected.name || "jam"} notification`);
  assert.equal(Number(event.payload[0]), Number(expected.sourceBallID));
  assert.equal(Number(event.payload[1]), Number(expected.moduleID));
  assert.equal(Number(event.payload[2]), Number(expected.targetBallID));
  assert.equal(String(event.payload[3]), String(expected.jammingType));
}

function assertSpecialFxPayload(event, expected = {}) {
  assert.ok(event, "expected OnSpecialFX event");
  const expectedGuids = String(expected.guid ?? "")
    .split(",")
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
  assert.equal(Number(event.args[1]), Number(expected.moduleID));
  assert.equal(Number(event.args[2]), Number(expected.moduleTypeID));
  assert.equal(event.args[3], expected.targetID ?? null);
  assert.equal(event.args[4], expected.chargeTypeID ?? null);
  if (expectedGuids.length <= 1) {
    assert.equal(String(event.args[5]), String(expected.guid));
  } else {
    assert.ok(
      expectedGuids.includes(String(event.args[5])),
      `expected FX guid ${String(event.args[5])} to be one of ${expectedGuids.join(", ")}`,
    );
  }
  assert.equal(Number(event.args[6]), expected.isOffensive === true ? 1 : 0);
  assert.equal(Number(event.args[7]), expected.start === true ? 1 : 0);
  assert.equal(Number(event.args[8]), expected.active === true ? 1 : 0);
  assert.equal(Number(event.args[9]), Number(expected.duration));
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

function primeTargetLock(sourceEntity, targetEntity, scene) {
  const nowMs = scene.getCurrentSimTimeMs();
  sourceEntity.lockedTargets.set(targetEntity.itemID, {
    targetID: targetEntity.itemID,
    lockedAtMs: nowMs,
  });
  targetEntity.targetedBy.add(sourceEntity.itemID);
}

function getMarshalListItems(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (
    value &&
    typeof value === "object" &&
    value.type === "list" &&
    Array.isArray(value.items)
  ) {
    return value.items;
  }
  return [];
}

function resetScenes() {
  spaceRuntime._testing.clearScenes();
}

serialTest("Orca remote shield booster matches client FX and applies repeated shield transfers", () => {
  resetScenes();
  const scene = spaceRuntime.ensureScene(30000142);

  try {
    const shieldBooster = buildFittedModule(
      "Capital Remote Shield Booster I",
      996100001,
      996100000,
      27,
    );
    const orca = buildRuntimeShipEntity(
      scene,
      "Orca",
      996100000,
      9610001,
      { x: 0, y: 0, z: 0 },
      [shieldBooster],
    );
    const target = buildRuntimeShipEntity(
      scene,
      "Venture",
      996100010,
      9610010,
      { x: 2_000, y: 0, z: 0 },
      [],
      {
        conditionState: {
          damage: 0,
          armorDamage: 0,
          shieldCharge: 0.1,
          charge: 0.2,
        },
        passiveResourceState: {
          ...DEFAULT_PASSIVE_STATE,
          shieldCapacity: 10_000,
          capacitorCapacity: 10_000,
        },
      },
    );

    const { session: ownerSession, notifications: ownerNotifications } = attachSession(
      scene,
      orca,
      9611001,
      9610001,
    );
    const { notifications: targetNotifications } = attachSession(
      scene,
      target,
      9611010,
      9610010,
    );
    primeTargetLock(orca, target, scene);

    const initialShieldRatio = Number(target.conditionState.shieldCharge) || 0;
    const activationResult = scene.activateGenericModule(
      ownerSession,
      shieldBooster,
      "shipModuleRemoteShieldBooster",
      { targetID: target.itemID },
    );
    assert.equal(activationResult.success, true);
    flushDirectDestinyNotifications(scene);

    const effectState = orca.activeModuleEffects.get(shieldBooster.itemID);
    assert.ok(effectState);
    assert.equal(effectState.assistanceModuleEffect, true);
    assert.equal(effectState.assistanceFamily, "remoteShield");
    assert.equal(effectState.guid, "effects.ShieldTransfer");
    assert.ok(Number(effectState.repeat) > 1);

    const startOwnerFx = getSpecialFxEvents(ownerNotifications, "effects.ShieldTransfer")
      .find((entry) => Number(entry.args[7]) === 1 && Number(entry.args[8]) === 1);
    const startTargetFx = getSpecialFxEvents(targetNotifications, "effects.ShieldTransfer")
      .find((entry) => Number(entry.args[7]) === 1 && Number(entry.args[8]) === 1);
    assertSpecialFxPayload(startOwnerFx, {
      moduleID: shieldBooster.itemID,
      moduleTypeID: shieldBooster.typeID,
      targetID: target.itemID,
      chargeTypeID: null,
      guid: "effects.ShieldTransfer",
      isOffensive: false,
      start: true,
      active: true,
      duration: effectState.durationMs,
    });
    assertSpecialFxPayload(startTargetFx, {
      moduleID: shieldBooster.itemID,
      moduleTypeID: shieldBooster.typeID,
      targetID: target.itemID,
      chargeTypeID: null,
      guid: "effects.ShieldTransfer",
      isOffensive: false,
      start: true,
      active: true,
      duration: effectState.durationMs,
    });
    assert.equal(getGodmaEffectNotifications(ownerNotifications, shieldBooster.itemID, true).length, 1);

    const postActivationShieldRatio = Number(target.conditionState.shieldCharge) || 0;
    assert.ok(postActivationShieldRatio > initialShieldRatio, "expected immediate shield transfer");

    advanceSceneUntilSimTime(scene, effectState.nextCycleAtMs, 25);
    flushDirectDestinyNotifications(scene);
    const postCycleShieldRatio = Number(target.conditionState.shieldCharge) || 0;
    assert.ok(postCycleShieldRatio > postActivationShieldRatio, "expected repeated shield transfer");

    const deactivateResult = scene.deactivateGenericModule(ownerSession, shieldBooster.itemID, {
      deferUntilCycle: false,
    });
    assert.equal(deactivateResult.success, true);
    flushDirectDestinyNotifications(scene);

    const stopOwnerFx = getSpecialFxEvents(ownerNotifications, "effects.ShieldTransfer")
      .find((entry) => Number(entry.args[7]) === 0 && Number(entry.args[8]) === 0);
    assertSpecialFxPayload(stopOwnerFx, {
      moduleID: shieldBooster.itemID,
      moduleTypeID: shieldBooster.typeID,
      targetID: target.itemID,
      chargeTypeID: null,
      guid: "effects.ShieldTransfer",
      isOffensive: false,
      start: false,
      active: false,
      duration: effectState.durationMs,
    });
    assert.ok(getGodmaEffectNotifications(ownerNotifications, shieldBooster.itemID, false).length >= 1);
  } finally {
    resetScenes();
  }
});

serialTest("Orca remote capacitor transmitter matches client FX and transfers capacitor on cycle", () => {
  resetScenes();
  const scene = spaceRuntime.ensureScene(30000145);

  try {
    const capacitorTransmitter = buildFittedModule(
      "Capital Remote Capacitor Transmitter I",
      996200001,
      996200000,
      27,
    );
    const orca = buildRuntimeShipEntity(
      scene,
      "Orca",
      996200000,
      9620001,
      { x: 0, y: 0, z: 0 },
      [capacitorTransmitter],
    );
    const target = buildRuntimeShipEntity(
      scene,
      "Venture",
      996200010,
      9620010,
      { x: 5_000, y: 0, z: 0 },
      [],
      {
        conditionState: {
          damage: 0,
          armorDamage: 0,
          shieldCharge: 1,
          charge: 0.1,
        },
        passiveResourceState: {
          ...DEFAULT_PASSIVE_STATE,
          capacitorCapacity: 10_000,
          shieldCapacity: 10_000,
        },
      },
    );

    const { session: ownerSession, notifications: ownerNotifications } = attachSession(
      scene,
      orca,
      9621001,
      9620001,
    );
    const { notifications: targetNotifications } = attachSession(
      scene,
      target,
      9621010,
      9620010,
    );
    primeTargetLock(orca, target, scene);

    const initialCapRatio = Number(target.capacitorChargeRatio) || 0;
    const activationResult = scene.activateGenericModule(
      ownerSession,
      capacitorTransmitter,
      "shipModuleRemoteCapacitorTransmitter",
      { targetID: target.itemID },
    );
    assert.equal(activationResult.success, true);
    flushDirectDestinyNotifications(scene);

    const effectState = orca.activeModuleEffects.get(capacitorTransmitter.itemID);
    assert.ok(effectState);
    assert.equal(effectState.assistanceModuleEffect, true);
    assert.equal(effectState.assistanceFamily, "remoteCapacitor");
    assert.equal(effectState.guid, "effects.EnergyTransfer");
    assert.ok(Number(effectState.repeat) > 1);

    const startOwnerFx = getSpecialFxEvents(ownerNotifications, "effects.EnergyTransfer")
      .find((entry) => Number(entry.args[7]) === 1 && Number(entry.args[8]) === 1);
    const startTargetFx = getSpecialFxEvents(targetNotifications, "effects.EnergyTransfer")
      .find((entry) => Number(entry.args[7]) === 1 && Number(entry.args[8]) === 1);
    assertSpecialFxPayload(startOwnerFx, {
      moduleID: capacitorTransmitter.itemID,
      moduleTypeID: capacitorTransmitter.typeID,
      targetID: target.itemID,
      chargeTypeID: null,
      guid: "effects.EnergyTransfer",
      isOffensive: false,
      start: true,
      active: true,
      duration: effectState.durationMs,
    });
    assertSpecialFxPayload(startTargetFx, {
      moduleID: capacitorTransmitter.itemID,
      moduleTypeID: capacitorTransmitter.typeID,
      targetID: target.itemID,
      chargeTypeID: null,
      guid: "effects.EnergyTransfer",
      isOffensive: false,
      start: true,
      active: true,
      duration: effectState.durationMs,
    });
    assert.equal(
      getGodmaEffectNotifications(ownerNotifications, capacitorTransmitter.itemID, true).length,
      1,
    );

    const postActivationCapRatio = Number(target.capacitorChargeRatio) || 0;
    assert.ok(postActivationCapRatio > initialCapRatio, "expected immediate capacitor transfer");

    advanceSceneUntilSimTime(scene, effectState.nextCycleAtMs, 25);
    flushDirectDestinyNotifications(scene);
    const postCycleCapRatio = Number(target.capacitorChargeRatio) || 0;
    assert.ok(postCycleCapRatio > postActivationCapRatio, "expected repeated capacitor transfer");
  } finally {
    resetScenes();
  }
});

serialTest("remote assistance modules drive client HUD/icon parity for shield, cap, armor, hull, and mutadaptive armor support", () => {
  resetScenes();
  const scene = spaceRuntime.ensureScene(30000146);

  try {
    const cases = [
      {
        moduleName: "Capital Remote Shield Booster I",
        effectName: "shipModuleRemoteShieldBooster",
        family: "remoteShield",
        jammingType: "shieldTransfer",
        guid: "effects.ShieldTransfer",
        moduleID: 996250001,
        targetID: 996250101,
        initialConditionState: {
          damage: 0,
          armorDamage: 0,
          shieldCharge: 0.2,
          charge: 1,
        },
        assertApplied(target) {
          assert.ok(
            Number(target.conditionState.shieldCharge) > 0.2,
            "expected shield transfer to improve shield charge",
          );
        },
      },
      {
        moduleName: "Capital Remote Capacitor Transmitter I",
        effectName: "shipModuleRemoteCapacitorTransmitter",
        family: "remoteCapacitor",
        jammingType: "energyTransfer",
        guid: "effects.EnergyTransfer",
        moduleID: 996250002,
        targetID: 996250102,
        initialConditionState: {
          damage: 0,
          armorDamage: 0,
          shieldCharge: 1,
          charge: 0.2,
        },
        assertApplied(target) {
          assert.ok(
            Number(target.capacitorChargeRatio) > 0.2,
            "expected capacitor transfer to improve capacitor charge",
          );
        },
      },
      {
        moduleName: "Capital Remote Armor Repairer I",
        effectName: "shipModuleRemoteArmorRepairer",
        family: "remoteArmor",
        jammingType: "remoteArmorRepair",
        guid: "effects.RemoteArmourRepair",
        moduleID: 996250003,
        targetID: 996250103,
        initialConditionState: {
          damage: 0,
          armorDamage: 0.65,
          shieldCharge: 1,
          charge: 1,
        },
        assertApplied(target) {
          assert.ok(
            Number(target.conditionState.armorDamage) < 0.65,
            "expected remote armor repair to reduce armor damage",
          );
        },
      },
      {
        moduleName: "Heavy Mutadaptive Remote Armor Repairer I",
        effectName: "ShipModuleRemoteArmorMutadaptiveRepairer",
        family: "remoteArmor",
        jammingType: "RemoteArmorMutadaptiveRepairer",
        guid: "effects.TriglavianBeam,effects.AttackMode",
        moduleID: 996250005,
        targetID: 996250105,
        initialConditionState: {
          damage: 0,
          armorDamage: 0.65,
          shieldCharge: 1,
          charge: 1,
        },
        assertApplied(target) {
          assert.ok(
            Number(target.conditionState.armorDamage) < 0.65,
            "expected mutadaptive remote armor repair to reduce armor damage",
          );
        },
      },
      {
        moduleName: "Capital Remote Hull Repairer I",
        effectName: "shipModuleRemoteHullRepairer",
        family: "remoteHull",
        jammingType: "remoteHullRepair",
        guid: "effects.RemoteHullRepair",
        moduleID: 996250004,
        targetID: 996250104,
        initialConditionState: {
          damage: 0.7,
          armorDamage: 0,
          shieldCharge: 1,
          charge: 1,
        },
        assertApplied(target) {
          assert.ok(
            Number(target.conditionState.damage) < 0.7,
            "expected remote hull repair to reduce hull damage",
          );
        },
      },
    ];

    for (const testCase of cases) {
      const sourceShipID = testCase.moduleID + 1_000;
      const sourceCharacterID = testCase.moduleID + 2_000;
      const sourceSessionID = testCase.moduleID + 3_000;
      const targetCharacterID = testCase.targetID + 2_000;
      const targetSessionID = testCase.targetID + 3_000;
      const moduleItem = buildFittedModule(
        testCase.moduleName,
        testCase.moduleID,
        sourceShipID,
        27,
      );
      const source = buildRuntimeShipEntity(
        scene,
        "Orca",
        sourceShipID,
        sourceCharacterID,
        { x: 0, y: 0, z: 0 },
        [moduleItem],
      );
      const target = buildRuntimeShipEntity(
        scene,
        "Venture",
        testCase.targetID,
        targetCharacterID,
        { x: 4_000, y: 0, z: 0 },
        [],
        {
          conditionState: testCase.initialConditionState,
          passiveResourceState: {
            ...DEFAULT_PASSIVE_STATE,
            shieldCapacity: 10_000,
            capacitorCapacity: 10_000,
            armorHP: 10_000,
            structureHP: 10_000,
          },
        },
      );

      const { session: ownerSession, notifications: ownerNotifications } = attachSession(
        scene,
        source,
        sourceSessionID,
        sourceCharacterID,
      );
      const {
        notifications: targetNotifications,
        serviceNotifications: targetServiceNotifications,
      } = attachSession(
        scene,
        target,
        targetSessionID,
        targetCharacterID,
      );
      primeTargetLock(source, target, scene);

      const activationResult = scene.activateGenericModule(
        ownerSession,
        moduleItem,
        testCase.effectName,
        { targetID: target.itemID },
      );
      assert.equal(activationResult.success, true, `expected ${testCase.moduleName} to activate`);
      flushDirectDestinyNotifications(scene);

      const effectState = source.activeModuleEffects.get(moduleItem.itemID);
      assert.ok(effectState, `expected active effect state for ${testCase.moduleName}`);
      assert.equal(effectState.assistanceFamily, testCase.family);
      assert.equal(effectState.assistanceJammingType, testCase.jammingType);
      assert.equal(effectState.guid, testCase.guid);

      const targetStartFx = getSpecialFxEvents(targetNotifications, testCase.guid)
        .find((entry) => Number(entry.args[7]) === 1 && Number(entry.args[8]) === 1);
      assertSpecialFxPayload(targetStartFx, {
        moduleID: moduleItem.itemID,
        moduleTypeID: moduleItem.typeID,
        targetID: target.itemID,
        chargeTypeID: null,
        guid: testCase.guid,
        isOffensive: false,
        start: true,
        active: true,
        duration: effectState.durationMs,
      });

      const jamStartsAfterActivation = getJamNotifications(targetNotifications, "OnJamStart");
      assert.equal(jamStartsAfterActivation.length, 1);
      assertJamNotification(jamStartsAfterActivation[0], {
        name: "OnJamStart",
        sourceBallID: source.itemID,
        moduleID: moduleItem.itemID,
        targetBallID: target.itemID,
        jammingType: testCase.jammingType,
      });
      assert.ok(Number(jamStartsAfterActivation[0].payload[5]) > Number(effectState.durationMs));
      const ewarStartsAfterActivation = getJamNotifications(
        targetNotifications,
        "OnEwarStart",
      );
      assert.equal(ewarStartsAfterActivation.length, 1);
      assertJamNotification(ewarStartsAfterActivation[0], {
        name: "OnEwarStart",
        sourceBallID: source.itemID,
        moduleID: moduleItem.itemID,
        targetBallID: target.itemID,
        jammingType: testCase.jammingType,
      });

      testCase.assertApplied(target);

      advanceSceneUntilSimTime(scene, effectState.nextCycleAtMs, 25);
      flushDirectDestinyNotifications(scene);

      const jamEndsAfterCycle = getJamNotifications(targetNotifications, "OnJamEnd");
      const jamStartsAfterCycle = getJamNotifications(targetNotifications, "OnJamStart");
      assert.equal(
        jamEndsAfterCycle.length,
        0,
        `expected ${testCase.moduleName} timer refresh not to tear the HUD icon down every cycle`,
      );
      assert.ok(jamStartsAfterCycle.length >= 2, `expected ${testCase.moduleName} cycle reset jam start`);
      assertJamNotification(jamStartsAfterCycle[jamStartsAfterCycle.length - 1], {
        name: "OnJamStart",
        sourceBallID: source.itemID,
        moduleID: moduleItem.itemID,
        targetBallID: target.itemID,
        jammingType: testCase.jammingType,
      });
      const ewarEndsAfterCycle = getJamNotifications(targetNotifications, "OnEwarEnd");
      const ewarStartsAfterCycle = getJamNotifications(targetNotifications, "OnEwarStart");
      assert.equal(
        ewarEndsAfterCycle.length,
        0,
        `expected ${testCase.moduleName} Tactical icon to stay up across cycle refreshes`,
      );
      assert.equal(ewarStartsAfterCycle.length, 1);

      const deactivateResult = scene.deactivateGenericModule(ownerSession, moduleItem.itemID, {
        deferUntilCycle: false,
      });
      assert.equal(deactivateResult.success, true);
      flushDirectDestinyNotifications(scene);

      const finalJamEnds = getJamNotifications(targetNotifications, "OnJamEnd");
      assert.ok(finalJamEnds.length >= 1, `expected ${testCase.moduleName} to send jam end on stop`);
      assertJamNotification(finalJamEnds[finalJamEnds.length - 1], {
        name: "OnJamEnd",
        sourceBallID: source.itemID,
        moduleID: moduleItem.itemID,
        targetBallID: target.itemID,
        jammingType: testCase.jammingType,
      });
      const finalEwarEnds = getJamNotifications(targetNotifications, "OnEwarEnd");
      assert.ok(finalEwarEnds.length >= 1);
    }
  } finally {
    resetScenes();
  }
});

serialTest("remote assistance activation stays generic across normal and capital module sizes", () => {
  resetScenes();
  const scene = spaceRuntime.ensureScene(30000147);

  try {
    const cases = [
      ["Small Remote Shield Booster I", "shipModuleRemoteShieldBooster", "remoteShield", "effects.ShieldTransfer"],
      ["Medium Remote Shield Booster I", "shipModuleRemoteShieldBooster", "remoteShield", "effects.ShieldTransfer"],
      ["Large Remote Shield Booster I", "shipModuleRemoteShieldBooster", "remoteShield", "effects.ShieldTransfer"],
      ["Capital Remote Shield Booster I", "shipModuleRemoteShieldBooster", "remoteShield", "effects.ShieldTransfer"],
      ["Small Remote Capacitor Transmitter I", "shipModuleRemoteCapacitorTransmitter", "remoteCapacitor", "effects.EnergyTransfer"],
      ["Medium Remote Capacitor Transmitter I", "shipModuleRemoteCapacitorTransmitter", "remoteCapacitor", "effects.EnergyTransfer"],
      ["Large Remote Capacitor Transmitter I", "shipModuleRemoteCapacitorTransmitter", "remoteCapacitor", "effects.EnergyTransfer"],
      ["Capital Remote Capacitor Transmitter I", "shipModuleRemoteCapacitorTransmitter", "remoteCapacitor", "effects.EnergyTransfer"],
      ["Small Remote Armor Repairer I", "shipModuleRemoteArmorRepairer", "remoteArmor", "effects.RemoteArmourRepair"],
      ["Medium Remote Armor Repairer I", "shipModuleRemoteArmorRepairer", "remoteArmor", "effects.RemoteArmourRepair"],
      ["Large Remote Armor Repairer I", "shipModuleRemoteArmorRepairer", "remoteArmor", "effects.RemoteArmourRepair"],
      ["Capital Remote Armor Repairer I", "shipModuleRemoteArmorRepairer", "remoteArmor", "effects.RemoteArmourRepair"],
      ["Heavy Mutadaptive Remote Armor Repairer I", "ShipModuleRemoteArmorMutadaptiveRepairer", "remoteArmor", "effects.TriglavianBeam,effects.AttackMode"],
      ["Heavy Mutadaptive Remote Armor Repairer II", "ShipModuleRemoteArmorMutadaptiveRepairer", "remoteArmor", "effects.TriglavianBeam,effects.AttackMode"],
      ["Small Remote Hull Repairer I", "shipModuleRemoteHullRepairer", "remoteHull", "effects.RemoteHullRepair"],
      ["Medium Remote Hull Repairer I", "shipModuleRemoteHullRepairer", "remoteHull", "effects.RemoteHullRepair"],
      ["Large Remote Hull Repairer I", "shipModuleRemoteHullRepairer", "remoteHull", "effects.RemoteHullRepair"],
      ["Capital Remote Hull Repairer I", "shipModuleRemoteHullRepairer", "remoteHull", "effects.RemoteHullRepair"],
    ];

    cases.forEach(([moduleName, effectName, family, guid], index) => {
      const sourceShipID = 996260000 + (index * 10);
      const targetShipID = sourceShipID + 1;
      const moduleItem = buildFittedModule(moduleName, sourceShipID + 2, sourceShipID, 27);
      const source = buildRuntimeShipEntity(
        scene,
        "Orca",
        sourceShipID,
        sourceShipID + 1000,
        { x: 0, y: 0, z: 0 },
        [moduleItem],
      );
      const target = buildRuntimeShipEntity(
        scene,
        "Venture",
        targetShipID,
        targetShipID + 1000,
        { x: 3_000, y: 0, z: 0 },
        [],
        {
          conditionState: {
            damage: 0.5,
            armorDamage: 0.5,
            shieldCharge: 0.5,
            charge: 0.5,
          },
          passiveResourceState: {
            ...DEFAULT_PASSIVE_STATE,
            shieldCapacity: 10_000,
            capacitorCapacity: 10_000,
            armorHP: 10_000,
            structureHP: 10_000,
          },
        },
      );
      const { session: ownerSession } = attachSession(
        scene,
        source,
        sourceShipID + 2000,
        sourceShipID + 1000,
      );
      attachSession(
        scene,
        target,
        targetShipID + 2000,
        targetShipID + 1000,
      );
      primeTargetLock(source, target, scene);

      const activationResult = scene.activateGenericModule(
        ownerSession,
        moduleItem,
        effectName,
        { targetID: target.itemID },
      );
      assert.equal(activationResult.success, true, `expected ${moduleName} to activate`);
      const effectState = source.activeModuleEffects.get(moduleItem.itemID);
      assert.ok(effectState, `expected active state for ${moduleName}`);
      assert.equal(effectState.assistanceFamily, family);
      assert.equal(effectState.guid, guid);

      const deactivateResult = scene.deactivateGenericModule(ownerSession, moduleItem.itemID, {
        deferUntilCycle: false,
      });
      assert.equal(deactivateResult.success, true);
    });
  } finally {
    resetScenes();
  }
});

serialTest("SetState refresh reseeds active remote assistance HUD icons for target sessions", () => {
  resetScenes();
  const scene = spaceRuntime.ensureScene(30000152);

  try {
    const cases = [
      ["Small Remote Shield Booster I", "shipModuleRemoteShieldBooster", "shieldTransfer"],
      ["Small Remote Capacitor Transmitter I", "shipModuleRemoteCapacitorTransmitter", "energyTransfer"],
      ["Small Remote Armor Repairer I", "shipModuleRemoteArmorRepairer", "remoteArmorRepair"],
      ["Heavy Mutadaptive Remote Armor Repairer I", "ShipModuleRemoteArmorMutadaptiveRepairer", "RemoteArmorMutadaptiveRepairer"],
      ["Small Remote Hull Repairer I", "shipModuleRemoteHullRepairer", "remoteHullRepair"],
    ];

    cases.forEach(([moduleName, effectName, jammingType], index) => {
      const sourceShipID = 996295000 + (index * 10);
      const targetShipID = sourceShipID + 1;
      const moduleItem = buildFittedModule(moduleName, sourceShipID + 2, sourceShipID, 27);
      const source = buildRuntimeShipEntity(
        scene,
        "Orca",
        sourceShipID,
        sourceShipID + 1000,
        { x: 0, y: 0, z: 0 },
        [moduleItem],
      );
      const target = buildRuntimeShipEntity(
        scene,
        "Venture",
        targetShipID,
        targetShipID + 1000,
        { x: 3_000, y: 0, z: 0 },
        [],
        {
          conditionState: {
            damage: 0.5,
            armorDamage: 0.5,
            shieldCharge: 0.5,
            charge: 0.5,
          },
          passiveResourceState: {
            ...DEFAULT_PASSIVE_STATE,
            shieldCapacity: 10_000,
            capacitorCapacity: 10_000,
            armorHP: 10_000,
            structureHP: 10_000,
          },
        },
      );
      const { session: ownerSession } = attachSession(
        scene,
        source,
        sourceShipID + 2000,
        sourceShipID + 1000,
      );
      const {
        session: targetSession,
        notifications: targetNotifications,
        serviceNotifications: targetServiceNotifications,
      } = attachSession(
        scene,
        target,
        targetShipID + 2000,
        targetShipID + 1000,
      );
      primeTargetLock(source, target, scene);

      const activationResult = scene.activateGenericModule(
        ownerSession,
        moduleItem,
        effectName,
        { targetID: target.itemID },
      );
      assert.equal(activationResult.success, true, `expected ${moduleName} to activate`);
      flushDirectDestinyNotifications(scene);

      targetNotifications.length = 0;
      targetServiceNotifications.length = 0;
      scene.sendStateRefresh(targetSession, target, null, {
        reason: "assistance-hud-refresh-test",
      });
      flushDirectDestinyNotifications(scene);

      const setStateUpdate = flattenDestinyUpdates(targetNotifications).find(
        (entry) => entry.name === "SetState",
      );
      assert.ok(setStateUpdate, `expected ${moduleName} refresh to include SetState`);

      const jamStarts = getJamNotifications(targetNotifications, "OnJamStart");
      assert.equal(
        jamStarts.length,
        1,
        `expected ${moduleName} refresh to reseed one HUD icon notification`,
      );
      assertJamNotification(jamStarts[0], {
        name: "OnJamStart",
        sourceBallID: source.itemID,
        moduleID: moduleItem.itemID,
        targetBallID: target.itemID,
        jammingType,
      });
      assert.ok(
        Number(jamStarts[0].payload[5]) > 0,
        `expected ${moduleName} refresh HUD duration to stay positive`,
      );
      const ewarStarts = getJamNotifications(targetNotifications, "OnEwarStart");
      assert.equal(
        ewarStarts.length,
        1,
        `expected ${moduleName} refresh to reseed one tactical EWAR notification`,
      );
      assertJamNotification(ewarStarts[0], {
        name: "OnEwarStart",
        sourceBallID: source.itemID,
        moduleID: moduleItem.itemID,
        targetBallID: target.itemID,
        jammingType,
      });
    });
  } finally {
    resetScenes();
  }
});

serialTest("fresh acquire replays active remote assistance beams for late observers", () => {
  resetScenes();
  const scene = spaceRuntime.ensureScene(30000153);

  try {
    const cases = [
      ["Capital Remote Shield Booster I", "shipModuleRemoteShieldBooster", "effects.ShieldTransfer"],
      ["Capital Remote Capacitor Transmitter I", "shipModuleRemoteCapacitorTransmitter", "effects.EnergyTransfer"],
      ["Capital Remote Armor Repairer I", "shipModuleRemoteArmorRepairer", "effects.RemoteArmourRepair"],
      ["Heavy Mutadaptive Remote Armor Repairer I", "ShipModuleRemoteArmorMutadaptiveRepairer", "effects.TriglavianBeam,effects.AttackMode"],
      ["Capital Remote Hull Repairer I", "shipModuleRemoteHullRepairer", "effects.RemoteHullRepair"],
    ];

    cases.forEach(([moduleName, effectName, guid], index) => {
      const sourceShipID = 996297000 + (index * 10);
      const targetShipID = sourceShipID + 1;
      const observerShipID = sourceShipID + 2;
      const moduleItem = buildFittedModule(moduleName, sourceShipID + 3, sourceShipID, 27);
      const source = buildRuntimeShipEntity(
        scene,
        "Orca",
        sourceShipID,
        sourceShipID + 1000,
        { x: 0, y: 0, z: 0 },
        [moduleItem],
      );
      const target = buildRuntimeShipEntity(
        scene,
        "Venture",
        targetShipID,
        targetShipID + 1000,
        { x: 3_000, y: 0, z: 0 },
        [],
        {
          conditionState: {
            damage: 0.5,
            armorDamage: 0.5,
            shieldCharge: 0.5,
            charge: 0.5,
          },
          passiveResourceState: {
            ...DEFAULT_PASSIVE_STATE,
            shieldCapacity: 10_000,
            capacitorCapacity: 10_000,
            armorHP: 10_000,
            structureHP: 10_000,
          },
        },
      );
      const observer = buildRuntimeShipEntity(
        scene,
        "Venture",
        observerShipID,
        observerShipID + 1000,
        { x: 1_500, y: 0, z: 0 },
        [],
      );
      const { session: ownerSession } = attachSession(
        scene,
        source,
        sourceShipID + 2000,
        sourceShipID + 1000,
      );
      attachSession(
        scene,
        target,
        targetShipID + 2000,
        targetShipID + 1000,
      );
      const { session: observerSession, notifications: observerNotifications } = attachSession(
        scene,
        observer,
        observerShipID + 2000,
        observerShipID + 1000,
      );
      primeTargetLock(source, target, scene);

      const activationResult = scene.activateGenericModule(
        ownerSession,
        moduleItem,
        effectName,
        { targetID: target.itemID },
      );
      assert.equal(activationResult.success, true, `expected ${moduleName} to activate`);
      flushDirectDestinyNotifications(scene);

      observerNotifications.length = 0;
      const acquireResult = scene.sendAddBallsToSession(observerSession, [source, target], {
        freshAcquire: true,
        bypassTickPresentationBatch: true,
      });
      assert.equal(acquireResult.delivered, true, `expected ${moduleName} fresh acquire delivery`);
      flushDirectDestinyNotifications(scene);

      const replayFx = getSpecialFxEvents(observerNotifications, guid).find(
        (entry) => Number(entry.args[7]) === 1 && Number(entry.args[8]) === 1,
      );
      const effectState = source.activeModuleEffects.get(moduleItem.itemID);
      assert.ok(effectState, `expected active state for ${moduleName}`);
      assertSpecialFxPayload(replayFx, {
        moduleID: moduleItem.itemID,
        moduleTypeID: moduleItem.typeID,
        targetID: target.itemID,
        chargeTypeID: null,
        guid,
        isOffensive: false,
        start: true,
        active: true,
        duration: effectState.durationMs,
      });
    });
  } finally {
    resetScenes();
  }
});

serialTest("Orca tractor beam matches client FX and pulls wrecks toward the ship until deactivation", () => {
  resetScenes();
  const scene = spaceRuntime.ensureScene(30000148);

  try {
    const tractorBeam = buildFittedModule(
      "Capital Tractor Beam I",
      996300001,
      996300000,
      27,
    );
    const orca = buildRuntimeShipEntity(
      scene,
      "Orca",
      996300000,
      9630001,
      { x: 0, y: 0, z: 0 },
      [tractorBeam],
    );
    const wreck = buildRuntimeWreckEntity(scene, 996300050, {
      x: 10_000,
      y: 0,
      z: 0,
    });

    const { session: ownerSession, notifications: ownerNotifications } = attachSession(
      scene,
      orca,
      9631001,
      9630001,
    );
    scene.spawnDynamicEntity(wreck, { broadcast: false });

    const initialWreckX = Number(wreck.position.x) || 0;
    const activationResult = scene.activateGenericModule(
      ownerSession,
      tractorBeam,
      "tractorBeamCan",
      { targetID: wreck.itemID },
    );
    assert.equal(activationResult.success, true);
    flushDirectDestinyNotifications(scene);

    const effectState = orca.activeModuleEffects.get(tractorBeam.itemID);
    assert.ok(effectState);
    assert.equal(effectState.tractorBeamEffect, true);
    assert.equal(effectState.guid, "effects.TractorBeam");
    assert.ok(Number(effectState.repeat) > 1);

    const startOwnerFx = getSpecialFxEvents(ownerNotifications, "effects.TractorBeam")
      .find((entry) => Number(entry.args[7]) === 1 && Number(entry.args[8]) === 1);
    assertSpecialFxPayload(startOwnerFx, {
      moduleID: tractorBeam.itemID,
      moduleTypeID: tractorBeam.typeID,
      targetID: wreck.itemID,
      chargeTypeID: null,
      guid: "effects.TractorBeam",
      isOffensive: false,
      start: true,
      active: true,
      duration: effectState.durationMs,
    });
    assert.equal(getGodmaEffectNotifications(ownerNotifications, tractorBeam.itemID, true).length, 1);

    advanceScene(scene, 2_000);
    flushDirectDestinyNotifications(scene);
    const movementUpdates = flattenDestinyUpdates(ownerNotifications)
      .filter((entry) => (
        entry.name === "SetBallVelocity" &&
        Number(entry.args[0]) === wreck.itemID
      ));
    assert.ok(
      Number(wreck.position.x) < initialWreckX,
      "expected tractor beam to pull the wreck toward the Orca",
    );
    assert.ok(
      movementUpdates.length >= 1,
      "expected tractor beam to broadcast wreck velocity while active",
    );

    const deactivateResult = scene.deactivateGenericModule(ownerSession, tractorBeam.itemID, {
      deferUntilCycle: false,
    });
    assert.equal(deactivateResult.success, true);
    flushDirectDestinyNotifications(scene);

    const stopOwnerFx = getSpecialFxEvents(ownerNotifications, "effects.TractorBeam")
      .find((entry) => Number(entry.args[7]) === 0 && Number(entry.args[8]) === 0);
    assertSpecialFxPayload(stopOwnerFx, {
      moduleID: tractorBeam.itemID,
      moduleTypeID: tractorBeam.typeID,
      targetID: wreck.itemID,
      chargeTypeID: null,
      guid: "effects.TractorBeam",
      isOffensive: false,
      start: false,
      active: false,
      duration: effectState.durationMs,
    });
    assert.equal(Number(wreck.velocity.x) || 0, 0);
    assert.equal(Number(wreck.velocity.y) || 0, 0);
    assert.equal(Number(wreck.velocity.z) || 0, 0);
    assert.ok(getGodmaEffectNotifications(ownerNotifications, tractorBeam.itemID, false).length >= 1);
  } finally {
    resetScenes();
  }
});

serialTest("Orca Small Tractor Beam II seeds tractor pull with an initial anchor and velocity", () => {
  resetScenes();
  const scene = spaceRuntime.ensureScene(30000148);

  try {
    const tractorBeam = buildFittedModule(
      "Small Tractor Beam II",
      996340001,
      996340000,
      30,
    );
    const orca = buildRuntimeShipEntity(
      scene,
      "Orca",
      996340000,
      9634001,
      { x: 0, y: 0, z: 0 },
      [tractorBeam],
    );
    const wreck = buildRuntimeWreckEntity(scene, 996340050, {
      x: 8_000,
      y: 0,
      z: 0,
    });

    const { session: ownerSession, notifications: ownerNotifications } = attachSession(
      scene,
      orca,
      9634002,
      9634001,
    );
    scene.spawnDynamicEntity(wreck, { broadcast: false });

    const activationResult = scene.activateGenericModule(
      ownerSession,
      tractorBeam,
      "tractorBeamCan",
      { targetID: wreck.itemID },
    );
    assert.equal(activationResult.success, true);
    flushDirectDestinyNotifications(scene);

    ownerNotifications.length = 0;
    advanceScene(scene, 1_200);
    flushDirectDestinyNotifications(scene);

    const movementUpdates = flattenDestinyUpdates(ownerNotifications)
      .filter((entry) => (
        (
          entry.name === "SetBallPosition" ||
          entry.name === "SetBallVelocity" ||
          entry.name === "SetMaxSpeed" ||
          entry.name === "SetSpeedFraction" ||
          entry.name === "GotoPoint"
        ) &&
        Number(entry.args[0]) === wreck.itemID
      ));
    const positionUpdates = movementUpdates.filter((entry) => entry.name === "SetBallPosition");
    const velocityUpdates = movementUpdates.filter((entry) => entry.name === "SetBallVelocity");
    const maxSpeedUpdates = movementUpdates.filter((entry) => entry.name === "SetMaxSpeed");
    const speedFractionUpdates = movementUpdates.filter((entry) => entry.name === "SetSpeedFraction");
    const gotoPointUpdates = movementUpdates.filter((entry) => entry.name === "GotoPoint");

    assert.equal(positionUpdates.length, 1, "expected first tractor contact to seed one position anchor");
    assert.ok(
      velocityUpdates.length >= 1,
      "expected first tractor contact to seed wreck velocity",
    );
    assert.ok(maxSpeedUpdates.length >= 1, "expected first tractor contact to seed wreck max speed");
    assert.ok(speedFractionUpdates.length >= 1, "expected first tractor contact to seed wreck speed fraction");
    assert.ok(gotoPointUpdates.length >= 1, "expected first tractor contact to seed a wreck goto point");
    assert.equal(Number(positionUpdates[0].stamp) || 0, Number(velocityUpdates[0].stamp) || 0);
  } finally {
    resetScenes();
  }
});

serialTest("Orca Small Tractor Beam II favors velocity-led movement over same-stamp correction spam", () => {
  resetScenes();
  const scene = spaceRuntime.ensureScene(30000148);

  try {
    const tractorBeam = buildFittedModule(
      "Small Tractor Beam II",
      996350001,
      996350000,
      30,
    );
    const orca = buildRuntimeShipEntity(
      scene,
      "Orca",
      996350000,
      9635001,
      { x: 0, y: 0, z: 0 },
      [tractorBeam],
    );
    const wreck = buildRuntimeWreckEntity(scene, 996350050, {
      x: 8_000,
      y: 0,
      z: 0,
    });

    const { session: ownerSession, notifications: ownerNotifications } = attachSession(
      scene,
      orca,
      9636001,
      9635001,
    );
    scene.spawnDynamicEntity(wreck, { broadcast: false });

    const activationResult = scene.activateGenericModule(
      ownerSession,
      tractorBeam,
      "tractorBeamCan",
      { targetID: wreck.itemID },
    );
    assert.equal(activationResult.success, true);
    flushDirectDestinyNotifications(scene);

    ownerNotifications.length = 0;
    advanceScene(scene, 2_000);
    flushDirectDestinyNotifications(scene);

    const movementUpdates = flattenDestinyUpdates(ownerNotifications)
      .filter((entry) => (
        (entry.name === "SetBallPosition" || entry.name === "SetBallVelocity") &&
        Number(entry.args[0]) === wreck.itemID
      ));
    const positionUpdates = movementUpdates.filter((entry) => entry.name === "SetBallPosition");
    const velocityUpdates = movementUpdates.filter((entry) => entry.name === "SetBallVelocity");
    const velocityStamps = velocityUpdates.map((entry) => Number(entry.stamp) || 0);
    const uniqueVelocityStamps = new Set(velocityStamps);

    assert.ok(
      positionUpdates.length <= 1,
      `expected no repeated tractor position rebases in a short pull, got ${positionUpdates.length}`,
    );
    assert.ok(
      velocityUpdates.length <= 4,
      `expected tractor velocity nudges to stay near destiny-stamp cadence, got ${velocityUpdates.length}`,
    );
    assert.ok(
      uniqueVelocityStamps.size === velocityUpdates.length,
      "expected tractor velocity updates to avoid same-stamp spam",
    );
    assert.ok(
      Number(wreck.position.x) < 8_000,
      "expected tractor beam to keep pulling the wreck toward the Orca",
    );
  } finally {
    resetScenes();
  }
});

serialTest("Orca Small Tractor Beam II avoids timed mid-pull position rebases on a long pull", () => {
  resetScenes();
  const scene = spaceRuntime.ensureScene(30000148);

  try {
    const tractorBeam = buildFittedModule(
      "Small Tractor Beam II",
      996355001,
      996355000,
      30,
    );
    const orca = buildRuntimeShipEntity(
      scene,
      "Orca",
      996355000,
      9635501,
      { x: 0, y: 0, z: 0 },
      [tractorBeam],
    );
    const wreck = buildRuntimeWreckEntity(scene, 996355050, {
      x: 20_000,
      y: 0,
      z: 0,
    });

    const { session: ownerSession, notifications: ownerNotifications } = attachSession(
      scene,
      orca,
      9635502,
      9635501,
    );
    scene.spawnDynamicEntity(wreck, { broadcast: false });

    const activationResult = scene.activateGenericModule(
      ownerSession,
      tractorBeam,
      "tractorBeamCan",
      { targetID: wreck.itemID },
    );
    assert.equal(activationResult.success, true);
    flushDirectDestinyNotifications(scene);

    ownerNotifications.length = 0;
    advanceScene(scene, 6_000);
    flushDirectDestinyNotifications(scene);

    const movementUpdates = flattenDestinyUpdates(ownerNotifications)
      .filter((entry) => (
        (entry.name === "SetBallPosition" || entry.name === "SetBallVelocity") &&
        Number(entry.args[0]) === wreck.itemID
      ));
    const positionUpdates = movementUpdates.filter((entry) => entry.name === "SetBallPosition");
    const velocityUpdates = movementUpdates.filter((entry) => entry.name === "SetBallVelocity");

    assert.equal(positionUpdates.length, 1, `expected long tractor pull to keep only the initial position anchor, got ${positionUpdates.length}`);
    assert.ok(
      velocityUpdates.length >= 1,
      `expected long tractor pull to stay velocity-led, got ${velocityUpdates.length}`,
    );
  } finally {
    resetScenes();
  }
});

serialTest("Orca Small Tractor Beam II deactivation stops without a mid-pull position snap", () => {
  resetScenes();
  const scene = spaceRuntime.ensureScene(30000148);

  try {
    const tractorBeam = buildFittedModule(
      "Small Tractor Beam II",
      996356001,
      996356000,
      30,
    );
    const orca = buildRuntimeShipEntity(
      scene,
      "Orca",
      996356000,
      9635601,
      { x: 0, y: 0, z: 0 },
      [tractorBeam],
    );
    const wreck = buildRuntimeWreckEntity(scene, 996356050, {
      x: 20_000,
      y: 0,
      z: 0,
    });

    const { session: ownerSession, notifications: ownerNotifications } = attachSession(
      scene,
      orca,
      9635602,
      9635601,
    );
    scene.spawnDynamicEntity(wreck, { broadcast: false });

    const activationResult = scene.activateGenericModule(
      ownerSession,
      tractorBeam,
      "tractorBeamCan",
      { targetID: wreck.itemID },
    );
    assert.equal(activationResult.success, true);
    flushDirectDestinyNotifications(scene);

    advanceScene(scene, 1_200);
    flushDirectDestinyNotifications(scene);
    ownerNotifications.length = 0;

    const deactivateResult = scene.deactivateGenericModule(ownerSession, tractorBeam.itemID, {
      deferUntilCycle: false,
    });
    assert.equal(deactivateResult.success, true);
    flushDirectDestinyNotifications(scene);

    const movementUpdates = flattenDestinyUpdates(ownerNotifications)
      .filter((entry) => (
        (entry.name === "SetBallPosition" || entry.name === "SetBallVelocity" || entry.name === "Stop") &&
        Number(entry.args[0]) === wreck.itemID
      ));
    const positionUpdates = movementUpdates.filter((entry) => entry.name === "SetBallPosition");
    const velocityUpdates = movementUpdates.filter((entry) => entry.name === "SetBallVelocity");
    const stopUpdates = movementUpdates.filter((entry) => entry.name === "Stop");

    assert.equal(
      positionUpdates.length,
      0,
      `expected tractor stop to avoid a mid-pull position snap, got ${positionUpdates.length}`,
    );
    assert.ok(
      velocityUpdates.length >= 1,
      "expected tractor stop to zero the wreck velocity",
    );
    assert.ok(
      stopUpdates.length >= 1,
      "expected tractor stop to emit Stop for the wreck",
    );
  } finally {
    resetScenes();
  }
});

serialTest("wrecks bootstrap as movable free balls for tractor parity", () => {
  resetScenes();
  const scene = spaceRuntime.ensureScene(30000148);

  try {
    const wreck = buildRuntimeWreckEntity(scene, 996356150, {
      x: 20_000,
      y: 0,
      z: 0,
    });
    const ballDebug = destiny.debugDescribeEntityBall(wreck).summary;

    assert.equal(ballDebug.kind, "wreck");
    assert.equal(ballDebug.mode, "STOP");
    assert.equal(ballDebug.flags.isFree, true);
    assert.equal(ballDebug.flags.isInteractive, true);
    assert.equal(ballDebug.mass, 10_000);
  } finally {
    resetScenes();
  }
});

serialTest("local typeDogma seeds MJD jump distance for standard and capital drives", () => {
  assert.equal(getTypeAttributeValue(4383, "mjdJumpRange"), 100_000);
  assert.equal(getTypeAttributeValue(33915, "mjdJumpRange"), 100_000);
  assert.equal(getTypeAttributeValue(83465, "mjdJumpRange"), 250_000);
});

serialTest("Orca large micro jump drive matches client engage FX and 100 km jump behavior", () => {
  resetScenes();
  const scene = spaceRuntime.ensureScene(30000149);

  try {
    const microJumpDrive = buildFittedModule(
      "Large Micro Jump Drive",
      996450001,
      996450000,
      19,
    );
    const orca = buildRuntimeShipEntity(
      scene,
      "Orca",
      996450000,
      9645001,
      { x: 0, y: 0, z: 0 },
      [microJumpDrive],
      {
        direction: { x: 1, y: 0, z: 0 },
      },
    );

    const { session: ownerSession, notifications: ownerNotifications } = attachSession(
      scene,
      orca,
      9646001,
      9645001,
    );

    const activationResult = scene.activateGenericModule(
      ownerSession,
      microJumpDrive,
      "microJumpDrive",
    );
    assert.equal(activationResult.success, true);
    flushDirectDestinyNotifications(scene);

    const effectState = orca.activeModuleEffects.get(microJumpDrive.itemID);
    assert.ok(effectState);
    assert.equal(effectState.microJumpDriveEffect, true);
    assert.equal(effectState.guid, "effects.MicroJumpDriveEngage");
    assert.equal(effectState.microJumpJumpFxGuid, "effects.MicroJumpDriveJump");
    assert.equal(Number(effectState.microJumpDistanceMeters), 100_000);

    const engageFx = getSpecialFxEvents(ownerNotifications, "effects.MicroJumpDriveEngage")
      .find((entry) => Number(entry.args[7]) === 1 && Number(entry.args[8]) === 1);
    assertSpecialFxPayload(engageFx, {
      moduleID: microJumpDrive.itemID,
      moduleTypeID: microJumpDrive.typeID,
      targetID: null,
      chargeTypeID: null,
      guid: "effects.MicroJumpDriveEngage",
      isOffensive: false,
      start: true,
      active: true,
      duration: effectState.durationMs,
    });
    assert.equal(getGodmaEffectNotifications(ownerNotifications, microJumpDrive.itemID, true).length, 1);

    advanceSceneUntilSimTime(scene, effectState.nextCycleAtMs, 50);
    flushDirectDestinyNotifications(scene);

    const jumpFx = getSpecialFxEvents(ownerNotifications, "effects.MicroJumpDriveJump")
      .find((entry) => Number(entry.args[7]) === 1 && Number(entry.args[8]) === 0);
    assert.ok(jumpFx, "expected one-shot micro jump drive jump FX");

    const graphicInfoItems = getMarshalListItems(jumpFx.args[13]);
    assert.equal(graphicInfoItems.length, 3, "expected client list-style graphicInfo");
    assert.ok(Math.abs(Number(orca.position.x) - 100_000) <= 1, "expected 100 km forward jump");
    assert.ok(Math.abs(Number(graphicInfoItems[0]) - Number(orca.position.x)) <= 1);
    assert.ok(Math.abs(Number(graphicInfoItems[1]) - Number(orca.position.y)) <= 1);
    assert.ok(Math.abs(Number(graphicInfoItems[2]) - Number(orca.position.z)) <= 1);

    const engageStopFx = getSpecialFxEvents(ownerNotifications, "effects.MicroJumpDriveEngage")
      .find((entry) => Number(entry.args[7]) === 0 && Number(entry.args[8]) === 0);
    assert.equal(engageStopFx, undefined, "expected no engage stop FX replay");
    assert.ok(getGodmaEffectNotifications(ownerNotifications, microJumpDrive.itemID, false).length >= 1);
    assert.equal(orca.activeModuleEffects.has(microJumpDrive.itemID), false);
  } finally {
    resetScenes();
  }
});

serialTest("Orca capital micro jump drive matches client engage FX and jump payload shape", () => {
  resetScenes();
  const scene = spaceRuntime.ensureScene(30000149);

  try {
    const microJumpDrive = buildFittedModule(
      "Capital Micro Jump Drive",
      996400001,
      996400000,
      19,
    );
    const orca = buildRuntimeShipEntity(
      scene,
      "Orca",
      996400000,
      9640001,
      { x: 0, y: 0, z: 0 },
      [microJumpDrive],
      {
        direction: { x: 1, y: 0, z: 0 },
      },
    );

    const { session: ownerSession, notifications: ownerNotifications } = attachSession(
      scene,
      orca,
      9641001,
      9640001,
    );

    const activationResult = scene.activateGenericModule(
      ownerSession,
      microJumpDrive,
      "microJumpDrive",
    );
    assert.equal(activationResult.success, true);
    flushDirectDestinyNotifications(scene);

    const effectState = orca.activeModuleEffects.get(microJumpDrive.itemID);
    assert.ok(effectState);
    assert.equal(effectState.microJumpDriveEffect, true);
    assert.equal(effectState.guid, "effects.MicroJumpDriveEngage");
    assert.equal(effectState.microJumpJumpFxGuid, "effects.MicroJumpDriveJump");

    const engageFx = getSpecialFxEvents(ownerNotifications, "effects.MicroJumpDriveEngage")
      .find((entry) => Number(entry.args[7]) === 1 && Number(entry.args[8]) === 1);
    assertSpecialFxPayload(engageFx, {
      moduleID: microJumpDrive.itemID,
      moduleTypeID: microJumpDrive.typeID,
      targetID: null,
      chargeTypeID: null,
      guid: "effects.MicroJumpDriveEngage",
      isOffensive: false,
      start: true,
      active: true,
      duration: effectState.durationMs,
    });
    assert.equal(getGodmaEffectNotifications(ownerNotifications, microJumpDrive.itemID, true).length, 1);

    advanceSceneUntilSimTime(scene, effectState.nextCycleAtMs, 50);
    flushDirectDestinyNotifications(scene);

    const jumpFx = getSpecialFxEvents(ownerNotifications, "effects.MicroJumpDriveJump")
      .find((entry) => Number(entry.args[7]) === 1 && Number(entry.args[8]) === 0);
    assert.ok(jumpFx, "expected one-shot micro jump drive jump FX");

    const graphicInfoItems = getMarshalListItems(jumpFx.args[13]);
    assert.equal(graphicInfoItems.length, 3, "expected client list-style graphicInfo");
    assert.ok(Math.abs(Number(orca.position.x) - 250_000) <= 1, "expected 250 km forward jump");
    assert.ok(Math.abs(Number(graphicInfoItems[0]) - Number(orca.position.x)) <= 1);
    assert.ok(Math.abs(Number(graphicInfoItems[1]) - Number(orca.position.y)) <= 1);
    assert.ok(Math.abs(Number(graphicInfoItems[2]) - Number(orca.position.z)) <= 1);

    const engageStopFx = getSpecialFxEvents(ownerNotifications, "effects.MicroJumpDriveEngage")
      .find((entry) => Number(entry.args[7]) === 0 && Number(entry.args[8]) === 0);
    assert.equal(engageStopFx, undefined, "expected no engage stop FX replay");
    assert.ok(getGodmaEffectNotifications(ownerNotifications, microJumpDrive.itemID, false).length >= 1);
    assert.equal(orca.activeModuleEffects.has(microJumpDrive.itemID), false);
  } finally {
    resetScenes();
  }
});

serialTest("Medium Micro Jump Drive uses the same generic 100 km fallback and client FX shape", () => {
  resetScenes();
  const scene = spaceRuntime.ensureScene(30000150);

  try {
    const microJumpDrive = buildFittedModule(
      "Medium Micro Jump Drive",
      996500001,
      996500000,
      19,
    );
    const ship = buildRuntimeShipEntity(
      scene,
      "Osprey",
      996500000,
      9650001,
      { x: 0, y: 0, z: 0 },
      [microJumpDrive],
      {
        direction: { x: 1, y: 0, z: 0 },
      },
    );

    const { session: ownerSession, notifications: ownerNotifications } = attachSession(
      scene,
      ship,
      9651001,
      9650001,
    );

    const activationResult = scene.activateGenericModule(
      ownerSession,
      microJumpDrive,
      "microJumpDrive",
    );
    assert.equal(activationResult.success, true);
    flushDirectDestinyNotifications(scene);

    const effectState = ship.activeModuleEffects.get(microJumpDrive.itemID);
    assert.ok(effectState);
    assert.equal(effectState.microJumpDriveEffect, true);
    assert.equal(Number(effectState.microJumpDistanceMeters), 100_000);

    advanceSceneUntilSimTime(scene, effectState.nextCycleAtMs, 50);
    flushDirectDestinyNotifications(scene);

    const jumpFx = getSpecialFxEvents(ownerNotifications, "effects.MicroJumpDriveJump")
      .find((entry) => Number(entry.args[7]) === 1 && Number(entry.args[8]) === 0);
    assert.ok(jumpFx, "expected medium MJD jump FX");
    const graphicInfoItems = getMarshalListItems(jumpFx.args[13]);
    assert.equal(graphicInfoItems.length, 3);
    assert.ok(Math.abs(Number(ship.position.x) - 100_000) <= 1, "expected 100 km medium MJD jump");
  } finally {
    resetScenes();
  }
});

serialTest("XL missile launchers resolve the correct generic missile family and client FX GUIDs", () => {
  const xlTorpedoLauncher = buildFittedModule("XL Torpedo Launcher I", 996600001, 996600000, 27);
  const xlTorpedoCharge = buildInventoryCharge("Scourge XL Torpedo", 996600002, 996600000);
  const xlCruiseLauncher = buildFittedModule("XL Cruise Missile Launcher I", 996600003, 996600000, 28);
  const xlCruiseCharge = buildInventoryCharge("Scourge XL Cruise Missile", 996600004, 996600000);
  const phoenix = buildShipItem("Phoenix", 996600000);

  const xlTorpedoSnapshot = buildWeaponModuleSnapshot({
    shipItem: phoenix,
    moduleItem: xlTorpedoLauncher,
    chargeItem: xlTorpedoCharge,
    fittedItems: [xlTorpedoLauncher],
    skillMap: new Map(),
    activeModuleContexts: [],
  });
  assert.ok(xlTorpedoSnapshot, "expected XL torpedo launcher snapshot");
  assert.equal(xlTorpedoSnapshot.family, "missileLauncher");
  assert.equal(xlTorpedoSnapshot.effectGUID, "effects.TorpedoDeployment");

  const xlCruiseSnapshot = buildWeaponModuleSnapshot({
    shipItem: phoenix,
    moduleItem: xlCruiseLauncher,
    chargeItem: xlCruiseCharge,
    fittedItems: [xlCruiseLauncher],
    skillMap: new Map(),
    activeModuleContexts: [],
  });
  assert.ok(xlCruiseSnapshot, "expected XL cruise launcher snapshot");
  assert.equal(xlCruiseSnapshot.family, "missileLauncher");
  assert.equal(xlCruiseSnapshot.effectGUID, "effects.MissileDeployment");
});

serialTest("capital turrets stay on the generic turret-family resolver", () => {
  const cases = [
    ["Dual Giga Beam Laser I", "laserTurret"],
    ["Dual 1000mm Railgun I", "hybridTurret"],
    ["Quad 800mm Repeating Cannon I", "projectileTurret"],
  ];

  cases.forEach(([moduleName, expectedFamily], index) => {
    const moduleItem = buildFittedModule(moduleName, 996700000 + index, 996700000, 27);
    assert.equal(
      resolveWeaponFamily(moduleItem, null),
      expectedFamily,
      `expected ${moduleName} to resolve as ${expectedFamily}`,
    );
  });
});
