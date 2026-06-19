const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const JumpCloneService = require(path.join(
  repoRoot,
  "server/src/services/station/jumpCloneService",
));
const jumpCloneRuntime = require(path.join(
  repoRoot,
  "server/src/services/station/jumpCloneRuntime",
));
const DogmaService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dogmaService",
));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));
const {
  getCharacterRecord,
} = require(path.join(repoRoot, "server/src/services/character/characterState"));
const {
  getCharacterWallet,
} = require(path.join(repoRoot, "server/src/services/account/walletState"));
const {
  grantCharacterSkillLevels,
  replaceCharacterSkillRecords,
} = require(path.join(repoRoot, "server/src/services/skills/skillState"));
const {
  CAPSULE_TYPE_ID,
  findItemById,
  grantItemToCharacterLocation,
  moveShipToSpace,
  resetInventoryStoreForTests,
  setActiveShipForCharacter,
  spawnShipInStationHangar,
} = require(path.join(repoRoot, "server/src/services/inventory/itemStore"));
const {
  ATTRIBUTE_MAX_JUMP_CLONES,
  ATTRIBUTE_CLONE_JUMP_COOLDOWN,
  TYPE_INFOMORPH_PSYCHOLOGY,
  TYPE_INFOMORPH_SYNCHRONIZING,
  TYPE_CLONE_VAT_BAY_I,
  JUMP_CLONE_INSTALL_COST,
  REF_JUMP_CLONE_INSTALLATION_FEE,
  NOTIFICATION_TYPE_JUMP_CLONE_DELETED_1,
} = require(path.join(repoRoot, "server/src/services/station/jumpCloneRules"));

const TEST_CHARACTER_ID = 980777001;
const TARGET_CHARACTER_ID = 980777002;
const TEST_STATION_ID = 60003760;
const TEST_SYSTEM_ID = 30000142;
const RORQUAL_TYPE_ID = 28352;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function readTable(tableName) {
  const result = database.read(tableName, "/");
  assert.equal(result.success, true, `failed to read ${tableName}`);
  return cloneValue(result.data || {});
}

function writeTable(tableName, payload) {
  const result = database.write(tableName, "/", cloneValue(payload));
  assert.equal(result.success, true, `failed to write ${tableName}`);
}

function snapshotMutableTables() {
  return {
    characters: readTable("characters"),
    skills: readTable("skills"),
    notifications: readTable("notifications"),
    items: readTable("items"),
    identityState: readTable("identityState"),
    corporationRuntime: readTable("corporationRuntime"),
    npcEntities: readTable("npcEntities"),
    npcModules: readTable("npcModules"),
    npcCargo: readTable("npcCargo"),
    npcRuntimeControllers: readTable("npcRuntimeControllers"),
    wormholeRuntimeState: readTable("wormholeRuntimeState"),
  };
}

function restoreMutableTables(snapshot) {
  writeTable("characters", snapshot.characters);
  writeTable("skills", snapshot.skills);
  writeTable("notifications", snapshot.notifications);
  writeTable("items", snapshot.items);
  writeTable("identityState", snapshot.identityState);
  writeTable("corporationRuntime", snapshot.corporationRuntime);
  writeTable("npcEntities", snapshot.npcEntities);
  writeTable("npcModules", snapshot.npcModules);
  writeTable("npcCargo", snapshot.npcCargo);
  writeTable("npcRuntimeControllers", snapshot.npcRuntimeControllers);
  writeTable("wormholeRuntimeState", snapshot.wormholeRuntimeState);
  database.flushAllSync();
  resetInventoryStoreForTests();
  spaceRuntime._testing.clearScenes();
}

