const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..", "..");

const runtime = require(path.join(repoRoot, "server/src/space/runtime"));
const miningRuntime = require(path.join(
  repoRoot,
  "server/src/services/mining/miningRuntime",
));
const {
  buildMiningModuleSnapshot,
} = require(path.join(
  repoRoot,
  "server/src/services/mining/miningDogma",
));
const fleetRuntime = require(path.join(
  repoRoot,
  "server/src/services/fleets/fleetRuntime",
));
const commandBurstRuntime = require(path.join(
  repoRoot,
  "server/src/space/modules/commandBurstRuntime",
));
const {
  clearPersistedSystemState,
} = require(path.join(
  repoRoot,
  "server/src/services/mining/miningRuntimeState",
));
const {
  resolveItemByName,
  resolveItemByTypeID,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemTypeRegistry",
));
const {
  getTypeEffectRecords,
  getAttributeIDByNames,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));
const {
  getCharacterSkillMap,
} = require(path.join(
  repoRoot,
  "server/src/services/skills/skillState",
));

const ATTRIBUTE_MAX_RANGE = getAttributeIDByNames("maxRange") || 54;
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

function buildChargeItem(typeName, itemID, shipID, moduleID, quantity = 4) {
  const type = resolveExactItem(typeName);
  return {
    itemID,
    ownerID: 0,
    locationID: shipID,
    moduleID,
    typeID: Number(type.typeID),
    groupID: Number(type.groupID || 0),
    categoryID: Number(type.categoryID || 0),
    itemName: String(type.name || typeName),
    singleton: 0,
    quantity,
    stacksize: quantity,
    volume: Number(type.volume || 0),
  };
}

function buildCargoItem(typeName, itemID, shipID, quantity = 1) {
  const type = resolveExactItem(typeName);
  return {
    itemID,
    ownerID: 0,
    locationID: shipID,
    flagID: 5,
    typeID: Number(type.typeID),
    groupID: Number(type.groupID || 0),
    categoryID: Number(type.categoryID || 0),
    itemName: String(type.name || typeName),
    singleton: 0,
    quantity,
    stacksize: quantity,
    volume: Number(type.volume || 0),
  };
}

function buildRuntimeShipEntity(scene, typeName, itemID, characterID, position, fittedItems = []) {
  const type = resolveExactItem(typeName);
  return runtime._testing.buildRuntimeShipEntityForTesting({
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
    fittedItems,
    passiveResourceState: {
      ...DEFAULT_PASSIVE_STATE,
    },
  }, scene.systemID);
}

function attachSession(scene, entity, clientID, characterID) {
  const notifications = [];
  const serviceNotifications = [];
  const objectNotifications = [];
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
    _boundObjectIDs: {
      beyonce: `N=65450:test:${clientID}`,
    },
    socket: { destroyed: false },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendServiceNotification(serviceName, methodName, payload, kwargs = null) {
      serviceNotifications.push({ serviceName, methodName, payload, kwargs });
    },
    sendObjectNotification(objectID, methodName, payload, kwargs = null) {
      objectNotifications.push({ objectID, methodName, payload, kwargs });
    },
    sendSessionChange() {},
  };

  entity.session = session;
  if (!scene.getEntityByID(entity.itemID)) {
    scene.spawnDynamicEntity(entity, { broadcast: false });
  }
  scene.sessions.set(clientID, session);
  return { session, notifications, serviceNotifications, objectNotifications };
}

function joinSameFleet(leaderSession, memberSession) {
  const fleet = fleetRuntime.createFleetRecord(leaderSession);
  fleetRuntime.initFleet(leaderSession, fleet.fleetID);
  fleetRuntime.runtimeState.characterToFleet.set(memberSession.characterID, fleet.fleetID);
  return fleet;
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

function getDestinyUpdateGroups(notifications = []) {
  const groups = [];
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
    const updates = [];
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
    if (updates.length > 0) {
      groups.push(updates);
    }
  }
  return groups;
}

function getSpecialFxEvents(notifications = [], guid = null) {
  return flattenDestinyUpdates(notifications).filter((entry) => (
    entry.name === "OnSpecialFX" &&
    (guid === null || String(entry.args[5]) === String(guid))
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

function getNotificationCount(notifications = [], name) {
  return notifications.filter((entry) => (
    entry &&
    entry.name === name
  )).length;
}

function getServiceNotificationCount(serviceNotifications = [], serviceName, methodName) {
  return serviceNotifications.filter((entry) => (
    entry &&
    entry.serviceName === serviceName &&
    entry.methodName === methodName
  )).length;
}

function getObjectNotificationCount(objectNotifications = [], objectID, methodName) {
  return objectNotifications.filter((entry) => (
    entry &&
    entry.objectID === objectID &&
    entry.methodName === methodName
  )).length;
}

function getLatestObjectNotification(objectNotifications = [], objectID, methodName) {
  for (let index = objectNotifications.length - 1; index >= 0; index -= 1) {
    const notification = objectNotifications[index];
    if (
      notification &&
      notification.objectID === objectID &&
      notification.methodName === methodName
    ) {
      return notification;
    }
  }
  return null;
}

function getLatestServiceNotification(serviceNotifications = [], serviceName, methodName) {
  for (let index = serviceNotifications.length - 1; index >= 0; index -= 1) {
    const notification = serviceNotifications[index];
    if (
      notification &&
      notification.serviceName === serviceName &&
      notification.methodName === methodName
    ) {
      return notification;
    }
  }
  return null;
}

function assertJamNotification(event, expected = {}) {
  assert.ok(event, `expected ${expected.name || "jam"} notification`);
  assert.equal(Number(event.payload[0]), Number(expected.sourceBallID));
  assert.equal(Number(event.payload[1]), Number(expected.moduleID));
  assert.equal(Number(event.payload[2]), Number(expected.targetBallID));
  assert.equal(String(event.payload[3]), String(expected.jammingType));
}

function getAttributeChangeEvents(notifications = [], itemID = null, attributeID = null) {
  const changes = [];
  for (const notification of Array.isArray(notifications) ? notifications : []) {
    if (
      !notification ||
      notification.name !== "OnModuleAttributeChanges" ||
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
    for (const change of items) {
      if (!Array.isArray(change)) {
        continue;
      }
      if (itemID !== null && Number(change[2]) !== Number(itemID)) {
        continue;
      }
      if (attributeID !== null && Number(change[3]) !== Number(attributeID)) {
        continue;
      }
      changes.push(change);
    }
  }
  return changes;
}

function getSlimDictEntry(dict, key) {
  const entries = Array.isArray(dict && dict.entries) ? dict.entries : [];
  const match = entries.find((entry) => Array.isArray(entry) && entry[0] === key);
  return match ? match[1] : undefined;
}

function getMarshalDictEntry(value, key) {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.type === "object" &&
    value.name === "util.KeyVal"
  ) {
    return getMarshalDictEntry(value.args, key);
  }
  return getSlimDictEntry(value, key);
}

function getMarshalListItems(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && value.type === "list" && Array.isArray(value.items)) {
    return value.items;
  }
  return [];
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

function isDbuffNotificationEvent(notification) {
  if (!notification || !Array.isArray(notification.payload)) {
    return false;
  }
  return notification.name === "OnDbuffUpdated";
}

function getDbuffCollectionIDsFromNotification(notification) {
  if (!isDbuffNotificationEvent(notification)) {
    return [];
  }
  return getMarshalListItems(notification.payload[1])
    .map((entry) => Number(Array.isArray(entry) ? entry[0] : 0))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);
}

function getDbuffCollectionIDsFromPayload(payload) {
  if (!Array.isArray(payload) || payload.length < 2) {
    return [];
  }
  return getMarshalListItems(payload[1])
    .map((entry) => Number(Array.isArray(entry) ? entry[0] : 0))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);
}

function getLatestDestinyUpdateByName(notifications = [], name) {
  const updates = flattenDestinyUpdates(notifications);
  for (let index = updates.length - 1; index >= 0; index -= 1) {
    const update = updates[index];
    if (update && update.name === name) {
      return update;
    }
  }
  return null;
}

function getDestinyUpdateCountByName(notifications = [], name) {
  return flattenDestinyUpdates(notifications)
    .filter((update) => update && update.name === name)
    .length;
}

function getLatestDbuffNotification(notifications = [], objectNotifications = []) {
  const latestDestinyDbuffUpdate = getLatestDestinyUpdateByName(
    notifications,
    "OnDbuffUpdated",
  );
  if (latestDestinyDbuffUpdate) {
    return latestDestinyDbuffUpdate;
  }
  for (let index = objectNotifications.length - 1; index >= 0; index -= 1) {
    const notification = objectNotifications[index];
    if (notification && notification.methodName === "OnDbuffUpdated") {
      return notification;
    }
  }
  for (let index = notifications.length - 1; index >= 0; index -= 1) {
    const notification = notifications[index];
    if (isDbuffNotificationEvent(notification)) {
      return notification;
    }
  }
  return null;
}

function getLatestCommandBurstDbuffCollectionIDs(
  notifications = [],
  objectNotifications = [],
) {
  const latestDbuffNotification = getLatestDbuffNotification(
    notifications,
    objectNotifications,
  );
  if (latestDbuffNotification) {
    if (latestDbuffNotification.methodName === "OnDbuffUpdated") {
      return getDbuffCollectionIDsFromPayload(latestDbuffNotification.payload);
    }
    if (latestDbuffNotification.name === "OnDbuffUpdated") {
      return getDbuffCollectionIDsFromPayload(latestDbuffNotification.args);
    }
    return getDbuffCollectionIDsFromNotification(latestDbuffNotification);
  }
  const setStateCollectionIDs = getLatestSetStateDbuffCollectionIDs(notifications);
  if (setStateCollectionIDs !== null) {
    return setStateCollectionIDs;
  }
  return [];
}

function getLatestSetStateDbuffCollectionIDs(notifications = []) {
  const updates = flattenDestinyUpdates(notifications);
  for (let index = updates.length - 1; index >= 0; index -= 1) {
    const update = updates[index];
    if (!update || update.name !== "SetState") {
      continue;
    }
    const state = Array.isArray(update.args) ? update.args[0] : null;
    const dbuffState = getMarshalDictEntry(state, "dbuffState");
    return getMarshalListItems(dbuffState)
      .map((entry) => Number(Array.isArray(entry) ? entry[0] : 0))
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((left, right) => left - right);
  }
  return null;
}

function getLatestDestinyGroupContainingSetState(notifications = []) {
  const groups = getDestinyUpdateGroups(notifications);
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (group.some((entry) => entry && entry.name === "SetState")) {
      return group;
    }
  }
  return null;
}

