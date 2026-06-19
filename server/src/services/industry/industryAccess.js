const path = require("path");

const {
  CORP_BLUEPRINT_VIEW_MASK,
  CORP_HANGAR_FLAGS,
  CORP_HANGAR_QUERY_ROLE_BY_FLAG,
  CORP_HANGAR_TAKE_ROLE_BY_FLAG,
  CORP_WALLET_TAKE_ROLE_BY_KEY,
  ITEM_FLAG_CORP_DELIVERIES,
  ROLE_FACTORY_MANAGER,
} = require(path.join(__dirname, "./industryConstants"));

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizeRoleValue(value) {
  try {
    if (typeof value === "bigint") {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return BigInt(Math.trunc(value));
    }
    if (typeof value === "string" && value.trim() !== "") {
      return BigInt(value);
    }
  } catch (error) {
    return 0n;
  }
  return 0n;
}

function getSessionCharacterID(session) {
  return toInt(session && (session.characterID || session.charid), 0);
}

function getSessionCorporationID(session) {
  return toInt(session && (session.corporationID || session.corpid), 0);
}

function rolesAtLocation(session, locationID) {
  if (!session) {
    return 0n;
  }
  const location = toInt(locationID, 0);
  const rolesAtAll = normalizeRoleValue(session.rolesAtAll || session.corprole);
  if (location > 0 && location === toInt(session.hqID, 0)) {
    return rolesAtAll | normalizeRoleValue(session.rolesAtHQ);
  }
  if (location > 0 && location === toInt(session.baseID, 0)) {
    return rolesAtAll | normalizeRoleValue(session.rolesAtBase);
  }
  return rolesAtAll | normalizeRoleValue(session.rolesAtOther);
}

function isCharacterOwner(session, ownerID) {
  return getSessionCharacterID(session) === toInt(ownerID, 0);
}

function isCorporationOwner(session, ownerID) {
  return getSessionCorporationID(session) === toInt(ownerID, 0);
}

function canSeeCorporationBlueprints(session, ownerID) {
  if (!isCorporationOwner(session, ownerID)) {
    return false;
  }
  const corpRole = normalizeRoleValue(session && session.corprole);
  return (corpRole & CORP_BLUEPRINT_VIEW_MASK) !== 0n;
}

function hasCorporationIndustryJobAccess(session, ownerID) {
  if (!isCorporationOwner(session, ownerID)) {
    return false;
  }
  const corpRole = normalizeRoleValue(session && session.corprole);
  return (corpRole & ROLE_FACTORY_MANAGER) === ROLE_FACTORY_MANAGER;
}

function canViewOwnerLocation(session, ownerID, locationID, flagID) {
  if (isCharacterOwner(session, ownerID)) {
    return true;
  }
  if (!isCorporationOwner(session, ownerID)) {
    return false;
  }
  if (toInt(flagID, 0) === ITEM_FLAG_CORP_DELIVERIES) {
    return hasCorporationIndustryJobAccess(session, ownerID);
  }
  const queryRole = CORP_HANGAR_QUERY_ROLE_BY_FLAG[toInt(flagID, 0)];
  if (!queryRole) {
    return hasCorporationIndustryJobAccess(session, ownerID);
  }
  const roles = rolesAtLocation(session, locationID);
  return (roles & (queryRole | ROLE_FACTORY_MANAGER)) !== 0n;
}

function canTakeFromOwnerLocation(session, ownerID, locationID, flagID) {
  if (isCharacterOwner(session, ownerID)) {
    return true;
  }
  if (!isCorporationOwner(session, ownerID)) {
    return false;
  }
  if (toInt(flagID, 0) === ITEM_FLAG_CORP_DELIVERIES) {
    return hasCorporationIndustryJobAccess(session, ownerID);
  }
  const takeRole = CORP_HANGAR_TAKE_ROLE_BY_FLAG[toInt(flagID, 0)];
  if (!takeRole) {
    return hasCorporationIndustryJobAccess(session, ownerID);
  }
  const roles = rolesAtLocation(session, locationID);
  return (roles & (takeRole | ROLE_FACTORY_MANAGER)) === (takeRole | ROLE_FACTORY_MANAGER)
    || (roles & takeRole) === takeRole
    || (roles & ROLE_FACTORY_MANAGER) === ROLE_FACTORY_MANAGER;
}

function canUseCorporationWallet(session, ownerID, accountKey) {
  if (!isCorporationOwner(session, ownerID)) {
    return false;
  }
  const normalizedAccountKey = toInt(accountKey, 1000);
  if (toInt(session && session.corpAccountKey, 1000) === normalizedAccountKey) {
    return true;
  }
  const roles = normalizeRoleValue(session && session.corprole);
  const requiredRole = CORP_WALLET_TAKE_ROLE_BY_KEY[normalizedAccountKey];
  return Boolean(requiredRole && (roles & requiredRole) === requiredRole);
}

function getAccessibleCorpHangarFlags(session, locationID, options = {}) {
  const flags = [];
  const takeRequired = options && options.takeRequired === true;
  for (const flagID of CORP_HANGAR_FLAGS) {
    const accessible = takeRequired
      ? canTakeFromOwnerLocation(session, getSessionCorporationID(session), locationID, flagID)
      : canViewOwnerLocation(session, getSessionCorporationID(session), locationID, flagID);
    if (accessible) {
      flags.push(flagID);
    }
  }
  return flags;
}

module.exports = {
  canSeeCorporationBlueprints,
  canTakeFromOwnerLocation,
  canUseCorporationWallet,
  canViewOwnerLocation,
  getAccessibleCorpHangarFlags,
  getSessionCharacterID,
  getSessionCorporationID,
  hasCorporationIndustryJobAccess,
  isCharacterOwner,
  isCorporationOwner,
  normalizeRoleValue,
  rolesAtLocation,
};
