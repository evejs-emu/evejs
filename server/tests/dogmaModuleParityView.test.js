const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const DogmaService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dogmaService",
));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const {
  getActiveShipRecord,
} = require(path.join(repoRoot, "server/src/services/character/characterState"));
const {
  buildInventoryItem,
} = require(path.join(repoRoot, "server/src/services/inventory/itemStore"));
const {
  resolveItemByName,
} = require(path.join(repoRoot, "server/src/services/inventory/itemTypeRegistry"));
const {
  getAttributeIDByNames,
} = require(path.join(repoRoot, "server/src/services/fitting/liveFittingState"));

const ATTRIBUTE_MAX_TARGET_RANGE = getAttributeIDByNames("maxTargetRange") || 76;
const ATTRIBUTE_SCAN_RESOLUTION = getAttributeIDByNames("scanResolution") || 564;
const ATTRIBUTE_GRAVIMETRIC_SENSOR_STRENGTH =
  getAttributeIDByNames("Gravimetric Sensor Strength") || 211;
const ATTRIBUTE_SHIELD_EM_RESONANCE =
  getAttributeIDByNames("shieldEmDamageResonance") || 271;
const ATTRIBUTE_OPTIMAL_RANGE_BONUS =
  getAttributeIDByNames("optimalRangeBonus") || 351;
const ATTRIBUTE_FALLOFF_BONUS = getAttributeIDByNames("falloffBonus") || 349;
const ATTRIBUTE_TRACKING_SPEED_BONUS =
  getAttributeIDByNames("trackingSpeedBonus") || 767;
const ATTRIBUTE_MAX_TARGET_RANGE_BONUS =
  getAttributeIDByNames("maxTargetRangeBonus") || 309;
const ATTRIBUTE_SCAN_RESOLUTION_BONUS =
  getAttributeIDByNames("scanResolutionBonus") || 565;
const ATTRIBUTE_MISSILE_VELOCITY_BONUS =
  getAttributeIDByNames("missileVelocityBonus") || 547;
const ATTRIBUTE_FLIGHT_TIME_BONUS =
  getAttributeIDByNames("explosionDelayBonus") || 596;
const ATTRIBUTE_EXPLOSION_VELOCITY_BONUS =
  getAttributeIDByNames("aoeVelocityBonus") || 847;
const ATTRIBUTE_EXPLOSION_RADIUS_BONUS =
  getAttributeIDByNames("aoeCloudSizeBonus") || 848;
const ATTRIBUTE_CAPACITOR_NEED = getAttributeIDByNames("capacitorNeed") || 6;
const ATTRIBUTE_SHIELD_BONUS = getAttributeIDByNames("shieldBonus") || 68;
const ATTRIBUTE_ARMOR_DAMAGE_AMOUNT =
  getAttributeIDByNames("armorDamageAmount") || 84;
const ATTRIBUTE_MAX_RANGE = getAttributeIDByNames("maxRange") || 54;

function resolveExactItem(name) {
  const result = resolveItemByName(name);
  assert.equal(result && result.success, true, `Expected item '${name}' to exist`);
  return result.match;
}

function buildShipItem(typeName, itemID = 982000001) {
  const type = resolveExactItem(typeName);
  return buildInventoryItem({
    itemID,
    typeID: type.typeID,
    ownerID: 9000001,
    locationID: 60003760,
    singleton: 1,
  });
}

function buildFittedModule(typeName, itemID, shipID, flagID, options = {}) {
  const type = resolveExactItem(typeName);
  return buildInventoryItem({
    itemID,
    typeID: type.typeID,
    ownerID: 9000001,
    locationID: shipID,
    flagID,
    singleton: 1,
    moduleState: {
      online: options.online !== false,
    },
  });
}

function buildLoadedCharge(typeName, shipID, flagID, itemID) {
  const type = resolveExactItem(typeName);
  return buildInventoryItem({
    itemID,
    typeID: type.typeID,
    ownerID: 9000001,
    locationID: shipID,
    flagID,
    singleton: 0,
    quantity: 1,
    stacksize: 1,
  });
}

function attachSession(scene, entity, clientID) {
  const session = {
    clientID,
    characterID: 0,
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
    sendNotification() {},
    sendServiceNotification() {},
  };

  entity.session = session;
  scene.spawnDynamicEntity(entity, { broadcast: false });
  scene.sessions.set(clientID, session);
  return session;
}

