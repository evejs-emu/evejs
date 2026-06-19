const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const log = require(path.join(__dirname, "../../utils/logger"));

const IDENTITY_TABLE = "identityState";
const ACCOUNT_ID_FLOOR = 1;
const CHARACTER_ID_FLOOR = 140000001;
const ITEM_ID_FLOOR = 1990000000;
const DEFAULT_IDENTITY_STATE = Object.freeze({
  version: 1,
  nextAccountID: ACCOUNT_ID_FLOOR,
  nextCharacterID: CHARACTER_ID_FLOOR,
  nextItemID: ITEM_ID_FLOOR,
});

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  const truncated = Math.trunc(numeric);
  return truncated > 0 ? truncated : fallback;
}

function readTableRoot(tableName, fallback = {}) {
  const result = database.read(tableName, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return cloneValue(fallback);
  }
  return result.data;
}

function maxFromNumericKeys(maxValue, record, floor = 1) {
  if (!record || typeof record !== "object") {
    return maxValue;
  }
  let nextMax = maxValue;
  for (const key of Object.keys(record)) {
    const numericKey = toPositiveInt(key, 0);
    if (numericKey >= floor && numericKey > nextMax) {
      nextMax = numericKey;
    }
  }
  return nextMax;
}

function maxFromNumericValues(maxValue, values, floor = 1) {
  let nextMax = maxValue;
  for (const value of Array.isArray(values) ? values : [values]) {
    const numericValue = toPositiveInt(value, 0);
    if (numericValue >= floor && numericValue > nextMax) {
      nextMax = numericValue;
    }
  }
  return nextMax;
}

function readIdentityState() {
  const result = database.read(IDENTITY_TABLE, "/");
  let state =
    result.success && result.data && typeof result.data === "object"
      ? result.data
      : null;

  if (!state) {
    state = cloneValue(DEFAULT_IDENTITY_STATE);
    database.write(IDENTITY_TABLE, "/", state, { force: true });
    database.flushTablesSync([IDENTITY_TABLE]);
    return state;
  }

  let mutated = false;
  if (toPositiveInt(state.version, 0) !== DEFAULT_IDENTITY_STATE.version) {
    state.version = DEFAULT_IDENTITY_STATE.version;
    mutated = true;
  }
  const nextAccountID = toPositiveInt(
    state.nextAccountID,
    DEFAULT_IDENTITY_STATE.nextAccountID,
  );
  if (nextAccountID !== state.nextAccountID) {
    state.nextAccountID = nextAccountID;
    mutated = true;
  }
  const nextCharacterID = toPositiveInt(
    state.nextCharacterID,
    DEFAULT_IDENTITY_STATE.nextCharacterID,
  );
  if (nextCharacterID !== state.nextCharacterID) {
    state.nextCharacterID = nextCharacterID;
    mutated = true;
  }
  const nextItemID = toPositiveInt(
    state.nextItemID,
    DEFAULT_IDENTITY_STATE.nextItemID,
  );
  if (nextItemID !== state.nextItemID) {
    state.nextItemID = nextItemID;
    mutated = true;
  }

  if (mutated) {
    database.write(IDENTITY_TABLE, "/", state, { force: true });
    database.flushTablesSync([IDENTITY_TABLE]);
  }

  return state;
}

function collectAccountIDConflicts(accountID) {
  const normalizedAccountID = toPositiveInt(accountID, 0);
  if (normalizedAccountID <= 0) {
    return [];
  }

  const conflicts = [];
  const accounts = readTableRoot("accounts", {});
  for (const record of Object.values(accounts)) {
    if (toPositiveInt(record && record.id, 0) === normalizedAccountID) {
      conflicts.push("accounts.id");
      break;
    }
  }

  const characters = readTableRoot("characters", {});
  for (const record of Object.values(characters)) {
    if (toPositiveInt(record && record.accountId, 0) === normalizedAccountID) {
      conflicts.push("characters.accountId");
      break;
    }
  }

  return conflicts;
}

