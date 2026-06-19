const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const StructureAssetSafetyService = require(path.join(
  repoRoot,
  "server/src/services/structure/structureAssetSafetyService",
));
const structureState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureState",
));
const {
  ITEM_FLAGS,
  findItemById,
  grantItemToCharacterLocation,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));

function readTable(tableName) {
  const result = database.read(tableName, "/");
  assert.equal(result.success, true, `Failed to read ${tableName}`);
  return result.data;
}

function writeTable(tableName, payload) {
  const result = database.write(tableName, "/", payload);
  assert.equal(result.success, true, `Failed to write ${tableName}`);
}

function extractDictEntries(value) {
  return value && value.type === "dict" && Array.isArray(value.entries)
    ? value.entries
    : [];
}

function extractListItems(value) {
  return value && value.type === "list" && Array.isArray(value.items)
    ? value.items
    : [];
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

test("structure asset safety persists wraps and delivers them back into inventory", (t) => {
  const structuresBackup = readTable("structures");
  const wrapsBackup = readTable("structureAssetSafety");
  const itemsBackup = readTable("items");
  t.after(() => {
    writeTable("structures", structuresBackup);
    writeTable("structureAssetSafety", wrapsBackup);
    writeTable("items", itemsBackup);
    structureState.clearStructureCaches();
  });

  structureState.clearStructureCaches();

  const session = {
    characterID: 140000001,
    charid: 140000001,
    userid: 140000001,
    corporationID: 1000009,
    corpid: 1000009,
    solarsystemid2: 30000142,
    solarsystemid: 30000142,
  };

  const createResult = structureState.createStructure({
    typeID: 35832,
    name: "Asset Safety Test Astrahus",
    itemName: "Asset Safety Test Astrahus",
    ownerCorpID: session.corporationID,
    solarSystemID: 30000142,
    position: { x: 210000, y: 0, z: 240000 },
    state: 110,
    upkeepState: 1,
    hasQuantumCore: true,
    accessProfile: {
      docking: "public",
      tethering: "public",
    },
    serviceStates: {
      "1": 1,
      "2": 1,
    },
  });
  assert.equal(createResult.success, true, "Expected structure creation to succeed");

  const structureID = createResult.data.structureID;
  const grantResult = grantItemToCharacterLocation(
    session.characterID,
    structureID,
    ITEM_FLAGS.HANGAR,
    34,
    500,
  );
  assert.equal(grantResult.success, true, "Expected a test item to be granted to the structure hangar");
  const grantedItemID = Number(grantResult.data.items[0].itemID) || 0;
  assert.ok(grantedItemID > 0, "Expected a granted asset item ID");

  const service = new StructureAssetSafetyService();
  service.Handle_MovePersonalAssetsToSafety([30000142, structureID], session, null);

  const wrapsValue = service.Handle_GetItemsInSafetyForCharacter([], session, null);
  const wraps = extractListItems(wrapsValue);
  assert.equal(wraps.length, 1, "Expected a personal asset safety wrap after moving assets");

  const wrap = wraps[0];
  const wrapID = Number(getKeyValEntry(wrap, "assetWrapID")) || 0;
  const wrapName = String(getKeyValEntry(wrap, "wrapName") || "");
  assert.ok(wrapID > 0, "Expected a persisted asset safety wrap ID");
  assert.ok(wrapName.includes("Asset Safety"), "Expected a descriptive wrap name");

  const wrapNames = service.Handle_GetWrapNames([[wrapID]], session, null);
  assert.equal(
    extractDictEntries(wrapNames).some(([id, name]) => Number(id) === wrapID && String(name || "") === wrapName),
    true,
    "Expected GetWrapNames to resolve the persisted wrap name",
  );

  const deliveryTargets = service.Handle_GetStructuresICanDeliverTo([30000142], session, null);
  const nearestNpcStation = deliveryTargets[1];
  const stationID = Number(getKeyValEntry(nearestNpcStation, "itemID")) || 0;
  assert.ok(stationID > 0, "Expected an NPC fallback delivery station");

  service.Handle_MoveEjectTimeGM([wrapID, -10], session, null);
  service.Handle_MoveSafetyWrapToStructure(
    [wrapID, 30000142],
    session,
    {
      type: "dict",
      entries: [["destinationID", stationID]],
    },
  );

  const deliveredItem = findItemById(grantedItemID);
  assert.ok(deliveredItem, "Expected the granted item to still exist after delivery");
  assert.equal(
    Number(deliveredItem.locationID) || 0,
    stationID,
    "Expected delivered assets to move to the chosen destination",
  );
  assert.equal(
    Number(deliveredItem.flagID) || 0,
    ITEM_FLAGS.HANGAR,
    "Expected delivered assets to land in the hangar flag",
  );

  const wrapsAfterDelivery = extractListItems(
    service.Handle_GetItemsInSafetyForCharacter([], session, null),
  );
  assert.equal(
    wrapsAfterDelivery.length,
    0,
    "Expected delivered wraps to drop out of the active asset safety list",
  );
});