function addMineableEntity(scene, itemTypeName, itemID, kind, position, resourceQuantity) {
  const type = resolveExactItem(itemTypeName);
  const entity = {
    kind,
    itemID,
    typeID: Number(type.typeID),
    groupID: Number(type.groupID || 0),
    categoryID: Number(type.categoryID || 0),
    ownerID: 1,
    itemName: String(type.name || itemTypeName),
    slimName: String(type.name || itemTypeName),
    position: { ...position },
    velocity: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    radius: 150,
    resourceQuantity,
    staticVisibilityScope: "bubble",
  };
  assert.equal(scene.addStaticEntity(entity), true);
  return entity;
}

function getEffectByName(typeName, effectName) {
  const type = resolveExactItem(typeName);
  const effectRecord = getTypeEffectRecords(Number(type.typeID)).find((entry) => (
    String(entry && entry.name || "").trim().toLowerCase() ===
      String(effectName || "").trim().toLowerCase()
  ));
  assert.ok(effectRecord, `expected ${typeName} to expose ${effectName}`);
  return effectRecord;
}

function buildShipStatSnapshot(entity) {
  return {
    maxVelocity: Number(entity && entity.maxVelocity) || 0,
    maxTargetRange: Number(entity && entity.maxTargetRange) || 0,
    scanResolution: Number(entity && entity.scanResolution) || 0,
    shieldCapacity: Number(entity && entity.shieldCapacity) || 0,
    armorHP: Number(entity && entity.armorHP) || 0,
    structureHP: Number(entity && entity.structureHP) || 0,
    signatureRadius: Number(entity && entity.signatureRadius) || 0,
    inertia: Number(entity && entity.inertia) || 0,
  };
}

test.afterEach(() => {
  runtime._testing.clearScenes();
  clearPersistedSystemState(30000142);
  clearPersistedSystemState(30000144);
  clearPersistedSystemState(30000145);
  fleetRuntime.runtimeState.nextFleetSerial = 1;
  fleetRuntime.runtimeState.fleets.clear();
  fleetRuntime.runtimeState.characterToFleet.clear();
  fleetRuntime.runtimeState.invitesByCharacter.clear();
});

serialTest("Mining Foreman Burst emits one-shot mining burst FX, owner Godma state, and dbuff updates", () => {
  const scene = runtime.ensureScene(30000142);
  const burstModule = buildModuleItem("Mining Foreman Burst I", 995100001, 995100000, 27);
  const burstCharge = buildChargeItem(
    "Mining Laser Field Enhancement Charge",
    995100002,
    995100000,
    burstModule.itemID,
    4,
  );
  const orca = buildRuntimeShipEntity(
    scene,
    "Orca",
    995100000,
    9510001,
    { x: 0, y: 0, z: 0 },
    [burstModule],
  );
  orca.nativeCargoItems = [burstCharge];
  const minerModule = buildModuleItem("Miner II", 995100011, 995100010, 27);
  const miner = buildRuntimeShipEntity(
    scene,
    "Venture",
    995100010,
    9510002,
    { x: 1_500, y: 0, z: 0 },
    [minerModule],
  );
  const observer = buildRuntimeShipEntity(
    scene,
    "Venture",
    995100020,
    9510003,
    { x: 3_000, y: 0, z: 0 },
    [],
  );

  const {
    session: ownerSession,
    notifications: ownerNotifications,
    serviceNotifications: ownerServiceNotifications,
    objectNotifications: ownerObjectNotifications,
  } = attachSession(
    scene,
    orca,
    9511001,
    9510001,
  );
  const {
    session: minerSession,
    notifications: minerNotifications,
    serviceNotifications: minerServiceNotifications,
    objectNotifications: minerObjectNotifications,
  } = attachSession(
    scene,
    miner,
    9511002,
    9510002,
  );
  const { notifications: observerNotifications } = attachSession(
    scene,
    observer,
    9511003,
    9510003,
  );
  joinSameFleet(ownerSession, minerSession);

  const activationResult = scene.activateGenericModule(
    ownerSession,
    burstModule,
    "moduleBonusWarfareLinkMining",
  );
  assert.equal(activationResult.success, true);
  flushDirectDestinyNotifications(scene);

  const activeEffect = orca.activeModuleEffects.get(burstModule.itemID);
  assert.ok(activeEffect && activeEffect.commandBurstEffect === true);

  const ownerSourceFx = getSpecialFxEvents(
    ownerNotifications,
    "effects.WarfareLinkSphereMining",
  ).find((entry) => Number(entry.args[7]) === 1 && Number(entry.args[8]) === 0);
  const observerSourceFx = getSpecialFxEvents(
    observerNotifications,
    "effects.WarfareLinkSphereMining",
  ).find((entry) => Number(entry.args[7]) === 1 && Number(entry.args[8]) === 0);
  assert.ok(ownerSourceFx, "expected owner mining burst sphere pulse");
  assert.ok(observerSourceFx, "expected observer mining burst sphere pulse");
  assert.equal(Number(ownerSourceFx.args[9]), -1);
  assert.equal(Number(observerSourceFx.args[9]), -1);

  const ownerTargetFx = getSpecialFxEvents(
    ownerNotifications,
    "effects.WarfareLinkMining",
  ).find((entry) => Number(entry.args[7]) === 1 && Number(entry.args[8]) === 0);
  const observerTargetFx = getSpecialFxEvents(
    observerNotifications,
    "effects.WarfareLinkMining",
  ).find((entry) => Number(entry.args[7]) === 1 && Number(entry.args[8]) === 0);
  assert.ok(ownerTargetFx, "expected owner mining target pulse");
  assert.ok(observerTargetFx, "expected observer mining target pulse");
  assert.equal(Number(ownerTargetFx.args[9]), -1);
  assert.equal(Number(observerTargetFx.args[9]), -1);

  const ownerGodmaStart = getGodmaEffectNotifications(
    ownerNotifications,
    burstModule.itemID,
    true,
  );
  assert.ok(ownerGodmaStart.length > 0, "expected owner OnGodmaShipEffect start");

  const ownerDbuffCollections = getLatestCommandBurstDbuffCollectionIDs(
    ownerNotifications,
    ownerObjectNotifications,
  );
  const minerDbuffCollections = getLatestCommandBurstDbuffCollectionIDs(
    minerNotifications,
    minerObjectNotifications,
  );
  assert.deepEqual(ownerDbuffCollections, [23, 2474]);
  assert.deepEqual(minerDbuffCollections, [23, 2474]);
  assert.equal(
    getServiceNotificationCount(ownerServiceNotifications, "michelle", "OnDbuffUpdated"),
    0,
    "expected no owner Michelle service dbuff notification",
  );
  assert.equal(
    getServiceNotificationCount(minerServiceNotifications, "michelle", "OnDbuffUpdated"),
    0,
    "expected no miner Michelle service dbuff notification",
  );
  assert.equal(
    getDestinyUpdateCountByName(ownerNotifications, "OnDbuffUpdated"),
    1,
    "expected owner Michelle destiny dbuff update on burst activation",
  );
  assert.equal(
    getDestinyUpdateCountByName(minerNotifications, "OnDbuffUpdated"),
    1,
    "expected miner Michelle destiny dbuff update on burst activation",
  );
  assert.equal(getObjectNotificationCount(ownerObjectNotifications, ownerSession._boundObjectIDs.beyonce, "OnDbuffUpdated"), 0);
  assert.equal(getObjectNotificationCount(minerObjectNotifications, minerSession._boundObjectIDs.beyonce, "OnDbuffUpdated"), 0);
});

