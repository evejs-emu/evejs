const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const structureState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureState",
));
const {
  persistCharacterLogoffState,
} = require(path.join(
  repoRoot,
  "server/src/services/_shared/sessionDisconnect",
));
const {
  STRUCTURE_STATE,
  STRUCTURE_UPKEEP_STATE,
} = require(path.join(
  repoRoot,
  "server/src/services/structure/structureConstants",
));

const TEST_SYSTEM_ID = 30000142;

function readTable(tableName) {
  const result = database.read(tableName, "/");
  assert.equal(result.success, true, `Failed to read ${tableName}`);
  return result.data;
}

function writeTable(tableName, payload) {
  const result = database.write(tableName, "/", payload);
  assert.equal(result.success, true, `Failed to write ${tableName}`);
}

test("persistCharacterLogoffState preserves structure dock state instead of rewriting it as a station", (t) => {
  const structuresBackup = readTable("structures");
  const charactersBackup = readTable("characters");
  const itemsBackup = readTable("items");
  t.after(() => {
    writeTable("structures", structuresBackup);
    writeTable("characters", charactersBackup);
    writeTable("items", itemsBackup);
    structureState.clearStructureCaches();
  });

  const createResult = structureState.createStructure({
    typeID: 35832,
    name: "Disconnect Persistence Test Astrahus",
    itemName: "Disconnect Persistence Test Astrahus",
    ownerCorpID: 1000009,
    solarSystemID: TEST_SYSTEM_ID,
    position: { x: -107303242560, y: -18744975360, z: 436489052160 },
    state: STRUCTURE_STATE.SHIELD_VULNERABLE,
    upkeepState: STRUCTURE_UPKEEP_STATE.FULL_POWER,
    accessProfile: {
      docking: "public",
      tethering: "public",
    },
    serviceStates: {
      "1": 1,
    },
  });
  assert.equal(createResult.success, true, "Expected structure creation to succeed");
  const structureID = Number(createResult.data.structureID);

  const characterID = 199992001;
  const shipID = 199992101;
  writeTable("characters", {
    ...(charactersBackup || {}),
    [String(characterID)]: {
      characterName: "Disconnect Persistence Pilot",
      corporationID: 1000009,
      solarSystemID: TEST_SYSTEM_ID,
      constellationID: 20000020,
      regionID: 10000002,
      stationID: null,
      structureID: null,
      shipID,
      shipTypeID: 606,
      shipName: "Velator",
    },
  });
  writeTable("items", {
    ...(itemsBackup || {}),
    [String(shipID)]: {
      itemID: shipID,
      typeID: 606,
      ownerID: characterID,
      locationID: structureID,
      flagID: 4,
      quantity: -1,
      stacksize: 1,
      singleton: 1,
      groupID: 237,
      categoryID: 6,
      customInfo: "",
      itemName: "Velator",
      mass: 1148000,
      volume: 24500,
      capacity: 135,
      radius: 40,
      spaceState: null,
      conditionState: {
        damage: 0,
        charge: 1,
        armorDamage: 0,
        shieldCharge: 1,
        incapacitated: false,
      },
    },
  });

  const persistResult = persistCharacterLogoffState({
    characterID,
    charid: characterID,
    shipID,
    shipid: shipID,
    solarsystemid: TEST_SYSTEM_ID,
    solarsystemid2: TEST_SYSTEM_ID,
  });
  assert.equal(persistResult.success, true, "Expected logoff persistence to succeed");

  const characterResult = database.read("characters", `/${characterID}`);
  assert.equal(characterResult.success, true, "Expected persisted character row to be readable");
  assert.equal(characterResult.data.stationID, null, "Expected structure-docked persistence not to invent a station ID");
  assert.equal(characterResult.data.structureID, structureID, "Expected structure-docked persistence to keep the structure ID");
  assert.equal(characterResult.data.solarSystemID, TEST_SYSTEM_ID, "Expected structure-docked persistence to keep the structure system");
});
