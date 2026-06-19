const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const MachoNetService = require(path.join(
  repoRoot,
  "server/src/services/machoNet/machoNetService",
));
const StructureDeploymentService = require(path.join(
  repoRoot,
  "server/src/services/structure/structureDeploymentService",
));
const StructureProfilesService = require(path.join(
  repoRoot,
  "server/src/services/structure/structureProfilesService",
));
const structureState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureState",
));
const {
  getCorporationIDForSession,
  resetStructureProfilesStateForTests,
} = require(path.join(
  repoRoot,
  "server/src/services/structure/structureProfilesState",
));
const {
  ITEM_FLAGS,
  findItemById,
  grantItemToCharacterLocation,
  resetInventoryStoreForTests,
} = require(path.join(repoRoot, "server/src/services/inventory/itemStore"));

const TEST_CHARACTER_ID = 140000008;
const TEST_CORPORATION_ID = 98000002;
const TEST_ALLIANCE_ID = 99000001;
const ASTRAHUS_TYPE_ID = 35832;

function readTable(tableName) {
  const result = database.read(tableName, "/");
  assert.equal(result.success, true, `Failed to read ${tableName}`);
  return result.data;
}

function writeTable(tableName, payload) {
  const result = database.write(tableName, "/", payload);
  assert.equal(result.success, true, `Failed to write ${tableName}`);
}

function writeCleanStructuresTable(snapshot = {}) {
  writeTable("structures", {
    ...(snapshot || {}),
    _meta: {
      nextStructureID: 1030000000000,
      generatedAt: null,
      lastUpdatedAt: null,
      ...(snapshot && snapshot._meta ? snapshot._meta : {}),
    },
    structures: [],
  });
}

function buildSpaceSession(solarSystemID, shipID = 991004990) {
  const notifications = [];
  return {
    clientID: 65450,
    userid: 1,
    characterID: TEST_CHARACTER_ID,
    charid: TEST_CHARACTER_ID,
    corporationID: TEST_CORPORATION_ID,
    corpid: TEST_CORPORATION_ID,
    allianceID: TEST_ALLIANCE_ID,
    allianceid: TEST_ALLIANCE_ID,
    corprole: 2048n,
    shipID,
    shipid: shipID,
    activeShipID: shipID,
    solarsystemid2: solarSystemID,
    solarsystemid: solarSystemID,
    _space: {
      shipID,
      systemID: solarSystemID,
    },
    _notifications: notifications,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };
}

function keyValToObject(payload) {
  assert.equal(payload && payload.type, "object");
  assert.equal(payload && payload.name, "util.KeyVal");
  assert.equal(payload && payload.args && payload.args.type, "dict");
  return Object.fromEntries(payload.args.entries);
}

function dictToObject(payload) {
  assert.equal(payload && payload.type, "dict");
  return Object.fromEntries(payload.entries);
}

test("machoNet advertises structureProfiles for client routing", () => {
  const machoNet = new MachoNetService();
  const serviceInfo = new Map(machoNet.getServiceInfoDict().entries);

  assert.equal(serviceInfo.has("structureProfiles"), true);
  assert.equal(serviceInfo.get("structureProfiles"), null);
});

test("structureProfiles seeds a default profile and deployment falls back to it", (t) => {
  const structureProfilesBackup = readTable("structureProfiles");
  const structuresBackup = readTable("structures");
  const itemsBackup = readTable("items");
  t.after(() => {
    writeTable("structureProfiles", structureProfilesBackup);
    writeTable("structures", structuresBackup);
    writeTable("items", itemsBackup);
    resetStructureProfilesStateForTests();
    structureState.clearStructureCaches();
    resetInventoryStoreForTests();
  });

  writeTable("structureProfiles", {});
  writeCleanStructuresTable(structuresBackup);
  writeTable("items", itemsBackup);
  resetStructureProfilesStateForTests();
  structureState.clearStructureCaches();
  resetInventoryStoreForTests();

  const session = buildSpaceSession(30005261);
  const profileService = new StructureProfilesService();
  const deploymentService = new StructureDeploymentService();

  const profilesPayload = profileService.Handle_GetProfiles([], session);
  assert.equal(profilesPayload && profilesPayload.type, "list");
  assert.equal(Array.isArray(profilesPayload.items), true);
  assert.equal(profilesPayload.items.length, 1);

  const defaultProfile = keyValToObject(profilesPayload.items[0]);
  assert.equal(Number(defaultProfile.profileID), 1);
  assert.equal(defaultProfile.name, "Default Profile");
  assert.equal(defaultProfile.description, "");
  assert.equal(defaultProfile.isDefault, true);
  assert.equal(getCorporationIDForSession(session), TEST_CORPORATION_ID);

  const grantResult = grantItemToCharacterLocation(
    session.characterID,
    session._space.shipID,
    ITEM_FLAGS.CARGO_HOLD,
    { typeID: ASTRAHUS_TYPE_ID, name: "Astrahus Crate" },
    1,
    { singleton: 1 },
  );
  assert.equal(grantResult.success, true);
  const itemID = grantResult.data.items[0].itemID;
  assert.notEqual(findItemById(itemID), null);

  deploymentService.Handle_Anchor(
    [itemID, 2000, 4000, 0.5, 99999, "Profile Parity Astrahus", "", 5, 18, {}],
    session,
  );

  const structures = structureState.listOwnedStructures(TEST_CORPORATION_ID);
  assert.equal(structures.length, 1);
  assert.equal(structures[0].profileID, 1);
  assert.equal(findItemById(itemID), null, "Expected the deployed structure item to be consumed");
});

