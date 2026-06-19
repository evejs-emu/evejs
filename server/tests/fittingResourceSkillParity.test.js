const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const CharService = require(path.join(
  repoRoot,
  "server/src/services/character/charService",
));
const DogmaService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dogmaService",
));
const characterState = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  getActiveShipRecord,
  buildInventoryItemRow,
  getCharacterRecord,
} = characterState;
const { buildChargeSublocationRow } = characterState._testing;
const {
  applySkillDrivenShipAttributeModifiers,
  applySkillFallbackAttributeBonuses,
  buildChargeTupleItemID,
  buildModuleStatusSnapshot,
  buildCharacterTargetingState,
  buildShipResourceState,
  getLoadedChargeItems,
  getFittedModuleItems,
  getEffectiveModuleResourceLoad,
  getAttributeIDByNames,
  getTypeAttributeValue,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));
const {
  buildFittingSnapshot,
} = require(path.join(
  repoRoot,
  "server/src/_secondary/fitting/fittingSnapshotBuilder",
));
const {
  findItemById,
  grantItemToCharacterLocation,
  grantItemToCharacterStationHangar,
  moveItemToLocation,
  resetInventoryStoreForTests,
  setActiveShipForCharacter,
  spawnShipInStationHangar,
  updateInventoryItem,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  grantCharacterSkillLevels,
  getCharacterSkillMap,
  replaceCharacterSkillRecords,
} = require(path.join(
  repoRoot,
  "server/src/services/skills/skillState",
));
const {
  resolveItemByName,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemTypeRegistry",
));

const {
  syncChargeSublocationForSession,
} = characterState;

const GUNNERY_SKILL_TYPE_ID = 3300;
const WEAPON_UPGRADES_SKILL_TYPE_ID = 3318;
const ADVANCED_WEAPON_UPGRADES_SKILL_TYPE_ID = 11207;
const TARGET_MANAGEMENT_SKILL_TYPE_ID = 3429;
const POWER_GRID_MANAGEMENT_SKILL_TYPE_ID = 3413;
const CPU_MANAGEMENT_SKILL_TYPE_ID = 3426;
const LONG_RANGE_TARGETING_SKILL_TYPE_ID = 3428;
const SIGNATURE_ANALYSIS_SKILL_TYPE_ID = 3431;
const NAVIGATION_SKILL_TYPE_ID = 3449;
const DRONE_NAVIGATION_SKILL_TYPE_ID = 12305;
const CLOAKING_SKILL_TYPE_ID = 11579;
const SPACESHIP_COMMAND_SKILL_TYPE_ID = 3327;
const EVASIVE_MANEUVERING_SKILL_TYPE_ID = 3453;
const ADVANCED_SPACESHIP_COMMAND_SKILL_TYPE_ID = 20342;
const CAPITAL_SHIPS_SKILL_TYPE_ID = 20533;
const DRAKE_TYPE_ID = 24698;
const HIGH_SLOT_FLAG_0 = 27;
const MED_SLOT_FLAG_0 = 19;
const ATTRIBUTE_POWER_LOAD = 15;
const ATTRIBUTE_CPU_LOAD = 49;
const ATTRIBUTE_MODULE_POWER_NEED = 30;
const ATTRIBUTE_MODULE_CPU_NEED = 50;
const ATTRIBUTE_MAX_LOCKED_TARGETS =
  getAttributeIDByNames("maxLockedTargets") || 192;
const ATTRIBUTE_POWER_OUTPUT = getAttributeIDByNames("powerOutput") || 11;
const ATTRIBUTE_CPU_OUTPUT = getAttributeIDByNames("cpuOutput") || 48;
const ATTRIBUTE_MAX_VELOCITY = getAttributeIDByNames("maxVelocity") || 37;
const ATTRIBUTE_MASS = getAttributeIDByNames("mass") || 4;
const ATTRIBUTE_AGILITY = getAttributeIDByNames("agility") || 70;
const ATTRIBUTE_MAX_TARGET_RANGE = getAttributeIDByNames("maxTargetRange") || 76;
const ATTRIBUTE_SCAN_RESOLUTION = getAttributeIDByNames("scanResolution") || 564;
const ATTRIBUTE_CLOAKING_TARGETING_DELAY =
  getAttributeIDByNames("cloakingTargetingDelay") || 560;

function buildAlphaToken(value, length = 3) {
  let state = Math.abs(Number(value) || 0);
  let token = "";
  for (let index = 0; index < length; index += 1) {
    token = String.fromCharCode(65 + (state % 26)) + token;
    state = Math.floor(state / 26);
  }
  return token;
}

const TEST_RUN_NAME_TOKEN = buildAlphaToken(Date.now() + process.pid, 3);

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function snapshotMutableTables() {
  return {
    characters: cloneValue(database.read("characters", "/").data || {}),
    identityState: cloneValue(database.read("identityState", "/").data || {}),
    items: cloneValue(database.read("items", "/").data || {}),
    skills: cloneValue(database.read("skills", "/").data || {}),
  };
}

