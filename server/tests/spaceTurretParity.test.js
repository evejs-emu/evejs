const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const {
  resolveItemByTypeID,
} = require(path.join(repoRoot, "server/src/services/inventory/itemTypeRegistry"));

const DEFAULT_PASSIVE_STATE = Object.freeze({
  mass: 1_000_000,
  agility: 0.5,
  maxVelocity: 300,
  maxTargetRange: 250_000,
  maxLockedTargets: 7,
  signatureRadius: 50,
  scanResolution: 500,
  cloakingTargetingDelay: 0,
  capacitorCapacity: 5_000,
  capacitorRechargeRate: 1_000,
  shieldCapacity: 1_000,
  shieldRechargeRate: 1_000,
  armorHP: 1_000,
  structureHP: 1_000,
});

function buildShipEntity(scene, itemID, x, options = {}) {
  return spaceRuntime._testing.buildRuntimeShipEntityForTesting({
    itemID,
    typeID: options.typeID ?? 606,
    characterID: options.characterID ?? 0,
    position: options.position ?? { x, y: 0, z: 0 },
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
      timeDilation: scene.getTimeDilation(),
      simTimeMs: scene.getCurrentSimTimeMs(),
      simFileTime: scene.getCurrentFileTime(),
    },
    socket: { destroyed: false },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };

  entity.session = session;
  scene.spawnDynamicEntity(entity, { broadcast: false });
  scene.sessions.set(clientID, session);
  return { session, notifications };
}

function buildModuleItem(typeID, itemID, flagID, shipID) {
  const type = resolveItemByTypeID(typeID);
  assert.ok(type, `Expected module type ${typeID} to exist`);
  return {
    itemID,
    ownerID: 0,
    locationID: shipID,
    flagID,
    typeID: type.typeID,
    groupID: Number(type.groupID || 0),
    categoryID: Number(type.categoryID || 0),
    itemName: type.name,
    singleton: true,
    moduleState: {
      online: true,
      damage: 0,
      charge: 0,
      armorDamage: 0,
      shieldCharge: 0,
      incapacitated: false,
    },
  };
}

