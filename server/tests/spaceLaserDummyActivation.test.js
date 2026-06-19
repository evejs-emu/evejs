const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const BeyonceService = require(path.join(
  repoRoot,
  "server/src/services/ship/beyonceService",
));
const InvBrokerService = require(path.join(
  repoRoot,
  "server/src/services/inventory/invBrokerService",
));
const DogmaService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dogmaService",
));
const {
  marshalEncode,
} = require(path.join(
  repoRoot,
  "server/src/network/tcp/utils/marshal",
));
const { restoreSpaceSession } = require(path.join(
  repoRoot,
  "server/src/space/transitions",
));
const {
  applyCharacterToSession,
  getActiveShipRecord,
  getCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  getFittedModuleItems,
  buildChargeTupleItemID,
  getLoadedChargeByFlag,
  getLoadedChargeItems,
  isModuleOnline,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));
const {
  resolveWeaponFamily,
} = require(path.join(
  repoRoot,
  "server/src/space/combat/weaponDogma",
));
const {
  hasDamageableHealth,
} = require(path.join(
  repoRoot,
  "server/src/space/combat/damage",
));
const {
  resolveShipByName,
} = require(path.join(
  repoRoot,
  "server/src/services/chat/shipTypeRegistry",
));
const {
  ITEM_FLAGS,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));

function findSpaceLaserCandidate() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Failed to read characters");

  const characterIDs = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .sort((left, right) => left - right);

  for (const characterID of characterIDs) {
    const characterRecord = getCharacterRecord(characterID);
    const ship = getActiveShipRecord(characterID);
    if (!characterRecord || !ship || !ship.spaceState) {
      continue;
    }
    if (Number(characterRecord.stationID || characterRecord.stationid || 0) > 0) {
      continue;
    }

    const fittedModules = getFittedModuleItems(characterID, ship.itemID);
    for (const moduleItem of fittedModules) {
      if (!isModuleOnline(moduleItem)) {
        continue;
      }
      const chargeItem = getLoadedChargeByFlag(
        characterID,
        ship.itemID,
        moduleItem.flagID,
      );
      if (!chargeItem) {
        continue;
      }
      if (resolveWeaponFamily(moduleItem, chargeItem) !== "laserTurret") {
        continue;
      }
      return {
        characterID,
        characterRecord,
        ship,
        moduleItem,
        chargeItem,
      };
    }
  }

  assert.fail("Expected an in-space character with an online loaded laser turret");
}

function buildSession(candidate) {
  return {
    clientID: candidate.characterID + 9300,
    userid: candidate.characterID,
    characterID: candidate.characterID,
    charid: candidate.characterID,
    corporationID: candidate.characterRecord.corporationID || 0,
    allianceID: candidate.characterRecord.allianceID || 0,
    warFactionID: candidate.characterRecord.warFactionID || 0,
    characterName:
      candidate.characterRecord.characterName ||
      candidate.characterRecord.name ||
      `char-${candidate.characterID}`,
    shipName: candidate.ship.itemName || `ship-${candidate.ship.itemID}`,
    stationid: null,
    stationID: null,
    stationid2: null,
    locationid:
      Number(candidate.characterRecord.solarSystemID || candidate.characterRecord.solarsystemid || 0) ||
      Number(candidate.ship.locationID || 0),
    solarsystemid:
      Number(candidate.characterRecord.solarSystemID || candidate.characterRecord.solarsystemid || 0) ||
      Number(candidate.ship.locationID || 0),
    solarsystemid2:
      Number(candidate.characterRecord.solarSystemID || candidate.characterRecord.solarsystemid || 0) ||
      Number(candidate.ship.locationID || 0),
    shipID: candidate.ship.itemID,
    shipid: candidate.ship.itemID,
    activeShipID: candidate.ship.itemID,
    socket: { destroyed: false },
    notifications: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
    sendSessionChange(change) {
      this.sessionChange = change;
    },
  };
}

function buildObserverSession(systemID, position) {
  return {
    clientID: 980001,
    userid: 980001,
    characterID: 980001,
    charid: 980001,
    corporationID: 980001,
    allianceID: 0,
    warFactionID: 0,
    characterName: "observer",
    shipName: "observer-ship",
    stationid: null,
    stationID: null,
    stationid2: null,
    locationid: systemID,
    solarsystemid: systemID,
    solarsystemid2: systemID,
    shipID: 980101,
    shipid: 980101,
    activeShipID: 980101,
    socket: { destroyed: false },
    notifications: [],
    shipItem: {
      itemID: 980101,
      typeID: 606,
      ownerID: 980001,
      groupID: 25,
      categoryID: 6,
      radius: 40,
      spaceState: {
        position,
        velocity: { x: 0, y: 0, z: 0 },
        direction: { x: -1, y: 0, z: 0 },
        mode: "STOP",
        speedFraction: 0,
      },
    },
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
    sendSessionChange(change) {
      this.sessionChange = change;
    },
  };
}