test.afterEach(() => {
  spaceRuntime._testing.clearScenes();
});

test("dogma ship attributes reflect live active self-buff overlays", () => {
  const service = new DogmaService();
  const shipItem = buildShipItem("Rokh", 982100001);
  const sensorBooster = buildFittedModule(
    "Sensor Booster II",
    982100011,
    shipItem.itemID,
    19,
  );
  const shieldHardener = buildFittedModule(
    "EM Shield Hardener II",
    982100012,
    shipItem.itemID,
    20,
  );

  const scene = spaceRuntime.ensureScene(30000142);
  const entity = spaceRuntime._testing.buildRuntimeShipEntityForTesting({
    itemID: shipItem.itemID,
    typeID: shipItem.typeID,
    groupID: shipItem.groupID,
    categoryID: shipItem.categoryID,
    itemName: shipItem.itemName,
    ownerID: shipItem.ownerID,
    radius: shipItem.radius,
    conditionState: shipItem.conditionState,
    fittedItems: [sensorBooster, shieldHardener],
  }, scene.systemID);
  const session = attachSession(scene, entity, 98201);

  const baseline = service._buildShipAttributes({}, shipItem, session);

  let result = scene.activateGenericModule(session, sensorBooster);
  assert.equal(result.success, true);
  result = scene.activateGenericModule(session, shieldHardener);
  assert.equal(result.success, true);

  const active = service._buildShipAttributes({}, shipItem, session);

  assert.ok(active[ATTRIBUTE_MAX_TARGET_RANGE] > baseline[ATTRIBUTE_MAX_TARGET_RANGE]);
  assert.ok(active[ATTRIBUTE_SCAN_RESOLUTION] > baseline[ATTRIBUTE_SCAN_RESOLUTION]);
  assert.ok(
    active[ATTRIBUTE_GRAVIMETRIC_SENSOR_STRENGTH] >
      baseline[ATTRIBUTE_GRAVIMETRIC_SENSOR_STRENGTH],
  );
  assert.ok(
    active[ATTRIBUTE_SHIELD_EM_RESONANCE] < baseline[ATTRIBUTE_SHIELD_EM_RESONANCE],
  );

  result = scene.deactivateGenericModule(session, sensorBooster.itemID, {
    deferUntilCycle: false,
  });
  assert.equal(result.success, true);
  result = scene.deactivateGenericModule(session, shieldHardener.itemID, {
    deferUntilCycle: false,
  });
  assert.equal(result.success, true);

  const restored = service._buildShipAttributes({}, shipItem, session);
  assert.equal(restored[ATTRIBUTE_MAX_TARGET_RANGE], baseline[ATTRIBUTE_MAX_TARGET_RANGE]);
  assert.equal(restored[ATTRIBUTE_SCAN_RESOLUTION], baseline[ATTRIBUTE_SCAN_RESOLUTION]);
  assert.equal(
    restored[ATTRIBUTE_GRAVIMETRIC_SENSOR_STRENGTH],
    baseline[ATTRIBUTE_GRAVIMETRIC_SENSOR_STRENGTH],
  );
  assert.equal(
    restored[ATTRIBUTE_SHIELD_EM_RESONANCE],
    baseline[ATTRIBUTE_SHIELD_EM_RESONANCE],
  );
});

test("dogma module attributes reflect loaded tracking scripts", () => {
  const service = new DogmaService();
  const shipItem = buildShipItem("Rokh", 982200001);
  const trackingComputer = buildFittedModule(
    "Tracking Computer II",
    982200011,
    shipItem.itemID,
    19,
  );
  const optimalRangeScript = buildLoadedCharge(
    "Optimal Range Script",
    shipItem.itemID,
    trackingComputer.flagID,
    982200021,
  );
  const trackingSpeedScript = buildLoadedCharge(
    "Tracking Speed Script",
    shipItem.itemID,
    trackingComputer.flagID,
    982200022,
  );
  const session = { characterID: 0 };

  const baseline = service._buildInventoryItemAttributes(trackingComputer, session);
  const optimalScripted = service._buildInventoryItemAttributes(
    {
      ...trackingComputer,
      loadedChargeItem: optimalRangeScript,
    },
    session,
  );
  const trackingScripted = service._buildInventoryItemAttributes(
    {
      ...trackingComputer,
      loadedChargeItem: trackingSpeedScript,
    },
    session,
  );

  assert.equal(baseline[ATTRIBUTE_OPTIMAL_RANGE_BONUS], 7.5);
  assert.equal(baseline[ATTRIBUTE_FALLOFF_BONUS], 15);
  assert.equal(baseline[ATTRIBUTE_TRACKING_SPEED_BONUS], 15);

  assert.equal(optimalScripted[ATTRIBUTE_OPTIMAL_RANGE_BONUS], 15);
  assert.equal(optimalScripted[ATTRIBUTE_FALLOFF_BONUS], 30);
  assert.equal(optimalScripted[ATTRIBUTE_TRACKING_SPEED_BONUS], 0);

  assert.equal(trackingScripted[ATTRIBUTE_OPTIMAL_RANGE_BONUS], 0);
  assert.equal(trackingScripted[ATTRIBUTE_FALLOFF_BONUS], 0);
  assert.equal(trackingScripted[ATTRIBUTE_TRACKING_SPEED_BONUS], 30);
});

