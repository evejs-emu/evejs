const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const { buildList } = require(path.join(__dirname, "../_shared/serviceHelpers"));
const runtime = require(path.join(__dirname, "./bookmarkRuntimeState"));
const {
  buildBookmarkPayload,
  buildFolderPayload,
} = require(path.join(__dirname, "./bookmarkPayloads"));

function getCharacterID(session) {
  return Number(session && session.characterID) || 0;
}

function buildFolderViewPayload(view) {
  return buildFolderPayload(view.folder, {
    accessLevel: view.accessLevel,
    isActive: view.isActive,
  });
}

class BookmarkService extends BaseService {
  constructor() {
    super("bookmarkMgr");
  }

  Handle_GetBookmarks(args, session) {
    const result = runtime.getMyActiveBookmarks(getCharacterID(session));
    return [
      buildList(result.bookmarks.map(buildBookmarkPayload)),
      buildList(result.folders.map(buildFolderViewPayload)),
    ];
  }

  Handle_CreateFolder(args, session) {
    const view = runtime.addFolder(getCharacterID(session), {
      isPersonal: true,
      folderName: args && args[0],
      description: args && args[1],
    });
    return buildFolderViewPayload(view);
  }

  Handle_GetFolders(args, session) {
    return buildList(runtime.listFolderViews(getCharacterID(session)).map(buildFolderViewPayload));
  }

  Handle_GetBookmarksInFolder(args, session) {
    const folderInfo = runtime.getFolderInfo(getCharacterID(session), args && args[0]);
    return buildList(
      runtime
        .getMyActiveBookmarks(getCharacterID(session))
        .bookmarks
        .filter((bookmark) => bookmark.folderID === folderInfo.folder.folderID)
        .map(buildBookmarkPayload),
    );
  }
}

module.exports = BookmarkService;
