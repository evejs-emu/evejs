const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
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
  moveShipToSpace,
  setActiveShipForCharacter,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  getCharacterSkillMap,
} = require(path.join(
  repoRoot,
  "server/src/services/skills/skillState",
));
const {
  resolveTitanSuperweaponProfileByHullTypeID,
  listTitanSuperweaponLoadouts,
} = require(path.join(
  repoRoot,
  "server/src/services/superweapons/superweaponCatalog",
));
const {
  broadcastSuperweaponFxForTesting,
  buildSuperweaponFreshAcquireFxOptions,
  buildNpcPseudoSession,
} = require(path.join(
  repoRoot,
  "server/src/space/modules/superweapons/superweaponRuntime",
));

const FILETIME_EPOCH_OFFSET = 116444736000000000n;
const FILETIME_TICKS_PER_MS = 10000n;

const TEST_SYSTEM_ID = 30000142;
const TEST_CHARACTER_ID = 140000004;
const TEST_OBSERVER_CHARACTER_ID = 140000005;
const SOURCE_ENTITY_ID_START = 3960000000000000;

let nextEntityID = SOURCE_ENTITY_ID_START;
const registeredSessions = [];

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFileTimeFromMs(value) {
  return BigInt(Math.trunc(Number(value) || 0)) * FILETIME_TICKS_PER_MS + FILETIME_EPOCH_OFFSET;
}

function buildSession(characterID, shipItem, position) {
  const character = getCharacterRecord(characterID);
  const notifications = [];
  return {
    clientID: Number(characterID) + 810000,
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

function registerAttachedSession(session, options = {}) {
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
  if (options.clearNotifications !== false) {
    session.notifications.length = 0;
  }
  return session;
}

function prepareLiveSpaceSession(characterID, position, options = {}) {
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
    options,
  );
}

function allocateEntityID() {
  const entityID = nextEntityID;
  nextEntityID += 1;
  return entityID;
}

function buildModuleItem(entityID, moduleType, flagID = 27) {
  return {
    itemID: (entityID * 10) + flagID,
    locationID: entityID,
    ownerID: 0,
    typeID: Number(moduleType && moduleType.typeID) || 0,
    groupID: Number(moduleType && moduleType.groupID) || 0,
    categoryID: Number(moduleType && moduleType.categoryID) || 7,
    itemName: String(moduleType && moduleType.name || "Module"),
    flagID,
    singleton: 1,
    stacksize: 1,
    quantity: 1,
    moduleState: {
      online: true,
      damage: 0,
      charge: 0,
      skillPoints: 0,
      armorDamage: 0,
      shieldCharge: 0,
      incapacitated: false,
    },
  };
}

function buildFuelItem(entityID, fuelType, quantity) {
  return {
    itemID: (entityID * 10) + 90,
    cargoID: (entityID * 10) + 90,
    locationID: entityID,
    ownerID: 0,
    typeID: Number(fuelType && fuelType.typeID) || 0,
    groupID: Number(fuelType && fuelType.groupID) || 0,
    categoryID: Number(fuelType && fuelType.categoryID) || 4,
    itemName: String(fuelType && fuelType.name || "Fuel"),
    quantity,
    stacksize: quantity,
    singleton: 0,
  };
}

function buildShipSpec(options = {}) {
  const profile =
    options.profile ||
    resolveTitanSuperweaponProfileByHullTypeID(options.hullTypeID || 11567);
  assert.ok(profile, "expected titan superweapon profile");
  const entityID = allocateEntityID();
  const moduleItems = Array.isArray(options.modules)
    ? options.modules.map((moduleType, index) => (
        buildModuleItem(entityID, moduleType, 27 + index)
      ))
    : [];
  return {
    itemID: entityID,
    typeID: profile.hullType.typeID,
    groupID: profile.hullType.groupID,
    categoryID: profile.hullType.categoryID || 6,
    itemName: String(options.itemName || profile.hullType.name),
    ownerID: 0,
    characterID: 0,
    pilotCharacterID: 0,
    corporationID: 0,
    allianceID: 0,
    warFactionID: 0,
    nativeNpc: true,
    nativeNpcOccupied: true,
    transient: true,
    fittedItems: moduleItems,
    nativeCargoItems: options.includeFuel === false
      ? []
      : [buildFuelItem(
        entityID,
        profile.fuelType,
        Math.max(200000, toInt(options.fuelQuantity, 0) || 200000),
      )],
    skillMap: getCharacterSkillMap(TEST_CHARACTER_ID),
    position: options.position || { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    direction: options.direction || { x: 1, y: 0, z: 0 },
    targetPoint: options.targetPoint || options.position || { x: 0, y: 0, z: 0 },
    mode: "STOP",
    speedFraction: 0,
    conditionState: {
      damage: 0,
      charge: 1,
      armorDamage: 0,
      shieldCharge: 1,
      incapacitated: false,
    },
    superweaponCycleOverrideMs: toInt(options.superweaponCycleOverrideMs, 0) || undefined,
  };
}

function spawnShip(scene, shipSpec) {
  const spawnResult = spaceRuntime.spawnDynamicShip(
    scene.systemID,
    shipSpec,
    {
      broadcastOptions: {
        deferUntilVisibilitySync: true,
      },
    },
  );
  assert.equal(spawnResult.success, true, "expected transient titan spawn");
  assert.ok(spawnResult.data && spawnResult.data.entity, "expected spawned titan entity");
  return spawnResult.data.entity;
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

function findNotification(notifications = [], name) {
  return notifications.find((entry) => entry && entry.name === name) || null;
}

function getDamageMessageTotalDamage(notification) {
  if (!notification || notification.name !== "OnDamageMessage" || !Array.isArray(notification.payload)) {
    return 0;
  }
  return Number(getMarshalDictEntry(notification.payload[0], "damage") || 0);
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
  const [value] = update.args;
  if (Array.isArray(value)) {
    return value.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry));
  }
  if (value && typeof value === "object") {
    if (Array.isArray(value.entityIDs)) {
      return value.entityIDs
        .map((entry) => Number(entry))
        .filter((entry) => Number.isFinite(entry));
    }
    if (value.type === "list" && Array.isArray(value.items)) {
      return value.items
        .map((entry) => Number(entry))
        .filter((entry) => Number.isFinite(entry));
    }
  }
  return [];
}

function getAddBalls2SlimItem(update, entityID) {
  if (!update || update.name !== "AddBalls2" || !Array.isArray(update.args)) {
    return null;
  }

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
      if (itemID === Number(entityID)) {
        return slimItem;
      }
    }
  }

  return null;
}

