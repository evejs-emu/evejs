const path = require("path");

const {
  getCorporationRecord,
} = require(path.join(__dirname, "../corporation/corporationState"));
const {
  ACCESS_ADMIN,
  ACCESS_MANAGE,
  ACCESS_NONE,
  ACCESS_PERSONAL,
  ACCESS_USE,
  ACCESS_VIEW,
  MAX_ACTIVE_PERSONAL_BOOKMARK_FOLDERS,
  MAX_ACTIVE_SHARED_BOOKMARK_FOLDERS,
  MAX_BOOKMARKS_IN_PERSONAL_FOLDER,
  MAX_BOOKMARKS_IN_SHARED_FOLDER,
  MAX_BOOKMARKS_SENT_TO_CLIENT,
  MAX_KNOWN_BOOKMARK_FOLDERS,
  OWNER_SYSTEM,
  TYPE_SOLAR_SYSTEM,
} = require(path.join(__dirname, "./bookmarkConstants"));
const store = require(path.join(__dirname, "./bookmarkRuntimeStore"));

function getCharacterCorporationID(characterID) {
  const record = store.getCharacterRecord(characterID);
  return store.toPositiveInt(record && record.corporationID, 0);
}

function touchLegacyMaximums() {
  const characters = store.getCharacterTable();
  let maxBookmarkID = store.toPositiveInt(store.state.runtimeRoot._meta.nextBookmarkID, 900000001) - 1;
  let maxFolderID = store.toPositiveInt(store.state.runtimeRoot._meta.nextFolderID, 500001) - 1;

  for (const record of Object.values(characters)) {
    for (const legacyBookmark of Array.isArray(record && record.bookmarks) ? record.bookmarks : []) {
      maxBookmarkID = Math.max(maxBookmarkID, store.toPositiveInt(legacyBookmark && legacyBookmark.bookmarkID, 0));
    }
    for (const legacyFolder of Array.isArray(record && record.bookmarkFolders) ? record.bookmarkFolders : []) {
      maxFolderID = Math.max(maxFolderID, store.toPositiveInt(legacyFolder && legacyFolder.folderID, 0));
    }
  }

  const maxPersistedBookmarkID = Math.max(maxBookmarkID, ...[...store.state.bookmarksByID.keys(), 0]);
  const maxPersistedFolderID = Math.max(maxFolderID, ...[...store.state.foldersByID.keys(), 0]);
  const maxPersistedSubfolderID = Math.max(0, ...[...store.state.subfoldersByID.keys(), 0]);
  const maxPersistedGroupID = Math.max(0, ...[...store.state.groupsByID.keys(), 0]);

  store.state.runtimeRoot._meta.nextBookmarkID = Math.max(
    store.toPositiveInt(store.state.runtimeRoot._meta.nextBookmarkID, 900000001),
    maxPersistedBookmarkID + 1,
  );
  store.state.runtimeRoot._meta.nextFolderID = Math.max(
    store.toPositiveInt(store.state.runtimeRoot._meta.nextFolderID, 500001),
    maxPersistedFolderID + 1,
  );
  store.state.runtimeRoot._meta.nextSubfolderID = Math.max(
    store.toPositiveInt(store.state.runtimeRoot._meta.nextSubfolderID, 700001),
    maxPersistedSubfolderID + 1,
  );
  store.state.runtimeRoot._meta.nextGroupID = Math.max(
    store.toPositiveInt(store.state.runtimeRoot._meta.nextGroupID, 800001),
    maxPersistedGroupID + 1,
  );
  store.persistMeta();
}

function allocateBookmarkID() {
  const next = store.toPositiveInt(store.state.runtimeRoot._meta.nextBookmarkID, 900000001);
  store.state.runtimeRoot._meta.nextBookmarkID = next + 1;
  store.persistMeta();
  return next;
}

function allocateFolderID() {
  const next = store.toPositiveInt(store.state.runtimeRoot._meta.nextFolderID, 500001);
  store.state.runtimeRoot._meta.nextFolderID = next + 1;
  store.persistMeta();
  return next;
}

function allocateSubfolderID() {
  const next = store.toPositiveInt(store.state.runtimeRoot._meta.nextSubfolderID, 700001);
  store.state.runtimeRoot._meta.nextSubfolderID = next + 1;
  store.persistMeta();
  return next;
}

