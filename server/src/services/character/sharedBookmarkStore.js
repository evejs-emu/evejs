/**
 * Shared Bookmark Store
 *
 * Global data-access layer for shared (non-personal) bookmark folders.
 * Unlike personal bookmarks (stored per-character in bookmarkStore.js),
 * shared folders live in a global `sharedBookmarkFolders` database table
 * so multiple characters can access the same folder content.
 *
 * Each shared folder has its own bookmarks, subfolders, and ACL group IDs.
 * Characters subscribe to shared folders via "known shared folders" tracked
 * in their personal bookmarkData (see bookmarkStore.js).
 */

const path = require("path");
const log = require(path.join(__dirname, "../../utils/logger"));
const database = require(path.join(__dirname, "../../newDatabase"));
const accessGroupStore = require(path.join(__dirname, "./accessGroupStore"));

const TABLE = "sharedBookmarkFolders";

// Access levels (matching client-side appConst values)
const ACCESS_NONE = 0;
const ACCESS_PERSONAL = 1;
const ACCESS_VIEW = 2;
const ACCESS_USE = 3;
const ACCESS_MANAGE = 4;
const ACCESS_ADMIN = 5;

// -----------------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------------

function now() {
  return Date.now();
}

// Convert millisecond JS timestamp to EVE file-time (100-ns intervals since 1601).
function msToFiletime(ms) {
  const EVE_EPOCH_OFFSET_MS = 11644473600000;
  return (BigInt(Math.trunc(ms) + EVE_EPOCH_OFFSET_MS) * 10000n).toString();
}

function readMeta() {
  const result = database.read(TABLE, "/_meta");
  if (result.success && result.data && typeof result.data === "object") {
    return { ...result.data };
  }
  return { nextFolderID: 10000, nextBookmarkID: 100000, nextSubfolderID: 10000 };
}

function writeMeta(meta) {
  database.write(TABLE, "/_meta", meta);
}

function readFolder(folderID) {
  const result = database.read(TABLE, `/${folderID}`);
  if (result.success && result.data && typeof result.data === "object") {
    return { ...result.data };
  }
  return null;
}

function writeFolder(folder) {
  database.write(TABLE, `/${folder.folderID}`, folder);
}

function removeFolder(folderID) {
  database.remove(TABLE, `/${folderID}`);
}

/**
 * Get all shared folders from the database.
 */
function getAllSharedFolders() {
  const result = database.read(TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return [];
  }
  return Object.entries(result.data)
    .filter(([key]) => key !== "_meta")
    .map(([, value]) => value)
    .filter((f) => f && typeof f === "object" && f.folderID);
}

// -----------------------------------------------------------------------
// Access level computation
// -----------------------------------------------------------------------

/**
 * Determine a character's access level for a shared folder.
 * Returns one of: ACCESS_NONE, ACCESS_VIEW, ACCESS_USE, ACCESS_MANAGE, ACCESS_ADMIN.
 */
function computeAccessLevel(charID, folder) {
  if (!folder) return ACCESS_NONE;
  const numCharID = Number(charID);

  // Owner always has admin
  if (Number(folder.ownerCharID) === numCharID) return ACCESS_ADMIN;

  // Check group memberships from most to least privileged
  if (folder.adminGroupID && accessGroupStore.isMember(folder.adminGroupID, numCharID)) {
    return ACCESS_ADMIN;
  }
  if (folder.manageGroupID && accessGroupStore.isMember(folder.manageGroupID, numCharID)) {
    return ACCESS_MANAGE;
  }
  if (folder.useGroupID && accessGroupStore.isMember(folder.useGroupID, numCharID)) {
    return ACCESS_USE;
  }
  if (folder.viewGroupID && accessGroupStore.isMember(folder.viewGroupID, numCharID)) {
    return ACCESS_VIEW;
  }

  return ACCESS_NONE;
}

// -----------------------------------------------------------------------
// Folder CRUD
// -----------------------------------------------------------------------

/**
 * Create a new shared folder.
 * Returns the folder object or null on failure.
 */
