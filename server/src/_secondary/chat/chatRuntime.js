const { EventEmitter } = require("events");
const path = require("path");

const chatStore = require("./chatStore");
const {
  getStaticChannelContract,
  listDiscoverableStaticChannelContracts,
  listVerifiedStaticChannelContracts,
} = require("./staticChannelContracts");
const sessionRegistry = require(path.join(
  __dirname,
  "../../services/chat/sessionRegistry",
));
const {
  getCurrentSolarSystemID,
  getLocalChatRoomNameForSession,
  getLocalChatRoomNameForSolarSystemID,
  isDelayedLocalChatRoomName,
  isLocalChatRoomName,
  parseLocalChatRoomName,
} = require(path.join(
  __dirname,
  "../../services/chat/channelRules",
));
const {
  normalizeRoleValue,
} = require(path.join(
  __dirname,
  "../../services/account/accountRoleProfiles",
));
const {
  CORP_ROLE_CHAT_MANAGER,
  CORP_ROLE_DIRECTOR,
} = require(path.join(
  __dirname,
  "../../services/corporation/corporationRuntimeState",
));

const ROLE_CHTINVISIBLE = 1048576n;
const ROLE_PINKCHAT = 64n;
const ROLE_QA = 4503599627370496n;
const ROLE_GMH = 9007199254740992n;
const ROLE_GMS = 274877906944n;
const ROLE_GML = 18014398509481984n;
const ROLE_ADMIN = 72057594037927936n;
const ROLE_CENTURION = 2048n;
const ROLE_LEGIONEER = 262144n;

const roomActivity = new Map();
const delayedLocalSpeakers = new Map();
const localLscMembership = new Map();
const deletedPlayerChannels = new Set();
const runtimeEmitter = new EventEmitter();

function normalizePositiveInteger(value, fallback = 0) {
  return chatStore.normalizePositiveInteger(value, fallback);
}

function normalizeString(value, fallback = "") {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return fallback;
  }
  return String(value);
}

function dedupePositiveIntegers(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => normalizePositiveInteger(value, 0))
      .filter((value) => value > 0),
  )].sort((left, right) => left - right);
}

function getCharacterID(session) {
  return normalizePositiveInteger(
    session && (session.characterID || session.charid || session.userid),
    0,
  );
}

function getCorporationID(session) {
  return normalizePositiveInteger(
    session && (session.corporationID || session.corpid),
    0,
  );
}

function getAllianceID(session) {
  return normalizePositiveInteger(
    session && (session.allianceID || session.allianceid),
    0,
  );
}

function getWarFactionID(session) {
  return normalizePositiveInteger(
    session && (session.warFactionID || session.warfactionid),
    0,
  );
}

function getFleetID(session) {
  return normalizePositiveInteger(session && session.fleetid, 0);
}

function getSessionRole(session) {
  return normalizeRoleValue(session && session.role, 0n);
}

function getCorporationRoleMask(session) {
  try {
    return normalizeRoleValue(session && session.corprole, 0n);
  } catch (error) {
    return 0n;
  }
}

function classifyRole(roleValue) {
  const normalizedRole = normalizeRoleValue(roleValue, 0n);
  if ((normalizedRole & ROLE_CHTINVISIBLE) === ROLE_CHTINVISIBLE) {
    return "CLASSIFICATION_INVISIBLE";
  }
  if ((normalizedRole & ROLE_PINKCHAT) === ROLE_PINKCHAT) {
    return "CLASSIFICATION_NPC";
  }
  if ((normalizedRole & ROLE_QA) === ROLE_QA) {
    return "CLASSIFICATION_DEVELOPER";
  }
  if ((normalizedRole & (ROLE_GML | ROLE_GMH | ROLE_GMS | ROLE_ADMIN)) !== 0n) {
    return "CLASSIFICATION_GAMEMASTER";
  }
  if ((normalizedRole & (ROLE_CENTURION | ROLE_LEGIONEER)) !== 0n) {
    return "CLASSIFICATION_VOLUNTEER";
  }
  return "CLASSIFICATION_UNSPECIFIED";
}

function buildLocalGatewayMember(session) {
  const allianceID = getAllianceID(session);
  const warFactionID = getWarFactionID(session);
  return {
    character: {
      sequential: getCharacterID(session),
    },
    corporation: {
      sequential: getCorporationID(session),
    },
    alliance:
      allianceID > 0
        ? {
            sequential: allianceID,
          }
        : null,
    no_alliance: allianceID <= 0,
    faction:
      warFactionID > 0
        ? {
            sequential: warFactionID,
          }
        : null,
    no_faction: warFactionID <= 0,
    classification: classifyRole(getSessionRole(session)),
  };
}

function buildCharacterSummary(session) {
  return {
    characterID: getCharacterID(session),
    corporationID: getCorporationID(session),
    allianceID: getAllianceID(session),
    warFactionID: getWarFactionID(session),
    name: normalizeString(
      session && (session.characterName || session.userName),
      "Unknown",
    ),
    solarSystemID: getCurrentSolarSystemID(session),
    classification: classifyRole(getSessionRole(session)),
  };
}

function buildLocalRecord(roomName, solarSystemID) {
  const parsed = parseLocalChatRoomName(roomName);
  const resolvedSolarSystemID = normalizePositiveInteger(
    solarSystemID || (parsed && parsed.solarSystemID),
    0,
  );
  const resolvedRoomName = normalizeString(
    roomName || getLocalChatRoomNameForSolarSystemID(resolvedSolarSystemID),
    "",
  ).trim();
  return {
    roomName: resolvedRoomName,
    type: parsed ? parsed.category : "local",
    scope: parsed ? parsed.category : "local",
    entityID: resolvedSolarSystemID,
    displayName: "Local",
    motd: "",
    static: true,
    verifiedContract: true,
    contractSource: "client_verified",
    memberless: false,
    temporary: false,
    destroyWhenEmpty: false,
    persistBacklog: true,
    backlogLimit: 100,
    metadata: {
      delayed: isDelayedLocalChatRoomName(resolvedRoomName),
    },
  };
}

function buildMergedLocalRecord(roomName, solarSystemID) {
  const baseRecord = buildLocalRecord(roomName, solarSystemID);
  const storedRecord = chatStore.getChannelRecord(baseRecord.roomName);
  if (!storedRecord) {
    return baseRecord;
  }

  const cleanedStoredRecord = cleanupExpiredEntries(storedRecord);
  const mergedRecord = {
    ...cleanedStoredRecord,
    roomName: baseRecord.roomName,
    type: baseRecord.type,
    scope: baseRecord.scope,
    entityID: baseRecord.entityID,
    displayName: baseRecord.displayName,
    static: true,
    verifiedContract: true,
    contractSource: "client_verified",
    memberless: false,
    temporary: false,
    destroyWhenEmpty: false,
    metadata: {
      ...(cleanedStoredRecord.metadata || {}),
      ...(baseRecord.metadata || {}),
    },
  };

  if (JSON.stringify(mergedRecord) !== JSON.stringify(storedRecord)) {
    return chatStore.setChannelRecord(mergedRecord);
  }
  if (JSON.stringify(cleanedStoredRecord) !== JSON.stringify(storedRecord)) {
    return chatStore.setChannelRecord(cleanedStoredRecord);
  }

  return mergedRecord;
}

