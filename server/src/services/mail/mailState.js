const path = require("path");
const zlib = require("zlib");

const database = require(path.join(__dirname, "../../newDatabase"));
const {
  extractList,
  normalizeNumber,
  normalizeText,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getCorporationRecord,
} = require(path.join(__dirname, "../corporation/corporationState"));
const {
  sendMailDeletedNotification,
  sendMailRestoredNotification,
  sendMailSentNotification,
  sendMailingListDeletedNotification,
  sendMailingListLeaveNotification,
  sendMailingListRoleClearNotification,
  sendMailingListRoleMutedNotification,
  sendMailingListRoleOperatorNotification,
} = require(path.join(__dirname, "./mailNotifications"));
const {
  createNewMailNotification,
} = require(path.join(__dirname, "../notifications/notificationState"));

const MAIL_TABLE = "mail";
const DEFAULT_WELCOME_SENDER_ID = 140000004;
const WELCOME_SENDER_NAME = "GM ELYSIAN";
const WELCOME_MAIL_TITLE = "Welcome to EveJS Elysian";

const MAIL_STATUS_MASK_READ = 1;
const MAIL_STATUS_MASK_REPLIED = 2;
const MAIL_STATUS_MASK_FORWARDED = 4;
const MAIL_STATUS_MASK_TRASHED = 8;
const MAIL_STATUS_MASK_DRAFT = 16;
const MAIL_STATUS_MASK_AUTOMATED = 32;

const MAIL_LABEL_INBOX = 1;
const MAIL_LABEL_SENT = 2;
const MAIL_LABEL_CORPORATION = 4;
const MAIL_LABEL_ALLIANCE = 8;
const MAIL_SYSTEM_LABEL_MASK =
  MAIL_LABEL_INBOX |
  MAIL_LABEL_SENT |
  MAIL_LABEL_CORPORATION |
  MAIL_LABEL_ALLIANCE;

const MAIL_MAX_RECIPIENTS = 50;
const MAIL_MAX_SUBJECT_SIZE = 150;
const MAIL_MAX_BODY_SIZE = 8000;
const MAIL_MAX_LABEL_SIZE = 40;
const MAIL_MAX_NUM_LABELS = 25;
const FIRST_CUSTOM_LABEL_MASK = 16;
const FIRST_MAILING_LIST_ID = 500000000;
const MAILING_LIST_MAX_MEMBERS = 3000;
const MAILING_LIST_MAX_MEMBERS_UPDATED = 1000;
const MAILING_LIST_MAX_NAME_SIZE = 60;
const MAILING_LIST_ACCESS_BLOCKED = 0;
const MAILING_LIST_ACCESS_ALLOWED = 1;
const MAILING_LIST_MEMBER_MUTED = 0;
const MAILING_LIST_MEMBER_DEFAULT = 1;
const MAILING_LIST_MEMBER_OPERATOR = 2;
const MAILING_LIST_MEMBER_OWNER = 3;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function currentFileTimeString() {
  return (BigInt(Date.now()) * 10000n + 116444736000000000n).toString();
}

function toPositiveInteger(value, fallback = 0) {
  const numericValue = Math.trunc(normalizeNumber(value, fallback));
  return numericValue > 0 ? numericValue : fallback;
}

function normalizeBody(value) {
  const text = normalizeText(value, "").trim();
  return text.length > MAIL_MAX_BODY_SIZE
    ? text.slice(0, MAIL_MAX_BODY_SIZE)
    : text;
}

function normalizeSubject(value) {
  const text = normalizeText(value, "").trim();
  return text.length > MAIL_MAX_SUBJECT_SIZE
    ? text.slice(0, MAIL_MAX_SUBJECT_SIZE)
    : text;
}

function normalizeMailLabelName(value) {
  const text = normalizeText(value, "").trim();
  return text.length > MAIL_MAX_LABEL_SIZE
    ? text.slice(0, MAIL_MAX_LABEL_SIZE)
    : text;
}

function normalizeMailingListNameComponents(value) {
  const rawText = normalizeText(value, "").trim();
  const boundedText = rawText.length > MAILING_LIST_MAX_NAME_SIZE
    ? rawText.slice(0, MAILING_LIST_MAX_NAME_SIZE)
    : rawText;
  const displayName = boundedText.replace(/\s+/g, " ").trim();
  const keySource = displayName.replace(/\s+/g, "");
  const key = keySource.split("\\").pop().toLocaleLowerCase("en-US");
  return {
    key,
    displayName,
  };
}

function normalizeMailingListAccess(value, fallback = MAILING_LIST_ACCESS_ALLOWED) {
  const numericValue = Math.trunc(normalizeNumber(value, fallback));
  return numericValue === MAILING_LIST_ACCESS_BLOCKED
    ? MAILING_LIST_ACCESS_BLOCKED
    : MAILING_LIST_ACCESS_ALLOWED;
}

function normalizeMailingListMemberAccess(
  value,
  fallback = MAILING_LIST_MEMBER_DEFAULT,
) {
  const numericValue = Math.trunc(normalizeNumber(value, fallback));
  if (numericValue === MAILING_LIST_MEMBER_MUTED) {
    return MAILING_LIST_MEMBER_MUTED;
  }
  if (numericValue === MAILING_LIST_MEMBER_OPERATOR) {
    return MAILING_LIST_MEMBER_OPERATOR;
  }
  if (numericValue === MAILING_LIST_MEMBER_OWNER) {
    return MAILING_LIST_MEMBER_OWNER;
  }
  return MAILING_LIST_MEMBER_DEFAULT;
}

function createDefaultState() {
  return {
    _meta: {
      nextMessageID: 1,
      nextMailingListID: FIRST_MAILING_LIST_ID,
    },
    messages: {},
    mailboxes: {},
    mailingLists: {},
  };
}

function getCharactersTable() {
  const result = database.read("characters", "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }
  return result.data;
}

function resolveCharacterName(characterID) {
  const characters = getCharactersTable();
  const record = characters[String(characterID)];
  return record && record.characterName
    ? String(record.characterName)
    : `Character ${characterID}`;
}

function resolveWelcomeSenderID() {
  const characters = getCharactersTable();
  if (characters[String(DEFAULT_WELCOME_SENDER_ID)]) {
    return DEFAULT_WELCOME_SENDER_ID;
  }

  for (const [characterID, record] of Object.entries(characters)) {
    if (
      record &&
      typeof record === "object" &&
      normalizeText(record.characterName, "") === WELCOME_SENDER_NAME
    ) {
      return Number(characterID) || DEFAULT_WELCOME_SENDER_ID;
    }
  }

  return DEFAULT_WELCOME_SENDER_ID;
}

function buildWelcomeMailBody(characterName) {
  const resolvedName = normalizeText(characterName, "pilot").trim() || "pilot";
  return [
    `${WELCOME_MAIL_TITLE}, ${resolvedName}.`,
    "",
    "You are stepping into a live, evolving open-source New Eden. A surprising amount already works, and a surprising amount still bites back, so expect rough edges, unfinished systems, and the occasional spectacular bug.",
    "",
    "A few good habits will help a lot:",
    "- If something feels wrong, trust that instinct.",
    "- If you find a bug, report it through the Discord linked on the EveJS Elysian GitHub.",
    "- If you report it, include the exact steps so we can reproduce it fast.",
    "",
    "Enjoy the cluster, push it hard, and let us know what breaks.",
    "",
    "GM ELYSIAN",
  ].join("<br>");
}

function findExistingCharacterWelcomeMail(state, characterID, senderID) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  const numericSenderID = toPositiveInteger(senderID, 0);
  if (numericCharacterID <= 0 || numericSenderID <= 0) {
    return null;
  }

  const mailbox = state.mailboxes && state.mailboxes[String(numericCharacterID)];
  const statuses = mailbox && mailbox.statuses;
  if (!statuses || typeof statuses !== "object") {
    return null;
  }

  for (const messageID of Object.keys(statuses)) {
    const message = state.messages && state.messages[String(messageID)];
    if (!message || typeof message !== "object") {
      continue;
    }
    const recipientIDs = Array.isArray(message.toCharacterIDs)
      ? message.toCharacterIDs
      : [];
    const isRecipient = recipientIDs.some(
      (entry) => toPositiveInteger(entry, 0) === numericCharacterID,
    );
    if (
      isRecipient &&
      toPositiveInteger(message.senderID, 0) === numericSenderID &&
      normalizeSubject(message.title) === WELCOME_MAIL_TITLE
    ) {
      return {
        messageID: toPositiveInteger(message.messageID, Number(messageID) || 0),
        sentDate: normalizeText(message.sentDate, ""),
        recipients: [numericCharacterID],
      };
    }
  }

  return null;
}

