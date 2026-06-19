const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const {
  currentFileTime,
  normalizeBigInt,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  OWNER_SYSTEM,
  TYPE_SOLAR_SYSTEM,
} = require(path.join(__dirname, "./bookmarkConstants"));
const {
  normalizeBookmarkText,
} = require(path.join(__dirname, "./bookmarkPayloads"));

const RUNTIME_TABLE = "bookmarkRuntimeState";
const BOOKMARKS_TABLE = "bookmarks";
const FOLDERS_TABLE = "bookmarkFolders";
const SUBFOLDERS_TABLE = "bookmarkSubfolders";
const KNOWN_TABLE = "bookmarkKnownFolders";
const GROUPS_TABLE = "bookmarkGroups";
const CHARACTERS_TABLE = "characters";

const DEFAULT_RUNTIME = Object.freeze({
  _meta: {
    version: 1,
    nextBookmarkID: 900000001,
    nextFolderID: 500001,
    nextSubfolderID: 700001,
    nextGroupID: 800001,
    migratedCharacterIDs: {},
  },
});
const DEFAULT_RECORD_TABLE = Object.freeze({ records: {} });
const DEFAULT_KNOWN_TABLE = Object.freeze({ recordsByCharacterID: {} });

const state = {
  loaded: false,
  runtimeRoot: null,
  bookmarkRoot: null,
  folderRoot: null,
  subfolderRoot: null,
  knownRoot: null,
  groupRoot: null,
  bookmarksByID: new Map(),
  foldersByID: new Map(),
  subfoldersByID: new Map(),
  groupsByID: new Map(),
  knownFoldersByCharacterID: new Map(),
  bookmarkIDsByFolderID: new Map(),
  bookmarkIDsBySubfolderID: new Map(),
  subfolderIDsByFolderID: new Map(),
  bookmarkIDsByLocationID: new Map(),
  folderIDsByCreatorCharacterID: new Map(),
  defaultGroupIDByCorporationID: new Map(),
};

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = toInt(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function toOptionalInt(value) {
  const numeric = toInt(value, 0);
  return numeric > 0 ? numeric : null;
}

function toOptionalNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function filetimeNowString() {
  return currentFileTime().toString();
}

function sanitizeBookmarkCoordinates(record = {}) {
  const x = toOptionalNumber(record.x);
  const y = toOptionalNumber(record.y);
  const z = toOptionalNumber(record.z);
  const hasCoordinate =
    x !== null &&
    y !== null &&
    z !== null &&
    !(x === 0 && y === 0 && z === 0 && toInt(record.itemID, 0) !== toInt(record.locationID, 0));

  return hasCoordinate
    ? { x, y, z }
    : { x: null, y: null, z: null };
}

function normalizeBookmarkRecord(record = {}) {
  const coordinates = sanitizeBookmarkCoordinates(record);
  const metadata =
    record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? cloneValue(record.metadata)
      : {};
  return {
    bookmarkID: toPositiveInt(record.bookmarkID, 0),
    folderID: toPositiveInt(record.folderID, 0),
    itemID: toOptionalInt(record.itemID),
    typeID: toOptionalInt(record.typeID) || TYPE_SOLAR_SYSTEM,
    memo: normalizeBookmarkText(record.memo, 100, ""),
    note: normalizeBookmarkText(record.note, 3900, ""),
    created: normalizeBigInt(record.created, currentFileTime()).toString(),
    expiry: record.expiry ? normalizeBigInt(record.expiry, 0n).toString() : null,
    x: coordinates.x,
    y: coordinates.y,
    z: coordinates.z,
    locationID: toPositiveInt(record.locationID, 0),
    subfolderID: toOptionalInt(record.subfolderID),
    creatorID: toOptionalInt(record.creatorID),
    metadata,
  };
}

function normalizeFolderRecord(record = {}) {
  return {
    folderID: toPositiveInt(record.folderID, 0),
    folderName: normalizeBookmarkText(record.folderName, 40, "Personal Locations"),
    description: normalizeBookmarkText(record.description, 3900, ""),
    creatorID: toOptionalInt(record.creatorID),
    isPersonal: record.isPersonal !== false,
    adminGroupID: toOptionalInt(record.adminGroupID),
    manageGroupID: toOptionalInt(record.manageGroupID),
    useGroupID: toOptionalInt(record.useGroupID),
    viewGroupID: toOptionalInt(record.viewGroupID),
    created: normalizeBigInt(record.created, currentFileTime()).toString(),
  };
}

function normalizeSubfolderRecord(record = {}) {
  return {
    subfolderID: toPositiveInt(record.subfolderID, 0),
    folderID: toPositiveInt(record.folderID, 0),
    subfolderName: normalizeBookmarkText(record.subfolderName, 40, "Subfolder"),
    creatorID: toOptionalInt(record.creatorID),
    created: normalizeBigInt(record.created, currentFileTime()).toString(),
  };
}

function normalizeKnownFolderRecord(record = {}, defaultIsActive = true) {
  return {
    folderID: toPositiveInt(record.folderID, 0),
    isActive: Object.prototype.hasOwnProperty.call(record, "isActive")
      ? record.isActive === true
      : defaultIsActive === true,
  };
}

function normalizeGroupRecord(record = {}) {
  return {
    groupID: toPositiveInt(record.groupID, 0),
    creatorID: toPositiveInt(record.creatorID, OWNER_SYSTEM),
    name: normalizeBookmarkText(record.name, 100, "Access Group"),
    description: normalizeBookmarkText(record.description, 3900, ""),
    admins: [...new Set((Array.isArray(record.admins) ? record.admins : []).map((entry) => toPositiveInt(entry, 0)).filter((entry) => entry > 0))],
    members: [...new Set((Array.isArray(record.members) ? record.members : []).map((entry) => toPositiveInt(entry, 0)).filter((entry) => entry > 0))],
    membershipType: toInt(record.membershipType, 2),
    created: normalizeBigInt(record.created, currentFileTime()).toString(),
  };
}

function readTable(tableName, fallbackValue) {
  const result = database.read(tableName, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return cloneValue(fallbackValue);
  }
  return cloneValue(result.data);
}

function writeRoot(tableName, root) {
  const result = database.write(tableName, "/", root);
  if (!result.success) {
    throw new Error(`${tableName}:${result.errorMsg || "WRITE_FAILED"}`);
  }
}

function getCharacterTable() {
  const result = database.read(CHARACTERS_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }
  return result.data;
}

function getCharacterRecord(characterID) {
  const result = database.read(CHARACTERS_TABLE, `/${String(toPositiveInt(characterID, 0))}`);
  if (!result.success || !result.data || typeof result.data !== "object") {
    return null;
  }
  return result.data;
}

function rebuildIndexes() {
  state.bookmarkIDsByFolderID = new Map();
  state.bookmarkIDsBySubfolderID = new Map();
  state.subfolderIDsByFolderID = new Map();
  state.bookmarkIDsByLocationID = new Map();
  state.folderIDsByCreatorCharacterID = new Map();
  state.defaultGroupIDByCorporationID = new Map();

  for (const folder of state.foldersByID.values()) {
    if (folder.isPersonal && folder.creatorID) {
      if (!state.folderIDsByCreatorCharacterID.has(folder.creatorID)) {
        state.folderIDsByCreatorCharacterID.set(folder.creatorID, new Set());
      }
      state.folderIDsByCreatorCharacterID.get(folder.creatorID).add(folder.folderID);
    }
  }

  for (const bookmark of state.bookmarksByID.values()) {
    if (!state.bookmarkIDsByFolderID.has(bookmark.folderID)) {
      state.bookmarkIDsByFolderID.set(bookmark.folderID, new Set());
    }
    state.bookmarkIDsByFolderID.get(bookmark.folderID).add(bookmark.bookmarkID);

    if (!state.bookmarkIDsByLocationID.has(bookmark.locationID)) {
      state.bookmarkIDsByLocationID.set(bookmark.locationID, new Set());
    }
    state.bookmarkIDsByLocationID.get(bookmark.locationID).add(bookmark.bookmarkID);

    if (bookmark.subfolderID) {
      if (!state.bookmarkIDsBySubfolderID.has(bookmark.subfolderID)) {
        state.bookmarkIDsBySubfolderID.set(bookmark.subfolderID, new Set());
      }
      state.bookmarkIDsBySubfolderID.get(bookmark.subfolderID).add(bookmark.bookmarkID);
    }
  }

  for (const subfolder of state.subfoldersByID.values()) {
    if (!state.subfolderIDsByFolderID.has(subfolder.folderID)) {
      state.subfolderIDsByFolderID.set(subfolder.folderID, new Set());
    }
    state.subfolderIDsByFolderID.get(subfolder.folderID).add(subfolder.subfolderID);
  }

  for (const group of state.groupsByID.values()) {
    const creatorID = toPositiveInt(group.creatorID, 0);
    if (creatorID > 0 && !state.defaultGroupIDByCorporationID.has(creatorID)) {
      state.defaultGroupIDByCorporationID.set(creatorID, group.groupID);
    }
  }
}

function persistMeta() {
  writeRoot(RUNTIME_TABLE, state.runtimeRoot);
}

function persistBookmarks() {
  writeRoot(BOOKMARKS_TABLE, state.bookmarkRoot);
}

function persistFolders() {
  writeRoot(FOLDERS_TABLE, state.folderRoot);
}

function persistSubfolders() {
  writeRoot(SUBFOLDERS_TABLE, state.subfolderRoot);
}

function persistKnownFolders() {
  writeRoot(KNOWN_TABLE, state.knownRoot);
}

function persistGroups() {
  writeRoot(GROUPS_TABLE, state.groupRoot);
}

module.exports = {
  BOOKMARKS_TABLE,
  CHARACTERS_TABLE,
  DEFAULT_KNOWN_TABLE,
  DEFAULT_RECORD_TABLE,
  DEFAULT_RUNTIME,
  FOLDERS_TABLE,
  GROUPS_TABLE,
  KNOWN_TABLE,
  RUNTIME_TABLE,
  SUBFOLDERS_TABLE,
  cloneValue,
  filetimeNowString,
  getCharacterRecord,
  getCharacterTable,
  normalizeBookmarkRecord,
  normalizeFolderRecord,
  normalizeGroupRecord,
  normalizeKnownFolderRecord,
  normalizeSubfolderRecord,
  persistBookmarks,
  persistFolders,
  persistGroups,
  persistKnownFolders,
  persistMeta,
  persistSubfolders,
  readTable,
  rebuildIndexes,
  state,
  toInt,
  toOptionalInt,
  toPositiveInt,
};