serialTest("Mining Foreman Burst II on the Orca fit emits one-shot pulses and clears via Godma stop without stop FX", () => {
  const scene = runtime.ensureScene(30000142);
  const burstModule = buildModuleItem("Mining Foreman Burst II", 995110001, 995110000, 27);
  const burstCharge = buildChargeItem(
    "Mining Laser Optimization Charge",
    995110002,
    995110000,
    burstModule.itemID,
    100,
  );
  const orca = buildRuntimeShipEntity(
    scene,
    "Orca",
    995110000,
    9511001,
    { x: 0, y: 0, z: 0 },
    [burstModule],
  );
  orca.nativeCargoItems = [burstCharge];
  const miner = buildRuntimeShipEntity(
    scene,
    "Venture",
    995110010,
    9511002,
    { x: 1_500, y: 0, z: 0 },
    [],
  );

  const { session: ownerSession, notifications: ownerNotifications } = attachSession(
    scene,
    orca,
    9511101,
    9511001,
  );
  const { session: minerSession, notifications: minerNotifications } = attachSession(
    scene,
    miner,
    9511102,
    9511002,
  );
  joinSameFleet(ownerSession, minerSession);

  const activationResult = scene.activateGenericModule(
    ownerSession,
    burstModule,
    "moduleBonusWarfareLinkMining",
  );
  assert.equal(activationResult.success, true);
  flushDirectDestinyNotifications(scene);

  const activeEffect = orca.activeModuleEffects.get(burstModule.itemID);
  assert.ok(activeEffect && activeEffect.commandBurstEffect === true);
  assert.equal(activeEffect.typeID, burstModule.typeID);

  const ownerSourceFx = getSpecialFxEvents(
    ownerNotifications,
    "effects.WarfareLinkSphereMining",
  ).find((entry) => Number(entry.args[7]) === 1 && Number(entry.args[8]) === 0);
  const ownerTargetFx = getSpecialFxEvents(
    ownerNotifications,
    "effects.WarfareLinkMining",
  ).find((entry) => Number(entry.args[7]) === 1 && Number(entry.args[8]) === 0);
  const minerTargetFx = getSpecialFxEvents(
    minerNotifications,
    "effects.WarfareLinkMining",
  ).find((entry) => Number(entry.args[7]) === 1 && Number(entry.args[8]) === 0);
  assert.ok(ownerSourceFx, "expected owner sphere pulse");
  assert.ok(ownerTargetFx, "expected owner self-target pulse");
  assert.ok(minerTargetFx, "expected fleetmate target pulse");
  assert.equal(Number(ownerSourceFx.args[9]), -1);
  assert.equal(Number(ownerTargetFx.args[9]), -1);
  assert.equal(Number(minerTargetFx.args[9]), -1);

  const deactivateResult = scene.deactivateGenericModule(ownerSession, burstModule.itemID, {
    deferUntilCycle: false,
  });
  assert.equal(deactivateResult.success, true);
  flushDirectDestinyNotifications(scene);

  const ownerStopFx = getSpecialFxEvents(ownerNotifications)
    .filter((entry) => (
      (String(entry.args[5]) === "effects.WarfareLinkSphereMining" ||
        String(entry.args[5]) === "effects.WarfareLinkMining") &&
      Number(entry.args[7]) === 0 &&
      Number(entry.args[8]) === 0
    ));
  assert.deepEqual(ownerStopFx, [], "expected command burst stop to be Godma-only");
  assert.ok(
    getGodmaEffectNotifications(ownerNotifications, burstModule.itemID, false).length > 0,
    "expected owner OnGodmaShipEffect stop for Mining Foreman Burst II",
  );
  assert.equal(orca.activeModuleEffects.has(burstModule.itemID), false);
});

serialTest("command bursts update owner and boosted fleetmates through Michelle destiny dbuff updates without legacy notification fallbacks", () => {
  const scene = runtime.ensureScene(30000142);
  const burstModule = buildModuleItem("Information Command Burst II", 995110101, 995110100, 27);
  const burstCharge = buildChargeItem(
    "Electronic Hardening Charge",
    995110102,
    995110100,
    burstModule.itemID,
    100,
  );
  const orca = buildRuntimeShipEntity(
    scene,
    "Orca",
    995110100,
    9511101,
    { x: 0, y: 0, z: 0 },
    [burstModule],
  );
  orca.nativeCargoItems = [burstCharge];
  const fleetmate = buildRuntimeShipEntity(
    scene,
    "Venture",
    995110110,
    9511102,
    { x: 1_500, y: 0, z: 0 },
    [],
  );

  const {
    session: ownerSession,
    notifications: ownerNotifications,
    serviceNotifications: ownerServiceNotifications,
    objectNotifications: ownerObjectNotifications,
  } = attachSession(
    scene,
    orca,
    9511111,
    9511101,
  );
  const {
    session: fleetmateSession,
    notifications: fleetmateNotifications,
    serviceNotifications: fleetmateServiceNotifications,
    objectNotifications: fleetmateObjectNotifications,
  } = attachSession(
    scene,
    fleetmate,
    9511112,
    9511102,
  );
  joinSameFleet(ownerSession, fleetmateSession);

  const activationResult = scene.activateGenericModule(
    ownerSession,
    burstModule,
    "moduleBonusWarfareLinkInfo",
  );
  assert.equal(activationResult.success, true);
  flushDirectDestinyNotifications(scene);
  const effectState = orca.activeModuleEffects.get(burstModule.itemID);
  assert.ok(effectState, "expected active information burst effect state");
  const expectedDbuffCollectionIDs = [...effectState.commandBurstDbuffValues.keys()]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);

  assert.equal(
    getNotificationCount(ownerNotifications, "OnDbuffUpdated"),
    0,
    "expected no owner broadcast dbuff update on burst activation",
  );
  assert.equal(
    getNotificationCount(fleetmateNotifications, "OnDbuffUpdated"),
    0,
    "expected no fleetmate broadcast dbuff update on burst activation",
  );
  assert.equal(
    getServiceNotificationCount(ownerServiceNotifications, "michelle", "OnDbuffUpdated"),
    0,
    "expected no owner Michelle service burst dbuff notification",
  );
  assert.equal(
    getServiceNotificationCount(
      fleetmateServiceNotifications,
      "michelle",
      "OnDbuffUpdated",
    ),
    0,
    "expected no fleetmate Michelle service burst dbuff notification",
  );
  assert.equal(
    getJamNotifications(ownerNotifications, "OnJamStart").length,
    0,
    "expected no burst jam notifications on activation",
  );
  assert.equal(
    getJamNotifications(fleetmateNotifications, "OnJamStart").length,
    0,
    "expected no fleetmate burst jam notifications on activation",
  );
  assert.equal(
    getJamNotifications(ownerNotifications, "OnEwarStart").length,
    0,
    "expected no burst tactical notifications on activation",
  );
  assert.equal(
    getJamNotifications(fleetmateNotifications, "OnEwarStart").length,
    0,
    "expected no fleetmate burst tactical notifications on activation",
  );
  assert.deepEqual(
    getDbuffCollectionIDsFromPayload(
      getLatestDestinyUpdateByName(ownerNotifications, "OnDbuffUpdated").args,
    ),
    expectedDbuffCollectionIDs,
    "expected owner burst HUD Michelle dbuff refresh",
  );
  assert.deepEqual(
    getDbuffCollectionIDsFromPayload(
      getLatestDestinyUpdateByName(fleetmateNotifications, "OnDbuffUpdated").args,
    ),
    expectedDbuffCollectionIDs,
    "expected fleetmate burst HUD Michelle dbuff refresh",
  );
  assert.equal(
    getDestinyUpdateCountByName(ownerNotifications, "OnDbuffUpdated"),
    1,
    "expected owner Michelle destiny dbuff update on burst activation",
  );
  assert.equal(
    getDestinyUpdateCountByName(fleetmateNotifications, "OnDbuffUpdated"),
    1,
    "expected fleetmate Michelle destiny dbuff update on burst activation",
  );
  assert.equal(getObjectNotificationCount(ownerObjectNotifications, ownerSession._boundObjectIDs.beyonce, "OnDbuffUpdated"), 0);
  assert.equal(getObjectNotificationCount(fleetmateObjectNotifications, fleetmateSession._boundObjectIDs.beyonce, "OnDbuffUpdated"), 0);
  assert.equal(
    getLatestSetStateDbuffCollectionIDs(ownerNotifications),
    null,
    "expected no owner burst HUD SetState refresh",
  );
  assert.equal(
    getLatestSetStateDbuffCollectionIDs(fleetmateNotifications),
    null,
    "expected no fleetmate burst HUD SetState refresh",
  );
});

