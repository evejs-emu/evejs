const fs = require("fs");
const path = require("path");
const tls = require("tls");

const log = require(path.join(__dirname, "../../utils/logger"));
const rotatingLog = require(path.join(__dirname, "../../utils/rotatingLog"));
const config = require(path.join(__dirname, "../../config"));
const sessionRegistry = require(path.join(__dirname, "./sessionRegistry"));
const chatRuntime = require(path.join(
  __dirname,
  "../../_secondary/chat/chatRuntime",
));
const chatStore = require(path.join(
  __dirname,
  "../../_secondary/chat/chatStore",
));
const {
  getLocalChatRoomNameForSession,
  getLocalChatRoomNameForSolarSystemID,
  isDelayedLocalChatRoomName,
  isLocalChatRoomName,
  parseLocalChatRoomName,
} = require(path.join(__dirname, "./channelRules"));
const { getCharacterRecord, toBigInt } = require(path.join(
  __dirname,
  "../character/characterState",
));
const { executeChatCommand, DEFAULT_MOTD_MESSAGE } = require(path.join(
  __dirname,
  "./chatCommands",
));
const {
  buildXmppConferenceJid,
  buildXmppUserJid,
  escapeRegExp,
  getXmppConferenceDomain,
  getXmppDomain,
} = require(path.join(__dirname, "./xmppConfig"));

let server = null;
let messageSequence = 0;

const connectedClients = new Set();
const roomMembers = new Map();
const transcriptDir = path.join(__dirname, "../../../logs");
const transcriptPath = path.join(transcriptDir, "xmpp-stub.log");
const certDir = path.join(__dirname, "../../../certs");
const certPath = path.join(certDir, "xmpp-dev-cert.pem");
const keyPath = path.join(certDir, "xmpp-dev-key.pem");

function ensureTranscriptDir() {
  if (!fs.existsSync(transcriptDir)) {
    fs.mkdirSync(transcriptDir, { recursive: true });
  }
}

function readTlsCredentials() {
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    throw new Error(
      `Missing XMPP TLS certificate files at ${certDir}`,
    );
  }

  return {
    cert: fs.readFileSync(certPath, "utf8"),
    key: fs.readFileSync(keyPath, "utf8"),
  };
}

