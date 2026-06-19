const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const DogmaService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dogmaService",
));

const DEFAULT_PASSIVE_STATE = Object.freeze({
  mass: 1_000_000,
  agility: 0.5,
  maxVelocity: 300,
  maxTargetRange: 250_000,
  maxLockedTargets: 7,
  signatureRadius: 50,
  scanResolution: 500,
  cloakingTargetingDelay: 0,
  capacitorCapacity: 1000,
  capacitorRechargeRate: 1000,
  shieldCapacity: 1000,
  shieldRechargeRate: 1000,
  armorHP: 1000,
  structureHP: 1000,
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
  const serviceNotifications = [];
  const session = {
    clientID,
    characterID,
    _space: {
      systemID: scene.systemID,
      shipID: entity.itemID,
      initialStateSent: false,
      visibleDynamicEntityIDs: new Set(),
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
  scene.sessions.set(clientID, session);
  return { session, notifications, serviceNotifications };
}

function advanceScene(scene, deltaMs) {
  const baseWallclock = scene.getCurrentWallclockMs();
  scene.tick(baseWallclock + Math.max(0, Number(deltaMs) || 0));
}

function getTargetNotifications(notifications) {
  return notifications.filter((entry) => entry.name === "OnTarget");
}

function getTargetServiceNotifications(notifications) {
  return notifications.filter((entry) => entry.serviceName === "target");
}

test.afterEach(() => {
  spaceRuntime._testing.clearScenes();
});

test("pending locks complete and emit add/otheradd", () => {
  const scene = spaceRuntime.ensureScene(30000142);
  const attacker = buildShipEntity(scene, 910001, 0);
  const target = buildShipEntity(scene, 910002, 10_000);
  const attackerSession = attachSession(scene, attacker, 1);
  const targetSession = attachSession(scene, target, 2);

  const addResult = scene.addTarget(attackerSession.session, target.itemID);

  assert.equal(addResult.success, true);
  assert.equal(addResult.data.pending, true);
  assert.deepEqual(scene.getTargets(attackerSession.session), []);

  advanceScene(scene, addResult.data.lockDurationMs + 100);

  assert.deepEqual(scene.getTargets(attackerSession.session), [target.itemID]);
  assert.deepEqual(scene.getTargeters(targetSession.session), [attacker.itemID]);
  assert.deepEqual(getTargetNotifications(attackerSession.notifications), [
    {
      name: "OnTarget",
      idType: "clientID",
      payload: ["add", target.itemID],
    },
  ]);
  assert.deepEqual(getTargetNotifications(targetSession.notifications), [
    {
      name: "OnTarget",
      idType: "clientID",
      payload: ["otheradd", attacker.itemID],
    },
  ]);
});

test("CancelAddTarget prevents completion without sending a duplicate failure notification", () => {
  const scene = spaceRuntime.ensureScene(30000142);
  const attacker = buildShipEntity(scene, 920001, 0);
  const target = buildShipEntity(scene, 920002, 10_000);
  const attackerSession = attachSession(scene, attacker, 1);
  const targetSession = attachSession(scene, target, 2);

  const addResult = scene.addTarget(attackerSession.session, target.itemID);
  assert.equal(addResult.success, true);
  assert.equal(addResult.data.pending, true);

  const cancelResult = scene.cancelAddTarget(attackerSession.session, target.itemID, {
    notifySelf: false,
  });
  assert.equal(cancelResult.success, true);
  assert.equal(cancelResult.data.cancelled, true);

  advanceScene(scene, addResult.data.lockDurationMs + 100);

  assert.deepEqual(scene.getTargets(attackerSession.session), []);
  assert.deepEqual(scene.getTargeters(targetSession.session), []);
  assert.deepEqual(getTargetNotifications(attackerSession.notifications), []);
  assert.deepEqual(getTargetNotifications(targetSession.notifications), []);
});

test("pending locks interrupted by warp fail through the client target service and can be retried", () => {
  const scene = spaceRuntime.ensureScene(30000142);
  const attacker = buildShipEntity(scene, 925001, 0);
  const target = buildShipEntity(scene, 925002, 10_000);
  const attackerSession = attachSession(scene, attacker, 1);
  attachSession(scene, target, 2);

  const addResult = scene.addTarget(attackerSession.session, target.itemID);
  assert.equal(addResult.success, true);
  assert.equal(addResult.data.pending, true);

  attacker.pendingWarp = {
    requestedAtMs: scene.getCurrentSimTimeMs(),
  };
  scene.validateEntityTargetLocks(attacker, scene.getCurrentSimTimeMs());

  assert.deepEqual(scene.getTargets(attackerSession.session), []);
  assert.deepEqual(getTargetNotifications(attackerSession.notifications), []);
  assert.deepEqual(getTargetServiceNotifications(attackerSession.serviceNotifications), [
    {
      serviceName: "target",
      methodName: "FailLockTarget",
      payload: [target.itemID],
    },
  ]);

  attacker.pendingWarp = null;
  const retryResult = scene.addTarget(attackerSession.session, target.itemID);
  assert.equal(retryResult.success, true);
  assert.equal(retryResult.data.pending, true);
});

test("unlock emits lost/otherlost and clears live target state", () => {
  const scene = spaceRuntime.ensureScene(30000142);
  const attacker = buildShipEntity(scene, 930001, 0);
  const target = buildShipEntity(scene, 930002, 10_000);
  const attackerSession = attachSession(scene, attacker, 1);
  const targetSession = attachSession(scene, target, 2);

  const addResult = scene.addTarget(attackerSession.session, target.itemID);
  advanceScene(scene, addResult.data.lockDurationMs + 100);
  attackerSession.notifications.length = 0;
  targetSession.notifications.length = 0;

  const removeResult = scene.removeTarget(attackerSession.session, target.itemID);

  assert.equal(removeResult.success, true);
  assert.equal(removeResult.data.removed, true);
  assert.deepEqual(scene.getTargets(attackerSession.session), []);
  assert.deepEqual(scene.getTargeters(targetSession.session), []);
  assert.deepEqual(getTargetNotifications(attackerSession.notifications), [
    {
      name: "OnTarget",
      idType: "clientID",
      payload: ["lost", target.itemID],
    },
  ]);
  assert.deepEqual(getTargetNotifications(targetSession.notifications), [
    {
      name: "OnTarget",
      idType: "clientID",
      payload: ["otherlost", attacker.itemID],
    },
  ]);
});

test("ClearTargets emits clear and drops each targeter's yellow-box state", () => {
  const scene = spaceRuntime.ensureScene(30000142);
  const attacker = buildShipEntity(scene, 940001, 0);
  const targetA = buildShipEntity(scene, 940002, 10_000);
  const targetB = buildShipEntity(scene, 940003, 15_000);
  const attackerSession = attachSession(scene, attacker, 1);
  const targetASession = attachSession(scene, targetA, 2);
  const targetBSession = attachSession(scene, targetB, 3);

  const firstLock = scene.addTarget(attackerSession.session, targetA.itemID);
  const secondLock = scene.addTarget(attackerSession.session, targetB.itemID);
  advanceScene(
    scene,
    Math.max(firstLock.data.lockDurationMs, secondLock.data.lockDurationMs) + 100,
  );
  attackerSession.notifications.length = 0;
  targetASession.notifications.length = 0;
  targetBSession.notifications.length = 0;

  const clearResult = scene.clearTargets(attackerSession.session);

  assert.equal(clearResult.success, true);
  assert.deepEqual(scene.getTargets(attackerSession.session), []);
  assert.deepEqual(scene.getTargeters(targetASession.session), []);
  assert.deepEqual(scene.getTargeters(targetBSession.session), []);
  assert.deepEqual(getTargetNotifications(attackerSession.notifications), [
    {
      name: "OnTarget",
      idType: "clientID",
      payload: ["clear"],
    },
  ]);
  assert.deepEqual(getTargetNotifications(targetASession.notifications), [
    {
      name: "OnTarget",
      idType: "clientID",
      payload: ["otherlost", attacker.itemID],
    },
  ]);
  assert.deepEqual(getTargetNotifications(targetBSession.notifications), [
    {
      name: "OnTarget",
      idType: "clientID",
      payload: ["otherlost", attacker.itemID],
    },
  ]);
});

test("out-of-range locks are dropped on the next scene tick", () => {
  const scene = spaceRuntime.ensureScene(30000142);
  const attacker = buildShipEntity(scene, 950001, 0, {
    passiveResourceState: {
      maxTargetRange: 20_000,
    },
  });
  const target = buildShipEntity(scene, 950002, 10_000);
  const attackerSession = attachSession(scene, attacker, 1);
  const targetSession = attachSession(scene, target, 2);

  const addResult = scene.addTarget(attackerSession.session, target.itemID);
  advanceScene(scene, addResult.data.lockDurationMs + 100);
  attackerSession.notifications.length = 0;
  targetSession.notifications.length = 0;

  target.position.x = 500_000;
  advanceScene(scene, 1000);

  assert.deepEqual(scene.getTargets(attackerSession.session), []);
  assert.deepEqual(scene.getTargeters(targetSession.session), []);
  assert.deepEqual(getTargetNotifications(attackerSession.notifications), [
    {
      name: "OnTarget",
      idType: "clientID",
      payload: ["lost", target.itemID],
    },
  ]);
  assert.deepEqual(getTargetNotifications(targetSession.notifications), [
    {
      name: "OnTarget",
      idType: "clientID",
      payload: ["otherlost", attacker.itemID],
    },
  ]);
});

test("validateAllTargetLocks skips idle entities with no active or pending locks", () => {
  const scene = spaceRuntime.ensureScene(30000142);
  const attacker = buildShipEntity(scene, 970001, 0, {
    characterID: 140000011,
  });
  const target = buildShipEntity(scene, 970002, 10_000, {
    characterID: 140000015,
  });
  const idleA = buildShipEntity(scene, 970003, 20_000, {
    characterID: 140000021,
  });
  const idleB = buildShipEntity(scene, 970004, 30_000, {
    characterID: 140000022,
  });
  const attackerSession = attachSession(scene, attacker, 1, 140000011);
  attachSession(scene, target, 2, 140000015);
  attachSession(scene, idleA, 3, 140000021);
  attachSession(scene, idleB, 4, 140000022);

  const addResult = scene.addTarget(attackerSession.session, target.itemID);
  advanceScene(scene, addResult.data.lockDurationMs + 100);

  const targetingStatsCalls = [];
  const originalGetEntityTargetingStats = scene.getEntityTargetingStats;
  scene.getEntityTargetingStats = function patchedGetEntityTargetingStats(entity) {
    targetingStatsCalls.push(Number(entity && entity.itemID) || 0);
    return originalGetEntityTargetingStats.call(this, entity);
  };

  scene.validateAllTargetLocks(scene.getCurrentSimTimeMs());

  assert.deepEqual([...new Set(targetingStatsCalls)], [attacker.itemID]);
});

test("target cap rejects new lock attempts once active or pending locks fill the ship limit", () => {
  const scene = spaceRuntime.ensureScene(30000142);
  const attacker = buildShipEntity(scene, 960001, 0, {
    passiveResourceState: {
      maxLockedTargets: 1,
    },
  });
  const targetA = buildShipEntity(scene, 960002, 10_000);
  const targetB = buildShipEntity(scene, 960003, 12_000);
  const attackerSession = attachSession(scene, attacker, 1);
  attachSession(scene, targetA, 2);
  attachSession(scene, targetB, 3);

  const firstAttempt = scene.addTarget(attackerSession.session, targetA.itemID);
  const secondAttempt = scene.addTarget(attackerSession.session, targetB.itemID);

  assert.equal(firstAttempt.success, true);
  assert.equal(firstAttempt.data.pending, true);
  assert.equal(secondAttempt.success, false);
  assert.equal(secondAttempt.errorMsg, "TARGET_LOCK_LIMIT_REACHED");

  advanceScene(scene, firstAttempt.data.lockDurationMs + 100);
  const thirdAttempt = scene.addTarget(attackerSession.session, targetB.itemID);
  assert.equal(thirdAttempt.success, false);
  assert.equal(thirdAttempt.errorMsg, "TARGET_LOCK_LIMIT_REACHED");
});

test("trained targeting skills raise the character-side lock cap above the base value of two", () => {
  const scene = spaceRuntime.ensureScene(30000142);
  const attacker = buildShipEntity(scene, 965001, 0, {
    characterID: 140000004,
    passiveResourceState: {
      maxLockedTargets: 7,
    },
  });
  const targetA = buildShipEntity(scene, 965002, 10_000);
  const targetB = buildShipEntity(scene, 965003, 12_000);
  const targetC = buildShipEntity(scene, 965004, 14_000);
  const attackerSession = attachSession(scene, attacker, 1, 140000004);
  attachSession(scene, targetA, 2);
  attachSession(scene, targetB, 3);
  attachSession(scene, targetC, 4);

  const firstAttempt = scene.addTarget(attackerSession.session, targetA.itemID);
  const secondAttempt = scene.addTarget(attackerSession.session, targetB.itemID);
  const thirdAttempt = scene.addTarget(attackerSession.session, targetC.itemID);

  assert.equal(firstAttempt.success, true);
  assert.equal(secondAttempt.success, true);
  assert.equal(thirdAttempt.success, true);
  assert.equal(thirdAttempt.data.pending, true);
});

test("dogma target RPCs expose the live authoritative target state", () => {
  const scene = spaceRuntime.ensureScene(30000142);
  const attacker = buildShipEntity(scene, 970001, 0);
  const target = buildShipEntity(scene, 970002, 10_000);
  const attackerSession = attachSession(scene, attacker, 1, 1234);
  const targetSession = attachSession(scene, target, 2, 5678);
  const service = new DogmaService();

  const addResult = service.Handle_AddTarget([target.itemID], attackerSession.session);
  assert.equal(addResult[0], 1);
  assert.deepEqual(addResult[1], {
    type: "list",
    items: [],
  });

  advanceScene(scene, 5000);

  assert.deepEqual(service.Handle_GetTargets([], attackerSession.session), {
    type: "list",
    items: [target.itemID],
  });
  assert.deepEqual(service.Handle_GetTargeters([], targetSession.session), {
    type: "list",
    items: [attacker.itemID],
  });
});
