const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const CharService = require(path.join(
  repoRoot,
  "server/src/services/character/charService",
));
const {
  ITEM_FLAGS,
  grantItemToCharacterLocation,
} = require(path.join(repoRoot, "server/src/services/inventory/itemStore"));

const TEST_ACCOUNT_ID = 99884191;
const TEST_CHARACTER_ID = 998841910001;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function readTable(tableName) {
  const result = database.read(tableName, "/");
  assert.equal(result.success, true, `Failed to read ${tableName}`);
  return result.data;
}

function writeTable(tableName, payload) {
  const result = database.write(tableName, "/", payload);
  assert.equal(result.success, true, `Failed to write ${tableName}`);
}

function getKeyValEntry(keyVal, key) {
  if (
    !keyVal ||
    keyVal.type !== "object" ||
    keyVal.name !== "util.KeyVal" ||
    !keyVal.args ||
    keyVal.args.type !== "dict" ||
    !Array.isArray(keyVal.args.entries)
  ) {
    return undefined;
  }

  const entry = keyVal.args.entries.find(
    (candidate) => Array.isArray(candidate) && candidate[0] === key,
  );
  return entry ? entry[1] : undefined;
}

function getSelectionCharacterRow(charService, session, characterID) {
  const tuple = charService.Handle_GetCharacterSelectionData([], session);
  const characterDetails =
    tuple && tuple[2] && tuple[2].type === "list" && Array.isArray(tuple[2].items)
      ? tuple[2].items
      : [];
  return (
    characterDetails.find(
      (row) => Number(getKeyValEntry(row, "characterID")) === characterID,
    ) || null
  );
}

function getSeededStructure() {
  const structuresTable = readTable("structures");
  const structures = Array.isArray(structuresTable && structuresTable.structures)
    ? structuresTable.structures
    : [];
  const structure = structures.find(
    (candidate) => Number(candidate && candidate.structureID) > 0,
  );

  assert.ok(structure, "Expected PublicEveJS to ship at least one seeded structure");
  return {
    structureID: Number(structure.structureID),
    solarSystemID: Number(structure.solarSystemID) || 30000142,
    constellationID: Number(structure.constellationID) || 20000020,
    regionID: Number(structure.regionID) || 10000002,
  };
}

function seedStructureDockedCharacter(structure) {
  const nextCharacters = cloneValue(readTable("characters"));
  nextCharacters[String(TEST_CHARACTER_ID)] = {
    accountId: TEST_ACCOUNT_ID,
    characterName: "Structure Select Parity",
    gender: 1,
    bloodlineID: 8,
    ancestryID: 12,
    raceID: 2,
    typeID: 1380,
    corporationID: 1000044,
    allianceID: 0,
    factionID: 500001,
    schoolID: 33,
    stationID: null,
    structureID: structure.structureID,
    solarSystemID: structure.solarSystemID,
    constellationID: structure.constellationID,
    regionID: structure.regionID,
    createDateTime: "134201276043840000",
    startDateTime: "134201276043840000",
    logoffDate: "134201276043840000",
    deletePrepareDateTime: null,
    lockTypeID: null,
    securityRating: 0,
    securityStatus: 0,
    title: "",
    aurBalance: 0,
    plexBalance: 0,
    balance: 100000,
    skillPoints: 50000,
    shipTypeID: 22544,
    shipName: "Hulk",
    bounty: 0,
    skillQueueEndTime: 0,
    daysLeft: 365,
    userType: 30,
    petitionMessage: "",
    worldSpaceID: 0,
    unreadMailCount: 0,
    upcomingEventCount: 0,
    unprocessedNotifications: 0,
    shipID: 0,
    shortName: "none",
    allianceMemberStartDate: 0,
    finishedSkills: [],
    suppressSkillBootstrap: true,
    homeStationID: structure.structureID,
    cloneStationID: structure.structureID,
  };

  writeTable("characters", nextCharacters);
  database.flushAllSync();

  const grantResult = grantItemToCharacterLocation(
    TEST_CHARACTER_ID,
    structure.structureID,
    ITEM_FLAGS.HANGAR,
    22544,
    1,
    {
      itemName: "Hulk",
      singleton: 1,
    },
  );
  assert.equal(grantResult.success, true, "Expected fixture ship grant to succeed");
  const shipItem =
    grantResult.data &&
    Array.isArray(grantResult.data.items) &&
    grantResult.data.items[0]
      ? grantResult.data.items[0]
      : null;
  assert.ok(shipItem, "Expected fixture ship grant to create a ship item");

  const charactersWithShip = cloneValue(readTable("characters"));
  charactersWithShip[String(TEST_CHARACTER_ID)] = {
    ...charactersWithShip[String(TEST_CHARACTER_ID)],
    shipID: shipItem.itemID,
    shipTypeID: shipItem.typeID,
    shipName: shipItem.itemName || "Hulk",
  };
  writeTable("characters", charactersWithShip);
  database.flushAllSync();
}

test("character selection reports structure-docked characters through the stationID compatibility field", (t) => {
  const charactersBackup = cloneValue(readTable("characters"));
  const skillsBackup = cloneValue(readTable("skills"));
  const itemsBackup = cloneValue(readTable("items"));
  const identityStateBackup = cloneValue(readTable("identityState"));

  t.after(() => {
    writeTable("characters", charactersBackup);
    writeTable("skills", skillsBackup);
    writeTable("items", itemsBackup);
    writeTable("identityState", identityStateBackup);
    database.flushAllSync();
  });

  const structure = getSeededStructure();
  seedStructureDockedCharacter(structure);

  const charService = new CharService();
  const accountSession = {
    userid: TEST_ACCOUNT_ID,
    charid: 0,
    characterID: 0,
  };

  const selectionRow = getSelectionCharacterRow(
    charService,
    accountSession,
    TEST_CHARACTER_ID,
  );
  assert.ok(selectionRow, "Expected seeded character in selection payload");
  assert.equal(
    getKeyValEntry(selectionRow, "stationID"),
    structure.structureID,
    "Expected structureID to be exposed as stationID for character select",
  );
  assert.equal(
    getKeyValEntry(selectionRow, "solarSystemID"),
    structure.solarSystemID,
    "Expected character select to preserve the actual solar system",
  );

  const singleRow = charService.Handle_GetCharacterToSelect(
    [TEST_CHARACTER_ID],
    accountSession,
  );
  assert.equal(
    getKeyValEntry(singleRow, "stationID"),
    structure.structureID,
    "Expected single-character selection to use the same structure docked location",
  );
});
