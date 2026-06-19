const path = require("path");

const worldData = require(path.join(__dirname, "../../space/worldData"));
const {
  escapeRegExp,
  getXmppConferenceDomain,
} = require("./xmppConfig");

const LOCAL_CHAT_CATEGORY_LOCAL = "local";
const LOCAL_CHAT_CATEGORY_WORMHOLE = "wormhole";
const LOCAL_CHAT_CATEGORY_TRIGLAVIAN = "triglavian";
const LOCAL_CHAT_CATEGORY_NULLSEC = "nullsec";
const LOCAL_CHAT_CATEGORY_SUPPRESSED = "nolocal";

const DEFAULT_SOLAR_SYSTEM_ID = 30000142;
const WORMHOLE_SYSTEM_MIN = 31000000;
const WORMHOLE_SYSTEM_MAX = 31999999;
const SOLAR_SYSTEM_ZARZAKH = 30100000;
const FACTION_TRIGLAVIAN = 500026;

function getLocalChatRoomNamePattern() {
  return new RegExp(
    `^(local|wormhole|triglavian|nullsec|nolocal)_(\\d+)(?:@${escapeRegExp(getXmppConferenceDomain())})?$`,
    "i",
  );
}

function normalizePositiveInt(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0
    ? numericValue
    : fallback;
}

function getCurrentSolarSystemID(session) {
  const directSolarSystemID = normalizePositiveInt(
    session &&
      (
        session.solarsystemid2 ??
        session.solarsystemid ??
        session.solarSystemID ??
        session.solarSystemId
      ),
    0,
  );
  if (directSolarSystemID) {
    return directSolarSystemID;
  }

  const stationID = normalizePositiveInt(
    session &&
      (
        session.stationid ??
        session.stationID ??
        session.stationId
      ),
    0,
  );
  if (stationID) {
    const station = worldData.getStationByID(stationID);
    const stationSolarSystemID = normalizePositiveInt(
      station && station.solarSystemID,
      0,
    );
    if (stationSolarSystemID) {
      return stationSolarSystemID;
    }
  }

  const structureID = normalizePositiveInt(
    session &&
      (
        session.structureid ??
        session.structureID ??
        session.structureId
      ),
    0,
  );
  if (structureID) {
    const structure = worldData.getStructureByID(structureID);
    const structureSolarSystemID = normalizePositiveInt(
      structure && structure.solarSystemID,
      0,
    );
    if (structureSolarSystemID) {
      return structureSolarSystemID;
    }
  }

  return DEFAULT_SOLAR_SYSTEM_ID;
}

function isWormholeSolarSystemID(solarSystemID) {
  const normalizedSolarSystemID = normalizePositiveInt(solarSystemID, 0);
  return (
    normalizedSolarSystemID >= WORMHOLE_SYSTEM_MIN &&
    normalizedSolarSystemID <= WORMHOLE_SYSTEM_MAX
  );
}

function isZarzakhSolarSystemID(solarSystemID) {
  return normalizePositiveInt(solarSystemID, 0) === SOLAR_SYSTEM_ZARZAKH;
}

function isTriglavianSolarSystemID(solarSystemID) {
  const normalizedSolarSystemID = normalizePositiveInt(solarSystemID, 0);
  if (!normalizedSolarSystemID) {
    return false;
  }

  const solarSystem = worldData.getSolarSystemByID(normalizedSolarSystemID);
  return normalizePositiveInt(solarSystem && solarSystem.factionID, 0) === FACTION_TRIGLAVIAN;
}

function isDelayedLocalSolarSystemID(solarSystemID) {
  return (
    isWormholeSolarSystemID(solarSystemID) ||
    isZarzakhSolarSystemID(solarSystemID) ||
    isTriglavianSolarSystemID(solarSystemID)
  );
}

function getLocalChatCategoryForSolarSystemID(solarSystemID) {
  const normalizedSolarSystemID =
    normalizePositiveInt(solarSystemID, 0) || DEFAULT_SOLAR_SYSTEM_ID;
  if (isZarzakhSolarSystemID(normalizedSolarSystemID)) {
    return LOCAL_CHAT_CATEGORY_WORMHOLE;
  }
  if (isWormholeSolarSystemID(normalizedSolarSystemID)) {
    return LOCAL_CHAT_CATEGORY_WORMHOLE;
  }
  if (isTriglavianSolarSystemID(normalizedSolarSystemID)) {
    return LOCAL_CHAT_CATEGORY_TRIGLAVIAN;
  }
  return LOCAL_CHAT_CATEGORY_LOCAL;
}

function getLocalChatRoomNameForSolarSystemID(solarSystemID) {
  const normalizedSolarSystemID =
    normalizePositiveInt(solarSystemID, 0) || DEFAULT_SOLAR_SYSTEM_ID;
  const category = getLocalChatCategoryForSolarSystemID(normalizedSolarSystemID);
  return `${category}_${normalizedSolarSystemID}`;
}

function getLocalChatRoomNameForSession(session) {
  return getLocalChatRoomNameForSolarSystemID(getCurrentSolarSystemID(session));
}

function parseLocalChatRoomName(value) {
  const candidate = String(value || "")
    .trim()
    .split("/")[0]
    .toLowerCase();
  const match = getLocalChatRoomNamePattern().exec(candidate);
  if (!match) {
    return null;
  }

  const category = String(match[1] || "").toLowerCase();
  const solarSystemID = normalizePositiveInt(match[2], 0);
  if (!solarSystemID) {
    return null;
  }

  return {
    category,
    solarSystemID,
    roomName: `${category}_${solarSystemID}`,
  };
}

function isLocalChatRoomName(value) {
  return Boolean(parseLocalChatRoomName(value));
}

function isDelayedLocalChatRoomName(value) {
  const parsed = parseLocalChatRoomName(value);
  if (!parsed) {
    return false;
  }

  return (
    parsed.category === LOCAL_CHAT_CATEGORY_WORMHOLE ||
    parsed.category === LOCAL_CHAT_CATEGORY_NULLSEC ||
    parsed.category === LOCAL_CHAT_CATEGORY_TRIGLAVIAN
  );
}

module.exports = {
  DEFAULT_SOLAR_SYSTEM_ID,
  FACTION_TRIGLAVIAN,
  LOCAL_CHAT_CATEGORY_LOCAL,
  LOCAL_CHAT_CATEGORY_NULLSEC,
  LOCAL_CHAT_CATEGORY_SUPPRESSED,
  LOCAL_CHAT_CATEGORY_TRIGLAVIAN,
  LOCAL_CHAT_CATEGORY_WORMHOLE,
  SOLAR_SYSTEM_ZARZAKH,
  WORMHOLE_SYSTEM_MAX,
  WORMHOLE_SYSTEM_MIN,
  getCurrentSolarSystemID,
  getLocalChatCategoryForSolarSystemID,
  getLocalChatRoomNameForSession,
  getLocalChatRoomNameForSolarSystemID,
  isDelayedLocalChatRoomName,
  isDelayedLocalSolarSystemID,
  isLocalChatRoomName,
  isTriglavianSolarSystemID,
  isWormholeSolarSystemID,
  isZarzakhSolarSystemID,
  normalizePositiveInt,
  parseLocalChatRoomName,
};