function buildChargeItem(typeID, itemID, moduleID, quantity = 2) {
  const type = resolveItemByTypeID(typeID);
  assert.ok(type, `Expected charge type ${typeID} to exist`);
  return {
    itemID,
    ownerID: 0,
    locationID: 0,
    moduleID,
    typeID: type.typeID,
    groupID: Number(type.groupID || 0),
    categoryID: Number(type.categoryID || 0),
    itemName: type.name,
    quantity,
    stacksize: quantity,
    singleton: false,
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
    const entries = Array.isArray(payloadList && payloadList.items)
      ? payloadList.items
      : [];
    for (const entry of entries) {
      const payload = Array.isArray(entry) ? entry[1] : null;
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

function getDestinyEvents(notifications = [], eventName) {
  return notifications
    .filter((notification) => (
      notification &&
      notification.name === "DoDestinyUpdate" &&
      Array.isArray(notification.payload)
    ))
    .flatMap((notification) => {
      const payloadList = notification.payload[0];
      const entries = Array.isArray(payloadList && payloadList.items)
        ? payloadList.items
        : [];
      return entries
        .filter((entry) => (
          Array.isArray(entry) &&
          entry[1] &&
          entry[1][0] === eventName &&
          Array.isArray(entry[1][1])
        ))
        .map((entry) => ({
          stamp: Number(entry[0]) || 0,
          args: entry[1][1],
        }));
    });
}

function getSpecialFxEvents(notifications = [], guid) {
  return getDestinyEvents(notifications, "OnSpecialFX").filter(
    (entry) => String(entry.args[5] || "") === String(guid),
  );
}

function extractOnItemChangeRows(notifications = []) {
  return notifications
    .filter((notification) => notification && notification.name === "OnItemChange")
    .map((notification) => {
      const payload = Array.isArray(notification.payload) ? notification.payload[0] : null;
      return payload &&
        payload.type === "packedrow" &&
        payload.fields &&
        typeof payload.fields === "object"
        ? payload.fields
        : null;
    })
    .filter(Boolean);
}

function extractOnItemChangeItemIDs(notifications = []) {
  return extractOnItemChangeRows(notifications)
    .map((fields) => fields.itemID)
    .filter(Boolean);
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

function advanceScene(scene, deltaMs) {
  const baseWallclock = Number(scene.lastWallclockTickAt) || scene.getCurrentWallclockMs();
  scene.tick(baseWallclock + Math.max(0, Number(deltaMs) || 0));
}

function findTupleRow(notifications, shipID, flagID, typeID, locationID = null) {
  return extractOnItemChangeRows(notifications).find((fields) => (
    Array.isArray(fields.itemID) &&
    Number(fields.itemID[0]) === Number(shipID) &&
    Number(fields.itemID[1]) === Number(flagID) &&
    Number(fields.itemID[2]) === Number(typeID) &&
    (
      locationID === null ||
      Number(fields.locationID) === Number(locationID)
    )
  )) || null;
}

function buildNativeTurretScenario({
  moduleTypeID,
  chargeTypeID,
  attackerID,
  moduleID,
  chargeID,
  targetID,
} = {}) {
  const scene = spaceRuntime.ensureScene(30000142);
  const attacker = buildShipEntity(scene, attackerID, -1_500);
  const moduleItem = buildModuleItem(moduleTypeID, moduleID, 27, attacker.itemID);
  const chargeItem = buildChargeItem(chargeTypeID, chargeID, moduleItem.itemID, 2);
  attacker.nativeNpc = true;
  attacker.fittedItems = [moduleItem];
  attacker.nativeCargoItems = [chargeItem];
  attacker.skillMap = new Map();

  const attackerSession = attachSession(scene, attacker, attackerID + 1000);

  const target = buildShipEntity(scene, targetID, 1_500, {
    passiveResourceState: {
      ...DEFAULT_PASSIVE_STATE,
      shieldCapacity: 300,
      armorHP: 300,
      structureHP: 300,
    },
  });
  scene.spawnDynamicEntity(target, { broadcast: false });

  const lockResult = scene.finalizeTargetLock(attacker, target, {
    nowMs: scene.getCurrentSimTimeMs(),
  });
  assert.equal(lockResult.success, true, "expected attacker to lock the target");

  return {
    scene,
    attacker,
    attackerSession,
    target,
    moduleItem,
    chargeItem,
  };
}

function runTurretParityScenario({
  moduleTypeID,
  chargeTypeID,
  expectedFamily,
} = {}) {
  const {
    scene,
    attacker,
    attackerSession,
    target,
    moduleItem,
    chargeItem,
  } = buildNativeTurretScenario({
    moduleTypeID,
    chargeTypeID,
    attackerID: 990700001 + moduleTypeID,
    moduleID: 990710001 + moduleTypeID,
    chargeID: 990720001 + chargeTypeID,
    targetID: 990730001 + moduleTypeID,
  });

  attackerSession.notifications.length = 0;
  const broadcastSpecialFxCalls = [];
  const originalBroadcastSpecialFx = scene.broadcastSpecialFx.bind(scene);
  const originalRandom = Math.random;
  try {
    scene.broadcastSpecialFx = (shipID, guid, options = {}, visibilityEntity = null) => {
      broadcastSpecialFxCalls.push({
        shipID,
        guid,
        options: { ...options },
        visibilityEntity,
      });
      return originalBroadcastSpecialFx(shipID, guid, options, visibilityEntity);
    };
    Math.random = () => 0.5;

    const activationResult = scene.activateGenericModule(
      attackerSession.session,
      moduleItem,
      null,
      {
        targetID: target.itemID,
        repeat: 1000,
      },
    );
    assert.equal(activationResult.success, true, "expected turret activation to succeed");

    const effectState = scene.getActiveModuleEffect(attacker.itemID, moduleItem.itemID);
    assert.ok(effectState, "expected turret effect to stay active after the first shot");
    assert.equal(effectState.weaponFamily, expectedFamily);
    assert.equal(effectState.guid, "effects.ProjectileFired");

    assert.equal(
      attacker.nativeCargoItems.length,
      1,
      "expected the first shot to keep one stack entry loaded",
    );
    assert.equal(
      Number(attacker.nativeCargoItems[0].quantity || attacker.nativeCargoItems[0].stacksize || 0),
      1,
      "expected the first shot to consume exactly one round",
    );
    assert.equal(
      extractOnItemChangeItemIDs(attackerSession.notifications).includes(Number(chargeItem.itemID)),
      false,
      "expected live turret ammo to stay on tuple-backed HUD rows instead of real charge itemIDs",
    );
    const firstTupleRow = findTupleRow(
      attackerSession.notifications,
      attacker.itemID,
      moduleItem.flagID,
      chargeItem.typeID,
      attacker.itemID,
    );
    assert.ok(firstTupleRow, "expected the first shot to emit a tuple-backed ammo row update");
    assert.equal(
      Number(firstTupleRow.stacksize || 0),
      1,
      "expected the first tuple-backed ammo row to show one charge remaining",
    );
    assert.ok(
      (Number(target.conditionState.shieldCharge) || 0) < 1,
      "expected the first shot to apply immediately on activation",
    );
    assert.equal(
      attackerSession.notifications.some(
        (notification) =>
          notification &&
          notification.name === "OnDamageMessage" &&
          Array.isArray(notification.payload) &&
          Number(getMarshalDictEntry(notification.payload[0], "target")) === Number(target.itemID),
      ),
      true,
      "expected the firing session to receive combat feedback for turret shots",
    );
    assert.equal(
      flattenDestinyUpdates(attackerSession.notifications).some(
        (entry) =>
          entry.name === "OnDamageStateChange" &&
          Number(entry.args[0]) === Number(target.itemID),
      ),
      true,
      "expected turret hits to publish Michelle-shaped damage-state updates",
    );

    const cycleAdvanceMs = Math.max(Number(effectState.durationMs) || 0, 1_000) + 150;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!scene.getActiveModuleEffect(attacker.itemID, moduleItem.itemID)) {
        break;
      }
      advanceScene(scene, cycleAdvanceMs);
    }

    assert.equal(
      attacker.nativeCargoItems.length,
      0,
      "expected the last round to remove the loaded charge stack entry",
    );
    assert.equal(
      scene.getActiveModuleEffect(attacker.itemID, moduleItem.itemID),
      null,
      "expected the turret to stop after the last round is consumed",
    );
    const removedTupleRow = findTupleRow(
      attackerSession.notifications,
      attacker.itemID,
      moduleItem.flagID,
      chargeItem.typeID,
      6,
    );
    assert.ok(
      removedTupleRow,
      "expected empty-ammo shutdown to expel the tuple-backed charge row from the slot",
    );
    assert.equal(
      broadcastSpecialFxCalls.some(
        (entry) =>
          entry.guid === "effects.ProjectileFired" &&
          entry.options &&
          entry.options.start === true &&
          Number(entry.options.repeat) === 1000,
      ),
      true,
      "expected turret activation to preserve the repeating projectile FX contract",
    );
    assert.equal(
      broadcastSpecialFxCalls.some(
        (entry) =>
          entry.guid === "effects.ProjectileFired" &&
          entry.options &&
          entry.options.start === false &&
          Number(entry.options.moduleID) === Number(moduleItem.itemID) &&
          Number(entry.options.chargeTypeID) === Number(chargeItem.typeID),
      ),
      true,
      "expected empty-ammo shutdown to emit a stop FX packet with charge context intact",
    );
  } finally {
    scene.broadcastSpecialFx = originalBroadcastSpecialFx;
    Math.random = originalRandom;
  }
}

function runTurretTimeDilationFxScenario({
  moduleTypeID,
  chargeTypeID,
  expectedFamily,
} = {}) {
  const {
    scene,
    attacker,
    attackerSession,
    target,
    moduleItem,
  } = buildNativeTurretScenario({
    moduleTypeID,
    chargeTypeID,
    attackerID: 990740001 + moduleTypeID,
    moduleID: 990750001 + moduleTypeID,
    chargeID: 990760001 + chargeTypeID,
    targetID: 990770001 + moduleTypeID,
  });

  const broadcastSpecialFxCalls = [];
  const originalBroadcastSpecialFx = scene.broadcastSpecialFx.bind(scene);
  const originalRandom = Math.random;
  try {
    scene.broadcastSpecialFx = (shipID, guid, options = {}, visibilityEntity = null) => {
      broadcastSpecialFxCalls.push({
        shipID,
        guid,
        options: { ...options },
        visibilityEntity,
        sceneStampAtCall: scene.getCurrentDestinyStamp(),
      });
      return originalBroadcastSpecialFx(shipID, guid, options, visibilityEntity);
    };
    Math.random = () => 0.5;

    scene.setTimeDilation(0.25, {
      syncSessions: false,
    });
    scene.tick(scene.getCurrentWallclockMs() + 4_000);

    attackerSession.notifications.length = 0;
    const activationSceneStamp = scene.getCurrentDestinyStamp();
    const activationResult = scene.activateGenericModule(
      attackerSession.session,
      moduleItem,
      null,
      {
        targetID: target.itemID,
        repeat: 1000,
      },
    );
    assert.equal(activationResult.success, true, "expected TiDi turret activation to succeed");

    const activationCall = broadcastSpecialFxCalls.find(
      (entry) =>
        entry.guid === "effects.ProjectileFired" &&
        entry.options &&
        entry.options.start === true,
    );
    assert.ok(activationCall, "expected turret activation to emit an FX packet under TiDi");
    assert.equal(activationCall.options.useCurrentStamp, true);
    assert.equal(
      activationCall.sceneStampAtCall,
      activationSceneStamp,
      "expected turret activation to dispatch on the scene's live stamp under TiDi",
    );

    const activationFxEvents = getSpecialFxEvents(
      attackerSession.notifications,
      "effects.ProjectileFired",
    );
    assert.equal(activationFxEvents.length, 1);
    assert.equal(
      activationFxEvents[0].stamp,
      activationCall.sceneStampAtCall,
      "expected the delivered activation FX stamp to match the live scene stamp under TiDi",
    );
    assert.equal(
      scene.getCurrentDestinyStamp(),
      activationSceneStamp,
      "expected immediate turret FX dispatch to avoid mutating the scene clock under TiDi",
    );

    const effectState = scene.getActiveModuleEffect(attacker.itemID, moduleItem.itemID);
    assert.ok(effectState, "expected the TiDi turret effect to stay active after the first shot");
    assert.equal(effectState.weaponFamily, expectedFamily);

    attackerSession.notifications.length = 0;
    const tickAdvanceMs = Math.ceil(
      (Math.max(Number(effectState.durationMs) || 0, 1_000) + 150) /
      Math.max(scene.getTimeDilation(), 0.01),
    );
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!scene.getActiveModuleEffect(attacker.itemID, moduleItem.itemID)) {
        break;
      }
      advanceScene(scene, tickAdvanceMs);
    }

    const stopCall = [...broadcastSpecialFxCalls].reverse().find(
      (entry) =>
        entry.guid === "effects.ProjectileFired" &&
        entry.options &&
        entry.options.start === false &&
        Number(entry.options.moduleID) === Number(moduleItem.itemID),
    );
    assert.ok(stopCall, "expected empty-ammo shutdown to emit a stop FX packet under TiDi");
    assert.equal(stopCall.options.useCurrentStamp, true);
    assert.equal(
      scene.getActiveModuleEffect(attacker.itemID, moduleItem.itemID),
      null,
      "expected TiDi turret cycling to stop cleanly on empty ammo",
    );

    const stopFxEvents = getSpecialFxEvents(
      attackerSession.notifications,
      "effects.ProjectileFired",
    );
    assert.equal(stopFxEvents.length, 1);
    assert.equal(
      stopFxEvents[0].stamp,
      stopCall.sceneStampAtCall,
      "expected the delivered stop FX stamp to match the live scene stamp under TiDi",
    );
  } finally {
    scene.broadcastSpecialFx = originalBroadcastSpecialFx;
    Math.random = originalRandom;
  }
}