function collectCharacterIDConflicts(characterID) {
  const normalizedCharacterID = toPositiveInt(characterID, 0);
  if (normalizedCharacterID < CHARACTER_ID_FLOOR) {
    return [];
  }

  const conflicts = [];
  const characters = readTableRoot("characters", {});
  if (Object.prototype.hasOwnProperty.call(characters, String(normalizedCharacterID))) {
    conflicts.push("characters");
  }

  const mail = readTableRoot("mail", {});
  if (
    mail.mailboxes &&
    Object.prototype.hasOwnProperty.call(mail.mailboxes, String(normalizedCharacterID))
  ) {
    conflicts.push("mail.mailboxes");
  }
  for (const record of Object.values(mail.messages || {})) {
    if (toPositiveInt(record && record.senderID, 0) === normalizedCharacterID) {
      conflicts.push("mail.messages.senderID");
      break;
    }
    if (
      Array.isArray(record && record.toCharacterIDs) &&
      record.toCharacterIDs.some(
        (entry) => toPositiveInt(entry, 0) === normalizedCharacterID,
      )
    ) {
      conflicts.push("mail.messages.toCharacterIDs");
      break;
    }
  }

  const notifications = readTableRoot("notifications", {});
  if (
    notifications.boxes &&
    Object.prototype.hasOwnProperty.call(notifications.boxes, String(normalizedCharacterID))
  ) {
    conflicts.push("notifications.boxes");
  }

  const lpWallets = readTableRoot("lpWallets", {});
  if (
    lpWallets.characterWallets &&
    Object.prototype.hasOwnProperty.call(
      lpWallets.characterWallets,
      String(normalizedCharacterID),
    )
  ) {
    conflicts.push("lpWallets.characterWallets");
  }

  const characterNotes = readTableRoot("characterNotes", {});
  if (
    characterNotes.characters &&
    Object.prototype.hasOwnProperty.call(
      characterNotes.characters,
      String(normalizedCharacterID),
    )
  ) {
    conflicts.push("characterNotes.characters");
  }

  const skillPlans = readTableRoot("skillPlans", {});
  if (Object.prototype.hasOwnProperty.call(skillPlans, String(normalizedCharacterID))) {
    conflicts.push("skillPlans");
  }

  const skillTradingState = readTableRoot("skillTradingState", {});
  if (
    Object.prototype.hasOwnProperty.call(
      skillTradingState,
      String(normalizedCharacterID),
    )
  ) {
    conflicts.push("skillTradingState");
  }

  const characterExpertSystems = readTableRoot("characterExpertSystems", {});
  if (
    Object.prototype.hasOwnProperty.call(
      characterExpertSystems,
      String(normalizedCharacterID),
    )
  ) {
    conflicts.push("characterExpertSystems");
  }

  const bookmarkKnownFolders = readTableRoot("bookmarkKnownFolders", {});
  if (
    bookmarkKnownFolders.recordsByCharacterID &&
    Object.prototype.hasOwnProperty.call(
      bookmarkKnownFolders.recordsByCharacterID,
      String(normalizedCharacterID),
    )
  ) {
    conflicts.push("bookmarkKnownFolders.recordsByCharacterID");
  }

  const savedFittings = readTableRoot("savedFittings", {});
  for (const [ownerID, ownerRecord] of Object.entries(savedFittings.owners || {})) {
    if (
      String(ownerRecord && ownerRecord.scope || "").toLowerCase() === "character" &&
      toPositiveInt(ownerID, 0) === normalizedCharacterID
    ) {
      conflicts.push("savedFittings.owners");
      break;
    }
    if (toPositiveInt(ownerRecord && ownerRecord.ownerID, 0) === normalizedCharacterID) {
      conflicts.push("savedFittings.ownerID");
      break;
    }
  }

  const bookmarkFolders = readTableRoot("bookmarkFolders", {});
  for (const folder of Object.values(bookmarkFolders.records || {})) {
    if (toPositiveInt(folder && folder.creatorID, 0) === normalizedCharacterID) {
      conflicts.push("bookmarkFolders.creatorID");
      break;
    }
  }

  const bookmarkSubfolders = readTableRoot("bookmarkSubfolders", {});
  for (const subfolder of Object.values(bookmarkSubfolders.records || {})) {
    if (toPositiveInt(subfolder && subfolder.creatorID, 0) === normalizedCharacterID) {
      conflicts.push("bookmarkSubfolders.creatorID");
      break;
    }
  }

  const bookmarks = readTableRoot("bookmarks", {});
  for (const bookmark of Object.values(bookmarks.records || {})) {
    if (toPositiveInt(bookmark && bookmark.creatorID, 0) === normalizedCharacterID) {
      conflicts.push("bookmarks.creatorID");
      break;
    }
  }

  const bookmarkGroups = readTableRoot("bookmarkGroups", {});
  for (const group of Object.values(bookmarkGroups.records || {})) {
    if (toPositiveInt(group && group.creatorID, 0) === normalizedCharacterID) {
      conflicts.push("bookmarkGroups.creatorID");
      break;
    }
    if (
      Array.isArray(group && group.admins) &&
      group.admins.some((entry) => toPositiveInt(entry, 0) === normalizedCharacterID)
    ) {
      conflicts.push("bookmarkGroups.admins");
      break;
    }
    if (
      Array.isArray(group && group.members) &&
      group.members.some((entry) => toPositiveInt(entry, 0) === normalizedCharacterID)
    ) {
      conflicts.push("bookmarkGroups.members");
      break;
    }
  }

  const calendarEvents = readTableRoot("calendarEvents", {});
  for (const event of Object.values(calendarEvents.events || {})) {
    if (toPositiveInt(event && event.creatorID, 0) === normalizedCharacterID) {
      conflicts.push("calendarEvents.creatorID");
      break;
    }
    if (toPositiveInt(event && event.ownerID, 0) === normalizedCharacterID) {
      conflicts.push("calendarEvents.ownerID");
      break;
    }
    if (
      Array.isArray(event && event.inviteeCharacterIDs) &&
      event.inviteeCharacterIDs.some(
        (entry) => toPositiveInt(entry, 0) === normalizedCharacterID,
      )
    ) {
      conflicts.push("calendarEvents.inviteeCharacterIDs");
      break;
    }
  }

  const calendarResponses = readTableRoot("calendarResponses", {});
  for (const response of Object.values(calendarResponses.responses || {})) {
    if (toPositiveInt(response && response.characterID, 0) === normalizedCharacterID) {
      conflicts.push("calendarResponses.characterID");
      break;
    }
  }

  return conflicts;
}

