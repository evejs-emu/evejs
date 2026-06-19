const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const transitions = require(path.join(repoRoot, "server/src/space/transitions"));
const {
  buildShipItem,
  findItemById,
  resetInventoryStoreForTests,
  setActiveShipForCharacter,
} = require(path.join(repoRoot, "server/src/services/inventory/itemStore"));
const {
  getActiveShipRecord,
} = require(path.join(repoRoot, "server/src/services/character/characterState"));

const TEST_CHARACTER_ID = 991234001;
const TEST_CURRENT_SHIP_ID = 991234101;
const TEST_TARGET_SHIP_ID = 991234102;
const TEST_TARGET_MODULE_ID = 991234201;
const TEST_SYSTEM_ID = 30000142;
const TEST_STATION_ID = 60003760;

function readOptionalTableEntry(table, key) {
  const result = database.read(table, `/${key}`);
  return result && result.success ? result.data : null;
}

function writeTransientTableEntry(table, key, value) {
  const result = database.write(table, `/${key}`, value);
  assert.equal(result && result.success, true, `expected ${table}/${key} write to succeed`);
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

function extractAddBallsEntityIDs(entry) {
  if (!entry || entry.name !== "AddBalls2" || !Array.isArray(entry.args)) {
    return [];
  }

  const addBallsState = Array.isArray(entry.args[0]) ? entry.args[0] : null;
  const ballList =
    addBallsState &&
    typeof addBallsState[1] === "object" &&
    Array.isArray(addBallsState[1].items)
      ? addBallsState[1].items
      : [];

  const extractDictValue = (dictLike, key) => {
    if (
      !dictLike ||
      dictLike.type !== "dict" ||
      !Array.isArray(dictLike.entries)
    ) {
      return undefined;
    }
    const entry = dictLike.entries.find((pair) => Array.isArray(pair) && pair[0] === key);
    return entry ? entry[1] : undefined;
  };
  const extractNumericValue = (value) => {
    if (value && typeof value === "object" && "value" in value) {
      return Number(value.value);
    }
    return Number(value);
  };

  return ballList
    .map((ballEntry) => (Array.isArray(ballEntry) ? ballEntry[0] : ballEntry))
    .map((slimItem) => extractNumericValue(extractDictValue(slimItem, "itemID")))
    .filter((itemID) => Number.isInteger(itemID) && itemID > 0);
}

function extractRemoveBallsEntityIDs(entry) {
  if (!entry || entry.name !== "RemoveBalls" || !Array.isArray(entry.args)) {
    return [];
  }

  const entityIDs = entry.args[0];
  const items = entityIDs && entityIDs.type === "list" && Array.isArray(entityIDs.items)
    ? entityIDs.items
    : [];
  return items
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
}

test.afterEach(() => {
  spaceRuntime._testing.clearScenes();
  resetInventoryStoreForTests();
});

test("same-scene boarding flushes ship swap without resetting the owner ballpark", () => {
  const originalCharacter = readOptionalTableEntry("characters", TEST_CHARACTER_ID);
  const originalCurrentShip = readOptionalTableEntry("items", TEST_CURRENT_SHIP_ID);
  const originalTargetShip = readOptionalTableEntry("items", TEST_TARGET_SHIP_ID);
  const originalTargetModule = readOptionalTableEntry("items", TEST_TARGET_MODULE_ID);

  try {
    writeTransientTableEntry("characters", TEST_CHARACTER_ID, {
      characterID: TEST_CHARACTER_ID,
      characterName: "Boarding Parity Test",
      corporationID: 1000009,
      allianceID: null,
      warFactionID: null,
      raceID: 1,
      bloodlineID: 1,
      gender: 1,
      stationID: null,
      solarSystemID: TEST_SYSTEM_ID,
      worldSpaceID: 0,
      shipID: TEST_CURRENT_SHIP_ID,
      shipTypeID: 606,
      shipName: "Current Ship",
      homeStationID: TEST_STATION_ID,
      cloneStationID: TEST_STATION_ID,
      securityStatus: 0,
      securityRating: 0,
    });
    writeTransientTableEntry("items", TEST_CURRENT_SHIP_ID, buildShipItem({
      itemID: TEST_CURRENT_SHIP_ID,
      typeID: 606,
      ownerID: TEST_CHARACTER_ID,
      locationID: TEST_SYSTEM_ID,
      flagID: 0,
      itemName: "Current Ship",
      spaceState: {
        systemID: TEST_SYSTEM_ID,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
        targetPoint: { x: 0, y: 0, z: 0 },
        mode: "STOP",
        speedFraction: 0,
      },
      conditionState: {
        damage: 0,
        charge: 1,
        armorDamage: 0,
        shieldCharge: 1,
        incapacitated: false,
      },
    }));
    writeTransientTableEntry("items", TEST_TARGET_SHIP_ID, buildShipItem({
      itemID: TEST_TARGET_SHIP_ID,
      typeID: 606,
      ownerID: TEST_CHARACTER_ID,
      locationID: TEST_SYSTEM_ID,
      flagID: 0,
      itemName: "Target Ship",
      spaceState: {
        systemID: TEST_SYSTEM_ID,
        position: { x: 1500, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
        targetPoint: { x: 1500, y: 0, z: 0 },
        mode: "STOP",
        speedFraction: 0,
      },
      conditionState: {
        damage: 0,
        charge: 1,
        armorDamage: 0,
        shieldCharge: 1,
        incapacitated: false,
      },
    }));
    writeTransientTableEntry("items", TEST_TARGET_MODULE_ID, {
      itemID: TEST_TARGET_MODULE_ID,
      typeID: 12052,
      ownerID: TEST_CHARACTER_ID,
      locationID: TEST_TARGET_SHIP_ID,
      flagID: 27,
      groupID: 46,
      categoryID: 7,
      quantity: 0,
      stacksize: 1,
      singleton: 1,
      launcherID: 0,
      itemName: "100MN Afterburner II",
      moduleState: {
        damage: 0,
        armorDamage: 0,
        shieldCharge: 0,
        incapacitated: false,
      },
    });
    resetInventoryStoreForTests();

    const activeResult = setActiveShipForCharacter(TEST_CHARACTER_ID, TEST_CURRENT_SHIP_ID);
    assert.equal(activeResult && activeResult.success, true);

    const currentShip = getActiveShipRecord(TEST_CHARACTER_ID);
    assert.ok(currentShip, "expected current ship to be active");

    const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
    const notifications = [];
    const session = {
      clientID: TEST_CHARACTER_ID + 880000,
      characterID: TEST_CHARACTER_ID,
      charid: TEST_CHARACTER_ID,
      characterName: "Boarding Parity Test",
      corporationID: 1000009,
      allianceID: 0,
      warFactionID: 0,
      solarsystemid: TEST_SYSTEM_ID,
      solarsystemid2: TEST_SYSTEM_ID,
      shipName: currentShip.itemName,
      socket: { destroyed: false },
      notifications,
      sendNotification(name, idType, payload) {
        notifications.push({ name, idType, payload });
      },
      sendSessionChange(changes, options = {}) {
        notifications.push({ name: "SessionChange", changes, options });
      },
    };

    const currentEntity = spaceRuntime.attachSession(session, currentShip, {
      systemID: TEST_SYSTEM_ID,
      broadcast: false,
      spawnStopped: true,
    });
    assert.ok(currentEntity, "expected current ship attach to succeed");

    const spawnResult = spaceRuntime.spawnDynamicInventoryEntity(TEST_SYSTEM_ID, TEST_TARGET_SHIP_ID, {
      broadcast: false,
    });
    assert.equal(spawnResult && spawnResult.success, true, "expected target ship spawn to succeed");

    session._space.initialStateSent = true;
    session._space.initialBallparkVisualsSent = true;
    session._space.initialBallparkClockSynced = true;
    session._space.beyonceBound = true;
    notifications.length = 0;
    let liveStampedBoardedAddBalls = false;
    let bootstrapBoardedAddBalls = false;
    const originalBuildAddBallsUpdatesForSession =
      scene.buildAddBallsUpdatesForSession.bind(scene);
    const originalBuildSessionStampedAddBallsUpdatesForSession =
      scene.buildSessionStampedAddBallsUpdatesForSession.bind(scene);
    scene.buildAddBallsUpdatesForSession = (localSession, entities, options = {}) => {
      if (
        localSession === session &&
        Array.isArray(entities) &&
        entities.some((entity) => Number(entity && entity.itemID) === TEST_TARGET_SHIP_ID)
      ) {
        bootstrapBoardedAddBalls = true;
      }
      return originalBuildAddBallsUpdatesForSession(localSession, entities, options);
    };
    scene.buildSessionStampedAddBallsUpdatesForSession = (
      localSession,
      entities,
      stamp,
      options = {},
    ) => {
      if (
        localSession === session &&
        Array.isArray(entities) &&
        entities.some((entity) => Number(entity && entity.itemID) === TEST_TARGET_SHIP_ID)
      ) {
        liveStampedBoardedAddBalls = true;
      }
      return originalBuildSessionStampedAddBallsUpdatesForSession(
        localSession,
        entities,
        stamp,
        options,
      );
    };

    try {
      const boardResult = transitions.boardSpaceShip(session, TEST_TARGET_SHIP_ID);
      assert.equal(boardResult && boardResult.success, true, "expected same-scene boarding to succeed");
      scene.flushDirectDestinyNotificationBatch();
    } finally {
      scene.buildAddBallsUpdatesForSession = originalBuildAddBallsUpdatesForSession;
      scene.buildSessionStampedAddBallsUpdatesForSession =
        originalBuildSessionStampedAddBallsUpdatesForSession;
    }

    const sessionChangeIndex = notifications.findIndex((notification) => (
      notification &&
      notification.name === "SessionChange" &&
      notification.changes &&
      Array.isArray(notification.changes.shipid) &&
      Number(notification.changes.shipid[1]) === TEST_TARGET_SHIP_ID
    ));
    const addBallsIndex = notifications.findIndex((notification) => (
      notification &&
      notification.name === "DoDestinyUpdate" &&
      flattenDestinyUpdates([notification]).some((entry) => (
        entry &&
        entry.name === "AddBalls2" &&
        extractAddBallsEntityIDs(entry).includes(TEST_TARGET_SHIP_ID)
      ))
    ));
    const fittingBootstrapIndex = notifications.findIndex((notification) => (
      notification &&
      notification.name === "OnItemChange" &&
      Array.isArray(notification.payload) &&
      notification.payload[0] &&
      notification.payload[0].fields &&
      Number(notification.payload[0].fields.locationID) === TEST_TARGET_SHIP_ID &&
      Number(notification.payload[0].fields.itemID) === TEST_TARGET_MODULE_ID
    ));
    const setStateIndex = notifications.findIndex((notification) => (
      notification &&
      notification.name === "DoDestinyUpdate" &&
      flattenDestinyUpdates([notification]).some((entry) => (
        entry &&
        entry.name === "SetState"
      ))
    ));
    const boardedRemoveBallsIndex = notifications.findIndex((notification) => (
      notification &&
      notification.name === "DoDestinyUpdate" &&
      flattenDestinyUpdates([notification]).some((entry) => (
        entry &&
        entry.name === "RemoveBalls" &&
        extractRemoveBallsEntityIDs(entry).includes(TEST_TARGET_SHIP_ID)
      ))
    ));

    assert.notEqual(sessionChangeIndex, -1, "expected a shipid session change for the boarded ship");
    const sessionChangeNotification = notifications[sessionChangeIndex];
    assert.deepEqual(
      sessionChangeNotification && sessionChangeNotification.options &&
        sessionChangeNotification.options.nodesOfInterest,
      [],
      "expected same-scene boarding to use TQ's empty nodes-of-interest SessionChange routing",
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        (sessionChangeNotification && sessionChangeNotification.options) || {},
        "sessionId",
      ),
      false,
      "expected same-scene boarding to preserve the live session id",
    );
    assert.equal(
      setStateIndex,
      -1,
      "expected same-scene boarding to avoid owner SetState resets after the shipid handoff",
    );
    assert.equal(
      boardedRemoveBallsIndex,
      -1,
      "expected same-scene boarding to keep the newly boarded ego hull in Michelle",
    );
    assert.equal(
      session._space.visibleDynamicEntityIDs.has(TEST_TARGET_SHIP_ID),
      false,
      "expected the boarded ego hull to leave non-ego visibility bookkeeping silently",
    );
    assert.equal(
      fittingBootstrapIndex,
      -1,
      "expected same-scene boarding to rely on the active-ship prime, not a synthetic fitting repair",
    );
    if (addBallsIndex !== -1) {
      if (sessionChangeIndex < addBallsIndex) {
        assert.ok(
          sessionChangeIndex < addBallsIndex,
          "expected post-handoff boarded ego AddBalls2 to follow the shipid session change",
        );
      } else {
        assert.ok(
          addBallsIndex < sessionChangeIndex,
          "expected pre-handoff target visibility AddBalls2 to finish before the shipid session change",
        );
      }
    } else {
      assert.equal(
        liveStampedBoardedAddBalls,
        true,
        "expected the boarded ego hull to have been sent before the handoff when it was not already visible",
      );
    }
    assert.equal(
      liveStampedBoardedAddBalls,
      true,
      "expected same-scene boarding to seed the new ego hull through the live stamped AddBalls path",
    );
    assert.equal(
      bootstrapBoardedAddBalls,
      false,
      "expected same-scene boarding to avoid bootstrap-acquire AddBalls for the new ego hull",
    );
  } finally {
    if (originalCharacter) {
      writeTransientTableEntry("characters", TEST_CHARACTER_ID, originalCharacter);
    } else {
      database.remove("characters", `/${TEST_CHARACTER_ID}`);
    }
    if (originalCurrentShip) {
      writeTransientTableEntry("items", TEST_CURRENT_SHIP_ID, originalCurrentShip);
    } else {
      database.remove("items", `/${TEST_CURRENT_SHIP_ID}`);
    }
    if (originalTargetShip) {
      writeTransientTableEntry("items", TEST_TARGET_SHIP_ID, originalTargetShip);
    } else {
      database.remove("items", `/${TEST_TARGET_SHIP_ID}`);
    }
    if (originalTargetModule) {
      writeTransientTableEntry("items", TEST_TARGET_MODULE_ID, originalTargetModule);
    } else {
      database.remove("items", `/${TEST_TARGET_MODULE_ID}`);
    }
  }
});

test("same-scene boarding from a capsule consumes the previous pod and removes its ball", () => {
  const testCharacterID = TEST_CHARACTER_ID + 1;
  const testCapsuleID = TEST_CURRENT_SHIP_ID + 1000;
  const testShipID = TEST_TARGET_SHIP_ID + 1000;
  const originalCharacter = readOptionalTableEntry("characters", testCharacterID);
  const originalCapsule = readOptionalTableEntry("items", testCapsuleID);
  const originalTargetShip = readOptionalTableEntry("items", testShipID);

  try {
    writeTransientTableEntry("characters", testCharacterID, {
      characterID: testCharacterID,
      characterName: "Boarding Capsule Consume Test",
      corporationID: 1000009,
      allianceID: null,
      warFactionID: null,
      raceID: 1,
      bloodlineID: 1,
      gender: 1,
      stationID: null,
      solarSystemID: TEST_SYSTEM_ID,
      worldSpaceID: 0,
      shipID: testCapsuleID,
      shipTypeID: 670,
      shipName: "Capsule",
      homeStationID: TEST_STATION_ID,
      cloneStationID: TEST_STATION_ID,
      securityStatus: 0,
      securityRating: 0,
    });
    writeTransientTableEntry("items", testCapsuleID, buildShipItem({
      itemID: testCapsuleID,
      typeID: 670,
      ownerID: testCharacterID,
      locationID: TEST_SYSTEM_ID,
      flagID: 0,
      itemName: "Capsule",
      spaceState: {
        systemID: TEST_SYSTEM_ID,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
        targetPoint: { x: 0, y: 0, z: 0 },
        mode: "STOP",
        speedFraction: 0,
      },
      conditionState: {
        damage: 0,
        charge: 1,
        armorDamage: 0,
        shieldCharge: 1,
        incapacitated: false,
      },
    }));
    writeTransientTableEntry("items", testShipID, buildShipItem({
      itemID: testShipID,
      typeID: 606,
      ownerID: testCharacterID,
      locationID: TEST_SYSTEM_ID,
      flagID: 0,
      itemName: "Boarded Ship",
      spaceState: {
        systemID: TEST_SYSTEM_ID,
        position: { x: 1500, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
        targetPoint: { x: 1500, y: 0, z: 0 },
        mode: "STOP",
        speedFraction: 0,
      },
      conditionState: {
        damage: 0,
        charge: 1,
        armorDamage: 0,
        shieldCharge: 1,
        incapacitated: false,
      },
    }));
    resetInventoryStoreForTests();

    const activeResult = setActiveShipForCharacter(testCharacterID, testCapsuleID);
    assert.equal(activeResult && activeResult.success, true);

    const currentShip = getActiveShipRecord(testCharacterID);
    assert.ok(currentShip, "expected capsule to be active");

    const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
    const notifications = [];
    const session = {
      clientID: testCharacterID + 880100,
      characterID: testCharacterID,
      charid: testCharacterID,
      characterName: "Boarding Capsule Consume Test",
      corporationID: 1000009,
      allianceID: 0,
      warFactionID: 0,
      solarsystemid: TEST_SYSTEM_ID,
      solarsystemid2: TEST_SYSTEM_ID,
      shipName: currentShip.itemName,
      socket: { destroyed: false },
      notifications,
      sendNotification(name, idType, payload) {
        notifications.push({ name, idType, payload });
      },
      sendSessionChange(changes, options = {}) {
        notifications.push({ name: "SessionChange", changes, options });
      },
    };

    const currentEntity = spaceRuntime.attachSession(session, currentShip, {
      systemID: TEST_SYSTEM_ID,
      broadcast: false,
      spawnStopped: true,
    });
    assert.ok(currentEntity, "expected capsule attach to succeed");

    const spawnResult = spaceRuntime.spawnDynamicInventoryEntity(TEST_SYSTEM_ID, testShipID, {
      broadcast: false,
    });
    assert.equal(spawnResult && spawnResult.success, true, "expected target ship spawn to succeed");

    session._space.initialStateSent = true;
    session._space.initialBallparkVisualsSent = true;
    session._space.initialBallparkClockSynced = true;
    session._space.beyonceBound = true;
    notifications.length = 0;

    const boardResult = transitions.boardSpaceShip(session, testShipID);
    assert.equal(boardResult && boardResult.success, true, "expected capsule boarding to succeed");
    scene.flushDirectDestinyNotificationBatch();

    const setStateIndex = notifications.findIndex((notification) => (
      notification &&
      notification.name === "DoDestinyUpdate" &&
      flattenDestinyUpdates([notification]).some((entry) => (
        entry &&
        entry.name === "SetState"
      ))
    ));
    const removeBallsIndex = notifications.findIndex((notification) => (
      notification &&
      notification.name === "DoDestinyUpdate" &&
      flattenDestinyUpdates([notification]).some((entry) => (
        entry &&
        entry.name === "RemoveBalls" &&
        extractRemoveBallsEntityIDs(entry).includes(testCapsuleID)
      ))
    ));
    const boardedRemoveBallsIndex = notifications.findIndex((notification) => (
      notification &&
      notification.name === "DoDestinyUpdate" &&
      flattenDestinyUpdates([notification]).some((entry) => (
        entry &&
        entry.name === "RemoveBalls" &&
        extractRemoveBallsEntityIDs(entry).includes(testShipID)
      ))
    ));
    assert.equal(
      setStateIndex,
      -1,
      "expected capsule boarding to consume the pod without a Michelle SetState reset",
    );
    assert.notEqual(removeBallsIndex, -1, "expected the consumed capsule to be removed from Michelle");
    assert.equal(
      boardedRemoveBallsIndex,
      -1,
      "expected capsule-to-ship boarding to keep the newly boarded ego hull in Michelle",
    );
    assert.equal(
      findItemById(testCapsuleID),
      null,
      "expected the consumed capsule item to be removed from inventory state",
    );
    assert.equal(
      scene.getEntityByID(testCapsuleID),
      null,
      "expected the consumed capsule entity to be removed from the scene",
    );
    assert.equal(
      Number(session._space.shipID),
      testShipID,
      "expected the session to remain bound to the boarded ship",
    );
    assert.equal(
      session._space.visibleDynamicEntityIDs.has(testShipID),
      false,
      "expected the boarded ship to leave non-ego visibility bookkeeping silently",
    );
  } finally {
    resetInventoryStoreForTests();
    if (originalCharacter) {
      writeTransientTableEntry("characters", testCharacterID, originalCharacter);
    } else {
      database.remove("characters", `/${testCharacterID}`);
    }
    if (originalCapsule) {
      writeTransientTableEntry("items", testCapsuleID, originalCapsule);
    } else {
      database.remove("items", `/${testCapsuleID}`);
    }
    if (originalTargetShip) {
      writeTransientTableEntry("items", testShipID, originalTargetShip);
    } else {
      database.remove("items", `/${testShipID}`);
    }
    resetInventoryStoreForTests();
  }
});

test("AIR tutorial boarding only exposes the owner Astero to the boarding helper", () => {
  const testCharacterID = TEST_CHARACTER_ID + 2;
  const foreignCharacterID = TEST_CHARACTER_ID + 3;
  const testCapsuleID = TEST_CURRENT_SHIP_ID + 2000;
  const ownAsteroID = TEST_TARGET_SHIP_ID + 2000;
  const foreignAsteroID = TEST_TARGET_SHIP_ID + 2001;
  const originalCharacter = readOptionalTableEntry("characters", testCharacterID);
  const originalForeignCharacter = readOptionalTableEntry("characters", foreignCharacterID);
  const originalCapsule = readOptionalTableEntry("items", testCapsuleID);
  const originalOwnAstero = readOptionalTableEntry("items", ownAsteroID);
  const originalForeignAstero = readOptionalTableEntry("items", foreignAsteroID);

  try {
    writeTransientTableEntry("characters", testCharacterID, {
      characterID: testCharacterID,
      characterName: "AIR Owner Boarding Test",
      corporationID: 1000009,
      allianceID: null,
      warFactionID: null,
      raceID: 1,
      bloodlineID: 1,
      gender: 1,
      stationID: null,
      solarSystemID: TEST_SYSTEM_ID,
      worldSpaceID: 0,
      shipID: testCapsuleID,
      shipTypeID: 670,
      shipName: "Capsule",
      homeStationID: TEST_STATION_ID,
      cloneStationID: TEST_STATION_ID,
      securityStatus: 0,
      securityRating: 0,
    });
    writeTransientTableEntry("characters", foreignCharacterID, {
      characterID: foreignCharacterID,
      characterName: "AIR Foreign Boarding Test",
      corporationID: 1000009,
      allianceID: null,
      warFactionID: null,
      raceID: 1,
      bloodlineID: 1,
      gender: 1,
      stationID: null,
      solarSystemID: TEST_SYSTEM_ID,
      worldSpaceID: 0,
      shipID: foreignAsteroID,
      shipTypeID: 58745,
      shipName: "AIR Civilian Astero",
      homeStationID: TEST_STATION_ID,
      cloneStationID: TEST_STATION_ID,
      securityStatus: 0,
      securityRating: 0,
    });
    writeTransientTableEntry("items", testCapsuleID, buildShipItem({
      itemID: testCapsuleID,
      typeID: 670,
      ownerID: testCharacterID,
      locationID: TEST_SYSTEM_ID,
      flagID: 0,
      itemName: "Capsule",
      spaceState: {
        systemID: TEST_SYSTEM_ID,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
        targetPoint: { x: 0, y: 0, z: 0 },
        mode: "STOP",
        speedFraction: 0,
      },
      conditionState: {
        damage: 0,
        charge: 1,
        armorDamage: 0,
        shieldCharge: 1,
        incapacitated: false,
      },
    }));
    for (const [itemID, ownerID] of [
      [ownAsteroID, testCharacterID],
      [foreignAsteroID, foreignCharacterID],
    ]) {
      writeTransientTableEntry("items", itemID, buildShipItem({
        itemID,
        typeID: 58745,
        ownerID,
        locationID: TEST_SYSTEM_ID,
        flagID: 0,
        itemName: "AIR Civilian Astero",
        spaceState: {
          systemID: TEST_SYSTEM_ID,
          position: { x: 1500, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          direction: { x: 1, y: 0, z: 0 },
          targetPoint: { x: 1500, y: 0, z: 0 },
          mode: "STOP",
          speedFraction: 0,
        },
        conditionState: {
          damage: 0,
          charge: 1,
          armorDamage: 0.375,
          shieldCharge: 0,
          incapacitated: false,
        },
      }));
    }
    resetInventoryStoreForTests();

    const activeResult = setActiveShipForCharacter(testCharacterID, testCapsuleID);
    assert.equal(activeResult && activeResult.success, true);
    const currentShip = getActiveShipRecord(testCharacterID);
    assert.ok(currentShip, "expected capsule to be active");

    const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
    const notifications = [];
    const session = {
      clientID: testCharacterID + 880200,
      characterID: testCharacterID,
      charid: testCharacterID,
      characterName: "AIR Owner Boarding Test",
      corporationID: 1000009,
      allianceID: 0,
      warFactionID: 0,
      solarsystemid: TEST_SYSTEM_ID,
      solarsystemid2: TEST_SYSTEM_ID,
      shipName: currentShip.itemName,
      socket: { destroyed: false },
      notifications,
      sendNotification(name, idType, payload) {
        notifications.push({ name, idType, payload });
      },
      sendSessionChange(changes, options = {}) {
        notifications.push({ name: "SessionChange", changes, options });
      },
    };

    const currentEntity = spaceRuntime.attachSession(session, currentShip, {
      systemID: TEST_SYSTEM_ID,
      broadcast: false,
      spawnStopped: true,
    });
    assert.ok(currentEntity, "expected capsule attach to succeed");

    assert.equal(
      spaceRuntime.spawnDynamicInventoryEntity(TEST_SYSTEM_ID, foreignAsteroID, {
        broadcast: false,
      }).success,
      true,
      "expected foreign AIR Astero spawn to succeed",
    );
    assert.equal(
      spaceRuntime.spawnDynamicInventoryEntity(TEST_SYSTEM_ID, ownAsteroID, {
        broadcast: false,
      }).success,
      true,
      "expected owner AIR Astero spawn to succeed",
    );

    const visibleIDs = scene
      .getVisibleDynamicEntitiesForSession(session)
      .map((entity) => Number(entity.itemID));
    assert.equal(
      visibleIDs.includes(foreignAsteroID),
      false,
      "foreign AIR tutorial Asteros must not be visible to this character",
    );
    assert.equal(
      visibleIDs.includes(ownAsteroID),
      true,
      "the owner AIR tutorial Astero should remain visible and boardable",
    );

    const foreignBoardResult = transitions.boardSpaceShip(session, foreignAsteroID);
    assert.equal(
      foreignBoardResult && foreignBoardResult.success,
      false,
      "shared boarding must still reject a direct foreign-Astero board request",
    );
    assert.equal(foreignBoardResult && foreignBoardResult.errorMsg, "SHIP_NOT_OWNED");

    session._space.initialStateSent = true;
    session._space.initialBallparkVisualsSent = true;
    session._space.initialBallparkClockSynced = true;
    session._space.beyonceBound = true;
    notifications.length = 0;

    const ownBoardResult = transitions.boardSpaceShip(session, ownAsteroID);
    assert.equal(
      ownBoardResult && ownBoardResult.success,
      true,
      "expected shared boarding to accept the owner AIR Astero",
    );
  } finally {
    resetInventoryStoreForTests();
    for (const [table, key, value] of [
      ["characters", testCharacterID, originalCharacter],
      ["characters", foreignCharacterID, originalForeignCharacter],
      ["items", testCapsuleID, originalCapsule],
      ["items", ownAsteroID, originalOwnAstero],
      ["items", foreignAsteroID, originalForeignAstero],
    ]) {
      if (value) {
        writeTransientTableEntry(table, key, value);
      } else {
        database.remove(table, `/${key}`);
      }
    }
    resetInventoryStoreForTests();
  }
});