function advanceScene(scene, deltaMs) {
  const baseWallclock =
    Number(scene && scene._testWallclockMs) ||
    Number(scene && scene.lastWallclockTickAt) ||
    Number(scene && scene.getCurrentWallclockMs && scene.getCurrentWallclockMs()) ||
    Date.now();
  const nextWallclock = baseWallclock + Math.max(0, Number(deltaMs) || 0);
  scene._testWallclockMs = nextWallclock;
  scene.tick(nextWallclock);
}

function flushDestinyNotifications() {
  return new Promise((resolve) => setImmediate(resolve));
}

function targetDamagedOrDestroyed(scene, entityID) {
  const entity = scene.getEntityByID(entityID);
  if (!entity) {
    return true;
  }
  return Boolean(
    entity.conditionState &&
    (
      Number(entity.conditionState.damage || 0) > 0 ||
      Number(entity.conditionState.armorDamage || 0) > 0 ||
      Number(entity.conditionState.shieldCharge || 1) < 1
    )
  );
}

test.afterEach(() => {
  for (const session of registeredSessions.splice(0)) {
    sessionRegistry.unregister(session);
  }
  spaceRuntime._testing.clearScenes();
  nextEntityID = SOURCE_ENTITY_ID_START;
});

test("directed doomsday waits on scene sim time under TiDi and then damages the locked target", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.flushAllSync();
  });

  const ownerSession = prepareLiveSpaceSession(
    TEST_CHARACTER_ID,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = prepareLiveSpaceSession(
    TEST_OBSERVER_CHARACTER_ID,
    { x: 1000, y: 0, z: 0 },
  );
  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected scene");

  const amarrProfile = resolveTitanSuperweaponProfileByHullTypeID(11567);
  const caldariProfile = resolveTitanSuperweaponProfileByHullTypeID(3764);
  assert.ok(amarrProfile, "expected Avatar profile");
  assert.ok(caldariProfile, "expected Leviathan profile");

  const source = spawnShip(scene, buildShipSpec({
    profile: amarrProfile,
    itemName: "Superweapon Source",
    modules: [amarrProfile.doomsdayType],
    position: { x: 60_000, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
  }));
  const target = spawnShip(scene, buildShipSpec({
    profile: caldariProfile,
    itemName: "Superweapon Target",
    includeFuel: false,
    modules: [],
    position: { x: 140_000, y: 0, z: 0 },
    direction: { x: -1, y: 0, z: 0 },
  }));

  const attackerCombatSession = {
    clientID: 920000001,
    notifications: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
  };
  const targetCombatSession = {
    clientID: 920000002,
    notifications: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
  };
  source.session = attackerCombatSession;
  target.session = targetCombatSession;

  ownerSession.notifications.length = 0;
  observerSession.notifications.length = 0;
  scene.setTimeDilation(0.5, { syncSessions: false });

  const lockResult = scene.finalizeTargetLock(source, target, {
    nowMs: scene.getCurrentSimTimeMs(),
  });
  assert.equal(lockResult.success, true, "expected direct doomsday lock");

  const activationResult = scene.activateGenericModule(
    buildNpcPseudoSession(source),
    source.fittedItems[0],
    null,
    {
      targetID: target.itemID,
      repeat: 1,
    },
  );
  assert.equal(activationResult.success, true, "expected directed doomsday activation");
  await flushDestinyNotifications();

  const ownerFx = flattenDestinyUpdates(ownerSession.notifications)
    .find((entry) => entry.name === "OnSpecialFX");
  const observerFx = flattenDestinyUpdates(observerSession.notifications)
    .find((entry) => entry.name === "OnSpecialFX");
  assert.ok(ownerFx, "expected owner doomsday FX");
  assert.ok(observerFx, "expected observer doomsday FX");
  assert.equal(String(ownerFx.args[5]), "effects.SuperWeaponAmarr");

  advanceScene(scene, 10_000);
  assert.equal(
    targetDamagedOrDestroyed(scene, target.itemID),
    false,
    "expected 10s wallclock at 0.5 TiDi to be only 5s sim time, still before Judgment damage",
  );

  advanceScene(scene, 10_000);
  assert.equal(
    targetDamagedOrDestroyed(scene, target.itemID),
    true,
    "expected the directed doomsday to resolve once the scene sim clock crosses the damage delay",
  );

  const attackerDamageMessage = findNotification(
    attackerCombatSession.notifications,
    "OnDamageMessage",
  );
  const targetDamageMessage = findNotification(
    targetCombatSession.notifications,
    "OnDamageMessage",
  );
  assert.ok(attackerDamageMessage, "expected attacker doomsday damage message");
  assert.ok(targetDamageMessage, "expected target doomsday damage message");
  assert.ok(
    getDamageMessageTotalDamage(attackerDamageMessage) > 0,
    "expected attacker doomsday damage message to report applied damage",
  );
  assert.ok(
    getDamageMessageTotalDamage(targetDamageMessage) > 0,
    "expected target doomsday damage message to report applied damage",
  );
  assert.equal(
    Number(getMarshalDictEntry(attackerDamageMessage.payload[0], "weapon") || 0),
    Number(source.fittedItems[0].typeID),
    "expected doomsday combat message to identify the superweapon module type",
  );
});