function flattenModuleAttributeChanges(notifications = []) {
  return (Array.isArray(notifications) ? notifications : [])
    .filter((notification) => notification && notification.name === "OnModuleAttributeChanges")
    .flatMap((notification) => {
      const payload = Array.isArray(notification.payload)
        ? notification.payload[0]
        : null;
      return payload && Array.isArray(payload.items) ? payload.items : [];
    });
}

function flattenDestinyUpdates(notifications = []) {
  const updates = [];
  for (const notification of Array.isArray(notifications) ? notifications : []) {
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

function extractOnItemChangeItemIDs(notifications = []) {
  return (Array.isArray(notifications) ? notifications : [])
    .filter((notification) => notification && notification.name === "OnItemChange")
    .map((notification) => {
      const payload = Array.isArray(notification.payload) ? notification.payload[0] : null;
      const fields =
        payload &&
        payload.type === "packedrow" &&
        payload.fields &&
        typeof payload.fields === "object"
          ? payload.fields
          : null;
      return Number(fields && fields.itemID) || 0;
    })
    .filter((itemID) => itemID > 0);
}

function extractOnItemChangeRows(notifications = []) {
  return (Array.isArray(notifications) ? notifications : [])
    .filter((notification) => notification && notification.name === "OnItemChange")
    .map((notification) => {
      const payload = Array.isArray(notification.payload) ? notification.payload[0] : null;
      return payload &&
        payload.type === "packedrow" &&
        payload.fields &&
        typeof payload.fields === "object"
        ? payload.fields
        : null;
    })
    .filter(Boolean);
}

function stopEntityForWeaponParity(entity) {
  if (!entity) {
    return;
  }

  entity.mode = "STOP";
  entity.speedFraction = 0;
  entity.velocity = { x: 0, y: 0, z: 0 };
  entity.targetPoint = {
    x: entity.position.x,
    y: entity.position.y,
    z: entity.position.z,
  };
}

function extractOnGodmaPrimeItemIDs(notifications = []) {
  return (Array.isArray(notifications) ? notifications : [])
    .filter((notification) => notification && notification.name === "OnGodmaPrimeItem")
    .map((notification) => {
      const payload = Array.isArray(notification.payload) ? notification.payload[1] : null;
      const entries =
        payload &&
        payload.name === "util.KeyVal" &&
        payload.args &&
        payload.args.type === "dict" &&
        Array.isArray(payload.args.entries)
          ? payload.args.entries
          : [];
      const itemIDEntry = entries.find(
        (entry) => Array.isArray(entry) && entry[0] === "itemID",
      );
      return itemIDEntry ? itemIDEntry[1] : null;
    })
    .filter(Boolean);
}

function extractOnGodmaPrimeItems(notifications = []) {
  return (Array.isArray(notifications) ? notifications : [])
    .filter((notification) => notification && notification.name === "OnGodmaPrimeItem")
    .map((notification) => {
      const payload = Array.isArray(notification.payload) ? notification.payload[1] : null;
      const entries =
        payload &&
        payload.name === "util.KeyVal" &&
        payload.args &&
        payload.args.type === "dict" &&
        Array.isArray(payload.args.entries)
          ? payload.args.entries
          : [];
      const itemIDEntry = entries.find(
        (entry) => Array.isArray(entry) && entry[0] === "itemID",
      );
      return {
        itemID: itemIDEntry ? itemIDEntry[1] : null,
        entries,
      };
    })
    .filter((item) => item.itemID);
}

function getPrimeAttributesForTuple(notifications = [], shipID, flagID, typeID) {
  const numericShipID = Number(shipID) || 0;
  const numericFlagID = Number(flagID) || 0;
  const numericTypeID = Number(typeID) || 0;

  for (const notification of Array.isArray(notifications) ? notifications : []) {
    if (!notification || notification.name !== "OnGodmaPrimeItem") {
      continue;
    }

    const payload = Array.isArray(notification.payload) ? notification.payload[1] : null;
    const entries =
      payload &&
      payload.name === "util.KeyVal" &&
      payload.args &&
      payload.args.type === "dict" &&
      Array.isArray(payload.args.entries)
        ? payload.args.entries
        : [];
    const itemIDEntry = entries.find(
      (entry) => Array.isArray(entry) && entry[0] === "itemID",
    );
    const itemID = itemIDEntry ? itemIDEntry[1] : null;
    if (
      !Array.isArray(itemID) ||
      Number(itemID[0]) !== numericShipID ||
      Number(itemID[1]) !== numericFlagID ||
      Number(itemID[2]) !== numericTypeID
    ) {
      continue;
    }

    const attributeEntry = entries.find(
      (entry) => Array.isArray(entry) && entry[0] === "attributes",
    );
    const attributeEntries =
      attributeEntry &&
      attributeEntry[1] &&
      attributeEntry[1].type === "dict" &&
      Array.isArray(attributeEntry[1].entries)
        ? attributeEntry[1].entries
        : [];

    return new Map(
      attributeEntries.map((entry) => [
        Number(Array.isArray(entry) ? entry[0] : 0) || 0,
        Array.isArray(entry) ? entry[1] : null,
      ]),
    );
  }

  return new Map();
}

function getLatestOnItemChangeKeysByTupleKey(
  notifications = [],
  shipID,
  flagID,
  typeID,
) {
  const numericShipID = Number(shipID) || 0;
  const numericFlagID = Number(flagID) || 0;
  const numericTypeID = Number(typeID) || 0;
  let latestKeys = [];

  for (const notification of Array.isArray(notifications) ? notifications : []) {
    if (!notification || notification.name !== "OnItemChange") {
      continue;
    }
    const payload = Array.isArray(notification.payload) ? notification.payload : [];
    const itemRow =
      payload[0] &&
      payload[0].type === "packedrow" &&
      payload[0].fields &&
      typeof payload[0].fields === "object"
        ? payload[0].fields
        : null;
    const itemID = itemRow && itemRow.itemID;
    if (
      !Array.isArray(itemID) ||
      Number(itemID[0]) !== numericShipID ||
      Number(itemID[1]) !== numericFlagID ||
      Number(itemID[2]) !== numericTypeID
    ) {
      continue;
    }
    latestKeys =
      payload[1] && payload[1].type === "dict" && Array.isArray(payload[1].entries)
        ? payload[1].entries
            .map((entry) => Number(Array.isArray(entry) ? entry[0] : 0) || 0)
            .filter((key) => key > 0)
            .sort((left, right) => left - right)
        : [];
  }

  return latestKeys;
}

function countRawOnItemChangesByTupleKey(
  notifications = [],
  shipID,
  flagID,
  typeID,
) {
  const numericShipID = Number(shipID) || 0;
  const numericFlagID = Number(flagID) || 0;
  const numericTypeID = Number(typeID) || 0;

  return extractOnItemChangeRows(notifications).filter((fields) => {
    const itemID = fields && fields.itemID;
    return (
      Array.isArray(itemID) &&
      Number(itemID[0]) === numericShipID &&
      Number(itemID[1]) === numericFlagID &&
      Number(itemID[2]) === numericTypeID
    );
  }).length;
}

async function waitFor(predicate, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

function bindShipInventory(service, session, shipID) {
  const bound = service.Handle_GetInventoryFromId([shipID], session);
  const boundID =
    bound &&
    bound.type === "substruct" &&
    bound.value &&
    bound.value.type === "substream" &&
    Array.isArray(bound.value.value)
      ? bound.value.value[0]
      : null;
  assert.ok(boundID, "Expected GetInventoryFromId to return a bound inventory substruct");
  session.currentBoundObjectID = boundID;
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

function unwrapMarshalNumber(value) {
  if (value && typeof value === "object" && value.type === "real") {
    return Number(value.value);
  }
  return Number(value);
}

test.afterEach(() => {
  spaceRuntime._testing.clearScenes();
});

test("dogma bootstrap primes loaded laser turrets with runtime speed and capNeed overrides", () => {
  const candidate = findSpaceLaserCandidate();
  const session = buildSession(candidate);
  const dogma = new DogmaService();

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);
  assert.equal(restoreSpaceSession(session), true);

  const runtimeAttributes = spaceRuntime.getGenericModuleRuntimeAttributes(
    candidate.characterID,
    candidate.ship,
    candidate.moduleItem,
    candidate.chargeItem,
  );
  assert.ok(runtimeAttributes, "Expected live generic module runtime attributes");

  const attributes = dogma._buildInventoryItemAttributes(candidate.moduleItem, session);
  assert.deepEqual(
    attributes[51],
    {
      type: "real",
      value: Number(runtimeAttributes.durationMs),
    },
    "Expected dogma bootstrap to preserve the live laser module speed attribute as a marshal real for HUD timing",
  );
  assert.equal(
    unwrapMarshalNumber(attributes[51]),
    Number(runtimeAttributes.durationMs),
    "Expected dogma bootstrap to prime the laser module speed attribute with the live runtime duration",
  );
  assert.equal(
    Number(attributes[6]),
    Number(runtimeAttributes.capNeed),
    "Expected dogma bootstrap to prime the laser module capacitorNeed with the live runtime value",
  );
});

test("sessionless dummy hulls are damageable and can be activated against with loaded laser turrets", () => {
  const candidate = findSpaceLaserCandidate();
  const session = buildSession(candidate);
  const dogma = new DogmaService();

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);
  assert.equal(restoreSpaceSession(session), true);

  const scene = spaceRuntime.getSceneForSession(session);
  assert.ok(scene, "Expected a loaded space scene for the test character");

  const sourceEntity = spaceRuntime.getEntity(session, session._space.shipID);
  assert.ok(sourceEntity, "Expected the test character ship entity");
  session._space.initialStateSent = true;
  stopEntityForWeaponParity(sourceEntity);

  const observerSession = buildObserverSession(session._space.systemID, {
    x: sourceEntity.position.x + 800,
    y: sourceEntity.position.y + 800,
    z: sourceEntity.position.z,
  });
  const observerEntity = spaceRuntime.attachSession(
    observerSession,
    observerSession.shipItem,
    {
      systemID: session._space.systemID,
      broadcast: false,
      spawnStopped: true,
    },
  );
  assert.ok(observerEntity, "Expected the observer helper ship to attach");
  observerSession._space.initialStateSent = true;

  const drake = resolveShipByName("Drake");
  const spawnType = drake && drake.success && drake.match ? drake.match : null;
  const spawnResult = spaceRuntime.spawnDynamicShip(session._space.systemID, {
    typeID: spawnType ? spawnType.typeID : candidate.ship.typeID,
    groupID: spawnType ? spawnType.groupID : candidate.ship.groupID,
    categoryID: spawnType ? spawnType.categoryID || 6 : candidate.ship.categoryID || 6,
    itemName: spawnType ? `${spawnType.name} Dummy` : "Combat Dummy",
    ownerID: 0,
    characterID: 0,
    corporationID: 0,
    allianceID: 0,
    warFactionID: 0,
    position: {
      x: sourceEntity.position.x + 2_500,
      y: sourceEntity.position.y,
      z: sourceEntity.position.z,
    },
    velocity: { x: 0, y: 0, z: 0 },
    direction: { x: -1, y: 0, z: 0 },
    mode: "STOP",
    speedFraction: 0,
    conditionState: {
      damage: 0,
      charge: 1,
      armorDamage: 0,
      shieldCharge: 1,
      incapacitated: false,
    },
  });
  assert.equal(spawnResult.success, true, "Expected dummy hull spawn to succeed");

  const dummyEntity = spawnResult.data.entity;
  assert.equal(
    hasDamageableHealth(dummyEntity),
    true,
    "Expected sessionless dummy hulls to spawn with real damageable health layers",
  );

  const lockResult = scene.finalizeTargetLock(sourceEntity, dummyEntity, {
    nowMs: scene.getCurrentSimTimeMs(),
  });
  assert.equal(lockResult.success, true, "Expected the source ship to lock the dummy hull");
  const observerLockResult = scene.finalizeTargetLock(observerEntity, dummyEntity, {
    nowMs: scene.getCurrentSimTimeMs(),
  });
  assert.equal(
    observerLockResult.success,
    true,
    "Expected the observer helper ship to lock the dummy hull",
  );

  const previousShieldRatio = Number(dummyEntity.conditionState.shieldCharge) || 0;
  session.notifications.length = 0;
  observerSession.notifications.length = 0;
  const broadcastSpecialFxCalls = [];
  const originalBroadcastSpecialFx = scene.broadcastSpecialFx.bind(scene);
  const originalRandom = Math.random;
  try {
    scene.broadcastSpecialFx = (shipID, guid, options = {}, visibilityEntity = null) => {
      broadcastSpecialFxCalls.push({
        shipID,
        guid,
        options: { ...options },
        visibilityEntity,
      });
      return originalBroadcastSpecialFx(shipID, guid, options, visibilityEntity);
    };
    Math.random = () => 0.5;
    assert.equal(
      dogma.Handle_Activate([
        candidate.moduleItem.itemID,
        "targetAttack",
        dummyEntity.itemID,
        1000,
      ], session),
      1,
      "Expected laser turret activation against the dummy hull to succeed",
    );

    const effectState = scene.getActiveModuleEffect(
      sourceEntity.itemID,
      candidate.moduleItem.itemID,
    );
    assert.ok(effectState, "Expected an active generic weapon effect after activation");
    const moduleAttributeChanges = flattenModuleAttributeChanges(session.notifications);
    assert.equal(
      moduleAttributeChanges.some(
        (change) =>
          Number(change[2]) === Number(candidate.moduleItem.itemID) &&
          Number(change[3]) === 51 &&
          change[5] &&
          change[5].type === "real" &&
          unwrapMarshalNumber(change[5]) === Number(effectState.durationMs),
      ),
      true,
      "Expected laser activation to push a live marshal-real speed (51) override for the module HUD ramp",
    );
    assert.equal(
      moduleAttributeChanges.some(
        (change) =>
          Number(change[2]) === Number(candidate.moduleItem.itemID) &&
          Number(change[3]) === 6 &&
          Number(change[5]) === Number(effectState.capNeed),
      ),
      true,
      "Expected laser activation to push a live capacitorNeed (6) override for the module HUD",
    );
    const activationGodmaEffect = session.notifications.find(
      (notification) =>
        notification &&
        notification.name === "OnGodmaShipEffect" &&
        Array.isArray(notification.payload) &&
        Number(notification.payload[0]) === Number(candidate.moduleItem.itemID) &&
        Number(notification.payload[1]) > 0 &&
        Number(notification.payload[3]) === 1,
    );
    assert.ok(
      activationGodmaEffect,
      "Expected laser activation to emit an active OnGodmaShipEffect packet for the module",
    );
    assert.equal(
      Number(
        Array.isArray(activationGodmaEffect.payload[5])
          ? activationGodmaEffect.payload[5][3]
          : 0,
      ),
      Number(dummyEntity.itemID),
      "Expected targeted module effect environment to preserve the locked target ID for target-bar weapon indicators",
    );
    assert.equal(
      extractOnItemChangeItemIDs(session.notifications).includes(
        Number(candidate.chargeItem.itemID),
      ),
      false,
      "Expected laser activation to keep the loaded crystal on the tuple charge-state path instead of sending a fitted inventory row",
    );
    assert.equal(
      extractOnGodmaPrimeItemIDs(session.notifications).some((itemID) =>
        Array.isArray(itemID) &&
        Number(itemID[0]) === Number(candidate.ship.itemID) &&
        Number(itemID[1]) === Number(candidate.moduleItem.flagID) &&
        Number(itemID[2]) === Number(candidate.chargeItem.typeID),
      ),
      false,
      "Expected laser activation to reuse the login-seeded tuple-backed crystal",
    );
    const crystalPrimeCountAfterActivation = extractOnGodmaPrimeItemIDs(
      session.notifications,
    ).filter((itemID) =>
      Array.isArray(itemID) &&
      Number(itemID[0]) === Number(candidate.ship.itemID) &&
      Number(itemID[1]) === Number(candidate.moduleItem.flagID) &&
      Number(itemID[2]) === Number(candidate.chargeItem.typeID)
    ).length;
    assert.ok(
      (Number(dummyEntity.conditionState.shieldCharge) || 0) < previousShieldRatio,
      "Expected the first laser shot to apply immediately on activation instead of waiting for the first cycle boundary",
    );
    assert.equal(
      flattenDestinyUpdates(session.notifications).some(
        (entry) =>
          entry.name === "OnDamageStateChange" &&
          Number(entry.args[0]) === Number(dummyEntity.itemID),
      ),
      true,
      "Expected activation to immediately send the target damage-state update for the first shot",
    );
    assert.equal(
      session.notifications.some(
        (notification) =>
          notification &&
          notification.name === "OnDamageMessage" &&
          Array.isArray(notification.payload) &&
          notification.payload[0] &&
          Number(getMarshalDictEntry(notification.payload[0], "target")) === Number(dummyEntity.itemID),
      ),
      true,
      "Expected activation to immediately emit an OnDamageMessage payload for the first shot",
    );

    scene.tick(Date.now() + Math.max(Number(effectState.durationMs) || 0, 1_500) + 100);
    assert.equal(
      extractOnGodmaPrimeItemIDs(session.notifications).filter((itemID) =>
        Array.isArray(itemID) &&
        Number(itemID[0]) === Number(candidate.ship.itemID) &&
        Number(itemID[1]) === Number(candidate.moduleItem.flagID) &&
        Number(itemID[2]) === Number(candidate.chargeItem.typeID)
      ).length,
      crystalPrimeCountAfterActivation,
      "Expected repeated laser cycles to reuse the existing tuple crystal dogma item instead of re-priming it every shot",
    );
  } finally {
    scene.broadcastSpecialFx = originalBroadcastSpecialFx;
    Math.random = originalRandom;
  }

  assert.ok(
    (Number(dummyEntity.conditionState.shieldCharge) || 0) < previousShieldRatio,
    "Expected the dummy hull to lose shield after the first forced-hit laser cycle",
  );
  const sourceDestinyUpdates = flattenDestinyUpdates(session.notifications);
  assert.equal(
    sourceDestinyUpdates.some(
      (entry) =>
        entry.name === "OnDamageStateChange" &&
        Number(entry.args[0]) === Number(dummyEntity.itemID),
    ),
    true,
    "Expected the firing session to receive the target damage-state update through DoDestinyUpdate",
  );
  assert.equal(
    session.notifications.some((notification) => notification.name === "OnDamageStateChange"),
    false,
    "Expected live damage-state updates to stay on the Michelle destiny path",
  );
  const sourceDamageStateNotification = sourceDestinyUpdates.find(
    (entry) =>
      entry.name === "OnDamageStateChange" &&
      Number(entry.args[0]) === Number(dummyEntity.itemID),
  );
  assert.ok(sourceDamageStateNotification, "Expected a source damage-state payload inside DoDestinyUpdate");
  assert.ok(
    Array.isArray(sourceDamageStateNotification.args[1][0]),
    "Expected live OnDamageStateChange shield state to stay in Michelle tuple format",
  );
  assert.equal(sourceDamageStateNotification.args[1][0][0].type, "real");
  assert.equal(sourceDamageStateNotification.args[1][0][1].type, "real");
  assert.equal(sourceDamageStateNotification.args[1][0][2].type, "long");
  assert.equal(sourceDamageStateNotification.args[1][1].type, "real");
  assert.equal(sourceDamageStateNotification.args[1][2].type, "real");
  const combatMessageNotification = session.notifications.find(
    (notification) =>
      notification &&
      notification.name === "OnDamageMessage" &&
      Array.isArray(notification.payload) &&
      notification.payload[0] &&
      Number(getMarshalDictEntry(notification.payload[0], "target")) === Number(dummyEntity.itemID),
  );
  assert.ok(
    combatMessageNotification,
    "Expected the firing session to receive an OnDamageMessage payload for hit/miss feedback",
  );
  assert.equal(
    combatMessageNotification.payload[0].type,
    "dict",
    "Expected outgoing OnDamageMessage payloads to be explicit marshal dicts",
  );
  assert.doesNotThrow(
    () => marshalEncode(combatMessageNotification.payload),
    "Expected the outgoing OnDamageMessage payload to marshal without crashing the server",
  );
  assert.ok(
    Number(getMarshalDictEntry(combatMessageNotification.payload[0], "damage")) > 0,
    "Expected the outgoing combat message to report applied damage",
  );
  assert.ok(
    Number(getMarshalDictEntry(combatMessageNotification.payload[0], "hitQuality")) > 0,
    "Expected the outgoing combat message to classify the shot as a hit",
  );
  const activationFxCall = broadcastSpecialFxCalls.find(
    (entry) =>
      entry.guid &&
      entry.options &&
      entry.options.start === true,
  );
  assert.ok(activationFxCall, "Expected targeted weapon activation to emit OnSpecialFX");
  assert.equal(
    Number(activationFxCall.options.repeat),
    1000,
    "Expected targeted weapon FX to preserve the client repeat count for auto-cycling visuals",
  );
  assert.equal(
    flattenDestinyUpdates(observerSession.notifications).some(
      (entry) =>
        entry.name === "OnDamageStateChange" &&
        Number(entry.args[0]) === Number(dummyEntity.itemID),
    ),
    true,
    "Expected another locked observer to receive the same target damage-state update through DoDestinyUpdate",
  );
});

test("laser turret deactivation emits a targeted stop OnSpecialFX without restarting the beam", () => {
  const candidate = findSpaceLaserCandidate();
  const session = buildSession(candidate);
  const dogma = new DogmaService();

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);
  assert.equal(restoreSpaceSession(session), true);

  const scene = spaceRuntime.getSceneForSession(session);
  assert.ok(scene, "Expected a loaded space scene for the test character");

  const sourceEntity = spaceRuntime.getEntity(session, session._space.shipID);
  assert.ok(sourceEntity, "Expected the firing ship entity");
  session._space.initialStateSent = true;
  stopEntityForWeaponParity(sourceEntity);

  const drake = resolveShipByName("Drake");
  const spawnType = drake && drake.success && drake.match ? drake.match : null;
  const spawnResult = spaceRuntime.spawnDynamicShip(session._space.systemID, {
    typeID: spawnType ? spawnType.typeID : candidate.ship.typeID,
    groupID: spawnType ? spawnType.groupID : candidate.ship.groupID,
    categoryID: spawnType ? spawnType.categoryID || 6 : candidate.ship.categoryID || 6,
    itemName: spawnType ? `${spawnType.name} Dummy` : "Combat Dummy",
    ownerID: 0,
    characterID: 0,
    corporationID: 0,
    allianceID: 0,
    warFactionID: 0,
    position: {
      x: sourceEntity.position.x + 2_500,
      y: sourceEntity.position.y,
      z: sourceEntity.position.z,
    },
    velocity: { x: 0, y: 0, z: 0 },
    direction: { x: -1, y: 0, z: 0 },
    mode: "STOP",
    speedFraction: 0,
  });
  assert.equal(spawnResult.success, true, "Expected dummy hull spawn to succeed");

  const dummyEntity = spawnResult.data.entity;
  const lockResult = scene.finalizeTargetLock(sourceEntity, dummyEntity, {
    nowMs: scene.getCurrentSimTimeMs(),
  });
  assert.equal(lockResult.success, true, "Expected the source ship to lock the dummy hull");

  const broadcastSpecialFxCalls = [];
  const originalBroadcastSpecialFx = scene.broadcastSpecialFx.bind(scene);
  try {
    scene.broadcastSpecialFx = (shipID, guid, options = {}, visibilityEntity = null) => {
      broadcastSpecialFxCalls.push({
        shipID,
        guid,
        options: { ...options },
        visibilityEntity,
      });
      return originalBroadcastSpecialFx(shipID, guid, options, visibilityEntity);
    };

    assert.equal(
      dogma.Handle_Activate([
        candidate.moduleItem.itemID,
        "targetAttack",
        dummyEntity.itemID,
        1000,
      ], session),
      1,
      "Expected laser turret activation to succeed",
    );
    assert.equal(
      dogma.Handle_Deactivate([
        candidate.moduleItem.itemID,
        "targetAttack",
      ], session),
      1,
      "Expected laser turret deactivation request to succeed",
    );

    const effectState = scene.getActiveModuleEffect(
      sourceEntity.itemID,
      candidate.moduleItem.itemID,
    );
    assert.ok(effectState, "Expected the active laser effect to stay pending until the cycle boundary");
    assert.ok(
      Number(effectState.deactivateAtMs) > 0,
      "Expected manual laser deactivation to defer until the cycle boundary",
    );

    scene.tick(Date.now() + Math.max(Number(effectState.durationMs) || 0, 1_500) + 100);
  } finally {
    scene.broadcastSpecialFx = originalBroadcastSpecialFx;
  }

  const stopFxCallIndex = broadcastSpecialFxCalls.findIndex(
    (entry) =>
      entry.guid &&
      entry.options &&
      entry.options.start === false &&
      Number(entry.options.moduleID) === Number(candidate.moduleItem.itemID),
  );
  assert.notEqual(stopFxCallIndex, -1, "Expected laser deactivation to emit a stop OnSpecialFX");
  const stopFxCall = broadcastSpecialFxCalls[stopFxCallIndex];
  assert.equal(
    Number(stopFxCall.options.targetID),
    Number(dummyEntity.itemID),
    "Expected stop OnSpecialFX to preserve the laser target context",
  );
  assert.equal(
    Number(stopFxCall.options.chargeTypeID),
    Number(candidate.chargeItem.typeID),
    "Expected stop OnSpecialFX to preserve the loaded crystal type context",
  );
  assert.equal(
    stopFxCall.options.isOffensive,
    true,
    "Expected stop OnSpecialFX to stay marked offensive for targeted weapons",
  );
  assert.equal(
    scene.getActiveModuleEffect(sourceEntity.itemID, candidate.moduleItem.itemID),
    null,
    "Expected the active laser effect to be removed after the stop boundary is reached",
  );
  assert.equal(
    broadcastSpecialFxCalls
      .slice(stopFxCallIndex + 1)
      .some(
        (entry) =>
          entry.options &&
          entry.options.start === true &&
          Number(entry.options.moduleID) === Number(candidate.moduleItem.itemID),
      ),
    false,
    "Expected no new repeat-start OnSpecialFX after the laser stop packet",
  );
});

test("laser turret kill flow removes a /fire-style Drake dummy, drops a wreck, and clears target state", () => {
  const candidate = findSpaceLaserCandidate();
  const session = buildSession(candidate);
  const dogma = new DogmaService();

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);
  assert.equal(restoreSpaceSession(session), true);

  const scene = spaceRuntime.getSceneForSession(session);
  assert.ok(scene, "Expected a loaded space scene for the test character");

  const sourceEntity = spaceRuntime.getEntity(session, session._space.shipID);
  assert.ok(sourceEntity, "Expected the firing ship entity");
  session._space.initialStateSent = true;
  stopEntityForWeaponParity(sourceEntity);

  const observerSession = buildObserverSession(session._space.systemID, {
    x: sourceEntity.position.x + 900,
    y: sourceEntity.position.y + 900,
    z: sourceEntity.position.z,
  });
  const observerEntity = spaceRuntime.attachSession(
    observerSession,
    observerSession.shipItem,
    {
      systemID: session._space.systemID,
      broadcast: false,
      spawnStopped: true,
    },
  );
  assert.ok(observerEntity, "Expected the observer helper ship to attach");
  observerSession._space.initialStateSent = true;

  const drake = resolveShipByName("Drake");
  const spawnType = drake && drake.success && drake.match ? drake.match : null;
  const existingWreckIDs = new Set(
    [...scene.dynamicEntities.values()]
      .filter((entity) => entity && entity.kind === "wreck")
      .map((entity) => Number(entity.itemID) || 0)
      .filter((itemID) => itemID > 0),
  );

  const spawnResult = spaceRuntime.spawnDynamicShip(session._space.systemID, {
    typeID: spawnType ? spawnType.typeID : candidate.ship.typeID,
    groupID: spawnType ? spawnType.groupID : candidate.ship.groupID,
    categoryID: spawnType ? spawnType.categoryID || 6 : candidate.ship.categoryID || 6,
    itemName: spawnType ? `${spawnType.name} Dummy` : "Combat Dummy",
    ownerID: Number(session.characterID || session.charid || 0) || 0,
    characterID: 0,
    corporationID: Number(session.corporationID || 0) || 0,
    allianceID: Number(session.allianceID || 0) || 0,
    warFactionID: Number(session.warFactionID || 0) || 0,
    position: {
      x: sourceEntity.position.x + 2_500,
      y: sourceEntity.position.y,
      z: sourceEntity.position.z,
    },
    velocity: { x: 0, y: 0, z: 0 },
    direction: { x: -1, y: 0, z: 0 },
    mode: "STOP",
    speedFraction: 0,
    conditionState: {
      damage: 0.999,
      charge: 1,
      armorDamage: 1,
      shieldCharge: 0,
      incapacitated: false,
    },
  });
  assert.equal(spawnResult.success, true, "Expected a Drake dummy spawn to succeed");

  const dummyEntity = spawnResult.data.entity;
  const sourceLockResult = scene.finalizeTargetLock(sourceEntity, dummyEntity, {
    nowMs: scene.getCurrentSimTimeMs(),
  });
  assert.equal(sourceLockResult.success, true, "Expected the firing ship to lock the dummy");
  const observerLockResult = scene.finalizeTargetLock(observerEntity, dummyEntity, {
    nowMs: scene.getCurrentSimTimeMs(),
  });
  assert.equal(observerLockResult.success, true, "Expected the observer helper ship to lock the dummy");

  session.notifications.length = 0;
  observerSession.notifications.length = 0;
  const originalRandom = Math.random;
  try {
    Math.random = () => 0.5;
    assert.equal(
      dogma.Handle_Activate([
        candidate.moduleItem.itemID,
        "targetAttack",
        dummyEntity.itemID,
        1000,
      ], session),
      1,
      "Expected laser turret activation against the near-death Drake dummy to succeed",
    );

    const effectState = scene.getActiveModuleEffect(
      sourceEntity.itemID,
      candidate.moduleItem.itemID,
    );
    if (effectState) {
      scene.tick(Date.now() + Math.max(Number(effectState.durationMs) || 0, 1_500) + 100);
    }
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(
    Boolean(scene.getEntityByID(dummyEntity.itemID)),
    false,
    "Expected the destroyed dummy hull to be removed from the scene",
  );
  assert.equal(
    Boolean(scene.getActiveModuleEffect(sourceEntity.itemID, candidate.moduleItem.itemID)),
    false,
    "Expected the laser module to auto-deactivate after the target dies",
  );
  assert.equal(
    scene.getTargetsForEntity(sourceEntity).includes(Number(dummyEntity.itemID)),
    false,
    "Expected the firing ship to lose the destroyed dummy target lock",
  );
  assert.equal(
    scene.getTargetsForEntity(observerEntity).includes(Number(dummyEntity.itemID)),
    false,
    "Expected the observer ship to lose the destroyed dummy target lock",
  );

  const newWrecks = [...scene.dynamicEntities.values()].filter(
    (entity) =>
      entity &&
      entity.kind === "wreck" &&
      !existingWreckIDs.has(Number(entity.itemID) || 0),
  );
  assert.equal(newWrecks.length, 1, "Expected dummy destruction to spawn exactly one new wreck");
  assert.ok(
    /wreck/i.test(String(newWrecks[0].itemName || "")),
    "Expected the spawned replacement entity to be a wreck",
  );

  assert.equal(
    session.notifications.some(
      (notification) =>
        notification.name === "OnTarget" &&
        notification.payload &&
        notification.payload[0] === "lost" &&
        Number(notification.payload[1]) === Number(dummyEntity.itemID),
    ),
    true,
    "Expected the firing session to receive a target-loss notification for the destroyed dummy",
  );
  assert.equal(
    observerSession.notifications.some(
      (notification) =>
        notification.name === "OnTarget" &&
        notification.payload &&
        notification.payload[0] === "lost" &&
        Number(notification.payload[1]) === Number(dummyEntity.itemID),
    ),
    true,
    "Expected the observing locker to receive the same target-loss notification",
  );

  const sourceDestinyUpdates = flattenDestinyUpdates(session.notifications);
  const observerDestinyUpdates = flattenDestinyUpdates(observerSession.notifications);
  for (const updateSet of [sourceDestinyUpdates, observerDestinyUpdates]) {
    assert.equal(
      updateSet.some((entry) => entry.name === "TerminalPlayDestructionEffect"),
      true,
      "Expected destruction to broadcast the terminal ship explosion effect",
    );
    assert.equal(
      updateSet.some((entry) => entry.name === "RemoveBalls"),
      true,
      "Expected destruction to remove the dead dummy ball from observers",
    );
    assert.equal(
      updateSet.some((entry) => entry.name === "AddBalls2"),
      true,
      "Expected destruction to add the spawned wreck ball to observers",
    );
  }

  assert.equal(
    session.notifications.some(
      (notification) =>
        notification.name === "OnGodmaShipEffect" &&
        Array.isArray(notification.payload) &&
        Number(notification.payload[0]) === Number(candidate.moduleItem.itemID) &&
        Number(notification.payload[3]) === 0,
    ),
    true,
    "Expected target death to broadcast a weapon-effect stop to the firing module HUD",
  );
});
