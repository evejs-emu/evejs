const path = require("path");

const config = require(path.join(__dirname, "../../config"));
const log = require(path.join(__dirname, "../../utils/logger"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const { throwWrappedUserError } = require(path.join(
  __dirname,
  "../../common/machoErrors",
));
const {
  currentFileTime,
  extractDictEntries,
  extractList,
  marshalObjectToObject,
  normalizeNumber,
  normalizeText,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  buildJoinRequestPayload,
  buildJoinRequestsPayload,
  buildFleetStateChangePayload,
  buildLootEventsPayload,
  buildMemberOptOutsPayload,
  buildMemberPayload,
  buildOptionsPayload,
  buildRespawnPointsPayload,
} = require(path.join(__dirname, "./fleetPayloads"));
const { getSessions, findSessionByCharacterID } = require(path.join(
  __dirname,
  "../chat/sessionRegistry",
));
const { getCharacterSetting } = require(path.join(
  __dirname,
  "../character/characterSettingsState",
));
const FLEET = require(path.join(__dirname, "./fleetConstants"));
const { getFleetSetupByName } = require(path.join(
  __dirname,
  "./fleetSetupRuntime",
));
const chatRuntime = require(path.join(
  __dirname,
  "../../_secondary/chat/chatRuntime",
));

const runtimeState = {
  nextFleetSerial: 1,
  fleets: new Map(),
  characterToFleet: new Map(),
  invitesByCharacter: new Map(),
};

function getCharacterStateModule() {
  return require(path.join(__dirname, "../character/characterState"));
}

function resolveCharacterRecord(characterID) {
  if (!characterID) {
    return {};
  }

  const characterState = getCharacterStateModule();
  return characterState.getCharacterRecord(characterID) || {};
}

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

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no") {
      return false;
    }
  }

  if (value && typeof value === "object" && "value" in value) {
    return toBoolean(value.value, fallback);
  }

  return fallback;
}

function getKwarg(kwargs, key, fallback = null) {
  if (!kwargs) {
    return fallback;
  }

  if (kwargs && typeof kwargs === "object" && !Array.isArray(kwargs)) {
    if (Object.prototype.hasOwnProperty.call(kwargs, key)) {
      return kwargs[key];
    }

    if (kwargs.type === "dict") {
      for (const [entryKey, entryValue] of extractDictEntries(kwargs)) {
        if (String(entryKey) === String(key)) {
          return entryValue;
        }
      }
    }
  }

  return fallback;
}

function toIntegerSet(values) {
  if (values instanceof Set) {
    return new Set(
      [...values]
        .map((value) => toInteger(value, 0))
        .filter((value) => value > 0),
    );
  }

  if (Array.isArray(values)) {
    return new Set(
      values
        .map((value) => toInteger(value, 0))
        .filter((value) => value > 0),
    );
  }

  if (values && typeof values === "object") {
    if (values.type === "objectex1" && Array.isArray(values.header)) {
      const headerArgs = Array.isArray(values.header[1]) ? values.header[1] : [];
      if (headerArgs.length > 0) {
        return toIntegerSet(extractList(headerArgs[0]));
      }
    }

    if (values.type === "list") {
      return toIntegerSet(extractList(values));
    }

    if (values.type === "dict" && Array.isArray(values.entries)) {
      return new Set(
        values.entries
          .map(([entryKey]) => toInteger(entryKey, 0))
          .filter((value) => value > 0),
      );
    }

    if ("value" in values) {
      return toIntegerSet(values.value);
    }
  }

  const numericValue = toInteger(values, 0);
  return numericValue > 0 ? new Set([numericValue]) : new Set();
}

function cloneSet(values) {
  return new Set(toIntegerSet(values));
}

function getMarshalObjectSource(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const mapped = marshalObjectToObject(value);
  return Object.keys(mapped).length > 0 ? mapped : value;
}

function normalizeAdvertEntitySet(values) {
  const nextValues = new Set();
  for (const value of toIntegerSet(values)) {
    if (nextValues.size >= FLEET.MAX_ALLOWED_ENTITIES) {
      break;
    }
    nextValues.add(value);
  }
  return nextValues;
}

function clonePlainValue(value) {
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
    return value.map((entry) => clonePlainValue(entry));
  }

  if (value instanceof Set) {
    return [...value].map((entry) => clonePlainValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        clonePlainValue(entryValue),
      ]),
    );
  }

  return value;
}

function normalizeRespawnPoint(respawnPoint = {}) {
  const source = getMarshalObjectSource(respawnPoint);
  const nextRespawnPoint = clonePlainValue(source);
  nextRespawnPoint.solarsystemID = toOptionalInteger(source.solarsystemID, null);
  nextRespawnPoint.extraClientState = clonePlainValue(getMarshalObjectSource(source.extraClientState));
  if (nextRespawnPoint.extraClientState && typeof nextRespawnPoint.extraClientState === "object") {
    nextRespawnPoint.extraClientState.characterID = toOptionalInteger(
      nextRespawnPoint.extraClientState.characterID,
      null,
    );
  }
  return nextRespawnPoint;
}

function cloneRespawnPoints(respawnPoints = []) {
  return (Array.isArray(respawnPoints) ? respawnPoints : []).map((entry) => (
    normalizeRespawnPoint(entry)
  ));
}

function normalizeFleetTag(tag) {
  if (tag === undefined || tag === null) {
    return null;
  }

  const normalized = normalizeText(tag, "").trim();
  return normalized ? normalized : null;
}

function buildMemberOptOuts(overrides = {}) {
  return {
    acceptsFleetWarp: overrides.acceptsFleetWarp !== false,
    acceptsConduitJumps: overrides.acceptsConduitJumps !== false,
    acceptsFleetRegroups: overrides.acceptsFleetRegroups !== false,
  };
}

function cloneMemberOptOuts(optOuts = {}) {
  return {
    acceptsFleetWarp: optOuts.acceptsFleetWarp !== false,
    acceptsConduitJumps: optOuts.acceptsConduitJumps !== false,
    acceptsFleetRegroups: optOuts.acceptsFleetRegroups !== false,
  };
}

function allocateFleetID() {
  const fleetSerial = runtimeState.nextFleetSerial;
  runtimeState.nextFleetSerial += 1;
  return config.proxyNodeId * FLEET.NODEID_MOD + fleetSerial * FLEET.FLEETID_MOD;
}

function allocateWingID(fleet) {
  const wingSerial = fleet.nextWingSerial;
  fleet.nextWingSerial += 1;
  return fleet.fleetID + FLEET.WINGID_MOD + wingSerial;
}

function allocateSquadID(fleet) {
  const squadSerial = fleet.nextSquadSerial;
  fleet.nextSquadSerial += 1;
  return fleet.fleetID + FLEET.SQUADID_MOD + squadSerial;
}

function getSessionCharacterID(session) {
  return toInteger(
    session && (session.characterID || session.charID || session.charid || session.userid),
    0,
  );
}

function getSessionShipTypeID(session) {
  return toOptionalInteger(
    session && (session.shipTypeID || session.shiptypeid),
    null,
  );
}

function getSessionSolarSystemID(session) {
  return toOptionalInteger(
    session && (session.solarsystemid2 || session.solarsystemid),
    null,
  );
}

function getSessionStationID(session) {
  return toOptionalInteger(
    session && (session.stationid2 || session.stationid || session.stationID),
    null,
  );
}

function buildMemberSnapshot(characterID, session, overrides = {}) {
  const characterRecord = resolveCharacterRecord(characterID);
  return {
    charID: characterID,
    wingID: overrides.wingID ?? -1,
    squadID: overrides.squadID ?? -1,
    role: overrides.role ?? FLEET.FLEET_ROLE_MEMBER,
    job: overrides.job ?? FLEET.FLEET_JOB_NONE,
    memberOptOuts: cloneMemberOptOuts(overrides.memberOptOuts || buildMemberOptOuts()),
    corpID: toOptionalInteger(
      characterRecord.corporationID ??
        characterRecord.corpID ??
        (session && (session.corpid || session.corporationID)),
      null,
    ),
    allianceID: toOptionalInteger(
      characterRecord.allianceID ??
        (session && (session.allianceid || session.allianceID)),
      null,
    ),
    warFactionID: toOptionalInteger(
      characterRecord.warFactionID ??
        (session && (session.warfactionid || session.warFactionID)),
      null,
    ),
    securityStatus: Number(
      characterRecord.securityStatus ??
      characterRecord.securityRating ??
      0,
    ),
    shipTypeID: overrides.shipTypeID ?? getSessionShipTypeID(session) ?? toOptionalInteger(characterRecord.shipTypeID, null),
    shipID: overrides.shipID ?? toOptionalInteger((session && (session.shipid || session.shipID)), null),
    solarSystemID: overrides.solarSystemID ?? getSessionSolarSystemID(session),
    stationID: overrides.stationID ?? getSessionStationID(session),
  };
}

function buildAdvertFromData(fleet, advertData = {}) {
  const source = getMarshalObjectSource(advertData);
  const fleetName = normalizeText(source.fleetName, "").slice(0, FLEET.FLEETNAME_MAXLENGTH);
  const description = normalizeText(source.description, "").slice(0, FLEET.FLEETDESC_MAXLENGTH);
  return {
    fleetID: fleet.fleetID,
    leader: buildMemberSnapshot(fleet.creatorCharID, findSessionByCharacterID(fleet.creatorCharID), {
      role: FLEET.FLEET_ROLE_LEADER,
      job: FLEET.FLEET_JOB_CREATOR,
    }),
    solarSystemID: getLeaderSolarSystemID(fleet),
    numMembers: fleet.members.size,
    advertTime: currentFileTime(),
    dateCreated: fleet.createdAt,
    fleetName,
    description,
    inviteScope: toInteger(source.inviteScope, FLEET.INVITE_CLOSED),
    activityValue: toOptionalInteger(source.activityValue, null),
    useAdvanceOptions: toBoolean(source.useAdvanceOptions, false),
    newPlayerFriendly: toBoolean(source.newPlayerFriendly, false),
    public_minStanding: source.public_minStanding ?? null,
    public_minSecurity: source.public_minSecurity ?? null,
    public_allowedEntities: normalizeAdvertEntitySet(source.public_allowedEntities),
    public_disallowedEntities: normalizeAdvertEntitySet(source.public_disallowedEntities),
    membergroups_minStanding: source.membergroups_minStanding ?? null,
    membergroups_minSecurity: source.membergroups_minSecurity ?? null,
    membergroups_allowedEntities: normalizeAdvertEntitySet(source.membergroups_allowedEntities),
    membergroups_disallowedEntities: normalizeAdvertEntitySet(source.membergroups_disallowedEntities),
    joinNeedsApproval: toBoolean(source.joinNeedsApproval, false),
    hideInfo: toBoolean(source.hideInfo, false),
    updateOnBossChange: toBoolean(source.updateOnBossChange, true),
    advertJoinLimit: source.advertJoinLimit == null
      ? null
      : Math.max(1, Math.min(FLEET.MAX_MEMBERS_IN_FLEET, toInteger(source.advertJoinLimit, 1))),
  };
}

