const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const shipDestruction = require(path.join(
  repoRoot,
  "server/src/space/shipDestruction",
));
const transitions = require(path.join(
  repoRoot,
  "server/src/space/transitions",
));
const {
  getCharacterRecord,
  getActiveShipRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  buildShipItem,
  CAPSULE_TYPE_ID,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  CLIENT_GENERIC_WRECK_PROFILE_RADII_METERS,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/wreckRadius",
));
const {
  hasDamageableHealth,
} = require(path.join(
  repoRoot,
  "server/src/space/combat/damage",
));
const {
  getTypeAttributeValue,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
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
const POD_KILL_TEST_CHARACTER_ID = 990901001;
const POD_KILL_TEST_CAPSULE_ID = 990901101;
const POD_KILL_TEST_SYSTEM_ID = 30000142;
const POD_KILL_TEST_STATION_ID = 60003760;

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

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
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
    sendServiceNotification(serviceName, methodName, payload) {
      serviceNotifications.push({ serviceName, methodName, payload });
    },
  };

  entity.session = session;
  scene.spawnDynamicEntity(entity, { broadcast: false });
  scene.sessions.set(clientID, session);
  return { session, notifications, serviceNotifications };
}

function buildVictimSession(characterRecord, shipItem, clientID) {
  const notifications = [];
  const serviceNotifications = [];
  const sessionChanges = [];
  return {
    clientID,
    userid: characterRecord.characterID || POD_KILL_TEST_CHARACTER_ID,
    characterID: characterRecord.characterID || POD_KILL_TEST_CHARACTER_ID,
    charid: characterRecord.characterID || POD_KILL_TEST_CHARACTER_ID,
    characterName: characterRecord.characterName || "Pod Test Victim",
    corporationID: characterRecord.corporationID || 0,
    allianceID: characterRecord.allianceID || 0,
    warFactionID: characterRecord.warFactionID || 0,
    homeStationID: POD_KILL_TEST_STATION_ID,
    homestationid: POD_KILL_TEST_STATION_ID,
    cloneStationID: POD_KILL_TEST_STATION_ID,
    clonestationid: POD_KILL_TEST_STATION_ID,
    stationid: null,
    stationID: null,
    stationid2: null,
    locationid: POD_KILL_TEST_SYSTEM_ID,
    solarsystemid: POD_KILL_TEST_SYSTEM_ID,
    solarsystemid2: POD_KILL_TEST_SYSTEM_ID,
    shipID: shipItem.itemID,
    shipid: shipItem.itemID,
    activeShipID: shipItem.itemID,
    shipTypeID: shipItem.typeID,
    shipName: shipItem.itemName,
    socket: { destroyed: false },
    notifications,
    serviceNotifications,
    sessionChanges,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendServiceNotification(serviceName, methodName, payload) {
      serviceNotifications.push({ serviceName, methodName, payload });
    },
    sendSessionChange(changes, options = {}) {
      sessionChanges.push({ changes, options });
    },
  };
}

function readOptionalTableEntry(table, entryID) {
  const readResult = database.read(table, `/${entryID}`);
  return readResult.success ? cloneValue(readResult.data) : null;
}

function writeTransientTableEntry(table, entryID, value) {
  const writeResult = database.write(table, `/${entryID}`, value, {
    transient: true,
  });
  assert.equal(
    writeResult.success,
    true,
    `Failed to write transient ${table}/${entryID}`,
  );
}

function cleanupOwnedItems(ownerID) {
  const itemsResult = database.read("items", "/");
  assert.equal(itemsResult.success, true);
  const ownedItemIDs = Object.values(itemsResult.data || {})
    .map((item) => Number(item && item.itemID))
    .filter((itemID) => Number.isInteger(itemID) && itemID > 0)
    .filter((itemID) => {
      const itemResult = database.read("items", `/${itemID}`);
      return (
        itemResult.success &&
        Number(itemResult.data && itemResult.data.ownerID) === ownerID
      );
    })
    .sort((left, right) => right - left);

  for (const itemID of ownedItemIDs) {
    database.remove("items", `/${itemID}`);
  }
}

function advanceScene(scene, deltaMs) {
  const baseWallclock = Number(scene.lastWallclockTickAt) || scene.getCurrentWallclockMs();
  scene.tick(baseWallclock + Math.max(0, Number(deltaMs) || 0));
}

