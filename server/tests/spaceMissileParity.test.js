const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const destiny = require(path.join(repoRoot, "server/src/space/destiny"));
const {
  resolveItemByTypeID,
} = require(path.join(repoRoot, "server/src/services/inventory/itemTypeRegistry"));
const {
  getTypeAttributeValue,
} = require(path.join(repoRoot, "server/src/services/fitting/liveFittingState"));
const {
  resolveOwnerMonotonicState,
  resolveDestinyLifecycleRestampState,
} = require(path.join(
  repoRoot,
  "server/src/space/movement/movementDeliveryPolicy",
));

const DESTINY_STAMP_SCENE_MAX_LEAD = 2;
const MICHELLE_PRETICK_HISTORY_SAFE_DESTINY_LEAD = 3;
const OWNER_MISSILE_CLIENT_LANE_LEAD = 2;
const PILOT_WARP_HISTORY_SAFE_DESTINY_LEAD = 4;
const RECENT_EMITTED_OWNER_CRITICAL_MAX_LEAD =
  OWNER_MISSILE_CLIENT_LANE_LEAD +
  MICHELLE_PRETICK_HISTORY_SAFE_DESTINY_LEAD +
  PILOT_WARP_HISTORY_SAFE_DESTINY_LEAD;

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
        stamp: Array.isArray(entry) ? entry[0] : null,
        name: payload[0],
        args: Array.isArray(payload[1]) ? payload[1] : [],
      });
    }
  }
  return updates;
}

function getShipEffectNotifications(notifications = [], moduleID = null) {
  const normalizedModuleID =
    moduleID === null || moduleID === undefined
      ? null
      : Number(moduleID);
  return notifications.filter((notification) => (
    notification &&
    notification.name === "OnGodmaShipEffect" &&
    Array.isArray(notification.payload) &&
    (
      normalizedModuleID === null ||
      Number(notification.payload[0]) === normalizedModuleID
      )
  ));
}

function getSpecialFxEvents(notifications = [], guid = null) {
  return flattenDestinyUpdates(notifications).filter((entry) => (
    entry.name === "OnSpecialFX" &&
    (
      guid === null ||
      String(entry.args[5] || "") === String(guid)
    )
  ));
}

function getAddBalls2StateStamp(update) {
  if (!update || update.name !== "AddBalls2" || !Array.isArray(update.args)) {
    return null;
  }

  const firstEntry = update.args[0];
  const stateBuffer = Array.isArray(firstEntry) ? firstEntry[0] : null;
  if (!Buffer.isBuffer(stateBuffer) || stateBuffer.length < 5) {
    return null;
  }
  return stateBuffer.readUInt32LE(1) >>> 0;
}

function getAddBalls2EntityIDs(update) {
  if (!update || update.name !== "AddBalls2" || !Array.isArray(update.args)) {
    return [];
  }

  const entityIDs = [];
  for (const batchEntry of update.args) {
    const slimEntries = Array.isArray(batchEntry) ? batchEntry[1] : null;
    const normalizedSlimEntries = Array.isArray(slimEntries)
      ? slimEntries
      : slimEntries &&
          slimEntries.type === "list" &&
          Array.isArray(slimEntries.items)
        ? slimEntries.items
        : [];
    if (normalizedSlimEntries.length === 0) {
      continue;
    }
    for (const slimEntry of normalizedSlimEntries) {
      const slimItem = Array.isArray(slimEntry) ? slimEntry[0] : slimEntry;
      const itemID = Number(
        slimItem && typeof slimItem === "object" && "itemID" in slimItem
          ? slimItem.itemID
          : getMarshalDictEntry(slimItem, "itemID"),
      );
      if (Number.isFinite(itemID) && itemID > 0) {
        entityIDs.push(itemID);
      }
    }
  }
  return entityIDs;
}

function getAddBalls2EntityPosition(update, entityID) {
  if (!update || update.name !== "AddBalls2" || !Array.isArray(update.args)) {
    return null;
  }

  const normalizedEntityID = Number(entityID);
  if (!Number.isFinite(normalizedEntityID) || normalizedEntityID <= 0) {
    return null;
  }

  for (const batchEntry of update.args) {
    const stateBuffer = Array.isArray(batchEntry) ? batchEntry[0] : null;
    if (!Buffer.isBuffer(stateBuffer) || stateBuffer.length < 5) {
      continue;
    }

    let offset = 5;
    while (offset + 22 <= stateBuffer.length) {
      const currentEntityID = Number(stateBuffer.readBigInt64LE(offset));
      offset += 8;
      const mode = stateBuffer.readUInt8(offset);
      offset += 1;
      offset += 4; // radius
      const position = {
        x: stateBuffer.readDoubleLE(offset),
        y: stateBuffer.readDoubleLE(offset + 8),
        z: stateBuffer.readDoubleLE(offset + 16),
      };
      offset += 24;
      offset += 1; // flags
      if (offset + 59 > stateBuffer.length) {
        break;
      }
      offset += 8; // mass
      offset += 1; // unknown byte
      offset += 8; // alliance id
      offset += 4; // corp id
      offset += 4; // unknown int
      offset += 4; // max velocity
      offset += 24; // velocity
      offset += 4; // inertia
      offset += 4; // speed fraction
      offset += 1; // mode sentinel

      if (currentEntityID === normalizedEntityID) {
        return position;
      }

      if (mode === 0) {
        offset += 24;
      } else if (mode === 1 || mode === 4) {
        offset += 12;
      } else if (mode === 3) {
        offset += 48;
      }
    }
  }

  return null;
}

function getMissileLaunchSessionStamp(scene, session, missile) {
  const launchTimeMs = Number(
    missile && Number.isFinite(Number(missile.launchedAtMs))
      ? missile.launchedAtMs
      : scene.getCurrentSimTimeMs(),
  );
  return scene.translateDestinyStampForSession(
    session,
    scene.getCurrentDestinyStamp(launchTimeMs),
  ) >>> 0;
}

function getDestinyNotificationNames(notifications = []) {
  return notifications
    .filter((notification) => notification && notification.name === "DoDestinyUpdate")
    .map((notification) => {
      const payloadList = notification.payload[0];
      const entries = Array.isArray(payloadList && payloadList.items)
        ? payloadList.items
        : [];
      return entries
        .map((entry) => {
          const payload = Array.isArray(entry) ? entry[1] : null;
          return Array.isArray(payload) && typeof payload[0] === "string"
            ? payload[0]
            : null;
        })
        .filter(Boolean);
    });
}

function toNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : NaN;
}