function copyAdvert(advert) {
  if (!advert) {
    return null;
  }

  return {
    ...advert,
    leader: advert.leader ? { ...advert.leader } : null,
    public_allowedEntities: cloneSet(advert.public_allowedEntities),
    public_disallowedEntities: cloneSet(advert.public_disallowedEntities),
    membergroups_allowedEntities: cloneSet(advert.membergroups_allowedEntities),
    membergroups_disallowedEntities: cloneSet(advert.membergroups_disallowedEntities),
  };
}

function createDefaultWingAndSquad(fleet) {
  const wingID = allocateWingID(fleet);
  const squadID = allocateSquadID(fleet);
  fleet.wings.set(wingID, {
    wingID,
    name: "",
    squads: new Map([
      [squadID, { squadID, name: "" }],
    ]),
  });
  return { wingID, squadID };
}

function createFleetRecord(session) {
  const creatorCharID = getSessionCharacterID(session);
  if (!creatorCharID) {
    throwWrappedUserError("FleetNotFound");
  }

  const fleetID = allocateFleetID();
  const fleet = {
    fleetID,
    creatorCharID,
    createdAt: currentFileTime(),
    maxSize: FLEET.MAX_MEMBERS_IN_FLEET,
    motd: "",
    options: {
      isFreeMove: false,
      isRegistered: false,
      autoJoinSquadID: null,
    },
    members: new Map(),
    wings: new Map(),
    joinRequests: new Map(),
    watchlists: new Map(),
    nextWingSerial: 1,
    nextSquadSerial: 1,
    advert: null,
    respawnPoints: [],
    fleetState: {
      targetTags: new Map(),
    },
    activeModuleBeacons: new Map(),
    activeDeployableBeacons: new Map(),
    activeBridge: new Map(),
    lastBroadcastByCharacter: new Map(),
    compositionCache: {
      expiresAtMs: 0,
      entries: [],
    },
  };
  createDefaultWingAndSquad(fleet);
  runtimeState.fleets.set(fleetID, fleet);
  chatRuntime.ensureFleetChannel(fleetID, {
    motd: fleet.motd,
    metadata: {
      fleetID,
    },
  });
  return fleet;
}

function getFleetByID(fleetID) {
  return runtimeState.fleets.get(toInteger(fleetID, 0)) || null;
}

function getFleetForCharacter(characterID) {
  const fleetID = runtimeState.characterToFleet.get(toInteger(characterID, 0));
  return fleetID ? getFleetByID(fleetID) : null;
}

function getInviteForCharacter(characterID) {
  return runtimeState.invitesByCharacter.get(toInteger(characterID, 0)) || null;
}

function getMemberRecord(fleet, characterID) {
  if (!fleet) {
    return null;
  }
  return fleet.members.get(toInteger(characterID, 0)) || null;
}

function getBossMember(fleet) {
  if (!fleet) {
    return null;
  }

  for (const member of fleet.members.values()) {
    if ((member.job & FLEET.FLEET_JOB_CREATOR) !== 0) {
      return member;
    }
  }

  return null;
}

function getBossCharacterID(fleet) {
  const boss = getBossMember(fleet);
  return boss ? boss.charID : 0;
}

function getLeaderSolarSystemID(fleet) {
  const bossCharID = getBossCharacterID(fleet);
  const bossSession = findSessionByCharacterID(bossCharID);
  if (bossSession) {
    return getSessionSolarSystemID(bossSession);
  }
  const bossMember = getMemberRecord(fleet, bossCharID);
  return bossMember ? toOptionalInteger(bossMember.solarSystemID, null) : null;
}

function getFirstWingAndSquad(fleet) {
  const wings = getSortedWings(fleet);
  if (wings.length === 0) {
    return { wingID: null, squadID: null };
  }
  const wing = wings[0];
  const squads = getSortedSquads(wing);
  return {
    wingID: wing.wingID,
    squadID: squads.length > 0 ? squads[0].squadID : null,
  };
}

function getSortedWings(fleet) {
  return [...fleet.wings.values()].sort((left, right) => left.wingID - right.wingID);
}

function getSortedSquads(wing) {
  return [...wing.squads.values()].sort((left, right) => left.squadID - right.squadID);
}

function getFleetMembersInWing(fleet, wingID, excludeCharacterID = 0) {
  const numericWingID = toInteger(wingID, 0);
  const excluded = toInteger(excludeCharacterID, 0);
  return [...fleet.members.values()].filter((member) => (
    member.charID !== excluded &&
    toInteger(member.wingID, 0) === numericWingID
  ));
}

function getFleetMembersInSquad(fleet, squadID, excludeCharacterID = 0) {
  const numericSquadID = toInteger(squadID, 0);
  const excluded = toInteger(excludeCharacterID, 0);
  return [...fleet.members.values()].filter((member) => (
    member.charID !== excluded &&
    toInteger(member.squadID, 0) === numericSquadID
  ));
}

function isSquadEmpty(fleet, squadID, excludeCharacterID = 0) {
  return getFleetMembersInSquad(fleet, squadID, excludeCharacterID).length === 0;
}

function isWingEmpty(fleet, wingID, excludeCharacterID = 0) {
  return getFleetMembersInWing(fleet, wingID, excludeCharacterID).length === 0;
}

function ensureFleetExists(fleetID) {
  const fleet = getFleetByID(fleetID);
  if (!fleet) {
    throwWrappedUserError("FleetNotFound");
  }
  return fleet;
}

function ensureFleetMembership(session, fleetID = null) {
  const characterID = getSessionCharacterID(session);
  const fleet = fleetID == null
    ? getFleetForCharacter(characterID)
    : ensureFleetExists(fleetID);
  if (!fleet || !fleet.members.has(characterID)) {
    throwWrappedUserError("FleetNotInFleet");
  }
  return fleet;
}

function ensureFleetBoss(session, fleetID = null) {
  const fleet = ensureFleetMembership(session, fleetID);
  const characterID = getSessionCharacterID(session);
  const member = getMemberRecord(fleet, characterID);
  if (!member || (member.job & FLEET.FLEET_JOB_CREATOR) === 0) {
    throwWrappedUserError("FleetNotCreator");
  }
  return fleet;
}

function ensureCommanderOrBoss(session, fleetID = null) {
  const fleet = ensureFleetMembership(session, fleetID);
  const characterID = getSessionCharacterID(session);
  const member = getMemberRecord(fleet, characterID);
  if (
    !member ||
    ((member.job & FLEET.FLEET_JOB_CREATOR) === 0 &&
      !FLEET.FLEET_CMDR_ROLES.includes(toInteger(member.role, 0)))
  ) {
    throwWrappedUserError("FleetNotCommanderOrBoss");
  }
  return fleet;
}

function collectFleetSessions(fleet, options = {}) {
  const sessions = [];
  for (const member of fleet.members.values()) {
    const session = findSessionByCharacterID(member.charID);
    if (!session) {
      continue;
    }
    if (options.excludeCharacterID && member.charID === options.excludeCharacterID) {
      continue;
    }
    sessions.push(session);
  }
  return sessions;
}

function notifySession(session, notificationName, payload, idType = "fleetid") {
  if (!session || typeof session.sendNotification !== "function") {
    return;
  }
  session.sendNotification(notificationName, idType, payload);
}

function resolveFleetInviteMessageName(msgName = null) {
  const normalized = normalizeText(msgName, "");
  if (normalized && normalized !== "FleetInvite") {
    return normalized;
  }
  return "CustomQuestion";
}

function buildMarshalDict(entries = []) {
  return {
    type: "dict",
    entries,
  };
}

function buildFleetInviteNotification(inviterCharID, options = {}) {
  const inviterRecord = resolveCharacterRecord(inviterCharID);
  const inviterName = normalizeText(
    inviterRecord.characterName,
    inviterCharID > 0 ? `Character ${inviterCharID}` : "another pilot",
  );
  const messageName = resolveFleetInviteMessageName(options.msgName);
  const autoAccept = Boolean(options.autoAccept);
  const header = normalizeText(options.header, "Fleet Invitation");
  const question = normalizeText(
    options.question,
    `${inviterName} has invited you to join their fleet.`,
  );
  return {
    msgName: messageName,
    msgDict: buildMarshalDict([
      ["autoAccept", autoAccept],
      ["header", header],
      ["question", question],
    ]),
  };
}

function notifyMoveFailed(session, characterID, isKicked = false) {
  notifySession(session, "OnFleetMoveFailed", [
    toInteger(characterID, 0),
    Boolean(isKicked),
  ], "fleetid");
}

function notifyFleet(fleet, notificationName, payload, options = {}) {
  for (const session of collectFleetSessions(fleet, {
    excludeCharacterID: options.excludeCharacterID || null,
  })) {
    notifySession(session, notificationName, payload, options.idType || "fleetid");
  }
}

function notifyAllLiveSessions(notificationName, payload, idType = "clientID", options = {}) {
  const excludedCharacterIDs = new Set(
    (Array.isArray(options.excludeCharacterIDs) ? options.excludeCharacterIDs : [])
      .map((value) => toInteger(value, 0))
      .filter((value) => value > 0),
  );
  for (const session of getSessions()) {
    const characterID = getSessionCharacterID(session);
    if (characterID > 0 && excludedCharacterIDs.has(characterID)) {
      continue;
    }
    notifySession(session, notificationName, payload, idType);
  }
}

function notifyFleetStateChanged(fleet) {
  notifyFleet(fleet, "OnFleetStateChange", [
    buildFleetStateChangePayload(fleet.fleetState || {}),
  ]);
}

function normalizeSessionFleetState(nextState = {}) {
  return {
    fleetid: nextState.fleetid ?? null,
    fleetrole: nextState.fleetrole ?? null,
    wingid: nextState.wingid ?? null,
    squadid: nextState.squadid ?? null,
  };
}

function setPendingFleetSessionState(session, nextState = {}) {
  if (!session) {
    return;
  }
  session._pendingFleetSessionState = normalizeSessionFleetState(nextState);
}

function consumePendingFleetSessionState(session) {
  if (!session || !session._pendingFleetSessionState) {
    return null;
  }
  const nextState = session._pendingFleetSessionState;
  session._pendingFleetSessionState = null;
  return nextState;
}

function applySessionFleetState(session, nextState = {}) {
  if (!session || typeof session.sendSessionChange !== "function") {
    return;
  }

  session._pendingFleetSessionState = null;
  const normalizedState = normalizeSessionFleetState(nextState);
  const previousState = {
    fleetid: session.fleetid ?? null,
    fleetrole: session.fleetrole ?? null,
    wingid: session.wingid ?? null,
    squadid: session.squadid ?? null,
  };

  session.fleetid = normalizedState.fleetid;
  session.fleetrole = normalizedState.fleetrole;
  session.wingid = normalizedState.wingid;
  session.squadid = normalizedState.squadid;

  const changes = {};
  for (const key of Object.keys(normalizedState)) {
    if (previousState[key] !== normalizedState[key]) {
      changes[key] = [previousState[key], normalizedState[key]];
    }
  }

  if (Object.keys(changes).length > 0) {
    session.sendSessionChange(changes);
  }
}