function seedCharacter(overrides = {}) {
  const characters = readTable("characters");
  characters[String(TEST_CHARACTER_ID)] = {
    characterID: TEST_CHARACTER_ID,
    charID: TEST_CHARACTER_ID,
    userID: 980777,
    characterName: "Jump Clone Tester",
    corporationID: 1000035,
    raceID: 1,
    bloodlineID: 1,
    gender: 1,
    stationID: TEST_STATION_ID,
    structureID: null,
    solarSystemID: TEST_SYSTEM_ID,
    constellationID: 20000020,
    regionID: 10000002,
    homeStationID: TEST_STATION_ID,
    cloneStationID: TEST_STATION_ID,
    balance: 5000000,
    implants: [],
    jumpClones: [],
    timeLastCloneJump: "0",
    ...overrides,
  };
  writeTable("characters", characters);
  replaceCharacterSkillRecords(TEST_CHARACTER_ID, []);
}

function seedTargetCharacter(overrides = {}) {
  const characters = readTable("characters");
  characters[String(TARGET_CHARACTER_ID)] = {
    characterID: TARGET_CHARACTER_ID,
    charID: TARGET_CHARACTER_ID,
    userID: 980778,
    characterName: "Clone Invite Target",
    corporationID: 1000035,
    raceID: 1,
    bloodlineID: 1,
    gender: 1,
    stationID: TEST_STATION_ID,
    structureID: null,
    solarSystemID: TEST_SYSTEM_ID,
    constellationID: 20000020,
    regionID: 10000002,
    homeStationID: TEST_STATION_ID,
    cloneStationID: TEST_STATION_ID,
    balance: 5000000,
    implants: [],
    jumpClones: [],
    timeLastCloneJump: "0",
    ...overrides,
  };
  writeTable("characters", characters);
  replaceCharacterSkillRecords(TARGET_CHARACTER_ID, []);
}

function grantCloneSkills(limitLevel = 3, cooldownLevel = 4) {
  grantCharacterSkillLevels(TEST_CHARACTER_ID, [
    { typeID: TYPE_INFOMORPH_PSYCHOLOGY, level: limitLevel },
    { typeID: TYPE_INFOMORPH_SYNCHRONIZING, level: cooldownLevel },
  ]);
}

function buildSession(overrides = {}) {
  const notifications = [];
  return {
    clientID: 980777,
    userid: 980777,
    characterID: TEST_CHARACTER_ID,
    charid: TEST_CHARACTER_ID,
    corporationID: 1000035,
    corpid: 1000035,
    stationid: TEST_STATION_ID,
    stationID: TEST_STATION_ID,
    stationid2: TEST_STATION_ID,
    structureid: null,
    structureID: null,
    solarsystemid: null,
    solarsystemid2: TEST_SYSTEM_ID,
    locationid: TEST_STATION_ID,
    socket: { destroyed: false },
    _notifications: notifications,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendSessionChange(changes) {
      notifications.push({ name: "SessionChange", idType: "session", payload: changes });
    },
    ...overrides,
  };
}

function keyValEntries(object) {
  return Object.fromEntries(object.args.entries);
}

function rowsetLines(rowset) {
  const entries = Object.fromEntries(rowset.args.entries);
  return entries.lines.items;
}

function rowsetHeader(rowset) {
  const entries = Object.fromEntries(rowset.args.entries);
  return entries.header.items;
}

function rowsetClassName(rowset) {
  return rowset && rowset.name;
}

function withSnapshots(fn) {
  return () => {
    const snapshot = snapshotMutableTables();
    try {
      fn();
    } finally {
      restoreMutableTables(snapshot);
    }
  };
}