function parseKnownRoom(roomName) {
  const normalizedRoomName = normalizeString(roomName, "").trim();
  const staticContract = getStaticChannelContract(normalizedRoomName);
  if (staticContract) {
    return {
      roomName: staticContract.roomName,
      scope: staticContract.scope,
      type: staticContract.type,
      entityID: normalizePositiveInteger(staticContract.entityID, 0),
      verifiedContract: staticContract.verifiedContract === true,
      contractSource: staticContract.contractSource || "client_verified",
      displayName: staticContract.displayName,
      motd: normalizeString(staticContract.motd, ""),
      topic: normalizeString(staticContract.topic, ""),
      static: staticContract.static !== false,
      contractBacked: true,
      metadata:
        staticContract.metadata && typeof staticContract.metadata === "object"
          ? { ...staticContract.metadata }
          : {},
    };
  }
  const localDescriptor = parseLocalChatRoomName(normalizedRoomName);
  if (localDescriptor) {
    return {
      roomName: localDescriptor.roomName,
      scope: localDescriptor.category,
      type: localDescriptor.category,
      entityID: localDescriptor.solarSystemID,
      verifiedContract: true,
      contractSource: "client_verified",
      displayName: "Local",
      static: true,
      contractBacked: false,
    };
  }

  const patterns = [
    [/^corp_(\d+)$/i, "corp", "Corp", true],
    [/^fleet_(\d+)$/i, "fleet", "Fleet", true],
    [/^resourcewars_(\d+)$/i, "resourcewars", "Resource Wars", true],
    [/^player_(\d+)$/i, "player", "Player Channel", true],
    [/^incursion_(\d+)$/i, "incursion", "Incursion", true],
    [/^spreadingIncursion_(\d+)$/i, "incursion", "Spreading Incursion", true],
    [/^alliance_(\d+)$/i, "alliance", "Alliance", false],
    [/^(militia|faction)_(\d+)$/i, "faction", "Militia", false],
    [/^private_(\d+)_(\d+)$/i, "private", "Private Chat", false],
  ];

  for (const [regex, type, displayName, verifiedContract] of patterns) {
    const match = regex.exec(normalizedRoomName);
    if (!match) {
      continue;
    }
    return {
      roomName: normalizedRoomName,
      scope: type,
      type,
      entityID: normalizePositiveInteger(match[2] || match[1], 0),
      verifiedContract,
      contractSource: verifiedContract ? "client_verified" : "discovered",
      displayName,
      static: type !== "player" && type !== "private",
      contractBacked: false,
    };
  }

  return {
    roomName: normalizedRoomName,
    scope: "system",
    type: "system",
    entityID: 0,
    verifiedContract: false,
    contractSource: "runtime",
    displayName: normalizedRoomName,
    static: false,
    contractBacked: false,
  };
}

function cleanupExpiredEntries(record) {
  const nextRecord = {
    ...record,
    mutedCharacters: { ...(record.mutedCharacters || {}) },
    bannedCharacters: { ...(record.bannedCharacters || {}) },
  };
  const nowMs = Date.now();
  for (const [characterID, entry] of Object.entries(nextRecord.mutedCharacters)) {
    if (Number(entry && entry.untilMs) > 0 && Number(entry.untilMs) <= nowMs) {
      delete nextRecord.mutedCharacters[characterID];
    }
  }
  for (const [characterID, entry] of Object.entries(nextRecord.bannedCharacters)) {
    if (Number(entry && entry.untilMs) > 0 && Number(entry.untilMs) <= nowMs) {
      delete nextRecord.bannedCharacters[characterID];
    }
  }
  return nextRecord;
}

function ensureChannel(roomName, options = {}) {
  const normalizedRoomName = normalizeString(roomName, "").trim();
  if (!normalizedRoomName) {
    return null;
  }
  if (isLocalChatRoomName(normalizedRoomName)) {
    return buildMergedLocalRecord(normalizedRoomName);
  }
  const existing = chatStore.getChannelRecord(normalizedRoomName);
  if (existing) {
    const cleaned = cleanupExpiredEntries(existing);
    const parsed = parseKnownRoom(normalizedRoomName);
    const normalizedExisting = (
      parsed &&
      parsed.static === true &&
      (
        cleaned.type !== parsed.type ||
        cleaned.scope !== parsed.scope ||
        cleaned.static !== parsed.static ||
        cleaned.verifiedContract !== parsed.verifiedContract ||
        cleaned.contractSource !== parsed.contractSource ||
        cleaned.displayName !== parsed.displayName ||
        (
          parsed.contractBacked === true &&
          (
            cleaned.motd !== normalizeString(parsed.motd, "") ||
            cleaned.topic !== normalizeString(parsed.topic, "") ||
            JSON.stringify(cleaned.metadata || {}) !== JSON.stringify(parsed.metadata || {})
          )
        )
      )
    )
      ? {
          ...cleaned,
          roomName: parsed.roomName,
          type: parsed.type,
          scope: parsed.scope,
          static: parsed.static,
          verifiedContract: parsed.verifiedContract,
          contractSource: parsed.contractSource,
          displayName: parsed.displayName,
          ...(parsed.contractBacked === true
            ? {
                motd: normalizeString(parsed.motd, ""),
                topic: normalizeString(parsed.topic, ""),
                metadata:
                  parsed.metadata && typeof parsed.metadata === "object"
                    ? { ...parsed.metadata }
                    : {},
              }
            : {}),
        }
      : cleaned;
    if (JSON.stringify(normalizedExisting) !== JSON.stringify(existing)) {
      return chatStore.setChannelRecord(normalizedExisting);
    }
    return normalizedExisting;
  }
  if (deletedPlayerChannels.has(normalizedRoomName)) {
    return null;
  }

  const parsed = parseKnownRoom(normalizedRoomName);
  const created = chatStore.setChannelRecord({
    roomName: parsed.roomName,
    type: normalizeString(options.type, parsed.type).trim().toLowerCase() || parsed.type,
    scope: normalizeString(options.scope, parsed.scope).trim().toLowerCase() || parsed.scope,
    entityID:
      options.entityID !== undefined
        ? normalizePositiveInteger(options.entityID, 0)
        : parsed.entityID,
    displayName: options.displayName || parsed.displayName || parsed.roomName,
    motd:
      options.motd !== undefined
        ? normalizeString(options.motd, "")
        : parsed.contractBacked === true
          ? normalizeString(parsed.motd, "")
          : "",
    topic:
      options.topic !== undefined
        ? normalizeString(options.topic, "")
        : parsed.contractBacked === true
          ? normalizeString(parsed.topic, "")
          : "",
    ownerCharacterID: normalizePositiveInteger(options.ownerCharacterID, 0),
    password: normalizeString(options.password, ""),
    passwordRequired: Boolean(options.password),
    static: options.static !== undefined ? Boolean(options.static) : parsed.static,
    verifiedContract:
      options.verifiedContract !== undefined
        ? Boolean(options.verifiedContract)
        : parsed.verifiedContract,
    contractSource: options.contractSource || parsed.contractSource,
    memberless: Boolean(options.memberless),
    temporary: Boolean(options.temporary),
    destroyWhenEmpty: Boolean(options.destroyWhenEmpty),
    inviteOnly: Boolean(options.inviteOnly),
    persistBacklog: options.persistBacklog !== false,
    backlogLimit: Math.max(0, Number(options.backlogLimit) || 100),
    inviteToken: normalizeString(options.inviteToken, ""),
    invitedCharacters: dedupePositiveIntegers(options.invitedCharacters),
    adminCharacterIDs: dedupePositiveIntegers(options.adminCharacterIDs),
    operatorCharacterIDs: dedupePositiveIntegers(options.operatorCharacterIDs),
    allowCharacterIDs: dedupePositiveIntegers(options.allowCharacterIDs),
    denyCharacterIDs: dedupePositiveIntegers(options.denyCharacterIDs),
    allowCorporationIDs: dedupePositiveIntegers(options.allowCorporationIDs),
    denyCorporationIDs: dedupePositiveIntegers(options.denyCorporationIDs),
    allowAllianceIDs: dedupePositiveIntegers(options.allowAllianceIDs),
    denyAllianceIDs: dedupePositiveIntegers(options.denyAllianceIDs),
    allowedParticipantCharacterIDs: dedupePositiveIntegers(
      options.allowedParticipantCharacterIDs,
    ),
    metadata:
      options.metadata && typeof options.metadata === "object"
        ? options.metadata
        : parsed.contractBacked === true &&
            parsed.metadata &&
            typeof parsed.metadata === "object"
          ? parsed.metadata
          : {},
  });

  if (!created.verifiedContract && (parsed.type === "alliance" || parsed.type === "faction")) {
    chatStore.recordStaticContractObservation(parsed.roomName, {
      source: "runtime_ensure",
      reason: "provisioned_from_client_request",
      scope: parsed.scope,
      entityID: parsed.entityID,
    });
  }

  return created;
}

