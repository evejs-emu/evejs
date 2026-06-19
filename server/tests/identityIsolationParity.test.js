const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const config = require(path.join(repoRoot, "server/src/config"));
const EVEHandshake = require(path.join(
  repoRoot,
  "server/src/network/tcp/handshake",
));
const CharService = require(path.join(
  repoRoot,
  "server/src/services/character/charService",
));
const MailMgrService = require(path.join(
  repoRoot,
  "server/src/services/mail/mailMgrService",
));
const {
  unwrapMarshalValue,
} = require(path.join(
  repoRoot,
  "server/src/services/_shared/serviceHelpers",
));
const {
  MachoWrappedException,
} = require(path.join(repoRoot, "server/src/common/machoErrors"));

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function restoreTable(tableName, snapshot) {
  database.write(tableName, "/", cloneValue(snapshot), { force: true });
}

function buildLoginDict(username, passwordHashHex) {
  return {
    type: "dict",
    entries: [
      ["user_name", username],
      ["user_password_hash", passwordHashHex],
      ["user_languageid", "EN"],
    ],
  };
}

function buildHandshakeSocket() {
  return {
    remoteAddress: "127.0.0.1",
    writes: [],
    ended: false,
    write(buffer) {
      this.writes.push(buffer);
    },
    end() {
      this.ended = true;
    },
  };
}

function buildEmptyMailState() {
  return {
    _meta: {
      nextMessageID: 2,
      nextMailingListID: 500000000,
    },
    messages: {
      1: {
        messageID: 1,
        senderID: 140000004,
        toCharacterIDs: [140000010],
        toCorpOrAllianceID: null,
        toListID: null,
        title: "Stale occupant mail",
        body: "This must never leak to a new character.",
        sentDate: "134000000000000000",
        statusMask: 0,
        labelMask: 0,
      },
    },
    mailboxes: {
      140000010: {
        statuses: {
          1: {
            messageID: 1,
            statusMask: 0,
            labelMask: 0,
            senderID: 140000004,
            sentDate: "134000000000000000",
          },
        },
        labels: {},
        _meta: {
          nextLabelMask: 4096,
        },
      },
    },
    mailingLists: {},
  };
}

function buildEmptyNotificationsState() {
  return {
    _meta: {
      nextNotificationID: 1,
    },
    boxes: {
      140000010: {
        byID: {},
        order: [],
      },
    },
  };
}

test("auto-created accounts allocate above orphaned character ownership instead of reusing stale account IDs", (t) => {
  const originalAccounts = cloneValue(database.read("accounts", "/").data || {});
  const originalCharacters = cloneValue(database.read("characters", "/").data || {});
  const originalIdentityState = cloneValue(database.read("identityState", "/").data || {});
  const originalAutoCreate = config.devAutoCreateAccounts;
  const originalSkipValidation = config.devSkipPasswordValidation;

  t.after(() => {
    config.devAutoCreateAccounts = originalAutoCreate;
    config.devSkipPasswordValidation = originalSkipValidation;
    restoreTable("accounts", originalAccounts);
    restoreTable("characters", originalCharacters);
    restoreTable("identityState", originalIdentityState);
    database.flushAllSync();
  });

  const highestExistingAccountID = Math.max(
    0,
    ...Object.values(originalAccounts).map((record) => Number(record && record.id) || 0),
  );
  const orphanedAccountID = highestExistingAccountID + 50;
  const orphanedCharacterID = 140090001;
  const testUserName = "__identity_isolation_autocreate__";
  const passwordHashHex = "0123456789abcdef0123456789abcdef01234567";

  config.devAutoCreateAccounts = true;
  config.devSkipPasswordValidation = true;

  const seededAccounts = cloneValue(originalAccounts);
  delete seededAccounts[testUserName];
  const seededCharacters = {
    [String(orphanedCharacterID)]: {
      accountId: orphanedAccountID,
      characterName: "Orphaned Ownership Guard",
      stationID: 60003760,
      solarSystemID: 30000142,
    },
  };

  restoreTable("accounts", seededAccounts);
  restoreTable("characters", seededCharacters);
  restoreTable("identityState", {
    version: 1,
    nextAccountID: 1,
    nextCharacterID: 140000001,
  });
  database.flushAllSync();

  const socket = buildHandshakeSocket();
  const handshake = new EVEHandshake(socket);
  const result = handshake._handleAuthentication([
    null,
    buildLoginDict(testUserName, passwordHashHex),
  ]);

  assert.deepEqual(result, { done: false });
  assert.equal(socket.ended, false);
  assert.equal(handshake.userName, testUserName);
  assert.equal(
    handshake.userId,
    orphanedAccountID + 1,
    "expected auto-created account IDs to stay above orphaned character ownership",
  );

  const accountsAfter = database.read("accounts", "/").data || {};
  assert.equal(accountsAfter[testUserName].id, orphanedAccountID + 1);
  assert.equal(accountsAfter[testUserName].passwordhash, passwordHashHex);
});

