const path = require("path");
const BaseService = require("../baseService");
const log = require("../../utils/logger");
const {
  normalizeNumber,
  normalizeText,
  buildKeyVal,
} = require("../_shared/serviceHelpers");
const {
  throwWrappedUserError,
} = require("../../common/machoErrors");
const worldData = require("../../space/worldData");
const bookmarkStore = require("./bookmarkStore");
const sharedBookmarkStore = require("./sharedBookmarkStore");
const bookmarkNotifications = require("./bookmarkNotifications");
const {
  buildBookmarkText,
} = require("../bookmark/bookmarkPayloads");

// -----------------------------------------------------------------------
// Expiry constant → ms offset from creation time
// -----------------------------------------------------------------------
const EXPIRY_MS = {
  0: null,               // BOOKMARK_EXPIRY_NONE  → no expiry
  1: 4 * 60 * 60 * 1000, // BOOKMARK_EXPIRY_4HOURS
  2: 2 * 24 * 60 * 60 * 1000, // BOOKMARK_EXPIRY_2DAYS
  3: 24 * 60 * 60 * 1000,     // BOOKMARK_EXPIRY_24HOURS
};

function resolveExpiry(expiryConstant) {
  const ms = EXPIRY_MS[Number(expiryConstant)];
  if (!ms) return null;
  return Date.now() + ms;
}

/**
 * Resolve position + locationID (solar system) for a static itemID.
 * Returns { x, y, z, locationID, typeID } or null if unresolvable.
 */
function resolveStaticItemGeometry(itemID) {
  const numID = Number(itemID);

  // Solar system IDs are in the range 30000000–31999999 in EVE
  if (numID >= 30000000 && numID < 40000000) {
    const system = worldData.getSolarSystemByID(numID);
    if (system) {
      const pos = system.position || {};
      return {
        x: Number(pos.x || 0),
        y: Number(pos.y || 0),
        z: Number(pos.z || 0),
        locationID: numID,
        typeID: system.sunTypeID || null,
      };
    }
  }

  // Station IDs: 60000000–64999999
  if (numID >= 60000000 && numID < 65000000) {
    const station = worldData.getStationByID(numID);
    if (station) {
      const pos = station.position || {};
      return {
        x: Number(pos.x || 0),
        y: Number(pos.y || 0),
        z: Number(pos.z || 0),
        locationID: Number(station.solarSystemID),
        typeID: station.stationTypeID || null,
      };
    }
  }

  // Stargates: 50000000–59999999
  if (numID >= 50000000 && numID < 60000000) {
    const gate = worldData.getStargateByID(numID);
    if (gate) {
      const pos = gate.position || {};
      return {
        x: Number(pos.x || 0),
        y: Number(pos.y || 0),
        z: Number(pos.z || 0),
        locationID: Number(gate.solarSystemID),
        typeID: gate.typeID || null,
      };
    }
  }

  // Celestials (planets, moons, belts, etc.): 40000000–49999999
  if (numID >= 40000000 && numID < 50000000) {
    const cel = worldData.getCelestialByID(numID);
    if (cel) {
      const pos = cel.position || {};
      return {
        x: Number(pos.x || 0),
        y: Number(pos.y || 0),
        z: Number(pos.z || 0),
        locationID: Number(cel.solarSystemID),
        typeID: cel.typeID || null,
      };
    }
  }

  return null;
}

/**
 * Convert a plain folder JS object into a KeyVal-wrapped object
 * that the Python client can iterate and access attributes on.
 */
function buildFolderKeyVal(folder) {
  return buildKeyVal([
    ["folderID", folder.folderID],
    ["folderName", buildBookmarkText(folder.folderName, 40, "Folder")],
    ["description", buildBookmarkText(folder.description, 3900, "")],
    ["isPersonal", folder.isPersonal],
    ["isActive", folder.isActive],
    ["accessLevel", folder.accessLevel],
    ["adminGroupID", folder.adminGroupID || null],
    ["manageGroupID", folder.manageGroupID || null],
    ["useGroupID", folder.useGroupID || null],
    ["viewGroupID", folder.viewGroupID || null],
  ]);
}

/**
 * Convert a filetime string (from bookmarkStore) into a marshal-compatible
 * {type:"long"} wrapper so it is serialized as int64 (PyLongLong).
 * Returns null if the input is null/undefined.
 */
