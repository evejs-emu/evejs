const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const repoRoot = path.join(__dirname, "..", "..");
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));
const destiny = require(path.join(
  repoRoot,
  "server/src/space/destiny",
));
const shipDestruction = require(path.join(
  repoRoot,
  "server/src/space/shipDestruction",
));
const spaceRuntime = require(path.join(
  repoRoot,
  "server/src/space/runtime",
));
const ShipService = require(path.join(
  repoRoot,
  "server/src/services/ship/shipService",
));
const ServiceManager = require(path.join(
  repoRoot,
  "server/src/services/serviceManager",
));
const EntityService = require(path.join(
  repoRoot,
  "server/src/services/drone/entityService",
));
const PacketDispatcher = require(path.join(
  repoRoot,
  "server/src/network/packetDispatcher",
));
const { MACHONETMSG_TYPE } = require(path.join(
  repoRoot,
  "server/src/common/packetTypes",
));
const { encodeAddress } = require(path.join(
  repoRoot,
  "server/src/common/machoAddress",
));
const { decodeAddress } = require(path.join(
  repoRoot,
  "server/src/common/machoAddress",
));
const {
  applyCharacterToSession,
  buildInventoryDogmaPrimeEntry,
  getActiveShipRecord,
  getCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
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
const {
  ensureSceneMiningState,
  getMineableState,
  updateMineableState,
  applyMiningDelta,
} = require(path.join(
  repoRoot,
  "server/src/services/mining/miningRuntimeState",
));
const {
  getAttributeIDByNames,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));
const {
  MINING_HOLD_FLAGS,
} = require(path.join(
  repoRoot,
  "server/src/services/mining/miningInventory",
));
const database = require(path.join(
  repoRoot,
  "server/src/newDatabase",
));
const {
  marshalEncode,
} = require(path.join(
  repoRoot,
  "server/src/network/tcp/utils/marshal",
));

const TEST_SYSTEM_ID = 30000142;
const ORE_TEST_SYSTEM_ID = 30000001;
const TEST_CONSTELLATION_ID = 20000020;
const ATTRIBUTE_DRONE_IS_AGGRESSIVE =
  getAttributeIDByNames("droneIsAggressive", "droneIsAgressive") || 1275;
const ATTRIBUTE_DRONE_FOCUS_FIRE =
  getAttributeIDByNames("droneFocusFire") || 1297;
const transientItemIDs = [];
const registeredSessions = [];
const shipSnapshots = new Map();
const characterSnapshots = new Map();
let itemsTableSnapshot = null;

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

function getActiveShipCandidate() {
  return getActiveShipCandidates()[0];
}