test("Leviathan and Ragnarok doomsdays use presented held-future FX delivery", () => {
  const sourceEntity = { itemID: 991003087 };
  const seen = [];
  const nowMs = 1775182882600;
  const scene = {
    getCurrentFileTime() {
      return toFileTimeFromMs(nowMs);
    },
    toFileTimeFromSimMs(value, fallback = this.getCurrentFileTime()) {
      return Number.isFinite(Number(value)) ? toFileTimeFromMs(value) : fallback;
    },
    broadcastSpecialFx(shipID, guid, options, visibilityEntity) {
      seen.push({
        shipID,
        guid,
        options: { ...options },
        visibilityEntity,
      });
    },
  };

  const effectStates = [
    {
      guid: "effects.SuperWeaponCaldari",
      moduleID: 991003088,
      typeID: 24552,
      superweaponFxStartActive: false,
      superweaponFxDurationMs: 10_000,
    },
    {
      guid: "effects.SuperWeaponMinmatar",
      moduleID: 991003089,
      typeID: 23674,
      superweaponFxStartActive: false,
      superweaponFxDurationMs: 10_000,
    },
  ];

  for (const effectState of effectStates) {
    const delivered = broadcastSuperweaponFxForTesting(
      scene,
      sourceEntity,
      effectState,
      3900000000000001,
      nowMs,
    );
    assert.equal(delivered, true, `expected ${effectState.guid} FX to broadcast`);
  }

  assert.equal(seen.length, 2, "expected both racial doomsday FX calls");
  for (const entry of seen) {
    assert.equal(entry.options.useCurrentVisibleStamp, undefined);
    assert.equal(entry.options.useCurrentStamp, true);
    assert.equal(entry.options.minimumLeadFromCurrentHistory, 2);
    assert.equal(entry.options.maximumLeadFromCurrentHistory, 2);
    assert.equal(entry.options.maximumHistorySafeLeadOverride, 2);
    assert.equal(entry.options.historyLeadUsesPresentedSessionStamp, true);
    assert.equal(entry.options.historyLeadPresentedMaximumFutureLead, 2);
    assert.equal(entry.options.start, true);
    assert.equal(entry.options.active, false);
    assert.equal(
      entry.options.startTime,
      toFileTimeFromMs(nowMs),
      "expected doomsday FX startTime to be serialized as FILETIME/blue time",
    );
  }
});