function getMutableState() {
  const result = database.read(MAIL_TABLE, "/");
  let state =
    result.success && result.data && typeof result.data === "object"
      ? result.data
      : null;

  if (!state) {
    state = createDefaultState();
    database.write(MAIL_TABLE, "/", state);
    return state;
  }

  let mutated = false;
  if (!state._meta || typeof state._meta !== "object") {
    state._meta = { nextMessageID: 1 };
    mutated = true;
  }
  const nextMessageID = toPositiveInteger(state._meta.nextMessageID, 1);
  if (nextMessageID !== state._meta.nextMessageID) {
    state._meta.nextMessageID = nextMessageID;
    mutated = true;
  }
  const nextMailingListID = toPositiveInteger(
    state._meta.nextMailingListID,
    FIRST_MAILING_LIST_ID,
  );
  if (nextMailingListID !== state._meta.nextMailingListID) {
    state._meta.nextMailingListID = nextMailingListID;
    mutated = true;
  }
  if (!state.messages || typeof state.messages !== "object") {
    state.messages = {};
    mutated = true;
  }
  if (!state.mailboxes || typeof state.mailboxes !== "object") {
    state.mailboxes = {};
    mutated = true;
  }
  if (!state.mailingLists || typeof state.mailingLists !== "object") {
    state.mailingLists = {};
    mutated = true;
  }
  for (const [listID, record] of Object.entries(state.mailingLists)) {
    const before = JSON.stringify(record);
    const normalizedRecord = ensureMailingListShape(record, listID);
    if (!normalizedRecord) {
      delete state.mailingLists[listID];
      mutated = true;
      continue;
    }
    if (JSON.stringify(normalizedRecord) !== before) {
      mutated = true;
    }
    if (String(normalizedRecord.listID) !== String(listID)) {
      delete state.mailingLists[listID];
      state.mailingLists[String(normalizedRecord.listID)] = normalizedRecord;
      mutated = true;
    }
  }

  if (mutated) {
    database.write(MAIL_TABLE, "/", state);
  }
  return state;
}

function resolveCharacterCorporationID(characterID) {
  const characters = getCharactersTable();
  const record = characters[String(characterID)];
  return toPositiveInteger(record && record.corporationID, 0);
}

function resolveCharacterAllianceID(characterID) {
  const characters = getCharactersTable();
  const record = characters[String(characterID)];
  return toPositiveInteger(record && record.allianceID, 0);
}

function getMailingListRecord(state, listID) {
  if (!state || !state.mailingLists) {
    return null;
  }
  const record = state.mailingLists[String(listID)];
  return record && typeof record === "object" ? record : null;
}

function ensureMailingListShape(record, listID) {
  if (!record || typeof record !== "object") {
    return null;
  }

  const normalizedListID = toPositiveInteger(record.listID || listID, 0);
  const nameParts = normalizeMailingListNameComponents(
    record.displayName || record.name || "",
  );
  record.listID = normalizedListID;
  record.name = nameParts.key || normalizeText(record.name, "");
  record.displayName = nameParts.displayName || normalizeText(record.displayName, "");
  record.ownerID = toPositiveInteger(record.ownerID, 0);
  record.defaultAccess = normalizeMailingListAccess(record.defaultAccess);
  record.defaultMemberAccess = normalizeMailingListMemberAccess(
    record.defaultMemberAccess,
  );
  record.cost = Math.max(0, Math.trunc(normalizeNumber(record.cost, 0)));
  record.createdAt = normalizeText(record.createdAt, "") || currentFileTimeString();
  record.updatedAt = normalizeText(record.updatedAt, "") || record.createdAt;
  record.deleted = record.deleted === true;
  if (!record.access || typeof record.access !== "object") {
    record.access = {};
  }
  if (!record.members || typeof record.members !== "object") {
    record.members = {};
  }
  if (!record.welcomeMail || typeof record.welcomeMail !== "object") {
    record.welcomeMail = null;
  } else {
    record.welcomeMail = {
      title: normalizeSubject(record.welcomeMail.title),
      body: normalizeBody(record.welcomeMail.body),
      savedAt: normalizeText(record.welcomeMail.savedAt, "") || currentFileTimeString(),
    };
  }

  for (const [entityID, accessLevel] of Object.entries(record.access)) {
    const numericEntityID = toPositiveInteger(entityID, 0);
    if (numericEntityID <= 0) {
      delete record.access[entityID];
      continue;
    }
    delete record.access[entityID];
    record.access[String(numericEntityID)] = normalizeMailingListAccess(accessLevel);
  }

  for (const [characterID, memberAccess] of Object.entries(record.members)) {
    const numericCharacterID = toPositiveInteger(characterID, 0);
    if (numericCharacterID <= 0) {
      delete record.members[characterID];
      continue;
    }
    delete record.members[characterID];
    record.members[String(numericCharacterID)] = normalizeMailingListMemberAccess(
      memberAccess,
    );
  }

  if (record.ownerID > 0) {
    record.members[String(record.ownerID)] = MAILING_LIST_MEMBER_OWNER;
  }

  return record;
}

function getAllMailingLists(state) {
  const lists = [];
  for (const [listID, record] of Object.entries(state.mailingLists || {})) {
    const normalizedRecord = ensureMailingListShape(record, listID);
    if (normalizedRecord) {
      lists.push(normalizedRecord);
    }
  }
  return lists;
}

function allocateMailingListID(state) {
  const nextMailingListID = toPositiveInteger(
    state &&
      state._meta &&
      state._meta.nextMailingListID,
    FIRST_MAILING_LIST_ID,
  );
  state._meta.nextMailingListID = nextMailingListID + 1;
  return nextMailingListID;
}

function resolveMailingListByNameOrID(state, nameOrID) {
  const numericListID = toPositiveInteger(nameOrID, 0);
  if (numericListID > 0) {
    return getMailingListRecord(state, numericListID);
  }

  const { key } = normalizeMailingListNameComponents(nameOrID);
  if (!key) {
    return null;
  }
  return (
    getAllMailingLists(state).find(
      (record) => record.deleted !== true && record.name === key,
    ) || null
  );
}

function getMailingListMemberAccess(record, characterID) {
  if (!record || !record.members) {
    return null;
  }
  const key = String(toPositiveInteger(characterID, 0));
  if (!key || key === "0") {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(record.members, key)) {
    return null;
  }
  return normalizeMailingListMemberAccess(record.members[key]);
}

function canConfigureMailingList(record, characterID) {
  const memberAccess = getMailingListMemberAccess(record, characterID);
  return memberAccess === MAILING_LIST_MEMBER_OWNER ||
    memberAccess === MAILING_LIST_MEMBER_OPERATOR;
}

function canManageMailingListTarget(record, actorCharacterID, targetCharacterID) {
  const actorAccess = getMailingListMemberAccess(record, actorCharacterID);
  const targetAccess = getMailingListMemberAccess(record, targetCharacterID);
  if (
    actorAccess !== MAILING_LIST_MEMBER_OWNER &&
    actorAccess !== MAILING_LIST_MEMBER_OPERATOR
  ) {
    return false;
  }
  if (targetAccess === MAILING_LIST_MEMBER_OWNER) {
    return false;
  }
  if (
    actorAccess === MAILING_LIST_MEMBER_OPERATOR &&
    targetAccess === MAILING_LIST_MEMBER_OPERATOR
  ) {
    return false;
  }
  return true;
}

function resolveMailingListJoinAccess(record, characterID) {
  if (!record || record.deleted === true) {
    return MAILING_LIST_ACCESS_BLOCKED;
  }
  if (getMailingListMemberAccess(record, characterID) != null) {
    return MAILING_LIST_ACCESS_ALLOWED;
  }

  const access = record.access || {};
  const corporationID = resolveCharacterCorporationID(characterID);
  const allianceID = resolveCharacterAllianceID(characterID);
  const explicitLevels = [
    access[String(toPositiveInteger(characterID, 0))],
    corporationID > 0 ? access[String(corporationID)] : undefined,
    allianceID > 0 ? access[String(allianceID)] : undefined,
  ]
    .filter((entry) => entry !== undefined)
    .map((entry) => normalizeMailingListAccess(entry));

  if (explicitLevels.includes(MAILING_LIST_ACCESS_BLOCKED)) {
    return MAILING_LIST_ACCESS_BLOCKED;
  }
  if (explicitLevels.includes(MAILING_LIST_ACCESS_ALLOWED)) {
    return MAILING_LIST_ACCESS_ALLOWED;
  }
  return normalizeMailingListAccess(record.defaultAccess);
}