function writeTranscript(direction, xml) {
  if (!log.isVerboseDebugEnabled()) {
    return;
  }
  try {
    rotatingLog.append(transcriptPath, `[${new Date().toISOString()}] ${direction} ${xml}\n`);
  } catch (error) {
    log.warn(`[XMPP] Failed to write transcript: ${error.message}`);
  }
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXml(value) {
  return String(value ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
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

function extractId(xml) {
  const match = /id=['"]([^'"]+)['"]/i.exec(xml);
  return match ? match[1] : "evejs";
}

function extractAttr(xml, name) {
  const pattern = new RegExp(`${name}=['"]([^'"]+)['"]`, "i");
  const match = pattern.exec(xml);
  return match ? decodeXml(match[1]) : "";
}

function extractAttrFromFragment(xmlFragment, name) {
  return extractAttr(xmlFragment, name);
}

function extractBody(xml) {
  const match = /<body>([\s\S]*?)<\/body>/i.exec(xml);
  return match ? decodeXml(match[1]).trim() : "";
}

function extractSubject(xml) {
  const match = /<subject>([\s\S]*?)<\/subject>/i.exec(xml);
  return match ? decodeXml(match[1]).trim() : "";
}

function extractMucPassword(xml) {
  const match = /<password>([\s\S]*?)<\/password>/i.exec(xml);
  return match ? decodeXml(match[1]).trim() : "";
}

function extractMucHistorySeconds(xml) {
  const match = /<history\b[^>]*\bseconds=['"]([^'"]+)['"]/i.exec(xml);
  if (!match) {
    return 0;
  }
  const historySeconds = Math.max(0, Number(match[1]) || 0);
  return Number.isFinite(historySeconds) ? historySeconds : 0;
}

function extractInviteTargetJid(xml) {
  const match = /<invite[^>]*\bto=['"]([^'"]+)['"]/i.exec(xml);
  return match ? decodeXml(match[1]).trim() : "";
}

function extractInviteReason(xml) {
  const match = /<reason>([\s\S]*?)<\/reason>/i.exec(xml);
  return match ? decodeXml(match[1]).trim() : "";
}

function parsePlainAuth(xml) {
  const match = /<auth[^>]*>([\s\S]*?)<\/auth>/i.exec(xml);
  if (!match) {
    return { userName: "capsuleer", password: "" };
  }

  try {
    const decoded = Buffer.from(match[1].trim(), "base64").toString("utf8");
    const parts = decoded.split("\u0000");
    return {
      userName: parts[1] || parts[0] || "capsuleer",
      password: parts[2] || "",
    };
  } catch (error) {
    log.warn(`[XMPP] Failed to decode SASL auth payload: ${error.message}`);
    return { userName: "capsuleer", password: "" };
  }
}

function buildBoundJid(client) {
  return buildXmppUserJid(client.userName || "capsuleer", "evejs");
}

function nextMessageId() {
  messageSequence += 1;
  return `evejs-${Date.now()}-${messageSequence}`;
}

function sendXml(client, xml) {
  if (!client.socket || client.socket.destroyed) {
    return;
  }

  client.socket.write(xml);
  writeTranscript("OUT", xml);
}

function getClientRoomBacklogCursorMap(client) {
  if (!client) {
    return null;
  }
  if (!(client.roomBacklogCursorMs instanceof Map)) {
    client.roomBacklogCursorMs = new Map();
  }
  return client.roomBacklogCursorMs;
}

function noteRoomMessageDelivered(client, roomJid, createdAtMs = Date.now()) {
  if (!client || !roomJid) {
    return;
  }

  const cursorMap = getClientRoomBacklogCursorMap(client);
  if (!(cursorMap instanceof Map)) {
    return;
  }

  const normalizedCreatedAtMs = Math.max(0, Number(createdAtMs) || 0);
  const previousCreatedAtMs = Math.max(
    0,
    Number(cursorMap.get(roomJid)) || 0,
  );
  if (normalizedCreatedAtMs > previousCreatedAtMs) {
    cursorMap.set(roomJid, normalizedCreatedAtMs);
  }
}

function getRoomJid(target) {
  if (!target) {
    return "";
  }

  return String(target).split("/")[0];
}

function getRoomNick(target, fallback) {
  if (!target || !target.includes("/")) {
    return fallback;
  }

  return target.split("/").slice(1).join("/") || fallback;
}

function getLocalRoomNameForSession(session) {
  return getLocalChatRoomNameForSession(session);
}

function getCorpRoomNameForSession(session) {
  const corpID = Number(
    (session && (session.corporationID || session.corpid)) || 0,
  );
  return corpID > 0 ? `corp_${corpID}` : "";
}

function getFleetRoomNameForSession(session) {
  const fleetID = Number((session && session.fleetid) || 0);
  return fleetID > 0 ? `fleet_${fleetID}` : "";
}

function getAllianceRoomNameForSession(session) {
  const allianceID = Number(
    (session && (session.allianceID || session.allianceid)) || 0,
  );
  return allianceID > 0 ? `alliance_${allianceID}` : "";
}

function getFactionRoomNameForSession(session) {
  const factionID = Number(
    (session && (session.warFactionID || session.warfactionid)) || 0,
  );
  return factionID > 0 ? `faction_${factionID}` : "";
}

function getSessionScopedRoomMap(session) {
  const roomMap = new Map();
  const corpRoomName = getCorpRoomNameForSession(session);
  const fleetRoomName = getFleetRoomNameForSession(session);
  const allianceRoomName = getAllianceRoomNameForSession(session);
  const factionRoomName = getFactionRoomNameForSession(session);

  if (corpRoomName) {
    roomMap.set("corp", corpRoomName);
  }
  if (fleetRoomName) {
    roomMap.set("fleet", fleetRoomName);
  }
  if (allianceRoomName) {
    roomMap.set("alliance", allianceRoomName);
  }
  if (factionRoomName) {
    roomMap.set("faction", factionRoomName);
  }

  return roomMap;
}

function getSessionScopedRoomNames(session) {
  const roomNames = new Set(chatRuntime.getChannelsForStaticAccess(session));
  for (const roomName of getSessionScopedRoomMap(session).values()) {
    roomNames.add(roomName);
  }
  return roomNames;
}

function isSessionScopedRoomKind(kind) {
  return (
    kind === "corp" ||
    kind === "fleet" ||
    kind === "alliance" ||
    kind === "faction"
  );
}

function getLocalRoomNameForClient(client) {
  const session = findSessionForClient(client);
  return getLocalRoomNameForSession(session);
}

function buildConferenceRoomJid(roomName) {
  return buildXmppConferenceJid(roomName);
}

function isConferenceServiceJid(value) {
  const normalizedValue = String(value || "").trim().toLowerCase();
  const conferenceDomain = getXmppConferenceDomain().toLowerCase();
  return (
    normalizedValue === conferenceDomain ||
    normalizedValue === `${conferenceDomain}@${conferenceDomain}`
  );
}

function sanitizeRoomLabel(value, fallback = "Channel") {
  const normalizedValue = String(value || "").trim();
  if (
    !normalizedValue ||
    normalizedValue === "[object Object]" ||
    isConferenceServiceJid(normalizedValue)
  ) {
    const normalizedFallback = String(fallback || "").trim();
    return normalizedFallback || "Channel";
  }
  return normalizedValue;
}

function addUniqueCharacterID(values = [], characterID) {
  const numericCharacterID = Number(characterID || 0);
  if (!Number.isInteger(numericCharacterID) || numericCharacterID <= 0) {
    return [...new Set(values)];
  }
  return [...new Set([...(Array.isArray(values) ? values : []), numericCharacterID])]
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((left, right) => left - right);
}

function normalizeRoomJid(roomJid, client = null) {
  const rawRoomJid = String(roomJid || "").trim();
  if (!rawRoomJid) {
    const fallbackRoomName = client
      ? getLocalRoomNameForClient(client)
      : getLocalRoomNameForSession(null);
    return buildConferenceRoomJid(fallbackRoomName);
  }

  if (isConferenceServiceJid(rawRoomJid)) {
    return getXmppConferenceDomain();
  }

  const conferenceDomain = getXmppConferenceDomain();
  if (rawRoomJid === "local" || rawRoomJid === `local@${conferenceDomain}`) {
    return buildConferenceRoomJid(
      client ? getLocalRoomNameForClient(client) : getLocalRoomNameForSession(null),
    );
  }

  if (rawRoomJid === "corp" || rawRoomJid === `corp@${conferenceDomain}`) {
    const session = client ? findSessionForClient(client) : null;
    return buildConferenceRoomJid(getCorpRoomNameForSession(session));
  }

  if (rawRoomJid === "fleet" || rawRoomJid === `fleet@${conferenceDomain}`) {
    const session = client ? findSessionForClient(client) : null;
    const roomName = getFleetRoomNameForSession(session);
    return roomName ? buildConferenceRoomJid(roomName) : rawRoomJid;
  }

  if (
    rawRoomJid === "alliance" ||
    rawRoomJid === `alliance@${conferenceDomain}`
  ) {
    const session = client ? findSessionForClient(client) : null;
    const roomName = getAllianceRoomNameForSession(session);
    return roomName ? buildConferenceRoomJid(roomName) : rawRoomJid;
  }

  if (
    rawRoomJid === "militia" ||
    rawRoomJid === `militia@${conferenceDomain}` ||
    rawRoomJid === "faction" ||
    rawRoomJid === `faction@${conferenceDomain}`
  ) {
    const session = client ? findSessionForClient(client) : null;
    const roomName = getFactionRoomNameForSession(session);
    return roomName ? buildConferenceRoomJid(roomName) : rawRoomJid;
  }

  const aliasedRoomJid = normalizeLegacyConferenceRoomJid(rawRoomJid);
  if (aliasedRoomJid !== rawRoomJid) {
    return aliasedRoomJid;
  }

  if (!rawRoomJid.includes("@")) {
    return buildConferenceRoomJid(rawRoomJid);
  }

  const legacyLocalMatch = new RegExp(
    `^solarsystemid2?_(\\d+)@${escapeRegExp(getXmppConferenceDomain())}$`,
    "i",
  ).exec(
    rawRoomJid,
  );
  if (legacyLocalMatch) {
    return buildConferenceRoomJid(
      getLocalChatRoomNameForSolarSystemID(legacyLocalMatch[1]),
    );
  }

  const legacyCorpMatch = new RegExp(
    `^corpid_(\\d+)@${escapeRegExp(getXmppConferenceDomain())}$`,
    "i",
  ).exec(rawRoomJid);
  if (legacyCorpMatch) {
    return buildConferenceRoomJid(`corp_${legacyCorpMatch[1]}`);
  }

  return rawRoomJid;
}

function normalizeLegacyConferenceRoomJid(roomJid) {
  const normalizedRoomJid = String(roomJid || "").trim();
  if (!normalizedRoomJid) {
    return normalizedRoomJid;
  }

  if (!normalizedRoomJid.includes("@")) {
    const aliasedRoomName = chatStore.resolveRoomNameAlias(normalizedRoomJid);
    return aliasedRoomName && aliasedRoomName !== normalizedRoomJid
      ? buildConferenceRoomJid(aliasedRoomName)
      : normalizedRoomJid;
  }

  const atIndex = normalizedRoomJid.indexOf("@");
  const roomName = normalizedRoomJid.slice(0, atIndex);
  const suffix = normalizedRoomJid.slice(atIndex);
  const aliasedRoomName = chatStore.resolveRoomNameAlias(roomName);
  return aliasedRoomName && aliasedRoomName !== roomName
    ? `${aliasedRoomName}${suffix}`
    : normalizedRoomJid;
}

function getRoomDescriptor(roomJid, client = null) {
  const normalizedRoomJid = normalizeRoomJid(roomJid, client);
  if (isConferenceServiceJid(normalizedRoomJid)) {
    return {
      normalizedRoomJid: getXmppConferenceDomain(),
      roomName: "",
      kind: "service",
      roomID: 0,
      suppressPresenceBroadcast: false,
      record: null,
    };
  }
  const roomName = String(normalizedRoomJid || "")
    .split("@")[0]
    .toLowerCase();
  const parsedLocalRoom = parseLocalChatRoomName(roomName);
  if (parsedLocalRoom) {
    return {
      normalizedRoomJid,
      roomName: parsedLocalRoom.roomName,
      kind: "local",
      roomID: parsedLocalRoom.solarSystemID,
      suppressPresenceBroadcast: isDelayedLocalChatRoomName(parsedLocalRoom.roomName),
      record: chatRuntime.getChannel(parsedLocalRoom.roomName),
    };
  }

  const corpMatch = /^corp_(\d+)$/i.exec(roomName);
  if (corpMatch) {
    const record = chatRuntime.getChannel(roomName);
    return {
      normalizedRoomJid,
      roomName,
      kind: "corp",
      roomID: Number(corpMatch[1] || 0),
      suppressPresenceBroadcast: false,
      record,
    };
  }

  const record = roomName ? chatRuntime.getChannel(roomName) : null;

  return {
    normalizedRoomJid,
    roomName,
    kind: record ? record.type : "other",
    roomID: record ? Number(record.entityID || 0) || 0 : 0,
    suppressPresenceBroadcast: false,
    record,
  };
}

function findSessionForClient(client) {
  const expectedUser = String(client.userName || "").trim().toLowerCase();
  const expectedCharId = Number.parseInt(expectedUser, 10);
  if (!expectedUser) {
    return null;
  }

  if (
    Number.isInteger(expectedCharId) &&
    expectedCharId > 0 &&
    typeof sessionRegistry.findSessionByCharacterID === "function"
  ) {
    const matchedSession = sessionRegistry.findSessionByCharacterID(expectedCharId);
    if (matchedSession) {
      return matchedSession;
    }
  }

  return (
    sessionRegistry.getSessions().find((session) => {
      return (
        String(session.userName || "").trim().toLowerCase() === expectedUser ||
        String(session.userid || "").trim().toLowerCase() === expectedUser ||
        (Number.isInteger(expectedCharId) &&
          expectedCharId > 0 &&
          Number(session.characterID || 0) === expectedCharId)
      );
    }) || null
  );
}

function parseCharacterId(value) {
  const numeric = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return null;
  }

  return numeric;
}

function getClientCharacterId(client, session = null) {
  const matchedSession = session || findSessionForClient(client);
  if (
    matchedSession &&
    Number.isInteger(Number(matchedSession.characterID || 0)) &&
    Number(matchedSession.characterID || 0) > 0
  ) {
    return Number(matchedSession.characterID);
  }

  return parseCharacterId(client.userName);
}

function buildOwnerInfo(charData, charId) {
  return JSON.stringify({
    ownerID: charId,
    ownerName: charData.characterName || String(charId),
    name: charData.characterName || String(charId),
    typeID: charData.typeID || 1373,
  });
}

function getUserDataForCharacterId(charId) {
  if (!charId) {
    return null;
  }

  const charData = getCharacterRecord(charId);
  if (!charData) {
    return null;
  }

  const session =
    sessionRegistry.getSessions().find(
      (candidate) => Number(candidate.characterID || 0) === Number(charId),
    ) || null;

  return {
    charId,
    userJid: buildXmppUserJid(charId),
    characterName: charData.characterName || String(charId),
    corporationID: Number(charData.corporationID || 0),
    allianceID: Number(charData.allianceID || 0),
    // warFactionID means militia enlistment, not the character's empire faction.
    warFactionID: Number(charData.warFactionID || 0),
    typeID: Number(charData.typeID || 1373),
    role: toBigInt(session ? session.role || 0 : 0),
    info: buildOwnerInfo(charData, charId),
  };
}

function getUserDataForJid(jid) {
  const user = String(jid || "").split("@")[0];
  const charId = parseCharacterId(user);
  return getUserDataForCharacterId(charId);
}

function buildEveUserDataElement(userData) {
  if (!userData) {
    return "<eve_user_data corpid='0' allianceid='0' warfactionid='0' typeid='1373' role='0'/>";
  }

  return [
    "<eve_user_data",
    ` corpid='${escapeXml(userData.corporationID)}'`,
    ` allianceid='${escapeXml(userData.allianceID)}'`,
    ` warfactionid='${escapeXml(userData.warFactionID)}'`,
    ` typeid='${escapeXml(userData.typeID)}'`,
    ` role='${escapeXml(userData.role)}'`,
    ` info='${escapeXml(userData.info)}'`,
    "/>",
  ].join("");
}

function addRoomMember(roomJid, client) {
  if (!roomJid) {
    return;
  }

  if (!roomMembers.has(roomJid)) {
    roomMembers.set(roomJid, new Set());
  }

  roomMembers.get(roomJid).add(client);
  client.rooms.add(roomJid);
}

function getDistinctRoomCharacterIds(roomJid) {
  const members = roomMembers.get(roomJid);
  if (!members || members.size === 0) {
    return [];
  }

  const seenCharacterIDs = new Set();
  const characterIDs = [];
  for (const member of members) {
    const characterID = getClientCharacterId(member);
    if (!characterID || seenCharacterIDs.has(characterID)) {
      continue;
    }

    seenCharacterIDs.add(characterID);
    characterIDs.push(characterID);
  }

  return characterIDs;
}

function getConnectedClientsForLocalRoom(
  roomName,
  { excludeClient = null, roomJid = "" } = {},
) {
  const normalizedRoomName = normalizeString(roomName, "").trim();
  if (!normalizedRoomName) {
    return [];
  }

  const visibleCharacterIDs = new Set(
    chatRuntime
      .getVisibleLocalSessions(normalizedRoomName)
      .map((session) => getCharacterIDForSession(session))
      .filter((characterID) => characterID > 0),
  );
  if (visibleCharacterIDs.size === 0) {
    return [];
  }

  const normalizedRoomJid = roomJid
    ? normalizeRoomJid(roomJid)
    : buildConferenceRoomJid(normalizedRoomName);
  const recipients = [];
  for (const client of connectedClients) {
    if (
      !client ||
      client === excludeClient ||
      !client.socket ||
      client.socket.destroyed ||
      !client.boundJid
    ) {
      continue;
    }

    const characterID = getClientCharacterId(client);
    if (!visibleCharacterIDs.has(characterID)) {
      continue;
    }

    if (normalizedRoomJid && !client.rooms.has(normalizedRoomJid)) {
      addRoomMember(normalizedRoomJid, client);
    }
    recipients.push(client);
  }

  return recipients;
}

function getRoomOccupantCount(roomJid, client = null) {
  const descriptor = getRoomDescriptor(roomJid, client);
  if (descriptor.suppressPresenceBroadcast) {
    return 0;
  }

  if (descriptor.kind === "local" && descriptor.roomName) {
    return chatRuntime.getVisibleLocalSessions(descriptor.roomName).length;
  }

  return getDistinctRoomCharacterIds(descriptor.normalizedRoomJid).length;
}

function getDescriptorRecord(descriptor, session = null) {
  if (!descriptor || !descriptor.roomName) {
    return null;
  }

  let record = descriptor.record || chatRuntime.getChannel(descriptor.roomName);
  if (!record) {
    return null;
  }

  const ownerCharacterID = session ? getCharacterIDForSession(session) : 0;
  if (
    record.type === "system" &&
    record.static !== true &&
    record.verifiedContract !== true &&
    ownerCharacterID > 0 &&
    descriptor.kind !== "local"
  ) {
    record = chatRuntime.updateChannel(record.roomName, (currentRecord) => ({
      ...currentRecord,
      type: "player",
      scope: "player",
      static: false,
      ownerCharacterID: currentRecord.ownerCharacterID || ownerCharacterID,
      adminCharacterIDs: addUniqueCharacterID(
        currentRecord.adminCharacterIDs,
        ownerCharacterID,
      ),
      operatorCharacterIDs: addUniqueCharacterID(
        currentRecord.operatorCharacterIDs,
        ownerCharacterID,
      ),
      metadata: {
        ...(currentRecord.metadata || {}),
        joinLink:
          currentRecord.roomName
            ? `joinChannel:${currentRecord.roomName}`
            : currentRecord.metadata && currentRecord.metadata.joinLink
              ? currentRecord.metadata.joinLink
              : "",
      },
    })) || record;
  } else if (
    record.type === "player" &&
    ownerCharacterID > 0 &&
    !record.ownerCharacterID
  ) {
    record = chatRuntime.updateChannel(record.roomName, (currentRecord) => ({
      ...currentRecord,
      ownerCharacterID,
      adminCharacterIDs: addUniqueCharacterID(
        currentRecord.adminCharacterIDs,
        ownerCharacterID,
      ),
      operatorCharacterIDs: addUniqueCharacterID(
        currentRecord.operatorCharacterIDs,
        ownerCharacterID,
      ),
    })) || record;
  }

  descriptor.record = record;
  descriptor.kind = record.type || descriptor.kind;
  descriptor.roomID = Number(record.entityID || descriptor.roomID || 0) || 0;
  return record;
}

function getCharacterIDForSession(session) {
  return Number(
    session && (session.characterID || session.charid || session.userid) || 0,
  ) || 0;
}

function buildRoomSubjectXml(roomJid, subject, recipient) {
  return [
    `<message from='${escapeXml(roomJid)}'`,
    ` to='${escapeXml(recipient.boundJid)}'`,
    " type='groupchat'>",
    `<subject>${escapeXml(subject || "")}</subject>`,
    "</message>",
  ].join("");
}

function deliverRoomSubject(roomJid, subject, recipients = null) {
  const members = recipients || roomMembers.get(roomJid);
  if (!members) {
    return;
  }
  for (const member of members) {
    sendXml(member, buildRoomSubjectXml(roomJid, subject, member));
  }
}

function deliverRoomBacklogToClient(client, roomJid, roomName, options = {}) {
  if (!client || !roomName) {
    return 0;
  }

  const historySeconds = Math.max(0, Number(options.historySeconds) || 0);
  if (historySeconds <= 0) {
    return 0;
  }

  const limit = Math.max(0, Number(options.limit) || 25);
  const normalizedRoomJid = normalizeRoomJid(roomJid, client);
  const cursorMap = getClientRoomBacklogCursorMap(client);
  const afterCreatedAtMs = Math.max(
    0,
    Number(cursorMap instanceof Map ? cursorMap.get(normalizedRoomJid) : 0) || 0,
  );
  const backlogEntries = chatRuntime.getChannelBacklog(roomName, limit, {
    sinceMs: Date.now() - historySeconds * 1000,
    afterCreatedAtMs,
  });
  let deliveredCount = 0;
  for (const entry of backlogEntries) {
    const senderID = Number(entry && entry.characterID || 0) || 1;
    sendXml(
      client,
      buildRoomMessageXml(
        normalizedRoomJid,
        senderID,
        entry.message || "",
        client,
      ),
    );
    noteRoomMessageDelivered(
      client,
      normalizedRoomJid,
      Number(entry && entry.createdAtMs) || Date.now(),
    );
    deliveredCount += 1;
  }
  return deliveredCount;
}

function formatChannelAccessError(error, action = "join") {
  const code = error && error.code ? String(error.code) : "";
  if (code === "password_required") {
    return "Password required.";
  }
  if (code === "invite_required") {
    return "Invite required.";
  }
  if (code === "banned") {
    return "You are banned from this channel.";
  }
  if (code === "muted") {
    return "You are muted in this channel.";
  }
  if (
    code === "corp_mismatch" ||
    code === "fleet_mismatch" ||
    code === "alliance_mismatch" ||
    code === "faction_mismatch" ||
    code === "private_mismatch" ||
    code === "not_allowed" ||
    code === "denied"
  ) {
    return action === "join"
      ? "Access denied."
      : "You cannot speak in this channel.";
  }
  return error && error.message ? error.message : "Channel error.";
}

function getAffiliationForCharacter(record, characterID) {
  const numericCharacterID = Number(characterID || 0) || 0;
  if (!record || !numericCharacterID) {
    return "member";
  }
  if (record.ownerCharacterID === numericCharacterID) {
    return "owner";
  }
  if ((record.adminCharacterIDs || []).includes(numericCharacterID)) {
    return "admin";
  }
  if ((record.operatorCharacterIDs || []).includes(numericCharacterID)) {
    return "admin";
  }
  if (Object.prototype.hasOwnProperty.call(record.bannedCharacters || {}, String(numericCharacterID))) {
    return "outcast";
  }
  return "member";
}

function extractAdminItems(xml) {
  const items = [];
  const itemRegex = /<item\b([^>]*?)(?:\/>|>([\s\S]*?)<\/item>)/gi;
  let match = itemRegex.exec(xml);
  while (match) {
    const attrs = match[1] || "";
    const body = match[2] || "";
    items.push({
      jid: extractAttrFromFragment(attrs, "jid"),
      nick: extractAttrFromFragment(attrs, "nick"),
      affiliation: extractAttrFromFragment(attrs, "affiliation"),
      role: extractAttrFromFragment(attrs, "role"),
      reason: extractInviteReason(body),
    });
    match = itemRegex.exec(xml);
  }
  return items;
}

function extractRequestedAdminAffiliation(xml) {
  const adminItems = extractAdminItems(xml);
  const requestedAffiliation = normalizeString(
    adminItems[0] && adminItems[0].affiliation,
    "",
  ).trim().toLowerCase();
  return (
    requestedAffiliation === "owner" ||
    requestedAffiliation === "admin" ||
    requestedAffiliation === "member" ||
    requestedAffiliation === "outcast"
  )
    ? requestedAffiliation
    : "";
}

function extractConfigFieldMap(xml) {
  const fieldMap = new Map();
  const fieldRegex = /<field\b([^>]*?)>([\s\S]*?)<\/field>/gi;
  let match = fieldRegex.exec(xml);
  while (match) {
    const fieldAttrs = match[1] || "";
    const fieldBody = match[2] || "";
    const fieldVar = extractAttrFromFragment(fieldAttrs, "var");
    if (!fieldVar) {
      match = fieldRegex.exec(xml);
      continue;
    }
    const values = [];
    const valueRegex = /<value>([\s\S]*?)<\/value>/gi;
    let valueMatch = valueRegex.exec(fieldBody);
    while (valueMatch) {
      values.push(decodeXml(valueMatch[1]).trim());
      valueMatch = valueRegex.exec(fieldBody);
    }
    fieldMap.set(fieldVar, values);
    match = fieldRegex.exec(xml);
  }
  return fieldMap;
}

function parseBooleanFieldValue(fieldMap, fieldName, fallback = false) {
  const values = fieldMap.get(fieldName);
  if (!values || values.length === 0) {
    return fallback;
  }
  const normalized = String(values[0] || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

function getFirstFieldValue(fieldMap, fieldName, fallback = "") {
  const values = fieldMap.get(fieldName);
  if (!values || values.length === 0) {
    return fallback;
  }
  return values[0];
}

function dedupePositiveCharacterIDs(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0),
  )].sort((left, right) => left - right);
}

function buildIqErrorXml(client, fromJid, requestId, condition = "not-authorized") {
  return [
    `<iq type='error' id='${escapeXml(requestId)}'`,
    ` from='${escapeXml(fromJid)}'`,
    ` to='${escapeXml(client.boundJid)}'>`,
    `<error type='cancel'><${condition} xmlns='urn:ietf:params:xml:ns:xmpp-stanzas'/></error>`,
    "</iq>",
  ].join("");
}

function buildRoomConfigResultXml(client, roomJid, requestId, record) {
  const effectiveRecord = record || chatRuntime.getChannel(String(roomJid || "").split("@")[0]);
  const passwordProtected = Boolean(
    effectiveRecord && effectiveRecord.passwordRequired,
  );
  const roomSecret = passwordProtected
    ? String(effectiveRecord.password || "")
    : "";
  return [
    `<iq type='result' id='${escapeXml(requestId)}'`,
    ` from='${escapeXml(roomJid)}'`,
    ` to='${escapeXml(client.boundJid)}'>`,
    "<query xmlns='http://jabber.org/protocol/muc#owner'>",
    "<x xmlns='jabber:x:data' type='form'>",
    "<field var='FORM_TYPE' type='hidden'><value>http://jabber.org/protocol/muc#roomconfig</value></field>",
    `<field var='muc#roomconfig_roomname'><value>${escapeXml(sanitizeRoomLabel(effectiveRecord && effectiveRecord.displayName, effectiveRecord && effectiveRecord.roomName || ""))}</value></field>`,
    `<field var='muc#roomconfig_roomdesc'><value>${escapeXml(effectiveRecord && effectiveRecord.topic || "")}</value></field>`,
    `<field var='muc#roomconfig_passwordprotectedroom'><value>${passwordProtected ? "1" : "0"}</value></field>`,
    `<field var='muc#roomconfig_roomsecret'><value>${escapeXml(roomSecret)}</value></field>`,
    `<field var='muc#roomconfig_membersonly'><value>${effectiveRecord && effectiveRecord.inviteOnly ? "1" : "0"}</value></field>`,
    "<field var='muc#roomconfig_persistentroom'><value>1</value></field>",
    "</x>",
    "</query>",
    "</iq>",
  ].join("");
}

function buildRoomInviteXml(roomJid, inviterCharacterID, recipient, reason = "") {
  const fromJid = buildXmppUserJid(inviterCharacterID || 0);
  return [
    `<message from='${escapeXml(roomJid)}'`,
    ` to='${escapeXml(recipient.boundJid)}'>`,
    "<x xmlns='http://jabber.org/protocol/muc#user'>",
    `<invite from='${escapeXml(fromJid)}'>`,
    reason ? `<reason>${escapeXml(reason)}</reason>` : "",
    "</invite>",
    "</x>",
    "</message>",
  ].join("");
}

function sendRoomInvite(roomName, inviterCharacterID, targetCharacterID, reason = "") {
  if (!roomName || !targetCharacterID) {
    return false;
  }
  const roomJid = buildConferenceRoomJid(roomName);
  let sent = false;
  for (const client of connectedClients) {
    if (getClientCharacterId(client) !== Number(targetCharacterID || 0)) {
      continue;
    }
    sendXml(
      client,
      buildRoomInviteXml(roomJid, inviterCharacterID, client, reason),
    );
    sent = true;
  }
  return sent;
}

function inviteCharacterToRoom(
  roomName,
  inviterCharacterID,
  targetCharacterID,
  reason = "",
) {
  const normalizedRoomName = normalizeString(roomName, "").trim();
  const normalizedTargetCharacterID = Number(targetCharacterID || 0);
  if (!normalizedRoomName || normalizedTargetCharacterID <= 0) {
    return false;
  }

  try {
    chatRuntime.inviteCharacterToChannel(
      normalizedRoomName,
      normalizedTargetCharacterID,
    );
  } catch (error) {
    log.debug(
      `[XMPP] Failed to persist room invite room=${normalizedRoomName} char=${normalizedTargetCharacterID}: ${error.message}`,
    );
  }

  return sendRoomInvite(
    normalizedRoomName,
    inviterCharacterID,
    normalizedTargetCharacterID,
    reason,
  );
}

function removeRoomMember(roomJid, client) {
  if (!roomJid || !roomMembers.has(roomJid)) {
    return;
  }

  const members = roomMembers.get(roomJid);
  members.delete(client);
  if (members.size === 0) {
    roomMembers.delete(roomJid);
  }
}

function buildSelfUnavailablePresenceXml(roomJid, client, nick, requestId, userData) {
  return [
    `<presence from='${escapeXml(roomJid)}/${escapeXml(nick)}'`,
    ` to='${escapeXml(client.boundJid)}'`,
    ` id='${escapeXml(requestId)}'`,
    " type='unavailable'>",
    buildEveUserDataElement(userData),
    `<x xmlns='http://jabber.org/protocol/muc#user'><item affiliation='member' role='none' jid='${escapeXml(client.boundJid)}'/><status code='110'/></x></presence>`,
  ].join("");
}

function removeClientFromRoom(roomJid, client, options = {}) {
  const descriptor = getRoomDescriptor(roomJid, client);
  const normalizedRoomJid = descriptor.normalizedRoomJid;
  const members = roomMembers.get(normalizedRoomJid);
  if (!members || !members.has(client)) {
    client.rooms.delete(normalizedRoomJid);
    return;
  }

  const session = options.session || findSessionForClient(client);
  const charId = options.charId || getClientCharacterId(client, session);
  const nick =
    options.nick ||
    String(charId || "").trim() ||
    client.nick ||
    "capsuleer";
  const shouldBroadcastPresence = options.broadcastPresence !== false;
  const recipients = descriptor.suppressPresenceBroadcast
    ? []
    : shouldBroadcastPresence
      ? [...members].filter((member) => member !== client)
      : [];

  if (session && descriptor.roomName) {
    try {
      chatRuntime.leaveChannel(session, descriptor.roomName);
      if (
        descriptor.kind === "local" &&
        options.syncLocalMembership !== false
      ) {
        chatRuntime.leaveLocalLsc(session, {
          roomName: descriptor.roomName,
          solarSystemID: descriptor.roomID,
        });
      }
    } catch (error) {
      log.debug(
        `[XMPP] Ignored room leave runtime error room=${descriptor.roomName} char=${charId}: ${error.message}`,
      );
    }
  }

  removeRoomMember(normalizedRoomJid, client);
  client.rooms.delete(normalizedRoomJid);
  const cursorMap = getClientRoomBacklogCursorMap(client);
  if (cursorMap instanceof Map) {
    cursorMap.delete(normalizedRoomJid);
  }

  if (options.notifySelf === true) {
    const userData = getUserDataForCharacterId(charId);
    sendXml(
      client,
      buildSelfUnavailablePresenceXml(
        normalizedRoomJid,
        client,
        nick,
        options.requestId || nextMessageId(),
        userData,
      ),
    );
  }

  if (!charId || descriptor.suppressPresenceBroadcast) {
    return;
  }

  for (const recipient of recipients) {
    sendXml(
      recipient,
      buildRoomPresenceXml(normalizedRoomJid, charId, recipient, { available: false }),
    );
  }
}

function removeClientFromRooms(client, options = {}) {
  for (const roomJid of [...client.rooms]) {
    removeClientFromRoom(roomJid, client, options);
  }

  client.rooms.clear();
}

function buildRoomMessageXml(roomJid, sender, message, recipient, options = {}) {
  const messageId = normalizeString(options.messageId, "").trim() || nextMessageId();
  return [
    `<message from='${escapeXml(roomJid)}/${escapeXml(sender)}'`,
    ` to='${escapeXml(recipient.boundJid)}'`,
    " type='groupchat'",
    ` id='${escapeXml(messageId)}'>`,
    `<body>${escapeXml(message)}</body>`,
    "</message>",
  ].join("");
}

function deliverRoomMessage(roomJid, sender, message, recipients = null, options = {}) {
  const members = recipients || roomMembers.get(roomJid);
  if (!members || message === "") {
    return;
  }

  const createdAtMs = Math.max(0, Number(options.createdAtMs) || Date.now());
  const messageId = normalizeString(options.messageId, "").trim() || nextMessageId();

  for (const member of members) {
    sendXml(
      member,
      buildRoomMessageXml(roomJid, sender, message, member, {
        messageId,
      }),
    );
    noteRoomMessageDelivered(member, roomJid, createdAtMs);
  }
}

function sendAdminCommand(client, roomJid, payload) {
  const messageText = JSON.stringify(payload);
  sendXml(
    client,
    buildRoomMessageXml(roomJid, "admin", messageText, client),
  );
}

function sendSystemMessageToClient(client, roomJid, message) {
  const normalizedRoomJid = normalizeRoomJid(roomJid, client);
  sendAdminCommand(client, normalizedRoomJid, {
    cmd: "speak",
    charid: 1,
    messageText: String(message || ""),
  });
}

function sendSessionSystemMessage(session, message, roomJid = null) {
  if (!session || !message) {
    return;
  }

  const charId = Number(session.characterID || 0);
  if (!charId) {
    return;
  }

  for (const client of connectedClients) {
    if (getClientCharacterId(client) !== charId) {
      continue;
    }

    sendSystemMessageToClient(
      client,
      roomJid || client.lastRoomJid || normalizeRoomJid("", client),
      message,
    );
  }
}

function buildRoomPresenceXml(roomJid, charId, recipient, options = {}) {
  const available = options.available !== false;
  const userData = getUserDataForCharacterId(charId);
  const nick = String(charId || "").trim() || "capsuleer";
  const userJid = buildXmppUserJid(nick);
  const requestId = nextMessageId();
  const itemRole = available ? "participant" : "none";
  const affiliation = options.affiliation || "member";
  const presenceType = available ? "" : " type='unavailable'";
  const userDataXml = buildEveUserDataElement(userData);

  return [
    `<presence from='${escapeXml(roomJid)}/${escapeXml(nick)}'`,
    ` to='${escapeXml(recipient.boundJid)}'`,
    ` id='${escapeXml(requestId)}'`,
    presenceType,
    `>${userDataXml}<x xmlns='http://jabber.org/protocol/muc#user'><item affiliation='${escapeXml(affiliation)}' role='${escapeXml(itemRole)}' jid='${escapeXml(userJid)}'/></x></presence>`,
  ].join("");
}

function buildRoomInfoResultXml(client, roomJid, requestId) {
  const normalizedRoomJid = normalizeRoomJid(roomJid, client);
  const descriptor = getRoomDescriptor(normalizedRoomJid, client);
  const session = findSessionForClient(client);
  const record = getDescriptorRecord(descriptor, session);
  const occupants = getRoomOccupantCount(normalizedRoomJid, client);
  const roomLabel = sanitizeRoomLabel(
    record && record.displayName,
    descriptor.kind === "corp"
      ? "Corp"
      : descriptor.kind === "local"
        ? "Local"
      : descriptor.roomName || "Channel",
  );
  const roomIdentityType = getRoomDiscoIdentityType(record, descriptor);

  return [
    `<iq type='result' id='${escapeXml(requestId)}'`,
    ` from='${escapeXml(normalizedRoomJid)}'`,
    ` to='${escapeXml(client.boundJid)}'>`,
    "<query xmlns='http://jabber.org/protocol/disco#info'>",
    `<identity category='conference' type='${escapeXml(roomIdentityType)}' name='${escapeXml(roomLabel)}'/>`,
    "<feature var='http://jabber.org/protocol/muc'/>",
    "<x xmlns='jabber:x:data' type='result'>",
    "<field var='muc#roominfo_occupants'>",
    `<value>${escapeXml(occupants)}</value>`,
    "</field>",
    "</x>",
    "</query>",
    "</iq>",
  ].join("");
}

function extractDiscoInfoNode(xml) {
  const match = /<query\b[^>]*\bxmlns=['"]http:\/\/jabber\.org\/protocol\/disco#info['"][^>]*\bnode=['"]([^'"]+)['"]/i.exec(
    xml,
  );
  return match ? decodeXml(match[1]).trim() : "";
}

function extractDiscoItemsNode(xml) {
  const match = /<query\b[^>]*\bxmlns=['"]http:\/\/jabber\.org\/protocol\/disco#items['"][^>]*\bnode=['"]([^'"]+)['"]/i.exec(
    xml,
  );
  return match ? decodeXml(match[1]).trim() : "";
}

function extractExpiringRecordSearchRoom(xml) {
  const match = /<query\b[^>]*\bxmlns=['"]urn:xmpp:expiring_record#search['"][^>]*\broom=['"]([^'"]+)['"]/i.exec(
    xml,
  );
  return match ? decodeXml(match[1]).trim() : "";
}

function extractExpiringRecordSearchCategory(xml) {
  const match = /<query\b[^>]*\bxmlns=['"]urn:xmpp:expiring_record#search['"][^>]*\bcategory=['"]([^'"]+)['"]/i.exec(
    xml,
  );
  return match ? decodeXml(match[1]).trim().toLowerCase() : "";
}

function buildConferenceDiscoItemXml(record) {
  const roomName = String(record && record.roomName || "").trim();
  if (!roomName) {
    return "";
  }

  const displayName = sanitizeRoomLabel(record.displayName, roomName);
  return [
    "<item",
    ` jid='${escapeXml(buildConferenceRoomJid(roomName))}'`,
    ` name='${escapeXml(displayName)}'`,
    "/>",
  ].join("");
}

function buildConferenceServiceInfoResultXml(client, requestId, node = "") {
  return [
    `<iq type='result' id='${escapeXml(requestId)}'`,
    ` from='${escapeXml(getXmppConferenceDomain())}'`,
    ` to='${escapeXml(client.boundJid)}'>`,
    node
      ? `<query xmlns='http://jabber.org/protocol/disco#info' node='${escapeXml(node)}'>`
      : "<query xmlns='http://jabber.org/protocol/disco#info'>",
    `<identity category='conference' type='text' name='${escapeXml(getXmppConferenceDomain())}'/>`,
    "<feature var='http://jabber.org/protocol/muc'/>",
    "</query>",
    "</iq>",
  ].join("");
}

function getRoomDiscoIdentityType(record, descriptor) {
  const browserCategoryName = normalizeConferenceIdentityType(
    record && record.metadata && record.metadata.browserCategoryName,
  );
  if (browserCategoryName) {
    return browserCategoryName;
  }

  const roomType = normalizeString(record && record.type, descriptor && descriptor.kind)
    .trim()
    .toLowerCase();
  switch (roomType) {
    case "player":
      return "player";
    case "help":
    case "rookiehelp":
    case "public":
    case "resourcewars":
      return "system";
    case "local":
    case "nolocal":
    case "wormhole":
    case "triglavian":
    case "nullsec":
      return roomType;
    case "corp":
      return "corp";
    case "fleet":
      return "fleet";
    case "alliance":
      return "alliance";
    case "faction":
      return "faction";
    case "incursion":
      return "incursion";
    case "private":
      return "private";
    default:
      return "text";
  }
}

function normalizeConferenceIdentityType(value) {
  const normalized = normalizeString(value, "").trim().toLowerCase();
  switch (normalized) {
    case "player":
    case "player channels":
      return "player";
    case "help channels":
    case "system":
    case "system channels":
    case "resourcewars":
    case "eve js elysian":
      return "system";
    case "private":
    case "private chats":
      return "private";
    case "local":
    case "nolocal":
    case "wormhole":
    case "triglavian":
    case "nullsec":
    case "corp":
    case "fleet":
    case "alliance":
    case "incursion":
      return normalized;
    case "faction":
    case "militia":
      return "faction";
    default:
      return "";
  }
}

function buildConferenceNodeInfoResultXml(client, requestId, node, session) {
  const roomJid = buildConferenceRoomJid(node);
  const descriptor = getRoomDescriptor(roomJid, client);
  const record = getDescriptorRecord(descriptor, session);
  const occupants = getRoomOccupantCount(roomJid, client);
  const roomLabel = sanitizeRoomLabel(record && record.displayName, node);
  const roomIdentityType = getRoomDiscoIdentityType(record, descriptor);

  return [
    `<iq type='result' id='${escapeXml(requestId)}'`,
    ` from='${escapeXml(getXmppConferenceDomain())}'`,
    ` to='${escapeXml(client.boundJid)}'>`,
    `<query xmlns='http://jabber.org/protocol/disco#info' node='${escapeXml(node)}'>`,
    `<identity category='conference' type='${escapeXml(roomIdentityType)}' name='${escapeXml(roomLabel)}'/>`,
    "<feature var='http://jabber.org/protocol/muc'/>",
    "<x xmlns='jabber:x:data' type='result'>",
    "<field var='muc#roominfo_occupants'>",
    `<value>${escapeXml(occupants)}</value>`,
    "</field>",
    "</x>",
    "</query>",
    "</iq>",
  ].join("");
}

function buildConferenceDiscoItemsResultXml(client, requestId, node, records = []) {
  const seenRoomNames = new Set();
  const items = [];
  for (const record of records) {
    const roomName = String(record && record.roomName || "").trim();
    if (!roomName || seenRoomNames.has(roomName)) {
      continue;
    }
    seenRoomNames.add(roomName);
    const itemXml = buildConferenceDiscoItemXml(record);
    if (itemXml) {
      items.push(itemXml);
    }
  }

  return [
    `<iq type='result' id='${escapeXml(requestId)}'`,
    ` from='${escapeXml(getXmppConferenceDomain())}'`,
    ` to='${escapeXml(client.boundJid)}'>`,
    node
      ? `<query xmlns='http://jabber.org/protocol/disco#items' node='${escapeXml(node)}'>`
      : "<query xmlns='http://jabber.org/protocol/disco#items'>",
    items.join(""),
    "</query>",
    "</iq>",
  ].join("");
}

function handleConferenceDiscoItemsIq(client, xml) {
  const requestId = extractId(xml);
  const node = extractDiscoItemsNode(xml);
  const session = findSessionForClient(client);
  let records = [];

  if (node === "forme") {
    records = chatRuntime.listDiscoverableConferenceChannels(session);
  } else if (/^byname\//i.test(node)) {
    const displayName = node.slice("byname/".length);
    records = chatRuntime.findDiscoverableConferenceChannelsByDisplayName(
      session,
      displayName,
    );
  }

  sendXml(
    client,
    buildConferenceDiscoItemsResultXml(client, requestId, node, records),
  );
}

function handleConferenceDiscoInfoIq(client, xml) {
  const requestId = extractId(xml);
  const node = extractDiscoInfoNode(xml);
  const rawTo = extractAttr(xml, "to");
  const session = findSessionForClient(client);

  if (isConferenceServiceJid(rawTo) && node) {
    sendXml(
      client,
      buildConferenceNodeInfoResultXml(client, requestId, node, session),
    );
    return;
  }

  if (isConferenceServiceJid(rawTo)) {
    sendXml(client, buildConferenceServiceInfoResultXml(client, requestId, node));
    return;
  }

  sendXml(
    client,
    buildRoomInfoResultXml(client, rawTo, requestId),
  );
}

function buildRoomAdminResultXml(client, roomJid, requestId, requestedAffiliation = "") {
  const normalizedRoomJid = normalizeRoomJid(roomJid, client);
  const descriptor = getRoomDescriptor(normalizedRoomJid, client);
  const session = findSessionForClient(client);
  const record = getDescriptorRecord(descriptor, session);
  const normalizedAffiliation = normalizeString(requestedAffiliation, "")
    .trim()
    .toLowerCase();
  const items = [];

  if (record) {
    if (
      record.ownerCharacterID &&
      (!normalizedAffiliation || normalizedAffiliation === "owner")
    ) {
      items.push(
        `<item affiliation='owner' jid='${escapeXml(buildXmppUserJid(record.ownerCharacterID))}' nick='${escapeXml(record.ownerCharacterID)}'/>`,
      );
    }
    if (!normalizedAffiliation || normalizedAffiliation === "admin") {
      for (const adminCharacterID of dedupePositiveCharacterIDs([
        record.ownerCharacterID,
        ...(record.adminCharacterIDs || []),
        ...(record.operatorCharacterIDs || []),
      ])) {
        if (!adminCharacterID) {
          continue;
        }
        items.push(
          `<item affiliation='admin' jid='${escapeXml(buildXmppUserJid(adminCharacterID))}' nick='${escapeXml(adminCharacterID)}'/>`,
        );
      }
    }
    if (!normalizedAffiliation || normalizedAffiliation === "member") {
      for (const memberCharacterID of dedupePositiveCharacterIDs([
        ...(record.invitedCharacters || []),
        ...(record.allowCharacterIDs || []),
        ...(record.allowedParticipantCharacterIDs || []),
      ])) {
        items.push(
          `<item affiliation='member' jid='${escapeXml(buildXmppUserJid(memberCharacterID))}' nick='${escapeXml(memberCharacterID)}'/>`,
        );
      }
    }
    if (!normalizedAffiliation || normalizedAffiliation === "outcast") {
      for (const characterID of dedupePositiveCharacterIDs(
        Object.keys(record.bannedCharacters || {}),
      )) {
        items.push(
          `<item affiliation='outcast' jid='${escapeXml(buildXmppUserJid(characterID))}' nick='${escapeXml(characterID)}'/>`,
        );
      }
    }
  }

  return [
    `<iq type='result' id='${escapeXml(requestId)}'`,
    ` from='${escapeXml(normalizedRoomJid)}'`,
    ` to='${escapeXml(client.boundJid)}'>`,
    "<query xmlns='http://jabber.org/protocol/muc#admin'>",
    items.join(""),
    "</query>",
    "</iq>",
  ].join("");
}

function syncSessionScopedRoomMembership(session, options = {}) {
  if (!session) {
    return false;
  }

  const charId = Number(session.characterID || 0);
  if (!charId) {
    return false;
  }

  const scopedRoomMap = getSessionScopedRoomMap(session);
  const validRoomNames = new Set(scopedRoomMap.values());
  const autoJoinKinds = new Set(
    (Array.isArray(options.autoJoinKinds) ? options.autoJoinKinds : [])
      .map((kind) => normalizeString(kind, "").trim().toLowerCase())
      .filter((kind) => isSessionScopedRoomKind(kind)),
  );
  let changed = false;

  for (const client of connectedClients) {
    if (getClientCharacterId(client) !== charId) {
      continue;
    }

    const joinKinds = new Set(autoJoinKinds);
    for (const roomJid of [...client.rooms]) {
      const descriptor = getRoomDescriptor(roomJid, client);
      if (!descriptor || !isSessionScopedRoomKind(descriptor.kind)) {
        continue;
      }
      if (validRoomNames.has(descriptor.roomName)) {
        continue;
      }

      const replacementRoomName = scopedRoomMap.get(descriptor.kind) || "";
      removeClientFromRoom(roomJid, client, {
        notifySelf: true,
        session,
        charId,
      });
      if (client.lastRoomJid === descriptor.normalizedRoomJid) {
        client.lastRoomJid = [...client.rooms][0] || "";
      }
      if (
        replacementRoomName &&
        replacementRoomName !== descriptor.roomName
      ) {
        joinKinds.add(descriptor.kind);
      }
      changed = true;
    }

    for (const kind of joinKinds) {
      const replacementRoomName = scopedRoomMap.get(kind) || "";
      if (!replacementRoomName) {
        continue;
      }
      changed =
        joinClientToRoom(client, session, charId, replacementRoomName) ||
        changed;
    }
  }

  return changed;
}

function buildExpiringRecordItemXml(entry) {
  if (!entry || !entry.characterID) {
    return "";
  }

  const userData = getUserDataForCharacterId(entry.characterID);
  const reason = normalizeString(entry.reason, "");
  const createdAtMs = Math.max(0, Number(entry.createdAtMs) || 0);
  const expiresAtMs = Math.max(0, Number(entry.untilMs) || 0);
  const byCharacterID = Number(entry.byCharacterID || 0) || 0;
  const byJid = byCharacterID > 0 ? buildXmppUserJid(byCharacterID) : "";

  return [
    "<item",
    ` jid='${escapeXml(buildXmppUserJid(entry.characterID))}'`,
    ` nick='${escapeXml(entry.characterID)}'`,
    ` name='${escapeXml(userData && userData.characterName || String(entry.characterID))}'`,
    reason ? ` reason='${escapeXml(reason)}'` : "",
    createdAtMs > 0 ? ` created_at_ms='${escapeXml(createdAtMs)}'` : "",
    expiresAtMs > 0 ? ` expires_at_ms='${escapeXml(expiresAtMs)}'` : "",
    byCharacterID > 0 ? ` by='${escapeXml(byCharacterID)}'` : "",
    byJid ? ` by_jid='${escapeXml(byJid)}'` : "",
    "/>",
  ].join("");
}

function buildExpiringRecordSearchResultXml(
  client,
  requestId,
  roomJid,
  category,
  entries = [],
) {
  return [
    `<iq type='result' id='${escapeXml(requestId)}'`,
    ` from='${escapeXml(getXmppDomain())}'`,
    ` to='${escapeXml(client.boundJid)}'>`,
    `<query xmlns='urn:xmpp:expiring_record#search' room='${escapeXml(roomJid)}' category='${escapeXml(category)}'>`,
    entries.map(buildExpiringRecordItemXml).join(""),
    "</query>",
    "</iq>",
  ].join("");
}

function handleExpiringRecordSearchIq(client, xml) {
  const requestId = extractId(xml);
  const requestedRoomJid = extractExpiringRecordSearchRoom(xml);
  const category = extractExpiringRecordSearchCategory(xml);
  const roomJid = normalizeRoomJid(requestedRoomJid, client);
  const descriptor = getRoomDescriptor(roomJid, client);
  const session = findSessionForClient(client);
  const record = getDescriptorRecord(descriptor, session);

  if (!session || !record || !chatRuntime.isChannelAdmin(session, record)) {
    sendXml(client, buildIqErrorXml(client, getXmppDomain(), requestId));
    return;
  }

  const entries = chatRuntime.listChannelTemporaryRestrictions(
    descriptor.roomName,
    category,
  );
  sendXml(
    client,
    buildExpiringRecordSearchResultXml(
      client,
      requestId,
      descriptor.normalizedRoomJid,
      category,
      entries,
    ),
  );
}

function refreshSessionChatRolePresence(session) {
  if (!session) {
    return false;
  }

  const charId = Number(session.characterID || 0);
  if (!charId) {
    return false;
  }

  const relevantClients = [...connectedClients].filter(
    (client) => getClientCharacterId(client) === charId,
  );
  if (relevantClients.length === 0) {
    return false;
  }

  const roomJids = new Set();
  for (const client of relevantClients) {
    for (const roomJid of client.rooms) {
      roomJids.add(roomJid);
    }
    if (client.lastRoomJid) {
      roomJids.add(client.lastRoomJid);
    }
  }

  let refreshed = false;
  for (const roomJid of roomJids) {
    const members = roomMembers.get(roomJid);
    if (!members || members.size === 0) {
      continue;
    }
    const descriptor = getRoomDescriptor(roomJid);
    const record = getDescriptorRecord(descriptor, session);

    for (const member of members) {
      const affiliation = getAffiliationForCharacter(record, charId);
      sendXml(member, buildRoomPresenceXml(roomJid, charId, member, {
        available: false,
        affiliation,
      }));
      sendXml(member, buildRoomPresenceXml(roomJid, charId, member, {
        available: true,
        affiliation,
      }));
    }
    refreshed = true;
  }

  return refreshed;
}

function buildSyntheticRoomJoinPresenceXml(roomJid, charId) {
  return (
    `<presence to='${escapeXml(roomJid)}/${escapeXml(charId)}'` +
    ` id='${escapeXml(nextMessageId())}'/>`
  );
}

function joinClientToRoom(client, session, charId, roomName) {
  const normalizedRoomName = String(roomName || "").trim();
  if (!client || !session || !charId || !normalizedRoomName) {
    return false;
  }

  const roomJid = buildConferenceRoomJid(normalizedRoomName);
  if (!roomJid || client.rooms.has(roomJid)) {
    return false;
  }

  const roomsBefore = new Set(client.rooms);
  handleJoinPresence(
    client,
    buildSyntheticRoomJoinPresenceXml(roomJid, charId),
  );
  return !roomsBefore.has(roomJid) && client.rooms.has(roomJid);
}


function moveSessionToCurrentLocalRoom(session) {
  if (!session) {
    return false;
  }

  const charId = Number(session.characterID || 0);
  const currentRoomName = getLocalRoomNameForSession(session);
  const currentRoomJid = buildConferenceRoomJid(currentRoomName);
  let changed = false;

  if (!charId || !currentRoomName || !currentRoomJid) {
    return false;
  }

  for (const client of connectedClients) {
    if (getClientCharacterId(client) !== charId) {
      continue;
    }

    const localRooms = [...client.rooms].filter((roomJid) =>
      isLocalChatRoomName(roomJid),
    );
    for (const roomJid of localRooms) {
      if (roomJid === currentRoomJid) {
        continue;
      }
      removeClientFromRoom(roomJid, client, {
        notifySelf: true,
        session,
        charId,
        syncLocalMembership: false,
      });
      changed = true;
      if (client.lastRoomJid === roomJid) {
        client.lastRoomJid = [...client.rooms][0] || "";
      }
    }

    if (!client.boundJid) {
      client.lastRoomJid = currentRoomJid;
      continue;
    }

    if (!client.rooms.has(currentRoomJid)) {
      changed = joinClientToRoom(client, session, charId, currentRoomName) || changed;
    } else {
      client.lastRoomJid = currentRoomJid;
    }
  }

  return changed;
}

function unregisterCharacterSession(session) {
  if (!session) {
    return;
  }

  const characterID = Number(session.characterID || 0);
  if (!characterID) {
    return;
  }

  for (const client of connectedClients) {
    if (getClientCharacterId(client) !== characterID) {
      continue;
    }

    removeClientFromRooms(client);
    client.lastRoomJid = "";
  }
}

function buildLocalWelcomeMessage() {
  return DEFAULT_MOTD_MESSAGE;
}

function isUnavailablePresence(xml) {
  return /\btype=['"]unavailable['"]/i.test(String(xml || ""));
}

function handleJoinPresence(client, xml) {
  const to = extractAttr(xml, "to");
  const requestId = extractId(xml);
  if (!to) {
    // The client expects an acknowledgement presence here before it proceeds
    // into the actual room joins for Local and Corp.
    sendXml(
      client,
      `<presence from='${escapeXml(client.boundJid)}' to='${escapeXml(client.boundJid)}'/>`,
    );
    return;
  }

  const roomJid = normalizeRoomJid(getRoomJid(to), client);
  const descriptor = getRoomDescriptor(roomJid, client);
  const session = findSessionForClient(client);
  const charId = getClientCharacterId(client, session);
  const userData = getUserDataForCharacterId(charId);
  const providedPassword = extractMucPassword(xml);
  const historySeconds = extractMucHistorySeconds(xml);
  const nick =
    String(charId || "")
      .trim() ||
    getRoomNick(to, client.userName || "capsuleer");

  if (isUnavailablePresence(xml)) {
    removeClientFromRoom(descriptor.normalizedRoomJid, client, {
      charId,
      nick,
      notifySelf: true,
      requestId,
      session,
    });
    return;
  }

  const roomRecord = getDescriptorRecord(descriptor, session);
  if (session && descriptor.roomName) {
    try {
      chatRuntime.joinChannel(session, descriptor.roomName, {
        providedPassword,
      });
      if (descriptor.kind === "local") {
        chatRuntime.joinLocalLsc(session);
      }
    } catch (error) {
      sendSystemMessageToClient(
        client,
        descriptor.normalizedRoomJid,
        formatChannelAccessError(error, "join"),
      );
      return;
    }
  }

  client.lastRoomJid =
    descriptor.normalizedRoomJid || client.lastRoomJid || normalizeRoomJid("", client);
  client.nick = nick;
  const existingRecipients = descriptor.kind === "local" && descriptor.roomName
    ? getConnectedClientsForLocalRoom(descriptor.roomName, {
        excludeClient: client,
        roomJid: descriptor.normalizedRoomJid,
      })
    : roomMembers.has(descriptor.normalizedRoomJid)
      ? [...roomMembers.get(descriptor.normalizedRoomJid)].filter(
          (member) => member !== client,
        )
      : [];
  addRoomMember(descriptor.normalizedRoomJid, client);

  sendXml(
    client,
    `<presence from='${escapeXml(descriptor.normalizedRoomJid)}/${escapeXml(client.nick)}' to='${escapeXml(client.boundJid)}' id='${escapeXml(requestId)}'>${buildEveUserDataElement(userData)}<x xmlns='http://jabber.org/protocol/muc#user'><item affiliation='${escapeXml(getAffiliationForCharacter(roomRecord, charId))}' role='participant' jid='${escapeXml(client.boundJid)}'/><status code='110'/></x></presence>`,
  );

  if (!descriptor.suppressPresenceBroadcast && charId) {
    const seenCharacterIDs = new Set();
    for (const member of existingRecipients) {
      const memberCharacterID = getClientCharacterId(member);
      if (
        !memberCharacterID ||
        memberCharacterID === charId ||
        seenCharacterIDs.has(memberCharacterID)
      ) {
        continue;
      }

      seenCharacterIDs.add(memberCharacterID);
      sendXml(
        client,
        buildRoomPresenceXml(
          descriptor.normalizedRoomJid,
          memberCharacterID,
          client,
          {
            affiliation: getAffiliationForCharacter(
              roomRecord,
              memberCharacterID,
            ),
          },
        ),
      );
    }

    for (const recipient of existingRecipients) {
      sendXml(
        recipient,
        buildRoomPresenceXml(descriptor.normalizedRoomJid, charId, recipient, {
          affiliation: getAffiliationForCharacter(roomRecord, charId),
        }),
      );
    }
  }

  if (roomRecord && roomRecord.motd) {
    sendXml(
      client,
      buildRoomSubjectXml(descriptor.normalizedRoomJid, roomRecord.motd, client),
    );
  }
  if (roomRecord && descriptor.kind !== "local") {
    deliverRoomBacklogToClient(
      client,
      descriptor.normalizedRoomJid,
      descriptor.roomName,
      {
        historySeconds,
        limit: Math.max(0, Number(roomRecord.backlogLimit) || 25),
      },
    );
  }

  if (
    !client.localWelcomeSent &&
    descriptor.normalizedRoomJid === normalizeRoomJid("", client)
  ) {
    client.localWelcomeSent = true;
    setTimeout(() => {
      sendSystemMessageToClient(
        client,
        descriptor.normalizedRoomJid,
        buildLocalWelcomeMessage(),
      );
    }, 100);
  }
}

function handleGroupMessage(client, xml) {
  const requestId = normalizeString(extractId(xml), "").trim();
  const messageType = extractAttr(xml, "type").toLowerCase();
  const rawTo = extractAttr(xml, "to");
  const body = extractBody(xml);
  const subject = extractSubject(xml);
  const inviteTargetJid = extractInviteTargetJid(xml);
  const inviteReason = extractInviteReason(xml);
  const session = findSessionForClient(client);

  if (
    messageType === "chat" &&
    rawTo &&
    !rawTo.includes("@conference.") &&
    session
  ) {
    const targetCharacterId = parseCharacterId(getRoomJid(rawTo).split("@")[0]);
    if (targetCharacterId) {
      const roomRecord = chatRuntime.ensurePrivateChannelForInvite(
        session,
        targetCharacterId,
        {
          metadata: {
            inviteFlow: "direct_chat",
          },
        },
      );
      if (roomRecord) {
        try {
          chatRuntime.joinChannel(session, roomRecord.roomName);
        } catch (error) {
          sendSystemMessageToClient(
            client,
            buildConferenceRoomJid(roomRecord.roomName),
            formatChannelAccessError(error, "join"),
          );
          return;
        }
        chatRuntime.inviteCharacterToChannel(roomRecord.roomName, targetCharacterId);
        client.lastRoomJid = buildConferenceRoomJid(roomRecord.roomName);
        addRoomMember(client.lastRoomJid, client);
        sendRoomInvite(
          roomRecord.roomName,
          getCharacterIDForSession(session),
          targetCharacterId,
          inviteReason || body || "",
        );
      }
    }
    return;
  }

  const roomJid =
    normalizeRoomJid(getRoomJid(rawTo), client) ||
    client.lastRoomJid;
  if (!roomJid) {
    return;
  }
  const descriptor = getRoomDescriptor(roomJid, client);
  const roomRecord = getDescriptorRecord(descriptor, session);

  if (inviteTargetJid && session && roomRecord) {
    const targetCharacterId = parseCharacterId(inviteTargetJid.split("@")[0]);
    if (targetCharacterId) {
      chatRuntime.inviteCharacterToChannel(roomRecord.roomName, targetCharacterId);
      sendRoomInvite(
        roomRecord.roomName,
        getCharacterIDForSession(session),
        targetCharacterId,
        inviteReason || body || "",
      );
    }
    return;
  }

  if (subject && !body) {
    if (!session || !roomRecord || !chatRuntime.isChannelAdmin(session, roomRecord)) {
      sendSystemMessageToClient(
        client,
        roomJid,
        "You are not allowed to update the channel MOTD.",
      );
      return;
    }
    const updatedRecord = chatRuntime.setChannelMotd(roomRecord.roomName, subject);
    deliverRoomSubject(roomJid, updatedRecord ? updatedRecord.motd : subject);
    return;
  }

  if (!body) {
    return;
  }

  if (body.startsWith("/") || body.startsWith(".")) {
    const result = session
      ? executeChatCommand(session, body, null, {
          emitChatFeedback: false,
        })
      : {
          handled: true,
          message:
            "Command unavailable: no active game session matched this chat connection.",
        };

    const responseMessage =
      result.message ||
      (result.handled
        ? "Command executed."
        : `Unknown command: ${body}. Use /help.`);

    if (result.refreshChatRolePresence) {
      refreshSessionChatRolePresence(session);
    }

    log.debug(`[XMPP] Command from ${client.userName}: ${body}`);
    sendSystemMessageToClient(client, roomJid, responseMessage);
    return;
  }

  if (!session) {
    sendSystemMessageToClient(
      client,
      roomJid,
      "Message unavailable: no active game session matched this chat connection.",
    );
    return;
  }

  let sendResult = null;
  try {
    if (descriptor.kind === "local") {
      sendResult = chatRuntime.broadcastLocalMessage(session, body);
    } else {
      sendResult = chatRuntime.sendChannelMessage(session, descriptor.roomName, body);
    }
  } catch (error) {
    sendSystemMessageToClient(
      client,
      roomJid,
      formatChannelAccessError(error, "speak"),
    );
    return;
  }

  const senderCharacterId =
    getClientCharacterId(client, session) ||
    parseCharacterId(client.nick) ||
    parseCharacterId(client.userName) ||
    1;

  if (!client.rooms.has(roomJid)) {
    if (descriptor.kind === "local" && session && descriptor.roomName) {
      joinClientToRoom(client, session, senderCharacterId, descriptor.roomName);
    } else {
      addRoomMember(roomJid, client);
    }
  }

  log.debug(`[XMPP] Message from ${senderCharacterId}: ${body}`);
  deliverRoomMessage(roomJid, senderCharacterId, body, null, {
    messageId: requestId,
    createdAtMs:
      Number(sendResult && sendResult.entry && sendResult.entry.createdAtMs) || Date.now(),
  });
}

function handleEveUserDataIq(client, xml) {
  const id = extractId(xml);
  const requestedJid = extractAttr(xml, "jid") || buildXmppUserJid(client.userName);
  const userData = getUserDataForJid(requestedJid);
  const resultXml = [
    `<iq type='result' id='${escapeXml(id)}'`,
    ` from='${escapeXml(getXmppDomain())}'`,
    ` to='${escapeXml(client.boundJid)}'>`,
    `<query xmlns='urn:xmpp:eve_user_data' jid='${escapeXml(requestedJid)}'>`,
    buildEveUserDataElement(userData),
    "</query>",
    "</iq>",
  ].join("");

  sendXml(client, resultXml);
}

function handleRoomAdminIq(client, xml) {
  const requestId = extractId(xml);
  const roomJid = normalizeRoomJid(extractAttr(xml, "to"), client);
  const descriptor = getRoomDescriptor(roomJid, client);
  const session = findSessionForClient(client);
  const record = getDescriptorRecord(descriptor, session);
  const requestedAffiliation = extractRequestedAdminAffiliation(xml);
  if (!session || !record || !chatRuntime.isChannelAdmin(session, record)) {
    sendXml(client, buildIqErrorXml(client, roomJid, requestId));
    return;
  }

  const actorCharacterID = getCharacterIDForSession(session);
  for (const item of extractAdminItems(xml)) {
    const targetCharacterID =
      parseCharacterId(String(item.jid || "").split("@")[0]) ||
      parseCharacterId(item.nick);
    if (!targetCharacterID) {
      continue;
    }

    if (item.affiliation === "owner") {
      chatRuntime.setChannelOwner(record.roomName, targetCharacterID);
      chatRuntime.grantChannelAdmin(record.roomName, targetCharacterID);
    } else if (item.affiliation === "admin") {
      chatRuntime.grantChannelAdmin(record.roomName, targetCharacterID);
    } else if (item.affiliation === "member") {
      chatRuntime.inviteCharacterToChannel(record.roomName, targetCharacterID);
      chatRuntime.unbanChannelCharacter(record.roomName, targetCharacterID);
    } else if (item.affiliation === "outcast") {
      chatRuntime.banChannelCharacter(
        record.roomName,
        targetCharacterID,
        0,
        item.reason || "",
        actorCharacterID,
      );
      for (const roomClient of connectedClients) {
        if (getClientCharacterId(roomClient) !== targetCharacterID) {
          continue;
        }
        if (!roomClient.rooms.has(descriptor.normalizedRoomJid)) {
          continue;
        }
        removeClientFromRoom(descriptor.normalizedRoomJid, roomClient, {
          notifySelf: true,
          session: findSessionForClient(roomClient),
          charId: targetCharacterID,
        });
      }
    } else if (item.affiliation === "none") {
      chatRuntime.updateChannel(record.roomName, (currentRecord) => {
        const bannedCharacters = {
          ...(currentRecord.bannedCharacters || {}),
        };
        delete bannedCharacters[String(targetCharacterID)];
        return {
          ...currentRecord,
          adminCharacterIDs: (currentRecord.adminCharacterIDs || []).filter(
            (candidate) => candidate !== targetCharacterID,
          ),
          operatorCharacterIDs: (currentRecord.operatorCharacterIDs || []).filter(
            (candidate) => candidate !== targetCharacterID,
          ),
          invitedCharacters: (currentRecord.invitedCharacters || []).filter(
            (candidate) => candidate !== targetCharacterID,
          ),
          allowCharacterIDs: (currentRecord.allowCharacterIDs || []).filter(
            (candidate) => candidate !== targetCharacterID,
          ),
          allowedParticipantCharacterIDs:
            (currentRecord.allowedParticipantCharacterIDs || []).filter(
              (candidate) => candidate !== targetCharacterID,
            ),
          bannedCharacters,
        };
      });
    }

    if (item.role === "none") {
      for (const roomClient of connectedClients) {
        if (getClientCharacterId(roomClient) !== targetCharacterID) {
          continue;
        }
        if (!roomClient.rooms.has(descriptor.normalizedRoomJid)) {
          continue;
        }
        removeClientFromRoom(descriptor.normalizedRoomJid, roomClient, {
          notifySelf: true,
          session: findSessionForClient(roomClient),
          charId: targetCharacterID,
        });
      }
    }

    const targetSession = sessionRegistry.findSessionByCharacterID(targetCharacterID);
    if (targetSession) {
      refreshSessionChatRolePresence(targetSession);
    }
  }

  sendXml(
    client,
    buildRoomAdminResultXml(client, roomJid, requestId, requestedAffiliation),
  );
}

function handleRoomOwnerIq(client, xml) {
  const requestId = extractId(xml);
  const roomJid = normalizeRoomJid(extractAttr(xml, "to"), client);
  const descriptor = getRoomDescriptor(roomJid, client);
  const session = findSessionForClient(client);
  const record = getDescriptorRecord(descriptor, session);
  if (!record) {
    sendXml(client, buildIqErrorXml(client, roomJid, requestId, "item-not-found"));
    return;
  }

  const isSet = /\btype=['"]set['"]/i.test(xml);
  if (!isSet) {
    sendXml(client, buildRoomConfigResultXml(client, roomJid, requestId, record));
    return;
  }

  if (!session || !chatRuntime.isChannelAdmin(session, record)) {
    sendXml(client, buildIqErrorXml(client, roomJid, requestId));
    return;
  }

  if (/<destroy\b[^>]*\/?\s*>/i.test(xml)) {
    if (!chatRuntime.canDestroyChannel(session, record)) {
      sendXml(client, buildIqErrorXml(client, roomJid, requestId));
      return;
    }

    const roomClients = roomMembers.has(descriptor.normalizedRoomJid)
      ? [...roomMembers.get(descriptor.normalizedRoomJid)]
      : [];
    for (const roomClient of roomClients) {
      if (roomClient.lastRoomJid === descriptor.normalizedRoomJid) {
        roomClient.lastRoomJid = "";
      }
      removeClientFromRoom(descriptor.normalizedRoomJid, roomClient, {
        notifySelf: true,
        session: findSessionForClient(roomClient),
        charId: getClientCharacterId(roomClient),
      });
    }

    const deleted = chatRuntime.deleteChannel(record.roomName);
    if (!deleted) {
      sendXml(client, buildIqErrorXml(client, roomJid, requestId, "item-not-found"));
      return;
    }

    sendXml(
      client,
      `<iq type='result' id='${escapeXml(requestId)}' from='${escapeXml(roomJid)}' to='${escapeXml(client.boundJid)}'/>`,
    );
    return;
  }

  const fieldMap = extractConfigFieldMap(xml);
  const passwordProtected = parseBooleanFieldValue(
    fieldMap,
    "muc#roomconfig_passwordprotectedroom",
    Boolean(record.passwordRequired),
  );
  const nextPassword = passwordProtected
    ? getFirstFieldValue(
        fieldMap,
        "muc#roomconfig_roomsecret",
        String(record.password || ""),
      )
    : "";

  const updatedRecord = chatRuntime.updateChannel(record.roomName, (currentRecord) => ({
    ...currentRecord,
    displayName: getFirstFieldValue(
      fieldMap,
      "muc#roomconfig_roomname",
      currentRecord.displayName,
    ),
    topic: getFirstFieldValue(
      fieldMap,
      "muc#roomconfig_roomdesc",
      currentRecord.topic || "",
    ),
    inviteOnly: parseBooleanFieldValue(
      fieldMap,
      "muc#roomconfig_membersonly",
      Boolean(currentRecord.inviteOnly),
    ),
    passwordRequired: passwordProtected,
    password: nextPassword,
  }));

  if (updatedRecord && updatedRecord.motd) {
    deliverRoomSubject(roomJid, updatedRecord.motd);
  }

  sendXml(client, `<iq type='result' id='${escapeXml(requestId)}' from='${escapeXml(roomJid)}' to='${escapeXml(client.boundJid)}'/>`);
}

function handleReadyIq(client, xml) {
  if (xml.includes("urn:xmpp:ping")) {
    sendXml(client, `<iq type='result' id='${escapeXml(extractId(xml))}'/>`);
    return;
  }

  if (xml.includes("urn:xmpp:expiring_record#search")) {
    handleExpiringRecordSearchIq(client, xml);
    return;
  }

  if (xml.includes("http://jabber.org/protocol/disco#items")) {
    handleConferenceDiscoItemsIq(client, xml);
    return;
  }

  if (xml.includes("http://jabber.org/protocol/disco#info")) {
    handleConferenceDiscoInfoIq(client, xml);
    return;
  }

  if (xml.includes("http://jabber.org/protocol/muc#admin")) {
    if (/\btype=['"]set['"]/i.test(xml)) {
      handleRoomAdminIq(client, xml);
      return;
    }
    sendXml(
      client,
      buildRoomAdminResultXml(
        client,
        extractAttr(xml, "to"),
        extractId(xml),
        extractRequestedAdminAffiliation(xml),
      ),
    );
    return;
  }

  if (xml.includes("http://jabber.org/protocol/muc#owner")) {
    handleRoomOwnerIq(client, xml);
    return;
  }

  if (xml.includes("urn:xmpp:eve_user_data")) {
    handleEveUserDataIq(client, xml);
  }
}

function extractNextReadyStanza(buffer) {
  const patterns = [
    /<message\b[\s\S]*?<\/message>/i,
    /<presence\b[\s\S]*?(?:<\/presence>|\/>)/i,
    /<iq\b[\s\S]*?<\/iq>/i,
  ];

  let bestMatch = null;
  for (const pattern of patterns) {
    const match = pattern.exec(buffer);
    if (!match) {
      continue;
    }

    if (!bestMatch || match.index < bestMatch.index) {
      bestMatch = {
        index: match.index,
        xml: match[0],
      };
    }
  }

  return bestMatch;
}

function drainReadyBuffer(client) {
  while (true) {
    const stanza = extractNextReadyStanza(client.buffer);
    if (!stanza) {
      break;
    }

    client.buffer = client.buffer.slice(stanza.index + stanza.xml.length);

    if (/^<presence\b/i.test(stanza.xml)) {
      handleJoinPresence(client, stanza.xml);
      continue;
    }

    if (/^<message\b/i.test(stanza.xml)) {
      handleGroupMessage(client, stanza.xml);
      continue;
    }

    if (/^<iq\b/i.test(stanza.xml)) {
      handleReadyIq(client, stanza.xml);
    }
  }
}

function handleSocket(socket) {
  const client = {
    socket,
    buffer: "",
    stage: "stream1",
    userName: "capsuleer",
    password: "",
    boundJid: buildXmppUserJid("capsuleer", "evejs"),
    nick: "capsuleer",
    lastRoomJid: "",
    localWelcomeSent: false,
    roomBacklogCursorMs: new Map(),
    rooms: new Set(),
  };

  connectedClients.add(client);

  socket.on("data", (chunk) => {
    const xmlChunk = chunk.toString("utf8");
    client.buffer += xmlChunk;
    writeTranscript("IN ", xmlChunk);

    try {
      if (client.stage === "stream1" && client.buffer.includes("<stream:stream")) {
        sendXml(
          client,
          `<?xml version='1.0'?><stream:stream from='${escapeXml(getXmppDomain())}' id='evejs' version='1.0' xmlns='jabber:client' xmlns:stream='http://etherx.jabber.org/streams'><stream:features><mechanisms xmlns='urn:ietf:params:xml:ns:xmpp-sasl'><mechanism>PLAIN</mechanism></mechanisms></stream:features>`,
        );
        client.buffer = "";
        client.stage = "auth";
        return;
      }

      if (client.stage === "auth" && client.buffer.includes("<auth")) {
        const auth = parsePlainAuth(client.buffer);
        client.userName = auth.userName;
        client.password = auth.password;
        client.boundJid = buildBoundJid(client);

        sendXml(
          client,
          "<success xmlns='urn:ietf:params:xml:ns:xmpp-sasl'/>",
        );
        client.buffer = "";
        client.stage = "stream2";
        return;
      }

      if (
        client.stage === "stream2" &&
        client.buffer.includes("<stream:stream")
      ) {
        sendXml(
          client,
          `<?xml version='1.0'?><stream:stream from='${escapeXml(getXmppDomain())}' id='evejs2' version='1.0' xmlns='jabber:client' xmlns:stream='http://etherx.jabber.org/streams'><stream:features><bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'/><session xmlns='urn:ietf:params:xml:ns:xmpp-session'/></stream:features>`,
        );
        client.buffer = "";
        client.stage = "bind";
        return;
      }

      if (client.stage === "bind" && client.buffer.includes("<bind")) {
        const id = extractId(client.buffer);
        client.boundJid = buildBoundJid(client);
        sendXml(
          client,
          `<iq type='result' id='${escapeXml(id)}'><bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'><jid>${escapeXml(client.boundJid)}</jid></bind></iq>`,
        );
        client.buffer = "";
        client.stage = "session";
        return;
      }

      if (client.stage === "session" && client.buffer.includes("<session")) {
        const id = extractId(client.buffer);
        sendXml(client, `<iq type='result' id='${escapeXml(id)}'/>`);
        client.buffer = "";
        client.stage = "ready";
        return;
      }

      if (client.stage === "ready") {
        drainReadyBuffer(client);
      }
    } catch (error) {
      log.warn(`[XMPP] Stub handling error: ${error.message}`);
    }
  });

  socket.on("close", () => {
    connectedClients.delete(client);
    removeClientFromRooms(client);
  });

  socket.on("error", (error) => {
    connectedClients.delete(client);
    removeClientFromRooms(client);
    log.warn(`[XMPP] Client socket error: ${error.message}`);
  });
}

function startXmppStub() {
  if (server) {
    return server;
  }

  server = tls.createServer(
    {
      ...readTlsCredentials(),
      minVersion: "TLSv1",
      maxVersion: "TLSv1.3",
    },
    handleSocket,
  );
  server.listen(config.xmppServerPort, "0.0.0.0", () => {
    log.success(`[XMPP] stub chat listener running on port ${config.xmppServerPort}`);
  });
  server.on("error", (error) => {
    log.err(`[XMPP] stub server error: ${error.message}`);
  });
  server.on("secureConnection", (socket) => {
    writeTranscript(
      "TLSOK",
      `${socket.remoteAddress || "unknown"}:${socket.remotePort || 0}`,
    );
  });
  server.on("tlsClientError", (error, socket) => {
    writeTranscript(
      "TLSERR",
      `${socket.remoteAddress || "unknown"}:${socket.remotePort || 0} ${error.message}`,
    );
    log.warn(`[XMPP] TLS client error: ${error.message}`);
  });

  return server;
}

module.exports = {
  inviteCharacterToRoom,
  refreshSessionChatRolePresence,
  sendSessionSystemMessage,
  syncSessionScopedRoomMembership,
  moveSessionToCurrentLocalRoom,
  unregisterCharacterSession,
  startXmppStub,
};

module.exports.__test__ = {
  getRoomDescriptor,
  handleGroupMessage,
  handleJoinPresence,
  handleReadyIq,
  normalizeRoomJid,
  registerClient(client) {
    connectedClients.add(client);
  },
  removeClientFromRoom,
  removeClientFromRooms,
  syncSessionScopedRoomMembership,
  resetState() {
    messageSequence = 0;
    connectedClients.clear();
    roomMembers.clear();
    if (
      chatRuntime &&
      chatRuntime._testing &&
      typeof chatRuntime._testing.resetRuntimeState === "function"
    ) {
      chatRuntime._testing.resetRuntimeState({
        removeFiles: process.env.EVEJS_CHAT_ALLOW_TEST_RESET === "1",
      });
    }
  },
};