function updateCompositionCache(fleet) {
  fleet.compositionCache.expiresAtMs = 0;
  fleet.compositionCache.entries = [];
}

function applyAdvertLeaderChange(fleet, nextLeaderMember, nextLeaderSession = null) {
  if (!fleet || !fleet.advert || !fleet.options || !fleet.options.isRegistered) {
    return;
  }

  if (fleet.advert.updateOnBossChange === false) {
    const previousOptions = { ...fleet.options };
    fleet.advert = null;
    fleet.options.isRegistered = false;
    notifyFleet(fleet, "OnFleetOptionsChanged", [
      buildOptionsPayload(previousOptions),
      buildOptionsPayload({ ...fleet.options }),
    ]);
    return;
  }

  if (!nextLeaderMember) {
    return;
  }

  fleet.advert.leader = buildMemberSnapshot(
    nextLeaderMember.charID,
    nextLeaderSession || findSessionByCharacterID(nextLeaderMember.charID),
    nextLeaderMember,
  );
  fleet.advert.solarSystemID = getLeaderSolarSystemID(fleet);
  fleet.advert.advertTime = currentFileTime();
}

function syncMemberStateFromSession(fleet, characterID, session, overrides = {}) {
  const existing = getMemberRecord(fleet, characterID);
  if (!existing) {
    return null;
  }

  const snapshot = buildMemberSnapshot(characterID, session, {
    ...existing,
    ...overrides,
  });
  fleet.members.set(characterID, snapshot);
  if (fleet.advert && fleet.advert.leader && fleet.advert.leader.charID === characterID) {
    fleet.advert.leader = {
      ...fleet.advert.leader,
      corpID: snapshot.corpID,
      allianceID: snapshot.allianceID,
      warFactionID: snapshot.warFactionID,
      securityStatus: snapshot.securityStatus,
    };
    fleet.advert.solarSystemID = getLeaderSolarSystemID(fleet);
    fleet.advert.numMembers = fleet.members.size;
    fleet.advert.advertTime = currentFileTime();
  }
  updateCompositionCache(fleet);
  return snapshot;
}

function placeMemberInFleet(fleet, member, requestedWingID, requestedSquadID, requestedRole) {
  const role = toInteger(requestedRole, FLEET.FLEET_ROLE_MEMBER);
  const otherMembers = [...fleet.members.values()].filter((candidate) => (
    candidate.charID !== member.charID
  ));
  member.role = role;
  if (role === FLEET.FLEET_ROLE_LEADER) {
    if (otherMembers.some((candidate) => candidate.role === FLEET.FLEET_ROLE_LEADER)) {
      throwWrappedUserError("FleetError");
    }
    member.wingID = -1;
    member.squadID = -1;
    return member;
  }

  const resolvedWingID = requestedWingID != null
    ? toInteger(requestedWingID, 0)
    : (member.wingID > 0 ? member.wingID : null);
  const wing = fleet.wings.get(resolvedWingID) || null;
  if (!wing) {
    throwWrappedUserError("FleetNoPositionFound");
  }

  if (role === FLEET.FLEET_ROLE_WING_COMMANDER) {
    if (otherMembers.some((candidate) => (
      candidate.role === FLEET.FLEET_ROLE_WING_COMMANDER &&
      candidate.wingID === wing.wingID
    ))) {
      throwWrappedUserError("FleetError");
    }
    member.wingID = wing.wingID;
    member.squadID = -1;
    return member;
  }

  const resolvedSquadID = requestedSquadID != null
    ? toInteger(requestedSquadID, 0)
    : (member.squadID > 0 ? member.squadID : null);
  const squad = wing.squads.get(resolvedSquadID) || null;
  if (!squad) {
    throwWrappedUserError("FleetNoPositionFound");
  }

  const squadMembers = getFleetMembersInSquad(fleet, squad.squadID, member.charID);
  if (role === FLEET.FLEET_ROLE_SQUAD_COMMANDER) {
    if (squadMembers.some((candidate) => candidate.role === FLEET.FLEET_ROLE_SQUAD_COMMANDER)) {
      throwWrappedUserError("FleetError");
    }
  }
  if (squadMembers.length >= FLEET.MAX_MEMBERS_IN_SQUAD) {
    throwWrappedUserError("FleetError");
  }

  member.wingID = wing.wingID;
  member.squadID = squad.squadID;
  return member;
}

function findPlacementForRole(fleet, role) {
  const normalizedRole = toInteger(role, FLEET.FLEET_ROLE_MEMBER);
  if (normalizedRole === FLEET.FLEET_ROLE_LEADER) {
    return { wingID: -1, squadID: -1, role: normalizedRole };
  }

  const { wingID, squadID } = getFirstWingAndSquad(fleet);
  if (!wingID) {
    throwWrappedUserError("FleetNoPositionFound");
  }

  if (normalizedRole === FLEET.FLEET_ROLE_WING_COMMANDER) {
    return { wingID, squadID: -1, role: normalizedRole };
  }

  if (!squadID) {
    throwWrappedUserError("FleetNoPositionFound");
  }

  return { wingID, squadID, role: normalizedRole };
}

function initFleet(session, fleetID, options = {}) {
  const fleet = ensureFleetExists(fleetID);
  const characterID = getSessionCharacterID(session);
  if (!characterID) {
    throwWrappedUserError("FleetNotFound");
  }

  if (fleet.members.size > 0 && fleet.members.has(characterID)) {
    chatRuntime.ensureFleetChannel(fleet.fleetID, {
      motd: fleet.motd,
      metadata: {
        fleetID: fleet.fleetID,
      },
    });
    syncMemberStateFromSession(fleet, characterID, session, {
      shipTypeID: options.shipTypeID ?? getSessionShipTypeID(session),
    });
    return fleet.advert ? copyAdvert(fleet.advert) : null;
  }

  const member = buildMemberSnapshot(characterID, session, {
    role: FLEET.FLEET_ROLE_LEADER,
    job: FLEET.FLEET_JOB_CREATOR,
    memberOptOuts: buildMemberOptOuts(),
    shipTypeID: options.shipTypeID ?? getSessionShipTypeID(session),
  });
  fleet.members.set(characterID, member);
  fleet.creatorCharID = characterID;
  runtimeState.characterToFleet.set(characterID, fleet.fleetID);
  chatRuntime.ensureFleetChannel(fleet.fleetID, {
    motd: fleet.motd,
    metadata: {
      fleetID: fleet.fleetID,
      creatorCharID: characterID,
    },
  });
  applySessionFleetState(session, {
    fleetid: fleet.fleetID,
    fleetrole: FLEET.FLEET_ROLE_LEADER,
    wingid: null,
    squadid: null,
  });
  updateCompositionCache(fleet);

  const setupName = normalizeText(options.setupName, "").trim();
  if (setupName) {
    applyFleetSetup(session, fleet.fleetID, setupName);
  }

  const advertData = options.adInfoData || null;
  if (advertData) {
    fleet.advert = buildAdvertFromData(fleet, advertData);
    fleet.options.isRegistered = true;
    return copyAdvert(fleet.advert);
  }

  return null;
}

function buildFleetState(fleet) {
  return {
    fleetID: fleet.fleetID,
    members: new Map(fleet.members),
    wings: new Map(
      [...fleet.wings.entries()].map(([wingID, wing]) => [
        wingID,
        {
          wingID: wing.wingID,
          name: wing.name,
          squads: new Map(wing.squads),
        },
      ]),
    ),
    options: { ...fleet.options },
    motd: fleet.motd,
  };
}

function getFleetState(fleetID) {
  return buildFleetState(ensureFleetExists(fleetID));
}

function getWings(fleetID) {
  return buildFleetState(ensureFleetExists(fleetID)).wings;
}

function getMotd(fleetID) {
  return ensureFleetExists(fleetID).motd;
}

function getJoinRequests(fleetID) {
  return new Map(ensureFleetExists(fleetID).joinRequests);
}

function getFleetMaxSize(fleetID) {
  return ensureFleetExists(fleetID).maxSize;
}

function getFleetComposition(fleetID) {
  const fleet = ensureFleetExists(fleetID);
  const nowMs = Date.now();
  if (fleet.compositionCache.expiresAtMs > nowMs) {
    return fleet.compositionCache.entries.slice();
  }

  const entries = [];
  for (const member of fleet.members.values()) {
    entries.push({
      characterID: member.charID,
      solarSystemID: member.solarSystemID ?? null,
      stationID: member.stationID ?? null,
      shipTypeID: member.shipTypeID ?? null,
      skills: [],
      skillIDs: [],
    });
  }
  fleet.compositionCache.entries = entries;
  fleet.compositionCache.expiresAtMs = nowMs + FLEET.FLEETCOMPOSITION_CACHE_TIME_SEC * 1000;
  return entries.slice();
}

function getRespawnPoints(fleetID) {
  return cloneRespawnPoints(ensureFleetExists(fleetID).respawnPoints);
}

function setRespawnPoints(fleetID, respawnPoints, options = {}) {
  const fleet = ensureFleetExists(fleetID);
  fleet.respawnPoints = cloneRespawnPoints(respawnPoints);
  if (!options || options.notify !== false) {
    notifyFleet(fleet, "OnFleetRespawnPointsUpdate", [
      buildRespawnPointsPayload(fleet.respawnPoints),
    ]);
  }
  return cloneRespawnPoints(fleet.respawnPoints);
}

function getSessionFleetState(session) {
  const characterID = getSessionCharacterID(session);
  const fleet = getFleetForCharacter(characterID);
  if (!fleet) {
    return {
      fleetid: null,
      fleetrole: null,
      wingid: null,
      squadid: null,
    };
  }
  const member = getMemberRecord(fleet, characterID);
  return {
    fleetid: fleet.fleetID,
    fleetrole: member ? member.role : null,
    wingid: member && member.wingID > 0 ? member.wingID : null,
    squadid: member && member.squadID > 0 ? member.squadID : null,
  };
}

function getFleetHelpersSnapshot() {
  let targetTagCount = 0;
  let activeModuleBeaconCount = 0;
  let activeDeployableBeaconCount = 0;
  let activeBridgeCount = 0;
  for (const fleet of runtimeState.fleets.values()) {
    targetTagCount += fleet && fleet.fleetState && fleet.fleetState.targetTags instanceof Map
      ? fleet.fleetState.targetTags.size
      : 0;
    activeModuleBeaconCount += fleet && fleet.activeModuleBeacons instanceof Map
      ? fleet.activeModuleBeacons.size
      : 0;
    activeDeployableBeaconCount += fleet && fleet.activeDeployableBeacons instanceof Map
      ? fleet.activeDeployableBeacons.size
      : 0;
    activeBridgeCount += fleet && fleet.activeBridge instanceof Map
      ? fleet.activeBridge.size
      : 0;
  }

  return {
    fleetCount: runtimeState.fleets.size,
    characterCount: runtimeState.characterToFleet.size,
    targetTagCount,
    activeModuleBeaconCount,
    activeDeployableBeaconCount,
    activeBridgeCount,
  };
}

