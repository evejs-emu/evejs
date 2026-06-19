const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..", "..");

const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const hostileModuleRuntime = require(path.join(
  repoRoot,
  "server/src/space/modules/hostileModuleRuntime",
));
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
    nativeNpc: options.nativeNpc === undefined ? true : options.nativeNpc === true,
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

serialTest("stasis webifier applies max-velocity debuff and hostile HUD state", () => {
  spaceRuntime._testing.clearScenes();
  const scene = spaceRuntime.ensureScene(30000142);

  const webModule = buildModuleItem("Stasis Webifier II", 71001, 91001, 19);
  const sourceEntity = buildRuntimeShipEntity(
    scene,
    "Guardian",
    91001,
    140000101,
    { x: 0, y: 0, z: 0 },
    [webModule],
  );
  const targetEntity = buildRuntimeShipEntity(
    scene,
    "Basilisk",
    91002,
    140000102,
    { x: 7_500, y: 0, z: 0 },
    [],
  );
  const { session: sourceSession } = attachSession(scene, sourceEntity, 51001, 140000101);
  const { notifications: targetNotifications } = attachSession(scene, targetEntity, 51002, 140000102);
  primeTargetLock(sourceEntity, targetEntity, scene);
  scene.refreshShipEntityDerivedState(targetEntity, {
    session: targetEntity.session,
    broadcast: false,
    notifyTargeting: false,
  });
  const previousMaxVelocity = Number(targetEntity.maxVelocity) || 0;

  const activationResult = scene.activateGenericModule(sourceSession, webModule, null, {
    targetID: targetEntity.itemID,
  });
  assert.equal(activationResult.success, true);
  assert.ok(Number(targetEntity.maxVelocity) < previousMaxVelocity);
  assert.ok(Number(targetEntity.maxVelocity) > 0);
  assert.ok(getNotificationNames(targetNotifications).includes("OnJamStart"));
  assert.ok(getNotificationNames(targetNotifications).includes("OnEwarStart"));
});

serialTest("hostile HUD timer refresh keeps a full cycle duration after the first loop", () => {
  spaceRuntime._testing.clearScenes();
  const scene = spaceRuntime.ensureScene(30000142);

  const webModule = buildModuleItem("Stasis Webifier II", 71011, 91011, 19);
  const sourceEntity = buildRuntimeShipEntity(
    scene,
    "Guardian",
    91011,
    140000103,
    { x: 0, y: 0, z: 0 },
    [webModule],
  );
  const targetEntity = buildRuntimeShipEntity(
    scene,
    "Basilisk",
    91012,
    140000104,
    { x: 7_500, y: 0, z: 0 },
    [],
  );
  const { session: sourceSession } = attachSession(scene, sourceEntity, 51011, 140000103);
  const { notifications: targetNotifications } = attachSession(scene, targetEntity, 51012, 140000104);
  primeTargetLock(sourceEntity, targetEntity, scene);

  const activationResult = scene.activateGenericModule(sourceSession, webModule, null, {
    targetID: targetEntity.itemID,
  });
  assert.equal(activationResult.success, true);

  const effectState = sourceEntity.activeModuleEffects.get(webModule.itemID);
  assert.ok(effectState, "expected hostile module effect state after activation");
  targetNotifications.length = 0;

  advanceSceneUntilSimTime(scene, effectState.nextCycleAtMs, 25);

  const jamStartsAfterCycle = targetNotifications.filter((entry) => entry.name === "OnJamStart");
  assert.ok(jamStartsAfterCycle.length >= 1, "expected hostile HUD timer refresh after a web cycle");

  const latestJamStart = jamStartsAfterCycle[jamStartsAfterCycle.length - 1];
  const refreshedDurationMs = Number(latestJamStart && latestJamStart.payload && latestJamStart.payload[5]) || 0;
  assert.ok(
    refreshedDurationMs > Number(effectState.durationMs),
    `expected hostile HUD timer refresh to carry a full cycle duration, got ${refreshedDurationMs}ms for a ${Number(effectState.durationMs)}ms cycle`,
  );
});