test("dogma module attributes reflect loaded sensor booster scripts", () => {
  const service = new DogmaService();
  const shipItem = buildShipItem("Rokh", 982300001);
  const sensorBooster = buildFittedModule(
    "Sensor Booster II",
    982300011,
    shipItem.itemID,
    19,
  );
  const scanResolutionScript = buildLoadedCharge(
    "Scan Resolution Script",
    shipItem.itemID,
    sensorBooster.flagID,
    982300021,
  );
  const targetingRangeScript = buildLoadedCharge(
    "Targeting Range Script",
    shipItem.itemID,
    sensorBooster.flagID,
    982300022,
  );
  const session = { characterID: 0 };

  const baseline = service._buildInventoryItemAttributes(sensorBooster, session);
  const scanScripted = service._buildInventoryItemAttributes(
    {
      ...sensorBooster,
      loadedChargeItem: scanResolutionScript,
    },
    session,
  );
  const rangeScripted = service._buildInventoryItemAttributes(
    {
      ...sensorBooster,
      loadedChargeItem: targetingRangeScript,
    },
    session,
  );

  assert.equal(baseline[ATTRIBUTE_MAX_TARGET_RANGE_BONUS], 30);
  assert.equal(baseline[ATTRIBUTE_SCAN_RESOLUTION_BONUS], 30);

  assert.equal(scanScripted[ATTRIBUTE_MAX_TARGET_RANGE_BONUS], 0);
  assert.equal(scanScripted[ATTRIBUTE_SCAN_RESOLUTION_BONUS], 60);

  assert.equal(rangeScripted[ATTRIBUTE_MAX_TARGET_RANGE_BONUS], 60);
  assert.equal(rangeScripted[ATTRIBUTE_SCAN_RESOLUTION_BONUS], 0);
});

test("dogma module attributes reflect loaded missile guidance scripts", () => {
  const service = new DogmaService();
  const shipItem = buildShipItem("Rokh", 982400001);
  const missileGuidanceComputer = buildFittedModule(
    "Missile Guidance Computer II",
    982400011,
    shipItem.itemID,
    19,
  );
  const missileRangeScript = buildLoadedCharge(
    "Missile Range Script",
    shipItem.itemID,
    missileGuidanceComputer.flagID,
    982400021,
  );
  const missilePrecisionScript = buildLoadedCharge(
    "Missile Precision Script",
    shipItem.itemID,
    missileGuidanceComputer.flagID,
    982400022,
  );
  const session = { characterID: 0 };

  const baseline = service._buildInventoryItemAttributes(
    missileGuidanceComputer,
    session,
  );
  const rangeScripted = service._buildInventoryItemAttributes(
    {
      ...missileGuidanceComputer,
      loadedChargeItem: missileRangeScript,
    },
    session,
  );
  const precisionScripted = service._buildInventoryItemAttributes(
    {
      ...missileGuidanceComputer,
      loadedChargeItem: missilePrecisionScript,
    },
    session,
  );

  assert.equal(baseline[ATTRIBUTE_MISSILE_VELOCITY_BONUS], 5.5);
  assert.equal(baseline[ATTRIBUTE_FLIGHT_TIME_BONUS], 5.5);
  assert.equal(baseline[ATTRIBUTE_EXPLOSION_VELOCITY_BONUS], 8.25);
  assert.equal(baseline[ATTRIBUTE_EXPLOSION_RADIUS_BONUS], -8.25);

  assert.equal(rangeScripted[ATTRIBUTE_MISSILE_VELOCITY_BONUS], 11);
  assert.equal(rangeScripted[ATTRIBUTE_FLIGHT_TIME_BONUS], 11);
  assert.equal(rangeScripted[ATTRIBUTE_EXPLOSION_VELOCITY_BONUS], 0);
  assert.equal(rangeScripted[ATTRIBUTE_EXPLOSION_RADIUS_BONUS], 0);

  assert.equal(precisionScripted[ATTRIBUTE_MISSILE_VELOCITY_BONUS], 0);
  assert.equal(precisionScripted[ATTRIBUTE_FLIGHT_TIME_BONUS], 0);
  assert.equal(precisionScripted[ATTRIBUTE_EXPLOSION_VELOCITY_BONUS], 16.5);
  assert.equal(precisionScripted[ATTRIBUTE_EXPLOSION_RADIUS_BONUS], -16.5);
});