function filetimeToLong(filetimeStr) {
  if (filetimeStr == null) return null;
  return { type: "long", value: BigInt(filetimeStr) };
}

/**
 * Convert a plain bookmark JS object into a KeyVal-wrapped object.
 */
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

/**
 * Convert a plain subfolder JS object into a KeyVal-wrapped object.
 */
function buildSubfolderKeyVal(sf) {
  return buildKeyVal([
    ["subfolderID", sf.subfolderID],
    ["folderID", sf.folderID],
    ["subfolderName", buildBookmarkText(sf.subfolderName, 40, "Subfolder")],
    ["creatorID", sf.creatorID],
  ]);
}

/**
 * Normalize a Python-set / array / objectex1 argument into a plain JS array
 * of numbers. The client may send bookmark IDs as a Python set which
 * deserializes as an ObjectEx1 struct.
 */
function normalizeIDSetArg(rawIDs) {
  if (Array.isArray(rawIDs)) {
    return rawIDs;
  }
  if (rawIDs && typeof rawIDs === "object" && Array.isArray(rawIDs.items)) {
    return rawIDs.items;
  }
  if (
    rawIDs &&
    rawIDs.type === "objectex1" &&
    Array.isArray(rawIDs.header) && rawIDs.header.length >= 2 &&
    Array.isArray(rawIDs.header[1]) && rawIDs.header[1].length >= 1
  ) {
    const inner = rawIDs.header[1][0];
    return Array.isArray(inner) ? inner
      : inner && Array.isArray(inner.items) ? inner.items
      : [];
  }
  if (typeof rawIDs === "number" && rawIDs > 0) {
    return [rawIDs];
  }
  return [];
}

class AccessGroupBookmarkMgrService extends BaseService {
  constructor() {
    super("accessGroupBookmarkMgr");
  }

  // -----------------------------------------------------------------------
  // Initial load
  // -----------------------------------------------------------------------

  Handle_GetMyActiveBookmarks(args, session) {
    const charID = session && session.characterID;
    log.debug(`[AccessGroupBookmarkMgr] GetMyActiveBookmarks char=${charID}`);

    bookmarkStore.ensureBookmarkData(charID);
    bookmarkStore.cleanupExpiredBookmarks(charID);
    const [personalFolders, personalBookmarks, personalSubfolders] = bookmarkStore.getActiveBookmarks(charID);

    // Merge in shared folders that the character has subscribed to
    const knownShared = bookmarkStore.getKnownSharedFolders(charID);
    const allFolders = [...personalFolders];
    const allBookmarks = [...personalBookmarks];
    const allSubfolders = [...personalSubfolders];

    for (const known of knownShared) {
      const folder = sharedBookmarkStore.getSharedFolder(known.folderID);
      if (!folder) continue;

      // Clean up expired bookmarks in shared folder
      sharedBookmarkStore.cleanupExpiredBookmarksInFolder(known.folderID);

      const accessLevel = sharedBookmarkStore.computeAccessLevel(charID, folder);
      if (accessLevel <= sharedBookmarkStore.ACCESS_NONE) continue;

      allFolders.push(sharedBookmarkStore.buildFolderView(charID, folder, known.isActive));

      if (known.isActive) {
        const sharedBookmarks = sharedBookmarkStore.getBookmarksInFolder(known.folderID);
        allBookmarks.push(...sharedBookmarks);
        const sharedSubfolders = sharedBookmarkStore.getSubfoldersInFolder(known.folderID);
        allSubfolders.push(...sharedSubfolders);
      }
    }

    return [
      { type: "list", items: allFolders.map(buildFolderKeyVal) },
      { type: "list", items: allBookmarks.map(buildBookmarkKeyVal) },
      { type: "list", items: allSubfolders.map(buildSubfolderKeyVal) },
    ];
  }

  // -----------------------------------------------------------------------
  // Folder CRUD
  // -----------------------------------------------------------------------