function restoreMutableTables(snapshot) {
  database.write("characters", "/", cloneValue(snapshot.characters));
  database.write("identityState", "/", cloneValue(snapshot.identityState));
  database.write("items", "/", cloneValue(snapshot.items));
  database.write("skills", "/", cloneValue(snapshot.skills));
  database.flushAllSync();
  resetInventoryStoreForTests();
}

function resolveTypeIDByName(name) {
  const result = resolveItemByName(name);
  assert.equal(result.success, true, `Expected to resolve type ${name}`);
  return Number(result.match && result.match.typeID) || 0;
}

function createCharacter(userID, name) {
  const service = new CharService();
  const uniqueName = `${name.replace(/\s+/g, "")} ${TEST_RUN_NAME_TOKEN}`;
  const characterID = service.Handle_CreateCharacterWithDoll(
    [uniqueName, 5, 1, 1, null, null, 11],
    { userid: userID },
  );
  const characterRecord = getCharacterRecord(characterID);
  assert.ok(characterRecord, "Expected created character record");
  return {
    characterID,
    stationID: Number(characterRecord.stationID || characterRecord.stationid || 0),
  };
}

function seedExactWeaponUpgradeSkills(characterID) {
  const replaceResult = replaceCharacterSkillRecords(characterID, []);
  assert.equal(replaceResult.success, true, "Expected skill reset to succeed");
  grantCharacterSkillLevels(characterID, [
    { typeID: GUNNERY_SKILL_TYPE_ID, level: 5 },
    { typeID: WEAPON_UPGRADES_SKILL_TYPE_ID, level: 5 },
    { typeID: ADVANCED_WEAPON_UPGRADES_SKILL_TYPE_ID, level: 5 },
  ]);
}

function setupFlycatcherRailgun(characterID, stationID) {
  const shipTypeID = resolveTypeIDByName("Flycatcher");
  const moduleTypeID = resolveTypeIDByName("Dual 150mm Railgun I");

  const shipResult = spawnShipInStationHangar(characterID, stationID, shipTypeID);
  assert.equal(shipResult.success, true, "Expected test ship spawn to succeed");
  const ship = shipResult.data;

  const activateShipResult = setActiveShipForCharacter(characterID, ship.itemID);
  assert.equal(activateShipResult.success, true, "Expected active ship swap to succeed");

  const grantResult = grantItemToCharacterStationHangar(characterID, stationID, moduleTypeID, 1);
  assert.equal(grantResult.success, true, "Expected module grant to succeed");
  const grantedModule = grantResult.data.items[0];
  assert.ok(grantedModule, "Expected granted module item");

  const fitResult = moveItemToLocation(grantedModule.itemID, ship.itemID, HIGH_SLOT_FLAG_0);
  assert.equal(fitResult.success, true, "Expected module fitting move to succeed");

  return {
    ship: getActiveShipRecord(characterID),
    module: findItemById(grantedModule.itemID),
  };
}

function buildDockedSession(characterID, stationID, shipID) {
  const dockedStationID = Number(stationID) > 0 ? Number(stationID) : 60006580;
  return {
    userid: characterID + 700000,
    clientID: characterID + 800000,
    characterID,
    charid: characterID,
    stationid: dockedStationID,
    stationID: dockedStationID,
    shipID,
    shipid: shipID,
    activeShipID: shipID,
    socket: { destroyed: false },
    notifications: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
  };
}

function getModuleAttributeChangeItems(session) {
  const changes = [];
  for (const notification of session.notifications || []) {
    if (!notification || notification.name !== "OnModuleAttributeChanges") {
      continue;
    }
    for (const payloadEntry of notification.payload || []) {
      if (
        payloadEntry &&
        payloadEntry.type === "list" &&
        Array.isArray(payloadEntry.items)
      ) {
        changes.push(...payloadEntry.items);
      }
    }
  }
  return changes;
}

function setupPropulsionTestShip(characterID, stationID) {
  const shipTypeID = resolveTypeIDByName("Ibis");
  const propulsionTypeID = resolveTypeIDByName("1MN Afterburner I");
  const shipResult = spawnShipInStationHangar(characterID, stationID, shipTypeID);
  assert.equal(shipResult.success, true, "Expected propulsion test ship spawn to succeed");
  const ship = shipResult.data;
  assert.equal(
    setActiveShipForCharacter(characterID, ship.itemID).success,
    true,
    "Expected propulsion test ship activation",
  );
  const moduleResult = grantItemToCharacterLocation(
    characterID,
    ship.itemID,
    MED_SLOT_FLAG_0,
    propulsionTypeID,
    1,
    {
      singleton: true,
      moduleState: {
        online: true,
        damage: 0,
        charge: 0,
        armorDamage: 0,
        shieldCharge: 1,
        incapacitated: false,
      },
    },
  );
  assert.equal(moduleResult.success, true, "Expected propulsion module seed");
  return getActiveShipRecord(characterID);
}

