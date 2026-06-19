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
  ITEM_FLAGS,
  resetInventoryStoreForTests,
} = require(path.join(repoRoot, "server/src/services/inventory/itemStore"));

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function getStackQuantity(item) {
  return Number(item && (item.stacksize ?? item.quantity)) || 0;
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
  return {
    characterID,
    charid: characterID,
    stationid: stationID,
    stationID,
    structureid: structureID,
    structureID,
    sendNotification() {},
  };
}

test("/createitem returns a numeric itemID for devtool fitting spawner flows", async (t) => {
  const originalItems = cloneValue(database.read("items", "/").data);
  t.after(() => {
    database.write("items", "/", originalItems);
    resetInventoryStoreForTests();
  });

  resetInventoryStoreForTests();
  const characterID = findDockedCharacterID();
  const session = buildDockedSession(characterID);
  const dockLocationID = Number(session.structureID || session.stationID || 0);
  const chatMessages = [];
  const chatHub = {
    sendSystemMessage(_session, message) {
      chatMessages.push(message);
    },
  };

  const result = chatCommands.executeChatCommand(
    session,
    "/createitem 34 5",
    chatHub,
    { emitChatFeedback: true },
  );

  assert.equal(result.handled, true);
  assert.equal(typeof result.message, "number");
  assert.equal(Number.isInteger(result.message), true);
  assert.equal(result.message > 0, true);
  assert.deepEqual(
    chatMessages,
    [],
    "expected /createitem success to stay quiet in chat because the client devtool consumes the raw itemID",
  );

  const createdItemResult = database.read("items", `/${result.message}`);
  assert.equal(createdItemResult.success, true);
  assert.equal(Number(createdItemResult.data.typeID), 34);
  assert.equal(Number(createdItemResult.data.ownerID), characterID);
  assert.equal(Number(createdItemResult.data.locationID), dockLocationID);
  assert.equal(Number(createdItemResult.data.flagID), ITEM_FLAGS.HANGAR);
  assert.equal(getStackQuantity(createdItemResult.data), 5);
});

test("/create is a quiet numeric itemID alias for the client GM fitting button", async (t) => {
  const originalItems = cloneValue(database.read("items", "/").data);
  t.after(() => {
    database.write("items", "/", originalItems);
    resetInventoryStoreForTests();
  });

  resetInventoryStoreForTests();
  const characterID = findDockedCharacterID();
  const session = buildDockedSession(characterID);
  const dockLocationID = Number(session.structureID || session.stationID || 0);
  const chatMessages = [];
  const chatHub = {
    sendSystemMessage(_session, message) {
      chatMessages.push(message);
    },
  };

  const result = chatCommands.executeChatCommand(
    session,
    "/create 21857 1",
    chatHub,
    { emitChatFeedback: true },
  );

  assert.equal(result.handled, true);
  assert.equal(typeof result.message, "number");
  assert.equal(Number.isInteger(result.message), true);
  assert.equal(result.message > 0, true);
  assert.deepEqual(
    chatMessages,
    [],
    "expected /create success to stay quiet in chat because the client GM fitting button consumes the raw itemID",
  );

  const createdItemResult = database.read("items", `/${result.message}`);
  assert.equal(createdItemResult.success, true);
  assert.equal(Number(createdItemResult.data.typeID), 21857);
  assert.equal(Number(createdItemResult.data.ownerID), characterID);
  assert.equal(Number(createdItemResult.data.locationID), dockLocationID);
  assert.equal(Number(createdItemResult.data.flagID), ITEM_FLAGS.HANGAR);
  assert.equal(getStackQuantity(createdItemResult.data), 1);
});