test("CreateCharacterWithDoll skips stale per-character state and does not inherit old mailbox contents", (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data || {});
  const originalIdentityState = cloneValue(database.read("identityState", "/").data || {});
  const originalItems = cloneValue(database.read("items", "/").data || {});
  const originalSkills = cloneValue(database.read("skills", "/").data || {});
  const originalMail = cloneValue(database.read("mail", "/").data || {});
  const originalNotifications = cloneValue(database.read("notifications", "/").data || {});
  const originalSkillPlans = cloneValue(database.read("skillPlans", "/").data || {});
  const originalBookmarkKnownFolders = cloneValue(
    database.read("bookmarkKnownFolders", "/").data || {},
  );

  t.after(() => {
    restoreTable("characters", originalCharacters);
    restoreTable("identityState", originalIdentityState);
    restoreTable("items", originalItems);
    restoreTable("skills", originalSkills);
    restoreTable("mail", originalMail);
    restoreTable("notifications", originalNotifications);
    restoreTable("skillPlans", originalSkillPlans);
    restoreTable("bookmarkKnownFolders", originalBookmarkKnownFolders);
    database.flushAllSync();
  });

  restoreTable("characters", {});
  restoreTable("identityState", {
    version: 1,
    nextAccountID: 1,
    nextCharacterID: 140000001,
  });
  restoreTable("items", {});
  restoreTable("skills", {});
  restoreTable("mail", buildEmptyMailState());
  restoreTable("notifications", buildEmptyNotificationsState());
  restoreTable("skillPlans", {
    140000011: {
      activePlanID: null,
      plans: {},
    },
  });
  restoreTable("bookmarkKnownFolders", {
    recordsByCharacterID: {
      140000012: {},
    },
  });
  database.flushAllSync();

  const charService = new CharService();
  const mailMgr = new MailMgrService();
  const accountSession = {
    userid: 910501,
    charid: null,
    characterID: null,
  };

  const newCharacterID = charService.Handle_CreateCharacterWithDoll(
    [
      "Identity Isolation Parity",
      1,
      1,
      1,
      1,
      { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [] } },
      { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [] } },
      11,
    ],
    accountSession,
  );

  assert.ok(
    newCharacterID >= 140000013,
    `expected new characters to skip stale mailbox / notification / plan references; got ${newCharacterID}`,
  );

  const mailbox = unwrapMarshalValue(
    mailMgr.Handle_SyncMail([null, 0], {
      userid: 910501,
      charid: newCharacterID,
      characterID: newCharacterID,
    }),
  );
  assert.equal(mailbox.newMail.length, 1);
  assert.equal(mailbox.newMail[0].title, "Welcome to EveJS Elysian");
  assert.equal(
    mailbox.newMail.some((mail) => mail.title === "Stale occupant mail"),
    false,
    "expected no stale mailbox inheritance on fresh character creation",
  );
});

