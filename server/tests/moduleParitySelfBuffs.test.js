const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const {
  buildWeaponModuleSnapshot,
} = require(path.join(repoRoot, "server/src/space/combat/weaponDogma"));
const {
  buildInventoryItem,
} = require(path.join(repoRoot, "server/src/services/inventory/itemStore"));
const {
  resolveItemByName,
} = require(path.join(repoRoot, "server/src/services/inventory/itemTypeRegistry"));
const {
  buildShipResourceState,
  getAttributeIDByNames,
  getTypeDogmaEffects,
  getEffectTypeRecord,
} = require(path.join(repoRoot, "server/src/services/fitting/liveFittingState"));

const ATTRIBUTE_MAX_TARGET_RANGE = getAttributeIDByNames("maxTargetRange") || 76;
const ATTRIBUTE_SCAN_RESOLUTION = getAttributeIDByNames("scanResolution") || 564;
const ATTRIBUTE_SHIELD_EM_RESONANCE =
  getAttributeIDByNames("shieldEmDamageResonance") || 271;
const ACTIVATABLE_EFFECT_CATEGORIES = new Set([1, 2, 3]);
const PASSIVE_SLOT_EFFECTS = new Set([
  "online",
  "hipower",
  "medpower",
  "lopower",
  "rigslot",
  "subsystem",
  "turretfitted",
  "launcherfitted",
]);

function resolveExactItem(name) {
  const result = resolveItemByName(name);
  assert.equal(result && result.success, true, `Expected item '${name}' to exist`);
  return result.match;
}

function resolveActivationEffectRecord(typeID) {
  for (const effectID of getTypeDogmaEffects(typeID)) {
    const effectRecord = getEffectTypeRecord(effectID);
    if (
      !effectRecord ||
      !ACTIVATABLE_EFFECT_CATEGORIES.has(Number(effectRecord.effectCategoryID) || 0)
    ) {
      continue;
    }

    const normalizedName = String(effectRecord.name || "").toLowerCase();
    if (PASSIVE_SLOT_EFFECTS.has(normalizedName)) {
      continue;
    }

    return effectRecord;
  }

  return null;
}