test("jumpCloneSvc GetCloneState returns client parity clone and implant rowsets", withSnapshots(() => {
  seedCharacter({
    implants: [{ typeID: 10208, slot: 1 }],
    jumpClones: [
      {
        cloneID: 710000001,
        stationID: TEST_STATION_ID,
        name: "Old shape clone",
        implants: [{ typeID: 10209, slot: 2 }],
      },
      {
        jumpCloneID: 710000002,
        locationID: 299990001,
        locationKind: "ship",
        ownerID: TEST_CHARACTER_ID,
        cloneName: "Ship clone",
      },
    ],
  });
  const service = new JumpCloneService();
  const session = buildSession();

  const payload = service.Handle_GetCloneState([], session);
  const entries = keyValEntries(payload);

  assert.equal(rowsetClassName(entries.clones), "eve.common.script.sys.rowset.Rowset");
  assert.equal(rowsetClassName(entries.implants), "eve.common.script.sys.rowset.Rowset");
  assert.deepEqual(rowsetHeader(entries.clones), [
    "jumpCloneID",
    "locationID",
    "cloneName",
  ]);
  assert.deepEqual(rowsetLines(entries.clones), [
    [710000001, TEST_STATION_ID, "Old shape clone"],
    [710000002, 299990001, "Ship clone"],
  ]);
  assert.deepEqual(rowsetHeader(entries.implants), ["jumpCloneID", "typeID"]);
  assert.deepEqual(rowsetLines(entries.implants), [[710000001, 10209]]);

  const stationPayload = service.Handle_GetStationCloneState([], session);
  assert.equal(rowsetClassName(stationPayload), "eve.common.script.sys.rowset.Rowset");
  const stationRows = rowsetLines(stationPayload);
  assert.deepEqual(stationRows, [[710000001, TEST_STATION_ID, "Old shape clone"]]);

  const shipPayload = service.Handle_GetShipCloneState([], session);
  assert.equal(rowsetClassName(shipPayload), "eve.common.script.sys.rowset.Rowset");
  assert.deepEqual(rowsetLines(shipPayload), [[710000002, TEST_CHARACTER_ID, 299990001]]);
}));

test("jump clone install debits CCP ref 55 and dogma exposes capacity/cooldown", withSnapshots(() => {
  seedCharacter({ balance: 2000000 });
  grantCloneSkills(2, 4);
  const service = new JumpCloneService();
  const session = buildSession();

  assert.deepEqual(service.Handle_ValidateInstallJumpClone([], session), []);
  assert.deepEqual(
    service.Handle_MachoBindObject([TEST_STATION_ID, ["ValidateInstallJumpClone", [], {}]], session)[1],
    [],
  );
  service.Handle_InstallCloneInStation([], session);

  const record = getCharacterRecord(TEST_CHARACTER_ID);
  assert.equal(record.jumpClones.length, 1);
  assert.equal(record.jumpClones[0].locationID, TEST_STATION_ID);
  assert.equal(getCharacterWallet(TEST_CHARACTER_ID).balance, 2000000 - JUMP_CLONE_INSTALL_COST);
  assert.equal(record.walletJournal[0].entryTypeID, REF_JUMP_CLONE_INSTALLATION_FEE);
  assert.equal(
    session._notifications.some((entry) => entry.name === "OnJumpCloneCacheInvalidated"),
    true,
  );

  const dogma = new DogmaService();
  const attributes = dogma._buildCharacterAttributes(record, TEST_CHARACTER_ID);
  assert.equal(attributes[ATTRIBUTE_MAX_JUMP_CLONES], 2);
  assert.equal(attributes[ATTRIBUTE_CLONE_JUMP_COOLDOWN], 20);
}));

test("same-station clone jump swaps active implants into the old body", withSnapshots(() => {
  seedCharacter({
    balance: 5000000,
    implants: [{ typeID: 10208, slot: 1 }],
    jumpClones: [
      {
        jumpCloneID: 720000001,
        locationID: TEST_STATION_ID,
        cloneName: "Clean clone",
        implants: [{ typeID: 10209, slot: 2 }],
      },
    ],
  });
  grantCloneSkills(3, 5);
  const service = new JumpCloneService();
  const session = buildSession();

  service.Handle_CloneJump([TEST_STATION_ID, 720000001, 0, true], session);

  const record = getCharacterRecord(TEST_CHARACTER_ID);
  assert.deepEqual(record.implants.map((implant) => implant.typeID), [10209]);
  assert.equal(record.jumpClones.length, 1);
  assert.equal(record.jumpClones[0].jumpCloneID, 720000001);
  assert.deepEqual(
    record.jumpClones[0].implants.map((implant) => implant.typeID),
    [10208],
  );
  assert.notEqual(record.timeLastCloneJump, "0");
}));