function hasOwnOption(options, key) {
  return Boolean(
    options &&
      typeof options === "object" &&
      Object.prototype.hasOwnProperty.call(options, key),
  );
}

function syncEnsuredChannel(roomName, options = {}) {
  const record = ensureChannel(roomName, options);
  if (!record) {
    return null;
  }

  const shouldPatch =
    hasOwnOption(options, "type") ||
    hasOwnOption(options, "scope") ||
    hasOwnOption(options, "entityID") ||
    hasOwnOption(options, "displayName") ||
    hasOwnOption(options, "motd") ||
    hasOwnOption(options, "ownerCharacterID") ||
    hasOwnOption(options, "password") ||
    hasOwnOption(options, "passwordRequired") ||
    hasOwnOption(options, "static") ||
    hasOwnOption(options, "verifiedContract") ||
    hasOwnOption(options, "contractSource") ||
    hasOwnOption(options, "memberless") ||
    hasOwnOption(options, "temporary") ||
    hasOwnOption(options, "destroyWhenEmpty") ||
    hasOwnOption(options, "inviteOnly") ||
    hasOwnOption(options, "persistBacklog") ||
    hasOwnOption(options, "backlogLimit") ||
    hasOwnOption(options, "inviteToken") ||
    hasOwnOption(options, "invitedCharacters") ||
    hasOwnOption(options, "adminCharacterIDs") ||
    hasOwnOption(options, "operatorCharacterIDs") ||
    hasOwnOption(options, "allowCharacterIDs") ||
    hasOwnOption(options, "denyCharacterIDs") ||
    hasOwnOption(options, "allowCorporationIDs") ||
    hasOwnOption(options, "denyCorporationIDs") ||
    hasOwnOption(options, "allowAllianceIDs") ||
    hasOwnOption(options, "denyAllianceIDs") ||
    hasOwnOption(options, "allowedParticipantCharacterIDs") ||
    hasOwnOption(options, "metadata");

  if (!shouldPatch) {
    return record;
  }

  return updateChannel(record.roomName, (currentRecord) => ({
    ...currentRecord,
    ...(hasOwnOption(options, "type")
      ? {
          type:
            normalizeString(options.type, currentRecord.type)
              .trim()
              .toLowerCase() || currentRecord.type,
        }
      : {}),
    ...(hasOwnOption(options, "scope")
      ? {
          scope:
            normalizeString(options.scope, currentRecord.scope)
              .trim()
              .toLowerCase() || currentRecord.scope,
        }
      : {}),
    ...(hasOwnOption(options, "entityID")
      ? {
          entityID: normalizePositiveInteger(options.entityID, currentRecord.entityID),
        }
      : {}),
    ...(hasOwnOption(options, "displayName")
      ? {
          displayName: normalizeString(options.displayName, currentRecord.displayName),
        }
      : {}),
    ...(hasOwnOption(options, "motd")
      ? {
          motd: normalizeString(options.motd, currentRecord.motd),
        }
      : {}),
    ...(hasOwnOption(options, "ownerCharacterID")
      ? {
          ownerCharacterID: normalizePositiveInteger(
            options.ownerCharacterID,
            currentRecord.ownerCharacterID,
          ),
        }
      : {}),
    ...(hasOwnOption(options, "password")
      ? {
          password: normalizeString(options.password, currentRecord.password),
        }
      : {}),
    ...(hasOwnOption(options, "passwordRequired")
      ? {
          passwordRequired: Boolean(options.passwordRequired),
        }
      : {}),
    ...(hasOwnOption(options, "static")
      ? {
          static: Boolean(options.static),
        }
      : {}),
    ...(hasOwnOption(options, "verifiedContract")
      ? {
          verifiedContract: Boolean(options.verifiedContract),
        }
      : {}),
    ...(hasOwnOption(options, "contractSource")
      ? {
          contractSource: normalizeString(
            options.contractSource,
            currentRecord.contractSource,
          ),
        }
      : {}),
    ...(hasOwnOption(options, "memberless")
      ? {
          memberless: Boolean(options.memberless),
        }
      : {}),
    ...(hasOwnOption(options, "temporary")
      ? {
          temporary: Boolean(options.temporary),
        }
      : {}),
    ...(hasOwnOption(options, "destroyWhenEmpty")
      ? {
          destroyWhenEmpty: Boolean(options.destroyWhenEmpty),
        }
      : {}),
    ...(hasOwnOption(options, "inviteOnly")
      ? {
          inviteOnly: Boolean(options.inviteOnly),
        }
      : {}),
    ...(hasOwnOption(options, "persistBacklog")
      ? {
          persistBacklog: options.persistBacklog !== false,
        }
      : {}),
    ...(hasOwnOption(options, "backlogLimit")
      ? {
          backlogLimit: Math.max(
            0,
            Number(options.backlogLimit) || currentRecord.backlogLimit || 0,
          ),
        }
      : {}),
    ...(hasOwnOption(options, "inviteToken")
      ? {
          inviteToken: normalizeString(options.inviteToken, currentRecord.inviteToken),
        }
      : {}),
    ...(hasOwnOption(options, "invitedCharacters")
      ? {
          invitedCharacters: dedupePositiveIntegers(options.invitedCharacters),
        }
      : {}),
    ...(hasOwnOption(options, "adminCharacterIDs")
      ? {
          adminCharacterIDs: dedupePositiveIntegers(options.adminCharacterIDs),
        }
      : {}),
    ...(hasOwnOption(options, "operatorCharacterIDs")
      ? {
          operatorCharacterIDs: dedupePositiveIntegers(options.operatorCharacterIDs),
        }
      : {}),
    ...(hasOwnOption(options, "allowCharacterIDs")
      ? {
          allowCharacterIDs: dedupePositiveIntegers(options.allowCharacterIDs),
        }
      : {}),
    ...(hasOwnOption(options, "denyCharacterIDs")
      ? {
          denyCharacterIDs: dedupePositiveIntegers(options.denyCharacterIDs),
        }
      : {}),
    ...(hasOwnOption(options, "allowCorporationIDs")
      ? {
          allowCorporationIDs: dedupePositiveIntegers(options.allowCorporationIDs),
        }
      : {}),
    ...(hasOwnOption(options, "denyCorporationIDs")
      ? {
          denyCorporationIDs: dedupePositiveIntegers(options.denyCorporationIDs),
        }
      : {}),
    ...(hasOwnOption(options, "allowAllianceIDs")
      ? {
          allowAllianceIDs: dedupePositiveIntegers(options.allowAllianceIDs),
        }
      : {}),
    ...(hasOwnOption(options, "denyAllianceIDs")
      ? {
          denyAllianceIDs: dedupePositiveIntegers(options.denyAllianceIDs),
        }
      : {}),
    ...(hasOwnOption(options, "allowedParticipantCharacterIDs")
      ? {
          allowedParticipantCharacterIDs: dedupePositiveIntegers(
            options.allowedParticipantCharacterIDs,
          ),
        }
      : {}),
    ...(hasOwnOption(options, "metadata")
      ? {
          metadata:
            options.metadata && typeof options.metadata === "object"
              ? {
                  ...(currentRecord.metadata || {}),
                  ...options.metadata,
                }
              : currentRecord.metadata,
        }
      : {}),
  }));
}