serialTest("command burst HUD state persists for buff duration and clears through Michelle destiny dbuff updates when the timed boost expires", () => {
  const scene = runtime.ensureScene(30000142);
  const burstModule = buildModuleItem("Mining Foreman Burst II", 995110201, 995110200, 27);
  const burstCharge = buildChargeItem(
    "Mining Laser Optimization Charge",
    995110202,
    995110200,
    burstModule.itemID,
    100,
  );
  const orca = buildRuntimeShipEntity(
    scene,
    "Orca",
    995110200,
    9511201,
    { x: 0, y: 0, z: 0 },
    [burstModule],
  );
  orca.nativeCargoItems = [burstCharge];
  const miner = buildRuntimeShipEntity(
    scene,
    "Venture",
    995110210,
    9511202,
    { x: 1_500, y: 0, z: 0 },
    [],
  );

  const {
    session: ownerSession,
    notifications: ownerNotifications,
    serviceNotifications: ownerServiceNotifications,
    objectNotifications: ownerObjectNotifications,
  } = attachSession(
    scene,
    orca,
    9511211,
    9511201,
  );
  const {
    session: minerSession,
    notifications: minerNotifications,
    serviceNotifications: minerServiceNotifications,
    objectNotifications: minerObjectNotifications,
  } = attachSession(
    scene,
    miner,
    9511212,
    9511202,
  );
  joinSameFleet(ownerSession, minerSession);

  const activationResult = scene.activateGenericModule(
    ownerSession,
    burstModule,
    "moduleBonusWarfareLinkMining",
  );
  assert.equal(activationResult.success, true);
  flushDirectDestinyNotifications(scene);

  const activeEffect = orca.activeModuleEffects.get(burstModule.itemID);
  assert.ok(activeEffect, "expected mining burst effect state");
  const buffDurationMs = Number(activeEffect.commandBurstBuffDurationMs) || 0;
  assert.ok(buffDurationMs > 0, "expected mining burst buff duration");

  const stopResult = scene.deactivateGenericModule(ownerSession, burstModule.itemID, {
    deferUntilCycle: false,
  });
  assert.equal(stopResult.success, true);
  flushDirectDestinyNotifications(scene);

  assert.equal(getJamNotifications(ownerNotifications, "OnJamEnd").length, 0);
  assert.equal(getJamNotifications(minerNotifications, "OnJamEnd").length, 0);
  assert.equal(getJamNotifications(ownerNotifications, "OnEwarEnd").length, 0);
  assert.equal(getJamNotifications(minerNotifications, "OnEwarEnd").length, 0);

  advanceSceneUntilSimTime(scene, scene.getCurrentSimTimeMs() + buffDurationMs, 50);

  assert.equal(
    getNotificationCount(ownerNotifications, "OnDbuffUpdated"),
    0,
    "expected no owner dbuff broadcast notifications",
  );
  assert.equal(
    getNotificationCount(minerNotifications, "OnDbuffUpdated"),
    0,
    "expected no fleetmate dbuff broadcast notifications",
  );
  assert.equal(
    getServiceNotificationCount(ownerServiceNotifications, "michelle", "OnDbuffUpdated"),
    0,
    "expected no owner Michelle dbuff notifications",
  );
  assert.equal(
    getServiceNotificationCount(minerServiceNotifications, "michelle", "OnDbuffUpdated"),
    0,
    "expected no fleetmate Michelle dbuff notifications",
  );
  assert.equal(
    getJamNotifications(ownerNotifications, "OnJamEnd").length,
    0,
    "expected no burst jam-end notifications on expiry",
  );
  assert.equal(
    getJamNotifications(minerNotifications, "OnJamEnd").length,
    0,
    "expected no fleetmate burst jam-end notifications on expiry",
  );
  assert.equal(
    getJamNotifications(ownerNotifications, "OnEwarEnd").length,
    0,
    "expected no burst tactical teardown on expiry",
  );
  assert.equal(
    getJamNotifications(minerNotifications, "OnEwarEnd").length,
    0,
    "expected no fleetmate burst tactical teardown on expiry",
  );
  assert.deepEqual(
    getDbuffCollectionIDsFromPayload(
      getLatestDestinyUpdateByName(ownerNotifications, "OnDbuffUpdated").args,
    ),
    [],
    "expected owner burst HUD expiry Michelle refresh to clear dbuffs",
  );
  assert.deepEqual(
    getDbuffCollectionIDsFromPayload(
      getLatestDestinyUpdateByName(minerNotifications, "OnDbuffUpdated").args,
    ),
    [],
    "expected fleetmate burst HUD expiry Michelle refresh to clear dbuffs",
  );
  assert.equal(
    getDestinyUpdateCountByName(ownerNotifications, "OnDbuffUpdated"),
    2,
    "expected owner Michelle destiny dbuff updates during burst lifetime",
  );
  assert.equal(
    getDestinyUpdateCountByName(minerNotifications, "OnDbuffUpdated"),
    2,
    "expected fleetmate Michelle destiny dbuff updates during burst lifetime",
  );
  assert.equal(getObjectNotificationCount(ownerObjectNotifications, ownerSession._boundObjectIDs.beyonce, "OnDbuffUpdated"), 0);
  assert.equal(getObjectNotificationCount(minerObjectNotifications, minerSession._boundObjectIDs.beyonce, "OnDbuffUpdated"), 0);
});

serialTest("industrial core refresh pushes boosted burst maxRange to the owner HUD instead of leaving the burst at the raw 15 km base", () => {
  const scene = runtime.ensureScene(30000142);
  const burstModule = buildModuleItem("Mining Foreman Burst II", 995112001, 995112000, 27);
  const industrialCore = buildModuleItem("Large Industrial Core II", 995112002, 995112000, 28);
  const orca = buildRuntimeShipEntity(
    scene,
    "Orca",
    995112000,
    140000001,
    { x: 0, y: 0, z: 0 },
    [burstModule, industrialCore],
  );
  orca.nativeCargoItems = [
    buildCargoItem("Heavy Water", 995112003, orca.itemID, 2_000),
  ];
  const { session: ownerSession, notifications: ownerNotifications } = attachSession(
    scene,
    orca,
    9511201,
    140000001,
  );

  const shipItem = {
    itemID: orca.itemID,
    typeID: orca.typeID,
    ownerID: orca.characterID,
    locationID: scene.systemID,
    itemName: orca.itemName,
  };
  const baselineAttrs = runtime.getGenericModuleRuntimeAttributes(
    ownerSession.characterID,
    shipItem,
    burstModule,
    null,
    null,
    {
      skillMap: getCharacterSkillMap(ownerSession.characterID),
      fittedItems: [burstModule, industrialCore],
      activeModuleContexts: [],
    },
  );
  const baselineRange = Number(
    baselineAttrs &&
      baselineAttrs.attributeOverrides &&
      baselineAttrs.attributeOverrides[ATTRIBUTE_MAX_RANGE],
  ) || 0;
  assert.ok(baselineRange > 15000, "expected the unfueled Orca burst to already exceed the raw 15 km base");

  const activationResult = scene.activateGenericModule(
    ownerSession,
    industrialCore,
    "industrialCompactCoreEffect2",
  );
  assert.equal(activationResult.success, true);
  flushDirectDestinyNotifications(scene);

  const rangeChanges = getAttributeChangeEvents(
    ownerNotifications,
    burstModule.itemID,
    ATTRIBUTE_MAX_RANGE,
  );
  assert.ok(rangeChanges.length > 0, "expected industrial core refresh to send a burst maxRange HUD update");
  assert.ok(
    Number(rangeChanges.at(-1)[5]) > baselineRange,
    "expected industrial core to boost the displayed burst range above the unfueled Orca value",
  );
});

