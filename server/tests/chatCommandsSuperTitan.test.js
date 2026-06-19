const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

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
  getCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  ITEM_FLAGS,
  listContainerItems,
  moveShipToSpace,
  setActiveShipForCharacter,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  listFittedItems,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));
const {
  listTitanSuperweaponLoadouts,
} = require(path.join(
  repoRoot,
  "server/src/services/superweapons/superweaponCatalog",
));

const TEST_SYSTEM_ID = 30000142;
const SUPERTITAN_SHOW_ENTITY_ID_START = 3950000000000000;
const TEST_CHARACTER_ID = 140000004;
const TEST_OBSERVER_CHARACTER_ID = 140000005;
const registeredSessions = [];

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildSession(characterID, shipItem, position) {
  const character = getCharacterRecord(characterID);
  const notifications = [];
  return {
    clientID: Number(characterID) + 800000,
    characterID,
    charID: characterID,
    characterName: character && character.characterName,
    corporationID: character && character.corporationID || 0,
    allianceID: character && character.allianceID || 0,
    warFactionID: character && character.warFactionID || 0,
    solarsystemid: TEST_SYSTEM_ID,
    solarsystemid2: TEST_SYSTEM_ID,
    shipName: shipItem.itemName || shipItem.shipName || `ship-${shipItem.itemID}`,
    socket: { destroyed: false },
    notifications,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendSessionChange(changes, options = {}) {
      notifications.push({ name: "SessionChange", changes, options });
    },
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
    const payload = notification.payload[0];
    const items = payload && payload.items;
    if (!Array.isArray(items)) {
      continue;
    }
    for (const entry of items) {
      if (!Array.isArray(entry) || !Array.isArray(entry[1])) {
        continue;
      }
      updates.push({
        stamp: entry[0],
        name: entry[1][0],
        args: Array.isArray(entry[1][1]) ? entry[1][1] : [],
      });
    }
  }
  return updates;
}

function getMarshalDictEntry(value, key) {
  if (!value || value.type !== "dict" || !Array.isArray(value.entries)) {
    return undefined;
  }
  const match = value.entries.find((entry) => Array.isArray(entry) && entry[0] === key);
  return match ? match[1] : undefined;
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

function getSpecialFxTargetID(update) {
  if (!update || update.name !== "OnSpecialFX" || !Array.isArray(update.args)) {
    return 0;
  }
  const targetID = Number(update.args[3]);
  return Number.isFinite(targetID) ? targetID : 0;
}

function averagePositionAxis(entities, axis) {
  const list = Array.isArray(entities) ? entities.filter(Boolean) : [];
  if (list.length === 0) {
    return 0;
  }
  return list.reduce(
    (sum, entity) => sum + Number(entity && entity.position && entity.position[axis] || 0),
    0,
  ) / list.length;
}

function advanceScene(scene, deltaMs) {
  const wallclockNow = Number(scene && scene.getCurrentWallclockMs && scene.getCurrentWallclockMs()) || Date.now();
  scene.tick(wallclockNow + Math.max(0, Number(deltaMs) || 0));
}

function flushDestinyNotifications() {
  return new Promise((resolve) => setImmediate(resolve));
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

test.afterEach(() => {
  for (const session of registeredSessions.splice(0)) {
    sessionRegistry.unregister(session);
  }
  spaceRuntime._testing.clearScenes();
});

test("/supertitan uses the shared in-space swap path and boards a titan with the matching superweapon fuel in cargo", (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.flushAllSync();
  });

  const pilotSession = prepareLiveSpaceSession(
    TEST_CHARACTER_ID,
    { x: 0, y: 0, z: 0 },
  );
  const originalShipID = Number(pilotSession._space.shipID) || 0;

  const commandResult = executeChatCommand(
    pilotSession,
    "/supertitan",
    null,
    {
      emitChatFeedback: false,
      superTitanTestConfig: {
        random: () => 0,
      },
    },
  );
  assert.equal(commandResult.handled, true);
  assert.match(commandResult.message, /Avatar/i);
  assert.match(commandResult.message, /Judgment/i);
  assert.match(commandResult.message, /Fitted 1x/i);

  const activeShip = getActiveShipRecord(TEST_CHARACTER_ID);
  assert.ok(activeShip, "expected active ship after /supertitan");
  assert.equal(Number(activeShip.typeID), 11567, "expected /supertitan to board an Avatar");
  assert.notEqual(
    Number(activeShip.itemID),
    originalShipID,
    "expected /supertitan to board a new ship",
  );
  assert.equal(
    Number(pilotSession._space.shipID),
    Number(activeShip.itemID),
    "expected session to be attached to the new titan",
  );

  const fitted = listFittedItems(TEST_CHARACTER_ID, activeShip.itemID);
  assert.deepEqual(
    fitted.map((item) => Number(item.typeID)).sort((left, right) => left - right),
    [24550],
    "expected /supertitan to fit the chosen single superweapon",
  );

  const cargo = listContainerItems(
    TEST_CHARACTER_ID,
    activeShip.itemID,
    ITEM_FLAGS.CARGO_HOLD,
  );
  const fuelStack = cargo.find((item) => Number(item.typeID) === 16274);
  assert.ok(fuelStack, "expected Helium Isotopes in cargo");
  assert.ok(
    Number(fuelStack.quantity) >= 50000,
    "expected enough isotopes for at least one activation",
  );

  const scene = spaceRuntime.getSceneForSession(pilotSession);
  assert.ok(scene, "expected session scene");
  assert.equal(
    scene.getEntityByID(originalShipID),
    null,
    "expected the original ship to be removed from space by the shared swap path",
  );
});

