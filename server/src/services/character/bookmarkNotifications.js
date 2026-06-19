/**
 * Bookmark Notifications
 *
 * Centralized helper for broadcasting bookmark-related notifications
 * to online characters who subscribe to shared folders.
 *
 * Uses sessionRegistry (same pattern as stationPresence.js) to iterate
 * over all active sessions and send notifications to matching characters.
 */

const path = require("path");
const log = require(path.join(__dirname, "../../utils/logger"));
const sessionRegistry = require(path.join(__dirname, "../chat/sessionRegistry"));
const sharedBookmarkStore = require(path.join(__dirname, "./sharedBookmarkStore"));
const { buildKeyVal } = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  buildBookmarkText,
} = require(path.join(__dirname, "../bookmark/bookmarkPayloads"));

// Notification type constants (match bookmarkConst.py)
const UPDATE_TYPES = {
  BOOKMARKS_ADDED: "bookmarksAdded",
  BOOKMARKS_REMOVED: "bookmarksRemoved",
  BOOKMARKS_UPDATED: "bookmarksUpdated",
  BOOKMARKS_MOVED: "bookmarksMoved",
  FOLDER_UPDATED: "folderUpdated",
  SUBFOLDER_ADDED: "subfolderAdded",
  SUBFOLDER_UPDATED: "subfolderUpdated",
  SUBFOLDER_REMOVED: "subfolderRemoved",
};

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function filetimeToLong(filetimeStr) {
  if (filetimeStr == null) return null;
  return { type: "long", value: BigInt(filetimeStr) };
}

function buildBookmarkKeyVal(bm) {
  return buildKeyVal([
    ["bookmarkID", bm.bookmarkID],
    ["folderID", bm.folderID],
    ["subfolderID", bm.subfolderID != null ? bm.subfolderID : null],
    ["itemID", bm.itemID != null ? bm.itemID : null],
    ["typeID", bm.typeID != null ? bm.typeID : null],
    ["locationID", bm.locationID],
    ["x", bm.x],
    ["y", bm.y],
    ["z", bm.z],
    ["memo", buildBookmarkText(bm.memo, 100, "")],
    ["note", buildBookmarkText(bm.note, 3900, "")],
    ["creatorID", bm.creatorID],
    ["created", filetimeToLong(bm.created)],
    ["expiry", filetimeToLong(bm.expiry)],
    ["flag", null],
  ]);
}

function buildSubfolderKeyVal(sf) {
  return buildKeyVal([
    ["subfolderID", sf.subfolderID],
    ["folderID", sf.folderID],
    ["subfolderName", buildBookmarkText(sf.subfolderName, 40, "Subfolder")],
    ["creatorID", sf.creatorID],
  ]);
}

/**
 * Find sessions for specific character IDs.
 * Returns array of {session, charID} pairs.
 */
function findSessionsForCharacters(charIDs, excludeCharID) {
  const charSet = new Set(charIDs.map((id) => Number(id)));
  const excludeID = excludeCharID != null ? Number(excludeCharID) : null;
  const matches = [];

  for (const session of sessionRegistry.getSessions()) {
    if (!session) continue;
    const sessionCharID = Number(session.characterID || 0);
    if (sessionCharID <= 0) continue;
    if (excludeID !== null && sessionCharID === excludeID) continue;
    if (charSet.has(sessionCharID)) {
      matches.push({ session, charID: sessionCharID });
    }
  }

  return matches;
}

// -----------------------------------------------------------------------
// Public broadcast functions
// -----------------------------------------------------------------------

/**
 * Broadcast OnSharedBookmarksFolderUpdated to all subscribers of a shared folder.
 *
 * @param {number} folderID - The shared folder to broadcast for
 * @param {Array} updates - Array of [target, updateType, updateArgs] tuples
 * @param {number|null} excludeCharID - Character to exclude (usually the caller)
 */
function broadcastFolderUpdate(folderID, updates, excludeCharID) {
  const subscribers = sharedBookmarkStore.getSubscribers(folderID);
  if (!subscribers.length) return 0;

  const sessions = findSessionsForCharacters(subscribers, excludeCharID);
  if (!sessions.length) return 0;

  // The client expects the payload as a list of [target, updateType, updateArgs]
  const payload = { type: "list", items: updates };

  let sentCount = 0;
  for (const { session } of sessions) {
    session.sendNotification("OnSharedBookmarksFolderUpdated", "charid", [payload]);
    sentCount++;
  }

  log.debug(
    `[BookmarkNotifications] broadcastFolderUpdate folder=${folderID} updates=${updates.length} sent=${sentCount}`,
  );
  return sentCount;
}

/**
 * Broadcast OnSharedBookmarksFolderDeleted to all subscribers.
 */
function broadcastFolderDeleted(folderID, subscribers) {
  if (!Array.isArray(subscribers) || !subscribers.length) return 0;

  const sessions = findSessionsForCharacters(subscribers, null);
  let sentCount = 0;
  for (const { session } of sessions) {
    session.sendNotification("OnSharedBookmarksFolderDeleted", "charid", [folderID]);
    sentCount++;
  }

  log.debug(
    `[BookmarkNotifications] broadcastFolderDeleted folder=${folderID} sent=${sentCount}`,
  );
  return sentCount;
}