function buildSession(candidate, systemID = TEST_SYSTEM_ID) {
  return {
    clientID: candidate.characterID + 98000,
    userid: candidate.characterID,
    characterID: candidate.characterID,
    charid: candidate.characterID,
    charID: candidate.characterID,
    characterName: candidate.characterRecord.characterName || `char-${candidate.characterID}`,
    corporationID: Number(candidate.characterRecord.corporationID || 0),
    allianceID: Number(candidate.characterRecord.allianceID || 0),
    warFactionID: Number(candidate.characterRecord.warFactionID || candidate.characterRecord.factionID || 0),
    solarsystemid: systemID,
    solarsystemid2: systemID,
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

function snapshotCharacter(characterID) {
  const numericCharacterID = Number(characterID) || 0;
  if (numericCharacterID <= 0 || characterSnapshots.has(numericCharacterID)) {
    return;
  }
  const recordResult = database.read("characters", `/${numericCharacterID}`);
  assert.equal(recordResult.success, true, "Expected character snapshot read to succeed");
  characterSnapshots.set(numericCharacterID, JSON.parse(JSON.stringify(recordResult.data)));
}

function setCharacterDroneSettings(candidate, overrides = {}) {
  snapshotCharacter(candidate.characterID);
  const currentRecord = getCharacterRecord(candidate.characterID);
  assert.ok(currentRecord, "Expected character record for drone settings update");
  const writeResult = database.write(
    "characters",
    `/${candidate.characterID}`,
    {
      ...currentRecord,
      droneSettings: {
        ...(currentRecord.droneSettings || {}),
        ...overrides,
      },
    },
    { silent: true },
  );
  assert.equal(writeResult.success, true, "Expected drone settings write to succeed");
}

function registerSession(session) {
  registeredSessions.push(session);
  sessionRegistry.register(session);
}

function snapshotItemsTable() {
  const itemsResult = database.read("items", "/");
  assert.equal(itemsResult.success, true, "Expected to snapshot items table");
  itemsTableSnapshot = JSON.parse(JSON.stringify(itemsResult.data || {}));
}

function grantSingletonDrone(candidate, typeName = "Hobgoblin I") {
  const droneType = resolveItemByName(typeName);
  assert.equal(droneType && droneType.success, true, `Expected ${typeName} metadata`);
  const grantResult = grantItemToCharacterLocation(
    candidate.characterID,
    candidate.ship.itemID,
    ITEM_FLAGS.DRONE_BAY,
    droneType.match,
    1,
    { transient: true, singleton: true },
  );
  assert.equal(grantResult.success, true, "Expected singleton drone grant");
  const item = grantResult.data && grantResult.data.items && grantResult.data.items[0];
  assert.ok(item && item.itemID, "Expected granted drone item");
  transientItemIDs.push(Number(item.itemID) || 0);
  return item;
}

function setCandidateShipType(candidate, typeName) {
  const shipType = resolveItemByName(typeName);
  assert.equal(shipType && shipType.success, true, `Expected ${typeName} metadata`);
  snapshotShip(candidate.ship);
  const updateResult = updateShipItem(candidate.ship.itemID, (currentItem) => ({
    ...currentItem,
    typeID: Number(shipType.match.typeID),
    groupID: Number(shipType.match.groupID || currentItem.groupID || 0),
    categoryID: Number(shipType.match.categoryID || currentItem.categoryID || 6),
  }));
  assert.equal(updateResult.success, true, "Expected ship promotion to drone hull");
  candidate.ship = getActiveShipRecord(candidate.characterID);
  return candidate.ship;
}

function promoteShipToDroneHull(candidate, typeName = "Myrmidon") {
  return setCandidateShipType(candidate, typeName);
}

function attachSessionToScene(session, shipRecord, systemID = TEST_SYSTEM_ID) {
  const shipItem = {
    ...shipRecord,
    spaceState: {
      systemID,
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
    systemID,
    broadcast: false,
    spawnStopped: true,
    initialStateSent: false,
    emitSimClockRebase: false,
  });
  assert.ok(entity, "Expected session attach to create a ship entity");
  return entity;
}

function findNotification(session, name) {
  const matches = session.notifications.filter((entry) => entry && entry.name === name);
  return matches.length > 0 ? matches[matches.length - 1] : null;
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

function waitForNextTurn(delayMs = 5) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function advanceScene(scene, deltaMs) {
  const baseWallclock = Math.max(
    Number(scene.lastWallclockTickAt) || 0,
    Number(scene.getCurrentWallclockMs()) || 0,
    Number(scene.getCurrentSimTimeMs()) || 0,
  );
  scene.tick(baseWallclock + Math.max(0, Number(deltaMs) || 0));
}

function flushDirectDestinyNotifications(scene) {
  if (scene && typeof scene.flushDirectDestinyNotificationBatch === "function") {
    scene.flushDirectDestinyNotificationBatch();
  }
}

function finishInitialBallpark(session) {
  assert.equal(
    spaceRuntime.ensureInitialBallpark(session),
    true,
    "Expected drone parity session to finish initial ballpark bootstrap",
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

function getMarshalDictEntry(value, key) {
  if (!value || value.type !== "dict" || !Array.isArray(value.entries)) {
    return undefined;
  }
  const match = value.entries.find((entry) => Array.isArray(entry) && entry[0] === key);
  return match ? match[1] : undefined;
}

function getRowsetLines(rowset) {
  if (!rowset || rowset.type !== "object" || !rowset.args) {
    return [];
  }
  const lines = getMarshalDictEntry(rowset.args, "lines");
  return lines && lines.type === "list" && Array.isArray(lines.items) ? lines.items : [];
}

function getMarshalListItems(value) {
  return value && value.type === "list" && Array.isArray(value.items)
    ? value.items
    : [];
}

function findSlimItemByID(slims, itemID) {
  const numericItemID = Number(itemID) || 0;
  return getMarshalListItems(slims).find((entry) => {
    const slimItem = entry && entry.type === "object" ? entry : null;
    const slimArgs = slimItem && slimItem.args ? slimItem.args : null;
    return Number(getMarshalDictEntry(slimArgs, "itemID") || 0) === numericItemID;
  }) || null;
}

function getDamageMessageTotalDamage(notification) {
  const payload = notification && Array.isArray(notification.payload)
    ? notification.payload[0]
    : null;
  return Number(getMarshalDictEntry(payload, "damage") || 0);
}

function assertEmptyDroneCommandResult(result, message = "Expected empty drone command result dict") {
  assert.deepEqual(result, { type: "dict", entries: [] }, message);
}

function assertLaunchResultMap(result, expectedMap, message = "Expected marshal-safe launch result map") {
  assert.ok(result && result.type === "dict" && Array.isArray(result.entries), message);
  const actual = {};
  for (const entry of result.entries) {
    if (!Array.isArray(entry) || entry.length < 2) {
      continue;
    }
    actual[String(entry[0])] = getMarshalListItems(entry[1]);
  }
  const expected = Object.fromEntries(
    Object.entries(expectedMap || {}).map(([key, value]) => [String(key), value]),
  );
  assert.deepEqual(
    Object.keys(actual).sort(),
    Object.keys(expected).sort(),
    message,
  );
  for (const [key, expectedValues] of Object.entries(expected)) {
    const actualValues = Array.isArray(actual[key]) ? actual[key] : [];
    assert.equal(
      actualValues.length,
      Array.isArray(expectedValues) ? expectedValues.length : 0,
      `${message} (${key} length mismatch)`,
    );
    for (let index = 0; index < actualValues.length; index += 1) {
      const expectedValue = expectedValues[index];
      const actualValue = actualValues[index];
      if (typeof expectedValue === "function") {
        assert.equal(
          expectedValue(actualValue),
          true,
          `${message} (${key} entry ${index} predicate failed for ${actualValue})`,
        );
        continue;
      }
      assert.deepEqual(
        actualValue,
        expectedValue,
        `${message} (${key} entry ${index})`,
      );
    }
  }
}

function getOnItemChangeItemIDs(session) {
  return (session && Array.isArray(session.notifications) ? session.notifications : [])
    .filter((entry) => entry && entry.name === "OnItemChange")
    .map((entry) => Number(
      entry &&
      Array.isArray(entry.payload) &&
      entry.payload[0] &&
      entry.payload[0].fields &&
      entry.payload[0].fields.itemID,
    ) || 0)
    .filter((itemID) => itemID > 0);
}

function getOnItemChangeEntryMap(entry) {
  return entry &&
    Array.isArray(entry.payload) &&
    entry.payload[1] &&
    entry.payload[1].type === "dict" &&
    Array.isArray(entry.payload[1].entries)
    ? new Map(entry.payload[1].entries)
    : new Map();
}

function getOnGodmaPrimeItemIDs(session) {
  return (session && Array.isArray(session.notifications) ? session.notifications : [])
    .filter((entry) => entry && entry.name === "OnGodmaPrimeItem")
    .map((entry) => {
      const primeEntries =
        entry &&
        Array.isArray(entry.payload) &&
        entry.payload[1] &&
        entry.payload[1].args &&
        Array.isArray(entry.payload[1].args.entries)
          ? new Map(entry.payload[1].args.entries)
          : null;
      return Number(primeEntries && primeEntries.get("itemID")) || 0;
    })
    .filter((itemID) => itemID > 0);
}

function findNotificationIndex(session, predicate) {
  const notifications = session && Array.isArray(session.notifications)
    ? session.notifications
    : [];
  return notifications.findIndex((entry) => predicate(entry));
}

function getTotalQuantityInShipByType(characterID, shipID, typeID) {
  const itemsResult = database.read("items", "/");
  assert.equal(itemsResult.success, true, "Expected to read items table");
  return Object.values(itemsResult.data || {})
    .filter((item) => (
      Number(item && item.locationID) === Number(shipID) &&
      Number(item && item.typeID) === Number(typeID)
    ))
    .reduce(
      (sum, item) => sum + Math.max(0, Number(item && (item.stacksize ?? item.quantity) || 0)),
      0,
    );
}

function getShipItemCountByType(shipID, typeID) {
  const itemsResult = database.read("items", "/");
  assert.equal(itemsResult.success, true, "Expected to read items table");
  return Object.values(itemsResult.data || {})
    .filter((item) => (
      Number(item && item.locationID) === Number(shipID) &&
      Number(item && item.typeID) === Number(typeID)
    ))
    .length;
}

function getTotalQuantityInShipByTypeAndFlag(shipID, typeID, flagID) {
  const itemsResult = database.read("items", "/");
  assert.equal(itemsResult.success, true, "Expected to read items table");
  return Object.values(itemsResult.data || {})
    .filter((item) => (
      Number(item && item.locationID) === Number(shipID) &&
      Number(item && item.typeID) === Number(typeID) &&
      Number(item && item.flagID) === Number(flagID)
    ))
    .reduce(
      (sum, item) => sum + Math.max(0, Number(item && (item.stacksize ?? item.quantity) || 0)),
      0,
    );
}

function findMineableEntryByKind(scene, yieldKind) {
  const normalizedYieldKind = String(yieldKind || "").trim().toLowerCase();
  return scene.staticEntities
    .map((entity) => ({
      entity,
      state: getMineableState(scene, entity && entity.itemID),
    }))
    .find((entry) => (
      entry.entity &&
      entry.state &&
      String(entry.state.yieldKind || "").trim().toLowerCase() === normalizedYieldKind &&
      Number(entry.state.remainingQuantity) > 0
    )) || null;
}

function runDroneMiningScenario(options = {}) {
  const systemID = Math.max(1, Number(options.systemID) || TEST_SYSTEM_ID);
  const shipTypeName = String(options.shipTypeName || "Myrmidon");
  const droneTypeName = String(options.droneTypeName || "Mining Drone I");
  const yieldKind = String(options.yieldKind || "ore");
  const tickAdvanceMs = Math.max(1, Number(options.tickAdvanceMs) || 65_000);
  const maxSteps = Math.max(1, Number(options.maxSteps) || 6);
  const expectedFlagID = Number(options.expectedFlagID) || 0;
  const targetRemainingQuantity = Number(options.targetRemainingQuantity);

  resetInventoryStoreForTests();
  snapshotItemsTable();
  const candidate = getActiveShipCandidate();
  promoteShipToDroneHull(candidate, shipTypeName);
  const session = buildSession(candidate, systemID);
  const shipService = new ShipService();
  const entityService = new EntityService();
  const droneItem = grantSingletonDrone(candidate, droneTypeName);

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  registerSession(session);
  const shipEntity = attachSessionToScene(session, candidate.ship, systemID);
  const scene = spaceRuntime.ensureScene(systemID);
  ensureSceneMiningState(scene);

  const asteroidEntry = findMineableEntryByKind(scene, yieldKind);
  assert.ok(asteroidEntry, `Expected at least one mineable ${yieldKind} target in the test system`);
  if (Number.isFinite(targetRemainingQuantity) && targetRemainingQuantity > 0) {
    const clampedRemainingQuantity = Math.max(1, Math.trunc(targetRemainingQuantity));
    const updateResult = updateMineableState(
      scene,
      asteroidEntry.entity,
      {
        ...asteroidEntry.state,
        originalQuantity: Math.max(
          Number(asteroidEntry.state.originalQuantity) || 0,
          clampedRemainingQuantity,
        ),
        remainingQuantity: clampedRemainingQuantity,
      },
      { broadcast: false },
    );
    assert.equal(updateResult.success, true, "Expected test mineable quantity override to succeed");
    asteroidEntry.state = getMineableState(scene, asteroidEntry.entity.itemID);
  }

  const shipPosition = {
    x: Number(asteroidEntry.entity.position.x) + Number(asteroidEntry.entity.radius || 0) + 900,
    y: Number(asteroidEntry.entity.position.y),
    z: Number(asteroidEntry.entity.position.z),
  };
  const shipTeleport = spaceRuntime.teleportDynamicEntityToPoint(
    systemID,
    shipEntity.itemID,
    shipPosition,
    {
      broadcast: false,
      direction: { x: -1, y: 0, z: 0 },
    },
  );
  assert.equal(shipTeleport && shipTeleport.success, true);
  finishInitialBallpark(session);

  const yieldTypeID = Number(asteroidEntry.state.yieldTypeID);
  const initialTotalQuantity = getTotalQuantityInShipByType(
    candidate.characterID,
    candidate.ship.itemID,
    yieldTypeID,
  );
  const initialStackCount = getShipItemCountByType(
    candidate.ship.itemID,
    yieldTypeID,
  );
  const initialFlagQuantity = expectedFlagID > 0
    ? getTotalQuantityInShipByTypeAndFlag(
      candidate.ship.itemID,
      yieldTypeID,
      expectedFlagID,
    )
    : 0;
  const initialRemainingQuantity = Number(asteroidEntry.state.remainingQuantity);

  shipService.Handle_LaunchDrones([[[droneItem.itemID, 1]]], session, {});
  session.notifications.length = 0;

  const commandResult = entityService.Handle_CmdMineRepeatedly(
    [[droneItem.itemID], asteroidEntry.entity.itemID],
    session,
    {},
  );
  assertEmptyDroneCommandResult(commandResult);

  if (options.skipMiningTicks === true) {
    return {
      candidate,
      session,
      shipEntity,
      scene,
      droneItem,
      asteroidEntry,
      droneEntity: scene.getEntityByID(droneItem.itemID),
      updatedMineableState: getMineableState(scene, asteroidEntry.entity.itemID),
      yieldTypeID,
      initialTotalQuantity,
      finalTotalQuantity: initialTotalQuantity,
      initialStackCount,
      finalStackCount: initialStackCount,
      initialFlagQuantity,
      finalFlagQuantity: initialFlagQuantity,
      initialRemainingQuantity,
      receivedInventorySync: false,
    };
  }

  let wallclockAt = scene.getCurrentWallclockMs();
  let droneEntity = null;
  let updatedMineableState = null;
  let finalTotalQuantity = initialTotalQuantity;
  let finalStackCount = initialStackCount;
  let finalFlagQuantity = initialFlagQuantity;
  let receivedInventorySync = false;
  for (let step = 0; step < maxSteps; step += 1) {
    wallclockAt += tickAdvanceMs;
    scene.tick(wallclockAt);
    droneEntity = scene.getEntityByID(droneItem.itemID);
    updatedMineableState = getMineableState(scene, asteroidEntry.entity.itemID);
    finalTotalQuantity = getTotalQuantityInShipByType(
      candidate.characterID,
      candidate.ship.itemID,
      yieldTypeID,
    );
    finalStackCount = getShipItemCountByType(
      candidate.ship.itemID,
      yieldTypeID,
    );
    finalFlagQuantity = expectedFlagID > 0
      ? getTotalQuantityInShipByTypeAndFlag(
        candidate.ship.itemID,
        yieldTypeID,
        expectedFlagID,
      )
      : initialFlagQuantity;
    receivedInventorySync = session.notifications.some(
      (entry) => entry && entry.name === "OnItemChange",
    );
    if (
      finalTotalQuantity > initialTotalQuantity ||
      finalStackCount > initialStackCount ||
      finalFlagQuantity > initialFlagQuantity ||
      receivedInventorySync
    ) {
      break;
    }
  }

  return {
    candidate,
    session,
    shipEntity,
    scene,
    droneItem,
    asteroidEntry,
    droneEntity,
    updatedMineableState,
    yieldTypeID,
    initialTotalQuantity,
    finalTotalQuantity,
    initialStackCount,
    finalStackCount,
    initialFlagQuantity,
    finalFlagQuantity,
    initialRemainingQuantity,
    receivedInventorySync,
  };
}

function clearShipBayItemsByType(characterID, shipID, flagID, typeID) {
  for (const item of listContainerItems(characterID, shipID, flagID)) {
    if (Number(item && item.typeID) !== Number(typeID)) {
      continue;
    }
    removeInventoryItem(item.itemID, { removeContents: true });
  }
}

function stageShipsForLocalCombat(systemID, controllerShipEntity, hostileEntities = []) {
  const stagingOrigin = {
    x: Number(controllerShipEntity.position.x) + 5_000_000,
    y: Number(controllerShipEntity.position.y),
    z: Number(controllerShipEntity.position.z),
  };
  const controllerTeleport = spaceRuntime.teleportDynamicEntityToPoint(
    systemID,
    controllerShipEntity.itemID,
    stagingOrigin,
    {
      broadcast: false,
      direction: { x: 1, y: 0, z: 0 },
    },
  );
  assert.equal(controllerTeleport && controllerTeleport.success, true);

  hostileEntities.forEach((entity, index) => {
    entity.signatureRadius = Math.max(
      Number(entity.signatureRadius || 0),
      500,
    );
    entity.radius = Math.max(
      Number(entity.radius || 0),
      120,
    );
    const hostileTeleport = spaceRuntime.teleportDynamicEntityToPoint(
      systemID,
      entity.itemID,
      {
        x: Number(stagingOrigin.x) + 1200 + (index * 600),
        y: Number(stagingOrigin.y) + (index * 200),
        z: Number(stagingOrigin.z),
      },
      {
        broadcast: false,
        direction: { x: -1, y: 0, z: 0 },
      },
    );
    assert.equal(hostileTeleport && hostileTeleport.success, true);
  });

  return stagingOrigin;
}

test.afterEach(() => {
  for (const session of registeredSessions.splice(0)) {
    sessionRegistry.unregister(session);
  }
  for (const [characterID, snapshot] of characterSnapshots.entries()) {
    const restoreResult = database.write(
      "characters",
      `/${characterID}`,
      snapshot,
      { silent: true },
    );
    assert.equal(restoreResult.success, true, "Failed to restore original character record");
  }
  characterSnapshots.clear();
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
  resetInventoryStoreForTests();
  spaceRuntime._testing.clearScenes();
});

test("ship.LaunchDrones spawns a live drone entity and emits drone-state updates", { concurrency: false }, () => {
  resetInventoryStoreForTests();
  snapshotItemsTable();
  const candidate = getActiveShipCandidate();
  promoteShipToDroneHull(candidate);
  const session = buildSession(candidate);
  const shipService = new ShipService();
  const droneItem = grantSingletonDrone(candidate);

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  registerSession(session);
  const shipEntity = attachSessionToScene(session, candidate.ship);
  session.notifications.length = 0;

  const launchResult = shipService.Handle_LaunchDrones(
    [[[droneItem.itemID, 1]]],
    session,
    {},
  );
  assertLaunchResultMap(launchResult, {
    [droneItem.itemID]: [droneItem.itemID],
  });

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const droneEntity = scene.getEntityByID(droneItem.itemID);
  assert.ok(droneEntity, "Expected launched drone entity in scene");
  assert.equal(droneEntity.kind, "drone");
  assert.equal(Number(droneEntity.controllerID), Number(shipEntity.itemID));
  assert.equal(Number(droneEntity.controllerOwnerID), Number(candidate.characterID));
  assert.equal(droneEntity.mode, "ORBIT");
  assert.equal(Number(droneEntity.targetEntityID), Number(shipEntity.itemID));
  const persistedDroneItem = findItemById(droneItem.itemID);
  assert.equal(persistedDroneItem && persistedDroneItem.spaceState && persistedDroneItem.spaceState.mode, "ORBIT");
  assert.equal(
    Number(
      persistedDroneItem &&
        persistedDroneItem.spaceState &&
        persistedDroneItem.spaceState.targetEntityID,
    ),
    Number(shipEntity.itemID),
  );

  const droneStateNotify = findNotification(session, "OnDroneStateChange");
  assert.ok(droneStateNotify, "Expected OnDroneStateChange after launch");
  assert.deepEqual(droneStateNotify.payload, [
    Number(droneItem.itemID),
    Number(candidate.characterID),
    Number(shipEntity.itemID),
    0,
    Number(droneItem.typeID),
    Number(candidate.characterID),
    null,
  ]);
});

test("ship.LaunchDrones syncs OnItemChange rows for every split-launched drone item", { concurrency: false }, () => {
  resetInventoryStoreForTests();
  snapshotItemsTable();
  const candidate = getActiveShipCandidate();
  promoteShipToDroneHull(candidate);
  const session = buildSession(candidate);
  const shipService = new ShipService();
  const droneType = resolveItemByName("Acolyte II");
  assert.equal(droneType && droneType.success, true, "Expected Acolyte II metadata");
  const grantResult = grantItemToCharacterLocation(
    candidate.characterID,
    candidate.ship.itemID,
    ITEM_FLAGS.DRONE_BAY,
    droneType.match,
    5,
    { transient: true, singleton: false },
  );
  assert.equal(grantResult.success, true, "Expected stacked drone grant");
  const droneItem = grantResult.data && grantResult.data.items && grantResult.data.items[0];
  assert.ok(droneItem && droneItem.itemID, "Expected stacked drone bay item");
  transientItemIDs.push(Number(droneItem.itemID) || 0);

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  registerSession(session);
  attachSessionToScene(session, candidate.ship);
  session.notifications.length = 0;

  const launchResult = shipService.Handle_LaunchDrones(
    [[[droneItem.itemID, 5]]],
    session,
    {},
  );
  const launchedDroneIDs = getMarshalListItems(
    launchResult &&
    launchResult.type === "dict" &&
    Array.isArray(launchResult.entries)
      ? (launchResult.entries.find((entry) => Array.isArray(entry) && Number(entry[0]) === Number(droneItem.itemID)) || [null, null])[1]
      : null,
  );
  assert.equal(launchedDroneIDs.length, 5, "Expected five launched drone IDs from stacked launch");

  const itemChangeItemIDs = new Set(getOnItemChangeItemIDs(session));
  for (const launchedDroneID of launchedDroneIDs) {
    assert.equal(
      itemChangeItemIDs.has(Number(launchedDroneID)),
      true,
      `Expected OnItemChange sync for launched drone ${String(launchedDroneID)}`,
    );
    const launchedItemChange = [...session.notifications].reverse().find((entry) => (
      entry &&
      entry.name === "OnItemChange" &&
      Array.isArray(entry.payload) &&
      entry.payload[0] &&
      entry.payload[0].fields &&
      Number(entry.payload[0].fields.itemID) === Number(launchedDroneID)
    ));
    assert.ok(
      launchedItemChange,
      `Expected a concrete OnItemChange payload for launched drone ${String(launchedDroneID)}`,
    );
    assert.equal(
      Number(launchedItemChange.payload[0].fields.quantity),
      -1,
      `Expected launched drone ${String(launchedDroneID)} to sync singleton quantity semantics`,
    );
    assert.equal(
      Number(launchedItemChange.payload[0].fields.stacksize),
      1,
      `Expected launched drone ${String(launchedDroneID)} to sync stacksize=1`,
    );
    assert.equal(
      Number(launchedItemChange.payload[0].fields.singleton),
      1,
      `Expected launched drone ${String(launchedDroneID)} to sync singleton=1`,
    );
    const changeEntries = getOnItemChangeEntryMap(launchedItemChange);
    assert.equal(
      Number(changeEntries.get(3)),
      Number(candidate.ship.itemID),
      `Expected launched drone ${String(launchedDroneID)} to report the ship as the old location`,
    );
    assert.equal(
      Number(changeEntries.get(4)),
      Number(ITEM_FLAGS.DRONE_BAY),
      `Expected launched drone ${String(launchedDroneID)} to report DRONE_BAY as the old flag`,
    );
  }
});

test("destiny SetState includes live droneState rows for launched drones", { concurrency: false }, () => {
  resetInventoryStoreForTests();
  snapshotItemsTable();
  const candidate = getActiveShipCandidate();
  promoteShipToDroneHull(candidate);
  const session = buildSession(candidate);
  const shipService = new ShipService();
  const droneItem = grantSingletonDrone(candidate);

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  registerSession(session);
  const shipEntity = attachSessionToScene(session, candidate.ship);
  shipService.Handle_LaunchDrones([[[droneItem.itemID, 1]]], session, {});

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const payload = destiny.buildSetStatePayload(
    77,
    {
      solarSystemID: TEST_SYSTEM_ID,
      constellationID: TEST_CONSTELLATION_ID,
    },
    shipEntity.itemID,
    scene.getVisibleEntitiesForSession(session),
  );
  assert.equal(payload[0], "SetState");
  const state = payload[1][0];
  const droneStateRowset = getMarshalDictEntry(state.args, "droneState");
  const lines = getRowsetLines(droneStateRowset);

  assert.deepEqual(lines, [[
    Number(droneItem.itemID),
    Number(candidate.characterID),
    Number(shipEntity.itemID),
    0,
    Number(droneItem.typeID),
    Number(candidate.characterID),
    null,
  ]]);
});

test("entity.CmdAbandonDrone clears drone control and entity.CmdReconnectToDrones restores it", { concurrency: false }, () => {
  resetInventoryStoreForTests();
  snapshotItemsTable();
  const candidate = getActiveShipCandidate();
  promoteShipToDroneHull(candidate);
  const session = buildSession(candidate);
  const shipService = new ShipService();
  const entityService = new EntityService();
  const droneItem = grantSingletonDrone(candidate);

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  registerSession(session);
  const shipEntity = attachSessionToScene(session, candidate.ship);
  shipService.Handle_LaunchDrones([[[droneItem.itemID, 1]]], session, {});
  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  session.notifications.length = 0;

  const abandonResult = entityService.Handle_CmdAbandonDrone(
    [[droneItem.itemID]],
    session,
    {},
  );
  assertEmptyDroneCommandResult(abandonResult);

  const abandonedDrone = scene.getEntityByID(droneItem.itemID);
  assert.ok(abandonedDrone, "Expected drone to remain in space after abandon");
  assert.equal(Number(abandonedDrone.controllerID || 0), 0);
  const abandonNotify = findNotification(session, "OnDroneStateChange");
  assert.ok(abandonNotify, "Expected OnDroneStateChange on abandon");
  assert.deepEqual(abandonNotify.payload, [
    Number(droneItem.itemID),
    0,
    0,
    0,
    Number(droneItem.typeID),
    0,
    null,
  ]);

  session.notifications.length = 0;
  const reconnectResult = entityService.Handle_CmdReconnectToDrones(
    [[droneItem.itemID]],
    session,
    {},
  );
  assertEmptyDroneCommandResult(reconnectResult);
  assert.equal(Number(abandonedDrone.controllerID), Number(shipEntity.itemID));
  assert.equal(Number(abandonedDrone.controllerOwnerID), Number(candidate.characterID));
  const reconnectNotify = findNotification(session, "OnDroneStateChange");
  assert.ok(reconnectNotify, "Expected OnDroneStateChange on reconnect");
  assert.deepEqual(reconnectNotify.payload, [
    Number(droneItem.itemID),
    Number(candidate.characterID),
    Number(shipEntity.itemID),
    0,
    Number(droneItem.typeID),
    Number(candidate.characterID),
    null,
  ]);
});

test("abandoned drones retain slim owner identity while dropping out of destiny droneState rows", { concurrency: false }, () => {
  resetInventoryStoreForTests();
  snapshotItemsTable();
  const candidate = getActiveShipCandidate();
  promoteShipToDroneHull(candidate);
  const session = buildSession(candidate);
  const shipService = new ShipService();
  const entityService = new EntityService();
  const droneItem = grantSingletonDrone(candidate);

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  registerSession(session);
  const shipEntity = attachSessionToScene(session, candidate.ship);
  shipService.Handle_LaunchDrones([[[droneItem.itemID, 1]]], session, {});
  assertEmptyDroneCommandResult(
    entityService.Handle_CmdAbandonDrone([[droneItem.itemID]], session, {}),
  );

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const payload = destiny.buildSetStatePayload(
    91,
    {
      solarSystemID: TEST_SYSTEM_ID,
      constellationID: TEST_CONSTELLATION_ID,
    },
    shipEntity.itemID,
    scene.getVisibleEntitiesForSession(session),
  );
  const state = payload[1][0];
  const droneStateRowset = getMarshalDictEntry(state.args, "droneState");
  const droneStateRows = getRowsetLines(droneStateRowset);
  const slimItem = findSlimItemByID(getMarshalDictEntry(state.args, "slims"), droneItem.itemID);

  assert.equal(
    droneStateRows.some((row) => Number(row && row[0]) === Number(droneItem.itemID)),
    false,
    "Expected abandoned drone to disappear from destiny droneState rows",
  );
  assert.ok(slimItem, "Expected abandoned drone to remain present in slim data");
  assert.equal(
    Number(getMarshalDictEntry(slimItem.args, "ownerID")),
    Number(candidate.characterID),
    "Expected abandoned drone slim data to retain the original owner identity",
  );
});

test("ship.ScoopDrone allows foreign abandoned drones and re-owners the recovered inventory item to the scooping pilot", { concurrency: false }, () => {
  resetInventoryStoreForTests();
  snapshotItemsTable();
  const candidates = getActiveShipCandidates();
  assert.ok(candidates.length >= 2, "Expected at least two active ship candidates for abandoned drone scoop parity");
  const ownerCandidate = candidates[0];
  const scooperCandidate = candidates.find(
    (entry) => Number(entry.characterID) !== Number(ownerCandidate.characterID),
  );
  assert.ok(scooperCandidate, "Expected a second active ship candidate for abandoned drone scoop parity");
  promoteShipToDroneHull(ownerCandidate);
  promoteShipToDroneHull(scooperCandidate);

  const ownerSession = buildSession(ownerCandidate);
  const scooperSession = buildSession(scooperCandidate);
  const shipService = new ShipService();
  const entityService = new EntityService();
  const droneItem = grantSingletonDrone(ownerCandidate);
  clearShipBayItemsByType(
    scooperCandidate.characterID,
    scooperCandidate.ship.itemID,
    ITEM_FLAGS.DRONE_BAY,
    droneItem.typeID,
  );

  const ownerApply = applyCharacterToSession(ownerSession, ownerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(ownerApply.success, true);
  const scooperApply = applyCharacterToSession(scooperSession, scooperCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(scooperApply.success, true);

  registerSession(ownerSession);
  registerSession(scooperSession);
  attachSessionToScene(ownerSession, ownerCandidate.ship);
  attachSessionToScene(scooperSession, scooperCandidate.ship);

  assertLaunchResultMap(
    shipService.Handle_LaunchDrones([[[droneItem.itemID, 1]]], ownerSession, {}),
    {
      [droneItem.itemID]: [droneItem.itemID],
    },
  );
  assertEmptyDroneCommandResult(
    entityService.Handle_CmdAbandonDrone([[droneItem.itemID]], ownerSession, {}),
  );

  const scoopResult = shipService.Handle_ScoopDrone(
    [[droneItem.itemID]],
    scooperSession,
    {},
  );
  assertEmptyDroneCommandResult(scoopResult);

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  assert.equal(scene.getEntityByID(droneItem.itemID), null, "Expected scooped abandoned drone to leave local space");

  const scoopedRecord = findItemById(droneItem.itemID);
  assert.ok(scoopedRecord, "Expected recovered drone inventory record after foreign scoop");
  assert.equal(Number(scoopedRecord.ownerID), Number(scooperCandidate.characterID));
  assert.equal(Number(scoopedRecord.locationID), Number(scooperCandidate.ship.itemID));
  assert.equal(Number(scoopedRecord.flagID), ITEM_FLAGS.DRONE_BAY);
  assert.equal(
    listContainerItems(
      scooperCandidate.characterID,
      scooperCandidate.ship.itemID,
      ITEM_FLAGS.DRONE_BAY,
    ).some((item) => Number(item && item.itemID) === Number(droneItem.itemID)),
    true,
    "Expected foreign scooped drone to appear in the scooper's drone bay inventory",
  );
});

test("entity.CmdReturnHome transitions the drone back to an idle orbit around the controlling ship", { concurrency: false }, () => {
  resetInventoryStoreForTests();
  snapshotItemsTable();
  const candidate = getActiveShipCandidate();
  promoteShipToDroneHull(candidate);
  const session = buildSession(candidate);
  const shipService = new ShipService();
  const entityService = new EntityService();
  const droneItem = grantSingletonDrone(candidate);

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  registerSession(session);
  const shipEntity = attachSessionToScene(session, candidate.ship);
  shipService.Handle_LaunchDrones([[[droneItem.itemID, 1]]], session, {});
  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  session.notifications.length = 0;

  const commandResult = entityService.Handle_CmdReturnHome(
    [[droneItem.itemID]],
    session,
    {},
  );
  assertEmptyDroneCommandResult(commandResult);

  const teleportResult = spaceRuntime.teleportDynamicEntityToPoint(
    TEST_SYSTEM_ID,
    droneItem.itemID,
    shipEntity.position,
    {
      broadcast: false,
      direction: shipEntity.direction,
    },
  );
  assert.equal(teleportResult && teleportResult.success, true);
  scene.tick(scene.getCurrentWallclockMs() + 1000);

  const droneEntity = scene.getEntityByID(droneItem.itemID);
  assert.ok(droneEntity, "Expected drone to remain in space after ReturnHome");
  assert.equal(droneEntity.mode, "ORBIT");
  assert.equal(Number(droneEntity.controllerID), Number(shipEntity.itemID));
  assert.equal(Number(droneEntity.targetID || 0), 0);
  assert.equal(Number(droneEntity.activityState), 0);
  assert.equal(droneEntity.droneCommand, null);

  const returnHomeNotify = findNotification(session, "OnDroneStateChange");
  assert.ok(returnHomeNotify, "Expected drone state update after ReturnHome settles");
  assert.deepEqual(returnHomeNotify.payload, [
    Number(droneItem.itemID),
    Number(candidate.characterID),
    Number(shipEntity.itemID),
    0,
    Number(droneItem.typeID),
    Number(candidate.characterID),
    null,
  ]);
});

test("entity.CmdReturnBay recalls the drone into drone bay and removes the in-space ball", { concurrency: false }, () => {
  resetInventoryStoreForTests();
  snapshotItemsTable();
  const candidate = getActiveShipCandidate();
  promoteShipToDroneHull(candidate);
  const session = buildSession(candidate);
  const shipService = new ShipService();
  const entityService = new EntityService();
  const droneItem = grantSingletonDrone(candidate);

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  registerSession(session);
  const shipEntity = attachSessionToScene(session, candidate.ship);
  shipService.Handle_LaunchDrones([[[droneItem.itemID, 1]]], session, {});
  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  session.notifications.length = 0;

  const commandResult = entityService.Handle_CmdReturnBay(
    [[droneItem.itemID]],
    session,
    {},
  );
  assertEmptyDroneCommandResult(commandResult);

  const teleportResult = spaceRuntime.teleportDynamicEntityToPoint(
    TEST_SYSTEM_ID,
    droneItem.itemID,
    shipEntity.position,
    {
      broadcast: false,
      direction: shipEntity.direction,
    },
  );
  assert.equal(teleportResult && teleportResult.success, true);
  scene.tick(scene.getCurrentWallclockMs() + 1000);

  assert.equal(scene.getEntityByID(droneItem.itemID), null);
  const bayItems = listContainerItems(
    candidate.characterID,
    candidate.ship.itemID,
    ITEM_FLAGS.DRONE_BAY,
  );
  assert.equal(
    bayItems.some((item) => Number(item.itemID) === Number(droneItem.itemID)),
    true,
    "Expected returned drone back in drone bay",
  );
  const recallNotify = findNotification(session, "OnDroneStateChange");
  assert.ok(recallNotify, "Expected drone-state clear on recall");
  assert.deepEqual(recallNotify.payload, [
    Number(droneItem.itemID),
    0,
    0,
    0,
    Number(droneItem.typeID),
    0,
    null,
  ]);
  assert.ok(
    session.notifications.some((entry) => entry && entry.name === "OnItemChange"),
    "Expected inventory refresh when drone returns to bay",
  );
  assert.ok(findItemById(droneItem.itemID), "Expected recalled drone inventory item to persist");
});

test("entity.CmdReturnBay approaches inside scoop range instead of parking on the pickup boundary", { concurrency: false }, () => {
  resetInventoryStoreForTests();
  snapshotItemsTable();
  const candidate = getActiveShipCandidate();
  promoteShipToDroneHull(candidate);
  const session = buildSession(candidate);
  const shipService = new ShipService();
  const entityService = new EntityService();
  const droneItem = grantSingletonDrone(candidate);

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  registerSession(session);
  const shipEntity = attachSessionToScene(session, candidate.ship);
  shipService.Handle_LaunchDrones([[[droneItem.itemID, 1]]], session, {});
  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const droneEntity = scene.getEntityByID(droneItem.itemID);
  assert.ok(droneEntity, "Expected launched drone entity");
  session.notifications.length = 0;

  const commandResult = entityService.Handle_CmdReturnBay(
    [[droneItem.itemID]],
    session,
    {},
  );
  assertEmptyDroneCommandResult(commandResult);
  assert.equal(droneEntity.mode, "FOLLOW");
  assert.equal(
    Number(droneEntity.followRange),
    0,
    "Expected return-to-bay follow range to approach the ship, not the scoop boundary",
  );

  const outsideScoopSurfaceDistance = 2525;
  droneEntity.position = {
    x:
      Number(shipEntity.position.x) +
      Number(shipEntity.radius || 0) +
      Number(droneEntity.radius || 0) +
      outsideScoopSurfaceDistance,
    y: Number(shipEntity.position.y),
    z: Number(shipEntity.position.z),
  };
  droneEntity.velocity = { x: 0, y: 0, z: 0 };
  droneEntity.direction = { x: -1, y: 0, z: 0 };
  droneEntity.targetPoint = { ...shipEntity.position };

  let wallclockAt = scene.getCurrentWallclockMs();
  wallclockAt += 1000;
  scene.tick(wallclockAt);
  wallclockAt += 1000;
  scene.tick(wallclockAt);

  assert.equal(
    scene.getEntityByID(droneItem.itemID),
    null,
    "Expected return-to-bay drone to cross into scoop range and be recalled",
  );
  const bayItems = listContainerItems(
    candidate.characterID,
    candidate.ship.itemID,
    ITEM_FLAGS.DRONE_BAY,
  );
  assert.equal(
    bayItems.some((item) => Number(item.itemID) === Number(droneItem.itemID)),
    true,
    "Expected boundary-returned drone back in drone bay",
  );
});

test("entity.CmdReturnBay primes split-launched drones into client dogma before the RETURNING state change", { concurrency: false }, () => {
  resetInventoryStoreForTests();
  snapshotItemsTable();
  const candidate = getActiveShipCandidate();
  promoteShipToDroneHull(candidate);
  const session = buildSession(candidate);
  const shipService = new ShipService();
  const entityService = new EntityService();
  const droneType = resolveItemByName("Acolyte II");
  assert.equal(droneType && droneType.success, true, "Expected Acolyte II metadata");

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  registerSession(session);
  attachSessionToScene(session, candidate.ship);

  const droneStack = grantItemToCharacterLocation(
    candidate.characterID,
    candidate.ship.itemID,
    ITEM_FLAGS.DRONE_BAY,
    droneType.match,
    2,
    { transient: true },
  );
  assert.equal(droneStack.success, true, "Expected transient drone stack grant");
  const stackItem = droneStack.data && droneStack.data.items && droneStack.data.items[0];
  assert.ok(stackItem && stackItem.itemID, "Expected stack-backed drone item");
  transientItemIDs.push(Number(stackItem.itemID) || 0);

  const launchResult = shipService.Handle_LaunchDrones(
    [[[stackItem.itemID, 2]]],
    session,
    {},
  );
  assertLaunchResultMap(launchResult, {
    [stackItem.itemID]: [
      (itemID) => Number(itemID) > 0,
      (itemID) => Number(itemID) > 0,
    ],
  });
  const launchEntry = (launchResult.entries || []).find(
    (entry) => Array.isArray(entry) && Number(entry[0]) === Number(stackItem.itemID),
  );
  const launchedIDs = launchEntry ? getMarshalListItems(launchEntry[1]) : [];
  const splitCreatedDroneID = launchedIDs.find((itemID) => Number(itemID) !== Number(stackItem.itemID));
  assert.ok(splitCreatedDroneID, "Expected a split-created launched drone itemID");

  session.notifications.length = 0;

  const returnResult = entityService.Handle_CmdReturnBay(
    [[splitCreatedDroneID]],
    session,
    {},
  );
  assertEmptyDroneCommandResult(returnResult);

  const primeIndex = findNotificationIndex(session, (entry) => (
    entry &&
    entry.name === "OnGodmaPrimeItem" &&
    Array.isArray(entry.payload) &&
    entry.payload[1] &&
    entry.payload[1].args &&
    Array.isArray(entry.payload[1].args.entries) &&
    new Map(entry.payload[1].args.entries).get("itemID") === Number(splitCreatedDroneID)
  ));
  assert.ok(primeIndex >= 0, "Expected RETURNING split drones to receive a targeted OnGodmaPrimeItem first");

  const stateIndex = findNotificationIndex(session, (entry) => (
    entry &&
    entry.name === "OnDroneStateChange" &&
    Array.isArray(entry.payload) &&
    Number(entry.payload[0]) === Number(splitCreatedDroneID) &&
    Number(entry.payload[3]) === 4
  ));
  assert.ok(stateIndex >= 0, "Expected RETURNING split drones to still emit the DEPARTING activity state");
  assert.ok(
    primeIndex < stateIndex,
    "Expected the dogma prime notification to precede the RETURNING OnDroneStateChange",
  );

  const primeNotification = session.notifications[primeIndex];
  const primeEntries = new Map(primeNotification.payload[1].args.entries);
  const invItem = primeEntries.get("invItem");
  assert.deepEqual(
    invItem.columns.map(([name]) => name),
    [
      "itemID",
      "typeID",
      "ownerID",
      "locationID",
      "flagID",
      "quantity",
      "groupID",
      "categoryID",
      "customInfo",
    ],
    "Expected the drone dogma prime row to stay DBRow-compatible for clientDogmaLocation",
  );
});

test("entity MachoBindObject keeps successful drone return commands marshal-safe for the client menu helpers", { concurrency: false }, () => {
  resetInventoryStoreForTests();
  snapshotItemsTable();
  const candidate = getActiveShipCandidate();
  promoteShipToDroneHull(candidate);
  const session = buildSession(candidate);
  const shipService = new ShipService();
  const entityService = new EntityService();
  const droneItem = grantSingletonDrone(candidate);

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  registerSession(session);
  attachSessionToScene(session, candidate.ship);
  shipService.Handle_LaunchDrones([[[droneItem.itemID, 1]]], session, {});

  const bindResult = entityService.Handle_MachoBindObject(
    [TEST_SYSTEM_ID, ["CmdReturnHome", [[droneItem.itemID]], {}]],
    session,
    {},
  );

  assert.doesNotThrow(
    () => marshalEncode(bindResult),
    "Expected nested drone return bind results to marshal instead of collapsing to None",
  );
  assert.ok(Array.isArray(bindResult), "Expected MachoBindObject to return a bind tuple");
  assert.deepEqual(
    bindResult[1],
    { type: "dict", entries: [] },
    "Expected successful nested return commands to reply with an empty error dict",
  );
});

test("ship MachoBindObject keeps successful drone launch replies marshal-safe for CCP LaunchFromShip", { concurrency: false }, () => {
  resetInventoryStoreForTests();
  snapshotItemsTable();
  const candidate = getActiveShipCandidate();
  promoteShipToDroneHull(candidate);
  const session = buildSession(candidate);
  const shipService = new ShipService();
  const droneItem = grantSingletonDrone(candidate);

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  registerSession(session);
  attachSessionToScene(session, candidate.ship);

  const bindResult = shipService.Handle_MachoBindObject(
    [[TEST_SYSTEM_ID, 5], ["LaunchDrones", [[[droneItem.itemID, 1]], null, false], {}]],
    session,
    {},
  );

  assert.doesNotThrow(
    () => marshalEncode(bindResult),
    "Expected nested drone launch bind results to marshal instead of collapsing to None",
  );
  assert.ok(Array.isArray(bindResult), "Expected MachoBindObject to return a bind tuple");
  assertLaunchResultMap(
    bindResult[1],
    {
      [droneItem.itemID]: [droneItem.itemID],
    },
    "Expected successful nested drone launch to reply with a keyed launch-result dict",
  );
});

test("ship.LaunchDrones keeps launch-limit error replies marshal-safe for CCP LaunchFromShip", { concurrency: false }, () => {
  resetInventoryStoreForTests();
  snapshotItemsTable();
  const candidate = getActiveShipCandidate();
  promoteShipToDroneHull(candidate);
  const session = buildSession(candidate);
  const shipService = new ShipService();
  const droneType = resolveItemByName("Acolyte II");
  assert.equal(droneType && droneType.success, true, "Expected Acolyte II metadata");

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  registerSession(session);
  attachSessionToScene(session, candidate.ship);

  const droneStack = grantItemToCharacterLocation(
    candidate.characterID,
    candidate.ship.itemID,
    ITEM_FLAGS.DRONE_BAY,
    droneType.match,
    6,
    { transient: true },
  );
  assert.equal(droneStack.success, true, "Expected transient drone stack grant");
  const stackItem = droneStack.data && droneStack.data.items && droneStack.data.items[0];
  assert.ok(stackItem && stackItem.itemID, "Expected stack-backed drone item");
  transientItemIDs.push(Number(stackItem.itemID) || 0);

  const launchResult = shipService.Handle_LaunchDrones(
    [[[stackItem.itemID, 6]]],
    session,
    {},
  );

  assert.doesNotThrow(
    () => marshalEncode(launchResult),
    "Expected launch-limit drone errors to stay marshal-safe instead of collapsing to None",
  );

  const launchEntry = (launchResult.entries || []).find(
    (entry) => Array.isArray(entry) && Number(entry[0]) === Number(stackItem.itemID),
  );
  const launchItems = launchEntry ? getMarshalListItems(launchEntry[1]) : [];
  assert.equal(launchItems.length, 6, "Expected five launched drone IDs and one launch-limit error entry");

  const limitError = launchItems.find((entry) => (
    Array.isArray(entry) &&
    entry[0] === "CustomNotify"
  ));
  assert.ok(limitError, "Expected launch-limit result to contain a CustomNotify tuple");
  assert.equal(
    getMarshalDictEntry(limitError[1], "notify"),
    "Maximum active drones already in space.",
    "Expected launch-limit error text to remain marshal-safe for CCP LaunchFromShip",
  );
});

test("packet dispatcher resolves token-wrapped bound ship LaunchDrones calls for CCP follow-up launch requests", { concurrency: false }, async () => {
  resetInventoryStoreForTests();
  snapshotItemsTable();
  const candidate = getActiveShipCandidate();
  promoteShipToDroneHull(candidate);
  const session = buildSession(candidate);
  const shipService = new ShipService();
  const serviceManager = new ServiceManager();
  const dispatcher = new PacketDispatcher(serviceManager);
  const droneType = resolveItemByName("Acolyte II");
  assert.equal(droneType && droneType.success, true, "Expected Acolyte II metadata");

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  registerSession(session);
  attachSessionToScene(session, candidate.ship);
  serviceManager.register(shipService);

  const droneStack = grantItemToCharacterLocation(
    candidate.characterID,
    candidate.ship.itemID,
    ITEM_FLAGS.DRONE_BAY,
    droneType.match,
    2,
    { transient: true },
  );
  assert.equal(droneStack.success, true, "Expected transient launch stack grant");
  const droneItem = droneStack.data && droneStack.data.items && droneStack.data.items[0];
  assert.ok(droneItem && droneItem.itemID, "Expected launch stack item");
  transientItemIDs.push(Number(droneItem.itemID) || 0);

  const boundObjectID = "N=65450:26";
  serviceManager.registerBoundObject(boundObjectID, shipService);
  session.packets = [];
  session.sendPacket = function sendPacket(packet) {
    this.packets.push(packet);
  };

  const rawPacket = {
    type: "object",
    name: "carbon.common.script.net.machoNetPacket.CallReq",
    args: [
      MACHONETMSG_TYPE.CALL_REQ,
      encodeAddress({
        type: "client",
        clientID: session.clientID,
        callID: 278,
        service: null,
      }),
      encodeAddress({
        type: "node",
        nodeID: 65450,
        callID: null,
        service: null,
      }),
      session.userid,
      [[
        1,
        {
          type: "substream",
          value: [
            { type: "token", value: boundObjectID },
            Buffer.from("LaunchDrones", "utf8"),
            [[[droneItem.itemID, 2]], null, false],
            {},
          ],
        },
      ]],
      { type: "dict", entries: [] },
      null,
    ],
  };

  const handled = await dispatcher.dispatch(rawPacket, session);
  assert.equal(handled, true, "Expected PacketDispatcher to handle the bound ship launch request");
  assert.equal(session.packets.length, 1, "Expected a single CallRsp packet for the bound ship launch request");

  const responsePacket = session.packets[0];
  assert.equal(
    responsePacket && responsePacket.name,
    "carbon.common.script.net.machoNetPacket.CallRsp",
    "Expected a CallRsp packet",
  );
  const responseSource = decodeAddress(responsePacket.args[1]);
  assert.equal(
    responseSource && responseSource.service,
    "ship",
    "Expected bound ship follow-up LaunchDrones responses to keep the ship service name on the wire",
  );
  const responseValue = responsePacket.args[4][0].value;
  assert.equal(responseValue && responseValue.type, "dict");
  assertLaunchResultMap(
    responseValue,
    {
      [droneItem.itemID]: [
        (itemID) => Number(itemID) > 0,
        (itemID) => Number(itemID) > 0,
      ],
    },
    "Expected the bound ship follow-up LaunchDrones call to stay keyed instead of collapsing to None",
  );
});

test("inventory dogma prime entries for drones keep singleton inventory semantics instead of charge quantity semantics", () => {
  const dronePrime = buildInventoryDogmaPrimeEntry({
    itemID: 991000680,
    typeID: 2205,
    ownerID: 140000003,
    locationID: 990114132,
    flagID: ITEM_FLAGS.DRONE_BAY,
    quantity: 1,
    groupID: 100,
    categoryID: 18,
    customInfo: "",
    singleton: 1,
    stacksize: 1,
  }, {
    description: "drone",
    now: 123n,
  });
  const entries = new Map(dronePrime.args.entries);
  const invItem = entries.get("invItem");

  assert.deepEqual(
    invItem.columns.map(([name]) => name),
    [
      "itemID",
      "typeID",
      "ownerID",
      "locationID",
      "flagID",
      "quantity",
      "groupID",
      "categoryID",
      "customInfo",
    ],
    "Expected drone dogma primes to keep a physical DBRow-compatible inventory row",
  );
  assert.equal(invItem.fields.quantity, -1);
  assert.equal(invItem.fields.stacksize, 1);
  assert.equal(invItem.fields.singleton, 1);
  assert.ok(
    invItem.header.header.length >= 3,
    "Expected singleton drone primes to stay on singleton quantity semantics",
  );
});

test("inventory dogma prime entries can include drone type attributes for clientDogmaLocation", () => {
  const dronePrime = buildInventoryDogmaPrimeEntry({
    itemID: 991000681,
    typeID: 2205,
    ownerID: 140000003,
    locationID: 990114132,
    flagID: ITEM_FLAGS.DRONE_BAY,
    quantity: null,
    groupID: 100,
    categoryID: 18,
    customInfo: "",
    singleton: 1,
    stacksize: 1,
  }, {
    description: "drone",
    includeTypeAttributes: true,
    now: 123n,
  });
  const entries = new Map(dronePrime.args.entries);
  const attributes = new Map(entries.get("attributes").entries);

  assert.ok(
    attributes.has(1272),
    "Expected droneBandwidthUsed to be present for fitting/drone tooltip dogma reads",
  );
  assert.equal(
    Number(attributes.get(805)),
    1,
    "Expected singleton drone quantity attribute to remain one",
  );
});

test("ship.LaunchDrones primes split-created drone dogma once before state changes", { concurrency: false }, () => {
  resetInventoryStoreForTests();
  snapshotItemsTable();
  const candidate = getActiveShipCandidate();
  promoteShipToDroneHull(candidate);
  const session = buildSession(candidate);
  const shipService = new ShipService();
  const droneType = resolveItemByName("Acolyte II");
  assert.equal(droneType && droneType.success, true, "Expected Acolyte II metadata");

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  registerSession(session);
  attachSessionToScene(session, candidate.ship);

  const droneStack = grantItemToCharacterLocation(
    candidate.characterID,
    candidate.ship.itemID,
    ITEM_FLAGS.DRONE_BAY,
    droneType.match,
    2,
    { transient: true },
  );
  assert.equal(droneStack.success, true, "Expected transient launch stack grant");
  const droneItem = droneStack.data && droneStack.data.items && droneStack.data.items[0];
  assert.ok(droneItem && droneItem.itemID, "Expected launch stack item");
  transientItemIDs.push(Number(droneItem.itemID) || 0);

  const launchResult = shipService.Handle_LaunchDrones(
    [[[droneItem.itemID, 2]]],
    session,
    {},
  );
  const launchEntry = (launchResult.entries || []).find(
    (entry) => Array.isArray(entry) && Number(entry[0]) === Number(droneItem.itemID),
  );
  const launchedIDs = launchEntry ? getMarshalListItems(launchEntry[1]) : [];
  assert.equal(launchedIDs.length, 2, "Expected stack launch to create two active drone IDs");
  const splitCreatedDroneID = launchedIDs.find((itemID) => Number(itemID) !== Number(droneItem.itemID));
  assert.ok(splitCreatedDroneID, "Expected stacked launch to create a split drone itemID");

  const immediateStateNotifies = session.notifications.filter((entry) => (
    entry &&
    entry.name === "OnDroneStateChange" &&
    Array.isArray(entry.payload) &&
    Number(entry.payload[0]) === Number(splitCreatedDroneID)
  ));
  assert.equal(immediateStateNotifies.length, 1, "Expected one immediate OnDroneStateChange for the split-created drone");
  const immediatePrimeIndex = findNotificationIndex(session, (entry) => (
    entry &&
    entry.name === "OnGodmaPrimeItem" &&
    Array.isArray(entry.payload) &&
    entry.payload[1] &&
    entry.payload[1].args &&
    Array.isArray(entry.payload[1].args.entries) &&
    new Map(entry.payload[1].args.entries).get("itemID") === Number(splitCreatedDroneID)
  ));
  assert.ok(
    immediatePrimeIndex >= 0,
    "Expected split-created launches to send an immediate OnGodmaPrimeItem before the first state change",
  );
  const immediateStateIndex = findNotificationIndex(session, (entry) => (
    entry &&
    entry.name === "OnDroneStateChange" &&
    Array.isArray(entry.payload) &&
    Number(entry.payload[0]) === Number(splitCreatedDroneID)
  ));
  assert.ok(immediateStateIndex >= 0, "Expected an immediate OnDroneStateChange for the split-created drone");
  assert.ok(
    immediatePrimeIndex < immediateStateIndex,
    "Expected the split-created drone dogma prime to precede the first OnDroneStateChange",
  );
  const immediatePrimeNotification = session.notifications[immediatePrimeIndex];
  const immediatePrimeEntries = new Map(immediatePrimeNotification.payload[1].args.entries);
  const immediatePrimeInvItem = immediatePrimeEntries.get("invItem");
  assert.equal(
    Number(immediatePrimeNotification.payload[0]),
    Number(candidate.ship.itemID),
    "Expected split-created drone dogma primes to target the controlling ship before launch",
  );
  assert.deepEqual(
    immediatePrimeInvItem.columns.map(([name]) => name),
    [
      "itemID",
      "typeID",
      "ownerID",
      "locationID",
      "flagID",
      "quantity",
      "groupID",
      "categoryID",
      "customInfo",
    ],
    "Expected split-created drone dogma primes to use physical inventory DBRows",
  );
  assert.deepEqual(
    [
      Number(immediatePrimeInvItem.fields.locationID),
      Number(immediatePrimeInvItem.fields.flagID),
    ],
    [Number(candidate.ship.itemID), Number(ITEM_FLAGS.DRONE_BAY)],
    "Expected split-created drone dogma primes to describe the fitted bay row the clientDogmaLocation can load",
  );
  const immediatePrimeAttributes = new Map(
    (immediatePrimeEntries.get("attributes") || {}).entries || [],
  );
  assert.ok(
    immediatePrimeAttributes.has(1272),
    "Expected launch dogma prime to include droneBandwidthUsed before drone tooltips query client dogma",
  );
  const splitPrimeIDs = getOnGodmaPrimeItemIDs(session).filter(
    (itemID) => Number(itemID) === Number(splitCreatedDroneID),
  );
  assert.equal(
    splitPrimeIDs.length,
    1,
    "Expected split-created launches to prime once without deferred dogma replays",
  );
});

test("ship.LaunchDrones primes every split-created drone before its state change in a stacked 5-drone launch", { concurrency: false }, () => {
  resetInventoryStoreForTests();
  snapshotItemsTable();
  const candidate = getActiveShipCandidate();
  promoteShipToDroneHull(candidate);
  const session = buildSession(candidate);
  const shipService = new ShipService();
  const droneType = resolveItemByName("Acolyte II");
  assert.equal(droneType && droneType.success, true, "Expected Acolyte II metadata");

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  registerSession(session);
  attachSessionToScene(session, candidate.ship);

  const droneStack = grantItemToCharacterLocation(
    candidate.characterID,
    candidate.ship.itemID,
    ITEM_FLAGS.DRONE_BAY,
    droneType.match,
    5,
    { transient: true },
  );
  assert.equal(droneStack.success, true, "Expected transient 5-drone launch stack grant");
  const droneItem = droneStack.data && droneStack.data.items && droneStack.data.items[0];
  assert.ok(droneItem && droneItem.itemID, "Expected 5-drone launch stack item");
  transientItemIDs.push(Number(droneItem.itemID) || 0);

  const launchResult = shipService.Handle_LaunchDrones(
    [[[droneItem.itemID, 5]]],
    session,
    {},
  );
  const launchEntry = (launchResult.entries || []).find(
    (entry) => Array.isArray(entry) && Number(entry[0]) === Number(droneItem.itemID),
  );
  const launchedIDs = launchEntry ? getMarshalListItems(launchEntry[1]) : [];
  assert.equal(launchedIDs.length, 5, "Expected five launched drone IDs");

  const splitCreatedDroneIDs = launchedIDs.filter(
    (itemID) => Number(itemID) !== Number(droneItem.itemID),
  );
  assert.equal(
    splitCreatedDroneIDs.length,
    4,
    "Expected stacked 5-drone launch to create four split-created drone itemIDs",
  );

  const primeItemIDs = getOnGodmaPrimeItemIDs(session);
  for (const splitCreatedDroneID of splitCreatedDroneIDs) {
    const primeCount = primeItemIDs.filter(
      (itemID) => Number(itemID) === Number(splitCreatedDroneID),
    ).length;
    assert.equal(
      primeCount,
      1,
      `Expected split-created drone ${String(splitCreatedDroneID)} to receive one authoritative OnGodmaPrimeItem`,
    );
    const primeIndex = findNotificationIndex(session, (entry) => (
      entry &&
      entry.name === "OnGodmaPrimeItem" &&
      Array.isArray(entry.payload) &&
      entry.payload[1] &&
      entry.payload[1].args &&
      Array.isArray(entry.payload[1].args.entries) &&
      new Map(entry.payload[1].args.entries).get("itemID") === Number(splitCreatedDroneID)
    ));
    const stateIndex = findNotificationIndex(session, (entry) => (
      entry &&
      entry.name === "OnDroneStateChange" &&
      Array.isArray(entry.payload) &&
      Number(entry.payload[0]) === Number(splitCreatedDroneID)
    ));
    assert.ok(
      primeIndex >= 0 && stateIndex >= 0 && primeIndex < stateIndex,
      `Expected split-created drone ${String(splitCreatedDroneID)} to be dogma-primed before its state change`,
    );
  }
});

test("entity.CmdReturnBay merges returned split drones straight into the existing bay stack without a bogus temporary bay row", { concurrency: false }, () => {
  resetInventoryStoreForTests();
  snapshotItemsTable();
  const candidate = getActiveShipCandidate();
  promoteShipToDroneHull(candidate);
  const session = buildSession(candidate);
  const shipService = new ShipService();
  const entityService = new EntityService();
  const droneType = resolveItemByName("Acolyte II");
  assert.equal(droneType && droneType.success, true, "Expected Acolyte II metadata");

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  registerSession(session);
  const shipEntity = attachSessionToScene(session, candidate.ship);

  const droneStack = grantItemToCharacterLocation(
    candidate.characterID,
    candidate.ship.itemID,
    ITEM_FLAGS.DRONE_BAY,
    droneType.match,
    2,
    { transient: true },
  );
  assert.equal(droneStack.success, true, "Expected transient drone stack grant");
  const stackItem = droneStack.data && droneStack.data.items && droneStack.data.items[0];
  assert.ok(stackItem && stackItem.itemID, "Expected stack-backed drone item");
  transientItemIDs.push(Number(stackItem.itemID) || 0);

  const launchResult = shipService.Handle_LaunchDrones(
    [[[stackItem.itemID, 1]]],
    session,
    {},
  );
  assertLaunchResultMap(launchResult, {
    [stackItem.itemID]: [
      (itemID) => Number(itemID) > 0,
    ],
  });
  const launchEntry = (launchResult.entries || []).find(
    (entry) => Array.isArray(entry) && Number(entry[0]) === Number(stackItem.itemID),
  );
  const launchedIDs = launchEntry ? getMarshalListItems(launchEntry[1]) : [];
  const launchedDroneID = launchedIDs[0];
  assert.ok(launchedDroneID, "Expected a launched drone itemID");

  session.notifications.length = 0;
  const returnResult = entityService.Handle_CmdReturnBay(
    [[launchedDroneID]],
    session,
    {},
  );
  assertEmptyDroneCommandResult(returnResult);

  const teleportResult = spaceRuntime.teleportDynamicEntityToPoint(
    TEST_SYSTEM_ID,
    launchedDroneID,
    shipEntity.position,
    {
      broadcast: false,
      direction: shipEntity.direction,
    },
  );
  assert.equal(teleportResult && teleportResult.success, true);

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  scene.tick(scene.getCurrentWallclockMs() + 1000);

  const itemChangeItemIDs = getOnItemChangeItemIDs(session);
  assert.equal(
    itemChangeItemIDs.includes(Number(launchedDroneID)),
    false,
    "Expected merged returns to avoid advertising a temporary in-bay row for the returning split drone itemID",
  );
  assert.equal(
    itemChangeItemIDs.includes(Number(stackItem.itemID)),
    true,
    "Expected merged returns to refresh the surviving drone bay stack instead",
  );

  const bayItems = listContainerItems(
    candidate.characterID,
    candidate.ship.itemID,
    ITEM_FLAGS.DRONE_BAY,
  );
  const survivingStack = bayItems.find((item) => Number(item.itemID) === Number(stackItem.itemID));
  assert.ok(survivingStack, "Expected the original drone bay stack to survive the return merge");
  assert.equal(Number(survivingStack.stacksize), 2, "Expected the original drone bay stack to return to two drones");
  assert.equal(findItemById(launchedDroneID), null, "Expected the merged return source item to be removed instead of left as junk inventory churn");
});

test("disconnect-style detach recalls nearby controlled drones to bay and removes them from observer ballparks", { concurrency: false }, () => {
  resetInventoryStoreForTests();
  snapshotItemsTable();
  const candidates = getActiveShipCandidates();
  assert.ok(candidates.length >= 2, "Expected at least two active ship candidates for disconnect drone parity");
  const controllerCandidate = candidates[0];
  const observerCandidate = candidates.find(
    (entry) => Number(entry.characterID) !== Number(controllerCandidate.characterID),
  );
  assert.ok(observerCandidate, "Expected an observer candidate");
  promoteShipToDroneHull(controllerCandidate);

  const controllerSession = buildSession(controllerCandidate);
  const observerSession = buildSession(observerCandidate);
  const shipService = new ShipService();
  const droneItem = grantSingletonDrone(controllerCandidate);

  assert.equal(applyCharacterToSession(controllerSession, controllerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  }).success, true);
  assert.equal(applyCharacterToSession(observerSession, observerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  }).success, true);

  registerSession(controllerSession);
  registerSession(observerSession);
  attachSessionToScene(controllerSession, controllerCandidate.ship);
  attachSessionToScene(observerSession, observerCandidate.ship);
  finishInitialBallpark(controllerSession);
  finishInitialBallpark(observerSession);

  const launchResult = shipService.Handle_LaunchDrones(
    [[[droneItem.itemID, 1]]],
    controllerSession,
    {},
  );
  assertLaunchResultMap(launchResult, {
    [droneItem.itemID]: [droneItem.itemID],
  });

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  controllerSession.notifications.length = 0;
  observerSession.notifications.length = 0;

  spaceRuntime.detachSession(controllerSession, {
    broadcast: true,
    lifecycleReason: "disconnect",
    attemptDroneBayRecovery: true,
  });

  assert.equal(scene.getEntityByID(droneItem.itemID), null, "Expected disconnect recall to remove the drone ball");
  const recalledDrone = findItemById(droneItem.itemID);
  assert.ok(recalledDrone, "Expected disconnect recall to preserve the drone inventory item");
  assert.equal(Number(recalledDrone.locationID), Number(controllerCandidate.ship.itemID));
  assert.equal(Number(recalledDrone.flagID), ITEM_FLAGS.DRONE_BAY);

  const stateNotify = findNotification(controllerSession, "OnDroneStateChange");
  assert.ok(stateNotify, "Expected disconnect recall to emit drone-state cleanup");
  assert.deepEqual(stateNotify.payload, [
    Number(droneItem.itemID),
    0,
    0,
    0,
    Number(droneItem.typeID),
    0,
    null,
  ]);

  const observerUpdates = flattenDestinyUpdates(observerSession.notifications);
  assert.ok(
    observerUpdates.some(
      (entry) => getRemoveBallsEntityIDs(entry).includes(Number(droneItem.itemID)),
    ),
    "Expected already-ballparked observers to receive RemoveBalls when disconnect recall pulls the drone into bay",
  );
});

test("jump-style detach abandons controlled drones immediately instead of waiting for a later scene tick", { concurrency: false }, () => {
  resetInventoryStoreForTests();
  snapshotItemsTable();
  const candidates = getActiveShipCandidates();
  assert.ok(candidates.length >= 2, "Expected at least two active ship candidates for jump drone parity");
  const controllerCandidate = candidates[0];
  const observerCandidate = candidates.find(
    (entry) => Number(entry.characterID) !== Number(controllerCandidate.characterID),
  );
  assert.ok(observerCandidate, "Expected an observer candidate");
  promoteShipToDroneHull(controllerCandidate);

  const controllerSession = buildSession(controllerCandidate);
  const observerSession = buildSession(observerCandidate);
  const shipService = new ShipService();
  const droneItem = grantSingletonDrone(controllerCandidate);

  assert.equal(applyCharacterToSession(controllerSession, controllerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  }).success, true);
  assert.equal(applyCharacterToSession(observerSession, observerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  }).success, true);

  registerSession(controllerSession);
  registerSession(observerSession);
  attachSessionToScene(controllerSession, controllerCandidate.ship);
  attachSessionToScene(observerSession, observerCandidate.ship);
  finishInitialBallpark(controllerSession);
  finishInitialBallpark(observerSession);

  const launchResult = shipService.Handle_LaunchDrones(
    [[[droneItem.itemID, 1]]],
    controllerSession,
    {},
  );
  assertLaunchResultMap(launchResult, {
    [droneItem.itemID]: [droneItem.itemID],
  });

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  controllerSession.notifications.length = 0;
  observerSession.notifications.length = 0;

  spaceRuntime.detachSession(controllerSession, {
    broadcast: true,
    lifecycleReason: "stargate-jump",
  });

  const abandonedDrone = scene.getEntityByID(droneItem.itemID);
  assert.ok(abandonedDrone, "Expected jump detach to leave the drone abandoned in space");
  assert.equal(Number(abandonedDrone.controllerID || 0), 0);
  assert.equal(Number(abandonedDrone.controllerOwnerID || 0), 0);
  assert.equal(Number(abandonedDrone.launcherID || 0), 0);
  assert.equal(Number(abandonedDrone.activityState || 0), 0);
  assert.equal(Boolean(abandonedDrone.droneStateVisible), false);

  assert.ok(
    findNotification(controllerSession, "OnDroneStateChange"),
    "Expected jump detach to emit controller-loss drone-state cleanup before the ship leaves the scene",
  );
  assert.ok(
    findNotification(controllerSession, "OnDroneActivityChange"),
    "Expected jump detach to emit activity cleanup before the ship leaves the scene",
  );

  const observerUpdates = flattenDestinyUpdates(observerSession.notifications);
  assert.equal(
    observerUpdates.some(
      (entry) => getRemoveBallsEntityIDs(entry).includes(Number(droneItem.itemID)),
    ),
    false,
    "Expected abandoned jump-detach drones to remain in observer ballparks instead of being removed",
  );
});

test("same-scene ship destruction abandons launched drones before the hull is removed", { concurrency: false }, () => {
  resetInventoryStoreForTests();
  snapshotItemsTable();
  const candidates = getActiveShipCandidates();
  assert.ok(candidates.length >= 2, "Expected at least two active ship candidates for ship destruction drone parity");
  const controllerCandidate = candidates[0];
  const observerCandidate = candidates.find(
    (entry) => Number(entry.characterID) !== Number(controllerCandidate.characterID),
  );
  assert.ok(observerCandidate, "Expected an observer candidate");
  promoteShipToDroneHull(controllerCandidate);

  const controllerSession = buildSession(controllerCandidate);
  const observerSession = buildSession(observerCandidate);
  const shipService = new ShipService();
  const droneItem = grantSingletonDrone(controllerCandidate);

  assert.equal(applyCharacterToSession(controllerSession, controllerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  }).success, true);
  assert.equal(applyCharacterToSession(observerSession, observerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  }).success, true);

  registerSession(controllerSession);
  registerSession(observerSession);
  attachSessionToScene(controllerSession, controllerCandidate.ship);
  attachSessionToScene(observerSession, observerCandidate.ship);
  finishInitialBallpark(controllerSession);
  finishInitialBallpark(observerSession);

  const launchResult = shipService.Handle_LaunchDrones(
    [[[droneItem.itemID, 1]]],
    controllerSession,
    {},
  );
  assertLaunchResultMap(launchResult, {
    [droneItem.itemID]: [droneItem.itemID],
  });

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  controllerSession.notifications.length = 0;
  observerSession.notifications.length = 0;

  const destroyResult = shipDestruction.destroySessionShip(controllerSession, {
    sessionChangeReason: "combat",
  });
  assert.equal(destroyResult && destroyResult.success, true, "Expected same-scene ship destruction to succeed");

  const abandonedDrone = scene.getEntityByID(droneItem.itemID);
  assert.ok(abandonedDrone, "Expected ship destruction to leave launched drones abandoned in space");
  assert.equal(Number(abandonedDrone.controllerID || 0), 0);
  assert.equal(Number(abandonedDrone.controllerOwnerID || 0), 0);
  assert.equal(Number(abandonedDrone.launcherID || 0), 0);
  assert.equal(Number(abandonedDrone.activityState || 0), 0);
  assert.equal(Boolean(abandonedDrone.droneStateVisible), false);

  assert.ok(
    findNotification(controllerSession, "OnDroneStateChange"),
    "Expected ship destruction to emit controller-loss drone-state cleanup before the hull disappears",
  );
  assert.ok(
    findNotification(controllerSession, "OnDroneActivityChange"),
    "Expected ship destruction to emit drone activity cleanup before the hull disappears",
  );

  const observerUpdates = flattenDestinyUpdates(observerSession.notifications);
  assert.equal(
    observerUpdates.some(
      (entry) => getRemoveBallsEntityIDs(entry).includes(Number(droneItem.itemID)),
    ),
    false,
    "Expected launched drones to remain in observer ballparks when the controlling hull is destroyed",
  );
});

test("client-style batch drone collections engage and return every launched drone", { concurrency: false }, () => {
  resetInventoryStoreForTests();
  snapshotItemsTable();
  const candidates = getActiveShipCandidates();
  assert.ok(candidates.length >= 2, "Expected at least two active ship candidates for multi-drone batch parity");
  const controllerCandidate = candidates[0];
  const targetCandidate = candidates.find(
    (entry) => Number(entry.characterID) !== Number(controllerCandidate.characterID),
  );
  assert.ok(targetCandidate, "Expected a second active ship candidate");
  promoteShipToDroneHull(controllerCandidate);

  const hobgoblinType = resolveItemByName("Hobgoblin I");
  assert.equal(hobgoblinType && hobgoblinType.success, true, "Expected Hobgoblin I metadata");
  clearShipBayItemsByType(
    controllerCandidate.characterID,
    controllerCandidate.ship.itemID,
    ITEM_FLAGS.DRONE_BAY,
    Number(hobgoblinType.match.typeID),
  );

  const controllerSession = buildSession(controllerCandidate);
  const targetSession = buildSession(targetCandidate);
  const shipService = new ShipService();
  const entityService = new EntityService();
  const droneItems = [
    grantSingletonDrone(controllerCandidate, "Hobgoblin I"),
    grantSingletonDrone(controllerCandidate, "Hobgoblin I"),
    grantSingletonDrone(controllerCandidate, "Hobgoblin I"),
  ];

  const controllerApply = applyCharacterToSession(controllerSession, controllerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(controllerApply.success, true);
  const targetApply = applyCharacterToSession(targetSession, targetCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(targetApply.success, true);

  registerSession(controllerSession);
  registerSession(targetSession);
  const controllerShipEntity = attachSessionToScene(controllerSession, controllerCandidate.ship);
  const targetShipEntity = attachSessionToScene(targetSession, targetCandidate.ship);
  const stagingOrigin = {
    x: Number(controllerShipEntity.position.x) + 5_000_000,
    y: Number(controllerShipEntity.position.y),
    z: Number(controllerShipEntity.position.z),
  };
  const controllerTeleport = spaceRuntime.teleportDynamicEntityToPoint(
    TEST_SYSTEM_ID,
    controllerShipEntity.itemID,
    stagingOrigin,
    {
      broadcast: false,
      direction: { x: 1, y: 0, z: 0 },
    },
  );
  assert.equal(controllerTeleport && controllerTeleport.success, true);
  targetShipEntity.signatureRadius = Math.max(
    Number(targetShipEntity.signatureRadius || 0),
    500,
  );
  targetShipEntity.radius = Math.max(
    Number(targetShipEntity.radius || 0),
    120,
  );
  const targetTeleport = spaceRuntime.teleportDynamicEntityToPoint(
    TEST_SYSTEM_ID,
    targetShipEntity.itemID,
    {
      x: Number(stagingOrigin.x) + 1200,
      y: Number(stagingOrigin.y),
      z: Number(stagingOrigin.z),
    },
    {
      broadcast: false,
      direction: { x: -1, y: 0, z: 0 },
    },
  );
  assert.equal(targetTeleport && targetTeleport.success, true);

  const launchResult = shipService.Handle_LaunchDrones([[
    [droneItems[0].itemID, 1],
    [droneItems[1].itemID, 1],
    [droneItems[2].itemID, 1],
  ]], controllerSession, {});
  assertLaunchResultMap(launchResult, {
    [droneItems[0].itemID]: [droneItems[0].itemID],
    [droneItems[1].itemID]: [droneItems[1].itemID],
    [droneItems[2].itemID]: [droneItems[2].itemID],
  });

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const clientStyleDroneCollection = Object.fromEntries(
    droneItems.map((item) => [item.itemID, true]),
  );
  controllerSession.notifications.length = 0;
  targetSession.notifications.length = 0;

  const engageResult = entityService.Handle_CmdEngage(
    [clientStyleDroneCollection, targetShipEntity.itemID],
    controllerSession,
    {},
  );
  assertEmptyDroneCommandResult(engageResult);

  for (const droneItem of droneItems) {
    const droneEntity = scene.getEntityByID(droneItem.itemID);
    assert.ok(droneEntity, `Expected launched drone ${droneItem.itemID} to remain in space`);
    assert.equal(Number(droneEntity.targetID), Number(targetShipEntity.itemID));
    assert.equal(droneEntity.droneCommand, "ENGAGE");
    assert.ok(
      [1, 3].includes(Number(droneEntity.activityState)),
      "Expected each engaged drone to enter combat or approach state",
    );
  }

  const returnResult = entityService.Handle_CmdReturnBay(
    [clientStyleDroneCollection],
    controllerSession,
    {},
  );
  assertEmptyDroneCommandResult(returnResult);

  for (const droneItem of droneItems) {
    const teleportResult = spaceRuntime.teleportDynamicEntityToPoint(
      TEST_SYSTEM_ID,
      droneItem.itemID,
      controllerShipEntity.position,
      {
        broadcast: false,
        direction: controllerShipEntity.direction,
      },
    );
    assert.equal(teleportResult && teleportResult.success, true);
  }
  scene.tick(scene.getCurrentWallclockMs() + 1000);

  for (const droneItem of droneItems) {
    assert.equal(
      scene.getEntityByID(droneItem.itemID),
      null,
      `Expected drone ${droneItem.itemID} to be removed from space after batch return`,
    );
  }
  assert.equal(
    getTotalQuantityInShipByType(
      controllerCandidate.characterID,
      controllerCandidate.ship.itemID,
      droneItems[0].typeID,
    ),
    3,
  );
});

test("drone launch and recall propagate AddBalls2 and RemoveBalls to already-ballparked observers", { concurrency: false }, () => {
  resetInventoryStoreForTests();
  snapshotItemsTable();
  const candidates = getActiveShipCandidates();
  assert.ok(candidates.length >= 2, "Expected at least two active ship candidates for drone observer parity");
  const controllerCandidate = candidates[0];
  const observerCandidate = candidates.find(
    (entry) => Number(entry.characterID) !== Number(controllerCandidate.characterID),
  );
  assert.ok(observerCandidate, "Expected a second active ship candidate for drone observer parity");
  promoteShipToDroneHull(controllerCandidate);

  const controllerSession = buildSession(controllerCandidate);
  const observerSession = buildSession(observerCandidate);
  const shipService = new ShipService();
  const entityService = new EntityService();
  const droneItem = grantSingletonDrone(controllerCandidate);

  const controllerApply = applyCharacterToSession(controllerSession, controllerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(controllerApply.success, true);
  const observerApply = applyCharacterToSession(observerSession, observerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(observerApply.success, true);

  registerSession(controllerSession);
  registerSession(observerSession);
  const controllerShipEntity = attachSessionToScene(controllerSession, controllerCandidate.ship);
  attachSessionToScene(observerSession, observerCandidate.ship);
  finishInitialBallpark(controllerSession);
  finishInitialBallpark(observerSession);

  controllerSession.notifications.length = 0;
  observerSession.notifications.length = 0;
  const launchResult = shipService.Handle_LaunchDrones(
    [[[droneItem.itemID, 1]]],
    controllerSession,
    {},
  );
  assertLaunchResultMap(launchResult, {
    [droneItem.itemID]: [droneItem.itemID],
  });
  assert.ok(
    flattenDestinyUpdates(observerSession.notifications).some(
      (entry) =>
        entry.name === "AddBalls2" &&
        getAddBalls2EntityIDs(entry).includes(Number(droneItem.itemID)),
    ),
    "Expected already-ballparked observers to receive AddBalls2 for launched drones",
  );

  controllerSession.notifications.length = 0;
  observerSession.notifications.length = 0;
  const returnResult = entityService.Handle_CmdReturnBay(
    [[droneItem.itemID]],
    controllerSession,
    {},
  );
  assertEmptyDroneCommandResult(returnResult);

  const teleportResult = spaceRuntime.teleportDynamicEntityToPoint(
    TEST_SYSTEM_ID,
    droneItem.itemID,
    controllerShipEntity.position,
    {
      broadcast: false,
      direction: controllerShipEntity.direction,
    },
  );
  assert.equal(teleportResult && teleportResult.success, true);
  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  scene.tick(scene.getCurrentWallclockMs() + 1000);

  assert.ok(
    flattenDestinyUpdates(observerSession.notifications).some(
      (entry) => getRemoveBallsEntityIDs(entry).includes(Number(droneItem.itemID)),
    ),
    "Expected already-ballparked observers to receive RemoveBalls when drones return to bay",
  );
});

test("drone destruction clears controller state and sends RemoveBalls to already-ballparked observers", { concurrency: false }, () => {
  resetInventoryStoreForTests();
  snapshotItemsTable();
  const candidates = getActiveShipCandidates();
  assert.ok(candidates.length >= 2, "Expected at least two active ship candidates for drone destruction parity");
  const controllerCandidate = candidates[0];
  const observerCandidate = candidates.find(
    (entry) => Number(entry.characterID) !== Number(controllerCandidate.characterID),
  );
  assert.ok(observerCandidate, "Expected a second active ship candidate for drone destruction parity");
  promoteShipToDroneHull(controllerCandidate);

  const controllerSession = buildSession(controllerCandidate);
  const observerSession = buildSession(observerCandidate);
  const shipService = new ShipService();
  const droneItem = grantSingletonDrone(controllerCandidate);

  assert.equal(applyCharacterToSession(controllerSession, controllerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  }).success, true);
  assert.equal(applyCharacterToSession(observerSession, observerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  }).success, true);

  registerSession(controllerSession);
  registerSession(observerSession);
  attachSessionToScene(controllerSession, controllerCandidate.ship);
  const observerShipEntity = attachSessionToScene(observerSession, observerCandidate.ship);
  finishInitialBallpark(controllerSession);
  finishInitialBallpark(observerSession);

  const launchResult = shipService.Handle_LaunchDrones(
    [[[droneItem.itemID, 1]]],
    controllerSession,
    {},
  );
  assertLaunchResultMap(launchResult, {
    [droneItem.itemID]: [droneItem.itemID],
  });
  controllerSession.notifications.length = 0;
  observerSession.notifications.length = 0;

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  let droneEntity = scene.getEntityByID(droneItem.itemID);
  assert.ok(droneEntity, "Expected launched drone entity before destruction");

  let safetyCounter = 0;
  while (droneEntity && safetyCounter < 16) {
    spaceRuntime.droneInterop.applyWeaponDamageToTarget(
      scene,
      observerShipEntity,
      droneEntity,
      { em: 25000, thermal: 25000, kinetic: 25000, explosive: 25000 },
      scene.getCurrentSimTimeMs() + safetyCounter,
    );
    droneEntity = scene.getEntityByID(droneItem.itemID);
    safetyCounter += 1;
  }

  assert.equal(droneEntity, null, "Expected overwhelming incoming damage to fully destroy the drone");
  const controlLostNotify = findNotification(controllerSession, "OnDroneStateChange");
  assert.ok(controlLostNotify, "Expected controller cleanup notification when the drone is destroyed");
  assert.deepEqual(controlLostNotify.payload, [
    Number(droneItem.itemID),
    0,
    0,
    0,
    Number(droneItem.typeID),
    0,
    null,
  ]);

  const activityLostNotify = findNotification(controllerSession, "OnDroneActivityChange");
  assert.ok(activityLostNotify, "Expected drone activity cleanup notification when the drone is destroyed");
  assert.deepEqual(activityLostNotify.payload, [
    Number(droneItem.itemID),
    null,
    null,
  ]);

  const observerUpdates = flattenDestinyUpdates(observerSession.notifications);
  assert.ok(
    observerUpdates.some(
      (entry) => getRemoveBallsEntityIDs(entry).includes(Number(droneItem.itemID)),
    ),
    "Expected already-ballparked observers to receive RemoveBalls when the drone is destroyed",
  );
});

test("persisted passive drone setting keeps idle drones from auto-engaging incoming attackers", { concurrency: false }, () => {
  resetInventoryStoreForTests();
  snapshotItemsTable();
  const candidates = getActiveShipCandidates();
  assert.ok(candidates.length >= 2, "Expected at least two active ship candidates for passive drone parity");
  const controllerCandidate = candidates[0];
  const attackerCandidate = candidates.find(
    (entry) => Number(entry.characterID) !== Number(controllerCandidate.characterID),
  );
  assert.ok(attackerCandidate, "Expected an attacker candidate");
  promoteShipToDroneHull(controllerCandidate);
  setCharacterDroneSettings(controllerCandidate, {
    [ATTRIBUTE_DRONE_IS_AGGRESSIVE]: false,
    [ATTRIBUTE_DRONE_FOCUS_FIRE]: false,
  });

  const controllerSession = buildSession(controllerCandidate);
  const attackerSession = buildSession(attackerCandidate);
  const shipService = new ShipService();
  const droneItem = grantSingletonDrone(controllerCandidate);

  assert.equal(applyCharacterToSession(controllerSession, controllerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  }).success, true);
  assert.equal(applyCharacterToSession(attackerSession, attackerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  }).success, true);

  registerSession(controllerSession);
  registerSession(attackerSession);
  const controllerShipEntity = attachSessionToScene(controllerSession, controllerCandidate.ship);
  const attackerShipEntity = attachSessionToScene(attackerSession, attackerCandidate.ship);
  stageShipsForLocalCombat(TEST_SYSTEM_ID, controllerShipEntity, [attackerShipEntity]);
  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);

  shipService.Handle_LaunchDrones([[[droneItem.itemID, 1]]], controllerSession, {});
  controllerSession.notifications.length = 0;
  attackerSession.notifications.length = 0;

  const initialAttackerShieldCharge = Number(
    attackerShipEntity.conditionState && attackerShipEntity.conditionState.shieldCharge,
  );
  const aggressionResult = spaceRuntime.droneInterop.applyWeaponDamageToTarget(
    scene,
    attackerShipEntity,
    controllerShipEntity,
    { em: 25 },
    scene.getCurrentSimTimeMs(),
  );
  assert.ok(aggressionResult, "Expected incoming aggression application result");

  let wallclockAt = scene.getCurrentWallclockMs();
  for (let step = 0; step < 6; step += 1) {
    wallclockAt += 1000;
    scene.tick(wallclockAt);
  }

  const droneEntity = scene.getEntityByID(droneItem.itemID);
  assert.ok(droneEntity, "Expected launched passive drone to remain in space");
  assert.equal(droneEntity.droneCommand, null);
  assert.equal(Number(droneEntity.targetID || 0), 0);
  assert.equal(Number(droneEntity.activityState), 0);
  assert.equal(
    Number(attackerShipEntity.conditionState && attackerShipEntity.conditionState.shieldCharge),
    initialAttackerShieldCharge,
    "Expected passive drones not to auto-apply damage back to the attacker",
  );
  assert.equal(
    findNotification(controllerSession, "OnDroneStateChange"),
    null,
    "Expected no drone combat state change while passive mode is enabled",
  );
});