test("tuple charge OnItemChange normalizes stacksize and singleton fields", () => {
  const session = {
    notifications: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
  };

  const tupleChargeItem = {
    itemID: [2990003620, 27, 24511],
    typeID: 24511,
    ownerID: 140000043,
    locationID: 2990003620,
    flagID: 27,
    quantity: 40,
    groupID: 655,
    categoryID: 8,
    customInfo: null,
    stacksize: null,
    singleton: null,
  };

  syncChargeSublocationForSession(session, tupleChargeItem, {});
  const notification = session.notifications.find(
    (entry) => entry && entry.name === "OnItemChange",
  );
  assert.ok(notification, "Expected OnItemChange notification");
  const row = notification.payload[0];
  assert.ok(row && row.fields, "Expected packedrow fields");
  assert.equal(row.fields.stacksize, 40);
  assert.equal(row.fields.singleton, 0);
  assert.equal(row.fields.customInfo, "");
});

function findAttributeChange(session, itemID, attributeID, nextValue, previousValue) {
  return getModuleAttributeChangeItems(session).find((change) => (
    Array.isArray(change) &&
    Number(change[2]) === Number(itemID) &&
    Number(change[3]) === Number(attributeID) &&
    Math.abs((Number(change[5]) || 0) - Number(nextValue)) <= 1e-6 &&
    (
      previousValue === undefined ||
      Math.abs((Number(change[6]) || 0) - Number(previousValue)) <= 1e-6
    )
  ));
}

function getKeyValEntry(value, key) {
  if (
    !value ||
    value.type !== "object" ||
    value.name !== "util.KeyVal" ||
    !value.args ||
    value.args.type !== "dict" ||
    !Array.isArray(value.args.entries)
  ) {
    return null;
  }
  const entry = value.args.entries.find(
    (candidate) => Array.isArray(candidate) && candidate[0] === key,
  );
  return entry ? entry[1] : null;
}

function getDictEntries(value) {
  if (!value || value.type !== "dict" || !Array.isArray(value.entries)) {
    return [];
  }
  return value.entries;
}

function getAttributeValueFromCommonEntry(commonEntry, attributeID) {
  const attributes = getKeyValEntry(commonEntry, "attributes");
  const entry = getDictEntries(attributes).find(
    (candidate) => Array.isArray(candidate) && Number(candidate[0]) === Number(attributeID),
  );
  return entry ? Number(entry[1]) || 0 : 0;
}

function getInvItemLineFromCommonEntry(commonEntry) {
  const invItem = getKeyValEntry(commonEntry, "invItem");
  if (invItem && invItem.type === "packedrow" && invItem.fields) {
    return (invItem.columns || []).map((column) => invItem.fields[column[0]]);
  }
  if (
    !invItem ||
    invItem.name !== "util.Row" ||
    !invItem.args ||
    invItem.args.type !== "dict" ||
    !Array.isArray(invItem.args.entries)
  ) {
    return null;
  }
  const lineEntry = invItem.args.entries.find(
    (candidate) => Array.isArray(candidate) && candidate[0] === "line",
  );
  return Array.isArray(lineEntry) ? lineEntry[1] : null;
}

function getPackedRowVirtualColumnPairs(row) {
  const virtualColumns =
    row &&
    row.type === "packedrow" &&
    row.header &&
    Array.isArray(row.header.header) &&
    row.header.header[2] &&
    row.header.header[2].type === "list" &&
    Array.isArray(row.header.header[2].items)
      ? row.header.header[2].items
      : [];
  return virtualColumns.map((column) => [
    Array.isArray(column) ? String(column[0]) : String(column),
    Array.isArray(column)
      ? String(column[1] && column[1].value ? column[1].value : column[1])
      : "",
  ]);
}

