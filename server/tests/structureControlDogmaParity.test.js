const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

process.env.ELYSIAN_EVE_SKIP_NPC_STARTUP = "1";

const repoRoot = path.join(__dirname, "..", "..");
const DogmaService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dogmaService",
));
const worldData = require(path.join(
  repoRoot,
  "server/src/space/worldData",
));

const originalGetStructureByID = worldData.getStructureByID;

function buildControlledStructureSession() {
  return {
    clientID: 92002,
    userid: 1,
    characterID: 140000002,
    charid: 140000002,
    shipID: 1030000000000,
    shipid: 1030000000000,
    activeShipID: 990112614,
    structureID: 1030000000000,
    structureid: 1030000000000,
    // Structure control is a space-mode structure session: shipid stays equal
    // to structureid, but locationid must be the solar system so client dogma
    // can load the structure item during MakeShipActive.
    locationid: 30002187,
    solarsystemid: 30002187,
    solarsystemid2: 30002187,
    sendNotification() {},
  };
}

function buildControlledStructureRecord() {
  return {
    structureID: 1030000000000,
    typeID: 35832,
    ownerCorpID: 1000044,
    ownerID: 1000044,
    solarSystemID: 30002187,
    itemName: "TestAstrahus",
    radius: 16000,
    shieldCapacity: 240000,
    armorHP: 180000,
    hullHP: 180000,
    conditionState: {
      shieldCharge: 1,
      armorDamage: 0,
      damage: 0,
      charge: 1,
    },
  };
}

function buildDockedShipRecord() {
  return {
    itemID: 990112614,
    typeID: 606,
    ownerID: 140000002,
    locationID: 1030000000000,
    flagID: 4,
    groupID: 25,
    categoryID: 6,
    quantity: -1,
    singleton: 1,
    stacksize: 1,
    conditionState: {
      shieldCharge: 1,
      armorDamage: 0,
      damage: 0,
      charge: 1,
    },
  };
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

function getDictEntryMap(value) {
  if (!value || value.type !== "dict" || !Array.isArray(value.entries)) {
    return new Map();
  }
  return new Map(value.entries);
}

function getInvItemLine(invItem) {
  if (invItem && invItem.type === "packedrow" && invItem.fields) {
    return (invItem.columns || []).map((column) => invItem.fields[column[0]]);
  }
  if (
    invItem &&
    invItem.name === "util.Row" &&
    invItem.args &&
    invItem.args.type === "dict" &&
    Array.isArray(invItem.args.entries)
  ) {
    return new Map(invItem.args.entries).get("line") || [];
  }
  return [];
}

test.afterEach(() => {
  worldData.getStructureByID = originalGetStructureByID;
});

test("dogma GetAllInfo primes the controlled structure as the active ship", () => {
  const session = buildControlledStructureSession();
  const structure = buildControlledStructureRecord();
  const dogma = new DogmaService();

  dogma._getCharacterRecord = () => ({
    characterID: session.characterID,
    charID: session.characterID,
    securityStatus: 0,
    characterAttributes: {},
  });
  dogma._getActiveShipRecord = () => buildDockedShipRecord();
  worldData.getStructureByID = (structureID) => {
    assert.equal(Number(structureID), structure.structureID);
    return structure;
  };

  const allInfo = dogma.Handle_GetAllInfo([false, true, true], session);

  assert.equal(getKeyValEntry(allInfo, "activeShipID"), structure.structureID);

  const shipInfo = getKeyValEntry(allInfo, "shipInfo");
  const shipInfoEntries = getDictEntryMap(shipInfo);
  assert.equal(shipInfoEntries.has(structure.structureID), true);
  assert.equal(shipInfoEntries.has(990112614), false);

  const structureShipInfo = shipInfoEntries.get(structure.structureID);
  const structureShipFields = new Map(structureShipInfo.args.entries);
  const structureInvItem = structureShipFields.get("invItem");
  const structureInvRow = getInvItemLine(structureInvItem);
  assert.equal(structureInvItem.type, "packedrow");
  assert.equal(structureInvRow[2], structure.ownerCorpID);
  assert.equal(
    structureInvRow[3],
    structure.structureID,
    "Expected the controlled structure to prime as its own location item",
  );
  assert.equal(structureInvRow[5], -1);
  assert.equal(structureInvRow[6], 1657);
  assert.equal(structureInvRow[7], 65);
  const attributeEntries = getDictEntryMap(structureShipFields.get("attributes"));
  assert.equal(attributeEntries.has(2216), true);

  const shipState = getKeyValEntry(allInfo, "shipState");
  assert.ok(Array.isArray(shipState), "Expected shipState tuple payload");
  const shipStateEntries = getDictEntryMap(shipState[0]);
  assert.equal(shipStateEntries.has(structure.structureID), true);
});

test("dogma ShipGetInfo and ItemGetInfo resolve the controlled structure", () => {
  const session = buildControlledStructureSession();
  const structure = buildControlledStructureRecord();
  const dogma = new DogmaService();

  dogma._getCharacterRecord = () => ({
    characterID: session.characterID,
    charID: session.characterID,
    securityStatus: 0,
    characterAttributes: {},
  });
  dogma._getActiveShipRecord = () => buildDockedShipRecord();
  worldData.getStructureByID = () => structure;

  const shipInfo = dogma.Handle_ShipGetInfo([], session);
  const shipInfoEntries = getDictEntryMap(shipInfo);
  assert.equal(shipInfoEntries.has(structure.structureID), true);

  const itemInfo = dogma.Handle_ItemGetInfo([structure.structureID], session);
  const itemInfoFields = new Map(itemInfo.args.entries);
  assert.equal(itemInfoFields.get("itemID"), structure.structureID);
  const invItem = itemInfoFields.get("invItem");
  assert.equal(invItem.type, "packedrow");
  const invRow = getInvItemLine(invItem);
  assert.equal(invRow[0], structure.structureID);
  assert.equal(invRow[5], -1);
});

test("dogma GetAllInfo leaves docked fitting bootstrap untouched while controlling a structure", () => {
  const session = buildControlledStructureSession();
  const dogma = new DogmaService();

  session._pendingDockedFittingBootstrap = {
    shipID: 990112614,
  };

  dogma.afterCallResponse("GetAllInfo", session);

  assert.ok(session._pendingDockedFittingBootstrap);
  session._pendingDockedFittingBootstrap = null;
});
