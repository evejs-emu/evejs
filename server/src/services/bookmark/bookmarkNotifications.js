const path = require("path");

const sessionRegistry = require(path.join(__dirname, "../chat/sessionRegistry"));
const runtime = require(path.join(__dirname, "./bookmarkRuntimeState"));
const {
  BOOKMARKS_ADDED,
  BOOKMARKS_MOVED,
  BOOKMARKS_REMOVED,
  BOOKMARKS_UPDATED,
  FOLDER_UPDATED,
  SUBFOLDER_ADDED,
  SUBFOLDER_REMOVED,
  SUBFOLDER_UPDATED,
} = require(path.join(__dirname, "./bookmarkConstants"));
const {
  buildBookmarkIDSet,
  buildBookmarkPayload,
  buildBookmarkText,
  buildFolderUpdateTuple,
  buildSubfolderPayload,
} = require(path.join(__dirname, "./bookmarkPayloads"));

function getCharacterID(session) {
  return Number(session && session.characterID) || 0;
}

function getActiveFolderView(characterID, folderID) {
  try {
    const view = runtime.getFolderInfo(characterID, folderID);
    return view && view.isActive ? view : null;
  } catch (error) {
    return null;
  }
}

function collectRecipientSessions(folderIDs = [], excludeCharacterID = 0) {
  const normalizedFolderIDs = [...new Set((Array.isArray(folderIDs) ? folderIDs : [folderIDs]).map((folderID) => Number(folderID) || 0).filter((folderID) => folderID > 0))];
  if (normalizedFolderIDs.length <= 0) {
    return [];
  }
  return sessionRegistry.getSessions().filter((session) => {
    const characterID = getCharacterID(session);
    if (!characterID || characterID === excludeCharacterID) {
      return false;
    }
    return normalizedFolderIDs.some((folderID) => getActiveFolderView(characterID, folderID));
  });
}

function sendFolderUpdated(folderIDs, updateTuple, excludeCharacterID = 0) {
  const recipients = collectRecipientSessions(folderIDs, excludeCharacterID);
  if (recipients.length <= 0) {
    return;
  }
  for (const session of recipients) {
    session.sendServiceNotification("bookmarkSvc", "OnSharedBookmarksFolderUpdated", [[updateTuple]]);
  }
}

function notifyBookmarksAdded(folderID, bookmarks, options = {}) {
  if (!Array.isArray(bookmarks) || bookmarks.length <= 0) {
    return;
  }
  sendFolderUpdated(
    [folderID],
    buildFolderUpdateTuple(
      folderID,
      BOOKMARKS_ADDED,
      bookmarks.map(buildBookmarkPayload),
    ),
    Number(options.excludeCharacterID || 0),
  );
}

function notifyBookmarksUpdated(folderID, bookmarks, options = {}) {
  if (!Array.isArray(bookmarks) || bookmarks.length <= 0) {
    return;
  }
  sendFolderUpdated(
    [folderID],
    buildFolderUpdateTuple(
      folderID,
      BOOKMARKS_UPDATED,
      bookmarks.map(buildBookmarkPayload),
    ),
    Number(options.excludeCharacterID || 0),
  );
}

function notifyBookmarksRemoved(folderID, bookmarkIDs, options = {}) {
  if (!Array.isArray(bookmarkIDs) || bookmarkIDs.length <= 0) {
    return;
  }
  sendFolderUpdated(
    [folderID],
    buildFolderUpdateTuple(folderID, BOOKMARKS_REMOVED, buildBookmarkIDSet(bookmarkIDs)),
    Number(options.excludeCharacterID || 0),
  );
}

function notifyBookmarksMoved(oldFolderID, newFolderID, bookmarks, options = {}) {
  if (!Array.isArray(bookmarks) || bookmarks.length <= 0) {
    return;
  }
  sendFolderUpdated(
    [oldFolderID, newFolderID],
    buildFolderUpdateTuple(
      oldFolderID,
      BOOKMARKS_MOVED,
      [
        bookmarks.map(buildBookmarkPayload),
        Number(oldFolderID) || 0,
        Number(newFolderID) || 0,
      ],
    ),
    Number(options.excludeCharacterID || 0),
  );
}

function notifyFolderUpdated(folderID, folder, options = {}) {
  sendFolderUpdated(
    [folderID],
    buildFolderUpdateTuple(
      folderID,
      FOLDER_UPDATED,
      [
        buildBookmarkText(folder && folder.folderName, 40, ""),
        buildBookmarkText(folder && folder.description, 3900, ""),
      ],
    ),
    Number(options.excludeCharacterID || 0),
  );
}

function notifySubfolderAdded(folderID, subfolder, options = {}) {
  sendFolderUpdated(
    [folderID],
    buildFolderUpdateTuple(folderID, SUBFOLDER_ADDED, buildSubfolderPayload(subfolder)),
    Number(options.excludeCharacterID || 0),
  );
}

function notifySubfolderUpdated(folderID, subfolderID, subfolderName, options = {}) {
  sendFolderUpdated(
    [folderID],
    buildFolderUpdateTuple(
      folderID,
      SUBFOLDER_UPDATED,
      [Number(subfolderID) || 0, buildBookmarkText(subfolderName, 40, "")],
    ),
    Number(options.excludeCharacterID || 0),
  );
}

function notifySubfolderRemoved(folderID, subfolderID, options = {}) {
  sendFolderUpdated(
    [folderID],
    buildFolderUpdateTuple(folderID, SUBFOLDER_REMOVED, Number(subfolderID) || 0),
    Number(options.excludeCharacterID || 0),
  );
}

function notifyFolderDeleted(folderID, options = {}) {
  const recipients = collectRecipientSessions([folderID], Number(options.excludeCharacterID || 0));
  for (const session of recipients) {
    session.sendServiceNotification("bookmarkSvc", "OnSharedBookmarksFolderDeleted", [Number(folderID) || 0]);
  }
}

module.exports = {
  notifyBookmarksAdded,
  notifyBookmarksMoved,
  notifyBookmarksRemoved,
  notifyBookmarksUpdated,
  notifyFolderDeleted,
  notifyFolderUpdated,
  notifySubfolderAdded,
  notifySubfolderRemoved,
  notifySubfolderUpdated,
};
