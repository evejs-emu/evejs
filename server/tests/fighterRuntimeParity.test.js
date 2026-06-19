const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const shipDestruction = require(path.join(
  repoRoot,
  "server/src/space/shipDestruction",
));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));
const FighterMgrService = require(path.join(
  repoRoot,
  "server/src/services/fighter/fighterMgrService",
));
const {
  disconnectCharacterSession,
} = require(path.join(
  repoRoot,
  "server/src/services/_shared/sessionDisconnect",
));
const {
  getFighterAbilitySlots,
} = require(path.join(
  repoRoot,
  "server/src/services/fighter/fighterAbilities",
));
const {
  applyCharacterToSession,
  getActiveShipRecord,
  getCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const crimewatchState = require(path.join(
  repoRoot,
  "server/src/services/security/crimewatchState",
));
const {
  ITEM_FLAGS,
  findItemById,
  grantItemToCharacterLocation,
  listContainerItems,
  removeInventoryItem,
  resetInventoryStoreForTests,
  updateShipItem,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  resolveItemByName,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemTypeRegistry",
));

const TEST_SYSTEM_ID = 30000142;
const transientItemIDs = [];
const registeredSessions = [];
const shipSnapshots = new Map();
let itemsTableSnapshot = null;

function getActiveShipCandidate() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Failed to read characters");

  const candidates = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .map((characterID) => ({
      characterID,
      characterRecord: getCharacterRecord(characterID),
      ship: getActiveShipRecord(characterID),
    }))
    .filter((entry) => entry.characterRecord && entry.ship);

  assert.ok(candidates.length > 0, "Expected at least one active character ship");
  return candidates[0];
}

function getActiveShipCandidates() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Failed to read characters");

  const candidates = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .map((characterID) => ({
      characterID,
      characterRecord: getCharacterRecord(characterID),
      ship: getActiveShipRecord(characterID),
    }))
    .filter((entry) => entry.characterRecord && entry.ship);

  assert.ok(candidates.length > 0, "Expected at least one active character ship");
  return candidates;
}

function buildSession(candidate) {
  return {
    clientID: candidate.characterID + 98100,
    userid: candidate.characterID,
    characterID: candidate.characterID,
    charid: candidate.characterID,
    charID: candidate.characterID,
    characterName: candidate.characterRecord.characterName || `char-${candidate.characterID}`,
    corporationID: Number(candidate.characterRecord.corporationID || 0),
    allianceID: Number(candidate.characterRecord.allianceID || 0),
    warFactionID: Number(candidate.characterRecord.warFactionID || candidate.characterRecord.factionID || 0),
    solarsystemid: TEST_SYSTEM_ID,
    solarsystemid2: TEST_SYSTEM_ID,
    socket: { destroyed: false },
    notifications: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
    sendSessionChange() {},
  };
}

function snapshotShip(shipItem) {
  const shipID = Number(shipItem && shipItem.itemID) || 0;
  if (shipID <= 0 || shipSnapshots.has(shipID)) {
    return;
  }
  shipSnapshots.set(shipID, JSON.parse(JSON.stringify(shipItem)));
}

function snapshotItemsTable() {
  const itemsResult = database.read("items", "/");
  assert.equal(itemsResult.success, true, "Expected items table snapshot");
  itemsTableSnapshot = JSON.parse(JSON.stringify(itemsResult.data || {}));
}

function registerSession(session) {
  registeredSessions.push(session);
  sessionRegistry.register(session);
}

function attachSessionToScene(session, shipRecord) {
  const shipItem = {
    ...shipRecord,
    spaceState: {
      systemID: TEST_SYSTEM_ID,
      position: { x: -107303362560, y: -18744975360, z: 436489052160 },
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      targetPoint: { x: -107303362560, y: -18744975360, z: 436489052160 },
      mode: "STOP",
      speedFraction: 0,
    },
  };
  snapshotShip(shipRecord);
  const entity = spaceRuntime.attachSession(session, shipItem, {
    systemID: TEST_SYSTEM_ID,
    broadcast: false,
    spawnStopped: true,
    initialStateSent: false,
    emitSimClockRebase: false,
  });
  assert.ok(entity, "Expected fighter test session to attach in space");
  return entity;
}

function promoteShip(candidate, shipTypeName) {
  const shipType = resolveItemByName(shipTypeName);
  assert.equal(shipType && shipType.success, true, `Expected ${shipTypeName} metadata`);
  const updateResult = updateShipItem(candidate.ship.itemID, (currentItem) => ({
    ...currentItem,
    typeID: Number(shipType.match.typeID),
    groupID: Number(shipType.match.groupID || currentItem.groupID || 0),
    categoryID: Number(shipType.match.categoryID || currentItem.categoryID || 6),
  }));
  assert.equal(updateResult.success, true, `Expected promotion to ${shipTypeName}`);
  candidate.ship = getActiveShipRecord(candidate.characterID);
  return candidate.ship;
}

function grantTransientFighter(candidate, typeName = "Templar I", quantity = 9) {
  const fighterType = resolveItemByName(typeName);
  assert.equal(fighterType && fighterType.success, true, `Expected ${typeName} metadata`);
  const grantResult = grantItemToCharacterLocation(
    candidate.characterID,
    candidate.ship.itemID,
    ITEM_FLAGS.FIGHTER_BAY,
    fighterType.match,
    quantity,
    { transient: true },
  );
  assert.equal(grantResult.success, true, "Expected transient fighter grant");
  const item = grantResult.data && grantResult.data.items && grantResult.data.items[0];
  assert.ok(item && item.itemID, "Expected granted fighter item");
  transientItemIDs.push(Number(item.itemID) || 0);
  return item;
}

function getTupleListRows(value) {
  if (!(value && value.type === "list" && Array.isArray(value.items))) {
    return [];
  }

  return value.items.map((row) => {
    if (row && row.type === "list" && Array.isArray(row.items)) {
      return row.items;
    }
    return row;
  });
}

function getDictEntries(value) {
  return value && value.type === "dict" && Array.isArray(value.entries)
    ? value.entries
    : [];
}

function findNotification(session, name) {
  return session.notifications.find((entry) => entry && entry.name === name) || null;
}

function clearShipBayItemsByType(characterID, shipID, flagID, typeID) {
  for (const item of listContainerItems(characterID, shipID, flagID)) {
    if (Number(item && item.typeID) !== Number(typeID)) {
      continue;
    }
    removeInventoryItem(item.itemID, { removeContents: true });
  }
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

function flushDeferredNotifications() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function advanceScene(scene, deltaMs) {
  const baseWallclock = Math.max(
    Number(scene.lastWallclockTickAt) || 0,
    Number(scene.getCurrentWallclockMs()) || 0,
    Number(scene.getCurrentSimTimeMs()) || 0,
  );
  scene.tick(baseWallclock + Math.max(0, Number(deltaMs) || 0));
}

function finishInitialBallpark(session) {
  assert.equal(
    spaceRuntime.ensureInitialBallpark(session),
    true,
    "Expected fighter parity session to finish initial ballpark bootstrap",
  );
  session.notifications.length = 0;
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
        stamp: Array.isArray(item) ? item[0] : null,
        name: payload[0],
        args: Array.isArray(payload[1]) ? payload[1] : [],
      });
    }
  }
  return updates;
}

function getMarshalDictEntry(value, key) {
  const normalizedValue =
    value && value.type === "object" && value.args
      ? value.args
      : value;
  if (!normalizedValue || normalizedValue.type !== "dict" || !Array.isArray(normalizedValue.entries)) {
    return undefined;
  }
  const entry = normalizedValue.entries.find(
    (candidate) => Array.isArray(candidate) && candidate[0] === key,
  );
  return entry ? entry[1] : undefined;
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

function getRemoveBallsEntityIDs(update) {
  if (!update || update.name !== "RemoveBalls" || !Array.isArray(update.args)) {
    return [];
  }

  const firstArg = update.args[0];
  if (Array.isArray(firstArg)) {
    return firstArg.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry));
  }
  if (firstArg && firstArg.type === "list" && Array.isArray(firstArg.items)) {
    return firstArg.items
      .map((entry) => Number(entry))
      .filter((entry) => Number.isFinite(entry));
  }
  return [];
}

function getSpecialFxEvents(notifications = [], predicate = null) {
  return flattenDestinyUpdates(notifications).filter((entry) => (
    entry.name === "OnSpecialFX" &&
    (typeof predicate !== "function" || predicate(entry))
  ));
}

function getSlimItemChanges(updates, entityID) {
  return updates
    .filter((update) => update && update.name === "OnSlimItemChange")
    .filter((update) => Number(update.args && update.args[0]) === Number(entityID))
    .map((update) => update.args[1])
    .filter(Boolean);
}

function unwrapMarshalNumber(value) {
  if (
    value &&
    typeof value === "object" &&
    Object.prototype.hasOwnProperty.call(value, "value")
  ) {
    return Number(value.value);
  }
  if (
    value &&
    typeof value === "object" &&
    Array.isArray(value.args) &&
    value.args.length > 0
  ) {
    return Number(value.args[0]);
  }
  return Number(value);
}

test.afterEach(() => {
  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  if (scene && typeof scene.setTimeDilation === "function") {
    scene.setTimeDilation(1, {
      syncSessions: false,
    });
  }
  for (const session of registeredSessions.splice(0)) {
    try {
      spaceRuntime.detachSession(session, { broadcast: false });
    } catch (error) {
      void error;
    }
    sessionRegistry.unregister(session);
  }
  for (const itemID of transientItemIDs) {
    if (scene) {
      scene.removeDynamicEntity(itemID, {
        broadcast: false,
        allowSessionOwned: true,
      });
    }
  }
  for (const [shipID, snapshot] of shipSnapshots.entries()) {
    updateShipItem(shipID, snapshot);
  }
  shipSnapshots.clear();
  for (const itemID of transientItemIDs.splice(0)) {
    removeInventoryItem(itemID, { removeContents: true });
  }
  if (itemsTableSnapshot) {
    database.write("items", "/", itemsTableSnapshot);
    itemsTableSnapshot = null;
  }
  crimewatchState.clearAllCrimewatchState();
  resetInventoryStoreForTests();
});

