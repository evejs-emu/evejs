const path = require("path");

const sessionRegistry = require(path.join(
  __dirname,
  "../chat/sessionRegistry",
));
const {
  buildDict,
  buildKeyVal,
  buildList,
  buildPythonSet,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  buildSovClaimInfoPayload,
  buildSovStructuresPayload,
} = require(path.join(__dirname, "./sovPayloads"));
const {
  STRUCTURES_UPDATED,
} = require(path.join(__dirname, "./sovConstants"));

function normalizeInteger(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.trunc(numericValue);
}

function normalizePositiveInteger(value, fallback = null) {
  const numericValue = normalizeInteger(value, 0);
  return numericValue > 0 ? numericValue : fallback;
}

function uniqueNumericValues(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((entry) => normalizePositiveInteger(entry, null))
      .filter(Boolean),
  )];
}

function getTargetSessions({ solarSystemID = null, allianceIDs = [] } = {}) {
  const numericSolarSystemID = normalizePositiveInteger(solarSystemID, null);
  const normalizedAllianceIDs = new Set(uniqueNumericValues(allianceIDs));
  const seenCharacterIDs = new Set();
  const matches = [];

  for (const session of sessionRegistry.getSessions()) {
    const characterID = normalizePositiveInteger(
      session && (session.characterID || session.charid),
      null,
    );
    if (characterID && seenCharacterIDs.has(characterID)) {
      continue;
    }
    const sessionSolarSystemID = normalizePositiveInteger(
      session && (session.solarsystemid2 || session.solarsystemid),
      null,
    );
    const sessionAllianceID = normalizePositiveInteger(
      session && (session.allianceID || session.allianceid),
      null,
    );
    const matchesSolarSystem =
      numericSolarSystemID && sessionSolarSystemID === numericSolarSystemID;
    const matchesAlliance =
      sessionAllianceID && normalizedAllianceIDs.has(sessionAllianceID);
    if (!matchesSolarSystem && !matchesAlliance) {
      continue;
    }
    if (characterID) {
      seenCharacterIDs.add(characterID);
    }
    matches.push(session);
  }

  return matches;
}

function sendNotificationToSessions(sessions, notifyType, idType, payloadTuple = []) {
  for (const session of sessions || []) {
    if (!session || typeof session.sendNotification !== "function") {
      continue;
    }
    session.sendNotification(notifyType, idType, payloadTuple);
  }
}

function buildStructureChangesPayload(changesByStructureID = null) {
  if (!changesByStructureID || typeof changesByStructureID !== "object") {
    return null;
  }

  const entries = Object.entries(changesByStructureID)
    .map(([sourceItemID, changeSet]) => {
      const numericSourceItemID = normalizePositiveInteger(sourceItemID, null);
      if (!numericSourceItemID) {
        return null;
      }
      const normalizedChanges = [...new Set(
        (Array.isArray(changeSet) ? changeSet : [])
          .map((entry) => normalizeInteger(entry, -1))
          .filter((entry) => entry >= 0),
      )].sort((left, right) => left - right);
      return [
        numericSourceItemID,
        buildPythonSet(
          normalizedChanges.length > 0
            ? normalizedChanges
            : [STRUCTURES_UPDATED],
        ),
      ];
    })
    .filter(Boolean);

  if (entries.length === 0) {
    return null;
  }

  return buildDict(entries);
}

function buildSovHubHackPayload(upgrades = []) {
  return buildList(
    (Array.isArray(upgrades) ? upgrades : []).map((upgrade) =>
      buildKeyVal([
        ["typeID", normalizePositiveInteger(upgrade && upgrade.typeID, null)],
        ["powerState", normalizeInteger(upgrade && upgrade.powerState, 0)],
      ]),
    ),
  );
}

function broadcastSolarSystemSovStructuresUpdated(
  solarSystemID,
  structures,
  changesByStructureID = null,
  options = {},
) {
  const allianceIDs = uniqueNumericValues([
    ...(options && Array.isArray(options.allianceIDs) ? options.allianceIDs : []),
    ...(Array.isArray(structures)
      ? structures.map((structure) => structure && structure.allianceID)
      : []),
  ]);
  const sessions = getTargetSessions({
    solarSystemID,
    allianceIDs,
  });
  if (sessions.length === 0) {
    return;
  }

  const payload = [
    normalizePositiveInteger(solarSystemID, 0) || 0,
    buildSovStructuresPayload(Array.isArray(structures) ? structures : []),
  ];
  const changesPayload = buildStructureChangesPayload(changesByStructureID);
  if (changesPayload) {
    payload.push(changesPayload);
  }

  sendNotificationToSessions(
    sessions,
    "OnSolarSystemSovStructuresUpdated",
    "solarsystemid2",
    payload,
  );
}

function broadcastSolarSystemDevIndexChanged(
  solarSystemID,
  allianceIDs = [],
) {
  const sessions = getTargetSessions({
    solarSystemID,
    allianceIDs,
  });
  if (sessions.length === 0) {
    return;
  }

  sendNotificationToSessions(
    sessions,
    "OnSolarSystemDevIndexChanged",
    "solarsystemid2",
    [normalizePositiveInteger(solarSystemID, 0) || 0],
  );
}

function broadcastSovereigntyChanged(
  solarSystemID,
  claimInfo = null,
  allianceIDs = [],
) {
  const sessions = getTargetSessions({
    solarSystemID,
    allianceIDs,
  });
  if (sessions.length === 0) {
    return;
  }

  sendNotificationToSessions(
    sessions,
    "OnSovereigntyChanged",
    "solarsystemid2",
    [
      normalizePositiveInteger(solarSystemID, 0) || 0,
      buildSovClaimInfoPayload(claimInfo),
    ],
  );
}

function broadcastSovereigntyAudioEvent(
  solarSystemID,
  eventID,
  textParams = {},
  allianceIDs = [],
) {
  const sessions = getTargetSessions({
    solarSystemID,
    allianceIDs,
  });
  if (sessions.length === 0) {
    return;
  }

  sendNotificationToSessions(
    sessions,
    "OnSovereigntyAudioEvent",
    "solarsystemid2",
    [
      normalizeInteger(eventID, 0),
      textParams && typeof textParams === "object" ? textParams : {},
    ],
  );
}

function broadcastSovHubHacked(
  solarSystemID,
  sovHubID,
  upgrades = [],
  allianceIDs = [],
) {
  const sessions = getTargetSessions({
    solarSystemID,
    allianceIDs,
  });
  if (sessions.length === 0) {
    return;
  }

  sendNotificationToSessions(
    sessions,
    "OnSovHubHacked",
    "solarsystemid2",
    [
      normalizePositiveInteger(sovHubID, 0) || 0,
      buildSovHubHackPayload(upgrades),
    ],
  );
}

module.exports = {
  broadcastSolarSystemDevIndexChanged,
  broadcastSolarSystemSovStructuresUpdated,
  broadcastSovereigntyAudioEvent,
  broadcastSovereigntyChanged,
  broadcastSovHubHacked,
};