test.afterEach(() => {
  spaceRuntime._testing.clearScenes();
});

test("hybrid turrets consume stacked ammo, apply damage, and stop on empty ammo", () => {
  runTurretParityScenario({
    moduleTypeID: 3186, // Neutron Blaster Cannon II
    chargeTypeID: 238, // Antimatter Charge L
    expectedFamily: "hybridTurret",
  });
});

test("projectile turrets consume stacked ammo, apply damage, and stop on empty ammo", () => {
  runTurretParityScenario({
    moduleTypeID: 2913, // 425mm AutoCannon II
    chargeTypeID: 193, // EMP M
    expectedFamily: "projectileTurret",
  });
});

test("civilian rookie turrets fire without loaded ammo and use module damage", () => {
  const scene = spaceRuntime.ensureScene(30000142);
  const attacker = buildShipEntity(scene, 998700001, -1_500);
  const moduleType = resolveItemByTypeID(3634); // Civilian Gatling Pulse Laser
  assert.ok(moduleType, "expected Civilian Gatling Pulse Laser metadata");

  const moduleItem = buildModuleItem(moduleType.typeID, 998700101, 27, attacker.itemID);
  attacker.nativeNpc = true;
  attacker.fittedItems = [moduleItem];
  attacker.nativeCargoItems = [];
  attacker.skillMap = new Map();

  const attackerSession = attachSession(scene, attacker, 998701001);
  const target = buildShipEntity(scene, 998700002, 1_500, {
    passiveResourceState: {
      ...DEFAULT_PASSIVE_STATE,
      shieldCapacity: 300,
      armorHP: 300,
      structureHP: 300,
    },
  });
  scene.spawnDynamicEntity(target, { broadcast: false });

  const targetShieldBefore = Number(target.conditionState && target.conditionState.shieldCharge) || 0;
  const lockResult = scene.finalizeTargetLock(attacker, target, {
    nowMs: scene.getCurrentSimTimeMs(),
  });
  assert.equal(lockResult.success, true, "expected attacker to lock the target");

  const activationResult = scene.activateGenericModule(
    attackerSession.session,
    moduleItem,
    null,
    {
      targetID: target.itemID,
      repeat: 1000,
    },
  );
  assert.equal(
    activationResult.success,
    true,
    "expected civilian rookie turrets to activate without loaded ammo",
  );
  assert.equal(
    Number(
      activationResult.data &&
        activationResult.data.effectState &&
        activationResult.data.effectState.chargeTypeID,
    ) || 0,
    0,
    "expected civilian rookie turrets to stay chargeless on activation",
  );
  assert.ok(
    Number(
      activationResult.data &&
        activationResult.data.effectState &&
        activationResult.data.effectState.genericAttributeOverrides &&
        (
          Number(activationResult.data.effectState.genericAttributeOverrides[114]) +
          Number(activationResult.data.effectState.genericAttributeOverrides[118]) +
          Number(activationResult.data.effectState.genericAttributeOverrides[117]) +
          Number(activationResult.data.effectState.genericAttributeOverrides[116])
        ),
    ) > 0,
    "expected civilian rookie turrets to keep their direct module damage live without ammo",
  );
  assert.ok(
    (Number(target.conditionState && target.conditionState.shieldCharge) || 0) <
      Number(targetShieldBefore || 0),
    "expected the first civilian rookie shot to apply damage immediately",
  );
});

test("hybrid turret FX stay on the live scene stamp under TiDi like lasers do", () => {
  runTurretTimeDilationFxScenario({
    moduleTypeID: 3186, // Neutron Blaster Cannon II
    chargeTypeID: 238, // Antimatter Charge L
    expectedFamily: "hybridTurret",
  });
});

test("projectile turret FX stay on the live scene stamp under TiDi like lasers do", () => {
  runTurretTimeDilationFxScenario({
    moduleTypeID: 2913, // 425mm AutoCannon II
    chargeTypeID: 193, // EMP M
    expectedFamily: "projectileTurret",
  });
});