test("ship clone installation offer requires online clone vat bay and operational range", withSnapshots(() => {
  seedCharacter({ balance: 5000000 });
  seedTargetCharacter({ balance: 5000000 });
  grantCloneSkills(3, 5);
  grantCharacterSkillLevels(TARGET_CHARACTER_ID, [
    { typeID: TYPE_INFOMORPH_PSYCHOLOGY, level: 2 },
  ]);

  const cloneVatShipResult = spawnShipInStationHangar(
    TEST_CHARACTER_ID,
    TEST_STATION_ID,
    {
      typeID: RORQUAL_TYPE_ID,
      name: "Invitation Rorqual",
    },
  );
  assert.equal(cloneVatShipResult.success, true);
  const cloneVatShip = cloneVatShipResult.data;
  assert.equal(
    setActiveShipForCharacter(TEST_CHARACTER_ID, cloneVatShip.itemID).success,
    true,
  );
  assert.equal(
    grantItemToCharacterLocation(
      TEST_CHARACTER_ID,
      cloneVatShip.itemID,
      27,
      TYPE_CLONE_VAT_BAY_I,
      1,
    ).success,
    true,
  );
  assert.equal(moveShipToSpace(cloneVatShip.itemID, TEST_SYSTEM_ID, {
    position: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    speedFraction: 0,
    mode: "STOP",
    targetPoint: { x: 0, y: 0, z: 0 },
  }).success, true);

  const targetCapsuleResult = spawnShipInStationHangar(
    TARGET_CHARACTER_ID,
    TEST_STATION_ID,
    {
      typeID: CAPSULE_TYPE_ID,
      name: "Target Capsule",
    },
  );
  assert.equal(targetCapsuleResult.success, true);
  assert.equal(
    setActiveShipForCharacter(TARGET_CHARACTER_ID, targetCapsuleResult.data.itemID).success,
    true,
  );
  assert.equal(moveShipToSpace(targetCapsuleResult.data.itemID, TEST_SYSTEM_ID, {
    position: { x: 3000, y: 0, z: 0 },
    direction: { x: -1, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    speedFraction: 0,
    mode: "STOP",
    targetPoint: { x: 3000, y: 0, z: 0 },
  }).success, true);

  const service = new JumpCloneService();
  const offeringSession = buildSession({
    stationid: null,
    stationID: null,
    stationid2: null,
    solarsystemid: TEST_SYSTEM_ID,
    solarsystemid2: TEST_SYSTEM_ID,
    locationid: TEST_SYSTEM_ID,
    shipid: cloneVatShip.itemID,
    shipID: cloneVatShip.itemID,
  });
  const targetSession = buildSession({
    clientID: 980778,
    userid: 980778,
    characterID: TARGET_CHARACTER_ID,
    charid: TARGET_CHARACTER_ID,
    stationid: null,
    stationID: null,
    stationid2: null,
    solarsystemid: TEST_SYSTEM_ID,
    solarsystemid2: TEST_SYSTEM_ID,
    locationid: TEST_SYSTEM_ID,
    shipid: targetCapsuleResult.data.itemID,
    shipID: targetCapsuleResult.data.itemID,
  });

  try {
    sessionRegistry.register(offeringSession);
    sessionRegistry.register(targetSession);
    service.Handle_OfferShipCloneInstallation([TARGET_CHARACTER_ID], offeringSession);
    assert.equal(
      targetSession._notifications.some((entry) => (
        entry && entry.name === "OnShipJumpCloneInstallationOffered"
      )),
      true,
    );

    service.Handle_AcceptShipCloneInstallation([], targetSession);
  } finally {
    sessionRegistry.unregister(offeringSession);
    sessionRegistry.unregister(targetSession);
  }

  const targetRecord = getCharacterRecord(TARGET_CHARACTER_ID);
  assert.equal(targetRecord.jumpClones.length, 1);
  assert.equal(targetRecord.jumpClones[0].locationKind, "ship");
  assert.equal(targetRecord.jumpClones[0].locationID, cloneVatShip.itemID);
  assert.equal(getCharacterWallet(TARGET_CHARACTER_ID).balance, 4100000);
}));

test("ship clone jump attaches the active capsule into space near the clone-vat ship", withSnapshots(() => {
  seedCharacter({
    balance: 5000000,
    implants: [{ typeID: 10208, slot: 1 }],
  });
  grantCloneSkills(3, 5);

  const targetShipResult = spawnShipInStationHangar(
    TEST_CHARACTER_ID,
    TEST_STATION_ID,
    {
      typeID: RORQUAL_TYPE_ID,
      name: "Clone Vat Rorqual",
    },
  );
  assert.equal(targetShipResult.success, true);
  const targetShip = targetShipResult.data;
  const targetMoveResult = moveShipToSpace(targetShip.itemID, TEST_SYSTEM_ID, {
    position: { x: 100000, y: 2000, z: -5000 },
    direction: { x: 1, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    speedFraction: 0,
    mode: "STOP",
    targetPoint: { x: 100000, y: 2000, z: -5000 },
  });
  assert.equal(targetMoveResult.success, true);

  const capsuleResult = spawnShipInStationHangar(
    TEST_CHARACTER_ID,
    TEST_STATION_ID,
    {
      typeID: CAPSULE_TYPE_ID,
      name: "Capsule",
    },
  );
  assert.equal(capsuleResult.success, true);
  assert.equal(
    setActiveShipForCharacter(TEST_CHARACTER_ID, capsuleResult.data.itemID).success,
    true,
  );

  const characters = readTable("characters");
  characters[String(TEST_CHARACTER_ID)].jumpClones = [
    {
      jumpCloneID: 730000001,
      locationID: targetShip.itemID,
      locationKind: "ship",
      cloneName: "Vat body",
      ownerID: TEST_CHARACTER_ID,
      implants: [{ typeID: 10209, slot: 2 }],
    },
  ];
  writeTable("characters", characters);

  const service = new JumpCloneService();
  const session = buildSession({
    shipid: capsuleResult.data.itemID,
    shipID: capsuleResult.data.itemID,
    activeShipID: capsuleResult.data.itemID,
    shipTypeID: CAPSULE_TYPE_ID,
  });

  service.Handle_CloneJump([targetShip.itemID, 730000001, 0, true], session);

  const record = getCharacterRecord(TEST_CHARACTER_ID);
  assert.equal(record.stationID, null);
  assert.equal(record.structureID, null);
  assert.equal(record.solarSystemID, TEST_SYSTEM_ID);
  assert.deepEqual(record.implants.map((implant) => implant.typeID), [10209]);
  assert.equal(record.jumpClones.length, 1);
  assert.equal(record.jumpClones[0].locationID, TEST_STATION_ID);
  assert.deepEqual(
    record.jumpClones[0].implants.map((implant) => implant.typeID),
    [10208],
  );

  const capsule = findItemById(capsuleResult.data.itemID);
  assert.equal(capsule.locationID, TEST_SYSTEM_ID);
  assert.equal(capsule.flagID, 0);
  assert.equal(capsule.spaceState.systemID, TEST_SYSTEM_ID);
  assert.ok(session._space, "expected session to be attached to space");
  assert.equal(session.shipid, capsuleResult.data.itemID);
}));

test("pod death clears active implants and creates jump-clone destruction notification", withSnapshots(() => {
  seedCharacter({
    implants: [
      { typeID: 10208, slot: 1 },
      { typeID: 10209, slot: 2 },
    ],
  });
  const session = buildSession({
    stationid: null,
    stationID: null,
    locationid: TEST_SYSTEM_ID,
    solarsystemid: TEST_SYSTEM_ID,
    solarsystemid2: TEST_SYSTEM_ID,
  });

  const result = jumpCloneRuntime.clearActiveImplantsForPodDeath(session, {
    locationID: TEST_SYSTEM_ID,
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.removedTypeIDs, [10208, 10209]);
  assert.deepEqual(getCharacterRecord(TEST_CHARACTER_ID).implants, []);

  const notifications = readTable("notifications");
  const box = notifications.boxes[String(TEST_CHARACTER_ID)];
  const records = Object.values(box.byID);
  assert.equal(
    records.some((entry) => entry.typeID === NOTIFICATION_TYPE_JUMP_CLONE_DELETED_1),
    true,
  );
}));
