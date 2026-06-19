const path = require("path");

const {
  normalizeBigInt,
  normalizeNumber,
  normalizeText,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  CORP_ROLE_CHAT_MANAGER,
  OWNER_SYSTEM_ID,
  CALENDAR_TAG_PERSONAL,
  CALENDAR_TAG_CORP,
  CALENDAR_TAG_ALLIANCE,
  CALENDAR_TAG_CCP,
  CALENDAR_TAG_AUTOMATED,
  SCOPE_PERSONAL,
  SCOPE_CORPORATION,
  SCOPE_ALLIANCE,
  SCOPE_GLOBAL,
} = require(path.join(__dirname, "./calendarConstants"));

const FILETIME_EPOCH_OFFSET = 116444736000000000n;
const FILETIME_TICKS_PER_MILLISECOND = 10000n;

function toInt(value, fallback = 0) {
  const numericValue = Math.trunc(normalizeNumber(value, fallback));
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numericValue = toInt(value, fallback);
  return numericValue > 0 ? numericValue : fallback;
}

function toOptionalPositiveInt(value) {
  const numericValue = toPositiveInt(value, 0);
  return numericValue > 0 ? numericValue : null;
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function sanitizeTitle(value) {
  return normalizeText(value, "").trim();
}

function sanitizeDescription(value) {
  return normalizeText(value, "");
}

function toFileTimeBigInt(value, fallback = 0n) {
  const normalized = normalizeBigInt(value, fallback);
  return normalized > 0n ? normalized : fallback;
}

function currentFileTimeBigInt() {
  return BigInt(Date.now()) * FILETIME_TICKS_PER_MILLISECOND + FILETIME_EPOCH_OFFSET;
}

function currentFileTimeString() {
  return currentFileTimeBigInt().toString();
}

function filetimeToDate(value) {
  const filetime = toFileTimeBigInt(value, currentFileTimeBigInt());
  const unixMilliseconds = Number(
    (filetime - FILETIME_EPOCH_OFFSET) / FILETIME_TICKS_PER_MILLISECOND,
  );
  return new Date(unixMilliseconds);
}

function dateToFiletimeString(dateValue) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  const milliseconds = Number.isFinite(date.getTime()) ? date.getTime() : Date.now();
  return (
    BigInt(milliseconds) * FILETIME_TICKS_PER_MILLISECOND + FILETIME_EPOCH_OFFSET
  ).toString();
}

function getYearMonthFromFiletime(value) {
  const date = filetimeToDate(value);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
  };
}

function getSessionCharacterID(session) {
  return toPositiveInt(
    session &&
      (session.characterID || session.charID || session.charid || 0),
    0,
  );
}

function getSessionCorporationID(session) {
  return toPositiveInt(
    session &&
      (session.corporationID || session.corpID || session.corpid || 0),
    0,
  );
}

function getSessionAllianceID(session) {
  return toPositiveInt(
    session &&
      (session.allianceID || session.allianceid || 0),
    0,
  );
}

function getSessionCorpRole(session) {
  const rawValue =
    session &&
    (session.corpRole || session.corprole || session.rolesAtAll || 0);
  try {
    return normalizeBigInt(rawValue, 0n);
  } catch (_error) {
    return 0n;
  }
}

function sessionHasChatManagerRole(session) {
  return (
    (getSessionCorpRole(session) & CORP_ROLE_CHAT_MANAGER) ===
    CORP_ROLE_CHAT_MANAGER
  );
}

function resolveEventScopeFromOwner(ownerID, autoEventType = null, session = null) {
  const numericOwnerID = toPositiveInt(ownerID, 0);
  if (numericOwnerID === OWNER_SYSTEM_ID) {
    return SCOPE_GLOBAL;
  }
  if (session && numericOwnerID === getSessionCorporationID(session)) {
    return autoEventType == null ? SCOPE_CORPORATION : SCOPE_CORPORATION;
  }
  if (session && numericOwnerID === getSessionAllianceID(session)) {
    return SCOPE_ALLIANCE;
  }
  return SCOPE_PERSONAL;
}

