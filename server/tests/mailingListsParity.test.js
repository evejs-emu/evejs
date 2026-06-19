const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const MailMgrService = require(path.join(
  repoRoot,
  "server/src/services/mail/mailMgrService",
));
const MailingListsMgrService = require(path.join(
  repoRoot,
  "server/src/services/mail/mailingListsMgrService",
));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
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

test("mailingListsMgr create/join/settings/members and join welcome mail follow client shapes", async (t) => {
  const originalMail = cloneValue(database.read("mail", "/").data);
  const originalNotifications = cloneValue(database.read("notifications", "/").data);
  t.after(() => {
    restoreDatabaseTable("mail", originalMail);
    restoreDatabaseTable("notifications", originalNotifications);
    database.flushAllSync();
  });

  restoreDatabaseTable("mail", buildEmptyMailState());
  restoreDatabaseTable("notifications", buildEmptyNotificationsState());

  const mailingListsMgr = new MailingListsMgrService();
  const mailMgr = new MailMgrService();
  const ownerSession = {
    userid: 1,
    charid: 140000004,
    characterID: 140000004,
  };
  const joinerBaseSession = {
    userid: 1,
    charid: 140000001,
    characterID: 140000001,
  };

  const listID = mailingListsMgr.Handle_Create(
    ["Parity Welcome List", 1, 1, 0],
    ownerSession,
  );
  assert.ok(Number(listID) > 0);

  mailingListsMgr.Handle_SaveWelcomeMail(
    [listID, "Welcome to the list", "Automated welcome body"],
    ownerSession,
  );
  const savedWelcome = unwrapMarshalValue(
    mailingListsMgr.Handle_GetWelcomeMail([listID], ownerSession),
  );
  assert.equal(savedWelcome.length, 1);
  assert.equal(savedWelcome[0].title, "Welcome to the list");
  assert.equal(savedWelcome[0].body, "Automated welcome body");

  const { session: joinerLiveSession, notifications } = buildLiveSession(140000001, 91);
  sessionRegistry.register(joinerLiveSession);
  t.after(() => {
    sessionRegistry.unregister(joinerLiveSession);
  });

  const joinedInfo = unwrapMarshalValue(
    mailingListsMgr.Handle_Join(["Parity Welcome List"], joinerBaseSession),
  );
  assert.equal(joinedInfo.id, listID);
  assert.equal(joinedInfo.displayName, "Parity Welcome List");
  assert.equal(joinedInfo.isOwner, false);
  assert.equal(joinedInfo.isOperator, false);
  assert.equal(joinedInfo.isMuted, false);

  const joinedLists = unwrapMarshalValue(
    mailingListsMgr.Handle_GetJoinedLists([], joinerBaseSession),
  );
  assert.equal(joinedLists[String(listID)].displayName, "Parity Welcome List");

  const members = unwrapMarshalValue(
    mailingListsMgr.Handle_GetMembers([listID], ownerSession),
  );
  assert.equal(members["140000004"], 3);
  assert.equal(members["140000001"], 1);

  const settings = unwrapMarshalValue(
    mailingListsMgr.Handle_GetSettings([listID], ownerSession),
  );
  assert.equal(settings.defaultAccess, 1);
  assert.equal(settings.defaultMemberAccess, 1);
  assert.deepEqual(settings.access, {});

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].notifyType, "OnMailSent");
  assert.equal(notifications[0].payload[1], listID);
  assert.equal(notifications[0].payload[4], listID);
  assert.equal(notifications[0].payload[6], "Welcome to the list");
  assert.equal(notifications[0].payload[7], 32);

  const joinerMailbox = unwrapMarshalValue(
    mailMgr.Handle_SyncMail([null, 0], joinerBaseSession),
  );
  assert.equal(joinerMailbox.newMail.length, 1);
  assert.equal(joinerMailbox.newMail[0].toListID, listID);
  assert.equal(joinerMailbox.newMail[0].toCharacterIDs, null);
  assert.equal(joinerMailbox.mailStatus[0].statusMask, 32);
});

test("mail sent to a mailing list notifies online members and keeps the sender copy as sent-only", async (t) => {
  const originalMail = cloneValue(database.read("mail", "/").data);
  const originalNotifications = cloneValue(database.read("notifications", "/").data);
  t.after(() => {
    restoreDatabaseTable("mail", originalMail);
    restoreDatabaseTable("notifications", originalNotifications);
    database.flushAllSync();
  });

  restoreDatabaseTable("mail", buildEmptyMailState());
  restoreDatabaseTable("notifications", buildEmptyNotificationsState());

  const mailingListsMgr = new MailingListsMgrService();
  const mailMgr = new MailMgrService();
  const ownerSession = {
    userid: 1,
    charid: 140000004,
    characterID: 140000004,
  };
  const recipientSession = {
    userid: 1,
    charid: 140000001,
    characterID: 140000001,
  };

  const listID = mailingListsMgr.Handle_Create(["Parity List Mail", 1, 1, 0], ownerSession);
  mailingListsMgr.Handle_Join(["Parity List Mail"], recipientSession);

  const { session: liveRecipient, notifications } = buildLiveSession(140000001, 92);
  sessionRegistry.register(liveRecipient);
  t.after(() => {
    sessionRegistry.unregister(liveRecipient);
  });

  const messageID = mailMgr.Handle_SendMail(
    [[], listID, null, "List parity", "Hello list", 0, 0],
    ownerSession,
  );
  assert.ok(Number(messageID) > 0);

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].notifyType, "OnMailSent");
  assert.deepEqual(notifications[0].payload[2], {
    type: "long",
    value: notifications[0].payload[2].value,
  });
  assert.deepEqual(notifications[0].payload[3], []);
  assert.equal(notifications[0].payload[4], listID);
  assert.equal(notifications[0].payload[6], "List parity");
  assert.equal(notifications[0].payload[7], 0);

  const recipientMailbox = unwrapMarshalValue(
    mailMgr.Handle_SyncMail([null, 0], recipientSession),
  );
  assert.equal(recipientMailbox.newMail.length, 1);
  assert.equal(recipientMailbox.newMail[0].toListID, listID);
  assert.equal(recipientMailbox.newMail[0].toCharacterIDs, null);
  assert.equal(recipientMailbox.mailStatus[0].labelMask, 0);

  const senderMailbox = unwrapMarshalValue(
    mailMgr.Handle_SyncMail([null, 0], ownerSession),
  );
  const senderStatus = senderMailbox.mailStatus.find(
    (status) => Number(status.messageID) === Number(messageID),
  );
  assert.ok(senderStatus);
  assert.equal(senderStatus.statusMask, 0);
  assert.equal(senderStatus.labelMask, 2);
});