test("buildShipResourceState uses skill-adjusted weapon CPU and power loads", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const { characterID, stationID } = createCharacter(970001, "Fit Skill Load");
  seedExactWeaponUpgradeSkills(characterID);

  const { ship, module } = setupFlycatcherRailgun(characterID, stationID);
  const resourceState = buildShipResourceState(characterID, ship);
  const fittingSnapshot = buildFittingSnapshot(characterID, ship.itemID, {
    shipItem: ship,
  });
  const moduleLoad = getEffectiveModuleResourceLoad(
    ship,
    module,
    resourceState.skillMap,
    resourceState.fittedItems,
  );

  assert.equal(Number(getTypeAttributeValue(module.typeID, "cpuLoad", "cpu")), 30);
  assert.equal(Number(getTypeAttributeValue(module.typeID, "powerLoad", "power")), 70);
  assert.equal(resourceState.cpuOutput, 290);
  assert.equal(resourceState.powerOutput, 63);
  assert.equal(resourceState.cpuLoad, 22.5);
  assert.equal(resourceState.powerLoad, 63);
  assert.equal(moduleLoad.cpuLoad, 22.5);
  assert.equal(moduleLoad.powerLoad, 63);
  assert.equal(
    fittingSnapshot.resourceState.cpuLoad,
    resourceState.cpuLoad,
    "Expected central fitting snapshot CPU load to match live resource math",
  );
  assert.equal(
    fittingSnapshot.resourceState.powerLoad,
    resourceState.powerLoad,
    "Expected central fitting snapshot power load to match live resource math",
  );
  assert.deepEqual(
    fittingSnapshot.getModuleAttributeOverrides(module),
    {
      [ATTRIBUTE_MODULE_CPU_NEED]: 22.5,
      [ATTRIBUTE_MODULE_POWER_NEED]: 63,
    },
    "Expected central fitting snapshot to own fitted module CPU/power dogma values",
  );

  const dogma = new DogmaService();
  const session = buildDockedSession(characterID, stationID, ship.itemID);
  const shipAttributes = dogma._buildShipAttributes(
    { characterID },
    ship,
    session,
  );
  assert.equal(
    shipAttributes[ATTRIBUTE_CPU_LOAD],
    fittingSnapshot.shipAttributes[ATTRIBUTE_CPU_LOAD],
    "Expected normal dogma ship CPU load bootstrap to use the central fitting snapshot",
  );
  assert.equal(
    shipAttributes[ATTRIBUTE_POWER_LOAD],
    fittingSnapshot.shipAttributes[ATTRIBUTE_POWER_LOAD],
    "Expected normal dogma ship power load bootstrap to use the central fitting snapshot",
  );

  const moduleAttributes = dogma._buildInventoryItemAttributes(module, session);
  assert.equal(
    moduleAttributes[ATTRIBUTE_MODULE_CPU_NEED],
    22.5,
    "Expected fitted module dogma CPU need to match skill-adjusted resource math",
  );
  assert.equal(
    moduleAttributes[ATTRIBUTE_MODULE_POWER_NEED],
    63,
    "Expected fitted module dogma power need to match skill-adjusted resource math",
  );
});

test("dogma online checks use skill-adjusted fitting load instead of raw type load", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const { characterID, stationID } = createCharacter(970002, "Fit Online Test");
  seedExactWeaponUpgradeSkills(characterID);

  const { ship, module } = setupFlycatcherRailgun(characterID, stationID);
  const offlineResult = updateInventoryItem(module.itemID, (currentItem) => ({
    ...currentItem,
    moduleState: {
      ...(currentItem.moduleState || {}),
      online: false,
    },
  }));
  assert.equal(offlineResult.success, true, "Expected offline state seed to succeed");

  const dogma = new DogmaService();
  const session = buildDockedSession(characterID, stationID, ship.itemID);
  const onlineResult = dogma._setModuleOnlineState(ship.itemID, module.itemID, true, session);

  assert.equal(onlineResult.success, true, "Expected skilled online check to succeed");
  assert.equal(findItemById(module.itemID).moduleState.online, true);
});

test("dogma GetAllInfo ship bootstrap keeps ship max locked targets separate from character targeting modifiers", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const { characterID, stationID } = createCharacter(970004, "Fit Target Split");
  const replaceResult = replaceCharacterSkillRecords(characterID, []);
  assert.equal(replaceResult.success, true, "Expected skill reset to succeed");
  grantCharacterSkillLevels(characterID, [
    { typeID: TARGET_MANAGEMENT_SKILL_TYPE_ID, level: 5 },
  ]);

  const shipTypeID = resolveTypeIDByName("Flycatcher");
  const shipResult = spawnShipInStationHangar(characterID, stationID, shipTypeID);
  assert.equal(shipResult.success, true, "Expected test ship spawn to succeed");
  const ship = shipResult.data;

  const activateShipResult = setActiveShipForCharacter(characterID, ship.itemID);
  assert.equal(activateShipResult.success, true, "Expected active ship swap to succeed");

  const fittingSnapshot = buildFittingSnapshot(characterID, ship.itemID, {
    shipItem: getActiveShipRecord(characterID),
  });
  const characterTargetingState = buildCharacterTargetingState(characterID);
  const dogma = new DogmaService();
  const session = buildDockedSession(characterID, stationID, ship.itemID);
  const allInfo = dogma.Handle_GetAllInfo([false, true, null], session);

  const shipInfo = getKeyValEntry(allInfo, "shipInfo");
  assert.ok(shipInfo && shipInfo.type === "dict", "Expected GetAllInfo shipInfo dict");
  const shipEntryRow = getDictEntries(shipInfo).find(
    (candidate) => Array.isArray(candidate) && Number(candidate[0]) === Number(ship.itemID),
  );
  assert.ok(shipEntryRow, "Expected GetAllInfo shipInfo to include the active ship");

  const shipMaxLockedTargets = getAttributeValueFromCommonEntry(
    shipEntryRow[1],
    ATTRIBUTE_MAX_LOCKED_TARGETS,
  );
  const shipModifiedCharAttribs = getKeyValEntry(allInfo, "shipModifiedCharAttribs");
  const characterMaxLockedTargets = getAttributeValueFromCommonEntry(
    shipModifiedCharAttribs,
    ATTRIBUTE_MAX_LOCKED_TARGETS,
  );

  assert.equal(
    shipMaxLockedTargets,
    Number(fittingSnapshot.shipAttributes[ATTRIBUTE_MAX_LOCKED_TARGETS]) || 0,
    "Expected GetAllInfo shipInfo maxLockedTargets to stay on the shared ship fitting snapshot",
  );
  assert.equal(
    characterMaxLockedTargets,
    Number(characterTargetingState.maxLockedTargets) || 0,
    "Expected shipModifiedCharAttribs maxLockedTargets to stay on character targeting state",
  );
});