test("fighterMgr launches fighters into real in-space squadrons and reports fightersInSpace", { concurrency: false }, () => {
  snapshotItemsTable();
  resetInventoryStoreForTests();
  const candidate = getActiveShipCandidate();
  const session = buildSession(candidate);

  applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  registerSession(session);
  promoteShip(candidate, "Thanatos");
  attachSessionToScene(session, candidate.ship);

  const service = new FighterMgrService();
  const fighterItem = grantTransientFighter(candidate);
  const loaded = service.Handle_LoadFightersToTube(
    [fighterItem.itemID, ITEM_FLAGS.FIGHTER_TUBE_0],
    session,
    {},
  );
  assert.equal(loaded, true, "Expected launch tube load before launching fighters");

  session.notifications.length = 0;
  const launchResult = service.Handle_LaunchFightersFromTubes(
    [[ITEM_FLAGS.FIGHTER_TUBE_0]],
    session,
    {},
  );
  assert.equal(launchResult.type, "dict");
  assert.deepEqual(getDictEntries(launchResult), []);

  const scene = spaceRuntime.getSceneForSession(session);
  const fighterEntity = scene.getEntityByID(fighterItem.itemID);
  assert.ok(fighterEntity, "Expected fighter entity in space after launch");
  assert.equal(fighterEntity.kind, "fighter");
  assert.equal(Number(fighterEntity.controllerID), Number(candidate.ship.itemID));
  assert.equal(Number(fighterEntity.tubeFlagID), ITEM_FLAGS.FIGHTER_TUBE_0);

  const fightersForShip = service.Handle_GetFightersForShip([], session, {});
  assert.equal(getTupleListRows(fightersForShip[0]).length, 0, "Tube should be empty after launch");
  assert.deepEqual(getTupleListRows(fightersForShip[1]), [[
    ITEM_FLAGS.FIGHTER_TUBE_0,
    Number(fighterItem.itemID),
    Number(fighterItem.typeID),
    9,
  ]]);
  assert.equal(getDictEntries(fightersForShip[2]).length, 1, "Expected one ability-state entry per fighter in space");

  assert.ok(findNotification(session, "OnFighterTubeContentEmpty"), "Expected tube empty notification on launch");
  assert.ok(findNotification(session, "OnFighterAddedToController"), "Expected in-space fighter notification on launch");
  const tubeState = findNotification(session, "OnFighterTubeTaskStatus");
  assert.ok(tubeState, "Expected fighter tube status notification on launch");
  assert.equal(tubeState.payload[1], "INSPACE");
});

test("fighterMgr ability activation emits real client slot notifications and GetFightersForShip cooldown payloads", { concurrency: false }, async () => {
  snapshotItemsTable();
  resetInventoryStoreForTests();
  const candidate = getActiveShipCandidate();
  const session = buildSession(candidate);

  applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  registerSession(session);
  promoteShip(candidate, "Thanatos");
  attachSessionToScene(session, candidate.ship);

  const service = new FighterMgrService();
  const fighterItem = grantTransientFighter(candidate);
  assert.equal(
    service.Handle_LoadFightersToTube([fighterItem.itemID, ITEM_FLAGS.FIGHTER_TUBE_0], session, {}),
    true,
  );
  service.Handle_LaunchFightersFromTubes([[ITEM_FLAGS.FIGHTER_TUBE_0]], session, {});

  session.notifications.length = 0;
  const activateResult = service.Handle_CmdActivateAbilitySlots(
    [[fighterItem.itemID], 1],
    session,
    {},
  );
  assert.equal(activateResult.type, "dict");
  assert.deepEqual(getDictEntries(activateResult), [[Number(fighterItem.itemID), null]]);
  await flushDeferredNotifications();

  const activationNotice = findNotification(session, "OnFighterAbilitySlotActivated");
  assert.ok(activationNotice, "Expected ability activation notification for launched fighters");
  assert.equal(Number(activationNotice.payload[0]), Number(fighterItem.itemID));
  assert.equal(Number(activationNotice.payload[1]), 1);
  assert.ok(
    typeof activationNotice.payload[3] === "number" ||
      typeof activationNotice.payload[3] === "bigint",
    "Expected a translated sim-time filetime payload",
  );
  assert.ok(Number(activationNotice.payload[3]) > 0, "Expected a translated sim-time start timestamp");
  assert.ok(Number(activationNotice.payload[4]) > 0, "Expected a positive fighter ability duration");
  assert.equal(activationNotice.payload[5] && activationNotice.payload[5].type, "list");

  const fightersForShip = service.Handle_GetFightersForShip([], session, {});
  const abilityEntry = getDictEntries(fightersForShip[2]).find(
    (entry) => Number(entry && entry[0]) === Number(fighterItem.itemID),
  );
  assert.ok(abilityEntry, "Expected in-space fighter ability state row");
  const abilitySlotStates = abilityEntry[1];
  assert.equal(abilitySlotStates && abilitySlotStates.type, "list");
  const cooldownStates = abilitySlotStates.items[1];
  const slotCooldown = getMarshalDictEntry(cooldownStates, 1);
  assert.ok(slotCooldown, "Expected cooldown tuple payload for the activated slot");

  session.notifications.length = 0;
  const deactivateResult = service.Handle_CmdDeactivateAbilitySlots(
    [[fighterItem.itemID], 1],
    session,
    {},
  );
  assert.equal(deactivateResult.type, "dict");
  assert.deepEqual(getDictEntries(deactivateResult), [[Number(fighterItem.itemID), null]]);
  await flushDeferredNotifications();

  const deactivationNotice = findNotification(session, "OnFighterAbilitySlotDeactivated");
  assert.ok(deactivationNotice, "Expected ability deactivation notification");
  assert.equal(Number(deactivationNotice.payload[0]), Number(fighterItem.itemID));
  assert.equal(Number(deactivationNotice.payload[1]), 1);
  assert.equal(deactivationNotice.payload[2], null);
});