serialTest("Mining Foreman Burst charges keep the same mining VFX while changing dbuff collections", () => {
  const cases = [
    {
      chargeName: "Mining Laser Field Enhancement Charge",
      expectedCollectionIDs: [23, 2474],
    },
    {
      chargeName: "Mining Laser Optimization Charge",
      expectedCollectionIDs: [24, 2474],
    },
    {
      chargeName: "Mining Equipment Preservation Charge",
      expectedCollectionIDs: [25, 2474],
    },
  ];

  for (const [index, testCase] of cases.entries()) {
    const scene = runtime.ensureScene(30000142);
    const burstModule = buildModuleItem(
      "Mining Foreman Burst I",
      995150001 + (index * 100),
      995150000 + (index * 100),
      27,
    );
    const burstCharge = buildChargeItem(
      testCase.chargeName,
      995150002 + (index * 100),
      995150000 + (index * 100),
      burstModule.itemID,
      4,
    );
    const orca = buildRuntimeShipEntity(
      scene,
      "Orca",
      995150000 + (index * 100),
      9515001 + index,
      { x: 0, y: 0, z: 0 },
      [burstModule],
    );
    orca.nativeCargoItems = [burstCharge];
    const miner = buildRuntimeShipEntity(
      scene,
      "Venture",
      995150010 + (index * 100),
      9516001 + index,
      { x: 1_500, y: 0, z: 0 },
      [],
    );
    const {
      session: ownerSession,
      notifications: ownerNotifications,
    } = attachSession(
      scene,
      orca,
      9517001 + index,
      9515001 + index,
    );
    const {
      session: minerSession,
      notifications: minerNotifications,
      objectNotifications: minerObjectNotifications,
    } = attachSession(
      scene,
      miner,
      9518001 + index,
      9516001 + index,
    );
    joinSameFleet(ownerSession, minerSession);

    const activationResult = scene.activateGenericModule(
      ownerSession,
      burstModule,
      "moduleBonusWarfareLinkMining",
    );
    assert.equal(activationResult.success, true);
    flushDirectDestinyNotifications(scene);

    const effectState = orca.activeModuleEffects.get(burstModule.itemID);
    assert.ok(effectState, "expected active burst effect state");
    assert.equal(effectState.commandBurstSourceFxGuid, "effects.WarfareLinkSphereMining");
    assert.equal(effectState.commandBurstTargetFxGuid, "effects.WarfareLinkMining");
    assert.deepEqual(
      [...effectState.commandBurstDbuffValues.keys()].sort((left, right) => left - right),
      testCase.expectedCollectionIDs,
    );

    const ownerSourceFx = getSpecialFxEvents(
      ownerNotifications,
      "effects.WarfareLinkSphereMining",
    );
    const minerTargetFx = getSpecialFxEvents(
      minerNotifications,
      "effects.WarfareLinkMining",
    );
    assert.ok(ownerSourceFx.length > 0, `expected mining source FX for ${testCase.chargeName}`);
    assert.ok(minerTargetFx.length > 0, `expected mining target FX for ${testCase.chargeName}`);

    const minerDbuffCollections = getLatestCommandBurstDbuffCollectionIDs(
      minerNotifications,
      minerObjectNotifications,
    );
    assert.deepEqual(minerDbuffCollections, testCase.expectedCollectionIDs);

    runtime._testing.clearScenes();
    clearPersistedSystemState(30000142);
    fleetRuntime.runtimeState.nextFleetSerial = 1;
    fleetRuntime.runtimeState.fleets.clear();
    fleetRuntime.runtimeState.characterToFleet.clear();
    fleetRuntime.runtimeState.invitesByCharacter.clear();
  }
});

serialTest("SetState carries active command burst dbuffState for the boosted ego ship", () => {
  const scene = runtime.ensureScene(30000144);
  const burstModule = buildModuleItem("Mining Foreman Burst I", 995200001, 995200000, 27);
  const burstCharge = buildChargeItem(
    "Mining Laser Field Enhancement Charge",
    995200002,
    995200000,
    burstModule.itemID,
    4,
  );
  const orca = buildRuntimeShipEntity(
    scene,
    "Orca",
    995200000,
    9520001,
    { x: 0, y: 0, z: 0 },
    [burstModule],
  );
  orca.nativeCargoItems = [burstCharge];
  const miner = buildRuntimeShipEntity(
    scene,
    "Venture",
    995200010,
    9520002,
    { x: 1_500, y: 0, z: 0 },
    [buildModuleItem("Miner II", 995200011, 995200010, 27)],
  );

  const { session: ownerSession } = attachSession(scene, orca, 9521001, 9520001);
  const { session: minerSession, notifications: minerNotifications } = attachSession(
    scene,
    miner,
    9521002,
    9520002,
  );
  joinSameFleet(ownerSession, minerSession);

  const activationResult = scene.activateGenericModule(
    ownerSession,
    burstModule,
    "moduleBonusWarfareLinkMining",
  );
  assert.equal(activationResult.success, true);
  flushDirectDestinyNotifications(scene);

  minerNotifications.length = 0;
  scene.sendStateRefresh(minerSession, miner, null, {
    reason: "command-burst-test",
  });
  flushDirectDestinyNotifications(scene);

  const setStateUpdate = flattenDestinyUpdates(minerNotifications).find(
    (entry) => entry.name === "SetState",
  );
  assert.ok(setStateUpdate, "expected SetState refresh");

  const state = Array.isArray(setStateUpdate.args) ? setStateUpdate.args[0] : null;
  const dbuffState = getMarshalDictEntry(state, "dbuffState");
  const dbuffCollectionIDs = getMarshalListItems(dbuffState)
    .map((entry) => Number(Array.isArray(entry) ? entry[0] : 0))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);
  assert.deepEqual(dbuffCollectionIDs, [23, 2474]);
});

serialTest("Mining Foreman Burst range bonus changes mining activation parity for fleetmates", () => {
  const scene = runtime.ensureScene(30000145);
  const burstModule = buildModuleItem("Mining Foreman Burst I", 995300001, 995300000, 27);
  const burstCharge = buildChargeItem(
    "Mining Laser Field Enhancement Charge",
    995300002,
    995300000,
    burstModule.itemID,
    4,
  );
  const orca = buildRuntimeShipEntity(
    scene,
    "Orca",
    995300000,
    9530001,
    { x: 0, y: 0, z: 0 },
    [burstModule],
  );
  orca.nativeCargoItems = [burstCharge];

  const minerModule = buildModuleItem("Miner II", 995300011, 995300010, 27);
  const miner = buildRuntimeShipEntity(
    scene,
    "Venture",
    995300010,
    9530002,
    { x: 1_500, y: 0, z: 0 },
    [minerModule],
  );

  const { session: ownerSession } = attachSession(scene, orca, 9531001, 9530001);
  const { session: minerSession } = attachSession(scene, miner, 9531002, 9530002);
  joinSameFleet(ownerSession, minerSession);

  const miningEffect = getEffectByName("Miner II", "miningLaser");
  const baselineSnapshot = buildMiningModuleSnapshot({
    shipItem: {
      itemID: miner.itemID,
      typeID: miner.typeID,
      ownerID: miner.characterID,
      locationID: scene.systemID,
      itemName: miner.itemName,
    },
    moduleItem: minerModule,
    effectRecord: miningEffect,
    fittedItems: [minerModule],
    skillMap: new Map(),
    activeModuleContexts: [],
  });
  assert.ok(baselineSnapshot, "expected baseline mining snapshot");

  const asteroidSurfaceDistance = Math.ceil(Number(baselineSnapshot.maxRangeMeters || 0)) + 25;
  const asteroid = addMineableEntity(
    scene,
    "Veldspar",
    995300100,
    "asteroid",
    {
      x: miner.position.x + asteroidSurfaceDistance + Number(miner.radius || 0) + 150,
      y: 0,
      z: 0,
    },
    500,
  );
  clearPersistedSystemState(scene.systemID);
  scene._miningRuntimeState = null;
  scene.finalizeTargetLock(miner, asteroid, {
    nowMs: scene.getCurrentSimTimeMs(),
  });

  const baselineActivation = miningRuntime.resolveMiningActivation(
    scene,
    miner,
    minerModule,
    miningEffect,
    { targetID: asteroid.itemID },
  );
  assert.equal(baselineActivation.matched, true);
  assert.equal(baselineActivation.success, false);
  assert.equal(baselineActivation.errorMsg, "TARGET_OUT_OF_RANGE");

  const burstActivation = scene.activateGenericModule(
    ownerSession,
    burstModule,
    "moduleBonusWarfareLinkMining",
  );
  assert.equal(burstActivation.success, true);
  flushDirectDestinyNotifications(scene);

  const boostedSnapshot = buildMiningModuleSnapshot({
    shipItem: {
      itemID: miner.itemID,
      typeID: miner.typeID,
      ownerID: miner.characterID,
      locationID: scene.systemID,
      itemName: miner.itemName,
    },
    moduleItem: minerModule,
    effectRecord: miningEffect,
    fittedItems: [minerModule],
    skillMap: new Map(),
    activeModuleContexts: [],
    additionalModifierEntries: commandBurstRuntime.collectModifierEntriesForItem(
      miner,
      minerModule,
      scene.getCurrentSimTimeMs(),
    ),
  });
  assert.ok(boostedSnapshot.maxRangeMeters > baselineSnapshot.maxRangeMeters);
  assert.ok(boostedSnapshot.maxRangeMeters >= asteroidSurfaceDistance);

  const boostedActivation = miningRuntime.resolveMiningActivation(
    scene,
    miner,
    minerModule,
    miningEffect,
    { targetID: asteroid.itemID },
  );
  assert.equal(boostedActivation.matched, true);
  assert.equal(boostedActivation.success, true);
});

