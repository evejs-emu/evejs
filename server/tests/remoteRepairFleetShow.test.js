const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const { executeChatCommand } = require(path.join(
  repoRoot,
  "server/src/services/chat/chatCommands",
));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));
const spaceRuntime = require(path.join(
  repoRoot,
  "server/src/space/runtime",
));
const {
  getActiveShipRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  moveShipToSpace,
  setActiveShipForCharacter,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const remoteRepairShowRuntime = require(path.join(
  repoRoot,
  "server/src/RemoteRepShow/remoteRepairShowRuntime",
));

const TEST_SYSTEM_ID = 30000142;
const TEST_CHARACTER_ID = 140000004;
const registeredSessions = [];

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function distanceBetweenPositions(left, right) {
  const dx = Number(right && right.x || 0) - Number(left && left.x || 0);
  const dy = Number(right && right.y || 0) - Number(left && left.y || 0);
  const dz = Number(right && right.z || 0) - Number(left && left.z || 0);
  return Math.sqrt((dx ** 2) + (dy ** 2) + (dz ** 2));
}

function buildSession(characterID, shipItem, position) {
  const notifications = [];
  return {
    clientID: Number(characterID) + 800000,
    characterID,
    charID: characterID,
    corporationID: 1000044,
    allianceID: 0,
    warFactionID: 0,
    solarsystemid: TEST_SYSTEM_ID,
    solarsystemid2: TEST_SYSTEM_ID,
    shipName: shipItem.itemName || `ship-${shipItem.itemID}`,
    socket: { destroyed: false },
    notifications,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendSessionChange(changes, options = {}) {
      notifications.push({ name: "SessionChange", changes, options });
    },
    sendServiceNotification() {},
    shipItem: {
      ...shipItem,
      spaceState: {
        systemID: TEST_SYSTEM_ID,
        position,
        velocity: { x: 0, y: 0, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
        targetPoint: position,
        mode: "STOP",
        speedFraction: 0,
      },
    },
  };
}

function registerAttachedSession(session) {
  registeredSessions.push(session);
  sessionRegistry.register(session);
  const attachResult = spaceRuntime.attachSession(session, session.shipItem, {
    systemID: TEST_SYSTEM_ID,
    broadcast: false,
    spawnStopped: true,
  });
  assert.ok(attachResult, "expected session attach to succeed");
  assert.equal(
    spaceRuntime.ensureInitialBallpark(session),
    true,
    "expected session ballpark bootstrap to succeed",
  );
  session.notifications.length = 0;
  return session;
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

function advanceScene(scene, deltaMs) {
  const wallclockNow = Number(scene && scene.getCurrentWallclockMs && scene.getCurrentWallclockMs()) || Date.now();
  scene.tick(wallclockNow + Math.max(0, Number(deltaMs) || 0));
}

function flushDirectDestinyNotifications(scene) {
  if (scene && typeof scene.flushDirectDestinyNotificationBatch === "function") {
    scene.flushDirectDestinyNotificationBatch();
  }
}

function prepareLiveSpaceSession(characterID, position) {
  const activeShip = getActiveShipRecord(characterID);
  assert.ok(activeShip, `expected active ship for character ${characterID}`);
  const moveResult = moveShipToSpace(activeShip.itemID, TEST_SYSTEM_ID, {
    systemID: TEST_SYSTEM_ID,
    position,
    velocity: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    targetPoint: position,
    mode: "STOP",
    speedFraction: 0,
  });
  assert.equal(moveResult.success, true, "expected active ship to move to test system");
  const activeResult = setActiveShipForCharacter(characterID, activeShip.itemID);
  assert.equal(activeResult.success, true, "expected active ship selection to succeed");
  return registerAttachedSession(
    buildSession(
      characterID,
      moveResult.data,
      position,
    ),
  );
}

function getActiveShowEntries(scene) {
  const controller = scene && scene.remoteRepairShowController;
  return Array.isArray(controller && controller.entries) ? controller.entries : [];
}

function getShipEntity(scene, entityID) {
  const entity = scene && scene.getEntityByID(Number(entityID));
  assert.ok(entity, `expected ship entity ${entityID}`);
  return entity;
}

function getGuidSet(notifications = []) {
  return new Set(
    flattenDestinyUpdates(notifications)
      .filter((entry) => entry.name === "OnSpecialFX")
      .map((entry) => String(entry.args[5] || "")),
  );
}

function countEntriesByRole(entries = [], role) {
  return entries.filter((entry) => String(entry && entry.role || "") === String(role || "")).length;
}

function countCapitalEntries(entries = []) {
  return entries.filter((entry) => {
    const role = String(entry && entry.role || "");
    return role === "anchor" || role === "super";
  }).length;
}

function countFighterEntriesByParentRole(entries = [], role) {
  return entries.filter((entry) => String(entry && entry.parentRole || "") === String(role || "")).length;
}

function countActiveCommandShips(scene, entries = []) {
  return entries.filter((entry) => {
    const entity = scene && scene.getEntityByID(Number(entry && entry.entityID));
    return Boolean(
      entity &&
      entity.activeModuleEffects instanceof Map &&
      entity.activeModuleEffects.size > 0,
    );
  }).length;
}

function countActiveCommandModules(scene, entries = []) {
  return entries.reduce((total, entry) => {
    const entity = scene && scene.getEntityByID(Number(entry && entry.entityID));
    const activeCount =
      entity && entity.activeModuleEffects instanceof Map
        ? entity.activeModuleEffects.size
        : 0;
    return total + activeCount;
  }, 0);
}

test.afterEach(() => {
  for (const session of registeredSessions.splice(0)) {
    sessionRegistry.unregister(session);
  }
  spaceRuntime._testing.clearScenes();
});

test("RemoteRepShow fighter sync does not flip a settled orbit back into follow every movement tick", () => {
  const {
    syncFighterEntryMovement,
  } = remoteRepairShowRuntime._testing;
  const calls = [];
  const fighterEntity = {
    itemID: 91001,
    kind: "fighter",
    position: { x: 5_000, y: 0, z: 0 },
    radius: 0,
    mode: "ORBIT",
    targetEntityID: 91002,
    orbitDistance: 5_000,
    followRange: 5_000,
  };
  const parentEntity = {
    itemID: 91002,
    kind: "ship",
    position: { x: 0, y: 0, z: 0 },
    radius: 0,
  };
  const scene = {
    getEntityByID(entityID) {
      if (Number(entityID) === fighterEntity.itemID) {
        return fighterEntity;
      }
      if (Number(entityID) === parentEntity.itemID) {
        return parentEntity;
      }
      return null;
    },
    followShipEntity(entity, targetEntityID, range) {
      calls.push({
        name: "follow",
        entityID: Number(entity && entity.itemID),
        targetEntityID: Number(targetEntityID),
        range: Number(range),
      });
      fighterEntity.mode = "FOLLOW";
      fighterEntity.targetEntityID = Number(targetEntityID);
      fighterEntity.followRange = Number(range);
      return true;
    },
    orbitShipEntity(entity, targetEntityID, distanceValue) {
      calls.push({
        name: "orbit",
        entityID: Number(entity && entity.itemID),
        targetEntityID: Number(targetEntityID),
        distanceValue: Number(distanceValue),
      });
      fighterEntity.mode = "ORBIT";
      fighterEntity.targetEntityID = Number(targetEntityID);
      fighterEntity.orbitDistance = Number(distanceValue);
      return true;
    },
  };
  const controller = {
    formationMode: "standard",
  };
  const fighterEntry = {
    entityID: fighterEntity.itemID,
    parentEntityID: parentEntity.itemID,
    orbitDistance: 5_000,
    coverOrbitDistance: 6_500,
    lastOrbitRetuneAtMs: 0,
  };

  syncFighterEntryMovement(scene, controller, fighterEntry, 1_000);
  assert.equal(calls.length, 0, "expected a settled orbiting fighter to remain untouched");

  fighterEntity.mode = "FOLLOW";
  fighterEntity.followRange = 5_000;
  calls.length = 0;
  syncFighterEntryMovement(scene, controller, fighterEntry, 2_000);
  assert.deepEqual(
    calls.map((call) => call.name),
    ["orbit"],
    "expected a following fighter inside its shell to promote into orbit once",
  );

  calls.length = 0;
  syncFighterEntryMovement(scene, controller, fighterEntry, 3_000);
  assert.equal(
    calls.length,
    0,
    "expected the next movement tick to keep the fighter in orbit instead of flipping back to follow",
  );
});

test("RemoteRepShow cover sync does not resend goto commands for tiny drift-only target changes", () => {
  const {
    syncCoverSlotMovement,
  } = remoteRepairShowRuntime._testing;
  const ownerEntity = {
    itemID: 92001,
    kind: "ship",
    position: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
  };
  const supportEntity = {
    itemID: 92002,
    kind: "ship",
    position: { x: 18_000, y: 0, z: 0 },
    mode: "GOTO",
  };
  const scene = {
    getEntityByID(entityID) {
      if (Number(entityID) === ownerEntity.itemID) {
        return ownerEntity;
      }
      if (Number(entityID) === supportEntity.itemID) {
        return supportEntity;
      }
      return null;
    },
    gotoPoint() {
      throw new Error("cover sync should not have resent goto for a tiny target drift");
    },
  };
  const controller = {
    ownerShipID: ownerEntity.itemID,
  };
  const coverEntry = {
    entityID: supportEntity.itemID,
    movementPhaseOffsetMs: 0,
    coverOffsetForwardMeters: 18_000,
    coverOffsetLateralMeters: 0,
    coverOffsetVerticalMeters: 0,
    coverDriftForwardAmplitudeMeters: 0,
    coverDriftLateralAmplitudeMeters: 0,
    coverDriftVerticalAmplitudeMeters: 0,
    coverDriftPeriodMs: 22_000,
    coverHoldRadiusMeters: 1_600,
    coverRefreshIntervalMs: 1_700,
    coverRefreshJitterMs: 300,
    coverRetargetThresholdMeters: 640,
    lastCoverCommandAtMs: 1_000,
    lastCoverIssuedTargetPoint: { x: 18_050, y: 0, z: 0 },
  };

  const synced = syncCoverSlotMovement(
    scene,
    controller,
    coverEntry,
    supportEntity,
    3_100,
    {},
  );
  assert.equal(synced, true, "expected cover sync to keep the slot active");
  assert.deepEqual(
    coverEntry.lastCoverTargetPoint,
    { x: 18_000, y: 0, z: 0 },
    "expected the desired cover point to update even when we skip a resend",
  );
});

test("/rr spawns a transient mixed remote-repair fleet that really repairs the player and replaces older fleets cleanly", () => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  try {
    const pilotSession = prepareLiveSpaceSession(
      TEST_CHARACTER_ID,
      { x: 0, y: 0, z: 0 },
    );
    const scene = spaceRuntime.getSceneForSession(pilotSession);
    const playerEntity = getShipEntity(scene, pilotSession._space.shipID);

    const initialResult = executeChatCommand(
      pilotSession,
      "/rr 8",
      null,
      {
        emitChatFeedback: false,
      },
    );
    assert.equal(initialResult.handled, true);
    assert.match(initialResult.message, /Spawned 8 transient remote-repair support hulls/i);

    const initialEntries = getActiveShowEntries(scene);
    assert.equal(initialEntries.length, 8, "expected eight support ships");
    assert.equal(countEntriesByRole(initialEntries, "command"), 1, "expected one command ship at /rr 8");
    const initialEntityIDs = initialEntries.map((entry) => Number(entry.entityID)).sort((left, right) => left - right);
    const initialEntities = initialEntityIDs.map((entityID) => getShipEntity(scene, entityID));
    assert.ok(
      initialEntities.every((entity) => entity.transient === true && entity.nativeNpc === true),
      "expected every /rr ship to be transient and nativeNpc-backed",
    );

    playerEntity.conditionState = {
      ...playerEntity.conditionState,
      shieldCharge: 0.2,
      armorDamage: 0.55,
      damage: 0.45,
    };
    playerEntity.capacitorChargeRatio = 0.1;

    for (let index = 0; index < 80; index += 1) {
      advanceScene(scene, 500);
    }
    flushDirectDestinyNotifications(scene);

    assert.ok(
      Number(playerEntity.conditionState.shieldCharge) > 0.2,
      "expected remote shield reps to raise player shield",
    );
    assert.ok(
      Number(playerEntity.conditionState.armorDamage) < 0.55,
      "expected remote armor reps to reduce player armor damage",
    );
    assert.ok(
      Number(playerEntity.conditionState.damage) < 0.45,
      "expected remote hull reps to reduce player hull damage",
    );
    assert.ok(
      Number(playerEntity.capacitorChargeRatio) > 0.1,
      "expected remote capacitor transfers to raise player capacitor",
    );

    const activeTargetingPlayer = initialEntities.filter((entity) => (
      entity.activeModuleEffects instanceof Map &&
      [...entity.activeModuleEffects.values()].some((effectState) => (
        Number(effectState && effectState.targetID) === Number(playerEntity.itemID)
      ))
    ));
    assert.ok(
      activeTargetingPlayer.length >= 4,
      "expected multiple support hulls to spend spare reps on the player",
    );

    const guidSet = getGuidSet(pilotSession.notifications);
    assert.ok(guidSet.has("effects.RemoteArmourRepair"), "expected remote armor FX");
    assert.ok(guidSet.has("effects.ShieldTransfer"), "expected remote shield FX");
    assert.ok(guidSet.has("effects.EnergyTransfer"), "expected remote capacitor FX");
    assert.ok(guidSet.has("effects.RemoteHullRepair"), "expected remote hull FX");
    assert.ok(guidSet.has("effects.WarfareLinkSphereArmor"), "expected command-burst source FX");
    assert.ok(guidSet.has("effects.WarfareLinkArmor"), "expected command-burst target FX");
    assert.ok(
      pilotSession.notifications.some((entry) => entry && entry.name === "OnDbuffUpdated"),
      "expected burst dbuff updates on the player session",
    );

    pilotSession.notifications.length = 0;
    const replacementResult = executeChatCommand(
      pilotSession,
      "/rr 6",
      null,
      {
        emitChatFeedback: false,
      },
    );
    assert.equal(replacementResult.handled, true);
    assert.match(replacementResult.message, /Spawned 6 transient remote-repair support hulls/i);
    assert.match(replacementResult.message, /Replaced 8 older support hulls/i);

    const replacementEntries = getActiveShowEntries(scene);
    assert.equal(replacementEntries.length, 6, "expected replacement /rr fleet size");
    assert.equal(countEntriesByRole(replacementEntries, "command"), 1, "expected one command ship at /rr 6");
    const replacementIDs = replacementEntries.map((entry) => Number(entry.entityID));
    for (const removedID of initialEntityIDs) {
      assert.equal(
        scene.getEntityByID(removedID),
        null,
        `expected stale support hull ${removedID} to be cleaned up`,
      );
    }
    assert.ok(
      replacementIDs.every((entityID) => !initialEntityIDs.includes(entityID)),
      "expected replacement fleet to use new entity IDs",
    );
  } finally {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.flushAllSync();
  }
});

test("/rr supports the full 1-100 range without falling back to the old 5-10 clamp", () => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  try {
    const pilotSession = prepareLiveSpaceSession(
      TEST_CHARACTER_ID,
      { x: 0, y: 0, z: 0 },
    );
    const scene = spaceRuntime.getSceneForSession(pilotSession);

    const maxFleetResult = executeChatCommand(
      pilotSession,
      "/rr 100",
      null,
      {
        emitChatFeedback: false,
      },
    );
    assert.equal(maxFleetResult.handled, true);
    assert.match(maxFleetResult.message, /Spawned 100 transient remote-repair support hulls/i);
    assert.doesNotMatch(maxFleetResult.message, /clamped/i);

    const maxEntries = getActiveShowEntries(scene);
    assert.equal(maxEntries.length, 100, "expected /rr 100 to keep all one hundred hulls");
    assert.equal(countEntriesByRole(maxEntries, "command"), 3, "expected /rr 100 to cap command ships at three");
    assert.equal(countEntriesByRole(maxEntries, "anchor"), 6, "expected /rr 100 to scale carrier anchors");
    assert.equal(countEntriesByRole(maxEntries, "super"), 6, "expected /rr 100 to scale supercarriers");
    assert.equal(countCapitalEntries(maxEntries), 12, "expected /rr 100 to scale to a real capital backbone");
    assert.equal(
      new Set(maxEntries.map((entry) => Number(entry.entityID))).size,
      100,
      "expected one hundred unique transient entities",
    );
    const leftSupportCount = maxEntries.filter((entry) => entry.wing === "left" && entry.role !== "command").length;
    const rightSupportCount = maxEntries.filter((entry) => entry.wing === "right" && entry.role !== "command").length;
    assert.ok(
      Math.abs(leftSupportCount - rightSupportCount) <= 1,
      "expected the armor/shield support wings to stay near-balanced at 100 ships",
    );

    const defaultFleetResult = executeChatCommand(
      pilotSession,
      "/rr 10",
      null,
      {
        emitChatFeedback: false,
      },
    );
    assert.equal(defaultFleetResult.handled, true);
    assert.match(defaultFleetResult.message, /Command ships: 2\./i);
    const defaultEntries = getActiveShowEntries(scene);
    assert.equal(
      countEntriesByRole(defaultEntries, "command"),
      2,
      "expected the default ten-ship slice to include two command ships",
    );
    assert.equal(
      countCapitalEntries(defaultEntries),
      4,
      "expected the default ten-ship slice to keep the original four-capital backbone",
    );

    const scaledCapitalFleetResult = executeChatCommand(
      pilotSession,
      "/rr 32",
      null,
      {
        emitChatFeedback: false,
      },
    );
    assert.equal(scaledCapitalFleetResult.handled, true);
    assert.match(scaledCapitalFleetResult.message, /Spawned 32 transient remote-repair support hulls/i);
    const scaledCapitalEntries = getActiveShowEntries(scene);
    assert.equal(
      countEntriesByRole(scaledCapitalEntries, "command"),
      3,
      "expected /rr 32 to include the capped three command ships",
    );
    assert.equal(
      countCapitalEntries(scaledCapitalEntries),
      8,
      "expected /rr 32 to scale capitals beyond the old four-hull ceiling",
    );

    for (let index = 0; index < 8; index += 1) {
      advanceScene(scene, 500);
    }
    flushDirectDestinyNotifications(scene);

    const minimumFleetResult = executeChatCommand(
      pilotSession,
      "/rr 1",
      null,
      {
        emitChatFeedback: false,
      },
    );
    assert.equal(minimumFleetResult.handled, true);
    assert.match(minimumFleetResult.message, /Spawned 1 transient remote-repair support hulls/i);
    assert.doesNotMatch(minimumFleetResult.message, /clamped/i);
    assert.match(minimumFleetResult.message, /Armor wing: 1\. Shield wing: 0\. Command ships: 0\./i);

    const minimumEntries = getActiveShowEntries(scene);
    assert.equal(minimumEntries.length, 1, "expected /rr 1 to keep a single support hull");
    assert.equal(minimumEntries[0].wing, "left");
    assert.equal(countEntriesByRole(minimumEntries, "command"), 0);
  } finally {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.flushAllSync();
  }
});

test("/rr staggers command bursts and keeps the support shell moving instead of freezing in place", () => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  try {
    const pilotSession = prepareLiveSpaceSession(
      TEST_CHARACTER_ID,
      { x: 0, y: 0, z: 0 },
    );
    const scene = spaceRuntime.getSceneForSession(pilotSession);

    const result = executeChatCommand(
      pilotSession,
      "/rr 10",
      null,
      {
        emitChatFeedback: false,
      },
    );
    assert.equal(result.handled, true);

    const initialEntries = getActiveShowEntries(scene);
    const commandEntries = initialEntries.filter((entry) => entry.role === "command");
    assert.equal(commandEntries.length, 2, "expected the default /rr slice to include two command ships");

    const commandActivationTimes = commandEntries.flatMap((entry) => (
      Array.isArray(entry.modulePlans)
        ? entry.modulePlans
          .filter((plan) => plan && plan.targetless === true)
          .map((plan) => Number(plan.notBeforeAtMs) || 0)
        : []
    ));
    assert.ok(
      new Set(commandActivationTimes).size > 1,
      "expected command bursts to have staggered activation times",
    );

    const leftAnchorEntry = initialEntries.find((entry) => entry.key === "leftAnchor");
    const rightAnchorEntry = initialEntries.find((entry) => entry.key === "rightAnchor");
    assert.ok(leftAnchorEntry, "expected a left anchor entry");
    assert.ok(rightAnchorEntry, "expected a right anchor entry");

    const leftAnchorEntity = getShipEntity(scene, leftAnchorEntry.entityID);
    const rightAnchorEntity = getShipEntity(scene, rightAnchorEntry.entityID);
    const leftAnchorStart = cloneValue(leftAnchorEntity.position);
    const rightAnchorStart = cloneValue(rightAnchorEntity.position);

    const logiEntry = initialEntries.find((entry) => entry.role === "logi");
    assert.ok(logiEntry, "expected at least one logistics entry");
    const initialResolvedOrbitDistance = Number(logiEntry.lastResolvedOrbitDistance) || 0;

    for (let index = 0; index < 1; index += 1) {
      advanceScene(scene, 500);
    }

    assert.notEqual(leftAnchorEntity.mode, "STOP", "expected the left anchor to enter drift movement");
    assert.notEqual(rightAnchorEntity.mode, "STOP", "expected the right anchor to enter drift movement");
    assert.equal(
      countActiveCommandShips(scene, commandEntries),
      1,
      "expected only one command ship to be active on the first burst phase",
    );
    const firstPhaseActiveModules = countActiveCommandModules(scene, commandEntries);
    assert.ok(
      firstPhaseActiveModules >= 1,
      "expected the first burst phase to light at least one command-burst module",
    );

    for (let index = 0; index < 8; index += 1) {
      advanceScene(scene, 500);
    }

    assert.ok(
      distanceBetweenPositions(leftAnchorStart, leftAnchorEntity.targetPoint) > 100,
      "expected the left anchor to receive a moving drift target instead of staying parked",
    );
    assert.ok(
      distanceBetweenPositions(rightAnchorStart, rightAnchorEntity.targetPoint) > 100,
      "expected the right anchor to receive a moving drift target instead of staying parked",
    );

    const updatedLogiEntry = getActiveShowEntries(scene).find((entry) => entry.key === logiEntry.key);
    assert.ok(updatedLogiEntry, "expected the logi entry to remain registered");
    assert.notEqual(
      Number(updatedLogiEntry.lastResolvedOrbitDistance) || 0,
      initialResolvedOrbitDistance,
      "expected pulsed orbit choreography to retune the logistics ring distance over time",
    );
  } finally {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.flushAllSync();
  }
});