function allocateGroupID() {
  const next = store.toPositiveInt(store.state.runtimeRoot._meta.nextGroupID, 800001);
  store.state.runtimeRoot._meta.nextGroupID = next + 1;
  store.persistMeta();
  return next;
}

function buildDefaultGroupName(corporationID) {
  const corporation = getCorporationRecord(corporationID);
  const corporationName =
    String(
      (corporation && (corporation.corporationName || corporation.name)) ||
      `Corporation ${corporationID}`,
    ).trim() || `Corporation ${corporationID}`;
  return `${corporationName} Bookmarks`;
}

function upsertGroupRecord(record) {
  const normalized = store.normalizeGroupRecord(record);
  store.state.groupsByID.set(normalized.groupID, normalized);
  store.state.groupRoot.records[String(normalized.groupID)] = store.cloneValue(normalized);
  store.persistGroups();
  store.rebuildIndexes();
  return normalized;
}

function upsertFolderRecord(record) {
  const normalized = store.normalizeFolderRecord(record);
  store.state.foldersByID.set(normalized.folderID, normalized);
  store.state.folderRoot.records[String(normalized.folderID)] = store.cloneValue(normalized);
  store.persistFolders();
  store.rebuildIndexes();
  return normalized;
}

function upsertSubfolderRecord(record) {
  const normalized = store.normalizeSubfolderRecord(record);
  store.state.subfoldersByID.set(normalized.subfolderID, normalized);
  store.state.subfolderRoot.records[String(normalized.subfolderID)] = store.cloneValue(normalized);
  store.persistSubfolders();
  store.rebuildIndexes();
  return normalized;
}

function upsertBookmarkRecord(record) {
  const normalized = store.normalizeBookmarkRecord(record);
  store.state.bookmarksByID.set(normalized.bookmarkID, normalized);
  store.state.bookmarkRoot.records[String(normalized.bookmarkID)] = store.cloneValue(normalized);
  store.persistBookmarks();
  store.rebuildIndexes();
  return normalized;
}

function removeBookmarkRecord(bookmarkID) {
  const numericBookmarkID = store.toPositiveInt(bookmarkID, 0);
  const existing = store.state.bookmarksByID.get(numericBookmarkID);
  if (!existing) {
    return null;
  }
  store.state.bookmarksByID.delete(numericBookmarkID);
  delete store.state.bookmarkRoot.records[String(numericBookmarkID)];
  store.persistBookmarks();
  store.rebuildIndexes();
  return existing;
}

function removeSubfolderRecord(subfolderID) {
  const numericSubfolderID = store.toPositiveInt(subfolderID, 0);
  const existing = store.state.subfoldersByID.get(numericSubfolderID);
  if (!existing) {
    return null;
  }
  store.state.subfoldersByID.delete(numericSubfolderID);
  delete store.state.subfolderRoot.records[String(numericSubfolderID)];
  store.persistSubfolders();
  store.rebuildIndexes();
  return existing;
}

function removeFolderRecord(folderID) {
  const numericFolderID = store.toPositiveInt(folderID, 0);
  const existing = store.state.foldersByID.get(numericFolderID);
  if (!existing) {
    return null;
  }
  store.state.foldersByID.delete(numericFolderID);
  delete store.state.folderRoot.records[String(numericFolderID)];
  store.persistFolders();
  store.rebuildIndexes();
  return existing;
}

function getKnownFolderStateMap(characterID, create = false) {
  const numericCharacterID = store.toPositiveInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return null;
  }
  if (!store.state.knownFoldersByCharacterID.has(numericCharacterID)) {
    if (!create) {
      return null;
    }
    store.state.knownFoldersByCharacterID.set(numericCharacterID, new Map());
    if (!store.state.knownRoot.recordsByCharacterID) {
      store.state.knownRoot.recordsByCharacterID = {};
    }
    store.state.knownRoot.recordsByCharacterID[String(numericCharacterID)] = {};
  }
  return store.state.knownFoldersByCharacterID.get(numericCharacterID);
}

function getKnownFolderRecord(characterID, folderID) {
  const knownMap = getKnownFolderStateMap(characterID, false);
  return knownMap ? knownMap.get(store.toPositiveInt(folderID, 0)) || null : null;
}

