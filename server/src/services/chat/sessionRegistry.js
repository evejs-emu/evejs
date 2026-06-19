const sessions = new Set();

function isLiveSession(session) {
  return Boolean(session && session.socket && !session.socket.destroyed);
}

function toSessionTimestamp(value) {
  const numericValue = Number(value || 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function resolveSessionCharacterID(session) {
  if (!session) {
    return 0;
  }

  return Number(
    session.characterID ||
    session.charID ||
    session.charid ||
    0,
  ) || 0;
}

function isPreferredCharacterSession(candidate, current) {
  if (!candidate) {
    return false;
  }
  if (!current) {
    return true;
  }

  const candidateLastActivity = toSessionTimestamp(candidate.lastActivity);
  const currentLastActivity = toSessionTimestamp(current.lastActivity);
  if (candidateLastActivity !== currentLastActivity) {
    return candidateLastActivity > currentLastActivity;
  }

  const candidateConnectTime = toSessionTimestamp(candidate.connectTime);
  const currentConnectTime = toSessionTimestamp(current.connectTime);
  if (candidateConnectTime !== currentConnectTime) {
    return candidateConnectTime > currentConnectTime;
  }

  const candidateClientID = Number(candidate.clientID || candidate.clientId || 0) || 0;
  const currentClientID = Number(current.clientID || current.clientId || 0) || 0;
  return candidateClientID >= currentClientID;
}

function register(session) {
  if (session) {
    sessions.add(session);
  }
}

function unregister(session) {
  if (session) {
    sessions.delete(session);
  }
}

function getSessions() {
  return Array.from(sessions).filter(isLiveSession);
}

function findSessionByCharacterID(characterID, options = {}) {
  const targetCharacterID = Number(characterID || 0);
  if (!Number.isInteger(targetCharacterID) || targetCharacterID <= 0) {
    return null;
  }

  const excludedSession = options.excludeSession || null;
  let selectedSession = null;
  for (const session of getSessions()) {
    if (
      session === excludedSession ||
      resolveSessionCharacterID(session) !== targetCharacterID
    ) {
      continue;
    }
    if (isPreferredCharacterSession(session, selectedSession)) {
      selectedSession = session;
    }
  }
  return selectedSession;
}

module.exports = {
  register,
  unregister,
  getSessions,
  findSessionByCharacterID,
  resolveSessionCharacterID,
  isPreferredCharacterSession,
};