test("docked GetAllInfo keeps real loaded charge rows and avoids tuple HUD bootstrap", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const { characterID, stationID } = createCharacter(970006, "Dock Tuple Charge");
  const launcherTypeID = resolveTypeIDByName("Heavy Missile Launcher II");
  const chargeTypeID = resolveTypeIDByName("Inferno Fury Heavy Missile");
  const ship = getActiveShipRecord(characterID);
  assert.ok(ship, "Expected active rookie ship");

  const launcherGrantResult = grantItemToCharacterLocation(
    characterID,
    ship.itemID,
    HIGH_SLOT_FLAG_0,
    launcherTypeID,
    1,
    {
      singleton: true,
      moduleState: {
        online: true,
        damage: 0,
        charge: 0,
        armorDamage: 0,
        shieldCharge: 1,
        incapacitated: false,
      },
    },
  );
  assert.equal(launcherGrantResult.success, true, "Expected launcher grant to succeed");

  const chargeGrantResult = grantItemToCharacterLocation(
    characterID,
    ship.itemID,
    HIGH_SLOT_FLAG_0,
    chargeTypeID,
    40,
    {
      singleton: false,
    },
  );
  assert.equal(chargeGrantResult.success, true, "Expected loaded charge grant to succeed");

  const loadedCharge = getLoadedChargeItems(characterID, ship.itemID)[0];
  assert.ok(loadedCharge, "Expected loaded charge on the docked launcher");

  const dogma = new DogmaService();
  const session = buildDockedSession(characterID, stationID, ship.itemID);
  const allInfo = dogma.Handle_GetAllInfo([false, true, null], session);

  const shipInfo = getKeyValEntry(allInfo, "shipInfo");
  assert.ok(shipInfo && shipInfo.type === "dict", "Expected docked shipInfo dict");
  const shipInfoEntries = getDictEntries(shipInfo);
  const directChargeEntry = shipInfoEntries.find((candidate) => (
    Array.isArray(candidate) && Number(candidate[0]) === Number(loadedCharge.itemID)
  ));
  assert.ok(
    directChargeEntry,
    "Expected docked GetAllInfo shipInfo to seed the real loaded charge row",
  );

  const tupleKey = buildChargeTupleItemID(
    ship.itemID,
    loadedCharge.flagID,
    loadedCharge.typeID,
  );
  const tupleEntry = shipInfoEntries.find((candidate) => (
    Array.isArray(candidate) &&
    Array.isArray(candidate[0]) &&
    candidate[0].length === 3 &&
    Number(candidate[0][0]) === Number(tupleKey[0]) &&
    Number(candidate[0][1]) === Number(tupleKey[1]) &&
    Number(candidate[0][2]) === Number(tupleKey[2])
  ));
  assert.equal(
    tupleEntry,
    undefined,
    "Expected docked GetAllInfo shipInfo to avoid tuple-backed charge rows that poison fitting inventory",
  );

  const chargeState = getKeyValEntry(allInfo, "shipState");
  assert.ok(Array.isArray(chargeState) && chargeState[1], "Expected shipState charge dict");
  const chargeStateEntries = getDictEntries(chargeState[1]);
  assert.equal(
    chargeStateEntries.length,
    0,
    "Expected docked shipState to keep tuple charge-state sublocations out of the station fitting path",
  );
});

test("docked charge quantity transitions avoid tuple dogma updates", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const { characterID, stationID } = createCharacter(9700062, "Dock Charge Skip");
  const launcherTypeID = resolveTypeIDByName("Heavy Missile Launcher II");
  const chargeTypeID = resolveTypeIDByName("Inferno Fury Heavy Missile");
  const ship = getActiveShipRecord(characterID);
  assert.ok(ship, "Expected active rookie ship");

  const launcherGrantResult = grantItemToCharacterLocation(
    characterID,
    ship.itemID,
    HIGH_SLOT_FLAG_0,
    launcherTypeID,
    1,
    {
      singleton: true,
      moduleState: {
        online: true,
        damage: 0,
        charge: 0,
        armorDamage: 0,
        shieldCharge: 1,
        incapacitated: false,
      },
    },
  );
  assert.equal(launcherGrantResult.success, true, "Expected launcher grant to succeed");

  const chargeGrantResult = grantItemToCharacterLocation(
    characterID,
    ship.itemID,
    HIGH_SLOT_FLAG_0,
    chargeTypeID,
    40,
    {
      singleton: false,
    },
  );
  assert.equal(chargeGrantResult.success, true, "Expected loaded charge grant to succeed");

  const session = buildDockedSession(characterID, stationID, ship.itemID);
  const dogma = new DogmaService();
  dogma._notifyChargeQuantityTransition(
    session,
    characterID,
    ship.itemID,
    HIGH_SLOT_FLAG_0,
    { typeID: chargeTypeID, quantity: 40 },
    { typeID: chargeTypeID, quantity: 0 },
  );

  assert.equal(
    session.notifications.length,
    0,
    "Expected docked charge quantity changes to avoid tuple dogma notifications entirely",
  );
});

