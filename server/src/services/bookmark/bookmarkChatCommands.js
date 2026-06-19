const path = require("path");

const runtime = require(path.join(__dirname, "./bookmarkRuntimeState"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const {
  TYPE_SOLAR_SYSTEM,
} = require(path.join(__dirname, "./bookmarkConstants"));

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function getContext(session) {
  if (!session || typeof session !== "object") {
    return {
      lastBookmarkID: null,
      lastFolderID: null,
      lastSharedFolderID: null,
      lastSubfolderID: null,
    };
  }
  session._bookmarkAutoContext =
    session._bookmarkAutoContext && typeof session._bookmarkAutoContext === "object"
      ? session._bookmarkAutoContext
      : {
          lastBookmarkID: null,
          lastFolderID: null,
          lastSharedFolderID: null,
          lastSubfolderID: null,
        };
  return session._bookmarkAutoContext;
}

function buildHelpText() {
  return [
    "/bookmarkauto help",
    "/bookmarkauto status",
    "/bookmarkauto here",
    "/bookmarkauto personal demo",
    "/bookmarkauto shared demo",
    "/bookmarkauto subfolder demo",
    "/bookmarkauto move all demo",
    "/bookmarkauto copy all demo",
    "/bookmarkauto expire demo",
    "/bookmarkauto warp last",
    "/bookmarkauto smoke",
  ].join("\n");
}

function resolveHereTarget(session) {
  const stationID = toInt(session && (session.stationid || session.stationID || session.structureid || session.structureID), 0);
  if (stationID > 0) {
    return runtime.resolveStaticBookmarkTarget(stationID, session);
  }

  const scene = spaceRuntime.getSceneForSession(session);
  const shipEntity = scene ? scene.getShipEntityForSession(session) : null;
  const systemID = toInt(session && (session.solarsystemid2 || session.solarsystemid), 0);
  if (shipEntity && systemID > 0) {
    return {
      itemID: systemID,
      typeID: TYPE_SOLAR_SYSTEM,
      locationID: systemID,
      x: Number(shipEntity.position && shipEntity.position.x) || 0,
      y: Number(shipEntity.position && shipEntity.position.y) || 0,
      z: Number(shipEntity.position && shipEntity.position.z) || 0,
    };
  }

  return null;
}

function getFirstPersonalFolderView(session) {
  return runtime.listFolderViews(session.characterID).find((view) => view.folder.isPersonal) || null;
}

function getBookmarksInFolder(session, folderID) {
  return runtime
    .getMyActiveBookmarks(session.characterID)
    .bookmarks
    .filter((bookmark) => bookmark.folderID === folderID);
}

function createBookmarkInFolder(session, folderID, name, note = "", expiryMode = 0, subfolderID = null) {
  const target = resolveHereTarget(session);
  if (!target) {
    return {
      success: false,
      message: "No valid current location target for bookmark creation.",
    };
  }
  const result = runtime.createBookmark(session.characterID, {
    folderID,
    memo: name,
    note,
    expiryMode,
    subfolderID,
    ...target,
  });
  const context = getContext(session);
  context.lastBookmarkID = result.bookmark.bookmarkID;
  context.lastFolderID = result.folder.folderID;
  return {
    success: true,
    bookmark: result.bookmark,
    folder: result.folder,
  };
}

function executeBookmarkAutoCommand(session, rawText = "") {
  const tokens = String(rawText || "").trim().split(/\s+/).filter(Boolean);
  const subcommand = String(tokens[0] || "help").toLowerCase();
  const arg1 = String(tokens[1] || "").toLowerCase();
  const arg2 = String(tokens[2] || "").toLowerCase();
  const context = getContext(session);

  try {
    if (subcommand === "help") {
      return { success: true, message: buildHelpText() };
    }

    if (subcommand === "status") {
      const state = runtime.getMyActiveBookmarks(session.characterID);
      return {
        success: true,
        message: `Folders: ${state.folders.length}, bookmarks: ${state.bookmarks.length}, subfolders: ${state.subfolders.length}, lastBookmarkID: ${context.lastBookmarkID || "none"}`,
      };
    }

    if (subcommand === "here") {
      const personal = getFirstPersonalFolderView(session);
      if (!personal) {
        return { success: false, message: "No personal bookmark folder available." };
      }
      const created = createBookmarkInFolder(session, personal.folder.folderID, "Bookmark Auto Here");
      return created.success
        ? { success: true, message: `Created bookmark ${created.bookmark.bookmarkID} in ${personal.folder.folderName}.` }
        : created;
    }

    if (subcommand === "personal" && arg1 === "demo") {
      const folder = runtime.addFolder(session.characterID, {
        isPersonal: true,
        folderName: "Bookmark Auto Personal",
        description: "Bookmark auto personal demo folder",
      });
      context.lastFolderID = folder.folder.folderID;
      const created = createBookmarkInFolder(session, folder.folder.folderID, "Bookmark Auto Personal Spot");
      return {
        success: true,
        message: `Created personal demo folder ${folder.folder.folderName} (${folder.folder.folderID}) and bookmark ${created.bookmark.bookmarkID}.`,
      };
    }

    if (subcommand === "shared" && arg1 === "demo") {
      const groups = runtime.listGroupsForCharacter(session.characterID);
      if (groups.length <= 0) {
        return { success: false, message: "No bookmark access groups available for this character." };
      }
      const groupID = groups[0].groupID;
      const folder = runtime.addFolder(session.characterID, {
        isPersonal: false,
        folderName: "Bookmark Auto Shared",
        description: "Bookmark auto shared demo folder",
        adminGroupID: groupID,
        manageGroupID: groupID,
        useGroupID: groupID,
        viewGroupID: groupID,
      });
      context.lastFolderID = folder.folder.folderID;
      context.lastSharedFolderID = folder.folder.folderID;
      const created = createBookmarkInFolder(session, folder.folder.folderID, "Bookmark Auto Shared Spot");
      return {
        success: true,
        message: `Created shared demo folder ${folder.folder.folderName} (${folder.folder.folderID}) and bookmark ${created.bookmark.bookmarkID}.`,
      };
    }

    if (subcommand === "subfolder" && arg1 === "demo") {
      const folderID = context.lastSharedFolderID || context.lastFolderID || (getFirstPersonalFolderView(session) && getFirstPersonalFolderView(session).folder.folderID);
      if (!folderID) {
        return { success: false, message: "No folder available for subfolder demo." };
      }
      const subfolder = runtime.createSubfolder(session.characterID, folderID, "Bookmark Auto Subfolder");
      context.lastSubfolderID = subfolder.subfolderID;
      return {
        success: true,
        message: `Created subfolder ${subfolder.subfolderName} (${subfolder.subfolderID}) in folder ${folderID}.`,
      };
    }

    if (subcommand === "move" && arg1 === "all" && arg2 === "demo") {
      const folderID = context.lastFolderID || (getFirstPersonalFolderView(session) && getFirstPersonalFolderView(session).folder.folderID);
      if (!folderID || !context.lastSubfolderID) {
        return { success: false, message: "Need a source folder and subfolder first. Run /bookmarkauto personal demo and /bookmarkauto subfolder demo." };
      }
      const bookmarks = getBookmarksInFolder(session, folderID);
      const moved = runtime.moveBookmarks(session.characterID, folderID, folderID, context.lastSubfolderID, bookmarks.map((bookmark) => bookmark.bookmarkID));
      return {
        success: true,
        message: `Moved ${moved.movedBookmarks.length} bookmark(s) into subfolder ${context.lastSubfolderID}.`,
      };
    }

    if (subcommand === "copy" && arg1 === "all" && arg2 === "demo") {
      const personal = getFirstPersonalFolderView(session);
      const sharedFolderID = context.lastSharedFolderID;
      if (!personal || !sharedFolderID) {
        return { success: false, message: "Need both a personal and shared demo folder first." };
      }
      const bookmarks = getBookmarksInFolder(session, personal.folder.folderID);
      const copied = runtime.copyBookmarks(session.characterID, personal.folder.folderID, sharedFolderID, null, bookmarks.map((bookmark) => bookmark.bookmarkID));
      return {
        success: true,
        message: `Copied ${copied.length} bookmark(s) into shared folder ${sharedFolderID}.`,
      };
    }

    if (subcommand === "expire" && arg1 === "demo") {
      const personal = getFirstPersonalFolderView(session);
      if (!personal) {
        return { success: false, message: "No personal bookmark folder available." };
      }
      const created = createBookmarkInFolder(session, personal.folder.folderID, "Bookmark Auto Expiry", "", 1);
      return {
        success: true,
        message: `Created expiring bookmark ${created.bookmark.bookmarkID}.`,
      };
    }

    if (subcommand === "warp" && arg1 === "last") {
      if (!context.lastBookmarkID) {
        return { success: false, message: "No last bookmark stored in bookmark auto context." };
      }
      const target = runtime.resolveBookmarkTarget(context.lastBookmarkID);
      if (!target) {
        return { success: false, message: "Last bookmark target is no longer available." };
      }
      const result =
        target.kind === "item"
          ? spaceRuntime.warpToEntity(session, target.itemID, { minimumRange: 0 })
          : spaceRuntime.warpToPoint(session, target.point, { minimumRange: 0 });
      return {
        success: Boolean(result && result.success),
        message: result && result.success
          ? `Warp initiated to bookmark ${context.lastBookmarkID}.`
          : `Warp failed for bookmark ${context.lastBookmarkID}: ${(result && result.errorMsg) || "UNKNOWN_ERROR"}`,
      };
    }

    if (subcommand === "smoke") {
      const personalDemo = executeBookmarkAutoCommand(session, "personal demo");
      const sharedDemo = executeBookmarkAutoCommand(session, "shared demo");
      const subfolderDemo = executeBookmarkAutoCommand(session, "subfolder demo");
      const moveDemo = executeBookmarkAutoCommand(session, "move all demo");
      const copyDemo = executeBookmarkAutoCommand(session, "copy all demo");
      return {
        success: true,
        message: [
          personalDemo.message,
          sharedDemo.message,
          subfolderDemo.message,
          moveDemo.message,
          copyDemo.message,
        ].join("\n"),
      };
    }

    return { success: false, message: `Unknown /bookmarkauto subcommand: ${subcommand}` };
  } catch (error) {
    return {
      success: false,
      message: `Bookmark auto command failed: ${(error && (error.bookmarkError || error.message)) || "UNKNOWN_ERROR"}`,
    };
  }
}

module.exports = {
  executeBookmarkAutoCommand,
};