test("superweapon fresh-acquire replay uses FILETIME startTime", () => {
  const nowMs = 1775209611204;
  const scene = {
    getCurrentFileTime() {
      return toFileTimeFromMs(nowMs);
    },
    toFileTimeFromSimMs(value, fallback = this.getCurrentFileTime()) {
      return Number.isFinite(Number(value)) ? toFileTimeFromMs(value) : fallback;
    },
  };
  const replayOptions = buildSuperweaponFreshAcquireFxOptions(
    {
      superweaponEffect: true,
      guid: "effects.SuperWeaponCaldari",
      moduleID: 39500000000000110,
      typeID: 24552,
      superweaponFamily: "doomsday",
      superweaponFxStartActive: false,
      superweaponFxDurationMs: 10_000,
      superweaponFxLeadInMs: 0,
      superweaponActivatedAtMs: nowMs,
      superweaponPrimaryTargetID: 3950000000000038,
    },
    nowMs,
    scene,
  );
  assert.ok(replayOptions, "expected replay options");
  assert.equal(replayOptions.start, true);
  assert.equal(replayOptions.active, false);
  assert.equal(
    replayOptions.startTime,
    toFileTimeFromMs(nowMs),
    "expected replayed doomsday FX to keep FILETIME startTime parity",
  );
});

