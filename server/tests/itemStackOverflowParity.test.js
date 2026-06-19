const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const {
  ITEM_FLAGS,
  CLIENT_INVENTORY_STACK_LIMIT,
  ensureMigrated,
  grantItemsToCharacterLocation,
  mergeItemStacks,
  listOwnedItems,
  findItemById,
  buildInventoryItem,
  resetInventoryStoreForTests,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));

const SNAPSHOT_TABLES = ["characters", "items"];

function readTable(tableName) {
  const result = database.read(tableName, "/");
  return result && result.success ? JSON.parse(JSON.stringify(result.data)) : {};
}

function writeTable(tableName, payload) {
  const result = database.write(tableName, "/", payload);
  assert.equal(result.success, true, `Failed to restore ${tableName}`);
}

function withSnapshots(fn) {
  return async () => {
    const snapshots = Object.fromEntries(
      SNAPSHOT_TABLES.map((tableName) => [tableName, readTable(tableName)]),
    );
    try {
      resetInventoryStoreForTests();
      await fn();
    } finally {
      for (const [tableName, payload] of Object.entries(snapshots)) {
        writeTable(tableName, payload);
      }
      resetInventoryStoreForTests();
    }
  };
}

function pickCharacterID() {
  const characters = readTable("characters");
  const candidateID = Object.keys(characters || {})
    .map((characterID) => Number(characterID) || 0)
    .find((characterID) => characterID > 0);
  assert.ok(candidateID > 0, "Expected at least one character in the characters table");
  return candidateID;
}

function nextSyntheticItemID(items) {
  let maxItemID = 1_990_000_000;
  for (const rawItem of Object.values(items || {})) {
    const itemID = Number(rawItem && rawItem.itemID) || 0;
    if (itemID > maxItemID) {
      maxItemID = itemID;
    }
  }
  return maxItemID + 1;
}

function getStackQuantity(item) {
  return Number(item && (item.stacksize ?? item.quantity)) || 0;
}

test(
  "ensureMigrated repairs oversized stackable items into client-safe stacks",
  withSnapshots(() => {
    const characterID = pickCharacterID();
    const items = readTable("items");
    const locationID = 910000001;
    const itemID = nextSyntheticItemID(items);
    const oversizedQuantity = (CLIENT_INVENTORY_STACK_LIMIT * 2) + 25;

    items[String(itemID)] = buildInventoryItem({
      itemID,
      typeID: 34,
      ownerID: characterID,
      locationID,
      flagID: ITEM_FLAGS.HANGAR,
      quantity: oversizedQuantity,
      stacksize: oversizedQuantity,
      singleton: 0,
      itemName: "Tritanium",
    });
    writeTable("items", items);

    resetInventoryStoreForTests();
    ensureMigrated();

    const repairedStacks = listOwnedItems(characterID, {
      locationID,
      flagID: ITEM_FLAGS.HANGAR,
      typeID: 34,
    }).sort((left, right) => getStackQuantity(right) - getStackQuantity(left));

    assert.equal(repairedStacks.length, 3);
    assert.deepEqual(
      repairedStacks.map((item) => getStackQuantity(item)),
      [CLIENT_INVENTORY_STACK_LIMIT, CLIENT_INVENTORY_STACK_LIMIT, 25],
    );
    assert.ok(
      repairedStacks.every((item) => getStackQuantity(item) <= CLIENT_INVENTORY_STACK_LIMIT),
    );
  }),
);

test(
  "grantItemsToCharacterLocation fills a partial stack and spills to a new client-safe stack",
  withSnapshots(() => {
    const characterID = pickCharacterID();
    const items = readTable("items");
    const locationID = 910000002;
    const itemID = nextSyntheticItemID(items);

    items[String(itemID)] = buildInventoryItem({
      itemID,
      typeID: 34,
      ownerID: characterID,
      locationID,
      flagID: ITEM_FLAGS.HANGAR,
      quantity: CLIENT_INVENTORY_STACK_LIMIT - 10,
      stacksize: CLIENT_INVENTORY_STACK_LIMIT - 10,
      singleton: 0,
      itemName: "Tritanium",
    });
    writeTable("items", items);

    resetInventoryStoreForTests();
    const grantResult = grantItemsToCharacterLocation(
      characterID,
      locationID,
      ITEM_FLAGS.HANGAR,
      [{
        itemType: 34,
        quantity: 25,
      }],
    );

    assert.equal(grantResult.success, true);
    assert.equal(grantResult.data.stackSplitApplied, true);

    const stacks = listOwnedItems(characterID, {
      locationID,
      flagID: ITEM_FLAGS.HANGAR,
      typeID: 34,
    }).sort((left, right) => getStackQuantity(right) - getStackQuantity(left));

    assert.deepEqual(
      stacks.map((item) => getStackQuantity(item)),
      [CLIENT_INVENTORY_STACK_LIMIT, 15],
    );
  }),
);

test(
  "mergeItemStacks never overflows the destination stack beyond the client-safe limit",
  withSnapshots(() => {
    const characterID = pickCharacterID();
    const items = readTable("items");
    const locationID = 910000003;
    const destinationItemID = nextSyntheticItemID(items);
    const sourceItemID = destinationItemID + 1;

    items[String(destinationItemID)] = buildInventoryItem({
      itemID: destinationItemID,
      typeID: 34,
      ownerID: characterID,
      locationID,
      flagID: ITEM_FLAGS.HANGAR,
      quantity: CLIENT_INVENTORY_STACK_LIMIT - 10,
      stacksize: CLIENT_INVENTORY_STACK_LIMIT - 10,
      singleton: 0,
      itemName: "Tritanium",
    });
    items[String(sourceItemID)] = buildInventoryItem({
      itemID: sourceItemID,
      typeID: 34,
      ownerID: characterID,
      locationID,
      flagID: ITEM_FLAGS.HANGAR,
      quantity: 30,
      stacksize: 30,
      singleton: 0,
      itemName: "Tritanium",
    });
    writeTable("items", items);

    resetInventoryStoreForTests();
    const mergeResult = mergeItemStacks(sourceItemID, destinationItemID);

    assert.equal(mergeResult.success, true);
    assert.equal(mergeResult.data.quantity, 10);
    assert.equal(getStackQuantity(findItemById(destinationItemID)), CLIENT_INVENTORY_STACK_LIMIT);
    assert.equal(getStackQuantity(findItemById(sourceItemID)), 20);
  }),
);