function flattenDestinyUpdates(notifications) {
  const updates = [];
  for (const notification of notifications || []) {
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
    const functions = [];
    for (const entry of entries) {
      const payload = Array.isArray(entry) ? entry[1] : null;
      if (!Array.isArray(payload) || typeof payload[0] !== "string") {
        continue;
      }
      functions.push({
        name: payload[0],
        args: Array.isArray(payload[1]) ? payload[1] : [],
      });
    }
    updates.push(functions);
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

  const removedIDs = Array.isArray(entry.args[0])
    ? entry.args[0]
    : entry.args[0] &&
        typeof entry.args[0] === "object" &&
        entry.args[0].type === "list" &&
        Array.isArray(entry.args[0].items)
      ? entry.args[0].items
      : [];
  return removedIDs
    .map((itemID) => Number(itemID))
    .filter((itemID) => Number.isInteger(itemID) && itemID > 0);
}

test.afterEach(() => {
  shipDestruction._testing.clearPendingDeathTests();
  spaceRuntime._testing.clearScenes();
});

test("ship wreck resolution prefers race and hull class over the generic Wreck fallback", () => {
  assert.equal(
    shipDestruction._testing.resolveShipWreckType(16236).name,
    "Amarr Destroyer Wreck",
  );
  assert.equal(
    shipDestruction._testing.resolveShipWreckType(24698).name,
    "Caldari Battlecruiser Wreck",
  );
  assert.equal(
    shipDestruction._testing.resolveShipWreckType(19720).name,
    "Amarr Dreadnought Wreck",
  );
  assert.equal(
    shipDestruction._testing.resolveShipWreckType(11567).name,
    "Amarr Titan Wreck",
  );
  assert.equal(
    shipDestruction._testing.resolveShipWreckType(52907).name,
    "Triglavian Dreadnought Wreck",
  );
  assert.equal(
    shipDestruction._testing.resolveShipWreckType(81040).name,
    "Upwell Freighter Wreck",
  );
  assert.equal(
    shipDestruction._testing.resolveShipWreckType(87381).name,
    "Angel Dreadnought Wreck",
  );
  assert.equal(
    shipDestruction._testing.resolveShipWreckType(78576).name,
    "Angel Titan Wreck",
  );
  assert.equal(
    shipDestruction._testing.resolveShipWreckType(42241).name,
    "Blood Titan Wreck",
  );
  assert.equal(
    shipDestruction._testing.resolveShipWreckType(42243).name,
    "Blood Dreadnought Wreck",
  );
  assert.equal(
    shipDestruction._testing.resolveShipWreckType(45647).name,
    "Guristas Dreadnought Wreck",
  );
  assert.equal(
    shipDestruction._testing.resolveShipWreckType(42126).name,
    "Serpentis Titan Wreck",
  );
  assert.equal(
    shipDestruction._testing.resolveShipWreckType(45649).name,
    "Guristas Titan Wreck",
  );
  assert.equal(
    shipDestruction._testing.resolveShipWreckType(42124).name,
    "Serpentis Dreadnought Wreck",
  );
  assert.equal(
    shipDestruction._testing.resolveShipWreckType(42125).name,
    "Serpentis Supercarrier Wreck",
  );
  assert.equal(
    shipDestruction._testing.resolveShipWreckType(34495).name,
    "Drifter Battleship Wreck",
  );
  assert.equal(
    shipDestruction._testing.resolveShipWreckType(47153).name,
    "Drifter Cruiser Wreck",
  );
  assert.equal(
    shipDestruction._testing.resolveShipWreckType(47722).name,
    "Drifter Cruiser Wreck",
  );
  assert.equal(
    shipDestruction._testing.resolveShipWreckType(37473).name,
    "Drifter Response Battleship Wreck",
  );
  assert.equal(
    shipDestruction._testing.resolveShipWreckType(86498).name,
    "Drifter Response Battleship Wreck",
  );
  assert.equal(
    shipDestruction._testing.resolveShipWreckType(47724).name,
    "Drifter Battleship Wreck",
  );
  assert.equal(
    shipDestruction._testing.resolveShipWreckType(47958).name,
    "Drifter Cruiser Wreck",
  );
  assert.equal(
    shipDestruction._testing.resolveShipWreckType(47959).name,
    "Drifter Cruiser Wreck",
  );
  assert.equal(
    shipDestruction._testing.resolveShipWreckType(47960).name,
    "Drifter Cruiser Wreck",
  );
  assert.equal(
    shipDestruction._testing.resolveShipWreckType(56217).name,
    "Drifter Battleship Wreck",
  );
  assert.equal(
    shipDestruction._testing.resolveShipWreckType(56219).name,
    "Drifter Battleship Wreck",
  );
  assert.equal(
    shipDestruction._testing.resolveShipWreckType(56220).name,
    "Drifter Cruiser Wreck",
  );
  assert.equal(
    shipDestruction._testing.resolveShipWreckType(56221).name,
    "Drifter Cruiser Wreck",
  );
  assert.equal(
    shipDestruction._testing.resolveShipWreckType(56222).name,
    "Drifter Cruiser Wreck",
  );
  assert.equal(
    shipDestruction._testing.resolveShipWreckType(87612).name,
    "Drifter Battleship Wreck",
  );
  assert.equal(
    shipDestruction._testing.resolveShipWreckType(88153).name,
    "Drifter Small Wreck",
  );
  assert.equal(
    shipDestruction._testing.resolveShipWreckType(88154).name,
    "Strategos Dreadnought Wreck",
  );
});

test("ship wreck resolution uses exact ship-named wrecks before racial hull fallbacks", () => {
  const expectedWrecks = new Map([
    [92822, [95232, "Salvation Wreck"]],
    [92823, [95233, "Simurgh Wreck"]],
    [92824, [95230, "Gaia Wreck"]],
    [92825, [95231, "Ymir Wreck"]],
  ]);

  for (const [shipTypeID, [wreckTypeID, wreckName]] of expectedWrecks) {
    const wreckType = shipDestruction._testing.resolveShipWreckType(shipTypeID);
    assert.ok(wreckType, `Expected wreck mapping for ship type ${shipTypeID}`);
    assert.equal(wreckType.typeID, wreckTypeID);
    assert.equal(wreckType.name, wreckName);
  }
});

test("ship destruction broadcasts the explosion/removal before the spawned wreck and keeps the wreck dogma signature radius", () => {
  const scene = spaceRuntime.ensureScene(30000142);
  const observer = buildShipEntity(scene, 980001, 0, {
    typeID: 606,
    characterID: 140000004,
  });
  const observerSession = attachSession(scene, observer, 1, 140000004);
  const victim = buildShipEntity(scene, 980002, 15_000, {
    typeID: 16236,
  });

  scene.spawnDynamicEntity(victim, { broadcast: false });
  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  observerSession.notifications.length = 0;

  const destroyResult = shipDestruction._testing.destroyShipEntityWithWreck(
    30000142,
    victim,
    {
      ownerCharacterID: 140000004,
    },
  );

  assert.equal(destroyResult.success, true);

  const wreckEntity = scene.getEntityByID(destroyResult.data.wreck.itemID);
  assert.ok(wreckEntity);
  assert.equal(wreckEntity.kind, "wreck");
  assert.equal(wreckEntity.itemName, "Amarr Destroyer Wreck");
  assert.equal(wreckEntity.radius, victim.radius);
  assert.equal(
    wreckEntity.signatureRadius,
    getTypeAttributeValue(destroyResult.data.wreck.typeID, "signatureRadius"),
  );

  const flattened = flattenDestinyUpdates(observerSession.notifications).flat();
  const destructionIndex = flattened.findIndex(
    (entry) => entry.name === "TerminalPlayDestructionEffect",
  );
  const removeIndex = flattened.findIndex((entry) => entry.name === "RemoveBalls");
  const addIndex = flattened.findIndex((entry) => (
    entry.name === "AddBalls2" &&
    extractAddBallsEntityIDs(entry).includes(Number(destroyResult.data.wreck.itemID))
  ));

  assert.notEqual(destructionIndex, -1);
  assert.notEqual(removeIndex, -1);
  assert.notEqual(addIndex, -1);
  assert.ok(destructionIndex < addIndex);
  assert.ok(removeIndex < addIndex);
});

test("transient non-character-owned dummy hulls still drop wrecks on destruction", () => {
  const testOwnerID = 991234567;
  const scene = spaceRuntime.ensureScene(30000142);
  const observer = buildShipEntity(scene, 980101, -5_000, {
    typeID: 606,
    characterID: 140000004,
  });
  const observerSession = attachSession(scene, observer, 101, 140000004);
  const dummy = buildShipEntity(scene, 980102, 5_000, {
    typeID: 24698,
  });
  dummy.ownerID = testOwnerID;
  dummy.transient = true;

  try {
    cleanupOwnedItems(testOwnerID);
    scene.spawnDynamicEntity(dummy, { broadcast: false });
    scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
    observerSession.notifications.length = 0;

    const destroyResult = shipDestruction._testing.destroyShipEntityWithWreck(
      30000142,
      dummy,
      {
        ownerCharacterID: testOwnerID,
      },
    );

    assert.equal(destroyResult.success, true);
    assert.ok(destroyResult.data && destroyResult.data.wreck);
    assert.equal(
      Boolean(destroyResult.data.transientFallback),
      false,
      "Expected dummy destruction to stay on the real wreck path",
    );

    const wreckEntity = scene.getEntityByID(destroyResult.data.wreck.itemID);
    assert.ok(wreckEntity, "Expected the spawned wreck to materialize in the scene");
    assert.equal(wreckEntity.kind, "wreck");

    const flattened = flattenDestinyUpdates(observerSession.notifications).flat();
    assert.equal(
      flattened.some((entry) => (
        entry.name === "AddBalls2" &&
        extractAddBallsEntityIDs(entry).includes(Number(destroyResult.data.wreck.itemID))
      )),
      true,
      "Expected observers to receive the wreck acquire for the destroyed dummy",
    );
  } finally {
    cleanupOwnedItems(testOwnerID);
  }
});

test("death-test multi-hull detonation keeps wreck visuals visible to nearby observers", async () => {
  const scene = spaceRuntime.ensureScene(30000142);
  const anchor = buildShipEntity(scene, 990011, 0, {
    typeID: 606,
    characterID: 140000004,
  });
  const anchorSession = attachSession(scene, anchor, 11, 140000004);
  const observer = buildShipEntity(scene, 990012, 1_000, {
    typeID: 606,
    characterID: 140000005,
  });
  const observerSession = attachSession(scene, observer, 12, 140000005);

  const spawnResult = shipDestruction.spawnShipDeathTestField(anchorSession.session, {
    shipType: {
      typeID: 16236,
      groupID: 420,
      categoryID: 6,
      name: "Coercer",
    },
    count: 6,
    delayMs: 2_000,
  });

  assert.equal(spawnResult.success, true);
  assert.equal(spawnResult.data.spawned.length, 6);

  anchorSession.notifications.length = 0;
  observerSession.notifications.length = 0;

  let completion = null;
  spawnResult.data.completionPromise.then((value) => {
    completion = value;
  });

  const remainingSimMs = Math.max(
    0,
    Number(spawnResult.data.detonateAtSimMs || 0) - Number(scene.simTimeMs || 0),
  );
  const remainingWallclockMs = Math.ceil(
    remainingSimMs / Math.max(scene.getTimeDilation(), 0.000001),
  );
  advanceScene(scene, remainingWallclockMs + 5);
  shipDestruction._testing.processPendingDeathTests();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.ok(completion);
  assert.equal(completion.destroyed.length, 6);

  const expectedWreckIDs = new Set(
    completion.destroyed.map((entry) => Number(entry && entry.wreckID) || 0),
  );
  const observerFlattened = flattenDestinyUpdates(observerSession.notifications).flat();
  const observedWreckIDs = new Set(
    observerFlattened
      .filter((entry) => entry && entry.name === "AddBalls2")
      .flatMap((entry) => extractAddBallsEntityIDs(entry))
      .filter((entityID) => expectedWreckIDs.has(Number(entityID) || 0)),
  );

  assert.equal(
    observedWreckIDs.size,
    expectedWreckIDs.size,
    "Expected nearby observers to receive AddBalls2 for every /deathtest wreck",
  );
});

test("dynamic exploding removals survive an owner held-future presented lane", () => {
  const scene = spaceRuntime.ensureScene(POD_KILL_TEST_SYSTEM_ID);
  const owner = buildShipEntity(scene, 980101, 0, {
    typeID: 606,
    characterID: 140000004,
  });
  const ownerSession = attachSession(scene, owner, 501, 140000004);
  const doomedHull = buildShipEntity(scene, 980102, 15_000, {
    typeID: 11567,
  });

  scene.spawnDynamicEntity(doomedHull, { broadcast: false });
  ownerSession.session._space.visibleDynamicEntityIDs = new Set([doomedHull.itemID]);
  ownerSession.notifications.length = 0;

  const nowMs = scene.getCurrentSimTimeMs();
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(
    ownerSession.session,
    nowMs,
  );
  ownerSession.session._space.destinyAuthorityState = {
    ...(ownerSession.session._space.destinyAuthorityState || {}),
    lastPresentedStamp: (currentSessionStamp + 3) >>> 0,
    lastNonCriticalStamp: (currentSessionStamp + 3) >>> 0,
    lastRawDispatchStamp: scene.getCurrentDestinyStamp(nowMs),
    heldQueueState: {
      active: false,
      queuedCount: 0,
      lastQueueStamp: 0,
    },
  };
  ownerSession.session._space.lastSentDestinyStamp = (currentSessionStamp + 3) >>> 0;
  ownerSession.session._space.lastSentDestinyRawDispatchStamp =
    scene.getCurrentDestinyStamp(nowMs);
  ownerSession.session._space.lastSentDestinyWasOwnerCritical = false;
  ownerSession.session._space.lastSentDestinyOnlyStaleProjectedOwnerMissileLane = false;

  scene.broadcastRemoveBall(doomedHull.itemID, null, {
    terminalDestructionEffectID: 3,
    visibilityEntity: doomedHull,
    nowMs,
  });

  const flattened = flattenDestinyUpdates(ownerSession.notifications).flat();
  const destroyEntry = flattened.find((entry) => (
    entry.name === "TerminalPlayDestructionEffect" &&
    Number(entry.args && entry.args[0]) === doomedHull.itemID
  ));
  const removeEntry = flattened.find((entry) => (
    extractRemoveBallsEntityIDs(entry).includes(doomedHull.itemID)
  ));

  assert.ok(
    destroyEntry,
    "expected destruction FX to survive the owner's already-presented death lane",
  );
  assert.ok(
    removeEntry,
    "expected RemoveBalls to survive instead of leaving a ghost hull burning for the owner",
  );
});

test("same-scene ship destruction uses a remote-style shipid session change during eject", () => {
  const testCharacterID = 990901201;
  const testShipID = 990901301;
  const originalCharacter = readOptionalTableEntry("characters", testCharacterID);
  const originalShip = readOptionalTableEntry("items", testShipID);
  const originalSkills = readOptionalTableEntry("skills", testCharacterID);

  try {
    writeTransientTableEntry("characters", testCharacterID, {
      characterID: testCharacterID,
      characterName: "Ship Death Test Victim",
      corporationID: 1000009,
      allianceID: null,
      warFactionID: null,
      raceID: 1,
      bloodlineID: 1,
      gender: 1,
      stationID: null,
      solarSystemID: POD_KILL_TEST_SYSTEM_ID,
      worldSpaceID: 0,
      shipID: testShipID,
      shipTypeID: 606,
      shipName: "Rifter",
      homeStationID: POD_KILL_TEST_STATION_ID,
      cloneStationID: POD_KILL_TEST_STATION_ID,
      securityStatus: 0,
      securityRating: 0,
    });
    writeTransientTableEntry(
      "items",
      testShipID,
      buildShipItem({
        itemID: testShipID,
        typeID: 606,
        ownerID: testCharacterID,
        locationID: POD_KILL_TEST_SYSTEM_ID,
        flagID: 0,
        itemName: "Rifter",
        spaceState: {
          systemID: POD_KILL_TEST_SYSTEM_ID,
          position: { x: 15_000, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          direction: { x: 1, y: 0, z: 0 },
          targetPoint: { x: 15_000, y: 0, z: 0 },
          speedFraction: 0,
          mode: "STOP",
        },
        conditionState: {
          damage: 0,
          charge: 1,
          armorDamage: 0,
          shieldCharge: 1,
          incapacitated: false,
        },
      }),
    );

    const characterRecord = getCharacterRecord(testCharacterID);
    const activeShip = getActiveShipRecord(testCharacterID);
    assert.ok(characterRecord);
    assert.ok(activeShip);

    const victimSession = buildVictimSession(
      characterRecord,
      activeShip,
      testCharacterID + 17,
    );
    const victimEntity = spaceRuntime.attachSession(victimSession, activeShip, {
      systemID: POD_KILL_TEST_SYSTEM_ID,
      broadcast: false,
      spawnStopped: true,
    });
    assert.ok(victimEntity);
    victimSession._space.initialStateSent = true;
    victimSession._space.initialBallparkVisualsSent = true;
    victimSession._space.initialBallparkClockSynced = true;
    victimSession._space.beyonceBound = true;

    const destroyResult = shipDestruction.destroySessionShip(victimSession, {
      sessionChangeReason: "combat",
    });
    assert.equal(destroyResult.success, true);

    const shipSwapChange = victimSession.sessionChanges.find((entry) => (
      entry &&
      entry.changes &&
      entry.changes.shipid &&
      Number(entry.changes.shipid[0]) === testShipID &&
      Number(entry.changes.shipid[1]) === Number(destroyResult.data.capsule.itemID)
    ));
    assert.ok(shipSwapChange, "expected eject to publish a shipid session change");
    assert.equal(
      shipSwapChange.options && shipSwapChange.options.sessionId,
      0n,
      "expected same-scene eject to use the remote-style sessionId=0 notification path",
    );
  } finally {
    cleanupOwnedItems(testCharacterID);

    if (originalCharacter) {
      writeTransientTableEntry("characters", testCharacterID, originalCharacter);
    } else {
      database.remove("characters", `/${testCharacterID}`);
    }

    if (originalShip) {
      writeTransientTableEntry("items", testShipID, originalShip);
    } else {
      database.remove("items", `/${testShipID}`);
    }

    if (originalSkills) {
      writeTransientTableEntry("skills", testCharacterID, originalSkills);
    } else {
      database.remove("skills", `/${testCharacterID}`);
    }
  }
});

test("same-scene ship destruction explicitly seeds the victim capsule ego ball", () => {
  const testCharacterID = 990901231;
  const testShipID = 990901331;
  const originalCharacter = readOptionalTableEntry("characters", testCharacterID);
  const originalShip = readOptionalTableEntry("items", testShipID);
  const originalSkills = readOptionalTableEntry("skills", testCharacterID);
  const scene = spaceRuntime.ensureScene(POD_KILL_TEST_SYSTEM_ID);

  try {
    writeTransientTableEntry("characters", testCharacterID, {
      characterID: testCharacterID,
      characterName: "Victim Ego Ball Test",
      corporationID: 1000009,
      allianceID: null,
      warFactionID: null,
      raceID: 1,
      bloodlineID: 1,
      gender: 1,
      stationID: null,
      solarSystemID: POD_KILL_TEST_SYSTEM_ID,
      worldSpaceID: 0,
      shipID: testShipID,
      shipTypeID: 606,
      shipName: "Rifter",
      homeStationID: POD_KILL_TEST_STATION_ID,
      cloneStationID: POD_KILL_TEST_STATION_ID,
      securityStatus: 0,
      securityRating: 0,
    });
    writeTransientTableEntry(
      "items",
      testShipID,
      buildShipItem({
        itemID: testShipID,
        typeID: 606,
        ownerID: testCharacterID,
        locationID: POD_KILL_TEST_SYSTEM_ID,
        flagID: 0,
        itemName: "Rifter",
        spaceState: {
          systemID: POD_KILL_TEST_SYSTEM_ID,
          position: { x: 15_000, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          direction: { x: 1, y: 0, z: 0 },
          targetPoint: { x: 15_000, y: 0, z: 0 },
          speedFraction: 0,
          mode: "STOP",
        },
        conditionState: {
          damage: 0,
          charge: 1,
          armorDamage: 0,
          shieldCharge: 1,
          incapacitated: false,
        },
      }),
    );

    const characterRecord = getCharacterRecord(testCharacterID);
    const activeShip = getActiveShipRecord(testCharacterID);
    assert.ok(characterRecord);
    assert.ok(activeShip);

    const victimSession = buildVictimSession(
      characterRecord,
      activeShip,
      testCharacterID + 37,
    );
    const victimEntity = spaceRuntime.attachSession(victimSession, activeShip, {
      systemID: POD_KILL_TEST_SYSTEM_ID,
      broadcast: false,
      spawnStopped: true,
    });
    assert.ok(victimEntity);
    victimSession._space.initialStateSent = true;
    victimSession._space.initialBallparkVisualsSent = true;
    victimSession._space.initialBallparkClockSynced = true;
    victimSession._space.beyonceBound = true;

    const destroyResult = shipDestruction.destroySessionShip(victimSession, {
      sessionChangeReason: "combat",
    });
    assert.equal(destroyResult.success, true);

    const flattened = flattenDestinyUpdates(victimSession.notifications).flat();
    const destroyedShipID = Number(activeShip.itemID);
    const capsuleID = Number(destroyResult.data.capsule.itemID);
    const destructionIndex = flattened.findIndex((entry) => (
      entry.name === "TerminalPlayDestructionEffect" &&
      Number(entry.args && entry.args[0]) === destroyedShipID
    ));
    const postDestroyCapsuleAddIndex = flattened.findIndex((entry, index) => (
      index > destructionIndex &&
      extractAddBallsEntityIDs(entry).includes(capsuleID)
    ));

    assert.ok(
      flattened.some((entry) => entry.name === "AddBalls2"),
      "expected same-scene eject to seed the victim capsule into Michelle with AddBalls2",
    );
    assert.notEqual(
      destructionIndex,
      -1,
      "expected the victim to receive the destroyed hull explosion event",
    );
    assert.notEqual(
      postDestroyCapsuleAddIndex,
      -1,
      "expected ship destruction to reseed the victim capsule after the hull dies",
    );
  } finally {
    cleanupOwnedItems(testCharacterID);

    if (originalCharacter) {
      writeTransientTableEntry("characters", testCharacterID, originalCharacter);
    } else {
      database.remove("characters", `/${testCharacterID}`);
    }

    if (originalShip) {
      writeTransientTableEntry("items", testShipID, originalShip);
    } else {
      database.remove("items", `/${testShipID}`);
    }

    if (originalSkills) {
      writeTransientTableEntry("skills", testCharacterID, originalSkills);
    } else {
      database.remove("skills", `/${testCharacterID}`);
    }
  }
});

test("same-scene ship destruction removes the victim's abandoned hull ball after eject", () => {
  const testCharacterID = 990901234;
  const testShipID = 990901334;
  const originalCharacter = readOptionalTableEntry("characters", testCharacterID);
  const originalShip = readOptionalTableEntry("items", testShipID);
  const originalSkills = readOptionalTableEntry("skills", testCharacterID);

  try {
    writeTransientTableEntry("characters", testCharacterID, {
      characterID: testCharacterID,
      characterName: "Victim Hull Removal Test",
      corporationID: 1000009,
      allianceID: null,
      warFactionID: null,
      raceID: 1,
      bloodlineID: 1,
      gender: 1,
      stationID: null,
      solarSystemID: POD_KILL_TEST_SYSTEM_ID,
      worldSpaceID: 0,
      shipID: testShipID,
      shipTypeID: 606,
      shipName: "Rifter",
      homeStationID: POD_KILL_TEST_STATION_ID,
      cloneStationID: POD_KILL_TEST_STATION_ID,
      securityStatus: 0,
      securityRating: 0,
    });
    writeTransientTableEntry(
      "items",
      testShipID,
      buildShipItem({
        itemID: testShipID,
        typeID: 606,
        ownerID: testCharacterID,
        locationID: POD_KILL_TEST_SYSTEM_ID,
        flagID: 0,
        itemName: "Rifter",
        spaceState: {
          systemID: POD_KILL_TEST_SYSTEM_ID,
          position: { x: 15_000, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          direction: { x: 1, y: 0, z: 0 },
          targetPoint: { x: 15_000, y: 0, z: 0 },
          speedFraction: 0,
          mode: "STOP",
        },
        conditionState: {
          damage: 0,
          charge: 1,
          armorDamage: 0,
          shieldCharge: 1,
          incapacitated: false,
        },
      }),
    );

    const characterRecord = getCharacterRecord(testCharacterID);
    const activeShip = getActiveShipRecord(testCharacterID);
    assert.ok(characterRecord);
    assert.ok(activeShip);

    const victimSession = buildVictimSession(
      characterRecord,
      activeShip,
      testCharacterID + 39,
    );
    const victimEntity = spaceRuntime.attachSession(victimSession, activeShip, {
      systemID: POD_KILL_TEST_SYSTEM_ID,
      broadcast: false,
      spawnStopped: true,
    });
    assert.ok(victimEntity);
    victimSession._space.initialStateSent = true;
    victimSession._space.initialBallparkVisualsSent = true;
    victimSession._space.initialBallparkClockSynced = true;
    victimSession._space.beyonceBound = true;

    const destroyResult = shipDestruction.destroySessionShip(victimSession, {
      sessionChangeReason: "combat",
    });
    assert.equal(destroyResult.success, true);

    const flattened = flattenDestinyUpdates(victimSession.notifications).flat();
    const destroyedShipID = Number(activeShip.itemID);
    const destructionIndex = flattened.findIndex((entry) => (
      entry.name === "TerminalPlayDestructionEffect" &&
      Number(entry.args && entry.args[0]) === destroyedShipID
    ));
    const removeIndex = flattened.findIndex((entry) => (
      extractRemoveBallsEntityIDs(entry).includes(destroyedShipID)
    ));

    assert.notEqual(
      destructionIndex,
      -1,
      "expected same-scene destruction to send the victim hull explosion effect",
    );
    assert.notEqual(
      removeIndex,
      -1,
      "expected same-scene destruction to RemoveBalls the victim's abandoned hull",
    );
    assert.ok(
      destructionIndex < removeIndex,
      "expected hull RemoveBalls to follow the destruction effect for the victim",
    );
  } finally {
    cleanupOwnedItems(testCharacterID);

    if (originalCharacter) {
      writeTransientTableEntry("characters", testCharacterID, originalCharacter);
    } else {
      database.remove("characters", `/${testCharacterID}`);
    }

    if (originalShip) {
      writeTransientTableEntry("items", testShipID, originalShip);
    } else {
      database.remove("items", `/${testShipID}`);
    }

    if (originalSkills) {
      writeTransientTableEntry("skills", testCharacterID, originalSkills);
    } else {
      database.remove("skills", `/${testCharacterID}`);
    }
  }
});

test("same-scene eject swaps to the capsule without an owner SetState rebuild", () => {
  const testCharacterID = 990901232;
  const testShipID = 990901332;
  const originalCharacter = readOptionalTableEntry("characters", testCharacterID);
  const originalShip = readOptionalTableEntry("items", testShipID);
  const originalSkills = readOptionalTableEntry("skills", testCharacterID);

  try {
    writeTransientTableEntry("characters", testCharacterID, {
      characterID: testCharacterID,
      characterName: "Same Scene Eject Test",
      corporationID: 1000009,
      allianceID: null,
      warFactionID: null,
      raceID: 1,
      bloodlineID: 1,
      gender: 1,
      stationID: null,
      solarSystemID: POD_KILL_TEST_SYSTEM_ID,
      worldSpaceID: 0,
      shipID: testShipID,
      shipTypeID: 606,
      shipName: "Rifter",
      homeStationID: POD_KILL_TEST_STATION_ID,
      cloneStationID: POD_KILL_TEST_STATION_ID,
      securityStatus: 0,
      securityRating: 0,
    });
    writeTransientTableEntry(
      "items",
      testShipID,
      buildShipItem({
        itemID: testShipID,
        typeID: 606,
        ownerID: testCharacterID,
        locationID: POD_KILL_TEST_SYSTEM_ID,
        flagID: 0,
        itemName: "Rifter",
        spaceState: {
          systemID: POD_KILL_TEST_SYSTEM_ID,
          position: { x: 17_000, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          direction: { x: 1, y: 0, z: 0 },
          targetPoint: { x: 17_000, y: 0, z: 0 },
          speedFraction: 0,
          mode: "STOP",
        },
        conditionState: {
          damage: 0,
          charge: 1,
          armorDamage: 0,
          shieldCharge: 1,
          incapacitated: false,
        },
      }),
    );

    const characterRecord = getCharacterRecord(testCharacterID);
    const activeShip = getActiveShipRecord(testCharacterID);
    assert.ok(characterRecord);
    assert.ok(activeShip);

    const victimSession = buildVictimSession(
      characterRecord,
      activeShip,
      testCharacterID + 38,
    );
    const victimEntity = spaceRuntime.attachSession(victimSession, activeShip, {
      systemID: POD_KILL_TEST_SYSTEM_ID,
      broadcast: false,
      spawnStopped: true,
    });
    assert.ok(victimEntity);
    victimSession._space.initialStateSent = true;
    victimSession._space.initialBallparkVisualsSent = true;
    victimSession._space.initialBallparkClockSynced = true;
    victimSession._space.beyonceBound = true;
    victimSession.notifications.length = 0;

    const ejectResult = transitions.ejectSession(victimSession);
    assert.equal(ejectResult.success, true);

    const flattened = flattenDestinyUpdates(victimSession.notifications).flat();
    const capsuleID = Number(ejectResult.data.capsule.itemID);
    assert.ok(
      flattened.some((entry) => extractAddBallsEntityIDs(entry).includes(capsuleID)),
      "expected same-scene eject to seed the new capsule ball",
    );
    assert.equal(
      flattened.some((entry) => entry.name === "SetState"),
      false,
      "expected same-scene eject not to send an owner SetState rebase",
    );
  } finally {
    cleanupOwnedItems(testCharacterID);

    if (originalCharacter) {
      writeTransientTableEntry("characters", testCharacterID, originalCharacter);
    } else {
      database.remove("characters", `/${testCharacterID}`);
    }

    if (originalShip) {
      writeTransientTableEntry("items", testShipID, originalShip);
    } else {
      database.remove("items", `/${testShipID}`);
    }

    if (originalSkills) {
      writeTransientTableEntry("skills", testCharacterID, originalSkills);
    } else {
      database.remove("skills", `/${testCharacterID}`);
    }
  }
});

test("same-scene eject repairs stale bootstrap flags without an owner SetState rebuild", () => {
  const testCharacterID = 990901233;
  const testShipID = 990901333;
  const originalCharacter = readOptionalTableEntry("characters", testCharacterID);
  const originalShip = readOptionalTableEntry("items", testShipID);
  const originalSkills = readOptionalTableEntry("skills", testCharacterID);

  try {
    writeTransientTableEntry("characters", testCharacterID, {
      characterID: testCharacterID,
      characterName: "Same Scene Eject Stale Flag Test",
      corporationID: 1000009,
      allianceID: null,
      warFactionID: null,
      raceID: 1,
      bloodlineID: 1,
      gender: 1,
      stationID: null,
      solarSystemID: POD_KILL_TEST_SYSTEM_ID,
      worldSpaceID: 0,
      shipID: testShipID,
      shipTypeID: 606,
      shipName: "Rifter",
      homeStationID: POD_KILL_TEST_STATION_ID,
      cloneStationID: POD_KILL_TEST_STATION_ID,
      securityStatus: 0,
      securityRating: 0,
    });
    writeTransientTableEntry(
      "items",
      testShipID,
      buildShipItem({
        itemID: testShipID,
        typeID: 606,
        ownerID: testCharacterID,
        locationID: POD_KILL_TEST_SYSTEM_ID,
        flagID: 0,
        itemName: "Rifter",
        spaceState: {
          systemID: POD_KILL_TEST_SYSTEM_ID,
          position: { x: 18_000, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          direction: { x: 1, y: 0, z: 0 },
          targetPoint: { x: 18_000, y: 0, z: 0 },
          speedFraction: 0,
          mode: "STOP",
        },
        conditionState: {
          damage: 0,
          charge: 1,
          armorDamage: 0,
          shieldCharge: 1,
          incapacitated: false,
        },
      }),
    );

    const characterRecord = getCharacterRecord(testCharacterID);
    const activeShip = getActiveShipRecord(testCharacterID);
    assert.ok(characterRecord);
    assert.ok(activeShip);

    const victimSession = buildVictimSession(
      characterRecord,
      activeShip,
      testCharacterID + 39,
    );
    const victimEntity = spaceRuntime.attachSession(victimSession, activeShip, {
      systemID: POD_KILL_TEST_SYSTEM_ID,
      broadcast: false,
      spawnStopped: true,
    });
    assert.ok(victimEntity);
    victimSession._space.initialStateSent = false;
    victimSession._space.initialBallparkVisualsSent = false;
    victimSession._space.initialBallparkClockSynced = false;
    victimSession._space.beyonceBound = true;
    victimSession.notifications.length = 0;

    const ejectResult = transitions.ejectSession(victimSession);
    assert.equal(ejectResult.success, true);

    const flattened = flattenDestinyUpdates(victimSession.notifications).flat();
    const capsuleID = Number(ejectResult.data.capsule.itemID);
    assert.ok(
      flattened.some((entry) => extractAddBallsEntityIDs(entry).includes(capsuleID)),
      "expected stale same-scene eject to still seed the new capsule ball",
    );
    assert.equal(
      flattened.some((entry) => entry.name === "SetState"),
      false,
      "expected stale same-scene eject not to fall back to an owner SetState bootstrap",
    );
    assert.equal(victimSession._space.initialStateSent, true);
    assert.equal(victimSession._space.initialBallparkVisualsSent, true);
    assert.equal(victimSession._space.initialBallparkClockSynced, true);
  } finally {
    cleanupOwnedItems(testCharacterID);

    if (originalCharacter) {
      writeTransientTableEntry("characters", testCharacterID, originalCharacter);
    } else {
      database.remove("characters", `/${testCharacterID}`);
    }

    if (originalShip) {
      writeTransientTableEntry("items", testShipID, originalShip);
    } else {
      database.remove("items", `/${testShipID}`);
    }

    if (originalSkills) {
      writeTransientTableEntry("skills", testCharacterID, originalSkills);
    } else {
      database.remove("skills", `/${testCharacterID}`);
    }
  }
});

test("same-scene ship destruction repairs victim visibility without removing the new pod ego ball", () => {
  const testCharacterID = 990901236;
  const testShipID = 990901336;
  const originalCharacter = readOptionalTableEntry("characters", testCharacterID);
  const originalShip = readOptionalTableEntry("items", testShipID);
  const originalSkills = readOptionalTableEntry("skills", testCharacterID);
  const scene = spaceRuntime.ensureScene(POD_KILL_TEST_SYSTEM_ID);

  try {
    writeTransientTableEntry("characters", testCharacterID, {
      characterID: testCharacterID,
      characterName: "Victim Visibility Reseed Test",
      corporationID: 1000009,
      allianceID: null,
      warFactionID: null,
      raceID: 1,
      bloodlineID: 1,
      gender: 1,
      stationID: null,
      solarSystemID: POD_KILL_TEST_SYSTEM_ID,
      worldSpaceID: 0,
      shipID: testShipID,
      shipTypeID: 606,
      shipName: "Rifter",
      homeStationID: POD_KILL_TEST_STATION_ID,
      cloneStationID: POD_KILL_TEST_STATION_ID,
      securityStatus: 0,
      securityRating: 0,
    });
    writeTransientTableEntry(
      "items",
      testShipID,
      buildShipItem({
        itemID: testShipID,
        typeID: 606,
        ownerID: testCharacterID,
        locationID: POD_KILL_TEST_SYSTEM_ID,
        flagID: 0,
        itemName: "Rifter",
        spaceState: {
          systemID: POD_KILL_TEST_SYSTEM_ID,
          position: { x: 22_000, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          direction: { x: 1, y: 0, z: 0 },
          targetPoint: { x: 22_000, y: 0, z: 0 },
          speedFraction: 0,
          mode: "STOP",
        },
        conditionState: {
          damage: 0,
          charge: 1,
          armorDamage: 0,
          shieldCharge: 1,
          incapacitated: false,
        },
      }),
    );

    const characterRecord = getCharacterRecord(testCharacterID);
    const activeShip = getActiveShipRecord(testCharacterID);
    assert.ok(characterRecord);
    assert.ok(activeShip);

    const victimSession = buildVictimSession(
      characterRecord,
      activeShip,
      testCharacterID + 41,
    );
    const victimEntity = spaceRuntime.attachSession(victimSession, activeShip, {
      systemID: POD_KILL_TEST_SYSTEM_ID,
      broadcast: false,
      spawnStopped: true,
    });
    assert.ok(victimEntity);
    victimSession._space.initialStateSent = true;
    victimSession._space.initialBallparkVisualsSent = true;
    victimSession._space.initialBallparkClockSynced = true;
    victimSession._space.beyonceBound = true;
    const nowMs = scene.getCurrentSimTimeMs();
    const currentSessionStamp = scene.getCurrentSessionDestinyStamp(
      victimSession,
      nowMs,
    );
    victimSession._space.destinyAuthorityState = {
      ...(victimSession._space.destinyAuthorityState || {}),
      lastPresentedStamp: (currentSessionStamp + 2) >>> 0,
      lastNonCriticalStamp: (currentSessionStamp + 2) >>> 0,
      lastRawDispatchStamp: scene.getCurrentDestinyStamp(nowMs),
      heldQueueState: {
        active: false,
        queuedCount: 0,
        lastQueueStamp: 0,
      },
    };
    victimSession._space.lastSentDestinyStamp = (currentSessionStamp + 2) >>> 0;
    victimSession._space.lastSentDestinyRawDispatchStamp =
      scene.getCurrentDestinyStamp(nowMs);
    victimSession._space.lastSentDestinyWasOwnerCritical = false;
    victimSession._space.lastSentDestinyOnlyStaleProjectedOwnerMissileLane = false;

    const responderA = buildShipEntity(scene, 990901431, 26_000, {
      typeID: 10037,
      characterID: 0,
    });
    const responderB = buildShipEntity(scene, 990901432, 27_500, {
      typeID: 10037,
      characterID: 0,
    });
    const responderC = buildShipEntity(scene, 990901433, 29_000, {
      typeID: 3883,
      characterID: 0,
    });
    scene.spawnDynamicEntity(responderA, { broadcast: false });
    scene.spawnDynamicEntity(responderB, { broadcast: false });
    scene.spawnDynamicEntity(responderC, { broadcast: false });

    // Reproduce the real bug shape: the server-side cache still thinks all
    // responders are visible, even though the victim client lost one of them.
    victimSession._space.visibleDynamicEntityIDs = new Set([
      responderA.itemID,
      responderB.itemID,
      responderC.itemID,
    ]);

    const destroyResult = shipDestruction.destroySessionShip(victimSession, {
      sessionChangeReason: "combat",
    });
    assert.equal(destroyResult.success, true);

    const flattened = flattenDestinyUpdates(victimSession.notifications).flat();
    const destroyedShipID = Number(activeShip.itemID);
    const destructionIndex = flattened.findIndex((entry) => (
      entry.name === "TerminalPlayDestructionEffect" &&
      Number(entry.args && entry.args[0]) === destroyedShipID
    ));
    assert.notEqual(
      destructionIndex,
      -1,
      "expected the victim to receive the destroyed hull explosion event",
    );

    const postDestroyCapsuleRemove = flattened.find((entry, index) => (
      index > destructionIndex &&
      entry.name === "RemoveBalls" &&
      Array.isArray(entry.args) &&
      Array.isArray(entry.args[0]) &&
      entry.args[0].includes(Number(destroyResult.data.capsule.itemID))
    ));
    const postDestroyVisibleReset = flattened.find((entry, index) => (
      index > destructionIndex &&
      extractAddBallsEntityIDs(entry).includes(responderA.itemID) &&
      extractAddBallsEntityIDs(entry).includes(responderB.itemID) &&
      extractAddBallsEntityIDs(entry).includes(responderC.itemID)
    ));

    assert.equal(
      postDestroyCapsuleRemove,
      undefined,
      "expected the victim visibility repair to keep the new capsule ego ball alive",
    );
    assert.ok(
      postDestroyVisibleReset,
      "expected the victim to receive a full visible-grid AddBalls2 rebuild after destruction",
    );
  } finally {
    cleanupOwnedItems(testCharacterID);

    for (const responderID of [990901431, 990901432, 990901433]) {
      const responderEntity = scene.getEntityByID(responderID);
      if (responderEntity) {
        scene.removeDynamicEntity(responderID, { broadcast: false });
      }
    }

    if (originalCharacter) {
      writeTransientTableEntry("characters", testCharacterID, originalCharacter);
    } else {
      database.remove("characters", `/${testCharacterID}`);
    }

    if (originalShip) {
      writeTransientTableEntry("items", testShipID, originalShip);
    } else {
      database.remove("items", `/${testShipID}`);
    }

    if (originalSkills) {
      writeTransientTableEntry("skills", testCharacterID, originalSkills);
    } else {
      database.remove("skills", `/${testCharacterID}`);
    }
  }
});

test("same-scene ship destruction reseeds the victim capsule without an owner SetState rebuild", () => {
  const testCharacterID = 990901242;
  const testShipID = 990901342;
  const originalCharacter = readOptionalTableEntry("characters", testCharacterID);
  const originalShip = readOptionalTableEntry("items", testShipID);
  const originalSkills = readOptionalTableEntry("skills", testCharacterID);

  try {
    writeTransientTableEntry("characters", testCharacterID, {
      characterID: testCharacterID,
      characterName: "Ship Destruction Capsule Reseed Test",
      corporationID: 1000009,
      allianceID: null,
      warFactionID: null,
      raceID: 1,
      bloodlineID: 1,
      gender: 1,
      stationID: null,
      solarSystemID: POD_KILL_TEST_SYSTEM_ID,
      worldSpaceID: 0,
      shipID: testShipID,
      shipTypeID: 606,
      shipName: "Rifter",
      homeStationID: POD_KILL_TEST_STATION_ID,
      cloneStationID: POD_KILL_TEST_STATION_ID,
      securityStatus: 0,
      securityRating: 0,
    });
    writeTransientTableEntry(
      "items",
      testShipID,
      buildShipItem({
        itemID: testShipID,
        typeID: 606,
        ownerID: testCharacterID,
        locationID: POD_KILL_TEST_SYSTEM_ID,
        flagID: 0,
        itemName: "Rifter",
        spaceState: {
          systemID: POD_KILL_TEST_SYSTEM_ID,
          position: { x: 21_000, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          direction: { x: 1, y: 0, z: 0 },
          targetPoint: { x: 21_000, y: 0, z: 0 },
          speedFraction: 0,
          mode: "STOP",
        },
        conditionState: {
          damage: 0,
          charge: 1,
          armorDamage: 0,
          shieldCharge: 1,
          incapacitated: false,
        },
      }),
    );

    const characterRecord = getCharacterRecord(testCharacterID);
    const activeShip = getActiveShipRecord(testCharacterID);
    assert.ok(characterRecord);
    assert.ok(activeShip);

    const victimSession = buildVictimSession(
      characterRecord,
      activeShip,
      testCharacterID + 48,
    );
    const victimEntity = spaceRuntime.attachSession(victimSession, activeShip, {
      systemID: POD_KILL_TEST_SYSTEM_ID,
      broadcast: false,
      spawnStopped: true,
    });
    assert.ok(victimEntity);
    victimSession._space.initialStateSent = true;
    victimSession._space.initialBallparkVisualsSent = true;
    victimSession._space.initialBallparkClockSynced = true;
    victimSession._space.beyonceBound = true;
    victimSession.notifications.length = 0;

    const destroyResult = shipDestruction.destroySessionShip(victimSession, {
      sessionChangeReason: "combat",
    });
    assert.equal(destroyResult.success, true);

    const flattened = flattenDestinyUpdates(victimSession.notifications).flat();
    const destroyedShipID = Number(activeShip.itemID);
    const destructionIndex = flattened.findIndex((entry) => (
      entry.name === "TerminalPlayDestructionEffect" &&
      Number(entry.args && entry.args[0]) === destroyedShipID
    ));
    const postDestroyCapsuleAddIndex = flattened.findIndex((entry, index) => (
      index > destructionIndex &&
      extractAddBallsEntityIDs(entry).includes(Number(destroyResult.data.capsule.itemID))
    ));
    const postDestroySetState = flattened.find((entry, index) => (
      index > destructionIndex &&
      entry.name === "SetState"
    ));

    assert.notEqual(postDestroyCapsuleAddIndex, -1);
    assert.equal(
      postDestroySetState,
      undefined,
      "expected ship destruction capsule reseed not to send an owner SetState rebase",
    );
  } finally {
    cleanupOwnedItems(testCharacterID);

    if (originalCharacter) {
      writeTransientTableEntry("characters", testCharacterID, originalCharacter);
    } else {
      database.remove("characters", `/${testCharacterID}`);
    }

    if (originalShip) {
      writeTransientTableEntry("items", testShipID, originalShip);
    } else {
      database.remove("items", `/${testShipID}`);
    }

    if (originalSkills) {
      writeTransientTableEntry("skills", testCharacterID, originalSkills);
    } else {
      database.remove("skills", `/${testCharacterID}`);
    }
  }
});

test("combat ship destruction does not reintroduce the abandoned hull to the victim session", () => {
  const testCharacterID = 990901244;
  const testShipID = 990901344;
  const originalCharacter = readOptionalTableEntry("characters", testCharacterID);
  const originalShip = readOptionalTableEntry("items", testShipID);
  const originalSkills = readOptionalTableEntry("skills", testCharacterID);

  try {
    writeTransientTableEntry("characters", testCharacterID, {
      characterID: testCharacterID,
      characterName: "Combat Destruction Dead Hull Test",
      corporationID: 1000009,
      allianceID: null,
      warFactionID: null,
      raceID: 1,
      bloodlineID: 1,
      gender: 1,
      stationID: null,
      solarSystemID: POD_KILL_TEST_SYSTEM_ID,
      worldSpaceID: 0,
      shipID: testShipID,
      shipTypeID: 24698,
      shipName: "Drake",
      homeStationID: POD_KILL_TEST_STATION_ID,
      cloneStationID: POD_KILL_TEST_STATION_ID,
      securityStatus: 0,
      securityRating: 0,
    });
    writeTransientTableEntry(
      "items",
      testShipID,
      buildShipItem({
        itemID: testShipID,
        typeID: 24698,
        ownerID: testCharacterID,
        locationID: POD_KILL_TEST_SYSTEM_ID,
        flagID: 0,
        itemName: "Drake",
        spaceState: {
          systemID: POD_KILL_TEST_SYSTEM_ID,
          position: { x: 24_000, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          direction: { x: 1, y: 0, z: 0 },
          targetPoint: { x: 24_000, y: 0, z: 0 },
          speedFraction: 0,
          mode: "STOP",
        },
        conditionState: {
          damage: 0,
          charge: 1,
          armorDamage: 0,
          shieldCharge: 1,
          incapacitated: false,
        },
      }),
    );

    const characterRecord = getCharacterRecord(testCharacterID);
    const activeShip = getActiveShipRecord(testCharacterID);
    assert.ok(characterRecord);
    assert.ok(activeShip);

    const victimSession = buildVictimSession(
      characterRecord,
      activeShip,
      testCharacterID + 49,
    );
    const victimEntity = spaceRuntime.attachSession(victimSession, activeShip, {
      systemID: POD_KILL_TEST_SYSTEM_ID,
      broadcast: false,
      spawnStopped: true,
    });
    assert.ok(victimEntity);
    victimSession._space.initialStateSent = true;
    victimSession._space.initialBallparkVisualsSent = true;
    victimSession._space.initialBallparkClockSynced = true;
    victimSession._space.beyonceBound = true;
    victimSession.notifications.length = 0;

    const destroyResult = shipDestruction.destroySessionShip(victimSession, {
      sessionChangeReason: "combat",
    });
    assert.equal(destroyResult.success, true);

    const flattened = flattenDestinyUpdates(victimSession.notifications).flat();
    const destroyedShipID = Number(activeShip.itemID);
    const destructionIndex = flattened.findIndex((entry) => (
      entry.name === "TerminalPlayDestructionEffect" &&
      Number(entry.args && entry.args[0]) === destroyedShipID
    ));
    assert.notEqual(
      destructionIndex,
      -1,
      "expected the destroyed hull explosion to reach the victim",
    );

    const abandonedShipSlim = flattened.find((entry) => (
      entry.name === "OnSlimItemChange" &&
      Number(entry.args && entry.args[0]) === destroyedShipID
    ));
    const postDestroyAbandonedShipAdd = flattened.find((entry, index) => (
      index > destructionIndex &&
      extractAddBallsEntityIDs(entry).includes(destroyedShipID)
    ));

    assert.equal(
      abandonedShipSlim,
      undefined,
      "expected combat destruction not to re-send the abandoned hull slim row to the victim",
    );
    assert.equal(
      postDestroyAbandonedShipAdd,
      undefined,
      "expected combat destruction not to reintroduce the destroyed hull ball to the victim",
    );
  } finally {
    cleanupOwnedItems(testCharacterID);

    if (originalCharacter) {
      writeTransientTableEntry("characters", testCharacterID, originalCharacter);
    } else {
      database.remove("characters", `/${testCharacterID}`);
    }

    if (originalShip) {
      writeTransientTableEntry("items", testShipID, originalShip);
    } else {
      database.remove("items", `/${testShipID}`);
    }

    if (originalSkills) {
      writeTransientTableEntry("skills", testCharacterID, originalSkills);
    } else {
      database.remove("skills", `/${testCharacterID}`);
    }
  }
});

test("same-scene ship destruction flushes shipid before the victim capsule AddBalls2", () => {
  const testCharacterID = 990901241;
  const testShipID = 990901341;
  const originalCharacter = readOptionalTableEntry("characters", testCharacterID);
  const originalShip = readOptionalTableEntry("items", testShipID);
  const originalSkills = readOptionalTableEntry("skills", testCharacterID);
  const scene = spaceRuntime.ensureScene(POD_KILL_TEST_SYSTEM_ID);
  const eventOrder = [];

  try {
    writeTransientTableEntry("characters", testCharacterID, {
      characterID: testCharacterID,
      characterName: "Victim Ordering Test",
      corporationID: 1000009,
      allianceID: null,
      warFactionID: null,
      raceID: 1,
      bloodlineID: 1,
      gender: 1,
      stationID: null,
      solarSystemID: POD_KILL_TEST_SYSTEM_ID,
      worldSpaceID: 0,
      shipID: testShipID,
      shipTypeID: 606,
      shipName: "Rifter",
      homeStationID: POD_KILL_TEST_STATION_ID,
      cloneStationID: POD_KILL_TEST_STATION_ID,
      securityStatus: 0,
      securityRating: 0,
    });
    writeTransientTableEntry(
      "items",
      testShipID,
      buildShipItem({
        itemID: testShipID,
        typeID: 606,
        ownerID: testCharacterID,
        locationID: POD_KILL_TEST_SYSTEM_ID,
        flagID: 0,
        itemName: "Rifter",
        spaceState: {
          systemID: POD_KILL_TEST_SYSTEM_ID,
          position: { x: 18_000, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          direction: { x: 1, y: 0, z: 0 },
          targetPoint: { x: 18_000, y: 0, z: 0 },
          speedFraction: 0,
          mode: "STOP",
        },
        conditionState: {
          damage: 0,
          charge: 1,
          armorDamage: 0,
          shieldCharge: 1,
          incapacitated: false,
        },
      }),
    );

    const characterRecord = getCharacterRecord(testCharacterID);
    const activeShip = getActiveShipRecord(testCharacterID);
    assert.ok(characterRecord);
    assert.ok(activeShip);

    const victimSession = buildVictimSession(
      characterRecord,
      activeShip,
      testCharacterID + 47,
    );
    const originalSendNotification = victimSession.sendNotification.bind(victimSession);
    const originalSendSessionChange = victimSession.sendSessionChange.bind(victimSession);
    victimSession.sendNotification = function patchedSendNotification(name, idType, payload) {
      if (name === "DoDestinyUpdate") {
        const flattened = flattenDestinyUpdates([{ name, idType, payload }]).flat();
        if (flattened.some((entry) => entry.name === "AddBalls2")) {
          eventOrder.push({
            type: "add-balls",
            clientID: Number(victimSession.clientID) || 0,
          });
        }
      }
      return originalSendNotification(name, idType, payload);
    };
    victimSession.sendSessionChange = function patchedSendSessionChange(changes, options = {}) {
      eventOrder.push({
        type: "session-change",
        shipid: changes && changes.shipid ? [
          Number(changes.shipid[0]) || 0,
          Number(changes.shipid[1]) || 0,
        ] : null,
      });
      return originalSendSessionChange(changes, options);
    };

    const victimEntity = spaceRuntime.attachSession(victimSession, activeShip, {
      systemID: POD_KILL_TEST_SYSTEM_ID,
      broadcast: false,
      spawnStopped: true,
    });
    assert.ok(victimEntity);
    victimSession._space.initialStateSent = true;
    victimSession._space.initialBallparkVisualsSent = true;
    victimSession._space.initialBallparkClockSynced = true;
    victimSession._space.beyonceBound = true;

    const destroyResult = shipDestruction.destroySessionShip(victimSession, {
      sessionChangeReason: "combat",
    });
    assert.equal(destroyResult.success, true);

    const sessionChangeIndex = eventOrder.findIndex((entry) => (
      entry.type === "session-change" &&
      Array.isArray(entry.shipid) &&
      entry.shipid[1] === Number(destroyResult.data.capsule.itemID)
    ));
    const capsuleAddIndex = eventOrder.findIndex((entry) => (
      entry.type === "add-balls" &&
      entry.clientID === Number(victimSession.clientID)
    ));

    assert.notEqual(
      sessionChangeIndex,
      -1,
      "expected same-scene eject to emit a shipid session change",
    );
    assert.notEqual(
      capsuleAddIndex,
      -1,
      "expected same-scene eject to send the capsule AddBalls2 to the victim",
    );
    assert.ok(
      sessionChangeIndex < capsuleAddIndex,
      "expected the shipid session change to flush before the victim capsule AddBalls2",
    );
  } finally {
    cleanupOwnedItems(testCharacterID);

    if (originalCharacter) {
      writeTransientTableEntry("characters", testCharacterID, originalCharacter);
    } else {
      database.remove("characters", `/${testCharacterID}`);
    }

    if (originalShip) {
      writeTransientTableEntry("items", testShipID, originalShip);
    } else {
      database.remove("items", `/${testShipID}`);
    }

    if (originalSkills) {
      writeTransientTableEntry("skills", testCharacterID, originalSkills);
    } else {
      database.remove("skills", `/${testCharacterID}`);
    }
  }
});

test("destroying a locked target immediately stops target-bound module effects on attackers", () => {
  const scene = spaceRuntime.ensureScene(30000142);
  const attacker = buildShipEntity(scene, 980003, -15_000, {
    typeID: 606,
    characterID: 140000005,
  });
  const attackerSession = attachSession(scene, attacker, 2, 140000005);
  const victim = buildShipEntity(scene, 980004, 15_000, {
    typeID: 16236,
  });

  scene.spawnDynamicEntity(victim, { broadcast: false });
  scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  attackerSession.notifications.length = 0;

  const lockResult = scene.finalizeTargetLock(attacker, victim, {
    nowMs: scene.getCurrentSimTimeMs(),
  });
  assert.equal(lockResult.success, true, "expected attacker to lock the victim");

  attacker.activeModuleEffects = new Map([
    [990777001, {
      moduleID: 990777001,
      effectID: 10,
      typeID: 3057,
      targetID: victim.itemID,
      guid: "effects.Laser",
      durationMs: 5184,
      reactivationDelayMs: 0,
      isGeneric: true,
      weaponFamily: "laserTurret",
    }],
  ]);

  const destroyResult = shipDestruction._testing.destroyShipEntityWithWreck(
    30000142,
    victim,
    {
      ownerCharacterID: 140000004,
    },
  );
  assert.equal(destroyResult.success, true);
  assert.equal(
    attacker.activeModuleEffects.has(990777001),
    false,
    "expected target-bound effects to stop immediately when the target explodes",
  );

  const flattened = flattenDestinyUpdates(attackerSession.notifications).flat();
  assert.ok(
    flattened.some((entry) => entry.name === "OnSpecialFX"),
    "expected attacker clients to receive an immediate FX stop/update for the dead target",
  );
});

test("mixed-attacker ship destruction keeps the victim capsule swap and observer hull removal in sync", () => {
  const testCharacterID = 990901211;
  const testShipID = 990901311;
  const originalCharacter = readOptionalTableEntry("characters", testCharacterID);
  const originalShip = readOptionalTableEntry("items", testShipID);
  const originalSkills = readOptionalTableEntry("skills", testCharacterID);

  try {
    writeTransientTableEntry("characters", testCharacterID, {
      characterID: testCharacterID,
      characterName: "Mixed Death Test Victim",
      corporationID: 1000009,
      allianceID: null,
      warFactionID: null,
      raceID: 1,
      bloodlineID: 1,
      gender: 1,
      stationID: null,
      solarSystemID: POD_KILL_TEST_SYSTEM_ID,
      worldSpaceID: 0,
      shipID: testShipID,
      shipTypeID: 606,
      shipName: "Rifter",
      homeStationID: POD_KILL_TEST_STATION_ID,
      cloneStationID: POD_KILL_TEST_STATION_ID,
      securityStatus: 0,
      securityRating: 0,
    });
    writeTransientTableEntry(
      "items",
      testShipID,
      buildShipItem({
        itemID: testShipID,
        typeID: 606,
        ownerID: testCharacterID,
        locationID: POD_KILL_TEST_SYSTEM_ID,
        flagID: 0,
        itemName: "Rifter",
        spaceState: {
          systemID: POD_KILL_TEST_SYSTEM_ID,
          position: { x: 15_000, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          direction: { x: 1, y: 0, z: 0 },
          targetPoint: { x: 15_000, y: 0, z: 0 },
          speedFraction: 0,
          mode: "STOP",
        },
        conditionState: {
          damage: 0,
          charge: 1,
          armorDamage: 0,
          shieldCharge: 1,
          incapacitated: false,
        },
      }),
    );

    const characterRecord = getCharacterRecord(testCharacterID);
    const activeShip = getActiveShipRecord(testCharacterID);
    assert.ok(characterRecord);
    assert.ok(activeShip);

    const victimSession = buildVictimSession(
      characterRecord,
      activeShip,
      testCharacterID + 27,
    );
    const victimEntity = spaceRuntime.attachSession(victimSession, activeShip, {
      systemID: POD_KILL_TEST_SYSTEM_ID,
      broadcast: false,
      spawnStopped: true,
    });
    assert.ok(victimEntity);
    victimSession._space.initialStateSent = true;
    victimSession._space.initialBallparkVisualsSent = true;
    victimSession._space.initialBallparkClockSynced = true;
    victimSession._space.beyonceBound = true;

    const scene = spaceRuntime.ensureScene(POD_KILL_TEST_SYSTEM_ID);
    const attacker = buildShipEntity(scene, 980005, -15_000, {
      typeID: 16236,
      characterID: 140000006,
    });
    const attackerSession = attachSession(scene, attacker, 3, 140000006);

    scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
    attackerSession.notifications.length = 0;

    const lockResult = scene.finalizeTargetLock(attacker, victimEntity, {
      nowMs: scene.getCurrentSimTimeMs(),
    });
    assert.equal(lockResult.success, true, "expected attacker to lock the victim");

    attacker.activeModuleEffects = new Map([
      [990777002, {
        moduleID: 990777002,
        effectID: 10,
        typeID: 3057,
        targetID: victimEntity.itemID,
        guid: "effects.Laser",
        durationMs: 5184,
        reactivationDelayMs: 0,
        isGeneric: true,
        weaponFamily: "laserTurret",
      }],
    ]);

    const destroyResult = shipDestruction.destroySessionShip(victimSession, {
      sessionChangeReason: "combat",
    });
    assert.equal(destroyResult.success, true);

    const capsuleID = Number(destroyResult.data.capsule.itemID);
    assert.equal(Number(victimSession._space.shipID), capsuleID);
    assert.equal(scene.getEntityByID(testShipID), null);
    assert.ok(scene.getEntityByID(capsuleID), "expected capsule entity to exist in scene");

    const shipSwapChange = victimSession.sessionChanges.find((entry) => (
      entry &&
      entry.changes &&
      entry.changes.shipid &&
      Number(entry.changes.shipid[0]) === testShipID &&
      Number(entry.changes.shipid[1]) === capsuleID
    ));
    assert.ok(shipSwapChange, "expected victim to receive a ship swap session change");
    assert.equal(
      shipSwapChange.options && shipSwapChange.options.sessionId,
      0n,
      "expected same-scene capsule swap to stay on the remote-style notification path",
    );

    assert.equal(attacker.activeModuleEffects.has(990777002), false);
    assert.equal(
      attackerSession.session._space.visibleDynamicEntityIDs.has(testShipID),
      false,
      "expected attacker to stop tracking the destroyed hull",
    );
    assert.equal(
      attackerSession.session._space.visibleDynamicEntityIDs.has(capsuleID),
      true,
      "expected attacker to see the replacement capsule",
    );

    const attackerUpdates = flattenDestinyUpdates(attackerSession.notifications).flat();
    assert.ok(
      attackerUpdates.some((entry) => entry.name === "RemoveBalls"),
      "expected attacker to receive hull removal",
    );
    assert.ok(
      attackerUpdates.some((entry) => entry.name === "OnSpecialFX"),
      "expected attacker to receive immediate FX teardown for the destroyed hull",
    );
  } finally {
    cleanupOwnedItems(testCharacterID);

    if (originalCharacter) {
      writeTransientTableEntry("characters", testCharacterID, originalCharacter);
    } else {
      database.remove("characters", `/${testCharacterID}`);
    }

    if (originalShip) {
      writeTransientTableEntry("items", testShipID, originalShip);
    } else {
      database.remove("items", `/${testShipID}`);
    }

    if (originalSkills) {
      writeTransientTableEntry("skills", testCharacterID, originalSkills);
    } else {
      database.remove("skills", `/${testCharacterID}`);
    }
  }
});

test("podded capsules despawn for observers before the victim rebuilds docked in station", async () => {
  const originalCharacter = readOptionalTableEntry(
    "characters",
    POD_KILL_TEST_CHARACTER_ID,
  );
  const originalCapsule = readOptionalTableEntry(
    "items",
    POD_KILL_TEST_CAPSULE_ID,
  );
  const originalSkills = readOptionalTableEntry(
    "skills",
    POD_KILL_TEST_CHARACTER_ID,
  );

  try {
    writeTransientTableEntry("characters", POD_KILL_TEST_CHARACTER_ID, {
      characterID: POD_KILL_TEST_CHARACTER_ID,
      characterName: "Pod Test Victim",
      corporationID: 1000009,
      allianceID: null,
      warFactionID: null,
      raceID: 1,
      bloodlineID: 1,
      gender: 1,
      stationID: null,
      solarSystemID: POD_KILL_TEST_SYSTEM_ID,
      worldSpaceID: 0,
      shipID: POD_KILL_TEST_CAPSULE_ID,
      shipTypeID: CAPSULE_TYPE_ID,
      shipName: "Capsule",
      homeStationID: POD_KILL_TEST_STATION_ID,
      cloneStationID: POD_KILL_TEST_STATION_ID,
      securityStatus: 0,
      securityRating: 0,
    });
    writeTransientTableEntry(
      "items",
      POD_KILL_TEST_CAPSULE_ID,
      buildShipItem({
        itemID: POD_KILL_TEST_CAPSULE_ID,
        typeID: CAPSULE_TYPE_ID,
        ownerID: POD_KILL_TEST_CHARACTER_ID,
        locationID: POD_KILL_TEST_SYSTEM_ID,
        flagID: 0,
        itemName: "Capsule",
        spaceState: {
          systemID: POD_KILL_TEST_SYSTEM_ID,
          position: { x: 15_000, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          direction: { x: 1, y: 0, z: 0 },
          targetPoint: { x: 15_000, y: 0, z: 0 },
          speedFraction: 0,
          mode: "STOP",
        },
        conditionState: {
          damage: 0,
          charge: 1,
          armorDamage: 0,
          shieldCharge: 1,
          incapacitated: false,
        },
      }),
    );

    const characterRecord = getCharacterRecord(POD_KILL_TEST_CHARACTER_ID);
    const activeShip = getActiveShipRecord(POD_KILL_TEST_CHARACTER_ID);
    assert.ok(characterRecord);
    assert.ok(activeShip);
    assert.equal(activeShip.itemID, POD_KILL_TEST_CAPSULE_ID);

    const victimSession = buildVictimSession(
      characterRecord,
      activeShip,
      POD_KILL_TEST_CHARACTER_ID + 77,
    );
    const victimEntity = spaceRuntime.attachSession(victimSession, activeShip, {
      systemID: POD_KILL_TEST_SYSTEM_ID,
      broadcast: false,
      spawnStopped: true,
    });
    assert.ok(victimEntity);
    victimSession._space.initialStateSent = true;

    const scene = spaceRuntime.getSceneForSession(victimSession);
    assert.ok(scene);

    const observer = buildShipEntity(scene, 980101, 0, {
      typeID: 606,
      characterID: 140000004,
    });
    const observerSession = attachSession(scene, observer, 1, 140000004);

    scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
    assert.ok(scene.getEntityByID(POD_KILL_TEST_CAPSULE_ID));
    assert.ok(
      observerSession.session._space.visibleDynamicEntityIDs.has(
        POD_KILL_TEST_CAPSULE_ID,
      ),
    );
    observerSession.notifications.length = 0;

    const destroyResult = shipDestruction.destroySessionShip(victimSession, {
      sessionChangeReason: "combat",
    });

    assert.equal(destroyResult.success, true);
    assert.equal(scene.getEntityByID(POD_KILL_TEST_CAPSULE_ID), null);
    assert.equal(
      database.read("items", `/${POD_KILL_TEST_CAPSULE_ID}`).success,
      false,
    );
    assert.equal(victimSession.stationid, POD_KILL_TEST_STATION_ID);
    assert.equal(victimSession.locationid, POD_KILL_TEST_STATION_ID);

    const replacementShip = getActiveShipRecord(POD_KILL_TEST_CHARACTER_ID);
    assert.ok(replacementShip);
    assert.equal(Number(replacementShip.locationID), POD_KILL_TEST_STATION_ID);

    const shipidSessionChanges = victimSession.sessionChanges.filter(
      (entry) => entry && entry.changes && entry.changes.shipid,
    );
    assert.equal(
      shipidSessionChanges.length,
      1,
      "expected pod respawn dock to emit a single final shipid session change",
    );
    assert.deepEqual(
      shipidSessionChanges[0].changes.shipid,
      [POD_KILL_TEST_CAPSULE_ID, replacementShip.itemID],
      "expected pod respawn to switch directly from the destroyed capsule to the docked replacement ship",
    );

    await Promise.resolve();

    assert.equal(
      observerSession.session._space.visibleDynamicEntityIDs.has(
        POD_KILL_TEST_CAPSULE_ID,
      ),
      false,
    );
  } finally {
    cleanupOwnedItems(POD_KILL_TEST_CHARACTER_ID);

    if (originalCharacter) {
      writeTransientTableEntry(
        "characters",
        POD_KILL_TEST_CHARACTER_ID,
        originalCharacter,
      );
    } else {
      database.remove("characters", `/${POD_KILL_TEST_CHARACTER_ID}`);
    }

    if (originalCapsule) {
      writeTransientTableEntry(
        "items",
        POD_KILL_TEST_CAPSULE_ID,
        originalCapsule,
      );
    } else {
      database.remove("items", `/${POD_KILL_TEST_CAPSULE_ID}`);
    }

    if (originalSkills) {
      writeTransientTableEntry(
        "skills",
        POD_KILL_TEST_CHARACTER_ID,
        originalSkills,
      );
    } else {
      database.remove("skills", `/${POD_KILL_TEST_CHARACTER_ID}`);
    }
  }
});

test("podded capsules still send RemoveBalls when observer visibility tracking missed the pod", async () => {
  const originalCharacter = readOptionalTableEntry(
    "characters",
    POD_KILL_TEST_CHARACTER_ID,
  );
  const originalCapsule = readOptionalTableEntry(
    "items",
    POD_KILL_TEST_CAPSULE_ID,
  );
  const originalSkills = readOptionalTableEntry(
    "skills",
    POD_KILL_TEST_CHARACTER_ID,
  );

  try {
    writeTransientTableEntry("characters", POD_KILL_TEST_CHARACTER_ID, {
      characterID: POD_KILL_TEST_CHARACTER_ID,
      characterName: "Pod Test Victim",
      corporationID: 1000009,
      allianceID: null,
      warFactionID: null,
      raceID: 1,
      bloodlineID: 1,
      gender: 1,
      stationID: null,
      solarSystemID: POD_KILL_TEST_SYSTEM_ID,
      worldSpaceID: 0,
      shipID: POD_KILL_TEST_CAPSULE_ID,
      shipTypeID: CAPSULE_TYPE_ID,
      shipName: "Capsule",
      homeStationID: POD_KILL_TEST_STATION_ID,
      cloneStationID: POD_KILL_TEST_STATION_ID,
      securityStatus: 0,
      securityRating: 0,
    });
    writeTransientTableEntry(
      "items",
      POD_KILL_TEST_CAPSULE_ID,
      buildShipItem({
        itemID: POD_KILL_TEST_CAPSULE_ID,
        typeID: CAPSULE_TYPE_ID,
        ownerID: POD_KILL_TEST_CHARACTER_ID,
        locationID: POD_KILL_TEST_SYSTEM_ID,
        flagID: 0,
        itemName: "Capsule",
        spaceState: {
          systemID: POD_KILL_TEST_SYSTEM_ID,
          position: { x: 15_000, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          direction: { x: 1, y: 0, z: 0 },
          targetPoint: { x: 15_000, y: 0, z: 0 },
          speedFraction: 0,
          mode: "STOP",
        },
        conditionState: {
          damage: 0,
          charge: 1,
          armorDamage: 0,
          shieldCharge: 1,
          incapacitated: false,
        },
      }),
    );

    const characterRecord = getCharacterRecord(POD_KILL_TEST_CHARACTER_ID);
    const activeShip = getActiveShipRecord(POD_KILL_TEST_CHARACTER_ID);
    assert.ok(characterRecord);
    assert.ok(activeShip);
    assert.equal(activeShip.itemID, POD_KILL_TEST_CAPSULE_ID);

    const victimSession = buildVictimSession(
      characterRecord,
      activeShip,
      POD_KILL_TEST_CHARACTER_ID + 88,
    );
    const victimEntity = spaceRuntime.attachSession(victimSession, activeShip, {
      systemID: POD_KILL_TEST_SYSTEM_ID,
      broadcast: false,
      spawnStopped: true,
    });
    assert.ok(victimEntity);
    victimSession._space.initialStateSent = true;

    const scene = spaceRuntime.getSceneForSession(victimSession);
    assert.ok(scene);

    const observer = buildShipEntity(scene, 980102, 0, {
      typeID: 606,
      characterID: 140000004,
    });
    const observerSession = attachSession(scene, observer, 2, 140000004);

    scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
    const podEntity = scene.getEntityByID(POD_KILL_TEST_CAPSULE_ID);
    assert.ok(podEntity);
    assert.ok(
      scene.canSessionSeeDynamicEntity(observerSession.session, podEntity),
      "expected observer to have live visibility of the victim pod",
    );
    assert.ok(
      observerSession.session._space.visibleDynamicEntityIDs.has(
        POD_KILL_TEST_CAPSULE_ID,
      ),
      "expected observer visibility cache to include the victim pod",
    );

    observerSession.session._space.visibleDynamicEntityIDs.delete(
      POD_KILL_TEST_CAPSULE_ID,
    );
    observerSession.notifications.length = 0;

    const destroyResult = shipDestruction.destroySessionShip(victimSession, {
      sessionChangeReason: "combat",
    });

    assert.equal(destroyResult.success, true);
    assert.equal(scene.getEntityByID(POD_KILL_TEST_CAPSULE_ID), null);

    await Promise.resolve();

    const flattened = flattenDestinyUpdates(observerSession.notifications).flat();
    const destructionEntry = flattened.find(
      (entry) =>
        entry.name === "TerminalPlayDestructionEffect" &&
        Number(entry.args && entry.args[0]) === POD_KILL_TEST_CAPSULE_ID,
    );
    const removeEntry = flattened.find(
      (entry) =>
        entry.name === "RemoveBalls" &&
        Array.isArray(entry.args) &&
        entry.args.some(
          (arg) =>
            arg &&
            Array.isArray(arg.items) &&
            arg.items.includes(POD_KILL_TEST_CAPSULE_ID),
        ),
    );

    assert.ok(destructionEntry, "expected observer to receive capsule destruction effect");
    assert.ok(removeEntry, "expected observer to receive RemoveBalls for the victim pod");
  } finally {
    cleanupOwnedItems(POD_KILL_TEST_CHARACTER_ID);

    if (originalCharacter) {
      writeTransientTableEntry(
        "characters",
        POD_KILL_TEST_CHARACTER_ID,
        originalCharacter,
      );
    } else {
      database.remove("characters", `/${POD_KILL_TEST_CHARACTER_ID}`);
    }

    if (originalCapsule) {
      writeTransientTableEntry(
        "items",
        POD_KILL_TEST_CAPSULE_ID,
        originalCapsule,
      );
    } else {
      database.remove("items", `/${POD_KILL_TEST_CAPSULE_ID}`);
    }

    if (originalSkills) {
      writeTransientTableEntry(
        "skills",
        POD_KILL_TEST_CHARACTER_ID,
        originalSkills,
      );
    } else {
      database.remove("skills", `/${POD_KILL_TEST_CHARACTER_ID}`);
    }
  }
});

test("runtime wreck entities replace placeholder type radius with a ship-sized targeting radius", () => {
  const wreckEntity = spaceRuntime._testing.buildRuntimeInventoryEntityForTesting({
    itemID: 990101117,
    typeID: 26497,
    groupID: 186,
    categoryID: 6,
    ownerID: 140000004,
    itemName: "Caldari Dreadnought Wreck",
    radius: 14,
    spaceState: {
      systemID: 30000142,
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      targetPoint: { x: 0, y: 0, z: 0 },
      speedFraction: 0,
      mode: "STOP",
    },
  }, 30000142, Date.now());

  assert.ok(wreckEntity);
  assert.equal(wreckEntity.kind, "wreck");
  assert.equal(wreckEntity.radius, 1700);
  assert.equal(
    wreckEntity.signatureRadius,
    getTypeAttributeValue(26497, "signatureRadius"),
  );
});

test("generic wreck entities resolve their targeting radius from the client wreck profile", () => {
  const genericWreckCases = [
    {
      typeID: 26506,
      itemName: "Caldari Frigate Wreck",
      expectedRadius: CLIENT_GENERIC_WRECK_PROFILE_RADII_METERS.wreck_s,
    },
    {
      typeID: 27051,
      itemName: "Amarr Medium Wreck",
      expectedRadius: CLIENT_GENERIC_WRECK_PROFILE_RADII_METERS.wreck_m,
    },
    {
      typeID: 26559,
      itemName: "Battleship Wreck",
      expectedRadius: CLIENT_GENERIC_WRECK_PROFILE_RADII_METERS.wreck_l,
    },
  ];

  for (const wreckCase of genericWreckCases) {
    const wreckEntity = spaceRuntime._testing.buildRuntimeInventoryEntityForTesting({
      itemID: 990200000 + wreckCase.typeID,
      typeID: wreckCase.typeID,
      groupID: 186,
      categoryID: 6,
      ownerID: 140000004,
      itemName: wreckCase.itemName,
      spaceState: {
        systemID: 30000142,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
        targetPoint: { x: 0, y: 0, z: 0 },
        speedFraction: 0,
        mode: "STOP",
      },
    }, 30000142, Date.now());

    assert.ok(wreckEntity, wreckCase.itemName);
    assert.equal(wreckEntity.kind, "wreck");
    assert.ok(
      Math.abs(wreckEntity.radius - wreckCase.expectedRadius) < 1e-6,
      `${wreckCase.itemName} radius ${wreckEntity.radius} != ${wreckCase.expectedRadius}`,
    );
    assert.equal(
      wreckEntity.signatureRadius,
      getTypeAttributeValue(wreckCase.typeID, "signatureRadius"),
      `${wreckCase.itemName} sig ${wreckEntity.signatureRadius} != ${getTypeAttributeValue(wreckCase.typeID, "signatureRadius")}`,
    );
  }
});

test("special wrecks without static hp get a runtime structure fallback so locked weapon targets stay attackable", () => {
  const wreckEntity = spaceRuntime._testing.buildRuntimeInventoryEntityForTesting({
    itemID: 990287297,
    typeID: 87297,
    groupID: 186,
    categoryID: 2,
    ownerID: 140000004,
    itemName: "Megacorp Exchange Wreck",
    radius: 4000,
    spaceRadius: 4000,
    spaceState: {
      systemID: 30000142,
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      targetPoint: { x: 0, y: 0, z: 0 },
      speedFraction: 0,
      mode: "STOP",
    },
  }, 30000142, Date.now());

  assert.ok(wreckEntity);
  assert.equal(wreckEntity.kind, "wreck");
  assert.equal(wreckEntity.structureHP, 4000);
  assert.equal(hasDamageableHealth(wreckEntity), true);
});

test("wreck lock duration prefers dogma signature radius over ball radius", () => {
  const wreckEntity = spaceRuntime._testing.buildRuntimeInventoryEntityForTesting({
    itemID: 99020026506,
    typeID: 26506,
    groupID: 186,
    categoryID: 6,
    ownerID: 140000004,
    itemName: "Caldari Frigate Wreck",
    spaceState: {
      systemID: 30000142,
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      targetPoint: { x: 0, y: 0, z: 0 },
      speedFraction: 0,
      mode: "STOP",
    },
  }, 30000142, Date.now());

  const sourceEntity = {
    itemID: 880001,
    position: { x: 0, y: 0, z: 1000 },
    radius: 50,
    scanResolution: 400,
  };
  const ccpParityDurationMs = spaceRuntime._testing.computeTargetLockDurationMsForTesting(
    sourceEntity,
    wreckEntity,
  );
  const legacyBallRadiusDurationMs = spaceRuntime._testing.computeTargetLockDurationMsForTesting(
    sourceEntity,
    {
      position: wreckEntity.position,
      radius: wreckEntity.radius,
      signatureRadius: wreckEntity.radius,
    },
  );

  assert.ok(
    ccpParityDurationMs < legacyBallRadiusDurationMs,
    `expected ${ccpParityDurationMs} < ${legacyBallRadiusDurationMs}`,
  );
  assert.equal(
    wreckEntity.signatureRadius,
    getTypeAttributeValue(26506, "signatureRadius"),
  );
});

test("death-test detonation waits for solar-system sim time instead of wallclock under TiDi", async () => {
  const scene = spaceRuntime.ensureScene(30000142);
  scene.setTimeDilation(0.5, { syncSessions: false });
  const anchor = buildShipEntity(scene, 990001, 0, {
    typeID: 606,
    characterID: 140000004,
  });
  const anchorSession = attachSession(scene, anchor, 1, 140000004);

  const spawnResult = shipDestruction.spawnShipDeathTestField(anchorSession.session, {
    shipType: {
      typeID: 16236,
      groupID: 420,
      categoryID: 6,
      name: "Coercer",
    },
    count: 1,
    delayMs: 2_000,
  });

  assert.equal(spawnResult.success, true);
  assert.equal(spawnResult.data.spawned.length, 1);
  const detonateAtSimMs = Number(spawnResult.data.detonateAtSimMs || 0);

  let completion = null;
  spawnResult.data.completionPromise.then((value) => {
    completion = value;
  });

  advanceScene(scene, 2_000);
  shipDestruction._testing.processPendingDeathTests();
  await Promise.resolve();

  assert.equal(completion, null);

  const remainingSimMs = Math.max(
    0,
    detonateAtSimMs - Number(scene.simTimeMs || 0),
  );
  const remainingWallclockMs = Math.ceil(
    remainingSimMs / Math.max(scene.getTimeDilation(), 0.000001),
  );
  advanceScene(scene, remainingWallclockMs + 5);
  shipDestruction._testing.processPendingDeathTests();
  await Promise.resolve();

  assert.ok(completion);
  assert.equal(completion.spawnedCount, 1);
  assert.equal(completion.destroyed.length, 1);
});
