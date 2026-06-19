/**
 * Bookmark Store
 *
 * Shared data-access layer for player bookmarks and bookmark folders.
 * Persists state on charRecord.bookmarkData (written via characterState helpers).
 *
 * Both accessGroupBookmarkMgrService and beyonceService use this module.
 */

const path = require("path");
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  getCharacterRecord,
  updateCharacterRecord,
} = require(path.join(__dirname, "./characterState"));

// Access level for a personal (private) folder.
const ACCESS_PERSONAL = 1;

// Default expiry for bookmarks that never expire.
const NO_EXPIRY = null;

function now() {
  return Date.now();
}

// Convert millisecond JS timestamp to EVE file-time (100-ns intervals since 1601).
// Returns a string so the value is safe for JSON.stringify (BigInt is not).
// Callers sending this to the client must wrap it as {type:"long", value: BigInt(str)}
// so the marshal layer encodes it as int64 (PyLongLong).
function msToFiletime(ms) {
  // EVE epoch offset: 11644473600000 ms between 1601-01-01 and 1970-01-01
  const EVE_EPOCH_OFFSET_MS = 11644473600000;
  return (BigInt(Math.trunc(ms) + EVE_EPOCH_OFFSET_MS) * 10000n).toString();
}

/**
 * Returns a shallow clone of the bookmark data from charRecord,
 * initialised to defaults if missing.
 */
function readBookmarkData(charRecord) {
  const raw = charRecord && charRecord.bookmarkData;
  if (raw && typeof raw === "object") {
    return {
      nextBookmarkID: Number(raw.nextBookmarkID) || 1,
      nextFolderID: Number(raw.nextFolderID) || 1,
      nextSubfolderID: Number(raw.nextSubfolderID) || 1,
      folders: Array.isArray(raw.folders) ? raw.folders.map((f) => ({ ...f })) : [],
      bookmarks: Array.isArray(raw.bookmarks)
        ? raw.bookmarks.map((b) => ({ ...b }))
        : [],
      subfolders: Array.isArray(raw.subfolders)
        ? raw.subfolders.map((s) => ({ ...s }))
        : [],
      knownSharedFolders: Array.isArray(raw.knownSharedFolders)
        ? raw.knownSharedFolders.map((k) => ({ ...k }))
        : [],
    };
  }
  return {
    nextBookmarkID: 1,
    nextFolderID: 1,
    nextSubfolderID: 1,
    folders: [],
    bookmarks: [],
    subfolders: [],
    knownSharedFolders: [],
  };
}

/**
 * ensureBookmarkData(charID)
 *
 * Guarantees that charRecord.bookmarkData exists and is initialised.
 * Call before any read operation if you are not already writing.
 */
function ensureBookmarkData(charID) {
  const record = getCharacterRecord(charID);
  if (record && record.bookmarkData) {
    return;
  }
  updateCharacterRecord(charID, (rec) => {
    if (!rec.bookmarkData) {
      rec.bookmarkData = readBookmarkData(null);
    }
    return rec;
  });
}

/**
 * getActiveBookmarks(charID)
 *
 * Returns [folders, bookmarks, subfolders=[]] from the character's stored data.
 * Only returns bookmarks that belong to active folders.
 */
function getActiveBookmarks(charID) {
  const record = getCharacterRecord(charID);
  const data = readBookmarkData(record);

  const activeFolderIDs = new Set(
    data.folders.filter((f) => f.isActive).map((f) => f.folderID),
  );
  const bookmarks = data.bookmarks.filter((b) =>
    activeFolderIDs.has(b.folderID),
  );
  const subfolders = data.subfolders.filter((s) =>
    activeFolderIDs.has(s.folderID),
  );

  return [data.folders, bookmarks, subfolders];
}

/**
 * addFolder(charID, isPersonal, folderName, description)
 *
 * Creates a new folder and persists it to the character record.
 * Returns the Folder object, or null on failure.
 */