  Handle_AddFolder(args, session) {
    const charID = session && session.characterID;
    const isPersonal = args && args[0] !== undefined ? Boolean(args[0]) : true;
    const folderName = normalizeText(args && args[1], "My Locations");
    const description = normalizeText(args && args[2], "");
    const adminGroupID = args && args[3] != null ? normalizeNumber(args[3], null) : null;
    const manageGroupID = args && args[4] != null ? normalizeNumber(args[4], null) : null;
    const useGroupID = args && args[5] != null ? normalizeNumber(args[5], null) : null;
    const viewGroupID = args && args[6] != null ? normalizeNumber(args[6], null) : null;

    log.info(
      `[AccessGroupBookmarkMgr] AddFolder char=${charID} personal=${isPersonal} name="${folderName}"`,
    );

    if (isPersonal) {
      const folder = bookmarkStore.addFolder(charID, isPersonal, folderName, description);
      return folder ? buildFolderKeyVal(folder) : null;
    }

    // Shared folder: create in global store
    const sharedFolder = sharedBookmarkStore.createSharedFolder(
      charID, folderName, description, adminGroupID, manageGroupID, useGroupID, viewGroupID,
    );
    if (!sharedFolder) return null;

    // Automatically add to the creator's known shared folders
    bookmarkStore.addKnownSharedFolder(charID, sharedFolder.folderID, true);

    const folderView = sharedBookmarkStore.buildFolderView(charID, sharedFolder, true);
    return buildFolderKeyVal(folderView);
  }

  Handle_UpdateFolder(args, session) {
    const charID = session && session.characterID;
    const folderID = normalizeNumber(args && args[0], 0);
    const folderName = normalizeText(args && args[1], "");
    const description = normalizeText(args && args[2], "");
    const adminGroupID = args && args[3] != null ? normalizeNumber(args[3], null) : null;
    const manageGroupID = args && args[4] != null ? normalizeNumber(args[4], null) : null;
    const useGroupID = args && args[5] != null ? normalizeNumber(args[5], null) : null;
    const viewGroupID = args && args[6] != null ? normalizeNumber(args[6], null) : null;

    log.info(
      `[AccessGroupBookmarkMgr] UpdateFolder char=${charID} folder=${folderID} name="${folderName}"`,
    );

    if (!sharedBookmarkStore.isSharedFolderID(folderID)) {
      return bookmarkStore.updateFolder(charID, folderID, folderName, description);
    }

    // Shared folder update
    const updatedFolder = sharedBookmarkStore.updateSharedFolder(
      folderID, folderName, description, adminGroupID, manageGroupID, useGroupID, viewGroupID,
    );
    if (!updatedFolder) return sharedBookmarkStore.ACCESS_NONE;

    const accessLevel = sharedBookmarkStore.computeAccessLevel(charID, updatedFolder);

    // Broadcast folder update to other subscribers
    const update = bookmarkNotifications.buildFolderUpdatedUpdate(
      folderID, folderName, description,
    );
    bookmarkNotifications.broadcastFolderUpdate(folderID, [update], charID);

    return accessLevel;
  }

  Handle_DeleteFolder(args, session) {
    const charID = session && session.characterID;
    const folderID = normalizeNumber(args && args[0], 0);

    log.info(
      `[AccessGroupBookmarkMgr] DeleteFolder char=${charID} folder=${folderID}`,
    );

    if (!sharedBookmarkStore.isSharedFolderID(folderID)) {
      bookmarkStore.deleteFolder(charID, folderID);
      return null;
    }

    // Shared folder: broadcast deletion before removing
    const subscribers = sharedBookmarkStore.getSubscribers(folderID);
    sharedBookmarkStore.deleteSharedFolder(folderID);

    // Remove from all subscribers' known lists
    for (const subCharID of subscribers) {
      bookmarkStore.removeKnownSharedFolder(subCharID, folderID);
    }

    bookmarkNotifications.broadcastFolderDeleted(folderID, subscribers);
    return null;
  }

  Handle_GetFolderInfo(args, session) {
    const charID = session && session.characterID;
    const folderID = normalizeNumber(args && args[0], 0);

    log.debug(
      `[AccessGroupBookmarkMgr] GetFolderInfo char=${charID} folder=${folderID}`,
    );

    if (!sharedBookmarkStore.isSharedFolderID(folderID)) {
      const folder = bookmarkStore.getFolderByID(charID, folderID);
      if (!folder) {
        log.warn(`[AccessGroupBookmarkMgr] GetFolderInfo: folder ${folderID} not found`);
        return null;
      }
      return buildFolderKeyVal(folder);
    }

    // Shared folder
    const sharedFolder = sharedBookmarkStore.getSharedFolder(folderID);
    if (!sharedFolder) {
      log.warn(`[AccessGroupBookmarkMgr] GetFolderInfo: shared folder ${folderID} not found`);
      throwWrappedUserError("FolderAccessDenied");
      return null;
    }

    const accessLevel = sharedBookmarkStore.computeAccessLevel(charID, sharedFolder);
    if (accessLevel <= sharedBookmarkStore.ACCESS_NONE) {
      log.warn(`[AccessGroupBookmarkMgr] GetFolderInfo: access denied for char=${charID} folder=${folderID}`);
      throwWrappedUserError("FolderAccessDenied");
      return null;
    }

    const known = bookmarkStore.getKnownSharedFolders(charID);
    const knownEntry = known.find((k) => Number(k.folderID) === Number(folderID));
    const isActive = knownEntry ? knownEntry.isActive : false;

    return buildFolderKeyVal(sharedBookmarkStore.buildFolderView(charID, sharedFolder, isActive));
  }