function setFleetTargetTag(session, itemID, tag) {
  const characterID = getSessionCharacterID(session);
  const fleet = getFleetForCharacter(characterID);
  if (!fleet) {
    return false;
  }

  const member = getMemberRecord(fleet, characterID);
  if (
    !member ||
    (
      (member.job & FLEET.FLEET_JOB_CREATOR) === 0 &&
      !FLEET.FLEET_CMDR_ROLES.includes(toInteger(member.role, 0))
    )
  ) {
    return false;
  }

  const numericItemID = toInteger(itemID, 0);
  if (numericItemID <= 0) {
    return false;
  }

  const targetTags = fleet.fleetState && fleet.fleetState.targetTags instanceof Map
    ? fleet.fleetState.targetTags
    : new Map();
  fleet.fleetState = fleet.fleetState || {};
  fleet.fleetState.targetTags = targetTags;

  const normalizedTag = normalizeFleetTag(tag);
  let changed = false;

  if (normalizedTag) {
    for (const [taggedItemID, taggedValue] of targetTags.entries()) {
      if (
        taggedItemID !== numericItemID &&
        normalizeText(taggedValue, "") === normalizedTag
      ) {
        targetTags.delete(taggedItemID);
        changed = true;
      }
    }

    if (normalizeText(targetTags.get(numericItemID), "") !== normalizedTag) {
      targetTags.set(numericItemID, normalizedTag);
      changed = true;
    }
  } else if (targetTags.delete(numericItemID)) {
    changed = true;
  }

  if (!changed) {
    return false;
  }

  notifyFleetStateChanged(fleet);
  return true;
}

function getTargetTagForCharacter(characterID, itemID) {
  const fleet = getFleetForCharacter(characterID);
  if (!fleet || !fleet.fleetState || !(fleet.fleetState.targetTags instanceof Map)) {
    return null;
  }
  return normalizeFleetTag(fleet.fleetState.targetTags.get(toInteger(itemID, 0)));
}

function setBridgeMode(fleetID, shipID, solarsystemID, itemID, active) {
  const fleet = ensureFleetExists(fleetID);
  const numericShipID = toInteger(shipID, 0);
  if (numericShipID <= 0) {
    return false;
  }

  if (toBoolean(active, false)) {
    fleet.activeBridge.set(numericShipID, [
      toOptionalInteger(solarsystemID, null),
      toOptionalInteger(itemID, null),
    ]);
  } else {
    fleet.activeBridge.delete(numericShipID);
  }

  notifyFleet(fleet, "OnBridgeModeChange", [
    numericShipID,
    toOptionalInteger(solarsystemID, null),
    toOptionalInteger(itemID, null),
    toBoolean(active, false),
  ]);
  return true;
}

function setJumpBeaconModuleState(fleetID, charID, solarsystemID, beaconID, typeID, active) {
  const fleet = ensureFleetExists(fleetID);
  const numericCharID = toInteger(charID, 0);
  if (numericCharID <= 0) {
    return false;
  }

  if (toBoolean(active, false)) {
    fleet.activeModuleBeacons.set(numericCharID, [
      toOptionalInteger(solarsystemID, null),
      toOptionalInteger(beaconID, null),
      toOptionalInteger(typeID, null),
    ]);
  } else {
    fleet.activeModuleBeacons.delete(numericCharID);
  }

  notifyFleet(fleet, "OnFleetJumpBeaconModuleChange", [
    numericCharID,
    toOptionalInteger(solarsystemID, null),
    toOptionalInteger(beaconID, null),
    toOptionalInteger(typeID, null),
    toBoolean(active, false),
  ]);
  return true;
}

function setJumpBeaconDeployableState(fleetID, deployableID, solarsystemID, beaconID, ownerID, active) {
  const fleet = ensureFleetExists(fleetID);
  const numericDeployableID = toInteger(deployableID, 0);
  if (numericDeployableID <= 0) {
    return false;
  }

  if (toBoolean(active, false)) {
    fleet.activeDeployableBeacons.set(numericDeployableID, [
      toOptionalInteger(solarsystemID, null),
      toOptionalInteger(beaconID, null),
      toOptionalInteger(ownerID, null),
    ]);
  } else {
    fleet.activeDeployableBeacons.delete(numericDeployableID);
  }

  notifyFleet(fleet, "OnFleetJumpBeaconDeployableChange", [
    numericDeployableID,
    toOptionalInteger(solarsystemID, null),
    toOptionalInteger(beaconID, null),
    toOptionalInteger(ownerID, null),
    toBoolean(active, false),
  ]);
  return true;
}

function getActiveBeaconForCharacter(characterID) {
  const fleet = getFleetForCharacter(characterID);
  if (!fleet || !(fleet.activeModuleBeacons instanceof Map)) {
    return null;
  }
  const entry = fleet.activeModuleBeacons.get(toInteger(characterID, 0)) || null;
  return Array.isArray(entry) ? entry.slice() : null;
}

function hasActiveBeaconForCharacter(characterID) {
  return Boolean(getActiveBeaconForCharacter(characterID));
}

function getActiveBeaconsForCharacter(characterID) {
  const fleet = getFleetForCharacter(characterID);
  return fleet && fleet.activeModuleBeacons instanceof Map
    ? new Map(
        [...fleet.activeModuleBeacons.entries()].map(([key, value]) => [
          key,
          Array.isArray(value) ? value.slice() : value,
        ]),
      )
    : new Map();
}

function getActiveBridgeForCharacter(characterID, shipID) {
  const fleet = getFleetForCharacter(characterID);
  if (!fleet || !(fleet.activeBridge instanceof Map)) {
    return null;
  }
  const entry = fleet.activeBridge.get(toInteger(shipID, 0)) || null;
  return Array.isArray(entry) ? entry.slice() : null;
}

function recordLootEventsForSession(session, lootEntries = []) {
  const characterID = getSessionCharacterID(session);
  const fleet = getFleetForCharacter(characterID);
  if (!fleet) {
    return false;
  }

  const payloadEntries = new Map();
  for (const entry of Array.isArray(lootEntries) ? lootEntries : []) {
    const typeID = toInteger(entry && entry.typeID, 0);
    const quantity = Math.max(1, toInteger(entry && entry.quantity, 0));
    if (typeID <= 0 || quantity <= 0) {
      continue;
    }

    const key = `${characterID}:${typeID}`;
    payloadEntries.set(key, (payloadEntries.get(key) || 0) + quantity);
  }

  if (payloadEntries.size <= 0) {
    return false;
  }

  notifyFleet(fleet, "OnFleetLootEvent", [
    buildLootEventsPayload(payloadEntries),
  ]);
  return true;
}

function createInviteRecord(fleet, inviterCharID, inviteeCharID, placement = {}, options = {}) {
  const record = {
    fleetID: fleet.fleetID,
    inviterCharID,
    inviteeCharID,
    role: placement.role ?? FLEET.FLEET_ROLE_MEMBER,
    wingID: placement.wingID ?? null,
    squadID: placement.squadID ?? null,
    autoAccept: Boolean(options.autoAccept),
    createdAtMs: Date.now(),
  };
  runtimeState.invitesByCharacter.set(inviteeCharID, record);
  return record;
}

function clearInvite(characterID) {
  runtimeState.invitesByCharacter.delete(toInteger(characterID, 0));
}

function inviteCharacter(session, fleetID, inviteeCharID, wingID, squadID, role, options = {}) {
  const fleet = ensureFleetMembership(session, fleetID);
  const inviterCharID = getSessionCharacterID(session);
  const normalizedInvitee = toInteger(inviteeCharID, 0);
  if (!normalizedInvitee || normalizedInvitee === inviterCharID) {
    return false;
  }
  if (getFleetForCharacter(normalizedInvitee)) {
    throwWrappedUserError("FleetError");
  }

  const placement = findPlacementForRole(fleet, role);
  if (wingID != null) {
    placement.wingID = toInteger(wingID, placement.wingID);
  }
  if (squadID != null) {
    placement.squadID = toInteger(squadID, placement.squadID);
  }
  createInviteRecord(fleet, inviterCharID, normalizedInvitee, placement, options);

  const inviteeSession = findSessionByCharacterID(normalizedInvitee);
  if (inviteeSession) {
    const notification = buildFleetInviteNotification(inviterCharID, options);
    notifySession(inviteeSession, "OnFleetInvite", [
      fleet.fleetID,
      inviterCharID,
      notification.msgName,
      notification.msgDict,
    ], "clientID");
  }

  return true;
}

function acceptInvite(session, fleetID, shipTypeID = null) {
  const characterID = getSessionCharacterID(session);
  if (!characterID) {
    throwWrappedUserError("FleetNotFound");
  }

  const invite = getInviteForCharacter(characterID);
  if (!invite || toInteger(invite.fleetID, 0) !== toInteger(fleetID, 0)) {
    throwWrappedUserError("FleetNotFound");
  }

  const fleet = ensureFleetExists(fleetID);
  if (fleet.members.size >= Math.min(fleet.maxSize, FLEET.MAX_MEMBERS_IN_FLEET)) {
    clearInvite(characterID);
    throwWrappedUserError("FleetTooManyMembers");
  }

  const placement = {
    role: invite.role,
    wingID: invite.wingID,
    squadID: invite.squadID,
  };
  const member = buildMemberSnapshot(characterID, session, {
    role: placement.role,
    wingID: placement.wingID,
    squadID: placement.squadID,
    shipTypeID: shipTypeID ?? getSessionShipTypeID(session),
  });
  placeMemberInFleet(fleet, member, placement.wingID, placement.squadID, placement.role);
  fleet.members.set(characterID, member);
  runtimeState.characterToFleet.set(characterID, fleet.fleetID);
  clearInvite(characterID);
  chatRuntime.ensureFleetChannel(fleet.fleetID, {
    motd: fleet.motd,
    metadata: {
      fleetID: fleet.fleetID,
    },
  });

  if (fleet.joinRequests.has(characterID)) {
    fleet.joinRequests.delete(characterID);
    const bossSession = findSessionByCharacterID(getBossCharacterID(fleet));
    if (bossSession) {
      notifySession(
        bossSession,
        "OnJoinRequestUpdate",
        [buildJoinRequestsPayload(fleet.joinRequests)],
        "fleetid",
      );
    }
  }

  applySessionFleetState(session, {
    fleetid: fleet.fleetID,
    fleetrole: member.role,
    wingid: member.wingID > 0 ? member.wingID : null,
    squadid: member.squadID > 0 ? member.squadID : null,
  });
  updateCompositionCache(fleet);
  if (fleet.advert) {
    fleet.advert.numMembers = fleet.members.size;
    fleet.advert.advertTime = currentFileTime();
  }
  notifyFleet(fleet, "OnFleetJoin", [buildMemberPayload(member)], {
    excludeCharacterID: characterID,
  });
  return true;
}