function writeKnownFolderRecord(characterID, folderID, isActive) {
  const knownMap = getKnownFolderStateMap(characterID, true);
  const normalized = store.normalizeKnownFolderRecord({ folderID, isActive });
  knownMap.set(normalized.folderID, normalized);
  store.state.knownRoot.recordsByCharacterID[String(store.toPositiveInt(characterID, 0))][String(normalized.folderID)] = store.cloneValue(normalized);
  store.persistKnownFolders();
  return normalized;
}

function removeKnownFolderRecord(characterID, folderID) {
  const knownMap = getKnownFolderStateMap(characterID, false);
  if (!knownMap) {
    return;
  }
  const numericFolderID = store.toPositiveInt(folderID, 0);
  knownMap.delete(numericFolderID);
  const rootEntry = store.state.knownRoot.recordsByCharacterID[String(store.toPositiveInt(characterID, 0))];
  if (rootEntry) {
    delete rootEntry[String(numericFolderID)];
  }
  store.persistKnownFolders();
}

function isMigrated(characterID) {
  return store.state.runtimeRoot._meta.migratedCharacterIDs[String(store.toPositiveInt(characterID, 0))] === true;
}

function setMigrated(characterID) {
  store.state.runtimeRoot._meta.migratedCharacterIDs[String(store.toPositiveInt(characterID, 0))] = true;
  store.persistMeta();
}

function buildMembershipSubjects(characterID) {
  const numericCharacterID = store.toPositiveInt(characterID, 0);
  const characterRecord = store.getCharacterRecord(numericCharacterID) || {};
  return new Set([
    numericCharacterID,
    store.toPositiveInt(characterRecord.corporationID, 0),
    store.toPositiveInt(characterRecord.allianceID, 0),
  ].filter((entry) => entry > 0));
}

function isCharacterInGroup(characterID, groupID) {
  const group = store.state.groupsByID.get(store.toPositiveInt(groupID, 0));
  if (!group) {
    return false;
  }
  const subjects = buildMembershipSubjects(characterID);
  if (subjects.has(store.toPositiveInt(group.creatorID, 0)) && store.toPositiveInt(group.creatorID, 0) !== OWNER_SYSTEM) {
    return true;
  }
  for (const adminID of Array.isArray(group.admins) ? group.admins : []) {
    if (subjects.has(store.toPositiveInt(adminID, 0))) {
      return true;
    }
  }
  for (const memberID of Array.isArray(group.members) ? group.members : []) {
    if (subjects.has(store.toPositiveInt(memberID, 0))) {
      return true;
    }
  }
  return false;
}

function resolveFolderAccessLevel(characterID, folderID) {
  const folder = store.state.foldersByID.get(store.toPositiveInt(folderID, 0));
  if (!folder) {
    return ACCESS_NONE;
  }
  const numericCharacterID = store.toPositiveInt(characterID, 0);
  if (folder.isPersonal) {
    return folder.creatorID === numericCharacterID ? ACCESS_PERSONAL : ACCESS_NONE;
  }
  if (folder.adminGroupID && isCharacterInGroup(numericCharacterID, folder.adminGroupID)) {
    return ACCESS_ADMIN;
  }
  if (folder.manageGroupID && isCharacterInGroup(numericCharacterID, folder.manageGroupID)) {
    return ACCESS_MANAGE;
  }
  if (folder.useGroupID && isCharacterInGroup(numericCharacterID, folder.useGroupID)) {
    return ACCESS_USE;
  }
  if (folder.viewGroupID && isCharacterInGroup(numericCharacterID, folder.viewGroupID)) {
    return ACCESS_VIEW;
  }
  return ACCESS_NONE;
}

function listBookmarksForFolder(folderID) {
  return [...(store.state.bookmarkIDsByFolderID.get(store.toPositiveInt(folderID, 0)) || new Set())]
    .map((bookmarkID) => store.state.bookmarksByID.get(bookmarkID))
    .filter(Boolean)
    .sort((left, right) => left.bookmarkID - right.bookmarkID);
}

function listSubfoldersForFolder(folderID) {
  return [...(store.state.subfolderIDsByFolderID.get(store.toPositiveInt(folderID, 0)) || new Set())]
    .map((subfolderID) => store.state.subfoldersByID.get(subfolderID))
    .filter(Boolean)
    .sort((left, right) => left.subfolderID - right.subfolderID);
}