function addFolder(charID, isPersonal, folderName, description) {
  let newFolder = null;

  const result = updateCharacterRecord(charID, (rec) => {
    const data = readBookmarkData(rec);
    const folderID = data.nextFolderID;
    data.nextFolderID = folderID + 1;

    newFolder = {
      folderID,
      folderName: String(folderName || "My Locations"),
      description: String(description || ""),
      isPersonal: isPersonal !== false,
      isActive: true,
      accessLevel: ACCESS_PERSONAL,
      adminGroupID: null,
      manageGroupID: null,
      useGroupID: null,
      viewGroupID: null,
    };
    data.folders.push(newFolder);
    rec.bookmarkData = data;
    return rec;
  });

  if (!result || !result.success) {
    log.warn(`[BookmarkStore] addFolder failed for char=${charID}`);
    return null;
  }
  return newFolder;
}

/**
 * addBookmark(charID, opts)
 *
 * Creates a new bookmark entry. opts:
 *   { folderID, itemID, typeID, locationID, x, y, z, memo, note, expiry, subfolderID, creatorID }
 *
 * Returns [bookmarkID, itemID, typeID, x, y, z, locationID, expiryDate]
 */
function addBookmark(charID, opts) {
  const {
    folderID,
    itemID = null,
    typeID = null,
    locationID,
    x = 0,
    y = 0,
    z = 0,
    memo = "",
    note = "",
    expiry = NO_EXPIRY,
    subfolderID = null,
    creatorID,
  } = opts || {};

  let bookmarkID = null;

  const result = updateCharacterRecord(charID, (rec) => {
    const data = readBookmarkData(rec);
    bookmarkID = data.nextBookmarkID;
    data.nextBookmarkID = bookmarkID + 1;

    const created = msToFiletime(now());
    // Convert expiry from ms-epoch to EVE filetime so the client can compare
    // it against blue.os.GetWallclockTime() (which is also filetime).
    const expiryFiletime = expiry != null ? msToFiletime(Number(expiry)) : null;
    const bookmark = {
      bookmarkID,
      folderID: Number(folderID),
      subfolderID: subfolderID != null ? Number(subfolderID) : null,
      itemID: itemID != null ? Number(itemID) : null,
      typeID: typeID != null ? Number(typeID) : null,
      locationID: Number(locationID),
      x: Number(x),
      y: Number(y),
      z: Number(z),
      memo: String(memo || ""),
      note: String(note || ""),
      creatorID: Number(creatorID || charID),
      created,
      expiry: expiryFiletime,
      flag: null,
    };
    data.bookmarks.push(bookmark);
    rec.bookmarkData = data;
    return rec;
  });

  if (!result || !result.success) {
    log.warn(`[BookmarkStore] addBookmark failed for char=${charID}`);
    return null;
  }

  // expiryDate returned to client in filetime format — null means no expiry
  const expiryFiletime2 = expiry != null ? msToFiletime(Number(expiry)) : null;
  return [bookmarkID, itemID, typeID, x, y, z, locationID, expiryFiletime2];
}

/**
 * deleteBookmarks(charID, folderID, bookmarkIDs)
 *
 * Deletes the specified bookmarks from folderID.
 * Returns the list of bookmark IDs that were actually deleted.
 */
function deleteBookmarks(charID, folderID, bookmarkIDs) {
  const targetSet = new Set(
    (Array.isArray(bookmarkIDs) ? bookmarkIDs : Array.from(bookmarkIDs)).map(
      (id) => Number(id),
    ),
  );
  const deleted = [];

  updateCharacterRecord(charID, (rec) => {
    const data = readBookmarkData(rec);
    const surviving = [];
    for (const bm of data.bookmarks) {
      if (
        Number(bm.folderID) === Number(folderID) &&
        targetSet.has(Number(bm.bookmarkID))
      ) {
        deleted.push(bm.bookmarkID);
      } else {
        surviving.push(bm);
      }
    }
    data.bookmarks = surviving;
    rec.bookmarkData = data;
    return rec;
  });

  return deleted;
}

/**
 * updateBookmark(charID, bookmarkID, changes)
 *
 * Updates a bookmark's editable fields: memo, note, folderID, subfolderID.
 * If changes.expiryCancel is truthy, clears the expiry.
 */