test("persisted focus-fire setting makes aggressive idle drones converge on one hostile attacker", { concurrency: false }, () => {
  resetInventoryStoreForTests();
  snapshotItemsTable();
  const candidates = getActiveShipCandidates();
  assert.ok(candidates.length >= 2, "Expected at least two active ship candidates for focus-fire parity");
  const controllerCandidate = candidates[0];
  const attackerCandidate = candidates.find(
    (entry) => Number(entry.characterID) !== Number(controllerCandidate.characterID),
  );
  assert.ok(attackerCandidate, "Expected an attacker candidate");
  promoteShipToDroneHull(controllerCandidate);
  setCharacterDroneSettings(controllerCandidate, {
    [ATTRIBUTE_DRONE_IS_AGGRESSIVE]: true,
    [ATTRIBUTE_DRONE_FOCUS_FIRE]: true,
  });

  const controllerSession = buildSession(controllerCandidate);
  const attackerSession = buildSession(attackerCandidate);
  const shipService = new ShipService();
  const droneItemA = grantSingletonDrone(controllerCandidate);
  const droneItemB = grantSingletonDrone(controllerCandidate);

  assert.equal(applyCharacterToSession(controllerSession, controllerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  }).success, true);
  assert.equal(applyCharacterToSession(attackerSession, attackerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  }).success, true);

  registerSession(controllerSession);
  registerSession(attackerSession);
  const controllerShipEntity = attachSessionToScene(controllerSession, controllerCandidate.ship);
  const attackerShipEntity = attachSessionToScene(attackerSession, attackerCandidate.ship);
  stageShipsForLocalCombat(TEST_SYSTEM_ID, controllerShipEntity, [attackerShipEntity]);
  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);

  shipService.Handle_LaunchDrones([
    [
      [droneItemA.itemID, 1],
      [droneItemB.itemID, 1],
    ],
  ], controllerSession, {});
  controllerSession.notifications.length = 0;
  attackerSession.notifications.length = 0;

  spaceRuntime.droneInterop.applyWeaponDamageToTarget(
    scene,
    attackerShipEntity,
    controllerShipEntity,
    { em: 25 },
    scene.getCurrentSimTimeMs(),
  );

  const droneEntityA = scene.getEntityByID(droneItemA.itemID);
  const droneEntityB = scene.getEntityByID(droneItemB.itemID);
  assert.equal(droneEntityA && droneEntityA.droneCommand, "ENGAGE");
  assert.equal(droneEntityB && droneEntityB.droneCommand, "ENGAGE");
  assert.equal(Number(droneEntityA && droneEntityA.targetID), Number(attackerShipEntity.itemID));
  assert.equal(Number(droneEntityB && droneEntityB.targetID), Number(attackerShipEntity.itemID));
});