function assertApprox(actual, expected, epsilon = 0.000001) {
  assert.ok(
    Math.abs(Number(actual) - Number(expected)) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

function distance(left, right) {
  const dx = toNumber(left && left.x) - toNumber(right && right.x);
  const dy = toNumber(left && left.y) - toNumber(right && right.y);
  const dz = toNumber(left && left.z) - toNumber(right && right.z);
  return Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
}

function getImmediateClientLaneStamp(
  scene,
  session,
  rawSimTimeMs = scene.getCurrentSimTimeMs(),
) {
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    rawSimTimeMs,
  );
  return scene.getImmediateDestinyStampForSession(
    session,
    currentSessionStamp,
  );
}

function advanceScene(scene, deltaMs) {
  const baseWallclock = Number(scene.lastWallclockTickAt) || scene.getCurrentWallclockMs();
  scene.tick(baseWallclock + Math.max(0, Number(deltaMs) || 0));
}

function advanceSceneUntilSimTime(scene, targetSimTimeMs, extraMs = 0) {
  const normalizedTargetSimTimeMs = Math.max(0, Number(targetSimTimeMs) || 0);
  while (scene.getCurrentSimTimeMs() < normalizedTargetSimTimeMs) {
    const remainingMs = normalizedTargetSimTimeMs - scene.getCurrentSimTimeMs();
    advanceScene(scene, Math.min(remainingMs, 100));
  }
  if (extraMs > 0) {
    advanceScene(scene, extraMs);
  }
}

function getMissileEntities(scene) {
  return [...scene.dynamicEntities.values()].filter(
    (entity) => entity && entity.kind === "missile",
  );
}

// getMissileLaunchSessionStamp is defined above (line ~293)

function getLatestMissileLaunchSessionStamp(scene, session, missiles) {
  let latestStamp = 0;
  for (const missile of missiles) {
    latestStamp = Math.max(
      latestStamp,
      getMissileLaunchSessionStamp(scene, session, missile),
    ) >>> 0;
  }
  return latestStamp >>> 0;
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

function buildLauncherScenario(targetX = 8_000) {
  const scene = spaceRuntime.ensureScene(30000142);
  const attacker = buildShipEntity(scene, 991000001, -2_000);
  const moduleItem = buildModuleItem(2410, 991010001, 27, attacker.itemID);
  const chargeItem = buildChargeItem(209, 991020001, moduleItem.itemID, 2);
  attacker.nativeNpc = true;
  attacker.fittedItems = [moduleItem];
  attacker.nativeCargoItems = [chargeItem];
  attacker.skillMap = new Map();

  const attackerSession = attachSession(scene, attacker, 991030001);
  const target = buildShipEntity(scene, 991000002, targetX, {
    passiveResourceState: {
      ...DEFAULT_PASSIVE_STATE,
      shieldCapacity: 400,
      armorHP: 400,
      structureHP: 400,
    },
  });
  const targetSession = attachSession(scene, target, 991030002);

  const lockResult = scene.finalizeTargetLock(attacker, target, {
    nowMs: scene.getCurrentSimTimeMs(),
  });
  assert.equal(lockResult.success, true, "expected attacker to lock the target");

  return {
    scene,
    attacker,
    attackerSession,
    target,
    targetSession,
    moduleItem,
    chargeItem,
  };
}

function buildMultiLauncherScenario(moduleCount = 2, targetX = 8_000) {
  const scene = spaceRuntime.ensureScene(30000142);
  const attacker = buildShipEntity(scene, 991100001, -2_000);
  attacker.nativeNpc = true;
  attacker.skillMap = new Map();
  attacker.fittedItems = [];
  attacker.nativeCargoItems = [];
  const chargeItems = [];

  for (let index = 0; index < moduleCount; index += 1) {
    const moduleItem = buildModuleItem(
      2410,
      991110001 + index,
      27 + index,
      attacker.itemID,
    );
    const chargeItem = buildChargeItem(
      209,
      991120001 + index,
      moduleItem.itemID,
      3,
    );
    attacker.fittedItems.push(moduleItem);
    attacker.nativeCargoItems.push(chargeItem);
    chargeItems.push(chargeItem);
  }

  const attackerSession = attachSession(scene, attacker, 991130001);
  const target = buildShipEntity(scene, 991100002, targetX, {
    passiveResourceState: {
      ...DEFAULT_PASSIVE_STATE,
      shieldCapacity: 400,
      armorHP: 400,
      structureHP: 400,
    },
  });
  const targetSession = attachSession(scene, target, 991130002);

  const lockResult = scene.finalizeTargetLock(attacker, target, {
    nowMs: scene.getCurrentSimTimeMs(),
  });
  assert.equal(lockResult.success, true, "expected attacker to lock the target");

  return {
    scene,
    attacker,
    attackerSession,
    target,
    targetSession,
    moduleItems: attacker.fittedItems,
    chargeItems,
  };
}

function buildMissileVsNpcTurretScenario(targetX = 8_000) {
  const scene = spaceRuntime.ensureScene(30000142);
  const player = buildShipEntity(scene, 991200001, -2_000);
  const missileModuleItem = buildModuleItem(2410, 991210001, 27, player.itemID);
  const missileChargeItem = buildChargeItem(209, 991220001, missileModuleItem.itemID, 2);
  player.nativeNpc = true;
  player.fittedItems = [missileModuleItem];
  player.nativeCargoItems = [missileChargeItem];
  player.skillMap = new Map();
  const playerSession = attachSession(scene, player, 991230001);

  const target = buildShipEntity(scene, 991200002, targetX, {
    passiveResourceState: {
      ...DEFAULT_PASSIVE_STATE,
      shieldCapacity: 400,
      armorHP: 400,
      structureHP: 400,
    },
  });
  scene.spawnDynamicEntity(target, { broadcast: false });

  const npc = buildShipEntity(scene, 991200003, 2_500);
  const laserModuleItem = buildModuleItem(13815, 991210003, 27, npc.itemID);
  const laserChargeItem = buildChargeItem(21302, 991220003, laserModuleItem.itemID, 2);
  npc.nativeNpc = true;
  npc.fittedItems = [laserModuleItem];
  npc.nativeCargoItems = [laserChargeItem];
  npc.skillMap = new Map();
  const npcSession = attachSession(scene, npc, 991230003);

  const playerLockResult = scene.finalizeTargetLock(player, target, {
    nowMs: scene.getCurrentSimTimeMs(),
  });
  assert.equal(playerLockResult.success, true, "expected the player launcher ship to lock its target");

  const npcLockResult = scene.finalizeTargetLock(npc, player, {
    nowMs: scene.getCurrentSimTimeMs(),
  });
  assert.equal(npcLockResult.success, true, "expected the hostile NPC turret ship to lock the player");

  return {
    scene,
    player,
    playerSession,
    target,
    npc,
    npcSession,
    missileModuleItem,
    laserModuleItem,
  };
}

test.afterEach(() => {
  spaceRuntime._testing.clearScenes();
});

test("missile launchers reject targets beyond their current flight envelope", () => {
  const {
    scene,
    attackerSession,
    moduleItem,
    target,
  } = buildLauncherScenario(40_000);

  const activationResult = scene.activateGenericModule(
    attackerSession.session,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );

  assert.equal(activationResult.success, false);
  assert.equal(activationResult.errorMsg, "TARGET_OUT_OF_RANGE");
  assert.equal(getMissileEntities(scene).length, 0);
});

test("initial missile activation queues both owner and observer acquires until the next scene tick", () => {
  const {
    scene,
    attackerSession,
    targetSession,
    target,
    moduleItem,
  } = buildLauncherScenario(8_000);
  const ownerSession = attackerSession.session;
  const observerSession = targetSession.session;
  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  const currentStamp = scene.getCurrentDestinyStamp();

  ownerSession._space.clockOffsetMs = -203000;
  ownerSession._space.lastSentDestinyStamp = currentStamp;
  observerSession._space.clockOffsetMs = -203000;
  observerSession._space.lastSentDestinyStamp = currentStamp;
  attackerSession.notifications.length = 0;
  targetSession.notifications.length = 0;

  const activationResult = scene.activateGenericModule(
    ownerSession,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);
  const missile = getMissileEntities(scene)[0];
  assert.ok(missile, "expected the missile entity to remain live immediately after launch");
  assert.equal(
    flattenDestinyUpdates(attackerSession.notifications)
      .some((entry) => entry.name === "AddBalls2"),
    false,
    "expected outside-tick launcher activation not to emit a standalone owner missile AddBalls2 packet before the next scene tick flush",
  );
  assert.equal(
    flattenDestinyUpdates(targetSession.notifications)
      .some((entry) => entry.name === "AddBalls2"),
    false,
    "expected observers to keep waiting for the next scene tick before receiving the missile acquire",
  );

  advanceScene(scene, spaceRuntime._testing.RUNTIME_TICK_INTERVAL_MS);

  const ownerUpdates = flattenDestinyUpdates(attackerSession.notifications);
  const ownerAddBallsUpdate = ownerUpdates.find((entry) =>
    entry.name === "AddBalls2" &&
    getAddBalls2EntityIDs(entry).includes(missile.itemID));
  assert.ok(
    ownerAddBallsUpdate,
    "expected the launcher owner to receive the queued missile AddBalls2 acquire on the next scene tick flush",
  );
  const ownerImmediateLaneStamp = getImmediateClientLaneStamp(
    scene,
    ownerSession,
    scene.getCurrentSimTimeMs(),
  );
  assert.equal(
    ownerAddBallsUpdate.stamp >= (
      ownerImmediateLaneStamp + OWNER_MISSILE_CLIENT_LANE_LEAD
    ),
    true,
    "expected the queued owner missile AddBalls2 delivery to stay inside Michelle's held-future owner lane once the scene tick flushes it",
  );
  const ownerLaunchSessionStamp = getMissileLaunchSessionStamp(
    scene,
    ownerSession,
    missile,
  );
  assert.equal(
    getAddBalls2StateStamp(ownerAddBallsUpdate),
    ownerLaunchSessionStamp,
    "expected the queued owner missile AddBalls2 payload state to preserve the authored launch snapshot instead of retiming to the delivery lane",
  );

  const updates = flattenDestinyUpdates(targetSession.notifications);
  const addBallsUpdate = updates.find((entry) => entry.name === "AddBalls2");
  assert.ok(addBallsUpdate, "expected a missile AddBalls2 update for an observing ship");
  const ballDebug = destiny.debugDescribeEntityBall(missile).summary;
  assert.equal(ballDebug.mode, "FOLLOW");
  assert.equal(ballDebug.modeData.targetEntityID, target.itemID);
  const missileReplayUpdates = updates.filter((entry) => (
    (entry.name === "FollowBall" || entry.name === "SetSpeedFraction") &&
    Number(entry.args[0]) === missile.itemID
  ));
  assert.equal(
    addBallsUpdate.stamp >=
      scene.translateDestinyStampForSession(observerSession, currentStamp),
    true,
    "expected observer missile AddBalls2 not to backstep behind the observer session tick",
  );
  assert.equal(
    updates
      .filter((entry) => entry.name !== "AddBalls2")
      .every((entry) => entry.stamp >= addBallsUpdate.stamp),
    true,
    "expected follow-up missile prime and mode updates not to backstep behind AddBalls2",
  );
  assert.equal(
    missileReplayUpdates.length,
    0,
    "expected missile fresh acquires to rely on AddBalls2's encoded FOLLOW bootstrap instead of replaying missile FollowBall/SetSpeedFraction updates",
  );
  const notificationNames = getDestinyNotificationNames(targetSession.notifications);
  assert.equal(
    notificationNames.some((names) => names.includes("AddBalls2")),
    true,
    "expected observer opening missile acquire to stay on the AddBalls2 bootstrap path",
  );
});

test("initial multi-launcher volleys batch both owner and observer acquires on the next scene tick", () => {
  const {
    scene,
    attackerSession,
    targetSession,
    target,
    moduleItems,
  } = buildMultiLauncherScenario(2, 25_000);
  const session = attackerSession.session;
  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;
  targetSession.notifications.length = 0;

  for (const moduleItem of moduleItems) {
    const activationResult = scene.activateGenericModule(
      session,
      moduleItem,
      null,
      {
        targetID: target.itemID,
      },
    );
    assert.equal(activationResult.success, true);
  }

  assert.equal(
    flattenDestinyUpdates(attackerSession.notifications)
      .some((entry) => entry.name === "AddBalls2"),
    false,
    "expected outside-tick owner missile volley launches not to emit standalone owner AddBalls2 packets before the next scene tick flush",
  );
  assert.equal(
    flattenDestinyUpdates(targetSession.notifications)
      .some((entry) => entry.name === "AddBalls2"),
    false,
    "expected observers to keep waiting for the next scene tick before receiving the opening-volley acquire",
  );

  advanceScene(scene, spaceRuntime._testing.RUNTIME_TICK_INTERVAL_MS);

  const ownerUpdates = flattenDestinyUpdates(attackerSession.notifications);
  const ownerAddBallsUpdates = ownerUpdates.filter((entry) => entry.name === "AddBalls2");
  assert.equal(
    ownerAddBallsUpdates.length,
    1,
    "expected the queued owner volley to batch into one AddBalls2 acquire on the next scene tick flush",
  );
  assert.equal(
    [...new Set(getAddBalls2EntityIDs(ownerAddBallsUpdates[0]))].length,
    moduleItems.length,
    "expected the queued owner volley AddBalls2 acquire to contain every launched missile",
  );
  assert.equal(
    ownerUpdates.every((entry) => entry.name !== "FollowBall"),
    true,
    "expected queued owner opening-volley missile acquires to bootstrap entirely from AddBalls2 without redundant FollowBall replays",
  );

  const updates = flattenDestinyUpdates(targetSession.notifications);
  const addBallsUpdates = updates.filter((entry) => entry.name === "AddBalls2");
  assert.equal(
    addBallsUpdates.length,
    1,
    "expected simultaneous opening-volley missiles to batch into one observer AddBalls2 acquire",
  );
  assert.equal(
    updates.every((entry) => entry.name !== "FollowBall"),
    true,
    "expected batched opening-volley missiles to bootstrap entirely from AddBalls2 without redundant FollowBall replays",
  );
  const notificationNames = getDestinyNotificationNames(targetSession.notifications);
  assert.equal(
    notificationNames.some((names) =>
      names.includes("AddBalls2") && !names.includes("FollowBall"),
    ),
    true,
    "expected observer opening-volley missile acquires to avoid redundant FollowBall replay packets",
  );
});

test("staggered missile fresh acquires stay safe for both owner and observer", () => {
  const {
    scene,
    attackerSession,
    targetSession,
    target,
    moduleItems,
  } = buildMultiLauncherScenario(2, 25_000);
  const ownerSession = attackerSession.session;
  const observerSession = targetSession.session;
  const preLaunchVisibleStamp = scene.getCurrentVisibleDestinyStampForSession(
    observerSession,
    scene.getCurrentDestinyStamp(),
  );
  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;
  targetSession.notifications.length = 0;

  const firstActivationResult = scene.activateGenericModule(
    ownerSession,
    moduleItems[0],
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(firstActivationResult.success, true);

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  const firstOwnerUpdates = flattenDestinyUpdates(attackerSession.notifications);
  assert.equal(
    firstOwnerUpdates.some((entry) => entry.name === "AddBalls2"),
    true,
    "expected the launcher owner to receive the first staggered missile acquire",
  );
  const firstUpdates = flattenDestinyUpdates(targetSession.notifications);
  const firstAddBalls = firstUpdates.find((entry) => entry.name === "AddBalls2");
  assert.ok(firstAddBalls, "expected an observing ship to acquire the first staggered missile");

  attackerSession.notifications.length = 0;
  targetSession.notifications.length = 0;
  const firstVisibleStamp = firstAddBalls.stamp;
  assert.ok(
    firstVisibleStamp >= preLaunchVisibleStamp,
    "expected the first staggered observer acquire not to backstep behind the current visible solar-system stamp",
  );
  const visibleBarrierBeforeSecondLaunch = scene.getCurrentVisibleDestinyStampForSession(
    observerSession,
    scene.getCurrentDestinyStamp(),
  );

  const secondActivationResult = scene.activateGenericModule(
    ownerSession,
    moduleItems[1],
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(secondActivationResult.success, true);

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  const secondOwnerUpdates = flattenDestinyUpdates(attackerSession.notifications);
  assert.equal(
    secondOwnerUpdates.some((entry) => entry.name === "AddBalls2"),
    true,
    "expected the launcher owner to receive the second staggered missile acquire",
  );
  const secondUpdates = flattenDestinyUpdates(targetSession.notifications);
  const secondAddBalls = secondUpdates.find((entry) => entry.name === "AddBalls2");
  assert.ok(secondAddBalls, "expected an observing ship to acquire the second staggered missile");
  assert.equal(
    secondAddBalls.stamp >= visibleBarrierBeforeSecondLaunch,
    true,
    "expected the second staggered observer acquire not to backstep behind the observer visible barrier",
  );
  assert.equal(
    secondAddBalls.stamp >= firstVisibleStamp,
    true,
    "expected the second staggered observer acquire not to backfill the first missile's already-visible history",
  );
});

test("observer missile fresh acquires avoid current-tick visibility insertion during sync", () => {
  const {
    scene,
    attackerSession,
    targetSession,
    target,
    moduleItem,
  } = buildLauncherScenario(25_000);
  const ownerSession = attackerSession.session;
  const observerSession = targetSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;
  targetSession.notifications.length = 0;

  const currentSessionStamp = scene.translateDestinyStampForSession(
    observerSession,
    scene.getCurrentDestinyStamp(),
  );
  const activationResult = scene.activateGenericModule(
    ownerSession,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);
  attackerSession.notifications.length = 0;
  targetSession.notifications.length = 0;

  scene.syncDynamicVisibilityForSession(
    observerSession,
    scene.getCurrentSimTimeMs(),
    {
      stampOverride: currentSessionStamp,
    },
  );

  assert.equal(
    flattenDestinyUpdates(attackerSession.notifications)
      .some((entry) => entry.name === "AddBalls2"),
    false,
    "expected the launcher owner not to receive missile AddBalls2 during visibility sync",
  );

  const updates = flattenDestinyUpdates(targetSession.notifications);
  const addBallsUpdate = updates.find((entry) => entry.name === "AddBalls2");
  assert.ok(addBallsUpdate, "expected an observer missile AddBalls2 update during visibility sync");
  assert.equal(
    addBallsUpdate.stamp >= (
      currentSessionStamp + MICHELLE_PRETICK_HISTORY_SAFE_DESTINY_LEAD
    ),
    true,
    "expected observer missile visibility-sync acquires to clear Michelle's pretick hold window on delivery",
  );
  assert.equal(
    getAddBalls2StateStamp(addBallsUpdate),
    addBallsUpdate.stamp >>> 0,
    "expected missile visibility-sync AddBalls2 payload state to align with the Michelle-safe delivery tick",
  );
});

test("observer missile fresh acquires keep the current-history guard through tick presentation batching", () => {
  const {
    scene,
    attackerSession,
    targetSession,
    target,
    moduleItem,
  } = buildLauncherScenario(25_000);
  const ownerSession = attackerSession.session;
  const observerSession = targetSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;
  targetSession.notifications.length = 0;

  const currentSessionStamp = scene.translateDestinyStampForSession(
    observerSession,
    scene.getCurrentDestinyStamp(),
  );
  const activationResult = scene.activateGenericModule(
    ownerSession,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);
  attackerSession.notifications.length = 0;
  targetSession.notifications.length = 0;

  scene.beginTickDestinyPresentationBatch();
  scene.syncDynamicVisibilityForSession(
    observerSession,
    scene.getCurrentSimTimeMs(),
    {
      stampOverride: currentSessionStamp,
    },
  );
  scene.flushTickDestinyPresentationBatch();

  assert.equal(
    flattenDestinyUpdates(attackerSession.notifications)
      .some((entry) => entry.name === "AddBalls2"),
    false,
    "expected the launcher owner not to receive batched missile AddBalls2 during visibility sync",
  );

  const updates = flattenDestinyUpdates(targetSession.notifications);
  const addBallsUpdate = updates.find((entry) => entry.name === "AddBalls2");
  assert.ok(addBallsUpdate, "expected a batched observer missile AddBalls2 update during visibility sync");
  assert.equal(
    addBallsUpdate.stamp >= (
      currentSessionStamp + MICHELLE_PRETICK_HISTORY_SAFE_DESTINY_LEAD
    ),
    true,
    "expected batched observer missile visibility-sync acquires to clear Michelle's pretick hold window on delivery",
  );
  assert.equal(
    getAddBalls2StateStamp(addBallsUpdate),
    addBallsUpdate.stamp >>> 0,
    "expected batched missile visibility-sync AddBalls2 payload state to align with the Michelle-safe delivery tick",
  );
});

test("deferred missile fresh acquires stay queued until the active tick presentation batch flushes", () => {
  const {
    scene,
    attackerSession,
    targetSession,
    target,
    moduleItem,
  } = buildLauncherScenario(25_000);
  const ownerSession = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;
  targetSession.notifications.length = 0;

  const activationResult = scene.activateGenericModule(
    ownerSession,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);

  const missile = getMissileEntities(scene)[0];
  assert.ok(missile, "expected a live missile entity after activation");
  assert.equal(
    missile.deferUntilInitialVisibilitySync,
    true,
    "expected newly spawned missiles to wait for their initial visibility sync",
  );
  assert.equal(
    flattenDestinyUpdates(attackerSession.notifications)
      .some((entry) => entry.name === "AddBalls2"),
    false,
    "expected outside-tick missile activation not to emit a standalone owner AddBalls2 acquire before the active scene tick begins",
  );

  attackerSession.notifications.length = 0;
  targetSession.notifications.length = 0;

  scene.beginTickDestinyPresentationBatch();
  scene.acquireDynamicEntitiesForRelevantSessions([missile], {
    nowMs: scene.getCurrentSimTimeMs(),
  });

  assert.equal(
    flattenDestinyUpdates(attackerSession.notifications).length,
    0,
    "expected owner missile AddBalls not to appear mid-tick before the presentation batch flushes",
  );
  assert.equal(
    flattenDestinyUpdates(targetSession.notifications).length,
    0,
    "expected observer missile AddBalls not to be sent mid-tick before the presentation batch flushes",
  );

  scene.flushTickDestinyPresentationBatch();

  assert.equal(
    flattenDestinyUpdates(attackerSession.notifications)
      .some((entry) => entry.name === "AddBalls2"),
    true,
    "expected the active tick presentation batch to flush the queued owner missile acquire together with the deferred observer missile acquire",
  );
  assert.ok(
    flattenDestinyUpdates(targetSession.notifications)
      .some((entry) => entry.name === "AddBalls2"),
    "expected observer missile AddBalls to flush with the active tick presentation batch",
  );
});

test("launcher-owner missile acquires join the active tick presentation batch on fire", () => {
  const {
    scene,
    attackerSession,
    targetSession,
    target,
    moduleItem,
  } = buildLauncherScenario(25_000);
  const ownerSession = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;
  targetSession.notifications.length = 0;

  scene.beginTickDestinyPresentationBatch();
  const activationResult = scene.activateGenericModule(
    ownerSession,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);

  const missile = getMissileEntities(scene)[0];
  assert.ok(missile, "expected a live missile entity after activation");

  assert.equal(
    flattenDestinyUpdates(attackerSession.notifications)
      .some((entry) => entry.name === "AddBalls2"),
    false,
    "expected the launcher owner missile AddBalls2 acquire to wait for the active tick presentation batch flush",
  );
  assert.equal(
    flattenDestinyUpdates(targetSession.notifications)
      .some((entry) => entry.name === "AddBalls2"),
    false,
    "expected observer acquires not to piggyback on the owner's queued missile fire send",
  );

  scene.flushTickDestinyPresentationBatch();

  const ownerUpdates = flattenDestinyUpdates(attackerSession.notifications);
  const ownerAddBallsUpdate = ownerUpdates.find(
    (entry) =>
      entry.name === "AddBalls2" &&
      getAddBalls2EntityIDs(entry).includes(missile.itemID),
  );
  assert.ok(
    ownerAddBallsUpdate,
    "expected the active tick presentation batch flush to deliver the owner missile AddBalls2 acquire",
  );
  const presentedPosition = getAddBalls2EntityPosition(
    ownerAddBallsUpdate,
    missile.itemID,
  );
  assert.ok(
    presentedPosition,
    "expected to decode the queued owner missile position from the AddBalls2 payload",
  );
  assert.equal(
    distance(presentedPosition, missile.position) <= 0.001,
    true,
    `expected the owner queued-batch missile AddBalls2 payload to preserve the authored launch position (got ${JSON.stringify(presentedPosition)} from ${JSON.stringify(missile.position)})`,
  );
  const ownerLaunchSessionStamp = getMissileLaunchSessionStamp(
    scene,
    ownerSession,
    missile,
  );
  assert.equal(
    getAddBalls2StateStamp(ownerAddBallsUpdate),
    ownerLaunchSessionStamp,
    "expected the owner missile AddBalls2 payload state to preserve the authored launch snapshot instead of retiming to the queued owner delivery lane",
  );
  assert.equal(
    flattenDestinyUpdates(targetSession.notifications)
      .some((entry) => entry.name === "AddBalls2"),
    false,
    "expected observer missile acquires to keep waiting for visibility sync after the owner tick-batch flush",
  );
});

test("hostile NPC weapon FX do not backstep behind the player's next-tick missile acquire", () => {
  const {
    scene,
    player,
    playerSession,
    target,
    npcSession,
    missileModuleItem,
    laserModuleItem,
  } = buildMissileVsNpcTurretScenario(25_000);

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  playerSession.notifications.length = 0;

  const missileActivationResult = scene.activateGenericModule(
    playerSession.session,
    missileModuleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(missileActivationResult.success, true, "expected the player missile launcher activation to succeed");

  assert.equal(
    flattenDestinyUpdates(playerSession.notifications)
      .some((entry) => entry.name === "AddBalls2"),
    false,
    "expected outside-tick missile activation not to send the owner's missile AddBalls2 acquire before the next scene tick",
  );
  advanceScene(scene, spaceRuntime._testing.RUNTIME_TICK_INTERVAL_MS);
  const missileAddBallsUpdate = flattenDestinyUpdates(playerSession.notifications).find(
    (entry) => entry.name === "AddBalls2",
  );
  assert.ok(
    missileAddBallsUpdate,
    "expected the player to receive the queued missile AddBalls2 acquire when the next scene tick flushes",
  );
  const preLaserVisibleStamp = scene.getCurrentVisibleSessionDestinyStamp(
    playerSession.session,
    scene.getCurrentSimTimeMs(),
  );

  playerSession.notifications.length = 0;

  const laserActivationResult = scene.activateGenericModule(
    npcSession.session,
    laserModuleItem,
    null,
    {
      targetID: player.itemID,
    },
  );
  assert.equal(laserActivationResult.success, true, "expected the hostile NPC laser activation to succeed");

  const hostileFxUpdates = flattenDestinyUpdates(playerSession.notifications).filter(
    (entry) =>
      entry.name === "OnSpecialFX" &&
      String(entry.args[5] || "") === "effects.Laser",
  );
  assert.ok(hostileFxUpdates.length > 0, "expected the player to receive the hostile laser OnSpecialFX");
  assert.equal(
    hostileFxUpdates.every((entry) => (entry.stamp >>> 0) >= (preLaserVisibleStamp + 1)),
    true,
    "expected hostile NPC laser FX not to reuse the raw current-visible stamp once missiles are already queued ahead",
  );
  assert.equal(
    hostileFxUpdates.every((entry) => (entry.stamp >>> 0) <= (preLaserVisibleStamp + 2)),
    true,
    "expected hostile NPC laser FX to stay inside Michelle's 2-tick hold window instead of leaping beyond the live combat lane",
  );
});

test("deferred missile fresh acquires snapshot the launch state before the first movement tick advances them", () => {
  const {
    scene,
    attackerSession,
    target,
    moduleItem,
  } = buildLauncherScenario(25_000);
  const ownerSession = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const activationResult = scene.activateGenericModule(
    ownerSession,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);

  const missile = getMissileEntities(scene)[0];
  assert.ok(missile, "expected a live missile entity after activation");
  const launchPosition = { ...missile.position };
  assert.equal(
    flattenDestinyUpdates(attackerSession.notifications)
      .some((entry) => entry.name === "AddBalls2"),
    false,
    "expected outside-tick missile activation not to emit the owner AddBalls2 acquire before the next scene tick flush",
  );
  advanceScene(scene, spaceRuntime._testing.RUNTIME_TICK_INTERVAL_MS);
  const ownerUpdates = flattenDestinyUpdates(attackerSession.notifications);
  const ownerAddBallsUpdate = ownerUpdates.find(
    (entry) =>
      entry.name === "AddBalls2" &&
      getAddBalls2EntityIDs(entry).includes(missile.itemID),
  );
  assert.ok(
    ownerAddBallsUpdate,
    "expected the owner to receive the first missile AddBalls2 acquire when the next scene tick flushes the queued launch",
  );

  const presentedPosition = getAddBalls2EntityPosition(
    ownerAddBallsUpdate,
    missile.itemID,
  );
  assert.ok(
    presentedPosition,
    "expected to decode the missile position from the first AddBalls2 payload",
  );
  assert.ok(
    distance(presentedPosition, launchPosition) <= 0.001,
    `expected the first visible missile AddBalls snapshot to stay at launch position (got ${JSON.stringify(presentedPosition)} from ${JSON.stringify(launchPosition)})`,
  );

  assert.equal(
    missile.deferUntilInitialVisibilitySync,
    false,
    "expected the deferred visibility flag to clear after the first visibility tick",
  );
});

test("launcher-owner missile queued acquires keep a live-session lead without advancing the launch snapshot", () => {
  const {
    scene,
    attackerSession,
    target,
    moduleItem,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const rawCurrentStamp = scene.getCurrentDestinyStamp();
  scene.simTimeMs = (rawCurrentStamp * 1000) + 950;
  session._space.clockOffsetMs = 100;
  const preciseCurrentSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    scene.getCurrentSimTimeMs(),
  );
  session._space.historyFloorDestinyStamp =
    preciseCurrentSessionStamp > 0
      ? ((preciseCurrentSessionStamp - 1) >>> 0)
      : 0;
  const preciseImmediateOwnerLaneStamp = scene.getImmediateDestinyStampForSession(
    session,
    preciseCurrentSessionStamp,
  );
  session._space.lastSentDestinyStamp = preciseImmediateOwnerLaneStamp >>> 0;
  session._space.lastFreshAcquireLifecycleStamp = 0;
  session._space.lastOwnerMissileLifecycleStamp = 0;
  session._space.lastOwnerMissileLifecycleAnchorStamp = 0;
  session._space.lastOwnerMissileLifecycleRawDispatchStamp = 0;

  const activationResult = scene.activateGenericModule(
    session,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);

  const missile = getMissileEntities(scene)[0];
  assert.ok(missile, "expected a live missile entity after activation");
  const launchPosition = { ...missile.position };
  assert.equal(
    flattenDestinyUpdates(attackerSession.notifications)
      .some((entry) => entry.name === "AddBalls2"),
    false,
    "expected outside-tick missile activation not to emit the owner AddBalls2 acquire before the next scene tick flush",
  );
  advanceScene(scene, spaceRuntime._testing.RUNTIME_TICK_INTERVAL_MS);
  const deliveryImmediateOwnerLaneStamp = scene.getImmediateDestinyStampForSession(
    session,
    scene.getCurrentSessionDestinyStamp(session, scene.getCurrentSimTimeMs()),
  );
  const ownerUpdates = flattenDestinyUpdates(attackerSession.notifications);
  const ownerAddBallsUpdate = ownerUpdates.find((entry) => (
    entry.name === "AddBalls2" &&
    getAddBalls2EntityIDs(entry).includes(missile.itemID)
  ));
  assert.ok(
    ownerAddBallsUpdate,
    "expected the launcher owner to receive the queued missile AddBalls2 acquire on the next scene tick flush",
  );
  assert.equal(
    ownerAddBallsUpdate.stamp > deliveryImmediateOwnerLaneStamp,
    true,
    "expected the launcher-owner missile AddBalls delivery tick to clear the immediate prior owner lane instead of reusing it",
  );
  assert.equal(
    ownerAddBallsUpdate.stamp <= (
      deliveryImmediateOwnerLaneStamp + OWNER_MISSILE_CLIENT_LANE_LEAD
    ),
    true,
    "expected the launcher-owner queued missile AddBalls delivery tick to stay inside Michelle's held-future window on the immediate owner lane instead of overshooting it",
  );
  const presentedPosition = getAddBalls2EntityPosition(
    ownerAddBallsUpdate,
    missile.itemID,
  );
  assert.ok(
    presentedPosition,
    "expected to decode the queued owner missile position from the AddBalls2 payload",
  );
  assert.ok(
    distance(presentedPosition, launchPosition) <= 0.001,
    `expected the queued owner missile AddBalls snapshot to stay at launch position (got ${JSON.stringify(presentedPosition)} from ${JSON.stringify(launchPosition)})`,
  );
});

test("launcher-owner missile fresh acquires build an AddBalls presentation", () => {
  const {
    scene,
    attackerSession,
    target,
    moduleItem,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const activationResult = scene.activateGenericModule(
    session,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);

  const missile = getMissileEntities(scene)[0];
  assert.ok(missile, "expected a live missile entity before visibility sync");

  const nowMs = scene.getCurrentSimTimeMs();
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    nowMs,
  );
  session._space.lastSentDestinyStamp = (currentSessionStamp - 1) >>> 0;

  const addBallsPresentation = scene.buildAddBallsUpdatesForSession(
    session,
    [missile],
    {
      freshAcquire: true,
      nowMs,
      stampOverride: currentSessionStamp,
    },
  );
  assert.equal(
    addBallsPresentation.updates.length,
    1,
    "expected the launcher owner to build a missile AddBalls bootstrap",
  );
  const addBallsUpdate = addBallsPresentation.updates[0];
  const normalizedAddBallsUpdate = {
    name: addBallsUpdate.payload[0],
    args: addBallsUpdate.payload[1],
  };
  assert.equal(addBallsUpdate.payload[0], "AddBalls2");
  assert.equal(
    getAddBalls2EntityIDs(normalizedAddBallsUpdate).includes(missile.itemID),
    true,
    "expected the launcher owner AddBalls presentation to include the live missile entity",
  );
  assert.equal(
    getAddBalls2StateStamp(normalizedAddBallsUpdate),
    addBallsUpdate.stamp >>> 0,
    "expected the launcher owner AddBalls payload state to stay aligned with the outer update stamp",
  );
});

test("launcher-owner missile fresh acquires clear an already-sent owner lane instead of landing underneath it", () => {
  const {
    scene,
    attackerSession,
    target,
    moduleItem,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    scene.getCurrentSimTimeMs(),
  );
  const recentOwnerLane = (
    currentSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD
  ) >>> 0;
  session._space.lastSentDestinyStamp = recentOwnerLane;
  session._space.lastPilotCommandMovementStamp = recentOwnerLane;
  session._space.lastPilotCommandMovementAnchorStamp =
    currentSessionStamp;

  const activationResult = scene.activateGenericModule(
    session,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);

  assert.equal(
    flattenDestinyUpdates(attackerSession.notifications)
      .some((entry) => entry.name === "AddBalls2"),
    false,
    "expected outside-tick missile activation not to emit the owner AddBalls2 acquire before the next scene tick flush",
  );
  advanceScene(scene, spaceRuntime._testing.RUNTIME_TICK_INTERVAL_MS);

  const syncNowMs = scene.getCurrentSimTimeMs();
  const missile = getMissileEntities(scene)[0];
  assert.ok(missile, "expected a live missile entity after activation");
  const currentActivationSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    syncNowMs,
  );
  const ownerUpdates = flattenDestinyUpdates(attackerSession.notifications);
  const ownerAddBallsUpdate = ownerUpdates.find((entry) => entry.name === "AddBalls2");
  assert.ok(ownerAddBallsUpdate, "expected a launcher-owner missile AddBalls2 update");
  assert.equal(
    ownerAddBallsUpdate.stamp >= currentActivationSessionStamp,
    true,
    "expected owner missile acquires not to backstep behind the live owner session tick",
  );
  assert.equal(
    ownerAddBallsUpdate.stamp,
    (recentOwnerLane + 1) >>> 0,
    "expected owner missile acquires to clear the nearby already-sent owner lane instead of arriving underneath it",
  );
  const ownerLaunchSessionStamp = getMissileLaunchSessionStamp(
    scene,
    session,
    missile,
  );
  assert.equal(
    getAddBalls2StateStamp(ownerAddBallsUpdate),
    ownerLaunchSessionStamp,
    "expected owner missile AddBalls payload state to preserve the authored launch snapshot instead of retiming to the delivery lane",
  );
});

test("launcher-owner missile fresh acquires stay ahead of Michelle's visible history floor", () => {
  const {
    scene,
    attackerSession,
    target,
    moduleItem,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const activationResult = scene.activateGenericModule(
    session,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);

  attackerSession.notifications.length = 0;
  const syncNowMs = scene.getCurrentSimTimeMs();
  const missile = getMissileEntities(scene)[0];
  assert.ok(missile, "expected a live missile entity before owner fresh acquire");
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    syncNowMs,
  );
  const visibleHistoryFloor = (currentSessionStamp + 1) >>> 0;
  session._space.lastSentDestinyStamp = visibleHistoryFloor;
  session._space.historyFloorDestinyStamp = visibleHistoryFloor;

  const addBallsPresentation = scene.buildAddBallsUpdatesForSession(
    session,
    [missile],
    {
      freshAcquire: true,
      nowMs: syncNowMs,
    },
  );
  assert.equal(
    addBallsPresentation.updates.length,
    1,
    "expected a single owner missile AddBalls presentation",
  );
  const ownerAddBallsUpdate = {
    name: addBallsPresentation.updates[0].payload[0],
    stamp: addBallsPresentation.updates[0].stamp >>> 0,
    args: addBallsPresentation.updates[0].payload[1],
  };
  assert.ok(ownerAddBallsUpdate, "expected a launcher-owner missile AddBalls2 update");
  assert.equal(
    ownerAddBallsUpdate.stamp,
    currentSessionStamp >>> 0,
    "expected the authored owner missile AddBalls presentation to stay on the launch tick",
  );
  assert.equal(
    getAddBalls2StateStamp(ownerAddBallsUpdate),
    ownerAddBallsUpdate.stamp >>> 0,
    "expected owner missile AddBalls payload state to stay aligned on the authored launch presentation",
  );
  assert.equal(
    addBallsPresentation.sendOptions.historyLeadUsesImmediateSessionStamp,
    true,
    "expected launcher-owner missile AddBalls presentations to anchor to Michelle's immediate owner lane instead of the translated live owner session lane",
  );
  assert.equal(
    addBallsPresentation.sendOptions.historyLeadUsesCurrentSessionStamp,
    undefined,
    "expected launcher-owner missile AddBalls presentations not to keep the translated current-session anchor once the immediate owner lane is requested",
  );
  assert.equal(
    addBallsPresentation.sendOptions.avoidCurrentHistoryInsertion,
    true,
    "expected launcher-owner missile AddBalls sends to refuse current-tick delivery on the owner lane",
  );
  assert.equal(
    addBallsPresentation.sendOptions.minimumLeadFromCurrentHistory >=
      OWNER_MISSILE_CLIENT_LANE_LEAD,
    true,
    "expected launcher-owner missile AddBalls presentations to keep at least the owner missile client-lane lead on the trusted owner lane",
  );
  assert.equal(
    addBallsPresentation.sendOptions.maximumLeadFromCurrentHistory >=
      addBallsPresentation.sendOptions.minimumLeadFromCurrentHistory,
    true,
    "expected launcher-owner missile AddBalls presentations to keep a non-decreasing Michelle-safe lead envelope on the trusted owner lane",
  );
  assert.equal(
    addBallsPresentation.sendOptions.preservePayloadStateStamp,
    true,
    "expected launcher-owner missile AddBalls sends to preserve the inner launch snapshot while the outer update rides the safer owner lane",
  );

  scene.sendDestinyUpdates(
    session,
    addBallsPresentation.updates,
    false,
    addBallsPresentation.sendOptions,
  );
  const expectedOwnerDeliveryStamp = (
    scene.getCurrentSessionDestinyStamp(session, syncNowMs) +
    OWNER_MISSILE_CLIENT_LANE_LEAD
  ) >>> 0;
  const sentUpdates = flattenDestinyUpdates(attackerSession.notifications);
  const sentOwnerAddBallsUpdate = sentUpdates.find((entry) => entry.name === "AddBalls2");
  assert.ok(sentOwnerAddBallsUpdate, "expected the owner missile AddBalls2 send to reach the session");
  assert.equal(
    sentOwnerAddBallsUpdate.stamp >= expectedOwnerDeliveryStamp,
    true,
    "expected the owner missile AddBalls delivery tick to clear Michelle's pretick hold window on the trusted owner lane",
  );
  assert.equal(
    getAddBalls2StateStamp(sentOwnerAddBallsUpdate),
    ownerAddBallsUpdate.stamp >>> 0,
    "expected the owner missile AddBalls state stamp to preserve the authored launch snapshot after send",
  );
});

test("launcher-owner missile fresh acquires clear the live owner session lane even when Michelle's history floor lags behind", () => {
  const {
    scene,
    attackerSession,
    target,
    moduleItem,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const nowMs = scene.getCurrentSimTimeMs();
  const currentOwnerSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    nowMs,
  );
  const staleHistoryFloorStamp =
    currentOwnerSessionStamp > 0
      ? ((currentOwnerSessionStamp - 1) >>> 0)
      : currentOwnerSessionStamp;
  session._space.historyFloorDestinyStamp = staleHistoryFloorStamp;
  session._space.lastSentDestinyStamp = staleHistoryFloorStamp;
  session._space.lastSentDestinyRawDispatchStamp =
    scene.getCurrentDestinyStamp(nowMs);
  session._space.lastPilotCommandMovementStamp = 0;
  session._space.lastOwnerMissileLifecycleStamp = 0;
  session._space.lastOwnerMissileFreshAcquireStamp = 0;
  session._space.lastOwnerMissileLifecycleAnchorStamp = 0;
  session._space.lastOwnerMissileLifecycleRawDispatchStamp = 0;

  const activationResult = scene.activateGenericModule(
    session,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);

  assert.equal(
    flattenDestinyUpdates(attackerSession.notifications)
      .some((entry) => entry.name === "AddBalls2"),
    false,
    "expected outside-tick missile activation not to emit the owner AddBalls2 acquire before the next scene tick flush",
  );
  advanceScene(scene, spaceRuntime._testing.RUNTIME_TICK_INTERVAL_MS);
  const ownerUpdates = flattenDestinyUpdates(attackerSession.notifications);
  const ownerAddBallsUpdate = ownerUpdates.find((entry) => (
    entry.name === "AddBalls2"
  ));
  assert.ok(
    ownerAddBallsUpdate,
    "expected the launcher owner to receive a missile AddBalls2 acquire",
  );
  const deliveredImmediateOwnerLane = scene.getImmediateDestinyStampForSession(
    session,
    scene.getCurrentSessionDestinyStamp(session, scene.getCurrentSimTimeMs()),
  );
  assert.equal(
    ownerAddBallsUpdate.stamp >= (
      (deliveredImmediateOwnerLane + OWNER_MISSILE_CLIENT_LANE_LEAD) >>> 0
    ),
    true,
    "expected owner missile fresh acquires to clear the live owner session lane by the full owner missile lead instead of relying on Michelle's lagging previous-visible tick",
  );
  const laggingOwnerMissile = getMissileEntities(scene)[0];
  assert.ok(
    laggingOwnerMissile,
    "expected the owner missile entity to remain live while validating the launch snapshot stamp",
  );
  const laggingLaunchSessionStamp = getMissileLaunchSessionStamp(
    scene,
    session,
    laggingOwnerMissile,
  );
  assert.equal(
    getAddBalls2StateStamp(ownerAddBallsUpdate),
    laggingLaunchSessionStamp,
    "expected the owner missile AddBalls2 payload state to preserve the authored launch snapshot after clearing the lagging visible floor",
  );
});

test("launcher-owner missile fresh acquires clear an already-sent owner movement lane instead of landing underneath it", () => {
  const {
    scene,
    attackerSession,
    target,
    moduleItem,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const activationResult = scene.activateGenericModule(
    session,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);

  attackerSession.notifications.length = 0;
  const syncNowMs = scene.getCurrentSimTimeMs();
  const missile = getMissileEntities(scene)[0];
  assert.ok(missile, "expected a live missile entity before owner fresh acquire");
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    syncNowMs,
  );
  const recentOwnerMovementLane = (currentSessionStamp + 4) >>> 0;
  session._space.lastSentDestinyStamp = recentOwnerMovementLane;
  session._space.lastOwnerMissileLifecycleStamp = 0;
  session._space.lastPilotCommandMovementStamp = recentOwnerMovementLane;
  session._space.lastPilotCommandMovementAnchorStamp = currentSessionStamp;
  session._space.historyFloorDestinyStamp = currentSessionStamp;

  const addBallsPresentation = scene.buildAddBallsUpdatesForSession(
    session,
    [missile],
    {
      freshAcquire: true,
      nowMs: syncNowMs,
    },
  );
  scene.sendDestinyUpdates(
    session,
    addBallsPresentation.updates,
    false,
    addBallsPresentation.sendOptions,
  );

  const sentUpdates = flattenDestinyUpdates(attackerSession.notifications);
  const sentOwnerAddBallsUpdate = sentUpdates.find((entry) => entry.name === "AddBalls2");
  assert.ok(sentOwnerAddBallsUpdate, "expected the owner missile AddBalls2 send to reach the session");
  assert.equal(
    sentOwnerAddBallsUpdate.stamp >= (
      currentSessionStamp +
      OWNER_MISSILE_CLIENT_LANE_LEAD
    ),
    true,
    "expected the owner missile AddBalls delivery tick to clear the live owner session lane instead of reusing current history",
  );
  assert.equal(
    sentOwnerAddBallsUpdate.stamp,
    (recentOwnerMovementLane + 1) >>> 0,
    "expected the owner missile AddBalls delivery tick to clear the already-sent owner movement lane instead of arriving beneath it",
  );
  const ownerLaunchSessionStamp = getMissileLaunchSessionStamp(
    scene,
    session,
    missile,
  );
  assert.equal(
    getAddBalls2StateStamp(sentOwnerAddBallsUpdate),
    ownerLaunchSessionStamp,
    "expected the owner missile AddBalls payload state to preserve the authored launch snapshot instead of retiming to the delivery lane",
  );
});

test("launcher-owner missile fresh acquires do not staircase off the previously sent owner missile lane", () => {
  const {
    scene,
    attackerSession,
    target,
    moduleItem,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const activationResult = scene.activateGenericModule(
    session,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);

  attackerSession.notifications.length = 0;
  const syncNowMs = scene.getCurrentSimTimeMs();
  const missile = getMissileEntities(scene)[0];
  assert.ok(missile, "expected a live missile entity before repeated owner fresh acquire sends");

  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    syncNowMs,
  );
  session._space.historyFloorDestinyStamp = currentSessionStamp;
  session._space.lastSentDestinyStamp = currentSessionStamp;
  session._space.lastOwnerMissileLifecycleStamp = 0;
  session._space.lastPilotCommandMovementStamp = 0;

  const firstPresentation = scene.buildAddBallsUpdatesForSession(
    session,
    [missile],
    {
      freshAcquire: true,
      nowMs: syncNowMs,
    },
  );
  scene.sendDestinyUpdates(
    session,
    firstPresentation.updates,
    false,
    firstPresentation.sendOptions,
  );

  const firstSend = flattenDestinyUpdates(attackerSession.notifications)
    .find((entry) => entry.name === "AddBalls2");
  assert.ok(firstSend, "expected a first owner missile AddBalls2 send");

  attackerSession.notifications.length = 0;

  const secondPresentation = scene.buildAddBallsUpdatesForSession(
    session,
    [missile],
    {
      freshAcquire: true,
      nowMs: syncNowMs,
    },
  );
  scene.sendDestinyUpdates(
    session,
    secondPresentation.updates,
    false,
    secondPresentation.sendOptions,
  );

  const secondSend = flattenDestinyUpdates(attackerSession.notifications)
    .find((entry) => entry.name === "AddBalls2");
  assert.ok(secondSend, "expected a second owner missile AddBalls2 send");
  assert.equal(
    secondSend.stamp >>> 0,
    firstSend.stamp >>> 0,
    "expected repeated owner missile fresh acquire sends at the same raw tick to reuse one owner missile lane instead of adding another lead step from lastSentDestinyStamp",
  );
});

test("launcher-owner deferred missile fresh acquires still allow adjacent-raw owner lane reuse", () => {
  const {
    scene,
    attackerSession,
    target,
    moduleItem,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const activationResult = scene.activateGenericModule(
    session,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);

  const missile = getMissileEntities(scene)[0];
  assert.ok(missile, "expected a live missile entity after activation");
  assert.equal(
    missile.deferUntilInitialVisibilitySync,
    true,
    "expected launcher missiles to retain the deferred observer visibility flag",
  );

  const presentation = scene.buildAddBallsUpdatesForSession(
    session,
    [missile],
    {
      freshAcquire: true,
      nowMs: scene.getCurrentSimTimeMs(),
    },
  );
  assert.equal(
    presentation.sendOptions &&
      presentation.sendOptions.allowAdjacentRawFreshAcquireLaneReuse,
    true,
    "expected the launcher owner fresh-acquire path to keep adjacent-raw lane reuse enabled even when the missile entity is still observer-deferred",
  );
});

test("owner missile lifecycle floor does not add an extra tick when fresh acquire already reused the safe owner lane", () => {
  const resolved = resolveDestinyLifecycleRestampState({
    localStamp: 1774922778,
    currentSessionStamp: 1774922777,
    currentImmediateSessionStamp: 1774922776,
    currentRawDispatchStamp: 1774922777,
    lastFreshAcquireLifecycleStamp: 1774922778,
    lastMissileLifecycleStamp: 1774922778,
    lastOwnerMissileLifecycleStamp: 1774922778,
    lastOwnerMissileFreshAcquireStamp: 1774922778,
    lastOwnerMissileFreshAcquireRawDispatchStamp: 1774922777,
    lastOwnerMissileLifecycleRawDispatchStamp: 1774922777,
    previousLastSentDestinyStamp: 1774922778,
    previousLastSentDestinyRawDispatchStamp: 1774922777,
    previousLastSentDestinyWasOwnerCritical: true,
    lastOwnerPilotCommandMovementStamp: 1774922771,
    lastOwnerPilotCommandMovementRawDispatchStamp: 1774922771,
    isFreshAcquireLifecycleGroup: true,
    isMissileLifecycleGroup: true,
    isOwnerMissileLifecycleGroup: true,
  });

  assert.equal(
    resolved.freshAcquireFloor && resolved.freshAcquireFloor.freshAcquireFloor,
    1774922778,
    "expected the fresh-acquire floor to stay on the reusable owner missile lane",
  );
  assert.equal(
    resolved.ownerMissileLifecycleFloor &&
      resolved.ownerMissileLifecycleFloor.requiredOwnerFloor,
    1774922778,
    "expected the owner missile lifecycle normalization not to add an extra +1 once the fresh-acquire lane is already safely reused",
  );
  assert.equal(
    resolved.finalStamp,
    1774922778,
    "expected the final owner missile fresh-acquire stamp not to staircase by an extra tick after reusing the safe owner lane",
  );
});

test("observer missile fresh acquires align their AddBalls2 payload stamp with Michelle's safe outer lane", () => {
  const {
    scene,
    attackerSession,
    targetSession,
    target,
    moduleItem,
  } = buildLauncherScenario(25_000);
  const ownerSession = attackerSession.session;
  const observerSession = targetSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;
  targetSession.notifications.length = 0;

  const activationResult = scene.activateGenericModule(
    ownerSession,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);

  const missile = getMissileEntities(scene)[0];
  assert.ok(missile, "expected a live missile entity before visibility sync");

  const rawCurrentStamp = scene.getCurrentDestinyStamp();
  scene.simTimeMs = (rawCurrentStamp * 1000) + 950;
  const authoredSessionStamp = scene.getCurrentSessionDestinyStamp(
    observerSession,
    scene.getCurrentSimTimeMs(),
  );
  observerSession._space.lastSentDestinyStamp = authoredSessionStamp >>> 0;

  const addBallsPresentation = scene.buildAddBallsUpdatesForSession(
    observerSession,
    [missile],
    {
      freshAcquire: true,
      nowMs: scene.getCurrentSimTimeMs(),
      stampOverride: authoredSessionStamp,
    },
  );
  assert.equal(
    addBallsPresentation.sendOptions.avoidCurrentHistoryInsertion,
    true,
    "expected missile AddBalls fresh acquires to use Michelle's safe outer delivery lane",
  );
  assert.equal(
    addBallsPresentation.sendOptions.preservePayloadStateStamp,
    undefined,
    "expected missile AddBalls fresh acquires to let sendDestinyUpdates retime the payload stamp onto the delivery lane",
  );

  attackerSession.notifications.length = 0;
  targetSession.notifications.length = 0;
  scene.simTimeMs = ((authoredSessionStamp + 1) * 1000) + 10;
  const sendTimeSessionStamp = scene.getCurrentSessionDestinyStamp(
    observerSession,
    scene.getCurrentSimTimeMs(),
  );

  scene.sendDestinyUpdates(
    observerSession,
    addBallsPresentation.updates,
    false,
    addBallsPresentation.sendOptions,
  );

  assert.equal(
    flattenDestinyUpdates(attackerSession.notifications)
      .some((entry) => entry.name === "AddBalls2"),
    false,
    "expected the launcher owner not to receive the delayed missile AddBalls2 send",
  );

  const updates = flattenDestinyUpdates(targetSession.notifications);
  const addBallsUpdate = updates.find((entry) => entry.name === "AddBalls2");
  assert.ok(
    addBallsUpdate,
    "expected an observer missile AddBalls2 update after the delayed visibility-sync send",
  );
  assert.equal(
    addBallsUpdate.stamp >= (
      sendTimeSessionStamp + MICHELLE_PRETICK_HISTORY_SAFE_DESTINY_LEAD
    ),
    true,
    "expected delayed observer missile fresh acquires to clear Michelle's pretick hold window on delivery",
  );
  assert.equal(
    getAddBalls2StateStamp(addBallsUpdate),
    addBallsUpdate.stamp >>> 0,
    "expected delayed missile AddBalls2 payload state to align with the Michelle-safe delivery tick",
  );
});

test("observer missile fresh acquires clear an already-presented future lane instead of landing underneath it", () => {
  const {
    scene,
    attackerSession,
    targetSession,
    target,
    moduleItem,
  } = buildLauncherScenario(25_000);
  const ownerSession = attackerSession.session;
  const observerSession = targetSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;
  targetSession.notifications.length = 0;

  const activationResult = scene.activateGenericModule(
    ownerSession,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);

  const missile = getMissileEntities(scene)[0];
  assert.ok(missile, "expected a live missile entity before observer fresh-acquire send");

  const nowMs = scene.getCurrentSimTimeMs();
  const currentRawDispatchStamp = scene.getCurrentDestinyStamp(nowMs);
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(
    observerSession,
    nowMs,
  );
  const presentedObserverLane = (
    currentSessionStamp + MICHELLE_PRETICK_HISTORY_SAFE_DESTINY_LEAD
  ) >>> 0;
  observerSession._space.historyFloorDestinyStamp = currentSessionStamp >>> 0;
  observerSession._space.lastSentDestinyStamp = presentedObserverLane;
  observerSession._space.lastSentDestinyRawDispatchStamp = currentRawDispatchStamp;

  const addBallsPresentation = scene.buildAddBallsUpdatesForSession(
    observerSession,
    [missile],
    {
      freshAcquire: true,
      nowMs,
    },
  );
  const builtAddBallsUpdate = addBallsPresentation.updates.find(
    (entry) => entry.name === "AddBalls2" || (
      entry &&
      Array.isArray(entry.payload) &&
      entry.payload[0] === "AddBalls2"
    ),
  );
  assert.ok(
    builtAddBallsUpdate,
    "expected a missile AddBalls2 fresh-acquire update to be built for the observer",
  );
  assert.equal(
    builtAddBallsUpdate.stamp >= presentedObserverLane,
    true,
    "expected observer missile fresh-acquire AddBalls2 not to backstep behind an already-presented future lane",
  );

  attackerSession.notifications.length = 0;
  targetSession.notifications.length = 0;
  scene.sendDestinyUpdates(
    observerSession,
    addBallsPresentation.updates,
    false,
    addBallsPresentation.sendOptions,
  );

  const updates = flattenDestinyUpdates(targetSession.notifications);
  const addBallsUpdate = updates.find((entry) => entry.name === "AddBalls2");
  assert.ok(
    addBallsUpdate,
    "expected the observer session to receive the missile AddBalls2 fresh-acquire send",
  );
  assert.equal(
    addBallsUpdate.stamp >= presentedObserverLane,
    true,
    "expected observer missile fresh-acquire delivery not to land underneath the already-presented future lane",
  );
  assert.equal(
    getAddBalls2StateStamp(addBallsUpdate),
    addBallsUpdate.stamp >>> 0,
    "expected the observer missile AddBalls2 payload stamp to stay aligned with the lifted delivery lane",
  );
});

test("observer missile fresh acquires stay monotonic with a recently sent far-ahead owner lane from the immediately prior raw dispatch", () => {
  const {
    scene,
    attackerSession,
    targetSession,
  } = buildLauncherScenario(25_000);
  const observerSession = targetSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;
  targetSession.notifications.length = 0;

  const nowMs = scene.getCurrentSimTimeMs();
  const currentRawStamp = scene.getCurrentDestinyStamp(nowMs);
  const priorRawStamp =
    currentRawStamp > 0
      ? ((currentRawStamp - 1) >>> 0)
      : currentRawStamp;
  const currentObserverSessionStamp = scene.getCurrentSessionDestinyStamp(
    observerSession,
    nowMs,
  );
  const recentlySentOwnerLane = (
    currentObserverSessionStamp +
    RECENT_EMITTED_OWNER_CRITICAL_MAX_LEAD
  ) >>> 0;

  observerSession._space.lastSentDestinyStamp = recentlySentOwnerLane;
  observerSession._space.lastSentDestinyRawDispatchStamp = priorRawStamp;
  observerSession._space.lastSentDestinyWasOwnerCritical = true;
  observerSession._space.lastOwnerNonMissileCriticalStamp = recentlySentOwnerLane;
  observerSession._space.lastOwnerNonMissileCriticalRawDispatchStamp = priorRawStamp;
  observerSession._space.lastPilotCommandMovementStamp = (
    recentlySentOwnerLane > 0
      ? ((recentlySentOwnerLane - 1) >>> 0)
      : 0
  );
  observerSession._space.lastPilotCommandMovementAnchorStamp =
    currentObserverSessionStamp;
  observerSession._space.lastPilotCommandMovementRawDispatchStamp = priorRawStamp;
  observerSession._space.lastOwnerMissileLifecycleStamp = 0;
  observerSession._space.lastOwnerMissileLifecycleAnchorStamp = 0;
  observerSession._space.lastOwnerMissileLifecycleRawDispatchStamp = 0;
  observerSession._space.lastOwnerMissileFreshAcquireStamp = 0;
  observerSession._space.lastOwnerMissileFreshAcquireAnchorStamp = 0;
  observerSession._space.lastOwnerMissileFreshAcquireRawDispatchStamp = 0;

  scene.sendDestinyUpdates(
    observerSession,
    [
      {
        stamp: currentRawStamp >>> 0,
        payload: ["AddBalls2", []],
        freshAcquireLifecycleGroup: true,
        missileLifecycleGroup: true,
      },
    ],
    false,
    {
      translateStamps: false,
    },
  );

  const addBallsUpdate = flattenDestinyUpdates(targetSession.notifications).find(
    (entry) => entry.name === "AddBalls2",
  );
  assert.ok(
    addBallsUpdate,
    "expected the observer session to receive a missile AddBalls2 update",
  );
  assert.equal(
    addBallsUpdate.stamp >= recentlySentOwnerLane,
    true,
    "expected observer missile fresh acquires not to backstep under the recently sent far-ahead owner lane from the prior raw dispatch",
  );
});

test("observer missile fresh acquires do not backstep beneath a farther-ahead lane already sent earlier in the same raw dispatch", () => {
  const {
    scene,
    attackerSession,
    targetSession,
  } = buildLauncherScenario(25_000);
  const observerSession = targetSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;
  targetSession.notifications.length = 0;

  const nowMs = scene.getCurrentSimTimeMs();
  const currentRawStamp = scene.getCurrentDestinyStamp(nowMs);
  const currentObserverSessionStamp = scene.getCurrentSessionDestinyStamp(
    observerSession,
    nowMs,
  );
  const sameRawPublishedLane = (
    currentObserverSessionStamp +
    RECENT_EMITTED_OWNER_CRITICAL_MAX_LEAD +
    2
  ) >>> 0;

  observerSession._space.lastSentDestinyStamp = sameRawPublishedLane;
  observerSession._space.lastSentDestinyRawDispatchStamp = currentRawStamp;
  observerSession._space.lastSentDestinyWasOwnerCritical = false;
  observerSession._space.lastOwnerNonMissileCriticalStamp = (
    currentObserverSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD
  ) >>> 0;
  observerSession._space.lastOwnerNonMissileCriticalRawDispatchStamp = currentRawStamp;
  observerSession._space.lastPilotCommandMovementStamp = (
    currentObserverSessionStamp + 1
  ) >>> 0;
  observerSession._space.lastPilotCommandMovementAnchorStamp =
    currentObserverSessionStamp;
  observerSession._space.lastPilotCommandMovementRawDispatchStamp = currentRawStamp;
  observerSession._space.lastOwnerMissileLifecycleStamp = 0;
  observerSession._space.lastOwnerMissileLifecycleAnchorStamp = 0;
  observerSession._space.lastOwnerMissileLifecycleRawDispatchStamp = 0;
  observerSession._space.lastOwnerMissileFreshAcquireStamp = 0;
  observerSession._space.lastOwnerMissileFreshAcquireAnchorStamp = 0;
  observerSession._space.lastOwnerMissileFreshAcquireRawDispatchStamp = 0;

  scene.sendDestinyUpdates(
    observerSession,
    [
      {
        stamp: currentRawStamp >>> 0,
        payload: ["AddBalls2", []],
        freshAcquireLifecycleGroup: true,
        missileLifecycleGroup: true,
      },
    ],
    false,
    {
      translateStamps: false,
    },
  );

  const addBallsUpdate = flattenDestinyUpdates(targetSession.notifications).find(
    (entry) => entry.name === "AddBalls2",
  );
  assert.ok(
    addBallsUpdate,
    "expected the observer session to receive a missile AddBalls2 update",
  );
  assert.equal(
    addBallsUpdate.stamp >= sameRawPublishedLane,
    true,
    "expected observer missile fresh acquires not to backstep under a farther-ahead lane already published earlier in the same raw dispatch",
  );
});

test("missile fresh acquires stay ahead of the launcher owner's precise session tick at boundary rollover", () => {
  const {
    scene,
    attackerSession,
    target,
    moduleItem,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const rawCurrentStamp = scene.getCurrentDestinyStamp();
  scene.simTimeMs = (rawCurrentStamp * 1000) + 950;
  session._space.clockOffsetMs = 100;
  const preciseCurrentSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    scene.getCurrentSimTimeMs(),
  );
  session._space.lastSentDestinyStamp = (preciseCurrentSessionStamp - 1) >>> 0;

  const activationResult = scene.activateGenericModule(
    session,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);
  let addBallsUpdate = flattenDestinyUpdates(attackerSession.notifications)
    .find((entry) => entry.name === "AddBalls2");
  if (!addBallsUpdate) {
    attackerSession.notifications.length = 0;
    scene.syncDynamicVisibilityForSession(session, scene.getCurrentSimTimeMs());
    addBallsUpdate = flattenDestinyUpdates(attackerSession.notifications)
      .find((entry) => entry.name === "AddBalls2");
  }
  assert.ok(
    addBallsUpdate,
    "expected a missile AddBalls2 update for the launcher owner near the session tick boundary",
  );
  assert.equal(
    addBallsUpdate.stamp >= (
      scene.getImmediateDestinyStampForSession(session, preciseCurrentSessionStamp) +
      OWNER_MISSILE_CLIENT_LANE_LEAD
    ),
    true,
    "expected owner missile acquires near the session tick boundary to stay inside Michelle's held-future window on the owner's current lane",
  );
});

test("fresh ship acquires stay ahead of the owner's precise session tick at boundary rollover", () => {
  const {
    scene,
    attackerSession,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const dummyShip = buildShipEntity(scene, 991000099, 18_000, {
    typeID: 24698,
  });
  scene.spawnDynamicEntity(dummyShip, { broadcast: false });

  const rawCurrentStamp = scene.getCurrentDestinyStamp();
  scene.simTimeMs = (rawCurrentStamp * 1000) + 950;
  session._space.clockOffsetMs = 100;
  const preciseCurrentSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    scene.getCurrentSimTimeMs(),
  );
  session._space.lastSentDestinyStamp = (preciseCurrentSessionStamp - 1) >>> 0;

  scene.syncDynamicVisibilityForSession(session, scene.getCurrentSimTimeMs());

  const updates = flattenDestinyUpdates(attackerSession.notifications);
  const addBallsUpdate = updates.find((entry) => entry.name === "AddBalls2");
  assert.ok(
    addBallsUpdate,
    "expected a fresh ship AddBalls2 update during visibility sync near the session tick boundary",
  );
  assert.equal(
    addBallsUpdate.stamp > preciseCurrentSessionStamp,
    true,
    "expected fresh ship acquires to stay ahead of the owner's precise session Destiny tick, not just the translated raw scene tick",
  );
  const primeUpdates = updates.filter((entry) =>
    ["SetBallAgility", "SetBallMass", "SetMaxSpeed", "SetBallMassive"].includes(entry.name),
  );
  assert.equal(
    primeUpdates.every((entry) => entry.stamp === addBallsUpdate.stamp),
    true,
    "expected fresh ship prime updates to share the safe fresh-acquire stamp",
  );
});

test("observer missile fresh-acquire AddBalls keeps one consistent visible presentation stamp", () => {
  const {
    scene,
    attackerSession,
    targetSession,
    target,
    moduleItem,
  } = buildLauncherScenario(25_000);
  const ownerSession = attackerSession.session;
  const observerSession = targetSession.session;
  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());

  const activationResult = scene.activateGenericModule(
    ownerSession,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);

  const missile = getMissileEntities(scene)[0];
  assert.ok(missile, "expected a live missile entity before visibility sync");

  const nowMs = scene.getCurrentSimTimeMs();
  const currentSessionStamp = scene.translateDestinyStampForSession(
    observerSession,
    scene.getCurrentDestinyStamp(nowMs),
  );
  const visibleLeadStamp = ((currentSessionStamp + 3) >>> 0);
  observerSession._space.historyFloorDestinyStamp = visibleLeadStamp;
  const currentVisibleStamp = scene.getCurrentVisibleDestinyStampForSession(
    observerSession,
    scene.getCurrentDestinyStamp(nowMs),
  );
  assert.equal(
    currentVisibleStamp,
    visibleLeadStamp,
    "expected the missile acquire test to simulate a client-visible barrier already ahead of the raw session tick",
  );
  const addBallsPresentation = scene.buildAddBallsUpdatesForSession(
    observerSession,
    [missile],
    {
      freshAcquire: true,
      nowMs,
    },
  );
  const addBallsStamp = addBallsPresentation.updates[0] && addBallsPresentation.updates[0].stamp;
  assert.ok(addBallsStamp, "expected a stamped AddBalls presentation for the missile");
  assert.equal(
    addBallsStamp >= currentVisibleStamp,
    true,
    "expected observer-session missile acquires not to backstep behind the currently visible local history",
  );

  const projectedPresentation = scene.buildDestinyPresentationForSession(
    observerSession,
    [missile],
    addBallsStamp,
    {
      nowMs,
    },
  );
  const projectedMissile = projectedPresentation.entities[0];
  assert.ok(projectedMissile, "expected projected missile presentation state");
  assert.equal(
    projectedPresentation.rawSimTimeMs > nowMs,
    true,
    "expected fresh-acquire missile presentation to advance to the stamped future sim moment",
  );
  assert.equal(
    distance(projectedMissile.position, target.position) <
      distance(missile.position, target.position),
    true,
    "expected missile AddBalls fresh-acquire state to project from the same safe stamp it is delivered on",
  );
});

test("missile launcher activation spawns a follow-ball missile and applies damage on impact", () => {
  const {
    scene,
    attacker,
    attackerSession,
    target,
    moduleItem,
  } = buildLauncherScenario(8_000);

  const activationResult = scene.activateGenericModule(
    attackerSession.session,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);
  assert.equal(target.conditionState.shieldCharge, 1, "expected no damage at launch");

  const missilesAfterLaunch = getMissileEntities(scene);
  assert.equal(missilesAfterLaunch.length, 1, "expected one live missile entity");
  const missile = missilesAfterLaunch[0];
  const slimItem = destiny.buildSlimItemDict(missile);
  assert.equal(getMarshalDictEntry(slimItem, "sourceShipID"), attacker.itemID);
  const launchModules = getMarshalDictEntry(slimItem, "launchModules");
  assert.deepEqual(
    Array.isArray(launchModules && launchModules.items) ? launchModules.items : [],
    [moduleItem.itemID],
  );

  const ballDebug = destiny.debugDescribeEntityBall(missile).summary;
  assert.equal(ballDebug.mode, "FOLLOW");
  assert.equal(ballDebug.modeData.targetEntityID, target.itemID);
  assert.ok(ballDebug.maxVelocity > 0, "expected missile ball max velocity");

  advanceScene(scene, 2_000);
  assert.equal(target.conditionState.shieldCharge, 1, "expected no early missile damage");
  assert.equal(getMissileEntities(scene).length, 1, "expected missile to still be in flight");

  let landed = false;
  for (let index = 0; index < 16; index += 1) {
    advanceScene(scene, 250);
    if (target.conditionState.shieldCharge < 1) {
      landed = true;
      break;
    }
  }
  assert.equal(
    landed,
    true,
    "expected missile damage to land after travel and the client release floor",
  );
  let removed = false;
  for (let index = 0; index < 16; index += 1) {
    if (getMissileEntities(scene).length === 0) {
      removed = true;
      break;
    }
    advanceScene(scene, 250);
  }
  assert.equal(removed, true, "expected missile to be removed after the delayed impact release");
});

test("missile destiny presentation keeps the authored charge radius", () => {
  const {
    scene,
    attackerSession,
    moduleItem,
    target,
  } = buildLauncherScenario(8_000);

  const activationResult = scene.activateGenericModule(
    attackerSession.session,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);

  const missile = getMissileEntities(scene)[0];
  assert.ok(missile, "expected a live missile entity");
  assert.equal(
    missile.radius > 1,
    true,
    "expected the authored missile radius to remain available on the runtime entity",
  );

  const ballDebug = destiny.debugDescribeEntityBall(missile).summary;
  assert.equal(
    ballDebug.radius,
    missile.radius,
    "expected the client Destiny missile ball radius to match the authored charge radius",
  );
});

test("missile runtime derives ball dynamics from the authored charge instead of synthetic placeholders", () => {
  const {
    scene,
    attackerSession,
    moduleItem,
    target,
  } = buildLauncherScenario(8_000);
  const chargeType = resolveItemByTypeID(209);
  assert.ok(chargeType, "expected the heavy missile charge type to exist");

  const activationResult = scene.activateGenericModule(
    attackerSession.session,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);

  const missile = getMissileEntities(scene)[0];
  assert.ok(missile, "expected a live missile entity");
  assert.equal(missile.mass, chargeType.mass);
  assertApprox(
    missile.inertia,
    getTypeAttributeValue(chargeType.typeID, "agility"),
  );
  assertApprox(
    missile.agilitySeconds,
    (Number(chargeType.mass) * Number(getTypeAttributeValue(chargeType.typeID, "agility"))) /
      1_000_000,
    0.000000000001,
  );
});

test("moving-launcher missiles still keep the live Destiny ball clamped to missile max velocity", () => {
  const {
    scene,
    attacker,
    attackerSession,
    moduleItem,
    target,
  } = buildLauncherScenario(25_000);
  const launchShipVelocity = { x: 0, y: 375, z: -140 };
  attacker.mode = "GOTO";
  attacker.speedFraction = 1;
  attacker.velocity = { ...launchShipVelocity };
  attacker.direction = { x: 0, y: 1, z: 0 };
  attacker.targetPoint = {
    x: attacker.position.x,
    y: attacker.position.y + 1.0e16,
    z: attacker.position.z,
  };

  const activationResult = scene.activateGenericModule(
    attackerSession.session,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);

  const missile = getMissileEntities(scene)[0];
  assert.ok(missile, "expected a live missile entity");
  const launchSpeed = Math.sqrt(
    (missile.velocity.x ** 2) +
    (missile.velocity.y ** 2) +
    (missile.velocity.z ** 2),
  );
  assertApprox(
    launchSpeed,
    missile.maxVelocity,
    0.000001,
  );

  const nowMs = scene.getCurrentSimTimeMs();
  const futureVisibleStamp = (
    scene.getCurrentVisibleDestinyStampForSession(
      attackerSession.session,
      scene.getCurrentDestinyStamp(nowMs),
    ) + 1
  ) >>> 0;
  const projectedPresentation = scene.buildDestinyPresentationForSession(
    attackerSession.session,
    [missile],
    futureVisibleStamp,
    {
      nowMs,
    },
  );
  const projectedMissile = projectedPresentation.entities[0];
  assert.ok(projectedMissile, "expected a projected missile presentation state");
  const projectedSpeed = Math.sqrt(
    (projectedMissile.velocity.x ** 2) +
    (projectedMissile.velocity.y ** 2) +
    (projectedMissile.velocity.z ** 2),
  );
  assertApprox(
    projectedSpeed,
    projectedMissile.maxVelocity,
    0.000001,
  );
  assert.ok(
    Math.abs(projectedMissile.velocity.y) < 1,
    "expected the live Destiny missile ball not to inherit the launch ship's lateral world velocity",
  );
});

test("deferred missile fresh acquires batch both owner and observers on the next scene tick", () => {
  const {
    scene,
    attacker,
    attackerSession,
    targetSession,
    target,
    moduleItems,
    chargeItems,
  } = buildMultiLauncherScenario(2, 25_000);
  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;
  targetSession.notifications.length = 0;

  const launchResults = moduleItems.map((moduleItem, index) =>
    scene.launchMissile(
      attacker,
      target.itemID,
      {
        family: "missileLauncher",
        chargeTypeID: chargeItems[index].typeID,
        maxVelocity: 4_500,
        flightTimeMs: 10_000,
        approxRange: 45_000,
      },
      {
        launchTimeMs: scene.getCurrentSimTimeMs(),
        moduleItem,
        chargeItem: chargeItems[index],
        skipRangeCheck: true,
        broadcastOptions: {
          deferUntilVisibilitySync: true,
        },
      },
    ));

  for (const result of launchResults) {
    assert.equal(result.success, true);
  }
  assert.equal(
    flattenDestinyUpdates(attackerSession.notifications)
      .some((entry) => entry.name === "AddBalls2"),
    false,
    "expected deferred missile launches not to emit standalone owner acquires before the next scene tick flushes them",
  );
  assert.equal(
    flattenDestinyUpdates(targetSession.notifications).length,
    0,
    "expected deferred missile fresh acquires not to broadcast to observers before the next scene tick flushes them",
  );

  advanceScene(scene, spaceRuntime._testing.RUNTIME_TICK_INTERVAL_MS);

  const ownerUpdates = flattenDestinyUpdates(attackerSession.notifications);
  const ownerAddBallsUpdates = ownerUpdates.filter((entry) => entry.name === "AddBalls2");
  assert.equal(
    ownerAddBallsUpdates.length,
    1,
    "expected deferred same-tick missile launches to batch into one owner AddBalls2 acquire",
  );
  assert.equal(
    [...new Set(getAddBalls2EntityIDs(ownerAddBallsUpdates[0]))].length,
    moduleItems.length,
    "expected the owner batched AddBalls2 acquire to contain every deferred missile launch",
  );
  assert.equal(
    ownerUpdates.every((entry) => entry.name !== "FollowBall"),
    true,
    "expected deferred owner queued acquires to avoid redundant FollowBall replay packets",
  );

  const updates = flattenDestinyUpdates(targetSession.notifications);
  const addBallsUpdates = updates.filter((entry) => entry.name === "AddBalls2");
  assert.equal(
    addBallsUpdates.length,
    1,
    "expected repeated missile launches in the same scene tick to batch into one observer AddBalls2 acquire on the next scene tick",
  );
  assert.equal(
    [...new Set(getAddBalls2EntityIDs(addBallsUpdates[0]))].length,
    moduleItems.length,
    "expected the observer batched AddBalls2 acquire to contain every deferred missile launch",
  );
  assert.equal(
    updates.every((entry) => entry.name !== "FollowBall"),
    true,
    "expected repeated-cycle missile acquires to rely on AddBalls2 follow-mode bootstrap without redundant FollowBall replays",
  );
  const notificationNames = getDestinyNotificationNames(targetSession.notifications);
  assert.equal(
    notificationNames.some((names) =>
      names.includes("AddBalls2") && !names.includes("FollowBall"),
    ),
    true,
    "expected deferred observer visibility-sync acquires to avoid redundant FollowBall replay packets",
  );
});

test("same-wave owner missile fresh acquires stay on one Michelle-safe owner lane", () => {
  const {
    scene,
    attackerSession,
    target,
    moduleItems,
  } = buildMultiLauncherScenario(4, 25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const sendTimeMs = scene.getCurrentSimTimeMs();
  const currentOwnerSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    sendTimeMs,
  );
  const lastSentOwnerStampBeforeFire = session._space.lastSentDestinyStamp >>> 0;
  const lastOwnerMissileLaneBeforeFire = (
    Number(session._space.lastOwnerMissileLifecycleStamp) || 0
  ) >>> 0;
  for (const moduleItem of moduleItems) {
    const activationResult = scene.activateGenericModule(
      session,
      moduleItem,
      null,
      {
        targetID: target.itemID,
      },
    );
    assert.equal(activationResult.success, true);
  }

  assert.equal(
    flattenDestinyUpdates(attackerSession.notifications)
      .some((entry) => entry.name === "AddBalls2"),
    false,
    "expected outside-tick owner missile volley launches not to emit standalone owner acquires before the next scene tick flush",
  );
  advanceScene(scene, spaceRuntime._testing.RUNTIME_TICK_INTERVAL_MS);

  const ownerAddBallsUpdates = flattenDestinyUpdates(attackerSession.notifications)
    .filter((entry) => entry.name === "AddBalls2");
  assert.equal(ownerAddBallsUpdates.length, 1);
  assert.equal(
    [...new Set(getAddBalls2EntityIDs(ownerAddBallsUpdates[0]))].length,
    moduleItems.length,
    "expected the queued owner volley AddBalls2 acquire to contain every launched missile",
  );

  const uniqueOwnerStamps = [...new Set(
    ownerAddBallsUpdates.map((entry) => entry.stamp >>> 0),
  )];
  const deliveredOwnerSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    scene.getCurrentSimTimeMs(),
  );
  const deliveredImmediateOwnerLane = scene.getImmediateDestinyStampForSession(
    session,
    deliveredOwnerSessionStamp,
  );
  const maximumTrustedOwnerCombatLane = (
    deliveredImmediateOwnerLane + OWNER_MISSILE_CLIENT_LANE_LEAD
  ) >>> 0;
  const nearbyNonMissileOwnerLaneFloor =
    lastSentOwnerStampBeforeFire > lastOwnerMissileLaneBeforeFire
      && lastSentOwnerStampBeforeFire <= maximumTrustedOwnerCombatLane
      ? lastSentOwnerStampBeforeFire >>> 0
      : 0;
  const expectedSharedOwnerLane = Math.max(
    (deliveredImmediateOwnerLane + OWNER_MISSILE_CLIENT_LANE_LEAD) >>> 0,
    nearbyNonMissileOwnerLaneFloor > 0
      ? ((nearbyNonMissileOwnerLaneFloor + 1) >>> 0)
      : 0,
  ) >>> 0;
  assert.equal(
    uniqueOwnerStamps.length,
    1,
    "expected a same-wave owner missile burst to stay on one owner delivery lane instead of stair-stepping one tick per launcher",
  );
  assert.equal(
    uniqueOwnerStamps[0] >= expectedSharedOwnerLane,
    true,
    "expected the shared owner missile burst lane to clear the live owner session lane and any nearby non-missile owner lane already sent",
  );
  const ownerVolleyMissiles = getMissileEntities(scene).filter((missile) =>
    getAddBalls2EntityIDs(ownerAddBallsUpdates[0]).includes(missile.itemID),
  );
  const ownerVolleyLaunchSessionStamp = getLatestMissileLaunchSessionStamp(
    scene,
    session,
    ownerVolleyMissiles,
  );
  assert.equal(
    ownerAddBallsUpdates.every((entry) => (
      getAddBalls2StateStamp(entry) === ownerVolleyLaunchSessionStamp
    )),
    true,
    "expected every owner missile AddBalls2 payload state stamp to preserve the shared volley launch snapshot instead of retiming to the delivery lane",
  );
});

test("later owner missile fresh acquires clear the previous shared lane once the live owner tick advances", () => {
  const {
    scene,
    attacker,
    attackerSession,
    target,
    moduleItems,
    chargeItems,
  } = buildMultiLauncherScenario(2, 25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const firstLaunchTimeMs = scene.getCurrentSimTimeMs();
  const firstCurrentOwnerSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    firstLaunchTimeMs,
  );
  const firstLaunchResult = scene.launchMissile(
    attacker,
    target.itemID,
    {
      family: "missileLauncher",
      chargeTypeID: chargeItems[0].typeID,
      maxVelocity: 4_500,
      flightTimeMs: 10_000,
      approxRange: 45_000,
    },
    {
      launchTimeMs: firstLaunchTimeMs,
      moduleItem: moduleItems[0],
      chargeItem: chargeItems[0],
      skipRangeCheck: true,
      broadcastOptions: {
        deferUntilVisibilitySync: true,
      },
    },
  );
  assert.equal(firstLaunchResult.success, true);

  assert.equal(
    flattenDestinyUpdates(attackerSession.notifications)
      .some((entry) => entry.name === "AddBalls2"),
    false,
    "expected deferred owner missile launches not to emit standalone acquires before the next scene tick flush",
  );
  advanceScene(scene, spaceRuntime._testing.RUNTIME_TICK_INTERVAL_MS);
  const firstOwnerAddBallsUpdates = flattenDestinyUpdates(attackerSession.notifications)
    .filter((entry) => entry.name === "AddBalls2");
  assert.equal(firstOwnerAddBallsUpdates.length, 1);
  const firstOwnerLane = firstOwnerAddBallsUpdates[0].stamp >>> 0;
  const firstOwnerSendSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    scene.getCurrentSimTimeMs(),
  );
  assert.equal(
    session._space.lastOwnerMissileLifecycleAnchorStamp >>> 0,
    firstOwnerSendSessionStamp >>> 0,
    "expected the first owner missile lane to remember which live owner tick minted it",
  );

  attackerSession.notifications.length = 0;
  let secondLaunchTimeMs = scene.getCurrentSimTimeMs();
  let secondCurrentOwnerSessionStamp = firstOwnerSendSessionStamp;
  for (let index = 0; index < 12; index += 1) {
    advanceScene(scene, 1_000);
    secondLaunchTimeMs = scene.getCurrentSimTimeMs();
    secondCurrentOwnerSessionStamp = scene.getCurrentSessionDestinyStamp(
      session,
      secondLaunchTimeMs,
    );
    if (
      secondCurrentOwnerSessionStamp >= firstOwnerLane
    ) {
      break;
    }
  }
  assert.equal(
    secondCurrentOwnerSessionStamp >= firstOwnerLane,
    true,
    "expected the scene tick advance to eventually consume the earlier shared missile lane so it can no longer be reused safely",
  );

  const secondLaunchResult = scene.launchMissile(
    attacker,
    target.itemID,
    {
      family: "missileLauncher",
      chargeTypeID: chargeItems[1].typeID,
      maxVelocity: 4_500,
      flightTimeMs: 10_000,
      approxRange: 45_000,
    },
    {
      launchTimeMs: secondLaunchTimeMs,
      moduleItem: moduleItems[1],
      chargeItem: chargeItems[1],
      skipRangeCheck: true,
      broadcastOptions: {
        deferUntilVisibilitySync: true,
      },
    },
  );
  assert.equal(secondLaunchResult.success, true);

  assert.equal(
    flattenDestinyUpdates(attackerSession.notifications)
      .some((entry) => entry.name === "AddBalls2"),
    false,
    "expected the later deferred owner missile launch not to emit a standalone acquire before the next scene tick flush",
  );
  advanceScene(scene, spaceRuntime._testing.RUNTIME_TICK_INTERVAL_MS);
  const secondOwnerAddBallsUpdates = flattenDestinyUpdates(attackerSession.notifications)
    .filter((entry) => entry.name === "AddBalls2");
  assert.equal(secondOwnerAddBallsUpdates.length, 1);
  const secondOwnerLane = secondOwnerAddBallsUpdates[0].stamp >>> 0;
  const secondOwnerSendSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    scene.getCurrentSimTimeMs(),
  );
  const secondDeliveredImmediateOwnerLane = scene.getImmediateDestinyStampForSession(
    session,
    secondOwnerSendSessionStamp,
  );

  assert.equal(
    secondOwnerLane > firstOwnerLane,
    true,
    "expected a later owner missile send not to reuse the earlier shared lane once that lane no longer clears the live owner lane floor",
  );
  assert.equal(
    secondOwnerLane >= (
      (secondDeliveredImmediateOwnerLane + OWNER_MISSILE_CLIENT_LANE_LEAD) >>> 0
    ),
    true,
    "expected the later owner missile send to clear the current live owner lane instead of arriving on the previously consumed one",
  );
  assert.equal(
    session._space.lastOwnerMissileLifecycleAnchorStamp >>> 0,
    secondOwnerSendSessionStamp >>> 0,
    "expected the owner missile lane anchor to advance with the later live owner tick",
  );
});

test("first owner missile after an idle gap clears the projected consumed prior owner missile lane", () => {
  const {
    scene,
    attackerSession,
    target,
    moduleItem,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const currentRawDispatchStamp = scene.getCurrentDestinyStamp(
    scene.getCurrentSimTimeMs(),
  );
  const currentOwnerSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    scene.getCurrentSimTimeMs(),
  );
  const previousOwnerMissileLane = currentOwnerSessionStamp >>> 0;
  const previousOwnerMissileAnchorStamp = (
    currentOwnerSessionStamp > 2
      ? ((currentOwnerSessionStamp - 2) >>> 0)
      : currentOwnerSessionStamp
  ) >>> 0;
  const previousOwnerMissileRawDispatchStamp = (
    currentRawDispatchStamp > 4
      ? ((currentRawDispatchStamp - 4) >>> 0)
      : currentRawDispatchStamp
  ) >>> 0;
  const projectedConsumedOwnerMissileLane = (
    previousOwnerMissileLane +
    (currentRawDispatchStamp - previousOwnerMissileRawDispatchStamp)
  ) >>> 0;

  session._space.lastSentDestinyStamp = previousOwnerMissileLane;
  session._space.lastSentDestinyRawDispatchStamp =
    previousOwnerMissileRawDispatchStamp;
  session._space.lastOwnerMissileLifecycleStamp = previousOwnerMissileLane;
  session._space.lastOwnerMissileLifecycleAnchorStamp =
    previousOwnerMissileAnchorStamp;
  session._space.lastOwnerMissileLifecycleRawDispatchStamp =
    previousOwnerMissileRawDispatchStamp;

  const activationResult = scene.activateGenericModule(
    session,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);

  assert.equal(
    flattenDestinyUpdates(attackerSession.notifications)
      .some((entry) => entry.name === "AddBalls2"),
    false,
    "expected outside-tick missile activation not to emit the owner AddBalls2 acquire before the next scene tick flush",
  );
  advanceScene(scene, spaceRuntime._testing.RUNTIME_TICK_INTERVAL_MS);
  const currentRawDispatchStampAtSend = scene.getCurrentDestinyStamp(
    scene.getCurrentSimTimeMs(),
  );
  const projectedConsumedOwnerMissileLaneAtSend = (
    previousOwnerMissileLane +
    (currentRawDispatchStampAtSend - previousOwnerMissileRawDispatchStamp)
  ) >>> 0;
  const ownerUpdates = flattenDestinyUpdates(attackerSession.notifications);
  const ownerAddBallsUpdate = ownerUpdates.find((entry) => (
    entry.name === "AddBalls2"
  ));
  assert.ok(
    ownerAddBallsUpdate,
    "expected the first idle-gap owner missile fire to emit an AddBalls2 acquire",
  );
  assert.equal(
    ownerAddBallsUpdate.stamp >= (
      (projectedConsumedOwnerMissileLaneAtSend + 1) >>> 0
    ),
    true,
    "expected the first owner missile after an idle gap to clear the projected client-consumed prior owner missile lane instead of rebuilding from the stale session tick",
  );
  const idleGapMissile = getMissileEntities(scene).find(
    (entity) => ownerAddBallsUpdate && getAddBalls2EntityIDs(ownerAddBallsUpdate).includes(entity.itemID),
  );
  assert.ok(
    idleGapMissile,
    "expected the idle-gap owner missile entity to remain live while validating the launch snapshot stamp",
  );
  const idleGapLaunchSessionStamp = getMissileLaunchSessionStamp(
    scene,
    session,
    idleGapMissile,
  );
  assert.equal(
    getAddBalls2StateStamp(ownerAddBallsUpdate),
    idleGapLaunchSessionStamp,
    "expected the idle-gap owner missile AddBalls2 payload state stamp to preserve the authored launch snapshot instead of retiming to the delivery lane",
  );
  assert.equal(
    session._space.lastOwnerMissileLifecycleRawDispatchStamp >>> 0,
    currentRawDispatchStampAtSend >>> 0,
    "expected the new owner missile lane to remember the raw dispatch tick that minted it",
  );
});

test("first owner missile fresh acquires clear a projected prior owner lane from an earlier raw tick", () => {
  const {
    scene,
    attackerSession,
    target,
    moduleItem,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const nowMs = scene.getCurrentSimTimeMs();
  const currentRawDispatchStamp = scene.getCurrentDestinyStamp(nowMs);
  session._space.clockOffsetMs = -1000;
  const currentOwnerSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    nowMs,
  );
  const previousOwnerLane = ((currentOwnerSessionStamp + 1) >>> 0);
  const previousOwnerRawDispatchStamp =
    currentRawDispatchStamp > 0
      ? ((currentRawDispatchStamp - 1) >>> 0)
      : currentRawDispatchStamp;

  session._space.historyFloorDestinyStamp = currentOwnerSessionStamp;
  session._space.lastSentDestinyStamp = previousOwnerLane;
  session._space.lastSentDestinyRawDispatchStamp =
    previousOwnerRawDispatchStamp;
  session._space.lastOwnerMissileLifecycleStamp = 0;
  session._space.lastOwnerMissileLifecycleRawDispatchStamp = 0;
  session._space.lastPilotCommandMovementStamp = 0;

  const activationResult = scene.activateGenericModule(
    session,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);

  assert.equal(
    flattenDestinyUpdates(attackerSession.notifications)
      .some((entry) => entry.name === "AddBalls2"),
    false,
    "expected outside-tick missile activation not to emit the owner AddBalls2 acquire before the next scene tick flush",
  );
  advanceScene(scene, spaceRuntime._testing.RUNTIME_TICK_INTERVAL_MS);
  const currentRawDispatchStampAtSend = scene.getCurrentDestinyStamp(
    scene.getCurrentSimTimeMs(),
  );
  const projectedConsumedOwnerLaneAtSend = (
    previousOwnerLane +
    (currentRawDispatchStampAtSend - previousOwnerRawDispatchStamp)
  ) >>> 0;
  const ownerUpdates = flattenDestinyUpdates(attackerSession.notifications);
  const ownerAddBallsUpdate = ownerUpdates.find((entry) => (
    entry.name === "AddBalls2"
  ));
  assert.ok(
    ownerAddBallsUpdate,
    "expected the launcher owner to receive a missile AddBalls2 acquire",
  );
  assert.equal(
    ownerAddBallsUpdate.stamp >= (
      (projectedConsumedOwnerLaneAtSend + 1) >>> 0
    ),
    true,
    "expected the first owner missile acquire to clear the projected previously sent owner lane instead of rebuilding from the lagging translated owner tick",
  );
});

test("adjacent-tick owner missile fresh acquires clear the previously sent shared lane by two ticks", () => {
  const {
    scene,
    attacker,
    attackerSession,
    target,
    moduleItems,
    chargeItems,
  } = buildMultiLauncherScenario(2, 25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const firstLaunchTimeMs = scene.getCurrentSimTimeMs();
  const firstCurrentOwnerSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    firstLaunchTimeMs,
  );
  const firstLaunchResult = scene.launchMissile(
    attacker,
    target.itemID,
    {
      family: "missileLauncher",
      chargeTypeID: chargeItems[0].typeID,
      maxVelocity: 4_500,
      flightTimeMs: 10_000,
      approxRange: 45_000,
    },
    {
      launchTimeMs: firstLaunchTimeMs,
      moduleItem: moduleItems[0],
      chargeItem: chargeItems[0],
      skipRangeCheck: true,
      broadcastOptions: {
        deferUntilVisibilitySync: true,
      },
    },
  );
  assert.equal(firstLaunchResult.success, true);

  assert.equal(
    flattenDestinyUpdates(attackerSession.notifications)
      .some((entry) => entry.name === "AddBalls2"),
    false,
    "expected deferred owner missile launches not to emit standalone acquires before the next scene tick flush",
  );
  advanceScene(scene, spaceRuntime._testing.RUNTIME_TICK_INTERVAL_MS);
  const firstOwnerAddBallsUpdates = flattenDestinyUpdates(attackerSession.notifications)
    .filter((entry) => entry.name === "AddBalls2");
  assert.equal(firstOwnerAddBallsUpdates.length, 1);
  const firstOwnerLane = firstOwnerAddBallsUpdates[0].stamp >>> 0;
  const firstOwnerSendSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    scene.getCurrentSimTimeMs(),
  );

  attackerSession.notifications.length = 0;
  let secondLaunchTimeMs = scene.getCurrentSimTimeMs();
  let secondCurrentOwnerSessionStamp = firstOwnerSendSessionStamp;
  for (let index = 0; index < 12; index += 1) {
    advanceScene(scene, 1_000);
    secondLaunchTimeMs = scene.getCurrentSimTimeMs();
    secondCurrentOwnerSessionStamp = scene.getCurrentSessionDestinyStamp(
      session,
      secondLaunchTimeMs,
    );
    if (
      secondCurrentOwnerSessionStamp > firstOwnerSendSessionStamp &&
      firstOwnerLane > secondCurrentOwnerSessionStamp
    ) {
      break;
    }
  }
  assert.equal(
    secondCurrentOwnerSessionStamp > firstOwnerSendSessionStamp,
    true,
    "expected the live owner lane to advance to the next tick before the second missile send",
  );
  assert.equal(
    firstOwnerLane > secondCurrentOwnerSessionStamp,
    true,
    "expected the earlier shared owner missile lane still to sit ahead of the live owner floor for the adjacent-tick send",
  );

  const secondLaunchResult = scene.launchMissile(
    attacker,
    target.itemID,
    {
      family: "missileLauncher",
      chargeTypeID: chargeItems[1].typeID,
      maxVelocity: 4_500,
      flightTimeMs: 10_000,
      approxRange: 45_000,
    },
    {
      launchTimeMs: secondLaunchTimeMs,
      moduleItem: moduleItems[1],
      chargeItem: chargeItems[1],
      skipRangeCheck: true,
      broadcastOptions: {
        deferUntilVisibilitySync: true,
      },
    },
  );
  assert.equal(secondLaunchResult.success, true);

  assert.equal(
    flattenDestinyUpdates(attackerSession.notifications)
      .some((entry) => entry.name === "AddBalls2"),
    false,
    "expected the adjacent deferred owner missile launch not to emit a standalone acquire before the next scene tick flush",
  );
  advanceScene(scene, spaceRuntime._testing.RUNTIME_TICK_INTERVAL_MS);
  const secondOwnerAddBallsUpdates = flattenDestinyUpdates(attackerSession.notifications)
    .filter((entry) => entry.name === "AddBalls2");
  assert.equal(secondOwnerAddBallsUpdates.length, 1);
  const secondOwnerLane = secondOwnerAddBallsUpdates[0].stamp >>> 0;
  const secondOwnerSendSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    scene.getCurrentSimTimeMs(),
  );

  assert.equal(
    secondOwnerLane >= ((firstOwnerLane + 2) >>> 0),
    true,
    "expected an adjacent-tick owner missile send to clear the previously sent shared owner missile lane by two ticks instead of reusing it after Michelle has already consumed that lane",
  );
  const secondOwnerVolleyMissiles = getMissileEntities(scene).filter((missile) =>
    getAddBalls2EntityIDs(secondOwnerAddBallsUpdates[0]).includes(missile.itemID),
  );
  const secondOwnerLaunchSessionStamp = getLatestMissileLaunchSessionStamp(
    scene,
    session,
    secondOwnerVolleyMissiles,
  );
  assert.equal(
    getAddBalls2StateStamp(secondOwnerAddBallsUpdates[0]),
    secondOwnerLaunchSessionStamp,
    "expected the adjacent-tick owner missile AddBalls2 payload stamp to preserve the authored launch snapshot instead of retiming to the cleared delivery lane",
  );
  assert.equal(
    session._space.lastOwnerMissileLifecycleAnchorStamp >>> 0,
    secondOwnerSendSessionStamp >>> 0,
    "expected the later owner missile lane anchor to advance to the later live owner tick",
  );
});