function updateBookmark(charID, bookmarkID, changes) {
  const numericID = Number(bookmarkID);

  updateCharacterRecord(charID, (rec) => {
    const data = readBookmarkData(rec);
    const bm = data.bookmarks.find((b) => Number(b.bookmarkID) === numericID);
    if (!bm) return rec;

    if (changes.memo !== undefined) bm.memo = String(changes.memo);
    if (changes.note !== undefined) bm.note = String(changes.note);
    if (changes.folderID !== undefined) bm.folderID = Number(changes.folderID);
    if (changes.subfolderID !== undefined) {
      bm.subfolderID = changes.subfolderID != null ? Number(changes.subfolderID) : null;
    }
    if (changes.expiryCancel) bm.expiry = null;

    rec.bookmarkData = data;
    return rec;
  });
}

/**
 * updateFolder(charID, folderID, folderName, description)
 *
 * Updates the folder's name and description.
 * Returns the accessLevel for this folder.
 */
function updateFolder(charID, folderID, folderName, description) {
  const numericFolderID = Number(folderID);
  let accessLevel = ACCESS_PERSONAL;

  updateCharacterRecord(charID, (rec) => {
    const data = readBookmarkData(rec);
    const folder = data.folders.find((f) => Number(f.folderID) === numericFolderID);
    if (folder) {
      folder.folderName = String(folderName || folder.folderName);
      folder.description = String(description || "");
      accessLevel = folder.accessLevel || ACCESS_PERSONAL;
    }
    rec.bookmarkData = data;
    return rec;
  });

  return accessLevel;
}

/**
 * deleteFolder(charID, folderID)
 *
 * Removes the folder and all its bookmarks and subfolders.
 */
function deleteFolder(charID, folderID) {
  const numericFolderID = Number(folderID);

  updateCharacterRecord(charID, (rec) => {
    const data = readBookmarkData(rec);
    data.folders = data.folders.filter((f) => Number(f.folderID) !== numericFolderID);
    data.bookmarks = data.bookmarks.filter((b) => Number(b.folderID) !== numericFolderID);
    data.subfolders = data.subfolders.filter((s) => Number(s.folderID) !== numericFolderID);
    rec.bookmarkData = data;
    return rec;
  });
}

/**
 * moveBookmarks(charID, oldFolderID, newFolderID, subfolderID, bookmarkIDs)
 *
 * Moves bookmarks to a new folder/subfolder.
 * Returns [rows, message] where rows is {bookmarkID, folderID, subfolderID}[].
 */
function moveBookmarks(charID, oldFolderID, newFolderID, subfolderID, bookmarkIDs) {
  const targetSet = new Set(
    (Array.isArray(bookmarkIDs) ? bookmarkIDs : []).map((id) => Number(id)),
  );
  const numericOldFolder = Number(oldFolderID);
  const numericNewFolder = Number(newFolderID);
  const numericSubfolder = subfolderID != null ? Number(subfolderID) : null;
  const rows = [];

  updateCharacterRecord(charID, (rec) => {
    const data = readBookmarkData(rec);
    for (const bm of data.bookmarks) {
      if (
        Number(bm.folderID) === numericOldFolder &&
        targetSet.has(Number(bm.bookmarkID))
      ) {
        bm.folderID = numericNewFolder;
        bm.subfolderID = numericSubfolder;
        rows.push({
          bookmarkID: bm.bookmarkID,
          folderID: bm.folderID,
          subfolderID: bm.subfolderID,
        });
      }
    }
    rec.bookmarkData = data;
    return rec;
  });

  return [rows, null];
}

/**
 * copyBookmarks(charID, oldFolderID, newFolderID, subfolderID, bookmarkIDs)
 *
 * Copies bookmarks into the new folder/subfolder with new IDs.
 * Returns [newBookmarksDict, message].
 */