test("persisted non-focus-fire setting lets aggressive idle drones split across recent hostile attackers", { concurrency: false }, () => {
  resetInventoryStoreForTests();
  snapshotItemsTable();
  const candidates = getActiveShipCandidates();
  assert.ok(candidates.length >= 3, "Expected at least three active ship candidates for non-focus-fire parity");
  const controllerCandidate = candidates[0];
  const attackerCandidates = candidates
    .filter((entry) => Number(entry.characterID) !== Number(controllerCandidate.characterID))
    .slice(0, 2);
  assert.equal(attackerCandidates.length, 2, "Expected two attacker candidates");
  promoteShipToDroneHull(controllerCandidate);
  setCharacterDroneSettings(controllerCandidate, {
    [ATTRIBUTE_DRONE_IS_AGGRESSIVE]: true,
    [ATTRIBUTE_DRONE_FOCUS_FIRE]: false,
  });

  const controllerSession = buildSession(controllerCandidate);
  const attackerSessionA = buildSession(attackerCandidates[0]);
  const attackerSessionB = buildSession(attackerCandidates[1]);
  const shipService = new ShipService();
  const droneItemA = grantSingletonDrone(controllerCandidate);
  const droneItemB = grantSingletonDrone(controllerCandidate);

  assert.equal(applyCharacterToSession(controllerSession, controllerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  }).success, true);
  assert.equal(applyCharacterToSession(attackerSessionA, attackerCandidates[0].characterID, {
    emitNotifications: false,
    logSelection: false,
  }).success, true);
  assert.equal(applyCharacterToSession(attackerSessionB, attackerCandidates[1].characterID, {
    emitNotifications: false,
    logSelection: false,
  }).success, true);

  registerSession(controllerSession);
  registerSession(attackerSessionA);
  registerSession(attackerSessionB);
  const controllerShipEntity = attachSessionToScene(controllerSession, controllerCandidate.ship);
  const attackerShipEntityA = attachSessionToScene(attackerSessionA, attackerCandidates[0].ship);
  const attackerShipEntityB = attachSessionToScene(attackerSessionB, attackerCandidates[1].ship);
  stageShipsForLocalCombat(TEST_SYSTEM_ID, controllerShipEntity, [
    attackerShipEntityA,
    attackerShipEntityB,
  ]);
  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);

  shipService.Handle_LaunchDrones([
    [
      [droneItemA.itemID, 1],
      [droneItemB.itemID, 1],
    ],
  ], controllerSession, {});
  controllerSession.notifications.length = 0;

  spaceRuntime.droneInterop.applyWeaponDamageToTarget(
    scene,
    attackerShipEntityA,
    controllerShipEntity,
    { em: 25 },
    scene.getCurrentSimTimeMs(),
  );

  const firstTargets = [
    scene.getEntityByID(droneItemA.itemID),
    scene.getEntityByID(droneItemB.itemID),
  ].map((entity) => Number(entity && entity.targetID || 0));
  assert.equal(
    firstTargets.filter((targetID) => targetID === Number(attackerShipEntityA.itemID)).length,
    1,
    "Expected only one idle drone to pick the first hostile attacker while focus fire is disabled",
  );

  spaceRuntime.droneInterop.applyWeaponDamageToTarget(
    scene,
    attackerShipEntityB,
    controllerShipEntity,
    { em: 25 },
    scene.getCurrentSimTimeMs() + 1000,
  );

  const finalTargets = new Set(
    [
      scene.getEntityByID(droneItemA.itemID),
      scene.getEntityByID(droneItemB.itemID),
    ].map((entity) => Number(entity && entity.targetID || 0)),
  );
  assert.deepEqual(
    finalTargets,
    new Set([
      Number(attackerShipEntityA.itemID),
      Number(attackerShipEntityB.itemID),
    ]),
    "Expected aggressive non-focus-fire drones to split across the two most recent hostile attackers",
  );
});