  Handle_SearchFoldersWithAdminAccess(args, session) {
    const charID = session && session.characterID;

    log.debug(
      `[AccessGroupBookmarkMgr] SearchFoldersWithAdminAccess char=${charID}`,
    );

    // Return personal folders + shared folders where char has admin access
    const personalFolders = bookmarkStore.getAllFolders(charID);
    const adminSharedFolders = sharedBookmarkStore.findAdminFolders(charID);

    const allFolders = [
      ...personalFolders,
      ...adminSharedFolders.map((f) => sharedBookmarkStore.buildFolderView(charID, f, true)),
    ];

    return { type: "list", items: allFolders.map(buildFolderKeyVal) };
  }

  // -----------------------------------------------------------------------
  // Known Shared Folder Management
  // -----------------------------------------------------------------------

  Handle_AddToKnownFolders(args, session) {
    const charID = session && session.characterID;
    const folderID = normalizeNumber(args && args[0], 0);
    const isActive = args && args[1] !== undefined ? Boolean(args[1]) : true;

    log.info(
      `[AccessGroupBookmarkMgr] AddToKnownFolders char=${charID} folder=${folderID} active=${isActive}`,
    );

    const sharedFolder = sharedBookmarkStore.getSharedFolder(folderID);
    if (!sharedFolder) {
      log.warn(`[AccessGroupBookmarkMgr] AddToKnownFolders: folder ${folderID} not found`);
      return [null, { type: "list", items: [] }, { type: "list", items: [] }];
    }

    const accessLevel = sharedBookmarkStore.computeAccessLevel(charID, sharedFolder);
    if (accessLevel <= sharedBookmarkStore.ACCESS_NONE) {
      log.warn(`[AccessGroupBookmarkMgr] AddToKnownFolders: access denied char=${charID} folder=${folderID}`);
      return [null, { type: "list", items: [] }, { type: "list", items: [] }];
    }

    // Add character as subscriber
    sharedBookmarkStore.addSubscriber(folderID, charID);
    bookmarkStore.addKnownSharedFolder(charID, folderID, isActive);

    const folderView = sharedBookmarkStore.buildFolderView(charID, sharedFolder, isActive);
    const bookmarks = isActive ? sharedBookmarkStore.getBookmarksInFolder(folderID) : [];
    const subfolders = isActive ? sharedBookmarkStore.getSubfoldersInFolder(folderID) : [];

    return [
      buildFolderKeyVal(folderView),
      { type: "list", items: bookmarks.map(buildBookmarkKeyVal) },
      { type: "list", items: subfolders.map(buildSubfolderKeyVal) },
    ];
  }

  Handle_RemoveFromKnownFolders(args, session) {
    const charID = session && session.characterID;
    const folderID = normalizeNumber(args && args[0], 0);

    log.info(
      `[AccessGroupBookmarkMgr] RemoveFromKnownFolders char=${charID} folder=${folderID}`,
    );

    sharedBookmarkStore.removeSubscriber(folderID, charID);
    bookmarkStore.removeKnownSharedFolder(charID, folderID);

    return null;
  }

