const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const chatCommands = require(path.join(
  repoRoot,
  "server/src/services/chat/chatCommands",
));
const {
  getCharacterRecord,
} = require(path.join(repoRoot, "server/src/services/character/characterState"));
const {
  TABLE,
  readStaticRows,
} = require(path.join(repoRoot, "server/src/services/_shared/referenceData"));
const {
  ITEM_FLAGS,
  buildInventoryItem,
  listOwnedItems,
  resetInventoryStoreForTests,
} = require(path.join(repoRoot, "server/src/services/inventory/itemStore"));

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function getStackQuantity(item) {
  return Number(item && (item.stacksize ?? item.quantity)) || 0;
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

function isPublishedMineralRow(row) {
  const typeID = Number(row && row.typeID) || 0;
  const groupID = Number(row && row.groupID) || 0;
  const name = String(row && row.name || "").trim();
  if (typeID <= 0 || groupID !== 18 || row.published === false) {
    return false;
  }
  return !/\bunused\b/i.test(name);
}

function isPublishedOreRow(row) {
  const typeID = Number(row && row.typeID) || 0;
  const categoryID = Number(row && row.categoryID) || 0;
  const groupName = String(row && row.groupName || "").trim().toLowerCase();
  const name = String(row && row.name || "").trim().toLowerCase();
  if (typeID <= 0 || categoryID !== 25 || row.published === false) {
    return false;
  }
  if (
    groupName.includes("ice") ||
    groupName.includes("decorative") ||
    groupName.includes("non-interactable") ||
    /\bunused\b/i.test(name)
  ) {
    return false;
  }
  return true;
}

function getMineralAndOrePlan() {
  const rows = readStaticRows(TABLE.ITEM_TYPES) || [];
  const mineralTypeIDs = rows
    .filter(isPublishedMineralRow)
    .map((row) => Number(row.typeID) || 0)
    .filter((typeID) => typeID > 0)
    .sort((left, right) => left - right);
  const oreTypeIDs = rows
    .filter(isPublishedOreRow)
    .map((row) => Number(row.typeID) || 0)
    .filter((typeID) => typeID > 0)
    .sort((left, right) => left - right);

  return {
    mineralTypeIDs,
    oreTypeIDs,
    allTypeIDs: new Set([...mineralTypeIDs, ...oreTypeIDs]),
  };
}

function findDockedCharacterID() {
  const characters = database.read("characters", "/").data || {};
  const candidateIDs = Object.keys(characters)
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .sort((left, right) => left - right);

  for (const characterID of candidateIDs) {
    const record = getCharacterRecord(characterID);
    if (!record) {
      continue;
    }
    if (Number(record.stationID || record.stationid || record.structureID || 0) > 0) {
      return characterID;
    }
  }

  assert.fail("Expected at least one docked character in the characters table");
}

function buildDockedSession(characterID) {
  const record = getCharacterRecord(characterID);
  const stationID = Number(record.stationID || record.stationid || 0) || null;
  const structureID = Number(record.structureID || record.structureid || 0) || null;
  const notifications = [];
  return {
    characterID,
    charid: characterID,
    stationid: stationID,
    stationID,
    structureid: structureID,
    structureID,
    notifications,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };
}

test("/minerals requires a docked character session", () => {
  const result = chatCommands.executeChatCommand(
    {
      characterID: 140000001,
      charid: 140000001,
      stationid: null,
      stationID: null,
      structureid: null,
      structureID: null,
    },
    "/minerals",
    null,
    { emitChatFeedback: false },
  );

  assert.equal(result.handled, true);
  assert.equal(result.message, "You must be docked before using /minerals.");
});

test("/minerals replaces existing mineral and ore stocks with one 5,000,000-unit stack per published type", async (t) => {
  const originalItems = cloneValue(database.read("items", "/").data);
  t.after(() => {
    database.write("items", "/", originalItems);
    resetInventoryStoreForTests();
  });

  const plan = getMineralAndOrePlan();
  assert.ok(plan.mineralTypeIDs.length > 0, "Expected at least one mineral type");
  assert.ok(plan.oreTypeIDs.length > 0, "Expected at least one ore type");

  const characterID = findDockedCharacterID();
  const session = buildDockedSession(characterID);
  const locationID = Number(session.structureID || session.stationID || 0);
  assert.ok(locationID > 0, "Expected a valid docked location");

  const items = cloneValue(database.read("items", "/").data || {});
  for (const [itemID, item] of Object.entries(items)) {
    if (
      Number(item && item.ownerID) === characterID &&
      Number(item && item.locationID) === locationID &&
      Number(item && item.flagID) === ITEM_FLAGS.HANGAR &&
      plan.allTypeIDs.has(Number(item && item.typeID) || 0)
    ) {
      delete items[itemID];
    }
  }
  const seededTritaniumTypeID = 34;
  const seededOreTypeID = plan.oreTypeIDs[0];
  const firstItemID = nextSyntheticItemID(items);
  items[String(firstItemID)] = buildInventoryItem({
    itemID: firstItemID,
    ownerID: characterID,
    locationID,
    flagID: ITEM_FLAGS.HANGAR,
    typeID: seededTritaniumTypeID,
    itemName: "Synthetic Tritanium",
    quantity: 123,
    stacksize: 123,
    singleton: 0,
  });
  items[String(firstItemID + 1)] = buildInventoryItem({
    itemID: firstItemID + 1,
    ownerID: characterID,
    locationID,
    flagID: ITEM_FLAGS.HANGAR,
    typeID: seededOreTypeID,
    itemName: "Synthetic Ore",
    quantity: 456,
    stacksize: 456,
    singleton: 0,
  });
  database.write("items", "/", items);
  resetInventoryStoreForTests();

  const result = chatCommands.executeChatCommand(
    session,
    "/minerals",
    null,
    { emitChatFeedback: false },
  );

  assert.equal(result.handled, true);
  assert.match(
    result.message,
    new RegExp(
      `Re-seeded ${plan.mineralTypeIDs.length.toLocaleString("en-US")} mineral stacks and ${plan.oreTypeIDs.length.toLocaleString("en-US")} ore stacks`,
    ),
  );
  assert.match(
    result.message,
    /5,000,000/,
  );

  const grantedItems = listOwnedItems(characterID, {
    locationID,
    flagID: ITEM_FLAGS.HANGAR,
  }).filter((item) => plan.allTypeIDs.has(Number(item && item.typeID) || 0));

  assert.equal(
    grantedItems.length,
    plan.mineralTypeIDs.length + plan.oreTypeIDs.length,
    "Expected one hangar stack per mineral/ore type after clearing existing resources",
  );
  assert.ok(
    grantedItems.every((item) => getStackQuantity(item) === 5_000_000),
    "Expected every /minerals stack to use the reseeded 5,000,000-unit quantity",
  );
  assert.ok(
    grantedItems.some((item) => Number(item.typeID) === 34),
    "Expected Tritanium to be included in /minerals",
  );
  assert.ok(
    grantedItems.some((item) => plan.oreTypeIDs.includes(Number(item.typeID) || 0)),
    "Expected at least one ore type to be included in /minerals",
  );
  assert.equal(
    grantedItems.filter((item) => Number(item.typeID) === seededTritaniumTypeID).length,
    1,
    "Expected /minerals to replace existing Tritanium stocks instead of accumulating duplicates",
  );
  assert.equal(
    grantedItems.filter((item) => Number(item.typeID) === seededOreTypeID).length,
    1,
    "Expected /minerals to replace existing ore stocks instead of accumulating duplicates",
  );
});