serialTest("command burst dbuffs survive module stop and clear only when the timed buff actually expires", () => {
  const scene = runtime.ensureScene(30000144);
  const burstModule = buildModuleItem("Mining Foreman Burst I", 995400001, 995400000, 27);
  const burstCharge = buildChargeItem(
    "Mining Laser Field Enhancement Charge",
    995400002,
    995400000,
    burstModule.itemID,
    4,
  );
  const orca = buildRuntimeShipEntity(
    scene,
    "Orca",
    995400000,
    9540001,
    { x: 0, y: 0, z: 0 },
    [burstModule],
  );
  orca.nativeCargoItems = [burstCharge];
  const miner = buildRuntimeShipEntity(
    scene,
    "Venture",
    995400010,
    9540002,
    { x: 1_500, y: 0, z: 0 },
    [],
  );

  const { session: ownerSession } = attachSession(scene, orca, 9541001, 9540001);
  const {
    session: minerSession,
    notifications: minerNotifications,
    objectNotifications: minerObjectNotifications,
  } = attachSession(
    scene,
    miner,
    9541002,
    9540002,
  );
  joinSameFleet(ownerSession, minerSession);

  const activationResult = scene.activateGenericModule(
    ownerSession,
    burstModule,
    "moduleBonusWarfareLinkMining",
  );
  assert.equal(activationResult.success, true);
  flushDirectDestinyNotifications(scene);

  const initialCollections = getLatestCommandBurstDbuffCollectionIDs(
    minerNotifications,
    minerObjectNotifications,
  );
  assert.deepEqual(initialCollections, [23, 2474]);

  const deactivateResult = scene.deactivateGenericModule(ownerSession, burstModule.itemID, {
    deferUntilCycle: false,
  });
  assert.equal(deactivateResult.success, true);
  flushDirectDestinyNotifications(scene);

  minerNotifications.length = 0;
  const activeEffect = activationResult.data.effectState;
  const expiryAtMs =
    Number(activeEffect.startedAtMs || 0) +
    Number(activeEffect.commandBurstBuffDurationMs || 0);
  advanceSceneUntilSimTime(scene, expiryAtMs, 100);
  flushDirectDestinyNotifications(scene);

  assert.deepEqual(
    getLatestCommandBurstDbuffCollectionIDs(
      minerNotifications,
      minerObjectNotifications,
    ),
    [],
    "expected expiry to emit Michelle dbuff clear update",
  );
});

serialTest("all Orca command burst families and charges resolve their correct family FX and non-empty dbuffs", () => {
  const cases = [
    {
      moduleName: "Armor Command Burst I",
      effectName: "moduleBonusWarfareLinkArmor",
      chargeName: "Armor Energizing Charge",
      sourceFxGuid: "effects.WarfareLinkSphereArmor",
      targetFxGuid: "effects.WarfareLinkArmor",
    },
    {
      moduleName: "Armor Command Burst I",
      effectName: "moduleBonusWarfareLinkArmor",
      chargeName: "Rapid Repair Charge",
      sourceFxGuid: "effects.WarfareLinkSphereArmor",
      targetFxGuid: "effects.WarfareLinkArmor",
    },
    {
      moduleName: "Armor Command Burst I",
      effectName: "moduleBonusWarfareLinkArmor",
      chargeName: "Armor Reinforcement Charge",
      sourceFxGuid: "effects.WarfareLinkSphereArmor",
      targetFxGuid: "effects.WarfareLinkArmor",
    },
    {
      moduleName: "Information Command Burst I",
      effectName: "moduleBonusWarfareLinkInfo",
      chargeName: "Sensor Optimization Charge",
      sourceFxGuid: "effects.WarfareLinkSphereInformation",
      targetFxGuid: "effects.WarfareLinkInformation",
    },
    {
      moduleName: "Information Command Burst I",
      effectName: "moduleBonusWarfareLinkInfo",
      chargeName: "Electronic Superiority Charge",
      sourceFxGuid: "effects.WarfareLinkSphereInformation",
      targetFxGuid: "effects.WarfareLinkInformation",
    },
    {
      moduleName: "Information Command Burst I",
      effectName: "moduleBonusWarfareLinkInfo",
      chargeName: "Electronic Hardening Charge",
      sourceFxGuid: "effects.WarfareLinkSphereInformation",
      targetFxGuid: "effects.WarfareLinkInformation",
    },
    {
      moduleName: "Mining Foreman Burst I",
      effectName: "moduleBonusWarfareLinkMining",
      chargeName: "Mining Laser Field Enhancement Charge",
      sourceFxGuid: "effects.WarfareLinkSphereMining",
      targetFxGuid: "effects.WarfareLinkMining",
    },
    {
      moduleName: "Mining Foreman Burst I",
      effectName: "moduleBonusWarfareLinkMining",
      chargeName: "Mining Laser Optimization Charge",
      sourceFxGuid: "effects.WarfareLinkSphereMining",
      targetFxGuid: "effects.WarfareLinkMining",
    },
    {
      moduleName: "Mining Foreman Burst I",
      effectName: "moduleBonusWarfareLinkMining",
      chargeName: "Mining Equipment Preservation Charge",
      sourceFxGuid: "effects.WarfareLinkSphereMining",
      targetFxGuid: "effects.WarfareLinkMining",
    },
    {
      moduleName: "Shield Command Burst I",
      effectName: "moduleBonusWarfareLinkShield",
      chargeName: "Active Shielding Charge",
      sourceFxGuid: "effects.WarfareLinkSphereShield",
      targetFxGuid: "effects.WarfareLinkShield",
    },
    {
      moduleName: "Shield Command Burst I",
      effectName: "moduleBonusWarfareLinkShield",
      chargeName: "Shield Harmonizing Charge",
      sourceFxGuid: "effects.WarfareLinkSphereShield",
      targetFxGuid: "effects.WarfareLinkShield",
    },
    {
      moduleName: "Shield Command Burst I",
      effectName: "moduleBonusWarfareLinkShield",
      chargeName: "Shield Extension Charge",
      sourceFxGuid: "effects.WarfareLinkSphereShield",
      targetFxGuid: "effects.WarfareLinkShield",
    },
    {
      moduleName: "Skirmish Command Burst I",
      effectName: "moduleBonusWarfareLinkSkirmish",
      chargeName: "Evasive Maneuvers Charge",
      sourceFxGuid: "effects.WarfareLinkSphereSkirmish",
      targetFxGuid: "effects.WarfareLinkSkirmish",
    },
    {
      moduleName: "Skirmish Command Burst I",
      effectName: "moduleBonusWarfareLinkSkirmish",
      chargeName: "Interdiction Maneuvers Charge",
      sourceFxGuid: "effects.WarfareLinkSphereSkirmish",
      targetFxGuid: "effects.WarfareLinkSkirmish",
    },
    {
      moduleName: "Skirmish Command Burst I",
      effectName: "moduleBonusWarfareLinkSkirmish",
      chargeName: "Rapid Deployment Charge",
      sourceFxGuid: "effects.WarfareLinkSphereSkirmish",
      targetFxGuid: "effects.WarfareLinkSkirmish",
    },
  ];

  for (const [index, testCase] of cases.entries()) {
    const scene = runtime.ensureScene(30000142);
    const burstModule = buildModuleItem(
      testCase.moduleName,
      995500001 + (index * 100),
      995500000 + (index * 100),
      27,
    );
    const burstCharge = buildChargeItem(
      testCase.chargeName,
      995500002 + (index * 100),
      995500000 + (index * 100),
      burstModule.itemID,
      4,
    );
    const orca = buildRuntimeShipEntity(
      scene,
      "Orca",
      995500000 + (index * 100),
      9550001 + index,
      { x: 0, y: 0, z: 0 },
      [burstModule],
    );
    orca.nativeCargoItems = [burstCharge];
    const recipient = buildRuntimeShipEntity(
      scene,
      "Venture",
      995500010 + (index * 100),
      9551001 + index,
      { x: 1_500, y: 0, z: 0 },
      [],
    );

    const { session: ownerSession, notifications: ownerNotifications } = attachSession(
      scene,
      orca,
      9552001 + index,
      9550001 + index,
    );
    const {
      session: recipientSession,
      notifications: recipientNotifications,
      objectNotifications: recipientObjectNotifications,
    } = attachSession(
      scene,
      recipient,
      9553001 + index,
      9551001 + index,
    );
    joinSameFleet(ownerSession, recipientSession);

    const activationResult = scene.activateGenericModule(
      ownerSession,
      burstModule,
      testCase.effectName,
    );
    assert.equal(activationResult.success, true, `expected ${testCase.chargeName} to activate`);
    flushDirectDestinyNotifications(scene);

    const activeEffect = orca.activeModuleEffects.get(burstModule.itemID);
    assert.ok(activeEffect && activeEffect.commandBurstEffect === true);
    assert.equal(activeEffect.commandBurstSourceFxGuid, testCase.sourceFxGuid);
    assert.equal(activeEffect.commandBurstTargetFxGuid, testCase.targetFxGuid);

    const sourceFx = getSpecialFxEvents(ownerNotifications, testCase.sourceFxGuid)
      .find((entry) => Number(entry.args[7]) === 1 && Number(entry.args[8]) === 0);
    const targetFx = getSpecialFxEvents(recipientNotifications, testCase.targetFxGuid)
      .find((entry) => Number(entry.args[7]) === 1 && Number(entry.args[8]) === 0);
    assert.ok(sourceFx, `expected source FX for ${testCase.chargeName}`);
    assert.ok(targetFx, `expected target FX for ${testCase.chargeName}`);
    assert.equal(Number(sourceFx.args[9]), -1);
    assert.equal(Number(targetFx.args[9]), -1);

    const dbuffCollections = getLatestCommandBurstDbuffCollectionIDs(
      recipientNotifications,
      recipientObjectNotifications,
    );
    assert.ok(dbuffCollections.length > 0, `expected dbuffs for ${testCase.chargeName}`);

    runtime._testing.clearScenes();
    clearPersistedSystemState(30000142);
    fleetRuntime.runtimeState.nextFleetSerial = 1;
    fleetRuntime.runtimeState.fleets.clear();
    fleetRuntime.runtimeState.characterToFleet.clear();
    fleetRuntime.runtimeState.invitesByCharacter.clear();
  }
});