function buildMailingListSummary(record, characterID) {
  const memberAccess = getMailingListMemberAccess(record, characterID);
  return {
    id: toPositiveInteger(record && record.listID, 0),
    name: normalizeText(record && record.name, ""),
    displayName: normalizeText(record && record.displayName, ""),
    isMuted: memberAccess === MAILING_LIST_MEMBER_MUTED,
    isOperator: memberAccess === MAILING_LIST_MEMBER_OPERATOR,
    isOwner: memberAccess === MAILING_LIST_MEMBER_OWNER,
  };
}

function persistState(state) {
  return database.write(MAIL_TABLE, "/", state);
}

function ensureMailbox(state, characterID) {
  const key = String(characterID);
  if (!state.mailboxes[key] || typeof state.mailboxes[key] !== "object") {
    state.mailboxes[key] = {
      statuses: {},
      labels: {},
      _meta: {
        nextLabelMask: FIRST_CUSTOM_LABEL_MASK,
      },
    };
  }

  const mailbox = state.mailboxes[key];
  if (!mailbox.statuses || typeof mailbox.statuses !== "object") {
    mailbox.statuses = {};
  }
  if (!mailbox.labels || typeof mailbox.labels !== "object") {
    mailbox.labels = {};
  }
  if (!mailbox._meta || typeof mailbox._meta !== "object") {
    mailbox._meta = {
      nextLabelMask: FIRST_CUSTOM_LABEL_MASK,
    };
  }
  mailbox._meta.nextLabelMask = toPositiveInteger(
    mailbox._meta.nextLabelMask,
    FIRST_CUSTOM_LABEL_MASK,
  );

  return mailbox;
}

function allocateMessageID(state) {
  const nextMessageID = toPositiveInteger(state._meta.nextMessageID, 1);
  state._meta.nextMessageID = nextMessageID + 1;
  return nextMessageID;
}

function normalizePositiveIDList(input, options = {}) {
  const maxItems = Number.isFinite(options.maxItems)
    ? Math.max(0, Math.trunc(options.maxItems))
    : Number.POSITIVE_INFINITY;
  const normalized = [...new Set(
    extractList(input)
      .map((entry) => toPositiveInteger(entry, 0))
      .filter((entry) => entry > 0),
  )];
  return Number.isFinite(maxItems)
    ? normalized.slice(0, maxItems)
    : normalized;
}

function normalizeCharacterRecipientIDs(input) {
  return normalizePositiveIDList(input, {
    maxItems: MAIL_MAX_RECIPIENTS,
  });
}

function resolveGroupRecipients(toCorpOrAllianceID) {
  const targetID = toPositiveInteger(toCorpOrAllianceID, 0);
  if (targetID <= 0) {
    return [];
  }

  const recipients = [];
  const characters = getCharactersTable();
  for (const [characterID, record] of Object.entries(characters)) {
    if (!record || typeof record !== "object") {
      continue;
    }
    const corporationID = toPositiveInteger(record.corporationID, 0);
    const allianceID = toPositiveInteger(record.allianceID, 0);
    if (corporationID === targetID || allianceID === targetID) {
      recipients.push(Number(characterID));
    }
  }

  return [...new Set(recipients)];
}

function resolveMailingListRecipients(state, listID, senderID, saveSenderCopy) {
  const numericListID = toPositiveInteger(listID, 0);
  if (numericListID <= 0) {
    return { success: true, recipients: [] };
  }

  const record = getMailingListRecord(state, numericListID);
  if (!record || record.deleted === true) {
    return { success: false, errorMsg: "MAILING_LIST_NOT_FOUND" };
  }

  if (
    senderID > 0 &&
    senderID !== numericListID &&
    getMailingListMemberAccess(record, senderID) == null
  ) {
    return { success: false, errorMsg: "NOT_IN_MAILING_LIST" };
  }

  if (
    senderID > 0 &&
    senderID !== numericListID &&
    getMailingListMemberAccess(record, senderID) === MAILING_LIST_MEMBER_MUTED
  ) {
    return { success: false, errorMsg: "MAILING_LIST_MUTED" };
  }

  const recipients = Object.keys(record.members || {})
    .map((characterID) => toPositiveInteger(characterID, 0))
    .filter((characterID) => characterID > 0)
    .filter(
      (characterID) => !(saveSenderCopy && senderID > 0 && characterID === senderID),
    );

  return {
    success: true,
    recipients: [...new Set(recipients)].sort((left, right) => left - right),
  };
}

function buildDeliveryRecipients(
  state,
  explicitCharacterIDs,
  toCorpOrAllianceID,
  toListID,
  senderID,
  saveSenderCopy,
  overrideRecipients = null,
) {
  if (overrideRecipients != null) {
    return {
      success: true,
      recipients: normalizePositiveIDList(overrideRecipients, {
        maxItems: MAILING_LIST_MAX_MEMBERS,
      }).sort((left, right) => left - right),
    };
  }

  const recipients = new Set(explicitCharacterIDs);
  for (const characterID of resolveGroupRecipients(toCorpOrAllianceID)) {
    if (saveSenderCopy && senderID > 0 && characterID === senderID) {
      continue;
    }
    recipients.add(characterID);
  }

  if (toPositiveInteger(toListID, 0) > 0) {
    const listRecipients = resolveMailingListRecipients(
      state,
      toListID,
      senderID,
      saveSenderCopy,
    );
    if (!listRecipients.success) {
      return listRecipients;
    }
    for (const characterID of listRecipients.recipients) {
      recipients.add(characterID);
    }
  }

  return {
    success: true,
    recipients: [...recipients].sort((left, right) => left - right),
  };
}

function computeStaticLabelMask(message, characterID, options = {}) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  if (numericCharacterID <= 0) {
    return 0;
  }

  let labelMask = 0;
  if (options.isSenderCopy) {
    labelMask |= MAIL_LABEL_SENT;
  }

  const recipientIDs = Array.isArray(message.toCharacterIDs)
    ? message.toCharacterIDs
    : [];
  if (recipientIDs.includes(numericCharacterID)) {
    labelMask |= MAIL_LABEL_INBOX;
  }

  const groupID = toPositiveInteger(message.toCorpOrAllianceID, 0);
  if (groupID > 0) {
    const characters = getCharactersTable();
    const record = characters[String(numericCharacterID)] || null;
    const corporationID = toPositiveInteger(record && record.corporationID, 0);
    const allianceID = toPositiveInteger(record && record.allianceID, 0);
    if (corporationID === groupID) {
      labelMask |= MAIL_LABEL_CORPORATION;
    } else if (allianceID === groupID) {
      labelMask |= MAIL_LABEL_ALLIANCE;
    }
  }

  return labelMask;
}

function ensureStatusEntry(state, characterID, messageID, options = {}) {
  const mailbox = ensureMailbox(state, characterID);
  const key = String(messageID);
  const message = state.messages[key];
  if (!message) {
    return null;
  }

  const existing = mailbox.statuses[key] || {
    messageID,
    statusMask: 0,
    labelMask: 0,
  };
  const staticLabelMask = computeStaticLabelMask(message, characterID, {
    isSenderCopy: Boolean(options.isSenderCopy),
  });

  existing.messageID = messageID;
  existing.statusMask = Math.trunc(normalizeNumber(existing.statusMask, 0));
  existing.labelMask = Math.trunc(normalizeNumber(existing.labelMask, 0));
  existing.labelMask |= staticLabelMask;

  if (options.read === true) {
    existing.statusMask |= MAIL_STATUS_MASK_READ;
  }
  if (options.read === false) {
    existing.statusMask &= ~MAIL_STATUS_MASK_READ;
  }
  if (options.trashed === true) {
    existing.statusMask |= MAIL_STATUS_MASK_TRASHED;
  }
  if (options.trashed === false) {
    existing.statusMask &= ~MAIL_STATUS_MASK_TRASHED;
  }

  mailbox.statuses[key] = existing;
  return existing;
}

function pruneMessageIfOrphaned(state, messageID) {
  const key = String(messageID);
  for (const mailbox of Object.values(state.mailboxes || {})) {
    if (
      mailbox &&
      mailbox.statuses &&
      Object.prototype.hasOwnProperty.call(mailbox.statuses, key)
    ) {
      return;
    }
  }
  delete state.messages[key];
}

function getMailboxEntries(characterID, options = {}) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  if (numericCharacterID <= 0) {
    return [];
  }

  const state = getMutableState();
  const mailbox = ensureMailbox(state, numericCharacterID);
  const includeTrashed = Boolean(options.includeTrashed);
  const entries = [];

  for (const [messageID, status] of Object.entries(mailbox.statuses)) {
    const message = state.messages[messageID];
    if (!message) {
      continue;
    }
    const statusMask = Math.trunc(normalizeNumber(status.statusMask, 0));
    if (!includeTrashed && (statusMask & MAIL_STATUS_MASK_TRASHED) !== 0) {
      continue;
    }
    entries.push({
      message: cloneValue(message),
      status: cloneValue(status),
    });
  }

  entries.sort((left, right) => {
    const leftSent = BigInt(String(left.message.sentDate || "0"));
    const rightSent = BigInt(String(right.message.sentDate || "0"));
    if (leftSent === rightSent) {
      return right.message.messageID - left.message.messageID;
    }
    return leftSent > rightSent ? -1 : 1;
  });
  return entries;
}

