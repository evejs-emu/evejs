const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..", "..");

const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const jammerModuleRuntime = require(path.join(
  repoRoot,
  "server/src/space/modules/jammerModuleRuntime",
));
const {
  resolveItemByName,
  resolveItemByTypeID,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemTypeRegistry",
));

const ATTRIBUTE_SCAN_GRAVIMETRIC_STRENGTH = 211;
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

function buildModuleItem(typeName, itemID, shipID, flagID) {
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

function buildRuntimeShipEntity(
  scene,
  typeName,
  itemID,
  characterID,
  position,
  fittedItems = [],
  options = {},
) {
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
    nativeNpc: options.nativeNpc === true,
    position: { ...position },
    fittedItems,
    passiveResourceState: {
      ...DEFAULT_PASSIVE_STATE,
      ...(options.passiveResourceState || {}),
    },
  }, scene.systemID);
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

function primeTargetLock(sourceEntity, targetEntity, scene) {
  const nowMs = scene.getCurrentSimTimeMs();
  if (!(sourceEntity.lockedTargets instanceof Map)) {
    sourceEntity.lockedTargets = new Map();
  }
  if (!(targetEntity.targetedBy instanceof Set)) {
    targetEntity.targetedBy = new Set();
  }
  sourceEntity.lockedTargets.set(targetEntity.itemID, {
    targetID: targetEntity.itemID,
    lockedAtMs: nowMs,
  });
  targetEntity.targetedBy.add(sourceEntity.itemID);
}

function advanceScene(scene, deltaMs) {
  const baseWallclock = Math.max(
    Number(scene.lastWallclockTickAt) || 0,
    Number(scene.getCurrentWallclockMs()) || 0,
    Number(scene.getCurrentSimTimeMs()) || 0,
  );
  scene.tick(baseWallclock + Math.max(0, Number(deltaMs) || 0));
}

function getNotificationNames(notifications = []) {
  return notifications.map((entry) => entry.name);
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
  return flattenDestinyUpdates(notifications).filter((entry) => (
    entry.name === "OnSpecialFX" &&
    (guid === null || String(entry.args[5]) === String(guid))
  ));
}

serialTest("successful ECM clears disallowed locks and blocks new locks except against the jammer source", () => {
  spaceRuntime._testing.clearScenes();
  const scene = spaceRuntime.ensureScene(30000220);
  scene.__jammerRandom = () => 0;

  const jammerModule = buildModuleItem("Multispectral ECM II", 99001, 98001, 19);
  const sourceEntity = buildRuntimeShipEntity(
    scene,
    "Guardian",
    98001,
    140001001,
    { x: 0, y: 0, z: 0 },
    [jammerModule],
  );
  const targetEntity = buildRuntimeShipEntity(
    scene,
    "Basilisk",
    98002,
    140001002,
    { x: 7_500, y: 0, z: 0 },
    [],
    {
      passiveResourceState: {
        ...DEFAULT_PASSIVE_STATE,
        attributes: {
          [ATTRIBUTE_SCAN_GRAVIMETRIC_STRENGTH]: 20,
        },
      },
    },
  );
  const witnessEntity = buildRuntimeShipEntity(
    scene,
    "Orca",
    98003,
    140001003,
    { x: 10_000, y: 0, z: 0 },
    [],
  );

  const { session: sourceSession } = attachSession(scene, sourceEntity, 59001, 140001001);
  const { session: targetSession, notifications: targetNotifications } = attachSession(
    scene,
    targetEntity,
    59002,
    140001002,
  );
  attachSession(scene, witnessEntity, 59003, 140001003);

  primeTargetLock(sourceEntity, targetEntity, scene);
  primeTargetLock(targetEntity, sourceEntity, scene);
  primeTargetLock(targetEntity, witnessEntity, scene);
  assert.deepEqual(scene.getTargetsForEntity(targetEntity).sort((a, b) => a - b), [
    sourceEntity.itemID,
    witnessEntity.itemID,
  ]);

  const activationResult = scene.activateGenericModule(sourceSession, jammerModule, null, {
    targetID: targetEntity.itemID,
  });
  assert.equal(activationResult.success, true);
  assert.equal(jammerModuleRuntime.isEntityJammed(targetEntity, scene.getCurrentSimTimeMs()), true);
  assert.deepEqual(scene.getTargetsForEntity(targetEntity), [sourceEntity.itemID]);
  assert.ok(getNotificationNames(targetNotifications).includes("OnJamStart"));
  assert.ok(getNotificationNames(targetNotifications).includes("OnEwarStart"));

  const blockedValidation = scene.validateTargetLockRequest(
    targetSession,
    targetEntity,
    witnessEntity,
  );
  assert.equal(blockedValidation.success, false);
  assert.equal(blockedValidation.errorMsg, "TARGET_JAMMED");

  const allowedValidation = scene.validateTargetLockRequest(
    targetSession,
    targetEntity,
    sourceEntity,
  );
  assert.equal(allowedValidation.success, true);
});

