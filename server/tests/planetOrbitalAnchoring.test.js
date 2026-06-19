const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const repoRoot = path.join(__dirname, "..", "..");
const newDatabaseDataDir = process.env.EVEJS_NEWDB_DATA_DIR
  ? path.resolve(process.env.EVEJS_NEWDB_DATA_DIR)
  : path.join(repoRoot, "server/src/newDatabase/data");
const planetOrbitalStateFile = path.join(
  newDatabaseDataDir,
  "planetOrbitalState",
  "data.json",
);
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const destiny = require(path.join(repoRoot, "server/src/space/destiny"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const MachoNetService = require(path.join(
  repoRoot,
  "server/src/services/machoNet/machoNetService",
));
const PlanetOrbitalRegistryBrokerService = require(path.join(
  repoRoot,
  "server/src/services/planet/planetOrbitalRegistryBrokerService",
));
const PosMgrService = require(path.join(
  repoRoot,
  "server/src/services/planet/posMgrService",
));
const planetOrbitalState = require(path.join(
  repoRoot,
  "server/src/services/planet/planetOrbitalState",
));
const ShipService = require(path.join(
  repoRoot,
  "server/src/services/ship/shipService",
));
const itemStore = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));

const TEST_CHARACTER_ID = 140000238;
const TEST_CORPORATION_ID = 980090901;
const TEST_SOLAR_SYSTEM_ID = 30000001;
const TEST_SHIP_ID = 990009001;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function readTable(tableName) {
  const result = database.read(tableName, "/");
  assert.equal(result.success, true, `Failed to read ${tableName}`);
  return result.data || {};
}

function writeTable(tableName, value) {
  const result = database.write(tableName, "/", value, { force: true });
  assert.equal(result.success, true, `Failed to write ${tableName}`);
  const flushResult = database.flushTableSync(tableName);
  assert.equal(flushResult.success, true, `Failed to flush ${tableName}`);
}

function readPlanetOrbitalStateFile() {
  return JSON.parse(fs.readFileSync(planetOrbitalStateFile, "utf8"));
}

function buildSpaceSession() {
  const notifications = [];
  return {
    clientID: 8800901,
    userid: TEST_CHARACTER_ID,
    characterID: TEST_CHARACTER_ID,
    charid: TEST_CHARACTER_ID,
    corporationID: TEST_CORPORATION_ID,
    corpid: TEST_CORPORATION_ID,
    allianceID: 0,
    allianceid: 0,
    shipID: TEST_SHIP_ID,
    shipid: TEST_SHIP_ID,
    activeShipID: TEST_SHIP_ID,
    solarsystemid2: TEST_SOLAR_SYSTEM_ID,
    solarsystemid: TEST_SOLAR_SYSTEM_ID,
    _space: {
      shipID: TEST_SHIP_ID,
      systemID: TEST_SOLAR_SYSTEM_ID,
    },
    shipItem: {
      itemID: TEST_SHIP_ID,
      typeID: 606,
      ownerID: TEST_CHARACTER_ID,
      groupID: 25,
      categoryID: 6,
      radius: 50,
      itemName: "Test Ibis",
      spaceState: {
        systemID: TEST_SOLAR_SYSTEM_ID,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
        mode: "STOP",
        speedFraction: 0,
      },
    },
    _notifications: notifications,
    socket: { destroyed: false },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendServiceNotification() {},
  };
}

function attachSession(session) {
  const entity = spaceRuntime.attachSession(session, session.shipItem, {
    systemID: session.solarsystemid2,
    broadcast: false,
    spawnStopped: true,
  });
  assert.ok(entity, "Expected test session ship to attach to space runtime");
  session._notifications.length = 0;
  return entity;
}

function dictToMap(value) {
  assert.equal(value.type, "dict");
  return new Map(value.entries);
}

function keyValToMap(value) {
  assert.equal(value.name, "util.KeyVal");
  return dictToMap(value.args);
}

test.afterEach(() => {
  spaceRuntime._testing.clearScenes();
});