  Handle_UpdateKnownFolderState(args, session) {
    const charID = session && session.characterID;
    const folderID = normalizeNumber(args && args[0], 0);
    const isActive = args && args[1] !== undefined ? Boolean(args[1]) : true;

    log.info(
      `[AccessGroupBookmarkMgr] UpdateKnownFolderState char=${charID} folder=${folderID} active=${isActive}`,
    );

    const sharedFolder = sharedBookmarkStore.getSharedFolder(folderID);
    if (!sharedFolder) {
      log.warn(`[AccessGroupBookmarkMgr] UpdateKnownFolderState: folder ${folderID} not found`);
      return [null, { type: "list", items: [] }, { type: "list", items: [] }];
    }

    const accessLevel = sharedBookmarkStore.computeAccessLevel(charID, sharedFolder);
    if (accessLevel <= sharedBookmarkStore.ACCESS_NONE) {
      log.warn(`[AccessGroupBookmarkMgr] UpdateKnownFolderState: access denied char=${charID} folder=${folderID}`);
      return [null, { type: "list", items: [] }, { type: "list", items: [] }];
    }

    bookmarkStore.updateKnownSharedFolderState(charID, folderID, isActive);

    const folderView = sharedBookmarkStore.buildFolderView(charID, sharedFolder, isActive);
    const bookmarks = isActive ? sharedBookmarkStore.getBookmarksInFolder(folderID) : [];
    const subfolders = isActive ? sharedBookmarkStore.getSubfoldersInFolder(folderID) : [];

    return [
      buildFolderKeyVal(folderView),
      { type: "list", items: bookmarks.map(buildBookmarkKeyVal) },
      { type: "list", items: subfolders.map(buildSubfolderKeyVal) },
    ];
  }

  // -----------------------------------------------------------------------
  // Bookmark CRUD
  // -----------------------------------------------------------------------

  Handle_BookmarkStaticLocation(args, session) {
    const charID = session && session.characterID;
    const itemID = normalizeNumber(args && args[0], 0);
    const folderID = normalizeNumber(args && args[1], 0);
    const name = normalizeText(args && args[2], "");
    const comment = normalizeText(args && args[3], "");
    const expiryConstant = normalizeNumber(args && args[4], 0);
    const subfolderID = args && args[5] != null ? normalizeNumber(args[5], null) : null;

    log.info(
      `[AccessGroupBookmarkMgr] BookmarkStaticLocation char=${charID} item=${itemID} folder=${folderID} name="${name}"`,
    );

    const geo = resolveStaticItemGeometry(itemID);
    if (!geo) {
      log.warn(
        `[AccessGroupBookmarkMgr] BookmarkStaticLocation: could not resolve geometry for item=${itemID}`,
      );
      return null;
    }

    const expiry = resolveExpiry(expiryConstant);
    const bookmarkOpts = {
      folderID,
      itemID,
      typeID: geo.typeID,
      locationID: geo.locationID,
      x: geo.x,
      y: geo.y,
      z: geo.z,
      memo: name,
      note: comment,
      expiry,
      subfolderID,
      creatorID: charID,
    };

    let result;
    if (sharedBookmarkStore.isSharedFolderID(folderID)) {
      // Shared folder: write to global store and broadcast
      result = sharedBookmarkStore.addBookmarkToSharedFolder(folderID, bookmarkOpts);
      if (result) {
        // Get the full bookmark object for notification
        const bookmarks = sharedBookmarkStore.getBookmarksInFolder(folderID);
        const newBm = bookmarks.find((b) => Number(b.bookmarkID) === result[0]);
        if (newBm) {
          const update = bookmarkNotifications.buildBookmarksAddedUpdate(folderID, [newBm]);
          bookmarkNotifications.broadcastFolderUpdate(folderID, [update], charID);
        }
      }
    } else {
      // Personal folder
      result = bookmarkStore.addBookmark(charID, bookmarkOpts);
    }

    if (!result) {
      return null;
    }
    // result = [bookmarkID, itemID, typeID, x, y, z, locationID, expiryDate]
    // Wrap expiryDate (index 7) as int64 for the client's datetime formatter.
    result[7] = filetimeToLong(result[7]);
    return result;
  }