test("Leviathan and Ragnarok lethal doomsdays emit damage-state at or before teardown", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.flushAllSync();
  });

  const sourceProfiles = [
    resolveTitanSuperweaponProfileByHullTypeID(3764),
    resolveTitanSuperweaponProfileByHullTypeID(23773),
  ];
  const targetProfile = resolveTitanSuperweaponProfileByHullTypeID(11567);
  assert.ok(targetProfile, "expected target titan profile");

  for (const sourceProfile of sourceProfiles) {
    assert.ok(sourceProfile, "expected source titan profile");
    const ownerSession = prepareLiveSpaceSession(
      TEST_CHARACTER_ID,
      { x: 0, y: 0, z: 0 },
    );
    const observerSession = prepareLiveSpaceSession(
      TEST_OBSERVER_CHARACTER_ID,
      { x: 1000, y: 0, z: 0 },
    );
    const scene = spaceRuntime.getSceneForSession(ownerSession);
    assert.ok(scene, "expected scene");

    const source = spawnShip(scene, buildShipSpec({
      profile: sourceProfile,
      itemName: `${sourceProfile.hullType.name} Source`,
      modules: [sourceProfile.doomsdayType],
      position: { x: 60_000, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
    }));
    const target = spawnShip(scene, buildShipSpec({
      profile: targetProfile,
      itemName: "Near-Death Target",
      includeFuel: false,
      modules: [],
      position: { x: 140_000, y: 0, z: 0 },
      direction: { x: -1, y: 0, z: 0 },
    }));

    target.conditionState = {
      damage: 0.995,
      charge: 1,
      armorDamage: 0.995,
      shieldCharge: 0.005,
      incapacitated: false,
    };

    ownerSession.notifications.length = 0;
    observerSession.notifications.length = 0;

    const lockResult = scene.finalizeTargetLock(source, target, {
      nowMs: scene.getCurrentSimTimeMs(),
    });
    assert.equal(lockResult.success, true, "expected target lock");

    const activationResult = scene.activateGenericModule(
      buildNpcPseudoSession(source),
      source.fittedItems[0],
      null,
      {
        targetID: target.itemID,
        repeat: 1,
      },
    );
    assert.equal(activationResult.success, true, "expected doomsday activation");
    await flushDestinyNotifications();

    const ownerTimelineBefore = flattenDestinyUpdates(ownerSession.notifications);
    const observerTimelineBefore = flattenDestinyUpdates(observerSession.notifications);
    const ownerFx = ownerTimelineBefore.find((entry) => (
      entry.name === "OnSpecialFX" &&
      String(entry.args[5]) === String(sourceProfile.doomsdayFxGuid)
    ));
    const observerFx = observerTimelineBefore.find((entry) => (
      entry.name === "OnSpecialFX" &&
      String(entry.args[5]) === String(sourceProfile.doomsdayFxGuid)
    ));
    assert.ok(ownerFx, `expected owner ${sourceProfile.doomsdayFxGuid} FX`);
    assert.ok(observerFx, `expected observer ${sourceProfile.doomsdayFxGuid} FX`);

    advanceScene(scene, 20_000);
    await flushDestinyNotifications();

    const ownerTimeline = flattenDestinyUpdates(ownerSession.notifications);
    const lethalDamage = ownerTimeline
      .filter((entry) => (
        entry.name === "OnDamageStateChange" &&
        Number(entry.args[0]) === Number(target.itemID)
      ))
      .at(-1);
    const destruction = ownerTimeline.find((entry) => (
      entry.name === "TerminalPlayDestructionEffect" &&
      Number(entry.args[0]) === Number(target.itemID)
    ));
    const remove = ownerTimeline.find((entry) => (
      entry.name === "RemoveBalls" &&
      getRemoveBallsEntityIDs(entry).includes(Number(target.itemID))
    ));

    assert.ok(lethalDamage, "expected lethal damage-state update");
    assert.ok(destruction, "expected destruction effect");
    assert.ok(remove, "expected RemoveBalls teardown");
    assert.ok(
      Number(lethalDamage.stamp) <= Number(destruction.stamp),
      `expected lethal damage (${lethalDamage.stamp}) to land at/before destruction (${destruction.stamp})`,
    );
    assert.ok(
      Number(lethalDamage.stamp) <= Number(remove.stamp),
      `expected lethal damage (${lethalDamage.stamp}) to land at/before RemoveBalls (${remove.stamp})`,
    );
    assert.equal(
      scene.getEntityByID(target.itemID),
      null,
      "expected lethal doomsday target to be removed from scene",
    );

    ownerSession.notifications.length = 0;
    observerSession.notifications.length = 0;
    sessionRegistry.unregister(ownerSession);
    sessionRegistry.unregister(observerSession);
    const ownerIndex = registeredSessions.indexOf(ownerSession);
    if (ownerIndex >= 0) {
      registeredSessions.splice(ownerIndex, 1);
    }
    const observerIndex = registeredSessions.indexOf(observerSession);
    if (observerIndex >= 0) {
      registeredSessions.splice(observerIndex, 1);
    }
    spaceRuntime._testing.clearScenes();
  }
});