function buildShipItem(typeName, itemID = 980000001) {
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

function attachSession(scene, entity, clientID) {
  const notifications = [];
  const session = {
    clientID,
    characterID: 0,
    _space: {
      systemID: scene.systemID,
      shipID: entity.itemID,
      initialStateSent: true,
      visibleDynamicEntityIDs: new Set(),
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
  scene.spawnDynamicEntity(entity, { broadcast: false });
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

test.afterEach(() => {
  spaceRuntime._testing.clearScenes();
});

test("passive ship resource state no longer leaks active self-buff modules", () => {
  const shipItem = buildShipItem("Rokh");
  const sensorBooster = buildFittedModule(
    "Sensor Booster II",
    980100001,
    shipItem.itemID,
    19,
  );
  const shieldHardener = buildFittedModule(
    "EM Shield Hardener II",
    980100002,
    shipItem.itemID,
    20,
  );
  const damageControl = buildFittedModule(
    "Damage Control II",
    980100003,
    shipItem.itemID,
    11,
  );

  const baseline = buildShipResourceState(0, shipItem, { fittedItems: [] });
  const sensorBoosterState = buildShipResourceState(0, shipItem, {
    fittedItems: [sensorBooster],
  });
  const shieldHardenerState = buildShipResourceState(0, shipItem, {
    fittedItems: [shieldHardener],
  });
  const damageControlState = buildShipResourceState(0, shipItem, {
    fittedItems: [damageControl],
  });

  assert.equal(sensorBoosterState.maxTargetRange, baseline.maxTargetRange);
  assert.equal(sensorBoosterState.scanResolution, baseline.scanResolution);
  assert.equal(
    shieldHardenerState.attributes[ATTRIBUTE_SHIELD_EM_RESONANCE],
    baseline.attributes[ATTRIBUTE_SHIELD_EM_RESONANCE],
  );
  assert.ok(
    damageControlState.attributes[ATTRIBUTE_SHIELD_EM_RESONANCE] <
      baseline.attributes[ATTRIBUTE_SHIELD_EM_RESONANCE],
    "Expected passive damage control bonuses to remain applied",
  );
});

test("tracking computers only affect turret snapshots while actively running", () => {
  const shipItem = buildShipItem("Rokh");
  const railgun = buildFittedModule(
    "425mm Railgun II",
    980200001,
    shipItem.itemID,
    27,
  );
  const trackingComputer = buildFittedModule(
    "Tracking Computer II",
    980200002,
    shipItem.itemID,
    19,
  );
  const trackingEffectRecord = resolveActivationEffectRecord(trackingComputer.typeID);
  assert.ok(trackingEffectRecord, "Expected tracking computer activation effect");

  const baselineSnapshot = buildWeaponModuleSnapshot({
    characterID: 0,
    shipItem,
    moduleItem: railgun,
    fittedItems: [railgun, trackingComputer],
    skillMap: new Map(),
  });
  const activeSnapshot = buildWeaponModuleSnapshot({
    characterID: 0,
    shipItem,
    moduleItem: railgun,
    fittedItems: [railgun, trackingComputer],
    skillMap: new Map(),
    activeModuleContexts: [{
      moduleItem: trackingComputer,
      effectRecord: trackingEffectRecord,
    }],
  });

  assert.ok(baselineSnapshot, "Expected baseline railgun snapshot");
  assert.ok(activeSnapshot, "Expected active railgun snapshot");
  assert.ok(activeSnapshot.optimalRange > baselineSnapshot.optimalRange);
  assert.ok(activeSnapshot.falloff > baselineSnapshot.falloff);
  assert.ok(activeSnapshot.trackingSpeed > baselineSnapshot.trackingSpeed);
});

test("missile guidance computers only affect missile snapshots while actively running", () => {
  const shipItem = buildShipItem("Rokh");
  const heavyMissileLauncher = buildFittedModule(
    "Heavy Missile Launcher II",
    980250001,
    shipItem.itemID,
    27,
  );
  const missileGuidanceComputer = buildFittedModule(
    "Missile Guidance Computer II",
    980250002,
    shipItem.itemID,
    19,
  );
  const scourgeHeavyMissile = buildInventoryItem({
    itemID: 980250003,
    typeID: resolveExactItem("Scourge Heavy Missile").typeID,
    ownerID: 9000001,
    locationID: shipItem.itemID,
    flagID: heavyMissileLauncher.flagID,
    singleton: 0,
    quantity: 100,
    stacksize: 100,
  });
  const guidanceEffectRecord = resolveActivationEffectRecord(
    missileGuidanceComputer.typeID,
  );
  assert.ok(guidanceEffectRecord, "Expected missile guidance computer activation effect");

  const baselineSnapshot = buildWeaponModuleSnapshot({
    characterID: 0,
    shipItem,
    moduleItem: heavyMissileLauncher,
    chargeItem: scourgeHeavyMissile,
    fittedItems: [heavyMissileLauncher, missileGuidanceComputer],
    skillMap: new Map(),
  });
  const activeSnapshot = buildWeaponModuleSnapshot({
    characterID: 0,
    shipItem,
    moduleItem: heavyMissileLauncher,
    chargeItem: scourgeHeavyMissile,
    fittedItems: [heavyMissileLauncher, missileGuidanceComputer],
    skillMap: new Map(),
    activeModuleContexts: [{
      moduleItem: missileGuidanceComputer,
      effectRecord: guidanceEffectRecord,
    }],
  });

  assert.ok(baselineSnapshot, "Expected baseline missile snapshot");
  assert.ok(activeSnapshot, "Expected active missile snapshot");
  assert.ok(activeSnapshot.approxRange > baselineSnapshot.approxRange);
  assert.ok(activeSnapshot.maxVelocity > baselineSnapshot.maxVelocity);
  assert.ok(activeSnapshot.flightTimeMs > baselineSnapshot.flightTimeMs);
  assert.ok(activeSnapshot.explosionVelocity > baselineSnapshot.explosionVelocity);
  assert.ok(activeSnapshot.explosionRadius < baselineSnapshot.explosionRadius);
});

test("runtime active self-buffs apply on activation and clear on deactivation", () => {
  const shipItem = buildShipItem("Rokh", 980300001);
  const sensorBooster = buildFittedModule(
    "Sensor Booster II",
    980300011,
    shipItem.itemID,
    19,
  );
  const shieldHardener = buildFittedModule(
    "EM Shield Hardener II",
    980300012,
    shipItem.itemID,
    20,
  );

  const scene = spaceRuntime.ensureScene(30000142);
  const entity = spaceRuntime._testing.buildRuntimeShipEntityForTesting({
    itemID: shipItem.itemID,
    typeID: shipItem.typeID,
    groupID: shipItem.groupID,
    categoryID: shipItem.categoryID,
    itemName: shipItem.itemName,
    ownerID: shipItem.ownerID,
    radius: shipItem.radius,
    conditionState: shipItem.conditionState,
    fittedItems: [sensorBooster, shieldHardener],
  }, scene.systemID);
  const attached = attachSession(scene, entity, 83001);

  const baselineRange = entity.maxTargetRange;
  const baselineScanResolution = entity.scanResolution;
  const baselineShieldEmResonance =
    entity.passiveDerivedState.attributes[ATTRIBUTE_SHIELD_EM_RESONANCE];

  let activationResult = scene.activateGenericModule(
    attached.session,
    sensorBooster,
  );
  assert.equal(activationResult.success, true);
  assert.ok(entity.maxTargetRange > baselineRange);
  assert.ok(entity.scanResolution > baselineScanResolution);

  const sensorBoosterChanges = flattenAttributeChanges(attached.notifications)
    .filter((change) => Number(change[2]) === shipItem.itemID);
  assert.ok(
    sensorBoosterChanges.some((change) => Number(change[3]) === ATTRIBUTE_MAX_TARGET_RANGE),
    "Expected live max target range update on activation",
  );
  assert.ok(
    sensorBoosterChanges.some((change) => Number(change[3]) === ATTRIBUTE_SCAN_RESOLUTION),
    "Expected live scan resolution update on activation",
  );

  attached.notifications.length = 0;
  let deactivateResult = scene.deactivateGenericModule(
    attached.session,
    sensorBooster.itemID,
    { deferUntilCycle: false },
  );
  assert.equal(deactivateResult.success, true);
  assert.equal(entity.maxTargetRange, baselineRange);
  assert.equal(entity.scanResolution, baselineScanResolution);

  activationResult = scene.activateGenericModule(
    attached.session,
    shieldHardener,
  );
  assert.equal(activationResult.success, true);
  assert.ok(
    entity.passiveDerivedState.attributes[ATTRIBUTE_SHIELD_EM_RESONANCE] <
      baselineShieldEmResonance,
  );

  deactivateResult = scene.deactivateGenericModule(
    attached.session,
    shieldHardener.itemID,
    { deferUntilCycle: false },
  );
  assert.equal(deactivateResult.success, true);
  assert.equal(
    entity.passiveDerivedState.attributes[ATTRIBUTE_SHIELD_EM_RESONANCE],
    baselineShieldEmResonance,
  );
});

test("active self-buff families emit the expected owner and observer OnSpecialFX start/stop packets", () => {
  const cases = [
    {
      label: "shield hardener",
      moduleName: "EM Shield Hardener II",
      flagID: 19,
      guid: "effects.ModifyShieldResonance",
    },
    {
      label: "armor hardener",
      moduleName: "EM Armor Hardener II",
      flagID: 11,
      guid: "effects.ArmorHardening",
    },
    {
      label: "sensor booster",
      moduleName: "Sensor Booster II",
      flagID: 20,
      guid: "effects.ElectronicAttributeModifyActivate",
    },
    {
      label: "tracking computer",
      moduleName: "Tracking Computer II",
      flagID: 21,
      guid: "effects.TurretWeaponRangeTrackingSpeedMultiplyActivate",
    },
    {
      label: "missile guidance computer",
      moduleName: "Missile Guidance Computer II",
      flagID: 22,
      guid: "effects.TurretWeaponRangeTrackingSpeedMultiplyActivate",
    },
  ];

  for (const [index, testCase] of cases.entries()) {
    const scene = spaceRuntime.ensureScene(30000142);
    const shipItem = buildShipItem("Rokh", 980400001 + (index * 100));
    const moduleItem = buildFittedModule(
      testCase.moduleName,
      980400011 + (index * 100),
      shipItem.itemID,
      testCase.flagID,
    );
    const ownerEntity = spaceRuntime._testing.buildRuntimeShipEntityForTesting({
      itemID: shipItem.itemID,
      typeID: shipItem.typeID,
      groupID: shipItem.groupID,
      categoryID: shipItem.categoryID,
      itemName: shipItem.itemName,
      ownerID: shipItem.ownerID,
      radius: shipItem.radius,
      conditionState: shipItem.conditionState,
      fittedItems: [moduleItem],
    }, scene.systemID);
    const observerShipItem = buildShipItem("Rokh", shipItem.itemID + 50);
    const observerEntity = spaceRuntime._testing.buildRuntimeShipEntityForTesting({
      itemID: observerShipItem.itemID,
      typeID: observerShipItem.typeID,
      groupID: observerShipItem.groupID,
      categoryID: observerShipItem.categoryID,
      itemName: observerShipItem.itemName,
      ownerID: observerShipItem.ownerID,
      radius: observerShipItem.radius,
      position: { x: 500, y: 0, z: 0 },
      conditionState: observerShipItem.conditionState,
    }, scene.systemID);
    const owner = attachSession(scene, ownerEntity, 84001 + index);
    const observer = attachSession(scene, observerEntity, 85001 + index);

    owner.notifications.length = 0;
    observer.notifications.length = 0;

    const activationResult = scene.activateGenericModule(owner.session, moduleItem);
    assert.equal(activationResult.success, true, `expected ${testCase.label} activation to succeed`);
    const effectState = activationResult.data.effectState;

    const ownerStartFx = getSpecialFxEvents(owner.notifications, testCase.guid);
    const observerStartFx = getSpecialFxEvents(observer.notifications, testCase.guid);
    assert.equal(ownerStartFx.length, 1, `expected one owner start FX for ${testCase.label}`);
    assert.equal(observerStartFx.length, 1, `expected one observer start FX for ${testCase.label}`);
    assertSpecialFxPayload(ownerStartFx[0], {
      moduleID: moduleItem.itemID,
      moduleTypeID: moduleItem.typeID,
      targetID: null,
      chargeTypeID: null,
      guid: testCase.guid,
      isOffensive: false,
      start: true,
      active: true,
      duration: effectState.durationMs,
      repeat: null,
    });
    assertSpecialFxPayload(observerStartFx[0], {
      moduleID: moduleItem.itemID,
      moduleTypeID: moduleItem.typeID,
      targetID: null,
      chargeTypeID: null,
      guid: testCase.guid,
      isOffensive: false,
      start: true,
      active: true,
      duration: effectState.durationMs,
      repeat: null,
    });

    owner.notifications.length = 0;
    observer.notifications.length = 0;

    const deactivateResult = scene.deactivateGenericModule(owner.session, moduleItem.itemID);
    assert.equal(deactivateResult.success, true, `expected ${testCase.label} deactivation to succeed`);
    const stopAtMs = Number(
      (deactivateResult.data && deactivateResult.data.deactivateAtMs) ||
      (deactivateResult.data && deactivateResult.data.stoppedAtMs) ||
      0,
    );
    if (stopAtMs > scene.getCurrentSimTimeMs()) {
      advanceSceneUntilSimTime(scene, stopAtMs, 100);
    }

    const ownerStopFx = getSpecialFxEvents(owner.notifications, testCase.guid)
      .filter((entry) => Number(entry.args[7]) === 0);
    const observerStopFx = getSpecialFxEvents(observer.notifications, testCase.guid)
      .filter((entry) => Number(entry.args[7]) === 0);
    assert.equal(ownerStopFx.length, 1, `expected one owner stop FX for ${testCase.label}`);
    assert.equal(observerStopFx.length, 1, `expected one observer stop FX for ${testCase.label}`);
    assertSpecialFxPayload(ownerStopFx[0], {
      moduleID: moduleItem.itemID,
      moduleTypeID: moduleItem.typeID,
      targetID: null,
      chargeTypeID: null,
      guid: testCase.guid,
      isOffensive: false,
      start: false,
      active: false,
      duration: effectState.durationMs,
      repeat: null,
    });
    assertSpecialFxPayload(observerStopFx[0], {
      moduleID: moduleItem.itemID,
      moduleTypeID: moduleItem.typeID,
      targetID: null,
      chargeTypeID: null,
      guid: testCase.guid,
      isOffensive: false,
      start: false,
      active: false,
      duration: effectState.durationMs,
      repeat: null,
    });
  }
});

test("generic self-buff FX clamp to the owner's visible stamp under TiDi on start and stop", () => {
  const shipItem = buildShipItem("Rokh", 980500001);
  const shieldHardener = buildFittedModule(
    "EM Shield Hardener II",
    980500011,
    shipItem.itemID,
    19,
  );

  const scene = spaceRuntime.ensureScene(30000142);
  const entity = spaceRuntime._testing.buildRuntimeShipEntityForTesting({
    itemID: shipItem.itemID,
    typeID: shipItem.typeID,
    groupID: shipItem.groupID,
    categoryID: shipItem.categoryID,
    itemName: shipItem.itemName,
    ownerID: shipItem.ownerID,
    radius: shipItem.radius,
    conditionState: shipItem.conditionState,
    fittedItems: [shieldHardener],
  }, scene.systemID);
  const attached = attachSession(scene, entity, 86001);

  scene.setTimeDilation(0.5, {
    syncSessions: false,
  });
  scene.tick(scene.getCurrentWallclockMs() + 4000);

  attached.notifications.length = 0;
  const startVisibleStamp = scene.getCurrentVisibleSessionDestinyStamp(attached.session);
  const activationResult = scene.activateGenericModule(
    attached.session,
    shieldHardener,
  );
  assert.equal(activationResult.success, true);

  const startFx = getSpecialFxEvents(attached.notifications, "effects.ModifyShieldResonance");
  assert.equal(startFx.length, 1);
  assert.ok(
    Number(startFx[0].stamp) >= Number(startVisibleStamp),
    "expected generic self-buff start FX to clamp to the owner's visible stamp under TiDi",
  );

  attached.notifications.length = 0;
  const deactivateResult = scene.deactivateGenericModule(
    attached.session,
    shieldHardener.itemID,
  );
  assert.equal(deactivateResult.success, true);
  const stopVisibleStamp = scene.getCurrentVisibleSessionDestinyStamp(attached.session);
  const stopAtMs = Number(
    (deactivateResult.data && deactivateResult.data.deactivateAtMs) ||
    (deactivateResult.data && deactivateResult.data.stoppedAtMs) ||
    0,
  );
  if (stopAtMs > scene.getCurrentSimTimeMs()) {
    advanceSceneUntilSimTime(scene, stopAtMs, 100);
  }

  const stopFx = getSpecialFxEvents(attached.notifications, "effects.ModifyShieldResonance")
    .filter((entry) => Number(entry.args[7]) === 0);
  assert.equal(stopFx.length, 1);
  assert.ok(
    Number(stopFx[0].stamp) >= Number(stopVisibleStamp),
    "expected generic self-buff stop FX to clamp to the owner's visible stamp under TiDi",
  );
});