test("/supertitanshow spawns two transient titan fleets and broadcasts superweapon FX to owner and observer", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.flushAllSync();
  });

  const pilotSession = prepareLiveSpaceSession(
    TEST_CHARACTER_ID,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = prepareLiveSpaceSession(
    TEST_OBSERVER_CHARACTER_ID,
    { x: 2000, y: 0, z: 0 },
  );

  const commandResult = executeChatCommand(
    pilotSession,
    "/supertitanshow 3",
    null,
    {
      emitChatFeedback: false,
      superTitanTestConfig: {
        random: () => 0,
        targetDelayMs: 0,
        fxDurationMs: 0,
        scheduleFn(callback) {
          callback();
          return 0;
        },
      },
    },
  );
  assert.equal(commandResult.handled, true);
  assert.match(commandResult.message, /transient titan battle groups/i);
  assert.match(commandResult.message, /one real racial superweapon/i);
  assert.match(commandResult.message, /40 km either side of the midpoint/i);
  assert.match(commandResult.message, /first real volley begins/i);

  const scene = spaceRuntime.getSceneForSession(pilotSession);
  assert.ok(scene, "expected show scene");
  advanceScene(scene, 1_000);
  await flushDestinyNotifications();
  const titanShowEntities = [...scene.dynamicEntities.values()].filter((entity) => (
    entity &&
    entity.kind === "ship" &&
    Number(entity.groupID) === 30 &&
    Number(entity.itemID) >= SUPERTITAN_SHOW_ENTITY_ID_START
  ));
  assert.equal(
    titanShowEntities.length,
    6,
    "expected /supertitanshow 3 to spawn six transient titan entities",
  );
  const fleetAEntities = titanShowEntities.filter((entity) => / A\d+$/.test(String(entity.itemName || "")));
  const fleetBEntities = titanShowEntities.filter((entity) => / B\d+$/.test(String(entity.itemName || "")));
  assert.equal(fleetAEntities.length, 3, "expected three A-fleet titans");
  assert.equal(fleetBEntities.length, 3, "expected three B-fleet titans");
  assert.ok(
    Math.abs(
      Math.abs(averagePositionAxis(fleetAEntities, "x") - averagePositionAxis(fleetBEntities, "x")) -
      80000,
    ) <= 100,
    "expected the two titan fleets to start about 80 km apart center-to-center",
  );

  advanceScene(scene, 5_000);
  await flushDestinyNotifications();

  const ownerFxUpdates = flattenDestinyUpdates(pilotSession.notifications)
    .filter((entry) => entry.name === "OnSpecialFX");
  const observerFxUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "OnSpecialFX");
  assert.ok(ownerFxUpdates.length >= 6, "expected owner to see titan superweapon FX");
  assert.ok(observerFxUpdates.length >= 6, "expected observer to see titan superweapon FX");
});