function resolveCalendarTag(ownerID, session, autoEventType = null) {
  const numericOwnerID = toPositiveInt(ownerID, 0);
  if (numericOwnerID === getSessionCorporationID(session)) {
    return autoEventType == null
      ? CALENDAR_TAG_CORP
      : CALENDAR_TAG_AUTOMATED;
  }
  if (numericOwnerID === getSessionAllianceID(session)) {
    return CALENDAR_TAG_ALLIANCE;
  }
  if (numericOwnerID === OWNER_SYSTEM_ID) {
    return CALENDAR_TAG_CCP;
  }
  return CALENDAR_TAG_PERSONAL;
}

function isPersonalScope(event) {
  return String(event && event.scope || "") === SCOPE_PERSONAL;
}

function isCorporationScope(event) {
  return String(event && event.scope || "") === SCOPE_CORPORATION;
}

function isAllianceScope(event) {
  return String(event && event.scope || "") === SCOPE_ALLIANCE;
}

function isGlobalScope(event) {
  return String(event && event.scope || "") === SCOPE_GLOBAL;
}

function canCreateCorpOrAllianceEvent(session, scope) {
  if (!sessionHasChatManagerRole(session)) {
    return false;
  }
  if (scope === SCOPE_CORPORATION) {
    return getSessionCorporationID(session) > 0;
  }
  if (scope === SCOPE_ALLIANCE) {
    return getSessionAllianceID(session) > 0;
  }
  return false;
}

function canEditOrDeleteEvent(event, session) {
  const characterID = getSessionCharacterID(session);
  if (!event || characterID <= 0) {
    return false;
  }
  if (isPersonalScope(event)) {
    return toPositiveInt(event.ownerID, 0) === characterID;
  }
  if (isCorporationScope(event)) {
    return (
      toPositiveInt(event.ownerID, 0) === getSessionCorporationID(session) &&
      sessionHasChatManagerRole(session)
    );
  }
  if (isAllianceScope(event)) {
    return (
      toPositiveInt(event.ownerID, 0) === getSessionAllianceID(session) &&
      sessionHasChatManagerRole(session)
    );
  }
  return false;
}

function canViewEvent(event, session) {
  if (!event || !session) {
    return false;
  }
  if (event.isDeleted === true && !canEditOrDeleteEvent(event, session)) {
    if (!isPersonalScope(event)) {
      return true;
    }
  }

  const characterID = getSessionCharacterID(session);
  const corporationID = getSessionCorporationID(session);
  const allianceID = getSessionAllianceID(session);
  if (characterID <= 0) {
    return false;
  }

  if (isGlobalScope(event)) {
    return true;
  }
  if (isCorporationScope(event)) {
    return toPositiveInt(event.ownerID, 0) === corporationID;
  }
  if (isAllianceScope(event)) {
    return allianceID > 0 && toPositiveInt(event.ownerID, 0) === allianceID;
  }
  if (toPositiveInt(event.ownerID, 0) === characterID) {
    return true;
  }
  return Array.isArray(event.inviteeCharacterIDs) &&
    event.inviteeCharacterIDs.includes(characterID);
}

module.exports = {
  FILETIME_EPOCH_OFFSET,
  FILETIME_TICKS_PER_MILLISECOND,
  toInt,
  toPositiveInt,
  toOptionalPositiveInt,
  toBoolean,
  cloneValue,
  sanitizeTitle,
  sanitizeDescription,
  currentFileTimeBigInt,
  currentFileTimeString,
  toFileTimeBigInt,
  filetimeToDate,
  dateToFiletimeString,
  getYearMonthFromFiletime,
  getSessionCharacterID,
  getSessionCorporationID,
  getSessionAllianceID,
  getSessionCorpRole,
  sessionHasChatManagerRole,
  resolveEventScopeFromOwner,
  resolveCalendarTag,
  isPersonalScope,
  isCorporationScope,
  isAllianceScope,
  isGlobalScope,
  canCreateCorpOrAllianceEvent,
  canEditOrDeleteEvent,
  canViewEvent,
};
