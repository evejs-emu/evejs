const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));

const MISSION_RUNTIME_TABLE = "missionRuntimeState";
const REPLAY_DELAY_MS = 4 * 60 * 60 * 1000;
const OFFER_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function toPositiveInteger(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  const normalized = Math.trunc(numericValue);
  return normalized > 0 ? normalized : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }
  return value === true;
}

function normalizeText(value, fallback = "") {
  const text = String(value || "").trim();
  return text.length > 0 ? text : fallback;
}

function normalizeMissionContentID(value, fallback = null) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  const text = normalizeText(value, "");
  if (!text) {
    return fallback;
  }
  if (/^-?\d+$/.test(text)) {
    return Number.parseInt(text, 10);
  }
  return text;
}

function normalizeOptionalInteger(value, fallback = null) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.trunc(numericValue);
}

function currentFileTimeString() {
  return (BigInt(Date.now()) * 10000n + 116444736000000000n).toString();
}

function futureFileTimeString(deltaMs = 0) {
  const safeDeltaMs = Math.max(0, Number(deltaMs) || 0);
  return (
    BigInt(Date.now() + safeDeltaMs) * 10000n + 116444736000000000n
  ).toString();
}

function normalizeMissionStandingEvent(record, fallback = {}) {
  const source =
    record && typeof record === "object"
      ? record
      : {};
  return {
    corporation: toFiniteNumber(source.corporation, toFiniteNumber(fallback.corporation, 0)),
    faction: toFiniteNumber(source.faction, toFiniteNumber(fallback.faction, 0)),
    agent: toFiniteNumber(source.agent, toFiniteNumber(fallback.agent, 0)),
    eventTypeID: normalizeOptionalInteger(
      source.eventTypeID,
      normalizeOptionalInteger(fallback.eventTypeID, null),
    ),
    applySocial:
      Object.prototype.hasOwnProperty.call(source, "applySocial")
        ? toBoolean(source.applySocial, false)
        : toBoolean(fallback.applySocial, false),
    msg: normalizeText(source.msg, normalizeText(fallback.msg, "")),
    messageHeader: normalizeText(
      source.messageHeader,
      normalizeText(fallback.messageHeader, ""),
    ),
    messageBody: normalizeText(
      source.messageBody,
      normalizeText(fallback.messageBody, ""),
    ),
    int_1:
      Object.prototype.hasOwnProperty.call(source, "int_1")
        ? normalizeOptionalInteger(source.int_1, null)
        : normalizeOptionalInteger(fallback.int_1, null),
    int_2:
      Object.prototype.hasOwnProperty.call(source, "int_2")
        ? normalizeOptionalInteger(source.int_2, null)
        : normalizeOptionalInteger(fallback.int_2, null),
    int_3:
      Object.prototype.hasOwnProperty.call(source, "int_3")
        ? normalizeOptionalInteger(source.int_3, null)
        : normalizeOptionalInteger(fallback.int_3, null),
  };
}

function normalizeMissionRewards(record) {
  const source =
    record && typeof record === "object"
      ? record
      : {};
  const normalizeRewardItemList = (value) => (
    Array.isArray(value)
      ? value
        .map((entry) => (
          entry && typeof entry === "object"
            ? {
                typeID: toPositiveInteger(entry.typeID, 0),
                quantity: Math.max(0, Math.trunc(toFiniteNumber(entry.quantity, 0))),
                extra: entry.extra === undefined ? null : cloneValue(entry.extra),
              }
            : null
        ))
        .filter((entry) => entry && entry.typeID > 0 && entry.quantity > 0)
      : []
  );
  const rawStandings =
    source.rawStandings && typeof source.rawStandings === "object"
      ? {
          corporation: toFiniteNumber(source.rawStandings.corporation, 0),
          faction: toFiniteNumber(source.rawStandings.faction, 0),
          agent: toFiniteNumber(source.rawStandings.agent, 0),
        }
      : {
          corporation: 0,
          faction: 0,
          agent: 0,
        };
  const standingEvents =
    source.standingEvents && typeof source.standingEvents === "object"
      ? source.standingEvents
      : {};

  return {
    isk: Math.max(0, Math.round(toFiniteNumber(source.isk, 0))),
    bonusIsk: Math.max(0, Math.round(toFiniteNumber(source.bonusIsk, 0))),
    itemRewards: normalizeRewardItemList(source.itemRewards),
    bonusItemRewards: normalizeRewardItemList(source.bonusItemRewards),
    bonusTimeIntervalMinutes: Math.max(
      0,
      Math.round(toFiniteNumber(source.bonusTimeIntervalMinutes, 0)),
    ),
    loyaltyPoints: Math.max(0, Math.round(toFiniteNumber(source.loyaltyPoints, 0))),
    researchPoints: Math.max(0, Math.round(toFiniteNumber(source.researchPoints, 0))),
    rawStandings,
    standingEvents: {
      completed: normalizeMissionStandingEvent(standingEvents.completed, rawStandings),
      declined: normalizeMissionStandingEvent(
        standingEvents.declined || source.declinedRawStandings,
        {},
      ),
      failed: normalizeMissionStandingEvent(
        standingEvents.failed || source.failedRawStandings,
        {},
      ),
      offerExpired: normalizeMissionStandingEvent(
        standingEvents.offerExpired || source.offerExpiredRawStandings,
        {},
      ),
      bonus: normalizeMissionStandingEvent(
        standingEvents.bonus || source.bonusRawStandings,
        {},
      ),
    },
  };
}

