const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildDict,
  buildFiletimeLong,
  buildKeyVal,
  buildList,
  extractList,
  normalizeNumber,
  normalizeText,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  assignLabels,
  createCharacterLabel,
  deleteCharacterLabel,
  editCharacterLabel,
  emptyTrash,
  getCharacterLabels,
  getMessageByIDForCharacter,
  getCompressedBody,
  getMailHeaders,
  getSyncMailbox,
  markAllAsRead,
  markAllAsUnread,
  markAsRead,
  markAsReadByLabel,
  markAsReadByList,
  markAsUnread,
  markAsUnreadByLabel,
  markAsUnreadByList,
  moveAllFromTrash,
  moveAllToTrash,
  moveFromTrash,
  moveToTrash,
  moveToTrashByLabel,
  moveToTrashByList,
  pokePlayerAboutChatMsgGm,
  removeLabels,
  removeMessageStatuses,
  replaceLabels,
  sendMail,
} = require(path.join(__dirname, "./mailState"));
const {
  sendLabelsCreatedNotification,
  sendMailDeletedNotification,
  sendMailRestoredNotification,
  sendMailTrashedNotification,
  sendMailUpdatedNotification,
} = require(path.join(__dirname, "./mailNotifications"));

function resolveSessionCharacterID(session) {
  return Number(
    session &&
      (session.characterID || session.charID || session.charid || 0),
  ) || 0;
}

function normalizePositiveInteger(value, fallback = 0) {
  const numericValue = Math.trunc(normalizeNumber(value, fallback));
  return numericValue > 0 ? numericValue : fallback;
}

function buildMailHeaderRow(message) {
  const recipientIDs = Array.isArray(message.toCharacterIDs)
    ? message.toCharacterIDs
    : [];
  return buildKeyVal([
    ["messageID", normalizePositiveInteger(message.messageID, 0)],
    ["senderID", normalizePositiveInteger(message.senderID, 0)],
    [
      "toCharacterIDs",
      recipientIDs.length > 0 ? recipientIDs.join(",") : null,
    ],
    [
      "toListID",
      message.toListID == null ? null : normalizePositiveInteger(message.toListID, 0),
    ],
    [
      "toCorpOrAllianceID",
      message.toCorpOrAllianceID == null
        ? null
        : normalizePositiveInteger(message.toCorpOrAllianceID, 0),
    ],
    ["title", normalizeText(message.title, "")],
    ["sentDate", buildFiletimeLong(message.sentDate)],
  ]);
}

function buildMailStatusRow(status) {
  return buildKeyVal([
    ["messageID", normalizePositiveInteger(status.messageID, 0)],
    ["statusMask", Math.trunc(normalizeNumber(status.statusMask, 0))],
    ["labelMask", Math.trunc(normalizeNumber(status.labelMask, 0))],
  ]);
}

function buildMailboxPayload(mailbox) {
  return buildKeyVal([
    [
      "newMail",
      buildList((mailbox.newMail || []).map((message) => buildMailHeaderRow(message))),
    ],
    [
      "oldMail",
      buildList((mailbox.oldMail || []).map((message) => buildMailHeaderRow(message))),
    ],
    [
      "mailStatus",
      buildList((mailbox.mailStatus || []).map((status) => buildMailStatusRow(status))),
    ],
  ]);
}

function buildLabelKeyVal(labelID, label) {
  return buildKeyVal([
    ["labelID", normalizePositiveInteger(labelID, 0)],
    ["name", normalizeText(label && label.name, "")],
    ["color", Math.trunc(normalizeNumber(label && label.color, 0))],
  ]);
}

function groupMessageIDsByLabelMask(characterID, messageIDs) {
  const grouped = new Map();
  for (const messageID of extractList(messageIDs)) {
    const entry = getMessageByIDForCharacter(characterID, messageID);
    if (!entry || !entry.status) {
      continue;
    }
    const labelMask = Math.trunc(normalizeNumber(entry.status.labelMask, 0));
    if (!grouped.has(labelMask)) {
      grouped.set(labelMask, []);
    }
    grouped.get(labelMask).push(Number(messageID) || 0);
  }
  return grouped;
}