test("/supertitanshow opening lance volleys acquire the beacon before the FX packet is delivered", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.flushAllSync();
  });

  const pilotSession = prepareLiveSpaceSession(
    TEST_CHARACTER_ID,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = prepareLiveSpaceSession(
    TEST_OBSERVER_CHARACTER_ID,
    { x: 2000, y: 0, z: 0 },
  );
  const lanceLoadout = listTitanSuperweaponLoadouts({ family: "lance" })[0];
  assert.ok(lanceLoadout, "expected at least one titan lance loadout");

  const commandResult = executeChatCommand(
    pilotSession,
    "/supertitanshow 1",
    null,
    {
      emitChatFeedback: false,
      superTitanTestConfig: {
        targetDelayMs: 0,
        scheduleFn(callback) {
          callback();
          return 0;
        },
        pickLoadout() {
          return lanceLoadout;
        },
      },
    },
  );
  assert.equal(commandResult.handled, true);

  const scene = spaceRuntime.getSceneForSession(pilotSession);
  assert.ok(scene, "expected show scene");
  advanceScene(scene, 1_000);
  await flushDestinyNotifications();
  advanceScene(scene, 1_000);
  await flushDestinyNotifications();

  const beaconIDs = [...scene.dynamicEntities.values()]
    .filter((entity) => (
      entity &&
      entity.kind === "container" &&
      Number(entity.typeID) === 41233
    ))
    .map((entity) => Number(entity.itemID));
  assert.ok(beaconIDs.length >= 1, "expected lance activation to spawn modular effect beacons");

  const ownerTimeline = flattenDestinyUpdates(pilotSession.notifications);
  const observerTimeline = flattenDestinyUpdates(observerSession.notifications);
  const buildBeaconOrderingView = (timeline) => {
    const beaconAcquireIndexByID = new Map();
    timeline.forEach((entry, index) => {
      if (entry.name !== "AddBalls2") {
        return;
      }
      for (const entityID of getAddBalls2EntityIDs(entry)) {
        const normalizedEntityID = Number(entityID);
        if (
          beaconIDs.includes(normalizedEntityID) &&
          !beaconAcquireIndexByID.has(normalizedEntityID)
        ) {
          beaconAcquireIndexByID.set(normalizedEntityID, index);
        }
      }
    });
    const lanceFxEntries = timeline
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => (
        entry.name === "OnSpecialFX" &&
        String(entry.args[5]) === String(lanceLoadout.fxGuid) &&
        beaconIDs.includes(getSpecialFxTargetID(entry))
      ));
    return {
      beaconAcquireIndexByID,
      lanceFxEntries,
    };
  };

  const ownerView = buildBeaconOrderingView(ownerTimeline);
  const observerView = buildBeaconOrderingView(observerTimeline);

  assert.ok(ownerView.beaconAcquireIndexByID.size >= 1, "expected owner to receive the lance beacon acquire");
  assert.ok(observerView.beaconAcquireIndexByID.size >= 1, "expected observer to receive the lance beacon acquire");
  assert.ok(ownerView.lanceFxEntries.length >= 1, "expected owner to receive the lance FX");
  assert.ok(observerView.lanceFxEntries.length >= 1, "expected observer to receive the lance FX");

  for (const { entry, index } of ownerView.lanceFxEntries) {
    const targetID = getSpecialFxTargetID(entry);
    const acquireIndex = ownerView.beaconAcquireIndexByID.get(targetID);
    assert.ok(
      Number.isInteger(acquireIndex),
      `expected owner to acquire lance beacon ${targetID} before replaying its FX`,
    );
    assert.ok(
      acquireIndex < index,
      `expected owner beacon acquire for ${targetID} to arrive before its lance FX trigger`,
    );
  }
  for (const { entry, index } of observerView.lanceFxEntries) {
    const targetID = getSpecialFxTargetID(entry);
    const acquireIndex = observerView.beaconAcquireIndexByID.get(targetID);
    assert.ok(
      Number.isInteger(acquireIndex),
      `expected observer to acquire lance beacon ${targetID} before replaying its FX`,
    );
    assert.ok(
      acquireIndex < index,
      `expected observer beacon acquire for ${targetID} to arrive before its lance FX trigger`,
    );
  }
});