function getAccountReferenceHighWaterMark() {
  const identityState = readIdentityState();
  let maxValue = toPositiveInt(identityState.nextAccountID, ACCOUNT_ID_FLOOR) - 1;

  const accounts = readTableRoot("accounts", {});
  for (const record of Object.values(accounts)) {
    maxValue = maxFromNumericValues(maxValue, record && record.id, ACCOUNT_ID_FLOOR);
  }

  const characters = readTableRoot("characters", {});
  for (const record of Object.values(characters)) {
    maxValue = maxFromNumericValues(
      maxValue,
      record && record.accountId,
      ACCOUNT_ID_FLOOR,
    );
  }

  return Math.max(maxValue, ACCOUNT_ID_FLOOR - 1);
}

function getCharacterReferenceHighWaterMark() {
  const identityState = readIdentityState();
  let maxValue =
    toPositiveInt(identityState.nextCharacterID, CHARACTER_ID_FLOOR) - 1;

  const characters = readTableRoot("characters", {});
  maxValue = maxFromNumericKeys(maxValue, characters, CHARACTER_ID_FLOOR);

  const mail = readTableRoot("mail", {});
  maxValue = maxFromNumericKeys(
    maxValue,
    mail.mailboxes || {},
    CHARACTER_ID_FLOOR,
  );
  for (const record of Object.values(mail.messages || {})) {
    maxValue = maxFromNumericValues(
      maxValue,
      record && record.senderID,
      CHARACTER_ID_FLOOR,
    );
    maxValue = maxFromNumericValues(
      maxValue,
      record && record.toCharacterIDs,
      CHARACTER_ID_FLOOR,
    );
  }

  const notifications = readTableRoot("notifications", {});
  maxValue = maxFromNumericKeys(
    maxValue,
    notifications.boxes || {},
    CHARACTER_ID_FLOOR,
  );

  const lpWallets = readTableRoot("lpWallets", {});
  maxValue = maxFromNumericKeys(
    maxValue,
    lpWallets.characterWallets || {},
    CHARACTER_ID_FLOOR,
  );

  const characterNotes = readTableRoot("characterNotes", {});
  maxValue = maxFromNumericKeys(
    maxValue,
    characterNotes.characters || {},
    CHARACTER_ID_FLOOR,
  );

  maxValue = maxFromNumericKeys(
    maxValue,
    readTableRoot("skillPlans", {}),
    CHARACTER_ID_FLOOR,
  );
  maxValue = maxFromNumericKeys(
    maxValue,
    readTableRoot("skillTradingState", {}),
    CHARACTER_ID_FLOOR,
  );
  maxValue = maxFromNumericKeys(
    maxValue,
    readTableRoot("characterExpertSystems", {}),
    CHARACTER_ID_FLOOR,
  );

  const bookmarkKnownFolders = readTableRoot("bookmarkKnownFolders", {});
  maxValue = maxFromNumericKeys(
    maxValue,
    bookmarkKnownFolders.recordsByCharacterID || {},
    CHARACTER_ID_FLOOR,
  );

  const savedFittings = readTableRoot("savedFittings", {});
  for (const [ownerID, ownerRecord] of Object.entries(savedFittings.owners || {})) {
    if (String(ownerRecord && ownerRecord.scope || "").toLowerCase() === "character") {
      maxValue = maxFromNumericValues(maxValue, ownerID, CHARACTER_ID_FLOOR);
      maxValue = maxFromNumericValues(
        maxValue,
        ownerRecord && ownerRecord.ownerID,
        CHARACTER_ID_FLOOR,
      );
    }
  }

  const bookmarkFolders = readTableRoot("bookmarkFolders", {});
  for (const folder of Object.values(bookmarkFolders.records || {})) {
    maxValue = maxFromNumericValues(
      maxValue,
      folder && folder.creatorID,
      CHARACTER_ID_FLOOR,
    );
  }

  const bookmarkSubfolders = readTableRoot("bookmarkSubfolders", {});
  for (const subfolder of Object.values(bookmarkSubfolders.records || {})) {
    maxValue = maxFromNumericValues(
      maxValue,
      subfolder && subfolder.creatorID,
      CHARACTER_ID_FLOOR,
    );
  }

  const bookmarks = readTableRoot("bookmarks", {});
  for (const bookmark of Object.values(bookmarks.records || {})) {
    maxValue = maxFromNumericValues(
      maxValue,
      bookmark && bookmark.creatorID,
      CHARACTER_ID_FLOOR,
    );
  }

  const bookmarkGroups = readTableRoot("bookmarkGroups", {});
  for (const group of Object.values(bookmarkGroups.records || {})) {
    maxValue = maxFromNumericValues(
      maxValue,
      group && group.creatorID,
      CHARACTER_ID_FLOOR,
    );
    maxValue = maxFromNumericValues(
      maxValue,
      group && group.admins,
      CHARACTER_ID_FLOOR,
    );
    maxValue = maxFromNumericValues(
      maxValue,
      group && group.members,
      CHARACTER_ID_FLOOR,
    );
  }

  const calendarEvents = readTableRoot("calendarEvents", {});
  for (const event of Object.values(calendarEvents.events || {})) {
    maxValue = maxFromNumericValues(
      maxValue,
      event && event.creatorID,
      CHARACTER_ID_FLOOR,
    );
    maxValue = maxFromNumericValues(
      maxValue,
      event && event.ownerID,
      CHARACTER_ID_FLOOR,
    );
    maxValue = maxFromNumericValues(
      maxValue,
      event && event.inviteeCharacterIDs,
      CHARACTER_ID_FLOOR,
    );
  }

  const calendarResponses = readTableRoot("calendarResponses", {});
  for (const response of Object.values(calendarResponses.responses || {})) {
    maxValue = maxFromNumericValues(
      maxValue,
      response && response.characterID,
      CHARACTER_ID_FLOOR,
    );
  }

  return Math.max(maxValue, CHARACTER_ID_FLOOR - 1);
}

