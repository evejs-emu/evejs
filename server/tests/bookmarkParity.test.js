const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const runtime = require(path.join(
  repoRoot,
  "server/src/services/bookmark/bookmarkRuntimeState",
));
const AccessGroupBookmarkMgrService = require(path.join(
  repoRoot,
  "server/src/services/character/accessGroupBookmarkMgrService",
));
const OwnerGroupManagerService = require(path.join(
  repoRoot,
  "server/src/services/character/ownerGroupManagerService",
));
const BeyonceService = require(path.join(
  repoRoot,
  "server/src/services/ship/beyonceService",
));
const {
  marshalEncode,
  marshalDecode,
} = require(path.join(repoRoot, "server/src/network/tcp/utils/marshal"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const signatureRuntime = require(path.join(
  repoRoot,
  "server/src/services/exploration/signatures/signatureRuntime",
));
const dungeonUniverseSiteService = require(path.join(
  repoRoot,
  "server/src/services/dungeon/dungeonUniverseSiteService",
));
const {
  buildList,
  buildObjectEx1,
} = require(path.join(repoRoot, "server/src/services/_shared/serviceHelpers"));
const {
  buildBookmarkPayload,
  buildFolderPayload,
  buildSubfolderPayload,
} = require(path.join(repoRoot, "server/src/services/bookmark/bookmarkPayloads"));
const bookmarkNotifications = require(path.join(
  repoRoot,
  "server/src/services/character/bookmarkNotifications",
));

const SNAPSHOT_TABLES = [
  "accessGroups",
  "characters",
  "bookmarkRuntimeState",
  "bookmarks",
  "bookmarkFolders",
  "bookmarkSubfolders",
  "bookmarkKnownFolders",
  "bookmarkGroups",
];

function normalizeDecodedString(value) {
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  if (value && typeof value === "object" && value.type === "wstring") {
    return value.value;
  }
  return value;
}

function readTable(tableName) {
  const result = database.read(tableName, "/");
  return result && result.success ? JSON.parse(JSON.stringify(result.data)) : {};
}

function writeTable(tableName, payload) {
  const result = database.write(tableName, "/", payload);
  assert.equal(result.success, true, `Failed to restore ${tableName}`);
}

function withSnapshots(fn) {
  return async () => {
    const snapshots = Object.fromEntries(
      SNAPSHOT_TABLES.map((tableName) => [tableName, readTable(tableName)]),
    );
    try {
      runtime.__resetForTests();
      await fn();
    } finally {
      for (const [tableName, payload] of Object.entries(snapshots)) {
        writeTable(tableName, payload);
      }
      runtime.__resetForTests();
    }
  };
}

function buildSession(characterID) {
  return {
    characterID,
    charid: characterID,
    shipid: 9001,
    shipID: 9001,
    solarsystemid: 30000142,
    solarsystemid2: 30000142,
    constellationID: 20000020,
    constellationid: 20000020,
    regionID: 10000002,
    regionid: 10000002,
    socket: { destroyed: false },
    sendServiceNotification() {},
  };
}

function keyValField(payload, key) {
  assert.equal(normalizeDecodedString(payload && payload.name), "util.KeyVal");
  assert.equal(payload.args && payload.args.type, "dict");
  const entry = payload.args.entries.find(([entryKey]) => normalizeDecodedString(entryKey) === key);
  assert.ok(entry, `Expected KeyVal field ${key}`);
  return entry[1];
}

function assertWString(value, expected) {
  assert.deepEqual(value, { type: "wstring", value: expected });
}

test("bookmark payload builders preserve Russian and Chinese names as marshal unicode strings", () => {
  const bookmarkName = "\u041c\u043e\u0441\u043a\u0432\u0430 \u6d4b\u8bd5";
  const bookmarkNote = "\u041f\u0440\u0438\u043c\u0435\u0447\u0430\u043d\u0438\u0435 \u5907\u6ce8";
  const folderName = "\u041f\u0430\u043f\u043a\u0430 \u6587\u4ef6\u5939";
  const folderDescription = "\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435 \u63cf\u8ff0";
  const subfolderName = "\u041f\u043e\u0434\u043f\u0430\u043f\u043a\u0430 \u5b50\u6587\u4ef6\u5939";

  const bookmark = buildBookmarkPayload({
    bookmarkID: 1,
    folderID: 2,
    locationID: 30000142,
    memo: bookmarkName,
    note: bookmarkNote,
  });
  const folder = buildFolderPayload({
    folderID: 2,
    folderName,
    description: folderDescription,
  });
  const subfolder = buildSubfolderPayload({
    folderID: 2,
    subfolderID: 3,
    subfolderName,
  });

  assertWString(keyValField(bookmark, "memo"), bookmarkName);
  assertWString(keyValField(bookmark, "note"), bookmarkNote);
  assertWString(keyValField(folder, "folderName"), folderName);
  assertWString(keyValField(folder, "description"), folderDescription);
  assertWString(keyValField(subfolder, "subfolderName"), subfolderName);

  const decodedBookmark = marshalDecode(marshalEncode(bookmark));
  assertWString(keyValField(decodedBookmark, "memo"), bookmarkName);
  assertWString(keyValField(decodedBookmark, "note"), bookmarkNote);
});

test("accessGroupBookmarkMgr returns non-ASCII bookmark labels as unicode strings", withSnapshots(() => {
  const service = new AccessGroupBookmarkMgrService();
  const session = buildSession(140000001);
  const folderName = "\u041f\u0430\u043f\u043a\u0430 \u6587\u4ef6\u5939";
  const folderDescription = "\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435 \u63cf\u8ff0";
  const subfolderName = "\u041f\u043e\u0434\u043f\u0430\u043f\u043a\u0430 \u5b50\u6587\u4ef6\u5939";
  const bookmarkName = "\u041c\u043e\u0441\u043a\u0432\u0430 \u6d4b\u8bd5";
  const bookmarkNote = "\u041f\u0440\u0438\u043c\u0435\u0447\u0430\u043d\u0438\u0435 \u5907\u6ce8";

  const folderPayload = service.Handle_AddFolder(
    [true, folderName, folderDescription],
    session,
  );
  const folderID = Number(keyValField(folderPayload, "folderID"));
  assert.equal(folderID > 0, true);
  assertWString(keyValField(folderPayload, "folderName"), folderName);
  assertWString(keyValField(folderPayload, "description"), folderDescription);

  const subfolderPayload = service.Handle_CreateSubfolder([folderID, subfolderName], session);
  const subfolderID = Number(keyValField(subfolderPayload, "subfolderID"));
  assert.equal(subfolderID > 0, true);
  assertWString(keyValField(subfolderPayload, "subfolderName"), subfolderName);

  const created = service.Handle_BookmarkStaticLocation(
    [60003760, folderID, bookmarkName, bookmarkNote, 0, subfolderID],
    session,
    null,
  );
  const bookmarkID = Number(created && created[0]);
  assert.equal(bookmarkID > 0, true);

  const active = service.Handle_GetMyActiveBookmarks([], session);
  const activeFolder = active[0].items.find((entry) => Number(keyValField(entry, "folderID")) === folderID);
  const activeBookmark = active[1].items.find((entry) => Number(keyValField(entry, "bookmarkID")) === bookmarkID);
  const activeSubfolder = active[2].items.find((entry) => Number(keyValField(entry, "subfolderID")) === subfolderID);

  assertWString(keyValField(activeFolder, "folderName"), folderName);
  assertWString(keyValField(activeFolder, "description"), folderDescription);
  assertWString(keyValField(activeBookmark, "memo"), bookmarkName);
  assertWString(keyValField(activeBookmark, "note"), bookmarkNote);
  assertWString(keyValField(activeSubfolder, "subfolderName"), subfolderName);
}));

test("shared bookmark notification and ACL group labels use unicode string payloads", withSnapshots(() => {
  const folderName = "\u041e\u0431\u0449\u0438\u0435 \u4e66\u7b7e";
  const folderDescription = "\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435 \u63cf\u8ff0";
  const subfolderName = "\u0420\u0443\u0431\u0440\u0438\u043a\u0430 \u5206\u7c7b";
  const bookmarkName = "\u041c\u0435\u0442\u043a\u0430 \u6d4b\u8bd5";
  const bookmarkNote = "\u0417\u0430\u043c\u0435\u0442\u043a\u0430 \u5907\u6ce8";

  const folderUpdate = bookmarkNotifications.buildFolderUpdatedUpdate(
    99001,
    folderName,
    folderDescription,
  );
  assertWString(folderUpdate[2][0], folderName);
  assertWString(folderUpdate[2][1], folderDescription);

  const subfolderUpdate = bookmarkNotifications.buildSubfolderUpdatedUpdate(
    99001,
    99002,
    subfolderName,
  );
  assertWString(subfolderUpdate[2][1], subfolderName);

  const bookmarkUpdate = bookmarkNotifications.buildBookmarksAddedUpdate(99001, [{
    bookmarkID: 99003,
    folderID: 99001,
    subfolderID: 99002,
    itemID: 60003760,
    typeID: 1529,
    locationID: 30000142,
    x: null,
    y: null,
    z: null,
    memo: bookmarkName,
    note: bookmarkNote,
    creatorID: 140000001,
    created: "134100000000000000",
    expiry: null,
  }]);
  assertWString(keyValField(bookmarkUpdate[2].items[0], "memo"), bookmarkName);
  assertWString(keyValField(bookmarkUpdate[2].items[0], "note"), bookmarkNote);

  const ownerGroupManager = new OwnerGroupManagerService();
  const createdGroup = ownerGroupManager.Handle_Create(
    [folderName, folderDescription],
    buildSession(140000001),
  );
  assertWString(keyValField(createdGroup, "name"), folderName);
  assertWString(keyValField(createdGroup, "description"), folderDescription);
}));

test("bookmark runtime migrates legacy personal bookmarks to centralized data with null item coordinates", withSnapshots(() => {
  const result = runtime.getMyActiveBookmarks(140000001);
  assert.equal(result.folders.length >= 1, true);
  assert.equal(result.bookmarks.length >= 1, true);
  const bookmark = result.bookmarks[0];
  assert.equal(bookmark.folderID > 0, true);
  assert.equal(bookmark.x, null);
  assert.equal(bookmark.y, null);
  assert.equal(bookmark.z, null);

  const bookmarkFolders = readTable("bookmarkFolders");
  assert.equal(Object.keys(bookmarkFolders.records || {}).length >= 1, true);
}));

test("accessGroupBookmarkMgr returns folder, bookmark, and subfolder payload lists", withSnapshots(() => {
  const service = new AccessGroupBookmarkMgrService();
  const session = buildSession(140000001);
  const folderView = runtime.listFolderViews(140000001)[0];
  runtime.createSubfolder(140000001, folderView.folder.folderID, "Smoke Subfolder");

  const result = service.Handle_GetMyActiveBookmarks([], session);
  assert.equal(Array.isArray(result), true);
  assert.equal(result.length, 3);
  assert.equal(result[0].type, "list");
  assert.equal(result[1].type, "list");
  assert.equal(result[2].type, "list");
  assert.equal(result[0].items.length >= 1, true);
  assert.equal(result[1].items.length >= 1, true);
  assert.equal(result[2].items.length >= 1, true);
}));

test("static bookmark creation returns CCP-style tuple and persists to folder", withSnapshots(() => {
  const service = new AccessGroupBookmarkMgrService();
  const session = buildSession(140000001);
  const folderView = runtime.listFolderViews(140000001)[0];

  const result = service.Handle_BookmarkStaticLocation(
    [60003760, folderView.folder.folderID, "Jita Static", "note", 0],
    session,
    null,
  );

  assert.equal(Array.isArray(result), true);
  assert.equal(result.length, 8);
  assert.equal(Number(result[0]) > 0, true);
  assert.equal(Number(result[1]), 60003760);
  assert.equal(result[3], null);
  assert.equal(result[4], null);
  assert.equal(result[5], null);

  const active = runtime.getMyActiveBookmarks(140000001);
  assert.equal(
    active.bookmarks.some((bookmark) => bookmark.bookmarkID === Number(result[0])),
    true,
  );
}));

test("ownerGroupManager exposes bookmark access groups for the character corporation", withSnapshots(() => {
  const service = new OwnerGroupManagerService();
  const session = buildSession(140000001);
  const groups = service.Handle_GetMyGroups([], session);
  assert.equal(Array.isArray(groups), true);
  assert.equal(groups.length >= 1, true);
  assert.equal(groups[0].name, "util.KeyVal");
}));

test("CmdWarpToStuff routes bookmark warps to coordinate targets through warpToPoint", withSnapshots(() => {
  const beyonce = new BeyonceService();
  const session = buildSession(140000001);
  const folderView = runtime.listFolderViews(140000001)[0];
  const created = runtime.createBookmark(140000001, {
    folderID: folderView.folder.folderID,
    memo: "Point",
    note: "",
    expiryMode: 0,
    itemID: null,
    typeID: 5,
    locationID: 30000142,
    x: 123,
    y: 456,
    z: 789,
    subfolderID: null,
  });

  const originalWarpToPoint = spaceRuntime.warpToPoint;
  const originalWarpToEntity = spaceRuntime.warpToEntity;
  let calledPoint = null;
  let calledEntity = null;
  spaceRuntime.warpToPoint = (targetSession, point, options) => {
    calledPoint = { targetSession, point, options };
    return { success: true, data: {} };
  };
  spaceRuntime.warpToEntity = (targetSession, entityID, options) => {
    calledEntity = { targetSession, entityID, options };
    return { success: true, data: {} };
  };

  try {
    beyonce.Handle_CmdWarpToStuff(["bookmark", created.bookmark.bookmarkID], session, { minRange: 1000 });
  } finally {
    spaceRuntime.warpToPoint = originalWarpToPoint;
    spaceRuntime.warpToEntity = originalWarpToEntity;
  }

  assert.ok(calledPoint, "Expected bookmark coordinate warp to hit warpToPoint");
  assert.equal(calledEntity, null);
  assert.deepEqual(calledPoint.point, { x: 123, y: 456, z: 789 });
  assert.equal(calledPoint.options.minimumRange, 1000);
}));

test("CmdWarpToStuff resolves string scan targets and warps to site coordinates", withSnapshots(() => {
  const beyonce = new BeyonceService();
  const session = buildSession(140000001);

  const originalResolveSiteByTargetID = signatureRuntime.resolveSiteByTargetID;
  const originalGetSceneForSession = spaceRuntime.getSceneForSession;
  const originalWarpToPoint = spaceRuntime.warpToPoint;
  const originalWarpToEntity = spaceRuntime.warpToEntity;
  let calledPoint = null;
  let calledEntity = null;

  signatureRuntime.resolveSiteByTargetID = (systemID, targetID, options = {}) => {
    assert.equal(Number(systemID), 30000142);
    assert.equal(String(targetID), "ABC-123");
    assert.equal(Boolean(options.loadScene), true);
    return {
      siteID: 555001,
      targetID: "ABC-123",
      actualPosition: {
        x: 1111.5,
        y: -2222.25,
        z: 3333.75,
      },
      position: [1111.5, -2222.25, 3333.75],
    };
  };
  spaceRuntime.getSceneForSession = () => ({
    getEntityByID() {
      return null;
    },
  });
  spaceRuntime.warpToPoint = (targetSession, point, options) => {
    calledPoint = { targetSession, point, options };
    return { success: true, data: {} };
  };
  spaceRuntime.warpToEntity = (targetSession, entityID, options) => {
    calledEntity = { targetSession, entityID, options };
    return { success: true, data: {} };
  };

  try {
    beyonce.Handle_CmdWarpToStuff(["scan", "ABC-123"], session, { minRange: 5000 });
  } finally {
    signatureRuntime.resolveSiteByTargetID = originalResolveSiteByTargetID;
    spaceRuntime.getSceneForSession = originalGetSceneForSession;
    spaceRuntime.warpToPoint = originalWarpToPoint;
    spaceRuntime.warpToEntity = originalWarpToEntity;
  }

  assert.ok(calledPoint, "Expected scan-result warp to hit warpToPoint");
  assert.equal(calledEntity, null);
  assert.deepEqual(calledPoint.point, {
    x: 1111.5,
    y: -2222.25,
    z: 3333.75,
  });
  assert.equal(calledPoint.options.minimumRange, 5000);
  assert.equal(calledPoint.options.stopDistance, 5000);
}));

test("CmdWarpToStuff resolves string scan targets to live site entities when available", withSnapshots(() => {
  const beyonce = new BeyonceService();
  const session = buildSession(140000001);

  const originalResolveSiteByTargetID = signatureRuntime.resolveSiteByTargetID;
  const originalGetSceneForSession = spaceRuntime.getSceneForSession;
  const originalWarpToPoint = spaceRuntime.warpToPoint;
  const originalWarpToEntity = spaceRuntime.warpToEntity;
  let calledPoint = null;
  let calledEntity = null;

  signatureRuntime.resolveSiteByTargetID = () => ({
    siteID: 777001,
    targetID: "DEF-456",
    actualPosition: {
      x: 10,
      y: 20,
      z: 30,
    },
  });
  spaceRuntime.getSceneForSession = () => ({
    getEntityByID(entityID) {
      if (Number(entityID) === 777001) {
        return { itemID: 777001 };
      }
      return null;
    },
  });
  spaceRuntime.warpToPoint = (targetSession, point, options) => {
    calledPoint = { targetSession, point, options };
    return { success: true, data: {} };
  };
  spaceRuntime.warpToEntity = (targetSession, entityID, options) => {
    calledEntity = { targetSession, entityID, options };
    return { success: true, data: {} };
  };

  try {
    beyonce.Handle_CmdWarpToStuff(["scan", "DEF-456"], session, { minRange: 2500 });
  } finally {
    signatureRuntime.resolveSiteByTargetID = originalResolveSiteByTargetID;
    spaceRuntime.getSceneForSession = originalGetSceneForSession;
    spaceRuntime.warpToPoint = originalWarpToPoint;
    spaceRuntime.warpToEntity = originalWarpToEntity;
  }

  assert.ok(calledEntity, "Expected scan-result warp to hit warpToEntity");
  assert.equal(calledPoint, null);
  assert.equal(calledEntity.entityID, 777001);
  assert.equal(calledEntity.options.minimumRange, 2500);
}));

test("CmdWarpToStuff scan warps materialize deferred universe site contents before warp", withSnapshots(() => {
  const beyonce = new BeyonceService();
  const session = buildSession(140000001);

  const originalResolveSiteByTargetID = signatureRuntime.resolveSiteByTargetID;
  const originalGetSceneForSession = spaceRuntime.getSceneForSession;
  const originalWarpToEntity = spaceRuntime.warpToEntity;
  const originalEnsureSiteContentsMaterialized = dungeonUniverseSiteService.ensureSiteContentsMaterialized;
  let calledEnsure = null;

  signatureRuntime.resolveSiteByTargetID = () => ({
    siteID: 777001,
    instanceID: 88001,
    targetID: "UVW-999",
    actualPosition: { x: 1, y: 2, z: 3 },
  });
  spaceRuntime.getSceneForSession = () => ({
    systemID: 30000142,
    getEntityByID(entityID) {
      if (Number(entityID) === 777001) {
        return {
          itemID: 777001,
          signalTrackerUniverseSeededSite: true,
        };
      }
      return null;
    },
  });
  dungeonUniverseSiteService.ensureSiteContentsMaterialized = (scene, site, options = {}) => {
    calledEnsure = {
      scene,
      site,
      options,
    };
    return {
      success: true,
      data: {
        alreadyMaterialized: false,
      },
    };
  };
  spaceRuntime.warpToEntity = () => ({ success: true, data: {} });

  try {
    beyonce.Handle_CmdWarpToStuff(["scan", "UVW-999"], session, { minRange: 1000 });
  } finally {
    signatureRuntime.resolveSiteByTargetID = originalResolveSiteByTargetID;
    spaceRuntime.getSceneForSession = originalGetSceneForSession;
    spaceRuntime.warpToEntity = originalWarpToEntity;
    dungeonUniverseSiteService.ensureSiteContentsMaterialized = originalEnsureSiteContentsMaterialized;
  }

  assert.ok(calledEnsure, "Expected scan-result warp to materialize deferred site contents");
  assert.equal(Number(calledEnsure.site.instanceID), 88001);
  assert.equal(calledEnsure.options.spawnEncounters, true);
  assert.equal(calledEnsure.options.broadcast, true);
  assert.equal(calledEnsure.options.session, session);
}));

test("CmdWarpToStuff item warps materialize deferred universe site contents for seeded anomaly roots", withSnapshots(() => {
  const beyonce = new BeyonceService();
  const session = buildSession(140000001);

  const originalGetSceneForSession = spaceRuntime.getSceneForSession;
  const originalWarpToEntity = spaceRuntime.warpToEntity;
  const originalEnsureSiteContentsMaterialized = dungeonUniverseSiteService.ensureSiteContentsMaterialized;
  let calledEnsure = null;

  spaceRuntime.getSceneForSession = () => ({
    systemID: 30000142,
    getEntityByID(entityID) {
      if (Number(entityID) === 888123) {
        return {
          itemID: 888123,
          signalTrackerUniverseSeededSite: true,
        };
      }
      return null;
    },
  });
  dungeonUniverseSiteService.ensureSiteContentsMaterialized = (scene, site, options = {}) => {
    calledEnsure = {
      scene,
      site,
      options,
    };
    return { success: true, data: {} };
  };
  spaceRuntime.warpToEntity = () => ({ success: true, data: {} });

  try {
    beyonce.Handle_CmdWarpToStuff(["item", 888123], session, { minRange: 0 });
  } finally {
    spaceRuntime.getSceneForSession = originalGetSceneForSession;
    spaceRuntime.warpToEntity = originalWarpToEntity;
    dungeonUniverseSiteService.ensureSiteContentsMaterialized = originalEnsureSiteContentsMaterialized;
  }

  assert.ok(calledEnsure, "Expected item warp to materialize deferred site contents");
  assert.equal(Number(calledEnsure.site.siteID), 888123);
  assert.equal(calledEnsure.options.spawnEncounters, true);
  assert.equal(calledEnsure.options.broadcast, true);
  assert.equal(calledEnsure.options.session, session);
}));

test("BookmarkLocation stores current ship position as a coordinate bookmark with no item anchor", withSnapshots(() => {
  const beyonce = new BeyonceService();
  const session = buildSession(140000001);
  const folderView = runtime.listFolderViews(140000001)[0];

  const originalGetSceneForSession = spaceRuntime.getSceneForSession;
  spaceRuntime.getSceneForSession = () => ({
    getShipEntityForSession() {
      return {
        itemID: 9001,
        position: { x: 111, y: 222, z: 333 },
      };
    },
    getEntityByID(itemID) {
      if (Number(itemID) === 9001) {
        return {
          itemID: 9001,
          typeID: 587,
          position: { x: 111, y: 222, z: 333 },
        };
      }
      return null;
    },
  });

  let result;
  try {
    result = beyonce.Handle_BookmarkLocation(
      [9001, folderView.folder.folderID, "Current Spot", "", 0],
      session,
      null,
    );
  } finally {
    spaceRuntime.getSceneForSession = originalGetSceneForSession;
  }

  assert.equal(result[1], null);
  assert.equal(Number(result[2]), 5);
  assert.equal(Number(result[3]), 111);
  assert.equal(Number(result[4]), 222);
  assert.equal(Number(result[5]), 333);

  const created = runtime.getBookmark(Number(result[0]));
  assert.equal(created.itemID, null);
  assert.equal(created.typeID, 5);
  assert.equal(created.locationID, 30000142);
}));

test("BookmarkLocation stores non-static live targets as coordinate bookmarks instead of item bookmarks", withSnapshots(() => {
  const service = new AccessGroupBookmarkMgrService();
  const session = buildSession(140000001);
  const folderView = runtime.listFolderViews(140000001)[0];

  const originalGetSceneForSession = spaceRuntime.getSceneForSession;
  spaceRuntime.getSceneForSession = () => ({
    getShipEntityForSession() {
      return {
        itemID: 9001,
        position: { x: 1, y: 2, z: 3 },
      };
    },
    getEntityByID(itemID) {
      if (Number(itemID) === 9900) {
        return {
          itemID: 9900,
          typeID: 603,
          position: { x: 444, y: 555, z: 666 },
        };
      }
      return null;
    },
  });

  let result;
  try {
    result = service.Handle_BookmarkLocation(
      [9900, folderView.folder.folderID, "Dynamic Spot", "", 0],
      session,
      null,
    );
  } finally {
    spaceRuntime.getSceneForSession = originalGetSceneForSession;
  }

  assert.equal(result[1], null);
  assert.equal(Number(result[2]), 5);
  assert.equal(Number(result[3]), 444);
  assert.equal(Number(result[4]), 555);
  assert.equal(Number(result[5]), 666);

  const created = runtime.getBookmark(Number(result[0]));
  assert.equal(created.itemID, null);
  assert.equal(created.typeID, 5);
  assert.equal(created.locationID, 30000142);
}));

test("DeleteBookmarks accepts Python set bookmark IDs and deletes the bookmark", withSnapshots(() => {
  const service = new AccessGroupBookmarkMgrService();
  const session = buildSession(140000001);
  const folderView = runtime.listFolderViews(140000001)[0];
  const created = runtime.createBookmark(140000001, {
    folderID: folderView.folder.folderID,
    memo: "Delete Me",
    note: "",
    expiryMode: 0,
    itemID: 60003760,
    typeID: 1529,
    locationID: 30000142,
    x: null,
    y: null,
    z: null,
    subfolderID: null,
  });

  const deleted = service.Handle_DeleteBookmarks(
    [
      folderView.folder.folderID,
      buildObjectEx1("__builtin__.set", [buildList([created.bookmark.bookmarkID])]),
    ],
    session,
  );

  assert.equal(deleted.type, "list");
  assert.deepEqual(deleted.items, [created.bookmark.bookmarkID]);
  assert.equal(runtime.getBookmark(created.bookmark.bookmarkID), null);
}));