test("dogma module attributes reflect ancillary shield booster loaded-charge capacitor override", () => {
  const service = new DogmaService();
  const shipItem = buildShipItem("Rokh", 982500001);
  const ancillaryShieldBooster = buildFittedModule(
    "Medium Ancillary Shield Booster",
    982500011,
    shipItem.itemID,
    19,
  );
  const loadedCapBooster = buildLoadedCharge(
    "Cap Booster 50",
    shipItem.itemID,
    ancillaryShieldBooster.flagID,
    982500021,
  );
  const session = { characterID: 0 };

  const baseline = service._buildInventoryItemAttributes(
    ancillaryShieldBooster,
    session,
  );
  const loaded = service._buildInventoryItemAttributes(
    {
      ...ancillaryShieldBooster,
      loadedChargeItem: loadedCapBooster,
    },
    session,
  );

  assert.equal(baseline[ATTRIBUTE_CAPACITOR_NEED], 198);
  assert.equal(loaded[ATTRIBUTE_CAPACITOR_NEED], 0);
  assert.equal(loaded[ATTRIBUTE_SHIELD_BONUS], baseline[ATTRIBUTE_SHIELD_BONUS]);
});

test("dogma module attributes keep ancillary armor repair bonus on the runtime side rather than the loaded item view", () => {
  const service = new DogmaService();
  const shipItem = buildShipItem("Rokh", 982600001);
  const ancillaryArmorRepairer = buildFittedModule(
    "Medium Ancillary Armor Repairer",
    982600011,
    shipItem.itemID,
    11,
  );
  const loadedPaste = buildLoadedCharge(
    "Nanite Repair Paste",
    shipItem.itemID,
    ancillaryArmorRepairer.flagID,
    982600021,
  );
  const session = { characterID: 0 };

  const baseline = service._buildInventoryItemAttributes(
    ancillaryArmorRepairer,
    session,
  );
  const loaded = service._buildInventoryItemAttributes(
    {
      ...ancillaryArmorRepairer,
      loadedChargeItem: loadedPaste,
    },
    session,
  );

  assert.equal(loaded[ATTRIBUTE_CAPACITOR_NEED], baseline[ATTRIBUTE_CAPACITOR_NEED]);
  assert.equal(
    loaded[ATTRIBUTE_ARMOR_DAMAGE_AMOUNT],
    baseline[ATTRIBUTE_ARMOR_DAMAGE_AMOUNT],
  );
});

test("dogma module attributes reflect live command burst range bonuses instead of the raw 15 km base", () => {
  const service = new DogmaService();
  const characterID = 140000001;
  const activeShip = getActiveShipRecord(characterID);
  assert.ok(activeShip && Number(activeShip.itemID) > 0, "Expected a seeded active ship for the parity character");

  const burstModule = buildFittedModule(
    "Mining Foreman Burst II",
    982700011,
    activeShip.itemID,
    27,
  );
  const baseline = service._buildInventoryItemAttributes(burstModule, null);
  const live = service._buildInventoryItemAttributes(burstModule, {
    characterID,
  });

  assert.equal(Number(baseline[ATTRIBUTE_MAX_RANGE]), 15000);
  assert.ok(
    Number(live[ATTRIBUTE_MAX_RANGE]) > 30000,
    "Expected live burst maxRange to include leadership/fleet hull bonuses instead of the raw 15 km base",
  );
});
