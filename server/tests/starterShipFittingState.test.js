const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const CharService = require(path.join(
  repoRoot,
  "server/src/services/character/charService",
));
const CharacterState = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const DogmaService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dogmaService",
));
const {
  spawnRookieShipForCharacter,
} = require(path.join(repoRoot, "server/src/services/ship/rookieShipRuntime"));
const {
  ITEM_FLAGS,
  ensureCapsuleForCharacter,
  getActiveShipItem,
  moveItemToLocation,
  setActiveShipForCharacter,
} = require(path.join(repoRoot, "server/src/services/inventory/itemStore"));
const {
  getCharacterRecord,
  getActiveShipRecord,
} = CharacterState;
const {
  getFittedModuleItems,
} = require(path.join(repoRoot, "server/src/services/fitting/liveFittingState"));

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

test("spawnShipInHangarForSession leaves rookie hulls unfitted so rookieShipRuntime stays the single source of truth", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalIdentityState = cloneValue(database.read("identityState", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  const originalSkills = cloneValue(database.read("skills", "/").data);
  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.write("identityState", "/", originalIdentityState);
    database.write("items", "/", originalItems);
    database.write("skills", "/", originalSkills);
    database.flushAllSync();
  });

  const service = new CharService();
  const charId = service.Handle_CreateCharacterWithDoll(
    ["Starter Spawn Test", 5, 1, 1, null, null, 11],
    { userid: 900002 },
  );
  const session = {
    userid: 900002,
    clientID: 9900002,
    characterID: charId,
    characterName: "Starter Spawn Test",
    stationid: 60003760,
    stationID: 60003760,
    structureid: null,
    structureID: null,
    sendNotification() {},
  };

  const spawnResult = CharacterState.spawnShipInHangarForSession(session, 588);
  assert.equal(spawnResult.success, true);
  assert.ok(spawnResult.ship, "expected spawned corvette");
  assert.equal(
    getFittedModuleItems(charId, spawnResult.ship.itemID).length,
    0,
    "generic hangar spawns should stay generic; rookie fitting belongs to rookieShipRuntime",
  );
});

test("spawnRookieShipForCharacter provisions and fits a configured rookie ship from one shared path", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalIdentityState = cloneValue(database.read("identityState", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  const originalSkills = cloneValue(database.read("skills", "/").data);
  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.write("identityState", "/", originalIdentityState);
    database.write("items", "/", originalItems);
    database.write("skills", "/", originalSkills);
    database.flushAllSync();
  });

  const service = new CharService();
  const charId = service.Handle_CreateCharacterWithDoll(
    ["Starter Runtime Test", 5, 1, 1, null, null, 11],
    { userid: 900004 },
  );
  const characterRecord = getCharacterRecord(charId);
  const starterShip = getActiveShipRecord(charId);
  assert.ok(characterRecord);
  assert.ok(starterShip);

  const destroyStarterItems = Object.values(database.read("items", "/").data)
    .filter((item) => Number(item.locationID || 0) === Number(starterShip.itemID))
    .map((item) => String(item.itemID));
  for (const itemID of destroyStarterItems) {
    database.remove("items", `/${itemID}`);
  }
  database.remove("items", `/${String(starterShip.itemID)}`);

  const spawnResult = spawnRookieShipForCharacter(
    charId,
    characterRecord.stationID,
    {
      characterRecord,
      setActiveShip: true,
      logLabel: "StarterShipRuntimeTest",
    },
  );
  assert.equal(spawnResult.success, true);
  assert.ok(spawnResult.data && spawnResult.data.ship, "expected rookie ship");

  const fittedModuleNames = new Set(
    getFittedModuleItems(charId, spawnResult.data.ship.itemID)
      .map((item) => item && item.itemName)
      .filter(Boolean),
  );
  assert.deepEqual(
    fittedModuleNames,
    new Set([
      "1MN Civilian Afterburner",
      "Civilian Gatling Pulse Laser",
      "Civilian Miner",
    ]),
  );
});