test("mailMgr emits external live mailbox notifications for read, trash, restore, and delete", async (t) => {
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
  const primarySession = {
    userid: 1,
    charid: 140000001,
    characterID: 140000001,
  };

  const messageID = mailMgr.Handle_SendMail(
    [[140000001], null, null, "Live notify parity", "Hello", 0, 0],
    senderSession,
  );
  assert.ok(Number(messageID) > 0);

  const { session: mirrorSession, notifications } = buildLiveSession(140000001, 93);
  sessionRegistry.register(mirrorSession);
  t.after(() => {
    sessionRegistry.unregister(mirrorSession);
  });

  mailMgr.Handle_MarkAsRead([[messageID]], primarySession);
  assert.deepEqual(notifications.pop(), {
    notifyType: "OnMailUpdatedByExternal",
    idType: "clientID",
    payload: [[messageID], true, null],
  });

  mailMgr.Handle_MoveToTrash([[messageID]], primarySession);
  assert.deepEqual(notifications.pop(), {
    notifyType: "OnMailTrashed",
    idType: "clientID",
    payload: [[messageID]],
  });

  mailMgr.Handle_MoveFromTrash([[messageID]], primarySession);
  assert.deepEqual(notifications.pop(), {
    notifyType: "OnMailRestored",
    idType: "clientID",
    payload: [[messageID]],
  });

  mailMgr.Handle_DeleteMail([[messageID]], primarySession);
  assert.deepEqual(notifications.pop(), {
    notifyType: "OnMailDeleted",
    idType: "clientID",
    payload: [[messageID]],
  });
});

test("mailing list member role, kick, and delete flows send the expected live notifications", async (t) => {
  const originalMail = cloneValue(database.read("mail", "/").data);
  const originalNotifications = cloneValue(database.read("notifications", "/").data);
  t.after(() => {
    restoreDatabaseTable("mail", originalMail);
    restoreDatabaseTable("notifications", originalNotifications);
    database.flushAllSync();
  });

  restoreDatabaseTable("mail", buildEmptyMailState());
  restoreDatabaseTable("notifications", buildEmptyNotificationsState());

  const mailingListsMgr = new MailingListsMgrService();
  const ownerSession = {
    userid: 1,
    charid: 140000004,
    characterID: 140000004,
  };
  const memberSession = {
    userid: 1,
    charid: 140000001,
    characterID: 140000001,
  };

  const listID = mailingListsMgr.Handle_Create(["Parity Role List", 1, 1, 0], ownerSession);
  mailingListsMgr.Handle_Join(["Parity Role List"], memberSession);

  const { session: liveMember, notifications } = buildLiveSession(140000001, 94);
  sessionRegistry.register(liveMember);
  t.after(() => {
    sessionRegistry.unregister(liveMember);
  });

  mailingListsMgr.Handle_SetMembersMuted([listID, [140000001]], ownerSession);
  assert.deepEqual(notifications.pop(), {
    notifyType: "OnMailingListSetMuted",
    idType: "clientID",
    payload: [listID],
  });

  mailingListsMgr.Handle_SetMembersOperator([listID, [140000001]], ownerSession);
  assert.deepEqual(notifications.pop(), {
    notifyType: "OnMailingListSetOperator",
    idType: "clientID",
    payload: [listID],
  });

  mailingListsMgr.Handle_SetMembersClear([listID, [140000001]], ownerSession);
  assert.deepEqual(notifications.pop(), {
    notifyType: "OnMailingListSetClear",
    idType: "clientID",
    payload: [listID],
  });

  mailingListsMgr.Handle_KickMembers([listID, [140000001]], ownerSession);
  assert.deepEqual(notifications.pop(), {
    notifyType: "OnMailingListLeave",
    idType: "clientID",
    payload: [listID, 140000001],
  });

  mailingListsMgr.Handle_Join(["Parity Role List"], memberSession);
  notifications.length = 0;
  mailingListsMgr.Handle_Delete([listID], ownerSession);
  assert.deepEqual(notifications.pop(), {
    notifyType: "OnMailingListDeleted",
    idType: "clientID",
    payload: [listID],
  });
});