function createSharedFolder(ownerCharID, folderName, description, adminGroupID, manageGroupID, useGroupID, viewGroupID) {
  const meta = readMeta();
  const folderID = meta.nextFolderID;
  meta.nextFolderID = folderID + 1;
  writeMeta(meta);

  const folder = {
    folderID,
    folderName: String(folderName || "Shared Folder"),
    description: String(description || ""),
    ownerCharID: Number(ownerCharID),
    isPersonal: false,
    adminGroupID: adminGroupID || null,
    manageGroupID: manageGroupID || null,
    useGroupID: useGroupID || null,
    viewGroupID: viewGroupID || null,
    bookmarks: [],
    subfolders: [],
    nextBookmarkID: 1,
    nextSubfolderID: 1,
    // Track which characters know about this folder
    subscribers: [Number(ownerCharID)],
  };

  writeFolder(folder);
  log.info(
    `[SharedBookmarkStore] Created shared folder ${folderID} "${folderName}" owner=${ownerCharID}`,
  );
  return folder;
}

/**
 * Get a shared folder by ID.
 */
function getSharedFolder(folderID) {
  return readFolder(Number(folderID));
}

/**
 * Update a shared folder's metadata.
 */
function updateSharedFolder(folderID, folderName, description, adminGroupID, manageGroupID, useGroupID, viewGroupID) {
  const folder = readFolder(Number(folderID));
  if (!folder) return null;

  if (folderName !== undefined) folder.folderName = String(folderName || folder.folderName);
  if (description !== undefined) folder.description = String(description || "");
  if (adminGroupID !== undefined) folder.adminGroupID = adminGroupID || null;
  if (manageGroupID !== undefined) folder.manageGroupID = manageGroupID || null;
  if (useGroupID !== undefined) folder.useGroupID = useGroupID || null;
  if (viewGroupID !== undefined) folder.viewGroupID = viewGroupID || null;

  writeFolder(folder);
  return folder;
}

/**
 * Delete a shared folder entirely.
 */
function deleteSharedFolder(folderID) {
  const folder = readFolder(Number(folderID));
  if (!folder) return null;
  removeFolder(Number(folderID));
  log.info(`[SharedBookmarkStore] Deleted shared folder ${folderID}`);
  return folder;
}

/**
 * Build a client-facing folder view for a specific character.
 * Merges the stored folder data with the character's computed access level
 * and their isActive state from known shared folders.
 */
function buildFolderView(charID, folder, isActive) {
  return {
    folderID: folder.folderID,
    folderName: folder.folderName,
    description: folder.description || "",
    isPersonal: false,
    isActive: Boolean(isActive),
    accessLevel: computeAccessLevel(charID, folder),
    adminGroupID: folder.adminGroupID || null,
    manageGroupID: folder.manageGroupID || null,
    useGroupID: folder.useGroupID || null,
    viewGroupID: folder.viewGroupID || null,
  };
}

// -----------------------------------------------------------------------
// Subscriber management
// -----------------------------------------------------------------------

/**
 * Add a character as a subscriber to a shared folder.
 */
function addSubscriber(folderID, charID) {
  const folder = readFolder(Number(folderID));
  if (!folder) return false;

  if (!Array.isArray(folder.subscribers)) folder.subscribers = [];
  const numCharID = Number(charID);
  if (!folder.subscribers.includes(numCharID)) {
    folder.subscribers.push(numCharID);
    writeFolder(folder);
  }
  return true;
}

/**
 * Remove a character from a shared folder's subscribers.
 */
function removeSubscriber(folderID, charID) {
  const folder = readFolder(Number(folderID));
  if (!folder) return false;

  if (!Array.isArray(folder.subscribers)) return false;
  const numCharID = Number(charID);
  const idx = folder.subscribers.indexOf(numCharID);
  if (idx === -1) return false;

  folder.subscribers.splice(idx, 1);
  writeFolder(folder);
  return true;
}

/**
 * Get the list of subscriber character IDs for a folder.
 */
function getSubscribers(folderID) {
  const folder = readFolder(Number(folderID));
  if (!folder || !Array.isArray(folder.subscribers)) return [];
  return [...folder.subscribers];
}

// -----------------------------------------------------------------------
// Bookmark operations within shared folders
// -----------------------------------------------------------------------

/**
 * Add a bookmark to a shared folder.
 * Returns [bookmarkID, itemID, typeID, x, y, z, locationID, expiryFiletime].
 */