test("entity.CmdEngage drives combat drones onto a live target with real damage and client state updates", { concurrency: false }, () => {
  resetInventoryStoreForTests();
  snapshotItemsTable();
  const candidates = getActiveShipCandidates();
  assert.ok(candidates.length >= 2, "Expected at least two active ship candidates for drone combat parity");
  const controllerCandidate = candidates[0];
  const targetCandidate = candidates.find(
    (entry) => Number(entry.characterID) !== Number(controllerCandidate.characterID),
  );
  assert.ok(targetCandidate, "Expected a second active ship candidate");
  promoteShipToDroneHull(controllerCandidate);
  setCandidateShipType(targetCandidate, "Ibis");

  const controllerSession = buildSession(controllerCandidate);
  const targetSession = buildSession(targetCandidate);
  const shipService = new ShipService();
  const entityService = new EntityService();
  const droneItem = grantSingletonDrone(controllerCandidate);

  const controllerApply = applyCharacterToSession(controllerSession, controllerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(controllerApply.success, true);
  const targetApply = applyCharacterToSession(targetSession, targetCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(targetApply.success, true);

  registerSession(controllerSession);
  registerSession(targetSession);
  const controllerShipEntity = attachSessionToScene(controllerSession, controllerCandidate.ship);
  const targetShipEntity = attachSessionToScene(targetSession, targetCandidate.ship);
  const stagingOrigin = {
    x: Number(controllerShipEntity.position.x) + 5_000_000,
    y: Number(controllerShipEntity.position.y),
    z: Number(controllerShipEntity.position.z),
  };
  const controllerTeleport = spaceRuntime.teleportDynamicEntityToPoint(
    TEST_SYSTEM_ID,
    controllerShipEntity.itemID,
    stagingOrigin,
    {
      broadcast: false,
      direction: { x: 1, y: 0, z: 0 },
    },
  );
  assert.equal(controllerTeleport && controllerTeleport.success, true);
  targetShipEntity.signatureRadius = Math.max(
    Number(targetShipEntity.signatureRadius || 0),
    500,
  );
  targetShipEntity.radius = Math.max(
    Number(targetShipEntity.radius || 0),
    120,
  );
  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);

  const targetPosition = {
    x: Number(stagingOrigin.x) + 1200,
    y: Number(stagingOrigin.y),
    z: Number(stagingOrigin.z),
  };
  const targetTeleport = spaceRuntime.teleportDynamicEntityToPoint(
    TEST_SYSTEM_ID,
    targetShipEntity.itemID,
    targetPosition,
    {
      broadcast: false,
      direction: { x: -1, y: 0, z: 0 },
    },
  );
  assert.equal(targetTeleport && targetTeleport.success, true);
  const initialTargetShieldCharge = Number(
    targetShipEntity.conditionState && targetShipEntity.conditionState.shieldCharge,
  );
  const initialTargetArmorDamage = Number(
    targetShipEntity.conditionState && targetShipEntity.conditionState.armorDamage,
  );
  const initialTargetHullDamage = Number(
    targetShipEntity.conditionState && targetShipEntity.conditionState.damage,
  );

  shipService.Handle_LaunchDrones([[[droneItem.itemID, 1]]], controllerSession, {});
  controllerSession.notifications.length = 0;
  targetSession.notifications.length = 0;

  const commandResult = entityService.Handle_CmdEngage(
    [[droneItem.itemID], targetShipEntity.itemID],
    controllerSession,
    {},
  );
  assertEmptyDroneCommandResult(commandResult);

  let wallclockAt = scene.getCurrentWallclockMs();
  let damageApplied = false;
  for (let step = 0; step < 20; step += 1) {
    wallclockAt += 1000;
    scene.tick(wallclockAt);
    const currentTargetEntity = scene.getEntityByID(targetShipEntity.itemID);
    damageApplied = Boolean(
      currentTargetEntity &&
      (
        Number(currentTargetEntity.conditionState && currentTargetEntity.conditionState.shieldCharge) <
          initialTargetShieldCharge ||
        Number(currentTargetEntity.conditionState && currentTargetEntity.conditionState.armorDamage) >
          initialTargetArmorDamage ||
        Number(currentTargetEntity.conditionState && currentTargetEntity.conditionState.damage) >
          initialTargetHullDamage
      ),
    );
    if (damageApplied) {
      break;
    }
  }

  const droneEntity = scene.getEntityByID(droneItem.itemID);
  const updatedTargetEntity = scene.getEntityByID(targetShipEntity.itemID);
  assert.ok(droneEntity, "Expected engaged drone to remain in space");
  assert.ok(updatedTargetEntity, "Expected target ship to remain in space");
  assert.equal(Number(droneEntity.targetID), Number(targetShipEntity.itemID));
  assert.equal(Number(droneEntity.activityState), 1);
  assert.equal(damageApplied, true, "Expected drone engage cycle to apply real damage");

  const engageNotify = findNotification(controllerSession, "OnDroneStateChange");
  assert.ok(engageNotify, "Expected OnDroneStateChange after drone engage");
  assert.deepEqual(engageNotify.payload, [
    Number(droneItem.itemID),
    Number(controllerCandidate.characterID),
    Number(controllerShipEntity.itemID),
    1,
    Number(droneItem.typeID),
    Number(controllerCandidate.characterID),
    Number(targetShipEntity.itemID),
  ]);

  const attackerDamageMessage = findNotification(controllerSession, "OnDamageMessage");
  assert.ok(attackerDamageMessage, "Expected attacker-side damage message from drone combat");
  assert.ok(
    getDamageMessageTotalDamage(attackerDamageMessage) > 0,
    "Expected attacker-side damage message to report applied drone damage",
  );
  const targetDamageMessage = findNotification(targetSession, "OnDamageMessage");
  assert.ok(targetDamageMessage, "Expected target-side damage message from drone combat");
  assert.ok(
    getDamageMessageTotalDamage(targetDamageMessage) > 0,
    "Expected target-side damage message to report applied drone damage",
  );
});

test("ECM drones clear locks, restrict relocks to the jamming drone, and expire after the short jam window", { concurrency: false }, () => {
  resetInventoryStoreForTests();
  snapshotItemsTable();
  const candidates = getActiveShipCandidates();
  assert.ok(candidates.length >= 2, "Expected at least two active ship candidates for drone ECM parity");
  const controllerCandidate = candidates[0];
  const targetCandidate = candidates.find(
    (entry) => Number(entry.characterID) !== Number(controllerCandidate.characterID),
  );
  assert.ok(targetCandidate, "Expected a second active ship candidate for drone ECM parity");
  promoteShipToDroneHull(controllerCandidate);

  const controllerSession = buildSession(controllerCandidate);
  const targetSession = buildSession(targetCandidate);
  const shipService = new ShipService();
  const entityService = new EntityService();
  const droneItem = grantSingletonDrone(controllerCandidate, "Hornet EC-300");

  assert.equal(applyCharacterToSession(controllerSession, controllerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  }).success, true);
  assert.equal(applyCharacterToSession(targetSession, targetCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  }).success, true);

  registerSession(controllerSession);
  registerSession(targetSession);
  const controllerShipEntity = attachSessionToScene(controllerSession, controllerCandidate.ship);
  const targetShipEntity = attachSessionToScene(targetSession, targetCandidate.ship);
  finishInitialBallpark(controllerSession);
  finishInitialBallpark(targetSession);

  const stagingOrigin = {
    x: Number(controllerShipEntity.position.x) + 5_000_000,
    y: Number(controllerShipEntity.position.y),
    z: Number(controllerShipEntity.position.z),
  };
  assert.equal(
    spaceRuntime.teleportDynamicEntityToPoint(
      TEST_SYSTEM_ID,
      controllerShipEntity.itemID,
      stagingOrigin,
      {
        broadcast: false,
        direction: { x: 1, y: 0, z: 0 },
      },
    ).success,
    true,
  );
  targetShipEntity.signatureRadius = Math.max(
    Number(targetShipEntity.signatureRadius || 0),
    500,
  );
  targetShipEntity.radius = Math.max(
    Number(targetShipEntity.radius || 0),
    120,
  );
  assert.equal(
    spaceRuntime.teleportDynamicEntityToPoint(
      TEST_SYSTEM_ID,
      targetShipEntity.itemID,
      {
        x: Number(stagingOrigin.x) + 1_200,
        y: Number(stagingOrigin.y),
        z: Number(stagingOrigin.z),
      },
      {
        broadcast: false,
        direction: { x: -1, y: 0, z: 0 },
      },
    ).success,
    true,
  );

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  scene.__jammerRandom = () => 0;
  primeTargetLock(targetShipEntity, controllerShipEntity, scene);

  shipService.Handle_LaunchDrones([[[droneItem.itemID, 1]]], controllerSession, {});
  controllerSession.notifications.length = 0;
  targetSession.notifications.length = 0;

  const commandResult = entityService.Handle_CmdEngage(
    [[droneItem.itemID], targetShipEntity.itemID],
    controllerSession,
    {},
  );
  assertEmptyDroneCommandResult(commandResult);

  let jamStarted = false;
  for (let step = 0; step < 25; step += 1) {
    advanceScene(scene, 1000);
    if (findNotification(targetSession, "OnJamStart")) {
      jamStarted = true;
      break;
    }
  }

  const droneEntity = scene.getEntityByID(droneItem.itemID);
  assert.ok(droneEntity, "Expected launched ECM drone to remain in space");
  assert.equal(jamStarted, true, "Expected ECM drone to apply a live jam");
  assert.ok(findNotification(targetSession, "OnJamStart"), "Expected target OnJamStart for ECM drone");
  assert.ok(findNotification(targetSession, "OnEwarStart"), "Expected target OnEwarStart for ECM drone");
  assert.equal(targetShipEntity.lockedTargets.size, 0, "Expected ECM drone to clear the target's active locks");
  assert.ok(
    getSpecialFxEvents(controllerSession.notifications, (entry) => (
      Number(entry.args[0]) === Number(droneItem.itemID) &&
      Number(entry.args[3]) === Number(targetShipEntity.itemID) &&
      String(entry.args[5]) === "effects.ElectronicAttributeModifyTarget"
    )).length > 0,
    "Expected controller session to receive ECM drone FX",
  );

  const blockedValidation = scene.validateTargetLockRequest(
    targetSession,
    targetShipEntity,
    controllerShipEntity,
  );
  assert.equal(blockedValidation.success, false, "Expected ECM drone to block relocking non-jammer targets");

  const allowedValidation = scene.validateTargetLockRequest(
    targetSession,
    targetShipEntity,
    droneEntity,
  );
  assert.equal(allowedValidation.success, true, "Expected ECM drone to allow locking the active jammer");

  targetSession.notifications.length = 0;
  advanceScene(scene, 5_100);
  assert.ok(findNotification(targetSession, "OnJamEnd"), "Expected ECM drone jam expiry notification");
  assert.ok(findNotification(targetSession, "OnEwarEnd"), "Expected ECM drone tactical expiry notification");

  const restoredValidation = scene.validateTargetLockRequest(
    targetSession,
    targetShipEntity,
    controllerShipEntity,
  );
  assert.equal(restoredValidation.success, true, "Expected normal locking to return after ECM drone expiry");
});

