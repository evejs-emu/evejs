const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const CharService = require(path.join(
  repoRoot,
  "server/src/services/character/charService",
));
const NotificationMgrService = require(path.join(
  repoRoot,
  "server/src/services/notifications/notificationMgrService",
));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));
const {
  marshalEncode,
} = require(path.join(
  repoRoot,
  "server/src/network/tcp/utils/marshal",
));
const {
  NOTIFICATION_GROUP,
  NOTIFICATION_TYPE,
} = require(path.join(
  repoRoot,
  "server/src/services/notifications/notificationConstants",
));
const {
  createNewMailNotification,
  createNotification,
} = require(path.join(
  repoRoot,
  "server/src/services/notifications/notificationState",
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

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function restoreDatabaseTable(table, snapshot) {
  database.write(table, "/", snapshot);
}

function buildEmptyNotificationsState() {
  return {
    _meta: {
      nextNotificationID: 1,
    },
    boxes: {},
  };
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

test("notificationMgr supports group listing, unread listing, fromID paging, and processed counts on parity", async (t) => {
  const originalNotifications = cloneValue(database.read("notifications", "/").data);

  t.after(() => {
    restoreDatabaseTable("notifications", originalNotifications);
    database.flushAllSync();
  });

  restoreDatabaseTable("notifications", buildEmptyNotificationsState());

  const characterID = 140000001;
  const session = {
    userid: 1,
    charid: characterID,
    characterID,
  };
  const notificationMgr = new NotificationMgrService();
  const charService = new CharService();

  const firstNotification = createNotification(characterID, {
    typeID: NOTIFICATION_TYPE.MAIL_SUMMARY,
    senderID: 140000004,
    groupID: NOTIFICATION_GROUP.MISC,
    processed: false,
    data: {
      subject: "Summary parity",
    },
    emitLive: false,
  });
  const secondNotification = createNewMailNotification(
    characterID,
    {
      senderID: 140000004,
      senderName: "GM ELYSIAN",
      subject: "Parity new mail notification",
      sentDate: "134179180470350000",
      msg: {
        messageID: 7001,
        senderID: 140000004,
        senderName: "GM ELYSIAN",
        sentDate: "134179180470350000",
        toCharacterIDs: [characterID],
        subject: "Parity new mail notification",
        statusMask: 0,
        labelMask: 0,
      },
    },
    { emitLive: false },
  );
  createNotification(characterID, {
    typeID: NOTIFICATION_TYPE.CONTACT_SIGNED_ON,
    senderID: 140000002,
    groupID: NOTIFICATION_GROUP.CONTACTS,
    processed: true,
    data: {
      level: 0,
      messageText: "Online",
    },
    emitLive: false,
  });

  const initialCharacterInfo = unwrapMarshalValue(
    charService.Handle_GetCharacterToSelect([characterID], session),
  );
  assert.equal(initialCharacterInfo.unprocessedNotifications, 2);

  const unreadNotifications = notificationMgr.Handle_GetUnprocessed([], session);
  assert.equal(unreadNotifications.length, 2);
  assert.doesNotThrow(() => marshalEncode(unreadNotifications));

  const miscNotifications = notificationMgr.Handle_GetByGroupID(
    [NOTIFICATION_GROUP.MISC],
    session,
  );
  assert.equal(miscNotifications.length, 2);

  const pagedNotifications = unwrapMarshalValue(
    notificationMgr.Handle_GetAllNotifications([], session, {
      type: "dict",
      entries: [["fromID", firstNotification.notificationID]],
    }),
  );
  assert.deepEqual(
    pagedNotifications.map((entry) => entry.notificationID),
    [3, 2],
  );

  notificationMgr.Handle_MarkAsProcessed([[firstNotification.notificationID]], session);
  assert.equal(notificationMgr.Handle_GetUnprocessed([], session).length, 1);

  notificationMgr.Handle_MarkGroupAsProcessed([NOTIFICATION_GROUP.MISC], session);
  assert.equal(notificationMgr.Handle_GetUnprocessed([], session).length, 0);

  const finalCharacterInfo = unwrapMarshalValue(
    charService.Handle_GetCharacterToSelect([characterID], session),
  );
  assert.equal(finalCharacterInfo.unprocessedNotifications, 0);
  assert.equal(
    unwrapMarshalValue(notificationMgr.Handle_GetByGroupID([NOTIFICATION_GROUP.MISC], session))[0].processed,
    true,
  );
  assert.equal(
    unwrapMarshalValue(notificationMgr.Handle_GetByGroupID([NOTIFICATION_GROUP.MISC], session))[1].processed,
    true,
  );
});

test("incoming Eve Mail creates a persistent notification without duplicating live OnNotificationReceived, and delete syncs to mirror sessions", async (t) => {
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
  const notificationMgr = new NotificationMgrService();
  const charService = new CharService();
  const senderSession = {
    userid: 1,
    charid: 140000004,
    characterID: 140000004,
  };
  const { session: liveRecipient, notifications: liveNotifications } =
    buildLiveSession(140000001, 501);
  sessionRegistry.register(liveRecipient);
  t.after(() => {
    sessionRegistry.unregister(liveRecipient);
  });

  const messageID = mailMgr.Handle_SendMail(
    [[140000001], null, null, "Notification parity mail", "Hello from parity", 0, 0],
    senderSession,
  );
  assert.ok(Number(messageID) > 0);

  assert.equal(liveNotifications.length, 1);
  assert.equal(liveNotifications[0].notifyType, "OnMailSent");

  const unreadNotifications = unwrapMarshalValue(
    notificationMgr.Handle_GetUnprocessed([], liveRecipient),
  );
  assert.equal(unreadNotifications.length, 1);
  assert.equal(unreadNotifications[0].typeID, NOTIFICATION_TYPE.NEW_MAIL_FROM);
  assert.equal(unreadNotifications[0].data.subject, "Notification parity mail");
  assert.equal(unreadNotifications[0].data.msg.messageID, Number(messageID));

  const characterInfo = unwrapMarshalValue(
    charService.Handle_GetCharacterToSelect([140000001], liveRecipient),
  );
  assert.equal(characterInfo.unprocessedNotifications, 1);

  const { session: mirrorSession, notifications: mirrorNotifications } =
    buildLiveSession(140000001, 502);
  sessionRegistry.register(mirrorSession);
  t.after(() => {
    sessionRegistry.unregister(mirrorSession);
  });

  notificationMgr.Handle_DeleteNotifications(
    [[unreadNotifications[0].notificationID]],
    liveRecipient,
  );

  assert.deepEqual(mirrorNotifications.pop(), {
    notifyType: "OnNotificationDeleted",
    idType: "clientID",
    payload: [[unreadNotifications[0].notificationID]],
  });
  assert.equal(notificationMgr.Handle_GetUnprocessed([], liveRecipient).length, 0);
});