function copyBookmarks(charID, oldFolderID, newFolderID, subfolderID, bookmarkIDs) {
  const targetSet = new Set(
    (Array.isArray(bookmarkIDs) ? bookmarkIDs : []).map((id) => Number(id)),
  );
  const numericOldFolder = Number(oldFolderID);
  const numericNewFolder = Number(newFolderID);
  const numericSubfolder = subfolderID != null ? Number(subfolderID) : null;
  const newBookmarks = {};

  updateCharacterRecord(charID, (rec) => {
    const data = readBookmarkData(rec);
    const originals = data.bookmarks.filter(
      (b) =>
        Number(b.folderID) === numericOldFolder &&
        targetSet.has(Number(b.bookmarkID)),
    );

    for (const orig of originals) {
      const newID = data.nextBookmarkID;
      data.nextBookmarkID = newID + 1;

      const copy = {
        ...orig,
        bookmarkID: newID,
        folderID: numericNewFolder,
        subfolderID: numericSubfolder,
        created: msToFiletime(now()),
      };
      data.bookmarks.push(copy);
      newBookmarks[newID] = copy;
    }
    rec.bookmarkData = data;
    return rec;
  });

  return [newBookmarks, null];
}

/**
 * createSubfolder(charID, folderID, subfolderName)
 *
 * Creates a new subfolder inside the given folder.
 * Returns the subfolder object.
 */
function createSubfolder(charID, folderID, subfolderName) {
  let newSubfolder = null;

  const result = updateCharacterRecord(charID, (rec) => {
    const data = readBookmarkData(rec);
    const subfolderID = data.nextSubfolderID;
    data.nextSubfolderID = subfolderID + 1;

    newSubfolder = {
      subfolderID,
      folderID: Number(folderID),
      subfolderName: String(subfolderName || ""),
      creatorID: Number(charID),
    };
    data.subfolders.push(newSubfolder);
    rec.bookmarkData = data;
    return rec;
  });

  if (!result || !result.success) {
    log.warn(`[BookmarkStore] createSubfolder failed for char=${charID}`);
    return null;
  }
  return newSubfolder;
}

/**
 * updateSubfolder(charID, folderID, subfolderID, subfolderName)
 *
 * Renames a subfolder. Returns true if found and renamed, false otherwise.
 */
function updateSubfolder(charID, folderID, subfolderID, subfolderName) {
  const numericSubfolderID = Number(subfolderID);
  let found = false;

  updateCharacterRecord(charID, (rec) => {
    const data = readBookmarkData(rec);
    const sf = data.subfolders.find(
      (s) => Number(s.subfolderID) === numericSubfolderID,
    );
    if (sf) {
      sf.subfolderName = String(subfolderName || sf.subfolderName);
      found = true;
    }
    rec.bookmarkData = data;
    return rec;
  });

  return found;
}

/**
 * deleteSubfolder(charID, folderID, subfolderID)
 *
 * Deletes the subfolder and all bookmarks inside it.
 * Returns the list of deleted bookmark IDs.
 */
function deleteSubfolder(charID, folderID, subfolderID) {
  const numericSubfolderID = Number(subfolderID);
  const numericFolderID = Number(folderID);
  const deletedBookmarkIDs = [];

  updateCharacterRecord(charID, (rec) => {
    const data = readBookmarkData(rec);

    // Remove the subfolder
    data.subfolders = data.subfolders.filter(
      (s) => Number(s.subfolderID) !== numericSubfolderID,
    );

    // Remove bookmarks that belonged to this subfolder in this folder
    const surviving = [];
    for (const bm of data.bookmarks) {
      if (
        Number(bm.folderID) === numericFolderID &&
        Number(bm.subfolderID) === numericSubfolderID
      ) {
        deletedBookmarkIDs.push(bm.bookmarkID);
      } else {
        surviving.push(bm);
      }
    }
    data.bookmarks = surviving;
    rec.bookmarkData = data;
    return rec;
  });

  return deletedBookmarkIDs;
}

/**
 * cleanupExpiredBookmarks(charID)
 *
 * Removes bookmarks whose expiry timestamp is in the past.
 * Called on session load to garbage-collect expired entries.
 */
function cleanupExpiredBookmarks(charID) {
  const currentFiletime = msToFiletime(now());

  updateCharacterRecord(charID, (rec) => {
    const data = readBookmarkData(rec);
    const before = data.bookmarks.length;
    data.bookmarks = data.bookmarks.filter((bm) => {
      if (bm.expiry == null) return true;
      // Expiry is stored as EVE filetime (string). Compare via BigInt.
      try {
        return BigInt(bm.expiry) > BigInt(currentFiletime);
      } catch (_) {
        return true; // keep bookmark if expiry value is unparseable
      }
    });
    if (data.bookmarks.length < before) {
      log.info(
        `[BookmarkStore] cleanupExpiredBookmarks char=${charID}: removed ${before - data.bookmarks.length} expired bookmark(s)`,
      );
    }
    rec.bookmarkData = data;
    return rec;
  });
}

