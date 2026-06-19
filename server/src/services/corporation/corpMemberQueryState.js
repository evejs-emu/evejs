const path = require("path");

const sessionRegistry = require(path.join(__dirname, "../chat/sessionRegistry"));
const {
  buildFiletimeLong,
  buildList,
  buildRowset,
  currentFileTime,
  extractList,
  normalizeNumber,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getCharacterRecord,
} = require(path.join(__dirname, "../character/characterState"));
const {
  getOwnerLookupRecord,
} = require(path.join(__dirname, "./corporationState"));
const {
  getCorporationRuntime,
  listCorporationMembers,
  normalizeText,
  toRoleMaskBigInt,
} = require(path.join(__dirname, "./corporationRuntimeState"));

const FILETIME_TICKS_PER_HOUR = 36000000000n;

const LOGICAL_OPERATOR_OR = 1;
const LOGICAL_OPERATOR_AND = 2;
const OPERATOR_EQUAL = 1;
const OPERATOR_GREATER = 2;
const OPERATOR_GREATER_OR_EQUAL = 3;
const OPERATOR_LESS = 4;
const OPERATOR_LESS_OR_EQUAL = 5;
const OPERATOR_NOT_EQUAL = 6;
const OPERATOR_HAS_BIT = 7;
const OPERATOR_NOT_HAS_BIT = 8;
const OPERATOR_STR_CONTAINS = 9;
const OPERATOR_STR_LIKE = 10;
const OPERATOR_STR_STARTS_WITH = 11;
const OPERATOR_STR_ENDS_WITH = 12;
const OPERATOR_STR_IS = 13;

const MEMBER_TRACKING_HEADER = [
  "characterID",
  "corporationID",
  "roles",
  "grantableRoles",
  "title",
  "baseID",
  "startDateTime",
  "locationID",
  "lastOnline",
  "shipTypeID",
  "factionID",
  "logonDateTime",
  "logoffDateTime",
];

function getOwnerRecord(ownerID) {
  const characterRecord = getCharacterRecord(ownerID);
  if (characterRecord) {
    return {
      ownerID: Number(ownerID),
      ownerName: characterRecord.characterName || `Character ${ownerID}`,
      typeID: Number(characterRecord.typeID || 1373),
      gender: Number(characterRecord.gender || 0),
    };
  }
  return getOwnerLookupRecord(ownerID) || null;
}

function getAssignedTitles(member, runtime) {
  const titles = runtime && runtime.titles ? runtime.titles : {};
  const titleMask = toRoleMaskBigInt(member && member.titleMask, 0n);
  const assignedTitles = [];
  for (const title of Object.values(titles)) {
    const titleID = toRoleMaskBigInt(title && title.titleID, 0n);
    if (titleID > 0n && (titleMask & titleID) === titleID) {
      assignedTitles.push(title);
    }
  }
  return assignedTitles;
}

function getRoleMaskForMember(member, runtime, propertyName, includeImplied) {
  let effectiveMask = toRoleMaskBigInt(member && member[propertyName], 0n);
  if (!includeImplied) {
    return effectiveMask;
  }
  for (const title of getAssignedTitles(member, runtime)) {
    effectiveMask |= toRoleMaskBigInt(title && title[propertyName], 0n);
  }
  return effectiveMask;
}

function normalizeQueryTerm(term) {
  const values = extractList(term);
  if (values.length === 3) {
    return {
      joinOperator: null,
      property: values[0],
      operator: values[1],
      value: values[2],
    };
  }
  if (values.length >= 4) {
    return {
      joinOperator: values[0],
      property: values[1],
      operator: values[2],
      value: values[3],
    };
  }
  if (term && typeof term === "object" && Array.isArray(term.line)) {
    return normalizeQueryTerm(term.line);
  }
  return null;
}

function getComparableNumericValue(member, runtime, propertyName, includeImplied) {
  if (
    propertyName === "roles" ||
    propertyName === "rolesAtHQ" ||
    propertyName === "rolesAtBase" ||
    propertyName === "rolesAtOther" ||
    propertyName === "grantableRoles" ||
    propertyName === "grantableRolesAtHQ" ||
    propertyName === "grantableRolesAtBase" ||
    propertyName === "grantableRolesAtOther"
  ) {
    return getRoleMaskForMember(member, runtime, propertyName, includeImplied);
  }

  if (propertyName === "titleMask") {
    return toRoleMaskBigInt(member && member.titleMask, 0n);
  }

  if (propertyName === "startDateTime") {
    return BigInt(String(member && member.startDate ? member.startDate : 0));
  }

  return BigInt(Math.trunc(normalizeNumber(member && member[propertyName], 0)));
}