function getChannel(roomName) {
  return ensureChannel(roomName);
}

function getVerifiedStaticChannels() {
  return listVerifiedStaticChannelContracts();
}

function canDestroyChannel(session, record) {
  const characterID = getCharacterID(session);
  if (!record || !characterID) {
    return false;
  }
  if (record.static === true || record.type !== "player") {
    return false;
  }
  return record.ownerCharacterID === characterID;
}

function isChannelAdmin(session, record) {
  const characterID = getCharacterID(session);
  if (!characterID) {
    return false;
  }
  if (record.ownerCharacterID === characterID) {
    return true;
  }
  if ((record.adminCharacterIDs || []).includes(characterID)) {
    return true;
  }
  if ((record.operatorCharacterIDs || []).includes(characterID)) {
    return true;
  }
  if (record.type === "corp") {
    const corpRoles = getCorporationRoleMask(session);
    if (
      (corpRoles & CORP_ROLE_CHAT_MANAGER) !== 0n ||
      (corpRoles & CORP_ROLE_DIRECTOR) !== 0n
    ) {
      return true;
    }
  }
  return false;
}

function getChannelAccessFailure(session, record, options = {}) {
  const characterID = getCharacterID(session);
  const corporationID = getCorporationID(session);
  const allianceID = getAllianceID(session);
  const warFactionID = getWarFactionID(session);
  const fleetID = getFleetID(session);
  const providedPassword = normalizeString(options.providedPassword, "");
  const bannedEntry = record.bannedCharacters && record.bannedCharacters[String(characterID)];
  if (bannedEntry) {
    return "banned";
  }
  if ((record.denyCharacterIDs || []).includes(characterID)) {
    return "denied";
  }
  if ((record.denyCorporationIDs || []).includes(corporationID)) {
    return "denied";
  }
  if ((record.denyAllianceIDs || []).includes(allianceID)) {
    return "denied";
  }
  if (record.type === "corp" && record.entityID > 0 && record.entityID !== corporationID) {
    return "corp_mismatch";
  }
  if (record.type === "fleet" && record.entityID > 0 && record.entityID !== fleetID) {
    return "fleet_mismatch";
  }
  if (record.type === "alliance" && record.entityID > 0 && record.entityID !== allianceID) {
    return "alliance_mismatch";
  }
  if (record.type === "faction" && record.entityID > 0 && record.entityID !== warFactionID) {
    return "faction_mismatch";
  }
  if (record.type === "private") {
    const allowedParticipants = dedupePositiveIntegers(
      record.allowedParticipantCharacterIDs,
    );
    if (allowedParticipants.length > 0 && !allowedParticipants.includes(characterID)) {
      return "private_mismatch";
    }
  }
  if (
    record.inviteOnly &&
    !isChannelAdmin(session, record) &&
    !(record.invitedCharacters || []).includes(characterID)
  ) {
    return "invite_required";
  }
  const allowListsConfigured = (
    (record.allowCharacterIDs || []).length > 0 ||
    (record.allowCorporationIDs || []).length > 0 ||
    (record.allowAllianceIDs || []).length > 0
  );
  if (
    allowListsConfigured &&
    !isChannelAdmin(session, record) &&
    !(record.allowCharacterIDs || []).includes(characterID) &&
    !(record.allowCorporationIDs || []).includes(corporationID) &&
    !(record.allowAllianceIDs || []).includes(allianceID)
  ) {
    return "not_allowed";
  }
  if (record.passwordRequired && record.password !== providedPassword) {
    return "password_required";
  }
  return null;
}

function listChannelTemporaryRestrictions(roomName, category) {
  const record = getChannel(roomName);
  if (!record) {
    return [];
  }

  const normalizedCategory = normalizeString(category, "").trim().toLowerCase();
  const restrictionMap =
    normalizedCategory === "mute"
      ? record.mutedCharacters || {}
      : normalizedCategory === "ban"
        ? record.bannedCharacters || {}
        : {};

  return Object.values(restrictionMap)
    .map((entry) => ({
      characterID: normalizePositiveInteger(entry && entry.characterID, 0),
      untilMs: Math.max(0, Number(entry && entry.untilMs) || 0),
      reason: normalizeString(entry && entry.reason, ""),
      byCharacterID: normalizePositiveInteger(entry && entry.byCharacterID, 0),
      createdAtMs: Math.max(0, Number(entry && entry.createdAtMs) || 0),
    }))
    .filter((entry) => entry.characterID > 0)
    .sort((left, right) => {
      const leftExpiry = Math.max(0, Number(left.untilMs) || 0);
      const rightExpiry = Math.max(0, Number(right.untilMs) || 0);
      if (leftExpiry !== rightExpiry) {
        return leftExpiry - rightExpiry;
      }

      return left.characterID - right.characterID;
    });
}

function assertChannelAccess(session, roomName, options = {}) {
  const record = ensureChannel(roomName);
  if (!record) {
    const error = new Error("Channel not found");
    error.code = "CHANNEL_NOT_FOUND";
    throw error;
  }
  const failure = getChannelAccessFailure(session, record, options);
  if (!failure) {
    return record;
  }
  const error = new Error(`Channel access denied: ${failure}`);
  error.code = failure;
  throw error;
}

function getActivityForRoom(roomName) {
  let roomState = roomActivity.get(roomName);
  if (!roomState) {
    roomState = {
      activeCharacterIDs: new Set(),
    };
    roomActivity.set(roomName, roomState);
  }
  return roomState;
}

function joinChannel(session, roomName, options = {}) {
  const record = assertChannelAccess(session, roomName, options);
  const characterID = getCharacterID(session);
  const activity = getActivityForRoom(record.roomName);
  const joined = !activity.activeCharacterIDs.has(characterID);
  activity.activeCharacterIDs.add(characterID);

  if (!record.verifiedContract && (record.type === "alliance" || record.type === "faction")) {
    chatStore.recordStaticContractObservation(record.roomName, {
      source: "channel_join",
      characterID,
      corporationID: getCorporationID(session),
      allianceID: getAllianceID(session),
      warFactionID: getWarFactionID(session),
    });
  }

  return {
    record,
    joined,
    characterIDs: [...activity.activeCharacterIDs],
  };
}