test("charge tuple sublocation rows use TQ physical columns plus virtual StackSize/Singleton", () => {
  const row = buildChargeSublocationRow({
    itemID: [2990003620, 27, 24511],
    typeID: 24511,
    ownerID: 140000043,
    locationID: 2990003620,
    flagID: 27,
    quantity: 40,
    groupID: 655,
    categoryID: 8,
    customInfo: "",
    stacksize: 40,
    singleton: 0,
  });

  assert.deepEqual(
    row.columns.map(([name]) => name),
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
    "Expected tuple charge rows to expose only TQ physical DBRow columns",
  );
  assert.deepEqual(
    getPackedRowVirtualColumnPairs(row),
    [
      ["stacksize", "eve.common.script.sys.eveCfg.StackSize"],
      ["singleton", "eve.common.script.sys.eveCfg.Singleton"],
    ],
    "Expected tuple charge rows to expose StackSize/Singleton through DBRowDescriptor virtual columns",
  );
  assert.equal(row.fields.stacksize, 40);
  assert.equal(row.fields.singleton, 0);
});

test("inventory rows use TQ physical columns plus virtual StackSize/Singleton", () => {
  const row = buildInventoryItemRow({
    itemID: 9988400019981,
    typeID: 2446,
    ownerID: 140000002,
    locationID: 30004579,
    flagID: 0,
    quantity: null,
    groupID: 100,
    categoryID: 18,
    customInfo: "",
    stacksize: 1,
    singleton: 1,
  });

  assert.deepEqual(
    row.columns.map(([name]) => name),
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
    "Expected inventory rows to expose only TQ physical DBRow columns",
  );
  assert.deepEqual(
    getPackedRowVirtualColumnPairs(row),
    [
      ["stacksize", "eve.common.script.sys.eveCfg.StackSize"],
      ["singleton", "eve.common.script.sys.eveCfg.Singleton"],
    ],
    "Expected inventory rows to expose StackSize/Singleton through DBRowDescriptor virtual columns",
  );
  assert.equal(row.fields.stacksize, 1);
  assert.equal(row.fields.singleton, 1);
});

test("shared ship agility math ignores capital-only fallback bonuses on a Drake", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const { characterID, stationID } = createCharacter(970007, "Agility Fallback Test");
  const shipResult = spawnShipInStationHangar(characterID, stationID, DRAKE_TYPE_ID);
  assert.equal(shipResult.success, true, "Expected Drake spawn to succeed");
  const ship = shipResult.data;
  const activateShipResult = setActiveShipForCharacter(characterID, ship.itemID);
  assert.equal(activateShipResult.success, true, "Expected active ship swap to succeed");

  const replaceResult = replaceCharacterSkillRecords(characterID, []);
  assert.equal(replaceResult.success, true, "Expected skill reset to succeed");
  grantCharacterSkillLevels(characterID, [
    { typeID: SPACESHIP_COMMAND_SKILL_TYPE_ID, level: 5 },
    { typeID: EVASIVE_MANEUVERING_SKILL_TYPE_ID, level: 5 },
    { typeID: ADVANCED_SPACESHIP_COMMAND_SKILL_TYPE_ID, level: 5 },
    { typeID: CAPITAL_SHIPS_SKILL_TYPE_ID, level: 5 },
  ]);

  const skillMap = getCharacterSkillMap(characterID);
  const fallbackOnlyAttributes = {
    [ATTRIBUTE_AGILITY]: 0.65,
  };
  applySkillFallbackAttributeBonuses(fallbackOnlyAttributes, skillMap);
  assert.equal(
    Number(fallbackOnlyAttributes[ATTRIBUTE_AGILITY].toFixed(6)),
    0.65,
    "Expected generic fallback agility math to stay off for hull-scoped capital agility skills",
  );

  applySkillDrivenShipAttributeModifiers(fallbackOnlyAttributes, skillMap);
  assert.equal(
    Number(fallbackOnlyAttributes[ATTRIBUTE_AGILITY].toFixed(6)),
    0.43875,
    "Expected only the explicit Spaceship Command and Evasive Maneuvering agility modifiers to apply to a Drake",
  );

  const resourceState = buildShipResourceState(characterID, findItemById(ship.itemID), {
    assumeActiveShipModules: true,
  });
  assert.equal(
    Number(resourceState.attributes[ATTRIBUTE_AGILITY].toFixed(6)),
    0.43875,
    "Expected shared ship fitting resource state to match the explicit agility dogma path",
  );
});