function getUnreadMailCount(characterID) {
  return getMailboxEntries(characterID).filter(
    ({ status }) =>
      (Math.trunc(normalizeNumber(status.statusMask, 0)) &
        MAIL_STATUS_MASK_READ) ===
      0,
  ).length;
}

function getMessageByIDForCharacter(characterID, messageID) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  const numericMessageID = toPositiveInteger(messageID, 0);
  if (numericCharacterID <= 0 || numericMessageID <= 0) {
    return null;
  }

  const state = getMutableState();
  const mailbox = ensureMailbox(state, numericCharacterID);
  const status = mailbox.statuses[String(numericMessageID)] || null;
  const message = state.messages[String(numericMessageID)] || null;
  if (!status || !message) {
    return null;
  }

  return {
    message: cloneValue(message),
    status: cloneValue(status),
  };
}

function getCharacterLabels(characterID) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  if (numericCharacterID <= 0) {
    return {};
  }
  const state = getMutableState();
  const mailbox = ensureMailbox(state, numericCharacterID);
  return cloneValue(mailbox.labels || {});
}

function allocateNextLabelMask(mailbox) {
  let candidate = toPositiveInteger(
    mailbox &&
      mailbox._meta &&
      mailbox._meta.nextLabelMask,
    FIRST_CUSTOM_LABEL_MASK,
  );
  if (candidate < FIRST_CUSTOM_LABEL_MASK) {
    candidate = FIRST_CUSTOM_LABEL_MASK;
  }

  while (mailbox.labels[String(candidate)]) {
    candidate *= 2;
  }
  mailbox._meta.nextLabelMask = candidate * 2;
  return candidate;
}

function createCharacterLabel(characterID, name, color = 0) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  const normalizedName = normalizeMailLabelName(name);
  if (numericCharacterID <= 0 || !normalizedName) {
    return { success: false, errorMsg: "INVALID_LABEL" };
  }

  const state = getMutableState();
  const mailbox = ensureMailbox(state, numericCharacterID);
  if (Object.keys(mailbox.labels).length >= MAIL_MAX_NUM_LABELS) {
    return { success: false, errorMsg: "LABEL_LIMIT_REACHED" };
  }

  const labelID = allocateNextLabelMask(mailbox);
  mailbox.labels[String(labelID)] = {
    labelID,
    name: normalizedName,
    color: Math.max(0, Math.trunc(normalizeNumber(color, 0))),
  };
  persistState(state);
  return { success: true, labelID };
}

function editCharacterLabel(characterID, labelID, nextValues = {}) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  const numericLabelID = toPositiveInteger(labelID, 0);
  if (numericCharacterID <= 0 || numericLabelID <= 0) {
    return { success: false, errorMsg: "INVALID_LABEL" };
  }

  const state = getMutableState();
  const mailbox = ensureMailbox(state, numericCharacterID);
  if (!mailbox.labels[String(numericLabelID)]) {
    return { success: false, errorMsg: "LABEL_NOT_FOUND" };
  }

  const label = mailbox.labels[String(numericLabelID)];
  if (Object.prototype.hasOwnProperty.call(nextValues, "name")) {
    const nextName = normalizeMailLabelName(nextValues.name);
    if (nextName) {
      label.name = nextName;
    }
  }
  if (Object.prototype.hasOwnProperty.call(nextValues, "color")) {
    label.color = Math.max(
      0,
      Math.trunc(normalizeNumber(nextValues.color, 0)),
    );
  }

  persistState(state);
  return { success: true };
}

function deleteCharacterLabel(characterID, labelID) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  const numericLabelID = toPositiveInteger(labelID, 0);
  if (numericCharacterID <= 0 || numericLabelID <= 0) {
    return { success: false, errorMsg: "INVALID_LABEL" };
  }

  const state = getMutableState();
  const mailbox = ensureMailbox(state, numericCharacterID);
  delete mailbox.labels[String(numericLabelID)];

  for (const status of Object.values(mailbox.statuses)) {
    status.labelMask = Math.trunc(normalizeNumber(status.labelMask, 0));
    status.labelMask &= ~numericLabelID;
  }

  persistState(state);
  return { success: true };
}

function mutateStatuses(characterID, messageIDs, mutator) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  if (numericCharacterID <= 0) {
    return { success: false, errorMsg: "INVALID_CHARACTER" };
  }

  const state = getMutableState();
  const mailbox = ensureMailbox(state, numericCharacterID);
  let mutated = false;
  const changedMessageIDs = [];
  for (const messageID of normalizePositiveIDList(messageIDs)) {
    const status = mailbox.statuses[String(messageID)];
    if (!status) {
      continue;
    }
    const before = JSON.stringify(status);
    mutator(status, state.messages[String(messageID)] || null);
    if (JSON.stringify(status) !== before) {
      mutated = true;
      changedMessageIDs.push(messageID);
    }
  }

  if (mutated) {
    persistState(state);
  }
  return { success: true, mutated, changedMessageIDs };
}

function mutateAllStatuses(characterID, predicate, mutator) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  if (numericCharacterID <= 0) {
    return { success: false, errorMsg: "INVALID_CHARACTER" };
  }

  const state = getMutableState();
  const mailbox = ensureMailbox(state, numericCharacterID);
  let mutated = false;
  const changedMessageIDs = [];
  for (const [messageID, status] of Object.entries(mailbox.statuses)) {
    const message = state.messages[messageID] || null;
    if (!predicate(status, message)) {
      continue;
    }
    const before = JSON.stringify(status);
    mutator(status, message);
    if (JSON.stringify(status) !== before) {
      mutated = true;
      changedMessageIDs.push(toPositiveInteger(messageID, 0));
    }
  }

  if (mutated) {
    persistState(state);
  }
  return { success: true, mutated, changedMessageIDs };
}

function removeMessageStatuses(characterID, messageIDs) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  if (numericCharacterID <= 0) {
    return { success: false, errorMsg: "INVALID_CHARACTER" };
  }

  const state = getMutableState();
  const mailbox = ensureMailbox(state, numericCharacterID);
  let mutated = false;
  const changedMessageIDs = [];
  for (const messageID of normalizePositiveIDList(messageIDs)) {
    const key = String(messageID);
    if (!mailbox.statuses[key]) {
      continue;
    }
    delete mailbox.statuses[key];
    pruneMessageIfOrphaned(state, messageID);
    mutated = true;
    changedMessageIDs.push(messageID);
  }

  if (mutated) {
    persistState(state);
  }
  return { success: true, mutated, changedMessageIDs };
}

function emptyTrash(characterID) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  if (numericCharacterID <= 0) {
    return { success: false, errorMsg: "INVALID_CHARACTER" };
  }

  const state = getMutableState();
  const mailbox = ensureMailbox(state, numericCharacterID);
  let mutated = false;
  const changedMessageIDs = [];
  for (const [messageID, status] of Object.entries(mailbox.statuses)) {
    if (
      (Math.trunc(normalizeNumber(status.statusMask, 0)) &
        MAIL_STATUS_MASK_TRASHED) ===
      0
    ) {
      continue;
    }
    delete mailbox.statuses[messageID];
    pruneMessageIfOrphaned(state, messageID);
    mutated = true;
    changedMessageIDs.push(toPositiveInteger(messageID, 0));
  }

  if (mutated) {
    persistState(state);
  }
  return { success: true, mutated, changedMessageIDs };
}