function rejectInvite(session, fleetID, alreadyInFleet = false) {
  const characterID = getSessionCharacterID(session);
  const invite = getInviteForCharacter(characterID);
  if (!invite || toInteger(invite.fleetID, 0) !== toInteger(fleetID, 0)) {
    return false;
  }
  clearInvite(characterID);
  const inviterSession = findSessionByCharacterID(invite.inviterCharID);
  if (inviterSession) {
    notifySession(inviterSession, "OnFleetJoinReject", [
      characterID,
      alreadyInFleet
        ? FLEET.REJECT_INVITE_ALREADY_IN_FLEET
        : FLEET.REJECT_INVITE_TIMEOUT,
    ], "fleetid");
  }
  return true;
}

function reconnectCharacter(session, fleetID) {
  const characterID = getSessionCharacterID(session);
  const fleet = ensureFleetExists(fleetID);
  const member = getMemberRecord(fleet, characterID);
  if (!member) {
    throwWrappedUserError("FleetNotFound");
  }
  syncMemberStateFromSession(fleet, characterID, session);
  applySessionFleetState(session, {
    fleetid: fleet.fleetID,
    fleetrole: member.role,
    wingid: member.wingID > 0 ? member.wingID : null,
    squadid: member.squadID > 0 ? member.squadID : null,
  });
  return true;
}

function removeMemberFromFleet(fleet, characterID, options = {}) {
  const normalizedCharacterID = toInteger(characterID, 0);
  const removedMember = fleet.members.get(normalizedCharacterID) || null;
  if (!removedMember) {
    return false;
  }

  fleet.members.delete(normalizedCharacterID);
  runtimeState.characterToFleet.delete(normalizedCharacterID);
  fleet.watchlists.delete(normalizedCharacterID);
  fleet.activeModuleBeacons.delete(normalizedCharacterID);
  if (removedMember && toOptionalInteger(removedMember.shipID, null)) {
    fleet.activeBridge.delete(toInteger(removedMember.shipID, 0));
  }
  updateCompositionCache(fleet);
  if (fleet.advert) {
    fleet.advert.numMembers = fleet.members.size;
    fleet.advert.advertTime = currentFileTime();
  }

  const targetSession = options.targetSession || findSessionByCharacterID(normalizedCharacterID);
  if (targetSession) {
    applySessionFleetState(targetSession, {
      fleetid: null,
      fleetrole: null,
      wingid: null,
      squadid: null,
    });
  }

  if (!options.suppressNotification) {
    notifyFleet(fleet, "OnFleetLeave", [normalizedCharacterID]);
    if (targetSession) {
      notifySession(targetSession, "OnFleetLeave", [normalizedCharacterID], "fleetid");
    }
  }

  return true;
}

function destroyFleet(fleet, options = {}) {
  const affectedCharacterIDs = [...fleet.members.keys()];
  const hadRegisteredAdvert = Boolean(
    fleet &&
    fleet.advert &&
    fleet.options &&
    fleet.options.isRegistered,
  );
  for (const characterID of affectedCharacterIDs) {
    const session = findSessionByCharacterID(characterID);
    if (session) {
      applySessionFleetState(session, {
        fleetid: null,
        fleetrole: null,
        wingid: null,
        squadid: null,
      });
    }
    runtimeState.characterToFleet.delete(characterID);
    fleet.watchlists.delete(characterID);
  }

  for (const [inviteeCharID, invite] of runtimeState.invitesByCharacter.entries()) {
    if (invite && invite.fleetID === fleet.fleetID) {
      runtimeState.invitesByCharacter.delete(inviteeCharID);
    }
  }

  runtimeState.fleets.delete(fleet.fleetID);
  chatRuntime.deleteChannel(`fleet_${fleet.fleetID}`);
  if (!options.suppressNotification) {
    notifyFleet(fleet, "OnFleetDisbanded", [affectedCharacterIDs]);
    if (hadRegisteredAdvert) {
      notifyAllLiveSessions("OnMemberlessFleetUnregistered", [], "clientID");
    }
  }
}

function leaveFleet(session, fleetID = null) {
  const fleet = ensureFleetMembership(session, fleetID);
  const characterID = getSessionCharacterID(session);
  const wasBoss = getBossCharacterID(fleet) === characterID;
  if (fleet.members.size <= 1) {
    destroyFleet(fleet);
    return true;
  }

  removeMemberFromFleet(fleet, characterID, {
    targetSession: session,
  });

  if (wasBoss) {
    const replacementMember = [...fleet.members.values()].sort((left, right) => left.charID - right.charID)[0];
    if (replacementMember) {
      replacementMember.job = FLEET.FLEET_JOB_CREATOR;
      replacementMember.role = FLEET.FLEET_ROLE_LEADER;
      replacementMember.wingID = -1;
      replacementMember.squadID = -1;
      const replacementSession = findSessionByCharacterID(replacementMember.charID);
      if (replacementSession) {
        applySessionFleetState(replacementSession, {
          fleetid: fleet.fleetID,
          fleetrole: replacementMember.role,
          wingid: null,
          squadid: null,
        });
      }
      notifyFleet(fleet, "OnFleetMemberChanged", [
        replacementMember.charID,
        fleet.fleetID,
        -1,
        -1,
        FLEET.FLEET_ROLE_MEMBER,
        FLEET.FLEET_JOB_NONE,
        buildMemberOptOutsPayload(buildMemberOptOuts()),
        -1,
        -1,
        replacementMember.role,
        replacementMember.job,
        buildMemberOptOutsPayload(cloneMemberOptOuts(replacementMember.memberOptOuts)),
        false,
      ]);
      applyAdvertLeaderChange(fleet, replacementMember, replacementSession);
    }
  }

  return true;
}

function forceLeaveFleet(session) {
  const characterID = getSessionCharacterID(session);
  const fleet = getFleetForCharacter(characterID);
  if (!fleet) {
    applySessionFleetState(session, {
      fleetid: null,
      fleetrole: null,
      wingid: null,
      squadid: null,
    });
    return true;
  }

  return leaveFleet(session, fleet.fleetID);
}

function updateMemberPlacement(fleet, member, newWingID, newSquadID, newRole) {
  const oldState = {
    wingID: member.wingID,
    squadID: member.squadID,
    role: member.role,
    job: member.job,
    memberOptOuts: cloneMemberOptOuts(member.memberOptOuts),
  };
  placeMemberInFleet(fleet, member, newWingID, newSquadID, newRole);
  if (member.role === FLEET.FLEET_ROLE_LEADER) {
    member.job = FLEET.FLEET_JOB_CREATOR;
  } else if ((member.job & FLEET.FLEET_JOB_CREATOR) !== 0) {
    member.job = FLEET.FLEET_JOB_NONE;
  }
  return oldState;
}

function notifyMemberChanged(fleet, member, oldState, isOnlyMember = false) {
  const targetSession = findSessionByCharacterID(member.charID);
  const placementChanged =
    oldState.wingID !== member.wingID ||
    oldState.squadID !== member.squadID ||
    oldState.role !== member.role ||
    oldState.job !== member.job;
  if (targetSession) {
    if (placementChanged) {
      setPendingFleetSessionState(targetSession, {
        fleetid: fleet.fleetID,
        fleetrole: member.role,
        wingid: member.wingID > 0 ? member.wingID : null,
        squadid: member.squadID > 0 ? member.squadID : null,
      });
    }
  }
  notifyFleet(fleet, "OnFleetMemberChanged", [
    member.charID,
    fleet.fleetID,
    oldState.wingID,
    oldState.squadID,
    oldState.role,
    oldState.job,
    buildMemberOptOutsPayload(oldState.memberOptOuts),
    member.wingID,
    member.squadID,
    member.role,
    member.job,
    buildMemberOptOutsPayload(cloneMemberOptOuts(member.memberOptOuts)),
    Boolean(isOnlyMember),
  ]);
  if (targetSession && placementChanged) {
    notifySession(targetSession, "OnFleetMove", [], "fleetid");
  }
}

function moveMember(session, fleetID, characterID, wingID, squadID, role) {
  const fleet = ensureCommanderOrBoss(session, fleetID);
  const member = getMemberRecord(fleet, characterID);
  if (!member) {
    throwWrappedUserError("FleetNotFound");
  }
  try {
    const oldState = updateMemberPlacement(
      fleet,
      member,
      wingID,
      squadID,
      role,
    );
    notifyMemberChanged(fleet, member, oldState, fleet.members.size === 1);
    return true;
  } catch (error) {
    notifyMoveFailed(session, characterID, false);
    return false;
  }
}

function massMoveMembers(session, fleetID, characterIDs, wingID, squadID, role) {
  const fleet = ensureCommanderOrBoss(session, fleetID);
  const movedCharacterIDs = [];
  for (const rawCharacterID of Array.isArray(characterIDs) ? characterIDs : []) {
    const characterID = toInteger(rawCharacterID, 0);
    const member = getMemberRecord(fleet, characterID);
    if (!member) {
      continue;
    }
    try {
      const oldState = updateMemberPlacement(
        fleet,
        member,
        wingID,
        squadID,
        role,
      );
      notifyMemberChanged(fleet, member, oldState, fleet.members.size === 1);
      movedCharacterIDs.push(characterID);
    } catch (error) {
      notifyMoveFailed(session, characterID, false);
    }
  }
  return movedCharacterIDs;
}

function finishMove(session, fleetID) {
  const pendingState = consumePendingFleetSessionState(session);
  if (pendingState) {
    applySessionFleetState(session, pendingState);
    return true;
  }
  ensureFleetMembership(session, fleetID);
  return true;
}

function kickMember(session, fleetID, characterID) {
  const fleet = ensureCommanderOrBoss(session, fleetID);
  const numericCharacterID = toInteger(characterID, 0);
  if (!fleet.members.has(numericCharacterID)) {
    return false;
  }
  if (fleet.members.size <= 1) {
    destroyFleet(fleet);
    return true;
  }
  removeMemberFromFleet(fleet, numericCharacterID);
  return true;
}