test("lance spawns its beacon, damages targets inside the cylinder, and ignores ships outside it", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.flushAllSync();
  });

  const ownerSession = prepareLiveSpaceSession(
    TEST_CHARACTER_ID,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = prepareLiveSpaceSession(
    TEST_OBSERVER_CHARACTER_ID,
    { x: 1000, y: 0, z: 0 },
  );
  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected scene");

  const amarrProfile = resolveTitanSuperweaponProfileByHullTypeID(11567);
  const gallenteProfile = resolveTitanSuperweaponProfileByHullTypeID(671);
  assert.ok(amarrProfile, "expected Avatar profile");
  assert.ok(gallenteProfile, "expected Erebus profile");

  const source = spawnShip(scene, buildShipSpec({
    profile: amarrProfile,
    itemName: "Lance Source",
    modules: [amarrProfile.lanceType],
    position: { x: 60_000, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
  }));
  const insideTarget = spawnShip(scene, buildShipSpec({
    profile: gallenteProfile,
    itemName: "Inside Target",
    includeFuel: false,
    modules: [],
    position: { x: 180_000, y: 0, z: 0 },
    direction: { x: -1, y: 0, z: 0 },
  }));
  const outsideTarget = spawnShip(scene, buildShipSpec({
    profile: gallenteProfile,
    itemName: "Outside Target",
    includeFuel: false,
    modules: [],
    position: { x: 180_000, y: 0, z: 30_000 },
    direction: { x: -1, y: 0, z: 0 },
  }));

  ownerSession.notifications.length = 0;
  observerSession.notifications.length = 0;

  const activationResult = scene.activateGenericModule(
    buildNpcPseudoSession(source),
    source.fittedItems[0],
    null,
    {
      targetPoint: { x: 260_000, y: 0, z: 0 },
      repeat: 1,
    },
  );
  assert.equal(activationResult.success, true, "expected lance activation");
  await flushDestinyNotifications();

  const ownerFx = flattenDestinyUpdates(ownerSession.notifications)
    .find((entry) => entry.name === "OnSpecialFX");
  const observerFx = flattenDestinyUpdates(observerSession.notifications)
    .find((entry) => entry.name === "OnSpecialFX");
  assert.ok(ownerFx, "expected owner lance FX");
  assert.ok(observerFx, "expected observer lance FX");
  assert.equal(String(ownerFx.args[5]), "effects.SuperWeaponLanceAmarr");

  const beacon = [...scene.dynamicEntities.values()].find((entity) => (
    entity &&
    entity.kind === "container" &&
    Number(entity.typeID) === 41233
  ));
  assert.ok(beacon, "expected modular effect beacon for the lance target point");

  const ownerBeaconAcquire = flattenDestinyUpdates(ownerSession.notifications)
    .find((entry) => (
      entry.name === "AddBalls2" &&
      getAddBalls2EntityIDs(entry).includes(Number(beacon.itemID))
    ));
  const observerBeaconAcquire = flattenDestinyUpdates(observerSession.notifications)
    .find((entry) => (
      entry.name === "AddBalls2" &&
      getAddBalls2EntityIDs(entry).includes(Number(beacon.itemID))
    ));
  const ownerTimeline = flattenDestinyUpdates(ownerSession.notifications);
  const observerTimeline = flattenDestinyUpdates(observerSession.notifications);
  const ownerBeaconAcquireIndex = ownerTimeline.findIndex((entry) => (
    entry.name === "AddBalls2" &&
    getAddBalls2EntityIDs(entry).includes(Number(beacon.itemID))
  ));
  const observerBeaconAcquireIndex = observerTimeline.findIndex((entry) => (
    entry.name === "AddBalls2" &&
    getAddBalls2EntityIDs(entry).includes(Number(beacon.itemID))
  ));
  const ownerFxIndex = ownerTimeline.findIndex((entry) => entry.name === "OnSpecialFX");
  const observerFxIndex = observerTimeline.findIndex((entry) => entry.name === "OnSpecialFX");
  assert.ok(ownerBeaconAcquire, "expected owner beacon acquire before lance FX");
  assert.ok(observerBeaconAcquire, "expected observer beacon acquire before lance FX");
  assert.ok(
    ownerBeaconAcquireIndex >= 0 && ownerFxIndex >= 0 && ownerBeaconAcquireIndex < ownerFxIndex,
    "expected owner beacon AddBalls2 to precede the lance OnSpecialFX in the delivered update stream",
  );
  assert.ok(
    observerBeaconAcquireIndex >= 0 && observerFxIndex >= 0 && observerBeaconAcquireIndex < observerFxIndex,
    "expected observer beacon AddBalls2 to precede the lance OnSpecialFX in the delivered update stream",
  );
  const ownerBeaconSlim = getAddBalls2SlimItem(ownerBeaconAcquire, beacon.itemID);
  assert.ok(ownerBeaconSlim, "expected beacon slim item in owner AddBalls2 payload");
  assert.equal(
    Number(getMarshalDictEntry(ownerBeaconSlim, "activityState")),
    1,
    "expected the beacon slim to arrive online for client presentation",
  );
  const ownerBeaconActivate = getMarshalDictEntry(ownerBeaconSlim, "component_activate");
  assert.ok(ownerBeaconActivate, "expected the beacon slim to include component_activate");

  advanceScene(scene, 10_000);
  assert.equal(
    targetDamagedOrDestroyed(scene, insideTarget.itemID),
    false,
    "expected the lance warning window to prevent early damage",
  );
  assert.equal(
    targetDamagedOrDestroyed(scene, outsideTarget.itemID),
    false,
    "expected the outside target to remain untouched before the damage window",
  );

  advanceScene(scene, 10_000);
  assert.equal(
    targetDamagedOrDestroyed(scene, insideTarget.itemID),
    true,
    "expected the inside target to be hit once the lance cylinder goes live",
  );
  assert.equal(
    targetDamagedOrDestroyed(scene, outsideTarget.itemID),
    false,
    "expected the outside target to remain untouched outside the lance cylinder",
  );
});