test("machoNet advertises POCO orbital services for client routing", () => {
  const machoNet = new MachoNetService();
  const serviceInfo = new Map(machoNet.getServiceInfoDict().entries);

  assert.equal(serviceInfo.get("planetMgr"), "solarsystem2");
  assert.equal(serviceInfo.get("planetOrbitalRegistryBroker"), "solarsystem2");
  assert.equal(serviceInfo.get("posMgr"), "solarsystem2");
});

test("ship Drop and posMgr drive a persisted gantry to online POCO cycle", (t) => {
  const itemsBackup = cloneJson(readTable(itemStore.ITEMS_TABLE));
  const orbitalBackup = cloneJson(readTable(planetOrbitalState.TABLE_NAME));
  t.after(() => {
    writeTable(itemStore.ITEMS_TABLE, itemsBackup);
    writeTable(planetOrbitalState.TABLE_NAME, orbitalBackup);
    itemStore.resetInventoryStoreForTests();
    planetOrbitalState.resetForTests(orbitalBackup);
  });

  itemStore.resetInventoryStoreForTests();
  planetOrbitalState.resetForTests({
    schemaVersion: planetOrbitalState.SCHEMA_VERSION,
    orbitalsByID: {},
  });

  const session = buildSpaceSession();
  attachSession(session);

  const grantResult = itemStore.grantItemToCharacterLocation(
    TEST_CHARACTER_ID,
    TEST_SHIP_ID,
    itemStore.ITEM_FLAGS.CARGO_HOLD,
    { typeID: planetOrbitalState.TYPE_CUSTOMS_OFFICE_GANTRY, name: "Customs Office Gantry" },
    2,
    { singleton: 0 },
  );
  assert.equal(grantResult.success, true);
  const cargoStackID = grantResult.data.items[0].itemID;

  const shipService = new ShipService();
  const launchResponse = shipService.Handle_Drop(
    [[[cargoStackID, 1]], TEST_CORPORATION_ID, true],
    session,
  );
  const launchEntries = dictToMap(launchResponse);
  const launchList = launchEntries.get(cargoStackID);
  assert.equal(launchList.type, "list");
  assert.equal(launchList.items.length, 1);
  const launchedItemID = launchList.items[0];
  assert.notEqual(launchedItemID, cargoStackID, "Expected launch to split one gantry from the cargo stack");

  const sourceStack = itemStore.findItemById(cargoStackID);
  assert.equal(sourceStack.locationID, TEST_SHIP_ID);
  assert.equal(sourceStack.flagID, itemStore.ITEM_FLAGS.CARGO_HOLD);
  assert.equal(sourceStack.stacksize, 1);

  const launchedItem = itemStore.findItemById(launchedItemID);
  assert.equal(launchedItem.ownerID, TEST_CORPORATION_ID);
  assert.equal(launchedItem.locationID, TEST_SOLAR_SYSTEM_ID);
  assert.equal(launchedItem.flagID, 0);
  assert.equal(launchedItem.spaceState.systemID, TEST_SOLAR_SYSTEM_ID);

  let orbital = planetOrbitalState.getOrbitalByID(launchedItemID);
  assert.equal(orbital.state, planetOrbitalState.ORBITAL_STATE.UNANCHORED);
  assert.ok(orbital.planetID > 0, "Expected launched gantry to be assigned to a planet");
  assert.equal(
    readPlanetOrbitalStateFile().orbitalsByID[String(launchedItemID)].state,
    planetOrbitalState.ORBITAL_STATE.UNANCHORED,
    "Expected launched orbital state to be present in data.json before debounce delay",
  );

  let entity = spaceRuntime.getEntity(session, launchedItemID);
  assert.equal(entity.kind, "orbital");
  assert.equal(entity.orbitalState, planetOrbitalState.ORBITAL_STATE.UNANCHORED);
  let slim = dictToMap(destiny.buildSlimItemDict(entity));
  assert.equal(slim.get("categoryID"), planetOrbitalState.CATEGORY_ORBITAL);
  assert.equal(slim.get("planetID"), orbital.planetID);
  assert.equal(slim.get("orbitalState"), planetOrbitalState.ORBITAL_STATE.UNANCHORED);

  const posMgr = new PosMgrService();
  assert.equal(posMgr.Handle_AnchorOrbital([launchedItemID], session), null);
  orbital = planetOrbitalState.getOrbitalByID(launchedItemID, { refresh: false });
  assert.equal(orbital.state, planetOrbitalState.ORBITAL_STATE.ANCHORING);
  assert.ok(orbital.stateEndsAtMs > Date.now());

  spaceRuntime.refreshInventoryBackedEntityPresentation(TEST_SOLAR_SYSTEM_ID, launchedItemID, {
    broadcast: false,
  });
  entity = spaceRuntime.getEntity(session, launchedItemID);
  slim = dictToMap(destiny.buildSlimItemDict(entity));
  assert.equal(slim.get("orbitalState"), planetOrbitalState.ORBITAL_STATE.ANCHORING);
  assert.equal(slim.get("orbitalTimestamp").type, "long");

  planetOrbitalState.tickDueOrbitals(Date.now() + planetOrbitalState.DEFAULT_ORBITAL_TIMER_MS + 1_000);
  orbital = planetOrbitalState.getOrbitalByID(launchedItemID, { refresh: false });
  assert.equal(orbital.state, planetOrbitalState.ORBITAL_STATE.ANCHORED);

  const materialGrant = itemStore.grantItemToOwnerLocation(
    TEST_CORPORATION_ID,
    launchedItemID,
    itemStore.ITEM_FLAGS.SPECIALIZED_MATERIAL_BAY,
    34,
    5,
  );
  assert.equal(materialGrant.success, true);
  assert.equal(
    itemStore.listContainerItems(null, launchedItemID, itemStore.ITEM_FLAGS.SPECIALIZED_MATERIAL_BAY).length,
    1,
  );

  assert.equal(posMgr.Handle_OnlineOrbital([launchedItemID], session), null);
  assert.equal(
    itemStore.listContainerItems(null, launchedItemID, itemStore.ITEM_FLAGS.SPECIALIZED_MATERIAL_BAY).length,
    0,
    "Expected OnlineOrbital to consume the gantry upgrade hold contents",
  );
  orbital = planetOrbitalState.getOrbitalByID(launchedItemID, { refresh: false });
  assert.equal(orbital.state, planetOrbitalState.ORBITAL_STATE.ONLINING);

  planetOrbitalState.tickDueOrbitals(Date.now() + planetOrbitalState.DEFAULT_ORBITAL_TIMER_MS + 1_000);
  spaceRuntime.refreshInventoryBackedEntityPresentation(TEST_SOLAR_SYSTEM_ID, launchedItemID, {
    broadcast: false,
  });
  orbital = planetOrbitalState.getOrbitalByID(launchedItemID, { refresh: false });
  assert.equal(orbital.state, planetOrbitalState.ORBITAL_STATE.IDLE);

  const onlineItem = itemStore.findItemById(launchedItemID);
  assert.equal(onlineItem.typeID, planetOrbitalState.TYPE_CUSTOMS_OFFICE);
  assert.equal(onlineItem.groupID, planetOrbitalState.GROUP_PLANETARY_CUSTOMS_OFFICES);

  entity = spaceRuntime.getEntity(session, launchedItemID);
  slim = dictToMap(destiny.buildSlimItemDict(entity));
  assert.equal(slim.get("typeID"), planetOrbitalState.TYPE_CUSTOMS_OFFICE);
  assert.equal(slim.get("orbitalState"), planetOrbitalState.ORBITAL_STATE.IDLE);

  const registry = new PlanetOrbitalRegistryBrokerService();
  assert.equal(registry.Handle_GetTaxRate([launchedItemID]), 0.05);
  const settings = registry.Handle_GetSettingsInfo([launchedItemID]);
  assert.equal(settings[0], 18);
  assert.equal(keyValToMap(settings[1]).get("corporation"), 0.05);

  assert.equal(registry.Handle_UpdateSettings([
    launchedItemID,
    12,
    { corporation: 0.08, alliance: 0.02 },
    -5,
    true,
    true,
    null,
  ]), null);
  const updatedSettings = registry.Handle_GetSettingsInfo([launchedItemID]);
  assert.equal(updatedSettings[0], 12);
  assert.equal(keyValToMap(updatedSettings[1]).get("corporation"), 0.08);
  assert.equal(updatedSettings[2], -5);
  assert.equal(updatedSettings[3], true);
  assert.equal(updatedSettings[4], true);
});