test("auto-created accounts stay isolated across restart-style login and character creation", (t) => {
  const originalAccounts = cloneValue(database.read("accounts", "/").data || {});
  const originalCharacters = cloneValue(database.read("characters", "/").data || {});
  const originalIdentityState = cloneValue(database.read("identityState", "/").data || {});
  const originalItems = cloneValue(database.read("items", "/").data || {});
  const originalSkills = cloneValue(database.read("skills", "/").data || {});
  const originalMail = cloneValue(database.read("mail", "/").data || {});
  const originalNotifications = cloneValue(database.read("notifications", "/").data || {});
  const originalAutoCreate = config.devAutoCreateAccounts;
  const originalSkipValidation = config.devSkipPasswordValidation;

  t.after(() => {
    config.devAutoCreateAccounts = originalAutoCreate;
    config.devSkipPasswordValidation = originalSkipValidation;
    restoreTable("accounts", originalAccounts);
    restoreTable("characters", originalCharacters);
    restoreTable("identityState", originalIdentityState);
    restoreTable("items", originalItems);
    restoreTable("skills", originalSkills);
    restoreTable("mail", originalMail);
    restoreTable("notifications", originalNotifications);
    database.flushAllSync();
  });

  config.devAutoCreateAccounts = true;
  config.devSkipPasswordValidation = true;
  restoreTable("accounts", {});
  restoreTable("characters", {});
  restoreTable("identityState", {
    version: 1,
    nextAccountID: 1,
    nextCharacterID: 140000001,
  });
  restoreTable("items", {});
  restoreTable("skills", {});
  restoreTable("mail", {
    _meta: {
      nextMessageID: 1,
      nextMailingListID: 500000000,
    },
    messages: {},
    mailboxes: {},
    mailingLists: {},
  });
  restoreTable("notifications", {
    _meta: {
      nextNotificationID: 1,
    },
    boxes: {},
  });
  database.flushAllSync();

  function loginAutoCreated(username) {
    const socket = buildHandshakeSocket();
    const handshake = new EVEHandshake(socket);
    const result = handshake._handleAuthentication([
      null,
      buildLoginDict(username, "abcdefabcdefabcdefabcdefabcdefabcdefabcd"),
    ]);

    assert.deepEqual(result, { done: false });
    assert.equal(socket.ended, false);
    assert.equal(handshake.userName, username);
    assert.ok(Number(handshake.userId) > 0, "expected a real account ID");
    return handshake;
  }

  const firstLogin = loginAutoCreated("__isolation_restart_alpha__");
  const firstSession = {
    userid: firstLogin.userId,
    userName: firstLogin.userName,
    charid: null,
    characterID: null,
  };
  const firstCharService = new CharService();
  const firstCharacterID = firstCharService.Handle_CreateCharacterWithDoll(
    [
      "Isolation Restart Alpha",
      1,
      1,
      1,
      1,
      { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [] } },
      { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [] } },
      11,
    ],
    firstSession,
  );
  database.flushAllSync();

  const secondLogin = loginAutoCreated("__isolation_restart_beta__");
  const secondSession = {
    userid: secondLogin.userId,
    userName: secondLogin.userName,
    charid: null,
    characterID: null,
  };
  const secondCharService = new CharService();

  const secondSelectionBeforeCreate = unwrapMarshalValue(
    secondCharService.Handle_GetCharacterSelectionData([], secondSession),
  );
  assert.deepEqual(
    secondSelectionBeforeCreate[2].map((row) => row.characterName),
    [],
    "newly auto-created account must not inherit the first account's character",
  );
  assert.deepEqual(
    unwrapMarshalValue(secondCharService.Handle_GetCharactersToSelect([], secondSession)),
    [],
    "legacy character select path must also stay isolated",
  );
  assert.equal(
    secondCharService.Handle_GetCharacterToSelect([firstCharacterID], secondSession),
    null,
    "foreign character detail requests must not expose another account's character",
  );
  assert.throws(
    () => secondCharService.Handle_SelectCharacterID([firstCharacterID], secondSession),
    (error) =>
      error instanceof MachoWrappedException &&
      String(error.message || "").includes("Wrapped remote exception"),
    "foreign character selection must be rejected before session mutation",
  );

  const secondCharacterID = secondCharService.Handle_CreateCharacterWithDoll(
    [
      "Isolation Restart Beta",
      1,
      1,
      1,
      1,
      { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [] } },
      { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [] } },
      11,
    ],
    secondSession,
  );

  const finalFirstSelection = unwrapMarshalValue(
    secondCharService.Handle_GetCharacterSelectionData([], firstSession),
  );
  const finalSecondSelection = unwrapMarshalValue(
    secondCharService.Handle_GetCharacterSelectionData([], secondSession),
  );
  assert.deepEqual(
    finalFirstSelection[2].map((row) => row.characterID),
    [firstCharacterID],
  );
  assert.deepEqual(
    finalSecondSelection[2].map((row) => row.characterID),
    [secondCharacterID],
  );

  const mailMgr = new MailMgrService();
  const firstMailbox = unwrapMarshalValue(
    mailMgr.Handle_SyncMail([null, 0], {
      userid: firstSession.userid,
      charid: firstCharacterID,
      characterID: firstCharacterID,
    }),
  );
  const secondMailbox = unwrapMarshalValue(
    mailMgr.Handle_SyncMail([null, 0], {
      userid: secondSession.userid,
      charid: secondCharacterID,
      characterID: secondCharacterID,
    }),
  );

  assert.equal(
    firstMailbox.newMail.filter((mail) => mail.title === "Welcome to EveJS Elysian").length,
    1,
    "first character should have exactly one welcome mail",
  );
  assert.equal(
    secondMailbox.newMail.filter((mail) => mail.title === "Welcome to EveJS Elysian").length,
    1,
    "second character should have exactly one welcome mail",
  );
});

test("CreateCharacterWithDoll rejects invalid account sessions instead of silently assigning account 1", () => {
  const charService = new CharService();

  assert.throws(
    () =>
      charService.Handle_CreateCharacterWithDoll(
        ["Invalid Session Guard", 1, 1, 1, 1, null, null, 11],
        { userid: 0 },
      ),
    (error) =>
      error instanceof MachoWrappedException &&
      String(error.message || "").includes("Wrapped remote exception"),
  );
});