serialTest("target painter applies signature-radius debuff", () => {
  spaceRuntime._testing.clearScenes();
  const scene = spaceRuntime.ensureScene(30000143);

  const painterModule = buildModuleItem("Target Painter II", 72001, 92001, 19);
  const sourceEntity = buildRuntimeShipEntity(
    scene,
    "Scimitar",
    92001,
    140000111,
    { x: 0, y: 0, z: 0 },
    [painterModule],
  );
  const targetEntity = buildRuntimeShipEntity(
    scene,
    "Guardian",
    92002,
    140000112,
    { x: 10_000, y: 0, z: 0 },
    [],
  );
  const { session: sourceSession } = attachSession(scene, sourceEntity, 52001, 140000111);
  attachSession(scene, targetEntity, 52002, 140000112);
  primeTargetLock(sourceEntity, targetEntity, scene);
  scene.refreshShipEntityDerivedState(targetEntity, {
    session: targetEntity.session,
    broadcast: false,
    notifyTargeting: false,
  });
  const previousSignatureRadius = Number(targetEntity.signatureRadius) || 0;

  const activationResult = scene.activateGenericModule(sourceSession, painterModule, null, {
    targetID: targetEntity.itemID,
  });
  assert.equal(activationResult.success, true);
  assert.ok(Number(targetEntity.signatureRadius) > previousSignatureRadius);
});

serialTest("warp scrambler stops MWD and blocks warp and MJD", () => {
  spaceRuntime._testing.clearScenes();
  const scene = spaceRuntime.ensureScene(30000144);

  const scramModule = buildModuleItem("Warp Scrambler II", 73001, 93001, 19);
  const mwdModule = buildModuleItem("50MN Microwarpdrive I", 73002, 93002, 27);
  const mjdModule = buildModuleItem("Large Micro Jump Drive", 73003, 93002, 28);
  const sourceEntity = buildRuntimeShipEntity(
    scene,
    "Guardian",
    93001,
    140000121,
    { x: 0, y: 0, z: 0 },
    [scramModule],
  );
  const targetEntity = buildRuntimeShipEntity(
    scene,
    "Orca",
    93002,
    140000122,
    { x: 8_000, y: 0, z: 0 },
    [mwdModule, mjdModule],
  );
  const { session: sourceSession } = attachSession(scene, sourceEntity, 53001, 140000121);
  const { session: targetSession, notifications: targetNotifications } = attachSession(
    scene,
    targetEntity,
    53002,
    140000122,
  );
  primeTargetLock(sourceEntity, targetEntity, scene);

  const mwdActivation = scene.activatePropulsionModule(
    targetSession,
    mwdModule,
    "moduleBonusMicrowarpdrive",
  );
  assert.equal(mwdActivation.success, true);
  assert.ok(targetEntity.activeModuleEffects.has(mwdModule.itemID));

  const scramActivation = scene.activateGenericModule(sourceSession, scramModule, null, {
    targetID: targetEntity.itemID,
  });
  assert.equal(scramActivation.success, true);
  assert.equal(targetEntity.activeModuleEffects.has(mwdModule.itemID), false);
  assert.equal(hostileModuleRuntime.isEntityWarpScrambled(targetEntity), true);

  const mjdActivation = scene.activateGenericModule(targetSession, mjdModule, null, {});
  assert.equal(mjdActivation.success, false);
  assert.equal(mjdActivation.errorMsg, "MICRO_JUMP_DRIVE_BLOCKED");

  const warpResult = scene.warpToPoint(targetSession, { x: 40_000, y: 0, z: 0 });
  assert.equal(warpResult.success, false);
  assert.equal(warpResult.errorMsg, "WARP_SCRAMBLED");
  assert.ok(getNotificationNames(targetNotifications).includes("OnJamStart"));
});