  Handle_UpdateBookmark(args, session) {
    const charID = session && session.characterID;
    const bookmarkID = normalizeNumber(args && args[0], 0);
    const folderID = normalizeNumber(args && args[1], 0);
    const name = normalizeText(args && args[2], "");
    const note = normalizeText(args && args[3], "");
    const subfolderID = args && args[4] != null ? normalizeNumber(args[4], null) : null;
    const newFolderID = normalizeNumber(args && args[5], folderID);
    const expiryCancel = args && args[6] ? Boolean(args[6]) : false;

    log.info(
      `[AccessGroupBookmarkMgr] UpdateBookmark char=${charID} bm=${bookmarkID} folder=${newFolderID} name="${name}" expiryCancel=${expiryCancel}`,
    );

    if (sharedBookmarkStore.isSharedFolderID(folderID)) {
      // Shared folder bookmark update
      const updatedBm = sharedBookmarkStore.updateBookmarkInSharedFolder(folderID, bookmarkID, {
        memo: name,
        note,
        subfolderID,
        expiryCancel,
      });
      if (updatedBm) {
        const update = bookmarkNotifications.buildBookmarksUpdatedUpdate(folderID, [updatedBm]);
        bookmarkNotifications.broadcastFolderUpdate(folderID, [update], charID);
      }
    } else {
      bookmarkStore.updateBookmark(charID, bookmarkID, {
        memo: name,
        note,
        folderID: newFolderID,
        subfolderID,
        expiryCancel,
      });
    }

    return null;
  }

  Handle_DeleteBookmarks(args, session) {
    const charID = session && session.characterID;
    const folderID = normalizeNumber(args && args[0], 0);
    const bookmarkIDs = normalizeIDSetArg(args && args[1]);

    log.info(
      `[AccessGroupBookmarkMgr] DeleteBookmarks char=${charID} folder=${folderID} ids=${JSON.stringify(bookmarkIDs)}`,
    );

    let deleted;
    if (sharedBookmarkStore.isSharedFolderID(folderID)) {
      deleted = sharedBookmarkStore.deleteBookmarksFromSharedFolder(folderID, bookmarkIDs);
      if (deleted.length > 0) {
        const update = bookmarkNotifications.buildBookmarksRemovedUpdate(folderID, deleted);
        bookmarkNotifications.broadcastFolderUpdate(folderID, [update], charID);
      }
    } else {
      deleted = bookmarkStore.deleteBookmarks(charID, folderID, bookmarkIDs);
    }

    return { type: "list", items: deleted };
  }

  Handle_MoveBookmarksToFolderAndSubfolder(args, session) {
    const charID = session && session.characterID;
    const oldFolderID = normalizeNumber(args && args[0], 0);
    const newFolderID = normalizeNumber(args && args[1], 0);
    const subfolderID = args && args[2] != null ? normalizeNumber(args[2], null) : null;
    const bookmarkIDs = normalizeIDSetArg(args && args[3]);

    log.info(
      `[AccessGroupBookmarkMgr] MoveBookmarks char=${charID} from=${oldFolderID} to=${newFolderID} subfolder=${subfolderID} count=${bookmarkIDs.length}`,
    );

    const oldIsShared = sharedBookmarkStore.isSharedFolderID(oldFolderID);
    const newIsShared = sharedBookmarkStore.isSharedFolderID(newFolderID);

    let rows;
    let message;

    if (oldIsShared && newIsShared) {
      // Shared → Shared
      [rows, message] = sharedBookmarkStore.moveBookmarksInSharedFolder(
        oldFolderID, newFolderID, subfolderID, bookmarkIDs,
      );
    } else if (!oldIsShared && !newIsShared) {
      // Personal → Personal
      [rows, message] = bookmarkStore.moveBookmarks(
        charID, oldFolderID, newFolderID, subfolderID, bookmarkIDs,
      );
    } else if (!oldIsShared && newIsShared) {
      // Personal → Shared: delete from personal, add to shared
      const personalBookmarks = [];
      const data = bookmarkStore.getActiveBookmarks(charID);
      const allBms = data[1] || [];
      const targetSet = new Set(bookmarkIDs.map((id) => Number(id)));
      for (const bm of allBms) {
        if (Number(bm.folderID) === Number(oldFolderID) && targetSet.has(Number(bm.bookmarkID))) {
          personalBookmarks.push({ ...bm });
        }
      }
      bookmarkStore.deleteBookmarks(charID, oldFolderID, bookmarkIDs);
      rows = [];
      for (const bm of personalBookmarks) {
        const result = sharedBookmarkStore.addBookmarkToSharedFolder(newFolderID, {
          ...bm,
          folderID: newFolderID,
          subfolderID,
        });
        if (result) {
          rows.push({ bookmarkID: result[0], folderID: newFolderID, subfolderID });
        }
      }
      message = null;
    } else {
      // Shared → Personal: copy from shared, delete from shared
      const sharedBookmarks = sharedBookmarkStore.getBookmarksInFolder(oldFolderID);
      const targetSet = new Set(bookmarkIDs.map((id) => Number(id)));
      rows = [];
      for (const bm of sharedBookmarks) {
        if (targetSet.has(Number(bm.bookmarkID))) {
          const result = bookmarkStore.addBookmark(charID, {
            ...bm,
            folderID: newFolderID,
            subfolderID,
          });
          if (result) {
            rows.push({ bookmarkID: result[0], folderID: newFolderID, subfolderID });
          }
        }
      }
      sharedBookmarkStore.deleteBookmarksFromSharedFolder(oldFolderID, bookmarkIDs);
      message = null;
    }

    // Broadcast notifications for shared folders involved
    if (oldIsShared) {
      const update = bookmarkNotifications.buildBookmarksRemovedUpdate(oldFolderID, bookmarkIDs);
      bookmarkNotifications.broadcastFolderUpdate(oldFolderID, [update], charID);
    }
    if (newIsShared && rows.length > 0) {
      const newBookmarks = sharedBookmarkStore.getBookmarksInFolder(newFolderID);
      const movedIDs = new Set(rows.map((r) => Number(r.bookmarkID)));
      const movedBms = newBookmarks.filter((b) => movedIDs.has(Number(b.bookmarkID)));
      if (movedBms.length > 0) {
        const update = bookmarkNotifications.buildBookmarksAddedUpdate(newFolderID, movedBms);
        bookmarkNotifications.broadcastFolderUpdate(newFolderID, [update], charID);
      }
    }

    return [
      { type: "list", items: rows.map((r) => buildKeyVal([
        ["bookmarkID", r.bookmarkID],
        ["folderID", r.folderID],
        ["subfolderID", r.subfolderID],
      ])) },
      message,
    ];
  }