function addBookmarkToSharedFolder(folderID, opts) {
  const folder = readFolder(Number(folderID));
  if (!folder) return null;

  if (!Array.isArray(folder.bookmarks)) folder.bookmarks = [];

  const bookmarkID = folder.nextBookmarkID || 1;
  folder.nextBookmarkID = bookmarkID + 1;

  const created = msToFiletime(now());
  const expiryFiletime = opts.expiry != null ? msToFiletime(Number(opts.expiry)) : null;

  const bookmark = {
    bookmarkID,
    folderID: folder.folderID,
    subfolderID: opts.subfolderID != null ? Number(opts.subfolderID) : null,
    itemID: opts.itemID != null ? Number(opts.itemID) : null,
    typeID: opts.typeID != null ? Number(opts.typeID) : null,
    locationID: Number(opts.locationID),
    x: Number(opts.x || 0),
    y: Number(opts.y || 0),
    z: Number(opts.z || 0),
    memo: String(opts.memo || ""),
    note: String(opts.note || ""),
    creatorID: Number(opts.creatorID),
    created,
    expiry: expiryFiletime,
    flag: null,
  };

  folder.bookmarks.push(bookmark);
  writeFolder(folder);

  return [bookmarkID, opts.itemID, opts.typeID, opts.x, opts.y, opts.z, opts.locationID, expiryFiletime];
}

/**
 * Delete bookmarks from a shared folder.
 * Returns list of deleted bookmark IDs.
 */
function deleteBookmarksFromSharedFolder(folderID, bookmarkIDs) {
  const folder = readFolder(Number(folderID));
  if (!folder || !Array.isArray(folder.bookmarks)) return [];

  const targetSet = new Set(bookmarkIDs.map((id) => Number(id)));
  const deleted = [];
  const surviving = [];

  for (const bm of folder.bookmarks) {
    if (targetSet.has(Number(bm.bookmarkID))) {
      deleted.push(bm.bookmarkID);
    } else {
      surviving.push(bm);
    }
  }

  folder.bookmarks = surviving;
  writeFolder(folder);
  return deleted;
}

/**
 * Get all bookmarks in a shared folder.
 */
function getBookmarksInFolder(folderID) {
  const folder = readFolder(Number(folderID));
  if (!folder || !Array.isArray(folder.bookmarks)) return [];
  return folder.bookmarks.map((b) => ({ ...b }));
}

/**
 * Get all subfolders in a shared folder.
 */
function getSubfoldersInFolder(folderID) {
  const folder = readFolder(Number(folderID));
  if (!folder || !Array.isArray(folder.subfolders)) return [];
  return folder.subfolders.map((s) => ({ ...s }));
}

/**
 * Update a bookmark in a shared folder.
 */
function updateBookmarkInSharedFolder(folderID, bookmarkID, changes) {
  const folder = readFolder(Number(folderID));
  if (!folder || !Array.isArray(folder.bookmarks)) return null;

  const numericID = Number(bookmarkID);
  const bm = folder.bookmarks.find((b) => Number(b.bookmarkID) === numericID);
  if (!bm) return null;

  if (changes.memo !== undefined) bm.memo = String(changes.memo);
  if (changes.note !== undefined) bm.note = String(changes.note);
  if (changes.subfolderID !== undefined) {
    bm.subfolderID = changes.subfolderID != null ? Number(changes.subfolderID) : null;
  }
  if (changes.expiryCancel) bm.expiry = null;

  writeFolder(folder);
  return { ...bm };
}

/**
 * Move bookmarks within/between shared folders.
 * Returns [rows, message].
 */