serialTest("warp disruptor blocks warp but does not kill active MWD", () => {
  spaceRuntime._testing.clearScenes();
  const scene = spaceRuntime.ensureScene(30000145);

  const disruptModule = buildModuleItem("Warp Disruptor II", 74001, 94001, 19);
  const mwdModule = buildModuleItem("50MN Microwarpdrive I", 74002, 94002, 27);
  const sourceEntity = buildRuntimeShipEntity(
    scene,
    "Guardian",
    94001,
    140000131,
    { x: 0, y: 0, z: 0 },
    [disruptModule],
  );
  const targetEntity = buildRuntimeShipEntity(
    scene,
    "Orca",
    94002,
    140000132,
    { x: 20_000, y: 0, z: 0 },
    [mwdModule],
  );
  const { session: sourceSession } = attachSession(scene, sourceEntity, 54001, 140000131);
  const { session: targetSession } = attachSession(scene, targetEntity, 54002, 140000132);
  primeTargetLock(sourceEntity, targetEntity, scene);

  const mwdActivation = scene.activatePropulsionModule(
    targetSession,
    mwdModule,
    "moduleBonusMicrowarpdrive",
  );
  assert.equal(mwdActivation.success, true);

  const disruptActivation = scene.activateGenericModule(sourceSession, disruptModule, null, {
    targetID: targetEntity.itemID,
  });
  assert.equal(disruptActivation.success, true);
  assert.equal(targetEntity.activeModuleEffects.has(mwdModule.itemID), true);
  assert.equal(hostileModuleRuntime.isEntityWarpScrambled(targetEntity), true);
});

serialTest("energy neutralizer drains target capacitor on cycle", () => {
  spaceRuntime._testing.clearScenes();
  const scene = spaceRuntime.ensureScene(30000146);

  const neutModule = buildModuleItem("Medium Energy Neutralizer II", 75001, 95001, 27);
  const sourceEntity = buildRuntimeShipEntity(
    scene,
    "Guardian",
    95001,
    140000141,
    { x: 0, y: 0, z: 0 },
    [neutModule],
  );
  const targetEntity = buildRuntimeShipEntity(
    scene,
    "Basilisk",
    95002,
    140000142,
    { x: 9_000, y: 0, z: 0 },
    [],
  );
  const { session: sourceSession } = attachSession(scene, sourceEntity, 55001, 140000141);
  const { session: targetSession } = attachSession(scene, targetEntity, 55002, 140000142);
  primeTargetLock(sourceEntity, targetEntity, scene);
  scene.setShipCapacitorRatio(targetSession, 1);
  const beforeAmount = targetEntity.capacitorCapacity * targetEntity.capacitorChargeRatio;

  const activationResult = scene.activateGenericModule(sourceSession, neutModule, null, {
    targetID: targetEntity.itemID,
  });
  assert.equal(activationResult.success, true);
  const afterAmount = targetEntity.capacitorCapacity * targetEntity.capacitorChargeRatio;
  assert.ok(afterAmount < beforeAmount);
});