test("fighterMgr ability activation returns per-fighter error payloads for invalid targets, respects safety, and succeeds for valid targeted activations", { concurrency: false }, async () => {
  snapshotItemsTable();
  resetInventoryStoreForTests();
  const candidates = getActiveShipCandidates();
  assert.ok(candidates.length >= 2, "Expected at least two active ship candidates for fighter target ability parity");
  const controllerCandidate = candidates[0];
  const targetCandidate = candidates.find(
    (entry) => Number(entry.characterID) !== Number(controllerCandidate.characterID),
  );
  assert.ok(targetCandidate, "Expected a second active ship candidate for fighter target ability parity");

  const controllerSession = buildSession(controllerCandidate);
  const targetSession = buildSession(targetCandidate);
  applyCharacterToSession(controllerSession, controllerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  applyCharacterToSession(targetSession, targetCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  registerSession(controllerSession);
  registerSession(targetSession);
  promoteShip(controllerCandidate, "Thanatos");
  attachSessionToScene(controllerSession, controllerCandidate.ship);
  attachSessionToScene(targetSession, targetCandidate.ship);

  const service = new FighterMgrService();
  const fighterItem = grantTransientFighter(controllerCandidate);
  assert.equal(
    service.Handle_LoadFightersToTube(
      [fighterItem.itemID, ITEM_FLAGS.FIGHTER_TUBE_0],
      controllerSession,
      {},
    ),
    true,
  );
  service.Handle_LaunchFightersFromTubes([[ITEM_FLAGS.FIGHTER_TUBE_0]], controllerSession, {});

  const missingTargetResult = service.Handle_CmdActivateAbilitySlots(
    [[fighterItem.itemID], 0, null],
    controllerSession,
    {},
  );
  const missingTargetErrors = getDictEntries(missingTargetResult);
  assert.equal(missingTargetErrors.length, 1, "Expected one missing-target fighter activation error entry");
  assert.equal(Number(missingTargetErrors[0][0]), Number(fighterItem.itemID));
  assert.equal(
    missingTargetErrors[0][1] &&
      missingTargetErrors[0][1].args &&
      missingTargetErrors[0][1].args[0],
    "CannotActivateAbilityRequiresTarget",
  );
  assert.equal(
    Number(
      missingTargetErrors[0][1] &&
        missingTargetErrors[0][1].args &&
        missingTargetErrors[0][1].args[1] &&
        missingTargetErrors[0][1].args[1].fighterTypeID,
    ),
    Number(fighterItem.typeID),
  );

  const invalidResult = service.Handle_CmdActivateAbilitySlots(
    [[fighterItem.itemID], 0, 999999999],
    controllerSession,
    {},
  );
  const invalidErrors = getDictEntries(invalidResult);
  assert.equal(invalidErrors.length, 1, "Expected one fighter ability activation error entry");
  assert.equal(Number(invalidErrors[0][0]), Number(fighterItem.itemID));
  assert.equal(invalidErrors[0][1] && invalidErrors[0][1].args && invalidErrors[0][1].args[0], "CustomNotify");

  crimewatchState.setSafetyLevel(
    controllerCandidate.characterID,
    crimewatchState.SAFETY_LEVEL_FULL,
  );
  const safetyBlockedResult = service.Handle_CmdActivateAbilitySlots(
    [[fighterItem.itemID], 0, targetCandidate.ship.itemID],
    controllerSession,
    {},
  );
  const safetyBlockedErrors = getDictEntries(safetyBlockedResult);
  assert.equal(safetyBlockedErrors.length, 1, "Expected one fighter safety activation error entry");
  assert.equal(
    safetyBlockedErrors[0][1] &&
      safetyBlockedErrors[0][1].args &&
      safetyBlockedErrors[0][1].args[0],
    "CannotActivateAbilityViolatesSafety",
  );
  assert.equal(
    Number(
      safetyBlockedErrors[0][1] &&
        safetyBlockedErrors[0][1].args &&
        safetyBlockedErrors[0][1].args[1] &&
        safetyBlockedErrors[0][1].args[1].fighterTypeID,
    ),
    Number(fighterItem.typeID),
  );

  crimewatchState.setSafetyLevel(
    controllerCandidate.characterID,
    crimewatchState.SAFETY_LEVEL_NONE,
  );
  controllerSession.notifications.length = 0;
  const validResult = service.Handle_CmdActivateAbilitySlots(
    [[fighterItem.itemID], 0, targetCandidate.ship.itemID],
    controllerSession,
    {},
  );
  assert.deepEqual(getDictEntries(validResult), [[Number(fighterItem.itemID), null]]);
  await flushDeferredNotifications();
  const activationNotice = findNotification(controllerSession, "OnFighterAbilitySlotActivated");
  assert.ok(activationNotice, "Expected targeted fighter ability activation notification");
  assert.equal(Number(activationNotice.payload[0]), Number(fighterItem.itemID));
  assert.equal(Number(activationNotice.payload[1]), 0);
});

test("fighter ECM ability clears locks, restricts relocks to the jammer, and expires cleanly", { concurrency: false }, async () => {
  snapshotItemsTable();
  resetInventoryStoreForTests();
  const candidates = getActiveShipCandidates();
  assert.ok(candidates.length >= 2, "Expected at least two active ship candidates for fighter ECM parity");
  const controllerCandidate = candidates[0];
  const targetCandidate = candidates.find(
    (entry) => Number(entry.characterID) !== Number(controllerCandidate.characterID),
  );
  assert.ok(targetCandidate, "Expected a second active ship candidate for fighter ECM parity");

  const controllerSession = buildSession(controllerCandidate);
  const targetSession = buildSession(targetCandidate);
  applyCharacterToSession(controllerSession, controllerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  applyCharacterToSession(targetSession, targetCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  registerSession(controllerSession);
  registerSession(targetSession);
  promoteShip(controllerCandidate, "Thanatos");
  const controllerEntity = attachSessionToScene(controllerSession, controllerCandidate.ship);
  const targetEntity = attachSessionToScene(targetSession, targetCandidate.ship);
  controllerEntity.position = { x: 1_000_000, y: 0, z: 0 };
  controllerEntity.targetPoint = { ...controllerEntity.position };
  controllerEntity.velocity = { x: 0, y: 0, z: 0 };
  targetEntity.position = { x: 1_002_500, y: 0, z: 0 };
  targetEntity.targetPoint = { ...targetEntity.position };
  targetEntity.velocity = { x: 0, y: 0, z: 0 };
  finishInitialBallpark(controllerSession);
  finishInitialBallpark(targetSession);

  const service = new FighterMgrService();
  const fighterItem = grantTransientFighter(controllerCandidate, "Scarab I");
  assert.equal(
    service.Handle_LoadFightersToTube(
      [fighterItem.itemID, ITEM_FLAGS.FIGHTER_TUBE_0],
      controllerSession,
      {},
    ),
    true,
  );
  service.Handle_LaunchFightersFromTubes([[ITEM_FLAGS.FIGHTER_TUBE_0]], controllerSession, {});

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  scene.__jammerRandom = () => 0;
  const fighterEntity = scene.getEntityByID(fighterItem.itemID);
  assert.ok(fighterEntity, "Expected launched Scarab fighter entity for ECM parity");
  primeTargetLock(targetEntity, controllerEntity, scene);

  const ecmSlot = getFighterAbilitySlots(fighterItem.typeID).find(
    (slot) => slot && String(slot.effectFamily) === "fighterAbilityECM",
  );
  assert.ok(ecmSlot, "Expected Scarab I to expose a targeted ECM ability slot");

  controllerSession.notifications.length = 0;
  targetSession.notifications.length = 0;
  crimewatchState.setSafetyLevel(
    controllerCandidate.characterID,
    crimewatchState.SAFETY_LEVEL_NONE,
  );
  const activateResult = service.Handle_CmdActivateAbilitySlots(
    [[fighterItem.itemID], ecmSlot.slotID, targetCandidate.ship.itemID],
    controllerSession,
    {},
  );
  assert.deepEqual(getDictEntries(activateResult), [[Number(fighterItem.itemID), null]]);
  await flushDeferredNotifications();

  let jamStarted = false;
  for (let step = 0; step < 16; step += 1) {
    advanceScene(scene, 1000);
    if (findNotification(targetSession, "OnJamStart")) {
      jamStarted = true;
      break;
    }
  }

  assert.equal(jamStarted, true, "Expected Scarab ECM to apply a live jam");
  assert.ok(findNotification(targetSession, "OnJamStart"), "Expected target OnJamStart for fighter ECM");
  assert.ok(findNotification(targetSession, "OnEwarStart"), "Expected target OnEwarStart for fighter ECM");
  assert.equal(targetEntity.lockedTargets.size, 0, "Expected fighter ECM to clear the target's active locks");
  assert.ok(
    getSpecialFxEvents(controllerSession.notifications, (entry) => (
      Number(entry.args[0]) === Number(fighterItem.itemID) &&
      Number(entry.args[3]) === Number(targetCandidate.ship.itemID) &&
      String(entry.args[5]) === "effects.ElectronicAttributeModifyTarget"
    )).length > 0,
    "Expected controller session to receive fighter ECM FX",
  );

  const blockedValidation = scene.validateTargetLockRequest(
    targetSession,
    targetEntity,
    controllerEntity,
  );
  assert.equal(blockedValidation.success, false, "Expected fighter ECM to block relocking non-jammer targets");

  const allowedValidation = scene.validateTargetLockRequest(
    targetSession,
    targetEntity,
    fighterEntity,
  );
  assert.equal(allowedValidation.success, true, "Expected fighter ECM to allow locking the active jammer");

  targetSession.notifications.length = 0;
  advanceScene(scene, Number(ecmSlot.durationMs || 0) + 100);
  assert.ok(findNotification(targetSession, "OnJamEnd"), "Expected fighter ECM jam expiry notification");
  assert.ok(findNotification(targetSession, "OnEwarEnd"), "Expected fighter ECM tactical expiry notification");

  const restoredValidation = scene.validateTargetLockRequest(
    targetSession,
    targetEntity,
    controllerEntity,
  );
  assert.equal(restoredValidation.success, true, "Expected normal locking to return after fighter ECM expires");
});

test("fighter bomb abilities respect extracted empire-space restrictions in high security space", { concurrency: false }, () => {
  snapshotItemsTable();
  resetInventoryStoreForTests();
  const candidate = getActiveShipCandidate();
  const session = buildSession(candidate);

  applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  registerSession(session);
  promoteShip(candidate, "Thanatos");
  attachSessionToScene(session, candidate.ship);

  const service = new FighterMgrService();
  const fighterItem = grantTransientFighter(candidate, "Ametat I");
  assert.equal(
    service.Handle_LoadFightersToTube(
      [fighterItem.itemID, ITEM_FLAGS.FIGHTER_TUBE_0],
      session,
      {},
    ),
    true,
  );
  service.Handle_LaunchFightersFromTubes([[ITEM_FLAGS.FIGHTER_TUBE_0]], session, {});

  const result = service.Handle_CmdActivateAbilitySlots(
    [[fighterItem.itemID], 2, { x: 1000100, y: 0, z: 0 }],
    session,
    {},
  );
  const errors = getDictEntries(result);
  assert.equal(errors.length, 1, "Expected one fighter bomb activation error entry");
  assert.equal(Number(errors[0][0]), Number(fighterItem.itemID));
  assert.equal(
    errors[0][1] &&
      errors[0][1].args &&
      errors[0][1].args[0],
    "CantInHighSecSpace",
  );
});

test("fighter bomb abilities return CantInEmpireSpace in low security space", { concurrency: false }, () => {
  snapshotItemsTable();
  resetInventoryStoreForTests();
  const candidate = getActiveShipCandidate();
  const session = buildSession(candidate);

  applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  registerSession(session);
  promoteShip(candidate, "Thanatos");
  attachSessionToScene(session, candidate.ship);

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  scene.system.security = 0.3;

  const service = new FighterMgrService();
  const fighterItem = grantTransientFighter(candidate, "Ametat I");
  assert.equal(
    service.Handle_LoadFightersToTube(
      [fighterItem.itemID, ITEM_FLAGS.FIGHTER_TUBE_0],
      session,
      {},
    ),
    true,
  );
  service.Handle_LaunchFightersFromTubes([[ITEM_FLAGS.FIGHTER_TUBE_0]], session, {});

  const result = service.Handle_CmdActivateAbilitySlots(
    [[fighterItem.itemID], 2, { x: 1000100, y: 0, z: 0 }],
    session,
    {},
  );
  const errors = getDictEntries(result);
  assert.equal(errors.length, 1, "Expected one low-security fighter bomb activation error entry");
  assert.equal(Number(errors[0][0]), Number(fighterItem.itemID));
  assert.equal(
    errors[0][1] &&
      errors[0][1].args &&
      errors[0][1].args[0],
    "CantInEmpireSpace",
  );
});

test("fighterMgr movement commands drive launched fighters through orbit, follow, goto, and stop", { concurrency: false }, () => {
  snapshotItemsTable();
  resetInventoryStoreForTests();
  const candidate = getActiveShipCandidate();
  const session = buildSession(candidate);

  applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  registerSession(session);
  promoteShip(candidate, "Thanatos");
  attachSessionToScene(session, candidate.ship);

  const service = new FighterMgrService();
  const fighterItem = grantTransientFighter(candidate);
  assert.equal(
    service.Handle_LoadFightersToTube([fighterItem.itemID, ITEM_FLAGS.FIGHTER_TUBE_0], session, {}),
    true,
  );
  service.Handle_LaunchFightersFromTubes([[ITEM_FLAGS.FIGHTER_TUBE_0]], session, {});

  const scene = spaceRuntime.getSceneForSession(session);
  const fighterEntity = scene.getEntityByID(fighterItem.itemID);
  assert.ok(fighterEntity, "Expected launched fighter entity for movement checks");

  service.Handle_ExecuteMovementCommandOnFighters(
    [[fighterItem.itemID], "ORBIT", candidate.ship.itemID, 2200],
    session,
    {},
  );
  assert.equal(fighterEntity.mode, "ORBIT");
  assert.equal(Number(fighterEntity.targetEntityID), Number(candidate.ship.itemID));
  assert.equal(Math.round(Number(fighterEntity.orbitDistance)), 2200);

  service.Handle_ExecuteMovementCommandOnFighters(
    [[fighterItem.itemID], "FOLLOW", candidate.ship.itemID, 900],
    session,
    {},
  );
  assert.equal(fighterEntity.mode, "FOLLOW");
  assert.equal(Number(fighterEntity.targetEntityID), Number(candidate.ship.itemID));
  assert.equal(Math.round(Number(fighterEntity.followRange)), 900);

  const gotoPoint = {
    x: fighterEntity.position.x + 4000,
    y: fighterEntity.position.y + 250,
    z: fighterEntity.position.z - 600,
  };
  service.Handle_ExecuteMovementCommandOnFighters(
    [[fighterItem.itemID], "GOTO_POINT", gotoPoint],
    session,
    {},
  );
  assert.equal(fighterEntity.mode, "GOTO");
  assert.equal(Math.round(Number(fighterEntity.targetPoint.x)), Math.round(gotoPoint.x));
  assert.equal(Math.round(Number(fighterEntity.targetPoint.y)), Math.round(gotoPoint.y));
  assert.equal(Math.round(Number(fighterEntity.targetPoint.z)), Math.round(gotoPoint.z));

  service.Handle_ExecuteMovementCommandOnFighters(
    [[fighterItem.itemID], "STOP"],
    session,
    {},
  );
  assert.equal(fighterEntity.mode, "STOP");
});

test("fighterMgr recalls fighters back into their launch tube and restores tube payloads", { concurrency: false }, () => {
  snapshotItemsTable();
  resetInventoryStoreForTests();
  const candidate = getActiveShipCandidate();
  const session = buildSession(candidate);

  applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  registerSession(session);
  promoteShip(candidate, "Thanatos");
  attachSessionToScene(session, candidate.ship);

  const service = new FighterMgrService();
  const fighterItem = grantTransientFighter(candidate);
  assert.equal(
    service.Handle_LoadFightersToTube([fighterItem.itemID, ITEM_FLAGS.FIGHTER_TUBE_0], session, {}),
    true,
  );
  service.Handle_LaunchFightersFromTubes([[ITEM_FLAGS.FIGHTER_TUBE_0]], session, {});

  session.notifications.length = 0;
  const recallResult = service.Handle_RecallFightersToTubes(
    [[fighterItem.itemID]],
    session,
    {},
  );
  assert.equal(recallResult.type, "dict");
  assert.deepEqual(getDictEntries(recallResult), [[Number(fighterItem.itemID), null]]);

  const scene = spaceRuntime.getSceneForSession(session);
  const recalledEntity = scene.getEntityByID(fighterItem.itemID);
  assert.ok(recalledEntity, "Expected recalled fighter to remain in space until the next runtime tick");
  assert.equal(recalledEntity.fighterCommand, "RECALL_TUBE");
  spaceRuntime.tick();
  assert.equal(scene.getEntityByID(fighterItem.itemID), null, "Expected recalled fighter to leave local space after the next runtime tick");

  const tubeContents = listContainerItems(
    candidate.characterID,
    candidate.ship.itemID,
    ITEM_FLAGS.FIGHTER_TUBE_0,
  );
  assert.equal(tubeContents.some((item) => Number(item.itemID) === Number(fighterItem.itemID)), true);

  const fightersForShip = service.Handle_GetFightersForShip([], session, {});
  assert.deepEqual(getTupleListRows(fightersForShip[0]), [[
    ITEM_FLAGS.FIGHTER_TUBE_0,
    Number(fighterItem.itemID),
    Number(fighterItem.typeID),
    9,
  ]]);
  assert.equal(getTupleListRows(fightersForShip[1]).length, 0, "Expected no in-space fighter rows after recall");

  assert.ok(findNotification(session, "OnFighterRemovedFromController"), "Expected fighter removed notification on recall");
  assert.ok(findNotification(session, "OnFighterTubeContentUpdate"), "Expected tube content update on recall");
  const tubeState = session.notifications
    .filter((entry) => entry && entry.name === "OnFighterTubeTaskStatus")
    .at(-1);
  assert.ok(tubeState, "Expected tube state transition on recall");
  assert.equal(tubeState.payload[1], "READY");
});

test("fighterMgr abandon and scoop paths clear controller state and return abandoned fighters to bay", { concurrency: false }, () => {
  snapshotItemsTable();
  resetInventoryStoreForTests();
  const candidate = getActiveShipCandidate();
  const session = buildSession(candidate);

  applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  registerSession(session);
  promoteShip(candidate, "Thanatos");
  attachSessionToScene(session, candidate.ship);

  const service = new FighterMgrService();
  const fighterItem = grantTransientFighter(candidate);
  assert.equal(
    service.Handle_LoadFightersToTube([fighterItem.itemID, ITEM_FLAGS.FIGHTER_TUBE_0], session, {}),
    true,
  );
  service.Handle_LaunchFightersFromTubes([[ITEM_FLAGS.FIGHTER_TUBE_0]], session, {});

  session.notifications.length = 0;
  assert.equal(service.Handle_CmdAbandonFighter([fighterItem.itemID], session, {}), true);

  const scene = spaceRuntime.getSceneForSession(session);
  const fighterEntity = scene.getEntityByID(fighterItem.itemID);
  assert.ok(fighterEntity, "Expected abandoned fighter to remain in space");
  assert.equal(Number(fighterEntity.controllerID || 0), 0);
  assert.equal(Number(fighterEntity.launcherID || 0), 0);
  assert.ok(findNotification(session, "OnFighterRemovedFromController"), "Expected controller removal notification on abandon");

  assert.equal(
    service.Handle_CmdScoopAbandonedFighterFromSpace(
      [fighterItem.itemID, ITEM_FLAGS.FIGHTER_BAY],
      session,
      {},
    ),
    true,
  );
  assert.equal(scene.getEntityByID(fighterItem.itemID), null, "Expected scooped abandoned fighter to leave space");

  const fighterRecord = findItemById(fighterItem.itemID);
  assert.ok(fighterRecord, "Expected fighter inventory record after scoop");
  assert.equal(Number(fighterRecord.locationID), Number(candidate.ship.itemID));
  assert.equal(Number(fighterRecord.flagID), ITEM_FLAGS.FIGHTER_BAY);
});

test("jump-style detach abandons controlled fighters immediately instead of waiting for a later scene tick", { concurrency: false }, () => {
  snapshotItemsTable();
  resetInventoryStoreForTests();
  const candidates = getActiveShipCandidates();
  assert.ok(candidates.length >= 2, "Expected at least two active ship candidates for fighter jump parity");
  const controllerCandidate = candidates[0];
  const observerCandidate = candidates.find(
    (entry) => Number(entry.characterID) !== Number(controllerCandidate.characterID),
  );
  assert.ok(observerCandidate, "Expected an observer candidate");

  const controllerSession = buildSession(controllerCandidate);
  const observerSession = buildSession(observerCandidate);
  applyCharacterToSession(controllerSession, controllerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  applyCharacterToSession(observerSession, observerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  registerSession(controllerSession);
  registerSession(observerSession);
  promoteShip(controllerCandidate, "Thanatos");
  attachSessionToScene(controllerSession, controllerCandidate.ship);
  attachSessionToScene(observerSession, observerCandidate.ship);
  finishInitialBallpark(controllerSession);
  finishInitialBallpark(observerSession);

  const service = new FighterMgrService();
  const fighterItem = grantTransientFighter(controllerCandidate, "Templar I");
  assert.equal(
    service.Handle_LoadFightersToTube([fighterItem.itemID, ITEM_FLAGS.FIGHTER_TUBE_0], controllerSession, {}),
    true,
  );
  assert.deepEqual(
    getDictEntries(
      service.Handle_LaunchFightersFromTubes([[ITEM_FLAGS.FIGHTER_TUBE_0]], controllerSession, {}),
    ),
    [],
  );

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  controllerSession.notifications.length = 0;
  observerSession.notifications.length = 0;

  spaceRuntime.detachSession(controllerSession, {
    broadcast: true,
    lifecycleReason: "stargate-jump",
  });

  const abandonedFighter = scene.getEntityByID(fighterItem.itemID);
  assert.ok(abandonedFighter, "Expected jump detach to leave the fighter squadron abandoned in space");
  assert.equal(Number(abandonedFighter.controllerID || 0), 0);
  assert.equal(Number(abandonedFighter.controllerOwnerID || 0), 0);
  assert.equal(Number(abandonedFighter.launcherID || 0), 0);
  assert.equal(Number(abandonedFighter.tubeFlagID || 0), 0);

  assert.ok(
    findNotification(controllerSession, "OnFighterRemovedFromController"),
    "Expected jump detach to emit fighter controller-removal cleanup before the ship leaves the scene",
  );

  const observerUpdates = flattenDestinyUpdates(observerSession.notifications);
  assert.equal(
    observerUpdates.some(
      (entry) => getRemoveBallsEntityIDs(entry).includes(Number(fighterItem.itemID)),
    ),
    false,
    "Expected abandoned jump-detach fighters to remain in observer ballparks instead of being removed",
  );
});

test("disconnect-style session cleanup recalls nearby launched fighters into tubes and removes them from observer ballparks", { concurrency: false }, () => {
  snapshotItemsTable();
  resetInventoryStoreForTests();
  const candidates = getActiveShipCandidates();
  assert.ok(candidates.length >= 2, "Expected at least two active ship candidates for fighter disconnect parity");
  const controllerCandidate = candidates[0];
  const observerCandidate = candidates.find(
    (entry) => Number(entry.characterID) !== Number(controllerCandidate.characterID),
  );
  assert.ok(observerCandidate, "Expected an observer candidate");

  const controllerSession = buildSession(controllerCandidate);
  const observerSession = buildSession(observerCandidate);
  applyCharacterToSession(controllerSession, controllerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  applyCharacterToSession(observerSession, observerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  registerSession(controllerSession);
  registerSession(observerSession);
  promoteShip(controllerCandidate, "Thanatos");
  attachSessionToScene(controllerSession, controllerCandidate.ship);
  attachSessionToScene(observerSession, observerCandidate.ship);
  finishInitialBallpark(controllerSession);
  finishInitialBallpark(observerSession);

  const service = new FighterMgrService();
  const fighterItem = grantTransientFighter(controllerCandidate, "Templar I");
  assert.equal(
    service.Handle_LoadFightersToTube([fighterItem.itemID, ITEM_FLAGS.FIGHTER_TUBE_0], controllerSession, {}),
    true,
  );
  assert.deepEqual(
    getDictEntries(
      service.Handle_LaunchFightersFromTubes([[ITEM_FLAGS.FIGHTER_TUBE_0]], controllerSession, {}),
    ),
    [],
  );

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  controllerSession.notifications.length = 0;
  observerSession.notifications.length = 0;

  const disconnectResult = disconnectCharacterSession(controllerSession, {
    broadcast: true,
    clearSession: false,
    lifecycleReason: "disconnect",
  });
  assert.equal(disconnectResult && disconnectResult.success, true, "Expected disconnect-style cleanup to succeed");

  assert.equal(scene.getEntityByID(fighterItem.itemID), null, "Expected disconnect recall to remove the fighter squadron ball");
  const recalledFighter = findItemById(fighterItem.itemID);
  assert.ok(recalledFighter, "Expected disconnect recall to preserve the fighter inventory item");
  assert.equal(Number(recalledFighter.locationID), Number(controllerCandidate.ship.itemID));
  assert.equal(Number(recalledFighter.flagID), ITEM_FLAGS.FIGHTER_TUBE_0);

  assert.ok(
    findNotification(controllerSession, "OnFighterRemovedFromController"),
    "Expected disconnect recall to emit fighter controller-removal cleanup",
  );
  const readyTubeNotify = controllerSession.notifications.find((entry) => (
    entry &&
    entry.name === "OnFighterTubeTaskStatus" &&
    Array.isArray(entry.payload) &&
    Number(entry.payload[0]) === ITEM_FLAGS.FIGHTER_TUBE_0 &&
    entry.payload[1] === "READY"
  ));
  assert.ok(readyTubeNotify, "Expected disconnect recall to restore the originating tube to READY");

  const observerUpdates = flattenDestinyUpdates(observerSession.notifications);
  assert.ok(
    observerUpdates.some(
      (entry) => getRemoveBallsEntityIDs(entry).includes(Number(fighterItem.itemID)),
    ),
    "Expected already-ballparked observers to receive RemoveBalls when disconnect recall pulls the fighter back into tube",
  );
});

test("same-scene ship destruction abandons launched fighters before the hull is removed", { concurrency: false }, () => {
  snapshotItemsTable();
  resetInventoryStoreForTests();
  const candidates = getActiveShipCandidates();
  assert.ok(candidates.length >= 2, "Expected at least two active ship candidates for fighter ship destruction parity");
  const controllerCandidate = candidates[0];
  const observerCandidate = candidates.find(
    (entry) => Number(entry.characterID) !== Number(controllerCandidate.characterID),
  );
  assert.ok(observerCandidate, "Expected an observer candidate");

  const controllerSession = buildSession(controllerCandidate);
  const observerSession = buildSession(observerCandidate);
  applyCharacterToSession(controllerSession, controllerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  applyCharacterToSession(observerSession, observerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  registerSession(controllerSession);
  registerSession(observerSession);
  promoteShip(controllerCandidate, "Thanatos");
  attachSessionToScene(controllerSession, controllerCandidate.ship);
  attachSessionToScene(observerSession, observerCandidate.ship);
  finishInitialBallpark(controllerSession);
  finishInitialBallpark(observerSession);

  const service = new FighterMgrService();
  const fighterItem = grantTransientFighter(controllerCandidate, "Templar I");
  assert.equal(
    service.Handle_LoadFightersToTube([fighterItem.itemID, ITEM_FLAGS.FIGHTER_TUBE_0], controllerSession, {}),
    true,
  );
  assert.deepEqual(
    getDictEntries(
      service.Handle_LaunchFightersFromTubes([[ITEM_FLAGS.FIGHTER_TUBE_0]], controllerSession, {}),
    ),
    [],
  );

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  controllerSession.notifications.length = 0;
  observerSession.notifications.length = 0;

  const destroyResult = shipDestruction.destroySessionShip(controllerSession, {
    sessionChangeReason: "combat",
  });
  assert.equal(destroyResult && destroyResult.success, true, "Expected same-scene fighter ship destruction to succeed");

  const abandonedFighter = scene.getEntityByID(fighterItem.itemID);
  assert.ok(abandonedFighter, "Expected ship destruction to leave launched fighters abandoned in space");
  assert.equal(Number(abandonedFighter.controllerID || 0), 0);
  assert.equal(Number(abandonedFighter.controllerOwnerID || 0), 0);
  assert.equal(Number(abandonedFighter.launcherID || 0), 0);
  assert.equal(Number(abandonedFighter.tubeFlagID || 0), 0);

  assert.ok(
    findNotification(controllerSession, "OnFighterRemovedFromController"),
    "Expected ship destruction to emit fighter controller-removal cleanup before the hull disappears",
  );

  const observerUpdates = flattenDestinyUpdates(observerSession.notifications);
  assert.equal(
    observerUpdates.some(
      (entry) => getRemoveBallsEntityIDs(entry).includes(Number(fighterItem.itemID)),
    ),
    false,
    "Expected launched fighters to remain in observer ballparks when the controlling hull is destroyed",
  );
});

test("fighterMgr allows foreign abandoned fighter recovery into the scooping carrier fighter bay", { concurrency: false }, () => {
  snapshotItemsTable();
  resetInventoryStoreForTests();
  const candidates = getActiveShipCandidates();
  assert.ok(candidates.length >= 2, "Expected at least two active ship candidates for foreign fighter scoop parity");
  const ownerCandidate = candidates[0];
  const scooperCandidate = candidates.find(
    (entry) => Number(entry.characterID) !== Number(ownerCandidate.characterID),
  );
  assert.ok(scooperCandidate, "Expected a second active ship candidate for foreign fighter scoop parity");

  promoteShip(ownerCandidate, "Thanatos");
  promoteShip(scooperCandidate, "Thanatos");

  const ownerSession = buildSession(ownerCandidate);
  const scooperSession = buildSession(scooperCandidate);
  applyCharacterToSession(ownerSession, ownerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  applyCharacterToSession(scooperSession, scooperCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  registerSession(ownerSession);
  registerSession(scooperSession);
  attachSessionToScene(ownerSession, ownerCandidate.ship);
  attachSessionToScene(scooperSession, scooperCandidate.ship);

  const service = new FighterMgrService();
  const fighterItem = grantTransientFighter(ownerCandidate);
  clearShipBayItemsByType(
    scooperCandidate.characterID,
    scooperCandidate.ship.itemID,
    ITEM_FLAGS.FIGHTER_BAY,
    fighterItem.typeID,
  );

  assert.equal(
    service.Handle_LoadFightersToTube([fighterItem.itemID, ITEM_FLAGS.FIGHTER_TUBE_0], ownerSession, {}),
    true,
  );
  service.Handle_LaunchFightersFromTubes([[ITEM_FLAGS.FIGHTER_TUBE_0]], ownerSession, {});
  assert.equal(service.Handle_CmdAbandonFighter([fighterItem.itemID], ownerSession, {}), true);

  assert.equal(
    service.Handle_CmdScoopAbandonedFighterFromSpace(
      [fighterItem.itemID, ITEM_FLAGS.FIGHTER_BAY],
      scooperSession,
      {},
    ),
    true,
  );

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.equal(scene.getEntityByID(fighterItem.itemID), null, "Expected foreign scooped fighter to leave local space");

  const fighterRecord = findItemById(fighterItem.itemID);
  assert.ok(fighterRecord, "Expected recovered fighter inventory record after foreign scoop");
  assert.equal(Number(fighterRecord.ownerID), Number(scooperCandidate.characterID));
  assert.equal(Number(fighterRecord.locationID), Number(scooperCandidate.ship.itemID));
  assert.equal(Number(fighterRecord.flagID), ITEM_FLAGS.FIGHTER_BAY);
});

test("fighter launch and recall propagate AddBalls2 and RemoveBalls to already-ballparked observers", { concurrency: false }, () => {
  snapshotItemsTable();
  resetInventoryStoreForTests();
  const candidates = getActiveShipCandidates();
  assert.ok(candidates.length >= 2, "Expected at least two active ship candidates for fighter observer parity");
  const controllerCandidate = candidates[0];
  const observerCandidate = candidates.find(
    (entry) => Number(entry.characterID) !== Number(controllerCandidate.characterID),
  );
  assert.ok(observerCandidate, "Expected a second active ship candidate for fighter observer parity");

  const controllerSession = buildSession(controllerCandidate);
  const observerSession = buildSession(observerCandidate);

  applyCharacterToSession(controllerSession, controllerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  applyCharacterToSession(observerSession, observerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  registerSession(controllerSession);
  registerSession(observerSession);
  promoteShip(controllerCandidate, "Thanatos");
  attachSessionToScene(controllerSession, controllerCandidate.ship);
  attachSessionToScene(observerSession, observerCandidate.ship);
  finishInitialBallpark(controllerSession);
  finishInitialBallpark(observerSession);

  const service = new FighterMgrService();
  const fighterItem = grantTransientFighter(controllerCandidate);
  assert.equal(
    service.Handle_LoadFightersToTube(
      [fighterItem.itemID, ITEM_FLAGS.FIGHTER_TUBE_0],
      controllerSession,
      {},
    ),
    true,
  );

  controllerSession.notifications.length = 0;
  observerSession.notifications.length = 0;
  const launchResult = service.Handle_LaunchFightersFromTubes(
    [[ITEM_FLAGS.FIGHTER_TUBE_0]],
    controllerSession,
    {},
  );
  assert.equal(launchResult.type, "dict");
  assert.deepEqual(getDictEntries(launchResult), []);

  const observerLaunchUpdates = flattenDestinyUpdates(observerSession.notifications);
  assert.ok(
    observerLaunchUpdates.some(
      (entry) =>
        entry.name === "AddBalls2" &&
        getAddBalls2EntityIDs(entry).includes(Number(fighterItem.itemID)),
    ),
    "Expected already-ballparked observers to receive AddBalls2 for launched fighters",
  );

  controllerSession.notifications.length = 0;
  observerSession.notifications.length = 0;
  const recallResult = service.Handle_RecallFightersToTubes(
    [[fighterItem.itemID]],
    controllerSession,
    {},
  );
  assert.equal(recallResult.type, "dict");
  assert.deepEqual(getDictEntries(recallResult), [[Number(fighterItem.itemID), null]]);
  spaceRuntime.tick();

  const observerRecallUpdates = flattenDestinyUpdates(observerSession.notifications);
  assert.ok(
    observerRecallUpdates.some(
      (entry) => getRemoveBallsEntityIDs(entry).includes(Number(fighterItem.itemID)),
    ),
    "Expected already-ballparked observers to receive RemoveBalls when fighters land back in tube",
  );
});

test("fighter ability metadata uses extracted client slot ordering, cooldowns, and charge timings", () => {
  const slots = getFighterAbilitySlots(23055);
  assert.equal(slots.length, 3, "Expected three authoritative fighter slots for Templar I");
  assert.deepEqual(
    slots.map((slot) => Number(slot && slot.abilityID)),
    [22, 4, 33],
    "Expected exact client slot ordering for Templar I",
  );
  assert.equal(slots[0].cooldownMs, null, "Expected primary attack slot to remain continuous, not synthetic cooldown gated");
  assert.equal(slots[1].cooldownMs, 60000, "Expected MWD slot cooldown from client authority");
  assert.equal(slots[2].chargeCount, 18, "Expected client charge count for the heavy rocket salvo slot");
  assert.equal(slots[2].rearmTimeMs, 4000, "Expected client rearm timing for the heavy rocket salvo slot");
});

test("fighter offensive slot 0 repeats as a live combat cycle and damages the target ship", { concurrency: false }, () => {
  snapshotItemsTable();
  resetInventoryStoreForTests();
  const candidates = getActiveShipCandidates();
  assert.ok(candidates.length >= 2, "Expected at least two active ship candidates for fighter combat parity");
  const controllerCandidate = candidates[0];
  const targetCandidate = candidates.find(
    (entry) => Number(entry.characterID) !== Number(controllerCandidate.characterID),
  );
  assert.ok(targetCandidate, "Expected a second active ship candidate for fighter combat parity");

  const controllerSession = buildSession(controllerCandidate);
  const targetSession = buildSession(targetCandidate);

  applyCharacterToSession(controllerSession, controllerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  applyCharacterToSession(targetSession, targetCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  registerSession(controllerSession);
  registerSession(targetSession);
  promoteShip(controllerCandidate, "Thanatos");
  const controllerEntity = attachSessionToScene(controllerSession, controllerCandidate.ship);
  const targetEntity = attachSessionToScene(targetSession, targetCandidate.ship);
  controllerEntity.position = { x: 1000000, y: 0, z: 0 };
  controllerEntity.targetPoint = { ...controllerEntity.position };
  controllerEntity.velocity = { x: 0, y: 0, z: 0 };
  targetEntity.position = { x: 1002500, y: 0, z: 0 };
  targetEntity.targetPoint = { ...targetEntity.position };
  targetEntity.velocity = { x: 0, y: 0, z: 0 };
  finishInitialBallpark(controllerSession);
  finishInitialBallpark(targetSession);

  const service = new FighterMgrService();
  const fighterItem = grantTransientFighter(controllerCandidate);
  assert.equal(
    service.Handle_LoadFightersToTube([fighterItem.itemID, ITEM_FLAGS.FIGHTER_TUBE_0], controllerSession, {}),
    true,
  );
  service.Handle_LaunchFightersFromTubes([[ITEM_FLAGS.FIGHTER_TUBE_0]], controllerSession, {});
  controllerSession.notifications.length = 0;
  targetSession.notifications.length = 0;
  crimewatchState.setSafetyLevel(
    controllerCandidate.characterID,
    crimewatchState.SAFETY_LEVEL_NONE,
  );

  const activateErrors = service.Handle_CmdActivateAbilitySlots(
    [[fighterItem.itemID], 0, targetCandidate.ship.itemID],
    controllerSession,
    {},
  );
  assert.deepEqual(getDictEntries(activateErrors), [[Number(fighterItem.itemID), null]], "Expected slot 0 activation to succeed without errors");

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const fighterEntity = scene.getEntityByID(fighterItem.itemID);
  assert.ok(fighterEntity, "Expected launched fighter entity for combat tick");
  const beforeShield = Number(targetEntity.conditionState && targetEntity.conditionState.shieldCharge);
  const slot0Meta = getFighterAbilitySlots(fighterItem.typeID)[0];
  scene.tick(scene.getCurrentWallclockMs() + Number(slot0Meta.durationMs || 0) + 100);

  const afterShield = Number(targetEntity.conditionState && targetEntity.conditionState.shieldCharge);
  assert.ok(afterShield < beforeShield, "Expected slot 0 fighter combat to damage the target ship");
  assert.ok(
    controllerSession.notifications.some((entry) => entry && entry.name === "OnDamageMessage"),
    "Expected the controlling pilot to receive fighter damage combat messages",
  );
  const continuedState = fighterEntity.fighterAbilityStates && fighterEntity.fighterAbilityStates[0];
  assert.ok(
    continuedState && Number(continuedState.activeUntilMs || 0) > scene.getCurrentSimTimeMs(),
    "Expected continuous slot 0 fighter combat to roll into the next cycle instead of deactivating immediately",
  );
});

test("fighter offensive combat FX remain visible to observers under TiDi without backstepping behind live history", { concurrency: false }, () => {
  snapshotItemsTable();
  resetInventoryStoreForTests();
  const candidates = getActiveShipCandidates();
  assert.ok(candidates.length >= 2, "Expected at least two active ship candidates for fighter TiDi parity");
  const controllerCandidate = candidates[0];
  const targetCandidate = candidates.find(
    (entry) => Number(entry.characterID) !== Number(controllerCandidate.characterID),
  );
  assert.ok(targetCandidate, "Expected a second active ship candidate for fighter TiDi parity");

  const controllerSession = buildSession(controllerCandidate);
  const targetSession = buildSession(targetCandidate);
  applyCharacterToSession(controllerSession, controllerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  applyCharacterToSession(targetSession, targetCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  registerSession(controllerSession);
  registerSession(targetSession);
  promoteShip(controllerCandidate, "Thanatos");
  const controllerEntity = attachSessionToScene(controllerSession, controllerCandidate.ship);
  const targetEntity = attachSessionToScene(targetSession, targetCandidate.ship);
  controllerEntity.position = { x: 1_000_000, y: 0, z: 0 };
  controllerEntity.targetPoint = { ...controllerEntity.position };
  controllerEntity.velocity = { x: 0, y: 0, z: 0 };
  targetEntity.position = { x: 1_002_500, y: 0, z: 0 };
  targetEntity.targetPoint = { ...targetEntity.position };
  targetEntity.velocity = { x: 0, y: 0, z: 0 };
  finishInitialBallpark(controllerSession);
  finishInitialBallpark(targetSession);

  const service = new FighterMgrService();
  const fighterItem = grantTransientFighter(controllerCandidate, "Templar I");
  assert.equal(
    service.Handle_LoadFightersToTube([fighterItem.itemID, ITEM_FLAGS.FIGHTER_TUBE_0], controllerSession, {}),
    true,
  );
  service.Handle_LaunchFightersFromTubes([[ITEM_FLAGS.FIGHTER_TUBE_0]], controllerSession, {});

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  scene.setTimeDilation(0.5, {
    syncSessions: false,
  });
  scene.tick(scene.getCurrentWallclockMs() + 4000);

  controllerSession.notifications.length = 0;
  targetSession.notifications.length = 0;
  crimewatchState.setSafetyLevel(
    controllerCandidate.characterID,
    crimewatchState.SAFETY_LEVEL_NONE,
  );
  const activateErrors = service.Handle_CmdActivateAbilitySlots(
    [[fighterItem.itemID], 0, targetCandidate.ship.itemID],
    controllerSession,
    {},
  );
  assert.deepEqual(getDictEntries(activateErrors), [[Number(fighterItem.itemID), null]], "Expected fighter slot 0 activation to succeed under TiDi");

  let wallclockAt = scene.getCurrentWallclockMs();
  let ownerFx = null;
  let observerFx = null;
  let observerVisibleStampAtFx = null;
  for (let step = 0; step < 20; step += 1) {
    wallclockAt += 1000;
    scene.tick(wallclockAt);
    ownerFx = getSpecialFxEvents(
      controllerSession.notifications,
      (entry) => (
        Number(entry.args[0]) === Number(fighterItem.itemID) &&
        Number(entry.args[3]) === Number(targetCandidate.ship.itemID)
      ),
    ).at(-1) || null;
    observerFx = getSpecialFxEvents(
      targetSession.notifications,
      (entry) => (
        Number(entry.args[0]) === Number(fighterItem.itemID) &&
        Number(entry.args[3]) === Number(targetCandidate.ship.itemID)
      ),
    ).at(-1) || null;
    if (ownerFx && observerFx) {
      observerVisibleStampAtFx = scene.getCurrentVisibleSessionDestinyStamp(targetSession);
      break;
    }
  }

  assert.ok(ownerFx, "Expected controller session to receive fighter offensive OnSpecialFX under TiDi");
  assert.ok(observerFx, "Expected already-ballparked observers to receive fighter offensive OnSpecialFX under TiDi");
  assert.ok(
    observerFx.stamp >= observerVisibleStampAtFx,
    "Expected observer fighter combat FX not to backstep behind the live visible stamp under TiDi",
  );
  assert.ok(
    observerFx.stamp <= ((observerVisibleStampAtFx + 1) >>> 0),
    "Expected observer fighter combat FX to stay within the live/next-tick history window under TiDi",
  );
});

test("fighter charge abilities expose full client charge counts, then consume and rearm on the extracted timing", { concurrency: false }, async () => {
  snapshotItemsTable();
  resetInventoryStoreForTests();
  const candidates = getActiveShipCandidates();
  assert.ok(candidates.length >= 2, "Expected at least two active ship candidates for fighter rearm parity");
  const controllerCandidate = candidates[0];
  const targetCandidate = candidates.find(
    (entry) => Number(entry.characterID) !== Number(controllerCandidate.characterID),
  );
  assert.ok(targetCandidate, "Expected a second active ship candidate for fighter rearm parity");

  const controllerSession = buildSession(controllerCandidate);
  const targetSession = buildSession(targetCandidate);
  applyCharacterToSession(controllerSession, controllerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  applyCharacterToSession(targetSession, targetCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  registerSession(controllerSession);
  registerSession(targetSession);
  promoteShip(controllerCandidate, "Thanatos");
  attachSessionToScene(controllerSession, controllerCandidate.ship);
  attachSessionToScene(targetSession, targetCandidate.ship);

  const service = new FighterMgrService();
  const fighterItem = grantTransientFighter(controllerCandidate);
  assert.equal(
    service.Handle_LoadFightersToTube([fighterItem.itemID, ITEM_FLAGS.FIGHTER_TUBE_0], controllerSession, {}),
    true,
  );
  service.Handle_LaunchFightersFromTubes([[ITEM_FLAGS.FIGHTER_TUBE_0]], controllerSession, {});

  let fightersForShip = service.Handle_GetFightersForShip([], controllerSession, {});
  let abilityEntry = getDictEntries(fightersForShip[2]).find(
    (entry) => Number(entry && entry[0]) === Number(fighterItem.itemID),
  );
  let slotStates = abilityEntry && abilityEntry[1];
  let chargeStates = slotStates && slotStates.items ? slotStates.items[0] : null;
  assert.equal(getMarshalDictEntry(chargeStates, 2), 18, "Expected full client charge count before any activation");

  crimewatchState.setSafetyLevel(
    controllerCandidate.characterID,
    crimewatchState.SAFETY_LEVEL_NONE,
  );
  controllerSession.notifications.length = 0;
  const activateResult = service.Handle_CmdActivateAbilitySlots(
    [[fighterItem.itemID], 2, targetCandidate.ship.itemID],
    controllerSession,
    {},
  );
  assert.deepEqual(getDictEntries(activateResult), [[Number(fighterItem.itemID), null]]);
  await flushDeferredNotifications();
  const activationNotice = findNotification(controllerSession, "OnFighterAbilitySlotActivated");
  assert.ok(activationNotice, "Expected slot 2 activation notification");
  assert.equal(Number(activationNotice.payload[2]), 17, "Expected one charge to be consumed immediately on activation");

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const slot2Meta = getFighterAbilitySlots(fighterItem.typeID)[2];
  scene.tick(scene.getCurrentWallclockMs() + Number(slot2Meta.durationMs || 0) + 100);
  fightersForShip = service.Handle_GetFightersForShip([], controllerSession, {});
  abilityEntry = getDictEntries(fightersForShip[2]).find(
    (entry) => Number(entry && entry[0]) === Number(fighterItem.itemID),
  );
  slotStates = abilityEntry && abilityEntry[1];
  chargeStates = slotStates && slotStates.items ? slotStates.items[0] : null;
  assert.equal(getMarshalDictEntry(chargeStates, 2), 17, "Expected the spent charge count to persist while rearming");

  scene.tick(
    scene.getCurrentWallclockMs() +
      Number(slot2Meta.durationMs || 0) +
      Number(slot2Meta.rearmTimeMs || 0) +
      200,
  );
  fightersForShip = service.Handle_GetFightersForShip([], controllerSession, {});
  abilityEntry = getDictEntries(fightersForShip[2]).find(
    (entry) => Number(entry && entry[0]) === Number(fighterItem.itemID),
  );
  slotStates = abilityEntry && abilityEntry[1];
  chargeStates = slotStates && slotStates.items ? slotStates.items[0] : null;
  assert.equal(getMarshalDictEntry(chargeStates, 2), 18, "Expected the extracted rearm timing to restore the missing charge");
});

test("fighter slot 2 salvo abilities apply real combat damage during the activation window", { concurrency: false }, () => {
  snapshotItemsTable();
  resetInventoryStoreForTests();
  const candidates = getActiveShipCandidates();
  assert.ok(candidates.length >= 2, "Expected at least two active ship candidates for fighter salvo parity");
  const controllerCandidate = candidates[0];
  const targetCandidate = candidates.find(
    (entry) => Number(entry.characterID) !== Number(controllerCandidate.characterID),
  );
  assert.ok(targetCandidate, "Expected a second active ship candidate for fighter salvo parity");

  const controllerSession = buildSession(controllerCandidate);
  const targetSession = buildSession(targetCandidate);
  applyCharacterToSession(controllerSession, controllerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  applyCharacterToSession(targetSession, targetCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  registerSession(controllerSession);
  registerSession(targetSession);
  promoteShip(controllerCandidate, "Thanatos");
  const controllerEntity = attachSessionToScene(controllerSession, controllerCandidate.ship);
  const targetEntity = attachSessionToScene(targetSession, targetCandidate.ship);
  controllerEntity.position = { x: 1000000, y: 0, z: 0 };
  controllerEntity.targetPoint = { ...controllerEntity.position };
  controllerEntity.velocity = { x: 0, y: 0, z: 0 };
  targetEntity.position = { x: 1002500, y: 0, z: 0 };
  targetEntity.targetPoint = { ...targetEntity.position };
  targetEntity.velocity = { x: 0, y: 0, z: 0 };

  const service = new FighterMgrService();
  const fighterItem = grantTransientFighter(controllerCandidate, "Templar I");
  assert.equal(
    service.Handle_LoadFightersToTube([fighterItem.itemID, ITEM_FLAGS.FIGHTER_TUBE_0], controllerSession, {}),
    true,
  );
  service.Handle_LaunchFightersFromTubes([[ITEM_FLAGS.FIGHTER_TUBE_0]], controllerSession, {});

  crimewatchState.setSafetyLevel(
    controllerCandidate.characterID,
    crimewatchState.SAFETY_LEVEL_NONE,
  );
  controllerSession.notifications.length = 0;
  targetSession.notifications.length = 0;
  const activateErrors = service.Handle_CmdActivateAbilitySlots(
    [[fighterItem.itemID], 2, targetCandidate.ship.itemID],
    controllerSession,
    {},
  );
  assert.deepEqual(getDictEntries(activateErrors), [[Number(fighterItem.itemID), null]], "Expected slot 2 fighter salvo activation to succeed");

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const fighterEntity = scene.getEntityByID(fighterItem.itemID);
  assert.ok(fighterEntity, "Expected launched fighter entity for slot 2 combat parity");
  const beforeShield = Number(targetEntity.conditionState && targetEntity.conditionState.shieldCharge);
  const slot2Meta = getFighterAbilitySlots(fighterItem.typeID)[2];
  scene.tick(scene.getCurrentWallclockMs() + Number(slot2Meta.durationMs || 0) + 100);

  const afterShield = Number(targetEntity.conditionState && targetEntity.conditionState.shieldCharge);
  assert.ok(afterShield < beforeShield, "Expected slot 2 fighter salvo combat to damage the target ship");
  assert.ok(
    controllerSession.notifications.some((entry) => entry && entry.name === "OnDamageMessage"),
    "Expected the controlling pilot to receive combat messages from slot 2 salvo damage",
  );
  const slotState = fighterEntity.fighterAbilityStates && fighterEntity.fighterAbilityStates[2];
  assert.ok(
    !slotState || Number(slotState.activeUntilMs || 0) <= scene.getCurrentSimTimeMs(),
    "Expected slot 2 salvo abilities to complete the active window instead of rolling as continuous fire",
  );
});

test("fighter member loss emits OnInSpaceSquadronSizeChanged and observer slim updates", { concurrency: false }, () => {
  snapshotItemsTable();
  resetInventoryStoreForTests();
  const candidates = getActiveShipCandidates();
  assert.ok(candidates.length >= 2, "Expected at least two active ship candidates for fighter squadron-loss parity");
  const controllerCandidate = candidates[0];
  const observerCandidate = candidates.find(
    (entry) => Number(entry.characterID) !== Number(controllerCandidate.characterID),
  );
  assert.ok(observerCandidate, "Expected a second active ship candidate for fighter squadron-loss parity");

  const controllerSession = buildSession(controllerCandidate);
  const observerSession = buildSession(observerCandidate);
  applyCharacterToSession(controllerSession, controllerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  applyCharacterToSession(observerSession, observerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  registerSession(controllerSession);
  registerSession(observerSession);
  promoteShip(controllerCandidate, "Thanatos");
  attachSessionToScene(controllerSession, controllerCandidate.ship);
  const observerEntity = attachSessionToScene(observerSession, observerCandidate.ship);
  finishInitialBallpark(controllerSession);
  finishInitialBallpark(observerSession);

  const service = new FighterMgrService();
  const fighterItem = grantTransientFighter(controllerCandidate);
  assert.equal(
    service.Handle_LoadFightersToTube([fighterItem.itemID, ITEM_FLAGS.FIGHTER_TUBE_0], controllerSession, {}),
    true,
  );
  service.Handle_LaunchFightersFromTubes([[ITEM_FLAGS.FIGHTER_TUBE_0]], controllerSession, {});
  controllerSession.notifications.length = 0;
  observerSession.notifications.length = 0;

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const fighterEntity = scene.getEntityByID(fighterItem.itemID);
  assert.ok(fighterEntity, "Expected launched fighter entity for squadron-loss checks");
  const startingSize = Number(fighterEntity.squadronSize || 0);
  assert.ok(startingSize > 1, "Expected a multi-member squadron for size-loss checks");

  for (let index = 0; index < 8 && Number(fighterEntity.squadronSize || 0) === startingSize; index += 1) {
    spaceRuntime.droneInterop.applyWeaponDamageToTarget(
      scene,
      observerEntity,
      fighterEntity,
      { em: 5000 },
      scene.getCurrentSimTimeMs() + index,
    );
  }

  assert.ok(
    Number(fighterEntity.squadronSize || 0) < startingSize,
    "Expected fighter squadron combat damage to remove at least one member",
  );
  const sizeChange = findNotification(controllerSession, "OnInSpaceSquadronSizeChanged");
  assert.ok(sizeChange, "Expected controller notification when the fighter squadron loses members");
  assert.equal(Number(sizeChange.payload[0]), Number(fighterItem.itemID));
  assert.equal(Number(sizeChange.payload[1]), Number(fighterEntity.squadronSize));

  const observerUpdates = flattenDestinyUpdates(observerSession.notifications);
  const slimChanges = getSlimItemChanges(observerUpdates, fighterItem.itemID);
  assert.ok(slimChanges.length > 0, "Expected observer slim refresh when the fighter squadron size changes");
  assert.ok(
    slimChanges.some(
      (slimItem) => Number(getMarshalDictEntry(slimItem, "fighter.squadronSize")) === Number(fighterEntity.squadronSize),
    ),
    "Expected observer slim refresh to carry the fighter.squadronSize payload the client uses for overview/brackets",
  );
});

test("full fighter squadron destruction removes the controller row and sends RemoveBalls to observers", { concurrency: false }, () => {
  snapshotItemsTable();
  resetInventoryStoreForTests();
  const candidates = getActiveShipCandidates();
  assert.ok(candidates.length >= 2, "Expected at least two active ship candidates for fighter death cleanup parity");
  const controllerCandidate = candidates[0];
  const observerCandidate = candidates.find(
    (entry) => Number(entry.characterID) !== Number(controllerCandidate.characterID),
  );
  assert.ok(observerCandidate, "Expected a second active ship candidate for fighter death cleanup parity");

  const controllerSession = buildSession(controllerCandidate);
  const observerSession = buildSession(observerCandidate);
  applyCharacterToSession(controllerSession, controllerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  applyCharacterToSession(observerSession, observerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  registerSession(controllerSession);
  registerSession(observerSession);
  promoteShip(controllerCandidate, "Thanatos");
  attachSessionToScene(controllerSession, controllerCandidate.ship);
  const observerEntity = attachSessionToScene(observerSession, observerCandidate.ship);
  finishInitialBallpark(controllerSession);
  finishInitialBallpark(observerSession);

  const service = new FighterMgrService();
  const fighterItem = grantTransientFighter(controllerCandidate);
  assert.equal(
    service.Handle_LoadFightersToTube([fighterItem.itemID, ITEM_FLAGS.FIGHTER_TUBE_0], controllerSession, {}),
    true,
  );
  service.Handle_LaunchFightersFromTubes([[ITEM_FLAGS.FIGHTER_TUBE_0]], controllerSession, {});
  controllerSession.notifications.length = 0;
  observerSession.notifications.length = 0;

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  let fighterEntity = scene.getEntityByID(fighterItem.itemID);
  assert.ok(fighterEntity, "Expected launched fighter entity before destruction");
  let safetyCounter = 0;
  while (fighterEntity && safetyCounter < 32) {
    spaceRuntime.droneInterop.applyWeaponDamageToTarget(
      scene,
      observerEntity,
      fighterEntity,
      { em: 25000, thermal: 25000, kinetic: 25000, explosive: 25000 },
      scene.getCurrentSimTimeMs() + safetyCounter,
    );
    fighterEntity = scene.getEntityByID(fighterItem.itemID);
    safetyCounter += 1;
  }

  assert.equal(fighterEntity, null, "Expected overwhelming incoming damage to fully destroy the fighter squadron");
  assert.ok(
    findNotification(controllerSession, "OnFighterRemovedFromController"),
    "Expected controller removal notification when the fighter squadron is fully destroyed",
  );

  const observerUpdates = flattenDestinyUpdates(observerSession.notifications);
  assert.ok(
    observerUpdates.some(
      (entry) => getRemoveBallsEntityIDs(entry).includes(Number(fighterItem.itemID)),
    ),
    "Expected already-ballparked observers to receive RemoveBalls when the fighter squadron is destroyed",
  );
});

test("fighter MWD activation emits live FX and SetMaxSpeed updates, then restores base speed on expiry", { concurrency: false }, () => {
  snapshotItemsTable();
  resetInventoryStoreForTests();
  const candidates = getActiveShipCandidates();
  assert.ok(candidates.length >= 2, "Expected at least two active ship candidates for fighter mobility observer parity");
  const controllerCandidate = candidates[0];
  const observerCandidate = candidates.find(
    (entry) => Number(entry.characterID) !== Number(controllerCandidate.characterID),
  );
  assert.ok(observerCandidate, "Expected a second active ship candidate for fighter mobility observer parity");

  const controllerSession = buildSession(controllerCandidate);
  const observerSession = buildSession(observerCandidate);
  applyCharacterToSession(controllerSession, controllerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  applyCharacterToSession(observerSession, observerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  registerSession(controllerSession);
  registerSession(observerSession);
  promoteShip(controllerCandidate, "Thanatos");
  attachSessionToScene(controllerSession, controllerCandidate.ship);
  attachSessionToScene(observerSession, observerCandidate.ship);
  finishInitialBallpark(controllerSession);
  finishInitialBallpark(observerSession);

  const service = new FighterMgrService();
  const fighterItem = grantTransientFighter(controllerCandidate, "Templar I");
  assert.equal(
    service.Handle_LoadFightersToTube([fighterItem.itemID, ITEM_FLAGS.FIGHTER_TUBE_0], controllerSession, {}),
    true,
  );
  service.Handle_LaunchFightersFromTubes([[ITEM_FLAGS.FIGHTER_TUBE_0]], controllerSession, {});

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const fighterEntity = scene.getEntityByID(fighterItem.itemID);
  assert.ok(fighterEntity, "Expected launched fighter entity for MWD parity");
  const baseVelocity = Number(fighterEntity.maxVelocity || 0);
  const slotMeta = getFighterAbilitySlots(fighterItem.typeID)[1];
  assert.equal(Number(slotMeta && slotMeta.abilityID), 4, "Expected slot 1 to be the authoritative fighter MWD slot");

  controllerSession.notifications.length = 0;
  observerSession.notifications.length = 0;
  const activateResult = service.Handle_CmdActivateAbilitySlots(
    [[fighterItem.itemID], 1],
    controllerSession,
    {},
  );
  assert.deepEqual(getDictEntries(activateResult), [[Number(fighterItem.itemID), null]], "Expected fighter MWD activation to succeed");
  assert.ok(
    Number(fighterEntity.maxVelocity || 0) > baseVelocity,
    "Expected active fighter MWD to raise live maxVelocity immediately",
  );

  const controllerUpdates = flattenDestinyUpdates(controllerSession.notifications);
  const observerUpdates = flattenDestinyUpdates(observerSession.notifications);
  assert.ok(
    controllerUpdates.some(
      (entry) =>
        entry.name === "SetMaxSpeed" &&
        Number(entry.args && entry.args[0]) === Number(fighterItem.itemID) &&
        unwrapMarshalNumber(entry.args && entry.args[1]) > baseVelocity,
    ),
    "Expected controller ballpark to receive a raised SetMaxSpeed for fighter MWD",
  );
  assert.ok(
    observerUpdates.some(
      (entry) =>
        entry.name === "SetMaxSpeed" &&
        Number(entry.args && entry.args[0]) === Number(fighterItem.itemID) &&
        unwrapMarshalNumber(entry.args && entry.args[1]) > baseVelocity,
    ),
    "Expected already-ballparked observers to receive the fighter MWD SetMaxSpeed update",
  );
  assert.ok(
    controllerUpdates.some(
      (entry) =>
        entry.name === "OnSpecialFX" &&
        Number(entry.args && entry.args[0]) === Number(fighterItem.itemID) &&
        entry.args[5] === "effects.MicroWarpDrive",
    ),
    "Expected controller ballpark to receive the MWD activation FX",
  );
  assert.ok(
    observerUpdates.some(
      (entry) =>
        entry.name === "OnSpecialFX" &&
        Number(entry.args && entry.args[0]) === Number(fighterItem.itemID) &&
        entry.args[5] === "effects.MicroWarpDrive",
    ),
    "Expected observers to receive the MWD activation FX",
  );

  controllerSession.notifications.length = 0;
  observerSession.notifications.length = 0;
  scene.tick(scene.getCurrentWallclockMs() + Number(slotMeta.durationMs || 0) + 100);
  assert.equal(
    Number(fighterEntity.maxVelocity || 0),
    baseVelocity,
    "Expected fighter MWD expiry to restore the passive fighter speed",
  );
  const expiryUpdates = flattenDestinyUpdates(controllerSession.notifications);
  assert.ok(
    expiryUpdates.some(
      (entry) =>
        entry.name === "SetMaxSpeed" &&
        Number(entry.args && entry.args[0]) === Number(fighterItem.itemID) &&
        Math.abs(unwrapMarshalNumber(entry.args && entry.args[1]) - baseVelocity) < 1e-6,
    ),
    "Expected MWD expiry to broadcast a SetMaxSpeed return to passive speed",
  );
});

test("fighter MJD enforces point range and teleports to the targeted point when the activation completes", { concurrency: false }, () => {
  snapshotItemsTable();
  resetInventoryStoreForTests();
  const candidates = getActiveShipCandidates();
  assert.ok(candidates.length >= 2, "Expected at least two active ship candidates for fighter MJD parity");
  const controllerCandidate = candidates[0];
  const observerCandidate = candidates.find(
    (entry) => Number(entry.characterID) !== Number(controllerCandidate.characterID),
  );
  assert.ok(observerCandidate, "Expected a second active ship candidate for fighter MJD parity");

  const controllerSession = buildSession(controllerCandidate);
  const observerSession = buildSession(observerCandidate);
  applyCharacterToSession(controllerSession, controllerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  applyCharacterToSession(observerSession, observerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  registerSession(controllerSession);
  registerSession(observerSession);
  promoteShip(controllerCandidate, "Thanatos");
  attachSessionToScene(controllerSession, controllerCandidate.ship);
  attachSessionToScene(observerSession, observerCandidate.ship);
  finishInitialBallpark(controllerSession);
  finishInitialBallpark(observerSession);

  const service = new FighterMgrService();
  const fighterItem = grantTransientFighter(controllerCandidate, "Ametat I");
  assert.equal(
    service.Handle_LoadFightersToTube([fighterItem.itemID, ITEM_FLAGS.FIGHTER_TUBE_0], controllerSession, {}),
    true,
  );
  service.Handle_LaunchFightersFromTubes([[ITEM_FLAGS.FIGHTER_TUBE_0]], controllerSession, {});

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const fighterEntity = scene.getEntityByID(fighterItem.itemID);
  assert.ok(fighterEntity, "Expected launched fighter entity for MJD parity");
  const slotMeta = getFighterAbilitySlots(fighterItem.typeID)[1];
  assert.equal(Number(slotMeta && slotMeta.abilityID), 5, "Expected slot 1 to be the authoritative fighter MJD slot");

  const outOfRangePoint = {
    x: Number(fighterEntity.position.x) + Number(slotMeta.rangeMeters || 0) + 5000,
    y: Number(fighterEntity.position.y),
    z: Number(fighterEntity.position.z),
  };
  const outOfRangeResult = service.Handle_CmdActivateAbilitySlots(
    [[fighterItem.itemID], 1, outOfRangePoint],
    controllerSession,
    {},
  );
  const outOfRangeErrors = getDictEntries(outOfRangeResult);
  assert.equal(outOfRangeErrors.length, 1, "Expected one out-of-range MJD error entry");
  assert.equal(Number(outOfRangeErrors[0][0]), Number(fighterItem.itemID));
  assert.equal(
    outOfRangeErrors[0][1] &&
      outOfRangeErrors[0][1].args &&
      outOfRangeErrors[0][1].args[0],
    "CustomNotify",
  );

  const targetPoint = {
    x: Number(fighterEntity.position.x) + Math.max(1000, Math.min(50000, Number(slotMeta.rangeMeters || 0) - 1000)),
    y: Number(fighterEntity.position.y) + 2500,
    z: Number(fighterEntity.position.z),
  };
  controllerSession.notifications.length = 0;
  observerSession.notifications.length = 0;
  const activateResult = service.Handle_CmdActivateAbilitySlots(
    [[fighterItem.itemID], 1, targetPoint],
    controllerSession,
    {},
  );
  assert.deepEqual(getDictEntries(activateResult), [[Number(fighterItem.itemID), null]], "Expected in-range fighter MJD activation to succeed");

  scene.tick(scene.getCurrentWallclockMs() + Number(slotMeta.durationMs || 0) + 100);
  assert.ok(
    Math.abs(Number(fighterEntity.position.x) - Number(targetPoint.x)) < 1e-6 &&
      Math.abs(Number(fighterEntity.position.y) - Number(targetPoint.y)) < 1e-6 &&
      Math.abs(Number(fighterEntity.position.z) - Number(targetPoint.z)) < 1e-6,
    "Expected fighter MJD completion to reposition the in-space squadron to the requested point",
  );
  const observerUpdates = flattenDestinyUpdates(observerSession.notifications);
  assert.ok(
    observerUpdates.some(
      (entry) =>
        entry.name === "SetBallPosition" &&
        Number(entry.args && entry.args[0]) === Number(fighterItem.itemID),
    ),
    "Expected already-ballparked observers to receive the fighter MJD teleport position update",
  );
});

test("fighter evasive maneuvers applies live speed and signature changes, then restores the passive profile on expiry", { concurrency: false }, () => {
  snapshotItemsTable();
  resetInventoryStoreForTests();
  const candidate = getActiveShipCandidate();
  const session = buildSession(candidate);

  applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  registerSession(session);
  promoteShip(candidate, "Thanatos");
  attachSessionToScene(session, candidate.ship);

  const service = new FighterMgrService();
  const fighterItem = grantTransientFighter(candidate, "Equite I");
  assert.equal(
    service.Handle_LoadFightersToTube([fighterItem.itemID, ITEM_FLAGS.FIGHTER_TUBE_0], session, {}),
    true,
  );
  service.Handle_LaunchFightersFromTubes([[ITEM_FLAGS.FIGHTER_TUBE_0]], session, {});

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const fighterEntity = scene.getEntityByID(fighterItem.itemID);
  assert.ok(fighterEntity, "Expected launched fighter entity for evasive maneuver parity");
  const baseVelocity = Number(fighterEntity.maxVelocity || 0);
  const baseSignatureRadius = Number(fighterEntity.signatureRadius || 0);
  const slotMeta = getFighterAbilitySlots(fighterItem.typeID)[1];
  assert.equal(Number(slotMeta && slotMeta.abilityID), 13, "Expected slot 1 to be the authoritative evasive-maneuvers slot");

  const activateResult = service.Handle_CmdActivateAbilitySlots(
    [[fighterItem.itemID], 1],
    session,
    {},
  );
  assert.deepEqual(getDictEntries(activateResult), [[Number(fighterItem.itemID), null]], "Expected fighter evasive maneuvers activation to succeed");
  assert.ok(
    Number(fighterEntity.maxVelocity || 0) !== baseVelocity,
    "Expected evasive maneuvers to modify live fighter speed while active",
  );
  assert.ok(
    Number(fighterEntity.signatureRadius || 0) !== baseSignatureRadius,
    "Expected evasive maneuvers to modify live fighter signature radius while active",
  );

  scene.tick(scene.getCurrentWallclockMs() + Number(slotMeta.durationMs || 0) + 100);
  assert.equal(
    Number(fighterEntity.maxVelocity || 0),
    baseVelocity,
    "Expected evasive maneuvers expiry to restore passive speed",
  );
  assert.equal(
    Number(fighterEntity.signatureRadius || 0),
    baseSignatureRadius,
    "Expected evasive maneuvers expiry to restore passive signature radius",
  );
});