function makeLeader(session, fleetID, characterID) {
  const fleet = ensureFleetBoss(session, fleetID);
  const currentBoss = getBossMember(fleet);
  const target = getMemberRecord(fleet, characterID);
  if (!target) {
    throwWrappedUserError("FleetNotFound");
  }
  if (currentBoss && currentBoss.charID === target.charID) {
    return true;
  }

  if (currentBoss) {
    const oldBossState = {
      wingID: currentBoss.wingID,
      squadID: currentBoss.squadID,
      role: currentBoss.role,
      job: currentBoss.job,
      memberOptOuts: cloneMemberOptOuts(currentBoss.memberOptOuts),
    };
    currentBoss.job = FLEET.FLEET_JOB_NONE;
    if (currentBoss.role === FLEET.FLEET_ROLE_LEADER) {
      currentBoss.role = FLEET.FLEET_ROLE_MEMBER;
    }
    notifyMemberChanged(fleet, currentBoss, oldBossState, fleet.members.size === 1);
  }

  const targetOldState = {
    wingID: target.wingID,
    squadID: target.squadID,
    role: target.role,
    job: target.job,
    memberOptOuts: cloneMemberOptOuts(target.memberOptOuts),
  };
  target.job = FLEET.FLEET_JOB_CREATOR;
  target.role = FLEET.FLEET_ROLE_LEADER;
  target.wingID = -1;
  target.squadID = -1;
  notifyMemberChanged(fleet, target, targetOldState, fleet.members.size === 1);
  applyAdvertLeaderChange(fleet, target, findSessionByCharacterID(target.charID));
  return true;
}

function disbandFleet(session, fleetID) {
  const fleet = ensureFleetBoss(session, fleetID);
  destroyFleet(fleet);
  return true;
}

function createWing(session, fleetID) {
  const fleet = ensureFleetBoss(session, fleetID);
  if (fleet.wings.size >= FLEET.MAX_WINGS_IN_FLEET) {
    throwWrappedUserError("FleetError");
  }
  const wingID = allocateWingID(fleet);
  fleet.wings.set(wingID, {
    wingID,
    name: "",
    squads: new Map(),
  });
  notifyFleet(fleet, "OnFleetWingAdded", [wingID]);
  return wingID;
}

function deleteWing(session, fleetID, wingID) {
  const fleet = ensureFleetBoss(session, fleetID);
  const numericWingID = toInteger(wingID, 0);
  const wing = fleet.wings.get(numericWingID);
  if (!wing) {
    throwWrappedUserError("FleetNotFound");
  }

  for (const member of fleet.members.values()) {
    if (member.wingID === numericWingID) {
      throwWrappedUserError("FleetError");
    }
  }

  const previousOptions = { ...fleet.options };
  if (fleet.options.autoJoinSquadID) {
    for (const squad of wing.squads.values()) {
      if (squad.squadID === fleet.options.autoJoinSquadID) {
        fleet.options.autoJoinSquadID = null;
        break;
      }
    }
  }
  fleet.wings.delete(numericWingID);
  notifyFleet(fleet, "OnFleetWingDeleted", [numericWingID]);
  if (previousOptions.autoJoinSquadID !== fleet.options.autoJoinSquadID) {
    notifyFleet(fleet, "OnFleetOptionsChanged", [
      buildOptionsPayload(previousOptions),
      buildOptionsPayload({ ...fleet.options }),
    ]);
  }
  return true;
}

function changeWingName(session, fleetID, wingID, name) {
  const fleet = ensureFleetBoss(session, fleetID);
  const wing = fleet.wings.get(toInteger(wingID, 0));
  if (!wing) {
    throwWrappedUserError("FleetNotFound");
  }
  wing.name = normalizeText(name, "").slice(0, FLEET.MAX_NAME_LENGTH);
  notifyFleet(fleet, "OnFleetWingNameChanged", [wing.wingID, wing.name]);
  return true;
}

function createSquad(session, fleetID, wingID) {
  const fleet = ensureCommanderOrBoss(session, fleetID);
  const wing = fleet.wings.get(toInteger(wingID, 0));
  if (!wing) {
    throwWrappedUserError("FleetNotFound");
  }
  if (wing.squads.size >= FLEET.MAX_SQUADS_IN_WING) {
    throwWrappedUserError("FleetError");
  }
  const squadID = allocateSquadID(fleet);
  wing.squads.set(squadID, {
    squadID,
    name: "",
  });
  notifyFleet(fleet, "OnFleetSquadAdded", [wing.wingID, squadID]);
  return squadID;
}

function deleteSquad(session, fleetID, squadID) {
  const fleet = ensureCommanderOrBoss(session, fleetID);
  const numericSquadID = toInteger(squadID, 0);
  let ownerWing = null;
  for (const wing of fleet.wings.values()) {
    if (wing.squads.has(numericSquadID)) {
      ownerWing = wing;
      break;
    }
  }
  if (!ownerWing) {
    throwWrappedUserError("FleetNotFound");
  }
  for (const member of fleet.members.values()) {
    if (member.squadID === numericSquadID) {
      throwWrappedUserError("FleetError");
    }
  }
  const previousOptions = { ...fleet.options };
  ownerWing.squads.delete(numericSquadID);
  if (fleet.options.autoJoinSquadID === numericSquadID) {
    fleet.options.autoJoinSquadID = null;
  }
  notifyFleet(fleet, "OnFleetSquadDeleted", [numericSquadID]);
  if (previousOptions.autoJoinSquadID !== fleet.options.autoJoinSquadID) {
    notifyFleet(fleet, "OnFleetOptionsChanged", [
      buildOptionsPayload(previousOptions),
      buildOptionsPayload({ ...fleet.options }),
    ]);
  }
  return true;
}

function changeSquadName(session, fleetID, squadID, name) {
  const fleet = ensureCommanderOrBoss(session, fleetID);
  const numericSquadID = toInteger(squadID, 0);
  let squad = null;
  for (const wing of fleet.wings.values()) {
    squad = wing.squads.get(numericSquadID) || null;
    if (squad) {
      break;
    }
  }
  if (!squad) {
    throwWrappedUserError("FleetNotFound");
  }
  squad.name = normalizeText(name, "").slice(0, FLEET.MAX_NAME_LENGTH);
  notifyFleet(fleet, "OnFleetSquadNameChanged", [numericSquadID, squad.name]);
  return true;
}

function setOptions(session, fleetID, nextOptions = {}) {
  const fleet = ensureFleetBoss(session, fleetID);
  const oldOptions = { ...fleet.options };
  if (Object.prototype.hasOwnProperty.call(nextOptions, "isFreeMove")) {
    fleet.options.isFreeMove = toBoolean(nextOptions.isFreeMove, fleet.options.isFreeMove);
  }
  if (Object.prototype.hasOwnProperty.call(nextOptions, "isRegistered")) {
    fleet.options.isRegistered = toBoolean(nextOptions.isRegistered, fleet.options.isRegistered);
  }
  if (Object.prototype.hasOwnProperty.call(nextOptions, "autoJoinSquadID")) {
    fleet.options.autoJoinSquadID = toOptionalInteger(nextOptions.autoJoinSquadID, null);
  }
  notifyFleet(fleet, "OnFleetOptionsChanged", [
    buildOptionsPayload(oldOptions),
    buildOptionsPayload({ ...fleet.options }),
  ]);
  return true;
}

function setAutoJoinSquadID(session, fleetID, squadID) {
  const fleet = ensureFleetBoss(session, fleetID);
  const previousOptions = { ...fleet.options };
  fleet.options.autoJoinSquadID = toOptionalInteger(squadID, null);
  notifyFleet(fleet, "OnFleetOptionsChanged", [
    buildOptionsPayload(previousOptions),
    buildOptionsPayload({ ...fleet.options }),
  ]);
  return true;
}

function setFleetMaxSize(session, fleetID, maxSize) {
  const fleet = ensureFleetBoss(session, fleetID);
  fleet.maxSize = Math.max(1, Math.min(
    FLEET.MAX_MEMBERS_IN_FLEET,
    toInteger(maxSize, FLEET.MAX_MEMBERS_IN_FLEET),
  ));
  return fleet.maxSize;
}

function setMotd(session, fleetID, motd) {
  const fleet = ensureFleetMembership(session, fleetID);
  fleet.motd = normalizeText(motd, "");
  chatRuntime.setChannelMotd(`fleet_${fleet.fleetID}`, fleet.motd, {
    metadata: {
      fleetID: fleet.fleetID,
    },
  });
  notifyFleet(fleet, "OnFleetMotdChanged", [fleet.motd, true]);
  return true;
}

function setMemberOptOut(session, fleetID, key, nextValue) {
  const fleet = ensureFleetMembership(session, fleetID);
  const characterID = getSessionCharacterID(session);
  const member = getMemberRecord(fleet, characterID);
  if (!member) {
    throwWrappedUserError("FleetNotFound");
  }
  const oldState = {
    wingID: member.wingID,
    squadID: member.squadID,
    role: member.role,
    job: member.job,
    memberOptOuts: cloneMemberOptOuts(member.memberOptOuts),
  };
  member.memberOptOuts[key] = toBoolean(nextValue, true);
  notifyMemberChanged(fleet, member, oldState, fleet.members.size === 1);
  return true;
}

function updateMemberInfo(session, fleetID, shipTypeID = null) {
  const fleet = ensureFleetMembership(session, fleetID);
  const characterID = getSessionCharacterID(session);
  syncMemberStateFromSession(fleet, characterID, session, {
    shipTypeID: shipTypeID ?? getSessionShipTypeID(session),
    solarSystemID: getSessionSolarSystemID(session),
    stationID: getSessionStationID(session),
  });
  return true;
}

function getSavedFleetSetup(characterID, setupName) {
  return getFleetSetupByName(
    getCharacterSetting(characterID, "fleetSetups", null),
    setupName,
  );
}

function resolveSetupTargetSquad(fleet, defaultSquadSetting) {
  if (!Array.isArray(defaultSquadSetting) || defaultSquadSetting.length < 2) {
    return null;
  }

  const targetWingName = normalizeText(defaultSquadSetting[0], "").toLowerCase();
  const squadIndex = toInteger(defaultSquadSetting[1], -1);
  if (squadIndex < 0) {
    return null;
  }

  const targetWing = getSortedWings(fleet).find((wing) => (
    normalizeText(wing.name, "").toLowerCase() === targetWingName
  ));
  if (!targetWing) {
    return null;
  }

  return getSortedSquads(targetWing)[squadIndex] || null;
}