serialTest("all T2 command burst families activate on Claymore and emit family-correct FX and dbuffs", () => {
  const cases = [
    {
      moduleName: "Armor Command Burst II",
      effectName: "moduleBonusWarfareLinkArmor",
      chargeName: "Armor Reinforcement Charge",
      sourceFxGuid: "effects.WarfareLinkSphereArmor",
      targetFxGuid: "effects.WarfareLinkArmor",
    },
    {
      moduleName: "Information Command Burst II",
      effectName: "moduleBonusWarfareLinkInfo",
      chargeName: "Sensor Optimization Charge",
      sourceFxGuid: "effects.WarfareLinkSphereInformation",
      targetFxGuid: "effects.WarfareLinkInformation",
    },
    {
      moduleName: "Mining Foreman Burst II",
      effectName: "moduleBonusWarfareLinkMining",
      chargeName: "Mining Laser Optimization Charge",
      sourceFxGuid: "effects.WarfareLinkSphereMining",
      targetFxGuid: "effects.WarfareLinkMining",
    },
    {
      moduleName: "Shield Command Burst II",
      effectName: "moduleBonusWarfareLinkShield",
      chargeName: "Shield Extension Charge",
      sourceFxGuid: "effects.WarfareLinkSphereShield",
      targetFxGuid: "effects.WarfareLinkShield",
    },
    {
      moduleName: "Skirmish Command Burst II",
      effectName: "moduleBonusWarfareLinkSkirmish",
      chargeName: "Rapid Deployment Charge",
      sourceFxGuid: "effects.WarfareLinkSphereSkirmish",
      targetFxGuid: "effects.WarfareLinkSkirmish",
    },
  ];

  for (const [index, testCase] of cases.entries()) {
    const scene = runtime.ensureScene(30000142);
    const burstModule = buildModuleItem(
      testCase.moduleName,
      995580001 + (index * 100),
      995580000 + (index * 100),
      27,
    );
    const burstCharge = buildChargeItem(
      testCase.chargeName,
      995580002 + (index * 100),
      995580000 + (index * 100),
      burstModule.itemID,
      100,
    );
    const claymore = buildRuntimeShipEntity(
      scene,
      "Claymore",
      995580000 + (index * 100),
      9558001 + index,
      { x: 0, y: 0, z: 0 },
      [burstModule],
    );
    claymore.nativeCargoItems = [burstCharge];
    const recipient = buildRuntimeShipEntity(
      scene,
      "Venture",
      995580010 + (index * 100),
      9559001 + index,
      { x: 1_500, y: 0, z: 0 },
      [],
    );

    const { session: ownerSession, notifications: ownerNotifications } = attachSession(
      scene,
      claymore,
      9560001 + index,
      9558001 + index,
    );
    const {
      session: recipientSession,
      notifications: recipientNotifications,
      objectNotifications: recipientObjectNotifications,
    } = attachSession(
      scene,
      recipient,
      9561001 + index,
      9559001 + index,
    );
    joinSameFleet(ownerSession, recipientSession);

    const activationResult = scene.activateGenericModule(
      ownerSession,
      burstModule,
      testCase.effectName,
    );
    assert.equal(activationResult.success, true, `expected ${testCase.moduleName} to activate`);
    flushDirectDestinyNotifications(scene);

    const activeEffect = claymore.activeModuleEffects.get(burstModule.itemID);
    assert.ok(activeEffect && activeEffect.commandBurstEffect === true);
    assert.equal(activeEffect.commandBurstSourceFxGuid, testCase.sourceFxGuid);
    assert.equal(activeEffect.commandBurstTargetFxGuid, testCase.targetFxGuid);
    assert.equal(activeEffect.typeID, burstModule.typeID);

    const ownerSourceFx = getSpecialFxEvents(ownerNotifications, testCase.sourceFxGuid)
      .find((entry) => Number(entry.args[7]) === 1 && Number(entry.args[8]) === 0);
    const recipientTargetFx = getSpecialFxEvents(recipientNotifications, testCase.targetFxGuid)
      .find((entry) => Number(entry.args[7]) === 1 && Number(entry.args[8]) === 0);
    assert.ok(ownerSourceFx, `expected source FX for ${testCase.moduleName}`);
    assert.ok(recipientTargetFx, `expected target FX for ${testCase.moduleName}`);
    assert.equal(Number(ownerSourceFx.args[9]), -1);
    assert.equal(Number(recipientTargetFx.args[9]), -1);

    const dbuffCollections = getLatestCommandBurstDbuffCollectionIDs(
      recipientNotifications,
      recipientObjectNotifications,
    );
    assert.ok(dbuffCollections.length > 0, `expected dbuffs for ${testCase.moduleName}`);

    runtime._testing.clearScenes();
    clearPersistedSystemState(30000142);
    fleetRuntime.runtimeState.nextFleetSerial = 1;
    fleetRuntime.runtimeState.fleets.clear();
    fleetRuntime.runtimeState.characterToFleet.clear();
    fleetRuntime.runtimeState.invitesByCharacter.clear();
  }
});

serialTest("command burst source sphere FX carries client graphicInfo sized to the live burst range", () => {
  const scene = runtime.ensureScene(30000142);
  const burstModule = buildModuleItem(
    "Mining Foreman Burst II",
    995581001,
    995581000,
    27,
  );
  const burstCharge = buildChargeItem(
    "Mining Laser Optimization Charge",
    995581002,
    995581000,
    burstModule.itemID,
    100,
  );
  const orca = buildRuntimeShipEntity(
    scene,
    "Orca",
    995581000,
    9562001,
    { x: 0, y: 0, z: 0 },
    [burstModule],
  );
  orca.nativeCargoItems = [burstCharge];
  const recipient = buildRuntimeShipEntity(
    scene,
    "Venture",
    995581010,
    9562002,
    { x: 1_500, y: 0, z: 0 },
    [],
  );

  const { session: ownerSession, notifications: ownerNotifications } = attachSession(
    scene,
    orca,
    9562003,
    9562001,
  );
  const { session: recipientSession } = attachSession(
    scene,
    recipient,
    9562004,
    9562002,
  );
  joinSameFleet(ownerSession, recipientSession);

  const activationResult = scene.activateGenericModule(
    ownerSession,
    burstModule,
    "moduleBonusWarfareLinkMining",
  );
  assert.equal(activationResult.success, true);
  flushDirectDestinyNotifications(scene);

  const activeEffect = orca.activeModuleEffects.get(burstModule.itemID);
  assert.ok(activeEffect && activeEffect.commandBurstEffect === true);

  const sourceFx = getSpecialFxEvents(ownerNotifications, "effects.WarfareLinkSphereMining")
    .find((entry) => Number(entry.args[7]) === 1 && Number(entry.args[8]) === 0);
  assert.ok(sourceFx, "expected mining burst source FX");
  const graphicInfo = sourceFx.args[13];
  assert.ok(
    graphicInfo &&
      graphicInfo.type === "object" &&
      graphicInfo.name === "util.KeyVal",
    "expected util.KeyVal graphicInfo",
  );
  assert.equal(
    Number(getMarshalDictEntry(graphicInfo, "graphicRadius")),
    Number(activeEffect.commandBurstRangeMeters),
  );
  assert.equal(
    Number(getMarshalDictEntry(graphicInfo, "radius")),
    Number(activeEffect.commandBurstRangeMeters),
  );

  runtime._testing.clearScenes();
  clearPersistedSystemState(30000142);
  fleetRuntime.runtimeState.nextFleetSerial = 1;
  fleetRuntime.runtimeState.fleets.clear();
  fleetRuntime.runtimeState.characterToFleet.clear();
  fleetRuntime.runtimeState.invitesByCharacter.clear();
});

