const path = require("path");

const {
  currentFileTime,
  normalizeBigInt,
  normalizeText,
  normalizeNumber,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const signatureRuntime = require(path.join(
  __dirname,
  "../exploration/signatures/signatureRuntime",
));
const {
  MAX_BOOKMARKS_SENT_TO_CLIENT,
  MAX_ACTIVE_PERSONAL_BOOKMARK_FOLDERS,
  MAX_ACTIVE_SHARED_BOOKMARK_FOLDERS,
  MAX_KNOWN_BOOKMARK_FOLDERS,
  MAX_BOOKMARK_NAME_LENGTH,
  MAX_BOOKMARK_DESCRIPTION_LENGTH,
  MAX_FOLDER_NAME_LENGTH,
  MAX_FOLDER_DESCRIPTION_LENGTH,
  MAX_SUBFOLDERS,
  ACCESS_ADMIN,
  ACCESS_MANAGE,
  ACCESS_NONE,
  ACCESS_PERSONAL,
  ACCESS_USE,
  ACCESS_VIEW,
  BOOKMARK_EXPIRY_NONE,
  BOOKMARK_EXPIRY_4HOURS,
  BOOKMARK_EXPIRY_24HOURS,
  BOOKMARK_EXPIRY_2DAYS,
  TYPE_SOLAR_SYSTEM,
} = require(path.join(__dirname, "./bookmarkConstants"));
const access = require(path.join(__dirname, "./bookmarkRuntimeAccess"));
const store = require(path.join(__dirname, "./bookmarkRuntimeStore"));

const LOCATION_TYPE_REGION = 3;
const LOCATION_TYPE_CONSTELLATION = 4;
const EXPIRY_SWEEP_INTERVAL_MS = 60 * 1000;

let lastExpirySweepAtMs = 0;

function bookmarkError(code) {
  const error = new Error(String(code || "BOOKMARK_ERROR"));
  error.bookmarkError = String(code || "BOOKMARK_ERROR");
  return error;
}

function toInt(value, fallback = 0) {
  return store.toInt(value, fallback);
}

function toPositiveInt(value, fallback = 0) {
  return store.toPositiveInt(value, fallback);
}

function toOptionalInt(value) {
  return store.toOptionalInt(value);
}

function filetimeToBigInt(value, fallback = 0n) {
  return normalizeBigInt(value, fallback);
}

function sanitizeBookmarkName(value, fallback = "Location") {
  return normalizeText(value, fallback).trim().slice(0, MAX_BOOKMARK_NAME_LENGTH) || fallback;
}

function sanitizeBookmarkNote(value) {
  return normalizeText(value, "").slice(0, MAX_BOOKMARK_DESCRIPTION_LENGTH);
}

function sanitizeFolderName(value, fallback = "Folder") {
  return normalizeText(value, fallback).trim().slice(0, MAX_FOLDER_NAME_LENGTH) || fallback;
}

function sanitizeFolderDescription(value) {
  return normalizeText(value, "").slice(0, MAX_FOLDER_DESCRIPTION_LENGTH);
}

function sanitizeSubfolderName(value, fallback = "Subfolder") {
  return normalizeText(value, fallback).trim().slice(0, MAX_FOLDER_NAME_LENGTH) || fallback;
}

function cloneRecord(record) {
  return store.cloneValue(record);
}

function canUseFolder(accessLevel) {
  return accessLevel === ACCESS_PERSONAL || accessLevel >= ACCESS_VIEW;
}

function canWriteFolder(accessLevel) {
  return accessLevel === ACCESS_PERSONAL || accessLevel >= ACCESS_USE;
}

function canManageFolder(accessLevel) {
  return accessLevel === ACCESS_PERSONAL || accessLevel >= ACCESS_MANAGE;
}

function buildRuntimeRoot() {
  const root = store.readTable(store.RUNTIME_TABLE, store.DEFAULT_RUNTIME);
  if (!root._meta || typeof root._meta !== "object") {
    root._meta = cloneRecord(store.DEFAULT_RUNTIME._meta);
  }
  root._meta.version = toInt(root._meta.version, store.DEFAULT_RUNTIME._meta.version);
  root._meta.nextBookmarkID = toPositiveInt(
    root._meta.nextBookmarkID,
    store.DEFAULT_RUNTIME._meta.nextBookmarkID,
  );
  root._meta.nextFolderID = toPositiveInt(
    root._meta.nextFolderID,
    store.DEFAULT_RUNTIME._meta.nextFolderID,
  );
  root._meta.nextSubfolderID = toPositiveInt(
    root._meta.nextSubfolderID,
    store.DEFAULT_RUNTIME._meta.nextSubfolderID,
  );
  root._meta.nextGroupID = toPositiveInt(
    root._meta.nextGroupID,
    store.DEFAULT_RUNTIME._meta.nextGroupID,
  );
  if (!root._meta.migratedCharacterIDs || typeof root._meta.migratedCharacterIDs !== "object") {
    root._meta.migratedCharacterIDs = {};
  }
  return root;
}

function buildRecordRoot(tableName) {
  const root = store.readTable(tableName, store.DEFAULT_RECORD_TABLE);
  if (!root.records || typeof root.records !== "object") {
    root.records = {};
  }
  return root;
}

function buildKnownRoot() {
  const root = store.readTable(store.KNOWN_TABLE, store.DEFAULT_KNOWN_TABLE);
  if (!root.recordsByCharacterID || typeof root.recordsByCharacterID !== "object") {
    root.recordsByCharacterID = {};
  }
  return root;
}

function setBookmarkRecord(record) {
  const normalized = store.normalizeBookmarkRecord(record);
  if (normalized.bookmarkID <= 0) {
    throw bookmarkError("BOOKMARK_ID_REQUIRED");
  }
  store.state.bookmarksByID.set(normalized.bookmarkID, normalized);
  store.state.bookmarkRoot.records[String(normalized.bookmarkID)] = cloneRecord(normalized);
  return normalized;
}

function deleteBookmarkRecord(bookmarkID) {
  const numericBookmarkID = toPositiveInt(bookmarkID, 0);
  const existing = store.state.bookmarksByID.get(numericBookmarkID) || null;
  if (!existing) {
    return null;
  }
  store.state.bookmarksByID.delete(numericBookmarkID);
  delete store.state.bookmarkRoot.records[String(numericBookmarkID)];
  return existing;
}

function setFolderRecord(record) {
  const normalized = store.normalizeFolderRecord(record);
  if (normalized.folderID <= 0) {
    throw bookmarkError("FOLDER_ID_REQUIRED");
  }
  store.state.foldersByID.set(normalized.folderID, normalized);
  store.state.folderRoot.records[String(normalized.folderID)] = cloneRecord(normalized);
  return normalized;
}

function deleteFolderRecord(folderID) {
  const numericFolderID = toPositiveInt(folderID, 0);
  const existing = store.state.foldersByID.get(numericFolderID) || null;
  if (!existing) {
    return null;
  }
  store.state.foldersByID.delete(numericFolderID);
  delete store.state.folderRoot.records[String(numericFolderID)];
  return existing;
}

function setSubfolderRecord(record) {
  const normalized = store.normalizeSubfolderRecord(record);
  if (normalized.subfolderID <= 0) {
    throw bookmarkError("SUBFOLDER_ID_REQUIRED");
  }
  store.state.subfoldersByID.set(normalized.subfolderID, normalized);
  store.state.subfolderRoot.records[String(normalized.subfolderID)] = cloneRecord(normalized);
  return normalized;
}

function deleteSubfolderRecord(subfolderID) {
  const numericSubfolderID = toPositiveInt(subfolderID, 0);
  const existing = store.state.subfoldersByID.get(numericSubfolderID) || null;
  if (!existing) {
    return null;
  }
  store.state.subfoldersByID.delete(numericSubfolderID);
  delete store.state.subfolderRoot.records[String(numericSubfolderID)];
  return existing;
}

function setGroupRecord(record) {
  const normalized = store.normalizeGroupRecord(record);
  if (normalized.groupID <= 0) {
    throw bookmarkError("GROUP_ID_REQUIRED");
  }
  store.state.groupsByID.set(normalized.groupID, normalized);
  store.state.groupRoot.records[String(normalized.groupID)] = cloneRecord(normalized);
  return normalized;
}

function setKnownFolderRecord(characterID, record) {
  const numericCharacterID = toPositiveInt(characterID, 0);
  if (numericCharacterID <= 0) {
    throw bookmarkError("CHARACTER_REQUIRED");
  }
  if (!store.state.knownFoldersByCharacterID.has(numericCharacterID)) {
    store.state.knownFoldersByCharacterID.set(numericCharacterID, new Map());
  }
  if (!store.state.knownRoot.recordsByCharacterID[String(numericCharacterID)]) {
    store.state.knownRoot.recordsByCharacterID[String(numericCharacterID)] = {};
  }
  const normalized = store.normalizeKnownFolderRecord(record);
  store.state.knownFoldersByCharacterID.get(numericCharacterID).set(
    normalized.folderID,
    normalized,
  );
  store.state.knownRoot.recordsByCharacterID[String(numericCharacterID)][String(normalized.folderID)] =
    cloneRecord(normalized);
  return normalized;
}

function deleteKnownFolderRecord(characterID, folderID) {
  const numericCharacterID = toPositiveInt(characterID, 0);
  const numericFolderID = toPositiveInt(folderID, 0);
  const knownMap = store.state.knownFoldersByCharacterID.get(numericCharacterID);
  if (!knownMap) {
    return;
  }
  knownMap.delete(numericFolderID);
  const rootEntry = store.state.knownRoot.recordsByCharacterID[String(numericCharacterID)];
  if (rootEntry) {
    delete rootEntry[String(numericFolderID)];
  }
}

function finalizeChanges({
  meta = false,
  bookmarks = false,
  folders = false,
  subfolders = false,
  known = false,
  groups = false,
  rebuild = false,
} = {}) {
  if (rebuild) {
    store.rebuildIndexes();
  }
  if (meta) {
    store.persistMeta();
  }
  if (bookmarks) {
    store.persistBookmarks();
  }
  if (folders) {
    store.persistFolders();
  }
  if (subfolders) {
    store.persistSubfolders();
  }
  if (known) {
    store.persistKnownFolders();
  }
  if (groups) {
    store.persistGroups();
  }
}

function ensureLoaded() {
  if (store.state.loaded) {
    return store.state;
  }

  store.state.runtimeRoot = buildRuntimeRoot();
  store.state.bookmarkRoot = buildRecordRoot(store.BOOKMARKS_TABLE);
  store.state.folderRoot = buildRecordRoot(store.FOLDERS_TABLE);
  store.state.subfolderRoot = buildRecordRoot(store.SUBFOLDERS_TABLE);
  store.state.knownRoot = buildKnownRoot();
  store.state.groupRoot = buildRecordRoot(store.GROUPS_TABLE);

  store.state.bookmarksByID = new Map();
  store.state.foldersByID = new Map();
  store.state.subfoldersByID = new Map();
  store.state.groupsByID = new Map();
  store.state.knownFoldersByCharacterID = new Map();

  for (const record of Object.values(store.state.bookmarkRoot.records)) {
    const normalized = store.normalizeBookmarkRecord(record);
    if (normalized.bookmarkID > 0) {
      store.state.bookmarksByID.set(normalized.bookmarkID, normalized);
      store.state.bookmarkRoot.records[String(normalized.bookmarkID)] = cloneRecord(normalized);
    }
  }

  for (const record of Object.values(store.state.folderRoot.records)) {
    const normalized = store.normalizeFolderRecord(record);
    if (normalized.folderID > 0) {
      store.state.foldersByID.set(normalized.folderID, normalized);
      store.state.folderRoot.records[String(normalized.folderID)] = cloneRecord(normalized);
    }
  }

  for (const record of Object.values(store.state.subfolderRoot.records)) {
    const normalized = store.normalizeSubfolderRecord(record);
    if (normalized.subfolderID > 0) {
      store.state.subfoldersByID.set(normalized.subfolderID, normalized);
      store.state.subfolderRoot.records[String(normalized.subfolderID)] = cloneRecord(normalized);
    }
  }

  for (const record of Object.values(store.state.groupRoot.records)) {
    const normalized = store.normalizeGroupRecord(record);
    if (normalized.groupID > 0) {
      store.state.groupsByID.set(normalized.groupID, normalized);
      store.state.groupRoot.records[String(normalized.groupID)] = cloneRecord(normalized);
    }
  }

  for (const [characterID, rawEntries] of Object.entries(store.state.knownRoot.recordsByCharacterID)) {
    const numericCharacterID = toPositiveInt(characterID, 0);
    if (numericCharacterID <= 0) {
      continue;
    }
    const knownMap = new Map();
    const rawObject =
      rawEntries && typeof rawEntries === "object" ? rawEntries : {};
    for (const record of Object.values(rawObject)) {
      const normalized = store.normalizeKnownFolderRecord(record);
      if (normalized.folderID > 0) {
        knownMap.set(normalized.folderID, normalized);
        rawObject[String(normalized.folderID)] = cloneRecord(normalized);
      }
    }
    store.state.knownFoldersByCharacterID.set(numericCharacterID, knownMap);
    store.state.knownRoot.recordsByCharacterID[String(numericCharacterID)] = rawObject;
  }

  store.rebuildIndexes();
  access.touchLegacyMaximums();
  store.state.loaded = true;
  return store.state;
}

function listPersonalFoldersForCharacter(characterID) {
  const numericCharacterID = toPositiveInt(characterID, 0);
  return [...(store.state.folderIDsByCreatorCharacterID.get(numericCharacterID) || new Set())]
    .map((folderID) => store.state.foldersByID.get(folderID))
    .filter((folder) => folder && folder.isPersonal)
    .sort((left, right) => left.folderID - right.folderID);
}

function ensureDefaultGroupForCorporation(corporationID) {
  ensureLoaded();
  const numericCorporationID = toPositiveInt(corporationID, 0);
  if (numericCorporationID <= 0) {
    return null;
  }

  const existingGroupID = store.state.defaultGroupIDByCorporationID.get(numericCorporationID);
  if (existingGroupID) {
    return store.state.groupsByID.get(existingGroupID) || null;
  }

  const group = setGroupRecord({
    groupID: access.allocateGroupID(),
    creatorID: numericCorporationID,
    name: access.buildDefaultGroupName(numericCorporationID),
    description: "",
    admins: [numericCorporationID],
    members: [numericCorporationID],
    membershipType: 2,
    created: currentFileTime().toString(),
  });
  finalizeChanges({ groups: true, rebuild: true });
  return group;
}

function ensureDefaultPersonalFolder(characterID) {
  ensureLoaded();
  const numericCharacterID = toPositiveInt(characterID, 0);
  if (numericCharacterID <= 0) {
    throw bookmarkError("CHARACTER_REQUIRED");
  }

  const existingFolders = listPersonalFoldersForCharacter(numericCharacterID);
  if (existingFolders.length > 0) {
    let touchedKnown = false;
    for (const folder of existingFolders) {
      if (!access.getKnownFolderRecord(numericCharacterID, folder.folderID)) {
        setKnownFolderRecord(numericCharacterID, {
          folderID: folder.folderID,
          isActive: true,
        });
        touchedKnown = true;
      }
    }
    if (touchedKnown) {
      finalizeChanges({ known: true });
    }
    return existingFolders[0];
  }

  const folder = setFolderRecord({
    folderID: access.allocateFolderID(),
    folderName: "Personal Locations",
    description: "",
    creatorID: numericCharacterID,
    isPersonal: true,
    created: currentFileTime().toString(),
  });
  setKnownFolderRecord(numericCharacterID, {
    folderID: folder.folderID,
    isActive: true,
  });
  finalizeChanges({ folders: true, known: true, rebuild: true });
  return folder;
}

function migrateLegacyBookmarksForCharacter(characterID) {
  ensureLoaded();
  const numericCharacterID = toPositiveInt(characterID, 0);
  if (numericCharacterID <= 0 || access.isMigrated(numericCharacterID)) {
    return;
  }

  const characterRecord = store.getCharacterRecord(numericCharacterID);
  if (!characterRecord) {
    access.setMigrated(numericCharacterID);
    return;
  }

  const legacyFolders = Array.isArray(characterRecord.bookmarkFolders)
    ? characterRecord.bookmarkFolders
    : [];
  const legacyBookmarks = Array.isArray(characterRecord.bookmarks)
    ? characterRecord.bookmarks
    : [];
  const folderIDMap = new Map();
  let touchedFolders = false;
  let touchedBookmarks = false;
  let touchedKnown = false;

  for (const legacyFolder of legacyFolders) {
    const normalizedLegacyFolderID = toPositiveInt(legacyFolder && legacyFolder.folderID, 0);
    const newFolder = setFolderRecord({
      folderID: access.allocateFolderID(),
      folderName: sanitizeFolderName(
        legacyFolder && legacyFolder.folderName,
        "Personal Locations",
      ),
      description: sanitizeFolderDescription(legacyFolder && legacyFolder.description),
      creatorID: numericCharacterID,
      isPersonal: true,
      created: legacyFolder && legacyFolder.created,
    });
    folderIDMap.set(normalizedLegacyFolderID, newFolder.folderID);
    setKnownFolderRecord(numericCharacterID, {
      folderID: newFolder.folderID,
      isActive: true,
    });
    touchedFolders = true;
    touchedKnown = true;
  }

  if (legacyFolders.length <= 0) {
    const defaultFolder = ensureDefaultPersonalFolder(numericCharacterID);
    folderIDMap.set(0, defaultFolder.folderID);
  }

  for (const legacyBookmark of legacyBookmarks) {
    const bookmarkID = toPositiveInt(legacyBookmark && legacyBookmark.bookmarkID, 0);
    const folderID =
      folderIDMap.get(toPositiveInt(legacyBookmark && legacyBookmark.folderID, 0)) ||
      folderIDMap.get(0) ||
      ensureDefaultPersonalFolder(numericCharacterID).folderID;
    const targetBookmarkID =
      bookmarkID > 0 && !store.state.bookmarksByID.has(bookmarkID)
        ? bookmarkID
        : access.allocateBookmarkID();
    setBookmarkRecord({
      bookmarkID: targetBookmarkID,
      folderID,
      itemID: legacyBookmark && legacyBookmark.itemID,
      typeID: legacyBookmark && legacyBookmark.typeID,
      memo: sanitizeBookmarkName(legacyBookmark && legacyBookmark.memo),
      note: sanitizeBookmarkNote(legacyBookmark && legacyBookmark.note),
      created: legacyBookmark && legacyBookmark.created,
      expiry: legacyBookmark && legacyBookmark.expiry,
      x: legacyBookmark && legacyBookmark.x,
      y: legacyBookmark && legacyBookmark.y,
      z: legacyBookmark && legacyBookmark.z,
      locationID: legacyBookmark && legacyBookmark.locationID,
      subfolderID: null,
      creatorID: numericCharacterID,
    });
    touchedBookmarks = true;
  }

  access.setMigrated(numericCharacterID);
  finalizeChanges({
    folders: touchedFolders,
    bookmarks: touchedBookmarks,
    known: touchedKnown,
    rebuild: touchedFolders || touchedBookmarks,
  });
}

function ensureCharacterReady(characterID) {
  ensureLoaded();
  const numericCharacterID = toPositiveInt(characterID, 0);
  if (numericCharacterID <= 0) {
    throw bookmarkError("CHARACTER_REQUIRED");
  }
  migrateLegacyBookmarksForCharacter(numericCharacterID);
  ensureDefaultPersonalFolder(numericCharacterID);
  const corporationID = access.getCharacterCorporationID(numericCharacterID);
  if (corporationID > 0) {
    ensureDefaultGroupForCorporation(corporationID);
  }
  cleanupExpiredBookmarks();
  return numericCharacterID;
}

function cleanupExpiredBookmarks() {
  ensureLoaded();
  const nowMs = Date.now();
  if (nowMs - lastExpirySweepAtMs < EXPIRY_SWEEP_INTERVAL_MS) {
    return [];
  }
  lastExpirySweepAtMs = nowMs;

  const nowFiletime = currentFileTime();
  const expiredBookmarkIDs = [];
  for (const bookmark of store.state.bookmarksByID.values()) {
    if (!bookmark.expiry) {
      continue;
    }
    if (filetimeToBigInt(bookmark.expiry, 0n) <= nowFiletime) {
      expiredBookmarkIDs.push(bookmark.bookmarkID);
    }
  }
  if (expiredBookmarkIDs.length <= 0) {
    return [];
  }
  for (const bookmarkID of expiredBookmarkIDs) {
    deleteBookmarkRecord(bookmarkID);
  }
  finalizeChanges({ bookmarks: true, rebuild: true });
  return expiredBookmarkIDs;
}

function listFolderViews(characterID) {
  const numericCharacterID = ensureCharacterReady(characterID);
  const viewsByFolderID = new Map();

  for (const folder of listPersonalFoldersForCharacter(numericCharacterID)) {
    const view = access.resolveFolderView(numericCharacterID, folder.folderID);
    if (view) {
      viewsByFolderID.set(folder.folderID, view);
    }
  }

  for (const entry of access.listKnownFoldersForCharacter(numericCharacterID)) {
    const view = access.resolveFolderView(numericCharacterID, entry.folder.folderID);
    if (view) {
      viewsByFolderID.set(entry.folder.folderID, view);
    }
  }

  return [...viewsByFolderID.values()].sort((left, right) => {
    if (left.folder.isPersonal !== right.folder.isPersonal) {
      return left.folder.isPersonal ? -1 : 1;
    }
    return left.folder.folderName.localeCompare(right.folder.folderName) ||
      (left.folder.folderID - right.folder.folderID);
  });
}

function getFolderInfo(characterID, folderID) {
  const numericCharacterID = ensureCharacterReady(characterID);
  const view = access.resolveFolderView(numericCharacterID, folderID);
  if (!store.state.foldersByID.has(toPositiveInt(folderID, 0))) {
    throw bookmarkError("BookmarkFolderNoLongerThere");
  }
  if (!view) {
    throw bookmarkError("FolderAccessDenied");
  }
  return view;
}

function listActiveBookmarksForCharacter(characterID) {
  const bookmarks = [];
  const activeFolderIDs = new Set(
    listFolderViews(characterID)
      .filter((view) => view.isActive)
      .map((view) => view.folder.folderID),
  );
  for (const folderID of activeFolderIDs) {
    for (const bookmark of access.listBookmarksForFolder(folderID)) {
      bookmarks.push(bookmark);
      if (bookmarks.length >= MAX_BOOKMARKS_SENT_TO_CLIENT) {
        return bookmarks;
      }
    }
  }
  return bookmarks;
}

function listActiveSubfoldersForCharacter(characterID) {
  const subfolders = [];
  for (const view of listFolderViews(characterID)) {
    if (!view.isActive) {
      continue;
    }
    subfolders.push(...access.listSubfoldersForFolder(view.folder.folderID));
  }
  return subfolders;
}

function getMyActiveBookmarks(characterID) {
  const numericCharacterID = ensureCharacterReady(characterID);
  return {
    folders: listFolderViews(numericCharacterID),
    bookmarks: listActiveBookmarksForCharacter(numericCharacterID),
    subfolders: listActiveSubfoldersForCharacter(numericCharacterID),
  };
}

function getBookmark(bookmarkID) {
  ensureLoaded();
  cleanupExpiredBookmarks();
  return store.state.bookmarksByID.get(toPositiveInt(bookmarkID, 0)) || null;
}

function getBookmarkForCharacter(characterID, bookmarkID, options = {}) {
  const numericCharacterID = ensureCharacterReady(characterID);
  const bookmark = getBookmark(bookmarkID);
  if (!bookmark) {
    return null;
  }
  const view = access.resolveFolderAccessLevel(numericCharacterID, bookmark.folderID) > ACCESS_NONE
    ? access.resolveFolderView(numericCharacterID, bookmark.folderID)
    : null;
  if (!view) {
    return null;
  }
  if (options.requireActive === true && view.isActive !== true) {
    return null;
  }
  return {
    bookmark,
    folder: view.folder,
    accessLevel: view.accessLevel,
    isActive: view.isActive,
  };
}

function listFoldersWithAdminAccess(characterID) {
  const numericCharacterID = ensureCharacterReady(characterID);
  return [...store.state.foldersByID.values()]
    .filter((folder) => !folder.isPersonal)
    .map((folder) => access.resolveFolderView(numericCharacterID, folder.folderID))
    .filter(Boolean)
    .filter((view) => view.accessLevel >= ACCESS_ADMIN)
    .sort((left, right) => left.folder.folderName.localeCompare(right.folder.folderName));
}

function listGroupsForCharacter(characterID) {
  const numericCharacterID = ensureCharacterReady(characterID);
  return [...store.state.groupsByID.values()]
    .filter((group) => access.isCharacterInGroup(numericCharacterID, group.groupID))
    .sort((left, right) => left.name.localeCompare(right.name) || left.groupID - right.groupID);
}

function getGroupForCharacter(characterID, groupID) {
  const group = store.state.groupsByID.get(toPositiveInt(groupID, 0)) || null;
  if (!group) {
    return null;
  }
  return access.isCharacterInGroup(ensureCharacterReady(characterID), group.groupID)
    ? group
    : null;
}

function getGroupsManyForCharacter(characterID, groupIDs = []) {
  const numericCharacterID = ensureCharacterReady(characterID);
  return (Array.isArray(groupIDs) ? groupIDs : [])
    .map((groupID) => store.state.groupsByID.get(toPositiveInt(groupID, 0)) || null)
    .filter(Boolean)
    .filter((group) => access.isCharacterInGroup(numericCharacterID, group.groupID));
}

function translateExpiryToFiletime(expiryMode, nowFiletime = currentFileTime()) {
  const normalizedExpiry = toInt(expiryMode, BOOKMARK_EXPIRY_NONE);
  switch (normalizedExpiry) {
    case BOOKMARK_EXPIRY_4HOURS:
      return (nowFiletime + (4n * 60n * 60n * 10_000_000n)).toString();
    case BOOKMARK_EXPIRY_24HOURS:
      return (nowFiletime + (24n * 60n * 60n * 10_000_000n)).toString();
    case BOOKMARK_EXPIRY_2DAYS:
      return (nowFiletime + (48n * 60n * 60n * 10_000_000n)).toString();
    case BOOKMARK_EXPIRY_NONE:
    default:
      return null;
  }
}

function resolveStaticBookmarkTarget(itemID, session = null) {
  const numericItemID = toPositiveInt(itemID, 0);
  if (numericItemID <= 0) {
    return null;
  }

  const station = worldData.getStationByID(numericItemID);
  if (station) {
    return {
      itemID: station.stationID,
      typeID: toPositiveInt(station.stationTypeID, TYPE_SOLAR_SYSTEM),
      locationID: toPositiveInt(station.solarSystemID, 0),
      x: null,
      y: null,
      z: null,
    };
  }

  const structure = worldData.getStructureByID(numericItemID);
  if (structure) {
    return {
      itemID: structure.structureID,
      typeID: toPositiveInt(structure.typeID, TYPE_SOLAR_SYSTEM),
      locationID: toPositiveInt(structure.solarSystemID, 0),
      x: null,
      y: null,
      z: null,
    };
  }

  const stargate = worldData.getStargateByID(numericItemID);
  if (stargate) {
    return {
      itemID: stargate.itemID,
      typeID: toPositiveInt(stargate.typeID, TYPE_SOLAR_SYSTEM),
      locationID: toPositiveInt(stargate.solarSystemID, 0),
      x: null,
      y: null,
      z: null,
    };
  }

  const asteroidBelt = worldData.getAsteroidBeltByID(numericItemID);
  if (asteroidBelt) {
    return {
      itemID: asteroidBelt.itemID,
      typeID: toPositiveInt(asteroidBelt.typeID, TYPE_SOLAR_SYSTEM),
      locationID: toPositiveInt(asteroidBelt.solarSystemID, 0),
      x: null,
      y: null,
      z: null,
    };
  }

  const celestial = worldData.getCelestialByID(numericItemID);
  if (celestial) {
    return {
      itemID: celestial.itemID,
      typeID: toPositiveInt(celestial.typeID, TYPE_SOLAR_SYSTEM),
      locationID: toPositiveInt(celestial.solarSystemID, 0),
      x: null,
      y: null,
      z: null,
    };
  }

  const system = worldData.getSolarSystemByID(numericItemID);
  if (system) {
    return {
      itemID: system.solarSystemID,
      typeID: TYPE_SOLAR_SYSTEM,
      locationID: system.solarSystemID,
      x: null,
      y: null,
      z: null,
    };
  }

  const sessionConstellationID = toPositiveInt(
    session && (session.constellationID || session.constellationid),
    0,
  );
  if (numericItemID === sessionConstellationID) {
    return {
      itemID: numericItemID,
      typeID: LOCATION_TYPE_CONSTELLATION,
      locationID: numericItemID,
      x: null,
      y: null,
      z: null,
    };
  }

  const sessionRegionID = toPositiveInt(
    session && (session.regionID || session.regionid),
    0,
  );
  if (numericItemID === sessionRegionID) {
    return {
      itemID: numericItemID,
      typeID: LOCATION_TYPE_REGION,
      locationID: numericItemID,
      x: null,
      y: null,
      z: null,
    };
  }

  return null;
}

function resolveScanBookmarkTarget(locationID, resultID) {
  const numericLocationID = toPositiveInt(locationID, 0);
  const numericResultID = toPositiveInt(resultID, 0);
  if (numericLocationID <= 0 || numericResultID <= 0) {
    return null;
  }
  const site = signatureRuntime
    .listSystemSignatureSites(numericLocationID)
    .find((candidate) => candidate.siteID === numericResultID);
  if (!site) {
    return null;
  }
  return {
    itemID: null,
    typeID: TYPE_SOLAR_SYSTEM,
    locationID: numericLocationID,
    x: normalizeNumber(site.actualPosition && site.actualPosition.x, 0),
    y: normalizeNumber(site.actualPosition && site.actualPosition.y, 0),
    z: normalizeNumber(site.actualPosition && site.actualPosition.z, 0),
  };
}

function createBookmark(characterID, data = {}) {
  const numericCharacterID = ensureCharacterReady(characterID);
  const folderView = getFolderInfo(numericCharacterID, data.folderID);
  if (!canWriteFolder(folderView.accessLevel)) {
    throw bookmarkError("FolderAccessDenied");
  }
  if (access.getBookmarkCountInFolder(folderView.folder.folderID) >= access.getFolderCapacity(folderView.folder)) {
    throw bookmarkError("FolderCapacityExceeded");
  }
  if (data.subfolderID) {
    const subfolder = store.state.subfoldersByID.get(toPositiveInt(data.subfolderID, 0)) || null;
    if (!subfolder || subfolder.folderID !== folderView.folder.folderID) {
      throw bookmarkError("BookmarkSubfolderNoLongerThere");
    }
  }

  const bookmark = setBookmarkRecord({
    bookmarkID: access.allocateBookmarkID(),
    folderID: folderView.folder.folderID,
    itemID: data.itemID,
    typeID: data.typeID,
    memo: sanitizeBookmarkName(data.memo),
    note: sanitizeBookmarkNote(data.note),
    created: currentFileTime().toString(),
    expiry: translateExpiryToFiletime(data.expiryMode),
    x: data.x,
    y: data.y,
    z: data.z,
    locationID: data.locationID,
    subfolderID: data.subfolderID,
    creatorID: numericCharacterID,
    metadata:
      data.metadata && typeof data.metadata === "object"
        ? cloneRecord(data.metadata)
        : {},
  });
  finalizeChanges({ bookmarks: true, rebuild: true });
  return { bookmark, folder: folderView.folder };
}

function addFolder(characterID, options = {}) {
  const numericCharacterID = ensureCharacterReady(characterID);
  const isPersonal = options.isPersonal !== false;
  if (access.getKnownFolderCount(numericCharacterID) >= MAX_KNOWN_BOOKMARK_FOLDERS) {
    throw bookmarkError("TooManyKnownFolders");
  }

  const folder = setFolderRecord({
    folderID: access.allocateFolderID(),
    folderName: sanitizeFolderName(
      options.folderName,
      isPersonal ? "Personal Locations" : "Shared Locations",
    ),
    description: sanitizeFolderDescription(options.description),
    creatorID: numericCharacterID,
    isPersonal,
    adminGroupID: isPersonal ? null : toOptionalInt(options.adminGroupID),
    manageGroupID: isPersonal ? null : toOptionalInt(options.manageGroupID),
    useGroupID: isPersonal ? null : toOptionalInt(options.useGroupID),
    viewGroupID: isPersonal ? null : toOptionalInt(options.viewGroupID),
    created: currentFileTime().toString(),
  });

  let isActive = true;
  if (
    access.getActiveFolderCount(numericCharacterID, folder.isPersonal) >=
    (folder.isPersonal ? MAX_ACTIVE_PERSONAL_BOOKMARK_FOLDERS : MAX_ACTIVE_SHARED_BOOKMARK_FOLDERS)
  ) {
    isActive = false;
  }
  setKnownFolderRecord(numericCharacterID, {
    folderID: folder.folderID,
    isActive,
  });
  finalizeChanges({ folders: true, known: true, rebuild: true });
  return access.resolveFolderView(numericCharacterID, folder.folderID);
}

function updateFolder(characterID, folderID, options = {}) {
  const numericCharacterID = ensureCharacterReady(characterID);
  const view = getFolderInfo(numericCharacterID, folderID);
  if (!view.folder.isPersonal && view.accessLevel < ACCESS_ADMIN) {
    throw bookmarkError("AdminAccessRequired");
  }
  const updatedFolder = setFolderRecord({
    ...view.folder,
    folderName: sanitizeFolderName(options.folderName, view.folder.folderName),
    description: sanitizeFolderDescription(options.description),
    adminGroupID: view.folder.isPersonal ? null : toOptionalInt(options.adminGroupID),
    manageGroupID: view.folder.isPersonal ? null : toOptionalInt(options.manageGroupID),
    useGroupID: view.folder.isPersonal ? null : toOptionalInt(options.useGroupID),
    viewGroupID: view.folder.isPersonal ? null : toOptionalInt(options.viewGroupID),
  });
  finalizeChanges({ folders: true, rebuild: true });
  const newAccessLevel = access.resolveFolderAccessLevel(numericCharacterID, updatedFolder.folderID);
  return {
    folder: updatedFolder,
    accessLevel: newAccessLevel,
  };
}

function deleteFolder(characterID, folderID) {
  const numericCharacterID = ensureCharacterReady(characterID);
  const view = getFolderInfo(numericCharacterID, folderID);
  if (!view.folder.isPersonal && view.accessLevel < ACCESS_ADMIN) {
    throw bookmarkError("AdminAccessRequired");
  }

  const deletedBookmarkIDs = access.listBookmarksForFolder(view.folder.folderID).map(
    (bookmark) => bookmark.bookmarkID,
  );
  const deletedSubfolderIDs = access.listSubfoldersForFolder(view.folder.folderID).map(
    (subfolder) => subfolder.subfolderID,
  );

  for (const bookmarkID of deletedBookmarkIDs) {
    deleteBookmarkRecord(bookmarkID);
  }
  for (const subfolderID of deletedSubfolderIDs) {
    deleteSubfolderRecord(subfolderID);
  }
  for (const knownCharacterID of [...store.state.knownFoldersByCharacterID.keys()]) {
    deleteKnownFolderRecord(knownCharacterID, view.folder.folderID);
  }
  deleteFolderRecord(view.folder.folderID);
  finalizeChanges({
    bookmarks: deletedBookmarkIDs.length > 0,
    subfolders: deletedSubfolderIDs.length > 0,
    folders: true,
    known: true,
    rebuild: true,
  });
  return {
    folder: view.folder,
    deletedBookmarkIDs,
    deletedSubfolderIDs,
  };
}

function addKnownFolder(characterID, folderID, isActive) {
  const numericCharacterID = ensureCharacterReady(characterID);
  const view = getFolderInfo(numericCharacterID, folderID);
  let targetActive = isActive === true;
  if (
    targetActive &&
    access.getActiveFolderCount(numericCharacterID, view.folder.isPersonal) >=
      (view.folder.isPersonal ? MAX_ACTIVE_PERSONAL_BOOKMARK_FOLDERS : MAX_ACTIVE_SHARED_BOOKMARK_FOLDERS)
  ) {
    targetActive = false;
  }
  setKnownFolderRecord(numericCharacterID, {
    folderID: view.folder.folderID,
    isActive: targetActive,
  });
  finalizeChanges({ known: true });
  const nextView = access.resolveFolderView(numericCharacterID, view.folder.folderID);
  return {
    folder: nextView,
    bookmarks: nextView && nextView.isActive ? access.listBookmarksForFolder(nextView.folder.folderID) : [],
    subfolders: nextView && nextView.isActive ? access.listSubfoldersForFolder(nextView.folder.folderID) : [],
  };
}

function removeKnownFolder(characterID, folderID) {
  const numericCharacterID = ensureCharacterReady(characterID);
  getFolderInfo(numericCharacterID, folderID);
  deleteKnownFolderRecord(numericCharacterID, folderID);
  finalizeChanges({ known: true });
  return true;
}

function updateKnownFolderState(characterID, folderID, isActive) {
  const numericCharacterID = ensureCharacterReady(characterID);
  const view = getFolderInfo(numericCharacterID, folderID);
  if (isActive) {
    access.validateActiveFolderLimit(numericCharacterID, view.folder);
  }
  setKnownFolderRecord(numericCharacterID, {
    folderID: view.folder.folderID,
    isActive: isActive === true,
  });
  finalizeChanges({ known: true });
  const nextView = access.resolveFolderView(numericCharacterID, view.folder.folderID);
  return {
    folder: nextView,
    bookmarks: nextView && nextView.isActive ? access.listBookmarksForFolder(nextView.folder.folderID) : [],
    subfolders: nextView && nextView.isActive ? access.listSubfoldersForFolder(nextView.folder.folderID) : [],
  };
}

function createSubfolder(characterID, folderID, subfolderName) {
  const view = getFolderInfo(characterID, folderID);
  if (!canWriteFolder(view.accessLevel)) {
    throw bookmarkError("FolderAccessDenied");
  }
  if (access.listSubfoldersForFolder(view.folder.folderID).length >= MAX_SUBFOLDERS) {
    throw bookmarkError("MAX_SUBFOLDERS");
  }
  const subfolder = setSubfolderRecord({
    subfolderID: access.allocateSubfolderID(),
    folderID: view.folder.folderID,
    subfolderName: sanitizeSubfolderName(subfolderName),
    creatorID: toPositiveInt(characterID, 0),
    created: currentFileTime().toString(),
  });
  finalizeChanges({ subfolders: true, rebuild: true });
  return subfolder;
}

function updateSubfolder(characterID, folderID, subfolderID, subfolderName) {
  const view = getFolderInfo(characterID, folderID);
  if (!canWriteFolder(view.accessLevel)) {
    throw bookmarkError("FolderAccessDenied");
  }
  const subfolder = store.state.subfoldersByID.get(toPositiveInt(subfolderID, 0)) || null;
  if (!subfolder || subfolder.folderID !== view.folder.folderID) {
    return false;
  }
  setSubfolderRecord({
    ...subfolder,
    subfolderName: sanitizeSubfolderName(subfolderName, subfolder.subfolderName),
  });
  finalizeChanges({ subfolders: true, rebuild: true });
  return true;
}

function deleteSubfolder(characterID, folderID, subfolderID) {
  const numericCharacterID = ensureCharacterReady(characterID);
  const view = getFolderInfo(numericCharacterID, folderID);
  if (!canWriteFolder(view.accessLevel)) {
    throw bookmarkError("FolderAccessDenied");
  }
  const subfolder = store.state.subfoldersByID.get(toPositiveInt(subfolderID, 0)) || null;
  if (!subfolder || subfolder.folderID !== view.folder.folderID) {
    throw bookmarkError("BookmarkSubfolderNoLongerThere");
  }

  const deletedBookmarkIDs = [];
  for (const bookmark of access.listBookmarksForFolder(view.folder.folderID)) {
    if (bookmark.subfolderID !== subfolder.subfolderID) {
      continue;
    }
    if (
      canManageFolder(view.accessLevel) ||
      toPositiveInt(bookmark.creatorID, 0) === numericCharacterID
    ) {
      deletedBookmarkIDs.push(bookmark.bookmarkID);
      deleteBookmarkRecord(bookmark.bookmarkID);
      continue;
    }
    throw bookmarkError("CouldNotDeleteBookmarksInSubfolder");
  }

  deleteSubfolderRecord(subfolder.subfolderID);
  finalizeChanges({
    subfolders: true,
    bookmarks: deletedBookmarkIDs.length > 0,
    rebuild: true,
  });
  return deletedBookmarkIDs;
}

function updateBookmark(characterID, bookmarkID, oldFolderID, name, note, subfolderID, newFolderID, expiryCancel = false) {
  const numericCharacterID = ensureCharacterReady(characterID);
  const bookmarkView = getBookmarkForCharacter(numericCharacterID, bookmarkID) || null;
  if (!bookmarkView || bookmarkView.bookmark.folderID !== toPositiveInt(oldFolderID, 0)) {
    throw bookmarkError("BookmarkNotAvailable");
  }
  const oldAccessLevel = bookmarkView.accessLevel;
  if (
    !canWriteFolder(oldAccessLevel) ||
    (!canManageFolder(oldAccessLevel) &&
      toPositiveInt(bookmarkView.bookmark.creatorID, 0) !== numericCharacterID)
  ) {
    throw bookmarkError("FolderAccessDenied");
  }
  const targetFolderView = getFolderInfo(numericCharacterID, newFolderID);
  if (!canWriteFolder(targetFolderView.accessLevel)) {
    throw bookmarkError("FolderAccessDenied");
  }
  if (subfolderID) {
    const subfolder = store.state.subfoldersByID.get(toPositiveInt(subfolderID, 0)) || null;
    if (!subfolder || subfolder.folderID !== targetFolderView.folder.folderID) {
      throw bookmarkError("BookmarkSubfolderNoLongerThere");
    }
  }
  const updatedBookmark = setBookmarkRecord({
    ...bookmarkView.bookmark,
    folderID: targetFolderView.folder.folderID,
    memo: sanitizeBookmarkName(name, bookmarkView.bookmark.memo),
    note: sanitizeBookmarkNote(note),
    subfolderID: toOptionalInt(subfolderID),
    expiry: expiryCancel === true ? null : bookmarkView.bookmark.expiry,
  });
  finalizeChanges({ bookmarks: true, rebuild: true });
  return {
    bookmark: updatedBookmark,
    oldFolderID: bookmarkView.bookmark.folderID,
    newFolderID: targetFolderView.folder.folderID,
  };
}

function deleteBookmarks(characterID, folderID, bookmarkIDs) {
  const numericCharacterID = ensureCharacterReady(characterID);
  const view = getFolderInfo(numericCharacterID, folderID);
  const deletedBookmarkIDs = [];
  for (const bookmarkID of Array.isArray(bookmarkIDs) ? bookmarkIDs : []) {
    const bookmark = store.state.bookmarksByID.get(toPositiveInt(bookmarkID, 0)) || null;
    if (!bookmark || bookmark.folderID !== view.folder.folderID) {
      continue;
    }
    if (
      canManageFolder(view.accessLevel) ||
      toPositiveInt(bookmark.creatorID, 0) === numericCharacterID
    ) {
      deleteBookmarkRecord(bookmark.bookmarkID);
      deletedBookmarkIDs.push(bookmark.bookmarkID);
    }
  }
  if (deletedBookmarkIDs.length > 0) {
    finalizeChanges({ bookmarks: true, rebuild: true });
  }
  return deletedBookmarkIDs;
}

function moveBookmarks(characterID, oldFolderID, newFolderID, subfolderID, bookmarkIDs) {
  const numericCharacterID = ensureCharacterReady(characterID);
  const sourceView = getFolderInfo(numericCharacterID, oldFolderID);
  const targetView = getFolderInfo(numericCharacterID, newFolderID);
  if (!canManageFolder(sourceView.accessLevel)) {
    throw bookmarkError("FolderAccessDenied");
  }
  if (!canWriteFolder(targetView.accessLevel)) {
    throw bookmarkError("FolderAccessDenied");
  }
  if (subfolderID) {
    const subfolder = store.state.subfoldersByID.get(toPositiveInt(subfolderID, 0)) || null;
    if (!subfolder || subfolder.folderID !== targetView.folder.folderID) {
      throw bookmarkError("BookmarkSubfolderNoLongerThere");
    }
  }
  const movedBookmarks = [];
  for (const bookmarkID of Array.isArray(bookmarkIDs) ? bookmarkIDs : []) {
    const bookmark = store.state.bookmarksByID.get(toPositiveInt(bookmarkID, 0)) || null;
    if (!bookmark || bookmark.folderID !== sourceView.folder.folderID) {
      continue;
    }
    const moved = setBookmarkRecord({
      ...bookmark,
      folderID: targetView.folder.folderID,
      subfolderID: toOptionalInt(subfolderID),
    });
    movedBookmarks.push(moved);
  }
  if (movedBookmarks.length > 0) {
    finalizeChanges({ bookmarks: true, rebuild: true });
  }
  return {
    movedBookmarks,
    oldFolderID: sourceView.folder.folderID,
    newFolderID: targetView.folder.folderID,
  };
}

function copyBookmarks(characterID, oldFolderID, newFolderID, subfolderID, bookmarkIDs) {
  const numericCharacterID = ensureCharacterReady(characterID);
  getFolderInfo(numericCharacterID, oldFolderID);
  const targetView = getFolderInfo(numericCharacterID, newFolderID);
  if (!canWriteFolder(targetView.accessLevel)) {
    throw bookmarkError("FolderAccessDenied");
  }
  if (subfolderID) {
    const subfolder = store.state.subfoldersByID.get(toPositiveInt(subfolderID, 0)) || null;
    if (!subfolder || subfolder.folderID !== targetView.folder.folderID) {
      throw bookmarkError("BookmarkSubfolderNoLongerThere");
    }
  }
  const createdBookmarks = [];
  for (const bookmarkID of Array.isArray(bookmarkIDs) ? bookmarkIDs : []) {
    const bookmark = getBookmarkForCharacter(numericCharacterID, bookmarkID) || null;
    if (!bookmark || bookmark.bookmark.folderID !== toPositiveInt(oldFolderID, 0)) {
      continue;
    }
    const created = setBookmarkRecord({
      ...bookmark.bookmark,
      bookmarkID: access.allocateBookmarkID(),
      folderID: targetView.folder.folderID,
      subfolderID: toOptionalInt(subfolderID),
      creatorID: numericCharacterID,
      created: currentFileTime().toString(),
    });
    createdBookmarks.push(created);
  }
  if (createdBookmarks.length > 0) {
    finalizeChanges({ bookmarks: true, rebuild: true });
  }
  return createdBookmarks;
}

function resolveBookmarkTarget(bookmarkID) {
  const bookmark = getBookmark(bookmarkID);
  if (!bookmark) {
    return null;
  }
  const hasCoordinates =
    Number.isFinite(Number(bookmark.x)) &&
    Number.isFinite(Number(bookmark.y)) &&
    Number.isFinite(Number(bookmark.z));
  if (hasCoordinates) {
    return {
      bookmark,
      kind: "point",
      point: {
        x: normalizeNumber(bookmark.x, 0),
        y: normalizeNumber(bookmark.y, 0),
        z: normalizeNumber(bookmark.z, 0),
      },
      locationID: toPositiveInt(bookmark.locationID, 0),
      metadata:
        bookmark.metadata && typeof bookmark.metadata === "object"
          ? cloneRecord(bookmark.metadata)
          : {},
    };
  }
  if (toPositiveInt(bookmark.itemID, 0) > 0) {
    return {
      bookmark,
      kind: "item",
      itemID: toPositiveInt(bookmark.itemID, 0),
      locationID: toPositiveInt(bookmark.locationID, 0),
      metadata:
        bookmark.metadata && typeof bookmark.metadata === "object"
          ? cloneRecord(bookmark.metadata)
          : {},
    };
  }
  return null;
}

function resetRuntimeStateForTests() {
  store.state.loaded = false;
  store.state.runtimeRoot = null;
  store.state.bookmarkRoot = null;
  store.state.folderRoot = null;
  store.state.subfolderRoot = null;
  store.state.knownRoot = null;
  store.state.groupRoot = null;
  store.state.bookmarksByID = new Map();
  store.state.foldersByID = new Map();
  store.state.subfoldersByID = new Map();
  store.state.groupsByID = new Map();
  store.state.knownFoldersByCharacterID = new Map();
  store.state.bookmarkIDsByFolderID = new Map();
  store.state.bookmarkIDsBySubfolderID = new Map();
  store.state.subfolderIDsByFolderID = new Map();
  store.state.bookmarkIDsByLocationID = new Map();
  store.state.folderIDsByCreatorCharacterID = new Map();
  store.state.defaultGroupIDByCorporationID = new Map();
  lastExpirySweepAtMs = 0;
}

module.exports = {
  __resetForTests: resetRuntimeStateForTests,
  addFolder,
  addKnownFolder,
  cleanupExpiredBookmarks,
  copyBookmarks,
  createBookmark,
  createSubfolder,
  deleteBookmarks,
  deleteFolder,
  deleteSubfolder,
  ensureCharacterReady,
  ensureDefaultGroupForCorporation,
  ensureDefaultPersonalFolder,
  ensureLoaded,
  getBookmark,
  getBookmarkForCharacter,
  getFolderInfo,
  getGroupForCharacter,
  getGroupsManyForCharacter,
  getMyActiveBookmarks,
  listFolderViews,
  listFoldersWithAdminAccess,
  listGroupsForCharacter,
  migrateLegacyBookmarksForCharacter,
  moveBookmarks,
  removeKnownFolder,
  resolveBookmarkTarget,
  resolveScanBookmarkTarget,
  resolveStaticBookmarkTarget,
  translateExpiryToFiletime,
  updateBookmark,
  updateFolder,
  updateKnownFolderState,
  updateSubfolder,
};