/**
 * Broadcast OnSharedBookmarksFoldersAccessLost to specific characters.
 */
function broadcastAccessLost(charIDs, folderIDs) {
  if (!charIDs.length || !folderIDs.length) return 0;

  const sessions = findSessionsForCharacters(charIDs, null);
  const folderIDList = { type: "list", items: folderIDs };

  let sentCount = 0;
  for (const { session } of sessions) {
    session.sendNotification("OnSharedBookmarksFoldersAccessLost", "charid", [folderIDList]);
    sentCount++;
  }

  log.debug(
    `[BookmarkNotifications] broadcastAccessLost chars=${charIDs.length} folders=${folderIDs.length} sent=${sentCount}`,
  );
  return sentCount;
}

/**
 * Broadcast OnSharedBookmarksFoldersAccessChanged to specific characters.
 * @param {Object} accessChanges - { charID: {folderID: newAccessLevel, ...}, ... }
 */
function broadcastAccessChanged(accessChanges) {
  let sentCount = 0;

  for (const [charID, folderAccessMap] of Object.entries(accessChanges)) {
    const sessions = findSessionsForCharacters([Number(charID)], null);
    if (!sessions.length) continue;

    // Client expects { folderID: accessLevel, ... } as a dict
    const entries = Object.entries(folderAccessMap).map(
      ([fid, level]) => [Number(fid), level],
    );
    const accessDict = { type: "dict", entries };

    for (const { session } of sessions) {
      session.sendNotification("OnSharedBookmarksFoldersAccessChanged", "charid", [accessDict]);
      sentCount++;
    }
  }

  log.debug(
    `[BookmarkNotifications] broadcastAccessChanged sent=${sentCount}`,
  );
  return sentCount;
}

// -----------------------------------------------------------------------
// Convenience builders for creating update tuples
// -----------------------------------------------------------------------

/**
 * Build a "bookmarksAdded" update tuple.
 */
function buildBookmarksAddedUpdate(folderID, bookmarks) {
  return [
    [folderID],
    UPDATE_TYPES.BOOKMARKS_ADDED,
    { type: "list", items: bookmarks.map(buildBookmarkKeyVal) },
  ];
}

/**
 * Build a "bookmarksRemoved" update tuple.
 */
function buildBookmarksRemovedUpdate(folderID, bookmarkIDs) {
  return [
    [folderID],
    UPDATE_TYPES.BOOKMARKS_REMOVED,
    { type: "list", items: bookmarkIDs },
  ];
}

/**
 * Build a "bookmarksUpdated" update tuple.
 */
function buildBookmarksUpdatedUpdate(folderID, bookmarks) {
  return [
    [folderID],
    UPDATE_TYPES.BOOKMARKS_UPDATED,
    { type: "list", items: bookmarks.map(buildBookmarkKeyVal) },
  ];
}

/**
 * Build a "bookmarksMoved" update tuple.
 */
function buildBookmarksMovedUpdate(bookmarks, oldFolderID, newFolderID) {
  return [
    [newFolderID],
    UPDATE_TYPES.BOOKMARKS_MOVED,
    [
      { type: "list", items: bookmarks.map(buildBookmarkKeyVal) },
      oldFolderID,
      newFolderID,
    ],
  ];
}

/**
 * Build a "folderUpdated" update tuple.
 */
function buildFolderUpdatedUpdate(folderID, name, description) {
  return [
    [folderID],
    UPDATE_TYPES.FOLDER_UPDATED,
    [
      buildBookmarkText(name, 40, ""),
      buildBookmarkText(description, 3900, ""),
    ],
  ];
}

/**
 * Build a "subfolderAdded" update tuple.
 */
function buildSubfolderAddedUpdate(folderID, subfolder) {
  return [
    [folderID],
    UPDATE_TYPES.SUBFOLDER_ADDED,
    buildSubfolderKeyVal(subfolder),
  ];
}

/**
 * Build a "subfolderUpdated" update tuple.
 */
function buildSubfolderUpdatedUpdate(folderID, subfolderID, subfolderName) {
  return [
    [folderID],
    UPDATE_TYPES.SUBFOLDER_UPDATED,
    [subfolderID, buildBookmarkText(subfolderName, 40, "")],
  ];
}

/**
 * Build a "subfolderRemoved" update tuple.
 */
function buildSubfolderRemovedUpdate(folderID, subfolderID) {
  return [
    [folderID],
    UPDATE_TYPES.SUBFOLDER_REMOVED,
    subfolderID,
  ];
}

module.exports = {
  UPDATE_TYPES,
  broadcastFolderUpdate,
  broadcastFolderDeleted,
  broadcastAccessLost,
  broadcastAccessChanged,
  buildBookmarksAddedUpdate,
  buildBookmarksRemovedUpdate,
  buildBookmarksUpdatedUpdate,
  buildBookmarksMovedUpdate,
  buildFolderUpdatedUpdate,
  buildSubfolderAddedUpdate,
  buildSubfolderUpdatedUpdate,
  buildSubfolderRemovedUpdate,
  // Re-export KeyVal builders for use by the service layer
  buildBookmarkKeyVal,
  buildSubfolderKeyVal,
};