function moveBookmarksInSharedFolder(oldFolderID, newFolderID, subfolderID, bookmarkIDs) {
  const targetSet = new Set(bookmarkIDs.map((id) => Number(id)));
  const numericSubfolder = subfolderID != null ? Number(subfolderID) : null;
  const rows = [];

  if (Number(oldFolderID) === Number(newFolderID)) {
    // Same folder — just update subfolder
    const folder = readFolder(Number(oldFolderID));
    if (!folder || !Array.isArray(folder.bookmarks)) return [[], null];

    for (const bm of folder.bookmarks) {
      if (targetSet.has(Number(bm.bookmarkID))) {
        bm.subfolderID = numericSubfolder;
        rows.push({
          bookmarkID: bm.bookmarkID,
          folderID: bm.folderID,
          subfolderID: bm.subfolderID,
        });
      }
    }
    writeFolder(folder);
  } else {
    // Cross-folder move
    const oldFolder = readFolder(Number(oldFolderID));
    const newFolder = readFolder(Number(newFolderID));
    if (!oldFolder || !newFolder) return [[], null];

    if (!Array.isArray(oldFolder.bookmarks)) oldFolder.bookmarks = [];
    if (!Array.isArray(newFolder.bookmarks)) newFolder.bookmarks = [];

    const toMove = [];
    const surviving = [];
    for (const bm of oldFolder.bookmarks) {
      if (targetSet.has(Number(bm.bookmarkID))) {
        toMove.push(bm);
      } else {
        surviving.push(bm);
      }
    }
    oldFolder.bookmarks = surviving;

    for (const bm of toMove) {
      bm.folderID = newFolder.folderID;
      bm.subfolderID = numericSubfolder;
      newFolder.bookmarks.push(bm);
      rows.push({
        bookmarkID: bm.bookmarkID,
        folderID: bm.folderID,
        subfolderID: bm.subfolderID,
      });
    }

    writeFolder(oldFolder);
    writeFolder(newFolder);
  }

  return [rows, null];
}

/**
 * Copy bookmarks within/to shared folders.
 * Returns [newBookmarksDict, message].
 */
function copyBookmarksInSharedFolder(sourceFolderID, targetFolderID, subfolderID, bookmarkIDs) {
  const targetSet = new Set(bookmarkIDs.map((id) => Number(id)));
  const numericSubfolder = subfolderID != null ? Number(subfolderID) : null;
  const newBookmarks = {};

  const sourceFolder = readFolder(Number(sourceFolderID));
  const targetFolder = Number(sourceFolderID) === Number(targetFolderID)
    ? sourceFolder
    : readFolder(Number(targetFolderID));
  if (!sourceFolder || !targetFolder) return [{}, null];

  if (!Array.isArray(sourceFolder.bookmarks)) return [{}, null];
  if (!Array.isArray(targetFolder.bookmarks)) targetFolder.bookmarks = [];

  const originals = sourceFolder.bookmarks.filter(
    (b) => targetSet.has(Number(b.bookmarkID)),
  );

  for (const orig of originals) {
    const newID = targetFolder.nextBookmarkID || 1;
    targetFolder.nextBookmarkID = newID + 1;

    const copy = {
      ...orig,
      bookmarkID: newID,
      folderID: targetFolder.folderID,
      subfolderID: numericSubfolder,
      created: msToFiletime(now()),
    };
    targetFolder.bookmarks.push(copy);
    newBookmarks[newID] = copy;
  }

  writeFolder(targetFolder);
  if (Number(sourceFolderID) !== Number(targetFolderID)) {
    writeFolder(sourceFolder);
  }

  return [newBookmarks, null];
}

// -----------------------------------------------------------------------
// Subfolder operations within shared folders
// -----------------------------------------------------------------------

/**
 * Create a subfolder in a shared folder.
 */
function createSubfolderInSharedFolder(folderID, subfolderName, creatorID) {
  const folder = readFolder(Number(folderID));
  if (!folder) return null;

  if (!Array.isArray(folder.subfolders)) folder.subfolders = [];

  const subfolderID = folder.nextSubfolderID || 1;
  folder.nextSubfolderID = subfolderID + 1;

  const subfolder = {
    subfolderID,
    folderID: folder.folderID,
    subfolderName: String(subfolderName || ""),
    creatorID: Number(creatorID),
  };

  folder.subfolders.push(subfolder);
  writeFolder(folder);
  return subfolder;
}

/**
 * Update a subfolder in a shared folder.
 */
function updateSubfolderInSharedFolder(folderID, subfolderID, subfolderName) {
  const folder = readFolder(Number(folderID));
  if (!folder || !Array.isArray(folder.subfolders)) return false;

  const numericID = Number(subfolderID);
  const sf = folder.subfolders.find((s) => Number(s.subfolderID) === numericID);
  if (!sf) return false;

  sf.subfolderName = String(subfolderName || sf.subfolderName);
  writeFolder(folder);
  return true;
}

