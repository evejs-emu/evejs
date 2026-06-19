const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const CharService = require(path.join(
  repoRoot,
  "server/src/services/character/charService",
));
const {
  VALIDATION_CODE,
  validateCharacterName,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterNameRuntime",
));
const {
  isMachoWrappedException,
} = require(path.join(repoRoot, "server/src/common/machoErrors"));

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function extractWrappedUserErrorMessage(error) {
  if (!isMachoWrappedException(error)) {
    return null;
  }
  return error.machoErrorResponse.payload.header[1][0];
}

function buildCreateSession() {
  return {
    userid: 991001,
    charid: null,
    characterID: null,
  };
}

test("ValidateNameEx returns parity codes for unavailable, reserved, and malformed character names", (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data || {});

  t.after(() => {
    database.write("characters", "/", originalCharacters, { force: true });
    database.flushAllSync();
  });

  database.write(
    "characters",
    "/",
    {
      140099991: {
        accountId: 55,
        characterName: "Test123123",
      },
    },
    { force: true },
  );
  database.flushAllSync();

  const service = new CharService();

  assert.equal(
    service.Handle_ValidateNameEx(["Test123123", 0], null),
    VALIDATION_CODE.UNAVAILABLE,
  );
  assert.equal(
    service.Handle_ValidateNameEx(["test123123", 1], null),
    VALIDATION_CODE.UNAVAILABLE,
  );
  assert.equal(
    service.Handle_ValidateNameEx(["Elysian", 2], null),
    VALIDATION_CODE.RESERVED,
  );
  assert.equal(
    service.Handle_ValidateNameEx(["GM NewPilot", 3], null),
    VALIDATION_CODE.RESERVED,
  );
  assert.equal(
    service.Handle_ValidateNameEx(["ab", 4], null),
    VALIDATION_CODE.TOO_SHORT,
  );
  assert.equal(
    service.Handle_ValidateNameEx(["", 4], null),
    VALIDATION_CODE.TOO_SHORT,
  );
  assert.equal(
    service.Handle_ValidateNameEx(["Bad  Spaces", 5], null),
    VALIDATION_CODE.CONSECUTIVE_SPACES,
  );
  assert.equal(
    service.Handle_ValidateNameEx(["One Two Three Four", 6], null),
    VALIDATION_CODE.TOO_MANY_SPACES,
  );
  assert.equal(
    service.Handle_ValidateNameEx(["Bad@Name", 7], null),
    VALIDATION_CODE.ILLEGAL_CHARACTER,
  );
  assert.equal(
    service.Handle_ValidateNameEx(["Valid Capsuleer", 8], null),
    VALIDATION_CODE.VALID,
  );
});

test("GetValidRandomName returns a legal unused name for each supported race bucket", (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data || {});

  t.after(() => {
    database.write("characters", "/", originalCharacters, { force: true });
    database.flushAllSync();
  });

  database.write(
    "characters",
    "/",
    {
      140099992: {
        accountId: 77,
        characterName: "Jamyl Sarum",
      },
    },
    { force: true },
  );
  database.flushAllSync();

  const service = new CharService();
  for (const raceID of [1, 2, 4, 8]) {
    const randomName = service.Handle_GetValidRandomName([raceID], null);
    assert.equal(typeof randomName, "string");
    assert.ok(randomName.length >= 3, `expected a usable name for race ${raceID}`);
    assert.equal(
      validateCharacterName(randomName),
      VALIDATION_CODE.VALID,
      `expected GetValidRandomName(${raceID}) to produce a valid name`,
    );
  }
});

test("CreateCharacterWithDoll rejects duplicate and reserved names even if the client bypasses preflight validation", (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data || {});
  const originalItems = cloneValue(database.read("items", "/").data || {});
  const originalSkills = cloneValue(database.read("skills", "/").data || {});
  const originalNotifications = cloneValue(database.read("notifications", "/").data || {});
  const originalMail = cloneValue(database.read("mail", "/").data || {});
  const originalIdentityState = cloneValue(database.read("identityState", "/").data || {});

  t.after(() => {
    database.write("identityState", "/", originalIdentityState, { force: true });
    database.write("characters", "/", originalCharacters, { force: true });
    database.write("items", "/", originalItems, { force: true });
    database.write("skills", "/", originalSkills, { force: true });
    database.write("notifications", "/", originalNotifications, { force: true });
    database.write("mail", "/", originalMail, { force: true });
    database.flushAllSync();
  });

  database.write(
    "characters",
    "/",
    {
      140099993: {
        accountId: 88,
        characterName: "Test123123",
      },
    },
    { force: true },
  );
  database.write(
    "identityState",
    "/",
    {
      version: 1,
      nextAccountID: 1,
      nextCharacterID: 140100000,
    },
    { force: true },
  );
  database.write("items", "/", {}, { force: true });
  database.write("skills", "/", {}, { force: true });
  database.write("notifications", "/", {}, { force: true });
  database.write("mail", "/", { messages: {}, mailboxes: {}, mailingLists: {}, _meta: { nextMessageID: 1, nextMailingListID: 500000000 } }, { force: true });
  database.flushAllSync();

  const service = new CharService();
  const session = buildCreateSession();

  assert.throws(
    () =>
      service.Handle_CreateCharacterWithDoll(
        ["Test123123", 4, 5, 0, 3, null, null, 11],
        session,
      ),
    (error) => {
      assert.equal(extractWrappedUserErrorMessage(error), "CharNameInvalid");
      return true;
    },
  );

  assert.throws(
    () =>
      service.Handle_CreateCharacterWithDoll(
        ["Elysian", 4, 5, 0, 3, null, null, 11],
        session,
      ),
    (error) => {
      assert.equal(extractWrappedUserErrorMessage(error), "CharNameInvalid");
      return true;
    },
  );

  const charactersAfter = database.read("characters", "/").data || {};
  assert.equal(Object.keys(charactersAfter).length, 1);
  assert.equal(charactersAfter["140099993"].characterName, "Test123123");
});
