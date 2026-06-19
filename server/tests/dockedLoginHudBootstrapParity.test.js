const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

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
const InvBrokerService = require(path.join(
  repoRoot,
  "server/src/services/inventory/invBrokerService",
));
const {
  marshalDecode,
} = require(path.join(
  repoRoot,
  "server/src/network/tcp/utils/marshal",
));
const {
  applyCharacterToSession,
  getActiveShipRecord,
  getCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  getFittedModuleItems,
  isEffectivelyOnlineModule,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
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
  resolveItemByName,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemTypeRegistry",
));

const TEST_STATION_ID = 60006580;
const HIGH_SLOT_FLAG_0 = 27;

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
}

function resolveExactType(name) {
  const result = resolveItemByName(name);
  assert.equal(result.success, true, `Expected to resolve ${name}`);
  return result.match;
}

function getDockedCandidateWithFit() {
  const service = new CharService();
  const characterID = service.Handle_CreateCharacterWithDoll(
    ["Hud Bootstrap Fit", 5, 1, 1, null, null, 11],
    { userid: 970901 },
  );
  const characterRecord = getCharacterRecord(characterID);
  assert.ok(characterRecord, "Expected docked login test character");

  const shipType = resolveExactType("Ibis");
  const moduleType = resolveExactType("Civilian Gatling Railgun");
  const shipResult = spawnShipInStationHangar(characterID, TEST_STATION_ID, shipType);
  assert.equal(shipResult.success, true, "Expected docked login test ship");
  const ship = shipResult.data;
  assert.equal(
    setActiveShipForCharacter(characterID, ship.itemID).success,
    true,
    "Expected docked login test ship activation",
  );
  const moduleResult = grantItemToCharacterLocation(
    characterID,
    ship.itemID,
    HIGH_SLOT_FLAG_0,
    moduleType,
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
  assert.equal(moduleResult.success, true, "Expected docked login fitted module");

  const fittedModules = getFittedModuleItems(characterID, ship.itemID);
  assert.ok(fittedModules.length > 0, "Expected docked login test fitted modules");
  return {
    characterID,
    stationID: TEST_STATION_ID,
    ship: getActiveShipRecord(characterID),
    fittedModules,
    onlineModules: fittedModules.filter((item) => isEffectivelyOnlineModule(item)),
  };
}

function buildSession(candidate) {
  return {
    clientID: candidate.characterID + 99000,
    userid: candidate.characterID,
    characterID: null,
    charid: null,
    corporationID: 0,
    allianceID: null,
    stationid: null,
    stationID: null,
    stationid2: null,
    shipID: null,
    shipid: null,
    activeShipID: null,
    locationid: null,
    solarsystemid: null,
    solarsystemid2: null,
    socket: { destroyed: false },
    currentBoundObjectID: null,
    notifications: [],
    sessionChanges: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
    sendSessionChange(change) {
      this.sessionChanges.push(change);
    },
  };
}

function getKeyValEntry(payload, key) {
  const entries = payload && payload.args && payload.args.entries;
  const found = Array.isArray(entries)
    ? entries.find((entry) => Array.isArray(entry) && entry[0] === key)
    : null;
  return found ? found[1] : null;
}

function extractDictEntries(value) {
  return value && value.type === "dict" && Array.isArray(value.entries)
    ? value.entries
    : [];
}

function extractBoundID(bound) {
  return bound &&
    bound.type === "substruct" &&
    bound.value &&
    bound.value.type === "substream" &&
    Array.isArray(bound.value.value)
    ? bound.value.value[0]
    : null;
}

test("docked login uses TQ-style GetAllInfo seed plus active ship inventory bind without fitted item resend", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const candidate = getDockedCandidateWithFit();
  const session = buildSession(candidate);
  const dogma = new DogmaService();
  const invBroker = new InvBrokerService();

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    logSelection: false,
  });
  assert.equal(applyResult.success, true);
  assert.equal(Number(session.stationid || 0), candidate.stationID);
  assert.ok(
    session._pendingDockedFittingBootstrap,
    "Expected docked login to queue only a bootstrap completion marker",
  );

  const allInfo = dogma.Handle_GetAllInfo([true, true, null], session);
  const shipInfo = getKeyValEntry(allInfo, "shipInfo");
  const shipInfoEntries = extractDictEntries(shipInfo);
  const shipInfoIDs = new Set(
    shipInfoEntries
      .map((entry) => Number(Array.isArray(entry) ? entry[0] : 0) || 0)
      .filter((itemID) => itemID > 0),
  );
  assert.equal(shipInfoIDs.has(Number(candidate.ship.itemID)), true);
  for (const fittedModule of candidate.fittedModules) {
    assert.equal(
      shipInfoIDs.has(Number(fittedModule.itemID)),
      true,
      `Expected GetAllInfo.shipInfo to seed fitted module ${fittedModule.itemID}`,
    );
  }

  session.notifications.length = 0;
  dogma.afterCallResponse("GetAllInfo", session);
  assert.equal(
    session.notifications.some((notification) => notification.name === "OnItemChange"),
    false,
    "GetAllInfo follow-up must not send fitted inventory rows back as item changes",
  );

  const bound = invBroker.Handle_GetInventoryFromId([candidate.ship.itemID, 0], session, {});
  const boundID = extractBoundID(bound);
  assert.ok(boundID, "Expected active ship inventory bind to succeed");
  session.currentBoundObjectID = boundID;
  invBroker.afterCallResponse("GetInventoryFromId", session);

  assert.equal(session._pendingDockedFittingBootstrap, null);
  assert.equal(
    session.notifications.some((notification) => notification.name === "OnItemChange"),
    false,
    "Active ship inventory bind must not resend fitted modules as OnItemChange during MakeShipActive",
  );
  assert.equal(
    session.notifications.some((notification) => notification.name === "OnModuleAttributeChanges"),
    true,
    "Expected active ship inventory bind to refresh fitting attributes without inventory resend",
  );
  assert.equal(
    candidate.onlineModules.length === 0 ||
      session.notifications.some((notification) => notification.name === "OnGodmaShipEffect"),
    true,
    "Expected online modules to publish dogma effects without fitted inventory rows",
  );

  const brainNotification = session.notifications.find(
    (notification) => notification.name === "OnServerBrainUpdated",
  );
  assert.ok(brainNotification, "Expected one character brain update from dogma bootstrap");
  const brainPayload = Array.isArray(brainNotification.payload)
    ? brainNotification.payload[0]
    : null;
  assert.ok(Array.isArray(brainPayload), "Expected OnServerBrainUpdated to carry [version, grayMatter]");
  assert.ok(Buffer.isBuffer(brainPayload[1]), "Expected OnServerBrainUpdated grayMatter to stay marshaled");
  const decodedBrain = marshalDecode(brainPayload[1]);
  assert.equal(Array.isArray(decodedBrain), true);
  assert.equal(decodedBrain.length, 3);
});