/**
 * getBookmarkByID(charID, bookmarkID)
 *
 * Returns a single bookmark object, or null if not found.
 * Used by resolveBookmarkAlignTarget in beyonceService.
 */
function getBookmarkByID(charID, bookmarkID) {
  const record = getCharacterRecord(charID);
  const data = readBookmarkData(record);
  const numericID = Number(bookmarkID);
  return data.bookmarks.find((b) => Number(b.bookmarkID) === numericID) || null;
}

/**
 * getFolderByID(charID, folderID)
 *
 * Returns a single folder object, or null if not found.
 */
function getFolderByID(charID, folderID) {
  const record = getCharacterRecord(charID);
  const data = readBookmarkData(record);
  const numericID = Number(folderID);
  return data.folders.find((f) => Number(f.folderID) === numericID) || null;
}

/**
 * getAllFolders(charID)
 *
 * Returns all folders for the character.
 */
function getAllFolders(charID) {
  const record = getCharacterRecord(charID);
  const data = readBookmarkData(record);
  return data.folders;
}

// -----------------------------------------------------------------------
// Known shared folder tracking (per-character)
// -----------------------------------------------------------------------

/**
 * Get the list of known shared folders for a character.
 * Returns [{folderID, isActive}, ...].
 */
function getKnownSharedFolders(charID) {
  const record = getCharacterRecord(charID);
  const data = readBookmarkData(record);
  return Array.isArray(data.knownSharedFolders) ? data.knownSharedFolders : [];
}

/**
 * Add a shared folder to the character's known list.
 */
function addKnownSharedFolder(charID, folderID, isActive) {
  updateCharacterRecord(charID, (rec) => {
    const data = readBookmarkData(rec);
    if (!Array.isArray(data.knownSharedFolders)) data.knownSharedFolders = [];

    // Avoid duplicates
    const numericFolderID = Number(folderID);
    if (data.knownSharedFolders.some((k) => Number(k.folderID) === numericFolderID)) {
      return rec;
    }

    data.knownSharedFolders.push({
      folderID: numericFolderID,
      isActive: Boolean(isActive),
    });
    rec.bookmarkData = data;
    return rec;
  });
}

/**
 * Remove a shared folder from the character's known list.
 */
function removeKnownSharedFolder(charID, folderID) {
  const numericFolderID = Number(folderID);
  updateCharacterRecord(charID, (rec) => {
    const data = readBookmarkData(rec);
    if (Array.isArray(data.knownSharedFolders)) {
      data.knownSharedFolders = data.knownSharedFolders.filter(
        (k) => Number(k.folderID) !== numericFolderID,
      );
    }
    rec.bookmarkData = data;
    return rec;
  });
}

/**
 * Toggle a known shared folder's active state.
 * Returns the new isActive value.
 */
function updateKnownSharedFolderState(charID, folderID, isActive) {
  const numericFolderID = Number(folderID);
  let newState = Boolean(isActive);

  updateCharacterRecord(charID, (rec) => {
    const data = readBookmarkData(rec);
    if (Array.isArray(data.knownSharedFolders)) {
      const entry = data.knownSharedFolders.find(
        (k) => Number(k.folderID) === numericFolderID,
      );
      if (entry) {
        entry.isActive = newState;
      }
    }
    rec.bookmarkData = data;
    return rec;
  });

  return newState;
}

module.exports = {
  ensureBookmarkData,
  getActiveBookmarks,
  addFolder,
  addBookmark,
  deleteBookmarks,
  updateBookmark,
  updateFolder,
  deleteFolder,
  moveBookmarks,
  copyBookmarks,
  createSubfolder,
  updateSubfolder,
  deleteSubfolder,
  cleanupExpiredBookmarks,
  getBookmarkByID,
  getFolderByID,
  getAllFolders,
  // Known shared folder tracking
  getKnownSharedFolders,
  addKnownSharedFolder,
  removeKnownSharedFolder,
  updateKnownSharedFolderState,
};