class MailMgrService extends BaseService {
  constructor() {
    super("mailMgr");
  }

  Handle_SyncMail(args, session) {
    const characterID = resolveSessionCharacterID(session);
    const firstID = args && args.length > 0 ? args[0] : null;
    const lastID = args && args.length > 1 ? args[1] : null;
    const mailbox = getSyncMailbox(characterID, firstID, lastID);
    log.debug(
      `[MailMgr] SyncMail(charID=${characterID}, firstID=${String(firstID)}, lastID=${String(lastID)}) -> headers=${mailbox.newMail.length + mailbox.oldMail.length} statuses=${mailbox.mailStatus.length}`,
    );
    return buildMailboxPayload(mailbox);
  }

  Handle_GetMailHeaders(args, session) {
    const characterID = resolveSessionCharacterID(session);
    const messageIDs = extractList(args && args[0]);
    const headers = getMailHeaders(characterID, messageIDs);
    return buildList(headers.map((message) => buildMailHeaderRow(message)));
  }

  Handle_GetBody(args, session) {
    const characterID = resolveSessionCharacterID(session);
    const messageID = normalizePositiveInteger(args && args[0], 0);
    const shouldMarkAsRead = Boolean(normalizeNumber(args && args[1], 0));
    const entryBefore = shouldMarkAsRead
      ? getMessageByIDForCharacter(characterID, messageID)
      : null;
    const compressedBody = getCompressedBody(characterID, messageID, {
      shouldMarkAsRead,
    });
    if (
      compressedBody &&
      entryBefore &&
      entryBefore.status &&
      (Math.trunc(normalizeNumber(entryBefore.status.statusMask, 0)) & 1) === 0
    ) {
      sendMailUpdatedNotification(
        characterID,
        [messageID],
        true,
        null,
        { excludeSession: session },
      );
    }
    return compressedBody;
  }

  Handle_MarkAsRead(args, session) {
    const characterID = resolveSessionCharacterID(session);
    const result = markAsRead(characterID, args && args[0]);
    if ((result.changedMessageIDs || []).length > 0) {
      sendMailUpdatedNotification(
        characterID,
        result.changedMessageIDs,
        true,
        null,
        { excludeSession: session },
      );
    }
    return null;
  }

  Handle_MarkAsUnread(args, session) {
    const characterID = resolveSessionCharacterID(session);
    const result = markAsUnread(characterID, args && args[0]);
    if ((result.changedMessageIDs || []).length > 0) {
      sendMailUpdatedNotification(
        characterID,
        result.changedMessageIDs,
        false,
        null,
        { excludeSession: session },
      );
    }
    return null;
  }

  Handle_MoveToTrash(args, session) {
    const characterID = resolveSessionCharacterID(session);
    const result = moveToTrash(characterID, args && args[0]);
    if ((result.changedMessageIDs || []).length > 0) {
      sendMailTrashedNotification(characterID, result.changedMessageIDs, {
        excludeSession: session,
      });
    }
    return null;
  }

  Handle_MoveFromTrash(args, session) {
    const characterID = resolveSessionCharacterID(session);
    const result = moveFromTrash(characterID, args && args[0]);
    if ((result.changedMessageIDs || []).length > 0) {
      sendMailRestoredNotification(characterID, result.changedMessageIDs, {
        excludeSession: session,
      });
    }
    return null;
  }

  Handle_MoveAllToTrash(args, session) {
    const characterID = resolveSessionCharacterID(session);
    const result = moveAllToTrash(characterID);
    if ((result.changedMessageIDs || []).length > 0) {
      sendMailTrashedNotification(characterID, result.changedMessageIDs, {
        excludeSession: session,
      });
    }
    return null;
  }

