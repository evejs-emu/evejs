const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const InvBrokerService = require(path.join(
  repoRoot,
  "server/src/services/inventory/invBrokerService",
));
const {
  getCorporationOffices,
} = require(path.join(
  repoRoot,
  "server/src/services/corporation/corporationRuntimeState",
));
const {
  listAssetItemsForLocation,
} = require(path.join(
  repoRoot,
  "server/src/services/corporation/corpAssetState",
));
const {
  ITEM_FLAGS,
  listContainerItems,
  grantItemToCharacterLocation,
  removeInventoryItem,
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

const TEST_CHARACTER_ID = 140000008;
const TEST_CORPORATION_ID = 98000002;
const CORP_DIVISION_FLAG = 115;

function getTestOffice() {
  const office = getCorporationOffices(TEST_CORPORATION_ID).find(
    (entry) => Number(entry.stationID) === 60003760,
  );
  assert.ok(office, "Expected corporation 98000002 to have an office at 60003760");
  return office;
}

function buildSession(office) {
  return {
    clientID: TEST_CHARACTER_ID + 93000,
    userid: TEST_CHARACTER_ID,
    characterID: TEST_CHARACTER_ID,
    charid: TEST_CHARACTER_ID,
    corporationID: TEST_CORPORATION_ID,
    corpid: TEST_CORPORATION_ID,
    stationID: office.stationID,
    stationid: office.stationID,
    stationid2: office.stationID,
    locationid: office.stationID,
    solarsystemid: null,
    solarsystemid2: office.solarSystemID,
    currentBoundObjectID: null,
    socket: { destroyed: false },
    notifications: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
    sendSessionChange() {},
  };
}

function getBoundID(value) {
  return (
    value &&
    value.type === "substruct" &&
    value.value &&
    value.value.type === "substream" &&
    Array.isArray(value.value.value)
      ? value.value.value[0]
      : null
  );
}

function getInventoryEntries(value) {
  if (!(value && value.type === "list" && Array.isArray(value.items))) {
    return [];
  }

  return value.items
    .map((item) => (item && item.type === "packedrow" && item.fields ? item.fields : item))
    .filter(Boolean);
}

test.afterEach(() => {
  resetInventoryStoreForTests();
});

test("dragging an item into a corp division hangar transfers ownership into the corp office and keeps assets readable", () => {
  resetInventoryStoreForTests();
  const office = getTestOffice();
  const session = buildSession(office);
  const service = new InvBrokerService();
  const tritanium = resolveItemByName("Tritanium");
  assert.equal(tritanium && tritanium.success, true, "Expected Tritanium metadata");

  const grantResult = grantItemToCharacterLocation(
    TEST_CHARACTER_ID,
    office.stationID,
    ITEM_FLAGS.HANGAR,
    tritanium.match,
    25,
    { transient: true },
  );
  assert.equal(grantResult.success, true, "Expected temporary source item grant");
  const sourceItem = grantResult.data.items[0];
  assert.ok(sourceItem && sourceItem.itemID, "Expected a temporary source item");

  try {
    const bound = service.Handle_GetInventoryFromId(
      [office.officeID],
      session,
      { locationID: office.stationID },
    );
    const boundID = getBoundID(bound);
    assert.ok(boundID, "Expected GetInventoryFromId to bind the corp office inventory");
    session.currentBoundObjectID = boundID;

    const movedItemID = service.Handle_Add(
      [sourceItem.itemID, office.stationID],
      session,
      { flag: CORP_DIVISION_FLAG },
    );
    const resolvedMovedItemID = Number(movedItemID || sourceItem.itemID);

    const sourceHangarItems = listContainerItems(
      TEST_CHARACTER_ID,
      office.stationID,
      ITEM_FLAGS.HANGAR,
    );
    assert.equal(
      sourceHangarItems.some((item) => Number(item.itemID) === Number(sourceItem.itemID)),
      false,
      "Expected the source item to leave the character hangar",
    );

    const corpDivisionItems = listContainerItems(
      TEST_CORPORATION_ID,
      office.officeID,
      CORP_DIVISION_FLAG,
    );
    const movedItem = corpDivisionItems.find(
      (item) => Number(item.itemID) === resolvedMovedItemID,
    );
    assert.ok(movedItem, "Expected the moved item to appear in the corp division");
    assert.equal(Number(movedItem.ownerID), TEST_CORPORATION_ID);
    assert.equal(Number(movedItem.locationID), Number(office.officeID));
    assert.equal(Number(movedItem.flagID), CORP_DIVISION_FLAG);

    const corpListRows = getInventoryEntries(
      service.Handle_List([CORP_DIVISION_FLAG], session, {}),
    );
    const listedMovedItem = corpListRows.find(
      (row) => Number(row.itemID) === resolvedMovedItemID,
    );
    assert.ok(listedMovedItem, "Expected List(flag=division) to include the transferred item");
    assert.equal(Number(listedMovedItem.ownerID), TEST_CORPORATION_ID);
    assert.equal(Number(listedMovedItem.locationID), Number(office.officeID));

    const corpAssetItems = listAssetItemsForLocation(
      TEST_CORPORATION_ID,
      office.stationID,
      "offices",
    );
    assert.equal(
      corpAssetItems.some((item) => Number(item.itemID) === resolvedMovedItemID),
      true,
      "Expected corp assets to resolve office-backed items moved into the corp hangar",
    );
  } finally {
    removeInventoryItem(sourceItem.itemID, { removeContents: true });
    resetInventoryStoreForTests();
  }
});

test("DeliverToCorpHangar routes menu-style corp deliveries through the same corp office authority", () => {
  resetInventoryStoreForTests();
  const office = getTestOffice();
  const session = buildSession(office);
  const service = new InvBrokerService();
  const tritanium = resolveItemByName("Tritanium");
  assert.equal(tritanium && tritanium.success, true, "Expected Tritanium metadata");

  const grantResult = grantItemToCharacterLocation(
    TEST_CHARACTER_ID,
    office.stationID,
    ITEM_FLAGS.HANGAR,
    tritanium.match,
    10,
    { transient: true },
  );
  assert.equal(grantResult.success, true, "Expected temporary source item grant");
  const sourceItem = grantResult.data.items[0];
  assert.ok(sourceItem && sourceItem.itemID, "Expected a temporary source item");

  try {
    const result = service.Handle_DeliverToCorpHangar(
      [[sourceItem.itemID], office.officeID, CORP_DIVISION_FLAG],
      session,
      { sourceLocationID: office.stationID },
    );
    assert.equal(result, true);

    const corpDivisionItems = listContainerItems(
      TEST_CORPORATION_ID,
      office.officeID,
      CORP_DIVISION_FLAG,
    );
    const movedItem = corpDivisionItems.find(
      (item) => Number(item.itemID) === Number(sourceItem.itemID),
    );
    assert.ok(movedItem, "Expected DeliverToCorpHangar to place the item into the corp office");
    assert.equal(Number(movedItem.ownerID), TEST_CORPORATION_ID);
    assert.equal(Number(movedItem.locationID), Number(office.officeID));
  } finally {
    removeInventoryItem(sourceItem.itemID, { removeContents: true });
    resetInventoryStoreForTests();
  }
});