function createDefaultState() {
  return {
    version: 1,
    nextMissionSequence: 1,
    charactersByID: {},
  };
}

function createDefaultCharacterState(characterID) {
  return {
    characterID: toPositiveInteger(characterID, 0),
    lastUpdatedAtMs: Date.now(),
    missionSelectionCursorByAgentID: {},
    missionsByAgentID: {},
    declineTimersByAgentID: {},
    completedCareerAgentIDs: {},
    history: [],
  };
}

function normalizeMissionRecord(record, agentID, fallbackMissionSequence) {
  if (!record || typeof record !== "object") {
    return null;
  }

  const normalizedAgentID = toPositiveInteger(
    record.agentID ?? agentID,
    toPositiveInteger(agentID, 0),
  );
  if (!normalizedAgentID) {
    return null;
  }

  const missionSequence = toPositiveInteger(
    record.missionSequence,
    toPositiveInteger(fallbackMissionSequence, 0),
  );
  const contentID = normalizeMissionContentID(
    record.contentID ?? record.clientMissionID ?? record.missionTemplateID,
    null,
  );
  const missionTemplateID = normalizeText(
    record.missionTemplateID ||
      (typeof record.contentID === "string" ? record.contentID : ""),
    "",
  );
  if (!missionSequence || contentID === null || !missionTemplateID) {
    return null;
  }

  return {
    missionSequence,
    agentID: normalizedAgentID,
    contentID,
    missionTemplateID,
    missionContentTemplateID: normalizeText(record.missionContentTemplateID, ""),
    missionNameID: toPositiveInteger(record.missionNameID, 0),
    missionPoolKey: normalizeText(record.missionPoolKey, ""),
    missionKind: normalizeText(record.missionKind, "encounter"),
    missionTypeLabel: normalizeText(
      record.missionTypeLabel,
      "UI/Agents/MissionTypes/Encounter",
    ),
    missionTitle: normalizeText(record.missionTitle, String(contentID)),
    importantMission: toBoolean(record.importantMission, false),
    runtimeStatus: normalizeText(record.runtimeStatus, "offered"),
    placeholder: toBoolean(record.placeholder, true),
    objectiveMode: normalizeText(record.objectiveMode, "dungeon"),
    objectiveCompleted: toBoolean(record.objectiveCompleted, false),
    gmCompleted: toBoolean(record.gmCompleted, false),
    offeredAtFileTime: normalizeText(
      record.offeredAtFileTime,
      currentFileTimeString(),
    ),
    acceptedAtFileTime: record.acceptedAtFileTime
      ? normalizeText(record.acceptedAtFileTime, currentFileTimeString())
      : null,
    expiresAtFileTime: normalizeText(
      record.expiresAtFileTime,
      futureFileTimeString(OFFER_EXPIRY_MS),
    ),
    lastUpdatedAtMs: toFiniteNumber(record.lastUpdatedAtMs, Date.now()),
    dungeonTemplateID: normalizeText(record.dungeonTemplateID, ""),
    dungeonID: toPositiveInteger(record.dungeonID, 0) || null,
    dungeonInstanceID: toPositiveInteger(record.dungeonInstanceID, 0) || null,
    missionSiteID: toPositiveInteger(record.missionSiteID, 0) || null,
    missionSystemID: toPositiveInteger(record.missionSystemID, 0) || null,
    missionPosition:
      record.missionPosition && typeof record.missionPosition === "object"
        ? {
            x: toFiniteNumber(record.missionPosition.x, 0),
            y: toFiniteNumber(record.missionPosition.y, 0),
            z: toFiniteNumber(record.missionPosition.z, 0),
          }
        : null,
    bookmarkIDsByRole:
      record.bookmarkIDsByRole && typeof record.bookmarkIDsByRole === "object"
        ? Object.fromEntries(
            Object.entries(record.bookmarkIDsByRole)
              .map(([role, bookmarkID]) => [
                normalizeText(role, ""),
                toPositiveInteger(bookmarkID, 0) || null,
              ])
              .filter(([role, bookmarkID]) => role && bookmarkID),
          )
        : {},
    cargo:
      record.cargo && typeof record.cargo === "object"
        ? {
            typeID: toPositiveInteger(record.cargo.typeID, 0),
            quantity: Math.max(0, Math.trunc(toFiniteNumber(record.cargo.quantity, 0))),
            volume: Math.max(0, toFiniteNumber(record.cargo.volume, 0)),
            hasCargo: toBoolean(record.cargo.hasCargo, false),
            granted: toBoolean(record.cargo.granted, false),
          }
        : null,
    pickupLocation:
      record.pickupLocation && typeof record.pickupLocation === "object"
        ? cloneValue(record.pickupLocation)
        : null,
    dropoffLocation:
      record.dropoffLocation && typeof record.dropoffLocation === "object"
        ? cloneValue(record.dropoffLocation)
        : null,
    rewards: normalizeMissionRewards(record.rewards),
  };
}

function normalizeHistoryEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const agentID = toPositiveInteger(entry.agentID, 0);
  const missionSequence = toPositiveInteger(entry.missionSequence, 0);
  const contentID = normalizeMissionContentID(
    entry.contentID ?? entry.clientMissionID ?? entry.missionTemplateID,
    null,
  );
  const missionTemplateID = normalizeText(
    entry.missionTemplateID ||
      (typeof entry.contentID === "string" ? entry.contentID : ""),
    "",
  );
  if (!agentID || !missionSequence || contentID === null || !missionTemplateID) {
    return null;
  }

  return {
    missionSequence,
    agentID,
    contentID,
    missionTemplateID,
    runtimeStatus: normalizeText(entry.runtimeStatus, "completed"),
    completedAtFileTime: normalizeText(
      entry.completedAtFileTime,
      currentFileTimeString(),
    ),
    lastUpdatedAtMs: toFiniteNumber(entry.lastUpdatedAtMs, Date.now()),
  };
}

function ensureCharacterState(state, characterID) {
  const normalizedCharacterID = toPositiveInteger(characterID, 0);
  if (!normalizedCharacterID) {
    return null;
  }

  if (
    !state.charactersByID[String(normalizedCharacterID)] ||
    typeof state.charactersByID[String(normalizedCharacterID)] !== "object"
  ) {
    state.charactersByID[String(normalizedCharacterID)] =
      createDefaultCharacterState(normalizedCharacterID);
  }

  const characterState = state.charactersByID[String(normalizedCharacterID)];
  characterState.characterID = normalizedCharacterID;
  characterState.lastUpdatedAtMs = Date.now();

  if (
    !characterState.missionSelectionCursorByAgentID ||
    typeof characterState.missionSelectionCursorByAgentID !== "object"
  ) {
    characterState.missionSelectionCursorByAgentID = {};
  }
  if (
    !characterState.missionsByAgentID ||
    typeof characterState.missionsByAgentID !== "object"
  ) {
    characterState.missionsByAgentID = {};
  }
  if (
    !characterState.declineTimersByAgentID ||
    typeof characterState.declineTimersByAgentID !== "object"
  ) {
    characterState.declineTimersByAgentID = {};
  }
  if (
    !characterState.completedCareerAgentIDs ||
    typeof characterState.completedCareerAgentIDs !== "object"
  ) {
    characterState.completedCareerAgentIDs = {};
  }
  if (!Array.isArray(characterState.history)) {
    characterState.history = [];
  }

  for (const [agentKey, missionRecord] of Object.entries(characterState.missionsByAgentID)) {
    const normalizedMissionRecord = normalizeMissionRecord(
      missionRecord,
      agentKey,
      state.nextMissionSequence,
    );
    if (!normalizedMissionRecord) {
      delete characterState.missionsByAgentID[agentKey];
      continue;
    }
    characterState.missionsByAgentID[String(normalizedMissionRecord.agentID)] =
      normalizedMissionRecord;
    if (String(normalizedMissionRecord.agentID) !== String(agentKey)) {
      delete characterState.missionsByAgentID[agentKey];
    }
    state.nextMissionSequence = Math.max(
      toPositiveInteger(state.nextMissionSequence, 1),
      normalizedMissionRecord.missionSequence + 1,
    );
  }

  const now = BigInt(Date.now()) * 10000n + 116444736000000000n;
  for (const [agentKey, replayUntilFileTime] of Object.entries(
    characterState.declineTimersByAgentID,
  )) {
    const normalizedAgentID = toPositiveInteger(agentKey, 0);
    if (!normalizedAgentID) {
      delete characterState.declineTimersByAgentID[agentKey];
      continue;
    }
    const normalizedReplayUntilFileTime = normalizeText(replayUntilFileTime, "");
    if (!normalizedReplayUntilFileTime) {
      delete characterState.declineTimersByAgentID[agentKey];
      continue;
    }
    try {
      if (BigInt(normalizedReplayUntilFileTime) <= now) {
        delete characterState.declineTimersByAgentID[agentKey];
        continue;
      }
    } catch (error) {
      delete characterState.declineTimersByAgentID[agentKey];
      continue;
    }
    characterState.declineTimersByAgentID[String(normalizedAgentID)] =
      normalizedReplayUntilFileTime;
    if (String(normalizedAgentID) !== String(agentKey)) {
      delete characterState.declineTimersByAgentID[agentKey];
    }
  }

  for (const [agentKey, completed] of Object.entries(
    characterState.completedCareerAgentIDs,
  )) {
    const normalizedAgentID = toPositiveInteger(agentKey, 0);
    if (!normalizedAgentID || completed !== true) {
      delete characterState.completedCareerAgentIDs[agentKey];
      continue;
    }
    characterState.completedCareerAgentIDs[String(normalizedAgentID)] = true;
    if (String(normalizedAgentID) !== String(agentKey)) {
      delete characterState.completedCareerAgentIDs[agentKey];
    }
  }

  characterState.history = characterState.history
    .map((entry) => normalizeHistoryEntry(entry))
    .filter(Boolean)
    .sort((left, right) => right.missionSequence - left.missionSequence)
    .slice(0, 128);

  return characterState;
}