test("/supertitanshow titans really damage and destroy each other with repeated superweapon volleys", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.flushAllSync();
  });

  const pilotSession = prepareLiveSpaceSession(
    TEST_CHARACTER_ID,
    { x: 0, y: 0, z: 0 },
  );

  const commandResult = executeChatCommand(
    pilotSession,
    "/supertitanshow 3",
    null,
    {
      emitChatFeedback: false,
      superTitanTestConfig: {
        random: () => 0,
        targetDelayMs: 0,
        scheduleFn(callback) {
          callback();
          return 0;
        },
      },
    },
  );
  assert.equal(commandResult.handled, true);

  const scene = spaceRuntime.getSceneForSession(pilotSession);
  assert.ok(scene, "expected show scene");

  const initialTitanIDs = [...scene.dynamicEntities.values()]
    .filter((entity) => (
      entity &&
      entity.kind === "ship" &&
      Number(entity.groupID) === 30 &&
      Number(entity.itemID) >= SUPERTITAN_SHOW_ENTITY_ID_START
    ))
    .map((entity) => Number(entity.itemID));
  assert.equal(initialTitanIDs.length, 6, "expected six titans in the 3v3 showcase");

  advanceScene(scene, 1_000);
  await flushDestinyNotifications();
  advanceScene(scene, 1_000);
  await flushDestinyNotifications();
  advanceScene(scene, 20_000);
  await flushDestinyNotifications();

  const survivingAfterFirstVolley = initialTitanIDs
    .filter((entityID) => Boolean(scene.getEntityByID(entityID)));
  const damagedTitan = initialTitanIDs
    .map((entityID) => scene.getEntityByID(entityID))
    .find((entity) => (
      entity &&
      entity.conditionState &&
      (
        Number(entity.conditionState.damage || 0) > 0 ||
        Number(entity.conditionState.armorDamage || 0) > 0 ||
        Number(entity.conditionState.shieldCharge || 1) < 1
      )
    ));
  assert.ok(
    damagedTitan || survivingAfterFirstVolley.length < initialTitanIDs.length,
    "expected the first live volley to either damage or destroy at least one titan",
  );

  const fxCountAfterFirstRefireWindow = flattenDestinyUpdates(pilotSession.notifications)
    .filter((entry) => entry.name === "OnSpecialFX")
    .length;

  advanceScene(scene, 40_000);
  await flushDestinyNotifications();
  const fxCountAfterSecondRefireWindow = flattenDestinyUpdates(pilotSession.notifications)
    .filter((entry) => entry.name === "OnSpecialFX")
    .length;
  assert.ok(
    fxCountAfterSecondRefireWindow > fxCountAfterFirstRefireWindow,
    "expected fitted single-family titans to keep re-firing and emitting new superweapon FX after the first refire window",
  );

  const survivingTitanIDs = initialTitanIDs
    .filter((entityID) => Boolean(scene.getEntityByID(entityID)));
  assert.ok(
    survivingTitanIDs.length < initialTitanIDs.length,
    "expected the showcase battle to destroy at least one titan",
  );
});

test("/supertitanshow no longer clamps at the old 20-per-fleet cap", (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.flushAllSync();
  });

  const pilotSession = prepareLiveSpaceSession(
    TEST_CHARACTER_ID,
    { x: 0, y: 0, z: 0 },
  );

  const commandResult = executeChatCommand(
    pilotSession,
    "/supertitanshow 21",
    null,
    {
      emitChatFeedback: false,
      superTitanTestConfig: {
        random: () => 0,
        targetDelayMs: 0,
        fxDurationMs: 0,
        scheduleFn(callback) {
          callback();
          return 0;
        },
      },
    },
  );
  assert.equal(commandResult.handled, true);
  assert.match(commandResult.message, /Spawned 21 \+ 21 transient titan battle groups/i);

  const scene = spaceRuntime.getSceneForSession(pilotSession);
  assert.ok(scene, "expected show scene");
  const titanShowEntities = [...scene.dynamicEntities.values()].filter((entity) => (
    entity &&
    entity.kind === "ship" &&
    Number(entity.groupID) === 30 &&
    Number(entity.itemID) >= SUPERTITAN_SHOW_ENTITY_ID_START
  ));
  assert.equal(
    titanShowEntities.length,
    42,
    "expected /supertitanshow 21 to spawn forty-two transient titan entities",
  );
});
