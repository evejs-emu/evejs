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
const NesIntroService = require(path.join(
  repoRoot,
  "server/src/services/npe/nesIntroService",
));
const MachoNetService = require(path.join(
  repoRoot,
  "server/src/services/machoNet/machoNetService",
));
const tutorialHandoffRuntime = require(path.join(
  repoRoot,
  "server/src/services/npe/tutorialHandoffRuntime",
));
const tutorialRuntime = require(path.join(
  repoRoot,
  "server/src/services/npe/tutorialRuntime",
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

function restoreTutorialState(t) {
  const originalCharacters = cloneValue(database.read("characters", "/").data || {});
  const originalIdentityState = cloneValue(database.read("identityState", "/").data || {});
  const originalItems = cloneValue(database.read("items", "/").data || {});
  const originalSkills = cloneValue(database.read("skills", "/").data || {});
  const originalNotifications = cloneValue(
    database.read("notifications", "/").data || {},
  );
  const originalMail = cloneValue(database.read("mail", "/").data || {});
  const originalTutorialToggle = config.newCharacterTutorialEnabled;
  const originalIntroToggle = config.newCharacterIntroCinematicEnabled;

  t.after(() => {
    tutorialHandoffRuntime._testing.setTestingHooks(null);
    config.newCharacterTutorialEnabled = originalTutorialToggle;
    config.newCharacterIntroCinematicEnabled = originalIntroToggle;
    database.write("characters", "/", originalCharacters);
    database.write("identityState", "/", originalIdentityState);
    database.write("items", "/", originalItems);
    database.write("skills", "/", originalSkills);
    database.write("notifications", "/", originalNotifications);
    database.write("mail", "/", originalMail);
    database.flushAllSync();
  });
}

function installTutorialHandoffHarness() {
  const calls = [];
  tutorialHandoffRuntime._testing.setTestingHooks({
    transitions: {
      undockSession(session) {
        calls.push({ type: "undock" });
        session.stationid = null;
        session.stationID = null;
        session.stationid2 = null;
        session.structureid = null;
        session.structureID = null;
        session.solarsystemid = session.solarsystemid || session.solarsystemid2 || 30000142;
        return { success: true };
      },
      dockSession(session, locationID) {
        calls.push({ type: "dock", locationID });
        session.stationid = locationID;
        session.stationID = locationID;
        session.stationid2 = locationID;
        return { success: true };
      },
    },
    timers: {
      setTimeout(fn, delay) {
        calls.push({ type: "timer", delay });
        fn();
        return 1;
      },
    },
  });
  return calls;
}

test("tutorial entry mode gives cinematic override precedence over active tutorial mode", () => {
  assert.equal(
    tutorialRuntime.resolveNewCharacterTutorialEntryMode({
      newCharacterTutorialEnabled: false,
      newCharacterIntroCinematicEnabled: false,
    }),
    tutorialRuntime.TUTORIAL_ENTRY_MODE.DISABLED,
  );
  assert.equal(
    tutorialRuntime.resolveNewCharacterTutorialEntryMode({
      newCharacterTutorialEnabled: true,
      newCharacterIntroCinematicEnabled: false,
    }),
    tutorialRuntime.TUTORIAL_ENTRY_MODE.TUTORIAL,
  );
  assert.equal(
    tutorialRuntime.resolveNewCharacterTutorialEntryMode({
      newCharacterTutorialEnabled: true,
      newCharacterIntroCinematicEnabled: true,
    }),
    tutorialRuntime.TUTORIAL_ENTRY_MODE.CINEMATIC_INTRO_OVERLAY,
  );
});

test("machoNet advertises the AIR tutorial service surface", () => {
  const machoNetService = new MachoNetService();
  const serviceInfo = machoNetService.getServiceInfoDict();
  const serviceMap = new Map(serviceInfo.entries);

  assert.equal(serviceMap.get("operationsManager"), null);
  assert.equal(serviceMap.get("air_npe"), null);
  assert.equal(serviceMap.get("nes_intro"), null);
});

test("cinematic override mode keeps new characters on the intro-compatible overlay path", (t) => {
  restoreTutorialState(t);
  const handoffCalls = installTutorialHandoffHarness();
  config.newCharacterTutorialEnabled = true;
  config.newCharacterIntroCinematicEnabled = true;

  const charService = new CharService();
  const airNpeService = new AirNpeService();
  const nesIntroService = new NesIntroService();
  const creationSession = buildSession(910201);

  const charId = charService.Handle_CreateCharacterWithDoll(
    [
      "Tutorial Cinematic Override",
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

  const createdSnapshot = tutorialRuntime.getCharacterTutorialSnapshot(charId);
  assert.equal(
    createdSnapshot.entryMode,
    tutorialRuntime.TUTORIAL_ENTRY_MODE.CINEMATIC_INTRO_OVERLAY,
  );
  assert.equal(createdSnapshot.airNpeState, tutorialRuntime.AIR_NPE_STATE.COMPLETED);
  assert.equal(createdSnapshot.revealCompletedStateOnFirstLogin, false);
  assert.equal(
    createdSnapshot.firstLoginHandoff,
    tutorialRuntime.TUTORIAL_FIRST_LOGIN_HANDOFF.NONE,
  );
  assert.equal(nesIntroService.Handle_get_nes_intro_state([], creationSession), 0);

  const selectedSession = buildSession(910201);
  charService.Handle_SelectCharacterID([charId], selectedSession);
  const selectedRecord = getCharacterRecord(charId);

  const selectedSnapshot = tutorialRuntime.getCharacterTutorialSnapshot(charId);
  assert.equal(
    selectedSnapshot.firstLoginHandoff,
    tutorialRuntime.TUTORIAL_FIRST_LOGIN_HANDOFF.NONE,
  );
  assert.equal(selectedSnapshot.revealCompletedStateOnFirstLogin, false);
  assert.equal(airNpeService.Handle_get_air_npe_state([], selectedSession), 2);
  const revealedSnapshot = tutorialRuntime.getCharacterTutorialSnapshot(charId);
  assert.equal(revealedSnapshot.revealCompletedStateOnFirstLogin, false);
  assert.equal(handoffCalls.length, 0);
  assert.equal(
    Number(selectedSession.stationid || selectedSession.stationID || 0),
    Number(selectedRecord.stationID),
  );
  assert.equal(
    Number(selectedSession.solarsystemid2 || selectedSession.solarsystemid || 0),
    Number(selectedRecord.solarSystemID),
  );
  assert.equal(
    selectedSession._notifications.some(
      (entry) => entry && entry.name === "OnAirNpeStateChanged",
    ),
    false,
  );
});

test("legacy cinematic reveal flags are cleared silently on first login", (t) => {
  restoreTutorialState(t);
  config.newCharacterTutorialEnabled = false;
  config.newCharacterIntroCinematicEnabled = true;

  const charService = new CharService();
  const creationSession = buildSession(910203);

  const charId = charService.Handle_CreateCharacterWithDoll(
    [
      "Tutorial Legacy Reveal",
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

  const legacyRecord = {
    ...getCharacterRecord(charId),
    tutorialEntryMode:
      tutorialRuntime.LEGACY_TUTORIAL_ENTRY_MODE.CINEMATIC_ENTRY_TO_SPACE,
    airNpeRevealOnFirstLogin: true,
  };
  database.write("characters", `/${String(charId)}`, legacyRecord);

  const selectedSession = buildSession(910203);
  charService.Handle_SelectCharacterID([charId], selectedSession);

  const selectedSnapshot = tutorialRuntime.getCharacterTutorialSnapshot(charId);
  assert.equal(
    selectedSnapshot.entryMode,
    tutorialRuntime.TUTORIAL_ENTRY_MODE.CINEMATIC_INTRO_OVERLAY,
  );
  assert.equal(selectedSnapshot.revealCompletedStateOnFirstLogin, false);
  assert.equal(
    selectedSession._notifications.some(
      (entry) => entry && entry.name === "OnAirNpeStateChanged",
    ),
    false,
  );
});

test("skipTutorial is inert for cinematic-only login and never starts the space bounce", (t) => {
  restoreTutorialState(t);
  const handoffCalls = installTutorialHandoffHarness();
  config.newCharacterTutorialEnabled = true;
  config.newCharacterIntroCinematicEnabled = true;

  const charService = new CharService();
  const creationSession = buildSession(910202);

  const charId = charService.Handle_CreateCharacterWithDoll(
    [
      "Tutorial Override Skip",
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

  const selectedSession = buildSession(910202);
  charService.Handle_SelectCharacterID([charId, null, true], selectedSession);

  const selectedSnapshot = tutorialRuntime.getCharacterTutorialSnapshot(charId);
  assert.equal(selectedSnapshot.airNpeState, tutorialRuntime.AIR_NPE_STATE.COMPLETED);
  assert.equal(
    selectedSnapshot.firstLoginHandoff,
    tutorialRuntime.TUTORIAL_FIRST_LOGIN_HANDOFF.NONE,
  );
  assert.equal(handoffCalls.length, 0);
  assert.equal(
    selectedSession._notifications.some(
      (entry) => entry && entry.name === "OnAirNpeStateChanged",
    ),
    false,
  );
});