  Handle_CopyBookmarksToFolderAndSubfolder(args, session) {
    const charID = session && session.characterID;
    const oldFolderID = normalizeNumber(args && args[0], 0);
    const newFolderID = normalizeNumber(args && args[1], 0);
    const subfolderID = args && args[2] != null ? normalizeNumber(args[2], null) : null;
    const bookmarkIDs = normalizeIDSetArg(args && args[3]);

    log.info(
      `[AccessGroupBookmarkMgr] CopyBookmarks char=${charID} from=${oldFolderID} to=${newFolderID} subfolder=${subfolderID} count=${bookmarkIDs.length}`,
    );

    const oldIsShared = sharedBookmarkStore.isSharedFolderID(oldFolderID);
    const newIsShared = sharedBookmarkStore.isSharedFolderID(newFolderID);

    let newBookmarks;
    let message;

    if (oldIsShared && newIsShared) {
      [newBookmarks, message] = sharedBookmarkStore.copyBookmarksInSharedFolder(
        oldFolderID, newFolderID, subfolderID, bookmarkIDs,
      );
    } else if (!oldIsShared && !newIsShared) {
      [newBookmarks, message] = bookmarkStore.copyBookmarks(
        charID, oldFolderID, newFolderID, subfolderID, bookmarkIDs,
      );
    } else if (!oldIsShared && newIsShared) {
      // Personal → Shared: read from personal, create in shared
      const data = bookmarkStore.getActiveBookmarks(charID);
      const allBms = data[1] || [];
      const targetSet = new Set(bookmarkIDs.map((id) => Number(id)));
      newBookmarks = {};
      for (const bm of allBms) {
        if (Number(bm.folderID) === Number(oldFolderID) && targetSet.has(Number(bm.bookmarkID))) {
          const result = sharedBookmarkStore.addBookmarkToSharedFolder(newFolderID, {
            ...bm,
            folderID: newFolderID,
            subfolderID,
          });
          if (result) {
            const sharedBms = sharedBookmarkStore.getBookmarksInFolder(newFolderID);
            const newBm = sharedBms.find((b) => Number(b.bookmarkID) === result[0]);
            if (newBm) newBookmarks[result[0]] = newBm;
          }
        }
      }
      message = null;
    } else {
      // Shared → Personal: read from shared, create in personal
      const sharedBookmarks = sharedBookmarkStore.getBookmarksInFolder(oldFolderID);
      const targetSet = new Set(bookmarkIDs.map((id) => Number(id)));
      newBookmarks = {};
      for (const bm of sharedBookmarks) {
        if (targetSet.has(Number(bm.bookmarkID))) {
          const result = bookmarkStore.addBookmark(charID, {
            ...bm,
            folderID: newFolderID,
            subfolderID,
          });
          if (result) {
            newBookmarks[result[0]] = {
              ...bm,
              bookmarkID: result[0],
              folderID: newFolderID,
              subfolderID,
            };
          }
        }
      }
      message = null;
    }

    // Broadcast to shared folder subscribers
    if (newIsShared) {
      const copiedBms = Object.values(newBookmarks);
      if (copiedBms.length > 0) {
        const update = bookmarkNotifications.buildBookmarksAddedUpdate(newFolderID, copiedBms);
        bookmarkNotifications.broadcastFolderUpdate(newFolderID, [update], charID);
      }
    }

    // Client expects a dict {bookmarkID: bookmarkKeyVal}
    const dictEntries = {};
    for (const [id, bm] of Object.entries(newBookmarks)) {
      dictEntries[id] = buildBookmarkKeyVal(bm);
    }

    return [dictEntries, message];
  }