function leaveChannel(session, roomName) {
  const record = ensureChannel(roomName);
  if (!record) {
    return {
      record: null,
      left: false,
      deleted: false,
    };
  }
  const characterID = getCharacterID(session);
  const activity = getActivityForRoom(record.roomName);
  const left = activity.activeCharacterIDs.delete(characterID);
  let deleted = false;
  if (record.destroyWhenEmpty && activity.activeCharacterIDs.size === 0) {
    chatStore.deleteChannelRecord(record.roomName);
    chatStore.clearBacklogEntries(record.roomName);
    roomActivity.delete(record.roomName);
    deleted = true;
  }
  return {
    record,
    left,
    deleted,
    characterIDs: [...activity.activeCharacterIDs],
  };
}

function getChannelBacklog(roomName, limit = 50, options = {}) {
  return chatStore.listBacklogEntries(roomName, limit, options);
}

function sendChannelMessage(session, roomName, message, options = {}) {
  const trimmedMessage = normalizeString(message, "").trim();
  if (!trimmedMessage) {
    return null;
  }
  const record = assertChannelAccess(session, roomName, options);
  const characterID = getCharacterID(session);
  const mutedEntry = record.mutedCharacters && record.mutedCharacters[String(characterID)];
  if (mutedEntry) {
    const error = new Error("Muted");
    error.code = "muted";
    throw error;
  }

  const entry = {
    roomName: record.roomName,
    characterID,
    characterName: normalizeString(
      session && (session.characterName || session.userName),
      "Unknown",
    ),
    message: trimmedMessage,
    createdAtMs: Date.now(),
    sender: buildCharacterSummary(session),
  };
  if (record.persistBacklog !== false) {
    chatStore.appendBacklogEntry(record.roomName, entry, {
      limit: record.backlogLimit,
    });
  }
  runtimeEmitter.emit("channel-message", {
    roomName: record.roomName,
    record,
    entry,
  });
  return {
    record,
    entry,
  };
}

function ensureCorpChannel(corporationID, options = {}) {
  const numericCorporationID = normalizePositiveInteger(corporationID, 0);
  if (!numericCorporationID) {
    return null;
  }
  return syncEnsuredChannel(`corp_${numericCorporationID}`, {
    displayName: "Corp",
    static: true,
    verifiedContract: true,
    contractSource: "client_verified",
    ...options,
  });
}

function ensureFleetChannel(fleetID, options = {}) {
  const numericFleetID = normalizePositiveInteger(fleetID, 0);
  if (!numericFleetID) {
    return null;
  }
  return syncEnsuredChannel(`fleet_${numericFleetID}`, {
    displayName: "Fleet",
    static: true,
    verifiedContract: true,
    contractSource: "client_verified",
    destroyWhenEmpty: true,
    ...options,
  });
}

function ensureResourceWarsChannel(instanceID, options = {}) {
  const numericInstanceID = normalizePositiveInteger(instanceID, 0);
  if (!numericInstanceID) {
    return null;
  }
  return syncEnsuredChannel(`resourcewars_${numericInstanceID}`, {
    displayName: "Resource Wars",
    static: true,
    verifiedContract: true,
    contractSource: "client_verified",
    destroyWhenEmpty: true,
    ...options,
  });
}

function ensurePlayerChannel(playerChannelID, options = {}) {
  const numericChannelID = normalizePositiveInteger(playerChannelID, 0);
  if (!numericChannelID) {
    return null;
  }
  deletedPlayerChannels.delete(`player_${numericChannelID}`);
  return syncEnsuredChannel(`player_${numericChannelID}`, {
    displayName: options.displayName || `Player Channel ${numericChannelID}`,
    static: false,
    verifiedContract: true,
    contractSource: "client_verified",
    inviteToken:
      normalizeString(options.inviteToken, "").trim() ||
      `player_${numericChannelID}`,
    ...options,
  });
}

function createPlayerChannel(session, options = {}) {
  const playerChannelID = chatStore.allocatePlayerChannelID();
  const roomName = `player_${playerChannelID}`;
  const ownerCharacterID = getCharacterID(session);
  deletedPlayerChannels.delete(roomName);
  const record = ensureChannel(roomName, {
    displayName: normalizeString(options.displayName, roomName),
    motd: normalizeString(options.motd, ""),
    password: normalizeString(options.password, ""),
    passwordRequired: Boolean(options.password),
    inviteToken:
      normalizeString(options.inviteToken, "").trim() || roomName,
    ownerCharacterID,
    adminCharacterIDs: dedupePositiveIntegers([
      ownerCharacterID,
      ...(options.adminCharacterIDs || []),
    ]),
    operatorCharacterIDs: dedupePositiveIntegers([
      ownerCharacterID,
      ...(options.operatorCharacterIDs || []),
    ]),
    invitedCharacters: dedupePositiveIntegers(options.invitedCharacters),
    inviteOnly: Boolean(options.inviteOnly),
    destroyWhenEmpty: Boolean(options.destroyWhenEmpty),
    static: false,
    verifiedContract: true,
    contractSource: "client_verified",
    metadata: {
      joinLink: `joinChannel:${roomName}`,
      inviteToken:
        normalizeString(options.inviteToken, "").trim() || roomName,
      ...(options.metadata && typeof options.metadata === "object"
        ? options.metadata
        : {}),
      },
  });
  chatStore.flushStateNow();
  return {
    channelID: playerChannelID,
    roomName,
    record,
  };
}

function ensurePrivateChannelForCharacters(leftCharacterID, rightCharacterID, options = {}) {
  const existing = chatStore.getPrivateChannelByPair(leftCharacterID, rightCharacterID);
  if (existing) {
    return syncEnsuredChannel(existing, options);
  }
  const pairMembers = dedupePositiveIntegers([leftCharacterID, rightCharacterID]);
  if (pairMembers.length !== 2) {
    return null;
  }
  const roomName = `private_${pairMembers[0]}_${pairMembers[1]}`;
  const privateConversationID = chatStore.allocatePrivateChannelID();
  const inviteToken =
    normalizeString(options.inviteToken, "").trim() ||
    `private_${privateConversationID}`;
  const record = syncEnsuredChannel(roomName, {
    ...options,
    displayName: "Private Chat",
    inviteOnly:
      options.inviteOnly !== undefined ? Boolean(options.inviteOnly) : true,
    static: false,
    verifiedContract: false,
    contractSource: "runtime",
    inviteToken,
    allowedParticipantCharacterIDs: pairMembers,
    adminCharacterIDs: pairMembers,
    operatorCharacterIDs: pairMembers,
    invitedCharacters: pairMembers,
    destroyWhenEmpty: false,
    metadata: {
      joinLink: `joinChannel:${roomName}`,
      inviteToken,
      privateConversationID,
      ...(options.metadata && typeof options.metadata === "object"
        ? options.metadata
        : {}),
    },
  });
  chatStore.setPrivateChannelByPair(pairMembers[0], pairMembers[1], roomName);
  chatStore.flushStateNow();
  return record;
}

function ensureIncursionChannel(taleID, options = {}) {
  const numericTaleID = normalizePositiveInteger(taleID, 0);
  if (!numericTaleID) {
    return null;
  }
  return syncEnsuredChannel(`incursion_${numericTaleID}`, {
    displayName: "Incursion",
    static: true,
    verifiedContract: true,
    contractSource: "client_verified",
    ...options,
  });
}

function ensureSpreadingIncursionChannel(taleID, options = {}) {
  const numericTaleID = normalizePositiveInteger(taleID, 0);
  if (!numericTaleID) {
    return null;
  }
  return syncEnsuredChannel(`spreadingIncursion_${numericTaleID}`, {
    displayName: "Spreading Incursion",
    static: true,
    verifiedContract: true,
    contractSource: "client_verified",
    ...options,
  });
}