test("catalog exposes all eight racial titan superweapon loadouts with FX GUIDs", () => {
  const loadouts = listTitanSuperweaponLoadouts();
  assert.equal(loadouts.length, 8, "expected four doomsdays and four lances");

  const supportedFxGuids = new Set(loadouts.map((loadout) => String(loadout.fxGuid || "")));
  assert.deepEqual(
    [...supportedFxGuids].sort(),
    [
      "effects.SuperWeaponAmarr",
      "effects.SuperWeaponCaldari",
      "effects.SuperWeaponGallente",
      "effects.SuperWeaponLanceAmarr",
      "effects.SuperWeaponLanceCaldari",
      "effects.SuperWeaponLanceGallente",
      "effects.SuperWeaponLanceMinmatar",
      "effects.SuperWeaponMinmatar",
    ].sort(),
    "expected all racial titan superweapon FX GUIDs to be wired through the catalog",
  );
});

test("late observers replay active lance FX against the live beacon target", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.flushAllSync();
  });

  const ownerSession = prepareLiveSpaceSession(
    TEST_CHARACTER_ID,
    { x: 0, y: 0, z: 0 },
  );
  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected scene");

  const amarrProfile = resolveTitanSuperweaponProfileByHullTypeID(11567);
  const gallenteProfile = resolveTitanSuperweaponProfileByHullTypeID(671);
  assert.ok(amarrProfile, "expected Avatar profile");
  assert.ok(gallenteProfile, "expected Erebus profile");

  const source = spawnShip(scene, buildShipSpec({
    profile: amarrProfile,
    itemName: "Replay Lance Source",
    modules: [amarrProfile.lanceType],
    position: { x: 60_000, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    superweaponCycleOverrideMs: 30_000,
  }));
  spawnShip(scene, buildShipSpec({
    profile: gallenteProfile,
    itemName: "Replay Lance Target",
    includeFuel: false,
    modules: [],
    position: { x: 180_000, y: 0, z: 0 },
    direction: { x: -1, y: 0, z: 0 },
  }));

  const activationResult = scene.activateGenericModule(
    buildNpcPseudoSession(source),
    source.fittedItems[0],
    null,
    {
      targetPoint: { x: 260_000, y: 0, z: 0 },
      repeat: 1,
    },
  );
  assert.equal(activationResult.success, true, "expected lance activation");
  await flushDestinyNotifications();

  const beacon = [...scene.dynamicEntities.values()].find((entity) => (
    entity &&
    entity.kind === "container" &&
    Number(entity.typeID) === 41233
  ));
  assert.ok(beacon, "expected modular effect beacon");

  advanceScene(scene, 2_000);
  await flushDestinyNotifications();
  const lateObserverSession = prepareLiveSpaceSession(
    TEST_OBSERVER_CHARACTER_ID,
    { x: 1000, y: 0, z: 0 },
    { clearNotifications: false },
  );
  await flushDestinyNotifications();
  const replayFx = flattenDestinyUpdates(lateObserverSession.notifications)
    .find((entry) => (
      entry.name === "OnSpecialFX" &&
      String(entry.args[5]) === "effects.SuperWeaponLanceAmarr"
    ));
  assert.ok(replayFx, "expected late observer to receive active lance FX replay");
  assert.equal(
    Number(replayFx.args[3]),
    Number(beacon.itemID),
    "expected late-observer replay to keep the live beacon target for the lance FX",
  );
  assert.equal(
    Number(replayFx.args[8]),
    0,
    "expected late-observer replay to preserve the lance one-shot active flag",
  );
  assert.ok(
    Number(replayFx.args[11]) > 0,
    "expected late-observer replay to preserve the original superweapon start time",
  );
  assert.ok(
    Number(replayFx.args[12]) >= 1500,
    "expected late-observer replay to include elapsed time-from-start for in-flight FX",
  );
});