function applyFleetSetup(session, fleetID, setupName) {
  const fleet = ensureFleetBoss(session, fleetID);
  const characterID = getSessionCharacterID(session);
  const setup = getSavedFleetSetup(characterID, setupName);
  if (!setup) {
    throwWrappedUserError("FleetError");
  }

  const desiredWings = Array.isArray(setup.wings) ? setup.wings : [];
  while (getSortedWings(fleet).length < desiredWings.length) {
    createWing(session, fleet.fleetID);
  }

  let currentWings = getSortedWings(fleet);
  for (let wingIndex = 0; wingIndex < desiredWings.length; wingIndex += 1) {
    const desiredWing = desiredWings[wingIndex];
    const currentWing = currentWings[wingIndex];
    if (!currentWing) {
      break;
    }

    const desiredWingName = normalizeText(desiredWing.wingName, "").slice(0, FLEET.MAX_NAME_LENGTH);
    if (normalizeText(currentWing.name, "") !== desiredWingName) {
      changeWingName(session, fleet.fleetID, currentWing.wingID, desiredWingName);
    }

    while (getSortedSquads(currentWing).length < desiredWing.squadNames.length) {
      createSquad(session, fleet.fleetID, currentWing.wingID);
    }

    const currentSquads = getSortedSquads(currentWing);
    for (let squadIndex = 0; squadIndex < desiredWing.squadNames.length; squadIndex += 1) {
      const desiredSquadName = normalizeText(
        desiredWing.squadNames[squadIndex],
        "",
      ).slice(0, FLEET.MAX_NAME_LENGTH);
      const currentSquad = currentSquads[squadIndex];
      if (currentSquad && normalizeText(currentSquad.name, "") !== desiredSquadName) {
        changeSquadName(session, fleet.fleetID, currentSquad.squadID, desiredSquadName);
      }
    }

    for (let squadIndex = currentSquads.length - 1; squadIndex >= desiredWing.squadNames.length; squadIndex -= 1) {
      const currentSquad = currentSquads[squadIndex];
      if (!currentSquad) {
        continue;
      }
      if (!isSquadEmpty(fleet, currentSquad.squadID)) {
        continue;
      }
      deleteSquad(session, fleet.fleetID, currentSquad.squadID);
    }
  }

  currentWings = getSortedWings(fleet);
  for (let wingIndex = currentWings.length - 1; wingIndex >= desiredWings.length; wingIndex -= 1) {
    const currentWing = currentWings[wingIndex];
    if (!currentWing) {
      continue;
    }
    if (!isWingEmpty(fleet, currentWing.wingID)) {
      continue;
    }
    deleteWing(session, fleet.fleetID, currentWing.wingID);
  }

  if (setup.defaultSquad !== undefined) {
    const targetSquad = resolveSetupTargetSquad(fleet, setup.defaultSquad);
    setAutoJoinSquadID(session, fleet.fleetID, targetSquad ? targetSquad.squadID : null);
  }
  if (setup.motd !== undefined) {
    setMotd(session, fleet.fleetID, setup.motd);
  }
  if (setup.isFreeMove !== undefined) {
    setOptions(session, fleet.fleetID, { isFreeMove: Boolean(setup.isFreeMove) });
  }
  if (setup.maxFleetSize !== undefined && setup.maxFleetSize > 0) {
    setFleetMaxSize(session, fleet.fleetID, setup.maxFleetSize);
  }

  log.info(`[Fleet] Applied fleet setup "${setup.setupName}" to fleet ${fleet.fleetID}`);
  return true;
}

function loadFleetSetup(session, fleetID, setupName) {
  ensureFleetBoss(session, fleetID);
  log.info(`[Fleet] LoadFleetSetup requested for ${fleetID} name="${normalizeText(setupName, "")}"`);
  return applyFleetSetup(session, fleetID, setupName);
}

function addToWatchlist(session, characterIDs, favorites) {
  const fleet = ensureFleetMembership(session);
  const viewerCharID = getSessionCharacterID(session);
  const watchlist = new Set();
  for (const rawCharacterID of Array.isArray(favorites) ? favorites : []) {
    const characterID = toInteger(rawCharacterID, 0);
    if (characterID > 0 && fleet.members.has(characterID)) {
      watchlist.add(characterID);
    }
    if (watchlist.size >= FLEET.MAX_DAMAGE_SENDERS) {
      break;
    }
  }
  for (const rawCharacterID of Array.isArray(characterIDs) ? characterIDs : []) {
    const characterID = toInteger(rawCharacterID, 0);
    if (characterID > 0 && fleet.members.has(characterID)) {
      watchlist.add(characterID);
    }
    if (watchlist.size >= FLEET.MAX_DAMAGE_SENDERS) {
      break;
    }
  }
  fleet.watchlists.set(viewerCharID, watchlist);
  return true;
}

function removeFromWatchlist(session, characterID, favorites) {
  const fleet = ensureFleetMembership(session);
  const viewerCharID = getSessionCharacterID(session);
  const watchlist = new Set();
  for (const rawCharacterID of Array.isArray(favorites) ? favorites : []) {
    const numericCharacterID = toInteger(rawCharacterID, 0);
    if (numericCharacterID > 0 && fleet.members.has(numericCharacterID)) {
      watchlist.add(numericCharacterID);
    }
  }
  watchlist.delete(toInteger(characterID, 0));
  fleet.watchlists.set(viewerCharID, watchlist);
  return true;
}

function registerForDamageUpdates(session, favorites) {
  const fleet = ensureFleetMembership(session);
  const viewerCharID = getSessionCharacterID(session);
  const watchlist = new Set();
  for (const rawCharacterID of Array.isArray(favorites) ? favorites : []) {
    const characterID = toInteger(rawCharacterID, 0);
    if (characterID > 0 && fleet.members.has(characterID)) {
      watchlist.add(characterID);
    }
    if (watchlist.size >= FLEET.MAX_DAMAGE_SENDERS) {
      break;
    }
  }
  fleet.watchlists.set(viewerCharID, watchlist);
  return true;
}

function shouldReceiveBroadcast(recipient, sender, scope) {
  if (scope === FLEET.BROADCAST_ALL) {
    return true;
  }

  if (recipient.charID === sender.charID) {
    return true;
  }

  const senderRole = toInteger(sender.role, FLEET.FLEET_ROLE_MEMBER);
  const recipientRole = toInteger(recipient.role, FLEET.FLEET_ROLE_MEMBER);

  const isRecipientSuperiorToSender = (
    recipientRole < senderRole ||
    (recipientRole === FLEET.FLEET_ROLE_LEADER && senderRole !== FLEET.FLEET_ROLE_LEADER) ||
    (recipientRole === FLEET.FLEET_ROLE_WING_COMMANDER &&
      senderRole >= FLEET.FLEET_ROLE_SQUAD_COMMANDER &&
      recipient.wingID === sender.wingID) ||
    (recipientRole === FLEET.FLEET_ROLE_SQUAD_COMMANDER &&
      senderRole === FLEET.FLEET_ROLE_MEMBER &&
      recipient.squadID === sender.squadID)
  );
  const isRecipientSubordinateToSender = (
    senderRole === FLEET.FLEET_ROLE_LEADER ||
    (senderRole === FLEET.FLEET_ROLE_WING_COMMANDER && recipient.wingID === sender.wingID) ||
    (senderRole === FLEET.FLEET_ROLE_SQUAD_COMMANDER && recipient.squadID === sender.squadID)
  );

  if (scope === FLEET.BROADCAST_UP) {
    return isRecipientSuperiorToSender;
  }
  if (scope === FLEET.BROADCAST_DOWN) {
    return isRecipientSubordinateToSender;
  }
  return false;
}

function ensureBroadcastAllowed(name) {
  if (!FLEET.BROADCAST_NAMES.includes(String(name || ""))) {
    throw new Error("Illegal broadcast");
  }
}

function isBroadcastRateLimited(fleet, characterID, name) {
  const nowMs = Date.now();
  const previous = fleet.lastBroadcastByCharacter.get(characterID) || null;
  if (!previous) {
    fleet.lastBroadcastByCharacter.set(characterID, {
      name,
      timestampMs: nowMs,
    });
    return false;
  }

  const minDelayMs = previous.name === name
    ? FLEET.MIN_BROADCAST_TIME_SEC * 1000
    : Math.floor(FLEET.MIN_BROADCAST_TIME_SEC * 1000 / 3);
  if (previous.timestampMs + minDelayMs > nowMs) {
    return true;
  }

  fleet.lastBroadcastByCharacter.set(characterID, {
    name,
    timestampMs: nowMs,
  });
  return false;
}

function collectBroadcastRecipientSessions(fleet, senderSession, rangeMode) {
  const targetSessions = collectFleetSessions(fleet);
  const senderSystemID = getSessionSolarSystemID(senderSession);
  if (rangeMode === FLEET.BROADCAST_BUBBLE) {
    const bubble = spaceRuntime.getBubbleForSession(senderSession);
    if (!bubble || !senderSystemID) {
      return [];
    }
    const bubbleSessions = new Set(
      spaceRuntime.getSessionsInBubble(senderSystemID, bubble.id),
    );
    return targetSessions.filter((session) => bubbleSessions.has(session));
  }
  if (rangeMode === FLEET.BROADCAST_SYSTEM) {
    return targetSessions.filter((session) => (
      getSessionSolarSystemID(session) === senderSystemID
    ));
  }
  return targetSessions;
}

function sendBroadcast(session, fleetID, name, scope, itemID, typeID = null, rangeMode = FLEET.BROADCAST_UNIVERSE) {
  const fleet = ensureFleetMembership(session, fleetID);
  const senderCharID = getSessionCharacterID(session);
  const senderMember = getMemberRecord(fleet, senderCharID);
  ensureBroadcastAllowed(name);
  if (isBroadcastRateLimited(fleet, senderCharID, name)) {
    return false;
  }

  const senderSolarSystemID = getSessionSolarSystemID(session);
  const recipientSessions = collectBroadcastRecipientSessions(
    fleet,
    session,
    rangeMode,
  );
  for (const targetSession of recipientSessions) {
    const recipientMember = getMemberRecord(fleet, getSessionCharacterID(targetSession));
    if (!recipientMember || !shouldReceiveBroadcast(recipientMember, senderMember, toInteger(scope, FLEET.BROADCAST_ALL))) {
      continue;
    }
    notifySession(targetSession, "OnFleetBroadcast", [
      normalizeText(name, ""),
      toInteger(scope, FLEET.BROADCAST_ALL),
      senderCharID,
      senderSolarSystemID,
      itemID ?? null,
      typeID ?? null,
    ], "fleetid");
  }
  return true;
}

function buildJoinRequestFromSession(session) {
  const characterID = getSessionCharacterID(session);
  const characterRecord = resolveCharacterRecord(characterID);
  return {
    charID: characterID,
    corpID: toOptionalInteger(
      characterRecord.corporationID ??
        (session && (session.corpid || session.corporationID)),
      null,
    ),
    allianceID: toOptionalInteger(
      characterRecord.allianceID ??
        (session && (session.allianceid || session.allianceID)),
      null,
    ),
    warFactionID: toOptionalInteger(
      characterRecord.warFactionID ??
        (session && (session.warfactionid || session.warFactionID)),
      null,
    ),
    securityStatus: Number(characterRecord.securityStatus ?? characterRecord.securityRating ?? 0),
  };
}