test("explicit ship skill modifiers are not double-applied by fallback fitting bonuses", (t) => {
  const baseAttributes = {
    [ATTRIBUTE_POWER_OUTPUT]: 100,
    [ATTRIBUTE_CPU_OUTPUT]: 100,
    [ATTRIBUTE_MAX_TARGET_RANGE]: 100,
    [ATTRIBUTE_SCAN_RESOLUTION]: 100,
  };
  const skillMap = new Map([
    [
      POWER_GRID_MANAGEMENT_SKILL_TYPE_ID,
      {
        typeID: POWER_GRID_MANAGEMENT_SKILL_TYPE_ID,
        skillLevel: 5,
        trainedSkillLevel: 5,
        effectiveSkillLevel: 5,
      },
    ],
    [
      CPU_MANAGEMENT_SKILL_TYPE_ID,
      {
        typeID: CPU_MANAGEMENT_SKILL_TYPE_ID,
        skillLevel: 5,
        trainedSkillLevel: 5,
        effectiveSkillLevel: 5,
      },
    ],
    [
      LONG_RANGE_TARGETING_SKILL_TYPE_ID,
      {
        typeID: LONG_RANGE_TARGETING_SKILL_TYPE_ID,
        skillLevel: 5,
        trainedSkillLevel: 5,
        effectiveSkillLevel: 5,
      },
    ],
    [
      SIGNATURE_ANALYSIS_SKILL_TYPE_ID,
      {
        typeID: SIGNATURE_ANALYSIS_SKILL_TYPE_ID,
        skillLevel: 5,
        trainedSkillLevel: 5,
        effectiveSkillLevel: 5,
      },
    ],
  ]);

  const fallbackOnlyAttributes = { ...baseAttributes };
  applySkillFallbackAttributeBonuses(fallbackOnlyAttributes, skillMap);
  assert.deepEqual(
    fallbackOnlyAttributes,
    baseAttributes,
    "Expected fallback fitting bonuses to skip attributes already covered by explicit ship dogma modifiers",
  );

  const skilledAttributes = { ...baseAttributes };
  applySkillFallbackAttributeBonuses(skilledAttributes, skillMap);
  applySkillDrivenShipAttributeModifiers(skilledAttributes, skillMap);

  assert.equal(
    skilledAttributes[ATTRIBUTE_POWER_OUTPUT],
    125,
    "Expected Power Grid Management explicit ship modifier to apply exactly once",
  );
  assert.equal(
    skilledAttributes[ATTRIBUTE_CPU_OUTPUT],
    125,
    "Expected CPU Management explicit ship modifier to apply exactly once",
  );
  assert.equal(
    skilledAttributes[ATTRIBUTE_MAX_TARGET_RANGE],
    125,
    "Expected Long Range Targeting explicit ship modifier to apply exactly once",
  );
  assert.equal(
    skilledAttributes[ATTRIBUTE_SCAN_RESOLUTION],
    125,
    "Expected Signature Analysis explicit ship modifier to apply exactly once",
  );
});

test("ship speed fallback ignores drone-only maxVelocity skills", () => {
  const attributes = {
    [ATTRIBUTE_MAX_VELOCITY]: 100,
  };
  const skillMap = new Map([
    [
      NAVIGATION_SKILL_TYPE_ID,
      {
        typeID: NAVIGATION_SKILL_TYPE_ID,
        skillLevel: 5,
        trainedSkillLevel: 5,
        effectiveSkillLevel: 5,
      },
    ],
    [
      DRONE_NAVIGATION_SKILL_TYPE_ID,
      {
        typeID: DRONE_NAVIGATION_SKILL_TYPE_ID,
        skillLevel: 5,
        trainedSkillLevel: 5,
        effectiveSkillLevel: 5,
      },
    ],
  ]);

  applySkillFallbackAttributeBonuses(attributes, skillMap);
  applySkillDrivenShipAttributeModifiers(attributes, skillMap);

  assert.equal(
    attributes[ATTRIBUTE_MAX_VELOCITY],
    125,
    "Expected Drone Navigation to stop leaking into ship maxVelocity while Navigation still applies",
  );
});

test("fallback fitting bonuses still cover cloaking targeting delay when dogma ship modifiers are absent", () => {
  const attributes = {
    [ATTRIBUTE_CLOAKING_TARGETING_DELAY]: 10,
  };
  const skillMap = new Map([
    [
      CLOAKING_SKILL_TYPE_ID,
      {
        typeID: CLOAKING_SKILL_TYPE_ID,
        skillLevel: 5,
        trainedSkillLevel: 5,
        effectiveSkillLevel: 5,
      },
    ],
  ]);

  applySkillFallbackAttributeBonuses(attributes, skillMap);

  assert.equal(
    attributes[ATTRIBUTE_CLOAKING_TARGETING_DELAY],
    5,
    "Expected Cloaking to keep using the fallback targeting-delay bonus until full dogma coverage exists",
  );
});