function getStringCandidates(member, runtime, propertyName, searchTitles) {
  if (propertyName !== "characterID") {
    return [normalizeText(member && member[propertyName], "")];
  }

  const owner = getOwnerRecord(member && member.characterID) || {};
  const candidates = [normalizeText(owner.ownerName, "")];
  if (searchTitles) {
    candidates.push(normalizeText(member && member.title, ""));
    for (const title of getAssignedTitles(member, runtime)) {
      candidates.push(normalizeText(title && title.titleName, ""));
    }
  }
  return candidates.filter(Boolean);
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesStringOperator(candidate, operator, rawValue) {
  const left = normalizeText(candidate, "").toLowerCase();
  const right = normalizeText(rawValue, "").toLowerCase();
  if (!right) {
    return true;
  }

  switch (Number(operator || 0)) {
    case OPERATOR_STR_CONTAINS:
      return left.includes(right);
    case OPERATOR_STR_LIKE: {
      const pattern = escapeRegExp(right)
        .replace(/\\\*/g, ".*")
        .replace(/\\%/g, ".*")
        .replace(/\\\?/g, ".");
      return new RegExp(`^${pattern}$`, "i").test(left);
    }
    case OPERATOR_STR_STARTS_WITH:
      return left.startsWith(right);
    case OPERATOR_STR_ENDS_WITH:
      return left.endsWith(right);
    case OPERATOR_STR_IS:
      return left === right;
    default:
      return false;
  }
}

function matchesNumericOperator(leftValue, operator, rightValue) {
  const left = typeof leftValue === "bigint" ? leftValue : BigInt(leftValue || 0);
  const right =
    typeof rightValue === "bigint"
      ? rightValue
      : BigInt(Math.trunc(normalizeNumber(rightValue, 0)));

  switch (Number(operator || 0)) {
    case OPERATOR_EQUAL:
      return left === right;
    case OPERATOR_GREATER:
      return left > right;
    case OPERATOR_GREATER_OR_EQUAL:
      return left >= right;
    case OPERATOR_LESS:
      return left < right;
    case OPERATOR_LESS_OR_EQUAL:
      return left <= right;
    case OPERATOR_NOT_EQUAL:
      return left !== right;
    case OPERATOR_HAS_BIT:
      return right === 0n ? true : (left & right) === right;
    case OPERATOR_NOT_HAS_BIT:
      return right === 0n ? false : (left & right) === 0n;
    default:
      return false;
  }
}

function matchesCriterion(member, runtime, criterion, includeImplied, searchTitles) {
  if (!criterion) {
    return true;
  }

  const propertyName = normalizeText(criterion.property, "");
  const operator = Number(criterion.operator || 0);

  if (
    operator === OPERATOR_STR_CONTAINS ||
    operator === OPERATOR_STR_LIKE ||
    operator === OPERATOR_STR_STARTS_WITH ||
    operator === OPERATOR_STR_ENDS_WITH ||
    operator === OPERATOR_STR_IS
  ) {
    return getStringCandidates(member, runtime, propertyName, searchTitles).some(
      (candidate) => matchesStringOperator(candidate, operator, criterion.value),
    );
  }

  const leftValue = getComparableNumericValue(
    member,
    runtime,
    propertyName,
    includeImplied,
  );
  const rightValue =
    propertyName === "startDateTime"
      ? BigInt(String(criterion.value && criterion.value.value !== undefined
        ? criterion.value.value
        : criterion.value || 0))
      : criterion.value;
  return matchesNumericOperator(leftValue, operator, rightValue);
}

function queryCorporationMemberIDs(
  corporationID,
  rawQuery,
  includeImplied = false,
  searchTitles = false,
) {
  const runtime = getCorporationRuntime(corporationID) || {};
  const criteria = extractList(rawQuery)
    .map((term) => normalizeQueryTerm(term))
    .filter(Boolean);

  return listCorporationMembers(corporationID)
    .filter((member) => {
      if (criteria.length === 0) {
        return true;
      }

      let matched = null;
      for (const criterion of criteria) {
        const nextResult = matchesCriterion(
          member,
          runtime,
          criterion,
          includeImplied,
          searchTitles,
        );
        if (matched === null || criterion.joinOperator === null) {
          matched = nextResult;
          continue;
        }
        if (Number(criterion.joinOperator) === LOGICAL_OPERATOR_AND) {
          matched = matched && nextResult;
        } else {
          matched = matched || nextResult;
        }
      }
      return Boolean(matched);
    })
    .map((member) => member.characterID);
}

function getLastOnlineHours(characterID, member) {
  if (sessionRegistry.findSessionByCharacterID(characterID)) {
    return -1;
  }
  if (!member || !member.lastOnline) {
    return null;
  }
  const lastOnline = BigInt(String(member.lastOnline || 0));
  if (lastOnline <= 0n) {
    return null;
  }
  const diff = currentFileTime() - lastOnline;
  if (diff < 0n) {
    return 0;
  }
  return Number(diff / FILETIME_TICKS_PER_HOUR);
}

function buildCorporationMemberTrackingRowset(corporationID) {
  return buildRowset(
    MEMBER_TRACKING_HEADER,
    listCorporationMembers(corporationID).map((member) => {
      const characterRecord = getCharacterRecord(member.characterID) || {};
      const onlineSession = sessionRegistry.findSessionByCharacterID(member.characterID);
      return buildList([
        member.characterID,
        member.corporationID,
        { type: "long", value: toRoleMaskBigInt(member.roles, 0n) },
        { type: "long", value: toRoleMaskBigInt(member.grantableRoles, 0n) },
        member.title || "",
        member.baseID || null,
        buildFiletimeLong(member.startDate),
        member.locationID || characterRecord.locationID || characterRecord.stationID || null,
        getLastOnlineHours(member.characterID, member),
        member.shipTypeID || characterRecord.shipTypeID || null,
        characterRecord.warFactionID || characterRecord.factionID || null,
        onlineSession ? buildFiletimeLong(currentFileTime()) : null,
        null,
      ]);
    }),
    "eve.common.script.sys.rowset.Rowset",
  );
}

module.exports = {
  buildCorporationMemberTrackingRowset,
  queryCorporationMemberIDs,
};