function ensurePrivateChannelForInvite(session, targetCharacterID, options = {}) {
  return ensurePrivateChannelForCharacters(
    getCharacterID(session),
    targetCharacterID,
    options,
  );
}

function inviteCharacterToChannel(roomName, characterID) {
  return chatStore.updateChannelRecord(roomName, (record) => ({
    ...record,
    invitedCharacters: dedupePositiveIntegers([
      ...(record.invitedCharacters || []),
      characterID,
    ]),
  }));
}

function setChannelMotd(roomName, motd, options = {}) {
  return updateChannel(roomName, (record) => ({
    ...record,
    motd: normalizeString(motd, ""),
    updatedAtMs: Date.now(),
    metadata: {
      ...(record.metadata || {}),
      ...(options.metadata && typeof options.metadata === "object"
        ? options.metadata
        : {}),
    },
  }));
}

function muteChannelCharacter(roomName, characterID, durationMs, reason, byCharacterID = 0) {
  const normalizedDurationMs = Math.max(0, Number(durationMs) || 0);
  return updateChannel(roomName, (record) => ({
    ...record,
    mutedCharacters: {
      ...(record.mutedCharacters || {}),
      [String(normalizePositiveInteger(characterID, 0))]: {
        characterID: normalizePositiveInteger(characterID, 0),
        untilMs: normalizedDurationMs > 0 ? Date.now() + normalizedDurationMs : 0,
        reason: normalizeString(reason, ""),
        byCharacterID: normalizePositiveInteger(byCharacterID, 0),
        createdAtMs: Date.now(),
      },
    },
  }));
}

function unmuteChannelCharacter(roomName, characterID) {
  return updateChannel(roomName, (record) => {
    const mutedCharacters = { ...(record.mutedCharacters || {}) };
    delete mutedCharacters[String(normalizePositiveInteger(characterID, 0))];
    return {
      ...record,
      mutedCharacters,
    };
  });
}

function banChannelCharacter(roomName, characterID, durationMs, reason, byCharacterID = 0) {
  const normalizedDurationMs = Math.max(0, Number(durationMs) || 0);
  return updateChannel(roomName, (record) => ({
    ...record,
    bannedCharacters: {
      ...(record.bannedCharacters || {}),
      [String(normalizePositiveInteger(characterID, 0))]: {
        characterID: normalizePositiveInteger(characterID, 0),
        untilMs: normalizedDurationMs > 0 ? Date.now() + normalizedDurationMs : 0,
        reason: normalizeString(reason, ""),
        byCharacterID: normalizePositiveInteger(byCharacterID, 0),
        createdAtMs: Date.now(),
      },
    },
  }));
}

function unbanChannelCharacter(roomName, characterID) {
  return updateChannel(roomName, (record) => {
    const bannedCharacters = { ...(record.bannedCharacters || {}) };
    delete bannedCharacters[String(normalizePositiveInteger(characterID, 0))];
    return {
      ...record,
      bannedCharacters,
    };
  });
}

function grantChannelAdmin(roomName, characterID) {
  return updateChannel(roomName, (record) => ({
    ...record,
    adminCharacterIDs: dedupePositiveIntegers([
      ...(record.adminCharacterIDs || []),
      characterID,
    ]),
  }));
}

function revokeChannelAdmin(roomName, characterID) {
  return updateChannel(roomName, (record) => ({
    ...record,
    adminCharacterIDs: (record.adminCharacterIDs || []).filter(
      (candidate) => candidate !== normalizePositiveInteger(characterID, 0),
    ),
  }));
}

function setChannelOwner(roomName, ownerCharacterID) {
  return updateChannel(roomName, (record) => ({
    ...record,
    ownerCharacterID: normalizePositiveInteger(ownerCharacterID, 0),
    adminCharacterIDs: dedupePositiveIntegers([
      ...(record.adminCharacterIDs || []),
      ownerCharacterID,
    ]),
    operatorCharacterIDs: dedupePositiveIntegers([
      ...(record.operatorCharacterIDs || []),
      ownerCharacterID,
    ]),
  }));
}

function getLiveSessions() {
  return sessionRegistry.getSessions().filter((session) => (
    session &&
    (!session.socket || session.socket.destroyed !== true)
  ));
}

function getLocalSessionsForRoom(roomName) {
  const parsed = parseLocalChatRoomName(roomName);
  if (!parsed) {
    return [];
  }
  return getLiveSessions().filter((session) => (
    getCurrentSolarSystemID(session) === parsed.solarSystemID
  ));
}

function getVisibleLocalSessions(roomName) {
  const sessions = getLocalSessionsForRoom(roomName);
  if (!isDelayedLocalChatRoomName(roomName)) {
    return sessions;
  }
  const visibleCharacterIDs = delayedLocalSpeakers.get(roomName) || new Set();
  return sessions.filter((session) => visibleCharacterIDs.has(getCharacterID(session)));
}

function getEstimatedMemberCount(roomName) {
  if (isDelayedLocalChatRoomName(roomName)) {
    return 0;
  }
  return getVisibleLocalSessions(roomName).length;
}

function getLocalGatewayMembershipPayload(session) {
  const roomName = getLocalChatRoomNameForSession(session);
  return {
    roomName,
    solarSystemID: getCurrentSolarSystemID(session),
    members: getVisibleLocalSessions(roomName).map(buildLocalGatewayMember),
  };
}

function trackLocalSpeaker(session) {
  const roomName = getLocalChatRoomNameForSession(session);
  const characterID = getCharacterID(session);
  if (!roomName || !characterID) {
    return {
      roomName,
      characterID,
      becameVisible: false,
    };
  }
  if (!delayedLocalSpeakers.has(roomName)) {
    delayedLocalSpeakers.set(roomName, new Set());
  }
  const visibleSpeakers = delayedLocalSpeakers.get(roomName);
  const becameVisible = !visibleSpeakers.has(characterID);
  visibleSpeakers.add(characterID);
  if (becameVisible && isDelayedLocalChatRoomName(roomName)) {
    runtimeEmitter.emit("local-join", {
      roomName,
      solarSystemID: getCurrentSolarSystemID(session),
      member: buildLocalGatewayMember(session),
      summary: buildCharacterSummary(session),
    });
  }
  return {
    roomName,
    characterID,
    becameVisible,
  };
}

function forgetLocalSpeaker(session, options = {}) {
  const roomName = normalizeString(options.roomName, "").trim() || getLocalChatRoomNameForSession(session);
  const characterID = getCharacterID(session);
  if (!roomName || !characterID) {
    return false;
  }
  const visibleSpeakers = delayedLocalSpeakers.get(roomName);
  if (!visibleSpeakers) {
    return false;
  }
  const removed = visibleSpeakers.delete(characterID);
  if (visibleSpeakers.size === 0) {
    delayedLocalSpeakers.delete(roomName);
  }
  if (removed && isDelayedLocalChatRoomName(roomName)) {
    runtimeEmitter.emit("local-leave", {
      roomName,
      solarSystemID:
        normalizePositiveInteger(options.solarSystemID, 0) ||
        (parseLocalChatRoomName(roomName) || {}).solarSystemID ||
        0,
      characterID,
    });
  }
  return removed;
}

function joinLocalLsc(session) {
  const roomName = getLocalChatRoomNameForSession(session);
  if (!localLscMembership.has(roomName)) {
    localLscMembership.set(roomName, new Set());
  }
  const members = localLscMembership.get(roomName);
  const joined = !members.has(session);
  members.add(session);
  if (joined) {
    publishLocalMembershipListForSession(session);
    if (!isDelayedLocalChatRoomName(roomName)) {
      runtimeEmitter.emit("local-join", {
        roomName,
        solarSystemID: getCurrentSolarSystemID(session),
        member: buildLocalGatewayMember(session),
        summary: buildCharacterSummary(session),
      });
    }
  }
  return {
    roomName,
    joined,
    sessions: [...members].filter((candidate) => (
      candidate && candidate.socket && !candidate.socket.destroyed
    )),
  };
}

