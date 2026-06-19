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
const AirNpeService = require(path.join(
  repoRoot,
  "server/src/services/npe/airNpeService",
));
const OperationsManagerService = require(path.join(
  repoRoot,
  "server/src/services/character/operationsManagerService",
));
const {
  buildGlobalConfigEntries,
} = require(path.join(repoRoot, "server/src/services/machoNet/globalConfig"));
const {
  getCharacterRecord,
} = require(path.join(repoRoot, "server/src/services/character/characterState"));

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildSession(userID) {
  return {
    userid: userID,
    characterID: 0,
    charid: 0,
    clientID: userID,
    socket: { destroyed: false },
    _notifications: [],
    sendNotification(name, idType, payload) {
      this._notifications.push({ name, idType, payload });
    },
    sendSessionChange() {},
  };
}

function restoreTutorialTestState(t) {
  const originalCharacters = cloneValue(database.read("characters", "/").data || {});
  const originalIdentityState = cloneValue(database.read("identityState", "/").data || {});
  const originalItems = cloneValue(database.read("items", "/").data || {});
  const originalSkills = cloneValue(database.read("skills", "/").data || {});
  const originalNotifications = cloneValue(
    database.read("notifications", "/").data || {},
  );
  const originalTutorialToggle = config.newCharacterTutorialEnabled;
  const originalIntroToggle = config.newCharacterIntroCinematicEnabled;

  t.after(() => {
    config.newCharacterTutorialEnabled = originalTutorialToggle;
    config.newCharacterIntroCinematicEnabled = originalIntroToggle;
    database.write("characters", "/", originalCharacters);
    database.write("identityState", "/", originalIdentityState);
    database.write("items", "/", originalItems);
    database.write("skills", "/", originalSkills);
    database.write("notifications", "/", originalNotifications);
    database.flushAllSync();
  });
}

test("global config exposes air_npe_enabled from the tutorial toggle", () => {
  const enabledEntries = new Map(
    buildGlobalConfigEntries({
      ...config,
      newCharacterTutorialEnabled: true,
      newCharacterIntroCinematicEnabled: false,
    }),
  );
  const introOnlyEntries = new Map(
    buildGlobalConfigEntries({
      ...config,
      newCharacterTutorialEnabled: false,
      newCharacterIntroCinematicEnabled: true,
    }),
  );
  const disabledEntries = new Map(
    buildGlobalConfigEntries({
      ...config,
      newCharacterTutorialEnabled: false,
      newCharacterIntroCinematicEnabled: false,
    }),
  );

  assert.equal(enabledEntries.get("air_npe_enabled"), 1);
  assert.equal(introOnlyEntries.get("air_npe_enabled"), 1);
  assert.equal(disabledEntries.get("air_npe_enabled"), 0);
});

test("new characters inherit active tutorial state when the toggle is enabled", (t) => {
  restoreTutorialTestState(t);
  config.newCharacterTutorialEnabled = true;
  config.newCharacterIntroCinematicEnabled = false;

  const charService = new CharService();
  const airNpeService = new AirNpeService();
  const operationsManager = new OperationsManagerService();
  const creationSession = buildSession(910101);

  const charId = charService.Handle_CreateCharacterWithDoll(
    [
      "Tutorial Active Parity",
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
  assert.ok(record);
  assert.equal(record.airNpeState, 1);
  assert.equal(airNpeService.Handle_is_air_npe_enabled([], creationSession), true);

  const selectedSession = buildSession(910101);
  charService.Handle_SelectCharacterID([charId], selectedSession);

  assert.equal(airNpeService.Handle_get_air_npe_state([], selectedSession), 1);
  assert.equal(
    operationsManager.Handle_can_character_play_the_tutorial([charId], selectedSession),
    true,
  );
  assert.equal(operationsManager.Handle_get_tutorial_state([], selectedSession), 21);
  assert.equal(
    operationsManager.Handle_is_main_tutorial_finished([], selectedSession),
    false,
  );
  assert.equal(operationsManager.Handle_has_skipped_tutorial([], selectedSession), false);
});

test("skipTutorial on character selection marks an active tutorial character as skipped", (t) => {
  restoreTutorialTestState(t);
  config.newCharacterTutorialEnabled = true;
  config.newCharacterIntroCinematicEnabled = false;

  const charService = new CharService();
  const airNpeService = new AirNpeService();
  const operationsManager = new OperationsManagerService();
  const creationSession = buildSession(910102);

  const charId = charService.Handle_CreateCharacterWithDoll(
    [
      "Tutorial Skip Parity",
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

  const selectedSession = buildSession(910102);
  charService.Handle_SelectCharacterID([charId, null, true], selectedSession);

  const record = getCharacterRecord(charId);
  assert.equal(record.airNpeState, 3);
  assert.equal(airNpeService.Handle_get_air_npe_state([], selectedSession), 3);
  assert.equal(operationsManager.Handle_get_tutorial_state([], selectedSession), 23);
  assert.equal(
    operationsManager.Handle_is_main_tutorial_finished([], selectedSession),
    true,
  );
  assert.equal(operationsManager.Handle_has_skipped_tutorial([], selectedSession), true);
  assert.ok(
    selectedSession._notifications.some(
      (entry) =>
        entry &&
        entry.name === "OnAirNpeStateChanged" &&
        Array.isArray(entry.payload) &&
        entry.payload[0] === charId &&
        entry.payload[1] === 3,
    ),
  );
});

test("intro-cinematic-only new characters stay completed without firing an AIR reveal notification", (t) => {
  restoreTutorialTestState(t);
  config.newCharacterTutorialEnabled = false;
  config.newCharacterIntroCinematicEnabled = true;

  const charService = new CharService();
  const airNpeService = new AirNpeService();
  const operationsManager = new OperationsManagerService();
  const creationSession = buildSession(910103);

  const charId = charService.Handle_CreateCharacterWithDoll(
    [
      "Tutorial Disabled Parity",
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
  assert.equal(record.airNpeState, 2);
  assert.notEqual(record.airNpeRevealOnFirstLogin, true);
  assert.equal(airNpeService.Handle_is_air_npe_enabled([], creationSession), true);

  const selectedSession = buildSession(910103);
  charService.Handle_SelectCharacterID([charId], selectedSession);

  const selectedRecord = getCharacterRecord(charId);
  assert.equal(selectedRecord.airNpeRevealOnFirstLogin, false);
  assert.equal(airNpeService.Handle_get_air_npe_state([], selectedSession), 2);
  assert.equal(
    operationsManager.Handle_can_character_play_the_tutorial([charId], selectedSession),
    false,
  );
  assert.equal(operationsManager.Handle_get_tutorial_state([], selectedSession), 22);
  assert.equal(
    selectedSession._notifications.some(
      (entry) => entry && entry.name === "OnAirNpeStateChanged",
    ),
    false,
  );
});

test("fully disabled new characters skip both tutorial activation and intro-only reveal", (t) => {
  restoreTutorialTestState(t);
  config.newCharacterTutorialEnabled = false;
  config.newCharacterIntroCinematicEnabled = false;

  const charService = new CharService();
  const airNpeService = new AirNpeService();
  const creationSession = buildSession(910104);

  const charId = charService.Handle_CreateCharacterWithDoll(
    [
      "Tutorial Disabled Final",
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
  assert.equal(record.airNpeState, 2);
  assert.notEqual(record.airNpeRevealOnFirstLogin, true);
  assert.equal(airNpeService.Handle_is_air_npe_enabled([], creationSession), false);
});