function sendMail(options = {}) {
  const senderID = toPositiveInteger(options.senderID, 0);
  const explicitCharacterIDs = normalizeCharacterRecipientIDs(options.toCharacterIDs);
  const toListID = options.toListID == null
    ? null
    : toPositiveInteger(options.toListID, 0) || null;
  const toCorpOrAllianceID = options.toCorpOrAllianceID == null
    ? null
    : toPositiveInteger(options.toCorpOrAllianceID, 0) || null;
  const title = normalizeSubject(options.title);
  const body = normalizeBody(options.body);
  const saveSenderCopy = options.saveSenderCopy !== false;
  const sentDate = normalizeText(options.sentDate, "") || currentFileTimeString();
  const initialStatusMask = Math.max(
    0,
    Math.trunc(normalizeNumber(options.statusMask, 0)),
  );

  const state = getMutableState();
  const resolvedRecipients = buildDeliveryRecipients(
    state,
    explicitCharacterIDs,
    toCorpOrAllianceID,
    toListID,
    senderID,
    saveSenderCopy,
    options.deliveryRecipientCharacterIDs,
  );
  if (!resolvedRecipients.success) {
    return resolvedRecipients;
  }
  const recipientCharacterIDs = resolvedRecipients.recipients;

  if (recipientCharacterIDs.length === 0 && !saveSenderCopy) {
    return { success: false, errorMsg: "NO_RECIPIENTS" };
  }

  const messageID = allocateMessageID(state);
  const message = {
    messageID,
    senderID,
    toCharacterIDs: explicitCharacterIDs,
    toListID,
    toCorpOrAllianceID,
    title,
    body,
    sentDate,
    createdAt: sentDate,
  };
  state.messages[String(messageID)] = message;

  for (const characterID of recipientCharacterIDs) {
    const recipientStatus = ensureStatusEntry(state, characterID, messageID, {
      read: false,
      isSenderCopy: false,
    });
    if (recipientStatus && initialStatusMask > 0) {
      recipientStatus.statusMask |= initialStatusMask;
    }
  }

  if (saveSenderCopy && senderID > 0) {
    const shouldReadSenderCopy =
      toListID == null &&
      toCorpOrAllianceID == null &&
      !explicitCharacterIDs.includes(senderID);
    const senderStatus = ensureStatusEntry(state, senderID, messageID, {
      read: shouldReadSenderCopy,
      isSenderCopy: true,
    });
    if (senderStatus && shouldReadSenderCopy) {
      senderStatus.statusMask |= MAIL_STATUS_MASK_READ;
    }
  }

  const writeResult = persistState(state);
  if (!writeResult || !writeResult.success) {
    return { success: false, errorMsg: "WRITE_ERROR" };
  }

  for (const characterID of recipientCharacterIDs) {
    const recipientMailbox = state.mailboxes[String(characterID)];
    const recipientStatus =
      recipientMailbox &&
      recipientMailbox.statuses &&
      recipientMailbox.statuses[String(messageID)];
    if (!recipientStatus) {
      continue;
    }
    sendMailSentNotification(characterID, message, recipientStatus.statusMask, {
      excludeSession: options.excludeSession || null,
    });
    createNewMailNotification(
      characterID,
      {
        senderID: message.senderID,
        subject: message.title,
        sentDate: message.sentDate,
        msg: {
          messageID: message.messageID,
          senderID: message.senderID,
          sentDate: message.sentDate,
          toCharacterIDs: Array.isArray(explicitCharacterIDs)
            ? [...explicitCharacterIDs]
            : [],
          toListID: message.toListID,
          toCorpOrAllianceID: message.toCorpOrAllianceID,
          subject: message.title,
          statusMask: recipientStatus.statusMask,
          labelMask: recipientStatus.labelMask,
          read: (recipientStatus.statusMask & MAIL_STATUS_MASK_READ) !== 0,
          trashed: (recipientStatus.statusMask & MAIL_STATUS_MASK_TRASHED) !== 0,
          replied: (recipientStatus.statusMask & MAIL_STATUS_MASK_REPLIED) !== 0,
          forwarded: (recipientStatus.statusMask & MAIL_STATUS_MASK_FORWARDED) !== 0,
        },
      },
      {
        emitLive: false,
        excludeSession: options.excludeSession || null,
      },
    );
  }

  return {
    success: true,
    messageID,
    sentDate,
    recipients: recipientCharacterIDs,
  };
}

function getJoinedMailingLists(characterID) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  if (numericCharacterID <= 0) {
    return {};
  }

  const state = getMutableState();
  const joinedLists = {};
  for (const record of getAllMailingLists(state)) {
    if (record.deleted === true) {
      continue;
    }
    if (getMailingListMemberAccess(record, numericCharacterID) == null) {
      continue;
    }
    joinedLists[String(record.listID)] = buildMailingListSummary(
      record,
      numericCharacterID,
    );
  }
  return joinedLists;
}

function getMailingListInfo(listID, options = {}) {
  const numericListID = toPositiveInteger(listID, 0);
  if (numericListID <= 0) {
    return null;
  }

  const state = getMutableState();
  const record = getMailingListRecord(state, numericListID);
  if (!record) {
    return null;
  }
  return buildMailingListSummary(
    record,
    toPositiveInteger(options.characterID, 0),
  );
}

function createMailingList(
  ownerCharacterID,
  name,
  defaultAccess = MAILING_LIST_ACCESS_ALLOWED,
  defaultMemberAccess = MAILING_LIST_MEMBER_DEFAULT,
  cost = 0,
) {
  const numericOwnerID = toPositiveInteger(ownerCharacterID, 0);
  const nameParts = normalizeMailingListNameComponents(name);
  if (numericOwnerID <= 0 || !nameParts.key || !nameParts.displayName) {
    return { success: false, errorMsg: "INVALID_MAILING_LIST" };
  }

  const state = getMutableState();
  const conflictingList = getAllMailingLists(state).find(
    (record) => record.deleted !== true && record.name === nameParts.key,
  );
  if (conflictingList) {
    return { success: false, errorMsg: "MAILING_LIST_EXISTS" };
  }

  const listID = allocateMailingListID(state);
  state.mailingLists[String(listID)] = ensureMailingListShape(
    {
      listID,
      name: nameParts.key,
      displayName: nameParts.displayName,
      ownerID: numericOwnerID,
      defaultAccess: normalizeMailingListAccess(defaultAccess),
      defaultMemberAccess: normalizeMailingListMemberAccess(defaultMemberAccess),
      cost: Math.max(0, Math.trunc(normalizeNumber(cost, 0))),
      access: {},
      members: {
        [String(numericOwnerID)]: MAILING_LIST_MEMBER_OWNER,
      },
      welcomeMail: null,
      deleted: false,
      createdAt: currentFileTimeString(),
      updatedAt: currentFileTimeString(),
    },
    listID,
  );
  persistState(state);
  return { success: true, listID };
}

function joinMailingList(characterID, nameOrID) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  if (numericCharacterID <= 0) {
    return { success: false, errorMsg: "INVALID_CHARACTER" };
  }

  const state = getMutableState();
  const record = resolveMailingListByNameOrID(state, nameOrID);
  if (!record || record.deleted === true) {
    return { success: false, errorMsg: "MAILING_LIST_NOT_FOUND" };
  }

  if (getMailingListMemberAccess(record, numericCharacterID) != null) {
    return {
      success: true,
      list: buildMailingListSummary(record, numericCharacterID),
      alreadyMember: true,
    };
  }

  if (
    Object.keys(record.members || {}).length >= MAILING_LIST_MAX_MEMBERS
  ) {
    return { success: false, errorMsg: "MAILING_LIST_FULL" };
  }

  if (
    resolveMailingListJoinAccess(record, numericCharacterID) !==
    MAILING_LIST_ACCESS_ALLOWED
  ) {
    return { success: false, errorMsg: "MAILING_LIST_ACCESS_DENIED" };
  }

  record.members[String(numericCharacterID)] = normalizeMailingListMemberAccess(
    record.defaultMemberAccess,
  );
  record.updatedAt = currentFileTimeString();
  persistState(state);

  if (
    record.welcomeMail &&
    (record.welcomeMail.title || record.welcomeMail.body)
  ) {
    sendMail({
      senderID: record.listID,
      toListID: record.listID,
      title: record.welcomeMail.title,
      body: record.welcomeMail.body,
      saveSenderCopy: false,
      statusMask: MAIL_STATUS_MASK_AUTOMATED,
      deliveryRecipientCharacterIDs: [numericCharacterID],
    });
  }

  return {
    success: true,
    list: buildMailingListSummary(record, numericCharacterID),
  };
}

function getMailingListMembers(listID) {
  const numericListID = toPositiveInteger(listID, 0);
  if (numericListID <= 0) {
    return {};
  }

  const state = getMutableState();
  const record = getMailingListRecord(state, numericListID);
  if (!record || record.deleted === true) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(record.members || {}).map(([characterID, memberAccess]) => [
      String(toPositiveInteger(characterID, 0)),
      normalizeMailingListMemberAccess(memberAccess),
    ]),
  );
}

function getMailingListSettings(listID) {
  const numericListID = toPositiveInteger(listID, 0);
  if (numericListID <= 0) {
    return null;
  }

  const state = getMutableState();
  const record = getMailingListRecord(state, numericListID);
  if (!record || record.deleted === true) {
    return null;
  }

  return {
    defaultAccess: normalizeMailingListAccess(record.defaultAccess),
    defaultMemberAccess: normalizeMailingListMemberAccess(
      record.defaultMemberAccess,
    ),
    cost: Math.max(0, Math.trunc(normalizeNumber(record.cost, 0))),
    access: cloneValue(record.access || {}),
  };
}