serialTest("failed ECM cycle does not create a false jam HUD state", () => {
  spaceRuntime._testing.clearScenes();
  const scene = spaceRuntime.ensureScene(30000221);
  scene.__jammerRandom = () => 1;

  const jammerModule = buildModuleItem("Multispectral ECM II", 99101, 98101, 19);
  const sourceEntity = buildRuntimeShipEntity(
    scene,
    "Guardian",
    98101,
    140001011,
    { x: 0, y: 0, z: 0 },
    [jammerModule],
  );
  const targetEntity = buildRuntimeShipEntity(
    scene,
    "Basilisk",
    98102,
    140001012,
    { x: 7_500, y: 0, z: 0 },
    [],
    {
      passiveResourceState: {
        ...DEFAULT_PASSIVE_STATE,
        attributes: {
          [ATTRIBUTE_SCAN_GRAVIMETRIC_STRENGTH]: 40,
        },
      },
    },
  );

  const { session: sourceSession } = attachSession(scene, sourceEntity, 59101, 140001011);
  const { session: targetSession, notifications: targetNotifications } = attachSession(
    scene,
    targetEntity,
    59102,
    140001012,
  );
  primeTargetLock(sourceEntity, targetEntity, scene);

  const activationResult = scene.activateGenericModule(sourceSession, jammerModule, null, {
    targetID: targetEntity.itemID,
  });
  assert.equal(activationResult.success, true);
  assert.equal(jammerModuleRuntime.isEntityJammed(targetEntity, scene.getCurrentSimTimeMs()), false);
  assert.ok(!getNotificationNames(targetNotifications).includes("OnJamStart"));
  assert.ok(!getNotificationNames(targetNotifications).includes("OnEwarStart"));

  const validation = scene.validateTargetLockRequest(
    targetSession,
    targetEntity,
    sourceEntity,
  );
  assert.equal(validation.success, true);
});

serialTest("burst jammers clear nearby target locks without creating a persistent jam state", () => {
  spaceRuntime._testing.clearScenes();
  const scene = spaceRuntime.ensureScene(30000225);
  scene.__jammerRandom = () => 0;

  const burstModule = buildModuleItem("Burst Jammer II", 99501, 98501, 19);
  const sourceEntity = buildRuntimeShipEntity(
    scene,
    "Scorpion",
    98501,
    140001051,
    { x: 0, y: 0, z: 0 },
    [burstModule],
  );
  const targetEntity = buildRuntimeShipEntity(
    scene,
    "Basilisk",
    98502,
    140001052,
    { x: 5_000, y: 0, z: 0 },
    [],
    {
      passiveResourceState: {
        ...DEFAULT_PASSIVE_STATE,
        attributes: {
          [ATTRIBUTE_SCAN_GRAVIMETRIC_STRENGTH]: 20,
        },
      },
    },
  );
  const witnessEntity = buildRuntimeShipEntity(
    scene,
    "Guardian",
    98503,
    140001053,
    { x: 5_500, y: 0, z: 0 },
    [],
  );

  const { session: sourceSession } = attachSession(scene, sourceEntity, 59501, 140001051);
  const { session: targetSession, notifications: targetNotifications } = attachSession(
    scene,
    targetEntity,
    59502,
    140001052,
  );
  attachSession(scene, witnessEntity, 59503, 140001053);

  primeTargetLock(targetEntity, sourceEntity, scene);
  primeTargetLock(targetEntity, witnessEntity, scene);
  assert.deepEqual(
    scene.getTargetsForEntity(targetEntity).sort((left, right) => left - right),
    [sourceEntity.itemID, witnessEntity.itemID],
  );

  const activationResult = scene.activateGenericModule(sourceSession, burstModule, null, {});
  assert.equal(activationResult.success, true);
  assert.equal(jammerModuleRuntime.isEntityJammed(targetEntity, scene.getCurrentSimTimeMs()), false);
  assert.deepEqual(scene.getTargetsForEntity(targetEntity), []);
  assert.ok(!getNotificationNames(targetNotifications).includes("OnJamStart"));
  assert.ok(!getNotificationNames(targetNotifications).includes("OnEwarStart"));

  const relockValidation = scene.validateTargetLockRequest(
    targetSession,
    targetEntity,
    witnessEntity,
  );
  assert.equal(relockValidation.success, true);
});