test("boardNewbieShipForSession restores the default rookie fit on an existing corvette", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalIdentityState = cloneValue(database.read("identityState", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  const originalSkills = cloneValue(database.read("skills", "/").data);
  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.write("identityState", "/", originalIdentityState);
    database.write("items", "/", originalItems);
    database.write("skills", "/", originalSkills);
    database.flushAllSync();
  });

  const service = new CharService();
  const charId = service.Handle_CreateCharacterWithDoll(
    ["Starter Board Test", 5, 1, 1, null, null, 11],
    { userid: 900003 },
  );
  const characterRecord = getCharacterRecord(charId);
  const starterShip = getActiveShipRecord(charId);
  assert.ok(characterRecord);
  assert.ok(starterShip);

  const destroyStarterItems = Object.values(database.read("items", "/").data)
    .filter((item) => Number(item.locationID || 0) === Number(starterShip.itemID))
    .map((item) => String(item.itemID));
  for (const itemID of destroyStarterItems) {
    database.remove("items", `/${itemID}`);
  }

  const capsuleResult = ensureCapsuleForCharacter(charId, characterRecord.stationID);
  assert.equal(capsuleResult.success, true);
  const capsule = capsuleResult.data;
  const setActiveResult = setActiveShipForCharacter(charId, capsule.itemID);
  assert.equal(setActiveResult.success, true);

  const session = {
    userid: 900003,
    clientID: 9900003,
    characterID: charId,
    characterName: "Starter Board Test",
    stationid: characterRecord.stationID,
    stationID: characterRecord.stationID,
    structureid: null,
    structureID: null,
    sendNotification() {},
  };

  const boardResult = DogmaService.boardNewbieShipForSession(session, {
    emitNotifications: false,
    logSelection: false,
    repairExistingShip: true,
    logLabel: "StarterShipFitTest",
  });
  assert.equal(boardResult.success, true);
  const boardedShip = boardResult.data && boardResult.data.ship;
  assert.ok(boardedShip, "expected boarded corvette");

  const fittedModuleNames = new Set(
    getFittedModuleItems(charId, boardedShip.itemID)
      .map((item) => item && item.itemName)
      .filter(Boolean),
  );
  assert.deepEqual(
    fittedModuleNames,
    new Set([
      "1MN Civilian Afterburner",
      "Civilian Gatling Pulse Laser",
      "Civilian Miner",
    ]),
  );
});

test("getActiveShipItem stays read-only after a rookie module is manually unfitted", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalIdentityState = cloneValue(database.read("identityState", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  const originalSkills = cloneValue(database.read("skills", "/").data);
  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.write("identityState", "/", originalIdentityState);
    database.write("items", "/", originalItems);
    database.write("skills", "/", originalSkills);
    database.flushAllSync();
  });

  const service = new CharService();
  const charId = service.Handle_CreateCharacterWithDoll(
    ["Starter Lookup Test", 5, 1, 1, null, null, 11],
    { userid: 900005 },
  );
  const characterRecord = getCharacterRecord(charId);
  const starterShip = getActiveShipRecord(charId);
  assert.ok(characterRecord);
  assert.ok(starterShip);

  const fittedItems = getFittedModuleItems(charId, starterShip.itemID);
  const civilianGun = fittedItems.find((item) => Number(item && item.typeID) === 3634);
  assert.ok(civilianGun, "expected a fitted civilian gun on the rookie ship");

  const unfitResult = moveItemToLocation(
    civilianGun.itemID,
    characterRecord.stationID,
    ITEM_FLAGS.HANGAR,
  );
  assert.equal(unfitResult.success, true);

  const beforeLookupItemIDs = new Set(Object.keys(database.read("items", "/").data));
  const lookedUpShip = getActiveShipItem(charId);
  assert.ok(lookedUpShip, "expected active ship lookup to still return the ship");
  assert.equal(lookedUpShip.itemID, starterShip.itemID);

  const afterLookupItems = database.read("items", "/").data;
  const newItemIDs = Object.keys(afterLookupItems).filter(
    (itemID) => !beforeLookupItemIDs.has(itemID),
  );
  assert.deepEqual(
    newItemIDs,
    [],
    "active ship lookup should not mint fresh starter modules",
  );

  const fittedTypeIDsAfterLookup = new Set(
    getFittedModuleItems(charId, starterShip.itemID)
      .map((item) => Number(item && item.typeID) || 0)
      .filter((typeID) => typeID > 0),
  );
  assert.equal(
    fittedTypeIDsAfterLookup.has(3634),
    false,
    "lookup should not silently refit the civilian gun",
  );

  const hangarGuns = Object.values(afterLookupItems).filter(
    (item) =>
      Number(item && item.ownerID) === charId &&
      Number(item && item.locationID) === characterRecord.stationID &&
      Number(item && item.flagID) === ITEM_FLAGS.HANGAR &&
      Number(item && item.typeID) === 3634,
  );
  assert.equal(hangarGuns.length, 1, "expected exactly one unfitted civilian gun in hangar");
  assert.equal(Number(hangarGuns[0].itemID), civilianGun.itemID);

  const refitResult = moveItemToLocation(
    civilianGun.itemID,
    starterShip.itemID,
    civilianGun.flagID,
  );
  assert.equal(refitResult.success, true);

  const refittedGun = getFittedModuleItems(charId, starterShip.itemID).find(
    (item) => Number(item && item.itemID) === Number(civilianGun.itemID),
  );
  assert.ok(refittedGun, "expected the original civilian gun to be refittable");
});