function setMailingListEntitiesAccess(characterID, listID, accessByEntityID = {}) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  const numericListID = toPositiveInteger(listID, 0);
  if (numericCharacterID <= 0 || numericListID <= 0) {
    return { success: false, errorMsg: "INVALID_MAILING_LIST" };
  }

  const state = getMutableState();
  const record = getMailingListRecord(state, numericListID);
  if (!record || record.deleted === true || !canConfigureMailingList(record, numericCharacterID)) {
    return { success: false, errorMsg: "MAILING_LIST_ACCESS_DENIED" };
  }

  let changed = false;
  let updates = 0;
  for (const [entityID, accessLevel] of Object.entries(accessByEntityID || {})) {
    if (updates >= MAILING_LIST_MAX_MEMBERS_UPDATED) {
      break;
    }
    const numericEntityID = toPositiveInteger(entityID, 0);
    if (numericEntityID <= 0) {
      continue;
    }
    const nextAccess = normalizeMailingListAccess(accessLevel);
    if (record.access[String(numericEntityID)] === nextAccess) {
      continue;
    }
    record.access[String(numericEntityID)] = nextAccess;
    updates += 1;
    changed = true;
  }

  if (changed) {
    record.updatedAt = currentFileTimeString();
    persistState(state);
  }
  return { success: true, changed };
}

function clearMailingListEntityAccess(characterID, listID, entityID) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  const numericListID = toPositiveInteger(listID, 0);
  const numericEntityID = toPositiveInteger(entityID, 0);
  if (
    numericCharacterID <= 0 ||
    numericListID <= 0 ||
    numericEntityID <= 0
  ) {
    return { success: false, errorMsg: "INVALID_MAILING_LIST" };
  }

  const state = getMutableState();
  const record = getMailingListRecord(state, numericListID);
  if (!record || record.deleted === true || !canConfigureMailingList(record, numericCharacterID)) {
    return { success: false, errorMsg: "MAILING_LIST_ACCESS_DENIED" };
  }

  if (!Object.prototype.hasOwnProperty.call(record.access || {}, String(numericEntityID))) {
    return { success: true, changed: false };
  }

  delete record.access[String(numericEntityID)];
  record.updatedAt = currentFileTimeString();
  persistState(state);
  return { success: true, changed: true };
}

function updateMailingListMemberRole(characterID, listID, memberIDs, nextRole) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  const numericListID = toPositiveInteger(listID, 0);
  if (numericCharacterID <= 0 || numericListID <= 0) {
    return { success: false, errorMsg: "INVALID_MAILING_LIST" };
  }

  const state = getMutableState();
  const record = getMailingListRecord(state, numericListID);
  if (!record || record.deleted === true || !canConfigureMailingList(record, numericCharacterID)) {
    return { success: false, errorMsg: "MAILING_LIST_ACCESS_DENIED" };
  }

  const normalizedRole = normalizeMailingListMemberAccess(nextRole);
  const changedMembers = [];
  for (const memberID of normalizePositiveIDList(memberIDs, {
    maxItems: MAILING_LIST_MAX_MEMBERS_UPDATED,
  })) {
    if (!canManageMailingListTarget(record, numericCharacterID, memberID)) {
      continue;
    }
    if (getMailingListMemberAccess(record, memberID) == null) {
      continue;
    }
    if (getMailingListMemberAccess(record, memberID) === normalizedRole) {
      continue;
    }
    record.members[String(memberID)] = normalizedRole;
    changedMembers.push(memberID);
  }

  if (changedMembers.length > 0) {
    record.updatedAt = currentFileTimeString();
    persistState(state);
    for (const memberID of changedMembers) {
      if (normalizedRole === MAILING_LIST_MEMBER_MUTED) {
        sendMailingListRoleMutedNotification(memberID, numericListID);
      } else if (normalizedRole === MAILING_LIST_MEMBER_OPERATOR) {
        sendMailingListRoleOperatorNotification(memberID, numericListID);
      } else {
        sendMailingListRoleClearNotification(memberID, numericListID);
      }
    }
  }

  return { success: true, changedMembers };
}

function setMailingListMembersMuted(characterID, listID, memberIDs) {
  return updateMailingListMemberRole(
    characterID,
    listID,
    memberIDs,
    MAILING_LIST_MEMBER_MUTED,
  );
}

function setMailingListMembersOperator(characterID, listID, memberIDs) {
  return updateMailingListMemberRole(
    characterID,
    listID,
    memberIDs,
    MAILING_LIST_MEMBER_OPERATOR,
  );
}

function setMailingListMembersClear(characterID, listID, memberIDs) {
  return updateMailingListMemberRole(
    characterID,
    listID,
    memberIDs,
    MAILING_LIST_MEMBER_DEFAULT,
  );
}

function removeMailingListMembers(characterID, listID, memberIDs) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  const numericListID = toPositiveInteger(listID, 0);
  if (numericCharacterID <= 0 || numericListID <= 0) {
    return { success: false, errorMsg: "INVALID_MAILING_LIST" };
  }

  const state = getMutableState();
  const record = getMailingListRecord(state, numericListID);
  if (!record || record.deleted === true || !canConfigureMailingList(record, numericCharacterID)) {
    return { success: false, errorMsg: "MAILING_LIST_ACCESS_DENIED" };
  }

  const removedMembers = [];
  for (const memberID of normalizePositiveIDList(memberIDs, {
    maxItems: MAILING_LIST_MAX_MEMBERS_UPDATED,
  })) {
    if (!canManageMailingListTarget(record, numericCharacterID, memberID)) {
      continue;
    }
    if (getMailingListMemberAccess(record, memberID) == null) {
      continue;
    }
    delete record.members[String(memberID)];
    removedMembers.push(memberID);
  }

  if (removedMembers.length > 0) {
    record.updatedAt = currentFileTimeString();
    persistState(state);
    for (const memberID of removedMembers) {
      sendMailingListLeaveNotification(memberID, numericListID, memberID);
    }
  }

  return { success: true, removedMembers };
}

function leaveMailingList(characterID, listID) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  const numericListID = toPositiveInteger(listID, 0);
  if (numericCharacterID <= 0 || numericListID <= 0) {
    return { success: false, errorMsg: "INVALID_MAILING_LIST" };
  }

  const state = getMutableState();
  const record = getMailingListRecord(state, numericListID);
  if (!record || record.deleted === true) {
    return { success: false, errorMsg: "MAILING_LIST_NOT_FOUND" };
  }

  if (getMailingListMemberAccess(record, numericCharacterID) == null) {
    return { success: true, changed: false };
  }
  if (getMailingListMemberAccess(record, numericCharacterID) === MAILING_LIST_MEMBER_OWNER) {
    return { success: false, errorMsg: "OWNER_CANNOT_LEAVE" };
  }

  delete record.members[String(numericCharacterID)];
  record.updatedAt = currentFileTimeString();
  persistState(state);
  sendMailingListLeaveNotification(numericCharacterID, numericListID, numericCharacterID);
  return { success: true, changed: true };
}

function deleteMailingList(characterID, listID) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  const numericListID = toPositiveInteger(listID, 0);
  if (numericCharacterID <= 0 || numericListID <= 0) {
    return { success: false, errorMsg: "INVALID_MAILING_LIST" };
  }

  const state = getMutableState();
  const record = getMailingListRecord(state, numericListID);
  if (!record || record.deleted === true) {
    return { success: false, errorMsg: "MAILING_LIST_NOT_FOUND" };
  }
  if (getMailingListMemberAccess(record, numericCharacterID) !== MAILING_LIST_MEMBER_OWNER) {
    return { success: false, errorMsg: "MAILING_LIST_ACCESS_DENIED" };
  }

  const memberIDs = Object.keys(record.members || {})
    .map((entry) => toPositiveInteger(entry, 0))
    .filter((entry) => entry > 0);
  record.deleted = true;
  record.members = {};
  record.updatedAt = currentFileTimeString();
  persistState(state);
  for (const memberID of memberIDs) {
    sendMailingListDeletedNotification(memberID, numericListID);
  }
  return { success: true };
}

