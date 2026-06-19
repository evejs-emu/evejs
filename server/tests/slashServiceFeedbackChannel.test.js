const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const chatHub = require(path.join(
  repoRoot,
  "server/src/services/chat/chatHub",
));
const SlashService = require(path.join(
  repoRoot,
  "server/src/services/admin/slashService",
));
const MailMgrService = require(path.join(
  repoRoot,
  "server/src/services/mail/mailMgrService",
));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));
const { DEFAULT_MOTD_MESSAGE } = require(path.join(
  repoRoot,
  "server/src/services/chat/chatCommands",
));
const {
  unwrapMarshalValue,
} = require(path.join(
  repoRoot,
  "server/src/services/_shared/serviceHelpers",
));

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
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

function buildLiveSession(characterID, clientID = 1) {
  const notifications = [];
  const session = {
    userid: 1,
    charid: characterID,
    characterID,
    clientID,
    clientId: clientID,
    connectTime: Date.now(),
    lastActivity: Date.now(),
    socket: {
      destroyed: false,
    },
    sendNotification(notifyType, idType, payload) {
      notifications.push({ notifyType, idType, payload });
    },
  };
  return { session, notifications };
}

test("slash service routes slash feedback using channelID kwargs", () => {
  const sentMessages = [];
  const originalSendSystemMessage = chatHub.sendSystemMessage;
  chatHub.sendSystemMessage = (session, message, targetChannel) => {
    sentMessages.push({ session, message, targetChannel });
  };

  try {
    const session = {
      userid: 1,
      characterID: 140000001,
    };
    const service = new SlashService();

    const result = service.Handle_SlashCmd(
      ["/motd"],
      session,
      {
        type: "dict",
        entries: [["channelID", "corp_98000001"]],
      },
    );

    assert.equal(result, DEFAULT_MOTD_MESSAGE);
    assert.deepEqual(sentMessages, [
      {
        session,
        message: DEFAULT_MOTD_MESSAGE,
        targetChannel: "corp_98000001",
      },
    ]);
  } finally {
    chatHub.sendSystemMessage = originalSendSystemMessage;
  }
});

test("slash service /mailme sends a real live-notified Eve Mail and reports back in the requested channel", (t) => {
  const sentMessages = [];
  const originalMail = cloneValue(database.read("mail", "/").data);
  const originalNotifications = cloneValue(database.read("notifications", "/").data);
  const originalSendSystemMessage = chatHub.sendSystemMessage;
  chatHub.sendSystemMessage = (session, message, targetChannel) => {
    sentMessages.push({ session, message, targetChannel });
  };
  database.write("mail", "/", buildEmptyMailState());
  database.write("notifications", "/", buildEmptyNotificationsState());

  const { session: liveSession, notifications } = buildLiveSession(140000001, 401);
  sessionRegistry.register(liveSession);
  t.after(() => {
    sessionRegistry.unregister(liveSession);
  });

  try {
    const session = {
      userid: 1,
      characterID: 140000001,
      charid: 140000001,
    };
    const service = new SlashService();
    const result = service.Handle_SlashCmd(
      ["/mailme parity-check"],
      session,
      {
        type: "dict",
        entries: [["channelID", "local_30000142"]],
      },
    );

    assert.equal(
      result,
      'Live Eve Mail sent to your mailbox: "EveJS Elysian live mail test".',
    );
    assert.deepEqual(sentMessages, [
      {
        session,
        message: 'Live Eve Mail sent to your mailbox: "EveJS Elysian live mail test".',
        targetChannel: "local_30000142",
      },
    ]);

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].notifyType, "OnMailSent");
    assert.equal(notifications[0].payload[1], 140000004);
    assert.equal(notifications[0].payload[6], "EveJS Elysian live mail test");
    assert.equal(notifications[0].payload[7], 0);

    const mailMgr = new MailMgrService();
    const mailbox = unwrapMarshalValue(mailMgr.Handle_SyncMail([null, 0], session));
    assert.equal(mailbox.newMail.length, 1);
    assert.equal(mailbox.newMail[0].title, "EveJS Elysian live mail test");
    assert.equal(mailbox.newMail[0].senderID, 140000004);
  } finally {
    chatHub.sendSystemMessage = originalSendSystemMessage;
    database.write("mail", "/", originalMail);
    database.write("notifications", "/", originalNotifications);
  }
});