function getMutableState() {
  const result = database.read(MISSION_RUNTIME_TABLE, "/");
  let state =
    result.success && result.data && typeof result.data === "object"
      ? result.data
      : null;

  if (!state) {
    state = createDefaultState();
    database.write(MISSION_RUNTIME_TABLE, "/", state);
    return state;
  }

  let mutated = false;
  if (toPositiveInteger(state.version, 0) !== 1) {
    state.version = 1;
    mutated = true;
  }
  if (toPositiveInteger(state.nextMissionSequence, 0) <= 0) {
    state.nextMissionSequence = 1;
    mutated = true;
  }
  if (!state.charactersByID || typeof state.charactersByID !== "object") {
    state.charactersByID = {};
    mutated = true;
  }

  for (const characterID of Object.keys(state.charactersByID)) {
    const before = JSON.stringify(state.charactersByID[characterID]);
    ensureCharacterState(state, characterID);
    if (JSON.stringify(state.charactersByID[characterID]) !== before) {
      mutated = true;
    }
  }

  if (mutated) {
    database.write(MISSION_RUNTIME_TABLE, "/", state);
  }
  return state;
}

function persistState(state) {
  return database.write(MISSION_RUNTIME_TABLE, "/", state);
}

function getStateSnapshot() {
  return cloneValue(getMutableState());
}

function getCharacterStateSnapshot(characterID) {
  const state = getMutableState();
  const characterState = ensureCharacterState(state, characterID);
  return characterState ? cloneValue(characterState) : null;
}

function mutateState(mutator) {
  const state = getMutableState();
  const result = typeof mutator === "function" ? mutator(state) : state;
  const writeResult = persistState(state);
  if (!writeResult.success) {
    return {
      success: false,
      errorMsg: writeResult.errorMsg || "WRITE_FAILED",
    };
  }
  return {
    success: true,
    data: cloneValue(result),
  };
}

function mutateCharacterState(characterID, mutator) {
  return mutateState((state) => {
    const characterState = ensureCharacterState(state, characterID);
    if (!characterState) {
      return null;
    }
    characterState.lastUpdatedAtMs = Date.now();
    return typeof mutator === "function"
      ? mutator(characterState, state)
      : characterState;
  });
}

function resetCharacterState(characterID) {
  return mutateState((state) => {
    delete state.charactersByID[String(toPositiveInteger(characterID, 0))];
    return true;
  });
}

module.exports = {
  OFFER_EXPIRY_MS,
  REPLAY_DELAY_MS,
  currentFileTimeString,
  futureFileTimeString,
  getCharacterStateSnapshot,
  getMutableState,
  getStateSnapshot,
  mutateCharacterState,
  mutateState,
  resetCharacterState,
};
