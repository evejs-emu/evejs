const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const database = require(path.join(__dirname, "../../newDatabase"));
const { buildKeyVal } = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));
const { buildList } = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));

function collectRequestedIds(rawValue, out, depth = 0) {
  if (depth > 8 || rawValue === null || rawValue === undefined) {
    return;
  }

  if (typeof rawValue === "number" || typeof rawValue === "bigint") {
    const numericValue = Number(rawValue);
    if (Number.isInteger(numericValue)) {
      out.push(numericValue);
    }
    return;
  }

  if (typeof rawValue === "string" && rawValue.trim() !== "") {
    const numericValue = Number(rawValue);
    if (Number.isInteger(numericValue)) {
      out.push(numericValue);
    }
    return;
  }

  if (Array.isArray(rawValue)) {
    for (const item of rawValue) {
      collectRequestedIds(item, out, depth + 1);
    }
    return;
  }

  if (rawValue instanceof Set) {
    for (const item of rawValue) {
      collectRequestedIds(item, out, depth + 1);
    }
    return;
  }

  if (rawValue && typeof rawValue === "object") {
    if (
      (rawValue.type === "list" || rawValue.type === "set") &&
      Array.isArray(rawValue.items)
    ) {
      for (const item of rawValue.items) {
        collectRequestedIds(item, out, depth + 1);
      }
      return;
    }

    if (
      (rawValue.type === "objectex1" || rawValue.type === "objectex2") &&
      Array.isArray(rawValue.list)
    ) {
      for (const item of rawValue.list) {
        collectRequestedIds(item, out, depth + 1);
      }
      return;
    }

    if (
      rawValue.type === "object" &&
      Object.prototype.hasOwnProperty.call(rawValue, "args")
    ) {
      collectRequestedIds(rawValue.args, out, depth + 1);
      return;
    }

    if (
      rawValue.type === "dict" &&
      Array.isArray(rawValue.entries)
    ) {
      for (const [, value] of rawValue.entries) {
        collectRequestedIds(value, out, depth + 1);
      }
      return;
    }

    if (
      Object.prototype.hasOwnProperty.call(rawValue, "value") &&
      (
        rawValue.type === "int" ||
        rawValue.type === "long" ||
        rawValue.type === "float" ||
        rawValue.type === "double" ||
        rawValue.type === "token" ||
        rawValue.type === "wstring"
      )
    ) {
      collectRequestedIds(rawValue.value, out, depth + 1);
    }
  }
}

function extractIdList(rawValue) {
  const extractedIds = [];
  collectRequestedIds(rawValue, extractedIds, 0);
  return Array.from(
    new Set(
      extractedIds.filter(
        (value) => Number.isInteger(value) && Number.isFinite(value),
      ),
    ),
  );
}

function buildZeroBountyEntry(targetID) {
  const numericTargetID = Number(targetID) || 0;
  return [
    numericTargetID,
    buildKeyVal([
      ["targetID", numericTargetID],
      ["bounty", 0],
    ]),
  ];
}

function buildZeroBountyEntries(targetIDs) {
  return extractIdList(targetIDs).map((targetID) => buildZeroBountyEntry(targetID));
}

function buildKnownBountyOwnerIds(session = null) {
  const ownerIds = new Set([0]);
  const characterResult = database.read("characters", "/");
  const characters = characterResult.success ? characterResult.data : {};

  for (const [characterID, characterRecord] of Object.entries(characters)) {
    const numericCharacterID = Number(characterID) || 0;
    const corporationID = Number(characterRecord && characterRecord.corporationID) || 0;
    const allianceID = Number(characterRecord && characterRecord.allianceID) || 0;
    if (numericCharacterID > 0) {
      ownerIds.add(numericCharacterID);
    }
    if (corporationID > 0) {
      ownerIds.add(corporationID);
    }
    if (allianceID > 0) {
      ownerIds.add(allianceID);
    }
  }

  const sessionCharacterID = Number(session && (session.characterID || session.charid)) || 0;
  const sessionCorporationID = Number(session && (session.corporationID || session.corpid)) || 0;
  const sessionAllianceID = Number(session && (session.allianceID || session.allianceid)) || 0;
  if (sessionCharacterID > 0) {
    ownerIds.add(sessionCharacterID);
  }
  if (sessionCorporationID > 0) {
    ownerIds.add(sessionCorporationID);
  }
  if (sessionAllianceID > 0) {
    ownerIds.add(sessionAllianceID);
  }

  return Array.from(ownerIds).sort((left, right) => left - right);
}

function resolveRequestedBountyIds(rawValue, session = null) {
  const requestedIds = extractIdList(rawValue);
  if (requestedIds.length > 0) {
    return requestedIds;
  }
  return buildKnownBountyOwnerIds(session);
}

class BountyProxyService extends BaseService {
  constructor() {
    super("bountyProxy");
  }

  Handle_GetBounties(args, session) {
    const requestedTargetIDs = args && args.length > 0 ? args[0] : [];
    const requestedIds = resolveRequestedBountyIds(requestedTargetIDs, session);
    log.debug(
      `[BountyProxy] GetBounties: ${JSON.stringify(requestedIds)}`,
    );
    return buildList(buildZeroBountyEntries(requestedIds));
  }

  Handle_GetBountiesAndKillRights(args, session) {
    const requestedBountyTargetIDs = args && args.length > 0 ? args[0] : [];
    const requestedIds = resolveRequestedBountyIds(requestedBountyTargetIDs, session);
    log.debug(
      `[BountyProxy] GetBountiesAndKillRights: ${JSON.stringify(requestedIds)}`,
    );
    return [
      buildList(buildZeroBountyEntries(requestedIds)),
      buildList([]),
    ];
  }

  Handle_GetMyBounties() {
    log.debug("[BountyProxy] GetMyBounties");
    return buildList([]);
  }

  Handle_GetMyKillRights() {
    log.debug("[BountyProxy] GetMyKillRights");
    return { type: "list", items: [] };
  }

  callMethod(method, args, session, kwargs) {
    const result = super.callMethod(method, args, session, kwargs);
    if (result !== null) {
      return result;
    }

    log.warn(`[BountyProxy] Unhandled method fallback: ${method}`);
    return { type: "list", items: [] };
  }
}

module.exports = BountyProxyService;