test("drone combat FX remain visible to observers under TiDi without backstepping behind live history", { concurrency: false }, () => {
  resetInventoryStoreForTests();
  snapshotItemsTable();
  const candidates = getActiveShipCandidates();
  assert.ok(candidates.length >= 2, "Expected at least two active ship candidates for drone TiDi parity");
  const controllerCandidate = candidates[0];
  const targetCandidate = candidates.find(
    (entry) => Number(entry.characterID) !== Number(controllerCandidate.characterID),
  );
  assert.ok(targetCandidate, "Expected a second active ship candidate");
  promoteShipToDroneHull(controllerCandidate);
  setCandidateShipType(targetCandidate, "Ibis");

  const controllerSession = buildSession(controllerCandidate);
  const targetSession = buildSession(targetCandidate);
  const shipService = new ShipService();
  const entityService = new EntityService();
  const droneItem = grantSingletonDrone(controllerCandidate);

  const controllerApply = applyCharacterToSession(controllerSession, controllerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(controllerApply.success, true);
  const targetApply = applyCharacterToSession(targetSession, targetCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(targetApply.success, true);

  registerSession(controllerSession);
  registerSession(targetSession);
  const controllerShipEntity = attachSessionToScene(controllerSession, controllerCandidate.ship);
  const targetShipEntity = attachSessionToScene(targetSession, targetCandidate.ship);
  finishInitialBallpark(controllerSession);
  finishInitialBallpark(targetSession);

  const stagingOrigin = {
    x: Number(controllerShipEntity.position.x) + 5_000_000,
    y: Number(controllerShipEntity.position.y),
    z: Number(controllerShipEntity.position.z),
  };
  assert.equal(
    spaceRuntime.teleportDynamicEntityToPoint(
      TEST_SYSTEM_ID,
      controllerShipEntity.itemID,
      stagingOrigin,
      {
        broadcast: false,
        direction: { x: 1, y: 0, z: 0 },
      },
    ).success,
    true,
  );
  targetShipEntity.signatureRadius = Math.max(
    Number(targetShipEntity.signatureRadius || 0),
    500,
  );
  targetShipEntity.radius = Math.max(
    Number(targetShipEntity.radius || 0),
    120,
  );
  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  assert.equal(
    spaceRuntime.teleportDynamicEntityToPoint(
      TEST_SYSTEM_ID,
      targetShipEntity.itemID,
      {
        x: Number(stagingOrigin.x) + 1200,
        y: Number(stagingOrigin.y),
        z: Number(stagingOrigin.z),
      },
      {
        broadcast: false,
        direction: { x: -1, y: 0, z: 0 },
      },
    ).success,
    true,
  );

  scene.setTimeDilation(0.5, {
    syncSessions: false,
  });
  scene.tick(scene.getCurrentWallclockMs() + 4000);

  shipService.Handle_LaunchDrones([[[droneItem.itemID, 1]]], controllerSession, {});
  controllerSession.notifications.length = 0;
  targetSession.notifications.length = 0;

  const commandResult = entityService.Handle_CmdEngage(
    [[droneItem.itemID], targetShipEntity.itemID],
    controllerSession,
    {},
  );
  assertEmptyDroneCommandResult(commandResult);

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
        Number(entry.args[0]) === Number(droneItem.itemID) &&
        Number(entry.args[3]) === Number(targetShipEntity.itemID)
      ),
    ).at(-1) || null;
    observerFx = getSpecialFxEvents(
      targetSession.notifications,
      (entry) => (
        Number(entry.args[0]) === Number(droneItem.itemID) &&
        Number(entry.args[3]) === Number(targetShipEntity.itemID)
      ),
    ).at(-1) || null;
    if (ownerFx && observerFx) {
      observerVisibleStampAtFx = scene.getCurrentVisibleSessionDestinyStamp(targetSession);
      break;
    }
  }

  assert.ok(ownerFx, "Expected owner session to receive drone combat OnSpecialFX under TiDi");
  assert.ok(observerFx, "Expected observer session to receive drone combat OnSpecialFX under TiDi");
  assert.ok(
    observerFx.stamp >= observerVisibleStampAtFx,
    "Expected observer drone combat FX not to backstep behind the live visible stamp under TiDi",
  );
  assert.ok(
    observerFx.stamp <= ((observerVisibleStampAtFx + 1) >>> 0),
    "Expected observer drone combat FX to stay within the live/next-tick history window under TiDi",
  );
});