test("structureProfiles create, save, duplicate, assign, and delete profiles", (t) => {
  const structureProfilesBackup = readTable("structureProfiles");
  const structuresBackup = readTable("structures");
  t.after(() => {
    writeTable("structureProfiles", structureProfilesBackup);
    writeTable("structures", structuresBackup);
    resetStructureProfilesStateForTests();
    structureState.clearStructureCaches();
  });

  writeTable("structureProfiles", {});
  writeCleanStructuresTable(structuresBackup);
  resetStructureProfilesStateForTests();
  structureState.clearStructureCaches();

  const session = buildSpaceSession(30000142, 991004991);
  const service = new StructureProfilesService();

  const defaultProfiles = service.Handle_GetProfiles([], session);
  assert.equal(defaultProfiles.items.length, 1);
  const defaultProfileID = Number(keyValToObject(defaultProfiles.items[0]).profileID);

  const newProfileID = service.Handle_CreateProfile(
    ["Industry Tax", "Industry preset"],
    session,
  );
  assert.ok(Number(newProfileID) > defaultProfileID);

  service.Handle_UpdateProfile(
    [newProfileID, "Industry Tax Alpha", "Industry preset updated"],
    session,
  );
  service.Handle_SaveProfileSettings(
    [newProfileID, [
      [29, 4.5, 101],
      [34, 125, 102],
      [17, 1, 0],
    ]],
    session,
  );

  const settingsPayload = service.Handle_GetProfileSettings([newProfileID], session);
  const settingsMap = dictToObject(settingsPayload);
  assert.equal(Array.isArray(settingsMap[17].items), true);
  assert.equal(Array.isArray(settingsMap[29].items), true);
  assert.equal(Array.isArray(settingsMap[34].items), true);
  assert.deepEqual(
    keyValToObject(settingsMap[29].items[0]),
    { groupID: 101, value: 4.5 },
  );
  assert.deepEqual(
    keyValToObject(settingsMap[34].items[0]),
    { groupID: 102, value: 125 },
  );

  const createStructureResult = structureState.createStructure({
    typeID: ASTRAHUS_TYPE_ID,
    name: "Assignment Test Astrahus",
    itemName: "Assignment Test Astrahus",
    ownerCorpID: TEST_CORPORATION_ID,
    allianceID: TEST_ALLIANCE_ID,
    solarSystemID: 30000142,
    position: { x: 1000, y: 0, z: 2000 },
    rotation: [0, 0, 0],
    profileID: defaultProfileID,
    reinforceWeekday: 5,
    reinforceHour: 18,
  });
  assert.equal(createStructureResult.success, true);

  service.Handle_ChangeProfiles(
    [[createStructureResult.data.structureID], newProfileID],
    session,
  );
  const updatedStructure = structureState.getStructureByID(
    createStructureResult.data.structureID,
    { refresh: false },
  );
  assert.equal(updatedStructure.profileID, newProfileID);

  const duplicateProfileID = service.Handle_DuplicateProfile([newProfileID], session);
  assert.ok(Number(duplicateProfileID) > Number(newProfileID));

  service.Handle_SetDefaultProfile([duplicateProfileID], session);
  const profilesAfterDuplication = service.Handle_GetProfiles([], session);
  const resolvedProfiles = profilesAfterDuplication.items.map((entry) => keyValToObject(entry));
  const duplicateProfile = resolvedProfiles.find(
    (profile) => Number(profile.profileID) === Number(duplicateProfileID),
  );
  const originalProfile = resolvedProfiles.find(
    (profile) => Number(profile.profileID) === Number(newProfileID),
  );
  assert.equal(duplicateProfile.isDefault, true);
  assert.equal(originalProfile.isDefault, false);

  service.Handle_DeleteProfile([newProfileID], session);
  const profilesAfterDelete = service.Handle_GetProfiles([], session);
  const remainingProfileIDs = profilesAfterDelete.items.map(
    (entry) => Number(keyValToObject(entry).profileID),
  );
  assert.equal(remainingProfileIDs.includes(newProfileID), false);
  assert.equal(remainingProfileIDs.includes(duplicateProfileID), true);
});