function getFolderCapacity(folder) {
  return folder && folder.isPersonal
    ? MAX_BOOKMARKS_IN_PERSONAL_FOLDER
    : MAX_BOOKMARKS_IN_SHARED_FOLDER;
}

function getBookmarkCountInFolder(folderID) {
  return (store.state.bookmarkIDsByFolderID.get(store.toPositiveInt(folderID, 0)) || new Set()).size;
}

function getKnownFolderCount(characterID) {
  const knownMap = getKnownFolderStateMap(characterID, false);
  return knownMap ? knownMap.size : 0;
}

function getActiveFolderCount(characterID, isPersonal) {
  const knownMap = getKnownFolderStateMap(characterID, false);
  if (!knownMap) {
    return 0;
  }
  let count = 0;
  for (const record of knownMap.values()) {
    const folder = store.state.foldersByID.get(record.folderID);
    if (!folder || folder.isPersonal !== isPersonal) {
      continue;
    }
    if (record.isActive === true && resolveFolderAccessLevel(characterID, folder.folderID) > ACCESS_NONE) {
      count += 1;
    }
  }
  return count;
}

function validateActiveFolderLimit(characterID, folder) {
  const maxActive = folder.isPersonal
    ? MAX_ACTIVE_PERSONAL_BOOKMARK_FOLDERS
    : MAX_ACTIVE_SHARED_BOOKMARK_FOLDERS;
  if (getActiveFolderCount(characterID, folder.isPersonal) >= maxActive) {
    throw new Error("TooManyActiveFolders");
  }
}

function resolveFolderView(characterID, folderID) {
  const folder = store.state.foldersByID.get(store.toPositiveInt(folderID, 0)) || null;
  if (!folder) {
    return null;
  }
  const accessLevel = resolveFolderAccessLevel(characterID, folder.folderID);
  if (accessLevel <= ACCESS_NONE) {
    return null;
  }
  const known = getKnownFolderRecord(characterID, folder.folderID);
  return {
    folder,
    accessLevel,
    isActive: known ? known.isActive === true : folder.isPersonal,
  };
}

function listKnownFoldersForCharacter(characterID) {
  const knownMap = getKnownFolderStateMap(characterID, false);
  if (!knownMap) {
    return [];
  }
  return [...knownMap.values()]
    .map((entry) => ({
      folder: store.state.foldersByID.get(entry.folderID) || null,
      isActive: entry.isActive === true,
    }))
    .filter((entry) => entry.folder)
    .filter((entry) => resolveFolderAccessLevel(characterID, entry.folder.folderID) > ACCESS_NONE)
    .sort((left, right) => left.folder.folderID - right.folder.folderID);
}

function buildCoordinateBookmarkPayload(systemID, x, y, z) {
  return {
    itemID: store.toPositiveInt(systemID, 0),
    typeID: TYPE_SOLAR_SYSTEM,
    locationID: store.toPositiveInt(systemID, 0),
    x: Number(x) || 0,
    y: Number(y) || 0,
    z: Number(z) || 0,
  };
}

module.exports = {
  MAX_BOOKMARKS_SENT_TO_CLIENT,
  MAX_KNOWN_BOOKMARK_FOLDERS,
  allocateBookmarkID,
  allocateFolderID,
  allocateGroupID,
  allocateSubfolderID,
  buildCoordinateBookmarkPayload,
  buildDefaultGroupName,
  getActiveFolderCount,
  getBookmarkCountInFolder,
  getCharacterCorporationID,
  getFolderCapacity,
  getKnownFolderCount,
  getKnownFolderRecord,
  getKnownFolderStateMap,
  isCharacterInGroup,
  isMigrated,
  listBookmarksForFolder,
  listKnownFoldersForCharacter,
  listSubfoldersForFolder,
  removeBookmarkRecord,
  removeFolderRecord,
  removeKnownFolderRecord,
  removeSubfolderRecord,
  resolveFolderAccessLevel,
  resolveFolderView,
  setMigrated,
  touchLegacyMaximums,
  upsertBookmarkRecord,
  upsertFolderRecord,
  upsertGroupRecord,
  upsertSubfolderRecord,
  validateActiveFolderLimit,
  writeKnownFolderRecord,
};
