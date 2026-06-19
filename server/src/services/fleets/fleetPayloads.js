const path = require("path");

const {
  buildDict,
  buildKeyVal,
  buildList,
  buildPythonSet,
  currentFileTime,
  extractList,
  normalizeBigInt,
  normalizeNumber,
  normalizeText,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const FLEET = require(path.join(__dirname, "./fleetConstants"));

function toInteger(value, fallback = 0) {
  const numericValue = normalizeNumber(value, fallback);
  return Number.isFinite(numericValue) ? Math.trunc(numericValue) : fallback;
}

function toOptionalInteger(value, fallback = null) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = toInteger(value, fallback == null ? 0 : fallback);
  return Number.isFinite(normalized) ? normalized : fallback;
}

function toBigIntFiletime(value, fallback = null) {
  const normalized = normalizeBigInt(value, fallback == null ? currentFileTime() : fallback);
  return normalized || currentFileTime();
}

function toSet(values) {
  if (values instanceof Set) {
    return new Set(values);
  }

  if (Array.isArray(values)) {
    return new Set(values.map((value) => toInteger(value, 0)).filter((value) => value > 0));
  }

  if (values && typeof values === "object") {
    if (values.type === "objectex1" && Array.isArray(values.header)) {
      const headerArgs = Array.isArray(values.header[1]) ? values.header[1] : [];
      if (headerArgs.length > 0) {
        return toSet(extractList(headerArgs[0]));
      }
    }

    if (values.type === "list") {
      return toSet(extractList(values));
    }

    if (values.type === "dict" && Array.isArray(values.entries)) {
      return new Set(
        values.entries
          .map(([key]) => toInteger(key, 0))
          .filter((value) => value > 0),
      );
    }
  }

  const numericValue = toInteger(values, 0);
  return numericValue > 0 ? new Set([numericValue]) : new Set();
}

function buildMemberOptOutsPayload(optOuts = {}) {
  return buildKeyVal([
    ["acceptsFleetWarp", optOuts.acceptsFleetWarp !== false],
    ["acceptsConduitJumps", optOuts.acceptsConduitJumps !== false],
    ["acceptsFleetRegroups", optOuts.acceptsFleetRegroups !== false],
  ]);
}

function buildMemberPayload(member = {}) {
  return buildKeyVal([
    ["charID", toInteger(member.charID, 0)],
    ["wingID", toInteger(member.wingID, -1)],
    ["squadID", toInteger(member.squadID, -1)],
    ["role", toInteger(member.role, FLEET.FLEET_ROLE_MEMBER)],
    ["job", toInteger(member.job, FLEET.FLEET_JOB_NONE)],
    ["memberOptOuts", buildMemberOptOutsPayload(member.memberOptOuts)],
  ]);
}

function buildJoinRequestPayload(request = {}) {
  return buildKeyVal([
    ["charID", toInteger(request.charID, 0)],
    ["corpID", toOptionalInteger(request.corpID, null)],
    ["allianceID", toOptionalInteger(request.allianceID, null)],
    ["warFactionID", toOptionalInteger(request.warFactionID, null)],
    ["securityStatus", Number(request.securityStatus ?? 0)],
  ]);
}

function buildSquadPayload(squad = {}) {
  return buildKeyVal([
    ["squadID", toInteger(squad.squadID, 0)],
    ["name", normalizeText(squad.name, "")],
  ]);
}

function buildWingPayload(wing = {}) {
  const squadEntries = [];
  const squads = wing.squads instanceof Map
    ? [...wing.squads.values()]
    : Object.values(wing.squads || {});
  squads.sort((left, right) => toInteger(left && left.squadID, 0) - toInteger(right && right.squadID, 0));

  for (const squad of squads) {
    squadEntries.push([toInteger(squad.squadID, 0), buildSquadPayload(squad)]);
  }

  return buildKeyVal([
    ["wingID", toInteger(wing.wingID, 0)],
    ["name", normalizeText(wing.name, "")],
    ["squads", buildDict(squadEntries)],
  ]);
}

function buildOptionsPayload(options = {}) {
  return buildKeyVal([
    ["isFreeMove", Boolean(options.isFreeMove)],
    ["isRegistered", Boolean(options.isRegistered)],
    ["autoJoinSquadID", toOptionalInteger(options.autoJoinSquadID, null)],
  ]);
}

