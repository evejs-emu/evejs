const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const CharService = require(path.join(
  repoRoot,
  "server/src/services/character/charService",
));
const database = require(path.join(
  repoRoot,
  "server/src/newDatabase",
));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));
const {
  isMachoWrappedException,
} = require(path.join(
  repoRoot,
  "server/src/common/machoErrors",
));

function buildLiveSession(overrides = {}) {
  return {
    userid: 1,
    userName: "test-user",
    characterID: 0,
    characterName: "",
    clientID: 0,
    socket: {
      destroyed: false,
    },
    ...overrides,
  };
}

test("SelectCharacterID request parsing accepts stock-client charID kwargs", () => {
  const charId = CharService._testing.resolveCharacterRequestId(
    [],
    {
      type: "dict",
      entries: [
        ["charID", 140000008],
        ["secondChoiceID", null],
        ["skipTutorial", true],
      ],
    },
    0,
  );

  assert.equal(charId, 140000008);
});

test("SelectCharacterID rejects a character that is already online in another live session", (t) => {
  const service = new CharService();
  const existingSession = buildLiveSession({
    userid: 2,
    userName: "existing-user",
    clientID: 77,
    characterID: 140000001,
    characterName: "testchar",
  });
  const selectingSession = buildLiveSession({
    userid: 1,
    userName: "new-user",
  });

  sessionRegistry.register(existingSession);
  t.after(() => {
    sessionRegistry.unregister(existingSession);
    sessionRegistry.unregister(selectingSession);
  });

  assert.throws(
    () => service.Handle_SelectCharacterID([140000001], selectingSession),
    (error) => {
      assert.equal(isMachoWrappedException(error), true);
      assert.equal(
        error.machoErrorResponse.payload.header[1][0],
        "CustomInfo",
      );

      const infoEntry = error.machoErrorResponse.payload.header[1][1].entries.find(
        ([key]) => key === "info",
      );
      assert.ok(infoEntry);
      assert.match(String(infoEntry[1]), /already online/i);
      return true;
    },
  );
});

test("SelectCharacterID rejects a character owned by another account", (t) => {
  const originalCharacters = JSON.parse(
    JSON.stringify(database.read("characters", "/").data || {}),
  );
  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.flushAllSync();
  });

  const foreignCharacterID = 140099901;
  const craftedCharacters = {
    ...originalCharacters,
    [String(foreignCharacterID)]: {
      accountId: 99,
      characterName: "Foreign Pilot",
      gender: 1,
      typeID: 1373,
      raceID: 1,
      bloodlineID: 1,
      ancestryID: 1,
      corporationID: 1000009,
      schoolID: 1000009,
      solarSystemID: 30000142,
      stationID: 60003760,
      shipTypeID: 606,
      shipID: foreignCharacterID + 100,
    },
  };
  database.write("characters", "/", craftedCharacters);

  const service = new CharService();
  const selectingSession = buildLiveSession({
    userid: 1,
    userName: "new-user",
  });

  assert.throws(
    () => service.Handle_SelectCharacterID([foreignCharacterID], selectingSession),
    (error) => {
      assert.equal(isMachoWrappedException(error), true);
      assert.equal(
        error.machoErrorResponse.payload.header[1][0],
        "CustomInfo",
      );

      const infoEntry = error.machoErrorResponse.payload.header[1][1].entries.find(
        ([key]) => key === "info",
      );
      assert.ok(infoEntry);
      assert.match(String(infoEntry[1]), /not available on this account/i);
      return true;
    },
  );
});
