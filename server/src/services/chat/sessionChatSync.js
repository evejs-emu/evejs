const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));

const SCOPED_CHAT_SESSION_KEYS = new Set([
  "corpid",
  "allianceid",
  "warfactionid",
  "fleetid",
]);
const LOCAL_CHAT_SESSION_KEYS = new Set([
  "solarsystemid2",
  "solarsystemid",
]);
const CHAT_PRESENCE_SESSION_KEYS = new Set([
  ...SCOPED_CHAT_SESSION_KEYS,
  "role",
  "corprole",
]);

function getChangeKeys(changes) {
  if (!changes) {
    return [];
  }

  if (Array.isArray(changes)) {
    return changes
      .map((entry) => (
        Array.isArray(entry) && entry.length > 0 ? String(entry[0]) : ""
      ))
      .filter(Boolean);
  }

  if (typeof changes === "object") {
    return Object.keys(changes);
  }

  return [];
}

function hasMatchingKey(changeKeys, candidates) {
  return changeKeys.some((key) => candidates.has(String(key)));
}

function getScopedAutoJoinKinds(changeKeys) {
  const normalizedKeys = new Set(changeKeys.map((key) => String(key)));
  const joinKinds = [];

  if (normalizedKeys.has("corpid")) {
    joinKinds.push("corp");
  }
  if (normalizedKeys.has("allianceid")) {
    joinKinds.push("alliance");
  }
  if (normalizedKeys.has("fleetid")) {
    joinKinds.push("fleet");
  }
  if (normalizedKeys.has("warfactionid")) {
    joinKinds.push("faction");
  }

  return joinKinds;
}

function normalizePositiveInteger(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0
    ? numericValue
    : fallback;
}

function getLocalPreviousSolarSystemID(changes) {
  if (!changes || typeof changes !== "object") {
    return 0;
  }

  const solarsystemid2Change = changes.solarsystemid2;
  if (Array.isArray(solarsystemid2Change)) {
    return normalizePositiveInteger(solarsystemid2Change[0], 0);
  }

  const solarsystemidChange = changes.solarsystemid;
  if (Array.isArray(solarsystemidChange)) {
    return normalizePositiveInteger(solarsystemidChange[0], 0);
  }

  return 0;
}

function synchronizeSessionChatState(session, changes) {
  const changeKeys = getChangeKeys(changes);
  if (!session || changeKeys.length === 0) {
    return {
      localSynced: false,
      scopedSynced: false,
      presenceRefreshed: false,
    };
  }

  const shouldSyncLocal = hasMatchingKey(changeKeys, LOCAL_CHAT_SESSION_KEYS);
  const shouldSyncScoped = hasMatchingKey(changeKeys, SCOPED_CHAT_SESSION_KEYS);
  const shouldRefreshPresence = hasMatchingKey(
    changeKeys,
    CHAT_PRESENCE_SESSION_KEYS,
  );

  if (!shouldSyncLocal && !shouldSyncScoped && !shouldRefreshPresence) {
    return {
      localSynced: false,
      scopedSynced: false,
      presenceRefreshed: false,
    };
  }

  let localSynced = false;
  let scopedSynced = false;
  let presenceRefreshed = false;

  try {
    if (shouldSyncLocal) {
      const chatHub = require(path.join(__dirname, "./chatHub"));
      if (typeof chatHub.moveLocalSession === "function") {
        localSynced = Boolean(
          chatHub.moveLocalSession(session, getLocalPreviousSolarSystemID(changes)),
        );
      }
    }

    if (shouldSyncScoped) {
      const { syncSessionScopedRoomMembership } = require(path.join(
        __dirname,
        "./xmppStubServer",
      ));
      if (typeof syncSessionScopedRoomMembership === "function") {
        scopedSynced = Boolean(
          syncSessionScopedRoomMembership(session, {
            autoJoinKinds: getScopedAutoJoinKinds(changeKeys),
          }),
        );
      }
    }

    if (shouldRefreshPresence) {
      const chatHub = require(path.join(__dirname, "./chatHub"));
      if (typeof chatHub.refreshSessionChatRolePresence === "function") {
        presenceRefreshed = Boolean(
          chatHub.refreshSessionChatRolePresence(session),
        );
      }
    }
  } catch (error) {
    log.debug(
      `[ChatSync] Skipped post-session-change chat sync: ${error.message}`,
    );
  }

  return {
    localSynced,
    scopedSynced,
    presenceRefreshed,
  };
}

module.exports = {
  LOCAL_CHAT_SESSION_KEYS,
  synchronizeSessionChatState,
  SCOPED_CHAT_SESSION_KEYS,
  CHAT_PRESENCE_SESSION_KEYS,
  getScopedAutoJoinKinds,
};