function buildFleetStatePayload(fleet = {}) {
  const memberEntries = [];
  const members = fleet.members instanceof Map
    ? [...fleet.members.values()]
    : Object.values(fleet.members || {});
  members.sort((left, right) => toInteger(left && left.charID, 0) - toInteger(right && right.charID, 0));
  for (const member of members) {
    memberEntries.push([toInteger(member.charID, 0), buildMemberPayload(member)]);
  }

  const wingEntries = [];
  const wings = fleet.wings instanceof Map
    ? [...fleet.wings.values()]
    : Object.values(fleet.wings || {});
  wings.sort((left, right) => toInteger(left && left.wingID, 0) - toInteger(right && right.wingID, 0));
  for (const wing of wings) {
    wingEntries.push([toInteger(wing.wingID, 0), buildWingPayload(wing)]);
  }

  return buildKeyVal([
    ["fleetID", toInteger(fleet.fleetID, 0)],
    ["members", buildDict(memberEntries)],
    ["wings", buildDict(wingEntries)],
    ["options", buildOptionsPayload(fleet.options)],
    ["motd", normalizeText(fleet.motd, "")],
  ]);
}

function buildTargetTagsPayload(targetTags = new Map()) {
  const entries = [];
  const values = targetTags instanceof Map
    ? [...targetTags.entries()]
    : Object.entries(targetTags || {});
  values.sort(
    (left, right) => toInteger(left[0], 0) - toInteger(right[0], 0),
  );

  for (const [itemID, tag] of values) {
    const numericItemID = toInteger(itemID, 0);
    const normalizedTag = normalizeText(tag, "").trim();
    if (numericItemID <= 0 || !normalizedTag) {
      continue;
    }
    entries.push([numericItemID, normalizedTag]);
  }

  return buildDict(entries);
}

function buildFleetStateChangePayload(fleetState = {}) {
  return buildKeyVal([
    ["targetTags", buildTargetTagsPayload(fleetState.targetTags)],
  ]);
}

function buildTuplePayload(items = []) {
  return {
    type: "tuple",
    items: Array.isArray(items) ? items : [items],
  };
}

function buildLootEventsPayload(lootEvents = new Map()) {
  const entries = [];
  const rawEntries = lootEvents instanceof Map
    ? [...lootEvents.entries()]
    : Object.entries(lootEvents || {});

  for (const [rawKey, rawQuantity] of rawEntries) {
    let charID = 0;
    let typeID = 0;

    if (Array.isArray(rawKey)) {
      charID = toInteger(rawKey[0], 0);
      typeID = toInteger(rawKey[1], 0);
    } else if (
      rawKey &&
      typeof rawKey === "object" &&
      rawKey.type === "tuple" &&
      Array.isArray(rawKey.items)
    ) {
      charID = toInteger(rawKey.items[0], 0);
      typeID = toInteger(rawKey.items[1], 0);
    } else if (rawKey && typeof rawKey === "object") {
      charID = toInteger(rawKey.charID, 0);
      typeID = toInteger(rawKey.typeID, 0);
    } else if (typeof rawKey === "string") {
      const [rawCharID, rawTypeID] = rawKey.split(":");
      charID = toInteger(rawCharID, 0);
      typeID = toInteger(rawTypeID, 0);
    }

    const quantity = Math.max(1, toInteger(rawQuantity, 0));
    if (charID <= 0 || typeID <= 0 || quantity <= 0) {
      continue;
    }

    entries.push([buildTuplePayload([charID, typeID]), quantity]);
  }

  entries.sort((left, right) => {
    const leftItems = left[0] && Array.isArray(left[0].items) ? left[0].items : [];
    const rightItems = right[0] && Array.isArray(right[0].items) ? right[0].items : [];
    return (
      toInteger(leftItems[0], 0) - toInteger(rightItems[0], 0) ||
      toInteger(leftItems[1], 0) - toInteger(rightItems[1], 0)
    );
  });

  return buildDict(entries);
}

function buildJoinRequestsPayload(joinRequests) {
  const entries = [];
  const values = joinRequests instanceof Map
    ? [...joinRequests.values()]
    : Object.values(joinRequests || {});
  values.sort((left, right) => toInteger(left && left.charID, 0) - toInteger(right && right.charID, 0));
  for (const request of values) {
    entries.push([toInteger(request.charID, 0), buildJoinRequestPayload(request)]);
  }
  return buildDict(entries);
}

function buildLeaderPayload(leader = {}) {
  return buildKeyVal([
    ["charID", toInteger(leader.charID, 0)],
    ["corpID", toOptionalInteger(leader.corpID, null)],
    ["allianceID", toOptionalInteger(leader.allianceID, null)],
    ["warFactionID", toOptionalInteger(leader.warFactionID, null)],
    ["securityStatus", Number(leader.securityStatus ?? 0)],
  ]);
}