  // -----------------------------------------------------------------------
  // Subfolder CRUD
  // -----------------------------------------------------------------------

  Handle_CreateSubfolder(args, session) {
    const charID = session && session.characterID;
    const folderID = normalizeNumber(args && args[0], 0);
    const subfolderName = normalizeText(args && args[1], "");

    log.info(
      `[AccessGroupBookmarkMgr] CreateSubfolder char=${charID} folder=${folderID} name="${subfolderName}"`,
    );

    if (sharedBookmarkStore.isSharedFolderID(folderID)) {
      const subfolder = sharedBookmarkStore.createSubfolderInSharedFolder(folderID, subfolderName, charID);
      if (subfolder) {
        const update = bookmarkNotifications.buildSubfolderAddedUpdate(folderID, subfolder);
        bookmarkNotifications.broadcastFolderUpdate(folderID, [update], charID);
      }
      return subfolder ? buildSubfolderKeyVal(subfolder) : null;
    }

    const subfolder = bookmarkStore.createSubfolder(charID, folderID, subfolderName);
    return subfolder ? buildSubfolderKeyVal(subfolder) : null;
  }

  Handle_UpdateSubfolder(args, session) {
    const charID = session && session.characterID;
    const folderID = normalizeNumber(args && args[0], 0);
    const subfolderID = normalizeNumber(args && args[1], 0);
    const subfolderName = normalizeText(args && args[2], "");

    log.info(
      `[AccessGroupBookmarkMgr] UpdateSubfolder char=${charID} folder=${folderID} subfolder=${subfolderID} name="${subfolderName}"`,
    );

    if (sharedBookmarkStore.isSharedFolderID(folderID)) {
      const result = sharedBookmarkStore.updateSubfolderInSharedFolder(folderID, subfolderID, subfolderName);
      if (result) {
        const update = bookmarkNotifications.buildSubfolderUpdatedUpdate(folderID, subfolderID, subfolderName);
        bookmarkNotifications.broadcastFolderUpdate(folderID, [update], charID);
      }
      return result;
    }

    return bookmarkStore.updateSubfolder(charID, folderID, subfolderID, subfolderName);
  }

  Handle_DeleteSubfolder(args, session) {
    const charID = session && session.characterID;
    const folderID = normalizeNumber(args && args[0], 0);
    const subfolderID = normalizeNumber(args && args[1], 0);

    log.info(
      `[AccessGroupBookmarkMgr] DeleteSubfolder char=${charID} folder=${folderID} subfolder=${subfolderID}`,
    );

    if (sharedBookmarkStore.isSharedFolderID(folderID)) {
      const deletedBmIDs = sharedBookmarkStore.deleteSubfolderFromSharedFolder(folderID, subfolderID);

      const updates = [];
      updates.push(bookmarkNotifications.buildSubfolderRemovedUpdate(folderID, subfolderID));
      if (deletedBmIDs.length > 0) {
        updates.push(bookmarkNotifications.buildBookmarksRemovedUpdate(folderID, deletedBmIDs));
      }
      bookmarkNotifications.broadcastFolderUpdate(folderID, updates, charID);

      return { type: "list", items: deletedBmIDs };
    }

    const deleted = bookmarkStore.deleteSubfolder(charID, folderID, subfolderID);
    return { type: "list", items: deleted };
  }
}

module.exports = AccessGroupBookmarkMgrService;
