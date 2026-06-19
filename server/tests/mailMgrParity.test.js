const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const zlib = require("zlib");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
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
  sendCorporationWelcomeMailToCharacter: sendCorpWelcomeMail,
  sendWelcomeMailToCharacter,
} = require(path.join(
  repoRoot,
  "server/src/services/mail/mailState",
));

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function restoreDatabaseTable(table, snapshot) {
  database.write(table, "/", snapshot);
}

function buildEmptyMailState() {
  return {
    _meta: {
      nextMessageID: 1,
      nextMailingListID: 500000000,
    },
    messages: {},
    mailboxes: {},
    mailingLists: {},
  };
}

function buildEmptyNotificationsState() {
  return {
    _meta: {
      nextNotificationID: 1,
    },
    boxes: {},
  };
}

function buildCorporationsTable(records = {}) {
  return {
    _meta: {
      nextCustomCorporationID: 98000000,
      npcSeedVersion: 1,
    },
    records,
  };
}

test("CreateCharacterWithDoll sends a welcome EVE mail and unread count is derived from mail state", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  const originalSkills = cloneValue(database.read("skills", "/").data);
  const originalMail = cloneValue(database.read("mail", "/").data);
  const originalNotifications = cloneValue(database.read("notifications", "/").data);
  const originalIdentityState = cloneValue(database.read("identityState", "/").data);

  t.after(() => {
    restoreDatabaseTable("identityState", originalIdentityState);
    restoreDatabaseTable("characters", originalCharacters);
    restoreDatabaseTable("items", originalItems);
    restoreDatabaseTable("skills", originalSkills);
    restoreDatabaseTable("mail", originalMail);
    restoreDatabaseTable("notifications", originalNotifications);
    database.flushAllSync();
  });

  restoreDatabaseTable("mail", buildEmptyMailState());
  restoreDatabaseTable("notifications", buildEmptyNotificationsState());

  const charService = new CharService();
  const mailMgr = new MailMgrService();
  const accountSession = {
    userid: 950001,
    charid: null,
    characterID: null,
  };

  const newCharacterID = charService.Handle_CreateCharacterWithDoll(
    [
      "Mail Welcome Parity",
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

  const selectionBeforeRead = unwrapMarshalValue(
    charService.Handle_GetCharacterSelectionData([], accountSession),
  );
  const createdCharacterBeforeRead = selectionBeforeRead[2].find(
    (row) => Number(row.characterID) === Number(newCharacterID),
  );
  assert.ok(createdCharacterBeforeRead, "expected created character in selection payload");
  assert.equal(createdCharacterBeforeRead.unreadMailCount, 1);

  const inGameSession = {
    userid: accountSession.userid,
    charid: newCharacterID,
    characterID: newCharacterID,
  };
  const mailbox = unwrapMarshalValue(
    mailMgr.Handle_SyncMail([null, 0], inGameSession),
  );
  assert.equal(Array.isArray(mailbox.newMail), true);
  assert.equal(mailbox.newMail.length, 1);
  assert.equal(mailbox.mailStatus.length, 1);

  const welcomeMail = mailbox.newMail[0];
  assert.equal(welcomeMail.senderID, 140000004);
  assert.equal(welcomeMail.title, "Welcome to EveJS Elysian");

  const compressedBody = mailMgr.Handle_GetBody(
    [welcomeMail.messageID, true],
    inGameSession,
  );
  assert.ok(Buffer.isBuffer(compressedBody), "expected compressed mail body buffer");
  const body = zlib.inflateSync(compressedBody).toString("utf8");
  assert.match(body, /Welcome to EveJS Elysian/i);
  assert.match(body, /Discord linked on the EveJS Elysian GitHub/i);

  const selectionAfterRead = unwrapMarshalValue(
    charService.Handle_GetCharacterSelectionData([], accountSession),
  );
  const createdCharacterAfterRead = selectionAfterRead[2].find(
    (row) => Number(row.characterID) === Number(newCharacterID),
  );
  assert.ok(createdCharacterAfterRead, "expected created character after read");
  assert.equal(createdCharacterAfterRead.unreadMailCount, 0);
});

test("character welcome mail seeding is idempotent for retry-safe creation paths", (t) => {
  const originalMail = cloneValue(database.read("mail", "/").data);
  const originalNotifications = cloneValue(database.read("notifications", "/").data);

  t.after(() => {
    restoreDatabaseTable("mail", originalMail);
    restoreDatabaseTable("notifications", originalNotifications);
    database.flushAllSync();
  });

  restoreDatabaseTable("mail", buildEmptyMailState());
  restoreDatabaseTable("notifications", buildEmptyNotificationsState());

  const characterID = 140099001;
  const firstResult = sendWelcomeMailToCharacter(characterID, {
    characterName: "Welcome Idempotent",
  });
  const secondResult = sendWelcomeMailToCharacter(characterID, {
    characterName: "Welcome Idempotent",
  });
  const thirdResult = sendWelcomeMailToCharacter(characterID, {
    characterName: "Welcome Idempotent",
  });

  assert.equal(firstResult.success, true);
  assert.equal(secondResult.success, true);
  assert.equal(thirdResult.success, true);
  assert.equal(secondResult.alreadySent, true);
  assert.equal(thirdResult.alreadySent, true);
  assert.equal(secondResult.messageID, firstResult.messageID);
  assert.equal(thirdResult.messageID, firstResult.messageID);

  const mailState = database.read("mail", "/").data;
  const welcomeMessages = Object.values(mailState.messages || {}).filter(
    (message) =>
      message &&
      message.title === "Welcome to EveJS Elysian" &&
      Array.isArray(message.toCharacterIDs) &&
      message.toCharacterIDs.includes(characterID),
  );
  const mailbox = mailState.mailboxes[String(characterID)];

  assert.equal(welcomeMessages.length, 1);
  assert.equal(Object.keys((mailbox && mailbox.statuses) || {}).length, 1);
});

test("mailMgr SendMail gives the recipient an inbox copy and the sender a read sent copy", async (t) => {
  const originalMail = cloneValue(database.read("mail", "/").data);
  const originalNotifications = cloneValue(database.read("notifications", "/").data);

  t.after(() => {
    restoreDatabaseTable("mail", originalMail);
    restoreDatabaseTable("notifications", originalNotifications);
    database.flushAllSync();
  });

  restoreDatabaseTable("mail", buildEmptyMailState());
  restoreDatabaseTable("notifications", buildEmptyNotificationsState());

  const mailMgr = new MailMgrService();
  const senderSession = {
    userid: 1,
    charid: 140000004,
    characterID: 140000004,
  };
  const recipientSession = {
    userid: 1,
    charid: 140000001,
    characterID: 140000001,
  };

  const messageID = mailMgr.Handle_SendMail(
    [[140000001], null, null, "Parity Mail", "Hello from GM ELYSIAN", 0, 0],
    senderSession,
  );
  assert.ok(Number(messageID) > 0, "expected numeric message ID");

  const recipientMailbox = unwrapMarshalValue(
    mailMgr.Handle_SyncMail([null, 0], recipientSession),
  );
  assert.equal(recipientMailbox.newMail.length, 1);
  assert.equal(recipientMailbox.newMail[0].title, "Parity Mail");
  assert.equal(recipientMailbox.newMail[0].senderID, 140000004);
  assert.equal(recipientMailbox.mailStatus[0].statusMask & 1, 0);

  const senderMailbox = unwrapMarshalValue(
    mailMgr.Handle_SyncMail([null, 0], senderSession),
  );
  const senderCopy = senderMailbox.newMail.find(
    (mail) => Number(mail.messageID) === Number(messageID),
  );
  assert.ok(senderCopy, "expected sender copy in sent mailbox");
  const senderStatus = senderMailbox.mailStatus.find(
    (status) => Number(status.messageID) === Number(messageID),
  );
  assert.ok(senderStatus, "expected sender status row");
  assert.notEqual(senderStatus.statusMask & 1, 0, "expected sender copy to be read");
  assert.notEqual(senderStatus.labelMask & 2, 0, "expected sender copy to include sent label");
});

test("mailMgr MarkAsRead returns null and persists the read bit across a fresh mailbox sync", async (t) => {
  const originalMail = cloneValue(database.read("mail", "/").data);
  const originalNotifications = cloneValue(database.read("notifications", "/").data);

  t.after(() => {
    restoreDatabaseTable("mail", originalMail);
    restoreDatabaseTable("notifications", originalNotifications);
    database.flushAllSync();
  });

  restoreDatabaseTable("mail", buildEmptyMailState());
  restoreDatabaseTable("notifications", buildEmptyNotificationsState());

  const mailMgr = new MailMgrService();
  const senderSession = {
    userid: 1,
    charid: 140000004,
    characterID: 140000004,
  };
  const recipientSession = {
    userid: 1,
    charid: 140000001,
    characterID: 140000001,
  };

  const messageID = mailMgr.Handle_SendMail(
    [[140000001], null, null, "Read parity mail", "Hello from cache parity", 0, 0],
    senderSession,
  );
  assert.ok(Number(messageID) > 0, "expected numeric message ID");

  const markResult = mailMgr.Handle_MarkAsRead([[messageID]], recipientSession);
  assert.equal(markResult, null, "expected MarkAsRead to behave like a void remote call");

  const mailboxAfterRead = unwrapMarshalValue(
    mailMgr.Handle_SyncMail([null, 0], recipientSession),
  );
  const readStatus = mailboxAfterRead.mailStatus.find(
    (status) => Number(status.messageID) === Number(messageID),
  );
  assert.ok(readStatus, "expected recipient status row after read mutation");
  assert.notEqual(readStatus.statusMask & 1, 0, "expected read bit to persist in mailbox state");

  const freshMailMgr = new MailMgrService();
  const mailboxAfterFreshSync = unwrapMarshalValue(
    freshMailMgr.Handle_SyncMail([null, 0], recipientSession),
  );
  const readStatusAfterFreshSync = mailboxAfterFreshSync.mailStatus.find(
    (status) => Number(status.messageID) === Number(messageID),
  );
  assert.ok(readStatusAfterFreshSync, "expected recipient status row after fresh sync");
  assert.notEqual(
    readStatusAfterFreshSync.statusMask & 1,
    0,
    "expected read bit to survive a fresh sync the same way the client sees it on relog",
  );
});

test("corporation welcome mail sends an automated Eve Mail from the corporation when a welcome body exists", async (t) => {
  const originalMail = cloneValue(database.read("mail", "/").data);
  const originalCorporations = cloneValue(database.read("corporations", "/").data);
  const originalNotifications = cloneValue(database.read("notifications", "/").data);

  t.after(() => {
    restoreDatabaseTable("mail", originalMail);
    restoreDatabaseTable("corporations", originalCorporations);
    restoreDatabaseTable("notifications", originalNotifications);
    database.flushAllSync();
  });

  restoreDatabaseTable("mail", buildEmptyMailState());
  restoreDatabaseTable("notifications", buildEmptyNotificationsState());
  restoreDatabaseTable(
    "corporations",
    buildCorporationsTable({
      98009999: {
        corporationID: 98009999,
        corporationName: "Parity Welcome Corp",
        tickerName: "PWC",
        description: "",
        ceoID: 140000004,
        creatorID: 140000004,
        allianceID: null,
        stationID: 60003760,
        solarSystemID: 30000142,
        factionID: null,
        raceID: null,
        deleted: 0,
        shares: 1000,
        taxRate: 0,
        loyaltyPointTaxRate: 0,
        friendlyFire: 0,
        memberLimit: -1,
        url: "",
        hasPlayerPersonnelManager: true,
        isNPC: false,
        createdAt: "134179180470350000",
        shape1: 419,
        shape2: null,
        shape3: null,
        color1: null,
        color2: null,
        color3: null,
        typeface: null,
      },
    }),
  );

  const result = sendCorpWelcomeMail(140000001, 98009999, {
    body: "Welcome aboard, pilot.<br>Parity mail is live.",
  });
  assert.equal(result.success, true);

  const mailMgr = new MailMgrService();
  const recipientSession = {
    userid: 1,
    charid: 140000001,
    characterID: 140000001,
  };
  const mailbox = unwrapMarshalValue(
    mailMgr.Handle_SyncMail([null, 0], recipientSession),
  );
  assert.equal(mailbox.newMail.length, 1);
  assert.equal(mailbox.newMail[0].senderID, 98009999);
  assert.equal(mailbox.newMail[0].title, "Welcome to Parity Welcome Corp");
  assert.equal(mailbox.mailStatus[0].statusMask, 32);
});