function buildAdvertPayload(advert = {}) {
  return buildDict([
    ["fleetID", toInteger(advert.fleetID, 0)],
    ["leader", buildLeaderPayload(advert.leader)],
    ["solarSystemID", toOptionalInteger(advert.solarSystemID, null)],
    ["numMembers", toInteger(advert.numMembers, 0)],
    ["advertTime", toBigIntFiletime(advert.advertTime)],
    ["dateCreated", toBigIntFiletime(advert.dateCreated)],
    ["fleetName", normalizeText(advert.fleetName, "")],
    ["description", normalizeText(advert.description, "")],
    ["inviteScope", toInteger(advert.inviteScope, FLEET.INVITE_CLOSED)],
    ["activityValue", toOptionalInteger(advert.activityValue, null)],
    ["useAdvanceOptions", Boolean(advert.useAdvanceOptions)],
    ["newPlayerFriendly", Boolean(advert.newPlayerFriendly)],
    ["public_minStanding", advert.public_minStanding ?? null],
    ["public_minSecurity", advert.public_minSecurity ?? null],
    ["public_allowedEntities", buildPythonSet([...toSet(advert.public_allowedEntities)])],
    ["public_disallowedEntities", buildPythonSet([...toSet(advert.public_disallowedEntities)])],
    ["membergroups_minStanding", advert.membergroups_minStanding ?? null],
    ["membergroups_minSecurity", advert.membergroups_minSecurity ?? null],
    ["membergroups_allowedEntities", buildPythonSet([...toSet(advert.membergroups_allowedEntities)])],
    ["membergroups_disallowedEntities", buildPythonSet([...toSet(advert.membergroups_disallowedEntities)])],
    ["joinNeedsApproval", Boolean(advert.joinNeedsApproval)],
    ["hideInfo", Boolean(advert.hideInfo)],
    ["updateOnBossChange", advert.updateOnBossChange !== false],
    ["advertJoinLimit", advert.advertJoinLimit == null ? null : toInteger(advert.advertJoinLimit, 1)],
  ]);
}

function buildAdvertMapPayload(advertsByFleetID) {
  const entries = [];
  const values = advertsByFleetID instanceof Map
    ? [...advertsByFleetID.entries()]
    : Object.entries(advertsByFleetID || {});
  values.sort((left, right) => toInteger(left[0], 0) - toInteger(right[0], 0));
  for (const [fleetID, advert] of values) {
    entries.push([toInteger(fleetID, 0), buildAdvertPayload(advert)]);
  }
  return buildDict(entries);
}

function buildCompositionEntryPayload(entry = {}) {
  return buildKeyVal([
    ["characterID", toInteger(entry.characterID, 0)],
    ["solarSystemID", toOptionalInteger(entry.solarSystemID, null)],
    ["stationID", toOptionalInteger(entry.stationID, null)],
    ["shipTypeID", toOptionalInteger(entry.shipTypeID, null)],
    ["skills", buildList(Array.isArray(entry.skills) ? entry.skills : [])],
    ["skillIDs", buildList(Array.isArray(entry.skillIDs) ? entry.skillIDs : [])],
  ]);
}

function buildCompositionPayload(entries = []) {
  return buildList(
    (Array.isArray(entries) ? entries : [])
      .map((entry) => buildCompositionEntryPayload(entry)),
  );
}

function buildDynamicPayload(value) {
  if (value === null || value === undefined) {
    return value ?? null;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return buildList(value.map((entry) => buildDynamicPayload(entry)));
  }

  if (value && typeof value === "object" && value.type) {
    return value;
  }

  if (value && typeof value === "object") {
    return buildKeyVal(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        buildDynamicPayload(entryValue),
      ]),
    );
  }

  return value;
}

function buildRespawnPointPayload(respawnPoint = {}) {
  return buildDynamicPayload(respawnPoint);
}

function buildRespawnPointsPayload(respawnPoints = []) {
  return buildList(
    (Array.isArray(respawnPoints) ? respawnPoints : []).map((entry) => (
      buildRespawnPointPayload(entry)
    )),
  );
}

module.exports = {
  toInteger,
  toOptionalInteger,
  toSet,
  buildMemberOptOutsPayload,
  buildMemberPayload,
  buildJoinRequestPayload,
  buildSquadPayload,
  buildWingPayload,
  buildOptionsPayload,
  buildFleetStatePayload,
  buildTargetTagsPayload,
  buildFleetStateChangePayload,
  buildJoinRequestsPayload,
  buildLeaderPayload,
  buildAdvertPayload,
  buildAdvertMapPayload,
  buildCompositionEntryPayload,
  buildCompositionPayload,
  buildLootEventsPayload,
  buildRespawnPointPayload,
  buildRespawnPointsPayload,
};