function setMailingListDefaultAccess(
  characterID,
  listID,
  defaultAccess,
  defaultMemberAccess,
  cost = 0,
) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  const numericListID = toPositiveInteger(listID, 0);
  if (numericCharacterID <= 0 || numericListID <= 0) {
    return { success: false, errorMsg: "INVALID_MAILING_LIST" };
  }

  const state = getMutableState();
  const record = getMailingListRecord(state, numericListID);
  if (!record || record.deleted === true || !canConfigureMailingList(record, numericCharacterID)) {
    return { success: false, errorMsg: "MAILING_LIST_ACCESS_DENIED" };
  }

  record.defaultAccess = normalizeMailingListAccess(defaultAccess);
  record.defaultMemberAccess = normalizeMailingListMemberAccess(defaultMemberAccess);
  record.cost = Math.max(0, Math.trunc(normalizeNumber(cost, 0)));
  record.updatedAt = currentFileTimeString();
  persistState(state);
  return { success: true };
}

function getMailingListWelcomeMail(listID) {
  const numericListID = toPositiveInteger(listID, 0);
  if (numericListID <= 0) {
    return [];
  }

  const state = getMutableState();
  const record = getMailingListRecord(state, numericListID);
  if (!record || !record.welcomeMail) {
    return [];
  }

  return [cloneValue(record.welcomeMail)];
}

function saveMailingListWelcomeMail(characterID, listID, title, body) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  const numericListID = toPositiveInteger(listID, 0);
  if (numericCharacterID <= 0 || numericListID <= 0) {
    return { success: false, errorMsg: "INVALID_MAILING_LIST" };
  }

  const state = getMutableState();
  const record = getMailingListRecord(state, numericListID);
  if (!record || record.deleted === true || !canConfigureMailingList(record, numericCharacterID)) {
    return { success: false, errorMsg: "MAILING_LIST_ACCESS_DENIED" };
  }

  record.welcomeMail = {
    title: normalizeSubject(title),
    body: normalizeBody(body),
    savedAt: currentFileTimeString(),
  };
  record.updatedAt = currentFileTimeString();
  persistState(state);
  return { success: true };
}

function sendMailingListWelcomeMail(characterID, listID, title, body) {
  const saved = saveMailingListWelcomeMail(characterID, listID, title, body);
  if (!saved.success) {
    return saved;
  }

  const numericListID = toPositiveInteger(listID, 0);
  const state = getMutableState();
  const record = getMailingListRecord(state, numericListID);
  if (!record || !record.welcomeMail) {
    return { success: false, errorMsg: "MAILING_LIST_NOT_FOUND" };
  }

  const memberIDs = Object.keys(record.members || {})
    .map((entry) => toPositiveInteger(entry, 0))
    .filter((entry) => entry > 0);
  if (memberIDs.length === 0) {
    return { success: true, messageID: null };
  }

  return sendMail({
    senderID: record.listID,
    toListID: record.listID,
    title: record.welcomeMail.title,
    body: record.welcomeMail.body,
    saveSenderCopy: false,
    statusMask: MAIL_STATUS_MASK_AUTOMATED,
    deliveryRecipientCharacterIDs: memberIDs,
  });
}

function clearMailingListWelcomeMail(characterID, listID) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  const numericListID = toPositiveInteger(listID, 0);
  if (numericCharacterID <= 0 || numericListID <= 0) {
    return { success: false, errorMsg: "INVALID_MAILING_LIST" };
  }

  const state = getMutableState();
  const record = getMailingListRecord(state, numericListID);
  if (!record || record.deleted === true || !canConfigureMailingList(record, numericCharacterID)) {
    return { success: false, errorMsg: "MAILING_LIST_ACCESS_DENIED" };
  }

  record.welcomeMail = null;
  record.updatedAt = currentFileTimeString();
  persistState(state);
  return { success: true };
}

function sendWelcomeMailToCharacter(characterID, options = {}) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  if (numericCharacterID <= 0) {
    return { success: false, errorMsg: "INVALID_CHARACTER" };
  }

  const senderID = resolveWelcomeSenderID();
  const characterName =
    normalizeText(options.characterName, "") ||
    resolveCharacterName(numericCharacterID);
  const existingMail = findExistingCharacterWelcomeMail(
    getMutableState(),
    numericCharacterID,
    senderID,
  );
  if (existingMail) {
    return {
      success: true,
      alreadySent: true,
      ...existingMail,
    };
  }

  return sendMail({
    senderID,
    toCharacterIDs: [numericCharacterID],
    title: WELCOME_MAIL_TITLE,
    body: buildWelcomeMailBody(characterName),
    saveSenderCopy: false,
  });
}

function sendCorporationWelcomeMailToCharacter(
  characterID,
  corporationID,
  options = {},
) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  const numericCorporationID = toPositiveInteger(corporationID, 0);
  if (numericCharacterID <= 0 || numericCorporationID <= 0) {
    return { success: false, errorMsg: "INVALID_CORPORATION_WELCOME_MAIL" };
  }

  const corporationRecord =
    options.corporationRecord || getCorporationRecord(numericCorporationID) || null;
  const corporationName =
    normalizeText(
      corporationRecord && corporationRecord.corporationName,
      `Corporation ${numericCorporationID}`,
    ) || `Corporation ${numericCorporationID}`;
  const body = normalizeBody(
    options.body == null ? "" : options.body,
  );
  if (!body) {
    return {
      success: true,
      skipped: true,
      reason: "EMPTY_WELCOME_MAIL",
    };
  }

  return sendMail({
    senderID: numericCorporationID,
    toCharacterIDs: [numericCharacterID],
    title:
      normalizeSubject(options.title) || `Welcome to ${corporationName}`,
    body,
    saveSenderCopy: false,
    statusMask: MAIL_STATUS_MASK_AUTOMATED,
  });
}

function markAsRead(characterID, messageIDs) {
  return mutateStatuses(characterID, messageIDs, (status) => {
    status.statusMask = Math.trunc(normalizeNumber(status.statusMask, 0));
    status.statusMask |= MAIL_STATUS_MASK_READ;
  });
}

function markAsUnread(characterID, messageIDs) {
  return mutateStatuses(characterID, messageIDs, (status) => {
    status.statusMask = Math.trunc(normalizeNumber(status.statusMask, 0));
    status.statusMask &= ~MAIL_STATUS_MASK_READ;
  });
}

function moveToTrash(characterID, messageIDs) {
  return mutateStatuses(characterID, messageIDs, (status) => {
    status.statusMask = Math.trunc(normalizeNumber(status.statusMask, 0));
    status.statusMask |= MAIL_STATUS_MASK_TRASHED;
  });
}

function moveFromTrash(characterID, messageIDs) {
  return mutateStatuses(characterID, messageIDs, (status) => {
    status.statusMask = Math.trunc(normalizeNumber(status.statusMask, 0));
    status.statusMask &= ~MAIL_STATUS_MASK_TRASHED;
  });
}

function moveAllToTrash(characterID) {
  return mutateAllStatuses(
    characterID,
    () => true,
    (status) => {
      status.statusMask = Math.trunc(normalizeNumber(status.statusMask, 0));
      status.statusMask |= MAIL_STATUS_MASK_TRASHED;
    },
  );
}

function moveAllFromTrash(characterID) {
  return mutateAllStatuses(
    characterID,
    () => true,
    (status) => {
      status.statusMask = Math.trunc(normalizeNumber(status.statusMask, 0));
      status.statusMask &= ~MAIL_STATUS_MASK_TRASHED;
    },
  );
}

function markAllAsRead(characterID) {
  return mutateAllStatuses(
    characterID,
    (status) =>
      (Math.trunc(normalizeNumber(status.statusMask, 0)) &
        MAIL_STATUS_MASK_TRASHED) ===
      0,
    (status) => {
      status.statusMask = Math.trunc(normalizeNumber(status.statusMask, 0));
      status.statusMask |= MAIL_STATUS_MASK_READ;
    },
  );
}

function markAllAsUnread(characterID) {
  return mutateAllStatuses(
    characterID,
    (status) =>
      (Math.trunc(normalizeNumber(status.statusMask, 0)) &
        MAIL_STATUS_MASK_TRASHED) ===
      0,
    (status) => {
      status.statusMask = Math.trunc(normalizeNumber(status.statusMask, 0));
      status.statusMask &= ~MAIL_STATUS_MASK_READ;
    },
  );
}

function moveToTrashByLabel(characterID, labelID) {
  const numericLabelID = toPositiveInteger(labelID, 0);
  return mutateAllStatuses(
    characterID,
    (status) =>
      (Math.trunc(normalizeNumber(status.labelMask, 0)) & numericLabelID) ===
      numericLabelID,
    (status) => {
      status.statusMask = Math.trunc(normalizeNumber(status.statusMask, 0));
      status.statusMask |= MAIL_STATUS_MASK_TRASHED;
    },
  );
}