serialTest("energy nosferatu transfers capacitor only when source is below target", () => {
  spaceRuntime._testing.clearScenes();
  const scene = spaceRuntime.ensureScene(30000147);

  const nosModule = buildModuleItem("Medium Energy Nosferatu II", 76001, 96001, 27);
  const sourceEntity = buildRuntimeShipEntity(
    scene,
    "Guardian",
    96001,
    140000151,
    { x: 0, y: 0, z: 0 },
    [nosModule],
  );
  const targetEntity = buildRuntimeShipEntity(
    scene,
    "Basilisk",
    96002,
    140000152,
    { x: 9_000, y: 0, z: 0 },
    [],
  );
  const { session: sourceSession } = attachSession(scene, sourceEntity, 56001, 140000151);
  const { session: targetSession } = attachSession(scene, targetEntity, 56002, 140000152);
  primeTargetLock(sourceEntity, targetEntity, scene);

  scene.setShipCapacitorRatio(sourceSession, 0.1);
  scene.setShipCapacitorRatio(targetSession, 0.9);
  const sourceBeforeAmount = sourceEntity.capacitorCapacity * sourceEntity.capacitorChargeRatio;
  const targetBeforeAmount = targetEntity.capacitorCapacity * targetEntity.capacitorChargeRatio;

  const activationResult = scene.activateGenericModule(sourceSession, nosModule, null, {
    targetID: targetEntity.itemID,
  });
  assert.equal(activationResult.success, true);
  const sourceAfterAmount = sourceEntity.capacitorCapacity * sourceEntity.capacitorChargeRatio;
  const targetAfterAmount = targetEntity.capacitorCapacity * targetEntity.capacitorChargeRatio;
  assert.ok(sourceAfterAmount > sourceBeforeAmount);
  assert.ok(targetAfterAmount < targetBeforeAmount);
});