  Handle_MoveAllFromTrash(args, session) {
    const characterID = resolveSessionCharacterID(session);
    const result = moveAllFromTrash(characterID);
    if ((result.changedMessageIDs || []).length > 0) {
      sendMailRestoredNotification(characterID, result.changedMessageIDs, {
        excludeSession: session,
      });
    }
    return null;
  }

  Handle_MoveToTrashByLabel(args, session) {
    const characterID = resolveSessionCharacterID(session);
    const result = moveToTrashByLabel(characterID, args && args[0]);
    if ((result.changedMessageIDs || []).length > 0) {
      sendMailTrashedNotification(characterID, result.changedMessageIDs, {
        excludeSession: session,
      });
    }
    return null;
  }

  Handle_MoveToTrashByList(args, session) {
    const characterID = resolveSessionCharacterID(session);
    const result = moveToTrashByList(characterID, args && args[0]);
    if ((result.changedMessageIDs || []).length > 0) {
      sendMailTrashedNotification(characterID, result.changedMessageIDs, {
        excludeSession: session,
      });
    }
    return null;
  }

  Handle_MarkAllAsUnread(args, session) {
    const characterID = resolveSessionCharacterID(session);
    const result = markAllAsUnread(characterID);
    if ((result.changedMessageIDs || []).length > 0) {
      sendMailUpdatedNotification(
        characterID,
        result.changedMessageIDs,
        false,
        null,
        { excludeSession: session },
      );
    }
    return null;
  }

  Handle_MarkAsUnreadByLabel(args, session) {
    const characterID = resolveSessionCharacterID(session);
    const result = markAsUnreadByLabel(characterID, args && args[0]);
    if ((result.changedMessageIDs || []).length > 0) {
      sendMailUpdatedNotification(
        characterID,
        result.changedMessageIDs,
        false,
        null,
        { excludeSession: session },
      );
    }
    return null;
  }

  Handle_MarkAsUnreadByList(args, session) {
    const characterID = resolveSessionCharacterID(session);
    const result = markAsUnreadByList(characterID, args && args[0]);
    if ((result.changedMessageIDs || []).length > 0) {
      sendMailUpdatedNotification(
        characterID,
        result.changedMessageIDs,
        false,
        null,
        { excludeSession: session },
      );
    }
    return null;
  }

  Handle_MarkAllAsRead(args, session) {
    const characterID = resolveSessionCharacterID(session);
    const result = markAllAsRead(characterID);
    if ((result.changedMessageIDs || []).length > 0) {
      sendMailUpdatedNotification(
        characterID,
        result.changedMessageIDs,
        true,
        null,
        { excludeSession: session },
      );
    }
    return null;
  }

  Handle_MarkAsReadByLabel(args, session) {
    const characterID = resolveSessionCharacterID(session);
    const result = markAsReadByLabel(characterID, args && args[0]);
    if ((result.changedMessageIDs || []).length > 0) {
      sendMailUpdatedNotification(
        characterID,
        result.changedMessageIDs,
        true,
        null,
        { excludeSession: session },
      );
    }
    return null;
  }

  Handle_MarkAsReadByList(args, session) {
    const characterID = resolveSessionCharacterID(session);
    const result = markAsReadByList(characterID, args && args[0]);
    if ((result.changedMessageIDs || []).length > 0) {
      sendMailUpdatedNotification(
        characterID,
        result.changedMessageIDs,
        true,
        null,
        { excludeSession: session },
      );
    }
    return null;
  }

  Handle_EmptyTrash(args, session) {
    const characterID = resolveSessionCharacterID(session);
    const result = emptyTrash(characterID);
    if ((result.changedMessageIDs || []).length > 0) {
      sendMailDeletedNotification(characterID, result.changedMessageIDs, {
        excludeSession: session,
      });
    }
    return null;
  }