serialTest("deactivate-at-end-of-cycle command bursts deliver the owner stop Godma event", () => {
  const scene = runtime.ensureScene(30000142);
  const burstModule = buildModuleItem(
    "Information Command Burst II",
    995582001,
    995582000,
    27,
  );
  const burstCharge = buildChargeItem(
    "Sensor Optimization Charge",
    995582002,
    995582000,
    burstModule.itemID,
    100,
  );
  const orca = buildRuntimeShipEntity(
    scene,
    "Orca",
    995582000,
    9562101,
    { x: 0, y: 0, z: 0 },
    [burstModule],
  );
  orca.nativeCargoItems = [burstCharge];

  const { session: ownerSession, notifications: ownerNotifications } = attachSession(
    scene,
    orca,
    9562102,
    9562101,
  );

  const activationResult = scene.activateGenericModule(
    ownerSession,
    burstModule,
    "moduleBonusWarfareLinkInfo",
  );
  assert.equal(activationResult.success, true);
  flushDirectDestinyNotifications(scene);

  const effectState = orca.activeModuleEffects.get(burstModule.itemID);
  assert.ok(effectState && effectState.commandBurstEffect === true);

  const deactivateResult = scene.deactivateGenericModule(ownerSession, burstModule.itemID);
  assert.equal(deactivateResult.success, true);
  assert.equal(Boolean(deactivateResult.data && deactivateResult.data.pending), true);

  const ownerStopBeforeBoundary = getGodmaEffectNotifications(
    ownerNotifications,
    burstModule.itemID,
    false,
  );
  assert.equal(ownerStopBeforeBoundary.length, 0, "expected no immediate stop before cycle boundary");

  advanceSceneUntilSimTime(
    scene,
    Number(effectState.nextCycleAtMs || scene.getCurrentSimTimeMs()),
    150,
  );
  flushDirectDestinyNotifications(scene);

  const ownerStopAfterBoundary = getGodmaEffectNotifications(
    ownerNotifications,
    burstModule.itemID,
    false,
  );
  assert.ok(
    ownerStopAfterBoundary.length > 0,
    "expected owner OnGodmaShipEffect stop after deferred cycle-end deactivation",
  );
  assert.equal(orca.activeModuleEffects.has(burstModule.itemID), false);

  runtime._testing.clearScenes();
  clearPersistedSystemState(30000142);
  fleetRuntime.runtimeState.nextFleetSerial = 1;
  fleetRuntime.runtimeState.fleets.clear();
  fleetRuntime.runtimeState.characterToFleet.clear();
  fleetRuntime.runtimeState.invitesByCharacter.clear();
});

serialTest("non-mining Orca bursts refresh recipient ship derived stats, not just dbuff HUD state", () => {
  const cases = [
    {
      moduleName: "Armor Command Burst I",
      effectName: "moduleBonusWarfareLinkArmor",
      chargeName: "Armor Reinforcement Charge",
      expectedSourceFxGuid: "effects.WarfareLinkSphereArmor",
      expectedTargetFxGuid: "effects.WarfareLinkArmor",
      changedFieldCheck(before, after) {
        return after.armorHP > before.armorHP;
      },
    },
    {
      moduleName: "Information Command Burst I",
      effectName: "moduleBonusWarfareLinkInfo",
      chargeName: "Sensor Optimization Charge",
      expectedSourceFxGuid: "effects.WarfareLinkSphereInformation",
      expectedTargetFxGuid: "effects.WarfareLinkInformation",
      changedFieldCheck(before, after) {
        return after.maxTargetRange > before.maxTargetRange || after.scanResolution > before.scanResolution;
      },
    },
    {
      moduleName: "Shield Command Burst I",
      effectName: "moduleBonusWarfareLinkShield",
      chargeName: "Shield Extension Charge",
      expectedSourceFxGuid: "effects.WarfareLinkSphereShield",
      expectedTargetFxGuid: "effects.WarfareLinkShield",
      changedFieldCheck(before, after) {
        return after.shieldCapacity > before.shieldCapacity;
      },
    },
    {
      moduleName: "Skirmish Command Burst I",
      effectName: "moduleBonusWarfareLinkSkirmish",
      chargeName: "Evasive Maneuvers Charge",
      expectedSourceFxGuid: "effects.WarfareLinkSphereSkirmish",
      expectedTargetFxGuid: "effects.WarfareLinkSkirmish",
      changedFieldCheck(before, after) {
        return (
          after.signatureRadius !== before.signatureRadius ||
          after.inertia !== before.inertia ||
          after.maxVelocity !== before.maxVelocity
        );
      },
    },
  ];

  for (const [index, testCase] of cases.entries()) {
    const scene = runtime.ensureScene(30000145);
    const burstModule = buildModuleItem(
      testCase.moduleName,
      995600001 + (index * 100),
      995600000 + (index * 100),
      27,
    );
    const burstCharge = buildChargeItem(
      testCase.chargeName,
      995600002 + (index * 100),
      995600000 + (index * 100),
      burstModule.itemID,
      4,
    );
    const orca = buildRuntimeShipEntity(
      scene,
      "Orca",
      995600000 + (index * 100),
      9560001 + index,
      { x: 0, y: 0, z: 0 },
      [burstModule],
    );
    orca.nativeCargoItems = [burstCharge];
    const recipient = buildRuntimeShipEntity(
      scene,
      "Venture",
      995600010 + (index * 100),
      9561001 + index,
      { x: 1_500, y: 0, z: 0 },
      [],
    );

    const { session: ownerSession, notifications: ownerNotifications } = attachSession(
      scene,
      orca,
      9562001 + index,
      9560001 + index,
    );
    const { session: recipientSession, notifications: recipientNotifications } = attachSession(
      scene,
      recipient,
      9563001 + index,
      9561001 + index,
    );
    joinSameFleet(ownerSession, recipientSession);
    scene.refreshShipEntityDerivedState(recipient, {
      broadcast: false,
      notifyTargeting: false,
    });

    const beforeSnapshot = buildShipStatSnapshot(recipient);

    const activationResult = scene.activateGenericModule(
      ownerSession,
      burstModule,
      testCase.effectName,
    );
    assert.equal(activationResult.success, true);
    flushDirectDestinyNotifications(scene);

    const afterSnapshot = buildShipStatSnapshot(recipient);
    assert.ok(
      testCase.changedFieldCheck(beforeSnapshot, afterSnapshot),
      `expected ${testCase.chargeName} to change ship stats`,
    );

    const sourceFx = getSpecialFxEvents(ownerNotifications, testCase.expectedSourceFxGuid)
      .find((entry) => Number(entry.args[7]) === 1 && Number(entry.args[8]) === 0);
    const targetFx = getSpecialFxEvents(recipientNotifications, testCase.expectedTargetFxGuid)
      .find((entry) => Number(entry.args[7]) === 1 && Number(entry.args[8]) === 0);
    assert.ok(sourceFx, `expected ${testCase.expectedSourceFxGuid}`);
    assert.ok(targetFx, `expected ${testCase.expectedTargetFxGuid}`);
    assert.equal(Number(sourceFx.args[9]), -1);
    assert.equal(Number(targetFx.args[9]), -1);

    runtime._testing.clearScenes();
    clearPersistedSystemState(30000145);
    fleetRuntime.runtimeState.nextFleetSerial = 1;
    fleetRuntime.runtimeState.fleets.clear();
    fleetRuntime.runtimeState.characterToFleet.clear();
    fleetRuntime.runtimeState.invitesByCharacter.clear();
  }
});