serialTest("fresh acquire replays active hostile FX for late observers", () => {
  const cases = [
    ["Stasis Webifier II", "effects.ModifyTargetSpeed"],
    ["Target Painter II", "effects.TargetPaint"],
    ["Warp Scrambler II", "effects.WarpScramble"],
    ["Warp Disruptor II", "effects.WarpDisrupt"],
    ["Medium Energy Neutralizer II", "effects.EnergyDestabilization"],
    ["Medium Energy Nosferatu II", "effects.EnergyVampire"],
  ];

  cases.forEach(([moduleName, guid], index) => {
    spaceRuntime._testing.clearScenes();
    const scene = spaceRuntime.ensureScene(30000160 + index);
    const sourceShipID = 980000 + (index * 10);
    const targetShipID = sourceShipID + 1;
    const observerShipID = sourceShipID + 2;
    const moduleItem = buildModuleItem(moduleName, sourceShipID + 3, sourceShipID, 19);
    const sourceEntity = buildRuntimeShipEntity(
      scene,
      "Guardian",
      sourceShipID,
      sourceShipID + 1000,
      { x: 0, y: 0, z: 0 },
      [moduleItem],
      {
        nativeNpc: false,
      },
    );
    const targetEntity = buildRuntimeShipEntity(
      scene,
      "Basilisk",
      targetShipID,
      targetShipID + 1000,
      { x: 6_000, y: 0, z: 0 },
      [],
      {
        nativeNpc: false,
      },
    );
    const observerEntity = buildRuntimeShipEntity(
      scene,
      "Guardian",
      observerShipID,
      observerShipID + 1000,
      { x: 1_500, y: 0, z: 0 },
      [],
      {
        nativeNpc: false,
      },
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

    const activationResult = scene.activateGenericModule(sourceSession, moduleItem, null, {
      targetID: targetEntity.itemID,
    });
    assert.equal(activationResult.success, true, `expected ${moduleName} to activate`);
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
    assert.equal(acquireResult.delivered, true, `expected ${moduleName} fresh acquire delivery`);
    flushDirectDestinyNotifications(scene);

    const effectState = sourceEntity.activeModuleEffects.get(moduleItem.itemID);
    assert.ok(effectState, `expected active effect state for ${moduleName}`);

    const replayFx = getSpecialFxEvents(observerNotifications, guid).find(
      (entry) => Number(entry.args[7]) === 1 && Number(entry.args[8]) === 1,
    );
    assertSpecialFxPayload(replayFx, {
      moduleID: moduleItem.itemID,
      moduleTypeID: moduleItem.typeID,
      targetID: targetEntity.itemID,
      chargeTypeID: null,
      guid,
      isOffensive: false,
      start: true,
      active: true,
      duration: effectState.durationMs,
    });
  });
  spaceRuntime._testing.clearScenes();
});

serialTest("fresh acquire replays hostile FX with NPC hardpoint presentation keyed by shipID", () => {
  spaceRuntime._testing.clearScenes();
  const scene = spaceRuntime.ensureScene(30000172);
  const sourceShipID = 982000;
  const targetShipID = sourceShipID + 1;
  const observerShipID = sourceShipID + 2;
  const moduleItem = buildModuleItem("Stasis Webifier II", sourceShipID + 3, sourceShipID, 19);
  const sourceEntity = buildRuntimeShipEntity(
    scene,
    "Guardian",
    sourceShipID,
    sourceShipID + 1000,
    { x: 0, y: 0, z: 0 },
    [moduleItem],
    {
      nativeNpc: true,
    },
  );
  const targetEntity = buildRuntimeShipEntity(
    scene,
    "Basilisk",
    targetShipID,
    targetShipID + 1000,
    { x: 6_000, y: 0, z: 0 },
    [],
    {
      nativeNpc: false,
    },
  );
  const observerEntity = buildRuntimeShipEntity(
    scene,
    "Guardian",
    observerShipID,
    observerShipID + 1000,
    { x: 1_500, y: 0, z: 0 },
    [],
    {
      nativeNpc: false,
    },
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

  const activationResult = scene.activateGenericModule(sourceSession, moduleItem, null, {
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

  const effectState = sourceEntity.activeModuleEffects.get(moduleItem.itemID);
  assert.ok(effectState, "expected active hostile effect state");
  const replayFx = getSpecialFxEvents(observerNotifications, "effects.ModifyTargetSpeed").find(
    (entry) => Number(entry.args[7]) === 1 && Number(entry.args[8]) === 1,
  );
  assertSpecialFxPayload(replayFx, {
    moduleID: sourceEntity.itemID,
    moduleTypeID: moduleItem.typeID,
    targetID: targetEntity.itemID,
    chargeTypeID: null,
    guid: "effects.ModifyTargetSpeed",
    isOffensive: false,
    start: true,
    active: true,
    duration: effectState.durationMs,
  });
  spaceRuntime._testing.clearScenes();
});

serialTest("hostile effects opt into fresh-acquire replay metadata", () => {
  const cases = [
    ["Stasis Webifier II", "effects.ModifyTargetSpeed"],
    ["Target Painter II", "effects.TargetPaint"],
    ["Warp Scrambler II", "effects.WarpScramble"],
    ["Warp Disruptor II", "effects.WarpDisrupt"],
    ["Medium Energy Neutralizer II", "effects.EnergyDestabilization"],
    ["Medium Energy Nosferatu II", "effects.EnergyVampire"],
  ];

  cases.forEach(([moduleName, guid], index) => {
    spaceRuntime._testing.clearScenes();
    const scene = spaceRuntime.ensureScene(30000148 + index);
    const sourceShipID = 970000 + (index * 10);
    const targetShipID = sourceShipID + 1;
    const moduleItem = buildModuleItem(moduleName, sourceShipID + 3, sourceShipID, 19);
    const sourceEntity = buildRuntimeShipEntity(
      scene,
      "Guardian",
      sourceShipID,
      sourceShipID + 1000,
      { x: 0, y: 0, z: 0 },
      [moduleItem],
    );
    const targetEntity = buildRuntimeShipEntity(
      scene,
      "Basilisk",
      targetShipID,
      targetShipID + 1000,
      { x: 6_000, y: 0, z: 0 },
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

    const activationResult = scene.activateGenericModule(sourceSession, moduleItem, null, {
      targetID: targetEntity.itemID,
    });
    assert.equal(activationResult.success, true, `expected ${moduleName} to activate`);
    const effectState = sourceEntity.activeModuleEffects.get(moduleItem.itemID);
    assert.ok(effectState, `expected active effect state for ${moduleName}`);
    assert.equal(effectState.forceFreshAcquireSpecialFxReplay, true);
    assert.equal(String(effectState.guid || ""), guid);
  });
  spaceRuntime._testing.clearScenes();
});