serialTest("failed follow-up ECM cycle ends the active jam and restores normal locking", () => {
  spaceRuntime._testing.clearScenes();
  const scene = spaceRuntime.ensureScene(30000222);
  let nextRandom = 0;
  scene.__jammerRandom = () => nextRandom;

  const jammerModule = buildModuleItem("Multispectral ECM II", 99201, 98201, 19);
  const sourceEntity = buildRuntimeShipEntity(
    scene,
    "Guardian",
    98201,
    140001021,
    { x: 0, y: 0, z: 0 },
    [jammerModule],
  );
  const targetEntity = buildRuntimeShipEntity(
    scene,
    "Basilisk",
    98202,
    140001022,
    { x: 7_500, y: 0, z: 0 },
    [],
    {
      passiveResourceState: {
        ...DEFAULT_PASSIVE_STATE,
        attributes: {
          [ATTRIBUTE_SCAN_GRAVIMETRIC_STRENGTH]: 20,
        },
      },
    },
  );
  const witnessEntity = buildRuntimeShipEntity(
    scene,
    "Orca",
    98203,
    140001023,
    { x: 10_000, y: 0, z: 0 },
    [],
  );

  const { session: sourceSession } = attachSession(scene, sourceEntity, 59201, 140001021);
  const { session: targetSession, notifications: targetNotifications } = attachSession(
    scene,
    targetEntity,
    59202,
    140001022,
  );
  attachSession(scene, witnessEntity, 59203, 140001023);
  primeTargetLock(sourceEntity, targetEntity, scene);

  const activationResult = scene.activateGenericModule(sourceSession, jammerModule, null, {
    targetID: targetEntity.itemID,
  });
  assert.equal(activationResult.success, true);
  const effectState = sourceEntity.activeModuleEffects.get(jammerModule.itemID);
  assert.ok(effectState, "expected active ECM effect");
  assert.equal(effectState.forceFreshAcquireSpecialFxReplay, true);
  assert.equal(jammerModuleRuntime.isEntityJammed(targetEntity, scene.getCurrentSimTimeMs()), true);

  nextRandom = 1;
  advanceScene(scene, Number(effectState.durationMs) + 10);
  assert.equal(jammerModuleRuntime.isEntityJammed(targetEntity, scene.getCurrentSimTimeMs()), false);
  assert.ok(getNotificationNames(targetNotifications).includes("OnJamEnd"));
  assert.ok(getNotificationNames(targetNotifications).includes("OnEwarEnd"));

  const validation = scene.validateTargetLockRequest(
    targetSession,
    targetEntity,
    witnessEntity,
  );
  assert.equal(validation.success, true);
});

serialTest("fresh acquire replays active ECM FX for late observers", () => {
  spaceRuntime._testing.clearScenes();
  const scene = spaceRuntime.ensureScene(30000223);
  scene.__jammerRandom = () => 0;

  const sourceShipID = 98301;
  const targetShipID = sourceShipID + 1;
  const observerShipID = sourceShipID + 2;
  const jammerModule = buildModuleItem("Multispectral ECM II", sourceShipID + 3, sourceShipID, 19);
  const sourceEntity = buildRuntimeShipEntity(
    scene,
    "Guardian",
    sourceShipID,
    sourceShipID + 1000,
    { x: 0, y: 0, z: 0 },
    [jammerModule],
  );
  const targetEntity = buildRuntimeShipEntity(
    scene,
    "Basilisk",
    targetShipID,
    targetShipID + 1000,
    { x: 6_000, y: 0, z: 0 },
    [],
    {
      passiveResourceState: {
        ...DEFAULT_PASSIVE_STATE,
        attributes: {
          [ATTRIBUTE_SCAN_GRAVIMETRIC_STRENGTH]: 20,
        },
      },
    },
  );
  const observerEntity = buildRuntimeShipEntity(
    scene,
    "Guardian",
    observerShipID,
    observerShipID + 1000,
    { x: 1_500, y: 0, z: 0 },
    [],
  );

  const { session: sourceSession } = attachSession(
    scene,
    sourceEntity,
    sourceShipID + 2000,
    sourceShipID + 1000,
  );
  attachSession(
    scene,
    targetEntity,
    targetShipID + 2000,
    targetShipID + 1000,
  );
  primeTargetLock(sourceEntity, targetEntity, scene);

  const activationResult = scene.activateGenericModule(sourceSession, jammerModule, null, {
    targetID: targetEntity.itemID,
  });
  assert.equal(activationResult.success, true);
  flushDirectDestinyNotifications(scene);

  const { session: observerSession, notifications: observerNotifications } = attachSession(
    scene,
    observerEntity,
    observerShipID + 2000,
    observerShipID + 1000,
  );
  const acquireResult = scene.sendAddBallsToSession(observerSession, [sourceEntity, targetEntity], {
    freshAcquire: true,
    bypassTickPresentationBatch: true,
  });
  assert.equal(acquireResult.delivered, true);
  flushDirectDestinyNotifications(scene);

  const effectState = sourceEntity.activeModuleEffects.get(jammerModule.itemID);
  assert.ok(effectState, "expected active ECM effect state");

  const replayFx = getSpecialFxEvents(
    observerNotifications,
    "effects.ElectronicAttributeModifyTarget",
  ).find((entry) => Number(entry.args[7]) === 1 && Number(entry.args[8]) === 1);
  assert.ok(replayFx, "expected late-acquire ECM FX replay");
  assert.equal(Number(replayFx.args[1]), jammerModule.itemID);
  assert.equal(Number(replayFx.args[2]), jammerModule.typeID);
  assert.equal(Number(replayFx.args[3]), targetEntity.itemID);
  assert.equal(String(replayFx.args[5]), "effects.ElectronicAttributeModifyTarget");
  assert.equal(Number(replayFx.args[9]), Number(effectState.durationMs));
});