function isAdvertOpenToSession(advert, session) {
  if (!advert) {
    return false;
  }

  if (advert.inviteScope & FLEET.INVITE_PUBLIC_OPEN) {
    return true;
  }
  if (advert.inviteScope & FLEET.INVITE_CORP) {
    if (toOptionalInteger(session && (session.corpid || session.corporationID), null) === advert.leader.corpID) {
      return true;
    }
  }
  if (advert.inviteScope & FLEET.INVITE_ALLIANCE) {
    if (advert.leader.allianceID && toOptionalInteger(session && (session.allianceid || session.allianceID), null) === advert.leader.allianceID) {
      return true;
    }
  }
  if (advert.inviteScope & FLEET.INVITE_MILITIA) {
    if (advert.leader.warFactionID && toOptionalInteger(session && (session.warfactionid || session.warFactionID), null) === advert.leader.warFactionID) {
      return true;
    }
  }
  if (advert.inviteScope & FLEET.INVITE_PUBLIC) {
    return true;
  }
  return false;
}

function getAvailableFleetAds(session) {
  const ads = new Map();
  for (const fleet of runtimeState.fleets.values()) {
    if (!fleet.advert || !fleet.options.isRegistered) {
      continue;
    }
    if (!isAdvertOpenToSession(fleet.advert, session) && getBossCharacterID(fleet) !== getSessionCharacterID(session)) {
      continue;
    }
    ads.set(fleet.fleetID, copyAdvert(fleet.advert));
  }
  return ads;
}

function addFleetFinderAdvert(session, advertData) {
  const fleet = ensureFleetBoss(session);
  const previousRegistered = Boolean(fleet.advert);
  fleet.advert = buildAdvertFromData(fleet, advertData || {});
  fleet.options.isRegistered = true;
  notifyFleet(fleet, "OnFleetOptionsChanged", [
    buildOptionsPayload({
      ...fleet.options,
      isRegistered: previousRegistered,
    }),
    buildOptionsPayload({ ...fleet.options }),
  ]);
  return copyAdvert(fleet.advert);
}

function removeFleetFinderAdvert(session) {
  const fleet = ensureFleetBoss(session);
  const previousAdvert = copyAdvert(fleet.advert);
  if (!previousAdvert) {
    return null;
  }
  const oldOptions = { ...fleet.options };
  fleet.advert = null;
  fleet.options.isRegistered = false;
  notifyFleet(fleet, "OnFleetOptionsChanged", [
    buildOptionsPayload(oldOptions),
    buildOptionsPayload({ ...fleet.options }),
  ]);
  return previousAdvert;
}

function getMyFleetFinderAdvert(session) {
  const fleet = getFleetForCharacter(getSessionCharacterID(session));
  if (!fleet || !fleet.advert || !fleet.options.isRegistered) {
    return null;
  }
  return copyAdvert(fleet.advert);
}

function updateAdvertAllowedEntities(session, allowedEntitiesInfo) {
  const fleet = ensureFleetBoss(session);
  if (!fleet.advert) {
    return null;
  }

  const source = getMarshalObjectSource(allowedEntitiesInfo);
  fleet.advert.membergroups_allowedEntities = normalizeAdvertEntitySet(source.membergroups_allowedEntities);
  fleet.advert.public_allowedEntities = normalizeAdvertEntitySet(source.public_allowedEntities);
  fleet.advert.membergroups_disallowedEntities = normalizeAdvertEntitySet(source.membergroups_disallowedEntities);
  fleet.advert.public_disallowedEntities = normalizeAdvertEntitySet(source.public_disallowedEntities);
  fleet.advert.advertTime = currentFileTime();
  return copyAdvert(fleet.advert);
}

function updateAdvertInfo(session, numMembers, allowedDiff) {
  const fleet = ensureFleetBoss(session);
  if (!fleet.advert) {
    return null;
  }

  fleet.advert.numMembers = Math.max(0, toInteger(numMembers, fleet.members.size));
  fleet.advert.solarSystemID = getLeaderSolarSystemID(fleet);
  const nextAdvert = fleet.advert;
  const diffSource = getMarshalObjectSource(allowedDiff);
  const patchSet = (fieldName, addKey, removeKey) => {
    const nextSet = normalizeAdvertEntitySet(nextAdvert[fieldName]);
    for (const value of toIntegerSet(diffSource[addKey])) {
      if (nextSet.size >= FLEET.MAX_ALLOWED_ENTITIES && !nextSet.has(value)) {
        continue;
      }
      nextSet.add(value);
    }
    for (const value of toIntegerSet(diffSource[removeKey])) {
      nextSet.delete(value);
    }
    nextAdvert[fieldName] = nextSet;
  };
  patchSet("membergroups_allowedEntities", "membergroupsToAddToAllowed", "membergroupsToRemoveFromAllowed");
  patchSet("membergroups_disallowedEntities", "membergroupsToAddToDisallowed", "membergroupsToRemoveFromDisallowed");
  patchSet("public_allowedEntities", "publicToAddToAllowed", "publicToRemoveFromAllowed");
  patchSet("public_disallowedEntities", "publicToAddToDisallowed", "publicToRemoveFromDisallowed");
  nextAdvert.advertTime = currentFileTime();
  return copyAdvert(nextAdvert);
}

function updateFleetAdvertWithNewLeader(session, allowedEntitiesInfo) {
  const fleet = ensureFleetBoss(session);
  if (!fleet.advert) {
    return null;
  }

  fleet.advert.leader = buildMemberSnapshot(
    getBossCharacterID(fleet),
    findSessionByCharacterID(getBossCharacterID(fleet)),
    getBossMember(fleet),
  );
  fleet.advert.solarSystemID = getLeaderSolarSystemID(fleet);
  if (allowedEntitiesInfo) {
    const source = getMarshalObjectSource(allowedEntitiesInfo);
    fleet.advert.membergroups_allowedEntities = normalizeAdvertEntitySet(source.membergroups_allowedEntities);
    fleet.advert.public_allowedEntities = normalizeAdvertEntitySet(source.public_allowedEntities);
    fleet.advert.membergroups_disallowedEntities = normalizeAdvertEntitySet(source.membergroups_disallowedEntities);
    fleet.advert.public_disallowedEntities = normalizeAdvertEntitySet(source.public_disallowedEntities);
  }
  fleet.advert.advertTime = currentFileTime();
  return copyAdvert(fleet.advert);
}

function applyToJoinFleet(session, fleetID, autoAccept = false) {
  const fleet = ensureFleetExists(fleetID);
  if (!fleet.advert || !fleet.options.isRegistered) {
    throwWrappedUserError("FleetNotFound");
  }
  if (!isAdvertOpenToSession(fleet.advert, session)) {
    throwWrappedUserError("FleetNotAllowed");
  }
  if (
    fleet.advert.advertJoinLimit != null &&
    fleet.members.size >= toInteger(fleet.advert.advertJoinLimit, FLEET.MAX_MEMBERS_IN_FLEET)
  ) {
    throwWrappedUserError("FleetTooManyMembers");
  }

  if (fleet.advert.joinNeedsApproval) {
    const request = buildJoinRequestFromSession(session);
    fleet.joinRequests.set(request.charID, request);
    const bossSession = findSessionByCharacterID(getBossCharacterID(fleet));
    if (bossSession) {
      notifySession(
        bossSession,
        "OnFleetJoinRequest",
        [buildJoinRequestPayload(request)],
        "fleetid",
      );
    }
    return true;
  }

  const defaultPlacement = findPlacementForRole(fleet, FLEET.FLEET_ROLE_MEMBER);
  if (fleet.options.autoJoinSquadID) {
    defaultPlacement.squadID = fleet.options.autoJoinSquadID;
  }
  inviteCharacter(
    findSessionByCharacterID(getBossCharacterID(fleet)) || session,
    fleet.fleetID,
    getSessionCharacterID(session),
    defaultPlacement.wingID,
    defaultPlacement.squadID,
    defaultPlacement.role,
    {
      autoAccept: true,
    },
  );
  return false;
}

function rejectJoinRequest(session, fleetID, characterID) {
  const fleet = ensureFleetBoss(session, fleetID);
  const numericCharacterID = toInteger(characterID, 0);
  if (!fleet.joinRequests.has(numericCharacterID)) {
    return false;
  }
  fleet.joinRequests.delete(numericCharacterID);
  const applicantSession = findSessionByCharacterID(numericCharacterID);
  if (applicantSession) {
    notifySession(applicantSession, "OnFleetJoinRejected", [
      getBossCharacterID(fleet),
    ], "charid");
  }
  const bossSession = findSessionByCharacterID(getBossCharacterID(fleet));
  if (bossSession) {
    notifySession(
      bossSession,
      "OnJoinRequestUpdate",
      [buildJoinRequestsPayload(fleet.joinRequests)],
      "fleetid",
    );
  }
  return true;
}

function massInvite(session, fleetID, characterIDs, wingID, squadID, role) {
  const fleet = ensureFleetMembership(session, fleetID);
  const invited = [];
  for (const rawCharacterID of Array.isArray(characterIDs) ? characterIDs : []) {
    const characterID = toInteger(rawCharacterID, 0);
    if (!characterID || characterID === getSessionCharacterID(session)) {
      continue;
    }
    if (inviteCharacter(session, fleet.fleetID, characterID, wingID, squadID, role)) {
      invited.push(characterID);
    }
  }
  return invited;
}

module.exports = {
  FLEET,
  runtimeState,
  getKwarg,
  toInteger,
  toOptionalInteger,
  toBoolean,
  toIntegerSet,
  buildMemberOptOuts,
  cloneMemberOptOuts,
  createFleetRecord,
  initFleet,
  getFleetByID,
  getFleetForCharacter,
  getMemberRecord,
  getFleetState,
  getWings,
  getMotd,
  getJoinRequests,
  getFleetMaxSize,
  getFleetComposition,
  inviteCharacter,
  massInvite,
  acceptInvite,
  rejectInvite,
  reconnectCharacter,
  leaveFleet,
  forceLeaveFleet,
  createWing,
  deleteWing,
  changeWingName,
  createSquad,
  deleteSquad,
  changeSquadName,
  moveMember,
  massMoveMembers,
  finishMove,
  kickMember,
  makeLeader,
  disbandFleet,
  setOptions,
  setAutoJoinSquadID,
  setFleetMaxSize,
  setMotd,
  setMemberOptOut,
  updateMemberInfo,
  loadFleetSetup,
  addToWatchlist,
  removeFromWatchlist,
  registerForDamageUpdates,
  sendBroadcast,
  getAvailableFleetAds,
  applyToJoinFleet,
  addFleetFinderAdvert,
  removeFleetFinderAdvert,
  getMyFleetFinderAdvert,
  updateAdvertInfo,
  updateAdvertAllowedEntities,
  updateFleetAdvertWithNewLeader,
  rejectJoinRequest,
  getRespawnPoints,
  setRespawnPoints,
  setFleetTargetTag,
  getTargetTagForCharacter,
  setBridgeMode,
  setJumpBeaconModuleState,
  setJumpBeaconDeployableState,
  getActiveBeaconForCharacter,
  hasActiveBeaconForCharacter,
  getActiveBeaconsForCharacter,
  getActiveBridgeForCharacter,
  recordLootEventsForSession,
  getSessionFleetState,
  applySessionFleetState,
  getFleetHelpersSnapshot,
};
