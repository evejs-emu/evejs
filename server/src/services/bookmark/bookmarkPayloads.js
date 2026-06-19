const path = require("path");

const {
  buildKeyVal,
  buildList,
  buildDict,
  buildFiletimeLong,
  normalizeText,
  normalizeNumber,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  ACCESS_NONE,
  TYPE_SOLAR_SYSTEM,
} = require(path.join(__dirname, "./bookmarkConstants"));

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toOptionalInt(value) {
  const numeric = toInt(value, 0);
  return numeric > 0 ? numeric : null;
}

function toOptionalNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeBookmarkText(value, maxLength, fallback = "") {
  const text = normalizeText(value, fallback);
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function buildBookmarkText(value, maxLength, fallback = "") {
  return {
    type: "wstring",
    value: normalizeBookmarkText(value, maxLength, fallback),
  };
}

function buildBookmarkPayload(record = {}) {
  return buildKeyVal([
    ["bookmarkID", toInt(record.bookmarkID, 0)],
    ["folderID", toInt(record.folderID, 0)],
    ["itemID", toOptionalInt(record.itemID)],
    ["typeID", toOptionalInt(record.typeID) || TYPE_SOLAR_SYSTEM],
    ["flag", null],
    ["memo", buildBookmarkText(record.memo, 100, "")],
    ["created", buildFiletimeLong(record.created)],
    ["expiry", record.expiry ? buildFiletimeLong(record.expiry) : null],
    ["x", toOptionalNumber(record.x)],
    ["y", toOptionalNumber(record.y)],
    ["z", toOptionalNumber(record.z)],
    ["locationID", toInt(record.locationID, 0)],
    ["note", buildBookmarkText(record.note, 3900, "")],
    ["subfolderID", toOptionalInt(record.subfolderID)],
    ["creatorID", toOptionalInt(record.creatorID)],
  ]);
}

function buildFolderPayload(record = {}, options = {}) {
  const accessLevel = toInt(
    options.accessLevel,
    Object.prototype.hasOwnProperty.call(record, "accessLevel")
      ? record.accessLevel
      : ACCESS_NONE,
  );
  const isActive = options.isActive === true;

  return buildKeyVal([
    ["folderID", toInt(record.folderID, 0)],
    ["folderName", buildBookmarkText(record.folderName, 40, "Folder")],
    ["description", buildBookmarkText(record.description, 3900, "")],
    ["creatorID", toOptionalInt(record.creatorID)],
    ["isPersonal", record.isPersonal === true],
    ["isActive", isActive],
    ["accessLevel", accessLevel],
    ["adminGroupID", toOptionalInt(record.adminGroupID)],
    ["manageGroupID", toOptionalInt(record.manageGroupID)],
    ["useGroupID", toOptionalInt(record.useGroupID)],
    ["viewGroupID", toOptionalInt(record.viewGroupID)],
  ]);
}

function buildSubfolderPayload(record = {}) {
  return buildKeyVal([
    ["subfolderID", toInt(record.subfolderID, 0)],
    ["folderID", toInt(record.folderID, 0)],
    ["subfolderName", buildBookmarkText(record.subfolderName, 40, "Subfolder")],
    ["creatorID", toOptionalInt(record.creatorID)],
  ]);
}

function buildGroupPayload(record = {}) {
  return buildKeyVal([
    ["groupID", toInt(record.groupID, 0)],
    ["creatorID", toOptionalInt(record.creatorID)],
    ["name", buildBookmarkText(record.name, 100, "Access Group")],
    ["description", buildBookmarkText(record.description, 3900, "")],
    ["membershipType", toInt(record.membershipType, 2)],
    ["admins", buildList((Array.isArray(record.admins) ? record.admins : []).map((entry) => toInt(entry, 0)).filter((entry) => entry > 0))],
  ]);
}

function buildFolderUpdateTuple(folderID, updateType, updateArgs) {
  return [[toInt(folderID, 0)], normalizeText(updateType, ""), updateArgs];
}

function buildBookmarkIDSet(bookmarkIDs = []) {
  return buildList(
    (Array.isArray(bookmarkIDs) ? bookmarkIDs : [bookmarkIDs])
      .map((bookmarkID) => toInt(bookmarkID, 0))
      .filter((bookmarkID) => bookmarkID > 0),
  );
}

function buildBookmarkDict(bookmarks = []) {
  return buildDict(
    (Array.isArray(bookmarks) ? bookmarks : [])
      .map((bookmark) => [toInt(bookmark && bookmark.bookmarkID, 0), buildBookmarkPayload(bookmark)])
      .filter(([bookmarkID]) => bookmarkID > 0),
  );
}

function isCoordinateBookmark(record = {}) {
  return Boolean(
    toOptionalNumber(record.x) !== null &&
    (
      toInt(record.itemID, 0) === toInt(record.locationID, 0) ||
      toInt(record.typeID, 0) === TYPE_SOLAR_SYSTEM
    ),
  );
}

module.exports = {
  buildBookmarkDict,
  buildBookmarkIDSet,
  buildBookmarkPayload,
  buildBookmarkText,
  buildFolderPayload,
  buildFolderUpdateTuple,
  buildGroupPayload,
  buildSubfolderPayload,
  isCoordinateBookmark,
  normalizeBookmarkText,
};