test("docked fitting snapshots assume active propulsion for displayed ship navigation stats", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const { characterID, stationID } = createCharacter(970005, "Fit Active Prop");
  const ship = setupPropulsionTestShip(characterID, stationID);
  assert.ok(ship, "Expected active propulsion test ship");

  const fittedItems = getFittedModuleItems(characterID, ship.itemID);
  const propulsionModule = fittedItems.find((item) => (
    Number(getTypeAttributeValue(item && item.typeID, "speedBoostFactor")) > 0 &&
    Number(getTypeAttributeValue(item && item.typeID, "massAddition")) > 0
  ));
  assert.ok(propulsionModule, "Expected test ship propulsion module");

  const passiveState = buildShipResourceState(characterID, ship, {
    fittedItems,
  });
  const fittingSnapshot = buildFittingSnapshot(characterID, ship.itemID, {
    shipItem: ship,
    fittedItems,
  });

  const moduleMassAddition = Number(
    getTypeAttributeValue(propulsionModule.typeID, "massAddition"),
  ) || 0;

  assert.ok(fittingSnapshot, "Expected fitting snapshot");
  assert.equal(
    Number(fittingSnapshot.shipAttributes[ATTRIBUTE_MASS]) || 0,
    (Number(passiveState.attributes[ATTRIBUTE_MASS]) || 0) + moduleMassAddition,
    "Expected docked fitting snapshot mass to include active propulsion mass addition",
  );
  assert.ok(
    (Number(fittingSnapshot.shipAttributes[ATTRIBUTE_MAX_VELOCITY]) || 0) >
      (Number(passiveState.attributes[ATTRIBUTE_MAX_VELOCITY]) || 0),
    "Expected docked fitting snapshot maxVelocity to include active propulsion bonus",
  );
});

test("legacy fitted modules without explicit moduleState still surface as online", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const { characterID, stationID } = createCharacter(970003, "Fit Legacy Online");
  seedExactWeaponUpgradeSkills(characterID);

  const { ship, module } = setupFlycatcherRailgun(characterID, stationID);
  const legacyStateResult = updateInventoryItem(module.itemID, (currentItem) => ({
    ...currentItem,
    moduleState: undefined,
  }));
  assert.equal(legacyStateResult.success, true, "Expected implicit online legacy seed");

  const implicitModule = findItemById(module.itemID);
  assert.equal(
    Object.prototype.hasOwnProperty.call(implicitModule, "moduleState"),
    false,
    "Expected legacy fitted module to lack moduleState entirely",
  );
  assert.equal(buildModuleStatusSnapshot(implicitModule).online, true);

  const dogma = new DogmaService();
  const session = buildDockedSession(characterID, stationID, ship.itemID);
  const onlineModules = dogma.Handle_ShipOnlineModules([], session);

  assert.deepEqual(onlineModules, {
    type: "list",
    items: [module.itemID],
  });

  const onlineResult = dogma._setModuleOnlineState(ship.itemID, module.itemID, true, session);
  assert.equal(
    onlineResult.success,
    true,
    "Expected implicit-online module to avoid double-counted fitting rejection",
  );
  assert.equal(findItemById(module.itemID).moduleState.online, true);
});

test("dogma online state changes notify ship CPU and power load attributes", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const { characterID, stationID } = createCharacter(970004, "Fit Resource Note");
  seedExactWeaponUpgradeSkills(characterID);

  const { ship, module } = setupFlycatcherRailgun(characterID, stationID);
  const onlineSeedResult = updateInventoryItem(module.itemID, (currentItem) => ({
    ...currentItem,
    moduleState: {
      ...(currentItem.moduleState || {}),
      online: true,
    },
  }));
  assert.equal(onlineSeedResult.success, true, "Expected online seed to succeed");

  const dogma = new DogmaService();
  const session = buildDockedSession(characterID, stationID, ship.itemID);

  const offlineResult = dogma._setModuleOnlineState(ship.itemID, module.itemID, false, session);
  assert.equal(offlineResult.success, true, "Expected offline to succeed");
  assert.ok(
    findAttributeChange(session, ship.itemID, ATTRIBUTE_CPU_LOAD, 0, 22.5),
    "Expected offlining to notify ship cpuLoad decrease",
  );
  assert.ok(
    findAttributeChange(session, ship.itemID, ATTRIBUTE_POWER_LOAD, 0, 63),
    "Expected offlining to notify ship powerLoad decrease",
  );

  session.notifications = [];
  const onlineResult = dogma._setModuleOnlineState(ship.itemID, module.itemID, true, session);
  assert.equal(onlineResult.success, true, "Expected online to succeed");
  assert.ok(
    findAttributeChange(session, ship.itemID, ATTRIBUTE_CPU_LOAD, 22.5, 0),
    "Expected onlining to notify ship cpuLoad increase",
  );
  assert.ok(
    findAttributeChange(session, ship.itemID, ATTRIBUTE_POWER_LOAD, 63, 0),
    "Expected onlining to notify ship powerLoad increase",
  );
});
