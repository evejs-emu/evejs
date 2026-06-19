const path = require("path");

const runtime = require(path.join(__dirname, "../src/space/runtime"));

function createSession(shipID) {
  const notifications = [];
  return {
    characterID: 140000003,
    notifications,
    _space: {
      shipID,
      simTimeMs: 1775139000000,
      simFileTime: 133000000000000000,
      timeDilation: 1,
      initialStateSent: true,
    },
    socket: {
      destroyed: false,
    },
    sendNotification(name, source, payload) {
      notifications.push({ name, source, payload });
    },
  };
}

function createShipEntity(itemID, session = null) {
  return {
    itemID,
    ownerID: 140000003,
    kind: "ship",
    radius: 50,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    direction: { x: 0, y: 0, z: 1 },
    session,
    activeModuleEffects: new Map(),
    moduleReactivationLocks: new Map(),
    lockedTargets: new Map(),
    pendingTargetLocks: new Map(),
    targetedBy: new Set(),
  };
}

function createGenericWeaponEffect(moduleID, targetID) {
  return {
    moduleID,
    moduleFlagID: 27,
    effectID: 10,
    effectName: "useMissiles",
    guid: "effects.MissileDeployment",
    typeID: 506,
    startedAtMs: 1775139000000,
    durationMs: 6000,
    reactivationDelayMs: 0,
    repeat: -1,
    targetID,
    chargeTypeID: 2046,
    weaponFamily: "missileLauncher",
    deactivationRequestedAtMs: 0,
    deactivateAtMs: 0,
    stopReason: null,
    isGeneric: true,
    affectsShipDerivedState: false,
    capNeed: 0,
    durationAttributeID: 51,
  };
}

function extractStopNotifications(session, moduleID) {
  return session.notifications.filter((entry) => (
    entry &&
    entry.name === "OnGodmaShipEffect" &&
    Array.isArray(entry.payload) &&
    Number(entry.payload[0]) === Number(moduleID) &&
    Number(entry.payload[3]) === 0
  ));
}

function buildScene() {
  const Scene = runtime._testing.SolarSystemScene;
  const scene = new Scene(30000142);
  scene.dynamicEntities.clear();
  scene.simTimeMs = 1775139000000;
  return scene;
}

function runOrphanedEffectCleanupCase() {
  const scene = buildScene();
  const session = createSession(910000000000001);
  const sourceEntity = createShipEntity(session._space.shipID, session);
  const targetEntity = createShipEntity(910000000000002, null);
  const unrelatedTargetEntity = createShipEntity(910000000000003, null);

  sourceEntity.activeModuleEffects.set(
    920000000000001,
    createGenericWeaponEffect(920000000000001, targetEntity.itemID),
  );
  sourceEntity.activeModuleEffects.set(
    920000000000002,
    createGenericWeaponEffect(920000000000002, unrelatedTargetEntity.itemID),
  );

  scene.dynamicEntities.set(sourceEntity.itemID, sourceEntity);
  scene.dynamicEntities.set(targetEntity.itemID, targetEntity);
  scene.dynamicEntities.set(unrelatedTargetEntity.itemID, unrelatedTargetEntity);

  scene.clearAllTargetingForEntity(targetEntity, {
    notifySelf: false,
    notifyTarget: false,
    reason: "exploding",
  });

  return {
    stoppedDestroyedTargetEffect:
      sourceEntity.activeModuleEffects.has(920000000000001) === false,
    preservedUnrelatedTargetEffect:
      sourceEntity.activeModuleEffects.has(920000000000002) === true,
    destroyedTargetStopNotifications:
      extractStopNotifications(session, 920000000000001).length,
    unrelatedTargetStopNotifications:
      extractStopNotifications(session, 920000000000002).length,
  };
}

function runLockedTargetCleanupCase() {
  const scene = buildScene();
  const session = createSession(910000000000011);
  const sourceEntity = createShipEntity(session._space.shipID, session);
  const targetEntity = createShipEntity(910000000000012, null);

  sourceEntity.lockedTargets.set(targetEntity.itemID, {
    targetID: targetEntity.itemID,
    sequence: 1,
    acquiredAtMs: 1775138999000,
  });
  targetEntity.targetedBy.add(sourceEntity.itemID);
  sourceEntity.activeModuleEffects.set(
    920000000000011,
    createGenericWeaponEffect(920000000000011, targetEntity.itemID),
  );

  scene.dynamicEntities.set(sourceEntity.itemID, sourceEntity);
  scene.dynamicEntities.set(targetEntity.itemID, targetEntity);

  scene.clearAllTargetingForEntity(targetEntity, {
    notifySelf: false,
    notifyTarget: false,
    reason: "exploding",
  });

  return {
    lockCleared: sourceEntity.lockedTargets.has(targetEntity.itemID) === false,
    stoppedLockedTargetEffect:
      sourceEntity.activeModuleEffects.has(920000000000011) === false,
    lockedTargetStopNotifications:
      extractStopNotifications(session, 920000000000011).length,
  };
}

const orphanedCase = runOrphanedEffectCleanupCase();
const lockedCase = runLockedTargetCleanupCase();

if (!orphanedCase.stoppedDestroyedTargetEffect) {
  throw new Error("Destroyed-target orphaned module effect was not stopped.");
}
if (!orphanedCase.preservedUnrelatedTargetEffect) {
  throw new Error("Unrelated target effect was incorrectly stopped.");
}
if (orphanedCase.destroyedTargetStopNotifications <= 0) {
  throw new Error("Destroyed-target orphaned module effect did not notify owner stop.");
}
if (orphanedCase.unrelatedTargetStopNotifications !== 0) {
  throw new Error("Unrelated target effect emitted an unexpected stop.");
}
if (!lockedCase.lockCleared) {
  throw new Error("Locked target was not cleared.");
}
if (!lockedCase.stoppedLockedTargetEffect) {
  throw new Error("Locked target module effect was not stopped.");
}
if (lockedCase.lockedTargetStopNotifications <= 0) {
  throw new Error("Locked target cleanup did not notify owner stop.");
}

console.log(JSON.stringify({
  orphanedCase,
  lockedCase,
}, null, 2));