test("first owner missile fresh acquires clear a newer gotoDirection lane without stair-stepping the volley", () => {
  const {
    scene,
    attackerSession,
    target,
    moduleItems,
  } = buildMultiLauncherScenario(4, 25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  assert.equal(
    scene.gotoDirection(session, { x: -0.5, y: -0.6, z: -0.6 }),
    true,
  );
  const movementUpdates = flattenDestinyUpdates(attackerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  assert.equal(movementUpdates.length, 1);
  const ownerMovementStamp = movementUpdates[0].stamp >>> 0;

  attackerSession.notifications.length = 0;
  for (const moduleItem of moduleItems) {
    const activationResult = scene.activateGenericModule(
      session,
      moduleItem,
      null,
      {
        targetID: target.itemID,
      },
    );
    assert.equal(activationResult.success, true);
  }

  assert.equal(
    flattenDestinyUpdates(attackerSession.notifications)
      .some((entry) => entry.name === "AddBalls2"),
    false,
    "expected outside-tick owner missile volley launches not to emit standalone owner acquires before the next scene tick flush",
  );
  advanceScene(scene, spaceRuntime._testing.RUNTIME_TICK_INTERVAL_MS);
  const ownerAddBallsUpdates = flattenDestinyUpdates(attackerSession.notifications)
    .filter((entry) => entry.name === "AddBalls2");
  assert.equal(ownerAddBallsUpdates.length, 1);
  assert.equal(
    [...new Set(getAddBalls2EntityIDs(ownerAddBallsUpdates[0]))].length,
    moduleItems.length,
    "expected the queued owner volley AddBalls2 acquire to contain every launched missile",
  );

  const uniqueOwnerStamps = [...new Set(
    ownerAddBallsUpdates.map((entry) => entry.stamp >>> 0),
  )];
  assert.equal(
    uniqueOwnerStamps.length,
    1,
    "expected the owner missile volley to stay on one shared delivery lane after a newer gotoDirection send",
  );
  assert.equal(
    uniqueOwnerStamps[0],
    ((ownerMovementStamp + 1) >>> 0),
    "expected the first owner missile AddBalls2 acquire to clear the already-presented owner gotoDirection lane instead of reusing it on current/current",
  );
  assert.equal(
    uniqueOwnerStamps[0] >= ownerMovementStamp,
    true,
    "expected the first owner missile AddBalls2 acquire not to arrive underneath the already-presented owner gotoDirection lane",
  );
  const ownerVolleyMissiles = getMissileEntities(scene).filter((missile) =>
    getAddBalls2EntityIDs(ownerAddBallsUpdates[0]).includes(missile.itemID),
  );
  const ownerVolleyLaunchSessionStamp = getLatestMissileLaunchSessionStamp(
    scene,
    session,
    ownerVolleyMissiles,
  );
  assert.equal(
    ownerAddBallsUpdates.every((entry) => (
      getAddBalls2StateStamp(entry) === ownerVolleyLaunchSessionStamp
    )),
    true,
    "expected the owner missile volley to keep each AddBalls2 payload state on the shared launch snapshot instead of retiming to the delivery lane",
  );
});

test("same-tick distinct owner gotoDirection commands keep only the first owner echo while observers still get the latest heading", () => {
  const {
    scene,
    attackerSession,
    targetSession,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;
  targetSession.notifications.length = 0;

  const fixedNowMs = scene.getCurrentSimTimeMs();
  const originalGetCurrentSimTimeMs = scene.getCurrentSimTimeMs.bind(scene);
  scene.getCurrentSimTimeMs = () => fixedNowMs;

  try {
    assert.equal(
      scene.gotoDirection(session, { x: 0.2, y: -0.2, z: -1.0 }),
      true,
    );
    assert.equal(
      scene.gotoDirection(session, { x: -0.6, y: -0.2, z: -0.7 }),
      true,
    );

    const ownerMovementUpdates = flattenDestinyUpdates(attackerSession.notifications)
      .filter((entry) => entry.name === "GotoDirection");
    const observerMovementUpdates = flattenDestinyUpdates(targetSession.notifications)
      .filter((entry) => entry.name === "GotoDirection");
    assert.equal(ownerMovementUpdates.length, 1);
    assert.equal(observerMovementUpdates.length, 2);

    const firstOwnerLane = ownerMovementUpdates[0].stamp >>> 0;
    const currentOwnerSessionStamp = scene.getCurrentSessionDestinyStamp(
      session,
      fixedNowMs,
    );

    assert.equal(
      firstOwnerLane >= (
        (currentOwnerSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD) >>> 0
      ),
      true,
      "expected the first owner gotoDirection echo to stay on the owner's direct missile-safe echo lane",
    );
    assert.equal(
      session._space.lastPilotCommandMovementStamp >>> 0,
      firstOwnerLane,
      "expected same-tick distinct owner gotoDirection commands to keep the first owner echo instead of ratcheting a later owner lane",
    );
    assert.equal(
      (
        observerMovementUpdates[1].args.map((value) => (
          value && typeof value === "object" && "value" in value
            ? value.value
            : value
        ))[1] < 0
      ),
      true,
      "expected observers to still receive the latest same-tick steering heading even when the owner echo is suppressed",
    );
    assert.equal(
      session._space.lastPilotCommandMovementAnchorStamp >>> 0,
      currentOwnerSessionStamp >>> 0,
      "expected the owner pilot-command anchor to stay on the current owner tick after same-tick distinct gotoDirection commands",
    );
    assert.equal(
      session._space.lastPilotCommandDirection.x < 0,
      true,
      "expected the latest same-tick gotoDirection heading to remain tracked for the next owner restamp decision",
    );
  } finally {
    scene.getCurrentSimTimeMs = originalGetCurrentSimTimeMs;
  }
});

test("owner missile lifecycle joins the recent owner movement lane instead of arriving underneath it", () => {
  const {
    scene,
    attackerSession,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const currentRawStamp = scene.getCurrentDestinyStamp(
    scene.getCurrentSimTimeMs(),
  );
  const currentOwnerSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    scene.getCurrentSimTimeMs(),
  );
  const recentOwnerMovementLane = (
    currentOwnerSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD
  ) >>> 0;
  session._space.lastPilotCommandMovementStamp = recentOwnerMovementLane;
  session._space.lastSentDestinyStamp = recentOwnerMovementLane;
  session._space.lastOwnerMissileLifecycleStamp = (
    recentOwnerMovementLane - 1
  ) >>> 0;

  scene.sendDestinyUpdates(
    session,
    [
      {
        stamp: (recentOwnerMovementLane - 1) >>> 0,
        payload: ["AddBalls2", []],
        ownerMissileLifecycleGroup: true,
      },
    ],
    false,
    {
      translateStamps: false,
    },
  );

  const ownerAddBallsUpdates = flattenDestinyUpdates(attackerSession.notifications)
    .filter((entry) => entry.name === "AddBalls2");
  assert.equal(ownerAddBallsUpdates.length, 1);
  assert.equal(
    ownerAddBallsUpdates[0].stamp >= recentOwnerMovementLane,
    true,
    "expected later owner missile lifecycle packets to stay on or above the recent owner movement lane instead of arriving underneath it",
  );
});

test("owner missile lifecycle may reuse a masked nearby owner combat lane from an earlier tick when it is still the presented owner lane", () => {
  const {
    scene,
    attackerSession,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const currentRawStamp = scene.getCurrentDestinyStamp(
    scene.getCurrentSimTimeMs(),
  );
  const currentOwnerSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    scene.getCurrentSimTimeMs(),
  );
  const maskedOwnerLane = (
    currentOwnerSessionStamp +
    OWNER_MISSILE_CLIENT_LANE_LEAD +
    2
  ) >>> 0;
  session._space.lastSentDestinyStamp = maskedOwnerLane;
  session._space.lastSentDestinyRawDispatchStamp = currentRawStamp;
  session._space.lastOwnerNonMissileCriticalStamp = maskedOwnerLane;
  session._space.lastOwnerNonMissileCriticalRawDispatchStamp = currentRawStamp;
  session._space.lastPilotCommandMovementStamp = maskedOwnerLane;
  session._space.lastOwnerMissileLifecycleStamp = maskedOwnerLane;
  session._space.lastOwnerMissileLifecycleAnchorStamp =
    currentOwnerSessionStamp > 0
      ? ((currentOwnerSessionStamp - 1) >>> 0)
      : 0;

  scene.sendDestinyUpdates(
    session,
    [
      {
        stamp: (
          currentOwnerSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD
        ) >>> 0,
        payload: ["AddBalls2", []],
        ownerMissileLifecycleGroup: true,
      },
    ],
    false,
    {
      translateStamps: false,
    },
  );

  const ownerAddBallsUpdates = flattenDestinyUpdates(attackerSession.notifications)
    .filter((entry) => entry.name === "AddBalls2");
  assert.equal(ownerAddBallsUpdates.length, 1);
  assert.equal(
    ownerAddBallsUpdates[0].stamp,
    maskedOwnerLane,
    "expected owner missile lifecycle to stay on the nearby already-presented owner combat lane when it still clears the current authored tick instead of unnecessarily stair-stepping above it",
  );
});

test("adjacent-tick owner missile lifecycle packets clear the previously sent shared volley lane by two ticks", () => {
  const {
    scene,
    attackerSession,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const currentOwnerSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    scene.getCurrentSimTimeMs(),
  );
  const sharedOwnerLane = (
    currentOwnerSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD
  ) >>> 0;
  session._space.lastSentDestinyStamp = sharedOwnerLane;
  session._space.lastOwnerMissileLifecycleStamp = sharedOwnerLane;
  session._space.lastOwnerMissileLifecycleAnchorStamp =
    currentOwnerSessionStamp > 0
      ? ((currentOwnerSessionStamp - 1) >>> 0)
      : 0;

  scene.sendDestinyUpdates(
    session,
    [
      {
        stamp: ((sharedOwnerLane + 1) >>> 0),
        payload: ["AddBalls2", []],
        ownerMissileLifecycleGroup: true,
      },
      {
        stamp: ((sharedOwnerLane + 1) >>> 0),
        payload: destiny.buildRemoveBallsPayload([980000000001]),
        ownerMissileLifecycleGroup: true,
      },
    ],
    false,
    {
      translateStamps: false,
    },
  );

  const ownerUpdates = flattenDestinyUpdates(attackerSession.notifications).filter(
    (entry) => entry.name === "AddBalls2" || entry.name === "RemoveBalls",
  );
  assert.equal(ownerUpdates.length, 2);
  assert.equal(
    ownerUpdates.every((entry) => (entry.stamp >>> 0) >= ((sharedOwnerLane + 2) >>> 0)),
    true,
    "expected adjacent-tick owner missile lifecycle packets to clear the previously sent shared owner volley lane by two ticks instead of reusing a lane Michelle has already consumed",
  );
});

test("mixed owner missile fresh acquires and teardown do not share one owner lane", () => {
  const {
    scene,
    attackerSession,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const currentRawStamp = scene.getCurrentDestinyStamp(
    scene.getCurrentSimTimeMs(),
  );
  session._space.lastSentDestinyStamp = currentRawStamp;
  session._space.lastFreshAcquireLifecycleStamp = 0;
  session._space.lastMissileLifecycleStamp = 0;
  session._space.lastOwnerMissileLifecycleStamp = 0;
  session._space.lastOwnerMissileLifecycleAnchorStamp = 0;
  session._space.lastOwnerMissileLifecycleRawDispatchStamp = 0;

  scene.sendDestinyUpdates(
    session,
    [
      {
        stamp: currentRawStamp,
        payload: ["AddBalls2", []],
        freshAcquireLifecycleGroup: true,
        missileLifecycleGroup: true,
        ownerMissileLifecycleGroup: true,
      },
      {
        stamp: currentRawStamp,
        payload: destiny.buildTerminalPlayDestructionEffectPayload(
          980000000200,
          3,
        ),
        missileLifecycleGroup: true,
        ownerMissileLifecycleGroup: true,
      },
      {
        stamp: currentRawStamp,
        payload: destiny.buildRemoveBallsPayload([980000000200]),
        missileLifecycleGroup: true,
        ownerMissileLifecycleGroup: true,
      },
      {
        stamp: currentRawStamp,
        payload: [
          "OnDamageStateChange",
          [980000000099, { shield: 0.5 }],
        ],
        missileLifecycleGroup: true,
        ownerMissileLifecycleGroup: true,
      },
    ],
    false,
    {
      translateStamps: false,
    },
  );

  const ownerUpdates = flattenDestinyUpdates(attackerSession.notifications).filter(
    (entry) => (
      entry.name === "AddBalls2" ||
      entry.name === "TerminalPlayDestructionEffect" ||
      entry.name === "RemoveBalls" ||
      entry.name === "OnDamageStateChange"
    ),
  );
  const ownerAddBallsUpdate = ownerUpdates.find((entry) => entry.name === "AddBalls2");
  const ownerTerminalUpdate = ownerUpdates.find(
    (entry) => entry.name === "TerminalPlayDestructionEffect",
  );
  const ownerRemoveUpdate = ownerUpdates.find((entry) => entry.name === "RemoveBalls");
  const ownerDamageUpdate = ownerUpdates.find(
    (entry) => entry.name === "OnDamageStateChange",
  );
  assert.ok(ownerAddBallsUpdate, "expected the mixed owner batch to keep its AddBalls2 acquire");
  assert.ok(ownerTerminalUpdate, "expected the mixed owner batch to keep its destruction effect");
  assert.ok(ownerRemoveUpdate, "expected the mixed owner batch to keep its removal");
  assert.ok(ownerDamageUpdate, "expected the mixed owner batch to keep its damage-state update");
  assert.equal(
    ownerRemoveUpdate.stamp >= ((ownerAddBallsUpdate.stamp + 1) >>> 0),
    true,
    "expected owner missile teardown not to share the same owner lane as its fresh acquire",
  );
  assert.equal(
    ownerTerminalUpdate.stamp,
    ownerRemoveUpdate.stamp,
    "expected owner missile destruction effects to stay aligned with the delayed owner removal lane",
  );
  assert.equal(
    ownerDamageUpdate.stamp,
    ownerRemoveUpdate.stamp,
    "expected owner missile damage-state updates to stay aligned with the delayed owner removal lane",
  );
});

test("adjacent owner missile teardown clears the prior fresh-acquire lane across separate sends", () => {
  const {
    scene,
    attackerSession,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;
  const currentOwnerSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    scene.getCurrentSimTimeMs(),
  );

  scene.sendDestinyUpdates(
    session,
    [
      {
        stamp: currentOwnerSessionStamp >>> 0,
        payload: ["AddBalls2", []],
        freshAcquireLifecycleGroup: true,
        missileLifecycleGroup: true,
        ownerMissileLifecycleGroup: true,
      },
    ],
    false,
    {
      translateStamps: false,
    },
  );

  scene.sendDestinyUpdates(
    session,
    [
      {
        stamp: currentOwnerSessionStamp >>> 0,
        payload: destiny.buildTerminalPlayDestructionEffectPayload(
          980000000200,
          3,
        ),
        missileLifecycleGroup: true,
        ownerMissileLifecycleGroup: true,
      },
      {
        stamp: currentOwnerSessionStamp >>> 0,
        payload: destiny.buildRemoveBallsPayload([980000000200]),
        missileLifecycleGroup: true,
        ownerMissileLifecycleGroup: true,
      },
    ],
    false,
    {
      translateStamps: false,
    },
  );

  const ownerUpdates = flattenDestinyUpdates(attackerSession.notifications).filter(
    (entry) => (
      entry.name === "AddBalls2" ||
      entry.name === "TerminalPlayDestructionEffect" ||
      entry.name === "RemoveBalls"
    ),
  );
  const ownerAddBallsUpdate = ownerUpdates.find((entry) => entry.name === "AddBalls2");
  const ownerTerminalUpdate = ownerUpdates.find(
    (entry) => entry.name === "TerminalPlayDestructionEffect",
  );
  const ownerRemoveUpdate = ownerUpdates.find((entry) => entry.name === "RemoveBalls");
  assert.ok(ownerAddBallsUpdate, "expected the fresh acquire to stay visible to the owner");
  assert.ok(ownerTerminalUpdate, "expected the delayed destruction effect to remain present");
  assert.ok(ownerRemoveUpdate, "expected the delayed owner removal to remain present");
  assert.equal(
    ownerTerminalUpdate.stamp >= ((ownerAddBallsUpdate.stamp + 1) >>> 0),
    true,
    "expected owner missile teardown from a later send to clear the prior fresh-acquire lane instead of reusing it",
  );
  assert.equal(
    ownerRemoveUpdate.stamp,
    ownerTerminalUpdate.stamp,
    "expected owner missile removal to stay aligned with the delayed destruction effect lane",
  );
});

test("same-raw-dispatch owner teardown clears a far-ahead owner fresh-acquire lane from a separate send", () => {
  const {
    scene,
    attackerSession,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const fixedNowMs = scene.getCurrentSimTimeMs();
  const originalGetCurrentSimTimeMs = scene.getCurrentSimTimeMs.bind(scene);
  scene.getCurrentSimTimeMs = () => fixedNowMs;

  try {
    const currentRawStamp = scene.getCurrentDestinyStamp(fixedNowMs);
    const currentOwnerSessionStamp = scene.getCurrentSessionDestinyStamp(
      session,
      fixedNowMs,
    );
    const priorOwnerCombatLane = (
      currentOwnerSessionStamp +
      OWNER_MISSILE_CLIENT_LANE_LEAD +
      10
    ) >>> 0;

    session._space.lastSentDestinyStamp = priorOwnerCombatLane;
    session._space.lastSentDestinyRawDispatchStamp = currentRawStamp;
    session._space.lastOwnerMissileLifecycleStamp = priorOwnerCombatLane;
    session._space.lastOwnerMissileFreshAcquireStamp = 0;
    session._space.lastOwnerMissileFreshAcquireAnchorStamp = 0;
    session._space.lastOwnerMissileFreshAcquireRawDispatchStamp = 0;
    session._space.lastOwnerMissileLifecycleAnchorStamp = currentOwnerSessionStamp;
    session._space.lastOwnerMissileLifecycleRawDispatchStamp = currentRawStamp;

    scene.sendDestinyUpdates(
      session,
      [
        {
          stamp: currentRawStamp >>> 0,
          payload: ["AddBalls2", []],
          freshAcquireLifecycleGroup: true,
          missileLifecycleGroup: true,
          ownerMissileLifecycleGroup: true,
        },
      ],
      false,
      {
        translateStamps: false,
      },
    );

    scene.sendDestinyUpdates(
      session,
      [
        {
          stamp: currentRawStamp >>> 0,
          payload: destiny.buildTerminalPlayDestructionEffectPayload(
            980000000200,
            3,
          ),
          missileLifecycleGroup: true,
          ownerMissileLifecycleGroup: true,
        },
        {
          stamp: currentRawStamp >>> 0,
          payload: destiny.buildRemoveBallsPayload([980000000200]),
          missileLifecycleGroup: true,
          ownerMissileLifecycleGroup: true,
        },
        {
          stamp: ((currentRawStamp + 1) >>> 0),
          payload: [
            "OnDamageStateChange",
            [980000000099, { shield: 0.5 }],
          ],
          missileLifecycleGroup: true,
          ownerMissileLifecycleGroup: true,
        },
      ],
      false,
      {
        translateStamps: false,
      },
    );

    const ownerUpdates = flattenDestinyUpdates(attackerSession.notifications).filter(
      (entry) => (
        entry.name === "AddBalls2" ||
        entry.name === "TerminalPlayDestructionEffect" ||
        entry.name === "RemoveBalls" ||
        entry.name === "OnDamageStateChange"
      ),
    );
    const ownerAddBallsUpdate = ownerUpdates.find((entry) => entry.name === "AddBalls2");
    const ownerTerminalUpdate = ownerUpdates.find(
      (entry) => entry.name === "TerminalPlayDestructionEffect",
    );
    const ownerRemoveUpdate = ownerUpdates.find((entry) => entry.name === "RemoveBalls");
    const ownerDamageUpdate = ownerUpdates.find(
      (entry) => entry.name === "OnDamageStateChange",
    );

    assert.ok(
      ownerAddBallsUpdate,
      "expected the owner fresh acquire to remain visible in the far-ahead lane scenario",
    );
    assert.ok(
      ownerTerminalUpdate,
      "expected the owner destruction effect to remain visible in the far-ahead lane scenario",
    );
    assert.ok(
      ownerRemoveUpdate,
      "expected the owner removal to remain visible in the far-ahead lane scenario",
    );
    assert.ok(
      ownerDamageUpdate,
      "expected the owner damage-state update to remain visible in the far-ahead lane scenario",
    );
    assert.equal(
      ownerTerminalUpdate.stamp >= ((ownerAddBallsUpdate.stamp + 1) >>> 0),
      true,
      "expected a later owner teardown send in the same raw dispatch to clear the far-ahead fresh-acquire lane instead of reusing it",
    );
    assert.equal(
      ownerRemoveUpdate.stamp,
      ownerTerminalUpdate.stamp,
      "expected owner removal to stay aligned with the delayed destruction effect lane in the far-ahead scenario",
    );
    assert.equal(
      ownerDamageUpdate.stamp,
      ownerTerminalUpdate.stamp,
      "expected owner damage-state updates to stay aligned with the delayed teardown lane in the far-ahead scenario",
    );
  } finally {
    scene.getCurrentSimTimeMs = originalGetCurrentSimTimeMs;
  }
});

test("same-raw-dispatch later owner fresh acquire clears a same-tick owner teardown lane", () => {
  const {
    scene,
    attackerSession,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const fixedNowMs = scene.getCurrentSimTimeMs();
  const originalGetCurrentSimTimeMs = scene.getCurrentSimTimeMs.bind(scene);
  scene.getCurrentSimTimeMs = () => fixedNowMs;

  try {
    const currentRawStamp = scene.getCurrentDestinyStamp(fixedNowMs);

    scene.sendDestinyUpdates(
      session,
      [
        {
          stamp: currentRawStamp >>> 0,
          payload: ["AddBalls2", []],
          freshAcquireLifecycleGroup: true,
          missileLifecycleGroup: true,
          ownerMissileLifecycleGroup: true,
        },
      ],
      false,
      {
        translateStamps: false,
      },
    );

    scene.sendDestinyUpdates(
      session,
      [
        {
          stamp: currentRawStamp >>> 0,
          payload: destiny.buildTerminalPlayDestructionEffectPayload(
            980000000200,
            3,
          ),
          missileLifecycleGroup: true,
          ownerMissileLifecycleGroup: true,
        },
        {
          stamp: currentRawStamp >>> 0,
          payload: destiny.buildRemoveBallsPayload([980000000200]),
          missileLifecycleGroup: true,
          ownerMissileLifecycleGroup: true,
        },
      ],
      false,
      {
        translateStamps: false,
      },
    );

    scene.sendDestinyUpdates(
      session,
      [
        {
          stamp: currentRawStamp >>> 0,
          payload: ["AddBalls2", []],
          freshAcquireLifecycleGroup: true,
          missileLifecycleGroup: true,
          ownerMissileLifecycleGroup: true,
        },
      ],
      false,
      {
        translateStamps: false,
      },
    );

    const ownerUpdates = flattenDestinyUpdates(attackerSession.notifications).filter(
      (entry) => (
        entry.name === "AddBalls2" ||
        entry.name === "TerminalPlayDestructionEffect" ||
        entry.name === "RemoveBalls"
      ),
    );
    const ownerAddBallsUpdates = ownerUpdates.filter(
      (entry) => entry.name === "AddBalls2",
    );
    const ownerTerminalUpdate = ownerUpdates.find(
      (entry) => entry.name === "TerminalPlayDestructionEffect",
    );
    const ownerRemoveUpdate = ownerUpdates.find((entry) => entry.name === "RemoveBalls");

    assert.equal(ownerAddBallsUpdates.length, 2);
    assert.ok(
      ownerTerminalUpdate,
      "expected the owner teardown batch to keep its destruction effect",
    );
    assert.ok(
      ownerRemoveUpdate,
      "expected the owner teardown batch to keep its removal",
    );
    assert.equal(
      ownerRemoveUpdate.stamp,
      ownerTerminalUpdate.stamp,
      "expected owner missile removal to stay aligned with the owner destruction effect lane",
    );
    assert.equal(
      (ownerAddBallsUpdates[1].stamp >>> 0) >= ((ownerRemoveUpdate.stamp + 1) >>> 0),
      true,
      "expected a later same-raw owner fresh acquire to clear the already-sent owner teardown lane instead of reusing it",
    );
  } finally {
    scene.getCurrentSimTimeMs = originalGetCurrentSimTimeMs;
  }
});

test("owner fresh acquire clears a nearby same-tick owner teardown lane from an earlier raw dispatch", () => {
  const {
    scene,
    attackerSession,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const nowMs = scene.getCurrentSimTimeMs();
  const currentRawStamp = scene.getCurrentDestinyStamp(nowMs);
  const currentOwnerSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    nowMs,
  );
  const currentImmediateOwnerStamp = scene.getImmediateDestinyStampForSession(
    session,
    currentOwnerSessionStamp,
  );
  const priorOwnerFreshAcquireAnchorStamp = (
    currentOwnerSessionStamp > 1
      ? ((currentOwnerSessionStamp - 2) >>> 0)
      : 0
  );
  const priorOwnerFreshAcquireRawDispatchStamp = (
    currentRawStamp > 1
      ? ((currentRawStamp - 2) >>> 0)
      : 0
  );
  const nearbyOwnerTeardownLane = (
    currentImmediateOwnerStamp +
    OWNER_MISSILE_CLIENT_LANE_LEAD +
    5
  ) >>> 0;

  session._space.lastSentDestinyStamp = nearbyOwnerTeardownLane;
  session._space.lastSentDestinyRawDispatchStamp = currentRawStamp;
  session._space.lastFreshAcquireLifecycleStamp = nearbyOwnerTeardownLane;
  session._space.lastMissileLifecycleStamp = nearbyOwnerTeardownLane;
  session._space.lastOwnerMissileLifecycleStamp = nearbyOwnerTeardownLane;
  session._space.lastOwnerMissileFreshAcquireStamp = nearbyOwnerTeardownLane;
  session._space.lastOwnerMissileFreshAcquireAnchorStamp =
    priorOwnerFreshAcquireAnchorStamp;
  session._space.lastOwnerMissileFreshAcquireRawDispatchStamp =
    priorOwnerFreshAcquireRawDispatchStamp;
  session._space.lastOwnerMissileLifecycleAnchorStamp = currentOwnerSessionStamp;
  session._space.lastOwnerMissileLifecycleRawDispatchStamp = currentRawStamp;

  scene.sendDestinyUpdates(
    session,
    [
      {
        stamp: currentRawStamp >>> 0,
        payload: ["AddBalls2", []],
        freshAcquireLifecycleGroup: true,
        missileLifecycleGroup: true,
        ownerMissileLifecycleGroup: true,
      },
    ],
    false,
    {
      translateStamps: false,
    },
  );

  const ownerAddBallsUpdate = flattenDestinyUpdates(
    attackerSession.notifications,
  ).find((entry) => entry.name === "AddBalls2");

  assert.ok(
    ownerAddBallsUpdate,
    "expected the later owner fresh acquire to remain visible",
  );
  assert.equal(
    ownerAddBallsUpdate.stamp >= ((nearbyOwnerTeardownLane + 1) >>> 0),
    true,
    "expected a later owner fresh acquire not to reuse the nearby same-tick owner teardown lane from the earlier raw dispatch",
  );
});

test("owner missile impact batches reuse a nearby already-sent owner missile lane even if the translated owner clock lags behind it", () => {
  const {
    scene,
    attackerSession,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const currentRawStamp = scene.getCurrentDestinyStamp(
    scene.getCurrentSimTimeMs(),
  );
  session._space.clockOffsetMs = -4_000;
  const laggedOwnerSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    scene.getCurrentSimTimeMs(),
  );
  const nearbyFutureOwnerMissileLane = (
    currentRawStamp +
    OWNER_MISSILE_CLIENT_LANE_LEAD +
    2
  ) >>> 0;
  session._space.lastSentDestinyStamp = nearbyFutureOwnerMissileLane;
  session._space.lastOwnerMissileLifecycleStamp = nearbyFutureOwnerMissileLane;
  session._space.lastOwnerMissileLifecycleAnchorStamp =
    laggedOwnerSessionStamp > 0
      ? ((laggedOwnerSessionStamp - 1) >>> 0)
      : 0;

  scene.sendDestinyUpdates(
    session,
    [
      {
        stamp: currentRawStamp,
        payload: destiny.buildTerminalPlayDestructionEffectPayload(
          980000000100,
          3,
        ),
        ownerMissileLifecycleGroup: true,
      },
      {
        stamp: currentRawStamp,
        payload: destiny.buildRemoveBallsPayload([980000000100]),
        ownerMissileLifecycleGroup: true,
      },
      {
        stamp: currentRawStamp,
        payload: [
          "OnDamageStateChange",
          [980000000099, { shield: 1 }],
        ],
        ownerMissileLifecycleGroup: true,
      },
    ],
    false,
    {
      translateStamps: false,
      minimumLeadFromCurrentHistory: OWNER_MISSILE_CLIENT_LANE_LEAD,
      maximumLeadFromCurrentHistory: OWNER_MISSILE_CLIENT_LANE_LEAD,
      historyLeadUsesCurrentSessionStamp: true,
    },
  );

  const ownerUpdates = flattenDestinyUpdates(attackerSession.notifications).filter(
    (entry) =>
      entry.name === "TerminalPlayDestructionEffect" ||
      entry.name === "RemoveBalls" ||
      entry.name === "OnDamageStateChange",
  );
  assert.equal(ownerUpdates.length, 3);
  assert.equal(
    ownerUpdates.every(
      (entry) => (entry.stamp >>> 0) === nearbyFutureOwnerMissileLane,
    ),
    true,
    "expected a late owner missile impact batch to stay on the nearby already-sent owner missile lane instead of dropping back to the lagging translated owner clock",
  );
});

test("owner fresh acquires ignore an untrusted projected stale owner missile lane from a prior raw dispatch", () => {
  const {
    scene,
    attackerSession,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const nowMs = scene.getCurrentSimTimeMs();
  const currentRawStamp = scene.getCurrentDestinyStamp(nowMs);
  const priorRawStamp =
    currentRawStamp > 0
      ? ((currentRawStamp - 1) >>> 0)
      : currentRawStamp;
  const currentOwnerSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    nowMs,
  );
  const immediateOwnerLane = getImmediateClientLaneStamp(scene, session);
  const inflatedPriorOwnerMissileLane = (
    currentOwnerSessionStamp +
    OWNER_MISSILE_CLIENT_LANE_LEAD +
    30
  ) >>> 0;

  session._space.lastSentDestinyStamp = inflatedPriorOwnerMissileLane;
  session._space.lastSentDestinyRawDispatchStamp = priorRawStamp;
  session._space.lastSentDestinyOnlyStaleProjectedOwnerMissileLane = true;
  session._space.lastOwnerMissileLifecycleStamp = inflatedPriorOwnerMissileLane;
  session._space.lastOwnerMissileLifecycleAnchorStamp =
    currentOwnerSessionStamp > 0
      ? ((currentOwnerSessionStamp - 1) >>> 0)
      : 0;
  session._space.lastOwnerMissileLifecycleRawDispatchStamp = priorRawStamp;
  session._space.lastOwnerMissileFreshAcquireStamp = 0;
  session._space.lastOwnerMissileFreshAcquireAnchorStamp = 0;
  session._space.lastOwnerMissileFreshAcquireRawDispatchStamp = 0;
  session._space.lastFreshAcquireLifecycleStamp = 0;
  session._space.lastPilotCommandMovementStamp = 0;
  session._space.lastPilotCommandMovementAnchorStamp = 0;

  scene.sendDestinyUpdates(
    session,
    [
      {
        stamp: currentRawStamp >>> 0,
        payload: ["AddBalls2", []],
        freshAcquireLifecycleGroup: true,
        missileLifecycleGroup: true,
        ownerMissileLifecycleGroup: true,
      },
    ],
    false,
    {
      translateStamps: false,
    },
  );

  const ownerAddBallsUpdate = flattenDestinyUpdates(attackerSession.notifications).find(
    (entry) => entry.name === "AddBalls2",
  );
  assert.ok(
    ownerAddBallsUpdate,
    "expected the owner session to receive a fresh-acquire AddBalls2 update",
  );
  assert.equal(
    ownerAddBallsUpdate.stamp >>> 0,
    (
      immediateOwnerLane +
      OWNER_MISSILE_CLIENT_LANE_LEAD
    ) >>> 0,
    "expected a fresh owner missile acquire to stay on the immediate owner +2 hold window instead of stair-stepping off an untrusted projected stale missile lane",
  );
  assert.equal(
    ownerAddBallsUpdate.stamp < inflatedPriorOwnerMissileLane,
    true,
    "expected an untrusted stale owner missile lane from the prior raw dispatch not to be reused as the new owner fresh-acquire floor",
  );
});

test("owner fresh acquires stay above a real recent owner missile lifecycle lane from the immediately prior raw dispatch", () => {
  const {
    scene,
    attackerSession,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const nowMs = scene.getCurrentSimTimeMs();
  const currentRawStamp = scene.getCurrentDestinyStamp(nowMs);
  const priorRawStamp =
    currentRawStamp > 0
      ? ((currentRawStamp - 1) >>> 0)
      : currentRawStamp;
  const currentOwnerSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    nowMs,
  );
  const priorOwnerAnchorStamp =
    currentOwnerSessionStamp > 0
      ? ((currentOwnerSessionStamp - 1) >>> 0)
      : 0;
  const immediateOwnerLane = getImmediateClientLaneStamp(scene, session, nowMs);
  const recentlySentOwnerFreshAcquireLane = (
    immediateOwnerLane +
    OWNER_MISSILE_CLIENT_LANE_LEAD +
    10
  ) >>> 0;
  const recentlySentOwnerLifecycleLane = (
    (recentlySentOwnerFreshAcquireLane + 1) >>> 0
  );

  session._space.lastSentDestinyStamp = recentlySentOwnerLifecycleLane;
  session._space.lastSentDestinyRawDispatchStamp = priorRawStamp;
  session._space.lastSentDestinyOnlyStaleProjectedOwnerMissileLane = false;
  session._space.lastOwnerNonMissileCriticalStamp = 0;
  session._space.lastOwnerNonMissileCriticalRawDispatchStamp = 0;
  session._space.lastFreshAcquireLifecycleStamp = recentlySentOwnerFreshAcquireLane;
  session._space.lastMissileLifecycleStamp = recentlySentOwnerLifecycleLane;
  session._space.lastOwnerMissileLifecycleStamp = recentlySentOwnerLifecycleLane;
  session._space.lastOwnerMissileLifecycleAnchorStamp = priorOwnerAnchorStamp;
  session._space.lastOwnerMissileLifecycleRawDispatchStamp = priorRawStamp;
  session._space.lastOwnerMissileFreshAcquireStamp =
    recentlySentOwnerFreshAcquireLane;
  session._space.lastOwnerMissileFreshAcquireAnchorStamp = priorOwnerAnchorStamp;
  session._space.lastOwnerMissileFreshAcquireRawDispatchStamp = priorRawStamp;
  session._space.lastPilotCommandMovementStamp = 0;
  session._space.lastPilotCommandMovementAnchorStamp = 0;

  scene.sendDestinyUpdates(
    session,
    [
      {
        stamp: currentRawStamp >>> 0,
        payload: ["AddBalls2", []],
        freshAcquireLifecycleGroup: true,
        missileLifecycleGroup: true,
        ownerMissileLifecycleGroup: true,
      },
    ],
    false,
    {
      translateStamps: false,
    },
  );

  const ownerAddBallsUpdate = flattenDestinyUpdates(attackerSession.notifications).find(
    (entry) => entry.name === "AddBalls2",
  );
  assert.ok(
    ownerAddBallsUpdate,
    "expected the owner session to receive a fresh-acquire AddBalls2 update",
  );
  assert.equal(
    ownerAddBallsUpdate.stamp >= ((recentlySentOwnerLifecycleLane + 1) >>> 0),
    true,
    "expected a fresh owner missile acquire not to backstep under the real owner missile lifecycle lane delivered on the immediately prior raw dispatch",
  );
});

test("owner fresh acquires ignore a recent owner missile lane once it exceeds the buffered owner-critical ceiling", () => {
  const {
    scene,
    attackerSession,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const nowMs = scene.getCurrentSimTimeMs();
  const currentRawStamp = scene.getCurrentDestinyStamp(nowMs);
  const priorRawStamp =
    currentRawStamp > 0
      ? ((currentRawStamp - 1) >>> 0)
      : currentRawStamp;
  const currentOwnerSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    nowMs,
  );
  const priorOwnerAnchorStamp =
    currentOwnerSessionStamp > 0
      ? ((currentOwnerSessionStamp - 1) >>> 0)
      : 0;
  const immediateOwnerLane = getImmediateClientLaneStamp(scene, session, nowMs);
  const inflatedRecentOwnerLifecycleLane = (
    immediateOwnerLane +
    RECENT_EMITTED_OWNER_CRITICAL_MAX_LEAD +
    4
  ) >>> 0;

  session._space.lastSentDestinyStamp = inflatedRecentOwnerLifecycleLane;
  session._space.lastSentDestinyRawDispatchStamp = priorRawStamp;
  session._space.lastSentDestinyOnlyStaleProjectedOwnerMissileLane = false;
  session._space.lastSentDestinyWasOwnerCritical = true;
  session._space.lastFreshAcquireLifecycleStamp = inflatedRecentOwnerLifecycleLane;
  session._space.lastMissileLifecycleStamp = inflatedRecentOwnerLifecycleLane;
  session._space.lastOwnerMissileLifecycleStamp = inflatedRecentOwnerLifecycleLane;
  session._space.lastOwnerMissileLifecycleAnchorStamp = priorOwnerAnchorStamp;
  session._space.lastOwnerMissileLifecycleRawDispatchStamp = priorRawStamp;
  session._space.lastOwnerMissileFreshAcquireStamp =
    inflatedRecentOwnerLifecycleLane;
  session._space.lastOwnerMissileFreshAcquireAnchorStamp = priorOwnerAnchorStamp;
  session._space.lastOwnerMissileFreshAcquireRawDispatchStamp = priorRawStamp;
  session._space.lastOwnerNonMissileCriticalStamp = 0;
  session._space.lastOwnerNonMissileCriticalRawDispatchStamp = 0;
  session._space.lastPilotCommandMovementStamp = 0;
  session._space.lastPilotCommandMovementAnchorStamp = 0;

  scene.sendDestinyUpdates(
    session,
    [
      {
        stamp: currentRawStamp >>> 0,
        payload: ["AddBalls2", []],
        freshAcquireLifecycleGroup: true,
        missileLifecycleGroup: true,
        ownerMissileLifecycleGroup: true,
      },
    ],
    false,
    {
      translateStamps: false,
    },
  );

  const ownerAddBallsUpdate = flattenDestinyUpdates(attackerSession.notifications).find(
    (entry) => entry.name === "AddBalls2",
  );
  assert.ok(
    ownerAddBallsUpdate,
    "expected the owner session to receive a fresh-acquire AddBalls2 update",
  );
  assert.equal(
    ownerAddBallsUpdate.stamp >>> 0,
    ((immediateOwnerLane + OWNER_MISSILE_CLIENT_LANE_LEAD) >>> 0),
    "expected a fresh owner missile acquire to ignore a recently emitted owner missile lane once that lane has exceeded the trusted buffered owner-critical ceiling instead of ratcheting even farther ahead",
  );
  assert.equal(
    ownerAddBallsUpdate.stamp < inflatedRecentOwnerLifecycleLane,
    true,
    "expected an over-inflated recent owner missile lane not to keep stair-stepping the next owner fresh acquire",
  );
});

test("sendDestinyUpdates clamps owner missile fresh acquires above Michelle's buffered owner-critical ceiling", () => {
  const {
    scene,
    attackerSession,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const nowMs = scene.getCurrentSimTimeMs();
  const currentOwnerSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    nowMs,
  );
  const authoredOverCeilingStamp = (
    currentOwnerSessionStamp +
    OWNER_MISSILE_CLIENT_LANE_LEAD +
    6
  ) >>> 0;

  scene.sendDestinyUpdates(
    session,
    [
      {
        stamp: authoredOverCeilingStamp,
        payload: ["AddBalls2", []],
        freshAcquireLifecycleGroup: true,
        missileLifecycleGroup: true,
        ownerMissileLifecycleGroup: true,
      },
    ],
    false,
    {
      translateStamps: false,
    },
  );

  const ownerAddBallsUpdate = flattenDestinyUpdates(attackerSession.notifications).find(
    (entry) => entry.name === "AddBalls2",
  );
  assert.ok(
    ownerAddBallsUpdate,
    "expected the owner session to receive a fresh-acquire AddBalls2 update",
  );
  assert.equal(
    ownerAddBallsUpdate.stamp < authoredOverCeilingStamp,
    true,
    "expected owner missile fresh acquires sent above Michelle's buffered future window to be clamped before delivery",
  );
  assert.equal(
    ownerAddBallsUpdate.stamp <= (
      (currentOwnerSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD) >>> 0
    ),
    true,
    "expected owner missile fresh acquires not to be emitted beyond the client's +2 buffered owner-critical hold window",
  );
});

test("later owner fresh acquires clear a recently delivered far-ahead owner fresh-acquire lane from the prior raw dispatch", () => {
  const {
    scene,
    attackerSession,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const nowMs = scene.getCurrentSimTimeMs();
  const currentRawStamp = scene.getCurrentDestinyStamp(nowMs);
  const priorRawStamp =
    currentRawStamp > 0
      ? ((currentRawStamp - 1) >>> 0)
      : currentRawStamp;
  const currentOwnerSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    nowMs,
  );
  const immediateOwnerLane = getImmediateClientLaneStamp(scene, session);
  const recentlyDeliveredOwnerFreshAcquireLane = (
    immediateOwnerLane +
    Math.max(
      DESTINY_STAMP_SCENE_MAX_LEAD,
      PILOT_WARP_HISTORY_SAFE_DESTINY_LEAD +
        OWNER_MISSILE_CLIENT_LANE_LEAD,
    ) +
    PILOT_WARP_HISTORY_SAFE_DESTINY_LEAD
  ) >>> 0;
  const priorOwnerAnchorStamp =
    currentOwnerSessionStamp > 0
      ? ((currentOwnerSessionStamp - 1) >>> 0)
      : 0;

  session._space.lastSentDestinyStamp = recentlyDeliveredOwnerFreshAcquireLane;
  session._space.lastSentDestinyRawDispatchStamp = priorRawStamp;
  session._space.lastFreshAcquireLifecycleStamp = recentlyDeliveredOwnerFreshAcquireLane;
  session._space.lastMissileLifecycleStamp = recentlyDeliveredOwnerFreshAcquireLane;
  session._space.lastOwnerMissileLifecycleStamp = recentlyDeliveredOwnerFreshAcquireLane;
  session._space.lastOwnerMissileLifecycleAnchorStamp = priorOwnerAnchorStamp;
  session._space.lastOwnerMissileLifecycleRawDispatchStamp = priorRawStamp;
  session._space.lastOwnerMissileFreshAcquireStamp =
    recentlyDeliveredOwnerFreshAcquireLane;
  session._space.lastOwnerMissileFreshAcquireAnchorStamp = priorOwnerAnchorStamp;
  session._space.lastOwnerMissileFreshAcquireRawDispatchStamp = priorRawStamp;
  session._space.lastPilotCommandMovementStamp = 0;
  session._space.lastPilotCommandMovementAnchorStamp = 0;

  scene.sendDestinyUpdates(
    session,
    [
      {
        stamp: currentRawStamp >>> 0,
        payload: ["AddBalls2", []],
        freshAcquireLifecycleGroup: true,
        missileLifecycleGroup: true,
        ownerMissileLifecycleGroup: true,
      },
    ],
    false,
    {
      translateStamps: false,
    },
  );

  const ownerAddBallsUpdate = flattenDestinyUpdates(attackerSession.notifications).find(
    (entry) => entry.name === "AddBalls2",
  );
  assert.ok(
    ownerAddBallsUpdate,
    "expected the later owner fresh acquire to remain visible after a prior far-ahead owner acquire send",
  );
  assert.equal(
    ownerAddBallsUpdate.stamp >= (
      (recentlyDeliveredOwnerFreshAcquireLane + 1) >>> 0
    ),
    true,
    "expected a later owner fresh acquire to clear the recently delivered prior owner fresh-acquire lane instead of backstepping underneath it on the next raw dispatch",
  );
});

test("owner fresh acquires reuse the projected prior owner fresh-acquire lane inside the adjacent-raw volley window", () => {
  const {
    scene,
    attackerSession,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const nowMs = scene.getCurrentSimTimeMs();
  const currentRawStamp = scene.getCurrentDestinyStamp(nowMs);
  const priorRawStamp =
    currentRawStamp > 0
      ? ((currentRawStamp - 1) >>> 0)
      : currentRawStamp;
  const currentOwnerSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    nowMs,
  );
  const priorOwnerAnchorStamp =
    currentOwnerSessionStamp > 0
      ? ((currentOwnerSessionStamp - 1) >>> 0)
      : 0;
  const immediateOwnerLane = getImmediateClientLaneStamp(scene, session, nowMs);
  const priorOwnerFreshAcquireLane = (
    immediateOwnerLane +
    OWNER_MISSILE_CLIENT_LANE_LEAD
  ) >>> 0;
  const projectedPriorOwnerFreshAcquireLane = (
    priorOwnerFreshAcquireLane + 1
  ) >>> 0;

  session._space.lastSentDestinyStamp = priorOwnerFreshAcquireLane;
  session._space.lastSentDestinyRawDispatchStamp = priorRawStamp;
  session._space.lastSentDestinyOnlyStaleProjectedOwnerMissileLane = false;
  session._space.lastSentDestinyWasOwnerCritical = true;
  session._space.lastFreshAcquireLifecycleStamp = priorOwnerFreshAcquireLane;
  session._space.lastMissileLifecycleStamp = priorOwnerFreshAcquireLane;
  session._space.lastOwnerMissileLifecycleStamp = priorOwnerFreshAcquireLane;
  session._space.lastOwnerMissileLifecycleAnchorStamp = priorOwnerAnchorStamp;
  session._space.lastOwnerMissileLifecycleRawDispatchStamp = priorRawStamp;
  session._space.lastOwnerMissileFreshAcquireStamp = priorOwnerFreshAcquireLane;
  session._space.lastOwnerMissileFreshAcquireAnchorStamp = priorOwnerAnchorStamp;
  session._space.lastOwnerMissileFreshAcquireRawDispatchStamp = priorRawStamp;
  session._space.lastOwnerNonMissileCriticalStamp = 0;
  session._space.lastOwnerNonMissileCriticalRawDispatchStamp = 0;
  session._space.lastPilotCommandMovementStamp = 0;
  session._space.lastPilotCommandMovementAnchorStamp = 0;

  scene.sendDestinyUpdates(
    session,
    [
      {
        stamp: currentRawStamp >>> 0,
        payload: ["AddBalls2", []],
        freshAcquireLifecycleGroup: true,
        missileLifecycleGroup: true,
        ownerMissileLifecycleGroup: true,
      },
    ],
    false,
    {
      translateStamps: false,
      allowAdjacentRawFreshAcquireLaneReuse: true,
    },
  );

  const ownerAddBallsUpdate = flattenDestinyUpdates(attackerSession.notifications).find(
    (entry) => entry.name === "AddBalls2",
  );
  assert.ok(
    ownerAddBallsUpdate,
    "expected the owner session to receive a fresh-acquire AddBalls2 update",
  );
  assert.equal(
    ownerAddBallsUpdate.stamp >>> 0,
    projectedPriorOwnerFreshAcquireLane >>> 0,
    "expected adjacent-raw owner fresh acquires inside the same volley window to reuse the projected prior fresh-acquire lane instead of clearing it by an extra tick",
  );
});

test("owner fresh acquires ignore same-raw far-ahead teardown lanes and reuse the projected prior fresh-acquire lane instead", () => {
  const resolved = resolveOwnerMonotonicState({
    hasOwnerShip: true,
    containsMovementContractPayload: false,
    isSetStateGroup: false,
    isOwnerPilotMovementGroup: false,
    isOwnerMissileLifecycleGroup: true,
    isOwnerCriticalGroup: true,
    isFreshAcquireLifecycleGroup: true,
    isOwnerDamageStateGroup: false,
    allowAdjacentRawFreshAcquireLaneReuse: true,
    currentSessionStamp: 1774922788,
    currentImmediateSessionStamp: 1774922787,
    currentLocalStamp: 1774922789,
    currentPresentedOwnerCriticalStamp: 1774922788,
    currentRawDispatchStamp: 1774922788,
    recentEmittedOwnerCriticalMaxLead: 9,
    ownerCriticalCeilingLead: 2,
    previousLastSentDestinyStamp: 1774922795,
    previousLastSentDestinyRawDispatchStamp: 1774922788,
    previousLastSentDestinyWasOwnerCritical: true,
    previousLastSentDestinyOnlyStaleProjectedOwnerMissileLane: false,
    lastOwnerPilotCommandMovementStamp: 1774922771,
    lastOwnerPilotCommandMovementAnchorStamp: 1774922771,
    lastOwnerNonMissileCriticalStamp: 1774922771,
    lastOwnerMissileLifecycleStamp: 1774922795,
    lastOwnerMissileLifecycleAnchorStamp: 1774922788,
    lastOwnerMissileLifecycleRawDispatchStamp: 1774922788,
    lastOwnerMissileFreshAcquireStamp: 1774922793,
    lastOwnerMissileFreshAcquireAnchorStamp: 1774922787,
    lastOwnerMissileFreshAcquireRawDispatchStamp: 1774922787,
  });

  assert.equal(
    resolved.projectedFreshAcquireReusableLane,
    1774922794,
    "expected the adjacent-raw projected prior fresh-acquire lane to remain available",
  );
  assert.equal(
    resolved.recentOwnerCriticalMonotonicFloor,
    1774922794,
    "expected a same-raw far-ahead teardown lane not to force the next owner fresh acquire above the projected prior fresh-acquire lane",
  );
  assert.equal(
    resolved.ownerCriticalCeilingStamp,
    1774922794,
    "expected the owner fresh-acquire ceiling to collapse back onto the projected reusable lane instead of following the far-ahead teardown lane",
  );
});

test("owner fresh acquires stay above a recently sent owner lane from two raw dispatches earlier", () => {
  const {
    scene,
    attackerSession,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const nowMs = scene.getCurrentSimTimeMs();
  const currentRawStamp = scene.getCurrentDestinyStamp(nowMs);
  const priorRawStamp =
    currentRawStamp > 1
      ? ((currentRawStamp - 2) >>> 0)
      : currentRawStamp;
  const currentOwnerSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    nowMs,
  );
  const immediateOwnerLane = getImmediateClientLaneStamp(scene, session);
  const recentlySentOwnerLane = (
    immediateOwnerLane +
    Math.max(
      DESTINY_STAMP_SCENE_MAX_LEAD,
      PILOT_WARP_HISTORY_SAFE_DESTINY_LEAD +
        OWNER_MISSILE_CLIENT_LANE_LEAD,
    ) +
    Math.max(PILOT_WARP_HISTORY_SAFE_DESTINY_LEAD - 1, 0)
  ) >>> 0;
  const priorOwnerAnchorStamp =
    currentOwnerSessionStamp > 1
      ? ((currentOwnerSessionStamp - 2) >>> 0)
      : 0;

  session._space.lastSentDestinyStamp = recentlySentOwnerLane;
  session._space.lastSentDestinyRawDispatchStamp = priorRawStamp;
  session._space.lastOwnerNonMissileCriticalStamp = recentlySentOwnerLane;
  session._space.lastOwnerNonMissileCriticalRawDispatchStamp = priorRawStamp;
  session._space.lastOwnerMissileLifecycleStamp = (
    immediateOwnerLane +
    OWNER_MISSILE_CLIENT_LANE_LEAD
  ) >>> 0;
  session._space.lastOwnerMissileLifecycleAnchorStamp = priorOwnerAnchorStamp;
  session._space.lastOwnerMissileLifecycleRawDispatchStamp = priorRawStamp;
  session._space.lastOwnerMissileFreshAcquireStamp = (
    immediateOwnerLane +
    OWNER_MISSILE_CLIENT_LANE_LEAD
  ) >>> 0;
  session._space.lastOwnerMissileFreshAcquireAnchorStamp = priorOwnerAnchorStamp;
  session._space.lastOwnerMissileFreshAcquireRawDispatchStamp = priorRawStamp;
  session._space.lastPilotCommandMovementStamp = 0;
  session._space.lastPilotCommandMovementAnchorStamp = 0;

  scene.sendDestinyUpdates(
    session,
    [
      {
        stamp: currentRawStamp >>> 0,
        payload: ["AddBalls2", []],
        freshAcquireLifecycleGroup: true,
        missileLifecycleGroup: true,
        ownerMissileLifecycleGroup: true,
      },
    ],
    false,
    {
      translateStamps: false,
    },
  );

  const ownerAddBallsUpdate = flattenDestinyUpdates(attackerSession.notifications).find(
    (entry) => entry.name === "AddBalls2",
  );
  assert.ok(
    ownerAddBallsUpdate,
    "expected the owner session to receive a fresh-acquire AddBalls2 update",
  );
  assert.equal(
    ownerAddBallsUpdate.stamp >= ((recentlySentOwnerLane + 1) >>> 0),
    true,
    "expected a fresh owner missile acquire not to backstep under a recently sent far-ahead owner lane from two raw dispatches earlier",
  );
});

test("owner fresh acquires ignore a stale owner non-missile lane from five raw dispatches earlier", () => {
  const {
    scene,
    attackerSession,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const nowMs = scene.getCurrentSimTimeMs();
  const currentRawStamp = scene.getCurrentDestinyStamp(nowMs);
  const staleRawStamp =
    currentRawStamp > 5
      ? ((currentRawStamp - 5) >>> 0)
      : currentRawStamp;
  const immediateOwnerLane = getImmediateClientLaneStamp(scene, session, nowMs);
  const staleOwnerCriticalLane = (
    immediateOwnerLane +
    OWNER_MISSILE_CLIENT_LANE_LEAD +
    Math.max(PILOT_WARP_HISTORY_SAFE_DESTINY_LEAD - 1, 0)
  ) >>> 0;

  session._space.lastSentDestinyStamp = staleOwnerCriticalLane;
  session._space.lastSentDestinyRawDispatchStamp = staleRawStamp;
  session._space.lastFreshAcquireLifecycleStamp = 0;
  session._space.lastMissileLifecycleStamp = 0;
  session._space.lastOwnerNonMissileCriticalStamp = staleOwnerCriticalLane;
  session._space.lastOwnerNonMissileCriticalRawDispatchStamp = staleRawStamp;
  session._space.lastOwnerMissileLifecycleStamp = 0;
  session._space.lastOwnerMissileLifecycleAnchorStamp = 0;
  session._space.lastOwnerMissileLifecycleRawDispatchStamp = 0;
  session._space.lastOwnerMissileFreshAcquireStamp = 0;
  session._space.lastOwnerMissileFreshAcquireAnchorStamp = 0;
  session._space.lastOwnerMissileFreshAcquireRawDispatchStamp = 0;
  session._space.lastPilotCommandMovementStamp = 0;
  session._space.lastPilotCommandMovementAnchorStamp = 0;

  scene.sendDestinyUpdates(
    session,
    [
      {
        stamp: currentRawStamp >>> 0,
        payload: ["AddBalls2", []],
        freshAcquireLifecycleGroup: true,
        missileLifecycleGroup: true,
        ownerMissileLifecycleGroup: true,
      },
    ],
    false,
    {
      translateStamps: false,
    },
  );

  const ownerAddBallsUpdate = flattenDestinyUpdates(attackerSession.notifications).find(
    (entry) => entry.name === "AddBalls2",
  );
  assert.ok(
    ownerAddBallsUpdate,
    "expected the owner session to receive a fresh-acquire AddBalls2 update",
  );
  assert.equal(
    ownerAddBallsUpdate.stamp,
    ((immediateOwnerLane + OWNER_MISSILE_CLIENT_LANE_LEAD) >>> 0),
    "expected a stale owner non-missile lane from five raw dispatches earlier not to ratchet the next owner fresh acquire above the immediate client missile lane",
  );
  assert.equal(
    ownerAddBallsUpdate.stamp < ((staleOwnerCriticalLane + 1) >>> 0),
    true,
    "expected the stale owner non-missile lane to be ignored rather than forcing the next owner fresh acquire above it",
  );
});

test("owner fresh acquires clear a recently sent overall owner combat lane from two raw dispatches earlier", () => {
  const {
    scene,
    attackerSession,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const nowMs = scene.getCurrentSimTimeMs();
  const currentRawStamp = scene.getCurrentDestinyStamp(nowMs);
  const priorRawStamp =
    currentRawStamp > 1
      ? ((currentRawStamp - 2) >>> 0)
      : currentRawStamp;
  const immediateOwnerLane = getImmediateClientLaneStamp(scene, session, nowMs);
  const recentlySentOverallOwnerLane = (
    immediateOwnerLane +
    Math.max(
      DESTINY_STAMP_SCENE_MAX_LEAD,
      PILOT_WARP_HISTORY_SAFE_DESTINY_LEAD +
        OWNER_MISSILE_CLIENT_LANE_LEAD,
    ) +
    Math.max(PILOT_WARP_HISTORY_SAFE_DESTINY_LEAD - 1, 0)
  ) >>> 0;

  session._space.lastSentDestinyStamp = recentlySentOverallOwnerLane;
  session._space.lastSentDestinyRawDispatchStamp = priorRawStamp;
  session._space.lastFreshAcquireLifecycleStamp = 0;
  session._space.lastMissileLifecycleStamp = 0;
  session._space.lastOwnerNonMissileCriticalStamp = 0;
  session._space.lastOwnerNonMissileCriticalRawDispatchStamp = 0;
  session._space.lastOwnerMissileLifecycleStamp = 0;
  session._space.lastOwnerMissileLifecycleAnchorStamp = 0;
  session._space.lastOwnerMissileLifecycleRawDispatchStamp = 0;
  session._space.lastOwnerMissileFreshAcquireStamp = 0;
  session._space.lastOwnerMissileFreshAcquireAnchorStamp = 0;
  session._space.lastOwnerMissileFreshAcquireRawDispatchStamp = 0;
  session._space.lastPilotCommandMovementStamp = 0;
  session._space.lastPilotCommandMovementAnchorStamp = 0;

  scene.sendDestinyUpdates(
    session,
    [
      {
        stamp: currentRawStamp >>> 0,
        payload: ["AddBalls2", []],
        freshAcquireLifecycleGroup: true,
        missileLifecycleGroup: true,
        ownerMissileLifecycleGroup: true,
      },
    ],
    false,
    {
      translateStamps: false,
    },
  );

  const ownerAddBallsUpdate = flattenDestinyUpdates(attackerSession.notifications).find(
    (entry) => entry.name === "AddBalls2",
  );
  assert.ok(
    ownerAddBallsUpdate,
    "expected the owner session to receive a fresh-acquire AddBalls2 update",
  );
  assert.equal(
    ownerAddBallsUpdate.stamp >= ((recentlySentOverallOwnerLane + 1) >>> 0),
    true,
    "expected a fresh owner missile acquire on a newer raw dispatch not to backstep under a recently sent overall owner combat lane just because the older non-missile owner tracker is lower",
  );
});

test("owner fresh acquires clear a recently sent overall owner combat lane from the immediately prior raw dispatch", () => {
  const {
    scene,
    attackerSession,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const nowMs = scene.getCurrentSimTimeMs();
  const currentRawStamp = scene.getCurrentDestinyStamp(nowMs);
  const priorRawStamp =
    currentRawStamp > 0
      ? ((currentRawStamp - 1) >>> 0)
      : currentRawStamp;
  const currentOwnerSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    nowMs,
  );
  const immediateOwnerLane = getImmediateClientLaneStamp(scene, session, nowMs);
  const recentlySentOverallOwnerLane = (
    immediateOwnerLane +
    Math.max(
      DESTINY_STAMP_SCENE_MAX_LEAD,
      PILOT_WARP_HISTORY_SAFE_DESTINY_LEAD +
        OWNER_MISSILE_CLIENT_LANE_LEAD,
    ) +
    PILOT_WARP_HISTORY_SAFE_DESTINY_LEAD +
    1
  ) >>> 0;
  const priorOwnerAnchorStamp =
    currentOwnerSessionStamp > 0
      ? ((currentOwnerSessionStamp - 1) >>> 0)
      : 0;

  session._space.lastSentDestinyStamp = recentlySentOverallOwnerLane;
  session._space.lastSentDestinyRawDispatchStamp = priorRawStamp;
  session._space.lastFreshAcquireLifecycleStamp = recentlySentOverallOwnerLane;
  session._space.lastMissileLifecycleStamp = recentlySentOverallOwnerLane;
  session._space.lastOwnerNonMissileCriticalStamp = recentlySentOverallOwnerLane;
  session._space.lastOwnerNonMissileCriticalRawDispatchStamp = priorRawStamp;
  session._space.lastOwnerMissileLifecycleStamp = recentlySentOverallOwnerLane;
  session._space.lastOwnerMissileLifecycleAnchorStamp = priorOwnerAnchorStamp;
  session._space.lastOwnerMissileLifecycleRawDispatchStamp = priorRawStamp;
  session._space.lastOwnerMissileFreshAcquireStamp =
    recentlySentOverallOwnerLane;
  session._space.lastOwnerMissileFreshAcquireAnchorStamp =
    priorOwnerAnchorStamp;
  session._space.lastOwnerMissileFreshAcquireRawDispatchStamp = priorRawStamp;
  session._space.lastPilotCommandMovementStamp = recentlySentOverallOwnerLane;
  session._space.lastPilotCommandMovementAnchorStamp = priorOwnerAnchorStamp;

  scene.sendDestinyUpdates(
    session,
    [
      {
        stamp: currentRawStamp >>> 0,
        payload: ["AddBalls2", []],
        freshAcquireLifecycleGroup: true,
        missileLifecycleGroup: true,
        ownerMissileLifecycleGroup: true,
      },
    ],
    false,
    {
      translateStamps: false,
    },
  );

  const ownerAddBallsUpdate = flattenDestinyUpdates(
    attackerSession.notifications,
  ).find((entry) => entry.name === "AddBalls2");
  assert.ok(
    ownerAddBallsUpdate,
    "expected the owner session to receive a fresh-acquire AddBalls2 update",
  );
  assert.equal(
    ownerAddBallsUpdate.stamp >= ((recentlySentOverallOwnerLane + 1) >>> 0),
    true,
    "expected a fresh owner missile acquire not to backstep under the immediately prior overall owner combat lane even when that lane sits just outside the normal trust window",
  );
  assert.equal(
    Number(session._space.lastFreshAcquireLifecycleStamp) >=
      Number(ownerAddBallsUpdate.stamp),
    true,
    "expected recently sent owner fresh-acquire tracking to stay monotonic after retiming the immediate-prior-raw send",
  );
  assert.equal(
    Number(session._space.lastOwnerMissileLifecycleStamp) >=
      Number(ownerAddBallsUpdate.stamp),
    true,
    "expected recently sent owner missile lifecycle tracking to stay monotonic after retiming the immediate-prior-raw send",
  );
});

test("owner missile lifecycle updates stay monotonic with a recently sent owner lane from two raw dispatches earlier", () => {
  const {
    scene,
    attackerSession,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const nowMs = scene.getCurrentSimTimeMs();
  const currentRawStamp = scene.getCurrentDestinyStamp(nowMs);
  const priorRawStamp =
    currentRawStamp > 1
      ? ((currentRawStamp - 2) >>> 0)
      : currentRawStamp;
  const immediateOwnerLane = getImmediateClientLaneStamp(scene, session);
  const recentlySentOwnerLane = (
    immediateOwnerLane +
    Math.max(
      DESTINY_STAMP_SCENE_MAX_LEAD,
      PILOT_WARP_HISTORY_SAFE_DESTINY_LEAD +
        OWNER_MISSILE_CLIENT_LANE_LEAD,
    ) +
    Math.max(PILOT_WARP_HISTORY_SAFE_DESTINY_LEAD - 1, 0)
  ) >>> 0;

  session._space.lastSentDestinyStamp = recentlySentOwnerLane;
  session._space.lastSentDestinyRawDispatchStamp = priorRawStamp;
  session._space.lastOwnerNonMissileCriticalStamp = recentlySentOwnerLane;
  session._space.lastOwnerNonMissileCriticalRawDispatchStamp = priorRawStamp;
  session._space.lastOwnerMissileLifecycleStamp = (
    immediateOwnerLane +
    OWNER_MISSILE_CLIENT_LANE_LEAD
  ) >>> 0;
  session._space.lastOwnerMissileLifecycleAnchorStamp = 0;
  session._space.lastOwnerMissileLifecycleRawDispatchStamp = priorRawStamp;
  session._space.lastOwnerMissileFreshAcquireStamp = 0;
  session._space.lastOwnerMissileFreshAcquireAnchorStamp = 0;
  session._space.lastOwnerMissileFreshAcquireRawDispatchStamp = 0;
  session._space.lastPilotCommandMovementStamp = 0;
  session._space.lastPilotCommandMovementAnchorStamp = 0;

  scene.sendDestinyUpdates(
    session,
    [
      {
        stamp: currentRawStamp >>> 0,
        payload: ["TerminalPlayDestructionEffect", [980000000001, 3]],
        missileLifecycleGroup: true,
        ownerMissileLifecycleGroup: true,
      },
      {
        stamp: currentRawStamp >>> 0,
        payload: ["RemoveBalls", [[980000000001]]],
        missileLifecycleGroup: true,
        ownerMissileLifecycleGroup: true,
      },
    ],
    false,
    {
      translateStamps: false,
    },
  );

  const lifecycleUpdate = flattenDestinyUpdates(attackerSession.notifications).find(
    (entry) => (
      entry.name === "TerminalPlayDestructionEffect" ||
      entry.name === "RemoveBalls"
    ),
  );
  assert.ok(
    lifecycleUpdate,
    "expected the owner session to receive an owner missile lifecycle update",
  );
  assert.equal(
    lifecycleUpdate.stamp >= recentlySentOwnerLane,
    true,
    "expected owner missile lifecycle sends not to backstep under a recently sent far-ahead owner lane from two raw dispatches earlier",
  );
});

test("owner missile lifecycle updates stay monotonic with a recently sent owner lane from the immediately prior raw dispatch", () => {
  const {
    scene,
    attackerSession,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const nowMs = scene.getCurrentSimTimeMs();
  const currentRawStamp = scene.getCurrentDestinyStamp(nowMs);
  const priorRawStamp =
    currentRawStamp > 0
      ? ((currentRawStamp - 1) >>> 0)
      : currentRawStamp;
  const currentOwnerSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    nowMs,
  );
  const immediateOwnerLane = getImmediateClientLaneStamp(scene, session, nowMs);
  const recentlySentOverallOwnerLane = (
    immediateOwnerLane +
    Math.max(
      DESTINY_STAMP_SCENE_MAX_LEAD,
      PILOT_WARP_HISTORY_SAFE_DESTINY_LEAD +
        OWNER_MISSILE_CLIENT_LANE_LEAD,
    ) +
    PILOT_WARP_HISTORY_SAFE_DESTINY_LEAD +
    1
  ) >>> 0;
  const priorOwnerAnchorStamp =
    currentOwnerSessionStamp > 0
      ? ((currentOwnerSessionStamp - 1) >>> 0)
      : 0;

  session._space.lastSentDestinyStamp = recentlySentOverallOwnerLane;
  session._space.lastSentDestinyRawDispatchStamp = priorRawStamp;
  session._space.lastOwnerNonMissileCriticalStamp = recentlySentOverallOwnerLane;
  session._space.lastOwnerNonMissileCriticalRawDispatchStamp = priorRawStamp;
  session._space.lastOwnerMissileLifecycleStamp = (
    immediateOwnerLane +
    OWNER_MISSILE_CLIENT_LANE_LEAD
  ) >>> 0;
  session._space.lastOwnerMissileLifecycleAnchorStamp = priorOwnerAnchorStamp;
  session._space.lastOwnerMissileLifecycleRawDispatchStamp = priorRawStamp;
  session._space.lastOwnerMissileFreshAcquireStamp = (
    immediateOwnerLane +
    OWNER_MISSILE_CLIENT_LANE_LEAD
  ) >>> 0;
  session._space.lastOwnerMissileFreshAcquireAnchorStamp =
    priorOwnerAnchorStamp;
  session._space.lastOwnerMissileFreshAcquireRawDispatchStamp = priorRawStamp;
  session._space.lastPilotCommandMovementStamp = 0;
  session._space.lastPilotCommandMovementAnchorStamp = 0;

  scene.sendDestinyUpdates(
    session,
    [
      {
        stamp: currentRawStamp >>> 0,
        payload: ["TerminalPlayDestructionEffect", [980000000001, 3]],
        missileLifecycleGroup: true,
        ownerMissileLifecycleGroup: true,
      },
      {
        stamp: currentRawStamp >>> 0,
        payload: ["RemoveBalls", [[980000000001]]],
        missileLifecycleGroup: true,
        ownerMissileLifecycleGroup: true,
      },
    ],
    false,
    {
      translateStamps: false,
    },
  );

  const lifecycleUpdate = flattenDestinyUpdates(
    attackerSession.notifications,
  ).find(
    (entry) =>
      entry.name === "TerminalPlayDestructionEffect" ||
      entry.name === "RemoveBalls",
  );
  assert.ok(
    lifecycleUpdate,
    "expected the owner session to receive an owner missile lifecycle update",
  );
  assert.equal(
    lifecycleUpdate.stamp >= recentlySentOverallOwnerLane,
    true,
    "expected owner missile lifecycle sends not to backstep under the immediately prior overall owner combat lane even when that lane sits just outside the normal trust window",
  );
});

test("owner missile lifecycle stays monotonic with an already-emitted same-raw owner lane beyond the buffered ceiling", () => {
  const {
    scene,
    attackerSession,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const nowMs = scene.getCurrentSimTimeMs();
  const currentRawStamp = scene.getCurrentDestinyStamp(nowMs);
  const currentOwnerSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    nowMs,
  );
  const immediateOwnerLane = getImmediateClientLaneStamp(scene, session, nowMs);
  const sameRawFarAheadOwnerLane = (
    immediateOwnerLane +
    RECENT_EMITTED_OWNER_CRITICAL_MAX_LEAD +
    3
  ) >>> 0;

  session._space.lastSentDestinyStamp = sameRawFarAheadOwnerLane;
  session._space.lastSentDestinyRawDispatchStamp = currentRawStamp;
  session._space.lastSentDestinyOnlyStaleProjectedOwnerMissileLane = false;
  session._space.lastSentDestinyWasOwnerCritical = true;
  session._space.lastOwnerMissileLifecycleStamp = sameRawFarAheadOwnerLane;
  session._space.lastOwnerMissileLifecycleAnchorStamp = currentOwnerSessionStamp;
  session._space.lastOwnerMissileLifecycleRawDispatchStamp = currentRawStamp;
  session._space.lastOwnerMissileFreshAcquireStamp = sameRawFarAheadOwnerLane;
  session._space.lastOwnerMissileFreshAcquireAnchorStamp =
    currentOwnerSessionStamp;
  session._space.lastOwnerMissileFreshAcquireRawDispatchStamp = currentRawStamp;
  session._space.lastOwnerNonMissileCriticalStamp = sameRawFarAheadOwnerLane;
  session._space.lastOwnerNonMissileCriticalRawDispatchStamp = currentRawStamp;
  session._space.lastPilotCommandMovementStamp = 0;
  session._space.lastPilotCommandMovementAnchorStamp = 0;
  session._space.lastPilotCommandMovementRawDispatchStamp = 0;

  scene.sendDestinyUpdates(
    session,
    [
      {
        stamp: currentRawStamp >>> 0,
        payload: ["TerminalPlayDestructionEffect", [980000000001, 3]],
        missileLifecycleGroup: true,
        ownerMissileLifecycleGroup: true,
      },
      {
        stamp: currentRawStamp >>> 0,
        payload: ["RemoveBalls", [[980000000001]]],
        missileLifecycleGroup: true,
        ownerMissileLifecycleGroup: true,
      },
    ],
    false,
    {
      translateStamps: false,
    },
  );

  const lifecycleUpdates = flattenDestinyUpdates(attackerSession.notifications).filter(
    (entry) =>
      entry.name === "TerminalPlayDestructionEffect" ||
      entry.name === "RemoveBalls",
  );

  assert.ok(
    lifecycleUpdates.length > 0,
    "expected the owner session to receive owner missile lifecycle updates in the same-raw repro",
  );
  assert.equal(
    lifecycleUpdates.every((entry) => entry.stamp >= sameRawFarAheadOwnerLane),
    true,
    "expected same-raw owner missile lifecycle sends not to backstep under the already-emitted far-ahead owner lane even when it sits above the buffered ceiling",
  );
});

test("same-tick missile impacts do not backstep damage-state updates behind visible history", () => {
  const {
    scene,
    attackerSession,
    targetSession,
    target,
    moduleItems,
  } = buildMultiLauncherScenario(2, 8_000);
  const session = attackerSession.session;

  for (const moduleItem of moduleItems) {
    const activationResult = scene.activateGenericModule(
      session,
      moduleItem,
      null,
      {
        targetID: target.itemID,
      },
    );
    assert.equal(activationResult.success, true);
  }

  targetSession.notifications.length = 0;
  const preImpactStamp = scene.getCurrentDestinyStamp();
  advanceScene(scene, 4_000);

  const targetDamageUpdates = flattenDestinyUpdates(targetSession.notifications).filter(
    (entry) =>
      entry.name === "OnDamageStateChange" &&
      Number(entry.args[0]) === target.itemID,
  );
  assert.equal(
    targetDamageUpdates.length >= 1,
    true,
    "expected missile impacts to publish live damage-state updates",
  );
  assert.equal(
    targetDamageUpdates.every((entry) => entry.stamp >= preImpactStamp),
    true,
    "expected missile impact damage-state updates not to backstep behind the visible history",
  );
});

test("same-tick missile impacts remove missiles for owner and observers", () => {
  const {
    scene,
    attackerSession,
    targetSession,
    target,
    moduleItems,
  } = buildMultiLauncherScenario(2, 8_000);
  const session = attackerSession.session;

  for (const moduleItem of moduleItems) {
    const activationResult = scene.activateGenericModule(
      session,
      moduleItem,
      null,
      {
        targetID: target.itemID,
      },
    );
    assert.equal(activationResult.success, true);
  }

  attackerSession.notifications.length = 0;
  targetSession.notifications.length = 0;
  const preImpactStamp = scene.getCurrentDestinyStamp();
  advanceScene(scene, 4_000);

  const ownerUpdates = flattenDestinyUpdates(attackerSession.notifications);
  const ownerRemoveUpdates = ownerUpdates.filter((entry) => entry.name === "RemoveBalls");
  assert.equal(
    ownerRemoveUpdates.length >= 1,
    true,
    "expected same-tick missile impacts to publish launcher-owner missile removals",
  );
  const ownerRemovedIDs = ownerRemoveUpdates.flatMap((entry) => (
    Array.isArray(entry.args[0] && entry.args[0].items)
      ? entry.args[0].items
      : []
  ));
  assert.equal(
    ownerRemovedIDs.length,
    2,
    "expected the owner removal payloads to cover both impacted missiles",
  );
  const ownerDestructionUpdates = ownerUpdates.filter(
    (entry) => entry.name === "TerminalPlayDestructionEffect",
  );
  assert.equal(
    ownerDestructionUpdates.length,
    2,
    "expected both impacted missiles to keep individual owner destruction effects",
  );

  const updates = flattenDestinyUpdates(targetSession.notifications);
  const removeUpdates = updates.filter((entry) => entry.name === "RemoveBalls");
  assert.equal(
    removeUpdates.length >= 1,
    true,
    "expected same-tick missile impacts to publish observer missile removals",
  );
  const removedIDs = removeUpdates.flatMap((entry) => (
    Array.isArray(entry.args[0] && entry.args[0].items)
      ? entry.args[0].items
      : []
  ));
  assert.equal(
    removedIDs.length,
    2,
    "expected the removal payloads to cover both impacted missiles",
  );

  const destructionUpdates = updates.filter(
    (entry) => entry.name === "TerminalPlayDestructionEffect",
  );
  assert.equal(
    destructionUpdates.length,
    2,
    "expected both impacted missiles to keep individual observer destruction effects",
  );
  assert.equal(
    destructionUpdates.every((entry) => entry.stamp >= preImpactStamp),
    true,
    "expected missile destruction effects not to backstep behind the visible history",
  );
  assert.equal(
    new Set(removeUpdates.map((entry) => entry.stamp)).size,
    1,
    "expected same-tick missile removals to stay on one solar-system sim stamp",
  );
  assert.equal(
    new Set(destructionUpdates.map((entry) => entry.stamp)).size,
    1,
    "expected same-tick missile destruction effects to stay on one solar-system sim stamp",
  );
});

test("missile travel and impact stay on the scene sim clock under TiDi", () => {
  const {
    scene,
    attackerSession,
    target,
    moduleItem,
  } = buildLauncherScenario(8_000);
  scene.setTimeDilation(0.5, { syncSessions: false });

  const activationResult = scene.activateGenericModule(
    attackerSession.session,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);

  advanceScene(scene, 3_000);
  assert.equal(target.conditionState.shieldCharge, 1, "expected missile to still be in flight under TiDi");
  assert.equal(getMissileEntities(scene).length, 1);

  advanceScene(scene, 3_000);
  assert.ok(
    target.conditionState.shieldCharge < 1,
    "expected missile impact once enough sim time elapses",
  );
  assert.equal(getMissileEntities(scene).length, 0);
});

test("missile launchers do not resend owner active ship-effect starts every cycle", () => {
  const {
    scene,
    attacker,
    attackerSession,
    target,
    moduleItem,
    chargeItem,
  } = buildLauncherScenario(8_000);
  chargeItem.quantity = 6;
  chargeItem.stacksize = 6;

  const activationResult = scene.activateGenericModule(
    attackerSession.session,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);

  const effectState = attacker.activeModuleEffects.get(moduleItem.itemID);
  assert.ok(effectState, "expected the launcher effect to stay active after activation");

  const activationStarts = getShipEffectNotifications(
    attackerSession.notifications,
    moduleItem.itemID,
  ).filter((notification) => (
    Number(notification.payload[3]) === 1 &&
    Number(notification.payload[4]) === 1
  ));
  assert.equal(
    activationStarts.length,
    1,
    "expected exactly one owner OnGodmaShipEffect start packet on missile activation",
  );

  attackerSession.notifications.length = 0;
  advanceScene(
    scene,
    Number(effectState.durationMs) + spaceRuntime._testing.RUNTIME_TICK_INTERVAL_MS,
  );

  const repeatedCycleLaunches = flattenDestinyUpdates(attackerSession.notifications)
    .filter((entry) => entry.name === "AddBalls2");
  assert.equal(
    repeatedCycleLaunches.length > 0,
    true,
    "expected the next missile cycle to still launch a real missile for the owner",
  );

  const repeatedStarts = getShipEffectNotifications(
    attackerSession.notifications,
    moduleItem.itemID,
  ).filter((notification) => (
    Number(notification.payload[3]) === 1 &&
    Number(notification.payload[4]) === 1
  ));
  assert.equal(
    repeatedStarts.length,
    0,
    "expected later missile cycles to rely on the original repeat timing instead of resending owner active=1 ship-effect starts",
  );
});

test("missile launchers emit repeating deployment special FX to owners and observers", () => {
  const {
    scene,
    attacker,
    attackerSession,
    target,
    targetSession,
    moduleItem,
    chargeItem,
  } = buildLauncherScenario(8_000);

  attackerSession.notifications.length = 0;
  targetSession.notifications.length = 0;

  const activationResult = scene.activateGenericModule(
    attackerSession.session,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);

  const effectState = scene.getActiveModuleEffect(attacker.itemID, moduleItem.itemID);
  assert.ok(effectState, "expected the launcher effect to stay active after activation");
  assert.equal(
    effectState.guid,
    "effects.MissileDeployment",
    "expected missile launcher activation to resolve the real launcher special FX guid instead of the blank dogma useMissiles guid",
  );

  const ownerStartFx = getSpecialFxEvents(
    attackerSession.notifications,
    "effects.MissileDeployment",
  );
  const observerStartFx = getSpecialFxEvents(
    targetSession.notifications,
    "effects.MissileDeployment",
  );
  assert.equal(ownerStartFx.length, 1);
  assert.equal(observerStartFx.length, 1);

  for (const event of [...ownerStartFx, ...observerStartFx]) {
    assert.equal(Number(event.args[1]), Number(moduleItem.itemID));
    assert.equal(Number(event.args[2]), Number(moduleItem.typeID));
    assert.equal(Number(event.args[3]), Number(target.itemID));
    assert.equal(Number(event.args[4]), Number(chargeItem.typeID));
    assert.equal(Number(event.args[6]), 1);
    assert.equal(Number(event.args[7]), 1);
    assert.equal(Number(event.args[8]), 1);
    assert.equal(Number(event.args[9]), Number(effectState.durationMs));
    assert.ok(
      Number(event.args[10]) > 1,
      "expected missile launcher special FX to keep repeating locally after the initial launch",
    );
  }

  attackerSession.notifications.length = 0;
  targetSession.notifications.length = 0;

  const deactivateResult = scene.deactivateGenericModule(
    attackerSession.session,
    moduleItem.itemID,
  );
  assert.equal(deactivateResult.success, true);
  const stopAtMs = Number(
    (deactivateResult.data && deactivateResult.data.deactivateAtMs) ||
    (deactivateResult.data && deactivateResult.data.stoppedAtMs) ||
    0,
  );
  if (stopAtMs > scene.getCurrentSimTimeMs()) {
    advanceSceneUntilSimTime(scene, stopAtMs, 100);
  }

  const ownerStopFx = getSpecialFxEvents(
    attackerSession.notifications,
    "effects.MissileDeployment",
  ).filter((event) => Number(event.args[7]) === 0);
  const observerStopFx = getSpecialFxEvents(
    targetSession.notifications,
    "effects.MissileDeployment",
  ).filter((event) => Number(event.args[7]) === 0);
  assert.equal(ownerStopFx.length, 1);
  assert.equal(observerStopFx.length, 1);
});

test("same-wave missile launches from different launchers keep distinct AddBalls2 positions", () => {
  const {
    scene,
    attackerSession,
    target,
    moduleItems,
  } = buildMultiLauncherScenario(4, 25_000);

  attackerSession.notifications.length = 0;
  for (const moduleItem of moduleItems) {
    const activationResult = scene.activateGenericModule(
      attackerSession.session,
      moduleItem,
      null,
      {
        targetID: target.itemID,
      },
    );
    assert.equal(activationResult.success, true);
  }

  advanceScene(scene, spaceRuntime._testing.RUNTIME_TICK_INTERVAL_MS);

  const ownerAddBallsUpdate = flattenDestinyUpdates(attackerSession.notifications)
    .find((entry) => entry.name === "AddBalls2");
  assert.ok(ownerAddBallsUpdate, "expected the owner to receive the queued same-wave missile AddBalls2 acquire");

  const missileIDs = [...new Set(getAddBalls2EntityIDs(ownerAddBallsUpdate))];
  assert.equal(missileIDs.length, moduleItems.length);
  const uniquePositions = new Set(
    missileIDs.map((entityID) => {
      const position = getAddBalls2EntityPosition(ownerAddBallsUpdate, entityID);
      assert.ok(position, `expected AddBalls2 state for missile ${entityID} to include an authored position`);
      return `${position.x.toFixed(6)}:${position.y.toFixed(6)}:${position.z.toFixed(6)}`;
    }),
  );
  assert.equal(
    uniquePositions.size,
    moduleItems.length,
    "expected same-wave launcher volleys to preserve distinct per-launcher spawn state instead of collapsing every missile to the same authored launch position",
  );
});

test("large-hull launcher radius compensation preserves stated missile range", () => {
  const {
    scene,
    attacker,
    attackerSession,
    target,
    moduleItem,
  } = buildLauncherScenario(33_900);
  attacker.radius = 8_000;

  const activationResult = scene.activateGenericModule(
    attackerSession.session,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);

  advanceScene(scene, 7_000);
  assert.equal(
    getMissileEntities(scene).length,
    1,
    "expected the missile to still be in flight near the raw flight-time edge",
  );
  assert.equal(target.conditionState.shieldCharge, 1, "expected no early edge-range damage");

  advanceScene(scene, 2_000);
  assert.ok(
    target.conditionState.shieldCharge < 1,
    "expected the missile to land at the large-hull edge range",
  );
  assert.equal(getMissileEntities(scene).length, 0);
});

test("moving targets do not get hit on the stale launch-time missile ETA", () => {
  const {
    scene,
    attackerSession,
    target,
    moduleItem,
  } = buildLauncherScenario(8_000);
  target.maxVelocity = 2_000;
  target.agilitySeconds = 0.05;
  target.direction = { x: 1, y: 0, z: 0 };
  target.targetPoint = { x: 1_000_000, y: 0, z: 0 };
  target.mode = "GOTO";
  target.speedFraction = 1;
  target.velocity = { x: 2_000, y: 0, z: 0 };

  const activationResult = scene.activateGenericModule(
    attackerSession.session,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);

  advanceScene(scene, 2_000);
  assert.equal(
    target.conditionState.shieldCharge,
    1,
    "expected the moving target to stay unharmed past the stale launch-time ETA",
  );
  assert.equal(
    getMissileEntities(scene).length,
    1,
    "expected the missile to keep chasing the moving target instead of snap-impacting early",
  );

  let landedAfterClosingGap = false;
  for (let index = 0; index < 40; index += 1) {
    advanceScene(scene, 100);
    if (
      target.conditionState.shieldCharge < 1 &&
      getMissileEntities(scene).length === 0
    ) {
      landedAfterClosingGap = true;
      break;
    }
  }
  assert.ok(
    landedAfterClosingGap,
    "expected the missile to land once it physically closes the moving-target gap",
  );
});

test("missiles turn onto a redirected target without the ship-style turn cap", () => {
  const {
    scene,
    attackerSession,
    target,
    moduleItem,
  } = buildLauncherScenario(8_000);

  const activationResult = scene.activateGenericModule(
    attackerSession.session,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);

  const missile = getMissileEntities(scene)[0];
  assert.ok(missile, "expected a live missile entity");

  missile.position = { x: 0, y: 0, z: 0 };
  missile.velocity = { x: missile.maxVelocity, y: 0, z: 0 };
  missile.direction = { x: 1, y: 0, z: 0 };
  missile.targetPoint = { x: 0, y: 10_000, z: 0 };
  missile.mode = "FOLLOW";
  missile.expiresAtMs = scene.getCurrentSimTimeMs() + 5_000;
  target.position = { x: 0, y: 10_000, z: 0 };
  target.velocity = { x: 0, y: 0, z: 0 };
  target.targetPoint = { ...target.position };
  target.mode = "STOP";

  advanceScene(scene, 100);

  assert.ok(
    Math.abs(missile.velocity.x) <= (missile.maxVelocity * 0.05),
    "expected the missile x velocity to collapse once the target redirects off-axis",
  );
  assert.ok(
    missile.velocity.y >= (missile.maxVelocity * 0.95),
    "expected the missile y velocity to align onto the redirected target within one runtime step",
  );
  assert.ok(
    Math.abs(missile.position.x) <= 1,
    "expected missile travel to stay on the redirected heading instead of drifting on the old course",
  );
});

test("missiles do not impact a full tick early just because their authored ball radius is large", () => {
  const {
    scene,
    attackerSession,
    target,
    moduleItem,
  } = buildLauncherScenario(8_000);

  const activationResult = scene.activateGenericModule(
    attackerSession.session,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);

  const missile = getMissileEntities(scene)[0];
  assert.ok(missile, "expected a live missile entity");

  const nowMs = scene.getCurrentSimTimeMs();
  target.position = { x: 570, y: 0, z: 0 };
  target.velocity = { x: 0, y: 0, z: 0 };
  target.targetPoint = { ...target.position };
  target.mode = "STOP";
  target.radius = 40;
  missile.position = { x: 0, y: 0, z: 0 };
  missile.velocity = { x: missile.maxVelocity, y: 0, z: 0 };
  missile.direction = { x: 1, y: 0, z: 0 };
  missile.targetPoint = { ...target.position };
  missile.mode = "FOLLOW";
  missile.impactAtMs = nowMs;
  missile.surfaceImpactAtMs = nowMs;
  missile.expiresAtMs = nowMs + 5_000;

  advanceScene(scene, 100);
  assert.equal(
    getMissileEntities(scene).length,
    1,
    "expected the missile to stay alive while it is only inside missileRadius + targetRadius and has not yet reached CCP's target-radius impact shell",
  );
  assert.equal(
    target.conditionState.shieldCharge,
    1,
    "expected no early damage while the missile center is still outside the target radius",
  );

  let landed = false;
  for (let index = 0; index < 5; index += 1) {
    advanceScene(scene, 100);
    if (
      target.conditionState.shieldCharge < 1 &&
      getMissileEntities(scene).length === 0
    ) {
      landed = true;
      break;
    }
  }
  assert.equal(
    landed,
    true,
    "expected the missile to land shortly after its center actually reaches CCP's target-radius impact shell",
  );
});

test("missiles are not removed before the client's minimum visual flight window elapses", () => {
  const {
    scene,
    attackerSession,
    target,
    moduleItem,
  } = buildLauncherScenario(300);

  const activationResult = scene.activateGenericModule(
    attackerSession.session,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);
  assert.equal(getMissileEntities(scene).length, 1);
  const missile = getMissileEntities(scene)[0];
  const visualWindowMs = Math.max(
    1,
    Math.ceil(
      Math.max(
        0,
        Number(missile && missile.impactAtMs) - Number(missile && missile.launchedAtMs),
      ),
    ),
  );

  advanceScene(scene, Math.max(0, visualWindowMs - 1));
  assert.equal(
    getMissileEntities(scene).length,
    1,
    "expected the torpedo to remain visible until just before CCP's client visual ETA elapses",
  );
  assert.equal(
    target.conditionState.shieldCharge,
    1,
    "expected no early damage before the client-visible missile flight window elapses",
  );

  let landedAfterVisualWindow = false;
  for (let index = 0; index < 20; index += 1) {
    advanceScene(scene, 50);
    if (
      target.conditionState.shieldCharge < 1 &&
      getMissileEntities(scene).length === 0
    ) {
      landedAfterVisualWindow = true;
      break;
    }
  }
  assert.ok(
    landedAfterVisualWindow,
    "expected the torpedo to land shortly after the client-visible missile flight window has elapsed",
  );
});

test("missiles launched midway through a late scene tick do not consume pre-launch travel", () => {
  const {
    scene,
    attacker,
    attackerSession,
    target,
    moduleItem,
  } = buildLauncherScenario(3_000);

  const activationResult = scene.activateGenericModule(
    attackerSession.session,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);

  for (const missile of getMissileEntities(scene)) {
    scene.unregisterDynamicEntity(missile, { broadcast: false });
  }
  target.conditionState = {
    ...target.conditionState,
    shieldCharge: 1,
    armorDamage: 0,
    structureDamage: 0,
  };

  const effectState = attacker.activeModuleEffects.get(moduleItem.itemID);
  assert.ok(effectState, "expected the launcher effect to stay active");

  const baseNowMs = scene.getCurrentSimTimeMs();
  effectState.startedAtMs = baseNowMs;
  effectState.nextCycleAtMs = baseNowMs + 500;

  advanceScene(scene, 1_000);

  const launchedAtMs = baseNowMs + 500;
  const lateCycleMissile = getMissileEntities(scene).find((missile) =>
    Math.abs(Number(missile && missile.launchedAtMs) - launchedAtMs) < 0.000001
  );
  assert.ok(
    lateCycleMissile,
    "expected a new missile from the late-cycle launch to remain alive after its first half-tick of travel",
  );
  const expectedPostLaunchSeconds = Math.max(
    0,
    (
      Number(scene.getCurrentSimTimeMs()) -
      Number(lateCycleMissile.launchedAtMs)
    ) / 1000,
  );
  assertApprox(
    lateCycleMissile.lastMissileStep.deltaSeconds,
    expectedPostLaunchSeconds,
    0.000001,
  );
  assert.equal(
    target.conditionState.shieldCharge,
    1,
    "expected the late-cycle missile not to land before its actual post-launch travel time elapses",
  );

  let landedOnLaterTick = false;
  for (let index = 0; index < 20; index += 1) {
    advanceScene(scene, 100);
    if (
      target.conditionState.shieldCharge < 1 &&
      getMissileEntities(scene).every((missile) =>
        Number(missile && missile.launchedAtMs) !== launchedAtMs
      )
    ) {
      landedOnLaterTick = true;
      break;
    }
  }
  assert.equal(
    landedOnLaterTick,
    true,
    "expected the late-cycle missile to land only after later simulation time, not during the pre-launch portion of the delayed tick",
  );
});

test("missile removals stay visible to the launcher owner even when its history is ahead", () => {
  const {
    scene,
    attacker,
    attackerSession,
    targetSession,
    target,
    moduleItem,
    chargeItem,
  } = buildLauncherScenario(2_000);

  const launchResult = scene.launchMissile(
    attacker,
    target.itemID,
    {
      family: "missileLauncher",
      chargeTypeID: chargeItem.typeID,
      maxVelocity: 4_500,
      flightTimeMs: 10_000,
      approxRange: 45_000,
      rawShotDamage: {
        em: 0,
        thermal: 0,
        kinetic: 100,
        explosive: 0,
      },
    },
    {
      launchTimeMs: scene.getCurrentSimTimeMs(),
      moduleItem,
      chargeItem,
      skipRangeCheck: true,
    },
  );
  assert.equal(launchResult.success, true);

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;
  targetSession.notifications.length = 0;

  const ownerCurrentSessionStamp = scene.getCurrentSessionDestinyStamp(
    attackerSession.session,
    scene.getCurrentSimTimeMs(),
  );
  const inflatedOwnerVisibleBarrier = (ownerCurrentSessionStamp + 100) >>> 0;
  attackerSession.session._space.historyFloorDestinyStamp = inflatedOwnerVisibleBarrier;
  const observerVisibleLeadStamp = (
    scene.translateDestinyStampForSession(
      targetSession.session,
      scene.getCurrentDestinyStamp(),
    ) + 3
  ) >>> 0;
  targetSession.session._space.historyFloorDestinyStamp = observerVisibleLeadStamp;

  advanceScene(scene, 2_000);

  const ownerUpdates = flattenDestinyUpdates(attackerSession.notifications);
  const ownerRemovalUpdates = ownerUpdates.filter((entry) => entry.name === "RemoveBalls");
  const ownerDestructionUpdates = ownerUpdates.filter(
    (entry) => entry.name === "TerminalPlayDestructionEffect",
  );
  assert.equal(
    ownerRemovalUpdates.length >= 1,
    true,
    "expected the missile impact to remove the missile for the launcher owner",
  );
  assert.equal(
    ownerDestructionUpdates.length >= 1,
    true,
    "expected the missile impact to keep its destruction presentation for the launcher owner",
  );
  assert.equal(
    ownerRemovalUpdates.every(
      (entry) => entry.stamp >= (
        ownerCurrentSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD
      ),
    ),
    true,
    "expected owner missile removals to stay on the live owner session lane instead of ratcheting off inflated owner history",
  );
  assert.equal(
    ownerDestructionUpdates.every(
      (entry) => entry.stamp >= (
        ownerCurrentSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD
      ),
    ),
    true,
    "expected owner missile destruction effects to stay on the live owner session lane instead of ratcheting off inflated owner history",
  );
  assert.equal(
    ownerRemovalUpdates.every((entry) => entry.stamp < inflatedOwnerVisibleBarrier),
    true,
    "expected owner missile removals not to climb onto the inflated owner history floor",
  );
  assert.equal(
    ownerDestructionUpdates.every((entry) => entry.stamp < inflatedOwnerVisibleBarrier),
    true,
    "expected owner missile destruction effects not to climb onto the inflated owner history floor",
  );
  assert.equal(
    ownerRemovalUpdates.every((entry) => ownerDestructionUpdates.some((effect) => effect.stamp === entry.stamp)),
    true,
    "expected owner missile destruction effects to stay aligned with missile removals",
  );

  const updates = flattenDestinyUpdates(targetSession.notifications);
  const removalUpdates = updates.filter((entry) => entry.name === "RemoveBalls");
  const destructionUpdates = updates.filter(
    (entry) => entry.name === "TerminalPlayDestructionEffect",
  );
  assert.equal(
    removalUpdates.length >= 1,
    true,
    "expected the missile impact to remove the missile for an observer",
  );
  assert.equal(
    destructionUpdates.length >= 1,
    true,
    "expected the missile impact to keep its observer destruction presentation",
  );
  assert.equal(
    removalUpdates.every((entry) => entry.stamp >= observerVisibleLeadStamp),
    true,
    "expected observer missile removals not to backstep behind visible history",
  );
  assert.equal(
    destructionUpdates.every((entry) => entry.stamp >= observerVisibleLeadStamp),
    true,
    "expected observer missile destruction effects not to backstep behind visible history",
  );
  assert.equal(
    removalUpdates.every((entry) => destructionUpdates.some((effect) => effect.stamp === entry.stamp)),
    true,
    "expected missile destruction effects to stay aligned with missile removals",
  );
});

test("launcher-owner missile removals ignore an inflated owner lane and stay on the trusted owner combat lane", () => {
  const {
    scene,
    attacker,
    attackerSession,
    target,
    moduleItem,
    chargeItem,
  } = buildLauncherScenario(2_000);
  const session = attackerSession.session;

  const launchResult = scene.launchMissile(
    attacker,
    target.itemID,
    {
      family: "missileLauncher",
      chargeTypeID: chargeItem.typeID,
      maxVelocity: 4_500,
      flightTimeMs: 10_000,
      approxRange: 45_000,
      rawShotDamage: {
        em: 0,
        thermal: 0,
        kinetic: 100,
        explosive: 0,
      },
    },
    {
      launchTimeMs: scene.getCurrentSimTimeMs(),
      moduleItem,
      chargeItem,
      skipRangeCheck: true,
    },
  );
  assert.equal(launchResult.success, true);

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const missile = getMissileEntities(scene)[0];
  assert.ok(missile, "expected a live missile entity before owner removal");

  session._space.clockOffsetMs = 0;
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    scene.getCurrentSimTimeMs(),
  );
  const inflatedVisibleBarrier = ((currentSessionStamp + 20) >>> 0);
  session._space.lastSentDestinyStamp = inflatedVisibleBarrier;
  session._space.visibleDynamicEntityIDs.add(missile.itemID);

  scene.broadcastRemoveBall(missile.itemID, null, {
    terminalDestructionEffectID: 3,
    visibilityEntity: missile,
    nowMs: scene.getCurrentSimTimeMs(),
  });

  const ownerUpdates = flattenDestinyUpdates(attackerSession.notifications);
  const ownerRemovalUpdates = ownerUpdates.filter((entry) => entry.name === "RemoveBalls");
  const ownerDestructionUpdates = ownerUpdates.filter(
    (entry) => entry.name === "TerminalPlayDestructionEffect",
  );
  assert.equal(ownerRemovalUpdates.length, 1);
  assert.equal(ownerDestructionUpdates.length, 1);
  assert.equal(
    ownerRemovalUpdates[0].stamp >= (
      getImmediateClientLaneStamp(scene, session) +
      OWNER_MISSILE_CLIENT_LANE_LEAD
    ),
    true,
    "expected owner missile removals to stay inside Michelle's held-future window on the owner's current lane",
  );
  assert.equal(
    ownerRemovalUpdates[0].stamp < inflatedVisibleBarrier,
    true,
    "expected owner missile removals not to ratchet onto an untrusted inflated owner lane",
  );
  assert.equal(
    ownerDestructionUpdates[0].stamp,
    ownerRemovalUpdates[0].stamp,
    "expected owner missile destruction effects to stay aligned with owner missile removals",
  );
});

test("observer missile removals use Michelle's current session lane instead of raw current history", () => {
  const {
    scene,
    attacker,
    attackerSession,
    target,
    targetSession,
    moduleItem,
    chargeItem,
  } = buildLauncherScenario(2_000);
  const observerSession = targetSession.session;

  const launchResult = scene.launchMissile(
    attacker,
    target.itemID,
    {
      family: "missileLauncher",
      chargeTypeID: chargeItem.typeID,
      maxVelocity: 4_500,
      flightTimeMs: 10_000,
      approxRange: 45_000,
      rawShotDamage: {
        em: 0,
        thermal: 0,
        kinetic: 100,
        explosive: 0,
      },
    },
    {
      launchTimeMs: scene.getCurrentSimTimeMs(),
      moduleItem,
      chargeItem,
      skipRangeCheck: true,
    },
  );
  assert.equal(launchResult.success, true);

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;
  targetSession.notifications.length = 0;

  const missile = getMissileEntities(scene)[0];
  assert.ok(missile, "expected a live missile entity before observer removal");

  const currentObserverSessionStamp = scene.getCurrentSessionDestinyStamp(
    observerSession,
    scene.getCurrentSimTimeMs(),
  );
  observerSession._space.lastSentDestinyStamp = currentObserverSessionStamp >>> 0;
  observerSession._space.visibleDynamicEntityIDs.add(missile.itemID);

  scene.broadcastRemoveBall(missile.itemID, null, {
    terminalDestructionEffectID: 3,
    visibilityEntity: missile,
    nowMs: scene.getCurrentSimTimeMs(),
  });

  const observerUpdates = flattenDestinyUpdates(targetSession.notifications);
  const observerRemovalUpdates = observerUpdates.filter((entry) => entry.name === "RemoveBalls");
  const observerDestructionUpdates = observerUpdates.filter(
    (entry) => entry.name === "TerminalPlayDestructionEffect",
  );
  assert.equal(observerRemovalUpdates.length, 1);
  assert.equal(observerDestructionUpdates.length, 1);
  assert.equal(
    observerRemovalUpdates[0].stamp >= (
      currentObserverSessionStamp +
      MICHELLE_PRETICK_HISTORY_SAFE_DESTINY_LEAD
    ),
    true,
    "expected observer missile removals to clear Michelle's current session lane instead of leaving on the raw current tick",
  );
  assert.equal(
    observerDestructionUpdates[0].stamp,
    observerRemovalUpdates[0].stamp,
    "expected observer missile destruction effects to stay aligned with observer missile removals",
  );
});

test("observer missile removals clear an already-presented future lane instead of landing underneath it", () => {
  const {
    scene,
    attacker,
    attackerSession,
    target,
    targetSession,
    moduleItem,
    chargeItem,
  } = buildLauncherScenario(2_000);
  const observerSession = targetSession.session;

  const launchResult = scene.launchMissile(
    attacker,
    target.itemID,
    {
      family: "missileLauncher",
      chargeTypeID: chargeItem.typeID,
      maxVelocity: 4_500,
      flightTimeMs: 10_000,
      approxRange: 45_000,
      rawShotDamage: {
        em: 0,
        thermal: 0,
        kinetic: 100,
        explosive: 0,
      },
    },
    {
      launchTimeMs: scene.getCurrentSimTimeMs(),
      moduleItem,
      chargeItem,
      skipRangeCheck: true,
    },
  );
  assert.equal(launchResult.success, true);

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;
  targetSession.notifications.length = 0;

  const missile = getMissileEntities(scene)[0];
  assert.ok(missile, "expected a live missile entity before observer removal");

  const nowMs = scene.getCurrentSimTimeMs();
  const currentObserverSessionStamp = scene.getCurrentSessionDestinyStamp(
    observerSession,
    nowMs,
  );
  const currentRawStamp = scene.getCurrentDestinyStamp(nowMs);
  const presentedObserverLane = (
    currentObserverSessionStamp + MICHELLE_PRETICK_HISTORY_SAFE_DESTINY_LEAD
  ) >>> 0;
  observerSession._space.historyFloorDestinyStamp = currentObserverSessionStamp >>> 0;
  observerSession._space.lastSentDestinyStamp = presentedObserverLane;
  observerSession._space.lastSentDestinyRawDispatchStamp = currentRawStamp;
  observerSession._space.visibleDynamicEntityIDs.add(missile.itemID);

  scene.broadcastRemoveBall(missile.itemID, null, {
    terminalDestructionEffectID: 3,
    visibilityEntity: missile,
    nowMs,
  });

  const observerUpdates = flattenDestinyUpdates(targetSession.notifications);
  const observerRemovalUpdates = observerUpdates.filter(
    (entry) => entry.name === "RemoveBalls",
  );
  const observerDestructionUpdates = observerUpdates.filter(
    (entry) => entry.name === "TerminalPlayDestructionEffect",
  );
  assert.equal(observerRemovalUpdates.length, 1);
  assert.equal(observerDestructionUpdates.length, 1);
  assert.equal(
    observerRemovalUpdates[0].stamp >= presentedObserverLane,
    true,
    "expected observer missile removals to clear the already-presented future lane instead of arriving underneath it",
  );
  assert.equal(
    observerDestructionUpdates[0].stamp >= presentedObserverLane,
    true,
    "expected observer missile destruction effects to clear the already-presented future lane instead of arriving underneath it",
  );
  assert.equal(
    observerDestructionUpdates[0].stamp,
    observerRemovalUpdates[0].stamp,
    "expected observer missile destruction effects to stay aligned with observer missile removals after presented-lane restamping",
  );
});

test("observer missile removals stay monotonic with a recently sent far-ahead owner lane from the immediately prior raw dispatch", () => {
  const {
    scene,
    attackerSession,
    targetSession,
  } = buildLauncherScenario(25_000);
  const observerSession = targetSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;
  targetSession.notifications.length = 0;

  const nowMs = scene.getCurrentSimTimeMs();
  const currentRawStamp = scene.getCurrentDestinyStamp(nowMs);
  const priorRawStamp =
    currentRawStamp > 0
      ? ((currentRawStamp - 1) >>> 0)
      : currentRawStamp;
  const currentObserverSessionStamp = scene.getCurrentSessionDestinyStamp(
    observerSession,
    nowMs,
  );
  const recentlySentOwnerLane = (
    currentObserverSessionStamp +
    RECENT_EMITTED_OWNER_CRITICAL_MAX_LEAD
  ) >>> 0;

  observerSession._space.lastSentDestinyStamp = recentlySentOwnerLane;
  observerSession._space.lastSentDestinyRawDispatchStamp = priorRawStamp;
  observerSession._space.lastSentDestinyWasOwnerCritical = true;
  observerSession._space.lastOwnerNonMissileCriticalStamp = recentlySentOwnerLane;
  observerSession._space.lastOwnerNonMissileCriticalRawDispatchStamp = priorRawStamp;
  observerSession._space.lastOwnerMissileLifecycleStamp = recentlySentOwnerLane;
  observerSession._space.lastOwnerMissileLifecycleAnchorStamp =
    currentObserverSessionStamp;
  observerSession._space.lastOwnerMissileLifecycleRawDispatchStamp = priorRawStamp;
  observerSession._space.lastOwnerMissileFreshAcquireStamp = 0;
  observerSession._space.lastOwnerMissileFreshAcquireAnchorStamp = 0;
  observerSession._space.lastOwnerMissileFreshAcquireRawDispatchStamp = 0;
  observerSession._space.lastPilotCommandMovementStamp = 0;
  observerSession._space.lastPilotCommandMovementAnchorStamp = 0;
  observerSession._space.lastPilotCommandMovementRawDispatchStamp = 0;

  scene.sendDestinyUpdates(
    observerSession,
    [
      {
        stamp: currentRawStamp >>> 0,
        payload: ["TerminalPlayDestructionEffect", [980000000001, 3]],
        missileLifecycleGroup: true,
      },
      {
        stamp: currentRawStamp >>> 0,
        payload: ["RemoveBalls", [[980000000001]]],
        missileLifecycleGroup: true,
      },
    ],
    false,
    {
      translateStamps: false,
      minimumHistoryLeadFloor: 2,
      minimumLeadFromCurrentHistory: 2,
      maximumLeadFromCurrentHistory: 2,
      maximumHistorySafeLeadOverride: 2,
      historyLeadUsesImmediateSessionStamp: true,
      avoidCurrentHistoryInsertion: true,
    },
  );

  const observerUpdates = flattenDestinyUpdates(targetSession.notifications);
  const observerRemovalUpdate = observerUpdates.find(
    (entry) => entry.name === "RemoveBalls",
  );
  const observerDestructionUpdate = observerUpdates.find(
    (entry) => entry.name === "TerminalPlayDestructionEffect",
  );
  assert.ok(
    observerRemovalUpdate,
    "expected the observer session to receive a missile removal update",
  );
  assert.ok(
    observerDestructionUpdate,
    "expected the observer session to receive a missile destruction update",
  );
  assert.equal(
    observerRemovalUpdate.stamp >= recentlySentOwnerLane,
    true,
    "expected observer missile removals not to backstep under the recently sent far-ahead owner lane from the prior raw dispatch",
  );
  assert.equal(
    observerDestructionUpdate.stamp,
    observerRemovalUpdate.stamp,
    "expected observer missile destruction effects to stay aligned with observer missile removals after owner-lane restamping",
  );
});

test("launcher-owner missile removals clear an already-sent owner presented lane instead of landing underneath it", () => {
  const {
    scene,
    attacker,
    attackerSession,
    target,
    moduleItem,
    chargeItem,
  } = buildLauncherScenario(2_000);
  const session = attackerSession.session;

  const launchResult = scene.launchMissile(
    attacker,
    target.itemID,
    {
      family: "missileLauncher",
      chargeTypeID: chargeItem.typeID,
      maxVelocity: 4_500,
      flightTimeMs: 10_000,
      approxRange: 45_000,
      rawShotDamage: {
        em: 0,
        thermal: 0,
        kinetic: 100,
        explosive: 0,
      },
    },
    {
      launchTimeMs: scene.getCurrentSimTimeMs(),
      moduleItem,
      chargeItem,
      skipRangeCheck: true,
    },
  );
  assert.equal(launchResult.success, true);

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const missile = getMissileEntities(scene)[0];
  assert.ok(missile, "expected a live missile entity before owner removal");

  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    scene.getCurrentSimTimeMs(),
  );
  const recentPresentedStamp = (
    currentSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD
  ) >>> 0;
  const currentRawStamp = scene.getCurrentDestinyStamp(
    scene.getCurrentSimTimeMs(),
  );
  session._space.lastSentDestinyStamp = recentPresentedStamp;
  session._space.lastSentDestinyRawDispatchStamp = currentRawStamp;
  session._space.lastOwnerNonMissileCriticalStamp = recentPresentedStamp;
  session._space.lastOwnerNonMissileCriticalRawDispatchStamp = currentRawStamp;
  session._space.lastOwnerMissileLifecycleStamp = 0;
  session._space.lastPilotCommandMovementStamp = 0;
  session._space.lastPilotCommandMovementAnchorStamp = 0;
  session._space.historyFloorDestinyStamp = currentSessionStamp;
  session._space.visibleDynamicEntityIDs.add(missile.itemID);

  scene.broadcastRemoveBall(missile.itemID, null, {
    terminalDestructionEffectID: 3,
    visibilityEntity: missile,
    nowMs: scene.getCurrentSimTimeMs(),
  });

  const ownerUpdates = flattenDestinyUpdates(attackerSession.notifications);
  const ownerRemovalUpdates = ownerUpdates.filter((entry) => entry.name === "RemoveBalls");
  const ownerDestructionUpdates = ownerUpdates.filter(
    (entry) => entry.name === "TerminalPlayDestructionEffect",
  );
  assert.equal(ownerRemovalUpdates.length, 1);
  assert.equal(ownerDestructionUpdates.length, 1);
  assert.equal(
    ownerRemovalUpdates[0].stamp >= (
      currentSessionStamp +
      OWNER_MISSILE_CLIENT_LANE_LEAD
    ),
    true,
    "expected owner missile removals to clear the live owner session lane instead of reusing current history",
  );
  assert.equal(
    ownerRemovalUpdates[0].stamp,
    (recentPresentedStamp + 1) >>> 0,
    "expected owner missile removals to clear the nearby already-sent presented owner lane instead of arriving underneath it",
  );
  assert.equal(
    ownerDestructionUpdates[0].stamp,
    ownerRemovalUpdates[0].stamp,
    "expected owner missile destruction effects to stay aligned after owner-presented restamping",
  );
});

test("later owner missile removal packets do not backstep behind earlier owner missile lifecycle sends", () => {
  const {
    scene,
    attackerSession,
    target,
    moduleItems,
  } = buildMultiLauncherScenario(2, 8_000);
  const session = attackerSession.session;

  for (const moduleItem of moduleItems) {
    const activationResult = scene.activateGenericModule(
      session,
      moduleItem,
      null,
      {
        targetID: target.itemID,
      },
    );
    assert.equal(activationResult.success, true);
  }

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const missiles = getMissileEntities(scene)
    .slice()
    .sort((left, right) => Number(left.itemID) - Number(right.itemID));
  assert.equal(missiles.length >= 2, true, "expected two live missiles");

  for (const missile of missiles) {
    session._space.visibleDynamicEntityIDs.add(missile.itemID);
  }

  const currentStamp = scene.getCurrentDestinyStamp(scene.getCurrentSimTimeMs());
  scene.broadcastRemoveBall(missiles[0].itemID, null, {
    terminalDestructionEffectID: 3,
    visibilityEntity: missiles[0],
    nowMs: scene.getCurrentSimTimeMs(),
    stampOverride: (currentStamp + 6) >>> 0,
  });
  scene.broadcastRemoveBall(missiles[1].itemID, null, {
    terminalDestructionEffectID: 3,
    visibilityEntity: missiles[1],
    nowMs: scene.getCurrentSimTimeMs(),
    stampOverride: (currentStamp + 5) >>> 0,
  });

  const ownerUpdates = flattenDestinyUpdates(attackerSession.notifications);
  const ownerRemovalUpdates = ownerUpdates.filter((entry) => entry.name === "RemoveBalls");
  const ownerDestructionUpdates = ownerUpdates.filter(
    (entry) => entry.name === "TerminalPlayDestructionEffect",
  );
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    scene.getCurrentSimTimeMs(),
  );

  assert.equal(ownerRemovalUpdates.length, 2);
  assert.equal(ownerDestructionUpdates.length, 2);
  assert.equal(
    ownerRemovalUpdates[1].stamp >= ownerRemovalUpdates[0].stamp,
    true,
    "expected a later owner missile removal send not to backstep behind the previously delivered owner missile lifecycle tick",
  );
  assert.equal(
    ownerRemovalUpdates.every(
      (entry) => entry.stamp >= (
        getImmediateClientLaneStamp(scene, session) +
        OWNER_MISSILE_CLIENT_LANE_LEAD
      ),
    ),
    true,
    "expected owner missile removals to stay on Michelle's current-lane hold window instead of stair-stepping farther into the future",
  );
  assert.equal(
    ownerDestructionUpdates[1].stamp,
    ownerRemovalUpdates[1].stamp,
    "expected the later owner destruction effect to stay aligned with the clamped removal tick",
  );
});

test("owner missile lifecycle does not drop beneath a higher recent owner lane from the same volley window", () => {
  const {
    scene,
    attackerSession,
  } = buildLauncherScenario(25_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const currentRawDispatchStamp = scene.getCurrentDestinyStamp(
    scene.getCurrentSimTimeMs(),
  );
  const currentOwnerSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    scene.getCurrentSimTimeMs(),
  );

  scene.sendDestinyUpdates(
    session,
    [
      {
        stamp: (currentOwnerSessionStamp + 9) >>> 0,
        payload: destiny.buildTerminalPlayDestructionEffectPayload(
          980000000300,
          3,
        ),
        missileLifecycleGroup: true,
        ownerMissileLifecycleGroup: true,
      },
      {
        stamp: (currentOwnerSessionStamp + 9) >>> 0,
        payload: destiny.buildRemoveBallsPayload([980000000300]),
        missileLifecycleGroup: true,
        ownerMissileLifecycleGroup: true,
      },
    ],
    false,
    {
      translateStamps: false,
    },
  );

  scene.sendDestinyUpdates(
    session,
    [
      {
        stamp: (currentOwnerSessionStamp + 5) >>> 0,
        payload: destiny.buildTerminalPlayDestructionEffectPayload(
          980000000301,
          3,
        ),
        missileLifecycleGroup: true,
        ownerMissileLifecycleGroup: true,
      },
      {
        stamp: (currentOwnerSessionStamp + 5) >>> 0,
        payload: destiny.buildRemoveBallsPayload([980000000301]),
        missileLifecycleGroup: true,
        ownerMissileLifecycleGroup: true,
      },
    ],
    false,
    {
      translateStamps: false,
    },
  );

  const ownerUpdates = flattenDestinyUpdates(attackerSession.notifications).filter(
    (entry) =>
      entry.name === "TerminalPlayDestructionEffect" ||
      entry.name === "RemoveBalls",
  );
  const ownerRemovalUpdates = ownerUpdates.filter((entry) => entry.name === "RemoveBalls");
  const firstRemovalUpdate = ownerRemovalUpdates[0];
  const secondRemovalUpdate = ownerRemovalUpdates[1];

  assert.ok(firstRemovalUpdate, "expected the first owner missile removal send");
  assert.ok(secondRemovalUpdate, "expected the second owner missile removal send");
  assert.equal(
    session._space.lastOwnerMissileLifecycleRawDispatchStamp >>> 0,
    currentRawDispatchStamp >>> 0,
    "expected the recent owner missile lane to stay anchored to the current raw dispatch window",
  );
  assert.equal(
    secondRemovalUpdate.stamp >= firstRemovalUpdate.stamp,
    true,
    "expected a later owner missile lifecycle send in the same volley window not to drop beneath the higher owner lane already sent",
  );
});

test("launcher-owner missile removals stay ahead of Michelle's visible history floor", () => {
  const {
    scene,
    attacker,
    attackerSession,
    target,
    moduleItem,
    chargeItem,
  } = buildLauncherScenario(2_000);
  const session = attackerSession.session;

  const launchResult = scene.launchMissile(
    attacker,
    target.itemID,
    {
      family: "missileLauncher",
      chargeTypeID: chargeItem.typeID,
      maxVelocity: 4_500,
      flightTimeMs: 10_000,
      approxRange: 45_000,
      rawShotDamage: {
        em: 0,
        thermal: 0,
        kinetic: 100,
        explosive: 0,
      },
    },
    {
      launchTimeMs: scene.getCurrentSimTimeMs(),
      moduleItem,
      chargeItem,
      skipRangeCheck: true,
    },
  );
  assert.equal(launchResult.success, true);

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const missile = getMissileEntities(scene)[0];
  assert.ok(missile, "expected a live missile entity before owner removal");

  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    scene.getCurrentSimTimeMs(),
  );
  const visibleHistoryFloor = (currentSessionStamp + 1) >>> 0;
  session._space.historyFloorDestinyStamp = visibleHistoryFloor;
  session._space.visibleDynamicEntityIDs.add(missile.itemID);

  scene.broadcastRemoveBall(missile.itemID, null, {
    terminalDestructionEffectID: 3,
    visibilityEntity: missile,
    nowMs: scene.getCurrentSimTimeMs(),
  });

  const ownerUpdates = flattenDestinyUpdates(attackerSession.notifications);
  const ownerRemovalUpdates = ownerUpdates.filter((entry) => entry.name === "RemoveBalls");
  const ownerDestructionUpdates = ownerUpdates.filter(
    (entry) => entry.name === "TerminalPlayDestructionEffect",
  );
  assert.equal(ownerRemovalUpdates.length, 1);
  assert.equal(ownerDestructionUpdates.length, 1);
  assert.equal(
    ownerRemovalUpdates[0].stamp >= (
      currentSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD
    ),
    true,
    "expected owner missile removals to stay on the live owner session lane instead of reusing current history",
  );
  assert.equal(
    ownerRemovalUpdates[0].stamp > visibleHistoryFloor,
    true,
    "expected owner missile removals not to backstep behind the client's visible history floor",
  );
  assert.equal(
    ownerDestructionUpdates[0].stamp,
    ownerRemovalUpdates[0].stamp,
    "expected owner missile destruction effects to stay aligned after visible-history restamping",
  );
});

test("missile impact damage-state updates leave one full visible tick after the observer's current history", () => {
  const {
    scene,
    attacker,
    attackerSession,
    target,
    moduleItem,
    chargeItem,
  } = buildLauncherScenario(2_000);

  const launchResult = scene.launchMissile(
    attacker,
    target.itemID,
    {
      family: "missileLauncher",
      chargeTypeID: chargeItem.typeID,
      maxVelocity: 4_500,
      flightTimeMs: 10_000,
      approxRange: 45_000,
      rawShotDamage: {
        em: 0,
        thermal: 0,
        kinetic: 100,
        explosive: 0,
      },
    },
    {
      launchTimeMs: scene.getCurrentSimTimeMs(),
      moduleItem,
      chargeItem,
      skipRangeCheck: true,
    },
  );
  assert.equal(launchResult.success, true);

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const visibleLeadStamp = (
    scene.translateDestinyStampForSession(
      attackerSession.session,
      scene.getCurrentDestinyStamp(),
    ) + 3
  ) >>> 0;
  attackerSession.session._space.lastSentDestinyStamp = visibleLeadStamp;
  attackerSession.session._space.historyFloorDestinyStamp = visibleLeadStamp;

  advanceScene(scene, 2_000);

  const damageUpdates = flattenDestinyUpdates(attackerSession.notifications).filter(
    (entry) =>
      entry.name === "OnDamageStateChange" &&
      Number(entry.args[0]) === target.itemID,
  );
  assert.equal(
    damageUpdates.length >= 1,
    true,
    "expected missile impacts to publish damage-state updates to the observing attacker",
  );
  assert.equal(
    damageUpdates.every((entry) => entry.stamp >= ((visibleLeadStamp + 1) >>> 0)),
    true,
    "expected missile impact damage-state updates to leave one full visible Destiny tick after the observer's current local history",
  );
});

test("owner damage-state updates clear a previously sent owner missile lane from an earlier tick", () => {
  const {
    scene,
    attacker,
    attackerSession,
  } = buildLauncherScenario(2_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const currentOwnerSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    scene.getCurrentSimTimeMs(),
  );
  const priorOwnerMissileLane = (
    currentOwnerSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD + 2
  ) >>> 0;
  session._space.lastSentDestinyStamp = priorOwnerMissileLane;
  session._space.lastOwnerMissileLifecycleStamp = priorOwnerMissileLane;
  session._space.lastOwnerMissileLifecycleAnchorStamp =
    currentOwnerSessionStamp > 0
      ? ((currentOwnerSessionStamp - 1) >>> 0)
      : 0;

  spaceRuntime._testing.broadcastDamageStateChangeForTesting(
    scene,
    attacker,
    scene.getCurrentSimTimeMs(),
  );

  const ownerDamageUpdates = flattenDestinyUpdates(attackerSession.notifications).filter(
    (entry) =>
      entry.name === "OnDamageStateChange" &&
      Number(entry.args[0]) === attacker.itemID,
  );
  assert.equal(
    ownerDamageUpdates.length >= 1,
    true,
    "expected owner damage-state updates to reach the launcher owner session",
  );
  assert.equal(
    ownerDamageUpdates.every((entry) => entry.stamp >= ((priorOwnerMissileLane + 2) >>> 0)),
    true,
    "expected a later owner damage-state update to clear a previously sent owner missile lane from an earlier owner tick instead of arriving underneath queued missile traffic",
  );
});

test("owner damage-state updates clear the projected consumed owner missile lane from an earlier raw tick", () => {
  const {
    scene,
    attacker,
    attackerSession,
  } = buildLauncherScenario(2_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const nowMs = scene.getCurrentSimTimeMs();
  const currentRawDispatchStamp = scene.getCurrentDestinyStamp(nowMs);
  session._space.clockOffsetMs = 4_000;
  const currentOwnerSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    nowMs,
  );
  const priorOwnerMissileLane =
    currentOwnerSessionStamp > 0
      ? ((currentOwnerSessionStamp - 1) >>> 0)
      : currentOwnerSessionStamp;
  const priorOwnerMissileRawDispatchStamp =
    currentRawDispatchStamp > 5
      ? ((currentRawDispatchStamp - 5) >>> 0)
      : currentRawDispatchStamp;
  const projectedConsumedPriorOwnerMissileLane = (
    priorOwnerMissileLane +
    (currentRawDispatchStamp - priorOwnerMissileRawDispatchStamp)
  ) >>> 0;

  session._space.historyFloorDestinyStamp =
    currentOwnerSessionStamp > 0
      ? ((currentOwnerSessionStamp - 1) >>> 0)
      : currentOwnerSessionStamp;
  session._space.lastSentDestinyStamp = (
    currentOwnerSessionStamp + 1
  ) >>> 0;
  session._space.lastSentDestinyRawDispatchStamp = currentRawDispatchStamp;
  session._space.lastOwnerMissileLifecycleStamp = priorOwnerMissileLane;
  session._space.lastOwnerMissileLifecycleAnchorStamp =
    currentOwnerSessionStamp > 5
      ? ((currentOwnerSessionStamp - 5) >>> 0)
      : 0;
  session._space.lastOwnerMissileLifecycleRawDispatchStamp =
    priorOwnerMissileRawDispatchStamp;

  spaceRuntime._testing.broadcastDamageStateChangeForTesting(
    scene,
    attacker,
    nowMs,
  );

  const ownerDamageUpdates = flattenDestinyUpdates(attackerSession.notifications).filter(
    (entry) =>
      entry.name === "OnDamageStateChange" &&
      Number(entry.args[0]) === attacker.itemID,
  );
  assert.equal(
    ownerDamageUpdates.length >= 1,
    true,
    "expected projected-gap owner damage-state updates to reach the launcher owner session",
  );
  assert.equal(
    ownerDamageUpdates.every(
      (entry) => entry.stamp >= ((projectedConsumedPriorOwnerMissileLane + 1) >>> 0),
    ),
    true,
    "expected owner damage-state updates to clear the projected client-consumed prior owner missile lane instead of arriving underneath it after a raw-dispatch gap",
  );
});

test("same-raw already-sent owner damage-state becomes a monotonic floor for the next owner fresh-acquire", () => {
  const {
    scene,
    attacker,
    attackerSession,
  } = buildLauncherScenario(2_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const nowMs = scene.getCurrentSimTimeMs();
  const currentRawDispatchStamp = scene.getCurrentDestinyStamp(nowMs);
  const currentOwnerSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    nowMs,
  );
  const immediateOwnerLane = getImmediateClientLaneStamp(scene, session, nowMs);
  const priorRawDispatchStamp =
    currentRawDispatchStamp > 2
      ? ((currentRawDispatchStamp - 2) >>> 0)
      : currentRawDispatchStamp;
  const priorOwnerMissileLane = (
    currentOwnerSessionStamp +
    OWNER_MISSILE_CLIENT_LANE_LEAD +
    2
  ) >>> 0;
  const priorOwnerMovementLane = (
    currentOwnerSessionStamp +
    OWNER_MISSILE_CLIENT_LANE_LEAD
  ) >>> 0;

  session._space.lastSentDestinyStamp = priorOwnerMissileLane;
  session._space.lastSentDestinyRawDispatchStamp = priorRawDispatchStamp;
  session._space.lastOwnerMissileLifecycleStamp = priorOwnerMissileLane;
  session._space.lastOwnerMissileLifecycleAnchorStamp =
    currentOwnerSessionStamp > 2
      ? ((currentOwnerSessionStamp - 2) >>> 0)
      : 0;
  session._space.lastOwnerMissileLifecycleRawDispatchStamp =
    priorRawDispatchStamp;
  session._space.lastPilotCommandMovementStamp = priorOwnerMovementLane;
  session._space.lastPilotCommandMovementAnchorStamp =
    currentOwnerSessionStamp > 2
      ? ((currentOwnerSessionStamp - 2) >>> 0)
      : 0;
  session._space.lastOwnerNonMissileCriticalStamp = priorOwnerMovementLane;
  session._space.lastOwnerNonMissileCriticalRawDispatchStamp =
    priorRawDispatchStamp;

  spaceRuntime._testing.broadcastDamageStateChangeForTesting(
    scene,
    attacker,
    nowMs,
  );

  scene.sendDestinyUpdates(
    session,
    [
      {
        stamp: currentRawDispatchStamp >>> 0,
        payload: ["AddBalls2", []],
        freshAcquireLifecycleGroup: true,
        missileLifecycleGroup: true,
        ownerMissileLifecycleGroup: true,
      },
    ],
    false,
    {
      translateStamps: false,
    },
  );

  const ownerDamageUpdate = flattenDestinyUpdates(attackerSession.notifications).find(
    (entry) =>
      entry.name === "OnDamageStateChange" &&
      Number(entry.args[0]) === attacker.itemID,
  );
  const ownerAddBallsUpdate = flattenDestinyUpdates(attackerSession.notifications).find(
    (entry) => entry.name === "AddBalls2",
  );

  assert.ok(
    ownerDamageUpdate,
    "expected the owner damage-state update to be visible in the same-raw repro",
  );
  assert.ok(
    ownerAddBallsUpdate,
    "expected the owner fresh acquire to remain visible in the same-raw repro",
  );
  assert.equal(
    ownerAddBallsUpdate.stamp >= (
      (immediateOwnerLane + OWNER_MISSILE_CLIENT_LANE_LEAD) >>> 0
    ),
    true,
    "expected the later owner fresh acquire to stay on or above the immediate owner missile safety floor",
  );
  assert.equal(
    ownerAddBallsUpdate.stamp >= ((ownerDamageUpdate.stamp + 1) >>> 0),
    true,
    "expected a later owner fresh acquire not to backstep underneath an already-sent same-raw owner damage-state lane",
  );
  assert.equal(
    Number(session._space.lastFreshAcquireLifecycleStamp) >=
      Number(ownerAddBallsUpdate.stamp),
    true,
    "expected owner fresh-acquire tracking not to regress beneath the emitted owner AddBalls lane",
  );
  assert.equal(
    Number(session._space.lastOwnerMissileLifecycleStamp) >=
      Number(ownerAddBallsUpdate.stamp),
    true,
    "expected owner missile lifecycle tracking not to regress beneath the emitted owner AddBalls lane",
  );
  assert.equal(
    Number(session._space.lastOwnerMissileFreshAcquireStamp) >=
      Number(ownerAddBallsUpdate.stamp),
    true,
    "expected owner fresh-acquire owner tracking not to regress beneath the emitted owner AddBalls lane",
  );
});

test("owner SetState refresh stays at near-current time instead of inflating to compounded missile stamps", () => {
  const {
    scene,
    attacker,
    attackerSession,
  } = buildLauncherScenario(2_000);
  const session = attackerSession.session;

  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const nowMs = scene.getCurrentSimTimeMs();
  const currentRawDispatchStamp = scene.getCurrentDestinyStamp(nowMs);
  const priorRawDispatchStamp =
    currentRawDispatchStamp > 0
      ? ((currentRawDispatchStamp - 1) >>> 0)
      : currentRawDispatchStamp;
  const currentOwnerSessionStamp = scene.getCurrentSessionDestinyStamp(
    session,
    nowMs,
  );
  const priorOwnerCombatLane = (
    currentOwnerSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD + 4
  ) >>> 0;

  session._space.lastSentDestinyStamp = priorOwnerCombatLane;
  session._space.lastSentDestinyRawDispatchStamp = priorRawDispatchStamp;
  session._space.lastOwnerMissileLifecycleStamp = priorOwnerCombatLane;
  session._space.lastOwnerMissileLifecycleRawDispatchStamp =
    priorRawDispatchStamp;
  session._space.lastPilotCommandMovementStamp = (
    priorOwnerCombatLane - 1
  ) >>> 0;

  scene.sendStateRefresh(session, attacker, currentRawDispatchStamp, {
    reason: "test-owner-refresh-floor",
  });

  const ownerSetStateUpdate = flattenDestinyUpdates(attackerSession.notifications).find(
    (entry) => entry.name === "SetState",
  );
  assert.ok(
    ownerSetStateUpdate,
    "expected the owner session to receive a SetState refresh",
  );
  // SetState must NOT be inflated to the compounded missile stamp level.
  // A SetState at a high stamp creates a _latest_set_state_time floor on the
  // client that invalidates all subsequent near-current-time updates. In-flight
  // missile updates at higher stamps are safe: they're ABOVE the SetState floor
  // and won't be discarded. The SetState should stay near current time.
  assert.equal(
    ownerSetStateUpdate.stamp <= priorOwnerCombatLane,
    true,
    "expected the owner SetState refresh to stay at or below current time, not inflate to compounded missile stamp " + priorOwnerCombatLane + " (got " + ownerSetStateUpdate.stamp + ")",
  );
  assert.equal(
    Number(session._space.lastSentDestinyStamp) >= Number(ownerSetStateUpdate.stamp),
    true,
    "expected SetState emission to preserve a monotonic lastSentDestinyStamp floor",
  );
});

test("passive shield recharge can be disabled during missile parity tracing", () => {
  const previousPassiveShieldRechargeEnabled =
    spaceRuntime._testing.isPassiveShieldRechargeEnabledForTesting();
  spaceRuntime._testing.setPassiveShieldRechargeEnabledForTesting(false);

  try {
    const {
      scene,
      target,
    } = buildLauncherScenario(8_000);

    target.conditionState = {
      ...target.conditionState,
      shieldCharge: 0.5,
      armorDamage: 0,
      damage: 0,
    };

    advanceScene(scene, 10_000);

    assert.equal(
      Number(target.conditionState.shieldCharge),
      0.5,
      "expected passive shield recharge to stay disabled so missile traces do not drift under background regen",
    );
  } finally {
    spaceRuntime._testing.setPassiveShieldRechargeEnabledForTesting(
      previousPassiveShieldRechargeEnabled,
    );
  }
});

test("expired missiles do not apply damage after their flight budget ends", () => {
  const {
    scene,
    attackerSession,
    target,
    moduleItem,
  } = buildLauncherScenario(8_000);

  const activationResult = scene.activateGenericModule(
    attackerSession.session,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);

  const missile = getMissileEntities(scene)[0];
  assert.ok(missile, "expected a missile entity after activation");
  missile.expiresAtMs = scene.getCurrentSimTimeMs() + 1_000;
  missile.impactAtMs = missile.expiresAtMs + 1_000;

  advanceScene(scene, 2_500);
  assert.equal(
    target.conditionState.shieldCharge,
    1,
    "expected no damage once the missile has expired",
  );
  assert.equal(getMissileEntities(scene).length, 0, "expected the expired missile to be removed");
});

test("missiles that have already resolved geometry impact do not timeout before the client release floor", () => {
  const {
    scene,
    attackerSession,
    target,
    moduleItem,
  } = buildLauncherScenario(8_000);

  const activationResult = scene.activateGenericModule(
    attackerSession.session,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);

  const missile = getMissileEntities(scene)[0];
  assert.ok(missile, "expected a missile entity after activation");

  const nowMs = scene.getCurrentSimTimeMs();
  missile.pendingGeometryImpact = true;
  missile.pendingGeometryImpactReason = "test-impact";
  missile.pendingGeometryImpactAtMs = nowMs;
  missile.pendingGeometryImpactPosition = { ...missile.position };
  missile.impactAtMs = nowMs + 500;
  missile.expiresAtMs = nowMs + 50;
  missile.clientDoSpread = true;

  advanceScene(scene, 100);
  assert.equal(
    getMissileEntities(scene).length,
    1,
    "expected a missile that has already reached geometry impact to stay alive until the client release floor instead of timing out early",
  );
  assert.equal(
    target.conditionState.shieldCharge,
    1,
    "expected the missile to wait until the client release floor before applying impact damage",
  );

  advanceScene(
    scene,
    2_000,
  );
  assert.ok(
    target.conditionState.shieldCharge < 1,
    "expected damage once the client release floor elapses for a geometry-resolved impact",
  );
  assert.equal(
    getMissileEntities(scene).length,
    0,
    "expected the missile to be removed after the delayed impact release floor elapses",
  );
});

test("missiles clean up when the target disappears before impact", () => {
  const {
    scene,
    attackerSession,
    target,
    moduleItem,
  } = buildLauncherScenario(8_000);

  const activationResult = scene.activateGenericModule(
    attackerSession.session,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);
  assert.equal(getMissileEntities(scene).length, 1);

  scene.unregisterDynamicEntity(target, {
    broadcast: false,
  });
  advanceScene(scene, 100);

  assert.equal(
    getMissileEntities(scene).length,
    0,
    "expected the missile to be removed once the target no longer exists",
  );
});

test("missiles clean up when the target starts warp before impact", () => {
  const {
    scene,
    attackerSession,
    target,
    moduleItem,
  } = buildLauncherScenario(8_000);

  const activationResult = scene.activateGenericModule(
    attackerSession.session,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);
  assert.equal(getMissileEntities(scene).length, 1);

  const warpResult = scene.warpDynamicEntityToPoint(
    target,
    { x: 1_000_000, y: 0, z: 0 },
    { warpSpeedAU: 3 },
  );
  assert.equal(warpResult.success, true, "expected target to enter warp");

  advanceScene(scene, 100);
  assert.equal(
    getMissileEntities(scene).length,
    0,
    "expected missile cleanup once the target has entered warp",
  );
});

test("missiles clean up when the target is destroyed before impact", () => {
  const {
    scene,
    attackerSession,
    target,
    moduleItem,
  } = buildLauncherScenario(8_000);

  const activationResult = scene.activateGenericModule(
    attackerSession.session,
    moduleItem,
    null,
    {
      targetID: target.itemID,
    },
  );
  assert.equal(activationResult.success, true);
  assert.equal(getMissileEntities(scene).length, 1);

  scene.unregisterDynamicEntity(target, {
    terminalDestructionEffectID: 10,
  });
  advanceScene(scene, 100);

  assert.equal(
    getMissileEntities(scene).length,
    0,
    "expected missile cleanup once the target has been destroyed",
  );
});

test("missiles hand public-grid visibility off cleanly between distant observers", () => {
  const scene = spaceRuntime.ensureScene(30000142);
  const source = buildShipEntity(scene, 991100001, 0);
  const sourceOwner = attachSession(scene, source, 991130001);
  const runtimeSource = scene.getEntityByID(source.itemID);
  assert.ok(runtimeSource, "expected spawned source entity");
  const sourceWatcherEntity = buildShipEntity(scene, 991100003, 50_000);
  const sourceWatcher = attachSession(scene, sourceWatcherEntity, 991130003);
  const runtimeSourceWatcher = scene.getEntityByID(sourceWatcherEntity.itemID);
  assert.ok(runtimeSourceWatcher, "expected spawned source watcher entity");

  const target = buildShipEntity(scene, 991100002, 20_000_000);
  const targetObserver = attachSession(scene, target, 991130002);
  const runtimeTarget = scene.getEntityByID(target.itemID);
  assert.ok(runtimeTarget, "expected spawned target entity");

  const missileSnapshot = {
    family: "missileLauncher",
    chargeTypeID: 209,
    rawShotDamage: {
      em: 0,
      thermal: 0,
      kinetic: 149,
      explosive: 0,
    },
    maxVelocity: 100_000,
    flightTimeMs: 300_000,
    explosionRadius: 140,
    explosionVelocity: 85,
    damageReductionFactor: 0.682,
    damageReductionSensitivity: 5.5,
    approxRange: 30_000_000,
  };
  const launchResult = scene.launchMissile(runtimeSource, runtimeTarget.itemID, missileSnapshot, {
    launchTimeMs: scene.getCurrentSimTimeMs(),
    skipRangeCheck: true,
    chargeItem: {
      itemID: 991120001,
      typeID: 209,
      groupID: 385,
      categoryID: 8,
      itemName: "Scourge Heavy Missile",
    },
    moduleItem: {
      itemID: 991110001,
      typeID: 501,
      flagID: 27,
    },
  });
  assert.equal(launchResult.success, true);
  const missile = launchResult.data.entity;
  assert.equal(
    sourceOwner.session._space.visibleDynamicEntityIDs.has(missile.itemID),
    true,
    "expected the launcher owner to stay on the authoritative missile ball lane",
  );
  assert.ok(
    sourceWatcher.session._space.visibleDynamicEntityIDs.has(missile.itemID),
    "expected the source-side watcher to see the missile initially",
  );
  assert.equal(
    targetObserver.session._space.visibleDynamicEntityIDs.has(missile.itemID),
    false,
    "expected the distant observer not to see the missile before it crosses public grids",
  );

  advanceScene(scene, 90_000);
  const midFlightMissile = scene.getEntityByID(missile.itemID);
  assert.ok(midFlightMissile, "expected missile to stay alive while bridging public grids");
  assert.equal(scene.getPublicGridKeyForEntity(midFlightMissile), "1:0:0");
  assert.equal(
    sourceWatcher.session._space.visibleDynamicEntityIDs.has(missile.itemID),
    true,
    "expected the source-side watcher to keep the missile while it bridges the intermediate public grid",
  );
  assert.equal(
    targetObserver.session._space.visibleDynamicEntityIDs.has(missile.itemID),
    true,
    "expected the target observer to acquire the missile once the intermediate public grid links the clusters",
  );

  advanceScene(scene, 80_000);
  const targetSideMissile = scene.getEntityByID(missile.itemID);
  assert.ok(targetSideMissile, "expected missile to stay alive after entering the target public grid");
  assert.equal(scene.getPublicGridKeyForEntity(targetSideMissile), "2:0:0");
  assert.equal(
    sourceWatcher.session._space.visibleDynamicEntityIDs.has(missile.itemID),
    false,
    "expected the source-side watcher to stay out of visibility after handoff",
  );
  assert.equal(
    targetObserver.session._space.visibleDynamicEntityIDs.has(missile.itemID),
    true,
    "expected the target observer to acquire the missile once it enters the target public grid",
  );
});
