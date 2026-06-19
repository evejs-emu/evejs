const path = require("path");

const {
  buildKeyVal,
  buildList,
  extractDictEntries,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  OWNER_SCOPE,
  throwFittingError,
} = require(path.join(__dirname, "../../_secondary/fitting/fittingStore"));

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function extractKwargValue(kwargs, key) {
  for (const [entryKey, entryValue] of extractDictEntries(kwargs)) {
    if (String(entryKey) === String(key)) {
      return unwrapMarshalValue(entryValue);
    }
  }

  if (
    kwargs &&
    typeof kwargs === "object" &&
    Object.prototype.hasOwnProperty.call(kwargs, key)
  ) {
    return unwrapMarshalValue(kwargs[key]);
  }

  return undefined;
}

function getSessionOwnerID(session, ownerScope) {
  switch (ownerScope) {
    case OWNER_SCOPE.CORPORATION:
      return toInt(session && (session.corpid || session.corporationID), 0);
    case OWNER_SCOPE.ALLIANCE:
      return toInt(session && (session.allianceid || session.allianceID), 0);
    case OWNER_SCOPE.CHARACTER:
    default:
      return toInt(session && (session.characterID || session.charid), 0);
  }
}

function resolveRequestedOwnerID(args, session, ownerScope) {
  const requestedOwnerID = toInt(args && args[0], 0);
  return requestedOwnerID > 0
    ? requestedOwnerID
    : getSessionOwnerID(session, ownerScope);
}

function buildSaveManyResult(mappings = []) {
  return buildList(
    (Array.isArray(mappings) ? mappings : []).map((mapping) =>
      buildKeyVal([
        ["tempFittingID", toInt(mapping && mapping.tempFittingID, 0)],
        ["realFittingID", toInt(mapping && mapping.realFittingID, 0)],
      ]),
    ),
  );
}

function buildDeletedResult(fittingIDs = []) {
  return buildList(
    (Array.isArray(fittingIDs) ? fittingIDs : []).map((fittingID) => toInt(fittingID, 0)),
  );
}

function handleStoreResult(result, onSuccess = (data) => data) {
  if (!result || result.success !== true) {
    throwFittingError(result && result.errorMsg, result && result.values);
  }

  return typeof onSuccess === "function" ? onSuccess(result.data) : result.data;
}

function notifyFittingMutation(session, notificationName, payload = []) {
  if (!session || typeof session.sendNotification !== "function") {
    return;
  }
  session.sendNotification(
    notificationName,
    "clientID",
    Array.isArray(payload) ? payload : [payload],
  );
}

module.exports = {
  buildDeletedResult,
  buildSaveManyResult,
  extractKwargValue,
  getSessionOwnerID,
  handleStoreResult,
  notifyFittingMutation,
  resolveRequestedOwnerID,
};