test("/rr cover pushes supercarriers into a forward cover screen with carriers and support stacked behind", () => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  try {
    const pilotSession = prepareLiveSpaceSession(
      TEST_CHARACTER_ID,
      { x: 0, y: 0, z: 0 },
    );
    const scene = spaceRuntime.getSceneForSession(pilotSession);

    const spawnResult = executeChatCommand(
      pilotSession,
      "/rr 10",
      null,
      {
        emitChatFeedback: false,
      },
    );
    assert.equal(spawnResult.handled, true);

    const coverResult = executeChatCommand(
      pilotSession,
      "/rr cover",
      null,
      {
        emitChatFeedback: false,
      },
    );
    assert.equal(coverResult.handled, true);
    assert.match(coverResult.message, /cover pattern engaged/i);

    const coverEntries = getActiveShowEntries(scene);
    assert.ok(
      coverEntries.every((entry) => String(entry && entry.movementProfile || "") === "coverSlot"),
      "expected every /rr entry to swap into the dedicated cover movement profile",
    );

    const averageForwardOffset = (role) => {
      const matching = coverEntries.filter((entry) => String(entry && entry.role || "") === role);
      assert.ok(matching.length > 0, `expected ${role} entries in the cover formation`);
      return matching.reduce(
        (sum, entry) => sum + (Number(entry && entry.coverOffsetForwardMeters) || 0),
        0,
      ) / matching.length;
    };

    const superForward = averageForwardOffset("super");
    const anchorForward = averageForwardOffset("anchor");
    const logiForward = averageForwardOffset("logi");
    assert.ok(
      superForward > anchorForward && anchorForward > logiForward,
      "expected supers forward, anchors behind them, and logistics stacked furthest back",
    );

    for (let index = 0; index < 6; index += 1) {
      advanceScene(scene, 500);
    }

    const superEntry = coverEntries.find((entry) => entry.role === "super" && entry.wing === "left");
    const anchorEntry = coverEntries.find((entry) => entry.role === "anchor" && entry.wing === "left");
    assert.ok(superEntry, "expected a left supercarrier entry");
    assert.ok(anchorEntry, "expected a left carrier entry");

    const superEntity = getShipEntity(scene, superEntry.entityID);
    const anchorEntity = getShipEntity(scene, anchorEntry.entityID);
    assert.ok(
      Number(superEntity.targetPoint && superEntity.targetPoint.x || 0) >
        Number(anchorEntity.targetPoint && anchorEntity.targetPoint.x || 0),
      "expected the supercarrier screen to receive a farther-forward movement target than the carrier line",
    );
  } finally {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.flushAllSync();
  }
});