function leaveLocalLsc(session, options = {}) {
  const roomName = normalizeString(options.roomName, "").trim() || getLocalChatRoomNameForSession(session);
  const members = localLscMembership.get(roomName);
  if (!members) {
    forgetLocalSpeaker(session, options);
    return {
      roomName,
      left: false,
      sessions: [],
    };
  }
  const left = members.delete(session);
  if (members.size === 0) {
    localLscMembership.delete(roomName);
  }
  forgetLocalSpeaker(session, options);
  return {
    roomName,
    left,
    sessions: members
      ? [...members].filter((candidate) => (
          candidate && candidate.socket && !candidate.socket.destroyed
        ))
      : [],
  };
}

function moveLocalLsc(session, previousChannelID = 0) {
  const oldChannelID = normalizePositiveInteger(previousChannelID, 0);
  const newSolarSystemID = getCurrentSolarSystemID(session);
  const newRoomName = getLocalChatRoomNameForSolarSystemID(newSolarSystemID);
  if (!oldChannelID || oldChannelID === newSolarSystemID) {
    publishLocalMembershipListForSession(session);
    return {
      moved: false,
      previousRoomName: oldChannelID
        ? getLocalChatRoomNameForSolarSystemID(oldChannelID)
        : "",
      newRoomName,
      oldSolarSystemID: oldChannelID,
      newSolarSystemID,
    };
  }
  const previousRoomName = getLocalChatRoomNameForSolarSystemID(oldChannelID);
  leaveLocalLsc(session, {
    roomName: previousRoomName,
    solarSystemID: oldChannelID,
  });
  joinLocalLsc(session);
  if (!isDelayedLocalChatRoomName(previousRoomName)) {
    runtimeEmitter.emit("local-leave", {
      roomName: previousRoomName,
      solarSystemID: oldChannelID,
      characterID: getCharacterID(session),
    });
  }
  if (!isDelayedLocalChatRoomName(newRoomName)) {
    runtimeEmitter.emit("local-join", {
      roomName: newRoomName,
      solarSystemID: newSolarSystemID,
      member: buildLocalGatewayMember(session),
      summary: buildCharacterSummary(session),
    });
  }
  publishLocalMembershipListForSession(session);
  return {
    moved: true,
    previousRoomName,
    newRoomName,
    oldSolarSystemID: oldChannelID,
    newSolarSystemID,
  };
}

function unregisterSession(session) {
  const characterID = getCharacterID(session);
  const solarSystemID = getCurrentSolarSystemID(session);
  const roomName = getLocalChatRoomNameForSession(session);

  for (const [trackedRoomName, members] of localLscMembership.entries()) {
    if (!members.has(session)) {
      continue;
    }
    members.delete(session);
    if (members.size === 0) {
      localLscMembership.delete(trackedRoomName);
    }
  }

  const delayedLeave = forgetLocalSpeaker(session, {
    roomName,
    solarSystemID,
  });
  if (!isDelayedLocalChatRoomName(roomName) || delayedLeave) {
    runtimeEmitter.emit("local-leave", {
      roomName,
      solarSystemID,
      characterID,
    });
  }

  for (const [roomKey, activity] of roomActivity.entries()) {
    if (!activity.activeCharacterIDs.delete(characterID)) {
      continue;
    }
    const record = ensureChannel(roomKey);
    if (!record) {
      continue;
    }
    if (record.destroyWhenEmpty && activity.activeCharacterIDs.size === 0) {
      chatStore.deleteChannelRecord(roomKey);
      chatStore.clearBacklogEntries(roomKey);
      roomActivity.delete(roomKey);
    }
  }
}

function publishLocalMembershipListForSession(session) {
  const payload = getLocalGatewayMembershipPayload(session);
  runtimeEmitter.emit("local-membership-list", {
    targetCharacterID: getCharacterID(session),
    roomName: payload.roomName,
    solarSystemID: payload.solarSystemID,
    members: payload.members,
  });
  return payload;
}

function publishLocalMembershipRefresh(session) {
  const roomName = getLocalChatRoomNameForSession(session);
  runtimeEmitter.emit("local-membership-refresh", {
    roomName,
    solarSystemID: getCurrentSolarSystemID(session),
    member: buildLocalGatewayMember(session),
    summary: buildCharacterSummary(session),
  });
}

function broadcastLocalMessage(session, message) {
  const roomName = getLocalChatRoomNameForSession(session);
  const result = sendChannelMessage(session, roomName, message);
  trackLocalSpeaker(session);
  runtimeEmitter.emit("local-message", {
    roomName,
    solarSystemID: getCurrentSolarSystemID(session),
    authorCharacterID: getCharacterID(session),
    message: result.entry.message,
    entry: result.entry,
  });
  return result;
}

function muteLocalCharacter(session, characterID, durationMs, reason) {
  const roomName = getLocalChatRoomNameForSession(session);
  return muteChannelCharacter(
    roomName,
    characterID,
    durationMs,
    reason,
    getCharacterID(session),
  );
}

function updateChannel(roomName, mutator) {
  const record = ensureChannel(roomName);
  if (!record) {
    return null;
  }
  return chatStore.updateChannelRecord(record.roomName, (currentRecord) => {
    const nextRecord = mutator ? mutator(currentRecord) : currentRecord;
    return {
      ...nextRecord,
      roomName: record.roomName,
      updatedAtMs: Date.now(),
    };
  });
}

function deleteChannel(roomName, options = {}) {
  const record = ensureChannel(roomName);
  if (!record) {
    return false;
  }
  roomActivity.delete(record.roomName);
  if (record.type === "player" && /^player_\d+$/i.test(record.roomName)) {
    deletedPlayerChannels.add(record.roomName);
  }
  if (options.clearBacklog !== false) {
    chatStore.clearBacklogEntries(record.roomName);
  }
  return chatStore.deleteChannelRecord(record.roomName);
}

function getChannelsForStaticAccess(session) {
  const channels = [];
  const localRoomName = getLocalChatRoomNameForSession(session);
  if (localRoomName) {
    channels.push(localRoomName);
  }

  const allianceID = getAllianceID(session);
  const corporationID = getCorporationID(session);
  const warFactionID = getWarFactionID(session);
  if (allianceID > 0) {
    const allianceRecord = ensureAllianceChannel(allianceID);
    if (allianceRecord) {
      channels.push(allianceRecord.roomName);
    }
    chatStore.recordStaticContractObservation(`alliance_${allianceID}`, {
      source: "resync_discovery",
      characterID: getCharacterID(session),
      note: "alliance channel served via active alliance membership",
    });
  }

  if (corporationID > 0) {
    const corpRecord = ensureCorpChannel(corporationID);
    if (corpRecord) {
      channels.push(corpRecord.roomName);
    }
  }

  const fleetID = getFleetID(session);
  if (fleetID > 0) {
    const fleetRecord = ensureFleetChannel(fleetID);
    if (fleetRecord) {
      channels.push(fleetRecord.roomName);
    }
  }

  if (warFactionID > 0) {
    const factionRecord = ensureFactionChannel(warFactionID);
    if (factionRecord) {
      channels.push(factionRecord.roomName);
    }
    chatStore.recordStaticContractObservation(`faction_${warFactionID}`, {
      source: "resync_discovery",
      characterID: getCharacterID(session),
      note: "faction channel served via active militia membership",
    });
  }
  return channels.filter(Boolean);
}