test("entity.CmdMineRepeatedly drives ice harvesting drones onto ice and deposits yield into the controlling ship", { concurrency: false }, () => {
  const result = runDroneMiningScenario({
    shipTypeName: "Rorqual",
    droneTypeName: "Ice Harvesting Drone I",
    yieldKind: "ice",
    tickAdvanceMs: 365_000,
    maxSteps: 5,
    expectedFlagID: MINING_HOLD_FLAGS.GENERAL_MINING_HOLD,
  });

  assert.ok(result.droneEntity, "Expected mining drone to remain in space after its first mining cycle");
  assert.equal(Number(result.droneEntity.targetID), Number(result.asteroidEntry.entity.itemID));
  assert.ok(
    [2, 3].includes(Number(result.droneEntity.activityState)),
    "Expected mining drone to remain on its mining task after yield delivery",
  );
  assert.ok(
    result.finalTotalQuantity > result.initialTotalQuantity ||
      result.finalStackCount > result.initialStackCount ||
      result.receivedInventorySync,
    "Expected ice harvesting drone cycle to deposit mined ice into the controlling ship",
  );
  assert.ok(
    result.finalFlagQuantity > result.initialFlagQuantity,
    "Expected ice harvesting drone cycle to route mined ice into the Rorqual mining hold",
  );
  assert.ok(
    result.updatedMineableState &&
      Number(result.updatedMineableState.remainingQuantity) < result.initialRemainingQuantity,
    "Expected ice harvesting drone cycle to deplete chunk runtime quantity",
  );
  assert.ok(
    getSpecialFxEvents(result.session.notifications, (entry) => (
      Array.isArray(entry.args) &&
      Number(entry.args[0]) === Number(result.droneItem.itemID) &&
      Number(entry.args[3]) === Number(result.asteroidEntry.entity.itemID) &&
      Number(entry.args[7]) === 1 &&
      Number(entry.args[8]) === 1
    )).length > 0,
    "Expected mining drone cycle start to emit an active beam FX before yield delivery",
  );

  const oreMinedNotify = result.session.notifications.find(
    (entry) => entry && entry.name === "OnOreMined",
  );
  assert.ok(oreMinedNotify, "Expected mining drone yield to emit OnOreMined");
  assert.equal(
    Number(getMarshalDictEntry(oreMinedNotify.payload[0], "moduleItemID")),
    Number(result.droneItem.itemID),
    "Expected OnOreMined to identify the mining drone as the module source",
  );

  const miningNotify = findNotification(result.session, "OnDroneStateChange");
  assert.ok(miningNotify, "Expected drone state update after mining command");
  assert.deepEqual(miningNotify.payload, [
    Number(result.droneItem.itemID),
    Number(result.candidate.characterID),
    Number(result.shipEntity.itemID),
    2,
    Number(result.droneItem.typeID),
    Number(result.candidate.characterID),
    Number(result.asteroidEntry.entity.itemID),
  ]);
});