test("/rr fighter launches full transient squadrons from the active capital tubes and keeps them scoped to the show controller", () => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  try {
    const pilotSession = prepareLiveSpaceSession(
      TEST_CHARACTER_ID,
      { x: 0, y: 0, z: 0 },
    );
    const scene = spaceRuntime.getSceneForSession(pilotSession);

    const spawnResult = executeChatCommand(
      pilotSession,
      "/rr 10",
      null,
      {
        emitChatFeedback: false,
      },
    );
    assert.equal(spawnResult.handled, true);

    const fighterResult = executeChatCommand(
      pilotSession,
      "/rr fighter",
      null,
      {
        emitChatFeedback: false,
      },
    );
    assert.equal(fighterResult.handled, true);
    assert.match(fighterResult.message, /Launched 18 transient fighter squadrons/i);

    const controller = scene && scene.remoteRepairShowController;
    const fighterEntries = Array.isArray(controller && controller.fighterEntries)
      ? controller.fighterEntries
      : [];
    assert.equal(fighterEntries.length, 18, "expected all fighter-capable capital tubes to deploy");
    assert.equal(
      countFighterEntriesByParentRole(fighterEntries, "super"),
      10,
      "expected the two supercarriers to launch all ten of their tubes",
    );
    assert.equal(
      countFighterEntriesByParentRole(fighterEntries, "anchor"),
      8,
      "expected the two carriers to launch all eight of their tubes",
    );

    const fighterEntities = fighterEntries.map((entry) => scene.getEntityByID(Number(entry.entityID)));
    assert.ok(
      fighterEntities.every((entity) => entity && entity.kind === "fighter"),
      "expected every deployed /rr fighter entry to materialize as a fighter entity",
    );
    assert.ok(
      fighterEntities.every((entity) => Number(entity && entity.squadronSize || 0) === 6),
      "expected every /rr fighter squadron to launch at full size",
    );

    for (let index = 0; index < 6; index += 1) {
      advanceScene(scene, 500);
    }

    assert.ok(
      fighterEntries.some((entry) => (Number(entry && entry.lastResolvedOrbitDistance) || 0) > 0),
      "expected the show controller to keep the launched fighter squadrons moving around their capital anchors",
    );

    const coverResult = executeChatCommand(
      pilotSession,
      "/rr cover",
      null,
      {
        emitChatFeedback: false,
      },
    );
    assert.equal(coverResult.handled, true);
    for (let index = 0; index < 4; index += 1) {
      advanceScene(scene, 500);
    }

    const superFighterEntry = fighterEntries.find((entry) => entry.parentRole === "super");
    assert.ok(superFighterEntry, "expected at least one supercarrier fighter entry");
    assert.ok(
      Number(superFighterEntry.coverOrbitDistance || 0) > Number(superFighterEntry.orbitDistance || 0),
      "expected cover mode to widen the supercarrier fighter screen rather than reusing the base orbit shell",
    );
  } finally {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.flushAllSync();
  }
});