function getItemReferenceHighWaterMark() {
  const identityState = readIdentityState();
  let maxValue = toPositiveInt(identityState.nextItemID, ITEM_ID_FLOOR) - 1;

  const items = readTableRoot("items", {});
  maxValue = maxFromNumericKeys(maxValue, items, ITEM_ID_FLOOR);
  for (const record of Object.values(items)) {
    maxValue = maxFromNumericValues(
      maxValue,
      record && record.itemID,
      ITEM_ID_FLOOR,
    );
  }

  const characters = readTableRoot("characters", {});
  for (const record of Object.values(characters)) {
    maxValue = maxFromNumericValues(
      maxValue,
      record && record.shipID,
      ITEM_ID_FLOOR,
    );
    if (Array.isArray(record && record.storedShips)) {
      for (const ship of record.storedShips) {
        maxValue = maxFromNumericValues(
          maxValue,
          ship && ship.itemID,
          ITEM_ID_FLOOR,
        );
      }
    }
  }

  return Math.max(maxValue, ITEM_ID_FLOOR - 1);
}

function reserveAccountID() {
  const state = readIdentityState();
  let candidate = Math.max(
    toPositiveInt(state.nextAccountID, ACCOUNT_ID_FLOOR),
    getAccountReferenceHighWaterMark() + 1,
  );

  while (true) {
    const conflicts = collectAccountIDConflicts(candidate);
    if (conflicts.length === 0) {
      break;
    }
    log.warn(
      `[IdentityAllocator] Skipping reused accountID ${candidate}; still referenced by ${conflicts.join(", ")}`,
    );
    candidate += 1;
  }

  state.nextAccountID = candidate + 1;
  database.write(IDENTITY_TABLE, "/", state, { force: true });
  database.flushTablesSync([IDENTITY_TABLE]);
  return candidate;
}

