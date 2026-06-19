const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const CharService = require(path.join(
  repoRoot,
  "server/src/services/character/charService",
));
const DogmaService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dogmaService",
));
const {
  getActiveShipRecord,
  getCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  grantItemToCharacterLocation,
  resetInventoryStoreForTests,
  setActiveShipForCharacter,
  spawnShipInStationHangar,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  getAttributeIDByNames,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));
const {
  buildFittingSnapshot,
} = require(path.join(
  repoRoot,
  "server/src/_secondary/fitting/fittingSnapshotBuilder",
));
const {
  collectCharacterModifierAttributes,
} = require(path.join(
  repoRoot,
  "server/src/space/combat/weaponDogma",
));
const {
  resetFittingRuntimeForTests,
} = require(path.join(
  repoRoot,
  "server/src/_secondary/fitting/fittingRuntime",
));
const {
  resolveItemByName,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemTypeRegistry",
));

const DRAKE_TYPE_ID = 24698;
const ATTRIBUTE_MISSILE_DAMAGE_MULTIPLIER =
  getAttributeIDByNames("missileDamageMultiplier") || 212;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function snapshotMutableTables() {
  return {
    characters: cloneValue(database.read("characters", "/").data || {}),
    identityState: cloneValue(database.read("identityState", "/").data || {}),
    items: cloneValue(database.read("items", "/").data || {}),
    skills: cloneValue(database.read("skills", "/").data || {}),
  };
}

function restoreMutableTables(snapshot) {
  database.write("characters", "/", cloneValue(snapshot.characters));
  database.write("identityState", "/", cloneValue(snapshot.identityState));
  database.write("items", "/", cloneValue(snapshot.items));
  database.write("skills", "/", cloneValue(snapshot.skills));
  database.flushAllSync();
  resetInventoryStoreForTests();
  resetFittingRuntimeForTests();
}

function resolveTypeIDByName(name) {
  const result = resolveItemByName(name);
  assert.equal(result && result.success, true, `Expected to resolve type ${name}`);
  return Number(result.match && result.match.typeID) || 0;
}

function createCharacter(userID, name) {
  const service = new CharService();
  const characterID = service.Handle_CreateCharacterWithDoll(
    [name, 5, 1, 1, null, null, 11],
    { userid: userID },
  );
  const characterRecord = getCharacterRecord(characterID);
  assert.ok(characterRecord, "Expected created character record");
  return {
    characterID,
    stationID: Number(characterRecord.stationID || characterRecord.stationid || 0),
  };
}

function buildDockedSession(characterID, stationID, shipID) {
  return {
    userid: characterID + 970000,
    clientID: characterID + 980000,
    characterID,
    charid: characterID,
    stationid: stationID,
    stationID: stationID,
    locationid: stationID,
    shipID,
    shipid: shipID,
    activeShipID: shipID,
    socket: { destroyed: false },
    sendNotification() {},
  };
}

function getDictEntries(value) {
  if (
    value &&
    typeof value === "object" &&
    value.type === "dict" &&
    Array.isArray(value.entries)
  ) {
    return value.entries;
  }
  if (
    value &&
    typeof value === "object" &&
    value.args &&
    value.args.type === "dict" &&
    Array.isArray(value.args.entries)
  ) {
    return value.args.entries;
  }
  return [];
}

function getKeyValEntry(value, key) {
  const entry = getDictEntries(value).find(
    (candidate) => Array.isArray(candidate) && candidate[0] === key,
  );
  return entry ? entry[1] : null;
}

function getAttributeValueFromCommonEntry(entry, attributeID) {
  const attributes = getKeyValEntry(entry, "attributes");
  const attributeEntry = getDictEntries(attributes).find(
    (candidate) => Array.isArray(candidate) && Number(candidate[0]) === Number(attributeID),
  );
  return Number(attributeEntry && attributeEntry[1]) || 0;
}

test("docked GetAllInfo reuses shared fitting owner missile modifiers", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();
  resetFittingRuntimeForTests();

  const { characterID, stationID } = createCharacter(980451, "OwnerAttrSnapshotTest");
  const shipResult = spawnShipInStationHangar(characterID, stationID, DRAKE_TYPE_ID);
  assert.equal(shipResult.success, true, "Expected Drake spawn to succeed");
  const ship = shipResult.data;

  const activateShipResult = setActiveShipForCharacter(characterID, ship.itemID);
  assert.equal(activateShipResult.success, true, "Expected active ship swap to succeed");

  const ballisticControlTypeID = resolveTypeIDByName("Ballistic Control System II");
  const fitResult = grantItemToCharacterLocation(
    characterID,
    ship.itemID,
    11,
    ballisticControlTypeID,
    1,
    {
      singleton: true,
      moduleState: {
        online: true,
        damage: 0,
        charge: 0,
        armorDamage: 0,
        shieldCharge: 1,
        incapacitated: false,
      },
    },
  );
  assert.equal(fitResult.success, true, "Expected Ballistic Control System II direct fit");

  const fittingSnapshot = buildFittingSnapshot(characterID, ship.itemID, {
    shipItem: getActiveShipRecord(characterID),
  });
  assert.ok(fittingSnapshot, "Expected fitting snapshot for owner attr parity");

  const expectedOwnerAttributes = collectCharacterModifierAttributes(
    fittingSnapshot.skillMap,
    fittingSnapshot.fittedItems,
    fittingSnapshot.assumedActiveModuleContexts,
  );
  const dogma = new DogmaService();
  const session = buildDockedSession(characterID, stationID, ship.itemID);
  const allInfo = dogma.Handle_GetAllInfo([false, true, null], session);
  const shipModifiedCharAttribs = getKeyValEntry(allInfo, "shipModifiedCharAttribs");
  assert.ok(shipModifiedCharAttribs, "Expected GetAllInfo ship-modified character attrs");

  const missileDamageMultiplier = getAttributeValueFromCommonEntry(
    shipModifiedCharAttribs,
    ATTRIBUTE_MISSILE_DAMAGE_MULTIPLIER,
  );
  assert.equal(
    missileDamageMultiplier,
    Number(expectedOwnerAttributes[ATTRIBUTE_MISSILE_DAMAGE_MULTIPLIER]) || 0,
    "Expected shipModifiedCharAttribs missile damage multiplier to reuse the shared fitting owner snapshot",
  );
  assert.ok(
    missileDamageMultiplier > 1,
    "Expected fitted Ballistic Control System II to increase owner missile damage multiplier",
  );
});