function markAsReadByLabel(characterID, labelID) {
  const numericLabelID = toPositiveInteger(labelID, 0);
  return mutateAllStatuses(
    characterID,
    (status) =>
      (Math.trunc(normalizeNumber(status.statusMask, 0)) &
        MAIL_STATUS_MASK_TRASHED) ===
        0 &&
      (Math.trunc(normalizeNumber(status.labelMask, 0)) & numericLabelID) ===
        numericLabelID,
    (status) => {
      status.statusMask = Math.trunc(normalizeNumber(status.statusMask, 0));
      status.statusMask |= MAIL_STATUS_MASK_READ;
    },
  );
}

function markAsUnreadByLabel(characterID, labelID) {
  const numericLabelID = toPositiveInteger(labelID, 0);
  return mutateAllStatuses(
    characterID,
    (status) =>
      (Math.trunc(normalizeNumber(status.statusMask, 0)) &
        MAIL_STATUS_MASK_TRASHED) ===
        0 &&
      (Math.trunc(normalizeNumber(status.labelMask, 0)) & numericLabelID) ===
        numericLabelID,
    (status) => {
      status.statusMask = Math.trunc(normalizeNumber(status.statusMask, 0));
      status.statusMask &= ~MAIL_STATUS_MASK_READ;
    },
  );
}

function moveToTrashByList(characterID, listID) {
  const numericListID = toPositiveInteger(listID, 0);
  return mutateAllStatuses(
    characterID,
    (_status, message) =>
      toPositiveInteger(message && message.toListID, 0) === numericListID,
    (status) => {
      status.statusMask = Math.trunc(normalizeNumber(status.statusMask, 0));
      status.statusMask |= MAIL_STATUS_MASK_TRASHED;
    },
  );
}

function markAsReadByList(characterID, listID) {
  const numericListID = toPositiveInteger(listID, 0);
  return mutateAllStatuses(
    characterID,
    (status, message) =>
      (Math.trunc(normalizeNumber(status.statusMask, 0)) &
        MAIL_STATUS_MASK_TRASHED) ===
        0 &&
      toPositiveInteger(message && message.toListID, 0) === numericListID,
    (status) => {
      status.statusMask = Math.trunc(normalizeNumber(status.statusMask, 0));
      status.statusMask |= MAIL_STATUS_MASK_READ;
    },
  );
}

function markAsUnreadByList(characterID, listID) {
  const numericListID = toPositiveInteger(listID, 0);
  return mutateAllStatuses(
    characterID,
    (status, message) =>
      (Math.trunc(normalizeNumber(status.statusMask, 0)) &
        MAIL_STATUS_MASK_TRASHED) ===
        0 &&
      toPositiveInteger(message && message.toListID, 0) === numericListID,
    (status) => {
      status.statusMask = Math.trunc(normalizeNumber(status.statusMask, 0));
      status.statusMask &= ~MAIL_STATUS_MASK_READ;
    },
  );
}

function assignLabels(characterID, messageIDs, labelMask) {
  const numericLabelMask = Math.max(0, Math.trunc(normalizeNumber(labelMask, 0)));
  return mutateStatuses(characterID, messageIDs, (status) => {
    status.labelMask = Math.trunc(normalizeNumber(status.labelMask, 0));
    status.labelMask |= numericLabelMask;
  });
}

function removeLabels(characterID, messageIDs, labelMask) {
  const numericLabelMask = Math.max(0, Math.trunc(normalizeNumber(labelMask, 0)));
  return mutateStatuses(characterID, messageIDs, (status) => {
    status.labelMask = Math.trunc(normalizeNumber(status.labelMask, 0));
    status.labelMask &= ~numericLabelMask;
  });
}

function replaceLabels(characterID, messageIDs, labelMask) {
  const numericLabelMask = Math.max(0, Math.trunc(normalizeNumber(labelMask, 0)));
  return mutateStatuses(characterID, messageIDs, (status) => {
    const systemLabels =
      Math.trunc(normalizeNumber(status.labelMask, 0)) & MAIL_SYSTEM_LABEL_MASK;
    status.labelMask = systemLabels | numericLabelMask;
  });
}

function getSyncMailbox(characterID, firstID, lastID) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  if (numericCharacterID <= 0) {
    return {
      newMail: [],
      oldMail: [],
      mailStatus: [],
    };
  }

  const mailboxEntries = getMailboxEntries(numericCharacterID, {
    includeTrashed: true,
  });
  const normalizedFirstID = firstID == null ? null : toPositiveInteger(firstID, 0);
  const normalizedLastID = lastID == null ? 0 : toPositiveInteger(lastID, 0);
  const newMail = [];
  const oldMail = [];
  const mailStatus = [];

  for (const { message, status } of mailboxEntries) {
    mailStatus.push({
      messageID: message.messageID,
      statusMask: Math.trunc(normalizeNumber(status.statusMask, 0)),
      labelMask: Math.trunc(normalizeNumber(status.labelMask, 0)),
    });

    if (normalizedFirstID === null || normalizedLastID === 0) {
      newMail.push(cloneValue(message));
    } else if (message.messageID > normalizedLastID) {
      newMail.push(cloneValue(message));
    } else if (message.messageID < normalizedFirstID) {
      oldMail.push(cloneValue(message));
    }
  }

  return {
    newMail,
    oldMail,
    mailStatus,
  };
}

function getMailHeaders(characterID, messageIDs) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  if (numericCharacterID <= 0) {
    return [];
  }

  const requestedIDs = normalizePositiveIDList(messageIDs);
  const headers = [];
  for (const messageID of requestedIDs) {
    const entry = getMessageByIDForCharacter(numericCharacterID, messageID);
    if (entry && entry.message) {
      headers.push(entry.message);
    }
  }
  return headers;
}

function getCompressedBody(characterID, messageID, options = {}) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  const numericMessageID = toPositiveInteger(messageID, 0);
  if (numericCharacterID <= 0 || numericMessageID <= 0) {
    return null;
  }

  if (options.shouldMarkAsRead) {
    markAsRead(numericCharacterID, [numericMessageID]);
  }

  const entry = getMessageByIDForCharacter(numericCharacterID, numericMessageID);
  if (!entry || !entry.message) {
    return null;
  }

  return zlib.deflateSync(Buffer.from(entry.message.body || "", "utf8"));
}

function pokePlayerAboutChatMsgGm(characterID, channelName) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  if (numericCharacterID <= 0) {
    return { success: false, errorMsg: "INVALID_CHARACTER" };
  }

  return sendMail({
    senderID: resolveWelcomeSenderID(),
    toCharacterIDs: [numericCharacterID],
    title: "GM chat request",
    body: [
      "A GM would like to speak with you.",
      "",
      `Requested channel: ${normalizeText(channelName, "Unknown Channel")}`,
    ].join("<br>"),
    saveSenderCopy: false,
  });
}

module.exports = {
  DEFAULT_WELCOME_SENDER_ID,
  MAIL_LABEL_ALLIANCE,
  MAIL_LABEL_CORPORATION,
  MAIL_LABEL_INBOX,
  MAIL_LABEL_SENT,
  MAILING_LIST_ACCESS_ALLOWED,
  MAILING_LIST_ACCESS_BLOCKED,
  MAILING_LIST_MEMBER_DEFAULT,
  MAILING_LIST_MEMBER_MUTED,
  MAILING_LIST_MEMBER_OPERATOR,
  MAILING_LIST_MEMBER_OWNER,
  MAIL_STATUS_MASK_AUTOMATED,
  MAIL_STATUS_MASK_DRAFT,
  MAIL_STATUS_MASK_FORWARDED,
  MAIL_STATUS_MASK_READ,
  MAIL_STATUS_MASK_REPLIED,
  MAIL_STATUS_MASK_TRASHED,
  MAIL_SYSTEM_LABEL_MASK,
  MAIL_TABLE,
  assignLabels,
  clearMailingListEntityAccess,
  clearMailingListWelcomeMail,
  createMailingList,
  createCharacterLabel,
  deleteMailingList,
  deleteCharacterLabel,
  editCharacterLabel,
  emptyTrash,
  getCharacterLabels,
  getCompressedBody,
  getJoinedMailingLists,
  getMailHeaders,
  getMailingListInfo,
  getMailingListMembers,
  getMailingListSettings,
  getMailingListWelcomeMail,
  getMailboxEntries,
  getMessageByIDForCharacter,
  getSyncMailbox,
  getUnreadMailCount,
  joinMailingList,
  leaveMailingList,
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
  removeMailingListMembers,
  removeMessageStatuses,
  replaceLabels,
  resolveWelcomeSenderID,
  saveMailingListWelcomeMail,
  sendMail,
  sendCorporationWelcomeMailToCharacter,
  sendMailingListWelcomeMail,
  sendWelcomeMailToCharacter,
  setMailingListDefaultAccess,
  setMailingListEntitiesAccess,
  setMailingListMembersClear,
  setMailingListMembersMuted,
  setMailingListMembersOperator,
};