test("entity.CmdMineRepeatedly routes standard mining drones into cargo when the controlling ship has no mining hold", { concurrency: false }, () => {
  const result = runDroneMiningScenario({
    systemID: ORE_TEST_SYSTEM_ID,
    shipTypeName: "Myrmidon",
    droneTypeName: "Mining Drone I",
    yieldKind: "ore",
    tickAdvanceMs: 65_000,
    maxSteps: 6,
    expectedFlagID: ITEM_FLAGS.CARGO_HOLD,
  });

  assert.ok(result.droneEntity, "Expected mining drone to remain in space after its first ore cycle");
  assert.equal(Number(result.droneEntity.targetID), Number(result.asteroidEntry.entity.itemID));
  assert.ok(
    [2, 3].includes(Number(result.droneEntity.activityState)),
    "Expected ore mining drone to remain on task after its first delivery",
  );
  assert.ok(
    result.finalFlagQuantity > result.initialFlagQuantity,
    "Expected standard mining drone yield to land in cargo when no mining hold exists",
  );
  assert.ok(
    result.updatedMineableState &&
      Number(result.updatedMineableState.remainingQuantity) < result.initialRemainingQuantity,
    "Expected ore mining drone cycle to deplete chunk runtime quantity",
  );
});

test("entity.CmdMineRepeatedly routes excavator mining drones into the controller mining hold", { concurrency: false }, () => {
  const result = runDroneMiningScenario({
    systemID: ORE_TEST_SYSTEM_ID,
    shipTypeName: "Rorqual",
    droneTypeName: "Excavator Mining Drone",
    yieldKind: "ore",
    tickAdvanceMs: 65_000,
    maxSteps: 6,
    expectedFlagID: MINING_HOLD_FLAGS.GENERAL_MINING_HOLD,
  });

  assert.ok(result.droneEntity, "Expected excavator to remain in space after its first ore cycle");
  assert.equal(Number(result.droneEntity.targetID), Number(result.asteroidEntry.entity.itemID));
  assert.ok(
    [2, 3].includes(Number(result.droneEntity.activityState)),
    "Expected excavator to remain on task after ore delivery",
  );
  assert.ok(
    result.finalFlagQuantity > result.initialFlagQuantity,
    "Expected excavator yield to route into the Rorqual mining hold",
  );
  assert.ok(
    result.updatedMineableState &&
      Number(result.updatedMineableState.remainingQuantity) < result.initialRemainingQuantity,
    "Expected excavator cycle to deplete chunk runtime quantity",
  );
});

test("entity.CmdMineRepeatedly idles a mining drone after it depletes its target", { concurrency: false }, () => {
  const result = runDroneMiningScenario({
    systemID: ORE_TEST_SYSTEM_ID,
    shipTypeName: "Myrmidon",
    droneTypeName: "Mining Drone I",
    yieldKind: "ore",
    targetRemainingQuantity: 1,
    tickAdvanceMs: 65_000,
    maxSteps: 2,
    expectedFlagID: ITEM_FLAGS.CARGO_HOLD,
  });

  assert.ok(result.droneEntity, "Expected depleted-target mining drone to remain in space");
  assert.equal(Number(result.droneEntity.activityState), 0);
  assert.equal(result.droneEntity.targetID, null);
  assert.equal(result.droneEntity.droneMining, null);
  assert.equal(result.droneEntity.droneCommand, null);
  assert.ok(
    result.finalFlagQuantity > result.initialFlagQuantity || result.receivedInventorySync,
    "Expected self-depleting mining drone to deliver ore before idling",
  );
  assert.equal(
    result.scene.getEntityByID(result.asteroidEntry.entity.itemID),
    null,
    "Expected depleted asteroid to be removed from space",
  );
  assert.ok(
    flattenDestinyUpdates(result.session.notifications)
      .some((update) => getRemoveBallsEntityIDs(update).includes(result.asteroidEntry.entity.itemID)),
    "Expected drone-depleted asteroid to emit RemoveBalls",
  );

  const idleNotify = findNotification(result.session, "OnDroneStateChange");
  assert.ok(idleNotify, "Expected idle OnDroneStateChange after drone depletion");
  assert.deepEqual(idleNotify.payload, [
    Number(result.droneItem.itemID),
    Number(result.candidate.characterID),
    Number(result.shipEntity.itemID),
    0,
    Number(result.droneItem.typeID),
    Number(result.candidate.characterID),
    null,
  ]);
});

test("entity.CmdMineRepeatedly idles a mining drone when another miner depletes its target", { concurrency: false }, () => {
  const result = runDroneMiningScenario({
    systemID: ORE_TEST_SYSTEM_ID,
    shipTypeName: "Myrmidon",
    droneTypeName: "Mining Drone I",
    yieldKind: "ore",
    targetRemainingQuantity: 1,
    skipMiningTicks: true,
    expectedFlagID: ITEM_FLAGS.CARGO_HOLD,
  });

  assert.ok(result.droneEntity, "Expected mining drone to be in space before external depletion");
  assert.equal(Number(result.droneEntity.targetID), Number(result.asteroidEntry.entity.itemID));
  assert.ok([2, 3].includes(Number(result.droneEntity.activityState)));

  const depletionResult = applyMiningDelta(
    result.scene,
    result.asteroidEntry.entity,
    result.initialRemainingQuantity,
    0,
    {
      broadcast: true,
      nowMs: result.scene.getCurrentSimTimeMs() + 1000,
    },
  );
  assert.equal(depletionResult.success, true, "Expected external depletion delta to succeed");
  assert.equal(depletionResult.data.depleted, true, "Expected external depletion delta to remove the target");
  flushDirectDestinyNotifications(result.scene);

  const droneEntity = result.scene.getEntityByID(result.droneItem.itemID);
  assert.ok(droneEntity, "Expected externally stopped mining drone to remain in space");
  assert.equal(Number(droneEntity.activityState), 0);
  assert.equal(droneEntity.targetID, null);
  assert.equal(droneEntity.droneMining, null);
  assert.equal(droneEntity.droneCommand, null);

  const idleNotify = findNotification(result.session, "OnDroneStateChange");
  assert.ok(idleNotify, "Expected idle OnDroneStateChange after external depletion");
  assert.deepEqual(idleNotify.payload, [
    Number(result.droneItem.itemID),
    Number(result.candidate.characterID),
    Number(result.shipEntity.itemID),
    0,
    Number(result.droneItem.typeID),
    Number(result.candidate.characterID),
    null,
  ]);
  assert.ok(
    flattenDestinyUpdates(result.session.notifications)
      .some((update) => getRemoveBallsEntityIDs(update).includes(result.asteroidEntry.entity.itemID)),
    "Expected externally depleted asteroid to emit RemoveBalls",
  );

  advanceScene(result.scene, 130_000);
  const finalFlagQuantity = getTotalQuantityInShipByTypeAndFlag(
    result.shipEntity.itemID,
    result.yieldTypeID,
    ITEM_FLAGS.CARGO_HOLD,
  );
  assert.equal(
    finalFlagQuantity,
    result.initialFlagQuantity,
    "Expected externally idled drone not to grant ore on a stale later cycle",
  );
});