  Handle_DeleteMail(args, session) {
    const characterID = resolveSessionCharacterID(session);
    const result = removeMessageStatuses(characterID, args && args[0]);
    if ((result.changedMessageIDs || []).length > 0) {
      sendMailDeletedNotification(characterID, result.changedMessageIDs, {
        excludeSession: session,
      });
    }
    return null;
  }

  Handle_GetLabels(args, session) {
    const labels = getCharacterLabels(resolveSessionCharacterID(session));
    return buildDict(
      Object.entries(labels).map(([labelID, label]) => [
        Number(labelID),
        buildLabelKeyVal(labelID, label),
      ]),
    );
  }

  Handle_CreateLabel(args, session) {
    const characterID = resolveSessionCharacterID(session);
    const result = createCharacterLabel(
      characterID,
      args && args[0],
      args && args[1],
    );
    if (result.success) {
      const labels = getCharacterLabels(characterID);
      const createdLabel = labels[String(result.labelID)] || labels[result.labelID];
      if (createdLabel) {
        sendLabelsCreatedNotification(characterID, createdLabel, {
          excludeSession: session,
        });
      }
    }
    return result.success ? result.labelID : null;
  }

  Handle_EditLabel(args, session) {
    editCharacterLabel(resolveSessionCharacterID(session), args && args[0], {
      name: args && args.length > 1 ? args[1] : undefined,
      color: args && args.length > 2 ? args[2] : undefined,
    });
    return null;
  }

  Handle_DeleteLabel(args, session) {
    deleteCharacterLabel(resolveSessionCharacterID(session), args && args[0]);
    return null;
  }

  Handle_AssignLabels(args, session) {
    const characterID = resolveSessionCharacterID(session);
    const result = assignLabels(characterID, args && args[0], args && args[1]);
    for (const [labelMask, messageIDs] of groupMessageIDsByLabelMask(
      characterID,
      result.changedMessageIDs || [],
    )) {
      sendMailUpdatedNotification(characterID, messageIDs, null, labelMask, {
        excludeSession: session,
      });
    }
    return null;
  }

  Handle_RemoveLabels(args, session) {
    const characterID = resolveSessionCharacterID(session);
    const result = removeLabels(characterID, args && args[0], args && args[1]);
    for (const [labelMask, messageIDs] of groupMessageIDsByLabelMask(
      characterID,
      result.changedMessageIDs || [],
    )) {
      sendMailUpdatedNotification(characterID, messageIDs, null, labelMask, {
        excludeSession: session,
      });
    }
    return null;
  }

  Handle_ReplaceLabels(args, session) {
    const characterID = resolveSessionCharacterID(session);
    const result = replaceLabels(characterID, args && args[0], args && args[1]);
    for (const [labelMask, messageIDs] of groupMessageIDsByLabelMask(
      characterID,
      result.changedMessageIDs || [],
    )) {
      sendMailUpdatedNotification(characterID, messageIDs, null, labelMask, {
        excludeSession: session,
      });
    }
    return null;
  }

  Handle_SendMail(args, session) {
    const characterID = resolveSessionCharacterID(session);
    const result = sendMail({
      senderID: characterID,
      toCharacterIDs: args && args[0],
      toListID: args && args[1],
      toCorpOrAllianceID: args && args[2],
      title: args && args[3],
      body: args && args[4],
      isReplyTo: args && args[5],
      isForwardedFrom: args && args[6],
      saveSenderCopy: true,
      excludeSession: session,
    });
    return result.success ? result.messageID : null;
  }

  Handle_PokePlayerAboutChatMsgGm(args, session) {
    const characterID = normalizePositiveInteger(args && args[0], 0);
    const channelName = args && args.length > 1 ? args[1] : "";
    const result = pokePlayerAboutChatMsgGm(characterID, channelName);
    return result.success ? result.messageID || null : null;
  }
}

module.exports = MailMgrService;
