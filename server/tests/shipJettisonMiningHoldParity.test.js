const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const ShipService = require(path.join(
  repoRoot,
  "server/src/services/ship/shipService",
));
const {
  ITEM_FLAGS,
  buildInventoryItem,
  buildShipItem,
  findItemById,
  resetInventoryStoreForTests,
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
  isJettisonableShipFlag,
  JETTISONABLE_FLAG_IDS,
} = require(path.join(
  repoRoot,
  "server/src/services/ship/jettisonRuntime",
));

const TEST_CHARACTER_ID = 998840910001;
const TEST_SYSTEM_ID = 30000142;
const TEST_SHIP_ID = 998840910101;
const TEST_ORE_ITEM_ID = 998840910201;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function snapshotMutableTables(t) {
  const mutableTables = ["characters", "items", "skills", "identityState"];
  const snapshots = new Map(mutableTables.map((table) => [
    table,
    cloneValue(database.read(table, "/").data || {}),
  ]));

  t.after(() => {
    for (const table of mutableTables) {
      database.write(table, "/", snapshots.get(table), { force: true });
    }
    database.flushAllSync();
    resetInventoryStoreForTests();
    if (spaceRuntime._testing && typeof spaceRuntime._testing.clearScenes === "function") {
      spaceRuntime._testing.clearScenes();
    }
  });
}

function writeTableEntry(table, key, value) {
  const writeResult = database.write(table, `/${key}`, value);
  assert.equal(writeResult.success, true, `failed to write ${table}/${key}`);
}

function buildSpaceSession() {
  return {
    userid: TEST_CHARACTER_ID,
    clientID: TEST_CHARACTER_ID + 1000,
    characterID: TEST_CHARACTER_ID,
    characterName: "Mining Hold Jettison",
    shipid: TEST_SHIP_ID,
    shipID: TEST_SHIP_ID,
    activeShipID: TEST_SHIP_ID,
    solarsystemid: TEST_SYSTEM_ID,
    solarsystemid2: TEST_SYSTEM_ID,
    _space: {
      systemID: TEST_SYSTEM_ID,
      shipID: TEST_SHIP_ID,
      simTimeMs: Date.now(),
    },
    notifications: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
  };
}

function seedCharacterShipAndOre(t) {
  snapshotMutableTables(t);

  writeTableEntry("characters", TEST_CHARACTER_ID, {
    characterID: TEST_CHARACTER_ID,
    characterName: "Mining Hold Jettison",
    corporationID: 1000001,
    allianceID: null,
    warFactionID: null,
    raceID: 1,
    bloodlineID: 1,
    gender: 1,
    stationID: null,
    solarSystemID: TEST_SYSTEM_ID,
    worldSpaceID: 0,
    shipID: TEST_SHIP_ID,
    shipTypeID: 17480,
    shipName: "Ore Hold Test Ship",
    homeStationID: 60003760,
    cloneStationID: 60003760,
    securityStatus: 0,
    securityRating: 0,
  });

  writeTableEntry("items", TEST_SHIP_ID, buildShipItem({
    itemID: TEST_SHIP_ID,
    typeID: 17480,
    ownerID: TEST_CHARACTER_ID,
    locationID: TEST_SYSTEM_ID,
    flagID: 0,
    itemName: "Ore Hold Test Ship",
    spaceState: {
      systemID: TEST_SYSTEM_ID,
      position: { x: 2500, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      targetPoint: { x: 2500, y: 0, z: 0 },
      mode: "STOP",
      speedFraction: 0,
    },
  }));

  const veldsparType = resolveItemByName("Veldspar");
  assert.equal(veldsparType.success, true, "expected Veldspar lookup to succeed");
  writeTableEntry("items", TEST_ORE_ITEM_ID, buildInventoryItem({
    itemID: TEST_ORE_ITEM_ID,
    typeID: veldsparType.match.typeID,
    ownerID: TEST_CHARACTER_ID,
    locationID: TEST_SHIP_ID,
    flagID: ITEM_FLAGS.GENERAL_MINING_HOLD,
    itemName: veldsparType.match.name,
    quantity: 1200,
    stacksize: 1200,
    singleton: 0,
  }));

  resetInventoryStoreForTests();
  if (spaceRuntime._testing && typeof spaceRuntime._testing.clearScenes === "function") {
    spaceRuntime._testing.clearScenes();
  }
}

test("ship Jettison accepts mined ore from the general mining hold", (t) => {
  seedCharacterShipAndOre(t);

  assert.equal(ITEM_FLAGS.GENERAL_MINING_HOLD, 134);
  assert.equal(isJettisonableShipFlag(ITEM_FLAGS.GENERAL_MINING_HOLD), true);
  assert.equal(JETTISONABLE_FLAG_IDS.has(ITEM_FLAGS.GENERAL_MINING_HOLD), true);

  const service = new ShipService();
  const session = buildSpaceSession();
  const result = service.Handle_Jettison([[TEST_ORE_ITEM_ID]], session, {});

  assert.deepEqual(
    result,
    [[TEST_ORE_ITEM_ID], []],
    "expected ore in flagGeneralMiningHold to jettison into a standard jetcan",
  );

  const movedOre = findItemById(TEST_ORE_ITEM_ID);
  assert.ok(movedOre, "expected the ore stack to remain tracked");
  assert.equal(movedOre.flagID, ITEM_FLAGS.HANGAR);
  assert.notEqual(
    movedOre.locationID,
    TEST_SHIP_ID,
    "expected the ore stack to leave the mining hold",
  );

  const jetcan = findItemById(movedOre.locationID);
  assert.ok(jetcan, "expected a spawned cargo container to own the moved ore");
  assert.equal(jetcan.locationID, TEST_SYSTEM_ID);
  assert.equal(jetcan.flagID, 0);
  assert.ok(
    session.notifications.some((notification) => notification.name === "OnItemChange"),
    "expected the client to receive inventory movement deltas",
  );
});