function reserveCharacterID() {
  const state = readIdentityState();
  let candidate = Math.max(
    toPositiveInt(state.nextCharacterID, CHARACTER_ID_FLOOR),
    getCharacterReferenceHighWaterMark() + 1,
  );

  while (true) {
    const conflicts = collectCharacterIDConflicts(candidate);
    if (conflicts.length === 0) {
      break;
    }
    log.warn(
      `[IdentityAllocator] Skipping reused characterID ${candidate}; still referenced by ${conflicts.join(", ")}`,
    );
    candidate += 1;
  }

  state.nextCharacterID = candidate + 1;
  database.write(IDENTITY_TABLE, "/", state, { force: true });
  database.flushTablesSync([IDENTITY_TABLE]);
  return candidate;
}

function reserveItemIDs(count = 1, options = {}) {
  const amount = Math.max(1, toPositiveInt(count, 1));
  const state = readIdentityState();
  const minimumCandidate = toPositiveInt(
    options && options.minCandidate,
    ITEM_ID_FLOOR,
  );
  const firstItemID = Math.max(
    toPositiveInt(state.nextItemID, ITEM_ID_FLOOR),
    getItemReferenceHighWaterMark() + 1,
    minimumCandidate,
  );

  state.nextItemID = firstItemID + amount;
  database.write(IDENTITY_TABLE, "/", state, { force: true });

  return Array.from({ length: amount }, (_, index) => firstItemID + index);
}

module.exports = {
  ACCOUNT_ID_FLOOR,
  CHARACTER_ID_FLOOR,
  ITEM_ID_FLOOR,
  IDENTITY_TABLE,
  collectAccountIDConflicts,
  collectCharacterIDConflicts,
  getAccountReferenceHighWaterMark,
  getCharacterReferenceHighWaterMark,
  getItemReferenceHighWaterMark,
  reserveAccountID,
  reserveCharacterID,
  reserveItemIDs,
};
