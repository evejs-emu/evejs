const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const config = require(path.join(repoRoot, "server/src/config"));
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const CharService = require(path.join(
  repoRoot,
  "server/src/services/character/charService",
));
const tutorialEntrySpawnRuntime = require(path.join(
  repoRoot,
  "server/src/services/npe/tutorialEntrySpawnRuntime",
));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const {
  NEW_CHARACTER_START_OVERRIDE,
} = require(path.join(
  repoRoot,
  "server/src/services/_shared/newCharacterStartOverride",
));
const {
  getCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function restoreTable(tableName, snapshot) {
  database.write(tableName, "/", cloneValue(snapshot), { force: true });
}

function buildSession(userID) {
  return {
    userid: userID,
    clientID: userID,
    characterID: 0,
    charid: 0,
    socket: { destroyed: false },
    _notifications: [],
    sendNotification(name, idType, payload) {
      this._notifications.push({ name, idType, payload });
    },
    sendSessionChange() {},
  };
}

function installStateRestore(t) {
  const originalCharacters = cloneValue(database.read("characters", "/").data || {});
  const originalIdentityState = cloneValue(database.read("identityState", "/").data || {});
  const originalItems = cloneValue(database.read("items", "/").data || {});
  const originalSkills = cloneValue(database.read("skills", "/").data || {});
  const originalMail = cloneValue(database.read("mail", "/").data || {});
  const originalNotifications = cloneValue(
    database.read("notifications", "/").data || {},
  );
  const originalTutorialToggle = config.newCharacterTutorialEnabled;
  const originalIntroToggle = config.newCharacterIntroCinematicEnabled;
  const originalStartupLoading = config.NewEdenSystemLoading;

  t.after(() => {
    config.newCharacterTutorialEnabled = originalTutorialToggle;
    config.newCharacterIntroCinematicEnabled = originalIntroToggle;
    config.NewEdenSystemLoading = originalStartupLoading;
    restoreTable("characters", originalCharacters);
    restoreTable("identityState", originalIdentityState);
    restoreTable("items", originalItems);
    restoreTable("skills", originalSkills);
    restoreTable("mail", originalMail);
    restoreTable("notifications", originalNotifications);
    database.flushAllSync();
  });
}

test("new characters without intro cinematic now start docked in the Manifest AIR Trade Hub", (t) => {
  installStateRestore(t);
  config.newCharacterTutorialEnabled = false;
  config.newCharacterIntroCinematicEnabled = false;

  const charService = new CharService();
  const session = buildSession(911001);
  const charId = charService.Handle_CreateCharacterWithDoll(
    [
      "Manifest Start Docked",
      1,
      1,
      1,
      1,
      { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [] } },
      { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [] } },
      11,
    ],
    session,
  );

  const record = getCharacterRecord(charId);
  assert.ok(record, "expected a created character record");
  assert.equal(record.stationID, NEW_CHARACTER_START_OVERRIDE.stationID);
  assert.equal(record.homeStationID, NEW_CHARACTER_START_OVERRIDE.stationID);
  assert.equal(record.cloneStationID, NEW_CHARACTER_START_OVERRIDE.stationID);
  assert.equal(record.solarSystemID, NEW_CHARACTER_START_OVERRIDE.solarSystemID);

  const shipItem = database.read("items", `/${String(record.shipID)}`).data;
  assert.ok(shipItem, "expected rookie ship to exist");
  assert.equal(shipItem.locationID, NEW_CHARACTER_START_OVERRIDE.stationID);
});

test("intro-cinematic characters still resolve to Manifest AIR location data on create and selection", (t) => {
  installStateRestore(t);
  config.newCharacterTutorialEnabled = false;
  config.newCharacterIntroCinematicEnabled = true;

  const charService = new CharService();
  const creationSession = buildSession(911002);
  const charId = charService.Handle_CreateCharacterWithDoll(
    [
      "Manifest Start Cinematic",
      1,
      1,
      1,
      1,
      { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [] } },
      { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [] } },
      11,
    ],
    creationSession,
  );

  const record = getCharacterRecord(charId);
  assert.ok(record, "expected a created character record");
  assert.equal(record.stationID, NEW_CHARACTER_START_OVERRIDE.stationID);
  assert.equal(record.solarSystemID, NEW_CHARACTER_START_OVERRIDE.solarSystemID);

  assert.equal(
    tutorialEntrySpawnRuntime.CINEMATIC_SPAWN_STATION_ID,
    NEW_CHARACTER_START_OVERRIDE.stationID,
  );
  const cinematicSpawnContext = tutorialEntrySpawnRuntime.buildCinematicSpaceSpawnContext({
    characterID: charId,
    shipTypeID: record.shipTypeID,
  });
  assert.equal(cinematicSpawnContext.success, true);
  assert.equal(
    cinematicSpawnContext.data.stationID,
    NEW_CHARACTER_START_OVERRIDE.stationID,
  );
  assert.equal(
    cinematicSpawnContext.data.solarSystemID,
    NEW_CHARACTER_START_OVERRIDE.solarSystemID,
  );

  const selectedSession = buildSession(911002);
  charService.Handle_SelectCharacterID([charId], selectedSession);
  assert.equal(
    Number(selectedSession.stationid || selectedSession.stationID || 0),
    NEW_CHARACTER_START_OVERRIDE.stationID,
  );
  assert.equal(
    Number(selectedSession.solarsystemid2 || selectedSession.solarsystemid || 0),
    NEW_CHARACTER_START_OVERRIDE.solarSystemID,
  );
});

test("lazy startup preload now includes Manifest beside Jita and New Caldari", (t) => {
  installStateRestore(t);
  config.NewEdenSystemLoading = 1;

  const plan = spaceRuntime._testing.resolveStartupSolarSystemPreloadPlanForTesting();

  assert.deepEqual(spaceRuntime._testing.STARTUP_PRELOADED_SYSTEM_IDS, [
    30000142,
    30000145,
    NEW_CHARACTER_START_OVERRIDE.solarSystemID,
  ]);
  assert.deepEqual(plan.systemIDs, [
    30000142,
    30000145,
    NEW_CHARACTER_START_OVERRIDE.solarSystemID,
  ]);
  assert.equal(
    plan.targetSummary,
    "Jita, New Caldari, and Manifest",
  );
});