function sortDiscoverableConferenceRecords(left, right) {
  const leftFeaturedOrder = Number(left && left.metadata && left.metadata.featuredOrder) || 0;
  const rightFeaturedOrder = Number(right && right.metadata && right.metadata.featuredOrder) || 0;
  if (leftFeaturedOrder !== rightFeaturedOrder) {
    return leftFeaturedOrder - rightFeaturedOrder;
  }

  const leftIsStatic = left && left.static === true;
  const rightIsStatic = right && right.static === true;
  if (leftIsStatic !== rightIsStatic) {
    return leftIsStatic ? -1 : 1;
  }

  if (!leftIsStatic && !rightIsStatic) {
    const updatedDelta =
      Math.max(0, Number(right.updatedAtMs) || 0) -
      Math.max(0, Number(left.updatedAtMs) || 0);
    if (updatedDelta !== 0) {
      return updatedDelta;
    }
  }

  const displayDelta = String(left.displayName || left.roomName || "")
    .localeCompare(String(right.displayName || right.roomName || ""));
  if (displayDelta !== 0) {
    return displayDelta;
  }

  return String(left.roomName || "").localeCompare(String(right.roomName || ""));
}

function getDiscoverableStaticChannelRecords() {
  return listDiscoverableStaticChannelContracts()
    .map((contract) => ensureChannel(contract.roomName, contract))
    .filter(Boolean);
}

function canDiscoverPlayerChannel(session, record) {
  if (!record || record.type !== "player") {
    return false;
  }

  const failure = getChannelAccessFailure(session, record, {
    providedPassword: record.passwordRequired ? record.password || "" : "",
  });
  return !failure;
}

function listDiscoverablePlayerChannels(session) {
  return chatStore.listChannelRecords()
    .filter((record) => canDiscoverPlayerChannel(session, record))
    .sort(sortDiscoverableConferenceRecords);
}

function findDiscoverablePlayerChannelsByDisplayName(session, displayName) {
  const normalizedDisplayName = normalizeString(displayName, "").trim().toLowerCase();
  if (!normalizedDisplayName) {
    return [];
  }

  return listDiscoverablePlayerChannels(session)
    .filter((record) => {
      const candidateDisplayName = normalizeString(
        record.displayName,
        record.roomName,
      ).trim().toLowerCase();
      const candidateRoomName = normalizeString(record.roomName, "")
        .trim()
        .toLowerCase();
      return (
        candidateDisplayName === normalizedDisplayName ||
        candidateRoomName === normalizedDisplayName
      );
    });
}

function listDiscoverableConferenceChannels(session) {
  const discoverableRecords = new Map();

  for (const record of getDiscoverableStaticChannelRecords()) {
    discoverableRecords.set(record.roomName, record);
  }

  for (const record of session ? listDiscoverablePlayerChannels(session) : []) {
    discoverableRecords.set(record.roomName, record);
  }

  return [...discoverableRecords.values()].sort(sortDiscoverableConferenceRecords);
}

function findDiscoverableConferenceChannelsByDisplayName(session, displayName) {
  const normalizedDisplayName = normalizeString(displayName, "").trim().toLowerCase();
  if (!normalizedDisplayName) {
    return [];
  }

  return listDiscoverableConferenceChannels(session)
    .filter((record) => {
      const candidateDisplayName = normalizeString(
        record.displayName,
        record.roomName,
      ).trim().toLowerCase();
      const candidateRoomName = normalizeString(record.roomName, "")
        .trim()
        .toLowerCase();
      return (
        candidateDisplayName === normalizedDisplayName ||
        candidateRoomName === normalizedDisplayName
      );
    });
}

function resetRuntimeState(options = {}) {
  roomActivity.clear();
  delayedLocalSpeakers.clear();
  localLscMembership.clear();
  deletedPlayerChannels.clear();
  if (options.resetStore !== false && typeof chatStore.resetAll === "function") {
    chatStore.resetAll({
      removeFiles: options.removeFiles === true,
      flush: Boolean(options.flush),
    });
  }
  return true;
}

function ensureAllianceChannel(allianceID, options = {}) {
  const numericAllianceID = normalizePositiveInteger(allianceID, 0);
  if (!numericAllianceID) {
    return null;
  }
  return syncEnsuredChannel(`alliance_${numericAllianceID}`, {
    displayName: "Alliance",
    static: true,
    verifiedContract: false,
    contractSource: "discovered",
    ...options,
  });
}

function ensureFactionChannel(factionID, options = {}) {
  const numericFactionID = normalizePositiveInteger(factionID, 0);
  if (!numericFactionID) {
    return null;
  }
  return syncEnsuredChannel(`faction_${numericFactionID}`, {
    displayName: "Militia",
    static: true,
    verifiedContract: false,
    contractSource: "discovered",
    ...options,
  });
}

function getLocalLscSessions(roomName) {
  return [...(localLscMembership.get(roomName) || new Set())].filter((session) => (
    session && session.socket && !session.socket.destroyed
  ));
}

function getActiveCharacterIDsForRoom(roomName) {
  const activity = getActivityForRoom(roomName);
  return [...activity.activeCharacterIDs];
}

module.exports = {
  on: runtimeEmitter.on.bind(runtimeEmitter),
  off: runtimeEmitter.off.bind(runtimeEmitter),
  once: runtimeEmitter.once.bind(runtimeEmitter),
  assertChannelAccess,
  banChannelCharacter,
  broadcastLocalMessage,
  buildCharacterSummary,
  buildLocalGatewayMember,
  canDestroyChannel,
  classifyRole,
  createPlayerChannel,
  deleteChannel,
  ensureAllianceChannel,
  ensureChannel,
  ensureCorpChannel,
  ensureFactionChannel,
  ensureFleetChannel,
  ensureIncursionChannel,
  ensurePlayerChannel,
  ensurePrivateChannelForCharacters,
  ensurePrivateChannelForInvite,
  ensureResourceWarsChannel,
  ensureSpreadingIncursionChannel,
  forgetLocalSpeaker,
  getActiveCharacterIDsForRoom,
  getChannel,
  getChannelBacklog,
  getChannelsForStaticAccess,
  listChannelTemporaryRestrictions,
  findDiscoverableConferenceChannelsByDisplayName,
  findDiscoverablePlayerChannelsByDisplayName,
  getEstimatedMemberCount,
  getLocalGatewayMembershipPayload,
  getLocalLscSessions,
  getLocalSessionsForRoom,
  getVisibleLocalSessions,
  grantChannelAdmin,
  inviteCharacterToChannel,
  isChannelAdmin,
  joinChannel,
  joinLocalLsc,
  leaveChannel,
  leaveLocalLsc,
  moveLocalLsc,
  muteChannelCharacter,
  muteLocalCharacter,
  publishLocalMembershipListForSession,
  publishLocalMembershipRefresh,
  revokeChannelAdmin,
  sendChannelMessage,
  setChannelMotd,
  setChannelOwner,
  trackLocalSpeaker,
  unbanChannelCharacter,
  unregisterSession,
  unmuteChannelCharacter,
  updateChannel,
  listDiscoverableConferenceChannels,
  listDiscoverablePlayerChannels,
  getVerifiedStaticChannels,
  _testing: {
    resetRuntimeState,
  },
};