/**
 * Delete a subfolder from a shared folder.
 * Also removes all bookmarks in that subfolder.
 * Returns list of deleted bookmark IDs.
 */
function deleteSubfolderFromSharedFolder(folderID, subfolderID) {
  const folder = readFolder(Number(folderID));
  if (!folder) return [];

  const numericSubfolderID = Number(subfolderID);
  const numericFolderID = Number(folderID);
  const deletedBookmarkIDs = [];

  // Remove the subfolder
  if (Array.isArray(folder.subfolders)) {
    folder.subfolders = folder.subfolders.filter(
      (s) => Number(s.subfolderID) !== numericSubfolderID,
    );
  }

  // Remove bookmarks in the subfolder
  if (Array.isArray(folder.bookmarks)) {
    const surviving = [];
    for (const bm of folder.bookmarks) {
      if (
        Number(bm.folderID) === numericFolderID &&
        Number(bm.subfolderID) === numericSubfolderID
      ) {
        deletedBookmarkIDs.push(bm.bookmarkID);
      } else {
        surviving.push(bm);
      }
    }
    folder.bookmarks = surviving;
  }

  writeFolder(folder);
  return deletedBookmarkIDs;
}

/**
 * Clean up expired bookmarks in a shared folder.
 */
function cleanupExpiredBookmarksInFolder(folderID) {
  const folder = readFolder(Number(folderID));
  if (!folder || !Array.isArray(folder.bookmarks)) return;

  const currentFiletime = msToFiletime(now());
  const before = folder.bookmarks.length;
  folder.bookmarks = folder.bookmarks.filter((bm) => {
    if (bm.expiry == null) return true;
    try {
      return BigInt(bm.expiry) > BigInt(currentFiletime);
    } catch (_) {
      return true;
    }
  });

  if (folder.bookmarks.length < before) {
    writeFolder(folder);
    log.info(
      `[SharedBookmarkStore] cleanupExpired folder=${folderID}: removed ${before - folder.bookmarks.length} expired bookmark(s)`,
    );
  }
}

/**
 * Find all shared folders where the character has at least view access.
 * Returns array of {folderID, accessLevel}.
 */
function findAccessibleFolders(charID) {
  const allFolders = getAllSharedFolders();
  const result = [];
  for (const folder of allFolders) {
    const level = computeAccessLevel(charID, folder);
    if (level > ACCESS_NONE) {
      result.push({ folderID: folder.folderID, accessLevel: level });
    }
  }
  return result;
}

/**
 * Find all shared folders where character has admin access.
 */
function findAdminFolders(charID) {
  const allFolders = getAllSharedFolders();
  return allFolders.filter(
    (folder) => computeAccessLevel(charID, folder) >= ACCESS_ADMIN,
  );
}

/**
 * Determine if a folderID belongs to the shared store.
 * Shared folder IDs start at 10000.
 */
function isSharedFolderID(folderID) {
  return Number(folderID) >= 10000;
}

module.exports = {
  // Access levels
  ACCESS_NONE,
  ACCESS_PERSONAL,
  ACCESS_VIEW,
  ACCESS_USE,
  ACCESS_MANAGE,
  ACCESS_ADMIN,
  // Folder CRUD
  createSharedFolder,
  getSharedFolder,
  updateSharedFolder,
  deleteSharedFolder,
  buildFolderView,
  // Subscribers
  addSubscriber,
  removeSubscriber,
  getSubscribers,
  // Bookmark operations
  addBookmarkToSharedFolder,
  deleteBookmarksFromSharedFolder,
  getBookmarksInFolder,
  getSubfoldersInFolder,
  updateBookmarkInSharedFolder,
  moveBookmarksInSharedFolder,
  copyBookmarksInSharedFolder,
  // Subfolder operations
  createSubfolderInSharedFolder,
  updateSubfolderInSharedFolder,
  deleteSubfolderFromSharedFolder,
  // Utilities
  cleanupExpiredBookmarksInFolder,
  computeAccessLevel,
  findAccessibleFolders,
  findAdminFolders,
  isSharedFolderID,
  msToFiletime,
};
